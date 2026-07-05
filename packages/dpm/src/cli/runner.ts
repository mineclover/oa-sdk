import { compileDpmPlan } from '../compiler/compile.js'
import { createDpmDryRunReport } from '../dry-run/report.js'
import { validateDpmManifest } from '../validator/manifest.js'
import { parseDpmCliArgs } from './args.js'
import { readDpmCliInputs } from './inputs.js'
import { createDpmCliJsonResult } from './result.js'
import type {
  DpmCliResult,
} from './types.js'

export async function runDpmCli(argv: readonly string[]): Promise<DpmCliResult> {
  try {
    const args = parseDpmCliArgs(argv)
    const inputs = readDpmCliInputs(args)

    if (args.command === 'validate') {
      const result = validateDpmManifest({
        manifest: inputs.manifest,
        catalog: inputs.catalog,
        registry: inputs.registry,
        phase: 'validate',
      })
      return createDpmCliJsonResult(
        args.command,
        result.summary.errors > 0 ? 1 : 0,
        result,
      )
    }

    const compiled = compileDpmPlan({
      manifest: inputs.manifest,
      catalog: inputs.catalog,
      registry: inputs.registry,
      phase: args.command === 'compile' ? 'compile' : 'dry_run',
    })
    if (!compiled.ok) {
      return createDpmCliJsonResult(args.command, 1, compiled)
    }
    if (args.command === 'compile') {
      return createDpmCliJsonResult(args.command, 0, compiled)
    }

    return createDpmCliJsonResult(args.command, 0, createDpmDryRunReport({
      plan: compiled.plan,
      ...(inputs.estimatedRows ? { estimatedRows: inputs.estimatedRows } : {}),
    }))
  } catch (error) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    }
  }
}
