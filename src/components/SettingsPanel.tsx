import { useState, useEffect, useRef } from 'react'
import { useSettings, useProfile, useUI, ACCENT_COLORS, EQ_BANDS, AccentColor, BgStyle, VisualizerStyle, HeroAnim, Theme, PlayerStyle, FsLayout, Lang, StartPage } from '../store'
import { useT } from '../i18n'

interface Props { onClose: () => void }

const EQ_LABELS = ['60', '250', '1k', '4k', '12k']
type Category = 'profile' | 'appearance' | 'sound' | 'system' | 'language' | 'discord'

export function SettingsPanel({ onClose }: Props) {
  const t = useT()
  const [cat, setCat] = useState<Category>('profile')
  const [closing, setClosing] = useState(false)
  const requestClose = () => { if (closing) return; setClosing(true); setTimeout(onClose, 210) }

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const NAV: { id: Category; label: string; icon: JSX.Element }[] = [
    { id: 'profile',    label: t('catProfile'),    icon: <IconUser /> },
    { id: 'appearance', label: t('catAppearance'), icon: <IconPalette /> },
    { id: 'sound',      label: t('catSound'),      icon: <IconSound /> },
    { id: 'system',     label: t('catSystem'),     icon: <IconSystem /> },
    { id: 'language',   label: t('language'),      icon: <IconGlobe /> },
    { id: 'discord',    label: 'Discord',          icon: <IconDiscord /> },
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
            {cat === 'profile' && <ProfileTab onClose={onClose} />}
            {cat === 'appearance' && <AppearanceTab />}
            {cat === 'sound' && <SoundTab />}
            {cat === 'system' && <SystemTab />}
            {cat === 'language' && <LanguageTab />}
            {cat === 'discord' && <DiscordTab />}
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
  const { accent, bgStyle, visualizerStyle, heroAnim, wallpaperPath, hoverPreview, theme, playerStyle, fsLayout, fsShowLyrics, fsLiveBg, fsBeatGlow, fsArtCrossfade, lyricsFontScale, setAccent, setBgStyle, setVisualizerStyle, setHeroAnim, setWallpaperPath, setHoverPreview, setTheme, setPlayerStyle, setFsLayout, setFsShowLyrics, setFsLiveBg, setFsBeatGlow, setFsArtCrossfade, setLyricsFontScale } = useSettings()
  const toggleLyrics = () => { const v = !fsShowLyrics; setFsShowLyrics(v); if (!v && fsLayout === 'stack') setFsLayout('side') }
  const { artRgb } = useUI()
  const t = useT()
  const artworkHex = `#${artRgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
  return (
    <>
      <Section title={t('theme')}>
        <p className="text-[10px] text-white/30 mb-2.5 leading-tight">{t('themeSub')}</p>
        <div className="grid grid-cols-2 gap-2.5">
          {([
            ['default', t('themeDefault'), t('themeDefaultSub')],
            ['glass',   t('themeGlass'),   t('themeGlassSub')],
            ['minimal', t('themeMinimal'), t('themeMinimalSub')],
          ] as [Theme, string, string][]).map(([val, label, sub]) => (
            <ThemeCard key={val} theme={val} active={theme === val} label={label} sub={sub} onClick={() => setTheme(val)} />
          ))}
        </div>
      </Section>

      <Section title={t('playerStyleLabel')}>
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
      </Section>

      <Section title={t('accentColor')}>
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
      </Section>

      <Section title={t('background')}>
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
      </Section>

      <WallpaperSection
        active={bgStyle === 'wallpaper'}
        wallpaperPath={wallpaperPath}
        onPick={(p) => { setWallpaperPath(p); setBgStyle('wallpaper') }}
        onNone={() => setBgStyle('artwork')}
      />

      <Section title={t('visualizer')}>
        <div className="space-y-1.5">
          {([
            ['bars',   t('vizBars'),   t('vizBarsSub')],
            ['wave',   t('vizWave'),   t('vizWaveSub')],
            ['mirror', t('vizMirror'), t('vizMirrorSub')],
          ] as [VisualizerStyle, string, string][]).map(([val, label, sub]) => (
            <RadioBtn key={val} active={visualizerStyle === val} onClick={() => setVisualizerStyle(val)} label={label} sub={sub} />
          ))}
        </div>
      </Section>

      {/* Home animation & hover preview only matter in the default player style */}
      {playerStyle !== 'fullscreen' && (
      <Section title={t('heroAnimation')}>
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
      </Section>
      )}

      {playerStyle !== 'fullscreen' && (
      <Section title={t('hoverPreview')}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm text-white/80">{t('hoverPreview')}</span>
            <span className="text-[10px] text-white/40">{t('hoverPreviewSub')}</span>
          </div>
          <Toggle active={hoverPreview} onClick={() => setHoverPreview(!hoverPreview)} />
        </div>
      </Section>
      )}
    </>
  )
}

function SoundTab() {
  const { eq, eqEnabled, setEqBand, setEqEnabled, resetEq, outputDeviceId, setOutputDeviceId, crossfade, setCrossfade } = useSettings()
  const t = useT()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

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
    </Section>
    </>
  )
}

function SystemTab() {
  const { startPage, setStartPage, closeToTray, setCloseToTray, mediaKeys, setMediaKeys, launchAtStartup, setLaunchAtStartup, autoSkipDrm, setAutoSkipDrm, resetSettings, importSettings } = useSettings()
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const toggleTray = (v: boolean) => { setCloseToTray(v); window.electronAPI?.setCloseToTray?.(v) }
  const toggleLaunch = (v: boolean) => { setLaunchAtStartup(v); window.electronAPI?.setLoginItem?.(v) }

  // Re-push system prefs to the main process after a bulk change (import/reset)
  const syncSystem = () => {
    const s = useSettings.getState()
    window.electronAPI?.setCloseToTray?.(s.closeToTray)
    window.electronAPI?.setLoginItem?.(s.launchAtStartup)
  }

  const doExport = () => {
    const s = useSettings.getState() as unknown as Record<string, unknown>
    const data: Record<string, unknown> = {}
    for (const k of Object.keys(s)) if (typeof s[k] !== 'function') data[k] = s[k]
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'soundcloud-player-settings.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(txt => {
      try { importSettings(JSON.parse(txt)); syncSystem() } catch { /* invalid file */ }
    })
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
        <p className="text-[10px] text-white/30 mb-2.5 leading-tight">{t('startPageSub')}</p>
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
        <div className="space-y-3.5">
          <SystemToggle label={t('closeToTray')} sub={t('closeToTraySub')} active={closeToTray} onClick={() => toggleTray(!closeToTray)} />
          <SystemToggle label={t('mediaKeys')} sub={t('mediaKeysSub')} active={mediaKeys} onClick={() => setMediaKeys(!mediaKeys)} />
          <SystemToggle label={t('launchAtStartup')} sub={t('launchAtStartupSub')} active={launchAtStartup} onClick={() => toggleLaunch(!launchAtStartup)} />
          <SystemToggle label={t('autoSkipDrm')} sub={t('autoSkipDrmSub')} active={autoSkipDrm} onClick={() => setAutoSkipDrm(!autoSkipDrm)} />
        </div>
      </Section>

      <Section title={t('shortcuts')}>
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
      </Section>

      <Section title={t('settingsBackup')}>
        <div className="flex gap-2">
          <button onClick={doExport}
            className="flex-1 py-2 px-3 rounded-lg text-sm text-white/70 hover:text-white transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {t('exportSettings')}
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="flex-1 py-2 px-3 rounded-lg text-sm text-white/70 hover:text-white transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            {t('importSettings')}
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} className="hidden" />
        </div>
        <button onClick={doReset} onMouseLeave={() => setConfirmReset(false)}
          className="w-full mt-2 py-2 px-3 rounded-lg text-sm transition-all"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
          {confirmReset ? t('resetConfirm') : t('resetSettings')}
        </button>
      </Section>
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

function DiscordTab() {
  const t = useT()
  return (
    <Section title="Discord">
      <div className="flex items-center justify-between" style={{ opacity: 0.5 }}>
        <div className="flex flex-col">
          <span className="text-sm text-white/80">{t('discordRpc')}</span>
          <span className="text-[10px]" style={{ color: 'var(--accent)' }}>{t('discordRpcSub')}</span>
        </div>
        <Toggle active={false} onClick={() => {}} />
      </div>
    </Section>
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
    <button onClick={disabled ? undefined : onClick} disabled={disabled} className="relative rounded-full transition-all duration-200"
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
    <Section title={t('videoWallpapers')}>
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
    </Section>
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
function IconGlobe() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>
}
function IconSystem() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/></svg>
}
function IconDiscord() {
  return <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.3 4.4A19 19 0 0015.6 3l-.2.5a13 13 0 014.1 2 17 17 0 00-13 0 13 13 0 014.1-2L10.4 3a19 19 0 00-4.7 1.4C2.8 8.7 2 13 2.4 17.2A19 19 0 008 20l.6-1c-.9-.3-1.7-.7-2.4-1.2l.5-.4a13 13 0 0011 0l.5.4c-.7.5-1.5.9-2.4 1.2l.6 1a19 19 0 005.6-2.8c.5-4.9-.8-9.1-1.7-12.8zM9 15c-.9 0-1.6-.8-1.6-1.9S8.1 11.3 9 11.3s1.6.9 1.6 1.9S9.9 15 9 15zm6 0c-.9 0-1.6-.8-1.6-1.9s.7-1.8 1.6-1.8 1.6.9 1.6 1.9S15.9 15 15 15z"/></svg>
}
