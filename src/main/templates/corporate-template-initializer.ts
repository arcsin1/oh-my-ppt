import fs from 'node:fs'
import path from 'node:path'
import { is } from '@electron-toolkit/utils'
import { CORPORATE_TEMPLATE_ID } from '@shared/brand'
import { ensureTemplatesRoot, resolveTemplateDir } from '../ipc/templates/template-paths'
import { parseTemplateManifest } from '../ipc/templates/template-manifest'

export interface CorporateTemplateInitializerLogger {
  info?: (message: string, meta?: Record<string, unknown>) => void
  warn?: (message: string, meta?: Record<string, unknown>) => void
}

export function resolveBundledCorporateTemplatePath(): string {
  const root = is.dev
    ? path.join(process.cwd(), 'resources', 'corporate-template')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'corporate-template')
  return path.join(root, CORPORATE_TEMPLATE_ID)
}

async function readManifest(templateDir: string): Promise<ReturnType<typeof parseTemplateManifest>> {
  const raw = await fs.promises.readFile(path.join(templateDir, 'manifest.json'), 'utf8')
  return parseTemplateManifest(JSON.parse(raw))
}

export async function initializeCorporateTemplate(options?: {
  bundledTemplatePath?: string
  logger?: CorporateTemplateInitializerLogger
}): Promise<{ copied: boolean; templateId: string; version: number }> {
  const logger = options?.logger
  const bundledTemplatePath = options?.bundledTemplatePath || resolveBundledCorporateTemplatePath()
  const bundledManifest = await readManifest(bundledTemplatePath)
  if (bundledManifest.id !== CORPORATE_TEMPLATE_ID) {
    throw new Error(`公司模板 ID 不匹配：${bundledManifest.id}`)
  }

  const templatesRoot = await ensureTemplatesRoot()
  const installedTemplatePath = resolveTemplateDir(templatesRoot, CORPORATE_TEMPLATE_ID)
  const installedManifest = await readManifest(installedTemplatePath).catch(() => null)
  if (installedManifest && installedManifest.updatedAt >= bundledManifest.updatedAt) {
    logger?.info?.('[corporate-template] already current', {
      templateId: CORPORATE_TEMPLATE_ID,
      version: bundledManifest.updatedAt
    })
    return {
      copied: false,
      templateId: CORPORATE_TEMPLATE_ID,
      version: bundledManifest.updatedAt
    }
  }

  const stagingPath = `${installedTemplatePath}.staging-${process.pid}-${Date.now()}`
  await fs.promises.rm(stagingPath, { recursive: true, force: true })
  await fs.promises.cp(bundledTemplatePath, stagingPath, { recursive: true })
  await readManifest(stagingPath)
  await fs.promises.rm(installedTemplatePath, { recursive: true, force: true })
  await fs.promises.rename(stagingPath, installedTemplatePath)
  logger?.info?.('[corporate-template] installed', {
    templateId: CORPORATE_TEMPLATE_ID,
    version: bundledManifest.updatedAt
  })
  return {
    copied: true,
    templateId: CORPORATE_TEMPLATE_ID,
    version: bundledManifest.updatedAt
  }
}
