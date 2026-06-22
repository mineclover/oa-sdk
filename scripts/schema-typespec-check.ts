/**
 * Validate the production TypeSpec schema candidate without changing the
 * existing OpenAPI/Definition Builder production path.
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import {
  checkTypeSpecBundle,
  formatTypeSpecBundleCheckFailure,
  printTypeSpecBundleCheckSummary,
  shouldFailTypeSpecBundleCheck,
} from '../packages/codegen/src/cli/lib/typespec-bundle-check.js'
import { loadSpecWithPath } from '../packages/codegen/src/cli/lib/load-spec.js'
import {
  diffOpenApiDocuments,
  formatOpenApiDiff,
  stableOpenApiStringify,
  type OpenApiNormalizedDiffEntry,
} from '../packages/codegen/src/cli/lib/openapi-normalized-diff.js'

type Args = {
  manifest: string
  expectedOpenapi: string
  productionOpenapi: string
  acceptedRestoredDrift: string
  report?: string
  output?: string
  keep?: boolean
}

type AcceptedRestoredDriftManifest = {
  schemaVersion: 'oa-sdk.typespec-restored-drift.v2'
  entries: AcceptedRestoredDriftEntry[]
}

type AcceptedRestoredDriftEntry = Pick<OpenApiNormalizedDiffEntry, 'category' | 'kind' | 'pointer'> & {
  productionSha256: string
  restoredSha256: string
}

type DriftDocuments = {
  productionDocument: Record<string, unknown>
  restoredDocument: Record<string, unknown>
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/

const root = resolve(process.cwd())
const args = parseArgs(process.argv.slice(2))
const workspace = mkdtempSync(join(tmpdir(), 'oa-sdk-schema-typespec-check-'))
const restoredOutputPath = args.output ?? join(workspace, 'typespec-restored.openapi.yaml')

try {
  const bundleResult = await checkTypeSpecBundle({
    manifest: args.manifest,
    expected: args.expectedOpenapi,
    output: restoredOutputPath,
    failOnBreaking: true,
    ...(args.report ? { report: args.report } : {}),
    ...(args.keep ? { keep: true } : {}),
  })
  printTypeSpecBundleCheckSummary(bundleResult)

  if (shouldFailTypeSpecBundleCheck(bundleResult.report, { failOnBreaking: true })) {
    console.error(`TypeSpec schema check failed gates: ${formatTypeSpecBundleCheckFailure(bundleResult.report)}`)
    process.exitCode = 1
  } else {
    const { document: productionDocument } = loadSpecWithPath(args.productionOpenapi)
    const { document: expectedDocument } = loadSpecWithPath(args.expectedOpenapi)
    const { document: restoredDocument } = loadSpecWithPath(bundleResult.report.paths.restoredOpenapi)
    const acceptedRestoredDrift = loadAcceptedRestoredDrift(args.acceptedRestoredDrift)
    const driftDocuments = {
      productionDocument: productionDocument as Record<string, unknown>,
      restoredDocument: restoredDocument as Record<string, unknown>,
    }
    const expectedFreshnessDiff = diffOpenApiDocuments(
      driftDocuments.productionDocument,
      expectedDocument as Record<string, unknown>,
    )
    const restoredFreshnessDiff = diffOpenApiDocuments(
      driftDocuments.productionDocument,
      driftDocuments.restoredDocument,
    )
    const restoredDriftReport = compareAcceptedRestoredDrift(
      restoredFreshnessDiff,
      acceptedRestoredDrift.entries,
      driftDocuments,
    )

    console.log('')
    console.log('TypeSpec schema freshness check')
    console.log(`  production OpenAPI: ${relative(root, resolve(root, args.productionOpenapi))}`)
    console.log(`  bundle expected: ${relative(root, resolve(root, args.expectedOpenapi))}`)
    console.log(`  TypeSpec restored: ${relative(root, resolve(root, bundleResult.report.paths.restoredOpenapi))}`)
    console.log(`  accepted restored drift: ${relative(root, resolve(root, args.acceptedRestoredDrift))}`)
    console.log(`  expected normalized diff: ${expectedFreshnessDiff.length === 0 ? 'pass' : 'fail'}`)
    console.log(`  restored normalized diff: ${restoredDriftReport.pass ? `pass (${restoredFreshnessDiff.length} accepted)` : 'fail'}`)
    if (restoredDriftReport.pass && restoredFreshnessDiff.length > 0) {
      console.log(`  accepted drift breakdown: ${formatAcceptedDriftSummary(acceptedRestoredDrift.entries)}`)
    }

    if (expectedFreshnessDiff.length > 0 || !restoredDriftReport.pass) {
      if (expectedFreshnessDiff.length > 0) {
        console.error('')
        console.error('Bundle expected OpenAPI drift:')
        console.error(formatOpenApiDiff(expectedFreshnessDiff))
      }
      if (!restoredDriftReport.pass) {
        console.error('')
        console.error('TypeSpec-restored OpenAPI drift:')
        console.error(formatOpenApiDiff(restoredFreshnessDiff))
        console.error('')
        console.error(formatAcceptedDriftMismatch(restoredDriftReport))
      }
      process.exitCode = 1
    }
  }
} finally {
  if (!args.keep) {
    rmSync(workspace, { recursive: true, force: true })
  }
}

function parseArgs(rawArgs: string[]): Args {
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage()
    process.exit(0)
  }
  return {
    manifest: readOption(rawArgs, '--manifest') ?? 'packages/schemas/typespec/oa-sdk.typespec-bundle.json',
    expectedOpenapi: readOption(rawArgs, '--expected-openapi') ?? 'packages/schemas/typespec/expected.openapi.yaml',
    productionOpenapi: readOption(rawArgs, '--production-openapi') ?? 'packages/schemas/src/.merged.yaml',
    acceptedRestoredDrift: readOption(rawArgs, '--accepted-restored-drift') ?? 'packages/schemas/typespec/accepted-restored-drift.json',
    ...(readOption(rawArgs, '--report') ? { report: readOption(rawArgs, '--report') } : {}),
    ...(readOption(rawArgs, '--output') ? { output: readOption(rawArgs, '--output') } : {}),
    keep: rawArgs.includes('--keep'),
  }
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function loadAcceptedRestoredDrift(path: string): AcceptedRestoredDriftManifest {
  const raw = loadJson(path)
  if (!isRecord(raw) || raw.schemaVersion !== 'oa-sdk.typespec-restored-drift.v2' || !Array.isArray(raw.entries)) {
    throw new Error(`invalid accepted restored drift manifest ${path}`)
  }
  const entries = raw.entries.map((entry, index) => {
    if (!isRecord(entry)
      || typeof entry.category !== 'string'
      || typeof entry.kind !== 'string'
      || typeof entry.pointer !== 'string'
      || typeof entry.productionSha256 !== 'string'
      || !SHA256_HEX_PATTERN.test(entry.productionSha256)
      || typeof entry.restoredSha256 !== 'string'
      || !SHA256_HEX_PATTERN.test(entry.restoredSha256)) {
      throw new Error(`invalid accepted restored drift entry ${path}#entries/${index}`)
    }
    return {
      category: entry.category,
      kind: entry.kind,
      pointer: entry.pointer,
      productionSha256: entry.productionSha256,
      restoredSha256: entry.restoredSha256,
    } as AcceptedRestoredDriftEntry
  })
  return {
    schemaVersion: 'oa-sdk.typespec-restored-drift.v2',
    entries,
  }
}

function compareAcceptedRestoredDrift(
  actual: readonly OpenApiNormalizedDiffEntry[],
  accepted: readonly AcceptedRestoredDriftEntry[],
  documents: DriftDocuments,
): {
  pass: boolean
  unexpected: OpenApiNormalizedDiffEntry[]
  changed: Array<{
    actual: AcceptedRestoredDriftEntry
    accepted: AcceptedRestoredDriftEntry
  }>
  missing: AcceptedRestoredDriftEntry[]
} {
  const acceptedByKey = new Map(accepted.map(entry => [driftKey(entry), entry]))
  if (acceptedByKey.size !== accepted.length) {
    throw new Error('accepted restored drift manifest contains duplicate entries')
  }
  const actualKeys = new Set(actual.map(driftKey))
  const unexpected = actual.filter(entry => !acceptedByKey.has(driftKey(entry)))
  const changed = actual.flatMap(entry => {
    const acceptedEntry = acceptedByKey.get(driftKey(entry))
    if (!acceptedEntry) return []
    const actualEntry = createAcceptedRestoredDriftEntry(entry, documents)
    if (
      actualEntry.productionSha256 === acceptedEntry.productionSha256
      && actualEntry.restoredSha256 === acceptedEntry.restoredSha256
    ) {
      return []
    }
    return [{ actual: actualEntry, accepted: acceptedEntry }]
  })
  const missing = accepted.filter(entry => !actualKeys.has(driftKey(entry)))
  return {
    pass: unexpected.length === 0 && changed.length === 0 && missing.length === 0,
    unexpected,
    changed,
    missing,
  }
}

function formatAcceptedDriftMismatch(input: {
  unexpected: readonly OpenApiNormalizedDiffEntry[]
  changed: ReadonlyArray<{
    actual: AcceptedRestoredDriftEntry
    accepted: AcceptedRestoredDriftEntry
  }>
  missing: readonly AcceptedRestoredDriftEntry[]
}): string {
  const lines = ['Accepted restored drift mismatch:']
  if (input.unexpected.length > 0) {
    lines.push(`- unexpected actual drift: ${input.unexpected.length}`)
    for (const entry of input.unexpected.slice(0, 20)) {
      lines.push(`  - ${driftKey(entry)}`)
    }
  }
  if (input.changed.length > 0) {
    lines.push(`- changed accepted drift value: ${input.changed.length}`)
    for (const { actual, accepted } of input.changed.slice(0, 20)) {
      lines.push(`  - ${driftKey(actual)}`)
      lines.push(`    expected production/restored: ${shortHash(accepted.productionSha256)}/${shortHash(accepted.restoredSha256)}`)
      lines.push(`    actual production/restored: ${shortHash(actual.productionSha256)}/${shortHash(actual.restoredSha256)}`)
    }
  }
  if (input.missing.length > 0) {
    lines.push(`- missing accepted drift: ${input.missing.length}`)
    for (const entry of input.missing.slice(0, 20)) {
      lines.push(`  - ${driftKey(entry)}`)
    }
  }
  return lines.join('\n')
}

function formatAcceptedDriftSummary(entries: readonly AcceptedRestoredDriftEntry[]): string {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    const key = `${entry.category}/${entry.kind}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}=${count}`)
    .join(', ')
}

function createAcceptedRestoredDriftEntry(
  entry: OpenApiNormalizedDiffEntry,
  documents: DriftDocuments,
): AcceptedRestoredDriftEntry {
  return {
    category: entry.category,
    kind: entry.kind,
    pointer: entry.pointer,
    productionSha256: hashOpenApiValue(readJsonPointer(documents.productionDocument, entry.pointer), entry.pointer),
    restoredSha256: hashOpenApiValue(readJsonPointer(documents.restoredDocument, entry.pointer), entry.pointer),
  }
}

function driftKey(entry: Pick<OpenApiNormalizedDiffEntry, 'category' | 'kind' | 'pointer'>): string {
  return `${entry.category}:${entry.kind}:${entry.pointer}`
}

function hashOpenApiValue(value: unknown, pointer: string): string {
  // For added/removed drift, the missing side intentionally hashes the stable
  // normalized `undefined` sentinel so the manifest pins both sides uniformly.
  return createHash('sha256').update(stableOpenApiStringify(value, pointer)).digest('hex')
}

function shortHash(value: string): string {
  return value.slice(0, 12)
}

function readJsonPointer(document: Record<string, unknown>, pointer: string): unknown {
  if (pointer === '#') return document
  if (!pointer.startsWith('#/')) throw new Error(`unsupported JSON pointer: ${pointer}`)
  let value: unknown = document
  for (const segment of pointer.slice(2).split('/').map(decodeJsonPointerSegment)) {
    if (Array.isArray(value)) {
      const index = Number(segment)
      value = Number.isInteger(index) ? value[index] : undefined
      continue
    }
    if (isRecord(value)) {
      value = value[segment]
      continue
    }
    return undefined
  }
  return value
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~')
}

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function printUsage(): void {
  console.error(`Usage:
  pnpm schema:typespec-check [-- --manifest <path>] [--expected-openapi <path>] [--production-openapi <path>]

Options:
  --manifest <path>            TypeSpec bundle manifest. Defaults to packages/schemas/typespec/oa-sdk.typespec-bundle.json.
  --expected-openapi <path>    Bundle-local expected OpenAPI. Defaults to packages/schemas/typespec/expected.openapi.yaml.
  --production-openapi <path>  Current production OpenAPI artifact. Defaults to packages/schemas/src/.merged.yaml.
  --accepted-restored-drift <path>
                               Accepted restored-vs-production drift manifest. Defaults to packages/schemas/typespec/accepted-restored-drift.json.
  --report <path>              Write the underlying bundle-check report.
  --output <path>              Write the restored OpenAPI artifact.
  --keep                       Keep the temporary TypeSpec bundle workspace.
`)
}
