import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createOperationTypeNameMap, pascalCase } from '@oa-sdk/core'
import {
  escapeJsonPointerToken,
  parseDocument,
  resolveRefGraph,
  unescapeJsonPointerToken,
  type OasDocument,
  type OasOperation,
  type OasPathItem,
  type OasResponse,
  type OasSchema,
} from '@oa-sdk/parser'
import type { BuildSpecMetadataRegistry } from '../cli/lib/metadata-registry.js'
import type { BuildSpecProvenanceMap } from '../cli/lib/provenance-report.js'
import {
  buildTypeSpecRefProvenance,
  type TypeSpecRefProvenanceDeclaration,
  type TypeSpecRefProvenanceV1,
} from '../cli/lib/typespec-ref-provenance.js'
import type { ArtifactKind } from '../config.js'
import { toCamelCase, type OaManifest } from '../routing/index.js'
import { computeSha256, stableStringify } from '../spec-projector.js'
import type { TypegenProvenanceEntry } from '../typegen/generate-types.js'
import { createComponentTypeNameMap } from '../typegen/type-names.js'

export const SPEC_TRACEABILITY_SCHEMA_VERSION = 'oa-sdk.spec-traceability.v1' as const
export const DEFAULT_TRACE_SIDECAR_FILENAME = '.oa-trace.json' as const

const TRACEABILITY_STABLE_KEY_DOMAIN = 'oa-sdk.spec-traceability.stable-key.v1'
const TRACEABILITY_TRACKING_ID_DOMAIN = 'oa-sdk.spec-traceability.tracking-id.v1'

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
  'query',
] as const

export type SpecDefinitionKind =
  | 'schema'
  | 'operation'
  | 'webhook'
  | 'parameter'
  | 'response'
  | 'requestBody'
  | 'header'
  | 'link'
  | 'callback'
  | 'securityScheme'

export type SpecTraceSourceOrigin =
  | 'typespec-ast'
  | 'definition-fragment'
  | 'openapi-inline'

