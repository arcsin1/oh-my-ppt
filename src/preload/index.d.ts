import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI & {
      getPlatform?: () => NodeJS.Platform
      getPathForFile?: (file: File) => string
    }
  }
}
