export const REGISTRY_RELATIONSHIP_STATUSES = [
  'candidate',
  'proposed',
  'approved',
  'rejected',
  'deprecated',
  'superseded',
] as const

export const REGISTRY_RELATIONSHIP_KINDS = [
  'one_to_one',
  'one_to_many',
  'many_to_one',
  'many_to_many_edge',
  'self_reference',
  'polymorphic',
  'temporal',
  'code_lookup',
] as const

export const REGISTRY_TRANSFORM_STRATEGIES = ['entity_token', 'relationship_token', 'keep_code'] as const
export const REGISTRY_ORPHAN_POLICIES = [
  'block',
  'warn',
  'tolerate',
  'tolerate_null',
  'create_placeholder_parent',
  'lookup_archive',
] as const

export type RegistryRelationshipStatus = typeof REGISTRY_RELATIONSHIP_STATUSES[number]
export type RegistryRelationshipKind = typeof REGISTRY_RELATIONSHIP_KINDS[number]
export type RegistryTransformStrategy = typeof REGISTRY_TRANSFORM_STRATEGIES[number]
export type RegistryOrphanPolicy = typeof REGISTRY_ORPHAN_POLICIES[number]
