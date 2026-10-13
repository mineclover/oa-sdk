/**
 * EWIC (Entity/Workflow Interchange Convention) v0.1 TypeScript DTOs.
 * Grounded in `workflow-entity-spec.v0.1.json` and `EWIC-v0.1.md`.
 */

export type EntityKind = 'spec' | 'framework' | 'resource' | 'workflow' | 'execution' | 'evidence'

export type EntityStatus = 'draft' | 'published' | 'deprecated'

export type EntityRelationType =
  | 'contains'
  | 'implements'
  | 'depends_on'
  | 'invokes'
  | 'reads'
  | 'writes'
  | 'produces'
  | 'references'
  | 'supersedes'

export interface EntityIdentity {
  id: string
  kind: EntityKind
  namespace: string
  slug: string
  revision: number
  revisionId: string
  status: EntityStatus
  contentHash: string
}

export interface EntitySSOT {
  provider: 'google_drive' | 'github' | 'local' | 'nes'
  fileId?: string
  path: string
  parentChain?: string[]
  locator?: string
  revision?: number | string
}

export interface EntityProvenance {
  ssot: EntitySSOT
  createdAt: string
  createdBy: string
  parentRevision: number | null
}

export interface EntityReferenceItem {
  uri: string
  relation: EntityRelationType
  resolvedContentHash?: string
  status?: 'asserted' | 'candidate' | 'rejected' | 'superseded'
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 6 Canonical Entity Kind Contents
// ---------------------------------------------------------------------------

export interface SpecContent {
  title: string
  purpose: string
  sections?: Array<{ id: string; title: string; content: string }>
  requirements?: Array<{ id: string; statement: string; level?: 'must' | 'should' | 'may' }>
  invariants?: string[]
  acceptanceCriteria?: string[]
}

export interface FrameworkContent {
  name: string
  version: string
  capabilities: string[]
  constraints?: string[]
  interfaces?: string[]
}

export interface ResourceContent {
  uri: string
  mediaType: string
  locator: string
  summary?: string
  contentDigest: string
  license?: string
  fileId?: string
  parentChain?: string[]
}

export interface WorkflowMachine {
  schema: 'xstate.v5-compatible-subset'
  id: string
  version: string
  initial: string
  type: 'compound' | 'parallel' | 'atomic' | 'final' | 'history'
  contextSchema?: Record<string, unknown>
  contextDefaults?: Record<string, unknown>
  states: Record<string, unknown>
  guards?: Array<{ name: string; params?: Record<string, unknown> }>
  actions?: Array<{ name: string; params?: Record<string, unknown> }>
  invokes?: Array<{ src: string; id?: string }>
  meta?: { visual?: { layout?: string; direction?: string } }
}

export interface WorkflowContent {
  contract?: Record<string, unknown>
  machine: WorkflowMachine
  imports?: string[]
  sideEffectsPolicy?: string
}

export interface ResolvedRefSnapshot {
  snapshotId: string
  contentHash: string
}

export interface ExecutionContent {
  workflowRef: string
  resolvedRefs: Record<string, ResolvedRefSnapshot>
  inputDigest: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  steps?: Array<{ stepId: string; state: string; input?: unknown; output?: unknown; timestamp: string }>
  outputs?: Record<string, unknown>
  evidenceRefs?: string[]
}

export interface EvidenceContent {
  claim: string
  value: unknown
  confidence: number
  method: string
  observedAt: string
  sourceRefs: string[]
  artifactRefs?: string[]
}

// ---------------------------------------------------------------------------
// Source Envelope (entity-source/v1)
// Preserves unknown fields for forward compatibility
// ---------------------------------------------------------------------------

export interface EntitySourceEnvelope<TContent = Record<string, unknown>> {
  $schema: 'entity-source/v1'
  identity: EntityIdentity
  provenance: EntityProvenance
  content: TContent
  refs: EntityReferenceItem[]
  [unknownField: string]: unknown
}

// ---------------------------------------------------------------------------
// Derived Envelope (entity-derived/v1)
// ---------------------------------------------------------------------------

export interface DerivedPipeline {
  runId: string
  name: string
  version: string
  pass: 'normalize' | 'validate' | 'extract' | 'reconcile' | 'embed' | 'graph' | 'viz'
}

export interface DerivedSearch {
  normalizedTextHash: string
  title: string
  tags: string[]
  facets: Record<string, unknown> | string[]
  indexKeys: string[]
}

export interface DerivedGraphEdge {
  source: string
  target: string
  relation: string
  status: 'asserted' | 'candidate' | 'rejected' | 'superseded'
  provenance?: unknown
  confidence?: number
}

export interface DerivedGraph {
  node: Record<string, unknown>
  edges: DerivedGraphEdge[]
}

export interface DerivedEmbedding {
  purpose: 'semantic' | 'search' | 'state' | 'transition'
  model: { provider: string; name: string; version: string }
  dimensions: number
  dtype: 'float32'
  metric: 'cosine'
  encoding: 'external'
  vectorRef: string
  sourceFields: string[]
  sourceRevision: string | number
  contentHash: string
  generatedAt: string
  stale: boolean
}

export interface DerivedViz {
  node: Record<string, unknown>
  layout: Record<string, unknown>
  states: Record<string, unknown>
  edgeLabels: boolean
}

export interface EntityDerivedEnvelope {
  $schema: 'entity-derived/v1'
  entityRef: string
  sourceContentHash: string
  pipeline: DerivedPipeline
  search: DerivedSearch
  graph: DerivedGraph
  embeddings: DerivedEmbedding[]
  viz: DerivedViz
  [unknownField: string]: unknown
}

// ---------------------------------------------------------------------------
// Colab Run Packet (colab-run-packet/v1)
// ---------------------------------------------------------------------------

export interface ColabRunPacket {
  $schema?: 'colab-run-packet/v1'
  runId: string
  pipelineName: string
  pipelineVersion: string
  stage: string
  inputs: {
    entityRef: string
    sourceRevision: number
    contentHash: string
    snapshotId?: string
  }
  outputs?: Record<string, unknown>
  checkpoints?: Array<{ stage: string; timestamp: string; status: 'ok' | 'warning' | 'error'; hash?: string }>
  stagedArtifacts?: Array<{ name: string; path: string; digest: string }>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stale'
  [unknownField: string]: unknown
}

// ---------------------------------------------------------------------------
// Typed Operation / Validation Results
// ---------------------------------------------------------------------------

export interface EwicValidationResult {
  valid: boolean
  errors?: Array<{ path: string; message: string }>
}

export type EwicResolveResult =
  | {
      status: 'resolved'
      envelope: EntitySourceEnvelope
    }
  | {
      status: 'stale'
      reason: string
      expectedHash?: string
      actualHash?: string
    }
  | { status: 'unavailable' }

export type ExecutionSnapshotVerificationResult =
  | {
      status: 'reproducible'
      workflowRef: string
      resolvedCount: number
    }
  | {
      status: 'stale'
      reason: string
      driftedRefs: Array<{
        refUri: string
        expectedHash: string
        actualHash: string
      }>
    }
  | { status: 'unavailable' }
