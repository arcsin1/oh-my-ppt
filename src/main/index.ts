import './external-agent/mcp-stdout-guard'
import { app, BrowserWindow } from 'electron'
import { isMcpStdioLaunch, runMcpStdioBridge } from './external-agent/mcp-stdio'

if (isMcpStdioLaunch()) {
  app.on('window-all-closed', () => undefined)
  void app.whenReady().then(() => {
    new BrowserWindow({ show: false, skipTaskbar: true, width: 1, height: 1 })
    return runMcpStdioBridge()
  })
} else {
  void import('./app/application').then(({ MainApplication }) => {
    const mainApplication = new MainApplication()
    const gotSingleInstanceLock = app.requestSingleInstanceLock()

    if (!gotSingleInstanceLock) {
      app.quit()
    } else {
      app.on('second-instance', () => mainApplication.focusMainWindow())
      app.whenReady().then(() => mainApplication.start())
    }

    app.on('window-all-closed', () => mainApplication.handleWindowAllClosed())
    app.on('before-quit', () => mainApplication.handleBeforeQuit())
  })
}
