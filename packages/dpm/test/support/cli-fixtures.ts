import { join } from 'node:path'

const fixturesRoot = new URL('../fixtures/', import.meta.url)

export const cliManifestPath = join(fixturesRoot.pathname, 'valid/customer-orders.json')
export const cliCatalogPath = join(fixturesRoot.pathname, 'catalog/postgres-commerce.json')
export const cliRegistryPath = join(fixturesRoot.pathname, 'registry/commerce-registry.yaml')

export function parseCliStdout(stdout: string): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>
}
