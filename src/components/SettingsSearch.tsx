/* The search box in the settings sidebar, and the list it produces.
 *
 * Two exports rather than one component, because the two halves live at
 * opposite ends of the panel: the field sits above the nav on the left, the
 * results take over the content pane on the right. The panel owns the query
 * and the cursor between them, so one keystroke in the field can move the
 * selection in a list that is not its descendant.
 */

import { useEffect, useRef } from 'react'
import { useSettings, useUI } from '../store'
import { useT, type TKey } from '../i18n'
import { highlight, type Hit, type Place } from '../services/settingsSearch'
import { IconUser, IconPalette, IconLyrics, IconSound, IconSystem, IconRemote, IconVersions, IconInfo } from './settingsIcons'

/* ── the field ─────────────────────────────────────────────────────────── */

export function SearchField({ value, onChange, onKey }: {
  value: string
  onChange: (v: string) => void
  onKey: (e: React.KeyboardEvent) => void
}) {
  const t = useT()
  const ref = useRef<HTMLInputElement>(null)

  /* Typing anywhere in the panel aims at this field. The panel is a window
     of its own with nothing else to type into, so a stray keystroke means
     "find something" far more often than it means nothing at all.
     Not while a confirmation is up, though: that dialog is drawn over this
     one and sometimes has a field of its own, and stealing the first letter
     somebody types into it would be the worst possible moment to do it. */
  const confirming = useUI(s => !!s.confirmAsk)
  useEffect(() => {
    if (confirming) return
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.key.length !== 1) return
      ref.current?.focus()
    }
    window.addEventListener('keydown', onDown)
    return () => { window.removeEventListener('keydown', onDown) }
  }, [confirming])

  return (
    <div className="set-find" data-on={value ? 'true' : 'false'}>
      <svg className="set-find-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKey}
        placeholder={t('findSetting')}
        spellCheck={false}
      />
      {/* Only while there is something to clear - an x that never does
          anything is just a second icon. */}
      {value && (
        <button className="set-find-x" onClick={() => { onChange(''); ref.current?.focus() }} title={t('close')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ── the results ───────────────────────────────────────────────────────── */

const ICONS: Record<string, () => JSX.Element> = {
  profile: IconUser, sound: IconSound, lyrics: IconLyrics, system: IconSystem,
  remote: IconRemote, versions: IconVersions, info: IconInfo,
}

function placeIcon(place: Place): JSX.Element {
  if (place.kind === 'edit') return <IconPalette />
  const Ic = ICONS[place.tab] ?? IconSystem
  return <Ic />
}

const TAB_NAME: Record<string, TKey> = {
  profile: 'catAccount', sound: 'catSound', lyrics: 'catLyrics', system: 'catSystem',
  remote: 'catRemote', versions: 'catVersions', info: 'catInfo',
}

/* What each result is set to right now.
 *
 * It lives here rather than in the index because it is the one part of a
 * result that is not a description of the player but a reading off it, and
 * the index is meant to stay a plain list that a new setting can be added
 * to without wiring anything. Only the entries where the current value is
 * the reason you went looking: a switch you cannot remember the state of,
 * a number you want to check. The rest show nothing, which is quieter than
 * showing "-" everywhere. */
function useValue(id: string, t: (k: TKey) => string): string | boolean | null {
  const s = useSettings()
  switch (id) {
    case 'tray':        return s.closeToTray
    case 'mediakeys':   return s.mediaKeys
    case 'radio':       return s.autoRadio
    case 'startup':     return s.launchAtStartup
    case 'drm':         return s.autoSkipDrm
    case 'datadome':    return s.datadomeBypass
    case 'discord':     return s.discordRpc
    case 'glow':        return s.iconGlow
    case 'rain':        return s.rain
    case 'transparent': return s.theme === 'transparent'
    case 'eq':          return s.eqEnabled
    case 'crossfade':   return s.crossfade > 0 ? `${s.crossfade} ${t('stSec')}` : t('seasonShortOff')
    case 'lang':        return s.lang === 'ru' ? 'Русский' : s.lang === 'uk' ? 'Українська' : 'English'
    case 'timing':      return s.timing === 'local' ? t('tmLocal') : s.timing === 'cloud' ? t('tmCloud') : t('tmOff')
    case 'sbwidth':     return s.sidebarWide ? t('sbWide') : t('sbNarrow')
    case 'layout':      return s.fsLayout === 'stack' ? t('fsStack') : s.fsLayout === 'split' ? t('fsSplit') : t('fsSide')
    case 'season':      return s.season === 'off' ? t('seasonShortOff') : s.season === 'auto' ? t('seasonShortAuto') : t('seasonShortOn')
    case 'bg':          return s.bgStyle === 'wallpaper' ? t('videoWallpapers')
                             : s.bgStyle === 'accent' ? t('bgAccent')
                             : s.bgStyle === 'aurora' ? t('bgAurora') : t('bgDynamic')
    default:            return null
  }
}

export function SearchResults({ hits, query, active, setActive, onPick }: {
  hits: Hit[]
  query: string
  active: number
  setActive: (i: number) => void
  onPick: (place: Place) => void
}) {
  const t = useT()

  /* Keep the keyboard cursor in view. The list is short enough that this
     almost never fires, but "almost never" is exactly when a selection
     disappearing off the bottom is most confusing. */
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-i="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!hits.length) {
    return (
      <div className="set-find-none page-enter">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <p>{t('findNothing')}</p>
        <span>{t('findNothingSub')}</span>
      </div>
    )
  }

  return (
    <div ref={listRef} className="set-res page-enter">
      {hits.map((h, i) => (
        <Row key={h.entry.id} hit={h} query={query} i={i} active={i === active}
          onHover={() => setActive(i)} onPick={() => onPick(h.entry.place)} t={t} />
      ))}
    </div>
  )
}

function Row({ hit, query, i, active, onHover, onPick, t }: {
  hit: Hit; query: string; i: number; active: boolean
  onHover: () => void; onPick: () => void; t: (k: TKey) => string
}) {
  const { entry } = hit
  const place = entry.place
  const value = useValue(entry.id, t)
  const label = t(entry.label)
  const where = place.kind === 'edit'
    ? t('findInEdit')
    : t(TAB_NAME[place.tab] ?? 'catSystem')
  /* "System · System" when a section is named after its own tab: the
     breadcrumb is there to say where, and saying it twice says less. */
  const section = entry.section ? t(entry.section) : ''
  const crumb = section && section !== where ? `${where} · ${section}` : where

  return (
    <button className="set-res-row" data-i={i} data-on={active ? 'true' : 'false'}
      onMouseEnter={onHover} onClick={onPick}>
      <span className="set-res-ic">{placeIcon(place)}</span>
      <span className="set-res-txt">
        <span className="set-res-lbl">
          {/* Even pieces are the plain text, odd ones are what was typed. */}
          {highlight(label, query).map((part, n) =>
            n % 2 ? <mark key={n}>{part}</mark> : <span key={n}>{part}</span>)}
        </span>
        <span className="set-res-crumb">{crumb}</span>
      </span>
      {/* A switch reads as a switch; anything else is a word. */}
      {typeof value === 'boolean'
        ? <span className="set-res-sw" data-on={value ? 'true' : 'false'}><i /></span>
        : value
        ? <span className="set-res-val">{value}</span>
        : place.kind === 'edit'
        ? <svg className="set-res-go" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        : null}
    </button>
  )
}
