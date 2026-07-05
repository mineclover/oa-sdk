import type {
  RegistryRelationship,
} from './registry-relationship-types.js'
import type { RegistrySnapshot } from './registry-snapshot-types.js'

export function selectApprovedRelationships(snapshot: RegistrySnapshot): RegistryRelationship[] {
  return snapshot.relationships.filter(isExecutableRegistryRelationship)
}

export function isExecutableRegistryRelationship(relationship: Pick<RegistryRelationship, 'status'>): boolean {
  return relationship.status === 'approved'
}
