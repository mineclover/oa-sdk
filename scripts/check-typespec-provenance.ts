/** Validate declaration-to-restored-OpenAPI provenance for the production bundle. */

import { resolve } from 'node:path'
import {
  checkTypeSpecBundle,
  printTypeSpecBundleCheckSummary,
} from '../packages/codegen/src/schema-governance.js'

const root = resolve(process.cwd())
const manifest = readOption(process.argv.slice(2), '--manifest')
  ?? 'packages/schemas/typespec/oa-sdk.typespec-bundle.json'
const output = readOption(process.argv.slice(2), '--output')
  ?? '.oa-sdk/typespec-candidates/declaration-ref-provenance.json'

const result = await checkTypeSpecBundle({
  manifest,
  provenance: output,
  failOnBreaking: true,
}, { root })
printTypeSpecBundleCheckSummary(result, { root })

if (!result.report.provenance.valid) {
  console.error('TypeSpec declaration-to-reference provenance check failed.')
  for (const diagnostic of result.report.provenance.diagnostics) {
    console.error(`  ${diagnostic.code} ${diagnostic.pointer}: ${diagnostic.message}`)
  }
  process.exitCode = 1
} else {
  console.log(`TypeSpec declaration-to-reference provenance: ${output}`)
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}
