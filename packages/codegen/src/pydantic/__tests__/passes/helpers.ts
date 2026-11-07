import type { SchemaGraphAnalysis } from '../../../schema-graph/index.js'
import type { PyField, PyModelDecl, PyModuleIR, PyTypeExpr } from '../../ir.js'

export const analysis: SchemaGraphAnalysis = {
  edges: {},
  recursive: [],
  order: [],
  discriminatorFamilies: [],
}

export function field(wireName: string, type: PyTypeExpr = { kind: 'builtin', name: 'str' }): PyField {
  return {
    wireName,
    attribute: null,
    alias: null,
    type,
    required: false,
    nullable: false,
    default: null,
    rejectExplicitNull: null,
    pointer: `/properties/${wireName}`,
  }
}

export function model(name: string, fields: PyField[] = []): PyModelDecl {
  return {
    kind: 'model',
    name,
    pyName: null,
    origin: 'component',
    bases: [],
    fields,
    openness: { kind: 'open' },
    extra: null,
    regexEngine: null,
    pointer: `/components/schemas/${name}`,
  }
}

export function module(...decls: PyModuleIR['decls']): PyModuleIR {
  return {
    irVersion: 1,
    module: 'models',
    decls,
    rebuild: [],
    imports: null,
    diagnostics: [],
  }
}

