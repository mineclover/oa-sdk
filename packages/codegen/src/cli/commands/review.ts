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
} from '../lib/openapi-breaking-diff.js'
import {
  type ArtifactFreshnessSection,
} from '../lib/artifact-freshness.js'
import { createArtifactReview } from '../lib/artifact-review.js'
import {
  createBehaviorRecord,
  createBehaviorRecorderFromOptions,
} from '../lib/behavior-recorder.js'
import {
  createMetadataRegistryDiffReview,
  createProvenanceDiffReview,
} from '../lib/review-sidecar-diff.js'
import {
  createReviewReport,
  formatReviewReportMarkdown,
  type ReviewReport,
} from '../lib/review-report.js'
import {
  createReviewBehaviorResult,
  recommendationDecisionReason,
  recommendationDecisionSignal,
} from '../lib/review-behavior-result.js'

type ReviewFormat = 'markdown' | 'json'

type ArtifactReview = ArtifactFreshnessSection

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
    'base-metadata-registry': {
      type: 'string',
      description: optionDescription(reviewSpec, 'base-metadata-registry'),
    },
    'head-metadata-registry': {
      type: 'string',
      description: optionDescription(reviewSpec, 'head-metadata-registry'),
    },
    'behavior-log': {
      type: 'string',
      description: 'append-only behavior JSONL 출력 파일 경로',
    },
    'behavior-db': {
      type: 'string',
      description: 'append-only behavior SQLite DB 파일 경로',
    },
  },
  async run(args) {
    const { validateDocument } = await import('@oa-sdk/parser')
    const basePathArg = str(args, 'base')
    const headPathArg = str(args, 'head')
    const artifactPathArg = optStr(args, 'artifact')
    const targetPath = optStr(args, 'target')
    const fragmentsDir = optStr(args, 'fragments')
    const baseProvenancePath = optStr(args, 'base-provenance')
    const headProvenancePath = optStr(args, 'head-provenance')
    const baseMetadataRegistryPath = optStr(args, 'base-metadata-registry')
    const headMetadataRegistryPath = optStr(args, 'head-metadata-registry')
    const behaviorLogPath = optStr(args, 'behavior-log')
    const behaviorDbPath = optStr(args, 'behavior-db')
    const behaviorRecorder = createBehaviorRecorderFromOptions({
      ...(behaviorLogPath !== undefined ? { jsonlPath: behaviorLogPath } : {}),
      ...(behaviorDbPath !== undefined ? { sqlitePath: behaviorDbPath } : {}),
    })
    const startedAt = Date.now()

    try {
      const base = loadSpecWithPath(basePathArg)
      const rawHead = loadSpecWithPath(headPathArg)
      const head = loadOpenApiOrTarget({
        specPath: headPathArg,
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
      const artifact = artifactReview(artifactPathArg, head.document)
      const provenance = createProvenanceDiffReview(
        baseProvenancePath,
        headProvenancePath,
      )
      const metadataRegistry = createMetadataRegistryDiffReview(
        baseMetadataRegistryPath,
        headMetadataRegistryPath,
      )
      const report: ReviewReport = createReviewReport({
        base: base.path,
        head: head.path,
        breaking,
        nonBreaking,
        validationIssues: [...validation.errors, ...validation.warnings, ...validation.infos].map(issue => ({
          severity: issue.severity,
          code: issue.rule,
          path: issue.path,
          message: issue.message,
        })),
        artifact,
        provenance,
        metadataRegistry,
      })
      const format = readFormat(optStr(args, 'format'))
      const payload = format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatReviewReportMarkdown(report)}\n`
      const targetKey = `${base.path}|${head.path}`

      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'review_openapi_change',
        status: report.recommendation === 'REQUEST_CHANGES' ? 'failed' : 'succeeded',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'openapi-review',
            targetKey,
            basePath: base.path,
            headPath: head.path,
            ...(targetPath ? { targetPath } : {}),
          },
          input: {
            basePath: basePathArg,
            headPath: headPathArg,
            ...(artifactPathArg ? { artifactPath: artifactPathArg } : {}),
            ...(targetPath ? { targetPath } : {}),
            ...(fragmentsDir ? { fragmentsDir } : {}),
            ...(baseProvenancePath ? { baseProvenancePath } : {}),
            ...(headProvenancePath ? { headProvenancePath } : {}),
            ...(baseMetadataRegistryPath ? { baseMetadataRegistryPath } : {}),
            ...(headMetadataRegistryPath ? { headMetadataRegistryPath } : {}),
          },
          context: {
            command: 'review',
            source: 'cli',
          },
          decision: {
            primarySignal: recommendationDecisionSignal(report.recommendation),
            decisionReason: recommendationDecisionReason(report.recommendation),
          },
          result: createReviewBehaviorResult(report),
          audit: {
            cwd: process.cwd(),
            pid: process.pid,
          },
          metrics: {
            durationMs: Date.now() - startedAt,
          },
        },
      }))

      writeOutput(optStr(args, 'output'), payload, 'OpenAPI review report')
      behaviorRecorder.close?.()
      if (report.recommendation === 'REQUEST_CHANGES') process.exit(1)
    } catch (error) {
      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'review_openapi_change',
        status: 'failed',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'openapi-review',
            targetKey: `${basePathArg}|${headPathArg}`,
            basePath: basePathArg,
            headPath: headPathArg,
            ...(targetPath ? { targetPath } : {}),
          },
          input: {
            basePath: basePathArg,
            headPath: headPathArg,
            ...(artifactPathArg ? { artifactPath: artifactPathArg } : {}),
            ...(targetPath ? { targetPath } : {}),
            ...(fragmentsDir ? { fragmentsDir } : {}),
            ...(baseProvenancePath ? { baseProvenancePath } : {}),
            ...(headProvenancePath ? { headProvenancePath } : {}),
            ...(baseMetadataRegistryPath ? { baseMetadataRegistryPath } : {}),
            ...(headMetadataRegistryPath ? { headMetadataRegistryPath } : {}),
          },
          context: {
            command: 'review',
            source: 'cli',
          },
          decision: {
            primarySignal: 'exception',
            decisionReason: 'review command raised an exception before producing a report',
          },
          result: {
            errorMessage: error instanceof Error ? error.message : String(error),
          },
          audit: {
            cwd: process.cwd(),
            pid: process.pid,
          },
          metrics: {
            durationMs: Date.now() - startedAt,
          },
        },
      }))
      behaviorRecorder.close?.()
      throw error
    }
  },
}

function artifactReview(
  artifactPath: string | undefined,
  headDocument: Record<string, unknown>,
): ArtifactReview {
  return createArtifactReview({
    headDocument,
    ...(artifactPath !== undefined ? { artifactPath } : {}),
  })
}

function readFormat(format: string | undefined): ReviewFormat {
  if (format === undefined) return 'markdown'
  if (format === 'markdown' || format === 'json') return format
  throw new Error(`unsupported review format: ${format}`)
}
