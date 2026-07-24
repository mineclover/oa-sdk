import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

const JOURNAL_SCHEMA_VERSION = 'oa-sdk.typespec-snapshot-promotion.v1'

type JournalFile = {
  path: string
  beforeSha256: string
  afterSha256: string
  afterBase64: string
}

type SnapshotPromotionJournal = {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION
  snapshot: JournalFile
  acceptedRestoredDrift: JournalFile
}

export function promoteSnapshotWithDriftReset(input: {
  root: string
  snapshotPath: string
  snapshotBefore: Uint8Array
  snapshotAfter: Uint8Array
  driftPath: string
  driftBefore: Uint8Array
  driftAfter: Uint8Array
}): void {
  const journal = createSnapshotPromotionJournal(input)
  assertFileHash(resolve(input.root, journal.snapshot.path), journal.snapshot.beforeSha256)
  assertFileHash(resolve(input.root, journal.acceptedRestoredDrift.path), journal.acceptedRestoredDrift.beforeSha256)
  const journalPath = getSnapshotPromotionJournalPath(input.root, journal)
  writeAtomically(journalPath, `${JSON.stringify(journal, null, 2)}\n`)
  applySnapshotPromotionJournal(input.root, journalPath, journal)
}

export function recoverPendingSnapshotPromotions(root: string): string[] {
  const journalDirectory = getSnapshotPromotionJournalDirectory(root)
  if (!existsSync(journalDirectory)) return []

  const recovered: string[] = []
  for (const file of readdirSync(journalDirectory).filter(file => file.endsWith('.json')).sort()) {
    const journalPath = join(journalDirectory, file)
    const journal = parseSnapshotPromotionJournal(root, journalPath)
    applySnapshotPromotionJournal(root, journalPath, journal)
    recovered.push(`${journal.snapshot.path} + ${journal.acceptedRestoredDrift.path}`)
  }
  return recovered
}

export function getSnapshotPromotionJournalPath(root: string, journal: SnapshotPromotionJournal): string {
  const id = sha256(`${journal.snapshot.path}\0${journal.acceptedRestoredDrift.path}`).slice(0, 16)
  return join(getSnapshotPromotionJournalDirectory(root), `${id}.json`)
}

function createSnapshotPromotionJournal(input: {
  root: string
  snapshotPath: string
  snapshotBefore: Uint8Array
  snapshotAfter: Uint8Array
  driftPath: string
  driftBefore: Uint8Array
  driftAfter: Uint8Array
}): SnapshotPromotionJournal {
  const root = resolve(input.root)
  return {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    snapshot: createJournalFile(root, input.snapshotPath, input.snapshotBefore, input.snapshotAfter),
    acceptedRestoredDrift: createJournalFile(root, input.driftPath, input.driftBefore, input.driftAfter),
  }
}

function createJournalFile(root: string, path: string, before: Uint8Array, after: Uint8Array): JournalFile {
  const relativePath = assertWorkspacePath(root, path)
  return {
    path: relativePath,
    beforeSha256: sha256(before),
    afterSha256: sha256(after),
    afterBase64: Buffer.from(after).toString('base64'),
  }
}

function parseSnapshotPromotionJournal(root: string, path: string): SnapshotPromotionJournal {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`invalid TypeSpec snapshot promotion journal: ${relative(root, path)}`)
  }
  if (!isRecord(value)
    || value.schemaVersion !== JOURNAL_SCHEMA_VERSION
    || !isJournalFile(value.snapshot)
    || !isJournalFile(value.acceptedRestoredDrift)) {
    throw new Error(`invalid TypeSpec snapshot promotion journal: ${relative(root, path)}`)
  }
  assertWorkspacePath(root, value.snapshot.path)
  assertWorkspacePath(root, value.acceptedRestoredDrift.path)
  return value as SnapshotPromotionJournal
}

function applySnapshotPromotionJournal(root: string, journalPath: string, journal: SnapshotPromotionJournal): void {
  const files = [journal.snapshot, journal.acceptedRestoredDrift]
  const preparedFiles = files.map((file) => {
    const path = resolve(root, file.path)
    const actual = sha256(readFileSync(path))
    if (actual !== file.afterSha256 && actual !== file.beforeSha256) {
      throw new Error(
        `cannot recover TypeSpec snapshot promotion because ${file.path} changed outside the recorded transaction`,
      )
    }
    const after = Buffer.from(file.afterBase64, 'base64')
    if (sha256(after) !== file.afterSha256) {
      throw new Error(`invalid TypeSpec snapshot promotion journal payload for ${file.path}`)
    }
    return { file, path, actual, after }
  })
  for (const prepared of preparedFiles) {
    if (prepared.actual === prepared.file.afterSha256) continue
    writeAtomically(prepared.path, prepared.after)
  }
  for (const file of files) {
    assertFileHash(resolve(root, file.path), file.afterSha256)
  }
  rmSync(journalPath, { force: true })
}

function getSnapshotPromotionJournalDirectory(root: string): string {
  return join(resolve(root), '.oa-sdk', 'typespec-snapshot-promotions')
}

function assertWorkspacePath(root: string, path: string): string {
  const absolutePath = resolve(root, path)
  const relativePath = relative(root, absolutePath)
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith('..\\') || relativePath.startsWith('../')) {
    throw new Error(`TypeSpec snapshot promotion path must stay inside the workspace: ${path}`)
  }
  return relativePath
}

function assertFileHash(path: string, expectedSha256: string): void {
  const actualSha256 = sha256(readFileSync(path))
  if (actualSha256 !== expectedSha256) {
    throw new Error(`TypeSpec snapshot promotion baseline changed: ${path}`)
  }
}

function writeAtomically(path: string, contents: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`)
  writeFileSync(temporaryPath, contents)
  renameSync(temporaryPath, path)
}

function isJournalFile(value: unknown): value is JournalFile {
  return isRecord(value)
    && typeof value.path === 'string'
    && isSha256(value.beforeSha256)
    && isSha256(value.afterSha256)
    && typeof value.afterBase64 === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}
