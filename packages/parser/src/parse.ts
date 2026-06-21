/**
 * parseDocument — OAS 3.2 원본 문서를 ParsedDocument IR로 변환
 *
 * 1. SpecPass 파이프라인 실행 ($ref 해결 등)
 * 2. paths + webhooks에서 오퍼레이션 추출
 * 3. components 정규화
 * 4. RouteIndex 구축
 */

import type { OasDocument } from './oas32-types.js'
import type { ParsedDocument } from './types.js'
import { runPipeline, DEFAULT_PASSES, createDerefPass, type SpecPass } from './pipeline.js'
import type { DerefCycleStrategy, DerefDiagnostic, DerefOptions } from './deref.js'
import { parseResolvedDocument } from './parse-core.js'

export type ParseDocumentOptions = {
  passes?: SpecPass[]
  basePath?: string
  cycleStrategy?: DerefCycleStrategy
  derefDiagnostics?: DerefDiagnostic[]
  onDerefDiagnostic?: (diagnostic: DerefDiagnostic) => void
}

/**
 * OAS 3.2 원본 문서를 구조화된 ParsedDocument IR로 파싱합니다.
 *
 * @param doc 원본 OAS 3.2 문서 (JSON/YAML 파싱 후 객체)
 * @param passesOrOptions SpecPass 파이프라인 또는 파싱 옵션
 */
export function parseDocument(
  doc: OasDocument,
  passesOrOptions: SpecPass[] | ParseDocumentOptions = DEFAULT_PASSES,
): ParsedDocument {
  const passes = resolvePasses(passesOrOptions)
  const resolved = runPipeline(doc, passes) as OasDocument
  return parseResolvedDocument(resolved, doc)
}

function resolvePasses(passesOrOptions: SpecPass[] | ParseDocumentOptions): SpecPass[] {
  if (Array.isArray(passesOrOptions)) return passesOrOptions

  const {
    passes,
    basePath,
    cycleStrategy,
    derefDiagnostics,
    onDerefDiagnostic,
  } = passesOrOptions

  if (passes) return passes
  if (basePath || cycleStrategy || derefDiagnostics || onDerefDiagnostic) {
    const derefOptions: DerefOptions = {}
    if (basePath !== undefined) derefOptions.basePath = basePath
    if (cycleStrategy !== undefined) derefOptions.cycleStrategy = cycleStrategy
    if (derefDiagnostics !== undefined) derefOptions.diagnostics = derefDiagnostics
    if (onDerefDiagnostic !== undefined) derefOptions.onDiagnostic = onDerefDiagnostic
    return [createDerefPass(derefOptions)]
  }
  return DEFAULT_PASSES
}
