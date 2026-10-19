// Phone-side companion UI inside the WebView: the translation feed, hold-to-talk, typed input, and Settings
// (the user's own API keys, with a Test button). All DOM is built with textContent — no innerHTML —
// so text from the network or from a key field can never inject markup.

import { keyProblem } from './core/config'
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_MODELS, type ModelChoice, OPENROUTER_DEFAULT_MODEL, OPENROUTER_MODELS, costText, findModel, modelLabel, priceText } from './core/models'
import { profileQuality, seedCount } from './core/voice'
import type { Prompt } from './enroll'
import type { AppMode, Direction, JpLevel, Prediction, Provider, ReplyOption, ReplyStyle, ServerMsg, Speaker, TestScope, Translation, VoiceProfile } from './protocol'
import { PROVIDER_NAME } from './core/probes'
import type { Settings } from './settings'

export type Phase = 'idle' | 'paused' | 'listening' | 'talking' | 'processing'
export type View = 'feed' | 'voice' | 'settings'
export type LabState = 'idle' | 'enroll' | 'test'

export interface PhoneUiHandlers {
  onHoldStart(): void
  onHoldEnd(): void
  /** Pause / resume always-on listening. */
  onToggleListen(): void
  onTyped(text: string): void
  /** Something in the settings form changed (a key a moment after typing stops, a provider or model at once). Saved by the app. */
  onChange(settings: Settings): void
  /** A key field is being edited: whatever was shown about its old value is out of date. */
  onEditing(scope: TestScope): void
  /** The romaji dictionary download failed and the user asked to try again. */
  onDictionaryRetry(): void
  /** A conversation / voice-filter preference changed; applies immediately (no SAVE). */
  onPrefs(patch: Partial<Settings>): void
  onEnroll(): void
  onEnrollSkip(): void
  /** Stop a running enrollment or live test. */
  onLabStop(): void
  onVoiceTest(): void
  onVoiceDelete(): void
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const STATUS_TEXT: Record<Phase | 'offline', string> = {
  offline: 'OFFLINE',
  idle: 'PAUSED',
  paused: 'PAUSED',
  listening: 'LISTENING',
  talking: 'TALKING · EN',
  processing: 'TRANSLATING',
}

const PROVIDER_HINT: Record<Provider, string> = {
  google: 'Google Cloud Translation · literal · 500k chars/month free, then ~$20 per 1M',
  openrouter: 'any LLM via openrouter.ai · better tone and context · pay per token',
  anthropic: 'Claude directly · best tone and context · pay per token',
}

const MAX_ENTRIES = 80

/** How long after the last keystroke a key is saved and checked. A paste, or leaving the field, doesn't wait. */
const COMMIT_DELAY_MS = 1200
/** While typing, a key shorter than this isn't judged yet (the full check runs when typing stops). */
const MIN_JUDGE_LEN = 8
const KEY_FIELDS = ['set-deepgram', 'set-google', 'set-openrouter', 'set-anthropic']
const FIELD_NAME: Record<string, 'deepgram' | 'google' | 'openrouter' | 'anthropic'> = {
  'set-deepgram': 'deepgram',
  'set-google': 'google',
  'set-openrouter': 'openrouter',
  'set-anthropic': 'anthropic',
}

const pad = (n: number) => String(n).padStart(2, '0')
const clock = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export class PhoneUi {
  private readonly hold = $<HTMLButtonElement>('hold')
  private readonly log = $<HTMLElement>('log')
  private readonly empty = $<HTMLElement>('empty')
  private readonly status = $<HTMLElement>('status')
  private readonly listenBtn = $<HTMLButtonElement>('listen')
  private liveEl: HTMLElement | null = null
  private view: View = 'feed'
  private base: Settings
  private provider: Provider = 'google'
  private commitTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly handlers: PhoneUiHandlers, initial: Settings) {
    this.base = initial
    this.wireHold()
    this.wireTabs()
    this.wireSettings()
    this.wireGuide()
    this.wirePrefs()
    this.wireVoice()
    this.listenBtn.addEventListener('click', () => handlers.onToggleListen())
    $('open-settings').addEventListener('click', () => this.showView('settings'))

    const form = $<HTMLFormElement>('typed')
    const input = $<HTMLInputElement>('typed-text')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      handlers.onTyped(text)
    })

    $('app-version').textContent = `v${__APP_VERSION__}`

    this.setSettings(initial)
  }

  // ── status / controls ──────────────────────────────────────────────────────

  /** Header indicator, listen toggle and hold button, from one place so they can't disagree. */
  setStatus(connected: boolean, phase: Phase) {
    const state = !connected ? 'offline' : phase === 'idle' ? 'paused' : phase
    this.status.dataset['state'] = state
    $('status-text').textContent = STATUS_TEXT[connected ? phase : 'offline']

    const paused = phase === 'paused' || phase === 'idle'
    this.listenBtn.textContent = paused ? 'RESUME LISTENING' : 'PAUSE LISTENING'
    this.hold.classList.toggle('rec', phase === 'talking')
    $('hold').querySelector('.hold-label')!.textContent =
      phase === 'talking' ? 'RELEASE TO TRANSLATE' : phase === 'processing' ? 'TRANSLATING…' : 'HOLD TO TALK'
  }

  setNeedsKeys(needs: boolean) {
    $('needs-keys').hidden = !needs
  }

  showView(view: View) {
    if (view === this.view) return
    this.view = view
    for (const v of ['feed', 'voice', 'settings'] as const) {
      const on = v === view
      $(`view-${v}`).classList.toggle('active', on)
      $(`tab-${v}`).setAttribute('aria-selected', String(on))
    }
  }

  get currentView(): View {
    return this.view
  }

  private wireHold() {
    const hold = this.hold
    let holding = false
    const end = () => {
      if (!holding) return
      holding = false
      this.handlers.onHoldEnd()
    }
    hold.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      hold.setPointerCapture(e.pointerId)
      holding = true
      this.handlers.onHoldStart()
    })
    hold.addEventListener('pointerup', end)
    hold.addEventListener('pointercancel', end)
    hold.addEventListener('lostpointercapture', end)
    hold.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private wireTabs() {
    $('tab-feed').addEventListener('click', () => this.showView('feed'))
    $('tab-voice').addEventListener('click', () => this.showView('voice'))
    $('tab-settings').addEventListener('click', () => this.showView('settings'))
  }

  // ── feed ───────────────────────────────────────────────────────────────────

  /** Placeholder while a typed phrase is being translated. */
  markWorking() {
    this.setLive('speak', '…')
  }

  setLive(dir: Direction, text: string) {
    if (!text) {
      this.liveEl?.remove()
      this.liveEl = null
      return
    }
    if (!this.liveEl) {
      this.liveEl = this.entry('live', dir === 'speak' ? 'EN · HEARING' : 'JP · HEARING')
      this.append(this.liveEl)
    }
    this.liveEl.querySelector('.big')!.textContent = text
    this.scroll()
  }

  addTranslation(t: Translation) {
    this.setLive(t.dir, '')
    const el = this.entry(t.dir, t.dir === 'speak' ? 'EN → JP' : t.heardEnglish ? 'THEM · ENGLISH' : 'JP → EN')
    if (t.unsure) el.classList.add('unsure')
    const big = el.querySelector('.big')!
    const sub = el.querySelector('.sub') as HTMLElement
    if (t.dir === 'speak') {
      // The wearer reads the romaji aloud; the rest is for reference.
      big.textContent = t.romaji
      sub.append(this.span(t.english), ' · ', this.span(t.japanese))
    } else if (t.heardEnglish) {
      big.textContent = t.english
      sub.remove()
    } else {
      big.textContent = t.english
      sub.append(this.span(t.japanese), ' · ', this.bold(t.romaji))
    }
    this.append(el)
    this.scroll()
  }

  /** The suggested replies, under the translation they answer. */
  addPredictions(p: Prediction) {
    const el = this.entry('reply', p.kind === 'choice' ? 'REPLY · PICK ONE' : 'REPLY')
    el.querySelector('.big')!.remove()
    el.querySelector('.sub')!.remove()
    p.options.forEach((o, i) => {
      const row = document.createElement('div')
      row.className = 'opt'
      row.dataset['romaji'] = o.romaji
      const n = this.span(p.options.length > 1 ? String(i + 1) : '›')
      n.className = 'n'
      const gloss = this.span(o.gloss)
      gloss.className = 'gloss'
      const rom = this.span(o.romaji)
      rom.className = 'rom'
      row.append(n, gloss, rom)
      el.append(row)
    })
    this.append(el)
    this.scroll()
  }

  /** The wearer's own Japanese was recognised and left out of the conversation. */
  addSelf(text: string, option?: ReplyOption) {
    this.setLive('listen', '')
    if (option) {
      const rows = [...this.log.querySelectorAll<HTMLElement>('.entry.reply .opt')].reverse()
      rows.find((r) => r.dataset['romaji'] === option.romaji)?.classList.add('said')
    }
    const el = this.entry('self', option ? 'YOU · READ A REPLY' : 'YOU · JAPANESE (IGNORED)')
    el.querySelector('.big')!.textContent = text
    el.querySelector('.sub')!.remove()
    this.append(el)
    this.scroll()
  }

  addError(message: string) {
    this.addLine('err', 'ERROR', message)
  }

  addNote(message: string) {
    this.addLine('note', 'INFO', message)
  }

  private addLine(kind: 'err' | 'note', label: string, message: string) {
    const el = this.entry(kind, label)
    el.querySelector('.big')!.textContent = message
    el.querySelector('.sub')!.remove()
    this.append(el)
    this.scroll()
  }

  private entry(kind: string, label: string): HTMLElement {
    const el = document.createElement('div')
    el.className = `entry ${kind}`
    const meta = document.createElement('div')
    meta.className = 'entry-meta'
    meta.textContent = `${clock()}  ${label}`
    const big = document.createElement('div')
    big.className = 'big'
    const sub = document.createElement('div')
    sub.className = 'sub'
    el.append(meta, big, sub)
    return el
  }

  private span(text: string) {
    const s = document.createElement('span')
    s.textContent = text
    return s
  }

  private bold(text: string) {
    const b = document.createElement('b')
    b.textContent = text
    return b
  }

  private append(el: HTMLElement) {
    this.empty.hidden = true
    this.log.append(el)
    while (this.log.querySelectorAll('.entry').length > MAX_ENTRIES) this.log.querySelector('.entry')?.remove()
  }

  private scroll() {
    this.log.scrollTo({ top: this.log.scrollHeight, behavior: 'smooth' })
  }

  // ── settings ───────────────────────────────────────────────────────────────

  private wireSettings() {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.reveal')) {
      btn.addEventListener('click', () => {
        const input = $<HTMLInputElement>(btn.dataset['for']!)
        const show = input.type === 'password'
        input.type = show ? 'text' : 'password'
        btn.textContent = show ? 'HIDE' : 'SHOW'
        btn.setAttribute('aria-pressed', String(show))
      })
    }

    this.wireHelp()
    this.wireSeg('seg-provider', (v) => {
      this.setProvider(v as Provider)
      this.commit()
    })
    // Keys save themselves a moment after typing stops (or at once when the field loses focus), and get checked.
    for (const id of KEY_FIELDS) {
      const input = $<HTMLInputElement>(id)
      input.addEventListener('input', (e) => {
        const scope = this.scopeOf(id)
        if (scope) this.handlers.onEditing(scope)
        this.showFormatProblem(id, true)
        clearTimeout(this.commitTimer)
        // A paste is a whole key at once: save and check it now. Typing waits until you pause, so half a key isn't saved.
        if ((e as InputEvent).inputType === 'insertFromPaste') this.commit()
        else this.commitTimer = setTimeout(() => this.commit(), COMMIT_DELAY_MS)
      })
      input.addEventListener('change', () => this.commit())
    }
    $('dict-retry').addEventListener('click', () => this.handlers.onDictionaryRetry())
    $('set-model').addEventListener('change', () => this.commitModel())
    $('set-anthropic-model').addEventListener('change', () => this.commitModel())
    // No Save button: pressing Enter in a field just commits it.
    $<HTMLFormElement>('settings').addEventListener('submit', (e) => {
      e.preventDefault()
      this.commit()
    })
  }

  private wireSeg(id: string, onPick: (value: string) => void) {
    for (const btn of $(id).querySelectorAll<HTMLButtonElement>('button')) {
      btn.addEventListener('click', () => onPick(btn.dataset['v']!))
    }
  }

  private setSeg(id: string, value: string) {
    for (const btn of $(id).querySelectorAll<HTMLButtonElement>('button')) {
      btn.setAttribute('aria-checked', String(btn.dataset['v'] === value))
    }
  }

  private setProvider(p: Provider) {
    this.provider = p
    this.setSeg('seg-provider', p)
    $('provider-hint').textContent = PROVIDER_HINT[p]
    for (const row of document.querySelectorAll<HTMLElement>('.reveal-row[data-provider]')) {
      row.classList.toggle('open', row.dataset['provider'] === p)
    }
  }

  /** "? HOW TO GET ONE" toggles the step-by-step panel under a key field. */
  private wireHelp() {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.help')) {
      btn.addEventListener('click', () => {
        const panel = $(btn.dataset['help']!)
        const open = !panel.classList.contains('open')
        panel.classList.toggle('open', open)
        btn.setAttribute('aria-expanded', String(open))
        btn.textContent = open ? '× HIDE' : (btn.dataset['closedText'] ?? '? HOW TO GET ONE')
      })
    }
  }

  /** Fill the form from stored settings. */
  setSettings(s: Settings) {
    this.base = s
    $<HTMLInputElement>('set-deepgram').value = s.deepgramKey
    $<HTMLInputElement>('set-google').value = s.googleKey
    $<HTMLInputElement>('set-openrouter').value = s.openrouterKey
    $<HTMLInputElement>('set-anthropic').value = s.anthropicKey
    for (const id of KEY_FIELDS) $(id).classList.remove('invalid')
    this.fillModels('set-model', 'model-note', OPENROUTER_MODELS, OPENROUTER_DEFAULT_MODEL, s.openrouterModel)
    this.fillModels('set-anthropic-model', 'anthropic-model-note', ANTHROPIC_MODELS, ANTHROPIC_DEFAULT_MODEL, s.anthropicModel)
    this.fillCompare('compare-openrouter-list', OPENROUTER_MODELS)
    this.fillCompare('compare-anthropic-list', ANTHROPIC_MODELS)
    this.setProvider(s.provider)
    this.syncPrefs(s)
  }

  /**
   * Fill a model dropdown, best first. A model saved earlier that isn't on the list (an older version let you type any
   * id) stays selectable as "Custom", so upgrading never silently changes it.
   */
  private fillModels(selectId: string, noteId: string, list: ModelChoice[], defaultId: string, saved: string) {
    const select = $<HTMLSelectElement>(selectId)
    select.replaceChildren()
    list.forEach((m, i) => select.append(this.option(m.id, modelLabel(m, i + 1))))
    const current = saved || defaultId
    if (!findModel(list, current)) select.append(this.option(current, `Custom: ${current}`))
    select.value = current
    this.showModelNote(selectId, noteId, list)
  }

  /** The "compare models" panel: every model, best first, with its price, rough cost and why it ranks where it does. */
  private fillCompare(listId: string, list: ModelChoice[]) {
    $(listId).replaceChildren(
      ...list.map((m, i) => {
        const li = document.createElement('li')
        const head = document.createElement('b')
        head.textContent = `${m.name}${i === 0 ? ' ★ recommended' : ''}`
        const price = document.createElement('span')
        price.className = 'price'
        price.textContent = `${priceText(m)} per 1M tokens`
        const note = document.createElement('span')
        note.textContent = `${m.note} ${costText(m)}.`
        li.append(head, price, note)
        return li
      }),
    )
  }

  private option(value: string, label: string): HTMLOptionElement {
    const o = document.createElement('option')
    o.value = value
    o.textContent = label
    return o
  }

  private showModelNote(selectId: string, noteId: string, list: ModelChoice[]) {
    const m = findModel(list, $<HTMLSelectElement>(selectId).value)
    $(noteId).textContent = m ? `${priceText(m)} per 1M tokens: ${costText(m)}. ${m.note}` : 'A model you set earlier. It is kept as it is.'
  }

  /**
   * Show changed preferences (mode, style, …) without touching the key fields: the user may have pasted a key they
   * haven't saved yet, and changing a preference must not wipe it.
   */
  setPrefs(s: Settings) {
    this.base = { ...this.base, mode: s.mode, replyStyle: s.replyStyle, jpLevel: s.jpLevel, maxOptions: s.maxOptions, voiceFilter: s.voiceFilter, voiceStrictness: s.voiceStrictness, glassesKana: s.glassesKana }
    this.syncPrefs(s)
  }

  private syncPrefs(s: Settings) {
    this.setSeg('seg-mode', s.mode)
    this.setSeg('seg-style', s.replyStyle)
    this.setSeg('seg-level', s.jpLevel)
    this.setSeg('seg-options', String(s.maxOptions))
    this.setSeg('seg-kana', s.glassesKana ? 'kana' : 'romaji')
    this.setSeg('seg-filter', s.voiceFilter ? 'on' : 'off')
    $<HTMLInputElement>('set-strict').value = String(Math.round(s.voiceStrictness * 100))
    $('strict-val').textContent = `${Math.round(s.voiceStrictness * 100)}%`
  }

  /** The form's current values. A key that can't be real (wrong characters or length) is left out: the saved one stays. */
  readSettings(): Settings {
    const text = (id: string) => $<HTMLInputElement>(id).value.replace(/\s+/g, '') // pasted keys often carry a stray line break
    const key = (id: string, name: 'deepgram' | 'google' | 'openrouter' | 'anthropic', saved: string) => {
      const v = text(id)
      return keyProblem(name, v) ? saved : v
    }
    const modelOf = (id: string, saved: string, defaultId: string) => {
      const v = $<HTMLSelectElement>(id).value
      return v === defaultId && saved === '' ? '' : v // untouched default stays "default"
    }
    return {
      ...this.base,
      deepgramKey: key('set-deepgram', 'deepgram', this.base.deepgramKey),
      provider: this.provider,
      googleKey: key('set-google', 'google', this.base.googleKey),
      openrouterKey: key('set-openrouter', 'openrouter', this.base.openrouterKey),
      anthropicKey: key('set-anthropic', 'anthropic', this.base.anthropicKey),
      openrouterModel: modelOf('set-model', this.base.openrouterModel, OPENROUTER_DEFAULT_MODEL),
      anthropicModel: modelOf('set-anthropic-model', this.base.anthropicModel, ANTHROPIC_DEFAULT_MODEL),
    }
  }

  /** Mark a key field red, with the reason under it, as soon as what was typed can't be a key. Empty is fine (no key). */
  private showFormatProblem(id: string, typing = false) {
    const name = FIELD_NAME[id]!
    const input = $<HTMLInputElement>(id)
    const value = input.value.replace(/\s+/g, '')
    // Mid-typing a short key is just unfinished; only judge it once it is long enough to have a real problem.
    const problem = typing && value.length < MIN_JUDGE_LEN ? null : keyProblem(name, value)
    input.classList.toggle('invalid', problem !== null)
    const scope = this.scopeOf(id)
    if (problem && scope) this.setKeyStatus(scope, 'bad', `That doesn't look like a ${name === 'deepgram' ? 'Deepgram' : PROVIDER_NAME[name]} key (unexpected characters or length), so it was not saved.`)
  }

  /** Which status line a key field reports to: Deepgram's, or the translation one when it is the selected provider's key. */
  private scopeOf(id: string): TestScope | null {
    const name = FIELD_NAME[id]!
    return name === 'deepgram' ? 'stt' : name === this.provider ? 'translate' : null
  }

  /** Save what is in the form now. */
  private commit() {
    clearTimeout(this.commitTimer)
    for (const id of KEY_FIELDS) this.showFormatProblem(id)
    const next = this.readSettings()
    this.base = next
    this.handlers.onChange(next)
  }

  private commitModel() {
    this.showModelNote('set-model', 'model-note', OPENROUTER_MODELS)
    this.showModelNote('set-anthropic-model', 'anthropic-model-note', ANTHROPIC_MODELS)
    this.commit()
  }

  /** Show the app's provider choice (it switches provider itself when only one provider has a key). */
  showProvider(p: Provider) {
    this.base = { ...this.base, provider: p }
    this.setProvider(p)
  }

  /**
   * The romaji dictionary (Google Translate only): `downloading` shows a progress bar (0..1), `failed` offers a retry,
   * `ready` confirms, `idle` hides it.
   */
  setDictStatus(state: 'idle' | 'downloading' | 'ready' | 'failed', text = '', fraction = 0) {
    const el = $('status-dict')
    el.dataset['state'] = state === 'downloading' ? 'checking' : state === 'failed' ? 'bad' : state === 'ready' ? 'ok' : 'idle'
    el.textContent = state === 'idle' ? '' : text
    $('dict-meter').hidden = state !== 'downloading'
    ;($('dict-meter').firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`
    $('dict-retry').hidden = state !== 'failed'
  }

  /** The result of a key check, under the field it belongs to. `checking` shows while the answer is on its way. */
  setKeyStatus(scope: TestScope, state: 'idle' | 'checking' | 'ok' | 'bad', text = '') {
    const el = $(scope === 'stt' ? 'status-stt' : 'status-translate')
    el.dataset['state'] = state
    el.textContent = state === 'idle' ? '' : text
  }

  // ── controls guide ─────────────────────────────────────────────────────────

  private wireGuide() {
    const dialog = $('guide')
    const open = $('open-guide')
    const close = $('close-guide')
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, [tabindex]:not([tabindex="-1"])')]
    const hide = () => {
      dialog.hidden = true
      open.setAttribute('aria-expanded', 'false')
      open.focus()
    }
    open.addEventListener('click', () => {
      dialog.hidden = false
      open.setAttribute('aria-expanded', 'true')
      close.focus()
    })
    close.addEventListener('click', hide)
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) hide() // a tap on the dimmed area
    })
    document.addEventListener('keydown', (e) => {
      if (dialog.hidden) return
      if (e.key === 'Escape') return hide()
      if (e.key !== 'Tab') return
      const items = focusables()
      const first = items[0]
      const last = items.at(-1)
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    })
  }

  // ── conversation preferences ───────────────────────────────────────────────

  private wirePrefs() {
    const pick = (id: string, apply: (v: string) => Partial<Settings>) =>
      this.wireSeg(id, (v) => {
        this.setSeg(id, v)
        this.handlers.onPrefs(apply(v))
      })
    pick('seg-mode', (v) => ({ mode: v as AppMode }))
    pick('seg-style', (v) => ({ replyStyle: v as ReplyStyle }))
    pick('seg-level', (v) => ({ jpLevel: v as JpLevel }))
    pick('seg-options', (v) => ({ maxOptions: v === '2' ? 2 : 3 }))
    pick('seg-kana', (v) => ({ glassesKana: v === 'kana' }))
    pick('seg-filter', (v) => ({ voiceFilter: v === 'on' }))

    let timer: ReturnType<typeof setTimeout> | undefined
    const slider = $<HTMLInputElement>('set-strict')
    slider.addEventListener('input', () => {
      $('strict-val').textContent = `${slider.value}%`
      clearTimeout(timer)
      timer = setTimeout(() => this.handlers.onPrefs({ voiceStrictness: Number(slider.value) / 100 }), 250)
    })
  }

  // ── voice profile / live test ──────────────────────────────────────────────

  private labState: LabState = 'idle'
  private hasProfile = false
  private readonly verdictLog: HTMLElement[] = []

  private wireVoice() {
    $('btn-enroll').addEventListener('click', () => this.handlers.onEnroll())
    $('btn-enroll-skip').addEventListener('click', () => this.handlers.onEnrollSkip())
    $('btn-lab-stop').addEventListener('click', () => this.handlers.onLabStop())
    $('btn-voice-delete').addEventListener('click', () => this.handlers.onVoiceDelete())
    $('btn-voice-test').addEventListener('click', () => (this.labState === 'test' ? this.handlers.onLabStop() : this.handlers.onVoiceTest()))
    this.setLabState('idle')
  }

  /** The voice profile summary and the buttons that depend on whether one exists. */
  setVoiceProfile(p: VoiceProfile | null) {
    this.hasProfile = p !== null && seedCount(p) > 0
    const status = $('voice-status')
    if (!p || !this.hasProfile) {
      status.textContent =
        'No voice profile yet. Honyaku can still skip a reply it suggested when you read it aloud, but it cannot recognise your voice otherwise. Recording takes about a minute.'
    } else {
      const q = profileQuality(p)
      const learned = p.en.adapt.length + p.ja.adapt.length
      status.textContent = `Profile: ${q.label.toUpperCase()} · ${p.en.seed.length} English + ${p.ja.seed.length} Japanese samples${learned ? ` · ${learned} learned while you use it` : ''}.`
    }
    this.setLabState(this.labState)
  }

  setLabState(state: LabState) {
    this.labState = state
    const idle = state === 'idle'
    $('enroll').hidden = state !== 'enroll'
    $('btn-enroll').hidden = state === 'enroll'
    ;($('btn-enroll') as HTMLButtonElement).disabled = state === 'test'
    $('btn-enroll').textContent = this.hasProfile ? 'RE-RECORD MY VOICE' : 'RECORD MY VOICE'
    $('btn-enroll-skip').hidden = state !== 'enroll'
    $('btn-lab-stop').hidden = state !== 'enroll'
    $('btn-voice-delete').hidden = !idle || !this.hasProfile
    ;($('btn-voice-test') as HTMLButtonElement).disabled = state === 'enroll'
    $('btn-voice-test').textContent = state === 'test' ? 'STOP TEST' : 'START TEST'
    if (state === 'test') $('test-out').replaceChildren(this.testIdle('speak now — each phrase gets a verdict here'))
    if (state === 'idle' && !$('test-out').querySelector('.test-verdict')) $('test-out').replaceChildren(this.testIdle('no test running'))
    if (state === 'idle') this.setLabLevel(-90, false)
    if (state !== 'idle') this.setLabMessage('', '')
  }

  private testIdle(text: string) {
    const s = this.span(text)
    s.className = 'test-idle'
    return s
  }

  /** The prompt to read next (null = finished). */
  setEnrollStep(prompt: Prompt | null, index: number, total: number) {
    $('enroll-count').textContent = prompt ? `SENTENCE ${index + 1} OF ${total}` : 'DONE'
    $('enroll-lang').textContent = !prompt ? '' : prompt.lang === 'en' ? 'ENGLISH' : 'JAPANESE · READ IT AS YOU WOULD SAY IT'
    $('enroll-text').textContent = prompt?.text ?? ''
    $('enroll-text').lang = prompt?.lang ?? 'en'
    $('enroll-romaji').textContent = prompt?.romaji ?? ''
    $('enroll-meaning').textContent = prompt?.meaning ?? ''
    this.setLabMessage(prompt ? 'Read the sentence, then pause.' : '', '')
  }

  setLabLevel(db: number, speaking: boolean) {
    const bar = $('enroll-bar')
    bar.classList.toggle('speaking', speaking)
    ;(bar.firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, Math.max(0, (db + 70) / 50)) * 100)}%`
  }

  setLabMessage(text: string, kind: 'ok' | 'warn' | '') {
    const el = $('lab-msg')
    el.textContent = text
    el.className = `lab-msg ${kind}`.trim()
  }

  /** The live test's verdict for one phrase. */
  setTestResult(who: Speaker, voice: number | null, level: number | null, hasProfile: boolean) {
    const out = $('test-out')
    out.replaceChildren()
    const v = this.span(who === 'wearer' ? 'YOU' : who === 'other' ? 'SOMEONE ELSE' : 'NOT SURE')
    v.className = `test-verdict ${who}`
    out.append(v)
    if (!hasProfile) {
      out.append(this.testIdle('Record your voice profile first to get voice and level scores.'))
      return
    }
    out.append(this.scoreBar('VOICE', voice), this.scoreBar('LEVEL', level))
  }

  private scoreBar(label: string, value: number | null): HTMLElement {
    const row = document.createElement('div')
    row.className = 'score-bar'
    const bar = document.createElement('div')
    bar.className = 'meter'
    const fill = document.createElement('i')
    fill.style.width = `${Math.round((value ?? 0) * 100)}%`
    bar.append(fill)
    row.append(this.span(label), bar, this.span(value === null ? '—' : `${Math.round(value * 100)}`))
    return row
  }

  /** One line of the rolling verdict log (what the filter decided for each recognised phrase). */
  showVoiceScore(m: Extract<ServerMsg, { type: 'voice_score' }>) {
    const pct = (x: number | null) => (x === null ? '–' : String(Math.round(x * 100)))
    const row = document.createElement('div')
    row.className = 'row'
    const who = this.span(m.who === 'wearer' ? 'YOU' : m.who === 'other' ? 'THEM' : '?')
    who.className = `who ${m.who}`
    const txt = this.span(`${m.text}  [v${pct(m.voice)} l${pct(m.level)} e${Math.round(m.echo * 100)}]`)
    txt.className = 'txt'
    row.append(who, txt)
    const log = $('voice-log')
    log.prepend(row)
    this.verdictLog.unshift(row)
    while (this.verdictLog.length > 8) this.verdictLog.pop()?.remove()
  }
}
