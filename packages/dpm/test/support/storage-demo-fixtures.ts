import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const storageDemoRoot = fileURLToPath(new URL('../../examples/customer-orders-storage/', import.meta.url))
export const storageDemoPackageRoot = fileURLToPath(new URL('../..', import.meta.url))
export const storageDemoCommandTimeoutMs = 90_000

export function readStorageDemoJsonFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(storageDemoRoot, name), 'utf8')) as T
}
