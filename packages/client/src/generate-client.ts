/** Node entrypoint for fetch client generation. */

import type { OasDocument, ParsedDocument } from '@oa-sdk/parser'
import { assertParsedDocumentComplete, isParsedDocument, parseDocument } from '@oa-sdk/parser'
import { generateClientFromParsed, type ClientRenderOptions } from './generate-client-renderer.js'

export type ClientOptions = ClientRenderOptions & {
  /** OAS 파일 경로. 상대 외부 $ref 해소에 사용 */
  basePath?: string
}

/**
 * OAS 원본 문서 또는 ParsedDocument IR에서 fetch client SDK를 생성합니다.
 * Node entrypoint는 relative external $ref 해소를 위해 basePath를 지원합니다.
 */
export function generateClient(spec: OasDocument | ParsedDocument, options: ClientOptions = {}): string {
  const doc = isParsedDocument(spec)
    ? spec
    : options.basePath !== undefined
      ? parseDocument(spec, { basePath: options.basePath })
      : parseDocument(spec)
  assertParsedDocumentComplete(doc, '@oa-sdk/client generateClient')
  return generateClientFromParsed(doc, options)
}
