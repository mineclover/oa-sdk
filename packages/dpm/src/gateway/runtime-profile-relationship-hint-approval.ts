import {
  createDpmRelationshipCandidateInputFromResolvedProfileHint,
} from '../profile/analysis-relationship-candidate.js'
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
  const candidateInput = createDpmRelationshipCandidateInputFromResolvedProfileHint(input)
  const candidateImportResponse = await importDpmRelationshipCandidatesRuntime({
    datasetId: input.profileArtifact.datasetId,
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    ...(input.thresholds ? { thresholds: input.thresholds } : {}),
    candidates: [candidateInput],
  })
  const reviewCandidate = candidateImportResponse.body.result.report.candidates.find(candidate =>
    candidate.id === candidateInput.id
  )
  if (!reviewCandidate) {
    throw new Error(
      `DPM profile relationship hint approval could not import candidate ${candidateInput.id}.`,
    )
  }
  if (reviewCandidate.recommendation !== 'review') {
    throw new Error(
      `DPM profile relationship hint approval requires a reviewable candidate: `
      + `${reviewCandidate.id} is ${reviewCandidate.recommendation}.`,
    )
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
  const savedRelationship = await input.registryRepository.saveRelationship({
    datasetId: input.profileArtifact.datasetId,
    registryVersion: input.registryVersion,
    relationship: approvalResponse.body.result.relationship,
    ...(input.sourceFreshnessHash ? { sourceFreshnessHash: input.sourceFreshnessHash } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  })
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
      candidateInput,
      reviewCandidate,
      candidateImport: candidateImportResponse.body.result,
      relationship: approvalResponse.body.result.relationship,
      savedRelationship,
      registrySnapshot: registrySnapshotResponse.body.result,
    },
  })
}
