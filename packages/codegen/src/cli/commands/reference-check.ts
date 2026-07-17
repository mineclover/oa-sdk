import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Command } from '../lib/types.js'
import { loadSpecWithPath } from '../lib/load-spec.js'
import { bool, optStr, str } from '../lib/args.js'
import { CliExitError } from '../lib/errors.js'
import {
  APITOMY_DATA_MODELS_PACKAGE,
  createApitomyReferenceAdapter,
  loadApitomyDataModels,
  type ApitomyReferenceComparison,
} from '../../apitomy/index.js'

type ReferenceCheckFormat = 'json' | 'markdown'

export type ApitomyReferenceCheckReport = {
  schemaVersion: 'oa-gen.apitomy-reference.v1'
  authoritative: 'oa-sdk'
  reference: 'apitomy'
  specPath: string
  status: ApitomyReferenceComparison['status']
  primary: ApitomyReferenceComparison['primary']
  referenceDiagnostics: ApitomyReferenceComparison['reference']['diagnostics']
  primaryOnly: ApitomyReferenceComparison['primaryOnly']
  referenceOnly: ApitomyReferenceComparison['referenceOnly']
  differences: ApitomyReferenceComparison['differences']
  metadata: ApitomyReferenceComparison['metadata']
  serialization: ApitomyReferenceComparison['serialization']
}

export const referenceCheck: Command = {
  name: 'reference-check',
  description: 'Apitomy를 비권위적 reference로 사용해 oa-sdk 검증 결과를 비교',
  options: {
    spec: { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    'require-32': { type: 'boolean', description: 'oa-sdk 관리 계약으로 OpenAPI 3.2.x 버전을 강제' },
    format: { type: 'string', short: 'f', description: '출력 형식 (markdown 또는 json)' },
  },
  async run(args) {
    const loaded = loadSpecWithPath(str(args, 'spec'))
    const module = await loadApitomyDataModels()
    const adapter = createApitomyReferenceAdapter(module.Library, {
      requireOpenApi32: bool(args, 'require-32'),
    })
    const providerVersion = resolveApitomyVersion(module)
    const comparison = adapter.compareValidation(adapter.read(loaded.raw), {
      validation: {
        basePath: loaded.path,
        ...(bool(args, 'require-32') ? { requireOpenApi32: true } : {}),
      },
      inputHash: hashInput(loaded.raw),
      sourceDocument: loaded.document,
      ...(providerVersion ? { providerVersion } : {}),
    })
    const report = createReport(loaded.path, comparison)
    const format = readFormat(optStr(args, 'format'))

    if (format === 'json') {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(formatMarkdown(report))
    }

    // A reference divergence is informational. Only the oa-sdk primary result
    // controls the command's validation exit status.
    if (!comparison.primary.valid) throw new CliExitError(1)
  },
}

export function createReport(
  specPath: string,
  comparison: ApitomyReferenceComparison,
): ApitomyReferenceCheckReport {
  return {
    schemaVersion: 'oa-gen.apitomy-reference.v1',
    authoritative: 'oa-sdk',
    reference: 'apitomy',
    specPath,
    status: comparison.status,
    primary: comparison.primary,
    referenceDiagnostics: comparison.reference.diagnostics,
    primaryOnly: comparison.primaryOnly,
    referenceOnly: comparison.referenceOnly,
    differences: comparison.differences,
    metadata: comparison.metadata,
    serialization: comparison.serialization,
  }
}

export function formatMarkdown(report: ApitomyReferenceCheckReport): string {
  const primaryStatus = report.primary.valid ? 'Valid' : 'Invalid'
  const lines = [
    '━━━ Apitomy reference check ━━━',
    `authoritative: ${report.authoritative}`,
    `reference: ${report.reference}`,
    `status: ${report.status}`,
    `oa-sdk: ${primaryStatus} — ${report.primary.errors.length} errors, ${report.primary.warnings.length} warnings, ${report.primary.infos.length} infos`,
    `Apitomy reference diagnostics: ${report.referenceDiagnostics.length}`,
    `primary-only: ${report.primaryOnly.length}`,
    `reference-only: ${report.referenceOnly.length}`,
    `metadata: ${report.metadata.providerPackage}@${report.metadata.providerVersion ?? 'unknown'} / ${report.metadata.documentVersion ?? 'unknown'}`,
    `input-hash: ${report.metadata.inputHash ?? 'not-provided'}`,
    `serialization: ${report.serialization.checked ? (report.serialization.equal ? 'preserved' : 'loss-detected') : 'not-checked'}`,
  ]

  const nonSemanticDifferences = report.differences.filter(difference => difference.kind !== 'semantic-match')
  for (const difference of nonSemanticDifferences) {
    const diagnostic = difference.primary ?? difference.reference
    const location = diagnostic?.path ?? difference.path ?? '/'
    const message = diagnostic?.message ?? difference.message ?? difference.kind
    lines.push(`  [${difference.kind}] ${location} ${message}`)
  }

  return lines.join('\n')
}

function readFormat(format: string | undefined): ReferenceCheckFormat {
  if (format === undefined || format === 'markdown') return 'markdown'
  if (format === 'json') return 'json'
  throw new Error(`unsupported reference-check format: ${format}`)
}

function hashInput(input: string): string {
  return `sha256:${createHash('sha256').update(input).digest('hex')}`
}

function resolveApitomyVersion(moduleValue: unknown): string | undefined {
  if (isRecord(moduleValue) && typeof moduleValue.version === 'string') {
    return moduleValue.version
  }

  try {
    const require = createRequire(import.meta.url)
    const entryPath = require.resolve(APITOMY_DATA_MODELS_PACKAGE)
    const packagePath = join(dirname(entryPath), '..', 'package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
    return typeof packageJson.version === 'string' ? packageJson.version : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
