import type { DpmProfileRelationshipHintStatus } from './analysis-taxonomy.js'

export type DpmProfileRelationshipHintProposal = {
  id: string
  status: DpmProfileRelationshipHintStatus
  fromNodeId: string
  hintNodeId: string
  targetRef?: string
  confidence: number
  evidenceIds: string[]
  explanation: string
}
