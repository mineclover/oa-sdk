/**
 * Data Persona v0.1 — type definitions matching registry.yaml schema.
 *
 * 3 buckets × dimensions:
 *   - identity   (actor, data, intent, trigger, skill?)
 *   - reference  (regulation[], channel[])
 *   - outcome    (shape?, access[], maps_to[])
 */

export type PersonaStatus = 'implemented' | 'proposed' | 'deprecated'

export type DimensionCardinality = 'single' | 'multi'

export interface DimensionSpec {
  required: boolean
  cardinality: DimensionCardinality
  vocabulary: string | null
  description: string
}

export interface BucketSpec {
  description: string
  dimensions: Record<string, DimensionSpec>
}

export interface RegistryConstraint {
  id: string
  description?: string
  when: Record<string, unknown>
  require?: Record<string, unknown>
  forbid?: boolean
  severity: 'error' | 'warn'
}

export interface Registry {
  version: string
  buckets: {
    identity: BucketSpec
    reference: BucketSpec
    outcome: BucketSpec
  }
  /**
   * v0.11: bucket 외 top-level vocabularies (e.g., `skill` for Persona.skills).
   * key = vocabulary 이름, value = trait yaml 상대경로.
   */
  top_level_vocabularies?: Record<string, string>
  statuses: Array<{ id: PersonaStatus; description: string }>
  constraints: RegistryConstraint[]
}

export interface TraitValue {
  id: string
  description?: string
  status?: 'stable' | 'proposed' | 'deprecated'
  /** Optional category id — trait files like trigger.yaml use this for cross-section grouping. */
  category?: string
  [key: string]: unknown
}

export interface TraitCategory {
  id: string
  description?: string
}

export interface TraitVocabulary {
  values: TraitValue[]
  /** Optional taxonomy — trait files may group their values into named categories. */
  categories?: TraitCategory[]
}

export interface PersonaIdentity {
  actor: string
  data: string
  intent: string
  trigger: string
  /** 사용자 숙련도 — onboarding/novice/intermediate/expert. (v0.11: 이전 `skill` field에서 rename) */
  proficiency?: string
  /** API consumer perspective (e.g. backend / b2b-customer / internal-tool / infra-ops). Defaults conceptually to 'end-user' when omitted. */
  consumer?: string
}

export interface PersonaReference {
  regulation?: string[]
  channel?: string[]
  /** 데이터 residency / 법적 관할 (KR / EU / US / APAC / GLOBAL …). 미설정 = unconstrained. */
  region?: string[]
  /** 조직 단위 인증 (SOC2 / ISO27001 / HIPAA 등). regulation(법)과 직교. */
  compliance_framework?: string[]
}

export interface PersonaOutcome {
  shape?: string
  access?: string[]
  maps_to?: string[]
  /** HTTP status codes this persona expects to receive. Each must be declared in the operation's `responses`. */
  expects?: number[]
}

/** 정의 간 관계 — qa-sdk/definition-catalog LinkType 어휘 중 페르소나 컨텍스트 4종 (현재 3종 활성). */
export type PersonaLinkType = 'depends_on' | 'refines' | 'supersedes'

export interface PersonaLink {
  linkType: PersonaLinkType
  /** target persona id — 같은 매트릭스 또는 다른 도메인의 페르소나여도 됨 */
  target: string
  /** 사람이 읽을 1줄 — 왜 이 관계가 있는지 */
  reason?: string
}

export interface Persona {
  id: string
  status: PersonaStatus
  identity: PersonaIdentity
  reference?: PersonaReference
  outcome?: PersonaOutcome
  /**
   * 페르소나가 고유하게 보유한 capability tags (v0.11).
   * RPG 캐릭터의 skills처럼 — pagination, audit-emission, oauth-scope-aware, etc.
   * `traits/skill.yaml` vocabulary와 검증.
   */
  skills?: string[]
  /** 다른 페르소나와의 관계 — 시퀀스 그래프 / 변종 추적 / lifecycle */
  links?: PersonaLink[]
  notes?: string
}

export interface AcknowledgedOrphan {
  operationId: string
  /** HTTP status code as string ("500", "default", "5XX"). */
  statusCode: string
  /** Why this orphan is intentional — surfaces in reports, no persona ever needed. */
  reason: string
}

