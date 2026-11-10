import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { net, type ListItem, type ListPage, type Lyrics, type PlayerState } from './net'
/* The desktop's own component, imported rather than copied. It depends on
   nothing but React and two class names, both of which this sheet defines,
   so a long title behaves here exactly as it does in the player. */
import { Marquee } from '../../src/components/Marquee'

const PAGE = 40

function useNet(): { state: PlayerState; link: ReturnType<typeof linkOf> } {
  const state = useSyncExternalStore(net.subscribe, () => net.state)
  const link = useSyncExternalStore(net.subscribe, () => net.link)
  return { state, link }
}
const linkOf = () => net.link

/* "130 треков · 4ч 48м" - the same two facts the playlist header shows in
   the player, in the same order. */
function tracksWord(n: number): string {
  const ten = n % 10, hundred = n % 100
  if (ten === 1 && hundred !== 11) return 'трек'
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'трека'
  return 'треков'
}

function hoursMins(sec: number): string {
  const mins = Math.round(sec / 60)
  const h = Math.floor(mins / 60)
  return h ? `${h}ч ${mins % 60}м` : `${mins}м`
}

const mmss = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/** The bridge hands out a 200px thumbnail; on a phone the artwork is most of
 *  the screen. The CDN serves the same image at 500 under a predictable name. */
const bigArt = (u: string | null): string | null => (u ? u.replace(/-t\d+x\d+\./, '-t500x500.') : null)

function rgbOf(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/* ── a draggable rail, used for both the playhead and the volume ───────── */

function Rail({ value, max, onCommit, hold, under, right, className = '' }: {
  value: number
  max: number
  onCommit: (v: number) => void
  hold: (on: boolean) => void
  /** Extra class on the rail itself, for surfaces that want it thinner. */
  className?: string
  /** Rendered under the rail, from the value the finger is on. */
  under?: (v: number) => React.ReactNode
  /** Rendered beside it, same value. */
  right?: (v: number) => React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  /* The dragged value lives here and nowhere else.
     It used to be pushed into the shared store on every pointermove, which
     meant the whole screen - artwork, its shadow, the controls, the lists -
     re-rendered at the rate a finger moves. On a phone webview that is what
     "the sliders are jerky" was. Nothing outside this component needs to
     know where the finger is until it lifts. */
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const pct = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0

  const at = (x: number): number => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width === 0) return shown
    return Math.min(max, Math.max(0, ((x - r.left) / r.width) * max))
  }

  /* Pointer events rather than touch: the same code then works when this is
     opened on Telegram Desktop, where it is a mouse. setPointerCapture keeps
     the drag alive when the finger slides off the rail, which on a thin
     control is most drags. */
  const down = (e: React.PointerEvent) => {
    ref.current?.setPointerCapture(e.pointerId)
    hold(true)
    setDrag(at(e.clientX))
  }
  const move = (e: React.PointerEvent) => { if (drag !== null) setDrag(at(e.clientX)) }
  const up = (e: React.PointerEvent) => {
    if (drag === null) { hold(false); return }
    const v = at(e.clientX)
    setDrag(null)
    hold(false)
    onCommit(v)
  }

  /* The hold is on a module-level singleton, so it outlives this component.
     A drag interrupted by the socket dropping unmounts the whole player
     subtree without a pointerup, and the hold then stayed on for the rest
     of the session: every progress tick was skipped and every snapshot
     re-pinned the playhead to where the finger had been. */
  useEffect(() => () => { hold(false) }, [hold])

  const rail = (
    <div ref={ref} className={`rail ${className}`} data-held={drag !== null ? 'true' : 'false'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="bed"><div className="fill" style={{ width: `${pct}%` }} /></div>
      <div className="knob" style={{ left: `${pct}%` }} />
    </div>
  )

  if (right) return <>{rail}{right(shown)}</>
  return <>{rail}{under?.(shown)}</>
}

/* The words, shown in the square the cover came out of.
 *
 * Timed lines get the one being sung lit and kept in the middle; untimed
 * ones are just text to read. The scroll is done by arithmetic rather than
 * scrollIntoView, which on a nested scroller likes to move the page as
 * well as the box. */
function Words({ lyr, pos }: { lyr: Lyrics; pos: number }) {
  const box = useRef<HTMLDivElement>(null)
  const lines = lyr.synced
  const active = lines
    ? lines.reduce((acc, l, i) => (l.time <= pos + 0.25 ? i : acc), -1)
    : -1

  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)
    if (!el || !box.current) return
    /* Measured off the rectangles rather than off offsetTop.
       offsetTop is counted from the nearest positioned ancestor, and that
       was not this box but the screen behind it - so the hint, the padding
       and a gap were all being added in, and the sung line settled about
       forty pixels above the middle. Rects do not care who the parent is. */
    const b = box.current.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    box.current.scrollTop += (r.top + r.height / 2) - (b.top + b.height / 2)
  }, [active])

  return (
    <div ref={box} className="words">
      {/* Half a box of nothing at each end, so the first and last lines can
          reach the middle too. Only with timings: without them nobody is
          centring anything and the page would just start blank. */}
      {lines && <div className="pad" />}
      {/* Said out loud, because static text under a playing song looks
          exactly like synchronisation that has broken. It has not: these
          words arrived without a single timecode. */}
      {!lines && <p className="note">без таймкодов, подсветки не будет</p>}
      {lines
        ? lines.map((l, i) => {
            /* Attention falls off with distance instead of switching on and
               off. Before the first line is due, everything sits at the
               near-neighbour level rather than fading to almost nothing. */
            const d = active < 0 ? 1 : Math.abs(i - active)
            return (
              <p key={i} data-i={i} data-on={i === active ? 'true' : 'false'}
                style={{ opacity: d === 0 ? 1 : d === 1 ? 0.55 : d === 2 ? 0.34 : 0.2 }}>
                {l.text}
              </p>
            )
          })
        : (lyr.plain ?? '').split('\n').map((l, i) => <p key={i} className="flat">{l || '\u00a0'}</p>)}
      {lyr.ai && <p className="note">расставлено моделью</p>}
      {lines && <div className="pad" />}
    </div>
  )
}

