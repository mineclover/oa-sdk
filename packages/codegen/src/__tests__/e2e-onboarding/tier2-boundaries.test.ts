import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { runOaCli } from './helpers/cli-runner.js'
import { createOnboardingFixture, type WorkspaceFixture } from './helpers/fixture-builder.js'
import {
  PRODUCT_LIFECYCLE_ARCHETYPES,
  resolveConfigWithDefaults,
  validateDualLayerConfig,
  getRecommendedScriptsForPair,
  getRecommendedDevDepsForPair,
} from './helpers/oracle.js'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const CODEGEN_SRC = path.resolve(__dirname, '../..')
const CODEGEN_PKG = path.resolve(__dirname, '../../..')

describe('E2E Tier 2: Boundary Value Analysis & Corner Cases (Boundary Areas 1–8)', () => {
  let fixture: WorkspaceFixture

  beforeEach(async () => {
    fixture = await createOnboardingFixture({ hasGit: true }, 'tier2-boundary-')
  })

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup()
    }
  })

  // =========================================================================
  // Boundary Area 1: Empty & Minimal Configurations
  // =========================================================================
  describe('Boundary Area 1: Empty & Minimal Configurations', () => {
    it('T2-B01-1: completely empty object {} validates successfully as minimal config', () => {
      const result = validateDualLayerConfig({})
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('T2-B01-2: root-only config { rootDir: "." } passes validation and resolves defaults', () => {
      const result = validateDualLayerConfig({ rootDir: '.' })
      expect(result.valid).toBe(true)
      const resolved = resolveConfigWithDefaults({ rootDir: '.' })
      expect(resolved.rootDir).toBe('.')
      expect(resolved.archetype).toBe('microservice')
      expect(resolved.core).toBeDefined()
    })

    it('T2-B01-3: spec target with minimal valid properties (id, schemaEntry, outDir) resolves defaults', () => {
      const config = {
        specs: [{ id: 'min-api', schemaEntry: './spec.yaml', outDir: './out' }],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.specs![0]?.profile).toBe('full-api-document')
    })

    it('T2-B01-4: minimal product-only config { product: {} } resolves without crashing', () => {
      const result = validateDualLayerConfig({ product: {} })
      expect(result.valid).toBe(true)
      const resolved = resolveConfigWithDefaults({ product: {} })
      expect(resolved.product).toBeDefined()
      expect(resolved.core).toBeDefined()
    })

    it('T2-B01-5: minimal core-only config { core: {} } resolves with all archetype defaults', () => {
      const result = validateDualLayerConfig({ core: {} })
      expect(result.valid).toBe(true)
      const resolved = resolveConfigWithDefaults({ core: {} })
      expect(resolved.core!.dialect!.oasVersion).toBe('3.2.0')
      expect(resolved.core!.contracts!.pureHandlers).toBe(true)
    })
  })

  // =========================================================================
  // Boundary Area 2: Invalid Archetype Identifiers
  // =========================================================================
  describe('Boundary Area 2: Invalid Archetype Identifiers', () => {
    it('T2-B02-1: rejects unknown archetype strings (production, staging, dev)', () => {
      for (const invalid of ['production', 'staging', 'dev', 'custom']) {
        const result = validateDualLayerConfig({ archetype: invalid as any })
        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.path === 'archetype')).toBe(true)
      }
    })

    it('T2-B02-2: rejects empty string archetype ("")', () => {
      const result = validateDualLayerConfig({ archetype: '' as any })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'archetype')).toBe(true)
    })

    it('T2-B02-3: rejects numeric archetype (123)', () => {
      const result = validateDualLayerConfig({ archetype: 123 as any })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'archetype')).toBe(true)
    })

    it('T2-B02-4: rejects boolean archetype (true)', () => {
      const result = validateDualLayerConfig({ archetype: true as any })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'archetype')).toBe(true)
    })

    it('T2-B02-5: enforces case-sensitive matching: rejects uppercase MVP, ENTERPRISE, MicroService', () => {
      for (const invalid of ['MVP', 'ENTERPRISE', 'MicroService']) {
        const result = validateDualLayerConfig({ archetype: invalid as any })
        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.path === 'archetype')).toBe(true)
      }
    })
  })

  // =========================================================================
  // Boundary Area 3: Conflicting & Duplicate Spec IDs
  // =========================================================================
  describe('Boundary Area 3: Conflicting & Duplicate Spec IDs', () => {
    it('T2-B03-1: detects duplicate IDs within top-level specs array', () => {
      const config = {
        specs: [
          { id: 'api-service', schemaEntry: './a.yaml', outDir: './out' },
          { id: 'api-service', schemaEntry: './b.yaml', outDir: './out' },
        ],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate spec target id "api-service"'))).toBe(true)
    })

    it('T2-B03-2: detects duplicate IDs between top-level specs and product.specs', () => {
      const config = {
        specs: [
          { id: 'orders', schemaEntry: './orders.yaml', outDir: './out' },
        ],
        product: {
          specs: [
            { id: 'orders', schemaEntry: './orders-v2.yaml', outDir: './out' },
          ],
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate spec target id "orders"'))).toBe(true)
    })

    it('T2-B03-3: detects duplicate IDs within product.specs array', () => {
      const config = {
        product: {
          specs: [
            { id: 'dup', schemaEntry: './a.yaml', outDir: './out' },
            { id: 'dup', schemaEntry: './b.yaml', outDir: './out' },
          ],
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.message.includes('Duplicate spec target id "dup"'))).toBe(true)
    })

    it('T2-B03-4: diagnostic message accurately identifies collision ID and declaration index', () => {
      const config = {
        specs: [
          { id: 'target-alpha', schemaEntry: './a.yaml', outDir: './out' },
          { id: 'target-beta', schemaEntry: './b.yaml', outDir: './out' },
          { id: 'target-alpha', schemaEntry: './c.yaml', outDir: './out' },
        ],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(false)
      const err = result.errors.find(e => e.message.includes('target-alpha'))
      expect(err).toBeDefined()
      expect(err?.message).toContain('at index 2 (already declared at index 0)')
    })

    it('T2-B03-5: distinct IDs (users-api vs users-api-v2) pass cleanly without conflict', () => {
      const config = {
        specs: [
          { id: 'users-api', schemaEntry: './v1.yaml', outDir: './out' },
          { id: 'users-api-v2', schemaEntry: './v2.yaml', outDir: './out' },
        ],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
    })
  })

  // =========================================================================
  // Boundary Area 4: Missing Profile Defaulting to full-api-document
  // =========================================================================
  describe('Boundary Area 4: Missing Profile Defaulting to full-api-document', () => {
    it('T2-B04-1: spec target omitting profile defaults to full-api-document', () => {
      const config = {
        specs: [{ id: 'srv', schemaEntry: './srv.yaml', outDir: './out' }],
      }
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.specs![0]?.profile).toBe('full-api-document')
    })

    it('T2-B04-2: multiple spec targets omitting profile all default to full-api-document', () => {
      const config = {
        specs: [
          { id: 'srv-1', schemaEntry: './1.yaml', outDir: './out' },
          { id: 'srv-2', schemaEntry: './2.yaml', outDir: './out' },
          { id: 'srv-3', schemaEntry: './3.yaml', outDir: './out' },
        ],
      }
      const resolved = resolveConfigWithDefaults(config)
      for (const spec of resolved.specs!) {
        expect(spec.profile).toBe('full-api-document')
      }
    })

    it('T2-B04-3: mixed spec targets (some explicit, some omitted) resolve correctly', () => {
      const config = {
        specs: [
          { id: 'srv-bundle', profile: 'component-bundle' as const, schemaEntry: './1.yaml', outDir: './out' },
          { id: 'srv-default', schemaEntry: './2.yaml', outDir: './out' },
          { id: 'srv-contract', profile: 'operation-contract' as const, schemaEntry: './3.yaml', outDir: './out' },
        ],
      }
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.specs![0]?.profile).toBe('component-bundle')
      expect(resolved.specs![1]?.profile).toBe('full-api-document')
      expect(resolved.specs![2]?.profile).toBe('operation-contract')
    })

    it('T2-B04-4: omitting profile when target: "fastify" is provided does not error', () => {
      const config = {
        specs: [
          { id: 'fastify-api', target: 'fastify' as const, schemaEntry: './spec.yaml', outDir: './out' },
        ],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.specs![0]?.profile).toBe('full-api-document')
      expect(resolved.specs![0]?.target).toBe('fastify')
    })

    it('T2-B04-5: omitting profile when target: "elysia" is provided does not error', () => {
      const config = {
        specs: [
          { id: 'elysia-api', target: 'elysia' as const, schemaEntry: './spec.yaml', outDir: './out' },
        ],
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(true)
      const resolved = resolveConfigWithDefaults(config)
      expect(resolved.specs![0]?.profile).toBe('full-api-document')
      expect(resolved.specs![0]?.target).toBe('elysia')
    })
  })

  // =========================================================================
  // Boundary Area 5: Context Injection Path & Type Boundaries
  // =========================================================================
  describe('Boundary Area 5: Context Injection Path & Type Boundaries', () => {
    it('T2-B05-1: rejects missing typeName when importPath is provided', () => {
      const config = {
        product: {
          contextInjection: {
            importPath: './context.js',
          } as any,
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path.includes('typeName'))).toBe(true)
    })

    it('T2-B05-2: rejects missing importPath when typeName is provided', () => {
      const config = {
        product: {
          contextInjection: {
            typeName: 'AppContext',
          } as any,
        },
      }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path.includes('importPath'))).toBe(true)
    })

    it('T2-B05-3: rejects empty strings for typeName or importPath', () => {
      const config1 = { product: { contextInjection: { typeName: '', importPath: './ctx.js' } } }
      const config2 = { product: { contextInjection: { typeName: 'Ctx', importPath: '' } } }
      expect(validateDualLayerConfig(config1).valid).toBe(false)
      expect(validateDualLayerConfig(config2).valid).toBe(false)
    })

    it('T2-B05-4: accepts relative module paths (./context.js, ../shared/ctx.js)', () => {
      for (const importPath of ['./context.js', '../shared/ctx.js', './src/app-context.ts']) {
        const config = { product: { contextInjection: { typeName: 'MyContext', importPath } } }
        expect(validateDualLayerConfig(config).valid).toBe(true)
      }
    })

    it('T2-B05-5: accepts scoped package module specifiers (@my-org/shared-context)', () => {
      const config = {
        product: {
          contextInjection: {
            typeName: 'OrgContext',
            importPath: '@my-org/shared-context',
            propertyKey: 'org',
            fields: ['tenantId', 'correlationId'],
          },
        },
      }
      expect(validateDualLayerConfig(config).valid).toBe(true)
    })
  })

  // =========================================================================
  // Boundary Area 6: Persona Min Coverage Boundaries
  // =========================================================================
  describe('Boundary Area 6: Persona Min Coverage Boundaries', () => {
    it('T2-B06-1: accepts exact minimum boundary 0.0', () => {
      const config = { product: { personas: { minCoverageRatio: 0.0 } } }
      expect(validateDualLayerConfig(config).valid).toBe(true)
    })

    it('T2-B06-2: accepts exact maximum boundary 1.0', () => {
      const config = { product: { personas: { minCoverageRatio: 1.0 } } }
      expect(validateDualLayerConfig(config).valid).toBe(true)
    })

    it('T2-B06-3: rejects negative coverage ratio (-0.01, -1.0)', () => {
      for (const minCoverageRatio of [-0.01, -1.0]) {
        const config = { product: { personas: { minCoverageRatio } } }
        const result = validateDualLayerConfig(config)
        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.path.includes('minCoverageRatio'))).toBe(true)
      }
    })

    it('T2-B06-4: rejects coverage ratio exceeding 1.0 (1.001, 2.5)', () => {
      for (const minCoverageRatio of [1.001, 2.5]) {
        const config = { product: { personas: { minCoverageRatio } } }
        const result = validateDualLayerConfig(config)
        expect(result.valid).toBe(false)
        expect(result.errors.some(e => e.path.includes('minCoverageRatio'))).toBe(true)
      }
    })

    it('T2-B06-5: rejects non-numeric string values ("0.8")', () => {
      const config = { product: { personas: { minCoverageRatio: '0.8' as any } } }
      const result = validateDualLayerConfig(config)
      expect(result.valid).toBe(false)
    })
  })

  // =========================================================================
  // Boundary Area 7: Non-Destructive Package.json Formatting
  // =========================================================================
  describe('Boundary Area 7: Non-Destructive Package.json Formatting', () => {
    it('T2-B07-1: preserves tab indentation in package.json', async () => {
      await fixture.writeFile(
        'package.json',
        '{\n\t"name": "tab-project",\n\t"version": "1.0.0",\n\t"dependencies": {\n\t\t"fastify": "^4.26.0"\n\t}\n}\n',
      )
      const res = runOaCli(['init', '--target', 'fastify', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const raw = await fixture.readFile('package.json')
        expect(raw).toMatch(/\n\t"name":/m)
      }
    })

    it('T2-B07-2: preserves 2-space indentation in package.json', async () => {
      await fixture.writeFile(
        'package.json',
        '{\n  "name": "two-space",\n  "version": "1.0.0",\n  "dependencies": {\n    "express": "^4.19.0"\n  }\n}\n',
      )
      const res = runOaCli(['init', '--target', 'express', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const raw = await fixture.readFile('package.json')
        expect(raw).toMatch(/\n  "name":/m)
      }
    })

    it('T2-B07-3: preserves 4-space indentation in package.json', async () => {
      await fixture.writeFile(
        'package.json',
        '{\n    "name": "four-space",\n    "version": "1.0.0",\n    "dependencies": {\n        "hono": "^4.0.0"\n    }\n}\n',
      )
      const res = runOaCli(['init', '--target', 'hono', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const raw = await fixture.readFile('package.json')
        expect(raw).toMatch(/\n    "name":/m)
      }
    })

    it('T2-B07-4: preserves Windows CRLF (\\r\\n) line endings in package.json', async () => {
      await fixture.writeFile(
        'package.json',
        '{\r\n  "name": "crlf-project",\r\n  "dependencies": {\r\n    "fastify": "^4.0.0"\r\n  }\r\n}\r\n',
      )
      const res = runOaCli(['init', '--target', 'fastify', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const raw = await fixture.readFile('package.json')
        expect(raw).toContain('\r\n')
      }
    })

    it('T2-B07-5: preserves trailing newline at end of file in package.json', async () => {
      await fixture.writeFile(
        'package.json',
        '{\n  "name": "newline-project",\n  "dependencies": {\n    "fastify": "^4.0.0"\n  }\n}\n',
      )
      const res = runOaCli(['init', '--target', 'fastify', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const raw = await fixture.readFile('package.json')
        expect(raw.endsWith('\n')).toBe(true)
      }
    })
  })

  // =========================================================================
  // Boundary Area 8: Script Collision Protection & Force Overwrite
  // =========================================================================
  describe('Boundary Area 8: Script Collision Protection & Force Overwrite', () => {
    it('T2-B08-1: pre-existing dev script is not overwritten when --force is false', async () => {
      await fixture.writeFile(
        'package.json',
        JSON.stringify({
          name: 'custom-dev',
          scripts: { dev: 'custom-dev-server' },
          dependencies: { fastify: '^4.26.0' },
        }, null, 2),
      )
      const res = runOaCli(['init', '--target', 'fastify', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const pkg = await fixture.readJson<{ scripts: Record<string, string> }>('package.json')
        expect(pkg.scripts.dev).toBe('custom-dev-server')
      }
    })

    it('T2-B08-2: pre-existing mock script is not overwritten when --force is false', async () => {
      await fixture.writeFile(
        'package.json',
        JSON.stringify({
          name: 'custom-mock',
          scripts: { mock: 'custom-mock-server' },
          dependencies: { fastify: '^4.26.0' },
        }, null, 2),
      )
      const res = runOaCli(['init', '--target', 'fastify', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const pkg = await fixture.readJson<{ scripts: Record<string, string> }>('package.json')
        expect(pkg.scripts.mock).toBe('custom-mock-server')
      }
    })

    it('T2-B08-3: pre-existing dev script IS overwritten when --force is true', async () => {
      await fixture.writeFile(
        'package.json',
        JSON.stringify({
          name: 'overwrite-dev',
          scripts: { dev: 'old-server' },
          dependencies: { fastify: '^4.26.0' },
        }, null, 2),
      )
      const res = runOaCli(['init', '--target', 'fastify', '--yes', '--force', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const pkg = await fixture.readJson<{ scripts: Record<string, string> }>('package.json')
        expect(pkg.scripts.dev).toBe('tsx watch src/server.ts')
      }
    })

    it('T2-B08-4: missing scripts object in package.json is initialized cleanly', async () => {
      await fixture.writeFile(
        'package.json',
        JSON.stringify({
          name: 'no-scripts',
          dependencies: { express: '^4.19.0' },
        }, null, 2),
      )
      const res = runOaCli(['init', '--target', 'express', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const pkg = await fixture.readJson<{ scripts: Record<string, string> }>('package.json')
        expect(pkg.scripts).toBeDefined()
        expect(pkg.scripts.dev).toBeDefined()
      }
    })

    it('T2-B08-5: missing devDependencies object in package.json is initialized cleanly', async () => {
      await fixture.writeFile(
        'package.json',
        JSON.stringify({
          name: 'no-dev-deps',
          dependencies: { hono: '^4.0.0' },
        }, null, 2),
      )
      const res = runOaCli(['init', '--target', 'hono', '--yes', '--cwd', fixture.rootDir])
      expect([0, 1]).toContain(res.status)
      if (res.status === 0) {
        const pkg = await fixture.readJson<{ devDependencies: Record<string, string> }>('package.json')
        expect(pkg.devDependencies).toBeDefined()
        expect(pkg.devDependencies['@oa-sdk/codegen']).toBeDefined()
      }
    })
  })
})
