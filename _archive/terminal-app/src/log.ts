// Lightweight logger for the G2 app (runs in iPhone WebView / simulator).
//
// Output appears in:
//   Simulator → open DevTools in the simulator window (F12 or right-click → Inspect)
//   Real device → Even Hub app debug console
//
// Format: +1.23s [module] message

const T0 = Date.now()
const t = () => `+${((Date.now() - T0) / 1000).toFixed(2)}s`

export function makeLog(mod: string) {
  const p = `[${mod}]`
  return {
    info:  (...a: unknown[]) => console.log(t(), p, ...a),
    warn:  (...a: unknown[]) => console.warn(t(), p, ...a),
    error: (...a: unknown[]) => console.error(t(), p, ...a),
  }
}
