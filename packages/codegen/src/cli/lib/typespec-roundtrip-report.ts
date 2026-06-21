import type { OasDocument } from '@oa-sdk/parser'
import type { TspExportDiagnostic, TspExportReport } from './tsp-export.js'
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

export type TypeSpecRoundtripReport = {
  schemaVersion: 'oa-sdk.typespec-roundtrip-report.v1'
  namespace: string
  paths: {
    sourceOpenapi: string
    emittedOpenapi: string
    tspSource: string
    workspace: string
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
  }
  validation: {
    valid: boolean
    summary: string
  }
  diagnosticsByCode: Array<{
    code: string
    count: number
  }>
  changedOperations: {
    added: TypeSpecRoundtripEndpointChange[]
    removed: TypeSpecRoundtripEndpointChange[]
    modified: TypeSpecRoundtripModifiedOperation[]
  }
  changes: {
    breaking: ContractDiffChange[]
    nonBreaking: ContractDiffChange[]
  }
  gates: {
    breakingDiff: 'pass' | 'fail'
  }
}

export type CreateTypeSpecRoundtripReportInput = {
  namespace: string
  sourceOpenapiPath: string
  emittedOpenapiPath: string
  tspSourcePath: string
  workspacePath: string
  sourceDocument: OasDocument
  emittedDocument: OasDocument
  exportReport: TspExportReport
  diff: DiffResult
  validation: {
    valid: boolean
    summary: string
  }
}

export function createTypeSpecRoundtripReport(
  input: CreateTypeSpecRoundtripReportInput,
): TypeSpecRoundtripReport {
  const breakingChanges = classifyBreakingChanges(input.diff)
  const nonBreakingChanges = classifyNonBreakingChanges(input.diff)
  return {
    schemaVersion: 'oa-sdk.typespec-roundtrip-report.v1',
    namespace: input.namespace,
    paths: {
      sourceOpenapi: input.sourceOpenapiPath,
      emittedOpenapi: input.emittedOpenapiPath,
      tspSource: input.tspSourcePath,
      workspace: input.workspacePath,
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
    },
    validation: input.validation,
    diagnosticsByCode: groupDiagnosticsByCode(input.exportReport.diagnostics),
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
    gates: {
      breakingDiff: breakingChanges.length > 0 ? 'fail' : 'pass',
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
