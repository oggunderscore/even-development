// PTY session manager — owns all pseudo-terminal lifecycles.

import * as pty from 'node-pty'
import { makeLog } from './log'

const log = makeLog('pty')

interface Session {
  proc: pty.IPty
  listeners: Array<(data: string) => void>
}

export class PtyManager {
  private readonly sessions = new Map<string, Session>()

  spawn(id: string): void {
    this.kill(id)
    const shell = process.env['SHELL']
      ?? process.env['COMSPEC']
      ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/sh')
    log.info(`spawn shell  id=${id}  shell=${shell}`)
    this._create(id, shell, [])
  }

  spawnSsh(id: string, host: string, user: string): void {
    this.kill(id)
    log.info(`spawn ssh    id=${id}  target=${user}@${host}`)
    this._create(id, 'ssh', [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=no',
      `${user}@${host}`,
    ])
  }

  addListener(id: string, fn: (data: string) => void): boolean {
    const s = this.sessions.get(id)
    if (!s) { log.warn(`addListener: session ${id} not found`); return false }
    s.listeners.push(fn)
    return true
  }

  write(id: string, data: string): boolean {
    const s = this.sessions.get(id)
    if (!s) { log.warn(`write: session ${id} not found`); return false }
    log.info(`→ PTY  id=${id}  cmd="${data.slice(0, 80)}"`)
    s.proc.write(data + '\r')
    return true
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    log.info(`kill  id=${id}`)
    try { s.proc.kill() } catch { /* already exited */ }
    this.sessions.delete(id)
  }

  list(): string[] {
    return [...this.sessions.keys()]
  }

  killAll(): void {
    log.info(`killAll  sessions=${this.list().join(', ')}`)
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  private _create(id: string, file: string, args: string[]): void {
    const proc = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: 60,
      rows: 10,
      cwd: process.env['HOME'] ?? '/',
      env: process.env as Record<string, string>,
    })

    const session: Session = { proc, listeners: [] }
    this.sessions.set(id, session)

    let totalBytes = 0
    proc.onData((data) => {
      totalBytes += data.length
      // Log every ~4KB of output so we know data is flowing without flooding
      if (totalBytes % 4096 < data.length) {
        log.info(`← PTY  id=${id}  total=${(totalBytes / 1024).toFixed(1)}KB`)
      }
      for (const fn of session.listeners) fn(data)
    })

    proc.onExit(({ exitCode }) => {
      log.info(`exited  id=${id}  code=${exitCode}  total=${(totalBytes / 1024).toFixed(1)}KB`)
      this.sessions.delete(id)
    })
  }
}
