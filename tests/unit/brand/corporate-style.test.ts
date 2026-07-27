import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readStylePackage } from '../../../src/main/styles/style-package'
import { CORPORATE_STYLE_KEY } from '../../../src/shared/brand'

describe('安居建业公司风格包', () => {
  it('通过安全校验且不包含可执行脚本', async () => {
    const stylePath = path.join(process.cwd(), 'resources', 'styles', CORPORATE_STYLE_KEY)
    const stylePackage = await readStylePackage(stylePath)

    expect(stylePackage.json.style).toBe(CORPORATE_STYLE_KEY)
    expect(stylePackage.json.source).toBe('builtin')
    const previewHtml = await fs.readFile(stylePackage.previewPath || '', 'utf8')
    expect(previewHtml).not.toMatch(/<script\b/i)
  })
})
