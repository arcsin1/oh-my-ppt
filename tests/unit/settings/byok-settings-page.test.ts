import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('受控 BYOK 设置页', () => {
  it('提供服务预设、目标域名提示和本机密钥清除入口', () => {
    const settingsPage = readSource('src/renderer/src/pages/settings.tsx')

    expect(settingsPage).toContain('BYOK_SERVICE_PRESETS.map')
    expect(settingsPage).toContain('资料发送目标：')
    expect(settingsPage).toContain('DEFAULT_BYOK_PRESET.defaultBaseUrl')
    expect(settingsPage).toContain('清除本机配置')
    expect(settingsPage).toContain('Mac 调试环境不支持时仅保留到本次运行结束')
    expect(settingsPage).toContain('Key 只在内存中，关闭软件后失效')
    expect(settingsPage).not.toContain('管理员尚未配置')
  })

  it('只在 AI 操作缺少配置时引导设置，旧 PPTX 本地导入不要求模型', () => {
    const modelAction = readSource('src/renderer/src/hooks/useModelAction.ts')
    const home = readSource('src/renderer/src/pages/home.tsx')
    const importSection = home.slice(
      home.indexOf('const handleImportPptxClick'),
      home.indexOf('useEffect(() =>')
    )

    expect(modelAction).toContain("navigate('/settings')")
    expect(importSection).toContain('validateStorageReady')
    expect(importSection).not.toContain('ensureModelActive')
  })
})
