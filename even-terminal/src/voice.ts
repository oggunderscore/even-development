// Mic recorder: buffers 16kHz mono PCM chunks from the G2 mic,
// auto-stops on silence, and produces a WAV blob for the STT client.

import { makeLog } from './log'

const log = makeLog('voice')

const SAMPLE_RATE = 16000
const SILENCE_RMS_THRESHOLD = 250
const SILENCE_DURATION_MS = 1000
const MAX_RECORDING_MS = 15_000

export class VoiceRecorder {
  private chunks: Uint8Array[] = []
  private silenceTimer: ReturnType<typeof setTimeout> | null = null
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private chunkCount = 0
  private readonly onDone: (wav: Blob) => void
  private readonly onCancel: () => void

  constructor(onDone: (wav: Blob) => void, onCancel: () => void) {
    this.onDone = onDone
    this.onCancel = onCancel
  }

  start() {
    this.chunks = []
    this.chunkCount = 0
    this.active = true
    this.clearTimers()
    this.maxTimer = setTimeout(() => { this.finish() }, MAX_RECORDING_MS)
    log.info('recording started (max 15s)')
  }

  feedChunk(pcm: Uint8Array) {
    if (!this.active) return
    this.chunks.push(pcm)
    this.chunkCount++

    const level = rms(pcm)

    // Log every 10th chunk so we can see audio is arriving without flooding
    if (this.chunkCount % 10 === 0) {
      log.info(`chunk #${this.chunkCount}  rms=${level.toFixed(0)}  bytes=${pcm.length}`)
    }

    if (level < SILENCE_RMS_THRESHOLD) {
      if (!this.silenceTimer) {
        log.info(`silence detected (rms=${level.toFixed(0)} < ${SILENCE_RMS_THRESHOLD}), stopping in 1s`)
        this.silenceTimer = setTimeout(() => { this.finish() }, SILENCE_DURATION_MS)
      }
    } else {
      if (this.silenceTimer) {
        log.info(`sound resumed (rms=${level.toFixed(0)}), silence timer cleared`)
        clearTimeout(this.silenceTimer)
        this.silenceTimer = null
      }
    }
  }

  stopManually() {
    if (this.active) {
      log.info('stopped manually')
      this.finish()
    }
  }

  cancel() {
    log.info('cancelled')
    this.active = false
    this.clearTimers()
    this.onCancel()
  }

  private finish() {
    if (!this.active) return
    this.active = false
    this.clearTimers()

    if (this.chunks.length === 0) {
      log.warn('no audio captured — cancelling')
      this.onCancel()
      return
    }

    const merged = mergeChunks(this.chunks)
    const durationMs = Math.round((merged.length / 2 / SAMPLE_RATE) * 1000)
    const wav = pcmToWav(merged, SAMPLE_RATE)
    log.info(`done: ${durationMs}ms audio, ${(wav.byteLength / 1024).toFixed(1)}KB WAV, ${this.chunkCount} chunks`)
    this.onDone(new Blob([wav], { type: 'audio/wav' }))
  }

  private clearTimers() {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null }
    if (this.maxTimer) { clearTimeout(this.maxTimer); this.maxTimer = null }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rms(pcm: Uint8Array): number {
  let sum = 0
  const samples = Math.floor(pcm.length / 2)
  for (let i = 0; i < samples; i++) {
    const lo = pcm[i * 2]
    const hi = pcm[i * 2 + 1]
    const raw = (hi << 8) | lo
    const s = raw > 32767 ? raw - 65536 : raw
    sum += s * s
  }
  return samples > 0 ? Math.sqrt(sum / samples) : 0
}

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  return out
}

function pcmToWav(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const buf = new ArrayBuffer(44 + pcm.length)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true)
  str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, numChannels, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true)
  v.setUint16(32, blockAlign, true); v.setUint16(34, bitsPerSample, true)
  str(36, 'data'); v.setUint32(40, pcm.length, true)
  new Uint8Array(buf, 44).set(pcm)
  return buf
}
