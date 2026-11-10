// Telegram remote control.
//
// Lives in the main process so it keeps working while the window is hidden in
// the tray. It is a mirror plus a relay, exactly like the companion bridge: the
// renderer's store stays the single source of truth, this file only renders the
// latest snapshot into a message and forwards taps back as player commands.

import { callApi, TgPoller, TgError, type TgUpdate, type TgUser, type PollStatus } from './tgApi'

export interface RemoteConfig {
  enabled: boolean
  allowed: number[]          // Telegram user ids allowed to drive the player
  /* The one card per chat, as chatId -> messageId.
     Held on disk rather than only in memory because a card outlives the
     process that sent it: it sits in the chat carrying a button for a
     tunnel address that died with the player. The in-memory map was
     cleared on stop without deleting anything, so the next launch knew
     nothing about it, /start sent a second card, and a chat collected one
     dead button per run. Remembered here, the next launch clears it. */
  cards?: Record<string, number>
}

export interface RemoteStatus {
  state: 'off' | 'no-token' | 'starting' | 'online' | 'bad-token' | 'conflict' | 'network'
  botUsername?: string
  detail?: string
  allowed: number[]
  pending: { id: number; name: string } | null
}

export interface RemoteCommand {
  action: 'toggle' | 'next' | 'prev' | 'seek' | 'volume' | 'shuffle' | 'repeat' | 'playQueueIndex' | 'playTrackId'
  value?: number | boolean | string
}

/* 'search' looks through what the person already has; 'global' asks
   SoundCloud. Two kinds rather than a flag, because they are answered by
   different things - one reads memory, the other goes out to the network -
   and a caller that cannot tell them apart will eventually use the slow one
   by accident. */
export type ListKind = 'queue' | 'likes' | 'search' | 'global' | 'playlists' | 'playlist'
export interface ListQuery {
  kind: ListKind; query?: string; playlistId?: string; offset: number; limit: number
  /* Playlist rows only. A playlist arrives in its own order, which puts the
     most recently added at the END, so "newest" is that order reversed -
     the same rule the player's own sort uses. */
  sort?: 'newest' | 'oldest'
}
export interface ListItem {
  id: string
  title: string
  artist: string
  /** Search results only: where the hit came from. A track that sits in likes
   *  and in two playlists is reported three times, once per place, because
   *  "where did you find it" is the whole point of the grouping. */
  from?: 'likes' | 'playlist'
  playlist?: string
  /** Playlist rows only: how many tracks are in it. */
  count?: number
  /* A thumbnail, already sized by the renderer. Optional because the bot's
     own lists are text in a chat message and have no use for it; the Mini
     App draws it. */
  art?: string
  /** Track length in seconds. */
  dur?: number
}
export interface ListPage { items: ListItem[]; total: number; title?: string }

interface Deps {
  sendCommand: (cmd: RemoteCommand) => void
  onStatus: (s: RemoteStatus) => void
  onPairRequest: (u: { id: number; name: string }) => void
  saveConfig: (c: RemoteConfig) => void
}


let deps: Deps | null = null
let cfg: RemoteConfig = { enabled: false, allowed: [] }
let token = ''
let poller: TgPoller | null = null
let status: RemoteStatus = { state: 'off', allowed: [], pending: null }
let botUsername = ''
/* The Mini App's current address, or null when there is none. A quick tunnel
   hands out a different one on every launch, so this is written repeatedly
   rather than once, and everything that shows it is redrawn when it lands. */
let miniAppUrl: string | null = null

interface Card { chatId: number; messageId: number }
const cards = new Map<number, Card>()
const warned = new Set<number>()
let pending: { id: number; name: string } | null = null

// ── helpers ─────────────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/* ── the card: a door, and nothing else ────────────────────────────────────
 *
 * It used to carry the track, the artist and a progress bar, edited in place
 * every few seconds. All of that is in the Mini App now, shown better and
 * without spending a Telegram edit per tick - so the chat keeps the one
 * thing the Mini App cannot give itself: the way in.
 *
 * Nothing about it depends on what is playing, which is why the player state
 * no longer reaches this file at all. */

/* One message, and only one.
 *
 * Everything the bot says goes in the same place: a new card replaces
 * whatever was there, so does a reply, and the command that asked for it is
 * deleted too. What is left in the chat is the door, not a transcript of
 * asking after it.
 *
 * Deleting what somebody sent us is allowed here and nowhere else: the Bot
 * API lets a bot remove incoming messages in private chats, and private is
 * the only kind of chat this bot is ever in. */
const notes = new Map<number, number>()

