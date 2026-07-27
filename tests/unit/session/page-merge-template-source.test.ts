import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadEditableSessionPages: vi.fn(),
  persistManagedPages: vi.fn(),
  ensureHistoryBaselineSafe: vi.fn(),
  recordHistoryOperationStrict: vi.fn(),
  buildFontHeadTags: vi.fn(),
  loadTemplateManifest: vi.fn(),
  listTemplates: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn()
}))

vi.mock('electron-log/main.js', () => ({
  default: { info: mocks.logInfo, warn: mocks.logWarn, error: mocks.logError }
}))

vi.mock('../../../src/main/ipc/session/page-management-service', () => ({
  loadEditableSessionPages: mocks.loadEditableSessionPages,
  persistManagedPages: mocks.persistManagedPages
}))

vi.mock('../../../src/main/history/git-history-service', () => ({
  ensureHistoryBaselineSafe: mocks.ensureHistoryBaselineSafe,
  recordHistoryOperationStrict: mocks.recordHistoryOperationStrict
}))

vi.mock('../../../src/main/ipc/engine/template', () => ({
  SESSION_ASSET_FILE_NAMES: ['ppt-runtime.js']
}))

vi.mock('../../../src/main/tools/html-utils', () => ({
  validatePersistedPageHtml: () => ({ valid: true, errors: [] })
}))

vi.mock('../../../src/main/tools/font-registry', () => ({
  buildFontHeadTags: mocks.buildFontHeadTags
}))

vi.mock('../../../src/main/ipc/templates/template-service', () => ({
  loadTemplateManifest: mocks.loadTemplateManifest,
  listTemplates: mocks.listTemplates
}))

vi.mock('../../../src/main/ipc/templates/template-paths', () => ({
  resolveTemplateRelativePath: (templateDir: string, relativePath?: string) => {
    if (!relativePath) return null
    const resolved = path.resolve(templateDir, relativePath)
    const rel = path.relative(templateDir, resolved)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
    return resolved
  }
}))

import {
  listMergeSourceTemplatePages,
  listMergeSourceTemplates,
  mergeSessionPages
} from '../../../src/main/ipc/session/page-merge-service'

const wideSlideSize = { slideSizeId: 'wide-16-9', slideWidth: 1600, slideHeight: 900 }

