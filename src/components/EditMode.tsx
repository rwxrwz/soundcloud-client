import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSettings, useUI, resolveAccentHex, seasonActive, ACCENT_COLORS, SETTINGS_DEFAULTS, type AccentColor, type BgStyle, type FsLayout, type Lang } from '../store'
import { CustomAccentSwatch, CustomAccentEditor } from './AccentPicker'
import { Toggle, RadioBtn, FsToggleRow, WallpaperSection, Fold, Flag, FLAG_RU, FLAG_US, FLAG_UA } from './settingsControls'
import { NAV } from './Sidebar'
import { SeasonSection } from './SeasonSection'
import { ThemeGrid } from './ThemesSection'
import { THEMES, activeThemeId } from '../themes'
import { useT } from '../i18n'
import { useEscape } from '../hooks/useEscape'

/* Editing mode: the settings panel steps aside and the running player becomes
   the thing you point at. Nothing here is a preview - the ring is drawn around
   the real sidebar, the real list, the real bar, and every option takes effect
   on the spot, because it IS the player. */

/* Only two parts of the window own settings of their own. The bottom bar does
   not: it has nothing to configure that is not the theme, and on the home
   screen it is not even visible - so it is deliberately not pickable rather
   than a spot that lights up and then offers nothing.
   Theme and accent are properties of the whole window, so they live in the dock
   on the right, reachable in both player styles. */
type Region = 'sidebar' | 'content'
const REGIONS: Region[] = ['sidebar', 'content']
const OUT_MS = 260
const CARD_OUT_MS = 200    // how long the options card is kept alive to fly out
const DOCK_W = 282         // side panel plus its margin; keeps cards clear of it

interface Box { x: number; y: number; w: number; h: number }
const ZERO: Box = { x: 0, y: 0, w: 0, h: 0 }

