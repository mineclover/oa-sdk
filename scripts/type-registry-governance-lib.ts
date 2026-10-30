import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { extractTypeRegistryFile } from '../packages/codegen/src/type-registry-extractor.js'
import { createSQLiteWorkspaceIndex } from '../packages/codegen/src/sqlite-workspace-index.js'
import type {
  TypeArtifactOrigin,
  TypeArtifactRole,
  TypeBoundaryRecord,
  TypeExposureRecord,
  TypeRegistryRuntime,
  TypeRegistrySnapshot,
  WorkspaceTypeFileIndexData,
} from '../packages/codegen/src/type-registry.js'

export const TYPE_REGISTRY_POLICY_SCHEMA_VERSION = 'oa-sdk.type-registry-policy.v1' as const
export const TYPE_REGISTRY_SNAPSHOT_SCHEMA_VERSION = 'oa-sdk.type-registry-snapshot.v1' as const
export const TYPE_REGISTRY_REPORT_SCHEMA_VERSION = 'oa-sdk.type-registry-report.v1' as const

export type BoundaryBudgetRule =
  | 'boundary:any'
  | 'boundary:double-assertion'
  | 'boundary:unvalidated-deserialize'

export type GovernanceRule =
  | BoundaryBudgetRule
  | 'unresolved-public-reexport'
  | 'runtime-export-mismatch'
  | 'invalid-allowlist'

export type BoundaryBudget = {
  rule: BoundaryBudgetRule
  /**
   * Optional absolute ceiling for the whole workspace. Without it the rule is a per-file
   * ratchet against the reviewed baseline: a file may keep or reduce its count but not grow it.
   */
  maximum?: number
  owner: string
  remediation: string
}

export type TypeRegistryAllowlistEntry = {
  id: string
  rule: Exclude<GovernanceRule, 'invalid-allowlist'>
  filePath?: string
  boundaryId?: string
  packageName?: string
  exportKey?: string
  owner: string
  reason: string
  expiresOn: string
}

export type TypeRegistryPolicy = {
  schemaVersion: typeof TYPE_REGISTRY_POLICY_SCHEMA_VERSION
  owner: string
  baselinePath: string
  outputDirectory: string
  workspaceRoots: string[]
  sourceExtensions: string[]
  excludePatterns: string[]
  generatedPatterns: string[]
  boundaryBudgets: BoundaryBudget[]
  allowlist: TypeRegistryAllowlistEntry[]
}

export type ExportTargetObservation = {
  packageName: string
  packageDirectory: string
  exportKey: string
  condition: string
  runtime: TypeRegistryRuntime
  declaredTarget: string
  targetRole: 'runtime' | 'declaration-observation' | 'resource-observation'
  authorityFilePath?: string
}

export type CanonicalTypeDeclarationRecord = DeclarationDiffIdentity & {
  syntaxHash: string
  shapeHash: string
  semanticHash: string
}

export type CanonicalPublicSurface = {
  packageName: string
  exportKey: string
  runtime: TypeRegistryRuntime
  filePath: string
  exports: string[]
  hash: string
}

export type TypeRegistrySnapshotDocument = {
  schemaVersion: typeof TYPE_REGISTRY_SNAPSHOT_SCHEMA_VERSION
  policyHash: string
  sources: Array<{
    filePath: string
    packageName: string
    contentHash: string
    origin: TypeArtifactOrigin
    role: TypeArtifactRole
  }>
  exportTargets: ExportTargetObservation[]
  registry: {
    digest: string
    declarations: CanonicalTypeDeclarationRecord[]
    boundaryEvidence: TypeBoundaryRecord[]
    publicSurfaces: CanonicalPublicSurface[]
  }
}

export type DeclarationDiffIdentity = {
  identity: string
  filePath: string
  qualifiedName: string
  kind: string
  runtime: TypeRegistryRuntime
}

export type DeclarationHashChange = DeclarationDiffIdentity & {
  before: string
  after: string
}

export type PublicSurfaceChange = {
  identity: string
  before?: string
  after?: string
}

export type TypeRegistryDiff = {
  policyChanged: boolean
  added: DeclarationDiffIdentity[]
  removed: DeclarationDiffIdentity[]
  syntaxChanged: DeclarationHashChange[]
  shapeChanged: DeclarationHashChange[]
  semanticChanged: DeclarationHashChange[]
  publicSurfaceChanged: PublicSurfaceChange[]
}

export type GovernanceViolation = {
  rule: GovernanceRule
  message: string
  filePath?: string
  boundaryId?: string
  packageName?: string
  exportKey?: string
  actual?: number
  maximum?: number
}

export type BoundaryBudgetResult = {
  rule: BoundaryBudgetRule
  actual: number
  maximum?: number
  /** Count recorded in the reviewed baseline (absent when there is no baseline). */
  baseline?: number
  /** Boundaries removed relative to the baseline; run `--write` to lock the reduction in. */
  resolved: number
  /** Boundaries added relative to the baseline, summed over the files that grew. */
  increased: number
  allowed: number
  passed: boolean
}

export type TypeRegistryReport = {
  schemaVersion: typeof TYPE_REGISTRY_REPORT_SCHEMA_VERSION
  snapshotHash: string
  baselineHash?: string
  scan: {
    packageCount: number
    sourceFileCount: number
    artifactCount: number
    declarationCount: number
    relationCount: number
    boundaryCount: number
    exposureCount: number
  }
  diff: TypeRegistryDiff
  budgets: BoundaryBudgetResult[]
  violations: GovernanceViolation[]
  allowlist: {
    active: string[]
    used: string[]
    unused: string[]
  }
}

export type RunTypeRegistryGovernanceOptions = {
  root: string
  policyPath: string
  outputDirectory?: string
  baselinePath?: string
  databasePath?: string
  writeBaseline?: boolean
  /** With `writeBaseline`: accept boundaries that grew relative to the baseline. */
  allowIncrease?: boolean
  writeOutputs?: boolean
  today?: string
}

export type RunTypeRegistryGovernanceResult = {
  policy: TypeRegistryPolicy
  snapshot: TypeRegistrySnapshotDocument
  report: TypeRegistryReport
  outputDirectory: string
  baselinePath: string
  databasePath?: string
}

