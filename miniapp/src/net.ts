/* The phone's half of the link to the player.
 *
 * One socket, opened back to the origin the page was served from - which is
 * the tunnel, which is the player. Nothing here knows or cares that there is
 * a tunnel in the middle.
 *
 * The protocol is the companion bridge's, because the player already speaks
 * it: a full snapshot on connect and on every meaningful change, a cheap tick
 * for the playhead, commands going the other way, and paged lists asked for
 * by id. */

export interface Track {
  id: string
  title: string
  artist: string
  artworkUrl: string | null
  duration: number
  /** Words exist for this one; the queue badges it. */
  lyr?: boolean
}

export interface PlayerState {
  playing: boolean
  volume: number
  position: number
  track: Track | null
  queue: Track[]
  queueIndex: number
  shuffle: boolean
  repeat: 'off' | 'one' | 'all'
  accent?: string
}

export interface ListItem {
  id: string
  title: string
  artist: string
  from?: 'likes' | 'playlist'
  playlist?: string
  count?: number
  art?: string
  /** Track length in seconds. */
  dur?: number
}

export interface Lyrics {
  synced: { time: number; text: string }[] | null
  plain: string | null
  ai?: boolean
}
export interface ListPage { items: ListItem[]; total: number; title?: string; failed?: boolean }

export type Link =
  | { phase: 'connecting' }
  | { phase: 'ready'; user: string }
  | { phase: 'denied'; reason: string; name?: string }
  | { phase: 'lost' }

export type Action =
  | 'toggle' | 'next' | 'prev' | 'seek' | 'volume' | 'shuffle' | 'repeat'
  | 'playQueueIndex' | 'playTrackId'

const EMPTY: PlayerState = {
  playing: false, volume: 1, position: 0, track: null, queue: [], queueIndex: -1,
  shuffle: false, repeat: 'off',
}

type Listener = () => void

class Net {
  state: PlayerState = EMPTY
  link: Link = { phase: 'connecting' }
  /* When `state.position` was last set. The player ticks once a second,
     which is a visible step on a bar this wide, so the screen carries the
     playhead forward between ticks and this is where it counts from. */
  at = 0

  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private pending = new Map<number, (p: ListPage) => void>()
  private words = new Map<number, (l: Lyrics) => void>()
  private seq = 0
  private tries = 0
  private timer: number | null = null
  /* Set while a control is being dragged. A snapshot from the player would
     otherwise yank the thumb back to where the song was a moment ago, every
     second, for as long as a finger is on it. */
  private held = new Set<keyof PlayerState>()

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(): void { for (const fn of this.listeners) fn() }

