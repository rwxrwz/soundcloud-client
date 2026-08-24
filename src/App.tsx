import { useEffect, useState } from 'react'
import { useProfile, useSettings } from './store'
import { Login } from './pages/Login'
import { Player } from './pages/Player'
import { MiniPlayer } from './components/MiniPlayer'
import { Toaster } from './components/Toaster'
import { WindowControls } from './components/WindowControls'
import { SixSevenEgg } from './components/SixSevenEgg'

export default function App() {
  const isMini = window.location.hash === '#mini'
  if (isMini) return <MiniPlayer />

  return <MainApp />
}

function MainApp() {
  const { user } = useProfile()
  const [booted, setBooted] = useState(false)

  // Rehydrate the OAuth token from the OS keychain (it's no longer kept in
  // localStorage). Also migrates any legacy token still sitting in localStorage.
  useEffect(() => {
    (async () => {
      try {
        const p = useProfile.getState()
        if (p.user) {
          if (p.oauthToken) {
            // Legacy token from an older build — move it into the keychain and
            // re-persist so it drops out of localStorage.
            await window.electronAPI?.secureSetToken?.(p.oauthToken)
            useProfile.setState({ oauthToken: p.oauthToken })
          } else {
            const tok = await window.electronAPI?.secureGetToken?.()
            if (tok) useProfile.setState({ oauthToken: tok })
          }
        }
      } catch { /* ignore */ }
      // Push persisted system prefs that live in the main process on launch, so a
      // saved value takes effect without re-toggling it (mirrors closeToTray/login).
      try { window.electronAPI?.setDatadomeBypass?.(useSettings.getState().datadomeBypass) } catch { /* ignore */ }
      setBooted(true)
    })()
  }, [])

  // Icon glow on/off: toggles the data-icon-glow attribute the CSS gates on.
  const iconGlow = useSettings(s => s.iconGlow)
  useEffect(() => {
    if (iconGlow) document.documentElement.dataset.iconGlow = '1'
    else delete document.documentElement.dataset.iconGlow
  }, [iconGlow])

  // Spotlight hover for all .icon-btn buttons: one delegated listener writes the
  // cursor position (relative to the hovered button) into CSS vars the button's
  // ::after radial-gradient reads. Marking a button only needs the `icon-btn`
  // class — no per-button handler.
  useEffect(() => {
    if (!iconGlow) return  // no listener while the effect is off
    const onMove = (e: globalThis.MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest?.('.icon-btn') as HTMLElement | null
      if (!btn) return
      const r = btn.getBoundingClientRect()
      btn.style.setProperty('--mx', `${e.clientX - r.left}px`)
      btn.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    document.addEventListener('mousemove', onMove, { passive: true })
    return () => document.removeEventListener('mousemove', onMove)
  }, [iconGlow])

  if (!booted) return <div style={{ height: '100vh', background: '#080808' }} />

  return (
    <>
      {/* Top drag strip so the frameless window can be moved */}
      <div className="fixed top-0 left-0 right-0 h-9 drag-region" style={{ zIndex: 40 }} />
      {user ? <Player /> : <Login />}
      <WindowControls />
      <Toaster />
      <SixSevenEgg />
    </>
  )
}
