import type {
  OasDocument,
  OasMediaType,
  OasOperation,
  OasParameter,
  OasPathItem,
  OasRequestBody,
  OasResponse,
  OasSecurityScheme,
  Referenceable,
} from '@oa-sdk/parser'

type RecordValue = Record<string, unknown>
type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'options' | 'head' | 'patch' | 'trace' | 'query'

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query']
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export type TypeSpecCompatibilitySidecarEntry =
  | TypeSpecParameterExamplesSidecarEntry
  | TypeSpecRequestExamplesSidecarEntry
  | TypeSpecResponseExamplesSidecarEntry
  | TypeSpecSecuritySchemeSidecarEntry

export type TypeSpecParameterExamplesSidecarEntry = {
  kind: 'parameter-examples'
  pointer: string
  sourcePointer?: string
  target: {
    path: string
    method?: HttpMethod
    name: string
    in: string
  }
  value: {
    example?: unknown
    examples?: unknown
  }
}

export type TypeSpecRequestExamplesSidecarEntry = {
  kind: 'request-media-examples'
  pointer: string
  sourcePointer?: string
  target: {
    path: string
    method: HttpMethod
    mediaType: string
  }
  value: {
    example?: unknown
    examples?: unknown
  }
}

export type TypeSpecResponseExamplesSidecarEntry = {
  kind: 'response-media-examples'
  pointer: string
  sourcePointer?: string
  target: {
    path: string
    method: HttpMethod
    statusCode: string
    mediaType: string
  }
  value: {
    example?: unknown
    examples?: unknown
  }
}

export type TypeSpecSecuritySchemeSidecarEntry = {
  kind: 'security-scheme'
  pointer: string
  target: {
    name: string
  }
  value: unknown
}

export type TypeSpecCompatibilitySidecar = {
  schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1'
  counts: {
    entries: number
    parameterExamples: number
    requestMediaExamples?: number
    responseMediaExamples: number
    securitySchemes: number
  }
  entries: TypeSpecCompatibilitySidecarEntry[]
}

export type TypeSpecCompatibilityRestoreDiagnostic = {
  severity: 'warning'
  code: string
  pointer: string
  message: string
}

export type TypeSpecCompatibilityRestoreReport = {
  schemaVersion: 'oa-sdk.typespec-compat-restore-report.v1'
  counts: {
    entries: number
    applied: number
    missingTargets: number
  }
  diagnostics: TypeSpecCompatibilityRestoreDiagnostic[]
}

export type TypeSpecCompatibilityRestoreResult = {
  document: OasDocument
  report: TypeSpecCompatibilityRestoreReport
}

export type TypeSpecCompatibilitySidecarCompareDiagnostic = {
  severity: 'warning'
  code:
    | 'typespec-sidecar/missing-expected-entry'
    | 'typespec-sidecar/unexpected-actual-entry'
    | 'typespec-sidecar/value-mismatch'
  pointer: string
  message: string
}

export type TypeSpecCompatibilitySidecarCompareReport = {
  schemaVersion: 'oa-sdk.typespec-compat-compare-report.v1'
  counts: {
    expectedEntries: number
    actualEntries: number
    expectedSatisfied: number
    actualCovered: number
    missingExpected: number
    unexpectedActual: number
    valueMismatches: number
  }
  diagnostics: TypeSpecCompatibilitySidecarCompareDiagnostic[]
}

export function createTypeSpecCompatibilitySidecar(document: OasDocument): TypeSpecCompatibilitySidecar {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  entries.push(...collectSecuritySchemeEntries(document))
  entries.push(...collectPathEntries(document))
  return {
    schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
    counts: countEntries(entries),
    entries,
  }
}

