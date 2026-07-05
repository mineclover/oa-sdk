export const REGISTRY_SNAPSHOT_KIND = 'dpm.relationship.registry-snapshot.v1' as const

export function createRegistrySnapshotIdentity(datasetId: string, registryVersion: string): string {
  return `${datasetId}@${registryVersion}`
}

export function createRegistryRelationshipIdentity(
  datasetId: string,
  relationshipName: string,
  version: string,
): string {
  return `${datasetId}/${relationshipName}@${version}`
}
