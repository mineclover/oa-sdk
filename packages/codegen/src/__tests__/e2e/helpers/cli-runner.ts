import { spawnSync } from 'node:child_process'
import * as path from 'node:path'
import * as fsSync from 'node:fs'

export interface CliRunResult {
  status: number | null
  stdout: string
  stderr: string
}

export interface CliRunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeout?: number
}

// Find repository root from helpers directory (6 levels up)
const REPO_ROOT = path.resolve(__dirname, '../../../../../..')
const TSX_CLI = path.resolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs')
const CLI_SRC = path.resolve(REPO_ROOT, 'packages/codegen/src/cli/index.ts')
const CLI_DIST = path.resolve(REPO_ROOT, 'packages/codegen/dist/cli/index.js')

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Executes the oa-gen CLI in a subprocess (opaque-box).
 * Uses node_modules/tsx/dist/cli.mjs for reliable ESM/TypeScript execution across platforms.
 */
export function runOaCli(args: string[], options: CliRunOptions = {}): CliRunResult {
  const cwd = options.cwd ?? REPO_ROOT
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
  const env = {
    ...process.env,
    ...(options.env ?? {}),
  }

  let command = 'node'
  let commandArgs: string[] = []

  if (fsSync.existsSync(TSX_CLI)) {
    command = 'node'
    commandArgs = [TSX_CLI, CLI_SRC, ...args]
  } else if (fsSync.existsSync(CLI_DIST)) {
    command = 'node'
    commandArgs = [CLI_DIST, ...args]
  } else {
    command = 'node'
    commandArgs = [CLI_SRC, ...args]
  }

  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
  })

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}