/* ── now playing ───────────────────────────────────────────────────────── */

function Now({ state }: { state: PlayerState }) {
  const t = state.track
  const art = bigArt(t?.artworkUrl ?? null)
  const dur = t?.duration || 1
  /* A cover that 404s or that the phone cannot reach must fall back to the
     placeholder rather than to the browser's broken-image glyph. Keyed on
     the url so the next track gets a fresh chance. */
  const [broken, setBroken] = useState<string | null>(null)
  const ok = art && broken !== art

  /* Carry the playhead forward between the player's ticks.
     The player reports a position once a second. Across a bar this wide
     that is a visible hop, and the bar read as stuttering rather than
     running. Four frames a second of arithmetic is enough to look like
     motion and costs nothing. */
  const [, tick] = useState(0)
  useEffect(() => {
    if (!state.playing) return
    const id = window.setInterval(() => tick(n => n + 1), 250)
    return () => window.clearInterval(id)
  }, [state.playing])
  const shownPos = state.playing ? Math.min(dur, state.position + (Date.now() - net.at) / 1000) : state.position

  /* Skipping goes phone -> tunnel -> player and back, and until this was
     here the screen did nothing at all while it travelled. The obvious
     reading was that the tap had missed, so people tapped again - and
     then two skips landed. The wait is now visible, which makes the
     second tap a decision rather than a guess.
     Cleared by the track actually changing, or by giving up on it. */
  const [waiting, setWaiting] = useState(false)
  useEffect(() => { setWaiting(false) }, [t?.id])
  useEffect(() => {
    if (!waiting) return
    const id = window.setTimeout(() => setWaiting(false), 4000)
    return () => window.clearTimeout(id)
  }, [waiting])
  const skip = (dir: 'next' | 'prev') => { setWaiting(true); net.send(dir) }

  /* Both of these are "set to this", not "toggle".
     The player's command handler takes a value and ignores anything
     without one, so sending a bare `shuffle` did nothing at all - the
     button lit up on the phone and the player never heard about it. The
     next value is worked out here, where the current one is known, and
     the screen moves at once rather than after a round trip.
     The repeat order is the player's own: off, all, one. */
  const flipShuffle = () => {
    const v = !state.shuffle
    net.nudge({ shuffle: v })
    net.send('shuffle', v)
  }
  const cycleRepeat = () => {
    const v = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'
    net.nudge({ repeat: v })
    net.send('repeat', v)
  }

  /* The words for whatever is playing, asked for once per track. Asked
     even when nobody taps, because whether they exist is what decides
     if the hint above the cover is there to tap at all. */
  const [lyr, setLyr] = useState<Lyrics | null>(null)
  const [words, setWords] = useState(false)
  useEffect(() => {
    setLyr(null)
    setWords(false)
    if (!t?.id) return
    let alive = true
    void net.lyrics(t.id).then(l => { if (alive) setLyr(l) })
    return () => { alive = false }
  }, [t?.id])
  const hasWords = !!(lyr?.synced?.length || lyr?.plain)

  return (
    <div className="now" data-waiting={waiting ? 'true' : 'false'}>
      {/* Reserved whether or not it says anything, so the cover does not
          jump down the screen when the words finish loading. */}
      <div className="hint" data-on={hasWords ? 'true' : 'false'}>
        {words ? 'нажми для обложки' : 'нажми для текста'}
      </div>

      <div className="art" data-idle={state.playing ? 'false' : 'true'} data-words={words ? 'true' : 'false'}
        onClick={() => { if (hasWords) { setWords(w => !w); window.Telegram?.WebApp?.HapticFeedback?.selectionChanged?.() } }}>
        {words && lyr
          ? <Words lyr={lyr} pos={shownPos} />
          : ok
          ? <img key={art} src={art} alt="" onError={() => setBroken(art)} />
          : <div className="none">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>}
      </div>

      <div className="meta">
        <Marquee className="t">{t?.title || 'Ничего не играет'}</Marquee>
        <div className="a">{t?.artist || ' '}</div>
      </div>

      <div className="track">
        {/* The clock is rendered by the rail from the value under the
            finger, so scrubbing updates the time without telling the rest
            of the screen anything. */}
        <Rail
          value={shownPos} max={dur}
          hold={on => net.hold('position', on)}
          onCommit={v => { net.nudge({ position: v }); net.send('seek', Math.round(v)) }}
          under={v => <div className="times"><span>{mmss(v)}</span><span>{mmss(t?.duration ?? 0)}</span></div>}
        />
      </div>

      <div className="ctrls">
        <button data-on={state.shuffle ? 'true' : 'false'} onClick={flipShuffle} aria-label="Перемешать">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
        </button>
        <button onClick={() => skip('prev')} aria-label="Назад">
          <svg width="27" height="27" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
        </button>
        <button className="play" onClick={() => { net.nudge({ playing: !state.playing }); net.send('toggle') }}
          aria-label={state.playing ? 'Пауза' : 'Играть'}>
          {state.playing
            ? <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            : <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}><path d="M8 5v14l11-7z" /></svg>}
        </button>
        <button onClick={() => skip('next')} aria-label="Вперёд">
          <svg width="27" height="27" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
        </button>
        <button data-on={state.repeat !== 'off' ? 'true' : 'false'} onClick={cycleRepeat} aria-label="Повтор">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
            {state.repeat === 'one' && <text x="12" y="15.5" fontSize="9" fill="currentColor" stroke="none" textAnchor="middle">1</text>}
          </svg>
        </button>
      </div>

      <div className="vol">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" style={{ flex: 'none' }}>
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        </svg>
        <Rail
          value={state.volume} max={1}
          hold={on => net.hold('volume', on)}
          onCommit={v => { net.nudge({ volume: v }); net.send('volume', Math.round(v * 100) / 100) }}
          right={v => <span className="pct">{Math.round(v * 100)}%</span>}
        />
      </div>

    </div>
  )
}

