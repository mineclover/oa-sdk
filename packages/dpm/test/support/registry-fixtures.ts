import {
  parseRegistrySnapshotYaml,
  type RegistrySnapshot,
} from '../../src/index.js'
import { readDpmTextFixture } from './fixture-io.js'

export function readRegistryFixture(name: string): string {
  return readDpmTextFixture(`registry/${name}`)
}

export function readCommerceRegistrySnapshot(): RegistrySnapshot {
  return parseRegistrySnapshotYaml(readRegistryFixture('commerce-registry.yaml'))
}
