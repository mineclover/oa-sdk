/** S4 operation scope checks for constructs deferred to later milestones. */
import type { PyPass } from './index.js'
import { cloneIr } from './lib/ir-utils.js'

export const operationScopePass: PyPass<never> = {
  name: 'operationScope',
  reads: [],
  run(ir, options, analysis) {
    void options
    void analysis
    const result = cloneIr(ir)
    for (const operation of result.decls) {
      if (operation.kind !== 'operation') continue
      if (operation.requestBody !== null && operation.requestBody.mediaType !== null
        && operation.requestBody.mediaType !== 'application/json') {
        result.diagnostics.push({
          code: 'pydantic/operation-unsupported', severity: 'warning', pointer: operation.requestBody.pointer,
          message: `Only application/json request bodies are supported for now (found ${operation.requestBody.mediaType})`,
        })
      }
      if (operation.requestBody !== null && operation.requestBody.otherMediaTypes.length > 0) {
        result.diagnostics.push({
          code: 'pydantic/operation-unsupported', severity: 'warning', pointer: operation.requestBody.pointer,
          message: `Additional request body media types are listed but not rendered: ${operation.requestBody.otherMediaTypes.join(', ')}`,
        })
      }
      for (const response of operation.responses) {
        if (response.mediaType !== null && response.mediaType !== 'application/json') {
          result.diagnostics.push({
            code: 'pydantic/operation-unsupported', severity: 'warning', pointer: response.pointer,
            message: `Only application/json responses are supported for now (found ${response.mediaType})`,
          })
        }
        if (response.otherMediaTypes.length > 0) {
          result.diagnostics.push({
            code: 'pydantic/operation-unsupported', severity: 'warning', pointer: response.pointer,
            message: `Additional response media types are listed but not rendered: ${response.otherMediaTypes.join(', ')}`,
          })
        }
      }
    }
    return result
  },
}