/* The player, reduced to what still matters while you are looking at a
 * list. Opening the library used to hand the whole screen over and take
 * the controls away with it - so pausing meant closing what you came to
 * browse. This is the same four things the bottom bar of the desktop keeps:
 * where you are in the track, what it is, and the three buttons.
 */
function MiniBar({ state }: { state: PlayerState }) {
  const t = state.track
  const dur = t?.duration || 1

  // Same carried-forward playhead as the main screen, same reason.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!state.playing) return
    const id = window.setInterval(() => tick(n => n + 1), 400)
    return () => window.clearInterval(id)
  }, [state.playing])
  const pos = state.playing ? Math.min(dur, state.position + (Date.now() - net.at) / 1000) : state.position

  if (!t) return null
  return (
    <div className="minibar">
      {/* The hairline along the top edge is also the playhead. Two pixels
          is nothing to aim at, so the rail that carries it is eighteen -
          the rest is invisible and sits over the top of the bar, where
          there is nothing else to hit. */}
      <Rail
        className="mb-rail" value={pos} max={dur}
        hold={on => net.hold('position', on)}
        onCommit={v => { net.nudge({ position: v }); net.send('seek', Math.round(v)) }}
      />
      <div className="mb-row">
        <span className="mb-txt">
          <Marquee className="t">{t.title}</Marquee>
          <span className="a">{t.artist}</span>
        </span>
        <button onClick={() => net.send('prev')} aria-label="Назад">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
        </button>
        <button className="mb-play" onClick={() => { net.nudge({ playing: !state.playing }); net.send('toggle') }}
          aria-label={state.playing ? 'Пауза' : 'Играть'}>
          {state.playing
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}><path d="M8 5v14l11-7z" /></svg>}
        </button>
        <button onClick={() => net.send('next')} aria-label="Вперёд">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
        </button>
      </div>
    </div>
  )
}

