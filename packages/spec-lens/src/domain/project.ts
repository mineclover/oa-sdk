import { createHash } from 'node:crypto'

export const SPEC_LENS_SNAPSHOT_SCHEMA_VERSION = 'spec-lens.snapshot.v2' as const
export const SPEC_LENS_DIFF_SCHEMA_VERSION = 'spec-lens.diff.v2' as const
export const DEFINITION_BUILDER_VERSION = 'spec-lens.definition-builder.v1' as const
export const TYPESPEC_BUNDLE_BUILDER_VERSION = 'spec-lens.typespec-bundle.v1' as const

export type SpecProjectSourceKind = 'definition-builder' | 'typespec-bundle'

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
    targetPath,
  }
}

export function createSpecProjectIdentity(
  config: DefinitionBuilderProjectConfig,
  manifestOrTargetDigest: string,
): DefinitionBuilderProjectIdentity
export function createSpecProjectIdentity(
  config: TypeSpecBundleProjectConfig,
  manifestOrTargetDigest: string,
): TypeSpecBundleProjectIdentity
export function createSpecProjectIdentity(
  config: SpecProjectConfig,
  manifestOrTargetDigest: string,
): SpecProjectIdentity {
  const input: SpecProjectKeyInput = {
    sourceKind: config.kind,
    sourceRoot: normalizeSourceRoot(config.sourceRoot),
    manifestOrTargetDigest,
    builderVersion: config.kind === 'typespec-bundle'
      ? TYPESPEC_BUNDLE_BUILDER_VERSION
      : DEFINITION_BUILDER_VERSION,
    snapshotSchemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
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
    return {
      kind: 'definition-builder',
      sourceRoot: normalizeSourceRoot(requireNonEmptyString(value.sourceRoot, 'project.sourceRoot')),
      targetPath: requireNonEmptyString(value.targetPath, 'project.targetPath'),
    }
  }
  if (value.kind === 'typespec-bundle') {
    return {
      kind: 'typespec-bundle',
      sourceRoot: normalizeSourceRoot(requireNonEmptyString(value.sourceRoot, 'project.sourceRoot')),
      manifestPath: requireNonEmptyString(value.manifestPath, 'project.manifestPath'),
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

function normalizeSourceRoot(value: string): string {
  return normalizePath(value).replace(/^\.\//, '').replace(/\/$/, '')
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
