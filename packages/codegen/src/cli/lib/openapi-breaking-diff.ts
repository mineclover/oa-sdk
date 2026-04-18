export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
const IGNORED_SCHEMA_KEYS = new Set(['description', 'examples', 'example', 'title'])
const UNORDERED_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'enum', 'oneOf', 'required'])

export interface EndpointParameter {
  key: string
  name: string
  in: string
  required: boolean
  schemaFingerprint?: string
}

export interface Endpoint {
  path: string
  method: HttpMethod
  operationId?: string
  summary?: string
  parameters: string[]
  parameterDetails: EndpointParameter[]
  responses: string[]
  requestBodyRequired: boolean
  requestBodyRequiredFields: string[]
  requestBodySchemaFingerprint?: string
  responseSchemaFingerprints: Record<string, string>
}

export interface DiffResult {
  added: Endpoint[]
  removed: Endpoint[]
  modified: { base: Endpoint; head: Endpoint; changes: string[] }[]
}

export type ChangeSeverity = 'breaking' | 'non-breaking'

export type ContractDiffChange = {
  code: string
  endpoint: string
  detail: string
  severity: ChangeSeverity
}

export function extractEndpoints(spec: Record<string, unknown>): Map<string, Endpoint> {
  const map = new Map<string, Endpoint>()
  const paths = readRecord(spec.paths)

  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue
    for (const method of HTTP_METHODS) {
      const op = item[method]
      if (!isRecord(op)) continue
      const parameters = collectParameters(item, op, spec)
      const endpoint: Endpoint = {
        path,
        method,
        parameters: parameters.map(p => p.key).sort(),
        parameterDetails: parameters,
        responses: Object.keys(readRecord(op.responses)).sort(),
        requestBodyRequired: isRequestBodyRequired(op.requestBody, spec),
        requestBodyRequiredFields: collectRequestBodyRequiredFields(op.requestBody, spec),
        responseSchemaFingerprints: collectResponseSchemaFingerprints(op.responses, spec),
      }
      if (typeof op.operationId === 'string') endpoint.operationId = op.operationId
      if (typeof op.summary === 'string') endpoint.summary = op.summary
      const requestBodySchemaFingerprint = schemaFingerprint(readJsonRequestSchema(op.requestBody, spec), spec)
      if (requestBodySchemaFingerprint !== undefined) {
        endpoint.requestBodySchemaFingerprint = requestBodySchemaFingerprint
      }
      map.set(endpointLabel(endpoint), endpoint)
    }
  }
  return map
}

export function diffEndpoints(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
): DiffResult {
  const baseMap = extractEndpoints(baseSpec)
  const headMap = extractEndpoints(headSpec)

  const added: Endpoint[] = []
  const removed: Endpoint[] = []
  const modified: DiffResult['modified'] = []

  for (const [key, endpoint] of headMap) {
    if (!baseMap.has(key)) added.push(endpoint)
  }

  for (const [key, endpoint] of baseMap) {
    if (!headMap.has(key)) removed.push(endpoint)
  }

  for (const [key, baseEndpoint] of baseMap) {
    const headEndpoint = headMap.get(key)
    if (!headEndpoint) continue

    const changes = endpointChangeLines(baseEndpoint, headEndpoint)
    if (changes.length > 0) modified.push({ base: baseEndpoint, head: headEndpoint, changes })
  }

  return {
    added: added.sort(compareEndpoints),
    removed: removed.sort(compareEndpoints),
    modified: modified.sort((left, right) => compareEndpoints(left.head, right.head)),
  }
}