export type SpecTraceSourceCoordinates = {
  origin: SpecTraceSourceOrigin
  filePath?: string
  sourcePointer?: string
  symbol?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export type SpecTraceGovernanceCapabilities = {
  persona?: string
  personaTraits: string[]
  dpmProjection?: string
  storageRef?: string
  behaviorRef?: string
  requirements: string[]
}

export type SpecTraceArtifactKind = ArtifactKind | 'types'

export type SpecTraceGeneratedArtifactMapping = {
  kind: SpecTraceArtifactKind
  filePath?: string
  exportedSymbols: string[]
}

export type SpecTraceabilityNode = {
  /** OpenAPI 3.2 JSON Pointer (예: #/components/schemas/User, #/paths/~1users/get) */
  pointer: string
  /** 정식 정의 ID (예: schema.User, operation.listUsers) */
  canonicalId: string
  /** 정의 종류 */
  kind: SpecDefinitionKind
  /** 정의 심볼명 또는 operationId */
  symbol: string
  /** 불변 추적 ID (@traceId 명시값 또는 결정론적 trk_<16hex>) */
  trackingId: string
  trackingIdSource: 'explicit' | 'generated'
  /** 결정론적 안정 키 (oa-meta:v1:<32hex>) */
  stableKey: string
  /** 정규화된 정의 본문 SHA-256 해시 */
  contentHash: string
  /** 마이그레이션/대체 이전 정의 ID 목록 */
  replaces: string[]
  /** 원본 작성 소스 좌표 (TypeSpec AST / YAML 조각 / 인라인 스펙) */
  source: SpecTraceSourceCoordinates
  /** 거버넌스 및 아키텍처 capability 메타데이터 */
  governance: SpecTraceGovernanceCapabilities
  /** 정방향 $ref 대상 JSON Pointer 목록 (이 정의가 참조하는 대상) */
  references: string[]
  /** 역방향 $ref 출처 JSON Pointer 목록 (이 정의를 참조하는 상위 정의) */
  referencedBy: string[]
  /** 생성된 코드 아티팩트 및 TypeScript 심볼 매핑 */
  generatedArtifacts: SpecTraceGeneratedArtifactMapping[]
  /** Operation 전용 HTTP 메서드 */
  method?: string
  /** Operation 전용 OpenAPI 경로 */
  openApiPath?: string
}

export type SpecTraceabilityEdgeKind = 'references' | 'replaces' | 'emits-artifact'

export type SpecTraceabilityEdge = {
  kind: SpecTraceabilityEdgeKind
  from: string
  to: string
  detail?: string
}

export type SpecTraceabilityDiagnosticCode =
  | 'traceability/duplicate-tracking-id'
  | 'traceability/unresolved-ref'
  | 'traceability/unmapped-source'

export type SpecTraceabilityDiagnostic = {
  code: SpecTraceabilityDiagnosticCode
  severity: 'error' | 'warning'
  pointer: string
  message: string
  trackingId?: string
  relatedPointers?: string[]
}

export type SpecTraceabilitySummary = {
  nodeCount: number
  schemaCount: number
  operationCount: number
  componentCount: number
  explicitTrackingIdCount: number
  generatedTrackingIdCount: number
  mappedSourceCount: number
  referenceEdgeCount: number
  generatedSymbolCount: number
  diagnosticCount: number
}

export type SpecTraceabilityGraph = {
  schemaVersion: typeof SPEC_TRACEABILITY_SCHEMA_VERSION
  specSha256: string
  summary: SpecTraceabilitySummary
  nodes: Record<string, SpecTraceabilityNode>
  edges: SpecTraceabilityEdge[]
  diagnostics: SpecTraceabilityDiagnostic[]
}

export type BuildSpecTraceabilityOptions = {
  /** 분석 대상 OpenAPI 3.2 문서 */
  spec: OasDocument
  /** 원본 스펙 파일 경로 (기본 소스 좌표 표시용) */
  specPath?: string
  /** TypeSpec 소스 디렉토리 루트 (지정 시 TypeSpec AST 선언 좌표를 자동 결합) */
  typespecRoot?: string
  /** 사전 계산된 TypeSpec AST 출처 아티팩트 */
  typespecProvenance?: TypeSpecRefProvenanceV1
  /** Definition Builder YAML 조각 출처 맵 */
  provenanceMap?: BuildSpecProvenanceMap
  /** Definition Builder 메타데이터 레지스트리 */
  metadataRegistry?: BuildSpecMetadataRegistry
  /** 코드 생성 매니페스트 (.oa-manifest.json) — 생성된 파일 경로 연결용 */
  manifest?: OaManifest
  /** 아티팩트 종류별 파일 경로 오버라이드 */
  artifactFilePaths?: Partial<Record<SpecTraceArtifactKind, string>>
}

export type SpecTraceQuery = {
  /** JSON Pointer 정확 일치 또는 부분 일치 */
  pointer?: string
  /** 정의 심볼명 또는 생성된 TypeScript 심볼명 */
  symbol?: string
  /** 정식 정의 ID (예: schema.User, operation.listUsers) */
  canonicalId?: string
  /** 추적 ID (예: TRC-USER-001, trk_...) */
  trackingId?: string
  /** 원본 소스 파일 경로 (부분 문자열 일치 지원) */
  sourceFile?: string
  /** 요구사항 ID (예: REQ-AUTH-101) */
  requirement?: string
  /** 페르소나 ID */
  persona?: string
  /** 페르소나 capability trait */
  personaTrait?: string
  /** 정의 종류 필터 */
  kind?: SpecDefinitionKind
}

export type SpecImpactAnalysis = {
  /** 변경 시작 대상(입력값) */
  seedTargets: string[]
  /** 해석된 시작 JSON Pointer 목록 */
  seedPointers: string[]
  /** 전이적 역방향 참조를 포함한 전체 영향 JSON Pointer 목록 */
  affectedPointers: string[]
  /** 영향받는 스키마 정의 목록 */
  affectedSchemas: SpecTraceabilityNode[]
  /** 영향받는 오퍼레이션 정의 목록 */
  affectedOperations: SpecTraceabilityNode[]
  /** 영향받는 기타 컴포넌트 정의 목록 */
  affectedComponents: SpecTraceabilityNode[]
  /** 영향받는 페르소나 목록 */
  affectedPersonas: string[]
  /** 영향받는 요구사항 ID 목록 */
  affectedRequirements: string[]
  /** 재생성/검증이 필요한 생성 코드 파일 경로 목록 */
  affectedFiles: string[]
  /** 영향받는 생성 코드 TypeScript 심볼 목록 */
  affectedGeneratedSymbols: string[]
}

type RawTraceMetadata = {
  trackingId?: string
  replaces: string[]
  requirements: string[]
  typeSpecSource?: {
    file: string
    symbol: string
    kind: string
    line?: number
    column?: number
    endLine?: number
    endColumn?: number
  }
}

/**
 * OpenAPI 3.2 문서와 선택적 출처/매니페스트 정보를 결합하여
 * 엔드투엔드 스펙 정의 추적성 그래프(SpecTraceabilityGraph)를 생성합니다.
 */
export function buildSpecTraceabilityGraph(
  options: BuildSpecTraceabilityOptions,
): SpecTraceabilityGraph {
  const { spec, specPath } = options
  const specSha256 = computeSha256(stableStringify(spec))

  const typespecProvenance =
    options.typespecProvenance ??
    (options.typespecRoot
      ? buildTypeSpecRefProvenance({
          sourceRoot: options.typespecRoot,
          restoredDocument: spec,
          sidecar: {
            schemaVersion: 'oa-sdk.typespec-compat-sidecar.v1',
            counts: {
              entries: 0,
              parameterExamples: 0,
              responseMediaExamples: 0,
              securitySchemes: 0,
            },
            entries: [],
          },
        }).artifact
      : undefined)

  const tspDeclByPointer = indexTypeSpecDeclarationsByPointer(typespecProvenance)
  const artifactPathsByKind = resolveArtifactPathsByKind(options.manifest, options.artifactFilePaths)

  const parsedDoc = parseDocument(spec, [])
  const componentTypeNames = createComponentTypeNameMap(
    Object.keys(spec.components?.schemas ?? {}),
  )
  const allOperations = [...parsedDoc.operations, ...parsedDoc.webhooks]
  const operationTypeNames = createOperationTypeNameMap(allOperations)

  const rawNodes = new Map<string, SpecTraceabilityNode>()
  const diagnostics: SpecTraceabilityDiagnostic[] = []

  // 1. components/* 수집
  const components = spec.components ?? {}
  const componentSections: Array<{
    section: keyof NonNullable<OasDocument['components']>
    kind: SpecDefinitionKind
  }> = [
    { section: 'schemas', kind: 'schema' },
    { section: 'parameters', kind: 'parameter' },
    { section: 'responses', kind: 'response' },
    { section: 'requestBodies', kind: 'requestBody' },
    { section: 'headers', kind: 'header' },
    { section: 'links', kind: 'link' },
    { section: 'callbacks', kind: 'callback' },
    { section: 'securitySchemes', kind: 'securityScheme' },
  ]

  for (const { section, kind } of componentSections) {
    const map = components[section] as Record<string, unknown> | undefined
    if (!map || typeof map !== 'object') continue

    for (const [name, definition] of Object.entries(map).sort(([a], [b]) => a.localeCompare(b))) {
      if (!definition || typeof definition !== 'object') continue
      const pointer = `#/components/${section}/${escapeJsonPointerToken(name)}`
      const canonicalId = `${kind}.${name}`
      const symbol =
        kind === 'schema'
          ? (componentTypeNames.byComponentName.get(name) ?? pascalCase(name))
          : name

      const node = createTraceNode({
        pointer,
        canonicalId,
        kind,
        symbol,
        rawDefinition: definition as Record<string, unknown>,
        specPath,
        tspDecl: tspDeclByPointer.get(pointer),
        provenanceEntry: options.provenanceMap?.[pointer],
        metadataEntry: options.metadataRegistry?.entries[pointer],
        generatedArtifacts:
          kind === 'schema'
            ? buildSchemaGeneratedArtifacts(symbol, artifactPathsByKind)
            : [],
      })
      rawNodes.set(pointer, node)
    }
  }

  // 2. paths/* 오퍼레이션 수집
  for (const [openApiPath, rawPathItem] of Object.entries(spec.paths ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!rawPathItem || typeof rawPathItem !== 'object' || '$ref' in rawPathItem) continue
    const pathItem = rawPathItem as OasPathItem
    for (const method of HTTP_METHODS) {
      const rawOp = pathItem[method]
      if (!rawOp || typeof rawOp !== 'object') continue
      const op = rawOp as OasOperation
      const pointer = `#/paths/${escapeJsonPointerToken(openApiPath)}/${method}`
      const fallbackOpId = `${method}_${openApiPath.replace(/[^A-Za-z0-9]+/g, '_')}`
      const operationId = op.operationId ?? fallbackOpId
      const canonicalId = `operation.${operationId}`
      const baseTypeName =
        (op.operationId ? operationTypeNames.get(op.operationId) : undefined) ??
        pascalCase(operationId)

      const node = createTraceNode({
        pointer,
        canonicalId,
        kind: 'operation',
        symbol: op.operationId ?? baseTypeName,
        rawDefinition: op as unknown as Record<string, unknown>,
        specPath,
        tspDecl: tspDeclByPointer.get(pointer),
        provenanceEntry: options.provenanceMap?.[pointer],
        metadataEntry: options.metadataRegistry?.entries[pointer],
        generatedArtifacts: buildOperationGeneratedArtifacts(
          op,
          pathItem,
          baseTypeName,
          method,
          artifactPathsByKind,
        ),
        method,
        openApiPath,
      })
      rawNodes.set(pointer, node)
    }
  }

  // 3. webhooks/* 오퍼레이션 수집
  for (const [webhookName, rawPathItem] of Object.entries(spec.webhooks ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!rawPathItem || typeof rawPathItem !== 'object' || '$ref' in rawPathItem) continue
    const pathItem = rawPathItem as OasPathItem
    for (const method of HTTP_METHODS) {
      const rawOp = pathItem[method]
      if (!rawOp || typeof rawOp !== 'object') continue
      const op = rawOp as OasOperation
      const pointer = `#/webhooks/${escapeJsonPointerToken(webhookName)}/${method}`
      const operationId = op.operationId ?? `webhook_${webhookName}_${method}`
      const canonicalId = `webhook.${operationId}`
      const baseTypeName =
        (op.operationId ? operationTypeNames.get(op.operationId) : undefined) ??
        pascalCase(operationId)

      const node = createTraceNode({
        pointer,
        canonicalId,
        kind: 'webhook',
        symbol: op.operationId ?? baseTypeName,
        rawDefinition: op as unknown as Record<string, unknown>,
        specPath,
        tspDecl: tspDeclByPointer.get(pointer),
        provenanceEntry: options.provenanceMap?.[pointer],
        metadataEntry: options.metadataRegistry?.entries[pointer],
        generatedArtifacts: buildOperationGeneratedArtifacts(
          op,
          pathItem,
          baseTypeName,
          method,
          artifactPathsByKind,
        ),
        method,
        openApiPath: `/webhooks/${webhookName}`,
      })
      rawNodes.set(pointer, node)
    }
  }

  // 4. $ref 의존성 그래프 해석 및 양방향(references / referencedBy) 엣지 구축
  const refGraph = resolveRefGraph(
    spec,
    specPath ? { basePath: specPath } : undefined,
  )
  const knownPointers = [...rawNodes.keys()].sort((a, b) => b.length - a.length)
  const edges: SpecTraceabilityEdge[] = []

  for (const refNode of refGraph.nodes) {
    const ownerPointer = findOwningNodePointer(refNode.sourcePointer, knownPointers)
    if (!refNode.resolved) {
      diagnostics.push({
        code: 'traceability/unresolved-ref',
        severity: 'warning',
        pointer: ownerPointer ?? refNode.sourcePointer,
        message: `해소되지 않은 $ref 참조입니다: ${refNode.ref} (source: ${refNode.sourcePointer})`,
      })
      continue
    }

    const targetPointer = normalizeInternalTargetPointer(refNode.pointer ?? refNode.ref)
    if (!ownerPointer || !targetPointer || ownerPointer === targetPointer) continue

    const owner = rawNodes.get(ownerPointer)
    const target = rawNodes.get(targetPointer)
    if (owner && !owner.references.includes(targetPointer)) {
      owner.references.push(targetPointer)
      edges.push({
        kind: 'references',
        from: ownerPointer,
        to: targetPointer,
        detail: refNode.sourcePointer,
      })
    }
    if (target && !target.referencedBy.includes(ownerPointer)) {
      target.referencedBy.push(ownerPointer)
    }
  }

  // 5. replaces 및 emits-artifact 엣지 추가, 중복 trackingId 진단
  const nodesByTrackingId = new Map<string, SpecTraceabilityNode[]>()
  for (const node of rawNodes.values()) {
    node.references.sort()
    node.referencedBy.sort()

    for (const replacedId of node.replaces) {
      edges.push({
        kind: 'replaces',
        from: node.pointer,
        to: replacedId,
      })
    }

    for (const artifact of node.generatedArtifacts) {
      for (const exportedSymbol of artifact.exportedSymbols) {
        edges.push({
          kind: 'emits-artifact',
          from: node.pointer,
          to: `${artifact.kind}:${exportedSymbol}`,
          ...(artifact.filePath ? { detail: artifact.filePath } : {}),
        })
      }
    }

    const bucket = nodesByTrackingId.get(node.trackingId) ?? []
    bucket.push(node)
    nodesByTrackingId.set(node.trackingId, bucket)
  }

  for (const [trackingId, group] of nodesByTrackingId.entries()) {
    if (group.length <= 1) continue
    const pointers = group.map(item => item.pointer).sort()
    for (const item of group) {
      diagnostics.push({
        code: 'traceability/duplicate-tracking-id',
        severity: 'error',
        pointer: item.pointer,
        trackingId,
        relatedPointers: pointers,
        message: `중복된 trackingId '${trackingId}'가 여러 스펙 정의에서 감지되었습니다: ${pointers.join(', ')}`,
      })
    }
  }

  const sortedNodes: Record<string, SpecTraceabilityNode> = {}
  for (const pointer of [...rawNodes.keys()].sort()) {
    sortedNodes[pointer] = rawNodes.get(pointer)!
  }

  const allNodeList = Object.values(sortedNodes)
  const summary: SpecTraceabilitySummary = {
    nodeCount: allNodeList.length,
    schemaCount: allNodeList.filter(n => n.kind === 'schema').length,
    operationCount: allNodeList.filter(n => n.kind === 'operation' || n.kind === 'webhook').length,
    componentCount: allNodeList.filter(
      n => n.kind !== 'schema' && n.kind !== 'operation' && n.kind !== 'webhook',
    ).length,
    explicitTrackingIdCount: allNodeList.filter(n => n.trackingIdSource === 'explicit').length,
    generatedTrackingIdCount: allNodeList.filter(n => n.trackingIdSource === 'generated').length,
    mappedSourceCount: allNodeList.filter(n => Boolean(n.source.filePath)).length,
    referenceEdgeCount: edges.filter(e => e.kind === 'references').length,
    generatedSymbolCount: allNodeList.reduce(
      (acc, n) =>
        acc +
        n.generatedArtifacts.reduce((inner, a) => inner + a.exportedSymbols.length, 0),
      0,
    ),
    diagnosticCount: diagnostics.length,
  }

  return {
    schemaVersion: SPEC_TRACEABILITY_SCHEMA_VERSION,
    specSha256,
    summary,
    nodes: sortedNodes,
    edges,
    diagnostics,
  }
}

/**
 * SpecTraceabilityGraph에서 `generateTypes`의 `provenance` 옵션에 전달할 수 있는
 * `Record<string, TypegenProvenanceEntry>` 맵을 추출합니다.
 */
export function toTypegenProvenanceMap(
  graph: SpecTraceabilityGraph,
): Record<string, TypegenProvenanceEntry> {
  const map: Record<string, TypegenProvenanceEntry> = {}
  for (const [pointer, node] of Object.entries(graph.nodes)) {
    map[pointer] = {
      canonicalId: node.canonicalId,
      ...(node.source.filePath ? { sourcePath: node.source.filePath } : {}),
      ...(node.source.sourcePointer ? { sourcePointer: node.source.sourcePointer } : {}),
      trackingId: node.trackingId,
      ...(node.replaces[0] ? { replaces: node.replaces[0] } : {}),
      ...(node.governance.requirements.length > 0
        ? { requirements: node.governance.requirements }
        : {}),
    }
  }
  return map
}

/**
 * 다중 조건(pointer, symbol, canonicalId, trackingId, sourceFile, requirement, persona 등)으로
 * 스펙 정의 추적 노드를 질의합니다.
 */
export function querySpecTrace(
  graph: SpecTraceabilityGraph,
  query: SpecTraceQuery,
): SpecTraceabilityNode[] {
  return Object.values(graph.nodes).filter(node => {
    if (query.kind && node.kind !== query.kind) return false

    if (query.pointer) {
      const q = query.pointer.trim()
      if (node.pointer !== q && !node.pointer.includes(q)) return false
    }

    if (query.canonicalId) {
      const q = query.canonicalId.trim()
      if (node.canonicalId !== q) return false
    }

    if (query.trackingId) {
      const q = query.trackingId.trim()
      if (node.trackingId !== q) return false
    }

    if (query.symbol) {
      const q = query.symbol.trim()
      const matchesPrimarySymbol =
        node.symbol === q || node.canonicalId === q || node.canonicalId.endsWith(`.${q}`)
      const matchesGeneratedSymbol = node.generatedArtifacts.some(artifact =>
        artifact.exportedSymbols.includes(q),
      )
      if (!matchesPrimarySymbol && !matchesGeneratedSymbol) return false
    }

    if (query.sourceFile) {
      const q = query.sourceFile.trim()
      if (!node.source.filePath || !node.source.filePath.includes(q)) return false
    }

    if (query.requirement) {
      const q = query.requirement.trim()
      if (!node.governance.requirements.includes(q)) return false
    }

    if (query.persona) {
      const q = query.persona.trim()
      if (node.governance.persona !== q) return false
    }

    if (query.personaTrait) {
      const q = query.personaTrait.trim()
      if (!node.governance.personaTraits.includes(q)) return false
    }

    return true
  })
}

/**
 * 특정 스펙 정의(JSON Pointer, canonicalId, trackingId, 또는 심볼명)가 변경될 때
 * 역방향 `$ref` 그래프(`referencedBy`)를 따라 전이적 영향 범위(Blast Radius)를 계산합니다.
 */
export function analyzeSpecImpact(
  graph: SpecTraceabilityGraph,
  changedTargets: readonly string[],
): SpecImpactAnalysis {
  const seedPointers = new Set<string>()

  for (const target of changedTargets) {
    const trimmed = target.trim()
    if (!trimmed) continue
    if (graph.nodes[trimmed]) {
      seedPointers.add(trimmed)
      continue
    }
    const matched = Object.values(graph.nodes).filter(
      node =>
        node.canonicalId === trimmed ||
        node.trackingId === trimmed ||
        node.symbol === trimmed ||
        node.generatedArtifacts.some(a => a.exportedSymbols.includes(trimmed)),
    )
    for (const node of matched) {
      seedPointers.add(node.pointer)
    }
  }

  const visited = new Set<string>(seedPointers)
  const queue = [...seedPointers]

  while (queue.length > 0) {
    const currentPointer = queue.shift()!
    const currentNode = graph.nodes[currentPointer]
    if (!currentNode) continue

    for (const inboundPointer of currentNode.referencedBy) {
      if (!visited.has(inboundPointer) && graph.nodes[inboundPointer]) {
        visited.add(inboundPointer)
        queue.push(inboundPointer)
      }
    }
  }

  const affectedPointers = [...visited].sort()
  const affectedNodes = affectedPointers
    .map(pointer => graph.nodes[pointer])
    .filter((node): node is SpecTraceabilityNode => Boolean(node))

  const affectedSchemas = affectedNodes.filter(n => n.kind === 'schema')
  const affectedOperations = affectedNodes.filter(
    n => n.kind === 'operation' || n.kind === 'webhook',
  )
  const affectedComponents = affectedNodes.filter(
    n => n.kind !== 'schema' && n.kind !== 'operation' && n.kind !== 'webhook',
  )

  const affectedPersonas = new Set<string>()
  const affectedRequirements = new Set<string>()
  const affectedFiles = new Set<string>()
  const affectedGeneratedSymbols = new Set<string>()

  for (const node of affectedNodes) {
    if (node.governance.persona) {
      affectedPersonas.add(node.governance.persona)
    }
    for (const req of node.governance.requirements) {
      affectedRequirements.add(req)
    }
    for (const artifact of node.generatedArtifacts) {
      if (artifact.filePath) {
        affectedFiles.add(artifact.filePath)
      }
      for (const sym of artifact.exportedSymbols) {
        affectedGeneratedSymbols.add(sym)
      }
    }
  }

  return {
    seedTargets: [...changedTargets],
    seedPointers: [...seedPointers].sort(),
    affectedPointers,
    affectedSchemas,
    affectedOperations,
    affectedComponents,
    affectedPersonas: [...affectedPersonas].sort(),
    affectedRequirements: [...affectedRequirements].sort(),
    affectedFiles: [...affectedFiles].sort(),
    affectedGeneratedSymbols: [...affectedGeneratedSymbols].sort(),
  }
}

/**
 * 추적성 그래프를 결정론적 JSON 문자열로 직렬화합니다.
 */
export function serializeSpecTraceabilityGraph(graph: SpecTraceabilityGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`
}

/**
 * `.oa-trace.json` 사이드카 파일로 저장합니다.
 */
export function saveSpecTraceabilitySidecar(
  filePath: string,
  graph: SpecTraceabilityGraph,
): void {
  const resolved = resolve(filePath)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, serializeSpecTraceabilityGraph(graph), 'utf-8')
}

/**
 * `.oa-trace.json` 사이드카 파일을 로드하고 스키마 버전을 검증합니다.
 */
export function loadSpecTraceabilitySidecar(filePath: string): SpecTraceabilityGraph {
  const resolved = resolve(filePath)
  const raw = JSON.parse(readFileSync(resolved, 'utf-8')) as SpecTraceabilityGraph
  if (!raw || raw.schemaVersion !== SPEC_TRACEABILITY_SCHEMA_VERSION) {
    throw new Error(
      `유효하지 않은 스펙 추적성 사이드카 버전입니다: ${String(
        (raw as { schemaVersion?: unknown } | undefined)?.schemaVersion,
      )} (expected: ${SPEC_TRACEABILITY_SCHEMA_VERSION})`,
    )
  }
  return raw
}

/**
 * 터미널 출력용 사람이 읽기 쉬운 추적성 리포트를 포맷팅합니다.
 */
export function formatSpecTraceabilityHumanReport(
  nodes: readonly SpecTraceabilityNode[],
  impact?: SpecImpactAnalysis,
): string {
  const lines: string[] = []
  lines.push(`=== Spec Traceability Report (${nodes.length} definition(s)) ===`)

  for (const node of nodes) {
    lines.push('')
    lines.push(`[${node.kind.toUpperCase()}] ${node.symbol} (${node.canonicalId})`)
    lines.push(`  Pointer     : ${node.pointer}`)
    lines.push(`  Tracking ID : ${node.trackingId} (${node.trackingIdSource})`)
    lines.push(`  Stable Key  : ${node.stableKey}`)
    if (node.source.filePath) {
      const loc =
        node.source.line !== undefined
          ? `:${node.source.line}:${node.source.column ?? 1}`
          : node.source.sourcePointer && node.source.sourcePointer !== '#'
            ? node.source.sourcePointer
            : ''
      lines.push(`  Source      : ${node.source.filePath}${loc} (${node.source.origin})`)
    } else {
      lines.push(`  Source      : <inline> (${node.source.origin})`)
    }
    if (node.replaces.length > 0) {
      lines.push(`  Replaces    : ${node.replaces.join(', ')}`)
    }
    if (node.governance.requirements.length > 0) {
      lines.push(`  Requirements: ${node.governance.requirements.join(', ')}`)
    }
    if (node.governance.persona || node.governance.personaTraits.length > 0) {
      const traits =
        node.governance.personaTraits.length > 0
          ? ` [${node.governance.personaTraits.join(', ')}]`
          : ''
      lines.push(`  Persona     : ${node.governance.persona ?? 'default'}${traits}`)
    }
    if (node.references.length > 0) {
      lines.push(`  References  : ${node.references.join(', ')}`)
    }
    if (node.referencedBy.length > 0) {
      lines.push(`  ReferencedBy: ${node.referencedBy.join(', ')}`)
    }
    if (node.generatedArtifacts.length > 0) {
      lines.push('  Artifacts   :')
      for (const artifact of node.generatedArtifacts) {
        const pathLabel = artifact.filePath ? ` (${artifact.filePath})` : ''
        lines.push(
          `    - [${artifact.kind}]${pathLabel}: ${artifact.exportedSymbols.join(', ')}`,
        )
      }
    }
  }

  if (impact) {
    lines.push('')
    lines.push(`=== Impact Analysis (Blast Radius) ===`)
    lines.push(`  Seed Pointers       : ${impact.seedPointers.join(', ') || '(none)'}`)
    lines.push(`  Affected Pointers   : ${impact.affectedPointers.length}`)
    lines.push(
      `  Affected Schemas    : ${impact.affectedSchemas.map(s => s.symbol).join(', ') || '(none)'}`,
    )
    lines.push(
      `  Affected Operations : ${impact.affectedOperations.map(o => o.symbol).join(', ') || '(none)'}`,
    )
    if (impact.affectedRequirements.length > 0) {
      lines.push(`  Affected Req IDs    : ${impact.affectedRequirements.join(', ')}`)
    }
    if (impact.affectedPersonas.length > 0) {
      lines.push(`  Affected Personas   : ${impact.affectedPersonas.join(', ')}`)
    }
    lines.push(
      `  Affected TS Symbols : ${impact.affectedGeneratedSymbols.join(', ') || '(none)'}`,
    )
    if (impact.affectedFiles.length > 0) {
      lines.push(`  Affected Files      : ${impact.affectedFiles.join(', ')}`)
    }
  }

  return lines.join('\n')
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────────────────────

function createTraceNode(input: {
  pointer: string
  canonicalId: string
  kind: SpecDefinitionKind
  symbol: string
  rawDefinition: Record<string, unknown>
  specPath?: string | undefined
  tspDecl?: TypeSpecRefProvenanceDeclaration | undefined
  provenanceEntry?: BuildSpecProvenanceMap[string] | undefined
  metadataEntry?: BuildSpecMetadataRegistry['entries'][string] | undefined
  generatedArtifacts: SpecTraceGeneratedArtifactMapping[]
  method?: string | undefined
  openApiPath?: string | undefined
}): SpecTraceabilityNode {
  const {
    pointer,
    canonicalId,
    kind,
    symbol,
    rawDefinition,
    specPath,
    tspDecl,
    provenanceEntry,
    metadataEntry,
    generatedArtifacts,
    method,
    openApiPath,
  } = input

  const traceMeta = extractRawTraceMetadata(rawDefinition)
  const governance = extractGovernanceCapabilities(rawDefinition, traceMeta.requirements)
  const contentHash =
    metadataEntry?.contentHash ??
    provenanceEntry?.contentHash ??
    computeSha256(stableStringify(stripTraceAndGovernanceExtensions(rawDefinition)))

  const explicitTrackingId =
    traceMeta.trackingId ??
    (metadataEntry?.trackingIdSource === 'explicit' ? metadataEntry.trackingId : undefined)

  const trackingIdSource: 'explicit' | 'generated' = explicitTrackingId ? 'explicit' : 'generated'
  const trackingId =
    explicitTrackingId ??
    metadataEntry?.trackingId ??
    computeDeterministicTrackingId(canonicalId, pointer)

  const replaces = Array.from(
    new Set([...(metadataEntry?.replaces ?? []), ...traceMeta.replaces]),
  ).sort()

  const identityKey = replaces[0] ?? canonicalId
  const stableKey =
    metadataEntry?.stableKey ?? computeDeterministicStableKey(kind, identityKey)

  const fragmentFilePath = provenanceEntry?.sourcePath ?? metadataEntry?.sourcePath
  const source: SpecTraceSourceCoordinates = tspDecl
    ? {
        origin: 'typespec-ast',
        filePath: tspDecl.source.file,
        sourcePointer: `#/${tspDecl.kind}/${tspDecl.symbol}`,
        symbol: tspDecl.symbol,
        line: tspDecl.source.start.line,
        column: tspDecl.source.start.column,
        endLine: tspDecl.source.end.line,
        endColumn: tspDecl.source.end.column,
      }
    : traceMeta.typeSpecSource
      ? {
          origin: 'typespec-ast',
          filePath: traceMeta.typeSpecSource.file,
          sourcePointer: `#/${traceMeta.typeSpecSource.kind}/${traceMeta.typeSpecSource.symbol}`,
          symbol: traceMeta.typeSpecSource.symbol,
          ...(traceMeta.typeSpecSource.line !== undefined ? { line: traceMeta.typeSpecSource.line } : {}),
          ...(traceMeta.typeSpecSource.column !== undefined ? { column: traceMeta.typeSpecSource.column } : {}),
          ...(traceMeta.typeSpecSource.endLine !== undefined ? { endLine: traceMeta.typeSpecSource.endLine } : {}),
          ...(traceMeta.typeSpecSource.endColumn !== undefined ? { endColumn: traceMeta.typeSpecSource.endColumn } : {}),
        }
    : provenanceEntry || metadataEntry
      ? {
          origin: 'definition-fragment',
          ...(fragmentFilePath ? { filePath: fragmentFilePath } : {}),
          sourcePointer: provenanceEntry?.sourcePointer ?? metadataEntry?.sourcePointer ?? '#',
          symbol,
        }
      : {
          origin: 'openapi-inline',
          ...(specPath ? { filePath: specPath } : {}),
          sourcePointer: pointer,
          symbol,
        }

  return {
    pointer,
    canonicalId,
    kind,
    symbol,
    trackingId,
    trackingIdSource,
    stableKey,
    contentHash,
    replaces,
    source,
    governance,
    references: [],
    referencedBy: [],
    generatedArtifacts,
    ...(method ? { method } : {}),
    ...(openApiPath ? { openApiPath } : {}),
  }
}

