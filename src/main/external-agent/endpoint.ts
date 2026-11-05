import os from 'os'
import path from 'path'

export function getLocalAgentUsername(): string {
  const user =
    process.env.USER ||
    process.env.USERNAME ||
    process.env.LOGNAME ||
    (typeof os.userInfo === 'function' ? os.userInfo().username : 'default')
  return (user || 'default')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
}

export function getFixedLocalEndpoint(platform = process.platform): string {
  const username = getLocalAgentUsername()
  if (platform === 'win32') {
    return `\\\\.\\pipe\\oh-my-ppt-${username}`
  }
  return path.join(os.tmpdir(), `oh-my-ppt-${username}.sock`)
}
