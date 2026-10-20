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
| Glasses | **tap** | pause / resume listening (the mic closes while paused: nothing is streamed or billed). The tap takes effect about a third of a second later, so a double tap never also toggles it |
| Glasses | **double tap** | exit: opens the system exit confirmation (answer *No* and everything keeps working) |
| Glasses | **tap, then long press** | the glasses' own menu, with Honyaku's items added: **Pause / Resume**, **Mode**, **Replies**, **Options**, **Voice filter**, **Kana** |
| Glasses | swipe | Standard: scroll the feed one translation at a time (up pushes the top one off, down brings one back). Predictive: move the highlight between suggested replies; swipe up past the first one to read earlier turns, down to come back |
| Phone | Pause / Resume listening button | same as a tap on the glasses |
| Phone | **Hold** big button | talk English while held, translate on release (works while paused) |

A plain **hold (long press) is left alone**: many people bind it to a function of their own in the Even app. Honyaku's items live in the glasses' built-in menu (the one with display off and brightness), which the OS raises on tap then long press.

The menu items toggle: Mode (Standard / Predictive), reply style (Polite / Casual), how many options are shown (2 / 3), *Voice filter* (ignore my own voice) and *Kana* on the glasses. The OS can't relabel an item in place, so after a change the page is redrawn with the new labels; reopen the menu to see them.

## Predictive Conversation Mode
Switch it on in **Settings → Conversation** (or in the glasses menu). It needs an **OpenRouter or Claude** key: Google Translate can't write replies.

1. The other person speaks Japanese; their words appear in English at the top of the glasses.
2. When they stop talking (about a second of quiet), the assistant suggests what you could say, as short romaji to read aloud:
   - a statement, greeting or thanks gets **one** reply;
   - a decision (yes/no, either/or, how many…) gets **2–3 replies that mean different things**, each with a few English words saying what it means.
3. Earlier turns scroll away on their own so the replies have the whole screen. Swipe to move the `▶` highlight along the replies. Read one aloud. If you'd rather say something else, just say it in English as usual and the romaji appears instead.

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

They are combined into *you* / *them* / *not sure*. **Without a voice profile only the echo check is available**, so if the other person happens to say exactly a phrase that was just suggested, it can be mistaken for you; recording a profile closes that gap (clearly different voice evidence outvotes the echo match). *Not sure* is still translated (so you never miss what they said) but no reply is predicted for it. A phrase you read from a suggestion is marked *said* and remembered as part of the conversation, so the next suggestions know what you answered.

**Record your voice profile** (VOICE tab → RECORD MY VOICE): with the glasses on, read 8 preset sentences, 4 English and 4 Japanese (shown in kana, romaji and English). Read the Japanese the way you really say it, accent and all. It takes about a minute. Once you have a profile, holding the phone's talk button and speaking English also refines it quietly over time (nothing is learned if you never recorded one). The profile is stored **on your phone only**; delete it any time.

**Tuning:** the VOICE tab has a **strictness** slider and a **live test** that shows, for what you say, the verdict and the voice/level scores. While you listen normally each phrase is also logged there as `[v91 l84 e0]` (voice, level, echo). Still translating your own Japanese? Raise strictness. Missing what the other person says? Lower it.

> The voiceprint is a classical speech-feature model (MFCC + pitch) that runs in the app with no extra downloads, not a neural speaker-embedding network. Its accuracy on real glasses audio is the thing most worth tuning; see `TESTING.md`.

## How it runs — no server
The Even app hosts this app in a phone WebView, where a Node server can't run — so there is no server. The whole engine runs *inside* the WebView and the phone calls the services itself:

```
glasses mic → app (WebView) ──wss──▶ Deepgram            (speech-to-text)
                           └──https─▶ Google / OpenRouter / Claude   (translation)
                 romaji: local dictionary (kuromoji, Google only, downloaded once) · keys: yours, entered in Settings
```
Nothing is hosted, no keys are bundled (a `.ehpk` can be unpacked), and your keys go only to the providers you chose. `app.json` whitelists exactly those domains.

