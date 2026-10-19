# even-honyaku 翻訳

Live English ⇄ Japanese for Even Realities G2.

The glasses mic listens for English and Japanese (Deepgram nova-3). Always-on listening is dual-stream: the same audio goes to a **dedicated Japanese model and a dedicated English model** and the result is arbitrated with a bias towards Japanese — a single multilingual stream tended to start Japanese phrases as English text:

| Heard | Glasses show |
| --- | --- |
| Japanese | English translation (with the romaji of what was said) |
| English | Japanese romaji to read aloud |

**Hold to talk** (phone button) forces English-only for one phrase when you want a clean, deliberate translation to read aloud; releasing drops straight back to always-on listening. Interim transcript is shown live.

Note: always-on listening streams audio to Deepgram for as long as it's on (billed per audio minute). Dual listening uses two streams, so twice the minutes; pause listening when you don't need it. Hold-to-talk on the phone is always English.

## Controls
Listening is **off when the app starts** — turn it on when you want it.

| Where | Gesture | Action |
| --- | --- | --- |
| Glasses | **double tap** | open the menu: **Pause / Resume listening**, **Settings**, **Exit** (the mic closes while paused: nothing is streamed or billed). Double tap again, or wait 12 s, to close it |
| Glasses | swipe | Standard: scroll the feed one translation at a time (up pushes the top one off, down brings one back). Predictive: move the highlight between suggested replies; swipe up past the first one to read earlier turns |
| Glasses | tap | Predictive only: zoom into the highlighted reply (big, nothing else on screen); tap again to go back |
| Phone | Pause / Resume listening button | same as the menu item |
| Phone | **Hold** big button | talk English while held, translate on release (works while paused) |

**Hold (long press) is left alone** — many people bind it to a function of their own in the Even app, and the OS reserves tap-then-long-press for its own menu. Nothing in Honyaku uses it. **Exit** in the menu opens the system exit dialog (answer *No* and everything keeps working).

The menu's **Settings** screen changes Mode (Standard / Predictive replies), reply style (Polite / Casual), how many options are shown, *Ignore my own voice*, and *Kana on glasses*. The glasses redraw the list after each change (a list can't be edited in place), so the highlight returns to the top.

## Predictive Conversation Mode
Switch it on in **Settings → Conversation** (or in the glasses menu). It needs an **OpenRouter or Claude** key: Google Translate can't write replies.

1. The other person speaks Japanese; their words appear in English at the top of the glasses.
2. When they stop talking (about a second of quiet), the assistant suggests what you could say, as short romaji to read aloud:
   - a statement, greeting or thanks gets **one** reply;
   - a decision (yes/no, either/or, how many…) gets **2–3 replies that mean different things**, each with a few English words saying what it means.
3. Earlier turns scroll away on their own so the replies have the whole screen. Swipe to move the `▶` highlight, tap to zoom into one. Read it aloud. If you'd rather say something else, just say it in English as usual and the romaji appears instead.

```
JP: Would you like it hot or iced?
▶ 1 Hot, please
     hotto de onegaishimasu
  2 Iced, please
     aisu de onegaishimasu
  3 Neither, thanks
     kekkou desu
```
Reply style, your level (beginner keeps the words simple and easy to pronounce) and the number of options are in Settings. Short acknowledgements from the other person ("はい", "なるほど") don't trigger a suggestion, and a question that comes more than 10 seconds after the last one starts a new turn.

## Ignoring your own voice
When you read a suggested reply aloud, the glasses mic hears Japanese. Without a filter, Honyaku would translate your own sentence and answer it. **Ignore my own voice** (on by default, **VOICE** tab) tells you apart from the other person with three signals:

| | Signal | Needs |
| --- | --- | --- |
| L0 | **Echo**: what was heard matches a reply Honyaku just suggested, so you are reading it | nothing |
| L1 | **Level**: your voice is much louder at the glasses mic than someone across the table | your voice profile |
| L2 | **Voiceprint**: pitch and spectral envelope compared with how you sound in English and in Japanese | your voice profile |

They are combined into *you* / *them* / *not sure*. *Not sure* is still translated (so you never miss what they said) but no reply is predicted for it. A phrase you read from a suggestion is marked *said* and remembered as part of the conversation, so the next suggestions know what you answered.

**Record your voice profile** (VOICE tab → RECORD MY VOICE): with the glasses on, read 8 preset sentences, 4 English and 4 Japanese (shown in kana, romaji and English). Read the Japanese the way you really say it, accent and all. It takes about a minute. Once you have a profile, holding the phone's talk button and speaking English also refines it quietly over time (nothing is learned if you never recorded one). The profile is stored **on your phone only**; delete it any time.

**Tuning:** the VOICE tab has a **strictness** slider and a **live test** that shows, for what you say, the verdict and the voice/level scores. While you listen normally each phrase is also logged there as `[v91 l84 e0]` (voice, level, echo). Still translating your own Japanese? Raise strictness. Missing what the other person says? Lower it.

> The voiceprint is a classical speech-feature model (MFCC + pitch) that runs in the app with no extra downloads, not a neural speaker-embedding network. Its accuracy on real glasses audio is the thing most worth tuning; see `TESTING.md`.

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

Google gives literal, context-free translations; the LLM backends handle tone and conversation context better. **Predictive replies need OpenRouter or Claude** (one extra short LLM call per question the other person asks; the default OpenRouter model is cheap and fast).

## Packaging for the Even app (private build)
```bash
npm run pack            # build (+ romaji dictionary) + evenhub pack → even-honyaku.ehpk (~17 MB)
```
Upload `even-honyaku.ehpk` under **Private builds** in the dev portal (hub.evenrealities.com) and install it from the Even app: **Even Hub tab → Me → Apps → Private builds → Install**. The package contains no keys; each user enters their own in Settings. The dictionary is only fetched when the Google provider is used.
