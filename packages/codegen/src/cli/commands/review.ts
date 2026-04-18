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
  diffOpenApiDocuments,
  type OpenApiNormalizedDiffEntry,
} from '../lib/openapi-normalized-diff.js'

type ReviewFormat = 'markdown' | 'json'
type ReviewRecommendation = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'

type ArtifactReview = {
  checked: boolean
  artifact: string | null
  fresh: boolean | null
  summary: string
  differences: OpenApiNormalizedDiffEntry[]
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
    const report: ReviewReport = {
      recommendation: recommendation({
        breaking,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
        validationInfos: validation.infos,
        artifact,
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
        checksIncomplete: !artifact.checked,
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
    }
    const format = readFormat(optStr(args, 'format'))
    const payload = format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${reviewMarkdown(report)}\n`

    writeOutput(optStr(args, 'output'), payload, 'OpenAPI review report')
    if (report.recommendation === 'REQUEST_CHANGES') process.exit(1)
  },
}

function artifactReview(
  artifactPath: string | undefined,
  headDocument: Record<string, unknown>,
): ArtifactReview {
  if (!artifactPath) {
    return {
      checked: false,
      artifact: null,
      fresh: null,
      summary: 'not checked',
      differences: [],
    }
  }

  const artifact = loadSpecWithPath(artifactPath)
  const differences = diffOpenApiDocuments(headDocument, artifact.document)
  return {
    checked: true,
    artifact: artifact.path,
    fresh: differences.length === 0,
    summary: differences.length === 0
      ? 'matches head OpenAPI'
      : `${differences.length} OpenAPI difference${differences.length === 1 ? '' : 's'} detected`,
    differences,
  }
}

function recommendation(input: {
  breaking: ContractDiffChange[]
  nonBreaking: ContractDiffChange[]
  validationErrors: LintResult[]
  validationWarnings: LintResult[]
  validationInfos: LintResult[]
  artifact: ArtifactReview
}): ReviewRecommendation {
  if (input.breaking.length > 0 || input.validationErrors.length > 0 || input.artifact.fresh === false) {
    return 'REQUEST_CHANGES'
  }
  if (
    input.nonBreaking.length > 0
    || input.validationWarnings.length > 0
    || input.validationInfos.length > 0
    || !input.artifact.checked
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
    '## Non-breaking Changes',
    ...changeLines(report.diff.nonBreaking),
  ]
  return lines.join('\n')
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
