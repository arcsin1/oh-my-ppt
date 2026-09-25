import { beforeEach, describe, expect, it, vi } from 'vitest'

type MockDispatcher = {
  kind: string
  url: string
  close: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  dispatch: ReturnType<typeof vi.fn>
}

const proxyTestState = vi.hoisted(() => {
  const createDispatcher = (kind: string, url = ''): MockDispatcher => ({
    kind,
    url,
    close: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn(() => true)
  })

  const originalDispatcher = createDispatcher('original')
  const createdDispatchers: MockDispatcher[] = []
  const logMock = {
    info: vi.fn()
  }
  const getGlobalDispatcherMock = vi.fn(() => originalDispatcher)
  const setGlobalDispatcherMock = vi.fn()
  const ProxyAgentMock = vi.fn(function (options: unknown) {
    const url = typeof options === 'string' ? options : String((options as { uri: string }).uri)
    const dispatcher = createDispatcher('proxy', url)
    createdDispatchers.push(dispatcher)
    return dispatcher
  })
  const Socks5ProxyAgentMock = vi.fn(function (url: string) {
    const dispatcher = createDispatcher('socks', url)
    createdDispatchers.push(dispatcher)
    return dispatcher
  })
  const AgentMock = vi.fn(function () {
    const dispatcher = createDispatcher('direct')
    createdDispatchers.push(dispatcher)
    return dispatcher
  })

  return {
    AgentMock,
    createdDispatchers,
    getGlobalDispatcherMock,
    logMock,
    originalDispatcher,
    ProxyAgentMock,
    setGlobalDispatcherMock,
    Socks5ProxyAgentMock
  }
})

vi.mock('electron-log/main.js', () => ({
  default: proxyTestState.logMock
}))

vi.mock('undici', () => {
  class DispatcherMock {
    dispatch(): boolean {
      return false
    }

    async close(): Promise<void> {}

    async destroy(): Promise<void> {}
  }

  return {
    Agent: proxyTestState.AgentMock,
    Dispatcher: DispatcherMock,
    ProxyAgent: proxyTestState.ProxyAgentMock,
    Socks5ProxyAgent: proxyTestState.Socks5ProxyAgentMock,
    getGlobalDispatcher: proxyTestState.getGlobalDispatcherMock,
    setGlobalDispatcher: proxyTestState.setGlobalDispatcherMock
  }
})

async function loadProxyModule() {
  vi.resetModules()
  return import('../../../src/main/utils/proxy')
}

