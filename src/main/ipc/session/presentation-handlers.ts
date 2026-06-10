import { BrowserWindow, ipcMain } from 'electron'
import fs from 'fs'
import http from 'http'
import path from 'path'
import type { AddressInfo } from 'net'
import type { IpcContext } from '../context'
import { ensureSessionRuntimeCompatible } from './runtime-assets'
import { ensureIndexPresentBackgroundStyle } from '../../session/index-transition'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.woff2': 'font/woff2'
}
const PREFERRED_PRESENTATION_PORT_START = 9090
const PREFERRED_PRESENTATION_PORT_COUNT = 10

const parseStartIndex = (value: unknown): number => {
  const raw = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0
}

const resolveRequestPath = (projectDir: string, requestUrl: string | undefined): string | null => {
  const pathname = new URL(requestUrl || '/', 'http://127.0.0.1').pathname
  const decodedPath = decodeURIComponent(pathname)
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
  const resolvedPath = path.resolve(projectDir, relativePath)
  const projectRoot = path.resolve(projectDir)
  const relativeToRoot = path.relative(projectRoot, resolvedPath)
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null
  return resolvedPath
}

const createPresentationServer = async (projectDir: string): Promise<http.Server> => {
  const server = http.createServer((request, response) => {
    const filePath = resolveRequestPath(projectDir, request.url)
    if (!filePath) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    fs.promises
      .stat(filePath)
      .then((stat) => {
        if (!stat.isFile()) {
          response.writeHead(404)
          response.end('Not found')
          return
        }
        response.writeHead(200, {
          'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Content-Length': stat.size,
          'Cache-Control': 'no-store'
        })
        if (request.method === 'HEAD') {
          response.end()
          return
        }
        fs.createReadStream(filePath).pipe(response)
      })
      .catch(() => {
        response.writeHead(404)
        response.end('Not found')
      })
  })

  const listenOnPort = (port: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })

  for (let offset = 0; offset < PREFERRED_PRESENTATION_PORT_COUNT; offset += 1) {
    try {
      await listenOnPort(PREFERRED_PRESENTATION_PORT_START + offset)
      return server
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw error
    }
  }

  await listenOnPort(0)

  return server
}

export function registerPresentationHandlers(ctx: IpcContext): void {
  ipcMain.handle('presentation:open', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return { success: false }
    const record = payload as { sessionId?: unknown; startIndex?: unknown }
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
    const startIndex = parseStartIndex(record.startIndex)
    if (!sessionId) return { success: false }

    const { pages, projectDir } = await ctx.resolveSessionPageFiles(sessionId)
    await ensureSessionRuntimeCompatible(ctx, projectDir)

    const indexPath = path.join(projectDir, 'index.html')
    await fs.promises.access(indexPath, fs.constants.R_OK)
    const indexHtml = await fs.promises.readFile(indexPath, 'utf-8')
    const patchedIndexHtml = ensureIndexPresentBackgroundStyle(indexHtml)
    if (patchedIndexHtml !== indexHtml) {
      await fs.promises.writeFile(indexPath, patchedIndexHtml, 'utf-8')
    }

    const server = await createPresentationServer(projectDir)
    const address = server.address() as AddressInfo
    const startPage = pages[Math.min(startIndex, pages.length - 1)] ?? pages[0]
    const url = new URL(`http://127.0.0.1:${address.port}/index.html`)
    url.searchParams.set('present', '1')
    if (startPage?.pageId) {
      url.hash = encodeURIComponent(startPage.pageId)
    }

    const win = new BrowserWindow({
      fullscreen: true,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    })

    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape')) {
        event.preventDefault()
        if (!win.isDestroyed()) win.close()
      }
    })

    win.on('closed', () => {
      server.close()
    })
    win.on('ready-to-show', () => {
      win.show()
    })
    try {
      await win.loadURL(url.toString())
    } catch (error) {
      server.close()
      if (!win.isDestroyed()) win.close()
      throw error
    }

    return { success: true }
  })

  ipcMain.on('presentation:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.close()
  })
}