type WorkspacePackage = {
  packageName: string
  packageDirectory: string
  manifestPath: string
  manifest: PackageManifest
}

type PackageManifest = {
  name?: string
  exports?: unknown
  main?: string
  module?: string
  types?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

type SourceDescriptor = {
  filePath: string
  packageName: string
  packageDirectory: string
  contentHash: string
  origin: TypeArtifactOrigin
  role: TypeArtifactRole
  entries: PublicEntry[]
}

type PublicEntry = {
  packageName: string
  exportKey: string
  runtime: TypeRegistryRuntime
  filePath: string
}

type FlattenedExportTarget = {
  exportKey: string
  conditions: string[]
  target: string
}

type AllowlistMatchContext = {
  rule: Exclude<GovernanceRule, 'invalid-allowlist'>
  filePath?: string
  boundaryId?: string
  packageName?: string
  exportKey?: string
}

const require = createRequire(import.meta.url)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function loadTypeRegistryPolicy(path: string): TypeRegistryPolicy {
  const value = readJson<unknown>(path)
  const issues = validatePolicy(value)
  if (issues.length > 0) {
    throw new Error(`Invalid Type Registry policy:\n${issues.map(issue => `- ${issue}`).join('\n')}`)
  }
  return value as TypeRegistryPolicy
}

export function validatePolicy(value: unknown): string[] {
  const issues: string[] = []
  if (!isRecord(value)) return ['policy must be a JSON object']
  if (value.schemaVersion !== TYPE_REGISTRY_POLICY_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${TYPE_REGISTRY_POLICY_SCHEMA_VERSION}`)
  }
  requireNonEmptyString(value, 'owner', issues)
  requireNonEmptyString(value, 'baselinePath', issues)
  requireNonEmptyString(value, 'outputDirectory', issues)
  requireStringArray(value, 'workspaceRoots', issues)
  requireStringArray(value, 'sourceExtensions', issues)
  requireStringArray(value, 'excludePatterns', issues)
  requireStringArray(value, 'generatedPatterns', issues)

  if (!Array.isArray(value.boundaryBudgets)) {
    issues.push('boundaryBudgets must be an array')
  } else {
    const seen = new Set<string>()
    for (const [index, budget] of value.boundaryBudgets.entries()) {
      const prefix = `boundaryBudgets[${index}]`
      if (!isRecord(budget)) {
        issues.push(`${prefix} must be an object`)
        continue
      }
      if (!isBoundaryRule(budget.rule)) issues.push(`${prefix}.rule is not supported`)
      else if (seen.has(budget.rule)) issues.push(`${prefix}.rule duplicates ${budget.rule}`)
      else seen.add(budget.rule)
      if (budget.maximum !== undefined && (!Number.isSafeInteger(budget.maximum) || (budget.maximum as number) < 0)) {
        issues.push(`${prefix}.maximum must be a non-negative safe integer when present`)
      }
      requireNonEmptyString(budget, 'owner', issues, prefix)
      requireNonEmptyString(budget, 'remediation', issues, prefix)
    }
    for (const rule of boundaryRules()) {
      if (!seen.has(rule)) issues.push(`boundaryBudgets is missing ${rule}`)
    }
  }

  if (!Array.isArray(value.allowlist)) {
    issues.push('allowlist must be an array')
  } else {
    const seen = new Set<string>()
    for (const [index, entry] of value.allowlist.entries()) {
      const prefix = `allowlist[${index}]`
      if (!isRecord(entry)) {
        issues.push(`${prefix} must be an object`)
        continue
      }
      requireNonEmptyString(entry, 'id', issues, prefix)
      if (typeof entry.id === 'string') {
        if (seen.has(entry.id)) issues.push(`${prefix}.id duplicates ${entry.id}`)
        seen.add(entry.id)
      }
      if (!isAllowlistRule(entry.rule)) issues.push(`${prefix}.rule is not supported`)
      requireNonEmptyString(entry, 'owner', issues, prefix)
      requireNonEmptyString(entry, 'reason', issues, prefix)
      requireNonEmptyString(entry, 'expiresOn', issues, prefix)
      if (typeof entry.expiresOn === 'string' && !isValidIsoDate(entry.expiresOn)) {
        issues.push(`${prefix}.expiresOn must be a real YYYY-MM-DD date`)
      }
      for (const optional of ['filePath', 'boundaryId', 'packageName', 'exportKey']) {
        if (entry[optional] !== undefined && (typeof entry[optional] !== 'string' || entry[optional].length === 0)) {
          issues.push(`${prefix}.${optional} must be a non-empty string when present`)
        }
      }
    }
  }
  return issues
}

export function runTypeRegistryGovernance(
  options: RunTypeRegistryGovernanceOptions,
): RunTypeRegistryGovernanceResult {
  if (options.allowIncrease === true && options.writeBaseline !== true) {
    throw new Error('allowIncrease only applies when writing the baseline; nothing records an accepted increase otherwise')
  }
  const root = resolve(options.root)
  const policyPath = resolve(root, options.policyPath)
  const policy = loadTypeRegistryPolicy(policyPath)
  const outputDirectory = resolve(root, options.outputDirectory ?? policy.outputDirectory)
  const baselinePath = resolve(root, options.baselinePath ?? policy.baselinePath)
  const workspace = options.databasePath === undefined
    ? mkdtempSync(join(tmpdir(), 'oa-sdk-type-registry-'))
    : undefined
  const databasePath = options.databasePath === undefined
    ? join(workspace as string, 'type-registry.sqlite')
    : resolve(root, options.databasePath)

  try {
    const packages = discoverWorkspacePackages(root, policy.workspaceRoots)
    const exportTargets = packages.flatMap(workspacePackage => collectExportTargets(root, workspacePackage))
    const sources = discoverSources(root, packages, exportTargets, policy)
    const registry = indexSourcesInSQLite(root, sources, databasePath, policy)
    const canonicalRegistry = projectCanonicalRegistry(registry, exportTargets)
    const snapshot: TypeRegistrySnapshotDocument = {
      schemaVersion: TYPE_REGISTRY_SNAPSHOT_SCHEMA_VERSION,
      policyHash: sha256(canonicalJson(policy)),
      sources: sources.map(source => ({
        filePath: source.filePath,
        packageName: source.packageName,
        contentHash: source.contentHash,
        origin: source.origin,
        role: source.role,
      })),
      exportTargets,
      registry: canonicalRegistry,
    }
    const baseline = existsSync(baselinePath)
      ? readJson<TypeRegistrySnapshotDocument>(baselinePath)
      : undefined
    if (baseline !== undefined && baseline.schemaVersion !== TYPE_REGISTRY_SNAPSHOT_SCHEMA_VERSION) {
      throw new Error(`Unsupported Type Registry baseline schema: ${String(baseline.schemaVersion)}`)
    }
    const evaluation = evaluateGovernance({
      root,
      packages,
      policy,
      snapshot,
      registry,
      baseline,
      allowIncrease: options.allowIncrease === true,
      today: options.today ?? new Date().toISOString().slice(0, 10),
    })
    const report: TypeRegistryReport = {
      schemaVersion: TYPE_REGISTRY_REPORT_SCHEMA_VERSION,
      snapshotHash: sha256(canonicalJson(snapshot)),
      ...(baseline === undefined ? {} : { baselineHash: sha256(canonicalJson(baseline)) }),
      scan: {
        packageCount: packages.length,
        sourceFileCount: sources.length,
        artifactCount: registry.artifacts.length,
        declarationCount: registry.declarations.length,
        relationCount: registry.relations.length,
        boundaryCount: registry.boundaries.length,
        exposureCount: registry.exposures.length,
      },
      diff: diffTypeRegistrySnapshots(snapshot, baseline),
      budgets: evaluation.budgets,
      violations: evaluation.violations,
      allowlist: evaluation.allowlist,
    }

    if (options.writeOutputs !== false) {
      atomicWriteJson(join(outputDirectory, 'snapshot.json'), snapshot)
      atomicWriteJson(join(outputDirectory, 'report.json'), report)
    }
    if (options.writeBaseline === true) {
      if (report.violations.length > 0) {
        throw new Error(`Refusing to write a failing Type Registry baseline (${report.violations.length} violation(s))`)
      }
      atomicWriteJson(baselinePath, snapshot)
    }
    return {
      policy,
      snapshot,
      report,
      outputDirectory,
      baselinePath,
      ...(options.databasePath === undefined ? {} : { databasePath }),
    }
  } finally {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true })
  }
}

export function diffTypeRegistrySnapshots(
  current: TypeRegistrySnapshotDocument,
  baseline: TypeRegistrySnapshotDocument | undefined,
): TypeRegistryDiff {
  if (baseline === undefined) {
    return {
      policyChanged: false,
      added: current.registry.declarations.map(toDiffIdentity),
      removed: [],
      syntaxChanged: [],
      shapeChanged: [],
      semanticChanged: [],
      publicSurfaceChanged: current.registry.publicSurfaces.map(surface => ({
        identity: publicSurfaceIdentity(surface),
        after: surface.hash,
      })),
    }
  }
  const currentDeclarations = new Map(current.registry.declarations.map(item => [item.identity, item]))
  const baselineDeclarations = new Map(baseline.registry.declarations.map(item => [item.identity, item]))
  const added: DeclarationDiffIdentity[] = []
  const removed: DeclarationDiffIdentity[] = []
  const syntaxChanged: DeclarationHashChange[] = []
  const shapeChanged: DeclarationHashChange[] = []
  const semanticChanged: DeclarationHashChange[] = []
  const currentSurfaces = new Map(current.registry.publicSurfaces.map(surface => [publicSurfaceIdentity(surface), surface.hash]))
  const baselineSurfaces = new Map(baseline.registry.publicSurfaces.map(surface => [publicSurfaceIdentity(surface), surface.hash]))
  const publicSurfaceChanged: PublicSurfaceChange[] = []

  for (const [identity, item] of currentDeclarations) {
    const before = baselineDeclarations.get(identity)
    if (before === undefined) {
      added.push(toDiffIdentity(item))
      continue
    }
    if (before.syntaxHash !== item.syntaxHash) {
      syntaxChanged.push(toHashChange(item, before.syntaxHash, item.syntaxHash))
    }
    if (before.shapeHash !== item.shapeHash) {
      shapeChanged.push(toHashChange(item, before.shapeHash, item.shapeHash))
    }
    if (before.semanticHash !== item.semanticHash) {
      semanticChanged.push(toHashChange(item, before.semanticHash, item.semanticHash))
    }
  }
  for (const [identity, item] of baselineDeclarations) {
    if (!currentDeclarations.has(identity)) removed.push(toDiffIdentity(item))
  }
  for (const identity of new Set([...currentSurfaces.keys(), ...baselineSurfaces.keys()])) {
    const before = baselineSurfaces.get(identity)
    const after = currentSurfaces.get(identity)
    if (before === after) continue
    publicSurfaceChanged.push({
      identity,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
    })
  }

  return {
    policyChanged: current.policyHash !== baseline.policyHash,
    added: sortBy(added, item => item.identity),
    removed: sortBy(removed, item => item.identity),
    syntaxChanged: sortBy(syntaxChanged, item => item.identity),
    shapeChanged: sortBy(shapeChanged, item => item.identity),
    semanticChanged: sortBy(semanticChanged, item => item.identity),
    publicSurfaceChanged: sortBy(publicSurfaceChanged, item => item.identity),
  }
}

function discoverWorkspacePackages(root: string, workspaceRoots: readonly string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = []
  for (const workspaceRoot of [...workspaceRoots].sort()) {
    const absoluteRoot = resolve(root, workspaceRoot)
    if (!existsSync(absoluteRoot)) continue
    for (const entry of readdirSync(absoluteRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue
      const packageDirectory = normalizePath(join(workspaceRoot, entry.name))
      const manifestPath = resolve(root, packageDirectory, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = readJson<PackageManifest>(manifestPath)
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) continue
      packages.push({
        packageName: manifest.name,
        packageDirectory,
        manifestPath: normalizePath(relative(root, manifestPath)),
        manifest,
      })
    }
  }
  return sortBy(packages, workspacePackage => workspacePackage.packageName)
}

function collectExportTargets(root: string, workspacePackage: WorkspacePackage): ExportTargetObservation[] {
  const flattened = flattenPackageExports(workspacePackage.manifest)
  const observations = flattened.map(entry => {
    const declaration = entry.conditions.includes('types') || entry.target.endsWith('.d.ts')
    const resource = !declaration && isResourceExportTarget(entry.target)
    const runtime = runtimeForExport(entry.exportKey, entry.conditions, entry.target)
    const authorityFilePath = declaration || resource
      ? undefined
      : resolveExportAuthoritySource(root, workspacePackage.packageDirectory, entry.target)
    return {
      packageName: workspacePackage.packageName,
      packageDirectory: workspacePackage.packageDirectory,
      exportKey: entry.exportKey,
      condition: entry.conditions.length === 0 ? 'default' : entry.conditions.join('.'),
      runtime,
      declaredTarget: normalizePath(entry.target),
      targetRole: declaration
        ? 'declaration-observation' as const
        : resource
          ? 'resource-observation' as const
          : 'runtime' as const,
      ...(authorityFilePath === undefined ? {} : { authorityFilePath }),
    }
  })
  return sortBy(observations, observation => [
    observation.packageName,
    observation.exportKey,
    observation.targetRole,
    observation.runtime,
    observation.condition,
    observation.declaredTarget,
  ].join('\0'))
}

function flattenPackageExports(manifest: PackageManifest): FlattenedExportTarget[] {
  const value = manifest.exports
  const flattened: FlattenedExportTarget[] = []
  if (value !== undefined) {
    if (typeof value === 'string' || Array.isArray(value)) {
      flattenExportValue('.', value, [], flattened)
    } else if (isRecord(value)) {
      const keys = Object.keys(value).sort()
      if (keys.some(key => key.startsWith('.'))) {
        for (const key of keys) flattenExportValue(key, value[key], [], flattened)
      } else {
        flattenExportValue('.', value, [], flattened)
      }
    }
  } else {
    const runtimeTarget = manifest.module ?? manifest.main
    if (runtimeTarget !== undefined) flattened.push({ exportKey: '.', conditions: ['default'], target: runtimeTarget })
    if (manifest.types !== undefined) flattened.push({ exportKey: '.', conditions: ['types'], target: manifest.types })
  }
  return flattened
}

function flattenExportValue(
  exportKey: string,
  value: unknown,
  conditions: string[],
  output: FlattenedExportTarget[],
): void {
  if (typeof value === 'string') {
    output.push({ exportKey, conditions, target: value })
    return
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) flattenExportValue(exportKey, item, [...conditions, String(index)], output)
    return
  }
  if (!isRecord(value)) return
  for (const key of Object.keys(value).sort()) {
    flattenExportValue(exportKey, value[key], [...conditions, key], output)
  }
}

function discoverSources(
  root: string,
  packages: readonly WorkspacePackage[],
  exportTargets: readonly ExportTargetObservation[],
  policy: TypeRegistryPolicy,
): SourceDescriptor[] {
  const entriesByFile = new Map<string, PublicEntry[]>()
  for (const target of exportTargets) {
    if (target.targetRole !== 'runtime' || target.authorityFilePath === undefined) continue
    const entries = entriesByFile.get(target.authorityFilePath) ?? []
    entries.push({
      packageName: target.packageName,
      exportKey: target.exportKey,
      runtime: target.runtime,
      filePath: target.authorityFilePath,
    })
    entriesByFile.set(target.authorityFilePath, entries)
  }

  const sources: SourceDescriptor[] = []
  for (const workspacePackage of packages) {
    const sourceRoot = resolve(root, workspacePackage.packageDirectory, 'src')
    if (!existsSync(sourceRoot)) continue
    for (const absolutePath of walkFiles(sourceRoot)) {
      const filePath = normalizePath(relative(root, absolutePath))
      if (!policy.sourceExtensions.includes(sourceExtension(filePath))) continue
      if (matchesAnyPattern(filePath, policy.excludePatterns)) continue
      const sourceText = readFileSync(absolutePath, 'utf8')
      const declarationFile = filePath.endsWith('.d.ts')
      const generated = declarationFile || matchesAnyPattern(filePath, policy.generatedPatterns)
      sources.push({
        filePath,
        packageName: workspacePackage.packageName,
        packageDirectory: workspacePackage.packageDirectory,
        contentHash: sha256(sourceText),
        origin: generated ? 'generated' : 'handwritten',
        role: declarationFile ? 'observation' : generated ? 'derived' : 'authority',
        entries: dedupeBy(entriesByFile.get(filePath) ?? [], entry => [entry.exportKey, entry.runtime].join('\0')),
      })
    }
  }
  return sortBy(sources, source => source.filePath)
}

function indexSourcesInSQLite(
  root: string,
  sources: readonly SourceDescriptor[],
  databasePath: string,
  policy: TypeRegistryPolicy,
): TypeRegistrySnapshot {
  const index = createSQLiteWorkspaceIndex({
    dbPath: databasePath,
    compatibility: {
      consumer: 'type-registry-governance',
      policyHash: sha256(canonicalJson(policy)),
      exportMapHash: sha256(canonicalJson(sources.flatMap(source => source.entries))),
    },
  })
  try {
    if (index.fallbackReason !== undefined) {
      throw new Error(`SQLite Type Registry is unavailable: ${index.fallbackReason}`)
    }
    const previousArtifacts = index.snapshotTypes().artifacts
    const previousArtifactsByFile = groupBy(previousArtifacts, artifact => artifact.filePath)
    const scannedPaths = new Set(sources.map(source => source.filePath))
    const stalePaths = [...new Set(previousArtifacts
      .map(artifact => artifact.filePath)
      .filter(filePath => !scannedPaths.has(filePath)))]
    index.invalidateTypeFiles(stalePaths)

    for (const source of sources) {
      const absoluteSourcePath = resolve(root, source.filePath)
      const sourceText = readFileSync(absoluteSourcePath, 'utf8')
      const sourceStat = statSync(absoluteSourcePath)
      index.upsertFile({
        filePath: source.filePath,
        realPath: absoluteSourcePath,
        contentHash: source.contentHash,
        size: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
        parserVersion: 'oa-sdk.type-registry-governance.v1',
      })
      const previous = previousArtifactsByFile.get(source.filePath) ?? []
      if (previous.length > 0 && previous.every(artifact =>
        artifact.contentHash === source.contentHash
        && artifact.origin === source.origin
        && artifact.role === source.role)) {
        continue
      }
      const entries = source.entries.length > 0
        ? source.entries
        : [{
            packageName: source.packageName,
            exportKey: `#internal/${normalizePath(relative(source.packageDirectory, source.filePath))}`,
            runtime: 'neutral' as const,
            filePath: source.filePath,
          }]
      const extracted = entries.map(entry => extractTypeRegistryFile({
        filePath: source.filePath,
        sourceText,
        packageName: source.packageName,
        logicalModule: normalizePath(relative(source.packageDirectory, source.filePath)),
        exportKey: entry.exportKey,
        runtime: entry.runtime,
        origin: source.origin,
        role: source.role,
      }))
      index.replaceTypeFileIndex(source.filePath, mergeFileIndexData(extracted))
    }
    const snapshot = index.snapshotTypes()
    if (snapshot.artifacts.length < sources.length) {
      throw new Error(`SQLite Type Registry indexed ${snapshot.artifacts.length}/${sources.length} source artifacts`)
    }
    return snapshot
  } finally {
    index.close()
  }
}

