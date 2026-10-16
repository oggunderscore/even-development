// Timestamped console logger. Set DEBUG_AUDIO=1 to also log every audio chunk.

export const log = (tag: string, ...args: unknown[]) =>
  console.log(new Date().toISOString().slice(11, 23), `[${tag}]`, ...args)

export const warn = (tag: string, ...args: unknown[]) =>
  console.warn(new Date().toISOString().slice(11, 23), `[${tag}] ⚠`, ...args)
