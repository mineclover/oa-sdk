import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'

export interface CliRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface RunOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

const repoRoot = path.resolve(__dirname, '../../../..')

/**
 * Runs a command or script via child_process.spawn
 */
export async function runScript(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CliRunResult> {
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

/**
 * Runs a root package.json script the way `pnpm run <name>` does: the command
 * is read from package.json at call time, so a test cannot keep invoking a gate
 * by a path the script no longer uses. Only plain `node ...` commands are
 * supported; anything that needs a shell is rejected instead of reinterpreted.
 */
export async function runRootPackageScript(name: string, options: RunOptions = {}): Promise<CliRunResult> {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const command = manifest.scripts?.[name]
  if (typeof command !== 'string') {
    throw new Error(`Root package.json has no "${name}" script`)
  }
  const [bin, ...args] = command.trim().split(/\s+/)
  if (bin !== 'node' || /[&|;<>()$`'"\\*?]/.test(command)) {
    throw new Error(`Root package.json script "${name}" is not a plain node command: ${command}`)
  }
  return runScript(process.execPath, args, options)
}
