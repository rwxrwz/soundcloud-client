import { SETTINGS_DEFAULTS, RAIN_SKY, resolveAccentHex, hexToRgb, seasonActive, useSettings, type Lang, type Season, type SettingsState } from './store'
import { BUNDLED_WALLPAPER } from './services/net'

/* Ready-made looks, one click each.
 *
 * ── Adding a theme ───────────────────────────────────────────────────────
 * Append an entry to THEMES. Only the deviations go in `look`; everything a
 * theme does not mention is reset to the shipped defaults, so switching
 * themes can never leave half of the previous one behind.
 *
 *   { id: 'ocean', name: 'Ocean',
 *     caption: { ru: '...', en: '...', uk: '...' },
 *     look: { accent: 'cyan', bgStyle: 'aurora', iconGlow: false } }
 *
 * Any colour at all, not just the twelve in the palette:
 *
 *   look: { accent: 'custom', customAccent: '#f8a3c0' }
 *
 * A wallpaper, animated or still, shipped with the app - drop the file in
 * src/assets, import it at the top, and name it. The bundler rewrites the
 * import into a URL, the marker tells the player this one is not from the
 * user's wallpapers folder, and bgStyle/wallpaperPath are set for you:
 *
 *   import ocean from './assets/ocean.webm'
 *   { id: 'ocean', name: 'Ocean', caption: {...}, wallpaper: ocean,
 *     look: { accent: 'cyan' } }
 *
 * Nothing else needs touching: the card's preview is drawn from `look`, so a
 * new theme arrives with a preview that already matches what it does, and the
 * highlight on it is derived by comparison rather than stored, so it lights up
 * whenever the live settings happen to match and goes out after one edit.
 *
 * ── What a theme may touch ───────────────────────────────────────────────
 * The look: background, accent, icon glow, the window's translucency, the
 * weather, and the player style, since a look can be worth seeing full
 * screen. Not the language, not playback, not the tray, not the seasonal
 * mode - those are decisions about how the app behaves, and somebody picking
 * a colour scheme has not asked to have them reconsidered. Whatever a theme
 * is allowed to change has to be in LOOK_KEYS, or Default cannot put it back. */

export interface PlayerTheme {
  id: string
  /** Shown as-is: a theme name is a proper noun, not a phrase to translate. */
  name: string
  caption: Record<Lang, string>
  /** Optional bundled image or video; implies bgStyle 'wallpaper'. */
  wallpaper?: string
  look: Partial<SettingsState>
}

/* The look surface, in full. A theme sets some of these; the rest come from
   the shipped defaults, which makes Default-with-nothing-to-restore the empty
   theme rather than a hand-copied list of values that could fall behind the
   real defaults.
   Deliberately colours, backgrounds and weather only. The sidebar's width
   used to be in here, inherited from when it was half of a "player style",
   and it meant picking a colour scheme silently rearranged the window. How
   wide the rail is is a decision about how you use the app, not about how
   it looks, so no theme touches it. */
const LOOK_KEYS = [
  'theme', 'bgStyle', 'accent', 'wallpaperPath', 'fsLiveBg', 'iconGlow',
  'rain', 'rainTheme', 'rainThemePrev', 'rainClouds', 'rainSurfaces', 'rainLens',
  'sakura', 'nightSky',
] as const

/* What Default remembers is wider than what a theme resets, and customAccent
   is why. It is the person's own colour: a theme that never mentions it must
   not reset it to the shipped orange, so it stays out of the reset above -
   but a theme is free to set a colour of its own, and then Default has to be
   able to give the old one back, so it is remembered here. The seasonal mode
   is in for the same reason once removed: no theme sets it, but a theme that
   brings weather has to switch winter off (see applyTheme), and Default owes
   the person their December back. */
const SNAPSHOT_KEYS = [...LOOK_KEYS, 'customAccent', 'season'] as const

const BASE = Object.fromEntries(
  LOOK_KEYS.map(k => [k, SETTINGS_DEFAULTS[k as keyof typeof SETTINGS_DEFAULTS]]),
) as Partial<SettingsState>

export const DEFAULT_THEME = 'default'

export const THEMES: PlayerTheme[] = [
  {
    /* Not "the factory look" - the way out. It hands back the arrangement
       that was there before the first theme was applied, which is the thing
       somebody who tried one actually wants back. With nothing to hand back
       (no theme has been tried yet) it is simply where you already are. */
    id: DEFAULT_THEME,
    name: 'Default',
    caption: {
      ru: 'Оформление, каким оно было до выбора темы',
      en: 'Your look as it was before you picked a theme',
      uk: 'Оформлення, яким воно було до вибору теми',
    },
    look: {},
  },
  {
    id: 'rain',
    name: 'Rain',
    caption: {
      ru: 'Гроза и её палитра',
      en: 'A storm, and the palette to match',
      uk: 'Гроза і її палітра',
    },
    look: {
      rain: true, rainClouds: true, rainSurfaces: true, rainLens: false,
      // The storm's own palette, the one the rain switch sets for itself.
      rainTheme: true, accent: 'slate', bgStyle: 'aurora', iconGlow: true,
    },
  },
  {
    id: 'sakura',
    name: 'Sakura',
    caption: {
      ru: 'Ветка на ветру и падающие лепестки',
      en: 'A branch in the wind, shedding petals',
      uk: 'Гілка на вітрі й пелюстки, що падають',
    },
    look: {
      sakura: true, bgStyle: 'aurora', rainTheme: false, fsLiveBg: false, iconGlow: true,
      // Taken off the photograph itself - the lit side of its blossom - and
      // lifted just enough to hold up as an accent on dark glass.
      accent: 'custom', customAccent: '#EE94A6',
    },
  },
  {
    id: 'latenight',
    name: 'Late Night',
    caption: {
      ru: 'Облака плывут сквозь звёзды мимо луны',
      en: 'Clouds drifting through the stars, past the moon',
      uk: 'Хмари пливуть крізь зорі повз місяць',
    },
    look: {
      nightSky: true, bgStyle: 'aurora', rainTheme: false, fsLiveBg: false, iconGlow: true,
      // Moonlight on dark glass: enough blue to belong to the sky behind it,
      // enough lift to still read as an accent.
      accent: 'custom', customAccent: '#9BB0D8',
    },
  },
]

