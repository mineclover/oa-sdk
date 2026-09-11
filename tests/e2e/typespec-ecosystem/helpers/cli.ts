import { spawn } from 'node:child_process'
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

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, options.timeoutMs ?? 30_000)

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
