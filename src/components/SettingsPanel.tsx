import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react'
import { RemoteSection } from './RemoteSection'
import { useSettings, useProfile, useUI, useUpdate, useToast, useStats, useLyrics, settingsSnapshot, EQ_BANDS, Lang, StartPage } from '../store'
import { bestDay, daysListened, humanTime, lastDays, perActiveDay, streak, topArtists } from '../services/stats'
import { ReleaseNotes } from './ReleaseNotes'
import { Toggle, FsToggleRow, Flag, FLAG_RU, FLAG_US, FLAG_UA, Collapsible, PreviewText } from './settingsControls'
import { DateSetting } from './DateSetting'
import { ThemesSection } from './ThemesSection'
import { checkForUpdates, latestStable, cmpVersion } from '../services/updates'
import { encodeEqPreset, decodeEqPreset } from '../services/eqPresets'
import { encodeSettingsPreset, decodeSettingsPreset } from '../services/settingsPresetCode'
import { useT } from '../i18n'
import { LyricsTimingSection } from './LyricsTimingSection'
import { useEscape } from '../hooks/useEscape'
import { IconUser, IconPalette, IconLyrics, IconSound, IconSystem, IconRemote, IconVersions, IconInfo } from './settingsIcons'
import { SearchField, SearchResults } from './SettingsSearch'
import { searchSettings, type Place } from '../services/settingsSearch'

interface Props { onClose: () => void }

const EQ_LABELS = ['60', '250', '1k', '4k', '12k']
type Category = 'profile' | 'appearance' | 'sound' | 'lyrics' | 'system' | 'remote' | 'versions' | 'info'