function extractRawTraceMetadata(record: Record<string, unknown>): RawTraceMetadata {
  const rawTrace = record['x-oa-sdk-trace']
  const rawMeta = record['x-oa-metadata']
  const rawSamchonEvidence = record['x-samchon-evidence']
  let trackingId: string | undefined
  const replaces: string[] = []
  const requirements: string[] = []
  let typeSpecSource: RawTraceMetadata['typeSpecSource']

  if (rawTrace && typeof rawTrace === 'object') {
    const traceObj = rawTrace as Record<string, unknown>
    if (typeof traceObj.trackingId === 'string' && traceObj.trackingId.trim().length > 0) {
      trackingId = traceObj.trackingId.trim()
    }
    if (typeof traceObj.replaces === 'string' && traceObj.replaces.trim().length > 0) {
      replaces.push(traceObj.replaces.trim())
    } else if (Array.isArray(traceObj.replaces)) {
      for (const item of traceObj.replaces) {
        if (typeof item === 'string' && item.trim().length > 0) {
          replaces.push(item.trim())
        }
      }
    }
    if (Array.isArray(traceObj.requirements)) {
      for (const req of traceObj.requirements) {
        if (typeof req === 'string' && req.trim().length > 0) {
          requirements.push(req.trim())
        }
      }
    }
  }

  if (rawMeta && typeof rawMeta === 'object') {
    const metaObj = rawMeta as Record<string, unknown>
    if (!trackingId && typeof metaObj.trackingId === 'string' && metaObj.trackingId.trim().length > 0) {
      trackingId = metaObj.trackingId.trim()
    }
    if (typeof metaObj.replaces === 'string' && metaObj.replaces.trim().length > 0) {
      replaces.push(metaObj.replaces.trim())
    } else if (Array.isArray(metaObj.replaces)) {
      for (const item of metaObj.replaces) {
        if (typeof item === 'string' && item.trim().length > 0) {
          replaces.push(item.trim())
        }
      }
    }
  }

  if (rawSamchonEvidence && typeof rawSamchonEvidence === 'object') {
    const evObj = rawSamchonEvidence as Record<string, unknown>
    if (typeof evObj.upstreamRequirement === 'string' && evObj.upstreamRequirement.trim().length > 0) {
      requirements.push(evObj.upstreamRequirement.trim())
    }
    if (Array.isArray(evObj.requirements)) {
      for (const item of evObj.requirements) {
        if (typeof item === 'string' && item.trim().length > 0) {
          requirements.push(item.trim())
        } else if (item && typeof item === 'object') {
          const target = (item as { target?: unknown }).target
          if (typeof target === 'string' && target.trim().length > 0) {
            requirements.push(target.trim())
          }
        }
      }
    }
    if (evObj.typeSpecSource && typeof evObj.typeSpecSource === 'object') {
      const tsSrc = evObj.typeSpecSource as Record<string, unknown>
      const file = typeof tsSrc.file === 'string' ? tsSrc.file.trim() : ''
      const sym = typeof tsSrc.symbol === 'string' ? tsSrc.symbol.trim() : ''
      const rawKind = typeof tsSrc.kind === 'string' ? tsSrc.kind.trim().toLowerCase() : 'model'
      if (file && sym) {
        const startObj =
          tsSrc.start && typeof tsSrc.start === 'object'
            ? (tsSrc.start as Record<string, unknown>)
            : undefined
        const endObj =
          tsSrc.end && typeof tsSrc.end === 'object'
            ? (tsSrc.end as Record<string, unknown>)
            : undefined
        typeSpecSource = {
          file,
          symbol: sym,
          kind: rawKind === 'operation' ? 'operation' : 'model',
          ...(typeof startObj?.line === 'number' ? { line: startObj.line } : {}),
          ...(typeof startObj?.column === 'number' ? { column: startObj.column } : {}),
          ...(typeof endObj?.line === 'number' ? { endLine: endObj.line } : {}),
          ...(typeof endObj?.column === 'number' ? { endColumn: endObj.column } : {}),
        }
      }
    }
  }

  return {
    ...(trackingId ? { trackingId } : {}),
    replaces: Array.from(new Set(replaces)),
    requirements: Array.from(new Set(requirements)),
    ...(typeSpecSource ? { typeSpecSource } : {}),
  }
}

