import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ARTIFACT_KINDS,
  DEFAULT_BANNER_MARKERS,
  OaManifestManager,
  PathDispatcher,
  createPathDispatcher,
  dispatchArtifactPath,
  extractGroupFromPath,
  matchesRoutingRule,
  outputRoutingConfigSchema,
  resolveConfigWithDefaults,
  resolveImportSpecifier,
  resolvePathPattern,
  toCamelCase,
  toKebabCase,
  toPascalCase,
  validateOaConfig,
  type ArtifactKind,
  type OutputRoutingConfig,
  type OutputRoutingRule,
  type TokenContext,
} from '../index.js'

describe('Output Path Routing Customization Engine', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-routing-test-'))
  })

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  // ==========================================================================
  // 1. Token Resolution & Casing Transformations
  // ==========================================================================
  describe('Token Resolver & Casing Engine', () => {
    it('substitutes all core tokens with default kebab casing', () => {
      const template = 'src/features/{tag}/api/{operationId}.{method}.{kind}.ts'
      const context: TokenContext = {
        tag: 'UserManagement',
        kind: 'queries',
        operationId: 'getUserById',
        method: 'GET',
        group: 'Users',
      }

      const result = resolvePathPattern(template, context)
      expect(result).toBe('src/features/user-management/api/get-user-by-id.get.queries.ts')
    })

    it('supports camelCase transformation', () => {
      const template = 'src/api/{tag}/{operationId}.{kind}.ts'
      const context: TokenContext = {
        tag: 'billing-invoices',
        kind: 'client',
        operationId: 'process_payment_intent',
      }

      const result = resolvePathPattern(template, context, { casing: 'camel' })
      expect(result).toBe('src/api/billingInvoices/processPaymentIntent.client.ts')
    })

    it('supports PascalCase transformation', () => {
      const template = 'src/domain/{tag}/models/{tag}.{kind}.ts'
      const context: TokenContext = {
        tag: 'order-service',
        kind: 'contract',
      }

      const result = resolvePathPattern(template, context, { casing: 'pascal' })
      expect(result).toBe('src/domain/OrderService/models/OrderService.contract.ts')
    })

    it('supports preserve casing while sanitizing invalid filesystem characters', () => {
      const template = 'src/{tag}/{kind}.ts'
      const context: TokenContext = {
        tag: 'Mixed_Case-Entity:V1',
        kind: 'schemas',
      }

      const result = resolvePathPattern(template, context, { casing: 'preserve' })
      expect(result).toBe('src/Mixed_Case-Entity-V1/schemas.ts')
    })

    it('falls back when tag is missing to URL path group', () => {
      const template = 'src/features/{tag}/api/{tag}.{kind}.ts'
      const context: TokenContext = {
        path: '/billing/invoices/{id}',
        kind: 'queries',
      }

      const result = resolvePathPattern(template, context)
      expect(result).toBe('src/features/billing/api/billing.queries.ts')
    })

    it('falls back when tag and path are missing to default', () => {
      const template = 'src/features/{tag}/api/{tag}.{kind}.ts'
      const context: TokenContext = {
        kind: 'queries',
      }

      const result = resolvePathPattern(template, context)
      expect(result).toBe('src/features/default/api/default.queries.ts')
    })

    it('falls back operationId to method_group when operationId is missing', () => {
      const template = 'src/api/{tag}/{operationId}.{kind}.ts'
      const context: TokenContext = {
        tag: 'users',
        method: 'POST',
        path: '/users/create',
        kind: 'client',
      }

      const result = resolvePathPattern(template, context)
      expect(result).toBe('src/api/users/post-users.client.ts')
    })

    it('extracts path groups cleanly', () => {
      expect(extractGroupFromPath('/users/{id}')).toBe('users')
      expect(extractGroupFromPath('/api/v1/billing/charges')).toBe('api')
      expect(extractGroupFromPath('/{tenantId}/settings')).toBe('tenantId')
      expect(extractGroupFromPath('/')).toBe('default')
      expect(extractGroupFromPath('')).toBe('default')
      expect(extractGroupFromPath(undefined)).toBe('default')
    })

    it('handles casing transformation utility functions directly', () => {
      expect(toKebabCase('UserProfileManagement')).toBe('user-profile-management')
      expect(toKebabCase('user_profile_data')).toBe('user-profile-data')
      expect(toKebabCase('api-v1-test')).toBe('api-v1-test')
      expect(toKebabCase('')).toBe('')

      expect(toCamelCase('user-profile-management')).toBe('userProfileManagement')
      expect(toCamelCase('User_Profile')).toBe('userProfile')
      expect(toCamelCase('')).toBe('')

      expect(toPascalCase('user-profile-management')).toBe('UserProfileManagement')
      expect(toPascalCase('user_profile')).toBe('UserProfile')
      expect(toPascalCase('')).toBe('')
    })

    it('normalizes Windows backslashes and deduplicates duplicate slashes in templates', () => {
      const template = 'src\\features//{tag}\\\\api//{kind}.ts'
      const context: TokenContext = {
        tag: 'users',
        kind: 'keys',
      }

      const result = resolvePathPattern(template, context)
      expect(result).toBe('src/features/users/api/keys.ts')
    })
  })

  // ==========================================================================
  // 2. Dynamic Relative Import Path Resolution
  // ==========================================================================
  describe('Dynamic Relative Import Resolver', () => {
    it('calculates same-directory relative import with .js extension', () => {
      const importPath = resolveImportSpecifier({
        fromFilePath: '/project/src/features/users/api/users.queries.ts',
        toFilePath: '/project/src/features/users/api/users.keys.ts',
        rootDir: '/project',
      })

      expect(importPath).toBe('./users.keys.js')
    })

    it('calculates cross-directory relative import with .js extension', () => {
      const importPath = resolveImportSpecifier({
        fromFilePath: '/project/src/features/users/api/users.queries.ts',
        toFilePath: '/project/src/shared/api/users.client.ts',
        rootDir: '/project',
      })

      expect(importPath).toBe('../../../shared/api/users.client.js')
    })

    it('calculates parent-to-child import with .js extension', () => {
      const importPath = resolveImportSpecifier({
        fromFilePath: '/project/src/index.ts',
        toFilePath: '/project/src/features/users/api/users.queries.ts',
        rootDir: '/project',
      })

      expect(importPath).toBe('./features/users/api/users.queries.js')
    })

    it('supports extensionless import resolution', () => {
      const importPath = resolveImportSpecifier({
        fromFilePath: '/project/src/features/users/api/users.queries.ts',
        toFilePath: '/project/src/shared/api/users.client.ts',
        rootDir: '/project',
        extension: '',
      })

      expect(importPath).toBe('../../../shared/api/users.client')
    })

    it('resolves tsconfig path aliases when configured', () => {
      const tsconfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@features/*': ['src/features/*'],
            '@shared/*': ['src/shared/*'],
            '@api-root': ['src/api/index.ts'],
          },
        },
      }

      const importPath = resolveImportSpecifier({
        fromFilePath: '/project/src/features/users/api/users.queries.ts',
        toFilePath: '/project/src/shared/api/users.client.ts',
        rootDir: '/project',
        importStyle: 'alias',
        tsconfig,
      })

      expect(importPath).toBe('@shared/api/users.client.js')

      const rootImport = resolveImportSpecifier({
        fromFilePath: '/project/src/features/users/api/users.queries.ts',
        toFilePath: '/project/src/api/index.ts',
        rootDir: '/project',
        importStyle: 'alias',
        tsconfig,
        extension: '',
      })

      expect(rootImport).toBe('@api-root')
    })

    it('falls back to relative import when tsconfig path alias does not match', () => {
      const tsconfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@features/*': ['src/features/*'],
          },
        },
      }

      const importPath = resolveImportSpecifier({
        fromFilePath: '/project/src/features/users/api/users.queries.ts',
        toFilePath: '/project/src/external/api/external.client.ts',
        rootDir: '/project',
        importStyle: 'alias',
        tsconfig,
      })

      expect(importPath).toBe('../../../external/api/external.client.js')
    })

    it('guards against self-imports by throwing descriptive error', () => {
      expect(() => {
        resolveImportSpecifier({
          fromFilePath: '/project/src/users.queries.ts',
          toFilePath: '/project/src/users.queries.ts',
          rootDir: '/project',
        })
      }).toThrow(/Self-import is not allowed/)
    })

    it('strictly normalizes Windows backslashes to POSIX forward slashes', () => {
      const importPath = resolveImportSpecifier({
        fromFilePath: 'C:\\project\\src\\features\\users\\api\\users.queries.ts',
        toFilePath: 'C:\\project\\src\\shared\\api\\users.client.ts',
        rootDir: 'C:\\project',
      })

      expect(importPath).not.toContain('\\')
      expect(importPath).toContain('/')
      expect(importPath).toBe('../../../shared/api/users.client.js')
    })
  })

  // ==========================================================================
  // 3. Central Path Dispatcher & Precedence Engine
  // ==========================================================================
  describe('Path Dispatcher & Rule Matching Precedence', () => {
    it('follows default convention when no routing config is provided', () => {
      const result = dispatchArtifactPath({
        tag: 'users',
        kind: 'queries',
      })

      expect(result.matchedBy).toBe('default')
      expect(result.relativePath).toBe('src/api/users/users.queries.ts')
    })

    it('falls back to generated directory when tag is absent', () => {
      const result = dispatchArtifactPath({
        kind: 'schemas',
      })

      expect(result.matchedBy).toBe('default')
      expect(result.relativePath).toBe('src/api/generated/schemas.ts')
    })

    it('uses global template pattern when defined', () => {
      const config: OutputRoutingConfig = {
        pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
      }

      const result = dispatchArtifactPath(
        { tag: 'billing', kind: 'client' },
        { config },
      )

      expect(result.matchedBy).toBe('pattern')
      expect(result.relativePath).toBe('src/features/billing/api/billing.client.ts')
    })

    it('prioritizes byKind over pattern', () => {
      const config: OutputRoutingConfig = {
        pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
        byKind: {
          contract: 'src/server/contracts/{tag}.contract.ts',
          client: 'packages/sdk/src/{tag}.client.ts',
        },
      }

      const contractResult = dispatchArtifactPath(
        { tag: 'users', kind: 'contract' },
        { config },
      )
      expect(contractResult.matchedBy).toBe('byKind')
      expect(contractResult.relativePath).toBe('src/server/contracts/users.contract.ts')

      const queriesResult = dispatchArtifactPath(
        { tag: 'users', kind: 'queries' },
        { config },
      )
      expect(queriesResult.matchedBy).toBe('pattern')
      expect(queriesResult.relativePath).toBe('src/features/users/api/users.queries.ts')
    })

    it('prioritizes matching rules over byKind and pattern', () => {
      const rules: OutputRoutingRule[] = [
        {
          tag: 'admin',
          target: 'src/admin/{tag}.{kind}.ts',
        },
        {
          pathPrefix: '/api/v1/billing',
          kind: 'queries',
          target: 'src/features/billing/api/billing-v1.queries.ts',
        },
        {
          method: 'post',
          kind: 'contract',
          target: 'src/mutations/{operationId}.contract.ts',
        },
      ]

      const config: OutputRoutingConfig = {
        pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
        byKind: {
          queries: 'src/queries/{tag}.queries.ts',
        },
        rules,
      }

      // Rule 1 match by tag
      const adminResult = dispatchArtifactPath(
        { tag: 'admin', kind: 'queries' },
        { config },
      )
      expect(adminResult.matchedBy).toBe('rule')
      expect(adminResult.ruleIndex).toBe(0)
      expect(adminResult.relativePath).toBe('src/admin/admin.queries.ts')

      // Rule 2 match by pathPrefix + kind
      const billingResult = dispatchArtifactPath(
        { tag: 'billing', path: '/api/v1/billing/invoices', kind: 'queries' },
        { config },
      )
      expect(billingResult.matchedBy).toBe('rule')
      expect(billingResult.ruleIndex).toBe(1)
      expect(billingResult.relativePath).toBe('src/features/billing/api/billing-v1.queries.ts')

      // Rule 3 match by method + kind
      const mutationResult = dispatchArtifactPath(
        { tag: 'orders', method: 'POST', operationId: 'createOrder', kind: 'contract' },
        { config },
      )
      expect(mutationResult.matchedBy).toBe('rule')
      expect(mutationResult.ruleIndex).toBe(2)
      expect(mutationResult.relativePath).toBe('src/mutations/create-order.contract.ts')

      // Unmatched rule falls through to byKind
      const usersQueries = dispatchArtifactPath(
        { tag: 'users', kind: 'queries' },
        { config },
      )
      expect(usersQueries.matchedBy).toBe('byKind')
      expect(usersQueries.relativePath).toBe('src/queries/users.queries.ts')
    })

    it('handles baseDir configuration correctly', () => {
      const config: OutputRoutingConfig = {
        baseDir: 'packages/frontend',
        pattern: 'src/features/{tag}/{tag}.{kind}.ts',
      }

      const result = dispatchArtifactPath(
        { tag: 'auth', kind: 'keys' },
        { config },
      )

      expect(result.relativePath).toBe('packages/frontend/src/features/auth/auth.keys.ts')
    })

    it('tests matchesRoutingRule helper with all combinations', () => {
      const rule: OutputRoutingRule = {
        tag: ['users', 'accounts'],
        pathPrefix: '/api/v2',
        method: ['get', 'post'],
        kind: ['queries', 'client'],
        profile: 'full-api-document',
        target: 'out.ts',
      }

      expect(
        matchesRoutingRule(rule, {
          tag: 'users',
          path: '/api/v2/users',
          method: 'GET',
          kind: 'queries',
          profile: 'full-api-document',
        }),
      ).toBe(true)

      expect(
        matchesRoutingRule(rule, {
          tag: 'billing', // tag mismatch
          path: '/api/v2/users',
          method: 'GET',
          kind: 'queries',
          profile: 'full-api-document',
        }),
      ).toBe(false)

      expect(
        matchesRoutingRule(rule, {
          tag: 'users',
          path: '/api/v1/users', // pathPrefix mismatch
          method: 'GET',
          kind: 'queries',
          profile: 'full-api-document',
        }),
      ).toBe(false)
    })

    it('PathDispatcher resolves cross-artifact imports seamlessly', () => {
      const dispatcher = createPathDispatcher(
        {
          byKind: {
            queries: 'src/features/{tag}/api/{tag}.queries.ts',
            keys: 'src/features/{tag}/api/{tag}.keys.ts',
            client: 'src/shared/api/{tag}.client.ts',
          },
        },
        tmpDir,
      )

      const queriesContext: TokenContext = { tag: 'users', kind: 'queries' }
      const keysContext: TokenContext = { tag: 'users', kind: 'keys' }
      const clientContext: TokenContext = { tag: 'users', kind: 'client' }

      const importKeys = dispatcher.resolveImport(queriesContext, keysContext)
      expect(importKeys).toBe('./users.keys.js')

      const importClient = dispatcher.resolveImport(queriesContext, clientContext)
      expect(importClient).toBe('../../../shared/api/users.client.js')
    })
  })

  // ==========================================================================
  // 4. Manifest Manager & 3-Gate Safety Invariants
  // ==========================================================================
  describe('Manifest Manager & 3-Gate Orphan Pruning', () => {
    it('writes artifacts, computes SHA-256 hashes, and commits .oa-manifest.json', async () => {
      const manager = new OaManifestManager(tmpDir)

      const artifacts = [
        {
          path: 'src/features/users/api/users.queries.ts',
          kind: 'queries' as ArtifactKind,
          tag: 'users',
          content: '/** @generated by @oa-sdk/codegen */\nexport const userQueries = {}',
        },
        {
          path: 'src/features/users/api/users.keys.ts',
          kind: 'keys' as ArtifactKind,
          tag: 'users',
          content: '/** @generated by @oa-sdk/codegen */\nexport const userKeys = {}',
        },
      ]

      const writeResult = await manager.writeArtifacts(artifacts)
      expect(writeResult.written).toHaveLength(2)
      expect(writeResult.skipped).toHaveLength(0)

      // Verify files exist on disk
      expect(fs.existsSync(path.join(tmpDir, 'src/features/users/api/users.queries.ts'))).toBe(true)
      expect(fs.existsSync(path.join(tmpDir, 'src/features/users/api/users.keys.ts'))).toBe(true)
      expect(fs.existsSync(path.join(tmpDir, '.oa-manifest.json'))).toBe(true)

      // Verify manifest content
      const manifest = await manager.loadManifest()
      expect(manifest.version).toBe(1)
      expect(manifest.artifacts).toHaveLength(2)
      expect(manifest.artifacts[0]!.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    })

    it('skips writing bit-identical artifacts to avoid updating filesystem timestamps', async () => {
      const manager = new OaManifestManager(tmpDir)

      const artifacts = [
        {
          path: 'src/users.queries.ts',
          kind: 'queries' as ArtifactKind,
          content: '/** @generated */\nexport const a = 1',
        },
      ]

      const res1 = await manager.writeArtifacts(artifacts)
      expect(res1.written).toEqual(['src/users.queries.ts'])
      expect(res1.skipped).toEqual([])

      // Second run with identical content
      const res2 = await manager.writeArtifacts(artifacts)
      expect(res2.written).toEqual([])
      expect(res2.skipped).toEqual(['src/users.queries.ts'])
    })

    it('Gate 1 Safety: NEVER touches hand-written files not in manifest', async () => {
      const manager = new OaManifestManager(tmpDir)

      // Generate a legitimate artifact
      await manager.writeArtifacts([
        {
          path: 'src/features/users/api/users.queries.ts',
          kind: 'queries',
          content: '/** @generated */\nexport const q = 1',
        },
      ])

      // Developer creates a hand-written helper in the same folder
      const manualFilePath = path.join(tmpDir, 'src/features/users/api/helpers.ts')
      fs.writeFileSync(manualFilePath, 'export function myCustomHelper() { return 42 }', 'utf8')

      // Next run: activePaths has no files (simulating tag removal)
      const pruneResult = await manager.pruneOrphans([])

      // The generated artifact was pruned
      expect(pruneResult.pruned).toContain('src/features/users/api/users.queries.ts')

      // The developer's hand-written helper was NEVER touched!
      expect(fs.existsSync(manualFilePath)).toBe(true)
      expect(fs.readFileSync(manualFilePath, 'utf8')).toContain('myCustomHelper')
    })

    it('Gate 2 Safety: NEVER prunes a generated file modified by a developer', async () => {
      const manager = new OaManifestManager(tmpDir)

      // Write initial artifact
      await manager.writeArtifacts([
        {
          path: 'src/features/users/api/users.queries.ts',
          kind: 'queries',
          content: '/** @generated by @oa-sdk */\nexport const initial = true',
        },
      ])

      // Developer manually modified the file on disk
      const filePath = path.join(tmpDir, 'src/features/users/api/users.queries.ts')
      fs.writeFileSync(filePath, '/** @generated by @oa-sdk */\nexport const initial = true;\n// Custom manual logic', 'utf8')

      // Orphan pruning run
      const pruneResult = await manager.pruneOrphans([])

      // Gate 2 blocked pruning!
      expect(pruneResult.pruned).not.toContain('src/features/users/api/users.queries.ts')
      expect(pruneResult.skipped).toHaveLength(1)
      expect(pruneResult.skipped[0]!.reason).toBe('content-modified')
      expect(fs.existsSync(filePath)).toBe(true)
    })

    it('Gate 3 Safety: NEVER prunes a file missing auto-generated banner', async () => {
      const manager = new OaManifestManager(tmpDir)

      // Write artifact whose content has NO banner
      const contentNoBanner = 'export const noBanner = true'
      await manager.writeArtifacts([
        {
          path: 'src/features/users/api/users.queries.ts',
          kind: 'queries',
          content: contentNoBanner,
        },
      ])

      // Orphan pruning run
      const pruneResult = await manager.pruneOrphans([])

      // Gate 3 blocked pruning because banner is missing!
      expect(pruneResult.pruned).not.toContain('src/features/users/api/users.queries.ts')
      expect(pruneResult.skipped).toHaveLength(1)
      expect(pruneResult.skipped[0]!.reason).toBe('banner-missing')
      expect(fs.existsSync(path.join(tmpDir, 'src/features/users/api/users.queries.ts'))).toBe(true)
    })

    it('safely prunes obsolete artifacts when all 3 gates pass and cleans empty parent directories', async () => {
      const manager = new OaManifestManager(tmpDir)

      const fileA = 'src/features/users/api/users.queries.ts'
      const fileB = 'src/features/billing/api/billing.queries.ts'

      await manager.writeArtifacts([
        {
          path: fileA,
          kind: 'queries',
          content: '/** @generated by @oa-sdk/codegen */\nexport const users = 1',
        },
        {
          path: fileB,
          kind: 'queries',
          content: '/** @generated by @oa-sdk/codegen */\nexport const billing = 2',
        },
      ])

      // Billing is kept, Users is pruned
      const pruneResult = await manager.pruneOrphans([fileB])

      expect(pruneResult.pruned).toEqual([fileA])
      expect(fs.existsSync(path.join(tmpDir, fileA))).toBe(false)
      expect(fs.existsSync(path.join(tmpDir, fileB))).toBe(true)

      // Empty parent directory src/features/users was cleaned up
      expect(fs.existsSync(path.join(tmpDir, 'src/features/users'))).toBe(false)
      // src/features/billing is preserved
      expect(fs.existsSync(path.join(tmpDir, 'src/features/billing/api'))).toBe(true)

      // Manifest was updated
      const manifest = await manager.loadManifest()
      expect(manifest.artifacts).toHaveLength(1)
      expect(manifest.artifacts[0]!.path).toBe(fileB)
    })

    it('supports dry-run mode for orphan pruning', async () => {
      const manager = new OaManifestManager(tmpDir)

      const file = 'src/users.queries.ts'
      await manager.writeArtifacts([
        {
          path: file,
          kind: 'queries',
          content: '/** @generated */\nexport const q = 1',
        },
      ])

      const dryResult = await manager.pruneOrphans([], { dryRun: true })
      expect(dryResult.pruned).toEqual([file])
      // File still exists on disk because dryRun was true
      expect(fs.existsSync(path.join(tmpDir, file))).toBe(true)
    })
  })

  // ==========================================================================
  // 5. Config Schema & Validation Integration
  // ==========================================================================
  describe('Config Schema & Validation for Output Routing', () => {
    it('validates a complete valid OutputRoutingConfig with Zod', () => {
      const config: OutputRoutingConfig = {
        pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
        byKind: {
          contract: 'src/contracts/{tag}.contract.ts',
          client: 'src/client/{tag}.client.ts',
          queries: 'src/queries/{tag}.queries.ts',
          keys: 'src/keys/{tag}.keys.ts',
          guards: 'src/guards/{tag}.guards.ts',
          schemas: 'src/schemas/{tag}.schemas.ts',
        },
        rules: [
          {
            tag: ['users', 'auth'],
            pathPrefix: '/api/v1',
            method: 'get',
            kind: 'queries',
            target: 'src/v1/{tag}.queries.ts',
          },
        ],
        baseDir: 'packages/app',
        importStyle: 'relative',
        casing: 'kebab',
        pruneOrphans: true,
      }

      const parsed = outputRoutingConfigSchema.safeParse(config)
      expect(parsed.success).toBe(true)
    })

    it('validates outputRouting under product in validateOaConfig', () => {
      const validConfig = {
        product: {
          outputRouting: {
            pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
            casing: 'kebab',
            importStyle: 'alias',
          },
        },
      }

      const res = validateOaConfig(validConfig)
      expect(res.valid).toBe(true)
      expect(res.errors).toHaveLength(0)
    })

    it('validates top-level outputRouting alias in validateOaConfig', () => {
      const validConfig = {
        outputRouting: {
          pattern: 'src/features/{tag}/api/{tag}.{kind}.ts',
          pruneOrphans: false,
        },
      }

      const res = validateOaConfig(validConfig)
      expect(res.valid).toBe(true)
      expect(res.errors).toHaveLength(0)
    })

    it('reports validation errors for invalid outputRouting values', () => {
      const invalidConfig = {
        outputRouting: {
          pattern: '', // empty pattern
          byKind: {
            invalidKind: 'path.ts', // unknown artifact kind
          },
          rules: [
            {
              target: '', // empty target
              kind: 'unknown-kind', // invalid kind
            },
          ],
          importStyle: 'invalid-style', // invalid enum
          casing: 'invalid-casing', // invalid enum
          pruneOrphans: 'yes', // not a boolean
        },
      }

      const res = validateOaConfig(invalidConfig)
      expect(res.valid).toBe(false)
      const errorPaths = res.errors.map((e) => e.path)

      expect(errorPaths).toContain('outputRouting.pattern')
      expect(errorPaths).toContain('outputRouting.byKind.invalidKind')
      expect(errorPaths).toContain('outputRouting.rules[0].target')
      expect(errorPaths).toContain('outputRouting.rules[0].kind')
      expect(errorPaths).toContain('outputRouting.importStyle')
      expect(errorPaths).toContain('outputRouting.casing')
      expect(errorPaths).toContain('outputRouting.pruneOrphans')
    })

    it('merges outputRouting into resolved config with resolveConfigWithDefaults', () => {
      const resolved = resolveConfigWithDefaults({
        outputRouting: {
          pattern: 'src/features/{tag}/{tag}.{kind}.ts',
          casing: 'pascal',
        },
      })

      expect(resolved.outputRouting).toBeDefined()
      expect(resolved.outputRouting?.pattern).toBe('src/features/{tag}/{tag}.{kind}.ts')
      expect(resolved.outputRouting?.casing).toBe('pascal')
      expect(resolved.product.outputRouting?.pattern).toBe('src/features/{tag}/{tag}.{kind}.ts')
    })
  })
})
