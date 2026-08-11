/**
 * Zod → OAS → TypeScript 라운드트립 검증
 *
 * 1. Zod 스키마 정의
 * 2. zodToSchema() → OAS 스키마
 * 3. OAS 스키마로 스펙 구성 → generateTypesFromSpec() → TS 문자열
 * 4. tsc strict 컴파일 (생성된 타입 + Zod 원본과 의미적 동등성 검증)
 *
 * Zod에서 정의한 구조가 OAS를 거쳐 TS로 돌아왔을 때 타입이 보존되는지 확인.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { z } from 'zod'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { zodToSchema } from '../zod-to-schema.js'
import { generateTypesFromSpec } from '../typegen/generate-types.js'
import type { OasDocument } from '@oa-sdk/parser'

const pkgDir = resolve(__dirname, '../..')
const tscBin = resolve(pkgDir, 'node_modules/.bin/tsc')
const tmpDir = join(pkgDir, '.tmp-roundtrip')

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

function roundtripCompile(
  schemas: Record<string, z.ZodTypeAny>,
  usageCode: string,
): { ok: boolean; output: string } {
  mkdirSync(tmpDir, { recursive: true })

  // Zod → OAS schemas
  const oasSchemas: Record<string, ReturnType<typeof zodToSchema>> = {}
  for (const [name, zSchema] of Object.entries(schemas)) {
    oasSchemas[name] = zodToSchema(zSchema)
  }

  // OAS spec 구성
  const spec: OasDocument = {
    openapi: '3.2.0',
    info: { title: 'Roundtrip', version: '1.0.0' },
    paths: {},
    components: { schemas: oasSchemas },
  } as OasDocument

  // TS 타입 생성
  const ts = generateTypesFromSpec(spec, { banner: false })
  const content = `${ts}\n\n${usageCode}\n`

  writeFileSync(join(tmpDir, 'roundtrip.ts'), content, 'utf8')
  writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true, noEmit: true, module: 'ESNext',
      moduleResolution: 'bundler', target: 'ES2022',
    },
    include: ['roundtrip.ts'],
  }), 'utf8')

  try {
    execSync(`${tscBin} --noEmit`, { cwd: tmpDir, encoding: 'utf8', timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] })
    return { ok: true, output: '' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return { ok: false, output: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

// ── 기본 타입 라운드트립 ────────────────────────────────────

describe('기본 타입 라운드트립', () => {
  it('string / number / boolean', () => {
    const r = roundtripCompile({
      Str: z.string(),
      Num: z.number(),
      Bool: z.boolean(),
    }, `
      const s: Str = 'hello'
      const n: Num = 42
      const b: Bool = true
      // @ts-expect-error string ≠ number
      const bad: Str = 42
    `)
    expect(r.ok).toBe(true)
  })
})

// ── enum 라운드트립 ─────────────────────────────────────────

describe('enum 라운드트립', () => {
  it('z.enum → string literal union', () => {
    const r = roundtripCompile({
      Role: z.enum(['admin', 'user', 'guest']),
    }, `
      const r: Role = 'admin'
      // @ts-expect-error invalid enum
      const bad: Role = 'superadmin'
    `)
    expect(r.ok).toBe(true)
  })
})

// ── 객체 라운드트립 ─────────────────────────────────────────

describe('객체 라운드트립', () => {
  it('required + optional 필드 보존', () => {
    const r = roundtripCompile({
      User: z.object({
        id: z.string(),
        name: z.string(),
        bio: z.string().optional(),
      }),
    }, `
      const u: User = { id: '1', name: 'Alice' }
      const full: User = { id: '1', name: 'Alice', bio: 'hi' }
      // @ts-expect-error required 누락
      const bad: User = { id: '1' }
    `)
    expect(r.ok).toBe(true)
  })
})

// ── nullable 라운드트립 ─────────────────────────────────────

describe('nullable 라운드트립', () => {
  it('z.nullable → string | null', () => {
    const r = roundtripCompile({
      NullableName: z.string().nullable(),
    }, `
      const a: NullableName = 'hello'
      const b: NullableName = null
      // @ts-expect-error undefined ≠ null
      const bad: NullableName = undefined
    `)
    expect(r.ok).toBe(true)
  })
})

// ── 배열 라운드트립 ─────────────────────────────────────────

describe('배열 라운드트립', () => {
  it('z.array → T[]', () => {
    const r = roundtripCompile({
      Tags: z.array(z.string()),
    }, `
      const t: Tags = ['a', 'b']
      // @ts-expect-error number in string[]
      const bad: Tags = [1, 2]
    `)
    expect(r.ok).toBe(true)
  })
})

// ── union 라운드트립 ────────────────────────────────────────

describe('union 라운드트립', () => {
  it('z.union → oneOf', () => {
    const r = roundtripCompile({
      StringOrNum: z.union([z.string(), z.number()]),
    }, `
      const a: StringOrNum = 'hello'
      const b: StringOrNum = 42
      // @ts-expect-error boolean not in union
      const bad: StringOrNum = true
    `)
    expect(r.ok).toBe(true)
  })
})

// ── intersection 라운드트립 ─────────────────────────────────

describe('intersection 라운드트립', () => {
  it('z.intersection → allOf', () => {
    const r = roundtripCompile({
      WithId: z.object({ id: z.string() }),
      WithName: z.object({ name: z.string() }),
      Full: z.intersection(
        z.object({ id: z.string() }),
        z.object({ name: z.string() }),
      ),
    }, `
      const f: Full = { id: '1', name: 'Alice' }
      // @ts-expect-error missing name
      const bad: Full = { id: '1' }
    `)
    expect(r.ok).toBe(true)
  })
})

// ── 중첩 객체 라운드트립 ────────────────────────────────────

describe('중첩 객체 라운드트립', () => {
  it('nested object 구조 보존', () => {
    const r = roundtripCompile({
      Address: z.object({
        city: z.string(),
        geo: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
      }),
    }, `
      const a: Address = { city: 'Seoul', geo: { lat: 37.5, lng: 127.0 } }
      // @ts-expect-error geo.lat missing
      const bad: Address = { city: 'Seoul', geo: { lng: 127.0 } }
    `)
    expect(r.ok).toBe(true)
  })
})

// ── 복합 시나리오 ───────────────────────────────────────────

describe('복합 시나리오 라운드트립', () => {
  it('실제 도메인 모델: User + Post + Comment', () => {
    const r = roundtripCompile({
      User: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        role: z.enum(['admin', 'user']),
      }),
      Post: z.object({
        id: z.string(),
        title: z.string(),
        content: z.string().optional(),
        published: z.boolean(),
      }),
      Comment: z.object({
        id: z.string(),
        body: z.string(),
        rating: z.number().optional(),
      }),
    }, `
      const user: User = { id: '1', name: 'A', email: 'a@b.com', role: 'admin' }
      const post: Post = { id: '1', title: 'Hi', published: true }
      const comment: Comment = { id: '1', body: 'Nice' }

      // @ts-expect-error role enum
      const badUser: User = { id: '1', name: 'A', email: 'a@b.com', role: 'mod' }
    `)
    expect(r.ok).toBe(true)
  })
})