function extractGovernanceCapabilities(
  record: Record<string, unknown>,
  requirements: string[],
): SpecTraceGovernanceCapabilities {
  const persona =
    typeof record['x-persona'] === 'string' && record['x-persona'].trim().length > 0
      ? record['x-persona'].trim()
      : undefined

  const personaTraits: string[] = []
  const rawTraits = record['x-oa-sdk-persona-traits']
  if (Array.isArray(rawTraits)) {
    for (const item of rawTraits) {
      if (typeof item === 'string' && item.trim().length > 0) {
        personaTraits.push(item.trim())
      }
    }
  }

  const dpmProjection =
    typeof record['x-oa-sdk-dpm-projection'] === 'string'
      ? record['x-oa-sdk-dpm-projection']
      : undefined
  const storageRef =
    typeof record['x-oa-sdk-storage-ref'] === 'string'
      ? record['x-oa-sdk-storage-ref']
      : undefined
  const behaviorRef =
    typeof record['x-oa-sdk-behavior-ref'] === 'string'
      ? record['x-oa-sdk-behavior-ref']
      : undefined

  return {
    ...(persona ? { persona } : {}),
    personaTraits: Array.from(new Set(personaTraits)).sort(),
    ...(dpmProjection ? { dpmProjection } : {}),
    ...(storageRef ? { storageRef } : {}),
    ...(behaviorRef ? { behaviorRef } : {}),
    requirements: Array.from(new Set(requirements)).sort(),
  }
}

