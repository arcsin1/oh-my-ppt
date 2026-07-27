import {
  requirePersistedSlideSize,
  type SlideSizePresetId
} from '@shared/slide-size'
import type { CorporateTemplatePageRole } from '@shared/corporate-template'

export type TemplateSource = 'user'

export interface TemplateManifestPage {
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
  role?: CorporateTemplatePageRole
}

export interface TemplateManifest {
  schemaVersion: 1
  id: string
  name: string
  description: string
  sourceSessionId?: string
  createdAt: number
  updatedAt: number
  pageCount: number
  tags: string[]
  styleId?: string | null
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  designContract?: unknown
  pages: TemplateManifestPage[]
}

export interface TemplateListItem {
  id: string
  name: string
  description: string
  source: TemplateSource
  pageCount: number
  tags: string[]
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  previewHtmlPath: string | null
  thumbnailPath: string | null
  previewPages: Array<{
    pageNumber: number
    pageId: string
    title: string
    htmlPath: string
  }>
  createdAt: number
  updatedAt: number
}

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

export function parseTemplateManifest(raw: unknown): TemplateManifest {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const id = asString(record.id)
  const name = asString(record.name)
  if (!id) throw new Error('模板 manifest 缺少 id')
  if (!name) throw new Error('模板 manifest 缺少 name')
  const slideSize = requirePersistedSlideSize({
    id: asString(record.slideSizeId),
    width: asNumber(record.slideWidth),
    height: asNumber(record.slideHeight)
  })

  const rawPages = Array.isArray(record.pages) ? record.pages : []
  const pages = rawPages
    .map((item, index): TemplateManifestPage => {
      const page = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const pageNumber = Math.max(1, Math.floor(asNumber(page.pageNumber) || index + 1))
      const pageId = asString(page.pageId) || `page-${pageNumber}`
      return {
        pageNumber,
        pageId,
        title: asString(page.title) || `第 ${pageNumber} 页`,
        htmlPath: asString(page.htmlPath) || `pages/${pageId}.html`,
        role: ['cover', 'agenda', 'body', 'closing'].includes(asString(page.role))
          ? (asString(page.role) as CorporateTemplatePageRole)
          : undefined
      }
    })
    .sort((a, b) => a.pageNumber - b.pageNumber)

  return {
    schemaVersion: 1,
    id,
    name,
    description: asString(record.description),
    sourceSessionId: asString(record.sourceSessionId) || undefined,
    createdAt: asNumber(record.createdAt) || Date.now(),
    updatedAt: asNumber(record.updatedAt) || Date.now(),
    pageCount: Math.max(0, Math.floor(asNumber(record.pageCount) || pages.length)),
    tags: Array.isArray(record.tags)
      ? record.tags.map((tag) => asString(tag)).filter(Boolean).slice(0, 12)
      : [],
    styleId: asString(record.styleId) || null,
    slideSizeId: slideSize.id,
    slideWidth: slideSize.width,
    slideHeight: slideSize.height,
    designContract: record.designContract,
    pages
  }
}

export function manifestToListItem(
  manifest: TemplateManifest,
  paths: {
    previewHtmlPath: string | null
    previewPages: TemplateListItem['previewPages']
  }
): TemplateListItem {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    source: 'user',
    pageCount: manifest.pageCount || manifest.pages.length,
    tags: manifest.tags,
    slideSizeId: manifest.slideSizeId,
    slideWidth: manifest.slideWidth,
    slideHeight: manifest.slideHeight,
    previewHtmlPath: paths.previewHtmlPath,
    thumbnailPath: null,
    previewPages: paths.previewPages,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  }
}
