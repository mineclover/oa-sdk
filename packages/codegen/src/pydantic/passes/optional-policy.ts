/**
 * S4 pass `optionalPolicy` — reads: optionalStyle.
 *
 * Sets `PyField.default` and `PyField.rejectExplicitNull`:
 * - `required` → `{ kind: 'required' }`, `rejectExplicitNull: false` (a `schemaDefault` on a required
 *   field is ignored with a `pydantic/default-on-required` info diagnostic);
 * - not required with `schemaDefault` → `{ kind: 'value', json }`, `rejectExplicitNull` as below;
 * - not required without default → `{ kind: 'none' }`;
 * - `rejectExplicitNull` is true only for `optionalStyle: 'reject-null'`, not required, not nullable.
 */
import type { PyPass } from './index.js'
import { cloneIr } from './lib/ir-utils.js'

export const optionalPolicyPass: PyPass<'optionalStyle'> = {
  name: 'optionalPolicy',
  reads: ['optionalStyle'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    for (const decl of result.decls) {
      if (decl.kind !== 'model') continue
      for (const field of decl.fields) {
        if (field.required) {
          field.default = { kind: 'required' }
          field.rejectExplicitNull = false
        } else if (field.schemaDefault !== undefined) {
          field.default = { kind: 'value', json: field.schemaDefault.json }
          field.rejectExplicitNull = options.optionalStyle === 'reject-null' && !field.nullable
        } else {
          field.default = { kind: 'none' }
          field.rejectExplicitNull = options.optionalStyle === 'reject-null' && !field.nullable
        }
      }
    }
    return result
  },
}
