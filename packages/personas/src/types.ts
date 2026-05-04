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
  skill?: string
  /** API consumer perspective (e.g. backend / b2b-customer / internal-tool / infra-ops). Defaults conceptually to 'end-user' when omitted. */
  consumer?: string
}

export interface PersonaReference {
  regulation?: string[]
  channel?: string[]
}

export interface PersonaOutcome {
  shape?: string
  access?: string[]
  maps_to?: string[]
  /** HTTP status codes this persona expects to receive. Each must be declared in the operation's `responses`. */
  expects?: number[]
}

export interface Persona {
  id: string
  status: PersonaStatus
  identity: PersonaIdentity
  reference?: PersonaReference
  outcome?: PersonaOutcome
  notes?: string
}

export interface AcknowledgedOrphan {
  operationId: string
  /** HTTP status code as string ("500", "default", "5XX"). */
  statusCode: string
  /** Why this orphan is intentional — surfaces in reports, no persona ever needed. */
  reason: string
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
