import { DurableObject } from 'cloudflare:workers';
import { applyOp, emptyState } from '../public/shared.js';

const COOKIE = 'sd_session';
const MAX_AGE = 7 * 24 * 3600;
const enc = new TextEncoder();

/* ---------- Auth: one shared password, signed session cookie ---------- */

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  return exp + '.' + (await hmac(env.APP_PASSWORD, 'session:' + exp));
}

function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

async function isAuthed(request, env) {
  const tok = getCookie(request, COOKIE);
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || !(+exp > Date.now() / 1000)) return false;
  return same(sig, await hmac(env.APP_PASSWORD, 'session:' + exp));
}

function cookieHeader(request, value, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

async function serve(env, request, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url).toString(), { method: 'GET', headers: request.headers }));
  const headers = new Headers(res.headers);
  if (path.endsWith('.html')) headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, headers });
}

/* ---------- Worker entry ---------- */

export default {
  async fetch(request, env) {
    if (!env.APP_PASSWORD) return new Response('APP_PASSWORD secret is not set. Run: npx wrangler secret put APP_PASSWORD', { status: 500 });
    const url = new URL(request.url);
    let path = url.pathname;

    if (path === '/api/login') {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      let body = {};
      try { body = await request.json(); } catch { /* fall through to rejection */ }
      const given = typeof body.password === 'string' ? body.password : '';
      const ok = same(await hmac('login', given), await hmac('login', env.APP_PASSWORD));
      if (!ok) {
        await new Promise((r) => setTimeout(r, 700)); // slow down guessing
        return json({ error: 'Wrong password' }, 401);
      }
      return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, await makeToken(env), MAX_AGE) });
    }

    if (path === '/api/logout') {
      return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader(request, '', 0) });
    }

    const authed = await isAuthed(request, env);

    if (path === '/api/me') return json({ ok: authed }, authed ? 200 : 401);

    if (!authed) {
      if (path.startsWith('/api/')) return json({ error: 'Not signed in' }, 401);
      return serve(env, request, '/login.html');
    }

    if (path === '/api/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) return new Response('Bad origin', { status: 403 });
      return env.ROOM.get(env.ROOM.idFromName('main')).fetch(request);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not found', { status: 404 });
    if (path === '/' || path === '/index.html' || path === '/login.html') path = '/app.html';
    return serve(env, request, path);
  },
};

/* ---------- One shared room: holds the state and pushes every change to all devices ---------- */

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.data = emptyState();
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('state');
      if (saved) this.data = Object.assign(emptyState(), saved);
    });
  }

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.broadcast([]); // new device gets the full state; everyone gets the new device count
    return new Response(null, { status: 101, webSocket: client });
  }

  message(acks, exclude) {
    const peers = this.ctx.getWebSockets().filter((w) => w !== exclude).length;
    return JSON.stringify({ t: 'state', state: this.data, acks, peers, s: Date.now() });
  }

  broadcast(acks, exclude) {
    const m = this.message(acks, exclude);
    for (const w of this.ctx.getWebSockets()) {
      if (w === exclude) continue;
      try { w.send(m); } catch { /* socket already gone */ }
    }
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 20000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', c: m.c, s: Date.now() }));
      return;
    }
    if (m.t === 'op' && m.op) {
      const next = applyOp(this.data, m.op);
      if (next !== this.data) {
        this.data = next;
        await this.ctx.storage.put('state', next);
      }
      // Always acknowledge, even when the op changed nothing, so the sender can drop it from its queue.
      this.broadcast([String(m.op.oid || '')]);
    }
  }

  webSocketClose(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code); } catch { /* already closed */ }
    this.broadcast([], ws);
  }

  webSocketError(ws) {
    this.broadcast([], ws);
  }
}
