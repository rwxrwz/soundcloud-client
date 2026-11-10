import { useEffect, useRef, useState } from 'react'
import { useSettings, normalizeHex, hexToRgb, rgbToHex } from '../store'
import { useT } from '../i18n'

/* The rainbow ring around the current custom colour. Used both in Settings and
   in the quick-customize popover, so the "your own colour" slot looks the same
   in both places. */
export function CustomAccentSwatch({ hex, active, onClick, size = 32 }: {
  hex: string; active: boolean; onClick: () => void; size?: number
}) {
  const t = useT()
  return (
    <button
      onClick={onClick}
      title={t('accentCustom')}
      className="rounded-full relative shrink-0 transition-all duration-200"
      style={{
        width: size, height: size, padding: 2,
        background: 'conic-gradient(from 0deg, #ff5500, #ec4899, #a855f7, #6366f1, #3b82f6, #06b6d4, #22c55e, #eab308, #ff5500)',
        transform: active ? 'scale(1.18)' : 'scale(1)',
        boxShadow: active ? `0 0 8px 1px ${hex}66` : undefined,
      }}
    >
      <span className="block w-full h-full rounded-full" style={{ background: hex }} />
      {active && (
        <svg className="absolute inset-0 m-auto w-3.5 h-3.5 text-white drop-shadow" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/* RGB <-> HSV. The picker field needs HSV because a saturation/value square at a
   fixed hue is the only layout where every colour is one click away; RGB is what
   the sliders and the hex field speak. Both directions are lossless enough that
   round-tripping through the square does not drift the colour. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const i = Math.floor((((h % 360) + 360) % 360) / 60)
  const [r1, g1, b1] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i]
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)]
}

export function CustomAccentEditor() {
  const { customAccent, setCustomAccent, setAccent, savedAccents, saveAccent, removeSavedAccent } = useSettings()
  const t = useT()

  const [r, g, b] = hexToRgb(customAccent)
  const [h, s, v] = rgbToHsv(r, g, b)

  // A pure grey has no hue at all, so reading it back would snap the strip to
  // red every time the user drags into the left edge or the bottom of the
  // square. The strip therefore keeps its own hue and only follows the colour
  // when the colour actually carries one.
  const [hue, setHue] = useState(h)
  useEffect(() => { if (s > 0.01) setHue(h) }, [h, s])

  // The hex field holds free text while being typed and only commits once the
  // text parses. Pulling the stored value back in is skipped while the field
  // has focus - otherwise the normalised form would overwrite the half-typed
  // one between keystrokes and throw the caret to the end.
  const hexRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(customAccent)
  useEffect(() => { if (document.activeElement !== hexRef.current) setDraft(customAccent) }, [customAccent])
  const draftValid = !!normalizeHex(draft)

  const apply = (nr: number, ng: number, nb: number) => setCustomAccent(rgbToHex(nr, ng, nb))

  const svRef = useRef<HTMLDivElement>(null)
  const pickSv = (clientX: number, clientY: number) => {
    const el = svRef.current
    if (!el) return
    const box = el.getBoundingClientRect()
    const [nr, ng, nb] = hsvToRgb(hue, clamp01((clientX - box.left) / box.width), 1 - clamp01((clientY - box.top) / box.height))
    apply(nr, ng, nb)
  }

  const channels: [string, number, (n: number) => void, string, string][] = [
    ['R', r, n => apply(n, g, b), `rgb(0,${g},${b})`, `rgb(255,${g},${b})`],
    ['G', g, n => apply(r, n, b), `rgb(${r},0,${b})`, `rgb(${r},255,${b})`],
    ['B', b, n => apply(r, g, n), `rgb(${r},${g},0)`, `rgb(${r},${g},255)`],
  ]

  return (
    <div className="mt-3 rounded-xl p-3 space-y-3 page-enter"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>

      {/* Saturation / brightness field at the current hue */}
      <div
        ref={svRef}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pickSv(e.clientX, e.clientY) }}
        onPointerMove={e => { if (e.buttons & 1) pickSv(e.clientX, e.clientY) }}
        className="relative w-full rounded-lg cursor-crosshair"
        style={{
          height: 132, touchAction: 'none',
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hue} 100% 50%))`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.1)',
        }}
      >
        <span className="absolute rounded-full pointer-events-none"
          style={{
            width: 14, height: 14, left: `${s * 100}%`, top: `${(1 - v) * 100}%`,
            transform: 'translate(-50%, -50%)',
            background: customAccent,
            boxShadow: '0 0 0 2px #fff, 0 1px 5px rgba(0,0,0,0.6)',
          }} />
      </div>

      {/* Hue */}
      <input
        type="range" min={0} max={360} step={1} value={Math.round(hue)} className="chan-slider"
        onChange={e => { const nh = Number(e.target.value); setHue(nh); const [nr, ng, nb] = hsvToRgb(nh, s, v); apply(nr, ng, nb) }}
        style={{ '--track': 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)' } as React.CSSProperties}
      />

      {/* Channels */}
      <div className="space-y-1.5">
        {channels.map(([label, val, set, from, to]) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className="w-3 text-[11px] font-semibold text-white/40">{label}</span>
            <input
              type="range" min={0} max={255} step={1} value={val} className="chan-slider flex-1"
              onChange={e => set(Number(e.target.value))}
              style={{ '--track': `linear-gradient(to right, ${from}, ${to})` } as React.CSSProperties}
            />
            <span className="w-8 text-right text-[11px] text-white/50 tabular-nums">{val}</span>
          </div>
        ))}
      </div>

      {/* Hex + save */}
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg shrink-0" style={{ background: customAccent, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)' }} />
        <input
          ref={hexRef}
          value={draft}
          spellCheck={false}
          maxLength={7}
          placeholder="#ff5500"
          onChange={e => { setDraft(e.target.value); const hex = normalizeHex(e.target.value); if (hex) setCustomAccent(hex) }}
          onBlur={() => setDraft(customAccent)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-sm text-white/85 tabular-nums outline-none transition-colors"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${draftValid ? 'rgba(255,255,255,0.1)' : 'rgba(239,68,68,0.55)'}`,
          }}
        />
        <button
          onClick={() => saveAccent(customAccent)}
          disabled={savedAccents.includes(customAccent)}
          title={t('saveColor')}
          className="icon-btn shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white/70 hover:text-white transition-all disabled:opacity-30"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
          </svg>
        </button>
      </div>

      {savedAccents.length > 0 && (
        <div className="pt-0.5">
          <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5">{t('savedColors')}</p>
          <div className="flex flex-wrap gap-2">
            {savedAccents.map(hex => (
              <div key={hex} className="relative group">
                <button
                  onClick={() => { setCustomAccent(hex); setAccent('custom') }}
                  title={hex}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: hex,
                    boxShadow: customAccent === hex
                      ? '0 0 0 2px rgba(255,255,255,0.75)'
                      : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
                  }}
                />
                <button
                  onClick={() => removeSavedAccent(hex)}
                  title={t('delete')}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[11px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(16,16,22,0.95)', color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.18)' }}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
