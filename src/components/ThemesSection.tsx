import { useMemo } from 'react'
import { useSettings, useToast, useUI, resolveAccentHex } from '../store'
import { THEMES, DEFAULT_THEME, activeThemeId, applyTheme, currentLook, themeLook, themeSwatch, type PlayerTheme } from '../themes'
import { Toggle } from './settingsControls'
import { useT } from '../i18n'
import branchUrl from '../assets/sakura.webp'

/* The lazy way in, sitting under the door to the editing mode: the same
 * subject, taken from the other end. Everything in there one setting at a
 * time, or one of these and done.
 *
 * A card is applied the way the person would have done it by hand - the
 * settings the theme names are written, the rest go back to the shipped
 * defaults - so there is no separate "a theme is active" state that could
 * disagree with the controls in the editing mode. Pick one, nudge a slider
 * afterwards, and the highlight simply goes out: the settings are the truth
 * and the cards are a view of it.
 *
 * The previews are drawn from each theme's own look rather than from a
 * picture, so they cannot go stale, and they carry the player's actual
 * furniture - an island, a cover, a play button - because a plain colour
 * swatch says nothing about what the look does to the app. */

export function ThemesSection() {
  const t = useT()
  return (
    <div className="mt-5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/35 px-1">{t('catThemes')}</p>
      <p className="text-[12px] text-white/45 leading-relaxed mt-1.5 mb-2.5 px-1">{t('themesSub')}</p>
      <ThemeGrid />
    </div>
  )
}

/* The cards themselves, shared by the settings tab and the editing mode's
   dock. Compact drops the captions: in a 240px column they wrap to three
   lines each and the grid turns into a wall of small print, and the names
   are enough once the previews are there. */
