import { unescapeJsonPointerToken } from '@oa-sdk/parser'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
const IGNORED_SCHEMA_KEYS = new Set(['description', 'examples', 'example', 'title'])
const UNORDERED_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'enum', 'oneOf', 'required'])
const COMPOSITION_SCHEMA_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'])

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

export interface ComponentSchemasDiff {
  added: string[]
  removed: string[]
  modified: {
    name: string
    changes: string[]
    breakingChanges: ContractDiffChange[]
    nonBreakingChanges: ContractDiffChange[]
  }[]
}

export interface DiffResult {
  added: Endpoint[]
  removed: Endpoint[]
  modified: { base: Endpoint; head: Endpoint; changes: string[] }[]
  componentSchemas?: ComponentSchemasDiff
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
  options?: { includeComponentSchemas?: boolean },
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

  const shouldDiffSchemas = options?.includeComponentSchemas ?? (baseMap.size === 0 && headMap.size === 0)
  const componentSchemas = shouldDiffSchemas ? diffComponentSchemas(baseSpec, headSpec) : undefined
  const hasSchemaChanges = componentSchemas && (
    componentSchemas.added.length > 0 ||
    componentSchemas.removed.length > 0 ||
    componentSchemas.modified.length > 0
  )

  return {
    added: added.sort(compareEndpoints),
    removed: removed.sort(compareEndpoints),
    modified: modified.sort((left, right) => compareEndpoints(left.head, right.head)),
    ...(hasSchemaChanges ? { componentSchemas } : {}),
  }
}

