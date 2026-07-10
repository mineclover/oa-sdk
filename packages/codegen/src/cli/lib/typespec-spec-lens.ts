import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, posix, resolve } from 'node:path'
import { isImportStatement, parse } from '@typespec/compiler/ast'
import { parse as parseYaml } from 'yaml'
import {
  checkTypeSpecBundle,
  DEFAULT_TYPESPEC_COMPILE_MAX_OLD_SPACE_SIZE_MB,
  DEFAULT_TYPESPEC_COMPILE_MAX_OUTPUT_BYTES,
  DEFAULT_TYPESPEC_COMPILE_TIMEOUT_MS,
  formatTypeSpecBundleCheckFailure,
  shouldFailTypeSpecBundleCheck,
  type TypeSpecCompileRunner,
} from './typespec-bundle-check.js'
import { parseTypeSpecBundleManifest } from './typespec-bundle-manifest.js'

export const SPEC_LENS_TYPESPEC_PACKAGE_IMPORT_ALLOWLIST = [
  '@typespec/http',
  '@typespec/openapi',
] as const

export const SPEC_LENS_TYPESPEC_RUNTIME_PACKAGE_ALLOWLIST = [
  '@typespec/http',
  '@typespec/openapi',
  '@typespec/openapi3',
] as const

export const SPEC_LENS_TYPESPEC_TOOLCHAIN_PACKAGE_ALLOWLIST = [
  '@typespec/compiler',
  ...SPEC_LENS_TYPESPEC_RUNTIME_PACKAGE_ALLOWLIST,
] as const

export const SPEC_LENS_TYPESPEC_RESTORE_CONTRACT_VERSION =
  'oa-sdk.codegen.typespec-restore.v1' as const
export const SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION =
  'oa-sdk.spec-lens.typespec-isolation.v2' as const
export const SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRIES = 256
export const SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRY_BYTES = 2 * 1024 * 1024
export const SPEC_LENS_TYPESPEC_MAX_SOURCE_AGGREGATE_BYTES = 16 * 1024 * 1024
export const SPEC_LENS_TYPESPEC_MAX_SOURCE_READ_CONCURRENCY = 4
export const SPEC_LENS_TYPESPEC_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024

export type SpecLensTypeSpecSourceReadBudget = {
  readonly schemaVersion: 'oa-sdk.spec-lens.source-read-budget.v1'
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly maxConcurrency: number
}

export type SpecLensTypeSpecToolchainEvidence = {
  schemaVersion: 'oa-sdk.spec-lens.typespec-toolchain.v1'
  fingerprint: string
  packages: {
    '@typespec/compiler': string
    '@typespec/http': string
    '@typespec/openapi': string
    '@typespec/openapi3': string
  }
  restoreContract: typeof SPEC_LENS_TYPESPEC_RESTORE_CONTRACT_VERSION
  isolationPolicy: typeof SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION
  resourcePolicy: {
    compileTimeoutMs: number
    compileMaxOutputBytes: number
    compileMaxOldSpaceSizeMb: number
    sourceReadBudget: SpecLensTypeSpecSourceReadBudget
    maxArtifactBytes: number
  }
}

type SpecLensTypeSpecHostRuntime = {
  packagePaths: Record<typeof SPEC_LENS_TYPESPEC_TOOLCHAIN_PACKAGE_ALLOWLIST[number], string>
  compilerCliPath: string
}

const moduleRequire = createRequire(import.meta.url)

export type SpecLensTypeSpecSourceEntry = {
  relativePath: string
  content: string
}

export type CompileTypeSpecBundleForSpecLensOptions = {
  sourceRoot: string
  manifestPath: string
  entries: readonly SpecLensTypeSpecSourceEntry[]
  runtimeRoot?: string
  /** Test seam. Production callers must use the default trusted TypeSpec runner. */
  compile?: TypeSpecCompileRunner
}

export type SpecLensTypeSpecCompileEvidence = {
  schemaVersion: 'oa-sdk.spec-lens.typespec-compile.v1'
  manifestSchemaVersion: 'oa-sdk.typespec-bundle.v1'
  entrypoint: string
  sourceFiles: string[]
  compatibilitySource: 'sidecar' | 'typespec-extensions'
  toolchain: SpecLensTypeSpecToolchainEvidence
  compiler: {
    configSource: 'generated-allowlist'
    emitter: '@typespec/openapi3'
    openapiVersion: '3.2.0'
    packageImports: string[]
    resources: {
      timeoutMs: number
      maxOutputBytes: number
      maxOldSpaceSizeMb: number
      sourceReadBudget: SpecLensTypeSpecSourceReadBudget
      maxArtifactBytes: number
      isolationPolicy: typeof SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION
    }
  }
  validation: {
    emitted: { valid: boolean; summary: string }
    restored: { valid: boolean; summary: string }
    expected?: { valid: boolean; summary: string }
  }
  gates: {
    compatibilitySidecar: 'pass' | 'fail'
    restoredValidation: 'pass' | 'fail'
    expectedDiff?: 'pass' | 'fail'
  }
}