export function parseTypeSpecCompatibilitySidecar(value: unknown): TypeSpecCompatibilitySidecar {
  const errors: string[] = []
  if (!isRecord(value)) {
    throw new Error('invalid TypeSpec compatibility sidecar: expected object')
  }
  if (value.schemaVersion !== 'oa-sdk.typespec-compat-sidecar.v1') {
    errors.push('schemaVersion must be oa-sdk.typespec-compat-sidecar.v1')
  }
  if (!isRecord(value.counts)) {
    errors.push('counts must be an object')
  }
  if (!Array.isArray(value.entries)) {
    errors.push('entries must be an array')
  }

  const entries = Array.isArray(value.entries) ? value.entries : []
  for (let index = 0; index < entries.length; index += 1) {
    validateSidecarEntry(entries[index], `entries[${index}]`, errors)
  }
  if (isRecord(value.counts)) {
    validateSidecarCounts(value.counts, entries, errors)
  }
  if (errors.length > 0) {
    throw new Error(`invalid TypeSpec compatibility sidecar: ${errors.join('; ')}`)
  }
  return value as TypeSpecCompatibilitySidecar
}

export function compareTypeSpecCompatibilitySidecars(
  expected: TypeSpecCompatibilitySidecar,
  actual: TypeSpecCompatibilitySidecar,
): TypeSpecCompatibilitySidecarCompareReport {
  const actualCovered = new Set<number>()
  const actualTargetRelated = new Set<number>()
  let expectedSatisfied = 0
  let missingExpected = 0
  let valueMismatches = 0
  const diagnostics: TypeSpecCompatibilitySidecarCompareDiagnostic[] = []

  for (const [expectedIndex, expectedEntry] of expected.entries.entries()) {
    const targetMatches = actual.entries
      .map((actualEntry, actualIndex) => ({ actualEntry, actualIndex }))
      .filter(({ actualEntry }) => entriesTargetCompatible(expectedEntry, actualEntry))

    for (const { actualIndex } of targetMatches) actualTargetRelated.add(actualIndex)

    const valueMatches = targetMatches.filter(({ actualEntry }) => entryValuesEqual(expectedEntry, actualEntry))
    if (valueMatches.length > 0) {
      expectedSatisfied += 1
      for (const { actualIndex } of valueMatches) actualCovered.add(actualIndex)
      continue
    }

    if (targetMatches.length > 0) {
      valueMismatches += 1
      diagnostics.push({
        severity: 'warning',
        code: 'typespec-sidecar/value-mismatch',
        pointer: expectedEntry.pointer,
        message: `Expected sidecar entry ${expectedIndex} target exists after re-extraction, but its value differs.`,
      })
      continue
    }

    missingExpected += 1
    diagnostics.push({
      severity: 'warning',
      code: 'typespec-sidecar/missing-expected-entry',
      pointer: expectedEntry.pointer,
      message: `Expected sidecar entry ${expectedIndex} was not found after re-extraction.`,
    })
  }

  let unexpectedActual = 0
  for (const [actualIndex, actualEntry] of actual.entries.entries()) {
    if (actualCovered.has(actualIndex) || actualTargetRelated.has(actualIndex)) continue
    unexpectedActual += 1
    diagnostics.push({
      severity: 'warning',
      code: 'typespec-sidecar/unexpected-actual-entry',
      pointer: actualEntry.pointer,
      message: `Actual sidecar entry ${actualIndex} was not present in the expected sidecar semantics.`,
    })
  }

  return {
    schemaVersion: 'oa-sdk.typespec-compat-compare-report.v1',
    counts: {
      expectedEntries: expected.entries.length,
      actualEntries: actual.entries.length,
      expectedSatisfied,
      actualCovered: actualCovered.size,
      missingExpected,
      unexpectedActual,
      valueMismatches,
    },
    diagnostics,
  }
}

export function applyTypeSpecCompatibilitySidecar(
  document: OasDocument,
  sidecar: TypeSpecCompatibilitySidecar,
): TypeSpecCompatibilityRestoreResult {
  const restored = cloneJson(document) as OasDocument
  const diagnostics: TypeSpecCompatibilityRestoreDiagnostic[] = []
  let applied = 0

  for (const entry of sidecar.entries) {
    const appliedForEntry = applyEntry(restored, entry, diagnostics)
    applied += appliedForEntry
    if (appliedForEntry === 0) {
      diagnostics.push({
        severity: 'warning',
        code: 'typespec-sidecar/missing-target',
        pointer: entry.pointer,
        message: `No matching emitted OpenAPI target was found for ${entry.kind}.`,
      })
    }
  }

  return {
    document: restored,
    report: {
      schemaVersion: 'oa-sdk.typespec-compat-restore-report.v1',
      counts: {
        entries: sidecar.entries.length,
        applied,
        missingTargets: diagnostics.filter(diagnostic => diagnostic.code === 'typespec-sidecar/missing-target').length,
      },
      diagnostics,
    },
  }
}

