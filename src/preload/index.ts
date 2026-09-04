import { contextBridge, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  ...electronAPI,
  getPlatform: (): NodeJS.Platform => process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = api
}
