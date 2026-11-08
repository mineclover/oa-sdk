/** S4 pass `frozen` — sets the model immutability decision. */
import type { PyPass } from './index.js'
import { cloneIr } from './lib/ir-utils.js'

export const frozenPass: PyPass<'frozen'> = {
  name: 'frozen',
  reads: ['frozen'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    for (const decl of result.decls) {
      if (decl.kind === 'model') decl.frozen = options.frozen
    }
    return result
  },
}
