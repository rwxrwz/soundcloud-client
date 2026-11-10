import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react'
import { useProfile, useUI, useSettings, usePlayer, useUpdate, useLyrics, resolveAccentHex } from '../store'
import { pendingUpdate } from '../services/updates'
import type { SCPlaylist } from '../services/soundcloud'
import { useT } from '../i18n'
import logo from '../assets/logo_sidebar.png'

// How long a tab takes to fold in or out of the rail. Must stay >= the longest
// nav-slot run in index.css (delay + duration), otherwise the row unmounts
// mid-animation. Longest today: the 0.08s + 0.34s enter.
const NAV_ANIM_MS = 460
// Vertical gap between tabs, as a margin inside the collapsing row (index.css).
const NAV_GAP = 2

export const NAV = [
  { id: 'main'      as const, key: 'home'      as const, icon: HomeIcon },
  { id: 'releases'  as const, key: 'releases'  as const, icon: ReleasesIcon },
  { id: 'likes'     as const, key: 'likes'     as const, icon: HeartIcon  },
  { id: 'playlists' as const, key: 'playlists' as const, icon: ListIcon   },
  { id: 'friends'   as const, key: 'friends'   as const, icon: FriendsIcon },
  { id: 'search'    as const, key: 'search'    as const, icon: SearchIcon },
]

