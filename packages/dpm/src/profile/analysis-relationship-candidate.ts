import type { SchemaSourceCoordinate } from '@oa-sdk/openapi-projection-contract'

import type { RelationshipDiscoveryEndpoint } from '../discovery/discovery-endpoint-types.js'
import type { RelationshipCandidateInput } from '../discovery/discovery-relationship-candidate-types.js'
import type { DiscoveryRelationshipCandidateType } from '../discovery/discovery-taxonomy.js'
import type { DpmProfileArtifact } from './profile-artifact-types.js'
import type { DpmProfileRelationshipHintProposal } from './analysis-relationship-hint-types.js'
import type { DpmProfileCoordinate } from './profile-source-types.js'

export type DpmProfileRelationshipCandidateBridgeInput = {
  profileArtifact: DpmProfileArtifact
  relationshipHint: DpmProfileRelationshipHintProposal
  relationshipName: string
  parent: RelationshipDiscoveryEndpoint
  child: RelationshipDiscoveryEndpoint
  type?: DiscoveryRelationshipCandidateType
  candidateId?: string
  confidenceScore?: number
  warnings?: string[]
}

export function createDpmRelationshipCandidateInputFromProfileHint(
  input: DpmProfileRelationshipCandidateBridgeInput,
): RelationshipCandidateInput {
  const sourceNode = input.profileArtifact.nodes.find(node => node.id === input.relationshipHint.fromNodeId)
  if (!sourceNode) {
    throw new Error(`Profile relationship hint ${input.relationshipHint.id} references missing source node ${input.relationshipHint.fromNodeId}.`)
  }
  const hintNode = input.relationshipHint.hintNodeId
    ? input.profileArtifact.nodes.find(node => node.id === input.relationshipHint.hintNodeId)
    : undefined
  const confidenceScore = input.confidenceScore ?? input.relationshipHint.confidence

  return {
    id: input.candidateId ?? `candidate:profile:${toIdentifier(input.relationshipHint.id)}`,
    relationshipName: input.relationshipName,
    type: input.type ?? 'one_to_many',
    parent: copyEndpoint(input.parent),
    child: copyEndpoint(input.child),
    confidenceScore,
    evidence: [{
      kind: 'service_code_hint',
      score: confidenceScore,
      message: input.relationshipHint.explanation,
      source: toRelationshipHintSourceCoordinate(input.relationshipHint, sourceNode.coordinate),
      metadata: {
        profileId: input.profileArtifact.profileId,
        profileVersion: input.profileArtifact.profileVersion,
        datasetId: input.profileArtifact.datasetId,
        relationshipHintId: input.relationshipHint.id,
        relationshipHintSource: input.relationshipHint.source,
        fromNodeId: input.relationshipHint.fromNodeId,
        ...(input.relationshipHint.hintNodeId ? { hintNodeId: input.relationshipHint.hintNodeId } : {}),
        ...(input.relationshipHint.targetRef ? { targetRef: input.relationshipHint.targetRef } : {}),
        evidenceIds: [...input.relationshipHint.evidenceIds].sort(),
        sourceCoordinate: copyProfileCoordinate(sourceNode.coordinate),
        ...(hintNode ? { hintCoordinate: copyProfileCoordinate(hintNode.coordinate) } : {}),
      },
    }],
    warnings: [...(input.warnings ?? [])].sort(),
  }
}

function copyEndpoint(endpoint: RelationshipDiscoveryEndpoint): RelationshipDiscoveryEndpoint {
  return {
    table: endpoint.table,
    columns: [...endpoint.columns],
  }
}

function toRelationshipHintSourceCoordinate(
  relationshipHint: DpmProfileRelationshipHintProposal,
  coordinate: DpmProfileCoordinate,
): SchemaSourceCoordinate {
  return {
    kind: 'db',
    entity: 'profile_relationship_hint',
    id: relationshipHint.id,
    pointer: coordinate.pointer ?? coordinate.path,
  }
}

function copyProfileCoordinate(coordinate: DpmProfileCoordinate): DpmProfileCoordinate {
  return {
    kind: coordinate.kind,
    path: coordinate.path,
    ...(coordinate.sourceId ? { sourceId: coordinate.sourceId } : {}),
    ...(coordinate.pointer ? { pointer: coordinate.pointer } : {}),
    ...(coordinate.externalId ? { externalId: coordinate.externalId } : {}),
  }
}

function toIdentifier(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'relationship_hint'
}
