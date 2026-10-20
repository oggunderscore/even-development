// A stand-in for an OpenRouter chat-completions answer: plain JSON for a normal call, server-sent events (one chunk per
// line) when the request asked for a stream.
export function chatResponse(init: RequestInit | undefined, content: string): Response {
  const body = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean }
  if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  const pieces = content.split(/(?<=\n)/)
  const events = pieces.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('')
  return new Response(`${events}data: [DONE]\n\n`, { status: 200 })
}