export type CompileTypeSpecBundleForSpecLensResult = {
  document: Record<string, unknown>
  evidence: SpecLensTypeSpecCompileEvidence
}

/**
 * Compile historical TypeSpec source entries without trusting repository code or
 * configuration. Only reachable relative `.tsp` files are materialized, package
 * imports are allowlisted, and the emitter config is generated locally.
 */
export async function compileTypeSpecBundleForSpecLens(
  options: CompileTypeSpecBundleForSpecLensOptions,
): Promise<CompileTypeSpecBundleForSpecLensResult> {
  assertSourceEntriesBounded(options.entries)
  const runtimeRoot = resolve(options.runtimeRoot ?? process.cwd())
  const hostRuntime = resolveSpecLensTypeSpecHostRuntime()
  const toolchain = createSpecLensTypeSpecToolchainEvidence(hostRuntime)
  const sourceRoot = normalizeRepoRelativePath(options.sourceRoot, 'sourceRoot')
  const manifestPath = normalizeRepoRelativePath(options.manifestPath, 'manifestPath')
  const manifestRelativePath = relativePathInsideSourceRoot(sourceRoot, manifestPath)
  const entries = indexEntries(options.entries)
  const manifestEntry = entries.get(manifestRelativePath)
  if (!manifestEntry) {
    throw new Error(`TypeSpec bundle manifest is unavailable in revision entries: ${manifestRelativePath}`)
  }

  const manifest = parseTypeSpecBundleManifest(parseJson(manifestEntry.content, manifestRelativePath), manifestRelativePath)
  const openapiVersion = manifest.compatibility?.openapiVersion ?? '3.2.0'
  if (openapiVersion !== '3.2.0') {
    throw new Error(`spec-lens requires TypeSpec OpenAPI 3.2.0, received ${openapiVersion}`)
  }

  const manifestDirectory = posix.dirname(manifestRelativePath)
  const entrypointPath = resolveBundleEntryPath(manifestDirectory, manifest.entrypoint)
  const sidecarPath = manifest.sidecar
    ? resolveBundleEntryPath(manifestDirectory, manifest.sidecar)
    : undefined
  const expectedPath = manifest.expectedOpenapi
    ? resolveBundleEntryPath(manifestDirectory, manifest.expectedOpenapi)
    : undefined
  requireEntry(entries, entrypointPath, 'TypeSpec entrypoint')
  if (!entrypointPath.endsWith('.tsp')) {
    throw new Error(`TypeSpec bundle entrypoint must be a .tsp file: ${entrypointPath}`)
  }
  if (sidecarPath) requireEntry(entries, sidecarPath, 'TypeSpec compatibility sidecar')
  if (expectedPath) requireEntry(entries, expectedPath, 'TypeSpec expected OpenAPI')

  const sourceFiles = collectReachableTypeSpecFiles(entries, entrypointPath)
  const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-spec-lens-typespec-'))
  const projectRoot = join(workspace, 'source')
  const restoredPath = join(workspace, 'openapi.restored.yaml')

  try {
    const materializedPaths = new Set([
      manifestRelativePath,
      entrypointPath,
      ...sourceFiles,
      ...(sidecarPath ? [sidecarPath] : []),
      ...(expectedPath ? [expectedPath] : []),
    ])
    for (const relativePath of [...materializedPaths].sort()) {
      const entry = requireEntry(entries, relativePath, 'TypeSpec bundle entry')
      const outputPath = safeWorkspacePath(projectRoot, relativePath)
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, entry.content)
    }

    const compileProjectPath = safeWorkspacePath(projectRoot, manifestDirectory === '.' ? '' : manifestDirectory)
    mkdirSync(compileProjectPath, { recursive: true })
    writeFileSync(join(compileProjectPath, 'tspconfig.yaml'), createAllowlistedTypeSpecConfig(manifest.entrypoint))
    materializeAllowlistedTypeSpecPackages(hostRuntime, compileProjectPath)

    const safeManifestPath = safeWorkspacePath(projectRoot, manifestRelativePath)
    const result = await checkTypeSpecBundle(
      {
        manifest: safeManifestPath,
        output: restoredPath,
        failOnBreaking: true,
      },
      {
        root: runtimeRoot,
        compileTimeoutMs: DEFAULT_TYPESPEC_COMPILE_TIMEOUT_MS,
        compileMaxOutputBytes: DEFAULT_TYPESPEC_COMPILE_MAX_OUTPUT_BYTES,
        compileMaxOldSpaceSizeMb: DEFAULT_TYPESPEC_COMPILE_MAX_OLD_SPACE_SIZE_MB,
        compilerCliPath: hostRuntime.compilerCliPath,
        maxArtifactBytes: SPEC_LENS_TYPESPEC_MAX_ARTIFACT_BYTES,
        ...(options.compile ? { compile: options.compile } : {}),
      },
    )
    if (shouldFailTypeSpecBundleCheck(result.report, { failOnBreaking: true })) {
      throw new Error(`TypeSpec bundle gates failed: ${formatTypeSpecBundleCheckFailure(result.report)}`)
    }

    const document = parseYaml(readFileSync(restoredPath, 'utf8')) as unknown
    if (!isRecord(document)) throw new Error('TypeSpec restored OpenAPI must be an object')
    return {
      document,
      evidence: {
        schemaVersion: 'oa-sdk.spec-lens.typespec-compile.v1',
        manifestSchemaVersion: manifest.schemaVersion,
        entrypoint: entrypointPath,
        sourceFiles,
        compatibilitySource: result.report.bundle.compatibilitySource,
        toolchain,
        compiler: {
          configSource: 'generated-allowlist',
          emitter: '@typespec/openapi3',
          openapiVersion: '3.2.0',
          packageImports: [...SPEC_LENS_TYPESPEC_PACKAGE_IMPORT_ALLOWLIST],
          resources: {
            timeoutMs: DEFAULT_TYPESPEC_COMPILE_TIMEOUT_MS,
            maxOutputBytes: DEFAULT_TYPESPEC_COMPILE_MAX_OUTPUT_BYTES,
            maxOldSpaceSizeMb: DEFAULT_TYPESPEC_COMPILE_MAX_OLD_SPACE_SIZE_MB,
            sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
            maxArtifactBytes: SPEC_LENS_TYPESPEC_MAX_ARTIFACT_BYTES,
            isolationPolicy: SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION,
          },
        },
        validation: result.report.validation,
        gates: result.report.gates,
      },
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
}

function indexEntries(entries: readonly SpecLensTypeSpecSourceEntry[]): Map<string, SpecLensTypeSpecSourceEntry> {
  const indexed = new Map<string, SpecLensTypeSpecSourceEntry>()
  for (const entry of entries) {
    const relativePath = normalizeEntryPath(entry.relativePath)
    if (isTypeSpecConfigPath(relativePath)) continue
    if (indexed.has(relativePath)) throw new Error(`duplicate TypeSpec revision entry: ${relativePath}`)
    indexed.set(relativePath, { relativePath, content: entry.content })
  }
  return indexed
}

function collectReachableTypeSpecFiles(
  entries: Map<string, SpecLensTypeSpecSourceEntry>,
  entrypointPath: string,
): string[] {
  const visited = new Set<string>()
  const pending = [entrypointPath]
  while (pending.length > 0) {
    const currentPath = pending.pop()
    if (!currentPath || visited.has(currentPath)) continue
    const entry = requireEntry(entries, currentPath, 'TypeSpec source import')
    visited.add(currentPath)
    for (const specifier of readTypeSpecImports(entry.content, currentPath)) {
      if (!specifier.startsWith('.')) {
        if (!(SPEC_LENS_TYPESPEC_PACKAGE_IMPORT_ALLOWLIST as readonly string[]).includes(specifier)) {
          throw new Error(`TypeSpec package import is not allowlisted in ${currentPath}: ${specifier}`)
        }
        continue
      }
      if (!specifier.endsWith('.tsp')) {
        throw new Error(`relative TypeSpec imports must name a .tsp file in ${currentPath}: ${specifier}`)
      }
      const importedPath = resolveRelativeTypeSpecImport(currentPath, specifier)
      requireEntry(entries, importedPath, 'relative TypeSpec import')
      pending.push(importedPath)
    }
  }
  return [...visited].sort()
}

function readTypeSpecImports(content: string, sourcePath: string): string[] {
  const script = parse(content)
  if (script.parseDiagnostics.length > 0) {
    const details = script.parseDiagnostics
      .map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
      .join('; ')
    throw new Error(`TypeSpec parse failed in ${sourcePath}: ${details}`)
  }
  return script.statements
    .filter(isImportStatement)
    .map(statement => statement.path.value)
}

function resolveRelativeTypeSpecImport(sourcePath: string, specifier: string): string {
  const resolved = posix.normalize(posix.join(posix.dirname(sourcePath), specifier))
  if (resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved)) {
    throw new Error(`relative TypeSpec import escapes sourceRoot in ${sourcePath}: ${specifier}`)
  }
  return normalizeEntryPath(resolved)
}

