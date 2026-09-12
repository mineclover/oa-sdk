import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  emptySpec,
  complexPathTemplateSpec,
  multiVerbSpec,
  packageJsonWithCollisions,
  sampleTsInvalidOperationSource,
  petstoreSpec,
} from './helpers/fixtures.js'
import {
  generateHandlerContract,
  generateRouter,
  validateTsSyntax,
} from './helpers/router-harness.js'
import {
  patchPackageJson,
  detectSchemas,
} from './helpers/init-harness.js'
import {
  parseSpecDocument,
  watchSpec,
  startMockServer,
  sendHttpRequest,
  type ActiveMockInstance,
} from './helpers/mock-harness.js'

describe('Tier 2: Boundary & Corner Cases', () => {
  // =========================================================================
  // Boundary Area 1: Empty & Minimal Schemas (B1)
  // =========================================================================
  describe('Boundary Area 1: Empty & Minimal Schemas', () => {
    it('T2-B1-1: handles completely empty OpenAPI spec (paths: {}) without crashing', () => {
      expect(() => {
        generateRouter(emptySpec, { target: 'hono' })
      }).not.toThrow()
    })

    it('T2-B1-2: generates empty handler contract interface when spec has zero operations', () => {
      const contract = generateHandlerContract(emptySpec)
      expect(contract).toContain('export interface ApiHandlers {')
      expect(contract).toContain('}')
      const res = validateTsSyntax(contract)
      expect(res.valid).toBe(true)
    })

    it('T2-B1-3: generates empty Fastify plugin without route registrations on empty spec', () => {
      const routerCode = generateRouter(emptySpec, { target: 'fastify' })
      expect(routerCode).toContain('export const apiRouter: FastifyPluginAsync')
      expect(routerCode).not.toContain('fastify.get')
      const res = validateTsSyntax(routerCode)
      expect(res.valid).toBe(true)
    })

    it('T2-B1-4: generates empty Elysia builder without route registrations on empty spec', () => {
      const routerCode = generateRouter(emptySpec, { target: 'elysia' })
      expect(routerCode).toContain('export const app = new Elysia()')
      expect(routerCode).not.toContain('.get(')
      const res = validateTsSyntax(routerCode)
      expect(res.valid).toBe(true)
    })

    it('T2-B1-5: schema detector discovers empty spec without throwing errors', async () => {
      const tmpDir = path.resolve(__dirname, '../../../../.tmp-empty-spec-detect')
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'empty-spec.yaml'), 'openapi: 3.2.0\ninfo:\n  title: Empty\n  version: 0.1\npaths: {}\n')
      try {
        const detected = await detectSchemas(tmpDir)
        expect(detected.some(d => d.filePath.includes('empty-spec.yaml'))).toBe(true)
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })
  })

  // =========================================================================
  // Boundary Area 2: Complex Path Templates & Encoding (B2)
  // =========================================================================
  describe('Boundary Area 2: Complex Path Templates & Encoding', () => {
    it('T2-B2-1: transforms multi-segment nested path templates to colon format', () => {
      const code = generateRouter(complexPathTemplateSpec, { target: 'hono' })
      expect(code).toContain('/orgs/:org_id/teams/:teamId/members/:user:id')
    })

    it('T2-B2-2: handles special colon parameter tokens in template variables', () => {
      const code = generateRouter(complexPathTemplateSpec, { target: 'fastify' })
      expect(code).toContain('/orgs/:org_id/teams/:teamId/members/:user:id')
    })

    it('T2-B2-3: generates typed context params object containing all path parameters', () => {
      const contract = generateHandlerContract(complexPathTemplateSpec)
      expect(contract).toContain('export interface GetNestedMemberContext<TContext = unknown> {')
      expect(contract).toContain('params: Record<string, string>')
    })

    it('T2-B2-4: Fastify JIT schema inlines all nested path params into schema.params', () => {
      const code = generateRouter(complexPathTemplateSpec, { target: 'fastify' })
      expect(code).toContain('"params": {')
      expect(code).toContain('"org_id": {')
      expect(code).toContain('"teamId": {')
      expect(code).toContain('"user:id": {')
    })

    it('T2-B2-5: Elysia selective destructuring includes params when complex path parameters present', () => {
      const code = generateRouter(complexPathTemplateSpec, {
        target: 'elysia',
        contractImport: './api.contract',
      })
      expect(code).toContain('async ({ params, set }) =>')
      expect(code).toContain('params:')
    })
  })

  // =========================================================================
  // Boundary Area 3: Multiple HTTP Verbs on Same Path (B3)
  // =========================================================================
  describe('Boundary Area 3: Multiple HTTP Verbs on Same Path', () => {
    it('T2-B3-1: binds GET, POST, PUT, DELETE, PATCH on identical path /resources/:id without collision', () => {
      const code = generateRouter(multiVerbSpec, { target: 'hono' })
      expect(code).toContain("app.get('/resources/:id'")
      expect(code).toContain("app.post('/resources/:id'")
      expect(code).toContain("app.put('/resources/:id'")
      expect(code).toContain("app.delete('/resources/:id'")
      expect(code).toContain("app.patch('/resources/:id'")
    })

    it('T2-B3-2: binds OAS 3.2 QUERY verb alongside standard CRUD verbs on same path', () => {
      const code = generateRouter(multiVerbSpec, { target: 'fastify' })
      expect(code).toContain("method: 'QUERY'")
      expect(code).toContain("url: '/resources/:id'")
    })

    it('T2-B3-3: Fastify registers shorthand for standard verbs and route() for QUERY on same path', () => {
      const code = generateRouter(multiVerbSpec, { target: 'fastify' })
      expect(code).toContain("fastify.get('/resources/:id'")
      expect(code).toContain("fastify.post('/resources/:id'")
      expect(code).toContain("fastify.route({")
    })

    it('T2-B3-4: Elysia chains multiple methods on identical path without syntax errors', () => {
      const code = generateRouter(multiVerbSpec, { target: 'elysia' })
      expect(code).toContain(".get('/resources/:id'")
      expect(code).toContain(".post('/resources/:id'")
      expect(code).toContain(".put('/resources/:id'")
      expect(code).toContain(".delete('/resources/:id'")
      expect(code).toContain(".patch('/resources/:id'")
      expect(code).toContain(".route('QUERY', '/resources/:id'")
      const res = validateTsSyntax(code)
      expect(res.valid).toBe(true)
    })

    it('T2-B3-5: Handler contract generates distinct method entries for each verb on same path', () => {
      const contract = generateHandlerContract(multiVerbSpec)
      expect(contract).toContain('getResource: GetResourceHandler')
      expect(contract).toContain('createResourceUnderId: CreateResourceUnderIdHandler')
      expect(contract).toContain('putResource: PutResourceHandler')
      expect(contract).toContain('deleteResource: DeleteResourceHandler')
      expect(contract).toContain('patchResource: PatchResourceHandler')
      expect(contract).toContain('queryResource: QueryResourceHandler')
      const res = validateTsSyntax(contract)
      expect(res.valid).toBe(true)
    })
  })

  // =========================================================================
  // Boundary Area 4: Malformed & Unconventional package.json Files (B4)
  // =========================================================================
  describe('Boundary Area 4: Malformed & Unconventional package.json Files', () => {
    it('T2-B4-1: throws descriptive error when package.json contains invalid JSON syntax', () => {
      expect(() => {
        patchPackageJson('{ invalid json format }', { scripts: { dev: 'run' } })
      }).toThrow(/Invalid package\.json syntax/)
    })

    it('T2-B4-2: handles package.json with missing scripts property by initializing it', () => {
      const raw = '{\n  "name": "no-scripts"\n}\n'
      const res = patchPackageJson(raw, { scripts: { dev: 'tsx watch src/index.ts' } })
      expect(res.modified).toBe(true)
      expect(res.patchedContent).toContain('"scripts": {')
      expect(res.patchedContent).toContain('"dev": "tsx watch src/index.ts"')
    })

    it('T2-B4-3: handles package.json with missing devDependencies property by initializing it', () => {
      const raw = '{\n  "name": "no-dev-deps"\n}\n'
      const res = patchPackageJson(raw, { devDependencies: { typescript: '^5.0.0' } })
      expect(res.modified).toBe(true)
      expect(res.patchedContent).toContain('"devDependencies": {')
      expect(res.patchedContent).toContain('"typescript": "^5.0.0"')
    })

    it('T2-B4-4: preserves unusual 8-space indentation', () => {
      const raw = '{\n        "name": "eight-spaces"\n}\n'
      const res = patchPackageJson(raw, { scripts: { start: 'node index.js' } })
      expect(res.indentation).toBe('        ')
      expect(res.patchedContent).toContain('        "scripts": {')
    })

    it('T2-B4-5: handles single-line condensed package.json without expanding unwanted keys', () => {
      const raw = '{"name":"condensed","version":"1.0.0"}'
      const res = patchPackageJson(raw, { scripts: { test: 'vitest' } })
      expect(res.modified).toBe(true)
      const parsed = JSON.parse(res.patchedContent)
      expect(parsed.name).toBe('condensed')
      expect(parsed.scripts.test).toBe('vitest')
    })
  })

  // =========================================================================
  // Boundary Area 5: Script & Dependency Collisions in Package Patcher (B5)
  // =========================================================================
  describe('Boundary Area 5: Script & Dependency Collisions in Package Patcher', () => {
    it('T2-B5-1: preserves existing dev script when collision occurs without --force', () => {
      const res = patchPackageJson(packageJsonWithCollisions, {
        scripts: { dev: 'tsx watch src/index.ts' },
        force: false,
      })
      expect(res.patchedContent).toContain('"dev": "custom-dev-server --port 3000"')
      expect(res.patchedContent).not.toContain('tsx watch')
    })

    it('T2-B5-2: records collision action as skipped with descriptive reason', () => {
      const res = patchPackageJson(packageJsonWithCollisions, {
        scripts: { dev: 'tsx watch src/index.ts' },
        force: false,
      })
      const devAction = res.scripts.find(s => s.key === 'dev')
      expect(devAction).toBeDefined()
      expect(devAction?.action).toBe('skipped')
      expect(devAction?.reason).toBe('exists without --force')
    })

    it('T2-B5-3: overwrites existing dev script when --force: true is supplied', () => {
      const res = patchPackageJson(packageJsonWithCollisions, {
        scripts: { dev: 'tsx watch src/index.ts' },
        force: true,
      })
      expect(res.patchedContent).toContain('"dev": "tsx watch src/index.ts"')
    })

    it('T2-B5-4: records collision action as updated when forced', () => {
      const res = patchPackageJson(packageJsonWithCollisions, {
        scripts: { dev: 'tsx watch src/index.ts' },
        force: true,
      })
      const devAction = res.scripts.find(s => s.key === 'dev')
      expect(devAction?.action).toBe('updated')
      expect(devAction?.reason).toBe('forced overwrite')
    })

    it('T2-B5-5: preserves existing dependency versions while adding missing ones', () => {
      const raw = JSON.stringify({
        name: 'test',
        dependencies: { fastify: '^4.20.0' },
      })
      const res = patchPackageJson(raw, {
        dependencies: { fastify: '^4.26.0', pino: '^8.0.0' },
      })
      const parsed = JSON.parse(res.patchedContent)
      expect(parsed.dependencies.fastify).toBe('^4.20.0') // preserved
      expect(parsed.dependencies.pino).toBe('^8.0.0') // added
    })
  })

  // =========================================================================
  // Boundary Area 6: Syntax & Parse Errors During Live Mock Watch (B6)
  // =========================================================================
  describe('Boundary Area 6: Syntax & Parse Errors During Live Mock Watch', () => {
    let mockInstance: ActiveMockInstance

    beforeAll(async () => {
      mockInstance = await startMockServer(petstoreSpec)
    })

    afterAll(async () => {
      if (mockInstance) await mockInstance.stop()
    })

    it('T2-B6-1: file parser throws when encountering invalid YAML syntax', async () => {
      const tmpFile = path.resolve(__dirname, '../../../../.tmp-invalid-yaml.yaml')
      await fs.writeFile(tmpFile, 'openapi: 3.2.0\npaths: [unbalanced\n')
      try {
        await expect(parseSpecDocument(tmpFile)).rejects.toThrow()
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
    })

    it('T2-B6-2: file parser throws when encountering invalid JSON syntax', async () => {
      const tmpFile = path.resolve(__dirname, '../../../../.tmp-invalid-json.json')
      await fs.writeFile(tmpFile, '{"openapi": "3.2.0", paths: }')
      try {
        await expect(parseSpecDocument(tmpFile)).rejects.toThrow()
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
    })

    it('T2-B6-3: file parser rejects broken @oaOperation annotations with validation diagnostic', async () => {
      const tmpFile = path.resolve(__dirname, '../../../../.tmp-invalid-oa-op.ts')
      await fs.writeFile(tmpFile, sampleTsInvalidOperationSource, 'utf-8')
      try {
        await expect(parseSpecDocument(tmpFile)).rejects.toThrow(/Syntax\/validation error in @oaOperation/)
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
    })

    it('T2-B6-4: mock server rejects specification with broken $ref while keeping server alive', async () => {
      const brokenSpec = {
        openapi: '3.2.0',
        info: { title: 'Broken Spec', version: '1.0.0' },
        paths: {
          '/broken': {
            get: {
              operationId: 'broken',
              responses: {
                '200': {
                  description: 'Broken Ref',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/NonExistent' } } },
                },
              },
            },
          },
        },
      }
      expect(() => {
        mockInstance.updateSpec(brokenSpec as any)
      }).toThrow()

      // Confirm mock server is still alive and responding on existing route
      const res = await sendHttpRequest(`${mockInstance.url}/pets`)
      expect(res.status).toBe(200)
    })

    it('T2-B6-5: mock server gracefully handles non-existent schema updates', () => {
      expect(() => {
        mockInstance.updateSpec(null as any)
      }).toThrow()
    })
  })
})
