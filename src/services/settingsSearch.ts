/* Finding a setting by typing its name.
 *
 * The index is written by hand rather than scraped off the rendered panel,
 * for two reasons. Only one tab is mounted at a time, so a DOM sweep could
 * only ever find the tab you are already looking at - which is the one case
 * where search is useless. And half the settings are not in the panel at
 * all: accent, background, rain, seasons, themes and the fullscreen layout
 * moved into the editing mode, and those are exactly the ones people hunt
 * for. An index can name both; the DOM cannot.
 *
 * The cost is that a new setting has to be added here too. That is the
 * trade: a list that can go stale, in exchange for a search that covers the
 * whole player instead of a quarter of it.
 */

import { allOf, type TKey } from '../i18n'

/** Where a result lives, and therefore what clicking it has to do. */
export type Place =
  /** A tab of the settings panel. `anchor` is the row to scroll to and flash. */
  | { kind: 'tab'; tab: TabId; anchor?: string }
  /** The editing mode: pick a region, open a group. */
  | { kind: 'edit'; region: EditRegion; fold?: string }

export type TabId = 'profile' | 'sound' | 'lyrics' | 'system' | 'remote' | 'versions' | 'info'
export type EditRegion = 'sidebar' | 'content' | 'dock'

export interface SettingEntry {
  id: string
  /** What the row is called where it lives. Matched in all three languages. */
  label: TKey
  /** The line under it, if it has one. Matched, but worth less. */
  note?: TKey
  /** Breadcrumb above the result. */
  section?: TKey
  place: Place
  /** Words nobody put in the label but everybody types. Any language. */
  also?: string[]
}

/* Ordered the way the panel is, so an index read top to bottom is a tour of
   the settings. Within a tab, the order the rows appear in. */
