// Phone-side companion UI inside the WebView: the translation feed, hold-to-talk, typed input, and Settings
// (the user's own API keys, with a Test button). All DOM is built with textContent — no innerHTML —
// so text from the network or from a key field can never inject markup.

import { profileQuality, seedCount } from './core/voice'
import type { Prompt } from './enroll'
import type { AppMode, Direction, JpLevel, Prediction, Provider, ReplyOption, ReplyStyle, ServerMsg, Speaker, Translation, VoiceProfile } from './protocol'
import { type Settings, normalizeSettings, setupSteps } from './settings'

export type Phase = 'idle' | 'paused' | 'listening' | 'talking' | 'processing'
export type View = 'feed' | 'voice' | 'settings'
export type LabState = 'idle' | 'enroll' | 'test'

export interface PhoneUiHandlers {
  onHoldStart(): void
  onHoldEnd(): void
  /** Pause / resume always-on listening. */
  onToggleListen(): void
  onTyped(text: string): void
  /** Settings form submitted. `test` = also run the connection test afterwards. */
  onSave(settings: Settings, opts: { test: boolean }): void
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

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const MAX_ENTRIES = 80

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
  private spinnerTimer: ReturnType<typeof setInterval> | undefined

  constructor(private readonly handlers: PhoneUiHandlers, initial: Settings) {
    this.base = initial
    this.wireHold()
    this.wireTabs()
    this.wireSettings()
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
    this.wireSeg('seg-provider', (v) => this.setProvider(v as Provider))
    // Live checklist: tick steps off as the user pastes keys.
    for (const id of ['set-deepgram', 'set-google', 'set-openrouter', 'set-anthropic']) {
      $<HTMLInputElement>(id).addEventListener('input', () => this.renderSetup())
    }

    $<HTMLFormElement>('settings').addEventListener('submit', (e) => {
      e.preventDefault()
      this.submit(true)
    })
    $('btn-save').addEventListener('click', () => this.submit(false))
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
    this.renderSetup()
  }

  /** "? HOW TO GET ONE" toggles the step-by-step panel under a key field. */
  private wireHelp() {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.help')) {
      btn.addEventListener('click', () => {
        const panel = $(btn.dataset['help']!)
        const open = !panel.classList.contains('open')
        panel.classList.toggle('open', open)
        btn.setAttribute('aria-expanded', String(open))
        btn.textContent = open ? '× HIDE' : '? HOW TO GET ONE'
      })
    }
  }

  /** The SETUP card: a ✓ / ○ checklist from what's currently in the form, and a done state. */
  private renderSetup() {
    const steps = setupSteps(normalizeSettings(this.readSettings()))
    for (const step of steps) {
      document.querySelector(`.steps [data-step="${step.id}"]`)?.classList.toggle('done', step.done)
    }
    const done = steps.every((s) => s.done)
    const card = $('setup-card')
    card.dataset['done'] = String(done)
    $('setup-title').textContent = done ? 'SETUP COMPLETE' : 'SETUP'
    $('setup-lead').textContent = done
      ? 'All set. Tap SAVE & TEST to check the keys, then head to FEED.'
      : 'Two keys and you are done. They are your own accounts, so usage is billed to you.'
  }

  /** Fill the form from stored settings. */
  setSettings(s: Settings) {
    this.base = s
    $<HTMLInputElement>('set-deepgram').value = s.deepgramKey
    $<HTMLInputElement>('set-google').value = s.googleKey
    $<HTMLInputElement>('set-openrouter').value = s.openrouterKey
    $<HTMLInputElement>('set-anthropic').value = s.anthropicKey
    $<HTMLInputElement>('set-model').value = s.openrouterModel
    this.setProvider(s.provider)
    this.renderSetup()
    this.setSeg('seg-mode', s.mode)
    this.setSeg('seg-style', s.replyStyle)
    this.setSeg('seg-level', s.jpLevel)
    this.setSeg('seg-options', String(s.maxOptions))
    this.setSeg('seg-kana', s.glassesKana ? 'kana' : 'romaji')
    this.setSeg('seg-filter', s.voiceFilter ? 'on' : 'off')
    $<HTMLInputElement>('set-strict').value = String(Math.round(s.voiceStrictness * 100))
    $('strict-val').textContent = `${Math.round(s.voiceStrictness * 100)}%`
  }

  readSettings(): Settings {
    const v = (id: string) => $<HTMLInputElement>(id).value.trim()
    const key = (id: string) => v(id).replace(/\s+/g, '') // pasted keys often carry a stray line break
    return {
      ...this.base,
      deepgramKey: key('set-deepgram'),
      provider: this.provider,
      googleKey: key('set-google'),
      openrouterKey: key('set-openrouter'),
      anthropicKey: key('set-anthropic'),
      openrouterModel: v('set-model'),
    }
  }

  private submit(test: boolean) {
    this.handlers.onSave(this.readSettings(), { test })
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

  // ── test results ───────────────────────────────────────────────────────────

  /** Spinner row while the test runs. */
  showTesting() {
    this.stopSpinner()
    const box = $('results')
    box.replaceChildren()
    const row = this.resultRow('pending', '', 'working', 'connecting and checking keys')
    box.append(row)
    const mark = row.querySelector('.mark')!
    let i = 0
    this.spinnerTimer = setInterval(() => (mark.textContent = SPINNER[i++ % SPINNER.length]!), 80)
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  showResults(results: { service: string; ok: boolean; detail: string }[]) {
    this.stopSpinner()
    const box = $('results')
    box.replaceChildren()
    results.forEach((r, i) => {
      const row = this.resultRow(r.ok ? 'ok' : 'fail', r.ok ? '✓' : '✗', r.service.toUpperCase(), r.detail)
      row.style.animationDelay = `${i * 90}ms`
      box.append(row)
    })
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  private stopSpinner() {
    clearInterval(this.spinnerTimer)
    this.spinnerTimer = undefined
  }

  private resultRow(kind: string, mark: string, service: string, detail: string): HTMLElement {
    const row = document.createElement('div')
    row.className = `result ${kind}`
    const m = document.createElement('span')
    m.className = 'mark'
    m.textContent = mark
    const s = document.createElement('span')
    s.className = 'svc'
    s.textContent = service
    const d = document.createElement('span')
    d.className = 'detail'
    d.textContent = detail
    row.append(m, s, d)
    return row
  }
}
