/**
 * Operation-method client adapter between pluginClient and pluginTanstackQuery.
 *
 * The TanStack Query generators in @oa-sdk/client call a client object with one method per
 * operation and positional arguments: `client.petsGetPetById(params, headers, { signal })`,
 * resolving to the response payload. pluginClient emits openapi-ts style standalone functions
 * instead: `petsGetPetById({ client, path, headers, signal })`, resolving to `{ data, error, response }`.
 *
 * This module renders `api-client.ts`: an `ApiClient` interface with exactly the positional
 * signatures the TanStack generators call, and a `createApiClient(client?)` factory that
 * implements each method by forwarding to the matching pluginClient function and settling its
 * `{ data, error, response }` result:
 * - a 2xx response resolves to `data`;
 * - a failed response whose status the operation declares a JSON error model for rejects with the
 *   parsed error body, which is what the TanStack code types as the query/mutation error
 *   (`<Base>Error`, the union of the declared error models);
 * - any other failed response (an undeclared status, an empty body, or an operation without error
 *   models, whose TanStack error type is `Error`) rejects with an `ApiClientResponseError` carrying
 *   `status`, `body` and `response`.
 *
 * @oa-sdk/codegen
 */

import {
  createOperationTypeNameMap,
  formatGeneratedTs,
  toOperationMethodName,
} from '@oa-sdk/core'
import type {
  OasMediaType,
  OasReference,
  OasRequestBody,
  OasResponse,
  OperationEntry,
  ParsedDocument,
} from '@oa-sdk/parser'
import { renderMemberName } from '../identifiers.js'
import type { ClientSdkManifest, RenderedClientOperation } from './client.js'

export interface RenderTanstackClientAdapterOptions {
  /** Parsed document the TanStack generators were given */
  parsed: ParsedDocument
  /** SDK published by pluginClient */
  sdk: ClientSdkManifest
  /** Module specifier of the pluginClient module, relative to the adapter file */
  clientImport: string
  /** Module specifier of the pluginTypescript module, relative to the adapter file */
  typesImport: string
  /** Name of the exported operation-method interface (pluginTanstackQuery's `clientName`). Default: 'ApiClient' */
  interfaceName?: string | undefined
  /** Whether to add the generated-file banner comment. Default: true */
  banner?: boolean | undefined
}

/** An argument of an operation's TanStack call that cannot be forwarded to the pluginClient SDK. */
export interface TanstackClientAdapterIssue {
  operationId: string
  reason: string
  /**
   * True when the argument is required, so the adapter method rejects on every call;
   * false when it is optional and the method rejects only when the argument is passed.
   */
  always: boolean
}

export interface TanstackClientAdapterResult {
  code: string
  exports: string[]
  /** Name of the exported factory (e.g. 'createApiClient') */
  factoryName: string
  /** Name of the exported Error subclass failed responses without a declared error body reject with (e.g. 'ApiClientResponseError') */
  errorClassName: string
  /** Arguments the SDK cannot send; their methods reject (always, or when the argument is passed) */
  unsupported: TanstackClientAdapterIssue[]
  /** Operations the TanStack code calls but pluginClient emitted no function for */
  missing: string[]
}

function isReference(value: object): value is OasReference {
  return '$ref' in value && typeof value.$ref === 'string'
}

function jsonMedia(
  content: Record<string, OasMediaType | OasReference> | undefined,
): OasMediaType | undefined {
  const media = content?.['application/json']
  return media && !isReference(media) ? media : undefined
}

// The predicates below mirror @oa-sdk/client's TanStack options generator, which decides the
// argument and return types of every `client.<operation>(...)` call the adapter must accept.

function hasGeneratedRequestBodyType(requestBody: OasRequestBody | undefined): boolean {
  return jsonMedia(requestBody?.content)?.schema !== undefined
}

function hasGeneratedResponseType(responses: Record<string, OasResponse>): boolean {
  const key = Object.keys(responses).filter(code => /^2\d{2}$/.test(code) || code === 'default').sort()[0]
  if (!key) return false
  return jsonMedia(responses[key]?.content)?.schema !== undefined
}

function hasDocumentedSuccessResponseBody(responses: Record<string, OasResponse>): boolean {
  return Object.entries(responses).some(([status, response]) => {
    if (!(/^2\d{2}$/.test(status) || /^2XX$/i.test(status) || status === 'default')) return false
    if (status === '204' || status === '205') return false
    return response.content !== undefined && Object.keys(response.content).length > 0
  })
}