export const SETTINGS_INDEX: SettingEntry[] = [
  // ── Account ───────────────────────────────────────────────────────────
  { id: 'stats', label: 'stListening', section: 'catAccount', place: { kind: 'tab', tab: 'profile', anchor: 'stats' },
    also: ['статистика', 'stats', 'часы', 'hours', 'серия', 'streak', 'топ артистов', 'top artists', 'прослушано'] },
  { id: 'lang', label: 'language', section: 'catSystem', place: { kind: 'tab', tab: 'system', anchor: 'lang' },
    also: ['язык', 'language', 'мова', 'русский', 'english', 'українська', 'перевод'] },
  { id: 'profile', label: 'openProfile', section: 'catAccount', place: { kind: 'tab', tab: 'profile' },
    also: ['профиль', 'profile', 'аккаунт'] },
  { id: 'signout', label: 'signOut', section: 'account', place: { kind: 'tab', tab: 'profile', anchor: 'signout' },
    also: ['выйти', 'logout', 'sign out', 'разлогиниться'] },

  // ── Sound ─────────────────────────────────────────────────────────────
  { id: 'device', label: 'outputDevice', section: 'catSound', place: { kind: 'tab', tab: 'sound', anchor: 'device' },
    also: ['наушники', 'колонки', 'headphones', 'speakers', 'вывод', 'output'] },
  { id: 'crossfade', label: 'crossfade', note: 'crossfadeSub', section: 'catSound', place: { kind: 'tab', tab: 'sound', anchor: 'crossfade' },
    also: ['кроссфейд', 'crossfade', 'переход', 'плавно', 'fade'] },
  { id: 'eq', label: 'equalizer', section: 'catSound', place: { kind: 'tab', tab: 'sound', anchor: 'eq' },
    also: ['эквалайзер', 'equalizer', 'eq', 'бас', 'bass', 'частоты', 'низкие', 'высокие'] },
  { id: 'eqpresets', label: 'eqPresets', section: 'equalizer', place: { kind: 'tab', tab: 'sound', anchor: 'eq' },
    also: ['пресет', 'preset', 'пресеты эквалайзера'] },

  // ── Lyrics ────────────────────────────────────────────────────────────
  { id: 'timing', label: 'tmTitle', section: 'catLyrics', place: { kind: 'tab', tab: 'lyrics', anchor: 'timing' },
    also: ['тайминги', 'таймкоды', 'timings', 'ai', 'ии', 'нейросеть', 'gemini', 'синхронизация'] },
  { id: 'model', label: 'lyModelMissing', note: 'lyModelWhy', section: 'tmTitle', place: { kind: 'tab', tab: 'lyrics', anchor: 'timing' },
    also: ['модель', 'model', 'локально', 'local', 'onnx', 'скачать модель'] },
  { id: 'aikey', label: 'aiKeyStored', section: 'tmTitle', place: { kind: 'tab', tab: 'lyrics', anchor: 'timing' },
    also: ['ключ', 'key', 'gemini', 'api', 'токен'] },
  { id: 'lyinfo', label: 'lyInfo', note: 'lyInfoSub', section: 'catLyrics', place: { kind: 'tab', tab: 'lyrics', anchor: 'timing' },
    also: ['подпись', 'источник текста'] },
  { id: 'lycache', label: 'lyCache', section: 'catLyrics', place: { kind: 'tab', tab: 'lyrics', anchor: 'lycache' },
    also: ['кэш', 'cache', 'очистить', 'clear', 'место'] },
  { id: 'genius', label: 'gnTitle', section: 'catLyrics', place: { kind: 'tab', tab: 'lyrics', anchor: 'genius' },
    also: ['genius', 'гениус', 'токен', 'token'] },

  // ── System ────────────────────────────────────────────────────────────
  { id: 'date', label: 'dateTitle', section: 'catSystem', place: { kind: 'tab', tab: 'system', anchor: 'date' },
    also: ['дата', 'date', 'формат', 'format'] },
  { id: 'startpage', label: 'startPage', section: 'catSystem', place: { kind: 'tab', tab: 'system', anchor: 'startpage' },
    also: ['стартовая', 'start', 'запуск', 'главная'] },
  { id: 'tray', label: 'closeToTray', section: 'behavior', place: { kind: 'tab', tab: 'system', anchor: 'tray' },
    also: ['трей', 'tray', 'свернуть', 'закрыть', 'minimize'] },
  { id: 'mediakeys', label: 'mediaKeys', section: 'behavior', place: { kind: 'tab', tab: 'system', anchor: 'mediakeys' },
    also: ['медиа клавиши', 'media keys', 'кнопки', 'клавиатура', 'hotkeys'] },
  { id: 'radio', label: 'autoRadio', note: 'autoRadioNote', section: 'behavior', place: { kind: 'tab', tab: 'system', anchor: 'radio' },
    also: ['радио', 'radio', 'автоплей', 'autoplay', 'похожие', 'similar', 'продолжать'] },
  { id: 'startup', label: 'launchAtStartup', section: 'behavior', place: { kind: 'tab', tab: 'system', anchor: 'startup' },
    also: ['автозапуск', 'startup', 'при включении'] },
  { id: 'drm', label: 'autoSkipDrm', section: 'behavior', place: { kind: 'tab', tab: 'system', anchor: 'drm' },
    also: ['drm', 'пропуск', 'skip', 'недоступные'] },
  { id: 'datadome', label: 'datadomeBypass', section: 'behavior', place: { kind: 'tab', tab: 'system', anchor: 'datadome' },
    also: ['datadome', 'капча', 'captcha', 'лайки не ставятся'] },
  { id: 'discord', label: 'discordRpc', note: 'discordRpcNote', section: 'behavior', place: { kind: 'tab', tab: 'system', anchor: 'discord' },
    also: ['дискорд', 'discord', 'статус', 'status', 'rpc', 'присутствие'] },
  { id: 'shortcuts', label: 'shortcuts', section: 'catSystem', place: { kind: 'tab', tab: 'system', anchor: 'shortcuts' },
    also: ['горячие клавиши', 'shortcuts', 'hotkeys', 'сочетания'] },
  { id: 'presets', label: 'settingsPresetsTitle', note: 'settingsPresetsSub', section: 'catSystem', place: { kind: 'tab', tab: 'system', anchor: 'presets' },
    also: ['пресет', 'preset', 'сохранить настройки', 'поделиться настройками'] },
  { id: 'reset', label: 'resetSettings', section: 'catSystem', place: { kind: 'tab', tab: 'system', anchor: 'reset' },
    also: ['сброс', 'reset', 'по умолчанию', 'default'] },

  // ── Remote ────────────────────────────────────────────────────────────
  { id: 'bot', label: 'remoteToken', note: 'remoteTokenHint', section: 'catRemote', place: { kind: 'tab', tab: 'remote' },
    also: ['телеграм', 'telegram', 'бот', 'bot', 'пульт', 'remote', 'управление'] },
  { id: 'miniapp', label: 'miniTitle', note: 'miniHint', section: 'catRemote', place: { kind: 'tab', tab: 'remote', anchor: 'miniapp' },
    also: ['мини приложение', 'mini app', 'miniapp', 'телеграм', 'telegram', 'туннель', 'tunnel', 'cloudflared'] },
  { id: 'whitelist', label: 'remoteWhitelist', note: 'remoteWhitelistHint', section: 'catRemote', place: { kind: 'tab', tab: 'remote' },
    also: ['доступ', 'access', 'кому можно', 'whitelist'] },

  // ── Versions ──────────────────────────────────────────────────────────
  { id: 'updates', label: 'versionsCurrent', section: 'catVersions', place: { kind: 'tab', tab: 'versions' },
    also: ['обновление', 'update', 'версия', 'version', 'релиз', 'changelog'] },

  // ── Editing mode: the sidebar ─────────────────────────────────────────
  { id: 'sbwidth', label: 'sbWidth', note: 'sbWideSub', section: 'vcSidebar', place: { kind: 'edit', region: 'sidebar' },
    also: ['сайдбар', 'sidebar', 'ширина', 'width', 'узкий', 'широкий', 'рейл'] },
  { id: 'sbtabs', label: 'sidebarTabs', section: 'vcSidebar', place: { kind: 'edit', region: 'sidebar' },
    also: ['вкладки', 'tabs', 'разделы', 'друзья', 'скрыть'] },

  // ── Editing mode: the main area ───────────────────────────────────────
  { id: 'bg', label: 'background', section: 'vcContent', place: { kind: 'edit', region: 'content', fold: 'bg' },
    also: ['фон', 'background', 'обложка', 'artwork', 'аврора', 'aurora'] },
  { id: 'wallpaper', label: 'videoWallpapers', note: 'wallpapersHint', section: 'background', place: { kind: 'edit', region: 'content', fold: 'bg' },
    also: ['обои', 'wallpaper', 'картинка', 'видео', 'блюр', 'blur', 'размытие'] },
  { id: 'livebg', label: 'fsLiveBg', section: 'background', place: { kind: 'edit', region: 'content', fold: 'bg' },
    also: ['живой фон', 'living', 'анимация фона'] },
  { id: 'rain', label: 'rainLabel', section: 'vcContent', place: { kind: 'edit', region: 'content', fold: 'rain' },
    also: ['дождь', 'rain', 'гроза', 'storm', 'молния', 'lightning', 'капли', 'тучи'] },
  { id: 'layout', label: 'fsLayoutLabel', section: 'vcContent', place: { kind: 'edit', region: 'content', fold: 'text' },
    also: ['раскладка', 'layout', 'текст', 'lyrics', 'размер текста', 'font'] },
  { id: 'season', label: 'seasonTitle', section: 'vcContent', place: { kind: 'edit', region: 'content', fold: 'season' },
    also: ['сезон', 'season', 'снег', 'snow', 'ёлка', 'елка', 'tree', 'гирлянда', 'garland', 'новый год', 'christmas'] },

  // ── Editing mode: window-wide ─────────────────────────────────────────
  { id: 'themes', label: 'catThemes', section: 'vcWindowWide', place: { kind: 'edit', region: 'dock', fold: 'themes' },
    also: ['темы', 'themes', 'оформление', 'sakura', 'сакура', 'late night', 'rain'] },
  { id: 'accent', label: 'accentColor', section: 'vcWindowWide', place: { kind: 'edit', region: 'dock' },
    also: ['акцент', 'accent', 'цвет', 'color', 'палитра', 'оранжевый', 'hex'] },
  /* No fold named here on purpose: the hex fold is only mounted while the
     accent is already 'custom', so naming it sent the dock looking for
     something that is usually not there and the result did nothing at all.
     The accent area is where the Custom button is, which is the step the
     person has to take anyway. */
  { id: 'hex', label: 'accentCustom', section: 'accentColor', place: { kind: 'edit', region: 'dock' },
    also: ['свой цвет', 'custom', 'hex', 'пипетка'] },
  { id: 'transparent', label: 'themeTransparent', note: 'themeTransparentSub', section: 'vcWindowWide', place: { kind: 'edit', region: 'dock' },
    also: ['прозрачность', 'transparent', 'стекло', 'glass', 'сквозь'] },
  { id: 'glow', label: 'iconGlow', section: 'vcWindowWide', place: { kind: 'edit', region: 'dock' },
    also: ['свечение', 'glow', 'иконки', 'icons'] },
]

