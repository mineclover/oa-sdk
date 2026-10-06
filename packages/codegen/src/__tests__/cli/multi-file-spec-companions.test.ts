import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseDocument, type OasDocument } from '@oa-sdk/parser'
import { generate } from '../../cli/commands/generate.js'
import { generateTanstackCommand } from '../../cli/commands/generate-tanstack.js'
import { mock, type MockCommandContext } from '../../cli/commands/mock.js'
import { importCompanion } from '../../cli/lib/companion-packages.js'
import { CliExitError } from '../../cli/lib/errors.js'

/**
 * A spec that spans several files reaches the companion generators (router,
 * client, mock-server) with the `$ref`s to the other files resolved from the
 * spec file, in `oa-gen generate`, `oa-gen generate:tanstack` and
 * `oa-gen mock`. A `$ref` that still cannot be resolved fails an output the
 * configuration turns on explicitly, naming the reference.
 */

/** The API of the specs below, in three files: a response schema and a path item, which refers back to the schemas, live in other files. */
const MULTI_FILE_SPEC: Record<string, string> = {
  'api/contract.yaml': `openapi: 3.2.0
info: { title: Multi-file API, version: 1.0.0 }
paths:
  /health:
    get:
      operationId: getHealth
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: './schemas.yaml#/Health' }
  /users/{id}:
    $ref: './paths/user.yaml'
    parameters:
      - { name: id, in: path, required: true, schema: { type: string } }
`,
  'api/schemas.yaml': `Health:
  type: object
  required: [ok]
  properties:
    ok: { type: boolean }
User:
  type: object
  required: [id]
  properties:
    id: { type: string }
`,
  'api/paths/user.yaml': `get:
  operationId: getUser
  responses:
    '200':
      description: OK
      content:
        application/json:
          schema: { $ref: '../schemas.yaml#/User' }
delete:
  operationId: deleteUser
  responses:
    '204': { description: Deleted }
`,
}

/** The API of MULTI_FILE_SPEC written in one file. */
const SINGLE_FILE_SPEC: Record<string, string> = {
  'api/contract.yaml': `openapi: 3.2.0
info: { title: Multi-file API, version: 1.0.0 }
paths:
  /health:
    get:
      operationId: getHealth
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties:
                  ok: { type: boolean }
  /users/{id}:
    get:
      operationId: getUser
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [id]
                properties:
                  id: { type: string }
    delete:
      operationId: deleteUser
      responses:
        '204': { description: Deleted }
    parameters:
      - { name: id, in: path, required: true, schema: { type: string } }
`,
}

/** Turns on handler contracts and the client SDK explicitly, so that failing to generate them fails the run. */
const EXPLICIT_CONFIG = JSON.stringify({
  rootDir: '.',
  specs: [{ id: 'contract', profile: 'full-api-document', schemaEntry: './api/contract.yaml', outDir: './generated' }],
  core: { contracts: { pureHandlers: true }, client: { enabled: true } },
})

const COMPANION_OUTPUTS = ['contract.contract.ts', 'contract.client.ts', 'contract.queries.ts'] as const