function projectCanonicalRegistry(
  registry: TypeRegistrySnapshot,
  exportTargets: readonly ExportTargetObservation[],
): TypeRegistrySnapshotDocument['registry'] {
  const publicEntries = dedupeBy(exportTargets
    .filter((target): target is ExportTargetObservation & { authorityFilePath: string } =>
      target.targetRole === 'runtime' && target.authorityFilePath !== undefined)
    .map(target => ({
      packageName: target.packageName,
      exportKey: target.exportKey,
      runtime: target.runtime,
      filePath: target.authorityFilePath,
    })), entry => [entry.packageName, entry.exportKey, entry.runtime, entry.filePath].join('\0'))
  const artifactById = new Map(registry.artifacts.map(artifact => [artifact.artifactId, artifact]))
  const declarations: CanonicalTypeDeclarationRecord[] = registry.declarations.flatMap(declaration => {
    const artifact = artifactById.get(declaration.artifactId)
    if (artifact === undefined) return []
    return [{
      identity: [
        declaration.filePath,
        artifact.logicalModule ?? artifact.filePath,
        artifact.runtime,
        declaration.qualifiedName,
        declaration.kind,
      ].join('#'),
      filePath: declaration.filePath,
      qualifiedName: declaration.qualifiedName,
      kind: declaration.kind,
      runtime: artifact.runtime,
      syntaxHash: declaration.syntaxHash,
      shapeHash: declaration.shapeHash,
      semanticHash: declaration.semanticHash,
    }]
  })
  const publicSurfaces: CanonicalPublicSurface[] = publicEntries.map(entry => {
    const exports = resolvePublicTypeSurface(registry, entry)
    return {
      packageName: entry.packageName,
      exportKey: entry.exportKey,
      runtime: entry.runtime,
      filePath: entry.filePath,
      exports,
      hash: sha256(exports.join('\n')),
    }
  })
  return {
    digest: sha256(canonicalJson(registry)),
    declarations: sortBy(declarations, declaration => declaration.identity),
    boundaryEvidence: registry.boundaries.filter(boundary => boundaryRuleForRecord(boundary) !== undefined),
    publicSurfaces: sortBy(publicSurfaces, surface => [surface.packageName, surface.exportKey, surface.runtime].join('\0')),
  }
}

