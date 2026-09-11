/**
 * Re-exports from @oa-sdk/ast-sync genuine package.
 */
export {
  createVirtualProgram,
  createInMemoryProgram,
  createProgramFromTsconfig,
  cleanupProgram,
  getCanonicalSymbolId,
  resolveAlias,
  detectCyclesWithChecker,
} from '@oa-sdk/ast-sync'

export type {
  SymbolCycleResult,
} from '@oa-sdk/ast-sync'
