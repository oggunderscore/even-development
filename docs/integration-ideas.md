# Integration Ideas & Roadmap

G2 glasses are always-on, hands-free, glanceable. Best integrations are ones where pulling out your phone is slow or inconvenient.

---

## High-Value Integration Categories

### 1. AI / LLM Assistants
- **Voice → GPT/Claude** — mic captures voice, transcribe (Whisper/Deepgram), send to LLM, display answer on glasses
- **Perplexity-style search** — ask a question, get a 3-line answer on glass
- **Meeting transcription HUD** — live captions while you're in a meeting
- **Real-time translation** — speak, translate, display on glass

SDK hooks needed: `audioControl`, `textContainerUpgrade`, external STT API

### 2. Notifications & Messaging
- **SMS / iMessage display** — show incoming texts without unlocking phone
- **Email subject line** — quick triage while walking
- **Slack / Teams / Discord alerts** — highlight mentions
- **Calendar next event** — show next 30-min reminder on a dedicated container

Need: push from phone → WebView. Either polling or a backend + phone WebSocket.

### 3. Health & Fitness
- **Heart rate display** — pull from Apple Health / HealthKit
- **Step count HUD** — passive always-on counter
- **Workout mode** — pace, distance, cadence from phone GPS
- **Meditation timer** — breathing guide via scroll input

### 4. Navigation
- **Turn-by-turn directions** — next turn only (fits one line)
- **ETA display** — time remaining to destination
- **POI overlay** — "coffee shop 200m left"

Need: Apple Maps / Google Maps API + location permission

### 5. Productivity
- **Pomodoro timer** — countdown on glass, tap to start/pause
- **Note capture** — double-tap to start recording, auto-transcribe to Notion/Obsidian
- **Teleprompter** — scroll text on glass for presentations/speeches
- **Live code stats** — WakaTime / GitHub commit streak

### 6. Music & Media
- **Now playing** — track name + artist, skip with double-tap
- **Lyrics display** — Genius/Musixmatch sync
- **Podcast chapter display**

### 7. Finance / Crypto / Stocks
- **Portfolio ticker** — rotating watchlist prices
- **Price alerts** — show alert on glass when threshold hit
- **DCA tracker** — current entry vs current price

### 8. Sports & Live Events
- **Score tracker** — NFL/NBA/soccer live scores
- **Fantasy sports** — live player stats during game
- **Race telemetry** — F1 lap times, positions

---

## Architecture Pattern for Integrations

```
External API / Service
       ↓
   Backend proxy (needed for CORS + auth)
       ↓
   WebView fetch (app.json whitelist)
       ↓
   bridge.textContainerUpgrade()
       ↓
   G2 glasses display
```

For real-time (WebSocket) integrations:
```
External WS feed → WebView WS client → bridge.textContainerUpgrade()
```

### app.json for network integrations
```json
{
  "permissions": ["network"],
  "network": {
    "whitelist": ["api.openai.com", "api.anthropic.com", "your-backend.com"]
  }
}
```

---

## Technical Constraints for Integrations

| Constraint | Impact |
|-----------|--------|
| 576×288 display | Max ~8-10 words per line, max 10 lines |
| 4-bit greyscale | No color coding — use spacing/position instead |
| Tap = navigation only | Can't type; input must be pre-structured or voice |
| No persistent connection | Phone must stay on with app foregrounded |
| BLE latency | ~50-200ms — acceptable for notifications, too slow for games |
| No background execution | Need foreground app or iOS background modes via phone |

---

## Recommended First Integration: AI Voice Assistant

**Why:** Uses all 3 unique G2 capabilities (mic, display, input), high wow factor, clear use case.

**Flow:**
1. User double-taps → start recording
2. Mic PCM stream → STT (Deepgram/Whisper live)
3. Transcript → Claude API (or GPT-4o)
4. Response → truncate to 5 lines → `textContainerUpgrade`
5. Single tap → dismiss / next tap → new query

**Dependencies:**
- STT provider (Deepgram real-time WS or OpenAI Whisper)
- LLM API (Claude or GPT)
- Backend to hold API keys (or direct calls with whitelist)

---

## Recommended Second Integration: Notifications HUD

**Why:** Persistent value, works while doing other things.

**Flow:**
1. Poll or WebSocket from a backend that reads iOS shortcuts/push
2. Show notification preview on glass
3. Single tap = dismiss, double-tap = exit

---

## Notes on Audio Pipeline

Audio arrives as `Uint8Array` (16kHz mono PCM) in chunks via `audioEvent.audioPcm`.

For STT, you need to:
1. Buffer chunks until you have enough audio (or silence-detect to segment)
2. Convert PCM to format the STT API expects (WAV header or send raw)
3. Stream to STT WebSocket or batch-send

Deepgram supports raw 16kHz PCM over WebSocket — direct match with G2 output.
