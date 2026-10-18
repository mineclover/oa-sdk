/**
 * @fileoverview Intent-Unit Module: Standard TypeSpec (.tsp) Interface Sketch Multi-Target Emitter
 * @intent INTENT-OA-SKETCH-CODEGEN
 * @doc discussions/intent-modularization-convention/track-c-oa-sdk-delegation/01-OA-SDK-OWNERSHIP-AND-DELEGATION-PLAN.md#todo-oa-03
 *
 * Emits JSON Schema 2020-12 (`x-evidence`, `x-oa-sdk-intent`, `x-oa-sdk-derived-from`),
 * OpenAPI 3.1.0, Mermaid classDiagram (`.mmd`), and `not implemented` contract stubs
 * (`sketch_stub.ts` & `sketch_stub.py`) from a standard `.tsp` file or `InterfaceSketchIr`.
 */

import {
  parseTypeSpecSketch,
  type InterfaceSketchIr,
  type SketchModelIr,
} from '@oa-sdk/surface-ir'

export type SketchEmittedArtifacts = {
  ir: InterfaceSketchIr
  jsonSchema: Record<string, unknown>
  openApi: Record<string, unknown>
  mermaid: string
  tsStub: string
  pyStub: string
}

/**
 * Emits all Phase B/C/D contract artifacts from a standard `.tsp` source string
 * or pre-parsed `InterfaceSketchIr` (`IUD-02`, `IUD-05`, `IUD-07`).
 */
export function emitSketchArtifacts(
  sourceOrIr: string | InterfaceSketchIr,
  specName = 'domain',
): SketchEmittedArtifacts {
  const ir =
    typeof sourceOrIr === 'string' ? parseTypeSpecSketch(sourceOrIr, specName) : sourceOrIr

  return {
    ir,
    jsonSchema: buildJsonSchemaFromSketchIr(ir),
    openApi: buildOpenApiFromSketchIr(ir),
    mermaid: buildMermaidFromSketchIr(ir),
    tsStub: buildTypeScriptStubFromSketchIr(ir),
    pyStub: buildPythonStubFromSketchIr(ir),
  }
}

