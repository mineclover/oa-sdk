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

export interface DomainMatrix {
  domain: string
  description?: string
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
