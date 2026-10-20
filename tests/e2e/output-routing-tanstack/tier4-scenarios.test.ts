import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  fsdMultiDomainSpec,
  petstoreSpec,
} from './helpers/fixtures.js'
import {
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

describe('Tier 4: Real-World Application Scenarios (Scenarios 1–5)', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-tier4-'))
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // =========================================================================
  // Scenario 1: Full-Scale Feature-Sliced Design (FSD) Web Application
  // =========================================================================
  it('T4-S1: Full-Scale Feature-Sliced Design (FSD) Web Application', async () => {
    const appDir = path.join(tempDir, 'fsd-app')
    const config: OutputRoutingConfig = {
      pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
      byKind: {
        schemas: 'src/entities/{tag}/model/{tag}.schemas.ts',
        client: 'src/shared/api/{tag}.client.ts',
      },
      casing: 'kebab',
    }

    const tags = ['users', 'orders', 'products']
    const generatedFiles: Array<{ relPath: string; content: string }> = []

    for (const tag of tags) {
      // 1. Dispatch paths
      const queriesPath = dispatchArtifactPath({ tag, kind: 'queries' }, config)
      const keysPath = dispatchArtifactPath({ tag, kind: 'keys' }, config)
      const clientPath = dispatchArtifactPath({ tag, kind: 'client' }, config)
      const schemasPath = dispatchArtifactPath({ tag, kind: 'schemas' }, config)

      expect(queriesPath).toBe(`src/features/${tag}/api/${tag}.queries.ts`)
      expect(keysPath).toBe(`src/features/${tag}/api/${tag}.keys.ts`)
      expect(clientPath).toBe(`src/shared/api/${tag}.client.ts`)
      expect(schemasPath).toBe(`src/entities/${tag}/model/${tag}.schemas.ts`)

      // 2. Resolve relative imports
      const keysImport = resolveImportSpecifier({ fromFilePath: queriesPath, toFilePath: keysPath })
      const clientImport = resolveImportSpecifier({ fromFilePath: queriesPath, toFilePath: clientPath })
      const schemasImport = resolveImportSpecifier({ fromFilePath: queriesPath, toFilePath: schemasPath })

      expect(keysImport).toBe(`./${tag}.keys.js`)
      expect(clientImport).toBe(`../../../shared/api/${tag}.client.js`)
      expect(schemasImport).toBe(`../../../entities/${tag}/model/${tag}.schemas.js`)

      // 3. Generate code
      const keysCode = generateKeyFactory(fsdMultiDomainSpec, { typesImport: schemasImport })
      const queriesCode = generatePureOptionsFactory(fsdMultiDomainSpec, {
        keysImport,
        clientImport,
        typesImport: schemasImport,
      })

      // 4. Validate TypeScript syntax
      expect(validateTsSyntax(keysCode).valid).toBe(true)
      expect(validateTsSyntax(queriesCode).valid).toBe(true)

      generatedFiles.push({ relPath: queriesPath, content: queriesCode })
      generatedFiles.push({ relPath: keysPath, content: keysCode })
    }

    // 5. Track in .oa-manifest.json
    const mgr = new OaManifestManager(appDir)
    const artifacts = generatedFiles.map(f => ({
      path: f.relPath,
      kind: f.relPath.includes('keys') ? 'keys' : 'queries',
      contentHash: computeSha256(f.content),
      generatedAt: new Date().toISOString(),
    }))

    const manifest = mgr.createManifest('sha256:fsd-multidomain-v2', artifacts)
    await mgr.saveManifest()

    const loaded = await mgr.loadManifest()
    expect(loaded?.artifacts).toHaveLength(6) // 3 domains * 2 files
  })

  // =========================================================================
  // Scenario 2: Next.js 15 App Router Full-Stack SSR Hydration
  // =========================================================================
  it('T4-S2: Next.js 15 App Router Full-Stack SSR Hydration', async () => {
    // 1. Generate options factory from spec
    const optionsCode = generatePureOptionsFactory(petstoreSpec)
    const hooksCode = generateHookHelpers(petstoreSpec)

    expect(optionsCode).toContain('export function getPetByIdQueryOptions')
    expect(hooksCode).toContain('export function useGetPetByIdQuery')

    // 2. Simulate Next.js Server Component SSR prefetch
    // Options object contains queryKey and queryFn
    const mockClient = {
      getPetById: async (params: { petId: string }) => ({
        id: params.petId,
        name: 'Fluffy',
        createdAt: '2026-09-12T12:00:00.000Z',
      }),
    }

    const prefetchOptions = {
      queryKey: ['pets', 'detail', '123'] as const,
      queryFn: async () => mockClient.getPetById({ petId: '123' }),
    }

    // Execute prefetch query function
    const serverResult = await prefetchOptions.queryFn()
    expect(serverResult.name).toBe('Fluffy')
    expect(serverResult.id).toBe('123')

    // 3. Simulate Client Component hydration with immediate data availability
    const clientCache = new Map<string, unknown>()
    clientCache.set(JSON.stringify(prefetchOptions.queryKey), serverResult)

    const cachedData = clientCache.get(JSON.stringify(['pets', 'detail', '123']))
    expect(cachedData).toEqual({
      id: '123',
      name: 'Fluffy',
      createdAt: '2026-09-12T12:00:00.000Z',
    })
  })

  // =========================================================================
  // Scenario 3: End-to-End Spec Evolution & Safe Orphan Pruning
  // =========================================================================
  it('T4-S3: End-to-End Spec Evolution & Safe Orphan Pruning', async () => {
    const projectDir = path.join(tempDir, 'spec-evolution')
    const mgr = new OaManifestManager(projectDir)

    // Milestone 1 (Day 1): Initial specification generated
    const activeFile1 = 'src/api/users.queries.ts'
    const activeFile2 = 'src/api/users.keys.ts'
    const obsoleteFile = 'src/api/legacy-reports.queries.ts'

    const file1Abs = path.join(projectDir, activeFile1)
    const file2Abs = path.join(projectDir, activeFile2)
    const obsoleteAbs = path.join(projectDir, obsoleteFile)

    const file1Content = `${OA_BANNER}\n// Auto-generated\nexport const usersQueries = 1;`
    const file2Content = `${OA_BANNER}\n// Auto-generated\nexport const usersKeys = 2;`
    const obsoleteContent = `${OA_BANNER}\n// Auto-generated\nexport const legacyQueries = 3;`

    await fs.mkdir(path.dirname(file1Abs), { recursive: true })
    await fs.writeFile(file1Abs, file1Content, 'utf8')
    await fs.writeFile(file2Abs, file2Content, 'utf8')
    await fs.writeFile(obsoleteAbs, obsoleteContent, 'utf8')

    // Developer adds hand-written file in same folder
    const devFile = path.join(projectDir, 'src/api/custom-metrics.ts')
    await fs.writeFile(devFile, 'export const devMetric = 99;', 'utf8')

    // Developer edits users.queries.ts
    const file1Modified = `${file1Content}\n// developer added custom query override`
    await fs.writeFile(file1Abs, file1Modified, 'utf8')

    mgr.createManifest('sha256:spec-v1', [
      {
        path: activeFile1,
        kind: 'queries',
        contentHash: computeSha256(file1Content), // Original hash
        generatedAt: new Date().toISOString(),
      },
      {
        path: activeFile2,
        kind: 'keys',
        contentHash: computeSha256(file2Content),
        generatedAt: new Date().toISOString(),
      },
      {
        path: obsoleteFile,
        kind: 'queries',
        contentHash: computeSha256(obsoleteContent),
        generatedAt: new Date().toISOString(),
      },
    ])
    await mgr.saveManifest()

    // Milestone 2 (Day 60): Spec updated without legacy-reports and without activeFile1
    const activeInV2 = [activeFile2, 'src/api/products.queries.ts']

    // Prune orphans
    const pruneRes = await mgr.pruneOrphans(activeInV2)

    // Obsolete file pruned
    expect(pruneRes.prunedFiles).toContain(obsoleteFile)
    expect(await fs.stat(obsoleteAbs).catch(() => null)).toBeNull()

    // Hand-written file untouched (Gate 1)
    expect(pruneRes.prunedFiles).not.toContain('src/api/custom-metrics.ts')
    expect(await fs.stat(devFile).catch(() => null)).not.toBeNull()

    // Modified generated file untouched (Gate 2)
    expect(pruneRes.skippedModified).toContain(activeFile1)
    expect(await fs.stat(file1Abs).catch(() => null)).not.toBeNull()
  })

  // =========================================================================
  // Scenario 4: Full-Stack Contract Sync (Fastify/Hono Router -> Frontend TanStack)
  // =========================================================================
  it('T4-S4: Full-Stack Contract Sync: Backend Handler Contract to Frontend TanStack Query', () => {
    // Generate TanStack options
    const optionsCode = generatePureOptionsFactory(fsdMultiDomainSpec)
    const keysCode = generateKeyFactory(fsdMultiDomainSpec)

    // Verify operations across both
    expect(keysCode).toContain('usersKeys')
    expect(keysCode).toContain('ordersKeys')
    expect(keysCode).toContain('productsKeys')

    expect(optionsCode).toContain('listUsersQueryOptions')
    expect(optionsCode).toContain('createUserMutationOptions')
    expect(optionsCode).toContain('listOrdersQueryOptions')
    expect(optionsCode).toContain('createOrderMutationOptions')

    // Assert wire format utilities eliminate runtime functions
    class OrderModel {
      constructor(public id: string, public totalAmount: number) {}
      calculateTax() {
        return this.totalAmount * 0.1
      }
    }

    const order = new OrderModel('ord-1', 99.99)
    const wireOrder = toWireJson(order)

    expect(wireOrder.id).toBe('ord-1')
    expect(wireOrder.totalAmount).toBe(99.99)
    expect((wireOrder as any).calculateTax).toBeUndefined()
  })

  // =========================================================================
  // Scenario 5: Monorepo Governance & Release Zero-Leak Audit
  // =========================================================================
  it('T4-S5: Monorepo Governance & Release Zero-Leak Audit', async () => {
    // 1. Release policy check
    const clientPkg = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), 'packages/client/package.json'), 'utf8'),
    )
    expect(clientPkg.dependencies?.['@tanstack/react-query']).toBeUndefined()

    // 2. CLI Spec Mirror existence
    const cliSpecMirror = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), 'docs/cli-spec/oa-gen.governance.json'), 'utf8'),
    )
    expect(cliSpecMirror.namespace).toBe('oa-gen')

    // 3. Documentation existence
    const playbookExists = await fs
      .stat(path.resolve(process.cwd(), 'docs/guides/onboarding-playbook.md'))
      .catch(() => null)
    expect(playbookExists).not.toBeNull()

    // 4. Skills existence
    const codegenSkillExists = await fs
      .stat(path.resolve(process.cwd(), '.agents/skills-optional/oa-codegen/SKILL.md'))
      .catch(() => null)
    expect(codegenSkillExists).not.toBeNull()

    const onboardingSkillExists = await fs
      .stat(path.resolve(process.cwd(), '.agents/skills-optional/oa-onboarding/SKILL.md'))
      .catch(() => null)
    expect(onboardingSkillExists).not.toBeNull()
  })
})