function collectSecuritySchemeEntries(document: OasDocument): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  const schemes = document.components?.securitySchemes ?? {}
  for (const [name, value] of Object.entries(schemes)) {
    if (isReference(value)) {
      entries.push({
        kind: 'security-scheme',
        pointer: `#/components/securitySchemes/${escapeJsonPointer(name)}`,
        target: { name },
        value: cloneJson(value),
      })
      continue
    }
    if (isTypeSpecEmittedSecurityScheme(name, value)) continue
    entries.push({
      kind: 'security-scheme',
      pointer: `#/components/securitySchemes/${escapeJsonPointer(name)}`,
      target: { name },
      value: cloneJson(value),
    })
  }
  return entries
}

function collectPathEntries(document: OasDocument): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [path, pathItemValue] of Object.entries(document.paths ?? {})) {
    const pathPointer = `#/paths/${escapeJsonPointer(path)}`
    const pathItem = resolveReference<OasPathItem>(document, pathItemValue, pathPointer)
    if (!pathItem) continue

    for (let index = 0; index < (pathItem.value.parameters?.length ?? 0); index += 1) {
      const parameterPointer = `${pathPointer}/parameters/${index}`
      const entry = createParameterExamplesEntry(document, pathItem.value.parameters?.[index], parameterPointer, {
        path,
      })
      if (entry) entries.push(entry)
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem.value[method] as OasOperation | undefined
      if (!operation) continue
      const operationPointer = `${pathPointer}/${method}`
      for (let index = 0; index < (operation.parameters?.length ?? 0); index += 1) {
        const parameterPointer = `${operationPointer}/parameters/${index}`
        const entry = createParameterExamplesEntry(document, operation.parameters?.[index], parameterPointer, {
          path,
          method,
        })
        if (entry) entries.push(entry)
      }
      entries.push(...collectRequestExamplesEntries(document, operation, operationPointer, path, method))
      entries.push(...collectResponseExamplesEntries(document, operation, operationPointer, path, method))
    }
  }
  return entries
}

function createParameterExamplesEntry(
  document: OasDocument,
  parameterValue: Referenceable<OasParameter> | undefined,
  pointer: string,
  target: { path: string; method?: HttpMethod },
): TypeSpecParameterExamplesSidecarEntry | null {
  const parameter = resolveReference<OasParameter>(document, parameterValue, pointer)
  if (!parameter) return null
  const value = exampleValue(parameter.value)
  if (!value) return null
  return {
    kind: 'parameter-examples',
    pointer,
    ...(parameter.pointer !== pointer ? { sourcePointer: parameter.pointer } : {}),
    target: {
      ...target,
      name: parameter.value.name,
      in: parameter.value.in,
    },
    value,
  }
}

function collectRequestExamplesEntries(
  document: OasDocument,
  operation: OasOperation,
  operationPointer: string,
  path: string,
  method: HttpMethod,
): TypeSpecCompatibilitySidecarEntry[] {
  const requestPointer = `${operationPointer}/requestBody`
  const requestBody = resolveReference<OasRequestBody>(document, operation.requestBody, requestPointer)
  if (!requestBody) return []
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [mediaType, mediaValue] of Object.entries(requestBody.value.content ?? {})) {
    const mediaPointer = `${requestPointer}/content/${escapeJsonPointer(mediaType)}`
    const media = resolveReference<OasMediaType>(document, mediaValue, mediaPointer)
    if (!media) continue
    const value = exampleValue(media.value)
    if (!value) continue
    entries.push({
      kind: 'request-media-examples',
      pointer: mediaPointer,
      ...(media.pointer !== mediaPointer ? { sourcePointer: media.pointer } : {}),
      target: {
        path,
        method,
        mediaType,
      },
      value,
    })
  }
  return entries
}

