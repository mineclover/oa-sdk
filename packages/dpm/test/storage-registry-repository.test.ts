import { describe, expect, it, vi } from 'vitest'

import {
  createDpmRegistryRepository,
  createDpmRegistryRelationshipRow,
  type DpmRegistryRelationshipRow,
  type ApprovedRegistryRelationshipInput,
  type DpmRegistryRelationshipSaveInput,
} from '../src/index.js'
import {
  STORAGE_REGISTRY_DATASET_ID,
  STORAGE_REGISTRY_EXPORTED_AT,
  STORAGE_REGISTRY_VERSION,
} from './support/storage-registry-snapshot-fixtures.js'
import {
  storageRegistryRows,
} from './support/storage-registry-row-fixtures.js'

describe('DPM registry storage repository', () => {
  it('creates a repository that requests rows by dataset and registry version', async () => {
    const listRelationshipRows = vi.fn(async () => storageRegistryRows)
    const repository = createDpmRegistryRepository({ listRelationshipRows })

    const snapshot = await repository.exportSnapshot({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      exportedAt: STORAGE_REGISTRY_EXPORTED_AT,
    })

    expect(listRelationshipRows).toHaveBeenCalledWith({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
    })
    expect(snapshot.summary).toMatchObject({
      total: 2,
      approved: 1,
      nonExecutable: 1,
    })
  })

  it('persists approved relationship payloads as canonical storage rows before export', async () => {
    const rows: DpmRegistryRelationshipRow[] = []
    const upsertRelationshipRow = vi.fn((row: DpmRegistryRelationshipRow) => {
      rows.push(row)
    })
    const repository = createDpmRegistryRepository({
      upsertRelationshipRow,
      listRelationshipRows: request =>
        rows.filter(row =>
          row.datasetId === request.datasetId && row.registryVersion === request.registryVersion,
        ),
    })
    const relationship: ApprovedRegistryRelationshipInput = {
      name: 'rel_orders_customer',
      version: '2',
      status: 'approved',
      type: 'many_to_one',
      parent: {
        table: 'public.customers',
        columns: ['customer_no'],
      },
      child: {
        table: 'public.orders',
        columns: ['customer_no'],
      },
      namespace: 'customer',
      transformStrategy: 'relationship_token',
      orphanPolicy: 'block',
      condition: {
        contextColumns: ['tenant_id'],
        conditionSql: 'orders.tenant_id = customers.tenant_id',
      },
      confidenceScore: 0.98,
      evidence: [
        {
          kind: 'service_code_hint',
          message: 'Profile reviewer mapped orders.customer_no to customers.customer_no.',
          score: 0.98,
          metadata: {
            profileId: 'profile:kafka-orders-created',
            evidenceIds: ['evidence:kafka:orders.created.relationship_hint.customer'],
          },
        },
      ],
      approval: {
        owner: 'privacy-platform',
        approvedBy: 'privacy-reviewer',
        approvedAt: STORAGE_REGISTRY_EXPORTED_AT,
        reason: 'Relationship is required for customer-scoped pseudonymization.',
      },
      source: {
        kind: 'db',
        entity: 'profile_relationship_hint',
        id: 'proposal:orders-customer',
        pointer: '/relationshipHints/orders-customer',
      },
    }

    const saved = await repository.saveRelationship({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      relationship,
      sourceFreshnessHash: 'sha256:profile-analysis-v2',
      createdAt: STORAGE_REGISTRY_EXPORTED_AT,
      updatedAt: STORAGE_REGISTRY_EXPORTED_AT,
    })
    const stored = rows[0]
    const returnedEvidence = saved.evidence[0]
    if (!stored) throw new Error('expected stored relationship row')
    if (!returnedEvidence) throw new Error('expected returned relationship evidence')

    relationship.parent.columns.push('mutated-parent')
    returnedEvidence.message = 'mutated returned row'
    saved.parentColumns.push('mutated-returned-row')

    expect(upsertRelationshipRow).toHaveBeenCalledWith(expect.objectContaining({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      relationshipName: 'rel_orders_customer',
      relationshipVersion: '2',
      status: 'approved',
      relationshipType: 'many_to_one',
      contextColumns: ['tenant_id'],
      conditionSql: 'orders.tenant_id = customers.tenant_id',
      sourceFreshnessHash: 'sha256:profile-analysis-v2',
    }))
    expect(stored).not.toBe(saved)
    expect(stored).toMatchObject({
      parentColumns: ['customer_no'],
      evidence: [
        expect.objectContaining({
          message: 'Profile reviewer mapped orders.customer_no to customers.customer_no.',
          metadata: {
            profileId: 'profile:kafka-orders-created',
            evidenceIds: ['evidence:kafka:orders.created.relationship_hint.customer'],
          },
        }),
      ],
    })

    const snapshot = await repository.exportSnapshot({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      exportedAt: STORAGE_REGISTRY_EXPORTED_AT,
    })

    expect(snapshot.approvedRelationships).toEqual([
      expect.objectContaining({
        name: 'rel_orders_customer',
        version: '2',
        executable: true,
        parent: {
          table: 'public.customers',
          columns: ['customer_no'],
        },
      }),
    ])
  })

  it('rejects non-approved relationship payloads at the save boundary', async () => {
    const repository = createDpmRegistryRepository({
      upsertRelationshipRow: vi.fn(),
      listRelationshipRows: () => [],
    })
    const rejectedRelationship = {
      name: 'rel_orders_status',
      version: '1',
      status: 'rejected',
      type: 'code_lookup',
      parent: {
        table: 'public.order_statuses',
        columns: ['status_code'],
      },
      child: {
        table: 'public.orders',
        columns: ['status'],
      },
      namespace: 'order_status',
      transformStrategy: 'keep_code',
      orphanPolicy: 'warn',
      approval: {
        owner: 'privacy-team',
        reviewedBy: 'dpo@example.com',
        reason: 'Ambiguous operational status candidate.',
      },
    }
    const saveInput = {
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      relationship: rejectedRelationship,
    } as unknown as DpmRegistryRelationshipSaveInput

    await expect(repository.saveRelationship(saveInput))
      .rejects
      .toThrow('DPM registry saveRelationship only accepts approved relationships: rel_orders_status is rejected.')
    expect(() => createDpmRegistryRelationshipRow(saveInput))
      .toThrow('DPM registry saveRelationship only accepts approved relationships: rel_orders_status is rejected.')
  })

  it('rejects another approved version for the same relationship name before adapter mutation', async () => {
    const upsertRelationshipRow = vi.fn()
    const listRelationshipRows = vi.fn(() => storageRegistryRows)
    const repository = createDpmRegistryRepository({
      upsertRelationshipRow,
      listRelationshipRows,
    })
    const relationship: ApprovedRegistryRelationshipInput = {
      name: 'rel_orders_customer',
      version: '2',
      status: 'approved',
      type: 'many_to_one',
      parent: {
        table: 'public.customers',
        columns: ['customer_no'],
      },
      child: {
        table: 'public.orders',
        columns: ['customer_no'],
      },
      namespace: 'customer',
      transformStrategy: 'relationship_token',
      orphanPolicy: 'block',
      approval: {
        owner: 'privacy-team',
        approvedBy: 'dpo@example.com',
        approvedAt: STORAGE_REGISTRY_EXPORTED_AT,
        reason: 'New version should supersede before becoming active.',
      },
    }

    await expect(repository.saveRelationship({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
      relationship,
    }))
      .rejects
      .toThrow(
        'DPM registry saveRelationship already has an approved relationship named rel_orders_customer: existing version 1, attempted version 2.',
      )
    expect(listRelationshipRows).toHaveBeenCalledWith({
      datasetId: STORAGE_REGISTRY_DATASET_ID,
      registryVersion: STORAGE_REGISTRY_VERSION,
    })
    expect(upsertRelationshipRow).not.toHaveBeenCalled()
  })
})
