// G2 layouts (576 × 288). The page is rebuilt only when the layout really changes (mode switch, menu open/close);
// everything else is a flicker-free text update.
//
//   standard    header y=0 h=32 · body y=32 h=216 (translation feed, captures input) · footer y=248 h=40
//   predictive  header y=0 h=32 · body y=32 h=256 (the other person's turn + suggested replies, captures input)
//   menu        the current screen, dimmed and non-capturing, with a small centred list box on top (captures input);
//               the rows of text behind the box are blanked because a list has no fill and the text would show through
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
import { type MenuItem, overlayGeometry } from './menu'
import { PredictiveView } from './predictive'
import type { AppMode, Direction, Prediction, Translation } from './protocol'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

const ID_HEADER = 1
const ID_BODY = 2
const ID_FOOTER = 3
const ID_MENU = 4

/** Live interim text changes many times a second; the glasses link is a slow BLE pipe, so don't flood it. */
const LIVE_MIN_MS = 350
/** A one-off message (an error, a menu note) stays in the header this long. */
const FLASH_MS = 5000

const FOOTER = 'tap: pause/resume   2x tap: menu'
const HINT_BASE = 'tap: pause/resume  2x tap: menu'
/** Height of one text row on the glasses font (about 28 px), for working out which rows sit behind the menu box. */
const ROW_PX = 28
/** Dimmer text behind the menu box so the box reads as the foreground. */
const DIM = 2
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

  private text(id: number, name: string, y: number, height: number, content: string, capture: boolean, padding: number, over?: { z: number; dim?: boolean }) {
    this.sent.set(id, content)
    return new TextContainerProperty({
      containerID: id,
      containerName: name,
      xPosition: 0, yPosition: y, width: 576, height,
      paddingLength: padding,
      content,
      isEventCapture: capture ? 1 : 0,
      // zOrderIndex is all-or-nothing per page: when the menu overlay is up, every container carries one.
      ...(over ? { zOrderIndex: over.z, ...(over.dim ? { textColor: DIM } : {}) } : {}),
    })
  }

  /** The containers for a layout, filled with what should be showing right now. */
  private page(layout: Layout) {
    this.sent.clear()
    const menu = layout === 'menu'
    const base: Layout = menu ? this.modeLayout : layout
    const z = (n: number, dim = false) => (menu ? { z: n, dim } : undefined)
    const header = this.text(ID_HEADER, 'header', 0, 32, this.headerText(layout), false, 2, z(1))
    const textObject =
      base === 'standard'
        ? [
            header,
            this.text(ID_BODY, 'body', 32, 216, this.bodyText(layout), !menu, 4, z(2, true)),
            this.text(ID_FOOTER, 'footer', 248, 40, this.setup ? FOOTER_SETUP : FOOTER, false, 2, z(3, true)),
          ]
        : [header, this.text(ID_BODY, 'body', 32, 256, this.bodyText(layout), !menu, 2, z(2, true))]
    if (!menu) return { containerTotalNum: textObject.length, textObject }

    const items = this.menu ?? []
    const box = overlayGeometry(items)
    return {
      containerTotalNum: textObject.length + 1,
      textObject,
      listObject: [
        new ListContainerProperty({
          containerID: ID_MENU,
          containerName: 'menu',
          xPosition: box.x, yPosition: box.y, width: box.width, height: box.height,
          borderWidth: 1, borderColor: 13, borderRadius: 4, paddingLength: 4,
          isEventCapture: 1,
          zOrderIndex: 10,
          itemContainer: new ListItemContainerProperty({ itemCount: items.length, itemWidth: box.itemWidth, isItemSelectBorderEn: 1, itemName: items.map((i) => i.label) }),
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
  self(optionIndex?: number, turnId?: number) {
    // If it can't be matched to this turn's options it is still the wearer replying: close the turn either way.
    if (optionIndex === undefined || !this.view.said(optionIndex, turnId)) this.view.selfSpoke()
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

  // ── text ────────────────────────────────────────────────────────────────────

  private headerText(layout: Layout = this.layout): string {
    if (this.setup) return 'EN<>JP   x setup needed'
    if (layout === 'menu') return 'MENU   2x tap: close'
    if (layout === 'predictive') {
      const viewHint = this.view.hint()
      const hint = this.flash || (viewHint ? `${viewHint}  2x tap: menu` : HINT_BASE)
      return wrapLine(`${STATE_LABEL[this.state]}   ${hint}`.trimEnd())[0] ?? ''
    }
    const where = this.feed.cleared ? '  [cleared]' : ''
    return `EN<>JP   ${STATE_LABEL[this.state]}${where}`
  }

  /** The rows the body would show in the current mode (also used, blanked in places, behind the menu box). */
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

  private bodyText(layout: Layout = this.layout): string {
    const rows = this.baseRows()
    if (layout !== 'menu') return rows.join('\n')
    // The menu box is a list with no fill, so any text behind it would show through: blank those rows.
    const box = overlayGeometry(this.menu ?? [])
    const pad = this.mode === 'predictive' ? 2 : 4
    const shown = rows.map((row, i) => {
      const top = 32 + pad + i * ROW_PX
      return top + ROW_PX > box.y && top < box.y + box.height ? '' : row
    })
    return shown.some((r) => r.trim()) ? shown.join('\n') : ' '
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
