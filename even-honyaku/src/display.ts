// G2 layouts (576 × 288). The page is rebuilt only when the layout really changes (mode switch, menu open/close);
// everything else is a flicker-free text update.
//
//   standard    header y=0 h=32 · body y=32 h=216 (translation feed, captures input) · footer y=248 h=40
//   predictive  header y=0 h=32 · body y=32 h=256 (the other person's turn + suggested replies, captures input)
//   menu        header · body y=32 h=64 (the last two rows that were on screen) · list y=100 h=188 (captures input)
//
// Romaji is plain ASCII so it always renders. Kana/kanji are only drawn when the user turns that on.

import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { Feed, wrapLine } from './feed'
import type { MenuItem } from './menu'
import { PredictiveView } from './predictive'
import type { AppMode, Direction, Prediction, ReplyOption, Translation } from './protocol'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

const ID_HEADER = 1
const ID_BODY = 2
const ID_FOOTER = 3
const ID_MENU = 4

/** Live interim text changes many times a second; the glasses link is a slow BLE pipe, so don't flood it. */
const LIVE_MIN_MS = 350
/** A one-off message (an error, a menu note) stays in the header this long. */
const FLASH_MS = 5000

const FOOTER = 'swipe: scroll   2x tap: menu'
const FOOTER_SETUP = 'Even app > Honyaku > Settings'

export type UiState = 'idle' | 'listening' | 'talking' | 'processing' | 'offline'

const STATE_LABEL: Record<UiState, string> = {
  idle: '○ paused',
  listening: '● listening',
  talking: '● talking (EN)',
  processing: '… translating',
  offline: '× offline',
}

type Layout = 'standard' | 'predictive' | 'menu'

