import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

export function runTsc(cwd: string, timeout = 60_000): void {
  execFileSync(process.execPath, [tscBin, '--noEmit'], {
    cwd,
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
