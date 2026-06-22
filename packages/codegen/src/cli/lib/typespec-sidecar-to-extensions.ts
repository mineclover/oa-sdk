import {
  createTypeSpecCompatibilitySidecarFromEntries,
  type TypeSpecCompatibilitySidecar,
  type TypeSpecCompatibilitySidecarEntry,
  type TypeSpecOperationSecuritySidecarEntry,
  type TypeSpecParameterExamplesSidecarEntry,
  type TypeSpecRequestExamplesSidecarEntry,
  type TypeSpecResponseExamplesSidecarEntry,
  type TypeSpecSecuritySchemeSidecarEntry,
} from './typespec-sidecar.js'
import type { TypeSpecOpenApiExtensionSchemaVersion } from './typespec-oa-sdk-extensions.js'

type HttpMethod = TypeSpecRequestExamplesSidecarEntry['target']['method']
type RecordValue = Record<string, unknown>

const OPERATION_EXAMPLES_EXTENSION = 'x-oa-sdk-operation-examples'
const OPERATION_SECURITY_EXTENSION = 'x-oa-sdk-operation-security'
const SECURITY_SCHEMES_EXTENSION = 'x-oa-sdk-security-schemes'
const DEFAULT_EXTENSION_SCHEMA_VERSION: TypeSpecOpenApiExtensionSchemaVersion = 'oa-sdk.typespec-extensions.v2'
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export type TypeSpecSidecarToExtensionsOptions = {
  extensionSchemaVersion?: TypeSpecOpenApiExtensionSchemaVersion
}

export type TypeSpecSidecarToExtensionsReport = {
  schemaVersion: 'oa-sdk.typespec-sidecar-to-extensions-report.v1'
  extensionSchemaVersion: TypeSpecOpenApiExtensionSchemaVersion
  counts: {
    sourceEntries: number
    convertedEntries: number
    remainingEntries: number
    operationExtensionGroups: number
    securitySchemes: number
  }
  converted: TypeSpecSidecarConvertedEntry[]
  remaining: TypeSpecSidecarRemainingEntry[]
}

export type TypeSpecSidecarConvertedEntry = {
  kind: TypeSpecCompatibilitySidecarEntry['kind']
  pointer: string
  target: RecordValue
  extension: typeof OPERATION_EXAMPLES_EXTENSION | typeof OPERATION_SECURITY_EXTENSION | typeof SECURITY_SCHEMES_EXTENSION
  placement: string
}

export type TypeSpecSidecarRemainingEntry = {
  kind: TypeSpecCompatibilitySidecarEntry['kind']
  pointer: string
  target: RecordValue
  reason: string
}

export type TypeSpecSidecarToExtensionsResult = {
  snippets: string
  remainingSidecar: TypeSpecCompatibilitySidecar
  report: TypeSpecSidecarToExtensionsReport
}

type OperationExtensionGroup = {
  path: string
  method: HttpMethod
  parameters: RecordValue
  requestBody: RecordValue
  responses: RecordValue
  operationSecurity?: TypeSpecOperationSecuritySidecarEntry['value']
  entries: TypeSpecCompatibilitySidecarEntry[]
}

export function convertTypeSpecSidecarToExtensions(
  sidecar: TypeSpecCompatibilitySidecar,
  options: TypeSpecSidecarToExtensionsOptions = {},
): TypeSpecSidecarToExtensionsResult {
  const extensionSchemaVersion = options.extensionSchemaVersion ?? DEFAULT_EXTENSION_SCHEMA_VERSION
  const operationGroups = new Map<string, OperationExtensionGroup>()
  const securitySchemes: RecordValue = {}
  const securitySchemeNames = new Set<string>()
  const remainingEntries: TypeSpecCompatibilitySidecarEntry[] = []
  const converted: TypeSpecSidecarConvertedEntry[] = []
  const remaining: TypeSpecSidecarRemainingEntry[] = []

  for (const entry of sidecar.entries) {
    const conversion = convertEntry(entry, {
      extensionSchemaVersion,
      operationGroups,
      securitySchemes,
      securitySchemeNames,
    })
    if (conversion.converted) {
      converted.push(conversion.report)
      continue
    }
    remainingEntries.push(entry)
    remaining.push({
      kind: entry.kind,
      pointer: entry.pointer,
      target: cloneJson(entry.target) as RecordValue,
      reason: conversion.reason,
    })
  }

  const snippets = renderSnippets(operationGroups, securitySchemes)
  const remainingSidecar = createTypeSpecCompatibilitySidecarFromEntries(remainingEntries)
  return {
    snippets,
    remainingSidecar,
    report: {
      schemaVersion: 'oa-sdk.typespec-sidecar-to-extensions-report.v1',
      extensionSchemaVersion,
      counts: {
        sourceEntries: sidecar.entries.length,
        convertedEntries: converted.length,
        remainingEntries: remainingEntries.length,
        operationExtensionGroups: operationGroups.size,
        securitySchemes: Object.keys(securitySchemes).length,
      },
      converted,
      remaining,
    },
  }
}