function stripTraceAndGovernanceExtensions(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'x-oa-sdk-trace' || key === 'x-oa-metadata' || key === 'x-samchon-evidence') continue
    copy[key] = value
  }
  return copy
}

function computeDeterministicTrackingId(canonicalId: string, pointer: string): string {
  const digest = createHash('sha256')
    .update(`${TRACEABILITY_TRACKING_ID_DOMAIN}\0${canonicalId}\0${pointer}`)
    .digest('hex')
    .slice(0, 16)
  return `trk_${digest}`
}

function computeDeterministicStableKey(kind: string, identityKey: string): string {
  const digest = createHash('sha256')
    .update(`${TRACEABILITY_STABLE_KEY_DOMAIN}\0${kind}\0${identityKey}`)
    .digest('hex')
    .slice(0, 32)
  return `oa-meta:v1:${digest}`
}

function indexTypeSpecDeclarationsByPointer(
  provenance: TypeSpecRefProvenanceV1 | undefined,
): Map<string, TypeSpecRefProvenanceDeclaration> {
  const map = new Map<string, TypeSpecRefProvenanceDeclaration>()
  if (!provenance) return map

  const declById = new Map<string, TypeSpecRefProvenanceDeclaration>()
  for (const decl of provenance.declarations) {
    declById.set(decl.id, decl)
  }

  for (const edge of provenance.edges) {
    if (edge.kind !== 'emits' && edge.kind !== 'restores') continue
    const decl = declById.get(edge.declarationId)
    if (decl && !map.has(edge.outputPointer)) {
      map.set(edge.outputPointer, decl)
    }
  }
  return map
}

