export const LOGICAL_ERD_ARTIFACT_KIND = 'oa-sdk.logical-erd.v1' as const
export const LOGICAL_ERD_DIFF_KIND = 'oa-sdk.logical-erd-diff.v1' as const
export const LOGICAL_ERD_REVIEW_KIND = 'oa-sdk.logical-erd-review.v1' as const

export type LogicalErdCardinality =
  | 'one-to-one'
  | 'one-to-many'
  | 'many-to-one'

export type LogicalErdSourceSpan = {
  file: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

export type LogicalErdProvenance = {
  subject: `dataset:${string}` | `entity:${string}` | `field:${string}` | `relationship:${string}`
  span: LogicalErdSourceSpan
  decoratorSpan?: LogicalErdSourceSpan
}

export type LogicalErdDataset = {
  id: string
  locator: string
}

export type LogicalErdField = {
  id: string
  name: string
  type: string
  required: boolean
  primaryKey: boolean
  /** Present only for an explicitly ordered composite primary-key component. */
  primaryKeyPart?: {
    groupId: string
    order: number
  }
  unique: boolean
  foreignKey?: {
    entityId: string
    fieldId: string
  }
}

export type LogicalErdEntity = {
  id: string
  datasetId: string
  locator: string
  fields: LogicalErdField[]
}

export type LogicalErdEndpoint = {
  entityId: string
  fieldId: string
}

export type LogicalErdRelationship = {
  id: string
  from: LogicalErdEndpoint
  to: LogicalErdEndpoint
  cardinality: LogicalErdCardinality
}

export type LogicalErdArtifactInput = {
  source: {
    package?: string
    files: Array<{ path: string; hash?: string }>
  }
  datasets: LogicalErdDataset[]
  entities: LogicalErdEntity[]
  relationships: LogicalErdRelationship[]
  provenance: LogicalErdProvenance[]
}

export type LogicalErdArtifact = LogicalErdArtifactInput & {
  kind: typeof LOGICAL_ERD_ARTIFACT_KIND
  artifactId: string
}

export type LogicalErdDiagnosticCode =
  | 'ERD001'
  | 'ERD002'
  | 'ERD003'
  | 'ERD004'
  | 'ERD005'

export type LogicalErdDiagnostic = {
  code: LogicalErdDiagnosticCode
  message: string
  subject?: string
}

export type LogicalErdDiffSeverity = 'additive' | 'non-breaking' | 'potentially-breaking' | 'breaking'

export type LogicalErdDiffChange = {
  subject: 'dataset' | 'entity' | 'field' | 'relationship'
  id: string
  kind: 'added' | 'removed' | 'changed' | 'renamed'
  severity: LogicalErdDiffSeverity
  details: string
}

export type LogicalErdDiff = {
  kind: typeof LOGICAL_ERD_DIFF_KIND
  baseArtifactId: string
  nextArtifactId: string
  changes: LogicalErdDiffChange[]
  summary: Record<LogicalErdDiffSeverity, number>
}

export type LogicalErdCatalogEvidenceStatus = 'confirmed' | 'mismatch' | 'unbound' | 'unknown'

/** Structural, read-only input compatible with the canonical DPM bridge evidence. */
export type LogicalErdCatalogEvidence = {
  artifactId: string
  fields: readonly {
    logicalFieldId: string
    status: LogicalErdCatalogEvidenceStatus
    reason: string
  }[]
}

export type LogicalErdReviewSubject = {
  subject: LogicalErdProvenance['subject']
  provenance: LogicalErdProvenance[]
  catalogEvidence?: {
    status: LogicalErdCatalogEvidenceStatus
    reason: string
  }
}

export type LogicalErdReview = {
  kind: typeof LOGICAL_ERD_REVIEW_KIND
  purpose: 'review-evidence-only'
  artifactId: string
  subjects: LogicalErdReviewSubject[]
  summary: {
    subjects: number
    provenanceCovered: number
    provenanceCoverageRatio: number
    catalogEvidence: Record<LogicalErdCatalogEvidenceStatus, number>
  }
  diff?: LogicalErdDiff
}
