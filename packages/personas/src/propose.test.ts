/**
 * v0.6 propose — smoke tests.
 */

import { describe, expect, it } from 'vitest'

import { proposeStubsFromOrphans, renderStubsAsYaml } from './propose.js'
import type { MinimalOpenApiDoc } from './bind.js'
import type { OperationInfo } from './load.js'
import type { DomainMatrix } from './types.js'

function makeOps(map: Record<string, { path: string; method: string; responses: string[] }>): Map<string, OperationInfo> {
  const out = new Map<string, OperationInfo>()
  for (const [opId, info] of Object.entries(map)) {
    out.set(opId, { operationId: opId, path: info.path, method: info.method, responses: new Set(info.responses) })
  }
  return out
}

describe('proposeStubsFromOrphans', () => {
  it('emits a stub for every (op, status) orphan declared in spec', () => {
    const knownOperations = makeOps({
      foo: { path: '/foo', method: 'get', responses: ['200', '401', '404'] },
    })
    const spec: MinimalOpenApiDoc = {
      paths: { '/foo': { get: { operationId: 'foo', responses: { '200': {}, '401': {}, '404': {} } } } },
    }
    const domains: DomainMatrix[] = [{
      domain: 'users',
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [200] },
      }],
    }]
    const stubs = proposeStubsFromOrphans({ spec, domains, knownOperations })
    expect(stubs.length).toBe(2)
    expect(stubs.map(s => s.statusCode).sort()).toEqual(['401', '404'])
  })

  it('skips operations with no orphans', () => {
    const knownOperations = makeOps({
      foo: { path: '/foo', method: 'get', responses: ['200'] },
    })
    const spec: MinimalOpenApiDoc = {
      paths: { '/foo': { get: { operationId: 'foo', responses: { '200': {} } } } },
    }
    const domains: DomainMatrix[] = [{
      domain: 'users',
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [200] },
      }],
    }]
    expect(proposeStubsFromOrphans({ spec, domains, knownOperations })).toEqual([])
  })

  it('401 stub uses guest actor and missing-auth trigger', () => {
    const knownOperations = makeOps({
      foo: { path: '/users', method: 'get', responses: ['200', '401'] },
    })
    const spec: MinimalOpenApiDoc = { paths: { '/users': { get: { operationId: 'foo', responses: { '200': {}, '401': {} } } } } }
    const domains: DomainMatrix[] = [{
      domain: 'users',
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'User', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [200] },
      }],
    }]
    const [stub] = proposeStubsFromOrphans({ spec, domains, knownOperations })
    expect(stub!.persona.identity.actor).toBe('guest')
    expect(stub!.persona.identity.trigger).toBe('missing-auth')
    expect(stub!.persona.outcome?.access).toContain('public')
    expect(stub!.persona.outcome?.access).not.toContain('scoped:read')
  })

  it('404 stub inherits actor from primary persona', () => {
    const knownOperations = makeOps({
      foo: { path: '/users/{id}', method: 'get', responses: ['200', '404'] },
    })
    const spec: MinimalOpenApiDoc = { paths: { '/users/{id}': { get: { operationId: 'foo', responses: { '200': {}, '404': {} } } } } }
    const domains: DomainMatrix[] = [{
      domain: 'users',
      personas: [{
        id: 'admin-detail',
        status: 'implemented',
        identity: { actor: 'admin', data: 'User(any)', intent: 'read-detail', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [200] },
      }],
    }]
    const [stub] = proposeStubsFromOrphans({ spec, domains, knownOperations })
    expect(stub!.persona.identity.actor).toBe('admin')
    expect(stub!.persona.identity.trigger).toBe('phantom-id')
    expect(stub!.persona.outcome?.expects).toEqual([404])
  })

  it('503 stub uses system actor', () => {
    const knownOperations = makeOps({
      foo: { path: '/health', method: 'get', responses: ['200', '503'] },
    })
    const spec: MinimalOpenApiDoc = { paths: { '/health': { get: { operationId: 'foo', responses: { '200': {}, '503': {} } } } } }
    const domains: DomainMatrix[] = [{
      domain: 'health',
      personas: [{
        id: 'liveness',
        status: 'implemented',
        identity: { actor: 'system', data: 'H', intent: 'monitor', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [200] },
      }],
    }]
    const [stub] = proposeStubsFromOrphans({ spec, domains, knownOperations })
    expect(stub!.persona.identity.actor).toBe('system')
    expect(stub!.persona.identity.trigger).toBe('dependency-down')
  })

  it('skips non-numeric response keys (default, ranges)', () => {
    const knownOperations = makeOps({
      foo: { path: '/x', method: 'get', responses: ['200', 'default', '4XX'] },
    })
    const spec: MinimalOpenApiDoc = { paths: { '/x': { get: { operationId: 'foo', responses: { '200': {}, default: {}, '4XX': {} } } } } }
    const domains: DomainMatrix[] = [{
      domain: 'users',
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [200] },
      }],
    }]
    expect(proposeStubsFromOrphans({ spec, domains, knownOperations })).toEqual([])
  })

  it('disambiguates id with status code suffix when base id is taken', () => {
    const knownOperations = makeOps({
      foo: { path: '/x', method: 'get', responses: ['200', '401'] },
    })
    const spec: MinimalOpenApiDoc = { paths: { '/x': { get: { operationId: 'foo', responses: { '200': {}, '401': {} } } } } }
    const domains: DomainMatrix[] = [{
      domain: 'users',
      personas: [
        { id: 'happy', status: 'implemented', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, outcome: { maps_to: ['foo'], expects: [200] } },
        // Pre-claim the id the proposer would otherwise generate
        { id: 'guest-unauthorized-foo', status: 'proposed', identity: { actor: 'guest', data: 'X', intent: 'list', trigger: 'pre-existing' } },
      ],
    }]
    const [stub] = proposeStubsFromOrphans({ spec, domains, knownOperations })
    // Disambiguator appends the status code to avoid the collision
    expect(stub!.persona.id).toBe('guest-unauthorized-foo-401')
    // Disambiguation succeeded → no collision flag
    expect(stub!.collision).toBe(false)
  })

  it('renderStubsAsYaml groups by domain and operation', () => {
    const knownOperations = makeOps({
      foo: { path: '/foo', method: 'get', responses: ['200', '401'] },
      bar: { path: '/bar', method: 'get', responses: ['200', '404'] },
    })
    const spec: MinimalOpenApiDoc = {
      paths: {
        '/foo': { get: { operationId: 'foo', responses: { '200': {}, '401': {} } } },
        '/bar': { get: { operationId: 'bar', responses: { '200': {}, '404': {} } } },
      },
    }
    const domains: DomainMatrix[] = [{
      domain: 'users',
      personas: [
        { id: 'h1', status: 'implemented', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, outcome: { maps_to: ['foo'], expects: [200] } },
        { id: 'h2', status: 'implemented', identity: { actor: 'admin', data: 'X', intent: 'read-detail', trigger: 'ops-monitoring' }, outcome: { maps_to: ['bar'], expects: [200] } },
      ],
    }]
    const stubs = proposeStubsFromOrphans({ spec, domains, knownOperations })
    const yaml = renderStubsAsYaml(stubs)
    expect(yaml).toContain('# ════════ domain: users ════════')
    expect(yaml).toContain('# op: bar')
    expect(yaml).toContain('# op: foo')
    expect(yaml).toContain('# ── signal: orphan ──')
    expect(yaml).toContain('status: proposed')
  })

  it('renderStubsAsYaml shows friendly message when no stubs', () => {
    const yaml = renderStubsAsYaml([])
    expect(yaml).toContain('No signals detected')
  })

  it('v0.12 from-spec: generates new-op stubs for operations with no implemented persona', async () => {
    const { proposeStubsFromSpec } = await import('./propose.js')
    const knownOperations = makeOps({
      newOp: { path: '/new', method: 'post', responses: ['201'] },
    })
    const spec: MinimalOpenApiDoc = {
      paths: { '/new': { post: { operationId: 'newOp', responses: { '201': {} } } } },
    }
    const stubs = proposeStubsFromSpec({ spec, domains: [], knownOperations })
    expect(stubs.some(s => s.signal === 'new-op' && s.operationId === 'newOp')).toBe(true)
  })

  it('v0.12 from-spec: generates new-schema stubs for schemas without data-models', async () => {
    const { proposeStubsFromSpec } = await import('./propose.js')
    const spec: MinimalOpenApiDoc = {
      paths: {},
      components: {
        schemas: {
          NewEntity: { type: 'object' },
          // 비-entity schemas는 skip (Request/Response 패턴)
          CreateUserRequest: { type: 'object' },
        },
      } as Record<string, unknown>,
    }
    const stubs = proposeStubsFromSpec({
      spec,
      domains: [],
      knownOperations: new Map(),
      knownDataModels: new Set(),
    })
    expect(stubs.some(s => s.signal === 'new-schema' && s.operationId === 'NewEntity')).toBe(true)
    expect(stubs.some(s => s.signal === 'new-schema' && s.operationId === 'CreateUserRequest')).toBe(false)
  })

  it('v0.12 from-spec: skips operations with existing implemented persona (idempotent)', async () => {
    const { proposeStubsFromSpec } = await import('./propose.js')
    const knownOperations = makeOps({
      foo: { path: '/foo', method: 'get', responses: ['200'] },
    })
    const spec: MinimalOpenApiDoc = {
      paths: { '/foo': { get: { operationId: 'foo', responses: { '200': {} } } } },
    }
    const domains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [200] },
      }],
    }]
    const stubs = proposeStubsFromSpec({ spec, domains, knownOperations })
    expect(stubs.some(s => s.operationId === 'foo' && s.signal === 'new-op')).toBe(false)
  })

  it('skips orphans listed in acknowledged_orphans', () => {
    const knownOperations = makeOps({
      foo: { path: '/foo', method: 'post', responses: ['201', '500'] },
    })
    const spec: MinimalOpenApiDoc = {
      paths: { '/foo': { post: { operationId: 'foo', responses: { '201': {}, '500': {} } } } },
    }
    const domains: DomainMatrix[] = [{
      domain: 'fake',
      acknowledged_orphans: [
        { operationId: 'foo', statusCode: '500', reason: 'infra error — no actor' },
      ],
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'create', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['foo'], expects: [201] },
      }],
    }]
    expect(proposeStubsFromOrphans({ spec, domains, knownOperations })).toEqual([])
  })
})
