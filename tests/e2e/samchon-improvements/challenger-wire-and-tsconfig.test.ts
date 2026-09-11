import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Equal, JsonPrimitive, Resolved, ValueOf, ClassProperties } from '../../../packages/core/src/wire-format.js'
import { generateClient } from '../../../packages/client/src/index.js'
import {
  computeTsconfigUniverse,
  computeTsconfigUniverseDigest,
  parseJsonc,
  stripJsonComments,
  removeTrailingCommas,
  configurationClosure,
} from '../../../packages/spec-lens/src/infrastructure/cache/sqlite/cache-key.js'
import {
  buildSpecProjectKey,
  createSpecProjectIdentity,
  SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
  type SpecProjectKeyInput,
  type SpecSnapshotStored,
} from '../../../packages/spec-lens/src/domain/index.js'
import { SqliteCache } from '../../../packages/spec-lens/src/infrastructure/cache/sqlite/sqlite-cache.js'

// Type-level assertion helper
type Assert<T extends true> = T
type AssertExtends<A, B> = A extends B ? true : false
type AssertNotExtends<A, B> = A extends B ? false : true

describe('Empirical Challenger: Wire-Format Safety (JsonPrimitive<T> & Resolved<T>)', () => {
  // ---------------------------------------------------------------------------
  // 1. Date -> string mapping
  // ---------------------------------------------------------------------------
  describe('1. Date -> string mapping', () => {
    it('maps top-level Date to string', () => {
      type DirectDate = Assert<Equal<JsonPrimitive<Date>, string>>
      const val: DirectDate = true
      expect(val).toBe(true)
    })

    it('maps nested Date properties to string', () => {
      interface Post {
        id: string
        createdAt: Date
        updatedAt?: Date
        deletedAt: Date | null
      }
      type WirePost = JsonPrimitive<Post>

      type CheckCreated = Assert<Equal<WirePost['createdAt'], string>>
      type CheckUpdated = Assert<Equal<WirePost['updatedAt'], string | undefined>>
      type CheckDeleted = Assert<Equal<WirePost['deletedAt'], string | null>>

      const sample: WirePost = {
        id: 'p-1',
        createdAt: '2026-09-11T00:00:00.000Z',
        deletedAt: null,
      }
      expect(typeof sample.createdAt).toBe('string')
    })

    it('maps Date inside arrays and tuples to string', () => {
      type DateList = Assert<Equal<JsonPrimitive<Date[]>, string[]>>
      type DateTuple = Assert<Equal<JsonPrimitive<[Date, number, Date]>, [string, number, string]>>
      type ReadonlyDateTuple = Assert<Equal<JsonPrimitive<readonly [Date, boolean]>, readonly [string, boolean]>>

      const t: JsonPrimitive<[Date, number]> = ['2026-09-11T00:00:00Z', 100]
      expect(typeof t[0]).toBe('string')
      expect(t[1]).toBe(100)
    })

    it('maps toJSON() returning Date recursively to string', () => {
      class Schedule {
        constructor(public eventDate: Date) {}
        toJSON(): { at: Date } {
          return { at: this.eventDate }
        }
      }
      type WireSchedule = JsonPrimitive<Schedule>
      type CheckAt = Assert<Equal<WireSchedule, { at: string }>>

      const s: WireSchedule = { at: '2026-09-11T12:00:00Z' }
      expect(typeof s.at).toBe('string')
    })

    it('maps custom subclass of Date to string', () => {
      class Timestamp extends Date {
        format(): string { return this.toISOString() }
      }
      type WireTimestamp = Assert<Equal<JsonPrimitive<Timestamp>, string>>
      const check: WireTimestamp = true
      expect(check).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Methods, functions, getters, and prototype chains stripping
  // ---------------------------------------------------------------------------
  describe('2. Methods, functions, getters, and prototype chains stripping', () => {
    class BaseEntity {
      baseId: string = 'base-1'
      baseMethod(): string { return this.baseId }
    }

    class MiddleEntity extends BaseEntity {
      middleCount: number = 42
      async middleAsync(): Promise<number> { return this.middleCount }
    }

    class DerivedEntity extends MiddleEntity {
      derivedFlag: boolean = true
      callbackProp: (x: number) => void = () => {}
      optionalFn?: () => string

      get computed(): string {
        return `${this.baseId}-${this.middleCount}`
      }

      get funcGetter(): () => void {
        return () => {}
      }

      *generatorMethod(): Generator<number> {
        yield 1
      }
    }

    it('strips methods across the entire prototype inheritance chain', () => {
      type WireDerived = JsonPrimitive<DerivedEntity>

      // Data properties are preserved
      type HasBaseId = Assert<Equal<WireDerived['baseId'], string>>
      type HasMiddleCount = Assert<Equal<WireDerived['middleCount'], number>>
      type HasDerivedFlag = Assert<Equal<WireDerived['derivedFlag'], boolean>>

      // Methods on prototype chain are stripped
      type NoBaseMethod = Assert<AssertNotExtends<'baseMethod', keyof WireDerived>>
      type NoMiddleAsync = Assert<AssertNotExtends<'middleAsync', keyof WireDerived>>
      type NoGenerator = Assert<AssertNotExtends<'generatorMethod', keyof WireDerived>>

      // Function properties are stripped
      type NoCallback = Assert<AssertNotExtends<'callbackProp', keyof WireDerived>>
      type NoOptionalFn = Assert<AssertNotExtends<'optionalFn', keyof WireDerived>>

      // Getter returning a function is stripped
      type NoFuncGetter = Assert<AssertNotExtends<'funcGetter', keyof WireDerived>>

      // Getter returning a data value is preserved as data property at type level
      type HasComputed = Assert<Equal<WireDerived['computed'], string>>

      const inst: WireDerived = {
        baseId: 'b-1',
        middleCount: 10,
        derivedFlag: true,
        computed: 'b-1-10',
      }
      expect(inst.baseId).toBe('b-1')
      expect((inst as any).baseMethod).toBeUndefined()
    })

    it('strips symbol keys and maps symbol values to never', () => {
      const symKey = Symbol('internal')
      type WithSymbol = {
        [symKey]: string
        regular: string
        symbolVal: symbol
      }
      type WireSymbol = JsonPrimitive<WithSymbol>

      type HasRegular = Assert<Equal<WireSymbol['regular'], string>>
      type NoSymKey = Assert<AssertNotExtends<typeof symKey, keyof WireSymbol>>
      type SymbolValNever = Assert<Equal<WireSymbol['symbolVal'], never>>

      const check: AssertNotExtends<typeof symKey, keyof WireSymbol> = true
      expect(check).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Boxed primitives unboxing
  // ---------------------------------------------------------------------------
  describe('3. Boxed primitives unboxing', () => {
    it('unboxes Boolean, Number, String to primitive types', () => {
      type UnboxedBool = Assert<Equal<ValueOf<Boolean>, boolean>>
      type UnboxedNum = Assert<Equal<ValueOf<Number>, number>>
      type UnboxedStr = Assert<Equal<ValueOf<String>, string>>

      type WireBool = Assert<Equal<JsonPrimitive<Boolean>, boolean>>
      type WireNum = Assert<Equal<JsonPrimitive<Number>, number>>
      type WireStr = Assert<Equal<JsonPrimitive<String>, string>>

      const b: WireBool = true
      const n: WireNum = 42
      const s: WireStr = 'unboxed'

      expect(typeof b).toBe('boolean')
      expect(typeof n).toBe('number')
      expect(typeof s).toBe('string')
    })

    it('unboxes boxed primitives without widening literal types', () => {
      type PreserveStringLit = Assert<Equal<ValueOf<'literal'>, 'literal'>>
      type PreserveNumLit = Assert<Equal<ValueOf<99>, 99>>
      type PreserveBoolLit = Assert<Equal<ValueOf<false>, false>>

      const lit: PreserveStringLit = 'literal'
      expect(lit).toBe('literal')
    })

    it('unboxes boxed primitives inside complex objects', () => {
      interface ComplexBoxed {
        flag: Boolean
        count: Number
        label: String
        tags: String[]
      }
      type WireBoxed = JsonPrimitive<ComplexBoxed>

      type CheckFlag = Assert<Equal<WireBoxed['flag'], boolean>>
      type CheckCount = Assert<Equal<WireBoxed['count'], number>>
      type CheckLabel = Assert<Equal<WireBoxed['label'], string>>
      type CheckTags = Assert<Equal<WireBoxed['tags'], string[]>>

      const sample: WireBoxed = {
        flag: true,
        count: 10,
        label: 'test',
        tags: ['a', 'b'],
      }
      expect(sample.flag).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // 4. bigint -> never
  // ---------------------------------------------------------------------------
  describe('4. bigint -> never', () => {
    it('maps bigint to never statically', () => {
      type BigIntNever = Assert<Equal<JsonPrimitive<bigint>, never>>
      type BigIntLiteralNever = Assert<Equal<JsonPrimitive<1000n>, never>>
      const check: BigIntNever = undefined as never
      expect(check).toBeUndefined()
    })

    it('maps bigint in union to never (leaving other members)', () => {
      type UnionWithBigInt = Assert<Equal<JsonPrimitive<bigint | string>, string>>
      const val: UnionWithBigInt = 'ok'
      expect(val).toBe('ok')
    })

    it('maps object property with bigint to never making it non-constructible', () => {
      type HasBigInt = { id: bigint; name: string }
      type WireBigInt = JsonPrimitive<HasBigInt>
      type CheckId = Assert<Equal<WireBigInt['id'], never>>
      type CheckName = Assert<Equal<WireBigInt['name'], string>>

      // At runtime, standard JSON.stringify throws TypeError on BigInt
      expect(() => JSON.stringify({ id: 100n, name: 'Alice' })).toThrow(TypeError)
    })
  })

  // ---------------------------------------------------------------------------
  // 5. Resolved<T> strips methods but preserves Date, Set, Map
  // ---------------------------------------------------------------------------
  describe('5. Resolved<T> strips methods but preserves Date, Set, Map', () => {
    class AggregateRoot {
      id: string = 'agg-1'
      createdAt: Date = new Date('2026-09-11T00:00:00Z')
      tags: Set<string> = new Set(['prod', 'v1'])
      meta: Map<string, Date> = new Map([['syncedAt', new Date()]])
      scores: ReadonlyMap<string, number> = new Map([['alpha', 10]])
      roles: ReadonlySet<string> = new Set(['admin'])
      count: bigint = 9007199254740993n

      save(): void {}
      async commit(): Promise<boolean> { return true }
      get status(): string { return 'active' }
    }

    it('strips methods and preserves Date, Set, Map, and bigint', () => {
      type ResolvedAgg = Resolved<AggregateRoot>

      type HasId = Assert<Equal<ResolvedAgg['id'], string>>
      type HasDate = Assert<Equal<ResolvedAgg['createdAt'], Date>>
      type HasSet = Assert<Equal<ResolvedAgg['tags'], Set<string>>>
      type HasMap = Assert<Equal<ResolvedAgg['meta'], Map<string, Date>>>
      type HasReadonlyMap = Assert<Equal<ResolvedAgg['scores'], ReadonlyMap<string, number>>>
      type HasReadonlySet = Assert<Equal<ResolvedAgg['roles'], ReadonlySet<string>>>
      type HasBigInt = Assert<Equal<ResolvedAgg['count'], bigint>>

      type NoSave = Assert<AssertNotExtends<'save', keyof ResolvedAgg>>
      type NoCommit = Assert<AssertNotExtends<'commit', keyof ResolvedAgg>>

      const dateInstance = new Date('2026-09-11T00:00:00Z')
      const setInstance = new Set(['prod'])
      const mapInstance = new Map([['syncedAt', dateInstance]])

      const inst: ResolvedAgg = {
        id: 'agg-1',
        createdAt: dateInstance,
        tags: setInstance,
        meta: mapInstance,
        scores: new Map([['alpha', 10]]),
        roles: new Set(['admin']),
        count: 9007199254740993n,
        status: 'active',
      }

      expect(inst.createdAt).toBeInstanceOf(Date)
      expect(inst.tags).toBeInstanceOf(Set)
      expect(inst.meta).toBeInstanceOf(Map)
      expect(inst.count).toBe(9007199254740993n)
    })

    it('strips methods recursively at all depths while preserving collections', () => {
      class ChildService {
        cache: Map<string, number> = new Map()
        clearCache(): void {}
      }
      class ParentService {
        children: ChildService[] = []
        tuple: [Date, Set<string>] = [new Date(), new Set()]
        run(): void {}
      }

      type ResolvedParent = Resolved<ParentService>
      type CheckChildCache = Assert<Equal<ResolvedParent['children'][number]['cache'], Map<string, number>>>
      type NoChildClear = Assert<AssertNotExtends<'clearCache', keyof ResolvedParent['children'][number]>>
      type NoParentRun = Assert<AssertNotExtends<'run', keyof ResolvedParent>>
      type CheckTuple = Assert<Equal<ResolvedParent['tuple'], [Date, Set<string>]>>

      const sample: ResolvedParent = {
        children: [{ cache: new Map([['a', 1]]) }],
        tuple: [new Date(), new Set(['x'])],
      }
      expect(sample.tuple[0]).toBeInstanceOf(Date)
      expect(sample.tuple[1]).toBeInstanceOf(Set)
    })
  })

  // ---------------------------------------------------------------------------
  // 6. Generated client SDK code emits wire-safe signatures
  // ---------------------------------------------------------------------------
  describe('6. Generated client SDK code emits wire-safe signatures', () => {
    it('generates client with Promise<JsonPrimitive<...>>, Resolved<TBody>, and inline types', () => {
      const spec = {
        openapi: '3.1.0',
        info: { title: 'Wire Safety Test API', version: '1.0.0' },
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              responses: {
                '200': {
                  description: 'List items',
                  headers: {
                    'x-total-count': {
                      description: 'Total item count',
                      schema: { type: 'integer' },
                    },
                  },
                  content: {
                    'application/json': {
                      schema: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            createdAt: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            post: {
              operationId: 'createItem',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['name'],
                      properties: {
                        name: { type: 'string' },
                        targetDate: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
              responses: {
                '201': {
                  description: 'Created item',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { id: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
          '/items/{id}': {
            delete: {
              operationId: 'deleteItem',
              parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              ],
              responses: {
                '204': { description: 'Deleted' },
              },
            },
          },
        },
      }

      const generatedCode = generateClient(spec as any, { typesImport: './types.js' })

      // 1. Check operation return types wrap with Promise<JsonPrimitive<...>>
      expect(generatedCode).toContain('async listItems(): Promise<JsonPrimitive<ListItemsResponse>>')
      expect(generatedCode).toContain('async createItem(body: Resolved<CreateItemBody>): Promise<JsonPrimitive<CreateItemResponse>>')

      // 2. Check 204 No Content return type is Promise<void>
      expect(generatedCode).toContain('async deleteItem(params: DeleteItemPathParams): Promise<void>')

      // 3. Check withResponse methods wrap with ClientResponse<JsonPrimitive<...>>
      expect(generatedCode).toContain('async listItems(): Promise<ClientResponse<JsonPrimitive<ListItemsResponse>, ListItemsResponseHeaders>>')
      expect(generatedCode).toContain('return requestResponse<JsonPrimitive<ListItemsResponse>, ListItemsResponseHeaders>')

      // 4. Check inline emission of wire format definitions (zero external dependencies)
      expect(generatedCode).toContain('export type JsonPrimitive<T> =')
      expect(generatedCode).toContain('export type Resolved<T> =')
      expect(generatedCode).toContain('export type ValueOf<Instance> =')
      expect(generatedCode).toContain('export type ClassProperties<T extends object> =')
      expect(generatedCode).toContain("export type IsTuple<T extends readonly any[]> =")
      expect(generatedCode).not.toContain("from '@oa-sdk/core'")
    })
  })
})

describe('Empirical Challenger: Transitive tsconfig Universe Hashing (@oa-sdk/spec-lens)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'challenger-tsconfig-')))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------------
  // 1. Complex JSONC with line comments, block comments, trailing commas
  // ---------------------------------------------------------------------------
  describe('1. Complex JSONC files', () => {
    it('parses complex JSONC with nested comments, trailing commas, URLs, and escaped quotes', () => {
      const complexJsonc = `
        {
          // Top-level line comment
          "compilerOptions": {
            /* Multi-line block
               comment with newlines
               and special symbols: // * / */
            "target": "ES2022", // Line comment after value
            "module": "NodeNext",
            "strict": true,
            "lib": [
              "ES2022",
              "DOM",
              /* Block inside array */
              "DOM.Iterable",
            ], // Trailing comma after array
            "paths": {
              "@api/*": ["./api/*",],
            },
          },
          /* Adjacent block comments */ /* Second adjacent */
          "references": [
            { "path": "./subproject", },
          ],
          "metadata": {
            "url": "https://example.com/api//test/*not-a-comment*/?q=1,2,3",
            "escapedString": "Hello \\"world\\" with backslash \\\\ and // inside",
            "trailingString": "ends with comma and brace, } not trailing",
          },
        }
      `

      const parsed = parseJsonc<any>(complexJsonc)
      expect(parsed.compilerOptions.target).toBe('ES2022')
      expect(parsed.compilerOptions.strict).toBe(true)
      expect(parsed.compilerOptions.lib).toEqual(['ES2022', 'DOM', 'DOM.Iterable'])
      expect(parsed.compilerOptions.paths['@api/*']).toEqual(['./api/*'])
      expect(parsed.references).toEqual([{ path: './subproject' }])
      expect(parsed.metadata.url).toBe('https://example.com/api//test/*not-a-comment*/?q=1,2,3')
      expect(parsed.metadata.escapedString).toBe('Hello "world" with backslash \\ and // inside')
      expect(parsed.metadata.trailingString).toBe('ends with comma and brace, } not trailing')
    })

    it('handles Windows CRLF line endings in comments correctly', () => {
      const crlfJsonc = '{\r\n  // Line comment with CRLF\r\n  "strict": true,\r\n  /* Block with CRLF\r\n     second line */\r\n  "target": "ESNext",\r\n}'
      const parsed = parseJsonc<any>(crlfJsonc)
      expect(parsed.strict).toBe(true)
      expect(parsed.target).toBe('ESNext')
    })

    it('handles unclosed block comment safely at EOF without throwing or hanging', () => {
      const unclosed = '{\n  "strict": true\n  /* unclosed comment at EOF'
      const stripped = stripJsonComments(unclosed)
      expect(stripped).toContain('"strict": true')
      expect(stripped).not.toContain('unclosed comment')
    })
  })

  // ---------------------------------------------------------------------------
  // 2. Multi-hop extends chains and project references
  // ---------------------------------------------------------------------------
  describe('2. Multi-hop extends chains and project references', () => {
    it('walks 5-hop linear extends chain (leaf -> h4 -> h3 -> h2 -> h1 -> root)', () => {
      // root.json
      writeFileSync(join(tempDir, 'root.json'), JSON.stringify({ compilerOptions: { target: 'ES2022' } }))
      // hop1.json extends root.json
      writeFileSync(join(tempDir, 'hop1.json'), JSON.stringify({ extends: './root.json' }))
      // hop2.json extends hop1.json
      writeFileSync(join(tempDir, 'hop2.json'), JSON.stringify({ extends: './hop1.json' }))
      // hop3.json extends hop2.json
      writeFileSync(join(tempDir, 'hop3.json'), JSON.stringify({ extends: './hop2.json' }))
      // hop4.json extends hop3.json
      writeFileSync(join(tempDir, 'hop4.json'), JSON.stringify({ extends: './hop3.json' }))
      // leaf.json extends hop4.json
      mkdirSync(join(tempDir, 'src'), { recursive: true })
      writeFileSync(join(tempDir, 'src', 'main.ts'), 'export const x = 1;\n')
      writeFileSync(join(tempDir, 'leaf.json'), JSON.stringify({ extends: './hop4.json', include: ['src'] }))

      const universe = computeTsconfigUniverse(join(tempDir, 'leaf.json'), tempDir)
      expect(universe).toBeDefined()
      expect(universe!.configs.map(c => c.file)).toEqual([
        'hop1.json',
        'hop2.json',
        'hop3.json',
        'hop4.json',
        'leaf.json',
        'root.json',
      ])
      expect(universe!.roots).toContain('src/main.ts')
    })

    it('handles diamond inheritance with array extends', () => {
      // shared.json
      writeFileSync(join(tempDir, 'shared.json'), JSON.stringify({ compilerOptions: { strict: true } }))
      // branchA.json extends shared.json
      writeFileSync(join(tempDir, 'branchA.json'), JSON.stringify({ extends: './shared.json', compilerOptions: { noImplicitAny: true } }))
      // branchB.json extends shared.json
      writeFileSync(join(tempDir, 'branchB.json'), JSON.stringify({ extends: './shared.json', compilerOptions: { strictNullChecks: true } }))
      // root tsconfig extends [branchA, branchB]
      writeFileSync(join(tempDir, 'tsconfig.json'), JSON.stringify({ extends: ['./branchA.json', './branchB.json'] }))

      const universe = computeTsconfigUniverse(join(tempDir, 'tsconfig.json'), tempDir)
      expect(universe).toBeDefined()
      expect(universe!.configs.map(c => c.file)).toEqual([
        'branchA.json',
        'branchB.json',
        'shared.json',
        'tsconfig.json',
      ])
    })

    it('recursively follows composite project references across multiple subdirectories', () => {
      writeFileSync(join(tempDir, 'base.json'), JSON.stringify({ compilerOptions: { composite: true, strict: true } }))

      // Subpackage 1: packages/pkg-a
      const pkgADir = join(tempDir, 'packages', 'pkg-a')
      mkdirSync(join(pkgADir, 'src'), { recursive: true })
      writeFileSync(join(pkgADir, 'src', 'index.ts'), 'export const a = 1;\n')
      writeFileSync(join(pkgADir, 'tsconfig.json'), JSON.stringify({ extends: '../../base.json', include: ['src'] }))

      // Subpackage 2: packages/pkg-b
      const pkgBDir = join(tempDir, 'packages', 'pkg-b')
      mkdirSync(join(pkgBDir, 'src'), { recursive: true })
      writeFileSync(join(pkgBDir, 'src', 'index.ts'), 'export const b = 2;\n')
      writeFileSync(join(pkgBDir, 'tsconfig.json'), JSON.stringify({ extends: '../../base.json', include: ['src'] }))

      // Root tsconfig references pkg-a and pkg-b
      mkdirSync(join(tempDir, 'src'), { recursive: true })
      writeFileSync(join(tempDir, 'src', 'root.ts'), 'export const root = 0;\n')
      writeFileSync(
        join(tempDir, 'tsconfig.json'),
        JSON.stringify({
          extends: './base.json',
          references: [{ path: './packages/pkg-a' }, { path: './packages/pkg-b' }],
          include: ['src'],
        }),
      )

      const universe = computeTsconfigUniverse(join(tempDir, 'tsconfig.json'), tempDir)
      expect(universe).toBeDefined()
      expect(universe!.configs.map(c => c.file)).toEqual([
        'base.json',
        'packages/pkg-a/tsconfig.json',
        'packages/pkg-b/tsconfig.json',
        'tsconfig.json',
      ])
      expect(universe!.roots).toContain('src/root.ts')
      expect(universe!.roots).toContain('packages/pkg-a/src/index.ts')
      expect(universe!.roots).toContain('packages/pkg-b/src/index.ts')
    })
  })

  // ---------------------------------------------------------------------------
  // 3. Circular extends loop prevention
  // ---------------------------------------------------------------------------
  describe('3. Circular extends loop prevention', () => {
    it('terminates cleanly on direct self-reference (A -> A)', () => {
      writeFileSync(join(tempDir, 'self.json'), JSON.stringify({ extends: './self.json', compilerOptions: { strict: true } }))
      const closure = configurationClosure(join(tempDir, 'self.json'), tempDir)
      expect(closure.configs.length).toBe(1)

      const universe = computeTsconfigUniverse(join(tempDir, 'self.json'), tempDir)
      expect(universe).toBeDefined()
      expect(universe!.configs.map(c => c.file)).toEqual(['self.json'])
    })

    it('terminates cleanly on 2-node cycle (A -> B -> A)', () => {
      writeFileSync(join(tempDir, 'a.json'), JSON.stringify({ extends: './b.json' }))
      writeFileSync(join(tempDir, 'b.json'), JSON.stringify({ extends: './a.json' }))

      const closure = configurationClosure(join(tempDir, 'a.json'), tempDir)
      expect(closure.configs.length).toBe(2)

      const universe = computeTsconfigUniverse(join(tempDir, 'a.json'), tempDir)
      expect(universe).toBeDefined()
      expect(universe!.configs.map(c => c.file)).toEqual(['a.json', 'b.json'])
    })

    it('terminates cleanly on 3-node cycle (A -> B -> C -> A)', () => {
      writeFileSync(join(tempDir, 'a.json'), JSON.stringify({ extends: './b.json' }))
      writeFileSync(join(tempDir, 'b.json'), JSON.stringify({ extends: './c.json' }))
      writeFileSync(join(tempDir, 'c.json'), JSON.stringify({ extends: './a.json' }))

      const closure = configurationClosure(join(tempDir, 'a.json'), tempDir)
      expect(closure.configs.length).toBe(3)

      const universe = computeTsconfigUniverse(join(tempDir, 'a.json'), tempDir)
      expect(universe).toBeDefined()
      expect(universe!.configs.map(c => c.file)).toEqual(['a.json', 'b.json', 'c.json'])
    })

    it('terminates cleanly on diamond graph with inner cyclic loop', () => {
      // root -> [a, b]; a -> c; b -> c; c -> a
      writeFileSync(join(tempDir, 'c.json'), JSON.stringify({ extends: './a.json' }))
      writeFileSync(join(tempDir, 'a.json'), JSON.stringify({ extends: './c.json' }))
      writeFileSync(join(tempDir, 'b.json'), JSON.stringify({ extends: './c.json' }))
      writeFileSync(join(tempDir, 'root.json'), JSON.stringify({ extends: ['./a.json', './b.json'] }))

      const closure = configurationClosure(join(tempDir, 'root.json'), tempDir)
      expect(closure.configs.length).toBe(4)

      const universe = computeTsconfigUniverse(join(tempDir, 'root.json'), tempDir)
      expect(universe).toBeDefined()
      expect(universe!.configs.map(c => c.file)).toEqual(['a.json', 'b.json', 'c.json', 'root.json'])
    })
  })

  // ---------------------------------------------------------------------------
  // 4. Modifying extended base tsconfig alters buildSpecProjectKey and causes cache miss in SQLite WAL store
  // ---------------------------------------------------------------------------
  describe('4. Extended tsconfig alteration & SQLite WAL cache invalidation proof', () => {
    let dbPath: string
    let cache: SqliteCache

    beforeEach(() => {
      dbPath = join(tempDir, 'test-cache.sqlite')
      cache = new SqliteCache(dbPath)
    })

    afterEach(() => {
      cache.close()
    })

    const observation = {
      adapterKind: 'local-git',
      repository: 'file:///test-repo',
      ref: 'main',
    } as const

    function createSnapshot(projectKey: string, revId: string): SpecSnapshotStored {
      return {
        schemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
        projectKey,
        projectKind: 'definition-builder',
        sourceRoot: 'fragments',
        revision: {
          id: revId,
          shortId: revId.slice(0, 7),
          timestamp: 1000,
          message: 'initial',
          source: 'local-git',
        },
        fragmentsDir: 'fragments',
        targetPath: 'target.yaml',
        targetConfigDigest: 'target-digest-1',
        spec: { openapi: '3.1.0', info: { title: 'Test', version: '1.0.0' }, paths: {} },
        provenance: { status: 'available', kind: 'definition-builder', entries: {} },
        composition: {
          schemaVersion: 'oa-gen.composition-report.v1' as const,
          target: { name: 'test', targetPath: 'target.yaml', fragmentsDir: 'fragments', scopes: [], domains: [], includePaths: [], includeDefinitions: [] },
          summary: { registryNodeCount: 0, selectedNodeCount: 0, directPathCount: 0, directDefinitionCount: 0, transitiveComponentCount: 0, omittedNodeCount: 0, sourceRefCount: 0, outputAliasCount: 0, renamedOutputAliasCount: 0, collisionReportCount: 0 },
          selected: { directPathIds: [], directDefinitionIds: [], transitiveComponentIds: [], selectedNodeIds: [] },
          output: { paths: [], components: [], aliases: [], renamedAliases: [], collisionReport: [] },
          omitted: { total: 0, byScope: {}, byDomain: {}, byKind: {} },
          sourceRefs: [],
        },
        diagnostics: [],
        builtAt: 1000,
        entryRefs: [{ relativePath: 'schemas/Item.yaml', contentHash: 'item-hash' }],
      }
    }

    it('modifying base tsconfig triggers automatic SQLite cache miss and reverting restores cache hit', async () => {
      const projDir = join(tempDir, 'my-project')
      mkdirSync(join(projDir, 'src'), { recursive: true })
      writeFileSync(join(projDir, 'src', 'index.ts'), 'export const v = 1;\n')

      const initialBaseContent = [
        '{',
        '  // Base configuration V1',
        '  "compilerOptions": {',
        '    "strict": false,',
        '    "target": "ES2022",',
        '  },',
        '}',
      ].join('\n')

      const basePath = join(projDir, 'tsconfig.base.json')
      const tsconfigPath = join(projDir, 'tsconfig.json')

      writeFileSync(basePath, initialBaseContent)
      writeFileSync(tsconfigPath, JSON.stringify({ extends: './tsconfig.base.json', include: ['src'] }))

      // 1. Initial State: Compute universe and project identity 1
      const universe1 = computeTsconfigUniverse(tsconfigPath, projDir)
      expect(universe1).toBeDefined()

      const identity1 = createSpecProjectIdentity(
        {
          kind: 'definition-builder',
          sourceRoot: 'fragments',
          targetPath: 'target.yaml',
          tsconfigPath,
        },
        'target-digest-initial',
        observation,
        universe1!.universeDigest,
      )

      const revId = 'rev-1001-commit'
      const snapshot1 = createSnapshot(identity1.projectKey, revId)

      // Store in SQLite cache
      await cache.saveSnapshot(snapshot1, [
        { relativePath: 'schemas/Item.yaml', content: 'type: object', contentHash: 'item-hash' },
      ])

      // Verify Cache HIT for projectKey 1
      const hit1 = await cache.getSnapshotByRevision(revId, identity1.projectKey)
      expect(hit1).not.toBeNull()
      expect(hit1!.projectKey).toBe(identity1.projectKey)

      // 2. Mutation: Modify tsconfig.base.json compilerOptions (strict: false -> strict: true)
      const modifiedBaseContent = [
        '{',
        '  // Base configuration V2 (strict enabled)',
        '  "compilerOptions": {',
        '    "strict": true,',
        '    "target": "ES2022",',
        '  },',
        '}',
      ].join('\n')

      writeFileSync(basePath, modifiedBaseContent)

      // Recompute universe 2
      const universe2 = computeTsconfigUniverse(tsconfigPath, projDir)
      expect(universe2).toBeDefined()
      expect(universe2!.universeDigest).not.toBe(universe1!.universeDigest)

      // Create identity 2 with universe 2
      const identity2 = createSpecProjectIdentity(
        {
          kind: 'definition-builder',
          sourceRoot: 'fragments',
          targetPath: 'target.yaml',
          tsconfigPath,
        },
        'target-digest-initial',
        observation,
        universe2!.universeDigest,
      )

      // Project key MUST be strictly different
      expect(identity2.projectKey).not.toBe(identity1.projectKey)

      // Query SQLite cache with identity 2's projectKey -> MUST BE A CACHE MISS (null)!
      const miss2 = await cache.getSnapshotByRevision(revId, identity2.projectKey)
      expect(miss2).toBeNull()

      // Querying with identity 1 still retrieves the old snapshot (isolation)
      const oldStillExists = await cache.getSnapshotByRevision(revId, identity1.projectKey)
      expect(oldStillExists).not.toBeNull()

      // 3. Reversion: Revert tsconfig.base.json back to exact initial content
      writeFileSync(basePath, initialBaseContent)

      // Recompute universe 3
      const universe3 = computeTsconfigUniverse(tsconfigPath, projDir)
      expect(universe3).toBeDefined()
      expect(universe3!.universeDigest).toBe(universe1!.universeDigest)

      const identity3 = createSpecProjectIdentity(
        {
          kind: 'definition-builder',
          sourceRoot: 'fragments',
          targetPath: 'target.yaml',
          tsconfigPath,
        },
        'target-digest-initial',
        observation,
        universe3!.universeDigest,
      )

      expect(identity3.projectKey).toBe(identity1.projectKey)

      // Query with identity 3 -> Cache HIT is restored!
      const restoredHit = await cache.getSnapshotByRevision(revId, identity3.projectKey)
      expect(restoredHit).not.toBeNull()
      expect(restoredHit!.projectKey).toBe(identity1.projectKey)
    })
  })
})