/* ── matching ──────────────────────────────────────────────────────────── */

/* The two keyboard layouts, position for position. Typing "lbcrjhl" with the
   layout left on English is not a typo and not a different query - it is
   "дискорд" with the wrong hat on, and the player knows which hat. */
const EN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,."
const RU_KEYS = 'йцукенгшщзхъфывапролджэячсмитьбю'

function swapLayout(s: string): string {
  let out = ''
  let changed = false
  for (const ch of s) {
    const i = EN_KEYS.indexOf(ch)
    if (i >= 0) { out += RU_KEYS[i]; changed = true; continue }
    const j = RU_KEYS.indexOf(ch)
    if (j >= 0) { out += EN_KEYS[j]; changed = true; continue }
    out += ch
  }
  return changed ? out : ''
}

/** Lowercase, and ё folded into е so one spelling of "ёлка" is enough. */
function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}

/* Russian declines, and the label is only ever written one way. "Тема" will
   not be found inside "Темы" by any amount of substring matching, and asking
   people to guess the case the developer happened to use is not a search.
   Words that agree to their stem and part ways in the tail are the same word,
   so a shared prefix counts - as long as the disagreement really is a tail
   (two characters at most) and the stem is long enough to mean something. */
function stemMatch(hay: string, needle: string): boolean {
  if (needle.length < 3) return false
  for (const word of hay.split(' ')) {
    let i = 0
    while (i < word.length && i < needle.length && word[i] === needle[i]) i++
    /* Measured against the shorter of the two, because the disagreement is
       a tail on whichever word has one: "обоями" against "обои" shares
       three of the four characters that exist to be shared. */
    if (i >= 3 && i >= Math.min(word.length, needle.length) - 2) return true
  }
  return false
}

