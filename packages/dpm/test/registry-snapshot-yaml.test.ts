import { describe, expect, it } from 'vitest'

import {
  createRegistrySnapshot,
  parseRegistrySnapshotYaml,
  REGISTRY_SNAPSHOT_KIND,
  selectApprovedRelationships,
  type RegistryRelationship,
  type RegistryRelationshipInput,
  type RegistrySnapshot,
} from '../src/index.js'
import {
  readCommerceRegistrySnapshot,
} from './support/registry-yaml-fixtures.js'
import {
  expectedCommerceRegistryIdentity,
  expectedCommerceRegistryRelationshipIdentities,
  expectedCommerceRegistrySummaryByStatus,
} from './support/registry-projection-fixtures.js'

describe('DPM relationship registry snapshot YAML', () => {
  it('loads YAML review artifacts into a versioned registry snapshot', () => {
    const snapshot = readCommerceRegistrySnapshot()

    expect(snapshot.kind).toBe(REGISTRY_SNAPSHOT_KIND)
    expect(snapshot.identity).toBe(expectedCommerceRegistryIdentity)
    expect(snapshot.relationships.map(relationship => relationship.identity)).toEqual([
      ...expectedCommerceRegistryRelationshipIdentities,
    ])
    expect(snapshot.summary.byStatus).toMatchObject(expectedCommerceRegistrySummaryByStatus)
  })

  it('rejects approved YAML relationships without complete approval metadata', () => {
    expect(() => parseRegistrySnapshotYaml(incompleteApprovedRegistryYaml))
      .toThrow(
        'DPM registry snapshot approved relationship rel_orders_customer is missing approval.approvedBy, approval.reason.',
      )
  })

  it('rejects direct approved registry snapshot input without complete approval metadata', () => {
    expect(() => createRegistrySnapshot({
      datasetId: 'commerce_ai',
      registryVersion: 'reg-2026-07-01',
      relationships: [createIncompleteApprovedRelationshipInput()],
    }))
      .toThrow(
        'DPM registry snapshot approved relationship rel_orders_customer is missing approval.approvedBy, approval.reason.',
      )
  })

  it('rejects manually constructed executable snapshots without complete approval metadata', () => {
    expect(() => selectApprovedRelationships(createManualIncompleteApprovedSnapshot()))
      .toThrow(
        'DPM registry selectApprovedRelationships approved relationship rel_orders_customer '
        + 'is missing approval.approvedBy, approval.reason.',
      )
  })
})

const incompleteApprovedRegistryYaml = `
dataset_id: commerce_ai
registry_version: reg-2026-07-01
relationships:
  - name: rel_orders_customer
    version: "1"
    status: approved
    type: one_to_many
    parent:
      table: public.customers
      columns: [customer_no]
    child:
      table: public.orders
      columns: [customer_no]
    namespace: customer
    transform_strategy: entity_token
    orphan_policy: block
    evidence: []
    approval:
      owner: privacy-platform
`

function createIncompleteApprovedRelationshipInput(): RegistryRelationshipInput {
  return {
    name: 'rel_orders_customer',
    version: '1',
    status: 'approved',
    type: 'one_to_many',
    parent: {
      table: 'public.customers',
      columns: ['customer_no'],
    },
    child: {
      table: 'public.orders',
      columns: ['customer_no'],
    },
    namespace: 'customer',
    transformStrategy: 'entity_token',
    orphanPolicy: 'block',
    evidence: [],
    approval: {
      owner: 'privacy-platform',
    },
  }
}

function createManualIncompleteApprovedSnapshot(): RegistrySnapshot {
  const relationship: RegistryRelationship = {
    ...createIncompleteApprovedRelationshipInput(),
    identity: 'commerce_ai/rel_orders_customer@1',
    executable: true,
    evidence: [],
    condition: {
      contextColumns: [],
    },
  }

  return {
    kind: REGISTRY_SNAPSHOT_KIND,
    identity: 'commerce_ai@reg-2026-07-01',
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationships: [relationship],
    approvedRelationships: [],
    nonExecutableRelationships: [],
    summary: {
      total: 1,
      approved: 1,
      nonExecutable: 0,
      byStatus: {
        approved: 1,
        proposed: 0,
        rejected: 0,
        deprecated: 0,
        superseded: 0,
      },
    },
  }
}
