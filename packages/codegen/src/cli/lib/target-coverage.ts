import { resolve } from 'node:path'
import type { OasDocument } from '@oa-sdk/parser'
import { buildSpec } from './build-spec.js'
import { readYamlOrJsonDocument } from './definition-fragments.js'

export const TARGET_COVERAGE_SCHEMA_VERSION = 'oa-gen.target-coverage.v1'

export type TargetCoverageSourceKind =
  | 'openapi-artifact'
  | 'definition-target'
  | 'openapi-document'

export type TargetCoverageAssertionKind =
  | 'mustIncludePath'
  | 'mustExcludePath'

export type TargetCoverageFailureCode =
  | 'target-coverage/missing-required-path'
  | 'target-coverage/forbidden-path-emitted'

export type TargetCoverageSeverity = 'error'

export type TargetCoveragePathInput = string | readonly string[]

export type TargetCoverageOptions = {
  artifactPath?: string
  targetPath?: string
  fragmentsDir?: string
  document?: OasDocument
  documentPath?: string
  mustIncludePath?: TargetCoveragePathInput
  mustIncludePaths?: readonly string[]
  mustExcludePath?: TargetCoveragePathInput
  mustExcludePaths?: readonly string[]
}

export type TargetCoverageSource = {
  kind: TargetCoverageSourceKind
  path?: string
  targetName?: string
  targetPath?: string
  fragmentsDir?: string
}

export type TargetCoverageAssertionResult = {
  kind: TargetCoverageAssertionKind
  path: string
  passed: boolean
  code?: TargetCoverageFailureCode
  message?: string
}

export type TargetCoverageFailure = {
  code: TargetCoverageFailureCode
  severity: TargetCoverageSeverity
  message: string
  assertion: TargetCoverageAssertionKind
  path: string
  source: TargetCoverageSource
}

export type TargetCoverageSummary = {
  pathCount: number
  assertionCount: number
  failureCount: number
  missingRequiredPathCount: number
  forbiddenEmittedPathCount: number
  errors: number
}

export type TargetCoverageResult = {
  schemaVersion: typeof TARGET_COVERAGE_SCHEMA_VERSION
  valid: boolean
  source: TargetCoverageSource
  emittedPaths: string[]
  assertions: TargetCoverageAssertionResult[]
  failures: TargetCoverageFailure[]
  summary: TargetCoverageSummary
}

type LoadedTargetCoverageDocument = {
  document: OasDocument
  source: TargetCoverageSource
}

export function checkTargetCoverage(options: TargetCoverageOptions): TargetCoverageResult {
  const loaded = loadTargetCoverageDocument(options)
  const emittedPaths = collectEmittedPaths(loaded.document)
  const emittedPathSet = new Set(emittedPaths)
  const includeAssertions = normalizePathAssertions(options.mustIncludePath, options.mustIncludePaths)
  const excludeAssertions = normalizePathAssertions(options.mustExcludePath, options.mustExcludePaths)
  const assertions: TargetCoverageAssertionResult[] = []
  const failures: TargetCoverageFailure[] = []

  for (const path of includeAssertions) {
    if (emittedPathSet.has(path)) {
      assertions.push({ kind: 'mustIncludePath', path, passed: true })
      continue
    }

    const code = 'target-coverage/missing-required-path'
    const message = `Required path "${path}" is missing from ${sourceLabel(loaded.source)}.`
    assertions.push({
      kind: 'mustIncludePath',
      path,
      passed: false,
      code,
      message,
    })
    failures.push({
      code,
      severity: 'error',
      message,
      assertion: 'mustIncludePath',
      path,
      source: loaded.source,
    })
  }

  for (const path of excludeAssertions) {
    if (!emittedPathSet.has(path)) {
      assertions.push({ kind: 'mustExcludePath', path, passed: true })
      continue
    }

    const code = 'target-coverage/forbidden-path-emitted'
    const message = `Forbidden path "${path}" is emitted by ${sourceLabel(loaded.source)}.`
    assertions.push({
      kind: 'mustExcludePath',
      path,
      passed: false,
      code,
      message,
    })
    failures.push({
      code,
      severity: 'error',
      message,
      assertion: 'mustExcludePath',
      path,
      source: loaded.source,
    })
  }

  const summary: TargetCoverageSummary = {
    pathCount: emittedPaths.length,
    assertionCount: assertions.length,
    failureCount: failures.length,
    missingRequiredPathCount: failures
      .filter(failure => failure.code === 'target-coverage/missing-required-path')
      .length,
    forbiddenEmittedPathCount: failures
      .filter(failure => failure.code === 'target-coverage/forbidden-path-emitted')
      .length,
    errors: failures.length,
  }

  return {
    schemaVersion: TARGET_COVERAGE_SCHEMA_VERSION,
    valid: failures.length === 0,
    source: loaded.source,
    emittedPaths,
    assertions,
    failures,
    summary,
  }
}

