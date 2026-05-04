/**
 * CLI: pnpm propose-personas
 *
 * Reads .merged.yaml + persona matrices, proposes a `status: proposed`
 * persona stub for every (operationId, statusCode) pair declared in spec but
 * not claimed by any implemented persona's `outcome.expects`.
 *
 * Output:
 *   --out=<path>   write YAML stubs to file
 *   (default)      print YAML stubs to stdout
 *
 * Exit codes:
 *   0 — wrote / printed proposals (even if 0 stubs)
 *   2 — input spec not found
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import { proposeStubsFromOrphans, renderStubsAsYaml } from '../src/propose.js'
import type { MinimalOpenApiDoc } from '../src/bind.js'
import { loadAllDomains, loadOperationsFromMergedSpec } from '../src/load.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function arg(prefix: string): string | undefined {
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

function main(): void {
  const specDefault = resolve(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')
  const specPath = arg('--spec=') ?? process.env['PERSONAS_MERGED_SPEC'] ?? specDefault
  const outPath = arg('--out=')

  if (!existsSync(specPath)) {
    console.error(`❌ merged spec not found: ${specPath}`)
    process.exit(2)
  }

  const spec = parse(readFileSync(specPath, 'utf8')) as MinimalOpenApiDoc
  const domains = loadAllDomains()
  const knownOperations = loadOperationsFromMergedSpec(specPath)
  if (knownOperations === null) {
    console.error(`❌ failed to parse operations from ${specPath}`)
    process.exit(2)
  }

  const stubs = proposeStubsFromOrphans({ spec, domains, knownOperations })
  const yaml = renderStubsAsYaml(stubs)

  if (outPath) {
    writeFileSync(outPath, yaml)
    console.error(`📝 ${stubs.length} stub(s) → ${outPath}`)
  } else {
    process.stdout.write(yaml)
    console.error('')
    console.error(`📊 ${stubs.length} proposed stub(s) for ${countOps(stubs)} operation(s)`)
    if (stubs.some(s => s.collision)) {
      console.error(`⚠️  some stub ids collide with existing personas — see comments`)
    }
  }
}

function countOps(stubs: { operationId: string }[]): number {
  return new Set(stubs.map(s => s.operationId)).size
}

main()
