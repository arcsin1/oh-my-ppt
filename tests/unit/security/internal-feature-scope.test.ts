import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8')

describe('安居建业内部功能边界', () => {
  it('不注册自定义风格、风格预览和字体管理 IPC', () => {
    const ipcIndex = readSource('src/main/ipc/index.ts')
    const mainIndex = readSource('src/main/index.ts')
    expect(ipcIndex).not.toContain('registerStyleHandlers')
    expect(ipcIndex).not.toContain('registerStylePreviewHandlers')
    expect(ipcIndex).not.toContain('registerFontHandlers')
    expect(mainIndex).toContain('allowedStyleKeys: new Set([CORPORATE_STYLE_KEY])')
  })

  it('停用自定义模板管理，只保留公司模板创建入口', () => {
    const templateHandlers = readSource('src/main/ipc/templates/template-handlers.ts')
    expect(templateHandlers).toContain('const ENABLE_CUSTOM_TEMPLATE_MANAGEMENT = false')
    expect(templateHandlers).toContain("ipcMain.handle('templates:createSession'")
    expect(templateHandlers.match(/ENABLE_CUSTOM_TEMPLATE_MANAGEMENT &&/g)).toHaveLength(5)
  })

  it('不向内部版注册 Token 用量统计通道', () => {
    const settingsHandlers = readSource('src/main/ipc/config/settings-handlers.ts')
    const mainIndex = readSource('src/main/index.ts')
    expect(settingsHandlers).toContain('const ENABLE_TOKEN_USAGE_DASHBOARD = false')
    expect(settingsHandlers).toContain(
      "ENABLE_TOKEN_USAGE_DASHBOARD &&\n    ipcMain.handle('settings:getModelUsage'"
    )
    expect(mainIndex).not.toContain('configureModelUsageRecorder')
  })

  it('打包后移除通用风格与 MP4 运行组件', () => {
    const afterPack = readSource('build/after-pack.cjs')
    expect(afterPack).toContain("new Set(['anjian-corporate', 'manifest.json'])")
    expect(afterPack).toContain("path.join(unpackedResources, 'ffmpeg')")
    expect(afterPack).toContain('generic styles')
  })
})
