/**
 * v0.4 — persona roleplay e2e.
 *
 * Real HTTP server (via @oa-sdk/mock-server's node-http adapter) routed by
 * persona via @oa-sdk/personas/applyTo. The same operation answers different
 * status codes depending on which persona is "acting".
 *
 * This proves the bridge: matrix → resolver → mock-server overrides → HTTP.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import { createNodeMockServer, type NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, type TestClient } from '@oa-sdk/mock-server'
import {
  createPersonaMockClient,
  loadAllDomains,
  type MinimalOpenApiDoc,
  type PersonaMockClient,
} from '@oa-sdk/personas'

const __dir = dirname(fileURLToPath(import.meta.url))
const mergedSpecPath = join(__dir, '..', '..', '..', 'packages', 'schemas', 'src', '.merged.yaml')

describe('persona roleplay — listUsers', () => {
  let server: NodeMockServer
  let client: TestClient
  let personas: PersonaMockClient

  beforeAll(async () => {
    const spec = parse(readFileSync(mergedSpecPath, 'utf8')) as MinimalOpenApiDoc
    const domains = loadAllDomains()
    server = createNodeMockServer(spec as Parameters<typeof createNodeMockServer>[0], { port: 0 })
    await server.start()
    client = createTestClient(server)
    personas = createPersonaMockClient({ spec, domains })
  })

  afterAll(async () => {
    await server.stop()
  })

  beforeEach(() => {
    server.clearOverrides()
  })

  it('admin-monitor → 200 with users list', async () => {
    const applied = personas.applyTo(server, 'admin-monitor')
    expect(applied).toEqual(['listUsers'])

    const res = await client.get('/users', { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ items: expect.any(Array) })
  })

  it('guest-unauthorized-list → 401 from same endpoint', async () => {
    const applied = personas.applyTo(server, 'guest-unauthorized-list')
    expect(applied).toEqual(['listUsers'])

    const res = await client.get('/users', { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
    expect(res.json).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('switchTo flips response in place', async () => {
    personas.switchTo(server, 'admin-monitor')
    let res = await client.get('/users', { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)

    personas.switchTo(server, 'guest-unauthorized-list')
    res = await client.get('/users', { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  it('personasFor() enumerates roleplay variants', () => {
    const variants = personas.personasFor('listUsers').sort()
    expect(variants).toEqual(['admin-monitor', 'guest-unauthorized-list'])
  })
})

describe('persona roleplay — updateUser (happy + negative)', () => {
  let server: NodeMockServer
  let client: TestClient
  let personas: PersonaMockClient

  beforeAll(async () => {
    const spec = parse(readFileSync(mergedSpecPath, 'utf8')) as MinimalOpenApiDoc
    const domains = loadAllDomains()
    server = createNodeMockServer(spec as Parameters<typeof createNodeMockServer>[0], { port: 0 })
    await server.start()
    client = createTestClient(server)
    personas = createPersonaMockClient({ spec, domains })
  })

  afterAll(async () => {
    await server.stop()
  })

  beforeEach(() => {
    server.clearOverrides()
  })

  it('admin-role-grant → 200 OK on PATCH /users/{id}', async () => {
    personas.applyTo(server, 'admin-role-grant')
    const res = await client.patch(
      '/users/00000000-0000-0000-0000-000000000001',
      { role: 'admin' },
      { headers: { authorization: 'Bearer t' } },
    )
    expect(res.status).toBe(200)
  })

  it('non-admin-update-other-user → 403 Forbidden on same PATCH', async () => {
    personas.applyTo(server, 'non-admin-update-other-user')
    const res = await client.patch(
      '/users/00000000-0000-0000-0000-000000000001',
      { name: 'X' },
      { headers: { authorization: 'Bearer t' } },
    )
    expect(res.status).toBe(403)
    expect(res.json).toMatchObject({ code: 'FORBIDDEN' })
  })
})
