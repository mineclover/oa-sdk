/**
 * Incremental reuse of generated artifacts ("generation targets").
 *
 * A target is identified by command + entry spec + output destination. It is
 * reused only when all of the following still hold for its own record:
 *   - the generator identity (toolchain package versions, record format),
 *   - the normalized generation options,
 *   - every recorded input observation (see `GenerationTargetInputRecord`):
 *       - the content of each file generation read: the entry spec, external
 *         `$ref` documents, and every file the TypeSpec compiler read (sources,
 *         `package.json` manifests, library configs), where "absent" is a
 *         recorded state too, so creating a file that used to be missing
 *         invalidates the target;
 *       - what each path the TypeSpec compiler probed while resolving imports
 *         named (file, directory, absent), and where each path it resolved
 *         links to, so a re-pointed `node_modules` link or a new candidate
 *         directory invalidates the target;
 *       - the JavaScript module graph of decorator and library entries
 *         (see `module-graph-observer.ts`),
 *   - the output: a file output must still exist with the recorded hash; a
 *     stdout output is replayed from the stored content.
 * Anything else (no record, unreadable record, unknown generator identity, an
 * input the previous run could not verify) regenerates.
 *
 * Recorded observations must describe what generation consumed. A reader that
 * reports what it observed (the compiler host, the module loader, the spec
 * loader's text) is checked against the file as stamped. A file stamped before
 * generation started is used as is (a change made later is seen by the next
 * run). Any other file needs evidence that it did not change in between, see
 * `contentInputRecord`.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  GenerationTargetInputRecord,
  GenerationTargetOutputRecord,
  GenerationTargetRecord,
} from '../../generation-target-store.js'
import {
  readWorkspaceFileStamp,
  type WorkspaceFileStamp,
  type WorkspaceFileStampCache,
} from '../../workspace-index.js'
import type { CliIncrementalRun } from './incremental.js'
import { observeEntry, observeRealpath, type ConsumedContent, type InputObservation } from './input-observations.js'

/**
 * How much older than the start of generation a file's mtime must be to prove
 * the file was not written while generation ran. Coarse filesystem timestamps
 * (FAT: 2 s, HFS+: 1 s) and coarse kernel clocks can give a write made after
 * the start an earlier mtime.
 */
const FILE_TIMESTAMP_SLACK_MS = 2_000

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
   * to reach), tracked by content. May contain duplicates and absent files.
   */
  inputFiles: readonly string[]
  /** Observations the spec loader reported (see `InputObservation`); may repeat. */
  observations?: readonly InputObservation[]
  /** Non-fatal messages emitted while generating, replayed when the target is reused. */
  messages: readonly string[]
}

/** A target whose generation has started; created by `beginCliGeneration`. */
export type CliTargetGeneration = {
  target: CliGenerationTarget
  /** Wall-clock time taken before generation read any input. */
  startedAtMs: number
  /** Files stamped before generation started: their stamps predate every read generation made. */
  stampedBefore: ReadonlySet<string>
}

export function planCliGenerationTarget(run: CliIncrementalRun, target: CliGenerationTarget): CliGenerationPlan {
  if (!run.targets) return generate('incremental state unavailable')
  if (!target.generator) return generate('generator version unavailable')

  const record = run.targets.getGenerationTarget(generationTargetKey(target))
  if (!record) return generate('no previous generation record')

  // Check every recorded input now, before generation can read it, even when a
  // check below already decides to regenerate: the new record reuses the stamps.
  const inputChange = describeInputChanges(record.inputs, run.stamps)
  if (record.generatorHash !== hashJson(target.generator)) return generate('generator version changed')
  if (record.optionsHash !== hashJson(target.options)) return generate('options changed')
  if (inputChange) return generate(inputChange)

  const outputProblem = describeOutputProblem(record.output)
  if (outputProblem) return generate(outputProblem)

  return { action: 'reuse', record }
}

/**
 * Mark the start of generation, after every stamp the run takes up front
 * (planning, index invalidation) and before generation reads any input.
 */
export function beginCliGeneration(run: CliIncrementalRun, target: CliGenerationTarget): CliTargetGeneration {
  return { target, startedAtMs: Date.now(), stampedBefore: new Set(run.stamps.keys()) }
}

/** Persist the target after a successful generation. */
export function recordCliGenerationTarget(
  run: CliIncrementalRun,
  generation: CliTargetGeneration,
  result: CliGenerationResult,
): void {
  const { target } = generation
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
    inputs: consumedInputRecords([
      { kind: 'content', path: resolve(target.entryPath) },
      ...result.inputFiles.map(filePath => ({ kind: 'content', path: resolve(filePath) }) as const),
      ...(result.observations ?? []),
    ], run.stamps, generation),
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

/**
 * One record per observed (kind, path), as generation consumed it. Repeated
 * observations of a path must agree (reports with evidence take precedence
 * over plain file paths); observations that disagree mean the path changed
 * while generation ran, so it is recorded unverified.
 */
function consumedInputRecords(
  observations: readonly InputObservation[],
  stamps: WorkspaceFileStampCache,
  generation: CliTargetGeneration,
): GenerationTargetInputRecord[] {
  const groups = new Map<string, InputObservation[]>()
  for (const observation of observations) {
    const key = `${observation.kind}\0${observation.path}`
    const group = groups.get(key)
    if (group) group.push(observation)
    else groups.set(key, [observation])
  }

  const records: GenerationTargetInputRecord[] = []
  for (const group of groups.values()) {
    const { kind, path } = group[0]!
    const unverified = group.find(observation => 'unverified' in observation)
    if (unverified && 'unverified' in unverified) {
      records.push({ kind, path, unverified: unverified.unverified })
      continue
    }
    const evidenced = group.filter(observation => observation.kind !== 'content' || 'consumed' in observation)
    const candidates = (evidenced.length > 0 ? evidenced : group.slice(0, 1))
      .map(observation => consumedInputRecord(observation, stamps, generation))
    const [first] = candidates
    records.push(candidates.every(record => sameInputRecord(record, first!))
      ? first!
      : { kind, path, unverified: 'changed during generation' })
  }
  // By path, then kind: the order the store returns them in.
  return records.sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.kind, b.kind))
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function consumedInputRecord(
  observation: InputObservation,
  stamps: WorkspaceFileStampCache,
  generation: CliTargetGeneration,
): GenerationTargetInputRecord {
  if ('unverified' in observation) return observation
  if (observation.kind === 'content') return contentInputRecord(observation.path, observation.consumed, stamps, generation)
  // The reader reported the value it observed.
  return { kind: observation.kind, path: observation.path, value: observation.value }
}

