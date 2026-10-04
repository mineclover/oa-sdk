/**
 * Validates the release policy manifest against workspace packages and
 * Changesets configuration.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type TrackPolicy =
  | 'active'
  | 'compatibility'
  | 'maintenance-only'
  | 'support-only'
type TrackRelease = 'release-tracked' | 'ignored'

type WorkspaceTrack = {
  policy: string
  release: string
  workspaces: string[]
}

export type ReleasePolicy = {
  version: number
  primaryMission: string
  primaryTrack: string
  scopeDocument: string
  changesets: {
    baseBranch: string
    access: string
    updateInternalDependencies: string
    fixed: string[][]
    linked: string[][]
  }
  publish: {
    enabled: boolean
    mode: string
    repository: string
  }
  distributionCandidates: string[]
  bulkTaskExcluded: string[]
  tracks: Record<string, WorkspaceTrack>
  releaseTracked: string[]
  ignored: string[]
}

type PackageJson = {
  name?: string
  version?: string
  private?: boolean
  exports?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  files?: string[]
  publishConfig?: {
    access?: string
    provenance?: boolean
  }
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

const PRIMARY_MISSION = 'schema-spec-management'
const PRIMARY_TRACK = 'corePlatform'
export const POLICY_VERSION = 5
export const ARTIFACT_ONLY_PUBLISH_MODE = 'artifact-only'
const SCOPE_DOCUMENT = 'docs/internal/platform-scope.md'
const TRACK_RULES = {
  corePlatform: { policy: 'active', release: 'release-tracked' },
  downstream: { policy: 'compatibility', release: 'release-tracked' },
  maintenance: { policy: 'maintenance-only', release: 'ignored' },
  applications: { policy: 'support-only', release: 'ignored' },
} as const satisfies Record<string, { policy: TrackPolicy; release: TrackRelease }>
type TrackName = keyof typeof TRACK_RULES

const TRACK_NAMES = Object.keys(TRACK_RULES) as TrackName[]
const ALLOWED_TRACK_POLICIES = new Set<TrackPolicy>([
  'active',
  'compatibility',
  'maintenance-only',
  'support-only',
])
const ALLOWED_TRACK_RELEASES = new Set<TrackRelease>(['release-tracked', 'ignored'])
const TRACK_SCRIPT_GROUPS = {
  core: ['corePlatform'],
  downstream: ['downstream'],
  maintenance: ['maintenance'],
  internal: ['applications'],
} as const satisfies Record<string, readonly TrackName[]>
const TRACK_TASKS = ['build', 'test', 'typecheck'] as const

const root = resolve(import.meta.dirname, '..')
const rootPackagePath = join(root, 'package.json')
const policyPath = join(root, 'docs/internal/release-policy.json')
const releaseDocPath = join(root, 'docs/internal/release-management.md')
const changesetsConfigPath = join(root, '.changeset/config.json')
const packageBases = ['packages', 'apps'] as const

function main(): void {
  const issues: string[] = []
  const policy = readJson<ReleasePolicy>(policyPath)
  const changesetsConfig = readJson<ChangesetsConfig>(changesetsConfigPath)
  const rootPackage = readJson<PackageJson>(rootPackagePath)
  const workspacePackages = readWorkspacePackages()
  const releaseDoc = readFileSync(releaseDocPath, 'utf8')

  validatePolicyShape(policy, issues)
  validateChangesetsConfig(policy, changesetsConfig, issues)
  validateRootScripts(policy, rootPackage, workspacePackages, issues)
  validateNoDirectPublishScripts(rootPackage, workspacePackages, issues)
  validateWorkspaceCoverage(policy, workspacePackages, issues)
  validateTrackDependencyBoundaries(policy, workspacePackages, issues)
  validateWorkspaceManifests(policy, workspacePackages, issues)
  validateReleaseDoc(policy, releaseDoc, issues)

  if (issues.length > 0) {
    console.error('Release policy check failed:\n')
    for (const issue of issues) {
      console.error(`- ${issue}`)
    }
    process.exit(1)
  }

  const trackCounts = TRACK_NAMES.map(
    (trackName) => `${trackName}=${getTrackWorkspaces(policy, trackName).length}`,
  ).join(', ')
  console.log(
    `Release policy OK: ${TRACK_NAMES.length} tracks (${trackCounts}); ` +
      `${policy.releaseTracked.length} release-tracked, ${policy.ignored.length} ignored workspaces.`,
  )
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T
}

export function validateArtifactReleasePolicy(value: unknown): string[] {
  const issues: string[] = []
  if (!isRecord(value)) return ['policy must be an object']

  if (value.version !== POLICY_VERSION) {
    issues.push(`version must be ${POLICY_VERSION}`)
  }

  if (!isRecord(value.publish)) {
    issues.push('publish must be an object')
  } else {
    if (value.publish.enabled !== false) {
      issues.push('publish.enabled must remain false')
    }
    if (value.publish.mode !== ARTIFACT_ONLY_PUBLISH_MODE) {
      issues.push(`publish.mode must be ${ARTIFACT_ONLY_PUBLISH_MODE}`)
    }
    if (!isHttpsRepository(value.publish.repository)) {
      issues.push('publish.repository must be an HTTPS repository URL without credentials, query, or fragment')
    }
  }

  if (!Array.isArray(value.distributionCandidates) || value.distributionCandidates.length === 0) {
    issues.push('distributionCandidates must be a non-empty array')
  } else {
    const seen = new Set<string>()
    for (const candidate of value.distributionCandidates) {
      if (!isOaSdkPackageName(candidate)) {
        issues.push(`invalid distribution candidate: ${String(candidate)}`)
        continue
      }
      if (seen.has(candidate)) issues.push(`duplicate distribution candidate: ${candidate}`)
      seen.add(candidate)
    }
  }

  return issues
}

export function readArtifactReleasePolicy(filePath: string): ReleasePolicy {
  const value = readJson<unknown>(filePath)
  const issues = validateArtifactReleasePolicy(value)
  if (issues.length > 0) {
    throw new Error(`invalid artifact release policy ${filePath}: ${issues.join('; ')}`)
  }
  return value as ReleasePolicy
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
  for (const issue of validateArtifactReleasePolicy(policy)) {
    issues.push(`docs/internal/release-policy.json: ${issue}`)
  }
  if (policy.primaryMission !== PRIMARY_MISSION) {
    issues.push(
      `docs/internal/release-policy.json: primaryMission must be ${PRIMARY_MISSION}`,
    )
  }
  if (!isTrackName(policy.primaryTrack)) {
    issues.push(
      `docs/internal/release-policy.json: primaryTrack must name one of: ${TRACK_NAMES.join(', ')}`,
    )
  } else if (policy.primaryTrack !== PRIMARY_TRACK) {
    issues.push(`docs/internal/release-policy.json: primaryTrack must be ${PRIMARY_TRACK}`)
  }
  if (policy.scopeDocument !== SCOPE_DOCUMENT) {
    issues.push(`docs/internal/release-policy.json: scopeDocument must be ${SCOPE_DOCUMENT}`)
  } else if (!existsSync(join(root, policy.scopeDocument))) {
    issues.push(`docs/internal/release-policy.json: scopeDocument does not exist: ${SCOPE_DOCUMENT}`)
  }
  if (Array.isArray(policy.distributionCandidates)) {
    const tracked = new Set(getWorkspacesByRelease(policy, 'release-tracked'))
    for (const name of policy.distributionCandidates) {
      if (!tracked.has(name)) {
        issues.push(`docs/internal/release-policy.json: distribution candidate must be release-tracked: ${name}`)
      }
    }
  }

  if (!Array.isArray(policy.bulkTaskExcluded)) {
    issues.push('docs/internal/release-policy.json: bulkTaskExcluded must be an array')
  }

  if (!isRecord(policy.tracks)) {
    issues.push('docs/internal/release-policy.json: tracks must be an object')
    return
  }

  for (const trackName of Object.keys(policy.tracks)) {
    if (!isTrackName(trackName)) {
      issues.push(`docs/internal/release-policy.json: unexpected track: ${trackName}`)
    }
  }

  const workspaceOwners = new Map<string, TrackName>()
  for (const trackName of TRACK_NAMES) {
    const track = policy.tracks[trackName]
    const expected = TRACK_RULES[trackName]
    if (!isRecord(track)) {
      issues.push(`docs/internal/release-policy.json: missing track: ${trackName}`)
      continue
    }

    if (!isTrackPolicy(track.policy)) {
      issues.push(
        `docs/internal/release-policy.json: ${trackName}.policy must be one of: ${[
          ...ALLOWED_TRACK_POLICIES,
        ].join(', ')}`,
      )
    } else if (track.policy !== expected.policy) {
      issues.push(
        `docs/internal/release-policy.json: ${trackName}.policy must be ${expected.policy}`,
      )
    }

    if (!isTrackRelease(track.release)) {
      issues.push(
        `docs/internal/release-policy.json: ${trackName}.release must be one of: ${[
          ...ALLOWED_TRACK_RELEASES,
        ].join(', ')}`,
      )
    } else if (track.release !== expected.release) {
      issues.push(
        `docs/internal/release-policy.json: ${trackName}.release must be ${expected.release}`,
      )
    }

    if (!Array.isArray(track.workspaces) || track.workspaces.length === 0) {
      issues.push(
        `docs/internal/release-policy.json: ${trackName}.workspaces must be a non-empty array`,
      )
      continue
    }

    const seenInTrack = new Set<string>()
    for (const workspaceName of track.workspaces) {
      if (!isOaSdkPackageName(workspaceName)) {
        issues.push(
          `docs/internal/release-policy.json: invalid workspace name in ${trackName}: ${String(workspaceName)}`,
        )
        continue
      }
      if (seenInTrack.has(workspaceName)) {
        issues.push(
          `docs/internal/release-policy.json: duplicate workspace in ${trackName}: ${workspaceName}`,
        )
      }
      seenInTrack.add(workspaceName)

      const owner = workspaceOwners.get(workspaceName)
      if (owner && owner !== trackName) {
        issues.push(
          `docs/internal/release-policy.json: workspace appears in multiple tracks (${owner}, ${trackName}): ${workspaceName}`,
        )
      } else {
        workspaceOwners.set(workspaceName, trackName)
      }
    }
  }

  const derivedReleaseTracked = getWorkspacesByRelease(policy, 'release-tracked')
  const derivedIgnored = getWorkspacesByRelease(policy, 'ignored')
  validateCompatibilityList('releaseTracked', policy.releaseTracked, issues)
  validateCompatibilityList('ignored', policy.ignored, issues)
  if (!sameStringArray(policy.releaseTracked, derivedReleaseTracked)) {
    issues.push(
      'docs/internal/release-policy.json: releaseTracked must exactly derive from release-tracked tracks',
    )
  }
  if (!sameStringArray(policy.ignored, derivedIgnored)) {
    issues.push('docs/internal/release-policy.json: ignored must exactly derive from ignored tracks')
  }
}

function validateCompatibilityList(
  field: 'releaseTracked' | 'ignored',
  workspaceNames: unknown,
  issues: string[],
): void {
  if (!Array.isArray(workspaceNames) || workspaceNames.length === 0) {
    issues.push(`docs/internal/release-policy.json: ${field} must be a non-empty array`)
    return
  }

  const seen = new Set<string>()
  for (const workspaceName of workspaceNames) {
    if (!isOaSdkPackageName(workspaceName)) {
      issues.push(
        `docs/internal/release-policy.json: invalid workspace name in ${field}: ${String(workspaceName)}`,
      )
      continue
    }
    if (seen.has(workspaceName)) {
      issues.push(
        `docs/internal/release-policy.json: duplicate workspace name in ${field}: ${workspaceName}`,
      )
    }
    seen.add(workspaceName)
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
  if (!sameStringArray(config.ignore ?? [], policy.ignored)) {
    issues.push('.changeset/config.json: ignore must exactly match release-policy.json ignored workspaces')
  }
}

function validateWorkspaceCoverage(
  policy: ReleasePolicy,
  workspacePackages: WorkspacePackage[],
  issues: string[],
): void {
  const policyNames = new Set(getAllTrackWorkspaces(policy))
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
      issues.push(`${label}: ${name} must appear in exactly one release-policy track`)
    }
  }

  for (const name of policyNames) {
    if (!workspaceNames.has(name)) {
      issues.push(`docs/internal/release-policy.json: listed workspace does not exist: ${name}`)
    }
  }
}

function validateRootScripts(
  policy: ReleasePolicy,
  rootPackage: PackageJson,
  workspacePackages: WorkspacePackage[],
  issues: string[],
): void {
  const scripts = rootPackage.scripts ?? {}
  const workspaceByName = new Map(
    workspacePackages
      .map(workspacePackage => [workspacePackage.manifest.name, workspacePackage] as const)
      .filter(([name]) => name !== undefined),
  )

  for (const task of TRACK_TASKS) {
    const expectedDefault = `corepack pnpm ${task}:core`
    if (scripts[task] !== expectedDefault) {
      issues.push(`package.json: scripts.${task} must be exactly: ${expectedDefault}`)
    }

    for (const [groupName, trackNames] of Object.entries(TRACK_SCRIPT_GROUPS)) {
      const scriptName = `${task}:${groupName}`
      const command = scripts[scriptName]
      if (!command) {
        issues.push(`package.json: scripts.${scriptName} is required`)
        continue
      }

      const expectedWorkspaces = trackNames
        .flatMap((trackName) => getTrackWorkspaces(policy, trackName))
        .filter(workspaceName => !policy.bulkTaskExcluded.includes(workspaceName))
        .filter(workspaceName => task !== 'test'
          || (workspaceByName.get(workspaceName)?.manifest.scripts?.test !== undefined
            && workspaceByName.get(workspaceName)?.manifest.scripts?.['test:ci'] !== undefined))
      const filters = readTurboFilters(command, task, scriptName, issues)
      if (!sameStringSet(filters, expectedWorkspaces)) {
        issues.push(
          `package.json: scripts.${scriptName} filters must exactly match ${trackNames.join(' + ')} workspaces ` +
            `(expected: ${expectedWorkspaces.join(', ')})`,
        )
      }
    }
  }

  const expectedRelease = 'corepack pnpm release:export'
  if (scripts.release !== expectedRelease) {
    issues.push(`package.json: scripts.release must be exactly: ${expectedRelease}`)
  }

  const expectedReleaseExport = 'node --import tsx scripts/export-release-artifacts.ts'
  if (scripts['release:export'] !== expectedReleaseExport) {
    issues.push(`package.json: scripts.release:export must be exactly: ${expectedReleaseExport}`)
  }

  const expectedReleasePolicyTest = 'node --import tsx scripts/test-release-policy.ts'
  if (scripts['test:release-policy'] !== expectedReleasePolicyTest) {
    issues.push(
      `package.json: scripts.test:release-policy must be exactly: ${expectedReleasePolicyTest}`,
    )
  }
  const expectedReleasePolicyCheck =
    'node --import tsx scripts/check-release-policy.ts && corepack pnpm test:release-policy && corepack pnpm test:release-preflight'
  if (scripts['check:release-policy'] !== expectedReleasePolicyCheck) {
    issues.push(
      `package.json: scripts.check:release-policy must be exactly: ${expectedReleasePolicyCheck}`,
    )
  }

  if (scripts['check:workspace-scope'] !== 'pnpm check:release-policy') {
    issues.push(
      'package.json: scripts.check:workspace-scope must be the pnpm check:release-policy alias',
    )
  }
}

const DIRECT_PUBLISH_PATTERNS = [
  /\bchangeset\b[^;&|\n]*\bpublish\b/,
  /\b(?:npm|pnpm)\b[^;&|\n]*\bpublish\b/,
  /\byarn\b[^;&|\n]*\bnpm\b[^;&|\n]*\bpublish\b/,
]

export function findDirectPublishScripts(scripts: Record<string, string> | undefined): string[] {
  if (!scripts) return []
  return Object.entries(scripts)
    .filter(([, command]) => DIRECT_PUBLISH_PATTERNS.some(pattern => pattern.test(command)))
    .map(([scriptName]) => scriptName)
    .sort()
}

function validateNoDirectPublishScripts(
  rootPackage: PackageJson,
  workspacePackages: WorkspacePackage[],
  issues: string[],
): void {
  if (rootPackage.private !== true) {
    issues.push('package.json: the private source repository root must remain private')
  }

  const manifests = [
    { label: 'package.json', manifest: rootPackage },
    ...workspacePackages.map(workspacePackage => ({
      label: relative(root, workspacePackage.packageJsonPath),
      manifest: workspacePackage.manifest,
    })),
  ]
  for (const { label, manifest } of manifests) {
    for (const scriptName of findDirectPublishScripts(manifest.scripts)) {
      issues.push(
        `${label}: scripts.${scriptName} performs a direct registry publish; ` +
          `the private source repository permits only ${ARTIFACT_ONLY_PUBLISH_MODE} export`,
      )
    }
  }
}

function readTurboFilters(
  command: string,
  task: (typeof TRACK_TASKS)[number],
  scriptName: string,
  issues: string[],
): string[] {
  const tokens = command.trim().split(/\s+/)
  if (tokens[0] !== 'turbo' || tokens[1] !== 'run' || tokens[2] !== task) {
    issues.push(`package.json: scripts.${scriptName} must start with turbo run ${task}`)
  }

  const filters: string[] = []
  for (let index = 3; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token === '--filter') {
      const filter = tokens[index + 1]
      if (!filter || filter.startsWith('--')) {
        issues.push(`package.json: scripts.${scriptName} has a --filter without a workspace`)
      } else {
        filters.push(filter)
        index += 1
      }
    } else if (token.startsWith('--filter=')) {
      const filter = token.slice('--filter='.length)
      if (!filter) {
        issues.push(`package.json: scripts.${scriptName} has an empty --filter value`)
      } else {
        filters.push(filter)
      }
    }
  }

  return filters
}

function validateWorkspaceManifests(
  policy: ReleasePolicy,
  workspacePackages: WorkspacePackage[],
  issues: string[],
): void {
  const tracked = new Set(getWorkspacesByRelease(policy, 'release-tracked'))
  const ignored = new Set(getWorkspacesByRelease(policy, 'ignored'))
  const distributionCandidates = new Set(policy.distributionCandidates)
  const bulkTaskExcluded = new Set(policy.bulkTaskExcluded)

  for (const workspacePackage of workspacePackages) {
    const { manifest } = workspacePackage
    const label = relative(root, workspacePackage.packageJsonPath)
    const name = manifest.name ?? '<missing-name>'

    if (!manifest.version || !isSemver(manifest.version)) {
      issues.push(`${label}: version must be a semver string`)
    }

    if (!policy.publish.enabled && !distributionCandidates.has(name) && manifest.private !== true) {
      issues.push(`${label}: private must remain true while release-policy publish.enabled is false`)
    }

    if (distributionCandidates.has(name)) {
      if (manifest.private === true) issues.push(`${label}: distribution candidate must not be private`)
      if (!manifest.files?.includes('dist')) issues.push(`${label}: distribution candidate must publish dist via files`)
      if (manifest.publishConfig?.access !== policy.changesets.access || manifest.publishConfig.provenance !== true) {
        issues.push(`${label}: distribution candidate must match release-policy access and require provenance`)
      }
      for (const [sectionName, dependencies] of Object.entries(getRuntimeDependencySections(manifest))) {
        for (const dependencyName of Object.keys(dependencies)) {
          if (dependencyName.startsWith('@oa-sdk/') && !distributionCandidates.has(dependencyName)) {
            issues.push(`${label}: ${sectionName} dependency ${dependencyName} is not a distribution candidate`)
          }
        }
      }
    }

    if (tracked.has(name)) {
      if (manifest.version === '0.0.0') {
        issues.push(`${label}: release-tracked workspaces must not use version 0.0.0`)
      }
      if (!manifest.exports) {
        issues.push(`${label}: release-tracked workspaces must declare package exports`)
      }
    }

    if (ignored.has(name) && manifest.private !== true) {
      issues.push(`${label}: ignored workspaces must remain private`)
    }

    if (bulkTaskExcluded.has(name) && !ignored.has(name)) {
      issues.push(`${label}: bulk-task excluded workspace must be ignored`)
    }

    validateInternalDependencySpecs(label, manifest, issues)
  }
}

function getRuntimeDependencySections(manifest: PackageJson): Record<string, Record<string, string>> {
  return {
    dependencies: manifest.dependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
  }
}

export function validateTrackDependencyBoundaries(
  policy: ReleasePolicy,
  workspacePackages: WorkspacePackage[],
  issues: string[],
): void {
  const trackByWorkspace = new Map<string, TrackName>()
  for (const trackName of TRACK_NAMES) {
    for (const workspaceName of getTrackWorkspaces(policy, trackName)) {
      trackByWorkspace.set(workspaceName, trackName)
    }
  }

  const boundarySources = new Set<TrackName>(['corePlatform', 'downstream'])
  const allowedTargets = new Set<TrackName>(['corePlatform', 'downstream'])

  for (const workspacePackage of workspacePackages) {
    const { manifest } = workspacePackage
    const sourceName = manifest.name
    if (!sourceName) continue

    const sourceTrack = trackByWorkspace.get(sourceName)
    if (!sourceTrack || !boundarySources.has(sourceTrack)) continue

    for (const [sectionName, dependencies] of Object.entries(getDependencySections(manifest))) {
      for (const dependencyName of Object.keys(dependencies)) {
        if (!dependencyName.startsWith('@oa-sdk/')) continue

        const targetTrack = trackByWorkspace.get(dependencyName)
        if (!targetTrack || !allowedTargets.has(targetTrack)) {
          const label = relative(root, workspacePackage.packageJsonPath)
          issues.push(
            `${label}: forbidden ${sectionName} boundary: ` +
              `${sourceName} [${sourceTrack}] -> ${dependencyName} [${targetTrack ?? 'unclassified'}]`,
          )
        } else if (sourceTrack === 'corePlatform' && targetTrack === 'downstream' && sectionName !== 'devDependencies') {
          const label = relative(root, workspacePackage.packageJsonPath)
          issues.push(
            `${label}: forbidden ${sectionName} boundary: ` +
              `corePlatform packages may only reference downstream packages via devDependencies: ` +
              `${sourceName} [${sourceTrack}] -> ${dependencyName} [${targetTrack}]`,
          )
        }
      }
    }
  }
}

function validateReleaseDoc(policy: ReleasePolicy, releaseDoc: string, issues: string[]): void {
  for (const name of getAllTrackWorkspaces(policy)) {
    if (!releaseDoc.includes(`\`${name}\``)) {
      issues.push(`docs/internal/release-management.md: missing policy workspace mention for ${name}`)
    }
  }

  if (!releaseDoc.includes('release-policy.json')) {
    issues.push('docs/internal/release-management.md: must reference release-policy.json')
  }
  if (!releaseDoc.includes(basename(policy.scopeDocument))) {
    issues.push(
      `docs/internal/release-management.md: must reference scopeDocument ${policy.scopeDocument}`,
    )
  }
  if (!releaseDoc.includes(`\`${policy.publish.mode}\``)) {
    issues.push(
      `docs/internal/release-management.md: must document publish mode ${policy.publish.mode}`,
    )
  }
  if (!releaseDoc.includes(`\`${policy.publish.repository}\``)) {
    issues.push(
      `docs/internal/release-management.md: must document artifact repository ${policy.publish.repository}`,
    )
  }

  for (const name of policy.bulkTaskExcluded) {
    if (!releaseDoc.includes(`\`${name}\``)) {
      issues.push(`docs/internal/release-management.md: missing bulk-task exclusion mention for ${name}`)
    }
  }

  const expectedSnapshot = [
    `현재 정책 스냅샷: v${policy.version}`,
    `${TRACK_NAMES.length} tracks`,
    `Core Platform ${getTrackWorkspaces(policy, 'corePlatform').length}`,
    `Downstream ${getTrackWorkspaces(policy, 'downstream').length}`,
    `release-tracked ${policy.releaseTracked.length}`,
    `ignored ${policy.ignored.length}`,
    `distribution candidates ${policy.distributionCandidates.length}.`,
  ].join(' · ')
  if (!releaseDoc.includes(expectedSnapshot)) {
    issues.push(
      `docs/internal/release-management.md: missing or stale policy snapshot: ${expectedSnapshot}`,
    )
  }
}

function validateInternalDependencySpecs(
  packageJsonPath: string,
  manifest: PackageJson,
  issues: string[],
): void {
  for (const [sectionName, dependencies] of Object.entries(getDependencySections(manifest))) {
    for (const [dependencyName, specifier] of Object.entries(dependencies)) {
      if (dependencyName.startsWith('@oa-sdk/') && !specifier.startsWith('workspace:')) {
        issues.push(`${packageJsonPath}: ${sectionName}.${dependencyName} must use workspace: protocol`)
      }
    }
  }
}

function getDependencySections(manifest: PackageJson): Record<string, Record<string, string>> {
  return {
    dependencies: manifest.dependencies ?? {},
    devDependencies: manifest.devDependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    optionalDependencies: manifest.optionalDependencies ?? {},
  }
}

function getTrackWorkspaces(policy: ReleasePolicy, trackName: TrackName): string[] {
  const workspaces = policy.tracks?.[trackName]?.workspaces
  return Array.isArray(workspaces) ? workspaces.filter(isOaSdkPackageName) : []
}

function getAllTrackWorkspaces(policy: ReleasePolicy): string[] {
  return TRACK_NAMES.flatMap((trackName) => getTrackWorkspaces(policy, trackName))
}

function getWorkspacesByRelease(policy: ReleasePolicy, release: TrackRelease): string[] {
  return TRACK_NAMES.flatMap((trackName) =>
    policy.tracks?.[trackName]?.release === release ? getTrackWorkspaces(policy, trackName) : [],
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpsRepository(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

function isTrackName(value: unknown): value is TrackName {
  return typeof value === 'string' && Object.hasOwn(TRACK_RULES, value)
}

function isTrackPolicy(value: unknown): value is TrackPolicy {
  return typeof value === 'string' && ALLOWED_TRACK_POLICIES.has(value as TrackPolicy)
}

function isTrackRelease(value: unknown): value is TrackRelease {
  return typeof value === 'string' && ALLOWED_TRACK_RELEASES.has(value as TrackRelease)
}

function isOaSdkPackageName(value: unknown): value is string {
  return typeof value === 'string' && /^@oa-sdk\/[a-z0-9][a-z0-9-]*$/.test(value)
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

function sameStringArray(left: string[], right: string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameStringSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function sameStringMatrix(left: string[][], right: string[][]): boolean {
  const normalize = (matrix: string[][]): string[] =>
    matrix.map((group) => [...group].sort().join('\0')).sort()

  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
