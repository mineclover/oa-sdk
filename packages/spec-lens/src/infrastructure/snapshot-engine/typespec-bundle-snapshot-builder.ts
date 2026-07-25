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

    const diagnostics: SpecSnapshotDiagnostic[] = [{
      code: 'TYPESPEC_POINTER_PROVENANCE_UNAVAILABLE',
      severity: 'info',
      message: 'TypeSpec output-pointer provenance is unavailable; reachable source-file evidence is recorded instead.',
    }]
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
      provenance: {
        status: 'unavailable',
        kind: 'typespec-source-files',
        reason: 'output-pointer-mapping-unavailable',
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
