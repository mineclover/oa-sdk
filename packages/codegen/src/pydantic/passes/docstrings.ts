/** S4 pass `docstrings` — removes descriptions when docstrings are disabled. */
import type { PyPass } from './index.js'
import { cloneIr } from './lib/ir-utils.js'

export const docstringsPass: PyPass<'docstrings'> = {
  name: 'docstrings',
  reads: ['docstrings'],
  run(ir, options, analysis) {
    void analysis
    const result = cloneIr(ir)
    if (options.docstrings) return result
    for (const decl of result.decls) {
      if (decl.description !== undefined) delete decl.description
    }
    return result
  },
}
