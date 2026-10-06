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
