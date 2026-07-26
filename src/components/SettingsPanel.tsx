import { useState, useEffect, useMemo } from 'react'
import { useSettings, useProfile, useUI, useUpdate, useToast, settingsSnapshot, ACCENT_COLORS, EQ_BANDS, PerfKey, AccentColor, BgStyle, VisualizerStyle, HeroAnim, Theme, PlayerStyle, FsLayout, Lang, StartPage } from '../store'
import { checkForUpdates, latestStable, cmpVersion } from '../services/updates'
import { encodeEqPreset, decodeEqPreset } from '../services/eqPresets'
import { encodeSettingsPreset, decodeSettingsPreset } from '../services/settingsPresetCode'
import { NAV } from './Sidebar'
import { useT } from '../i18n'

interface Props { onClose: () => void }

const EQ_LABELS = ['60', '250', '1k', '4k', '12k']
type Category = 'profile' | 'appearance' | 'sound' | 'system' | 'versions' | 'info'

export function SettingsPanel({ onClose }: Props) {
  const t = useT()
  const settingsTab = useUI(s => s.settingsTab)
  const [cat, setCat] = useState<Category>((settingsTab as Category) || 'profile')
  const [closing, setClosing] = useState(false)
  const requestClose = () => { if (closing) return; setClosing(true); setTimeout(onClose, 210) }

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const NAV: { id: Category; label: string; icon: JSX.Element }[] = [
    { id: 'profile',    label: t('catAccount'),    icon: <IconUser /> },
    { id: 'appearance', label: t('catAppearance'), icon: <IconPalette /> },
    { id: 'sound',      label: t('catSound'),      icon: <IconSound /> },
    { id: 'system',     label: t('catSystem'),     icon: <IconSystem /> },
    { id: 'versions',   label: t('catVersions'),   icon: <IconVersions /> },
    { id: 'info',       label: t('catInfo'),       icon: <IconInfo /> },
  ]

  return (
    <div
      className={`absolute inset-0 z-40 flex items-center justify-center playlist-picker-backdrop ${closing ? 'closing' : ''}`}
      onClick={e => { if (e.target === e.currentTarget) requestClose() }}
    >
      <div
        className={`playlist-picker-panel glass-island rounded-2xl flex overflow-hidden ${closing ? 'closing' : ''}`}
        style={{ width: 'min(880px, 94%)', height: 'min(86%, 640px)' }}
      >
        {/* Internal sidebar */}
        <div className="w-48 shrink-0 flex flex-col border-r border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <p className="px-2 pt-1 pb-3 text-xs font-semibold text-white/40 uppercase tracking-wider">{t('settings')}</p>
          <div className="space-y-0.5">
            {NAV.map(item => {
              const active = cat === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => setCat(item.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all"
                  style={{
                    background: active ? 'rgba(var(--accent-rgb),0.16)' : 'transparent',
                    color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                >
                  <span style={{ color: active ? 'var(--accent)' : 'inherit' }}>{item.icon}</span>
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8 shrink-0">
            <span className="font-semibold text-sm text-white">{NAV.find(n => n.id === cat)?.label}</span>
            <button onClick={requestClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {cat === 'profile' && <><ProfileTab onClose={onClose} /><LanguageTab /></>}
            {cat === 'appearance' && <div className="space-y-2"><AppearanceTab /><PlayerTab /></div>}
            {cat === 'sound' && <SoundTab />}
            {cat === 'system' && <SystemTab />}
            {cat === 'versions' && <VersionsTab />}
            {cat === 'info' && <InfoTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function ProfileTab({ onClose }: { onClose: () => void }) {
  const { user, logout } = useProfile()
  const t = useT()
  if (!user) return null
  const location = [user.city, user.country_code].filter(Boolean).join(', ')
  const openProfile = () => { if (user.permalink_url) window.open(user.permalink_url) }
  return (
    <>
      <div className="flex items-center gap-4">
        <img src={user.avatar_url?.replace('-large', '-t200x200')} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-semibold text-white truncate">{user.full_name || user.username}</p>
          <p className="text-sm text-white/40 truncate">@{user.username}</p>
          {location && (
            <p className="text-xs text-white/35 truncate mt-0.5 flex items-center gap-1">
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-5.2-7-11a7 7 0 0114 0c0 5.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
              {location}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stat value={user.followers_count} label={t('followers')} />
        <Stat value={user.followings_count} label={t('following')} />
        <Stat value={user.track_count} label={t('tracksLabel')} />
        <Stat value={user.playlist_count} label={t('playlists')} />
      </div>

      {user.description && (
        <Section title={t('joinedLabel')}>
          <p className="text-xs text-white/55 leading-relaxed whitespace-pre-line max-h-32 overflow-y-auto">{user.description}</p>
        </Section>
      )}

      <button
        onClick={openProfile}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm text-white/70 hover:text-white transition-all"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/>
        </svg>
        {t('openProfile')}
      </button>

      <Section title={t('account')}>
        <button
          onClick={() => { logout(); onClose() }}
          className="w-full py-2 px-3 rounded-lg text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all text-left"
        >
          {t('signOut')}
        </button>
      </Section>
    </>
  )
}

function AppearanceTab() {
  const { accent, bgStyle, wallpaperPath, theme, setAccent, setBgStyle, setWallpaperPath, setTheme } = useSettings()
  const { artRgb } = useUI()
  const t = useT()
  const artworkHex = `#${artRgb.map(v => v.toString(16).padStart(2, '0')).join('')}`

  const themeLabel: Record<Theme, string> = { default: t('themeDefault'), glass: t('themeGlass'), minimal: t('themeMinimal') }
  const bgLabel: Record<string, string> = { artwork: t('bgDynamic'), accent: t('bgAccent'), aurora: t('bgAurora'), midnight: t('bgMidnight'), dark: t('bgDark'), wallpaper: t('videoWallpapers') }
  const accentDotHex = accent === 'artwork' ? artworkHex : (ACCENT_COLORS[accent] ?? artworkHex)
  const wpActive = bgStyle === 'wallpaper' && !!wallpaperPath
  const wpName = wpActive ? wallpaperPath.split(/[\\/]/).pop() : t('wallpaperNone')

  return (
    <>
      <Collapsible title={t('theme')} defaultOpen preview={<PreviewText>{themeLabel[theme]}</PreviewText>}>
        <div className="grid grid-cols-2 gap-2.5">
          {([
            ['default', t('themeDefault'), t('themeDefaultSub')],
            ['glass',   t('themeGlass'),   t('themeGlassSub')],
            ['minimal', t('themeMinimal'), t('themeMinimalSub')],
          ] as [Theme, string, string][]).map(([val, label, sub]) => (
            <ThemeCard key={val} theme={val} active={theme === val} label={label} sub={sub} onClick={() => setTheme(val)} />
          ))}
        </div>
      </Collapsible>

      <Collapsible title={t('accentColor')} preview={<span className="w-3.5 h-3.5 rounded-full inline-block shrink-0" style={{ background: accentDotHex, border: '1px solid rgba(255,255,255,0.2)' }} />}>
        <div className="flex flex-wrap gap-2.5">
          {(Object.entries(ACCENT_COLORS) as [AccentColor, string][]).map(([key, hex]) => (
            <button
              key={key}
              onClick={() => setAccent(key)}
              className="w-8 h-8 rounded-full transition-all duration-200 relative shrink-0"
              style={{
                background: hex,
                transform: accent === key ? 'scale(1.18)' : 'scale(1)',
                boxShadow: accent === key ? `0 0 12px 2px ${hex}66` : undefined,
                border: key === 'white' ? '1px solid rgba(255,255,255,0.2)' : undefined,
              }}
              title={key}
            >
              {accent === key && (
                <svg className="absolute inset-0 m-auto w-3.5 h-3.5" style={{ color: key === 'white' ? '#222' : '#fff' }} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
              )}
            </button>
          ))}
          <DynamicSwatch hex={artworkHex} active={accent === 'artwork'} onClick={() => setAccent('artwork')} title={t('vividArtwork')} />
        </div>
        {accent === 'artwork' && <p className="text-[10px] text-white/30 mt-2 leading-tight">{t('artworkChanges')}</p>}
      </Collapsible>

      <Collapsible title={t('background')} preview={<PreviewText>{bgLabel[bgStyle] ?? bgStyle}</PreviewText>}>
        <div className="space-y-1.5">
          {([
            ['artwork', t('bgDynamic'),  t('bgDynamicSub')],
            ['accent',  t('bgAccent'),   t('bgAccentSub')],
            ['aurora',  t('bgAurora'),   t('bgAuroraSub')],
            ['midnight',t('bgMidnight'), t('bgMidnightSub')],
            ['dark',    t('bgDark'),     t('bgDarkSub')],
          ] as [BgStyle, string, string][]).map(([val, label, sub]) => (
            <RadioBtn key={val} active={bgStyle === val} onClick={() => setBgStyle(val)} label={label} sub={sub} />
          ))}
        </div>
      </Collapsible>

      <Collapsible title={t('videoWallpapers')} preview={<PreviewText>{wpName}</PreviewText>}>
        <WallpaperSection
          active={bgStyle === 'wallpaper'}
          wallpaperPath={wallpaperPath}
          onPick={(p) => { setWallpaperPath(p); setBgStyle('wallpaper') }}
          onNone={() => setBgStyle('artwork')}
        />
      </Collapsible>
    </>
  )
}

function PlayerTab() {
  const { bgStyle, visualizerStyle, heroAnim, playerStyle, fsLayout, fsShowLyrics, fsLiveBg, fsBeatGlow, fsArtCrossfade, lyricsFontScale, setVisualizerStyle, setHeroAnim, setPlayerStyle, setFsLayout, setFsShowLyrics, setFsLiveBg, setFsBeatGlow, setFsArtCrossfade, setLyricsFontScale } = useSettings()
  const toggleLyrics = () => { const v = !fsShowLyrics; setFsShowLyrics(v); if (!v && fsLayout === 'stack') setFsLayout('side') }
  const t = useT()
  const psLabel: Record<PlayerStyle, string> = { default: t('psDefault'), fullscreen: t('psFullscreen') }
  const vizLabel: Record<VisualizerStyle, string> = { bars: t('vizBars'), wave: t('vizWave'), mirror: t('vizMirror') }
  const animLabel: Record<HeroAnim, string> = { wave: t('animWave'), threads: t('animThreads'), silk: t('animSilk'), mist: t('animMist'), weave: t('animWeave'), spectrum: t('animSpectrum') }
  return (
    <>
      <Collapsible title={t('playerStyleLabel')} preview={<PreviewText>{psLabel[playerStyle]}</PreviewText>}>
        <div className="space-y-1.5">
          {([
            ['default',    t('psDefault'),    t('psDefaultSub')],
            ['fullscreen', t('psFullscreen'), t('psFullscreenSub')],
          ] as [PlayerStyle, string, string][]).map(([val, label, sub]) => (
            <RadioBtn key={val} active={playerStyle === val} onClick={() => setPlayerStyle(val)} label={label} sub={sub} />
          ))}
        </div>

        {playerStyle === 'fullscreen' && (
          <div className="mt-3 pt-3 border-t border-white/8 space-y-1.5">
            <div className="pb-1">
              <FsToggleRow label={t('fsShowLyrics')} active={fsShowLyrics} onClick={toggleLyrics} />
            </div>
            <p className="text-[10px] text-white/30 mb-1.5 px-0.5">{t('fsLayoutLabel')}</p>
            {([
              ['side',  t('fsSide'),  t('fsSideSub')],
              ['stack', t('fsStack'), t('fsStackSub')],
              ['split', t('fsSplit'), t('fsSplitSub')],
            ] as [FsLayout, string, string][]).map(([val, label, sub]) => (
              <RadioBtn key={val} active={fsLayout === val} disabled={val === 'stack' && !fsShowLyrics}
                onClick={() => setFsLayout(val)} label={label} sub={sub} />
            ))}

            <div className="pt-1 space-y-2.5">
              <FsToggleRow label={t('fsLiveBg')} active={fsLiveBg && bgStyle !== 'wallpaper'} disabled={bgStyle === 'wallpaper'} onClick={() => setFsLiveBg(!fsLiveBg)} />
              <FsToggleRow label={t('fsBeatGlow')} active={fsBeatGlow} onClick={() => setFsBeatGlow(!fsBeatGlow)} />
              <FsToggleRow label={t('fsCrossfade')} active={fsArtCrossfade} onClick={() => setFsArtCrossfade(!fsArtCrossfade)} />
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-white/80">{t('lyricsFontSize')}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-white/40 tabular-nums">{Math.round(lyricsFontScale * 100)}%</span>
                  <button onClick={() => setLyricsFontScale(1)} className="text-[11px] text-white/40 hover:text-white/80 transition-colors">{t('eqReset')}</button>
                </div>
              </div>
              <input
                type="range" min={0.7} max={1.8} step={0.05} value={lyricsFontScale}
                onChange={e => setLyricsFontScale(Number(e.target.value))}
                className="w-full" style={{ accentColor: 'var(--accent)' }}
              />
            </div>
          </div>
        )}
      </Collapsible>

      <Collapsible title={t('visualizer')} preview={<PreviewText>{vizLabel[visualizerStyle]}</PreviewText>}>
        <div className="space-y-1.5">
          {([
            ['bars',   t('vizBars'),   t('vizBarsSub')],
            ['wave',   t('vizWave'),   t('vizWaveSub')],
            ['mirror', t('vizMirror'), t('vizMirrorSub')],
          ] as [VisualizerStyle, string, string][]).map(([val, label, sub]) => (
            <RadioBtn key={val} active={visualizerStyle === val} onClick={() => setVisualizerStyle(val)} label={label} sub={sub} />
          ))}
        </div>
      </Collapsible>

      {/* Home animation only matters in the default player style */}
      {playerStyle !== 'fullscreen' && (
      <Collapsible title={t('heroAnimation')} preview={<PreviewText>{animLabel[heroAnim]}</PreviewText>}>
        <div className="space-y-1.5">
          {([
            ['wave',     t('animWave'),     t('animWaveSub')],
            ['threads',  t('animThreads'),  t('animThreadsSub')],
            ['silk',     t('animSilk'),     t('animSilkSub')],
            ['mist',     t('animMist'),     t('animMistSub')],
            ['weave',    t('animWeave'),    t('animWeaveSub')],
            ['spectrum', t('animSpectrum'), t('animSpectrumSub')],
          ] as [HeroAnim, string, string][]).map(([val, label, sub]) => (
            <RadioBtn key={val} active={heroAnim === val} onClick={() => setHeroAnim(val)} label={label} sub={sub} />
          ))}
        </div>
      </Collapsible>
      )}
    </>
  )
}

function SoundTab() {
  const { eq, eqEnabled, setEqBand, setEqEnabled, resetEq, outputDeviceId, setOutputDeviceId, crossfade, setCrossfade,
    eqPresets, activePresetId, applyEqPreset, saveEqPreset, renameEqPreset, deleteEqPreset, addEqPreset } = useSettings()
  const showToast = useToast(s => s.show)
  const t = useT()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [nameModal, setNameModal] = useState<{ mode: 'save' | 'rename'; id?: string; value: string } | null>(null)

  const activeCustom = eqPresets.find(p => p.id === activePresetId) ?? null

  const submitName = () => {
    if (!nameModal) return
    const v = nameModal.value.trim()
    if (!v) return
    if (nameModal.mode === 'save') { saveEqPreset(v); showToast(t('eqPresetSaved'), 'success') }
    else if (nameModal.id) renameEqPreset(nameModal.id, v)
    setNameModal(null)
  }
  const sharePreset = async (name: string, gains: number[]) => {
    try { await navigator.clipboard.writeText(encodeEqPreset(name, gains)); showToast(t('eqCodeCopied'), 'success') } catch { /* ignore */ }
  }
  const importPreset = async () => {
    try {
      const decoded = decodeEqPreset(await navigator.clipboard.readText())
      if (!decoded) { showToast(t('eqImportFail'), 'error'); return }
      addEqPreset(decoded.name, decoded.gains)
      showToast(t('eqPresetImported'), 'success')
    } catch { showToast(t('eqImportFail'), 'error') }
  }

  useEffect(() => {
    let cancelled = false
    const load = () => navigator.mediaDevices?.enumerateDevices?.()
      .then(list => { if (!cancelled) setDevices(list.filter(d => d.kind === 'audiooutput')) })
      .catch(() => {})
    load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => { cancelled = true; navigator.mediaDevices?.removeEventListener?.('devicechange', load) }
  }, [])

  return (
    <>
    <Section title={t('outputDevice')}>
      <select
        value={outputDeviceId}
        onChange={e => setOutputDeviceId(e.target.value)}
        className="w-full rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none transition-all"
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <option value="" style={{ background: '#1a1a22' }}>{t('systemDefault')}</option>
        {devices.filter(d => d.deviceId && d.deviceId !== 'default').map((d, i) => (
          <option key={d.deviceId} value={d.deviceId} style={{ background: '#1a1a22' }}>
            {d.label || `${t('outputDevice')} ${i + 1}`}
          </option>
        ))}
      </select>
    </Section>

    <Section title={t('crossfade')}>
      <p className="text-[10px] text-white/30 mb-2.5 leading-tight">{t('crossfadeSub')}</p>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-white/80">{t('crossfadeDuration')}</span>
        <span className="text-[11px] text-white/40 tabular-nums">
          {crossfade === 0 ? t('off') : `${crossfade.toFixed(1)} ${t('seconds')}`}
        </span>
      </div>
      <input
        type="range" min={0} max={12} step={0.5} value={crossfade}
        onChange={e => setCrossfade(Number(e.target.value))}
        className="w-full" style={{ accentColor: 'var(--accent)' }}
      />
    </Section>

    <Section title={t('equalizer')}>
      <div className="flex items-center justify-between mb-3">
        <Toggle active={eqEnabled} onClick={() => setEqEnabled(!eqEnabled)} />
        <button onClick={resetEq} className="text-[11px] text-white/40 hover:text-white/80 transition-colors">{t('eqReset')}</button>
      </div>

      {/* Presets (custom only) */}
      {eqPresets.length > 0 && (
        <>
          <p className="text-[11px] uppercase tracking-wider text-white/35 mb-2">{t('eqPresets')}</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {eqPresets.map(p => {
              const active = activePresetId === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => applyEqPreset(p.gains, p.id)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
                  style={{
                    background: active ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${active ? 'rgba(var(--accent-rgb),0.5)' : 'rgba(255,255,255,0.08)'}`,
                    color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                  }}
                >
                  {p.name}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Sliders */}
      <div className="flex items-end justify-between gap-2 max-w-sm" style={{ opacity: eqEnabled ? 1 : 0.4 }}>
        {EQ_BANDS.map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
            <span className="text-[10px] text-white/40 tabular-nums">{eq[i] > 0 ? '+' : ''}{eq[i]}</span>
            <input
              type="range" min={-12} max={12} step={1}
              value={eq[i]} disabled={!eqEnabled}
              onChange={e => setEqBand(i, Number(e.target.value))}
              className="eq-slider"
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 6, height: 110 } as React.CSSProperties}
            />
            <span className="text-[10px] text-white/30">{EQ_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* Preset actions */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button onClick={() => setNameModal({ mode: 'save', value: '' })} className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          + {t('eqSavePreset')}
        </button>
        <button onClick={importPreset} className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {t('eqImportPreset')}
        </button>
        {activeCustom && (
          <>
            <span className="w-px h-4 bg-white/10" />
            <button onClick={() => setNameModal({ mode: 'rename', id: activeCustom.id, value: activeCustom.name })} className="text-[11px] text-white/50 hover:text-white/90 transition-colors">{t('rename')}</button>
            <button onClick={() => sharePreset(activeCustom.name, activeCustom.gains)} className="text-[11px] text-white/50 hover:text-white/90 transition-colors">{t('eqShare')}</button>
            <button onClick={() => deleteEqPreset(activeCustom.id)} className="text-[11px] text-red-400/70 hover:text-red-400 transition-colors">{t('delete')}</button>
          </>
        )}
      </div>
    </Section>

    {/* Name preset modal (save / rename) */}
    {nameModal && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center playlist-picker-backdrop" onClick={e => { if (e.target === e.currentTarget) setNameModal(null) }}>
        <div className="playlist-picker-panel glass-island rounded-2xl w-80 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/8">
            <p className="text-sm font-semibold text-white/90">{nameModal.mode === 'save' ? t('eqSavePreset') : t('rename')}</p>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <input
              autoFocus type="text" value={nameModal.value}
              placeholder={t('eqNamePlaceholder')}
              onChange={e => setNameModal({ ...nameModal, value: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNameModal(null) }}
              className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none transition-all"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
            />
            <div className="flex items-center gap-2">
              <button onClick={() => setNameModal(null)} className="flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all" style={{ background: 'rgba(255,255,255,0.06)' }}>{t('cancel')}</button>
              <button onClick={submitName} disabled={!nameModal.value.trim()} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40" style={{ background: 'var(--accent)' }}>
                {nameModal.mode === 'save' ? t('eqSave') : t('rename')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function SystemTab() {
  const { startPage, setStartPage, closeToTray, setCloseToTray, mediaKeys, setMediaKeys, launchAtStartup, setLaunchAtStartup, autoSkipDrm, setAutoSkipDrm, hiddenNav, toggleNavHidden, resetSettings } = useSettings()
  const t = useT()
  const [confirmReset, setConfirmReset] = useState(false)

  const toggleTray = (v: boolean) => { setCloseToTray(v); window.electronAPI?.setCloseToTray?.(v) }
  const toggleLaunch = (v: boolean) => { setLaunchAtStartup(v); window.electronAPI?.setLoginItem?.(v) }

  // Re-push system prefs to the main process after a bulk change (reset)
  const syncSystem = () => {
    const s = useSettings.getState()
    window.electronAPI?.setCloseToTray?.(s.closeToTray)
    window.electronAPI?.setLoginItem?.(s.launchAtStartup)
  }

  const doReset = () => {
    if (!confirmReset) { setConfirmReset(true); return }
    resetSettings()
    syncSystem()
    setConfirmReset(false)
  }

  const PAGES: [StartPage, string][] = [
    ['main', t('home')],
    ['stream', t('stream')],
    ['releases', t('releases')],
    ['likes', t('likes')],
    ['playlists', t('playlists')],
  ]
  const SHORTCUTS: [string, string][] = [
    ['Space', t('scPlayPause')],
    ['← / →', t('scSeek')],
    ['↑ / ↓', t('scVolume')],
    ['Ctrl + ← / →', t('scPrevNext')],
  ]

  return (
    <>
      <Section title={t('startPage')}>
        <div className="grid grid-cols-2 gap-2">
          {PAGES.map(([val, label]) => {
            const active = startPage === val
            return (
              <button key={val} onClick={() => setStartPage(val)}
                className="px-3 py-2 rounded-lg text-sm text-left transition-all"
                style={{
                  background: active ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(255,255,255,0.05)',
                  color: active ? '#fff' : 'rgba(255,255,255,0.6)',
                  border: active ? '1px solid rgba(var(--accent-rgb),0.4)' : '1px solid rgba(255,255,255,0.08)',
                }}>
                {label}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title={t('behavior')}>
        <div className="space-y-2.5">
          <FsToggleRow label={t('closeToTray')} active={closeToTray} onClick={() => toggleTray(!closeToTray)} />
          <FsToggleRow label={t('mediaKeys')} active={mediaKeys} onClick={() => setMediaKeys(!mediaKeys)} />
          <FsToggleRow label={t('launchAtStartup')} active={launchAtStartup} onClick={() => toggleLaunch(!launchAtStartup)} />
          <FsToggleRow label={t('autoSkipDrm')} active={autoSkipDrm} onClick={() => setAutoSkipDrm(!autoSkipDrm)} />
        </div>
      </Section>

      <Collapsible title={t('sidebarTabs')}>
        <div className="flex flex-col gap-0.5">
          {NAV.map(item => {
            const visible = !hiddenNav.includes(item.id)
            const lastOne = visible && hiddenNav.length >= NAV.length - 1
            return (
              <div key={item.id} className="flex items-center justify-between py-1.5">
                <span className="text-sm text-white/75">{t(item.key)}</span>
                <Toggle active={visible} disabled={lastOne} onClick={() => toggleNavHidden(item.id)} />
              </div>
            )
          })}
        </div>
      </Collapsible>

      <Collapsible title={t('catPerf')}>
        <PerfSection />
      </Collapsible>

      <Collapsible title={t('shortcuts')}>
        <div className="space-y-1">
          {SHORTCUTS.map(([keys, desc]) => (
            <div key={keys} className="flex items-center justify-between gap-3 py-1">
              <span className="text-sm text-white/65">{desc}</span>
              <kbd className="text-[11px] text-white/80 px-2 py-1 rounded-md shrink-0"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      </Collapsible>

      <SettingsPresetsSection />

      <button onClick={doReset} onMouseLeave={() => setConfirmReset(false)}
        className="w-full py-2 px-3 rounded-lg text-sm transition-all"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
        {confirmReset ? t('resetConfirm') : t('resetSettings')}
      </button>
    </>
  )
}

function SystemToggle({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col min-w-0">
        <span className="text-sm text-white/80">{label}</span>
        <span className="text-[10px] text-white/40">{sub}</span>
      </div>
      <Toggle active={active} onClick={onClick} />
    </div>
  )
}

function PresetIconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick}
      className={`p-1.5 rounded-md shrink-0 transition-colors ${danger ? 'text-white/40 hover:text-red-400' : 'text-white/40 hover:text-white/85'}`}>
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        {children}
      </svg>
    </button>
  )
}

// Whole-settings presets: snapshot the current look/behaviour, switch with a click.
// The active chip is derived by comparing each preset against the live settings,
// so it stays accurate without having to dirty-track every individual setter.
function SettingsPresetsSection() {
  const s = useSettings()
  const showToast = useToast(st => st.show)
  const t = useT()
  const [nameModal, setNameModal] = useState<{ mode: 'save' | 'rename'; id?: string; value: string } | null>(null)

  // A preset is "active" if every key it stores matches the live settings. Comparing
  // by the preset's own keys (a subset) keeps presets saved by older versions - which
  // captured fewer keys - matching correctly.
  const current = useMemo(() => settingsSnapshot(s as unknown as Record<string, unknown>), [s])
  const activeId = s.settingsPresets.find(p => {
    const keys = Object.keys(p.data)
    return keys.length > 0 && keys.every(k => JSON.stringify(p.data[k]) === JSON.stringify(current[k]))
  })?.id ?? null

  const submitName = () => {
    if (!nameModal) return
    const v = nameModal.value.trim()
    if (!v) return
    if (nameModal.mode === 'save') { s.saveSettingsPreset(v); showToast(t('settingsPresetSaved'), 'success') }
    else if (nameModal.id) s.renameSettingsPreset(nameModal.id, v)
    setNameModal(null)
  }

  // Some captured settings live in the main process (tray/login item), so re-push
  // them after applying a preset that changed them.
  const applyPreset = (id: string) => {
    s.applySettingsPreset(id)
    const st = useSettings.getState()
    window.electronAPI?.setCloseToTray?.(st.closeToTray)
    window.electronAPI?.setLoginItem?.(st.launchAtStartup)
    showToast(t('settingsPresetApplied'), 'success')
  }

  const sharePreset = async (name: string, data: Record<string, unknown>) => {
    try { await navigator.clipboard.writeText(encodeSettingsPreset(name, data)); showToast(t('eqCodeCopied'), 'success') } catch { /* ignore */ }
  }
  const importFromCode = async () => {
    try {
      const decoded = decodeSettingsPreset(await navigator.clipboard.readText())
      if (!decoded) { showToast(t('eqImportFail'), 'error'); return }
      s.addSettingsPreset(decoded.name, decoded.data)
      showToast(t('eqPresetImported'), 'success')
    } catch { showToast(t('eqImportFail'), 'error') }
  }

  return (
    <Section title={t('settingsPresetsTitle')}>
      <p className="text-[10px] text-white/30 mb-2.5 leading-tight">{t('settingsPresetsSub')}</p>

      {s.settingsPresets.length > 0 ? (
        <div className="flex flex-col gap-1.5 mb-3">
          {s.settingsPresets.map(p => {
            const active = activeId === p.id
            return (
              <div key={p.id} className="flex items-center gap-1 rounded-lg pl-1 pr-1"
                style={{ background: active ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(255,255,255,0.04)', border: `1px solid ${active ? 'rgba(var(--accent-rgb),0.4)' : 'rgba(255,255,255,0.07)'}` }}>
                <button
                  onClick={() => applyPreset(p.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5 text-left"
                  title={t('settingsPresetApplied')}
                >
                  {active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />}
                  <span className="text-sm truncate" style={{ color: active ? '#fff' : 'rgba(255,255,255,0.8)' }}>{p.name}</span>
                </button>
                <PresetIconBtn title={t('eqShare')} onClick={() => sharePreset(p.name, p.data)}>
                  <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"/>
                </PresetIconBtn>
                <PresetIconBtn title={t('rename')} onClick={() => setNameModal({ mode: 'rename', id: p.id, value: p.name })}>
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
                </PresetIconBtn>
                <PresetIconBtn title={t('delete')} danger onClick={() => s.deleteSettingsPreset(p.id)}>
                  <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6"/>
                </PresetIconBtn>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-[11px] text-white/35 mb-3">{t('settingsPresetsEmpty')}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setNameModal({ mode: 'save', value: '' })} className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          + {t('eqSavePreset')}
        </button>
        <button onClick={importFromCode} className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {t('eqImportPreset')}
        </button>
      </div>

      {nameModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center playlist-picker-backdrop" onClick={e => { if (e.target === e.currentTarget) setNameModal(null) }}>
          <div className="playlist-picker-panel glass-island rounded-2xl w-80 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/8">
              <p className="text-sm font-semibold text-white/90">{nameModal.mode === 'save' ? t('eqSavePreset') : t('rename')}</p>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <input
                autoFocus type="text" value={nameModal.value}
                placeholder={t('eqNamePlaceholder')}
                onChange={e => setNameModal({ ...nameModal, value: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') submitName(); if (e.key === 'Escape') setNameModal(null) }}
                className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.5)' }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
              />
              <div className="flex items-center gap-2">
                <button onClick={() => setNameModal(null)} className="flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all" style={{ background: 'rgba(255,255,255,0.06)' }}>{t('cancel')}</button>
                <button onClick={submitName} disabled={!nameModal.value.trim()} className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40" style={{ background: 'var(--accent)' }}>
                  {nameModal.mode === 'save' ? t('eqSave') : t('rename')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Section>
  )
}

function LanguageTab() {
  const { lang, setLang } = useSettings()
  const t = useT()
  const LANGS: { val: Lang; label: string; flag: JSX.Element }[] = [
    { val: 'ru', label: 'Русский', flag: <FlagRU /> },
    { val: 'en', label: 'English', flag: <FlagUS /> },
  ]
  return (
    <Section title={t('language')}>
      <div className="grid grid-cols-3 gap-2.5">
        {LANGS.map(({ val, label, flag }) => {
          const active = lang === val
          return (
            <button
              key={val}
              onClick={() => setLang(val)}
              className="relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl text-sm transition-all"
              style={{
                background: active ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.05)',
                color: active ? '#fff' : 'rgba(255,255,255,0.65)',
                border: active ? '1px solid rgba(var(--accent-rgb),0.4)' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {flag}
              <span className="font-medium">{label}</span>
              {active && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
                  <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                  </svg>
                </span>
              )}
            </button>
          )
        })}

        {/* Placeholder for a future language */}
        <div
          className="flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl text-sm"
          style={{ border: '1px dashed rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.3)' }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          <span className="text-[11px]">{t('langSoon')}</span>
        </div>
      </div>
    </Section>
  )
}

function InfoTab() {
  const t = useT()
  const repo = 'https://github.com/rwxrwz/soundcloud-client'
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-sm text-white/85 leading-relaxed">{t('infoLine1')}</p>
        <p className="text-sm text-white/50 leading-relaxed mt-1">{t('infoLine2')}</p>
      </div>
      <button
        onClick={() => window.open(repo)}
        className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm text-white/80 hover:text-white transition-all"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.21 3.44 9.63 8.2 11.19.6.11.82-.25.82-.56 0-.28-.01-1.02-.02-2-3.34.72-4.04-1.6-4.04-1.6-.55-1.38-1.34-1.75-1.34-1.75-1.09-.74.08-.73.08-.73 1.21.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.57-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.24-3.17-.13-.3-.54-1.52.11-3.18 0 0 1.01-.32 3.3 1.21.96-.26 1.98-.39 3-.4 1.02 0 2.04.14 3 .4 2.28-1.53 3.29-1.21 3.29-1.21.65 1.66.24 2.88.12 3.18.77.83 1.24 1.88 1.24 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22 0 1.6-.01 2.9-.01 3.29 0 .31.21.68.83.56C20.57 21.91 24 17.49 24 12.29 24 5.78 18.63.5 12 .5z"/>
        </svg>
        github.com/rwxrwz/soundcloud-client
      </button>
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg px-2 py-2.5 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
      <p className="text-base font-bold text-white tabular-nums">{(value ?? 0).toLocaleString()}</p>
      <p className="text-[10px] text-white/40 mt-0.5 truncate">{label}</p>
    </div>
  )
}

function DynamicSwatch({ hex, active, onClick, title }: { hex: string; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 rounded-full transition-all duration-200 relative overflow-hidden shrink-0"
      style={{
        background: hex,
        transform: active ? 'scale(1.18)' : 'scale(1)',
        boxShadow: active ? `0 0 14px 3px ${hex}88` : undefined,
        outline: !active ? '2px dashed rgba(255,255,255,0.28)' : 'none',
        outlineOffset: '2px',
      }}
    >
      {active ? (
        <svg className="absolute inset-0 m-auto w-3.5 h-3.5 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
        </svg>
      ) : (
        <svg className="absolute inset-0 m-auto w-3 h-3 text-white/80 drop-shadow" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
      )}
    </button>
  )
}

function ThemeCard({ theme, active, label, sub, onClick }: { theme: Theme; active: boolean; label: string; sub: string; onClick: () => void }) {
  // Per-theme inline styles for the little preview (tile + play button)
  const p = {
    default: { row: {}, tile: { background: 'linear-gradient(135deg,#3a3550,#262233)', border: '0.5px solid rgba(255,255,255,0.07)', borderRadius: 11 }, play: { background: 'var(--accent)', borderRadius: '50%', boxShadow: undefined as string | undefined }, playIcon: '#1a1626' },
    glass:   { row: { background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.18)', borderRadius: 12, padding: 6 }, tile: { background: 'rgba(var(--accent-rgb),0.25)', border: '0.5px solid rgba(255,255,255,0.25)', borderRadius: 12 }, play: { background: 'rgba(var(--accent-rgb),0.5)', border: '0.5px solid rgba(255,255,255,0.4)', borderRadius: '50%', boxShadow: undefined }, playIcon: '#fff' },
    minimal: { row: {}, tile: { background: '#1b1b22', border: '0.5px solid rgba(255,255,255,0.1)', borderRadius: 4 }, play: { background: 'transparent', border: '1px solid rgba(var(--accent-rgb),0.7)', borderRadius: 4, boxShadow: undefined }, playIcon: 'var(--accent)' },
  }[theme]

  return (
    <button onClick={onClick} className="text-left rounded-xl p-3 transition-all"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: active ? '2px solid rgba(var(--accent-rgb),0.6)' : '1px solid rgba(255,255,255,0.08)',
      }}>
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[13px] font-medium" style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.85)' }}>{label}</span>
        {active
          ? <span className="w-[18px] h-[18px] rounded-full flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="#1a1626"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd"/></svg>
            </span>
          : <span className="w-[18px] h-[18px] rounded-full border" style={{ borderColor: 'rgba(255,255,255,0.25)' }} />}
      </div>
      <div className="flex items-center gap-2" style={p.row as React.CSSProperties}>
        <div className="w-10 h-10 shrink-0" style={p.tile as React.CSSProperties} />
        <div className="flex-1 min-w-0">
          <div className="h-2 rounded-full mb-1.5" style={{ width: '70%', background: 'rgba(255,255,255,0.3)' }} />
          <div className="h-1.5 rounded-full" style={{ width: '45%', background: 'rgba(255,255,255,0.14)' }} />
        </div>
        <div className="w-7 h-7 shrink-0 flex items-center justify-center" style={p.play as React.CSSProperties}>
          <svg className="w-3.5 h-3.5 ml-px" viewBox="0 0 24 24" fill={p.playIcon}><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <p className="text-[10px] text-white/35 mt-2.5 truncate">{sub}</p>
    </button>
  )
}

function FsToggleRow({ label, active, onClick, disabled }: { label: string; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3" style={{ opacity: disabled ? 0.4 : 1 }}>
      <span className="text-sm text-white/75">{label}</span>
      <Toggle active={active} onClick={onClick} disabled={disabled} />
    </div>
  )
}

function Toggle({ active, onClick, disabled }: { active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className="relative rounded-full transition-all duration-200 shrink-0"
      style={{ width: 38, height: 22, background: active ? 'var(--accent)' : 'rgba(255,255,255,0.15)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span className="absolute top-1/2 rounded-full bg-white transition-all duration-200"
        style={{ width: 16, height: 16, transform: 'translateY(-50%)', left: active ? 20 : 3 }} />
    </button>
  )
}

function WallpaperSection({ active, wallpaperPath, onPick, onNone }: {
  active: boolean; wallpaperPath: string; onPick: (p: string) => void; onNone: () => void
}) {
  const t = useT()
  const [list, setList] = useState<{ name: string; path: string }[]>([])
  const [dir, setDir] = useState('')
  const load = () => { window.electronAPI?.listWallpapers?.().then(setList).catch(() => {}) }
  useEffect(() => { window.electronAPI?.wallpapersDir?.().then(setDir).catch(() => {}); load() }, [])

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => window.electronAPI?.openWallpapers?.()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          {t('openFolder')}
        </button>
        <button onClick={load}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white transition-all"
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  )
}

// Collapsible block: a compact header row that reveals its content on click.
// Keeps heavy, secondary sections from walling the tab. Content stays mounted
// so it can animate open/close via a 0fr↔1fr grid-rows transition (handles
// auto height) plus a fade.
function Collapsible({ title, children, defaultOpen = false, preview }: { title: string; children: React.ReactNode; defaultOpen?: boolean; preview?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-all text-left"
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
function PreviewText({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] text-white/40 truncate">{children}</span>
}

function RadioBtn({ active, onClick, label, sub, disabled }: { active: boolean; onClick: () => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150
        ${disabled ? 'opacity-35 cursor-not-allowed' : active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
    >
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
        ${active ? 'border-[var(--accent)]' : 'border-white/20'}`}>
        {active && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
      </div>
      <div className="flex flex-col items-start min-w-0">
        <span>{label}</span>
        {sub && <span className="text-[10px] text-white/30 leading-tight">{sub}</span>}
      </div>
    </button>
  )
}

// ── Flags (SVG — render identically across OSes, unlike emoji flags) ──────────

// Twemoji flag emojis (CC-BY 4.0) — the open emoji set commonly used to show
// flags cross-platform. Loaded as SVG from the jsDelivr CDN.
function FlagImg({ code, alt }: { code: string; alt: string }) {
  return (
    <img
      src={`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`}
      alt={alt} width={30} height={30} className="shrink-0" style={{ objectFit: 'contain' }}
    />
  )
}
function FlagRU() { return <FlagImg code="1f1f7-1f1fa" alt="RU" /> }
function FlagUS() { return <FlagImg code="1f1fa-1f1f8" alt="US" /> }

// ── Performance ──────────────────────────────────────────────────────────────

function PerfSection() {
  const t = useT()
  const s = useSettings()
  const rows: [PerfKey, string, string][] = [
    ['perfBigLists',       t('perfBig'),   t('perfBigSub')],
    ['perfNoBlur',         t('perfBlur'),  t('perfBlurSub')],
    ['perfNoHeroAnim',     t('perfHero'),  t('perfHeroSub')],
    ['perfLowFps',         t('perfFps'),   t('perfFpsSub')],
    ['perfPauseUnfocused', t('perfPause'), t('perfPauseSub')],
    ['perfMiniOpaque',     t('perfMini'),  t('perfMiniSub')],
  ]
  return (
    <>
      <div className="flex flex-col gap-1">
        {rows.map(([key, label, sub]) => (
          <SystemToggle key={key} label={label} sub={sub} active={s[key]} onClick={() => s.setPerf(key, !s[key])} />
        ))}
      </div>
      <p className="text-[11px] text-white/35 leading-relaxed mt-3 p-3 rounded-lg"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {t('perfMiniNote')}
      </p>
    </>
  )
}

// ── Versions / updates ───────────────────────────────────────────────────────

function VersionsTab() {
  const t = useT()
  const { current, releases } = useUpdate()
  const showToast = useToast(s => s.show)
  const [checking, setChecking] = useState(false)

  const doCheck = async (force: boolean) => {
    setChecking(true)
    await checkForUpdates(force)
    setChecking(false)
    if (force) {
      const s = useUpdate.getState()
      const l = latestStable(s.releases)
      const up = !!l && !!s.current && cmpVersion(l.tag, s.current) > 0
      showToast(up ? `${t('versionsAvailable')} · v${l!.tag.replace(/^v/i, '')}` : t('versionsUpToDate'), up ? 'info' : 'success')
    }
  }
  useEffect(() => { void doCheck(false) }, [])

  const latest = latestStable(releases)
  const hasUpdate = !!latest && !!current && cmpVersion(latest.tag, current) > 0
  const sorted = [...releases].sort((a, b) => cmpVersion(b.tag, a.tag))
  const norm = (tag: string) => tag.replace(/^v/i, '')

  return (
    <div className="space-y-4">
      {/* Status card */}
      <div className="rounded-xl p-4 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-wider text-white/40">{t('versionsCurrent')}</p>
          <p className="text-lg font-semibold text-white tabular-nums">{current ? `v${norm(current)}` : '—'}</p>
          <p className="text-xs mt-0.5" style={{ color: hasUpdate ? 'var(--accent)' : 'rgba(255,255,255,0.45)' }}>
            {hasUpdate ? `${t('versionsAvailable')} · v${norm(latest!.tag)}` : t('versionsUpToDate')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => doCheck(true)}
            disabled={checking}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white transition-all disabled:opacity-50 flex items-center gap-1.5"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {checking && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {checking ? t('versionsChecking') : t('versionsCheck')}
          </button>
          {hasUpdate && (
            <button
              onClick={() => window.open(latest!.url)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ background: 'var(--accent)' }}
            >
              {t('versionsUpdate')}
            </button>
          )}
        </div>
      </div>

      {/* Changelog — separated from the current-version card */}
      <div className="pt-3 border-t border-white/8">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/35 mb-3">{t('versionsHistory')}</p>
        {sorted.length === 0 ? (
          <p className="text-sm text-white/40 py-6 text-center">{t('versionsEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {sorted.map(r => {
            const isCurrent = !!current && cmpVersion(r.tag, current) === 0
            const isLatest = latest?.tag === r.tag
            return (
              <div key={r.tag} className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-white tabular-nums">v{norm(r.tag)}</span>
                  {isLatest && !isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--accent)' }}>{t('versionsLatestTag')}</span>}
                  {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60">{t('versionsInstalled')}</span>}
                  {r.prerelease && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300/80">pre</span>}
                  {r.date && <span className="ml-auto text-[11px] text-white/35">{new Date(r.date).toLocaleDateString()}</span>}
                </div>
                {r.name && r.name !== r.tag && <p className="text-xs text-white/55 mt-1">{r.name}</p>}
                {r.body && <p className="text-[13px] text-white/55 mt-2 whitespace-pre-wrap leading-relaxed">{r.body.trim()}</p>}
                <button onClick={() => window.open(r.url)} className="text-[11px] text-white/40 hover:text-white/70 transition-colors mt-2">GitHub ↗</button>
              </div>
            )
          })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Category icons ───────────────────────────────────────────────────────────

function IconUser() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path strokeLinecap="round" d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>
}
function IconPalette() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path strokeLinecap="round" strokeLinejoin="round" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.4-4.5-8-10-8z"/></svg>
}
function IconSound() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="M6 9v6M10 5v14M14 8v8M18 11v2"/></svg>
}
function IconSystem() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>
}
function IconVersions() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2v14M12 22v-2M5 7l7-5 7 5v6c0 3-3 5-7 7-4-2-7-4-7-7z"/></svg>
}
function IconInfo() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/></svg>
}
