import type { OasDocument, OasOperation } from '@oa-sdk/parser'
import type {
  TypeSpecCompatibilitySidecar,
  TypeSpecCompatibilitySidecarEntry,
} from './typespec-sidecar.js'
import { createTypeSpecCompatibilitySidecarFromEntries } from './typespec-sidecar.js'

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace' | 'query'

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']
const OPERATION_EXAMPLES_EXTENSION = 'x-oa-sdk-operation-examples'
const OPERATION_SECURITY_EXTENSION = 'x-oa-sdk-operation-security'
const SECURITY_SCHEMES_EXTENSION = 'x-oa-sdk-security-schemes'
const DEFAULT_EXTENSION_SCHEMA_VERSION: TypeSpecOpenApiExtensionSchemaVersion = 'oa-sdk.typespec-extensions.v1'

export type TypeSpecOpenApiExtensionSchemaVersion =
  | 'oa-sdk.typespec-extensions.v1'
  | 'oa-sdk.typespec-extensions.v2'
  | 'oa-sdk.typespec-extensions.v3'

export type TypeSpecOpenApiExtensionRestoreResult = {
  document: OasDocument
  sidecar: TypeSpecCompatibilitySidecar
}

export function createTypeSpecCompatibilitySidecarFromOpenApiExtensions(
  document: OasDocument,
  options: { schemaVersion?: TypeSpecOpenApiExtensionSchemaVersion } = {},
): TypeSpecCompatibilitySidecar {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  const schemaVersion = options.schemaVersion ?? DEFAULT_EXTENSION_SCHEMA_VERSION
  entries.push(...collectSecuritySchemeEntries(document))
  if (schemaVersion === 'oa-sdk.typespec-extensions.v3') {
    entries.push(...collectOperationSecurityEntries(document))
  }
  entries.push(...collectOperationExampleEntries(document, schemaVersion))
  return createTypeSpecCompatibilitySidecarFromEntries(entries)
}

export function stripTypeSpecOpenApiExtensions(document: OasDocument): OasDocument {
  const stripped = cloneJson(document) as OasDocument
  delete (stripped as Record<string, unknown>)[SECURITY_SCHEMES_EXTENSION]
  for (const pathItemValue of Object.values(stripped.paths ?? {})) {
    if (!isRecord(pathItemValue)) continue
    const pathItem = pathItemValue as Record<string, unknown>
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (isRecord(operation)) {
        delete operation[OPERATION_EXAMPLES_EXTENSION]
        delete operation[OPERATION_SECURITY_EXTENSION]
      }
    }
  }
  return stripped
}

function collectSecuritySchemeEntries(document: OasDocument): TypeSpecCompatibilitySidecarEntry[] {
  const extension = (document as Record<string, unknown>)[SECURITY_SCHEMES_EXTENSION]
  if (!isRecord(extension)) return []
  return Object.entries(extension).map(([name, value]) => ({
    kind: 'security-scheme',
    pointer: `#/${escapeJsonPointer(SECURITY_SCHEMES_EXTENSION)}/${escapeJsonPointer(name)}`,
    target: { name },
    value: normalizeSecurityScheme(value),
  }))
}

function collectOperationSecurityEntries(document: OasDocument): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [path, pathItemValue] of Object.entries(document.paths ?? {})) {
    if (!isRecord(pathItemValue)) continue
    const pathItem = pathItemValue as Record<string, unknown>
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OasOperation | undefined
      if (!isRecord(operation)) continue
      const extension = (operation as Record<string, unknown>)[OPERATION_SECURITY_EXTENSION]
      const value = readOperationSecurityValue(extension)
      if (!value) continue
      entries.push({
        kind: 'operation-security',
        pointer: `#/paths/${escapeJsonPointer(path)}/${method}/${escapeJsonPointer(OPERATION_SECURITY_EXTENSION)}`,
        target: {
          path,
          method,
        },
        value,
      })
    }
  }
  return entries
}

function collectOperationExampleEntries(
  document: OasDocument,
  schemaVersion: TypeSpecOpenApiExtensionSchemaVersion,
): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [path, pathItemValue] of Object.entries(document.paths ?? {})) {
    if (!isRecord(pathItemValue)) continue
    const pathItem = pathItemValue as Record<string, unknown>
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OasOperation | undefined
      if (!isRecord(operation)) continue
      const extension = (operation as Record<string, unknown>)[OPERATION_EXAMPLES_EXTENSION]
      if (!isRecord(extension)) continue
      entries.push(...collectParameterExampleEntries(extension.parameters, path, method))
      if (schemaVersion === 'oa-sdk.typespec-extensions.v2' || schemaVersion === 'oa-sdk.typespec-extensions.v3') {
        entries.push(...collectRequestExampleEntries(extension.requestBody, path, method))
      }
      entries.push(...collectResponseExampleEntries(extension.responses, path, method))
    }
  }
  return entries
}

