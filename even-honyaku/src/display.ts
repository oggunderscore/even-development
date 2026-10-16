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
import type { Direction, Translation } from './protocol'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

const ID_HEADER = 1
const ID_BODY = 2
const ID_FOOTER = 3

/** A full-screen text container holds ~400–500 chars; the body is ~3/4 of it. */
const BODY_CHAR_BUDGET = 320

export type UiState = 'idle' | 'listening' | 'talking' | 'processing' | 'offline'

const STATE_LABEL: Record<UiState, string> = {
  idle: '○ paused',
  listening: '● listening',
  talking: '● talking (EN)',
  processing: '… translating',
  offline: '× offline',
}

export class Display {
  private entries: string[] = []
  private live = ''
  /** How many entries back from the newest the view is scrolled (0 = following the newest). */
  private offset = 0
  /** Feed hidden by the wearer so it doesn't clutter their view. */
  private hidden = false
  private liveDir: Direction = 'speak'
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
            content: 'swipe: scroll/hide   hold: pause/resume',
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

  /** Interim transcript while the mic is open. Not shown while the feed is hidden or scrolled back. */
  setLive(text: string, dir: Direction = 'speak') {
    this.live = text
    this.liveDir = dir
    this.renderBody()
  }

  /** New content always brings the feed back and jumps to the newest entry. */
  addTranslation(t: Translation) {
    this.live = ''
    this.push(formatEntry(t))
  }

  note(text: string) {
    this.push(text)
  }

  /**
   * Swipe handling. older = back through history; newer = forward, and swiping newer while already on
   * the newest entry hides the feed. Any swipe while hidden shows it again.
   */
  scroll(direction: 'older' | 'newer') {
    if (this.hidden) {
      this.hidden = false
    } else if (direction === 'older') {
      this.offset = Math.min(this.offset + 1, Math.max(this.entries.length - 1, 0))
    } else if (this.offset > 0) {
      this.offset--
    } else {
      this.hidden = true
    }
    this.renderHeader()
    this.renderBody()
  }

  private push(text: string) {
    this.entries.push(text)
    if (this.entries.length > 20) this.entries.shift()
    this.offset = 0
    this.hidden = false
    this.renderHeader()
    this.renderBody()
  }

  private headerText() {
    const where = this.hidden ? '  [hidden]' : this.offset > 0 ? `  [-${this.offset}]` : ''
    return `EN<>JP   ${STATE_LABEL[this.state]}${where}`
  }

  private bodyText(): string {
    if (this.hidden) return ' ' // a blank view, but the container stays valid
    const parts = this.entries.slice(0, this.entries.length - this.offset)
    if (this.live && this.offset === 0) parts.push(`${this.liveDir === 'speak' ? 'you' : 'JP'}: ${this.live}…`)
    if (parts.length === 0 && this.state === 'idle') {
      return 'Paused - not listening.\nHold to resume.'
    }
    if (parts.length === 0) {
      return 'Listening for English and Japanese.\nJapanese -> English shows here.\nEnglish -> romaji shows here.'
    }
    // Keep the newest entries that fit the budget.
    const kept: string[] = []
    let used = 0
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]!
      if (used + part.length > BODY_CHAR_BUDGET && kept.length > 0) break
      kept.unshift(part.length > BODY_CHAR_BUDGET ? part.slice(0, BODY_CHAR_BUDGET) : part)
      used += part.length + 1
    }
    return kept.join('\n')
  }

  private renderHeader() {
    void this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: ID_HEADER, containerName: 'header', content: this.headerText() }),
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
