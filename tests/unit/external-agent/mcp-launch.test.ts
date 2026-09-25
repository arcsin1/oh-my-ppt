import { describe, expect, it } from 'vitest'
import { resolveMcpLaunch } from '../../../src/main/external-agent/mcp-launch'

describe('resolveMcpLaunch', () => {
  it('packaged app only needs --mcp', () => {
    expect(
      resolveMcpLaunch({
        executable: 'C:\\Program Files\\Oh My PPT\\Oh My PPT.exe',
        packaged: true,
        entry: 'C:\\ignored\\out\\main\\index.js'
      })
    ).toEqual({
      executable: 'C:\\Program Files\\Oh My PPT\\Oh My PPT.exe',
      args: ['--mcp'],
      command: '"C:\\Program Files\\Oh My PPT\\Oh My PPT.exe" --mcp',
      packaged: true
    })
  })

  it('dev launch defaults to node on PATH', () => {
    expect(
      resolveMcpLaunch({
        executable: 'C:\\electron.exe',
        packaged: false,
        appPath: 'F:\\github\\oh-my-ppt'
      }).executable
    ).toBe('node')
  })

  it('dev launch uses the node stdout wrapper', () => {
    expect(
      resolveMcpLaunch({
        executable: 'C:\\electron.exe',
        packaged: false,
        appPath: 'F:\\github\\oh-my-ppt',
        nodeExecutable: 'C:\\node.exe'
      })
    ).toEqual({
      executable: 'C:\\node.exe',
      args: ['F:\\github\\oh-my-ppt\\scripts\\oh-my-ppt-mcp.mjs'],
      command: 'C:\\node.exe F:\\github\\oh-my-ppt\\scripts\\oh-my-ppt-mcp.mjs',
      packaged: false
    })
  })
})
