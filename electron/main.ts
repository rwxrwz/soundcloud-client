import { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, screen } from 'electron'
import { join } from 'path'
import { Client } from '@xhayper/discord-rpc'

const ICON_PATH = join(__dirname, '../../buildResources/icon_rounded.ico')

// Create your own app at https://discord.com/developers/applications and paste its
// Application ID here. The app's NAME is shown as "Listening to <name>" in Discord.
const DISCORD_CLIENT_ID = '1380000000000000000'

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let lastPlayerState: unknown = null
// Hidden SC-context window — kept alive after auth so DataDome cookies stay valid
let scProxy: BrowserWindow | null = null

// ── Discord Rich Presence ───────────────────────────────────────────────────
let rpc: Client | null = null
let rpcReady = false
let rpcEnabled = false
let lastRpcKey = ''

interface PState { currentTrack?: { title: string; user?: { username: string } } | null; isPlaying?: boolean }

async function connectRpc(): Promise<void> {
  if (rpc) return
  rpc = new Client({ clientId: DISCORD_CLIENT_ID })
  rpc.on('ready', () => { rpcReady = true; updateDiscordActivity() })
  try {
    await rpc.login()
  } catch {
    // Discord not running / not installed — silently ignore
    rpc = null
    rpcReady = false
  }
}

function disconnectRpc(): void {
  try { rpc?.user?.clearActivity() } catch {}
  try { rpc?.destroy() } catch {}
  rpc = null
  rpcReady = false
  lastRpcKey = ''
}

function updateDiscordActivity(): void {
  if (!rpcEnabled || !rpc || !rpcReady) return
  const s = lastPlayerState as PState | null
  // Dedupe: only push to Discord when the track or play-state changes, not on
  // every progress tick (Discord rate-limits setActivity to ~5 per 20s).
  const key = s?.currentTrack && s.isPlaying ? `${s.currentTrack.title}|${s.isPlaying}` : 'idle'
  if (key === lastRpcKey) return
  lastRpcKey = key
  if (s?.currentTrack && s.isPlaying) {
    rpc.user?.setActivity({
      type: 2, // Listening
      details: s.currentTrack.title?.slice(0, 128) || 'SoundCloud',
      state: s.currentTrack.user?.username ? `— ${s.currentTrack.user.username}`.slice(0, 128) : undefined,
      largeImageKey: 'soundcloud',
      largeImageText: 'SoundCloud',
      instance: false,
    }).catch(() => {})
  } else {
    rpc.user?.clearActivity().catch(() => {})
  }
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    icon: ICON_PATH,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../../out/renderer/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Minimize behaves normally (to taskbar). Only close hides to tray.

  // Hide to tray on close (unless actually quitting)
  mainWindow.on('close', (e: Electron.Event) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })
}

function createMiniWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) { miniWindow.show(); miniWindow.focus(); return }

  const { workArea } = screen.getPrimaryDisplay()
  const W = 380, H = 108
  const margin = 12
  const x = workArea.x + workArea.width  - W - margin
  const y = workArea.y + workArea.height - H - margin

  miniWindow = new BrowserWindow({
    width: W,
    height: H,
    x, y,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  })
  const url = process.env.ELECTRON_RENDERER_URL
    ? `${process.env.ELECTRON_RENDERER_URL}#mini`
    : `file://${join(__dirname, '../../out/renderer/index.html')}#mini`
  miniWindow.loadURL(url)
  miniWindow.webContents.once('did-finish-load', () => {
    if (lastPlayerState) miniWindow?.webContents.send('player-state', lastPlayerState)
    miniWindow?.show()
  })
  miniWindow.on('closed', () => { miniWindow = null })
}

function createTray(): void {
  const trayIconPath = app.isPackaged
    ? join(process.resourcesPath, 'tray_clean.png')
    : join(__dirname, '../../buildResources/tray_clean.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  tray = new Tray(trayIcon)
  tray.setToolTip('SoundCloud')

  tray.on('click', () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.isVisible() ? miniWindow.hide() : miniWindow.show()
    } else {
      createMiniWindow()
    }
  })

  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Открыть приложение',
        click: () => { mainWindow?.show(); mainWindow?.focus() }
      },
      { type: 'separator' },
      {
        label: 'Закрыть',
        click: () => { isQuitting = true; app.quit() }
      }
    ])
    tray?.popUpContextMenu(menu)
  })
}

// Get client_id silently by loading soundcloud.com in a hidden window
ipcMain.handle('sc-get-client-id', () => {
  return new Promise<string>((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    })
    let found = false
    win.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['*://api-v2.soundcloud.com/*', '*://api.soundcloud.com/*'] },
      (details, callback) => {
        if (!found) {
          const m = details.url.match(/client_id=([a-zA-Z0-9_-]+)/)
          if (m) {
            found = true
            win.close()
            resolve(m[1])
          }
        }
        callback({ requestHeaders: details.requestHeaders })
      }
    )
    win.loadURL('https://soundcloud.com')
    setTimeout(() => {
      if (!found) { win.close(); reject(new Error('Could not extract client_id from soundcloud.com')) }
    }, 20000)
  })
})

// Proxy write requests through main process so SC session cookies are included
// Ensure a hidden window loaded on soundcloud.com is available.
// DataDome requires requests to originate from an actual SC browser context.
async function ensureScProxy(): Promise<BrowserWindow> {
  if (scProxy && !scProxy.isDestroyed()) return scProxy
  scProxy = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: false }
  })
  await scProxy.loadURL('https://soundcloud.com')
  scProxy.on('closed', () => { scProxy = null })
  return scProxy
}

