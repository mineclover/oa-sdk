import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  parseTypeSpecBundleManifest,
  resolveTypeSpecBundleManifestPaths,
  type TypeSpecBundleManifest,
} from './typespec-bundle-manifest.js'
import { loadSpecWithPath } from './load-spec.js'
import { stringifyOpenApiYaml } from './openapi-collect.js'
import {
  applyTypeSpecCompatibilitySidecar,
  compareTypeSpecCompatibilitySidecars,
  createTypeSpecCompatibilitySidecar,
  parseTypeSpecCompatibilitySidecar,
  type TypeSpecCompatibilitySidecarCompareReport,
} from './typespec-sidecar.js'
import {
  createTypeSpecCompatibilitySidecarFromOpenApiExtensions,
  stripTypeSpecOpenApiExtensions,
} from './typespec-oa-sdk-extensions.js'
import {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  extractEndpoints,
  formatMarkdown,
  type DiffResult,
} from './openapi-breaking-diff.js'
import { validateDocument, type OasDocument } from '@oa-sdk/parser'

type RestoredHttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace' | 'query'

const RESTORED_HTTP_METHODS: readonly RestoredHttpMethod[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']

export type TypeSpecBundleCheckArgs = {
  project?: string
  manifest?: string
  sidecar?: string
  expected?: string
  output?: string
  report?: string
  keep?: boolean
  failOnBreaking?: boolean
}

export type TypeSpecBundleConfig = {
  source: 'manifest' | 'defaults'
  projectPath: string
  manifestPath?: string
  entrypointPath: string
  sidecarPath?: string
  expectedPath?: string
  manifest?: TypeSpecBundleManifest
}

export type TypeSpecBundleCheckReport = {
  schemaVersion: 'oa-sdk.typespec-bundle-check-report.v1'
  paths: {
    project: string
    manifest?: string
    entrypoint: string
    sidecar?: string
    emittedOpenapi: string
    restoredOpenapi: string
    expectedOpenapi?: string
    workspace: string
  }
  bundle: {
    source: TypeSpecBundleConfig['source']
    compatibilitySource: 'sidecar' | 'typespec-extensions'
    schemaVersion?: TypeSpecBundleManifest['schemaVersion']
    compatibility?: TypeSpecBundleManifest['compatibility']
  }
  counts: {
    emittedOperations: number
    restoredOperations: number
    expectedOperations?: number
    compatibilitySidecar: {
      entries: number
      parameterExamples: number
      requestMediaExamples?: number
      responseMediaExamples: number
      securitySchemes: number
    }
    reExtractedCompatibilitySidecar: {
      entries: number
      parameterExamples: number
      requestMediaExamples?: number
      responseMediaExamples: number
      securitySchemes: number
    }
    restore: {
      entries: number
      applied: number
      missingTargets: number
    }
    sidecarStability: TypeSpecCompatibilitySidecarCompareReport['counts']
  }
  validation: {
    emitted: {
      valid: boolean
      summary: string
    }
    restored: {
      valid: boolean
      summary: string
    }
    expected?: {
      valid: boolean
      summary: string
    }
  }
  diff?: {
    emitted: DiffSummary
    restored: DiffSummary
  }
  gates: {
    compatibilitySidecar: 'pass' | 'fail'
    restoredValidation: 'pass' | 'fail'
    expectedDiff?: 'pass' | 'fail'
  }
}

export type TypeSpecBundleCheckResult = {
  report: TypeSpecBundleCheckReport
  restoredDiff?: DiffResult
}

export type TypeSpecCompileRequest = {
  projectPath: string
  outputDir: string
  cwd: string
  timeoutMs: number
  maxOutputBytes: number
  maxOldSpaceSizeMb: number
  compilerCliPath: string
}

export type TypeSpecCompileRunner = (request: TypeSpecCompileRequest) => Promise<void>

export type TypeSpecBundleCheckOptions = {
  root?: string
  compile?: TypeSpecCompileRunner
  compileTimeoutMs?: number
  compileMaxOutputBytes?: number
  compileMaxOldSpaceSizeMb?: number
  compilerCliPath?: string
  maxArtifactBytes?: number
}

export const DEFAULT_TYPESPEC_COMPILE_TIMEOUT_MS = 60_000
export const DEFAULT_TYPESPEC_COMPILE_MAX_OUTPUT_BYTES = 256 * 1024
export const DEFAULT_TYPESPEC_COMPILE_MAX_OLD_SPACE_SIZE_MB = 512
const PROCESS_TERMINATION_GRACE_MS = 250

type DiffSummary = {
  added: number
  removed: number
  modified: number
  breaking: number
  nonBreaking: number
}

const defaultFixture = 'docs/internal/typespec-roundtrip/fixtures/authored-bundle'

export function parseTypeSpecBundleCheckArgs(rawArgs: string[]): TypeSpecBundleCheckArgs {
  const project = readOption(rawArgs, '--project')
  const manifest = readOption(rawArgs, '--manifest')
  const sidecar = readOption(rawArgs, '--sidecar')
  const expected = readOption(rawArgs, '--expected')
  const output = readOption(rawArgs, '--output')
  const report = readOption(rawArgs, '--report')
  return {
    ...(project ? { project } : {}),
    ...(manifest ? { manifest } : {}),
    ...(sidecar ? { sidecar } : {}),
    ...(expected ? { expected } : {}),
    ...(output ? { output } : {}),
    ...(report ? { report } : {}),
    keep: rawArgs.includes('--keep'),
    failOnBreaking: rawArgs.includes('--fail-on-breaking'),
  }
}

export async function checkTypeSpecBundle(
  args: TypeSpecBundleCheckArgs,
  options: TypeSpecBundleCheckOptions = {},
): Promise<TypeSpecBundleCheckResult> {
  const root = resolve(options.root ?? process.cwd())
  const explicitManifestPath = args.manifest ? resolve(root, args.manifest) : undefined
  const projectPath = resolve(root, args.project ?? (explicitManifestPath ? dirname(explicitManifestPath) : defaultFixture))
  const bundle = loadBundleConfig(root, projectPath, args)
  assertFileExists(root, bundle.entrypointPath, 'bundle entrypoint')
  if (bundle.sidecarPath) assertFileExists(root, bundle.sidecarPath, 'bundle sidecar')
  if (bundle.expectedPath) assertFileExists(root, bundle.expectedPath, 'expected OpenAPI')
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-bundle-'))
  const outputDir = join(workspace, 'tsp-output')
  const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
  const restoredPath = args.output ? resolve(root, args.output) : join(workspace, 'openapi.restored.yaml')
  const maxArtifactBytes = options.maxArtifactBytes === undefined
    ? undefined
    : requirePositiveInteger(options.maxArtifactBytes, 'maxArtifactBytes')

  try {
    const compileProjectPath = prepareCompileProject(root, bundle, workspace)
    const compile = options.compile ?? runTypeSpecCompile
    await compile({
      projectPath: compileProjectPath,
      outputDir,
      cwd: root,
      timeoutMs: requirePositiveInteger(
        options.compileTimeoutMs ?? DEFAULT_TYPESPEC_COMPILE_TIMEOUT_MS,
        'compileTimeoutMs',
      ),
      maxOutputBytes: requirePositiveInteger(
        options.compileMaxOutputBytes ?? DEFAULT_TYPESPEC_COMPILE_MAX_OUTPUT_BYTES,
        'compileMaxOutputBytes',
      ),
      maxOldSpaceSizeMb: requirePositiveInteger(
        options.compileMaxOldSpaceSizeMb ?? DEFAULT_TYPESPEC_COMPILE_MAX_OLD_SPACE_SIZE_MB,
        'compileMaxOldSpaceSizeMb',
      ),
      compilerCliPath: resolveCompilerCliPath(options.compilerCliPath, root),
    })

    if (!existsSync(emittedPath)) {
      throw new Error(`TypeSpec compile did not emit ${emittedPath}`)
    }
    assertArtifactSize(emittedPath, 'emitted OpenAPI', maxArtifactBytes)

    const { document: emittedDocument } = loadSpecWithPath(emittedPath)
    const emittedValidation = validateDocument(emittedDocument, {
      basePath: emittedPath,
      requireOpenApi32: true,
    })

    if (bundle.sidecarPath) assertArtifactSize(bundle.sidecarPath, 'compatibility sidecar', maxArtifactBytes)
    const sidecar = bundle.sidecarPath
      ? parseTypeSpecCompatibilitySidecar(loadJson(bundle.sidecarPath))
      : createTypeSpecCompatibilitySidecarFromOpenApiExtensions(
        emittedDocument,
        bundle.manifest?.compatibility?.oaSdkExtensionSchemaVersion
          ? { schemaVersion: bundle.manifest.compatibility.oaSdkExtensionSchemaVersion }
          : {},
      )
    const restored = applyTypeSpecCompatibilitySidecar(stripTypeSpecOpenApiExtensions(emittedDocument), sidecar)
    const restoredDocument = normalizeTypeSpecRestoredOpenApiDocument(restored.document)
    const restoredYaml = stringifyOpenApiYaml(restoredDocument)
    assertArtifactTextSize(restoredYaml, 'restored OpenAPI', maxArtifactBytes)
    mkdirSync(dirname(restoredPath), { recursive: true })
    writeFileSync(restoredPath, restoredYaml)
    const restoredValidation = validateDocument(restoredDocument, {
      basePath: restoredPath,
      requireOpenApi32: true,
    })

    if (bundle.expectedPath) assertArtifactSize(bundle.expectedPath, 'expected OpenAPI', maxArtifactBytes)
    const expected = bundle.expectedPath ? loadExpected(bundle.expectedPath) : undefined
    const emittedDiff = expected ? diffEndpoints(expected.document, emittedDocument) : undefined
    const restoredDiff = expected ? diffEndpoints(expected.document, restoredDocument) : undefined
    const reExtractedSidecar = createTypeSpecCompatibilitySidecar(restoredDocument)
    const sidecarStability = compareTypeSpecCompatibilitySidecars(sidecar, reExtractedSidecar)
    const report = createReport({
      projectPath,
      bundle,
      emittedPath,
      restoredPath,
      workspace,
      sidecar,
      reExtractedSidecar,
      restore: restored.report,
      sidecarStability,
      emittedDocument,
      restoredDocument,
      emittedValidation,
      restoredValidation,
      ...(expected ? { expected } : {}),
      ...(emittedDiff ? { emittedDiff } : {}),
      ...(restoredDiff ? { restoredDiff } : {}),
    })

    if (args.report) {
      const reportPath = resolve(root, args.report)
      mkdirSync(dirname(reportPath), { recursive: true })
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    }

    return {
      report,
      ...(restoredDiff ? { restoredDiff } : {}),
    }
  } finally {
    if (args.keep !== true) rmSync(workspace, { recursive: true, force: true })
  }
}

export async function runTypeSpecCompile(request: TypeSpecCompileRequest): Promise<void> {
  const maxOldSpaceSizeMb = requirePositiveInteger(request.maxOldSpaceSizeMb, 'maxOldSpaceSizeMb')
  await runBoundedProcess({
    command: process.execPath,
    args: [
      `--max-old-space-size=${maxOldSpaceSizeMb}`,
      request.compilerCliPath,
      ...createCompileArgs(request.projectPath, request.outputDir),
    ],
    cwd: request.cwd,
    timeoutMs: request.timeoutMs,
    maxOutputBytes: request.maxOutputBytes,
  })
}

export function printTypeSpecBundleCheckSummary(
  result: TypeSpecBundleCheckResult,
  options: { root?: string } = {},
): void {
  const root = resolve(options.root ?? process.cwd())
  const { report, restoredDiff } = result
  console.log('')
  console.log('TypeSpec bundle check')
  console.log(`  project: ${relative(root, report.paths.project)}`)
  if (report.paths.manifest) console.log(`  manifest: ${relative(root, report.paths.manifest)}`)
  console.log(`  entrypoint: ${relative(root, report.paths.entrypoint)}`)
  if (report.paths.sidecar) console.log(`  sidecar: ${relative(root, report.paths.sidecar)}`)
  console.log(`  compatibility source: ${report.bundle.compatibilitySource}`)
  console.log(`  emitted: ${relative(root, report.paths.emittedOpenapi)}`)
  console.log(`  restored: ${relative(root, report.paths.restoredOpenapi)}`)
  if (report.paths.expectedOpenapi) console.log(`  expected: ${relative(root, report.paths.expectedOpenapi)}`)
  console.log(`  compatibility sidecar: ${report.counts.compatibilitySidecar.entries} entries, restore ${report.gates.compatibilitySidecar}`)
  console.log(`  restore targets: ${report.counts.restore.applied} applied, ${report.counts.restore.missingTargets} missing`)
  console.log(`  sidecar re-extract: ${report.counts.sidecarStability.expectedSatisfied}/${report.counts.sidecarStability.expectedEntries} expected, ${report.counts.sidecarStability.actualCovered}/${report.counts.sidecarStability.actualEntries} actual covered`)
  console.log(`  emitted validation: ${report.validation.emitted.summary}`)
  console.log(`  restored validation: ${report.validation.restored.summary}`)
  if (report.validation.expected) console.log(`  expected validation: ${report.validation.expected.summary}`)
  if (report.diff) {
    console.log(`  emitted breaking diff: ${report.diff.emitted.breaking > 0 ? 'yes' : 'no'}`)
    console.log(`  restored breaking diff: ${report.diff.restored.breaking > 0 ? 'yes' : 'no'}`)
  }
  console.log('')
  if (restoredDiff) console.log(formatMarkdown(restoredDiff))
}

export function shouldFailTypeSpecBundleCheck(
  report: TypeSpecBundleCheckReport,
  args: Pick<TypeSpecBundleCheckArgs, 'failOnBreaking'>,
): boolean {
  return report.gates.compatibilitySidecar === 'fail'
    || report.gates.restoredValidation === 'fail'
    || (args.failOnBreaking === true && report.gates.expectedDiff === 'fail')
}

export function formatTypeSpecBundleCheckFailure(report: TypeSpecBundleCheckReport): string {
  return [
    report.gates.compatibilitySidecar === 'fail' ? 'compatibilitySidecar' : undefined,
    report.gates.restoredValidation === 'fail' ? 'restoredValidation' : undefined,
    report.gates.expectedDiff === 'fail' ? 'expectedDiff' : undefined,
  ].filter(Boolean).join(', ') || 'unknown'
}

function loadExpected(path: string): {
  document: Record<string, unknown>
  validation: { valid: boolean; summary: string }
} {
  const { document } = loadSpecWithPath(path)
  return {
    document,
    validation: validateDocument(document, {
      basePath: path,
      requireOpenApi32: true,
    }),
  }
}

function createReport(input: {
  projectPath: string
  bundle: TypeSpecBundleConfig
  emittedPath: string
  restoredPath: string
  workspace: string
  sidecar: ReturnType<typeof parseTypeSpecCompatibilitySidecar>
  reExtractedSidecar: ReturnType<typeof createTypeSpecCompatibilitySidecar>
  restore: ReturnType<typeof applyTypeSpecCompatibilitySidecar>['report']
  sidecarStability: TypeSpecCompatibilitySidecarCompareReport
  emittedDocument: Record<string, unknown>
  restoredDocument: Record<string, unknown>
  emittedValidation: { valid: boolean; summary: string }
  restoredValidation: { valid: boolean; summary: string }
  expected?: { document: Record<string, unknown>; validation: { valid: boolean; summary: string } }
  emittedDiff?: DiffResult
  restoredDiff?: DiffResult
}): TypeSpecBundleCheckReport {
  const restoredBreaking = input.restoredDiff ? classifyBreakingChanges(input.restoredDiff).length : 0
  return {
    schemaVersion: 'oa-sdk.typespec-bundle-check-report.v1',
    paths: {
      project: input.projectPath,
      ...(input.bundle.manifestPath ? { manifest: input.bundle.manifestPath } : {}),
      entrypoint: input.bundle.entrypointPath,
      ...(input.bundle.sidecarPath ? { sidecar: input.bundle.sidecarPath } : {}),
      emittedOpenapi: input.emittedPath,
      restoredOpenapi: input.restoredPath,
      ...(input.bundle.expectedPath ? { expectedOpenapi: input.bundle.expectedPath } : {}),
      workspace: input.workspace,
    },
    bundle: {
      source: input.bundle.source,
      compatibilitySource: input.bundle.sidecarPath ? 'sidecar' : 'typespec-extensions',
      ...(input.bundle.manifest ? { schemaVersion: input.bundle.manifest.schemaVersion } : {}),
      ...(input.bundle.manifest?.compatibility ? { compatibility: input.bundle.manifest.compatibility } : {}),
    },
    counts: {
      emittedOperations: extractEndpoints(input.emittedDocument).size,
      restoredOperations: extractEndpoints(input.restoredDocument).size,
      ...(input.expected ? { expectedOperations: extractEndpoints(input.expected.document).size } : {}),
      compatibilitySidecar: input.sidecar.counts,
      reExtractedCompatibilitySidecar: input.reExtractedSidecar.counts,
      restore: input.restore.counts,
      sidecarStability: input.sidecarStability.counts,
    },
    validation: {
      emitted: input.emittedValidation,
      restored: input.restoredValidation,
      ...(input.expected ? { expected: input.expected.validation } : {}),
    },
    ...(input.emittedDiff && input.restoredDiff
      ? {
          diff: {
            emitted: summarizeDiff(input.emittedDiff),
            restored: summarizeDiff(input.restoredDiff),
          },
        }
      : {}),
    gates: {
      compatibilitySidecar: input.restore.counts.missingTargets === 0
        && input.sidecarStability.counts.missingExpected === 0
        && input.sidecarStability.counts.unexpectedActual === 0
        && input.sidecarStability.counts.valueMismatches === 0
        ? 'pass'
        : 'fail',
      restoredValidation: input.restoredValidation.valid ? 'pass' : 'fail',
      ...(input.restoredDiff ? { expectedDiff: restoredBreaking === 0 ? 'pass' : 'fail' } : {}),
    },
  }
}

function summarizeDiff(diff: DiffResult): DiffSummary {
  return {
    added: diff.added.length,
    removed: diff.removed.length,
    modified: diff.modified.length,
    breaking: classifyBreakingChanges(diff).length,
    nonBreaking: classifyNonBreakingChanges(diff).length,
  }
}

function loadBundleConfig(root: string, projectPath: string, args: TypeSpecBundleCheckArgs): TypeSpecBundleConfig {
  const defaultManifestPath = join(projectPath, 'oa-sdk.typespec-bundle.json')
  const manifestPath = args.manifest
    ? resolve(root, args.manifest)
    : existsSync(defaultManifestPath)
      ? defaultManifestPath
      : undefined
  const manifest = manifestPath
    ? parseTypeSpecBundleManifest(loadJson(manifestPath), manifestPath)
    : undefined
  const manifestPaths = manifest && manifestPath
    ? resolveTypeSpecBundleManifestPaths(manifest, manifestPath)
    : undefined
  const expectedPath = args.expected
    ? resolve(root, args.expected)
    : manifestPaths?.expectedOpenapiPath ?? (manifest ? undefined : join(projectPath, 'expected.openapi.yaml'))
  const sidecarPath = args.sidecar
    ? resolve(root, args.sidecar)
    : manifestPaths?.sidecarPath ?? (manifest ? undefined : join(projectPath, 'oa-sdk.typespec-compat-sidecar.json'))
  return {
    source: manifest ? 'manifest' : 'defaults',
    projectPath,
    ...(manifestPath ? { manifestPath } : {}),
    entrypointPath: manifestPaths?.entrypointPath ?? join(projectPath, 'main.tsp'),
    ...(sidecarPath ? { sidecarPath } : {}),
    ...(expectedPath ? { expectedPath } : {}),
    ...(manifest ? { manifest } : {}),
  }
}

function prepareCompileProject(root: string, bundle: TypeSpecBundleConfig, workspace: string): string {
  if (bundle.source !== 'manifest') return bundle.projectPath
  const configPath = findTypeSpecConfig(bundle.projectPath)
  if (configPath) {
    assertManifestEntrypointMatchesConfig(root, bundle, configPath)
    return bundle.projectPath
  }
  const compileProjectPath = join(workspace, 'typespec-project')
  mkdirSync(compileProjectPath, { recursive: true })
  for (const entry of readdirSync(bundle.projectPath)) {
    if (entry === 'node_modules' || entry === 'tspconfig.yaml' || entry === 'tspconfig.yml') continue
    const sourcePath = join(bundle.projectPath, entry)
    const targetPath = join(compileProjectPath, entry)
    symlinkSync(sourcePath, targetPath, lstatSync(sourcePath).isDirectory() ? 'dir' : 'file')
  }
  const nodeModulesPath = findTypeSpecNodeModules(root)
  if (!nodeModulesPath) {
    throw new Error(`node_modules with @typespec/openapi3 does not exist at or above ${relative(process.cwd(), root) || '.'}`)
  }
  symlinkSync(nodeModulesPath, join(compileProjectPath, 'node_modules'), 'dir')
  const openapiVersion = bundle.manifest?.compatibility?.openapiVersion ?? '3.2.0'
  const entrypoint = bundle.manifest?.entrypoint ?? 'main.tsp'
  writeFileSync(join(compileProjectPath, 'tspconfig.yaml'), [
    'kind: project',
    `entrypoint: ${JSON.stringify(entrypoint)}`,
    'emit:',
    '  - "@typespec/openapi3"',
    'options:',
    '  "@typespec/openapi3":',
    '    openapi-versions:',
    `      - ${JSON.stringify(openapiVersion)}`,
    '',
  ].join('\n'))
  return compileProjectPath
}

function findTypeSpecConfig(projectPath: string): string | undefined {
  const yamlPath = join(projectPath, 'tspconfig.yaml')
  if (existsSync(yamlPath)) return yamlPath
  const ymlPath = join(projectPath, 'tspconfig.yml')
  if (existsSync(ymlPath)) return ymlPath
  return undefined
}

function findTypeSpecNodeModules(startPath: string): string | undefined {
  let current = resolve(startPath)
  while (true) {
    const candidate = join(current, 'node_modules')
    if (existsSync(join(candidate, '@typespec', 'openapi3'))) return candidate
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function assertManifestEntrypointMatchesConfig(root: string, bundle: TypeSpecBundleConfig, configPath: string): void {
  const config = parseYaml(readFileSync(configPath, 'utf8')) as unknown
  const configEntrypoint = isRecord(config) && typeof config.entrypoint === 'string' && config.entrypoint.trim() !== ''
    ? config.entrypoint
    : 'main.tsp'
  const manifestEntrypoint = bundle.manifest?.entrypoint ?? 'main.tsp'
  if (normalizeBundleRelativePath(configEntrypoint) !== normalizeBundleRelativePath(manifestEntrypoint)) {
    throw new Error(`manifest entrypoint ${manifestEntrypoint} does not match ${relative(root, configPath)} entrypoint ${configEntrypoint}`)
  }
}

function normalizeBundleRelativePath(path: string): string {
  return path.split('\\').join('/').replace(/^\.\//, '')
}

function createCompileArgs(projectPath: string, outputDir: string): string[] {
  return ['compile', projectPath, '--output-dir', outputDir]
}

function resolveCompilerCliPath(explicitPath: string | undefined, startPath: string): string {
  if (explicitPath !== undefined) {
    const resolved = realpathSync(explicitPath)
    if (!existsSync(resolved)) throw new Error(`TypeSpec compiler CLI does not exist: ${explicitPath}`)
    return resolved
  }
  let current = resolve(startPath)
  while (true) {
    const candidate = join(current, 'node_modules', '@typespec', 'compiler', 'cmd', 'tsp.js')
    if (existsSync(candidate)) return realpathSync(candidate)
    const parent = dirname(current)
    if (parent === current) {
      throw new Error(`@typespec/compiler CLI does not exist at or above ${startPath}`)
    }
    current = parent
  }
}

function normalizeTypeSpecRestoredOpenApiDocument(document: OasDocument): OasDocument {
  const normalized = document
  if (Array.isArray(normalized.servers)) {
    for (const server of normalized.servers) {
      if (!isRecord(server)) continue
      const variables = server.variables
      if (isRecord(variables) && Object.keys(variables).length === 0) {
        delete server.variables
      }
    }
  }
  normalizeTypeSpecRestoredPathItems(normalized.paths)
  return normalized
}

function normalizeTypeSpecRestoredPathItems(paths: unknown): void {
  if (!isRecord(paths)) return
  for (const pathItem of Object.values(paths)) {
    if (!isRecord(pathItem)) continue
    const operations = readRestoredOperations(pathItem)
    for (const operation of operations) {
      normalizeRestoredOperationParameters(operation.operation)
      normalizeInlineResponseSchemaExamples(operation.operation)
    }
    hoistCommonPathParameters(pathItem, operations)
  }
}

function readRestoredOperations(
  pathItem: Record<string, unknown>,
): Array<{ method: RestoredHttpMethod; operation: Record<string, unknown> }> {
  const operations: Array<{ method: RestoredHttpMethod; operation: Record<string, unknown> }> = []
  for (const method of RESTORED_HTTP_METHODS) {
    const operation = pathItem[method]
    if (isRecord(operation)) operations.push({ method, operation })
  }
  return operations
}

function normalizeRestoredOperationParameters(operation: Record<string, unknown>): void {
  const parameters = operation.parameters
  if (!Array.isArray(parameters)) return
  for (const parameter of parameters) normalizeRestoredParameter(parameter)
  if (parameters.length === 0) delete operation.parameters
}

function normalizeRestoredParameter(parameter: unknown): void {
  if (!isRecord(parameter)) return
  if (parameter.in !== 'path' && parameter.required === false) delete parameter.required
  if (parameter.explode === false && isPrimitiveParameter(parameter)) delete parameter.explode
}

function isPrimitiveParameter(parameter: Record<string, unknown>): boolean {
  const schema = parameter.schema
  if (!isRecord(schema)) return false
  const type = schema.type
  return type === 'string' || type === 'number' || type === 'integer' || type === 'boolean'
}

function hoistCommonPathParameters(
  pathItem: Record<string, unknown>,
  operations: Array<{ method: RestoredHttpMethod; operation: Record<string, unknown> }>,
): void {
  if (operations.length === 0 || Array.isArray(pathItem.parameters)) return
  const firstParameters = operations[0]?.operation.parameters
  if (!Array.isArray(firstParameters)) return
  const candidates = firstParameters.filter(parameter => isRecord(parameter) && parameter.in === 'path')
  if (candidates.length === 0) return

  const hoisted: unknown[] = []
  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate.name !== 'string') continue
    const matches = operations.map(({ operation }) => findMatchingParameter(operation.parameters, candidate))
    if (matches.some(match => !match)) continue
    const [firstMatch] = matches
    if (!firstMatch) continue
    if (matches.every(match => match && stableJsonValue(match.parameter) === stableJsonValue(firstMatch.parameter))) {
      hoisted.push(cloneJson(firstMatch.parameter))
      for (const match of matches) {
        if (!match || !Array.isArray(match.parameters)) continue
        match.parameters.splice(match.index, 1)
      }
    }
  }

  if (hoisted.length === 0) return
  pathItem.parameters = hoisted
  for (const { operation } of operations) {
    if (Array.isArray(operation.parameters) && operation.parameters.length === 0) delete operation.parameters
  }
}

function findMatchingParameter(
  parameters: unknown,
  candidate: Record<string, unknown>,
): { parameters: unknown[]; index: number; parameter: unknown } | undefined {
  if (!Array.isArray(parameters)) return undefined
  const index = parameters.findIndex(parameter => (
    isRecord(parameter)
    && parameter.in === candidate.in
    && parameter.name === candidate.name
  ))
  return index >= 0 ? { parameters, index, parameter: parameters[index] } : undefined
}

function normalizeInlineResponseSchemaExamples(operation: Record<string, unknown>): void {
  const responses = operation.responses
  if (!isRecord(responses)) return
  for (const response of Object.values(responses)) {
    if (!isRecord(response) || !isRecord(response.content)) continue
    for (const media of Object.values(response.content)) {
      if (!isRecord(media) || !isRecord(media.schema) || '$ref' in media.schema || media.schema.example !== undefined) continue
      const example = readMediaExample(media)
      if (example !== undefined) media.schema.example = cloneJson(example)
    }
  }
}

function readMediaExample(media: Record<string, unknown>): unknown {
  if (media.example !== undefined) return media.example
  const examples = media.examples
  if (!isRecord(examples)) return undefined
  const defaultExample = examples.default
  if (isRecord(defaultExample)) {
    if (defaultExample.dataValue !== undefined) return defaultExample.dataValue
    if (defaultExample.value !== undefined) return defaultExample.value
  }
  return undefined
}

function stableJsonValue(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  )
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export type BoundedProcessRequest = {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  maxOutputBytes: number
}

export function runBoundedProcess(request: BoundedProcessRequest): Promise<void> {
  return new Promise((resolveProcess, rejectProcess) => {
    const timeoutMs = requirePositiveInteger(request.timeoutMs, 'timeoutMs')
    const maxOutputBytes = requirePositiveInteger(request.maxOutputBytes, 'maxOutputBytes')
    const useProcessGroup = process.platform !== 'win32'
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: useProcessGroup,
    })
    const output: Buffer[] = []
    let outputBytes = 0
    let truncated = false
    let timedOut = false
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined

    const collect = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = maxOutputBytes - outputBytes
      if (remaining > 0) {
        const retained = bytes.subarray(0, remaining)
        output.push(retained)
        outputBytes += retained.length
      }
      if (bytes.length > remaining) truncated = true
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)

    const timeout = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32') {
        try {
          // taskkill must receive the still-live parent PID so `/t` can find
          // and terminate descendants before the parent disappears.
          terminateProcessTree(child.pid, 'SIGKILL', false)
          finish(timeoutError())
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
        return
      }
      try {
        terminateProcessTree(child.pid, 'SIGTERM', useProcessGroup)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
        return
      }
      forceKillTimer = setTimeout(
        () => {
          try {
            terminateProcessTree(child.pid, 'SIGKILL', useProcessGroup)
            forceKillTimer = undefined
            finish(timeoutError())
          } catch (error) {
            forceKillTimer = undefined
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        },
        PROCESS_TERMINATION_GRACE_MS,
      )
    }, timeoutMs)

    const capturedDetails = (): string => {
      const captured = Buffer.concat(output).toString('utf8').trim()
      if (captured.length > 0) {
        return `\n${captured}${truncated ? `\n[output truncated at ${maxOutputBytes} bytes]` : ''}`
      }
      return truncated ? `\n[output truncated at ${maxOutputBytes} bytes]` : ''
    }
    const timeoutError = (): Error => new Error(
      `Command timed out after ${timeoutMs}ms: ${request.command} ${request.args.join(' ')}${capturedDetails()}`,
    )

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (error) rejectProcess(error)
      else resolveProcess()
    }

    child.on('error', error => {
      if (!timedOut) finish(error)
    })
    child.on('close', code => {
      // A SIGTERM-ignoring descendant can outlive the direct child. Do not
      // settle until the grace timer has delivered SIGKILL to the full group.
      if (timedOut) {
        return
      }
      if (code === 0) {
        finish()
        return
      }
      finish(new Error(`Command failed with exit code ${code}: ${request.command} ${request.args.join(' ')}${capturedDetails()}`))
    })
  })
}

function terminateProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
  useProcessGroup: boolean,
): void {
  if (pid === undefined) return
  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      const result = spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      if (result.error) throw result.error
      if (result.status !== 0) {
        throw new Error(`taskkill failed for process tree ${pid} with exit code ${result.status}`)
      }
      return
    }
    try {
      process.kill(pid, signal)
    } catch (error) {
      if (!isRecord(error) || error.code !== 'ESRCH') throw error
    }
    return
  }
  try {
    process.kill(useProcessGroup ? -pid : pid, signal)
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ESRCH') throw error
  }
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return value
}

function assertArtifactSize(path: string, label: string, maxBytes: number | undefined): void {
  if (maxBytes === undefined) return
  const size = statSync(path).size
  if (size > maxBytes) throw new Error(`${label} exceeds artifact limit ${maxBytes} bytes: ${size}`)
}

function assertArtifactTextSize(content: string, label: string, maxBytes: number | undefined): void {
  if (maxBytes === undefined) return
  const size = Buffer.byteLength(content)
  if (size > maxBytes) throw new Error(`${label} exceeds artifact limit ${maxBytes} bytes: ${size}`)
}

function assertFileExists(root: string, path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${relative(root, path)}`)
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
