// Logging for code that runs both on the server (timestamped console) and inside the app (debug panel).
// Each host installs a sink; nothing here may ever be handed a key or token.

type Sink = (tag: string, ...args: unknown[]) => void

let sinkLog: Sink = () => {}
let sinkWarn: Sink = () => {}

export function setLogSink(log: Sink, warn: Sink) {
  sinkLog = log
  sinkWarn = warn
}

export const log: Sink = (tag, ...args) => sinkLog(tag, ...args)
export const warn: Sink = (tag, ...args) => sinkWarn(tag, ...args)