/* The queue, as a sheet that stops short of the top.
 *
 * The gap is not decoration: it is the way out. A sheet that covers
 * everything has to grow a close button, and on a phone the reliable place
 * for one is exactly where the thumb is not. Leaving the screen behind it
 * visible says "this is on top of something" and gives that something back
 * with one tap anywhere along it.
 *
 * The queue itself needs no asking for - it rides in every snapshot the
 * player sends, so this opens with the list already in it. */
function Queue({ state, onClose, closing }: { state: PlayerState; onClose: () => void; closing: boolean }) {
  const rows = useRef<HTMLDivElement>(null)

  /* Open on the track that is playing rather than at the top: a hundred
     rows in, the top is the least useful place to land. A third of the way
     down, so what comes next is on screen too. */
  useEffect(() => {
    const el = rows.current?.querySelector<HTMLElement>('[data-on="true"]')
    if (el && rows.current) rows.current.scrollTop = el.offsetTop - rows.current.clientHeight / 3
  }, [])

  useEffect(() => {
    const b = window.Telegram?.WebApp?.BackButton
    if (!b) return
    b.onClick(onClose); b.show()
    return () => { b.offClick(onClose); b.hide() }
  }, [onClose])

  return (
    <>
      <div className="qgap" data-closing={closing ? 'true' : 'false'} onClick={onClose} />
      <div className="qsheet" data-closing={closing ? 'true' : 'false'}>
        <div className="qhead">
          <span className="grab" />
          <div className="qtitle">
            <span>Очередь</span>
            <span className="n">{state.queue.length}</span>
          </div>
        </div>
        <div ref={rows} className="rows">
          {state.queue.map((t, i) => (
            <button key={`${t.id}-${i}`} className="row" data-on={i === state.queueIndex ? 'true' : 'false'}
              onClick={() => { net.send('playQueueIndex', i); onClose() }}>
              <span className="cov">
                {t.artworkUrl
                  ? <img src={t.artworkUrl} alt="" loading="lazy" decoding="async" />
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" opacity="0.25">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>}
              </span>
              <span className="txt">
                <span className="t">{t.lyr && <i className="lb">L</i>}{t.title}</span>
                <span className="a">{t.artist}</span>
              </span>
            </button>
          ))}
          {!state.queue.length && <div className="empty">Очередь пуста</div>}
        </div>
        <MiniBar state={state} />
      </div>
    </>
  )
}

/* ── library ───────────────────────────────────────────────────────────── */

type Tab = 'likes' | 'playlists' | 'search'

/* Where the library was when it was last closed.
 *
 * Outside the component on purpose: closing the sheet unmounts it, and
 * useState dies with it - so a search you had typed, the playlist you were
 * inside and how far you had scrolled were all thrown away the moment you
 * went back to the player. This survives that, including the last page of
 * results, so reopening puts the same screen back instead of reloading it
 * in front of you. The list is still refetched behind it; it just is not
 * the first thing you see. */
const was = {
  tab: 'likes' as Tab,
  q: '',
  scope: 'mine' as 'mine' | 'all',
  inside: null as { id: string; title: string } | null,
  plq: '',
  order: 'newest' as 'newest' | 'oldest',
  page: { items: [], total: 0, key: '' } as ListPage & { key: string },
  /* Tied to the key of what was on screen, so a remembered offset is never
     applied to a different list. */
  scrollKey: '',
  scroll: 0,
}

function Library({ state, onClose, closing }: { state: PlayerState; onClose: () => void; closing: boolean }) {
  const [tab, setTab] = useState<Tab>(was.tab)
  const [q, setQ] = useState(was.q)
  /* Where the search looks. 'mine' reads what the player already holds;
     'all' goes out to SoundCloud. Tracks only out there, which is what was
     asked for and also the only thing this screen knows how to play. */
  const [scope, setScope] = useState<'mine' | 'all'>(was.scope)
  /* Set when a playlist is opened, which turns this list into that playlist's
     tracks. Kept out of `tab` so closing it returns to where you were. */
  const [inside, setInside] = useState<{ id: string; title: string } | null>(was.inside)
  /* Searching and ordering inside one playlist. The filter is per playlist
     and resets when you step into another; the order is a preference and
     carries. 'newest' to start, which is what the player defaults to. */
  const [plq, setPlq] = useState(was.plq)
  const [order, setOrder] = useState<'newest' | 'oldest'>(was.order)
  /* Clears when you step into a DIFFERENT playlist - not on mount, which
     is what a bare effect would do and which would wipe the very filter
     this is meant to bring back. */
  const lastInside = useRef(inside?.id)
  useEffect(() => {
    if (lastInside.current === inside?.id) return
    lastInside.current = inside?.id
    setPlq('')
  }, [inside?.id])
  /* The page carries the key of the thing it is a page OF.
     Switching tabs used to empty the list on the spot, so the screen went
     blank, said "loading", and then filled again - three states for one
     tap. Now the old rows stay until the new ones arrive, and the key is
     what tells the list it is looking at something else. */
  const [page, setPage] = useState<ListPage & { key: string }>(was.page)
  const [busy, setBusy] = useState(true)

  // Written back after every render; cheaper than remembering to do it in
  // each of eight setters, and impossible to forget one.
  useEffect(() => {
    was.tab = tab; was.q = q; was.scope = scope
    was.inside = inside; was.plq = plq; was.order = order; was.page = page
  })

  /* Puts the scroll back where it was, once the list it belongs to is the
     one on screen. */
  const rowsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (rowsRef.current && was.scrollKey === page.key) rowsRef.current.scrollTop = was.scroll
  }, [page.key])

  /* Which request this is. A slow answer for a tab you have already left
     would otherwise arrive and overwrite the one you are looking at. */
  const run = useRef(0)

  const query = useMemo(() => {
    if (inside) return { kind: 'playlist' as const, playlistId: inside.id, query: plq.trim(), sort: order }
    if (tab === 'search') return { kind: (scope === 'all' ? 'global' : 'search') as 'global' | 'search', query: q.trim() }
    return { kind: tab === 'likes' ? 'likes' as const : 'playlists' as const }
  }, [tab, q, inside, plq, order, scope])

  const key = `${query.kind}:${(query as { playlistId?: string }).playlistId ?? ''}:${(query as { query?: string }).query ?? ''}:${(query as { sort?: string }).sort ?? ''}`

  const load = useCallback((offset: number) => {
    const mine = ++run.current
    setBusy(true)
    void net.list({ ...query, offset, limit: PAGE }).then(got => {
      if (mine !== run.current) return
      setBusy(false)
      setPage(prev => (offset === 0
        ? { ...got, key }
        : { ...got, key, items: [...prev.items, ...got.items] }))
    })
  }, [query, key])

  useEffect(() => {
    if ((query.kind === 'search' || query.kind === 'global') && !query.query) {
      setPage({ items: [], total: 0, key })
      setBusy(false)
      return
    }
    /* Typing waits a beat so a word is one request, not six. Both kinds of
       search, since a playlist filter is typed just as fast as any other.
       Changing the order is a tap and goes straight through. */
    // A little longer for the one that leaves the house.
    const wait = (query as { query?: string }).query ? (query.kind === 'global' ? 450 : 350) : 0
    const id = window.setTimeout(() => load(0), wait)
    return () => window.clearTimeout(id)
  }, [load, query, key])

  /* Telegram's own back arrow, so leaving a playlist feels native rather
     than like a button somebody drew. */
  useEffect(() => {
    const b = window.Telegram?.WebApp?.BackButton
    if (!b) return
    const back = () => { if (inside) setInside(null); else onClose() }
    b.onClick(back); b.show()
    return () => { b.offClick(back); b.hide() }
  }, [inside, onClose])

  const open = (it: ListItem) => {
    if (!inside && tab === 'playlists') { setInside({ id: it.id, title: it.title }); return }
    net.send('playTrackId', it.id)
  }

  const title = inside?.title ?? page.title
  const done = page.items.length >= page.total
  /* Playlist ids and track ids are different namespaces that happen to look
     alike, so "this is the one playing" has to be asked only of rows that
     are tracks - otherwise playlist 1 lit up because track 1 was playing. */
  const tracks = !!inside || tab !== 'playlists'

  return (
    <div className="sheet" data-closing={closing ? 'true' : 'false'}>
      <div className="bar">
        <button className="pill" onClick={() => (inside ? setInside(null) : onClose())}>‹ Назад</button>
        <span className="who" style={{ textAlign: 'right' }}>{title ?? ''}</span>
      </div>

      {/* The playlist's own controls, in the drawer the tabs leave behind. */}
      <div className="fold" data-open={inside ? 'true' : 'false'}>
        <div>
          <div className="plbar">
            <input className="plfind" value={plq} onChange={e => setPlq(e.target.value)}
              placeholder="Поиск в плейлисте" disabled={!inside}
              autoCorrect="off" autoCapitalize="none" spellCheck={false} />
            <button className="plsort" onClick={() => setOrder(o => (o === 'newest' ? 'oldest' : 'newest'))}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: order === 'oldest' ? 'scaleY(-1)' : 'none', transition: 'transform 0.22s ease' }}>
                <path d="M12 5v14M6 11l6-6 6 6" />
              </svg>
              {order === 'newest' ? 'Новые' : 'Старые'}
            </button>
          </div>
        </div>
      </div>

      {/* Folded rather than removed. Stepping into a playlist used to make
          the tabs vanish between two frames and everything below jump up to
          fill the hole; now the row closes like a drawer and the list
          follows it. Same for the search field appearing. */}
      <div className="fold" data-open={!inside ? 'true' : 'false'}>
        <div>
          <div className="tabs">
            {([['likes', 'Лайки'], ['playlists', 'Плейлисты'], ['search', 'Поиск']] as const).map(([id, label]) => (
              <button key={id} data-on={tab === id ? 'true' : 'false'} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="fold" data-open={tab === 'search' ? 'true' : 'false'}>
            <div>
              <div className="find">
                <input value={q} onChange={e => setQ(e.target.value)}
                  placeholder={scope === 'all' ? 'Треки на SoundCloud' : 'По лайкам и плейлистам'}
                  disabled={tab !== 'search'} autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                <div className="scope">
                  {([['mine', 'В моей музыке'], ['all', 'Везде']] as const).map(([id, label]) => (
                    <button key={id} data-on={scope === id ? 'true' : 'false'} onClick={() => setScope(id)}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Keyed on what it is showing, so a new list arrives as a new element
          and fades in as one piece. One animated box rather than forty: the
          rows could each slide in on their own, and on a phone webview that
          is forty composited layers for a third of a second. */}
      {page.items.length > 0 ? (
        <div key={page.key} ref={rowsRef} className="rows" data-busy={busy ? 'true' : 'false'}
          onScroll={e => { was.scrollKey = page.key; was.scroll = (e.target as HTMLDivElement).scrollTop }}>
          {page.items.map((it, i) => (
            <button key={`${it.id}-${i}`} className="row" data-on={tracks && state.track?.id === it.id ? 'true' : 'false'}
              onClick={() => open(it)}>
              {/* The cover takes the place the index used to have. A row is
                  easier to find by its artwork than by its number, and the
                  number told you nothing a list cannot already show. */}
              <span className="cov">
                {it.art
                  ? <img src={it.art} alt="" loading="lazy" decoding="async" />
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" opacity="0.25">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                    </svg>}
              </span>
              <span className="txt">
                <span className="t">{it.title}</span>
                <span className="a">
                  {/* A playlist is described by what is in it; a track by
                      who made it. */}
                  {it.count != null
                    ? `${it.count} ${tracksWord(it.count)}${it.dur ? ` · ${hoursMins(it.dur)}` : ''}`
                    : it.playlist ? `${it.artist} · ${it.playlist}` : it.artist}
                </span>
              </span>
              {/* Only where it means something: a playlist row's number is
                  how many tracks are in it, not how long it runs. */}
              {it.dur ? <span className="dur">{mmss(it.dur)}</span> : null}
            </button>
          ))}
          {!busy && !done && (
            <button className="more" onClick={() => load(page.items.length)}>Ещё {page.total - page.items.length}</button>
          )}
        </div>
      ) : (
        /* Only when there is genuinely nothing on screen. Said over an empty
           list it is information; said over a full one it was a flicker. */
        <div className="rows"><div className="empty">
          {busy ? 'Загружаю...' : page.failed ? 'Плеер не ответил' : 'Пусто'}
        </div></div>
      )}
      <MiniBar state={state} />
    </div>
  )
}

/* ── shell ─────────────────────────────────────────────────────────────── */

export function App() {
  const { state, link } = useNet()
  const [library, setLibrary] = useState(false)
  const [libClosing, setLibClosing] = useState(false)
  const closeLibrary = useCallback(() => {
    setLibClosing(true)
    window.setTimeout(() => { setLibrary(false); setLibClosing(false) }, 250)
  }, [])
  /* Two flags rather than one, because a sheet cannot animate its way out
     after React has removed it. `closing` plays the exit, and the unmount
     waits for it. */
  const [queue, setQueue] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeQueue = useCallback(() => {
    setClosing(true)
    // A shade longer than the 230ms exit, so the last frame is not cut off.
    window.setTimeout(() => { setQueue(false); setClosing(false) }, 260)
  }, [])

  useEffect(() => {
    const tg = window.Telegram?.WebApp
    tg?.ready()
    tg?.expand()
    tg?.setBackgroundColor?.('#0b0a0e')
    tg?.setHeaderColor?.('#0b0a0e')
    net.connect()
  }, [])

  /* The player's accent, not Telegram's. The point of the sync is that the
     phone looks like the player you set up, so the theme follows the desktop
     even though the webview offers one of its own. */
  useEffect(() => {
    const hex = state.accent
    if (!hex) return
    const rgb = rgbOf(hex)
    if (!rgb) return
    document.documentElement.style.setProperty('--accent', hex)
    document.documentElement.style.setProperty('--accent-rgb', rgb)
  }, [state.accent])

  if (link.phase !== 'ready') {
    return (
      <div className="gate">
        {link.phase === 'denied' ? (
          <>
            <h1>
              {link.reason === 'not-allowed' ? 'Нет доступа'
                : link.reason === 'expired' ? 'Сеанс истёк'
                : 'Не получилось войти'}
            </h1>
            <p>
              {link.reason === 'not-allowed'
                ? `Бот не знает этот аккаунт${link.name ? ` (${link.name})` : ''}. Напиши боту /start и подтверди доступ в плеере.`
                /* Told apart from a bad signature on purpose: one means
                   reopen it, the other means something is wrong. */
                : link.reason === 'expired'
                ? 'Запуск протух. Закрой и открой мини-приложение заново - это всё, что нужно.'
                : 'Telegram не подтвердил запуск. Открой мини-приложение заново из чата с ботом.'}
            </p>
          </>
        ) : (
          <>
            <div className="spin" />
            <h1>{link.phase === 'lost' ? 'Связь потеряна' : 'Подключаюсь'}</h1>
            <p>Плеер должен быть запущен на компьютере.</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <div className="glow" />
      <div className="bar">
        <span className="dot" data-off={state.playing ? 'false' : 'true'} />
        <span className="who">{link.user}</span>
        <button className="pill" onClick={() => setLibrary(true)}>Моя музыка</button>
      </div>
      <Now state={state} />

      {/* Bottom right, out of the way of everything that is not it. Hidden
          while a sheet is open, because then it would be a button for the
          thing you are already looking at. */}
      {!library && !queue && (
        <button className="fab" onClick={() => setQueue(true)} aria-label="Очередь">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 18h13v-2H3v2zm0-5h10v-2H3v2zm0-7v2h13V6H3zm18 9.59L17.42 12 21 8.41 19.59 7l-5 5 5 5L21 15.59z" />
          </svg>
          {state.queue.length > 0 && <span className="cnt">{state.queue.length > 99 ? '99+' : state.queue.length}</span>}
        </button>
      )}

      {queue && !library && <Queue state={state} onClose={closeQueue} closing={closing} />}
      {library && <Library state={state} onClose={closeLibrary} closing={libClosing} />}
    </div>
  )
}
