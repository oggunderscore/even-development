// STT client using the OpenAI Whisper API wire format.
// Compatible with: OpenAI, whisper.cpp --server, LocalAI, Ollama speech endpoints.

import { makeLog } from './log'

const log = makeLog('stt')

export interface SttConfig {
  endpoint: string
  apiKey?: string
  model?: string
}

export async function transcribe(audio: Blob, config: SttConfig): Promise<string> {
  const kb = (audio.size / 1024).toFixed(1)
  log.info(`sending ${kb}KB to ${config.endpoint}`)

  const form = new FormData()
  form.append('file', audio, 'audio.wav')
  if (config.model) form.append('model', config.model)

  const headers: Record<string, string> = {}
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`

  const res = await fetch(config.endpoint, { method: 'POST', headers, body: form })
  if (!res.ok) {
    const body = await res.text()
    log.error(`STT error ${res.status}: ${body.slice(0, 120)}`)
    throw new Error(`STT ${res.status}: ${body}`)
  }

  const data = (await res.json()) as { text?: string }
  const transcript = (data.text ?? '').trim()
  log.info(`transcript: "${transcript.slice(0, 100)}${transcript.length > 100 ? '…' : ''}"`)
  return transcript
}
