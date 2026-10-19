// A short, memory-only record of what went wrong this session, for the developer. The user sees only a code and a
// generic sentence; "Copy error details" in Settings hands this text over when they choose to send it.
//
// Entries hold the error code, a few words of detail built in core/errors.ts (provider, HTTP status, the provider's own
// error token) and a time. Never a key, audio, transcript, translation or response body, and never written to disk.

const MAX_ENTRIES = 30

interface Entry {
  at: number
  ref: string
  detail: string
}

const log: Entry[] = []

export function recordError(ref: string | undefined, detail: string | undefined, at = Date.now()) {
  log.push({ at, ref: ref ?? 'UNCODED', detail: (detail ?? '').slice(0, 120) })
  if (log.length > MAX_ENTRIES) log.shift()
}

export const errorCount = () => log.length

export function clearErrors() {
  log.length = 0
}

export interface Context {
  version: string
  provider: string
  model?: string
  mode: string
}

export function diagnosticsReport(ctx: Context): string {
  const head = `Honyaku v${ctx.version} | ${ctx.provider}${ctx.model ? ` ${ctx.model}` : ''} | ${ctx.mode}`
  if (!log.length) return `${head}\nNo errors recorded this session.`
  return [head, ...log.map((e) => `${new Date(e.at).toISOString()} ${e.ref} ${e.detail}`.trimEnd())].join('\n')
}
