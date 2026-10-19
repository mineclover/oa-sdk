/**
 * Tier 3: the shipped plugins' output, generated through the real pipeline, compiles together.
 *
 * Every generated TypeScript module is type-checked with the TypeScript compiler API under strict
 * NodeNext settings (plus exactOptionalPropertyTypes), resolving @tanstack/react-query and hono to
 * the workspace installs, the way a consumer project would compile it.
 */
import { describe, it, expect } from 'vitest'
import {
  pluginClient,
  pluginRouter,
  pluginTanstackQuery,
  pluginTypescript,
  pluginWire,
  type PluginClientOptions,
  type PluginTanstackQueryOptions,
} from '../../../../packages/codegen/src/plugin/index.js'
import { typecheckGeneratedFiles } from '../../../../packages/codegen/src/__tests__/plugin/helpers/typecheck-generated.js'
import { emittedFiles, runFixturePipeline } from '../fixtures/generated-sdk.js'

const TYPECHECK_PACKAGES = ['@tanstack/react-query', 'hono'] as const

async function generateStack(
  fixture: 'petstore' | 'storefront' | 'edge-cases' | 'reserved-names',
  options: { client?: PluginClientOptions; tanstack?: PluginTanstackQueryOptions } = {},
): Promise<Record<string, string>> {
  const result = await runFixturePipeline(fixture, [
    pluginTypescript(),
    pluginClient(options.client),
    pluginTanstackQuery(options.tanstack),
    pluginRouter({ target: 'hono' }),
  ])
  expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([])
  expect(result.success).toBe(true)
  return emittedFiles(result)
}

describe('Tier 3: Shipped plugin output type-checks together', () => {
  // reserved-names: operations named with reserved words (`delete`, `import`, `new`, `Orders.export`), like a client.ts binding
  // (`createClient`, `client`, whose `ClientResponse` is also a client.ts helper type) or like a global client.ts refers to (`fetch`).
  for (const fixture of ['petstore', 'storefront', 'edge-cases', 'reserved-names'] as const) {
    it(`${fixture}: types + client + TanStack (single file) + adapter + hono router`, async () => {
      const files = await generateStack(fixture)
      expect(Object.keys(files).sort()).toEqual(['api-client.ts', 'api.contract.ts', 'client.ts', 'queries.ts', 'router.ts', 'types.ts'])
      expect(typecheckGeneratedFiles({ files, packages: TYPECHECK_PACKAGES })).toEqual([])
    })

    it(`${fixture}: split TanStack modules (keys.ts, queries.ts, hooks.ts)`, async () => {
      const files = await generateStack(fixture, { tanstack: { split: true } })
      expect(files['hooks.ts']).toBeDefined()
      expect(typecheckGeneratedFiles({ files, packages: TYPECHECK_PACKAGES })).toEqual([])
    })
  }

  it('petstore: pluginClient({ clientClass: false }) and the axios transport', async () => {
    for (const client of [{ clientClass: false }, { httpClient: 'axios' as const }]) {
      const files = await generateStack('petstore', { client })
      expect(typecheckGeneratedFiles({ files, packages: TYPECHECK_PACKAGES }), JSON.stringify(client)).toEqual([])
    }
  })

  it('edge-cases: consumer code compiles against root-level, shared-name, typed-header and multi-error operations', async () => {
    const files = await generateStack('edge-cases', { tanstack: { split: true } })
    const usage = [
      "import { QueryClient } from '@tanstack/react-query'",
      "import { createClient, getItem, getThing, isErrorStatus, listItems, petsList, removeItem, usersList } from './client.js'",
      "import { ApiClientResponseError, createApiClient } from './api-client.js'",
      "import { getItemQueryOptions } from './queries.js'",
      "import type { GenericError, GetItemError, Item, NotFound } from './types.js'",
      "const client = createClient({ baseUrl: 'https://edge.test' })",
      'export async function run(): Promise<string> {',
      "  await listItems({ client, headers: { 'x-count': 2, 'x-debug': true } })",
      "  await removeItem({ client, path: { id: 'a' } })",
      '  const pets: Item[] | undefined = (await petsList({ client })).data',
      '  const users: Item[] | undefined = (await usersList({ client })).data',
      "  const res = await getItem({ client, path: { id: 'a' } })",
      '  if (isErrorStatus(res, 404)) return res.error.message',
      '  if (isErrorStatus(res, 409)) return res.error.conflictKey',
      "  const thing = await getThing({ client, path: { id: 'b' } })",
      '  if (isErrorStatus(thing, 500)) { const err: NotFound | GenericError = thing.error; return JSON.stringify(err) }',
      "  const item = await new QueryClient().fetchQuery(getItemQueryOptions(createApiClient(client), { id: 'a' }))",
      '  return `${pets?.length ?? 0}/${users?.length ?? 0}/${item.name}`',
      '}',
      '// A query error is the declared error body (GetItemError) or an ApiClientResponseError.',
      'export function describeItemError(error: GetItemError | ApiClientResponseError): string {',
      '  if (error instanceof ApiClientResponseError) return `HTTP ${error.status}`',
      "  return 'conflictKey' in error ? error.conflictKey : error.message",
      '}',
    ].join('\n')
    expect(typecheckGeneratedFiles({ files: { ...files, 'usage.ts': usage }, packages: TYPECHECK_PACKAGES })).toEqual([])
  })

  it('protobuf and wire-namespaces: wire codecs for every codec kind compile with the generated models', async () => {
    // wire-namespaces declares models in sub-namespaces (`Inventory.Widget`), whose types.ts names differ.
    for (const fixture of ['protobuf', 'wire-namespaces'] as const) {
      const result = await runFixturePipeline(fixture, [
        pluginTypescript(),
        pluginWire({ codecs: ['protobuf', 'msgpack', 'proto3', 'rpc-contract'] }),
      ])
      expect(result.success, fixture).toBe(true)
      const files = emittedFiles(result)
      expect(files['schema.proto'], fixture).toContain('syntax = "proto3";')
      expect(typecheckGeneratedFiles({ files }), fixture).toEqual([])
    }
  })
})
