/**
 * v0.4 resolver — smoke tests against the bundled matrices + .merged.yaml.
 */

import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

import { findOperation, findPersona, listPersonasForOperation, resolvePersonaResponse } from './resolver.js'
import { createPersonaMockClient } from './mock.js'
import type { MockServerLike } from './mock.js'
import { loadAllDomains } from './load.js'
import type { MinimalOpenApiDoc } from './bind.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const mergedSpecPath = join(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')

const spec = parse(readFileSync(mergedSpecPath, 'utf8')) as MinimalOpenApiDoc
const domains = loadAllDomains()

describe('resolver — bundled spec/matrices', () => {
  it('findPersona locates by id across domains', () => {
    expect(findPersona('admin-monitor', domains)?.persona.id).toBe('admin-monitor')
    expect(findPersona('user-self-read', domains)?.persona.id).toBe('user-self-read')
    expect(findPersona('does-not-exist', domains)).toBeNull()
  })

  it('findOperation resolves operationId to (path, method)', () => {
    const op = findOperation(spec, 'listUsers')
    expect(op).not.toBeNull()
    expect(op!.path).toBe('/users')
    expect(op!.method).toBe('get')
  })

  it('listPersonasForOperation returns all implemented personas claiming the op', () => {
    const ids = listPersonasForOperation('updateUser', domains).map(p => p.id)
    expect(ids).toContain('admin-role-grant')
    expect(ids).toContain('non-admin-update-other-user')
  })

  it('listPersonasForOperation excludes proposed personas', () => {
    // user-public-profile-view is proposed and maps to nothing — should not appear
    const ids = listPersonasForOperation('listUsers', domains).map(p => p.id)
    expect(ids).not.toContain('user-public-profile-view')
  })

  it('resolves admin-monitor → listUsers as 200', () => {
    const r = resolvePersonaResponse('admin-monitor', 'listUsers', { spec, domains })
    expect(r).not.toBeNull()
    expect(r!.status).toBe(200)
    expect(r!.path).toBe('/users')
    expect(r!.method).toBe('get')
    expect(r!.contentType).toBe('application/json')
    expect(r!.body).toBeDefined()
  })

  it('resolves negative-path: guest-unauthorized-list → listUsers as 401', () => {
    const r = resolvePersonaResponse('guest-unauthorized-list', 'listUsers', { spec, domains })
    expect(r).not.toBeNull()
    expect(r!.status).toBe(401)
    expect(r!.body).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('resolves negative-path: non-admin-update-other-user → updateUser as 403', () => {
    const r = resolvePersonaResponse('non-admin-update-other-user', 'updateUser', { spec, domains })
    expect(r).not.toBeNull()
    expect(r!.status).toBe(403)
    expect(r!.body).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('returns null when persona does not claim the operation', () => {
    const r = resolvePersonaResponse('admin-monitor', 'register', { spec, domains })
    expect(r).toBeNull()
  })

  it('returns null for unknown persona', () => {
    const r = resolvePersonaResponse('not-a-persona', 'listUsers', { spec, domains })
    expect(r).toBeNull()
  })

  it('logout (204) resolves with null body and no content-type', () => {
    const r = resolvePersonaResponse('user-logout', 'logout', { spec, domains })
    expect(r).not.toBeNull()
    expect(r!.status).toBe(204)
    expect(r!.contentType).toBeNull()
    expect(r!.body).toBeNull()
  })
})

describe('mock client — simulator + applyTo', () => {
  const client = createPersonaMockClient({ spec, domains })

  it('act() forwards to resolver', () => {
    const r = client.act('admin-monitor', 'listUsers')
    expect(r?.status).toBe(200)
  })

  it('personasFor() lists all roleplay variants of an operation', () => {
    const variants = client.personasFor('listUsers')
    expect(variants).toContain('admin-monitor')
    expect(variants).toContain('guest-unauthorized-list')
  })

  it('applyTo overrides exactly the operations the persona claims', () => {
    const overrides: Array<[string, { status: number }]> = []
    let cleared = 0
    const fakeServer: MockServerLike = {
      override(opId, response) { overrides.push([opId, { status: response.status }]) },
      clearOverride() { cleared++ },
      clearOverrides() { cleared++ },
    }
    const applied = client.applyTo(fakeServer, 'admin-monitor')
    expect(applied).toEqual(['listUsers'])
    expect(overrides).toEqual([['listUsers', { status: 200 }]])
    expect(cleared).toBe(0)
  })

  it('switchTo clears existing overrides before applying', () => {
    const overrides: string[] = []
    let clearCalls = 0
    const fakeServer: MockServerLike = {
      override(opId) { overrides.push(opId) },
      clearOverride() { /* not used */ },
      clearOverrides() { clearCalls++ },
    }
    client.switchTo(fakeServer, 'admin-user-removal')
    expect(clearCalls).toBe(1)
    expect(overrides).toEqual(['deleteUser'])
  })
})
