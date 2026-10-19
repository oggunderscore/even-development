# Testing the prototype on real G2 glasses

Release candidate 1.1.4 (Predictive Conversation Mode + voice filter): **builds, typechecks and passes unit tests; the menu, the Predictive screen and the Settings list were driven in the Even simulator (0.9.5) with a faked network, and the phone UI was checked in a headless browser. None of it has run on real glasses or with a real voice yet.** Items in sections 3 and 4 are still unverified on a device.

## 1. Run it on your own machine (phone + computer on the same Wi-Fi)

```bash
cd even-honyaku
npm install
npm run dev         # terminal 1 – app dev server (also copies the romaji dictionary to public/dict)
npm run qr          # terminal 2 – prints the QR; scan with "Scan QR" in the Even app
```
There is no server. On first launch the glasses show the setup screen and the phone opens **SETTINGS** — enter your keys there.

Optional first: `npm run simulator` (needs a desktop).

## 2. What to try
- First run: the glasses say *Please set up Honyaku in the Even Realities app / Error: Missing API keys*; the phone shows **SETTINGS** with **? HOW TO GET ONE** help under each key. There is no Save button: paste a key and, a moment after you stop typing, it is saved and checked (✓ under the field, or ✗ with the reason). Try a wrong Deepgram key, a wrong provider key, and a valid key with a model you pick; each should say what is wrong. When both keys are good on a first run the app moves to the feed.
- **? CONTROLS** (top of the app) opens the controls guide; Esc or CLOSE dismisses it.
- The app starts **paused**. **Tap** the glasses (or press the phone's *Resume listening* button) → header says **listening**; tap again to pause. Have someone speak Japanese → English appears; speak English → romaji appears.
- Phone: **hold** the big button and speak English → release → romaji (forced English, ignores language detection).
- Glasses: **tap** = pause/resume listening; **double tap** = the system exit confirmation (*No* must leave everything working; if it ever does not appear, the glasses show "Could not open the exit dialog. Double tap again."); **tap then long press** = the glasses' own menu with our items (Pause / Resume · Mode · Replies · Options · Voice filter · Kana); swipe up/down = scroll the feed one translation pair at a time (up pushes the top pair off until the view is empty and the header says `[cleared]`, down brings one back). Long press is unused. Swipe up = `SCROLL_TOP_EVENT` per the docs; if it feels backwards on the glasses, swap the two in `src/input.ts`.
- No mic handy? Use the text box on the phone UI.

## 2b. Predictive mode and the voice filter — a test script
1. **Settings → Conversation → Predictive replies** (needs an OpenRouter or Claude key). The glasses switch to the Predictive screen.
2. **VOICE → RECORD MY VOICE**: read the 8 sentences with the glasses on. The meter should move while you speak; a too-quiet or too-short read is rejected with a reason. Afterwards the profile says GOOD / OK / WEAK.
3. **VOICE → START TEST**: say a few things in English and in Japanese (ideally reading romaji the way you would in a conversation), then have someone else talk. You want *YOU* for yourself and *SOMEONE ELSE* for them. Adjust **strictness** until both work; note the numbers.
4. Real conversation: have a Japanese speaker ask a yes/no question and an either/or question. Check: the question shows in English, replies appear within ~2 s of them finishing, a statement gets one reply and a decision gets 2–3 different ones. Read one aloud: it should be marked ● and **not** appear as a new translated line.
5. Watch the VOICE tab's log while listening (`[v91 l84 e0]` = voice, level, echo scores) to see why a phrase was or wasn't treated as you.
6. Tap then long press: pick Replies / Options / Voice filter / Kana; the page redraws and reopening the menu shows the new labels. Double tap must show the system exit confirmation.

## 3. Things I could not verify (please report what you see)
1. Real-mic behaviour of the dual listen engine (`src/core/stt.ts`, `arbiter.ts`): is Japanese ever shown as English, or English dropped? Tune `graceMs` / confidence thresholds in `arbiter.ts`. Does background noise produce phantom phrases? (Verified only with macOS `say` audio.)
2. Whether `audioEvent.audioPcm` arrives as bytes, `number[]` or base64 on a real device (handled, but untested).
3. Whether `ws://` to a LAN IP is allowed by the app's network permission for sideloaded dev builds.
4. Quality + latency of the models in the dropdown (`src/core/models.ts`, ranked by judgement and list price, not benchmarked). The default is Claude Haiku 5.5 through OpenRouter, which has not been run live: check it returns clean JSON with `response_format`, and compare it with Gemini 2.5 Flash Lite on real Japanese. Japanese quality and romaji accuracy matter most.
5. Whether the glasses mic sends audio continuously (also during silence) — if not, the app shows *No audio from the mic yet* after 3 seconds of listening.
6. Phone hold button behaviour inside the Even app WebView (pointer events).

## 4. Unverified in 1.1.x (most important first)
1. **Voice-filter accuracy on real glasses audio.** The voiceprint is a classical MFCC + pitch model; unit tests use synthetic voices only. Unknowns: how much louder you are than a person across the table at the G2 mic (L1 assumes a clear gap), how well short or halting read-aloud Japanese separates from the other person's voice, and whether the strictness default (50%) is right. Record some real conversations' worth of verdicts from the VOICE log and tune `voiceScore` / `levelScore` / `verdict` in `src/core/voice.ts`. If a classical model proves too weak, `voiceFeatures()` in `src/core/dsp.ts` is the one function to replace with a neural speaker embedding.
2. Whether the English model's transcript of you reading romaji ever matches the suggested reply closely enough for the echo check (Japanese-model transcripts do).
3. **Kana/kanji on the glasses** (Settings → Kana on glasses): glyph coverage and width (`feed.ts` assumes 27 px) are unverified.
4. Single tap vs. double tap: that a double tap reaches the app as one `DOUBLE_CLICK_EVENT` and never as two taps first (a 350 ms delay on the single tap guards against it, but check on hardware). The contextual menu: that tap-then-long-press raises it on real glasses with all six items untruncated, and that a pick is delivered as `menuItemClickEvent`. (A first review rejected an in-app double-tap menu and an immediate exit: double tap is now the system dialog, `shutDownPageContainer(1)`.)
5. Latency of reply suggestions with your chosen model, and the Predictive screen's 9-row budget with real romaji lengths.

## 5. The `even-honyaku.ehpk` package
`npm run pack` builds the app (plus the 17 MB romaji dictionary) and packs against SDK 0.0.16 (`min_app_version` 2.2.10). No keys are baked in; `app.json` whitelists Deepgram, Google Translate, OpenRouter and Anthropic. Upload it as a private build in the dev portal, install from the Even app, then enter your keys in **SETTINGS**. Unverified on-device: that the app's network whitelist accepts `wss://api.deepgram.com` for the WebSocket (both `wss://` and `https://` origins are listed), and that a ~15 MB upload is accepted. If a direct call fails, the check under the key field in Settings says which step failed and why.