function collectResponseExamplesEntries(
  document: OasDocument,
  operation: OasOperation,
  operationPointer: string,
  path: string,
  method: HttpMethod,
): TypeSpecCompatibilitySidecarEntry[] {
  const entries: TypeSpecCompatibilitySidecarEntry[] = []
  for (const [statusCode, responseValue] of Object.entries(operation.responses ?? {})) {
    const responsePointer = `${operationPointer}/responses/${escapeJsonPointer(statusCode)}`
    const response = resolveReference<OasResponse>(document, responseValue, responsePointer)
    if (!response) continue
    for (const [mediaType, mediaValue] of Object.entries(response.value.content ?? {})) {
      const mediaPointer = `${responsePointer}/content/${escapeJsonPointer(mediaType)}`
      const media = resolveReference<OasMediaType>(document, mediaValue, mediaPointer)
      if (!media) continue
      const value = exampleValue(media.value)
      if (!value) continue
      entries.push({
        kind: 'response-media-examples',
        pointer: mediaPointer,
        ...(media.pointer !== mediaPointer ? { sourcePointer: media.pointer } : {}),
        target: {
          path,
          method,
          statusCode,
          mediaType,
        },
        value,
      })
    }
  }
  return entries
}

function exampleValue(value: { example?: unknown; examples?: unknown }): { example?: unknown; examples?: unknown } | null {
  const result: { example?: unknown; examples?: unknown } = {}
  if (value.example !== undefined) result.example = cloneJson(value.example)
  if (value.examples !== undefined) result.examples = cloneJson(value.examples)
  return result.example !== undefined || result.examples !== undefined ? result : null
}

function applyEntry(
  document: OasDocument,
  entry: TypeSpecCompatibilitySidecarEntry,
  diagnostics: TypeSpecCompatibilityRestoreDiagnostic[],
): number {
  if (entry.kind === 'security-scheme') {
    document.components ??= {}
    document.components.securitySchemes ??= {}
    document.components.securitySchemes[entry.target.name] = cloneJson(entry.value) as Referenceable<OasSecurityScheme>
    return 1
  }
  if (entry.kind === 'parameter-examples') {
    return applyParameterExamples(document, entry, diagnostics)
  }
  if (entry.kind === 'request-media-examples') {
    return applyRequestExamples(document, entry)
  }
  return applyResponseExamples(document, entry)
}

function applyParameterExamples(
  document: OasDocument,
  entry: TypeSpecParameterExamplesSidecarEntry,
  diagnostics: TypeSpecCompatibilityRestoreDiagnostic[],
): number {
  const pathItem = readPathItem(document, entry.target.path)
  if (!pathItem) return 0
  let applied = 0
  if (entry.target.method) {
    const operation = readOperation(pathItem, entry.target.method)
    if (operation) {
      applied += applyExamplesToParameterList(document, operation.parameters, entry)
    }
    return applied
  }

  applied += applyExamplesToParameterList(document, pathItem.parameters, entry)
  for (const method of HTTP_METHODS) {
    const operation = readOperation(pathItem, method)
    if (!operation) continue
    applied += applyExamplesToParameterList(document, operation.parameters, entry)
  }
  if (applied > 1) {
    diagnostics.push({
      severity: 'warning',
      code: 'typespec-sidecar/parameter-examples-applied-to-multiple-targets',
      pointer: entry.pointer,
      message: `Parameter examples for ${entry.target.in}:${entry.target.name} were restored to ${applied} emitted parameters.`,
    })
  }
  return applied
}

function applyExamplesToParameterList(
  document: OasDocument,
  parameters: Referenceable<OasParameter>[] | undefined,
  entry: TypeSpecParameterExamplesSidecarEntry,
): number {
  if (!parameters) return 0
  let applied = 0
  for (const parameterValue of parameters) {
    const parameter = resolveMutableReference<OasParameter>(document, parameterValue)
    if (!parameter || parameter.name !== entry.target.name || parameter.in !== entry.target.in) continue
    assignExamples(parameter, entry.value)
    applied += 1
  }
  return applied
}

