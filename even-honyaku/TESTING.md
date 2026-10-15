# Testing the prototype on real G2 glasses

Prototype status: **builds, typechecks and passes unit tests; not yet run against a real mic, Deepgram, Claude, the simulator or glasses.** Expect rough edges.

## 1. Run it on your own machine (phone + computer on the same Wi-Fi)

```bash
cd even-honyaku
npm install && (cd server && npm install)

cp server/.env.example server/.env
#   fill in ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, HONYAKU_TOKEN (any random string)

cp .env.example .env.local
#   VITE_SERVER_URL=ws://<your computer's LAN IP>:8787
#   VITE_SERVER_TOKEN=<same value as HONYAKU_TOKEN>

npm run server      # terminal 1 – STT + translation proxy
npm run dev         # terminal 2 – app dev server
npm run qr          # terminal 3 – prints the QR; scan with "Scan QR" in the Even app
```

Optional first: `npm run simulator` (needs a desktop), and `cd server && npm run translate -- listen "これはいくらですか？"` to check the Claude side alone.

## 2. What to try
- Phone: **hold** the big button and speak English → release → romaji appears on the glasses (and Japanese script on the phone).
- Switch to *They speak Japanese*, hold while someone speaks Japanese → English appears.
- Glasses: tap = start/stop listening, swipe = switch mode, double-tap = exit.
- No mic handy? Use the text box on the phone UI.

## 3. Things I could not verify (please report what you see)
1. Deepgram `nova-3` Japanese streaming settings (`server/src/stt.ts`).
2. Whether `audioEvent.audioPcm` arrives as bytes, `number[]` or base64 on a real device (handled, but untested).
3. Whether `ws://` to a LAN IP is allowed by the app's network permission for sideloaded dev builds.
4. Latency of the default model (`TRANSLATE_MODEL=claude-opus-5-5`); try `claude-haiku-5-5` if it feels slow.
5. Phone hold button behaviour inside the Even app WebView (pointer events).

## 4. The attached `even-honyaku.ehpk`
Packed against SDK 0.0.10 (`min_app_version` 2.2.5). It is built with the **default** server address (`ws://localhost:8787`) and a placeholder network whitelist (`https://honyaku.example.com`), so it will **not** reach a server as-is. Rebuild with your own `VITE_SERVER_URL`, set the real origin in `app.json`, then `npm run pack`.
