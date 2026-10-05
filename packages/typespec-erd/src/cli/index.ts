#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { createLogicalErdReview, diffLogicalErdArtifacts, validateLogicalErdArtifact, validateLogicalErdArtifactSchema, type LogicalErdArtifact, type LogicalErdCatalogEvidence } from '@oa-sdk/logical-erd-contract'

const require = createRequire(import.meta.url)

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv
  if (!command || command === '--help' || command === '-h') {
    printHelp()
    return
  }
  if (command === 'emit') return emit(args)
  if (command === 'check') return check(args)
  if (command === 'diff') return diff(args)
  if (command === 'review') return review(args)
  throw new Error(`Unknown command: ${command}`)
}

function emit(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string', short: 'p' },
      output: { type: 'string', short: 'o' },
    },
  })
  const project = required(values.project, '--project')
  const output = values.output
  const directory = mkdtempSync(join(tmpdir(), 'oa-erd-emit-'))
  try {
    const compilerEntry = require.resolve('@typespec/compiler')
    const compilerRoot = resolve(dirname(compilerEntry), '../..')
    const compilerCli = join(compilerRoot, 'cmd', 'tsp.js')
    execFileSync(process.execPath, [compilerCli, 'compile', project, '--emit', '@oa-sdk/typespec-erd', '--output-dir', directory], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
    })
    const artifact = readFileSync(join(directory, '@oa-sdk', 'typespec-erd', 'logical-erd.json'), 'utf8')
    if (output) {
      writeFileSync(output, artifact)
      console.error(`✅ Logical ERD artifact: ${output}`)
    } else {
      process.stdout.write(artifact)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function check(argv: string[]): void {
  const { values } = parseArgs({ args: argv, options: { artifact: { type: 'string', short: 'a' } } })
  const path = required(values.artifact, '--artifact')
  const read = readArtifact(path)
  const diagnostics = read.ok ? semanticDiagnostics(read.artifact) : read.diagnostics
  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) console.error(diagnostic)
    process.exitCode = 1
    return
  }
  console.log(`✅ Logical ERD artifact is valid: ${path}`)
}

function diff(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      base: { type: 'string' },
      next: { type: 'string' },
      format: { type: 'string' },
      'fail-on-breaking': { type: 'boolean' },
    },
  })
  const report = diffLogicalErdArtifacts(
    readValidatedArtifact(required(values.base, '--base')),
    readValidatedArtifact(required(values.next, '--next')),
  )
  const format = values.format ?? 'markdown'
  if (format !== 'markdown' && format !== 'json') throw new Error(`--format must be markdown or json: ${format}`)
  console.log(format === 'json' ? JSON.stringify(report, null, 2) : formatDiff(report))
  if (values['fail-on-breaking'] && (report.summary.breaking > 0 || report.summary['potentially-breaking'] > 0)) process.exitCode = 1
}

function review(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      artifact: { type: 'string', short: 'a' },
      base: { type: 'string' },
      'catalog-evidence': { type: 'string' },
      format: { type: 'string' },
      output: { type: 'string', short: 'o' },
    },
  })
  const artifact = readValidatedArtifact(required(values.artifact, '--artifact'))
  const report = createLogicalErdReview({
    artifact,
    ...(values.base ? { base: readValidatedArtifact(values.base) } : {}),
    ...(values['catalog-evidence'] ? { catalogEvidence: readCatalogEvidence(values['catalog-evidence']) } : {}),
  })
  const format = values.format ?? 'markdown'
  if (format !== 'markdown' && format !== 'json') throw new Error(`--format must be markdown or json: ${format}`)
  const rendered = format === 'json' ? JSON.stringify(report, null, 2) : formatReview(report)
  if (values.output) {
    writeFileSync(values.output, `${rendered}\n`)
    console.error(`✅ Logical ERD review evidence: ${values.output}`)
  } else {
    console.log(rendered)
  }
}

type ArtifactRead =
  | { ok: true; artifact: LogicalErdArtifact }
  | { ok: false; diagnostics: string[] }

