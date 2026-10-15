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

export type UiState = 'idle' | 'listening' | 'processing' | 'offline'

const MODE_LABEL: Record<Direction, string> = {
  speak: 'EN>JP  YOU SPEAK',
  listen: 'JP>EN  THEY SPEAK',
}

const STATE_LABEL: Record<UiState, string> = {
  idle: '○ ready',
  listening: '● listening',
  processing: '… translating',
  offline: '× offline',
}

export class Display {
  private entries: string[] = []
  private live = ''
  private dir: Direction = 'speak'
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
            content: 'tap: talk   swipe: mode   2x tap: exit',
            isEventCapture: 0,
          }),
        ],
      }),
    )
  }

  setMode(dir: Direction) {
    this.dir = dir
    this.renderHeader()
    this.renderBody()
  }

  setState(state: UiState) {
    this.state = state
    this.renderHeader()
    this.renderBody()
  }

  /** Interim transcript while the mic is open. */
  setLive(text: string) {
    this.live = text
    this.renderBody()
  }

  addTranslation(t: Translation) {
    this.live = ''
    this.entries.push(formatEntry(t))
    if (this.entries.length > 20) this.entries.shift()
    this.renderBody()
  }

  note(text: string) {
    this.entries.push(text)
    this.renderBody()
  }

  private headerText() {
    return `${MODE_LABEL[this.dir]}   ${STATE_LABEL[this.state]}`
  }

  private bodyText(): string {
    const parts = [...this.entries]
    if (this.live) parts.push(`${this.dir === 'speak' ? 'you' : 'JP'}: ${this.live}…`)
    if (parts.length === 0) {
      return this.dir === 'speak'
        ? 'Tap, then speak English.\nRomaji will appear here to read aloud.'
        : 'Tap while the other person speaks Japanese.\nEnglish will appear here.'
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
