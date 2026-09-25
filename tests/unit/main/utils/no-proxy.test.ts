import { describe, expect, it } from 'vitest'
import {
  containsNoProxyWildcard,
  matchesNoProxy,
  parseNoProxyEntries
} from '../../../../src/main/utils/no-proxy'

const match = (noProxy: string, hostname: string, port = 443): boolean =>
  matchesNoProxy(parseNoProxyEntries(noProxy), hostname, port)

describe('parseNoProxyEntries', () => {
  it('按逗号和空白切分，去掉空项并统一小写', () => {
    expect(parseNoProxyEntries('localhost, 127.0.0.1,, corp.internal')).toEqual([
      { hostname: 'localhost', port: null, cidr: null },
      { hostname: '127.0.0.1', port: null, cidr: null },
      { hostname: 'corp.internal', port: null, cidr: null }
    ])
  })

  it('支持 *.domain 与 .domain 前缀，剥离后按域名匹配', () => {
    expect(match('*.corp.internal', 'api.corp.internal')).toBe(true)
    expect(match('.corp.internal', 'api.corp.internal')).toBe(true)
  })

  it('识别带端口的条目', () => {
    const entries = parseNoProxyEntries('gw.corp.cn:8080')
    expect(entries).toEqual([{ hostname: 'gw.corp.cn', port: 8080, cidr: null }])
  })

  it('识别 IPv4 CIDR 条目', () => {
    const entries = parseNoProxyEntries('10.0.0.0/8')
    expect(entries[0].cidr).toEqual({ address: 10 << 24, bits: 8 })
  })

  it('忽略非法 CIDR 位数', () => {
    expect(parseNoProxyEntries('10.0.0.0/40')[0].cidr).toBeNull()
  })

  it('空值与非法输入返回空列表', () => {
    expect(parseNoProxyEntries(undefined)).toEqual([])
    expect(parseNoProxyEntries('')).toEqual([])
    expect(parseNoProxyEntries('*')).toEqual([])
  })
})

describe('matchesNoProxy', () => {
  it('精确匹配主机名（大小写不敏感）', () => {
    expect(match('corp.internal', 'CORP.INTERNAL')).toBe(true)
    expect(match('corp.internal', 'other.internal')).toBe(false)
  })

  it('域名条目自动覆盖子域名，但不误伤后缀相同的前缀', () => {
    expect(match('corp.internal', 'api.corp.internal')).toBe(true)
    expect(match('corp.internal', 'deep.api.corp.internal')).toBe(true)
    expect(match('corp.internal', 'xcorp.internal')).toBe(false)
  })

  it('localhost 只匹配 localhost 本身', () => {
    expect(match('localhost,127.0.0.1', 'localhost', 80)).toBe(true)
    expect(match('localhost,127.0.0.1', 'xlocalhost')).toBe(false)
  })

  it('带端口的条目仅在主机与端口都一致时命中', () => {
    expect(match('gw.corp.cn:8080', 'gw.corp.cn', 8080)).toBe(true)
    expect(match('gw.corp.cn:8080', 'gw.corp.cn', 443)).toBe(false)
    expect(match('gw.corp.cn:8080', 'api.corp.cn', 8080)).toBe(false)
  })

  it('IPv4 精确与 CIDR 网段匹配', () => {
    expect(match('10.0.0.0/8', '10.1.2.3')).toBe(true)
    expect(match('10.0.0.0/8', '11.1.2.3')).toBe(false)
    expect(match('192.168.0.0/16', '192.168.5.4')).toBe(true)
    expect(match('192.168.0.0/16', '192.169.0.1')).toBe(false)
    expect(match('10.20.30.40/32', '10.20.30.40')).toBe(true)
    expect(match('10.20.30.40/32', '10.20.30.41')).toBe(false)
  })

  it('CIDR 条目不会匹配域名，域名条目不会误匹配 IP', () => {
    expect(match('10.0.0.0/8', 'app.10.0.0.0')).toBe(false)
    expect(match('0.0.0.0/0', 'app.corp.cn')).toBe(false)
  })

  it('多条件之间任一命中即绕过', () => {
    expect(match('localhost,10.0.0.0/8,*.corp.internal', 'api.corp.internal')).toBe(true)
    expect(match('localhost,10.0.0.0/8,*.corp.internal', '9.9.9.9')).toBe(false)
  })
})

describe('containsNoProxyWildcard', () => {
  it('仅当存在独立的 * 条目时视为全部直连', () => {
    expect(containsNoProxyWildcard('*')).toBe(true)
    expect(containsNoProxyWildcard('localhost, *')).toBe(true)
    expect(containsNoProxyWildcard('*.corp.internal')).toBe(false)
    expect(containsNoProxyWildcard('')).toBe(false)
  })
})
