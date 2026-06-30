/**
 * Validates the release policy manifest against workspace packages and
 * Changesets configuration.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

type ReleasePolicy = {
  version: number
  changesets: {
    baseBranch: string
    access: string
    updateInternalDependencies: string
    fixed: string[][]
    linked: string[][]
  }
  publish: {
    enabled: boolean
  }
  releaseTracked: string[]
  ignored: string[]
}

type PackageJson = {
  name?: string
  version?: string
  private?: boolean
  exports?: unknown
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

type WorkspacePackage = {
  packageJsonPath: string
  manifest: PackageJson
}

type ChangesetsConfig = {
  baseBranch?: string
  access?: string
  updateInternalDependencies?: string
  fixed?: string[][]
  linked?: string[][]
  ignore?: string[]
}

const root = resolve(process.cwd())
const policyPath = join(root, 'docs/internal/release-policy.json')
const releaseDocPath = join(root, 'docs/internal/release-management.md')
const changesetsConfigPath = join(root, '.changeset/config.json')
const packageBases = ['packages', 'apps'] as const

function main(): void {
  const issues: string[] = []
  const policy = readJson<ReleasePolicy>(policyPath)
  const changesetsConfig = readJson<ChangesetsConfig>(changesetsConfigPath)
  const workspacePackages = readWorkspacePackages()
  const releaseDoc = readFileSync(releaseDocPath, 'utf8')

  validatePolicyShape(policy, issues)
  validateChangesetsConfig(policy, changesetsConfig, issues)
  validateWorkspaceCoverage(policy, workspacePackages, issues)
  validateWorkspaceManifests(policy, workspacePackages, issues)
  validateReleaseDoc(policy, releaseDoc, issues)

  if (issues.length > 0) {
    console.error('Release policy check failed:\n')
    for (const issue of issues) {
      console.error(`- ${issue}`)
    }
    process.exit(1)
  }

  console.log(
    `Release policy OK: ${policy.releaseTracked.length} tracked, ${policy.ignored.length} ignored workspaces.`,
  )
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

function readWorkspacePackages(): WorkspacePackage[] {
  const packages: WorkspacePackage[] = []

  for (const base of packageBases) {
    const basePath = join(root, base)
    if (!existsSync(basePath)) continue

    for (const directory of readdirSync(basePath).sort()) {
      const packageJsonPath = join(basePath, directory, 'package.json')
      if (!existsSync(packageJsonPath)) continue
      packages.push({
        packageJsonPath,
        manifest: readJson<PackageJson>(packageJsonPath),
      })
    }
  }

  return packages
}

function validatePolicyShape(policy: ReleasePolicy, issues: string[]): void {
  if (policy.version !== 1) {
    issues.push('docs/internal/release-policy.json: version must be 1')
  }

  for (const field of ['releaseTracked', 'ignored'] as const) {
    const names = policy[field]
    if (!Array.isArray(names) || names.length === 0) {
      issues.push(`docs/internal/release-policy.json: ${field} must be a non-empty array`)
      continue
    }

    const seen = new Set<string>()
    for (const name of names) {
      if (!isOaSdkPackageName(name)) {
        issues.push(`docs/internal/release-policy.json: invalid package name in ${field}: ${name}`)
      }
      if (seen.has(name)) {
        issues.push(`docs/internal/release-policy.json: duplicate package name in ${field}: ${name}`)
      }
      seen.add(name)
    }
  }

  for (const name of policy.releaseTracked) {
    if (policy.ignored.includes(name)) {
      issues.push(`docs/internal/release-policy.json: package cannot be both tracked and ignored: ${name}`)
    }
  }
}

function validateChangesetsConfig(
  policy: ReleasePolicy,
  config: ChangesetsConfig,
  issues: string[],
): void {
  const expected = policy.changesets

  if (config.baseBranch !== expected.baseBranch) {
    issues.push(`.changeset/config.json: baseBranch must be ${expected.baseBranch}`)
  }
  if (config.access !== expected.access) {
    issues.push(`.changeset/config.json: access must be ${expected.access}`)
  }
  if (config.updateInternalDependencies !== expected.updateInternalDependencies) {
    issues.push(
      `.changeset/config.json: updateInternalDependencies must be ${expected.updateInternalDependencies}`,
    )
  }
  if (!sameStringMatrix(config.fixed ?? [], expected.fixed)) {
    issues.push('.changeset/config.json: fixed groups must match release-policy.json')
  }
  if (!sameStringMatrix(config.linked ?? [], expected.linked)) {
    issues.push('.changeset/config.json: linked groups must match release-policy.json')
  }
  if (!sameStringSet(config.ignore ?? [], policy.ignored)) {
    issues.push('.changeset/config.json: ignore must match release-policy.json ignored workspaces')
  }
}

function validateWorkspaceCoverage(
  policy: ReleasePolicy,
  workspacePackages: WorkspacePackage[],
  issues: string[],
): void {
  const policyNames = new Set([...policy.releaseTracked, ...policy.ignored])
  const workspaceNames = new Set<string>()

  for (const workspacePackage of workspacePackages) {
    const name = workspacePackage.manifest.name
    const label = relative(root, workspacePackage.packageJsonPath)
    if (!name) {
      issues.push(`${label}: package name is required`)
      continue
    }
    workspaceNames.add(name)
    if (!policyNames.has(name)) {
      issues.push(`${label}: ${name} is missing from release-policy.json`)
    }
  }

  for (const name of policyNames) {
    if (!workspaceNames.has(name)) {
      issues.push(`docs/internal/release-policy.json: listed package is not a workspace: ${name}`)
    }
  }
}

function validateWorkspaceManifests(
  policy: ReleasePolicy,
  workspacePackages: WorkspacePackage[],
  issues: string[],
): void {
  const tracked = new Set(policy.releaseTracked)
  const ignored = new Set(policy.ignored)

  for (const workspacePackage of workspacePackages) {
    const { manifest } = workspacePackage
    const label = relative(root, workspacePackage.packageJsonPath)
    const name = manifest.name ?? '<missing-name>'

    if (!manifest.version || !isSemver(manifest.version)) {
      issues.push(`${label}: version must be a semver string`)
    }

    if (!policy.publish.enabled && manifest.private !== true) {
      issues.push(`${label}: private must remain true while release-policy publish.enabled is false`)
    }

    if (tracked.has(name)) {
      if (manifest.version === '0.0.0') {
        issues.push(`${label}: release-tracked packages must not use incubating version 0.0.0`)
      }
      if (!manifest.exports) {
        issues.push(`${label}: release-tracked packages must declare package exports`)
      }
    }

    if (ignored.has(name) && manifest.private !== true) {
      issues.push(`${label}: ignored workspaces must remain private`)
    }

    validateInternalDependencySpecs(label, manifest, issues)
  }
}

function validateReleaseDoc(policy: ReleasePolicy, releaseDoc: string, issues: string[]): void {
  for (const name of [...policy.releaseTracked, ...policy.ignored]) {
    if (!releaseDoc.includes(`\`${name}\``)) {
      issues.push(`docs/internal/release-management.md: missing policy package mention for ${name}`)
    }
  }

  if (!releaseDoc.includes('release-policy.json')) {
    issues.push('docs/internal/release-management.md: must reference release-policy.json')
  }
}

function validateInternalDependencySpecs(
  packageJsonPath: string,
  manifest: PackageJson,
  issues: string[],
): void {
  const sections = {
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
  }

  for (const [sectionName, dependencies] of Object.entries(sections)) {
    for (const [dependencyName, specifier] of Object.entries(dependencies)) {
      if (dependencyName.startsWith('@oa-sdk/') && !specifier.startsWith('workspace:')) {
        issues.push(`${packageJsonPath}: ${sectionName}.${dependencyName} must use workspace: protocol`)
      }
    }
  }
}

function isOaSdkPackageName(value: unknown): value is string {
  return typeof value === 'string' && /^@oa-sdk\/[a-z0-9][a-z0-9-]*$/.test(value)
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

function sameStringSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function sameStringMatrix(left: string[][], right: string[][]): boolean {
  const normalize = (matrix: string[][]): string[] =>
    matrix.map((group) => [...group].sort().join('\0')).sort()

  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

main()
