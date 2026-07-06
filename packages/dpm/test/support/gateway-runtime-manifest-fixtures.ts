import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createPostgresCatalogSnapshot,
  parseRegistrySnapshotYaml,
} from '../../src/index.js'

const fixturesRoot = new URL('../fixtures/', import.meta.url)

export const manifestPath = join(fixturesRoot.pathname, 'valid/customer-orders.json')
export const catalogPath = join(fixturesRoot.pathname, 'catalog/postgres-commerce.json')
export const registryPath = join(fixturesRoot.pathname, 'registry/commerce-registry.yaml')
type ManifestRuntimeCliCommand = 'validate' | 'compile' | 'dry-run'

export function parseStdout(stdout: string): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>
}

export function createRuntimeInput() {
  return {
    manifest: readJsonFixture(manifestPath),
    catalog: createPostgresCatalogSnapshot(readJsonFixture(catalogPath)),
    registry: parseRegistrySnapshotYaml(readFileSync(registryPath, 'utf8')),
  }
}

export function createManifestRuntimeCliArgs(command: ManifestRuntimeCliCommand): string[] {
  return [
    command,
    '--manifest',
    manifestPath,
    '--catalog',
    catalogPath,
    '--registry',
    registryPath,
  ]
}

export function createBlockingRuntimeInput() {
  const input = createRuntimeInput()
  const manifest = structuredClone(input.manifest) as Record<string, any>
  manifest.columns[0].transform = { type: 'keep' }
  return {
    ...input,
    manifest,
  }
}

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}