function createAllowlistedTypeSpecConfig(entrypoint: string): string {
  return [
    'kind: project',
    `entrypoint: ${JSON.stringify(entrypoint)}`,
    'emit:',
    '  - "@typespec/openapi3"',
    'options:',
    '  "@typespec/openapi3":',
    '    openapi-versions:',
    '      - "3.2.0"',
    '',
  ].join('\n')
}

function normalizeRepoRelativePath(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty path`)
  const normalized = value.replaceAll('\\', '/')
  if (normalized.includes('\0') || posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`${label} must be repo-relative`)
  }
  const collapsed = posix.normalize(normalized).replace(/^\.\//, '').replace(/\/$/, '')
  if (collapsed === '..' || collapsed.startsWith('../')) throw new Error(`${label} must stay inside the repository`)
  return collapsed || '.'
}

function normalizeEntryPath(value: string): string {
  const normalized = normalizeRepoRelativePath(value, 'revision entry path')
  if (normalized === '.') throw new Error('revision entry path must name a file')
  return normalized
}

function relativePathInsideSourceRoot(sourceRoot: string, path: string): string {
  const relativePath = sourceRoot === '.' ? path : posix.relative(sourceRoot, path)
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith('../') || posix.isAbsolute(relativePath)) {
    throw new Error(`manifestPath must name a file inside sourceRoot: ${path}`)
  }
  return normalizeEntryPath(relativePath)
}

function resolveBundleEntryPath(manifestDirectory: string, value: string): string {
  const relativePath = posix.normalize(posix.join(manifestDirectory, value))
  return normalizeEntryPath(relativePath)
}

function safeWorkspacePath(root: string, relativePath: string): string {
  const normalized = relativePath === '' ? '' : normalizeRepoRelativePath(relativePath, 'workspace entry path')
  const output = resolve(root, normalized)
  const relativeOutput = posix.relative(root.replaceAll('\\', '/'), output.replaceAll('\\', '/'))
  if (relativeOutput === '..' || relativeOutput.startsWith('../') || posix.isAbsolute(relativeOutput)) {
    throw new Error(`workspace entry escapes isolated root: ${relativePath}`)
  }
  return output
}

function isTypeSpecConfigPath(path: string): boolean {
  const name = posix.basename(path).toLowerCase()
  return name === 'tspconfig.yaml' || name === 'tspconfig.yml'
}

function requireEntry(
  entries: Map<string, SpecLensTypeSpecSourceEntry>,
  relativePath: string,
  label: string,
): SpecLensTypeSpecSourceEntry {
  const entry = entries.get(relativePath)
  if (!entry) throw new Error(`${label} is unavailable in revision entries: ${relativePath}`)
  return entry
}

export function resolveSpecLensTypeSpecToolchain(): SpecLensTypeSpecToolchainEvidence {
  return createSpecLensTypeSpecToolchainEvidence(resolveSpecLensTypeSpecHostRuntime())
}

export function resolveSpecLensTypeSpecSourceReadBudget(): SpecLensTypeSpecSourceReadBudget {
  return Object.freeze({
    schemaVersion: 'oa-sdk.spec-lens.source-read-budget.v1',
    maxFiles: SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRIES,
    maxFileBytes: SPEC_LENS_TYPESPEC_MAX_SOURCE_ENTRY_BYTES,
    maxTotalBytes: SPEC_LENS_TYPESPEC_MAX_SOURCE_AGGREGATE_BYTES,
    maxConcurrency: SPEC_LENS_TYPESPEC_MAX_SOURCE_READ_CONCURRENCY,
  })
}

function createSpecLensTypeSpecToolchainEvidence(
  hostRuntime: SpecLensTypeSpecHostRuntime,
): SpecLensTypeSpecToolchainEvidence {
  const packages = {
    '@typespec/compiler': readHostPackageVersion(hostRuntime.packagePaths['@typespec/compiler'], '@typespec/compiler'),
    '@typespec/http': readHostPackageVersion(hostRuntime.packagePaths['@typespec/http'], '@typespec/http'),
    '@typespec/openapi': readHostPackageVersion(hostRuntime.packagePaths['@typespec/openapi'], '@typespec/openapi'),
    '@typespec/openapi3': readHostPackageVersion(hostRuntime.packagePaths['@typespec/openapi3'], '@typespec/openapi3'),
  }
  const payload = {
    packages,
    restoreContract: SPEC_LENS_TYPESPEC_RESTORE_CONTRACT_VERSION,
    isolationPolicy: SPEC_LENS_TYPESPEC_ISOLATION_POLICY_VERSION,
    resourcePolicy: {
      compileTimeoutMs: DEFAULT_TYPESPEC_COMPILE_TIMEOUT_MS,
      compileMaxOutputBytes: DEFAULT_TYPESPEC_COMPILE_MAX_OUTPUT_BYTES,
      compileMaxOldSpaceSizeMb: DEFAULT_TYPESPEC_COMPILE_MAX_OLD_SPACE_SIZE_MB,
      sourceReadBudget: resolveSpecLensTypeSpecSourceReadBudget(),
      maxArtifactBytes: SPEC_LENS_TYPESPEC_MAX_ARTIFACT_BYTES,
    },
  }
  return {
    schemaVersion: 'oa-sdk.spec-lens.typespec-toolchain.v1',
    fingerprint: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    ...payload,
  }
}

function assertSourceEntriesBounded(entries: readonly SpecLensTypeSpecSourceEntry[]): void {
  const budget = resolveSpecLensTypeSpecSourceReadBudget()
  if (entries.length > budget.maxFiles) {
    throw new Error(
      `TypeSpec revision entry count ${entries.length} exceeds limit ${budget.maxFiles}`,
    )
  }
  let aggregateBytes = 0
  for (const entry of entries) {
    if (typeof entry.content !== 'string') {
      throw new Error(`TypeSpec revision entry content must be a string: ${entry.relativePath}`)
    }
    const entryBytes = Buffer.byteLength(entry.content)
    if (entryBytes > budget.maxFileBytes) {
      throw new Error(
        `TypeSpec revision entry ${entry.relativePath} exceeds ${budget.maxFileBytes} bytes`,
      )
    }
    aggregateBytes += entryBytes
    if (aggregateBytes > budget.maxTotalBytes) {
      throw new Error(
        `TypeSpec revision entries exceed aggregate limit ${budget.maxTotalBytes} bytes`,
      )
    }
  }
}

function materializeAllowlistedTypeSpecPackages(
  hostRuntime: SpecLensTypeSpecHostRuntime,
  projectPath: string,
): void {
  const scopePath = join(projectPath, 'node_modules', '@typespec')
  mkdirSync(scopePath, { recursive: true })
  for (const packageName of SPEC_LENS_TYPESPEC_RUNTIME_PACKAGE_ALLOWLIST) {
    const packagePath = hostRuntime.packagePaths[packageName]
    symlinkSync(packagePath, join(scopePath, packageName.slice('@typespec/'.length)), 'dir')
  }
}

function readHostPackageVersion(packagePath: string, packageName: string): string {
  const packageJson = parseJson(readFileSync(join(packagePath, 'package.json'), 'utf8'), `${packageName}/package.json`)
  if (!isRecord(packageJson) || packageJson.name !== packageName || typeof packageJson.version !== 'string' || packageJson.version === '') {
    throw new Error(`trusted runtime package metadata is invalid: ${packageName}`)
  }
  return packageJson.version
}

function resolveSpecLensTypeSpecHostRuntime(): SpecLensTypeSpecHostRuntime {
  const packagePaths = Object.fromEntries(
    SPEC_LENS_TYPESPEC_TOOLCHAIN_PACKAGE_ALLOWLIST.map(packageName => [
      packageName,
      resolveHostPackagePath(packageName),
    ]),
  ) as SpecLensTypeSpecHostRuntime['packagePaths']
  const compilerCliPath = realpathSync(join(packagePaths['@typespec/compiler'], 'cmd', 'tsp.js'))
  return { packagePaths, compilerCliPath }
}

function resolveHostPackagePath(packageName: string): string {
  let current = dirname(realpathSync(moduleRequire.resolve(packageName)))
  while (true) {
    const packageJsonPath = join(current, 'package.json')
    if (existsSync(packageJsonPath)) {
      const packageJson = parseJson(readFileSync(packageJsonPath, 'utf8'), packageJsonPath)
      if (isRecord(packageJson) && packageJson.name === packageName) return realpathSync(current)
    }
    const parent = dirname(current)
    if (parent === current) {
      throw new Error(`host package root could not be resolved for ${packageName}`)
    }
    current = parent
  }
}

function parseJson(content: string, path: string): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch (error) {
    throw new Error(`invalid JSON ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
