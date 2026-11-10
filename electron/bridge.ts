// Local WebSocket bridge for a companion overlay app (e.g. a "Dynamic Island").
// The SC client stays the source of truth: the bridge only mirrors player state
// out and relays commands back to the existing player. localhost only, token-gated.

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const HOST = '127.0.0.1'   // localhost only, never 0.0.0.0
const PORT = 48757
/* A token the companion reads from disk, regenerated every launch.
 *
 * It used to be this constant, which is in the public repository and in
 * every shipped binary, so it authenticated nobody. The file is 0600 in
 * userData: a companion running as this user can read it, another local
 * account cannot. */
const TOKEN = randomBytes(24).toString('hex')
const tokenFile = () => join(app.getPath('userData'), 'bridge-token')

export interface BridgeTrack {
  id: string
  title: string
  artist: string
  artworkUrl: string | null
  duration: number
  /** Words are known to exist for this one. The queue marks them, same as
   *  the player's own queue does. Optional: a client that predates it is
   *  still correct without it. */
  lyr?: boolean
}

export interface BridgeState {
  playing: boolean
  volume: number            // 0..1
  position: number          // seconds
  track: BridgeTrack | null
  queue: BridgeTrack[]
  queueIndex: number        // index of current track in queue, -1 if none
  shuffle: boolean
  repeat: 'off' | 'one' | 'all'
  /* The player's resolved accent, as #rrggbb. Optional because the companion
     bridge predates it and a client that ignores it is still correct; the
     Mini App paints itself with it so the phone looks like the player the
     person set up rather than like a generic remote. */
  accent?: string
}

export interface BridgeCommand {
  action: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seek' | 'volume' | 'playQueueIndex' | 'shuffle' | 'repeat'
  value?: number | boolean | string
}

let wss: WebSocketServer | null = null
// Last full snapshot, so a freshly connected client gets state immediately.
let lastState: BridgeState & { type: 'state' } = {
  type: 'state', playing: false, volume: 1, position: 0, track: null, queue: [], queueIndex: -1,
  shuffle: false, repeat: 'off',
}

/* A client that stopped reading does not change readyState, so without a
   backlog check the level and spectrum frames just pile into its write
   buffer - unbounded memory in the process that also holds the model and
   the downloads. A frame of audio level is worthless 20ms later, so it is
   dropped rather than queued; state and progress always go. */
const MAX_BACKLOG = 64 * 1024

function sendTransient(ws: WebSocket, msg: unknown) {
  if (ws.bufferedAmount > MAX_BACKLOG) return
  send(ws, msg)
}

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)) } catch { /* client gone */ }
  }
}

/** Whether anybody is listening. The renderer asks before it starts
 *  measuring the audio: with nobody connected the whole analyser loop and
 *  its fifty messages a second are work for an empty room. */
export function bridgeHasClients(): boolean {
  if (!wss) return false
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) return true
  return false
}

function broadcast(msg: unknown) {
  if (!wss) return
  for (const client of wss.clients) send(client, msg)
}

export function startBridge(onCommand: (cmd: BridgeCommand) => void) {
  if (wss) return
  // Where the companion reads it from. Best-effort: without the file the
  // companion simply cannot connect, which is the safe direction.
  try { writeFileSync(tokenFile(), TOKEN, { mode: 0o600 }) } catch { /* no companion then */ }
  const server = new WebSocketServer({ host: HOST, port: PORT })

  // Port already in use / any listen error: log and keep the app running.
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[bridge] WebSocket server error:', err.code ?? err.message)
  })

  server.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    /* A browser always sends Origin on a WebSocket handshake; a native
       companion does not. CORS does not apply to WebSockets and
       ws://127.0.0.1 is not blocked as mixed content, so without this any
       web page the person visited could open this socket, read the first
       frame - current track, artist, and the whole queue - and then drive
       the player. */
    if (req.headers.origin) { ws.close(1008, 'browser origin'); return }
    let ok = false
    try {
      const url = new URL(req.url ?? '', `ws://${HOST}:${PORT}`)
      ok = url.searchParams.get('token') === TOKEN
    } catch { ok = false }
    if (!ok) { ws.close(1008, 'bad token'); return }
    // A socket that errors with no listener throws out of the EventEmitter
    // and takes the main process with it.
    ws.on('error', () => { try { ws.terminate() } catch { /* gone */ } })

    send(ws, lastState) // immediate snapshot on connect

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg && msg.type === 'command' && typeof msg.action === 'string') {
          const v = msg.value
          const value = (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') ? v : undefined
          onCommand({ action: msg.action, value })
        }
      } catch { /* ignore malformed message */ }
    })
  })

  server.on('listening', () => console.log(`[bridge] WebSocket bridge on ws://${HOST}:${PORT}`))
  wss = server
}

// Full snapshot: cache it and push to everyone.
export function bridgeSetState(state: BridgeState) {
  lastState = { type: 'state', ...state }
  broadcast(lastState)
}

// Lightweight progress tick (~1/sec while playing). Keeps the cached position fresh.
export function bridgeProgress(position: number, playing: boolean) {
  lastState.position = position
  lastState.playing = playing
  broadcast({ type: 'progress', position, playing })
}

// Live analyser levels (~30/sec while playing). Transient: not cached, since a
// freshly connected client only needs it once audio actually starts flowing.
export function bridgeAudio(level: number, bass: number) {
  if (!wss) return
  for (const c of wss.clients) sendTransient(c, { type: 'audio', level, bass })
}

// Downsampled frequency spectrum (~20/sec while playing) for a companion
// visualizer. bars: array of 0-255 magnitudes, low frequencies first. Transient,
// not cached (a fresh client only needs it once audio starts flowing).
export function bridgeSpectrum(bars: number[]) {
  if (!wss) return
  for (const c of wss.clients) sendTransient(c, { type: 'spectrum', bars })
}

export function stopBridge() {
  if (!wss) return
  for (const client of wss.clients) { try { client.terminate() } catch { /* ignore */ } }
  wss.close()
  wss = null
}
