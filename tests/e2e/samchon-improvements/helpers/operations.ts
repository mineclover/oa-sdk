/**
 * Re-exports from @oa-sdk/parser genuine package.
 */
export {
  extractOperationsFromSource,
  extractOperationsFromFile,
  toOperationEntry,
  buildPathPointer,
  SUPPORTED_HTTP_METHODS,
} from '@oa-sdk/parser'

export type {
  ExtractedOperation,
  OperationDiagnostic,
  OperationExtractResult,
  HttpMethod,
} from '@oa-sdk/parser'
