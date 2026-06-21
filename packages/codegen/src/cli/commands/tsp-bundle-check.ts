import type { Command } from '../lib/types.js'
import { bool, optStr } from '../lib/args.js'
import {
  checkTypeSpecBundle,
  formatTypeSpecBundleCheckFailure,
  printTypeSpecBundleCheckSummary,
  shouldFailTypeSpecBundleCheck,
  type TypeSpecBundleCheckArgs,
} from '../lib/typespec-bundle-check.js'

export const tspBundleCheck: Command = {
  name: 'tsp-bundle-check',
  description: 'Check a TypeSpec bundle manifest through compile, restore, validation, and optional expected diff',
  options: {
    project: { type: 'string', description: 'TypeSpec bundle project directory (default: authored fixture or manifest directory)' },
    manifest: { type: 'string', description: 'oa-sdk.typespec-bundle.v1 manifest JSON path' },
    sidecar: { type: 'string', description: 'override oa-sdk.typespec-compat-sidecar.v1 JSON path' },
    expected: { type: 'string', description: 'override expected OpenAPI YAML/JSON path' },
    output: { type: 'string', short: 'o', description: 'restored OpenAPI YAML output path' },
    report: { type: 'string', description: 'bundle check report JSON output path' },
    keep: { type: 'boolean', description: 'keep temporary TypeSpec compile workspace' },
    'fail-on-breaking': { type: 'boolean', description: 'fail when expected restored OpenAPI diff has breaking changes' },
  },
  async run(args) {
    const project = optStr(args, 'project')
    const manifest = optStr(args, 'manifest')
    const sidecar = optStr(args, 'sidecar')
    const expected = optStr(args, 'expected')
    const output = optStr(args, 'output')
    const report = optStr(args, 'report')
    const checkArgs: TypeSpecBundleCheckArgs = {
      ...(project ? { project } : {}),
      ...(manifest ? { manifest } : {}),
      ...(sidecar ? { sidecar } : {}),
      ...(expected ? { expected } : {}),
      ...(output ? { output } : {}),
      ...(report ? { report } : {}),
      keep: bool(args, 'keep'),
      failOnBreaking: bool(args, 'fail-on-breaking'),
    }
    const result = await checkTypeSpecBundle(checkArgs)
    printTypeSpecBundleCheckSummary(result)
    if (shouldFailTypeSpecBundleCheck(result.report, checkArgs)) {
      throw new Error(`TypeSpec bundle check failed gates: ${formatTypeSpecBundleCheckFailure(result.report)}`)
    }
    if (checkArgs.report) console.log(`✅ TypeSpec bundle check report: ${checkArgs.report}`)
    if (checkArgs.output) console.log(`✅ TypeSpec bundle restored OpenAPI: ${checkArgs.output}`)
  },
}