## First-run setup
Until it's set up the glasses show *"Please set up Honyaku in the Even Realities app — Error: Missing API keys"* and the phone opens straight to **SETTINGS**. You need:
1. a **Deepgram** key (speech-to-text), and
2. **one** translation key: **Google Translate**, **OpenRouter** or **Claude**.

Each key field has a **? HOW TO GET ONE** panel with step-by-step instructions. There is no Save button: **everything saves itself**, and **a key is checked as soon as you enter it** (a moment after you stop typing). The answer appears right under the field:
- ✓ *key accepted* (for the translation key this includes a test translation with the model you picked), or
- ✗ with the reason in plain words: the service rejected the key, it can't be reached, the key has the wrong characters, or the key works but the chosen model didn't answer.

Pasted only an OpenRouter key while Google is selected? Honyaku switches to OpenRouter for you. When both keys check out on a first run, the app takes you to the feed.

- Keys are stored on the device (Even bridge storage, mirrored to localStorage), hidden behind a SHOW toggle, and removed by emptying the field. A key that can't be real (wrong characters or length) isn't saved. The version is shown at the bottom of Settings.
- The **? CONTROLS** button at the top of the app opens a guide to every gesture on the glasses and the phone.
- [PRIVACY.md](PRIVACY.md) is the privacy policy for the store listing.
- Google: restrict the key by *API* (Cloud Translation), not by website — the WebView has no fixed origin.

## Development
```bash
npm install
npm run dev          # starts Vite
npm run simulator    # or: npm run qr  (sideload on real glasses)
npm test             # engine, config, settings, gesture tests
```

## Translation backends
| Provider (Settings → Translation) | What | Cost |
| --- | --- | --- |
| Google | Google Cloud Translation for the text; **romaji is generated on the phone** (kuromoji + wanakana, `src/core/romaji.ts`) with a dictionary downloaded once after your key is accepted (see below) | 500k chars/month free, then $20/1M chars. No LLM. |
| OpenRouter | any OpenRouter model does translation + romaji | per token |
| Claude | Anthropic directly | per token |

Google gives literal, context-free translations; the LLM backends handle tone and conversation context better. **Predictive replies need OpenRouter or Claude** (one extra short LLM call per question the other person asks; the default OpenRouter model is cheap and fast).

