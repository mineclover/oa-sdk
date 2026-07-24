/**
 * @deprecated Internal compatibility facade. New generator code imports
 * responsibility-specific modules directly.
 */
export { appendClientErrorGuard, getErrorValidationEntries } from './error-contract.js'
export type { ErrorValidationEntry } from './error-contract.js'
export { getRequestBodySchema, requestValidationLines } from './request-contract.js'
export { isOperationRetryable } from './retry-policy.js'
export { appendRuntimeValidationHelpers, serializeValidationSchema } from './runtime-schema.js'
