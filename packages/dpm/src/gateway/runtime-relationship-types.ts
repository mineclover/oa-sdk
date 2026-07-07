import type {
  CatalogSnapshot,
  PostgresCatalogSnapshotInput,
} from '../catalog/types.js'
import type {
  DiscoveryThresholds,
  RelationshipCandidateInput,
  RelationshipDiscoveryReport,
} from '../discovery/types.js'
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
  candidates: RelationshipCandidateInput[]
}

export type DpmGatewayCandidateImportResult = {
  imported: number
  rejected: number
}