function applyRequestExamples(
  document: OasDocument,
  entry: TypeSpecRequestExamplesSidecarEntry,
): number {
  const pathItem = readPathItem(document, entry.target.path)
  const operation = pathItem ? readOperation(pathItem, entry.target.method) : undefined
  const requestBody = resolveMutableReference<OasRequestBody>(document, operation?.requestBody)
  const mediaValue = requestBody?.content?.[entry.target.mediaType]
  const media = resolveMutableReference<OasMediaType>(document, mediaValue)
  if (!media) return 0
  assignExamples(media, entry.value)
  return 1
}

function applyResponseExamples(
  document: OasDocument,
  entry: TypeSpecResponseExamplesSidecarEntry,
): number {
  const pathItem = readPathItem(document, entry.target.path)
  const operation = pathItem ? readOperation(pathItem, entry.target.method) : undefined
  const responseValue = operation?.responses?.[entry.target.statusCode]
  const response = resolveMutableReference<OasResponse>(document, responseValue)
  const mediaValue = response?.content?.[entry.target.mediaType]
  const media = resolveMutableReference<OasMediaType>(document, mediaValue)
  if (!media) return 0
  assignExamples(media, entry.value)
  return 1
}

function assignExamples(target: { example?: unknown; examples?: unknown }, value: { example?: unknown; examples?: unknown }): void {
  delete target.example
  delete target.examples
  if (value.example !== undefined) target.example = cloneJson(value.example)
  if (value.examples !== undefined) target.examples = cloneJson(value.examples)
}

function readPathItem(document: OasDocument, path: string): OasPathItem | undefined {
  const value = document.paths?.[path]
  return resolveMutableReference<OasPathItem>(document, value)
}

function readOperation(pathItem: OasPathItem, method: HttpMethod): OasOperation | undefined {
  const operation = pathItem[method]
  return operation && isRecord(operation) ? operation as OasOperation : undefined
}

function resolveReference<T>(
  document: OasDocument,
  value: Referenceable<T> | undefined,
  pointer: string,
): { value: T; pointer: string } | undefined {
  if (!value) return undefined
  if (!isReference(value)) return { value: value as T, pointer }
  const resolved = resolveLocalRef(document, value.$ref)
  if (resolved === undefined) return undefined
  return { value: resolved as T, pointer: value.$ref }
}

function resolveMutableReference<T>(document: OasDocument, value: Referenceable<T> | undefined): T | undefined {
  if (!value) return undefined
  if (!isReference(value)) return value as T
  return resolveLocalRef(document, value.$ref) as T | undefined
}

