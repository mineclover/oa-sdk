import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from '../lib/types.js'
import { optStr, str } from '../lib/args.js'
import {
  buildParallelEvidence,
  createParallelEvidenceReport,
  parseParallelEvidenceMetrics,
  parseTtscContractProvenance,
  parseTypeSpecRefProvenance,
  type ParallelEvidenceReportV1,
} from '../lib/parallel-evidence.js'
import { commandById, optionDescription } from '../spec/ecs.js'
import { oaGenGovernanceManifest } from '../spec/oa-gen-governance.js'

type ParallelEvidenceOutputFormat = 'json' | 'markdown'

const parallelEvidenceSpec = commandById(oaGenGovernanceManifest, 'parallel-evidence')

/** Produce a deterministic metric snapshot; persistence is delegated to the caller's artifact store. */
export const parallelEvidence: Command = {
  name: parallelEvidenceSpec.name,
  description: parallelEvidenceSpec.summary,
  options: {
    'typespec-provenance': {
      type: 'string',
      required: true,
      description: optionDescription(parallelEvidenceSpec, 'typespec-provenance'),
    },
    'ttsc-provenance': {
      type: 'string',
      required: true,
      description: optionDescription(parallelEvidenceSpec, 'ttsc-provenance'),
    },
    baseline: {
      type: 'string',
      description: optionDescription(parallelEvidenceSpec, 'baseline'),
    },
    format: {
      type: 'string',
      short: 'f',
      description: optionDescription(parallelEvidenceSpec, 'format'),
    },
  },
  async run(args) {
    const typeSpecPath = str(args, 'typespec-provenance')
    const ttscPath = str(args, 'ttsc-provenance')
    const baselinePath = optStr(args, 'baseline')
    const evidence = buildParallelEvidence({
      contract: parseTypeSpecRefProvenance(readJson(typeSpecPath)),
      implementation: parseTtscContractProvenance(readJson(ttscPath)),
    })
    const report = createParallelEvidenceReport({
      evidence,
      ...(baselinePath === undefined ? {} : { baseline: parseParallelEvidenceMetrics(readJson(baselinePath)) }),
    })
    if (readFormat(optStr(args, 'format')) === 'json') {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      return
    }
    process.stdout.write(`${formatParallelEvidenceMarkdown(report)}\n`)
  },
}

export function formatParallelEvidenceMarkdown(report: ParallelEvidenceReportV1): string {
  const { metrics } = report
  const lines = [
    '## Parallel Evidence Metrics',
    `- Contract pointer coverage: ${formatRatio(metrics.pointers.contractCoverageRatio)} (${metrics.pointers.matched}/${metrics.pointers.contract})`,
    `- Implementation pointer coverage: ${formatRatio(metrics.pointers.implementationCoverageRatio)} (${metrics.pointers.matched}/${metrics.pointers.implementation})`,
    `- Union pointer coverage: ${formatRatio(metrics.pointers.unionCoverageRatio)} (${metrics.pointers.matched}/${metrics.pointers.union})`,
    `- Contract relation targets resolved: ${metrics.relations.contractTargetResolved}/${metrics.relations.contractTotal}`,
    `- Implementation relation targets resolved: ${metrics.relations.implementationTargetResolved}/${metrics.relations.implementationTotal}`,
    `- ttsc shape projections: direct=${metrics.implementationShapes.direct}, policy-required=${metrics.implementationShapes.policyRequired}, unsupported=${metrics.implementationShapes.unsupported}, unclassified=${metrics.implementationShapes.unclassified}`,
  ]
  if (report.baseline !== undefined) {
    lines.push(
      '',
      '## Baseline Delta',
      `- Changed: ${report.baseline.changed}`,
      ...Object.entries(report.baseline.values)
        .filter(([, value]) => value.delta !== 0)
        .map(([key, value]) => `- ${key}: ${value.baseline} → ${value.current} (${value.delta > 0 ? '+' : ''}${value.delta})`),
    )
  }
  lines.push('', 'TypeSpec remains the contract authority; these metrics are review evidence only.')
  return lines.join('\n')
}

function readFormat(value: string | undefined): ParallelEvidenceOutputFormat {
  if (value === undefined) return 'markdown'
  if (value === 'markdown' || value === 'json') return value
  throw new Error(`unsupported parallel-evidence format: ${value}`)
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), filePath), 'utf8'))
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}
