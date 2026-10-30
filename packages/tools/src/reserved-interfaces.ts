/**
 * @oa-sdk/tools — CLI-Anything Design Principles Applied to MCP:
 * Base Contract (`mcp-use > CLI` Pre-Reservation) & 5 Reserved Interfaces (R1~R5)
 *
 * R1: File-Locked Deterministic Session & Undo/Redo (`session_*`, `session://`)
 * R2: 2-Phase Safe Mutation (`plan -> commit`, `--dry-run`, `ctx.elicit()`)
 * R3: Preview Bundle Protocol (`preview-bundle/v1`, `_meta.previewBundle`, `preview://`)
 * R4: 2-Stage Handoff Envelope (`cli-anything-handoff-envelope/v1`, `handoff_*`, `handoff://`)
 * R5: Self-Describing Skill Contract (SEP-2640 `SkillsSnapshot` & Spec-to-Markdown Generator)
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ToolContext } from './types.js'

// ── Base Contract Pre-Reserved in `mcp-use > CLI` Direction ─────────────────

export interface PreviewArtifactEntry {
  readonly name: string
  readonly kind: 'image' | 'json' | 'markdown' | 'html' | 'text'
  readonly mimeType: string
  readonly content: string
  readonly title?: string | undefined
}

export interface PreviewBundleV1 {
  readonly schemaVersion: 'preview-bundle/v1'
  readonly bundleId: string
  readonly software: string
  readonly recipe: string
  readonly createdAt: string
  readonly summary: {
    readonly title: string
    readonly status: 'ready' | 'dry-run' | 'warning' | 'error'
    readonly highlights: string[]
    readonly metrics?: Record<string, number | string | boolean> | undefined
  }
  readonly artifacts: PreviewArtifactEntry[]
}

export interface HandoffEnvelopeV1 {
  readonly schemaVersion: 'cli-anything-handoff-envelope/v1'
  readonly handoffId: string
  readonly createdAt: string
  readonly sourceStage: 'stage-1-cli' | 'stage-2-mcp'
  readonly targetStage: 'stage-1-cli' | 'stage-2-mcp'
  readonly operationId: string
  readonly projectId: string
  readonly projectPath: string
  readonly fingerprint: string
  readonly status: 'completed' | 'dry-run-planned' | 'needs-agent-judgment' | 'failed-gate'
  readonly summary: string
  readonly sessionStatePath?: string | undefined
  readonly previewBundleId?: string | undefined
  readonly previewBundlePath?: string | undefined
  readonly suggestedNextTools: string[]
  readonly payload: Record<string, unknown>
}

/**
 * Superset Output Envelope (`mcp-use > CLI` direction):
 * - `mcp-use` binds `data` -> `structuredContent`, `summary` -> `content[0].text`,
 *   `previewBundle` & `handoffEnvelope` -> `_meta`.
 * - `CLI-Anything` down-projects `data` -> `--json` stdout, `summary` -> human terminal output,
 *   `previewBundle` -> `.cli-anything/previews/`, `passed === false` -> `exitCode = 1`.
 */
export interface CommandOutcome<TData = unknown> {
  readonly data: TData
  readonly summary?: string | undefined
  readonly passed?: boolean | undefined
  readonly previewBundle?: PreviewBundleV1 | undefined
  readonly handoffEnvelope?: HandoffEnvelopeV1 | undefined
  readonly meta?: Record<string, unknown> | undefined
}

export function isCommandOutcome<TData = unknown>(value: unknown): value is CommandOutcome<TData> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    !Array.isArray(value)
  )
}