function resolveLocalRef(document: OasDocument, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  const parts = ref.slice(2).split('/').map(unescapeJsonPointer)
  let current: unknown = document
  for (const part of parts) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function isTypeSpecEmittedSecurityScheme(name: string, scheme: OasSecurityScheme): boolean {
  return scheme.type === 'http'
    && typeof scheme.scheme === 'string'
    && scheme.scheme.toLowerCase() === 'bearer'
    && IDENTIFIER_RE.test(name)
}

function countEntries(entries: TypeSpecCompatibilitySidecarEntry[]): TypeSpecCompatibilitySidecar['counts'] {
  const counts = countEntryKinds(entries)
  const { requestMediaExamples, ...baseCounts } = counts
  if (requestMediaExamples === 0) return baseCounts
  return {
    ...baseCounts,
    requestMediaExamples,
  }
}

function validateSidecarEntry(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  if (!isSidecarEntryKind(value.kind)) {
    errors.push(`${path}.kind must be parameter-examples, request-media-examples, response-media-examples, or security-scheme`)
    return
  }
  requireString(value, 'pointer', `${path}.pointer`, errors)
  optionalString(value, 'sourcePointer', `${path}.sourcePointer`, errors)
  if (value.kind === 'parameter-examples') {
    validateParameterExamplesEntry(value, path, errors)
  } else if (value.kind === 'request-media-examples') {
    validateRequestExamplesEntry(value, path, errors)
  } else if (value.kind === 'response-media-examples') {
    validateResponseExamplesEntry(value, path, errors)
  } else {
    validateSecuritySchemeEntry(value, path, errors)
  }
}

function validateParameterExamplesEntry(
  entry: RecordValue,
  path: string,
  errors: string[],
): void {
  if (!isRecord(entry.target)) {
    errors.push(`${path}.target must be an object`)
  } else {
    requireString(entry.target, 'path', `${path}.target.path`, errors)
    optionalHttpMethod(entry.target, 'method', `${path}.target.method`, errors)
    requireString(entry.target, 'name', `${path}.target.name`, errors)
    requireString(entry.target, 'in', `${path}.target.in`, errors)
  }
  validateExamplesValue(entry.value, `${path}.value`, errors)
}

function validateRequestExamplesEntry(
  entry: RecordValue,
  path: string,
  errors: string[],
): void {
  if (!isRecord(entry.target)) {
    errors.push(`${path}.target must be an object`)
  } else {
    requireString(entry.target, 'path', `${path}.target.path`, errors)
    requireHttpMethod(entry.target, 'method', `${path}.target.method`, errors)
    requireString(entry.target, 'mediaType', `${path}.target.mediaType`, errors)
  }
  validateExamplesValue(entry.value, `${path}.value`, errors)
}

function validateResponseExamplesEntry(
  entry: RecordValue,
  path: string,
  errors: string[],
): void {
  if (!isRecord(entry.target)) {
    errors.push(`${path}.target must be an object`)
  } else {
    requireString(entry.target, 'path', `${path}.target.path`, errors)
    requireHttpMethod(entry.target, 'method', `${path}.target.method`, errors)
    requireString(entry.target, 'statusCode', `${path}.target.statusCode`, errors)
    requireString(entry.target, 'mediaType', `${path}.target.mediaType`, errors)
  }
  validateExamplesValue(entry.value, `${path}.value`, errors)
}

function validateSecuritySchemeEntry(
  entry: RecordValue,
  path: string,
  errors: string[],
): void {
  if (!isRecord(entry.target)) {
    errors.push(`${path}.target must be an object`)
  } else {
    requireString(entry.target, 'name', `${path}.target.name`, errors)
  }
  if (!hasOwn(entry, 'value') || entry.value === undefined) {
    errors.push(`${path}.value is required`)
  }
}

function validateExamplesValue(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return
  }
  if (!hasOwn(value, 'example') && !hasOwn(value, 'examples')) {
    errors.push(`${path} must contain example or examples`)
  }
  if (hasOwn(value, 'example') && value.example === undefined) {
    errors.push(`${path}.example must be JSON-compatible`)
  }
  if (hasOwn(value, 'examples') && value.examples === undefined) {
    errors.push(`${path}.examples must be JSON-compatible`)
  }
}

function validateSidecarCounts(counts: RecordValue, entries: unknown[], errors: string[]): void {
  const actual = countEntryKinds(entries)
  const expectedEntries = optionalNonNegativeInteger(counts, 'entries', 'counts.entries', errors)
  const expectedParameterExamples = optionalNonNegativeInteger(counts, 'parameterExamples', 'counts.parameterExamples', errors)
  const expectedRequestMediaExamples = hasOwn(counts, 'requestMediaExamples')
    ? optionalNonNegativeInteger(counts, 'requestMediaExamples', 'counts.requestMediaExamples', errors)
    : undefined
  const expectedResponseMediaExamples = optionalNonNegativeInteger(counts, 'responseMediaExamples', 'counts.responseMediaExamples', errors)
  const expectedSecuritySchemes = optionalNonNegativeInteger(counts, 'securitySchemes', 'counts.securitySchemes', errors)
  if (expectedEntries !== undefined && expectedEntries !== actual.entries) {
    errors.push(`counts.entries must equal ${actual.entries}`)
  }
  if (expectedParameterExamples !== undefined && expectedParameterExamples !== actual.parameterExamples) {
    errors.push(`counts.parameterExamples must equal ${actual.parameterExamples}`)
  }
  if (expectedRequestMediaExamples !== undefined && expectedRequestMediaExamples !== actual.requestMediaExamples) {
    errors.push(`counts.requestMediaExamples must equal ${actual.requestMediaExamples}`)
  }
  if (expectedRequestMediaExamples === undefined && actual.requestMediaExamples > 0) {
    errors.push(`counts.requestMediaExamples must equal ${actual.requestMediaExamples}`)
  }
  if (expectedResponseMediaExamples !== undefined && expectedResponseMediaExamples !== actual.responseMediaExamples) {
    errors.push(`counts.responseMediaExamples must equal ${actual.responseMediaExamples}`)
  }
  if (expectedSecuritySchemes !== undefined && expectedSecuritySchemes !== actual.securitySchemes) {
    errors.push(`counts.securitySchemes must equal ${actual.securitySchemes}`)
  }
}

