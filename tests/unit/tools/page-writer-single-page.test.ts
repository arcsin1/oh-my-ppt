// @vitest-environment happy-dom

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: class BrowserWindow {},
  ipcMain: {},
  session: {}
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { createPageWriteTools } from '../../../src/main/agent-runtime/tools/page-writer'
import { requireSlideSizePreset } from '../../../src/shared/slide-size'

// 回归背景：网关推理模型会发起 update_single_page_file 时漏掉 pageId
// （kwargs 只有 content），触发 "Received tool input did not match expected
// schema"，页面永远写不进盘。单页上下文里应用本来就知道目标页，schema
// 因此放宽为可选并自动解析。

const noopStatus = vi.fn()

const buildContext = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'sess_test',
  mode: 'generate',
  appLocale: 'zh',
  projectDir: '/tmp',
  slideSize: requireSlideSizePreset('wide-16-9'),
  pageFileMap: {},
  outlineTitles: [],
  outlineItems: [],
  ...overrides
})

const getSinglePageTool = (context: Record<string, unknown>) => {
  const tools = createPageWriteTools({
    context: context as never,
    isEditMode: false,
    isContainerScopeEdit: false,
    emitNormalizedToolStatus: noopStatus
  })
  expect(tools).toHaveLength(1)
  return tools[0] as { schema: { shape: { pageId: { isOptional: () => boolean } } }; invoke: (input: unknown) => Promise<string> }
}

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('update_single_page_file schema and auto pageId', () => {
  it('makes pageId optional in the tool schema', () => {
    const tool = getSinglePageTool(
      buildContext({ selectedPageId: 'page-abc', pageFileMap: { 'page-abc': '/tmp/page-abc.html' } })
    )
    expect(tool.schema.shape.pageId.isOptional()).toBe(true)
  })

  it('writes the locked single page when pageId is omitted', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'ohmyppt-single-page-'))
    roots.push(projectDir)
    const targetPath = path.join(projectDir, 'page-abc.html')
    await writeFile(targetPath, '<html><body>old</body></html>', 'utf-8')

    const tool = getSinglePageTool(
      buildContext({
        selectedPageId: 'page-abc',
        pageFileMap: { 'page-abc': targetPath },
        projectDir
      })
    )
    const result = await tool.invoke({
      content: '<div class="page"><h1>测试标题</h1><p>正文内容</p></div>'
    })
    expect(result).toContain('page-abc')

    const persisted = await readFile(targetPath, 'utf-8')
    expect(persisted).toContain('测试标题')
    expect(persisted).not.toBe('<html><body>old</body></html>')
  })

  it('rejects a mismatched pageId', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'ohmyppt-single-page-'))
    roots.push(projectDir)
    const targetPath = path.join(projectDir, 'page-abc.html')
    await writeFile(targetPath, '<html><body>old</body></html>', 'utf-8')

    const tool = getSinglePageTool(
      buildContext({
        selectedPageId: 'page-abc',
        pageFileMap: { 'page-abc': targetPath },
        projectDir
      })
    )
    await expect(
      tool.invoke({ pageId: 'page-other', content: '<div>x</div>' })
    ).rejects.toThrow(/page-abc/)
  })
})
