# Sports Day Call Sheet (Cloudflare)

Announcer call sheet for the 30th Athletics Meet (27–28 Oct 2026). Several people can sign in with one password. Call counts, delays, the call deadlines and the rehearsal clock are shared live between all devices.

## What is in here

| Path | What it does |
| --- | --- |
| `src/worker.js` | Worker: password sign-in, signed session cookie, serves the pages, and a Durable Object (`Room`) that keeps the shared state and pushes changes over WebSockets. |
| `public/app.html` | The call sheet. Only served to signed-in users. |
| `public/login.html` | Sign-in page. Shown to everyone who is not signed in. |
| `public/shared.js` | The rules for changing the shared state. Used by the Worker (authoritative) and by the browser (instant on-screen update). |
| `wrangler.jsonc` | Cloudflare config, including the sign-in password. |

## Deploy

1. Install and sign in to Cloudflare:

   ```sh
   npm install
   npx wrangler login
   ```

2. The password is the `APP_PASSWORD` variable in `wrangler.jsonc`. Change it there before deploying if you want a different one. It is stored as a plain variable, so anyone who can read the repository can read it. If the repository is public, use a secret instead: delete the `vars` block and run `npx wrangler secret put APP_PASSWORD`.

3. Deploy:

   ```sh
   npx wrangler deploy
   ```

4. Put it on your domain. Either add the domain under Workers & Pages, then your Worker, then Settings, then Domains & Routes, or add this to `wrangler.jsonc` and deploy again (the domain must be a zone in your Cloudflare account):

   ```jsonc
   "routes": [{ "pattern": "sportsday.example.com", "custom_domain": true }]
   ```

Durable Objects with SQLite storage work on the free plan.

## Run it locally

```sh
npm install
echo 'APP_PASSWORD=choose-a-password' > .dev.vars
npm run dev
```

Open http://localhost:8787. `.dev.vars` is git-ignored.

## How it behaves

- **Sign-in:** One shared password. A wrong password waits 0.7 seconds before it answers. A session lasts 7 days. Changing `APP_PASSWORD` signs everyone out. The call sheet and the live connection are not available without signing in.
- **Live sync:** Every tap, delay and setting goes to the Durable Object, which saves it and sends the new state to every connected device. The header shows `Live · N devices`.
- **Same call from two phones:** If two devices tap the same call at the same moment, it is recorded once.
- **Dropped signal:** Taps made while offline are kept on the device (`Offline · N unsent`) and sent when the connection returns. The last known state is shown while offline.
- **One clock:** Every device uses the server's clock, and the venue time zone (UTC+8, set by `TZ` at the top of the script in `app.html`) instead of the phone's own settings. The rehearsal clock is shared too, so all devices practise together.
- **Inter-class relay (#35, Day 1):** Six races, Form 1 to Form 6, 7 minutes apart from 14:45 (14:45, 14:52, 14:59, 15:06, 15:13, 15:20), ending before #39 at 15:30. A switch in the 14:45 block chooses **All grades at once** (one row, one set of three calls, deadlines from 14:45) or **Grade by grade** (six rows, each with its own three calls and deadlines). Every device follows the switch. The two modes keep separate call counts, so choose one before the relays start. To change the spacing, edit the `off:(i-1)*7` expression in `FORMS()` in `public/app.html`.
- **Announce now:** For 15 seconds after a call is recorded the whole row shines on every device and its button stays on that call ("Announce now · 12s") before moving on to the next one. The time is `SHINE_MS` near the top of the script in `public/app.html`.
- **Repeating the final call:** After the third call the button reads **Done · Final call again**. Each tap records another final call (up to 50), shines the row again and shows its time as "Final again". Undo removes the latest one.
- **Shortlist and winners:** Every track, field and relay event has an extra button under it: **Announce shortlist** for heats and **Announce winners** for finals and relays. It records the time, shines the row for 15 seconds, and shows "announced at hh:mm:ss". It has no deadline colours, since it depends on when the event finishes. **Hide finished** only hides an event once its calls and its announcement are done.
- **Header:** The top bar always shows the current time first, then the start time of the list of items currently under it (it follows the scroll).
- **Beeps:** When a call becomes overdue each device beeps: one low beep (call 1), two beeps (call 2), three sharp high beeps (final call). Browsers only allow sound after a first tap on the page, so tap **Enable sound** once after opening. Beeps are a per-device setting.
- **Per-device settings** (kept in that browser only): which day tab is open, Hide finished, Keep the screen on, and sound on or off.

## Before the event

Run a rehearsal: Settings, then Rehearsal clock, set the time to 09:00 on 27 Oct, practise, then **Clear all call counts** and **Back to real time**.
