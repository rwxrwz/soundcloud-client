import { useEffect } from 'react'
import { useProfile, useUI, useSettings, usePlayer, ACCENT_COLORS } from '../store'
import { sc } from '../services/soundcloud'

function hexToRgbArr(hex: string): [number, number, number] {
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g) ?? ['0', '0', '0']
    return [+m[0], +m[1], +m[2]]
  }
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]
}
import { useSync } from '../hooks/useSync'
import { useBridge } from '../hooks/useBridge'
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
import { AlbumContextMenu } from '../components/AlbumContextMenu'
import { SettingsPanel } from '../components/SettingsPanel'
import { UpdateBanner } from '../components/UpdateBanner'
import { checkForUpdates } from '../services/updates'
import { watchWindowActivity } from '../services/perf'
import { HeroAnim } from '../components/HeroAnim'
import { QuickCustomize } from '../components/QuickCustomize'
import { QueueFlyout } from '../components/QueueFlyout'

export function Player() {
  const { clientId, oauthToken, user } = useProfile()
  const { bgColor, artRgb, showTrackPage, setShowTrackPage, artistPageUser, selectedAlbum, overlayOrder, showQueue, showSettings, setShowSettings, page } = useUI()
  const ovZ = (k: 'track' | 'artist' | 'album') => 50 + Math.max(0, overlayOrder.indexOf(k))
  const { accent, bgStyle, wallpaperPath, wallpaperBlur, theme, transparencyLevel, heroAnim, playerStyle, fsLiveBg, perfNoBlur, perfNoHeroAnim, perfMiniOpaque } = useSettings()
  const fsHome = playerStyle === 'fullscreen' && page === 'main'
  const isTransparent = theme === 'transparent'
  // A browsing overlay is open → the bottom island narrows and floats above it.
  const overlayOpen = !!(showTrackPage || artistPageUser || selectedAlbum)
  // Keep the island visible even on the fullscreen home while an overlay is open.
  const islandOpen = !fsHome || overlayOpen
  const { isPlaying, setPlaying, currentTrack, progress, duration, volume, setVolume, seekTo, nextTrack, prevTrack } = usePlayer()
  const accentHex: string = accent === 'artwork'
    ? `#${artRgb.map(v => v.toString(16).padStart(2,'0')).join('')}`
    : (ACCENT_COLORS[accent as keyof typeof ACCENT_COLORS] ?? ACCENT_COLORS.orange)

  useEffect(() => {
    sc.setCredentials(clientId, oauthToken, user?.id)
  }, [clientId, oauthToken, user?.id])

  // Check GitHub for a newer release on startup (cached in main; safe if offline)
  useEffect(() => { void checkForUpdates() }, [])

  // Apply the configured start page + sync system prefs to the main process once
  useEffect(() => {
    const s = useSettings.getState()
    useUI.getState().setPage(s.startPage)
    window.electronAPI?.setCloseToTray?.(s.closeToTray)
    // Reflect the real OS launch-at-login state back into the store
    window.electronAPI?.getLoginItem?.().then(v => {
      if (typeof v === 'boolean' && v !== s.launchAtStartup) s.setLaunchAtStartup(v)
    }).catch(() => {})
  }, [])

  useSync()
  useBridge()

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
        seekTo(Math.min(duration, progress + 5))
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault()
        seekTo(Math.max(0, progress - 5))
      } else if (e.code === 'ArrowUp') {
        e.preventDefault()
        setVolume(Math.min(1, Math.round((volume + 0.05) * 100) / 100))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        setVolume(Math.max(0, Math.round((volume - 0.05) * 100) / 100))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isPlaying, currentTrack, progress, duration, volume, setPlaying, setVolume, seekTo, nextTrack, prevTrack])

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

  // Performance: same trick for the "no blur" option
  useEffect(() => {
    if (perfNoBlur) document.documentElement.dataset.noblur = '1'
    else delete document.documentElement.dataset.noblur
  }, [perfNoBlur])

  // Track window focus/visibility so animation loops can idle when unwatched
  useEffect(() => watchWindowActivity(), [])

  // Mini-player transparency is a window option — main applies it on next open
  useEffect(() => {
    window.electronAPI?.setMiniOpaque?.(perfMiniOpaque)
  }, [perfMiniOpaque])

  // The living artwork background fills the whole window; when it's on, keep a
  // neutral solid base under it so it doesn't blend with the page gradient.
  const livingBgActive = fsHome && fsLiveBg && bgStyle !== 'wallpaper'

  const getBg = () => {
    if (livingBgActive) return '#080808'
    const [r, g, b] = artRgb
    switch (bgStyle) {
      case 'wallpaper': return '#080808'
      case 'dark':     return '#080808'
      case 'midnight': return 'linear-gradient(160deg, #0d0d1f 0%, #080808 60%)'
      case 'aurora':   return undefined
      case 'accent': {
        const [ar, ag, ab] = hexToRgbArr(accentHex)
        // identical formula to 'artwork' dynamic — just uses accent color instead of artRgb
        return `radial-gradient(ellipse at 25% 35%, rgb(${ar},${ag},${ab}) 0%, rgba(${ar},${ag},${ab},0.3) 45%, #0a0a0f 75%)`
      }
      default:         return `radial-gradient(ellipse at 25% 35%, ${bgColor} 0%, rgba(${r},${g},${b},0.3) 45%, #0a0a0f 75%)`
    }
  }

  return (
    <div
      className={`h-screen flex flex-col relative${bgStyle === 'aurora' && !livingBgActive && !isTransparent ? ' aurora-bg' : ''}`}
      style={{ background: isTransparent ? `rgba(10,10,14,${1 - transparencyLevel / 100})` : getBg(), borderRadius: isTransparent ? 12 : undefined, transition: bgStyle === 'aurora' ? undefined : (isTransparent ? 'background 0.45s ease' : 'background 1.2s ease') }}
    >
      {/* Custom wallpaper background (behind everything) - video or image by ext */}
      {!isTransparent && bgStyle === 'wallpaper' && wallpaperPath && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
          {/\.(mp4|webm)$/i.test(wallpaperPath) ? (
            <video
              key={wallpaperPath}
              src={`scwall://media/${encodeURIComponent(wallpaperPath.split(/[\\/]/).pop() || '')}`}
              autoPlay loop muted playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: wallpaperBlur ? `blur(${wallpaperBlur}px)` : undefined, transform: wallpaperBlur ? 'scale(1.08)' : undefined }}
            />
          ) : (
            <img
              key={wallpaperPath}
              src={`scwall://media/${encodeURIComponent(wallpaperPath.split(/[\\/]/).pop() || '')}`}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', filter: wallpaperBlur ? `blur(${wallpaperBlur}px)` : undefined, transform: wallpaperBlur ? 'scale(1.08)' : undefined }}
            />
          )}
          <div className="absolute inset-0" style={{ background: 'rgba(8,8,12,0.5)' }} />
        </div>
      )}

      {/* Living artwork background — full window, behind the glass UI (fullscreen home) */}
      {!isTransparent && fsHome && fsLiveBg && bgStyle !== 'wallpaper' && <FsLivingBg />}

      {/* Home hero animation — sits BEHIND the sidebar/content (z-index -1) and
          pokes slightly onto the sidebar, showing through its glass */}
      {!isTransparent && heroAnim !== 'none' && page === 'main' && playerStyle !== 'fullscreen' && !perfNoHeroAnim && (
        <div className="absolute pointer-events-none" style={{ top: 36, left: 170, right: 0, height: 240, zIndex: 0 }}>
          <HeroAnim />
        </div>
      )}

      {/* Drag region */}
      <div className="h-9 drag-region shrink-0 relative" style={{ zIndex: 1 }} />

      {/* Main row */}
      <div className={`flex-1 flex gap-3 px-3 min-h-0 overflow-hidden relative ${fsHome ? 'pb-3' : ''}`} style={{ zIndex: 1 }}>
        {/* Sidebar island — icons-only in the fullscreen player style */}
        <div
          className="shrink-0 glass-island rounded-2xl flex flex-col overflow-hidden relative"
          style={{
            width: playerStyle === 'fullscreen' ? 72 : 208,
            // The row grows by the bar's negative offset; only the content column
            // should slide under the bar. 18 gives that height back, +12 keeps the
            // usual gap between the sidebar and the bar.
            marginBottom: islandOpen && !overlayOpen ? (isTransparent ? 12 : 30) : 0,
            transition: 'width 0.34s cubic-bezier(0.16,1,0.3,1)',
          }}
        >
          <Sidebar />
        </div>

        {/* Main content — fullscreen player on home, otherwise the track list */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ contain: 'layout paint' }}>
          {fsHome ? <HomePlayer /> : page === 'friends' ? <FriendsPage /> : <TrackList />}
        </main>
      </div>

      {/* Controls island — kept MOUNTED always (it hosts the audio engine via
          useAudio). On the fullscreen-style home it animates closed (slide down +
          collapse via grid-rows) instead of unmounting, so audio keeps playing.
          When a browsing overlay (artist / track / album) is open, the island
          morphs into a narrower liquid-glass island floating above the overlay. */}
      <div
        className="grid shrink-0"
        style={{
          gridTemplateRows: islandOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.34s cubic-bezier(0.16,1,0.3,1)',
          position: 'relative',
          zIndex: overlayOpen ? 60 : 1,
          // Pull the whole bar up over the list so the scroll container's clip edge
          // ends up hidden behind it instead of cutting a visible line above it.
          // Only while it's actually docked — not when collapsed or floating.
          marginTop: islandOpen && !overlayOpen && !isTransparent ? -18 : 0,
        }}
      >
        <div
          className="min-h-0"
          style={{
            overflow: overlayOpen ? 'visible' : 'hidden',
            paddingLeft: overlayOpen ? 'clamp(24px, 8%, 170px)' : 0,
            paddingRight: overlayOpen ? 'clamp(24px, 8%, 170px)' : 0,
            transition: 'padding 0.45s cubic-bezier(0.32,0.72,0,1)',
          }}
        >
          <div
            className="mx-3 mb-3 glass-island relative"
            style={{
              borderRadius: overlayOpen ? 26 : 16,
              // Docked at the bottom the outline just reads as a divider under the
              // track list — keep it only when the bar floats over an overlay.
              border: overlayOpen ? undefined : 'none',
              marginTop: overlayOpen ? 12 : 0,
              transform: (fsHome && !overlayOpen) ? 'translateY(16px)' : 'none',
              opacity: (fsHome && !overlayOpen) ? 0 : 1,
              boxShadow: overlayOpen ? '0 24px 70px rgba(0,0,0,0.6)' : 'none',
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
      {page === 'main' && <QuickCustomize />}
      {fsHome && <QueueFlyout />}
      <PlaylistPicker />
      <ContextMenu />
      <PlaylistContextMenu />
      <ArtistContextMenu />
      <AlbumContextMenu />
    </div>
  )
}
