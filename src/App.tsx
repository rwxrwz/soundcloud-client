import { useEffect, useState } from 'react'
import { useProfile } from './store'
import { Login } from './pages/Login'
import { Player } from './pages/Player'
import { MiniPlayer } from './components/MiniPlayer'
import { Toaster } from './components/Toaster'
import { WindowControls } from './components/WindowControls'

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
      setBooted(true)
    })()
  }, [])

  if (!booted) return <div style={{ height: '100vh', background: '#080808' }} />

  return (
    <>
      {/* Top drag strip so the frameless window can be moved */}
      <div className="fixed top-0 left-0 right-0 h-9 drag-region" style={{ zIndex: 40 }} />
      {user ? <Player /> : <Login />}
      <WindowControls />
      <Toaster />
    </>
  )
}
