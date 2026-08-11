#!/usr/bin/env tsx

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient } from '@oa-sdk/mock-server'

const __dirname = dirname(fileURLToPath(import.meta.url))
const specPath = resolve(__dirname, '../../../packages/schemas/src/.merged.yaml')
const spec = parse(readFileSync(specPath, 'utf8'))
const auth = { headers: { authorization: 'Bearer token' } }
const server = createNodeMockServer(spec, { port: 0 })

await server.start()
try {
  const client = createTestClient(server)
  const response = await client.post(
    '/users',
    { name: 'Alice', email: 'a@b.com', password: 'secure1234' },
    auth,
  )
  if (response.status !== 201) throw new Error(`expected 201, received ${response.status}`)
  console.log(`Mock server request OK: ${response.status}`)

  const invalid = await client.post('/users', {}, auth)
  if (invalid.status !== 422) throw new Error(`expected 422, received ${invalid.status}`)
  const detail = invalid.json?.error?.details?.[0]
  console.log(`Validation failure: ${invalid.status} ${detail?.path}: ${detail?.message}`)
} finally {
  await server.stop()
}
