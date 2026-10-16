# Simulator

*Desktop simulator reference - install, run, configure, and drive it from a script via the HTTP automation API.*

Source: https://hub.evenrealities.com/docs/test/simulator

> **Last updated:** 2026-08-29

The simulator (`v0.9.3`) lets you preview layouts and exercise logic without touching hardware. Use it for interactive UI work and for the headless automation flow at the bottom of this page.

0.9.3 tracks SDK 0.0.14: five `textColor` brightness levels, `zOrderIndex` stacking, long press, and your [contextual menu](/docs/build/contextual-menu) drawn the way firmware draws it - navigation, selection events, enter and exit animations. See [Caveats](#caveats) for what still differs from hardware, and the [Changelog](/docs/reference/changelog) for what each release added.

Upgrade with `npm install -g @evenrealities/evenhub-simulator@latest`; check yours with `evenhub-simulator --version`.

> See [Test](/docs/test/) for how the simulator stacks up against local sideload, private builds, and beta builds.

## Not an emulator

The simulator is a Node + LVGL window that mimics how containers, text, and events *look* on the glasses. It is **not** a hardware emulator. Performance, frame pacing, BLE timing, and real-device quirks are not reproduced. Use it for layout, copy, and event logic; anything timing- or performance-sensitive has to be confirmed on real glasses.

## Installation

```bash
npm install -g @evenrealities/evenhub-simulator
```

> **npm:** [@evenrealities/evenhub-simulator](https://www.npmjs.com/package/@evenrealities/evenhub-simulator) - cross-platform (macOS, Linux, Windows)

## Usage

```bash
evenhub-simulator [OPTIONS] [targetUrl]
```

## Options

| Option | Description |
| --- | --- |
| `-c`, `--config <path>` | Path to config file (use `--print-config-path` to see the default) |
| `-g`, `--glow` | Enable glow effect on glasses display |
| `--no-glow` | Disable glow effect (overrides config) |
| `-b`, `--bounce <type>` | Bounce animation type: `default` or `spring` |
| `--automation-port <port>` | Expose the headless control plane on the given port (see below) |
| `--list-audio-input-devices` | List available audio input devices |
| `--aid <device>` | Choose a specific audio input device |
| `--no-aid` | Use default audio device (overrides config) |
| `--print-config-path` | Print the default config file path and exit |
| `--completions <shell>` | Generate shell completions: `bash`, `elvish`, `fish`, `powershell`, `zsh` |
| `-V`, `--version` | Print version |
| `-h`, `--help` | Print help |

## Default config file paths

| Platform | Location |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME` or `$HOME/.config` |
| macOS | `$HOME/Library/Application Support` |
| Windows | `{FOLDERID_RoamingAppData}` (e.g., `C:\Users\<user>\AppData\Roaming`) |

## Audio

`audioEvent` payloads match what the device emits:

- Sample rate: 16,000 Hz
- Format: signed 16-bit little-endian PCM
- 100 ms of data per event (3,200 bytes / 1,600 samples)

## Screenshot (v0.5.0+)

Clicking the screenshot button exports the glasses display as an RGBA PNG to your current working directory, with a timestamp in the filename. The full path is logged to the simulator's stdout and to the glasses web inspector console.

Glow is a post-processing effect only - screenshots are taken from the raw framebuffer, not the glowed render.

## Debugging

Two surfaces cover most simulator debugging: the simulator's own log stream on one side, your app's webview on the other.

**Simulator log stream.** Launch with `RUST_LOG=debug` to see exactly what is being called - each call the simulator receives from your app is logged to stdout as it arrives:

```bash
RUST_LOG=debug evenhub-simulator http://localhost:5173
```

When a container doesn't render or an event doesn't fire, this tells you whether the call ever reached the simulator. Standard `env_logger` filter syntax applies, so `RUST_LOG=trace` and per-module filters work too.

**Inspect the webview.** The simulator's webview window - the one hosting your app's HTML - is inspectable. Right-click it and choose **Inspect Element** for the full web inspector: console, DOM, network, breakpoints. This is where your app-side `console.log` output and uncaught errors land, same as any web page.

Between the two: the debug log shows what the simulator received, the inspector shows what your app did. A call your app makes that never shows up in the debug log never crossed the bridge.

## Caveats

- **Display rendering** isn't pixel-perfect with hardware (font, greyscale levels). Good enough for layout and logic; not for visual QA.
- **List scrolling** - focused-item positioning can differ from real glasses.
- **Image processing** is faster than hardware and doesn't enforce on-device size limits.
- **Image transfer** - the LZ4 compression the SDK applies to `updateImageRawData` (SDK `0.0.12+`) isn't decompressed here; payload bytes are decoded as a normal (uncompressed) image file. Don't rely on the simulator to validate the real hardware's compressed transfer path.
- **Events** - status events aren't emitted (user and device profiles are hardcoded). Inputs in the window: Up, Down, Click, Double Click, and long press (hold the control, or use its keyboard shortcut). The HTTP API drives a narrower set - see [Glasses input](#glasses-input).
- **Text brightness** - `textColor` 0-4 render as five distinct levels, but they are not photometrically matched to the glasses. Use them to check hierarchy, not to sign off on legibility.
- **Contextual menu** - your `menuObject` is drawn, navigable, and returns `menuItemClickEvent` with the `itemID` you declared. It honours the [rebuild contract](/docs/build/contextual-menu#rebuild) - a rebuild that carries `menuObject` reproduces the menu, one that omits it clears your items and leaves the system's. What it cannot tell you is whether the OS on a given firmware build shows the same system slots alongside your items - check that on hardware.
- **Error handling** under abnormal conditions can differ from hardware.

Always validate on real hardware before deployment. If you spot a discrepancy that affects logic, file it in the [Discord](https://discord.gg/Y4jHMCU4sv).

## Headless automation (v0.7.0+)

Simulator `0.7.0+` ships an HTTP control plane. Pass `--automation-port` at launch and you can drive it from CI, a test harness, or any script that speaks HTTP.

```bash
evenhub-simulator http://localhost:5173 --automation-port 9898
# → control plane on http://127.0.0.1:9898
```

Verify it's up:

```bash
curl http://127.0.0.1:9898/api/ping
# pong
```

> This is **automation of the [Simulator](/docs/test/simulator)**. The simulator runs no real hardware, permissions, or background lifecycle, so headless runs **do not replace [Beta Testing](/docs/test/beta-testing)** before submission - see [Testing Modes](/docs/test/) for the full picture.

### When to reach for this

- **Pre-submission checks** - assert the rules from [App Submission & QA Guidelines](/docs/ship/app-submission) (lit pixels in the framebuffer, system exit dialog on root double-tap, no console errors at boot) before uploading a new `.ehpk`.
- **Genesis Day judging automation** - score submissions without manually clicking through every entry.
- **Internal QA harness** - regression-test SDK upgrades by replaying a journey across many apps.
- **CI smoke tests** - run a tiny "did the app even boot" check on every PR.

### Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/ping` | Health check → returns `pong`. |
| `GET /api/screenshot/glasses` | 576×288 **RGBA** PNG of the LVGL framebuffer. Keep RGBA - converting to RGB fuses background and text (both pure green). Use `alpha > 0` as the lit-pixel test. |
| `GET /api/screenshot/webview` | PNG of the host webview, captured via `html2canvas` (10 s timeout). |
| `GET /api/console[?since_id=N]` | Returns `{ entries, total }`. Captures `console.`*, uncaught exceptions, unhandled rejections, and failed `fetch` calls. Use `since_id` for incremental polling. |
| `DELETE /api/console` | Clears the buffer. Read startup logs **before** clearing - they are emitted once and lost if you clear too early. |
| `POST /api/input` body: `{ "action": "up|down|click|double_click|long_press|long_press_release|context_menu" }` | Drives the touchpad. Silently ignored if no event-capturing container is active. Allow ~4 s after launch (SDK init + `createStartUpPageContainer`) before sending input. See [Glasses input](#glasses-input) for the full action set. |

### Glasses input

`POST /api/input` takes exactly seven actions. Anything else is a `400` with the accepted list in the body:

```
invalid action 'bogus_action', expected: up, down, click, double_click, long_press, long_press_release, context_menu
```

| Action | Effect |
| --- | --- |
| `up` / `down` | Move focus through list items or scroll text |
| `click` | Select the focused item |
| `double_click` | System double-tap - normally back, dismiss, or the exit dialog on a root page |
| `context_menu` | Raise the [contextual menu](/docs/build/contextual-menu) (v0.9.0+) |
| `long_press` | Begin a long press - delivers `LONG_PRESS_EVENT` (v0.9.1+) |
| `long_press_release` | End that press - delivers `LONG_PRESS_RELEASE_EVENT` (v0.9.1+) |

**Driving the contextual menu.** `context_menu` toggles: it opens the menu when closed and closes it when open. `up` / `down` move focus inside it, and `click` selects - your app receives `menuItemClickEvent` carrying the `itemID` you declared, and the menu closes. The whole path is scriptable:

```bash
curl -X POST http://127.0.0.1:9898/api/input -H 'Content-Type: application/json' -d '{"action":"context_menu"}'
curl -X POST http://127.0.0.1:9898/api/input -H 'Content-Type: application/json' -d '{"action":"down"}'
curl -X POST http://127.0.0.1:9898/api/input -H 'Content-Type: application/json' -d '{"action":"click"}'
# app receives menuItemClickEvent for the second item
```

Assert on the framebuffer rather than on timing: opening the menu is a large lit-pixel jump, moving focus within it is a small one.

Two things that will bite a script. `context_menu` toggling means a blind second send closes the menu instead of reopening it - track the state or assert the framebuffer between sends. And a `rebuildPageContainer` underneath an open menu does not dismiss it: the overlay stays up, so a screenshot taken after a rebuild can still be showing the old menu.

**Driving a long press.** `long_press` opens the press and `long_press_release` ends it (simulator `0.9.1+`); your app sees `LONG_PRESS_EVENT` then `LONG_PRESS_RELEASE_EVENT` the same way it would on hardware. Send them as a pair - a `long_press` with no release leaves the press open. Without those actions, driving the raw press needs the simulator window (hold the control, or its keyboard shortcut) or real hardware.

Note that `context_menu` is a shortcut to the menu itself, not to the tap then long press that raises it. If your app handles the raw press, drive it with `long_press`; if you want the OS menu, use `context_menu`.

### The end-to-end loop

The shape of every test is the same:

1. **Boot** the simulator pointing at your dev server (or an `.ehpk` URL).
2. **Wait for ready.** The simulator silently drops input until your first event-capturing container exists, so poll `GET /api/console` for an "app ready" log line (or your own readiness signal). Allow ~4 s minimum after launch.
3. **Snapshot the state** - `GET /api/screenshot/glasses` for the framebuffer, `GET /api/console` for log entries.
4. **Send input** - `POST /api/input` with `{ "action": "click" | "double_click" | "up" | "down" | "context_menu" | "long_press" | "long_press_release" }`.
5. **Snapshot again and assert.**

Unverified snippets

The endpoints and actions above were exercised against simulator `0.9.3`. The two snippets below were not run verbatim - treat them as templates and confirm against your own install before relying on them in CI.

```python
import time
import io
import sys
from urllib.request import Request, urlopen
import json
from PIL import Image

BASE = "http://127.0.0.1:9898"
READY_MARKER = "[my-app] ready"  # whatever your app logs once mounted
TIMEOUT_S = 30


def get_json(path: str):
    with urlopen(f"{BASE}{path}") as r:
        return json.loads(r.read())


def get_png(path: str) -> Image.Image:
    with urlopen(f"{BASE}{path}") as r:
        return Image.open(io.BytesIO(r.read()))


def post_json(path: str, body: dict):
    req = Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(req) as r:
        return r.read()


def wait_for_ready(timeout: float = TIMEOUT_S):
    """Poll the console buffer until the app prints its ready marker."""
    deadline = time.time() + timeout
    since_id = 0
    while time.time() < deadline:
        data = get_json(f"/api/console?since_id={since_id}")
        for entry in data.get("entries", []):
            since_id = max(since_id, entry["id"])
            if READY_MARKER in entry.get("message", ""):
                return
        time.sleep(0.25)
    raise TimeoutError(f"App did not log {READY_MARKER!r} within {timeout}s")


def lit_pixel_count(img: Image.Image) -> int:
    """LVGL framebuffer is RGBA; treat any pixel with alpha > 0 as lit."""
    assert img.mode == "RGBA", f"expected RGBA, got {img.mode}"
    return sum(1 for px in img.getdata() if px[3] > 0)


def main() -> int:
    assert get_json("/api/ping") in ("pong", {"message": "pong"}), "simulator not up"
    wait_for_ready()

    boot = get_png("/api/screenshot/glasses")
    assert lit_pixel_count(boot) > 100, "framebuffer is blank after ready"

    post_json("/api/input", {"action": "double_click"})
    time.sleep(0.5)  # let the dialog render

    after = get_png("/api/screenshot/glasses")
    delta = abs(lit_pixel_count(after) - lit_pixel_count(boot))
    assert delta > 50, "framebuffer did not change after double_click - exit dialog missing?"

    print("OK - app booted, rendered, and produced an exit dialog on double-tap")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

```typescript
const BASE = 'http://127.0.0.1:9898'
const READY_MARKER = '[my-app] ready'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

async function getPng(path: string): Promise<Uint8Array> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function postJson(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
}

interface ConsoleEntry { id: number; message: string }
interface ConsoleResponse { entries: ConsoleEntry[]; total: number }

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let sinceId = 0
  while (Date.now() < deadline) {
    const data = await getJson<ConsoleResponse>(`/api/console?since_id=${sinceId}`)
    for (const entry of data.entries) {
      sinceId = Math.max(sinceId, entry.id)
      if (entry.message.includes(READY_MARKER)) return
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`App did not log "${READY_MARKER}" within ${timeoutMs}ms`)
}

async function main(): Promise<void> {
  await getJson('/api/ping')
  await waitForReady()

  const boot = await getPng('/api/screenshot/glasses')
  if (boot.byteLength < 1000) throw new Error('framebuffer is suspiciously small')

  await postJson('/api/input', { action: 'double_click' })
  await new Promise(r => setTimeout(r, 500))

  const after = await getPng('/api/screenshot/glasses')
  if (Math.abs(after.byteLength - boot.byteLength) < 100) {
    throw new Error('framebuffer did not change after double_click - exit dialog missing?')
  }

  console.log('OK - app booted, rendered, and produced an exit dialog on double-tap')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

TIP

The Node example uses byte-length deltas as a coarse "did anything change" check. For real assertions, decode the PNG (e.g. with [`sharp`](https://www.npmjs.com/package/sharp)) and use the same `alpha > 0` lit-pixel rule as the Python example.

### Patterns and pitfalls

**Read startup logs before clearing.** Boot logs - SDK init, manifest load, first `createStartUpPageContainer` result - are emitted exactly once. Poll for the ready marker first, then clear the buffer.

**Use `since_id` for incremental polling.** Re-reading the whole console buffer on every tick wastes work and risks double-handling. Track the highest `id` you've seen and pass it back as `?since_id=N`.

**Keep screenshots in RGBA.** `/api/screenshot/glasses` returns RGBA on purpose. The Even G2 framebuffer renders both background and foreground in pure green; collapsing to RGB fuses them and the lit-pixel check stops working. Test with `pixel.alpha > 0`, not RGB deltas.

**Brightness lives in the alpha channel.** RGB stays `0,255,0` for every lit pixel - the five `textColor` levels come back as five distinct alpha values, dimmest to brightest. To assert a container renders at the level you set, sample its region and compare alpha, not colour.

**Wait for input capture.** Posting input before `createStartUpPageContainer` runs is silently dropped - no error. Wait for your readiness signal first. Roughly 4 s after launch is a reasonable lower bound, but keying off a log line beats sleeping.

**Cleaning up.** The control plane has no `shutdown` endpoint - kill the simulator process when you're done. In CI, wrap the launch in a child-process supervisor you can `SIGTERM` from your test runner's `afterAll` hook.

## Related

- [Testing Modes](/docs/test/) - when to use the simulator vs hardware modes
- [App Submission & QA Guidelines](/docs/ship/app-submission) - what to assert in headless tests
- [Page Lifecycle](/docs/build/page-lifecycle) - events you can use as readiness / exit signals