/**
 * v0.11.5 — persona profile (saved query bundle).
 * profiles/{name}.profile.yaml 에 저장. selector + 명시 + extends + exclude로 페르소나
 * id 집합을 동적 또는 정적으로 정의.
 */
export interface ProfileSelector {
  /** 페르소나 status 필터 (default: all). */
  status?: PersonaStatus[]
  /** 도메인 이름 필터. */
  domain?: string[]
  /** identity 차원 필터. */
  actor?: string[]
  intent?: string[]
  trigger?: string[]
  consumer?: string[]
  proficiency?: string[]
  /** reference 차원 필터. */
  regulation?: string[]
  channel?: string[]
  region?: string[]
  compliance_framework?: string[]
  /** outcome 차원 필터. */
  shape?: string[]
  access?: string[]
  /** v0.11 capability 필터 — 명시한 skills를 모두 보유해야 함 (AND). */
  skills?: string[]
}

export interface PersonaProfile {
  id: string
  description?: string
  /** 동적 매칭 조건 — 모든 필드 AND, 단일 필드 내 array는 OR. */
  selector?: ProfileSelector
  /** 명시적 페르소나 id 추가 (selector 결과에 union). */
  personas?: string[]
  /** 다른 profile 흡수 — 재귀 expand. */
  extends?: string[]
  /** 결과에서 제외할 페르소나 id. */
  exclude?: string[]
}

/**
 * Data-modeling persona — describes invariants and access patterns OF the
 * data entity (not the API consumer). Lives in `data-models/{Entity}.persona.yaml`.
 *
 * This complements API-consumer personas (in `domains/`) by capturing the
 * data-side perspective: PII flags, retention rules, audit requirements.
 *
 * Free-form: each file's shape is documented in the file itself. The loader
 * does not enforce schema beyond `entity` + `description`.
 */
export interface DataModelPersona {
  entity: string
  schema_ref?: string
  description?: string
  local_variants?: Array<{ id: string; description?: string }>
  invariants?: Record<string, unknown>
  access_patterns?: Array<Record<string, unknown>>
  regulations?: string[]
  /** Allow extension fields without breaking strict types. */
  [key: string]: unknown
}

/**
 * v0.13 — surface kind. 도메인이 어떤 종류의 surface를 다루는지 선언.
 * kind에 따라 검증 룰 분기:
 *   openapi-http   — maps_to/expects/drift 강제 (기본)
 *   cli-tool       — synthetic operationId 허용 (cli:<command>), exit code 사용
 *   library-api    — 함수/모듈 — operationId 무관, drift 비검증
 *   event-stream   — pub/sub event — channel/payload 위주
 */
export type SurfaceKind = 'openapi-http' | 'cli-tool' | 'library-api' | 'event-stream'

/**
 * v0.12 — Domain ownership boundary.
 * 각 도메인이 자기 entity / actor 책임 명시. 룰 #20-21로 강제.
 */
export interface DomainMetadata {
  /** v0.13: surface kind. 미설정 = 'openapi-http' (backward-compat). */
  kind?: SurfaceKind
  /** 이 도메인이 소유한 entity 이름 목록 (base form). 변종(`User(self)` 등)은 자동 매칭. */
  owns_entities?: string[]
  /** 이 도메인에서 등장 가능한 actor 목록. 외 actor 사용 시 룰 #21 위반. */
  allowed_actors?: string[]
  /** 도메인 한 줄 책임 (소유한 행위 영역). */
  responsibility?: string
}

export interface DomainMatrix {
  domain: string
  description?: string
  /** v0.12: domain ownership boundary */
  metadata?: DomainMetadata
  personas: Persona[]
  /**
   * Orphan response codes intentionally not modeled as personas (e.g., 500
   * infrastructure errors with no actor story). `propose` skips these;
   * coverage reports them in a dedicated section instead of as orphans.
   */
  acknowledged_orphans?: AcknowledgedOrphan[]
}

export interface ValidationIssue {
  severity: 'error' | 'warn'
  domain: string
  personaId?: string
  bucket?: 'identity' | 'reference' | 'outcome'
  dimension?: string
  message: string
}

export interface ValidationReport {
  ok: boolean
  domains: string[]
  personaCount: number
  implementedCount: number
  proposedCount: number
  issues: ValidationIssue[]
}