function evaluateGovernance(options: {
  root: string
  packages: readonly WorkspacePackage[]
  policy: TypeRegistryPolicy
  snapshot: TypeRegistrySnapshotDocument
  registry: TypeRegistrySnapshot
  baseline: TypeRegistrySnapshotDocument | undefined
  allowIncrease: boolean
  today: string
}): {
  budgets: BoundaryBudgetResult[]
  violations: GovernanceViolation[]
  allowlist: TypeRegistryReport['allowlist']
} {
  const { root, packages, policy, snapshot, registry, today } = options
  const violations: GovernanceViolation[] = []
  const usedAllowlist = new Set<string>()
  const activeAllowlist = policy.allowlist.filter(entry => entry.expiresOn >= today)
  for (const entry of policy.allowlist) {
    if (entry.expiresOn < today) {
      violations.push({
        rule: 'invalid-allowlist',
        message: `Allowlist ${entry.id} expired on ${entry.expiresOn}; remove it or renew it with owner review`,
        ...(entry.filePath === undefined ? {} : { filePath: entry.filePath }),
        ...(entry.packageName === undefined ? {} : { packageName: entry.packageName }),
        ...(entry.exportKey === undefined ? {} : { exportKey: entry.exportKey }),
      })
    }
  }

  const authorityFiles = new Set(snapshot.sources
    .filter(source => source.origin === 'handwritten' && source.role === 'authority')
    .map(source => source.filePath))
  const boundaryGroups = new Map<BoundaryBudgetRule, TypeBoundaryRecord[]>(boundaryRules().map(rule => [rule, []]))
  for (const boundary of registry.boundaries) {
    if (!authorityFiles.has(boundary.filePath)) continue
    const rule = boundaryRuleForRecord(boundary)
    if (rule === undefined) continue
    boundaryGroups.get(rule)?.push(boundary)
  }

  const isAllowlisted = (rule: BoundaryBudgetRule, boundary: TypeBoundaryRecord, markUsed: boolean): boolean => {
    const packageName = packageForFile(packages, boundary.filePath)?.packageName
    const match = findAllowlist(activeAllowlist, {
      rule,
      filePath: boundary.filePath,
      boundaryId: boundary.boundaryId,
      ...(packageName === undefined ? {} : { packageName }),
    })
    if (match !== undefined && markUsed) usedAllowlist.add(match.id)
    return match !== undefined
  }

  // The baseline is counted with the current allowlist, so editing the allowlist never reads as growth.
  const baselineByRule = new Map<BoundaryBudgetRule, Map<string, number>>()
  if (options.baseline !== undefined) {
    const baselineAuthority = new Set(options.baseline.sources
      .filter(source => source.origin === 'handwritten' && source.role === 'authority')
      .map(source => source.filePath))
    for (const rule of boundaryRules()) baselineByRule.set(rule, new Map())
    for (const boundary of options.baseline.registry.boundaryEvidence) {
      if (!baselineAuthority.has(boundary.filePath)) continue
      const rule = boundaryRuleForRecord(boundary)
      if (rule === undefined || isAllowlisted(rule, boundary, false)) continue
      const files = baselineByRule.get(rule) as Map<string, number>
      files.set(boundary.filePath, (files.get(boundary.filePath) ?? 0) + 1)
    }
  }

  const budgets: BoundaryBudgetResult[] = []
  for (const budget of [...policy.boundaryBudgets].sort((left, right) => left.rule.localeCompare(right.rule))) {
    const boundaries = boundaryGroups.get(budget.rule) ?? []
    const unallowed = boundaries.filter(boundary => !isAllowlisted(budget.rule, boundary, true))
    const actual = unallowed.length
    const currentByFile = new Map<string, number>()
    for (const boundary of unallowed) currentByFile.set(boundary.filePath, (currentByFile.get(boundary.filePath) ?? 0) + 1)

    const baselineFiles = baselineByRule.get(budget.rule)
    let resolved = 0
    let increased = 0
    if (baselineFiles !== undefined) {
      for (const filePath of [...new Set([...currentByFile.keys(), ...baselineFiles.keys()])].sort()) {
        const before = baselineFiles.get(filePath) ?? 0
        const now = currentByFile.get(filePath) ?? 0
        if (now < before) resolved += before - now
        if (now <= before) continue
        increased += now - before
        if (options.allowIncrease) continue
        violations.push({
          rule: budget.rule,
          message: `${budget.rule} grew in ${filePath} (${before} -> ${now}); owner=${budget.owner}; ${budget.remediation} To accept it, review the change and run with --write --allow-increase.`,
          filePath,
          actual: now,
          maximum: before,
        })
      }
    }

    const ceilingExceeded = budget.maximum !== undefined && actual > budget.maximum
    budgets.push({
      rule: budget.rule,
      actual,
      ...(budget.maximum === undefined ? {} : { maximum: budget.maximum }),
      ...(baselineFiles === undefined ? {} : { baseline: [...baselineFiles.values()].reduce((sum, count) => sum + count, 0) }),
      resolved,
      increased,
      allowed: boundaries.length - unallowed.length,
      passed: !ceilingExceeded && (increased === 0 || options.allowIncrease),
    })
    if (ceilingExceeded) {
      violations.push({
        rule: budget.rule,
        message: `${budget.rule} budget exceeded (${actual} > ${budget.maximum}); owner=${budget.owner}; ${budget.remediation}`,
        actual,
        maximum: budget.maximum as number,
      })
    }
  }

  const publicEntries = publicEntriesFromSnapshot(snapshot)
  const packageNames = new Set(packages.map(workspacePackage => workspacePackage.packageName))
  for (const entry of publicEntries) {
    const exposures = collectReachablePublicReexports(registry, entry)
    for (const exposure of exposures) {
      if (isResolvableReexport(root, packages, packageNames, exposure.filePath, exposure.targetSpecifier as string)) continue
      const context: AllowlistMatchContext = {
        rule: 'unresolved-public-reexport',
        filePath: exposure.filePath,
        packageName: entry.packageName,
        exportKey: entry.exportKey,
      }
      const match = findAllowlist(activeAllowlist, context)
      if (match !== undefined) {
        usedAllowlist.add(match.id)
        continue
      }
      violations.push({
        rule: 'unresolved-public-reexport',
        message: `${entry.packageName}${formatExportKey(entry.exportKey)} reexports unresolved target ${exposure.targetSpecifier}`,
        filePath: exposure.filePath,
        packageName: entry.packageName,
        exportKey: entry.exportKey,
      })
    }
  }

  const groupedEntries = groupBy(publicEntries, entry => `${entry.packageName}\0${entry.exportKey}`)
  for (const entries of groupedEntries.values()) {
    const unique = dedupeBy(entries, entry => `${entry.runtime}\0${entry.filePath}`)
    if (new Set(unique.map(entry => entry.runtime)).size < 2) continue
    const surfaces = unique.map(entry => ({ entry, exports: resolvePublicTypeSurface(registry, entry) }))
    const expected = surfaces[0]
    if (expected === undefined) continue
    for (const current of surfaces.slice(1)) {
      if (sameStringArray(expected.exports, current.exports)) continue
      const context: AllowlistMatchContext = {
        rule: 'runtime-export-mismatch',
        filePath: current.entry.filePath,
        packageName: current.entry.packageName,
        exportKey: current.entry.exportKey,
      }
      const match = findAllowlist(activeAllowlist, context)
      if (match !== undefined) {
        usedAllowlist.add(match.id)
        continue
      }
      violations.push({
        rule: 'runtime-export-mismatch',
        message: `${current.entry.packageName}${formatExportKey(current.entry.exportKey)} differs between ${expected.entry.runtime} and ${current.entry.runtime} type exports`,
        filePath: current.entry.filePath,
        packageName: current.entry.packageName,
        exportKey: current.entry.exportKey,
      })
    }
  }

  return {
    budgets,
    violations: sortBy(violations, violation => [
      violation.rule,
      violation.packageName ?? '',
      violation.exportKey ?? '',
      violation.filePath ?? '',
      violation.boundaryId ?? '',
      violation.message,
    ].join('\0')),
    allowlist: {
      active: activeAllowlist.map(entry => entry.id).sort(),
      used: [...usedAllowlist].sort(),
      unused: activeAllowlist.map(entry => entry.id).filter(id => !usedAllowlist.has(id)).sort(),
    },
  }
}

