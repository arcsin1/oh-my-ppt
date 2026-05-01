import log from 'electron-log/main.js'
import {
  DEFAULT_WEB_SEARCH_ENGINES,
  DEFAULT_WEB_SEARCH_LIMIT,
} from './web-search-service'
export { checkDaemonHealth } from './web-search-service'

const DAEMON_BASE_URL =
  (process.env.WEBSEARCH_DAEMON_URL || process.env.OPEN_WEBSEARCH_DAEMON_URL || '').trim() ||
  'http://127.0.0.1:3210'
const REQUEST_TIMEOUT_MS = 15000

interface DaemonEnvelope<T> {
  status: 'ok' | 'error'
  data: T | null
  error: { code: string; message: string } | null
  hint: string | null
}

export interface WebSearchResult {
  title: string
  url: string
  description: string
  source?: string
  engine?: string
}

export interface WebSearchResponse {
  query: string
  engines: string[]
  totalResults: number
  results: WebSearchResult[]
  partialFailures?: Array<{ engine: string; message: string }>
}

export interface FetchWebContentResponse {
  url: string
  finalUrl: string
  contentType?: string
  title?: string
  truncated: boolean
  content: string
}

function extractMarkdownFallbackTitle(markdown: string): string | undefined {
  const titleLine = markdown.match(/^Title:\s*(.+)$/m)
  if (titleLine?.[1]) return titleLine[1].trim()

  const headingLine = markdown.match(/^#\s+(.+)$/m)
  if (headingLine?.[1]) return headingLine[1].trim()

  return undefined
}

async function fetchViaMarkdownMirror(url: string, maxChars: number): Promise<FetchWebContentResponse> {
  const mirrorUrl = `https://markdown.new/${url}`
  log.info('[web-search] fetchViaMarkdownMirror', { url, mirrorUrl, maxChars })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(mirrorUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.8',
      },
    })
    clearTimeout(timeout)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`markdown mirror returned HTTP ${response.status}: ${text}`)
    }

    const raw = await response.text()
    const normalized = raw.trim()
    const title = extractMarkdownFallbackTitle(normalized)
    const truncated = normalized.length > maxChars
    const content = truncated
      ? `${normalized.slice(0, maxChars)}\n\n[...truncated ${normalized.length - maxChars} characters]`
      : normalized

    return {
      url,
      finalUrl: mirrorUrl,
      contentType: 'text/markdown',
      title,
      truncated,
      content,
    }
  } catch (error) {
    clearTimeout(timeout)
    throw error
  }
}

function unwrapEnvelope<T>(envelope: DaemonEnvelope<T>, context: string): T {
  if (envelope.status === 'error' || envelope.error) {
    throw new Error(`${context} failed: ${envelope.error?.message || 'unknown daemon error'}`)
  }
  if (envelope.data === null || envelope.data === undefined) {
    throw new Error(`${context} returned empty data`)
  }
  return envelope.data
}

export async function callWebSearch(args: {
  query: string
  limit?: number
  engines?: string[]
}): Promise<WebSearchResponse> {
  const { query, limit = DEFAULT_WEB_SEARCH_LIMIT, engines = DEFAULT_WEB_SEARCH_ENGINES } = args

  log.info('[web-search] callWebSearch', { query, limit, engines, daemonUrl: DAEMON_BASE_URL })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${DAEMON_BASE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, engines }),
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`daemon returned HTTP ${response.status}: ${text}`)
    }

    const envelope = (await response.json()) as DaemonEnvelope<WebSearchResponse>
    const data = unwrapEnvelope(envelope, 'search')

    log.info('[web-search] callWebSearch success', {
      query,
      totalResults: data.totalResults,
      partialFailures: data.partialFailures?.length ?? 0
    })
    return data
  } catch (error) {
    clearTimeout(timeout)
    const message = error instanceof Error ? error.message : String(error)
    log.warn('[web-search] callWebSearch failed', { query, message, daemonUrl: DAEMON_BASE_URL })
    throw new Error(`web search failed: ${message}`)
  }
}

export async function callFetchWebContent(args: {
  url: string
  maxChars?: number
}): Promise<FetchWebContentResponse> {
  const { url, maxChars = 8000 } = args

  log.info('[web-search] callFetchWebContent', { url, maxChars, daemonUrl: DAEMON_BASE_URL })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(`${DAEMON_BASE_URL}/fetch-web`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, maxChars }),
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`daemon returned HTTP ${response.status}: ${text}`)
    }

    const envelope = (await response.json()) as DaemonEnvelope<FetchWebContentResponse>
    const data = unwrapEnvelope(envelope, 'fetch_web_content')

    log.info('[web-search] callFetchWebContent success', {
      url,
      contentLength: data.content?.length ?? 0,
      truncated: data.truncated
    })
    return data
  } catch (error) {
    clearTimeout(timeout)
    const message = error instanceof Error ? error.message : String(error)
    log.warn('[web-search] callFetchWebContent failed', { url, message, daemonUrl: DAEMON_BASE_URL })

    try {
      const fallback = await fetchViaMarkdownMirror(url, maxChars)
      log.info('[web-search] callFetchWebContent fallback success', {
        url,
        finalUrl: fallback.finalUrl,
        contentLength: fallback.content.length,
      })
      return fallback
    } catch (fallbackError) {
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
      log.warn('[web-search] callFetchWebContent fallback failed', {
        url,
        message,
        fallbackMessage,
      })
      throw new Error(`fetch web content failed: ${message}; markdown fallback failed: ${fallbackMessage}`)
    }
  }
}
