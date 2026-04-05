/**
 * CLI 스모크 테스트
 *
 * oa-gen CLI가 config 파일을 로드하고 올바른 출력을 생성하는지 검증.
 * config 파일은 패키지 내부에 생성해야 node_modules/zod를 찾을 수 있음 (ESM 해석 규칙).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
// config/output을 패키지 내부 .tmp에 생성 (ESM이 node_modules/zod를 찾을 수 있도록)
const tmpBase = resolve(pkgDir, '.tmp-cli-test')

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
    timeout: 10_000,
  })
}

function runCliFail(args: string): string {
  try {
    execSync(`node ${cliPath} ${args}`, { cwd: pkgDir, encoding: 'utf8', timeout: 10_000 })
    throw new Error('expected to fail')
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? ''
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

  it('커맨드 없이 실행 → 오류', () => {
    const stderr = runCliFail('')
    expect(stderr).toContain('알 수 없는 커맨드')
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