function hasInlineJsonSchema(response: OasResponse | undefined): boolean {
  return jsonMedia(response?.content)?.schema !== undefined
}

/**
 * Renders a `(status: number) => boolean` expression that is true for the failed response statuses
 * whose body the operation's `<Base>Error` type describes, or returns undefined when the operation
 * declares no such body.
 *
 * `<Base>Error` (pluginTypescript) is the union of the inline application/json schemas of the
 * explicit 4xx/5xx responses and of the `default` response, and the TanStack generators type the
 * query/mutation error as `<Base>Error` exactly when one of them exists (and as `Error` otherwise).
 * A status is covered by the response entry OpenAPI selects for it: its explicit status code first,
 * then its `NXX` range, then `default`. So `default` describes only statuses no other entry covers.
 */
function renderDeclaredErrorStatusPredicate(responses: Record<string, OasResponse>): string | undefined {
  const typed: number[] = []
  const untyped: number[] = []
  const untypedRanges: number[] = []
  for (const [key, response] of Object.entries(responses)) {
    if (/^[45]\d{2}$/.test(key) && hasInlineJsonSchema(response)) typed.push(Number(key))
    else if (/^[13-5]\d{2}$/.test(key)) untyped.push(Number(key))
    else if (/^[13-5]XX$/i.test(key)) untypedRanges.push(Number(key.charAt(0)))
  }
  const byNumber = (left: number, right: number): number => left - right
  const conditions = typed.sort(byNumber).map(status => `status === ${status}`)

  if (hasInlineJsonSchema(responses.default)) {
    const exclusions = [
      ...untyped.sort(byNumber).map(status => `status !== ${status}`),
      ...untypedRanges.sort(byNumber).map(range => `Math.trunc(status / 100) !== ${range}`),
    ]
    if (exclusions.length === 0) return '() => true'
    conditions.push(conditions.length > 0 && exclusions.length > 1 ? `(${exclusions.join(' && ')})` : exclusions.join(' && '))
  }
  return conditions.length > 0 ? `status => ${conditions.join(' || ')}` : undefined
}

/** Returns `base`, or `base` + `suffix` (+ a counter) when that name is already taken. */
function uniqueLocalName(base: string, suffix: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let candidate = `${base}${suffix}`
  for (let index = 2; taken.has(candidate); index++) candidate = `${base}${suffix}${index}`
  return candidate
}

interface AdapterParameter {
  /** Parameter name in the positional signature */
  name: 'params' | 'body' | 'querystring' | 'query' | 'headers'
  /** Declared TypeScript type */
  type: string
  optional: boolean
}

interface AdapterMethod {
  operationId: string
  /**
   * Property name the TanStack code calls (`client.<methodName>(...)`). It is emitted through
   * renderMemberName, so a reserved word such as `new` stays a method of the interface and the object.
   */
  methodName: string
  parameters: AdapterParameter[]
  returnType: string
  /** JsonPrimitive<...> payload type, or undefined for `Promise<void>` */
  payloadType: string | undefined
  /** See renderDeclaredErrorStatusPredicate */
  declaredErrorStatus: string | undefined
  sdkOperation: RenderedClientOperation | undefined
}

/**
 * Positional parameters in the exact order the TanStack options generator passes them.
 */
function collectParameters(op: OperationEntry, baseName: string): AdapterParameter[] {
  const parameters: AdapterParameter[] = []
  const hasPath = op.parameters.some(p => p.in === 'path')
  const hasQuery = op.parameters.some(p => p.in === 'query')
  const querystring = op.parameters.find(p => p.in === 'querystring')
  const hasHeaders = op.parameters.some(p => p.in === 'header')
  const hasBody = op.requestBody !== undefined
  const bodyRequired = op.requestBody?.required === true
  const bodyType = hasGeneratedRequestBodyType(op.requestBody) ? `Resolved<${baseName}Body>` : 'unknown'

  if (hasPath) parameters.push({ name: 'params', type: `${baseName}PathParams`, optional: false })
  if (hasBody && bodyRequired) parameters.push({ name: 'body', type: bodyType, optional: false })
  if (querystring?.required === true) {
    parameters.push({ name: 'querystring', type: `${baseName}QueryString`, optional: false })
  }
  if (hasQuery) parameters.push({ name: 'query', type: `${baseName}QueryParams`, optional: true })
  if (querystring && querystring.required !== true) {
    parameters.push({ name: 'querystring', type: `${baseName}QueryString`, optional: true })
  }
  if (hasBody && !bodyRequired) parameters.push({ name: 'body', type: bodyType, optional: true })
  if (hasHeaders) parameters.push({ name: 'headers', type: `${baseName}HeaderParams`, optional: true })
  return parameters
}

