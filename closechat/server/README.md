# Chatly recovery server

Optional companion for the Chatly web app. It enables **Forgot password by
email**. Without it, users can still change their password and reset it with
their recovery key; only the email option is missing.

What it stores (per account, keyed by a hash of the username): the verified
recovery email, the account's public key, and an *escrow* — the account key
wrapped with a random key, plus that key. It never sees passwords, messages,
friends or usernames in clear.

**Trust model:** whoever runs this server *and* can read the user's mailbox
can take over that account (same as Telegram's recovery email). Users who
never add an email are not stored here at all.

## Run locally (Windows PowerShell)

```powershell
cd closechat\server
npm install
copy .env.example .env     # edit SMTP_* (Gmail app password) and MAIL_FROM
npm start                  # -> http://localhost:8787
```

Then in the app: Settings → Network → *Recovery server URL* → `http://localhost:8787`
(or set `DEFAULT_RECOVERY_SERVER` in `closechat/src/main.js` and rebuild so every user gets it).

## Deploy (Render, free)

1. Push this repo to your GitHub. On https://render.com → New → Web Service → pick the repo.
2. Root directory: `closechat/server`. Build: `npm install`. Start: `npm start`.
3. Environment: add the variables from `.env.example` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASS`, `MAIL_FROM`, `ALLOW_ORIGIN=https://<your-pages-site>`).
4. `DATA_DIR` must be on a persistent disk (Render: add a Disk mounted at `/data`, set `DATA_DIR=/data`).
   On the free tier (no disk) the records are lost on redeploy; the app re-uploads a user's escrow
   automatically the next time they log in, but a user who forgets their password *before* that
   cannot be recovered — use a disk or any small VPS for real use.
5. Put the service URL (e.g. `https://chatly-recovery.onrender.com`) into `DEFAULT_RECOVERY_SERVER`
   in `closechat/src/main.js`, run `npm run build` in `closechat/`, commit `app.js`.

Any Node 18+ host works (VPS with pm2, Railway, Fly.io, a Raspberry Pi...).

## Email providers

Gmail SMTP (app password) is the default. Any SMTP works — set `SMTP_HOST/PORT/USER/PASS`
(e.g. Brevo: `smtp-relay.brevo.com:587`, Resend: `smtp.resend.com:465` with user `resend`).
With no SMTP configured, codes are written to `DATA_DIR/outbox.json` (development only).

## API (all POST JSON)

| Route | Auth | Purpose |
|---|---|---|
| `/v1/email/start` | signed | send verification code to `email` |
| `/v1/email/verify` | signed | confirm code, store email + escrow |
| `/v1/email/status` | signed | is an email registered for this identity |
| `/v1/email/escrow` | signed | replace escrow (after password reset / redeploy) |
| `/v1/email/remove` | signed | delete record |
| `/v1/recover/start` | none | email a reset code (always returns ok) |
| `/v1/recover/finish` | none | exchange code for escrow |

"signed" = `{ data: "<json>", auth: <nostr event kind 27235 signed by the account key> }`
(the event's `payload` tag is the SHA-256 of `data`). Rate limit: 40 requests / 10 min / IP, 5 code attempts.

## Web Push (notifications when the app is closed)

The same server can wake a user's *closed* Chatly so it shows "New message" /
"Incoming call". Nothing but the sender's public key and the kind of event ever
reaches the server; the real message still travels encrypted over the relays.

1. Deploy the server as above and set the **Recovery server URL** in the app
   (Settings → Network). The server prints VAPID keys on first start; put them in
   `.env` as `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (and `VAPID_SUBJECT=mailto:you@example.com`)
   so subscriptions survive redeploys.
2. Each user turns on **Settings → Notifications → When the app is closed**.
3. Where it works: Chrome/Edge/Firefox on desktop and Android (tab may be closed,
   browser may run in the background); iPhone/iPad **only** when Chatly is added to
   the Home Screen from Safari (Share → *Add to Home Screen*, iOS 16.4+) and opened
   from there. The sideloaded `.ipa` shell cannot receive Apple push without an
   Apple developer account — use the Home-Screen app on iPhone for notifications.
   Push notifications open the app; a call still has to be answered inside Chatly.
