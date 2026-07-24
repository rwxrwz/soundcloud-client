// Equalizer presets: built-in curves + shareable codes for custom ones.
// Gains are dB per band, matching EQ_BANDS = [60, 250, 1000, 4000, 12000].

export interface EqPreset {
  id: string          // "b:*" for built-ins, "u:*" for user presets
  name: string
  gains: number[]     // length 5, -12..12
}

const clampGain = (n: number) => Math.max(-12, Math.min(12, Math.round(n)))

// Copy-pasteable share code: "MZE1:" + base64(JSON.stringify({ n: name, g: [gains] }))
const PREFIX = 'MZE1:'

export function encodeEqPreset(name: string, gains: number[]): string {
  const json = JSON.stringify({ n: name, g: gains })
  return PREFIX + btoa(unescape(encodeURIComponent(json)))
}

export function decodeEqPreset(code: string): { name: string; gains: number[] } | null {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) return null
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(PREFIX.length)))))
    if (Array.isArray(obj.g) && obj.g.length === 5 && obj.g.every((n: unknown) => typeof n === 'number' && isFinite(n))) {
      return { name: String(obj.n || 'Preset').slice(0, 40), gains: (obj.g as number[]).map(clampGain) }
    }
  } catch { /* invalid */ }
  return null
}
