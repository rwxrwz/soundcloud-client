import { usePlayer, useUI } from '../store'
import { sc } from '../services/soundcloud'

// Full-window living background for the fullscreen player style: blurred artwork
// with slow drift + accent blobs from the artwork's dominant colour + vignette.
// Rendered at the Player root so it fills the whole window (behind the glass UI).
export function FsLivingBg() {
  const currentTrack = usePlayer(s => s.currentTrack)
  const [r, g, b] = useUI(s => s.artRgb)
  const artwork = currentTrack
    ? sc.formatArtwork(currentTrack.artwork_url || currentTrack.user?.avatar_url, 't500x500')
    : null

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }} aria-hidden>
      {artwork && (
        <>
          <img src={artwork} alt="" style={{ position: 'absolute', inset: '-20%', width: '140%', height: '140%', objectFit: 'cover', filter: 'blur(100px) saturate(1.4) brightness(0.5)', opacity: 0.5, animation: 'fs-float-a 24s ease-in-out infinite' }} />
          <img src={artwork} alt="" style={{ position: 'absolute', inset: '-20%', width: '140%', height: '140%', objectFit: 'cover', filter: 'blur(120px) saturate(1.6) brightness(0.4)', opacity: 0.35, animation: 'fs-float-b 32s ease-in-out infinite', mixBlendMode: 'screen' }} />
        </>
      )}
      <div style={{ position: 'absolute', top: '6%', left: '8%', width: 620, height: 620, borderRadius: '50%', background: `radial-gradient(circle, rgba(${r},${g},${b},0.45) 0%, transparent 70%)`, filter: 'blur(70px)', animation: 'fs-blob 28s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', bottom: '4%', right: '6%', width: 680, height: 680, borderRadius: '50%', background: `radial-gradient(circle, rgba(${Math.min(255, r + 60)},${Math.min(255, g + 40)},${Math.min(255, b + 90)},0.35) 0%, transparent 70%)`, filter: 'blur(80px)', animation: 'fs-blob 36s ease-in-out infinite reverse' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 42%, transparent 30%, rgba(0,0,0,0.5) 100%)' }} />
    </div>
  )
}
