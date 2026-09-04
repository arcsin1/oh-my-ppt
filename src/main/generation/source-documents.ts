import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { GenerationContext } from './context'
import type { GenerateMode } from './types'

/**
 * Resolve only the durable session reference document. Transient attachments
 * deliberately stay out of this contract because they must not enable the
 * page-level Reference Range Content Boundary mode.
 */
export const resolveSessionReferenceDocumentPath = (
  projectDir: string,
  sessionRecord: Record<string, unknown>
): string | null => {
  const rawReferenceDocumentPath =
    sessionRecord.referenceDocumentPath ?? sessionRecord.reference_document_path
  const referenceDocumentPath =
    typeof rawReferenceDocumentPath === 'string' ? rawReferenceDocumentPath.trim() : ''
  if (!referenceDocumentPath) return null

  const docsDir = path.resolve(projectDir, 'docs')
  const filePath = referenceDocumentPath.startsWith('/docs/')
    ? path.resolve(projectDir, referenceDocumentPath.replace(/^\/+/, ''))
    : path.isAbsolute(referenceDocumentPath)
      ? path.resolve(referenceDocumentPath)
      : path.resolve(docsDir, referenceDocumentPath)
  const relativeToDocs = path.relative(docsDir, filePath)
  if (!relativeToDocs || relativeToDocs.startsWith('..') || path.isAbsolute(relativeToDocs)) {
    return null
  }

  try {
    if (!fs.statSync(filePath).isFile()) return null
  } catch {
    return null
  }

  return `/docs/${relativeToDocs.split(path.sep).join('/')}`
}

const sanitizeAttachmentFileName = (sourcePath: string): { stem: string; extension: string } => {
  const originalName = path.basename(sourcePath)
  const extension = path.extname(originalName).replace(/[\\/:"*?<>|]+/g, '-')
  const rawStem = originalName.slice(0, Math.max(0, originalName.length - extension.length))
  const stem = rawStem.replace(/[\\/:"*?<>|]+/g, '-').trim() || 'attachment'
  return { stem, extension }
}

const sha256 = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

const copyAttachmentWithContentHash = async (args: {
  sourcePath: string
  sessionDocsDir: string
}): Promise<string> => {
  const content = await fs.promises.readFile(args.sourcePath)
  const contentHash = sha256(content)
  const { stem, extension } = sanitizeAttachmentFileName(args.sourcePath)
  const targetStem = `${stem}--${contentHash.slice(0, 16)}`

  for (let collisionIndex = 0; collisionIndex < 10_000; collisionIndex += 1) {
    const collisionSuffix = collisionIndex === 0 ? '' : `--${collisionIndex + 1}`
    const targetName = `${targetStem}${collisionSuffix}${extension}`
    const targetPath = path.join(args.sessionDocsDir, targetName)
    if (path.resolve(args.sourcePath) === path.resolve(targetPath)) return `/docs/${targetName}`

    try {
      const existingHash = sha256(await fs.promises.readFile(targetPath))
      if (existingHash === contentHash) return `/docs/${targetName}`
      continue
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    try {
      await fs.promises.copyFile(args.sourcePath, targetPath, fs.constants.COPYFILE_EXCL)
      return `/docs/${targetName}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  throw new Error(`Unable to create a collision-safe attachment path for ${path.basename(args.sourcePath)}`)
}

export async function resolveSourceDocuments(
  ctx: Pick<GenerationContext, 'localFiles'>,
  args: {
    sessionId: string
    projectDir: string
    rawDocPaths: string[]
    // Kept as an explicit entry-mode contract for callers. The current resolver
    // uses the same session reference/raw-doc behavior for every mode.
    mode: GenerateMode
    sessionRecord: Record<string, unknown>
  }
): Promise<string[]> {
  const { sessionId, projectDir, rawDocPaths, sessionRecord } = args
  const { assertPathInAllowedRoots } = ctx.localFiles
  const referenceDocumentPath = resolveSessionReferenceDocumentPath(projectDir, sessionRecord)

  const sessionDocsDir = path.join(projectDir, 'docs')
  const sourceDocumentPaths: string[] = []
  const appendSourceDocumentPath = (docPath: string | null): void => {
    if (!docPath || sourceDocumentPaths.includes(docPath)) return
    sourceDocumentPaths.push(docPath)
  }
  appendSourceDocumentPath(referenceDocumentPath)

  if (rawDocPaths.length > 0) {
    await fs.promises.mkdir(sessionDocsDir, { recursive: true })
    for (const candidate of rawDocPaths) {
      const sourcePath = await assertPathInAllowedRoots({
        filePath: candidate,
        mode: 'read',
        sessionId
      })
      appendSourceDocumentPath(
        await copyAttachmentWithContentHash({ sourcePath, sessionDocsDir })
      )
    }
    return sourceDocumentPaths
  }

  if (sourceDocumentPaths.length > 0) await fs.promises.mkdir(sessionDocsDir, { recursive: true })
  return sourceDocumentPaths
}
