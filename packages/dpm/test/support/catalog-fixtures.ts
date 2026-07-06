import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const fixturesRoot = new URL('../fixtures/catalog/', import.meta.url)

export function readCatalogFixture<T>(name: string): T {
  const fixturePath = join(fixturesRoot.pathname, name)
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T
}