/** The SDK option a positional argument is forwarded as, or undefined when the SDK function cannot send it. */
function forwardedField(name: AdapterParameter['name'], sdkOp: RenderedClientOperation): string | undefined {
  switch (name) {
    case 'params': return sdkOp.hasPathParams ? 'path: params' : undefined
    case 'query': return sdkOp.hasQueryParams ? 'query' : undefined
    case 'headers': return sdkOp.hasHeaderParams ? 'headers' : undefined
    case 'body': return sdkOp.hasBody ? 'body' : undefined
    case 'querystring': return undefined
  }
}

function unsupportedArgument(name: AdapterParameter['name']): string {
  switch (name) {
    case 'params': return 'path parameters'
    case 'query': return 'query parameters'
    case 'headers': return 'header parameters'
    case 'body': return 'non-JSON request bodies'
    case 'querystring': return "'querystring' parameters"
  }
}

/** Type names a declared type refers to that come from the types module. */
function typeModuleReferences(type: string): string[] {
  const match = /^(?:Resolved<|JsonPrimitive<)?([A-Z][A-Za-z0-9_$]*)>?$/.exec(type)
  return match?.[1] ? [match[1]] : []
}

/**
 * Renders the operation-method adapter module for the given pluginClient SDK.
 */
export function renderTanstackClientAdapter(options: RenderTanstackClientAdapterOptions): TanstackClientAdapterResult {
  const { parsed, sdk, clientImport, typesImport, banner = true } = options
  const interfaceName = options.interfaceName ?? 'ApiClient'
  const callOptionsName = `${interfaceName}CallOptions`
  const factoryName = `create${interfaceName.charAt(0).toUpperCase()}${interfaceName.slice(1)}`
  const errorClassName = `${interfaceName}ResponseError`

  const operationNames = createOperationTypeNameMap(parsed.operations)
  const sdkByOperationId = new Map<string, RenderedClientOperation>()
  for (const sdkOp of sdk.operations) {
    if (sdkOp.operationId !== undefined) sdkByOperationId.set(sdkOp.operationId, sdkOp)
  }

  const methods: AdapterMethod[] = []
  for (const op of parsed.operations) {
    if (!op.operationId) continue
    const baseName = operationNames.get(op.operationId)
    if (!baseName) continue
    const hasResponse = hasDocumentedSuccessResponseBody(op.responses)
    const payloadType = hasResponse
      ? `JsonPrimitive<${hasGeneratedResponseType(op.responses) ? `${baseName}Response` : 'unknown'}>`
      : undefined
    methods.push({
      operationId: op.operationId,
      methodName: toOperationMethodName(baseName),
      parameters: collectParameters(op, baseName),
      returnType: payloadType ? `Promise<${payloadType}>` : 'Promise<void>',
      payloadType,
      declaredErrorStatus: renderDeclaredErrorStatusPredicate(op.responses),
      sdkOperation: sdkByOperationId.get(op.operationId),
    })
  }

  const unsupported: TanstackClientAdapterIssue[] = []
  const missing: string[] = []

  // Names the adapter declares (module scope) or binds inside the method implementations;
  // imported SDK names that clash with them are aliased.
  const settleName = 'settleSdkResult'
  const resultTypeName = 'SdkCallResult'
  const declaredNames = new Set([interfaceName, callOptionsName, factoryName, errorClassName, settleName, resultTypeName])
  const methodScopeNames = ['client', 'params', 'body', 'query', 'querystring', 'headers', 'options', 'result']
  const sdkFunctionNames = new Set(methods.flatMap(method => method.sdkOperation ? [method.sdkOperation.functionName] : []))
  const sdkTypeLocalName = uniqueLocalName(sdk.clientName, 'Transport', new Set([...declaredNames, ...sdkFunctionNames]))
  const reservedForFunctions = new Set([...declaredNames, ...methodScopeNames, ...(sdk.clientClass ? [sdkTypeLocalName] : [])])
  const takenLocalNames = new Set([...reservedForFunctions, ...sdkFunctionNames])
  const sdkFunctionLocalNames = new Map<string, string>()
  const sdkImportSpecifiers: string[] = []
  for (const functionName of sdkFunctionNames) {
    const localName = reservedForFunctions.has(functionName)
      ? uniqueLocalName(functionName, 'Operation', takenLocalNames)
      : functionName
    takenLocalNames.add(localName)
    sdkFunctionLocalNames.set(functionName, localName)
    sdkImportSpecifiers.push(localName === functionName ? localName : `${functionName} as ${localName}`)
  }

  const typeImports = new Set<string>()
  let usesJsonPrimitive = false
  let usesResolved = false
  for (const method of methods) {
    for (const parameter of method.parameters) {
      for (const name of typeModuleReferences(parameter.type)) typeImports.add(name)
      if (parameter.type.startsWith('Resolved<')) usesResolved = true
    }
    if (method.payloadType) {
      usesJsonPrimitive = true
      for (const name of typeModuleReferences(method.payloadType)) typeImports.add(name)
    }
  }

  /** Forwards one method to its SDK function, or rejects when the SDK cannot send its arguments. */
  function renderMethodBody(method: AdapterMethod): string[] {
    const sdkOp = method.sdkOperation
    if (!sdkOp) {
      missing.push(method.operationId)
      return [`      throw new Error(${JSON.stringify(`pluginClient emitted no function for operation "${method.operationId}"`)})`]
    }

    const fields: string[] = sdk.clientClass ? ['client'] : []
    const optionalGuards: string[] = []
    let alwaysUnsupported: string | undefined
    for (const parameter of method.parameters) {
      const forwarded = forwardedField(parameter.name, sdkOp)
      if (forwarded) {
        fields.push(forwarded)
        continue
      }
      const message = `pluginClient cannot send ${unsupportedArgument(parameter.name)} for operation "${method.operationId}"`
      unsupported.push({ operationId: method.operationId, reason: message, always: !parameter.optional })
      if (parameter.optional) {
        optionalGuards.push(`      if (${parameter.name} !== undefined) throw new Error(${JSON.stringify(message)})`)
      } else {
        alwaysUnsupported ??= message
      }
    }
    if (alwaysUnsupported) return [`      throw new Error(${JSON.stringify(alwaysUnsupported)})`]

    fields.push('signal: options?.signal', 'throwOnError: false')
    const call = `${sdkFunctionLocalNames.get(sdkOp.functionName) ?? sdkOp.functionName}({ ${fields.join(', ')} })`
    const settle = `${settleName}(result${method.declaredErrorStatus ? `, ${method.declaredErrorStatus}` : ''})`
    const body = [...optionalGuards, `      const result = await ${call}`]
    if (!method.payloadType) body.push(`      ${settle}`)
    else if (method.payloadType === 'JsonPrimitive<unknown>') body.push(`      return ${settle}`)
    else body.push(`      return ${settle} as ${method.payloadType}`)
    return body
  }

  const lines: string[] = []
  if (banner) {
    lines.push('// @generated by @oa-sdk/codegen (pluginTanstackQuery client adapter). DO NOT EDIT.')
    lines.push('// Bridges the openapi-ts style pluginClient SDK to the operation-method client the TanStack Query code calls.')
    lines.push('')
  }

  const clientLibraryTypes = [usesJsonPrimitive ? 'JsonPrimitive' : '', usesResolved ? 'Resolved' : ''].filter(Boolean)
  if (clientLibraryTypes.length > 0) {
    lines.push(`import type { ${clientLibraryTypes.join(', ')} } from '@oa-sdk/client'`)
  }
  if (typeImports.size > 0) {
    lines.push(`import type { ${Array.from(typeImports).sort().join(', ')} } from '${typesImport}'`)
  }
  const clientModuleSpecifiers = [
    ...(sdk.clientClass
      ? [sdkTypeLocalName === sdk.clientName ? `type ${sdk.clientName}` : `type ${sdk.clientName} as ${sdkTypeLocalName}`]
      : []),
    ...sdkImportSpecifiers,
  ]
  if (clientModuleSpecifiers.length > 0) {
    lines.push(`import { ${clientModuleSpecifiers.join(', ')} } from '${clientImport}'`)
  }
  lines.push('')

  lines.push(`/** Per-call options accepted as the last argument of every ${interfaceName} method. */`)
  lines.push(`export interface ${callOptionsName} {`)
  lines.push('  signal?: AbortSignal | null | undefined')
  lines.push('}')
  lines.push('')

  lines.push('/**')
  lines.push(` * Rejection value of ${interfaceName} calls whose failed (non-2xx) response carries no error body the`)
  lines.push(' * operation declares: a status without a declared application/json error model, an empty body, or')
  lines.push(' * any failure of an operation that declares no error models (whose TanStack error type is `Error`).')
  lines.push(' * A declared error body rejects as the parsed body itself, which is what the TanStack code types')
  lines.push(' * as the error (`<Operation>Error`); this class is not part of that type, so narrow with `instanceof`.')
  lines.push(' */')
  lines.push(`export class ${errorClassName} extends Error {`)
  lines.push('  /** HTTP status of the failed response */')
  lines.push('  readonly status: number')
  lines.push('  /** Parsed response body (JSON, or text when it is not JSON); undefined when the body was empty */')
  lines.push('  readonly body: unknown')
  lines.push('  /** The failed response */')
  lines.push('  readonly response: Response')
  lines.push('')
  lines.push('  constructor(response: Response, body: unknown) {')
  lines.push("    const detail = body === undefined ? '' : `: ${typeof body === 'string' ? body : JSON.stringify(body)}`")
  lines.push('    super(`HTTP Error ${response.status}${detail}`)')
  lines.push(`    this.name = '${errorClassName}'`)
  lines.push('    this.status = response.status')
  lines.push('    this.body = body')
  lines.push('    this.response = response')
  lines.push('  }')
  lines.push('}')
  lines.push('')

  lines.push('/**')
  lines.push(` * Operation-method client consumed by the generated TanStack Query options and hooks.`)
  lines.push(` * Create one with \`${factoryName}()\`.`)
  lines.push(' */')
  lines.push(`export interface ${interfaceName} {`)
  for (const method of methods) {
    const signature = [
      ...method.parameters.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}${p.optional ? ' | undefined' : ''}`),
      `options?: ${callOptionsName} | undefined`,
    ].join(', ')
    lines.push(`  ${renderMemberName(method.methodName)}(${signature}): ${method.returnType}`)
  }
  lines.push('}')
  lines.push('')

  lines.push('/** The part of a pluginClient result the adapter reads. */')
  lines.push(`interface ${resultTypeName} {`)
  lines.push('  data: unknown')
  lines.push('  error: unknown')
  lines.push('  response: Response')
  lines.push('}')
  lines.push('')
  lines.push('/**')
  lines.push(' * Resolves a successful result to its payload. A failed one rejects with its parsed error body when')
  lines.push(' * `isDeclaredErrorStatus(status)` (the operation declares a JSON error model for that status), and with')
  lines.push(` * an ${errorClassName} otherwise.`)
  lines.push(' */')
  lines.push(`function ${settleName}(result: ${resultTypeName}, isDeclaredErrorStatus?: (status: number) => boolean): unknown {`)
  lines.push('  if (result.response.ok) return result.data')
  lines.push('  if (result.error !== undefined && isDeclaredErrorStatus?.(result.response.status) === true) throw result.error')
  lines.push(`  throw new ${errorClassName}(result.response, result.error)`)
  lines.push('}')
  lines.push('')

  lines.push('/**')
  lines.push(` * Creates the ${interfaceName} for the TanStack Query code on top of the pluginClient SDK.`)
  lines.push(' * Each method calls its SDK function with `throwOnError: false` (overriding the client configuration)')
  lines.push(' * and resolves to the response payload. A failed response rejects with the parsed error body when the')
  lines.push(` * operation declares a JSON error model for its status, and with an ${errorClassName} otherwise.`)
  if (sdk.clientClass) {
    lines.push(` * @param client SDK client instance; omitted, each call uses the SDK's current default client.`)
  }
  lines.push(' */')

  lines.push(sdk.clientClass
    ? `export function ${factoryName}(client?: ${sdkTypeLocalName}): ${interfaceName} {`
    : `export function ${factoryName}(): ${interfaceName} {`)
  lines.push('  return {')

  for (const method of methods) {
    const parameterNames = [...method.parameters.map(p => p.name), 'options']
    lines.push(`    async ${renderMemberName(method.methodName)}(${parameterNames.join(', ')}) {`)
    lines.push(...renderMethodBody(method))
    lines.push('    },')
  }

  lines.push('  }')
  lines.push('}')
  lines.push('')

  return {
    code: formatGeneratedTs(lines.join('\n')),
    exports: [callOptionsName, errorClassName, interfaceName, factoryName],
    factoryName,
    errorClassName,
    unsupported,
    missing,
  }
}
