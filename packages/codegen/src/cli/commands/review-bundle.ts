import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BuildSpecCompositionReport } from '../lib/composition-report.js'
import type { DefinitionDuplicateReviewResult } from '../lib/duplicate-review.js'
import type { Command } from '../lib/types.js'
import { bool, optStr, str } from '../lib/args.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import {
  createReviewBundle,
  formatReviewBundleMarkdown,
  type ReviewBundleRuntimeDriftReport,
} from '../lib/review-bundle.js'
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
    'composition-report': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'composition-report'),
    },
    'duplicate-review': {
      type: 'string',
      description: optionDescription(reviewBundleSpec, 'duplicate-review'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(reviewBundleSpec, 'format'),
    },
  },
  async run(args) {
    const base = loadSpecWithPath(str(args, 'base'))
    const head = loadSpecWithPath(str(args, 'head'))
    const artifact = loadSpecWithPath(str(args, 'artifact'))
    const runtimeDriftPath = optStr(args, 'runtime-drift')
    const compositionPath = optStr(args, 'composition-report')
    const duplicateReviewPath = optStr(args, 'duplicate-review')
    const bundle = createReviewBundle({
      base: { document: base.document, path: base.path },
      head: { document: head.document, path: head.path },
      artifact: { document: artifact.document, path: artifact.path },
      includeInventory: bool(args, 'inventory'),
      ...(runtimeDriftPath !== undefined
        ? { runtimeDrift: readJsonReport<ReviewBundleRuntimeDriftReport>(runtimeDriftPath) }
        : {}),
      ...(compositionPath !== undefined
        ? { composition: readJsonReport<BuildSpecCompositionReport>(compositionPath) }
        : {}),
      ...(duplicateReviewPath !== undefined
        ? { duplicateReview: readJsonReport<DefinitionDuplicateReviewResult>(duplicateReviewPath) }
        : {}),
    })
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`)
    } else {
      process.stdout.write(`${formatReviewBundleMarkdown(bundle)}\n`)
    }

    if (bundle.summary.recommendation === 'REQUEST_CHANGES') process.exit(1)
  },
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