function resolveArtifactPathsByKind(
  manifest?: OaManifest,
  overrides?: Partial<Record<SpecTraceArtifactKind, string>>,
): Partial<Record<SpecTraceArtifactKind, string>> {
  const result: Partial<Record<SpecTraceArtifactKind, string>> = {}
  if (manifest?.artifacts) {
    for (const [filePath, entry] of Object.entries(manifest.artifacts)) {
      const kind = entry.kind as SpecTraceArtifactKind
      if (!result[kind]) {
        result[kind] = filePath
      }
    }
  }
  if (overrides) {
    for (const [kind, filePath] of Object.entries(overrides)) {
      if (filePath) {
        result[kind as SpecTraceArtifactKind] = filePath
      }
    }
  }
  return result
}

function buildSchemaGeneratedArtifacts(
  typeName: string,
  artifactPathsByKind: Partial<Record<SpecTraceArtifactKind, string>>,
): SpecTraceGeneratedArtifactMapping[] {
  return [
    {
      kind: 'types',
      ...(artifactPathsByKind.types ? { filePath: artifactPathsByKind.types } : {}),
      exportedSymbols: [typeName],
    },
    {
      kind: 'guards',
      ...(artifactPathsByKind.guards ? { filePath: artifactPathsByKind.guards } : {}),
      exportedSymbols: [`is${typeName}`, `assert${typeName}`],
    },
    {
      kind: 'schemas',
      ...(artifactPathsByKind.schemas ? { filePath: artifactPathsByKind.schemas } : {}),
      exportedSymbols: [`${typeName}Schema`],
    },
  ]
}

