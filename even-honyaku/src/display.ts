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
    this.renderBody()
  }

  addTranslation(t: Translation) {
    this.push(formatEntry(t))
  }

  note(text: string) {
    this.push(text)
  }

  /** Swipe up pushes rows off the top (past the last one the view is empty); swipe down brings them back. */
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
    const off = this.feed.offset
    const where = this.feed.cleared ? '  [cleared]' : off ? `  [${off > 0 ? '+' : ''}${off}]` : ''
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
    void this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: ID_HEADER, containerName: 'header', content: this.headerText() }),
    )
  }

  private renderFooter() {
    void this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: ID_FOOTER, containerName: 'footer', content: this.setup ? FOOTER_SETUP : FOOTER }),
    )
  }

  private renderBody() {
    void this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: ID_BODY, containerName: 'body', content: this.bodyText() }),
    )
  }
}

function formatEntry(t: Translation): string {
  return t.dir === 'speak'
    ? `you: ${t.english}\n> ${t.romaji}`
    : `JP: ${t.romaji}\n> ${t.english}`
}