function convertEntry(
  entry: TypeSpecCompatibilitySidecarEntry,
  context: {
    extensionSchemaVersion: TypeSpecOpenApiExtensionSchemaVersion
    operationGroups: Map<string, OperationExtensionGroup>
    securitySchemes: RecordValue
    securitySchemeNames: Set<string>
  },
): { converted: true; report: TypeSpecSidecarConvertedEntry } | { converted: false; reason: string } {
  if (entry.kind === 'parameter-examples') return convertParameterEntry(entry, context.operationGroups)
  if (entry.kind === 'request-media-examples') return convertRequestEntry(entry, context)
  if (entry.kind === 'response-media-examples') return convertResponseEntry(entry, context.operationGroups)
  if (entry.kind === 'operation-security') return convertOperationSecurityEntry(entry, context)
  return convertSecuritySchemeEntry(entry, context)
}

function convertParameterEntry(
  entry: TypeSpecParameterExamplesSidecarEntry,
  operationGroups: Map<string, OperationExtensionGroup>,
): { converted: true; report: TypeSpecSidecarConvertedEntry } | { converted: false; reason: string } {
  if (!entry.target.method) {
    return {
      converted: false,
      reason: 'path-level parameter examples need explicit operation placement before they can be emitted as operation-level TypeSpec extensions',
    }
  }
  const value = {
    in: entry.target.in,
    name: entry.target.name,
    ...cloneJson(entry.value),
  }
  if (!canRenderTypeSpecValue(value)) {
    return { converted: false, reason: 'parameter examples contain values that cannot be rendered as TypeSpec value literals' }
  }
  const group = readOperationGroup(operationGroups, entry.target.path, entry.target.method)
  group.parameters[uniqueAuthoringKey(group.parameters, `${entry.target.in}_${entry.target.name}`)] = value
  group.entries.push(entry)
  return {
    converted: true,
    report: {
      kind: entry.kind,
      pointer: entry.pointer,
      target: cloneJson(entry.target) as RecordValue,
      extension: OPERATION_EXAMPLES_EXTENSION,
      placement: operationPlacement(entry.target.path, entry.target.method),
    },
  }
}

function convertRequestEntry(
  entry: TypeSpecRequestExamplesSidecarEntry,
  context: {
    extensionSchemaVersion: TypeSpecOpenApiExtensionSchemaVersion
    operationGroups: Map<string, OperationExtensionGroup>
  },
): { converted: true; report: TypeSpecSidecarConvertedEntry } | { converted: false; reason: string } {
  if (context.extensionSchemaVersion !== 'oa-sdk.typespec-extensions.v2'
    && context.extensionSchemaVersion !== 'oa-sdk.typespec-extensions.v3') {
    return {
      converted: false,
      reason: 'request body media examples require oa-sdk.typespec-extensions.v2 or later',
    }
  }
  const value = {
    mediaType: entry.target.mediaType,
    ...cloneJson(entry.value),
  }
  if (!canRenderTypeSpecValue(value)) {
    return { converted: false, reason: 'request body media examples contain values that cannot be rendered as TypeSpec value literals' }
  }
  const group = readOperationGroup(context.operationGroups, entry.target.path, entry.target.method)
  group.requestBody[uniqueAuthoringKey(group.requestBody, entry.target.mediaType)] = value
  group.entries.push(entry)
  return {
    converted: true,
    report: {
      kind: entry.kind,
      pointer: entry.pointer,
      target: cloneJson(entry.target) as RecordValue,
      extension: OPERATION_EXAMPLES_EXTENSION,
      placement: operationPlacement(entry.target.path, entry.target.method),
    },
  }
}