export function normalizeCommandOutcome<TData = unknown>(
  raw: TData | CommandOutcome<TData>,
  defaultSummary?: string,
): CommandOutcome<TData> {
  if (isCommandOutcome<TData>(raw)) {
    return {
      data: raw.data,
      summary: raw.summary ?? defaultSummary ?? summarizeData(raw.data),
      ...(raw.passed !== undefined ? { passed: raw.passed } : {}),
      ...(raw.previewBundle !== undefined ? { previewBundle: raw.previewBundle } : {}),
      ...(raw.handoffEnvelope !== undefined ? { handoffEnvelope: raw.handoffEnvelope } : {}),
      ...(raw.meta !== undefined ? { meta: raw.meta } : {}),
    }
  }
  return {
    data: raw,
    summary: defaultSummary ?? summarizeData(raw),
  }
}

function summarizeData(data: unknown): string {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const rec = data as Record<string, unknown>
    if (typeof rec.summary === 'string') return rec.summary
    if (typeof rec.message === 'string') return rec.message
  }
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

export function computeCanonicalSha256(value: unknown): string {
  const canonical = canonicalJsonStringify(value)
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex')
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJsonStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`).join(',')}}`
}

// ── R2: 2-Phase Handler Contract (`plan -> commit` + `dryRun` + `ctx.elicit()`) ──

export interface ElicitationContext extends ToolContext {
  elicit?: (
    key: string,
    message: string,
    schema?: Record<string, unknown>,
  ) => Promise<{ action: 'accept' | 'decline' | 'cancel'; data?: Record<string, unknown> }>
}

export interface TwoPhaseMutationHandler<TInput = any, TPlan = any, TOutput = any> {
  /**
   * Phase A (Pure / Idempotent): Computes validation & mutation plan with zero disk writes.
   * Safe for CLI `--dry-run` and `mcp-use` `ctx.elicit()` re-executions.
   */
  plan(ctx: ElicitationContext, input: TInput): Promise<TPlan>
  /**
   * Phase B (Atomic Commit): Acquires exclusive file lock and commits the mutation once.
   */
  commit(
    ctx: ElicitationContext,
    input: TInput,
    plan: TPlan,
  ): Promise<TOutput | CommandOutcome<TOutput>>
  /**
   * Optional state snapshot reader/writer for Undo/Redo history.
   */
  captureState?(ctx: ElicitationContext, input: TInput): Promise<Record<string, unknown>>
  restoreState?(
    ctx: ElicitationContext,
    projectId: string,
    state: Record<string, unknown>,
  ): Promise<void>
}

export type SinglePhaseToolHandler<TInput = any, TOutput = any> = (
  ctx: ElicitationContext,
  input: TInput,
) => Promise<TOutput | CommandOutcome<TOutput>>

export type AnyPipelineToolHandler<TInput = any, TPlan = any, TOutput = any> =
  | SinglePhaseToolHandler<TInput, TOutput>
  | TwoPhaseMutationHandler<TInput, TPlan, TOutput>

export function isTwoPhaseMutationHandler(
  handler: unknown,
): handler is TwoPhaseMutationHandler<any, any, any> {
  return (
    typeof handler === 'object' &&
    handler !== null &&
    typeof (handler as TwoPhaseMutationHandler).plan === 'function' &&
    typeof (handler as TwoPhaseMutationHandler).commit === 'function'
  )
}

// ── R1: File-Backed Deterministic Session Store (`_locked_save_json` + Undo/Redo) ──

export interface SessionSnapshotEntry {
  readonly snapshotId: string
  readonly timestamp: string
  readonly operationId: string
  readonly summary: string
  readonly beforeState: Record<string, unknown>
  readonly afterState: Record<string, unknown>
  readonly fingerprint: string
}

export interface ProjectSessionRecord {
  readonly schemaVersion: 'cli-anything-session/v1'
  readonly projectId: string
  readonly updatedAt: string
  readonly currentState: Record<string, unknown>
  readonly undoStack: SessionSnapshotEntry[]
  readonly redoStack: SessionSnapshotEntry[]
}

export interface SessionMutationInput {
  operationId: string
  summary: string
  beforeState?: Record<string, unknown>
  afterState: Record<string, unknown>
}

