import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSpecWithPath } from '../cli/lib/load-spec.js'

const pkgDir = resolve(__dirname, '../..')
const rootDir = resolve(pkgDir, '../..')
const fixtureDir = resolve(rootDir, 'docs/internal/typespec-roundtrip/fixtures/authored-extension-bundle')
const productionSnapshotPath = resolve(rootDir, 'packages/schemas/typespec/approved.openapi.yaml')
const contractVersionPath = resolve(rootDir, 'packages/schemas/typespec/version.tsp')
const mainTypeSpecPath = resolve(rootDir, 'packages/schemas/typespec/main.tsp')
const approvalScriptPath = resolve(rootDir, 'scripts/schema-approve-typespec-reference.ts')
const schemaCheckScriptPath = resolve(rootDir, 'scripts/schema-typespec-check.ts')
const tmpBase = resolve(pkgDir, '.tmp-schema-approve-typespec-reference-test')

let tmpDir: string
let candidateDirectory: string | undefined
let journalPath: string | undefined

beforeEach(() => {
  tmpDir = join(tmpBase, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  if (candidateDirectory && existsSync(candidateDirectory)) rmSync(candidateDirectory, { recursive: true, force: true })
  if (journalPath && existsSync(journalPath)) rmSync(journalPath, { force: true })
})

describe('schema:approve-typespec-reference', () => {
  it('emits the API contract version from the dedicated TypeSpec declaration', () => {
    const versionSource = readFileSync(contractVersionPath, 'utf8')
    const version = versionSource.match(/const ContractVersion = "([^"]+)";/)?.[1]
    const mainTypeSpec = readFileSync(mainTypeSpecPath, 'utf8')
    const { document } = loadSpecWithPath(productionSnapshotPath)

    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(mainTypeSpec).toContain('version: ContractVersion')
    expect(mainTypeSpec).toContain('@info(#{ version: ContractVersion })')
    expect((document as { info?: { version?: string } }).info?.version).toBe(version)
  })

  it('promotes only the snapshot selected by the supplied bundle manifest', () => {
    const bundleDir = copyFixtureBundle()
    const manifestPath = join(bundleDir, 'oa-sdk.typespec-bundle.json')
    const expectedSnapshotPath = join(bundleDir, 'expected.openapi.yaml')
    const productionSnapshot = readFileSync(productionSnapshotPath)

    const approve = runApproval('--write', '--manifest', manifestPath)
    expect(approve.status, `${approve.stdout}\n${approve.stderr}`).toBe(0)

    const candidatePath = join(candidateDirectory!, 'candidate.openapi.yaml')
    const metadataPath = join(candidateDirectory!, 'candidate.meta.json')
    expect(readFileSync(expectedSnapshotPath)).toEqual(readFileSync(candidatePath))
    expect(readFileSync(productionSnapshotPath)).toEqual(productionSnapshot)

    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>
    expect(metadata).toMatchObject({
      schemaVersion: 'oa-sdk.typespec-candidate.v1',
      manifest: relative(rootDir, manifestPath),
      approvedSnapshot: relative(rootDir, expectedSnapshotPath),
      candidate: relative(rootDir, candidatePath),
    })
    expect(metadata.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(metadata.approvedSnapshot).not.toBe(relative(rootDir, productionSnapshotPath))
  })

  it('requires an explicit drift reset before promotion and resets it with the snapshot', () => {
    const bundleDir = copyFixtureBundle()
    const manifestPath = join(bundleDir, 'oa-sdk.typespec-bundle.json')
    const expectedSnapshotPath = join(bundleDir, 'expected.openapi.yaml')
    const driftPath = join(bundleDir, 'accepted-restored-drift.json')
    const beforePromotion = readFileSync(expectedSnapshotPath)
    writeFileSync(driftPath, `${JSON.stringify({
      schemaVersion: 'oa-sdk.typespec-restored-drift.v2',
      entries: [{ pointer: '/paths/~1users/get', reason: 'fixture guard' }],
    }, null, 2)}\n`)

    const blocked = runApproval('--write', '--manifest', manifestPath)
    expect(blocked.status).toBe(1)
    expect(`${blocked.stdout}\n${blocked.stderr}`).toContain('cannot promote while')
    expect(readFileSync(expectedSnapshotPath)).toEqual(beforePromotion)

    const approved = runApproval('--write', '--clear-accepted-restored-drift', '--manifest', manifestPath)
    expect(approved.status, `${approved.stdout}\n${approved.stderr}`).toBe(0)
    expect(JSON.parse(readFileSync(driftPath, 'utf8'))).toEqual({
      schemaVersion: 'oa-sdk.typespec-restored-drift.v2',
      entries: [],
    })
    expect(readFileSync(expectedSnapshotPath)).toEqual(readFileSync(join(candidateDirectory!, 'candidate.openapi.yaml')))
    expect(existsSync(promotionJournalPath(expectedSnapshotPath, driftPath))).toBe(false)
  })

  it('recovers an interrupted snapshot-and-drift promotion before the next approval', () => {
    const bundleDir = copyFixtureBundle()
    const snapshotPath = join(bundleDir, 'expected.openapi.yaml')
    const driftPath = join(bundleDir, 'accepted-restored-drift.json')
    const snapshotBefore = readFileSync(snapshotPath)
    const snapshotAfter = Buffer.concat([snapshotBefore, Buffer.from('\n# recovered promotion fixture\n')])
    const driftBefore = Buffer.from(`${JSON.stringify({
      schemaVersion: 'oa-sdk.typespec-restored-drift.v2',
      entries: [{ pointer: '/paths/~1users/get', reason: 'fixture guard' }],
    }, null, 2)}\n`)
    const driftAfter = Buffer.from(`${JSON.stringify({
      schemaVersion: 'oa-sdk.typespec-restored-drift.v2',
      entries: [],
    }, null, 2)}\n`)
    writeFileSync(driftPath, driftBefore)

    const snapshotRelativePath = relative(rootDir, snapshotPath)
    const driftRelativePath = relative(rootDir, driftPath)
    journalPath = join(
      rootDir,
      '.oa-sdk',
      'typespec-snapshot-promotions',
      createHash('sha256').update(`${snapshotRelativePath}\0${driftRelativePath}`).digest('hex').slice(0, 16) + '.json',
    )
    mkdirSync(resolve(journalPath, '..'), { recursive: true })
    writeFileSync(journalPath, `${JSON.stringify({
      schemaVersion: 'oa-sdk.typespec-snapshot-promotion.v1',
      snapshot: journalFile(snapshotRelativePath, snapshotBefore, snapshotAfter),
      acceptedRestoredDrift: journalFile(driftRelativePath, driftBefore, driftAfter),
    }, null, 2)}\n`)
    writeFileSync(snapshotPath, snapshotAfter)

    const recovered = runApproval('--manifest', join(bundleDir, 'oa-sdk.typespec-bundle.json'))
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0)
    expect(recovered.stdout).toContain('Recovered pending TypeSpec snapshot promotion')
    expect(readFileSync(snapshotPath)).toEqual(snapshotAfter)
    expect(readFileSync(driftPath)).toEqual(driftAfter)
    expect(existsSync(journalPath)).toBe(false)
  })

  it('does not overwrite a manually changed file while recovering a promotion', () => {
    const bundleDir = copyFixtureBundle()
    const snapshotPath = join(bundleDir, 'expected.openapi.yaml')
    const driftPath = join(bundleDir, 'accepted-restored-drift.json')
    const snapshotBefore = readFileSync(snapshotPath)
    const snapshotAfter = Buffer.concat([snapshotBefore, Buffer.from('\n# promoted fixture\n')])
    const driftBefore = Buffer.from('{"schemaVersion":"oa-sdk.typespec-restored-drift.v2","entries":[{}]}\n')
    const driftAfter = Buffer.from('{"schemaVersion":"oa-sdk.typespec-restored-drift.v2","entries":[]}\n')
    writeFileSync(driftPath, driftBefore)
    journalPath = writePromotionJournal(snapshotPath, snapshotBefore, snapshotAfter, driftPath, driftBefore, driftAfter)
    writeFileSync(snapshotPath, snapshotAfter)
    const manualDrift = Buffer.from('{"schemaVersion":"oa-sdk.typespec-restored-drift.v2","entries":[{"manual":true}]}\n')
    writeFileSync(driftPath, manualDrift)

    const recovery = runApproval('--manifest', join(bundleDir, 'oa-sdk.typespec-bundle.json'))
    expect(recovery.status).toBe(1)
    expect(`${recovery.stdout}\n${recovery.stderr}`).toContain('changed outside the recorded transaction')
    expect(readFileSync(driftPath)).toEqual(manualDrift)
    expect(existsSync(journalPath)).toBe(true)
  })

  it('validates every journal payload before changing either promotion target', () => {
    const bundleDir = copyFixtureBundle()
    const snapshotPath = join(bundleDir, 'expected.openapi.yaml')
    const driftPath = join(bundleDir, 'accepted-restored-drift.json')
    const snapshotBefore = readFileSync(snapshotPath)
    const snapshotAfter = Buffer.concat([snapshotBefore, Buffer.from('\n# promoted fixture\n')])
    const driftBefore = Buffer.from('{"schemaVersion":"oa-sdk.typespec-restored-drift.v2","entries":[{}]}\n')
    const driftAfter = Buffer.from('{"schemaVersion":"oa-sdk.typespec-restored-drift.v2","entries":[]}\n')
    writeFileSync(driftPath, driftBefore)
    journalPath = writePromotionJournal(snapshotPath, snapshotBefore, snapshotAfter, driftPath, driftBefore, driftAfter)
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      acceptedRestoredDrift: { afterBase64: string }
    }
    journal.acceptedRestoredDrift.afterBase64 = Buffer.from('corrupted payload').toString('base64')
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`)

    const recovery = runApproval('--manifest', join(bundleDir, 'oa-sdk.typespec-bundle.json'))
    expect(recovery.status).toBe(1)
    expect(`${recovery.stdout}\n${recovery.stderr}`).toContain('invalid TypeSpec snapshot promotion journal payload')
    expect(readFileSync(snapshotPath)).toEqual(snapshotBefore)
    expect(readFileSync(driftPath)).toEqual(driftBefore)
    expect(existsSync(journalPath)).toBe(true)
  })

  it('recovers a pending promotion before running the TypeSpec schema gate', () => {
    const bundleDir = copyFixtureBundle()
    const manifestPath = join(bundleDir, 'oa-sdk.typespec-bundle.json')
    const snapshotPath = join(bundleDir, 'expected.openapi.yaml')
    const driftPath = join(bundleDir, 'accepted-restored-drift.json')
    const prepared = runApproval('--write', '--manifest', manifestPath)
    expect(prepared.status, `${prepared.stdout}\n${prepared.stderr}`).toBe(0)
    const snapshotBefore = readFileSync(snapshotPath)
    const snapshotAfter = Buffer.concat([snapshotBefore, Buffer.from('\n# gate recovery fixture\n')])
    const driftBefore = Buffer.from('{"schemaVersion":"oa-sdk.typespec-restored-drift.v2","entries":[{}]}\n')
    const driftAfter = Buffer.from('{"schemaVersion":"oa-sdk.typespec-restored-drift.v2","entries":[]}\n')
    writeFileSync(driftPath, driftBefore)
    journalPath = writePromotionJournal(snapshotPath, snapshotBefore, snapshotAfter, driftPath, driftBefore, driftAfter)
    writeFileSync(snapshotPath, snapshotAfter)

    const check = spawnSync(process.execPath, [
      '--import', 'tsx', schemaCheckScriptPath,
      '--manifest', manifestPath,
      '--expected-openapi', snapshotPath,
      '--reference-openapi', snapshotPath,
      '--accepted-restored-drift', driftPath,
    ], { cwd: rootDir, encoding: 'utf8' })
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0)
    expect(check.stdout).toContain('Recovered pending TypeSpec snapshot promotion')
    expect(JSON.parse(readFileSync(driftPath, 'utf8'))).toEqual({
      schemaVersion: 'oa-sdk.typespec-restored-drift.v2',
      entries: [],
    })
    expect(existsSync(journalPath)).toBe(false)
  })
})

function copyFixtureBundle(): string {
  const bundleDir = join(tmpDir, 'bundle')
  cpSync(fixtureDir, bundleDir, { recursive: true })
  return bundleDir
}

function runApproval(...args: string[]) {
  const manifestPath = args[args.indexOf('--manifest') + 1]
  if (!manifestPath) throw new Error('test approval command requires --manifest <path>')
  candidateDirectory = join(
    rootDir,
    '.oa-sdk',
    'typespec-candidates',
    createHash('sha256').update(relative(rootDir, manifestPath)).digest('hex').slice(0, 16),
  )
  return spawnSync(process.execPath, ['--import', 'tsx', approvalScriptPath, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
  })
}

function journalFile(path: string, before: Uint8Array, after: Uint8Array) {
  return {
    path,
    beforeSha256: createHash('sha256').update(before).digest('hex'),
    afterSha256: createHash('sha256').update(after).digest('hex'),
    afterBase64: Buffer.from(after).toString('base64'),
  }
}

function promotionJournalPath(snapshotPath: string, driftPath: string): string {
  return join(
    rootDir,
    '.oa-sdk',
    'typespec-snapshot-promotions',
    createHash('sha256').update(`${relative(rootDir, snapshotPath)}\0${relative(rootDir, driftPath)}`).digest('hex').slice(0, 16) + '.json',
  )
}

function writePromotionJournal(
  snapshotPath: string,
  snapshotBefore: Uint8Array,
  snapshotAfter: Uint8Array,
  driftPath: string,
  driftBefore: Uint8Array,
  driftAfter: Uint8Array,
): string {
  const snapshotRelativePath = relative(rootDir, snapshotPath)
  const driftRelativePath = relative(rootDir, driftPath)
  const path = promotionJournalPath(snapshotPath, driftPath)
  mkdirSync(resolve(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify({
    schemaVersion: 'oa-sdk.typespec-snapshot-promotion.v1',
    snapshot: journalFile(snapshotRelativePath, snapshotBefore, snapshotAfter),
    acceptedRestoredDrift: journalFile(driftRelativePath, driftBefore, driftAfter),
  }, null, 2)}\n`)
  return path
}