/* Every character of `needle`, in order and close together, somewhere in
 * `hay`. This is what catches "крсфд" for "кроссфейд" - and, without the
 * second half of that sentence, also catches seven characters of noise in
 * any long enough description, because a long string contains almost every
 * short sequence somewhere. Keeping the matched span near the length of what
 * was typed is what separates an abbreviation from a coincidence. */
function subsequence(hay: string, needle: string): boolean {
  if (needle.length < 3 || needle.length > 8) return false
  /* Three different characters at least. A held-down key produces a string
     that is trivially a subsequence of any text long enough to contain that
     letter a few times, and no abbreviation is one letter repeated. */
  if (new Set(needle).size < 3) return false
  let i = 0
  let first = -1
  for (let k = 0; k < hay.length; k++) {
    if (hay[k] !== needle[i]) continue
    if (first < 0) first = k
    if (++i === needle.length) return k - first + 1 <= needle.length * 3
  }
  return false
}

/* One token against one string. The ladder is about where the match sits,
   not how much of the string it covers: a word that STARTS with what you
   typed is what you meant far more often than one that merely contains it
   somewhere in the middle. */
function score(hay: string, needle: string): number {
  if (!hay || !needle) return 0
  if (hay === needle) return 100
  const i = hay.indexOf(needle)
  if (i === 0) return 80
  if (i > 0) return hay[i - 1] === ' ' ? 62 : 44
  if (stemMatch(hay, needle)) return 55
  return subsequence(hay, needle) ? 18 : 0
}

