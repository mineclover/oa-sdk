import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  builtCliInputs,
  checkBuiltCli,
  distShapingFiles,
  resolveBuildInputs,
} from '../built-cli-freshness.mjs'

const PACKAGE_NAME = '@fixture/cli'
const BUILT_FILE = 'dist/cli/index.js'
const BEFORE_BUILD = new Date('2026-01-01T00:00:00Z')
const BUILT_AT = new Date('2026-01-01T00:01:00Z')
const AFTER_BUILD = new Date('2026-01-01T00:02:00Z')
const LATER_AFTER_BUILD = new Date('2026-01-01T00:03:00Z')

const ROOT_BUILD_INPUTS = [
  '$TURBO_DEFAULT$',
  '!**/__tests__/**',
  '!**/*.test.*',
  '!test/**',
  '!tests/**',
  '!**/fixtures/**',
  '!vitest.config.*',
]

const PACKAGE_FILES = [
  'package.json',
  'README.md',
  'tsconfig.json',
  'tsup.config.ts',
  'vitest.config.ts',
  'src/index.ts',
  'src/cli/index.ts',
  'src/core/xml.ts',
  'src/core/xml.test.ts',
  'src/fixtures/sample.json',
  'src/__tests__/unit/fold.test.ts',
  'src/__tests__/fixtures/petstore.yaml',
  'src/.xml.ts.swp',
]

const SOURCE_BUILD_INPUTS = [
  'package.json',
  'src/cli/index.ts',
  'src/core/xml.ts',
  'src/index.ts',
  'tsconfig.json',
  'tsup.config.ts',
]

let repoRoot: string
let packageRoot: string

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'oa-mock-built-cli-'))
  packageRoot = join(repoRoot, 'packages/cli')
  writeRootTurboConfig({ build: { inputs: ROOT_BUILD_INPUTS } })
  for (const file of PACKAGE_FILES) {
    write(file, file === 'package.json' ? JSON.stringify({ name: PACKAGE_NAME }) : '')
    touch(file, BEFORE_BUILD)
  }
  write(BUILT_FILE, '')
  touch(BUILT_FILE, BUILT_AT)
})

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true })
})

describe('checkBuiltCli', () => {
  it('built CLI가 없으면 turbo 안팎 모두 실패하고 build 방법을 안내한다', () => {
    rmSync(join(packageRoot, 'dist'), { recursive: true })

    for (const env of [{}, { TURBO_HASH: '0123456789abcdef' }]) {
      const result = checkBuiltCli({ packageRoot, env })

      expect(result).toMatchObject({ ok: false, status: 'missing', changedInputs: [] })
      expect(result.message).toContain(`built CLI is missing: ${BUILT_FILE}.`)
      expect(result.message).toContain(`\`pnpm exec turbo run test:ci --filter=${PACKAGE_NAME}\``)
      expect(result.message).toContain(`\`pnpm --filter ${PACKAGE_NAME} build\``)
    }
  })

  it('모든 build input보다 나중에 build된 CLI는 통과한다', () => {
    const result = checkBuiltCli({ packageRoot, env: {} })

    expect(result).toEqual({
      ok: true,
      status: 'current',
      message: `${BUILT_FILE} is newer than its ${SOURCE_BUILD_INPUTS.length} build inputs`,
      changedInputs: [],
    })
  })

  it.each(SOURCE_BUILD_INPUTS)('build 뒤에 수정된 %s는 dist를 stale로 만든다', file => {
    touch(file, AFTER_BUILD)

    const result = checkBuiltCli({ packageRoot, env: {} })

    expect(result).toMatchObject({ ok: false, status: 'stale', changedInputs: [file] })
    expect(result.message).toContain(
      `built CLI ${BUILT_FILE} is stale: 1 build input(s) changed after it was built (${file}).`,
    )
    expect(result.message).toContain(`\`pnpm --filter ${PACKAGE_NAME} build\``)
  })

  it('stale input은 최근에 수정된 순서로 보고한다', () => {
    touch('src/core/xml.ts', AFTER_BUILD)
    touch('src/index.ts', LATER_AFTER_BUILD)

    expect(checkBuiltCli({ packageRoot, env: {} }).changedInputs).toEqual(['src/index.ts', 'src/core/xml.ts'])
  })

  it('build input에서 빠진 test 전용 file과 dist에 들어가지 않는 file의 수정은 무시한다', () => {
    for (const file of [
      'src/core/xml.test.ts',
      'src/fixtures/sample.json',
      'src/__tests__/unit/fold.test.ts',
      'src/__tests__/fixtures/petstore.yaml',
      'vitest.config.ts',
      'README.md',
      'src/.xml.ts.swp',
    ]) touch(file, AFTER_BUILD)

    expect(checkBuiltCli({ packageRoot, env: {} })).toMatchObject({ ok: true, status: 'current' })
  })

  it('turbo 아래에서는 수정 시각 검사를 건너뛰고, --only가 build 의존성을 뺀다는 점을 알린다', () => {
    touch('src/core/xml.ts', AFTER_BUILD)
    expect(checkBuiltCli({ packageRoot, env: {} }).status).toBe('stale')

    const result = checkBuiltCli({ packageRoot, env: { TURBO_HASH: '0123456789abcdef' } })

    expect(result).toMatchObject({ ok: true, status: 'unchecked', changedInputs: [] })
    expect(result.message).toContain('modification-time check skipped under turbo (TURBO_HASH is set)')
    expect(result.message).toContain(`It is current only if this turbo run built ${PACKAGE_NAME}`)
    expect(result.message).toContain('`turbo run --only` drops the dependency')
  })
})

