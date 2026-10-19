// G2 layouts (576 × 288). The page is rebuilt only when it really changes (mode switch, or the contextual-menu labels
// change); everything else is a flicker-free text update.
//
//   standard    header y=0 h=32 · body y=32 h=216 (translation feed, captures input) · footer y=248 h=40
//   predictive  header y=0 h=32 · body y=32 h=256 (the other person's turn + suggested replies, captures input)
//
// Both carry the OS contextual menu (tap then long press): Pause / Resume listening and the settings. The menu is part
// of the page, so every rebuild re-declares it (omitting it would clear it).
//
// Romaji is plain ASCII so it always renders. Kana/kanji are only drawn when the user turns that on.

import {
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  type waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { Feed, wrapLine } from './feed'
import { type MenuItem, itemIdAt } from './menu'
import { PredictiveView } from './predictive'
import type { AppMode, Direction, Prediction, Translation } from './protocol'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

const ID_HEADER = 1
const ID_BODY = 2
const ID_FOOTER = 3

/** Live interim text changes many times a second; the glasses link is a slow BLE pipe, so don't flood it. */
const LIVE_MIN_MS = 350
/** A one-off message (an error, a menu note) stays in the header this long. */
const FLASH_MS = 5000

const FOOTER = 'tap: pause/resume   2x tap: exit'
const HINT_BASE = 'tap: pause/resume  2x tap: exit'
const FOOTER_SETUP = 'Even app > Honyaku > Settings'

export type UiState = 'idle' | 'listening' | 'talking' | 'processing' | 'offline'

const STATE_LABEL: Record<UiState, string> = {
  idle: '○ paused',
  listening: '● listening',
  talking: '● talking (EN)',
  processing: '… translating',
  offline: '× offline',
}

type Layout = 'standard' | 'predictive'

export class Display {
  private feed = new Feed()
  private view: PredictiveView
  /** First-run setup isn't finished: the lines naming what's missing (null = set up). Replaces the feed. */
  private setup: string[] | null = null
  private state: UiState = 'offline'
  private mode: AppMode
  private kana: boolean
  private layout: Layout
  /** The contextual-menu items declared on the page. */
  private menu: MenuItem[]
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
    opts: { mode?: AppMode; kana?: boolean; menu?: MenuItem[] } = {},
  ) {
    this.menu = opts.menu ?? []
    this.mode = opts.mode ?? 'standard'
    this.kana = opts.kana ?? false
    this.layout = this.modeLayout
    this.view = new PredictiveView({ kana: this.kana })
  }

  private get modeLayout(): Layout {
    return this.mode === 'predictive' ? 'predictive' : 'standard'
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

  /** The containers for a layout, filled with what should be showing right now, plus the contextual menu. */
  private page(layout: Layout) {
    this.sent.clear()
    const header = this.text(ID_HEADER, 'header', 0, 32, this.headerText(), false, 2)
    const textObject =
      layout === 'standard'
        ? [
            header,
            this.text(ID_BODY, 'body', 32, 216, this.bodyText(), true, 4),
            this.text(ID_FOOTER, 'footer', 248, 40, this.setup ? FOOTER_SETUP : FOOTER, false, 2),
          ]
        : [header, this.text(ID_BODY, 'body', 32, 256, this.bodyText(), true, 2)]
    return {
      containerTotalNum: textObject.length,
      textObject,
      ...(this.menu.length
        ? { menuObject: new MenuContainerProperty({ menuItems: this.menu.map((m, i) => new MenuItemProperty({ itemID: itemIdAt(i), itemName: m.label })) }) }
        : {}),
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
  setMode(mode: AppMode): Promise<void> {
    return this.configure({ mode })
  }

  setKana(kana: boolean) {
    if (kana === this.kana) return
    this.kana = kana
    this.view.setKana(kana)
    this.renderBody()
  }

  /** New contextual-menu labels (a setting changed). */
  setMenu(menu: MenuItem[]): Promise<void> {
    return this.configure({ menu })
  }

  /**
   * Change the mode and/or the contextual-menu labels with one page rebuild. The OS can't relabel a menu item in place,
   * so changed labels mean re-declaring the menu on a rebuilt page; nothing happens if nothing changed.
   */
  async configure(opts: { mode?: AppMode; menu?: MenuItem[] }): Promise<void> {
    const modeChanged = opts.mode !== undefined && opts.mode !== this.mode
    const menu = opts.menu
    const menuChanged = menu !== undefined && !(menu.length === this.menu.length && menu.every((m, i) => m.label === this.menu[i]!.label))
    if (!modeChanged && !menuChanged) return
    const before = { mode: this.mode, menu: this.menu }
    if (opts.mode !== undefined) this.mode = opts.mode
    if (menu !== undefined) this.menu = menu
    if (!(await this.rebuild(this.modeLayout))) {
      // The glasses refused: what we think is on screen must match what is.
      this.mode = before.mode
      this.menu = before.menu
    }
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
    this.view.failed(message)
    this.renderBody()
  }

  /** The wearer's own speech was filtered out; if they were reading a suggestion, mark which. */
  self(optionIndex?: number, turnId?: number) {
    // If it can't be matched to this turn's options it is still the wearer replying: close the turn either way.
    if (optionIndex === undefined || !this.view.said(optionIndex, turnId)) this.view.selfSpoke()
    this.renderHeader()
    this.renderBody()
  }

  /** A short message in the header for a few seconds, on either screen: visible feedback for a gesture that changes nothing else. */
  flashMessage(text: string) {
    this.flash = text
    clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.flash = ''
      this.renderHeader()
    }, FLASH_MS)
    this.renderHeader()
  }

  /** A short message (errors, menu notes): in the feed on the classic screen, in the header on the predictive one. */
  note(text: string) {
    if (this.mode === 'predictive') return this.flashMessage(text)
    this.feed.add(text)
    this.renderHeader()
    this.renderBody()
  }

  /** Swipe. Classic: scroll the feed one translation. Predictive: move the highlight / read earlier turns. */
  scroll(direction: 'up' | 'down') {
    if (this.setup) return
    const changed = this.mode === 'predictive' ? this.view.move(direction) : this.feed.scroll(direction)
    if (!changed) return
    this.renderHeader()
    this.renderBody()
  }

  // ── text ────────────────────────────────────────────────────────────────────

  private headerText(layout: Layout = this.layout): string {
    if (this.setup) return 'Honyaku   x setup needed'
    if (layout === 'predictive') {
      const viewHint = this.view.hint()
      const hint = this.flash || (viewHint ? `${viewHint}  2x tap: exit` : HINT_BASE)
      return wrapLine(`${STATE_LABEL[this.state]}   ${hint}`.trimEnd())[0] ?? ''
    }
    if (this.flash) return wrapLine(`${STATE_LABEL[this.state]}   ${this.flash}`)[0] ?? '' // keep the state visible
    const where = this.feed.cleared ? '  [cleared]' : ''
    // The app's own name, as in the store listing: the on-glasses name must match it.
    return `Honyaku   ${STATE_LABEL[this.state]}${where}`
  }

  /** The rows the body shows in the current mode. */
  private baseRows(): string[] {
    if (this.setup) return ['Please set up Honyaku in the', 'Even Realities app.', '', 'Error: Missing API keys', ...this.setup.map((m) => `- ${m}`)]
    if (this.mode === 'predictive') {
      if (this.state === 'idle' && !this.view.hasContent) return ['Paused - not listening.', 'Tap to resume.']
      return this.view.rows()
    }
    const rows = this.feed.visible()
    if (rows.length) return rows
    if (this.feed.cleared) return [' '] // a blank view, but the container stays valid
    return this.state === 'idle'
      ? ['Paused - not listening.', 'Tap to resume.']
      : ['Listening for English and Japanese.', 'Japanese -> English shows here.', 'English -> romaji shows here.']
  }

  private bodyText(): string {
    return this.baseRows().join('\n')
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
  if (!t.romaji) return `JP${t.unsure ? '?' : ''}> ${t.english}` // no romaji yet (the dictionary is still being fetched)
  return `JP${t.unsure ? '?' : ''}: ${t.romaji}\n${kana && t.japanese ? `${t.japanese}\n` : ''}> ${t.english}`
}
