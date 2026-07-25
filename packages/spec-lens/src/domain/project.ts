import { createHash } from 'node:crypto'
import { posix } from 'node:path'

export const SPEC_LENS_SNAPSHOT_SCHEMA_VERSION = 'spec-lens.snapshot.v2' as const
export const SPEC_LENS_DIFF_SCHEMA_VERSION = 'spec-lens.diff.v2' as const
export const DEFINITION_BUILDER_VERSION = 'spec-lens.definition-builder.v1' as const
export const TYPESPEC_BUNDLE_BUILDER_VERSION = 'spec-lens.typespec-bundle.v2' as const
export const DEFINITION_BUILDER_TOOLCHAIN_FINGERPRINT =
  'oa-sdk.definition-builder.toolchain.v1' as const
export const MAX_TYPESPEC_OBSERVATION_INPUTS = 16
export const MAX_TYPESPEC_EVIDENCE_INPUTS = 4
export const MAX_TYPESPEC_EVIDENCE_INPUT_BYTES = 2 * 1024 * 1024
export const MAX_TYPESPEC_EVIDENCE_CONCURRENCY = 2
export const MAX_TYPESPEC_EVIDENCE_TOTAL_BYTES =
  MAX_TYPESPEC_EVIDENCE_INPUTS * MAX_TYPESPEC_EVIDENCE_INPUT_BYTES

export type SpecProjectSourceKind = 'definition-builder' | 'typespec-bundle'
export type SpecObservationAdapterKind = 'github' | 'gitlab' | 'local-git' | 'file'

export type SpecObservationIdentity = Readonly<{
  adapterKind: SpecObservationAdapterKind
  repository: string
  ref: string
}>

export type DefinitionBuilderProjectConfig = {
  kind: 'definition-builder'
  sourceRoot: string
  targetPath: string
}

export type TypeSpecBundleProjectConfig = {
  kind: 'typespec-bundle'
  sourceRoot: string
  manifestPath: string
  /** @deprecated Use observationInputs with class: 'candidate-only'. */
  watchPaths?: string[]
  /** Explicit, bounded repo-relative inputs observed with a TypeSpec revision. */
  observationInputs?: readonly TypeSpecObservationInput[]
}

export type TypeSpecObservationInputClass = 'candidate-only' | 'evidence-only'

export type TypeSpecObservationInput = Readonly<{
  path: string
  class: TypeSpecObservationInputClass
}>

/**
 * Ergonomic config surface for external TypeSpec observations. It is normalized
 * to TypeSpecObservationInput before it reaches project identity or adapters.
 */
export type TypeSpecObservationConfig = Readonly<{
  candidates?: readonly string[]
  evidence?: readonly string[]
}>

export function assertTypeSpecObservationInputLimits(
  inputs: readonly TypeSpecObservationInput[],
): void {
  if (inputs.length > MAX_TYPESPEC_OBSERVATION_INPUTS) {
    throw new Error(`project.observationInputs must not exceed ${MAX_TYPESPEC_OBSERVATION_INPUTS} entries`)
  }
  const evidenceInputs = inputs.filter(input => input.class === 'evidence-only')
  if (evidenceInputs.length > MAX_TYPESPEC_EVIDENCE_INPUTS) {
    throw new Error(
      `project.evidence-only inputs must not exceed ${MAX_TYPESPEC_EVIDENCE_INPUTS} entries ` +
      `(${MAX_TYPESPEC_EVIDENCE_TOTAL_BYTES} byte aggregate budget)`,
    )
  }
}

export type SpecProjectConfig = DefinitionBuilderProjectConfig | TypeSpecBundleProjectConfig

export type SpecProjectKeyInput = {
  sourceKind: SpecProjectSourceKind
  sourceRoot: string
  manifestOrTargetDigest: string
  builderVersion: string
  snapshotSchemaVersion: string
  toolchainFingerprint: string
  observation: SpecObservationIdentity
}

type SpecProjectIdentityBase = Readonly<SpecProjectKeyInput & {
  projectKey: string
}>

export type DefinitionBuilderProjectIdentity = SpecProjectIdentityBase & {
  sourceKind: 'definition-builder'
}

export type TypeSpecBundleProjectIdentity = SpecProjectIdentityBase & {
  sourceKind: 'typespec-bundle'
  observationInputs?: readonly TypeSpecObservationInput[]
}

export type SpecProjectIdentity = DefinitionBuilderProjectIdentity | TypeSpecBundleProjectIdentity

export function resolveSpecProjectConfig(input: {
  project?: unknown
  fragmentsDir?: unknown
  targetPath?: unknown
}): SpecProjectConfig {
  if (input.project !== undefined) {
    return parseProject(input.project)
  }

  const fragmentsDir = requireNonEmptyString(input.fragmentsDir, 'fragmentsDir')
  const targetPath = requireNonEmptyString(input.targetPath, 'targetPath')
  return {
    kind: 'definition-builder',
    sourceRoot: normalizeSourceRoot(fragmentsDir),
    targetPath: normalizeRepoRelativePath(targetPath, 'targetPath'),
  }
}

