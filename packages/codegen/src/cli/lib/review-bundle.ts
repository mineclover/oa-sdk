import type { BuildSpecCompositionReport } from './composition-report.js'
import type { DefinitionDuplicateReviewResult } from './duplicate-review.js'
import type {
  BuildSpecMetadataRegistry,
  BuildSpecMetadataRegistryDiffEntry,
} from './metadata-registry.js'
import type { BuildSpecProvenanceDiffEntry } from './provenance-report.js'
import type {
  MetadataRegistryDiffReview,
  ProvenanceDiffReview,
} from './review-sidecar-diff.js'
import {
  formatArtifactFreshnessLines,
  formatChangeLines,
  formatSidecarDiffLines,
  markdownCode,
  markdownText,
} from './review-markdown.js'
import {
  isOptionalSidecarDiffIncomplete,
  optionalSidecarDiffChangeCount,
  recommendReviewOutcome,
  type ReviewOutcome,
} from './review-policy.js'
import type { OpenApiInventory } from './openapi-inventory.js'
import { createOpenApiInventory } from './openapi-inventory.js'
import {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  type ContractDiffChange,
  type DiffResult,
} from './openapi-breaking-diff.js'
import {
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from './openapi-normalized-diff.js'
import { type ArtifactFreshnessSection } from './artifact-freshness.js'
import { createArtifactReview } from './artifact-review.js'

export const REVIEW_BUNDLE_SCHEMA_VERSION = 'oa-gen.review-bundle.v1'
export const REVIEW_BUNDLE_DIFF_SCHEMA_VERSION = 'oa-gen.review-bundle.diff.v1'
export const REVIEW_BUNDLE_RUNTIME_DRIFT_SCHEMA_VERSION = 'oa-gen.drift.v1'

export type ReviewBundleRecommendation = ReviewOutcome

export type ReviewBundleDocumentInput = {
  document: Record<string, unknown>
  path?: string
}

export type ReviewBundleArtifactInput = {
  document: Record<string, unknown>
  path: string
}

export type ReviewBundleRuntimeDriftReport = {
  schemaVersion?: typeof REVIEW_BUNDLE_RUNTIME_DRIFT_SCHEMA_VERSION
  drift: boolean
  status: 'ok' | 'drift-check-failed'
  runtime: string
  managed: string
  issues: OpenApiNormalizedDiffEntry[]
  failure?: {
    code: 'drift-check-failed'
    message: string
  }
  runtimeFetch?: Record<string, unknown>
}

export type ReviewBundleBreakingDiffSection = {
  schemaVersion: typeof REVIEW_BUNDLE_DIFF_SCHEMA_VERSION
  base: string | null
  head: string | null
  diff: DiffResult
  changes: ContractDiffChange[]
}

export type ReviewBundleNonBreakingChangesSection = {
  schemaVersion: typeof REVIEW_BUNDLE_DIFF_SCHEMA_VERSION
  base: string | null
  head: string | null
  changes: ContractDiffChange[]
}

export type ReviewBundleReportSection<TReport> = {
  included: true
  report: TReport
}

export type ReviewBundleMetadataRegistryDiff = MetadataRegistryDiffReview
export type ReviewBundleProvenanceDiff = ProvenanceDiffReview

export type ReviewBundleSections = {
  breakingDiff: ReviewBundleBreakingDiffSection
  artifactFreshness: ReviewBundleReportSection<ArtifactFreshnessSection>
  runtimeDrift?: ReviewBundleReportSection<ReviewBundleRuntimeDriftReport>
  provenanceDiff?: ReviewBundleReportSection<ReviewBundleProvenanceDiff>
  inventory?: ReviewBundleReportSection<OpenApiInventory>
  composition?: ReviewBundleReportSection<BuildSpecCompositionReport>
  metadataRegistry?: ReviewBundleReportSection<BuildSpecMetadataRegistry>
  metadataRegistryDiff?: ReviewBundleReportSection<ReviewBundleMetadataRegistryDiff>
  duplicateReview?: ReviewBundleReportSection<DefinitionDuplicateReviewResult>
  nonBreakingChanges: ReviewBundleNonBreakingChangesSection
}

export type ReviewBundleSummary = {
  recommendation: ReviewBundleRecommendation
  reasons: string[]
  breakingChanges: number
  nonBreakingChanges: number
  artifactChecked: boolean
  artifactFresh: boolean | null
  runtimeDriftIncluded: boolean
  runtimeDrift: boolean | null
  provenanceChecked: boolean
  provenanceChanges: number | null
  inventoryIncluded: boolean
  compositionIncluded: boolean
  metadataRegistryIncluded: boolean
  metadataRegistryChecked: boolean
  metadataRegistryValid: boolean | null
  metadataRegistryChanges: number | null
  duplicateReviewIncluded: boolean
  duplicateReviewValid: boolean | null
  checksIncomplete: boolean
}

export type ReviewBundle = {
  schemaVersion: typeof REVIEW_BUNDLE_SCHEMA_VERSION
  summary: ReviewBundleSummary
  sections: ReviewBundleSections
}

export type CreateReviewBundleOptions = {
  base: ReviewBundleDocumentInput
  head: ReviewBundleDocumentInput
  artifact?: ReviewBundleArtifactInput
  artifactFreshness?: ArtifactFreshnessSection
  runtime?: {
    document: Record<string, unknown>
    path: string
    runtimeFetch?: Record<string, unknown>
  }
  runtimeDrift?: ReviewBundleRuntimeDriftReport
  provenanceDiff?: ReviewBundleProvenanceDiff
  includeInventory?: boolean
  inventory?: OpenApiInventory
  composition?: BuildSpecCompositionReport
  metadataRegistry?: BuildSpecMetadataRegistry
  metadataRegistryDiff?: ReviewBundleMetadataRegistryDiff
  duplicateReview?: DefinitionDuplicateReviewResult
}

export function createReviewBundle(options: CreateReviewBundleOptions): ReviewBundle {
  const diff = diffEndpoints(options.base.document, options.head.document)
  const breaking = classifyBreakingChanges(diff)
  const nonBreaking = classifyNonBreakingChanges(diff)
  const artifactFreshness = options.artifactFreshness
    ?? createArtifactReview({
      headDocument: options.head.document,
      ...(options.artifact?.path !== undefined ? { artifactPath: options.artifact.path } : {}),
      ...(options.artifact?.document !== undefined ? { artifactDocument: options.artifact.document } : {}),
    })
  const runtimeDrift = options.runtimeDrift
    ?? (options.runtime
      ? createRuntimeDriftReport({
          managedDocument: options.head.document,
          managedPath: options.head.path ?? null,
          runtimeDocument: options.runtime.document,
          runtimePath: options.runtime.path,
          ...(options.runtime.runtimeFetch !== undefined ? { runtimeFetch: options.runtime.runtimeFetch } : {}),
        })
      : undefined)
  const inventory = options.inventory
    ?? (options.includeInventory
      ? createOpenApiInventory(options.head.document, {
          ...(options.head.path !== undefined ? { documentPath: options.head.path } : {}),
        })
      : undefined)
  const sections: ReviewBundleSections = {
    breakingDiff: {
      schemaVersion: REVIEW_BUNDLE_DIFF_SCHEMA_VERSION,
      base: options.base.path ?? null,
      head: options.head.path ?? null,
      diff,
      changes: breaking,
    },
    artifactFreshness: {
      included: true,
      report: artifactFreshness,
    },
    ...(runtimeDrift !== undefined
      ? { runtimeDrift: { included: true, report: runtimeDrift } }
      : {}),
    ...(options.provenanceDiff !== undefined
      ? { provenanceDiff: { included: true, report: options.provenanceDiff } }
      : {}),
    ...(inventory !== undefined
      ? { inventory: { included: true, report: inventory } }
      : {}),
    ...(options.composition !== undefined
      ? { composition: { included: true, report: options.composition } }
      : {}),
    ...(options.metadataRegistry !== undefined
      ? { metadataRegistry: { included: true, report: options.metadataRegistry } }
      : {}),
    ...(options.metadataRegistryDiff !== undefined
      ? { metadataRegistryDiff: { included: true, report: options.metadataRegistryDiff } }
      : {}),
    ...(options.duplicateReview !== undefined
      ? { duplicateReview: { included: true, report: options.duplicateReview } }
      : {}),
    nonBreakingChanges: {
      schemaVersion: REVIEW_BUNDLE_DIFF_SCHEMA_VERSION,
      base: options.base.path ?? null,
      head: options.head.path ?? null,
      changes: nonBreaking,
    },
  }
  const summary = createSummary({
    breaking,
    nonBreaking,
    artifactFreshness,
    runtimeDrift,
    provenanceDiff: options.provenanceDiff,
    inventoryIncluded: inventory !== undefined,
    compositionIncluded: options.composition !== undefined,
    metadataRegistry: options.metadataRegistry,
    metadataRegistryDiff: options.metadataRegistryDiff,
    duplicateReview: options.duplicateReview,
  })

  return {
    schemaVersion: REVIEW_BUNDLE_SCHEMA_VERSION,
    summary,
    sections,
  }
}

export function createRuntimeDriftReport(options: {
  managedDocument: Record<string, unknown>
  managedPath: string | null
  runtimeDocument: Record<string, unknown>
  runtimePath: string
  runtimeFetch?: Record<string, unknown>
}): ReviewBundleRuntimeDriftReport {
  const issues = diffOpenApiDocuments(options.managedDocument, options.runtimeDocument)
  return {
    schemaVersion: REVIEW_BUNDLE_RUNTIME_DRIFT_SCHEMA_VERSION,
    drift: issues.length > 0,
    status: 'ok',
    runtime: options.runtimePath,
    managed: options.managedPath ?? '(head)',
    issues,
    ...(options.runtimeFetch !== undefined ? { runtimeFetch: options.runtimeFetch } : {}),
  }
}

export function createRuntimeDriftFailureReport(options: {
  runtime: string
  managed: string | null
  message: string
  runtimeFetch?: Record<string, unknown>
}): ReviewBundleRuntimeDriftReport {
  return {
    schemaVersion: REVIEW_BUNDLE_RUNTIME_DRIFT_SCHEMA_VERSION,
    drift: true,
    status: 'drift-check-failed',
    runtime: options.runtime,
    managed: options.managed ?? '(head)',
    issues: [],
    failure: {
      code: 'drift-check-failed',
      message: options.message,
    },
    ...(options.runtimeFetch !== undefined ? { runtimeFetch: options.runtimeFetch } : {}),
  }
}

export function formatReviewBundleMarkdown(bundle: ReviewBundle): string {
  const lines = [
    `Recommendation: **${bundle.summary.recommendation}**`,
    '',
    '## Summary',
    `- Breaking changes: ${bundle.summary.breakingChanges}`,
    `- Non-breaking changes: ${bundle.summary.nonBreakingChanges}`,
    `- Artifact fresh: ${bundle.summary.artifactFresh ?? 'not checked'}`,
    `- Runtime drift: ${bundle.summary.runtimeDrift ?? 'not checked'}`,
    `- Provenance changes: ${bundle.summary.provenanceChanges ?? 'not checked'}`,
    `- Inventory: ${bundle.summary.inventoryIncluded ? 'included' : 'not included'}`,
    `- Composition: ${bundle.summary.compositionIncluded ? 'included' : 'not included'}`,
    `- Metadata registry: ${bundle.summary.metadataRegistryIncluded ? (bundle.summary.metadataRegistryValid ?? 'included') : 'not included'}`,
    `- Metadata registry changes: ${bundle.summary.metadataRegistryChanges ?? 'not checked'}`,
    `- Duplicate review: ${bundle.summary.duplicateReviewValid ?? 'not included'}`,
  ]
  if (bundle.summary.reasons.length > 0) {
    lines.push(
      '',
      '### Reasons',
      ...bundle.summary.reasons.map(reason => `- ${markdownText(reason)}`),
    )
  }

  lines.push(
    '',
    '## Breaking Changes',
    ...changeLines(bundle.sections.breakingDiff.changes),
    '',
    '## Artifact Freshness',
    ...artifactLines(bundle.sections.artifactFreshness.report),
  )

  if (bundle.sections.runtimeDrift !== undefined) {
    lines.push(
      '',
      '## Runtime Drift',
      ...runtimeDriftLines(bundle.sections.runtimeDrift.report),
    )
  }
  if (bundle.sections.provenanceDiff !== undefined) {
    lines.push(
      '',
      '## Provenance Changes',
      ...provenanceDiffLines(bundle.sections.provenanceDiff.report),
    )
  }
  if (bundle.sections.inventory !== undefined) {
    lines.push(
      '',
      '## Inventory',
      ...inventoryLines(bundle.sections.inventory.report),
    )
  }
  if (bundle.sections.composition !== undefined) {
    lines.push(
      '',
      '## Composition',
      ...compositionLines(bundle.sections.composition.report),
    )
  }
  if (bundle.sections.metadataRegistry !== undefined) {
    lines.push(
      '',
      '## Metadata Registry',
      ...metadataRegistryLines(bundle.sections.metadataRegistry.report),
    )
  }
  if (bundle.sections.metadataRegistryDiff !== undefined) {
    lines.push(
      '',
      '## Metadata Registry Changes',
      ...metadataRegistryDiffLines(bundle.sections.metadataRegistryDiff.report),
    )
  }
  if (bundle.sections.duplicateReview !== undefined) {
    lines.push(
      '',
      '## Duplicate Review',
      ...duplicateReviewLines(bundle.sections.duplicateReview.report),
    )
  }

  lines.push(
    '',
    '## Non-breaking Changes',
    ...changeLines(bundle.sections.nonBreakingChanges.changes),
  )

  return lines.join('\n')
}

function createSummary(input: {
  breaking: readonly ContractDiffChange[]
  nonBreaking: readonly ContractDiffChange[]
  artifactFreshness: ArtifactFreshnessSection
  runtimeDrift: ReviewBundleRuntimeDriftReport | undefined
  provenanceDiff: ReviewBundleProvenanceDiff | undefined
  inventoryIncluded: boolean
  compositionIncluded: boolean
  metadataRegistry: BuildSpecMetadataRegistry | undefined
  metadataRegistryDiff: ReviewBundleMetadataRegistryDiff | undefined
  duplicateReview: DefinitionDuplicateReviewResult | undefined
}): ReviewBundleSummary {
  const reasons: string[] = []
  const provenanceDiffIncomplete = isOptionalSidecarDiffIncomplete(input.provenanceDiff)
  const metadataRegistryDiffIncomplete = isOptionalSidecarDiffIncomplete(input.metadataRegistryDiff)

  if (input.breaking.length > 0) {
    reasons.push(`${input.breaking.length} breaking change${input.breaking.length === 1 ? '' : 's'} detected`)
  }
  if (input.artifactFreshness.checked && !input.artifactFreshness.fresh) {
    reasons.push('generated artifact is stale')
  }
  if (!input.artifactFreshness.checked) {
    reasons.push('artifact freshness was not checked')
  }
  if (input.runtimeDrift?.drift === true) {
    reasons.push(input.runtimeDrift.status === 'drift-check-failed'
      ? 'runtime drift check failed'
      : 'runtime OpenAPI drift detected')
  }
  if (input.provenanceDiff?.changed === true) {
    reasons.push('provenance entries changed')
  } else if (provenanceDiffIncomplete) {
    reasons.push('provenance diff was not fully checked')
  }
  if (input.metadataRegistry !== undefined && metadataRegistryHasErrors(input.metadataRegistry)) {
    reasons.push('metadata registry has duplicate or invalid entries')
  }
  if (input.metadataRegistryDiff?.changed === true) {
    reasons.push('metadata registry entries changed')
  } else if (metadataRegistryDiffIncomplete) {
    reasons.push('metadata registry diff was not fully checked')
  }
  if (input.duplicateReview !== undefined && !input.duplicateReview.valid) {
    reasons.push('duplicate review has error-level findings or diagnostics')
  } else if (input.duplicateReview !== undefined && input.duplicateReview.summary.findingCount > 0) {
    reasons.push('duplicate review has findings')
  }
  if (input.nonBreaking.length > 0) {
    reasons.push(`${input.nonBreaking.length} non-breaking change${input.nonBreaking.length === 1 ? '' : 's'} detected`)
  }

  return {
    recommendation: recommend({
      breaking: input.breaking,
      nonBreaking: input.nonBreaking,
      artifactFreshness: input.artifactFreshness,
      runtimeDrift: input.runtimeDrift,
      provenanceDiff: input.provenanceDiff,
      metadataRegistry: input.metadataRegistry,
      metadataRegistryDiff: input.metadataRegistryDiff,
      duplicateReview: input.duplicateReview,
    }),
    reasons,
    breakingChanges: input.breaking.length,
    nonBreakingChanges: input.nonBreaking.length,
    artifactChecked: input.artifactFreshness.checked,
    artifactFresh: input.artifactFreshness.fresh,
    runtimeDriftIncluded: input.runtimeDrift !== undefined,
    runtimeDrift: input.runtimeDrift?.drift ?? null,
    provenanceChecked: input.provenanceDiff?.checked ?? false,
    provenanceChanges: optionalSidecarDiffChangeCount(input.provenanceDiff),
    inventoryIncluded: input.inventoryIncluded,
    compositionIncluded: input.compositionIncluded,
    metadataRegistryIncluded: input.metadataRegistry !== undefined,
    metadataRegistryChecked: input.metadataRegistryDiff?.checked ?? false,
    metadataRegistryValid: input.metadataRegistry !== undefined
      ? !metadataRegistryHasErrors(input.metadataRegistry)
      : null,
    metadataRegistryChanges: optionalSidecarDiffChangeCount(input.metadataRegistryDiff),
    duplicateReviewIncluded: input.duplicateReview !== undefined,
    duplicateReviewValid: input.duplicateReview?.valid ?? null,
    checksIncomplete: !input.artifactFreshness.checked
      || provenanceDiffIncomplete
      || metadataRegistryDiffIncomplete,
  }
}

function recommend(input: {
  breaking: readonly ContractDiffChange[]
  nonBreaking: readonly ContractDiffChange[]
  artifactFreshness: ArtifactFreshnessSection
  runtimeDrift: ReviewBundleRuntimeDriftReport | undefined
  provenanceDiff: ReviewBundleProvenanceDiff | undefined
  metadataRegistry: BuildSpecMetadataRegistry | undefined
  metadataRegistryDiff: ReviewBundleMetadataRegistryDiff | undefined
  duplicateReview: DefinitionDuplicateReviewResult | undefined
}): ReviewBundleRecommendation {
  return recommendReviewOutcome({
    hasBlocking: input.breaking.length > 0
      || input.artifactFreshness.fresh === false
      || input.runtimeDrift?.drift === true
      || (input.metadataRegistry !== undefined && metadataRegistryHasErrors(input.metadataRegistry))
      || input.duplicateReview?.valid === false,
    hasAdvisory: input.nonBreaking.length > 0
      || !input.artifactFreshness.checked
      || input.provenanceDiff?.changed === true
      || isOptionalSidecarDiffIncomplete(input.provenanceDiff)
      || input.metadataRegistryDiff?.changed === true
      || isOptionalSidecarDiffIncomplete(input.metadataRegistryDiff)
      || (input.duplicateReview !== undefined && input.duplicateReview.summary.findingCount > 0),
  })
}

function changeLines(changes: readonly ContractDiffChange[]): string[] {
  return formatChangeLines(changes)
}

function artifactLines(report: ArtifactFreshnessSection): string[] {
  return formatArtifactFreshnessLines({
    checked: report.checked,
    artifact: report.artifact,
    fresh: report.fresh,
    summary: report.summary,
    differences: report.differences,
  })
}

function runtimeDriftLines(report: ReviewBundleRuntimeDriftReport): string[] {
  const status = report.status === 'drift-check-failed'
    ? 'check failed'
    : report.drift ? 'drift detected' : 'no drift'
  const lines = [
    `- Runtime: \`${markdownCode(report.runtime)}\``,
    `- Managed: \`${markdownCode(report.managed)}\``,
    `- Status: **${markdownText(status)}**`,
  ]
  if (report.failure !== undefined) {
    lines.push(`- Failure: \`${markdownCode(report.failure.code)}\` ${markdownText(report.failure.message)}`)
  }
  if (report.issues.length > 0) {
    lines.push(...report.issues.map(issue => (
      `- ${markdownText(issue.kind)} \`${markdownCode(issue.pointer)}\`: ${markdownText(issue.message)}`
    )))
  }
  return lines
}

function provenanceDiffLines(report: ReviewBundleProvenanceDiff): string[] {
  return formatSidecarDiffLines({
    report,
    markdownText,
    markdownCode,
    getBaseCell: difference => provenanceDiffCell(difference.base),
    getHeadCell: difference => provenanceDiffCell(difference.head),
  })
}

function provenanceDiffCell(entry: BuildSpecProvenanceDiffEntry['base']): string {
  if (!entry) return '—'
  return [
    `canonicalId=${entry.canonicalId}`,
    `sourcePath=${entry.sourcePath}`,
    `contentHash=${entry.contentHash}`,
  ].map(markdownText).join('<br>')
}

function inventoryLines(report: OpenApiInventory): string[] {
  return [
    `- Paths: ${report.totals.paths}`,
    `- Operations: ${report.totals.operations}`,
    `- Components: ${report.totals.components}`,
    `- Unused component candidates: ${report.totals.unusedComponentCandidates}`,
  ]
}

function compositionLines(report: BuildSpecCompositionReport): string[] {
  return [
    `- Target: ${markdownText(report.target.name)}`,
    `- Selected nodes: ${report.summary.selectedNodeCount}`,
    `- Direct paths: ${report.summary.directPathCount}`,
    `- Transitive components: ${report.summary.transitiveComponentCount}`,
    `- Output aliases: ${report.summary.outputAliasCount}`,
    `- Collision report rows: ${report.summary.collisionReportCount}`,
  ]
}

function metadataRegistryLines(report: BuildSpecMetadataRegistry): string[] {
  return [
    `- Target: ${markdownText(report.targetName)}`,
    `- Entries: ${report.summary.entryCount}`,
    `- Explicit tracking IDs: ${report.summary.explicitTrackingIdCount}`,
    `- Generated tracking IDs: ${report.summary.generatedTrackingIdCount}`,
    `- Invalid tracking IDs: ${report.summary.invalidTrackingIdCount}`,
    `- Duplicate tracking IDs: ${report.summary.duplicateTrackingIdCount}`,
    `- Duplicate stable keys: ${report.summary.duplicateStableKeyCount}`,
    `- Duplicate output pointers: ${report.summary.duplicateOutputPointerCount}`,
  ]
}

function metadataRegistryDiffLines(report: ReviewBundleMetadataRegistryDiff): string[] {
  return formatSidecarDiffLines({
    report,
    markdownText,
    markdownCode,
    getBaseCell: difference => metadataRegistryDiffCell(difference.base),
    getHeadCell: difference => metadataRegistryDiffCell(difference.head),
  })
}

function metadataRegistryDiffCell(entry: BuildSpecMetadataRegistryDiffEntry['base']): string {
  if (!entry) return '—'
  return [
    `canonicalId=${entry.canonicalId}`,
    `identityKey=${entry.identityKey}`,
    `stableKey=${entry.stableKey}`,
    `trackingId=${entry.trackingId}`,
  ].map(markdownText).join('<br>')
}

function metadataRegistryHasErrors(report: BuildSpecMetadataRegistry): boolean {
  return report.summary.invalidTrackingIdCount > 0
    || report.summary.duplicateTrackingIdCount > 0
    || report.summary.duplicateStableKeyCount > 0
    || report.summary.duplicateOutputPointerCount > 0
}

function duplicateReviewLines(report: DefinitionDuplicateReviewResult): string[] {
  return [
    `- Valid: ${report.valid}`,
    `- Findings: ${report.summary.findingCount}`,
    `- Diagnostics: ${report.summary.diagnosticCount}`,
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Infos: ${report.summary.infos}`,
  ]
}