async function drop(chatId: number, messageId: number): Promise<void> {
  try { await callApi(token, 'deleteMessage', { chat_id: chatId, message_id: messageId }) } catch { /* already gone, or too old */ }
}

async function clearSlot(chatId: number): Promise<void> {
  const card = cards.get(chatId)
  if (card) { cards.delete(chatId); rememberCards(); await drop(chatId, card.messageId) }
  const note = notes.get(chatId)
  if (note !== undefined) { notes.delete(chatId); await drop(chatId, note) }
}

function cardKeyboard() {
  /* Only once the tunnel has handed out an address: Telegram refuses a
     web_app button with an empty or non-HTTPS url and throws out the whole
     message with it. */
  return miniAppUrl
    ? { inline_keyboard: [[{ text: '🎛 Открыть плеер', web_app: { url: miniAppUrl } }]] }
    : { inline_keyboard: [] }
}

const CARD_TEXT = '<b>SoundCloud</b>'
const CARD_WAITING = '<b>SoundCloud</b>\n\n<i>Поднимаю туннель, кнопка вот-вот появится.</i>'

/** Persist the open cards so a later run can still find them. */
function rememberCards(): void {
  const out: Record<string, number> = {}
  for (const [chatId, c] of cards) out[String(chatId)] = c.messageId
  cfg.cards = out
  deps?.saveConfig({ ...cfg, allowed: [...cfg.allowed], cards: out })
}

/** Delete anything a previous run left behind in this chat. */
async function dropStaleCard(chatId: number): Promise<void> {
  const id = cfg.cards?.[String(chatId)]
  if (!id || cards.has(chatId)) return
  await drop(chatId, id)
}

async function sendCard(chatId: number): Promise<void> {
  await dropStaleCard(chatId)
  await clearSlot(chatId)
  try {
    const m = await callApi<{ message_id: number }>(token, 'sendMessage', {
      chat_id: chatId, text: miniAppUrl ? CARD_TEXT : CARD_WAITING,
      parse_mode: 'HTML', reply_markup: cardKeyboard(),
    })
    cards.set(chatId, { chatId, messageId: m.message_id })
    rememberCards()
  } catch (e) {
    console.error('[remote] sendCard failed:', (e as Error).message)
  }
}

/* The address changes on every launch, so a card left open from last time
   points at a tunnel that no longer exists. Only the button is rewritten -
   the words above it never change. */
async function refreshCards(): Promise<void> {
  for (const c of [...cards.values()]) {
    try {
      await callApi(token, 'editMessageText', {
        chat_id: c.chatId, message_id: c.messageId,
        text: miniAppUrl ? CARD_TEXT : CARD_WAITING,
        parse_mode: 'HTML', reply_markup: cardKeyboard(),
      })
    } catch (err) {
      const e = err as TgError
      // Gone from the chat, or already saying exactly this.
      if (e.code === 400 && /not found/i.test(e.message)) cards.delete(c.chatId)
    }
  }
}

// ── track lists ─────────────────────────────────────────────────────────────


async function tell(chatId: number, text: string): Promise<void> {
  await clearSlot(chatId)
  try {
    const m = await callApi<{ message_id: number }>(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' })
    notes.set(chatId, m.message_id)
  } catch { /* ignore */ }
}

// ── update handling ─────────────────────────────────────────────────────────

function allowed(id: number): boolean {
  return cfg.allowed.includes(id)
}

function displayName(u: TgUser): string {
  return u.username ? `@${u.username}` : u.first_name || String(u.id)
}

async function handleStranger(chatId: number, from: TgUser, messageId?: number): Promise<void> {
  if (messageId !== undefined) await drop(chatId, messageId)
  // An empty whitelist means nobody is bound yet, so the first person to knock
  // becomes a pairing request the app has to approve. A bot cannot resolve
  // @username to an id on its own - this is the only honest way to bind one.
  if (cfg.allowed.length === 0) {
    pending = { id: from.id, name: displayName(from) }
    publishStatus()
    deps?.onPairRequest(pending)
    await tell(chatId, `⏳ Запрос на доступ отправлен.\nПодтверди его в приложении: <b>Настройки → Remote control</b>.\n\nТвой ID: <code>${from.id}</code>`)
    return
  }
  if (warned.has(from.id)) return
  warned.add(from.id)
  await tell(chatId, '⛔ Нет доступа.')
}

async function onUpdate(u: TgUpdate): Promise<void> {
  /* No callback_query branch: nothing in the chat carries callback_data
     any more. The one button opens the Mini App, which Telegram handles
     without telling the bot. */
  const msg = u.message
  if (!msg?.from || !msg.text) return
  // Belt and braces next to the startup offset drain: ignore anything that was
  // sitting in Telegram for more than a minute.
  if (Date.now() / 1000 - msg.date > 60) return
  const chatId = msg.chat.id
  const from = msg.from
  if (!allowed(from.id)) return handleStranger(chatId, from, msg.message_id)

  const text = msg.text.trim()
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '')

  // Sent first: the reply below replaces the slot, and taking this away
  // afterwards would briefly leave two messages on screen.
  await drop(chatId, msg.message_id)

  switch (cmd) {
    case '/start':
      await sendCard(chatId)
      break
    /* A ping answers one question - is anything there - and answers it by
       the fact of answering. It used to open the player instead, which made
       the word mean nothing: there was already a command for that. */
    case '/ping':
      await tell(chatId, '✅ Плеер на связи')
      break
    case '/help':
      await tell(chatId, [
        '<b>Команды</b>',
        '',
        '/start - кнопка, чтобы открыть плеер',
        '/ping - проверить, на связи ли плеер',
        '',
        '<i>Всё остальное - в самом мини-приложении: очередь, лайки, плейлисты, поиск по SoundCloud, текст песен.</i>',
      ].join('\n'))
      break
    default:
      await tell(chatId, 'Не знаю такой команды. /help')
  }
}




