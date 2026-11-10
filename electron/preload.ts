import { contextBridge, ipcRenderer } from 'electron'

interface RemoteListRequestIpc {
  id: number
  kind: 'queue' | 'likes' | 'search' | 'playlists' | 'playlist'
  query?: string
  playlistId?: string
  offset: number
  limit: number
}

export interface MiniAppStatus {
  state: 'off' | 'fetching' | 'starting' | 'up' | 'failed'
  url: string | null
  have: boolean
  bytes: number
  dir: string
}

contextBridge.exposeInMainWorld('electronAPI', {
  auth: () => ipcRenderer.invoke('sc-auth'),
  getClientId: () => ipcRenderer.invoke('sc-get-client-id'),
  openMiniPlayer: () => ipcRenderer.invoke('open-mini-player'),
  setMiniOpaque: (enabled: boolean) => ipcRenderer.invoke('set-mini-opaque', enabled),
  closeMiniPlayer: () => ipcRenderer.invoke('close-mini-player'),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  showMainWindow: () => ipcRenderer.invoke('show-main-window'),
  getPlayerState: () => ipcRenderer.invoke('get-player-state'),

  // Broadcast player state from main renderer to mini window
  sendPlayerState: (state: unknown) => ipcRenderer.send('player-state-update', state),

  // Mini window subscribes to state updates; returns cleanup fn
  onPlayerState: (cb: (state: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: unknown) => cb(state)
    ipcRenderer.on('player-state', handler)
    return () => ipcRenderer.removeListener('player-state', handler)
  },

  // Mini window sends control commands; returns cleanup fn
  playerControl: (action: { type: string; payload?: unknown }) =>
    ipcRenderer.send('player-control', action),

  // Main window listens to commands forwarded from mini; returns cleanup fn
  onPlayerCommand: (cb: (action: { type: string; payload?: unknown }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, action: { type: string; payload?: unknown }) => cb(action)
    ipcRenderer.on('player-command', handler)
    return () => ipcRenderer.removeListener('player-command', handler)
  },

  // Companion WebSocket bridge (Dynamic Island overlay)
  bridgeSendState: (state: unknown) => ipcRenderer.send('bridge:state', state),
  bridgeSendProgress: (position: number, playing: boolean) => ipcRenderer.send('bridge:progress', { position, playing }),
  bridgeHasClients: () => ipcRenderer.invoke('bridge-has-clients'),
  bridgeSendAudio: (level: number, bass: number) => ipcRenderer.send('bridge:audio', { level, bass }),
  bridgeSendSpectrum: (bars: number[]) => ipcRenderer.send('bridge:spectrum', bars),
  onBridgeCommand: (cb: (cmd: { action: string; value?: number | boolean | string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, cmd: { action: string; value?: number | boolean | string }) => cb(cmd)
    ipcRenderer.on('bridge:command', handler)
    return () => ipcRenderer.removeListener('bridge:command', handler)
  },

  // Telegram remote control. The bot token only ever travels renderer -> main;
  // getConfig reports whether one is stored, never the value.
  remoteGetConfig: () => ipcRenderer.invoke('remote-get-config'),
  remoteSetConfig: (patch: { enabled?: boolean; token?: string }) =>
    ipcRenderer.invoke('remote-set-config', patch),
  remoteApprove: (id: number) => ipcRenderer.invoke('remote-approve', id),
  remoteRevoke: (id: number) => ipcRenderer.invoke('remote-revoke', id),
  onRemoteStatus: (cb: (s: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, s: unknown) => cb(s)
    ipcRenderer.on('remote:status', handler)
    return () => ipcRenderer.removeListener('remote:status', handler)
  },
  onRemoteLyricsRequest: (cb: (q: { id: number; trackId: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, q: { id: number; trackId: number }) => cb(q)
    ipcRenderer.on('remote:lyrics-request', handler)
    return () => ipcRenderer.removeListener('remote:lyrics-request', handler)
  },
  remoteLyricsReply: (r: { id: number; synced: { time: number; text: string }[] | null; plain: string | null; ai?: boolean }) =>
    ipcRenderer.send('remote:lyrics-reply', r),

  // Telegram Mini App: the tunnel's state and the address it hands out.
  miniAppStatus: () => ipcRenderer.invoke('miniapp-status') as Promise<MiniAppStatus | null>,
  onMiniAppStatus: (cb: (s: MiniAppStatus) => void) => {
    const handler = (_: Electron.IpcRendererEvent, s: MiniAppStatus) => cb(s)
    ipcRenderer.on('miniapp:status', handler)
    return () => ipcRenderer.removeListener('miniapp:status', handler)
  },
  onMiniAppProgress: (cb: (p: { done: number; total: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, p: { done: number; total: number }) => cb(p)
    ipcRenderer.on('miniapp:progress', handler)
    return () => ipcRenderer.removeListener('miniapp:progress', handler)
  },
  onRemotePair: (cb: (u: { id: number; name: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, u: { id: number; name: string }) => cb(u)
    ipcRenderer.on('remote:pair', handler)
    return () => ipcRenderer.removeListener('remote:pair', handler)
  },
  onRemoteCommand: (cb: (cmd: { action: string; value?: number | boolean | string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, cmd: { action: string; value?: number | boolean | string }) => cb(cmd)
    ipcRenderer.on('remote:command', handler)
    return () => ipcRenderer.removeListener('remote:command', handler)
  },
  onRemoteListRequest: (cb: (q: RemoteListRequestIpc) => void) => {
    const handler = (_: Electron.IpcRendererEvent, q: RemoteListRequestIpc) => cb(q)
    ipcRenderer.on('remote:list-request', handler)
    return () => ipcRenderer.removeListener('remote:list-request', handler)
  },
  remoteListReply: (r: { id: number; items: unknown[]; total: number; title?: string }) =>
    ipcRenderer.send('remote:list-reply', r),

  // Write API: proxies through main process so session cookies are included
  scWrite: (method: string, url: string, body: unknown, oauthToken: string) =>
    ipcRenderer.invoke('sc-write', method, url, body, oauthToken),

  // Custom window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),

  // System preferences
  setCloseToTray: (enabled: boolean) => ipcRenderer.invoke('set-close-to-tray', enabled),
  setDiscordRpc: (enabled: boolean) => ipcRenderer.invoke('set-discord-rpc', enabled),
  setLoginItem: (enabled: boolean) => ipcRenderer.invoke('set-login-item', enabled),
  getLoginItem: () => ipcRenderer.invoke('get-login-item') as Promise<boolean>,
  setDatadomeBypass: (enabled: boolean) => ipcRenderer.invoke('set-datadome-bypass', enabled),
  setWindowTransparent: (enabled: boolean) => ipcRenderer.invoke('set-window-transparent', enabled),
  getWindowTransparent: () => ipcRenderer.invoke('get-window-transparent') as Promise<boolean>,
  restartApp: () => ipcRenderer.invoke('restart-app'),

  /* AI lyrics. The key goes in and never comes back: the window can only ask
     whether one is stored, and ask for a transcript. */
  geniusSetToken: (token: string) => ipcRenderer.invoke('genius-set-token', token) as Promise<boolean>,
  geniusHasToken: () => ipcRenderer.invoke('genius-has-token') as Promise<boolean>,
  geniusReady: () => ipcRenderer.invoke('genius-ready') as Promise<boolean>,
  geniusLibrary: (names: string[]) => ipcRenderer.invoke('genius-library', names) as Promise<void>,
  geniusClearance: () => ipcRenderer.invoke('genius-clearance') as Promise<boolean>,
  geniusFind: (req: { title: string; artists: string[]; raw?: string }) =>
    ipcRenderer.invoke('genius-find', req) as Promise<string | null>,
  geniusByUrl: (req: { trackId: number; url: string }) =>
    ipcRenderer.invoke('genius-url', req) as Promise<{ ok: true; html: string; url: string; cached: boolean } | { ok: false; reason: string }>,
  geniusPage: (req: { trackId: number; title: string; artists: string[]; raw?: string }) =>
    ipcRenderer.invoke('genius-page', req) as Promise<{ ok: true; html: string; url: string; cached: boolean } | { ok: false; reason: string; shared?: boolean }>,
  lyricsForgetTrack: (trackId: number) => ipcRenderer.invoke('lyrics-forget-track', trackId) as Promise<number>,
  lyricsCachedIds: () => ipcRenderer.invoke('lyrics-cached-ids') as Promise<number[]>,
  lyricsCacheStat: () => ipcRenderer.invoke('lyrics-cache-stat') as Promise<{ files: number; bytes: number }>,
  lyricsCacheOpen: () => ipcRenderer.invoke('lyrics-cache-open') as Promise<boolean>,
  lyricsCacheClear: () => ipcRenderer.invoke('lyrics-cache-clear') as Promise<number>,
  alignReady: () => ipcRenderer.invoke('align-ready') as Promise<boolean>,
  alignFetch: () => ipcRenderer.invoke('align-fetch') as Promise<boolean>,
  alignInfo: () => ipcRenderer.invoke('align-info') as Promise<{ have: boolean; bytes: number; total: number; dir: string }>,
  alignCancel: () => ipcRenderer.invoke('align-cancel') as Promise<void>,
  alignRemove: () => ipcRenderer.invoke('align-remove') as Promise<boolean>,
  alignOpenDir: () => ipcRenderer.invoke('align-open-dir') as Promise<void>,
  alignRun: (req: { trackId: number; pcm: Float32Array; lyrics: string[]; title?: string }) =>
    ipcRenderer.invoke('align-run', req) as Promise<{ lines: { time: number; text: string }[]; support: number; seconds: number }>,
  onAlignProgress: (cb: (p: { done: number; total: number }) => void) => {
    const h = (_e: unknown, p: { done: number; total: number }) => cb(p)
    ipcRenderer.on('align-progress', h)
    return () => ipcRenderer.removeListener('align-progress', h)
  },
  aiSetKey: (key: string) => ipcRenderer.invoke('ai-set-key', key) as Promise<boolean>,
  aiHasKey: () => ipcRenderer.invoke('ai-has-key') as Promise<boolean>,
  aiClearKey: () => ipcRenderer.invoke('ai-clear-key') as Promise<boolean>,
  aiCached: (trackId: number, model: string) => ipcRenderer.invoke('ai-cached', trackId, model) as Promise<{ lines: { time: number; text: string }[]; plain: string; model: string; at: number; note?: string; fit?: number } | null>,
  aiTranscribe: (req: { trackId: number; title: string; artist: string; durationSec: number; url: string; kind: 'progressive' | 'hls'; model?: string; force?: boolean; wav?: Uint8Array | null; wavMime?: string; lyrics?: string[] | null }) =>
    ipcRenderer.invoke('ai-transcribe', req) as Promise<{ lines: { time: number; text: string }[]; plain: string; model: string; at: number; note?: string; fit?: number }>,

  // Secure OAuth token storage (OS keychain via safeStorage)
  secureSetToken: (token: string) => ipcRenderer.invoke('secure-set-token', token),
  secureGetToken: () => ipcRenderer.invoke('secure-get-token') as Promise<string>,

  // App version + GitHub releases (update check)
  getAppVersion: () => ipcRenderer.invoke('get-app-version') as Promise<string>,
  getReleases: (force?: boolean) => ipcRenderer.invoke('get-releases', force) as Promise<Array<{ tag: string; name: string; body: string; date: string; url: string; prerelease: boolean }>>,

  // Video wallpapers (userData/wallpapers)
  wallpapersDir: () => ipcRenderer.invoke('wallpapers-dir') as Promise<string>,
  openWallpapers: () => ipcRenderer.invoke('wallpapers-open'),
  listWallpapers: () => ipcRenderer.invoke('wallpapers-list') as Promise<{ name: string; path: string }[]>,

  // Track downloads (userData/downloads or a "Save as" dialog)
  openDownloads: () => ipcRenderer.invoke('downloads-open') as Promise<string>,

  // Downloads: open a destination (filename without extension), fill it either
  // from the stream (dlFill) or with bytes the window made (dlWrite), then close.
  dlOpen: (mode: 'folder' | 'dialog', filename: string, exts: string[]) =>
    ipcRenderer.invoke('dl-open', mode, filename, exts) as Promise<{ id: number; dest: string } | null>,
  dlFill: (id: number, url: string, kind: 'progressive' | 'hls') =>
    ipcRenderer.invoke('dl-fill', id, url, kind) as Promise<void>,
  dlWrite: (id: number, bytes: Uint8Array) =>
    ipcRenderer.invoke('dl-write', id, bytes) as Promise<void>,
  dlClose: (id: number, ok: boolean) =>
    ipcRenderer.invoke('dl-close', id, ok) as Promise<string | null>,
})
