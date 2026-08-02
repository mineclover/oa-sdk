import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createLogicalErdArtifact, validateLogicalErdArtifact } from './artifact.js'
import { diffLogicalErdArtifacts } from './diff.js'
import { createLogicalErdReview } from './review.js'
import { validateLogicalErdArtifactSchema, validateLogicalErdReviewSchema } from './schema.js'

function artifact(fieldName = 'customerId', required = true) {
  return createLogicalErdArtifact({
    source: { files: [{ path: 'commerce.tsp', hash: 'fixture' }] },
    datasets: [{ id: 'commerce', locator: 'Commerce' }],
    entities: [
      { id: 'commerce.customer', datasetId: 'commerce', locator: 'Commerce.Customer', fields: [{ id: 'commerce.customer.id', name: 'id', type: 'string', required: true, primaryKey: true, unique: true }] },
      { id: 'commerce.order', datasetId: 'commerce', locator: 'Commerce.Order', fields: [{ id: 'commerce.order.customer-id', name: fieldName, type: 'string', required, primaryKey: false, unique: false, foreignKey: { entityId: 'commerce.customer', fieldId: 'commerce.customer.id' } }] },
    ],
    relationships: [{ id: 'commerce.order-customer', from: { entityId: 'commerce.order', fieldId: 'commerce.order.customer-id' }, to: { entityId: 'commerce.customer', fieldId: 'commerce.customer.id' }, cardinality: 'many-to-one' }],
    provenance: [],
  })
}

describe('logical ERD contract', () => {
  it('keeps the CRDT control-plane compatibility fixture schema- and semantically-valid', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('../fixtures/crdt-base-control-plane.logical-erd.v1.json', import.meta.url),
      'utf8',
    ))
    expect(validateLogicalErdArtifactSchema(fixture)).toEqual([])
    expect(validateLogicalErdArtifact(fixture)).toEqual([])
  })

  it('normalizes equivalent input to the same immutable artifact identity', () => {
    expect(artifact().artifactId).toBe(artifact().artifactId)
  })

  it('accepts the emitted v1 wire shape and rejects an artifact without provenance', () => {
    const valid = artifact()
    expect(validateLogicalErdArtifactSchema(valid)).toEqual([])

    const { provenance: _provenance, ...withoutProvenance } = valid
    expect(validateLogicalErdArtifactSchema(withoutProvenance)).toContainEqual(expect.objectContaining({
      instancePath: '',
      keyword: 'required',
    }))
  })

  it('rejects an artifact id whose hash does not match the logical content', () => {
    const valid = artifact()
    expect(validateLogicalErdArtifact({ ...valid, artifactId: `${valid.artifactId}0` })).toContainEqual(expect.objectContaining({
      code: 'ERD002',
      message: expect.stringContaining('does not match'),
    }))
  })

  it('reports a locator-only field rename as non-breaking', () => {
    const report = diffLogicalErdArtifacts(artifact('customerId'), artifact('buyerId'))
    expect(report.changes).toContainEqual(expect.objectContaining({
      subject: 'field',
      id: 'commerce.order.customer-id',
      kind: 'renamed',
      severity: 'non-breaking',
    }))
  })

  it('preserves ordered composite primary-key components and treats an order change as semantic', () => {
    const base = artifact()
    const composite = createLogicalErdArtifact({
      source: base.source,
      datasets: base.datasets,
      entities: base.entities.map(entity => entity.id !== 'commerce.order'
        ? entity
        : {
            ...entity,
            fields: [
              { id: 'commerce.order.id', name: 'id', type: 'string', required: true, primaryKey: true, primaryKeyPart: { groupId: 'commerce.order.primary', order: 1 }, unique: false },
              { ...entity.fields[0]!, primaryKey: true, primaryKeyPart: { groupId: 'commerce.order.primary', order: 2 } },
            ],
          }),
      relationships: base.relationships,
      provenance: base.provenance,
    })
    const reordered = createLogicalErdArtifact({
      ...composite,
      entities: composite.entities.map(entity => entity.id !== 'commerce.order'
        ? entity
        : {
            ...entity,
            fields: entity.fields.map(field => field.id === 'commerce.order.id'
              ? { ...field, primaryKeyPart: { groupId: 'commerce.order.primary', order: 2 } }
              : { ...field, primaryKeyPart: { groupId: 'commerce.order.primary', order: 1 } }),
          }),
    })

    expect(composite.entities.find(entity => entity.id === 'commerce.order')?.fields.map(field => field.primaryKeyPart?.order)).toEqual([2, 1])
    expect(diffLogicalErdArtifacts(composite, reordered).changes).toContainEqual(expect.objectContaining({
      subject: 'field',
      id: 'commerce.order.id',
      severity: 'potentially-breaking',
    }))
  })

  it('reports required field removal as breaking', () => {
    const base = artifact()
    const next = createLogicalErdArtifact({
      source: base.source,
      datasets: base.datasets,
      entities: base.entities.map(entity => entity.id === 'commerce.order' ? { ...entity, fields: [] } : entity),
      relationships: [],
      provenance: [],
    })
    const report = diffLogicalErdArtifacts(base, next)
    expect(report.summary.breaking).toBe(2)
  })

  it('builds deterministic review evidence from provenance, logical diff, and read-only catalog status', () => {
    const base = artifact()
    const next = createLogicalErdArtifact({
      source: base.source,
      datasets: base.datasets,
      entities: base.entities,
      relationships: base.relationships,
      provenance: [{
        subject: 'field:commerce.order.customer-id',
        span: { file: 'commerce.tsp', line: 20, column: 3, endLine: 21, endColumn: 24 },
        decoratorSpan: { file: 'commerce.tsp', line: 20, column: 3, endLine: 20, endColumn: 49 },
      }],
    })
    const review = createLogicalErdReview({
      artifact: next,
      base,
      catalogEvidence: {
        artifactId: next.artifactId,
        fields: [{ logicalFieldId: 'commerce.order.customer-id', status: 'confirmed', reason: 'Owner catalog fixture confirms the field.' }],
      },
    })

    expect(review).toMatchObject({
      kind: 'oa-sdk.logical-erd-review.v1',
      purpose: 'review-evidence-only',
      summary: {
        subjects: 6,
        provenanceCovered: 1,
        catalogEvidence: { confirmed: 1, mismatch: 0, unbound: 0, unknown: 0 },
      },
    })
    expect(review.subjects).toContainEqual(expect.objectContaining({
      subject: 'field:commerce.order.customer-id',
      catalogEvidence: { status: 'confirmed', reason: 'Owner catalog fixture confirms the field.' },
    }))
    expect(validateLogicalErdReviewSchema(review)).toEqual([])

    const { purpose: _purpose, ...withoutPurpose } = review
    expect(validateLogicalErdReviewSchema(withoutPurpose)).toContainEqual(expect.objectContaining({
      instancePath: '',
      keyword: 'required',
    }))
  })
})
