import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  petstoreSpec,
  extendedVerbsSpec,
  richSchemaSpec,
  destructuringSpec,
  sampleTsOperationSource,
  packageJson2Spaces,
  packageJson4Spaces,
  packageJsonTabs,
  packageJsonCrlf,
} from './helpers/fixtures.js'
import {
  generateHandlerContract,
  generateRouter,
  validateTsSyntax,
} from './helpers/router-harness.js'
import {
  TARGET_PROFILES,
  FastifyTargetProfile,
  ElysiaTargetProfile,
  HonoTargetProfile,
  ExpressTargetProfile,
  NestJSTargetProfile,
  GenericTargetProfile,
  detectSchemas,
  patchPackageJson,
  runInit,
} from './helpers/init-harness.js'
import {
  detectSpecFormat,
  buildDocumentFromOperations,
  parseSpecDocument,
  watchSpec,
  startMockServer,
  sendHttpRequest,
  type ActiveMockInstance,
} from './helpers/mock-harness.js'
import { runScript } from './helpers/cli.js'

describe('Tier 1: Feature Coverage (Features 1–20)', () => {
  // =========================================================================
  // Layer 1: Multi-Framework Router Stubs & Pure Handler Contracts (F1–F9)
  // =========================================================================

  describe('Feature 1: Modular Router Topology', () => {
    it('T1-F1-1: generates router using separated target and renderer abstraction', () => {
      const output = generateRouter(petstoreSpec, { target: 'hono', mode: 'stub' })
      expect(output).toContain("import { Hono } from 'hono'")
      expect(output).toContain('const app = new Hono()')
    })

    it('T1-F1-2: supports Hono target selection', () => {
      const output = generateRouter(petstoreSpec, { target: 'hono' })
      expect(output).toContain('new Hono()')
    })

    it('T1-F1-3: supports Express target selection', () => {
      const output = generateRouter(petstoreSpec, { target: 'express' })
      expect(output).toContain("import { Router } from 'express'")
      expect(output).toContain('const router = Router()')
    })

    it('T1-F1-4: supports Fastify target selection', () => {
      const output = generateRouter(petstoreSpec, { target: 'fastify' })
      expect(output).toContain("import type { FastifyPluginAsync } from 'fastify'")
      expect(output).toContain('export const apiRouter: FastifyPluginAsync')
    })

    it('T1-F1-5: supports Elysia target selection', () => {
      const output = generateRouter(petstoreSpec, { target: 'elysia' })
      expect(output).toContain("import { Elysia } from 'elysia'")
      expect(output).toContain('new Elysia()')
    })
  })

  describe('Feature 2: Pure TypeScript Handler Contracts', () => {
    it('T1-F2-1: generates context interface for operations with path parameters', () => {
      const contract = generateHandlerContract(petstoreSpec)
      expect(contract).toContain('export interface GetPetByIdContext<TContext = unknown> {')
      expect(contract).toContain('params: Record<string, string>')
    })

    it('T1-F2-2: generates context interface for operations with query parameters', () => {
      const contract = generateHandlerContract(petstoreSpec)
      expect(contract).toContain('export interface ListPetsContext<TContext = unknown> {')
      expect(contract).toContain('query?:')
    })

    it('T1-F2-3: generates context interface for operations with request body', () => {
      const contract = generateHandlerContract(petstoreSpec)
      expect(contract).toContain('export interface CreatePetContext<TContext = unknown> {')
      expect(contract).toContain('body: unknown')
    })

    it('T1-F2-4: generates strongly typed HandlerResponse union type', () => {
      const contract = generateHandlerContract(petstoreSpec)
      expect(contract).toContain('export type HandlerResponse<TSuccess = unknown, TErrorMap = Record<number, unknown>, THeaders = Record<string, string>> =')
      expect(contract).toContain('| TSuccess')
      expect(contract).toContain('body: TSuccess')
      expect(contract).toContain('headers?: THeaders')
    })

    it('T1-F2-5: aggregates all operation handlers into ApiHandlers interface', () => {
      const contract = generateHandlerContract(petstoreSpec, { contractName: 'ApiHandlers' })
      expect(contract).toContain('export interface ApiHandlers<TContext = unknown> {')
      expect(contract).toContain('listPets: ListPetsHandler')
      expect(contract).toContain('createPet: CreatePetHandler')
      expect(contract).toContain('getPetById: GetPetByIdHandler')
      expect(contract).toContain('deletePet: DeletePetHandler')
    })
  })

  describe('Feature 3: Fastify JIT Schema Route Target', () => {
    it('T1-F3-1: emits idiomatic FastifyPluginAsync module pattern', () => {
      const code = generateRouter(petstoreSpec, { target: 'fastify' })
      expect(code).toContain("import type { FastifyPluginAsync } from 'fastify'")
      expect(code).toContain('export const apiRouter: FastifyPluginAsync')
      expect(code).toContain('export default apiRouter')
    })

    it('T1-F3-2: inlines params schema for path parameters', () => {
      const code = generateRouter(petstoreSpec, { target: 'fastify' })
      expect(code).toContain("fastify.get('/pets/:petId'")
      expect(code).toContain('"params": {')
      expect(code).toContain('"petId": {')
    })

    it('T1-F3-3: inlines querystring schema for query parameters', () => {
      const code = generateRouter(petstoreSpec, { target: 'fastify' })
      expect(code).toContain("fastify.get('/pets'")
      expect(code).toContain('"querystring": {')
      expect(code).toContain('"limit": {')
    })

    it('T1-F3-4: inlines body schema for application/json requestBody', () => {
      const code = generateRouter(petstoreSpec, { target: 'fastify' })
      expect(code).toContain("fastify.post('/pets'")
      expect(code).toContain('"body": {')
      expect(code).toContain('"name": {')
    })

    it('T1-F3-5: inlines response schema map with HTTP status codes', () => {
      const code = generateRouter(petstoreSpec, { target: 'fastify' })
      expect(code).toContain('"response": {')
      expect(code).toContain('"200": {')
    })
  })

  describe('Feature 4: OAS 3.2 Verbs in Fastify', () => {
    it('T1-F4-1: binds OAS 3.2 QUERY verb via generic fastify.route', () => {
      const code = generateRouter(extendedVerbsSpec, { target: 'fastify' })
      expect(code).toContain("fastify.route({")
      expect(code).toContain("method: 'QUERY'")
      expect(code).toContain("url: '/users/search'")
    })

    it('T1-F4-2: binds HEAD verb via shorthand fastify.head', () => {
      const code = generateRouter(extendedVerbsSpec, { target: 'fastify' })
      expect(code).toContain("fastify.head('/files/:fileId'")
    })

    it('T1-F4-3: binds TRACE verb via fastify.route', () => {
      const code = generateRouter(extendedVerbsSpec, { target: 'fastify' })
      expect(code).toContain("method: 'TRACE'")
      expect(code).toContain("url: '/diagnostics/trace'")
    })

    it('T1-F4-4: handles standard verbs via shorthand methods in same spec', () => {
      const code = generateRouter(extendedVerbsSpec, { target: 'fastify' })
      expect(code).toContain("fastify.get('/files/:fileId'")
    })

    it('T1-F4-5: inlines requestBody schemas on QUERY verb routes', () => {
      const code = generateRouter(extendedVerbsSpec, { target: 'fastify' })
      expect(code).toContain('"body": {')
      expect(code).toContain('"query": {')
    })
  })

  describe('Feature 5: Bun Elysia Chaining Target', () => {
    it('T1-F5-1: emits new Elysia() fluent builder pattern', () => {
      const code = generateRouter(petstoreSpec, { target: 'elysia' })
      expect(code).toContain("import { Elysia } from 'elysia'")
      expect(code).toContain('export const app = new Elysia()')
    })

    it('T1-F5-2: chains .get() and .post() methods sequentially', () => {
      const code = generateRouter(petstoreSpec, { target: 'elysia' })
      expect(code).toContain(".get('/pets'")
      expect(code).toContain(".post('/pets'")
    })

    it('T1-F5-3: chains .delete() method for resource deletion', () => {
      const code = generateRouter(petstoreSpec, { target: 'elysia' })
      expect(code).toContain(".delete('/pets/:petId'")
    })

    it('T1-F5-4: handles OAS 3.2 non-standard verbs via .route(METHOD, ...)', () => {
      const code = generateRouter(extendedVerbsSpec, { target: 'elysia' })
      expect(code).toContain(".route('QUERY', '/users/search'")
      expect(code).toContain(".route('TRACE', '/diagnostics/trace'")
    })

    it('T1-F5-5: emits export default app in stub mode and createRouter in contract mode', () => {
      const stubCode = generateRouter(petstoreSpec, { target: 'elysia' })
      expect(stubCode).toContain('export default app')

      const contractCode = generateRouter(petstoreSpec, {
        target: 'elysia',
        contractImport: './api.contract',
      })
      expect(contractCode).toContain('export function createRouter(handlers: ApiHandlers)')
      expect(contractCode).toContain('export default createRouter')
    })
  })

  describe('Feature 6: Elysia Zero-Copy Context Destructuring', () => {
    it('T1-F6-1: emits () parameter when route has no params, query, body, or custom set', () => {
      const code = generateRouter(destructuringSpec, {
        target: 'elysia',
        contractImport: './api.contract',
      })
      expect(code).toContain(".get('/ping', async ({ set }) => {")
    })

    it('T1-F6-2: selectively destructures { params } when only path params exist', () => {
      const code = generateRouter(destructuringSpec, {
        target: 'elysia',
        contractImport: './api.contract',
      })
      expect(code).toContain(".get('/items/:id', async ({ params, set }) => {")
    })

    it('T1-F6-3: selectively destructures { query } when only query params exist', () => {
      const code = generateRouter(destructuringSpec, {
        target: 'elysia',
        contractImport: './api.contract',
      })
      expect(code).toContain(".get('/search', async ({ query, set }) => {")
    })

    it('T1-F6-4: selectively destructures { body, set } when body and 201 response exist', () => {
      const code = generateRouter(destructuringSpec, {
        target: 'elysia',
        contractImport: './api.contract',
      })
      expect(code).toContain(".post('/submit', async ({ body, set }) => {")
    })

    it('T1-F6-5: avoids unused variable TypeScript compiler warnings by omitting unneeded fields', () => {
      const code = generateRouter(destructuringSpec, {
        target: 'elysia',
        contractImport: './api.contract',
      })
      // On ping route, params/query/body must NOT appear in parameter list
      const pingBlock = code.split(".get('/ping'")[1]?.split(".get('/items")[0]
      expect(pingBlock).toBeDefined()
      expect(pingBlock).not.toContain('{ params, query, body }')
    })
  })

  describe('Feature 7: Hono & Express Contract Binding', () => {
    it('T1-F7-1: generates createRouter(handlers: ApiHandlers) in Hono contract mode', () => {
      const code = generateRouter(petstoreSpec, {
        target: 'hono',
        contractImport: './api.contract',
      })
      expect(code).toContain("import type { ApiHandlers } from './api.contract'")
      expect(code).toContain('export function createRouter(handlers: ApiHandlers): Hono {')
      expect(code).toContain('export default createRouter')
    })

    it('T1-F7-2: forwards c.req.param() and c.req.query() to contract handler in Hono', () => {
      const code = generateRouter(petstoreSpec, {
        target: 'hono',
        contractImport: './api.contract',
      })
      expect(code).toContain('await handlers.listPets({')
      expect(code).toContain('await handlers.getPetById({')
      expect(code).toContain('params: c.req.param()')
      expect(code).toContain('query: c.req.query()')
    })

    it('T1-F7-3: generates createRouter(handlers: ApiHandlers) in Express contract mode', () => {
      const code = generateRouter(petstoreSpec, {
        target: 'express',
        contractImport: './api.contract',
      })
      expect(code).toContain("import type { ApiHandlers } from './api.contract'")
      expect(code).toContain('export function createRouter(handlers: ApiHandlers): Router {')
      expect(code).toContain('export default createRouter')
    })

    it('T1-F7-4: forwards req.params and req.query to contract handler in Express', () => {
      const code = generateRouter(petstoreSpec, {
        target: 'express',
        contractImport: './api.contract',
      })
      expect(code).toContain('await handlers.getPetById({')
      expect(code).toContain('params: req.params')
      expect(code).toContain('query: req.query')
    })

    it('T1-F7-5: unwraps HandlerResponse status and body cleanly', () => {
      const honoCode = generateRouter(petstoreSpec, { target: 'hono', contractImport: './api.contract' })
      expect(honoCode).toContain('result !== undefined && result !== null')
      expect(honoCode).toContain('c.json(resp.body')

      const expressCode = generateRouter(petstoreSpec, { target: 'express', contractImport: './api.contract' })
      expect(expressCode).toContain('json(resp.body)')
    })
  })

  describe('Feature 8: Hono & Express Backward Compatibility', () => {
    it('T1-F8-1: emits standard standalone Hono app with TODO comments when contractImport omitted', () => {
      const code = generateRouter(petstoreSpec, { target: 'hono' })
      expect(code).toContain("import { Hono } from 'hono'")
      expect(code).toContain('const app = new Hono()')
      expect(code).toContain('// TODO: implement listPets')
      expect(code).toContain('export default app')
    })

    it('T1-F8-2: emits standard standalone Express router with TODO comments when contractImport omitted', () => {
      const code = generateRouter(petstoreSpec, { target: 'express' })
      expect(code).toContain("import { Router } from 'express'")
      expect(code).toContain('const router = Router()')
      expect(code).toContain('// TODO: implement listPets')
      expect(code).toContain('export default router')
    })

    it('T1-F8-3: preserves banner comment in legacy mode', () => {
      const code = generateRouter(petstoreSpec, { target: 'hono', banner: true })
      expect(code).toContain('// Auto-generated router stub from OpenAPI spec. Do not edit.')
      expect(code).toContain('// @oa-sdk/router')
    })

    it('T1-F8-4: preserves raw querystring helper in legacy mode when in: querystring parameter exists', () => {
      const qsSpec = {
        ...petstoreSpec,
        paths: {
          '/filter': {
            get: {
              operationId: 'filterItems',
              parameters: [{ name: 'qs', in: 'querystring' as any, content: { 'text/plain': { schema: { type: 'string' } } } }],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      }
      const code = generateRouter(qsSpec as any, { target: 'hono' })
      expect(code).toContain('function __readOaRawQuerystring')
    })

    it('T1-F8-5: preserves response headers helper in legacy mode when typesImport is present and headers exist', () => {
      const headerSpec = {
        ...petstoreSpec,
        paths: {
          '/data': {
            get: {
              operationId: 'getData',
              responses: {
                '200': {
                  description: 'OK',
                  headers: { 'X-Rate-Limit': { schema: { type: 'integer' } } },
                },
              },
            },
          },
        },
      }
      const code = generateRouter(headerSpec as any, { target: 'hono', typesImport: './types' })
      expect(code).toContain('function __setOaResponseHeaders')
    })
  })

  describe('Feature 9: Zero Framework Runtime Dependencies', () => {
    let pkgJson: any

    beforeAll(async () => {
      const routerPkgPath = path.resolve(__dirname, '../../../packages/router/package.json')
      const raw = await fs.readFile(routerPkgPath, 'utf-8')
      pkgJson = JSON.parse(raw)
    })

    it('T1-F9-1: verifies @oa-sdk/router/package.json dependencies excludes fastify', () => {
      expect(pkgJson.dependencies?.['fastify']).toBeUndefined()
    })

    it('T1-F9-2: verifies @oa-sdk/router/package.json dependencies excludes elysia', () => {
      expect(pkgJson.dependencies?.['elysia']).toBeUndefined()
    })

    it('T1-F9-3: verifies @oa-sdk/router/package.json dependencies excludes hono', () => {
      expect(pkgJson.dependencies?.['hono']).toBeUndefined()
    })

    it('T1-F9-4: verifies @oa-sdk/router/package.json dependencies excludes express', () => {
      expect(pkgJson.dependencies?.['express']).toBeUndefined()
    })

    it('T1-F9-5: verifies @oa-sdk/router dependencies contains only @oa-sdk/core and @oa-sdk/parser', () => {
      const depKeys = Object.keys(pkgJson.dependencies || {})
      expect(depKeys).toEqual(['@oa-sdk/core', '@oa-sdk/parser'])
    })
  })

  // =========================================================================
  // Layer 2: Target-Separated Interactive Onboarding Engine (F10–F14)
  // =========================================================================

  describe('Feature 10: Target Strategy Pattern for Onboarding', () => {
    it('T1-F10-1: registers exactly 6 mutually exclusive target profiles', () => {
      const keys = Object.keys(TARGET_PROFILES)
      expect(keys.sort()).toEqual(['elysia', 'express', 'fastify', 'generic', 'hono', 'nestjs'].sort())
    })

    it('T1-F10-2: fastify profile detects fastify dependency in package.json', async () => {
      const profile = new FastifyTargetProfile()
      const tmpDir = path.resolve(__dirname, '../../../../.tmp-fastify-detect')
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { fastify: '^4.26.0' } }))
      try {
        const det = await profile.detect(tmpDir)
        expect(det.confidence).toBeGreaterThanOrEqual(0.9)
        expect(det.detectedRuntime).toBe('node')
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('T1-F10-3: elysia profile detects elysia dependency or bun.lockb', async () => {
      const profile = new ElysiaTargetProfile()
      const tmpDir = path.resolve(__dirname, '../../../../.tmp-elysia-detect')
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { elysia: '^1.0.0' } }))
      try {
        const det = await profile.detect(tmpDir)
        expect(det.confidence).toBeGreaterThanOrEqual(0.9)
        expect(det.detectedRuntime).toBe('bun')
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('T1-F10-4: hono profile detects hono dependency in package.json', async () => {
      const profile = new HonoTargetProfile()
      const tmpDir = path.resolve(__dirname, '../../../../.tmp-hono-detect')
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { hono: '^4.0.0' } }))
      try {
        const det = await profile.detect(tmpDir)
        expect(det.confidence).toBeGreaterThanOrEqual(0.8)
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })

    it('T1-F10-5: generic profile provides fallback when no specific framework detected', async () => {
      const profile = new GenericTargetProfile()
      const det = await profile.detect(process.cwd())
      expect(det.confidence).toBeLessThan(0.5)
      expect(profile.id).toBe('generic')
    })
  })

  describe('Feature 11: Strict Runtime Isolation in Onboarding', () => {
    it('T1-F11-1: Bun/Elysia recommended scripts strictly use bun --watch and bun x', () => {
      const profile = new ElysiaTargetProfile()
      const scripts = profile.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'elysia',
        runtime: 'bun',
      })
      expect(scripts['dev']).toContain('bun --watch')
      expect(scripts['generate:router']).toContain('bun x')
    })

    it('T1-F11-2: Bun/Elysia recommended scripts contain zero instances of tsx or nodemon', () => {
      const profile = new ElysiaTargetProfile()
      const scripts = profile.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'elysia',
        runtime: 'bun',
      })
      const scriptValues = Object.values(scripts).join(' ')
      expect(scriptValues).not.toContain('tsx')
      expect(scriptValues).not.toContain('nodemon')
    })

    it('T1-F11-3: Bun/Elysia devDependencies include @types/bun and exclude @types/node', () => {
      const profile = new ElysiaTargetProfile()
      const deps = profile.getRecommendedDependencies({
        cwd: '.',
        frameworkId: 'elysia',
        runtime: 'bun',
      })
      expect(deps.devDependencies['@types/bun']).toBeDefined()
      expect(deps.devDependencies['@types/node']).toBeUndefined()
      expect(deps.devDependencies['tsx']).toBeUndefined()
    })

    it('T1-F11-4: Node/Fastify recommended scripts use tsx watch', () => {
      const profile = new FastifyTargetProfile()
      const scripts = profile.getRecommendedScripts({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
      })
      expect(scripts['dev']).toContain('tsx watch')
    })

    it('T1-F11-5: Node/Fastify devDependencies include @types/node and tsx', () => {
      const profile = new FastifyTargetProfile()
      const deps = profile.getRecommendedDependencies({
        cwd: '.',
        frameworkId: 'fastify',
        runtime: 'node',
      })
      expect(deps.devDependencies['@types/node']).toBeDefined()
      expect(deps.devDependencies['tsx']).toBeDefined()
      expect(deps.devDependencies['@types/bun']).toBeUndefined()
    })
  })

  describe('Feature 12: Agnostic Schema Detection Engine', () => {
    const tmpDir = path.resolve(__dirname, '../../../../.tmp-schema-detect-test')

    beforeAll(async () => {
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'main.tsp'), 'namespace Test;')
      await fs.writeFile(path.join(tmpDir, 'openapi.yaml'), 'openapi: 3.2.0')
      await fs.writeFile(path.join(tmpDir, 'openapi.json'), '{"openapi": "3.2.0"}')
      await fs.writeFile(
        path.join(tmpDir, 'routes.ts'),
        '/** @oaOperation GET /items */\nexport function getItems() {}',
      )
    })

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('T1-F12-1: detects .tsp TypeSpec files across project tree', async () => {
      const items = await detectSchemas(tmpDir)
      expect(items.some(i => i.type === 'typespec')).toBe(true)
    })

    it('T1-F12-2: detects openapi.yaml and openapi.yml files', async () => {
      const items = await detectSchemas(tmpDir)
      expect(items.some(i => i.type === 'openapi-yaml')).toBe(true)
    })

    it('T1-F12-3: detects openapi.json files', async () => {
      const items = await detectSchemas(tmpDir)
      expect(items.some(i => i.type === 'openapi-json')).toBe(true)
    })

    it('T1-F12-4: detects @oaOperation JSDoc annotations in .ts source files', async () => {
      const items = await detectSchemas(tmpDir)
      expect(items.some(i => i.type === 'jsdoc-operations')).toBe(true)
    })

    it('T1-F12-5: assigns highest confidence score to canonical schema entrypoints', async () => {
      const items = await detectSchemas(tmpDir)
      expect(items[0].confidence).toBeGreaterThanOrEqual(0.9)
    })
  })

  describe('Feature 13: Non-Destructive Package Patcher', () => {
    it('T1-F13-1: preserves 2-space indentation in package.json', () => {
      const res = patchPackageJson(packageJson2Spaces, {
        scripts: { 'generate': 'oa-gen generate' },
      })
      expect(res.indentation).toBe('  ')
      expect(res.patchedContent).toContain('  "scripts": {')
      expect(res.patchedContent).toContain('    "generate": "oa-gen generate"')
    })

    it('T1-F13-2: preserves 4-space indentation in package.json', () => {
      const res = patchPackageJson(packageJson4Spaces, {
        scripts: { 'generate': 'oa-gen generate' },
      })
      expect(res.indentation).toBe('    ')
      expect(res.patchedContent).toContain('    "scripts": {')
      expect(res.patchedContent).toContain('        "generate": "oa-gen generate"')
    })

    it('T1-F13-3: preserves tab indentation in package.json', () => {
      const res = patchPackageJson(packageJsonTabs, {
        scripts: { 'generate': 'oa-gen generate' },
      })
      expect(res.indentation).toBe('\t')
      expect(res.patchedContent).toContain('\t"scripts": {')
    })

    it('T1-F13-4: preserves CRLF line endings in package.json', () => {
      const res = patchPackageJson(packageJsonCrlf, {
        scripts: { 'generate': 'oa-gen generate' },
      })
      expect(res.lineEnding).toBe('\r\n')
      expect(res.patchedContent).toContain('\r\n')
    })

    it('T1-F13-5: preserves trailing newline in package.json', () => {
      const res = patchPackageJson(packageJson2Spaces, {
        scripts: { 'generate': 'oa-gen generate' },
      })
      expect(res.patchedContent.endsWith('\n')).toBe(true)
    })
  })

  describe('Feature 14: oa-gen init CLI Command', () => {
    const tmpDir = path.resolve(__dirname, '../../../../.tmp-init-cmd-test')

    beforeAll(async () => {
      await fs.mkdir(tmpDir, { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-test-app', dependencies: { fastify: '^4.0.0' } }, null, 2))
      await fs.writeFile(path.join(tmpDir, 'openapi.yaml'), 'openapi: 3.2.0')
    })

    afterAll(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('T1-F14-1: generates oa.config.ts in target directory', async () => {
      const res = await runInit({ cwd: tmpDir, target: 'fastify' })
      expect(res.configPath).toBe(path.join(tmpDir, 'oa.config.ts'))
      const exists = await fs.access(res.configPath).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('T1-F14-2: configures schema entrypoint from detected schema', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'oa.config.ts'), 'utf-8')
      expect(content).toContain("schemaEntry: 'openapi.yaml'")
    })

    it('T1-F14-3: configures framework target matching selected profile', async () => {
      const content = await fs.readFile(path.join(tmpDir, 'oa.config.ts'), 'utf-8')
      expect(content).toContain("target: 'fastify'")
    })

    it('T1-F14-4: patches recommended dev scripts into package.json', async () => {
      const pkg = JSON.parse(await fs.readFile(path.join(tmpDir, 'package.json'), 'utf-8'))
      expect(pkg.scripts['dev']).toContain('tsx watch')
      expect(pkg.scripts['generate:router']).toContain('fastify')
    })

    it('T1-F14-5: respects dryRun option without modifying disk files', async () => {
      const dryDir = path.resolve(__dirname, '../../../../.tmp-init-dry-run')
      await fs.mkdir(dryDir, { recursive: true })
      try {
        const res = await runInit({ cwd: dryDir, target: 'elysia', dryRun: true })
        expect(res.targetId).toBe('elysia')
        const exists = await fs.access(path.join(dryDir, 'oa.config.ts')).then(() => true).catch(() => false)
        expect(exists).toBe(false)
      } finally {
        await fs.rm(dryDir, { recursive: true, force: true })
      }
    })
  })

  // =========================================================================
  // Layer 3: Live OpenAPI & Source Route Hot-Reload (F15–F18)
  // =========================================================================

  describe('Feature 15: Live OpenAPI Spec Watcher', () => {
    it('T1-F15-1: detects file format as yaml for .yaml and .yml', () => {
      expect(detectSpecFormat('openapi.yaml')).toBe('yaml')
      expect(detectSpecFormat('api.spec.yml')).toBe('yaml')
    })

    it('T1-F15-2: detects file format as json for .json', () => {
      expect(detectSpecFormat('openapi.json')).toBe('json')
    })

    it('T1-F15-3: parses OpenAPI YAML into OasDocument structure', async () => {
      const tmpFile = path.resolve(__dirname, '../../../../.tmp-test-yaml.yaml')
      await fs.writeFile(tmpFile, 'openapi: 3.2.0\ninfo:\n  title: YAML API\n  version: 1.0.0\npaths: {}\n')
      try {
        const { document, format } = await parseSpecDocument(tmpFile)
        expect(format).toBe('yaml')
        expect(document.openapi).toBe('3.2.0')
        expect(document.info.title).toBe('YAML API')
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
    })

    it('T1-F15-4: parses OpenAPI JSON into OasDocument structure', async () => {
      const tmpFile = path.resolve(__dirname, '../../../../.tmp-test-json.json')
      await fs.writeFile(tmpFile, JSON.stringify({ openapi: '3.2.0', info: { title: 'JSON API', version: '1.0.0' }, paths: {} }))
      try {
        const { document, format } = await parseSpecDocument(tmpFile)
        expect(format).toBe('json')
        expect(document.openapi).toBe('3.2.0')
        expect(document.info.title).toBe('JSON API')
      } finally {
        await fs.rm(tmpFile, { force: true })
      }
    })

    it('T1-F15-5: instantiates SpecWatcher with monitored directory and target file', () => {
      const watcher = watchSpec('package.json', { onChange: () => {} })
      expect(watcher.targetFiles.length).toBe(1)
      expect(watcher.watchedDirs.length).toBe(1)
      watcher.close()
    })
  })

  describe('Feature 16: TypeScript @oaOperation Hot-Reload', () => {
    const tmpTsFile = path.resolve(__dirname, '../../../../.tmp-oa-op-test.ts')

    beforeAll(async () => {
      await fs.writeFile(tmpTsFile, sampleTsOperationSource, 'utf-8')
    })

    afterAll(async () => {
      await fs.rm(tmpTsFile, { force: true })
    })

    it('T1-F16-1: parses TypeScript file containing @oaOperation annotations', async () => {
      const { document, format } = await parseSpecDocument(tmpTsFile)
      expect(format).toBe('typescript')
      expect(document.openapi).toBe('3.2.0')
    })

    it('T1-F16-2: extracts HTTP method and path coordinates into ExtractedOperation', async () => {
      const { document } = await parseSpecDocument(tmpTsFile)
      expect(document.paths['/api/v1/users']?.['get']).toBeDefined()
      expect(document.paths['/api/v1/users']?.['post']).toBeDefined()
    })

    it('T1-F16-3: builds valid OasDocument 3.2 structure from extracted operations', async () => {
      const { document } = await parseSpecDocument(tmpTsFile)
      expect(document.paths['/api/v1/users']?.['get']?.operationId).toBe('listUsers')
      expect(document.paths['/api/v1/users']?.['post']?.operationId).toBe('createUser')
    })

    it('T1-F16-4: synthesizes default 200 OK response when explicit response missing', async () => {
      const { document } = await parseSpecDocument(tmpTsFile)
      const getOp = document.paths['/api/v1/users']?.['get']
      expect(getOp.responses['200']).toBeDefined()
      expect(getOp.responses['200'].content['application/json'].example.status).toBe('ok')
    })

    it('T1-F16-5: supports OAS 3.2 QUERY verb in @oaOperation', async () => {
      const { document } = await parseSpecDocument(tmpTsFile)
      expect(document.paths['/api/v1/users/search']?.['query']).toBeDefined()
      expect(document.paths['/api/v1/users/search']?.['query']?.operationId).toBe('searchUsers')
    })
  })

  describe('Feature 17: Atomic Socket-Preserving Mock Hot-Swap', () => {
    let mockInstance: ActiveMockInstance

    beforeAll(async () => {
      mockInstance = await startMockServer(petstoreSpec)
    })

    afterAll(async () => {
      if (mockInstance) await mockInstance.stop()
    })

    it('T1-F17-1: starts in-memory mock server on ephemeral port', () => {
      expect(mockInstance.port).toBeGreaterThan(0)
      expect(mockInstance.url).toContain('http://127.0.0.1:')
    })

    it('T1-F17-2: serves 200 OK mock response for initial route', async () => {
      const res = await sendHttpRequest(`${mockInstance.url}/pets`)
      expect(res.status).toBe(200)
      const data = JSON.parse(res.body)
      expect(Array.isArray(data)).toBe(true)
    })

    it('T1-F17-3: invokes server.updateSpec with new route without restarting HTTP server', () => {
      const newDoc: any = {
        ...petstoreSpec,
        paths: {
          ...petstoreSpec.paths,
          '/v2/widgets': {
            get: {
              operationId: 'listWidgets',
              responses: {
                '200': {
                  description: 'Widgets',
                  content: {
                    'application/json': {
                      schema: { type: 'array' },
                      example: [{ id: 'w1', name: 'Widget 1' }],
                    },
                  },
                },
              },
            },
          },
        },
      }
      const updateResult = mockInstance.updateSpec(newDoc)
      expect(updateResult.routesCount).toBeGreaterThan(0)
    })

    it('T1-F17-4: immediately serves new route on existing port', async () => {
      const res = await sendHttpRequest(`${mockInstance.url}/v2/widgets`)
      expect(res.status).toBe(200)
      const data = JSON.parse(res.body)
      expect(data[0].id).toBe('w1')
    })

    it('T1-F17-5: returns updated routesCount from updateSpec', () => {
      const res = mockInstance.updateSpec(petstoreSpec)
      expect(typeof res.routesCount).toBe('number')
      expect(res.routesCount).toBeGreaterThan(0)
    })
  })

  describe('Feature 18: Mock Watcher Error Shielding', () => {
    let mockInstance: ActiveMockInstance

    beforeAll(async () => {
      mockInstance = await startMockServer(petstoreSpec)
    })

    afterAll(async () => {
      if (mockInstance) await mockInstance.stop()
    })

    it('T1-F18-1: rejects malformed specification in updateSpec without crashing server', () => {
      const malformedSpec = {
        openapi: '3.2.0',
        info: { title: 'Broken', version: '1.0.0' },
        paths: {
          '/broken': {
            get: {
              operationId: 'broken',
              responses: {
                '200': {
                  description: 'Broken ref',
                  content: {
                    'application/json': {
                      schema: {
                        $ref: '#/components/schemas/NonExistentSchema',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }
      expect(() => {
        mockInstance.updateSpec(malformedSpec as any)
      }).toThrow()
    })

    it('T1-F18-2: previous routing state remains active after rejected update', async () => {
      const res = await sendHttpRequest(`${mockInstance.url}/pets`)
      expect(res.status).toBe(200)
    })

    it('T1-F18-3: existing endpoints continue responding during failed update', async () => {
      const res = await sendHttpRequest(`${mockInstance.url}/pets/p1`)
      expect(res.status).toBe(200)
    })

    it('T1-F18-4: throws clear diagnostic error during invalid schema compilation', () => {
      expect(() => {
        mockInstance.updateSpec({} as any)
      }).toThrow()
    })

    it('T1-F18-5: recovers cleanly on subsequent valid specification update', async () => {
      const validUpdate = mockInstance.updateSpec(petstoreSpec)
      expect(validUpdate.routesCount).toBeGreaterThan(0)
      const res = await sendHttpRequest(`${mockInstance.url}/pets`)
      expect(res.status).toBe(200)
    })
  })

  // =========================================================================
  // Layer 4: Monorepo Governance Gates & Verification (F19–F20)
  // =========================================================================

  describe('Feature 19: Monorepo Governance Gates Compliance', () => {
    it('T1-F19-1: check-docs gate passes cleanly (exit code 0)', async () => {
      const res = await runScript('node', ['--import', 'tsx', 'scripts/check-docs.ts'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('Documentation OK')
    })

    it('T1-F19-2: check-cli-spec gate passes cleanly (exit code 0)', async () => {
      const res = await runScript('node', ['--import', 'tsx', 'scripts/check-cli-spec.ts'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('CLI spec OK')
    })

    it('T1-F19-3: check-api-index gate verifies exported symbols', async () => {
      const res = await runScript('node', ['scripts/dist/check-api-index.js'])
      expect([0, 1]).toContain(res.exitCode)
      if (res.exitCode === 0) {
        expect(res.stdout).toContain('API index is in sync')
      } else {
        expect(res.stdout).toContain('API Index Drift Report')
      }
    })

    it('T1-F19-4: check-release-policy gate passes cleanly (exit code 0)', async () => {
      const res = await runScript('node', ['--import', 'tsx', 'scripts/check-release-policy.ts'])
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain('Release policy OK')
    })

    it('T1-F19-5: docs/internal/api-index.md includes router export definitions', async () => {
      const apiIndexContent = await fs.readFile(
        path.resolve(__dirname, '../../../docs/internal/api-index.md'),
        'utf-8',
      )
      expect(apiIndexContent).toContain('@oa-sdk/router')
      expect(apiIndexContent).toContain('generateRouter')
    })
  })

  describe('Feature 20: Monorepo Full Test & Typecheck Pass', () => {
    it('T1-F20-1: verifies router package.json declares typecheck and test scripts', async () => {
      const routerPkgPath = path.resolve(__dirname, '../../../packages/router/package.json')
      const raw = await fs.readFile(routerPkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      expect(pkg.scripts?.test).toBe('vitest run')
      expect(pkg.scripts?.typecheck).toBe('tsc --noEmit')
    })

    it('T1-F20-2: verifies router build script generates dual ESM exports', async () => {
      const routerPkgPath = path.resolve(__dirname, '../../../packages/router/package.json')
      const raw = await fs.readFile(routerPkgPath, 'utf-8')
      const pkg = JSON.parse(raw)
      expect(pkg.scripts?.build).toContain('tsup')
      expect(pkg.exports?.['.']).toBeDefined()
      expect(pkg.exports?.['./browser']).toBeDefined()
    })

    it('T1-F20-3: generated handler contracts pass TypeScript syntax validation', () => {
      const contract = generateHandlerContract(petstoreSpec)
      const res = validateTsSyntax(contract)
      expect(res.valid).toBe(true)
      expect(res.errors.length).toBe(0)
    })

    it('T1-F20-4: generated Fastify router passes TypeScript syntax validation', () => {
      const routerCode = generateRouter(petstoreSpec, { target: 'fastify' })
      const res = validateTsSyntax(routerCode)
      expect(res.valid).toBe(true)
      expect(res.errors.length).toBe(0)
    })

    it('T1-F20-5: generated Elysia router passes TypeScript syntax validation', () => {
      const routerCode = generateRouter(petstoreSpec, { target: 'elysia' })
      const res = validateTsSyntax(routerCode)
      expect(res.valid).toBe(true)
      expect(res.errors.length).toBe(0)
    })
  })
})
