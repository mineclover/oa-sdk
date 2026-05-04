/**
 * CLI: pnpm gen:tests
 *
 * Reads .merged.yaml + persona matrices, writes a vitest suite to --out=<path>.
 * Default output: ../../apps/playground/tests/persona-roleplay.generated.test.ts
 *
 * Exit codes:
 *   0 — wrote suite
 *   2 — input spec not found
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import { generateVitestSuite } from '../src/generate-tests.js'
import type { MinimalOpenApiDoc } from '../src/bind.js'
import { loadAllDomains } from '../src/load.js'

const __dir = dirname(fileURLToPath(import.meta.url))

function arg(prefix: string): string | undefined {
  return process.argv.find(a => a.startsWith(prefix))?.slice(prefix.length)
}

function main(): void {
  const specDefault = resolve(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')
  const outDefault = resolve(__dir, '..', '..', '..', 'apps', 'playground', 'tests', 'persona-roleplay.generated.test.ts')

  const specPath = arg('--spec=') ?? process.env['PERSONAS_MERGED_SPEC'] ?? specDefault
  const outPath = arg('--out=') ?? outDefault

  if (!existsSync(specPath)) {
    console.error(`❌ merged spec not found: ${specPath}`)
    process.exit(2)
  }

  const spec = parse(readFileSync(specPath, 'utf8')) as MinimalOpenApiDoc
  const domains = loadAllDomains()
  // Compute path relative to the test file's directory so the generated
  // suite is portable. Prepend "./" if not already a parent-traversal path.
  const rel = relative(dirname(outPath), specPath).replaceAll('\\', '/')
  const specRelativePath = rel.startsWith('.') ? rel : `./${rel}`
  const suite = generateVitestSuite({ spec, domains, specRelativePath })

  writeFileSync(outPath, suite)
  const personaCount = domains.reduce(
    (sum, m) => sum + m.personas.filter(p => p.status === 'implemented' && (p.outcome?.maps_to?.length ?? 0) > 0 && (p.outcome?.expects?.length ?? 0) > 0).length,
    0,
  )
  console.log(`📝 wrote ${outPath}`)
  console.log(`   ${personaCount} persona test(s) generated`)
}

main()
