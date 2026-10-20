# Honyaku: store listing copy

Name (must equal `app.json` and the glasses header): **Honyaku**

## Short description
Live English and Japanese conversation on your glasses: see what they said in English, and read replies aloud in romaji.

## Description (draft)
Honyaku listens through your glasses and translates in both directions. When the other person speaks Japanese, the English
appears on your glasses. When you speak English, you get the Japanese as romaji to read aloud. Turn on Predictive replies and,
after each thing they say, Honyaku suggests a short reply (or a few different answers when they ask you to choose) that you can
read straight off the display. It ignores your own voice, so what you say is never translated back at you.
You bring your own Deepgram and translation (Google, OpenRouter or Claude) keys; they stay on your phone.

## Release notes (English, 1 to 3 lines each)

**1.1.9**
- OpenRouter now defaults to the fastest model. If a reply is not back after a few seconds the app tries once more, and if that fails it says so instead of waiting forever on "thinking...".

**1.1.8**
- The model list is now three simple choices: Best quality, Fastest, or Lowest cost. Models are asked not to "think" first, which makes replies noticeably quicker, and a model that was retired is replaced automatically.

**1.1.7**
- Predictive replies arrive faster: the first reply appears while the rest are still being written, and the wait after they stop talking is shorter.
- Errors now show a short code and a plain sentence instead of technical text. Settings has a Copy error details button if you need help.

**1.1.6**
- The app package is now tiny: Google Translate users download the romaji dictionary once, after their key is accepted; OpenRouter and Claude users never need it.

**1.1.5**
- Opening the glasses menu no longer interrupts listening mid-sentence, and a refused microphone now says so on the glasses.
- Changing a setting from the glasses menu shows the new value on screen.

**1.1.4**
- Double tap now reliably opens the exit confirmation, even right after the app starts.

**1.1.3**
- Pick the translation model from a short list. Settings save themselves and your API keys are checked as you enter them.

**1.1.0 to 1.1.2 (first of this series)**
- New Predictive replies: after the other person speaks, Honyaku suggests short romaji replies you can read aloud.
- Your own Japanese is no longer translated back; tap pauses or resumes, double tap asks to exit, and the settings are in the glasses' own menu (tap, then long press).

## Screenshots
`store-assets/screenshots/` (14 images, 576 x 288 RGBA, straight from the simulator's screenshot function; see `store-assets/README.md` for what each shows and how to retake them). Suggested order for the product page: 03, 08, 11, 12, 05, 14.

## Assets (portal only)
- Icon: 24 × 24, 1-bit, built from 2 × 2 blocks. Background: greyscale. Screenshots: see above.
- Privacy policy URL: the hosted `PRIVACY.md` (after PR #2 merges: https://github.com/oggunderscore/even-development/blob/master/even-honyaku/PRIVACY.md).
