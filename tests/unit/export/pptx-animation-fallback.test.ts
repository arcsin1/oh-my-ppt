import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8')

describe('PPTX animation compatibility fallback', () => {
  it('exports native animation when possible and tells users static content remains', () => {
    const exporter = readSource('src/main/ipc/io/export-handlers.ts')
    const freezeScript = readSource('src/main/utils/html-pptx/browser-scripts.ts')

    expect(exporter).toContain('nativeAnimationCount')
    expect(exporter).toContain('已尝试写入')
    expect(exporter).toContain('最终静态内容')
    expect(freezeScript).toContain('[data-anim] { opacity: 1 !important; transform: none !important; }')
    expect(freezeScript).toContain('data-pptx-native-anim')
  })
})
