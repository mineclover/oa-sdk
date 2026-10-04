import { escapeJsonPointerToken, formatJsonPointer, type OasDocument, type OasOperation } from '@oa-sdk/parser'
import type {
  TypeSpecOpenApiExtensionSchemaVersion,
} from './typespec-extension-schema-version.js'
import type {
  TypeSpecCompatibilitySidecar,
  TypeSpecCompatibilitySidecarEntry,
} from './typespec-sidecar.js'
import { createTypeSpecCompatibilitySidecarFromEntries } from './typespec-sidecar.js'

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace' | 'query'

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']
const COMPONENTS_EXTENSION = 'x-oa-sdk-components'
const INFO_EXTENSION = 'x-oa-sdk-info'
const OPERATION_COMPONENT_REFS_EXTENSION = 'x-oa-sdk-operation-component-refs'
const OPERATION_EXAMPLES_EXTENSION = 'x-oa-sdk-operation-examples'
const OPERATION_SECURITY_EXTENSION = 'x-oa-sdk-operation-security'
const SECURITY_SCHEMES_EXTENSION = 'x-oa-sdk-security-schemes'
const DEFAULT_EXTENSION_SCHEMA_VERSION: TypeSpecOpenApiExtensionSchemaVersion = 'oa-sdk.typespec-extensions.v5'

export type {
  TypeSpecOpenApiExtensionSchemaVersion,
} from './typespec-extension-schema-version.js'

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
  if (supportsRootInfo(schemaVersion)) {
    const infoEntry = collectInfoEntry(document)
    if (infoEntry) entries.push(infoEntry)
  }
  if (supportsReusableComponents(schemaVersion)) {
    entries.push(...collectReusableComponentEntries(document))
  }
  entries.push(...collectSecuritySchemeEntries(document))
  if (supportsOperationSecurity(schemaVersion)) {
    entries.push(...collectOperationSecurityEntries(document))
  }
  entries.push(...collectOperationExampleEntries(document, schemaVersion))
  return createTypeSpecCompatibilitySidecarFromEntries(entries)
}

export function stripTypeSpecOpenApiExtensions(document: OasDocument): OasDocument {
  const stripped = cloneJson(document) as OasDocument
  delete (stripped as Record<string, unknown>)[COMPONENTS_EXTENSION]
  delete (stripped as Record<string, unknown>)[INFO_EXTENSION]
  delete (stripped as Record<string, unknown>)[SECURITY_SCHEMES_EXTENSION]
  for (const pathItemValue of Object.values(stripped.paths ?? {})) {
    if (!isRecord(pathItemValue)) continue
    const pathItem = pathItemValue as Record<string, unknown>
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (isRecord(operation)) {
        delete operation[OPERATION_EXAMPLES_EXTENSION]
        delete operation[OPERATION_COMPONENT_REFS_EXTENSION]
        delete operation[OPERATION_SECURITY_EXTENSION]
      }
    }
  }
  return stripped
}

function supportsRootInfo(schemaVersion: TypeSpecOpenApiExtensionSchemaVersion): boolean {
  return schemaVersion === 'oa-sdk.typespec-extensions.v5'
}

function supportsReusableComponents(schemaVersion: TypeSpecOpenApiExtensionSchemaVersion): boolean {
  return schemaVersion === 'oa-sdk.typespec-extensions.v5'
}

function supportsOperationSecurity(schemaVersion: TypeSpecOpenApiExtensionSchemaVersion): boolean {
  return schemaVersion === 'oa-sdk.typespec-extensions.v5'
}

function supportsRequestExamples(schemaVersion: TypeSpecOpenApiExtensionSchemaVersion): boolean {
  return schemaVersion === 'oa-sdk.typespec-extensions.v5'
}

function collectInfoEntry(document: OasDocument): TypeSpecCompatibilitySidecarEntry | null {
  const extension = (document as Record<string, unknown>)[INFO_EXTENSION]
  if (!isRecord(extension)) return null
  const title = typeof extension.title === 'string' && extension.title.trim() !== ''
    ? extension.title
    : document.info.title
  const version = typeof extension.version === 'string' && extension.version.trim() !== ''
    ? extension.version
    : document.info.version
  return {
    kind: 'root-info',
    pointer: `#/${escapeJsonPointerToken(INFO_EXTENSION)}`,
    target: {
      pointer: '#/info',
    },
    value: {
      ...cloneJson(extension),
      title,
      version,
    },
  }
}

function collectReusableComponentEntries(document: OasDocument): TypeSpecCompatibilitySidecarEntry[] {
  const extension = (document as Record<string, unknown>)[COMPONENTS_EXTENSION]
  if (!isRecord(extension)) return []
  return [
    ...collectNamedComponentEntries(extension.parameters, 'parameters', 'component-parameter'),
    ...collectNamedComponentEntries(extension.responses, 'responses', 'component-response'),
  ]
}

function collectNamedComponentEntries(
  value: unknown,
  section: 'parameters' | 'responses',
  kind: 'component-parameter' | 'component-response',
): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const { name, value: componentValue, pointerPart } of readNamedComponentItems(value)) {
    entries.push({
      kind,
      pointer: `#/${escapeJsonPointerToken(COMPONENTS_EXTENSION)}/${section}/${pointerPart}`,
      target: { name },
      value: denormalizeOpenApiExtensionValue(componentValue),
    } as TypeSpecCompatibilitySidecarEntry)
  }
  return entries
}

