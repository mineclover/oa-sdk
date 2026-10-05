/**
 * Incremental reuse of generated artifacts ("generation targets").
 *
 * A target is identified by command + entry spec + output destination. It is
 * reused only when all of the following still hold for its own record:
 *   - the generator identity (toolchain package versions, record format),
 *   - the normalized generation options,
 *   - the content hash of every recorded input file (entry spec, external
 *     `$ref` documents, TypeSpec sources, package manifests of installed
 *     libraries the TypeSpec compiler loaded), where "absent" is a recorded
 *     state too, so creating a file that used to be missing invalidates the
 *     target,
 *   - the output: a file output must still exist with the recorded hash; a
 *     stdout output is replayed from the stored content.
 * Anything else (no record, unreadable record, unknown generator identity)
 * regenerates.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  GenerationTargetInputRecord,
  GenerationTargetOutputRecord,
  GenerationTargetRecord,
} from '../../generation-target-store.js'
import { readWorkspaceFileStamp, type WorkspaceFileStampCache } from '../../workspace-index.js'
import type { CliIncrementalRun } from './incremental.js'

export type CliGenerationOutput =
  | { kind: 'file'; filePath: string }
  | { kind: 'stdout' }

export type CliGenerationTarget = {
  command: string
  /** Absolute entry spec path. */
  entryPath: string
  /** File outputs carry an absolute path. */
  output: CliGenerationOutput
  /** Options that can change the generated content (JSON-serializable). */
  options: Record<string, unknown>
  /** Generator identity; undefined when it cannot be determined, which disables reuse. */
  generator: Record<string, string> | undefined
}

export type CliGenerationPlan =
  | { action: 'reuse'; record: GenerationTargetRecord }
  | { action: 'generate'; reason: string }

export type CliGenerationResult = {
  /** Generated content exactly as written to the output. */
  content: string
  /**
   * Files the generator read itself (the `$ref` documents it reached or tried
   * to reach), each tracked by its own content wherever it lives. May contain
   * duplicates and absent files.
   */
  inputFiles: readonly string[]
  /**
   * Files the spec loader read: the spec itself, or every file the TypeSpec
   * compiler loaded. One whose real path lies inside an installed package
   * (`node_modules`) is tracked through that package's manifest; any other one
   * by its own content.
   */
  loadedFiles?: readonly string[]
  /** Non-fatal messages emitted while generating, replayed when the target is reused. */
  messages: readonly string[]
}

export function planCliGenerationTarget(run: CliIncrementalRun, target: CliGenerationTarget): CliGenerationPlan {
  if (!run.targets) return generate('incremental state unavailable')
  if (!target.generator) return generate('generator version unavailable')

  const record = run.targets.getGenerationTarget(generationTargetKey(target))
  if (!record) return generate('no previous generation record')
  if (record.generatorHash !== hashJson(target.generator)) return generate('generator version changed')
  if (record.optionsHash !== hashJson(target.options)) return generate('options changed')

  const inputChange = describeInputChanges(record.inputs, run.stamps)
  if (inputChange) return generate(inputChange)

  const outputProblem = describeOutputProblem(record.output)
  if (outputProblem) return generate(outputProblem)

  return { action: 'reuse', record }
}

/**
 * Persist the target after a successful generation. Input hashes come from the
 * run's stamp memo: files already known from the previous record or index were
 * stamped before generation read them, so a change made while the run was
 * generating is seen by the next run; files first discovered by this run are
 * stamped when the target is recorded.
 */
export function recordCliGenerationTarget(
  run: CliIncrementalRun,
  target: CliGenerationTarget,
  result: CliGenerationResult,
): void {
  if (!run.targets || !target.generator) return

  const contentHash = sha256(result.content)
  const output: GenerationTargetOutputRecord = target.output.kind === 'file'
    ? { kind: 'file', filePath: target.output.filePath, contentHash }
    : { kind: 'stdout', contentHash, content: result.content }

  run.targets.replaceGenerationTarget({
    targetKey: generationTargetKey(target),
    command: target.command,
    optionsHash: hashJson(target.options),
    generatorHash: hashJson(target.generator),
    inputs: trackedInputPaths(target.entryPath, result.inputFiles, result.loadedFiles).map(filePath => ({
      filePath,
      contentHash: readWorkspaceFileStamp(filePath, run.stamps)?.contentHash ?? null,
    })),
    output,
    messages: [...result.messages],
    lastRun: run.runId,
  })
}

/** One status line on stderr so incremental decisions are observable without polluting stdout output. */
export function reportCliGenerationPlan(target: CliGenerationTarget, plan: CliGenerationPlan): void {
  if (plan.action === 'reuse') {
    console.warn(`incremental: ${target.command} up to date, regeneration skipped (${describeOutput(target.output)})`)
  } else {
    console.warn(`incremental: ${target.command} regenerating (${plan.reason})`)
  }
}

export function generationTargetKey(target: Pick<CliGenerationTarget, 'command' | 'entryPath' | 'output'>): string {
  return hashJson({
    command: target.command,
    entry: target.entryPath,
    output: target.output.kind === 'file' ? { file: target.output.filePath } : 'stdout',
  })
}

