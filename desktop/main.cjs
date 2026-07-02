const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} = require('electron')
const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')

let mainWindow = null
let serverProcess = null
let shuttingDown = false
let dragState = null
const DEFAULT_DESKTOP_PORT = Number(process.env.KITE_DESKTOP_PORT || 47826)
let desktopAccessToken = ''

function isValidPort(port) {
  return Number.isInteger(port) && port > 0 && port < 65536
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close(() => {
        if (!port) {
          reject(new Error('Unable to allocate a local port'))
          return
        }
        resolve(port)
      })
    })
  })
}

async function pickDesktopPort() {
  if (
    isValidPort(DEFAULT_DESKTOP_PORT) &&
    (await isPortAvailable(DEFAULT_DESKTOP_PORT))
  ) {
    return DEFAULT_DESKTOP_PORT
  }

  return findFreePort()
}

function backendPath() {
  const backendName = process.platform === 'win32' ? 'kite.exe' : 'kite'

  if (app.isPackaged) {
    return path.join(process.resourcesPath, backendName)
  }
  return path.join(__dirname, 'resources', backendName)
}

function appIconPath() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.icns')
    : path.join(__dirname, 'build', 'icon.icns')

  return fs.existsSync(iconPath) ? iconPath : undefined
}

function appDockIconPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.png'),
        path.join(process.resourcesPath, 'icon.icns'),
      ]
    : [
        path.join(__dirname, 'build', 'Kite.iconset', 'icon_512x512.png'),
        path.join(__dirname, 'build', 'icon.icns'),
      ]

  return candidates.find((candidate) => fs.existsSync(candidate))
}

function setDockIcon(iconPath) {
  if (process.platform !== 'darwin' || !iconPath || !app.dock) {
    return
  }

  const image = nativeImage.createFromPath(iconPath)
  if (!image.isEmpty()) {
    app.dock.setIcon(image)
  }
}

function ensureEncryptionKey(userDataPath) {
  const keyPath = path.join(userDataPath, 'encryption.key')
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8').trim()
  }

  const key = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(userDataPath, { recursive: true })
  fs.writeFileSync(keyPath, `${key}\n`, { mode: 0o600 })
  return key
}

function waitForHealth(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() > deadline) {
        reject(new Error('Kite backend did not become ready in time'))
        return
      }

      const req = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/healthz',
          timeout: 1000,
        },
        (res) => {
          res.resume()
          if (res.statusCode === 200) {
            resolve()
            return
          }
          setTimeout(check, 300)
        }
      )

      req.on('error', () => setTimeout(check, 300))
      req.on('timeout', () => {
        req.destroy()
        setTimeout(check, 300)
      })
    }

    check()
  })
}

async function startBackend() {
  const executable = backendPath()
  if (!fs.existsSync(executable)) {
    throw new Error(`Kite backend binary was not found: ${executable}`)
  }

  const userDataPath = app.getPath('userData')
  const logPath = path.join(userDataPath, 'kite.log')
  fs.mkdirSync(userDataPath, { recursive: true })

  const port = await pickDesktopPort()
  desktopAccessToken = crypto.randomBytes(32).toString('hex')
  const logStream = fs.createWriteStream(logPath, { flags: 'a' })
  const env = {
    ...process.env,
    KITE_DESKTOP_MODE: '1',
    KITE_DESKTOP_ACCESS_TOKEN: desktopAccessToken,
    PORT: String(port),
    DB_TYPE: 'sqlite',
    DB_DSN: path.join(userDataPath, 'kite.db'),
    DISABLE_CACHE: 'true',
    KITE_ENCRYPT_KEY: ensureEncryptionKey(userDataPath),
  }

  serverProcess = spawn(executable, [], {
    cwd: userDataPath,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  serverProcess.stdout.pipe(logStream)
  serverProcess.stderr.pipe(logStream)
  serverProcess.once('exit', (code, signal) => {
    if (!shuttingDown) {
      dialog.showErrorBox(
        'Kite stopped',
        `The local Kite backend exited unexpectedly (${signal || code}). Logs: ${logPath}`
      )
      app.quit()
    }
  })

  await waitForHealth(port)
  return { port, logPath }
}

function createWindow(port) {
  const icon = appIconPath()
  setDockIcon(appDockIconPath() || icon)

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    title: '',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    ...(icon ? { icon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedPrefix = `http://127.0.0.1:${port}/`
    if (!url.startsWith(allowedPrefix)) {
      event.preventDefault()
    }
  })

  mainWindow.loadURL(`http://127.0.0.1:${port}/`, {
    extraHeaders: `X-Kite-Desktop-Token: ${desktopAccessToken}`,
  })
}

function readDragPoint(point) {
  const x = Number(point?.screenX)
  const y = Number(point?.screenY)

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null
  }

  return { x, y }
}

function setupWindowIpc() {
  ipcMain.on('kite-window:start-drag', (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const startPoint = readDragPoint(point)

    if (!win || !startPoint || win.isDestroyed()) {
      return
    }

    if (win.isMaximized()) {
      win.unmaximize()
    }

    dragState = {
      senderId: event.sender.id,
      startPoint,
      startBounds: win.getBounds(),
    }
  })

  ipcMain.on('kite-window:drag-to', (event, point) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const nextPoint = readDragPoint(point)

    if (
      !win ||
      !nextPoint ||
      !dragState ||
      dragState.senderId !== event.sender.id ||
      win.isDestroyed()
    ) {
      return
    }

    win.setPosition(
      Math.round(
        dragState.startBounds.x + nextPoint.x - dragState.startPoint.x
      ),
      Math.round(
        dragState.startBounds.y + nextPoint.y - dragState.startPoint.y
      ),
      false
    )
  })

  ipcMain.on('kite-window:end-drag', (event) => {
    if (dragState?.senderId === event.sender.id) {
      dragState = null
    }
  })

  ipcMain.handle('kite-window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)

    if (!win || win.isDestroyed()) {
      return
    }

    if (win.isMaximized()) {
      win.unmaximize()
      return
    }

    win.maximize()
  })
}

function stopBackend() {
  shuttingDown = true
  if (!serverProcess || serverProcess.killed) {
    return
  }

  serverProcess.kill('SIGTERM')
  setTimeout(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGKILL')
    }
  }, 5000).unref()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    try {
      setupWindowIpc()
      const { port } = await startBackend()
      createWindow(port)
    } catch (error) {
      dialog.showErrorBox(
        'Unable to start Kite',
        error instanceof Error ? error.message : String(error)
      )
      app.quit()
    }
  })
}

app.on('before-quit', stopBackend)
app.on('window-all-closed', () => app.quit())
