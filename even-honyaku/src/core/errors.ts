// Errors that reach the user are a short generic sentence plus a code ("Replies: something went wrong (R-FORM)").
// What actually happened (provider, HTTP status, the provider's own error token) travels separately as `detail`, so a
// developer can read it from Settings -> "Copy error details" without the user ever seeing raw upstream or parser text.
//
// `detail` never holds a key, a transcript, a translation or a response body: only short tokens built here.

export type ErrorArea = 'translate' | 'replies' | 'speech' | 'check' | 'config'

export type ErrorKind =
  | 'NET' // could not reach the service
  | 'AUTH' // key rejected
  | 'RATE' // rate limited / out of credit
  | 'SVC' // the service failed (5xx, upstream error)
  | 'TIME' // took too long
  | 'FORM' // the answer could not be understood
  | 'EMPTY' // no answer at all
  | 'MODEL' // model not available
  | 'DECL' // the model declined
  | 'DICT' // romaji dictionary problem
  | 'UNK'

const AREA_LETTER: Record<ErrorArea, string> = { translate: 'T', replies: 'R', speech: 'S', check: 'K', config: 'C' }
const AREA_TEXT: Record<ErrorArea, string> = { translate: 'Translation', replies: 'Replies', speech: 'Speech', check: 'Key check', config: 'Setup' }
const KIND_TEXT: Record<ErrorKind, string> = {
  NET: 'no connection',
  AUTH: 'key rejected, check Settings',
  RATE: 'busy or out of credit',
  SVC: 'service problem',
  TIME: 'too slow',
  FORM: 'something went wrong',
  EMPTY: 'something went wrong',
  MODEL: 'model unavailable, check Settings',
  DECL: 'something went wrong',
  DICT: 'dictionary problem',
  UNK: 'something went wrong',
}

/** A failure with a kind and developer-only detail. Its `message` is the detail, so it must never be shown to the user. */
export class HonyakuError extends Error {
  constructor(
    readonly kind: ErrorKind,
    detail = '',
  ) {
    super(detail)
    this.name = 'HonyakuError'
  }
}

export interface AppError {
  /** "R-FORM": shown to the user, quoted to the developer. */
  ref: string
  /** The sentence the user sees. */
  message: string
  /** For the developer only (diagnostics log). */
  detail: string
}

const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,40}$/

/** The provider's own short error token ("rate_limit_error", 429...), if the body has one; never free text. */
export function upstreamTag(body: string): string {
  try {
    const o = JSON.parse(body) as { error?: unknown; type?: unknown; code?: unknown }
    const e = (o.error && typeof o.error === 'object' ? o.error : o) as { type?: unknown; code?: unknown; status?: unknown }
    for (const v of [e.type, e.code, e.status]) {
      if (typeof v === 'number') return String(v)
      if (typeof v === 'string' && SAFE_TOKEN.test(v)) return v
    }
  } catch {
    /* not JSON */
  }
  return ''
}

/** Failure of an HTTP call to a provider, from its status alone. */
export function httpError(service: string, status: number, body = ''): HonyakuError {
  const kind: ErrorKind =
    status === 401 || status === 403 ? 'AUTH' : status === 402 || status === 429 ? 'RATE' : status === 404 ? 'MODEL' : status === 408 || status === 504 ? 'TIME' : status >= 500 ? 'SVC' : 'UNK'
  const tag = upstreamTag(body)
  return new HonyakuError(kind, `${service} ${status}${tag && tag !== String(status) ? ` ${tag}` : ''}`)
}

/** Turn anything thrown into the code, message and detail. */
export function describeError(area: ErrorArea, err: unknown, model?: string): AppError {
  let kind: ErrorKind = 'UNK'
  let detail: string
  if (err instanceof HonyakuError) {
    kind = err.kind
    detail = err.message
  } else if (err instanceof DOMException && err.name === 'AbortError') {
    kind = 'TIME'
    detail = 'aborted'
  } else if (err instanceof TypeError) {
    // fetch() rejects with a TypeError for a blocked or unreachable request; the message is not worth keeping.
    kind = 'NET'
    detail = 'fetch failed'
  } else {
    // Other messages can quote the text that failed (JSON.parse does), so keep only the error's type.
    detail = err instanceof Error ? err.name : typeof err
  }
  const ref = `${AREA_LETTER[area]}-${kind}`
  return { ref, message: `${AREA_TEXT[area]}: ${KIND_TEXT[kind]} (${ref})`, detail: model ? `${detail} model=${model}` : detail }
}

/** An authored message (not a caught error) that still gets a code, e.g. "missing key". */
export function codedMessage(ref: string, message: string): string {
  return `${message} (${ref})`
}
