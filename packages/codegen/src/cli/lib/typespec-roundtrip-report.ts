import type { OasDocument } from '@oa-sdk/parser'
import type { TspExportDiagnostic, TspExportReport } from './tsp-export.js'
import type {
  TypeSpecCompatibilitySidecarCompareReport,
  TypeSpecCompatibilityRestoreReport,
  TypeSpecCompatibilitySidecar,
} from './typespec-sidecar.js'
import {
  classifyBreakingChanges,
  classifyNonBreakingChanges,
  type ContractDiffChange,
  type DiffResult,
  type Endpoint,
} from './openapi-breaking-diff.js'

const REPORT_HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const

export type TypeSpecRoundtripEndpointChange = {
  method: string
  path: string
  operationId: string | null
}

export type TypeSpecRoundtripModifiedOperation = TypeSpecRoundtripEndpointChange & {
  changes: string[]
}

export type TypeSpecRoundtripDiagnosticDisposition =
  | 'contract-bearing'
  | 'metadata-only'
  | 'externalized'
  | 'unclassified'

export type TypeSpecRoundtripDiagnosticPolicy = {
  disposition: TypeSpecRoundtripDiagnosticDisposition
  accepted: boolean
  owner: string
  rationale: string
}

export type TypeSpecRoundtripDiagnostic = TspExportDiagnostic & {
  policy: TypeSpecRoundtripDiagnosticPolicy
}

export type TypeSpecRoundtripDiagnosticPolicySummary = {
  code: string
  count: number
  policy: TypeSpecRoundtripDiagnosticPolicy
}

export type TypeSpecRoundtripReport = {
  schemaVersion: 'oa-sdk.typespec-roundtrip-report.v1'
  namespace: string
  paths: {
    sourceOpenapi: string
    emittedOpenapi: string
    tspSource: string
    workspace: string
    bundleManifest?: string
    compatibilitySidecar?: string
    restoredOpenapi?: string
  }
  counts: {
    operations: {
      source: number
      emitted: number
    }
    componentSchemas: {
      source: number
      emitted: number
    }
    exportDiagnostics: number
    diff: {
      added: number
      removed: number
      modified: number
      breaking: number
      nonBreaking: number
    }
    compatibilitySidecar?: TypeSpecCompatibilitySidecar['counts']
  }
  validation: {
    valid: boolean
    summary: string
  }
  diagnosticsByCode: Array<{
    code: string
    count: number
  }>
  diagnosticsByPolicy: Array<{
    disposition: TypeSpecRoundtripDiagnosticDisposition
    accepted: boolean
    count: number
  }>
  diagnosticPolicies: TypeSpecRoundtripDiagnosticPolicySummary[]
  diagnostics: TypeSpecRoundtripDiagnostic[]
  changedOperations: {
    added: TypeSpecRoundtripEndpointChange[]
    removed: TypeSpecRoundtripEndpointChange[]
    modified: TypeSpecRoundtripModifiedOperation[]
  }
  changes: {
    breaking: ContractDiffChange[]
    nonBreaking: ContractDiffChange[]
  }
  compatibilitySidecar?: {
    counts: TypeSpecCompatibilitySidecar['counts']
    reExtractedCounts: TypeSpecCompatibilitySidecar['counts']
    restore: TypeSpecCompatibilityRestoreReport
    stability: TypeSpecCompatibilitySidecarCompareReport
    validation: {
      valid: boolean
      summary: string
    }
    diff: {
      added: number
      removed: number
      modified: number
      breaking: number
      nonBreaking: number
    }
    changes: {
      breaking: ContractDiffChange[]
      nonBreaking: ContractDiffChange[]
    }
  }
  gates: {
    breakingDiff: 'pass' | 'fail'
    exportDiagnostics: 'pass' | 'fail'
    compatibilitySidecar?: 'pass' | 'fail'
  }
}

export type CreateTypeSpecRoundtripReportInput = {
  namespace: string
  sourceOpenapiPath: string
  emittedOpenapiPath: string
  tspSourcePath: string
  bundleManifestPath?: string
  workspacePath: string
  sourceDocument: OasDocument
  emittedDocument: OasDocument
  exportReport: TspExportReport
  diff: DiffResult
  validation: {
    valid: boolean
    summary: string
  }
  compatibilitySidecar?: {
    sidecarPath: string
    restoredOpenapiPath: string
    sidecar: TypeSpecCompatibilitySidecar
    reExtractedSidecar: TypeSpecCompatibilitySidecar
    restoreReport: TypeSpecCompatibilityRestoreReport
    stabilityReport: TypeSpecCompatibilitySidecarCompareReport
    restoredDiff: DiffResult
    validation: {
      valid: boolean
      summary: string
    }
  }
}

