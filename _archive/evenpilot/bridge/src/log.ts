// Logger for the bridge daemon (Node.js terminal output).
//
// Format: +1.234s [module      ] message

const T0 = Date.now()
const t = () => {
  const ms = Date.now() - T0
  return `+${(ms / 1000).toFixed(3)}s`
}

export function makeLog(mod: string) {
  const p = `[${mod}]`.padEnd(14)
  return {
    info:  (...a: unknown[]) => console.log(t(), p, ...a),
    warn:  (...a: unknown[]) => console.warn(t(), p, ...a),
    error: (...a: unknown[]) => console.error(t(), p, ...a),
  }
}
