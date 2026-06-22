/**
 * Validate the production TypeSpec schema candidate without changing the
 * existing OpenAPI/Definition Builder production path.
 */

import { relative, resolve } from 'node:path'
import {
  checkTypeSpecBundle,
  formatTypeSpecBundleCheckFailure,
  printTypeSpecBundleCheckSummary,
  shouldFailTypeSpecBundleCheck,
} from '../packages/codegen/src/cli/lib/typespec-bundle-check.js'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import { diffOpenApiDocuments, formatOpenApiDiff } from '../packages/codegen/src/cli/lib/openapi-normalized-diff.js'

type Args = {
  manifest: string
  expectedOpenapi: string
  productionOpenapi: string
  report?: string
  output?: string
  keep?: boolean
}

const root = resolve(process.cwd())
const args = parseArgs(process.argv.slice(2))

const bundleResult = await checkTypeSpecBundle({
  manifest: args.manifest,
  failOnBreaking: true,
  ...(args.report ? { report: args.report } : {}),
  ...(args.output ? { output: args.output } : {}),
  ...(args.keep ? { keep: true } : {}),
})
printTypeSpecBundleCheckSummary(bundleResult)

if (shouldFailTypeSpecBundleCheck(bundleResult.report, { failOnBreaking: true })) {
  console.error(`TypeSpec schema check failed gates: ${formatTypeSpecBundleCheckFailure(bundleResult.report)}`)
  process.exit(1)
}

const { document: productionDocument } = loadSpecWithPath(args.productionOpenapi)
const { document: expectedDocument } = loadSpecWithPath(args.expectedOpenapi)
const freshnessDiff = diffOpenApiDocuments(
  productionDocument as Record<string, unknown>,
  expectedDocument as Record<string, unknown>,
)

console.log('')
console.log('TypeSpec schema freshness check')
console.log(`  production OpenAPI: ${relative(root, resolve(root, args.productionOpenapi))}`)
console.log(`  bundle expected: ${relative(root, resolve(root, args.expectedOpenapi))}`)
console.log(`  normalized diff: ${freshnessDiff.length === 0 ? 'pass' : 'fail'}`)

if (freshnessDiff.length > 0) {
  console.error('')
  console.error(formatOpenApiDiff(freshnessDiff))
  process.exit(1)
}

function parseArgs(rawArgs: string[]): Args {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage()
    process.exit(0)
  }
  return {
    manifest: readOption(rawArgs, '--manifest') ?? 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    expectedOpenapi: readOption(rawArgs, '--expected-openapi') ?? 'packages/schemas/typespec/expected.openapi.yaml',
    productionOpenapi: readOption(rawArgs, '--production-openapi') ?? 'packages/schemas/src/.merged.yaml',
    ...(readOption(rawArgs, '--report') ? { report: readOption(rawArgs, '--report') } : {}),
    ...(readOption(rawArgs, '--output') ? { output: readOption(rawArgs, '--output') } : {}),
    keep: rawArgs.includes('--keep'),
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function printUsage(): void {
  console.error(`Usage:
  pnpm schema:typespec-check [-- --manifest <path>] [--expected-openapi <path>] [--production-openapi <path>]

Options:
  --manifest <path>            TypeSpec bundle manifest. Defaults to packages/schemas/typespec/oa-sdk.typespec-bundle.json.
  --expected-openapi <path>    Bundle-local expected OpenAPI. Defaults to packages/schemas/typespec/expected.openapi.yaml.
  --production-openapi <path>  Current production OpenAPI artifact. Defaults to packages/schemas/src/.merged.yaml.
  --report <path>              Write the underlying bundle-check report.
  --output <path>              Write the restored OpenAPI artifact.
  --keep                       Keep the temporary TypeSpec bundle workspace.
`)
}