/** Best score for one token across a weighted set of haystacks. */
function tokenScore(e: SettingEntry, token: string): number {
  let best = 0
  for (const s of allOf(e.label)) best = Math.max(best, score(norm(s), token))
  if (e.also) for (const s of e.also) best = Math.max(best, score(norm(s), token) * 0.86)
  if (e.section) for (const s of allOf(e.section)) best = Math.max(best, score(norm(s), token) * 0.5)
  if (e.note) for (const s of allOf(e.note)) best = Math.max(best, score(norm(s), token) * 0.42)
  return best
}

export interface Hit { entry: SettingEntry; score: number }

/** Entries matching `query`, best first. Empty query gives nothing - the
 *  panel shows its tabs then, not a list of everything. */
export function searchSettings(query: string, limit = 14): Hit[] {
  const raw = norm(query)
  if (raw.length < 2) return []

  /* Both readings of what was typed, scored separately and the better one
     kept. Running them together would let a half-match in the wrong layout
     outrank a real one. */
  const swapped = norm(swapLayout(raw))
  const readings = swapped && swapped !== raw ? [raw, swapped] : [raw]

  const hits: Hit[] = []
  for (const e of SETTINGS_INDEX) {
    let best = 0
    for (const reading of readings) {
      /* Every word has to find something, and the weakest one sets the
         score: "статус дискорд" should rank the Discord row, not every row
         that happens to contain "статус". */
      let worst = Infinity
      for (const token of reading.split(' ')) {
        if (!token) continue
        const s = tokenScore(e, token)
        if (s === 0) { worst = 0; break }
        worst = Math.min(worst, s)
      }
      if (worst !== Infinity) best = Math.max(best, worst)
    }
    if (best > 0) hits.push({ entry: e, score: best })
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

/** The parts of `text` to draw plain and to draw lit, for one query.
 *  Returns a flat list; odd indexes are the matched pieces. */
export function highlight(text: string, query: string): string[] {
  const hay = norm(text)
  const tokens = [norm(query), norm(swapLayout(norm(query)))]
    .filter(Boolean)
    .flatMap(r => r.split(' '))
    .filter(tok => tok.length >= 2 && hay.includes(tok))
    .sort((a, b) => b.length - a.length)
  if (!tokens.length) return [text]

  /* Mark the characters each token covers, then cut the original string on
     the boundaries. Marking rather than splitting because two tokens can
     overlap, and cutting one then the other would lose the second. */
  const lit = new Array<boolean>(text.length).fill(false)
  for (const tok of tokens) {
    let from = hay.indexOf(tok)
    while (from >= 0) {
      for (let i = from; i < from + tok.length && i < lit.length; i++) lit[i] = true
      from = hay.indexOf(tok, from + tok.length)
    }
  }

  /* Segments alternate false, true, false... from the first character, so
     even indexes are plain and odd ones are lit without any bookkeeping -
     a string that starts lit simply gets an empty piece in front of it. */
  const out: string[] = []
  let buf = ''
  let on = false
  for (let i = 0; i < text.length; i++) {
    if (lit[i] !== on) { out.push(buf); buf = ''; on = lit[i] }
    buf += text[i]
  }
  out.push(buf)
  return out
}
