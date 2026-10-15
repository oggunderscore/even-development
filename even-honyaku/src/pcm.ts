// The host serialises the mic chunk across a JSON boundary, so audioPcm may show up as
// a Uint8Array, a number[], or a base64 string (see SDK typings). Normalise to bytes.

export function toBytes(pcm: unknown): Uint8Array | null {
  if (pcm instanceof Uint8Array) return pcm
  if (Array.isArray(pcm)) return Uint8Array.from(pcm as number[])
  if (typeof pcm === 'string') {
    const bin = atob(pcm)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return null
}
