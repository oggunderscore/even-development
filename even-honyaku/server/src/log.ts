// Timestamped console logging for the server, plugged into the shared core's log sink.

import { setLogSink } from '../../src/core/log'

const stamp = () => new Date().toISOString().slice(11, 23)

export const log = (tag: string, ...args: unknown[]) => console.log(stamp(), `[${tag}]`, ...args)
export const warn = (tag: string, ...args: unknown[]) => console.warn(stamp(), `[${tag}] ⚠`, ...args)

setLogSink(log, warn)
