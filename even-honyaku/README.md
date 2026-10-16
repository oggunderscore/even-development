# even-honyaku 翻訳

Live English ⇄ Japanese for Even Realities G2.

**English input** (Settings) decides how your own English gets in. **HOLD TO TALK** (the default): English is heard only while you hold the phone's talk button, and always-on listening hears **Japanese only**, so Japanese you read aloud to the other person never turns into a translation on the glasses. **ALWAYS ON**: the glasses mic picks up English and Japanese automatically (Deepgram nova-3). In that mode (Settings → **Always-on engine: DUAL**, the default) the same audio goes to a **dedicated Japanese model and a dedicated English model** and the result is arbitrated with a bias towards Japanese — a single multilingual stream tended to start Japanese phrases as English text:

| Heard | Glasses show |
| --- | --- |
| Japanese | English translation (with the romaji of what was said) |
| English | Japanese romaji to read aloud |

**Hold to talk** forces English-only for one phrase when you want a clean, deliberate translation to read aloud; releasing drops straight back to always-on listening. Interim transcript is shown live.

Note: always-on listening streams audio to Deepgram for as long as it's on (billed per audio minute). In ALWAYS ON mode `dual` uses two streams, so twice the minutes; pick **JA ONLY** (Japanese only, translate everything to English) or **MULTI** (one multilingual stream) in Settings to spend less. HOLD TO TALK mode (the default) uses a single Japanese stream, so it is also the cheapest.

## Controls
Listening is **off when the app starts** — turn it on when you want it.

| Where | Gesture | Action |
| --- | --- | --- |
| Glasses | **hold** (long press) | pause / resume always-on listening (mic closes while paused, nothing is streamed or billed) |
| Glasses | swipe | scroll the feed one translation (the two-line pair) at a time. Swipe **up** pushes the top pair off the screen (keep going and the view is empty, every earlier translation hidden); swipe **down** brings one back. New translations appear at the bottom of the text, which starts at the top of the screen |
| Glasses | double tap | exit |
| Phone | Pause / Resume listening button | same as the glasses hold |
| Phone | **Hold** big button | talk English while held, translate on release (works while paused) |

Long press needs SDK 0.0.14+ and Even App 2.2.9+ (this build targets SDK 0.0.16 → app 2.2.10+). Single taps are ignored on purpose so a stray touch can't open the mic. A tap followed by a hold is claimed by the OS contextual menu, so use a plain hold.

## How it runs — no server
The Even app hosts this app in a phone WebView, where a Node server can't run — so there is no server. The whole engine runs *inside* the WebView and the phone calls the services itself:

```
glasses mic → app (WebView) ──wss──▶ Deepgram            (speech-to-text)
                           └──https─▶ Google / OpenRouter / Claude   (translation)
                 romaji: local dictionary (kuromoji) · keys: yours, entered in Settings
```
Nothing is hosted, no keys are bundled (a `.ehpk` can be unpacked), and your keys go only to the providers you chose. `app.json` whitelists exactly those domains.

## First-run setup
Until it's set up the glasses show *"Please set up Honyaku in the Even Realities app — Error: Missing API keys"* and the phone opens straight to **SETTINGS**, where a checklist ticks off as you paste:
1. a **Deepgram** key (speech-to-text), and
2. **one** translation key — **Google Translate**, **OpenRouter** or **Claude**.

Each key field has a **? HOW TO GET ONE** panel with step-by-step instructions. **SAVE & TEST** checks each key with its service and runs a sample translation (✓/✗ per step). Pasted only an OpenRouter key? It's picked automatically.

- Keys are stored on the device (Even bridge storage, mirrored to localStorage), hidden behind a SHOW toggle, and removed by emptying the fields and pressing **SAVE**. The version is shown at the bottom of Settings.
- [PRIVACY.md](PRIVACY.md) is the privacy policy for the store listing.
- Google: restrict the key by *API* (Cloud Translation), not by website — the WebView has no fixed origin.

## Development
```bash
npm install
npm run dev          # copies the romaji dictionary to public/dict, starts Vite
npm run simulator    # or: npm run qr  (sideload on real glasses)
npm test             # engine, config, settings, gesture tests
```

## Translation backends
| Provider (Settings → Translation) | What | Cost |
| --- | --- | --- |
| Google | Google Cloud Translation for the text; **romaji is generated locally** (kuromoji + wanakana, `src/core/romaji.ts`) | 500k chars/month free, then $20/1M chars. No LLM. |
| OpenRouter | any OpenRouter model does translation + romaji | per token |
| Claude | Anthropic directly | per token |

Google gives literal, context-free translations; the LLM backends handle tone and conversation context better.

## Packaging for the Even app (private build)
```bash
npm run pack            # build (+ romaji dictionary) + evenhub pack → even-honyaku.ehpk (~17 MB)
```
Upload `even-honyaku.ehpk` under **Private builds** in the dev portal (hub.evenrealities.com) and install it from the Even app: **Even Hub tab → Me → Apps → Private builds → Install**. The package contains no keys; each user enters their own in Settings. The dictionary is only fetched when the Google provider is used.
