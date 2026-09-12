import { spawn } from 'node:child_process'
import * as path from 'node:path'

export interface CliRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Runs a command or script via child_process.spawn
 */
export async function runScript(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  } = {},
): Promise<CliRunResult> {
  const repoRoot = path.resolve(__dirname, '../../../..')

  return new Promise<CliRunResult>((resolve) => {
    const child = spawn(
      command,
      args,
      {
        cwd: options.cwd ?? repoRoot,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8')
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString('utf8')
    })

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, options.timeoutMs ?? 60_000)

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 0,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      resolve({
        stdout,
        stderr: stderr + '\n' + err.message,
        exitCode: 1,
      })
    })
  })
}
