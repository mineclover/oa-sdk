/**
 * S4 pass `extraPolicy` — reads: extra.
 *
 * Sets `PyModelDecl.extra`: `openness.kind === 'closed'` → `forbid`; `typed-map` → `allow`
 * (render adds `__pydantic_extra__: dict[str, T]`); `open` → the `extra` option.
 */
import type { PyPass } from './index.js'
import { cloneIr } from './lib/ir-utils.js'

export const extraPolicyPass: PyPass<'extra'> = {
  name: 'extraPolicy',
  reads: ['extra'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    for (const decl of result.decls) {
      if (decl.kind !== 'model') continue
      decl.extra = decl.openness.kind === 'closed'
        ? 'forbid'
        : decl.openness.kind === 'typed-map' ? 'allow' : options.extra
    }
    return result
  },
}
