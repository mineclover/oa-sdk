import type {
  RegistryOrphanPolicy,
  RegistryRelationshipKind,
  RegistryTransformStrategy,
} from '../registry/registry-taxonomy.js'
import type { DpmRelationshipStepCardinality } from './plan-taxonomy.js'

export type DpmNamespaceBinding = {
  namespace: string
  entity: string
  relationships: string[]
  columns: string[]
  transform: string
}

export type DpmRelationshipStep = {
  name: string
  registryIdentity: string
  registryStatus: 'approved'
  relationshipType: RegistryRelationshipKind
  cardinality: DpmRelationshipStepCardinality
  parent: {
    table: string
    columns: string[]
  }
  child: {
    table: string
    columns: string[]
  }
  namespace: string
  transformStrategy: RegistryTransformStrategy
  orphanPolicy: RegistryOrphanPolicy
}

export type DpmColumnStep = {
  table: string
  column: string
  columnRef: string
  role: string
  pii: boolean
  transform: string
  relationship?: string
  namespace?: string
}
