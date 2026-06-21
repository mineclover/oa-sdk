/**
 * typegen 출력이 실제로 TypeScript 컴파일을 통과하는지 검증.
 * 실제 merged spec에서 생성한 타입을 tsc로 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { generateTypesFromSpec } from '../../typegen/generate-types.js'
import type { OasDocument } from '@oa-sdk/parser'

const pkgDir = resolve(__dirname, '../..')
const tmpDir = join(pkgDir, '.tmp-compile-test')
const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')

function cleanup() {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
}

describe('typegen — TypeScript 컴파일 검증', () => {
  it('인라인 spec → 생성 타입이 tsc 통과', () => {
    cleanup()
    mkdirSync(tmpDir, { recursive: true })

    const spec: OasDocument = {
      openapi: '3.2.0',
      info: { title: 'Test', version: '1.0.0' },
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              role: { type: 'string', enum: ['admin', 'user'] },
              tags: { type: 'array', items: { type: 'string' } },
              address: {
                type: 'object',
                properties: { city: { type: 'string' }, zip: { type: 'string' } },
                required: ['city'],
              },
            },
            required: ['id', 'name', 'email'],
          },
          Status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                  },
                },
              },
            },
          },
        },
      },
    } as OasDocument

    const ts = generateTypesFromSpec(spec)

    // 사용 코드 추가 — 타입이 실제로 사용 가능한지 검증
    const usage = `
${ts}

// 타입 사용 검증
const user: User = { id: '1', name: 'Alice', email: 'a@b.com' }
const status: Status = 'active'
const params: ListUsersQueryParams = { page: 1 }
const response: ListUsersResponse = [user]
`

    const tsPath = join(tmpDir, 'generated.ts')
    writeFileSync(tsPath, usage, 'utf8')

    // tsconfig
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
      },
      include: ['generated.ts'],
    }), 'utf8')

    try {
      runTsc()
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? ''
      cleanup()
      expect.fail(`TypeScript 컴파일 실패:\n${stderr}`)
    }

    cleanup()
  })

  it('실제 merged spec → 생성 타입이 tsc 통과', () => {
    const specPath = join(pkgDir, '../../packages/schemas/src/.merged.yaml')
    if (!existsSync(specPath)) {
      // schemas merge가 안 되어 있으면 스킵
      return
    }

    cleanup()
    mkdirSync(tmpDir, { recursive: true })

    const raw = readFileSync(specPath, 'utf8')
    const doc = parseYaml(raw) as OasDocument
    const ts = generateTypesFromSpec(doc)

    writeFileSync(join(tmpDir, 'generated.ts'), ts, 'utf8')
    writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'ESNext',
        moduleResolution: 'bundler',
        target: 'ES2022',
      },
      include: ['generated.ts'],
    }), 'utf8')

    try {
      runTsc()
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? ''
      cleanup()
      expect.fail(`TypeScript 컴파일 실패:\n${stderr}`)
    }

    cleanup()
  })
})

function runTsc(): void {
  execFileSync(process.execPath, [tscBin, '--noEmit'], {
    cwd: tmpDir,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
