import { useEffect, useState } from 'react'
import { useSettings, useUI, ACCENT_COLORS, AccentColor, HeroAnim, BgStyle, Theme, FsLayout } from '../store'
import { useT } from '../i18n'

export function QuickCustomize() {
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const close = () => { if (closing) return; setClosing(true); setTimeout(() => { setOpen(false); setClosing(false) }, 140) }
  const { accent, setAccent, heroAnim, setHeroAnim, bgStyle, setBgStyle, theme, setTheme, wallpaperPath, setWallpaperPath, playerStyle, fsLayout, setFsLayout, fsShowLyrics, setFsShowLyrics, fsLiveBg, setFsLiveBg, fsBeatGlow, setFsBeatGlow, fsArtCrossfade, setFsArtCrossfade } = useSettings()
  const toggleLyrics = () => { const v = !fsShowLyrics; setFsShowLyrics(v); if (!v && fsLayout === 'stack') setFsLayout('side') }
  const { artRgb } = useUI()
  const t = useT()
  const artworkHex = `#${artRgb.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`

  const [walls, setWalls] = useState<{ name: string; path: string }[]>([])
  const loadWalls = () => { window.electronAPI?.listWallpapers?.().then(setWalls).catch(() => {}) }
  // Refresh the wallpaper list whenever the panel opens
  useEffect(() => { if (open) loadWalls() }, [open])

  const themes: [Theme, string][] = [
    ['default', t('themeDefault')], ['glass', t('themeGlass')], ['minimal', t('themeMinimal')],
  ]
  const anims: [HeroAnim, string][] = [
    ['wave', t('animWave')], ['threads', t('animThreads')], ['silk', t('animSilk')],
    ['mist', t('animMist')], ['weave', t('animWeave')], ['spectrum', t('animSpectrum')],
  ]
  const bgs: [BgStyle, string][] = [
    ['artwork', t('bgDynamic')], ['accent', t('bgAccent')], ['aurora', t('bgAurora')],
    ['midnight', t('bgMidnight')], ['dark', t('bgDark')],
  ]
  const layouts: [FsLayout, string][] = [
    ['side', t('fsSide')], ['stack', t('fsStack')], ['split', t('fsSplit')],
  ]
  const isFs = playerStyle === 'fullscreen'

  return (
    <div className="absolute z-30" style={{ right: 22, bottom: isFs ? 22 : 104 }}>
      {/* invisible click-catcher (no blur / no dimming) */}
      {open && <div className="fixed inset-0" onClick={close} />}

      {open && (
        <div
          className="absolute rounded-2xl"
          style={{
            bottom: '118%', right: 0, width: 300,
            maxHeight: '70vh', overflowY: 'auto',
            background: 'rgba(16,16,22,0.97)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 14px 44px rgba(0,0,0,0.55)',
            transformOrigin: 'bottom right',
            animation: closing ? 'scale-out 0.13s ease forwards' : 'scale-in 0.14s ease',
          }}
        >
          <div className="p-4 space-y-4">
            <Sec title={t('accentColor')}>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(ACCENT_COLORS) as [AccentColor, string][]).map(([k, hex]) => (
                  <Swatch key={k} hex={hex} active={accent === k} onClick={() => setAccent(k)} ring={k === 'white'} />
                ))}
                <Swatch hex={artworkHex} active={accent === 'artwork'} onClick={() => setAccent('artwork')} dashed />
              </div>
            </Sec>

            <Sec title={t('theme')}>
              <Chips items={themes} active={theme} onPick={setTheme} />
            </Sec>

            {isFs && (
              <Sec title={t('fsLayoutLabel')}>
                <Chips items={layouts} active={fsLayout} onPick={setFsLayout} disabled={fsShowLyrics ? undefined : ['stack']} />
                <div className="space-y-2 mt-3">
                  <PToggle label={t('fsShowLyrics')} active={fsShowLyrics} onClick={toggleLyrics} />
                  <PToggle label={t('fsLiveBg')} active={fsLiveBg && bgStyle !== 'wallpaper'} disabled={bgStyle === 'wallpaper'} onClick={() => setFsLiveBg(!fsLiveBg)} />
                  <PToggle label={t('fsBeatGlow')} active={fsBeatGlow} onClick={() => setFsBeatGlow(!fsBeatGlow)} />
                  <PToggle label={t('fsCrossfade')} active={fsArtCrossfade} onClick={() => setFsArtCrossfade(!fsArtCrossfade)} />
                </div>
              </Sec>
            )}

            {!isFs && (
              <Sec title={t('heroAnimation')}>
                <Chips items={anims} active={heroAnim} onPick={setHeroAnim} />
              </Sec>
            )}

            <Sec title={t('background')}>
              <Chips items={bgs} active={bgStyle} onPick={setBgStyle} />
            </Sec>

            <Sec title={t('videoWallpapers')}>
              <div className="grid grid-cols-2 gap-1.5">
                <WallChip label={t('wallpaperNone')} active={bgStyle !== 'wallpaper'} none
                  onClick={() => setBgStyle('artwork')} />
                {walls.map(w => (
                  <WallChip key={w.path} label={w.name}
                    active={bgStyle === 'wallpaper' && wallpaperPath === w.path}
                    onClick={() => { setWallpaperPath(w.path); setBgStyle('wallpaper') }} />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <MiniBtn label={t('openFolder')} onClick={() => window.electronAPI?.openWallpapers?.()} />
                <MiniBtn label={t('refreshList')} onClick={loadWalls} />
              </div>
            </Sec>
          </div>
        </div>
      )}

      <button
        onClick={() => (open ? close() : setOpen(true))}
        title={t('catAppearance')}
        className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 hover:scale-105"
        style={{
          background: open ? 'var(--accent)' : 'rgba(20,20,26,0.9)',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 6px 22px rgba(0,0,0,0.45)',
          color: open ? '#fff' : 'rgba(255,255,255,0.85)',
        }}
      >
        <PaletteIcon />
      </button>
    </div>
  )
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2">{title}</p>
      {children}
    </div>
  )
}

