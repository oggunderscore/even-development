// G2 layout (576 × 288):
//   y=  0  h= 32  header  — mode + state
//   y= 32  h=216  body    — rolling translations (event capture)
//   y=248  h= 40  footer  — gesture hints
//
// Romaji is plain ASCII, so it always renders. Japanese script is never sent to the glasses.

import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { Feed } from './feed'
import type { Direction, Translation } from './protocol'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

const ID_HEADER = 1
const ID_BODY = 2
const ID_FOOTER = 3

/** Live interim text changes many times a second; the glasses link is a slow BLE pipe, so don't flood it. */
const LIVE_MIN_MS = 350

const FOOTER = 'swipe: scroll   hold: pause/resume'
const FOOTER_SETUP = 'Even app > Honyaku > Settings'

export type UiState = 'idle' | 'listening' | 'talking' | 'processing' | 'offline'

const STATE_LABEL: Record<UiState, string> = {
  idle: '○ paused',
  listening: '● listening',
  talking: '● talking (EN)',
  processing: '… translating',
  offline: '× offline',
}

export class Display {
  private feed = new Feed()
  /** First-run setup isn't finished: the lines naming what's missing (null = set up). Replaces the feed. */
  private setup: string[] | null = null
  private state: UiState = 'offline'
  /** Last content sent per container, so unchanged text never costs a BLE write. */
  private sent = new Map<number, string>()
  private bodyTimer: ReturnType<typeof setTimeout> | undefined
  private lastBodyAt = 0

  constructor(private readonly bridge: Bridge) {}

  init(): Promise<number> {
    return this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 3,
        textObject: [
          new TextContainerProperty({
            containerID: ID_HEADER,
            containerName: 'header',
            xPosition: 0, yPosition: 0, width: 576, height: 32,
            paddingLength: 2,
            content: this.headerText(),
            isEventCapture: 0,
          }),
          new TextContainerProperty({
            containerID: ID_BODY,
            containerName: 'body',
            xPosition: 0, yPosition: 32, width: 576, height: 216,
            paddingLength: 4,
            content: this.bodyText(),
            isEventCapture: 1,
          }),
          new TextContainerProperty({
            containerID: ID_FOOTER,
            containerName: 'footer',
            xPosition: 0, yPosition: 248, width: 576, height: 40,
            paddingLength: 2,
            content: FOOTER,
            isEventCapture: 0,
          }),
        ],
      }),
    )
  }

  setState(state: UiState) {
    this.state = state
    this.renderHeader()
    this.renderBody()
  }

  /** Show (or clear, with null) the "finish setup on the phone" screen. */
  setSetup(missing: string[] | null) {
    const changed = JSON.stringify(missing) !== JSON.stringify(this.setup)
    this.setup = missing
    if (!changed) return
    this.renderHeader()
    this.renderBody()
    this.renderFooter()
  }

  /** Interim transcript while the mic is open; shown below the finished rows. */
  setLive(text: string, dir: Direction = 'speak') {
    this.feed.setLive(text ? `${dir === 'speak' ? 'you' : 'JP'}: ${text}…` : '')
    const wait = LIVE_MIN_MS - (Date.now() - this.lastBodyAt)
    if (wait <= 0 || !text) return this.renderBody() // clearing the interim line isn't throttled
    this.bodyTimer ??= setTimeout(() => this.renderBody(), wait) // trailing edge: the latest text still lands
  }

  addTranslation(t: Translation) {
    this.push(formatEntry(t))
  }

  note(text: string) {
    this.push(text)
  }

  /** Swipe up pushes the top translation off the screen (past the last one the view is empty); swipe down brings one back. */
  scroll(direction: 'up' | 'down') {
    if (this.setup) return
    if (!this.feed.scroll(direction)) return
    this.renderHeader()
    this.renderBody()
  }

  private push(text: string) {
    this.feed.add(text)
    this.renderHeader()
    this.renderBody()
  }

  private headerText() {
    if (this.setup) return 'EN<>JP   x setup needed'
    const where = this.feed.cleared ? '  [cleared]' : ''
    return `EN<>JP   ${STATE_LABEL[this.state]}${where}`
  }

  private bodyText(): string {
    if (this.setup) {
      return ['Please set up Honyaku in the', 'Even Realities app.', '', 'Error: Missing API keys', ...this.setup.map((m) => `- ${m}`)].join('\n')
    }
    const rows = this.feed.visible()
    if (rows.length) return rows.join('\n')
    if (this.feed.cleared) return ' ' // a blank view, but the container stays valid
    return this.state === 'idle'
      ? 'Paused - not listening.\nHold to resume.'
      : 'Listening for English and Japanese.\nJapanese -> English shows here.\nEnglish -> romaji shows here.'
  }

  private renderHeader() {
    this.send(ID_HEADER, 'header', this.headerText())
  }

  private renderFooter() {
    this.send(ID_FOOTER, 'footer', this.setup ? FOOTER_SETUP : FOOTER)
  }

  private renderBody() {
    clearTimeout(this.bodyTimer)
    this.bodyTimer = undefined
    this.lastBodyAt = Date.now()
    this.send(ID_BODY, 'body', this.bodyText())
  }

  private send(containerID: number, containerName: string, content: string) {
    if (this.sent.get(containerID) === content) return
    this.sent.set(containerID, content)
    this.bridge
      .textContainerUpgrade(new TextContainerUpgrade({ containerID, containerName, content }))
      .then((ok) => {
        if (!ok && this.sent.get(containerID) === content) this.sent.delete(containerID) // failed: allow a retry
      })
      .catch(() => this.sent.delete(containerID))
  }
}

function formatEntry(t: Translation): string {
  return t.dir === 'speak'
    ? `you: ${t.english}\n> ${t.romaji}`
    : `JP: ${t.romaji}\n> ${t.english}`
}
