import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SUBPROCESS_TEST_BUDGET_MS } from './helpers/subprocess-budget.js'
import {
  COMPILE_CACHE_DIR_PREFIX,
  compileCacheOwnerPid,
  createRunCompileCache,
  isProcessAlive,
  reclaimAbandonedCompileCaches,
} from './helpers/subprocess-compile-cache.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(HERE, '../..')
const HELPER_URL = pathToFileURL(join(HERE, 'helpers/subprocess-compile-cache.ts')).href

/**
 * vitest 메인 프로세스처럼 globalSetup을 실행한 뒤, argv로 받은 방식으로 끝나는 자식 스크립트.
 * - teardown: 정상 종료처럼 teardown을 부른다.
 * - exit: vitest가 SIGTERM을 받았을 때처럼 teardown 없이 process.exit(128 + 15)로 끝난다.
 * - sigkill: 어떤 정리도 돌 수 없게 SIGKILL로 끝난다. 신호가 닿기 전에 이벤트 루프가 비어
 *   정상 종료하지 않도록 타이머로 프로세스를 붙잡아 둔다.
 * 두 번째 인자가 있으면 setup 뒤에 그 디렉터리를 만든다. 중단된 실행의 남은 워커가 이 실행 도중
 * 캐시 디렉터리를 다시 만드는 경우를 흉내 낸다.
 * 보고에는 setup 직후 os.tmpdir()에 있는 캐시 이름 항목도 담는다. teardown·'exit' 정리가 돌기 전이므로
 * setup이 무엇을 거뒀는지를 끝내는 방식과 상관없이 따로 확인할 수 있다.
 */
const SETUP_CHILD_SCRIPT = `
import { existsSync, mkdirSync, readdirSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
const { default: setup, COMPILE_CACHE_DIR_PREFIX } = await import(${JSON.stringify(HELPER_URL)})
const teardown = setup()
const cacheDir = process.env.NODE_COMPILE_CACHE ?? null
writeSync(1, JSON.stringify({
  pid: process.pid,
  managed: typeof teardown === 'function',
  cacheDir,
  created: cacheDir !== null && existsSync(cacheDir),
  cacheEntriesAfterSetup: readdirSync(tmpdir()).filter((name) => name.startsWith(COMPILE_CACHE_DIR_PREFIX)).sort(),
}) + '\\n')
const appearsDuringRun = process.argv[2]
if (appearsDuringRun) mkdirSync(appearsDuringRun, { recursive: true })
switch (process.argv[1]) {
  case 'teardown':
    teardown?.()
    break
  case 'exit':
    process.exit(143)
    break
  case 'sigkill':
    setInterval(() => {}, 60_000)
    process.kill(process.pid, 'SIGKILL')
    break
}
`

type ChildEnding = 'teardown' | 'exit' | 'sigkill'

interface SetupChildReport {
  pid: number
  managed: boolean
  cacheDir: string | null
  created: boolean
  /** setup 직후 os.tmpdir()에 있던, 캐시 접두사로 시작하는 항목 이름(정렬됨). */
  cacheEntriesAfterSetup: string[]
}

interface SetupChildRun {
  status: number | null
  signal: NodeJS.Signals | null
  stderr: string
  report: SetupChildReport
}

interface SetupChildOptions {
  env?: Record<string, string>
  /** setup 뒤, 실행이 끝나기 전에 만들 디렉터리. */
  appearsDuringRun?: string
}

function runSetupChild(parentDir: string, ending: ChildEnding, options: SetupChildOptions = {}): SetupChildRun {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // 이 워커는 vitest globalSetup이 만든 캐시를 물려받았으므로, 자식에는 덮어쓴 값만 넘긴다.
  delete env.NODE_COMPILE_CACHE
  delete env.NODE_DISABLE_COMPILE_CACHE
  // os.tmpdir()가 parentDir를 가리키게 한다(POSIX는 TMPDIR, Windows는 TEMP/TMP).
  Object.assign(env, { TMPDIR: parentDir, TEMP: parentDir, TMP: parentDir }, options.env)

  const args = ['--import', 'tsx', '--input-type=module', '-e', SETUP_CHILD_SCRIPT, ending]
  if (options.appearsDuringRun) args.push(options.appearsDuringRun)
  const result = spawnSync(process.execPath, args, {
    cwd: PACKAGE_ROOT,
    env,
    encoding: 'utf8',
    timeout: SUBPROCESS_TEST_BUDGET_MS,
  })
  const reportLine = result.stdout.split('\n').find((line) => line.startsWith('{'))
  if (reportLine === undefined) {
    throw new Error(
      `setup child (${ending}) printed no report: status=${result.status} signal=${result.signal}\n${result.stderr}`,
    )
  }
  return {
    status: result.status,
    signal: result.signal,
    stderr: result.stderr,
    report: JSON.parse(reportLine) as SetupChildReport,
  }
}