export function SettingsPanel({ onClose }: Props) {
  const t = useT()
  const settingsTab = useUI(s => s.settingsTab)
  const [cat, setCat] = useState<Category>((settingsTab as Category) || 'profile')
  const [closing, setClosing] = useState(false)
  const setEditMode = useUI(s => s.setEditMode)
  const setShowSettings = useUI(s => s.setShowSettings)

  const requestClose = () => { if (closing) return; setClosing(true); setTimeout(onClose, 210) }

  /* ── search ──────────────────────────────────────────────────────────── */
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const hits = useMemo(() => searchSettings(query), [query])
  useEffect(() => { setActive(0) }, [query])
  const searching = query.trim().length >= 2

  /* Which tabs the current results are in. The nav dims to say "not where
     you are looking" - and a tab that holds one of the answers is exactly
     where you are looking, so dimming it says the opposite of the truth.
     Everything in the editing mode is reached through Appearance, so that
     is the tab those results belong to. */
  const liveTabs = useMemo(() => new Set<Category>(
    hits.map(h => (h.entry.place.kind === 'edit' ? 'appearance' : h.entry.place.tab) as Category)), [hits])

  /* The row a result pointed at, held just long enough to be found after the
     new tab has mounted and then cleared, so it flashes once per visit
     rather than every time the tab is reopened. */
  const [flash, setFlash] = useState<string | null>(null)
  useEffect(() => {
    if (!flash) return
    const el = document.querySelector(`[data-setting="${flash}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.remove('set-flash')
      /* Reading offsetWidth between the two restarts the animation; without
         it, landing twice on the same row plays it only the first time. */
      void el.offsetWidth
      el.classList.add('set-flash')
    }
    const id = setTimeout(() => setFlash(null), 1400)
    return () => clearTimeout(id)
  }, [flash, cat])

  const pick = (place: Place) => {
    setQuery('')
    if (place.kind === 'tab') { setCat(place.tab as Category); if (place.anchor) setFlash(place.anchor); return }
    /* Everything this one names lives on the running player, so the panel
       has to get out of the way first. It comes back when the mode closes,
       the same way the door in the Appearance tab works. */
    setShowSettings(false)
    setEditMode(true, true, place)
  }

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (query) setQuery(''); else requestClose(); return }
    if (!searching || !hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % hits.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i - 1 + hits.length) % hits.length) }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[active]; if (h) pick(h.entry.place) }
  }

  // Sliding pill behind the active tab - the same device the sidebar uses, so
  // the selection travels instead of blinking from one row to another.
  const navRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const nav = navRef.current
    const pill = pillRef.current
    if (!nav || !pill) return
    const btn = nav.querySelector('[data-active="true"]') as HTMLElement | null
    if (!btn) return
    pill.style.transform = `translateY(${btn.offsetTop}px)`
    pill.style.height = `${btn.offsetHeight}px`
  }, [cat])

  // Only when this is the topmost overlay - it can sit over a track or
  // artist page, and all of them used to close on one press.
  useEscape(requestClose)

  const NAV: { id: Category; label: string; icon: JSX.Element }[] = [
    { id: 'profile',    label: t('catAccount'),    icon: <IconUser /> },
    { id: 'appearance', label: t('catAppearance'), icon: <IconPalette /> },
    { id: 'sound',      label: t('catSound'),      icon: <IconSound /> },
    { id: 'lyrics',     label: t('catLyrics'),     icon: <IconLyrics /> },
    { id: 'system',     label: t('catSystem'),     icon: <IconSystem /> },
    { id: 'remote',     label: t('catRemote'),     icon: <IconRemote /> },
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
        <div className="w-48 shrink-0 flex flex-col border-r border-white/[0.045] p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <p className="px-2 pt-1 pb-2.5 text-xs font-semibold text-white/40 uppercase tracking-wider">{t('settings')}</p>
          <SearchField value={query} onChange={setQuery} onKey={onSearchKey} />
          {/* Dimmed rather than hidden while a search is running: the tabs are
              the map of this panel, and taking the map away mid-search leaves
              nothing to fall back to. Clicking one still works and drops the
              query, which is the obvious way out. */}
          <div ref={navRef} className="space-y-0.5 relative">
            <span
              ref={pillRef}
              className="absolute left-0 right-0 rounded-lg pointer-events-none"
              style={{
                top: 0,
                height: 0,
                background: 'rgba(var(--accent-rgb), 0.18)',
                willChange: 'transform',
                transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), height 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
            {NAV.map(item => {
              const active = cat === item.id
              return (
                <button
                  key={item.id}
                  data-active={active ? 'true' : 'false'}
                  onClick={() => { setQuery(''); setCat(item.id) }}
                  className="icon-btn row-hover relative w-full flex items-center h-9 gap-2.5 px-3 rounded-lg text-sm transition-all"
                  style={{
                    // The pill behind provides the active fill; the row only
                    // carries the text colour. Hover tint comes from .row-hover.
                    // The height is fixed so dropping the label cannot change
                    // the row geometry the pill is measured against.
                    color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                    // Only the tabs with nothing in them step back.
                    opacity: searching && !liveTabs.has(item.id) ? 0.3 : 1,
                  }}
                >
                  <span className="shrink-0" style={{ color: active ? 'var(--accent)' : 'inherit' }}>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.045] shrink-0">
            <span className="font-semibold text-sm text-white">
              {searching ? `${t('findResults')} · ${hits.length}` : NAV.find(n => n.id === cat)?.label}
            </span>
            <button onClick={requestClose} className="icon-btn p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          {/* key on the container remounts it per tab, so the switch gets the same
              page-enter animation the track list uses - and the scroll starts at
              the top of the new tab instead of keeping the previous offset. */}
          {searching ? (
            <div className="flex-1 overflow-y-auto p-3">
              <SearchResults hits={hits} query={query} active={active} setActive={setActive} onPick={pick} />
            </div>
          ) : (
          <div key={cat} className="flex-1 overflow-y-auto p-5 space-y-6 page-enter">
            {cat === 'profile' && <ProfileTab onClose={onClose} />}
            {cat === 'appearance' && <AppearanceTab />}
            {cat === 'sound' && <SoundTab />}
            {cat === 'lyrics' && <LyricsTab />}
            {cat === 'system' && <SystemTab />}
            {cat === 'remote' && <RemoteSection />}
            {cat === 'versions' && <VersionsTab />}
            {cat === 'info' && <InfoTab />}
          </div>
          )}
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
        className="icon-btn w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm text-white/70 hover:text-white transition-all"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6M10 14L21 3"/>
        </svg>
        {t('openProfile')}
      </button>

      <ListeningSection />

      <Section title={t('account')} anchor="signout">
        <button
          onClick={() => { logout(); onClose() }}
          className="icon-btn w-full py-2 px-3 rounded-lg text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all text-left"
        >
          {t('signOut')}
        </button>
      </Section>
    </>
  )
}

/* Appearance is not a list of named settings any more. Every look-and-feel
   choice lives in the editing mode, where it hangs off the part of the player
   it changes, so this tab is the door to it and nothing else. Keeping a second
   copy here is how accent ended up configurable in four places at once. */
function AppearanceTab() {
  const t = useT()
  const { setShowSettings, setEditMode } = useUI()
  return (
    <>
    <button
      onClick={() => { setShowSettings(false); setEditMode(true, true) }}
      className="icon-btn w-full px-4 py-4 rounded-xl text-left transition-all flex items-center gap-3.5"
      style={{ background: 'rgba(var(--accent-rgb),0.14)', border: '1px solid rgba(var(--accent-rgb),0.35)' }}
    >
      <span className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: 'rgba(var(--accent-rgb),0.2)' }}>
        <svg className="w-[18px] h-[18px]" style={{ color: 'var(--accent)' }} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{t('vcLive')}</span>
        <span className="block text-[11px] text-white/45 leading-snug mt-0.5">{t('vcLiveSub')}</span>
      </span>
    </button>
    {/* The tab is one button now, so it has to say where its settings went. */}
    <div className="mt-4 px-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/35">{t('vcLiveWhat')}</p>
      <p className="text-[12px] text-white/45 leading-relaxed mt-1.5">{t('vcLiveList')}</p>
    </div>
    {/* The other way round the same subject: not a setting at a time, but a
        whole look at once. Under the door rather than above it - a theme is
        a starting point, and the editing mode is where it gets finished. */}
    <ThemesSection />
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
    <Section title={t('outputDevice')} anchor="device">
      <div className="icon-btn rounded-lg">
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
      </div>
    </Section>

    <Section title={t('crossfade')} anchor="crossfade">
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

    <Section title={t('equalizer')} anchor="eq">
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
                  className="icon-btn px-2.5 py-1 rounded-full text-[11px] font-medium transition-all"
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
        <button onClick={() => setNameModal({ mode: 'save', value: '' })} className="icon-btn px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          + {t('eqSavePreset')}
        </button>
        <button onClick={importPreset} className="icon-btn px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
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
          <div className="px-4 py-3 border-b border-white/[0.045]">
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
              <button onClick={() => setNameModal(null)} className="icon-btn flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all" style={{ background: 'rgba(255,255,255,0.06)' }}>{t('cancel')}</button>
              <button onClick={submitName} disabled={!nameModal.value.trim()} className="icon-btn flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40" style={{ background: 'var(--accent)' }}>
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
  const { startPage, setStartPage, closeToTray, setCloseToTray, mediaKeys, setMediaKeys, launchAtStartup, setLaunchAtStartup, autoSkipDrm, setAutoSkipDrm, datadomeBypass, setDatadomeBypass, discordRpc, setDiscordRpc, autoRadio, setAutoRadio, resetSettings } = useSettings()
  const t = useT()
  const askConfirm = useUI(s => s.askConfirm)

  const toggleTray = (v: boolean) => { setCloseToTray(v); window.electronAPI?.setCloseToTray?.(v) }
  const toggleLaunch = (v: boolean) => { setLaunchAtStartup(v); window.electronAPI?.setLoginItem?.(v) }
  // Autostart is a Windows-only feature (portable-exe login item); disable elsewhere.
  const isWindows = navigator.userAgent.includes('Windows')
  const toggleDatadome = (v: boolean) => { setDatadomeBypass(v); window.electronAPI?.setDatadomeBypass?.(v) }
  const toggleDiscord = (v: boolean) => { setDiscordRpc(v); window.electronAPI?.setDiscordRpc?.(v) }

  // Re-push system prefs to the main process after a bulk change (reset)
  const syncSystem = () => {
    const s = useSettings.getState()
    window.electronAPI?.setCloseToTray?.(s.closeToTray)
    window.electronAPI?.setLoginItem?.(s.launchAtStartup)
    window.electronAPI?.setDatadomeBypass?.(s.datadomeBypass)
    window.electronAPI?.setDiscordRpc?.(s.discordRpc)
  }

  const doReset = async () => {
    if (!await askConfirm(t('resetAsk'), t('resetSettings'), true)) return
    resetSettings()
    syncSystem()
  }

  const PAGES: [StartPage, string][] = [
    ['main', t('home')],
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
      {/* First on the tab on purpose. Somebody looking for the language
          picker is, by definition, possibly unable to read the labels
          around it - so it goes where it can be found by shape rather than
          by reading: the top. */}
      <LanguageTab />

      <Section title={t('dateTitle')} anchor="date">
        <DateSetting />
      </Section>

      <Section title={t('startPage')} anchor="startpage">
        <div className="grid grid-cols-2 gap-2">
          {PAGES.map(([val, label]) => {
            const active = startPage === val
            return (
              <button key={val} onClick={() => setStartPage(val)}
                className="icon-btn px-3 py-2 rounded-lg text-sm text-left transition-all"
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
        {/* One handle per switch rather than one for the group: the search
            names each of these by itself, and landing on "Behavior" with
            seven rows under it leaves the finding still to do. */}
        <div className="space-y-2.5">
          <div data-setting="tray"><FsToggleRow label={t('closeToTray')} active={closeToTray} onClick={() => toggleTray(!closeToTray)} /></div>
          <div data-setting="mediakeys"><FsToggleRow label={t('mediaKeys')} active={mediaKeys} onClick={() => setMediaKeys(!mediaKeys)} /></div>
          <div data-setting="radio"><FsToggleRow label={t('autoRadio')} note={t('autoRadioNote')} active={autoRadio} onClick={() => setAutoRadio(!autoRadio)} /></div>
          <div data-setting="startup">
            <FsToggleRow label={t('launchAtStartup')} active={isWindows && launchAtStartup} disabled={!isWindows} onClick={() => toggleLaunch(!launchAtStartup)} />
            {!isWindows && <p className="text-[10px] text-white/30 mt-0.5">{t('launchAtStartupWin')}</p>}
          </div>
          <div data-setting="drm"><FsToggleRow label={t('autoSkipDrm')} active={autoSkipDrm} onClick={() => setAutoSkipDrm(!autoSkipDrm)} /></div>
          <div data-setting="datadome"><FsToggleRow label={t('datadomeBypass')} active={datadomeBypass} onClick={() => toggleDatadome(!datadomeBypass)} /></div>
          <div data-setting="discord"><FsToggleRow label={t('discordRpc')} note={t('discordRpcNote')} active={discordRpc} onClick={() => toggleDiscord(!discordRpc)} /></div>
        </div>
      </Section>

      <div data-setting="shortcuts"><Collapsible title={t('shortcuts')}>
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
      </Collapsible></div>

      <SettingsPresetsSection />

      <button onClick={doReset} data-setting="reset"
        className="w-full py-2 px-3 rounded-lg text-sm transition-all"
        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
        {t('resetSettings')}
      </button>
    </>
  )
}

/* The key, the switch, and one sentence about where the audio goes.
   The field is write-only by design: it is handed to the main process, which
   puts it in the OS keychain, and nothing ever reads it back out to the
   window - so there is no value to show here, only whether one is stored. */
/* Everything about words under the music, in one place: where they come
   from, who times them, and the two folders that remember the answers. */
function LyricsTab() {
  return (
    <>
      <div data-setting="timing"><LyricsTimingSection /></div>
      <GeniusSection />
      <LyricsCacheSection />
    </>
  )
}

function LyricsCacheSection() {
  const t = useT()
  const showToast = useToast(s => s.show)
  const askConfirm = useUI(s => s.askConfirm)
  const [stat, setStat] = useState<{ files: number; bytes: number } | null>(null)
  const refresh = () => { window.electronAPI?.lyricsCacheStat?.().then(setStat).catch(() => {}) }
  useEffect(refresh, [])

  const size = stat
    ? stat.bytes >= 1024 * 1024
      ? `${(stat.bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(stat.bytes / 1024))} KB`
    : ''

  return (
    <Section title={t('lyCache')} anchor="lycache">
      <p className="text-[11px] text-white/40 leading-relaxed mb-2.5">{t('lyCacheSub')}</p>
      {stat && (
        <p className="text-[11px] text-white/55 mb-2.5">
          {stat.files ? `${stat.files} ${t('lyCacheFiles')} · ${size}` : t('lyCacheEmpty')}
        </p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => window.electronAPI?.lyricsCacheOpen?.()}
          className="icon-btn px-3 py-2 rounded-lg text-[12px] text-white/80 transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {t('lyCacheOpen')}
        </button>
        {/* A dialog, not a second press on the same button. Arming a control
            by clicking it means the click that does the damage lands on the
            spot the cursor is already sitting on, and the only thing telling
            you the button changed meaning is its own label. */}
        <button
          onClick={async () => {
            if (!await askConfirm(t('lyCacheClearAsk'), t('lyCacheClear'), true)) return
            const gone = await window.electronAPI?.lyricsCacheClear?.()
            /* The "L" marks live in browser storage and are only ever a
               reflection of these files. Leaving them behind is how a
               cleared cache still showed a badge on every track. */
            useLyrics.getState().clear()
            refresh()
            showToast(gone ? `${t('lyCacheCleared')} (${gone})` : t('lyCacheEmpty'), 'success')
          }}
          disabled={!stat?.files}
          className="icon-btn px-3 py-2 rounded-lg text-[12px] transition-all disabled:opacity-40"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
          {t('lyCacheClear')}
        </button>
      </div>
    </Section>
  )
}

/* One question, asked once: what puts the words in time with the music.
   Where the words come from is not a setting - they are always a human's,
   from a catalogue or from Genius, and the player will not invent any. So
   the only choice left is who does the timing, and it is a choice between
   three states rather than two switches that could contradict each other. */

/* The model, as a thing you own rather than a side effect of a radio
   button. It has three states and they are one card, not three: the same
   header stays put while the body below it changes, so installing does
   not make the panel jump.

   What it says about the model is what somebody deciding whether to spend
   300MB would want to know - what it is, where it comes from, why it is
   not already in the build, and roughly how fast it runs - and all of it
   is read off the code that actually does the work, not written twice. */
function GeniusSection() {
  const t = useT()
  const showToast = useToast(s => s.show)
  const [gKey, setGKey] = useState('')
  const [gStored, setGStored] = useState(false)
  const [needed, setNeeded] = useState(false)
  useEffect(() => {
    window.electronAPI?.geniusHasToken?.().then(setGStored).catch(() => {})
    window.electronAPI?.geniusReady?.().then(ok => setNeeded(!ok)).catch(() => {})
  }, [])

  const saveGenius = async () => {
    const v = gKey.trim()
    if (!v) return
    await window.electronAPI?.geniusSetToken?.(v)
    setGKey(''); setGStored(true)
    showToast(t('aiKeySaved'), 'success')
  }

  if (!needed && !gStored) return null

  return (
    <Section title={t('gnTitle')} anchor="genius">
      <p className="text-[11px] text-white/45 leading-relaxed mb-2.5">
        {needed ? t('gnNeeded') : t('gnShort')}
      </p>
      <Collapsible title={t('gnUseOwn')} defaultOpen={needed}
        preview={gStored ? <PreviewText>{t('gnSet')}</PreviewText> : undefined}>
        <div className="flex items-center gap-2">
          <input type="password" value={gKey} placeholder={t('gnPlaceholder')}
            onChange={e => setGKey(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveGenius() }}
            className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm text-white focus:outline-none transition-all"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }} />
          <button onClick={saveGenius} disabled={!gKey.trim()}
            className="icon-btn px-3 py-2 rounded-lg text-[12px] font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: 'var(--accent)' }}>{t('save')}</button>
        </div>
        <a href="https://genius.com/api-clients" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] mt-2" style={{ color: 'var(--accent)' }}>
          {t('gnGetToken')}
          <svg className="w-3 h-3 shrink-0 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
        <p className="text-[10px] text-white/30 mt-2 leading-snug">{t('gnLimits')}</p>
      </Collapsible>
    </Section>
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
    window.electronAPI?.setDatadomeBypass?.(st.datadomeBypass)
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
    <Section title={t('settingsPresetsTitle')} anchor="presets">
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
        <button onClick={() => setNameModal({ mode: 'save', value: '' })} className="icon-btn px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          + {t('eqSavePreset')}
        </button>
        <button onClick={importFromCode} className="icon-btn px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/70 hover:text-white transition-all" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
          {t('eqImportPreset')}
        </button>
      </div>

      {nameModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center playlist-picker-backdrop" onClick={e => { if (e.target === e.currentTarget) setNameModal(null) }}>
          <div className="playlist-picker-panel glass-island rounded-2xl w-80 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.045]">
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
                <button onClick={() => setNameModal(null)} className="icon-btn flex-1 py-2 rounded-xl text-sm font-medium text-white/60 hover:text-white/90 transition-all" style={{ background: 'rgba(255,255,255,0.06)' }}>{t('cancel')}</button>
                <button onClick={submitName} disabled={!nameModal.value.trim()} className="icon-btn flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40" style={{ background: 'var(--accent)' }}>
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
  // English first, as on the welcome screen and in the defaults. Each
  // language is written in itself - the one person who needs this control
  // most is the one who cannot read the language it is currently set to.
  const LANGS: { val: Lang; label: string; flag: JSX.Element }[] = [
    { val: 'en', label: 'English', flag: <FlagUS /> },
    { val: 'ru', label: 'Русский', flag: <FlagRU /> },
    { val: 'uk', label: 'Українська', flag: <FlagUA /> },
  ]
  return (
    <Section title={t('language')} anchor="lang">
      <div className="grid grid-cols-3 gap-2.5">
        {LANGS.map(({ val, label, flag }) => {
          const active = lang === val
          return (
            <button
              key={val}
              onClick={() => setLang(val)}
              className="icon-btn relative flex flex-col items-center justify-center gap-2 py-4 px-2 rounded-xl text-sm transition-all"
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

      </div>
    </Section>
  )
}

function InfoTab() {
  const t = useT()
  const repo = 'https://github.com/rwxrwz/soundcloud-client'
  return (
    <div className="flex flex-col gap-4">
      <div className="icon-btn no-ring rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <p className="text-sm text-white/85 leading-relaxed">{t('infoLine1')}</p>
        <p className="text-sm text-white/50 leading-relaxed mt-1">{t('infoLine2')}</p>
      </div>
      <button
        onClick={() => window.open(repo)}
        className="icon-btn w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm text-white/80 hover:text-white transition-all"
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
    <div className="icon-btn no-ring rounded-lg px-2 py-2.5 text-center" style={{ background: 'rgba(255,255,255,0.05)' }}>
      <p className="text-base font-bold text-white tabular-nums">{(value ?? 0).toLocaleString()}</p>
      <p className="text-[10px] text-white/40 mt-0.5 truncate">{label}</p>
    </div>
  )
}

/* What the player has actually been used for.
 *
 * Every figure here comes from the same three records - a total, a bucket
 * per day, a bucket per artist - so none of them can disagree with
 * another. They live in their own store, not in settings: "reset all
 * settings" leaves them alone, a shared settings preset does not carry
 * them, and an app update does not touch them, because the file they sit
 * in is the user's data rather than the application's. */
function ListeningSection() {
  const t = useT()
  const { listenedSec, byDay, artists, plays, firstAt } = useStats()
  const askConfirm = useUI(s => s.askConfirm)
  const resetStats = useStats(s => s.resetStats)
  const lang = useSettings(s => s.lang)
  const [open, setOpen] = useState(false)

  const hh = (sec: number) => humanTime(sec, t)
  const loc = lang === 'ru' ? 'ru-RU' : lang === 'uk' ? 'uk-UA' : 'en-GB'
  const best = bestDay(byDay)
  const run = streak(byDay)
  const top = topArtists(artists, 4)

  if (listenedSec <= 0) {
    return (
      <Section title={t('stListening')} anchor="stats">
        <p className="text-[12px] text-white/35 leading-snug">{t('stEmpty')}</p>
      </Section>
    )
  }

  return (
    <Section title={t('stListening')} anchor="stats">
      {/* The headline is the handle. The figure everyone comes for stays
          visible while the section is shut, and the breakdown - which is
          six tiles, a best day and a chart - only unrolls when asked. */}
      <button
        onClick={() => setOpen(o => !o)}
        className="icon-btn w-full rounded-xl px-4 py-3.5 text-left transition-all flex items-center gap-3"
        style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.22)' }}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[22px] font-bold text-white leading-none tabular-nums">{hh(listenedSec)}</span>
          <span className="block text-[11px] text-white/45 mt-1.5 truncate">
            {t('stTotal')}
            {firstAt > 0 && ` · ${t('stSince')} ${new Date(firstAt).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' })}`}
          </span>
        </span>
        <svg className="w-4 h-4 shrink-0 transition-transform duration-300 ease-out"
          style={{ color: 'var(--accent)', transform: open ? 'rotate(90deg)' : 'none' }}
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ paddingTop: 8, opacity: open ? 1 : 0, transform: open ? 'none' : 'translateY(-4px)', transition: 'opacity 0.25s ease, transform 0.25s ease' }}>
            <div className="grid grid-cols-2 gap-2">
              <StatBox label={t('stWeek')} value={hh(lastDays(byDay, 7))} />
              <StatBox label={t('stMonth')} value={hh(lastDays(byDay, 30))} />
              <StatBox label={t('stPerDay')} value={hh(perActiveDay(listenedSec, byDay))} />
              <StatBox label={t('stTracks')} value={plays.toLocaleString(loc)} />
              <StatBox label={t('stDays')} value={String(daysListened(byDay))} />
              <StatBox label={t('stStreak')} value={run > 0 ? `${run}` : '-'} />
            </div>

            {best && (
              <div className="mt-2">
                <StatBox label={`${t('stBest')} · ${new Date(best.day + 'T12:00').toLocaleDateString(loc, { day: 'numeric', month: 'short' })}`}
                  value={hh(best.sec)} />
              </div>
            )}

            {top.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/35 mb-1.5">{t('stTopArtists')}</p>
                <div className="space-y-1">
                  {top.map((a, i) => (
                    <div key={a.name} className="flex items-center gap-2.5">
                      <span className="text-[11px] text-white/25 tabular-nums w-3 shrink-0">{i + 1}</span>
                      <span className="text-[12px] text-white/80 truncate flex-1 min-w-0">{a.name}</span>
                      {/* A bar against the leader, so the shape is readable
                          without reading every number. */}
                      <span className="h-1 rounded-full shrink-0" style={{
                        width: `${Math.max(6, Math.round((a.sec / top[0].sec) * 56))}px`,
                        background: 'var(--accent)', opacity: 0.55,
                      }} />
                      <span className="text-[11px] text-white/35 tabular-nums shrink-0 w-16 text-right">{hh(a.sec)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quiet here, loud in the dialog. A full-width red bar at the
                foot of the section shouts at everybody who ever opens it,
                including the ones only reading their numbers; the warning
                belongs on the step where something actually happens. */}
            <div className="flex justify-end mt-3">
              <button
                onClick={async () => { if (await askConfirm(t('stResetAsk'), t('stReset'), true)) resetStats() }}
                className="icon-btn px-2.5 py-1 rounded-lg text-[11px] transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
              >
                {t('stReset')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Section>
  )
}

/* Not the Stat above: that one is the track-page counter and takes a
   number. This is a labelled tile for the listening figures. */
function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <p className="text-[13px] font-semibold text-white tabular-nums leading-none">{value}</p>
      <p className="text-[10.5px] text-white/35 mt-1 truncate">{label}</p>
    </div>
  )
}

/* `anchor` is the handle the settings search scrolls to and flashes. It is
   only on the sections somebody searches for by name; a section nobody would
   type does not need one. */
function Section({ title, children, anchor }: { title: string; children: React.ReactNode; anchor?: string }) {
  return (
    <div data-setting={anchor}>
      <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  )
}

// ── Flags (SVG - render identically across OSes, unlike emoji flags) ──────────

// Twemoji flag emojis (CC-BY 4.0) - the open emoji set commonly used to show
function FlagRU() { return <Flag code={FLAG_RU} alt="RU" /> }
function FlagUS() { return <Flag code={FLAG_US} alt="US" /> }
function FlagUA() { return <Flag code={FLAG_UA} alt="UA" /> }

/* A door into whatever is being worked on, from the user's side of it. The
   button shuts the settings window before it opens anything, because the
   point is to see the thing with nothing of ours on top of it. */

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
          <p className="text-lg font-semibold text-white tabular-nums">{current ? `v${norm(current)}` : '-'}</p>
          <p className="text-xs mt-0.5" style={{ color: hasUpdate ? 'var(--accent)' : 'rgba(255,255,255,0.45)' }}>
            {hasUpdate ? `${t('versionsAvailable')} · v${norm(latest!.tag)}` : t('versionsUpToDate')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => doCheck(true)}
            disabled={checking}
            className="icon-btn px-3 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white transition-all disabled:opacity-50 flex items-center gap-1.5"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            {checking && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {checking ? t('versionsChecking') : t('versionsCheck')}
          </button>
          {hasUpdate && (
            <button
              onClick={() => window.open(latest!.url)}
              className="icon-btn px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ background: 'var(--accent)' }}
            >
              {t('versionsUpdate')}
            </button>
          )}
        </div>
      </div>

      {/* Changelog - separated from the current-version card */}
      <div className="pt-3 border-t border-white/[0.045]">
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
                {r.body && <ReleaseNotes body={r.body} />}
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
