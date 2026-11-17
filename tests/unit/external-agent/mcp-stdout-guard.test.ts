import { describe, expect, it } from 'vitest'
import {
  isMcpLaunchArgv,
  redirectNonJsonRpcStdout
} from '../../../src/main/external-agent/mcp-stdout-guard'

describe('mcp stdout guard', () => {
  it('detects mcp launch flags', () => {
    expect(isMcpLaunchArgv(['electron', 'app'])).toBe(false)
    expect(isMcpLaunchArgv(['electron', 'app', '--mcp'])).toBe(true)
    expect(isMcpLaunchArgv(['electron', 'app'], { OH_MY_PPT_MCP: '1' })).toBe(true)
  })

  it('keeps json-rpc on stdout and moves other writes to stderr', () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const stream = {
      write(chunk: unknown): boolean {
        stdout.push(String(chunk))
        return true
      }
    }
    const err = {
      write(chunk: unknown): boolean {
        stderr.push(String(chunk))
        return true
      }
    }

    redirectNonJsonRpcStdout(stream, err)
    stream.write('\r\n')
    stream.write('{"jsonrpc":"2.0","id":1}\n')
    stream.write('log line\n')

    expect(stdout).toEqual(['{"jsonrpc":"2.0","id":1}\n'])
    expect(stderr).toEqual(['\r\n', 'log line\n'])
  })
})