function buildOperationGeneratedArtifacts(
  op: OasOperation,
  pathItem: OasPathItem,
  baseTypeName: string,
  method: string,
  artifactPathsByKind: Partial<Record<SpecTraceArtifactKind, string>>,
): SpecTraceGeneratedArtifactMapping[] {
  const typeSymbols: string[] = []
  const mergedParams = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])]
  const hasPathParam = mergedParams.some(p => !('$ref' in p) && p.in === 'path')
  const hasQueryParam = mergedParams.some(p => !('$ref' in p) && p.in === 'query')
  const hasHeaderParam = mergedParams.some(p => !('$ref' in p) && p.in === 'header')
  const hasQuerystringParam = mergedParams.some(p => !('$ref' in p) && p.in === 'querystring')

  if (hasPathParam) typeSymbols.push(`${baseTypeName}PathParams`)
  if (hasQueryParam) typeSymbols.push(`${baseTypeName}QueryParams`)
  if (hasQuerystringParam) typeSymbols.push(`${baseTypeName}QueryString`)
  if (hasHeaderParam) typeSymbols.push(`${baseTypeName}HeaderParams`)
  if (hasJsonMediaSchema(op.requestBody)) typeSymbols.push(`${baseTypeName}Body`)
  if (hasSuccessResponseJsonSchema(op.responses)) typeSymbols.push(`${baseTypeName}Response`)
  if (hasErrorResponseJsonSchema(op.responses)) {
    typeSymbols.push(`${baseTypeName}Error`, `${baseTypeName}ErrorByStatus`)
  }
  typeSymbols.push(`${baseTypeName}Op`)

  const methodIdent = op.operationId ? toCamelCase(op.operationId) : toCamelCase(baseTypeName)
  const isQueryMethod = method.toLowerCase() === 'get' || method.toLowerCase() === 'head'
  const queryHookSymbol = isQueryMethod
    ? `use${baseTypeName}Query`
    : `use${baseTypeName}Mutation`

  return [
    {
      kind: 'types',
      ...(artifactPathsByKind.types ? { filePath: artifactPathsByKind.types } : {}),
      exportedSymbols: typeSymbols,
    },
    {
      kind: 'contract',
      ...(artifactPathsByKind.contract ? { filePath: artifactPathsByKind.contract } : {}),
      exportedSymbols: [`${baseTypeName}Handler`, `${baseTypeName}Contract`],
    },
    {
      kind: 'router',
      ...(artifactPathsByKind.router ? { filePath: artifactPathsByKind.router } : {}),
      exportedSymbols: [`${methodIdent}Route`],
    },
    {
      kind: 'client',
      ...(artifactPathsByKind.client ? { filePath: artifactPathsByKind.client } : {}),
      exportedSymbols: [methodIdent],
    },
    {
      kind: 'keys',
      ...(artifactPathsByKind.keys ? { filePath: artifactPathsByKind.keys } : {}),
      exportedSymbols: [`${methodIdent}QueryKey`],
    },
    {
      kind: 'queries',
      ...(artifactPathsByKind.queries ? { filePath: artifactPathsByKind.queries } : {}),
      exportedSymbols: [queryHookSymbol],
    },
  ]
}

