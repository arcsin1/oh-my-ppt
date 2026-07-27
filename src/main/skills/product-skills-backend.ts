import path from 'path'
import { createMiddleware } from 'langchain'
import {
  CompositeBackend,
  FilesystemBackend,
  createSkillsMiddleware,
  type EditResult,
  type FileDownloadResponse,
  type WriteResult
} from 'deepagents'
import log from 'electron-log/main.js'
import {
  PRODUCT_SKILLS_ROUTE,
  REQUIRED_PRODUCT_SKILL_NAMES,
  SYSTEM_SKILLS_SOURCE_PATH,
  type RequiredProductSkillName
} from './skill-contract'
import { getInstalledSkillsPath, waitForSkillsReady } from './skill-runtime'

class ReadOnlyFilesystemBackend extends FilesystemBackend {
  async write(filePath: string, _content: string): Promise<WriteResult> {
    return { error: `Product skills are read-only: ${filePath}` }
  }

  async edit(
    filePath: string,
    _oldString: string,
    _newString: string,
    _replaceAll?: boolean
  ): Promise<EditResult> {
    return { error: `Product skills are read-only: ${filePath}` }
  }
}

class FilteredReadOnlySkillsBackend extends ReadOnlyFilesystemBackend {
  constructor(
    options: { rootDir?: string; virtualMode?: boolean; maxFileSizeMb?: number } & {
      allowedSkillNames: readonly string[]
    }
  ) {
    super(options)
    this.allowedSkillNames = new Set(options.allowedSkillNames)
  }

  private readonly allowedSkillNames: Set<string>

  private resolveSkillName(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    return parts.find((part) => this.allowedSkillNames.has(part)) || parts[0] || ''
  }

  private isAllowed(filePath: string): boolean {
    const skillName = this.resolveSkillName(filePath)
    return Boolean(skillName && this.allowedSkillNames.has(skillName))
  }

  async ls(dirPath: string) {
    const result = await super.ls(dirPath)
    if (result.error || !result.files) return result
    if (this.isAllowed(dirPath)) return result
    return {
      ...result,
      files: result.files.filter((file) => {
        const normalized = file.path.replace(/\\/g, '/').replace(/\/$/, '')
        const name = normalized.split('/').filter(Boolean).pop() || ''
        return file.is_dir && this.allowedSkillNames.has(name)
      })
    }
  }

  async read(filePath: string, offset?: number, length?: number) {
    if (!this.isAllowed(filePath)) {
      return { error: `Product skill is not enabled for this canvas: ${filePath}` }
    }
    return super.read(filePath, offset, length)
  }

  async downloadFiles(filePaths: string[]): Promise<FileDownloadResponse[]> {
    const allowed = filePaths.map((filePath) => this.isAllowed(filePath))
    if (allowed.every(Boolean)) return super.downloadFiles(filePaths)
    const downloads = await Promise.all(
      filePaths.map((filePath, index) =>
        allowed[index]
          ? super.downloadFiles([filePath]).then((items) => items[0])
          : Promise.resolve({
              path: filePath,
              content: new Uint8Array(),
              error: 'permission_denied' as const
            })
      )
    )
    return downloads
  }
}

const SKILLS_READY_TIMEOUT_MS = 3000

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs)
    })
  ])
}

function createSkillsReadyMiddleware(
  backend: CompositeBackend,
  skillSource: string,
  scope: string,
  requiredSkillNames: readonly RequiredProductSkillName[] = REQUIRED_PRODUCT_SKILL_NAMES
) {
  let hasLoggedReadySkills = false
  return createMiddleware({
    name: 'OhMyPptSkillsReadyMiddleware',
    async beforeAgent() {
      const initResult = await waitWithTimeout(waitForSkillsReady(), SKILLS_READY_TIMEOUT_MS)
      if (initResult === null) {
        throw new Error(
          '产品 skill 初始化未完成，无法创建生成/编辑 Agent。请重启应用或检查 resources/skills。'
        )
      }

      const readySkillNames: string[] = []
      for (const skillName of requiredSkillNames) {
        const skillPath = `${skillSource}${skillName}/SKILL.md`
        const readResult = await backend.read(skillPath, 0, 20)
        if (readResult.error) {
          throw new Error(`必需产品 skill 不可用：${skillPath}。${readResult.error}`)
        }
        readySkillNames.push(skillName)
      }

      if (!hasLoggedReadySkills) {
        hasLoggedReadySkills = true
        log.info('[skills] required product skills ready', {
          scope,
          source: skillSource,
          skills: readySkillNames
        })
      }
      return undefined
    }
  })
}

export function createProductSkillsMiddlewareSet(
  backend: CompositeBackend,
  skillSource: string,
  scope: string,
  requiredSkillNames: readonly RequiredProductSkillName[] = REQUIRED_PRODUCT_SKILL_NAMES
): any[] {
  return [
    createSkillsReadyMiddleware(backend, skillSource, scope, requiredSkillNames),
    createSkillsMiddleware({
      backend,
      sources: [skillSource]
    })
  ]
}

export function attachProductSkillsBackend(
  projectBackend: FilesystemBackend,
  scope = 'main',
  requiredSkillNames: readonly RequiredProductSkillName[] = REQUIRED_PRODUCT_SKILL_NAMES
): {
  backend: FilesystemBackend | CompositeBackend
  middleware: any[]
  skillSource: string
  enabled: boolean
} {
  const installedSkillsPath = getInstalledSkillsPath()
  if (!installedSkillsPath) {
    throw new Error('产品 skill 运行时路径未初始化，无法创建生成/编辑 Agent。')
  }

  const usesAllProductSkills =
    requiredSkillNames.length === REQUIRED_PRODUCT_SKILL_NAMES.length &&
    REQUIRED_PRODUCT_SKILL_NAMES.every((skillName) => requiredSkillNames.includes(skillName))
  const skillRoute = usesAllProductSkills
    ? PRODUCT_SKILLS_ROUTE
    : `${PRODUCT_SKILLS_ROUTE}${scope}/`
  const backend = new CompositeBackend(projectBackend, {
    [skillRoute]: usesAllProductSkills
      ? new ReadOnlyFilesystemBackend({
          rootDir: installedSkillsPath,
          virtualMode: true
        })
      : new FilteredReadOnlySkillsBackend({
          rootDir: path.join(
            installedSkillsPath,
            SYSTEM_SKILLS_SOURCE_PATH.replace(/^\/|\/$/g, '')
          ),
          virtualMode: true,
          allowedSkillNames: requiredSkillNames
        })
  })
  const skillSource = usesAllProductSkills
    ? `${PRODUCT_SKILLS_ROUTE}${SYSTEM_SKILLS_SOURCE_PATH.replace(/^\//, '')}`
    : skillRoute

  return {
    backend,
    middleware: createProductSkillsMiddlewareSet(backend, skillSource, scope, requiredSkillNames),
    skillSource,
    enabled: true
  }
}