export function createSpecProjectIdentity(
  config: DefinitionBuilderProjectConfig,
  manifestOrTargetDigest: string,
  observation: SpecObservationIdentity,
): DefinitionBuilderProjectIdentity
export function createSpecProjectIdentity(
  config: TypeSpecBundleProjectConfig,
  manifestOrTargetDigest: string,
  observation: SpecObservationIdentity,
  toolchainFingerprint: string,
): TypeSpecBundleProjectIdentity
export function createSpecProjectIdentity(
  config: SpecProjectConfig,
  manifestOrTargetDigest: string,
  observation: SpecObservationIdentity,
  toolchainFingerprint?: string,
): SpecProjectIdentity {
  const observationInputs = config.kind === 'typespec-bundle' && config.observationInputs !== undefined
    ? normalizeObservationInputs(config.observationInputs)
    : undefined
  if (observationInputs !== undefined) assertTypeSpecObservationInputLimits(observationInputs)
  const input: SpecProjectKeyInput = {
    sourceKind: config.kind,
    sourceRoot: normalizeSourceRoot(config.sourceRoot),
    manifestOrTargetDigest: observationInputs !== undefined
      ? sha256(JSON.stringify({ manifestOrTargetDigest, observationInputs }))
      : manifestOrTargetDigest,
    builderVersion: config.kind === 'typespec-bundle'
      ? TYPESPEC_BUNDLE_BUILDER_VERSION
      : DEFINITION_BUILDER_VERSION,
    snapshotSchemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
    toolchainFingerprint: config.kind === 'typespec-bundle'
      ? requireSha256(toolchainFingerprint, 'toolchainFingerprint')
      : DEFINITION_BUILDER_TOOLCHAIN_FINGERPRINT,
    observation: normalizeObservationIdentity(observation),
  }
  return {
    ...input,
    ...(observationInputs !== undefined
      ? { observationInputs }
      : {}),
    projectKey: buildSpecProjectKey(input),
  } as SpecProjectIdentity
}

export function buildSpecProjectKey(input: SpecProjectKeyInput): string {
  const normalized = {
    builderVersion: input.builderVersion,
    manifestOrTargetDigest: input.manifestOrTargetDigest,
    snapshotSchemaVersion: input.snapshotSchemaVersion,
    sourceKind: input.sourceKind,
    sourceRoot: normalizeSourceRoot(input.sourceRoot),
    toolchainFingerprint: input.sourceKind === 'typespec-bundle'
      ? requireSha256(input.toolchainFingerprint, 'toolchainFingerprint')
      : requireNonEmptyString(input.toolchainFingerprint, 'toolchainFingerprint'),
    observation: normalizeObservationIdentity(input.observation),
  }
  return sha256(JSON.stringify(normalized))
}

export function buildManifestOrTargetDigest(path: string, contentDigest: string): string {
  return sha256(JSON.stringify({ path: normalizePath(path), contentDigest }))
}

export function digestText(value: string): string {
  return sha256(value)
}

function parseProject(value: unknown): SpecProjectConfig {
  if (!isRecord(value)) throw new Error('project must be an object')
  if (value.kind === 'definition-builder') {
    const sourceRoot = normalizeSourceRoot(requireNonEmptyString(value.sourceRoot, 'project.sourceRoot'))
    return {
      kind: 'definition-builder',
      sourceRoot,
      targetPath: normalizeRepoRelativePath(
        requireNonEmptyString(value.targetPath, 'project.targetPath'),
        'project.targetPath',
      ),
    }
  }
  if (value.kind === 'typespec-bundle') {
    const sourceRoot = normalizeSourceRoot(requireNonEmptyString(value.sourceRoot, 'project.sourceRoot'))
    const manifestPath = normalizeRepoRelativePath(
      requireNonEmptyString(value.manifestPath, 'project.manifestPath'),
      'project.manifestPath',
    )
    assertPathInsideSourceRoot(sourceRoot, manifestPath, 'project.manifestPath')
    const observationInputs = parseObservationInputs(
      value.observation,
      value.observationInputs,
      value.watchPaths,
    )
    return {
      kind: 'typespec-bundle',
      sourceRoot,
      manifestPath,
      ...(observationInputs !== undefined ? { observationInputs } : {}),
    }
  }
  throw new Error('project.kind must be definition-builder or typespec-bundle')
}