ipcMain.handle('sc-write', async (_, method: string, url: string, body: unknown, oauthToken: string) => {
  const proxy = await ensureScProxy()

  // Encode body as base64 to transport it into the page without any escaping issues
  const bodyB64 = body !== null ? Buffer.from(JSON.stringify(body), 'utf8').toString('base64') : null

  // Run fetch from inside the soundcloud.com context — DataDome cookies are valid here
  const code = `
    (async () => {
      const opts = {
        method: ${JSON.stringify(method)},
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': ${JSON.stringify('OAuth ' + oauthToken)}
        }
      };
      ${bodyB64 ? `opts.body = decodeURIComponent(escape(atob(${JSON.stringify(bodyB64)})));` : ''}
      const res = await fetch(${JSON.stringify(url)}, opts);
      const text = await res.text();
      if (!res.ok) throw new Error('API error ' + res.status + ': ' + text);
      return text ? JSON.parse(text) : null;
    })()
  `
  return proxy.webContents.executeJavaScript(code)
})

ipcMain.handle('sc-get', async (_, url: string, oauthToken: string) => {
  const proxy = await ensureScProxy()
  const code = `
    (async () => {
      const res = await fetch(${JSON.stringify(url)}, {
        credentials: 'include',
        headers: { 'Authorization': 'OAuth ${oauthToken}' }
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    })()
  `
  return proxy.webContents.executeJavaScript(code)
})

ipcMain.handle('open-mini-player', () => createMiniWindow())
ipcMain.handle('close-mini-player', () => { miniWindow?.close(); miniWindow = null })
ipcMain.handle('toggle-devtools', () => mainWindow?.webContents.toggleDevTools())
ipcMain.handle('show-main-window', () => { mainWindow?.show(); mainWindow?.focus() })
ipcMain.handle('get-player-state', () => lastPlayerState)

// Custom window controls
ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.handle('window-close', () => mainWindow?.close())

// Discord Rich Presence enable/disable from renderer settings
ipcMain.handle('set-discord-rpc', async (_, enabled: boolean) => {
  rpcEnabled = enabled
  if (enabled) { await connectRpc(); updateDiscordActivity() }
  else disconnectRpc()
})

// State broadcast: main renderer → main process → mini window
ipcMain.on('player-state-update', (_, state) => {
  lastPlayerState = state
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('player-state', state)
  }
  updateDiscordActivity()
})

// Control commands: mini window → main process → main renderer
ipcMain.on('player-control', (_, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-command', action)
  }
})

// Auth handler: opens SoundCloud signin, waits for login, then grabs credentials automatically
ipcMain.handle('sc-auth', async () => {
  return new Promise<{ clientId: string; oauthToken: string }>((resolve, reject) => {
    const authWin = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Sign in to SoundCloud — close this window when done',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let clientId = ''
    let oauthToken = ''
    let resolved = false

    const tryResolve = () => {
      if (resolved || !clientId || !oauthToken) return
      resolved = true
      if (!authWin.isDestroyed()) {
        // Hide instead of close — reuse as SC proxy for DataDome-safe write requests
        authWin.hide()
        if (scProxy && !scProxy.isDestroyed()) scProxy.close()
        scProxy = authWin
      }
      resolve({ clientId, oauthToken })
    }

    // Intercept all outgoing requests to api-v2
    authWin.webContents.session.webRequest.onBeforeSendHeaders(
      { urls: ['*://api-v2.soundcloud.com/*', '*://api.soundcloud.com/*'] },
      (details, callback) => {
        const cidMatch = details.url.match(/client_id=([a-zA-Z0-9_-]+)/)
        if (cidMatch) clientId = cidMatch[1]

        const auth = details.requestHeaders['Authorization'] || details.requestHeaders['authorization']
        if (auth && auth.startsWith('OAuth ')) {
          oauthToken = auth.replace('OAuth ', '').trim()
        }

        callback({ requestHeaders: details.requestHeaders })
        tryResolve()
      }
    )

    authWin.loadURL('https://soundcloud.com/signin')

    // After user logs in and page navigates away from /signin, inject a fetch to force API request
    authWin.webContents.on('did-navigate', async (_, url) => {
      if (!url.includes('/signin') && url.includes('soundcloud.com')) {
        // Give the page a moment to initialize, then trigger an authenticated API call
        setTimeout(() => {
          if (!resolved && !authWin.isDestroyed()) {
            authWin.webContents.executeJavaScript(`
              fetch('https://api-v2.soundcloud.com/me', { credentials: 'include' })
                .catch(() => {})
            `).catch(() => {})
          }
        }, 1500)
      }
    })

    authWin.on('closed', () => {
      if (!resolved) reject(new Error('Окно закрыто до завершения входа'))
    })

    setTimeout(() => {
      if (!resolved) {
        resolved = true
        if (!authWin.isDestroyed()) authWin.close()
        reject(new Error('Timeout'))
      }
    }, 300000)
  })
})

app.whenReady().then(() => {
  createMainWindow()
  createTray()
  app.on('activate', () => {
    // macOS: clicking dock icon shows main window
    mainWindow?.show()
    mainWindow?.focus()
  })
})

app.on('window-all-closed', () => {
  // Don't quit — app lives in the tray. Only quit via tray menu.
  if (process.platform !== 'darwin' && isQuitting) app.quit()
})

app.on('before-quit', () => { isQuitting = true; disconnectRpc() })
