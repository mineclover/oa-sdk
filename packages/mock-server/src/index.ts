// ─── 어댑터 ───────────────────────────────────────────────────────────────────
export { createMswHandlers } from './adapters/msw.js'
export type { MswHandlerOptions } from './adapters/msw.js'

export { createNodeMockServer } from './adapters/node-http.js'
export type { NodeMockServer, NodeMockServerOptions } from './adapters/node-http.js'

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
export { StreamFolder, streamer, SSE_DONE, formatSseChunk, formatNdjsonLine, isStreamingContentType } from './core/stream.js'
export type { StreamOptions } from './core/stream.js'

export { validateRequest } from './core/request-validator.js'
export { pickResponse } from './core/response-picker.js'
export type { PickedResponse } from './core/response-picker.js'

// ─── 에러 ─────────────────────────────────────────────────────────────────────
export type { MockErrorCode, MockErrorDetail, MockValidationResult, MockErrorResponse } from './errors/types.js'
export { classifyAjvErrors } from './errors/classifier.js'

// ─── 테스트 헬퍼 ──────────────────────────────────────────────────────────────
export { createTestClient, createCoverageTracker } from './testing.js'
export type { TestClient, TestResponse, CoverageTracker } from './testing.js'
