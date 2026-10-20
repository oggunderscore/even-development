import { describe, expect, it } from 'vitest'
import { AUDIO_STALE_MS, captureHealthy } from './capture-health'

const base = { micOpen: true, streaming: true, lastAudioAt: 10_000 }

describe('captureHealthy', () => {
  it('audio flowing into an open stream is healthy: opening the OS menu must not restart it', () => {
    expect(captureHealthy(base, 10_500)).toBe(true)
  })

  it('audio gone quiet for a few seconds means capture was lost (a suspended WebView): re-arm', () => {
    expect(captureHealthy(base, 10_000 + AUDIO_STALE_MS + 1)).toBe(false)
  })

  it('a stream the engine gave up on is not healthy even if the mic still delivers audio', () => {
    expect(captureHealthy({ ...base, streaming: false }, 10_500)).toBe(false)
  })

  it('a closed mic, or one that never delivered anything, is not healthy', () => {
    expect(captureHealthy({ ...base, micOpen: false }, 10_500)).toBe(false)
    expect(captureHealthy({ ...base, lastAudioAt: 0 }, 10_500)).toBe(false)
  })
})
