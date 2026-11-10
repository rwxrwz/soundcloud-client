// The small controls the settings screens are built from. They live apart so
// every panel - the old settings blocks and the new visual customiser - reaches
// for the same button instead of growing its own lookalike.
import { useEffect, useState } from 'react'
import { useSettings } from '../store'
import { useT } from '../i18n'

export function Toggle({ active, onClick, disabled }: { active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className="relative rounded-full transition-all duration-200 shrink-0"
      style={{ width: 38, height: 22, background: active ? 'var(--accent)' : 'rgba(255,255,255,0.15)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span className="absolute top-1/2 rounded-full bg-white transition-all duration-200"
        style={{ width: 16, height: 16, transform: 'translateY(-50%)', left: active ? 20 : 3 }} />
    </button>
  )
}

export function FsToggleRow({ label, active, onClick, disabled, note }: { label: string; active: boolean; onClick: () => void; disabled?: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ opacity: disabled ? 0.45 : 1 }}>
      {/* A switch that has gone grey two folds away from the thing that
          greyed it out needs to say so, or it reads as broken. */}
      <span className="flex flex-col min-w-0">
        <span className="text-sm text-white/75">{label}</span>
        {note && <span className="text-[10px] text-white/40 leading-tight mt-0.5">{note}</span>}
      </span>
      <Toggle active={active} onClick={onClick} disabled={disabled} />
    </div>
  )
}

export function RadioBtn({ active, onClick, label, sub, disabled }: { active: boolean; onClick: () => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`icon-btn w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150
        ${disabled ? 'opacity-35 cursor-not-allowed' : active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
    >
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
        ${active ? 'border-[var(--accent)]' : 'border-white/20'}`}>
        {active && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
      </div>
      {/* text-left, not just items-start: that one places the two spans
          against the left edge, but the alignment INSIDE them is inherited -
          so wherever this sits on a centred surface, a label short enough to
          fit looked left-aligned while a sub that wrapped had its second
          line floating in the middle. */}
      <div className="flex flex-col items-start min-w-0 text-left">
        <span>{label}</span>
        {sub && <span className="text-[10px] text-white/30 leading-tight">{sub}</span>}
      </div>
    </button>
  )
}

/* One section open at a time. Four groups all unrolled at once turned the dock
   into a column taller than the window, and a scrollbar is a poor substitute
   for being able to see where you are. `sub` is the same control one level
   down, for a fold that lives inside another one's body; `soon` is a heading
   for something that is not built yet and says so in its own note. */
