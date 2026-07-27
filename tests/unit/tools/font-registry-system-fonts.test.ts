import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/anjian-ppt-font-registry-test')
  },
  BrowserWindow: class BrowserWindow {},
  ipcMain: {},
  session: {}
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: true
  }
}))

describe('font registry system fonts', () => {
  it('accepts the KaiTi family required by the corporate template', async () => {
    const { assertFontFamilyAvailable } = await import('../../../src/main/tools/font-registry')

    await expect(assertFontFamilyAvailable('KaiTi', 'titleFont')).resolves.toBeUndefined()
  })
})
