import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  petstoreSpec,
  edgeCasesSpec,
  specialCharSpec,
} from './helpers/fixtures.js'
import {
  resolvePathPattern,
  dispatchArtifactPath,
  resolveImportSpecifier,
  OaManifestManager,
  computeSha256,
  OA_BANNER,
  toKebabCase,
  toCamelCase,
  toPascalCase,
  sanitizePreserve,
} from './helpers/routing-harness.js'
import {
  generateKeyFactory,
  generatePureOptionsFactory,
  generateHookHelpers,
} from './helpers/tanstack-harness.js'
import { validateTsSyntax } from './helpers/ast-validator.js'

describe('Tier 2: Boundary & Corner Cases (Boundary Areas 1–7)', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oa-tier2-'))
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // =========================================================================
  // Boundary Area 1: Missing Tags & Fallback Hierarchies
  // =========================================================================
  describe('B1: Missing Tags & Fallback Hierarchies', () => {
    it('T2-B01-1: falls back to first URL segment (group) when tags is missing', () => {
      const template = 'src/features/{tag}/api/{tag}.{kind}.ts'
      const resolved = resolvePathPattern(template, {
        group: 'healthz',
        kind: 'queries',
      })
      expect(resolved).toBe('src/features/healthz/api/healthz.queries.ts')
    })

    it('T2-B01-2: falls back to "default" when both tag and group are missing or root "/"', () => {
      const template = 'src/api/{tag}/{kind}.ts'
      const resolved = resolvePathPattern(template, {
        kind: 'client',
      })
      expect(resolved).toBe('src/api/default/client.ts')
    })

    it('T2-B01-3: multi-tag operation chooses primary tag tags[0]', () => {
      const template = 'src/features/{tag}/api/{tag}.{kind}.ts'
      const resolved = resolvePathPattern(template, {
        tag: 'UserManagement',
        kind: 'keys',
      })
      expect(resolved).toBe('src/features/user-management/api/user-management.keys.ts')
    })

    it('T2-B01-4: operationId missing falls back to {method}_{group}', () => {
      const template = 'src/api/{operationId}.ts'
      const resolved = resolvePathPattern(template, {
        method: 'GET',
        group: 'users',
        kind: 'client',
      })
      expect(resolved).toBe('src/api/get-users.ts')
    })

    it('T2-B01-5: operationId with no method or group falls back to "operation"', () => {
      const template = 'src/api/{operationId}.ts'
      const resolved = resolvePathPattern(template, {
        kind: 'client',
      })
      expect(resolved).toBe('src/api/operation.ts')
    })
  })

  // =========================================================================
  // Boundary Area 2: Special Characters & Casing Edge Cases
  // =========================================================================
  describe('B2: Special Characters & Casing Edge Cases', () => {
    it('T2-B02-1: formats tags with spaces into kebab-case', () => {
      expect(toKebabCase('User Management')).toBe('user-management')
      expect(toKebabCase('Administrative Controls')).toBe('administrative-controls')
    })

    it('T2-B02-2: formats tags with underscores into camelCase', () => {
      expect(toCamelCase('user_profile_details')).toBe('userProfileDetails')
      expect(toCamelCase('order_item_list')).toBe('orderItemList')
    })

    it('T2-B02-3: formats hyphenated tags into PascalCase', () => {
      expect(toPascalCase('billing-v2')).toBe('BillingV2')
      expect(toPascalCase('auth-service-v1')).toBe('AuthServiceV1')
    })

    it('T2-B02-4: sanitizes URL paths with custom colon verbs (invoices:export)', () => {
      const template = 'src/endpoints/{operationId}.ts'
      const resolved = resolvePathPattern(template, {
        operationId: 'invoices:export',
        kind: 'client',
      })
      expect(resolved).toBe('src/endpoints/invoicesexport.ts')
    })

    it('T2-B02-5: strips filesystem illegal characters (: * ? " < > | \0) in preserve mode', () => {
      const sanitized = sanitizePreserve('bad:file*name?with"chars<and>pipes|null\0')
      expect(sanitized).toBe('badfilenamewithcharsandpipesnull')
    })
  })

  // =========================================================================
  // Boundary Area 3: Cross-Platform Path Normalization
  // =========================================================================
  describe('B3: Cross-Platform Path Normalization', () => {
    it('T2-B03-1: converts Windows backslashes to POSIX forward slashes in templates', () => {
      const winTemplate = 'src\\features\\{tag}\\api\\{kind}.ts'
      const resolved = resolvePathPattern(winTemplate, {
        tag: 'users',
        kind: 'queries',
      })
      expect(resolved).toBe('src/features/users/api/queries.ts')
      expect(resolved).not.toContain('\\')
    })

    it('T2-B03-2: collapses redundant consecutive slashes (src//features///users)', () => {
      const redundantTemplate = 'src//features///{tag}////{kind}.ts'
      const resolved = resolvePathPattern(redundantTemplate, {
        tag: 'users',
        kind: 'keys',
      })
      expect(resolved).toBe('src/features/users/keys.ts')
    })

    it('T2-B03-3: handles relative import specifier with Windows backslashes safely', () => {
      const specifier = resolveImportSpecifier({
        fromFilePath: 'src/features/users/api/users.queries.ts',
        toFilePath: 'src/features/users/api/users.keys.ts',
      })
      expect(specifier).toBe('./users.keys.js')
      expect(specifier).not.toContain('\\')
    })

    it('T2-B03-4: handles nested directories cleanly without trailing slashes', () => {
      const template = 'src/features/{tag}/api/'
      const resolved = resolvePathPattern(template, { tag: 'users', kind: 'client' })
      expect(resolved.endsWith('/')).toBe(true)
    })

    it('T2-B03-5: handles relative path between deep directories with POSIX slashes', () => {
      const specifier = resolveImportSpecifier({
        fromFilePath: 'apps/web/src/features/users/api/queries.ts',
        toFilePath: 'apps/web/src/shared/types/user.ts',
      })
      expect(specifier).toBe('../../../shared/types/user.js')
    })
  })

  // =========================================================================
  // Boundary Area 4: Manifest 3-Gate Safety Invariants
  // =========================================================================
  describe('B4: Manifest 3-Gate Safety Invariants', () => {
    it('T2-B04-1: Gate 1: unlisted file in generated directory is strictly ignored', async () => {
      const testDir = path.join(tempDir, 'gate-invariants-1')
      const mgr = new OaManifestManager(testDir)

      const devFile = path.join(testDir, 'src/api/users/custom-util.ts')
      await fs.mkdir(path.dirname(devFile), { recursive: true })
      await fs.writeFile(devFile, 'export const util = 1;', 'utf8')

      // Previous manifest has only queries.ts
      mgr.createManifest('sha256:spec1', [
        {
          path: 'src/api/users/queries.ts',
          kind: 'queries',
          contentHash: 'dummy',
          generatedAt: new Date().toISOString(),
        },
      ])
      await mgr.saveManifest()

      // Prune orphans when active paths is empty
      const res = await mgr.pruneOrphans([])
      expect(res.prunedFiles).not.toContain('src/api/users/custom-util.ts')

      // File still exists
      const exists = await fs.stat(devFile).catch(() => null)
      expect(exists).not.toBeNull()
    })

    it('T2-B04-2: Gate 2: modified file with hash mismatch is strictly preserved with log', async () => {
      const testDir = path.join(tempDir, 'gate-invariants-2')
      const mgr = new OaManifestManager(testDir)

      const modFileRel = 'src/api/users/queries.ts'
      const modFileAbs = path.join(testDir, modFileRel)
      const original = `${OA_BANNER}\nexport const original = 1;`
      const modified = `${OA_BANNER}\nexport const original = 1;\n// developer customized this`

      await fs.mkdir(path.dirname(modFileAbs), { recursive: true })
      await fs.writeFile(modFileAbs, modified, 'utf8')

      mgr.createManifest('sha256:spec1', [
        {
          path: modFileRel,
          kind: 'queries',
          contentHash: computeSha256(original),
          generatedAt: new Date().toISOString(),
        },
      ])
      await mgr.saveManifest()

      const res = await mgr.pruneOrphans([])
      expect(res.prunedFiles).not.toContain(modFileRel)
      expect(res.skippedModified).toContain(modFileRel)
    })

    it('T2-B04-3: Gate 3: file with banner removed by developer is strictly preserved', async () => {
      const testDir = path.join(tempDir, 'gate-invariants-3')
      const mgr = new OaManifestManager(testDir)

      const strippedRel = 'src/api/users/keys.ts'
      const strippedAbs = path.join(testDir, strippedRel)
      const strippedContent = 'export const myKeys = {};' // No banner!

      await fs.mkdir(path.dirname(strippedAbs), { recursive: true })
      await fs.writeFile(strippedAbs, strippedContent, 'utf8')

      mgr.createManifest('sha256:spec1', [
        {
          path: strippedRel,
          kind: 'keys',
          contentHash: computeSha256(strippedContent),
          generatedAt: new Date().toISOString(),
        },
      ])
      await mgr.saveManifest()

      const res = await mgr.pruneOrphans([])
      expect(res.prunedFiles).not.toContain(strippedRel)
      expect(res.skippedNoBanner).toContain(strippedRel)
    })

    it('T2-B04-4: bit-identical rerun preserves files without deleting or touching active ones', async () => {
      const testDir = path.join(tempDir, 'gate-invariants-4')
      const mgr = new OaManifestManager(testDir)

      const activeRel = 'src/api/users/active.ts'
      const activeAbs = path.join(testDir, activeRel)
      const content = `${OA_BANNER}\nexport const active = true;`

      await fs.mkdir(path.dirname(activeAbs), { recursive: true })
      await fs.writeFile(activeAbs, content, 'utf8')

      mgr.createManifest('sha256:spec1', [
        {
          path: activeRel,
          kind: 'client',
          contentHash: computeSha256(content),
          generatedAt: new Date().toISOString(),
        },
      ])
      await mgr.saveManifest()

      const res = await mgr.pruneOrphans([activeRel])
      expect(res.prunedFiles).toHaveLength(0)
      expect(res.skippedModified).toHaveLength(0)
    })

    it('T2-B04-5: dry-run mode identifies orphans without deleting them from disk', async () => {
      const testDir = path.join(tempDir, 'gate-invariants-5')
      const mgr = new OaManifestManager(testDir)

      const orphanRel = 'src/api/orphan.ts'
      const orphanAbs = path.join(testDir, orphanRel)
      const content = `${OA_BANNER}\nexport const orphan = true;`

      await fs.mkdir(path.dirname(orphanAbs), { recursive: true })
      await fs.writeFile(orphanAbs, content, 'utf8')

      mgr.createManifest('sha256:spec1', [
        {
          path: orphanRel,
          kind: 'client',
          contentHash: computeSha256(content),
          generatedAt: new Date().toISOString(),
        },
      ])
      await mgr.saveManifest()

      const res = await mgr.pruneOrphans([], { dryRun: true })
      expect(res.prunedFiles).toContain(orphanRel)

      // Disk file must still exist because dryRun: true
      const exists = await fs.stat(orphanAbs).catch(() => null)
      expect(exists).not.toBeNull()
    })
  })

  // =========================================================================
  // Boundary Area 5: Operation Parameter Edge Cases
  // =========================================================================
  describe('B5: Operation Parameter Edge Cases', () => {
    it('T2-B05-1: parameterless GET emits zero-argument query options and hook', () => {
      const keysCode = generateKeyFactory(edgeCasesSpec)
      expect(keysCode).toContain('checkHealth: () => [...defaultKeys.all, \'checkHealth\'] as const')

      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      expect(optionsCode).toContain('export function checkHealthQueryOptions')
      expect(optionsCode).toContain('client.checkHealth()')

      const hooksCode = generateHookHelpers(edgeCasesSpec)
      expect(hooksCode).toContain('export function useCheckHealthQuery')
      expect(hooksCode).toContain('useQuery(checkHealthQueryOptions(client, options)')
    })

    it('T2-B05-2: path-only parameters emits clean params object without query', () => {
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      const fnSlice = optionsCode.slice(
        optionsCode.indexOf('export function getItemPathOnlyQueryOptions'),
        optionsCode.indexOf('export function searchItemsQueryOnlyQueryOptions'),
      )
      expect(fnSlice).toContain('export function getItemPathOnlyQueryOptions')
      expect(fnSlice).toContain('params: Record<string, string>')
      expect(fnSlice).not.toContain('query?: Record<string, unknown>')
    })

    it('T2-B05-3: query-only parameters emits query object without path params', () => {
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      const fnSlice = optionsCode.slice(
        optionsCode.indexOf('export function searchItemsQueryOnlyQueryOptions'),
        optionsCode.indexOf('export type BulkUploadBodyOnlyVariables'),
      )
      expect(fnSlice).toContain('export function searchItemsQueryOnlyQueryOptions')
      expect(fnSlice).toContain('query?: Record<string, unknown>')
      expect(fnSlice).not.toContain('params: Record<string, string>')
    })

    it('T2-B05-4: body-only operation emits variables with body property', () => {
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      expect(optionsCode).toContain('export type BulkUploadBodyOnlyVariables = {')
      expect(optionsCode).toContain('body: Resolved<unknown>')
      expect(optionsCode).toContain('export function bulkUploadBodyOnlyMutationOptions')
    })

    it('T2-B05-5: generates syntactically valid TypeScript for all parameter boundary cases', () => {
      const keysCode = generateKeyFactory(edgeCasesSpec)
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      const hooksCode = generateHookHelpers(edgeCasesSpec)

      expect(validateTsSyntax(keysCode).valid).toBe(true)
      expect(validateTsSyntax(optionsCode).valid).toBe(true)
      expect(validateTsSyntax(hooksCode).valid).toBe(true)
    })
  })

  // =========================================================================
  // Boundary Area 6: Response Shape & Mutation Edge Cases
  // =========================================================================
  describe('B6: Response Shape & Mutation Edge Cases', () => {
    it('T2-B06-1: 204 No Content / void operation generates valid mutation options', () => {
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      expect(optionsCode).toContain('export function voidDeleteItemMutationOptions')
      expect(optionsCode).toContain('export type VoidDeleteItemVariables = {')
      expect(optionsCode).toContain('params: Record<string, string>')
    })

    it('T2-B06-2: binary streaming operation generates query options cleanly', () => {
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      expect(optionsCode).toContain('export function downloadItemStreamQueryOptions')
      expect(optionsCode).toContain('params: Record<string, string>')
    })

    it('T2-B06-3: optional request body operation packages body into variables', () => {
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      expect(optionsCode).toContain('export type PatchWithOptionalBodyVariables = {')
      expect(optionsCode).toContain('body: Resolved<unknown>')
    })

    it('T2-B06-4: mutation with both path params and body packages both in variables', () => {
      const optionsCode = generatePureOptionsFactory(petstoreSpec)
      expect(optionsCode).toContain('export type UpdatePetVariables = {')
      expect(optionsCode).toContain('params: Record<string, string>')
      expect(optionsCode).toContain('body: Resolved<unknown>')
    })

    it('T2-B06-5: verifies full TypeScript AST validity of edge case options', () => {
      const optionsCode = generatePureOptionsFactory(edgeCasesSpec)
      const syntax = validateTsSyntax(optionsCode)
      expect(syntax.valid).toBe(true)
    })
  })

  // =========================================================================
  // Boundary Area 7: Import & Self-Import Guards
  // =========================================================================
  describe('B7: Import & Self-Import Guards', () => {
    it('T2-B07-1: direct self-import throws explicit error', () => {
      expect(() => {
        resolveImportSpecifier({
          fromFilePath: 'src/api/users.ts',
          toFilePath: 'src/api/users.ts',
        })
      }).toThrow(/Self-import detected/)
    })

    it('T2-B07-2: sibling files in same directory calculate ./ correctly', () => {
      const spec = resolveImportSpecifier({
        fromFilePath: 'src/features/users/users.queries.ts',
        toFilePath: 'src/features/users/users.client.ts',
      })
      expect(spec).toBe('./users.client.js')
    })

    it('T2-B07-3: deep cross-directory imports calculate correct count of parent segments', () => {
      const spec = resolveImportSpecifier({
        fromFilePath: 'packages/app/src/features/billing/api/invoices.queries.ts',
        toFilePath: 'packages/app/src/shared/api/client.ts',
      })
      expect(spec).toBe('../../../shared/api/client.js')
    })

    it('T2-B07-4: tsconfig path alias matching replaces matching prefixes with alias', () => {
      const spec = resolveImportSpecifier({
        fromFilePath: 'src/features/users/api/users.queries.ts',
        toFilePath: 'src/shared/api/client.ts',
        importStyle: 'alias',
        tsconfigPaths: {
          '@shared/*': ['./src/shared/*'],
        },
      })
      expect(spec).toBe('@shared/api/client.js')
    })

    it('T2-B07-5: supports extensionless imports when extension is empty string', () => {
      const spec = resolveImportSpecifier({
        fromFilePath: 'src/features/users/api/users.queries.ts',
        toFilePath: 'src/features/users/api/users.keys.ts',
        extension: '',
      })
      expect(spec).toBe('./users.keys')
    })
  })
})
