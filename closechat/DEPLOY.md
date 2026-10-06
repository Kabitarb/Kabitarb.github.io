# Chatly — moving it to your own GitHub / server

Everything Chatly needs is in this folder. There are three parts:

| Part | Folder | Needed? |
|---|---|---|
| Web app (PWA) | `closechat/` (this folder) | yes — static files, any host |
| Recovery server | `closechat/server/` | optional — only for "Forgot password by email" |
| iPhone app | `CloseChatiOS/` (separate zip) | optional — WKWebView shell that loads the web app |

Messages, calls and friend lists never touch any server you run: they go
end-to-end encrypted through public Nostr relays (list in `src/relay.js`,
editable by users in Settings → Network).

## 1. Web app on another GitHub Pages repo

1. Create a repo named `<user>.github.io` (or any repo with Pages enabled).
2. Copy this whole `closechat/` folder into it (keep the folder name, or rename it
   and change `start_url`/`scope` in `manifest.webmanifest` and the paths in `sw.js`).
3. Push. The app is live at `https://<user>.github.io/closechat/`.

Any static host works the same (Netlify, Vercel, Cloudflare Pages, nginx, S3):
upload the folder; it must be served over **https** (required for camera, mic,
notifications and the service worker).

### Rebuilding after code changes

```bash
cd closechat
npm install
npm run build      # bundles src/*.js -> app.js (esbuild)
```

Only `app.js` is generated; everything else is plain static files. Bump
`const CACHE = 'closechat-vN'` in `sw.js` when you ship, so installed PWAs refresh.

## 2. Recovery server (optional)

Enables Settings → Account & security → Recovery email, the "Add a recovery
email" reminder and "Forgot password?" → email code. Without it, users can still
change their password and reset it with their **recovery key** (Settings).

What it stores: a hash of the username, the verified email, and the user's
identity key wrapped by a random key (so a password reset is possible). It never
sees passwords, messages, friends or chat history. Trade-off: whoever controls
this server *and* the user's mailbox can take over accounts that registered an
email. Users who never add an email are unaffected.

Deploy (Render free tier, Railway, Fly, any VPS with Node 18+):

```bash
cd closechat/server
cp .env.example .env     # fill SMTP_* with Gmail app password or any SMTP provider
npm install
npm start                # listens on PORT (default 8787)
```

Full details, env vars and the HTTP API: `server/README.md`.

Then tell the web app where it is — one of:

* set `DEFAULT_RECOVERY_SERVER = 'https://your-server'` in `src/main.js` and rebuild
  (every user gets it automatically), or
* each user pastes the URL in Settings → Network → Recovery server URL.

## 3. iPhone app

`CloseChatiOS/` is an Xcode project (SwiftUI + WKWebView). The app loads the web
app URL from `Info.plist` → `ChatlyAppURL`; change that string to your host and
rebuild — nothing else references the domain.

Build an unsigned, sideloadable .ipa on a Mac:

```bash
cd CloseChatiOS
xcodebuild -target CloseChat -configuration Release -sdk iphoneos \
  CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO \
  ONLY_ACTIVE_ARCH=NO ARCHS=arm64 build
mkdir -p Payload && cp -r build/Release-iphoneos/CloseChat.app Payload/ && zip -r Chatly.ipa Payload
```

Install with Sideloadly or AltStore (free Apple ID: re-sign every 7 days).

## Files worth knowing

```
closechat/
  index.html  styles.css  app.js(built)  sw.js  manifest.webmanifest  icons/
  src/main.js      UI
  src/app.js       protocol: friends, groups, messages, presence, backup
  src/crypto.js    keys, NIP-44 encryption, keystore (password change), recovery key
  src/account.js   login resolution, change password, recovery-server client
  src/relay.js     Nostr relay transport
  src/rtc.js       WebRTC calls + screen share
  src/games.js     Tic-Tac-Toe / Ludo
  server/          recovery server (optional)
```
