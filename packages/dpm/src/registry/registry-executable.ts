import type {
  RegistryRelationship,
  RegistrySnapshot,
} from './types.js'

export function selectApprovedRelationships(snapshot: RegistrySnapshot): RegistryRelationship[] {
  return snapshot.relationships.filter(isExecutableRegistryRelationship)
}

export function isExecutableRegistryRelationship(relationship: Pick<RegistryRelationship, 'status'>): boolean {
  return relationship.status === 'approved'
}
