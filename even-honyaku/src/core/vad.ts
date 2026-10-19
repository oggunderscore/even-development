// A small energy-based speech segmenter. The voice-profile enrollment and the Voice tab's live test use it to cut the
// mic stream into utterances locally (the always-on engine doesn't need it: Deepgram already reports utterance times).

import { SAMPLE_RATE, pcmToFloat } from './dsp'

const FRAME = 320 // 20 ms
const START_FRAMES = 3 // 60 ms above threshold to open
const END_FRAMES = 25 // 500 ms below to close
const PREROLL_FRAMES = 10
const MIN_SEGMENT_SEC = 0.8
const MAX_SEGMENT_SEC = 12
/** Never treat anything quieter than this as speech, however quiet the room. */
const ABS_FLOOR_DB = -52

const db = (x: Float32Array, at: number) => {
  let s = 0
  for (let i = 0; i < FRAME; i++) s += x[at + i]! * x[at + i]!
  return 10 * Math.log10(s / FRAME + 1e-12)
}

export class Segmenter {
  private carry = new Float32Array(0)
  private noise = -60
  private active: Float32Array[] | null = null
  private preroll: Float32Array[] = []
  private above = 0
  private below = 0
  private frames = 0

  /** `onSegment` gets each finished utterance; `onLevel` every frame (dB, and whether we are inside speech) for a meter. */
  constructor(
    private readonly onSegment: (audio: Float32Array) => void,
    private readonly onLevel?: (levelDb: number, speaking: boolean) => void,
  ) {}

  push(pcm: Uint8Array) {
    const incoming = pcmToFloat(pcm)
    const x = new Float32Array(this.carry.length + incoming.length)
    x.set(this.carry)
    x.set(incoming, this.carry.length)
    let at = 0
    for (; at + FRAME <= x.length; at += FRAME) this.frame(x.slice(at, at + FRAME))
    this.carry = x.slice(at)
  }

  /** Close an utterance that is still open (e.g. the mic was stopped). */
  flush() {
    this.finish()
  }

  private frame(f: Float32Array) {
    const level = db(f, 0)
    const threshold = Math.max(this.noise + 11, ABS_FLOOR_DB)
    const loud = level > threshold
    // The noise floor follows the room: quickly down, slowly up, and never while someone is speaking.
    if (!this.active) this.noise = level < this.noise ? level : this.noise + (level - this.noise) * 0.02
    this.onLevel?.(level, this.active !== null)

    if (!this.active) {
      this.preroll.push(f)
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift()
      this.above = loud ? this.above + 1 : 0
      if (this.above >= START_FRAMES) {
        this.active = [...this.preroll]
        this.preroll = []
        this.below = 0
        this.frames = this.active.length
      }
      return
    }
    this.active.push(f)
    this.frames++
    this.below = loud ? 0 : this.below + 1
    if (this.below >= END_FRAMES || (this.frames * FRAME) / SAMPLE_RATE >= MAX_SEGMENT_SEC) this.finish()
  }

  private finish() {
    const frames = this.active
    const silent = this.below
    this.active = null
    this.above = 0
    this.below = 0
    if (!frames) return
    // drop the silence that closed it, keeping ~100 ms of tail
    const trimmed = frames.slice(0, Math.max(START_FRAMES, frames.length - Math.max(0, silent - 5)))
    const out = new Float32Array(trimmed.length * FRAME)
    trimmed.forEach((f, i) => out.set(f, i * FRAME))
    if (out.length / SAMPLE_RATE >= MIN_SEGMENT_SEC) this.onSegment(out)
  }
}
