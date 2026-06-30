import {
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

import { FlipperClient } from './flipper-client.ts'
import { RenderQueue, encodeFramePng } from './render.ts'
import { startInputRouting } from './input.ts'
import { matchFrame, type FrameMatch } from './glyph-match.ts'
import { getTextWidth } from '@evenrealities/pretext'

const BRIDGE_URL =
  (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? 'ws://127.0.0.1:9876/ws'

type Mode = 'text' | 'image'
const MODE_KEY = 'flipperMode'

// Image-mode size = latency knob: glasses-side transfer is ~pixel-linear
// (~0.1ms/px on real hardware), so 128x64 ≈ 1.1s/frame while 288x144 ≈ 4s.
type ImgSize = { key: string; w: number; h: number; label: string }
const IMG_SIZES: ImgSize[] = [
  { key: 'fast', w: 128, h: 64, label: 'Fast (128×64, ~1s)' },
  { key: 'medium', w: 200, h: 100, label: 'Medium (200×100, ~2s)' },
  { key: 'large', w: 288, h: 144, label: 'Large (288×144, ~4s)' },
]
const SIZE_KEY = 'flipperImgSize'

// No webapp-side pacing: the bridge's burst policy (settle + keyframe) governs
// the sustained frame rate, and padding the ack here only delays the credit -
// which delays the settle-flushed final frame the user is waiting for.

// Container IDs. Capture is id 2 in both modes. Mode-specific content uses id 1
// (image OR text screen) and id 3 (text-mode controls legend).
const MAIN_ID = 1
const CAPTURE_ID = 2
const CONTROLS_ID = 3
const SCREEN_NAME = 'screen'
const IMG_NAME = 'flipper'
const CONTROLS_NAME = 'controls'

const SCREEN_W = 576
const SPACE_W = getTextWidth(' ') || 5

/** Center a line within `width` px via leading spaces (G2 text is left-aligned only). */
function center(text: string, width = SCREEN_W): string {
  const pad = Math.max(0, Math.round((width - getTextWidth(text)) / 2 / SPACE_W))
  return ' '.repeat(pad) + text
}

/** Recovered Flipper lines, LEFT-aligned, '→' marks the selected line. */
function formatMatch(m: FrameMatch): string {
  if (m.lines.length === 0) return '  (no signal)'
  return m.lines.map((l) => (l.highlighted ? '→ ' : '  ') + l.text).join('\n')
}

// Bottom controls legend (gesture -> Flipper button; see input.ts), centered to
// the controls box inner width.
const CONTROLS_INNER = 544 - 2 * (6 + 2)
const CONTROLS = ['↑ scroll  Up      ↓ scroll  Down', 'tap  OK      double-tap  Back']
  .map((l) => center(l, CONTROLS_INNER))
  .join('\n')

// --- container layouts ---

function captureContainer(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    containerID: CAPTURE_ID, containerName: 'gestures', content: ' ', isEventCapture: 1,
  })
}

function textLayout(): { containerTotalNum: number; textObject: TextContainerProperty[] } {
  // Boxed screen (top) + boxed controls (bottom). Border draws inside; padding
  // insets the text so it doesn't touch the border.
  const screen = new TextContainerProperty({
    xPosition: 16, yPosition: 4, width: 544, height: 196,
    borderWidth: 2, borderColor: 10, borderRadius: 6, paddingLength: 6,
    containerID: MAIN_ID, containerName: SCREEN_NAME, content: '  connecting…',
  })
  const controls = new TextContainerProperty({
    xPosition: 16, yPosition: 212, width: 544, height: 70,
    borderWidth: 2, borderColor: 10, borderRadius: 6, paddingLength: 6,
    containerID: CONTROLS_ID, containerName: CONTROLS_NAME, content: CONTROLS,
  })
  return { containerTotalNum: 3, textObject: [captureContainer(), screen, controls] }
}

function imageLayout(size: ImgSize): {
  containerTotalNum: number
  textObject: TextContainerProperty[]
  imageObject: ImageContainerProperty[]
} {
  // Mirror image at the selected size, centered in the 576x288 canvas.
  const image = new ImageContainerProperty({
    xPosition: Math.round((576 - size.w) / 2),
    yPosition: Math.round((288 - size.h) / 2),
    width: size.w, height: size.h,
    containerID: MAIN_ID, containerName: IMG_NAME,
  })
  return { containerTotalNum: 2, textObject: [captureContainer()], imageObject: [image] }
}

// --- DOM config / stats panel (shown in the Even app webview) ---

