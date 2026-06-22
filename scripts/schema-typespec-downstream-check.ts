/**
 * Prove the TypeSpec-derived production OpenAPI artifact is accepted by the
 * downstream consumers named by ADR-009.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
    import('../packages/parser/src/index.js'),
    import('../packages/codegen/src/index.js'),
    import('../packages/router/src/index.js'),
    import('../packages/client/src/index.js'),
    import('../packages/mock-server/src/index.js'),
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

  const handlers = mockServer.createMswHandlers(spec)
  if (handlers.length < parsed.operations.length) {
    throw new Error(`mock-server produced too few handlers: ${handlers.length} for ${parsed.operations.length} operations`)
  }

  console.log('')
  console.log('TypeSpec downstream check')
  console.log(`  artifact: ${displayPath(restoredPath)}`)
  console.log(`  parser: ${parsed.operations.length} operations, ${Object.keys(parsed.schemas).length} schemas`)
  console.log(`  codegen: ${lineCount(typegenSource)} typegen lines, ${typegenWarnings.length} warnings`)
  console.log(`  router: ${lineCount(honoRouterSource)} hono lines, ${lineCount(expressRouterSource)} express lines`)
  console.log(`  client: ${lineCount(clientSource)} lines`)
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
