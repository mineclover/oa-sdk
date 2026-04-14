// ─── MSW 어댑터 (브라우저 + Node 공용) ───────────────────────────────────────
export { createMswHandlers, createMswMockServer } from './adapters/msw.js'
export type { MswHandlerOptions, MswMockServer } from './adapters/msw.js'

// ─── 코어 (Node 의존성 없음) ──────────────────────────────────────────────────
export { validateRequest, validateRequestSchemas, assertValidRequestSchemas } from './core/request-validator.js'
export { pickResponse } from './core/response-picker.js'
export type { PickedResponse } from './core/response-picker.js'
export { handleRequest } from './core/handler.js'
export type { HandlerResult } from './core/handler.js'
export { GenerateFolder, generator, generateAlgebra } from './core/generate.js'
export { StreamFolder, streamer, SSE_DONE, formatSseChunk, formatNdjsonLine, isStreamingContentType, generateStreamChunks } from './core/stream.js'
export type { StreamOptions } from './core/stream.js'
export { filterRouteIndex } from './core/route-filter.js'
export type { RouteFilter } from './core/route-filter.js'

// ─── 에러 ─────────────────────────────────────────────────────────────────────
export type { MockErrorCode, MockValidationStage, MockErrorDetail, MockValidationResult, MockErrorResponse } from './errors/types.js'
export { classifyAjvErrors } from './errors/classifier.js'

// ─── parser re-exports ────────────────────────────────────────────────────────
export { foldSchema, SchemaFolder, DerefFolder, derefSpec, parseDocument, loadSchema, matchRoute } from '@oa-sdk/parser'
export type { SchemaAlgebra, SpecPass } from '@oa-sdk/parser'
