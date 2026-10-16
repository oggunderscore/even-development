# Testing the prototype on real G2 glasses

Prototype status: **builds, typechecks and passes unit tests; not yet run against a real mic, Deepgram, OpenRouter, the simulator or glasses.** Expect rough edges.

## 1. Run it on your own machine (phone + computer on the same Wi-Fi)

```bash
cd even-honyaku
npm install && (cd server && npm install)

cp server/.env.example server/.env
#   set HONYAKU_TOKEN (any random string). API keys are entered in the app's Settings tab
#   (or set ALLOW_SERVER_KEYS=1 and put DEEPGRAM_API_KEY + a translation key here for local dev)

cp .env.example .env.local
#   VITE_SERVER_URL=ws://<your computer's LAN IP>:8787
#   VITE_SERVER_TOKEN=<same value as HONYAKU_TOKEN>

npm run server      # terminal 1 – STT + translation proxy
npm run dev         # terminal 2 – app dev server
npm run qr          # terminal 3 – prints the QR; scan with "Scan QR" in the Even app
```

Optional first: `npm run simulator` (needs a desktop), and `cd server && npm run translate -- listen "これはいくらですか？"` to check the translation side alone.

## 2. What to try
- Open **SETTINGS**, enter your own Deepgram + translation keys, tap **SAVE & TEST** — you should get ✓ SERVER, ✓ DEEPGRAM, ✓ provider, ✓ TRANSLATE. Wrong keys show ✗ with the reason; the feed won't start listening until keys are present.
- The app starts **paused**. Hold on the glasses (or press the phone's *Resume listening* button) → header says **listening**. Have someone speak Japanese → English appears; speak English → romaji appears.
- Phone: **hold** the big button and speak English → release → romaji (forced English, ignores language detection).
- Glasses: hold (long press) = pause/resume listening, swipe = scroll the feed (past the newest = hide, swipe again = show), double-tap = exit. Which physical swipe direction is "older" vs "newer" is unverified — if it feels backwards, swap `SCROLL_TOP_EVENT`/`SCROLL_BOTTOM_EVENT` in `src/main.ts`.
- No mic handy? Use the text box on the phone UI.

## 3. Things I could not verify (please report what you see)
1. Real-mic behaviour of the `dual` listen engine (`server/src/stt.ts`, `arbiter.ts`): is Japanese ever shown as English, or English dropped? Tune `graceMs` / confidence thresholds in `arbiter.ts`. Does background noise produce phantom phrases? (Verified only with macOS `say` audio.)
2. Whether `audioEvent.audioPcm` arrives as bytes, `number[]` or base64 on a real device (handled, but untested).
3. Whether `ws://` to a LAN IP is allowed by the app's network permission for sideloaded dev builds.
4. Quality + latency of the default OpenRouter model (`google/gemini-2.5-flash-lite`). Japanese quality and romaji accuracy matter most; try `OPENROUTER_MODEL=qwen/qwen3.7-flash` (cheaper) or any other OpenRouter id. `TRANSLATE_PROVIDER=anthropic` switches to Claude directly.
5. Whether the glasses mic sends audio continuously (also during silence) — the server logs `NO AUDIO arriving` every 15s if not.
6. Phone hold button behaviour inside the Even app WebView (pointer events).

## 4. The `even-honyaku.ehpk` package
`npm run pack` builds with your `.env.local` (server URL + token are baked in — fine for a private build, don't publish it) and packs against SDK 0.0.10 (`min_app_version` 2.2.5). `app.json` whitelists `ws://` and `http://` for the Tailscale address `100.95.240.35:8787`. Upload it as a private build in the dev portal and install it from the Even app (see README). If the app can't connect on-device, check the Debug panel: whether the whitelist format accepts a `ws://` origin is unverified.
