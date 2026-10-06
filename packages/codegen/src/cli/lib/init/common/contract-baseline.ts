import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { loadNormalizedOpenApi } from '../../normalized-openapi.js'
import { writeOpenApiYaml } from '../../openapi-collect.js'

/**
 * The contract baseline: the OpenAPI document of the released API, committed next to package.json.
 * The breaking change gate of the enterprise archetype compares the spec with it (`oa-gen diff`), so
 * the gate needs neither git history nor a remote; refreshing it (`oa-gen normalize`) is how a
 * release, or an accepted breaking change, moves the baseline forward.
 */
export const CONTRACT_BASELINE_PATH = 'openapi.baseline.yaml'

/**
 * True for a spec entry point that `oa-gen lint`, `validate --spec`, `diff` and `normalize` load:
 * an OpenAPI YAML/JSON document, or a TypeSpec entry point, which they compile in memory. A
 * TypeScript module (a schema module or `@oaOperation` sources) is projected only by commands that
 * read oa.config.ts.
 */
export function isSpecDocumentPath(specPath: string): boolean {
  return /\.(ya?ml|json|tsp)$/.test(specPath)
}

/** A contract baseline `oa-gen init` creates from the spec when the project has none yet. */
export interface ContractBaselinePlan {
  /** The baseline document, relative to the project root. */
  path: string
  /** The spec entry point it is created from, relative to the project root unless absolute. */
  specPath: string
}

/**
 * What `oa-gen init` did about a contract baseline: created it; left the one the project has, since
 * the baseline records a release and only the project moves it; would create it (dry run); or could
 * not create it, because the spec does not exist yet or does not load.
 */
export type ContractBaselineResult = ContractBaselinePlan & (
  | { status: 'created' | 'exists' | 'planned' }
  | { status: 'not-created'; reason: string }
)

/** Creates the contract baseline `plan` describes in the project at `cwd`, unless one exists. */
export async function writeContractBaseline(
  cwd: string,
  plan: ContractBaselinePlan,
  options: { dryRun?: boolean | undefined } = {},
): Promise<ContractBaselineResult> {
  const baselinePath = path.resolve(cwd, plan.path)
  if (await exists(baselinePath)) return { ...plan, status: 'exists' }

  const specPath = path.resolve(cwd, plan.specPath)
  if (!(await exists(specPath))) {
    return { ...plan, status: 'not-created', reason: `the spec ${plan.specPath} does not exist yet` }
  }
  if (options.dryRun) return { ...plan, status: 'planned' }

  try {
    writeOpenApiYaml(baselinePath, await loadNormalizedOpenApi(specPath))
    return { ...plan, status: 'created' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...plan, status: 'not-created', reason: `the spec ${plan.specPath} did not load: ${message}` }
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false)
}