function publicEntriesFromSnapshot(snapshot: TypeRegistrySnapshotDocument): PublicEntry[] {
  return dedupeBy(snapshot.exportTargets
    .filter((target): target is ExportTargetObservation & { authorityFilePath: string } =>
      target.targetRole === 'runtime' && target.authorityFilePath !== undefined)
    .map(target => ({
      packageName: target.packageName,
      exportKey: target.exportKey,
      runtime: target.runtime,
      filePath: target.authorityFilePath,
    })), entry => [entry.packageName, entry.exportKey, entry.runtime, entry.filePath].join('\0'))
}

function collectReachablePublicFiles(registry: TypeRegistrySnapshot, entry: PublicEntry): string[] {
  const files = new Set<string>()
  const byFile = groupBy(registry.exposures, exposure => exposure.filePath)
  const visit = (filePath: string, initial: boolean): void => {
    if (files.has(filePath)) return
    files.add(filePath)
    for (const exposure of byFile.get(filePath) ?? []) {
      if (initial && (
        exposure.packageName !== entry.packageName
        || exposure.exportKey !== entry.exportKey
        || exposure.runtime !== entry.runtime
      )) continue
      if (!exposure.reexport || exposure.targetSpecifier === undefined) continue
      const target = resolveRelativeRegistryPath(registry, exposure.filePath, exposure.targetSpecifier)
      if (target !== undefined) visit(target, false)
    }
  }
  visit(entry.filePath, true)
  return [...files].sort()
}

