/**
 * @oa-sdk/parser IR 타입 정의
 *
 * OAS 3.2 spec을 파싱한 구조화된 중간 표현(IR).
 * 모든 소비자(mock-server, codegen, router, client)가 이 IR을 입력으로 받습니다.
 */

import type {
  OasDocument as RawOasDocument,
  OasInfo,
  OasServer,
  OasTag,
  OasSchema,
  OasParameter,
  OasRequestBody,
  OasResponse,
  OasSecurityScheme,
  OasSecurityRequirement,
  OasExternalDocs,
  OasCallback,
  OasLink,
  OasPathItem,
  OasExample,
  OasHeader,
  OasMediaType,
} from './oas32-types.js'

// 원본 OAS 3.2 타입 전체 re-export
export type * from './oas32-types.js'

// ─── HTTP 메서드 ───────────────────────────────────────────────────────────

export type HttpMethod =
  | 'get' | 'post' | 'put' | 'patch' | 'delete'
  | 'head' | 'options' | 'trace' | 'query'

// ─── Operation IR ──────────────────────────────────────────────────────────

/** 파싱 + $ref 해결된 개별 오퍼레이션 */
export type OperationEntry = {
  operationId?: string
  /** OpenAPI 원본 경로 (e.g. "/users/{id}") */
  openApiPath: string
  method: HttpMethod
  tags: string[]
  summary?: string
  description?: string
  deprecated: boolean
  parameters: OasParameter[]
  requestBody?: OasRequestBody
  responses: Record<string, OasResponse>
  security: OasSecurityRequirement[]
  servers: OasServer[]
  callbacks: Record<string, OasCallback>
  externalDocs?: OasExternalDocs
}

// ─── Route Index ───────────────────────────────────────────────────────────

/** openApiPath → method → OperationEntry */
export type RouteIndex = Map<string, Map<HttpMethod, OperationEntry>>

export type MatchResult =
  | { type: 'found'; entry: OperationEntry; pathParams: Record<string, string> }
  | { type: 'method_not_allowed'; allowed: HttpMethod[] }
  | { type: 'not_found' }

// ─── Parsed Document IR ────────────────────────────────────────────────────

/**
 * 파싱된 OAS 3.2 문서의 구조화된 표현.
 *
 * 원본 OasDocument와 다른 점:
 * - $ref가 해결됨
 * - operations가 평탄화된 배열
 * - routes가 RouteIndex로 인덱싱됨
 * - schemas가 components에서 추출됨
 * - security schemes가 이름별로 인덱싱됨
 * - tags가 이름별로 인덱싱됨
 */
export type ParsedDocument = {
  /** 원본 openapi 버전 문자열 */
  openapi: string
  info: OasInfo
  servers: OasServer[]
  tags: Map<string, OasTag>
  /** 평탄화된 오퍼레이션 목록 (webhooks 포함) */
  operations: OperationEntry[]
  /** 경로 기반 라우팅 인덱스 */
  routes: RouteIndex
  /** components/schemas ($ref 해결됨) */
  schemas: Record<string, OasSchema>
  /** 보안 스킴 이름 → 정의 */
  securitySchemes: Record<string, OasSecurityScheme>
  /** 전역 보안 요구사항 */
  security: OasSecurityRequirement[]
  /** components 전체 (schemas, responses, parameters, examples 등) */
  components: {
    responses: Record<string, OasResponse>
    parameters: Record<string, OasParameter>
    requestBodies: Record<string, OasRequestBody>
    examples: Record<string, OasExample>
    headers: Record<string, OasHeader>
    links: Record<string, OasLink>
    callbacks: Record<string, OasCallback>
    pathItems: Record<string, OasPathItem>
    mediaTypes: Record<string, OasMediaType>
  }
  /** 웹훅 오퍼레이션 */
  webhooks: OperationEntry[]
  /** 원본 문서 참조 (필요 시 raw 접근) */
  raw: RawOasDocument
}
