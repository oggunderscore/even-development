# Testing the prototype on real G2 glasses

Release candidate 1.0.0: **builds, typechecks and passes unit tests; checked in the simulator and a headless browser, but not yet on real glasses.** Items in section 3 are still unverified on a device.

## 1. Run it on your own machine (phone + computer on the same Wi-Fi)

```bash
cd even-honyaku
npm install
npm run dev         # terminal 1 – app dev server (also copies the romaji dictionary to public/dict)
npm run qr          # terminal 2 – prints the QR; scan with "Scan QR" in the Even app
```
There is no server. On first launch the glasses show the setup screen and the phone opens **SETTINGS** — enter your keys there.

Optional first: `npm run simulator` (needs a desktop).

## 2. What to try
- First run: the glasses say *Please set up Honyaku in the Even Realities app / Error: Missing API keys*; the phone shows **SETTINGS** with a SETUP checklist and **? HOW TO GET ONE** help under each key. Enter keys → **SAVE & TEST** → ✓ DEEPGRAM, ✓ provider, ✓ TRANSLATE (plus ✓ ROMAJI for Google). Wrong keys show ✗ with the reason; the feed won't start listening until keys are present.
- The app starts **paused**. Hold on the glasses (or press the phone's *Resume listening* button) → header says **listening**. Have someone speak Japanese → English appears; speak English → romaji appears.
- Phone: **hold** the big button and speak English → release → romaji (forced English, ignores language detection).
- Glasses: hold (long press) = pause/resume listening, swipe = scroll the feed (past the newest = hide, swipe again = show), double-tap = exit. Which physical swipe direction is "older" vs "newer" is unverified — if it feels backwards, swap `SCROLL_TOP_EVENT`/`SCROLL_BOTTOM_EVENT` in `src/main.ts`.
- No mic handy? Use the text box on the phone UI.

## 3. Things I could not verify (please report what you see)
1. Real-mic behaviour of the `dual` listen engine (`src/core/stt.ts`, `arbiter.ts`): is Japanese ever shown as English, or English dropped? Tune `graceMs` / confidence thresholds in `arbiter.ts`. Does background noise produce phantom phrases? (Verified only with macOS `say` audio.)
2. Whether `audioEvent.audioPcm` arrives as bytes, `number[]` or base64 on a real device (handled, but untested).
3. Whether `ws://` to a LAN IP is allowed by the app's network permission for sideloaded dev builds.
4. Quality + latency of the default OpenRouter model (`google/gemini-2.5-flash-lite`). Japanese quality and romaji accuracy matter most; try `OPENROUTER_MODEL=qwen/qwen3.7-flash` (cheaper) or any other OpenRouter id. `TRANSLATE_PROVIDER=anthropic` switches to Claude directly.
5. Whether the glasses mic sends audio continuously (also during silence) — if not, the app shows *No audio from the mic yet* after 3 seconds of listening.
6. Phone hold button behaviour inside the Even app WebView (pointer events).

## 4. The `even-honyaku.ehpk` package
`npm run pack` builds the app (plus the 17 MB romaji dictionary) and packs against SDK 0.0.16 (`min_app_version` 2.2.10). No keys are baked in; `app.json` whitelists Deepgram, Google Translate, OpenRouter and Anthropic. Upload it as a private build in the dev portal, install from the Even app, then enter your keys in **SETTINGS**. Unverified on-device: that the app's network whitelist accepts `wss://api.deepgram.com` for the WebSocket (both `wss://` and `https://` origins are listed), and that a ~15 MB upload is accepted. If a direct call fails, SAVE & TEST (Settings) shows which step failed and why.
