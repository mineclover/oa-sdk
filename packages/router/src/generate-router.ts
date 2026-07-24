/** Node entrypoint for router stub generation. */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { assertParsedDocumentComplete, isParsedDocument, parseDocument } from '@oa-sdk/parser'
import { generateRouterFromParsed, type RouterRenderOptions } from './generate-router-renderer.js'

export type { RouterTarget } from './generate-router-renderer.js'

export type RouterOptions = RouterRenderOptions & {
  /** OAS 파일 경로. 상대 외부 $ref 해소에 사용 */
  basePath?: string
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
