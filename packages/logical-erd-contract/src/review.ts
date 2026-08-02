import { diffLogicalErdArtifacts } from './diff.js'
import { validateLogicalErdArtifact } from './artifact.js'
import {
  LOGICAL_ERD_REVIEW_KIND,
  type LogicalErdArtifact,
  type LogicalErdCatalogEvidence,
  type LogicalErdCatalogEvidenceStatus,
  type LogicalErdReview,
  type LogicalErdReviewSubject,
} from './types.js'

/** Build a deterministic review-only envelope. It never becomes a model authority or write input. */
export function createLogicalErdReview(input: {
  artifact: LogicalErdArtifact
  base?: LogicalErdArtifact
  catalogEvidence?: LogicalErdCatalogEvidence
}): LogicalErdReview {
  assertValidArtifact(input.artifact)
  if (input.base) assertValidArtifact(input.base)
  const evidence = normalizeCatalogEvidence(input.artifact, input.catalogEvidence)
  const evidenceByFieldId = new Map(evidence.map(entry => [entry.logicalFieldId, { status: entry.status, reason: entry.reason }]))
  const provenanceBySubject = new Map<string, LogicalErdReviewSubject['provenance']>()
  for (const entry of input.artifact.provenance) {
    provenanceBySubject.set(entry.subject, [...(provenanceBySubject.get(entry.subject) ?? []), copyProvenance(entry)])
  }

  const subjects = collectSubjects(input.artifact)
    .map(subject => ({
      subject,
      provenance: provenanceBySubject.get(subject) ?? [],
      ...(subject.startsWith('field:') && evidenceByFieldId.has(subject.slice('field:'.length))
        ? { catalogEvidence: evidenceByFieldId.get(subject.slice('field:'.length))! }
        : {}),
    }))
    .sort((left, right) => left.subject.localeCompare(right.subject))
  const summary = {
    subjects: subjects.length,
    provenanceCovered: subjects.filter(subject => subject.provenance.length > 0).length,
    provenanceCoverageRatio: subjects.length === 0 ? 1 : subjects.filter(subject => subject.provenance.length > 0).length / subjects.length,
    catalogEvidence: summarizeCatalogEvidence(evidence),
  }
  return {
    kind: LOGICAL_ERD_REVIEW_KIND,
    purpose: 'review-evidence-only',
    artifactId: input.artifact.artifactId,
    subjects,
    summary,
    ...(input.base ? { diff: diffLogicalErdArtifacts(input.base, input.artifact) } : {}),
  }
}

function assertValidArtifact(artifact: LogicalErdArtifact): void {
  const diagnostics = validateLogicalErdArtifact(artifact)
  if (diagnostics.length > 0) throw new Error(`Cannot build ERD review from an invalid artifact: ${diagnostics.map(item => `${item.code}: ${item.message}`).join('; ')}`)
}

function normalizeCatalogEvidence(
  artifact: LogicalErdArtifact,
  evidence: LogicalErdCatalogEvidence | undefined,
): Array<{ logicalFieldId: string; status: LogicalErdCatalogEvidenceStatus; reason: string }> {
  if (!evidence) return []
  if (evidence.artifactId !== artifact.artifactId) {
    throw new Error(`Catalog evidence artifact ${evidence.artifactId} does not match ${artifact.artifactId}.`)
  }
  const fieldIds = new Set(artifact.entities.flatMap(entity => entity.fields.map(field => field.id)))
  const seen = new Set<string>()
  return evidence.fields.map(entry => {
    if (!fieldIds.has(entry.logicalFieldId)) throw new Error(`Catalog evidence references unknown logical ERD field ${entry.logicalFieldId}.`)
    if (seen.has(entry.logicalFieldId)) throw new Error(`Catalog evidence has duplicate logical ERD field ${entry.logicalFieldId}.`)
    if (!isCatalogEvidenceStatus(entry.status)) throw new Error(`Unsupported catalog evidence status ${entry.status}.`)
    if (!entry.reason) throw new Error(`Catalog evidence reason is required for ${entry.logicalFieldId}.`)
    seen.add(entry.logicalFieldId)
    return { logicalFieldId: entry.logicalFieldId, status: entry.status, reason: entry.reason }
  }).sort((left, right) => left.logicalFieldId.localeCompare(right.logicalFieldId))
}

function collectSubjects(artifact: LogicalErdArtifact): LogicalErdReviewSubject['subject'][] {
  return [
    ...artifact.datasets.map(dataset => `dataset:${dataset.id}` as const),
    ...artifact.entities.map(entity => `entity:${entity.id}` as const),
    ...artifact.entities.flatMap(entity => entity.fields.map(field => `field:${field.id}` as const)),
    ...artifact.relationships.map(relationship => `relationship:${relationship.id}` as const),
  ]
}

function summarizeCatalogEvidence(evidence: readonly { status: LogicalErdCatalogEvidenceStatus }[]): Record<LogicalErdCatalogEvidenceStatus, number> {
  const summary: Record<LogicalErdCatalogEvidenceStatus, number> = {
    confirmed: 0,
    mismatch: 0,
    unbound: 0,
    unknown: 0,
  }
  for (const entry of evidence) summary[entry.status] += 1
  return summary
}

function isCatalogEvidenceStatus(value: string): value is LogicalErdCatalogEvidenceStatus {
  return value === 'confirmed' || value === 'mismatch' || value === 'unbound' || value === 'unknown'
}

function copyProvenance(entry: LogicalErdReviewSubject['provenance'][number]): LogicalErdReviewSubject['provenance'][number] {
  return {
    subject: entry.subject,
    span: { ...entry.span },
    ...(entry.decoratorSpan === undefined ? {} : { decoratorSpan: { ...entry.decoratorSpan } }),
  }
}
