import { useEffect, useState } from 'react'
import { useProfile, useUI, useSettings, usePlayer, resolveAccentHex, hexToRgb, seasonActive, appDate, reconcileSky, useLyrics } from '../store'
import { sc } from '../services/soundcloud'
import { wallpaperSrc } from '../services/net'
import { useT } from '../i18n'
import { BAR_SPACE } from '../layout'
import { libraryArtists } from '../services/scan'

/* Accepts an `rgb(...)` string as well as a hex, which is the one thing the
   store's parser does not - everything else defers to it, so a value it
   cannot read falls back to the accent rather than to NaN. */
function hexToRgbArr(hex: string): [number, number, number] {
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g) ?? ['0', '0', '0']
    return [+m[0], +m[1], +m[2]]
  }
  return hexToRgb(hex)
}
import { useSync } from '../hooks/useSync'
import { WhatsNew } from '../components/WhatsNew'
import { pendingNews, type NewsItem } from '../services/whatsNew'
import { useBridge } from '../hooks/useBridge'
import { useRemote } from '../hooks/useRemote'
import { useRadio } from '../hooks/useRadio'
import { Sidebar } from '../components/Sidebar'
import { TrackList } from '../components/TrackList'
import { FriendsPage } from '../components/FriendsPage'
import { HomePlayer } from '../components/HomePlayer'
import { FsLivingBg } from '../components/FsLivingBg'
import { NowPlaying } from '../components/NowPlaying'
import { TrackPage } from '../components/TrackPage'
import { ArtistPage } from '../components/ArtistPage'
import { AlbumPage } from '../components/AlbumPage'
import { QueuePanel } from '../components/QueuePanel'
import { PlaylistPicker } from '../components/PlaylistPicker'
import { ContextMenu } from '../components/ContextMenu'
import { PlaylistContextMenu } from '../components/PlaylistContextMenu'
import { ArtistContextMenu } from '../components/ArtistContextMenu'
import { SidebarContextMenu } from '../components/SidebarContextMenu'
import { AlbumContextMenu } from '../components/AlbumContextMenu'
import { SettingsPanel } from '../components/SettingsPanel'
import { EditMode } from '../components/EditMode'
import { Welcome } from '../components/Welcome'
import { RAIN_SKY, type BgStyle } from '../store'
import { Rain } from '../components/Rain'
import { Sakura } from '../components/Sakura'
import { NightSky } from '../components/NightSky'
import { Snow } from '../components/Snow'
import { Tree } from '../components/Tree'
import { Garland } from '../components/Garland'
import { UpdateBanner } from '../components/UpdateBanner'
import { checkForUpdates } from '../services/updates'
import { blurScale, watchWindowActivity } from '../services/perf'
import { QuickCustomize } from '../components/QuickCustomize'
import { BackgroundContextMenu } from '../components/BackgroundContextMenu'
import { QueueFlyout } from '../components/QueueFlyout'
import { ConfirmDialog } from '../components/ConfirmDialog'

