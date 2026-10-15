// Phone-side companion UI inside the WebView. Unlike the glasses it can render Japanese script,
// and it hosts the real press-and-hold control.

import type { Direction, Translation } from './protocol'

export interface PhoneUiHandlers {
  onHoldStart(): void
  onHoldEnd(): void
  onMode(dir: Direction): void
  onTyped(text: string): void
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

export class PhoneUi {
  private readonly hold = $<HTMLButtonElement>('hold')
  private readonly log = $<HTMLElement>('log')
  private readonly conn = $<HTMLElement>('conn')
  private liveEl: HTMLElement | null = null

  constructor(handlers: PhoneUiHandlers) {
    const hold = this.hold
    let holding = false
    const end = () => {
      if (!holding) return
      holding = false
      handlers.onHoldEnd()
    }
    hold.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      hold.setPointerCapture(e.pointerId)
      holding = true
      handlers.onHoldStart()
    })
    hold.addEventListener('pointerup', end)
    hold.addEventListener('pointercancel', end)
    hold.addEventListener('lostpointercapture', end)
    hold.addEventListener('contextmenu', (e) => e.preventDefault())

    $('mode-speak').addEventListener('click', () => handlers.onMode('speak'))
    $('mode-listen').addEventListener('click', () => handlers.onMode('listen'))

    const form = $<HTMLFormElement>('typed')
    const input = $<HTMLInputElement>('typed-text')
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      handlers.onTyped(text)
    })
  }

  setConnected(ok: boolean) {
    this.conn.textContent = ok ? 'connected' : 'offline'
    this.conn.classList.toggle('on', ok)
  }

  setMode(dir: Direction) {
    $('mode-speak').setAttribute('aria-selected', String(dir === 'speak'))
    $('mode-listen').setAttribute('aria-selected', String(dir === 'listen'))
  }

  setPhase(phase: 'idle' | 'listening' | 'processing') {
    this.hold.classList.toggle('rec', phase === 'listening')
    this.hold.disabled = phase === 'processing'
    this.hold.textContent =
      phase === 'listening' ? 'Listening… release to translate' : phase === 'processing' ? 'Translating…' : 'Hold to talk'
  }

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
      this.liveEl = document.createElement('div')
      this.liveEl.className = 'item live'
      this.log.append(this.liveEl)
    }
    this.liveEl.textContent = `${dir === 'speak' ? 'You' : 'JP'}: ${text}…`
    this.scroll()
  }

  addTranslation(t: Translation) {
    this.setLive(t.dir, '')
    const el = document.createElement('div')
    el.className = 'item'
    const big = document.createElement('div')
    big.className = 'big'
    const sub = document.createElement('div')
    sub.className = 'sub'
    if (t.dir === 'speak') {
      big.textContent = t.romaji
      sub.textContent = `${t.english} · ${t.japanese}`
    } else {
      big.textContent = t.english
      sub.textContent = `${t.japanese} · ${t.romaji}`
    }
    el.append(big, sub)
    this.log.append(el)
    this.scroll()
  }

  addError(message: string) {
    const el = document.createElement('div')
    el.className = 'item sub'
    el.textContent = `⚠ ${message}`
    this.log.append(el)
    this.scroll()
  }

  private scroll() {
    this.log.scrollTop = this.log.scrollHeight
  }
}