function parseObservationInputs(
  observation: unknown,
  typedInputs: unknown,
  legacyWatchPaths: unknown,
): TypeSpecObservationInput[] | undefined {
  const configuredSurfaces = [observation, typedInputs, legacyWatchPaths]
    .filter(value => value !== undefined)
  if (configuredSurfaces.length > 1) {
    throw new Error('use only one of project.observation, project.observationInputs, or project.watchPaths')
  }
  if (observation !== undefined) return parseSimpleObservation(observation)
  if (typedInputs === undefined) return parseLegacyWatchPaths(legacyWatchPaths)
  if (!Array.isArray(typedInputs)) throw new Error('project.observationInputs must be an array')
  const inputs = typedInputs.map((input, index) => {
    if (!isRecord(input)) throw new Error(`project.observationInputs[${index}] must be an object`)
    const inputClass = input.class
    if (inputClass !== 'candidate-only' && inputClass !== 'evidence-only') {
      throw new Error(`project.observationInputs[${index}].class must be candidate-only or evidence-only`)
    }
    const path = normalizeRepoRelativePath(
      requireNonEmptyString(input.path, `project.observationInputs[${index}].path`),
      `project.observationInputs[${index}].path`,
    )
    return { path, class: inputClass } as const
  })
  return normalizeAndAssertObservationInputs(inputs)
}

function parseSimpleObservation(value: unknown): TypeSpecObservationInput[] {
  if (!isRecord(value)) throw new Error('project.observation must be an object')
  const candidates = parseObservationPaths(value.candidates, 'project.observation.candidates')
  const evidence = parseObservationPaths(value.evidence, 'project.observation.evidence')
  return normalizeAndAssertObservationInputs([
    ...candidates.map(path => ({ path, class: 'candidate-only' as const })),
    ...evidence.map(path => ({ path, class: 'evidence-only' as const })),
  ])
}

function parseObservationPaths(value: unknown, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${path} must be an array of repo-relative paths`)
  return value.map((entry, index) => normalizeRepoRelativePath(
    requireNonEmptyString(entry, `${path}[${index}]`),
    `${path}[${index}]`,
  ))
}

function parseLegacyWatchPaths(value: unknown): TypeSpecObservationInput[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error('project.watchPaths must be an array of repo-relative paths')
  return normalizeAndAssertObservationInputs(value.map((path, index) => ({
    path: normalizeRepoRelativePath(
      requireNonEmptyString(path, `project.watchPaths[${index}]`),
      `project.watchPaths[${index}]`,
    ),
    class: 'candidate-only' as const,
  })))
}

function normalizeObservationInputs(inputs: readonly TypeSpecObservationInput[]): TypeSpecObservationInput[] {
  const sorted = [...inputs].sort((left, right) => left.path.localeCompare(right.path))
  if (sorted.some((input, index) => index > 0 && input.path === sorted[index - 1]?.path)) {
    throw new Error('project observation input paths must not contain duplicates')
  }
  return sorted
}

function normalizeAndAssertObservationInputs(inputs: readonly TypeSpecObservationInput[]): TypeSpecObservationInput[] {
  const normalized = normalizeObservationInputs(inputs)
  assertTypeSpecObservationInputLimits(normalized)
  return normalized
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${path} must be a non-empty string`)
  }
  return value
}

function requireSha256(value: unknown, path: string): string {
  const fingerprint = requireNonEmptyString(value, path)
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
    throw new Error(`${path} must be a SHA-256 fingerprint`)
  }
  return fingerprint.toLowerCase()
}

function normalizeSourceRoot(value: string): string {
  return normalizeRepoRelativePath(value, 'sourceRoot')
}

function normalizeRepoRelativePath(value: string, label: string): string {
  const normalized = normalizePath(value)
  if (normalized.includes('\0') || posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`${label} must be repo-relative`)
  }
  const collapsed = posix.normalize(normalized).replace(/^\.\//, '').replace(/\/$/, '')
  if (collapsed === '..' || collapsed.startsWith('../')) {
    throw new Error(`${label} must stay inside the repository`)
  }
  return collapsed || '.'
}

function assertPathInsideSourceRoot(sourceRoot: string, path: string, label: string): void {
  const relativePath = sourceRoot === '.' ? path : posix.relative(sourceRoot, path)
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith('../') || posix.isAbsolute(relativePath)) {
    throw new Error(`${label} must name a file inside project.sourceRoot`)
  }
}

function normalizeObservationIdentity(value: SpecObservationIdentity): SpecObservationIdentity {
  const repository = requireNonEmptyString(value.repository, 'observation.repository')
    .replaceAll('\\', '/')
    .replace(/\/$/, '')
  const ref = requireNonEmptyString(value.ref, 'observation.ref')
  if (!['github', 'gitlab', 'local-git', 'file'].includes(value.adapterKind)) {
    throw new Error('observation.adapterKind must be github, gitlab, local-git, or file')
  }
  return { adapterKind: value.adapterKind, repository, ref }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