type EntryKindCounts = {
  entries: number
  parameterExamples: number
  requestMediaExamples: number
  responseMediaExamples: number
  securitySchemes: number
}

function countEntryKinds(entries: unknown[]): EntryKindCounts {
  return {
    entries: entries.length,
    parameterExamples: entries.filter(entry => isRecord(entry) && entry.kind === 'parameter-examples').length,
    requestMediaExamples: entries.filter(entry => isRecord(entry) && entry.kind === 'request-media-examples').length,
    responseMediaExamples: entries.filter(entry => isRecord(entry) && entry.kind === 'response-media-examples').length,
    securitySchemes: entries.filter(entry => isRecord(entry) && entry.kind === 'security-scheme').length,
  }
}

function requireString(record: RecordValue, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
    errors.push(`${path} must be a non-empty string`)
  }
}

function optionalString(record: RecordValue, key: string, path: string, errors: string[]): void {
  if (hasOwn(record, key) && typeof record[key] !== 'string') {
    errors.push(`${path} must be a string`)
  }
}

function requireHttpMethod(record: RecordValue, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== 'string' || !isHttpMethod(record[key])) {
    errors.push(`${path} must be an HTTP method`)
  }
}

function optionalHttpMethod(record: RecordValue, key: string, path: string, errors: string[]): void {
  if (hasOwn(record, key) && (typeof record[key] !== 'string' || !isHttpMethod(record[key]))) {
    errors.push(`${path} must be an HTTP method`)
  }
}

function optionalNonNegativeInteger(
  record: RecordValue,
  key: string,
  path: string,
  errors: string[],
): number | undefined {
  if (!hasOwn(record, key) || !Number.isInteger(record[key]) || (record[key] as number) < 0) {
    errors.push(`${path} must be a non-negative integer`)
    return undefined
  }
  return record[key] as number
}

function isSidecarEntryKind(value: unknown): value is TypeSpecCompatibilitySidecarEntry['kind'] {
  return value === 'parameter-examples'
    || value === 'request-media-examples'
    || value === 'response-media-examples'
    || value === 'security-scheme'
}

function entriesTargetCompatible(
  expected: TypeSpecCompatibilitySidecarEntry,
  actual: TypeSpecCompatibilitySidecarEntry,
): boolean {
  if (expected.kind !== actual.kind) return false
  if (expected.kind === 'security-scheme' && actual.kind === 'security-scheme') {
    return expected.target.name === actual.target.name
  }
  if (expected.kind === 'response-media-examples' && actual.kind === 'response-media-examples') {
    return expected.target.path === actual.target.path
      && expected.target.method === actual.target.method
      && expected.target.statusCode === actual.target.statusCode
      && expected.target.mediaType === actual.target.mediaType
  }
  if (expected.kind === 'request-media-examples' && actual.kind === 'request-media-examples') {
    return expected.target.path === actual.target.path
      && expected.target.method === actual.target.method
      && expected.target.mediaType === actual.target.mediaType
  }
  if (expected.kind === 'parameter-examples' && actual.kind === 'parameter-examples') {
    return expected.target.path === actual.target.path
      && expected.target.name === actual.target.name
      && expected.target.in === actual.target.in
      && (
        expected.target.method === undefined
        || actual.target.method === undefined
        || expected.target.method === actual.target.method
      )
  }
  return false
}

function entryValuesEqual(
  expected: TypeSpecCompatibilitySidecarEntry,
  actual: TypeSpecCompatibilitySidecarEntry,
): boolean {
  return stableStringify(expected.value) === stableStringify(actual.value)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)]),
  )
}

function isHttpMethod(value: string): value is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(value)
}

function isReference(value: unknown): value is { $ref: string } {
  return isRecord(value) && typeof value.$ref === 'string'
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(record: RecordValue, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function unescapeJsonPointer(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~')
}