export function classifyBreakingChanges(diff: DiffResult): ContractDiffChange[] {
  const changes: ContractDiffChange[] = []

  for (const endpoint of diff.removed) {
    changes.push(breaking('endpoint-removed', endpointLabel(endpoint), 'Endpoint was removed.'))
  }

  for (const { base, head } of diff.modified) {
    const endpoint = endpointLabel(head)
    if (base.operationId !== head.operationId) {
      changes.push(breaking(
        'operation-id-changed',
        endpoint,
        `operationId changed from ${formatValue(base.operationId)} to ${formatValue(head.operationId)}.`,
      ))
    }

    const baseParameters = parameterMap(base)
    const headParameters = parameterMap(head)
    for (const [key, parameter] of headParameters) {
      if (!baseParameters.has(key) && parameter.required) {
        changes.push(breaking('required-parameter-added', endpoint, `Required parameter ${key} was added.`))
      }
    }
    for (const [key] of baseParameters) {
      if (!headParameters.has(key)) {
        changes.push(breaking('parameter-removed', endpoint, `Parameter ${key} was removed.`))
      }
    }
    for (const [key, parameter] of headParameters) {
      const previous = baseParameters.get(key)
      if (previous && !previous.required && parameter.required) {
        changes.push(breaking('parameter-required', endpoint, `Parameter ${key} became required.`))
      }
      if (
        previous?.schemaFingerprint
        && parameter.schemaFingerprint
        && previous.schemaFingerprint !== parameter.schemaFingerprint
      ) {
        changes.push(breaking('parameter-schema-changed', endpoint, `Parameter ${key} schema changed.`))
      }
    }

    if (!base.requestBodyRequired && head.requestBodyRequired) {
      changes.push(breaking('request-body-required', endpoint, 'Request body became required.'))
    }

    for (const field of head.requestBodyRequiredFields) {
      if (!base.requestBodyRequiredFields.includes(field)) {
        changes.push(breaking(
          'request-required-field-added',
          endpoint,
          `Request body required field ${field} was added.`,
        ))
      }
    }

    if (
      base.requestBodySchemaFingerprint
      && head.requestBodySchemaFingerprint
      && base.requestBodySchemaFingerprint !== head.requestBodySchemaFingerprint
    ) {
      changes.push(breaking('request-schema-changed', endpoint, 'Request body schema changed.'))
    }

    for (const status of base.responses) {
      if (!head.responses.includes(status)) {
        changes.push(breaking('response-removed', endpoint, `Response ${status} was removed.`))
      }
    }

    for (const status of commonKeys(base.responseSchemaFingerprints, head.responseSchemaFingerprints)) {
      if (base.responseSchemaFingerprints[status] !== head.responseSchemaFingerprints[status]) {
        changes.push(breaking('response-schema-changed', endpoint, `Response ${status} schema changed.`))
      }
    }
  }

  return changes
}

export function classifyNonBreakingChanges(diff: DiffResult): ContractDiffChange[] {
  const changes: ContractDiffChange[] = []

  for (const endpoint of diff.added) {
    changes.push(nonBreaking('endpoint-added', endpointLabel(endpoint), 'Endpoint was added.'))
  }

  for (const { base, head } of diff.modified) {
    const endpoint = endpointLabel(head)
    const baseParameters = parameterMap(base)
    const headParameters = parameterMap(head)
    for (const [key, parameter] of headParameters) {
      if (!baseParameters.has(key) && !parameter.required) {
        changes.push(nonBreaking('optional-parameter-added', endpoint, `Optional parameter ${key} was added.`))
      }
    }
    for (const status of head.responses) {
      if (!base.responses.includes(status)) {
        changes.push(nonBreaking('response-added', endpoint, `Response ${status} was added.`))
      }
    }
    if (base.summary !== head.summary) {
      changes.push(nonBreaking('summary-changed', endpoint, 'Summary changed.'))
    }
  }

  return changes
}

export function hasBreakingChanges(diff: DiffResult): boolean {
  return classifyBreakingChanges(diff).length > 0
}

