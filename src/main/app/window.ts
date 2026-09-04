import { app, BrowserWindow, screen, shell, type Size } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { attachRendererCrashRecovery } from './lifecycle'
import { configureWindowMenu } from './menu'

const APP_NAME = 'OhMyPPT'
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 820
const BASE_MIN_WIDTH = 880
const BASE_MIN_HEIGHT = 680
const TITLEBAR_HEIGHT = 48
const TITLEBAR_BACKGROUND = '#f4eddf'
const __dirname = dirname(fileURLToPath(import.meta.url))
// electron-vite bundles this module into out/main/index.js. Keep asset paths
// relative to that runtime location rather than this source file's directory.
const mainOutputDir = __dirname

const resolveWindowBounds = (): {
  width: number
  height: number
  minWidth: number
  minHeight: number
  workArea: Size
} => {
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const maxInitialWidth = Math.max(900, workArea.width - 72)
  const maxInitialHeight = Math.max(620, workArea.height - 88)
  const minWidth = Math.min(BASE_MIN_WIDTH, maxInitialWidth)
  const minHeight = Math.min(BASE_MIN_HEIGHT, maxInitialHeight)
  const width = Math.max(minWidth, Math.min(DEFAULT_WINDOW_WIDTH, maxInitialWidth))
  const height = Math.max(minHeight, Math.min(DEFAULT_WINDOW_HEIGHT, maxInitialHeight))

  return { width, height, minWidth, minHeight, workArea }
}

export type MainWindowOptions = {
  isShuttingDown(): boolean
  isTrayEnabled(): boolean
  onHideToTray(): void
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const preloadPath = join(mainOutputDir, '../preload/index.mjs')
  const windowBounds = resolveWindowBounds()
  const iconPath = join(mainOutputDir, '../../build/icons/512x512.png')

  if (isMac && existsSync(iconPath)) {
    try {
      app.dock?.setIcon(iconPath)
    } catch {
      // Ignore a platform-specific dock icon failure.
    }
  }

  const window = new BrowserWindow({
    title: APP_NAME,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: windowBounds.minWidth,
    minHeight: windowBounds.minHeight,
    center: true,
    show: false,
    backgroundColor: TITLEBAR_BACKGROUND,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    ...(isMac
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 14, y: Math.round((TITLEBAR_HEIGHT - 14) / 2) }
        }
      : {
          frame: false
        }),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: true
    }
  })
  configureWindowMenu(window)

  window.on('close', (event) => {
    if (process.platform === 'win32' && options.isTrayEnabled() && !options.isShuttingDown()) {
      event.preventDefault()
      window.hide()
      options.onHideToTray()
    }
  })

  log.info('[app] creating window', {
    preloadPath,
    contextIsolation: true,
    sandbox: false,
    window: {
      width: windowBounds.width,
      height: windowBounds.height,
      minWidth: windowBounds.minWidth,
      minHeight: windowBounds.minHeight,
      workArea: windowBounds.workArea,
      titlebarHeight: TITLEBAR_HEIGHT,
      titleBarStyle: isMac ? 'hidden' : 'frameless'
    }
  })

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const loadHome = (): void => {
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
      rendererUrl.hash = '/'
      void window.loadURL(rendererUrl.toString())
      return
    }
    void window.loadFile(join(mainOutputDir, '../renderer/index.html'), { hash: '/' })
  }
  attachRendererCrashRecovery(window, { isShuttingDown: options.isShuttingDown, loadHome })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(mainOutputDir, '../renderer/index.html'))
  }
  return window
}

export function showMainWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
