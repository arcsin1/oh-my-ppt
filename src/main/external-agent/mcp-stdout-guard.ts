function chunkText(chunk: unknown): string {
  if (typeof chunk === 'string') return chunk
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString()
  return String(chunk)
}

export function isMcpLaunchArgv(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.OH_MY_PPT_MCP === '1' || argv.includes('--mcp') || argv.includes('--oh-my-ppt-mcp')
}

export function redirectNonJsonRpcStdout(
  stdout: { write: (...args: never[]) => boolean },
  stderr: { write: (...args: never[]) => boolean }
): void {
  const writeStdout = stdout.write.bind(stdout) as (...args: unknown[]) => boolean
  const writeStderr = stderr.write.bind(stderr) as (...args: unknown[]) => boolean
  stdout.write = ((...args: unknown[]) => {
    const text = chunkText(args[0])
    return (text.trimStart().startsWith('{') ? writeStdout : writeStderr)(...args)
  }) as typeof stdout.write
}

if (isMcpLaunchArgv()) {
  redirectNonJsonRpcStdout(process.stdout, process.stderr)
}