// ── lifecycle ───────────────────────────────────────────────────────────────

function publishStatus(): void {
  status = { ...status, allowed: [...cfg.allowed], pending }
  deps?.onStatus(status)
}

function setStatus(s: RemoteStatus['state'], detail?: string): void {
  // getUpdates succeeds every 25 seconds and reports 'online' each time; sending
  // an unchanged status would re-render the settings panel for nothing.
  if (status.state === s && status.detail === detail && status.pending === pending) return
  status = { ...status, state: s, detail, botUsername, allowed: [...cfg.allowed], pending }
  deps?.onStatus(status)
}

export function initRemote(d: Deps): void {
  deps = d
}

export function remoteConfigure(config: RemoteConfig, botToken: string): void {
  // Flipping a behaviour switch must not drop the connection: a restart kills
  // long polling and forgets every open pult, which from the chat looks like
  // the bot died for a second.
  const needsRestart = cfg.enabled !== config.enabled || token !== botToken
  cfg = { ...config, allowed: [...config.allowed] }
  token = botToken
  if (!needsRestart && poller) { publishStatus(); return }
  warned.clear()
  void restart()
}

/* Which restart is the live one.
 *
 * `restart` is fire-and-forget and has two awaits before it assigns the
 * poller and the timer, so a second call entering during the first one's
 * getMe found `poller === null`, stopped nothing, started its own, and
 * then the first resumed and overwrote both module variables. The
 * orphaned poller has `stopped === false` and nothing left holding a
 * reference, so it long-polls until the process exits - two pollers on
 * one bot token make Telegram answer 409 to one of them, which is the
 * status flapping between online and conflict that cannot be toggled
 * away. The other order was worse: switch off during a start and the
 * remote came back up after the UI said it was off.
 *
 * Bumped by stopRemote too, so a stop cannot be undone by a start that
 * was already in flight when it ran. */
let generation = 0

async function restart(): Promise<void> {
  /* Claimed after the stop, never before it: stopRemote bumps the counter
     too, so taking the number first made this function invalidate itself on
     its own second line. The guard below then handed the window over to
     nobody on every single start - the poller was never built, and the
     settings panel sat at "connecting" for ever. */
  stopRemote()
  const mine = generation
  if (!cfg.enabled) { setStatus('off'); return }
  if (!token) { setStatus('no-token'); return }
  setStatus('starting')
  try {
    const me = await callApi<TgUser>(token, 'getMe', {}, 15000)
    botUsername = me.username ?? ''
    // Fills Telegram's own "/" menu. One entry now: everything the chat used
    // to list is in the Mini App, and a menu of commands that merely say
    // "open the app" is a menu of one thing written five ways.
    await callApi(token, 'setMyCommands', {
      commands: [
        { command: 'start', description: 'Открыть плеер' },
        { command: 'ping', description: 'Проверить связь' },
      ],
    }).catch(() => { /* cosmetic */ })
  } catch (err) {
    const e = err as TgError
    setStatus(e.code === 401 || e.code === 404 ? 'bad-token' : 'network', e.message)
    if (e.code === 401 || e.code === 404) return
  }
  // Superseded while we were waiting on Telegram: hand the window over
  // to whoever bumped the generation rather than racing them.
  if (mine !== generation || !cfg.enabled) return
  poller = new TgPoller(token, onUpdate, (s: PollStatus, detail?: string) => setStatus(s, detail))
  void poller.start()
  /* The address usually arrives before the bot does - the tunnel comes up in
     seconds, getMe can sit behind a slow network - and setChatMenuButton
     needs a token. Re-applied here so the order stops mattering. */
  if (miniAppUrl) {
    const url = miniAppUrl
    miniAppUrl = null
    void remoteSetMiniApp(url)
  }
}

