import { app } from 'electron'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const DAEMON_BASE_URL =
  (process.env.WEBSEARCH_DAEMON_URL || process.env.OPEN_WEBSEARCH_DAEMON_URL || '').trim() ||
  'http://127.0.0.1:3210'
const HEALTHCHECK_TIMEOUT_MS = 3000
const START_TIMEOUT_MS = 12000
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const MANAGED_SERVICE_DIRNAME = 'open-websearch-service'
const MANAGED_PACKAGE_SPEC = 'open-websearch@2.1.8'
const STARTED_PID_FILENAME = 'daemon.pid'

export const SUPPORTED_WEB_SEARCH_ENGINES = [
  'bing',
  'duckduckgo',
  'baidu',
  'brave',
  'csdn',
  'exa',
  'juejin',
  'linuxdo',
  'startpage',
] as const

export const DEFAULT_WEB_SEARCH_ENGINES = ['bing', 'duckduckgo']
export const DEFAULT_WEB_SEARCH_LIMIT = 20
export const DEFAULT_WEB_SEARCH_PROXY_URL = 'http://127.0.0.1:7897'

export type WebSearchServiceStatus = {
  daemonUrl: string
  running: boolean
  installed: boolean
  installSource: 'managed' | 'workspace' | 'none'
  installDir: string
  workspaceDir: string
  canInstall: boolean
  canStart: boolean
}

export type WebSearchProxyConfig = {
  useProxy?: boolean
  proxyUrl?: string
}

function getManagedServiceDir(): string {
  return path.join(app.getPath('userData'), MANAGED_SERVICE_DIRNAME)
}

function getStartedPidPath(): string {
  return path.join(getManagedServiceDir(), STARTED_PID_FILENAME)
}

function getWorkspaceServiceDir(): string {
  return path.resolve(process.cwd(), 'open-webSearch-main')
}

function getManagedScriptPath(): string {
  return path.join(getManagedServiceDir(), 'node_modules', 'open-websearch', 'build', 'index.js')
}

function getWorkspaceScriptPath(): string {
  return path.join(getWorkspaceServiceDir(), 'build', 'index.js')
}

function resolveInstalledSource(): { source: 'managed' | 'workspace' | 'none'; scriptPath?: string } {
  const managedScriptPath = getManagedScriptPath()
  if (fs.existsSync(managedScriptPath)) {
    return { source: 'managed', scriptPath: managedScriptPath }
  }

  const workspaceScriptPath = getWorkspaceScriptPath()
  if (fs.existsSync(workspaceScriptPath)) {
    return { source: 'workspace', scriptPath: workspaceScriptPath }
  }

  return { source: 'none' }
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function writeStartedPid(pid: number): Promise<void> {
  await fs.promises.mkdir(getManagedServiceDir(), { recursive: true })
  await fs.promises.writeFile(getStartedPidPath(), String(pid), 'utf-8')
}

async function readStartedPid(): Promise<number | null> {
  try {
    const raw = await fs.promises.readFile(getStartedPidPath(), 'utf-8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function clearStartedPid(): Promise<void> {
  try {
    await fs.promises.unlink(getStartedPidPath())
  } catch {
    // ignore
  }
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const isWindows = process.platform === 'win32'
    const spawnCommand = isWindows ? 'cmd.exe' : command
    const spawnArgs = isWindows ? ['/d', '/s', '/c', command, ...args] : args

    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      stdio: 'pipe',
      windowsHide: true,
      env: process.env,
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Command timed out: ${command} ${args.join(' ')}`))
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error((stderr || stdout || `Exit code ${code}`).trim()))
    })
  })
}

export async function checkDaemonHealth(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS)
    const response = await fetch(`${DAEMON_BASE_URL}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

export async function getWebSearchServiceStatus(): Promise<WebSearchServiceStatus> {
  const running = await checkDaemonHealth()
  const installedSource = resolveInstalledSource()

  return {
    daemonUrl: DAEMON_BASE_URL,
    running,
    installed: installedSource.source !== 'none',
    installSource: installedSource.source,
    installDir: getManagedServiceDir(),
    workspaceDir: getWorkspaceServiceDir(),
    canInstall: installedSource.source === 'none',
    canStart: installedSource.source !== 'none' && !running,
  }
}

export async function installWebSearchService(): Promise<WebSearchServiceStatus> {
  const currentStatus = await getWebSearchServiceStatus()
  if (currentStatus.installed) {
    return currentStatus
  }

  const installDir = getManagedServiceDir()
  await fs.promises.mkdir(installDir, { recursive: true })

  const packageJsonPath = path.join(installDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    await fs.promises.writeFile(
      packageJsonPath,
      JSON.stringify(
        {
          name: 'oh-my-ppt-websearch-service',
          private: true,
        },
        null,
        2,
      ),
      'utf-8',
    )
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await runCommand(npmCommand, ['install', '--no-save', MANAGED_PACKAGE_SPEC], installDir, INSTALL_TIMEOUT_MS)
  return getWebSearchServiceStatus()
}

export async function startWebSearchService(proxyConfig?: WebSearchProxyConfig): Promise<WebSearchServiceStatus> {
  const currentStatus = await getWebSearchServiceStatus()
  if (currentStatus.running) {
    return currentStatus
  }

  const installedSource = resolveInstalledSource()
  if (!installedSource.scriptPath) {
    throw new Error('open-websearch 尚未安装')
  }

  const workingDirectory =
    installedSource.source === 'workspace' ? getWorkspaceServiceDir() : getManagedServiceDir()
  const useProxy = proxyConfig?.useProxy === true
  const proxyUrl = (proxyConfig?.proxyUrl || '').trim()

  const child = spawn(process.execPath, [installedSource.scriptPath, 'serve'], {
    cwd: workingDirectory,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ...(useProxy ? { USE_PROXY: 'true' } : {}),
      ...(useProxy && proxyUrl ? { PROXY_URL: proxyUrl } : {}),
    },
  })
  if (typeof child.pid !== 'number' || child.pid <= 0) {
    throw new Error('open-websearch 启动失败：未获取到进程 PID')
  }
  await writeStartedPid(child.pid)
  child.unref()

  const startDeadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < startDeadline) {
    if (await checkDaemonHealth()) {
      return getWebSearchServiceStatus()
    }
    await delay(500)
  }

  throw new Error('open-websearch 启动超时，请检查服务日志或端口占用')
}

export async function stopManagedWebSearchService(): Promise<boolean> {
  const pid = await readStartedPid()
  if (!pid) {
    return false
  }

  try {
    process.kill(pid)
  } catch {
    await clearStartedPid()
    return false
  }

  const stopDeadline = Date.now() + 5000
  while (Date.now() < stopDeadline) {
    const running = await checkDaemonHealth()
    if (!running) {
      await clearStartedPid()
      return true
    }
    await delay(200)
  }

  await clearStartedPid()
  return true
}
