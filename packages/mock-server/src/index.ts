// ─── 어댑터 ───────────────────────────────────────────────────────────────────
export { createMswHandlers, createMswMockServer } from './adapters/msw.js'
export type { MswHandlerOptions, MswMockServer } from './adapters/msw.js'

export { createNodeMockServer } from './adapters/node-http.js'
export type { NodeMockServer, NodeMockServerOptions, OverrideResponse } from './adapters/node-http.js'

// ─── 스키마 해석 (@oa-sdk/parser re-export) ──────────────────────────────────
export { foldSchema } from '@oa-sdk/parser'
export type { SchemaAlgebra } from '@oa-sdk/parser'
export { SchemaFolder } from '@oa-sdk/parser'
export { DerefFolder, derefSpec } from '@oa-sdk/parser'
export { runPipeline, derefPass, DEFAULT_PASSES } from '@oa-sdk/parser'
export type { SpecPass } from '@oa-sdk/parser'
export { loadSchema, matchRoute } from '@oa-sdk/parser'

// ─── mock-server 고유 ─────────────────────────────────────────────────────────
export { GenerateFolder, generator, generateAlgebra } from './core/generate.js'
export { StreamFolder, streamer, SSE_DONE, formatSseChunk, formatNdjsonLine, isStreamingContentType, generateStreamChunks } from './core/stream.js'
export type { StreamOptions } from './core/stream.js'

export { filterRouteIndex } from './core/route-filter.js'
export type { RouteFilter } from './core/route-filter.js'

export { validateRequest, validateRequestSchemas, assertValidRequestSchemas } from './core/request-validator.js'
export { pickResponse } from './core/response-picker.js'
export type { PickedResponse } from './core/response-picker.js'
export { handleRequest } from './core/handler.js'
export type { HandlerResult } from './core/handler.js'

// ─── 에러 ─────────────────────────────────────────────────────────────────────
export type { MockErrorCode, MockValidationStage, MockErrorDetail, MockValidationResult, MockErrorResponse } from './errors/types.js'
export { classifyAjvErrors } from './errors/classifier.js'

// ─── 테스트 헬퍼 ──────────────────────────────────────────────────────────────
export { createTestClient, createCoverageTracker } from './testing.js'
export type { TestClient, TestResponse, CoverageTracker } from './testing.js'
