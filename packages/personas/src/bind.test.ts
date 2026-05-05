/**
 * v0.3 bind module — smoke tests.
 */

import { describe, expect, it } from 'vitest'

import { applyBindings, computeExpectedBindings, detectDrift } from './bind.js'
import type { MinimalOpenApiDoc } from './bind.js'
import type { DomainMatrix } from './types.js'

const fixtureDomains: DomainMatrix[] = [
  {
    domain: 'fake',
    personas: [
      {
        id: 'p1',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1'] },
      },
      {
        id: 'p2',
        status: 'implemented',
        identity: { actor: 'user', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1', 'op2'] },
      },
      {
        id: 'p3',
        status: 'proposed',
        identity: { actor: 'guest', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1'] },     // proposed mappings ignored by binder
      },
    ],
  },
]

const fixtureSpec: MinimalOpenApiDoc = {
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/op1': { get: { operationId: 'op1' } },
    '/op2': { post: { operationId: 'op2' } },
    '/op3': { get: { operationId: 'op3' } },        // no persona
  },
}

const bindOptions = { registryVersion: '0.1', generatedAt: '2026-01-01T00:00:00.000Z' }

describe('computeExpectedBindings', () => {
  it('aggregates implemented persona ids per operation, sorted', () => {
    const map = computeExpectedBindings(fixtureDomains)
    expect(map.get('op1')).toEqual(['p1', 'p2'])
    expect(map.get('op2')).toEqual(['p2'])
    expect(map.has('op3')).toBe(false)
  })

  it('skips proposed personas', () => {
    const map = computeExpectedBindings(fixtureDomains)
    expect([...map.values()].flat()).not.toContain('p3')
  })
})

describe('applyBindings', () => {
  it('injects x-persona on each operation including unjustified', () => {
    const result = applyBindings(fixtureSpec, fixtureDomains, bindOptions)
    const op = (path: string, method: string): { 'x-persona': string[] } =>
      result.paths![path]![method] as { 'x-persona': string[] }
    expect(op('/op1', 'get')['x-persona']).toEqual(['p1', 'p2'])
    expect(op('/op2', 'post')['x-persona']).toEqual(['p2'])
    expect(op('/op3', 'get')['x-persona']).toEqual([])
  })

  it('writes x-persona-meta on info', () => {
    const result = applyBindings(fixtureSpec, fixtureDomains, bindOptions)
    const meta = result.info!['x-persona-meta'] as { version: string; personas: number; implemented: number; proposed: number; generatedAt: string }
    expect(meta.version).toBe('0.1')
    expect(meta.personas).toBe(3)
    expect(meta.implemented).toBe(2)
    expect(meta.proposed).toBe(1)
    expect(meta.generatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('does not mutate input by default', () => {
    const result = applyBindings(fixtureSpec, fixtureDomains, bindOptions)
    expect(fixtureSpec.info!['x-persona-meta']).toBeUndefined()
    expect(result).not.toBe(fixtureSpec)
  })
})

describe('detectDrift', () => {
  it('returns empty when bound spec matches current matrices', () => {
    const bound = applyBindings(fixtureSpec, fixtureDomains, bindOptions)
    expect(detectDrift(bound, fixtureDomains)).toEqual([])
  })

  it('detects mismatch when persona was renamed', () => {
    const bound = applyBindings(fixtureSpec, fixtureDomains, bindOptions)
    const renamedDomains: DomainMatrix[] = [{
      ...fixtureDomains[0]!,
      personas: fixtureDomains[0]!.personas.map(p => p.id === 'p1' ? { ...p, id: 'p1-renamed' } : p),
    }]
    const drift = detectDrift(bound, renamedDomains)
    const op1Drift = drift.find(d => d.operationId === 'op1')
    expect(op1Drift).toBeDefined()
    expect(op1Drift!.expected).toEqual(['p1-renamed', 'p2'])
    expect(op1Drift!.actual).toEqual(['p1', 'p2'])
  })

  it('detects missing operation in bound spec', () => {
    const partial: MinimalOpenApiDoc = { paths: { '/op1': { get: { operationId: 'op1', 'x-persona': ['p1', 'p2'] } } } }
    const drift = detectDrift(partial, fixtureDomains)
    expect(drift.some(d => d.operationId === 'op2')).toBe(true)
  })

  // ── v0.13: kind-aware binding ──────────────────────────────────────
  it('computeExpectedBindings excludes non-openapi-http domains', () => {
    const cliDomain: DomainMatrix = {
      domain: 'cli',
      metadata: { kind: 'cli-tool' },
      personas: [{
        id: 'cli-p',
        status: 'implemented',
        identity: { actor: 'framework-developer', data: 'PersonaMatrix', intent: 'validate', trigger: 'pre-commit', consumer: 'internal-tool' },
        // Synthetic operationId — must not leak into HTTP bindings
        outcome: { maps_to: ['cli:validate'] },
      }],
    }
    const bindings = computeExpectedBindings([...fixtureDomains, cliDomain])
    expect(bindings.has('cli:validate')).toBe(false)
    // HTTP bindings still produced
    expect(bindings.has('op1')).toBe(true)
  })
})
