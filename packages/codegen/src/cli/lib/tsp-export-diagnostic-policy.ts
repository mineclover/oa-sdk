import { unescapeJsonPointerToken, type OasDocument } from '@oa-sdk/parser'
import type { TspExportDiagnostic } from './tsp-export.js'

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const

export type TspExportDiagnosticDisposition =
  | 'contract-bearing'
  | 'metadata-only'
  | 'externalized'
  | 'unclassified'

export type TspExportDiagnosticPolicy = {
  disposition: TspExportDiagnosticDisposition
  accepted: boolean
  owner: string
  rationale: string
}

/**
 * One policy is shared by direct export and round-trip gates. New exporter
 * loss modes default to unaccepted so a generated artifact cannot silently
 * become a contract source before an ownership decision is made.
 */
export function classifyTspExportDiagnostic(
  diagnostic: TspExportDiagnostic,
  sourceDocument: OasDocument,
): TspExportDiagnosticPolicy {
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
  if (diagnostic.code === 'request-body/examples-dropped') {
    return {
      disposition: 'externalized',
      accepted: true,
      owner: 'oa-sdk-openapi-example-sidecar',
      rationale: 'OA SDK request body media examples remain OpenAPI-owned request mock data and are restored through request-media-examples sidecar semantics.',
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
  if (diagnostic.code === 'parameter/querystring-unsupported') {
    return {
      disposition: 'contract-bearing',
      accepted: false,
      owner: 'tsp-export-querystring-mapping',
      rationale: 'OAS 3.2 querystring represents the full serialized query and cannot be replaced by a named TypeSpec @query parameter.',
    }
  }
  return {
    disposition: 'unclassified',
    accepted: false,
    owner: 'tsp-export',
    rationale: 'No accepted TypeSpec roundtrip policy is registered for this diagnostic code.',
  }
}

export function findUnacceptedTspExportDiagnostics(
  diagnostics: readonly TspExportDiagnostic[],
  sourceDocument: OasDocument,
): Array<TspExportDiagnostic & { policy: TspExportDiagnosticPolicy }> {
  return diagnostics
    .map(diagnostic => ({ ...diagnostic, policy: classifyTspExportDiagnostic(diagnostic, sourceDocument) }))
    .filter(diagnostic => !diagnostic.policy.accepted)
}

function securitySchemeNameFromPointer(pointer: string): string | null {
  const prefix = '#/components/securitySchemes/'
  if (!pointer.startsWith(prefix)) return null
  return unescapeJsonPointerToken(pointer.slice(prefix.length))
}

function isSecuritySchemeReferenced(document: OasDocument, schemeName: string): boolean {
  if (securityRequirementsUseScheme(document.security, schemeName)) return true
  for (const pathItem of Object.values(document.paths ?? {})) {
    if (!isRecord(pathItem)) continue
    const operations = pathItem as Record<string, unknown>
    for (const method of HTTP_METHODS) {
      const operation = operations[method]
      if (isRecord(operation) && securityRequirementsUseScheme(operation.security, schemeName)) return true
    }
  }
  return false
}

function securityRequirementsUseScheme(value: unknown, schemeName: string): boolean {
  return Array.isArray(value)
    && value.some(requirement => isRecord(requirement) && Object.prototype.hasOwnProperty.call(requirement, schemeName))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
