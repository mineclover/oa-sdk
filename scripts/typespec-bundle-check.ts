/**
 * TypeSpec authored-bundle probe.
 *
 * This starts from a TypeSpec project plus an OA SDK compatibility sidecar,
 * compiles through the TypeSpec OpenAPI emitter, restores sidecar metadata,
 * validates the restored OpenAPI, and optionally diffs against an expected
 * OpenAPI artifact.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { execa } from 'execa'
import { parse as parseYaml } from 'yaml'
import {
  parseTypeSpecBundleManifest,
  resolveTypeSpecBundleManifestPaths,
  type TypeSpecBundleManifest,
} from '../packages/codegen/src/cli/lib/typespec-bundle-manifest.js'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import { stringifyOpenApiYaml } from '../packages/codegen/src/cli/lib/openapi-collect.js'
import {
  applyTypeSpecCompatibilitySidecar,
  compareTypeSpecCompatibilitySidecars,
  createTypeSpecCompatibilitySidecar,
  parseTypeSpecCompatibilitySidecar,
  type TypeSpecCompatibilitySidecarCompareReport,
} from '../packages/codegen/src/cli/lib/typespec-sidecar.js'
import {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  extractEndpoints,
  formatMarkdown,
  type DiffResult,
} from '../packages/codegen/src/cli/lib/openapi-breaking-diff.js'
import { validateDocument } from '../packages/parser/src/validate.js'

type Args = {
  project?: string
  manifest?: string
  sidecar?: string
  expected?: string
  output?: string
  report?: string
  keep: boolean
  failOnBreaking: boolean
}

type BundleConfig = {
  source: 'manifest' | 'defaults'
  projectPath: string
  manifestPath?: string
  entrypointPath: string
  sidecarPath: string
  expectedPath?: string
  manifest?: TypeSpecBundleManifest
}

type DiffSummary = {
  added: number
  removed: number
  modified: number
  breaking: number
  nonBreaking: number
}

type TypeSpecBundleCheckReport = {
  schemaVersion: 'oa-sdk.typespec-bundle-check-report.v1'
  paths: {
    project: string
    manifest?: string
    entrypoint: string
    sidecar: string
    emittedOpenapi: string
    restoredOpenapi: string
    expectedOpenapi?: string
    workspace: string
  }
  bundle: {
    source: BundleConfig['source']
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
      responseMediaExamples: number
      securitySchemes: number
    }
    reExtractedCompatibilitySidecar: {
      entries: number
      parameterExamples: number
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

const root = resolve(process.cwd())
const defaultFixture = 'docs/internal/typespec-roundtrip/fixtures/authored-bundle'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const explicitManifestPath = args.manifest ? resolve(root, args.manifest) : undefined
  const projectPath = resolve(root, args.project ?? (explicitManifestPath ? dirname(explicitManifestPath) : defaultFixture))
  const bundle = loadBundleConfig(projectPath, args)
  assertFileExists(bundle.entrypointPath, 'bundle entrypoint')
  assertFileExists(bundle.sidecarPath, 'bundle sidecar')
  if (bundle.expectedPath) assertFileExists(bundle.expectedPath, 'expected OpenAPI')
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-typespec-bundle-'))
  const outputDir = join(workspace, 'tsp-output')
  const emittedPath = join(outputDir, '@typespec', 'openapi3', 'openapi.yaml')
  const restoredPath = args.output ? resolve(root, args.output) : join(workspace, 'openapi.restored.yaml')

  try {
    const compileProjectPath = prepareCompileProject(bundle, workspace)
    await execa('pnpm', createCompileArgs(compileProjectPath, outputDir), {
      cwd: root,
      stdio: 'inherit',
    })

    if (!existsSync(emittedPath)) {
      throw new Error(`TypeSpec compile did not emit ${emittedPath}`)
    }

    const { document: emittedDocument } = loadSpecWithPath(emittedPath)
    const emittedValidation = validateDocument(emittedDocument, {
      basePath: emittedPath,
      requireOpenApi32: true,
    })

    const sidecar = parseTypeSpecCompatibilitySidecar(loadJson(bundle.sidecarPath))
    const restored = applyTypeSpecCompatibilitySidecar(emittedDocument, sidecar)
    mkdirSync(dirname(restoredPath), { recursive: true })
    writeFileSync(restoredPath, stringifyOpenApiYaml(restored.document))
    const restoredValidation = validateDocument(restored.document, {
      basePath: restoredPath,
      requireOpenApi32: true,
    })

    const expected = bundle.expectedPath ? loadExpected(bundle.expectedPath) : undefined
    const emittedDiff = expected ? diffEndpoints(expected.document, emittedDocument) : undefined
    const restoredDiff = expected ? diffEndpoints(expected.document, restored.document) : undefined
    const reExtractedSidecar = createTypeSpecCompatibilitySidecar(restored.document)
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
      restoredDocument: restored.document,
      emittedValidation,
      restoredValidation,
      expected,
      emittedDiff,
      restoredDiff,
    })

    if (args.report) {
      const reportPath = resolve(root, args.report)
      mkdirSync(dirname(reportPath), { recursive: true })
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    }

    printSummary(report, restoredDiff)

    if (
      report.gates.compatibilitySidecar === 'fail'
      || report.gates.restoredValidation === 'fail'
      || (args.failOnBreaking && report.gates.expectedDiff === 'fail')
    ) {
      process.exit(1)
    }
  } finally {
    if (!args.keep) rmSync(workspace, { recursive: true, force: true })
  }
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
  bundle: BundleConfig
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
      sidecar: input.bundle.sidecarPath,
      emittedOpenapi: input.emittedPath,
      restoredOpenapi: input.restoredPath,
      ...(input.bundle.expectedPath ? { expectedOpenapi: input.bundle.expectedPath } : {}),
      workspace: input.workspace,
    },
    bundle: {
      source: input.bundle.source,
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

function printSummary(report: TypeSpecBundleCheckReport, restoredDiff: DiffResult | undefined): void {
  console.log('')
  console.log('TypeSpec authored bundle check')
  console.log(`  project: ${relative(root, report.paths.project)}`)
  if (report.paths.manifest) console.log(`  manifest: ${relative(root, report.paths.manifest)}`)
  console.log(`  entrypoint: ${relative(root, report.paths.entrypoint)}`)
  console.log(`  sidecar: ${relative(root, report.paths.sidecar)}`)
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

function parseArgs(rawArgs: string[]): Args {
  return {
    project: readOption(rawArgs, '--project'),
    manifest: readOption(rawArgs, '--manifest'),
    sidecar: readOption(rawArgs, '--sidecar'),
    expected: readOption(rawArgs, '--expected'),
    output: readOption(rawArgs, '--output'),
    report: readOption(rawArgs, '--report'),
    keep: rawArgs.includes('--keep'),
    failOnBreaking: rawArgs.includes('--fail-on-breaking'),
  }
}

function loadBundleConfig(projectPath: string, args: Args): BundleConfig {
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
  return {
    source: manifest ? 'manifest' : 'defaults',
    projectPath,
    ...(manifestPath ? { manifestPath } : {}),
    entrypointPath: manifestPaths?.entrypointPath ?? join(projectPath, 'main.tsp'),
    sidecarPath: args.sidecar
      ? resolve(root, args.sidecar)
      : manifestPaths?.sidecarPath ?? join(projectPath, 'oa-sdk.typespec-compat-sidecar.json'),
    expectedPath: args.expected
      ? resolve(root, args.expected)
      : manifestPaths?.expectedOpenapiPath ?? (manifest ? undefined : join(projectPath, 'expected.openapi.yaml')),
    ...(manifest ? { manifest } : {}),
  }
}

function prepareCompileProject(bundle: BundleConfig, workspace: string): string {
  if (bundle.source !== 'manifest') return bundle.projectPath
  const configPath = findTypeSpecConfig(bundle.projectPath)
  if (configPath) {
    assertManifestEntrypointMatchesConfig(bundle, configPath)
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
  const nodeModulesPath = join(root, 'node_modules')
  if (!existsSync(nodeModulesPath)) throw new Error(`node_modules does not exist: ${relative(root, nodeModulesPath)}`)
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

function assertManifestEntrypointMatchesConfig(bundle: BundleConfig, configPath: string): void {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createCompileArgs(projectPath: string, outputDir: string): string[] {
  return ['exec', 'tsp', 'compile', projectPath, '--output-dir', outputDir]
}

function assertFileExists(path: string, label: string): void {
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

await main()
