import { describe, expect, it } from 'vitest'
import { runScript } from './multi-framework-router/helpers/cli.js'
import { runOaGen } from './typespec-ecosystem/helpers/cli.js'

// Suites assert `exitCode === 0` on these helpers, so a child killed by the
// helper's timeout must not report success.
describe('e2e spawn helpers', () => {
  it('runScript reports a child killed on timeout as 128 + SIGTERM', async () => {
    const res = await runScript(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 200 })
    expect(res.exitCode).toBe(143)
    expect(res.stderr).toContain('Killed after the 200 ms timeout')
  })

  it('runScript passes a normal exit code through', async () => {
    const res = await runScript(process.execPath, ['-e', 'process.exit(3)'])
    expect(res.exitCode).toBe(3)
    expect(res.stderr).not.toContain('timeout')
  })

  it('runOaGen reports a child killed on timeout as 128 + SIGTERM', async () => {
    const res = await runOaGen(['--help'], { timeoutMs: 1 })
    expect(res.exitCode).toBe(143)
    expect(res.stderr).toContain('Killed after the 1 ms timeout')
  })
})
