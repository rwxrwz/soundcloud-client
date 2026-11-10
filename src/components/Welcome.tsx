import { useEffect, useState } from 'react'
import { useEscape, typingIn } from '../hooks/useEscape'
import {
  useSettings, useUI, useProfile, type Lang, type StartPage,
} from '../store'
import { useT } from '../i18n'
import { Toggle, Flag, FLAG_RU, FLAG_US, FLAG_UA } from './settingsControls'
import { DateSetting } from './DateSetting'
import { LyricsTimingSection } from './LyricsTimingSection'
import { pendingNews } from '../services/whatsNew'
import morph from '../assets/morph.webm'

/* First run.
 *
 * Three bands, fixed, so the thing never jumps as you move through it: the
 * greeting animates at the top, the question sits in the middle, the answer
 * is along the bottom. Only the middle band changes between slides, which is
 * what makes a sequence of them feel like one screen rather than four.
 *
 * Every slide has to earn its place, and that rule is what shaped these four:
 * each asks something the app cannot work out on its own. The accent colour
 * failed it - the palette button is two clicks away at any moment - so it is
 * a row of swatches among the switches instead of a step, and the step it
 * freed went to the start page, which decides what you see on every launch
 * and which nothing can guess.
 *
 * It is deliberately see-through: the player is already running behind it,
 * rain and all, and a colour picked against a mock-up of the player is a
 * colour picked against the wrong thing.
 *
 * The greeting is the baked morph - words melting into one another, rendered
 * offline once and shipped as a transparent VP9 loop rather than animated
 * live, because the gooey threshold it is built on costs a filter pass per
 * frame and this is the first thing the app ever shows. */

type Slide = 'hello' | 'start' | 'options' | 'lyrics' | 'date' | 'done'
const ORDER: Slide[] = ['hello', 'start', 'options', 'lyrics', 'date', 'done']

