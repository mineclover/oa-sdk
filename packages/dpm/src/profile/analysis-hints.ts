import type { DpmProfileRelationshipHintProposal } from './analysis-signal-types.js'
import {
  byId,
} from './analysis-ordering-utils.js'
import {
  readStringShape,
} from './analysis-node-utils.js'
import type { DpmProfileArtifact } from './profile-artifact-types.js'
import type {
  DpmProfileEdge,
  DpmProfileNode,
} from './profile-graph-types.js'

export function analyzeRelationshipHints(profile: DpmProfileArtifact): DpmProfileRelationshipHintProposal[] {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]))

  return profile.edges
    .filter(edge => edge.kind === 'candidate_relationship')
    .filter(edge => isResolvableRelationshipHintEdge(edge, nodes))
    .map(edge => {
      const hintNode = nodes.get(edge.toNodeId)!
      const targetRef = readStringShape(hintNode, 'toRef') ?? hintNode?.coordinate.externalId
      return {
        id: `proposal:${edge.id}`,
        status: 'review' as const,
        fromNodeId: edge.fromNodeId,
        hintNodeId: edge.toNodeId,
        ...(targetRef ? { targetRef } : {}),
        confidence: edge.confidence ?? 0,
        evidenceIds: [...edge.evidenceIds].sort(),
        explanation: hintNode?.label ?? `Review candidate relationship ${edge.id}.`,
      }
    })
    .sort(byId)
}

function isResolvableRelationshipHintEdge(
  edge: DpmProfileEdge,
  nodes: ReadonlyMap<string, DpmProfileNode>,
): boolean {
  const sourceNode = nodes.get(edge.fromNodeId)
  const hintNode = nodes.get(edge.toNodeId)

  return Boolean(sourceNode && hintNode?.kind === 'relationship_hint')
}