/**
 * Callback used by the MCP/CLI session surfaces to restore the real domain
 * state before the session history is moved.  Keeping this callback outside
 * the file store lets the store remain deterministic while making a reported
 * undo/redo mean that the domain was actually restored.
 */
export type SessionStateRestorer = (
  snapshot: SessionSnapshotEntry,
  targetState: Record<string, unknown>,
  direction: 'undo' | 'redo',
) => Promise<void>

export class FileSessionStore {
  readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir)
  }

  private sessionDir(projectId: string): string {
    this.validateProjectId(projectId)
    // Hash exact JavaScript code units; UTF-8 replacement of lone surrogates
    // would otherwise map distinct input strings to the same key.
    const key = createHash('sha256').update(projectId, 'utf16le').digest('hex')
    return path.join(this.baseDir, '.cli-anything', 'sessions', `project-${key}`)
  }

  private validateProjectId(projectId: string): void {
    if (typeof projectId !== 'string' || !projectId.trim() || projectId === '.' || projectId === '..') {
      throw new Error('Invalid project ID: expected a non-empty ID other than a dot segment')
    }
  }

  private sessionFile(projectId: string): string {
    return path.join(this.sessionDir(projectId), 'session.json')
  }

  private lockFile(projectId: string): string {
    return path.join(this.sessionDir(projectId), 'session.lock')
  }

  /**
   * Equivalent to `CLI-Anything`'s `_locked_save_json`: executes `fn` under an
   * atomic `O_CREAT | O_EXCL` lockfile to prevent concurrent CLI/MCP corruption.
   */
  async withProjectLock<T>(projectId: string, fn: () => Promise<T>, timeoutMs = 5000): Promise<T> {
    const dir = this.sessionDir(projectId)
    fs.mkdirSync(dir, { recursive: true })
    const lockPath = this.lockFile(projectId)
    const started = Date.now()
    let fd: number | undefined

    while (fd === undefined) {
      try {
        fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY)
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }))
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') throw err
        if (Date.now() - started > timeoutMs) {
          throw new Error(`Timed out waiting for session lock on project "${projectId}" (${lockPath})`)
        }
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }

    try {
      return await fn()
    } finally {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore close error
      }
      try {
        fs.unlinkSync(lockPath)
      } catch {
        // ignore unlink error
      }
    }
  }

  readSession(projectId: string): ProjectSessionRecord {
    let file = this.sessionFile(projectId)
    // Read existing sessions only when their embedded identity matches. New
    // writes always use the hashed key; the next mutation migrates the record.
    if (!fs.existsSync(file)) {
      const legacyId = projectId.replace(/[^a-zA-Z0-9._-]/g, '_')
      const legacyFile = path.join(this.baseDir, '.cli-anything', 'sessions', legacyId, 'session.json')
      if (fs.existsSync(legacyFile)) file = legacyFile
    }
    if (!fs.existsSync(file)) {
      return {
        schemaVersion: 'cli-anything-session/v1',
        projectId,
        updatedAt: new Date().toISOString(),
        currentState: {},
        undoStack: [],
        redoStack: [],
      }
    }
    const record = JSON.parse(fs.readFileSync(file, 'utf8')) as ProjectSessionRecord
    if (record?.projectId !== projectId) {
      throw new Error(`Session project ID mismatch for "${projectId}" (${file})`)
    }
    return record
  }

  private writeSessionAtomic(projectId: string, record: ProjectSessionRecord): void {
    const dir = this.sessionDir(projectId)
    fs.mkdirSync(dir, { recursive: true })
    const file = this.sessionFile(projectId)
    const tmpFile = `${file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmpFile, JSON.stringify(record, null, 2) + '\n', 'utf8')
    fs.renameSync(tmpFile, file)
  }

  async recordMutation(
    projectId: string,
    params: SessionMutationInput,
  ): Promise<ProjectSessionRecord> {
    return this.withProjectLock(projectId, async () => this.recordMutationLocked(projectId, params))
  }

  /** Commit domain state and append its snapshot under one lock acquisition. */
  async commitMutation<T>(
    projectId: string,
    commit: () => Promise<{ result: T; mutation: SessionMutationInput }>,
  ): Promise<T> {
    return this.withProjectLock(projectId, async () => {
      // Reject an incompatible persisted session before the domain is mutated.
      this.readSession(projectId)
      const { result, mutation } = await commit()
      this.recordMutationLocked(projectId, mutation)
      return result
    })
  }

  private recordMutationLocked(projectId: string, params: SessionMutationInput): ProjectSessionRecord {
    const current = this.readSession(projectId)
    const beforeState = params.beforeState ?? current.currentState
    const entry: SessionSnapshotEntry = {
      snapshotId: `snap_${randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      operationId: params.operationId,
      summary: params.summary,
      beforeState,
      afterState: params.afterState,
      fingerprint: computeCanonicalSha256(params.afterState),
    }
    const next: ProjectSessionRecord = {
      schemaVersion: 'cli-anything-session/v1',
      projectId,
      updatedAt: entry.timestamp,
      currentState: params.afterState,
      undoStack: [...current.undoStack.slice(-49), entry],
      redoStack: [],
    }
    this.writeSessionAtomic(projectId, next)
    return next
  }

  async undo(projectId: string, restoreState?: SessionStateRestorer): Promise<{
    undone: boolean
    restoredSnapshot?: SessionSnapshotEntry | undefined
    session: ProjectSessionRecord
  }> {
    return this.withProjectLock(projectId, async () => {
      const current = this.readSession(projectId)
      if (current.undoStack.length === 0) {
        return { undone: false, session: current }
      }
      const popped = current.undoStack[current.undoStack.length - 1]!
      // Restore the domain first.  If this rejects, the history file is left
      // untouched so callers can retry or inspect the failed snapshot.
      if (restoreState) await restoreState(popped, popped.beforeState, 'undo')
      const next: ProjectSessionRecord = {
        schemaVersion: 'cli-anything-session/v1',
        projectId,
        updatedAt: new Date().toISOString(),
        currentState: popped.beforeState,
        undoStack: current.undoStack.slice(0, -1),
        redoStack: [...current.redoStack, popped],
      }
      this.writeSessionAtomic(projectId, next)
      return { undone: true, restoredSnapshot: popped, session: next }
    })
  }

  async redo(projectId: string, restoreState?: SessionStateRestorer): Promise<{
    redone: boolean
    reappliedSnapshot?: SessionSnapshotEntry | undefined
    session: ProjectSessionRecord
  }> {
    return this.withProjectLock(projectId, async () => {
      const current = this.readSession(projectId)
      if (current.redoStack.length === 0) {
        return { redone: false, session: current }
      }
      const popped = current.redoStack[current.redoStack.length - 1]!
      if (restoreState) await restoreState(popped, popped.afterState, 'redo')
      const next: ProjectSessionRecord = {
        schemaVersion: 'cli-anything-session/v1',
        projectId,
        updatedAt: new Date().toISOString(),
        currentState: popped.afterState,
        undoStack: [...current.undoStack, popped],
        redoStack: current.redoStack.slice(0, -1),
      }
      this.writeSessionAtomic(projectId, next)
      return { redone: true, reappliedSnapshot: popped, session: next }
    })
  }
}

