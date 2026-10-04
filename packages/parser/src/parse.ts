/**
 * parseDocument — OAS 3.2 원본 문서를 ParsedDocument IR로 변환
 *
 * 1. SpecPass 파이프라인 실행 ($ref 해결 등)
 * 2. paths + webhooks에서 오퍼레이션 추출
 * 3. components 정규화
 * 4. RouteIndex 구축
 */

import type { OasDocument } from './oas32-types.js'
import type {
  ParsedDocument,
  ParsedDocumentRefDiagnostic,
  ParsedDocumentRefResolutionScope,
} from './types.js'
import { runPipeline, DEFAULT_PASSES, createDerefPass, type SpecPass } from './pipeline.js'
import type { DerefCycleStrategy, DerefDiagnostic, DerefOptions } from './deref.js'
import { parseResolvedDocument } from './parse-core.js'
import { createParsedDocumentRefResolution } from './parsed-document.js'

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
  passesOrOptions: SpecPass[] | ParseDocumentOptions | undefined = undefined,
): ParsedDocument {
  const plan = createParsePlan(doc, passesOrOptions)
  const resolved = runPipeline(doc, plan.passes) as OasDocument
  const resolution = createParsedDocumentRefResolution({
    document: resolved,
    scope: plan.scope,
    diagnostics: plan.diagnostics,
    recursiveRefs: [...plan.recursiveRefs],
  })
  return parseResolvedDocument(resolved, doc, resolution)
}

type ParsePlan = {
  passes: SpecPass[]
  scope: ParsedDocumentRefResolutionScope
  diagnostics: ParsedDocumentRefDiagnostic[]
  recursiveRefs: Set<string>
}

function createParsePlan(
  doc: OasDocument,
  passesOrOptions: SpecPass[] | ParseDocumentOptions | undefined,
): ParsePlan {
  if (passesOrOptions === undefined || passesOrOptions === DEFAULT_PASSES) {
    return createDefaultDerefPlan()
  }

  if (Array.isArray(passesOrOptions)) {
    return createCustomPassPlan(doc, passesOrOptions)
  }

  const {
    passes,
    basePath,
    cycleStrategy,
    derefDiagnostics,
    onDerefDiagnostic,
  } = passesOrOptions

  if (passes) {
    return passes === DEFAULT_PASSES
      ? createDefaultDerefPlan()
      : createCustomPassPlan(doc, passes)
  }

  const diagnostics: DerefDiagnostic[] = []
  const recursiveRefs = new Set<string>()
  const derefOptions: DerefOptions = { diagnostics, onRecursiveRef: ref => recursiveRefs.add(ref) }
  if (basePath !== undefined) derefOptions.basePath = basePath
  if (cycleStrategy !== undefined) derefOptions.cycleStrategy = cycleStrategy
  if (derefDiagnostics !== undefined || onDerefDiagnostic !== undefined) {
    derefOptions.onDiagnostic = (diagnostic) => {
      derefDiagnostics?.push(diagnostic)
      onDerefDiagnostic?.(diagnostic)
    }
  }
  return {
    passes: [createDerefPass(derefOptions)],
    scope: basePath !== undefined ? 'all' : 'internal',
    diagnostics,
    recursiveRefs,
  }
}

function createDefaultDerefPlan(): ParsePlan {
  const diagnostics: DerefDiagnostic[] = []
  const recursiveRefs = new Set<string>()
  return {
    passes: [createDerefPass({ diagnostics, onRecursiveRef: ref => recursiveRefs.add(ref) })],
    scope: 'internal',
    diagnostics,
    recursiveRefs,
  }
}

function createCustomPassPlan(doc: OasDocument, passes: SpecPass[]): ParsePlan {
  const diagnostics = createParsedDocumentRefResolution({
    document: doc,
    scope: 'custom',
  }).diagnostics

  return {
    passes,
    scope: 'custom',
    diagnostics: [...diagnostics],
    recursiveRefs: new Set(),
  }
}