export function EditMode() {
  const t = useT()
  const { setEditMode, setShowSettings, editFromSettings } = useUI()
  const closeSignal = useUI(s => s.editCloseSignal)
  /* Where the settings search asked to land, read once on the way in. Held
     in a ref rather than read from the store on every render: the store copy
     is cleared immediately so the palette button cannot inherit it, and the
     card below still needs to know which group to unroll. */
  const target = useRef(useUI.getState().editTarget)
  const clearEditTarget = useUI(s => s.clearEditTarget)
  /* Both regions always have something to offer now that the seasonal layer
     is picked from the main area: in the transparent theme, where the desktop
     sets the background, that group is still there. The check that used to
     drop the main area when it was empty is gone with the reason for it.
     The bottom bar is still left out - it owns nothing of its own. */
  const [hover, setHover] = useState<Region | null>(null)
  const [sel, setSel] = useState<Region | null>(
    target.current && target.current.region !== 'dock' ? target.current.region as Region : null)
  /* The card that has been dismissed but is still on its way out. Dropped
     straight out of the tree it disappeared between two frames, while the
     banner and the dock beside it both animate away - which read as the card
     glitching rather than closing. */
  const [leaving, setLeaving] = useState<Region | null>(null)
  const [closing, setClosing] = useState(false)
  // Where the option cards should sit, in state because they are laid out by
  // React; the ring is moved imperatively instead (see below).
  const [anchor, setAnchor] = useState<Box>(ZERO)

  const ringRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const mouse = useRef({ x: -1, y: -1 })
  const cur = useRef<Box>(ZERO)
  const hoverRef = useRef<Region | null>(null)
  const selRef = useRef<Region | null>(null)
  hoverRef.current = hover
  selRef.current = sel

  const dismiss = () => {
    const was = selRef.current
    if (!was) return
    setLeaving(was)
    setSel(null)
    setTimeout(() => setLeaving(l => (l === was ? null : l)), CARD_OUT_MS)
  }

  const close = () => {
    if (closing) return
    setClosing(true)
    setTimeout(() => { setEditMode(false); if (editFromSettings) setShowSettings(true) }, OUT_MS)
  }

  /* The palette button asks to leave by bumping the counter. Only a CHANGE
     counts: the counter survives the mode, so reacting to its value would
     close the mode again the instant it reopened. */
  const sigAtOpen = useRef(closeSignal)
  useEffect(() => { if (closeSignal !== sigAtOpen.current) close() }, [closeSignal])

  useEscape(() => { if (selRef.current) dismiss(); else close() })

  useEffect(() => { clearEditTarget() }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY } }
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove) }
  }, [])

  /* The ring is driven by a frame loop rather than CSS transitions: the real
     sidebar animates its own width when the player style changes, so a target
     measured once would be stale the moment it starts moving. Each frame the
     regions are re-measured and the ring eases toward whichever is live, which
     makes it track the layout's own animation instead of fighting it. */
  useLayoutEffect(() => {
    let raf = 0
    const rect = (id: Region): Box | null => {
      const el = document.querySelector(`[data-edit="${id}"]`) as HTMLElement | null
      if (!el) return null
      const r = el.getBoundingClientRect()
      return r.width < 4 || r.height < 4 ? null : { x: r.x, y: r.y, w: r.width, h: r.height }
    }
    const tick = () => {
      const boxes = new Map<Region, Box>()
      for (const id of REGIONS) { const b = rect(id); if (b) boxes.set(id, b) }

      /* The content column runs on underneath the floating bar on purpose -
         the list keeps scrolling behind the glass - so its rect reaches the
         bottom of the window. Measured raw, the ring was drawn around the
         bar as well on every screen that has one, and the bar is the one
         part of the player that is deliberately not pickable: the highlight
         was claiming an area a click there cannot change.
         The floor comes off the sidebar island rather than from BAR_SPACE,
         because the sidebar sits in the same row and already leaves exactly
         the clearance the bar needs. One rule, in one place, instead of a
         second copy here to keep in step by hand. */
      const side = boxes.get('sidebar')
      const main = boxes.get('content')
      if (side && main) {
        const floor = side.y + side.h
        if (main.y + main.h > floor) boxes.set('content', { ...main, h: Math.max(0, floor - main.y) })
      }

      const { x, y } = mouse.current
      let found: Region | null = null
      // Later regions win: the bar floats over the content column.
      for (const id of REGIONS) {
        const b = boxes.get(id)
        if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) found = id
      }
      if (found !== hoverRef.current) setHover(found)

      // The hint ring sits exactly on the hovered region, no easing - it is a
      // pointer, not a traveller.
      const hint = hintRef.current
      const hb = hoverRef.current && hoverRef.current !== selRef.current ? boxes.get(hoverRef.current) : null
      if (hint) {
        if (hb) {
          hint.style.opacity = '1'
          hint.style.transform = `translate(${hb.x}px, ${hb.y}px)`
          hint.style.width = `${hb.w}px`
          hint.style.height = `${hb.h}px`
        } else hint.style.opacity = '0'
      }

      const live = selRef.current ?? hoverRef.current
      const target = live ? boxes.get(live) ?? null : null
      const ring = ringRef.current
      if (ring) {
        if (target) {
          const c = cur.current
          // First sighting snaps into place, afterwards it eases across.
          const k = c.w === 0 ? 1 : 0.28
          cur.current = {
            x: c.x + (target.x - c.x) * k, y: c.y + (target.y - c.y) * k,
            w: c.w + (target.w - c.w) * k, h: c.h + (target.h - c.h) * k,
          }
          const n = cur.current
          ring.style.opacity = '1'
          ring.style.transform = `translate(${n.x}px, ${n.y}px)`
          ring.style.width = `${n.w}px`
          ring.style.height = `${n.h}px`
          if (selRef.current) setAnchor(prev =>
            Math.abs(prev.x - target.x) < 0.5 && Math.abs(prev.y - target.y) < 0.5 &&
            Math.abs(prev.w - target.w) < 0.5 && Math.abs(prev.h - target.h) < 0.5 ? prev : target)
        } else {
          ring.style.opacity = '0'
          cur.current = ZERO
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const title: Record<Region, string> = {
    sidebar: t('vcSidebar'), content: t('vcContent'),
  }

  return (
    <div className={`edit-layer ${closing ? 'closing' : ''}`}>
      {/* Click-catcher: picks a region, or drops the selection on empty space. */}
      <div className="absolute inset-0"
        onClick={() => { const next = hover && hover !== sel ? hover : null; if (next) setSel(next); else dismiss() }} />
      {/* A faint second ring marks what a click would pick next. */}
      {hover && hover !== sel && <div ref={hintRef} className="edit-ring edit-ring-hint" />}

      <div ref={ringRef} className="edit-ring" data-picked={sel ? 'true' : 'false'} />

      <div className="edit-banner">
        <span className="edit-dot" />
        {t('editMode')}
        {!sel && <span className="edit-banner-hint">{t('vcPick')}</span>}
        <button onClick={close} title={t('close')} className="edit-x">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {(sel ?? leaving) && (
        <Options region={(sel ?? leaving)!} anchor={anchor} title={title[(sel ?? leaving)!]}
          onDone={dismiss} leaving={!sel}
          openFold={target.current?.region === (sel ?? leaving) ? target.current.fold : undefined} />
      )}

      <Dock openFold={target.current?.region === 'dock' ? target.current.fold : undefined} />
    </div>
  )
}

// ── the options that fly out of the picked element ──────────────────────────

function Options({ region, anchor, title, onDone, leaving, openFold }: {
  region: Region; anchor: Box; title: string; onDone: () => void; leaving?: boolean
  /** A group to unroll on arrival, when the search sent somebody here. */
  openFold?: string
}) {
  const t = useT()
  const s = useSettings()
  const { page } = useUI()
  /* Only when the player is the thing actually on screen, i.e. on home. On a
     track list the main area is a list, and offering its layout, lyrics and
     text size there described a view the person was not looking at. */
  /* Home is the player now, in every configuration, so these settings are
     simply "the home screen's" rather than one style's. */
  const fs = page === 'main'
  /* Nothing unrolled to start with. Opening on "Фон" meant one click on the
     main area dropped a full radio list plus a wallpaper picker on screen,
     which hid the two folds under it and answered a question nobody had
     asked yet. */
  const [fold, setFold] = useState<string | null>(openFold ?? null)
  const bgName = s.theme === 'transparent' ? t('themeTransparent')
    : s.bgStyle === 'wallpaper' ? t('videoWallpapers')
    : s.bgStyle === 'accent' ? t('bgAccent')
    : s.bgStyle === 'aurora' ? t('bgAurora') : t('bgDynamic')
  const layoutName = s.fsLayout === 'stack' ? t('fsStack') : s.fsLayout === 'split' ? t('fsSplit') : t('fsSide')
  /* Epsilon rather than ===: these come off sliders, and a step of 0.02
     landing on 0.34 is not something to bet an exact float on. */
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
  const rainIsDefault = near(s.rainWind, SETTINGS_DEFAULTS.rainWind)
    && near(s.rainLightning, SETTINGS_DEFAULTS.rainLightning)
    && near(s.rainSpeed, SETTINGS_DEFAULTS.rainSpeed)
    && near(s.rainFps, SETTINGS_DEFAULTS.rainFps)
  const seasonName = s.season === 'off' ? t('seasonShortOff')
    : s.season === 'auto' ? t('seasonShortAuto') : t('seasonShortOn')

  // Stand beside the element when there is room on its right, otherwise above
  // it. Clamped so a tall card never runs off the top or bottom.
  const W = 280
  const GAP = 14
  // The dock owns the right edge now, so "is there room beside it" has to stop
  // at the dock, not at the window - otherwise the card slid underneath it.
  const free = window.innerWidth - DOCK_W - 16
  const right = anchor.x + anchor.w + GAP
  const beside = right + W < free
  const style: React.CSSProperties = beside
    ? { left: right, top: Math.min(Math.max(anchor.y + 24, 70), Math.max(70, window.innerHeight - 420)) }
    : { left: Math.min(Math.max(anchor.x + anchor.w / 2 - W / 2, 16), Math.max(16, free - W)),
        top: 70 }

  return (
    <div className={`edit-opts ${leaving ? 'leaving' : ''}`} style={{ ...style, width: W, maxHeight: 'calc(100vh - 110px)' }}>
      <span className="edit-opts-title">{title}</span>
      <div className="edit-opts-body">
        {region === 'sidebar' && (
          <>
            <p className="edit-opts-head">{t('sbWidth')}</p>
            <div className="flex flex-col gap-1 mb-3">
              {([[true, t('sbWide'), t('sbWideSub')],
                 [false, t('sbNarrow'), t('sbNarrowSub')]] as [boolean, string, string][])
                .map(([v, l, sub]) => (
                  <RadioBtn key={String(v)} active={s.sidebarWide === v}
                    onClick={() => s.setSidebarWide(v)} label={l} sub={sub} />
                ))}
            </div>
            <p className="edit-opts-head">{t('sidebarTabs')}</p>
            <div className="flex flex-col gap-0.5">
              {NAV.map((item, i) => {
                const visible = !s.hiddenNav.includes(item.id)
                const lastOne = visible && s.hiddenNav.length >= NAV.length - 1
                return (
                  <div key={item.id} className="flex items-center justify-between py-1"
                    style={{ animation: `edit-opt-in 0.34s cubic-bezier(0.16,1,0.3,1) ${60 + i * 35}ms both` }}>
                    <span className="text-[13px] text-white/75">{t(item.key)}</span>
                    <Toggle active={visible} disabled={lastOne} onClick={() => s.toggleNavHidden(item.id)} />
                  </div>
                )
              })}
            </div>
          </>
        )}

        {region === 'content' && (
          <>
            {/* Folded groups, the same accordion the side panel uses: the card
                carried three unrelated stacks one under the other and read as
                a wall. One language for both panels, one group open at a time. */}
            <Fold id="bg" label={t('background')} open={fold} setOpen={setFold}
              preview={<span className="edit-fold-note">{bgName}</span>}>
              {/* Two ways for every choice below to mean nothing: a window
                  with no background of its own, and a sky painted over the
                  whole of it. Both say so instead of offering four radios
                  that change what you cannot see. */}
              {s.theme === 'transparent'
                ? <p className="text-[12px] text-white/40 leading-relaxed">{t('vcBgOffTransparent')}</p>
                : s.nightSky
                ? <p className="text-[12px] text-white/40 leading-relaxed">{t('vcBgOffNight')}</p>
                : (
                  <>
                    <div className="space-y-1">
                      {([['artwork', t('bgDynamic'), t('bgDynamicSub')],
                         ['accent', t('bgAccent'), t('bgAccentSub')],
                         ['aurora', t('bgAurora'), t('bgAuroraSub')],
                         ['wallpaper', t('videoWallpapers'),
                           s.wallpaperPath ? (s.wallpaperPath.split(/[\\/]/).pop() ?? '') : t('wallpaperNone')],
                        ] as [BgStyle, string, string][]).map(([v, l, sub]) => (
                          <RadioBtn key={v} active={s.bgStyle === v} onClick={() => s.setBgStyle(v)} label={l} sub={sub} />
                        ))}
                    </div>
                    {/* The whole picker, not a stub: with the settings blocks gone
                        this is the only place a wallpaper can be chosen at all. */}
                    {s.bgStyle === 'wallpaper' && (
                      <div className="page-enter mt-3">
                        <WallpaperSection
                          active
                          wallpaperPath={s.wallpaperPath}
                          onPick={p => { s.setWallpaperPath(p); s.setBgStyle('wallpaper') }}
                          onNone={() => s.setBgStyle('artwork')}
                        />
                      </div>
                    )}
                    {/* A living background IS a background, so it belongs here
                        rather than with the lyrics it used to sit next to. */}
                    {fs && (
                      <div className="mt-3">
                        <FsToggleRow label={t('fsLiveBg')}
                          active={s.fsLiveBg && s.bgStyle !== 'wallpaper' && !s.rain}
                          disabled={s.bgStyle === 'wallpaper' || s.rain}
                          note={s.rain && s.bgStyle !== 'wallpaper' ? t('fsLiveBgRain') : undefined}
                          onClick={() => s.setFsLiveBg(!s.fsLiveBg)} />
                      </div>
                    )}
                  </>
                )}
            </Fold>

            {/* Weather over the window, switched on by hand. It grew knobs, so
                it is a section now rather than the lone switch it started as. */}
            <Fold id="rain" label={t('rainLabel')} open={fold} setOpen={setFold}
              preview={<span className="edit-fold-note">{s.rain ? t('seasonShortOn') : t('seasonShortOff')}</span>}>
              <div className="space-y-2.5">
                <FsToggleRow label={t('onLabel')} active={s.rain} onClick={() => s.setRain(!s.rain)} />
                {/* Rain cannot fall through snow, so say which one goes. */}
                {!s.rain && seasonActive(s.season) && (
                  <p className="text-[10px] text-white/35 leading-tight -mt-1.5">{t('rainOffSeason')}</p>
                )}
                {s.rain && (
                  <div className="page-enter space-y-2.5">
                    <div>
                      <FsToggleRow label={t('rainLens')} active={s.rainLens} onClick={() => s.setRainLens(!s.rainLens)} />
                      <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{t('rainLensSub')}</p>
                    </div>
                    <div>
                      <FsToggleRow label={t('rainTheme')} active={s.rainTheme} onClick={() => s.setRainTheme(!s.rainTheme)} />
                      <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{t('rainThemeSub')}</p>
                    </div>
                    <div>
                      <FsToggleRow label={t('rainClouds')} active={s.rainClouds} onClick={() => s.setRainClouds(!s.rainClouds)} />
                      <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{t('rainCloudsSub')}</p>
                    </div>
                    <div>
                      <FsToggleRow label={t('rainSurfaces')} active={s.rainSurfaces} onClick={() => s.setRainSurfaces(!s.rainSurfaces)} />
                      <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{t('rainSurfacesSub')}</p>
                    </div>
                    <FsToggleRow label={t('rainAdvanced')} active={s.rainAdvanced} onClick={() => s.setRainAdvanced(!s.rainAdvanced)} />
                    {/* Sunk into its own block rather than carrying on down the
                        column: switches and numbers are different kinds of
                        control, and run together they read as one long list. */}
                    {s.rainAdvanced && (
                      <div className="edit-adv page-enter">
                        <div className="edit-adv-top">
                          <p className="edit-adv-head">{t('rainAdvanced')}</p>
                          {/* Three sliders with no marked default between them:
                              nudge the wind and you cannot find 34% again by
                              eye. Dimmed rather than hidden when they are
                              already home, so the row does not jump. */}
                          <button
                            disabled={rainIsDefault}
                            onClick={() => {
                              s.setRainWind(SETTINGS_DEFAULTS.rainWind)
                              s.setRainLightning(SETTINGS_DEFAULTS.rainLightning)
                              s.setRainSpeed(SETTINGS_DEFAULTS.rainSpeed)
                              s.setRainFps(SETTINGS_DEFAULTS.rainFps)
                            }}
                            className={`text-[10px] transition-colors ${rainIsDefault ? 'text-white/20 cursor-default' : 'text-white/40 hover:text-white/80'}`}>
                            {t('eqReset')}
                          </button>
                        </div>
                        <div className="space-y-3">
                          <Knob label={t('rainWind')} value={s.rainWind} min={0} max={1} step={0.02}
                            onChange={s.setRainWind} format={v => `${Math.round(v * 100)}%`} />
                          {/* Shown as the average wait, not as a percentage:
                              "11%" means nothing, "~22 с" is the thing you
                              are actually choosing. Zero is a storm with
                              no lightning, so it says so. */}
                          <Knob label={t('rainLightning')} value={s.rainLightning} min={0} max={100} step={1}
                            onChange={s.setRainLightning}
                            format={v => {
                              if (v === 0) return t('rainLightningOff')
                              const sec = 1 / ((v / 100) * 0.45)
                              // A decimal under ten seconds, or the top of
                              // the slider reads the same for its last
                              // quarter while the handle still moves.
                              return `~${sec < 10 ? sec.toFixed(1) : Math.round(sec)} ${t('stSec')}`
                            }} />
                          <Knob label={t('rainSpeed')} value={s.rainSpeed} min={0.1} max={5} step={0.05}
                            onChange={s.setRainSpeed} format={v => `${v.toFixed(2)}x`} />
                          <Knob label={t('rainFps')} value={s.rainFps} min={20} max={120} step={5}
                            onChange={s.setRainFps} format={v => `${v}`} sub={t('rainFpsSub')} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Fold>

            {fs && (
              <Fold id="text" label={t('fsLayoutLabel')} open={fold} setOpen={setFold}
                preview={<span className="edit-fold-note">{layoutName}</span>}>
                <div className="space-y-1">
                  {([['side', t('fsSide'), t('fsSideSub')],
                     ['stack', t('fsStack'), t('fsStackSub')],
                     ['split', t('fsSplit'), t('fsSplitSub')]] as [FsLayout, string, string][])
                    .map(([v, l, sub]) => (
                      <RadioBtn key={v} active={s.fsLayout === v} onClick={() => s.setFsLayout(v)} label={l} sub={sub}
                        disabled={v === 'stack' && !s.fsShowLyrics} />
                    ))}
                </div>
                <div className="mt-3">
                  <FsToggleRow label={t('onLabel')} active={s.fsShowLyrics}
                    onClick={() => { const v = !s.fsShowLyrics; s.setFsShowLyrics(v); if (!v && s.fsLayout === 'stack') s.setFsLayout('side') }} />
                </div>
                {s.fsShowLyrics && (
                  <div className="page-enter mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-white/50">{t('lyricsFontSize')}</span>
                      <div className="flex items-center gap-2.5">
                        <span className="text-[11px] text-white/35 tabular-nums">{Math.round(s.lyricsFontScale * 100)}%</span>
                        <button onClick={() => s.setLyricsFontScale(1)}
                          className="text-[11px] text-white/40 hover:text-white/80 transition-colors">{t('eqReset')}</button>
                      </div>
                    </div>
                    <input type="range" min={0.7} max={1.8} step={0.05} value={s.lyricsFontScale}
                      onChange={e => s.setLyricsFontScale(Number(e.target.value))}
                      className="w-full" style={{ accentColor: 'var(--accent)' }} />
                  </div>
                )}
              </Fold>
            )}

            {/* The seasonal layer is drawn over this area, so it is picked
                here rather than from the window-wide panel. */}
            <Fold id="season" label={t('seasonTitle')} open={fold} setOpen={setFold}
              preview={<span className="edit-fold-note">{seasonName}</span>}>
              <SeasonSection />
            </Fold>
          </>
        )}
        {/* Last in the sidebar's own queue of rows; in the main area's card
            nothing is staggered, so waiting there just left the card looking
            finished and then moving again. */}
        <button onClick={onDone} className="edit-opt-done"
          style={{ animationDelay: region === 'sidebar' ? '320ms' : '40ms' }}>
          {t('vcDone')}
        </button>
      </div>
    </div>
  )
}

// ── window-wide choices, parked on the right ────────────────────────────────

/* A labelled range with its value on the right. The same shape the lyrics
   size uses above, pulled out once there were three of them in a row. */
function Knob({ label, value, min, max, step, onChange, format, sub }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; format: (v: number) => string; sub?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-white/50">{label}</span>
        <span className="text-[11px] text-white/35 tabular-nums">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full" style={{ accentColor: 'var(--accent)' }} />
      {sub && <p className="text-[10px] text-white/25 mt-0.5 leading-tight">{sub}</p>}
    </div>
  )
}

/* The placement rule for this whole mode, in one line: a setting lives on the
   thing it visibly changes, and whatever changes the WINDOW has no single
   thing to point at, so it lives here.
   That is what decides the split. The rail's tabs are the sidebar's own, so
   they hang off the sidebar. Background, layout and lyrics reshape the main
   area, so they hang off it. Accent, theme, language, the button glow and the
   seasonal layer repaint everything at once - pointing at any one panel to
   change them would be a lie about what they do. Player style is one of those:
   it is called a sidebar setting because the rail visibly narrows, but it also
   turns the main area into the player, so it belongs to the window. */
function Dock({ openFold }: { openFold?: string }) {
  const t = useT()
  const s = useSettings()
  const { artRgb } = useUI()
  const artworkHex = resolveAccentHex('artwork', s.customAccent, artRgb)
  const [launchedTransparent, setLaunchedTransparent] = useState(false)
  useEffect(() => { window.electronAPI?.getWindowTransparent?.().then(setLaunchedTransparent).catch(() => {}) }, [])
  const restartNeeded = s.theme === 'transparent' && !launchedTransparent
  const activeTheme = activeThemeId(s as unknown as Record<string, unknown>)
  /* The two tall ones fold, and nothing is open to start with. The rest is a
     row of swatches, two chips and one switch - putting each behind its own
     drawer made a panel of closed drawers, while a pair of radio rows with
     their explanations is exactly the size worth folding away. */
  const [open, setOpen] = useState<string | null>(openFold ?? null)

  return (
    /* The palette button sits 22px up from the bottom of this column - it is
       only ever drawn on home, which has no bar under it. The floor is that,
       plus the button, plus a gap, plus the dock's own top. */
    <div className="edit-dock" style={{ ['--dock-floor' as string]: '144px' }}>
      <p className="edit-dock-title">{t('vcWindowWide')}</p>

      {/* A whole look in one click, above the controls that build one by
          hand. The branch and the night sky arrive with their themes - they
          had a switch each down in the main area, which made two drawers for
          two booleans and said nothing about what either one looks like. */}
      <Fold id="themes" label={t('catThemes')} open={open} setOpen={setOpen}
        preview={<span className="edit-fold-note">{THEMES.find(th => th.id === activeTheme)?.name ?? '-'}</span>}>
        <ThemeGrid compact />
      </Fold>

      <div className="edit-dock-sec">
        <p className="edit-dock-head">{t('accentColor')}</p>
        <div className="edit-dock-body">
        <div className="flex flex-wrap gap-2">
          {(Object.entries(ACCENT_COLORS) as [AccentColor, string][]).map(([key, hex]) => (
            <button key={key} onClick={() => s.setAccent(key)} title={key} className="edit-sw"
              data-on={s.accent === key ? 'true' : 'false'} style={{ background: hex }} />
          ))}
          <button onClick={() => s.setAccent('artwork')} title={t('vividArtwork')} className="edit-sw"
            data-on={s.accent === 'artwork' ? 'true' : 'false'}
            style={{ background: artworkHex, outline: '2px dashed rgba(255,255,255,0.3)', outlineOffset: 2 }} />
          <CustomAccentSwatch hex={s.customAccent} active={s.accent === 'custom'}
            onClick={() => { s.setAccent('custom'); setOpen('hex') }} size={24} />
        </div>
        {s.accent === 'artwork' && <p className="text-[10px] text-white/30 mt-2 leading-tight">{t('artworkChanges')}</p>}
        </div>
      </div>

      {/* The picker is half the dock's height, and two of the built-in themes
          set a custom accent - so left open it was permanently in the way for
          anyone who never asked to mix a colour. It is a drawer now, shut
          until wanted, and only there at all while the custom swatch is the
          one in use. Picking that swatch by hand opens it; a theme setting
          the same colour does not, because nobody chose to edit anything. */}
      {s.accent === 'custom' && (
        <Fold id="hex" label={t('accentCustom')} open={open} setOpen={setOpen}
          preview={<span className="edit-fold-dot" style={{ background: s.customAccent }} />}>
          <CustomAccentEditor />
        </Fold>
      )}

      {/* Two options is not a list, it is a switch. The window is either
          see-through or it is not, and the slider and the restart notice
          only mean anything in one of those two states. */}
      <div className="edit-dock-sec">
        <div className="edit-dock-body">
          <FsToggleRow label={t('themeTransparent')} active={s.theme === 'transparent'}
            onClick={() => s.setTheme(s.theme === 'transparent' ? 'default' : 'transparent')} />
          <p className="text-[10px] text-white/30 mt-0.5 leading-tight">{t('themeTransparentSub')}</p>
          {s.theme === 'transparent' && (
            <div className="page-enter mt-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-white/50">{t('transparency')}</span>
                <span className="text-[11px] text-white/35 tabular-nums">{s.transparencyLevel}%</span>
              </div>
              <input type="range" min={5} max={95} step={1} value={s.transparencyLevel}
                onChange={e => s.setTransparencyLevel(Number(e.target.value))}
                className="w-full" style={{ accentColor: 'var(--accent)' }} />
            </div>
          )}
          {restartNeeded && (
            <div className="mt-2.5 flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg"
              style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
              <span className="text-[11px] text-white/70 leading-tight">{t('restartNeeded')}</span>
              <button onClick={() => window.electronAPI?.restartApp?.()}
                className="icon-btn px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all active:scale-95 shrink-0"
                style={{ background: 'var(--accent)', color: '#fff' }}>{t('restartNow')}</button>
            </div>
          )}
        </div>
      </div>

      <div className="edit-dock-sec">
        <p className="edit-dock-head">{t('language')}</p>
        <div className="edit-dock-body">
          {/* Each language in its own name, never translated - the whole point
              of this control is to be readable to someone who cannot read the
              language it is currently set to. */}
          <div className="grid grid-cols-3 gap-1.5">
            {([['en', FLAG_US, 'ENG'], ['ru', FLAG_RU, 'RU'], ['uk', FLAG_UA, 'UKR']] as [Lang, string, string][]).map(([v, code, l]) => (
              <button key={v} onClick={() => s.setLang(v)}
                className="icon-btn flex flex-col items-center gap-1 py-2 rounded-lg transition-all"
                style={{
                  background: s.lang === v ? 'rgba(var(--accent-rgb),0.2)' : 'rgba(255,255,255,0.06)',
                  border: s.lang === v ? '1px solid rgba(var(--accent-rgb),0.45)' : '1px solid rgba(255,255,255,0.08)',
                  color: s.lang === v ? '#fff' : 'rgba(255,255,255,0.6)',
                }}>
                <Flag code={code} alt={l} size={22} />
                <span className="text-[10px] font-semibold tracking-wider">{l}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="edit-dock-sec">
        <div className="edit-dock-body">
          <FsToggleRow label={t('iconGlow')} active={s.iconGlow} onClick={() => s.setIconGlow(!s.iconGlow)} />
        </div>
      </div>

    </div>
  )
}