/**
 * The content generation consumed from `filePath`:
 *   - the reader reported it: the absence it saw, or text / bytes the stamp
 *     must match (otherwise the file changed after it was read);
 *   - the file was stamped before generation started: that stamp;
 *   - otherwise, evidence that nothing changed while generation ran: an
 *     existing file's mtime, or for an absent file the mtime of its nearest
 *     existing directory (creating or removing an entry updates it), precedes
 *     the start of generation by more than the timestamp slack (a tool that
 *     restores an older mtime during the run defeats this check, which is why
 *     reported content takes precedence).
 * Without evidence the input is recorded unverified, and the next run, which
 * stamps it before generating, regenerates.
 */
function contentInputRecord(
  filePath: string,
  consumed: ConsumedContent | undefined,
  stamps: WorkspaceFileStampCache,
  generation: CliTargetGeneration,
): GenerationTargetInputRecord {
  const record = (value: string | null): GenerationTargetInputRecord => ({ kind: 'content', path: filePath, value })
  const unverified = (reason: string): GenerationTargetInputRecord => ({ kind: 'content', path: filePath, unverified: reason })

  if (consumed && 'absent' in consumed) return record(null)
  const stamp = readWorkspaceFileStamp(filePath, stamps)
  if (consumed) {
    const matches = stamp !== undefined
      && ('text' in consumed ? stampMatchesText(stamp, consumed.text) : stamp.contentHash === consumed.sha256)
    return matches ? record(stamp.contentHash) : unverified('changed during generation')
  }
  if (generation.stampedBefore.has(filePath)) return record(stamp?.contentHash ?? null)

  const unchangedBefore = generation.startedAtMs - FILE_TIMESTAMP_SLACK_MS
  if (stamp) return stamp.mtimeMs < unchangedBefore ? record(stamp.contentHash) : unverified('may have changed during generation')
  return nearestDirectoryMtimeMs(filePath) < unchangedBefore ? record(null) : unverified('may have changed during generation')
}

/** mtime of the nearest existing directory containing `filePath`; +Infinity when it cannot be determined. */
function nearestDirectoryMtimeMs(filePath: string): number {
  for (let directory = dirname(filePath); ; directory = dirname(directory)) {
    try {
      const stats = statSync(directory, { throwIfNoEntry: false })
      if (stats) return stats.isDirectory() ? stats.mtimeMs : Number.POSITIVE_INFINITY
    } catch {
      return Number.POSITIVE_INFINITY
    }
    if (dirname(directory) === directory) return Number.POSITIVE_INFINITY
  }
}

/** Whether the stamped bytes are `text` encoded as UTF-8, with or without the byte order mark a reader drops. */
function stampMatchesText(stamp: WorkspaceFileStamp, text: string): boolean {
  return sha256(text) === stamp.contentHash || sha256(`\uFEFF${text}`) === stamp.contentHash
}

function sameInputRecord(a: GenerationTargetInputRecord, b: GenerationTargetInputRecord): boolean {
  if ('unverified' in a || 'unverified' in b) return 'unverified' in a && 'unverified' in b
  return a.value === b.value
}

/** The current value of a recorded observation; content is stamped through the run's memo. */
function currentInputValue(
  input: GenerationTargetInputRecord,
  stamps: WorkspaceFileStampCache,
): string | null | undefined {
  switch (input.kind) {
    case 'content': return readWorkspaceFileStamp(input.path, stamps)?.contentHash ?? null
    case 'entry': return observeEntry(input.path)
    case 'realpath': return observeRealpath(input.path)
  }
}

function describeInputChanges(
  inputs: readonly GenerationTargetInputRecord[],
  stamps: WorkspaceFileStampCache,
): string | undefined {
  const changes: string[] = []
  for (const input of inputs) {
    const current = currentInputValue(input, stamps)
    if ('unverified' in input) changes.push(`input not verified: ${input.path} (${input.unverified})`)
    else if (current === input.value) continue
    else changes.push(describeInputChange(input.kind, input.path, input.value, current))
  }
  if (changes.length === 0) return undefined
  return changes.length === 1 ? changes[0] : `${changes[0]} (+${changes.length - 1} more)`
}

function describeInputChange(
  kind: GenerationTargetInputRecord['kind'],
  path: string,
  recorded: string | null,
  current: string | null | undefined,
): string {
  switch (kind) {
    case 'content':
      if (recorded === null) return `input added: ${path}`
      if (current === null) return `input removed: ${path}`
      return `input changed: ${path}`
    case 'entry':
      return `input entry changed: ${path} (${recorded} -> ${current})`
    case 'realpath':
      return `input link target changed: ${path}`
  }
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
