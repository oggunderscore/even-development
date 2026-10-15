# even-honyaku (翻訳)

G2 app for live English ⇄ Japanese conversation. Sibling project in the `even-` workspace
(https://github.com/oggunderscore/even-development) — platform docs are in that repo's `even-realities-docs/`.

- **Speak mode (EN→JP):** wearer speaks English → glasses show **romaji** to read aloud.
- **Listen mode (JP→EN):** other person speaks Japanese → glasses show **English**.

## Layout
- `src/` — Vite + TS WebView app. `main.ts` controller, `display.ts` glasses containers, `ui.ts` phone UI (hold button, Japanese script), `session.ts` WebSocket client, `protocol.ts` wire types (shared with server).
- `server/` — Node proxy: Deepgram streaming STT (nova-3, en/ja) → LLM translate+romanise (OpenRouter by default, Claude optional via `TRANSLATE_PROVIDER=anthropic`). Holds the API keys; the app only knows `VITE_SERVER_URL` + a shared token.

## Constraints that shaped the design
- **No long-press on the G2.** SDK input is tap / double-tap / swipe only. Hold-to-talk lives on the phone button (pointer events); on the glasses a tap toggles the mic, swipe flips direction, double-tap exits (`shutDownPageContainer(1)`).
- **No Japanese glyphs on the glasses font** (unknown glyphs are silently dropped) → only ASCII romaji is rendered there; macrons are stripped/doubled server-side (`arigatou`, not `arigatō`). Japanese script only appears on the phone UI.
- **No keys in the bundle** (`.ehpk` is extractable) → STT and LLM calls go through `server/`.
- Mic = 16 kHz mono s16le PCM via `audioControl(true)` / `event.audioEvent.audioPcm` (may arrive as `Uint8Array`, `number[]` or base64 — see `src/pcm.ts`). No audio output on G2.
- Capture stops when the WebView is suspended (Android) → re-armed on `FOREGROUND_ENTER_EVENT`.
- `app.json` `network.whitelist` must list the deployed server origin (placeholder `https://honyaku.example.com`).

## Commands
`npm run dev` · `npm run simulator` · `npm run qr` · `npm run server` · `npm run pack`
`cd server && npm run translate -- speak "How much is this?"` tests translation without audio.
