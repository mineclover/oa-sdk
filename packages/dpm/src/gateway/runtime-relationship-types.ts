import type {
  CatalogSnapshot,
  PostgresCatalogSnapshotInput,
} from '../catalog/types.js'
import type {
  DiscoveryThresholds,
  ExcludedRelationshipCandidate,
  RelationshipCandidate,
  RelationshipCandidateInput,
  RelationshipDiscoveryReport,
} from '../discovery/types.js'
import type {
  ApprovedRegistryRelationshipInput,
  RegistryOrphanPolicy,
  RegistryTransformStrategy,
  RegistrySnapshot,
} from '../registry/types.js'
import type { DpmRegistryRepository } from '../storage/registry-repository-types.js'
import type { DpmGatewaySnapshotRef } from './runtime-manifest-request-types.js'

export type DpmGatewayRelationshipDiscoveryRequest = {
  manifest: unknown
  catalogSnapshot: DpmGatewaySnapshotRef
}

export type DpmGatewayRelationshipDiscoverySnapshotResolver = {
  resolveCatalogSnapshot(
    snapshot: DpmGatewaySnapshotRef,
  ): CatalogSnapshot | PostgresCatalogSnapshotInput | Promise<CatalogSnapshot | PostgresCatalogSnapshotInput>
}

export type DpmGatewayRelationshipDiscoveryInput = {
  manifest: unknown
  catalog: CatalogSnapshot | PostgresCatalogSnapshotInput
  generatedAt?: string
  thresholds?: Partial<DiscoveryThresholds>
}

export type DpmGatewayRelationshipDiscoveryResult = RelationshipDiscoveryReport

export type DpmGatewayCandidateImportInput = {
  datasetId: string
  generatedAt?: string
  thresholds?: Partial<DiscoveryThresholds>
  candidates: RelationshipCandidateInput[]
  exclusions?: ExcludedRelationshipCandidate[]
}

export type DpmGatewayCandidateImportResult = {
  imported: number
  rejected: number
  report: RelationshipDiscoveryReport
}

export type DpmGatewayRelationshipApprovalInput = {
  relationshipName: string
  candidate: RelationshipCandidate
  version: string
  namespace: string
  transformStrategy: RegistryTransformStrategy
  orphanPolicy: RegistryOrphanPolicy
  owner: string
  approvedBy: string
  reason: string
  approvedAt?: string
}

export type DpmGatewayRelationshipApprovalResult = {
  relationshipName: string
  status: 'approved'
  relationship: ApprovedRegistryRelationshipInput
}

export type DpmGatewayRegistrySnapshotExportInput = {
  datasetId: string
  registryVersion: string
  exportedAt?: string
  registryRepository: DpmRegistryRepository
}

export type DpmGatewayRegistrySnapshotExportResult = RegistrySnapshot
