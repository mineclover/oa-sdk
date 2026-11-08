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
      if (operation.kind === 'model' && operation.operationRole?.kind === 'parameter-group') {
        operation.extra = 'forbid'
        continue
      }
      if (operation.kind !== 'operation') continue
      if (operation.requestBody !== null && operation.requestBody.mediaType !== null
        && !isJsonMediaType(operation.requestBody.mediaType)) {
        result.diagnostics.push({
          code: 'pydantic/media-type-unsupported', severity: 'warning', pointer: operation.requestBody.pointer,
          message: `Only JSON request bodies are rendered (found ${operation.requestBody.mediaType})`,
        })
      }
      if (operation.requestBody !== null && operation.requestBody.otherMediaTypes.length > 0) {
        result.diagnostics.push({
          code: 'pydantic/media-type-unsupported', severity: 'warning', pointer: operation.requestBody.pointer,
          message: `Multiple or additional request body media types are present; ignored: ${operation.requestBody.otherMediaTypes.join(', ')}`,
        })
      }
      for (const response of operation.responses) {
        if (response.mediaType !== null && !isJsonMediaType(response.mediaType)) {
          result.diagnostics.push({
            code: 'pydantic/media-type-unsupported', severity: 'warning', pointer: response.pointer,
            message: `Only JSON responses are rendered (found ${response.mediaType})`,
          })
        }
        if (response.otherMediaTypes.length > 0) {
          result.diagnostics.push({
            code: 'pydantic/media-type-unsupported', severity: 'warning', pointer: response.pointer,
            message: `Multiple or additional response media types are present; ignored: ${response.otherMediaTypes.join(', ')}`,
          })
        }
      }
    }
    return result
  },
}

function isJsonMediaType(value: string): boolean {
  const base = value.split(';', 1)[0]!.trim().toLowerCase()
  return base === 'application/json' || base.endsWith('+json')
}