function compileCacheEntries(parentDir: string): string[] {
  return readdirSync(parentDir).filter((name) => name.startsWith(COMPILE_CACHE_DIR_PREFIX))
}

/** 이미 끝나서 회수된 프로세스의 pid. */
function exitedProcessPid(): number {
  const result = spawnSync(process.execPath, ['-e', ''], { timeout: SUBPROCESS_TEST_BUDGET_MS })
  expect(result.status).toBe(0)
  if (result.pid === undefined) throw new Error('spawnSync reported no pid')
  return result.pid
}

describe('subprocess compile cache (vitest globalSetup)', () => {
  let parentDir: string

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'oa-sdk-compile-cache-test-'))
  })

  afterEach(() => {
    rmSync(parentDir, { recursive: true, force: true })
  })

  describe('owner pid in the directory name', () => {
    it('reads the pid that createRunCompileCache writes', () => {
      const cache = createRunCompileCache(parentDir)
      try {
        expect(basename(cache.dir).startsWith(`${COMPILE_CACHE_DIR_PREFIX}${process.pid}-`)).toBe(true)
        expect(compileCacheOwnerPid(basename(cache.dir))).toBe(process.pid)
      } finally {
        cache.remove()
      }
    })

    it('rejects names without a usable pid', () => {
      expect(compileCacheOwnerPid(`${COMPILE_CACHE_DIR_PREFIX}AbC123`)).toBeUndefined()
      expect(compileCacheOwnerPid(`${COMPILE_CACHE_DIR_PREFIX}0-AbC123`)).toBeUndefined()
      expect(compileCacheOwnerPid(`${COMPILE_CACHE_DIR_PREFIX}123-`)).toBeUndefined()
      expect(compileCacheOwnerPid(`x${COMPILE_CACHE_DIR_PREFIX}123-AbC123`)).toBeUndefined()
      expect(compileCacheOwnerPid(`${COMPILE_CACHE_DIR_PREFIX}123-AbC123/sub`)).toBeUndefined()
    })
  })

  it('isProcessAlive tells running processes, including ones it may not signal, from exited ones', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
    // pid 1(init/launchd)은 늘 있다. 루트가 아니면 신호 권한이 없어 EPERM이 난다.
    expect(isProcessAlive(1)).toBe(true)
    expect(isProcessAlive(exitedProcessPid())).toBe(false)
  })

  it('createRunCompileCache hooks its removal to process exit until remove() runs', () => {
    const cache = createRunCompileCache(parentDir)
    expect(existsSync(cache.dir)).toBe(true)
    expect(process.listeners('exit')).toContain(cache.remove)

    cache.remove()
    expect(existsSync(cache.dir)).toBe(false)
    expect(process.listeners('exit')).not.toContain(cache.remove)
    expect(() => cache.remove()).not.toThrow()
  })

  it('reclaimAbandonedCompileCaches removes only directories whose owner process is gone', () => {
    const deadOwned = join(parentDir, `${COMPILE_CACHE_DIR_PREFIX}${exitedProcessPid()}-Dead01`)
    const liveOwned = join(parentDir, `${COMPILE_CACHE_DIR_PREFIX}${process.pid}-Live01`)
    const withoutPid = join(parentDir, `${COMPILE_CACHE_DIR_PREFIX}NoPid1`)
    const unrelated = join(parentDir, 'unrelated-cache')
    for (const dir of [deadOwned, liveOwned, withoutPid, unrelated]) {
      mkdirSync(join(dir, 'v24-entry'), { recursive: true })
      writeFileSync(join(dir, 'v24-entry', 'cached'), 'x')
    }

    expect(reclaimAbandonedCompileCaches(parentDir)).toEqual([deadOwned])
    expect(existsSync(deadOwned)).toBe(false)
    expect(existsSync(liveOwned)).toBe(true)
    expect(existsSync(withoutPid)).toBe(true)
    expect(existsSync(unrelated)).toBe(true)
  })

  it('reclaimAbandonedCompileCaches tolerates a missing parent directory', () => {
    expect(reclaimAbandonedCompileCaches(join(parentDir, 'missing'))).toEqual([])
  })

  describe('a whole run in a separate process', () => {
    it('removes the cache through teardown when the run finishes', () => {
      const run = runSetupChild(parentDir, 'teardown')

      expect(run.status, run.stderr).toBe(0)
      expect(run.report.managed).toBe(true)
      expect(run.report.created).toBe(true)
      expect(dirname(run.report.cacheDir!)).toBe(parentDir)
      expect(compileCacheOwnerPid(basename(run.report.cacheDir!))).toBe(run.report.pid)
      expect(compileCacheEntries(parentDir)).toEqual([])
    })

    it('removes the cache when the run exits without teardown, as vitest does on SIGINT/SIGTERM', () => {
      const run = runSetupChild(parentDir, 'exit')

      expect(run.status, run.stderr).toBe(143)
      expect(run.report.managed).toBe(true)
      expect(run.report.created).toBe(true)
      expect(existsSync(run.report.cacheDir!)).toBe(false)
      expect(compileCacheEntries(parentDir)).toEqual([])
    })

    it('leaves a killed run\'s cache for the next run\'s setup to reclaim, sparing live owners and other entries', () => {
      const killed = runSetupChild(parentDir, 'sigkill')
      expect(killed.signal).toBe('SIGKILL')
      expect(killed.report.created).toBe(true)
      const abandoned = killed.report.cacheDir!
      expect(existsSync(abandoned)).toBe(true)
      expect(isProcessAlive(killed.report.pid)).toBe(false)

      const liveOwned = join(parentDir, `${COMPILE_CACHE_DIR_PREFIX}${process.pid}-Live01`)
      const withoutPid = join(parentDir, `${COMPILE_CACHE_DIR_PREFIX}NoPid1`)
      const fileNamedLikeCache = join(parentDir, `${COMPILE_CACHE_DIR_PREFIX}${killed.report.pid}-File01`)
      mkdirSync(liveOwned)
      mkdirSync(withoutPid)
      writeFileSync(fileNamedLikeCache, 'not a cache directory')

      const next = runSetupChild(parentDir, 'teardown')

      expect(next.status, next.stderr).toBe(0)
      // teardown이 돌기 전, setup만으로 버려진 캐시가 사라지고 나머지 항목은 그대로다.
      expect(next.report.cacheEntriesAfterSetup).toEqual(
        [liveOwned, withoutPid, fileNamedLikeCache, next.report.cacheDir!].map((path) => basename(path)).sort(),
      )
      expect(existsSync(abandoned)).toBe(false)
      expect(existsSync(liveOwned)).toBe(true)
      expect(existsSync(withoutPid)).toBe(true)
      expect(existsSync(fileNamedLikeCache)).toBe(true)
      expect(existsSync(next.report.cacheDir!)).toBe(false)
    })

    it('reclaims a killed run\'s cache at setup even when the next run is itself stopped before teardown', () => {
      const killed = runSetupChild(parentDir, 'sigkill')
      expect(killed.signal).toBe('SIGKILL')
      const abandoned = killed.report.cacheDir!
      expect(existsSync(abandoned)).toBe(true)

      // teardown 없이 끝나면 'exit' 정리는 이 실행 자신의 캐시만 지우므로, 앞선 실행의 캐시는 setup만 거둘 수 있다.
      const next = runSetupChild(parentDir, 'exit')

      expect(next.status, next.stderr).toBe(143)
      expect(next.report.cacheEntriesAfterSetup).toEqual([basename(next.report.cacheDir!)])
      expect(existsSync(abandoned)).toBe(false)
      expect(compileCacheEntries(parentDir)).toEqual([])
    })

    it('reclaims at teardown a cache that an interrupted run\'s leftover workers recreated during this run', () => {
      const killed = runSetupChild(parentDir, 'sigkill')
      expect(killed.signal).toBe('SIGKILL')
      const abandoned = killed.report.cacheDir!
      expect(existsSync(abandoned)).toBe(true)

      // setup이 먼저 회수한 뒤, 남은 워커가 띄운 하위 프로세스가 같은 디렉터리를 다시 만든 상황.
      const next = runSetupChild(parentDir, 'teardown', { appearsDuringRun: join(abandoned, 'v24-recreated') })

      expect(next.status, next.stderr).toBe(0)
      expect(next.report.cacheEntriesAfterSetup).toEqual([basename(next.report.cacheDir!)])
      expect(existsSync(abandoned)).toBe(false)
      expect(compileCacheEntries(parentDir)).toEqual([])
    })

    it('creates and removes nothing when NODE_COMPILE_CACHE is preset', () => {
      const preset = join(parentDir, 'preset-compile-cache')
      const run = runSetupChild(parentDir, 'exit', { env: { NODE_COMPILE_CACHE: preset } })

      expect(run.status, run.stderr).toBe(143)
      expect(run.report.managed).toBe(false)
      expect(run.report.cacheDir).toBe(preset)
      expect(existsSync(preset)).toBe(true)
      expect(compileCacheEntries(parentDir)).toEqual([])
    })

    it('creates nothing when NODE_DISABLE_COMPILE_CACHE is set', () => {
      const run = runSetupChild(parentDir, 'exit', { env: { NODE_DISABLE_COMPILE_CACHE: '1' } })

      expect(run.status, run.stderr).toBe(143)
      expect(run.report.managed).toBe(false)
      expect(run.report.cacheDir).toBeNull()
      expect(compileCacheEntries(parentDir)).toEqual([])
    })
  })
})
