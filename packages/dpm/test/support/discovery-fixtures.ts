import {
  createRelationshipDiscoveryReport,
  type RelationshipDiscoveryReport,
  type RelationshipDiscoveryReportInput,
} from '../../src/index.js'
import { readDpmJsonFixture } from './fixture-io.js'

export function readDiscoveryFixture<T>(name: string): T {
  return readDpmJsonFixture<T>(`discovery/${name}`)
}

export function readCommerceDiscoveryReport(): RelationshipDiscoveryReport {
  return createRelationshipDiscoveryReport(
    readDiscoveryFixture<RelationshipDiscoveryReportInput>('commerce-candidates.json'),
  )
}
