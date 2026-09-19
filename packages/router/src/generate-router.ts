/** Node entrypoint for router stub and handler contract generation. */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { assertParsedDocumentComplete, isParsedDocument, parseDocument } from '@oa-sdk/parser'
import {
  generateRouterFromParsed,
  type RouterRenderOptions,
  type RouterTarget,
  type RouterMode,
} from './generate-router-renderer.js'
import {
  generateHandlerContractFromParsed,
  type HandlerContractOptions,
} from './contracts/handler-contract.js'
import {
  generateCrdtHandlerContractFromParsed,
  extractCrdtEntities,
  type CrdtContractOptions,
  type CrdtFieldMeta,
  type CrdtEntityMeta,
} from './contracts/crdt-contract.js'
import {
  generateCrdtRouterFromParsed,
  type CrdtRouterOptions,
  type CrdtRouterTarget,
} from './targets/crdt-router.js'

export type { RouterTarget, RouterMode, RouterRenderOptions } from './generate-router-renderer.js'
export type { HandlerContractOptions } from './contracts/handler-contract.js'
export type {
  CrdtContractOptions,
  CrdtFieldMeta,
  CrdtEntityMeta,
} from './contracts/crdt-contract.js'
export type {
  CrdtRouterOptions,
  CrdtRouterTarget,
} from './targets/crdt-router.js'

export { extractCrdtEntities } from './contracts/crdt-contract.js'

export type RouterOptions = RouterRenderOptions & {
  /** OAS 파일 경로. 상대 외부 $ref 해소에 사용 */
  basePath?: string | undefined
}

/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 서버 라우터 스텁을 생성합니다.
 * Node entrypoint는 relative external $ref 해소를 위해 basePath를 지원합니다.
 */
export function generateRouter(spec: OasDocument | ParsedDocument, options: RouterOptions = {}): string {
  const doc = isParsedDocument(spec)
    ? spec
    : options.basePath !== undefined
      ? parseDocument(spec, { basePath: options.basePath })
      : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateRouter')
  return generateRouterFromParsed(doc, options)
}

/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 순수 TypeScript 핸들러 계약을 생성합니다.
 */
export function generateHandlerContract(
  spec: OasDocument | ParsedDocument,
  options: HandlerContractOptions & { basePath?: string } = {},
): string {
  const doc = isParsedDocument(spec)
    ? spec
    : options.basePath !== undefined
      ? parseDocument(spec, { basePath: options.basePath })
      : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateHandlerContract')
  return generateHandlerContractFromParsed(doc, options)
}

/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 CRDT 핸들러 계약을 생성합니다.
 */
export function generateCrdtHandlerContract(
  spec: OasDocument | ParsedDocument,
  options: CrdtContractOptions = {},
): string {
  const doc = isParsedDocument(spec)
    ? spec
    : options.basePath !== undefined
      ? parseDocument(spec, { basePath: options.basePath })
      : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateCrdtHandlerContract')
  return generateCrdtHandlerContractFromParsed(doc, options)
}

/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 멀티 프레임워크 CRDT WebSocket 라우터를 생성합니다.
 */
export function generateCrdtRouter(
  spec: OasDocument | ParsedDocument,
  options: CrdtRouterOptions = {},
): string {
  const doc = isParsedDocument(spec)
    ? spec
    : options.basePath !== undefined
      ? parseDocument(spec, { basePath: options.basePath })
      : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/router generateCrdtRouter')
  return generateCrdtRouterFromParsed(doc, options)
}

