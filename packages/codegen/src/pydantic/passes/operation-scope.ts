/** S4 operation scope checks for constructs deferred to later milestones. */
import type { PyPass } from './index.js'
import type { PyTypeExpr } from '../ir.js'
import { cloneIr } from './lib/ir-utils.js'

export const operationScopePass: PyPass<never> = {
  name: 'operationScope',
  reads: [],
  run(ir, options, analysis) {
    void options
    void analysis
    const result = cloneIr(ir)
    for (const operation of result.decls) {
      if (operation.kind === 'model' && operation.operationRole?.kind === 'parameter-group') {
        operation.extra = 'forbid'
        continue
      }
      if (operation.kind !== 'operation') continue
      for (const media of operation.requestBody?.mediaTypes ?? []) if (media.schema === null || isAny(media.schema)) result.diagnostics.push({
        code: 'pydantic/media-type-unsupported', severity: 'warning', pointer: operation.requestBody?.pointer ?? operation.pointer,
        message: `No typed schema is available for request media type ${media.mediaType}`,
      })
      for (const response of operation.responses) {
        for (const media of response.mediaTypes) if (media.schema === null || isAny(media.schema)) result.diagnostics.push({
          code: 'pydantic/media-type-unsupported', severity: 'warning', pointer: response.pointer,
          message: `No typed schema is available for response media type ${media.mediaType}`,
        })
      }
    }
    return result
  },
}

function isAny(type: PyTypeExpr | null): boolean {
  return type?.kind === 'builtin' && type.name === 'Any'
}
