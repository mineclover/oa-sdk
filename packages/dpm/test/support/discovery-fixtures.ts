import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createRelationshipDiscoveryReport,
  type RelationshipDiscoveryReport,
  type RelationshipDiscoveryReportInput,
} from '../../src/index.js'

const discoveryFixturesRoot = new URL('../fixtures/discovery/', import.meta.url)

export function readDiscoveryFixture<T>(name: string): T {
  const fixturePath = join(discoveryFixturesRoot.pathname, name)
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T
}

export function readCommerceDiscoveryReport(): RelationshipDiscoveryReport {
  return createRelationshipDiscoveryReport(
    readDiscoveryFixture<RelationshipDiscoveryReportInput>('commerce-candidates.json'),
  )
}
