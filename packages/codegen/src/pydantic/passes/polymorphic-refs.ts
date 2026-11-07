/**
 * S4 pass `polymorphicRefs` — reads: no options.
 *
 * Discriminator families (S2 `discriminatorFamilies`):
 * - adds one `alias` declaration per family base, `origin: 'polymorphic-union'`, named `<Base>Union`
 *   (dedup with a numeric suffix on collision), type = `union` of `ref` to every variant with
 *   `discriminator: <propertyName>`, placed directly after the last variant declaration;
 * - rewrites every `ref` to the base (fields, aliases, nested positions) into a `ref` to that alias,
 *   EXCEPT the base reference inside a variant's `bases`;
 * - narrows the tag field of every variant to `literal` of its tag (TypeSpec emits the tag as a
 *   single-value `enum` next to `allOf: [$ref Base]`), and sets `discriminator` on base and variants.
 * A family with no resolvable variant gets no alias and a `pydantic/discriminator-without-variants` warning.
 */
import type { PyPass } from './index.js'
import type { PyAliasDecl, PyDecl, PyTypeExpr } from '../ir.js'
import { cloneIr, mapDeclTypes } from './lib/ir-utils.js'

export const polymorphicRefsPass: PyPass<never> = {
  name: 'polymorphicRefs',
  reads: [],
  run(ir, options, analysis) {
    void options
    const result = cloneIr(ir)
    const byName = new Map(result.decls.map(decl => [decl.name, decl]))
    const aliases = new Map<string, string>()
    const insertAfter = new Map<number, PyAliasDecl[]>()
    const usedNames = new Set(result.decls.map(decl => decl.name))
    const families = [...analysis.discriminatorFamilies]
      .sort((left, right) => left.base.localeCompare(right.base))
    for (const family of families) {
      const variants = family.variants.filter(variant => byName.get(variant.schema)?.kind === 'model')
      const base = byName.get(family.base)
      if (base?.kind === 'model') {
        base.discriminator = { propertyName: family.propertyName, role: 'base' }
      }
      for (const variant of variants) {
        const declaration = byName.get(variant.schema)
        if (declaration?.kind !== 'model') continue
        declaration.discriminator = { propertyName: family.propertyName, role: 'variant', tag: variant.tag }
        const field = declaration.fields.find(item => item.wireName === family.propertyName)
        if (field !== undefined) field.type = { kind: 'literal', values: [variant.tag] }
      }
      if (variants.length === 0) {
        result.diagnostics.push({
          code: 'pydantic/discriminator-without-variants',
          severity: 'warning',
          pointer: base?.pointer ?? '/',
          message: `Discriminator '${family.propertyName}' on '${family.base}' has no resolvable variants`,
        })
        continue
      }
      const candidate = `${family.base}Union`
      let aliasName = candidate
      let suffix = 2
      while (usedNames.has(aliasName)) aliasName = `${candidate}${suffix++}`
      usedNames.add(aliasName)
      aliases.set(family.base, aliasName)
      const alias: PyAliasDecl = {
        kind: 'alias',
        name: aliasName,
        pyName: null,
        origin: 'polymorphic-union',
        type: {
          kind: 'union',
          members: variants.map(variant => ({ kind: 'ref', target: variant.schema })),
          discriminator: family.propertyName,
        },
        pointer: base?.pointer ?? '/',
      }
      const lastIndex = Math.max(
        ...variants.map(variant => result.decls.findIndex(decl => decl.name === variant.schema)),
      )
      const list = insertAfter.get(lastIndex) ?? []
      list.push(alias)
      insertAfter.set(lastIndex, list)
    }

    const rewritten: PyDecl[] = []
    result.decls.forEach((decl, index) => {
      const mapped = mapDeclTypes(decl, (type: PyTypeExpr) => {
        if (type.kind !== 'ref') return type
        const target = aliases.get(type.target)
        return target === undefined ? type : { kind: 'ref', target }
      })
      rewritten.push(mapped)
      for (const alias of insertAfter.get(index) ?? []) rewritten.push(alias)
    })
    result.decls = rewritten
    return result
  },
}
