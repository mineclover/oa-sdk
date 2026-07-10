import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  checkTypeSpecBundle,
  runBoundedProcess,
} from '../cli/lib/typespec-bundle-check.js'

const root = resolve(__dirname, '../../../..')

describe('runBoundedProcess', () => {
  it('terminates a command after the configured timeout', async () => {
    await expect(runBoundedProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1_000)'],
      cwd: process.cwd(),
      timeoutMs: 25,
      maxOutputBytes: 128,
    })).rejects.toThrow('Command timed out after 25ms')
  })

  it('bounds combined stdout and stderr in failure diagnostics', async () => {
    let caught: unknown
    try {
      await runBoundedProcess({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("x".repeat(4_096)); process.stderr.write("y".repeat(4_096)); process.exit(7)'],
        cwd: process.cwd(),
        timeoutMs: 5_000,
        maxOutputBytes: 64,
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('exit code 7')
    expect((caught as Error).message).toContain('[output truncated at 64 bytes]')
    expect((caught as Error).message.length).toBeLessThan(300)
  })

  it.skipIf(process.platform === 'win32')('kills a SIGTERM-ignoring descendant after the grace period', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-process-group-test-'))
    const pidPath = join(workspace, 'descendant.pid')
    const descendant = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1_000)'
    const parent = [
      'const { spawn } = require("node:child_process")',
      'const { writeFileSync } = require("node:fs")',
      `const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" })`,
      `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid))`,
      'setInterval(() => {}, 1_000)',
    ].join(';')
    let descendantPid: number | undefined
    try {
      await expect(runBoundedProcess({
        command: process.execPath,
        args: ['-e', parent],
        cwd: process.cwd(),
        timeoutMs: 3_000,
        maxOutputBytes: 128,
      })).rejects.toThrow('Command timed out after 3000ms')
      descendantPid = Number(readFileSync(pidPath, 'utf8'))
      await new Promise(resolveWait => setTimeout(resolveWait, 500))
      expect(isProcessAlive(descendantPid)).toBe(false)
    } finally {
      if (descendantPid !== undefined && isProcessAlive(descendantPid)) {
        process.kill(descendantPid, 'SIGKILL')
      }
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('validates compile resource limits before invoking an injected compiler', async () => {
    const compile = vi.fn()
    await expect(checkTypeSpecBundle({
      project: 'docs/internal/typespec-roundtrip/fixtures/authored-bundle',
    }, {
      root,
      compile,
      compileMaxOldSpaceSizeMb: 0,
    })).rejects.toThrow('compileMaxOldSpaceSizeMb must be a positive safe integer')
    expect(compile).not.toHaveBeenCalled()
  })

  it.each([
    ['timeoutMs', 0],
    ['timeoutMs', Number.NaN],
    ['maxOutputBytes', -1],
    ['maxOutputBytes', 1.5],
  ] as const)('rejects invalid %s limits', async (field, value) => {
    await expect(runBoundedProcess({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      cwd: process.cwd(),
      timeoutMs: field === 'timeoutMs' ? value : 100,
      maxOutputBytes: field === 'maxOutputBytes' ? value : 100,
    })).rejects.toThrow(`${field} must be a positive safe integer`)
  })
})

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}
