import { parse as parseYaml } from 'yaml'
import type {
  LintResult,
  LintSeverity,
  OasDocument,
  ParseDocumentOptions,
  ParsedDocument,
  ValidateDocumentOptions,
  ValidationResult,
} from '@oa-sdk/parser'
import { parseDocument, validateDocument } from '@oa-sdk/parser'

export const APITOMY_DATA_MODELS_PACKAGE = '@apitomy/data-models' as const
export const APITOMY_REFERENCE_ADAPTER_VERSION = 'oa-sdk.apitomy-reference.v1' as const

/** Opaque Apitomy model value. It is never an oa-sdk source-of-truth type. */
export type ApitomyReferenceDocument = unknown

export type ApitomyReferenceValidationProblem = {
  errorCode?: unknown
  nodePath?: unknown
  property?: unknown
  message?: unknown
  severity?: unknown
}

/**
 * The smallest surface needed from Apitomy Data Models.
 *
 * It is intentionally structural so @oa-sdk/codegen does not hard-depend on
 * an optional external package at runtime or compile time.
 */
export type ApitomyReferenceLibrary = {
  readDocument: (input: unknown) => ApitomyReferenceDocument
  readDocumentFromJSONString?: (input: string) => ApitomyReferenceDocument
  writeNode?: (document: ApitomyReferenceDocument) => unknown
  writeDocument?: (document: ApitomyReferenceDocument) => unknown
  writeDocumentToJSONString?: (document: ApitomyReferenceDocument) => string
  validate?: (
    document: ApitomyReferenceDocument,
    severityRegistry: unknown,
  ) => readonly ApitomyReferenceValidationProblem[]
  transformDocument?: (
    document: ApitomyReferenceDocument,
    targetModelType: unknown,
  ) => ApitomyReferenceDocument
}

export type ApitomyReferenceModule = {
  Library: ApitomyReferenceLibrary
  ModelType?: Record<string, unknown>
  version?: string
}

export type ApitomyReferenceErrorCode =
  | 'invalid-library'
  | 'missing-capability'
  | 'invalid-input'
  | 'invalid-output'
  | 'unsupported-document'
  | 'dependency-not-installed'
  | 'dependency-load-failed'

export class ApitomyReferenceError extends Error {
  override readonly name = 'ApitomyReferenceError'

