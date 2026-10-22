/** Produce an artifact-only release for the public oa-sdk-releases repository. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { embeddedVersionTables } from '../packages/codegen/scripts/embedded-workspace-versions.mjs'
import { REGISTRY_OA_SDK_PACKAGES } from '../packages/codegen/src/cli/lib/init/oa-sdk-packages.js'
import { readArtifactReleasePolicy } from './check-release-policy.js'
import { consumerProbeSource } from './lib/public-import-probe.mjs'
import { consumerPeerDependencies, declaredOptionalPeerImports } from './lib/public-manifest.mjs'

const root = resolve(import.meta.dirname, '..')
const sourcePolicyPath = join(root, 'docs/internal/release-policy.json')
const packageBases = ['packages', 'apps'] as const
const CODEGEN_PACKAGE = '@oa-sdk/codegen'
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/'
export const PUBLIC_OA_SDK_SCOPE_REGISTRY_OPTION = `--@oa-sdk:registry=${PUBLIC_NPM_REGISTRY}`

type Candidate = string
export type ReleasePackage = { name: Candidate; version: string; tarball: string; integrity: string }
type Args = { output: string; releaseId: string; versions: Map<Candidate, string>; dryRun: boolean; skipRegistryPreflight: boolean; skipPreflight: boolean }
type ExportContext = {
  args: Args
  packageDirectories: Map<Candidate, string>
  publicRepository: string
  releaseDirectory: string
  sourceRoot: string
  /** Committed version of every workspace package of the source, keyed by package name. */
  sourceVersions: Map<string, string>
  temporaryDirectory: string
}

/** Reads the version a package has on npm, or `undefined` when npm has no such version (E404). */
export type PublishedVersionReader = (name: string, version: string) => string | undefined

export type SourceProvenance = {
  revision: string
  worktree: 'clean' | 'dirty'
}

type SourceWorktreeSnapshot = {
  provenance: SourceProvenance
  status: string
}

export type DraftReleaseMetadata = {
  nonPromotable: true
  sourceCopy: 'isolated-git-visible-worktree'
  sourceWorktree: SourceProvenance['worktree']
}

export type ReleaseManifest = {
  schemaVersion: 1
  releaseId: string
  sourceRevision: string
  packages: ReleasePackage[]
  draft?: DraftReleaseMetadata
}

/** release-policy.json `optionalPeerEntryPoints`: package name -> export subpath -> optional peers it imports. */
export type OptionalPeerEntryPoints = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>

export type ReleaseExportConfiguration = {
  candidates: string[]
  repository: string
  optionalPeerEntryPoints: OptionalPeerEntryPoints
}

export function readReleaseExportConfiguration(
  filePath = sourcePolicyPath,
): ReleaseExportConfiguration {
  const policy = readArtifactReleasePolicy(filePath)
  return {
    candidates: [...policy.distributionCandidates],
    repository: policy.publish.repository,
    optionalPeerEntryPoints: policy.optionalPeerEntryPoints ?? {},
  }
}

/** Dry runs may inspect a draft; every official export must pass source preflight. */
export function requiresReleasePreflight(dryRun: boolean): boolean {
  return !dryRun
}

export function readSourceProvenance(sourceRoot = root): SourceProvenance {
  return readSourceWorktreeSnapshot(sourceRoot).provenance
}

function readSourceWorktreeSnapshot(sourceRoot: string): SourceWorktreeSnapshot {
  const revision = readGit(sourceRoot, ['rev-parse', 'HEAD']).trim()
  const status = readGit(sourceRoot, ['status', '--porcelain'])
  return {
    provenance: { revision, worktree: status.trim() ? 'dirty' : 'clean' },
    status,
  }
}

/**
 * A draft deliberately contains only git-visible input files. Ignored build
 * products and node_modules are rebuilt in the scratch workspace instead of
 * being copied from or changed in the caller's checkout.
 */
export function copyGitVisibleWorkspace(sourceRoot: string, destinationRoot: string): void {
  const entries = readGit(sourceRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)

  for (const entry of entries) {
    const sourcePath = resolve(sourceRoot, entry)
    const destinationPath = resolve(destinationRoot, entry)
    assert(isWithinDirectory(sourceRoot, sourcePath), `git listed source path outside repository: ${entry}`)
    assert(isWithinDirectory(destinationRoot, destinationPath), `git listed destination path outside draft workspace: ${entry}`)
    if (!pathExists(sourcePath)) continue
    mkdirSync(dirname(destinationPath), { recursive: true })
    cpSync(sourcePath, destinationPath, { dereference: false, recursive: true })
  }
}

export function createDraftReleaseMetadata(source: SourceProvenance): DraftReleaseMetadata {
  return {
    nonPromotable: true,
    sourceCopy: 'isolated-git-visible-worktree',
    sourceWorktree: source.worktree,
  }
}