function collectReachablePublicReexports(
  registry: TypeRegistrySnapshot,
  entry: PublicEntry,
): TypeExposureRecord[] {
  const reachable = new Set(collectReachablePublicFiles(registry, entry))
  return registry.exposures.filter(exposure => {
    if (!reachable.has(exposure.filePath) || !exposure.reexport || exposure.targetSpecifier === undefined) return false
    if (exposure.filePath !== entry.filePath) return true
    return exposure.packageName === entry.packageName
      && exposure.exportKey === entry.exportKey
      && exposure.runtime === entry.runtime
  })
}

function resolvePublicTypeSurface(registry: TypeRegistrySnapshot, entry: PublicEntry): string[] {
  const byFile = groupBy(registry.exposures, exposure => exposure.filePath)
  const visit = (filePath: string, exportKey: string, runtime: TypeRegistryRuntime, seen: Set<string>): string[] => {
    const marker = `${filePath}\0${exportKey}\0${runtime}`
    if (seen.has(marker)) return []
    seen.add(marker)
    const surface: string[] = []
    for (const exposure of byFile.get(filePath) ?? []) {
      const isPublicEntry = filePath === entry.filePath
      if (isPublicEntry && (exposure.exportKey !== exportKey || exposure.runtime !== runtime)) continue
      if (!exposure.reexport || exposure.targetSpecifier === undefined) {
        surface.push(`${exposure.exportName}:${exposure.kind}`)
        continue
      }
      if (exposure.exportName !== '*') {
        surface.push(`${exposure.exportName}:${exposure.kind}`)
        continue
      }
      const target = resolveRelativeRegistryPath(registry, exposure.filePath, exposure.targetSpecifier)
      if (target !== undefined) surface.push(...visit(target, `#internal/${target}`, 'neutral', seen))
    }
    return [...new Set(surface)].sort()
  }
  return visit(entry.filePath, entry.exportKey, entry.runtime, new Set())
}