  constructor(
    readonly code: ApitomyReferenceErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export type ApitomyReferenceAdapterOptions = {
  /** Require the reference input to be an OpenAPI 3.2.x document. */
  requireOpenApi32?: boolean
  /** Convert Apitomy's NodePath representation into a stable diagnostic path. */
  nodePathToString?: (nodePath: unknown) => string | undefined
}

export type ApitomyReferenceDifferenceKind =
  | 'semantic-match'
  | 'oa-sdk-only'
  | 'apitomy-only'
  | 'unsupported-by-reference'
  | 'path-mapping-failed'
  | 'serialization-loss'

export type ApitomyReferenceDiagnosticDifference = {
  kind: ApitomyReferenceDifferenceKind
  primary?: LintResult
  reference?: LintResult
  path?: string
  message?: string
}

export type ApitomyReferenceMetadata = {
  adapterVersion: typeof APITOMY_REFERENCE_ADAPTER_VERSION
  provider: 'apitomy'
  providerPackage: typeof APITOMY_DATA_MODELS_PACKAGE
  providerVersion?: string
  inputHash?: string
  documentVersion?: string
  capabilities: string[]
}

export type ApitomyReferenceSerialization = {
  checked: boolean
  equal: boolean
}

export type ApitomyReferenceComparison = {
  /** oa-sdk is the only authoritative validation result. */
  primary: ValidationResult
  /** Apitomy output is retained as a reference signal only. */
  reference: {
    problems: readonly ApitomyReferenceValidationProblem[]
    diagnostics: LintResult[]
  }
  matched: LintResult[]
  primaryOnly: LintResult[]
  referenceOnly: LintResult[]
  differences: ApitomyReferenceDiagnosticDifference[]
  metadata: ApitomyReferenceMetadata
  serialization: ApitomyReferenceSerialization
  status: 'match' | 'divergent'
}

export type ApitomyReferenceAdapter = {
  /** Read JSON, YAML, or an already parsed object into an opaque Apitomy value. */
  read(input: string | Record<string, unknown>): ApitomyReferenceDocument
  /** Serialize an Apitomy value into a plain OpenAPI object for comparison. */
  write(document: ApitomyReferenceDocument): Record<string, unknown>
  /** Serialize an Apitomy value as formatted JSON. */
  writeJsonString(document: ApitomyReferenceDocument): string
  /** Run Apitomy's native validator as a non-authoritative reference signal. */
  validateNative(
    document: ApitomyReferenceDocument,
    severityRegistry?: unknown,
  ): readonly ApitomyReferenceValidationProblem[]
  /** Map reference problems into oa-sdk's diagnostic shape without changing authority. */
  mapValidationProblems(
    problems: readonly ApitomyReferenceValidationProblem[],
  ): LintResult[]
  /** Compare native reference diagnostics with the authoritative oa-sdk result. */
  compareValidation(
    document: ApitomyReferenceDocument,
    options?: ApitomyReferenceCompareOptions,
  ): ApitomyReferenceComparison
  /** Convert an Apitomy value into oa-sdk's document boundary for comparison. */
  toOpenApiDocument(document: ApitomyReferenceDocument): OasDocument
  /** Convert an Apitomy value into oa-sdk's ParsedDocument IR for comparison. */
  parseToOaSdk(
    document: ApitomyReferenceDocument,
    options?: ParseDocumentOptions,
  ): ParsedDocument
  /** Read an input and immediately parse it through the oa-sdk pipeline. */
  readAndParse(
    input: string | Record<string, unknown>,
    options?: ParseDocumentOptions,
  ): ParsedDocument
  /** Use Apitomy's version transformer as an explicitly non-authoritative probe. */
  transformReference(
    document: ApitomyReferenceDocument,
    targetModelType: unknown,
  ): ApitomyReferenceDocument
}

export type ApitomyReferenceCompareOptions = {
  severityRegistry?: unknown
  validation?: ValidateDocumentOptions
  /** SHA-256 (or another host-defined content identifier) for reproducibility. */
  inputHash?: string
  /** Optional source object used to detect reference serialization loss. */
  sourceDocument?: Record<string, unknown>
  /** Version of the reference provider resolved by the host. */
  providerVersion?: string
}

export function createApitomyReferenceAdapter(
  library: unknown,
  options: ApitomyReferenceAdapterOptions = {},
): ApitomyReferenceAdapter {
  assertApitomyLibrary(library)

  return {
    read(input) {
      if (typeof input === 'string') {
        return readString(library, input)
      }
      return library.readDocument(input)
    },

    write(document) {
      const serialized = serializeNode(library, document)
      if (typeof serialized === 'string') {
        return parseSerializedObject(serialized)
      }
      if (!isRecord(serialized)) {
        throw new ApitomyReferenceError(
          'invalid-output',
          'Apitomy reference serialization did not return a plain object or JSON string.',
        )
      }
      return serialized
    },

    writeJsonString(document) {
      if (library.writeDocumentToJSONString) {
        return library.writeDocumentToJSONString(document)
      }
      return `${JSON.stringify(this.write(document), null, 2)}\n`
    },

    validateNative(document, severityRegistry = null) {
      if (!library.validate) {
        throw new ApitomyReferenceError(
          'missing-capability',
          'The supplied Apitomy reference Library does not expose validate().',
        )
      }
      return library.validate(document, severityRegistry)
    },

    mapValidationProblems(problems) {
      return problems.map((problem, index) => toOaSdkLintResult(problem, index, options))
    },

    compareValidation(document, compareOptions = {}) {
      const raw = this.toOpenApiDocument(document)
      const validationOptions = { ...(compareOptions.validation ?? {}) }
      if (options.requireOpenApi32 && validationOptions.requireOpenApi32 === undefined) {
        validationOptions.requireOpenApi32 = true
      }
      const primary = validateDocument(raw, validationOptions)
      const problems = this.validateNative(document, compareOptions.severityRegistry)
      const referenceDiagnostics = this.mapValidationProblems(problems)
      const primaryDiagnostics = [...primary.errors, ...primary.warnings, ...primary.infos]
      const diagnosticComparison = compareDiagnostics(
        primaryDiagnostics,
        referenceDiagnostics,
      )
      const serialization = compareSerialization(compareOptions.sourceDocument, raw)
      const differences = [...diagnosticComparison.differences]
      if (serialization.checked && !serialization.equal) {
        differences.push({
          kind: 'serialization-loss',
          path: '/',
          message: 'Apitomy serialization changed the source document.',
        })
      }
      return {
        primary,
        reference: { problems, diagnostics: referenceDiagnostics },
        matched: diagnosticComparison.matched,
        primaryOnly: diagnosticComparison.primaryOnly,
        referenceOnly: diagnosticComparison.referenceOnly,
        differences,
        metadata: createMetadata(library, raw, compareOptions),
        serialization,
        status: differences.some(difference => difference.kind !== 'semantic-match')
          ? 'divergent'
          : 'match',
      }
    },

    toOpenApiDocument(document) {
      const raw = this.write(document)
      assertOpenApiDocument(raw, options)
      return raw as OasDocument
    },

    parseToOaSdk(document, parseOptions) {
      return parseDocument(this.toOpenApiDocument(document), parseOptions)
    },

    readAndParse(input, parseOptions) {
      return this.parseToOaSdk(this.read(input), parseOptions)
    },

    transformReference(document, targetModelType) {
      if (!library.transformDocument) {
        throw new ApitomyReferenceError(
          'missing-capability',
          'The supplied Apitomy reference Library does not expose transformDocument().',
        )
      }
      return library.transformDocument(document, targetModelType)
    },
  }
}

export function createApitomyReferenceAdapterFromModule(
  moduleValue: unknown,
  options: ApitomyReferenceAdapterOptions = {},
): ApitomyReferenceAdapter {
  const module = unwrapModule(moduleValue)
  if (!isRecord(module) || !('Library' in module)) {
    throw new ApitomyReferenceError(
      'invalid-library',
      'The supplied module does not expose Apitomy Data Models Library for reference use.',
    )
  }
  return createApitomyReferenceAdapter(module.Library as ApitomyReferenceLibrary, options)
}

export async function loadApitomyDataModels(
  importer: (specifier: string) => Promise<unknown> = defaultModuleImporter,
): Promise<ApitomyReferenceModule> {
  try {
    const loaded = await importer(APITOMY_DATA_MODELS_PACKAGE)
    const module = unwrapModule(loaded)
    if (!isRecord(module) || !('Library' in module)) {
      throw new ApitomyReferenceError(
        'invalid-library',
        `Installed ${APITOMY_DATA_MODELS_PACKAGE} does not expose Library.`,
      )
    }
    return module as unknown as ApitomyReferenceModule
  } catch (error) {
    if (error instanceof ApitomyReferenceError) throw error
    const missing = isMissingModuleError(error)
    throw new ApitomyReferenceError(
      missing ? 'dependency-not-installed' : 'dependency-load-failed',
      missing
        ? `Install ${APITOMY_DATA_MODELS_PACKAGE} to use the optional Apitomy reference probe.`
        : `Unable to load ${APITOMY_DATA_MODELS_PACKAGE} for the optional Apitomy reference probe: ${formatError(error)}`,
    )
  }
}

function assertApitomyLibrary(value: unknown): asserts value is ApitomyReferenceLibrary {
  if (
    (typeof value !== 'object' && typeof value !== 'function')
    || value === null
    || typeof (value as { readDocument?: unknown }).readDocument !== 'function'
  ) {
    throw new ApitomyReferenceError(
      'invalid-library',
      'An Apitomy Library with readDocument() is required.',
    )
  }
  const library = value as ApitomyReferenceLibrary
  if (
    typeof library.writeNode !== 'function'
    && typeof library.writeDocument !== 'function'
    && typeof library.writeDocumentToJSONString !== 'function'
  ) {
    throw new ApitomyReferenceError(
      'invalid-library',
      'The supplied Apitomy Library exposes no supported serialization method.',
    )
  }
}

function readString(library: ApitomyReferenceLibrary, input: string): ApitomyReferenceDocument {
  try {
    if (library.readDocumentFromJSONString) {
      return library.readDocumentFromJSONString(input)
    }
    return library.readDocument(JSON.parse(input) as Record<string, unknown>)
  } catch (jsonError) {
    try {
      const parsed = parseYaml(input) as unknown
      if (!isRecord(parsed)) {
        throw new Error('YAML root is not an object')
      }
      return library.readDocument(parsed)
    } catch (yamlError) {
      throw new ApitomyReferenceError(
        'invalid-input',
        `Unable to parse Apitomy input as JSON or YAML: ${formatError(yamlError ?? jsonError)}`,
      )
    }
  }
}

function serializeNode(library: ApitomyReferenceLibrary, document: ApitomyReferenceDocument): unknown {
  if (library.writeNode) return library.writeNode(document)
  if (library.writeDocument) return library.writeDocument(document)
  if (library.writeDocumentToJSONString) return library.writeDocumentToJSONString(document)
  throw new ApitomyReferenceError(
    'missing-capability',
    'The supplied Apitomy Library exposes no supported serialization method.',
  )
}

function parseSerializedObject(serialized: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(serialized) as unknown
    if (!isRecord(parsed)) throw new Error('serialized root is not an object')
    return parsed
  } catch (error) {
    throw new ApitomyReferenceError(
      'invalid-output',
      `Apitomy serialization returned invalid JSON: ${formatError(error)}`,
    )
  }
}

function assertOpenApiDocument(
  value: Record<string, unknown>,
  options: ApitomyReferenceAdapterOptions,
): void {
  const version = value.openapi
  if (typeof version !== 'string' || !version.startsWith('3.')) {
    throw new ApitomyReferenceError(
      'unsupported-document',
      'The oa-sdk reference bridge currently accepts OpenAPI 3.x documents only.',
    )
  }
  if (options.requireOpenApi32 && !version.startsWith('3.2')) {
    throw new ApitomyReferenceError(
      'unsupported-document',
      `The oa-sdk reference bridge requires OpenAPI 3.2.x, received ${version}.`,
    )
  }
}

function toOaSdkLintResult(
  problem: ApitomyReferenceValidationProblem,
  index: number,
  options: ApitomyReferenceAdapterOptions,
): LintResult {
  const code = typeof problem.errorCode === 'string' && problem.errorCode.length > 0
    ? problem.errorCode
    : `apitomy/validation-${index + 1}`
  const message = typeof problem.message === 'string' && problem.message.length > 0
    ? problem.message
    : 'Apitomy validation problem'
  const path = resolveDiagnosticPath(problem, options)

  return {
    path,
    severity: normalizeSeverity(problem.severity),
    rule: `apitomy/${code}`,
    message,
  }
}

function compareDiagnostics(
  primary: LintResult[],
  reference: LintResult[],
): Pick<ApitomyReferenceComparison, 'matched' | 'primaryOnly' | 'referenceOnly' | 'differences'> {
  const remaining = new Map<string, LintResult[]>()
  for (const diagnostic of reference) {
    const key = diagnosticKey(diagnostic)
    const values = remaining.get(key) ?? []
    values.push(diagnostic)
    remaining.set(key, values)
  }

  const matched: LintResult[] = []
  const matchedPairs: Array<{ primary: LintResult; reference: LintResult }> = []
  const primaryOnly: LintResult[] = []
  for (const diagnostic of primary) {
    const key = diagnosticKey(diagnostic)
    const values = remaining.get(key)
    const referenceDiagnostic = values?.shift()
    if (referenceDiagnostic) {
      matched.push(diagnostic)
      matchedPairs.push({ primary: diagnostic, reference: referenceDiagnostic })
      if (values?.length === 0) remaining.delete(key)
    } else {
      primaryOnly.push(diagnostic)
    }
  }

  const referenceOnly = [...remaining.values()].flat()
  const differences: ApitomyReferenceDiagnosticDifference[] = matchedPairs.map(pair => ({
    kind: 'semantic-match',
    primary: pair.primary,
    reference: pair.reference,
  }))

  const pathMatchedPrimary = new Set<LintResult>()
  const pathMatchedReference = new Set<LintResult>()
  for (const primaryDiagnostic of primaryOnly) {
    const referenceDiagnostic = referenceOnly.find(candidate =>
      !pathMatchedReference.has(candidate)
      && candidate.severity === primaryDiagnostic.severity
      && normalizeDiagnosticMessage(candidate.message) === normalizeDiagnosticMessage(primaryDiagnostic.message),
    )
    if (referenceDiagnostic) {
      pathMatchedPrimary.add(primaryDiagnostic)
      pathMatchedReference.add(referenceDiagnostic)
      differences.push({
        kind: 'path-mapping-failed',
        primary: primaryDiagnostic,
        reference: referenceDiagnostic,
      })
    }
  }

  for (const diagnostic of primaryOnly) {
    if (!pathMatchedPrimary.has(diagnostic)) {
      differences.push({ kind: 'oa-sdk-only', primary: diagnostic })
    }
  }
  for (const diagnostic of referenceOnly) {
    if (!pathMatchedReference.has(diagnostic)) {
      differences.push({
        kind: referenceOnlyKind(diagnostic),
        reference: diagnostic,
      })
    }
  }
  return { matched, primaryOnly, referenceOnly, differences }
}

function normalizeDiagnosticMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().toLowerCase()
}

