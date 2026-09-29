/**
 * NO_PROXY 风格的内网直连匹配：解析逗号分隔的绕过列表，
 * 支持域名（含子域名）、IP、IPv4 CIDR 网段与端口限定。
 */

export interface NoProxyEntry {
  hostname: string
  port: number | null
  cidr: { address: number; bits: number } | null
}

const parseIpv4 = (value: string): number | null => {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result
}

const parseCidr = (value: string): { address: number; bits: number } | null => {
  const [rawAddress, rawBits] = value.split('/')
  if (rawAddress === undefined) return null
  const address = parseIpv4(rawAddress)
  if (address === null) return null
  const bits = rawBits === undefined ? 32 : Number(rawBits)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return null
  return { address, bits }
}

const inCidr = (host: number, cidr: { address: number; bits: number }): boolean => {
  if (cidr.bits === 0) return true
  const mask = cidr.bits === 32 ? 0xffffffff : ~(0xffffffff >>> cidr.bits)
  return (host & mask) >>> 0 === (cidr.address & mask) >>> 0
}

export const parseNoProxyEntries = (value: string | null | undefined): NoProxyEntry[] => {
  if (typeof value !== 'string') return []
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    // 通配符 * 由 containsNoProxyWildcard 单独处理，不进入逐条匹配
    .filter((item) => item.length > 0 && item !== '*')
    .map<NoProxyEntry>((item) => {
      const lower = item.toLowerCase()
      const portMatch = lower.match(/^(.+):(\d+)$/)
      const rawHost = (portMatch ? portMatch[1] : lower).replace(/^\*\./, '').replace(/^\./, '')
      if (!rawHost) return { hostname: '', port: null, cidr: null }
      return {
        hostname: rawHost,
        port: portMatch ? Number(portMatch[2]) : null,
        cidr: rawHost.includes('/') ? parseCidr(rawHost) : null
      }
    })
    .filter((entry) => entry.hostname.length > 0)
}

export const matchesNoProxy = (
  entries: NoProxyEntry[],
  hostname: string,
  port: number
): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return false
  for (const entry of entries) {
    if (entry.port !== null && entry.port !== port) continue
    if (entry.cidr) {
      const hostAddress = parseIpv4(host)
      if (hostAddress !== null && inCidr(hostAddress, entry.cidr)) return true
      continue
    }
    if (host === entry.hostname) return true
    if (host.endsWith(`.${entry.hostname}`)) return true
  }
  return false
}

export const containsNoProxyWildcard = (value: string | null | undefined): boolean => {
  if (typeof value !== 'string') return false
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .some((item) => item === '*')
}
