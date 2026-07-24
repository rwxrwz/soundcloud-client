// Local WebSocket bridge for a companion overlay app (e.g. a "Dynamic Island").
// The SC client stays the source of truth: the bridge only mirrors player state
// out and relays commands back to the existing player. localhost only, token-gated.

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'http'

const HOST = '127.0.0.1'   // localhost only, never 0.0.0.0
const PORT = 48757
const TOKEN = 'di-bridge-v1'

export interface BridgeTrack {
  id: string
  title: string
  artist: string
  artworkUrl: string | null
  duration: number
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

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(msg)) } catch { /* client gone */ }
  }
}

function broadcast(msg: unknown) {
  if (!wss) return
  for (const client of wss.clients) send(client, msg)
}

export function startBridge(onCommand: (cmd: BridgeCommand) => void) {
  if (wss) return
  const server = new WebSocketServer({ host: HOST, port: PORT })

  // Port already in use / any listen error: log and keep the app running.
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[bridge] WebSocket server error:', err.code ?? err.message)
  })

  server.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    let ok = false
    try {
      const url = new URL(req.url ?? '', `ws://${HOST}:${PORT}`)
      ok = url.searchParams.get('token') === TOKEN
    } catch { ok = false }
    if (!ok) { ws.close(1008, 'bad token'); return }

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
  broadcast({ type: 'audio', level, bass })
}

export function stopBridge() {
  if (!wss) return
  for (const client of wss.clients) { try { client.terminate() } catch { /* ignore */ } }
  wss.close()
  wss = null
}