function referenceOnlyKind(diagnostic: LintResult): ApitomyReferenceDifferenceKind {
  return diagnostic.rule === 'apitomy/UNKNOWN-001'
    ? 'unsupported-by-reference'
    : 'apitomy-only'
}

function compareSerialization(
  sourceDocument: Record<string, unknown> | undefined,
  referenceDocument: Record<string, unknown>,
): ApitomyReferenceSerialization {
  if (!sourceDocument) return { checked: false, equal: true }
  return {
    checked: true,
    equal: stableStringify(sourceDocument) === stableStringify(referenceDocument),
  }
}

function createMetadata(
  library: ApitomyReferenceLibrary,
  document: Record<string, unknown>,
  options: ApitomyReferenceCompareOptions,
): ApitomyReferenceMetadata {
  const capabilities = [
    typeof library.readDocument === 'function' ? 'read' : undefined,
    typeof library.readDocumentFromJSONString === 'function' ? 'read-json-string' : undefined,
    typeof library.writeNode === 'function' || typeof library.writeDocument === 'function'
      || typeof library.writeDocumentToJSONString === 'function' ? 'write' : undefined,
    typeof library.validate === 'function' ? 'validate' : undefined,
    typeof library.transformDocument === 'function' ? 'transform' : undefined,
  ].filter((capability): capability is string => capability !== undefined)

  const documentVersion = typeof document.openapi === 'string' ? document.openapi : undefined
  const metadata: ApitomyReferenceMetadata = {
    adapterVersion: APITOMY_REFERENCE_ADAPTER_VERSION,
    provider: 'apitomy',
    providerPackage: APITOMY_DATA_MODELS_PACKAGE,
    capabilities,
  }
  if (options.providerVersion !== undefined) metadata.providerVersion = options.providerVersion
  if (options.inputHash !== undefined) metadata.inputHash = options.inputHash
  if (documentVersion !== undefined) metadata.documentVersion = documentVersion
  return metadata
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value !== 'object') return JSON.stringify(value)
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function diagnosticKey(diagnostic: LintResult): string {
  return [diagnostic.path, diagnostic.severity, diagnostic.message.replace(/\s+/g, ' ').trim()]
    .join('\u0000')
}

