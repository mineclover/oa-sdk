/**
 * S4 pass `naming` — reads: naming.
 *
 * Sets every `pyName`, `PyField.attribute` and `PyField.alias`:
 * - declaration `pyName`: PascalCase Python identifier of `name` (inline: owner pyName + PascalCase
 *   property path), deduplicated in sorted-`name` order with numeric suffixes (`Name2`),
 *   independent of
 *   the `naming` option; `pydantic/name-collision` info when a suffix was needed;
 * - `snake-alias`: attribute = snake_case of the wire name; `preserve`: attribute = wire name;
 * - in both modes the attribute is then made a valid identifier, keyword-safe (`from` → `from_`),
 *   not shadowing `BaseModel` attributes (`json`, `copy`, `dict`, `schema`, `fields`, `model_*`, …),
 *   unique within the model (and its bases);
 * - alias = wire name when it differs from the attribute, else `''`.
 * Uses the shared Python identifier helper (`packages/codegen/src/python-identifier.ts`), promoted from
 * `sketch-emitter`.
 */
import type { PyPass } from './index.js'
import { PYDANTIC_BASE_MODEL_ATTRIBUTES, pascalCase, pythonIdentifier, snakeCase } from '../../python-identifier.js'
import { cloneIr } from './lib/ir-utils.js'

export const namingPass: PyPass<'naming'> = {
  name: 'naming',
  reads: ['naming'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    const byName = new Map(result.decls.map(decl => [decl.name, decl]))
    const usedDeclarationNames = new Set<string>()
    for (const decl of [...result.decls].sort((left, right) => left.name.localeCompare(right.name))) {
      if (decl.kind === 'operation' || (decl.kind === 'model' && decl.operationOwner !== undefined)) continue
      const segments = decl.name.split('/').filter(Boolean)
      const candidate = pascalCase(segments.join('_'))
      let pyName = candidate
      let suffix = 2
      while (usedDeclarationNames.has(pyName)) pyName = `${candidate}${suffix++}`
      if (pyName !== candidate) {
        result.diagnostics.push({
          code: 'pydantic/name-collision',
          severity: 'info',
          pointer: decl.pointer,
          message: `Declaration name '${decl.name}' was renamed to '${pyName}' after a collision`,
        })
      }
      usedDeclarationNames.add(pyName)
      const target = byName.get(decl.name)
      if (target !== undefined) target.pyName = pyName
    }

    const inheritedFields = (name: string, visiting = new Set<string>()): Map<string, string> => {
      if (visiting.has(name)) return new Map()
      visiting.add(name)
      const decl = byName.get(name)
      if (decl?.kind !== 'model') return new Map()
      const fields = new Map<string, string>()
      for (const base of decl.bases) {
        for (const [wire, attribute] of inheritedFields(base, new Set(visiting))) fields.set(wire, attribute)
        const baseDecl = byName.get(base)
        if (baseDecl?.kind === 'model') {
          for (const field of baseDecl.fields) {
            if (field.attribute !== null) fields.set(field.wireName, field.attribute)
          }
        }
      }
      return fields
    }

    const models = new Map(result.decls.filter(decl => decl.kind === 'model').map(decl => [decl.name, decl]))
    const orderedModels: typeof result.decls = []
    const placed = new Set<string>()
    const visiting = new Set<string>()
    const placeModel = (name: string): void => {
      if (placed.has(name) || visiting.has(name)) return
      const decl = models.get(name)
      if (decl === undefined || decl.kind !== 'model') return
      visiting.add(name)
      for (const base of [...decl.bases].sort((left, right) => left.localeCompare(right))) placeModel(base)
      visiting.delete(name)
      placed.add(name)
      orderedModels.push(decl)
    }
    for (const name of [...models.keys()].sort((left, right) => left.localeCompare(right))) placeModel(name)

    for (const decl of orderedModels) {
      if (decl.kind !== 'model') continue
      const used = new Set<string>(PYDANTIC_BASE_MODEL_ATTRIBUTES)
      const inherited = inheritedFields(decl.name)
      for (const attribute of inherited.values()) used.add(attribute)
      for (const field of decl.fields) {
        const inheritedAttribute = inherited.get(field.wireName)
        if (inheritedAttribute !== undefined) {
          field.attribute = inheritedAttribute
          field.alias = field.wireName === inheritedAttribute ? '' : field.wireName
          continue
        }
        const source = options.naming === 'snake-alias' ? snakeCase(field.wireName) : field.wireName
        const stripped = source.replace(/^_+/, '') || 'field'
        const identifier = pythonIdentifier(stripped)
        const reserved = PYDANTIC_BASE_MODEL_ATTRIBUTES.has(identifier) || identifier.startsWith('model_')
        const base = reserved ? `${identifier}_` : identifier
        let attribute = base
        let suffix = 2
        while (used.has(attribute)) attribute = `${base}${suffix++}`
        if (attribute !== base) {
          result.diagnostics.push({
            code: 'pydantic/name-collision',
            severity: 'info',
            pointer: field.pointer,
            message: `Field '${field.wireName}' was renamed to '${attribute}' after a collision`,
          })
        }
        used.add(attribute)
        field.attribute = attribute
        field.alias = field.wireName === attribute ? '' : field.wireName
      }
    }
    return result
  },
}
