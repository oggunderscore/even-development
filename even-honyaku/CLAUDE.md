# even-honyaku (翻訳)

G2 app for live English ⇄ Japanese conversation. Sibling project in the `even-` workspace
(https://github.com/oggunderscore/even-development) — platform docs are in that repo's `even-realities-docs/`.

- **Always-on listening** (`start auto`, off until the wearer resumes it): Deepgram nova-3 with a dedicated `ja` and a dedicated `en` stream arbitrated in `server/src/arbiter.ts` (Japanese-biased; `LISTEN_ENGINE=dual|ja|multi`). Japanese heard → glasses show **English**; English heard → **romaji** to read aloud.
- **Hold to talk** (`start talk`): English-only stream for the wearer; releasing returns to always-on. No mode switch anywhere.

## Layout
- `src/core/` — the isomorphic engine (Deepgram streams + arbiter, translation providers, romaji, key validation, `engine.ts`); runs in the WebView (**direct mode**, the default) and in `server/`. No Node/DOM-only APIs, no `process.env`. Host glue: `src/romaji-browser.ts`, `server/src/romaji-node.ts`, `server/src/env.ts`.
- `src/` — Vite + TS WebView app. `main.ts` controller, `display.ts` glasses containers, `ui.ts` phone UI (terminal theme, sharp corners; Feed + Settings tabs), `settings.ts` user keys/server address (bridge storage + localStorage), `session.ts` WebSocket client (sends `config` first), `input.ts` gesture classification, `protocol.ts` wire types (shared with server).
- `server/` — optional **server mode** proxy (thin WebSocket wrapper + auth around `src/core/engine.ts`): Deepgram streaming STT (nova-3, en/ja) → translate+romanise: Google Cloud Translation + local kuromoji romaji when `GOOGLE_TRANSLATE_API_KEY` is set (no LLM), else OpenRouter, or Claude via `TRANSLATE_PROVIDER=anthropic`. **Users bring their own keys**: the app sends them in the first `config` message (`config.ts` resolves/validates, `probes.ts` powers the Test button); they live only in that connection's memory. The server's own `.env` keys are ignored unless `ALLOW_SERVER_KEYS=1`.

## Constraints that shaped the design
- **Input** (SDK 0.0.14+ / Even App 2.2.9+ has long press, arriving as `sysEvent` types 9/10; classified in `src/input.ts`): on the glasses a **long press** pauses/resumes always-on listening (starts paused; mic closed while paused), a swipe scrolls/hides the feed, double-tap exits (`shutDownPageContainer(1)`); single taps are ignored. Hold-to-talk-in-English lives on the phone button (pointer events).
- **No Japanese glyphs on the glasses font** (unknown glyphs are silently dropped) → only ASCII romaji is rendered there; macrons are stripped/doubled server-side (`arigatou`, not `arigatō`). Japanese script only appears on the phone UI.
- **No keys in the bundle** (`.ehpk` is extractable): users enter their own in Settings. Direct mode calls Deepgram (WebSocket, `['token', key]` subprotocol) and the translation providers (all allow browser CORS; Anthropic needs `anthropic-dangerous-direct-browser-access`) straight from the WebView; server mode proxies instead.
- Mic = 16 kHz mono s16le PCM via `audioControl(true)` / `event.audioEvent.audioPcm` (may arrive as `Uint8Array`, `number[]` or base64 — see `src/pcm.ts`). No audio output on G2.
- Capture stops when the WebView is suspended (Android) → re-armed on `FOREGROUND_ENTER_EVENT`.
- `app.json` `network.whitelist` lists the provider origins (Deepgram, Google Translate, OpenRouter, Anthropic). Server mode additionally needs the user's server origin added before packing.
- The kuromoji romaji dictionary (~17 MB) ships as `public/dict/*.dat.gz.bin` (copied by `scripts/copy-dict.mjs`; the `.bin` suffix stops hosts auto-decompressing `.gz`). It's only fetched for the Google provider.

## Commands
`npm run dev` · `npm run simulator` · `npm run qr` · `npm run server` · `npm run pack`
`cd server && npm run translate -- speak "How much is this?"` tests translation without audio.
