import { useSettings, useProfile, useUI, ACCENT_COLORS, EQ_BANDS, AccentColor, BgStyle, VisualizerStyle, Lang } from '../store'
import { useT } from '../i18n'

interface Props { onClose: () => void }

const EQ_LABELS = ['60', '250', '1k', '4k', '12k']

export function SettingsPanel({ onClose }: Props) {
  const { accent, bgStyle, visualizerStyle, lang, eq, eqEnabled, setAccent, setBgStyle, setVisualizerStyle, setLang, setEqBand, setEqEnabled, resetEq } = useSettings()
  const { logout } = useProfile()
  const { artRgb } = useUI()
  const t = useT()
  const artworkHex = `#${artRgb.map(v => v.toString(16).padStart(2,'0')).join('')}`

  return (
    <div className="absolute inset-0 z-30 flex flex-col fade-in"
      style={{ background: '#0f0f17' }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <span className="font-semibold text-sm text-white">{t('settings')}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-all">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Accent color */}
          <Section title={t('accentColor')}>
            <div className="grid grid-cols-5 gap-2.5">
              {(Object.entries(ACCENT_COLORS) as [AccentColor, string][]).map(([key, hex]) => (
                <button
                  key={key}
                  onClick={() => setAccent(key)}
                  className="w-full aspect-square rounded-full transition-all duration-200 relative"
                  style={{
                    background: hex,
                    transform: accent === key ? 'scale(1.18)' : 'scale(1)',
                    boxShadow: accent === key ? `0 0 12px 2px ${hex}66` : undefined,
                    border: key === 'white' ? '1px solid rgba(255,255,255,0.2)' : undefined,
                  }}
                  title={key}
                >
                  {accent === key && (
                    <svg className="absolute inset-0 m-auto w-3.5 h-3.5" style={{ color: key === 'white' ? '#222' : '#fff' }} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                  )}
                </button>
              ))}

              {/* Artwork accent — vivid extracted color, updates with each track */}
              <DynamicSwatch
                hex={artworkHex}
                active={accent === 'artwork'}
                onClick={() => setAccent('artwork')}
                title={t('vividArtwork')}
                icon="note"
              />

            </div>
            {accent === 'artwork' && (
              <p className="text-[10px] text-white/30 mt-2 leading-tight">{t('artworkChanges')}</p>
            )}
          </Section>

          {/* Background style */}
          <Section title={t('background')}>
            <div className="space-y-1.5">
              {([
                ['artwork', t('bgDynamic'),  t('bgDynamicSub')],
                ['accent',  t('bgAccent'),   t('bgAccentSub')],
                ['aurora',  t('bgAurora'),   t('bgAuroraSub')],
                ['midnight',t('bgMidnight'), t('bgMidnightSub')],
                ['dark',    t('bgDark'),     t('bgDarkSub')],
              ] as [BgStyle, string, string][]).map(([val, label, sub]) => (
                <RadioBtn key={val} active={bgStyle === val} onClick={() => setBgStyle(val)} label={label} sub={sub} />
              ))}
            </div>
          </Section>

          {/* Visualizer */}
          <Section title={t('visualizer')}>
            <div className="space-y-1.5">
              {([
                ['bars',     t('vizBars'),   t('vizBarsSub')],
                ['wave',     t('vizWave'),   t('vizWaveSub')],
                ['mirror',   t('vizMirror'), t('vizMirrorSub')],
              ] as [VisualizerStyle, string, string][]).map(([val, label, sub]) => (
                <RadioBtn key={val} active={visualizerStyle === val} onClick={() => setVisualizerStyle(val)} label={label} sub={sub} />
              ))}
            </div>
          </Section>

          {/* Equalizer */}
          <Section title={t('equalizer')}>
            <div className="flex items-center justify-between mb-3">
              <Toggle active={eqEnabled} onClick={() => setEqEnabled(!eqEnabled)} />
              <button
                onClick={resetEq}
                className="text-[11px] text-white/40 hover:text-white/80 transition-colors"
              >
                {t('eqReset')}
              </button>
            </div>
            <div className="flex items-end justify-between gap-2" style={{ opacity: eqEnabled ? 1 : 0.4 }}>
              {EQ_BANDS.map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 flex-1">
                  <span className="text-[10px] text-white/40 tabular-nums">
                    {eq[i] > 0 ? '+' : ''}{eq[i]}
                  </span>
                  <input
                    type="range" min={-12} max={12} step={1}
                    value={eq[i]}
                    disabled={!eqEnabled}
                    onChange={e => setEqBand(i, Number(e.target.value))}
                    className="eq-slider"
                    style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 6, height: 90 } as React.CSSProperties}
                  />
                  <span className="text-[10px] text-white/30">{EQ_LABELS[i]}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Language */}
          <Section title={t('language')}>
            <div className="flex gap-2">
              {([['ru', 'Русский'], ['en', 'English']] as [Lang, string][]).map(([val, label]) => (
                <button
                  key={val}
                  onClick={() => setLang(val)}
                  className="flex-1 py-2 px-3 rounded-lg text-sm transition-all"
                  style={{
                    background: lang === val ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.05)',
                    color: lang === val ? '#fff' : 'rgba(255,255,255,0.5)',
                    border: lang === val ? '1px solid rgba(var(--accent-rgb),0.35)' : '1px solid transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </Section>

          {/* Discord */}
          <Section title="Discord">
            <div className="flex items-center justify-between" style={{ opacity: 0.5 }}>
              <div className="flex flex-col">
                <span className="text-sm text-white/80">{t('discordRpc')}</span>
                <span className="text-[10px]" style={{ color: 'var(--accent)' }}>{t('discordRpcSub')}</span>
              </div>
              <Toggle active={false} onClick={() => {}} />
            </div>
          </Section>

          {/* Account */}
          <Section title={t('account')}>
            <button
              onClick={() => { logout(); onClose() }}
              className="w-full py-2 px-3 rounded-lg text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-all text-left"
            >
              {t('signOut')}
            </button>
          </Section>
        </div>
      </div>
  )
}

function DynamicSwatch({ hex, active, onClick, title, icon }: {
  hex: string; active: boolean; onClick: () => void; title: string; icon: 'note' | 'image'
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-full aspect-square rounded-full transition-all duration-200 relative overflow-hidden"
      style={{
        background: hex,
        transform: active ? 'scale(1.18)' : 'scale(1)',
        boxShadow: active ? `0 0 14px 3px ${hex}88` : undefined,
        outline: !active ? '2px dashed rgba(255,255,255,0.28)' : 'none',
        outlineOffset: '2px',
      }}
    >
      {active ? (
        <svg className="absolute inset-0 m-auto w-3.5 h-3.5 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
        </svg>
      ) : icon === 'note' ? (
        <svg className="absolute inset-0 m-auto w-3 h-3 text-white/80 drop-shadow" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
      ) : (
        <svg className="absolute inset-0 m-auto w-3 h-3 text-white/80 drop-shadow" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
        </svg>
      )}
    </button>
  )
}

function Toggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative rounded-full transition-all duration-200"
      style={{
        width: 38, height: 22,
        background: active ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
      }}
    >
      <span
        className="absolute top-1/2 rounded-full bg-white transition-all duration-200"
        style={{ width: 16, height: 16, transform: 'translateY(-50%)', left: active ? 20 : 3 }}
      />
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">{title}</p>
      {children}
    </div>
  )
}

function RadioBtn({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150
        ${active ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white hover:bg-white/5'}`}
    >
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all
        ${active ? 'border-[var(--accent)]' : 'border-white/20'}`}>
        {active && <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />}
      </div>
      <div className="flex flex-col items-start min-w-0">
        <span>{label}</span>
        {sub && <span className="text-[10px] text-white/30 leading-tight">{sub}</span>}
      </div>
    </button>
  )
}