export function ThemeGrid({ compact }: { compact?: boolean }) {
  const t = useT()
  const s = useSettings()
  const { artRgb } = useUI()
  const showToast = useToast(st => st.show)
  const active = useMemo(() => activeThemeId(s as unknown as Record<string, unknown>), [s])

  const apply = (th: PlayerTheme) => {
    applyTheme(th)
    showToast(`${th.name} · ${t('themeApplied')}`, 'success')
  }

  return (
    <>
      <div className={`grid grid-cols-2 ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
        {THEMES.map(th => (
          <ThemeTile key={th.id} theme={th} active={active === th.id} artRgb={artRgb} compact={compact}
            restore={th.id === DEFAULT_THEME ? (s.themeBackup ?? currentLook(s as unknown as Record<string, unknown>)) : null}
            onClick={() => apply(th)} />
        ))}
      </div>

      {/* Only while the branch is up. A slider for a background that is not
          on screen is a control with nothing to move, and the theme that
          owns it is the one place anybody would look for it. */}
      {s.sakura && (
        <div className="mt-3 page-enter">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-white/80">{t('sakuraBlur')}</span>
            <span className="text-[11px] text-white/40 tabular-nums">{s.sakuraBlur} px</span>
          </div>
          <input
            type="range" min={0} max={30} step={1} value={s.sakuraBlur}
            onChange={e => s.setSakuraBlur(Number(e.target.value))}
            className="w-full" style={{ accentColor: 'var(--accent)' }}
          />

          {/* Only once there is a blur to extend. At zero this switch has
              nothing to turn on, and a dead control under a live slider
              reads as broken rather than as not applicable. */}
          {s.sakuraBlur > 0 && (
            <div className="flex items-center justify-between gap-3 mt-2.5 page-enter">
              <span className="text-sm text-white/80">{t('sakuraPetalsToo')}</span>
              <Toggle active={s.sakuraBlurPetals} onClick={() => s.setSakuraBlurPetals(!s.sakuraBlurPetals)} />
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ThemeTile({ theme, active, artRgb, restore, compact, onClick }: {
  theme: PlayerTheme; active: boolean; artRgb: number[]
  restore: Record<string, unknown> | null; compact?: boolean; onClick: () => void
}) {
  const lang = useSettings(s => s.lang)
  // Default previews what it would actually put back, not a factory look.
  const look = useMemo(() => themeLook(theme, restore), [theme, restore])
  const { ground, accent, glass } = useMemo(() => themeSwatch(look), [look])
  // An artwork-following look is previewed with the cover that is playing
  // right now, which is the most honest thing the card can show.
  const dot = look.accent === 'artwork' ? resolveAccentHex('artwork', look.customAccent ?? '#ff5500', artRgb) : accent
  const isVideo = !!theme.wallpaper && /\.(mp4|webm)$/i.test(theme.wallpaper)

  return (
    <button onClick={onClick} className="icon-btn text-left rounded-xl p-1.5 transition-all"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: active ? '1.5px solid rgba(var(--accent-rgb),0.65)' : '1px solid rgba(255,255,255,0.08)',
      }}>
      <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: '16 / 9', background: ground }}>
        {theme.wallpaper && (isVideo
          ? <video src={theme.wallpaper} autoPlay loop muted playsInline className="absolute inset-0 w-full h-full object-cover" />
          : <img src={theme.wallpaper} alt="" className="absolute inset-0 w-full h-full object-cover" />)}

        {/* See-through means see-through onto something: without a hint of a
            desktop under it a transparent look is just a dark rectangle,
            which is the one thing it is not. */}
        {glass && (
          <span className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(45deg,rgba(255,255,255,0.055) 0 7px,rgba(255,255,255,0) 7px 15px)',
          }} />
        )}

        {/* A moon and a few stars: the gradient alone is a blue rectangle, and
            what the theme is actually about is what hangs in it. */}
        {look.nightSky && (
          <>
            <span className="absolute rounded-full" style={{
              top: '24%', left: '22%', width: '13%', aspectRatio: '1',
              background: 'radial-gradient(circle,#fff 35%,#CBD8F2 70%,rgba(203,216,242,0))',
              boxShadow: '0 0 10px 4px rgba(203,216,242,0.28)',
            }} />
            {[[14, 26], [30, 16], [52, 34], [72, 20], [84, 44], [22, 48]].map(([x, y], i) => (
              <span key={i} className="absolute rounded-full" style={{
                left: `${x}%`, top: `${y}%`, width: 1.5, height: 1.5,
                background: '#fff', opacity: 0.25 + (i % 3) * 0.2,
              }} />
            ))}
          </>
        )}

        {/* The branch itself, mirrored into the corner it actually hangs in.
            It is blossom on black, so screen blending drops the black and
            leaves the flowers over whatever ground the theme sets - the same
            trick the real thing uses, by a different route. */}
        {look.sakura && (
          <img src={branchUrl} alt="" className="absolute top-0 left-0 h-full pointer-events-none"
            style={{ mixBlendMode: 'screen', opacity: 0.95 }} />
        )}

        {/* The weather, or Rain and Default would be the same card twice when
            the look under them happens to match: they differ in what falls
            through it. The slant follows the theme's own wind. */}
        {look.rain && (
          <>
            {look.rainClouds && <span className="absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg,rgba(190,200,225,0.16),rgba(190,200,225,0) 85%)' }} />}
            <span className="absolute inset-0" style={{
              background: `repeating-linear-gradient(${74 + (look.rainWind ?? 0.34) * 14}deg,rgba(255,255,255,0) 0 5px,rgba(255,255,255,0.16) 5px 6px)`,
              maskImage: 'linear-gradient(180deg,rgba(0,0,0,0.35),#000)',
            }} />
          </>
        )}

        {/* The player in miniature: the island, a cover, a play button. */}
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1"
          style={{
            background: glass ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.055)',
            border: `0.5px solid rgba(255,255,255,${glass ? 0.22 : 0.1})`,
            backdropFilter: 'blur(4px)',
          }}>
          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: `linear-gradient(135deg,${dot},rgba(255,255,255,0.08))` }} />
          <span className="flex-1 flex flex-col gap-[3px] min-w-0">
            <span className="h-[3px] rounded-full" style={{ width: '70%', background: 'rgba(255,255,255,0.34)' }} />
            <span className="h-[2px] rounded-full" style={{ width: '45%', background: 'rgba(255,255,255,0.16)' }} />
          </span>
          <span className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center"
            style={{ background: dot, boxShadow: look.iconGlow ? `0 0 7px ${dot}` : undefined }}>
            <svg className="w-2 h-2 ml-[0.5px]" viewBox="0 0 24 24" fill="rgba(0,0,0,0.65)"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>

      </div>

      <div className={compact ? 'px-0.5 pt-1 pb-px' : 'px-0.5 pt-1.5 pb-0.5'}>
        <div className="flex items-center justify-between gap-1">
          <span className={`${compact ? 'text-[11px]' : 'text-[12.5px]'} font-medium truncate`}
            style={{ color: active ? 'var(--accent)' : 'rgba(255,255,255,0.85)' }}>
            {theme.name}
          </span>
          {active && (
            <span className="w-3.5 h-3.5 rounded-full shrink-0 flex items-center justify-center" style={{ background: 'var(--accent)' }}>
              <svg className="w-2.5 h-2.5" viewBox="0 0 20 20" fill="#141019"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
            </span>
          )}
        </div>
        {!compact && <p className="text-[10.5px] text-white/35 leading-snug mt-0.5">{theme.caption[lang]}</p>}
      </div>
    </button>
  )
}
