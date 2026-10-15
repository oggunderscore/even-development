// One Deepgram live-transcription stream per push-to-talk turn.

import WebSocket from 'ws'
import type { Direction } from '../../src/protocol'

const LANG: Record<Direction, string> = { speak: 'en', listen: 'ja' }

export interface SttHandlers {
  onPartial(text: string): void
  onFinal(text: string): void
  onError(err: Error): void
}

export class SttStream {
  private readonly ws: WebSocket
  private readonly opened: Promise<void>
  private queue: Buffer[] = []
  private isOpen = false
  readonly closed: Promise<void>

  constructor(dir: Direction, private readonly handlers: SttHandlers) {
    const params = new URLSearchParams({
      model: 'nova-3',
      language: LANG[dir],
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      endpointing: '400',
      smart_format: 'true',
    })
    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${process.env['DEEPGRAM_API_KEY'] ?? ''}` },
    })

    this.opened = new Promise((resolve) => this.ws.once('open', resolve))
    this.ws.once('open', () => {
      this.isOpen = true
      for (const chunk of this.queue) this.ws.send(chunk)
      this.queue = []
    })
    this.ws.on('message', (data) => this.onMessage(data.toString()))
    this.ws.on('error', (err) => handlers.onError(err))
    this.closed = new Promise((resolve) => this.ws.once('close', () => resolve()))
  }

  audio(chunk: Buffer) {
    if (this.isOpen) this.ws.send(chunk)
    else this.queue.push(chunk)
  }

  /** Flush: Deepgram emits any remaining finals, then closes the socket. */
  async finish(): Promise<void> {
    await Promise.race([this.opened, this.closed])
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }))
    }
    await this.closed
  }

  abort() {
    this.ws.terminate()
  }

  private onMessage(raw: string) {
    let msg: { type?: string; is_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type !== 'Results') return
    const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
    if (!text) return
    if (msg.is_final) this.handlers.onFinal(text)
    else this.handlers.onPartial(text)
  }
}
