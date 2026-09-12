import * as path from 'node:path'
import * as fs from 'node:fs/promises'

/**
 * Checks governance manifest symmetry between oa-gen-governance.ts and oa-gen.governance.json.
 */
export async function checkGovernanceManifestParity(repoRoot: string): Promise<{
  inSync: boolean
  differences: string[]
}> {
  const jsonPath = path.resolve(repoRoot, 'docs/cli-spec/oa-gen.governance.json')
  const tsPath = path.resolve(repoRoot, 'packages/codegen/src/cli/spec/oa-gen-governance.ts')

  const differences: string[] = []

  try {
    const jsonContent = await fs.readFile(jsonPath, 'utf8')
    const parsedJson = JSON.parse(jsonContent)

    const tsContent = await fs.readFile(tsPath, 'utf8')

    // Basic structure checks
    if (!parsedJson.namespace || parsedJson.namespace !== 'oa-gen') {
      differences.push('Namespace mismatch in JSON manifest')
    }
    if (!tsContent.includes("namespace: 'oa-gen'")) {
      differences.push("Namespace missing or mismatched in TS manifest")
    }

    return {
      inSync: differences.length === 0,
      differences,
    }
  } catch (err: any) {
    return {
      inSync: false,
      differences: [err.message],
    }
  }
}
