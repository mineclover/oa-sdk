import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import {
  analyzeDefinitionDuplicateReview,
  formatDefinitionDuplicateReviewMarkdown,
} from '../lib/duplicate-review.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type DuplicateReviewFormat = 'markdown' | 'json'

const duplicateReviewSpec = commandById(oaGenGovernanceManifest, 'duplicate-review')

export const duplicateReview: Command = {
  name: duplicateReviewSpec.name,
  description: duplicateReviewSpec.summary,
  options: {
    fragments: {
      type: 'string',
      required: true,
      description: optionDescription(duplicateReviewSpec, 'fragments'),
    },
    target: {
      type: 'string',
      short: 't',
      description: optionDescription(duplicateReviewSpec, 'target'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(duplicateReviewSpec, 'format'),
    },
  },
  async run(args) {
    const targetPath = optStr(args, 'target')
    const report = analyzeDefinitionDuplicateReview({
      fragmentsDir: str(args, 'fragments'),
      ...(targetPath ? { targetPaths: [targetPath] } : {}),
    })
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(`${formatDefinitionDuplicateReviewMarkdown(report)}\n`)
    }

    if (!report.valid) process.exit(1)
  },
}

function readFormat(format: string | undefined): DuplicateReviewFormat {
  if (format === undefined) return 'markdown'
  if (format === 'markdown' || format === 'json') return format
  throw new Error(`unsupported duplicate-review format: ${format}`)
}
