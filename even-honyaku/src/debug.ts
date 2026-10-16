// On-screen + console debug log. The Even app WebView has no easy devtools, so lines also land in the
// collapsible "Debug" panel on the phone UI.

const MAX_LINES = 300
const lines: string[] = []

export function dbg(msg: string) {
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}`
  console.log('[honyaku]', msg)
  lines.push(line)
  if (lines.length > MAX_LINES) lines.shift()
  const el = document.getElementById('debug-log')
  if (el) {
    el.textContent = lines.join('\n')
    el.scrollTop = el.scrollHeight
  }
}