export function diffComponentSchemas(
  baseSpec: Record<string, unknown>,
  headSpec: Record<string, unknown>,
): ComponentSchemasDiff | undefined {
  const baseSchemas = readRecord((baseSpec.components as Record<string, unknown> | undefined)?.schemas)
  const headSchemas = readRecord((headSpec.components as Record<string, unknown> | undefined)?.schemas)

  if (Object.keys(baseSchemas).length === 0 && Object.keys(headSchemas).length === 0) {
    return undefined
  }

  const added: string[] = []
  const removed: string[] = []
  const modified: ComponentSchemasDiff['modified'] = []

  for (const name of Object.keys(headSchemas)) {
    if (!baseSchemas[name]) added.push(name)
  }

  for (const name of Object.keys(baseSchemas)) {
    if (!headSchemas[name]) removed.push(name)
  }

  for (const [name, baseItem] of Object.entries(baseSchemas)) {
    const headItem = headSchemas[name]
    if (!headItem) continue

    const baseSchema = readRecord(baseItem)
    const headSchema = readRecord(headItem)
    const endpoint = `#/components/schemas/${name}`

    const changes: string[] = []
    const breakingChanges: ContractDiffChange[] = []
    const nonBreakingChanges: ContractDiffChange[] = []

    // 1. Root schema type change
    if (baseSchema.type !== undefined && headSchema.type !== undefined && baseSchema.type !== headSchema.type) {
      changes.push(`type changed from ${formatValue(baseSchema.type as string)} to ${formatValue(headSchema.type as string)}`)
      breakingChanges.push(
        breaking(
          'type-changed',
          endpoint,
          `Schema ${name} type changed from ${formatValue(baseSchema.type as string)} to ${formatValue(headSchema.type as string)}.`,
        ),
      )
    }

    // 2. Numeric and boundary constraints on root schema
    if (typeof baseSchema.maximum === 'number' && typeof headSchema.maximum === 'number') {
      if (headSchema.maximum < baseSchema.maximum) {
        changes.push(`maximum narrowed from ${baseSchema.maximum} to ${headSchema.maximum}`)
        breakingChanges.push(
          breaking(
            'constraint-narrowed',
            endpoint,
            `Schema ${name} maximum narrowed from ${baseSchema.maximum} to ${headSchema.maximum}.`,
          ),
        )
      } else if (headSchema.maximum > baseSchema.maximum) {
        changes.push(`maximum widened from ${baseSchema.maximum} to ${headSchema.maximum}`)
        nonBreakingChanges.push(
          nonBreaking(
            'constraint-widened',
            endpoint,
            `Schema ${name} maximum widened from ${baseSchema.maximum} to ${headSchema.maximum}.`,
          ),
        )
      }
    }
    if (typeof baseSchema.minimum === 'number' && typeof headSchema.minimum === 'number') {
      if (headSchema.minimum > baseSchema.minimum) {
        changes.push(`minimum narrowed from ${baseSchema.minimum} to ${headSchema.minimum}`)
        breakingChanges.push(
          breaking(
            'constraint-narrowed',
            endpoint,
            `Schema ${name} minimum narrowed from ${baseSchema.minimum} to ${headSchema.minimum}.`,
          ),
        )
      } else if (headSchema.minimum < baseSchema.minimum) {
        changes.push(`minimum widened from ${baseSchema.minimum} to ${headSchema.minimum}`)
        nonBreakingChanges.push(
          nonBreaking(
            'constraint-widened',
            endpoint,
            `Schema ${name} minimum widened from ${baseSchema.minimum} to ${headSchema.minimum}.`,
          ),
        )
      }
    }

    // 3. Required fields on object schema
    const baseRequired = Array.isArray(baseSchema.required) ? (baseSchema.required as string[]) : []
    const headRequired = Array.isArray(headSchema.required) ? (headSchema.required as string[]) : []

    for (const field of headRequired) {
      if (!baseRequired.includes(field)) {
        changes.push(`required field ${field} was added`)
        breakingChanges.push(
          breaking(
            'required-field-added',
            endpoint,
            `Schema ${name} required field ${field} was added.`,
          ),
        )
      }
    }

    for (const field of baseRequired) {
      if (!headRequired.includes(field)) {
        changes.push(`field ${field} became optional`)
        nonBreakingChanges.push(
          nonBreaking(
            'field-optional',
            endpoint,
            `Schema ${name} field ${field} became optional.`,
          ),
        )
      }
    }

    // 4. Object properties comparison
    const baseProps = readRecord(baseSchema.properties)
    const headProps = readRecord(headSchema.properties)

    for (const propName of Object.keys(baseProps)) {
      if (!headProps[propName]) {
        changes.push(`property ${propName} was removed`)
        breakingChanges.push(
          breaking(
            'property-removed',
            `${endpoint}/properties/${propName}`,
            `Property ${propName} was removed from schema ${name}.`,
          ),
        )
      }
    }

    for (const propName of Object.keys(headProps)) {
      if (!baseProps[propName]) {
        changes.push(`property ${propName} was added`)
        if (headRequired.includes(propName)) {
          // already covered by required-field-added
        } else {
          nonBreakingChanges.push(
            nonBreaking(
              'property-added',
              `${endpoint}/properties/${propName}`,
              `Optional property ${propName} was added to schema ${name}.`,
            ),
          )
        }
      }
    }

    for (const [propName, basePropVal] of Object.entries(baseProps)) {
      const headPropVal = headProps[propName]
      if (!headPropVal) continue

      const baseProp = readRecord(basePropVal)
      const headProp = readRecord(headPropVal)
      const propEndpoint = `${endpoint}/properties/${propName}`

      // Property type changed
      if (baseProp.type !== undefined && headProp.type !== undefined && baseProp.type !== headProp.type) {
        changes.push(`property ${propName} type changed from ${formatValue(baseProp.type as string)} to ${formatValue(headProp.type as string)}`)
        breakingChanges.push(
          breaking(
            'type-changed',
            propEndpoint,
            `Property ${propName} type changed from ${formatValue(baseProp.type as string)} to ${formatValue(headProp.type as string)}.`,
          ),
        )
      }

      // Nullable removed
      if (baseProp.nullable === true && (headProp.nullable === false || headProp.nullable === undefined)) {
        changes.push(`property ${propName} nullable removed`)
        breakingChanges.push(
          breaking(
            'nullable-removed',
            propEndpoint,
            `Property ${propName} nullable was removed.`,
          ),
        )
      }

      // Property constraints narrowed
      if (typeof baseProp.maximum === 'number' && typeof headProp.maximum === 'number') {
        if (headProp.maximum < baseProp.maximum) {
          changes.push(`property ${propName} maximum narrowed from ${baseProp.maximum} to ${headProp.maximum}`)
          breakingChanges.push(
            breaking(
              'constraint-narrowed',
              propEndpoint,
              `Property ${propName} maximum narrowed from ${baseProp.maximum} to ${headProp.maximum}.`,
            ),
          )
        } else if (headProp.maximum > baseProp.maximum) {
          nonBreakingChanges.push(
            nonBreaking(
              'constraint-widened',
              propEndpoint,
              `Property ${propName} maximum widened from ${baseProp.maximum} to ${headProp.maximum}.`,
            ),
          )
        }
      }
      if (typeof baseProp.minimum === 'number' && typeof headProp.minimum === 'number') {
        if (headProp.minimum > baseProp.minimum) {
          changes.push(`property ${propName} minimum narrowed from ${baseProp.minimum} to ${headProp.minimum}`)
          breakingChanges.push(
            breaking(
              'constraint-narrowed',
              propEndpoint,
              `Property ${propName} minimum narrowed from ${baseProp.minimum} to ${headProp.minimum}.`,
            ),
          )
        } else if (headProp.minimum < baseProp.minimum) {
          nonBreakingChanges.push(
            nonBreaking(
              'constraint-widened',
              propEndpoint,
              `Property ${propName} minimum widened from ${baseProp.minimum} to ${headProp.minimum}.`,
            ),
          )
        }
      }

      // Schema fingerprint deep diff
      const baseFp = schemaFingerprint(baseProp, baseSpec)
      const headFp = schemaFingerprint(headProp, headSpec)
      if (baseFp && headFp && baseFp !== headFp) {
        if (breakingChanges.every(c => c.endpoint !== propEndpoint)) {
          changes.push(`property ${propName} schema changed`)
          breakingChanges.push(
            breaking(
              'property-schema-changed',
              propEndpoint,
              `Property ${propName} schema changed.`,
            ),
          )
        }
      }
    }

    if (changes.length > 0 || breakingChanges.length > 0 || nonBreakingChanges.length > 0) {
      modified.push({
        name,
        changes,
        breakingChanges,
        nonBreakingChanges,
      })
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    modified: modified.sort((a, b) => a.name.localeCompare(b.name)),
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

  // Component schemas breaking changes
  if (diff.componentSchemas) {
    for (const removedSchema of diff.componentSchemas.removed) {
      changes.push(breaking('schema-removed', `#/components/schemas/${removedSchema}`, `Schema ${removedSchema} was removed.`))
    }
    for (const mod of diff.componentSchemas.modified) {
      changes.push(...mod.breakingChanges)
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

  // Component schemas non-breaking changes
  if (diff.componentSchemas) {
    for (const addedSchema of diff.componentSchemas.added) {
      changes.push(nonBreaking('schema-added', `#/components/schemas/${addedSchema}`, `Schema ${addedSchema} was added.`))
    }
    for (const mod of diff.componentSchemas.modified) {
      changes.push(...mod.nonBreakingChanges)
    }
  }

  return changes
}

export function hasBreakingChanges(diff: DiffResult): boolean {
  return classifyBreakingChanges(diff).length > 0
}

export function formatMarkdown(diff: DiffResult): string {
  const breaking = classifyBreakingChanges(diff)
  const cs = diff.componentSchemas
  const hasEndpointChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.modified.length > 0
  const hasSchemaChanges = cs && (cs.added.length > 0 || cs.removed.length > 0 || cs.modified.length > 0)

  if (!hasEndpointChanges && !hasSchemaChanges) {
    return '### API Spec Diff\n\nNo endpoint or schema changes detected.'
  }

  const lines: string[] = ['### API Spec Diff\n']
  const totalAdded = diff.added.length + (cs?.added.length ?? 0)
  const totalRemoved = diff.removed.length + (cs?.removed.length ?? 0)
  const totalModified = diff.modified.length + (cs?.modified.length ?? 0)

  const summary = [
    totalAdded && `**+${totalAdded}** added`,
    totalRemoved && `**-${totalRemoved}** removed`,
    totalModified && `**~${totalModified}** modified`,
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

  if (diff.added.length || (cs && cs.added.length)) {
    lines.push('#### Added')
    for (const endpoint of diff.added) {
      lines.push(`- \`${endpointLabel(endpoint)}\` - ${endpoint.summary ?? endpoint.operationId ?? ''}`)
    }
    if (cs) {
      for (const name of cs.added) {
        lines.push(`- \`#/components/schemas/${name}\` - Component schema added`)
      }
    }
    lines.push('')
  }

  if (diff.removed.length || (cs && cs.removed.length)) {
    lines.push('#### Removed')
    for (const endpoint of diff.removed) {
      lines.push(`- \`${endpointLabel(endpoint)}\` - ${endpoint.summary ?? endpoint.operationId ?? ''}`)
    }
    if (cs) {
      for (const name of cs.removed) {
        lines.push(`- \`#/components/schemas/${name}\` - Component schema removed`)
      }
    }
    lines.push('')
  }

  if (diff.modified.length || (cs && cs.modified.length)) {
    lines.push('#### Modified')
    for (const { head, changes } of diff.modified) {
      lines.push(`- \`${endpointLabel(head)}\``)
      for (const change of changes) lines.push(`  - ${change}`)
    }
    if (cs) {
      for (const { name, changes } of cs.modified) {
        lines.push(`- \`#/components/schemas/${name}\``)
        for (const change of changes) lines.push(`  - ${change}`)
      }
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
  const baseParamMap = parameterMap(base)
  const headParamMap = parameterMap(head)
  for (const [key, parameter] of headParamMap) {
    const previous = baseParamMap.get(key)
    if (previous && !previous.required && parameter.required) {
      changes.push(`param ${key} became required`)
    }
    if (previous?.schemaFingerprint && parameter.schemaFingerprint && previous.schemaFingerprint !== parameter.schemaFingerprint) {
      changes.push(`param ${key} schema changed`)
    }
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

  return normalizeObjectSealing(stableObject(Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !IGNORED_SCHEMA_KEYS.has(key))
      .map(([key, item]) => [key, normalizeSchema(item, document, seenRefs, key)]),
  )))
}

function normalizeObjectSealing(schema: Record<string, unknown>): Record<string, unknown> {
  if (
    schema.additionalProperties === undefined
    && isNeverSchema(schema.unevaluatedProperties)
    && !hasCompositionSchema(schema)
  ) {
    const { unevaluatedProperties: _unevaluatedProperties, ...rest } = schema
    return stableObject({ ...rest, additionalProperties: false })
  }
  return schema
}

function isNeverSchema(value: unknown): boolean {
  return isRecord(value)
    && Object.keys(value).length === 1
    && isRecord(value.not)
    && Object.keys(value.not).length === 0
}

function hasCompositionSchema(schema: Record<string, unknown>): boolean {
  return Object.keys(schema).some(key => COMPOSITION_SCHEMA_KEYS.has(key))
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
    const part = unescapeJsonPointerToken(rawPart)
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