function resolveDiagnosticPath(
  problem: ApitomyReferenceValidationProblem,
  options: ApitomyReferenceAdapterOptions,
): string {
  if (options.nodePathToString) {
    const path = options.nodePathToString(problem.nodePath)
    if (path) return appendProperty(path, problem.property)
  }
  if (typeof problem.nodePath === 'string') return appendProperty(problem.nodePath, problem.property)
  if (problem.nodePath && typeof problem.nodePath === 'object') {
    const segments = (problem.nodePath as { segments?: unknown }).segments
    if (Array.isArray(segments)) {
      const path = `/${segments.map(segment => {
        if (!segment || typeof segment !== 'object') return String(segment)
        const value = (segment as { value?: unknown }).value
        return encodeJsonPointerToken(String(value ?? ''))
      }).join('/')}`
      return appendProperty(path, problem.property)
    }
    const rendered = String(problem.nodePath)
    if (rendered !== '[object Object]') return appendProperty(rendered, problem.property)
  }
  if (typeof problem.property === 'string' && problem.property.length > 0) {
    return `/${problem.property}`
  }
  return '/'
}

function normalizeSeverity(value: unknown): LintSeverity {
  if (typeof value === 'number') {
    if (value >= 3) return 'error'
    if (value >= 2) return 'warning'
    return 'info'
  }
  const severity = typeof value === 'string' ? value.toLowerCase() : ''
  if (severity === 'error' || severity === 'high' || severity === 'critical') return 'error'
  if (severity === 'warning' || severity === 'warn' || severity === 'medium') return 'warning'
  return 'info'
}

function appendProperty(path: string, property: unknown): string {
  if (typeof property !== 'string' || property.length === 0 || path === '/') return path
  const token = encodeJsonPointerToken(property)
  return path.endsWith(`/${token}`) ? path : `${path}/${token}`
}

function encodeJsonPointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function unwrapModule(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ('Library' in value) return value
  const defaultValue = value.default
  if (isRecord(defaultValue) && 'Library' in defaultValue) return defaultValue
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingModuleError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code === 'ERR_MODULE_NOT_FOUND' || candidate.code === 'MODULE_NOT_FOUND') return true
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  return /cannot find (?:package|module)|module not found|ERR_MODULE_NOT_FOUND/i.test(message)
}

type DynamicImporter = (specifier: string) => Promise<unknown>

// Keep the optional package out of the static dependency graph. Consumers that
// already installed it can call loadApitomyDataModels(), while tests and hosts
// can inject a resolver without loading Node's module system themselves.
const defaultModuleImporter = new Function(
  'specifier',
  'return import(specifier)',
) as DynamicImporter