/** An artifact document checked against the portable v1 wire schema; violations become ERD-SCHEMA diagnostics. */
const LogicalErdArtifactDocument = {
  parse(value: unknown): ArtifactRead {
    const wireIssues = validateLogicalErdArtifactSchema(value)
    if (wireIssues.length > 0) {
      return {
        ok: false,
        diagnostics: wireIssues.map(issue => `ERD-SCHEMA ${issue.instancePath || '/'} ${issue.keyword}: ${issue.message}`),
      }
    }
    // The v1 wire schema is the JSON Schema form of LogicalErdArtifact.
    return { ok: true, artifact: value as LogicalErdArtifact }
  },
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type CatalogEvidenceStatus = LogicalErdCatalogEvidence['fields'][number]['status']

function isCatalogEvidenceStatus(value: unknown): value is CatalogEvidenceStatus {
  return value === 'confirmed' || value === 'mismatch' || value === 'unbound' || value === 'unknown'
}

/**
 * Catalog evidence document. Entry shapes and status values are checked here;
 * field references are checked against the artifact by createLogicalErdReview.
 */
const CatalogEvidenceDocument = {
  parse(value: unknown): LogicalErdCatalogEvidence {
    if (!isJsonObject(value) || typeof value.artifactId !== 'string' || !Array.isArray(value.fields)) {
      throw new Error('Catalog evidence must be an object with a string artifactId and a fields array')
    }
    const fields = value.fields.map((entry: unknown, index) => {
      if (!isJsonObject(entry) || typeof entry.logicalFieldId !== 'string' || typeof entry.status !== 'string' || typeof entry.reason !== 'string') {
        throw new Error(`Catalog evidence fields[${index}] must have string logicalFieldId, status, and reason`)
      }
      if (!isCatalogEvidenceStatus(entry.status)) throw new Error(`Unsupported catalog evidence status ${entry.status}.`)
      return { logicalFieldId: entry.logicalFieldId, status: entry.status, reason: entry.reason }
    })
    return { artifactId: value.artifactId, fields }
  },
}

function readArtifact(path: string): ArtifactRead {
  return LogicalErdArtifactDocument.parse(JSON.parse(readFileSync(path, 'utf8')))
}

function readCatalogEvidence(path: string): LogicalErdCatalogEvidence {
  return CatalogEvidenceDocument.parse(JSON.parse(readFileSync(path, 'utf8')))
}

function readValidatedArtifact(path: string): LogicalErdArtifact {
  const read = readArtifact(path)
  const diagnostics = read.ok ? semanticDiagnostics(read.artifact) : read.diagnostics
  if (!read.ok || diagnostics.length > 0) throw new Error(`Invalid logical ERD artifact ${path}:\n${diagnostics.join('\n')}`)
  return read.artifact
}

function semanticDiagnostics(artifact: LogicalErdArtifact): string[] {
  return validateLogicalErdArtifact(artifact).map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`)
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`)
  return value
}

function formatDiff(report: ReturnType<typeof diffLogicalErdArtifacts>): string {
  const lines = [
    '# Logical ERD diff',
    '',
    `- additive: ${report.summary.additive}`,
    `- non-breaking: ${report.summary['non-breaking']}`,
    `- potentially breaking: ${report.summary['potentially-breaking']}`,
    `- breaking: ${report.summary.breaking}`,
    '',
  ]
  for (const change of report.changes) lines.push(`- [${change.severity}] ${change.subject}:${change.id} — ${change.details}`)
  return lines.join('\n')
}

function formatReview(report: ReturnType<typeof createLogicalErdReview>): string {
  const lines = [
    '# Logical ERD review evidence',
    '',
    `- artifact: ${report.artifactId}`,
    `- provenance coverage: ${report.summary.provenanceCovered}/${report.summary.subjects}`,
    `- catalog evidence: confirmed=${report.summary.catalogEvidence.confirmed}, mismatch=${report.summary.catalogEvidence.mismatch}, unbound=${report.summary.catalogEvidence.unbound}, unknown=${report.summary.catalogEvidence.unknown}`,
  ]
  if (report.diff) {
    lines.push(`- diff: additive=${report.diff.summary.additive}, non-breaking=${report.diff.summary['non-breaking']}, potentially-breaking=${report.diff.summary['potentially-breaking']}, breaking=${report.diff.summary.breaking}`)
  }
  lines.push('', '## Subjects', '')
  for (const subject of report.subjects) {
    const provenance = subject.provenance.length > 0
      ? `${subject.provenance[0]!.span.file}:${subject.provenance[0]!.span.line}`
      : 'missing provenance'
    const catalog = subject.catalogEvidence ? `; catalog=${subject.catalogEvidence.status}` : ''
    lines.push(`- ${subject.subject} — ${provenance}${catalog}`)
  }
  return lines.join('\n')
}

function printHelp(): void {
  console.log(`oa-erd — TypeSpec logical ERD tooling

Commands:
  oa-erd emit --project <directory|main.tsp> [--output artifact.json]
  oa-erd check --artifact <artifact.json>
  oa-erd diff --base <artifact.json> --next <artifact.json> [--format markdown|json] [--fail-on-breaking]
  oa-erd review --artifact <artifact.json> [--base <artifact.json>] [--catalog-evidence <evidence.json>] [--format markdown|json] [--output review.md]`)
}

main(process.argv.slice(2)).catch(error => {
  console.error(`oa-erd error: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
