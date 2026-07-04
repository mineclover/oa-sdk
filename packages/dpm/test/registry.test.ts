import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  REGISTRY_SNAPSHOT_KIND,
  createRegistrySnapshot,
  parseRegistrySnapshotYaml,
  selectApprovedRelationships,
  type RegistrySnapshotInput,
} from '../src/index.js'

const fixturesRoot = new URL('./fixtures/registry/', import.meta.url)

function readFixture(name: string): string {
  return readFileSync(join(fixturesRoot.pathname, name), 'utf8')
}

describe('DPM relationship registry snapshot', () => {
  it('loads YAML review artifacts into a versioned registry snapshot', () => {
    const snapshot = parseRegistrySnapshotYaml(readFixture('commerce-registry.yaml'))

    expect(snapshot.kind).toBe(REGISTRY_SNAPSHOT_KIND)
    expect(snapshot.identity).toBe('commerce_ai@reg-2026-07-01')
    expect(snapshot.relationships.map(relationship => relationship.identity)).toEqual([
      'commerce_ai/rel_legacy_customer@2',
      'commerce_ai/rel_old_orders_customer@1',
      'commerce_ai/rel_orders_customer@1',
      'commerce_ai/rel_orders_status@1',
      'commerce_ai/rel_tickets_customer@1',
    ])
    expect(snapshot.summary.byStatus).toMatchObject({
      approved: 1,
      rejected: 1,
      deprecated: 1,
      superseded: 1,
      proposed: 1,
    })
  })

  it('selects only approved relationships for compilation', () => {
    const snapshot = parseRegistrySnapshotYaml(readFixture('commerce-registry.yaml'))
    const approved = selectApprovedRelationships(snapshot)

    expect(approved.map(relationship => relationship.name)).toEqual(['rel_orders_customer'])
    expect(approved.every(relationship => relationship.executable)).toBe(true)
    expect(snapshot.nonExecutableRelationships.map(relationship => relationship.status).sort()).toEqual([
      'deprecated',
      'proposed',
      'rejected',
      'superseded',
    ])
  })

  it('loads rejected, deprecated, and superseded relationships as non-executable history', () => {
    const snapshot = parseRegistrySnapshotYaml(readFixture('commerce-registry.yaml'))
    const history = snapshot.nonExecutableRelationships

    expect(history.find(relationship => relationship.status === 'rejected')).toMatchObject({
      name: 'rel_orders_status',
      executable: false,
      approval: {
        reason: 'Candidate was ambiguous.',
      },
    })
    expect(history.find(relationship => relationship.status === 'deprecated')).toMatchObject({
      name: 'rel_legacy_customer',
      supersededBy: 'rel_orders_customer',
      executable: false,
    })
    expect(history.find(relationship => relationship.status === 'superseded')).toMatchObject({
      name: 'rel_old_orders_customer',
      executable: false,
    })
  })

  it('keeps snapshot identity stable for equivalent relationship ordering', () => {
    const snapshot = parseRegistrySnapshotYaml(readFixture('commerce-registry.yaml'))
    const input: RegistrySnapshotInput = {
      datasetId: snapshot.datasetId,
      registryVersion: snapshot.registryVersion,
      exportedAt: snapshot.exportedAt,
      relationships: [...snapshot.relationships].reverse(),
    }
    const reordered = createRegistrySnapshot(input)

    expect(reordered.identity).toBe(snapshot.identity)
    expect(reordered.relationships.map(relationship => relationship.identity)).toEqual(
      snapshot.relationships.map(relationship => relationship.identity),
    )
  })
})