export function Player() {
  const { clientId, oauthToken, user } = useProfile()
  const { bgColor, artRgb, showTrackPage, artistPageUser, selectedAlbum, overlayOrder, showQueue, showSettings, setShowSettings, editMode, showWelcome, showNews, news, page, confirmAsk, answerConfirm, setBgMenu, railFolded, setRailFolded } = useUI()
  const t = useT()
  const ovZ = (k: 'track' | 'artist' | 'album') => 50 + Math.max(0, overlayOrder.indexOf(k))
  const { accent, customAccent, bgStyle, wallpaperPath, wallpaperBlur, theme, transparencyLevel, sidebarWide, fsLiveBg, season, rain, rainTheme, sakura, nightSky, tree, garland } = useSettings()
  // Home is the player, always. There is no longer a style in which it isn't.
  const fsHome = page === 'main'
  /* The rail's width on screen: the setting, unless it has been folded away
     by hand for this visit to the home screen. */
  const railWide = sidebarWide && !(fsHome && railFolded)
  const isTransparent = theme === 'transparent'
  // A browsing overlay is open → the bottom island narrows and floats above it.
  const overlayOpen = !!(showTrackPage || artistPageUser || selectedAlbum)
  // Keep the island visible even on the home screen while an overlay is open.
  const islandOpen = !fsHome || overlayOpen
/* Per field, not the whole store.
 *
 * This line used to be a bare usePlayer(), which returns a fresh object on
 * every set - and `progress` is written on every timeupdate, several times
 * a second. So the root re-rendered at that rate for as long as music
 * played, and with exactly one memoised component in the tree everything
 * below it re-rendered too. The same diagnosis is written out in
 * ContextMenu.tsx, where it was fixed for one component; this is the root.
 *
 * progress/duration/volume are deliberately absent: the only reader is the
 * key handler below, which takes them from getState() when a key is
 * actually pressed. Subscribing to them is what made the root tick. */
  const isPlaying = usePlayer(s => s.isPlaying)
  const currentTrack = usePlayer(s => s.currentTrack)
  const { setPlaying, setVolume, seekTo, nextTrack, prevTrack } = usePlayer.getState()
  const accentHex: string = resolveAccentHex(accent, customAccent, artRgb)

  useEffect(() => {
    sc.setCredentials(clientId, oauthToken, user?.id)
  }, [clientId, oauthToken, user?.id])

  // Check GitHub for a newer release on startup (cached in main; safe if offline)
  useEffect(() => { void checkForUpdates() }, [])

  /* Put the "L" badges back from the files on disk. The map that drives
     them lives in browser storage and can fall behind - it did, when an
     older build cleared a track's mark on every play - while a cached
     result is proof the words exist. Once at startup, costs a directory
     listing. */
  useEffect(() => {
    window.electronAPI?.lyricsCachedIds?.()
      .then(ids => { if (ids.length) useLyrics.getState().markMany(ids) })
      .catch(() => {})
  }, [])

  /* The names this library claims, handed to the Genius matcher so a
     single automatic lookup gets the same help a full scan does. The
     scan sends its own list when it starts; this one covers every track
     opened outside of one. Cheap, and only when the list changes. */
  const likes = useProfile(s => s.likes)
  useEffect(() => {
    if (!likes.length) return
    try { window.electronAPI?.geniusLibrary?.(libraryArtists(likes)) } catch { /* no bridge */ }
  }, [likes])

  // Apply the configured start page + sync system prefs to the main process once
  useEffect(() => {
    const s = useSettings.getState()
    useUI.getState().setPage(s.startPage)
    window.electronAPI?.setCloseToTray?.(s.closeToTray)
    window.electronAPI?.setDiscordRpc?.(s.discordRpc)
    // Reflect the real OS launch-at-login state back into the store
    window.electronAPI?.getLoginItem?.().then(v => {
      if (typeof v === 'boolean' && v !== s.launchAtStartup) s.setLaunchAtStartup(v)
    }).catch(() => {})
  }, [])

  useSync()

  /* The date is read during render, so without this nothing would notice it
     changing: a player left open over the night of 30 November shows no snow
     on 1 December, and one open while the clock is moved by hand keeps
     whatever season it started in until it is restarted. Checked once a
     minute, which is cheap and still turns the season over promptly. */
  const [, dayTick] = useState(0)
  useEffect(() => {
    let last = appDate().toDateString()
    const id = setInterval(() => {
      const now = appDate().toDateString()
      if (now !== last) {
        last = now
        // Midnight on 30 November turns the season on by itself, so the
        // one-sky rule has to be applied here too and not only on a click.
        useSettings.setState(s => reconcileSky({ ...s }))
        dayTick((n: number) => n + 1)
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  /* First run. The flag is persisted, so this fires once per install and
     never again - and only once there is an account, because the first thing
     the flow does is ask about a player you cannot see yet otherwise. */
  const seenWelcome = useSettings(s => s.seenWelcome)
  const setShowWelcome = useUI(s => s.setShowWelcome)
  /* One of the two, never both, and the first run wins. Somebody meeting
     the player for the first time is not owed news about a version they
     have no memory of - so finishing the first run stamps the version and
     the news for it is already behind them. */
  useEffect(() => {
    if (!seenWelcome) { setShowWelcome(true); return }
    let dead = false
    pendingNews(useSettings.getState().lastSeenVersion).then(found => {
      if (dead || !found) return
      /* Nothing to say, but the version still wants recording: without
         this a build carrying no entries would leave the stamp stale and
         show the whole backlog again on the next one. */
      if (!found.items.length) { useSettings.getState().setLastSeenVersion(found.version); return }
      useUI.getState().setNews(found)
      useUI.getState().setShowNews(true)
    }).catch(() => { /* no bridge: say nothing rather than guess */ })
    return () => { dead = true }
  }, [])
  useBridge()
  useRemote()
  useRadio()

  // Broadcast player state to mini window whenever it changes
  useEffect(() => {
    const broadcast = () => {
      const { currentTrack, isPlaying, volume, progress, duration } = usePlayer.getState()
      const { artRgb } = useUI.getState()
      window.electronAPI?.sendPlayerState({
        currentTrack: currentTrack ? {
          id: currentTrack.id,
          title: currentTrack.title,
          artwork_url: currentTrack.artwork_url,
          /* SoundCloud's own length for this track, in ms. The duration
             below it comes from the audio element, which does not know it
             until the new track's metadata loads - until then it is still
             the length of the track that just finished. */
          duration: currentTrack.duration,
          user: { username: currentTrack.user?.username ?? '' }
        } : null,
        isPlaying, volume, progress, duration,
        artRgb,
      })
    }
    broadcast()
    const u1 = usePlayer.subscribe(broadcast)
    const u2 = useUI.subscribe(broadcast)
    return () => { u1(); u2() }
  }, [])

  // Receive control commands from mini window
  useEffect(() => {
    return window.electronAPI?.onPlayerCommand((action) => {
      const store = usePlayer.getState()
      if (action.type === 'next') store.nextTrack()
      else if (action.type === 'prev') store.prevTrack()
      else if (action.type === 'play-pause') store.setPlaying(action.payload as boolean)
      else if (action.type === 'volume') store.setVolume(action.payload as number)
      // Seek from MPRIS (desktop widget / playerctl). Goes through seekTo, i.e. the
      // same optimistic path the in-app slider uses, in seconds.
      else if (action.type === 'seek') store.seekTo(action.payload as number)
    })
  }, [])

  // Keyboard shortcuts (skip when typing in an input)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!useSettings.getState().mediaKeys) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Ctrl/Cmd + ←/→ → previous / next track (works from any of the app's windows)
      if ((e.ctrlKey || e.metaKey) && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) {
        e.preventDefault()
        e.code === 'ArrowRight' ? nextTrack() : prevTrack()
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        if (!currentTrack) return
        setPlaying(!isPlaying)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        { const p = usePlayer.getState(); seekTo(Math.min(p.duration, p.progress + 5)) }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        { const p = usePlayer.getState(); seekTo(Math.max(0, p.progress - 5)) }
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setVolume(Math.min(1, Math.round((usePlayer.getState().volume + 0.05) * 100) / 100))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setVolume(Math.max(0, Math.round((usePlayer.getState().volume - 0.05) * 100) / 100))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  /* No progress/duration/volume here either: with them in the list this
     effect tore down and re-added a window listener several times a
     second. The handler reads them live instead. */
  }, [isPlaying, currentTrack, setPlaying, setVolume, seekTo, nextTrack, prevTrack])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', accentHex)
    const [r, g, b] = hexToRgbArr(accentHex)
    root.style.setProperty('--accent-rgb', `${r},${g},${b}`)
  }, [accentHex])

  // Drive the visual theme preset app-wide via a root attribute the CSS keys off
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Transparent theme needs the window created transparent, which can't change at
  // runtime -> persist the flag for main to read on next launch (Settings shows a
  // restart button when the running window doesn't match the chosen theme).
  useEffect(() => {
    window.electronAPI?.setWindowTransparent?.(theme === 'transparent')
  }, [theme])

  // Track window focus/visibility so animation loops can idle when unwatched
  useEffect(() => watchWindowActivity(), [])

  // The living artwork background fills the whole window; when it's on, keep a
  // neutral solid base under it so it doesn't blend with the page gradient.
  /* The living background is a full-window canvas repainting itself off the
     artwork, and the storm is another one over the top of it: run both and
     the sky is washed out by whatever colour the cover happens to be, at
     twice the cost. The rain wins while it falls, and the setting is left
     alone so it comes back on its own when the weather clears. */
  /* "Custom wallpaper" with nothing picked is not a background, it is a
     black window: the wallpaper branch below draws nothing and the gradient
     is skipped, so the setting silently costs you the look. Until a file is
     chosen it falls back to the artwork gradient - the setting itself stays
     where the person put it, so picking one later just works. */
  const bg: BgStyle = bgStyle === 'wallpaper' && !wallpaperPath ? 'artwork' : bgStyle
  const livingBgActive = fsHome && fsLiveBg && bg !== 'wallpaper' && !rain

  const getBg = () => {
    if (livingBgActive) return '#080808'
    const [r, g, b] = artRgb
    switch (bg) {
      case 'wallpaper': return '#080808'
      case 'aurora':   return undefined
      case 'accent': {
        const [ar, ag, ab] = hexToRgbArr(accentHex)
        // identical formula to 'artwork' dynamic - just uses accent color instead of artRgb
        return `radial-gradient(ellipse at 25% 35%, rgb(${ar},${ag},${ab}) 0%, rgba(${ar},${ag},${ab},0.3) 45%, #0a0a0f 75%)`
      }
      default:         return `radial-gradient(ellipse at 25% 35%, ${bgColor} 0%, rgba(${r},${g},${b},0.3) 45%, #0a0a0f 75%)`
    }
  }

  /* Right-click on the background. This sits on the root rather than on any
     one surface because "the background" is whatever is left over: the gaps
     between the islands, the empty half of a track list, the home screen
     with nothing playing. Everything that owns a menu - tracks, playlists,
     artists, the sidebar rail - stops the event before it reaches here, so
     this fires exactly where nothing else claimed the click. */
  const onBgContext = (e: React.MouseEvent) => {
    /* Only on the plain player. The editing mode is already the thing this
       menu opens, and the rest of these put a surface of their own over the
       window - a menu about the background, floating on top of the settings
       panel, is pointing at something the person cannot even see. */
    if (editMode || overlayOpen || showQueue || showSettings || showWelcome || showNews || confirmAsk) return
    const el = e.target as HTMLElement
    // A text field's right-click belongs to the text field. Nothing offers a
    // native edit menu here today, but breaking that the day one is added is
    // not worth the two lines saved.
    if (el.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return
    e.preventDefault()
    setBgMenu({ x: e.clientX, y: e.clientY })
  }

  return (
    <div
      onContextMenu={onBgContext}
      className={`h-screen flex flex-col relative${bg === 'aurora' && !livingBgActive && !isTransparent ? ' aurora-bg' : ''}`}
      style={{
        background: isTransparent ? `rgba(10,10,14,${1 - transparencyLevel / 100})` : getBg(),
        borderRadius: isTransparent ? 12 : undefined,
        transition: bg === 'aurora' ? undefined : (isTransparent ? 'background 0.45s ease' : 'background 1.2s ease'),
        /* The sky colour, handed to the aurora gradient separately from the
           accent - see .aurora-bg. Unset otherwise, and the gradient falls
           back to the accent the way it always did. */
        ...(rainTheme ? { ['--aurora-rgb' as string]: hexToRgbArr(RAIN_SKY).join(',') } : {}),
      } as React.CSSProperties}
    >
      {/* Custom wallpaper background (behind everything) - video or image by ext */}
      {!isTransparent && bg === 'wallpaper' && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
          {/\.(mp4|webm)$/i.test(wallpaperPath) ? (
            <video
              key={wallpaperPath}
              src={wallpaperSrc(wallpaperPath)}
              autoPlay loop muted playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: wallpaperBlur ? `blur(${wallpaperBlur}px)` : undefined, transform: `scale(${blurScale(wallpaperBlur)})` }}
            />
          ) : (
            <img
              key={wallpaperPath}
              src={wallpaperSrc(wallpaperPath)}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: wallpaperBlur ? `blur(${wallpaperBlur}px)` : undefined, transform: `scale(${blurScale(wallpaperBlur)})` }}
            />
          )}
          <div className="absolute inset-0" style={{ background: 'rgba(8,8,12,0.5)' }} />
        </div>
      )}

      {/* Living artwork background - full window, behind the glass UI (home) */}
      {!isTransparent && livingBgActive && <FsLivingBg />}

      {/* Drag region */}
      <div className="h-9 drag-region shrink-0 relative" style={{ zIndex: 1 }} />

      {/* Main row */}
      <div className={`flex-1 flex gap-3 px-3 min-h-0 relative ${fsHome ? 'pb-3' : ''}`} style={{ zIndex: 1 }}>
        {/* Sidebar island - icons-only when the rail is narrow, by setting or
            because it was folded away for this visit to home */}
        <div
          data-edit="sidebar"
          className="shrink-0 glass-island rounded-2xl flex flex-col overflow-hidden relative"
          style={{
            width: railWide ? 208 : 72,
            // The content column slides under the floating bar; the sidebar stops
            // above it, keeping the usual gap.
            marginBottom: islandOpen && !overlayOpen ? BAR_SPACE + 12 : 0,
            transition: 'width 0.34s cubic-bezier(0.16,1,0.3,1), margin-bottom 0.34s cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <Sidebar />
        </div>

        {/* Main content - the player on home, otherwise the track list */}
        {/* No clipping here on purpose: `contain: paint` and `overflow: hidden`
            cut every shadow and glow dead at the edge of this block, which is what
            made the bottom of the screen look like a separate piece. Clipping now
            lives only where it is unavoidable - inside the scrollers themselves. */}
        <main data-edit="content" className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          {/* Fold the rail away. It lives out here rather than on the rail
              itself: a handle clipped to the edge of the thing it shrinks is
              hard to hit and harder to find once the thing is small. Out in
              the corner it is the same kind of object as the queue and the
              palette down the other end - a window control, not a nav item.
              Only on home, and only when the rail is wide by setting: 208px
              of labels is in the way when the window is the player, but that
              is not worth changing the setting over. It toggles, because a
              fold you cannot undo without leaving the page is a trap. */}
          {fsHome && sidebarWide && (
            <div className="absolute z-30 corner-dock" data-edge="top" data-away={editMode ? 'true' : undefined}
              style={{ left: 2, top: 12 }}>
              <button
                onClick={() => setRailFolded(!railFolded)}
                title={railFolded ? t('sbUnfold') : t('sbFold')}
                className="icon-btn glass-island w-9 h-9 flex items-center justify-center transition-all duration-150 active:scale-90 hover:scale-105"
                style={{ borderRadius: 9999, color: 'rgba(255,255,255,0.85)' }}
              >
                <svg className="w-4 h-4 transition-transform duration-200" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: railFolded ? 'rotate(180deg)' : 'none' }}>
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </button>
            </div>
          )}
          {fsHome ? <HomePlayer /> : page === 'friends' ? <FriendsPage /> : <TrackList />}
        </main>
      </div>

      {/* Controls island - kept MOUNTED always (it hosts the audio engine via
          useAudio). On the home screen it animates closed (slide down +
          collapse via grid-rows) instead of unmounting, so audio keeps playing.
          When a browsing overlay (artist / track / album) is open, the island
          morphs into a narrower liquid-glass island floating above the overlay. */}
      <div
        className="grid"
        style={{
          gridTemplateRows: islandOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.34s cubic-bezier(0.16,1,0.3,1)',
          // The bar lies OVER the canvas instead of taking a row next to it. That
          // removes the seam at its top edge: the list simply continues underneath
          // and the glass blurs it. The old -18px pull-up existed only to hide the
          // clip line this layout no longer produces.
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: overlayOpen ? 60 : 2,
        }}
      >
        <div
          className="min-h-0"
          style={{
            // Clipping here only while the bar is collapsing - that is the one
            // moment it is needed, to mask the grid-rows animation. Kept on while
            // open, it chopped the artwork's beat glow off at the island's edge
            // instead of letting it fade out over the canvas.
            overflow: islandOpen ? 'visible' : 'hidden',
            paddingLeft: overlayOpen ? 'clamp(24px, 8%, 170px)' : 0,
            paddingRight: overlayOpen ? 'clamp(24px, 8%, 170px)' : 0,
            transition: 'padding 0.45s cubic-bezier(0.32,0.72,0,1)',
          }}
        >
          <div
            className="mx-3 mb-3 glass-island relative"
            /* The bar's top edge is a ledge rain pools on - see Rain.tsx. */
            data-rain="pool"
            style={{
              borderRadius: overlayOpen ? 26 : 16,
              // Docked at the bottom the outline just reads as a divider under the
              // track list - keep it only when the bar floats over an overlay.
              border: overlayOpen ? undefined : 'none',
              marginTop: overlayOpen ? 12 : 0,
              transform: (fsHome && !overlayOpen) ? 'translateY(16px)' : 'none',
              opacity: (fsHome && !overlayOpen) ? 0 : 1,
              boxShadow: overlayOpen ? 'var(--sh-3)' : 'none',
              transition: 'transform 0.34s cubic-bezier(0.16,1,0.3,1), opacity 0.28s ease, border-radius 0.45s cubic-bezier(0.32,0.72,0,1), box-shadow 0.45s ease',
            }}
          >
            <NowPlaying />
          </div>
        </div>
      </div>

      {/* Update banner (new GitHub release available) */}
      <UpdateBanner />

      {/* Overlays */}
      {showTrackPage && <TrackPage z={ovZ('track')} />}
      {artistPageUser && <ArtistPage z={ovZ('artist')} />}
      {selectedAlbum && <AlbumPage z={ovZ('album')} />}
      {showQueue && <QueuePanel />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {editMode && <EditMode />}
      {showWelcome && <Welcome />}
      {showNews && news && <WhatsNew items={news.items as NewsItem[]} version={news.version} />}
      {/* Rain is not seasonal and not tied to a page - it is weather over the
          whole window, switched on by hand and left alone. */}
      {rain && <Rain />}
      {sakura && <Sakura />}
      {nightSky && <NightSky />}
      {seasonActive(season) === 'newyear' && <Snow />}
      {/* The tree stands on the home screen only. Everywhere else the content
          column is the thing being read, and a tree behind it is in the way. */}
      {seasonActive(season) === 'newyear' && tree && page === 'main' && <Tree />}
      {/* The garland is on every page: it sits above the content, not in it. */}
      {seasonActive(season) === 'newyear' && garland && <Garland />}
      {/* The palette stays through the editing mode - it is how you leave
          again - and the dock is kept clear of it by its own max height.
          The queue button animates itself out of the way; see corner-dock. */}
      {page === 'main' && <QuickCustomize />}
      {fsHome && <QueueFlyout />}
      <PlaylistPicker />
      <ContextMenu />
      <PlaylistContextMenu />
      <ArtistContextMenu />
      <SidebarContextMenu />
      <AlbumContextMenu />
      <BackgroundContextMenu />

      {/* App-wide confirmation - lives here so it survives the menu that asked */}
      {confirmAsk && (
        <ConfirmDialog
          message={confirmAsk.message}
          confirmLabel={confirmAsk.confirmLabel}
          cancelLabel={t('cancel')}
          danger={confirmAsk.danger}
          onConfirm={() => answerConfirm(true)}
          onCancel={() => answerConfirm(false)}
        />
      )}
    </div>
  )
}
