import { describe, expect, it, vi } from 'vitest'

import {
  createDpmGatewayRuntime,
  createDpmProfileAnalysisReport,
  createDpmRegistryRepository,
  getDpmGatewayOpenApiDocument,
  type DpmGatewayProfileRelationshipHintApprovalRequest,
  type DpmRegistryRelationshipAuditEventRow,
  type DpmRegistryRelationshipRow,
} from '../src/index.js'
import { compileGatewayComponentSchema } from './support/gateway-schema.js'
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
    const auditEvents: DpmRegistryRelationshipAuditEventRow[] = []
    const upsertRelationshipRow = vi.fn((row: DpmRegistryRelationshipRow) => {
      registryRows.push(row)
    })
    const appendRelationshipAuditEvent = vi.fn((row: DpmRegistryRelationshipAuditEventRow) => {
      auditEvents.push(row)
    })
    const listRelationshipRows = vi.fn(request =>
      registryRows.filter(row =>
        row.datasetId === request.datasetId && row.registryVersion === request.registryVersion,
      ),
    )
    const registryRepository = createDpmRegistryRepository({
      upsertRelationshipRow,
      appendRelationshipAuditEvent,
      listRelationshipRows,
    })
    const operation = getDpmGatewayOpenApiDocument()
      .paths['/dpm/profiles/relationship-hints/{relationshipName}/approve'].post
    const requestSchemaName = extractRequestSchemaName(operation)
    const responseSchemaName = extractResponseSchemaName(operation)
    const requestSchema = compileGatewayComponentSchema(requestSchemaName)
    const responseSchema = compileGatewayComponentSchema(responseSchemaName)
    const request = {
      profileArtifact,
      relationshipHint,
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
      auditEventId: 'audit:profile-hint:rel-orders-customer-approved',
      generatedAt: '2026-07-07T00:09:00.000Z',
      exportedAt: '2026-07-07T00:11:00.000Z',
      createdAt: '2026-07-07T00:10:00.000Z',
      updatedAt: '2026-07-07T00:10:00.000Z',
      sourceFreshnessHash: analysisReport.freshness.reportHash,
    } satisfies DpmGatewayProfileRelationshipHintApprovalRequest

    const response = await runtime.approveDpmProfileRelationshipHint({
      ...request,
      relationshipName: 'rel_orders_customer',
      registryRepository,
    })

    expect(operation.operationId).toBe('approveDpmProfileRelationshipHint')
    expect(requestSchemaName).toBe('DpmProfileRelationshipHintApprovalRequest')
    expect(responseSchemaName).toBe('DpmProfileRelationshipHintApprovalResponse')
    expect(requestSchema(request), JSON.stringify(requestSchema.errors, null, 2)).toBe(true)
    expect(response.operationId).toBe('approveDpmProfileRelationshipHint')
    expect(response.statusCode).toBe(200)
    expect(response.body.command).toBe('approve-profile-relationship-hint')
    expect(
      responseSchema(response.body.result),
      JSON.stringify(responseSchema.errors, null, 2),
    ).toBe(true)
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
      relationshipWriteReceipt: {
        kind: 'dpm.relationship.registry-write-receipt.v1',
        datasetId: profileArtifact.datasetId,
        registryVersion: 'registry-profile-workflow-v1',
        relationshipName: 'rel_orders_customer',
        relationshipVersion: '1',
        relationshipIdentity: `${profileArtifact.datasetId}/rel_orders_customer@1`,
        status: 'approved',
        approvalAuditEventId: 'audit:profile-hint:rel-orders-customer-approved',
        sourceFreshnessHash: analysisReport.freshness.reportHash,
        savedAt: '2026-07-07T00:10:00.000Z',
      },
    })
    expect(response.body.result.registrySnapshot.approvedRelationships).toEqual([
      expect.objectContaining({
        name: 'rel_orders_customer',
        executable: true,
      }),
    ])
    expect(upsertRelationshipRow).toHaveBeenCalledOnce()
    expect(appendRelationshipAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'audit:profile-hint:rel-orders-customer-approved',
      eventType: 'relationship_approved',
      relationshipName: 'rel_orders_customer',
      relationshipStatus: 'approved',
      actor: 'dpm-reviewer@example.com',
      reason: 'Kafka profile hint was mapped to a customer relationship for pseudonymized analytics.',
      sourceFreshnessHash: analysisReport.freshness.reportHash,
    }))
    expect(auditEvents).toHaveLength(1)
    expect(listRelationshipRows).toHaveBeenCalledWith({
      datasetId: profileArtifact.datasetId,
      registryVersion: 'registry-profile-workflow-v1',
    })
    expect(JSON.stringify(response.body.result.registrySnapshot)).not.toContain('C-001')
  })

  it('omits the approval audit link when storage does not return an audit event', async () => {
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
      listRelationshipRows: request =>
        registryRows.filter(row =>
          row.datasetId === request.datasetId && row.registryVersion === request.registryVersion,
        ),
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
      auditEventId: 'audit:profile-hint:unpersisted-request-id',
      createdAt: '2026-07-07T00:10:00.000Z',
      updatedAt: '2026-07-07T00:10:00.000Z',
      registryRepository,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body.result.relationshipWriteReceipt).toMatchObject({
      relationshipName: 'rel_orders_customer',
      status: 'approved',
    })
    expect(response.body.result.relationshipWriteReceipt)
      .not
      .toHaveProperty('approvalAuditEventId')
    expect(upsertRelationshipRow).toHaveBeenCalledOnce()
  })

  it('returns a blocking response for low-confidence profile hint candidates before registry mutation', async () => {
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
    const operation = getDpmGatewayOpenApiDocument()
      .paths['/dpm/profiles/relationship-hints/{relationshipName}/approve'].post
    const responseSchema = compileGatewayComponentSchema(
      extractBlockingResponseSchemaName(operation),
    )

    const response = await runtime.approveDpmProfileRelationshipHint({
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
    })

    expect(response.statusCode).toBe(400)
    expect(response.body.result).toMatchObject({
      relationshipName: 'rel_orders_customer',
      status: 'blocked',
      diagnostics: [
        expect.objectContaining({
          severity: 'error',
          code: 'PROF203',
          message: 'DPM profile relationship hint approval requires a reviewable candidate: '
            + 'candidate:profile:proposal_edge_relationship_hint_hint_orders_created_customer is reject.',
        }),
      ],
    })
    expect(
      responseSchema(response.body.result),
      JSON.stringify(responseSchema.errors, null, 2),
    ).toBe(true)
    expect(upsertRelationshipRow).not.toHaveBeenCalled()
    expect(registryRows).toEqual([])
  })
})

function extractRequestSchemaName(operation: {
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: {
          $ref?: string
        }
      }
    }
  }
}): string {
  return extractComponentName(operation.requestBody?.content?.['application/json']?.schema?.$ref)
}

function extractResponseSchemaName(operation: {
  responses: {
    '200': {
      content: {
        'application/json': {
          schema: {
            $ref: string
          }
        }
      }
    }
  }
}): string {
  return extractComponentName(operation.responses['200'].content['application/json'].schema.$ref)
}

function extractBlockingResponseSchemaName(operation: {
  responses: {
    '400': {
      content: {
        'application/json': {
          schema: {
            $ref: string
          }
        }
      }
    }
  }
}): string {
  return extractComponentName(operation.responses['400'].content['application/json'].schema.$ref)
}

function extractComponentName(refPath: string | undefined): string {
  const prefix = '#/components/schemas/'
  if (!refPath?.startsWith(prefix)) {
    throw new Error(`Unexpected schema ref: ${refPath}`)
  }
  return refPath.slice(prefix.length)
}
