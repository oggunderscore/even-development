// Strip ANSI/VT100 escape sequences from PTY output for the G2 greyscale display.

export function stripAnsi(str: string): string {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')                   // CSI: colors, cursor, erase
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')       // OSC: window title, etc.
    .replace(/\x1b[^[\]]/g, '')                                // other ESC sequences
    .replace(/\r\n/g, '\n')                                    // normalize CRLF
    .replace(/\r/g, '\n')                                      // bare CR → LF
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')       // stray control chars
}