describe('proxy dispatcher management', () => {
  beforeEach(() => {
    proxyTestState.createdDispatchers.length = 0
    proxyTestState.getGlobalDispatcherMock.mockClear()
    proxyTestState.getGlobalDispatcherMock.mockReturnValue(proxyTestState.originalDispatcher)
    proxyTestState.logMock.info.mockClear()
    proxyTestState.originalDispatcher.close.mockClear()
    proxyTestState.AgentMock.mockClear()
    proxyTestState.ProxyAgentMock.mockClear()
    proxyTestState.setGlobalDispatcherMock.mockClear()
    proxyTestState.Socks5ProxyAgentMock.mockClear()
  })

  it('applies HTTP proxy via ProxyAgent and trims the URL', async () => {
    const { applyProxy } = await loadProxyModule()

    applyProxy({ url: '  http://127.0.0.1:7890  ' })

    expect(proxyTestState.ProxyAgentMock).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(proxyTestState.Socks5ProxyAgentMock).not.toHaveBeenCalled()
    expect(proxyTestState.setGlobalDispatcherMock).toHaveBeenCalledWith(
      proxyTestState.createdDispatchers[0]
    )
    expect(proxyTestState.logMock.info).toHaveBeenCalledWith(
      '[proxy] applied',
      expect.objectContaining({ url: 'http://127.0.0.1:7890', hasAuth: false })
    )
  })

  it('sends proxy auth as a Basic token for HTTP proxies', async () => {
    const { applyProxy } = await loadProxyModule()

    applyProxy({
      url: 'http://127.0.0.1:7890',
      username: 'corp\\user',
      password: 'secret'
    })

    expect(proxyTestState.ProxyAgentMock).toHaveBeenCalledWith({
      uri: 'http://127.0.0.1:7890',
      token: `Basic ${Buffer.from('corp\\user:secret').toString('base64')}`
    })
  })

  it('applies SOCKS proxy with username and password options', async () => {
    const { applyProxy } = await loadProxyModule()

    applyProxy({
      url: 'socks5://127.0.0.1:1080',
      username: 'user',
      password: 'pass'
    })

    expect(proxyTestState.Socks5ProxyAgentMock).toHaveBeenCalledWith('socks5://127.0.0.1:1080', {
      username: 'user',
      password: 'pass'
    })
    expect(proxyTestState.ProxyAgentMock).not.toHaveBeenCalled()
  })

  it('routes no_proxy hosts direct and everything else through the proxy', async () => {
    const { applyProxy } = await loadProxyModule()

    applyProxy({
      url: 'http://127.0.0.1:7890',
      noProxy: 'localhost,10.0.0.0/8,*.corp.internal'
    })

    // 直连 dispatcher（Agent）和代理 dispatcher 都被创建，全局 dispatcher 是分流包装器
    const directDispatcher = proxyTestState.createdDispatchers.find((d) => d.kind === 'direct')
    const proxyDispatcher = proxyTestState.createdDispatchers.find((d) => d.kind === 'proxy')
    expect(directDispatcher).toBeDefined()
    expect(proxyDispatcher).toBeDefined()
    expect(proxyTestState.setGlobalDispatcherMock).toHaveBeenCalledWith(
      expect.objectContaining({ constructor: expect.any(Function) })
    )
    const activeDispatcher = proxyTestState.setGlobalDispatcherMock.mock.calls[0][0] as {
      dispatch: (options: { origin: string }, handler: unknown) => boolean
    }

    const handler = {}
    activeDispatcher.dispatch({ origin: 'http://10.1.2.3:8000/v1/models' }, handler)
    expect(directDispatcher?.dispatch).toHaveBeenCalled()
    expect(proxyDispatcher?.dispatch).not.toHaveBeenCalled()

    directDispatcher?.dispatch.mockClear()
    activeDispatcher.dispatch({ origin: 'https://api.openai.com/v1/models' }, handler)
    expect(proxyDispatcher?.dispatch).toHaveBeenCalled()
    expect(directDispatcher?.dispatch).not.toHaveBeenCalled()
  })

  it('bypasses the proxy entirely for the * wildcard', async () => {
    const { applyProxy } = await loadProxyModule()

    applyProxy({ url: 'http://127.0.0.1:7890', noProxy: '*' })

    expect(proxyTestState.ProxyAgentMock).not.toHaveBeenCalled()
    expect(proxyTestState.setGlobalDispatcherMock).toHaveBeenLastCalledWith(
      proxyTestState.originalDispatcher
    )
  })

  it('closes the previous proxy dispatcher before switching to a new one', async () => {
    const { applyProxy } = await loadProxyModule()

    applyProxy({ url: 'http://127.0.0.1:7890' })
    const firstDispatcher = proxyTestState.createdDispatchers[0]

    applyProxy({ url: 'http://127.0.0.1:7891' })

    expect(firstDispatcher.close).toHaveBeenCalledTimes(1)
    expect(proxyTestState.setGlobalDispatcherMock).toHaveBeenNthCalledWith(
      2,
      proxyTestState.createdDispatchers[1]
    )
  })

  it('restores the original dispatcher when the proxy URL is empty', async () => {
    const { applyProxy } = await loadProxyModule()

    applyProxy({ url: 'http://127.0.0.1:7890' })
    const activeProxyDispatcher = proxyTestState.createdDispatchers[0]

    applyProxy({ url: '   ' })

    expect(activeProxyDispatcher.close).toHaveBeenCalledTimes(1)
    expect(proxyTestState.setGlobalDispatcherMock).toHaveBeenLastCalledWith(
      proxyTestState.originalDispatcher
    )
    expect(proxyTestState.logMock.info).toHaveBeenCalledWith(
      '[proxy] cleared, restored default dispatcher'
    )
  })

  it('ignores async close rejections from the previous proxy dispatcher', async () => {
    const { applyProxy, clearProxy } = await loadProxyModule()

    applyProxy({ url: 'http://127.0.0.1:7890' })
    const activeProxyDispatcher = proxyTestState.createdDispatchers[0]
    activeProxyDispatcher.close.mockRejectedValueOnce(new Error('close failed'))

    expect(() => clearProxy()).not.toThrow()
    await Promise.resolve()

    expect(activeProxyDispatcher.close).toHaveBeenCalledTimes(1)
    expect(proxyTestState.setGlobalDispatcherMock).toHaveBeenLastCalledWith(
      proxyTestState.originalDispatcher
    )
  })
})
