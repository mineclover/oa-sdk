import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

export function runTsc(cwd: string, timeout = 60_000): void {
  try {
    execFileSync(process.execPath, [tscBin, '--noEmit'], {
      cwd,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const result = error as { stdout?: Buffer; stderr?: Buffer }
    const diagnostics = [result.stdout, result.stderr]
      .filter((output): output is Buffer => output instanceof Buffer && output.length > 0)
      .map(output => output.toString('utf8').trim())
      .filter(Boolean)
      .join('\n')
    throw new Error(diagnostics || 'tsc --noEmit failed without diagnostics')
  }
}
