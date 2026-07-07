import {
  createDpmRelationshipCandidateInputFromResolvedProfileHint,
} from '../profile/analysis-relationship-candidate.js'
import type { DpmProfileDiagnostic } from '../profile/types.js'
import {
  createRegistryRelationshipIdentity,
} from '../registry/registry-identity.js'
import {
  approveDpmRelationshipCandidateRuntime,
} from './runtime-relationship-approve.js'
import {
  importDpmRelationshipCandidatesRuntime,
} from './runtime-relationship-candidate-import.js'
import {
  exportDpmRegistrySnapshotRuntime,
} from './runtime-relationship-registry-export.js'
import type {
  DpmGatewayProfileRelationshipHintApprovalInput,
  DpmGatewayProfileRelationshipHintApprovalResult,
  DpmGatewayRegistryRelationshipWriteReceipt,
} from './runtime-relationship-types.js'
import {
  createDpmGatewayRuntimeResponse,
} from './runtime-response.js'
import type {
  DpmGatewayRuntimeResponse,
} from './runtime-response-types.js'

export async function approveDpmProfileRelationshipHintRuntime(
  input: DpmGatewayProfileRelationshipHintApprovalInput,
): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileRelationshipHintApprovalResult>> {
  const candidateInput = tryCreateCandidateInput(input)
  if (!candidateInput.ok) {
    return createProfileRelationshipHintApprovalBlockingResponse({
      relationshipName: input.relationshipName,
      code: 'PROF202',
      message: candidateInput.message,
    })
  }
  const candidateImportResponse = await importDpmRelationshipCandidatesRuntime({
    datasetId: input.profileArtifact.datasetId,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    ...(input.thresholds ? { thresholds: input.thresholds } : {}),
    candidates: [candidateInput.value],
  })
  const reviewCandidate = candidateImportResponse.body.result.report.candidates.find(candidate =>
    candidate.id === candidateInput.value.id
  )
  if (!reviewCandidate) {
    return createProfileRelationshipHintApprovalBlockingResponse({
      relationshipName: input.relationshipName,
      code: 'PROF203',
      message: `DPM profile relationship hint approval could not import candidate ${candidateInput.value.id}.`,
    })
  }
  if (reviewCandidate.recommendation !== 'review') {
    return createProfileRelationshipHintApprovalBlockingResponse({
      relationshipName: input.relationshipName,
      code: 'PROF203',
      message: 'DPM profile relationship hint approval requires a reviewable candidate: '
        + `${reviewCandidate.id} is ${reviewCandidate.recommendation}.`,
    })
  }

  const approvalResponse = await approveDpmRelationshipCandidateRuntime({
    relationshipName: input.relationshipName,
    candidate: reviewCandidate,
    version: input.version,
    namespace: input.namespace,
    transformStrategy: input.transformStrategy,
    orphanPolicy: input.orphanPolicy,
    owner: input.owner,
    approvedBy: input.approvedBy,
    reason: input.reason,
    ...(input.approvedAt ? { approvedAt: input.approvedAt } : {}),
  })
  const saveInput = {
    datasetId: input.profileArtifact.datasetId,
    registryVersion: input.registryVersion,
    relationship: approvalResponse.body.result.relationship,
    ...(input.auditEventId ? { auditEventId: input.auditEventId } : {}),
    ...(input.sourceFreshnessHash ? { sourceFreshnessHash: input.sourceFreshnessHash } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  }
  const savedRelationshipResult = input.registryRepository.saveRelationshipWithAuditEvent
    ? await input.registryRepository.saveRelationshipWithAuditEvent(saveInput)
    : {
        relationshipRow: await input.registryRepository.saveRelationship(saveInput),
      }
  const registrySnapshotResponse = await exportDpmRegistrySnapshotRuntime({
    datasetId: input.profileArtifact.datasetId,
    registryVersion: input.registryVersion,
    ...(input.exportedAt ? { exportedAt: input.exportedAt } : {}),
    registryRepository: input.registryRepository,
  })

  return createDpmGatewayRuntimeResponse({
    operationId: 'approveDpmProfileRelationshipHint',
    statusCode: 200,
    command: 'approve-profile-relationship-hint',
    result: {
      relationshipName: input.relationshipName,
      status: 'approved',
      candidateInput: candidateInput.value,
      reviewCandidate,
      candidateImport: candidateImportResponse.body.result,
      relationship: approvalResponse.body.result.relationship,
      relationshipWriteReceipt: createRelationshipWriteReceipt({
        ...savedRelationshipResult.relationshipRow,
        ...(savedRelationshipResult.approvalAuditEvent
          ? { approvalAuditEventId: savedRelationshipResult.approvalAuditEvent.eventId }
          : {}),
      }),
      registrySnapshot: registrySnapshotResponse.body.result,
    },
  })
}

function createRelationshipWriteReceipt(input: {
  datasetId: string
  registryVersion: string
  relationshipName: string
  relationshipVersion: string
  status: DpmGatewayRegistryRelationshipWriteReceipt['status']
  approvalAuditEventId?: string
  sourceFreshnessHash?: string
  createdAt?: string
  updatedAt?: string
}): DpmGatewayRegistryRelationshipWriteReceipt {
  const savedAt = input.updatedAt ?? input.createdAt

  return {
    kind: 'dpm.relationship.registry-write-receipt.v1',
    datasetId: input.datasetId,
    registryVersion: input.registryVersion,
    relationshipName: input.relationshipName,
    relationshipVersion: input.relationshipVersion,
    relationshipIdentity: createRegistryRelationshipIdentity(
      input.datasetId,
      input.relationshipName,
      input.relationshipVersion,
    ),
    status: input.status,
    ...(input.approvalAuditEventId ? { approvalAuditEventId: input.approvalAuditEventId } : {}),
    ...(input.sourceFreshnessHash ? { sourceFreshnessHash: input.sourceFreshnessHash } : {}),
    ...(savedAt ? { savedAt } : {}),
  }
}

function tryCreateCandidateInput(
  input: DpmGatewayProfileRelationshipHintApprovalInput,
): { ok: true; value: ReturnType<typeof createDpmRelationshipCandidateInputFromResolvedProfileHint> }
  | { ok: false; message: string } {
  try {
    return {
      ok: true,
      value: createDpmRelationshipCandidateInputFromResolvedProfileHint(input),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error
        ? error.message
        : 'DPM profile relationship hint approval could not resolve the candidate endpoint.',
    }
  }
}

function createProfileRelationshipHintApprovalBlockingResponse(input: {
  relationshipName: string
  code: DpmProfileDiagnostic['code']
  message: string
}): DpmGatewayRuntimeResponse<DpmGatewayProfileRelationshipHintApprovalResult> {
  return createDpmGatewayRuntimeResponse({
    operationId: 'approveDpmProfileRelationshipHint',
    statusCode: 400,
    command: 'approve-profile-relationship-hint',
    result: {
      relationshipName: input.relationshipName,
      status: 'blocked',
      diagnostics: [{
        severity: 'error',
        code: input.code,
        message: input.message,
      }],
    },
  })
}
