import type { Command } from '../lib/types.js'
import { choice, optStr, optStrArray, str } from '../lib/args.js'
import {
  analyzeDefinitionDuplicateReview,
  formatDefinitionDuplicateReviewMarkdown,
  type DefinitionDuplicateReviewCheck,
  type DefinitionDuplicateReviewFailOn,
  type DefinitionDuplicateReviewPolicy,
} from '../lib/duplicate-review.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'
import { CliExitError } from '../lib/errors.js'

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
      multiple: true,
      description: optionDescription(duplicateReviewSpec, 'target'),
    },
    policy: {
      type: 'string',
      description: optionDescription(duplicateReviewSpec, 'policy'),
    },
    check: {
      type: 'string',
      multiple: true,
      description: optionDescription(duplicateReviewSpec, 'check'),
    },
    'fail-on': {
      type: 'string',
      description: optionDescription(duplicateReviewSpec, 'fail-on'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(duplicateReviewSpec, 'format'),
    },
  },
  async run(args) {
    const policy = choice<DefinitionDuplicateReviewPolicy>(args, 'policy', ['report', 'review', 'ci'], 'report')
    const checks = readChecks(optStrArray(args, 'check'))
    const failOn = choice<DefinitionDuplicateReviewFailOn>(args, 'fail-on', ['none', 'error', 'warning', 'info'], policy === 'report' ? 'none' : 'error')
    const report = analyzeDefinitionDuplicateReview({
      fragmentsDir: str(args, 'fragments'),
      targetPaths: optStrArray(args, 'target'),
      policy,
      ...(checks.length > 0 ? { checks } : {}),
      failOn,
    })
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(`${formatDefinitionDuplicateReviewMarkdown(report)}\n`)
    }

    if (!report.valid) throw new CliExitError(1)
  },
}

function readChecks(values: readonly string[]): DefinitionDuplicateReviewCheck[] {
  const validChecks: readonly DefinitionDuplicateReviewCheck[] = [
    'canonical-id',
    'content-hash',
    'local-name',
    'output-name',
    'semantic-alias',
  ]
  const checks: DefinitionDuplicateReviewCheck[] = []
  for (const value of values) {
    if (!(validChecks as readonly string[]).includes(value)) {
      throw new Error(`--check 값은 ${validChecks.join(' | ')} 중 하나여야 합니다: ${value}`)
    }
    checks.push(value as DefinitionDuplicateReviewCheck)
  }
  return checks
}

function readFormat(format: string | undefined): DuplicateReviewFormat {
  if (format === undefined) return 'markdown'
  if (format === 'markdown' || format === 'json') return format
  throw new Error(`unsupported duplicate-review format: ${format}`)
}
