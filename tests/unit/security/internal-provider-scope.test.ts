import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  isCompanyTextProvider,
  REDACTED_LOCAL_SECRET
} from '../../../src/shared/company-config'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8')

describe('安居建业受控 BYOK 模型范围', () => {
  it('只接受 OpenAI 兼容文本协议', () => {
    expect(isCompanyTextProvider('openai')).toBe(true)
    expect(isCompanyTextProvider('openai-responses')).toBe(true)
    expect(isCompanyTextProvider('anthropic')).toBe(false)
    expect(isCompanyTextProvider('google')).toBe(false)
  })

  it('不把已保存的文本或生图密钥返回给渲染进程', () => {
    const textHandlers = readSource('src/main/ipc/config/settings-handlers.ts')
    const imageHandlers = readSource('src/main/ipc/config/image-model-handlers.ts')

    expect(REDACTED_LOCAL_SECRET).not.toBe('')
    expect(textHandlers).toContain('REDACTED_LOCAL_SECRET')
    expect(textHandlers).toContain(
      "apiKey: decryptApiKey(config.apiKey).trim() ? REDACTED_LOCAL_SECRET : ''"
    )
    expect(imageHandlers).toContain('redactModelConfig')
    expect(imageHandlers).not.toContain('modelConfig: decryptApiKey(config.modelConfig')
  })
})