const app = document.querySelector<HTMLDivElement>('#app')
if (app) {
  app.innerHTML = `
    <main id="status">
      <h1>Flipper Mirror</h1>
      <p>Display mode:
        <button id="mode-text" type="button">Text</button>
        <button id="mode-image" type="button">Image</button>
      </p>
      <p id="size-row">Image size (latency tradeoff):
        ${IMG_SIZES.map((s) => `<button id="size-${s.key}" type="button">${s.label}</button>`).join(' ')}
      </p>
      <p>bridge: <code id="bridge-url"></code></p>
      <p>status: <span id="state">init</span></p>
      <p>frames received: <span id="frames-recv">0</span></p>
      <p>
        <button id="latency-test" type="button">Start display-latency test</button>
        <span id="latency-info"></span>
      </p>
      <p id="info"></p>
    </main>`
  document.getElementById('bridge-url')!.textContent = BRIDGE_URL
}
const $ = (id: string) => document.getElementById(id)
const stateEl = $('state')
const infoEl = $('info')
const framesRecvEl = $('frames-recv')
const btnText = $('mode-text') as HTMLButtonElement | null
const btnImage = $('mode-image') as HTMLButtonElement | null
const btnLatency = $('latency-test') as HTMLButtonElement | null
const latencyInfoEl = $('latency-info')

function markActiveMode(mode: Mode) {
  if (btnText) btnText.style.fontWeight = mode === 'text' ? 'bold' : 'normal'
  if (btnImage) btnImage.style.fontWeight = mode === 'image' ? 'bold' : 'normal'
  const row = $('size-row')
  if (row) row.style.opacity = mode === 'image' ? '1' : '0.4'
}

function markActiveSize(size: ImgSize) {
  for (const s of IMG_SIZES) {
    const b = $(`size-${s.key}`) as HTMLButtonElement | null
    if (b) b.style.fontWeight = s.key === size.key ? 'bold' : 'normal'
  }
}

