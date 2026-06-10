import { useProfile } from './store'
import { Login } from './pages/Login'
import { Player } from './pages/Player'
import { MiniPlayer } from './components/MiniPlayer'
import { Toaster } from './components/Toaster'
import { WindowControls } from './components/WindowControls'

export default function App() {
  const isMini = window.location.hash === '#mini'
  if (isMini) return <MiniPlayer />

  const { user } = useProfile()
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
