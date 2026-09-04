import type { BaseLanguageModel } from '@langchain/core/language_models/base'
import path from 'path'
import {
  CompositeBackend,
  FilesystemBackend,
  GENERAL_PURPOSE_SUBAGENT,
  type EditResult,
  type WriteResult
} from 'deepagents'
import { createProductSkillsMiddlewareSet } from '../skills/backend'
import type { RequiredProductSkillName } from '../../product-skills'

const normalizeVirtualPath = (filePath: string): string => {
  const normalized = filePath.trim().replace(/\\/g, '/')
  return path.posix.normalize(normalized.startsWith('/') ? normalized : `/${normalized}`)
}

export class GuardedFilesystemBackend extends FilesystemBackend {
  constructor(
    options: { rootDir?: string; virtualMode?: boolean; maxFileSizeMb?: number } & {
      disableEditFile?: boolean
      disableWriteFile?: boolean
      allowedEditPaths?: readonly string[]
      editBlockedReason?: string
      writeBlockedReason?: string
    }
  ) {
    super(options)
    this.disableEditFile = Boolean(options.disableEditFile)
    this.disableWriteFile = Boolean(options.disableWriteFile)
    this.allowedEditPaths = options.allowedEditPaths
      ? new Set(options.allowedEditPaths.map(normalizeVirtualPath))
      : undefined
    this.editBlockedReason =
      options.editBlockedReason ||
      '当前任务禁止调用 edit_file。请使用 update_single_page_file(pageId, content) 或 update_page_file(pageId, content)。'
    this.writeBlockedReason =
      options.writeBlockedReason || '当前任务禁止调用 write_file。请使用受控的页面写入工具。'
  }

  private readonly disableEditFile: boolean
  private readonly disableWriteFile: boolean
  private readonly allowedEditPaths: ReadonlySet<string> | undefined
  private readonly editBlockedReason: string
  private readonly writeBlockedReason: string

  async write(filePath: string, content: string): Promise<WriteResult> {
    if (this.disableWriteFile) return { error: this.writeBlockedReason }
    return super.write(filePath, content)
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean
  ): Promise<EditResult> {
    if (this.disableEditFile) return { error: this.editBlockedReason }
    if (this.allowedEditPaths && !this.allowedEditPaths.has(normalizeVirtualPath(filePath))) {
      const allowedPaths = [...this.allowedEditPaths].join(', ')
      return {
        error:
          `当前精修任务只能使用 edit_file 修改目标页面${allowedPaths ? `：${allowedPaths}` : ''}。`
      }
    }
    return super.edit(filePath, oldString, newString, replaceAll)
  }
}

export function createProductGeneralPurposeSubagent(args: {
  model: BaseLanguageModel
  tools: unknown[]
  backend: FilesystemBackend | CompositeBackend
  skillSource: string
  requiredSkillNames: readonly RequiredProductSkillName[]
}): any[] {
  if (!(args.backend instanceof CompositeBackend)) return []
  return [
    {
      ...GENERAL_PURPOSE_SUBAGENT,
      model: args.model as any,
      tools: args.tools as any,
      middleware: createProductSkillsMiddlewareSet(
        args.backend,
        args.skillSource,
        'general-purpose',
        args.requiredSkillNames
      )
    }
  ]
}
