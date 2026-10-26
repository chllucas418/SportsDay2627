// Shared state reducer. The Worker (Durable Object) runs it as the authority and the
// browser runs the same code to show changes instantly before the server confirms them.
// Every operation is idempotent: re-sending one after a dropped connection is harmless.

export function emptyState() {
  return { calls: {}, over: {}, evd: {}, th: [20, 10, 5], offset: 0 };
}

const ID = /^d[12]-[A-Za-z0-9:]{1,12}$/;

function isNum(v, lo, hi) {
  return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
}

// Merge {id: value | null} into a map, dropping anything that is not a valid id or number.
function mergeSet(cur, set, lo, hi) {
  const out = Object.assign({}, cur);
  if (!set || typeof set !== 'object') return out;
  for (const k of Object.keys(set)) {
    if (!ID.test(k)) continue;
    const v = set[k];
    if (v === null) delete out[k];
    else if (isNum(v, lo, hi)) out[k] = Math.round(v);
  }
  return out;
}

export function applyOp(s, op) {
  if (!op || typeof op !== 'object') return s;
  switch (op.t) {
    case 'call': {
      if (typeof op.id !== 'string' || !ID.test(op.id) || !isNum(op.ts, 0, 8.64e15)) return s;
      const c = s.calls[op.id] || [];
      if (c.length !== op.expect || c.length >= 3) return s;
      return Object.assign({}, s, { calls: Object.assign({}, s.calls, { [op.id]: c.concat([Math.round(op.ts)]) }) });
    }
    case 'undo': {
      if (typeof op.id !== 'string' || !ID.test(op.id)) return s;
      const c = s.calls[op.id] || [];
      if (c.length !== op.expect || c.length === 0) return s;
      const calls = Object.assign({}, s.calls);
      if (c.length === 1) delete calls[op.id];
      else calls[op.id] = c.slice(0, -1);
      return Object.assign({}, s, { calls });
    }
    case 'over':
      return Object.assign({}, s, { over: mergeSet(s.over, op.set, 0, 1439) });
    case 'evd':
      return Object.assign({}, s, { evd: mergeSet(s.evd, op.set, -1439, 1439) });
    case 'th': {
      if (!Array.isArray(op.th) || op.th.length !== 3) return s;
      if (!op.th.every((v) => isNum(v, 0, 180))) return s;
      return Object.assign({}, s, { th: op.th.map(Math.round) });
    }
    case 'offset':
      return isNum(op.v, -1e10, 1e10) ? Object.assign({}, s, { offset: Math.round(op.v) }) : s;
    case 'resetCalls':
      return Object.assign({}, s, { calls: {} });
    case 'resetTimes':
      return Object.assign({}, s, { over: {}, evd: {} });
    default:
      return s;
  }
}