// ── R3: Preview Bundle Store (`preview-bundle/v1`) ──────────────────────────

export class PreviewBundleStore {
  readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir)
  }

  private bundleDir(bundleId: string, software = 'skills-platform', recipe = 'default'): string {
    const safeId = bundleId.replace(/[^a-zA-Z0-9._-]/g, '_')
    return path.join(this.baseDir, '.cli-anything', 'previews', software, recipe, safeId)
  }

  writeBundle(bundle: PreviewBundleV1): { bundleDir: string; manifestPath: string; summaryPath: string } {
    const dir = this.bundleDir(bundle.bundleId, bundle.software, bundle.recipe)
    const artifactsDir = path.join(dir, 'artifacts')
    fs.mkdirSync(artifactsDir, { recursive: true })

    const manifest = {
      schemaVersion: bundle.schemaVersion,
      bundleId: bundle.bundleId,
      software: bundle.software,
      recipe: bundle.recipe,
      createdAt: bundle.createdAt,
      artifacts: bundle.artifacts.map(a => ({
        name: a.name,
        kind: a.kind,
        mimeType: a.mimeType,
        path: `artifacts/${a.name}`,
        ...(a.title ? { title: a.title } : {}),
      })),
    }

    const manifestPath = path.join(dir, 'manifest.json')
    const summaryPath = path.join(dir, 'summary.json')
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    fs.writeFileSync(summaryPath, JSON.stringify(bundle.summary, null, 2) + '\n', 'utf8')

    for (const artifact of bundle.artifacts) {
      const artifactPath = path.join(artifactsDir, path.basename(artifact.name))
      fs.writeFileSync(artifactPath, artifact.content, 'utf8')
    }

    // Also maintain an index pointer by bundleId for fast resource lookup
    const indexDir = path.join(this.baseDir, '.cli-anything', 'previews', '_index')
    fs.mkdirSync(indexDir, { recursive: true })
    fs.writeFileSync(
      path.join(indexDir, `${bundle.bundleId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`),
      JSON.stringify({ bundleId: bundle.bundleId, dir, bundle }, null, 2) + '\n',
      'utf8',
    )

    return { bundleDir: dir, manifestPath, summaryPath }
  }

  readBundle(bundleId: string): PreviewBundleV1 | undefined {
    const safeId = bundleId.replace(/[^a-zA-Z0-9._-]/g, '_')
    const indexFile = path.join(this.baseDir, '.cli-anything', 'previews', '_index', `${safeId}.json`)
    if (!fs.existsSync(indexFile)) return undefined
    const parsed = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as { bundle: PreviewBundleV1 }
    return parsed.bundle
  }
}