function readOperationSecurityValue(value: unknown): [] | null {
  if (Array.isArray(value) && value.length === 0) return []
  if (isRecord(value) && Array.isArray(value.security) && value.security.length === 0) return []
  return null
}

function collectParameterExampleEntries(value: unknown, path: string, method: HttpMethod): TypeSpecCompatibilitySidecarEntry[] {
  if (!isRecord(value)) return []
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [fallbackName, parameterValue] of Object.entries(value)) {
    if (!isRecord(parameterValue)) continue
    const parameterName = typeof parameterValue.name === 'string' && parameterValue.name.trim() !== ''
      ? parameterValue.name
      : fallbackName
    const location = typeof parameterValue.in === 'string' && parameterValue.in.trim() !== ''
      ? parameterValue.in
      : 'query'
    const examples = readExampleValue(parameterValue)
    if (!examples) continue
    entries.push({
      kind: 'parameter-examples',
      pointer: `#/paths/${escapeJsonPointer(path)}/${method}/${escapeJsonPointer(OPERATION_EXAMPLES_EXTENSION)}/parameters/${escapeJsonPointer(fallbackName)}`,
      target: {
        path,
        method,
        name: parameterName,
        in: location,
      },
      value: examples,
    })
  }
  return entries
}

function collectRequestExampleEntries(value: unknown, path: string, method: HttpMethod): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  visitRecords(value, (record, pointerParts) => {
    const mediaType = typeof record.mediaType === 'string' && record.mediaType.trim() !== ''
      ? record.mediaType
      : undefined
    const examples = readExampleValue(record)
    if (!mediaType || !examples) return
    entries.push({
      kind: 'request-media-examples',
      pointer: operationExamplesPointer(path, method, 'requestBody', pointerParts),
      target: {
        path,
        method,
        mediaType,
      },
      value: examples,
    })
  })
  return entries
}

function collectResponseExampleEntries(value: unknown, path: string, method: HttpMethod): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  visitRecords(value, (record, pointerParts) => {
    const statusCode = typeof record.statusCode === 'string' || typeof record.statusCode === 'number'
      ? String(record.statusCode)
      : undefined
    const mediaType = typeof record.mediaType === 'string' && record.mediaType.trim() !== ''
      ? record.mediaType
      : undefined
    const examples = readExampleValue(record)
    if (!statusCode || !mediaType || !examples) return
    entries.push({
      kind: 'response-media-examples',
      pointer: operationExamplesPointer(path, method, 'responses', pointerParts),
      target: {
        path,
        method,
        statusCode,
        mediaType,
      },
      value: examples,
    })
  })
  return entries
}

function readExampleValue(record: Record<string, unknown>): { example?: unknown; examples?: unknown } | null {
  const result: { example?: unknown; examples?: unknown } = {}
  if (record.example !== undefined) result.example = cloneJson(record.example)
  if (record.examples !== undefined) result.examples = cloneJson(record.examples)
  return result.example !== undefined || result.examples !== undefined ? result : null
}

function visitRecords(value: unknown, visitor: (record: Record<string, unknown>, pointerParts: string[]) => void, pointerParts: string[] = []): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) visitRecords(item, visitor, [...pointerParts, String(index)])
    return
  }
  if (!isRecord(value)) return
  visitor(value, pointerParts)
  for (const [key, item] of Object.entries(value)) visitRecords(item, visitor, [...pointerParts, key])
}

function operationExamplesPointer(path: string, method: HttpMethod, section: string, pointerParts: string[]): string {
  const suffix = pointerParts.length > 0
    ? `/${pointerParts.map(escapeJsonPointer).join('/')}`
    : ''
  return `#/paths/${escapeJsonPointer(path)}/${method}/${escapeJsonPointer(OPERATION_EXAMPLES_EXTENSION)}/${section}${suffix}`
}

function normalizeSecurityScheme(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSecurityScheme)
  if (!isRecord(value)) return cloneJson(value)
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'scopes' && Array.isArray(item)) {
      normalized.scopes = normalizeScopeList(item)
      continue
    }
    normalized[key] = normalizeSecurityScheme(item)
  }
  return normalized
}

function normalizeScopeList(value: unknown[]): Record<string, string> {
  const scopes: Record<string, string> = {}
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string') continue
    const description = typeof item.description === 'string' ? item.description : ''
    scopes[item.name] = description
  }
  return scopes
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}
