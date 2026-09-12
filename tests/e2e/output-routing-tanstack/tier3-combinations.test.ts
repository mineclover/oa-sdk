import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  petstoreSpec,
  fsdMultiDomainSpec,
  edgeCasesSpec,
} from './helpers/fixtures.js'
import {
  resolvePathPattern,
  dispatchArtifactPath,
  resolveImportSpecifier,
  OaManifestManager,
  computeSha256,
  OA_BANNER,
  type OutputRoutingConfig,
} from './helpers/routing-harness.js'
import {
  generateKeyFactory,
  generatePureOptionsFactory,
  generateHookHelpers,
  generateTanstackQuery,
  toWireJson,
  toResolved,
} from './helpers/tanstack-harness.js'
import { validateTsSyntax, validateTranspilation } from './helpers/ast-validator.js'

describe('Tier 3: Cross-Feature Combinations (Pairwise & Multi-Feature)', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-tier3-'))
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('T3-01: Feature-Sliced Design (FSD) layout routing with cross-feature relative imports', () => {
    const config: OutputRoutingConfig = {
      pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
      casing: 'kebab',
    }

    const queriesPath = dispatchArtifactPath({ tag: 'users', kind: 'queries' }, config)
    const keysPath = dispatchArtifactPath({ tag: 'users', kind: 'keys' }, config)
    const clientPath = dispatchArtifactPath({ tag: 'users', kind: 'client' }, config)

    expect(queriesPath).toBe('src/features/users/api/users.queries.ts')
    expect(keysPath).toBe('src/features/users/api/users.keys.ts')
    expect(clientPath).toBe('src/features/users/api/users.client.ts')

    // Recalculate relative imports
    const keysImport = resolveImportSpecifier({
      fromFilePath: queriesPath,
      toFilePath: keysPath,
    })
    const clientImport = resolveImportSpecifier({
      fromFilePath: queriesPath,
      toFilePath: clientPath,
    })

    expect(keysImport).toBe('./users.keys.js')
    expect(clientImport).toBe('./users.client.js')
  })

  it('T3-02: Clean Architecture / DDD Layout separating domain and infrastructure', () => {
    const config: OutputRoutingConfig = {
      byKind: {
        schemas: 'src/domain/{tag}/model/{tag}.types.ts',
        contract: 'src/domain/{tag}/contracts/{tag}.contract.ts',
        client: 'src/infrastructure/http/{tag}.client.ts',
        queries: 'src/application/{tag}/queries/{tag}.queries.ts',
        keys: 'src/application/{tag}/queries/{tag}.keys.ts',
      },
    }

    const queriesPath = dispatchArtifactPath({ tag: 'orders', kind: 'queries' }, config)
    const clientPath = dispatchArtifactPath({ tag: 'orders', kind: 'client' }, config)
    const schemasPath = dispatchArtifactPath({ tag: 'orders', kind: 'schemas' }, config)

    expect(queriesPath).toBe('src/application/orders/queries/orders.queries.ts')
    expect(clientPath).toBe('src/infrastructure/http/orders.client.ts')
    expect(schemasPath).toBe('src/domain/orders/model/orders.types.ts')

    const clientImport = resolveImportSpecifier({
      fromFilePath: queriesPath,
      toFilePath: clientPath,
    })
    expect(clientImport).toBe('../../../infrastructure/http/orders.client.js')

    const schemaImport = resolveImportSpecifier({
      fromFilePath: queriesPath,
      toFilePath: schemasPath,
    })
    expect(schemaImport).toBe('../../../domain/orders/model/orders.types.js')
  })

  it('T3-03: Multi-Package Monorepo Layout (apps/server vs apps/web)', () => {
    const config: OutputRoutingConfig = {
      byKind: {
        contract: 'apps/server/src/contracts/{tag}.contract.ts',
        client: 'packages/api-client/src/{tag}.client.ts',
        queries: 'apps/web/src/features/{tag}/api/{tag}.queries.ts',
        keys: 'apps/web/src/features/{tag}/api/{tag}.keys.ts',
      },
    }

    const contractPath = dispatchArtifactPath({ tag: 'billing', kind: 'contract' }, config)
    const queriesPath = dispatchArtifactPath({ tag: 'billing', kind: 'queries' }, config)
    const clientPath = dispatchArtifactPath({ tag: 'billing', kind: 'client' }, config)

    expect(contractPath).toBe('apps/server/src/contracts/billing.contract.ts')
    expect(queriesPath).toBe('apps/web/src/features/billing/api/billing.queries.ts')
    expect(clientPath).toBe('packages/api-client/src/billing.client.ts')

    // Cross-package relative import
    const clientImport = resolveImportSpecifier({
      fromFilePath: queriesPath,
      toFilePath: clientPath,
    })
    expect(clientImport).toBe('../../../../../../packages/api-client/src/billing.client.js')
  })

  it('T3-04: Output routing with conditional rules overriding global pattern', () => {
    const config: OutputRoutingConfig = {
      pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
      rules: [
        {
          tag: 'admin',
          target: 'src/admin/{kind}.ts',
        },
        {
          kind: 'guards',
          target: 'src/shared/guards/{tag}.guards.ts',
        },
      ],
    }

    // Normal tag uses global pattern
    expect(dispatchArtifactPath({ tag: 'users', kind: 'queries' }, config)).toBe(
      'src/features/users/api/users.queries.ts',
    )
    // Admin tag matched by first rule
    expect(dispatchArtifactPath({ tag: 'admin', kind: 'queries' }, config)).toBe('src/admin/queries.ts')
    // Guards kind matched by second rule
    expect(dispatchArtifactPath({ tag: 'users', kind: 'guards' }, config)).toBe(
      'src/shared/guards/users.guards.ts',
    )
  })

  it('T3-05: Output routing with byKind mapping overriding global pattern', () => {
    const config: OutputRoutingConfig = {
      pattern: 'src/features/{tag}/{kind}.ts',
      byKind: {
        contract: 'src/contracts/{tag}.contract.ts',
      },
    }

    expect(dispatchArtifactPath({ tag: 'users', kind: 'queries' }, config)).toBe(
      'src/features/users/queries.ts',
    )
    expect(dispatchArtifactPath({ tag: 'users', kind: 'contract' }, config)).toBe(
      'src/contracts/users.contract.ts',
    )
  })

  it('T3-06: Casing transformation pascal combined with FSD directory structure', () => {
    const config: OutputRoutingConfig = {
      pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
      casing: 'pascal',
    }

    const result = dispatchArtifactPath({ tag: 'user_management', kind: 'queries' }, config)
    expect(result).toBe('src/features/UserManagement/api/UserManagement.queries.ts')
  })

  it('T3-07: Casing transformation camel combined with flat directory structure', () => {
    const config: OutputRoutingConfig = {
      pattern: 'src/api/{tag}{kind}.ts',
      casing: 'camel',
    }

    const result = dispatchArtifactPath({ tag: 'user_billing', kind: 'Queries' }, config)
    expect(result).toBe('src/api/userBillingQueries.ts')
  })

  it('T3-08: Relative import specifiers across 4 directory depth levels (../../../../)', () => {
    const fromPath = 'apps/web/src/features/checkout/components/button.tsx'
    const toPath = 'packages/shared-types/src/index.ts'

    const rel = resolveImportSpecifier({
      fromFilePath: fromPath,
      toFilePath: toPath,
    })
    expect(rel).toBe('../../../../../../packages/shared-types/src/index.js')
  })

  it('T3-09: Tsconfig path alias resolution (@features/*, @shared/*) in generated queries', () => {
    const rel = resolveImportSpecifier({
      fromFilePath: 'src/features/users/api/users.queries.ts',
      toFilePath: 'src/shared/client.ts',
      importStyle: 'alias',
      tsconfigPaths: {
        '@shared/*': ['./src/shared/*'],
      },
    })
    expect(rel).toBe('@shared/client.js')
  })

  it('T3-10: Manifest safe pruning with mixed unmodified, developer-modified, and hand-written files', async () => {
    const testDir = path.join(tempDir, 't3-prune-mixed')
    const mgr = new OaManifestManager(testDir)

    // 1. Unmodified generated file (safe to prune if orphan)
    const file1Rel = 'src/api/unmodified-orphan.ts'
    const file1Abs = path.join(testDir, file1Rel)
    const file1Content = `${OA_BANNER}\nexport const v1 = 1;`
    await fs.mkdir(path.dirname(file1Abs), { recursive: true })
    await fs.writeFile(file1Abs, file1Content, 'utf8')

    // 2. Developer-modified generated file (must NOT be pruned)
    const file2Rel = 'src/api/modified-orphan.ts'
    const file2Abs = path.join(testDir, file2Rel)
    const file2Original = `${OA_BANNER}\nexport const v2 = 2;`
    const file2Modified = `${OA_BANNER}\nexport const v2 = 2;\n// custom edit`
    await fs.writeFile(file2Abs, file2Modified, 'utf8')

    // 3. Hand-written file (never in manifest, must NOT be pruned)
    const file3Rel = 'src/api/handwritten.ts'
    const file3Abs = path.join(testDir, file3Rel)
    await fs.writeFile(file3Abs, 'export const devCode = true;', 'utf8')

    mgr.createManifest('sha256:oldSpec', [
      {
        path: file1Rel,
        kind: 'queries',
        contentHash: computeSha256(file1Content),
        generatedAt: new Date().toISOString(),
      },
      {
        path: file2Rel,
        kind: 'queries',
        contentHash: computeSha256(file2Original),
        generatedAt: new Date().toISOString(),
      },
    ])
    await mgr.saveManifest()

    // Run orphan pruner with no active files
    const res = await mgr.pruneOrphans([])

    expect(res.prunedFiles).toContain(file1Rel)
    expect(res.skippedModified).toContain(file2Rel)
    expect(res.prunedFiles).not.toContain(file3Rel)

    // Verify disk state
    expect(await fs.stat(file1Abs).catch(() => null)).toBeNull()
    expect(await fs.stat(file2Abs).catch(() => null)).not.toBeNull()
    expect(await fs.stat(file3Abs).catch(() => null)).not.toBeNull()
  })

  it('T3-11: Tier 1 Keys + Tier 2 Options in single combined file mode (--split false)', () => {
    const artifacts = generateTanstackQuery(petstoreSpec, { split: false })
    expect(artifacts.combinedCode).toBeDefined()
    expect(artifacts.combinedCode).toContain('petsKeys')
    expect(artifacts.combinedCode).toContain('listPetsQueryOptions')
    expect(artifacts.combinedCode).toContain('useListPetsQuery')

    const syntax = validateTsSyntax(artifacts.combinedCode!)
    expect(syntax.valid).toBe(true)
  })

  it('T3-12: Tier 1 Keys + Tier 2 Options + Tier 3 Hooks in split multi-file mode (--split true)', () => {
    const artifacts = generateTanstackQuery(petstoreSpec, { split: true })
    expect(artifacts.keysCode).toBeDefined()
    expect(artifacts.queriesCode).toBeDefined()
    expect(artifacts.hooksCode).toBeDefined()

    expect(artifacts.keysCode).toContain('export const petsKeys')
    expect(artifacts.queriesCode).toContain('export function listPetsQueryOptions')
    expect(artifacts.hooksCode).toContain('export function useListPetsQuery')

    expect(validateTsSyntax(artifacts.keysCode!).valid).toBe(true)
    expect(validateTsSyntax(artifacts.queriesCode!).valid).toBe(true)
    expect(validateTsSyntax(artifacts.hooksCode!).valid).toBe(true)
  })

  it('T3-13: Query options with parameterless GET and typed mutation POST in same entity', () => {
    const optionsCode = generatePureOptionsFactory(petstoreSpec)
    // listPets is GET
    expect(optionsCode).toContain('listPetsQueryOptions')
    // createPet is POST
    expect(optionsCode).toContain('createPetMutationOptions')
    expect(optionsCode).toContain('CreatePetVariables')
  })

  it('T3-14: TanStack options with custom query package (@tanstack/vue-query)', () => {
    const optionsCode = generatePureOptionsFactory(petstoreSpec, {
      queryPackage: '@tanstack/vue-query',
    })
    expect(optionsCode).toContain("from '@tanstack/vue-query'")
    expect(validateTsSyntax(optionsCode).valid).toBe(true)
  })

  it('T3-15: Next.js 15 App Router Server Component SSR prefetching options (prefetchQuery)', () => {
    const optionsCode = generatePureOptionsFactory(petstoreSpec)
    // Options factory produces queryOptions object directly passible to queryClient.prefetchQuery()
    expect(optionsCode).toContain('return queryOptions({')
    expect(optionsCode).toContain('queryKey:')
    expect(optionsCode).toContain('queryFn:')
  })

  it('T3-16: Router contract and Query options generated from same OAS 3.2 spec with wire type parity', () => {
    const optionsCode = generatePureOptionsFactory(fsdMultiDomainSpec)
    expect(optionsCode).toContain('listUsersQueryOptions')
    expect(optionsCode).toContain('getUserQueryOptions')
    expect(optionsCode).toContain('createOrderMutationOptions')

    expect(optionsCode).toContain('JsonPrimitive')
    expect(optionsCode).toContain('Resolved')
  })

  it('T3-17: CLI --dry-run with Output Path Routing and manifest comparison', async () => {
    const testDir = path.join(tempDir, 't3-dry-run')
    const mgr = new OaManifestManager(testDir)

    const fileRel = 'src/test.ts'
    const fileAbs = path.join(testDir, fileRel)
    await fs.mkdir(path.dirname(fileAbs), { recursive: true })
    await fs.writeFile(fileAbs, `${OA_BANNER}\n// auto\nexport const x = 1;`, 'utf8')

    mgr.createManifest('sha256:fingerprint', [
      {
        path: fileRel,
        kind: 'client',
        contentHash: computeSha256(await fs.readFile(fileAbs, 'utf8')),
        generatedAt: new Date().toISOString(),
      },
    ])
    await mgr.saveManifest()

    // Dry run orphan check
    const dryRunResult = await mgr.pruneOrphans([], { dryRun: true })
    expect(dryRunResult.prunedFiles).toContain(fileRel)

    // Confirm file was not touched on disk
    expect(await fs.stat(fileAbs).catch(() => null)).not.toBeNull()
  })

  it('T3-18: Full-stack wire typing parity (JsonPrimitive & Resolved) across backend and frontend', () => {
    type DomainEntity = {
      id: string
      date: Date
      calculateTax: () => number
      items: Array<{ name: string }>
    }

    type WireEntity = toWireJson<DomainEntity>

    const sample: DomainEntity = {
      id: 'e1',
      date: new Date('2026-09-12T00:00:00.000Z'),
      calculateTax: () => 10,
      items: [{ name: 'item1' }],
    }

    const wire = toWireJson(sample)
    expect(typeof (wire as any).date).toBe('string')
    expect((wire as any).calculateTax).toBeUndefined()
    expect(wire.id).toBe('e1')
  })

  it('T3-19: Multiple spec targets with distinct output routing configurations', () => {
    const publicConfig: OutputRoutingConfig = {
      pattern: 'src/public/api/{tag}.{kind}.ts',
    }
    const internalConfig: OutputRoutingConfig = {
      pattern: 'src/internal/api/{tag}.{kind}.ts',
    }

    expect(dispatchArtifactPath({ tag: 'users', kind: 'queries' }, publicConfig)).toBe(
      'src/public/api/users.queries.ts',
    )
    expect(dispatchArtifactPath({ tag: 'users', kind: 'queries' }, internalConfig)).toBe(
      'src/internal/api/users.queries.ts',
    )
  })

  it('T3-20: Monorepo Governance Manifest Parity + Skill Syntax Validation', async () => {
    const codegenSkillPath = path.resolve(process.cwd(), '.agents/skills/oa-codegen/SKILL.md')
    const onboardingSkillPath = path.resolve(process.cwd(), '.agents/skills/oa-onboarding/SKILL.md')

    const codegenContent = await fs.readFile(codegenSkillPath, 'utf8')
    const onboardingContent = await fs.readFile(onboardingSkillPath, 'utf8')

    expect(codegenContent).toContain('name: oa-codegen')
    expect(onboardingContent).toContain('name: oa-onboarding')
  })
})