function convertOperationSecurityEntry(
  entry: TypeSpecOperationSecuritySidecarEntry,
  context: {
    extensionSchemaVersion: TypeSpecOpenApiExtensionSchemaVersion
    operationGroups: Map<string, OperationExtensionGroup>
  },
): { converted: true; report: TypeSpecSidecarConvertedEntry } | { converted: false; reason: string } {
  if (context.extensionSchemaVersion !== 'oa-sdk.typespec-extensions.v3') {
    return {
      converted: false,
      reason: 'operation security overrides require oa-sdk.typespec-extensions.v3',
    }
  }
  if (!Array.isArray(entry.value) || entry.value.length !== 0) {
    return { converted: false, reason: 'only explicit public security overrides can be rendered as TypeSpec extensions' }
  }
  const group = readOperationGroup(context.operationGroups, entry.target.path, entry.target.method)
  group.operationSecurity = []
  group.entries.push(entry)
  return {
    converted: true,
    report: {
      kind: entry.kind,
      pointer: entry.pointer,
      target: cloneJson(entry.target) as RecordValue,
      extension: OPERATION_SECURITY_EXTENSION,
      placement: operationPlacement(entry.target.path, entry.target.method),
    },
  }
}

function convertResponseEntry(
  entry: TypeSpecResponseExamplesSidecarEntry,
  operationGroups: Map<string, OperationExtensionGroup>,
): { converted: true; report: TypeSpecSidecarConvertedEntry } | { converted: false; reason: string } {
  const value = {
    statusCode: entry.target.statusCode,
    mediaType: entry.target.mediaType,
    ...cloneJson(entry.value),
  }
  if (!canRenderTypeSpecValue(value)) {
    return { converted: false, reason: 'response media examples contain values that cannot be rendered as TypeSpec value literals' }
  }
  const group = readOperationGroup(operationGroups, entry.target.path, entry.target.method)
  group.responses[uniqueAuthoringKey(group.responses, `status_${entry.target.statusCode}_${entry.target.mediaType}`)] = value
  group.entries.push(entry)
  return {
    converted: true,
    report: {
      kind: entry.kind,
      pointer: entry.pointer,
      target: cloneJson(entry.target) as RecordValue,
      extension: OPERATION_EXAMPLES_EXTENSION,
      placement: operationPlacement(entry.target.path, entry.target.method),
    },
  }
}

function convertSecuritySchemeEntry(
  entry: TypeSpecSecuritySchemeSidecarEntry,
  context: {
    securitySchemes: RecordValue
    securitySchemeNames: Set<string>
  },
): { converted: true; report: TypeSpecSidecarConvertedEntry } | { converted: false; reason: string } {
  if (!IDENTIFIER_RE.test(entry.target.name)) {
    return { converted: false, reason: 'security scheme name cannot be rendered as a stable TypeSpec extension object key' }
  }
  if (context.securitySchemeNames.has(entry.target.name)) {
    return { converted: false, reason: 'duplicate security scheme target cannot be represented as a single TypeSpec extension object key' }
  }
  const validation = validateSecuritySchemeForTypeSpecExtension(entry.value)
  if (!validation.valid) return { converted: false, reason: validation.reason }
  const value = normalizeSecuritySchemeForTypeSpecExtension(entry.value)
  if (!canRenderTypeSpecValue(value)) {
    return { converted: false, reason: 'security scheme metadata contains values that cannot be rendered as TypeSpec value literals' }
  }
  context.securitySchemeNames.add(entry.target.name)
  context.securitySchemes[entry.target.name] = value
  return {
    converted: true,
    report: {
      kind: entry.kind,
      pointer: entry.pointer,
      target: cloneJson(entry.target) as RecordValue,
      extension: SECURITY_SCHEMES_EXTENSION,
      placement: 'namespace or service declaration',
    },
  }
}

function readOperationGroup(
  groups: Map<string, OperationExtensionGroup>,
  path: string,
  method: HttpMethod,
): OperationExtensionGroup {
  const key = `${method} ${path}`
  const existing = groups.get(key)
  if (existing) return existing
  const created: OperationExtensionGroup = {
    path,
    method,
    parameters: {},
    requestBody: {},
    responses: {},
    entries: [],
  }
  groups.set(key, created)
  return created
}

