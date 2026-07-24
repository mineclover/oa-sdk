/**
 * Materialize a TypeSpec-restored OpenAPI candidate and optionally promote it
 * to the exact snapshot named by that bundle's manifest. Candidates are local,
 * gitignored review artifacts; approved snapshots remain the committed gate.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import {
  checkTypeSpecBundle,
  formatTypeSpecBundleCheckFailure,
  printTypeSpecBundleCheckSummary,
  shouldFailTypeSpecBundleCheck,
} from '../packages/codegen/src/cli/lib/typespec-bundle-check.js'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import { diffOpenApiDocuments, formatOpenApiDiff } from '../packages/codegen/src/cli/lib/openapi-normalized-diff.js'
import { promoteSnapshotWithDriftReset, recoverPendingSnapshotPromotions } from './lib/typespec-snapshot-promotion.js'

type Args = {
  manifest: string
  write: boolean
  clearAcceptedRestoredDrift: boolean
}

const root = resolve(process.cwd())
const args = parseArgs(process.argv.slice(2))
const manifestPath = resolve(root, args.manifest)
const candidateDirectory = createCandidateDirectory(manifestPath)
const candidatePath = join(candidateDirectory, 'candidate.openapi.yaml')
const candidateMetadataPath = join(candidateDirectory, 'candidate.meta.json')
const sourceSha256 = hashBundleSource(dirname(manifestPath))

for (const recovered of recoverPendingSnapshotPromotions(root)) {
  console.log(`Recovered pending TypeSpec snapshot promotion: ${recovered}`)
}

const bundleResult = await checkTypeSpecBundle({
  manifest: args.manifest,
  output: candidatePath,
})
printTypeSpecBundleCheckSummary(bundleResult)

if (shouldFailTypeSpecBundleCheck(bundleResult.report, { failOnBreaking: false })) {
  throw new Error(`cannot approve TypeSpec snapshot: ${formatTypeSpecBundleCheckFailure(bundleResult.report)}`)
}
assertUnchangedBundleSource(dirname(manifestPath), sourceSha256)

const snapshotPath = bundleResult.report.paths.expectedOpenapi
if (!snapshotPath) {
  throw new Error('cannot create an approved snapshot candidate: the bundle manifest must declare expectedOpenapi')
}

const snapshotBytes = readFileSync(snapshotPath)
const candidateBytes = readFileSync(candidatePath)
const { document: snapshotDocument } = loadSpecWithPath(snapshotPath)
const { document: candidateDocument } = loadSpecWithPath(candidatePath)
const diff = diffOpenApiDocuments(
  snapshotDocument as Record<string, unknown>,
  candidateDocument as Record<string, unknown>,
)
const driftManifestPath = join(dirname(snapshotPath), 'accepted-restored-drift.json')
const driftManifestBytes = existsSync(driftManifestPath) ? readFileSync(driftManifestPath) : undefined
const acceptedRestoredDriftEntries = existsSync(driftManifestPath)
  ? loadAcceptedRestoredDriftEntryCount(driftManifestPath)
  : 0
const candidateMetadata = {
  schemaVersion: 'oa-sdk.typespec-candidate.v1',
  manifest: relative(root, manifestPath),
  manifestSha256: sha256(readFileSync(manifestPath)),
  sourceSha256,
  approvedSnapshot: relative(root, snapshotPath),
  approvedSnapshotSha256: sha256(snapshotBytes),
  candidate: relative(root, candidatePath),
  candidateSha256: sha256(candidateBytes),
  ...(existsSync(driftManifestPath)
    ? {
      acceptedRestoredDrift: relative(root, driftManifestPath),
      acceptedRestoredDriftEntries,
    }
    : {}),
}
writeFileSync(candidateMetadataPath, `${JSON.stringify(candidateMetadata, null, 2)}\n`)

console.log('')
console.log('TypeSpec approved snapshot candidate')
console.log(`  manifest: ${candidateMetadata.manifest}`)
console.log(`  approved snapshot: ${candidateMetadata.approvedSnapshot}`)
console.log(`  candidate: ${candidateMetadata.candidate}`)
console.log(`  metadata: ${relative(root, candidateMetadataPath)}`)
console.log(`  normalized diff: ${diff.length === 0 ? 'none' : `${diff.length} changes`}`)
if (acceptedRestoredDriftEntries > 0) {
  console.log(`  accepted restored drift: ${acceptedRestoredDriftEntries} entries`)
}
console.log('')
console.log(formatOpenApiDiff(diff))

if (!args.write) {
  console.log('Candidate retained locally. Inspect the diff, then rerun with --write to promote this manifest-bound snapshot.')
} else if (acceptedRestoredDriftEntries > 0 && !args.clearAcceptedRestoredDrift) {
  throw new Error(
    `cannot promote while ${relative(root, driftManifestPath)} has ${acceptedRestoredDriftEntries} accepted entries; review them and rerun with --clear-accepted-restored-drift to reset the manifest with the snapshot promotion`,
  )
} else {
  assertUnchangedSnapshot(snapshotPath, candidateMetadata.approvedSnapshotSha256)
  assertUnchangedBundleSource(dirname(manifestPath), candidateMetadata.sourceSha256)
  if (acceptedRestoredDriftEntries > 0) {
    const clearedDriftManifest = `${JSON.stringify({
      schemaVersion: 'oa-sdk.typespec-restored-drift.v2',
      entries: [],
    }, null, 2)}\n`
    if (diff.length > 0) {
      promoteSnapshotWithDriftReset({
        root,
        snapshotPath,
        snapshotBefore: snapshotBytes,
        snapshotAfter: candidateBytes,
        driftPath: driftManifestPath,
        driftBefore: driftManifestBytes!,
        driftAfter: Buffer.from(clearedDriftManifest),
      })
    } else {
      writeAtomically(driftManifestPath, clearedDriftManifest)
    }
    console.log(`Cleared accepted restored drift: ${relative(root, driftManifestPath)}`)
  }
  if (diff.length === 0) {
    console.log('Approved snapshot is already current; no snapshot file was changed.')
  } else if (acceptedRestoredDriftEntries === 0) {
    writeAtomically(snapshotPath, candidateBytes)
    console.log(`Updated approved snapshot: ${relative(root, snapshotPath)}`)
  } else {
    console.log(`Updated approved snapshot: ${relative(root, snapshotPath)}`)
  }
}

function parseArgs(rawArgs: string[]): Args {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    console.log(`Usage:
  pnpm schema:approve-typespec-reference [-- --write] [--manifest <path>] [--clear-accepted-restored-drift]

Build and restore the TypeSpec bundle into .oa-sdk/typespec-candidates/, show its normalized diff
against the snapshot declared by that manifest, and promote only that snapshot when --write is supplied.
`)
    process.exit(0)
  }
  return {
    manifest: readOption(rawArgs, '--manifest') ?? 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    write: rawArgs.includes('--write'),
    clearAcceptedRestoredDrift: rawArgs.includes('--clear-accepted-restored-drift'),
  }
}

function readOption(rawArgs: string[], name: string): string | undefined {
  const index = rawArgs.indexOf(name)
  if (index === -1) return undefined
  const value = rawArgs[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function createCandidateDirectory(manifestPath: string): string {
  const bundleId = sha256(relative(root, manifestPath)).slice(0, 16)
  const directory = join(root, '.oa-sdk', 'typespec-candidates', bundleId)
  mkdirSync(directory, { recursive: true })
  return directory
}

function loadAcceptedRestoredDriftEntryCount(path: string): number {
  const value = JSON.parse(readFileSync(path, 'utf8')) as { entries?: unknown }
  if (!Array.isArray(value.entries)) throw new Error(`invalid accepted restored drift manifest: ${relative(root, path)}`)
  return value.entries.length
}

function assertUnchangedSnapshot(path: string, expectedSha256: string): void {
  const actualSha256 = sha256(readFileSync(path))
  if (actualSha256 !== expectedSha256) {
    throw new Error(`approved snapshot changed while the candidate was being reviewed: ${relative(root, path)}`)
  }
}

function assertUnchangedBundleSource(directory: string, expectedSha256: string): void {
  const actualSha256 = hashBundleSource(directory)
  if (actualSha256 !== expectedSha256) {
    throw new Error(`TypeSpec bundle source changed while the candidate was being reviewed: ${relative(root, directory)}`)
  }
}

function hashBundleSource(directory: string): string {
  const sourceFiles = collectBundleSourceFiles(directory)
  const hash = createHash('sha256')
  for (const file of sourceFiles) {
    const path = join(directory, file)
    if (!statSync(path).isFile()) continue
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function collectBundleSourceFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = join(prefix, entry.name)
      if (entry.isDirectory()) return collectBundleSourceFiles(join(directory, entry.name), file)
      return entry.isFile() && isBundleSourceFile(entry.name) ? [file] : []
    })
    .sort()
}

function isBundleSourceFile(name: string): boolean {
  return name.endsWith('.tsp')
    || name === 'tspconfig.yaml'
    || name === 'tspconfig.yml'
    || name === 'oa-sdk.typespec-bundle.json'
    || name === 'oa-sdk.typespec-compat-sidecar.json'
}

function writeAtomically(path: string, contents: string | Uint8Array): void {
  const temporaryPath = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`)
  writeFileSync(temporaryPath, contents)
  renameSync(temporaryPath, path)
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
