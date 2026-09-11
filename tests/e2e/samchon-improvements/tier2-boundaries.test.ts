import { describe, it, expect } from 'vitest'
import {
  classifyTypeShape,
  extractDeclarationShape,
  auditTypeShapesInSource,
  type ContractShapeFeature,
} from './helpers/taxonomy.js'
import {
  toWireJson,
  toResolved,
  type JsonPrimitive,
  type Resolved,
} from './helpers/wire-format.js'
import {
  extractOperationsFromSource,
} from './helpers/operations.js'
import {
  createInMemoryProgram,
  detectCyclesWithChecker,
  getCanonicalSymbolId,
  resolveAlias,
} from './helpers/cycles.js'
import {
  stripJsonComments,
  removeTrailingCommas,
  parseJsonc,
  computeTsconfigUniverseFromFs,
  type VirtualFileSystem,
} from './helpers/tsconfig-universe.js'
import { runAuditShapeCli } from './helpers/cli.js'
import ts from 'typescript'

describe('Tier 2: Boundary & Corner Cases (Stress & Adversarial Verification)', () => {
  // =========================================================================
  // Area 1: Extreme Type Shapes & AST Complexity
  // =========================================================================
  describe('Area 1: Extreme Type Shapes & AST Complexity', () => {
    function parseDecl(code: string): ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
      const sf = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true)
      return sf.statements[0] as ts.InterfaceDeclaration | ts.TypeAliasDeclaration
    }

    it('T2-B1-1: empty interface declaration evaluates cleanly as direct with object feature', () => {
      const decl = parseDecl('export interface Empty {}')
      const shape = extractDeclarationShape(decl)
      expect(shape.typeSpecProjection).toBe('direct')
      expect(shape.features).toEqual(['object'])
    })

    it('T2-B1-2: deeply nested conditional type classifies as unsupported', () => {
      const decl = parseDecl('export type Nested<T, U, V> = T extends string ? (U extends number ? (V extends boolean ? 1 : 2) : 3) : 4;')
      const shape = extractDeclarationShape(decl)
      expect(shape.typeSpecProjection).toBe('unsupported')
      expect(shape.features).toContain('conditional')
    })

    it('T2-B1-3: direct self-referential property signature tags recursive-reference', () => {
      const program = createInMemoryProgram({
        'loop.ts': 'export interface Loop { self: Loop; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.size).toBe(1)
      expect(Array.from(result.cyclicSchemaIds)[0]).toContain('Loop')
    })

    it('T2-B1-4: large union of 25 distinct literal types evaluates without recursion error', () => {
      const literals = Array.from({ length: 25 }, (_, i) => `"literal_${i}"`).join(' | ')
      const decl = parseDecl(`export type BigUnion = ${literals};`)
      const shape = extractDeclarationShape(decl)
      expect(shape.typeSpecProjection).toBe('direct')
      expect(shape.features).toContain('union')
      expect(shape.features).toContain('literal')
    })

    it('T2-B1-5: indexed access type with template literal evaluates as unsupported', () => {
      const decl = parseDecl('export type PickProp<T, K extends string> = T[`key_${K}`];')
      const shape = extractDeclarationShape(decl)
      expect(shape.typeSpecProjection).toBe('unsupported')
      expect(shape.features).toContain('indexed-access')
      expect(shape.features).toContain('template-literal')
    })
  })

  // =========================================================================
  // Area 2: Wire-Format Edge Cases
  // =========================================================================
  describe('Area 2: Wire-Format Edge Cases', () => {
    it('T2-B2-1: type with custom .toJSON(): { iso: string } resolves to pure JSON wire object', () => {
      class CustomDate {
        constructor(public d: Date) {}
        toJSON() {
          return { iso: this.d.toISOString(), stamp: this.d.getTime() }
        }
      }
      type WireCustom = JsonPrimitive<CustomDate>
      const inst = new CustomDate(new Date('2026-09-11T12:00:00.000Z'))
      const wire = toWireJson(inst)
      expect(wire).toEqual({
        iso: '2026-09-11T12:00:00.000Z',
        stamp: 1789128000000,
      })
    })

    it('T2-B2-2: object containing exclusively functions/methods converts to empty object in JsonPrimitive', () => {
      class MethodOnly {
        foo() { return 1 }
        bar() { return 'a' }
      }
      type WireEmpty = JsonPrimitive<MethodOnly>
      const inst = new MethodOnly()
      const wire: WireEmpty = toWireJson(inst)
      expect(wire).toEqual({})
      expect(Object.keys(wire)).toHaveLength(0)
    })

    it('T2-B2-3: recursive tuple with rest elements preserves tuple prefix and trailing array', () => {
      type HeaderTuple = [string, number, ...boolean[]]
      type WireTuple = JsonPrimitive<HeaderTuple>
      const tupleData: WireTuple = ['header', 200, true, false, true]
      const wire = toWireJson(tupleData)
      expect(wire).toEqual(['header', 200, true, false, true])
    })

    it('T2-B2-4: class with getter and methods strips getters and methods while preserving fields', () => {
      class Account {
        constructor(public id: string, public balance: number) {}
        get isOverdrawn(): boolean {
          return this.balance < 0
        }
        deposit(n: number) {
          this.balance += n
        }
      }
      type WireAccount = JsonPrimitive<Account>
      const acc = new Account('acc-1', 500)
      const wire: WireAccount = toWireJson(acc)
      expect(wire).toEqual({ id: 'acc-1', balance: 500 })
      expect((wire as any).deposit).toBeUndefined()
    })

    it('T2-B2-5: null and undefined combined with nested complex objects preserves null values', () => {
      type ComplexOptional = {
        requiredVal: string
        nullableVal: string | null
        optionalVal?: number
      }
      type WireComp = JsonPrimitive<ComplexOptional>
      const data: WireComp = {
        requiredVal: 'yes',
        nullableVal: null,
      }
      const wire = toWireJson(data)
      expect(wire.nullableVal).toBeNull()
      expect(wire.requiredVal).toBe('yes')
    })
  })

  // =========================================================================
  // Area 3: JSDoc Annotation Syntax Boundaries
  // =========================================================================
  describe('Area 3: JSDoc Annotation Syntax Boundaries', () => {
    it('T2-B3-1: parses JSDoc tag with mixed tabs and multiple spaces between method and path', () => {
      const source = `
        /**
         * @oaOperation  \t  GET   \t   /items/batch
         */
        export function batchGet(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].method).toBe('get')
      expect(result.operations[0].path).toBe('/items/batch')
    })

    it('T2-B3-2: path containing query string parameters preserves query in path pointer', () => {
      const source = `
        /**
         * @oaOperation GET /search?filter=active
         */
        export function search(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].path).toBe('/search?filter=active')
      expect(result.operations[0].outputPointer).toBe('#/paths/~1search?filter=active/get')
    })

    it('T2-B3-3: lowercase HTTP method is strictly rejected with diagnostic message', () => {
      const source = `
        /**
         * @oaOperation delete /accounts/{id}
         */
        export function del(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics).toHaveLength(1)
      expect(result.diagnostics[0].message).toContain('HTTP method must be uppercase')
    })

    it('T2-B3-4: trailing whitespace after path is trimmed cleanly', () => {
      const source = `
        /**
         * @oaOperation POST /checkout/submit   \t
         */
        export function checkout(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(1)
      expect(result.operations[0].path).toBe('/checkout/submit')
    })

    it('T2-B3-5: multiple @oaOperation tags on a single function extracts multiple operations', () => {
      const source = `
        /**
         * @oaOperation GET /resource
         * @oaOperation POST /resource
         */
        export function handleResource(): void {}
      `
      const result = extractOperationsFromSource(source)
      expect(result.operations).toHaveLength(2)
      expect(result.operations.map(o => o.method)).toEqual(['get', 'post'])
    })
  })

  // =========================================================================
  // Area 4: Complex Multi-Hop Alias Cycles
  // =========================================================================
  describe('Area 4: Complex Multi-Hop Alias Cycles', () => {
    it('T2-B4-1: 3-file cycle across separate files (A -> B -> C -> A)', () => {
      const program = createInMemoryProgram({
        'fA.ts': 'import { B } from "./fB"; export interface A { b: B; }',
        'fB.ts': 'import { C } from "./fC"; export interface B { c: C; }',
        'fC.ts': 'import { A } from "./fA"; export interface C { a: A; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.size).toBe(3)
    })

    it('T2-B4-2: re-exported renamed alias (export { Original as Renamed }) resolves canonical symbol ID', () => {
      const program = createInMemoryProgram({
        'original.ts': 'export interface Master { id: string; }',
        'rename.ts': 'export { Master as Alias1 } from "./original";',
        'rename2.ts': 'export { Alias1 as Alias2 } from "./rename";',
        'app.ts': 'import { Alias2 } from "./rename2"; export interface App { m: Alias2; }',
      })
      const sfOrig = program.getSourceFiles().find(f => f.fileName.endsWith('original.ts'))!
      const sfApp = program.getSourceFiles().find(f => f.fileName.endsWith('app.ts'))!
      const checker = program.getTypeChecker()

      const origSym = checker.getSymbolAtLocation((sfOrig.statements[0] as ts.InterfaceDeclaration).name)!
      const appDecl = sfApp.statements[1] as ts.InterfaceDeclaration
      const ref = (appDecl.members[0] as ts.PropertySignature).type as ts.TypeReferenceNode
      const importedSym = checker.getSymbolAtLocation(ref.typeName)!
      const canonical = resolveAlias(importedSym, checker)

      expect(getCanonicalSymbolId(canonical)).toBe(getCanonicalSymbolId(origSym))
    })

    it('T2-B4-3: barrel re-export cycle through index.ts files across subfolders', () => {
      const program = createInMemoryProgram({
        'subA/index.ts': 'import { TypeB } from "../subB"; export interface TypeA { b: TypeB; }',
        'subB/index.ts': 'import { TypeA } from "../subA"; export interface TypeB { a: TypeA; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.size).toBe(2)
    })

    it('T2-B4-4: disconnected components: cyclic subgraph alongside completely acyclic subgraph', () => {
      const program = createInMemoryProgram({
        'cyclic.ts': 'export interface C1 { c2: C2; } export interface C2 { c1: C1; }',
        'acyclic.ts': 'export interface Leaf { v: string; } export interface Root { l: Leaf; }',
      })
      const result = detectCyclesWithChecker(program)
      const cyclicIds = Array.from(result.cyclicSchemaIds)
      expect(cyclicIds.some(id => id.includes('C1'))).toBe(true)
      expect(cyclicIds.some(id => id.includes('C2'))).toBe(true)
      expect(cyclicIds.some(id => id.includes('Leaf'))).toBe(false)
      expect(cyclicIds.some(id => id.includes('Root'))).toBe(false)
    })

    it('T2-B4-5: diamond dependency graph with inner cyclic sub-loop', () => {
      const program = createInMemoryProgram({
        'diamond.ts': `
          export interface Top { left: Left; right: Right; }
          export interface Left { sub: SubLoop1; }
          export interface Right { val: string; }
          export interface SubLoop1 { loop: SubLoop2; }
          export interface SubLoop2 { loop: SubLoop1; }
        `,
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.size).toBe(2)
      const ids = Array.from(result.cyclicSchemaIds)
      expect(ids.some(id => id.includes('SubLoop1'))).toBe(true)
      expect(ids.some(id => id.includes('SubLoop2'))).toBe(true)
      expect(ids.some(id => id.includes('Top'))).toBe(false)
    })
  })

  // =========================================================================
  // Area 5: tsconfig Universe Boundaries
  // =========================================================================
  describe('Area 5: tsconfig Universe Boundaries', () => {
    function createFs(files: Record<string, string>): VirtualFileSystem {
      const map = new Map<string, string>()
      for (const [k, v] of Object.entries(files)) {
        const norm = k.startsWith('/') ? k : '/' + k
        map.set(norm, v)
      }
      return {
        readFile: p => map.get(p.startsWith('/') ? p : '/' + p)!,
        fileExists: p => map.has(p.startsWith('/') ? p : '/' + p),
      }
    }

    it('T2-B5-1: JSONC string literal containing // is not stripped as a comment', () => {
      const text = '{\n  "url": "https://example.com/api/v1",\n  // real comment\n  "name": "test"\n}'
      const stripped = stripJsonComments(text)
      expect(stripped).toContain('"https://example.com/api/v1"')
      expect(stripped).not.toContain('// real comment')
    })

    it('T2-B5-2: multiple trailing commas in nested arrays and objects parse cleanly', () => {
      const text = '{\n  "arr": [1, 2, ],\n  "obj": { "nested": true, },\n}'
      const parsed = parseJsonc(text)
      expect(parsed.arr).toEqual([1, 2])
      expect(parsed.obj.nested).toBe(true)
    })

    it('T2-B5-3: circular extends termination prevents infinite recursion', () => {
      const fs = createFs({
        '/a.json': JSON.stringify({ extends: './b.json', strict: true }),
        '/b.json': JSON.stringify({ extends: './a.json', target: 'ES2022' }),
      })
      const universe = computeTsconfigUniverseFromFs('/a.json', fs)
      expect(universe.configs).toHaveLength(2)
    })

    it('T2-B5-4: transitive extends chain of depth 5 parses all intermediate configs', () => {
      const fs = createFs({
        '/c5.json': JSON.stringify({ v: 5 }),
        '/c4.json': JSON.stringify({ extends: './c5.json', v: 4 }),
        '/c3.json': JSON.stringify({ extends: './c4.json', v: 3 }),
        '/c2.json': JSON.stringify({ extends: './c3.json', v: 2 }),
        '/c1.json': JSON.stringify({ extends: './c2.json', v: 1 }),
      })
      const universe = computeTsconfigUniverseFromFs('/c1.json', fs)
      expect(universe.configs).toHaveLength(5)
    })

    it('T2-B5-5: tsconfig with empty compilerOptions and no files/include produces valid universe', () => {
      const fs = createFs({
        '/empty.json': '{\n  "compilerOptions": {}\n}',
      })
      const universe = computeTsconfigUniverseFromFs('/empty.json', fs)
      expect(universe.configs).toHaveLength(1)
      expect(universe.roots).toHaveLength(0)
      expect(universe.universeDigest).toBeDefined()
    })
  })

  // =========================================================================
  // Area 6: CLI & Governance Boundaries
  // =========================================================================
  describe('Area 6: CLI & Governance Boundaries', () => {
    it('T2-B6-1: audit:shape on non-existent file path returns exit code 1 with clean error', async () => {
      const result = await runAuditShapeCli({ bundle: 'non_existent_file.ts' }, () => {
        throw new Error('ENOENT: no such file or directory')
      })
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Cannot read target bundle')
    })

    it('T2-B6-2: audit:shape on TypeScript file with unsupported types logs errors and line pointers', async () => {
      const brokenSource = 'export type M = { [K in keyof any]: any };'
      const result = await runAuditShapeCli({ bundle: 'broken.ts' }, () => brokenSource)
      expect(result.stdout).toContain('broken.ts:1:1')
      expect(result.stdout).toContain('mapped')
    })

    it('T2-B6-3: audit:shape on empty .ts file succeeds with 0 scanned declarations', async () => {
      const emptySource = '// Only comments\n\n'
      const result = await runAuditShapeCli({ bundle: 'empty.ts' }, () => emptySource)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('0 declaration(s)')
    })

    it('T2-B6-4: missing required bundle flag exits with code 1', async () => {
      const result = await runAuditShapeCli({})
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Missing required option --bundle')
    })

    it('T2-B6-5: JSON format output emits structured ShapeAuditResult matching schema', async () => {
      const source = 'export interface Safe { id: string; }'
      const result = await runAuditShapeCli({ bundle: 'safe.ts', format: 'json' }, () => source)
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.valid).toBe(true)
      expect(parsed.scannedDeclarations).toBe(1)
      expect(Array.isArray(parsed.diagnostics)).toBe(true)
    })
  })
})
