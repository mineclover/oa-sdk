import {
  createRegistrySnapshot,
  parseRegistrySnapshotYaml,
  type RegistrySnapshotInput,
  type RegistrySnapshot,
} from '../../src/index.js'
import { readDpmTextFixture } from './fixture-io.js'

export const COMMERCE_REGISTRY_FIXTURE_NAME = 'commerce-registry.yaml' as const
export const expectedCommerceRegistryIdentity = 'commerce_ai@reg-2026-07-01' as const

export const expectedCommerceRegistryRelationshipIdentities = [
  'commerce_ai/rel_legacy_customer@2',
  'commerce_ai/rel_old_orders_customer@1',
  'commerce_ai/rel_orders_customer@1',
  'commerce_ai/rel_orders_status@1',
  'commerce_ai/rel_tickets_customer@1',
] as const

export const expectedCommerceRegistrySummaryByStatus = {
  approved: 1,
  rejected: 1,
  deprecated: 1,
  superseded: 1,
  proposed: 1,
} as const

export const expectedCommerceApprovedRelationshipNames = [
  'rel_orders_customer',
] as const

export const expectedCommerceNonExecutableStatuses = [
  'deprecated',
  'proposed',
  'rejected',
  'superseded',
] as const

export const expectedCommerceRejectedRelationshipHistory = {
  name: 'rel_orders_status',
  executable: false,
  approval: {
    reason: 'Candidate was ambiguous.',
  },
} as const

export const expectedCommerceDeprecatedRelationshipHistory = {
  name: 'rel_legacy_customer',
  supersededBy: 'rel_orders_customer',
  executable: false,
} as const

export const expectedCommerceSupersededRelationshipHistory = {
  name: 'rel_old_orders_customer',
  executable: false,
} as const

export function readRegistryFixture(name: string): string {
  return readDpmTextFixture(`registry/${name}`)
}

export function readCommerceRegistrySnapshot(): RegistrySnapshot {
  return parseRegistrySnapshotYaml(readRegistryFixture(COMMERCE_REGISTRY_FIXTURE_NAME))
}

export function createReorderedCommerceRegistrySnapshot(snapshot = readCommerceRegistrySnapshot()): RegistrySnapshot {
  const input: RegistrySnapshotInput = {
    datasetId: snapshot.datasetId,
    registryVersion: snapshot.registryVersion,
    exportedAt: snapshot.exportedAt,
    relationships: [...snapshot.relationships].reverse(),
  }
  return createRegistrySnapshot(input)
}
