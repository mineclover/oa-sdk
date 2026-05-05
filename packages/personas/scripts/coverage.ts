/**
 * CLI: pnpm coverage
 *
 * Loads all domain matrices + merged spec operationIds, runs analyzeCoverage,
 * prints a markdown report to stdout.
 *
 * Spec path resolution: --spec= > $PERSONAS_MERGED_SPEC > ../schemas/src/.merged.yaml
 * Output path:          --out=<file>  (optional; default stdout)
 *
 * Exit codes:
 *   0 — clean (no unjustified operations)
 *   1 — at least one unjustified operation (fail CI)
 *   2 — merged spec not found
 *
 * Use --no-fail to always exit 0 even if unjustified operations exist.
 */

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyzeCoverage, renderMarkdown } from '../src/coverage.js'
import { loadAllDataModels, loadAllDomains, loadAllTraits, loadOperationsFromMergedSpec, loadRegistry } from '../src/load.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function arg(prefix: string): string | undefined {
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

function main(): void {
  const specPath = arg('--spec=') ?? process.env['PERSONAS_MERGED_SPEC'] ?? resolve(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')
  const outPath = arg('--out=')
  const noFail = process.argv.includes('--no-fail')

  const knownOperations = loadOperationsFromMergedSpec(specPath)
  if (knownOperations === null) {
    console.error(`❌ merged spec not found: ${specPath}`)
    console.error(`   Run 'pnpm --filter @oa-sdk/schemas merge' first, or pass --spec=<path>.`)
    process.exit(2)
  }

  const domains = loadAllDomains()
  const registry = loadRegistry()
  const traits = loadAllTraits(registry)
  const triggerVocab = traits.get('trigger')
  const consumerVocab = traits.get('consumer')
  const skillVocab = traits.get('skill')
  const dataModels = loadAllDataModels()
  const report = analyzeCoverage({
    domains,
    knownOperations,
    ...(triggerVocab ? { triggerVocab } : {}),
    ...(consumerVocab ? { consumerVocab } : {}),
    ...(skillVocab ? { skillVocab } : {}),
    ...(dataModels.length > 0 ? { dataModels } : {}),
  })
  const md = renderMarkdown(report)

  if (outPath) {
    writeFileSync(outPath, md)
    console.error(`📝 wrote ${outPath}`)
  } else {
    process.stdout.write(md)
    if (!md.endsWith('\n')) process.stdout.write('\n')
  }

  if (!noFail && report.unjustifiedOperations.length > 0) {
    console.error('')
    console.error(`❌ ${report.unjustifiedOperations.length} unjustified operation(s). Pass --no-fail to ignore.`)
    process.exit(1)
  }
}

main()