### The romaji dictionary (Google Translate only)
Google returns Japanese text but no romaji, so Honyaku makes the romaji itself with the kuromoji dictionary (about 18 MB). It is **not in the app package** (which keeps the package far below Even Hub's ~10 MB practical cap, and means OpenRouter and Claude users never carry it). Instead:
1. You enter a Google key; it is checked first.
2. **Only if the key is accepted**, the app downloads the dictionary once from the jsDelivr CDN (`cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/`, a fixed version), with a progress bar under the key field.
3. Each of the twelve files is checked against a SHA-256 fingerprint built into the app, so a damaged or tampered file is rejected and never stored.
4. The files are kept in the phone's browser storage (IndexedDB), so it is a one-time download. If storage is wiped or the app is updated, it is fetched again automatically (after the key is re-checked).
If the download fails (offline, CDN blocked) the field says why and shows **RETRY DOWNLOAD**. Translating never starts a download in the middle of a conversation: without the dictionary the glasses say "The romaji dictionary is not downloaded yet. Open Settings to download it." and the app fetches it. The dictionary files come from the `kuromoji` npm package; `npm run dict:manifest` regenerates their list and hashes (`src/dictionary-manifest.ts`), and a test fails if they ever drift from the installed package.

### Choosing a model
With OpenRouter or Claude you pick the model from a short dropdown (Settings → Translation): **Best quality** (Claude Haiku 5.5, the default), **Fastest** (Gemini 3.1 Flash Lite) or **Lowest cost** (Qwen3.7 Flash). Direct Claude offers Haiku 5.5 (fastest and cheapest) and Sonnet 5.5 (best quality). A phrase costs a fraction of a cent on every one. Models that must reason before answering are left out, and the ones that reason by default are asked not to, because that is where seconds go. These are judgement calls from the model catalog, not benchmarks: run `HONYAKU_LIVE_OPENROUTER_KEY=... npm run test:live` (or `HONYAKU_LIVE_ANTHROPIC_KEY`) to play a whole everyday conversation against the real models and get `live-report.md` with each model's response times and replies. Models that were retired are replaced automatically (Gemini 2.5 Flash Lite, retired 2026-10-20, becomes Gemini 3.1 Flash Lite); a model you chose earlier that is not on the list is kept as "Custom".

| OpenRouter model | $ per 1M tokens (in / out) | Why it is there |
| --- | --- | --- |
| 1. Claude Haiku 5.5 ★ (default) | 0.10 / 0.50 | Best-sounding Japanese and the most reliable replies, at nearly the lowest price |
| 2. Gemini 2.5 Flash Lite | 0.10 / 0.40 | Fastest and cheapest all-rounder, very good Japanese |
| 3. Qwen3 235B | 0.09 / 0.55 | Strong multilingual, very low price, a little slower |
| 4. GPT-4o mini | 0.15 / 0.60 | Dependable and consistent, slightly plainer Japanese |
| 5. Gemini 3.1 Flash Lite | 0.25 / 1.50 | A step up in quality for a few times the cost |
| 6. DeepSeek V3.2 | 0.28 / 0.42 | Good quality, cheap output, response time varies |
| 7. GPT-4.1 mini | 0.40 / 1.60 | Higher quality, costs more for a small gain |
| 8. Llama 3.3 70B | 0.10 / 0.32 | Cheapest decent fallback; weakest Japanese |

The direct **Claude** provider offers Haiku 5.5 (default) and Sonnet 5.5 (about 20 times the cost). The ranking is an editorial judgement, **not a benchmark we ran**; prices are OpenRouter's list prices on 2026-10-19 and will drift. The model check after you choose one proves it answers, so a retired model shows an error instead of failing mid-conversation. A model typed in by an older version stays selectable as "Custom". The list lives in `src/core/models.ts`.

## Packaging for the Even app (private build)
```bash
npm run pack            # build + evenhub pack → even-honyaku.ehpk (well under 1 MB)
```
Upload `even-honyaku.ehpk` under **Private builds** in the dev portal (hub.evenrealities.com) and install it from the Even app: **Even Hub tab → Me → Apps → Private builds → Install**. The package contains no keys; each user enters their own in Settings.

## Errors and speed

- **No waiting forever:** a model call that gets no answer for 3 seconds (no response, or a streamed reply that goes quiet) is abandoned and tried once more; network and server failures are retried once too, while a rejected key or a rate limit is not. If both attempts fail the wearer sees `Replies: too slow (R-TIME)` instead of `thinking...`. A turn that needs no reply (a bare "はい") says so, and as a last resort the glasses clear `thinking...` by themselves after 9 seconds. The key check allows 10 seconds because it may be the first request on a cold connection.

- **Errors:** nothing technical reaches the user. A failure shows a short sentence and a code such as `Replies: something went wrong (R-FORM)`: the letter is the area (T translation, R replies, S speech, K key check, C setup), the word is the cause (NET, AUTH, RATE, SVC, TIME, FORM, EMPTY, MODEL, DECL, DICT, UNK). The details (service, HTTP status, the provider's short error word) go to a memory-only log; Settings -> **Copy error details** copies it for a bug report. Codes live in `src/core/errors.ts`; add new failures there, never `message: err.message`.
- **Replies are plain lines, not JSON:** the model answers `single` or `choice`, then one `meaning | romaji` line per option, so a stray quote can no longer break a reply. The kana is derived from the romaji locally. Translations use `JA:`/`EN:`/`ROMAJI:` lines. Anything unreadable is a `FORM` error.
- **Speed:** replies stream, so the first option is on the glasses while the rest is still being written; the model writes about half as many tokens as before (no Japanese script); in Predictive mode the other person's romaji is not requested; OpenRouter is asked for the lowest-latency provider; the pause before asking is 450 ms. The key check and every REPLY entry show how long the model took. If it still feels slow, choose **Gemini 2.5 Flash Lite** (OpenRouter) or use Claude Haiku directly with an Anthropic key, which skips a network hop.
