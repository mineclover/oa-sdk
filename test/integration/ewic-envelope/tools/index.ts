import type { EwicEnvelopePort } from '../contracts/ports.js'
import { createValidateEnvelopeTool } from './ewic-validate-envelope.js'
import { createAdaptSourceRefTool } from './ewic-adapt-source-ref.js'
import { createVerifyExecutionTool } from './ewic-verify-execution.js'

export * from './ewic-validate-envelope.js'
export * from './ewic-adapt-source-ref.js'
export * from './ewic-verify-execution.js'

export function createEwicTools(port: EwicEnvelopePort) {
  return [
    createValidateEnvelopeTool(),
    createAdaptSourceRefTool(),
    createVerifyExecutionTool(port),
  ]
}
