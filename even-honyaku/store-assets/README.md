# Store screenshots

`screenshots/` holds the Even Hub product-page screenshots: **576 x 288 RGBA PNGs exported by the simulator's own
screenshot function** (`GET /api/screenshot/glasses`, the glasses framebuffer), unmodified. Even Hub requires screenshots
to be captured this way so they match what the app renders on the glasses. Keep them RGBA: converting to RGB would fuse the
background and the text.

| File | Shows |
|---|---|
| 01-standard-first-launch-paused | The first screen: paused, with how to resume |
| 02-standard-listening | Listening, with what to expect |
| 03-standard-japanese-to-english | Japanese heard: romaji and the English meaning |
| 04-standard-english-to-romaji | The wearer's English as romaji to read aloud |
| 05-standard-conversation | A running conversation |
| 06-predictive-ready | Predictive replies, waiting for the other person |
| 07-predictive-single-reply | A greeting: one suggested reply |
| 08-predictive-choose-a-reply | A decision question: three different replies, one highlighted |
| 09-predictive-highlight-moved | Swiping moves the highlight |
| 10-predictive-hot-or-iced | An either/or question: two replies |
| 11-predictive-reply-read-aloud | The wearer read a reply aloud: it is marked, and not translated back |
| 12-predictive-your-own-english-as-romaji | The wearer answers in their own English: romaji to read |
| 13-predictive-directions | A long answer (directions): one reply |
| 14-glasses-menu | The glasses' own menu (tap, then long press) |

## Regenerating them

The conversations are scripted; no keys are needed. `scripts/screenshots/` serves the production build on port 5173 (where
`npm run simulator` points) with a small harness injected into the page that fakes Deepgram and the model, then
`capture.py` drives the real simulator and saves each screenshot:

```bash
npm run build
DISPLAY=:0 python3 scripts/screenshots/capture.py     # needs the simulator and a display; Python 3 and Node
```

The harness only exists in that served copy of the page. It is not part of the app or the package.