// ── R4: Handoff Envelope Store (`cli-anything-handoff-envelope/v1`) ─────────

export class HandoffEnvelopeStore {
  readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir)
  }

  private handoffDir(projectId: string): string {
    const safeId = projectId.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default'
    return path.join(this.baseDir, '.cli-anything', 'handoffs', safeId)
  }

  writeEnvelope(envelope: HandoffEnvelopeV1): string {
    const dir = this.handoffDir(envelope.projectId)
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, `${envelope.handoffId}.json`)
    const latestPath = path.join(dir, 'latest.json')
    const serialized = JSON.stringify(envelope, null, 2) + '\n'
    fs.writeFileSync(filePath, serialized, 'utf8')
    fs.writeFileSync(latestPath, serialized, 'utf8')
    return filePath
  }

  readLatest(projectId = 'default'): HandoffEnvelopeV1 | undefined {
    const latestPath = path.join(this.handoffDir(projectId), 'latest.json')
    if (!fs.existsSync(latestPath)) return undefined
    return JSON.parse(fs.readFileSync(latestPath, 'utf8')) as HandoffEnvelopeV1
  }

  readById(projectId: string, handoffId: string): HandoffEnvelopeV1 | undefined {
    const filePath = path.join(this.handoffDir(projectId), `${handoffId}.json`)
    if (!fs.existsSync(filePath)) return undefined
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as HandoffEnvelopeV1
  }
}

// ── R5: SEP-2640 Skills over MCP Snapshot & Spec-to-SKILL.md Table Generator ─

export interface Sep2640SkillFileEntry {
  readonly path: string
  readonly mimeType: string
  readonly size: number
  readonly digest: string
  readonly content: string
}

export interface Sep2640SkillEntry {
  readonly name: string
  readonly description: string
  readonly uri: string
  readonly versionHash: string
  readonly files: Sep2640SkillFileEntry[]
}

