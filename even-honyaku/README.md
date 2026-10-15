# even-honyaku 翻訳

Live English ⇄ Japanese for Even Realities G2.

| Mode | You / them | Glasses show |
| --- | --- | --- |
| **I speak English** | you talk | romaji of the Japanese — read it aloud |
| **They speak Japanese** | they talk | English translation (with the romaji of what they said) |

Translations stream in per phrase while the mic is open; interim transcript is shown live.

## Controls
| Where | Gesture | Action |
| --- | --- | --- |
| Phone | **Hold** big button | talk while held, translate on release |
| Glasses | tap | start / stop listening (G2 has no hold gesture) |
| Glasses | swipe up/down | switch mode (when idle) |
| Glasses | double tap | exit |

## Setup
```bash
npm install && (cd server && npm install)

# 1. server keys
cp server/.env.example server/.env      # OPENROUTER_API_KEY, DEEPGRAM_API_KEY, HONYAKU_TOKEN
# 2. app → server address (phone-reachable LAN IP, not localhost)
cp .env.example .env.local

npm run server          # terminal 1
npm run dev             # terminal 2
npm run simulator       # or: npm run qr  (sideload on real glasses)
```
Check translation alone: `cd server && npm run translate -- listen "これはいくらですか？"`.

For on-device use outside dev, deploy `server/` behind HTTPS/WSS and put its origin in `app.json` → `network.whitelist`.
Translation goes through [OpenRouter](https://openrouter.ai) by default; pick the model with `OPENROUTER_MODEL` (default `google/gemini-2.5-flash-lite`, ~$0.10 in / $0.40 out per 1M tokens). Set `TRANSLATE_PROVIDER=anthropic` to call Claude directly instead.
