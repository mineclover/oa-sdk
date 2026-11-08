/** S4 `oneOf` policy. Exact mode is rendered by S5 when the branches are inspectable. */
import type { PyTypeExpr } from '../ir.js'
import type { PyPass } from './index.js'
import { cloneIr, mapDeclTypes, visitType } from './lib/ir-utils.js'

function exactCapable(type: PyTypeExpr): boolean {
  if (type.kind === 'builtin' && type.name === 'Any') return false
  if (type.kind === 'union') return false
  if (type.kind === 'list' || type.kind === 'dict' || type.kind === 'tuple') return false
  if (type.kind === 'constrained') return exactCapable(type.base)
  return true
}

export const oneofPolicyPass: PyPass<'oneOfMode'> = {
  name: 'oneofPolicy',
  reads: ['oneOfMode'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    if (options.oneOfMode !== 'exact') return result
    result.decls = result.decls.map(decl => mapDeclTypes(decl, type => type.kind === 'union'
      && type.origin === 'oneOf' && type.discriminator === null && type.members.every(exactCapable)
      ? { ...type, exact: true } : type))
    const check = (type: PyTypeExpr, pointer: string): void => {
      visitType(type, branch => {
        if (branch.kind !== 'union' || branch.origin !== 'oneOf' || branch.discriminator !== null || branch.members.every(exactCapable)) return
        result.diagnostics.push({
          code: 'pydantic/oneof-ambiguous', severity: 'info', pointer,
          message: 'Exact oneOf validation is not precise for one or more structural branches; smart validation is used',
        })
      })
    }
    for (const decl of result.decls) {
      if (decl.kind === 'model') {
        decl.fields.forEach(field => check(field.type, field.pointer))
        if (decl.openness.kind === 'typed-map') check(decl.openness.value, decl.pointer)
      } else if (decl.kind === 'alias') check(decl.type, decl.pointer)
      else if (decl.kind === 'operation') {
        decl.parameters.forEach(parameter => check(parameter.schema, parameter.pointer))
        if (decl.requestBody?.schema) check(decl.requestBody.schema, decl.requestBody.pointer)
        decl.responses.forEach(response => { if (response.schema) check(response.schema, response.pointer) })
      }
    }
    return result
  },
}
