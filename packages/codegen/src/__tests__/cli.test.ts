/**
 * CLI 스모크 테스트
 *
 * oa-gen CLI가 config 파일을 로드하고 올바른 출력을 생성하는지 검증.
 * config 파일은 패키지 내부에 생성해야 node_modules/zod를 찾을 수 있음 (ESM 해석 규칙).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync, spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
// config/output을 패키지 내부 .tmp에 생성 (ESM이 node_modules/zod를 찾을 수 있도록)
const tmpBase = resolve(pkgDir, '.tmp-cli-test')
const CLI_TIMEOUT_MS = 30_000

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function runCli(args: string): string {
  return execSync(`node ${cliPath} ${args}`, {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
  })
}

function runCliFail(args: string): string {
  try {
    execSync(`node ${cliPath} ${args}`, { cwd: pkgDir, encoding: 'utf8', timeout: CLI_TIMEOUT_MS })
    throw new Error('expected to fail')
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? ''
  }
}

function runCliResult(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: pkgDir,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('oa-gen CLI', () => {
  it('--help 플래그', () => {
    const output = runCli('--help')
    expect(output).toContain('oa-gen')
    expect(output).toContain('generate')
    expect(output).toContain('--config')
    expect(output).toContain('--drizzle-schema')
  })

  it('--help에서 private downstream 커맨드를 노출하지 않는다', () => {
    const output = runCli('--help')
    expect(output).not.toMatch(/^\s+(?:router|client|dev)\s/m)
    expect(output).not.toContain('Watch mode')
  })

  it('--help에 review 커맨드가 표시된다', () => {
    const output = runCli('--help')
    expect(output).toContain('inventory')
    expect(output).toContain('behavior-query')
    expect(output).toContain('diff')
    expect(output).toContain('check-artifact')
    expect(output).toContain('drift')
    expect(output).toContain('review')
    expect(output).toContain('review-bundle')
    expect(output).toContain('tsp-bundle-check')
    expect(output).toContain('--base')
    expect(output).toContain('--head')
  })

  it('명령별 help는 성공 상태와 해당 명령 옵션을 출력한다', () => {
    const result = runCliResult(['typegen', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('oa-gen typegen --spec, -s <spec> [options]')
    expect(result.stdout).toContain('--style')
    expect(result.stderr).toBe('')
  })

  it('알 수 없는 옵션은 stack trace 없이 CLI 오류로 종료한다', () => {
    const result = runCliResult(['typegen', '--bogus'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("typegen 오류: Unknown option '--bogus'")
    expect(result.stderr).not.toContain('ERR_PARSE_ARGS_UNKNOWN_OPTION')
    expect(result.stderr).not.toContain('at runCommand')
  })

  it('incremental 실행도 spec 읽기 실패를 정리 가능한 CLI 오류로 처리한다', () => {
    const result = runCliResult(['typegen', '--incremental', '--spec', join(tmpDir, 'missing.yaml')])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('typegen 오류: 스펙 파일 읽기 실패')
    expect(result.stderr).not.toContain('at loadSpecWithPath')
  })

  it('문서화된 enum 밖의 style을 거부한다', () => {
    const specPath = resolve(pkgDir, '../schemas/src/openapi.yaml')
    const result = runCliResult(['typegen', '--spec', specPath, '--style', 'invalid'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--style 값은 type | interface 중 하나여야 합니다')
  })

  it('typegen output의 상위 디렉터리를 생성한다', () => {
    const specPath = resolve(pkgDir, '../schemas/src/openapi.yaml')
    const outputPath = join(tmpDir, 'nested', 'generated', 'types.ts')
    const result = runCliResult(['typegen', '--spec', specPath, '--output', outputPath])
    expect(result.status).toBe(0)
    expect(existsSync(outputPath)).toBe(true)
  })

  it('TypeSpec export stdout에는 source만 남기고 상태 메시지는 stderr로 보낸다', () => {
    const specPath = resolve(pkgDir, '../schemas/src/openapi.yaml')
    const reportPath = join(tmpDir, 'tsp-export-report.json')
    const result = runCliResult(['tsp-export', '--spec', specPath, '--report', reportPath])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('namespace OASDKAPI;')
    expect(result.stdout).not.toContain('✅ TypeSpec export report:')
    expect(result.stderr).toContain(`✅ TypeSpec export report: ${reportPath}`)
  })

  it('TypeSpec restore stdout에는 YAML만 남긴다', () => {
    const specPath = resolve(pkgDir, '../schemas/src/openapi.yaml')
    const sourcePath = join(tmpDir, 'source.tsp')
    const sidecarPath = join(tmpDir, 'sidecar.json')
    const exportResult = runCliResult(['tsp-export', '--spec', specPath, '--output', sourcePath, '--sidecar', sidecarPath])
    expect(exportResult.status).toBe(0)

    const reportPath = join(tmpDir, 'tsp-restore-report.json')
    const result = runCliResult(['tsp-restore', '--spec', specPath, '--sidecar', sidecarPath, '--report', reportPath])
    expect(result.status).toBe(0)
    const restored = parseYaml(result.stdout) as Record<string, unknown>
    expect(restored.openapi).toBe('3.2.0')
    expect(restored['✅ TypeSpec sidecar restore report']).toBeUndefined()
    expect(result.stderr).toContain(`✅ TypeSpec sidecar restore report: ${reportPath}`)
  })

  it('behavior-query limit은 양의 정수 전체 문자열만 허용한다', () => {
    const result = runCliResult(['behavior-query', '--behavior-db', join(tmpDir, 'unused.sqlite'), '--mode', 'recent', '--limit', '1.5'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('invalid --limit value: 1.5')
  })

  it('커맨드 없이 실행 → help 표시', () => {
    const stdout = runCli('')
    expect(stdout).toContain('oa-gen')
    expect(stdout).toContain('Core Code Generation:')
  })

  it('존재하지 않는 config → 오류', () => {
    const stderr = runCliFail('generate --config /tmp/nonexistent.mjs')
    expect(stderr).toContain('찾을 수 없습니다')
  })

  it('--config로 components.yaml 생성', () => {
    const outDir = join(tmpDir, 'out')
    const configContent = `
import { z } from 'zod'
export default {
  output: '${outDir.replace(/\\/g, '/')}',
  schemas: {
    TestUser: z.object({ id: z.string(), name: z.string() }),
  },
}
`
    const configPath = join(tmpDir, 'codegen.config.mjs')
    writeFileSync(configPath, configContent, 'utf8')

    const output = runCli(`generate --config ${configPath}`)
    expect(output).toContain('생성 완료')

    const yamlPath = join(outDir, 'components.yaml')
    expect(existsSync(yamlPath)).toBe(true)

    const parsed = parseYaml(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>
    const schemas = (parsed['components'] as Record<string, unknown>)['schemas'] as Record<string, unknown>
    expect(schemas['TestUser']).toBeDefined()
  })

  it('--config + --output 오버라이드', () => {
    const outDir = join(tmpDir, 'custom')
    const configContent = `
import { z } from 'zod'
export default {
  output: '/should-be-overridden',
  schemas: {
    Item: z.object({ id: z.string() }),
  },
}
`
    const configPath = join(tmpDir, 'codegen.config.mjs')
    writeFileSync(configPath, configContent, 'utf8')

    runCli(`generate --config ${configPath} --output ${outDir}`)
    expect(existsSync(join(outDir, 'components.yaml'))).toBe(true)
  })
})
