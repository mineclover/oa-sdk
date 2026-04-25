import type { ArtifactFreshnessSection } from './artifact-freshness.js'
import type { ContractDiffChange } from './openapi-breaking-diff.js'
import {
  isOptionalSidecarDiffIncomplete,
  optionalSidecarDiffChangeCount,
  recommendReviewOutcome,
  type ReviewOutcome,
} from './review-policy.js'
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
import type { BuildSpecProvenanceDiffEntry } from './provenance-report.js'
import type { BuildSpecMetadataRegistryDiffEntry } from './metadata-registry.js'

export type ReviewRecommendation = ReviewOutcome

export type ReviewValidationIssue = {
  severity: 'error' | 'warning' | 'info'
  code: string
  path: string
  message: string
}

export type ReviewReport = {
  recommendation: ReviewRecommendation
  base: string
  head: string
  summary: {
    reasonCount: number
    reasons: string[]
    breakingChanges: number
    nonBreakingChanges: number
    validationErrors: number
    validationWarnings: number
    validationInfos: number
    artifactFresh: boolean | null
    provenanceChanges: number | null
    metadataRegistryChanges: number | null
    checksIncomplete: boolean
  }
  diff: {
    breaking: ContractDiffChange[]
    nonBreaking: ContractDiffChange[]
  }
  validation: {
    issues: ReviewValidationIssue[]
  }
  artifact: ArtifactFreshnessSection
  provenance: ProvenanceDiffReview
  metadataRegistry: MetadataRegistryDiffReview
}

export function createReviewReport(input: {
  base: string
  head: string
  breaking: ContractDiffChange[]
  nonBreaking: ContractDiffChange[]
  validationIssues: ReviewValidationIssue[]
  artifact: ArtifactFreshnessSection
  provenance: ProvenanceDiffReview
  metadataRegistry: MetadataRegistryDiffReview
}): ReviewReport {
  const validationErrors = input.validationIssues.filter(issue => issue.severity === 'error')
  const validationWarnings = input.validationIssues.filter(issue => issue.severity === 'warning')
  const validationInfos = input.validationIssues.filter(issue => issue.severity === 'info')
  const provenanceIncomplete = isOptionalSidecarDiffIncomplete(input.provenance)
  const metadataRegistryIncomplete = isOptionalSidecarDiffIncomplete(input.metadataRegistry)
  const reasons: string[] = []

  if (input.breaking.length > 0) {
    reasons.push(`${input.breaking.length} breaking change${input.breaking.length === 1 ? '' : 's'} detected`)
  }
  if (validationErrors.length > 0) {
    reasons.push(`${validationErrors.length} validation error${validationErrors.length === 1 ? '' : 's'} detected`)
  }
  if (input.artifact.fresh === false) {
    reasons.push('generated artifact is stale')
  }
  if (!input.artifact.checked) {
    reasons.push('artifact freshness was not checked')
  }
  if (input.provenance.changed === true) {
    reasons.push('provenance entries changed')
  } else if (provenanceIncomplete) {
    reasons.push('provenance diff was not fully checked')
  }
  if (input.metadataRegistry.changed === true) {
    reasons.push('metadata registry entries changed')
  } else if (metadataRegistryIncomplete) {
    reasons.push('metadata registry diff was not fully checked')
  }
  if (input.nonBreaking.length > 0) {
    reasons.push(`${input.nonBreaking.length} non-breaking change${input.nonBreaking.length === 1 ? '' : 's'} detected`)
  }
  if (validationWarnings.length > 0) {
    reasons.push(`${validationWarnings.length} validation warning${validationWarnings.length === 1 ? '' : 's'} detected`)
  }
  if (validationInfos.length > 0) {
    reasons.push(`${validationInfos.length} validation info${validationInfos.length === 1 ? '' : 's'} detected`)
  }

  return {
    recommendation: recommendReviewOutcome({
      hasBlocking: input.breaking.length > 0
        || validationErrors.length > 0
        || input.artifact.fresh === false,
      hasAdvisory: input.nonBreaking.length > 0
        || validationWarnings.length > 0
        || validationInfos.length > 0
        || !input.artifact.checked
        || input.provenance.changed === true
        || provenanceIncomplete
        || input.metadataRegistry.changed === true
        || metadataRegistryIncomplete,
    }),
    base: input.base,
    head: input.head,
    summary: {
      reasonCount: reasons.length,
      reasons,
      breakingChanges: input.breaking.length,
      nonBreakingChanges: input.nonBreaking.length,
      validationErrors: validationErrors.length,
      validationWarnings: validationWarnings.length,
      validationInfos: validationInfos.length,
      artifactFresh: input.artifact.fresh,
      provenanceChanges: optionalSidecarDiffChangeCount(input.provenance),
      metadataRegistryChanges: optionalSidecarDiffChangeCount(input.metadataRegistry),
      checksIncomplete: !input.artifact.checked
        || provenanceIncomplete
        || metadataRegistryIncomplete,
    },
    diff: {
      breaking: input.breaking,
      nonBreaking: input.nonBreaking,
    },
    validation: {
      issues: input.validationIssues,
    },
    artifact: input.artifact,
    provenance: input.provenance,
    metadataRegistry: input.metadataRegistry,
  }
}

