import type { BuildSpecCompositionReport } from './composition-report.js'
import type { DefinitionDuplicateReviewResult } from './duplicate-review.js'
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
import {
  createArtifactFreshnessReport,
  createSkippedArtifactFreshnessReport,
  type ArtifactFreshnessSection,
} from './artifact-freshness.js'

export const REVIEW_BUNDLE_SCHEMA_VERSION = 'oa-gen.review-bundle.v1'
export const REVIEW_BUNDLE_DIFF_SCHEMA_VERSION = 'oa-gen.review-bundle.diff.v1'
export const REVIEW_BUNDLE_RUNTIME_DRIFT_SCHEMA_VERSION = 'oa-gen.drift.v1'

export type ReviewBundleRecommendation = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'

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

export type ReviewBundleSections = {
  breakingDiff: ReviewBundleBreakingDiffSection
  artifactFreshness: ReviewBundleReportSection<ArtifactFreshnessSection>
  runtimeDrift?: ReviewBundleReportSection<ReviewBundleRuntimeDriftReport>
  inventory?: ReviewBundleReportSection<OpenApiInventory>
  composition?: ReviewBundleReportSection<BuildSpecCompositionReport>
  duplicateReview?: ReviewBundleReportSection<DefinitionDuplicateReviewResult>
  nonBreakingChanges: ReviewBundleNonBreakingChangesSection
}

export type ReviewBundleSummary = {
  recommendation: ReviewBundleRecommendation
  reasons: string[]
  breakingChanges: number
  nonBreakingChanges: number
  artifactFresh: boolean | null
  runtimeDrift: boolean | null
  inventoryIncluded: boolean
  compositionIncluded: boolean
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
  includeInventory?: boolean
  inventory?: OpenApiInventory
  composition?: BuildSpecCompositionReport
  duplicateReview?: DefinitionDuplicateReviewResult
}

export function createReviewBundle(options: CreateReviewBundleOptions): ReviewBundle {
  const diff = diffEndpoints(options.base.document, options.head.document)
  const breaking = classifyBreakingChanges(diff)
  const nonBreaking = classifyNonBreakingChanges(diff)
  const artifactFreshness = options.artifactFreshness
    ?? (options.artifact
      ? createArtifactFreshnessReport({
          headDocument: options.head.document,
          artifactDocument: options.artifact.document,
          artifactPath: options.artifact.path,
        })
      : createSkippedArtifactFreshnessReport())
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
    ...(inventory !== undefined
      ? { inventory: { included: true, report: inventory } }
      : {}),
    ...(options.composition !== undefined
      ? { composition: { included: true, report: options.composition } }
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
    inventoryIncluded: inventory !== undefined,
    compositionIncluded: options.composition !== undefined,
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
    '# OpenAPI Review Bundle',
    '',
    `Recommendation: **${bundle.summary.recommendation}**`,
    '',
    '## Summary',
    `- Breaking changes: ${bundle.summary.breakingChanges}`,
    `- Non-breaking changes: ${bundle.summary.nonBreakingChanges}`,
    `- Artifact fresh: ${bundle.summary.artifactFresh ?? 'not checked'}`,
    `- Runtime drift: ${bundle.summary.runtimeDrift ?? 'not checked'}`,
    `- Inventory: ${bundle.summary.inventoryIncluded ? 'included' : 'not included'}`,
    `- Composition: ${bundle.summary.compositionIncluded ? 'included' : 'not included'}`,
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
  inventoryIncluded: boolean
  compositionIncluded: boolean
  duplicateReview: DefinitionDuplicateReviewResult | undefined
}): ReviewBundleSummary {
  const reasons: string[] = []

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
      duplicateReview: input.duplicateReview,
    }),
    reasons,
    breakingChanges: input.breaking.length,
    nonBreakingChanges: input.nonBreaking.length,
    artifactFresh: input.artifactFreshness.fresh,
    runtimeDrift: input.runtimeDrift?.drift ?? null,
    inventoryIncluded: input.inventoryIncluded,
    compositionIncluded: input.compositionIncluded,
    duplicateReviewValid: input.duplicateReview?.valid ?? null,
    checksIncomplete: !input.artifactFreshness.checked,
  }
}

function recommend(input: {
  breaking: readonly ContractDiffChange[]
  nonBreaking: readonly ContractDiffChange[]
  artifactFreshness: ArtifactFreshnessSection
  runtimeDrift: ReviewBundleRuntimeDriftReport | undefined
  duplicateReview: DefinitionDuplicateReviewResult | undefined
}): ReviewBundleRecommendation {
  if (
    input.breaking.length > 0
    || input.artifactFreshness.fresh === false
    || input.runtimeDrift?.drift === true
    || input.duplicateReview?.valid === false
  ) {
    return 'REQUEST_CHANGES'
  }
  if (
    input.nonBreaking.length > 0
    || !input.artifactFreshness.checked
    || (input.duplicateReview !== undefined && input.duplicateReview.summary.findingCount > 0)
  ) {
    return 'COMMENT'
  }
  return 'APPROVE'
}

function changeLines(changes: readonly ContractDiffChange[]): string[] {
  if (changes.length === 0) return ['None.']
  return changes.map(change => (
    `- \`${markdownCode(change.code)}\` \`${markdownCode(change.endpoint)}\` - ${markdownText(change.detail)}`
  ))
}

function artifactLines(report: ArtifactFreshnessSection): string[] {
  if (!report.checked) return [markdownText(report.summary)]
  const lines = [
    `- \`${markdownCode(report.artifact)}\`: **${report.fresh ? 'fresh' : 'stale'}** - ${markdownText(report.summary)}`,
  ]
  if (report.differences.length > 0) {
    lines.push(...report.differences.map(difference => (
      `- ${markdownText(difference.kind)} \`${markdownCode(difference.pointer)}\`: ${markdownText(difference.message)}`
    )))
  }
  return lines
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

function markdownText(value: unknown): string {
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

function markdownCode(value: unknown): string {
  return markdownText(value).replace(/`/g, '\\`')
}