/**
 * Map the files read during generation to the paths whose content is tracked.
 * The entry spec and every file the generator read itself (`$ref` documents)
 * are tracked by their own content, wherever they live. A file the spec loader
 * loaded from an installed package, decided on its real path so a workspace
 * package linked into `node_modules` stays content-tracked, is tracked through
 * that package's manifest: the library version is the input rather than every
 * file it ships.
 */
export function trackedInputPaths(
  entryPath: string,
  inputFiles: readonly string[],
  loadedFiles: readonly string[] = [],
): string[] {
  const entry = resolve(entryPath)
  const tracked = new Set<string>([entry])
  for (const filePath of inputFiles) tracked.add(resolve(filePath))
  for (const filePath of loadedFiles) {
    const absolutePath = resolve(filePath)
    if (absolutePath === entry) continue
    tracked.add(installedPackageManifestPath(realPath(absolutePath)) ?? absolutePath)
  }
  return [...tracked].sort((a, b) => a.localeCompare(b))
}

/**
 * Generator identity for a CLI command: the record format plus the installed
 * versions of the packages on its generation path, resolved the way Node
 * resolves them from this package. Undefined when any of them is missing.
 */
export function resolveCliGeneratorIdentity(
  format: string,
  packageNames: readonly string[],
): Record<string, string> | undefined {
  const identity: Record<string, string> = { format }
  for (const packageName of packageNames) {
    const version = resolveInstalledPackageVersion(packageName)
    if (version === undefined) return undefined
    identity[packageName] = version
  }
  return identity
}

function describeInputChanges(
  inputs: readonly GenerationTargetInputRecord[],
  stamps: WorkspaceFileStampCache,
): string | undefined {
  const changes: string[] = []
  for (const input of inputs) {
    const currentHash = readWorkspaceFileStamp(input.filePath, stamps)?.contentHash ?? null
    if (currentHash === input.contentHash) continue
    if (input.contentHash === null) changes.push(`input added: ${input.filePath}`)
    else if (currentHash === null) changes.push(`input removed: ${input.filePath}`)
    else changes.push(`input changed: ${input.filePath}`)
  }
  if (changes.length === 0) return undefined
  return changes.length === 1 ? changes[0] : `${changes[0]} (+${changes.length - 1} more)`
}

function describeOutputProblem(output: GenerationTargetOutputRecord): string | undefined {
  if (output.kind === 'stdout') {
    return sha256(output.content) === output.contentHash ? undefined : 'stored stdout output is inconsistent'
  }
  const stamp = readWorkspaceFileStamp(output.filePath)
  if (!stamp) return `output missing: ${output.filePath}`
  if (stamp.contentHash !== output.contentHash) return `output modified: ${output.filePath}`
  return undefined
}

function describeOutput(output: CliGenerationOutput): string {
  return output.kind === 'file' ? output.filePath : 'stdout'
}

function generate(reason: string): CliGenerationPlan {
  return { action: 'generate', reason }
}

function realPath(filePath: string): string {
  try {
    return realpathSync.native(filePath)
  } catch {
    return filePath
  }
}

function installedPackageManifestPath(filePath: string): string | undefined {
  const segments = filePath.split(sep)
  const nodeModulesIndex = segments.lastIndexOf('node_modules')
  if (nodeModulesIndex < 0) return undefined
  const nameLength = segments[nodeModulesIndex + 1]?.startsWith('@') ? 2 : 1
  const packageRootEnd = nodeModulesIndex + 1 + nameLength
  // A file directly inside node_modules (or @scope/) is not part of a package.
  if (packageRootEnd >= segments.length) return undefined
  return join(segments.slice(0, packageRootEnd).join(sep) || sep, 'package.json')
}

const OWN_PACKAGE_NAME = '@oa-sdk/codegen'
const packageVersionCache = new Map<string, string | undefined>()

function resolveInstalledPackageVersion(packageName: string): string | undefined {
  if (!packageVersionCache.has(packageName)) {
    packageVersionCache.set(packageName, lookupInstalledPackageVersion(packageName))
  }
  return packageVersionCache.get(packageName)
}

function lookupInstalledPackageVersion(packageName: string): string | undefined {
  const ownRoot = findOwnPackageRoot()
  if (!ownRoot) return undefined
  if (packageName === OWN_PACKAGE_NAME) return readPackageVersion(join(ownRoot, 'package.json'), packageName)

  // Node's bare-specifier lookup: <ancestor>/node_modules/<name> from this package upwards.
  for (let directory = ownRoot; ; directory = dirname(directory)) {
    const version = readPackageVersion(join(directory, 'node_modules', packageName, 'package.json'), packageName)
    if (version !== undefined) return version
    if (dirname(directory) === directory) return undefined
  }
}

function findOwnPackageRoot(): string | undefined {
  for (let directory = dirname(fileURLToPath(import.meta.url)); ; directory = dirname(directory)) {
    if (readPackageVersion(join(directory, 'package.json'), OWN_PACKAGE_NAME) !== undefined) return directory
    if (dirname(directory) === directory) return undefined
  }
}

function readPackageVersion(manifestPath: string, packageName: string): string | undefined {
  if (!existsSync(manifestPath)) return undefined
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; version?: unknown }
    return manifest.name === packageName && typeof manifest.version === 'string' ? manifest.version : undefined
  } catch {
    return undefined
  }
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(sortJson(value)))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) sorted[key] = sortJson((value as Record<string, unknown>)[key])
    return sorted
  }
  return value
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
