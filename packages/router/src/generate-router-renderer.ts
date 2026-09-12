/**
 * Master router orchestration facade delegating to framework-specific target renderers.
 */

import type { ParsedDocument } from '@oa-sdk/parser/browser'
import { renderHonoRouter } from './targets/hono.js'
import { renderExpressRouter } from './targets/express.js'
import { renderFastifyRouter } from './targets/fastify.js'
import { renderElysiaRouter } from './targets/elysia.js'

export type RouterTarget = 'hono' | 'express' | 'fastify' | 'elysia'
export type RouterMode = 'stub' | 'contract'

/** Platform-neutral router rendering options. */
export type RouterRenderOptions = {
  /** 라우터 프레임워크 (기본: hono) */
  target?: RouterTarget | undefined
  /** Mode: 'stub' (standalone with TODOs) or 'contract' (bound to handler contract) */
  mode?: RouterMode | undefined
  /** typegen 타입 import 경로 (예: './types') */
  typesImport?: string | undefined
  /** Handler contract import 경로 (예: './api.contract'). 지정 시 mode가 'contract'로 기본 설정됨 */
  contractImport?: string | undefined
  /** Handlers 인터페이스 이름 (기본: 'ApiHandlers') */
  contractName?: string | undefined
  /** 헤더 주석 */
  banner?: boolean | undefined
}

/**
 * ParsedDocument IR에서 서버 라우터 코드를 생성합니다.
 */
export function generateRouterFromParsed(doc: ParsedDocument, options: RouterRenderOptions = {}): string {
  const { target = 'hono' } = options

  switch (target) {
    case 'hono':
      return renderHonoRouter(doc, options)
    case 'express':
      return renderExpressRouter(doc, options)
    case 'fastify':
      return renderFastifyRouter(doc, options)
    case 'elysia':
      return renderElysiaRouter(doc, options)
    default:
      throw new Error(`Unsupported router target: ${String(target)}`)
  }
}
