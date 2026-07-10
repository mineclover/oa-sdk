import { createHash } from 'node:crypto'
import { posix } from 'node:path'

export const SPEC_LENS_SNAPSHOT_SCHEMA_VERSION = 'spec-lens.snapshot.v2' as const
export const SPEC_LENS_DIFF_SCHEMA_VERSION = 'spec-lens.diff.v2' as const
export const DEFINITION_BUILDER_VERSION = 'spec-lens.definition-builder.v1' as const
export const TYPESPEC_BUNDLE_BUILDER_VERSION = 'spec-lens.typespec-bundle.v2' as const
export const DEFINITION_BUILDER_TOOLCHAIN_FINGERPRINT =
  'oa-sdk.definition-builder.toolchain.v1' as const

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
  const input: SpecProjectKeyInput = {
    sourceKind: config.kind,
    sourceRoot: normalizeSourceRoot(config.sourceRoot),
    manifestOrTargetDigest,
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
    return {
      kind: 'typespec-bundle',
      sourceRoot,
      manifestPath,
    }
  }
  throw new Error('project.kind must be definition-builder or typespec-bundle')
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