function hasJsonMediaSchema(bodyOrResponse: unknown): boolean {
  if (!bodyOrResponse || typeof bodyOrResponse !== 'object') return false
  if ('$ref' in bodyOrResponse) return true
  const content = (bodyOrResponse as { content?: Record<string, unknown> }).content
  if (!content || typeof content !== 'object') return false
  const jsonMedia = content['application/json']
  if (!jsonMedia || typeof jsonMedia !== 'object') return false
  return Boolean((jsonMedia as { schema?: unknown }).schema)
}

function hasSuccessResponseJsonSchema(responses: Record<string, unknown> | undefined): boolean {
  if (!responses) return false
  const statusCodes = Object.keys(responses)
    .filter(code => /^2\d{2}$/.test(code))
    .sort()
  const key = statusCodes[0] ?? 'default'
  return hasJsonMediaSchema(responses[key] as OasResponse | undefined)
}

function hasErrorResponseJsonSchema(responses: Record<string, unknown> | undefined): boolean {
  if (!responses) return false
  return Object.entries(responses).some(
    ([status, response]) =>
      (/^[45]\d{2}$/.test(status) || status === 'default') && hasJsonMediaSchema(response),
  )
}

function findOwningNodePointer(
  sourcePointer: string,
  knownPointersDescLength: readonly string[],
): string | undefined {
  for (const candidate of knownPointersDescLength) {
    if (sourcePointer === candidate || sourcePointer.startsWith(`${candidate}/`)) {
      return candidate
    }
  }
  return undefined
}

function normalizeInternalTargetPointer(pointerOrRef: string | undefined): string | undefined {
  if (!pointerOrRef) return undefined
  const hashIndex = pointerOrRef.indexOf('#/')
  const normalized =
    hashIndex >= 0
      ? pointerOrRef.slice(hashIndex)
      : pointerOrRef.startsWith('/')
        ? `#${pointerOrRef}`
        : undefined
  if (!normalized) return undefined

  const segments = normalized
    .slice(2)
    .split('/')
    .map(unescapeJsonPointerToken)

  if (segments[0] === 'components' && segments.length >= 3) {
    return `#/components/${escapeJsonPointerToken(segments[1]!)}/${escapeJsonPointerToken(segments[2]!)}`
  }
  if (segments[0] === 'paths' && segments.length >= 3) {
    return `#/paths/${escapeJsonPointerToken(segments[1]!)}/${escapeJsonPointerToken(segments[2]!.toLowerCase())}`
  }
  if (segments[0] === 'webhooks' && segments.length >= 3) {
    return `#/webhooks/${escapeJsonPointerToken(segments[1]!)}/${escapeJsonPointerToken(segments[2]!.toLowerCase())}`
  }
  return normalized
}