describe('build input은 turbo.json에서 가져온다', () => {
  it('root turbo.json의 build input으로 dist를 만드는 file을 거른다', () => {
    expect(resolveBuildInputs(packageRoot)).toEqual({ repoRoot, inputs: ROOT_BUILD_INPUTS })
    expect(distShapingFiles(packageRoot)).toEqual([
      'package.json',
      'src/__tests__/fixtures/petstore.yaml',
      'src/__tests__/unit/fold.test.ts',
      'src/cli/index.ts',
      'src/core/xml.test.ts',
      'src/core/xml.ts',
      'src/fixtures/sample.json',
      'src/index.ts',
      'tsconfig.json',
      'tsup.config.ts',
    ])
    expect(builtCliInputs(packageRoot)).toEqual(SOURCE_BUILD_INPUTS)
  })

  it('root build input이 fixtures/를 빼지 않으면 fixture 수정도 dist를 stale로 만든다', () => {
    writeRootTurboConfig({ build: { inputs: ROOT_BUILD_INPUTS.filter(glob => glob !== '!**/fixtures/**') } })
    touch('src/fixtures/sample.json', AFTER_BUILD)
    touch('src/__tests__/fixtures/petstore.yaml', AFTER_BUILD)

    expect(checkBuiltCli({ packageRoot, env: {} })).toMatchObject({
      ok: false,
      status: 'stale',
      changedInputs: ['src/fixtures/sample.json'],
    })
  })

  it('package turbo.json이 build input을 $TURBO_DEFAULT$로 되돌리면 test 수정도 센다', () => {
    writePackageTurboConfig({ build: { inputs: ['$TURBO_DEFAULT$'] } })
    touch('src/__tests__/unit/fold.test.ts', AFTER_BUILD)

    expect(resolveBuildInputs(packageRoot).inputs).toEqual(['$TURBO_DEFAULT$'])
    expect(checkBuiltCli({ packageRoot, env: {} })).toMatchObject({
      ok: false,
      status: 'stale',
      changedInputs: ['src/__tests__/unit/fold.test.ts'],
    })
  })

  it('package turbo.json의 $TURBO_EXTENDS$는 root build input 뒤에 덧붙인다', () => {
    writePackageTurboConfig({ build: { inputs: ['$TURBO_EXTENDS$', '!src/generated/**'] } })
    write('src/generated/routes.ts', '')
    touch('src/generated/routes.ts', AFTER_BUILD)
    touch('src/fixtures/sample.json', AFTER_BUILD)

    expect(resolveBuildInputs(packageRoot).inputs).toEqual([...ROOT_BUILD_INPUTS, '!src/generated/**'])
    expect(checkBuiltCli({ packageRoot, env: {} }).status).toBe('current')

    touch('src/index.ts', AFTER_BUILD)
    expect(checkBuiltCli({ packageRoot, env: {} }).changedInputs).toEqual(['src/index.ts'])
  })

  it('root의 <package>#build는 generic build를 대신하고, package.json은 항상 build input이다', () => {
    writeRootTurboConfig({
      build: { inputs: ROOT_BUILD_INPUTS },
      [`${PACKAGE_NAME}#build`]: { inputs: ['src/**', '!**/*.test.*', '!**/__tests__/**'] },
    })

    expect(builtCliInputs(packageRoot)).toEqual([
      'package.json',
      'src/cli/index.ts',
      'src/core/xml.ts',
      'src/fixtures/sample.json',
      'src/index.ts',
    ])
    touch('tsconfig.json', AFTER_BUILD)
    expect(checkBuiltCli({ packageRoot, env: {} }).status).toBe('current')
    touch('package.json', AFTER_BUILD)
    expect(checkBuiltCli({ packageRoot, env: {} }).changedInputs).toEqual(['package.json'])
  })

  it('$TURBO_ROOT$ glob은 repository root 기준 경로로 맞춘다', () => {
    writePackageTurboConfig({
      build: { inputs: ['$TURBO_ROOT$/packages/cli/src/**', '!$TURBO_ROOT$/packages/cli/src/core/**'] },
    })

    expect(builtCliInputs(packageRoot)).toEqual([
      'package.json',
      'src/__tests__/fixtures/petstore.yaml',
      'src/__tests__/unit/fold.test.ts',
      'src/cli/index.ts',
      'src/fixtures/sample.json',
      'src/index.ts',
    ])
  })
})

