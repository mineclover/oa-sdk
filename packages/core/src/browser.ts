/**
 * @oa-sdk/core/browser — shared utilities without Node HTTP dependencies.
 */

export { pascalCase, toTypeScriptIdentifier, createOperationTypeNameMap, toOperationMethodName, escapeKey, toColonPath } from './strings.js'
export { collectTypeNames, hasGeneratedErrorType, getGeneratedErrorResponseKeys } from './codegen-utils.js'
export { formatGeneratedTs } from './format.js'
export { pickDefaultStatus } from './response-utils.js'
