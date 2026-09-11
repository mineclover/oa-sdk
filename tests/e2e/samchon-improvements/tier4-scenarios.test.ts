import { describe, it, expect } from 'vitest'
import {
  classifyTypeShape,
  auditTypeShapesInSource,
} from './helpers/taxonomy.js'
import {
  toWireJson,
  toResolved,
  type JsonPrimitive,
  type Resolved,
  type ClientResponse,
} from './helpers/wire-format.js'
import {
  extractOperationsFromSource,
  buildPathPointer,
} from './helpers/operations.js'
import {
  createInMemoryProgram,
  detectCyclesWithChecker,
} from './helpers/cycles.js'
import {
  computeTsconfigUniverseFromFs,
  buildSpecProjectKey,
  type VirtualFileSystem,
} from './helpers/tsconfig-universe.js'
import { runAuditShapeCli } from './helpers/cli.js'
import {
  readApiIndexDoc,
  readCliReferenceDoc,
  readCliSpecManifest,
} from './helpers/governance.js'

describe('Tier 4: Real-World Application Scenarios (Comprehensive Workflows)', () => {
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

  // =========================================================================
  // Scenario 1: Enterprise Microservice Contract Provenance
  // =========================================================================
  it('T4-S1: Enterprise Microservice Contract Extraction & Provenance', async () => {
    // 1. Multi-file enterprise domain model with cross-file mutual recursion
    const program = createInMemoryProgram({
      'models/user.ts': `
        import { Department } from "./department";
        export interface User {
          id: string;
          email: string;
          department: Department;
          createdAt: Date;
        }
        /**
         * @oaOperation GET /users
         */
        export function listUsers(): Promise<User[]> { return Promise.resolve([]); }

        /**
         * @oaOperation POST /users
         */
        export function createUser(body: User): Promise<User> { return Promise.resolve(body); }

        /**
         * @oaOperation QUERY /users/search
         */
        export function searchUsers(filter: { keyword: string }): Promise<User[]> { return Promise.resolve([]); }
      `,
      'models/department.ts': `
        import { User } from "./user";
        export interface Department {
          id: string;
          name: string;
          lead: User;
        }
      `,
    })

    // 2. Run TypeChecker cycle detection
    const cycles = detectCyclesWithChecker(program)
    expect(cycles.cyclicSchemaIds.size).toBe(2)
    const cyclicNames = Array.from(cycles.cyclicSchemaIds)
    expect(cyclicNames.some(n => n.includes('User'))).toBe(true)
    expect(cyclicNames.some(n => n.includes('Department'))).toBe(true)

    // 3. Extract JSDoc operations
    const userSf = program.getSourceFiles().find(f => f.fileName.endsWith('models/user.ts'))!
    const opResult = extractOperationsFromSource(userSf.text, 'models/user.ts')
    expect(opResult.diagnostics).toHaveLength(0)
    expect(opResult.operations).toHaveLength(3)
    expect(opResult.operations.map(o => o.method)).toEqual(['get', 'post', 'query'])
    expect(opResult.operations.map(o => o.path)).toEqual(['/users', '/users', '/users/search'])

    // 4. Verify wire-safety of returned response payload
    const mockUser = {
      id: 'usr-1',
      email: 'alex@example.com',
      createdAt: new Date('2026-09-11T09:00:00.000Z'),
      department: {
        id: 'dept-eng',
        name: 'Engineering',
        lead: null as any,
      },
    }
    const wireUser = toWireJson(mockUser)
    expect(typeof wireUser.createdAt).toBe('string')
    expect(wireUser.createdAt).toBe('2026-09-11T09:00:00.000Z')
  })

  // =========================================================================
  // Scenario 2: Incremental Build & Cache Invalidation Lifecycle in Spec-Lens
  // =========================================================================
  it('T4-S2: Incremental Build & Cache Invalidation Lifecycle in Spec-Lens', () => {
    // Simulated SQLite WAL store for Spec-Lens snapshot cache
    const sqliteSnapshotCache = new Map<string, { snapshotId: string; timestamp: number }>()

    // Day 1: Project with base config
    const vfs = createFs({
      '/configs/tsconfig.base.json': '{\n  // Base tsconfig\n  "compilerOptions": { "strict": false, "target": "ES2022" }\n}',
      '/app/tsconfig.json': '{\n  "extends": "../configs/tsconfig.base.json",\n  "files": ["src/api.ts"]\n}',
    })

    const initialUniverse = computeTsconfigUniverseFromFs('/app/tsconfig.json', vfs, '/')
    const revision = 'rev_commit_001'

    const initialProjectKey = buildSpecProjectKey({
      builderVersion: '2.0.0',
      manifestOrTargetDigest: 'target_digest_main',
      snapshotSchemaVersion: 2,
      sourceKind: 'typespec-bundle',
      sourceRoot: '/app',
      toolchainFingerprint: 'toolchain_v2',
      tsconfigUniverseDigest: initialUniverse.universeDigest,
    })

    const initialCacheKey = `${initialProjectKey}:${revision}`
    sqliteSnapshotCache.set(initialCacheKey, { snapshotId: 'snap_v1', timestamp: 1000 })

    // Verify cache hit on unchanged build
    expect(sqliteSnapshotCache.has(initialCacheKey)).toBe(true)

    // Day 2: Architect enables strict mode in base tsconfig
    const updatedVfs = createFs({
      '/configs/tsconfig.base.json': '{\n  // Base tsconfig - STRICT ENABLED\n  "compilerOptions": { "strict": true, "target": "ES2022" }\n}',
      '/app/tsconfig.json': '{\n  "extends": "../configs/tsconfig.base.json",\n  "files": ["src/api.ts"]\n}',
    })

    const updatedUniverse = computeTsconfigUniverseFromFs('/app/tsconfig.json', updatedVfs, '/')
    expect(updatedUniverse.universeDigest).not.toBe(initialUniverse.universeDigest)

    const updatedProjectKey = buildSpecProjectKey({
      builderVersion: '2.0.0',
      manifestOrTargetDigest: 'target_digest_main',
      snapshotSchemaVersion: 2,
      sourceKind: 'typespec-bundle',
      sourceRoot: '/app',
      toolchainFingerprint: 'toolchain_v2',
      tsconfigUniverseDigest: updatedUniverse.universeDigest,
    })

    const updatedCacheKey = `${updatedProjectKey}:${revision}`

    // SQLite cache MISS! Prevents serving stale compilation cache!
    expect(sqliteSnapshotCache.has(updatedCacheKey)).toBe(false)

    // Store new snapshot
    sqliteSnapshotCache.set(updatedCacheKey, { snapshotId: 'snap_v2', timestamp: 2000 })
    expect(sqliteSnapshotCache.get(updatedCacheKey)?.snapshotId).toBe('snap_v2')
  })

  // =========================================================================
  // Scenario 3: Monorepo Contract Governance CI Pipeline
  // =========================================================================
  it('T4-S3: Monorepo Contract Governance CI Pipeline Gate Verification', async () => {
    // 1. Audit clean contracts pass CI gate
    const cleanSource = `
      export interface AuthToken { token: string; expiresAt: string; }
      export interface ApiResponse<T> { data: T; }
    `
    const cleanAudit = await runAuditShapeCli(
      { bundle: 'auth.ts', failOnUnsupported: true },
      () => cleanSource,
    )
    expect(cleanAudit.exitCode).toBe(0)

    // 2. Audit broken contracts with conditional types blocked by CI gate
    const brokenSource = `
      export type DynamicPayload<T> = T extends string ? { text: T } : { binary: number };
    `
    const brokenAudit = await runAuditShapeCli(
      { bundle: 'broken.ts', failOnUnsupported: true },
      () => brokenSource,
    )
    expect(brokenAudit.exitCode).toBe(1)
    expect(brokenAudit.stderr).toContain('Audit failed with unsupported type shapes')

    // 3. Verify monorepo documentation gates
    const apiIndex = readApiIndexDoc()
    expect(apiIndex).toContain('@oa-sdk/core')
    expect(apiIndex).toContain('@oa-sdk/parser')

    const cliSpec = readCliSpecManifest()
    expect(cliSpec.commands.length).toBeGreaterThan(5)
  })

  // =========================================================================
  // Scenario 4: High-Fidelity Client SDK Generation with Zero-Runtime-Dependency Wire Safety
  // =========================================================================
  it('T4-S4: High-Fidelity Standalone Client SDK Emission & Wire Serialization', async () => {
    // Simulated generated client with inline wire-format utility types
    class DomainOrder {
      constructor(public id: string, public total: number, public createdAt: Date) {}
      calculateTax(): number { return this.total * 0.1 }
    }

    interface GeneratedOrderClient {
      createOrder(body: Resolved<{ customerId: string; targetDate: Date }>): Promise<JsonPrimitive<DomainOrder>>
      getOrder(params: { id: string }): Promise<ClientResponse<JsonPrimitive<DomainOrder>>>
    }

    const clientInstance: GeneratedOrderClient = {
      async createOrder(body) {
        return toWireJson(new DomainOrder('ord-1', 150, body.targetDate))
      },
      async getOrder(params) {
        return {
          status: 200,
          ok: true,
          body: toWireJson(new DomainOrder(params.id, 200, new Date('2026-09-11T12:00:00Z'))),
          headers: { 'content-type': 'application/json' },
        }
      },
    }

    // Call createOrder passing native Date object (allowed by Resolved<T>)
    const order = await clientInstance.createOrder({
      customerId: 'cust-99',
      targetDate: new Date('2026-10-01T00:00:00Z'),
    })

    // Received return payload has method stripped and Date converted to ISO string!
    expect(typeof order.createdAt).toBe('string')
    expect(order.createdAt).toBe('2026-10-01T00:00:00.000Z')
    expect((order as any).calculateTax).toBeUndefined()

    // Call getOrder
    const resp = await clientInstance.getOrder({ id: 'ord-100' })
    expect(resp.status).toBe(200)
    expect(typeof resp.body.createdAt).toBe('string')
  })

  // =========================================================================
  // Scenario 5: Full Spec-Lens & Codegen Pipeline Roundtrip
  // =========================================================================
  it('T4-S5: Full Spec-Lens & Codegen Pipeline Roundtrip with 100% Contract Integrity', () => {
    // 1. Ingest JSONC tsconfig closure
    const vfs = createFs({
      '/base.json': '{\n  // Root tsconfig\n  "compilerOptions": { "strict": true, "composite": true, },\n}',
      '/tsconfig.json': '{\n  "extends": "./base.json",\n  "files": ["contracts.ts"]\n}',
    })
    const universe = computeTsconfigUniverseFromFs('/tsconfig.json', vfs)
    expect(universe.configs).toHaveLength(2)

    // 2. Load program and extract cycles
    const program = createInMemoryProgram({
      'contracts.ts': `
        export interface Category { id: string; parent?: Category; }
        /**
         * @oaOperation GET /categories
         */
        export function listCategories(): void {}
      `,
    })

    const cycles = detectCyclesWithChecker(program)
    expect(cycles.cyclicSchemaIds.size).toBe(1)
    expect(Array.from(cycles.cyclicSchemaIds)[0]).toContain('Category')

    // 3. Shape taxonomy classification incorporating recursive-reference
    const shape = classifyTypeShape(new Set(['object', 'optional', 'reference', 'recursive-reference']))
    expect(shape.typeSpecProjection).toBe('direct')

    // 4. JSDoc operation extraction
    const sf = program.getSourceFiles().find(f => f.fileName.endsWith('contracts.ts'))!
    const ops = extractOperationsFromSource(sf.text)
    expect(ops.operations).toHaveLength(1)
    expect(ops.operations[0].outputPointer).toBe('#/paths/~1categories/get')

    // 5. Spec-Lens project key derivation
    const projectKey = buildSpecProjectKey({
      builderVersion: '1.0.0',
      manifestOrTargetDigest: 'manifest_hash',
      snapshotSchemaVersion: 2,
      sourceKind: 'openapi-yaml',
      sourceRoot: '/repo',
      toolchainFingerprint: 'toolchain_sha',
      tsconfigUniverseDigest: universe.universeDigest,
    })
    expect(projectKey).toBeDefined()
    expect(projectKey).toHaveLength(64)
  })
})
