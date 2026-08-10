/**
 * CLI: pnpm bind
 *
 * Reads .merged.yaml + persona matrices, writes .merged.persona.yaml with
 * `x-persona` injected on each operation and `info.x-persona-meta` summary.
 *
 * Spec path resolution (input):
 *   --spec=<path>  >  $PERSONAS_MERGED_SPEC  >  ../schemas/src/.merged.yaml
 *
 * Output path:
 *   --out=<path>   >  $PERSONAS_BOUND_SPEC  >  ../schemas/src/.merged.persona.yaml
 *
 * Exit codes:
 *   0 — wrote bound spec
 *   2 — input spec not found
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'

import { applyBindings } from '../src/bind.js'
import type { MinimalOpenApiDoc } from '../src/bind.js'
import { loadAllDomains, loadRegistry } from '../src/load.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function arg(prefix: string): string | undefined {
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

function main(): void {
  const specDefault = resolve(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')
  const outDefault = resolve(__dir, '..', '..', 'schemas', 'src', '.merged.persona.yaml')

  const specPath = arg('--spec=') ?? process.env['PERSONAS_MERGED_SPEC'] ?? specDefault
  const outPath = arg('--out=') ?? process.env['PERSONAS_BOUND_SPEC'] ?? outDefault

  if (!existsSync(specPath)) {
    console.error(`❌ merged spec not found: ${specPath}`)
    console.error(`   Run 'pnpm --filter @oa-sdk/schemas run build:typespec' first.`)
    process.exit(2)
  }

  const doc = parse(readFileSync(specPath, 'utf8')) as MinimalOpenApiDoc
  const domains = loadAllDomains()
  const registry = loadRegistry()

  const bound = applyBindings(doc, domains, { registryVersion: registry.version })

  writeFileSync(outPath, stringify(bound, { lineWidth: 0 }))

  const meta = bound.info?.['x-persona-meta'] as { personas: number; implemented: number; proposed: number } | undefined
  console.log(`📌 Personas v${registry.version} bound`)
  console.log(`   In:  ${specPath}`)
  console.log(`   Out: ${outPath}`)
  if (meta) {
    console.log(`   ${meta.personas} personas (${meta.implemented} implemented · ${meta.proposed} proposed)`)
  }
}

main()
