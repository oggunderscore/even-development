# even-honyaku (翻訳)

G2 app for live English ⇄ Japanese conversation. Sibling project in the `even-` workspace
(https://github.com/oggunderscore/even-development) — platform docs are in that repo's `even-realities-docs/`.

- **Always-on listening** (`start auto`, off until the wearer resumes it): Deepgram nova-3 with a dedicated `ja` and a dedicated `en` stream arbitrated in `src/core/arbiter.ts` (Japanese-biased; Settings → listening mode dual | ja | multi). Japanese heard → glasses show **English**; English heard → **romaji** to read aloud.
- **Hold to talk** (`start talk`): English-only stream for the wearer; releasing returns to always-on. No mode switch anywhere.

## Layout
- `src/core/` — the isomorphic engine (Deepgram streams + arbiter, translation providers, romaji, key validation, `engine.ts`); runs in the WebView; there is **no server** (the Even app hosts a WebView, so users bring their own keys and the phone calls Deepgram + the translation provider directly). No Node-only APIs, no `process.env`. Host glue: `src/romaji-browser.ts` (tests use `src/test/romaji-node.ts`).
- `src/` — Vite + TS WebView app. `main.ts` controller, `display.ts` glasses containers, `ui.ts` phone UI (terminal theme, sharp corners; Feed + Settings tabs), `settings.ts` user keys + choices, first-run `setupSteps` (bridge storage + localStorage), `session.ts` (runs the engine, sends `config` first), `input.ts` gesture classification, `protocol.ts` message types between the app and the engine.

## Constraints that shaped the design
- **First run:** until both a Deepgram key and one translation key are set, the glasses show a setup screen (`Display.setSetup`) and the phone opens Settings.
- **Input** (SDK 0.0.14+ / Even App 2.2.9+ has long press, arriving as `sysEvent` types 9/10; classified in `src/input.ts`): on the glasses a **long press** pauses/resumes always-on listening (starts paused; mic closed while paused), a swipe scrolls the feed one entry (the JP/you line + its translation) at a time (`src/feed.ts`: up pushes the top entry off until the view is empty, down brings one back; new rows append at the bottom, laid out from the top of the body; rows are word-wrapped by estimated glyph width so the glasses never re-wrap and overflow), double-tap exits (`shutDownPageContainer(1)`); single taps are ignored. Hold-to-talk-in-English lives on the phone button (pointer events).
- **No Japanese glyphs on the glasses font** (unknown glyphs are silently dropped) → only ASCII romaji is rendered there; macrons are stripped/doubled in `core/lang.ts` (`arigatou`, not `arigatō`). Japanese script only appears on the phone UI.
- **No keys in the bundle** (`.ehpk` is extractable): users enter their own in Settings. Direct mode calls Deepgram (WebSocket, `['token', key]` subprotocol) and the translation providers (all allow browser CORS; Anthropic needs `anthropic-dangerous-direct-browser-access`) straight from the WebView.
- Mic = 16 kHz mono s16le PCM via `audioControl(true)` / `event.audioEvent.audioPcm` (may arrive as `Uint8Array`, `number[]` or base64 — see `src/pcm.ts`). No audio output on G2.
- Capture stops when the WebView is suspended (Android) → re-armed on `FOREGROUND_ENTER_EVENT`.
- `app.json` `network.whitelist` lists the provider origins (Deepgram, Google Translate, OpenRouter, Anthropic).
- The kuromoji romaji dictionary (~17 MB) ships as `public/dict/*.dat.gz.bin` (copied by `scripts/copy-dict.mjs`; the `.bin` suffix stops hosts auto-decompressing `.gz`). It's only fetched for the Google provider.

## Release hygiene
- `app.json` `version` is the single source: `vite.config.ts` injects it as `__APP_VERSION__` (footer of Settings); `package.json` must match (`src/release.test.ts` checks it, plus store manifest rules). Bump both for every release; released versions are immutable.
- **No logging** anywhere (no console, no on-screen debug log): audio, transcripts, translations and keys must never be written out. Errors shown to the user must not echo a key (the browser's WebSocket error quotes the subprotocol, so Deepgram errors are generic). Google's key goes in the `X-Goog-Api-Key` header, never the URL.
- The production build adds a CSP meta tag (`script-src 'self'`, no inline script) — see `vite.config.ts`. It deliberately doesn't set `connect-src`; the Even app enforces the `app.json` network whitelist.
- Keep permissions to what's used (`g2-microphone`, `network`); `PRIVACY.md` must cover each.

## Commands
`npm run dev` · `npm run simulator` · `npm run qr` · `npm run pack` · `npm test`