describe('mergeSessionPages template source', () => {
  let root: string
  let templateDir: string
  let targetProjectDir: string
  let upsertedPages: Array<{ id: string; title: string; pageNumber: number; fileSlug: string }>

  const createContext = (targetMetadata = '{}') => ({
    db: {
      getSession: vi.fn(async (sessionId: string) => ({
        id: sessionId,
        title: 'Target deck',
        status: 'completed',
        metadata: targetMetadata,
        ...wideSlideSize
      })),
      getProject: vi.fn(async () => ({ id: 'project', status: 'published' })),
      listSourcePageSkeletons: vi.fn(async () => []),
      upsertSessionPage: vi.fn(async (page: never) => {
        upsertedPages.push(page)
      }),
      upsertSourcePageSkeleton: vi.fn(),
      updateProjectStatus: vi.fn(),
      updateSessionStatus: vi.fn(),
      hardDeleteSessionPages: vi.fn(),
      deleteSourcePageSkeletons: vi.fn(),
      replaceSessionPageOrder: vi.fn(),
      updateSessionMetadata: vi.fn()
    },
    sessionRunStates: new Map(),
    getPageSourceUrl: (htmlPath?: string) => (htmlPath ? `file://${htmlPath}` : undefined)
  })

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'page-merge-template-'))
    templateDir = path.join(root, 'tpl_anjian_standard_v1')
    targetProjectDir = path.join(root, 'target')
    upsertedPages = []

    await fs.promises.mkdir(path.join(templateDir, 'assets', 'fonts'), { recursive: true })
    await fs.promises.mkdir(path.join(targetProjectDir, 'assets', 'fonts'), { recursive: true })
    await fs.promises.writeFile(
      path.join(templateDir, 'assets', 'fonts', 'source.woff2'),
      'source-font'
    )
    await fs.promises.writeFile(
      path.join(targetProjectDir, 'assets', 'fonts', 'target.woff2'),
      'target-font'
    )
    await fs.promises.writeFile(
      path.join(templateDir, 'page-one.html'),
      '<html><head><style data-ppt-fonts="google">@font-face{font-family:"Source Font";src:url("./assets/fonts/source.woff2") format("woff2")}</style><style data-ppt-fonts="1">:root{--ppt-title-font:"Source Font";--ppt-body-font:"Source Font"}</style><style>.t{font-family:"Source Font"}</style></head><body data-page-id="page-tpl-1"><p class="t">Template</p></body></html>'
    )
    await fs.promises.writeFile(
      path.join(targetProjectDir, 'existing.html'),
      '<html><head><style data-ppt-fonts="google">@font-face{font-family:"Target Font";src:url("./assets/fonts/target.woff2") format("woff2")}</style><style data-ppt-fonts="1">:root{--ppt-title-font:"Target Font";--ppt-body-font:"Target Font"}</style></head><body data-page-id="existing"><p>Existing</p></body></html>'
    )
    await fs.promises.writeFile(path.join(targetProjectDir, 'index.html'), '<html>old index</html>')

    mocks.loadTemplateManifest.mockResolvedValue({
      manifest: {
        schemaVersion: 1 as const,
        id: 'tpl_anjian_standard_v1',
        name: 'Source Template',
        description: '',
        pageCount: 1,
        tags: [],
        styleId: null,
        slideSizeId: 'wide-16-9',
        slideWidth: 1600,
        slideHeight: 900,
        designContract: undefined,
        pages: [
          {
            pageNumber: 1,
            pageId: 'page-tpl-1',
            title: 'Template Page',
            htmlPath: 'page-one.html'
          }
        ]
      },
      templateDir
    })
    mocks.loadEditableSessionPages.mockResolvedValue({
      session: { ...wideSlideSize },
      projectDir: targetProjectDir,
      indexPath: path.join(targetProjectDir, 'index.html'),
      deckTitle: 'Target',
      pages: [
        {
          id: 'target-page-1',
          pageNumber: 1,
          pageId: 'existing',
          title: 'Existing',
          htmlPath: path.join(targetProjectDir, 'existing.html'),
          status: 'completed'
        }
      ]
    })
    mocks.persistManagedPages.mockImplementation(async (_ctx, args) => args.pages)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    await fs.promises.rm(root, { recursive: true, force: true })
  })

  it('only exposes the corporate source template for page merging', async () => {
    mocks.listTemplates.mockResolvedValue({
      items: [
        {
          id: 'tpl_other',
          name: 'Other',
          pageCount: 2,
          ...wideSlideSize,
          updatedAt: 2,
          thumbnailPath: null,
          previewPages: [{ pageNumber: 1, pageId: 'p', title: 'p', htmlPath: 'p.html' }]
        },
        {
          id: 'tpl_anjian_standard_v1',
          name: 'Source Template',
          pageCount: 1,
          ...wideSlideSize,
          updatedAt: 1,
          thumbnailPath: null,
          previewPages: [{ pageNumber: 1, pageId: 'p', title: 'p', htmlPath: 'p.html' }]
        },
        {
          id: 'tpl_small',
          name: 'Small',
          pageCount: 1,
          slideSizeId: 'square-1-1',
          slideWidth: 1000,
          slideHeight: 1000,
          updatedAt: 3,
          thumbnailPath: null,
          previewPages: [{ pageNumber: 1, pageId: 'p', title: 'p', htmlPath: 'p.html' }]
        }
      ]
    })

    const context = createContext(
      JSON.stringify({ source: 'template', templateId: 'tpl_anjian_standard_v1' })
    )

    const result = await listMergeSourceTemplates(context as never, 'target')

    expect(result.map((item) => item.id)).toEqual(['tpl_anjian_standard_v1'])
    expect(result[0]).toEqual(
      expect.objectContaining({ id: 'tpl_anjian_standard_v1', isSource: true, selectable: true })
    )
    expect(result.find((item) => item.id === 'tpl_small')).toBeUndefined()
    expect(result.find((item) => item.id === 'tpl_other')).toBeUndefined()
  })

  it('keeps template fonts as-is (preserveFonts) instead of normalizing to the target deck', async () => {
    const context = createContext()

    const result = await mergeSessionPages(context as never, {
      targetSessionId: 'target',
      sourceType: 'template',
      sourceTemplateId: 'tpl_anjian_standard_v1',
      sourcePageIds: ['tpl_anjian_standard_v1:1']
    })

    expect(result.insertedPageIds).toHaveLength(1)
    expect(upsertedPages.map((page) => page.title)).toEqual(['Template Page'])

    const inserted = upsertedPages[0]
    const copiedHtml = await fs.promises.readFile(
      path.join(targetProjectDir, `${inserted.fileSlug}.html`),
      'utf-8'
    )
    expect(copiedHtml).toContain('Source Font')
    expect(copiedHtml).not.toContain('Target Font')
    const copiedAssets = await fs.promises.readdir(
      path.join(targetProjectDir, 'assets', 'merged-pages'),
      { recursive: true }
    )
    expect(copiedAssets.some((entry) => String(entry).endsWith('source.woff2'))).toBe(true)
  })

  it('rejects a template whose canvas size differs from the target session', async () => {
    mocks.loadTemplateManifest.mockResolvedValue({
      manifest: {
        schemaVersion: 1 as const,
        id: 'tpl_anjian_standard_v1',
        name: 'Source Template',
        description: '',
        pageCount: 1,
        tags: [],
        styleId: null,
        slideSizeId: 'square-1-1',
        slideWidth: 1000,
        slideHeight: 1000,
        designContract: undefined,
        pages: [
          { pageNumber: 1, pageId: 'page-tpl-1', title: 'Template Page', htmlPath: 'page-one.html' }
        ]
      },
      templateDir
    })
    const context = createContext()

    await expect(
      mergeSessionPages(context as never, {
        targetSessionId: 'target',
        sourceType: 'template',
        sourceTemplateId: 'tpl_anjian_standard_v1',
        sourcePageIds: ['tpl_anjian_standard_v1:1']
      })
    ).rejects.toMatchObject({ code: 'PAGE_MERGE_SLIDE_SIZE_MISMATCH' })

    expect(upsertedPages).toEqual([])
  })

  it('rejects template page listing when the canvas size differs from the target session', async () => {
    mocks.loadTemplateManifest.mockResolvedValue({
      manifest: {
        schemaVersion: 1 as const,
        id: 'tpl_anjian_standard_v1',
        name: 'Source Template',
        description: '',
        pageCount: 1,
        tags: [],
        styleId: null,
        slideSizeId: 'square-1-1',
        slideWidth: 1000,
        slideHeight: 1000,
        designContract: undefined,
        pages: [
          { pageNumber: 1, pageId: 'page-tpl-1', title: 'Template Page', htmlPath: 'page-one.html' }
        ]
      },
      templateDir
    })
    const context = createContext()

    await expect(
      listMergeSourceTemplatePages(context as never, 'target', 'tpl_anjian_standard_v1')
    ).rejects.toMatchObject({ code: 'PAGE_MERGE_SLIDE_SIZE_MISMATCH' })
  })
})
