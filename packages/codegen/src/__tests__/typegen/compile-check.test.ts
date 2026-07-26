/**
 * typegen 출력이 표준 TypeScript compiler와 ttsc를 모두 통과하는지 검증.
 * 실제 merged spec에서 생성한 타입을 두 compiler로 검증한다.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { generateTypesFromSpec } from '../../typegen/generate-types.js'
import type { OasDocument } from '@oa-sdk/parser'

const pkgDir = resolve(__dirname, '../../..')
const tmpDir = join(pkgDir, '.tmp-compile-test')
const require = createRequire(import.meta.url)
const tscBin = require.resolve('typescript/bin/tsc')
const ttscFixtureDir = resolve(pkgDir, '../ttsc-compile-fixture')
const ttscRequire = createRequire(join(ttscFixtureDir, 'package.json'))
const ttscBin = join(dirname(ttscRequire.resolve('ttsc/package.json')), 'lib/launcher/ttsc.js')
const ttscConfigPath = join(ttscFixtureDir, '.tmp-codegen-compile-check.json')

function cleanup() {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  if (existsSync(ttscConfigPath)) rmSync(ttscConfigPath)
}

describe('typegen — TypeScript compiler compatibility', () => {
  it('인라인 spec → 생성 타입이 tsc와 ttsc를 통과', () => {
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
    writeTtscConfig()

    try {
      runTypeCompilers()
    } catch (err) {
      const stderr = compilerFailureOutput(err)
      cleanup()
      expect.fail(`TypeScript 컴파일 실패:\n${stderr}`)
    }

    cleanup()
  })

  it('실제 merged spec → 생성 타입이 tsc와 ttsc를 통과', () => {
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
    writeTtscConfig()

    try {
      runTypeCompilers()
    } catch (err) {
      const stderr = compilerFailureOutput(err)
      cleanup()
      expect.fail(`TypeScript 컴파일 실패:\n${stderr}`)
    }

    cleanup()
  })
})

function runTypeCompilers(): void {
  execFileSync(process.execPath, [tscBin, '--noEmit'], {
    cwd: tmpDir,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  execFileSync(process.execPath, [ttscBin, '--noEmit', '--project', ttscConfigPath], {
    cwd: ttscFixtureDir,
    // Resolve the fixture's native TypeScript runtime, while compiling the
    // generated project's own tsconfig. This exercises ttsc's normal consumer
    // dependency lookup without replacing @oa-sdk/codegen's TypeScript 5 tsc.
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function writeTtscConfig(): void {
  writeFileSync(ttscConfigPath, JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'ES2022',
    },
    files: [join(tmpDir, 'generated.ts')],
  }), 'utf8')
}

function compilerFailureOutput(err: unknown): string {
  const output = err as { stderr?: string; stdout?: string; message?: string }
  return [output.stderr, output.stdout, output.message].filter(Boolean).join('\n')
}
