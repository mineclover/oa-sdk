import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import * as path from 'node:path'

export interface CliRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Runs oa-gen CLI via node --import tsx packages/codegen/src/cli/index.ts
 */
export async function runOaGen(
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
  } = {},
): Promise<CliRunResult> {
  const repoRoot = process.cwd()
  const cliScript = path.resolve(repoRoot, 'packages/codegen/src/cli/index.ts')

  return new Promise<CliRunResult>((resolve) => {
    const child = spawn(
      'node',
      ['--import', 'tsx', cliScript, ...args],
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

    const timeoutMs = options.timeoutMs ?? 30_000
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      resolve({
        stdout,
        stderr: timedOut ? `${stderr}\nKilled after the ${timeoutMs} ms timeout` : stderr,
        // A child that a signal ended (including the timeout above) has no exit code;
        // report it the way a shell does (128 + signal number) so it never reads as success.
        exitCode: code ?? 128 + (signal ? constants.signals[signal] : 0),
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
