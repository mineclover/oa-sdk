import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import {
  formatBehaviorQueryMarkdown,
  queryBehavior,
  type BehaviorQueryMode,
} from '../lib/behavior-query.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type BehaviorQueryFormat = 'json' | 'markdown'

const behaviorQuerySpec = commandById(oaGenGovernanceManifest, 'behavior-query')

export const behaviorQuery: Command = {
  name: behaviorQuerySpec.name,
  description: behaviorQuerySpec.summary,
  options: {
    'behavior-db': {
      type: 'string',
      required: true,
      description: optionDescription(behaviorQuerySpec, 'behavior-db'),
    },
    mode: {
      type: 'string',
      required: true,
      description: optionDescription(behaviorQuerySpec, 'mode'),
    },
    'behavior-type': {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'behavior-type'),
    },
    'identity-key': {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'identity-key'),
    },
    'target-type': {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'target-type'),
    },
    'target-key': {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'target-key'),
    },
    'decision-signal': {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'decision-signal'),
    },
    recommendation: {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'recommendation'),
    },
    status: {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'status'),
    },
    limit: {
      type: 'string',
      description: optionDescription(behaviorQuerySpec, 'limit'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(behaviorQuerySpec, 'format'),
    },
  },
  async run(args) {
    const behaviorType = optStr(args, 'behavior-type')
    const identityKey = optStr(args, 'identity-key')
    const targetType = optStr(args, 'target-type')
    const targetKey = optStr(args, 'target-key')
    const decisionSignal = optStr(args, 'decision-signal')
    const recommendation = optStr(args, 'recommendation')
    const status = optStr(args, 'status')
    const limit = optStr(args, 'limit')
    const report = queryBehavior({
      dbPath: str(args, 'behavior-db'),
      mode: readMode(str(args, 'mode')),
      ...(behaviorType !== undefined ? { behaviorType } : {}),
      ...(identityKey !== undefined ? { identityKey } : {}),
      ...(targetType !== undefined ? { targetType } : {}),
      ...(targetKey !== undefined ? { targetKey } : {}),
      ...(decisionSignal !== undefined ? { decisionSignal } : {}),
      ...(recommendation !== undefined ? { recommendation } : {}),
      ...(status !== undefined ? { status: readStatus(status) } : {}),
      ...(limit !== undefined ? { limit: readLimit(limit) } : {}),
    })
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(`${formatBehaviorQueryMarkdown(report)}\n`)
    }
  },
}

function readMode(mode: string): BehaviorQueryMode {
  if (
    mode === 'recent'
    || mode === 'recent-failures'
    || mode === 'latest-failure-by-type'
    || mode === 'latest-by-type'
    || mode === 'latest-by-identity'
    || mode === 'latest-by-target'
    || mode === 'latest-by-decision-signal'
    || mode === 'latest-by-recommendation'
    || mode === 'summary-by-type'
    || mode === 'summary-by-status'
    || mode === 'summary-by-target-type'
    || mode === 'summary-by-behavior-status'
    || mode === 'summary-by-behavior-decision-signal'
    || mode === 'summary-by-decision-signal'
    || mode === 'summary-by-recommendation'
  ) {
    return mode
  }
  throw new Error(`unsupported behavior-query mode: ${mode}`)
}

function readLimit(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`invalid --limit value: ${value}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`invalid --limit value: ${value}`)
  return parsed
}

function readFormat(format: string | undefined): BehaviorQueryFormat {
  if (format === undefined) return 'markdown'
  if (format === 'json' || format === 'markdown') return format
  throw new Error(`unsupported behavior-query format: ${format}`)
}

function readStatus(
  status: string,
): 'received' | 'validated' | 'executing' | 'succeeded' | 'failed' | 'compensated' {
  if (
    status === 'received'
    || status === 'validated'
    || status === 'executing'
    || status === 'succeeded'
    || status === 'failed'
    || status === 'compensated'
  ) {
    return status
  }
  throw new Error(`unsupported behavior-query status: ${status}`)
}