  connect(): void {
    if (this.ws) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws

    ws.onopen = () => {
      const tg = window.Telegram?.WebApp
      ws.send(JSON.stringify({ type: 'hello', initData: tg?.initData ?? '' }))
    }

    ws.onmessage = (ev) => {
      let m: Record<string, unknown>
      try { m = JSON.parse(ev.data as string) } catch { return }

      switch (m.type) {
        case 'welcome':
          this.tries = 0
          this.link = { phase: 'ready', user: (m.user as { name?: string })?.name ?? '' }
          break
        case 'denied':
          // A refusal is an answer, not a hiccup: stop reconnecting into it.
          this.link = { phase: 'denied', reason: String(m.reason ?? ''), name: m.name as string | undefined }
          this.tries = -1
          break
        case 'state': {
          const next = { ...(m as unknown as PlayerState) }
          for (const k of this.held) (next as Record<string, unknown>)[k] = this.state[k]
          this.state = next
          this.at = Date.now()
          break
        }
        case 'progress':
          if (!this.held.has('position')) { this.state = { ...this.state, position: m.position as number }; this.at = Date.now() }
          this.state = { ...this.state, playing: m.playing as boolean }
          break
        case 'lyrics-reply': {
          const done = this.words.get(m.id as number)
          if (done) {
            this.words.delete(m.id as number)
            done({ synced: (m.synced as Lyrics['synced']) ?? null, plain: (m.plain as string) ?? null, ai: !!m.ai })
          }
          return
        }
        case 'list-reply': {
          const done = this.pending.get(m.id as number)
          if (done) {
            this.pending.delete(m.id as number)
            done({ items: (m.items as ListItem[]) ?? [], total: (m.total as number) ?? 0, title: m.title as string, failed: !!m.failed })
          }
          return   // lists do not touch player state
        }
        default: return
      }
      this.emit()
    }

    ws.onclose = () => {
      this.ws = null
      for (const [, done] of this.pending) done({ items: [], total: 0, failed: true })
      this.pending.clear()
      for (const [, done] of this.words) done({ synced: null, plain: null })
      this.words.clear()
      if (this.tries < 0) return          // denied: nothing to come back to
      this.link = { phase: 'lost' }
      this.emit()
      // The player may simply be closed, or the tunnel may be handing out a
      // new address; either way, keep knocking, slower each time.
      const wait = Math.min(1000 * 2 ** this.tries++, 20000)
      this.timer = window.setTimeout(() => { this.timer = null; this.connect() }, wait)
    }

    ws.onerror = () => { try { ws.close() } catch { /* already closing */ } }
  }

  /** Drive the player. Optimistic: the control moves now, the player agrees
   *  a moment later, and a snapshot that disagrees wins once the finger is
   *  off it. Over a tunnel the round trip is long enough to feel. */
  send(action: Action, value?: number | boolean | string): void {
    const ws = this.ws
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'command', action, value }))
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.('light')
  }

  /** Move a control locally and tell the player, without waiting for it. */
  nudge(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch }
    if ('position' in patch) this.at = Date.now()
    this.emit()
  }

  hold(key: keyof PlayerState, on: boolean): void {
    if (on) this.held.add(key)
    else this.held.delete(key)
  }

  /** The words for the track that is playing, or empty when there are none. */
  lyrics(trackId: string): Promise<Lyrics> {
    return new Promise(resolve => {
      const ws = this.ws
      const nothing: Lyrics = { synced: null, plain: null }
      if (ws?.readyState !== WebSocket.OPEN) { resolve(nothing); return }
      const id = ++this.seq
      this.words.set(id, resolve)
      ws.send(JSON.stringify({ type: 'lyrics', id, trackId: Number(trackId) }))
      // A first lookup goes out to a catalogue from the desktop; past this
      // it is not coming.
      window.setTimeout(() => {
        if (!this.words.has(id)) return
        this.words.delete(id)
        resolve(nothing)
      }, 14000)
    })
  }

  list(q: { kind: string; query?: string; playlistId?: string; sort?: 'newest' | 'oldest'; offset: number; limit: number }): Promise<ListPage> {
    return new Promise(resolve => {
      const ws = this.ws
      if (ws?.readyState !== WebSocket.OPEN) { resolve({ items: [], total: 0, failed: true }); return }
      const id = ++this.seq
      this.pending.set(id, resolve)
      ws.send(JSON.stringify({ type: 'list', id, ...q }))
      // A player that never answers must not leave a spinner up for ever.
      window.setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        resolve({ items: [], total: 0, failed: true })
      }, 8000)
    })
  }
}

export const net = new Net()

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string
        colorScheme?: 'light' | 'dark'
        themeParams?: Record<string, string>
        ready: () => void
        expand: () => void
        requestFullscreen?: () => void
        setHeaderColor?: (c: string) => void
        setBackgroundColor?: (c: string) => void
        BackButton?: { show: () => void; hide: () => void; onClick: (f: () => void) => void; offClick: (f: () => void) => void }
        HapticFeedback?: {
          impactOccurred?: (s: 'light' | 'medium' | 'heavy') => void
          selectionChanged?: () => void
        }
      }
    }
  }
}
