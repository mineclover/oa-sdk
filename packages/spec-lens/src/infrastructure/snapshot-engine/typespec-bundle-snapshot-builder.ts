import {
  compileTypeSpecBundleForSpecLens,
  type CompileTypeSpecBundleForSpecLensOptions,
  type CompileTypeSpecBundleForSpecLensResult,
} from '@oa-sdk/codegen/spec-lens'
import type {
  SnapshotBuilderPort,
  TypeSpecBundleBuildSnapshotOptions,
} from '../../application/ports/snapshot-builder.port.js'
import type {
  SpecSnapshotDiagnostic,
  SpecSnapshotStored,
  SpecTimelineDiff,
  SpecLensObservedInputEvidence,
  SpecProvenanceMap,
  TypeSpecBundleSpecSnapshot,
} from '../../domain/index.js'
import { SPEC_LENS_SNAPSHOT_SCHEMA_VERSION } from '../../domain/project.js'
import { SnapshotBuilder } from './snapshot-builder.js'

export type TypeSpecBundleCompiler = (
  options: CompileTypeSpecBundleForSpecLensOptions,
) => Promise<CompileTypeSpecBundleForSpecLensResult>

export class TypeSpecBundleSnapshotBuilder implements SnapshotBuilderPort<'typespec-bundle'> {
  private readonly diffBuilder = new SnapshotBuilder()

  constructor(
    private readonly compile: TypeSpecBundleCompiler = compileTypeSpecBundleForSpecLens,
    private readonly runtimeRoot: string = process.cwd(),
  ) {}

  async build(options: TypeSpecBundleBuildSnapshotOptions): Promise<TypeSpecBundleSpecSnapshot> {
    const compiled = await this.compile({
      sourceRoot: options.sourceRoot,
      manifestPath: options.manifestPath,
      entries: options.entries,
      runtimeRoot: this.runtimeRoot,
    })
    if (compiled.evidence.toolchain.fingerprint !== options.project.toolchainFingerprint) {
      throw new Error(
        `TypeSpec toolchain fingerprint mismatch: project=${options.project.toolchainFingerprint} compile=${compiled.evidence.toolchain.fingerprint}`,
      )
    }
    const entryByPath = new Map(options.entries.map(entry => [normalizePath(entry.relativePath), entry]))
    const sourceFiles = compiled.evidence.sourceFiles.map(relativePath => {
      const entry = entryByPath.get(normalizePath(relativePath))
      if (!entry) throw new Error(`compiled TypeSpec source evidence is missing revision entry: ${relativePath}`)
      return { relativePath, contentHash: entry.contentHash }
    })

    const provenanceEntries = createTypeSpecProvenanceMap(compiled.provenance, entryByPath)
    const diagnostics: SpecSnapshotDiagnostic[] = provenanceEntries === undefined
      ? [{
          code: 'TYPESPEC_POINTER_PROVENANCE_UNAVAILABLE',
          severity: 'info',
          message: 'TypeSpec output-pointer provenance is unavailable; reachable source-file evidence is recorded instead.',
        }]
      : []
    if (!compiled.evidence.validation.emitted.valid) {
      diagnostics.push({
        code: 'TYPESPEC_EMITTED_VALIDATION_WARNING',
        severity: 'warning',
        message: compiled.evidence.validation.emitted.summary,
      })
    }
    if (compiled.evidence.validation.expected && !compiled.evidence.validation.expected.valid) {
      diagnostics.push({
        code: 'TYPESPEC_EXPECTED_VALIDATION_WARNING',
        severity: 'warning',
        message: compiled.evidence.validation.expected.summary,
      })
    }

    return {
      schemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
      projectKey: options.project.projectKey,
      projectKind: 'typespec-bundle',
      sourceRoot: options.project.sourceRoot,
      revision: options.revision,
      manifestPath: options.manifestPath,
      spec: compiled.document,
      provenance: provenanceEntries === undefined
        ? {
            status: 'unavailable',
            kind: 'typespec-source-files',
            reason: 'output-pointer-mapping-unavailable',
            sourceFiles,
            observedInputs: normalizeObservedInputs(options.observedInputs),
            compile: compiled.evidence,
          }
        : {
            status: 'available',
            kind: 'typespec-source-ast',
            entries: provenanceEntries,
            sourceFiles,
            observedInputs: normalizeObservedInputs(options.observedInputs),
            compile: compiled.evidence,
          },
      diagnostics,
      builtAt: Date.now(),
    }
  }

  diff(base: SpecSnapshotStored, head: SpecSnapshotStored): SpecTimelineDiff {
    return this.diffBuilder.diff(base, head)
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function normalizeObservedInputs(entries: readonly SpecLensObservedInputEvidence[]) {
  return [...entries].sort((left, right) => left.path.localeCompare(right.path))
}

function createTypeSpecProvenanceMap(
  provenance: CompileTypeSpecBundleForSpecLensResult['provenance'],
  entryByPath: Map<string, { contentHash: string }>,
): SpecProvenanceMap | undefined {
  if (provenance.provenanceKind !== 'typespec-source-ast') return undefined
  const declarations = new Map(provenance.declarations.map(declaration => [declaration.id, declaration]))
  const entries: SpecProvenanceMap = {}
  for (const edge of provenance.edges) {
    if (edge.kind !== 'emits' && edge.kind !== 'restores') continue
    if (entries[edge.outputPointer] !== undefined && edge.kind === 'restores') continue
    const declaration = declarations.get(edge.declarationId)
    if (!declaration) return undefined
    const sourcePath = normalizePath(declaration.source.file)
    const entry = entryByPath.get(sourcePath)
    if (!entry) return undefined
    const kind: 'schema' | 'operation' | 'response' | 'parameter' | 'securityScheme' = declaration.kind === 'model'
      ? 'schema'
      : declaration.kind === 'operation'
        ? 'operation'
        : inferOpenApiKind(edge.outputPointer)
    const provenanceEntry: SpecProvenanceMap[string] = {
      canonicalId: `${kind}:typespec/${sourcePath.replaceAll('/', '_')}/${declaration.symbol}`,
      kind,
      sourcePath,
      sourcePointer: `#L${declaration.source.start.line}:C${declaration.source.start.column}`,
      contentHash: entry.contentHash,
    }
    entries[edge.outputPointer] = provenanceEntry
    const pathPointer = outputPathItemPointer(edge.outputPointer)
    if (pathPointer !== undefined && entries[pathPointer] === undefined) {
      entries[pathPointer] = provenanceEntry
    }
  }
  return Object.keys(entries).length > 0 ? entries : undefined
}

function outputPathItemPointer(pointer: string): string | undefined {
  const match = /^(#\/paths\/[^/]+)\/(get|post|put|patch|delete|head|options|trace)$/.exec(pointer)
  return match?.[1]
}

function inferOpenApiKind(pointer: string): 'response' | 'parameter' | 'securityScheme' | 'operation' {
  if (pointer.startsWith('#/components/responses/')) return 'response'
  if (pointer.startsWith('#/components/parameters/')) return 'parameter'
  if (pointer.startsWith('#/components/securitySchemes/')) return 'securityScheme'
  return 'operation'
}
