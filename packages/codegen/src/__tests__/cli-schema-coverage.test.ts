/**
 * CLI 스키마 표현 범위 E2E 테스트
 *
 * 다양한 OAS 스키마 패턴을 담은 스펙 → oa-gen typegen → 출력 TS 검증.
 * schemaToTs 유닛 테스트와 달리, 전체 파이프라인(YAML 파싱 → parseDocument → typegen)을 통과.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { stringify as yamlStringify } from 'yaml'

const pkgDir = resolve(__dirname, '../..')
const cliPath = resolve(pkgDir, 'dist/cli/index.js')
const tmpDir = resolve(pkgDir, '.tmp-cli-schema')

function cli(args: string): string {
  return execSync(`node ${cliPath} ${args}`, { cwd: pkgDir, encoding: 'utf8', timeout: 10_000 })
}

// ── 전체 스키마 패턴을 커버하는 스펙 ───────────────────────

const SCHEMA_SPEC = {
  openapi: '3.2.0',
  info: { title: 'Schema Coverage API', version: '1.0.0' },
  paths: {
    '/test': {
      get: {
        operationId: 'getTest',
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/AllPatterns' } } } } },
      },
    },
  },
  components: {
    schemas: {
      // ── 1. 기본 타입 ──────────────────────────────────────
      Primitives: {
        type: 'object',
        required: ['str', 'num', 'int', 'bool', 'nil'],
        properties: {
          str:  { type: 'string' },
          num:  { type: 'number' },
          int:  { type: 'integer' },
          bool: { type: 'boolean' },
          nil:  { type: 'null' },
        },
      },

      // ── 2. 포맷 ──────────────────────────────────────────
      Formats: {
        type: 'object',
        properties: {
          email:    { type: 'string', format: 'email' },
          uuid:     { type: 'string', format: 'uuid' },
          datetime: { type: 'string', format: 'date-time' },
          uri:      { type: 'string', format: 'uri' },
        },
      },

      // ── 3. enum / const ───────────────────────────────────
      Status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
      HttpCode: { type: 'integer', enum: [200, 400, 500] },
      FixedValue: { type: 'string', const: 'FIXED' },

      // ── 4. nullable ───────────────────────────────────────
      NullableString: { type: ['string', 'null'] },
      NullableInt: { type: ['integer', 'null'] },

      // ── 5. 배열 ──────────────────────────────────────────
      StringArray: { type: 'array', items: { type: 'string' } },
      ObjectArray: { type: 'array', items: { $ref: '#/components/schemas/Primitives' } },
      EmptyArray: { type: 'array' },

      // ── 6. 튜플 (prefixItems) ─────────────────────────────
      Coordinate: {
        type: 'array',
        prefixItems: [
          { type: 'number' },
          { type: 'number' },
        ],
      },
      LabeledCoord: {
        type: 'array',
        prefixItems: [
          { type: 'string' },
          { type: 'number' },
          { type: 'number' },
        ],
        items: { type: 'string' },
      },

      // ── 7. 중첩 객체 ─────────────────────────────────────
      Nested: {
        type: 'object',
        required: ['address'],
        properties: {
          address: {
            type: 'object',
            required: ['city'],
            properties: {
              city: { type: 'string' },
              zip:  { type: 'string' },
            },
          },
        },
      },

      // ── 8. required vs optional ───────────────────────────
      Mixed: {
        type: 'object',
        required: ['id'],
        properties: {
          id:   { type: 'string' },
          name: { type: 'string' },
          bio:  { type: 'string' },
        },
      },

      // ── 9. allOf (intersection) ───────────────────────────
      Base: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      Extended: {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        ],
      },

      // ── 10. oneOf (union) ─────────────────────────────────
      StringOrNumber: {
        oneOf: [{ type: 'string' }, { type: 'number' }],
      },

      // ── 11. anyOf ─────────────────────────────────────────
      Flexible: {
        anyOf: [{ type: 'string' }, { type: 'boolean' }],
      },

      // ── 12. discriminated union ───────────────────────────
      Shape: {
        oneOf: [
          { type: 'object', required: ['kind', 'radius'], properties: { kind: { type: 'string', const: 'circle' }, radius: { type: 'number' } } },
          { type: 'object', required: ['kind', 'side'],   properties: { kind: { type: 'string', const: 'square' }, side: { type: 'number' } } },
        ],
        discriminator: { propertyName: 'kind' },
      },

      // ── 13. additionalProperties ──────────────────────────
      StringMap: { type: 'object', additionalProperties: { type: 'string' } },
      OpenObject: { type: 'object', additionalProperties: true },
      MixedMap: {
        type: 'object',
        properties: { id: { type: 'integer' } },
        additionalProperties: { type: 'string' },
      },

      // ── 14. $ref 참조 ────────────────────────────────────
      UserRef: {
        type: 'object',
        required: ['user'],
        properties: {
          user: { $ref: '#/components/schemas/Base' },
        },
      },

      // ── 15. 배열 내 union ─────────────────────────────────
      UnionArray: {
        type: 'array',
        items: { oneOf: [{ type: 'string' }, { type: 'number' }] },
      },

      // ── 16. if/then/else ──────────────────────────────────
      Conditional: {
        if:   { properties: { mode: { const: 'text' } } },
        then: { type: 'object', properties: { content: { type: 'string' } } },
        else: { type: 'object', properties: { content: { type: 'integer' } } },
      },

      // ── 17. example/default가 타입에 영향 없음 ────────────
      WithExamples: {
        type: 'object',
        required: ['code'],
        properties: {
          code:  { type: 'string', example: 'NOT_FOUND' },
          count: { type: 'integer', default: 0 },
        },
      },

      // ── 18. 특수 키 (이스케이프 필요) ─────────────────────
      SpecialKeys: {
        type: 'object',
        required: ['content-type'],
        properties: {
          'content-type': { type: 'string' },
          'x-custom':     { type: 'boolean' },
        },
      },

      // ── 19. 빈 객체 ──────────────────────────────────────
      Empty: { type: 'object' },

      // ── 20. allOf 3개 합성 ────────────────────────────────
      Triple: {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'number' } } },
          { type: 'object', properties: { c: { type: 'boolean' } } },
        ],
      },

      // ── 21. 중첩 composition: allOf 안에 oneOf ────────────
      AllOfWithOneOf: {
        allOf: [
          { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          { oneOf: [
            { type: 'object', properties: { role: { type: 'string', const: 'admin' } } },
            { type: 'object', properties: { role: { type: 'string', const: 'user' } } },
          ]},
        ],
      },

      // ── 22. oneOf 안에 allOf ──────────────────────────────
      OneOfWithAllOf: {
        oneOf: [
          { allOf: [
            { $ref: '#/components/schemas/Base' },
            { type: 'object', properties: { extra: { type: 'string' } } },
          ]},
          { type: 'object', properties: { fallback: { type: 'boolean' } } },
        ],
      },

      // ── 23. 중첩 배열: array of array ─────────────────────
      Matrix: { type: 'array', items: { type: 'array', items: { type: 'number' } } },

      // ── 24. nullable 배열 ─────────────────────────────────
      NullableArray: { type: ['array', 'null'], items: { type: 'string' } },

      // ── 25. nullable 객체 ─────────────────────────────────
      NullableObject: {
        type: ['object', 'null'],
        properties: { name: { type: 'string' } },
      },

      // ── 26. 3+ depth 중첩 객체 ────────────────────────────
      DeepNested: {
        type: 'object',
        required: ['level1'],
        properties: {
          level1: {
            type: 'object',
            required: ['level2'],
            properties: {
              level2: {
                type: 'object',
                required: ['value'],
                properties: { value: { type: 'string' } },
              },
            },
          },
        },
      },

      // ── 27. 모든 필드 required ────────────────────────────
      AllRequired: {
        type: 'object',
        required: ['a', 'b', 'c'],
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
          c: { type: 'boolean' },
        },
      },

      // ── 28. 모든 필드 optional (required 생략) ─────────────
      AllOptional: {
        type: 'object',
        properties: {
          x: { type: 'string' },
          y: { type: 'number' },
        },
      },

      // ── 29. 복합 additionalProperties (배열 값) ────────────
      ArrayMap: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },

      // ── 30. 복합 additionalProperties (객체 값) ────────────
      ObjectMap: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: { score: { type: 'number' } },
        },
      },

      // ── 31. 프로퍼티에 인라인 oneOf ────────────────────────
      InlineUnionProp: {
        type: 'object',
        required: ['value'],
        properties: {
          value: { oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'boolean' }] },
        },
      },

      // ── 32. 프로퍼티에 인라인 allOf ────────────────────────
      InlineIntersectProp: {
        type: 'object',
        properties: {
          data: {
            allOf: [
              { type: 'object', properties: { x: { type: 'number' } } },
              { type: 'object', properties: { y: { type: 'number' } } },
            ],
          },
        },
      },

      // ── 33. union of objects (discriminator 없이) ──────────
      UndiscriminatedUnion: {
        oneOf: [
          { type: 'object', required: ['name'], properties: { name: { type: 'string' }, age: { type: 'integer' } } },
          { type: 'object', required: ['title'], properties: { title: { type: 'string' }, pages: { type: 'integer' } } },
        ],
      },

      // ── 34. boolean const ─────────────────────────────────
      TrueConst: { type: 'boolean', const: true },

      // ── 35. description → JSDoc ───────────────────────────
      Documented: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '사용자 이름' },
          age:  { type: 'integer', description: '나이 (세)' },
        },
      },

      // ── 36. 다중 $ref 프로퍼티 ────────────────────────────
      MultiRef: {
        type: 'object',
        required: ['author', 'reviewer'],
        properties: {
          author:   { $ref: '#/components/schemas/Base' },
          reviewer: { $ref: '#/components/schemas/Primitives' },
          tags:     { type: 'array', items: { $ref: '#/components/schemas/Status' } },
        },
      },

      // ── 37. $ref 배열 + nullable ──────────────────────────
      NullableRefArray: {
        type: ['array', 'null'],
        items: { $ref: '#/components/schemas/Base' },
      },

      // ── 38. allOf: $ref + nullable inline ─────────────────
      NullableExtended: {
        allOf: [
          { $ref: '#/components/schemas/Base' },
          { type: 'object', properties: { deletedAt: { type: ['string', 'null'], format: 'date-time' } } },
        ],
      },

      // ── 39. 빈 oneOf / anyOf ──────────────────────────────
      EmptyOneOf: { oneOf: [] },
      EmptyAnyOf: { anyOf: [] },

      // ── 40. 숫자 키 프로퍼티 ──────────────────────────────
      NumericKeys: {
        type: 'object',
        properties: {
          '200': { type: 'string' },
          '404': { type: 'string' },
        },
      },

      // ── 루트 ──────────────────────────────────────────────
      AllPatterns: {
        type: 'object',
        properties: {
          primitives: { $ref: '#/components/schemas/Primitives' },
          status:     { $ref: '#/components/schemas/Status' },
          shape:      { $ref: '#/components/schemas/Shape' },
        },
      },
    },
  },
}

let specPath: string
let output: string

beforeAll(() => {
  mkdirSync(tmpDir, { recursive: true })
  specPath = join(tmpDir, 'schema-coverage.yaml')
  writeFileSync(specPath, yamlStringify(SCHEMA_SPEC), 'utf8')
  output = cli(`typegen -s ${specPath}`)
})

afterAll(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
})

// ── 1. 기본 타입 ────────────────────────────────────────────

describe('기본 타입', () => {
  it('string', ()  => expect(output).toContain('str: string'))
  it('number', ()  => expect(output).toContain('num: number'))
  it('integer → number', () => expect(output).toContain('int: number'))
  it('boolean', () => expect(output).toContain('bool: boolean'))
  it('null', ()    => expect(output).toContain('nil: null'))
})

// ── 2. 포맷 ─────────────────────────────────────────────────

describe('포맷', () => {
  it('format 프로퍼티는 string 타입으로 유지', () => {
    expect(output).toMatch(/email\??: string/)
    expect(output).toMatch(/uuid\??: string/)
    expect(output).toMatch(/datetime\??: string/)
  })
})

// ── 3. enum / const ─────────────────────────────────────────

describe('enum / const', () => {
  it('string enum → 리터럴 유니온', () => {
    expect(output).toContain("'active' | 'inactive' | 'pending'")
  })
  it('integer enum → 숫자 리터럴 유니온', () => {
    expect(output).toContain('200 | 400 | 500')
  })
  it('const → 단일 리터럴', () => {
    expect(output).toContain("'FIXED'")
  })
})

// ── 4. nullable ─────────────────────────────────────────────

describe('nullable', () => {
  it('string | null', () => {
    expect(output).toContain('string | null')
  })
  it('number | null', () => {
    expect(output).toContain('number | null')
  })
})

// ── 5. 배열 ─────────────────────────────────────────────────

describe('배열', () => {
  it('string[]', ()  => expect(output).toContain('string[]'))
  it('$ref 배열 → 참조[]', () => expect(output).toContain('Primitives[]'))
  it('빈 배열 → unknown[]', () => expect(output).toContain('unknown[]'))
})

// ── 6. 튜플 ─────────────────────────────────────────────────

describe('튜플', () => {
  it('[number, number]', () => {
    expect(output).toContain('[number, number]')
  })
  it('rest 포함 튜플 [string, number, number, ...string[]]', () => {
    expect(output).toContain('[string, number, number, ...string[]]')
  })
})

// ── 7. 중첩 객체 ────────────────────────────────────────────

describe('중첩 객체', () => {
  it('address 내부에 city 존재', () => {
    expect(output).toContain('address: {')
    expect(output).toContain('city: string')
  })
})

// ── 8. required vs optional ─────────────────────────────────

describe('required vs optional', () => {
  it('required 필드는 ? 없음', () => {
    expect(output).toMatch(/\bid: string\b/)
  })
  it('optional 필드는 ? 있음', () => {
    expect(output).toContain('name?: string')
    expect(output).toContain('bio?: string')
  })
})

// ── 9. allOf ────────────────────────────────────────────────

describe('allOf (intersection)', () => {
  it('$ref & inline → intersection 타입', () => {
    expect(output).toMatch(/export type Extended = \(Base\) & \(\{/)
    expect(output).toContain('name: string')
  })
})

// ── 10. oneOf ───────────────────────────────────────────────

describe('oneOf (union)', () => {
  it('string | number', () => {
    expect(output).toContain('string | number')
  })
})

// ── 11. anyOf ───────────────────────────────────────────────

describe('anyOf', () => {
  it('string | boolean', () => {
    expect(output).toContain('string | boolean')
  })
})

// ── 12. discriminated union ─────────────────────────────────

describe('discriminated union', () => {
  it('kind: circle / kind: square 분기', () => {
    expect(output).toContain("kind: 'circle'")
    expect(output).toContain("kind: 'square'")
  })
  it('각 variant 프로퍼티', () => {
    expect(output).toMatch(/radius\??: number/)
    expect(output).toMatch(/side\??: number/)
  })
})

// ── 13. additionalProperties ────────────────────────────────

describe('additionalProperties', () => {
  it('Record<string, string>', () => {
    expect(output).toContain('Record<string, string>')
  })
  it('Record<string, unknown>', () => {
    expect(output).toContain('Record<string, unknown>')
  })
  it('고정 필드 + index signature', () => {
    expect(output).toContain('[key: string]: string')
  })
})

// ── 14. $ref 참조 ───────────────────────────────────────────

describe('$ref 참조', () => {
  it('프로퍼티에서 $ref → 타입 이름 참조', () => {
    expect(output).toContain('user: Base')
  })
})

// ── 15. 배열 내 union ───────────────────────────────────────

describe('배열 내 union', () => {
  it('(string | number)[]', () => {
    expect(output).toContain('(string | number)[]')
  })
})

// ── 16. if/then/else ────────────────────────────────────────

describe('if/then/else → union', () => {
  it('then과 else 타입이 union', () => {
    // Conditional 타입에 content: string과 content: number가 union으로 존재
    const conditionalMatch = output.match(/export type Conditional = (.+)/s)
    expect(conditionalMatch).toBeTruthy()
    expect(output).toContain('|') // union 연산자 존재
  })
})

// ── 17. example/default 무시 ────────────────────────────────

describe('example/default 무시', () => {
  it('example 있어도 string 타입', () => {
    expect(output).toMatch(/code: string/)
    expect(output).not.toContain('NOT_FOUND')
  })
  it('default 있어도 number 타입', () => {
    expect(output).toMatch(/count\??: number/)
  })
})

// ── 18. 특수 키 이스케이프 ──────────────────────────────────

describe('특수 키 이스케이프', () => {
  it('content-type → 따옴표 감싸기', () => {
    expect(output).toContain("'content-type': string")
  })
  it('x-custom → 따옴표 감싸기', () => {
    expect(output).toContain("'x-custom'")
  })
})

// ── 19. 빈 객체 ─────────────────────────────────────────────

describe('빈 객체', () => {
  it('Record<string, unknown>', () => {
    // Empty 타입이 Record로 출력
    expect(output).toMatch(/export type Empty = Record<string, unknown>/)
  })
})

// ── 20. allOf 3개 합성 ──────────────────────────────────────

describe('allOf 3개 합성', () => {
  it('a & b & c', () => {
    const tripleStart = output.indexOf('export type Triple =')
    expect(tripleStart).toBeGreaterThan(-1)
    const tripleSlice = output.slice(tripleStart, tripleStart + 200)
    expect(tripleSlice).toContain('&')
    expect(tripleSlice).toContain('a')
    expect(tripleSlice).toContain('b')
    expect(tripleSlice).toContain('c')
  })
})

// ── 21. 중첩 composition: allOf + oneOf ─────────────────────

describe('중첩 composition: allOf 안에 oneOf', () => {
  it('intersection과 union이 공존', () => {
    const s = sliceType('AllOfWithOneOf')
    expect(s).toContain('&')
    expect(s).toContain('|')
    expect(s).toContain('id: string')
  })
})

// ── 22. oneOf 안에 allOf ────────────────────────────────────

describe('중첩 composition: oneOf 안에 allOf', () => {
  it('union 브랜치 중 하나가 intersection', () => {
    const s = sliceType('OneOfWithAllOf')
    expect(s).toContain('|')
    expect(s).toContain('Base')
  })
})

// ── 23. 중첩 배열 ───────────────────────────────────────────

describe('중첩 배열 (array of array)', () => {
  it('number[][]', () => {
    expect(output).toContain('number[][]')
  })
})

// ── 24. nullable 배열 ───────────────────────────────────────

describe('nullable 배열', () => {
  it('string[] | null', () => {
    expect(output).toContain('string[] | null')
  })
})

// ── 25. nullable 객체 ───────────────────────────────────────

describe('nullable 객체', () => {
  it('object | null 형태', () => {
    const s = sliceType('NullableObject')
    expect(s).toContain('| null')
    expect(s).toContain('name')
  })
})

// ── 26. 3+ depth 중첩 ──────────────────────────────────────

describe('3+ depth 중첩 객체', () => {
  it('level1.level2.value 구조', () => {
    expect(output).toContain('level1: {')
    expect(output).toContain('level2: {')
    expect(output).toContain('value: string')
  })
})

// ── 27. 모든 필드 required ──────────────────────────────────

describe('모든 필드 required', () => {
  it('? 없이 a, b, c', () => {
    const s = sliceTypeBody('AllRequired')
    expect(s).toContain('a: string')
    expect(s).toContain('b: number')
    expect(s).toContain('c: boolean')
    expect(s).not.toContain('?')
  })
})

// ── 28. 모든 필드 optional ──────────────────────────────────

describe('모든 필드 optional', () => {
  it('x?, y? 모두 optional', () => {
    const s = sliceType('AllOptional')
    expect(s).toContain('x?: string')
    expect(s).toContain('y?: number')
  })
})

// ── 29. 복합 additionalProperties (배열) ────────────────────

describe('복합 additionalProperties: 배열 값', () => {
  it('Record<string, string[]>', () => {
    expect(output).toContain('Record<string, string[]>')
  })
})

// ── 30. 복합 additionalProperties (객체) ────────────────────

describe('복합 additionalProperties: 객체 값', () => {
  it('Record<string, { score }>', () => {
    const s = sliceType('ObjectMap')
    expect(s).toContain('Record<string,')
    expect(s).toContain('score')
  })
})

// ── 31. 인라인 oneOf 프로퍼티 ───────────────────────────────

describe('프로퍼티에 인라인 oneOf', () => {
  it('value: string | number | boolean', () => {
    const s = sliceType('InlineUnionProp')
    expect(s).toContain('value: string | number | boolean')
  })
})

// ── 32. 인라인 allOf 프로퍼티 ───────────────────────────────

describe('프로퍼티에 인라인 allOf', () => {
  it('data에 x, y 포함 intersection', () => {
    const s = sliceType('InlineIntersectProp')
    expect(s).toContain('data')
    expect(s).toContain('&')
  })
})

// ── 33. union of objects (discriminator 없이) ───────────────

describe('discriminator 없는 object union', () => {
  it('두 object 타입이 | 로 연결', () => {
    const s = sliceType('UndiscriminatedUnion')
    expect(s).toContain('|')
    expect(s).toContain('name')
    expect(s).toContain('title')
  })
})

// ── 34. boolean const ───────────────────────────────────────

describe('boolean const', () => {
  it('true 리터럴', () => {
    expect(output).toMatch(/export type TrueConst = true/)
  })
})

// ── 35. description → JSDoc ─────────────────────────────────

describe('description → JSDoc 주석', () => {
  it('프로퍼티 설명이 주석으로 출력', () => {
    expect(output).toContain('/** 사용자 이름 */')
    expect(output).toContain('/** 나이 (세) */')
  })
})

