import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  auth: () => ipcRenderer.invoke('sc-auth'),
  getClientId: () => ipcRenderer.invoke('sc-get-client-id'),
  openMiniPlayer: () => ipcRenderer.invoke('open-mini-player'),
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

  // Write API: proxies through main process so session cookies are included
  scWrite: (method: string, url: string, body: unknown, oauthToken: string) =>
    ipcRenderer.invoke('sc-write', method, url, body, oauthToken),

  // GET API: proxies through main process to bypass Chromium header restrictions
  scGet: (url: string, oauthToken: string) =>
    ipcRenderer.invoke('sc-get', url, oauthToken),

  // Custom window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),

  // Discord Rich Presence
  setDiscordRpc: (enabled: boolean) => ipcRenderer.invoke('set-discord-rpc', enabled),
})
