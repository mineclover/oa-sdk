/**
 * @oa-sdk/core/browser — shared utilities without Node HTTP dependencies.
 */

export { pascalCase, escapeKey, toColonPath } from './strings.js'
export { collectTypeNames } from './codegen-utils.js'
export { formatGeneratedTs } from './format.js'
export { pickDefaultStatus } from './response-utils.js'
