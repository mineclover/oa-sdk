import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Governance helper that inspects documentation files and gate manifests.
 */
export function readApiIndexDoc(repoRoot = process.cwd()): string {
  const filePath = path.resolve(repoRoot, 'docs/internal/api-index.md')
  return fs.readFileSync(filePath, 'utf8')
}

export function readCliReferenceDoc(repoRoot = process.cwd()): string {
  const filePath = path.resolve(repoRoot, 'docs/guides/cli-command-reference.md')
  return fs.readFileSync(filePath, 'utf8')
}

export function readCliSpecManifest(repoRoot = process.cwd()): Record<string, any> {
  const filePath = path.resolve(repoRoot, 'docs/cli-spec/oa-gen.governance.json')
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}
