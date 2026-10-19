// The link to the translation engine. The engine (src/core) runs right here in the WebView and calls Deepgram and
// the user's translation provider straight from the phone with the user's own keys — there is no server.
// Kept as a small class so the rest of the app only deals with `startStream` / `sendAudio` / `onMessage`.

import { Engine } from './core/engine'
import type { ClientMsg, ReplyOption, ServerMsg, StreamMode, UserConfig } from './protocol'

export interface SessionHandlers {
  onMessage(msg: ServerMsg): void
  onConnection(connected: boolean): void
  /** Read when the engine (re)starts, so a saved settings change applies on the next connect. */
  getConfig(): UserConfig
}

export class Session {
  private engine: Engine | null = null
  /** PCM captured before the engine was up. */
  private backlog: Uint8Array[] = []

  constructor(private readonly handlers: SessionHandlers) {}

  get isOpen(): boolean {
    return this.engine !== null
  }

  /** Starts the engine with the current settings. Never fails: there is no network involved until a stream starts. */
  connect(): Promise<void> {
    if (this.engine) return Promise.resolve()
    const engine = new Engine((msg) => this.handlers.onMessage(msg))
    this.engine = engine
    engine.handle({ type: 'config', config: this.handlers.getConfig() })
    this.handlers.onConnection(true)
    return Promise.resolve()
  }

  /** Hand the running engine new preferences (mode, voiceprint…) without restarting its streams. */
  reconfigure() {
    this.engine?.handle({ type: 'config', config: this.handlers.getConfig() })
  }

  /** The wearer picked a suggested reply on the glasses. */
  chose(option: ReplyOption) {
    this.sendJson({ type: 'chose', option })
  }

  /** Stop the engine so the next connect() picks up changed settings. */
  reset() {
    if (!this.engine) return
    this.engine.close()
    this.engine = null
    this.handlers.onConnection(false)
  }

  async startStream(mode: StreamMode): Promise<void> {
    this.backlog = []
    await this.connect()
    this.sendJson({ type: 'start', mode })
    for (const chunk of this.backlog) this.engine?.audio(chunk)
    this.backlog = []
  }

  sendAudio(pcm: Uint8Array) {
    if (this.engine) this.engine.audio(pcm)
    else this.backlog.push(pcm)
  }

  endStream() {
    this.sendJson({ type: 'end' })
  }

  async translateText(text: string): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'text', text })
  }

  /** Check the keys in use and run a sample translation. */
  async test(): Promise<void> {
    await this.connect()
    this.sendJson({ type: 'test' })
  }

  private sendJson(msg: ClientMsg) {
    this.engine?.handle(msg)
  }
}
