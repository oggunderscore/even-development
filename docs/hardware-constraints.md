# Even Realities G2 — Hardware Constraints

## Display

| Property | Value |
|----------|-------|
| Resolution | 576 × 288 px per eye |
| Color depth | 4-bit greyscale (16 shades of green) |
| Max text lines | 10 across the entire display |
| Max containers | 12 total (8 text + 4 image) |
| Image tile size | Max 288 × 144 px |
| Text alignment | Left-aligned only (no center/right) |
| Font control | Fixed size — no font size API |

Images are auto-converted to 4-bit greyscale by the SDK.

## Coordinate System

Origin (0, 0) is the **top-left** corner. X increases right, Y increases down.

```
(0,0) ─────────────────────────── (576,0)
  │                                    │
  │          576 × 288 canvas          │
  │                                    │
(0,288) ────────────────────────(576,288)
```

## Typical Layout Budget (4-container HUD)

```
[0,0  180×60  direction]    ·    [396,0  180×60  speed limit]
[0,68  576×180  speed — large]
[0,252  576×36  location strip]
```

## Audio

| Property | Value |
|----------|-------|
| Microphone | 4-mic array |
| Sample rate | 16 kHz mono PCM |
| Access | `bridge.audioControl(true)` → PCM chunks via `event.audioEvent.audioPcm` |

Requires `"microphone"` in `app.json` permissions.

## Input

| Input | Events |
|-------|--------|
| Temple touchpad | tap, double-tap, swipe up, swipe down |
| R1 ring (optional) | same event types |

Events arrive via `bridge.onEvenHubEvent()`. See `sdk-reference.md` for full event routing.

**Critical quirk:** `CLICK_EVENT = 0` — Protobuf omits zero-value fields on the wire, so tap events arrive with `event.textEvent?.eventType` as `undefined`. Always coerce: `?? 0`.

## Connectivity

| Property | Value |
|----------|-------|
| Protocol | BLE 5.2 |
| Paired via | Even Realities iPhone companion app |
| App execution | WebView in iPhone app; glasses = remote display |
| Camera | None (privacy by design) |
| Speaker | None |

## Permissions (`app.json`)

| Permission | Grants |
|------------|--------|
| `"microphone"` | Access to glasses mic PCM stream |
| `"network"` | Outbound HTTP/WebSocket (see `network.whitelist`) |
| `"location"` | Geolocation API in WebView (inherits iOS app's location grant) |

```json
{
  "permissions": ["network", "location"],
  "network": {
    "whitelist": ["nominatim.openstreetmap.org", "overpass-api.de"]
  }
}
```