export const analyzeTargetCoverage = checkTargetCoverage

export function formatTargetCoverageMarkdown(report: TargetCoverageResult): string {
  const lines = [
    '## Target Check',
    '',
    `Source: ${markdownText(sourceDetail(report.source))}`,
    `Summary: ${report.summary.assertionCount} assertions, ${report.summary.pathCount} emitted paths, ${report.summary.failureCount} failures.`,
    '',
    '### Assertions',
    ...assertionLines(report.assertions),
  ]

  lines.push(
    '',
    '### Failures',
    ...failureLines(report.failures),
  )

  return lines.join('\n')
}

function loadTargetCoverageDocument(options: TargetCoverageOptions): LoadedTargetCoverageDocument {
  const sourceCount = [
    options.artifactPath,
    options.targetPath,
    options.document,
  ].filter(value => value !== undefined).length

  if (sourceCount !== 1) {
    throw new Error('Target coverage requires exactly one of artifactPath, targetPath, or document.')
  }

  if (options.artifactPath !== undefined) {
    const artifactPath = resolve(process.cwd(), options.artifactPath)
    return {
      document: readYamlOrJsonDocument(artifactPath) as OasDocument,
      source: {
        kind: 'openapi-artifact',
        path: artifactPath,
      },
    }
  }

  if (options.targetPath !== undefined) {
    const targetPath = resolve(process.cwd(), options.targetPath)
    const result = buildSpec({
      targetPath,
      ...(options.fragmentsDir !== undefined ? { fragmentsDir: options.fragmentsDir } : {}),
      writeOutput: false,
    })
    if (!result.valid) {
      const errors = result.diagnostics
        .filter(diagnostic => diagnostic.severity === 'error')
        .map(diagnostic => diagnostic.code)
        .join(', ')
      throw new Error(`target OpenAPI build failed: ${errors || 'unknown error'}`)
    }

    const source: TargetCoverageSource = {
      kind: 'definition-target',
      targetName: result.summary.targetName,
      targetPath: result.summary.targetPath,
    }
    if (result.summary.fragmentsDir !== undefined) source.fragmentsDir = result.summary.fragmentsDir
    return {
      document: result.document,
      source,
    }
  }

  const source: TargetCoverageSource = {
    kind: 'openapi-document',
  }
  if (options.documentPath !== undefined) source.path = resolve(process.cwd(), options.documentPath)
  return {
    document: options.document as OasDocument,
    source,
  }
}

function collectEmittedPaths(document: OasDocument): string[] {
  const paths = document.paths
  if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return []
  return Object.keys(paths).sort((left, right) => left.localeCompare(right))
}

function normalizePathAssertions(
  singular: TargetCoveragePathInput | undefined,
  plural: readonly string[] | undefined,
): string[] {
  const paths: string[] = []
  if (typeof singular === 'string') paths.push(singular)
  else if (Array.isArray(singular)) paths.push(...singular)
  if (plural !== undefined) paths.push(...plural)
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

function sourceLabel(source: TargetCoverageSource): string {
  if (source.kind === 'definition-target') {
    return source.targetName !== undefined
      ? `Definition Builder target "${source.targetName}"`
      : 'Definition Builder target'
  }
  if (source.kind === 'openapi-artifact') return 'OpenAPI artifact'
  return 'OpenAPI document'
}

function sourceDetail(source: TargetCoverageSource): string {
  const detail = source.path ?? source.targetPath
  if (detail === undefined) return sourceLabel(source)
  return `${sourceLabel(source)} (${detail})`
}

function assertionLines(assertions: readonly TargetCoverageAssertionResult[]): string[] {
  if (assertions.length === 0) return ['None.']
  return [
    '| Result | Assertion | Path | Details |',
    '| --- | --- | --- | --- |',
    ...assertions.map(assertion => {
      const details = assertion.passed
        ? '-'
        : `${assertion.code ?? 'failed'}: ${assertion.message ?? 'failed'}`
      return `| ${assertion.passed ? 'PASS' : 'FAIL'} | ${assertion.kind} | \`${markdownCode(assertion.path)}\` | ${markdownText(details)} |`
    }),
  ]
}

function failureLines(failures: readonly TargetCoverageFailure[]): string[] {
  if (failures.length === 0) return ['None.']
  return [
    '| Code | Assertion | Path | Message |',
    '| --- | --- | --- | --- |',
    ...failures.map(failure => (
      `| \`${markdownCode(failure.code)}\` | ${failure.assertion} | \`${markdownCode(failure.path)}\` | ${markdownText(failure.message)} |`
    )),
  ]
}

function markdownText(value: unknown): string {
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
}

function markdownCode(value: unknown): string {
  return markdownText(value).replace(/`/g, '\\`')
}
