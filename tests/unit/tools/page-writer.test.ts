import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron-log/main.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('../../../src/main/tools/font-registry', () => ({
  buildFontHeadTags: vi.fn(
    async () =>
      '<style data-ppt-fonts="1">:root{--ppt-title-font:"Inter";--ppt-body-font:"Inter"}</style>'
  )
}))

import { createPageWriteTools } from '../../../src/main/tools/page-writer'

const tempDirs: string[] = []

const makeTempProjectDir = async (): Promise<string> => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'page-writer-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true }))
  )
})

describe('page writer animation warnings', () => {
  it('returns fidelity warnings from update_single_page_file without blocking the write', async () => {
    const projectDir = await makeTempProjectDir()
    const pagePath = path.join(projectDir, 'page-1.html')
    const tools = createPageWriteTools({
      context: {
        sessionId: 'session-1',
        projectDir,
        indexPath: path.join(projectDir, 'index.html'),
        pageFileMap: { 'page-1': pagePath },
        selectedPageId: 'page-1',
        topic: 'test',
        deckTitle: 'Deck',
        styleId: null,
        userMessage: 'write one page',
        outlineTitles: ['Overview'],
        outlineItems: []
      },
      isEditMode: false,
      isContainerScopeEdit: false,
      emitNormalizedToolStatus: () => undefined
    })
    const updateSinglePage = tools.find(
      (tool) => (tool as { name?: string }).name === 'update_single_page_file'
    ) as { invoke: (input: { pageId: string; content: string }) => Promise<string> } | undefined

    expect(updateSinglePage).toBeTruthy()

    const result = await updateSinglePage!.invoke({
      pageId: 'page-1',
      content: '<div data-anim="slide-up">Overview</div>'
    })

    expect(result).toContain(`Updated page-1 in ${pagePath}`)
    expect(result).toContain('Warnings:')
    expect(result).toContain('动画 slide-up 为 approximate 保真度')
    expect(await fs.promises.readFile(pagePath, 'utf-8')).toContain('data-anim="slide-up"')
  })
})