export class Display {
  private feed = new Feed()
  private view: PredictiveView
  /** First-run setup isn't finished: the lines naming what's missing (null = set up). Replaces the feed. */
  private setup: string[] | null = null
  private state: UiState = 'offline'
  private mode: AppMode
  private kana: boolean
  private layout: Layout
  private menu: MenuItem[] | null = null
  private flash = ''
  private flashTimer: ReturnType<typeof setTimeout> | undefined
  /** Last content sent per container, so unchanged text never costs a BLE write. */
  private sent = new Map<number, string>()
  private bodyTimer: ReturnType<typeof setTimeout> | undefined
  private lastBodyAt = 0
  /** A page rebuild in flight; text updates wait for it. */
  private rebuilding: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly bridge: Bridge,
    opts: { mode?: AppMode; kana?: boolean } = {},
  ) {
    this.mode = opts.mode ?? 'standard'
    this.kana = opts.kana ?? false
    this.layout = this.modeLayout
    this.view = new PredictiveView({ kana: this.kana })
  }

  private get modeLayout(): Layout {
    return this.mode === 'predictive' ? 'predictive' : 'standard'
  }

  get menuOpen(): boolean {
    return this.layout === 'menu'
  }

  // ── page construction ───────────────────────────────────────────────────────

  private text(id: number, name: string, y: number, height: number, content: string, capture: boolean, padding: number) {
    this.sent.set(id, content)
    return new TextContainerProperty({
      containerID: id,
      containerName: name,
      xPosition: 0, yPosition: y, width: 576, height,
      paddingLength: padding,
      content,
      isEventCapture: capture ? 1 : 0,
    })
  }

  /** The containers for a layout, filled with what should be showing right now. */
  private page(layout: Layout) {
    this.sent.clear()
    if (layout === 'standard') {
      return {
        containerTotalNum: 3,
        textObject: [
          this.text(ID_HEADER, 'header', 0, 32, this.headerText(layout), false, 2),
          this.text(ID_BODY, 'body', 32, 216, this.bodyText(layout), true, 4),
          this.text(ID_FOOTER, 'footer', 248, 40, this.setup ? FOOTER_SETUP : FOOTER, false, 2),
        ],
      }
    }
    if (layout === 'predictive') {
      return {
        containerTotalNum: 2,
        textObject: [
          this.text(ID_HEADER, 'header', 0, 32, this.headerText(layout), false, 2),
          this.text(ID_BODY, 'body', 32, 256, this.bodyText(layout), true, 2),
        ],
      }
    }
    const items = this.menu ?? []
    return {
      containerTotalNum: 3,
      textObject: [
        this.text(ID_HEADER, 'header', 0, 32, this.headerText(layout), false, 2),
        this.text(ID_BODY, 'body', 32, 64, this.bodyText(layout), false, 4),
      ],
      listObject: [
        new ListContainerProperty({
          containerID: ID_MENU,
          containerName: 'menu',
          xPosition: 0, yPosition: 100, width: 576, height: 188,
          borderWidth: 1, borderColor: 13, borderRadius: 4, paddingLength: 4,
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({ itemCount: items.length, itemWidth: 556, isItemSelectBorderEn: 1, itemName: items.map((i) => i.label) }),
        }),
      ],
    }
  }

  init(): Promise<number> {
    return this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(this.page(this.layout)))
  }

  /** Swap the whole page. Returns false (and keeps the old layout) if the glasses refused it. */
  private rebuild(layout: Layout): Promise<boolean> {
    // Rebuilds run one at a time, in order, so two quick menu changes can't interleave on the glasses.
    const run = this.rebuilding.then(async () => {
      const previous = this.layout
      this.layout = layout
      try {
        const ok = await this.bridge.rebuildPageContainer(new RebuildPageContainer(this.page(layout)))
        if (!ok) throw new Error('rebuild refused')
        return true
      } catch {
        this.layout = previous
        this.sent.clear()
        return false
      }
    })
    this.rebuilding = run
    return run
  }

  // ── mode / menu ─────────────────────────────────────────────────────────────

  /** Switch between the classic feed and Predictive Conversation Mode. */
  async setMode(mode: AppMode): Promise<void> {
    if (mode === this.mode) return
    this.mode = mode
    if (this.layout !== 'menu') await this.rebuild(this.modeLayout)
  }

  setKana(kana: boolean) {
    if (kana === this.kana) return
    this.kana = kana
    this.view.setKana(kana)
    this.renderBody()
  }

  /** Open the overlay menu, or redraw it with new items (a list can't be changed in place). */
  async openMenu(items: MenuItem[]): Promise<boolean> {
    this.menu = items
    return this.rebuild('menu')
  }

  async closeMenu(): Promise<void> {
    if (this.layout !== 'menu') return
    this.menu = null
    await this.rebuild(this.modeLayout)
  }

  // ── state ───────────────────────────────────────────────────────────────────

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

  /** Interim transcript while the mic is open. */
  setLive(text: string, dir: Direction = 'speak') {
    if (this.mode === 'predictive') {
      // Only the other person's phrases belong on the predictive screen; the wearer's own interim text would be noise.
      this.view.hearing(dir === 'listen' ? text : '')
    } else {
      this.feed.setLive(text ? `${dir === 'speak' ? 'you' : 'JP'}: ${text}…` : '')
    }
    const wait = LIVE_MIN_MS - (Date.now() - this.lastBodyAt)
    if (wait <= 0 || !text) return this.renderBody() // clearing the interim line isn't throttled
    this.bodyTimer ??= setTimeout(() => this.renderBody(), wait) // trailing edge: the latest text still lands
  }

  /** `predictionExpected`: Predictive mode will follow this with suggested replies. */
  addTranslation(t: Translation, predictionExpected = false) {
    this.feed.add(formatEntry(t, this.kana))
    this.view.heard(t, predictionExpected)
    this.renderHeader()
    this.renderBody()
  }

  predictions(turnId: number, prediction: Prediction) {
    this.view.predictions(turnId, prediction)
    this.renderHeader()
    this.renderBody()
  }

  predictionFailed(message: string) {
    this.view.failed(message.slice(0, 40))
    this.renderBody()
  }

  /** The wearer's own speech was filtered out; if they were reading a suggestion, mark which. */
  self(optionIndex?: number) {
    if (optionIndex !== undefined) this.view.said(optionIndex)
    else this.view.selfSpoke()
    this.renderHeader()
    this.renderBody()
  }

  /** A short message (errors, menu notes): in the feed on the classic screen, in the header on the predictive one. */
  note(text: string) {
    if (this.mode === 'predictive') {
      this.flash = text
      clearTimeout(this.flashTimer)
      this.flashTimer = setTimeout(() => {
        this.flash = ''
        this.renderHeader()
      }, FLASH_MS)
      this.renderHeader()
      return
    }
    this.feed.add(text)
    this.renderHeader()
    this.renderBody()
  }

  /** Swipe. Classic: scroll the feed one translation. Predictive: move the highlight / read earlier turns. */
  scroll(direction: 'up' | 'down') {
    if (this.setup || this.layout === 'menu') return
    const changed = this.mode === 'predictive' ? this.view.move(direction) : this.feed.scroll(direction)
    if (!changed) return
    this.renderHeader()
    this.renderBody()
  }

  /** Tap (Predictive only): zoom into the highlighted reply. Returns it the first time, so the app can log it as chosen. */
  tap(): ReplyOption | undefined {
    if (this.mode !== 'predictive' || this.setup || this.layout === 'menu') return undefined
    const r = this.view.tap()
    if (r.changed) {
      this.renderHeader()
      this.renderBody()
    }
    return r.chose
  }

  // ── text ────────────────────────────────────────────────────────────────────

  private headerText(layout: Layout = this.layout): string {
    if (this.setup) return 'EN<>JP   x setup needed'
    if (layout === 'menu') return 'MENU   2x tap: close'
    if (layout === 'predictive') {
      const hint = this.flash || this.view.hint()
      return wrapLine(`${STATE_LABEL[this.state]}   ${hint}`.trimEnd())[0] ?? ''
    }
    const where = this.feed.cleared ? '  [cleared]' : ''
    return `EN<>JP   ${STATE_LABEL[this.state]}${where}`
  }

  private standardRows(): string {
    const rows = this.feed.visible()
    if (rows.length) return rows.join('\n')
    if (this.feed.cleared) return ' ' // a blank view, but the container stays valid
    return this.state === 'idle'
      ? 'Paused - not listening.\nDouble tap > Resume listening.'
      : 'Listening for English and Japanese.\nJapanese -> English shows here.\nEnglish -> romaji shows here.'
  }

  private bodyText(layout: Layout = this.layout): string {
    if (this.setup) {
      return ['Please set up Honyaku in the', 'Even Realities app.', '', 'Error: Missing API keys', ...this.setup.map((m) => `- ${m}`)].join('\n')
    }
    if (layout === 'menu') {
      // What was on screen, trimmed to the couple of rows that fit above the menu.
      const rows = (this.mode === 'predictive' ? this.view.rows() : this.feed.visible()).slice(0, 2)
      return rows.length ? rows.join('\n') : ' '
    }
    if (layout === 'predictive') {
      if (this.state === 'idle' && !this.view.hasContent) return 'Paused - not listening.\nDouble tap > Resume listening.'
      return this.view.rows().join('\n')
    }
    return this.standardRows()
  }

  // ── rendering ───────────────────────────────────────────────────────────────

  private renderHeader() {
    this.send(ID_HEADER, 'header', this.headerText())
  }

  private renderFooter() {
    if (this.layout === 'standard') this.send(ID_FOOTER, 'footer', this.setup ? FOOTER_SETUP : FOOTER)
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
    void this.rebuilding.then(() => {
      if (this.sent.get(containerID) !== content) return // superseded while waiting for a rebuild
      this.bridge
        .textContainerUpgrade(new TextContainerUpgrade({ containerID, containerName, content }))
        .then((ok) => {
          if (!ok && this.sent.get(containerID) === content) this.sent.delete(containerID) // failed: allow a retry
        })
        .catch(() => this.sent.delete(containerID))
    })
  }
}

export function formatEntry(t: Translation, kana = false): string {
  if (t.dir === 'speak') return `you: ${t.english}\n${kana && t.japanese ? `${t.japanese}\n` : ''}> ${t.romaji}`
  if (t.heardEnglish) return `them: ${t.english}`
  return `JP${t.unsure ? '?' : ''}: ${t.romaji}\n${kana && t.japanese ? `${t.japanese}\n` : ''}> ${t.english}`
}
