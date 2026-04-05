/**
 * 풀 파이프라인 E2E: typegen → router → client
 *
 * 실제 merged spec에서 세 가지 코드를 생성하고 TypeScript 컴파일 통과 검증.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { generateTypesFromSpec } from '@oa-sdk/codegen/typegen'
import { generateRouter } from '@oa-sdk/router'
import { generateClient } from '@oa-sdk/client'
import type { OasDocument } from '@oa-sdk/parser'

const root = resolve(__dirname, '../../..')
const specPath = join(root, 'packages/schemas/src/.merged.yaml')
const tmpDir = join(__dirname, '../.tmp-pipeline-test')

let spec: OasDocument

beforeAll(() => {
  if (!existsSync(specPath)) return
  const raw = readFileSync(specPath, 'utf8')
  spec = parseYaml(raw) as OasDocument
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

describe('풀 파이프라인: typegen → router → client', () => {
  it('typegen 출력 생성', () => {
    if (!spec) return
    const ts = generateTypesFromSpec(spec)
    expect(ts).toContain('export type')
    writeFileSync(join(tmpDir, 'types.ts'), ts, 'utf8')
  })

  it('router 출력이 types를 import', () => {
    if (!spec) return
    const code = generateRouter(spec, { target: 'hono', typesImport: './types' })
    expect(code).toContain("from './types'")
    expect(code).toContain("import { Hono } from 'hono'")
    writeFileSync(join(tmpDir, 'router.ts'), code, 'utf8')
  })

  it('client 출력이 types를 import', () => {
    if (!spec) return
    const code = generateClient(spec, { typesImport: './types' })
    expect(code).toContain("from './types'")
    expect(code).toContain('createClient')
    writeFileSync(join(tmpDir, 'client.ts'), code, 'utf8')
  })

  it('types.ts가 tsc strict 통과', () => {
    if (!spec || !existsSync(join(tmpDir, 'types.ts'))) return

    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
        skipLibCheck: true,
      },
      include: ['types.ts'],
    }), 'utf8')

    execSync('npx tsc --noEmit', { cwd: tmpDir, timeout: 15_000 })
  })
})
