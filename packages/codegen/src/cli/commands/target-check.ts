import type { Command } from '../lib/types.js'
import { optStr, optStrArray } from '../lib/args.js'
import {
  checkTargetCoverage,
  formatTargetCoverageMarkdown,
} from '../lib/target-coverage.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'
import { CliExitError } from '../lib/errors.js'

type TargetCheckFormat = 'markdown' | 'json'

const targetCheckSpec = commandById(oaGenGovernanceManifest, 'target-check')

export const targetCheck: Command = {
  name: targetCheckSpec.name,
  description: targetCheckSpec.summary,
  options: {
    target: {
      type: 'string',
      short: 't',
      description: optionDescription(targetCheckSpec, 'target'),
    },
    artifact: {
      type: 'string',
      description: optionDescription(targetCheckSpec, 'artifact'),
    },
    fragments: {
      type: 'string',
      description: optionDescription(targetCheckSpec, 'fragments'),
    },
    'must-include-path': {
      type: 'string',
      multiple: true,
      description: optionDescription(targetCheckSpec, 'must-include-path'),
    },
    'must-exclude-path': {
      type: 'string',
      multiple: true,
      description: optionDescription(targetCheckSpec, 'must-exclude-path'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(targetCheckSpec, 'format'),
    },
  },
  async run(args) {
    const targetPath = optStr(args, 'target')
    const artifactPath = optStr(args, 'artifact')
    const fragmentsDir = optStr(args, 'fragments')
    const report = checkTargetCoverage({
      ...(targetPath !== undefined ? { targetPath } : {}),
      ...(artifactPath !== undefined ? { artifactPath } : {}),
      ...(fragmentsDir !== undefined ? { fragmentsDir } : {}),
      mustIncludePaths: optStrArray(args, 'must-include-path'),
      mustExcludePaths: optStrArray(args, 'must-exclude-path'),
    })
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(`${formatTargetCoverageMarkdown(report)}\n`)
    }

    if (!report.valid) throw new CliExitError(1)
  },
}

function readFormat(format: string | undefined): TargetCheckFormat {
  if (format === undefined) return 'markdown'
  if (format === 'markdown' || format === 'json') return format
  throw new Error(`unsupported target-check format: ${format}`)
}