export function createReleaseManifest(
  releaseId: string,
  sourceRevision: string,
  packages: ReleasePackage[],
  draft?: DraftReleaseMetadata,
): ReleaseManifest {
  const manifest: ReleaseManifest = {
    schemaVersion: 1,
    releaseId,
    sourceRevision,
    packages,
  }
  if (draft) manifest.draft = draft
  return manifest
}

function main(): void {
  const configuration = readReleaseExportConfiguration()
  const args = parseArgs(process.argv.slice(2), configuration.candidates)
  const outputRoot = args.dryRun ? mkdtempSync(join(tmpdir(), 'oa-sdk-release-export-')) : args.output
  const releaseDirectory = join(outputRoot, 'releases', args.releaseId)
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-release-pack-'))
  let draftSourceDirectory: string | undefined

  try {
    const sourceSnapshot = readSourceWorktreeSnapshot(root)
    const sourceProvenance = sourceSnapshot.provenance
    let sourceRoot = root
    if (requiresReleasePreflight(args.dryRun) && !args.skipPreflight) {
      assert(sourceProvenance.worktree === 'clean', 'official release export requires a clean, committed private source worktree')
      runReleasePreflight()
    } else if (!args.dryRun) {
      assert(sourceProvenance.worktree === 'clean', 'official release export requires a clean, committed private source worktree')
    } else {
      draftSourceDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-release-draft-source-'))
      sourceRoot = join(draftSourceDirectory, 'source')
      copyGitVisibleWorkspace(root, sourceRoot)
      assertDraftSourceSnapshotUnchanged(root, sourceSnapshot)
      console.warn(
        `DRAFT ONLY — NON-PROMOTABLE: source worktree is ${sourceProvenance.worktree}; ` +
          'package builds run in an isolated temporary source copy and cannot modify this worktree.',
      )
      run(['corepack', 'pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], sourceRoot)
      run(['corepack', 'pnpm', 'build:core'], sourceRoot)
    }

    const workspacePackages = readWorkspacePackages(sourceRoot)
    const context: ExportContext = {
      args,
      packageDirectories: candidateDirectories(configuration.candidates, workspacePackages),
      publicRepository: configuration.repository,
      releaseDirectory,
      sourceRoot,
      sourceVersions: workspaceVersions(workspacePackages),
      temporaryDirectory,
    }

    assert(existsSync(join(sourceRoot, 'LICENSE')), 'root LICENSE is required for public release artifacts')
    assert(!existsSync(releaseDirectory), `release directory already exists: ${relative(outputRoot, releaseDirectory)}`)
    if (!args.dryRun) validateReleaseRepository(outputRoot, configuration.repository, configuration.candidates)
    mkdirSync(join(releaseDirectory, 'packages'), { recursive: true })

    const packages: ReleasePackage[] = []
    for (const name of configuration.candidates) {
      const version = args.versions.get(name)
      if (!version) continue
      if (!args.skipRegistryPreflight) assertVersionAvailable(name, version)
      const exported = exportPackage(name, version, context)
      if (name === CODEGEN_PACKAGE) verifyCodegenBuiltAgainstVersions(exported, context)
      packages.push(exported)
    }
    assert(packages.length > 0, 'at least one --version <package>=<version> is required')
    validateSanitizedReleaseConsumption(packages, releaseDirectory, configuration.optionalPeerEntryPoints)
    const draft = args.dryRun ? createDraftReleaseMetadata(sourceProvenance) : undefined
    writeJson(join(releaseDirectory, 'manifest.json'), createReleaseManifest(
      args.releaseId,
      sourceProvenance.revision,
      packages,
      draft,
    ))
    console.log(args.dryRun
      ? `Draft release export ready (NON-PROMOTABLE): ${releaseDirectory}`
      : `Release export ready: ${releaseDirectory}`)
    for (const entry of packages) console.log(`  ${entry.name}@${entry.version} ${entry.tarball}`)
    if (args.dryRun) {
      console.log('DRAFT ONLY — manifest.draft.nonPromotable=true. Do not copy this output into a promotion repository.')
      console.log('Dry run output is retained in a temporary directory for inspection.')
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    if (draftSourceDirectory) rmSync(draftSourceDirectory, { recursive: true, force: true })
  }
}

function exportPackage(name: Candidate, version: string, context: ExportContext): ReleasePackage {
  const sourceDirectory = context.packageDirectories.get(name)
  assert(sourceDirectory, `distribution candidate does not resolve to a workspace: ${name}`)
  const sourceManifest = readJson(join(sourceDirectory, 'package.json')) as Record<string, unknown>
  if (!context.args.dryRun) assertReleaseVersionMatchesSource(name, version, sourceManifest.version)
  const packDirectory = join(context.temporaryDirectory, safeName(name))
  const unpackDirectory = join(packDirectory, 'unpacked')
  mkdirSync(packDirectory, { recursive: true })
  mkdirSync(unpackDirectory, { recursive: true })

  // Mirror the clean private CI checkout so stale tsup chunks cannot enter a
  // public release tarball when this command is run locally.
  run(['pnpm', '--dir', sourceDirectory, 'run', 'clean'], context.sourceRoot)
  run(['pnpm', '--dir', sourceDirectory, 'run', 'build'], context.sourceRoot)
  run(['pnpm', '--dir', sourceDirectory, 'pack', '--pack-destination', packDirectory], context.sourceRoot)
  run(['tar', '-xzf', onlyTarball(packDirectory), '-C', unpackDirectory], context.sourceRoot)
  const stagedDirectory = join(unpackDirectory, 'package')
  sanitize(stagedDirectory)
  writeJson(join(stagedDirectory, 'package.json'), publicManifest(sourceManifest, name, version, context))
  ensureReadme(stagedDirectory, name, version)
  copyFileSync(join(context.sourceRoot, 'LICENSE'), join(stagedDirectory, 'LICENSE'))

  const destination = join(context.releaseDirectory, 'packages')
  runIsolatedNpm(['pack', '--pack-destination', destination], stagedDirectory)
  const archive = onlyTarball(destination, name, version)
  validateArchive(archive, name, version, context.publicRepository)
  return { name, version, tarball: `packages/${basename(archive)}`, integrity: sha512(archive) }
}

function publicManifest(
  source: Record<string, unknown>,
  name: Candidate,
  version: string,
  context: ExportContext,
): Record<string, unknown> {
  const manifest = structuredClone(source)
  manifest.name = name
  manifest.version = version
  manifest.private = false
  manifest.license = 'Apache-2.0'
  manifest.repository = { type: 'git', url: `git+${context.publicRepository}` }
  manifest.publishConfig = { access: 'public', provenance: true }
  manifest.files = ['dist', 'lib', 'README.md', 'LICENSE']
  delete manifest.devDependencies
  delete manifest.scripts
  delete manifest.packageManager
  delete manifest.workspaces
  const resolvePublicVersion = createInternalDependencyResolver(
    name,
    context.args.versions,
    context.sourceVersions,
    (dependencyName, dependencyVersion) => publishedVersion(dependencyName, dependencyVersion),
  )
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    if (isRecord(manifest[key])) {
      manifest[key] = rewriteWorkspaceDependencies(manifest[key], resolvePublicVersion)
    }
  }
  return manifest
}

/**
 * Version an exported package's public manifest gives each internal
 * (`workspace:`) dependency: the version this export releases it at, or else
 * its committed source version, which must already be on npm.
 *
 * The committed version is the one the dependent was built and tested
 * against, and the one pnpm itself writes for `workspace:`. The export fails
 * when npm does not have it, instead of pinning npm's latest release, which
 * would publish the dependent against a release it was never tested with: an
 * older one, without the changes it needs, when the committed version is not
 * released yet. The registry is consulted only for dependencies this export
 * does not release, and lookup failures other than npm's E404 propagate (see
 * `publishedVersion`). Returns `undefined` for a package the source workspace
 * does not have.
 */
export function createInternalDependencyResolver(
  dependent: string,
  exportVersions: ReadonlyMap<string, string>,
  sourceVersions: ReadonlyMap<string, string>,
  readPublishedVersion: PublishedVersionReader,
): (dependency: string) => string | undefined {
  return dependency => {
    const exported = exportVersions.get(dependency)
    if (exported !== undefined) return exported
    const committed = sourceVersions.get(dependency)
    if (committed === undefined) return undefined
    assert(
      readPublishedVersion(dependency, committed) !== undefined,
      `${dependent}: internal dependency ${dependency}@${committed}, the committed version ${dependent} ` +
        'is built and tested against, is neither in this export nor published on npm; ' +
        `add --version ${dependency}=${committed} to this export, or publish ${dependency}@${committed} first`,
    )
    return committed
  }
}

export function rewriteWorkspaceDependencies(
  dependencies: Record<string, unknown>,
  resolvePublicVersion: (name: string) => string | undefined,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(dependencies)) {
    if (typeof value !== 'string' || !value.startsWith('workspace:')) {
      rewritten[name] = value
      continue
    }
    const version = resolvePublicVersion(name)
    assert(
      version,
      `cannot resolve a public version for internal workspace dependency ${name}; ` +
        'artifact-only export cannot omit it',
    )
    const range = value.slice('workspace:'.length)
    rewritten[name] = range === '*' || range === '' ? version : range === '^' || range === '~' ? `${range}${version}` : range
  }
  return rewritten
}

/**
 * `@oa-sdk` packages whose built-against version a packed `@oa-sdk/codegen`
 * names to its users, other than codegen itself: every package `oa-gen init`
 * writes a registry range for, the companion packages whose install hints
 * `oa-gen` prints included (`REGISTRY_OA_SDK_PACKAGES`). The range init
 * writes for codegen itself is covered by the export, which releases codegen
 * at its source version.
 */
export const CODEGEN_BUILT_AGAINST_GATED_PACKAGES: readonly string[] = REGISTRY_OA_SDK_PACKAGES
  .filter(name => name !== CODEGEN_PACKAGE)

/**
 * Checks the release tarball rather than the build output, so that the gate
 * covers what ships (`assertCodegenBuiltAgainstVersionsReleasable`).
 */
function verifyCodegenBuiltAgainstVersions(codegen: ReleasePackage, context: ExportContext): void {
  const unpackDirectory = join(context.temporaryDirectory, 'codegen-built-against-versions')
  mkdirSync(unpackDirectory, { recursive: true })
  run(['tar', '-xzf', join(context.releaseDirectory, codegen.tarball), '-C', unpackDirectory], context.sourceRoot)
  assertCodegenBuiltAgainstVersionsReleasable(
    join(unpackDirectory, 'package'),
    codegen.version,
    context.args.versions,
    (name, version) => publishedVersion(name, version),
  )
}

/**
 * Fails a codegen export when the codegen unpacked in `packageRoot` would tell
 * users to install a package version that npm cannot resolve: the version it
 * embeds (`embeddedBuiltAgainstVersions`) for each of `packages` must be
 * releasable (`assertBuiltAgainstVersionsReleasable`).
 */
export function assertCodegenBuiltAgainstVersionsReleasable(
  packageRoot: string,
  codegenVersion: string,
  exportVersions: ReadonlyMap<string, string>,
  readPublishedVersion: PublishedVersionReader,
  packages: readonly string[] = CODEGEN_BUILT_AGAINST_GATED_PACKAGES,
): void {
  assertBuiltAgainstVersionsReleasable(
    codegenVersion,
    embeddedBuiltAgainstVersions(embeddedVersionTables(packageRoot, packages), packages),
    exportVersions,
    readPublishedVersion,
  )
}

/**
 * The version of each of `packages` that a packed `@oa-sdk/codegen` embeds,
 * from the package-to-version tables found in its JavaScript
 * (`embeddedVersionTables`). `oa-gen init` writes the range of this version,
 * and the install command `oa-gen` prints for a missing companion package
 * pins it, so every package must have exactly one.
 */
export function embeddedBuiltAgainstVersions(
  tables: readonly Readonly<Record<string, string>>[],
  packages: readonly string[],
): Map<string, string> {
  const versions = new Map<string, string>()
  for (const name of packages) {
    const embedded = [...new Set(tables.flatMap(table => Object.hasOwn(table, name) ? [table[name]!] : []))]
    assert(
      embedded.length > 0,
      `${CODEGEN_PACKAGE}: the packed artifact embeds no version for ${name}, ` +
        'so the range oa-gen names for it cannot be checked',
    )
    assert(
      embedded.length === 1,
      `${CODEGEN_PACKAGE}: the packed artifact embeds conflicting versions for ${name}: ` +
        embedded.join(', '),
    )
    versions.set(name, embedded[0]!)
  }
  return versions
}

/**
 * Fails a codegen export whose `oa-gen` would tell users to install a package
 * version that npm cannot resolve.
 *
 * `oa-gen init` writes `^<version>` for the `@oa-sdk` packages of its
 * scaffold, and `oa-gen` loads its companion packages with dynamic imports
 * and, when one is missing, prints an install command pinned the same way,
 * where `<version>` is the one codegen was built against. Neither goes
 * through the public manifest: the release policy lets codegen reference the
 * Downstream companion packages only through devDependencies, which
 * `publicManifest` removes, and the runtime dependency it does keep on a
 * package such as `@oa-sdk/core` says nothing about the range init writes for
 * it. This applies the rule `createInternalDependencyResolver` enforces for
 * runtime dependencies to the embedded versions: each package must be in this
 * export at exactly that version, or already be published. The registry is
 * consulted only for packages this export does not release at that version,
 * and lookup failures other than npm's E404 propagate (see `publishedVersion`).
 */
export function assertBuiltAgainstVersionsReleasable(
  codegenVersion: string,
  builtAgainstVersions: ReadonlyMap<string, string>,
  exportVersions: ReadonlyMap<string, string>,
  readPublishedVersion: PublishedVersionReader,
): void {
  const unresolvable: string[] = []
  for (const [name, version] of builtAgainstVersions) {
    const exported = exportVersions.get(name)
    if (exported === version || readPublishedVersion(name, version) !== undefined) continue
    unresolvable.push(exported === undefined
      ? `  - ${name}@${version}: add --version ${name}=${version} to this export, ` +
          `or publish ${name}@${version} first`
      : `  - ${name}@${version}: this export releases ${name}=${exported} instead; ` +
          `export --version ${name}=${version}, or publish ${name}@${version} first`)
  }
  assert(unresolvable.length === 0, [
    `${CODEGEN_PACKAGE}@${codegenVersion}: oa-gen tells users to install these package versions ` +
      '(oa-gen init writes their ranges, and its install hints pin companion packages to them), ' +
      'but they are neither in this export nor published on npm:',
    ...unresolvable,
  ].join('\n'))
}

/**
 * Official artifact versions must be the reviewed, committed workspace package
 * versions produced by the Changesets flow. Dry runs remain available for
 * prospective version inspection without changing source manifests.
 */
export function assertReleaseVersionMatchesSource(
  packageName: string,
  requestedVersion: string,
  sourceVersion: unknown,
): void {
  assert(typeof sourceVersion === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(sourceVersion), `${packageName}: source package version must be a valid SemVer string`)
  assert(
    requestedVersion === sourceVersion,
    `${packageName}: official export version ${requestedVersion} must match the committed source package version ${sourceVersion}; run pnpm version-packages and commit the result first`,
  )
}

function sanitize(directory: string): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (!['dist', 'lib', 'package.json', 'README.md'].includes(entry)) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    removeForbidden(path)
  }
}