describe('companion outputs of a spec that spans several files', () => {
  let tmpDir: string
  let errors: string[]
  let warnings: string[]

  const project = (name: string, files: Record<string, string>): string => {
    const root = path.join(tmpDir, name)
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      fs.writeFileSync(path.join(root, file), content)
    }
    return root
  }

  const runGenerate = (root: string) => generate.run({}, { cwd: root, projectRoot: root })

  const generated = (root: string, file: string) => fs.readFileSync(path.join(root, 'generated', file), 'utf8')

  const failureOf = (run: Promise<void>) => run.then(() => undefined, (error: unknown) => error)

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-multi-file-spec-'))
    errors = []
    warnings = []
    const capture = (sink: string[]) => (...parts: unknown[]) => { sink.push(parts.map(String).join(' ')) }
    vi.spyOn(console, 'error').mockImplementation(capture(errors))
    vi.spyOn(console, 'warn').mockImplementation(capture(warnings))
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('oa-gen generate', () => {
    it('generates the explicitly requested outputs as for the same spec written in one file', async () => {
      const multiFile = project('multi-file', { ...MULTI_FILE_SPEC, 'oa.config.json': EXPLICIT_CONFIG })
      const singleFile = project('single-file', { ...SINGLE_FILE_SPEC, 'oa.config.json': EXPLICIT_CONFIG })

      await runGenerate(multiFile)
      await runGenerate(singleFile)

      expect(errors).toEqual([])
      expect(warnings).toEqual([])
      for (const output of COMPANION_OUTPUTS) {
        expect(generated(multiFile, output), output).toBe(generated(singleFile, output))
      }
      const contract = generated(multiFile, 'contract.contract.ts')
      expect(contract).toContain('getHealth: GetHealthHandler<TContext>')
      expect(contract).toContain('getUser: GetUserHandler<TContext>')
      expect(contract).toContain('deleteUser: DeleteUserHandler<TContext>')
    })

    it('generates a handler contract and a client SDK that compile', async () => {
      const root = project('multi-file', { ...MULTI_FILE_SPEC, 'oa.config.json': EXPLICIT_CONFIG })

      await runGenerate(root)

      const files = ['contract.contract.ts', 'contract.client.ts'].map(file => path.join(root, 'generated', file))
      const program = ts.createProgram(files, {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
        types: [],
        skipLibCheck: true,
      })
      const diagnostics = ts.getPreEmitDiagnostics(program)
        .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      expect(diagnostics).toEqual([])
    })

    it('generates a schema that recurses through other files', async () => {
      const root = project('recursive', {
        'api/contract.yaml': `openapi: 3.2.0
info: { title: Tree API, version: 1.0.0 }
paths:
  /tree:
    get:
      operationId: getTree
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: './tree.yaml#/Tree' } } } }
`,
        'api/tree.yaml': `Tree:
  type: object
  required: [name]
  properties:
    name: { type: string }
    children: { $ref: './forest.yaml#/Forest' }
`,
        'api/forest.yaml': `Forest:
  type: array
  items: { $ref: './tree.yaml#/Tree' }
`,
        'oa.config.json': EXPLICIT_CONFIG,
      })

      await runGenerate(root)

      expect(errors).toEqual([])
      expect(generated(root, 'contract.contract.ts')).toContain('getTree: GetTreeHandler<TContext>')
      expect(generated(root, 'contract.client.ts')).toContain('getTree')
    })

    it('fails an explicitly requested output on a $ref to a file that does not exist, writing nothing', async () => {
      const root = project('missing-file', {
        ...MULTI_FILE_SPEC,
        'api/contract.yaml': MULTI_FILE_SPEC['api/contract.yaml']!.replace('./schemas.yaml#/Health', './missing.yaml#/Health'),
        'oa.config.json': EXPLICIT_CONFIG,
      })

      const failure = await failureOf(runGenerate(root))

      expect(failure).toBeInstanceOf(CliExitError)
      expect((failure as CliExitError).exitCode).toBe(1)
      const message = errors.join('\n')
      expect(message).toContain(
        'Failed to generate handler contracts via @oa-sdk/router: @oa-sdk/router generateHandlerContract requires complete $ref resolution; ' +
          'received a partial ParsedDocument: external-ref-read-failed (./missing.yaml#/Health).',
      )
      expect(message).toContain('requested by core.contracts.pureHandlers: true')
      expect(message).toContain(
        'Failed to generate client SDK via @oa-sdk/client: @oa-sdk/client generateClient requires complete $ref resolution; ' +
          'received a partial ParsedDocument: external-ref-read-failed (./missing.yaml#/Health).',
      )
      expect(fs.existsSync(path.join(root, 'generated'))).toBe(false)
      expect(fs.existsSync(path.join(root, '.oa-manifest.json'))).toBe(false)
    })

    it('fails an explicitly requested output on $refs that only refer to each other across files', async () => {
      const root = project('alias-cycle', {
        'api/contract.yaml': `openapi: 3.2.0
info: { title: Cycle API, version: 1.0.0 }
paths:
  /loop:
    get:
      operationId: getLoop
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: './a.yaml#/A' } } } }
`,
        'api/a.yaml': "A: { $ref: './b.yaml#/B' }\n",
        'api/b.yaml': "B: { $ref: './a.yaml#/A' }\n",
        'oa.config.json': EXPLICIT_CONFIG,
      })

      const failure = await failureOf(runGenerate(root))

      expect(failure).toBeInstanceOf(CliExitError)
      expect(errors.join('\n')).toContain(
        '@oa-sdk/router generateHandlerContract requires complete $ref resolution; received a partial ParsedDocument: ref-cycle (./a.yaml#/A).',
      )
      expect(fs.existsSync(path.join(root, 'generated'))).toBe(false)
    })

    it('generates the outputs of a spec in one file from the document parsed without a base path', async () => {
      // The outputs before external $refs were resolved: the companions given the projected
      // document as parsed then. A spec in one file has nothing a base path changes.
      const root = project('single-file', {
        'api/contract.yaml': `openapi: 3.1.0
info: { title: Single-file API, version: 1.0.0 }
paths:
  /nodes/{id}:
    parameters:
      - $ref: '#/components/parameters/NodeId'
    get:
      operationId: getNode
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Node' } } } }
components:
  parameters:
    NodeId: { name: id, in: path, required: true, schema: { type: string } }
  schemas:
    Node:
      type: object
      required: [id]
      properties:
        id: { type: string }
        children: { type: array, items: { $ref: '#/components/schemas/Node' } }
`,
        'oa.config.json': EXPLICIT_CONFIG,
      })

      await runGenerate(root)

      const projected = parseDocument(JSON.parse(generated(root, 'contract.openapi.json')) as OasDocument)
      expect(projected.resolution?.status).toBe('complete')
      const router = await importCompanion('@oa-sdk/router')
      const client = await importCompanion('@oa-sdk/client')
      expect(generated(root, 'contract.contract.ts'))
        .toBe(router.generateHandlerContract(projected, { contractName: 'ApiHandlers', banner: true }))
      expect(generated(root, 'contract.client.ts')).toBe(client.generateClient(projected, { banner: true }))
      expect(generated(root, 'contract.queries.ts')).toBe(client.generateTanstackQuery(projected, {
        queryPackage: '@tanstack/react-query',
        includeHooks: true,
        clientImport: './contract.client.js',
      }).combinedCode)
    })
  })

  describe('oa-gen generate:tanstack', () => {
    it('generates the TanStack Query options of the same spec written in one file', async () => {
      const multiFile = project('multi-file', MULTI_FILE_SPEC)
      const singleFile = project('single-file', SINGLE_FILE_SPEC)

      for (const root of [multiFile, singleFile]) {
        await generateTanstackCommand.run(
          { spec: 'api/contract.yaml', output: 'tanstack.ts' },
          { cwd: root, projectRoot: root },
        )
      }

      const multiFileOptions = fs.readFileSync(path.join(multiFile, 'tanstack.ts'), 'utf8')
      expect(multiFileOptions).toBe(fs.readFileSync(path.join(singleFile, 'tanstack.ts'), 'utf8'))
      expect(multiFileOptions).toContain('export function getUserQueryOptions')
      expect(multiFileOptions).toContain('export function deleteUserMutationOptions')
    })

    it('fails on a $ref to a file that does not exist, naming it', async () => {
      const root = project('missing-file', {
        ...MULTI_FILE_SPEC,
        'api/contract.yaml': MULTI_FILE_SPEC['api/contract.yaml']!.replace('./schemas.yaml#/Health', './missing.yaml#/Health'),
      })

      await expect(generateTanstackCommand.run(
        { spec: 'api/contract.yaml', output: 'tanstack.ts' },
        { cwd: root, projectRoot: root },
      )).rejects.toThrow(
        '@oa-sdk/client generateTanstackQuery requires complete $ref resolution; received a partial ParsedDocument: external-ref-read-failed (./missing.yaml#/Health).',
      )
      expect(fs.existsSync(path.join(root, 'tanstack.ts'))).toBe(false)
    })
  })

  describe('oa-gen mock', () => {
    it('serves the operations and schemas the spec refers to in other files', async () => {
      const root = project('multi-file', MULTI_FILE_SPEC)
      const abort = new AbortController()
      const responses: Record<string, { status: number; body: unknown }> = {}
      const context: MockCommandContext = {
        cwd: root,
        projectRoot: root,
        signal: abort.signal,
        onServerReady: async (server) => {
          try {
            for (const [method, route] of [['GET', '/health'], ['GET', '/users/u1'], ['DELETE', '/users/u1']] as const) {
              const response = await fetch(`${server.url}${route}`, { method })
              const text = await response.text()
              responses[`${method} ${route}`] = { status: response.status, body: text === '' ? undefined : JSON.parse(text) }
            }
          } finally {
            abort.abort()
          }
        },
      }

      await mock.run({ spec: path.join(root, 'api/contract.yaml'), port: '0' }, context)

      expect(responses['GET /health']?.status).toBe(200)
      expect(typeof (responses['GET /health']?.body as { ok?: unknown } | undefined)?.ok).toBe('boolean')
      expect(responses['GET /users/u1']?.status).toBe(200)
      expect(typeof (responses['GET /users/u1']?.body as { id?: unknown } | undefined)?.id).toBe('string')
      expect(responses['DELETE /users/u1']?.status).toBe(204)
    })

    it('fails on a $ref to a file that does not exist, naming it, without starting a server', async () => {
      const root = project('missing-file', {
        ...MULTI_FILE_SPEC,
        'api/contract.yaml': MULTI_FILE_SPEC['api/contract.yaml']!.replace('./schemas.yaml#/Health', './missing.yaml#/Health'),
      })
      const onServerReady = vi.fn()
      const context: MockCommandContext = { cwd: root, projectRoot: root, onServerReady }

      await expect(mock.run({ spec: path.join(root, 'api/contract.yaml'), port: '0' }, context)).rejects.toThrow(
        '@oa-sdk/mock-server createNodeMockServer requires complete $ref resolution; received a partial ParsedDocument: external-ref-read-failed (./missing.yaml#/Health).',
      )
      expect(onServerReady).not.toHaveBeenCalled()
    })
  })
})
