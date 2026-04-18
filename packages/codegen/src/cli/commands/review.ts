import type { LintResult } from '@oa-sdk/parser'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { optStr, str } from '../lib/args.js'
import { writeOutput } from '../lib/output.js'
import { createCliSourceLocationResolver } from '../lib/source-locations.js'
import { loadOpenApiOrTarget } from '../lib/target-openapi.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'
import {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  diffEndpoints,
  type ContractDiffChange,
} from '../lib/openapi-breaking-diff.js'
import {
  type OpenApiNormalizedDiffEntry,
} from '../lib/openapi-normalized-diff.js'
import {
  createArtifactFreshnessReport,
  createSkippedArtifactFreshnessReport,
  type ArtifactFreshnessSection,
} from '../lib/artifact-freshness.js'
import {
  diffBuildSpecProvenanceMaps,
  loadBuildSpecProvenanceMap,
  type BuildSpecProvenanceDiffEntry,
} from '../lib/provenance-report.js'

type ReviewFormat = 'markdown' | 'json'
type ReviewRecommendation = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'

type ArtifactReview = ArtifactFreshnessSection

type ProvenanceReview = {
  checked: boolean
  base: string | null
  head: string | null
  changed: boolean | null
  summary: string
  differences: BuildSpecProvenanceDiffEntry[]
}

type ReviewReport = {
  recommendation: ReviewRecommendation
  base: string
  head: string
  summary: {
    breakingChanges: number
    nonBreakingChanges: number
    validationErrors: number
    validationWarnings: number
    validationInfos: number
    artifactFresh: boolean | null
    provenanceChanges: number | null
    checksIncomplete: boolean
  }
  diff: {
    breaking: ContractDiffChange[]
    nonBreaking: ContractDiffChange[]
  }
  validation: {
    issues: Array<{
      severity: LintResult['severity']
      code: string
      path: string
      message: string
    }>
  }
  artifact: ArtifactReview
  provenance: ProvenanceReview
}

const reviewSpec = commandById(oaGenGovernanceManifest, 'review')