function removeForbidden(path: string): void {
  if (!existsSync(path)) return
  if (!statSync(path).isDirectory()) {
    if (isForbidden(path)) rmSync(path, { force: true })
    return
  }
  for (const entry of readdirSync(path)) removeForbidden(join(path, entry))
}

function isForbidden(path: string): boolean {
  const file = basename(path)
  return file.endsWith('.map') || file.includes('.test.') || file.includes('.spec.')
}

function ensureReadme(directory: string, name: string, version: string): void {
  const path = join(directory, 'README.md')
  if (!existsSync(path)) writeFileSync(path, `# ${name}\n\nPublished OA SDK artifact version ${version}.\n`, 'utf8')
}

function validateArchive(
  archive: string,
  name: Candidate,
  version: string,
  publicRepository: string,
): void {
  const files = run(['tar', '-tzf', archive], root).trim().split('\n').filter(Boolean)
  for (const file of files) {
    const allowed = file === 'package/package.json' || file === 'package/README.md' || file === 'package/LICENSE' || file.startsWith('package/dist/') || file.startsWith('package/lib/')
    assert(allowed, `${name}: forbidden public artifact path ${file}`)
    assert(!isForbidden(file), `${name}: source map or test leaked into artifact: ${file}`)
  }
  const manifest = JSON.parse(run(['tar', '-xOf', archive, 'package/package.json'], root)) as Record<string, unknown>
  assert(manifest.name === name && manifest.version === version, `${name}: packed manifest version mismatch`)
  assert(isRecord(manifest.repository) && manifest.repository.url === `git+${publicRepository}`, `${name}: public repository metadata is missing`)
  assert(manifest.license === 'Apache-2.0', `${name}: Apache-2.0 license is missing`)
  assert(!containsWorkspaceProtocol(manifest), `${name}: workspace: protocol leaked into artifact`)
  const fileSet = new Set(files)
  for (const target of collectManifestTargets(manifest)) {
    assert(fileSet.has(`package/${target}`), `${name}: packed manifest target does not exist: ${target}`)
  }
}

