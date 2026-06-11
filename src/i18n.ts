import { useSettings } from './store'

type Dict = Record<string, { ru: string; en: string }>

const DICT: Dict = {
  // Nav
  stream:        { ru: 'Лента',     en: 'Stream' },
  releases:      { ru: 'Релизы',    en: 'Releases' },
  releasesTitle: { ru: 'Новые релизы', en: 'New Releases' },
  loadingReleases:{ ru: 'Собираем релизы от ваших артистов...', en: 'Gathering releases from your artists...' },
  likes:         { ru: 'Лайки',     en: 'Likes' },
  playlists:     { ru: 'Плейлисты', en: 'Playlists' },
  search:        { ru: 'Поиск',     en: 'Search' },

  // Sidebar / common
  settings:      { ru: 'Настройки', en: 'Settings' },
  refreshLibrary:{ ru: 'Обновить библиотеку', en: 'Refresh library' },

  // NowPlaying
  nothingPlaying:{ ru: 'Ничего не играет', en: 'Nothing playing' },
  play:          { ru: 'Воспроизвести', en: 'Play' },
  pause:         { ru: 'Пауза',     en: 'Pause' },
  prev:          { ru: 'Назад',     en: 'Previous' },
  next:          { ru: 'Вперёд',    en: 'Next' },
  shuffle:       { ru: 'Перемешать', en: 'Shuffle' },
  repeat:        { ru: 'Повтор',    en: 'Repeat' },
  queue:         { ru: 'Очередь',   en: 'Queue' },
  trackDetails:  { ru: 'Детали трека', en: 'View track details' },
  fullscreen:    { ru: 'На весь экран', en: 'Fullscreen' },
  exitFullscreen:{ ru: 'Свернуть',   en: 'Exit fullscreen' },
  lyrics:        { ru: 'Текст',      en: 'Lyrics' },
  lyricsLoading: { ru: 'Загрузка текста...', en: 'Loading lyrics...' },
  lyricsNotFound:{ ru: 'Текст не найден', en: 'Lyrics not found' },
  scanLyrics:    { ru: 'Проверить тексты', en: 'Scan for lyrics' },

  // Queue panel
  queueEmpty:    { ru: 'Очередь пуста', en: 'Queue is empty' },
  nowPlaying:    { ru: 'Сейчас играет', en: 'Now playing' },
  upNext:        { ru: 'Следующие', en: 'Up next' },
  played:        { ru: 'Прослушано', en: 'Played' },

  // Track actions
  addNext:       { ru: 'Добавить следующим', en: 'Play next' },
  addToPlaylist: { ru: 'Добавить в плейлист', en: 'Add to playlist' },
  like:          { ru: 'Лайк',      en: 'Like' },
  unlike:        { ru: 'Убрать лайк', en: 'Unlike' },
  close:         { ru: 'Закрыть',   en: 'Close' },

  // Settings panel
  accentColor:   { ru: 'Цвет акцента', en: 'Accent Color' },
  vividArtwork:  { ru: 'Цвет с обложки', en: 'Vivid artwork color' },
  artworkChanges:{ ru: 'Цвет меняется с обложкой трека', en: 'Color follows the track artwork' },
  background:    { ru: 'Фон',       en: 'Background' },
  visualizer:    { ru: 'Визуализатор', en: 'Visualizer' },
  equalizer:     { ru: 'Эквалайзер', en: 'Equalizer' },
  eqReset:       { ru: 'Сбросить',  en: 'Reset' },
  language:      { ru: 'Язык',      en: 'Language' },
  discordRpc:    { ru: 'Статус в Discord', en: 'Discord status' },
  discordRpcSub: { ru: 'В разработке', en: 'In development' },
  account:       { ru: 'Аккаунт',   en: 'Account' },
  signOut:       { ru: 'Выйти',     en: 'Sign out' },

  // Playlists / lists
  newPlaylist:   { ru: 'Новый плейлист', en: 'New playlist' },
  playlistName:  { ru: 'Название плейлиста', en: 'Playlist name' },
  create:        { ru: 'Создать',   en: 'Create' },
  creating:      { ru: 'Создаём...', en: 'Creating...' },
  cancel:        { ru: 'Отмена',    en: 'Cancel' },
  playlistCreated:{ ru: 'Плейлист создан', en: 'Playlist created' },
  createPlaylistErr:{ ru: 'Не удалось создать плейлист', en: 'Could not create playlist' },
  sharingPublic: { ru: 'Публичный', en: 'Public' },
  sharingPrivate:{ ru: 'Приватный', en: 'Private' },
  deletePlaylist:{ ru: 'Удалить плейлист', en: 'Delete playlist' },
  deletePlaylistConfirm:{ ru: 'Удалить этот плейлист безвозвратно?', en: 'Delete this playlist permanently?' },
  typeNameToConfirm:{ ru: 'Введите название плейлиста для подтверждения', en: 'Type the playlist name to confirm' },
  delete:        { ru: 'Удалить',   en: 'Delete' },
  playlistDeleted:{ ru: 'Плейлист удалён', en: 'Playlist deleted' },
  deletePlaylistErr:{ ru: 'Не удалось удалить плейлист', en: 'Could not delete playlist' },
  noPlaylists:   { ru: 'Нет плейлистов', en: 'No playlists' },
  noPublicTracks:{ ru: 'Нет публичных треков', en: 'No public tracks' },
  noComments:    { ru: 'Пока нет комментариев', en: 'No comments yet' },
  loading:       { ru: 'Загрузка...', en: 'Loading...' },
  searching:     { ru: 'Поиск...',  en: 'Searching...' },
  recentReleases:{ ru: 'Последние релизы', en: 'Recent releases' },

  // Window
  minimize:      { ru: 'Свернуть',  en: 'Minimize' },
  maximize:      { ru: 'Развернуть', en: 'Maximize' },

  // Stats / lists
  plays:         { ru: 'прослуш.', en: 'plays' },
  likesLabel:    { ru: 'лайков',   en: 'likes' },
  reposts:       { ru: 'репостов', en: 'reposts' },
  comments:      { ru: 'коммент.', en: 'comments' },
  followers:     { ru: 'Подписчики', en: 'Followers' },
  following:     { ru: 'Подписки', en: 'Following' },
  follow:        { ru: 'Подписаться', en: 'Follow' },
  unfollow:      { ru: 'Вы подписаны', en: 'Following' },
  followErr:     { ru: 'Не удалось подписаться', en: 'Could not follow' },
  tracksLabel:   { ru: 'Треки',    en: 'Tracks' },
  searchPlaceholder: { ru: 'Искать треки, артистов...', en: 'Search tracks, artists...' },
  searchInPlaylist:  { ru: 'Искать в плейлисте', en: 'Search in playlist' },
  closeSearch:   { ru: 'Закрыть поиск', en: 'Close search' },
  newest:        { ru: 'Сначала новые', en: 'Newest' },
  oldest:        { ru: 'Сначала старые', en: 'Oldest' },
  empty:         { ru: 'Пусто',    en: 'Empty' },
  streamTitle:   { ru: 'Твоя лента', en: 'Your Stream' },
  likesTitle:    { ru: 'Любимые треки', en: 'Liked Tracks' },
  tracksWord:    { ru: 'треков',   en: 'tracks' },
  typeToSearch:  { ru: 'Начните вводить...', en: 'Type to search...' },
  nothingHere:   { ru: 'Пока пусто', en: 'Nothing here yet' },
  noPlaylistsYet:{ ru: 'Пока нет плейлистов', en: 'No playlists yet' },
  ofCount:       { ru: 'из',       en: 'of' },

  // Background styles
  bgDynamic:     { ru: 'Динамический', en: 'Dynamic' },
  bgDynamicSub:  { ru: 'Мягкий цвет с обложки', en: 'Subtle color from artwork' },
  bgAccent:      { ru: 'Акцент',   en: 'Accent' },
  bgAccentSub:   { ru: 'Градиент в цвет акцента', en: 'Radial gradient in accent color' },
  bgAurora:      { ru: 'Аврора',   en: 'Aurora' },
  bgAuroraSub:   { ru: 'Анимированный градиент', en: 'Animated accent gradient' },
  bgMidnight:    { ru: 'Полночь',  en: 'Midnight' },
  bgMidnightSub: { ru: 'Холодный тёмный градиент', en: 'Cool dark gradient' },
  bgDark:        { ru: 'Тёмный',   en: 'Solid dark' },
  bgDarkSub:     { ru: 'Чистый чёрный', en: 'Pure black' },

  // Visualizer styles
  vizBars:       { ru: 'Полосы',   en: 'Bars' },
  vizBarsSub:    { ru: 'Классические полосы частот', en: 'Classic frequency bars' },
  vizWave:       { ru: 'Волна',    en: 'Wave' },
  vizWaveSub:    { ru: 'Плавная волна', en: 'Smooth waveform' },
  vizMirror:     { ru: 'Зеркало',  en: 'Mirror' },
  vizMirrorSub:  { ru: 'Симметричные полосы', en: 'Symmetric bars' },

  // Errors / toasts
  errDrm:        { ru: 'Защищён DRM', en: 'DRM protected' },
  errNoStream:   { ru: 'Недоступен (геоблокировка или удалён)', en: 'Unavailable (geo-blocked or removed)' },
  errLoad:       { ru: 'Не удалось загрузить', en: 'Failed to load' },
  errPlay:       { ru: 'Не удалось воспроизвести трек', en: 'Could not play track' },
  errUnlike:     { ru: 'Не удалось убрать лайк', en: 'Could not remove like' },
  errLike:       { ru: 'Не удалось поставить лайк', en: 'Could not like' },
  toastLiked:    { ru: 'Лайк',      en: 'Liked' },
  toastQueued:   { ru: 'В очередь', en: 'Queued' },
  toastRemoved:  { ru: 'Удалено',   en: 'Removed' },
  openingSC:     { ru: 'Открываем SoundCloud...', en: 'Opening SoundCloud...' },
  loadingProfile:{ ru: 'Загружаем профиль...', en: 'Loading profile...' },

  // Context menu
  ctxPlay:       { ru: 'Воспроизвести', en: 'Play' },
  ctxAddNext:    { ru: 'Играть следующим', en: 'Play next' },
  ctxAddPlaylist:{ ru: 'В плейлист', en: 'Add to playlist' },
  ctxGoArtist:   { ru: 'К артисту', en: 'Go to artist' },
  ctxCopyLink:   { ru: 'Копировать ссылку', en: 'Copy link' },
  ctxOpenBrowser:{ ru: 'Открыть в браузере', en: 'Open in browser' },
  linkCopied:    { ru: 'Ссылка скопирована', en: 'Link copied' },

  // Comments / time
  commentsHeader:{ ru: 'Комментарии', en: 'Comments' },
  today:         { ru: 'сегодня',  en: 'today' },
  yesterday:     { ru: 'вчера',    en: 'yesterday' },
  daysAgo:       { ru: 'дн. назад', en: 'd ago' },
  monthsAgo:     { ru: 'мес. назад', en: 'mo ago' },
  yearsAgo:      { ru: 'г. назад', en: 'y ago' },
  atTime:        { ru: 'на',       en: 'at' },

  // Login
  tagline:       { ru: 'Твоя музыка, красиво.', en: 'Your music, beautifully.' },
  signIn:        { ru: 'Войти',     en: 'Sign in' },
  signInHint:    { ru: 'Откроется окно браузера — войди как обычно.', en: 'A browser window opens — sign in as usual.' },
  signInWithSC:  { ru: 'Войти через SoundCloud', en: 'Sign in with SoundCloud' },
  connecting:    { ru: 'Подключаемся...', en: 'Connecting...' },
}

export type TKey = keyof typeof DICT

export function useT() {
  const lang = useSettings(s => s.lang)
  return (key: TKey) => DICT[key]?.[lang] ?? key
}

// Standalone translate for non-component / async contexts (reads current lang)
export function translate(key: TKey): string {
  const lang = useSettings.getState().lang
  return DICT[key]?.[lang] ?? key
}

// Localized relative time (uses current language)
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return translate('today')
  if (d === 1) return translate('yesterday')
  if (d < 30) return `${d} ${translate('daysAgo')}`
  if (d < 365) return `${Math.floor(d / 30)} ${translate('monthsAgo')}`
  return `${Math.floor(d / 365)} ${translate('yearsAgo')}`
}
