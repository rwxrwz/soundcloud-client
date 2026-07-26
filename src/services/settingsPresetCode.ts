// Shareable codes for whole-settings presets: "SCS1:" + base64(JSON).
// Decoded data is UNTRUSTED - the store sanitises it before storing/applying.

const PREFIX = 'SCS1:'

export function encodeSettingsPreset(name: string, data: Record<string, unknown>): string {
  const json = JSON.stringify({ n: name, d: data })
  return PREFIX + btoa(unescape(encodeURIComponent(json)))
}

export function decodeSettingsPreset(code: string): { name: string; data: Record<string, unknown> } | null {
  const trimmed = code.trim()
  if (!trimmed.startsWith(PREFIX)) return null
  try {
    const obj = JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(PREFIX.length)))))
    if (obj && typeof obj === 'object' && obj.d && typeof obj.d === 'object') {
      return { name: String(obj.n || 'Preset').slice(0, 40), data: obj.d as Record<string, unknown> }
    }
  } catch { /* invalid */ }
  return null
}
