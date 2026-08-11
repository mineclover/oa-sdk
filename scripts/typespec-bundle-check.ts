/**
 * TypeSpec authored/generated bundle probe.
 *
 * This wrapper keeps the repo-level `pnpm typespec:bundle-check` command while
 * sharing the implementation with the `oa-gen tsp-bundle-check` CLI command.
 */

import {
  checkTypeSpecBundle,
  formatTypeSpecBundleCheckFailure,
  parseTypeSpecBundleCheckArgs,
  printTypeSpecBundleCheckSummary,
  shouldFailTypeSpecBundleCheck,
} from '../packages/codegen/src/schema-governance.js'

const args = parseTypeSpecBundleCheckArgs(process.argv.slice(2))
const result = await checkTypeSpecBundle(args)
printTypeSpecBundleCheckSummary(result)

if (shouldFailTypeSpecBundleCheck(result.report, args)) {
  console.error(`TypeSpec bundle check failed gates: ${formatTypeSpecBundleCheckFailure(result.report)}`)
  process.exit(1)
}
