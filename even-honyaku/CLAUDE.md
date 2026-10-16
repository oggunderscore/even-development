# even-honyaku (翻訳)

G2 app for live English ⇄ Japanese conversation. Sibling project in the `even-` workspace
(https://github.com/oggunderscore/even-development) — platform docs are in that repo's `even-realities-docs/`.

- **Always-on listening** (`start auto`, off until the wearer resumes it): Deepgram nova-3 with a dedicated `ja` and a dedicated `en` stream arbitrated in `server/src/arbiter.ts` (Japanese-biased; `LISTEN_ENGINE=dual|ja|multi`). Japanese heard → glasses show **English**; English heard → **romaji** to read aloud.
- **Hold to talk** (`start talk`): English-only stream for the wearer; releasing returns to always-on. No mode switch anywhere.

## Layout
- `src/` — Vite + TS WebView app. `main.ts` controller, `display.ts` glasses containers, `ui.ts` phone UI (hold button, Japanese script), `session.ts` WebSocket client, `protocol.ts` wire types (shared with server).
- `server/` — Node proxy: Deepgram streaming STT (nova-3, en/ja) → translate+romanise: Google Cloud Translation + local kuromoji romaji when `GOOGLE_TRANSLATE_API_KEY` is set (no LLM), else OpenRouter, or Claude via `TRANSLATE_PROVIDER=anthropic`. Holds the API keys; the app only knows `VITE_SERVER_URL` + a shared token.

## Constraints that shaped the design
- **Input** (SDK 0.0.14+ / Even App 2.2.9+ has long press, arriving as `sysEvent` types 9/10; classified in `src/input.ts`): on the glasses a **long press** pauses/resumes always-on listening (starts paused; mic closed while paused), a swipe scrolls/hides the feed, double-tap exits (`shutDownPageContainer(1)`); single taps are ignored. Hold-to-talk-in-English lives on the phone button (pointer events).
- **No Japanese glyphs on the glasses font** (unknown glyphs are silently dropped) → only ASCII romaji is rendered there; macrons are stripped/doubled server-side (`arigatou`, not `arigatō`). Japanese script only appears on the phone UI.
- **No keys in the bundle** (`.ehpk` is extractable) → STT and LLM calls go through `server/`.
- Mic = 16 kHz mono s16le PCM via `audioControl(true)` / `event.audioEvent.audioPcm` (may arrive as `Uint8Array`, `number[]` or base64 — see `src/pcm.ts`). No audio output on G2.
- Capture stops when the WebView is suspended (Android) → re-armed on `FOREGROUND_ENTER_EVENT`.
- `app.json` `network.whitelist` must list the deployed server origin (placeholder `https://honyaku.example.com`).

## Commands
`npm run dev` · `npm run simulator` · `npm run qr` · `npm run server` · `npm run pack`
`cd server && npm run translate -- speak "How much is this?"` tests translation without audio.
