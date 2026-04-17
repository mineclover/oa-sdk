/**
 * Validate that the local definition-builder parity artifact can feed the
 * same validation and downstream generation surfaces as the current merge
 * artifact.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  diffOpenApiDocuments,
  formatOpenApiDiff,
} from '../packages/codegen/src/cli/lib/openapi-normalized-diff.js'
import { downgrade } from '../packages/schemas/scripts/downgrade-3.1.js'

const CURRENT_SPEC = 'packages/schemas/src/.merged.yaml'
const BUILDER_SPEC = 'packages/schemas/src/.builder/local-parity-api.yaml'
const BUILDER_31_SPEC = 'packages/schemas/src/.builder/local-parity-api.3.1.yaml'
const BUILDER_31_META = 'packages/schemas/src/.builder/local-parity-api.3.1.meta.json'
const COMPAT_DIR = 'packages/schemas/src/.builder/compat'
const REPORT_PATH = 'packages/schemas/src/.builder/local-parity-api.compatibility.json'
const CODEGEN_CLI = 'packages/codegen/dist/cli/index.js'
const MOCK_SERVER_DIST = 'packages/mock-server/dist/index.js'

type GateStatus = 'passed'

type GateCheck = {
  name: string
  status: GateStatus
  detail?: string
}

type AcceptedDifference = {
  area: string
  status: 'accepted'
  owner: string
  rationale: string
}

type MockServerModule = {
  createMswHandlers(spec: Record<string, unknown>): unknown[]
  createNodeMockServer(spec: Record<string, unknown>, options?: Record<string, unknown>): {
    start: unknown
    stop: unknown
    url: string
  }
}

async function main(): Promise<void> {
  const checks: GateCheck[] = []
  const acceptedDifferences: AcceptedDifference[] = []

  runCommand('Build current merged schema artifact', 'pnpm', ['--filter', '@oa-sdk/schemas', 'run', 'merge'])
  checks.push({ name: 'current merge artifact built', status: 'passed', detail: CURRENT_SPEC })

  runCommand('Build local builder parity artifact', 'pnpm', ['--filter', '@oa-sdk/schemas', 'run', 'parity:build'])
  checks.push({ name: 'builder parity artifact built', status: 'passed', detail: BUILDER_SPEC })

  assertFile(CURRENT_SPEC)
  assertFile(BUILDER_SPEC)
  resetDirectory(COMPAT_DIR)

  const currentSpec = readOpenApi(CURRENT_SPEC)
  const builderSpec = readOpenApi(BUILDER_SPEC)

  const diff = diffOpenApiDocuments(currentSpec, builderSpec)
  if (diff.length > 0) {
    throw new Error([
      'Builder parity artifact has unaccepted OpenAPI drift.',
      formatOpenApiDiff(diff),
      '',
      'Document any accepted drift in docs/internal/definition-builder-compatibility-gates.md before allowing it here.',
    ].join('\n'))
  }
  checks.push({ name: 'normalized OpenAPI parity diff', status: 'passed', detail: 'no drift' })

  runCommand('Validate builder artifact with oa-gen', 'node', [
    CODEGEN_CLI,
    'validate',
    '--spec',
    BUILDER_SPEC,
  ])
  checks.push({ name: 'oa-gen validate builder artifact', status: 'passed' })

  writeDowngradedBuilderArtifact(builderSpec)
  checks.push({
    name: 'builder artifact OpenAPI 3.1 downgrade',
    status: 'passed',
    detail: `${BUILDER_31_SPEC} + ${BUILDER_31_META}`,
  })

  runCommand('Lint builder artifact with Spectral schema rules', 'pnpm', [
    'exec',
    'spectral',
    'lint',
    'src/.builder/local-parity-api.yaml',
    '--ruleset',
    '.spectral.yaml',
  ], { cwd: 'packages/schemas' })
  checks.push({ name: 'Spectral equivalent builder lint', status: 'passed' })

  runCommand('Lint downgraded builder artifact with Redocly schema rules', 'pnpm', [
    'exec',
    'redocly',
    'lint',
    'src/.builder/local-parity-api.3.1.yaml',
    '--config',
    'redocly.yaml',
  ], { cwd: 'packages/schemas' })
  checks.push({ name: 'Redocly equivalent builder lint', status: 'passed' })

  compareTypegenOutputs(acceptedDifferences)
  checks.push({
    name: 'typegen output parity',
    status: 'passed',
    detail: acceptedDifferences.some(difference => difference.area === 'typegen declaration order')
      ? 'equal after declaration-order normalization'
      : 'exact match',
  })

  runCodegenConsumers()
  checks.push({ name: 'router/client builder generation', status: 'passed' })

  await runMockServerConsumers(currentSpec, builderSpec)
  checks.push({ name: 'mock-server builder compatibility', status: 'passed' })

  writeReport({ checks, acceptedDifferences })
  printSummary(checks, acceptedDifferences)
}

function runCommand(
  label: string,
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): void {
  console.log(`\n━━━ ${label} ━━━`)
  execFileSync(command, args, {
    cwd: options.cwd ? resolve(process.cwd(), options.cwd) : process.cwd(),
    stdio: 'inherit',
  })
}

function readOpenApi(relativePath: string): Record<string, unknown> {
  const parsed = parseYaml(readFileSync(resolve(process.cwd(), relativePath), 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`OpenAPI document must be an object: ${relativePath}`)
  }
  return parsed
}

function writeDowngradedBuilderArtifact(builderSpec: Record<string, unknown>): void {
  const { transformed, sidecar } = downgrade(builderSpec)
  if (transformed.openapi !== '3.1.0') {
    throw new Error(`Expected downgraded builder artifact to use OpenAPI 3.1.0, got ${String(transformed.openapi)}`)
  }

  writeTextFile(BUILDER_31_SPEC, stringifyYaml(transformed, { lineWidth: 0 }))
  writeTextFile(BUILDER_31_META, `${JSON.stringify({
    _comment: 'OAS 3.2-only field sidecar for builder parity compatibility validation.',
    source: 'local-parity-api.yaml',
    downgradeVersion: '3.1.0',
    originalVersion: builderSpec.openapi ?? 'unknown',
    preserved: sidecar,
  }, null, 2)}\n`)
}

function compareTypegenOutputs(acceptedDifferences: AcceptedDifference[]): void {
  const currentTypesPath = join(COMPAT_DIR, 'current-types.ts')
  const builderTypesPath = join(COMPAT_DIR, 'builder-types.ts')

  runCommand('Generate current typegen output', 'node', [
    CODEGEN_CLI,
    'typegen',
    '--spec',
    CURRENT_SPEC,
    '--output',
    currentTypesPath,
  ])
  runCommand('Generate builder typegen output', 'node', [
    CODEGEN_CLI,
    'typegen',
    '--spec',
    BUILDER_SPEC,
    '--output',
    builderTypesPath,
  ])

  const current = readFileSync(resolve(process.cwd(), currentTypesPath), 'utf8')
  const builder = readFileSync(resolve(process.cwd(), builderTypesPath), 'utf8')
  if (current === builder) return

  if (normalizeGeneratedTypeDeclarations(current) !== normalizeGeneratedTypeDeclarations(builder)) {
    throw new Error([
      'Builder typegen output differs from current output beyond declaration order.',
      `Current: ${currentTypesPath}`,
      `Builder: ${builderTypesPath}`,
    ].join('\n'))
  }

  acceptedDifferences.push({
    area: 'typegen declaration order',
    status: 'accepted',
    owner: 'definition-builder maintainers',
    rationale: 'The builder emits equivalent schemas and operations from fragment traversal order. TypeScript type aliases can reference later declarations, so declaration ordering does not change the generated API surface.',
  })
}

function runCodegenConsumers(): void {
  runCommand('Generate router from builder artifact', 'node', [
    CODEGEN_CLI,
    'router',
    '--spec',
    BUILDER_SPEC,
    '--types-import',
    './builder-types',
    '--output',
    join(COMPAT_DIR, 'builder-router.ts'),
  ])

  runCommand('Generate client from builder artifact', 'node', [
    CODEGEN_CLI,
    'client',
    '--spec',
    BUILDER_SPEC,
    '--types-import',
    './builder-types',
    '--output',
    join(COMPAT_DIR, 'builder-client.ts'),
  ])
}

async function runMockServerConsumers(
  currentSpec: Record<string, unknown>,
  builderSpec: Record<string, unknown>,
): Promise<void> {
  const mockServer = await import(pathToFileURL(resolve(process.cwd(), MOCK_SERVER_DIST)).href) as MockServerModule
  const currentHandlers = mockServer.createMswHandlers(currentSpec)
  const builderHandlers = mockServer.createMswHandlers(builderSpec)
  if (builderHandlers.length !== currentHandlers.length) {
    throw new Error(`Builder MSW handler count ${builderHandlers.length} differs from current ${currentHandlers.length}.`)
  }

  const nodeServer = mockServer.createNodeMockServer(builderSpec, { port: 0 })
  if (typeof nodeServer.start !== 'function' || typeof nodeServer.stop !== 'function') {
    throw new Error('Builder Node mock-server adapter did not return start/stop functions.')
  }
}

function normalizeGeneratedTypeDeclarations(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n').trim()
  const body = normalized.replace(
    /^\/\/ Auto-generated from OpenAPI spec\. Do not edit\.\n\/\/ @oa-sdk\/codegen typegen\n\n?/,
    '',
  )
  return body
    .split(/\n\n+/)
    .map(block => block.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .join('\n\n')
}

function resetDirectory(relativePath: string): void {
  const absolutePath = resolve(process.cwd(), relativePath)
  if (existsSync(absolutePath)) rmSync(absolutePath, { recursive: true, force: true })
  mkdirSync(absolutePath, { recursive: true })
}

function writeReport(report: {
  checks: GateCheck[]
  acceptedDifferences: AcceptedDifference[]
}): void {
  writeTextFile(REPORT_PATH, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    artifacts: {
      currentSpec: CURRENT_SPEC,
      builderSpec: BUILDER_SPEC,
      builderOpenApi31Spec: BUILDER_31_SPEC,
      builderOpenApi31Sidecar: BUILDER_31_META,
      generatedOutputsDir: COMPAT_DIR,
    },
    ...report,
  }, null, 2)}\n`)
}

function printSummary(checks: GateCheck[], acceptedDifferences: AcceptedDifference[]): void {
  console.log('\n### Builder Parity Compatibility Gates')
  for (const check of checks) {
    console.log(`- PASS ${check.name}${check.detail ? `: ${check.detail}` : ''}`)
  }
  if (acceptedDifferences.length === 0) {
    console.log('- Accepted differences: none')
  } else {
    for (const difference of acceptedDifferences) {
      console.log(`- Accepted difference (${difference.area}): ${difference.rationale} Owner: ${difference.owner}.`)
    }
  }
  console.log(`- Report: ${REPORT_PATH}`)
}

function writeTextFile(relativePath: string, content: string): void {
  const absolutePath = resolve(process.cwd(), relativePath)
  mkdirSync(dirname(absolutePath), { recursive: true })
  writeFileSync(absolutePath, content, 'utf8')
}

function assertFile(relativePath: string): void {
  if (existsSync(resolve(process.cwd(), relativePath))) return
  throw new Error(`Missing required file: ${relativePath}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