export function formatReviewReportMarkdown(report: ReviewReport): string {
  const lines = [
    '# OpenAPI Review',
    '',
    `Recommendation: **${report.recommendation}**`,
    '',
    '## Summary',
    `- Reasons: ${report.summary.reasonCount}`,
    `- Breaking changes: ${report.summary.breakingChanges}`,
    `- Non-breaking changes: ${report.summary.nonBreakingChanges}`,
    `- Validation errors: ${report.summary.validationErrors}`,
    `- Validation warnings: ${report.summary.validationWarnings}`,
    `- Artifact fresh: ${report.summary.artifactFresh ?? 'not checked'}`,
    `- Provenance changes: ${report.summary.provenanceChanges ?? 'not checked'}`,
    `- Metadata registry changes: ${report.summary.metadataRegistryChanges ?? 'not checked'}`,
    '',
    ...(report.summary.reasons.length > 0
      ? [
          '## Reasons',
          ...report.summary.reasons.map(reason => `- ${markdownText(reason)}`),
          '',
        ]
      : []),
    ...(
      report.summary.reasons.length === 0
        ? ['## Reasons', 'None.', '']
        : []
    ),
    '## Breaking Changes',
    ...formatChangeLines(report.diff.breaking),
    '',
    '## Validation Issues',
    ...validationLines(report.validation.issues),
    '',
    '## Artifact Freshness',
    ...formatArtifactFreshnessLines({
      checked: report.artifact.checked,
      artifact: report.artifact.artifact,
      fresh: report.artifact.fresh,
      summary: report.artifact.summary,
      differences: report.artifact.differences,
      uncheckedLines: ['Not checked.'],
      differenceHeading: 'Artifact differences:',
    }),
    '',
    '## Provenance Changes',
    ...formatSidecarDiffLines({
      report: report.provenance,
      markdownText,
      markdownCode,
      getBaseCell: difference => provenanceCell(difference.base),
      getHeadCell: difference => provenanceCell(difference.head),
    }),
    '',
    '## Metadata Registry Changes',
    ...formatSidecarDiffLines({
      report: report.metadataRegistry,
      markdownText,
      markdownCode,
      getBaseCell: difference => metadataRegistryCell(difference.base),
      getHeadCell: difference => metadataRegistryCell(difference.head),
    }),
    '',
    '## Non-breaking Changes',
    ...formatChangeLines(report.diff.nonBreaking),
  ]
  return lines.join('\n')
}

function validationLines(issues: ReviewValidationIssue[]): string[] {
  if (issues.length === 0) return ['None.']
  return issues.map(issue => (
    `- **${markdownText(issue.severity)}** \`${markdownCode(issue.code)}\` `
    + `\`${markdownCode(issue.path)}\` - ${markdownText(issue.message)}`
  ))
}

function provenanceCell(entry: BuildSpecProvenanceDiffEntry['base']): string {
  if (entry === undefined) return '-'
  return [
    `\`${markdownCode(entry.canonicalId)}\``,
    markdownText(entry.sourcePath),
    `\`${markdownCode(entry.sourcePointer)}\``,
    `\`${markdownCode(entry.contentHash)}\``,
  ].join('<br>')
}

function metadataRegistryCell(entry: BuildSpecMetadataRegistryDiffEntry['base']): string {
  if (!entry) return '—'
  return [
    `canonicalId=${entry.canonicalId}`,
    `identityKey=${entry.identityKey}`,
    `stableKey=${entry.stableKey}`,
    `trackingId=${entry.trackingId}`,
  ].map(markdownText).join('<br>')
}
