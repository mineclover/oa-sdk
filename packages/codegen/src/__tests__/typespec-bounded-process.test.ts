import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
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
        // 자식은 스스로 exit 7로 끝나야 하므로 이 값은 정지 감시일 뿐이다. 부하 상태에서 node 기동이 늦어도
        // 시간 초과로 바뀌지 않도록 하위 프로세스 예산을 쓴다.
        timeoutMs: SUBPROCESS_TEST_BUDGET_MS,
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
    const descendant = 'setTimeout(() => process.exit(0), 15_000).unref(); process.on("SIGTERM", () => {}); setInterval(() => {}, 1_000)'
    const parent = [
      'setTimeout(() => process.exit(0), 15_000).unref()',
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
        // 정지 감시가 아니라 이 테스트가 검증하는 시간 초과 자체다. 부모는 15초 안전장치 전에는 끝나지 않으므로
        // 이 값이 그보다 작아야 시간 초과와 자손 정리 경로를 탄다. 부모가 그 안에 자손을 띄우고 pid 파일을 써야 해서
        // 첫 테스트의 25 ms보다 길게 둔다.
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
