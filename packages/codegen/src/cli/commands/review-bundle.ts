import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BuildSpecCompositionReport } from '../lib/composition-report.js'
import type { DefinitionDuplicateReviewResult } from '../lib/duplicate-review.js'
import {
  type BuildSpecMetadataRegistry,
} from '../lib/metadata-registry.js'
import type { Command } from '../lib/types.js'
import { bool, optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import {
  createMetadataRegistryDiffReview,
  createProvenanceDiffReview,
} from '../lib/review-sidecar-diff.js'
import {
  createReviewBundle,
  formatReviewBundleMarkdown,
  type ReviewBundleMetadataRegistryDiff,
  type ReviewBundleProvenanceDiff,
  type ReviewBundleRuntimeDriftReport,
} from '../lib/review-bundle.js'
import {
  buildParallelEvidence,
  parseTtscContractProvenance,
  parseTypeSpecRefProvenance,
} from '../lib/parallel-evidence.js'
import {
  bundleRecommendationDecisionReason,
  createReviewBundleBehaviorResult,
  recommendationDecisionSignal,
} from '../lib/review-behavior-result.js'
import {
  createBehaviorRecord,
  createBehaviorRecorderFromOptions,
} from '../lib/behavior-recorder.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type ReviewBundleFormat = 'markdown' | 'json'

const reviewBundleSpec = commandById(oaGenGovernanceManifest, 'review-bundle')

export const reviewBundle: Command = {
  name: reviewBundleSpec.name,
  description: reviewBundleSpec.summary,
  options: {
    base: {
      type: 'string',
      required: true,
      description: optionDescription(reviewBundleSpec, 'base'),
    },
    head: {
      type: 'string',
      required: true,
      description: optionDescription(reviewBundleSpec, 'head'),
    },
    artifact: {
      type: 'string',
      required: true,
      description: optionDescription(reviewBundleSpec, 'artifact'),
    },
    inventory: {
      type: 'boolean',
      description: optionDescription(reviewBundleSpec, 'inventory'),
    },
    'runtime-drift': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'runtime-drift'),
    },
    'base-provenance': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'base-provenance'),
    },
    'head-provenance': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'head-provenance'),
    },
    'composition-report': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'composition-report'),
    },
    'metadata-registry': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'metadata-registry'),
    },
    'base-metadata-registry': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'base-metadata-registry'),
    },
    'head-metadata-registry': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'head-metadata-registry'),
    },
    'duplicate-review': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'duplicate-review'),
    },
    'typespec-provenance': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'typespec-provenance'),
    },
    'ttsc-provenance': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'ttsc-provenance'),
    },
    'behavior-log': {
      type: 'string',
      description: 'append-only behavior JSONL 출력 파일 경로',
    },
    'behavior-db': {
      type: 'string',
      description: 'append-only behavior SQLite DB 파일 경로',
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(reviewBundleSpec, 'format'),
    },
  },
  async run(args) {
    const basePathArg = str(args, 'base')
    const headPathArg = str(args, 'head')
    const artifactPathArg = str(args, 'artifact')
    const runtimeDriftPath = optStr(args, 'runtime-drift')
    const baseProvenancePath = optStr(args, 'base-provenance')
    const headProvenancePath = optStr(args, 'head-provenance')
    const compositionPath = optStr(args, 'composition-report')
    const metadataRegistryPath = optStr(args, 'metadata-registry')
    const baseMetadataRegistryPath = optStr(args, 'base-metadata-registry')
    const headMetadataRegistryPath = optStr(args, 'head-metadata-registry')
    const duplicateReviewPath = optStr(args, 'duplicate-review')
    const typeSpecProvenancePath = optStr(args, 'typespec-provenance')
    const ttscProvenancePath = optStr(args, 'ttsc-provenance')
    if ((typeSpecProvenancePath === undefined) !== (ttscProvenancePath === undefined)) {
      throw new Error('--typespec-provenance and --ttsc-provenance must be provided together')
    }
    const behaviorLogPath = optStr(args, 'behavior-log')
    const behaviorDbPath = optStr(args, 'behavior-db')
    const behaviorRecorder = createBehaviorRecorderFromOptions({
      ...(behaviorLogPath !== undefined ? { jsonlPath: behaviorLogPath } : {}),
      ...(behaviorDbPath !== undefined ? { sqlitePath: behaviorDbPath } : {}),
    })
    const startedAt = Date.now()
    try {
      const base = loadSpecWithPath(basePathArg)
      const head = loadSpecWithPath(headPathArg)
      const artifact = loadSpecWithPath(artifactPathArg)
      const bundle = createReviewBundle({
        base: { document: base.document, path: base.path },
        head: { document: head.document, path: head.path },
        artifact: { document: artifact.document, path: artifact.path },
        includeInventory: bool(args, 'inventory'),
        ...(runtimeDriftPath !== undefined
          ? { runtimeDrift: readJsonReport<ReviewBundleRuntimeDriftReport>(runtimeDriftPath) }
          : {}),
        ...((baseProvenancePath !== undefined || headProvenancePath !== undefined)
          ? {
              provenanceDiff: createProvenanceDiffReview(
                baseProvenancePath,
                headProvenancePath,
              ),
            }
          : {}),
        ...(compositionPath !== undefined
          ? { composition: readJsonReport<BuildSpecCompositionReport>(compositionPath) }
          : {}),
        ...(metadataRegistryPath !== undefined
          ? { metadataRegistry: readJsonReport<BuildSpecMetadataRegistry>(metadataRegistryPath) }
          : {}),
        ...((baseMetadataRegistryPath !== undefined || headMetadataRegistryPath !== undefined)
          ? {
              metadataRegistryDiff: createMetadataRegistryDiffReview(
                baseMetadataRegistryPath,
                headMetadataRegistryPath,
              ),
            }
          : {}),
        ...(duplicateReviewPath !== undefined
          ? { duplicateReview: readJsonReport<DefinitionDuplicateReviewResult>(duplicateReviewPath) }
          : {}),
        ...(typeSpecProvenancePath !== undefined && ttscProvenancePath !== undefined
          ? {
              parallelEvidence: buildParallelEvidence({
                contract: parseTypeSpecRefProvenance(readJsonReport<unknown>(typeSpecProvenancePath)),
                implementation: parseTtscContractProvenance(readJsonReport<unknown>(ttscProvenancePath)),
              }),
            }
          : {}),
      })
      const format = readFormat(optStr(args, 'format'))
      const targetKey = `${base.path}|${head.path}|${artifact.path}`

      if (format === 'json') {
        process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`)
      } else {
        process.stdout.write(`${formatReviewBundleMarkdown(bundle)}\n`)
      }

      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'publish_review_bundle',
        status: bundle.summary.recommendation === 'REQUEST_CHANGES' ? 'failed' : 'succeeded',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'review-bundle',
            targetKey,
            basePath: base.path,
            headPath: head.path,
            artifactPath: artifact.path,
          },
          input: {
            basePath: base.path,
            headPath: head.path,
            artifactPath: artifact.path,
            ...(runtimeDriftPath ? { runtimeDriftPath } : {}),
            ...(baseProvenancePath ? { baseProvenancePath } : {}),
            ...(headProvenancePath ? { headProvenancePath } : {}),
            ...(compositionPath ? { compositionPath } : {}),
            ...(metadataRegistryPath ? { metadataRegistryPath } : {}),
            ...(baseMetadataRegistryPath ? { baseMetadataRegistryPath } : {}),
            ...(headMetadataRegistryPath ? { headMetadataRegistryPath } : {}),
            ...(duplicateReviewPath ? { duplicateReviewPath } : {}),
            ...(typeSpecProvenancePath ? { typeSpecProvenancePath } : {}),
            ...(ttscProvenancePath ? { ttscProvenancePath } : {}),
            includeInventory: bool(args, 'inventory'),
          },
          context: {
            command: 'review-bundle',
            source: 'cli',
          },
          decision: {
            primarySignal: recommendationDecisionSignal(bundle.summary.recommendation),
            decisionReason: bundleRecommendationDecisionReason(bundle.summary.recommendation),
          },
          result: createReviewBundleBehaviorResult(bundle),
          audit: {
            cwd: process.cwd(),
            pid: process.pid,
          },
          metrics: {
            durationMs: Date.now() - startedAt,
            ...parallelEvidenceBehaviorMetrics(bundle),
          },
        },
      }))
      behaviorRecorder.close?.()

      if (bundle.summary.recommendation === 'REQUEST_CHANGES') throw new CliExitError(1)
    } catch (error) {
      if (error instanceof CliExitError) throw error
      const targetKey = `${basePathArg}|${headPathArg}|${artifactPathArg}`
      await behaviorRecorder.record(createBehaviorRecord({
        behaviorType: 'publish_review_bundle',
        status: 'failed',
        components: {
          actor: {
            actorType: 'system',
            actorId: 'oa-gen',
          },
          target: {
            targetType: 'review-bundle',
            targetKey,
            basePath: basePathArg,
            headPath: headPathArg,
            artifactPath: artifactPathArg,
          },
          input: {
            basePath: basePathArg,
            headPath: headPathArg,
            artifactPath: artifactPathArg,
            ...(runtimeDriftPath ? { runtimeDriftPath } : {}),
            ...(baseProvenancePath ? { baseProvenancePath } : {}),
            ...(headProvenancePath ? { headProvenancePath } : {}),
            ...(compositionPath ? { compositionPath } : {}),
            ...(metadataRegistryPath ? { metadataRegistryPath } : {}),
            ...(baseMetadataRegistryPath ? { baseMetadataRegistryPath } : {}),
            ...(headMetadataRegistryPath ? { headMetadataRegistryPath } : {}),
            ...(duplicateReviewPath ? { duplicateReviewPath } : {}),
            ...(typeSpecProvenancePath ? { typeSpecProvenancePath } : {}),
            ...(ttscProvenancePath ? { ttscProvenancePath } : {}),
            includeInventory: bool(args, 'inventory'),
          },
          context: {
            command: 'review-bundle',
            source: 'cli',
          },
          decision: {
            primarySignal: 'exception',
            decisionReason: 'review-bundle command raised an exception before producing a bundle',
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

function parallelEvidenceBehaviorMetrics(bundle: ReturnType<typeof createReviewBundle>): Record<string, number> {
  const metrics = bundle.sections.parallelEvidence?.report.metrics
  if (metrics === undefined) return {}
  return {
    parallelEvidenceMatchedPointers: metrics.pointers.matched,
    parallelEvidenceContractPointers: metrics.pointers.contract,
    parallelEvidenceImplementationPointers: metrics.pointers.implementation,
    parallelEvidenceContractCoverageRatio: metrics.pointers.contractCoverageRatio,
    parallelEvidenceImplementationCoverageRatio: metrics.pointers.implementationCoverageRatio,
    parallelEvidenceContractTargetResolved: metrics.relations.contractTargetResolved,
    parallelEvidenceImplementationTargetResolved: metrics.relations.implementationTargetResolved,
    parallelEvidenceDirectShapes: metrics.implementationShapes.direct,
    parallelEvidencePolicyRequiredShapes: metrics.implementationShapes.policyRequired,
    parallelEvidenceUnsupportedShapes: metrics.implementationShapes.unsupported,
  }
}

function readFormat(format: string | undefined): ReviewBundleFormat {
  if (format === undefined) return 'markdown'
  if (format === 'markdown' || format === 'json') return format
  throw new Error(`unsupported review-bundle format: ${format}`)
}

function readJsonReport<T>(filePath: string): T {
  const resolved = resolve(process.cwd(), filePath)
  return JSON.parse(readFileSync(resolved, 'utf8')) as T
}