export function formatMarkdown(diff: DiffResult): string {
  const breaking = classifyBreakingChanges(diff)

  if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
    return '### API Spec Diff\n\nNo endpoint changes detected.'
  }

  const lines: string[] = ['### API Spec Diff\n']
  const summary = [
    diff.added.length && `**+${diff.added.length}** added`,
    diff.removed.length && `**-${diff.removed.length}** removed`,
    diff.modified.length && `**~${diff.modified.length}** modified`,
    breaking.length && `**!${breaking.length}** breaking`,
  ].filter(Boolean)
  lines.push(summary.join(' / ') + '\n')

  if (breaking.length) {
    lines.push('#### Breaking Changes')
    for (const change of breaking) {
      lines.push(`- \`${change.code}\` \`${change.endpoint}\` - ${change.detail}`)
    }
    lines.push('')
  }

  if (diff.added.length) {
    lines.push('#### Added')
    for (const endpoint of diff.added) {
      lines.push(`- \`${endpointLabel(endpoint)}\` - ${endpoint.summary ?? endpoint.operationId ?? ''}`)
    }
    lines.push('')
  }

  if (diff.removed.length) {
    lines.push('#### Removed')
    for (const endpoint of diff.removed) {
      lines.push(`- \`${endpointLabel(endpoint)}\` - ${endpoint.summary ?? endpoint.operationId ?? ''}`)
    }
    lines.push('')
  }

  if (diff.modified.length) {
    lines.push('#### Modified')
    for (const { head, changes } of diff.modified) {
      lines.push(`- \`${endpointLabel(head)}\``)
      for (const change of changes) lines.push(`  - ${change}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function endpointChangeLines(base: Endpoint, head: Endpoint): string[] {
  const changes: string[] = []

  if (base.operationId !== head.operationId) {
    changes.push(`operationId: \`${base.operationId}\` -> \`${head.operationId}\``)
  }
  if (base.summary !== head.summary) changes.push('summary changed')
  if (JSON.stringify(base.parameters) !== JSON.stringify(head.parameters)) {
    const addedParams = head.parameters.filter(parameter => !base.parameters.includes(parameter))
    const removedParams = base.parameters.filter(parameter => !head.parameters.includes(parameter))
    if (addedParams.length) changes.push(`params added: ${addedParams.join(', ')}`)
    if (removedParams.length) changes.push(`params removed: ${removedParams.join(', ')}`)
  }
  if (base.requestBodyRequired !== head.requestBodyRequired) {
    changes.push(`requestBody required: ${base.requestBodyRequired} -> ${head.requestBodyRequired}`)
  }
  if (JSON.stringify(base.requestBodyRequiredFields) !== JSON.stringify(head.requestBodyRequiredFields)) {
    const addedFields = head.requestBodyRequiredFields.filter(field => !base.requestBodyRequiredFields.includes(field))
    const removedFields = base.requestBodyRequiredFields.filter(field => !head.requestBodyRequiredFields.includes(field))
    if (addedFields.length) changes.push(`request required fields added: ${addedFields.join(', ')}`)
    if (removedFields.length) changes.push(`request required fields removed: ${removedFields.join(', ')}`)
  }
  if (base.requestBodySchemaFingerprint !== head.requestBodySchemaFingerprint) {
    changes.push('request body schema changed')
  }
  if (JSON.stringify(base.responses) !== JSON.stringify(head.responses)) {
    const addedResponses = head.responses.filter(response => !base.responses.includes(response))
    const removedResponses = base.responses.filter(response => !head.responses.includes(response))
    if (addedResponses.length) changes.push(`responses added: ${addedResponses.join(', ')}`)
    if (removedResponses.length) changes.push(`responses removed: ${removedResponses.join(', ')}`)
  }
  for (const code of commonKeys(base.responseSchemaFingerprints, head.responseSchemaFingerprints)) {
    if (base.responseSchemaFingerprints[code] !== head.responseSchemaFingerprints[code]) {
      changes.push(`response ${code} schema changed`)
    }
  }

  return changes
}