export function Sidebar() {
  const { user, likes, playlists, setLikes, setPlaylists, setFollowings, setFollowingIds, clientId, oauthToken } = useProfile()
  const { page, setPage, goToPlaylists, setShowSettings, setArtistPage, setSidebarMenu, railFolded } = useUI()
  const { accent, customAccent, sidebarWide, hiddenNav } = useSettings()
  const visibleIds = useMemo(() => NAV.filter(item => !hiddenNav.includes(item.id)).map(item => item.id), [hiddenNav])
  const visibleNav = NAV.filter(item => visibleIds.includes(item.id))
  /* Narrow either because that is the chosen width, or because the rail was
     folded away by hand. The fold only applies on home - every other page
     shows the rail at its set width - but it is remembered across tabs, so
     coming back to home finds it as it was left. */
  const folded = page === 'main' && railFolded
  const compact = !sidebarWide || folded
  /* Home hides the bottom bar, so the rail is the only place left with a
     volume slider - at BOTH widths. Tied to `compact` it used to vanish on
     a wide rail, leaving the home screen with no volume control anywhere. */
  const showVolume = page === 'main'
  const t = useT()
  const [syncing, setSyncing] = useState(false)
  const accentHex = accent === 'artwork' ? 'var(--accent)' : resolveAccentHex(accent, customAccent, [])
  const { current, releases } = useUpdate()
  // Persistent dot on the gear whenever a newer release exists (ignores the
  // banner's per-version dismissal, so the hint stays until you actually update).
  const hasUpdate = !!pendingUpdate(current, releases, null)

  /* Refetches the library: likes, playlists, the people you
     follow, and the playlist being looked at.
     The playlist listing alone was not enough - a playlist's tracks are kept
     in playlistCache, keyed by id and never invalidated, so a track added from
     the phone arrived in the listing's track_count and still was not on the
     page. Anything whose length changed has its cached tracks dropped, and the
     open playlist is refetched by id, because it may be someone else's and so
     not in the listing at all.
     Releases are the one list left out: that feed is built from a request per
     followed artist and costs far more than everything here put together. */
  const handleRefresh = async () => {
    if (!user || syncing) return
    setSyncing(true)
    try {
      const { sc } = await import('../services/soundcloud')
      const { playlistCache } = await import('../services/playlistCache')
      sc.setCredentials(clientId, oauthToken, user.id)
      const open = useUI.getState().selectedPlaylist
      const openId = open && open.id > 0 ? open.id : 0   // local playlists have nothing to fetch
      const [likesTracks, playlistsRes, openFull, followRes] = await Promise.all([
        sc.getAllLikes(user.id, 3000),
        sc.getPlaylists(user.id),
        openId ? sc.getPlaylist(openId).catch(() => null) : Promise.resolve(null),
        /* Caught on their own so a failure here cannot cost the rest: the
           Friends page fetches its list exactly once, when it is empty, so
           without this a follow made on the phone never showed up at all. */
        sc.getFollowings(user.id, 200).catch(() => null),
      ])
      const fresh = playlistsRes.collection
      // Compared against the listing we are replacing, so this has to happen
      // before setPlaylists. TrackList re-hydrates whatever lost its entry.
      const before = new Map(playlists.map(p => [p.id, p.track_count ?? 0]))
      for (const p of fresh) if (before.get(p.id) !== (p.track_count ?? 0)) playlistCache.delete(p.id)

      /* The open playlist is filled in HERE, while the button is still
         spinning. /playlists/{id} returns the tail of the list as bare ids, so
         the titles take another round trip - left to the page's own effect
         that round trip started only once the spinner had stopped, and the
         list sat unchanged for a couple of seconds after the refresh looked
         finished. Paid for inside the refresh instead, so the spinner means
         what it says. */
      let openPl: SCPlaylist | null = null
      if (openId) {
        const full = openFull ?? fresh.find(p => p.id === openId) ?? null
        // Always refilled, even when the count came back the same: one track
        // swapped for another leaves it unchanged, and this is the list on
        // screen.
        if (full) {
          const tracks = await sc.hydratePlaylistTracks(full.tracks ?? [])
          playlistCache.set(openId, tracks)   // set before setPlaylists, so the
          openPl = { ...full, tracks }        // background preload skips it
        } else playlistCache.delete(openId)
      }

      setLikes(likesTracks)
      setPlaylists(fresh)
      if (openPl) useUI.setState({ selectedPlaylist: openPl })
      if (followRes) {
        // One response, both lists: the page's roster and the ids the follow
        // buttons read their state from.
        const friends = followRes.collection ?? []
        setFollowings(friends)
        setFollowingIds(friends.map(u => u.id))
      }
      /* The "L" marks are made to agree with the files on disk - added
         where a file turned up, dropped where none did. A refresh is when
         a person expects everything on screen to agree with reality
         again, and the badges were the one thing it could not fix: the
         old call could only add, so a cache cleared by hand left every
         "L" standing with no way to take it down.
         
         An empty list is an answer, not a failure, and the important one:
         no cache at all means no badges. Only a missing bridge is no
         answer, and then nothing is touched. */
      const ids = await window.electronAPI?.lyricsCachedIds?.()
      if (Array.isArray(ids)) useLyrics.getState().reconcile(ids)
    } catch (e) {
      console.error('Refresh failed:', e)
    } finally {
      setSyncing(false)
    }
  }
  const navRef = useRef<HTMLElement>(null)
  const pillRef = useRef<HTMLSpanElement>(null)

  const navActiveId = visibleNav.find(item =>
    page === item.id || (item.id === 'playlists' && page === 'playlist-detail')
  )?.id ?? 'main'

  /* Tabs being added or removed. 'in' has just appeared, 'out' is collapsing and
     stays mounted only long enough to finish - React unmounts instantly, so a
     leaving row has to be held here or there is nothing left to animate. */
  const [navAnim, setNavAnim] = useState<Record<string, 'in' | 'out'>>({})
  const prevVisibleRef = useRef(visibleIds)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const prev = prevVisibleRef.current
    prevVisibleRef.current = visibleIds
    const added = visibleIds.filter(id => !prev.includes(id))
    const removed = prev.filter(id => !visibleIds.includes(id))
    if (!added.length && !removed.length) return
    setNavAnim(a => {
      const next = { ...a }
      for (const id of added) next[id] = 'in'
      for (const id of removed) next[id] = 'out'
      return next
    })
    /* One timer per toggle, tracked by id rather than by effect run.
       The cleanup used to cancel whichever timer was outstanding, which is
       wrong as soon as two tabs are toggled inside NAV_ANIM_MS - and the
       menu is built so they can be, it stays open on purpose "so several
       tabs can be toggled in one go". The first tab's timer was cancelled
       by the second toggle and the second timer only knew about the second
       tab, so the first id stayed in navAnim for good: its row stayed
       mounted and collapsed, and the effect below never saw navAnim empty,
       so it kept a 60fps loop measuring the pill with getBoundingClientRect
       and left the pill's transition pinned to none for the session. */
    const ids = [...added, ...removed]
    const timer = setTimeout(() => {
      setNavAnim(a => {
        const next = { ...a }
        for (const id of ids) delete next[id]
        return next
      })
      timers.current.delete(timer)
    }, NAV_ANIM_MS)
    timers.current.add(timer)
  }, [visibleIds])

  // Nothing outlives the sidebar.
  useEffect(() => () => { for (const t of timers.current) clearTimeout(t); timers.current.clear() }, [])

  // A collapsing tab is still drawn; everything else follows the visible set.
  const renderedNav = NAV.filter(item => visibleIds.includes(item.id) || navAnim[item.id] === 'out')

  const measurePill = useCallback(() => {
    const nav = navRef.current
    const pill = pillRef.current
    if (!nav || !pill) return
    const btn = nav.querySelector('[data-active="true"]') as HTMLElement | null
    // The tab for the current page can itself be hidden from the rail. Then
    // there is nothing to sit under, and the pill folds away rather than
    // hovering over whichever tab happens to be at that offset.
    if (!btn) { pill.style.height = '0px'; pill.style.opacity = '0'; return }
    // Measure the row, not the button. A collapsing row only clips the button -
    // the button keeps its full height throughout - so sizing the pill off the
    // button left it standing at full height over an empty gap until the row
    // unmounted. Matching the row's fade too makes the pill leave with its tab
    // instead of lingering a beat behind it.
    const inner = btn.parentElement
    const slot = inner?.parentElement
    const slotH = slot ? slot.getBoundingClientRect().height : btn.offsetHeight + NAV_GAP
    pill.style.opacity = inner ? getComputedStyle(inner).opacity : '1'
    pill.style.transform = `translateY(${btn.offsetTop}px)`
    pill.style.height = `${Math.max(0, Math.min(btn.offsetHeight, slotH - NAV_GAP))}px`
  }, [])

  useLayoutEffect(() => { measurePill() }, [navActiveId, measurePill])

  // While rows expand or collapse every offset in the rail moves each frame, so
  // the pill is re-measured per frame with its own transition switched off: it
  // then rides the layout exactly instead of chasing it 200ms behind.
  useEffect(() => {
    // Nothing animating: take one final reading. The last frame of a collapse
    // leaves the pill a few pixels tall, and the row it was measuring has just
    // unmounted - without this a sliver of accent is left hanging in the rail.
    if (!Object.keys(navAnim).length) { measurePill(); return }
    const pill = pillRef.current
    const saved = pill ? pill.style.transition : ''
    if (pill) pill.style.transition = 'none'
    let raf = requestAnimationFrame(function tick() {
      measurePill()
      raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (pill) pill.style.transition = saved
    }
  }, [navAnim, measurePill])

  return (
    <>
      <div
        className="w-full flex flex-col h-full relative"
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setSidebarMenu({ x: e.clientX, y: e.clientY }) }}
      >
        {/* Logo / drag region */}
        <div className={`pt-4 pb-3 drag-region rail-fit ${compact ? 'px-0' : 'px-4'}`}>
          {/* justify-center in both widths: narrow it centres the mark, wide
              the label beside it grows to fill and pushes the mark left. One
              rule, no alignment to switch at the moment of the resize. */}
          <div className={`flex items-center justify-center no-drag rail-fit ${compact ? 'gap-0' : 'gap-2.5'}`}>
            <div className="w-7 h-7 shrink-0">
              <img src={logo} alt="" className="w-full h-full object-contain" />
            </div>
            <span className="rail-label font-semibold text-sm text-white/80" data-hide={compact ? 'true' : 'false'}>
              SoundCloud
            </span>
          </div>
        </div>

        {/* User card */}
        {user && (
          <div onClick={() => setArtistPage(user)} title={t('viewProfile')} role="button"
            className={`mb-3 rounded-xl slide-right cursor-pointer relative z-10 rail-fit ${compact ? 'mx-2 px-0 py-0 flex justify-center' : 'mx-3 px-3 py-2.5 hover:bg-white/[0.08]'}`}>
            {/* The card's surface is its own layer rather than a background on
                the card. Two reasons: it can fade out with the labels instead
                of being dropped by a class swap, and an inline background here
                would outrank the hover class and kill the highlight. */}
            <div className="absolute inset-0 rounded-xl pointer-events-none"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                opacity: compact ? 0 : 1,
                transition: 'opacity 0.24s ease',
              }} />
            <div className={`relative flex items-center justify-center rail-fit ${compact ? 'gap-0' : 'gap-2.5'}`}>
              <div className="relative shrink-0">
                <img
                  src={user.avatar_url?.replace('-large', '-t50x50')}
                  alt=""
                  className={`rounded-full object-cover rail-fit ${compact ? 'w-9 h-9' : 'w-8 h-8'}`}
                />
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#080808]"
                  style={{ background: accentHex }} />
              </div>
              <div className="rail-label min-w-0" data-hide={compact ? 'true' : 'false'}>
                <p className="text-xs font-semibold truncate text-white/90">{user.full_name || user.username}</p>
                <p className="text-[10px] text-white/40 truncate">@{user.username}</p>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        {/* The rail scrolls, so this is a clipping box, and the first and last
            tabs sit right against its edge - their hover glow (box-shadow out
            to 21px) was being cut off by a hard line. The padding gives the
            glow room inside the clip and the negative margin takes it back out
            of the layout, so nothing moves. Those two strips now lie over the
            user card and the volume slider, which is why both are raised above
            the rail - the glow still shows through them, they keep their
            clicks, and the rail keeps a usable scrollbar. */}
        {/* overflow-x-hidden is load-bearing, not tidying.
            overflow-y-auto alone leaves the other axis `visible`, and CSS
            turns a `visible` into `auto` the moment its partner is not one.
            So the nav had a horizontal scrollbar it never asked for, and it
            showed up for real: while the rail narrows, the labels are still
            wider than it, the content overflows for a few hundred
            milliseconds, and Chromium drew its thumb across the empty part
            of the rail - a light bar that appeared at the start of the
            animation and was gone by the end.
            It took four rounds of instrumenting the DOM to find, because a
            scrollbar is not an element: no query, no hit test and no
            pseudo-element check can see one. */}
        <nav ref={navRef} className="flex-1 px-2 py-5 -my-5 overflow-y-auto overflow-x-hidden relative">
          {/* Sliding pill */}
          <span
            ref={pillRef}
            className="absolute left-0 right-0 mx-2 rounded-xl pointer-events-none"
            style={{
              top: 0,
              height: 0,
              background: `rgba(var(--accent-rgb), 0.18)`,
              willChange: 'transform',
              transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), height 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
            }}
          />

          {renderedNav.map(item => {
            const active = page === item.id || (item.id === 'playlists' && page === 'playlist-detail')
            const Icon = item.icon
            const state = navAnim[item.id]
            return (
              <div key={item.id} className={`nav-slot ${state === 'in' ? 'nav-in' : state === 'out' ? 'nav-out' : ''}`}>
                <div>
                  <button
                    data-active={active ? 'true' : undefined}
                    onClick={() => item.id === 'playlists' ? goToPlaylists() : setPage(item.id)}
                    title={compact ? t(item.key) : undefined}
                    className={`icon-btn w-full flex items-center justify-center rounded-xl text-sm font-medium relative group rail-fit py-2.5 ${compact ? 'px-0 gap-0' : 'px-3 gap-3'}`}
                    style={{
                      color: active ? '#fff' : 'rgba(255,255,255,0.45)',
                      transition: 'color 0.3s ease',
                    }}
                  >
                    {/* Left accent bar - wide rail only; centred icons make it
                        look stray. Always mounted and driven to zero height
                        instead of unmounted, so it retracts into the edge
                        rather than vanishing the instant the rail narrows. */}
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-r-full"
                      style={{
                        height: active && !compact ? 20 : 0,
                        background: accentHex,
                        transition: 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    />

                    <span style={{ color: active ? accentHex : undefined }} className="transition-colors duration-300">
                      <Icon />
                    </span>

                    <span className="rail-label" data-hide={compact ? 'true' : 'false'}>{t(item.key)}</span>

                    {item.id === 'likes' && likes.length > 0 && (
                      <span className="rail-label rail-label-tight text-[10px] text-white/30 text-right"
                        data-hide={compact ? 'true' : 'false'}>{likes.length}</span>
                    )}
                    {item.id === 'playlists' && playlists.length > 0 && (
                      <span className="rail-label rail-label-tight text-[10px] text-white/30 text-right"
                        data-hide={compact ? 'true' : 'false'}>{playlists.length}</span>
                    )}

                    {/* Hover glow */}
                    {!active && (
                      <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        style={{ background: 'rgba(255,255,255,0.04)' }} />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </nav>

        {/* Volume - only on Home, where the bottom bar is hidden; every other
            page keeps the slider in the bar. Collapses with an animation.
         *
         * justify-end is load-bearing. The nav above is flex-1, so this box's
         * BOTTOM is pinned above the settings row and its top is what moves
         * when the height changes. With the contents sitting at the top they
         * rode that 120px of travel every time the rail changed width, which
         * read as the slider flickering across the panel. Anchored to the
         * bottom, the slider stays put and only the empty space above it
         * opens and closes. */}
        <div
          className="overflow-hidden shrink-0 relative z-10 flex flex-col justify-end"
          style={{
            /* An explicit height, not a max-height, and driven by `compact`
               rather than by the measured width.
             *
               max-height only caps: the box still collapsed to whatever the
               contents came to, so the moment the shape swapped it lost 112px
               in a single frame. An explicit height removes the content from
               the equation entirely.
             *
               Driven by the flag, the height starts moving on the same frame
               as the width and lands with it - one motion. Driven by the
               measured width it would have waited for the threshold and then
               started a second, later animation, which is two motions and
               reads as a stutter. The SHAPE still follows the measurement;
               only the box does not. */
            height: showVolume ? (compact ? 160 : 48) : 0,
            opacity: showVolume ? 1 : 0,
            pointerEvents: showVolume ? 'auto' : 'none',
            transition: 'height 0.34s cubic-bezier(0.16,1,0.3,1), opacity 0.24s ease',
          }}
        >
          {/* The shape changes on the same frame as the height, not when the
              rail passes some measured width.
            *
              Swapping on a measured threshold sounds more correct and was
              much worse: by the time an expanding rail crossed it the box had
              already shrunk most of the way, so exchanging the 160px column
              for the 48px strip moved the contents 116px in a single frame.
              Collapsing crossed the threshold early and had no such gap,
              which is exactly why only one direction looked broken.
              Swapped with the flag, shape and box move together from the
              first frame and the strip simply grows with the rail. */}
          <VolumeColumn accentHex={accentHex} horizontal={!compact} />
        </div>

        {/* Bottom bar: refresh + settings */}
        {/* Stacked when narrow, side by side when wide - flex-direction cannot
            tween, so the arrangement itself does snap. The height must not:
            the stack is 42px taller, and letting that land in one frame threw
            everything above it up and down halfway through the width slide.
            Animated instead, on the width's own curve, and clipped so that
            growing into the stack is a reveal rather than a pop. Contents sit
            at the bottom, so the edge nearest the window never moves. */}
        <div
          className={`p-3 flex gap-1.5 items-end overflow-hidden ${compact ? 'flex-col items-center justify-end' : ''}`}
          style={{
            height: compact ? 102 : 60,
            transition: 'height 0.34s cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            title={compact ? t('settings') : undefined}
            className={`icon-btn flex items-center justify-center text-sm text-white/40 hover:text-white/80 transition-all duration-200 hover:bg-white/5 rounded-xl rail-fit ${compact ? 'w-9 h-9 gap-0 px-0 py-0' : 'flex-1 gap-2.5 px-3 py-2'}`}
          >
            <span className="relative shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              {hasUpdate && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full" style={{ background: accentHex, boxShadow: '0 0 0 2px #080808' }} />
              )}
            </span>
            <span className="rail-label" data-hide={compact ? 'true' : 'false'}>{t('settings')}</span>
          </button>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={syncing}
            title={t('refreshLibrary')}
            className="icon-btn flex items-center justify-center w-9 h-9 rounded-xl shrink-0 transition-all duration-200 hover:bg-white/5"
            style={{ color: syncing ? accentHex : 'rgba(255,255,255,0.4)' }}
            onMouseEnter={e => { if (!syncing) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.8)' }}
            onMouseLeave={e => { if (!syncing) (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)' }}
          >
            <svg
              className="w-4 h-4"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
              style={{ animation: syncing ? 'spin 0.8s linear infinite' : 'none' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}

/* The volume control, in both shapes the rail comes in.
 *
 * One component rather than two: the dragging, the wheel step, the
 * ctrl-click-to-type and the mute states are the fiddly parts, and two
 * copies of them would drift. Only the axis differs, so the axis is a
 * prop and everything else is shared.
 *
 * Vertical reads top-to-bottom as loud-to-quiet, which is why its value
 * comes out of the rect inverted; horizontal reads left-to-right as usual. */
function VolumeColumn({ accentHex, horizontal }: { accentHex: string; horizontal?: boolean }) {
  const { volume, setVolume, toggleMute } = usePlayer()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  const active = dragging || hovering
  const pct = Math.min(100, Math.max(0, volume * 100))
  const round = (v: number) => Math.round(v * 100) / 100
  // Ctrl+click to type an exact percentage.
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const applyInput = () => { const n = parseInt(inputVal, 10); if (!isNaN(n)) setVolume(round(Math.min(1, Math.max(0, n / 100)))); setEditing(false) }

  const valueFrom = useCallback((client: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return volume
    if (horizontal) {
      if (rect.width === 0) return volume
      return round(Math.min(1, Math.max(0, (client - rect.left) / rect.width)))
    }
    if (rect.height === 0) return volume
    return round(Math.min(1, Math.max(0, 1 - (client - rect.top) / rect.height)))
  }, [volume, horizontal])

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); setInputVal(String(Math.round(volume * 100))); setEditing(true); return }
    e.preventDefault()
    setDragging(true)
    setVolume(valueFrom(horizontal ? e.clientX : e.clientY))
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent) => setVolume(valueFrom(horizontal ? e.clientX : e.clientY))
    const up = () => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging, valueFrom, setVolume, horizontal])

  const onWheel = (e: React.WheelEvent) => {
    setVolume(round(Math.min(1, Math.max(0, volume - Math.sign(e.deltaY) * 0.05))))
  }

  const mute = (
    <button
      onClick={toggleMute}
      className="text-white/40 hover:text-white/80 transition-colors shrink-0"
      title="Mute"
    >
      {volume === 0 ? (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
        </svg>
      ) : volume < 0.5 ? (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>
        </svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </svg>
      )}
    </button>
  )

  return (
    <div className={`relative ${horizontal ? 'px-4 pt-7 pb-0 flex items-center gap-2.5' : 'pt-6 pb-1 flex flex-col items-center gap-2'}`}>
      {editing && (
        <input
          autoFocus
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
          onKeyDown={(e) => { if (e.key === 'Enter') applyInput(); else if (e.key === 'Escape') setEditing(false) }}
          onBlur={applyInput}
          className="absolute z-20 w-12 text-center text-xs text-white rounded-md py-1 focus:outline-none"
          style={horizontal
            ? { right: 8, top: '50%', transform: 'translateY(-50%)', background: 'rgba(20,20,26,0.98)', border: '1px solid rgba(var(--accent-rgb),0.5)' }
            : { left: '50%', transform: 'translateX(-50%)', top: 40, background: 'rgba(20,20,26,0.98)', border: '1px solid rgba(var(--accent-rgb),0.5)' }}
        />
      )}

      {/* The reading, only while the slider is being touched.
          It sits in space that is already empty - above the right end of the
          strip, above the track in the narrow rail - so showing it moves
          nothing and hiding it leaves no hole. A number parked there all day
          would be permanent chrome for a value you look at once a week. */}
      <span
        className="absolute text-[10.5px] text-white/45 tabular-nums pointer-events-none select-none"
        style={{
          ...(horizontal
            ? { right: 16, top: 6 }
            : { left: '50%', transform: 'translateX(-50%)', top: 3 }),
          opacity: active || editing ? 1 : 0,
          transition: 'opacity 0.16s ease',
        }}
      >
        {Math.round(volume * 100)}%
      </span>

      {horizontal && mute}

      <div
        ref={trackRef}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="relative cursor-pointer select-none"
        style={horizontal ? { flex: 1, minWidth: 0, height: 20 } : { width: 20, height: 108 }}
      >
        <div className="absolute rounded-full" style={horizontal
          ? { top: '50%', transform: 'translateY(-50%)', height: active ? 5 : 3, left: 0, right: 0,
              background: 'rgba(255,255,255,0.12)', transition: 'height 0.12s ease' }
          : { left: '50%', transform: 'translateX(-50%)', width: active ? 5 : 3, top: 0, bottom: 0,
              background: 'rgba(255,255,255,0.12)', transition: 'width 0.12s ease' }}>
          <div className="absolute rounded-full" style={horizontal
            ? { left: 0, top: 0, bottom: 0, width: `${pct}%`, background: accentHex,
                transition: dragging ? 'none' : 'width 0.1s linear' }
            : { bottom: 0, left: 0, right: 0, height: `${pct}%`, background: accentHex,
                transition: dragging ? 'none' : 'height 0.1s linear' }} />
        </div>
        <div style={{
          position: 'absolute',
          width: 13, height: 13, borderRadius: '50%', background: '#fff',
          ...(horizontal
            ? { top: '50%', left: `calc(${pct}% - 6.5px)`, transform: `translateY(-50%) scale(${dragging ? 1.2 : 1})` }
            : { left: '50%', bottom: `calc(${pct}% - 6.5px)`, transform: `translateX(-50%) scale(${dragging ? 1.2 : 1})` }),
          opacity: active ? 1 : 0,
          transition: 'opacity 0.15s ease, transform 0.1s ease',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }} />
      </div>

      {!horizontal && mute}
    </div>
  )
}

function HomeIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h4v-6h4v6h4a1 1 0 001-1V10"/>
  </svg>
}
function ReleasesIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l2.09 4.26L18.8 8l-3.4 3.32.8 4.68L12 13.77 7.8 16l.8-4.68L5.2 8l4.71-.74L12 3z"/>
  </svg>
}
function HeartIcon() {
  return <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
    <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
  </svg>
}
function ListIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10"/>
  </svg>
}
function SearchIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
  </svg>
}
function FriendsIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-1a4 4 0 00-4-4h-1m-4 5H2v-1a4 4 0 014-4h4a4 4 0 014 4v1zm-2-9a3 3 0 11-6 0 3 3 0 016 0zm7-1a3 3 0 11-6 0 3 3 0 016 0z"/>
  </svg>
}
