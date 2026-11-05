import path from 'path'

export function resolveMcpLaunch(input: {
  executable: string
  packaged: boolean
  entry?: string
  appPath?: string
  nodeExecutable?: string
}): { executable: string; args: string[]; command: string; packaged: boolean } {
  if (input.packaged) {
    return {
      executable: input.executable,
      args: ['--mcp'],
      command: [input.executable, '--mcp'].map(quoteCliArg).join(' '),
      packaged: true
    }
  }
  const appPath = input.appPath ? path.resolve(input.appPath) : process.cwd()
  const executable = input.nodeExecutable || 'node'
  const args = [path.join(appPath, 'scripts/oh-my-ppt-mcp.mjs')]
  return {
    executable,
    args,
    command: [executable, ...args].map(quoteCliArg).join(' '),
    packaged: false
  }
}

function quoteCliArg(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}
