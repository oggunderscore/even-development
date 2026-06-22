import type { EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { OsEventTypeList } from '@evenrealities/even_hub_sdk'

type ChunkCb = (pcm: Uint8Array) => void

export class AudioRecorder {
  private bridge: EvenAppBridge
  private unsub: (() => void) | null = null
  private chunkCb: ChunkCb | null = null

  constructor(bridge: EvenAppBridge) {
    this.bridge = bridge
    this.watchForeground()
  }

  async startRecording(onChunk: ChunkCb) {
    this.chunkCb = onChunk
    this.unsub = this.bridge.onEvenHubEvent((event) => {
      if (event.audioEvent?.audioPcm) {
        this.chunkCb?.(event.audioEvent.audioPcm)
      }
    })
    await this.bridge.audioControl(true)
  }

  async stopRecording() {
    await this.bridge.audioControl(false)
    this.unsub?.()
    this.unsub = null
    this.chunkCb = null
  }

  // Re-enable capture after the phone returns from background
  private watchForeground() {
    this.bridge.onEvenHubEvent((event) => {
      if (
        event.sysEvent?.eventType === OsEventTypeList.FOREGROUND_ENTER_EVENT &&
        this.chunkCb !== null
      ) {
        this.bridge.audioControl(true)
      }
    })
  }
}
