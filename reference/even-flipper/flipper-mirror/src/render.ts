/**
 * Frame rendering for the Flipper screen.
 *
 * Flipper Zero screen is 128x64 1bpp, row-major, MSB-first within each byte.
 * The G2 image container is 256x128. The SDK's updateImageRawData expects an
 * ENCODED image (PNG); the device side converts it to gray4 internally (see
 * ImageRawDataUpdateResult.imageToGray4Failed). Sending raw pixel bytes fails
 * with "image format could not be determined".
 */

import { ImageRawDataUpdate, type EvenAppBridge } from '@evenrealities/even_hub_sdk'

export const SRC_W = 128
export const SRC_H = 64
// Destination image size, env-configurable for the latency diagnostic. The
// glasses' updateImageRawData cost scales with pixel count (decode + gray4 +
// BLE), so we test native 128x64 (default) against larger sizes to find out
// whether the slowness is payload-bound (shrinking helps ~linearly) or fixed
// per-call round-trip latency (size irrelevant). The firmware container max is
// 288x144 (200x100 in the older display guide). Set VITE_IMG_W / VITE_IMG_H at
// build time to compare. Nearest-neighbor scaled via drawImage, smoothing off.
export const DST_W = Number(import.meta.env.VITE_IMG_W ?? 288)
export const DST_H = Number(import.meta.env.VITE_IMG_H ?? 144)

/** RGBA ImageData at source 128x64 resolution. */
function frame1bppToRgbaNative(src: Uint8Array): Uint8ClampedArray {
  const expected = (SRC_W * SRC_H) / 8
  if (src.length !== expected) {
    throw new Error(`frame1bppToRgbaNative: src length ${src.length} != ${expected}`)
  }
  const out = new Uint8ClampedArray(SRC_W * SRC_H * 4)
  const srcRowBytes = SRC_W / 8
  for (let sy = 0; sy < SRC_H; sy++) {
    for (let sx = 0; sx < SRC_W; sx++) {
      const byte = src[sy * srcRowBytes + (sx >> 3)]
      const v = ((byte >> (7 - (sx & 7))) & 1) ? 255 : 0
      const o = (sy * SRC_W + sx) * 4
      out[o] = v
      out[o + 1] = v
      out[o + 2] = v
      out[o + 3] = 255
    }
  }
  return out
}

let _srcCanvas: OffscreenCanvas | null = null

/** Encode a 1bpp Flipper frame as a dstW x dstH PNG, nearest-neighbor upscaled.
 * Glasses-side cost is ~pixel-linear (~0.1ms/px measured on real hardware), so
 * dst size IS the image-mode latency knob: 128x64 ~1.1s, 288x144 ~4s. */
