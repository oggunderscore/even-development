// Convert voice transcript to a structured shell command.

import { makeLog } from './log'

const log = makeLog('parser')

export type ParsedCommand =
  | { type: 'ssh'; host: string; user?: string }
  | { type: 'shell'; command: string }
  | { type: 'cancel' }

const SSH_WITH_USER = [
  /ssh\s+into\s+(\S+)\s+as\s+(\S+)/i,
  /ssh\s+(\S+)\s+as\s+(\S+)/i,
  /connect\s+(?:to\s+)?(\S+)\s+as\s+(\S+)/i,
  /log\s*in\s+(?:to\s+)?(\S+)\s+as\s+(\S+)/i,
]

const SSH_NO_USER = [
  /ssh\s+into\s+(\S+)/i,
  /ssh\s+(\S+)/i,
  /connect\s+(?:to\s+)?(\S+)/i,
]

const CANCEL_EXACT = new Set(['cancel', 'nevermind', 'never mind', 'stop', 'abort', 'nothing'])

export function parseCommand(transcript: string): ParsedCommand {
  const t = transcript.trim()

  if (CANCEL_EXACT.has(t.toLowerCase())) {
    log.info(`"${t}" → cancel`)
    return { type: 'cancel' }
  }

  for (const re of SSH_WITH_USER) {
    const m = t.match(re)
    if (m) {
      log.info(`"${t}" → ssh ${m[2]}@${m[1]}`)
      return { type: 'ssh', host: m[1], user: m[2] }
    }
  }

  for (const re of SSH_NO_USER) {
    const m = t.match(re)
    if (m) {
      log.info(`"${t}" → ssh ${m[1]}`)
      return { type: 'ssh', host: m[1] }
    }
  }

  log.info(`"${t}" → shell command`)
  return { type: 'shell', command: t }
}