export interface Sep2640SkillsSnapshot {
  readonly capability: 'io.modelcontextprotocol/skills'
  readonly schemaVersion: 'sep-2640/v1'
  readonly generatedAt: string
  readonly etag: string
  readonly skills: Sep2640SkillEntry[]
}

function parseYamlFrontmatter(markdown: string): { name?: string; description?: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return {}
  const lines = match[1].split(/\r?\n/)
  let name: string | undefined
  let description: string | undefined
  for (const line of lines) {
    const nameMatch = line.match(/^name:\s*(.+)$/)
    if (nameMatch?.[1]) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '')
    const descMatch = line.match(/^description:\s*(.+)$/)
    if (descMatch?.[1]) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '')
  }
  return { ...(name ? { name } : {}), ...(description ? { description } : {}) }
}

function walkSkillFiles(skillDir: string, relPrefix = ''): Sep2640SkillFileEntry[] {
  const entries: Sep2640SkillFileEntry[] = []
  if (!fs.existsSync(skillDir)) return entries
  const items = fs.readdirSync(skillDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const item of items) {
    if (item.name.startsWith('.')) continue
    const absPath = path.join(skillDir, item.name)
    const relPath = relPrefix ? `${relPrefix}/${item.name}` : item.name
    if (item.isDirectory()) {
      entries.push(...walkSkillFiles(absPath, relPath))
    } else if (item.isFile()) {
      const ext = path.extname(item.name).toLowerCase()
      if (!['.md', '.json', '.yaml', '.yml', '.py', '.ts', '.js', '.sh', '.tsp'].includes(ext)) {
        continue
      }
      const content = fs.readFileSync(absPath, 'utf8')
      const digest = 'sha256:' + createHash('sha256').update(content).digest('hex')
      const mimeType =
        ext === '.md'
          ? 'text/markdown'
          : ext === '.json'
            ? 'application/json'
            : 'text/plain'
      entries.push({
        path: relPath,
        mimeType,
        size: Buffer.byteLength(content, 'utf8'),
        digest,
        content,
      })
    }
  }
  return entries
}

/**
 * Builds an immutable SEP-2640 (`io.modelcontextprotocol/skills`) `SkillsSnapshot`
 * from one or more skill directories containing `SKILL.md`.
 */
export function buildMcpUseSkillsSnapshot(skillDirs: string | string[]): Sep2640SkillsSnapshot {
  const roots = Array.isArray(skillDirs) ? skillDirs : [skillDirs]
  const discoveredSkillDirs: string[] = []

  for (const root of roots) {
    const resolved = path.resolve(root)
    if (!fs.existsSync(resolved)) continue
    if (fs.existsSync(path.join(resolved, 'SKILL.md'))) {
      discoveredSkillDirs.push(resolved)
      continue
    }
    const children = fs.readdirSync(resolved, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      if (child.isDirectory() && fs.existsSync(path.join(resolved, child.name, 'SKILL.md'))) {
        discoveredSkillDirs.push(path.join(resolved, child.name))
      }
    }
  }

  const skills: Sep2640SkillEntry[] = discoveredSkillDirs.map(dir => {
    const skillMdPath = path.join(dir, 'SKILL.md')
    const skillMd = fs.readFileSync(skillMdPath, 'utf8')
    const meta = parseYamlFrontmatter(skillMd)
    const name = meta.name ?? path.basename(dir)
    const description = meta.description ?? `Skill package ${name}`
    const files = walkSkillFiles(dir)
    const versionHash = computeCanonicalSha256(files.map(f => ({ path: f.path, digest: f.digest })))
    return {
      name,
      description,
      uri: `skill://${name}/SKILL.md`,
      versionHash,
      files,
    }
  })

  const etag = computeCanonicalSha256(skills.map(s => ({ name: s.name, versionHash: s.versionHash })))
  return {
    capability: 'io.modelcontextprotocol/skills',
    schemaVersion: 'sep-2640/v1',
    generatedAt: new Date().toISOString(),
    etag,
    skills,
  }
}
