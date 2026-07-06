import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fixturesRoot = new URL('../fixtures/', import.meta.url)

export const cliManifestPath = join(fixturesRoot.pathname, 'valid/customer-orders.json')
export const cliCatalogPath = join(fixturesRoot.pathname, 'catalog/postgres-commerce.json')
export const cliRegistryPath = join(fixturesRoot.pathname, 'registry/commerce-registry.yaml')

export function parseCliStdout(stdout: string): Record<string, any> {
  return JSON.parse(stdout) as Record<string, any>
}

export function readCliManifestFixture(): Record<string, any> {
  return JSON.parse(readFileSync(cliManifestPath, 'utf8')) as Record<string, any>
}

export function writeTempCliJsonFixture(prefix: string, filename: string, value: unknown): string {
  const tempDir = mkdtempSync(join(tmpdir(), prefix))
  const path = join(tempDir, filename)
  writeFileSync(path, JSON.stringify(value, null, 2))
  return path
}
