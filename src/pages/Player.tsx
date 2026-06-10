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
import { Sidebar } from '../components/Sidebar'
import { TrackList } from '../components/TrackList'
import { NowPlaying } from '../components/NowPlaying'
import { TrackPage } from '../components/TrackPage'
import { ArtistPage } from '../components/ArtistPage'
import { QueuePanel } from '../components/QueuePanel'
import { PlaylistPicker } from '../components/PlaylistPicker'
import { ContextMenu } from '../components/ContextMenu'

export function Player() {
  const { clientId, oauthToken, user } = useProfile()
  const { bgColor, artRgb, showTrackPage, setShowTrackPage, artistPageUser, showQueue, showSettings } = useUI()
  const { accent, bgStyle } = useSettings()
  const { isPlaying, setPlaying, currentTrack, progress, duration, volume, setVolume, seekTo } = usePlayer()
  const accentHex: string = accent === 'artwork'
    ? `#${artRgb.map(v => v.toString(16).padStart(2,'0')).join('')}`
    : (ACCENT_COLORS[accent as keyof typeof ACCENT_COLORS] ?? ACCENT_COLORS.orange)

  useEffect(() => {
    sc.setCredentials(clientId, oauthToken, user?.id)
  }, [clientId, oauthToken, user?.id])

  // Sync Discord RPC enabled state to main process on startup
  useEffect(() => {
    window.electronAPI?.setDiscordRpc(useSettings.getState().discordRpc)
  }, [])

  useSync()

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
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

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
  }, [isPlaying, currentTrack, progress, duration, volume, setPlaying, setVolume, seekTo])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', accentHex)
    const [r, g, b] = hexToRgbArr(accentHex)
    root.style.setProperty('--accent-rgb', `${r},${g},${b}`)
  }, [accentHex])

  const getBg = () => {
    const [r, g, b] = artRgb
    switch (bgStyle) {
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
      className={`h-screen flex flex-col relative${bgStyle === 'aurora' ? ' aurora-bg' : ''}`}
      style={{ background: getBg(), transition: bgStyle === 'aurora' ? undefined : 'background 1.2s ease' }}
    >
      {/* Drag region */}
      <div className="h-9 drag-region shrink-0" />

      {/* Main row */}
      <div className="flex-1 flex gap-3 px-3 min-h-0 overflow-hidden">
        {/* Sidebar island — widens when settings are open */}
        <div
          className="shrink-0 glass-island rounded-2xl flex flex-col overflow-hidden relative"
          style={{
            width: showSettings ? 320 : 208,
            transition: 'width 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            willChange: 'width',
          }}
        >
          <Sidebar />
        </div>

        {/* Track list */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ contain: 'layout paint' }}>
          <TrackList />
        </main>
      </div>

      {/* Controls island */}
      <div className="mx-3 mt-3 mb-3 glass-island rounded-2xl shrink-0">
        <NowPlaying />
      </div>

      {/* Overlays */}
      {showTrackPage && <TrackPage />}
      {artistPageUser && <ArtistPage />}
      {showQueue && <QueuePanel />}
      <PlaylistPicker />
      <ContextMenu />
    </div>
  )
}