function collectParameters(
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
  document: Record<string, unknown>,
): EndpointParameter[] {
  const parameters = [
    ...readParameterArray(pathItem.parameters, document),
    ...readParameterArray(operation.parameters, document),
  ]
  const byKey = new Map<string, EndpointParameter>()

  for (const parameter of parameters) {
    const name = typeof parameter.name === 'string' ? parameter.name : undefined
    const location = typeof parameter.in === 'string' ? parameter.in : undefined
    if (!name || !location) continue
    const key = `${location}:${name}`
    const endpointParameter: EndpointParameter = {
      key,
      name,
      in: location,
      required: parameter.required === true || location === 'path',
    }
    const fingerprint = schemaFingerprint(parameter.schema, document)
    if (fingerprint !== undefined) endpointParameter.schemaFingerprint = fingerprint
    byKey.set(key, endpointParameter)
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function readParameterArray(value: unknown, document: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value
    .map(parameter => resolveMappingRef(parameter, document))
    .filter((parameter): parameter is Record<string, unknown> => isRecord(parameter))
}

function isRequestBodyRequired(value: unknown, document: Record<string, unknown>): boolean {
  const requestBody = resolveMappingRef(value, document)
  return isRecord(requestBody) && requestBody.required === true
}

function collectRequestBodyRequiredFields(value: unknown, document: Record<string, unknown>): string[] {
  const schema = normalizeSchema(readJsonRequestSchema(value, document), document)
  if (!isRecord(schema) || !Array.isArray(schema.required)) return []
  return schema.required.filter((field): field is string => typeof field === 'string').sort()
}

function collectResponseSchemaFingerprints(
  value: unknown,
  document: Record<string, unknown>,
): Record<string, string> {
  if (!isRecord(value)) return {}
  const fingerprints: Record<string, string> = {}
  for (const [status, response] of Object.entries(value)) {
    const schema = readJsonResponseSchema(response, document)
    const fingerprint = schemaFingerprint(schema, document)
    if (fingerprint !== undefined) fingerprints[status] = fingerprint
  }
  return fingerprints
}

function readJsonRequestSchema(value: unknown, document: Record<string, unknown>): unknown {
  const requestBody = resolveMappingRef(value, document)
  if (!isRecord(requestBody)) return undefined
  return readJsonContentSchema(requestBody.content, document)
}

function readJsonResponseSchema(value: unknown, document: Record<string, unknown>): unknown {
  const response = resolveMappingRef(value, document)
  if (!isRecord(response)) return undefined
  return readJsonContentSchema(response.content, document)
}

function readJsonContentSchema(value: unknown, document: Record<string, unknown>): unknown {
  if (!isRecord(value)) return undefined
  const json = resolveMappingRef(value['application/json'], document)
  if (!isRecord(json)) return undefined
  return json.schema
}

function schemaFingerprint(value: unknown, document: Record<string, unknown>): string | undefined {
  if (value === undefined) return undefined
  return stableStringify(normalizeSchema(value, document))
}

function normalizeSchema(
  value: unknown,
  document: Record<string, unknown>,
  seenRefs: Set<string> = new Set(),
  parentKey?: string,
): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map(item => normalizeSchema(item, document, seenRefs, parentKey))
    if (parentKey && UNORDERED_ARRAY_KEYS.has(parentKey)) {
      return [...normalized].sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
    }
    return normalized
  }
  if (!isRecord(value)) return value

  const ref = value.$ref
  if (typeof ref === 'string' && !seenRefs.has(ref)) {
    const resolved = resolveRef(ref, document)
    if (resolved !== undefined) {
      const nextSeen = new Set(seenRefs)
      nextSeen.add(ref)
      const normalizedResolved = normalizeSchema(resolved, document, nextSeen, parentKey)
      const siblingEntries = Object.entries(value).filter(([key]) => key !== '$ref' && !IGNORED_SCHEMA_KEYS.has(key))
      if (siblingEntries.length === 0) return normalizedResolved
      if (isRecord(normalizedResolved)) {
        return stableObject({
          ...normalizedResolved,
          ...Object.fromEntries(siblingEntries.map(([key, item]) => [key, normalizeSchema(item, document, nextSeen, key)])),
        })
      }
    }
  }

  return stableObject(Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !IGNORED_SCHEMA_KEYS.has(key))
      .map(([key, item]) => [key, normalizeSchema(item, document, seenRefs, key)]),
  ))
}

function stableObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
}

function resolveMappingRef(value: unknown, document: Record<string, unknown>): unknown {
  if (!isRecord(value)) return undefined
  const ref = value.$ref
  if (typeof ref !== 'string') return value
  return resolveRef(ref, document) ?? value
}

function resolveRef(ref: string, document: Record<string, unknown>): unknown {
  if (!ref.startsWith('#/')) return undefined
  return resolveJsonPointer(document, ref.slice(1))
}

function resolveJsonPointer(document: unknown, pointer: string): unknown {
  let current = document
  for (const rawPart of pointer.replace(/^\//, '').split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function commonKeys(left: Record<string, unknown>, right: Record<string, unknown>): string[] {
  return Object.keys(left).filter(key => Object.prototype.hasOwnProperty.call(right, key)).sort()
}

function parameterMap(endpoint: Endpoint): Map<string, EndpointParameter> {
  return new Map(endpoint.parameterDetails.map(parameter => [parameter.key, parameter]))
}

function endpointLabel(endpoint: Endpoint): string {
  return `${endpoint.method.toUpperCase()} ${endpoint.path}`
}

function compareEndpoints(left: Endpoint, right: Endpoint): number {
  return endpointLabel(left).localeCompare(endpointLabel(right))
}

function formatValue(value: string | undefined): string {
  return value === undefined ? '<missing>' : value
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function breaking(code: string, endpoint: string, detail: string): ContractDiffChange {
  return { code, endpoint, detail, severity: 'breaking' }
}

function nonBreaking(code: string, endpoint: string, detail: string): ContractDiffChange {
  return { code, endpoint, detail, severity: 'non-breaking' }
}