function toDiffIdentity(item: CanonicalTypeDeclarationRecord): DeclarationDiffIdentity {
  return {
    identity: item.identity,
    filePath: item.filePath,
    qualifiedName: item.qualifiedName,
    kind: item.kind,
    runtime: item.runtime,
  }
}

function toHashChange(item: CanonicalTypeDeclarationRecord, before: string, after: string): DeclarationHashChange {
  return { ...toDiffIdentity(item), before, after }
}

function boundaryRuleForRecord(boundary: TypeBoundaryRecord): BoundaryBudgetRule | undefined {
  if (boundary.kind === 'any') return 'boundary:any'
  if (boundary.kind === 'double-assertion') return 'boundary:double-assertion'
  if (boundary.kind === 'deserialize' && boundary.validatorSymbol === undefined) {
    return 'boundary:unvalidated-deserialize'
  }
  return undefined
}

function findAllowlist(
  allowlist: readonly TypeRegistryAllowlistEntry[],
  context: AllowlistMatchContext,
): TypeRegistryAllowlistEntry | undefined {
  return allowlist.find(entry =>
    entry.rule === context.rule
    && matchesOptionalPattern(entry.filePath, context.filePath)
    && matchesOptional(entry.boundaryId, context.boundaryId)
    && matchesOptional(entry.packageName, context.packageName)
    && matchesOptional(entry.exportKey, context.exportKey))
}

function isResolvableReexport(
  root: string,
  packages: readonly WorkspacePackage[],
  packageNames: ReadonlySet<string>,
  fromFilePath: string,
  targetSpecifier: string,
): boolean {
  if (targetSpecifier.startsWith('.')) return resolveRelativeSourcePath(fromFilePath, targetSpecifier, root) !== undefined
  const workspaceTarget = longestPackagePrefix(targetSpecifier, packageNames)
  if (workspaceTarget !== undefined) {
    const workspacePackage = packages.find(candidate => candidate.packageName === workspaceTarget)
    if (workspacePackage === undefined) return false
    const subpath = targetSpecifier === workspaceTarget ? '.' : `.${targetSpecifier.slice(workspaceTarget.length)}`
    return flattenPackageExports(workspacePackage.manifest).some(entry => entry.exportKey === subpath)
  }
  try {
    require.resolve(targetSpecifier, { paths: [resolve(root, dirname(fromFilePath))] })
    return true
  } catch {
    return false
  }
}

function longestPackagePrefix(specifier: string, packageNames: ReadonlySet<string>): string | undefined {
  return [...packageNames]
    .filter(packageName => specifier === packageName || specifier.startsWith(`${packageName}/`))
    .sort((left, right) => right.length - left.length)[0]
}