/** Everything a theme sets, defaults filled in, wallpaper resolved.
 *
 *  Default is the odd one: its look is whatever was there before a theme was
 *  picked, so the caller passes that in - the snapshot if one was taken, the
 *  live look if none was, which makes Default-with-nothing-to-restore a card
 *  that says "you are already here" and does nothing when pressed. Falling
 *  back to the shipped defaults instead would quietly throw away a look
 *  somebody built by hand and never called a theme. */
export function themeLook(t: PlayerTheme, restore?: Record<string, unknown> | null): Partial<SettingsState> {
  return {
    ...BASE,
    ...(t.id === DEFAULT_THEME ? (restore ?? {}) as Partial<SettingsState> : t.look),
    ...(t.wallpaper
      ? { bgStyle: 'wallpaper' as const, wallpaperPath: BUNDLED_WALLPAPER + t.wallpaper }
      : {}),
  }
}

/** The look as it stands right now, over exactly the keys a theme owns. */
export function currentLook(s: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {}
  for (const k of SNAPSHOT_KEYS) o[k] = s[k]
  return JSON.parse(JSON.stringify(o)) as Record<string, unknown>
}

/** Apply a theme, keeping the one snapshot Default lives on. */
export function applyTheme(t: PlayerTheme) {
  const st = useSettings.getState()
  const s = st as unknown as Record<string, unknown>
  const mine = (st.themeBackup ?? currentLook(s)) as Record<string, unknown>
  if (t.id === DEFAULT_THEME) {
    useSettings.setState({ ...themeLook(t, mine), themeBackup: null })
    return
  }
  const look = themeLook(t)
  /* One sky at a time, the same rule the switches keep: a theme that brings
     its own weather cannot land on top of winter. The night sky is the
     exception - snow falling through it is the point - and the season that
     gets switched off here is in the snapshot above, so Default gives it
     back along with everything else. */
  const winter = (look.rain || look.sakura) && seasonActive(st.season)
  useSettings.setState({ ...look, ...(winter ? { season: 'off' as Season } : {}), themeBackup: mine })
}

/** The card to light up, or none. A theme matches when every key it sets
 *  still agrees with the live settings, so one edit afterwards puts the
 *  highlight out; with no snapshot taken, nothing has been applied over the
 *  person's own look yet, and that is what Default stands for. */
export function activeThemeId(s: Record<string, unknown>): string | null {
  for (const t of THEMES) {
    if (t.id === DEFAULT_THEME) continue
    const look = themeLook(t)
    if (Object.entries(look).every(([k, v]) => JSON.stringify(s[k]) === JSON.stringify(v))) return t.id
  }
  return s.themeBackup ? null : DEFAULT_THEME
}

/** What the card should paint, worked out from the look itself rather than
 *  from a swatch written by hand beside it - the preview of a theme nobody
 *  has looked at in a year is still the theme. */
export function themeSwatch(look: Partial<SettingsState>): { ground: string; accent: string; glass: boolean } {
  // 'artwork' has no fixed colour: stand in with the dusty plum a cover
  // usually averages out to, the same stand-in the welcome screen uses.
  const accent = resolveAccentHex(look.accent ?? 'slate', look.customAccent ?? '#ff5500', [176, 108, 132])
  const glass = look.theme === 'transparent'
  const sky = hexToRgb(look.rainTheme ? RAIN_SKY : accent).join(',')
  const [r, g, b] = hexToRgb(accent)

  let ground: string
  // The night sky paints its own background over everything, so the card has
  // to show that rather than whatever bgStyle is nominally set underneath.
  if (look.nightSky) ground = 'linear-gradient(180deg,#050A1A 0%,#1C2B4D 100%)'
  else if (glass) ground = `rgba(10,10,14,${1 - (look.transparencyLevel ?? 80) / 100})`
  else switch (look.bgStyle) {
    // The aurora, frozen: same gradient as .aurora-bg, no animation, because
    // a card is 90px wide and a drifting one is a timer for nothing.
    case 'aurora': ground = `linear-gradient(125deg,#060608 0%,rgba(${sky},0.5) 25%,#080810 45%,rgba(${sky},0.62) 65%,#060608 90%)`; break
    case 'accent': ground = `radial-gradient(ellipse at 25% 35%,rgb(${r},${g},${b}) 0%,rgba(${r},${g},${b},0.3) 45%,#0a0a0f 75%)`; break
    default: ground = `radial-gradient(ellipse at 25% 35%,rgba(${r},${g},${b},0.8) 0%,rgba(${r},${g},${b},0.26) 45%,#0a0a0f 75%)`
  }
  return { ground, accent, glass }
}
