/**
 * spec-diff.ts — 두 OpenAPI 스펙 간 endpoint 변경 요약 및 breaking gate
 *
 * 실행:
 *   tsx scripts/spec-diff.ts <base.yaml> <head.yaml>
 *   tsx scripts/spec-diff.ts <base.yaml> <head.yaml> --fail-on-breaking
 *   tsx scripts/spec-diff.ts --git           # git base(main) vs working copy
 *
 * 출력: Markdown 형식 (CI step summary에 바로 사용 가능)
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execaSync } from 'execa'
import { parse } from 'yaml'

// ── Types ───────────────────────────────────────────────────

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' | 'trace'
const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

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

export type BreakingChangeCode =
  | 'endpoint-removed'
  | 'operation-id-changed'
  | 'required-parameter-added'
  | 'parameter-removed'
  | 'parameter-required'
  | 'request-body-required'
  | 'request-required-field-added'
  | 'request-schema-changed'
  | 'response-removed'
  | 'response-schema-changed'

export interface BreakingChange {
  code: BreakingChangeCode
  endpoint: string
  detail: string
}

// ── Extract ─────────────────────────────────────────────────

export function extractEndpoints(spec: Record<string, unknown>): Map<string, Endpoint> {
  const map = new Map<string, Endpoint>()
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>

  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue
    for (const method of HTTP_METHODS) {
      const op = item[method] as Record<string, unknown> | undefined
      if (!op) continue
      const parameters = collectParameters(item, op)
      const key = `${method.toUpperCase()} ${path}`
      const endpoint: Endpoint = {
        path,
        method,
        parameters: parameters.map(p => p.key).sort(),
        parameterDetails: parameters,
        responses: Object.keys((op.responses ?? {}) as Record<string, unknown>).sort(),
        requestBodyRequired: isRequestBodyRequired(op.requestBody),
        requestBodyRequiredFields: collectRequestBodyRequiredFields(op.requestBody),
        responseSchemaFingerprints: collectResponseSchemaFingerprints(op.responses),
      }
      if (typeof op.operationId === 'string') endpoint.operationId = op.operationId
      if (typeof op.summary === 'string') endpoint.summary = op.summary
      const requestBodySchemaFingerprint = schemaFingerprint(readJsonRequestSchema(op.requestBody))
      if (requestBodySchemaFingerprint !== undefined) {
        endpoint.requestBodySchemaFingerprint = requestBodySchemaFingerprint
      }
      map.set(key, endpoint)
    }
  }
  return map
}

// ── Diff ────────────────────────────────────────────────────

export function diffEndpoints(baseSpec: Record<string, unknown>, headSpec: Record<string, unknown>): DiffResult {
  const baseMap = extractEndpoints(baseSpec)
  const headMap = extractEndpoints(headSpec)

  const added: Endpoint[] = []
  const removed: Endpoint[] = []
  const modified: DiffResult['modified'] = []

  for (const [key, ep] of headMap) {
    if (!baseMap.has(key)) added.push(ep)
  }

  for (const [key, ep] of baseMap) {
    if (!headMap.has(key)) removed.push(ep)
  }

  for (const [key, baseEp] of baseMap) {
    const headEp = headMap.get(key)
    if (!headEp) continue

    const changes: string[] = []

    if (baseEp.operationId !== headEp.operationId) {
      changes.push(`operationId: \`${baseEp.operationId}\` -> \`${headEp.operationId}\``)
    }
    if (baseEp.summary !== headEp.summary) {
      changes.push('summary changed')
    }
    if (JSON.stringify(baseEp.parameters) !== JSON.stringify(headEp.parameters)) {
      const addedParams = headEp.parameters.filter(p => !baseEp.parameters.includes(p))
      const removedParams = baseEp.parameters.filter(p => !headEp.parameters.includes(p))
      if (addedParams.length) changes.push(`params added: ${addedParams.join(', ')}`)
      if (removedParams.length) changes.push(`params removed: ${removedParams.join(', ')}`)
    }
    if (baseEp.requestBodyRequired !== headEp.requestBodyRequired) {
      changes.push(`requestBody required: ${baseEp.requestBodyRequired} -> ${headEp.requestBodyRequired}`)
    }
    if (JSON.stringify(baseEp.requestBodyRequiredFields) !== JSON.stringify(headEp.requestBodyRequiredFields)) {
      const addedFields = headEp.requestBodyRequiredFields.filter(field => !baseEp.requestBodyRequiredFields.includes(field))
      const removedFields = baseEp.requestBodyRequiredFields.filter(field => !headEp.requestBodyRequiredFields.includes(field))
      if (addedFields.length) changes.push(`request required fields added: ${addedFields.join(', ')}`)
      if (removedFields.length) changes.push(`request required fields removed: ${removedFields.join(', ')}`)
    }
    if (baseEp.requestBodySchemaFingerprint !== headEp.requestBodySchemaFingerprint) {
      changes.push('request body schema changed')
    }
    if (JSON.stringify(baseEp.responses) !== JSON.stringify(headEp.responses)) {
      const addedResp = headEp.responses.filter(r => !baseEp.responses.includes(r))
      const removedResp = baseEp.responses.filter(r => !headEp.responses.includes(r))
      if (addedResp.length) changes.push(`responses added: ${addedResp.join(', ')}`)
      if (removedResp.length) changes.push(`responses removed: ${removedResp.join(', ')}`)
    }
    for (const code of commonKeys(baseEp.responseSchemaFingerprints, headEp.responseSchemaFingerprints)) {
      if (baseEp.responseSchemaFingerprints[code] !== headEp.responseSchemaFingerprints[code]) {
        changes.push(`response ${code} schema changed`)
      }
    }

    if (changes.length > 0) {
      modified.push({ base: baseEp, head: headEp, changes })
    }
  }

  return { added, removed, modified }
}

export function classifyBreakingChanges(diff: DiffResult): BreakingChange[] {
  const changes: BreakingChange[] = []

  for (const endpoint of diff.removed) {
    changes.push({
      code: 'endpoint-removed',
      endpoint: endpointLabel(endpoint),
      detail: 'Endpoint was removed.',
    })
  }

  for (const { base, head } of diff.modified) {
    const endpoint = endpointLabel(head)
    if (base.operationId !== head.operationId) {
      changes.push({
        code: 'operation-id-changed',
        endpoint,
        detail: `operationId changed from ${formatValue(base.operationId)} to ${formatValue(head.operationId)}.`,
      })
    }

    const baseParameters = parameterMap(base)
    const headParameters = parameterMap(head)
    for (const [key, parameter] of headParameters) {
      if (!baseParameters.has(key) && parameter.required) {
        changes.push({
          code: 'required-parameter-added',
          endpoint,
          detail: `Required parameter ${key} was added.`,
        })
      }
    }
    for (const [key] of baseParameters) {
      if (!headParameters.has(key)) {
        changes.push({
          code: 'parameter-removed',
          endpoint,
          detail: `Parameter ${key} was removed.`,
        })
      }
    }
    for (const [key, parameter] of headParameters) {
      const previous = baseParameters.get(key)
      if (previous && !previous.required && parameter.required) {
        changes.push({
          code: 'parameter-required',
          endpoint,
          detail: `Parameter ${key} became required.`,
        })
      }
    }

    if (!base.requestBodyRequired && head.requestBodyRequired) {
      changes.push({
        code: 'request-body-required',
        endpoint,
        detail: 'Request body became required.',
      })
    }

    for (const field of head.requestBodyRequiredFields) {
      if (!base.requestBodyRequiredFields.includes(field)) {
        changes.push({
          code: 'request-required-field-added',
          endpoint,
          detail: `Request body required field ${field} was added.`,
        })
      }
    }

    if (
      base.requestBodySchemaFingerprint
      && head.requestBodySchemaFingerprint
      && base.requestBodySchemaFingerprint !== head.requestBodySchemaFingerprint
    ) {
      changes.push({
        code: 'request-schema-changed',
        endpoint,
        detail: 'Request body schema changed.',
      })
    }

    for (const status of base.responses) {
      if (!head.responses.includes(status)) {
        changes.push({
          code: 'response-removed',
          endpoint,
          detail: `Response ${status} was removed.`,
        })
      }
    }

    for (const status of commonKeys(base.responseSchemaFingerprints, head.responseSchemaFingerprints)) {
      if (base.responseSchemaFingerprints[status] !== head.responseSchemaFingerprints[status]) {
        changes.push({
          code: 'response-schema-changed',
          endpoint,
          detail: `Response ${status} schema changed.`,
        })
      }
    }
  }

  return changes
}

export function hasBreakingChanges(diff: DiffResult): boolean {
  return classifyBreakingChanges(diff).length > 0
}

// ── Format ──────────────────────────────────────────────────

export function formatMarkdown(diff: DiffResult): string {
  const { added, removed, modified } = diff
  const breaking = classifyBreakingChanges(diff)

  if (added.length === 0 && removed.length === 0 && modified.length === 0) {
    return '### API Spec Diff\n\nNo endpoint changes detected.'
  }

  const lines: string[] = ['### API Spec Diff\n']

  const summary = [
    added.length && `**+${added.length}** added`,
    removed.length && `**-${removed.length}** removed`,
    modified.length && `**~${modified.length}** modified`,
    breaking.length && `**!${breaking.length}** breaking`,
  ].filter(Boolean)
  lines.push(summary.join(' / ') + '\n')

  if (breaking.length) {
    lines.push('#### Breaking Changes')
    for (const change of breaking) {
      lines.push(`- \`${change.endpoint}\` - ${change.detail}`)
    }
    lines.push('')
  }

  if (added.length) {
    lines.push('#### Added')
    for (const ep of added) {
      lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` - ${ep.summary ?? ep.operationId ?? ''}`)
    }
    lines.push('')
  }

  if (removed.length) {
    lines.push('#### Removed')
    for (const ep of removed) {
      lines.push(`- \`${ep.method.toUpperCase()} ${ep.path}\` - ${ep.summary ?? ep.operationId ?? ''}`)
    }
    lines.push('')
  }

  if (modified.length) {
    lines.push('#### Modified')
    for (const { head, changes } of modified) {
      lines.push(`- \`${head.method.toUpperCase()} ${head.path}\``)
      for (const c of changes) {
        lines.push(`  - ${c}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

// ── Helpers ─────────────────────────────────────────────────

function collectParameters(
  pathItem: Record<string, unknown>,
  operation: Record<string, unknown>,
): EndpointParameter[] {
  const parameters = [
    ...readParameterArray(pathItem.parameters),
    ...readParameterArray(operation.parameters),
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
    const fingerprint = schemaFingerprint(parameter.schema)
    if (fingerprint !== undefined) endpointParameter.schemaFingerprint = fingerprint
    byKey.set(key, endpointParameter)
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function readParameterArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((parameter): parameter is Record<string, unknown> => {
    return isRecord(parameter) && typeof parameter.$ref !== 'string'
  })
}

function isRequestBodyRequired(value: unknown): boolean {
  return isRecord(value) && value.required === true
}

function collectRequestBodyRequiredFields(value: unknown): string[] {
  const schema = readJsonRequestSchema(value)
  if (!isRecord(schema) || !Array.isArray(schema.required)) return []
  return schema.required.filter((field): field is string => typeof field === 'string').sort()
}

function collectResponseSchemaFingerprints(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const fingerprints: Record<string, string> = {}
  for (const [status, response] of Object.entries(value)) {
    const schema = readJsonResponseSchema(response)
    const fingerprint = schemaFingerprint(schema)
    if (fingerprint !== undefined) fingerprints[status] = fingerprint
  }
  return fingerprints
}

function readJsonRequestSchema(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  return readJsonContentSchema(value.content)
}

function readJsonResponseSchema(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  return readJsonContentSchema(value.content)
}

function readJsonContentSchema(value: unknown): unknown {
  if (!isRecord(value)) return undefined
  const json = value['application/json']
  if (!isRecord(json) || typeof json.$ref === 'string') return undefined
  return json.schema
}

function schemaFingerprint(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return stableStringify(value)
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

function formatValue(value: string | undefined): string {
  return value === undefined ? '<missing>' : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// ── CLI ─────────────────────────────────────────────────────

function findRepoRoot(): string {
  return execaSync('git', ['rev-parse', '--show-toplevel']).stdout.trim()
}

function gitShow(ref: string, filePath: string, cwd: string): string | null {
  try {
    return execaSync('git', ['show', `${ref}:${filePath}`], { cwd }).stdout
  } catch {
    return null
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const failOnBreaking = args.includes('--fail-on-breaking')
  const normalizedArgs = args.filter(arg => arg !== '--fail-on-breaking' && arg !== '--')
  const root = findRepoRoot()
  const SPEC_REL = 'packages/schemas/src/.merged.3.1.yaml'
  const specAbs = join(root, SPEC_REL)

  let baseYaml: string
  let headYaml: string

  if (normalizedArgs.includes('--help') || normalizedArgs.includes('-h')) {
    console.log('Usage: tsx scripts/spec-diff.ts <base.yaml> <head.yaml> [--fail-on-breaking]')
    console.log('       tsx scripts/spec-diff.ts --git [base-branch] [--fail-on-breaking]')
    process.exit(0)
  }

  if (normalizedArgs[0] === '--git') {
    const baseBranch = normalizedArgs[1] ?? 'origin/main'
    const result = gitShow(baseBranch, SPEC_REL, root)
    if (result === null) {
      console.log('### API Spec Diff\n\nBase spec not found in git - skipping diff (new file?).')
      process.exit(0)
    }
    baseYaml = result
    if (!existsSync(specAbs)) {
      console.error(`Head spec not found: ${specAbs}`)
      process.exit(1)
    }
    headYaml = readFileSync(specAbs, 'utf-8')
  } else if (normalizedArgs.length >= 2) {
    const basePath = normalizedArgs[0]!
    const headPath = normalizedArgs[1]!
    for (const f of [basePath, headPath]) {
      if (!existsSync(f)) {
        console.error(`File not found: ${f}`)
        process.exit(1)
      }
    }
    baseYaml = readFileSync(basePath, 'utf-8')
    headYaml = readFileSync(headPath, 'utf-8')
  } else {
    console.error('Usage: tsx scripts/spec-diff.ts <base.yaml> <head.yaml> [--fail-on-breaking]')
    console.error('       tsx scripts/spec-diff.ts --git [base-branch] [--fail-on-breaking]')
    process.exit(1)
  }

  const baseSpec = parse(baseYaml) as Record<string, unknown>
  const headSpec = parse(headYaml) as Record<string, unknown>
  const diff = diffEndpoints(baseSpec, headSpec)

  console.log(formatMarkdown(diff))
  if (failOnBreaking && hasBreakingChanges(diff)) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
