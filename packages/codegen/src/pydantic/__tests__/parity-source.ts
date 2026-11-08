import type { OasDocument } from '@oa-sdk/parser'
import type { PyModuleIR, PyModelDecl } from '../ir.js'

type RecordValue = Record<string, unknown>

function record(value: unknown): RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : {}
}

function pointerToken(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~')
}

function atPointer(document: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return document
  let value: unknown = document
  for (const token of pointer.split('/').slice(1)) {
    if (value === null || typeof value !== 'object') return undefined
    value = (value as RecordValue)[pointerToken(token)]
  }
  return value
}

function operationParameterSchema(parameter: RecordValue): RecordValue {
  if (record(parameter.schema) !== undefined && Object.keys(record(parameter.schema)).length > 0) return record(parameter.schema)
  const first = Object.values(record(parameter.content))[0]
  return record(record(first).schema)
}

function resolveParameter(document: OasDocument, value: unknown): RecordValue {
  const item = record(value)
  const ref = typeof item.$ref === 'string' ? item.$ref : undefined
  if (ref?.startsWith('#/components/parameters/')) {
    const name = ref.split('/').pop() ?? ''
    return record(record(document.components).parameters && record(record(document.components).parameters)[pointerToken(name)])
  }
  return item
}

function parameterGroupSchema(document: OasDocument, decl: PyModelDecl): RecordValue | undefined {
  if (decl.operationOwner === undefined || decl.operationRole?.kind !== 'parameter-group') return undefined
  const match = /^operation\/([^:]+):(.*)$/.exec(decl.operationOwner)
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined
  const pathItem = record(record(document.paths)[match[2]])
  const operation = record(pathItem[match[1]])
  if (operation === undefined) return undefined
  const location = decl.operationRole.location
  const parameters = [
    ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
  ].map(parameter => resolveParameter(document, parameter))
  const byKey = new Map<string, RecordValue>()
  for (const parameter of parameters) {
    const item = parameter
    const key = `${String(item.in)}:${String(item.name)}`
    byKey.set(key, item) // operation-level entries come last and override path-item entries.
  }
  const selected = [...byKey.values()].filter(parameter => parameter.in === location)
  const properties: RecordValue = {}
  const required: string[] = []
  for (const parameter of selected) {
    const item = record(parameter)
    const name = typeof item.name === 'string' ? item.name : ''
    if (name === '') continue
    const schema = { ...operationParameterSchema(item) }
    if (typeof item.description === 'string') schema.description = item.description
    if (item.required === true || location === 'path') delete schema.default
    properties[name] = schema
    if (item.required === true || location === 'path') required.push(name)
  }
  // Operation parameter groups are lowered as closed models (`operationScope`), even when the
  // source operation does not state an additional-properties policy.
  return { type: 'object', properties, required: required.sort(), additionalProperties: false }
}

/** Derive source schemas for every generated model declaration, including operation-owned models. */
export function deriveParitySourceSchemas(document: OasDocument, ir: PyModuleIR): {
  models: Record<string, unknown>
  components: Record<string, unknown>
  refMap: Record<string, string>
} {
  const models: Record<string, unknown> = {}
  const refMap: Record<string, string> = {}
  for (const decl of ir.decls) {
    if (decl.kind !== 'model' || decl.pyName === null) continue
    if (decl.origin === 'component') refMap[decl.pyName] = decl.name
    const grouped = parameterGroupSchema(document, decl)
    const source = grouped ?? atPointer(document, decl.pointer)
    if (source === undefined || typeof source !== 'object' || source === null || Array.isArray(source)) {
      throw new Error(`No parity source schema for generated model ${decl.pyName} at ${decl.pointer}`)
    }
    models[decl.pyName] = source
  }
  const components = record(record(document.components).schemas)
  return {
    models: Object.fromEntries(Object.entries(models).sort(([left], [right]) => left.localeCompare(right))),
    components: Object.fromEntries(Object.entries(components).sort(([left], [right]) => left.localeCompare(right))),
    refMap: Object.fromEntries(Object.entries(refMap).sort(([left], [right]) => left.localeCompare(right))),
  }
}