export function Welcome() {
  const t = useT()
  const s = useSettings()
  const { user, likes, playlists } = useProfile()
  const { setShowWelcome } = useUI()
  const [i, setI] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const slide = ORDER[i]

  const finish = () => {
    if (leaving) return
    setLeaving(true)
    s.setSeenWelcome(true)
    /* Stamped, not shown. Somebody meeting the player for the first time
       has just been walked through it; following that with a list of what
       changed in the only version they have ever run would be the same
       tour twice, the second time pretending to be news. Recording the
       version here is what keeps it from appearing on the next launch. */
    pendingNews('').then(found => {
      if (found) s.setLastSeenVersion(found.version)
    }).catch(() => { /* no bridge: the next launch will try again */ })
    setTimeout(() => setShowWelcome(false), 320)
  }
  const next = () => (i < ORDER.length - 1 ? setI(i + 1) : finish())

  /* Escape goes through the shared stack, which knows that a field owns
     the key: the date slide's only control is a date picker, and Escape
     there dismisses the picker. It used to end the first run instead -
     seenWelcome and lastSeenVersion are both persisted, so the remaining
     slides were gone for good. Enter is ours, with the same rule, and with
     a dependency list so it is not re-bound on every render. */
  useEscape(finish, !leaving)
  useEffect(() => {
    if (leaving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !typingIn(e)) next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, leaving])

  const PAGES: [StartPage, string][] = [
    ['main', t('home')], ['releases', t('releases')],
    ['likes', t('likes')], ['playlists', t('playlists')],
  ]
  const pulled = likes.length + playlists.length > 0
  /* Everything that came down, as one number. Three playlists says nothing
     on its own; the tracks inside them, plus the likes, is the size of the
     library - and that is the figure worth ending on. */
  const totalTracks = likes.length
    + playlists.reduce((n, p) => n + (p.track_count ?? p.tracks?.length ?? 0), 0)
  /* The same rule settings uses, deliberately: one setting with two
     different ideas of where it works is worse than the narrower one. Shown
     and disabled off Windows rather than hidden, so it does not look like
     this screen is missing something settings has. */
  const canAutostart = navigator.userAgent.includes('Windows')
  /* Linux needs the captcha bypass for writes - likes, playlist edits - to
     go through at all, and nothing on the screen would otherwise say so. It
     is offered rather than forced: it drives a hidden browser window when it
     fires, and that is the sort of thing to opt into knowingly. */
  const onLinux = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)

  return (
    <div className={`wc-layer ${leaving ? 'leaving' : ''}`}>
      <div className="wc-sheet">
        {/* ── the greeting, same height on every slide ── */}
        <div className="wc-hero">
          <video className="wc-morph" src={morph} autoPlay loop muted playsInline />
        </div>

        {/* ── the middle: the only part that changes ── */}
        <div className="wc-body" key={slide}>
          {slide === 'hello' && (
            <>
              {/* Signed in by the time this runs, so the first thing on screen
                  can be proof of that rather than a greeting to nobody. */}
              {user?.avatar_url && <img className="wc-ava" src={user.avatar_url} alt="" />}
              <h1 className="wc-title">{user ? `${t('wcHi')}, ${user.username}` : t('wcTitle')}</h1>
              <p className="wc-sub">{t('wcSub')}</p>
              <div className="wc-langs">
                {([['en', FLAG_US, 'ENG'], ['ru', FLAG_RU, 'RU'], ['uk', FLAG_UA, 'UKR']] as [Lang, string, string][]).map(([v, code, l]) => (
                  <button key={v} onClick={() => s.setLang(v)} className="wc-lang" data-on={s.lang === v}>
                    <Flag code={code} alt={l} size={30} />
                    <span>{l}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {slide === 'start' && (
            <>
              <h1 className="wc-title">{t('wcStartTitle')}</h1>
              <p className="wc-sub">{t('wcStartSub')}</p>
              <div className="wc-pages">
                {PAGES.map(([v, label]) => (
                  <button key={v} onClick={() => s.setStartPage(v)} className="wc-page" data-on={s.startPage === v}>
                    {label}
                  </button>
                ))}
              </div>
              {/* The other half of "where to start": whether the player is
                  there at all when the machine comes up. */}
              <div className="wc-opts wc-opts-tight">
                <div className="wc-opt">
                  <span className="wc-opt-label">
                    {t('launchAtStartup')}
                    {!canAutostart && <span className="wc-note">{t('launchAtStartupWin')}</span>}
                  </span>
                  <Toggle active={canAutostart && s.launchAtStartup} disabled={!canAutostart}
                    onClick={() => { const v = !s.launchAtStartup; s.setLaunchAtStartup(v); window.electronAPI?.setLoginItem?.(v) }} />
                </div>
              </div>
            </>
          )}

          {slide === 'options' && (
            <>
              <h1 className="wc-title">{t('wcOptionsTitle')}</h1>
              <p className="wc-sub">{t('wcOptionsSub')}</p>
              <div className="wc-opts">
                <Opt label={t('autoSkipDrm')} on={s.autoSkipDrm} set={s.setAutoSkipDrm} />
                {onLinux && (
                  <Opt label={t('datadomeBypass')} note={t('wcDatadomeLinux')} on={s.datadomeBypass}
                    set={v => { s.setDatadomeBypass(v); window.electronAPI?.setDatadomeBypass?.(v) }} />
                )}
                {/* Pushed to the main process as well as the store, or the
                    switch would be a setting the window never hears about. */}
                <Opt label={t('closeToTray')} on={s.closeToTray}
                  set={v => { s.setCloseToTray(v); window.electronAPI?.setCloseToTray?.(v) }} />
                {/* Broadcasts what is playing to everyone who can see the
                    profile, so it is asked rather than assumed. What it
                    actually is gets explained on its own slide later. */}
                <Opt label={t('discordRpc')} badge={t('wcNew')} note={t('discordRpcNote')}
                  on={s.discordRpc}
                  set={v => { s.setDiscordRpc(v); window.electronAPI?.setDiscordRpc?.(v) }} />
              </div>
            </>
          )}

          {slide === 'lyrics' && (
            <>
              <h1 className="wc-title">{t('tmTitle')}</h1>
              <p className="wc-sub">{t('wcLyricsSub')}</p>
              {/* The settings section itself, not a copy of it: the model
                  can be downloaded from here, and whoever does that must
                  not find a second button in settings that disagrees
                  about whether it is installed. */}
              <div className="wc-lyrics">
                <LyricsTimingSection bare />
              </div>
            </>
          )}

          {slide === 'date' && (
            <>
              {/* Straight after the switches, one of which was Christmas
                  mode: the thing it depends on, while it is still fresh. */}
              <h1 className="wc-title">{t('dateTitle')}</h1>
              <p className="wc-sub">{t('dateSub')}</p>
              <DateSetting />
            </>
          )}

          {slide === 'done' && (
            <>
              <h1 className="wc-title">{t('wcDoneTitle')}</h1>
              {/* The sync has been running under all of this. Saying what it
                  found turns the wait into the first proof the account works,
                  before a single track has played. */}
              <p className="wc-sub wc-haul">
                {pulled
                  ? `${t('likes')} ${likes.length} · ${t('playlists')} ${playlists.length} · ${t('wcTotalTracks')} ${totalTracks}`
                  : t('wcPulling')}
              </p>
              <p className="wc-sub">{t('wcDoneSub')}</p>

            </>
          )}
        </div>

        {/* ── the answer ──
            Back where back belongs, at the head of the line, and forward at
            the end of it. There is no Skip: every slide is already skippable,
            because Next changes nothing on its own - and Esc drops the whole
            thing for anyone who wants out now rather than in three clicks. */}
        <div className="wc-foot">
          <div className="wc-foot-l">
            {i > 0 && <button className="wc-back" onClick={() => setI(i - 1)}>{t('wcBack')}</button>}
          </div>
          <div className="wc-dots">
            {ORDER.map((_, k) => <span key={k} className="wc-dot" data-on={k === i} />)}
          </div>
          <div className="wc-foot-r">
            <button className="wc-next" onClick={next}>
              {i === ORDER.length - 1 ? t('wcStart') : t('wcNext')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Opt({ label, on, set, badge, note }: {
  label: string; on: boolean; set: (v: boolean) => void; badge?: string; note?: string
}) {
  return (
    <div className="wc-opt">
      <span className="wc-opt-label">
        {label}
        {badge && <span className="wc-badge">{badge}</span>}
        {note && <span className="wc-note">{note}</span>}
      </span>
      <Toggle active={on} onClick={() => set(!on)} />
    </div>
  )
}