export const review: Command = {
  name: reviewSpec.name,
  description: reviewSpec.summary,
  options: {
    base: {
      type: 'string',
      required: true,
      description: optionDescription(reviewSpec, 'base'),
    },
    head: {
      type: 'string',
      required: true,
      description: optionDescription(reviewSpec, 'head'),
    },
    artifact: {
      type: 'string',
      description: optionDescription(reviewSpec, 'artifact'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(reviewSpec, 'format'),
    },
    output: {
      type: 'string',
      short: 'o',
      description: optionDescription(reviewSpec, 'output'),
    },
    target: {
      type: 'string',
      description: optionDescription(reviewSpec, 'target'),
    },
    fragments: {
      type: 'string',
      description: optionDescription(reviewSpec, 'fragments'),
    },
    'base-provenance': {
      type: 'string',
      description: optionDescription(reviewSpec, 'base-provenance'),
    },
    'head-provenance': {
      type: 'string',
      description: optionDescription(reviewSpec, 'head-provenance'),
    },
  },
  async run(args) {
    const { validateDocument } = await import('@oa-sdk/parser')
    const base = loadSpecWithPath(str(args, 'base'))
    const rawHead = loadSpecWithPath(str(args, 'head'))
    const targetPath = optStr(args, 'target')
    const fragmentsDir = optStr(args, 'fragments')
    const head = loadOpenApiOrTarget({
      specPath: str(args, 'head'),
      ...(targetPath ? { targetPath } : {}),
      ...(fragmentsDir ? { fragmentsDir } : {}),
    })
    const sourceLocations = createCliSourceLocationResolver({ filePath: rawHead.path, raw: rawHead.raw })
    const validation = validateDocument(head.document, {
      basePath: head.path,
      lookupSourceLocation: sourceLocations.lookup,
    })
    const endpointDiff = diffEndpoints(base.document, head.document)
    const breaking = classifyBreakingChanges(endpointDiff)
    const nonBreaking = classifyNonBreakingChanges(endpointDiff)
    const artifact = artifactReview(optStr(args, 'artifact'), head.document)
    const provenance = provenanceReview(
      optStr(args, 'base-provenance'),
      optStr(args, 'head-provenance'),
    )
    const report: ReviewReport = {
      recommendation: recommendation({
        breaking,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
        validationInfos: validation.infos,
        artifact,
        provenance,
        nonBreaking,
      }),
      base: base.path,
      head: head.path,
      summary: {
        breakingChanges: breaking.length,
        nonBreakingChanges: nonBreaking.length,
        validationErrors: validation.errors.length,
        validationWarnings: validation.warnings.length,
        validationInfos: validation.infos.length,
        artifactFresh: artifact.fresh,
        provenanceChanges: provenance.changed === null ? null : provenance.differences.length,
        checksIncomplete: !artifact.checked
          || ((provenance.base !== null || provenance.head !== null) && !provenance.checked),
      },
      diff: { breaking, nonBreaking },
      validation: {
        issues: [...validation.errors, ...validation.warnings, ...validation.infos].map(issue => ({
          severity: issue.severity,
          code: issue.rule,
          path: issue.path,
          message: issue.message,
        })),
      },
      artifact,
      provenance,
    }
    const format = readFormat(optStr(args, 'format'))
    const payload = format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${reviewMarkdown(report)}\n`

    writeOutput(optStr(args, 'output'), payload, 'OpenAPI review report')
    if (report.recommendation === 'REQUEST_CHANGES') process.exit(1)
  },
}

function provenanceReview(
  baseProvenancePath: string | undefined,
  headProvenancePath: string | undefined,
): ProvenanceReview {
  if (!baseProvenancePath && !headProvenancePath) {
    return {
      checked: false,
      base: null,
      head: null,
      changed: null,
      summary: 'not checked',
      differences: [],
    }
  }
  if (!baseProvenancePath || !headProvenancePath) {
    return {
      checked: false,
      base: baseProvenancePath ?? null,
      head: headProvenancePath ?? null,
      changed: null,
      summary: 'requires both base and head provenance sidecars',
      differences: [],
    }
  }

  const base = loadBuildSpecProvenanceMap(baseProvenancePath)
  const head = loadBuildSpecProvenanceMap(headProvenancePath)
  const differences = diffBuildSpecProvenanceMaps(base, head)
  return {
    checked: true,
    base: baseProvenancePath,
    head: headProvenancePath,
    changed: differences.length > 0,
    summary: differences.length === 0
      ? 'provenance maps match'
      : `${differences.length} provenance entr${differences.length === 1 ? 'y' : 'ies'} changed`,
    differences,
  }
}

function artifactReview(
  artifactPath: string | undefined,
  headDocument: Record<string, unknown>,
): ArtifactReview {
  if (!artifactPath) {
    return createSkippedArtifactFreshnessReport()
  }

  const artifact = loadSpecWithPath(artifactPath)
  return createArtifactFreshnessReport({
    headDocument,
    artifactDocument: artifact.document,
    artifactPath: artifact.path,
  })
}

function recommendation(input: {
  breaking: ContractDiffChange[]
  nonBreaking: ContractDiffChange[]
  validationErrors: LintResult[]
  validationWarnings: LintResult[]
  validationInfos: LintResult[]
  artifact: ArtifactReview
  provenance: ProvenanceReview
}): ReviewRecommendation {
  if (input.breaking.length > 0 || input.validationErrors.length > 0 || input.artifact.fresh === false) {
    return 'REQUEST_CHANGES'
  }
  if (
    input.nonBreaking.length > 0
    || input.validationWarnings.length > 0
    || input.validationInfos.length > 0
    || !input.artifact.checked
    || input.provenance.changed === true
    || (input.provenance.base !== null || input.provenance.head !== null) && !input.provenance.checked
  ) {
    return 'COMMENT'
  }
  return 'APPROVE'
}

function readFormat(format: string | undefined): ReviewFormat {
  if (format === undefined) return 'markdown'
  if (format === 'markdown' || format === 'json') return format
  throw new Error(`unsupported review format: ${format}`)
}

function reviewMarkdown(report: ReviewReport): string {
  const lines = [
    '# OpenAPI Review',
    '',
    `Recommendation: **${report.recommendation}**`,
    '',
    '## Summary',
    `- Breaking changes: ${report.summary.breakingChanges}`,
    `- Non-breaking changes: ${report.summary.nonBreakingChanges}`,
    `- Validation errors: ${report.summary.validationErrors}`,
    `- Validation warnings: ${report.summary.validationWarnings}`,
    `- Artifact fresh: ${report.summary.artifactFresh ?? 'not checked'}`,
    `- Provenance changes: ${report.summary.provenanceChanges ?? 'not checked'}`,
    '',
    '## Breaking Changes',
    ...changeLines(report.diff.breaking),
    '',
    '## Validation Issues',
    ...validationLines(report.validation.issues),
    '',
    '## Artifact Freshness',
    ...artifactLines(report.artifact),
    '',
    '## Provenance Changes',
    ...provenanceLines(report.provenance),
    '',
    '## Non-breaking Changes',
    ...changeLines(report.diff.nonBreaking),
  ]
  return lines.join('\n')
}

function provenanceLines(provenance: ProvenanceReview): string[] {
  if (!provenance.checked) return [provenance.summary === 'not checked' ? 'Not checked.' : markdownText(provenance.summary)]
  const lines = [
    `- Base: \`${markdownCode(provenance.base)}\``,
    `- Head: \`${markdownCode(provenance.head)}\``,
    `- Status: **${provenance.changed ? 'changed' : 'unchanged'}** - ${markdownText(provenance.summary)}`,
  ]
  if (provenance.differences.length === 0) return lines
  lines.push(
    '',
    '| Kind | Pointer | Base | Head |',
    '| --- | --- | --- | --- |',
    ...provenance.differences.map(difference => (
      `| ${markdownText(difference.kind)} | \`${markdownCode(difference.pointer)}\` | ${provenanceCell(difference.base)} | ${provenanceCell(difference.head)} |`
    )),
  )
  return lines
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

function changeLines(changes: ContractDiffChange[]): string[] {
  if (changes.length === 0) return ['None.']
  return changes.map(change => (
    `- \`${markdownCode(change.code)}\` \`${markdownCode(change.endpoint)}\` - ${markdownText(change.detail)}`
  ))
}

function validationLines(issues: ReviewReport['validation']['issues']): string[] {
  if (issues.length === 0) return ['None.']
  return issues.map(issue => (
    `- **${markdownText(issue.severity)}** \`${markdownCode(issue.code)}\` `
    + `\`${markdownCode(issue.path)}\` - ${markdownText(issue.message)}`
  ))
}

function artifactLines(artifact: ArtifactReview): string[] {
  if (!artifact.checked) return ['Not checked.']
  const lines = [
    `- \`${markdownCode(artifact.artifact)}\`: **${artifact.fresh ? 'fresh' : 'stale'}** - ${markdownText(artifact.summary)}`,
  ]
  if (artifact.differences.length > 0) {
    lines.push('', ...artifactDifferenceLines(artifact.differences))
  }
  return lines
}

function artifactDifferenceLines(differences: OpenApiNormalizedDiffEntry[]): string[] {
  return [
    'Artifact differences:',
    ...differences.map(difference => (
      `- ${difference.kind} \`${markdownCode(difference.pointer)}\`: ${markdownText(difference.message)}`
    )),
  ]
}

function markdownText(value: unknown): string {
  return String(value).replace(/\n/g, ' ').trim()
}

function markdownCode(value: unknown): string {
  return markdownText(value).replace(/`/g, '\\`')
}
