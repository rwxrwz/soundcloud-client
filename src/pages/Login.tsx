import { useState, useEffect } from 'react'
import logo from '../assets/logo.png'
import { useProfile, useSettings, ACCENT_COLORS } from '../store'
import { sc } from '../services/soundcloud'
import { useT } from '../i18n'

declare global {
  interface Window {
    electronAPI?: {
      auth: () => Promise<{ clientId: string; oauthToken: string }>
      getClientId: () => Promise<string>
      openMiniPlayer: () => Promise<void>
      closeMiniPlayer: () => Promise<void>
      toggleDevTools: () => Promise<void>
      showMainWindow: () => Promise<void>
      getPlayerState: () => Promise<unknown>
      sendPlayerState: (state: unknown) => void
      onPlayerState: (cb: (state: unknown) => void) => (() => void)
      playerControl: (action: { type: string; payload?: unknown }) => void
      onPlayerCommand: (cb: (action: { type: string; payload?: unknown }) => void) => (() => void)
      scWrite: (method: string, url: string, body: unknown, oauthToken: string) => Promise<unknown>
      scGet: (url: string, oauthToken: string) => Promise<unknown>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      setDiscordRpc: (enabled: boolean) => Promise<void>
    }
  }
}

export function Login() {
  const { setAuth } = useProfile()
  const { accent } = useSettings()
  const t = useT()
  const accentHex = ACCENT_COLORS[accent] ?? ACCENT_COLORS.slate
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState('')

  // Apply accent var on login screen too
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', accentHex)
    const h = accentHex.replace('#', '')
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16)
    root.style.setProperty('--accent-rgb', `${r},${g},${b}`)
  }, [accentHex])

  const handleLogin = async () => {
    setLoading(true); setError('')
    try {
      setStep(t('openingSC'))
      const result = await window.electronAPI!.auth()
      setStep(t('loadingProfile'))
      sc.setCredentials(result.clientId, result.oauthToken)
      const user = await Promise.race([
        sc.getMe(),
        new Promise<never>((_, r) => setTimeout(() => r(new Error('Timeout')), 10000))
      ])
      setAuth(result.clientId, result.oauthToken, user)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('закрыто')) setError(msg)
    } finally { setLoading(false); setStep('') }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center relative overflow-hidden"
      style={{ background: '#080808' }}>

      {/* Animated background blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full blur-3xl opacity-20 animate-pulse"
          style={{ background: accentHex }} />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 rounded-full blur-3xl opacity-10 animate-pulse"
          style={{ background: accentHex, animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full blur-3xl opacity-5"
          style={{ background: accentHex }} />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-7 fade-up">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-2xl overflow-hidden shadow-2xl"
            style={{ boxShadow: `0 0 60px rgba(var(--accent-rgb), 0.4)` }}>
            <img src={logo} alt="SoundCloud" className="w-full h-full object-cover" />
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white">SoundCloud</h1>
            <p className="text-white/40 mt-1 text-sm">{t('tagline')}</p>
          </div>
        </div>

        {/* Card */}
        <div className="w-80 rounded-2xl p-6 shadow-2xl"
          style={{
            background: 'rgba(255,255,255,0.06)',
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
          <h2 className="text-lg font-semibold text-white mb-1">{t('signIn')}</h2>
          <p className="text-sm text-white/40 mb-6">
            {loading && step ? step : t('signInHint')}
          </p>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full py-3 px-4 rounded-xl text-white font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.97] flex items-center justify-center gap-2 disabled:opacity-50"
            style={{
              background: loading ? `${accentHex}99` : accentHex,
              boxShadow: `0 4px 24px rgba(var(--accent-rgb), 0.35)`
            }}
          >
            {loading ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span className="text-sm">{step || t('connecting')}</span></>
            ) : (
              <><img src={logo} alt="" className="w-5 h-5 object-contain rounded" />
              {t('signInWithSC')}</>
            )}
          </button>

          {error && <p className="mt-3 text-xs text-red-400 text-center">{error}</p>}
        </div>
      </div>
    </div>
  )
}