function resolveExportAuthoritySource(
  root: string,
  packageDirectory: string,
  target: string,
): string | undefined {
  const normalizedTarget = normalizePath(target).replace(/^\.\//, '')
  const sourceRelative = normalizedTarget.startsWith('dist/')
    ? `src/${normalizedTarget.slice('dist/'.length)}`
    : normalizedTarget.startsWith('src/')
      ? normalizedTarget
      : `src/${normalizedTarget}`
  const withoutDeclaration = sourceRelative.replace(/\.d\.(?:mts|cts|ts)$/u, '')
  const withoutRuntimeExtension = withoutDeclaration.replace(/\.(?:mjs|cjs|js|jsx)$/u, '')
  const candidates = [
    withoutRuntimeExtension,
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    `${withoutRuntimeExtension}.mts`,
    `${withoutRuntimeExtension}.cts`,
    `${withoutRuntimeExtension}/index.ts`,
    `${withoutRuntimeExtension}/index.tsx`,
  ]
  for (const candidate of candidates) {
    const absolute = resolve(root, packageDirectory, candidate)
    if (existsSync(absolute) && statSync(absolute).isFile()) return normalizePath(relative(root, absolute))
  }
  return undefined
}

function resolveRelativeSourcePath(fromFilePath: string, targetSpecifier: string, root?: string): string | undefined {
  if (!targetSpecifier.startsWith('.')) return undefined
  const base = resolve(root ?? '/', dirname(fromFilePath), targetSpecifier)
  const candidates = [
    base,
    base.replace(/\.(?:mjs|cjs|js|jsx)$/u, '.ts'),
    base.replace(/\.(?:mjs|cjs|js|jsx)$/u, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
    return normalizePath(root === undefined ? candidate.replace(/^\//, '') : relative(root, candidate))
  }
  return undefined
}

function resolveRelativeRegistryPath(
  registry: TypeRegistrySnapshot,
  fromFilePath: string,
  targetSpecifier: string,
): string | undefined {
  if (!targetSpecifier.startsWith('.')) return undefined
  const knownFiles = new Set(registry.artifacts.map(artifact => artifact.filePath))
  const base = normalizePath(resolve('/', dirname(fromFilePath), targetSpecifier).replace(/^\//, ''))
  const candidates = [
    base,
    base.replace(/\.(?:mjs|cjs|js|jsx)$/u, '.ts'),
    base.replace(/\.(?:mjs|cjs|js|jsx)$/u, '.tsx'),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  return candidates.find(candidate => knownFiles.has(candidate))
}

function runtimeForExport(exportKey: string, conditions: readonly string[], target: string): TypeRegistryRuntime {
  if (conditions.includes('browser') || exportKey.endsWith('/browser') || /(?:^|[/.])browser(?:[/.]|$)/u.test(target)) return 'browser'
  if (conditions.includes('bun') || /(?:^|[/.])bun(?:[/.]|$)/u.test(target)) return 'bun'
  if (conditions.includes('node') || /(?:^|[/.])node(?:[/.]|$)/u.test(target)) return 'node'
  return 'neutral'
}

function isResourceExportTarget(target: string): boolean {
  if (target.includes('*')) return true
  const extension = extname(target.replace(/\*$/u, 'placeholder'))
  return extension.length > 0
    && !['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(extension)
}

function mergeFileIndexData(parts: readonly WorkspaceTypeFileIndexData[]): WorkspaceTypeFileIndexData {
  return {
    artifacts: mergeRecords(parts.flatMap(part => part.artifacts ?? []), record => record.artifactId),
    declarations: mergeRecords(parts.flatMap(part => part.declarations ?? []), record => record.declarationId),
    relations: mergeRecords(parts.flatMap(part => part.relations ?? []), record => record.relationId),
    boundaries: mergeRecords(parts.flatMap(part => part.boundaries ?? []), record => record.boundaryId),
    exposures: mergeRecords(parts.flatMap(part => part.exposures ?? []), record => record.exposureId),
  }
}

function mergeRecords<T>(records: readonly T[], identity: (record: T) => string): T[] {
  return [...new Map(records.map(record => [identity(record), record])).values()]
    .sort((left, right) => identity(left).localeCompare(identity(right)))
}

function walkFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function sourceExtension(filePath: string): string {
  if (filePath.endsWith('.d.ts')) return '.d.ts'
  return extname(filePath)
}

function packageForFile(packages: readonly WorkspacePackage[], filePath: string): WorkspacePackage | undefined {
  return packages.find(workspacePackage =>
    filePath === workspacePackage.packageDirectory || filePath.startsWith(`${workspacePackage.packageDirectory}/`))
}

function formatExportKey(exportKey: string): string {
  return exportKey === '.' ? '' : exportKey.slice(1)
}

function publicSurfaceIdentity(surface: CanonicalPublicSurface): string {
  return [surface.packageName, surface.exportKey, surface.runtime, surface.filePath].join('#')
}

function matchesOptional(expected: string | undefined, actual: string | undefined): boolean {
  return expected === undefined || expected === actual
}

function matchesOptionalPattern(pattern: string | undefined, actual: string | undefined): boolean {
  return pattern === undefined || (actual !== undefined && matchesPattern(actual, pattern))
}

function matchesAnyPattern(filePath: string, patterns: readonly string[]): boolean {
  return patterns.some(pattern => matchesPattern(filePath, pattern))
}

export function matchesPattern(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  const regexSource = escaped
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\?/gu, '[^/]')
    .replace(/\u0000/gu, '.*')
  return new RegExp(`^${regexSource}$`, 'u').test(value)
}

function isBoundaryRule(value: unknown): value is BoundaryBudgetRule {
  return typeof value === 'string' && boundaryRules().includes(value as BoundaryBudgetRule)
}

function isAllowlistRule(value: unknown): value is TypeRegistryAllowlistEntry['rule'] {
  return isBoundaryRule(value) || value === 'unresolved-public-reexport' || value === 'runtime-export-mismatch'
}

function boundaryRules(): BoundaryBudgetRule[] {
  return ['boundary:any', 'boundary:double-assertion', 'boundary:unvalidated-deserialize']
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function requireNonEmptyString(
  value: Record<string, unknown>,
  key: string,
  issues: string[],
  prefix = '',
): void {
  if (typeof value[key] !== 'string' || (value[key] as string).trim().length === 0) {
    issues.push(`${prefix.length > 0 ? `${prefix}.` : ''}${key} must be a non-empty string`)
  }
}

function requireStringArray(value: Record<string, unknown>, key: string, issues: string[]): void {
  if (!Array.isArray(value[key]) || !(value[key] as unknown[]).every(item => typeof item === 'string' && item.length > 0)) {
    issues.push(`${key} must be an array of non-empty strings`)
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${createHash('sha256').update(path).digest('hex').slice(0, 8)}.tmp`
  try {
    writeFileSync(temporaryPath, `${canonicalJson(value)}\n`, 'utf8')
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value), null, 2)
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortJsonValue(value[key])]))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sortBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)))
}

function dedupeBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map(value => [key(value), value])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)))
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>()
  for (const value of values) {
    const group = result.get(key(value)) ?? []
    group.push(value)
    result.set(key(value), group)
  }
  return result
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
