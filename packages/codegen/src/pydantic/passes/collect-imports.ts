/** S4 pass `collectImports` — collects exactly the names used by the renderer. */
import type { PyTypeExpr } from '../ir.js'
import type { PyPass } from './index.js'
import { cloneIr, visitType } from './lib/ir-utils.js'

export const collectImportsPass: PyPass<never> = {
  name: 'collectImports',
  reads: [],
  run(ir, options, analysis) {
    void options
    void analysis
    const result = cloneIr(ir)
    const imports = new Map<string, Set<string>>([['__future__', new Set(['annotations'])]])
    const add = (module: string, name: string): void => {
      const values = imports.get(module) ?? new Set<string>()
      values.add(name)
      imports.set(module, values)
    }
    const inspect = (type: PyTypeExpr): void => {
      visitType(type, value => {
        if (value.kind === 'builtin' && value.name === 'Any') add('typing', 'Any')
        if (value.kind === 'literal') add('typing', 'Literal')
        if (value.kind === 'named') add(value.module, value.name)
        if (value.kind === 'union' && value.discriminator !== null) {
          add('typing', 'Annotated')
          add('pydantic', 'Field')
        }
        if (value.kind === 'constrained') {
          if (value.constraints.uniqueItems === true) {
            add('typing', 'Annotated')
            add('pydantic', 'AfterValidator')
          } else if (Object.keys(value.constraints).length > 0) {
            add('typing', 'Annotated')
            add('pydantic', 'Field')
          }
        }
      })
    }
    for (const decl of result.decls) {
      if (decl.kind === 'model') {
        add('pydantic', 'BaseModel')
        add('pydantic', 'ConfigDict')
        if (decl.openness.kind === 'typed-map') add('pydantic', 'Field')
        if (decl.fields.some(field => field.alias !== '' || field.description !== undefined
          || field.examples !== undefined || field.deprecated !== undefined
          || field.extensions !== undefined || field.default?.kind === 'value'
          || (field.type.kind === 'constrained'
            && Object.keys(field.type.constraints).some(key => key !== 'uniqueItems')))) {
          add('pydantic', 'Field')
        }
        if (decl.fields.some(field => field.rejectExplicitNull)) add('pydantic', 'field_validator')
        if (decl.openness.kind === 'typed-map') inspect(decl.openness.value)
        for (const field of decl.fields) {
          if (field.type.kind === 'constrained') {
            if (field.type.constraints.uniqueItems === true) {
              add('typing', 'Annotated')
              add('pydantic', 'AfterValidator')
            }
            inspect(field.type.base)
          } else inspect(field.type)
        }
      } else if (decl.kind === 'alias') {
        add('typing', 'TypeAlias')
        inspect(decl.type)
      } else {
        add('typing', 'TypeAlias')
        if (decl.repr === 'str-enum') add('enum', 'StrEnum')
        else add('typing', 'Literal')
      }
    }
    const from: Record<string, string[]> = {}
    for (const module of [...imports.keys()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)) {
      from[module] = [...(imports.get(module) ?? [])]
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    }
    result.imports = { from }
    return result
  },
}