export async function encodeFramePng(
  src: Uint8Array,
  dstW = DST_W,
  dstH = DST_H,
): Promise<Uint8Array> {
  const rgba = frame1bppToRgbaNative(src)
  if (!_srcCanvas) _srcCanvas = new OffscreenCanvas(SRC_W, SRC_H)
  const srcCtx = _srcCanvas.getContext('2d')
  if (!srcCtx) throw new Error('no 2d context (src)')
  // Build ImageData then fill, rather than `new ImageData(rgba, w, h)`: the
  // latter trips a TS lib mismatch (Uint8ClampedArray<ArrayBufferLike> vs
  // ImageDataArray) under strict tsc even though it's valid at runtime.
  const img = srcCtx.createImageData(SRC_W, SRC_H)
  img.data.set(rgba)
  srcCtx.putImageData(img, 0, 0)

  const dst = new OffscreenCanvas(dstW, dstH)
  const dstCtx = dst.getContext('2d')
  if (!dstCtx) throw new Error('no 2d context (dst)')
  dstCtx.imageSmoothingEnabled = false
  dstCtx.drawImage(_srcCanvas, 0, 0, SRC_W, SRC_H, 0, 0, dstW, dstH)

  const blob = await dst.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

/** FNV-1a 32-bit hash for cheap identical-frame detection. */
export function hashFrame(buf: Uint8Array): number {
  let h = 0x811c9dc5
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i]
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

type PushFn = (data: Uint8Array, seq: number) => Promise<void>

/**
 * Rate-limited single-slot queue for updateImageRawData.
 *
 * SDK constraint (README:582): image transmissions must not overlap; we hold
 * an inFlight gate. We ALSO enforce a wall-clock minimum interval between
 * dispatch starts, independent of the Promise resolution. This matters
 * because the simulator's Flutter side resolves the SDK promise quickly even
 * while it queues the actual render internally - without this throttle the
 * sim's internal queue grows on animations and lag accumulates.
 *
 * Older pending frames are dropped when a newer one arrives - effectively
 * "UDP-style": latest wins, old gets discarded.
 */
export class RenderQueue {
  private push: PushFn
  private inFlight = false
  private pending: { data: Uint8Array; seq: number } | null = null
  private lastHash = -1
  private lastDispatchStart = 0
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  public minIntervalMs: number
  public droppedFrames = 0
  public sentFrames = 0
  public lastSentSeq = -1

  constructor(push: PushFn, minIntervalMs = 1500) {
    this.push = push
    this.minIntervalMs = minIntervalMs
  }

  /**
   * Forget the last-frame hash so the next submit always dispatches, even if
   * it's pixel-identical to what we last sent. Call this after something other
   * than the queue has drawn to the container (e.g. a status overlay): the
   * live Flipper screen is often static and hashes identically forever, so
   * without a reset the dedup would suppress the very frame that should replace
   * the overlay, stranding the user on the status screen.
   */
  resetDedup(): void {
    this.lastHash = -1
  }

  submit(data: Uint8Array, seq: number): void {
    const h = hashFrame(data)
    if (h === this.lastHash) return
    this.lastHash = h
    if (this.pending) this.droppedFrames++
    this.pending = { data, seq }
    this.tryDispatch()
  }

  private tryDispatch(): void {
    if (this.inFlight || !this.pending) return
    const since = performance.now() - this.lastDispatchStart
    if (since < this.minIntervalMs) {
      if (this.wakeTimer == null) {
        this.wakeTimer = setTimeout(() => {
          this.wakeTimer = null
          this.tryDispatch()
        }, this.minIntervalMs - since)
      }
      return
    }
    const next = this.pending
    this.pending = null
    void this.dispatch(next.data, next.seq)
  }

  private async dispatch(data: Uint8Array, seq: number): Promise<void> {
    this.inFlight = true
    this.lastDispatchStart = performance.now()
    try {
      // Race the SDK call against a timeout: the simulator's IPC occasionally
      // never resolves the Promise, which would otherwise wedge the queue
      // permanently. The timeout MUST exceed the slowest real render - a
      // 288x144 updateImageRawData takes ~1.5-3s on real glasses - because
      // firing mid-transfer dispatches the next frame while the previous is
      // still in flight, queueing inside the Even app and compounding latency.
      // Wedge-breaker only, never a scheduler.
      const timeoutMs = Math.max(8000, this.minIntervalMs * 2)
      await Promise.race([
        this.push(data, seq),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('push timeout')), timeoutMs),
        ),
      ])
      this.sentFrames++
      this.lastSentSeq = seq
    } catch (err) {
      console.warn('RenderQueue.push:', err)
      // A failed push means this frame was never displayed. Without this, the
      // hash dedup would suppress identical re-broadcasts (a static Flipper
      // screen re-streams the same pixels) and the display would stick on the
      // PREVIOUS frame until the screen changed. Reset dedup and retry the
      // frame (unless a newer one arrived meanwhile) after a short backoff.
      this.lastHash = -1
      if (!this.pending) this.pending = { data, seq }
      this.inFlight = false
      setTimeout(() => this.tryDispatch(), 500)
      return
    }
    this.inFlight = false
    this.tryDispatch()
  }
}

/**
 * Build a RenderQueue that PNG-encodes each 1bpp frame and pushes it to the
 * given SDK bridge / container.
 */
/** One timing sample: PNG-encode time, on-glasses push time, payload size. */
export type RenderSample = { encMs: number; pushMs: number; pngBytes: number }

export function makeBridgeRenderQueue(
  bridge: EvenAppBridge,
  containerID: number,
  containerName: string,
  minIntervalMs?: number,
  onRendered?: () => void | Promise<void>,
  onSample?: (s: RenderSample) => void | Promise<void>,
): RenderQueue {
  let lastWarn = 0
  return new RenderQueue(async (raw1bpp) => {
    const t0 = performance.now()
    const png = await encodeFramePng(raw1bpp)
    const t1 = performance.now()
    const payload = new ImageRawDataUpdate({
      containerID,
      containerName,
      imageData: png,
    })
    // push = the number that matters: WebView -> native -> BLE -> firmware
    // PNG-decode + gray4 + display refresh, on real glasses.
    await bridge.updateImageRawData(payload)
    const t2 = performance.now()
    // The frame has loaded. Grant the bridge a credit for the next one - this
    // is the closed-loop back-pressure: we ask for the next frame exactly when
    // the previous one finished drawing, so the pipeline self-paces to the
    // glasses' real draw rate instead of a guessed interval.
    await onRendered?.()
    // Stats hook: awaited inside dispatch so any HUD stats text upgrade is
    // serialized with image pushes (the SDK forbids concurrent image sends and
    // the inFlight gate keeps the next frame from dispatching until this
    // returns - so the measured push time above stays clean).
    await onSample?.({ encMs: t1 - t0, pushMs: t2 - t1, pngBytes: png.length })
    // Warn at most once per second to avoid log floods.
    if (t2 - lastWarn > 1000) {
      console.warn(`[render] enc=${(t1 - t0).toFixed(1)}ms push=${(t2 - t1).toFixed(1)}ms total=${(t2 - t0).toFixed(1)}ms png=${png.length}B`)
      lastWarn = t2
    }
  }, minIntervalMs)
}
