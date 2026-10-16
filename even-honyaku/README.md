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

cp server/.env.example server/.env     # set HONYAKU_TOKEN (any secret string); API keys are optional, see below
cp .env.example .env.local             # VITE_SERVER_URL = phone-reachable LAN/Tailscale address (not localhost)

npm run server          # terminal 1
npm run dev             # terminal 2
npm run simulator       # or: npm run qr  (sideload on real glasses)
```

### API keys: bring your own
Open the app's **SETTINGS** tab and enter the server address + access token, your **Deepgram** key and a **translation** key (Google Translate, OpenRouter or Claude). **SAVE & TEST** connects, validates each key with its service and runs a sample translation, showing ✓/✗ per step.

- Keys are stored on the device (Even bridge storage, mirrored to localStorage) and shown masked. **CLEAR KEYS** wipes them.
- They're sent to the server only in the first WebSocket message, kept in memory for that connection, and never logged or stored by the server — so usage is billed to *your* accounts, not the server owner's.
- Because keys travel over the socket, the app refuses plain `ws://` unless the address is loopback, LAN or Tailscale; use `wss://` for anything public.
- Dev shortcut: `ALLOW_SERVER_KEYS=1` in `server/.env` lets connections without their own keys fall back to the keys in that file (you pay).

Check translation alone with the server's own env keys: `cd server && npm run translate -- listen "これはいくらですか？"` (`listen` = Japanese in, `speak` = English in).

For on-device use outside dev, deploy `server/` behind HTTPS/WSS and put its origin in `app.json` → `network.whitelist`.

## Translation backends
| Provider (Settings tab, or `TRANSLATE_PROVIDER` for server-side fallback keys) | What | Cost |
| --- | --- | --- |
| `google` (default when `GOOGLE_TRANSLATE_API_KEY` is set) | Google Cloud Translation for the text; **romaji is generated locally** (kuromoji + wanakana, `server/src/romaji.ts`) | 500k chars/month free, then $20/1M chars. No LLM. |
| `openrouter` (default otherwise) | any OpenRouter model (`OPENROUTER_MODEL`) does translation + romaji | per token |
| `anthropic` | Claude directly | per token |

Google gives literal, context-free translations; the LLM backends handle tone and conversation context better.

## Packaging for the Even app (private build)
```bash
# .env.local → VITE_SERVER_URL / VITE_SERVER_TOKEN become the app's *defaults* (editable in Settings).
# Leave VITE_SERVER_TOKEN empty for a build you'll share — it is baked into the .ehpk.
npm run pack            # build + evenhub pack → even-honyaku.ehpk
```
Then upload `even-honyaku.ehpk` under **Private builds** in the dev portal (hub.evenrealities.com) and install it from the Even app: **Even Hub tab → Me → Apps → Private builds → Install**. The phone must be able to reach the server (here: on your Tailscale tailnet); `app.json` → `network.whitelist` lists the server origin. The server address and token can also be changed in Settings without repacking. The wire protocol changed (token + keys now arrive in a `config` message), so re-pack and re-upload the app whenever you update the server.
