/**
 * Prove the TypeSpec-derived production OpenAPI artifact is accepted by the
 * downstream consumers named by ADR-009.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

type Args = {
  output?: string
  report?: string
  spec?: string
  keep?: boolean
  skipBuild?: boolean
}

type ParsedDocumentLike = {
  operations: Array<{ operationId?: string }>
  schemas: Record<string, unknown>
}

const root = resolve(process.cwd())
const args = parseArgs(process.argv.slice(2))
const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-downstream-'))
const restoredPath = resolve(root, args.spec ?? args.output ?? join(workspace, 'typespec-restored.openapi.yaml'))
const reportPath = resolve(root, args.report ?? join(workspace, 'typespec-bundle-report.json'))

try {
  if (!args.skipBuild) {
    await runBuildSteps()
  }

  if (!args.spec) {
    await run('pnpm', [
      'schema:typespec-check',
      '--',
      '--output',
      restoredPath,
      '--report',
      reportPath,
    ])
  }

  const spec = parseYaml(readFileSync(restoredPath, 'utf8')) as Record<string, unknown>
  const [
    parser,
    codegen,
    router,
    client,
    mockServer,
  ] = await Promise.all([
    import('../packages/parser/dist/index.js'),
    import('../packages/codegen/dist/index.js'),
    import('../packages/router/dist/index.js'),
    import('../packages/client/dist/index.js'),
    import('../packages/mock-server/dist/index.js'),
  ])

  const validation = parser.validateDocument(spec, {
    basePath: restoredPath,
    requireOpenApi32: true,
  })
  if (!validation.valid) {
    throw new Error(`parser validation failed: ${validation.summary}`)
  }

  const parsed = parser.parseDocument(spec, { basePath: restoredPath }) as ParsedDocumentLike
  if (parsed.operations.length === 0) {
    throw new Error('parser produced no operations for the TypeSpec-derived artifact')
  }

  const typegenWarnings: string[] = []
  const typegenSource = codegen.generateTypesFromSpec(spec, {
    basePath: restoredPath,
    banner: false,
    warnings: typegenWarnings,
  })
  if (typegenWarnings.length > 0) {
    throw new Error(`codegen typegen warnings: ${typegenWarnings.join('; ')}`)
  }
  assertGeneratedSource('codegen typegen', typegenSource, 'export type ')

  const honoRouterSource = router.generateRouter(spec, {
    basePath: restoredPath,
    banner: false,
    typesImport: './types',
  })
  assertGeneratedSource('router hono', honoRouterSource, 'export default app')

  const expressRouterSource = router.generateRouter(spec, {
    basePath: restoredPath,
    banner: false,
    target: 'express',
    typesImport: './types',
  })
  assertGeneratedSource('router express', expressRouterSource, 'export default router')

  const clientSource = client.generateClient(spec, {
    basePath: restoredPath,
    banner: false,
    typesImport: './types',
  })
  assertGeneratedSource('client', clientSource, 'export function createClient')
  await compileGeneratedConsumers({
    fixtureName: 'production',
    typegenSource,
    honoRouterSource,
    expressRouterSource,
    clientSource,
  })
  await compileSyntheticGeneratedConsumers({ codegen, router, client })

  const handlers = mockServer.createMswHandlers(spec)
  if (handlers.length < parsed.operations.length) {
    throw new Error(`mock-server produced too few handlers: ${handlers.length} for ${parsed.operations.length} operations`)
  }

  console.log('')
  console.log('TypeSpec downstream check')
  console.log(`  artifact: ${displayPath(restoredPath)}`)
  console.log(`  parser: ${parsed.operations.length} operations, ${Object.keys(parsed.schemas).length} schemas`)
  console.log(`  codegen: ${lineCount(typegenSource)} typegen lines, ${typegenWarnings.length} warnings`)
  console.log(`  router: ${lineCount(honoRouterSource)} hono lines, ${lineCount(expressRouterSource)} express lines, compile pass`)
  console.log(`  client: ${lineCount(clientSource)} lines, compile pass`)
  console.log('  synthetic: webhook/header generated TypeScript compile pass')
  console.log(`  mock-server: ${handlers.length} MSW handlers`)
  console.log('TypeSpec downstream check passed')
} finally {
  if (args.keep) {
    console.log(`Kept TypeSpec downstream workspace: ${workspace}`)
  } else {
    rmSync(workspace, { recursive: true, force: true })
  }
}

async function runBuildSteps(): Promise<void> {
  const packages = [
    '@oa-sdk/openapi-projection-contract',
    '@oa-sdk/core',
    '@oa-sdk/parser',
    '@oa-sdk/codegen',
    '@oa-sdk/router',
    '@oa-sdk/client',
    '@oa-sdk/mock-server',
  ]
  for (const packageName of packages) {
    await run('pnpm', ['--filter', packageName, 'build'])
  }
}

function assertGeneratedSource(label: string, source: string, requiredText: string): void {
  if (!source.includes(requiredText)) {
    throw new Error(`${label} did not include expected output marker: ${requiredText}`)
  }
}

async function compileGeneratedConsumers(input: {
  fixtureName: string
  typegenSource: string
  honoRouterSource: string
  expressRouterSource: string
  clientSource: string
}): Promise<void> {
  const generatedDir = join(workspace, 'generated-consumers', input.fixtureName)
  mkdirSync(generatedDir, { recursive: true })
  writeFileSync(join(generatedDir, 'types.ts'), input.typegenSource, 'utf8')
  writeFileSync(join(generatedDir, 'router-hono.ts'), input.honoRouterSource, 'utf8')
  writeFileSync(join(generatedDir, 'router-express.ts'), input.expressRouterSource, 'utf8')
  writeFileSync(join(generatedDir, 'client.ts'), input.clientSource, 'utf8')
  writeFileSync(join(generatedDir, 'runtime-stubs.d.ts'), [
    "declare module 'hono' {",
    '  type HonoRequest = {',
    '    param(): Record<string, string>',
    '    query(): Record<string, string>',
    '    json<T = unknown>(): Promise<T>',
    '    formData(): Promise<FormData>',
    '    parseBody(): Promise<Record<string, unknown>>',
    '    text(): Promise<string>',
    '  }',
    '  type HonoContext = {',
    '    req: HonoRequest',
    '    json(body: unknown, status?: number): unknown',
    '    body(body: unknown, status?: number): unknown',
    '    header(name: string, value: string): void',
    '  }',
    '  type HonoHandler = (c: HonoContext) => unknown',
    '  type RouteMethod = (path: string, handler: HonoHandler) => void',
    '  export class Hono {',
    '    get: RouteMethod',
    '    post: RouteMethod',
    '    put: RouteMethod',
    '    patch: RouteMethod',
    '    delete: RouteMethod',
    '    head: RouteMethod',
    '    options: RouteMethod',
    '    trace: RouteMethod',
    '  }',
    '}',
    '',
    "declare module 'express' {",
    '  type Request = {',
    '    params: Record<string, string>',
    '    query: Record<string, unknown>',
    '    body: unknown',
    '  }',
    '  type Response = {',
    '    status(code: number): Response',
    '    json(body: unknown): unknown',
    '    end(): unknown',
    '    setHeader(name: string, value: string): void',
    '  }',
    '  type ExpressHandler = (req: Request, res: Response) => unknown',
    '  type RouteMethod = (path: string, handler: ExpressHandler) => void',
    '  export function Router(): Record<string, RouteMethod>',
    '}',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(join(generatedDir, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: 'ESNext',
      moduleResolution: 'bundler',
      target: 'ES2022',
      lib: ['ES2022', 'DOM'],
      skipLibCheck: true,
    },
    include: ['*.ts', '*.d.ts'],
  }, null, 2)}\n`, 'utf8')

  await run(process.execPath, [
    resolve(root, 'node_modules/typescript/bin/tsc'),
    '--project',
    join(generatedDir, 'tsconfig.json'),
  ])
}

async function compileSyntheticGeneratedConsumers(modules: {
  codegen: { generateTypesFromSpec: (spec: Record<string, unknown>, options?: { banner?: boolean; warnings?: string[] }) => string }
  router: { generateRouter: (spec: Record<string, unknown>, options?: { banner?: boolean; typesImport?: string; target?: 'hono' | 'express' }) => string }
  client: { generateClient: (spec: Record<string, unknown>, options?: { banner?: boolean; typesImport?: string }) => string }
}): Promise<void> {
  const spec = syntheticDownstreamSpec()
  const warnings: string[] = []
  const typegenSource = modules.codegen.generateTypesFromSpec(spec, {
    banner: false,
    warnings,
  })
  if (warnings.length > 0) {
    throw new Error(`synthetic codegen typegen warnings: ${warnings.join('; ')}`)
  }
  const honoRouterSource = modules.router.generateRouter(spec, {
    banner: false,
    typesImport: './types',
  })
  const expressRouterSource = modules.router.generateRouter(spec, {
    banner: false,
    target: 'express',
    typesImport: './types',
  })
  const clientSource = modules.client.generateClient(spec, {
    banner: false,
    typesImport: './types',
  })
  assertGeneratedSource('synthetic typegen', typegenSource, 'export type WidgetCreatedWebhookBody')
  assertGeneratedSource('synthetic hono router', honoRouterSource, 'WidgetCreatedWebhookBody')
  await compileGeneratedConsumers({
    fixtureName: 'synthetic',
    typegenSource,
    honoRouterSource,
    expressRouterSource,
    clientSource,
  })
}

function syntheticDownstreamSpec(): Record<string, unknown> {
  return {
    openapi: '3.2.0',
    info: { title: 'OA SDK downstream smoke fixture', version: '0.0.0' },
    paths: {
      '/widgets/{id}': {
        get: {
          operationId: 'getWidget',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'includeMeta', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: {
            '200': {
              description: 'OK',
              headers: {
                'X-Request-Id': { schema: { type: 'string' }, required: true },
              },
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                      id: { type: 'string' },
                      meta: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    webhooks: {
      widgetCreated: {
        post: {
          operationId: 'widgetCreatedWebhook',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: {
                    id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Acknowledged' },
          },
        },
      },
    },
  }
}

function lineCount(source: string): number {
  return source.trimEnd().split('\n').length
}

function displayPath(path: string): string {
  return relative(root, path)
}

function run(command: string, runArgs: string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, runArgs, {
      cwd: root,
      stdio: 'inherit',
    })
    child.on('error', rejectRun)
    child.on('close', code => {
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(new Error(`Command failed with exit code ${code}: ${command} ${runArgs.join(' ')}`))
    })
  })
}

function parseArgs(rawArgs: string[]): Args {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage()
    process.exit(0)
  }
  return {
    ...(readOption(rawArgs, '--output') ? { output: readOption(rawArgs, '--output') } : {}),
    ...(readOption(rawArgs, '--report') ? { report: readOption(rawArgs, '--report') } : {}),
    ...(readOption(rawArgs, '--spec') ? { spec: readOption(rawArgs, '--spec') } : {}),
    keep: rawArgs.includes('--keep'),
    skipBuild: rawArgs.includes('--skip-build'),
  }
}

function readOption(rawArgs: string[], name: string): string | undefined {
  const index = rawArgs.indexOf(name)
  if (index === -1) return undefined
  const value = rawArgs[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function printUsage(): void {
  console.error(`Usage:
  pnpm schema:downstream-check [-- --output <path>] [--report <path>] [--spec <path>] [--keep] [--skip-build]

Options:
  --output <path>     Write the TypeSpec-restored OpenAPI artifact used by downstream checks.
  --report <path>     Write the underlying TypeSpec bundle-check report.
  --spec <path>       Use an existing OpenAPI artifact instead of generating one from the TypeSpec bundle.
  --keep              Keep the temporary downstream workspace.
  --skip-build        Skip package builds before importing public package exports.
`)
}