export function createTypeSpecRoundtripReport(
  input: CreateTypeSpecRoundtripReportInput,
): TypeSpecRoundtripReport {
  const breakingChanges = classifyBreakingChanges(input.diff)
  const nonBreakingChanges = classifyNonBreakingChanges(input.diff)
  const restoredBreakingChanges = input.compatibilitySidecar
    ? classifyBreakingChanges(input.compatibilitySidecar.restoredDiff)
    : []
  const restoredNonBreakingChanges = input.compatibilitySidecar
    ? classifyNonBreakingChanges(input.compatibilitySidecar.restoredDiff)
    : []
  const diagnostics = input.exportReport.diagnostics.map(diagnostic => ({
    ...diagnostic,
    policy: classifyExportDiagnostic(diagnostic, input.sourceDocument),
  }))
  return {
    schemaVersion: 'oa-sdk.typespec-roundtrip-report.v1',
    namespace: input.namespace,
    paths: {
      sourceOpenapi: input.sourceOpenapiPath,
      emittedOpenapi: input.emittedOpenapiPath,
      tspSource: input.tspSourcePath,
      workspace: input.workspacePath,
      ...(input.bundleManifestPath ? { bundleManifest: input.bundleManifestPath } : {}),
      ...(input.compatibilitySidecar
        ? {
            compatibilitySidecar: input.compatibilitySidecar.sidecarPath,
            restoredOpenapi: input.compatibilitySidecar.restoredOpenapiPath,
          }
        : {}),
    },
    counts: {
      operations: {
        source: countDocumentOperations(input.sourceDocument),
        emitted: countDocumentOperations(input.emittedDocument),
      },
      componentSchemas: {
        source: Object.keys(input.sourceDocument.components?.schemas ?? {}).length,
        emitted: Object.keys(input.emittedDocument.components?.schemas ?? {}).length,
      },
      exportDiagnostics: input.exportReport.counts.diagnostics,
      diff: {
        added: input.diff.added.length,
        removed: input.diff.removed.length,
        modified: input.diff.modified.length,
        breaking: breakingChanges.length,
        nonBreaking: nonBreakingChanges.length,
      },
      ...(input.compatibilitySidecar ? { compatibilitySidecar: input.compatibilitySidecar.sidecar.counts } : {}),
    },
    validation: input.validation,
    diagnosticsByCode: groupDiagnosticsByCode(input.exportReport.diagnostics),
    diagnosticsByPolicy: groupDiagnosticsByPolicy(diagnostics),
    diagnosticPolicies: groupDiagnosticPolicies(diagnostics),
    diagnostics,
    changedOperations: {
      added: input.diff.added.map(endpointSummary),
      removed: input.diff.removed.map(endpointSummary),
      modified: input.diff.modified.map(({ head, changes }) => ({
        ...endpointSummary(head),
        changes,
      })),
    },
    changes: {
      breaking: breakingChanges,
      nonBreaking: nonBreakingChanges,
    },
    ...(input.compatibilitySidecar
      ? {
          compatibilitySidecar: {
            counts: input.compatibilitySidecar.sidecar.counts,
            reExtractedCounts: input.compatibilitySidecar.reExtractedSidecar.counts,
            restore: input.compatibilitySidecar.restoreReport,
            stability: input.compatibilitySidecar.stabilityReport,
            validation: input.compatibilitySidecar.validation,
            diff: {
              added: input.compatibilitySidecar.restoredDiff.added.length,
              removed: input.compatibilitySidecar.restoredDiff.removed.length,
              modified: input.compatibilitySidecar.restoredDiff.modified.length,
              breaking: restoredBreakingChanges.length,
              nonBreaking: restoredNonBreakingChanges.length,
            },
            changes: {
              breaking: restoredBreakingChanges,
              nonBreaking: restoredNonBreakingChanges,
            },
          },
        }
      : {}),
    gates: {
      breakingDiff: breakingChanges.length > 0 ? 'fail' : 'pass',
      exportDiagnostics: diagnostics.some(diagnostic => !diagnostic.policy.accepted) ? 'fail' : 'pass',
      ...(input.compatibilitySidecar
        ? {
            compatibilitySidecar: input.compatibilitySidecar.validation.valid
              && restoredBreakingChanges.length === 0
              && input.compatibilitySidecar.restoreReport.counts.missingTargets === 0
              && input.compatibilitySidecar.stabilityReport.counts.missingExpected === 0
              && input.compatibilitySidecar.stabilityReport.counts.unexpectedActual === 0
              && input.compatibilitySidecar.stabilityReport.counts.valueMismatches === 0
              ? 'pass'
              : 'fail',
          }
        : {}),
    },
  }
}

export function groupDiagnosticsByCode(
  diagnostics: readonly TspExportDiagnostic[],
): Array<{ code: string; count: number }> {
  const counts = new Map<string, number>()
  for (const diagnostic of diagnostics) {
    counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1)
  }
  return [...counts]
    .map(([code, count]) => ({ code, count }))
    .sort((left, right) => left.code.localeCompare(right.code))
}

