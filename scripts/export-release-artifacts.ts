/** Produce an artifact-only release for the public oa-sdk-releases repository. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const publicRepository = 'https://github.com/mineclover/oa-sdk-releases.git'
const candidates = [
  '@oa-sdk/core',
  '@oa-sdk/openapi-projection-contract',
  '@oa-sdk/typespec-decorators',
  '@oa-sdk/parser',
  '@oa-sdk/codegen',
] as const
type Candidate = typeof candidates[number]
const packageDirectories: Record<Candidate, string> = {
  '@oa-sdk/core': 'packages/core',
  '@oa-sdk/openapi-projection-contract': 'packages/openapi-projection-contract',
  '@oa-sdk/typespec-decorators': 'packages/typespec-decorators',
  '@oa-sdk/parser': 'packages/parser',
  '@oa-sdk/codegen': 'packages/codegen',
}

type ReleasePackage = { name: Candidate; version: string; tarball: string; integrity: string }
type Args = { output: string; releaseId: string; versions: Map<Candidate, string>; dryRun: boolean; skipRegistryPreflight: boolean }

const args = parseArgs(process.argv.slice(2))
const sourceRevision = run(['git', 'rev-parse', 'HEAD'], root).trim()
const outputRoot = args.dryRun ? mkdtempSync(join(tmpdir(), 'oa-sdk-release-export-')) : args.output
const releaseDirectory = join(outputRoot, 'releases', args.releaseId)
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-release-pack-'))

try {
  assert(existsSync(join(root, 'LICENSE')), 'root LICENSE is required for public release artifacts')
  if (!args.dryRun) {
    assert(run(['git', 'status', '--porcelain'], root).trim() === '', 'official release export requires a clean, committed private source worktree')
  }
  assert(!existsSync(releaseDirectory), `release directory already exists: ${relative(outputRoot, releaseDirectory)}`)
  if (!args.dryRun) validateReleaseRepository(outputRoot)
  mkdirSync(join(releaseDirectory, 'packages'), { recursive: true })

  const packages: ReleasePackage[] = []
  for (const name of candidates) {
    const version = args.versions.get(name)
    if (!version) continue
    if (!args.skipRegistryPreflight) assertVersionAvailable(name, version)
    packages.push(exportPackage(name, version))
  }
  assert(packages.length > 0, 'at least one --version <package>=<version> is required')
  writeJson(join(releaseDirectory, 'manifest.json'), {
    schemaVersion: 1,
    releaseId: args.releaseId,
    sourceRevision,
    packages,
  })
  console.log(`Release export ready: ${releaseDirectory}`)
  for (const entry of packages) console.log(`  ${entry.name}@${entry.version} ${entry.tarball}`)
  if (args.dryRun) console.log('Dry run output is retained in a temporary directory for inspection.')
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}

function exportPackage(name: Candidate, version: string): ReleasePackage {
  const sourceDirectory = join(root, packageDirectories[name])
  const sourceManifest = readJson(join(sourceDirectory, 'package.json')) as Record<string, unknown>
  const packDirectory = join(temporaryDirectory, safeName(name))
  const unpackDirectory = join(packDirectory, 'unpacked')
  mkdirSync(packDirectory, { recursive: true })
  mkdirSync(unpackDirectory, { recursive: true })

  // Mirror the clean private CI checkout so stale tsup chunks cannot enter a
  // public release tarball when this command is run locally.
  run(['pnpm', '--dir', sourceDirectory, 'run', 'clean'], root)
  run(['pnpm', '--dir', sourceDirectory, 'run', 'build'], root)
  run(['pnpm', '--dir', sourceDirectory, 'pack', '--pack-destination', packDirectory], root)
  run(['tar', '-xzf', onlyTarball(packDirectory), '-C', unpackDirectory], root)
  const stagedDirectory = join(unpackDirectory, 'package')
  sanitize(stagedDirectory)
  writeJson(join(stagedDirectory, 'package.json'), publicManifest(sourceManifest, name, version))
  ensureReadme(stagedDirectory, name, version)
  copyFileSync(join(root, 'LICENSE'), join(stagedDirectory, 'LICENSE'))

  const destination = join(releaseDirectory, 'packages')
  run(['npm', 'pack', '--pack-destination', destination], stagedDirectory)
  const archive = onlyTarball(destination, name, version)
  validateArchive(archive, name, version)
  return { name, version, tarball: `packages/${basename(archive)}`, integrity: sha512(archive) }
}

function publicManifest(source: Record<string, unknown>, name: Candidate, version: string): Record<string, unknown> {
  const manifest = structuredClone(source)
  manifest.name = name
  manifest.version = version
  manifest.private = false
  manifest.license = 'Apache-2.0'
  manifest.repository = { type: 'git', url: `git+${publicRepository}` }
  manifest.publishConfig = { access: 'public', provenance: true }
  manifest.files = ['dist', 'lib', 'README.md', 'LICENSE']
  delete manifest.devDependencies
  delete manifest.scripts
  delete manifest.packageManager
  delete manifest.workspaces
  for (const key of ['dependencies', 'optionalDependencies'] as const) {
    if (isRecord(manifest[key])) manifest[key] = rewriteWorkspaceDependencies(manifest[key])
  }
  if (isRecord(manifest.peerDependencies)) {
    manifest.peerDependencies = rewriteWorkspaceDependencies(manifest.peerDependencies, manifest.peerDependenciesMeta)
    if (isRecord(manifest.peerDependenciesMeta)) {
      manifest.peerDependenciesMeta = Object.fromEntries(
        Object.entries(manifest.peerDependenciesMeta).filter(([name]) => name in (manifest.peerDependencies as Record<string, unknown>)),
      )
    }
  }
  return manifest
}

function rewriteWorkspaceDependencies(
  dependencies: Record<string, unknown>,
  peerMeta?: unknown,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(dependencies)) {
    if (typeof value !== 'string' || !value.startsWith('workspace:')) {
      rewritten[name] = value
      continue
    }
    const version = args.versions.get(name as Candidate) ?? publishedVersion(name)
    if (!version && isRecord(peerMeta) && isRecord(peerMeta[name]) && peerMeta[name].optional === true) continue
    assert(version, `cannot resolve a public version for workspace dependency ${name}`)
    const range = value.slice('workspace:'.length)
    rewritten[name] = range === '*' || range === '' ? version : range === '^' || range === '~' ? `${range}${version}` : range
  }
  return rewritten
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

function validateArchive(archive: string, name: Candidate, version: string): void {
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
}

function containsWorkspaceProtocol(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('workspace:')
  if (Array.isArray(value)) return value.some(containsWorkspaceProtocol)
  return isRecord(value) && Object.values(value).some(containsWorkspaceProtocol)
}

function validateReleaseRepository(path: string): void {
  const policy = readJson(join(path, 'release-policy.json')) as Record<string, unknown>
  assert(policy.repository === publicRepository, `release repository must declare ${publicRepository}`)
}

function assertVersionAvailable(name: string, version: string): void {
  assert(!publishedVersion(name, version), `${name}@${version} already exists on npm; choose a new immutable version`)
}

function publishedVersion(name: string, exactVersion?: string): string | undefined {
  try {
    const target = exactVersion ? `${name}@${exactVersion}` : name
    const parsed = JSON.parse(run(['npm', 'view', target, 'version', '--json'], root).trim()) as unknown
    return typeof parsed === 'string' ? parsed : undefined
  } catch {
    return undefined
  }
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

function run(command: string[], cwd: string): string {
  return execFileSync(command[0]!, command.slice(1), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function parseArgs(values: string[]): Args {
  if (values[0] === '--') values = values.slice(1)
  let output: string | undefined
  let releaseId: string | undefined
  const versions = new Map<Candidate, string>()
  let dryRun = false
  let skipRegistryPreflight = false
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--output') { output = values[++index] }
    else if (value === '--release-id') { releaseId = values[++index] }
    else if (value === '--version') {
      const pair = values[++index]
      const separator = pair?.lastIndexOf('=') ?? -1
      const name = separator > 0 ? pair!.slice(0, separator) : ''
      const version = separator > 0 ? pair!.slice(separator + 1) : ''
      assert(candidates.includes(name as Candidate), `unsupported distribution candidate: ${name || '<missing>'}`)
      assert(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), `invalid version: ${version || '<missing>'}`)
      assert(!versions.has(name as Candidate), `duplicate version declaration: ${name}`)
      versions.set(name as Candidate, version)
    } else if (value === '--dry-run') dryRun = true
    else if (value === '--skip-registry-preflight') skipRegistryPreflight = true
    else throw new Error(`unknown option: ${value}`)
  }
  assert(typeof releaseId === 'string' && /^[a-z0-9][a-z0-9._-]*$/i.test(releaseId), 'use --release-id <immutable-release-id>')
  assert(dryRun || typeof output === 'string', 'use --output <oa-sdk-releases repository>')
  assert(!skipRegistryPreflight || dryRun, '--skip-registry-preflight is allowed only with --dry-run')
  return { output: output ? resolve(output) : '', releaseId, versions, dryRun, skipRegistryPreflight }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