export function buildJsonSchemaFromSketchIr(ir: InterfaceSketchIr): Record<string, unknown> {
  const defs: Record<string, unknown> = {}
  const modelMap = new Map<string, SketchModelIr>(ir.models.map(m => [m.name, m]))

  for (const u of ir.unionsAndEnums) {
    defs[u.name] = {
      type: 'string',
      enum: u.variants.map(v => v.replace(/^["']|["']$/g, '')),
      ...(u.doc ? { description: u.doc } : {}),
      ...(u.evidence.length > 0 ? { 'x-evidence': { requirements: u.evidence } } : {}),
    }
  }

  for (const model of ir.models) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    const resolvedFields = resolveInheritedFields(model, modelMap)
    for (const field of resolvedFields) {
      properties[field.name] = {
        ...mapTspTypeToJsonSchema(field.typeName),
        ...(field.doc ? { description: field.doc } : {}),
        ...(field.evidence.length > 0 ? { 'x-evidence': { requirements: field.evidence } } : {}),
      }
      if (!field.optional) {
        required.push(field.name)
      }
    }

    defs[model.name] = {
      type: 'object',
      additionalProperties: false,
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...(model.doc ? { description: model.doc } : {}),
      ...(model.evidence.length > 0
        ? {
            'x-evidence': { requirements: model.evidence },
            'x-oa-sdk-evidence': { requirements: model.evidence },
          }
        : {}),
      ...(model.intent ? { 'x-oa-sdk-intent': model.intent } : {}),
      ...(model.derivedFrom ? { 'x-oa-sdk-derived-from': model.derivedFrom } : {}),
    }
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `urn:oa-sdk:sketch:${ir.specName}`,
    title: ir.namespace ?? ir.specName,
    'x-oa-sdk-profile': ir.profile,
    'x-oa-sdk-depth': ir.depthMetrics,
    $defs: defs,
  }
}

export function buildOpenApiFromSketchIr(ir: InterfaceSketchIr): Record<string, unknown> {
  const jsonSchema = buildJsonSchemaFromSketchIr(ir)
  const paths: Record<string, unknown> = {}

  for (const iface of ir.interfaces) {
    for (const op of iface.operations) {
      paths[`/${iface.name}/${op.name}`] = {
        post: {
          operationId: `${iface.name}_${op.name}`,
          ...(op.doc ? { summary: op.doc } : {}),
          ...(op.evidence.length > 0 ? { 'x-evidence': { requirements: op.evidence } } : {}),
          ...(op.intent ? { 'x-oa-sdk-intent': op.intent } : {}),
          responses: {
            '200': {
              description: `${op.returnType} result`,
            },
          },
        },
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: ir.namespace ?? ir.specName,
      version: '1.0.0',
    },
    paths,
    components: {
      schemas: (jsonSchema.$defs as Record<string, unknown>) ?? {},
    },
  }
}

export function buildMermaidFromSketchIr(ir: InterfaceSketchIr): string {
  const lines: string[] = ['classDiagram']

  for (const model of ir.models) {
    lines.push(`  class ${model.name} {`)
    for (const field of model.fields) {
      lines.push(`    +${field.typeName} ${field.name}${field.optional ? '?' : ''}`)
    }
    lines.push('  }')
    if (model.baseModel) {
      lines.push(`  ${model.baseModel} <|-- ${model.name} : @derivedFrom`)
    }
  }

  for (const iface of ir.interfaces) {
    lines.push(`  class ${iface.name} {`)
    lines.push('    <<interface>>')
    for (const op of iface.operations) {
      const paramSig = op.params.map(p => `${p.name}: ${p.typeName}`).join(', ')
      lines.push(`    +${op.name}(${paramSig}) ${op.returnType}`)
    }
    lines.push('  }')
  }

  return lines.join('\n') + '\n'
}

export function buildTypeScriptStubFromSketchIr(ir: InterfaceSketchIr): string {
  const lines: string[] = [
    `/**`,
    ` * Auto-generated by @oa-sdk/codegen (emitSketchArtifacts) from ${ir.specName}.tsp`,
    ` * Profile: ${ir.profile} | Interface Depth: ${ir.depthMetrics.interfaceDepth}`,
    ` */`,
    ``,
  ]

  for (const u of ir.unionsAndEnums) {
    const unionExpr =
      u.variants.map(v => (v.startsWith('"') || v.startsWith("'") ? v : `"${v}"`)).join(' | ') ||
      'string'
    lines.push(`export type ${u.name} = ${unionExpr};`)
    lines.push(``)
  }

  for (const model of ir.models) {
    if (model.doc || model.intent || model.derivedFrom) {
      lines.push(`/**`)
      if (model.doc) lines.push(` * ${model.doc}`)
      if (model.intent) lines.push(` * @intent ${model.intent.intentId}`)
      if (model.derivedFrom) {
        lines.push(` * @derivedFrom ${model.derivedFrom.baseSymbol} — ${model.derivedFrom.reason}`)
      }
      lines.push(` */`)
    }
    const ext = model.baseModel ? ` extends ${model.baseModel}` : ''
    lines.push(`export interface ${model.name}${ext} {`)
    for (const field of model.fields) {
      lines.push(
        `  ${field.name}${field.optional ? '?' : ''}: ${mapTspTypeToTs(field.typeName)};`,
      )
    }
    lines.push(`}`)
    lines.push(``)
  }

  for (const iface of ir.interfaces) {
    lines.push(`export interface ${iface.name} {`)
    for (const op of iface.operations) {
      const params = op.params
        .map(p => `${p.name}${p.optional ? '?' : ''}: ${mapTspTypeToTs(p.typeName)}`)
        .join(', ')
      lines.push(`  ${op.name}(${params}): ${mapTspTypeToTs(op.returnType)};`)
    }
    lines.push(`}`)
    lines.push(``)
    lines.push(`export class ${iface.name}Stub implements ${iface.name} {`)
    for (const op of iface.operations) {
      const params = op.params
        .map(p => `_${p.name}${p.optional ? '?' : ''}: ${mapTspTypeToTs(p.typeName)}`)
        .join(', ')
      lines.push(`  ${op.name}(${params}): ${mapTspTypeToTs(op.returnType)} {`)
      lines.push(`    throw new Error("not implemented");`)
      lines.push(`  }`)
    }
    lines.push(`}`)
    lines.push(``)
  }

  return lines.join('\n')
}

export function buildPythonStubFromSketchIr(ir: InterfaceSketchIr): string {
  const lines: string[] = [
    `"""`,
    `Auto-generated by @oa-sdk/codegen (emitSketchArtifacts) from ${ir.specName}.tsp`,
    `Profile: ${ir.profile} | Interface Depth: ${ir.depthMetrics.interfaceDepth}`,
    `"""`,
    `from __future__ import annotations`,
    `from dataclasses import dataclass`,
    `from typing import Literal, Optional, Protocol`,
    ``,
  ]

  for (const u of ir.unionsAndEnums) {
    const lits =
      u.variants.map(v => (v.startsWith('"') || v.startsWith("'") ? v : `"${v}"`)).join(', ') ||
      '"unknown"'
    lines.push(`${u.name} = Literal[${lits}]`)
    lines.push(``)
  }

  for (const model of ir.models) {
    lines.push(`@dataclass`)
    const base = model.baseModel ? `(${model.baseModel})` : ''
    lines.push(`class ${model.name}${base}:`)
    if (model.fields.length === 0) {
      lines.push(`    pass`)
    } else {
      for (const field of model.fields) {
        const pyType = mapTspTypeToPy(field.typeName)
        lines.push(
          `    ${field.name}: ${field.optional ? `Optional[${pyType}] = None` : pyType}`,
        )
      }
    }
    lines.push(``)
  }

  for (const iface of ir.interfaces) {
    lines.push(`class ${iface.name}(Protocol):`)
    if (iface.operations.length === 0) {
      lines.push(`    pass`)
    } else {
      for (const op of iface.operations) {
        const snakeName = op.name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
        const params = [
          'self',
          ...op.params.map(
            p =>
              `${p.name}: ${p.optional ? `Optional[${mapTspTypeToPy(p.typeName)}] = None` : mapTspTypeToPy(p.typeName)}`,
          ),
        ].join(', ')
        lines.push(`    def ${snakeName}(${params}) -> ${mapTspTypeToPy(op.returnType)}:`)
        lines.push(`        raise NotImplementedError("not implemented")`)
      }
    }
    lines.push(``)
  }

  return lines.join('\n')
}

function resolveInheritedFields(
  model: SketchModelIr,
  modelMap: ReadonlyMap<string, SketchModelIr>,
): SketchModelIr['fields'] {
  if (!model.baseModel) return model.fields
  const parent = modelMap.get(model.baseModel)
  if (!parent) return model.fields
  const parentFields = resolveInheritedFields(parent, modelMap)
  const overridden = new Set(model.fields.map(f => f.name))
  return [...parentFields.filter(f => !overridden.has(f.name)), ...model.fields]
}

function mapTspTypeToJsonSchema(typeName: string): Record<string, unknown> {
  const clean = typeName.trim()
  if (clean.endsWith('[]')) {
    return {
      type: 'array',
      items: mapTspTypeToJsonSchema(clean.slice(0, -2)),
    }
  }
  switch (clean) {
    case 'string':
    case 'url':
    case 'utcDateTime':
      return { type: 'string' }
    case 'int32':
    case 'int64':
    case 'uint32':
    case 'uint64':
    case 'integer':
    case 'safeint':
      return { type: 'integer' }
    case 'float32':
    case 'float64':
    case 'numeric':
    case 'number':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    default:
      return { $ref: `#/$defs/${clean}` }
  }
}

function mapTspTypeToTs(typeName: string): string {
  const clean = typeName.trim()
  if (clean.endsWith('[]')) {
    return `${mapTspTypeToTs(clean.slice(0, -2))}[]`
  }
  switch (clean) {
    case 'string':
    case 'url':
    case 'utcDateTime':
      return 'string'
    case 'int32':
    case 'int64':
    case 'uint32':
    case 'uint64':
    case 'integer':
    case 'safeint':
    case 'float32':
    case 'float64':
    case 'numeric':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'void':
      return 'void'
    default:
      return clean
  }
}

function mapTspTypeToPy(typeName: string): string {
  const clean = typeName.trim()
  if (clean.endsWith('[]')) {
    return `list[${mapTspTypeToPy(clean.slice(0, -2))}]`
  }
  switch (clean) {
    case 'string':
    case 'url':
    case 'utcDateTime':
      return 'str'
    case 'int32':
    case 'int64':
    case 'uint32':
    case 'uint64':
    case 'integer':
    case 'safeint':
      return 'int'
    case 'float32':
    case 'float64':
    case 'numeric':
    case 'number':
      return 'float'
    case 'boolean':
      return 'bool'
    case 'void':
      return 'None'
    default:
      return clean
  }
}
