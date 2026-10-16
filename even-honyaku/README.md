# even-honyaku 翻訳

Live English ⇄ Japanese for Even Realities G2.

The glasses mic listens for English and Japanese (Deepgram nova-3). By default (`LISTEN_ENGINE=dual`) the same audio goes to a **dedicated Japanese model and a dedicated English model** and the result is arbitrated with a bias towards Japanese — a single multilingual stream tended to start Japanese phrases as English text:

| Heard | Glasses show |
| --- | --- |
| Japanese | English translation (with the romaji of what was said) |
| English | Japanese romaji to read aloud |

**Hold to talk** forces English-only for one phrase when you want a clean, deliberate translation to read aloud; releasing drops straight back to always-on listening. Interim transcript is shown live.

Note: always-on listening streams audio to Deepgram for as long as it's on (billed per audio minute). `dual` uses two streams, so twice the minutes; set `LISTEN_ENGINE=ja` (Japanese-only, translate everything to English) or `multi` (one multilingual stream) to spend less. Hold-to-talk on the phone is always English.

## Controls
Listening is **off when the app starts** — turn it on when you want it.

| Where | Gesture | Action |
| --- | --- | --- |
| Glasses | **hold** (long press) | pause / resume always-on listening (mic closes while paused, nothing is streamed or billed) |
| Glasses | swipe | scroll back / forward through the feed; swipe forward past the newest entry to **hide** the feed, any swipe shows it again (a new translation also brings it back) |
| Glasses | double tap | exit |
| Phone | Pause / Resume listening button | same as the glasses hold |
| Phone | **Hold** big button | talk English while held, translate on release (works while paused) |

Long press needs SDK 0.0.14+ and Even App 2.2.9+ (this build targets SDK 0.0.16 → app 2.2.10+). Single taps are ignored on purpose so a stray touch can't open the mic. A tap followed by a hold is claimed by the OS contextual menu, so use a plain hold.

## Setup
```bash
npm install && (cd server && npm install)

# 1. server keys
cp server/.env.example server/.env      # DEEPGRAM_API_KEY, GOOGLE_TRANSLATE_API_KEY (or an LLM key), HONYAKU_TOKEN
# 2. app → server address (phone-reachable LAN IP, not localhost)
cp .env.example .env.local

npm run server          # terminal 1
npm run dev             # terminal 2
npm run simulator       # or: npm run qr  (sideload on real glasses)
```
Check translation alone: `cd server && npm run translate -- listen "これはいくらですか？"` (`listen` = Japanese in, `speak` = English in).

For on-device use outside dev, deploy `server/` behind HTTPS/WSS and put its origin in `app.json` → `network.whitelist`.
## Translation backends
| `TRANSLATE_PROVIDER` | What | Cost |
| --- | --- | --- |
| `google` (default when `GOOGLE_TRANSLATE_API_KEY` is set) | Google Cloud Translation for the text; **romaji is generated locally** (kuromoji + wanakana, `server/src/romaji.ts`) | 500k chars/month free, then $20/1M chars. No LLM. |
| `openrouter` (default otherwise) | any OpenRouter model (`OPENROUTER_MODEL`) does translation + romaji | per token |
| `anthropic` | Claude directly | per token |

Google gives literal, context-free translations; the LLM backends handle tone and conversation context better.

## Packaging for the Even app (private build)
```bash
# .env.local → VITE_SERVER_URL / VITE_SERVER_TOKEN are baked into the bundle at build time
npm run pack            # build + evenhub pack → even-honyaku.ehpk
```
Then upload `even-honyaku.ehpk` under **Private builds** in the dev portal (hub.evenrealities.com) and install it from the Even app: **Even Hub tab → Me → Apps → Private builds → Install**. The phone must be able to reach the server (here: on your Tailscale tailnet); `app.json` → `network.whitelist` lists the server origin. Re-run `npm run pack` and re-upload after changing the server address or token.