export function groupDiagnosticsByPolicy(
  diagnostics: readonly TypeSpecRoundtripDiagnostic[],
): Array<{ disposition: TypeSpecRoundtripDiagnosticDisposition; accepted: boolean; count: number }> {
  const counts = new Map<string, { disposition: TypeSpecRoundtripDiagnosticDisposition; accepted: boolean; count: number }>()
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.policy.accepted}:${diagnostic.policy.disposition}`
    const current = counts.get(key)
    if (current) {
      current.count += 1
    } else {
      counts.set(key, {
        disposition: diagnostic.policy.disposition,
        accepted: diagnostic.policy.accepted,
        count: 1,
      })
    }
  }
  return [...counts.values()].sort((left, right) => {
    if (left.accepted !== right.accepted) return left.accepted ? 1 : -1
    return left.disposition.localeCompare(right.disposition)
  })
}

export function groupDiagnosticPolicies(
  diagnostics: readonly TypeSpecRoundtripDiagnostic[],
): TypeSpecRoundtripDiagnosticPolicySummary[] {
  const grouped = new Map<string, TypeSpecRoundtripDiagnosticPolicySummary>()
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.code,
      diagnostic.policy.disposition,
      diagnostic.policy.accepted,
      diagnostic.policy.owner,
      diagnostic.policy.rationale,
    ].join('\0')
    const current = grouped.get(key)
    if (current) {
      current.count += 1
    } else {
      grouped.set(key, {
        code: diagnostic.code,
        count: 1,
        policy: diagnostic.policy,
      })
    }
  }
  return [...grouped.values()].sort((left, right) => left.code.localeCompare(right.code))
}

function classifyExportDiagnostic(
  diagnostic: TspExportDiagnostic,
  sourceDocument: OasDocument,
): TypeSpecRoundtripDiagnosticPolicy {
  if (diagnostic.code === 'parameter/examples-dropped') {
    return {
      disposition: 'externalized',
      accepted: true,
      owner: 'oa-sdk-openapi-example-sidecar',
      rationale: 'OA SDK parameter examples can carry OpenAPI 3.2 dataValue and serializedValue semantics that TypeSpec examples cannot preserve together without changing mock/client behavior.',
    }
  }
  if (diagnostic.code === 'response/examples-dropped') {
    return {
      disposition: 'externalized',
      accepted: true,
      owner: 'oa-sdk-openapi-example-sidecar',
      rationale: 'OA SDK response media examples remain OpenAPI-owned runtime mock data so examples/default/generateMinimal priority is not weakened by TypeSpec projection.',
    }
  }
  if (diagnostic.code === 'components/security-scheme-dropped') {
    const schemeName = securitySchemeNameFromPointer(diagnostic.pointer)
    if (schemeName && !isSecuritySchemeReferenced(sourceDocument, schemeName)) {
      return {
        disposition: 'metadata-only',
        accepted: true,
        owner: 'openapi-security-component-metadata',
        rationale: 'The dropped security scheme component is not referenced by root or operation security; used auth requirements are tracked separately by operation/security-dropped.',
      }
    }
    return {
      disposition: 'contract-bearing',
      accepted: false,
      owner: 'tsp-export-auth-mapping',
      rationale: 'A referenced security scheme that is not emitted can change operation auth semantics.',
    }
  }
  if (diagnostic.code === 'operation/security-dropped') {
    return {
      disposition: 'contract-bearing',
      accepted: false,
      owner: 'tsp-export-auth-mapping',
      rationale: 'Operation-level security requirements are request contract semantics.',
    }
  }
  return {
    disposition: 'unclassified',
    accepted: false,
    owner: 'tsp-export',
    rationale: 'No accepted TypeSpec roundtrip policy is registered for this diagnostic code.',
  }
}

function countDocumentOperations(document: OasDocument): number {
  return Object.values(document.paths ?? {}).reduce(
    (count, pathItem) => count + countOperations(pathItem),
    0,
  )
}

function countOperations(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const pathItem = value as Record<string, unknown>
  return REPORT_HTTP_METHODS.reduce(
    (count, method) => count + (pathItem[method] ? 1 : 0),
    0,
  )
}

function endpointSummary(endpoint: Endpoint): TypeSpecRoundtripEndpointChange {
  return {
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
    operationId: endpoint.operationId ?? null,
  }
}

function securitySchemeNameFromPointer(pointer: string): string | null {
  const prefix = '#/components/securitySchemes/'
  if (!pointer.startsWith(prefix)) return null
  return unescapeJsonPointer(pointer.slice(prefix.length))
}

function isSecuritySchemeReferenced(document: OasDocument, schemeName: string): boolean {
  if (securityRequirementsUseScheme(document.security, schemeName)) return true
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!isRecord(pathItem)) continue
    const operations = pathItem as Record<string, unknown>
    for (const method of REPORT_HTTP_METHODS) {
      const operation = operations[method]
      if (isRecord(operation) && securityRequirementsUseScheme(operation.security, schemeName)) return true
    }
  }
  return false
}

function securityRequirementsUseScheme(value: unknown, schemeName: string): boolean {
  if (!Array.isArray(value)) return false
  return value.some(requirement => isRecord(requirement) && Object.prototype.hasOwnProperty.call(requirement, schemeName))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unescapeJsonPointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~')
}