function Swatch({ hex, active, onClick, ring, dashed }: { hex: string; active: boolean; onClick: () => void; ring?: boolean; dashed?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 rounded-full relative transition-all duration-150"
      style={{
        background: hex,
        transform: active ? 'scale(1.15)' : 'scale(1)',
        boxShadow: active ? `0 0 8px 1px ${hex}66` : undefined,
        border: ring ? '1px solid rgba(255,255,255,0.25)' : undefined,
        outline: dashed && !active ? '2px dashed rgba(255,255,255,0.3)' : 'none',
        outlineOffset: 2,
      }}
    >
      {active && (
        <svg className="absolute inset-0 m-auto w-3.5 h-3.5" style={{ color: ring ? '#222' : '#fff' }} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

function Chips<T extends string>({ items, active, onPick, disabled }: { items: [T, string][]; active: T; onPick: (v: T) => void; disabled?: T[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(([v, label]) => {
        const on = active === v
        const off = disabled?.includes(v)
        return (
          <button
            key={v}
            onClick={() => { if (!off) onPick(v) }}
            disabled={off}
            className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
            style={{
              background: on ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(255,255,255,0.06)',
              color: on ? '#fff' : 'rgba(255,255,255,0.55)',
              border: on ? '1px solid rgba(var(--accent-rgb),0.45)' : '1px solid rgba(255,255,255,0.08)',
              opacity: off ? 0.35 : 1,
              cursor: off ? 'not-allowed' : 'pointer',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function WallChip({ label, active, onClick, none }: { label: string; active: boolean; onClick: () => void; none?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-left transition-all"
      style={{
        background: active ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(255,255,255,0.06)',
        color: active ? '#fff' : 'rgba(255,255,255,0.55)',
        border: active ? '1px solid rgba(var(--accent-rgb),0.45)' : '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {none ? <path d="M18 6L6 18M6 6l12 12" /> : <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 9l5 3-5 3z" /></>}
      </svg>
      <span className="truncate">{label}</span>
    </button>
  )
}

function MiniBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-white/60 hover:text-white transition-all"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {label}
    </button>
  )
}

function PToggle({ label, active, onClick, disabled }: { label: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className="w-full flex items-center justify-between gap-2" style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span className="text-xs text-white/65">{label}</span>
      <span className="relative rounded-full shrink-0 transition-all duration-200"
        style={{ width: 32, height: 18, background: active ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }}>
        <span className="absolute top-1/2 rounded-full bg-white transition-all duration-200"
          style={{ width: 13, height: 13, transform: 'translateY(-50%)', left: active ? 16 : 3 }} />
      </span>
    </button>
  )
}

function PaletteIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
      <circle cx="13.5" cy="6.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="7.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="6.5" cy="12.5" r=".8" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.4-.2-.78-.42-1.05-.27-.3-.42-.65-.42-1.05 0-.83.7-1.5 1.55-1.5H16c3.3 0 6-2.7 6-6 0-4.42-4.5-8-10-8z" />
    </svg>
  )
}
