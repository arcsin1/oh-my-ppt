import log from 'electron-log/main.js'
import type Agent from 'undici/types/agent'
import type Dispatcher from 'undici/types/dispatcher'
import {
  Agent as UndiciAgent,
  Dispatcher as UndiciDispatcher,
  ProxyAgent,
  Socks5ProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher
} from 'undici'
import { containsNoProxyWildcard, matchesNoProxy, parseNoProxyEntries } from './no-proxy'

export interface ProxySettings {
  url: string
  username?: string
  password?: string
  noProxy?: string
}

let originalDispatcher: Dispatcher | null = null
let currentProxyDispatcher: Dispatcher | null = null

function isSocksUrl(url: string): boolean {
  return url.startsWith('socks5://') || url.startsWith('socks://')
}

/** 命中 no_proxy 的请求直连，其余走代理。 */
class NoProxyAwareDispatcher extends UndiciDispatcher {
  private readonly directDispatcher: Dispatcher
  private readonly proxiedDispatcher: Dispatcher
  private readonly bypassEntries: ReturnType<typeof parseNoProxyEntries>

  constructor(
    directDispatcher: Dispatcher,
    proxiedDispatcher: Dispatcher,
    bypassEntries: ReturnType<typeof parseNoProxyEntries>
  ) {
    super()
    this.directDispatcher = directDispatcher
    this.proxiedDispatcher = proxiedDispatcher
    this.bypassEntries = bypassEntries
  }

  dispatch(options: Agent.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const bypass = (() => {
      try {
        const origin = new URL(String(options.origin ?? ''))
        const port = origin.port
          ? Number(origin.port)
          : origin.protocol === 'https:'
            ? 443
            : 80
        return matchesNoProxy(this.bypassEntries, origin.hostname, port)
      } catch {
        return false
      }
    })()
    return bypass
      ? this.directDispatcher.dispatch(options, handler)
      : this.proxiedDispatcher.dispatch(options, handler)
  }

  close(callback: () => void): void
  close(): Promise<void>
  close(callback?: () => void): Promise<void> | void {
    const closing = Promise.allSettled([
      this.directDispatcher.close(),
      this.proxiedDispatcher.close()
    ])
    if (typeof callback === 'function') {
      void closing.then(() => callback())
      return
    }
    return closing.then(() => undefined)
  }

  destroy(error: Error | null, callback: () => void): void
  destroy(callback: () => void): void
  destroy(error: Error | null): Promise<void>
  destroy(): Promise<void>
  destroy(error?: Error | null | (() => void), callback?: () => void): Promise<void> | void {
    const reason = typeof error === 'function' ? null : (error ?? null)
    const done = typeof error === 'function' ? error : callback
    const teardown = Promise.allSettled([
      this.directDispatcher.destroy(reason),
      this.proxiedDispatcher.destroy(reason)
    ])
    if (typeof done === 'function') {
      void teardown.then(() => done())
      return
    }
    return teardown.then(() => undefined)
  }
}

export function applyProxy(settings?: ProxySettings): void {
  if (originalDispatcher === null) {
    originalDispatcher = getGlobalDispatcher()
  }

  const url = (settings?.url || '').trim()
  if (!url) {
    clearProxy()
    return
  }

  const username = (settings?.username || '').trim()
  const password = settings?.password || ''
  const noProxyValue = (settings?.noProxy || '').trim()

  if (containsNoProxyWildcard(noProxyValue)) {
    log.info('[proxy] no_proxy wildcard set, all requests bypass the proxy')
    clearProxy()
    return
  }

  const hasAuth = username.length > 0
  let proxiedDispatcher: Dispatcher
  if (isSocksUrl(url)) {
    proxiedDispatcher = new Socks5ProxyAgent(url, {
      username: username || undefined,
      password: password || undefined
    })
  } else if (hasAuth) {
    proxiedDispatcher = new ProxyAgent({
      uri: url,
      token: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    })
  } else {
    proxiedDispatcher = new ProxyAgent(url)
  }

  const bypassEntries = parseNoProxyEntries(noProxyValue)
  const dispatcher =
    bypassEntries.length > 0
      ? new NoProxyAwareDispatcher(new UndiciAgent(), proxiedDispatcher, bypassEntries)
      : proxiedDispatcher

  closeCurrentProxy()
  currentProxyDispatcher = dispatcher
  setGlobalDispatcher(dispatcher)
  log.info('[proxy] applied', {
    url,
    hasAuth,
    noProxy: noProxyValue,
    bypassEntries: bypassEntries.length
  })
}

export function clearProxy(): void {
  if (!originalDispatcher) return
  closeCurrentProxy()
  setGlobalDispatcher(originalDispatcher)
  log.info('[proxy] cleared, restored default dispatcher')
}

function closeCurrentProxy(): void {
  if (currentProxyDispatcher && typeof currentProxyDispatcher.close === 'function') {
    void currentProxyDispatcher.close().catch(() => {})
  }
  currentProxyDispatcher = null
}