export function collectManifestTargets(manifest: Record<string, unknown>): string[] {
  const targets = new Set<string>()
  for (const field of ['main', 'module', 'types'] as const) {
    addRelativeTarget(targets, manifest[field])
  }
  addRelativeTarget(targets, manifest.exports)
  addRelativeTarget(targets, manifest.bin)
  return [...targets].sort()
}

function addRelativeTarget(targets: Set<string>, value: unknown): void {
  if (typeof value === 'string') {
    if (value.startsWith('./')) targets.add(value.slice(2))
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) addRelativeTarget(targets, entry)
    return
  }
  if (isRecord(value)) {
    for (const entry of Object.values(value)) addRelativeTarget(targets, entry)
  }
}

function containsWorkspaceProtocol(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('workspace:')
  if (Array.isArray(value)) return value.some(containsWorkspaceProtocol)
  return isRecord(value) && Object.values(value).some(containsWorkspaceProtocol)
}

export function publicImportSpecifiers(
  packageName: string,
  manifest: Record<string, unknown>,
): string[] {
  const packageExports = manifest.exports
  if (typeof packageExports === 'string' || !isRecord(packageExports)) return [packageName]

  const subpaths = Object.keys(packageExports).filter(key => key === '.' || key.startsWith('./'))
  if (subpaths.length === 0) return [packageName]
  return subpaths
    .filter(subpath => !subpath.includes('*') && subpath !== './package.json')
    .map(subpath => subpath === '.' ? packageName : `${packageName}/${subpath.slice(2)}`)
    .sort()
}