export function Fold({ id, label, preview, open, setOpen, sub, soon, children }: {
  id: string; label: string; preview?: React.ReactNode
  open: string | null; setOpen: (v: string | null) => void
  sub?: boolean; soon?: boolean; children?: React.ReactNode
}) {
  const on = open === id && !soon
  return (
    <div className={sub ? 'edit-fold edit-fold-sub' : 'edit-fold'}
      data-open={on ? 'true' : 'false'} data-soon={soon ? 'true' : undefined}>
      <button className="edit-fold-head" disabled={soon} onClick={() => setOpen(on ? null : id)}>
        <span className="edit-fold-label">{label}</span>
        {!on && preview}
        {/* Nothing to unroll on a heading for something that is not here yet,
            so it gets no chevron to promise one. */}
        {!soon && (
          <svg className="edit-fold-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        )}
      </button>
      {/* Kept mounted through the collapse. Rendered as {on && children} the
          contents vanished in the same frame the row started closing, so the
          only thing that animated was an empty box. */}
      <div className="edit-fold-body"><div><div>{children}</div></div></div>
    </div>
  )
}

/* A switch that would be the only thing inside a fold. It lines up with the
   fold headings beside it and carries the same typography, because opening a
   drawer to show one toggle is a drawer too many. */
export function FoldSwitch({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <div className="edit-fold-flat">
      <span className="edit-fold-label">{label}</span>
      <Toggle active={active} onClick={onClick} />
    </div>
  )
}

/* Twemoji's SVG rather than the emoji character: the flag emoji renders as
   two letters in a box on most of Linux and on Windows, which is no flag at
   all. Loaded from the CDN, and the alt text carries the meaning if it never
   arrives. */
export function Flag({ code, alt, size = 30 }: { code: string; alt: string; size?: number }) {
  return (
    <img src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`}
      alt={alt} width={size} height={size} className="shrink-0" style={{ objectFit: 'contain' }} />
  )
}
export const FLAG_RU = '1f1f7-1f1fa'
export const FLAG_US = '1f1fa-1f1f8'
export const FLAG_UA = '1f1fa-1f1e6'

/* The wallpaper picker. It moved out of the settings panel with everything
   else that changes how the window looks: it now hangs off the main area in
   the editing mode, because that is the surface a wallpaper replaces. */
export function WallpaperSection({ active, wallpaperPath, onPick, onNone }: {
  active: boolean; wallpaperPath: string; onPick: (p: string) => void; onNone: () => void
}) {
  const t = useT()
  const { wallpaperBlur, setWallpaperBlur } = useSettings()
  const [list, setList] = useState<{ name: string; path: string }[]>([])
  const [dir, setDir] = useState('')
  const load = () => { window.electronAPI?.listWallpapers?.().then(setList).catch(() => {}) }
  useEffect(() => { window.electronAPI?.wallpapersDir?.().then(setDir).catch(() => {}); load() }, [])

  return (
    <>
      {/* Two columns rather than a row: in the editing mode this lives in a
          240px card, where a row made both labels break mid-word. */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button onClick={() => window.electronAPI?.openWallpapers?.()}
          className="icon-btn flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all whitespace-nowrap"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          {t('openFolder')}
        </button>
        <button onClick={load}
          className="icon-btn flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all whitespace-nowrap"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4v5h.582m15.356 2A8 8 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8 8 0 01-15.357-2m15.357 2H15"/></svg>
          {t('refreshList')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <WpCard label={t('wallpaperNone')} active={!active} onClick={onNone} none />
        {list.map(w => (
          <WpCard key={w.path} label={w.name} active={active && wallpaperPath === w.path} onClick={() => onPick(w.path)} />
        ))}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-white/80">{t('wallpaperBlur')}</span>
          <span className="text-[11px] text-white/40 tabular-nums">{wallpaperBlur} px</span>
        </div>
        <input
          type="range" min={0} max={30} step={1} value={wallpaperBlur}
          onChange={e => setWallpaperBlur(Number(e.target.value))}
          className="w-full" style={{ accentColor: 'var(--accent)' }}
        />
      </div>

      {list.length === 0 && <p className="text-[11px] text-white/35 mt-2">{t('wallpapersEmpty')}</p>}
      <p className="text-[10px] text-white/30 mt-2 leading-snug">{t('wallpapersHint')}</p>
      {dir && <p className="text-[10px] text-white/25 mt-1 break-all">{dir}</p>}
    </>
  )
}

function WpCard({ label, active, onClick, none }: { label: string; active: boolean; onClick: () => void; none?: boolean }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium text-left transition-all"
      style={{
        background: active ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.05)',
        border: active ? '1px solid rgba(var(--accent-rgb),0.45)' : '1px solid rgba(255,255,255,0.08)',
        color: active ? '#fff' : 'rgba(255,255,255,0.6)',
      }}>
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {none
          ? <path d="M18 6L6 18M6 6l12 12"/>
          : <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/></>}
      </svg>
      <span className="truncate">{label}</span>
    </button>
  )
}

// Collapsible block: a compact header row that reveals its content on click.
// Keeps heavy, secondary sections from walling the tab. Content stays mounted
// so it can animate open/close via a 0fr↔1fr grid-rows transition (handles
// auto height) plus a fade.
export function Collapsible({ title, children, defaultOpen = false, preview }: { title: string; children: React.ReactNode; defaultOpen?: boolean; preview?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="icon-btn w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-all text-left"
        style={{ background: open ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = open ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.03)' }}
      >
        <span className="text-sm text-white/75 shrink-0">{title}</span>
        <span className="flex items-center gap-2.5 min-w-0">
          {!open && preview && <span className="min-w-0 truncate">{preview}</span>}
          <svg className="w-4 h-4 text-white/40 transition-transform duration-300 ease-out shrink-0" style={{ transform: open ? 'rotate(90deg)' : 'none' }}
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M9 6l6 6-6 6"/>
          </svg>
        </span>
      </button>
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <div className="px-0.5" style={{ paddingTop: 12, opacity: open ? 1 : 0, transform: open ? 'none' : 'translateY(-4px)', transition: 'opacity 0.25s ease, transform 0.25s ease' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// Small right-aligned summary shown on a collapsed Collapsible header.
export function PreviewText({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-white/40 truncate">{children}</span>
}
