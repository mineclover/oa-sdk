import {
  createDefinitionRegistry,
  emitDefinitionOpenApiDocument,
  selectDefinitionTarget,
  type DefinitionTargetConfig,
} from '@oa-sdk/parser'
import {
  classifyBreakingChanges,
  createBuildSpecCompositionReport,
  createBuildSpecProvenanceMap,
  diffBuildSpecProvenanceMaps,
  diffEndpoints,
  diffOpenApiDocuments,
  extractEndpoints,
  loadDefinitionFragmentsFromEntries,
  lookupDefinitionSourceLocation,
} from '@oa-sdk/codegen/spec-lens'
import type { SnapshotBuilderPort } from '../../application/ports/snapshot-builder.port.js'
import type { DefinitionBuilderBuildSnapshotOptions } from '../../application/ports/snapshot-builder.port.js'
import type {
  DefinitionBuilderSpecSnapshot,
  SpecFileEntry,
  SpecSnapshot,
  SpecSnapshotDiagnostic,
  SpecSnapshotStored,
  SpecTimelineDiff,
} from '../../domain/index.js'
import {
  SPEC_LENS_DIFF_SCHEMA_VERSION,
  SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
} from '../../domain/project.js'

export class SnapshotBuilder implements SnapshotBuilderPort<'definition-builder'> {
  async build(options: DefinitionBuilderBuildSnapshotOptions): Promise<DefinitionBuilderSpecSnapshot> {
    const { project, revision, entries, fragmentsDir, targetPath, targetConfig, targetConfigDigest } = options

    const fragments = loadDefinitionFragmentsFromEntries(entries, fragmentsDir)
    const registry = createDefinitionRegistry(fragments.nodes, {
      lookupSourceLocation(sourcePath, sourcePointer) {
        return lookupDefinitionSourceLocation(fragments.sourceLocations, sourcePath, sourcePointer)
      },
    })
    const selection = selectDefinitionTarget(registry, targetConfig)
    const emitted = emitDefinitionOpenApiDocument(selection)

    const allDiagnostics = [
      ...fragments.diagnostics,
      ...registry.diagnostics,
      ...emitted.diagnostics,
    ]

    const diagnostics: SpecSnapshotDiagnostic[] = allDiagnostics.map(d => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      ...('pointer' in d && d.pointer !== undefined ? { pointer: d.pointer as string } : {}),
      ...('sourcePath' in d && d.sourcePath !== undefined ? { sourcePath: d.sourcePath as string } : {}),
    }))

    const valid = diagnostics.every(d => d.severity !== 'error')
    const spec: Record<string, unknown> | null = valid ? emitted.document : null

    const provenance = {
      status: 'available',
      kind: 'definition-builder',
      entries: valid ? createBuildSpecProvenanceMap(selection) : {},
    } as const
    const composition = createBuildSpecCompositionReport({
      targetPath,
      fragmentsDir,
      target: targetConfig,
      registry,
      selection,
      emitted,
    })

    return {
      schemaVersion: SPEC_LENS_SNAPSHOT_SCHEMA_VERSION,
      projectKey: project.projectKey,
      projectKind: 'definition-builder',
      sourceRoot: project.sourceRoot,
      revision,
      fragmentsDir,
      targetPath,
      targetConfigDigest,
      spec,
      provenance,
      composition,
      diagnostics,
      builtAt: Date.now(),
    }
  }

  diff(base: SpecSnapshotStored, head: SpecSnapshotStored): SpecTimelineDiff {
    if (base.projectKey !== head.projectKey) {
      throw new Error('cannot diff snapshots from different spec projects')
    }
    if (base.projectKind !== head.projectKind) {
      throw new Error('cannot diff snapshots from different project kinds')
    }
    const baseSpec = base.spec ?? {}
    const headSpec = head.spec ?? {}

    const normalizedDiff = diffOpenApiDocuments(baseSpec, headSpec)
    const breakingDiff = classifyBreakingChanges(diffEndpoints(baseSpec, headSpec))
    const affectedFragments = this.resolveAffectedFragments(base.entryRefs, head.entryRefs)

    const pathsAdded = normalizedDiff.filter((d) => d.category === 'path' && d.kind === 'added').length
    const pathsRemoved = normalizedDiff.filter((d) => d.category === 'path' && d.kind === 'removed').length
    const pathsChanged = normalizedDiff.filter((d) => d.category === 'path' && d.kind === 'changed').length
    const schemasAdded = normalizedDiff.filter((d) => d.category === 'component' && d.kind === 'added').length
    const schemasRemoved = normalizedDiff.filter((d) => d.category === 'component' && d.kind === 'removed').length
    const schemasChanged = normalizedDiff.filter((d) => d.category === 'component' && d.kind === 'changed').length

    const common = {
      schemaVersion: SPEC_LENS_DIFF_SCHEMA_VERSION,
      projectKey: head.projectKey,
      baseRevision: base.revision,
      headRevision: head.revision,
      normalizedDiff,
      breakingDiff,
      affectedFragments,
      stats: {
        pathsAdded,
        pathsRemoved,
        pathsChanged,
        schemasAdded,
        schemasRemoved,
        schemasChanged,
        breakingChanges: breakingDiff.length,
      },
    }

    if (base.projectKind === 'definition-builder' && head.projectKind === 'definition-builder') {
      return {
        ...common,
        projectKind: 'definition-builder',
        provenanceDiff: {
          status: 'available',
          kind: 'definition-builder',
          entries: diffBuildSpecProvenanceMaps(base.provenance.entries, head.provenance.entries),
        },
      }
    }

    if (base.projectKind === 'typespec-bundle'
      && head.projectKind === 'typespec-bundle'
      && base.provenance.status === 'available'
      && head.provenance.status === 'available') {
      return {
        ...common,
        projectKind: 'typespec-bundle',
        provenanceDiff: {
          status: 'available',
          kind: 'typespec-source-ast',
          entries: diffBuildSpecProvenanceMaps(base.provenance.entries, head.provenance.entries),
        },
      }
    }
    return {
      ...common,
      projectKind: 'typespec-bundle',
      provenanceDiff: {
        status: 'unavailable',
        kind: 'typespec-source-files',
        reason: 'output-pointer-mapping-unavailable',
        affectedSourceFiles: affectedFragments,
      },
    }
  }

  private resolveAffectedFragments(
    baseEntries: Array<{ relativePath: string; contentHash: string }>,
    headEntries: Array<{ relativePath: string; contentHash: string }>,
  ): string[] {
    const baseMap = new Map(baseEntries.map(e => [e.relativePath, e.contentHash]))
    const headMap = new Map(headEntries.map(e => [e.relativePath, e.contentHash]))
    const affected = new Set<string>()

    for (const [path, hash] of headMap) {
      if (baseMap.get(path) !== hash) affected.add(path)
    }
    for (const path of baseMap.keys()) {
      if (!headMap.has(path)) affected.add(path)
    }

    return [...affected].sort()
  }
}