/**
 * Installs the exported tarballs into a scratch consumer and checks that their
 * public entry points import and type-check, and that the packed `oa-gen` runs.
 *
 * The consumer first gets what a consumer's package manager installs with the
 * packages: their dependencies and required peers, not their optional peers.
 * Every entry point must import with that alone, and `oa-gen` runs there.
 * The entry points `optionalPeerEntryPoints` declares are the exception: they
 * must fail without their optional peers and import once those are installed
 * too.
 */
export function validateSanitizedReleaseConsumption(
  packages: readonly ReleasePackage[],
  releaseDirectory: string,
  optionalPeerEntryPoints: OptionalPeerEntryPoints = {},
): void {
  const consumerDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-release-consumer-'))
  try {
    const archives = packages.map(entry => join(releaseDirectory, entry.tarball))
    const manifests = packages.map((entry, index) => ({
      entry,
      manifest: JSON.parse(
        run(['tar', '-xOf', archives[index]!, 'package/package.json'], root),
      ) as Record<string, unknown>,
    }))
    const specifiers = manifests.flatMap(({ entry, manifest }) =>
      publicImportSpecifiers(entry.name, manifest))
    const packageManifests = manifests.map(({ manifest }) => manifest)
    const optionalPeerImports = manifests.flatMap(({ entry }) =>
      declaredOptionalPeerImports(optionalPeerEntryPoints, entry.name))
    const declaredSpecifiers = new Set(optionalPeerImports.map(({ specifier }) => specifier))
    for (const specifier of declaredSpecifiers) {
      assert(specifiers.includes(specifier), `optionalPeerEntryPoints declares ${specifier}, which is not a public entry point`)
    }
    const requiredPeers = consumerPeerDependencies(packageManifests)
    const npmInstallFlags = [
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--omit=optional',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ]

    writeJson(join(consumerDirectory, 'package.json'), {
      name: 'oa-sdk-sanitized-release-consumer-smoke',
      private: true,
      type: 'module',
      dependencies: requiredPeers,
    })
    runIsolatedNpm(['install', ...npmInstallFlags, ...archives], consumerDirectory)
    runConsumerImportProbe(consumerDirectory, {
      imports: specifiers.filter(specifier => !declaredSpecifiers.has(specifier)),
      withoutOptionalPeers: optionalPeerImports,
    })

    const generatedTypesPath = join(consumerDirectory, 'generated-types.ts')
    const codegen = manifests.find(({ entry }) => entry.name === CODEGEN_PACKAGE)
    if (codegen) {
      const executable = join(
        consumerDirectory,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'oa-gen.cmd' : 'oa-gen',
      )
      assert(existsSync(executable), '@oa-sdk/codegen: installed oa-gen binary link is missing')
      const help = run([executable, '--help'], consumerDirectory)
      assert(help.includes('validate') && help.includes('typegen'), 'oa-gen --help is missing validate/typegen')

      const specPath = join(consumerDirectory, 'smoke.openapi.json')
      writeJson(specPath, {
        openapi: '3.2.0',
        info: { title: 'Sanitized release smoke', version: '1.0.0' },
        paths: {
          '/health': {
            get: {
              operationId: 'getHealth',
              responses: {
                200: {
                  description: 'Healthy',
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/Health' },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Health: {
              type: 'object',
              properties: { ok: { type: 'boolean' } },
              required: ['ok'],
            },
          },
        },
      })
      run([executable, 'validate', '--spec', specPath, '--require-32'], consumerDirectory)
      run([executable, 'typegen', '--spec', specPath, '--output', generatedTypesPath], consumerDirectory)
      assert(
        existsSync(generatedTypesPath) && readFileSync(generatedTypesPath, 'utf8').includes('export'),
        'oa-gen typegen did not produce TypeScript output',
      )
    }

    // The entry points that need optional peers import once those are installed
    // as well, which the type check below also needs.
    if (optionalPeerImports.length > 0) {
      const optionalPeers = consumerPeerDependencies(packageManifests, {
        optionalPeers: [...new Set(optionalPeerImports.flatMap(({ peers }) => peers))],
      })
      const additions = Object.entries(optionalPeers)
        .filter(([name]) => !Object.hasOwn(requiredPeers, name))
        .map(([name, range]) => `${name}@${range}`)
      runIsolatedNpm(['install', ...npmInstallFlags, ...additions], consumerDirectory)
      runConsumerImportProbe(consumerDirectory, { imports: [...declaredSpecifiers] })
    }

    const typeScriptManifest = readJson(join(root, 'node_modules/typescript/package.json'))
    assert(
      isRecord(typeScriptManifest)
        && typeof typeScriptManifest.version === 'string'
        && typeScriptManifest.version.startsWith('5.'),
      'sanitized release consumer smoke requires the repository TypeScript 5 toolchain',
    )
    const importBindings = specifiers.map((specifier, index) =>
      `import * as surface${index} from ${JSON.stringify(specifier)}`)
    writeFileSync(
      join(consumerDirectory, 'consumer.ts'),
      `${importBindings.join('\n')}\nvoid [${specifiers.map((_, index) => `surface${index}`).join(', ')}]\n`,
      'utf8',
    )
    writeJson(join(consumerDirectory, 'tsconfig.json'), {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ['consumer.ts', ...(codegen ? ['generated-types.ts'] : [])],
    })
    run([
      process.execPath,
      join(root, 'node_modules/typescript/bin/tsc'),
      '--project',
      join(consumerDirectory, 'tsconfig.json'),
    ], consumerDirectory)
    console.log(
      `Sanitized release consumer smoke OK: ${packages.length} package(s), ` +
        `${specifiers.length} public import(s), TypeScript ${typeScriptManifest.version}`,
    )
  } finally {
    rmSync(consumerDirectory, { recursive: true, force: true })
  }
}

/** Runs the public import probe (scripts/lib/public-import-probe.mjs) inside `consumerDirectory`. */
function runConsumerImportProbe(
  consumerDirectory: string,
  plan: { imports: readonly string[]; withoutOptionalPeers?: readonly { specifier: string; peers: readonly string[] }[] },
): void {
  const probePath = join(consumerDirectory, 'import-probe.mjs')
  writeFileSync(probePath, consumerProbeSource(plan), 'utf8')
  console.log(run([process.execPath, probePath], consumerDirectory).trim())
}

function validateReleaseRepository(
  path: string,
  publicRepository: string,
  candidates: readonly string[],
): void {
  const policy = readJson(join(path, 'release-policy.json')) as Record<string, unknown>
  assert(policy.repository === publicRepository, `release repository must declare ${publicRepository}`)
  assert(Array.isArray(policy.distributionCandidates), 'release repository release-policy.json must list distributionCandidates')
  const declared = new Set(
    policy.distributionCandidates.filter((item): item is string => typeof item === 'string'),
  )
  const missing = candidates.filter(candidate => !declared.has(candidate))
  assert(
    missing.length === 0,
    `release repository release-policy.json is missing distribution candidates: ${missing.join(', ')}. Update it in the release PR before exporting.`,
  )
}

type WorkspacePackage = { directory: string; version: unknown }

/** Workspace packages of the source, keyed by package name. */
function readWorkspacePackages(sourceRoot: string): Map<string, WorkspacePackage> {
  const packages = new Map<string, WorkspacePackage>()
  for (const base of packageBases) {
    const baseDirectory = join(sourceRoot, base)
    if (!existsSync(baseDirectory)) continue
    for (const entry of readdirSync(baseDirectory).sort()) {
      const directory = join(baseDirectory, entry)
      const manifestPath = join(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = readJson(manifestPath)
      if (!isRecord(manifest) || typeof manifest.name !== 'string') continue
      assert(!packages.has(manifest.name), `duplicate workspace package: ${manifest.name}`)
      packages.set(manifest.name, { directory, version: manifest.version })
    }
  }
  return packages
}

function candidateDirectories(
  candidates: readonly string[],
  workspacePackages: ReadonlyMap<string, WorkspacePackage>,
): Map<string, string> {
  const directories = new Map<string, string>()
  for (const candidate of candidates) {
    const workspace = workspacePackages.get(candidate)
    assert(workspace, `distribution candidate does not resolve to a workspace: ${candidate}`)
    directories.set(candidate, workspace.directory)
  }
  return directories
}

function workspaceVersions(workspacePackages: ReadonlyMap<string, WorkspacePackage>): Map<string, string> {
  const versions = new Map<string, string>()
  for (const [name, { version }] of workspacePackages) {
    if (typeof version === 'string' && version !== '') versions.set(name, version)
  }
  return versions
}

function assertVersionAvailable(name: string, version: string): void {
  assert(!publishedVersion(name, version), `${name}@${version} already exists on npm; choose a new immutable version`)
}

type NpmVersionReader = (target: string) => string

/**
 * Read a package version from npm. Only npm's explicit E404 response means the
 * requested package or version is absent; all other lookup failures are unsafe
 * for release preflight and deliberately surface to the caller.
 */
export function publishedVersion(
  name: string,
  exactVersion?: string,
  readNpmVersion: NpmVersionReader = runNpmVersionQuery,
): string | undefined {
  const target = exactVersion ? `${name}@${exactVersion}` : name
  let output: string
  try {
    output = readNpmVersion(target)
  } catch (error) {
    if (isNpmNotFound(error)) return undefined
    throw new Error(`npm registry lookup failed for ${target}: ${npmErrorDetails(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(output.trim()) as unknown
  } catch (error) {
    throw new Error(`npm registry lookup returned invalid JSON for ${target}: ${npmErrorDetails(error)}`)
  }
  if (typeof parsed !== 'string' || parsed.length === 0) {
    throw new Error(`npm registry lookup returned an invalid version for ${target}`)
  }
  return parsed
}

export function createPublicNpmVersionQueryArgs(target: string): string[] {
  return [
    'view',
    target,
    'version',
    '--json',
    // A stale npm cache made a just-published version look absent during the 2026-10-22 release.
    '--prefer-online',
    '--registry',
    PUBLIC_NPM_REGISTRY,
    PUBLIC_OA_SDK_SCOPE_REGISTRY_OPTION,
  ]
}

function runNpmVersionQuery(target: string): string {
  return execFileSync('npm', createPublicNpmVersionQueryArgs(target), {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function isNpmNotFound(error: unknown): boolean {
  return /npm\s+(?:ERR!|error)\s+code\s+E404\b/i.test(npmErrorDetails(error))
}

function npmErrorDetails(error: unknown): string {
  const details: string[] = []
  if (error instanceof Error && error.message) details.push(error.message)
  if (isRecord(error)) {
    for (const value of [error.stderr, error.stdout]) {
      if (typeof value === 'string' && value) details.push(value)
      else if (value instanceof Uint8Array && value.byteLength > 0) details.push(new TextDecoder().decode(value))
    }
  }
  return details.join('\n') || String(error)
}

function onlyTarball(directory: string, name?: Candidate, version?: string): string {
  const matches = readdirSync(directory).filter(file => file.endsWith('.tgz') && (!name || file.includes(safeName(name))) && (!version || file.includes(version)))
  assert(matches.length === 1, `expected exactly one tarball in ${directory}, found ${matches.join(', ') || 'none'}`)
  return join(directory, matches[0]!)
}

function safeName(name: string): string {
  return name.replace('@', '').replace('/', '-')
}

function sha512(path: string): string {
  return `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function isWithinDirectory(directory: string, path: string): boolean {
  const relation = relative(directory, path)
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

function assertDraftSourceSnapshotUnchanged(sourceRoot: string, before: SourceWorktreeSnapshot): void {
  const after = readSourceWorktreeSnapshot(sourceRoot)
  assert(
    after.provenance.revision === before.provenance.revision && after.status === before.status,
    'draft source changed while its isolated snapshot was being created; retry after edits stop',
  )
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return false
    throw error
  }
}

function run(command: string[], cwd: string): string {
  return execFileSync(command[0]!, command.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

/** Official artifact exports must carry the same source evidence as the release guide. */
function runReleasePreflight(): void {
  execFileSync('corepack', ['pnpm', 'release:preflight'], { cwd: root, stdio: 'inherit' })
}

function runIsolatedNpm(args: string[], cwd: string): string {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    const normalized = key.toLowerCase()
    if (normalized.startsWith('npm_config_') || normalized.startsWith('pnpm_config_')) {
      delete environment[key]
    }
  }
  return execFileSync('npm', args, {
    cwd,
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function parseArgs(values: string[], candidates: readonly string[]): Args {
  if (values[0] === '--') values = values.slice(1)
  let output: string | undefined
  let releaseId: string | undefined
  const versions = new Map<Candidate, string>()
  let dryRun = false
  let skipRegistryPreflight = false
  let skipPreflight = false
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--output') { output = values[++index] }
    else if (value === '--release-id') { releaseId = values[++index] }
    else if (value === '--version') {
      const pair = values[++index]
      const separator = pair?.lastIndexOf('=') ?? -1
      const name = separator > 0 ? pair!.slice(0, separator) : ''
      const version = separator > 0 ? pair!.slice(separator + 1) : ''
      assert(candidates.includes(name), `unsupported distribution candidate: ${name || '<missing>'}`)
      assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), `invalid version: ${version || '<missing>'}`)
      assert(!versions.has(name), `duplicate version declaration: ${name}`)
      versions.set(name, version)
    } else if (value === '--dry-run') dryRun = true
    else if (value === '--skip-registry-preflight') skipRegistryPreflight = true
    else if (value === '--skip-preflight') skipPreflight = true
    else throw new Error(`unknown option: ${value}`)
  }
  assert(typeof releaseId === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(releaseId), 'use --release-id <immutable-release-id>')
  assert(dryRun || typeof output === 'string', 'use --output <oa-sdk-releases repository>')
  assert(!skipRegistryPreflight || dryRun, '--skip-registry-preflight is allowed only with --dry-run')
  return { output: output ? resolve(output) : '', releaseId, versions, dryRun, skipRegistryPreflight, skipPreflight }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
