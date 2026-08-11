/** Produce an artifact-only release for the public oa-sdk-releases repository. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readArtifactReleasePolicy } from './check-release-policy.js'

const root = resolve(import.meta.dirname, '..')
const sourcePolicyPath = join(root, 'docs/internal/release-policy.json')
const packageBases = ['packages', 'apps'] as const

type Candidate = string
export type ReleasePackage = { name: Candidate; version: string; tarball: string; integrity: string }
type Args = { output: string; releaseId: string; versions: Map<Candidate, string>; dryRun: boolean; skipRegistryPreflight: boolean }
type ExportContext = {
  args: Args
  packageDirectories: Map<Candidate, string>
  publicRepository: string
  releaseDirectory: string
  temporaryDirectory: string
}

export type ReleaseExportConfiguration = {
  candidates: string[]
  repository: string
}

export function readReleaseExportConfiguration(
  filePath = sourcePolicyPath,
): ReleaseExportConfiguration {
  const policy = readArtifactReleasePolicy(filePath)
  return {
    candidates: [...policy.distributionCandidates],
    repository: policy.publish.repository,
  }
}

function main(): void {
  const configuration = readReleaseExportConfiguration()
  const args = parseArgs(process.argv.slice(2), configuration.candidates)
  const sourceRevision = run(['git', 'rev-parse', 'HEAD'], root).trim()
  const outputRoot = args.dryRun ? mkdtempSync(join(tmpdir(), 'oa-sdk-release-export-')) : args.output
  const releaseDirectory = join(outputRoot, 'releases', args.releaseId)
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'oa-sdk-release-pack-'))
  const context: ExportContext = {
    args,
    packageDirectories: readCandidateDirectories(configuration.candidates),
    publicRepository: configuration.repository,
    releaseDirectory,
    temporaryDirectory,
  }

  try {
    assert(existsSync(join(root, 'LICENSE')), 'root LICENSE is required for public release artifacts')
    if (!args.dryRun) {
      assert(run(['git', 'status', '--porcelain'], root).trim() === '', 'official release export requires a clean, committed private source worktree')
    }
    assert(!existsSync(releaseDirectory), `release directory already exists: ${relative(outputRoot, releaseDirectory)}`)
    if (!args.dryRun) validateReleaseRepository(outputRoot, configuration.repository)
    mkdirSync(join(releaseDirectory, 'packages'), { recursive: true })

    const packages: ReleasePackage[] = []
    for (const name of configuration.candidates) {
      const version = args.versions.get(name)
      if (!version) continue
      if (!args.skipRegistryPreflight) assertVersionAvailable(name, version)
      packages.push(exportPackage(name, version, context))
    }
    assert(packages.length > 0, 'at least one --version <package>=<version> is required')
    validateSanitizedReleaseConsumption(packages, releaseDirectory)
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
}

function exportPackage(name: Candidate, version: string, context: ExportContext): ReleasePackage {
  const sourceDirectory = context.packageDirectories.get(name)
  assert(sourceDirectory, `distribution candidate does not resolve to a workspace: ${name}`)
  const sourceManifest = readJson(join(sourceDirectory, 'package.json')) as Record<string, unknown>
  const packDirectory = join(context.temporaryDirectory, safeName(name))
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
  writeJson(join(stagedDirectory, 'package.json'), publicManifest(sourceManifest, name, version, context))
  ensureReadme(stagedDirectory, name, version)
  copyFileSync(join(root, 'LICENSE'), join(stagedDirectory, 'LICENSE'))

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
  const resolvePublicVersion = (dependencyName: string): string | undefined =>
    context.args.versions.get(dependencyName) ?? publishedVersion(dependencyName)
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    if (isRecord(manifest[key])) {
      manifest[key] = rewriteWorkspaceDependencies(manifest[key], resolvePublicVersion)
    }
  }
  return manifest
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

export function validateSanitizedReleaseConsumption(
  packages: readonly ReleasePackage[],
  releaseDirectory: string,
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

    writeJson(join(consumerDirectory, 'package.json'), {
      name: 'oa-sdk-sanitized-release-consumer-smoke',
      private: true,
      type: 'module',
    })
    runIsolatedNpm([
      'install',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--omit=optional',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      ...archives,
    ], consumerDirectory)

    const importSmokePath = join(consumerDirectory, 'import-smoke.mjs')
    writeFileSync(
      importSmokePath,
      `const specifiers = ${JSON.stringify(specifiers)}\n` +
        'for (const specifier of specifiers) await import(specifier)\n',
      'utf8',
    )
    run([process.execPath, importSmokePath], consumerDirectory)

    const generatedTypesPath = join(consumerDirectory, 'generated-types.ts')
    const codegen = manifests.find(({ entry }) => entry.name === '@oa-sdk/codegen')
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

function validateReleaseRepository(path: string, publicRepository: string): void {
  const policy = readJson(join(path, 'release-policy.json')) as Record<string, unknown>
  assert(policy.repository === publicRepository, `release repository must declare ${publicRepository}`)
}

function readCandidateDirectories(candidates: readonly string[]): Map<string, string> {
  const candidateSet = new Set(candidates)
  const directories = new Map<string, string>()

  for (const base of packageBases) {
    const baseDirectory = join(root, base)
    if (!existsSync(baseDirectory)) continue
    for (const entry of readdirSync(baseDirectory).sort()) {
      const directory = join(baseDirectory, entry)
      const manifestPath = join(directory, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = readJson(manifestPath)
      if (!isRecord(manifest) || typeof manifest.name !== 'string') continue
      if (!candidateSet.has(manifest.name)) continue
      assert(!directories.has(manifest.name), `duplicate distribution candidate workspace: ${manifest.name}`)
      directories.set(manifest.name, directory)
    }
  }

  for (const candidate of candidates) {
    assert(directories.has(candidate), `distribution candidate does not resolve to a workspace: ${candidate}`)
  }
  return directories
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
