import { describe, expect, it, vi } from 'vitest'

import {
  createDpmGatewayRuntime,
  createDpmProfileAnalysisReport,
  createDpmRegistryRepository,
  type DpmRegistryRelationshipRow,
} from '../src/index.js'
import {
  createKafkaProfileArtifact,
} from './support/profile-analysis-fixtures.js'

describe('DPM gateway profile relationship hint approval workflow', () => {
  it('turns a resolved profile relationship hint into a saved approved registry snapshot', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const analysisReport = createDpmProfileAnalysisReport({ profileArtifact })
    const relationshipHint = analysisReport.relationshipHints.find(candidate =>
      candidate.id === 'proposal:edge:relationship-hint:hint:orders-created-customer'
    )
    if (!relationshipHint) throw new Error('expected explicit Kafka relationship hint')
    const registryRows: DpmRegistryRelationshipRow[] = []
    const upsertRelationshipRow = vi.fn((row: DpmRegistryRelationshipRow) => {
      registryRows.push(row)
    })
    const listRelationshipRows = vi.fn(request =>
      registryRows.filter(row =>
        row.datasetId === request.datasetId && row.registryVersion === request.registryVersion,
      ),
    )
    const registryRepository = createDpmRegistryRepository({
      upsertRelationshipRow,
      listRelationshipRows,
    })

    const response = await runtime.approveDpmProfileRelationshipHint({
      profileArtifact,
      relationshipHint,
      relationshipName: 'rel_orders_customer',
      childTableByPathPrefix: {
        'orders.created': 'public.orders',
      },
      registryVersion: 'registry-profile-workflow-v1',
      version: '1',
      namespace: 'customer',
      transformStrategy: 'relationship_token',
      orphanPolicy: 'block',
      owner: 'privacy-platform',
      approvedBy: 'dpm-reviewer@example.com',
      reason: 'Kafka profile hint was mapped to a customer relationship for pseudonymized analytics.',
      approvedAt: '2026-07-07T00:10:00.000Z',
      generatedAt: '2026-07-07T00:09:00.000Z',
      exportedAt: '2026-07-07T00:11:00.000Z',
      createdAt: '2026-07-07T00:10:00.000Z',
      updatedAt: '2026-07-07T00:10:00.000Z',
      sourceFreshnessHash: analysisReport.freshness.reportHash,
      registryRepository,
    })

    expect(response.operationId).toBe('approveDpmProfileRelationshipHint')
    expect(response.statusCode).toBe(200)
    expect(response.body.command).toBe('approve-profile-relationship-hint')
    expect(response.body.result).toMatchObject({
      relationshipName: 'rel_orders_customer',
      status: 'approved',
      candidateInput: {
        relationshipName: 'rel_orders_customer',
        parent: {
          table: 'public.customers',
          columns: ['customer_no'],
        },
        child: {
          table: 'public.orders',
          columns: ['customer_no'],
        },
      },
      reviewCandidate: {
        recommendation: 'review',
        executable: false,
      },
      candidateImport: {
        imported: 1,
        rejected: 0,
      },
      relationship: {
        name: 'rel_orders_customer',
        status: 'approved',
        namespace: 'customer',
      },
      savedRelationship: {
        datasetId: profileArtifact.datasetId,
        registryVersion: 'registry-profile-workflow-v1',
        relationshipName: 'rel_orders_customer',
        status: 'approved',
        sourceFreshnessHash: analysisReport.freshness.reportHash,
      },
    })
    expect(response.body.result.registrySnapshot.approvedRelationships).toEqual([
      expect.objectContaining({
        name: 'rel_orders_customer',
        executable: true,
      }),
    ])
    expect(upsertRelationshipRow).toHaveBeenCalledOnce()
    expect(listRelationshipRows).toHaveBeenCalledWith({
      datasetId: profileArtifact.datasetId,
      registryVersion: 'registry-profile-workflow-v1',
    })
    expect(JSON.stringify(response.body.result.registrySnapshot)).not.toContain('C-001')
  })

  it('rejects low-confidence profile hint candidates before registry mutation', async () => {
    const runtime = createDpmGatewayRuntime()
    const profileArtifact = createKafkaProfileArtifact()
    const analysisReport = createDpmProfileAnalysisReport({ profileArtifact })
    const relationshipHint = analysisReport.relationshipHints.find(candidate =>
      candidate.id === 'proposal:edge:relationship-hint:hint:orders-created-customer'
    )
    if (!relationshipHint) throw new Error('expected explicit Kafka relationship hint')
    const registryRows: DpmRegistryRelationshipRow[] = []
    const upsertRelationshipRow = vi.fn((row: DpmRegistryRelationshipRow) => {
      registryRows.push(row)
    })
    const registryRepository = createDpmRegistryRepository({
      upsertRelationshipRow,
      listRelationshipRows: () => registryRows,
    })

    await expect(runtime.approveDpmProfileRelationshipHint({
      profileArtifact,
      relationshipHint,
      relationshipName: 'rel_orders_customer',
      childTableByPathPrefix: {
        'orders.created': 'public.orders',
      },
      confidenceScore: 0.5,
      registryVersion: 'registry-profile-workflow-v1',
      version: '1',
      namespace: 'customer',
      transformStrategy: 'relationship_token',
      orphanPolicy: 'block',
      owner: 'privacy-platform',
      approvedBy: 'dpm-reviewer@example.com',
      reason: 'Low confidence should not be approved.',
      registryRepository,
    })).rejects.toThrow(
      'DPM profile relationship hint approval requires a reviewable candidate: '
      + 'candidate:profile:proposal_edge_relationship_hint_hint_orders_created_customer is reject.',
    )
    expect(upsertRelationshipRow).not.toHaveBeenCalled()
    expect(registryRows).toEqual([])
  })
})