describe('@oa-sdk/mock-server의 built CLI build input', () => {
  const mockServerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const workspaceRoot = resolve(mockServerRoot, '../..')

  it('dist를 만드는 file 중 build input으로 고르는 file이 turbo가 계산한 build input과 같다', () => {
    const turboInputs = turboBuildInputs(workspaceRoot, '@oa-sdk/mock-server')
    const shaping = distShapingFiles(mockServerRoot)

    expect(builtCliInputs(mockServerRoot)).toEqual(shaping.filter(file => turboInputs.has(file)))
    // The comparison covers exclusions: test-only files shape nothing in dist/ and turbo leaves them out.
    expect(shaping).toContain('src/__tests__/cli-built-smoke.mjs')
    expect(turboInputs.has('src/__tests__/cli-built-smoke.mjs')).toBe(false)
    expect(builtCliInputs(mockServerRoot)).toContain('src/cli/index.ts')
  }, 60_000)
})

function turboBuildInputs(workspaceRoot: string, packageName: string): Set<string> {
  const stdout = execFileSync(
    process.execPath,
    [join(workspaceRoot, 'node_modules/turbo/bin/turbo'), 'run', 'build', `--filter=${packageName}`, '--dry=json'],
    { cwd: workspaceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const plan = JSON.parse(stdout) as { tasks: Array<{ taskId: string, inputs: Record<string, string> }> }
  const task = plan.tasks.find(candidate => candidate.taskId === `${packageName}#build`)
  if (!task) throw new Error(`turbo dry run has no ${packageName}#build task`)
  return new Set(Object.keys(task.inputs))
}

function writeRootTurboConfig(tasks: Record<string, { inputs: string[] }>): void {
  writeFileSync(join(repoRoot, 'turbo.json'), JSON.stringify({ tasks }))
}

function writePackageTurboConfig(tasks: Record<string, { inputs: string[] }>): void {
  write('turbo.json', JSON.stringify({ extends: ['//'], tasks }))
}

function write(file: string, content: string): void {
  const path = join(packageRoot, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function touch(file: string, time: Date): void {
  utimesSync(join(packageRoot, file), time, time)
}
