// OSC 777 notifications — writes to /dev/tty so Warp picks them up even when
// this process is running with stdout/stderr redirected (e.g. launched as MCP stdio).
// Only works when there is a controlling terminal (i.e. started from inside Warp).

import * as fs from 'fs'

let ttyFd: number | null = null
try {
  ttyFd = fs.openSync('/dev/tty', 'r+')
} catch {
  // Not running in a terminal — notifications silently suppressed
}

export function warpNotify(title: string, body: string): void {
  if (ttyFd === null) return
  const clean = (s: string) => s.replace(/[;\x07\x1b]/g, ' ').slice(0, 80)
  try {
    fs.writeSync(ttyFd, `\x1b]777;notify;${clean(title)};${clean(body)}\x07`)
  } catch {
    ttyFd = null
  }
}
