import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import path from 'node:path'
import { SYSTEM_SKILLS_SOURCE_PATH } from './contract'

export const resolveBuiltinSkillsSourcePath = (): string =>
  is.dev
    ? path.join(process.cwd(), 'resources', 'skills')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'skills')

export const resolveInstalledSkillsPath = (): string =>
  path.join(app.getPath('userData'), is.dev ? 'skills-dev-1' : 'skills')

export const getSystemSkillsSourcePath = (): string => SYSTEM_SKILLS_SOURCE_PATH