function renderSnippets(operationGroups: Map<string, OperationExtensionGroup>, securitySchemes: RecordValue): string {
  const blocks: string[] = [
    '// Generated from oa-sdk.typespec-compat-sidecar.v1.',
    '// Paste each @extension decorator directly above the matching TypeSpec target.',
  ]

  if (Object.keys(securitySchemes).length > 0) {
    blocks.push(
      [
        '',
        '// Namespace or service declaration',
        renderExtension(SECURITY_SCHEMES_EXTENSION, securitySchemes),
      ].join('\n'),
    )
  }

  const sortedGroups = [...operationGroups.values()].sort((left, right) => {
    const byPath = left.path.localeCompare(right.path)
    return byPath !== 0 ? byPath : left.method.localeCompare(right.method)
  })
  for (const group of sortedGroups) {
    const value: RecordValue = {}
    if (Object.keys(group.parameters).length > 0) value.parameters = group.parameters
    if (Object.keys(group.requestBody).length > 0) value.requestBody = group.requestBody
    if (Object.keys(group.responses).length > 0) value.responses = group.responses
    blocks.push(
      [
        '',
        `// ${group.method.toUpperCase()} ${group.path}`,
        ...(group.operationSecurity
          ? [renderExtension(OPERATION_SECURITY_EXTENSION, group.operationSecurity)]
          : []),
        ...(Object.keys(value).length > 0
          ? [renderExtension(OPERATION_EXAMPLES_EXTENSION, value)]
          : []),
      ].join('\n'),
    )
  }

  return `${blocks.join('\n')}\n`
}

function renderExtension(extensionName: string, value: unknown): string {
  const rendered = renderTypeSpecValue(value)
  if (!rendered) {
    throw new Error(`cannot render ${extensionName} as TypeSpec value literal`)
  }
  return `@extension(${JSON.stringify(extensionName)}, ${rendered})`
}

function canRenderTypeSpecValue(value: unknown): boolean {
  return renderTypeSpecValue(value) !== null
}

function renderTypeSpecValue(value: unknown, depth = 0): string | null {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : null
  if (Array.isArray(value)) {
    if (value.length === 0) return '#[]'
    const renderedItems = value.map(item => renderTypeSpecValue(item, depth + 1))
    if (renderedItems.some(item => item === null)) return null
    return `#[\n${renderedItems.map(item => `${indent(depth + 1)}${item}`).join(',\n')}\n${indent(depth)}]`
  }
  if (!isRecord(value)) return null
  const entries = Object.entries(value)
  if (entries.length === 0) return '#{}'
  const renderedEntries: string[] = []
  for (const [key, item] of entries) {
    if (!IDENTIFIER_RE.test(key)) return null
    const renderedItem = renderTypeSpecValue(item, depth + 1)
    if (renderedItem === null) return null
    renderedEntries.push(`${indent(depth + 1)}${key}: ${renderedItem}`)
  }
  return `#{\n${renderedEntries.join(',\n')}\n${indent(depth)}}`
}

function normalizeSecuritySchemeForTypeSpecExtension(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSecuritySchemeForTypeSpecExtension)
  if (!isRecord(value)) return cloneJson(value)
  const normalized: RecordValue = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'scopes' && isRecord(item)) {
      normalized.scopes = Object.entries(item).map(([name, description]) => ({
        name,
        description,
      }))
      continue
    }
    normalized[key] = normalizeSecuritySchemeForTypeSpecExtension(item)
  }
  return normalized
}

function validateSecuritySchemeForTypeSpecExtension(value: unknown, path = 'security scheme metadata'): {
  valid: true
} | {
  valid: false
  reason: string
} {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const validation = validateSecuritySchemeForTypeSpecExtension(item, `${path}[${index}]`)
      if (!validation.valid) return validation
    }
    return { valid: true }
  }
  if (!isRecord(value)) return { valid: true }

  for (const [key, item] of Object.entries(value)) {
    if (key === 'scopes') {
      if (!isRecord(item)) {
        return {
          valid: false,
          reason: `security scheme scopes must be an object map before they can be emitted as TypeSpec extensions (${path}.scopes)`,
        }
      }
      for (const [scopeName, description] of Object.entries(item)) {
        if (typeof description === 'string') continue
        return {
          valid: false,
          reason: `security scheme scope descriptions must be strings before they can be emitted as TypeSpec extensions (${path}.scopes.${scopeName})`,
        }
      }
      continue
    }
    const validation = validateSecuritySchemeForTypeSpecExtension(item, `${path}.${key}`)
    if (!validation.valid) return validation
  }

  return { valid: true }
}

function uniqueAuthoringKey(record: RecordValue, source: string, seenKeys?: Set<string>): string {
  const base = toAuthoringKey(source)
  let key = base
  let suffix = 2
  while (Object.prototype.hasOwnProperty.call(record, key) || seenKeys?.has(key)) {
    key = `${base}_${suffix}`
    suffix += 1
  }
  seenKeys?.add(key)
  return key
}

function toAuthoringKey(value: string): string {
  const candidate = value.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (candidate === '') return 'entry'
  return /^[A-Za-z_]/.test(candidate) ? candidate : `entry_${candidate}`
}

function operationPlacement(path: string, method: HttpMethod): string {
  return `operation ${method.toUpperCase()} ${path}`
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