export function stopRemote(): void {
  // Invalidates any restart still waiting on Telegram, so a stop cannot
  // be undone by a start that was already in flight.
  generation++
  // Add-only maps, cleared with everything else they belong to.
  warned.clear()
  poller?.stop()
  poller = null
  /* Not deleted here: quitting is synchronous and Telegram is not. The
     ids are on disk, so the next launch clears them before it sends a new
     card - see dropStaleCard. */
  cards.clear()
  notes.clear()
}

export function remoteApprove(id: number): void {
  if (!Number.isFinite(id)) return
  if (!cfg.allowed.includes(id)) cfg.allowed.push(id)
  if (pending?.id === id) pending = null
  warned.delete(id)
  deps?.saveConfig({ ...cfg, allowed: [...cfg.allowed] })
  publishStatus()
  /* Its own button, because there is no default one to fall back on any
     more - the address is written per chat and nowhere else. */
  void setMenuFor(id)
  void tell(id, '✅ Доступ выдан. Напиши /start, чтобы открыть плеер.')
}

export function remoteRevoke(id: number): void {
  cfg.allowed = cfg.allowed.filter(x => x !== id)
  // Take the address back out of that chat; a revoked button still opens.
  void setMenuFor(id, { type: 'commands' })
  cards.delete(id)
  deps?.saveConfig({ ...cfg, allowed: [...cfg.allowed] })
  publishStatus()
}

/* Called whenever the tunnel's address changes, including to null when it
 * goes away. Two places show it: the blue menu button next to the chat's
 * text field, and a button on the pult itself.
 *
 * setChatMenuButton with no chat_id sets the default for everyone this bot
 * talks to, which is right here: the white list decides who may drive the
 * player, and it is checked when the socket opens, not by hiding a button. */
/** What an allowed chat should be holding right now. Without an address
 *  there is nothing to open, so it falls back to the plain commands button. */
function menuButton(): Record<string, unknown> {
  return miniAppUrl
    ? { type: 'web_app', text: 'Плеер', web_app: { url: miniAppUrl } }
    : { type: 'commands' }
}

/** Write one chat's menu button. Never called without a chat id: the
 *  default button belongs to every chat the bot has, strangers included. */
async function setMenuFor(chatId: number, button: Record<string, unknown> = menuButton()): Promise<void> {
  if (!token) return
  try {
    await callApi(token, 'setChatMenuButton', { chat_id: chatId, menu_button: button })
  } catch (e) {
    console.warn('[remote] menu button not set for %s: %s', chatId, (e as TgError).message)
  }
}

export async function remoteSetMiniApp(url: string | null): Promise<void> {
  if (miniAppUrl === url) return
  miniAppUrl = url
  // Both of these need a live bot; without one the next restart re-applies.
  if (token && cfg.enabled) {
    const button = menuButton()
    /* The address goes in the allowed chats and nowhere else.
       The default button - the one with no chat_id - belongs to every chat
       the bot has, including a stranger's. Writing the tunnel there handed
       the address to anyone who found the bot, and the whole arrangement
       rests on that address not being known: the page is reachable by URL
       alone, and only the signature check behind it decides who may drive
       the player. So the default is pinned to the plain commands button and
       the address is written per chat.
       Per chat was needed anyway, and it cost an Error 1033 on a real phone
       to find out: a quick tunnel hands out a new address every launch,
       Telegram clients cache the menu button, and a client holding
       yesterday's address opens a tunnel that no longer exists. Cloudflare
       answers 530, which the webview shows as "Error 1033" and no
       explanation. Writing it per chat replaces the copy that chat holds.
       The pult carries the same address on an inline button, and that one
       is rebuilt with every message, so it was never affected. */
    try {
      await callApi(token, 'setChatMenuButton', { menu_button: { type: 'commands' } })
    } catch (e) {
      console.warn('[remote] default menu button not reset: %s', (e as TgError).message)
    }
    for (const chatId of cfg.allowed) await setMenuFor(chatId, button)
  }
  // Every open pult is carrying a button that points at an address that no
  // longer answers, so redraw them.
  void refreshCards()
}


export function remoteGetStatus(): RemoteStatus {
  return status
}
