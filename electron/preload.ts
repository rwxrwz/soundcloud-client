import { contextBridge, ipcRenderer } from 'electron'

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
  bridgeSendAudio: (level: number, bass: number) => ipcRenderer.send('bridge:audio', { level, bass }),
  bridgeSendSpectrum: (bars: number[]) => ipcRenderer.send('bridge:spectrum', bars),
  onBridgeCommand: (cb: (cmd: { action: string; value?: number | boolean | string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, cmd: { action: string; value?: number | boolean | string }) => cb(cmd)
    ipcRenderer.on('bridge:command', handler)
    return () => ipcRenderer.removeListener('bridge:command', handler)
  },

  // Write API: proxies through main process so session cookies are included
  scWrite: (method: string, url: string, body: unknown, oauthToken: string) =>
    ipcRenderer.invoke('sc-write', method, url, body, oauthToken),

  // Custom window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),

  // System preferences
  setCloseToTray: (enabled: boolean) => ipcRenderer.invoke('set-close-to-tray', enabled),
  setLoginItem: (enabled: boolean) => ipcRenderer.invoke('set-login-item', enabled),
  getLoginItem: () => ipcRenderer.invoke('get-login-item') as Promise<boolean>,
  setDatadomeBypass: (enabled: boolean) => ipcRenderer.invoke('set-datadome-bypass', enabled),
  setWindowTransparent: (enabled: boolean) => ipcRenderer.invoke('set-window-transparent', enabled),
  getWindowTransparent: () => ipcRenderer.invoke('get-window-transparent') as Promise<boolean>,
  restartApp: () => ipcRenderer.invoke('restart-app'),

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
  downloadTrack: (mode: 'folder' | 'dialog', url: string, filename: string) =>
    ipcRenderer.invoke('download-track', mode, url, filename) as Promise<string | null>,
  openDownloads: () => ipcRenderer.invoke('downloads-open'),
})
