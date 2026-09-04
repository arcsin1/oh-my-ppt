import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

type WindowControlState = {
  isFullscreen: boolean
}

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window && !window.isDestroyed() ? window : null
}

function getWindowState(window: BrowserWindow): WindowControlState {
  return { isFullscreen: window.isFullScreen() }
}

function emitWindowState(window: BrowserWindow): void {
  if (!window.isDestroyed()) window.webContents.send('window:control:stateChanged', getWindowState(window))
}

export function registerWindowControlHandlers(): void {
  ipcMain.handle('window:control:getState', (event): WindowControlState => {
    const window = getSenderWindow(event)
    return { isFullscreen: window?.isFullScreen() ?? false }
  })

  ipcMain.handle('window:control:minimize', (event): void => {
    getSenderWindow(event)?.minimize()
  })

  ipcMain.handle('window:control:toggleFullscreen', (event): WindowControlState => {
    const window = getSenderWindow(event)
    if (!window) return { isFullscreen: false }

    window.setFullScreen(!window.isFullScreen())
    return getWindowState(window)
  })

  ipcMain.handle('window:control:close', (event): void => {
    getSenderWindow(event)?.close()
  })
}

export function attachWindowControlStateEvents(window: BrowserWindow): void {
  window.on('enter-full-screen', () => emitWindowState(window))
  window.on('leave-full-screen', () => emitWindowState(window))
  window.webContents.on('before-input-event', (event, input) => {
    if (!window.isFullScreen() || input.type !== 'keyDown' || input.key !== 'Escape') return
    event.preventDefault()
    window.setFullScreen(false)
  })
}