async function boot(): Promise<void> {
  const bridge = await waitForEvenAppBridge()
  const client = new FlipperClient(BRIDGE_URL)

  let mode: Mode = ((await bridge.getLocalStorage(MODE_KEY).catch(() => '')) as Mode) || 'text'
  const sizeKey = await bridge.getLocalStorage(SIZE_KEY).catch(() => '')
  let imgSize: ImgSize = IMG_SIZES.find((s) => s.key === sizeKey) ?? IMG_SIZES[0]
  let queue: RenderQueue | null = null
  let started = false

  // Tracks the SCREEN text container's current content so both the live frame
  // renderer and the status overlay dedup against the SAME value - otherwise a
  // status banner and a Flipper line could ping-pong, or a redundant write
  // could land. Last writer (frame or status) wins.
  let lastScreenText = ''
  async function setScreenText(content: string): Promise<void> {
    if (content === lastScreenText) return
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: MAIN_ID, containerName: SCREEN_NAME, content }),
    )
    lastScreenText = content
  }

  // --- connection status shown ON THE GLASSES (not just the webview panel) ---

  /** Human-readable status lines for the glasses, by connection state. */
  function statusLines(state: string, info?: string): string[] {
    const trim = (s?: string) => (s && s.trim() ? s.trim() : '')
    switch (state) {
      case 'scanning':
        return ['Connecting to Flipper…', trim(info) || 'searching for the bridge']
      case 'reconnecting':
        return ['Reconnecting…', trim(info)]
      case 'disconnected':
        return ['Disconnected', trim(info), client.reconnectInfo() || 'retrying…']
      default:
        return [state, trim(info)]
    }
  }

  /** Draw a status banner into the image container (used when no frames flow). */
  async function pushImageStatus(lines: string[]): Promise<void> {
    const size = imgSize
    const c = new OffscreenCanvas(size.w, size.h)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.w, size.h)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const fontPx = Math.max(10, Math.round(size.h / (lines.length + 2)))
    ctx.font = `bold ${fontPx}px monospace`
    const lh = fontPx * 1.3
    const startY = size.h / 2 - ((lines.length - 1) * lh) / 2
    lines.forEach((l, i) => ctx.fillText(l, size.w / 2, startY + i * lh))
    const blob = await c.convertToBlob({ type: 'image/png' })
    const png = new Uint8Array(await blob.arrayBuffer())
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: MAIN_ID, containerName: IMG_NAME, imageData: png }),
    )
  }

  /**
   * Surface the connection state on the glasses display itself, so a dropped
   * link shows "Disconnected / retrying…" instead of silently leaving the last
   * Flipper frame frozen on-screen.
   *
   * On 'connected' we deliberately draw NOTHING and just clear the render
   * dedup. Two reasons: (1) the first live frame is imminent and a "connected"
   * banner would race that frame's container write - whichever resolved last
   * would win, sometimes stranding the banner on-screen; (2) a static Flipper
   * screen hashes identically across a reconnect, so without resetDedup the
   * first post-reconnect frame is suppressed and the user stays stuck on the
   * previous status. Leaving the 'Connecting…' banner up until the frame lands
   * is both race-free and accurate.
   */
  async function showGlassesStatus(state: string, info?: string): Promise<void> {
    queue?.resetDedup()
    if (state === 'connected') return
    const lines = statusLines(state, info).filter((l) => l.length > 0)
    if (mode === 'text') {
      await setScreenText(lines.map((l) => '  ' + l).join('\n'))
    } else {
      await pushImageStatus(lines)
    }
  }

  /**
   * Honest "connected but no screen data yet" banner. Only the connected-grace
   * timer calls this, and only when no frame has arrived - so it never collides
   * with live frames. If it shows and stays, the link is up but the bridge is
   * not delivering frames (BLE/stream side), which is the useful diagnostic.
   */
  async function showWaitingForScreen(): Promise<void> {
    const lines = ['Connected', 'waiting for Flipper screen…']
    if (mode === 'text') {
      await setScreenText(lines.map((l) => '  ' + l).join('\n'))
    } else {
      await pushImageStatus(lines)
    }
  }

  function makeImageQueue(): RenderQueue {
    const size = imgSize
    return new RenderQueue(async (raw) => {
      const png = await encodeFramePng(raw, size.w, size.h)
      await bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: MAIN_ID, containerName: IMG_NAME, imageData: png }),
      )
      client.sendReady()
    }, 0)
  }

  function makeTextQueue(): RenderQueue {
    return new RenderQueue(async (raw) => {
      // Text-level dedup lives in setScreenText now (shared with the status
      // overlay): pixel changes (cursor blink, animations) often recover to
      // IDENTICAL text, and setScreenText skips the container round-trip in
      // that case. We always ack to keep the credit loop flowing.
      await setScreenText(formatMatch(matchFrame(raw)))
      client.sendReady()
    }, 0)
  }

  async function applyMode(next: Mode): Promise<void> {
    mode = next
    void bridge.setLocalStorage(MODE_KEY, mode).catch(() => {})
    const layout = mode === 'image' ? imageLayout(imgSize) : textLayout()
    if (!started) {
      await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(layout))
      started = true
    } else {
      await bridge.rebuildPageContainer(new RebuildPageContainer(layout))
    }
    queue = mode === 'image' ? makeImageQueue() : makeTextQueue()
    markActiveMode(mode)
    markActiveSize(imgSize)
    if (infoEl) infoEl.textContent = mode === 'image' ? `mode: image ${imgSize.w}×${imgSize.h}` : 'mode: text'
    // Re-prime the bridge: a static Flipper screen hashes identically forever,
    // so after a layout rebuild the dedup would suppress every frame and the
    // fresh container would sit on its placeholder. 'connect' makes the bridge
    // clear its dedup hash + grant a credit, so the next streamed frame (the
    // Flipper streams continuously, even when static) renders immediately.
    client.connect()
  }

  await applyMode(mode)

  // --- display-latency test ---
  // Pushes a frame with a big incrementing number every 2s, ignoring promise
  // timing entirely. Read the number on the GLASSES and compare with the live
  // "sent #N" in this panel: latency = (panel N - glasses N) x 2s. This
  // measures the true Even-app -> glasses display pipeline, which promise
  // resolution may not reflect. Live Flipper frames are paused while testing.
  let testing = false
  let testTimer: ReturnType<typeof setInterval> | null = null
  let testN = 0
  let testBusy = false
  let testSkipped = 0

  async function pushTestFrame(n: number): Promise<void> {
    const size = imgSize
    const c = new OffscreenCanvas(size.w, size.h)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.w, size.h)
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.round(size.h * 0.8)}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(n), size.w / 2, size.h / 2)
    const blob = await c.convertToBlob({ type: 'image/png' })
    const png = new Uint8Array(await blob.arrayBuffer())
    await bridge.updateImageRawData(
      new ImageRawDataUpdate({ containerID: MAIN_ID, containerName: IMG_NAME, imageData: png }),
    )
  }

  function stopLatencyTest(): void {
    testing = false
    if (testTimer != null) clearInterval(testTimer)
    testTimer = null
    if (btnLatency) btnLatency.textContent = 'Start display-latency test'
    if (latencyInfoEl) latencyInfoEl.textContent = ''
    // Re-prime the live mirror (bridge clears dedup + grants credit).
    client.connect()
  }

  btnLatency?.addEventListener('click', () => {
    if (testing) {
      stopLatencyTest()
      return
    }
    if (mode !== 'image') {
      if (latencyInfoEl) latencyInfoEl.textContent = 'switch to Image mode first'
      return
    }
    testing = true
    testN = 0
    testSkipped = 0
    if (btnLatency) btnLatency.textContent = 'Stop test'
    testTimer = setInterval(() => {
      if (testBusy) {
        // Previous push's promise still pending after 2s - itself a data point.
        testSkipped++
        if (latencyInfoEl) latencyInfoEl.textContent = `sent #${testN} (slow: ${testSkipped} ticks with promise pending)`
        return
      }
      testN++
      testBusy = true
      const n = testN
      if (latencyInfoEl) latencyInfoEl.textContent = `sent #${n}${testSkipped ? ` (${testSkipped} slow ticks)` : ''} - read the number on the glasses`
      pushTestFrame(n)
        .catch((err) => console.warn('test frame failed:', err))
        .finally(() => {
          testBusy = false
        })
    }, 2000)
  })

  // Frame-arrival tracking. framesRecv is a diagnostic shown in the Even-app
  // panel: if the glasses sit on "Connecting…" but this stays 0, frames aren't
  // reaching the webapp at all (a bridge/BLE problem, not a render problem).
  let framesRecv = 0
  let frameSeenThisLink = false
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  const clearWait = () => {
    if (waitTimer != null) {
      clearTimeout(waitTimer)
      waitTimer = null
    }
  }

  client.onStatus((msg) => {
    if (stateEl) stateEl.textContent = msg.state + (msg.info ? ` (${msg.info})` : '')
    if (testing) return // latency test owns the display
    if (msg.state === 'connected') {
      // resetDedup + draw nothing now (the live frame will take over). If no
      // frame arrives within a short grace period, surface an honest "Connected
      // — waiting for Flipper screen…" so the user isn't left staring at a
      // misleading "Connecting…". This timer is cancelled the instant a frame
      // lands, so it never races or strands over real content.
      void showGlassesStatus('connected', msg.info).catch((e) => console.warn('status draw:', e))
      clearWait()
      if (!frameSeenThisLink) {
        waitTimer = setTimeout(() => {
          waitTimer = null
          if (!frameSeenThisLink) void showWaitingForScreen().catch(() => {})
        }, 2500)
      }
    } else {
      // A new connection cycle begins; expect a fresh first frame.
      frameSeenThisLink = false
      clearWait()
      void showGlassesStatus(msg.state, msg.info).catch((e) => console.warn('status draw:', e))
    }
  })
  client.onFrame((frame, seq) => {
    framesRecv++
    if (framesRecvEl) framesRecvEl.textContent = String(framesRecv)
    frameSeenThisLink = true
    clearWait()
    if (testing) return // latency test owns the display
    queue?.submit(frame, seq)
  })

  // The fix for the frozen "connecting…" on app return: the backgrounded
  // WebView's socket is usually dead (timers frozen, OS killed it without an
  // onclose), so on resume force a fresh connection and show a banner at once
  // instead of waiting on a stuck backoff timer.
  let lastForegroundMs = 0
  function onForeground(): void {
    // Debounce: the SDK lifecycle event and the DOM visibilitychange fallback
    // can both fire on a single resume.
    const now = performance.now()
    if (now - lastForegroundMs < 1000) return
    lastForegroundMs = now
    if (stateEl) stateEl.textContent = 'reconnecting (app resumed)'
    void showGlassesStatus('reconnecting', 'app resumed').catch(() => {})
    client.reconnectNow()
  }

  startInputRouting(
    bridge,
    (key, action) => client.sendButton(key, action),
    (life) => {
      if (life === 'foreground') {
        onForeground()
      } else if (life === 'exit') {
        client.stop()
      }
      // 'background': the host keeps a headless WebView pushing frames, so
      // there's nothing to tear down here.
    },
  )

  // Fallback path: if the host doesn't deliver the SDK foreground event to the
  // WebView (only pauses/resumes the page), the browser visibility API still
  // fires. Either route triggers the same reconnect.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') onForeground()
  })

  btnText?.addEventListener('click', () => { if (mode !== 'text') void applyMode('text') })
  btnImage?.addEventListener('click', () => { if (mode !== 'image') void applyMode('image') })
  for (const s of IMG_SIZES) {
    $(`size-${s.key}`)?.addEventListener('click', () => {
      if (imgSize.key === s.key) return
      imgSize = s
      void bridge.setLocalStorage(SIZE_KEY, s.key).catch(() => {})
      markActiveSize(s)
      // Rebuild only if image mode is showing; in text mode the new size just
      // takes effect on the next switch to image.
      if (mode === 'image') void applyMode('image')
    })
  }

  client.start()
}

boot().catch((err) => {
  console.error('Flipper mirror boot failed:', err)
  if (infoEl) infoEl.textContent = `boot error: ${String(err)}`
})
