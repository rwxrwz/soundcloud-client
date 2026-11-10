/* What the player can do, one thing per slide.
 *
 * The counterpart to the first run, and deliberately the opposite of it:
 * that one asks questions, this one shows what is here. Same glass, same
 * footer, so arriving at it after the questions reads as the same screen
 * carrying on rather than a second thing interrupting.
 *
 * It is a deck rather than one long card because the slides carry real
 * controls now - the whole timing section with its model download, the
 * Discord switch, the theme grid - and those do not stack into something
 * anybody would scroll through.
 *
 * The names across the top are the table of contents: where you are, what
 * came before, what is next. They answer "how much more of this is there"
 * without a word, which is the question a tour like this always raises.
 *
 * There is no Escape. Every other window in the player lets go; this one
 * is four slides long and is the only time the features are ever put in
 * front of anybody, so it is walked through.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { typingIn } from '../hooks/useEscape'
import { useSettings, useUI } from '../store'
import { useT } from '../i18n'
import { EditModeSketch } from './EditModeSketch'
import { LyricsTimingSection } from './LyricsTimingSection'
import { ThemeGrid } from './ThemesSection'
import { RemoteSection } from './RemoteSection'
import { Toggle } from './settingsControls'
import type { NewsItem } from '../services/whatsNew'

const OUT_MS = 300

export function WhatsNew({ items, version }: { items: NewsItem[]; version: string }) {
  const t = useT()
  const setShowNews = useUI(s => s.setShowNews)
  const setEditMode = useUI(s => s.setEditMode)
  const editMode = useUI(s => s.editMode)
  const setLastSeenVersion = useSettings(s => s.setLastSeenVersion)
  const [i, setI] = useState(0)
  const [leaving, setLeaving] = useState(false)
  /* Stepped aside for a preview rather than closed. The deck stays mounted
     with everything it holds, so coming back lands on the same slide
     instead of starting the tour again. */
  const [hidden, setHidden] = useState(false)

  const slide = items[i]
  const last = i === items.length - 1

  /* The strip is laid out once at one size and the active name is scaled
     up, never resized. Resizing moves every name beside it, which means
     the offset this measures is already stale by the time it is applied -
     the whole strip jittered half a character on every step. */
  const stripRef = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = stripRef.current?.children[i] as HTMLElement | undefined
    if (el) setShift(-(el.offsetLeft + el.offsetWidth / 2))
  }, [i, items.length])

  // Back from a preview: the window is ours again.
  useEffect(() => {
    if (hidden && !editMode) setHidden(false)
  }, [editMode, hidden])

  const finish = () => {
    if (leaving) return
    setLeaving(true)
    setLastSeenVersion(version)
    setTimeout(() => { setShowNews(false); useUI.getState().setNews(null) }, OUT_MS)
  }
  const next = () => (last ? finish() : setI(i + 1))

  /* Enter steps forward, and nothing else is bound. No Escape on purpose.
     Two things it must not do. It must not fire while the deck is hidden
     behind the editing-mode preview - it is only display:none, so the
     listener outlived the window and four Enters in the hex field stamped
     the version and destroyed the deck with four slides unread. And it
     must not fire from inside the fields the later slides carry, where
     Enter already means "save this token". */
  useEffect(() => {
    if (hidden || leaving) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !typingIn(e)) next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, last, hidden, leaving])

  if (!items.length) return null

  return (
    <div className={`wc-layer ${leaving ? 'leaving' : ''}`} style={hidden ? { display: 'none' } : undefined}>
      <div className="wc-sheet nw-sheet">
        {/* The same line either way. It used to read "what the player can do"
            for somebody arriving from the welcome screen, on the grounds
            that nothing is new to them - but that traded the build number,
            which is worth having in both cases, for a distinction nobody
            asked to be drawn. */}
        <span className="nw-ver">{t('nwTitle')} · {version}</span>

        {/* ── where you are, and what is on either side ── */}
        <div className="nw-strip-win">
          <div className="nw-strip" ref={stripRef} style={{ transform: `translate(${shift}px, -50%)` }}>
            {items.map((n, k) => (
              <span key={n.name} className="nw-name" data-on={k === i} data-near={Math.abs(k - i) <= 1}>
                {t(n.name)}
              </span>
            ))}
          </div>
        </div>

        <div className="nw-body" key={i}>
          <p className="nw-p">{t(slide.body)}</p>

          {slide.art === 'editmode' && (
            <EditModeSketch
              badge
              onTry={slide.preview === 'editmode'
                ? () => { setHidden(true); setEditMode(true) }
                : undefined}
            />
          )}

          {slide.control === 'lyrics' && <div className="nw-ctl nw-ctl-wide"><LyricsTimingSection bare /></div>}
          {slide.control === 'switches' && <div className="nw-ctl"><SwitchRows /></div>}
          {slide.control === 'themes' && <div className="nw-ctl nw-ctl-wide"><ThemeGrid compact /></div>}
          {slide.control === 'remote' && <div className="nw-ctl nw-ctl-wide"><RemoteSection /></div>}
        </div>

        <div className="wc-foot">
          <div className="wc-foot-l">
            {i > 0 && <button className="wc-back" onClick={() => setI(i - 1)}>{t('wcBack')}</button>}
          </div>
          <div className="wc-dots">
            {items.map((n, k) => <span key={n.name} className="wc-dot" data-on={k === i} />)}
          </div>
          <div className="wc-foot-r">
            <button className="wc-next" onClick={next}>{last ? t('nwGo') : t('wcNext')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* The same switches as in settings, wired the same way. Discord takes two
   calls - the store so it survives a restart, the main process because
   that is where the socket actually lives - and the radio only needs the
   store, since the hook that reads it lives in the window. */
function SwitchRows() {
  const t = useT()
  const discord = useSettings(s => s.discordRpc)
  const setDiscord = useSettings(s => s.setDiscordRpc)
  const radio = useSettings(s => s.autoRadio)
  const setRadio = useSettings(s => s.setAutoRadio)
  return (
    <div className="wc-opts" style={{ marginTop: 0 }}>
      <div className="wc-opt">
        <span className="wc-opt-label">{t('discordRpc')}</span>
        <Toggle active={discord} onClick={() => { setDiscord(!discord); window.electronAPI?.setDiscordRpc?.(!discord) }} />
      </div>
      <div className="wc-opt">
        <span className="wc-opt-label">{t('autoRadio')}</span>
        <Toggle active={radio} onClick={() => setRadio(!radio)} />
      </div>
    </div>
  )
}