function readNamedComponentItems(value: unknown): Array<{ name: string; value: unknown; pointerPart: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (!isRecord(item) || typeof item.name !== 'string' || item.name.trim() === '' || !isRecord(item.value)) return []
      return [{
        name: item.name,
        value: item.value,
        pointerPart: String(index),
      }]
    })
  }
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([name, item]) => {
    if (!isRecord(item)) return []
    return [{
      name,
      value: item,
      pointerPart: escapeJsonPointerToken(name),
    }]
  })
}

function collectSecuritySchemeEntries(document: OasDocument): TypeSpecCompatibilitySidecarEntry[] {
  const extension = (document as Record<string, unknown>)[SECURITY_SCHEMES_EXTENSION]
  if (!isRecord(extension)) return []
  return Object.entries(extension).map(([name, value]) => ({
    kind: 'security-scheme',
    pointer: `#/${escapeJsonPointerToken(SECURITY_SCHEMES_EXTENSION)}/${escapeJsonPointerToken(name)}`,
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
        pointer: `#/paths/${escapeJsonPointerToken(path)}/${method}/${escapeJsonPointerToken(OPERATION_SECURITY_EXTENSION)}`,
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
      if (supportsReusableComponents(schemaVersion)) {
        entries.push(...collectOperationComponentRefEntries(
          (operation as Record<string, unknown>)[OPERATION_COMPONENT_REFS_EXTENSION],
          path,
          method,
        ))
      }
      const extension = (operation as Record<string, unknown>)[OPERATION_EXAMPLES_EXTENSION]
      if (!isRecord(extension)) continue
      entries.push(...collectParameterExampleEntries(extension.parameters, path, method))
      if (supportsRequestExamples(schemaVersion)) {
        entries.push(...collectRequestExampleEntries(extension.requestBody, path, method))
      }
      entries.push(...collectResponseExampleEntries(extension.responses, path, method))
    }
  }
  return entries
}

function collectOperationComponentRefEntries(
  value: unknown,
  path: string,
  method: HttpMethod,
): TypeSpecCompatibilitySidecarEntry[] {
  if (!isRecord(value)) return []
  return [
    ...collectOperationParameterRefEntries(value.parameters, path, method),
    ...collectOperationResponseRefEntries(value.responses, path, method),
  ]
}

function collectOperationParameterRefEntries(
  value: unknown,
  path: string,
  method: HttpMethod,
): TypeSpecCompatibilitySidecarEntry[] {
  if (!Array.isArray(value)) return []
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [index, item] of value.entries()) {
    const parameterIndex = isRecord(item) ? item.index : undefined
    if (!isRecord(item) || typeof parameterIndex !== 'number' || !Number.isInteger(parameterIndex) || parameterIndex < 0 || typeof item.ref !== 'string') continue
    if (!item.ref.startsWith('#/components/parameters/')) continue
    entries.push({
      kind: 'operation-parameter-ref',
      pointer: `#/paths/${escapeJsonPointerToken(path)}/${method}/${escapeJsonPointerToken(OPERATION_COMPONENT_REFS_EXTENSION)}/parameters/${index}`,
      target: {
        path,
        method,
        index: parameterIndex,
      },
      value: {
        $ref: item.ref,
      },
    })
  }
  return entries
}

function collectOperationResponseRefEntries(
  value: unknown,
  path: string,
  method: HttpMethod,
): TypeSpecCompatibilitySidecarEntry[] {
  if (!Array.isArray(value)) return []
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || typeof item.statusCode !== 'string' || typeof item.ref !== 'string') continue
    if (!item.ref.startsWith('#/components/responses/')) continue
    entries.push({
      kind: 'operation-response-ref',
      pointer: `#/paths/${escapeJsonPointerToken(path)}/${method}/${escapeJsonPointerToken(OPERATION_COMPONENT_REFS_EXTENSION)}/responses/${index}`,
      target: {
        path,
        method,
        statusCode: item.statusCode,
      },
      value: {
        $ref: item.ref,
      },
    })
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
      pointer: `#/paths/${escapeJsonPointerToken(path)}/${method}/${escapeJsonPointerToken(OPERATION_EXAMPLES_EXTENSION)}/parameters/${escapeJsonPointerToken(fallbackName)}`,
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
  return `#/paths/${escapeJsonPointerToken(path)}/${method}/${escapeJsonPointerToken(OPERATION_EXAMPLES_EXTENSION)}/${section}${formatJsonPointer(pointerParts)}`
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

function denormalizeOpenApiExtensionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(denormalizeOpenApiExtensionValue)
  if (!isRecord(value)) return cloneJson(value)

  if (typeof value.ref === 'string' && Object.keys(value).length === 1) {
    return { $ref: value.ref }
  }

  const normalized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'content') {
      const content = denormalizeNamedValueArray(item, 'mediaType')
      normalized.content = content ?? denormalizeOpenApiExtensionValue(item)
      continue
    }
    if (key === 'headers') {
      const headers = denormalizeNamedValueArray(item, 'name')
      normalized.headers = headers ?? denormalizeOpenApiExtensionValue(item)
      continue
    }
    normalized[key] = denormalizeOpenApiExtensionValue(item)
  }
  return normalized
}

function denormalizeNamedValueArray(value: unknown, nameKey: 'mediaType' | 'name'): Record<string, unknown> | null {
  if (!Array.isArray(value)) return null
  const output: Record<string, unknown> = {}
  for (const item of value) {
    if (!isRecord(item) || typeof item[nameKey] !== 'string' || item[nameKey].trim() === '') continue
    output[item[nameKey]] = denormalizeOpenApiExtensionValue(item.value)
  }
  return output
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
