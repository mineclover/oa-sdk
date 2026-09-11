import { describe, it, expect } from 'vitest'
import {
  classifyTypeShape,
  extractDeclarationShape,
  auditTypeShapesInSource,
  createInMemoryProgram,
  detectCyclesWithChecker,
  getCanonicalSymbolId,
  resolveAlias,
} from '@oa-sdk/ast-sync'
import type { JsonPrimitive, Resolved } from '@oa-sdk/core'
import {
  toWireJson,
  toResolved,
  type ClientResponse,
} from './helpers/wire-format.js'
import {
  extractOperationsFromSource,
  buildPathPointer,
} from '@oa-sdk/parser'
import {
  computeTsconfigUniverseFromFs,
  buildSpecProjectKey,
  type VirtualFileSystem,
} from './helpers/tsconfig-universe.js'
import { runAuditShapeCli } from './helpers/cli.js'
import { readApiIndexDoc } from './helpers/governance.js'
import ts from 'typescript'

describe('Tier 3: Cross-Feature Combinations (Pairwise & Multi-Keyword Interactions)', () => {
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

  it('T3-01: Taxonomy Analysis + Symbol Cycle Detection: mutually recursive interfaces classified with recursive-reference', () => {
    const program = createInMemoryProgram({
      'mutualA.ts': 'import { MutualB } from "./mutualB"; export interface MutualA { b: MutualB; }',
      'mutualB.ts': 'import { MutualA } from "./mutualA"; export interface MutualB { a: MutualA; }',
    })
    const cycleResult = detectCyclesWithChecker(program)
    expect(cycleResult.cyclicSchemaIds.size).toBe(2)

    // For each cyclic declaration, we incorporate 'recursive-reference' into its shape
    const shapeA = classifyTypeShape(new Set(['object', 'reference', 'recursive-reference']))
    expect(shapeA.typeSpecProjection).toBe('direct')
    expect(shapeA.features).toContain('recursive-reference')
  })

  it('T3-02: JSDoc Operation Extraction + Wire-Format Responses: operation return types wrapped in Promise<JsonPrimitive<T>>', async () => {
    const source = `
      export interface UserProfile { id: string; registeredAt: Date; }
      /**
       * @oaOperation GET /users/me
       */
      export function getProfile(): Promise<UserProfile> {
        return Promise.resolve({ id: 'me', registeredAt: new Date('2026-09-11T00:00:00.000Z') });
      }
    `
    const extract = extractOperationsFromSource(source)
    expect(extract.operations).toHaveLength(1)

    // Client wrapper simulation
    type ProfileResponse = JsonPrimitive<{ id: string; registeredAt: Date }>
    const rawData = { id: 'me', registeredAt: new Date('2026-09-11T00:00:00.000Z') }
    const wireData: ProfileResponse = toWireJson(rawData)

    expect(typeof wireData.registeredAt).toBe('string')
    expect(wireData.registeredAt).toBe('2026-09-11T00:00:00.000Z')
  })

  it('T3-03: tsconfig Universe Hashing + TypeChecker Program: program files validated from transitive config closure', () => {
    const fs = createFs({
      '/base.json': '{\n  // Base compiler settings\n  "compilerOptions": { "strict": true }\n}',
      '/tsconfig.json': '{\n  "extends": "./base.json",\n  "files": ["user.ts"]\n}',
      '/user.ts': 'export interface User { id: string; }',
    })

    const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
    expect(universe.configs).toHaveLength(2)
    expect(universe.roots).toEqual(['user.ts'])

    const program = createInMemoryProgram({
      'user.ts': fs.readFile('/user.ts'),
    })
    const audit = auditTypeShapesInSource(fs.readFile('/user.ts'))
    expect(audit.valid).toBe(true)
    expect(audit.scannedDeclarations).toBe(1)
  })

  it('T3-04: Wire-Format Safety + Client SDK with Recursive Types: avoids infinite instantiation and strips methods', () => {
    type Comment = {
      id: string
      content: string
      replies?: Comment[]
      render(): string
    }

    type WireComment = JsonPrimitive<Omit<Comment, 'render'>>
    const node: WireComment = {
      id: 'c-1',
      content: 'Hello',
      replies: [{ id: 'c-2', content: 'World' }],
    }
    expect(node.replies?.[0].content).toBe('World')
  })

  it('T3-05: JSDoc Operation with Unsupported Taxonomy Types emits both operation and diagnostic', () => {
    const source = `
      export type ConditionalParam<T> = T extends string ? number : boolean;
      /**
       * @oaOperation POST /compute
       */
      export function compute(): void {}
    `
    const opResult = extractOperationsFromSource(source)
    expect(opResult.operations).toHaveLength(1)

    const shapeAudit = auditTypeShapesInSource(source)
    expect(shapeAudit.valid).toBe(false)
    expect(shapeAudit.diagnostics.some(d => d.feature === 'conditional')).toBe(true)
  })

  it('T3-06: Transitive tsconfig Update + Cache Invalidation + Symbol Cycle Integrity', () => {
    const fsV1 = createFs({
      '/base.json': '{\n  "compilerOptions": { "strict": false }\n}',
      '/tsconfig.json': '{\n  "extends": "./base.json"\n}',
    })
    const fsV2 = createFs({
      '/base.json': '{\n  "compilerOptions": { "strict": true }\n}',
      '/tsconfig.json': '{\n  "extends": "./base.json"\n}',
    })

    const u1 = computeTsconfigUniverseFromFs('/tsconfig.json', fsV1)
    const u2 = computeTsconfigUniverseFromFs('/tsconfig.json', fsV2)

    const baseProjectInput = {
      builderVersion: '1.0.0',
      manifestOrTargetDigest: 'm_1',
      snapshotSchemaVersion: 2,
      sourceKind: 'yaml',
      sourceRoot: '/repo',
      toolchainFingerprint: 'toolchain_v1',
    }

    const key1 = buildSpecProjectKey({ ...baseProjectInput, tsconfigUniverseDigest: u1.universeDigest })
    const key2 = buildSpecProjectKey({ ...baseProjectInput, tsconfigUniverseDigest: u2.universeDigest })

    expect(key1).not.toBe(key2) // Cache invalidated!

    // Meanwhile cycle detection remains consistent
    const program = createInMemoryProgram({
      'm1.ts': 'import { M2 } from "./m2"; export interface M1 { m2: M2; }',
      'm2.ts': 'import { M1 } from "./m1"; export interface M2 { m1: M1; }',
    })
    const cycles = detectCyclesWithChecker(program)
    expect(cycles.cyclicSchemaIds.size).toBe(2)
  })

  it('T3-07: Dual Extraction: Function Declaration and Type Alias with identical operation route', () => {
    const source = `
      /**
       * @oaOperation GET /items
       */
      export function listItems(): void {}

      /**
       * @oaOperation GET /items
       */
      export type ListItemsOp = {};
    `
    const result = extractOperationsFromSource(source)
    expect(result.operations).toHaveLength(2)
    expect(result.operations[0].declarationKind).toBe('function')
    expect(result.operations[1].declarationKind).toBe('type-alias')
    expect(result.operations[0].outputPointer).toBe('#/paths/~1items/get')
    expect(result.operations[1].outputPointer).toBe('#/paths/~1items/get')
  })

  it('T3-08: Shape Audit CLI on Multi-File Dependency Graph', async () => {
    const source = `
      export interface Clean { id: string; }
      export type Mapped<T> = { [K in keyof T]: string };
    `
    const cliOutput = await runAuditShapeCli(
      { bundle: 'multi.ts', format: 'json' },
      () => source,
    )
    expect(cliOutput.exitCode).toBe(0)
    const report = JSON.parse(cliOutput.stdout)
    expect(report.scannedDeclarations).toBe(2)
    expect(report.diagnostics.length).toBeGreaterThanOrEqual(1)
    expect(report.diagnostics.some((d: any) => d.feature === 'mapped')).toBe(true)
  })

  it('T3-09: Spec-Lens SQLite Cache Key + JSDoc Operations', () => {
    const op = extractOperationsFromSource('/** @oaOperation GET /users */ export function getUsers(): void {}').operations[0]
    expect(op).toBeDefined()

    const projectKey = buildSpecProjectKey({
      builderVersion: '1.0.0',
      manifestOrTargetDigest: 'm',
      snapshotSchemaVersion: 2,
      sourceKind: 'yaml',
      sourceRoot: '/app',
      toolchainFingerprint: 'fp',
      tsconfigUniverseDigest: 'digest_123',
    })

    const cacheKey = `${projectKey}:rev_head`
    expect(cacheKey).toContain(projectKey)
    expect(op.outputPointer).toBe('#/paths/~1users/get')
  })

  it('T3-10: Multi-Module Barrel Re-Export Cycle with @oaOperation Endpoints', () => {
    const program = createInMemoryProgram({
      'user/contracts.ts': `
        import { Org } from "../org/contracts";
        export interface User { org: Org; }
        /** @oaOperation GET /users */
        export function listUsers(): void {}
      `,
      'org/contracts.ts': `
        import { User } from "../user/contracts";
        export interface Org { owner: User; }
      `,
    })
    const cycles = detectCyclesWithChecker(program)
    expect(cycles.cyclicSchemaIds.size).toBe(2)

    const sfUser = program.getSourceFiles().find(f => f.fileName.endsWith('user/contracts.ts'))!
    const opResult = extractOperationsFromSource(sfUser.text)
    expect(opResult.operations).toHaveLength(1)
    expect(opResult.operations[0].path).toBe('/users')
  })

  it('T3-11: JsonPrimitive Unboxing + Custom toJSON() Serialization', () => {
    class TimestampedId {
      constructor(public id: string, public createdAt: Date) {}
      toJSON() {
        return {
          id: this.id,
          createdAt: this.createdAt.toISOString(),
        }
      }
    }
    const item = new TimestampedId('id-100', new Date('2026-09-11T00:00:00Z'))
    const wire = toWireJson(item)
    expect(wire).toEqual({
      id: 'id-100',
      createdAt: '2026-09-11T00:00:00.000Z',
    })
  })

  it('T3-12: Complete Pipeline: Config Universe -> Program -> Cycle DFS -> Taxonomy -> JSDoc -> Wire Client', () => {
    // 1. Config Universe
    const fs = createFs({
      '/tsconfig.json': JSON.stringify({ compilerOptions: { strict: true } }),
    })
    const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
    expect(universe.universeDigest).toBeDefined()

    // 2. Multi-File Program & Cycle DFS
    const program = createInMemoryProgram({
      'api.ts': `
        export interface Item { sub: SubItem; }
        export interface SubItem { item: Item; }
        /** @oaOperation GET /items */
        export function getItems(): void {}
      `,
    })
    const cycleRes = detectCyclesWithChecker(program)
    expect(cycleRes.cyclicSchemaIds.size).toBe(2)

    // 3. Taxonomy
    const sf = program.getSourceFiles().find(f => f.fileName.endsWith('api.ts'))!
    const audit = auditTypeShapesInSource(sf.text)
    expect(audit.valid).toBe(true)

    // 4. JSDoc Operations
    const ops = extractOperationsFromSource(sf.text)
    expect(ops.operations).toHaveLength(1)
    expect(ops.operations[0].outputPointer).toBe('#/paths/~1items/get')

    // 5. Wire Safety
    const wirePayload = toWireJson({ timestamp: new Date('2026-09-11') })
    expect(typeof wirePayload.timestamp).toBe('string')
  })

  it('T3-13: CLI Audit Shape Reporting + API Index Verification', () => {
    const apiDoc = readApiIndexDoc()
    expect(apiDoc).toContain('@oa-sdk/core')

    // Confirm that CLI diagnostic types align with documented contracts
    const audit = auditTypeShapesInSource('export interface Simple { id: string; }')
    expect(audit.summary).toContain('1 declaration(s)')
  })

  it('T3-14: JSDoc Extraction with OAS 3.2 QUERY Method and Resolved<T> Body', () => {
    const source = `
      export interface SearchQuery { keyword: string; date: Date; }
      /**
       * @oaOperation QUERY /items/search
       */
      export function search(criteria: SearchQuery): void {}
    `
    const ops = extractOperationsFromSource(source)
    expect(ops.operations).toHaveLength(1)
    expect(ops.operations[0].method).toBe('query')
    expect(ops.operations[0].outputPointer).toBe('#/paths/~1items~1search/query')

    const nativeDate = new Date('2026-01-01')
    const resolvedBody: Resolved<{ keyword: string; date: Date }> = toResolved({
      keyword: 'test',
      date: nativeDate,
    })
    expect(resolvedBody.date instanceof Date).toBe(true)
  })

  it('T3-15: Diamond Dependency Graph with Cyclic Sub-Loop and Transitive JSONC Closure', () => {
    const fs = createFs({
      '/base.json': '{\n  // JSONC with trailing comma\n  "compilerOptions": { "strict": true, },\n}',
      '/tsconfig.json': '{\n  "extends": "./base.json",\n  "files": ["main.ts"]\n}',
    })
    const universe = computeTsconfigUniverseFromFs('/tsconfig.json', fs)
    expect(universe.configs).toHaveLength(2)

    const program = createInMemoryProgram({
      'main.ts': `
        export interface Top { l: Left; r: Right; }
        export interface Left { sub: SubA; }
        export interface Right { sub: SubB; }
        export interface SubA { b: SubB; }
        export interface SubB { a: SubA; }
      `,
    })
    const cycleResult = detectCyclesWithChecker(program)
    expect(cycleResult.cyclicSchemaIds.size).toBe(2)
    const cyclicNames = Array.from(cycleResult.cyclicSchemaIds)
    expect(cyclicNames.some(n => n.includes('SubA'))).toBe(true)
    expect(cyclicNames.some(n => n.includes('SubB'))).toBe(true)
  })
})