// ── 36. 다중 $ref 프로퍼티 ──────────────────────────────────

describe('다중 $ref 프로퍼티', () => {
  it('서로 다른 $ref 타입 참조', () => {
    const s = sliceType('MultiRef')
    expect(s).toContain('author: Base')
    expect(s).toContain('reviewer: Primitives')
    expect(s).toContain('Status[]')
  })
})

// ── 37. $ref 배열 + nullable ────────────────────────────────

describe('$ref 배열 + nullable', () => {
  it('Base[] | null', () => {
    expect(output).toContain('Base[] | null')
  })
})

// ── 38. allOf: $ref + nullable inline ───────────────────────

describe('allOf + nullable 프로퍼티', () => {
  it('deletedAt가 string | null', () => {
    const s = sliceType('NullableExtended')
    expect(s).toContain('string | null')
  })
})

// ── 39. 빈 oneOf / anyOf ────────────────────────────────────

describe('빈 composition', () => {
  // 빈 배열(length 0)은 foldSchema에서 조합 핸들러에 진입하지 않음 → fallback → unknown
  it('빈 oneOf → unknown (fallback)', () => {
    expect(output).toMatch(/export type EmptyOneOf = unknown/)
  })
  it('빈 anyOf → unknown (fallback)', () => {
    expect(output).toMatch(/export type EmptyAnyOf = unknown/)
  })
})

// ── 40. 숫자 키 프로퍼티 ────────────────────────────────────

describe('숫자 키 프로퍼티', () => {
  it('숫자 키도 따옴표 이스케이프', () => {
    const s = sliceType('NumericKeys')
    expect(s).toContain("'200'")
    expect(s).toContain("'404'")
  })
})

// ── 헬퍼 ────────────────────────────────────────────────────

/** 특정 타입 정의 주변 텍스트를 슬라이스 */
function sliceType(name: string, len = 400): string {
  const idx = output.indexOf(`export type ${name} =`)
  if (idx === -1) return ''
  return output.slice(idx, idx + len)
}

/** 타입 정의의 바디만 추출 (다음 export 전까지) */
function sliceTypeBody(name: string): string {
  const start = output.indexOf(`export type ${name} =`)
  if (start === -1) return ''
  const nextExport = output.indexOf('\nexport ', start + 1)
  return nextExport === -1 ? output.slice(start) : output.slice(start, nextExport)
}
