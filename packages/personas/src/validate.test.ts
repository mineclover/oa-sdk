/**
 * v0.1 validator — smoke tests.
 *
 * Verifies the bundled registry + traits + 4 domain matrices validate cleanly,
 * and that the major rule branches (PK collision, unknown vocab, missing
 * operationId) actually fire when violated.
 */

import { describe, expect, it } from 'vitest'

import { loadAllDomains, loadAllTraits, loadOperationsFromMergedSpec, loadRegistry } from './load.js'
import type { DomainMatrix, Persona } from './types.js'
import { validate } from './validate.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const mergedSpecPath = join(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')

describe('personas v0.1 validator', () => {
  const registry = loadRegistry()
  const traits = loadAllTraits(registry)
  const domains = loadAllDomains()
  const knownOperations = loadOperationsFromMergedSpec(mergedSpecPath)

  it('bundled matrices validate without error', () => {
    const report = validate({ registry, traits, domains,  knownOperations })
    expect(report.ok).toBe(true)
    expect(report.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(report.personaCount).toBeGreaterThan(0)
    expect(report.implementedCount).toBeGreaterThan(0)
  })

  it('detects identity PK collision', () => {
    const dup: Persona = {
      id: 'dup-1',
      status: 'proposed',
      identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
    }
    const dup2: Persona = { ...dup, id: 'dup-2' }
    const matrix: DomainMatrix = { domain: 'fake', personas: [dup, dup2] }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i => i.severity === 'error' && i.message.includes('identity PK collides'))).toBe(true)
  })

  it('detects unknown vocabulary value', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'bad-actor',
        status: 'proposed',
        identity: { actor: 'not-a-real-actor', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.bucket === 'identity' &&
      i.dimension === 'actor' &&
      i.message.includes('not in vocabulary'),
    )).toBe(true)
  })

  it('detects missing operationId for implemented row', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'phantom',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['ghostOperation'] },
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.dimension === 'maps_to' &&
      i.message.includes("'ghostOperation'"),
    )).toBe(true)
  })

  it('allows implemented row with empty maps_to to surface as error', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'no-mapping',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.dimension === 'maps_to' &&
      i.message.includes('requires at least one operationId'),
    )).toBe(true)
  })

  it('proposed rows do not require maps_to', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'future',
        status: 'proposed',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.filter(i => i.severity === 'error')).toEqual([])
  })

  it('enforces guest-cannot-hard-delete constraint (only on success codes)', () => {
    // Constraint fires when actor=guest + intent=hard-delete + expects success (2XX)
    const successAttempt: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'rogue-guest',
        status: 'proposed',
        identity: { actor: 'guest', data: 'X', intent: 'hard-delete', trigger: 'ops-monitoring' },
        outcome: { expects: [204] },     // claims successful deletion as guest — forbidden
      }],
    }
    const report = validate({ registry, traits, domains: [successAttempt], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.personaId === 'rogue-guest' &&
      i.message.includes('guest-cannot-hard-delete'),
    )).toBe(true)
  })

  it('v0.11 rule #15: skill values must be in vocabulary', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'unknown-skill',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        skills: ['pagination', 'not-a-real-skill'],
        outcome: { maps_to: ['op1'], expects: [200] },
      }],
    }
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/x', method: 'get', responses: new Set(['200']) }]])
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.message.includes("skill 'not-a-real-skill' not in vocabulary"),
    )).toBe(true)
  })

  it('v0.10.5: pipa-requires-kr-region constraint — error when KR missing', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'pipa-without-kr',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        reference: { regulation: ['pii-kr-pipa'] },
        outcome: { maps_to: ['op1'], expects: [200] },
      }],
    }
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/x', method: 'get', responses: new Set(['200']) }]])
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.message.includes('pipa-requires-kr-region'),
    )).toBe(true)
  })

  it('v0.10.5: gdpr-requires-eu-region constraint — error when EU missing', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'gdpr-without-eu',
        status: 'implemented',
        identity: { actor: 'owner-self', data: 'X', intent: 'export', trigger: 'gdpr-portability' },
        reference: { regulation: ['pii-gdpr'], region: ['KR'] },     // wrong region for GDPR
        outcome: { maps_to: ['op1'], expects: [200] },
      }],
    }
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/x', method: 'get', responses: new Set(['200']) }]])
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.message.includes('gdpr-requires-eu-region'),
    )).toBe(true)
  })

  it('does not fire guest-cannot-hard-delete when expects is a denied response', () => {
    // negative-path: guest tries to delete, gets 401 — allowed (real-world spec coverage)
    const deniedAttempt: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'guest-tries-delete-and-fails',
        status: 'proposed',
        identity: { actor: 'guest', data: 'X', intent: 'hard-delete', trigger: 'ops-monitoring' },
        outcome: { expects: [401] },     // properly denied — should NOT trigger constraint
      }],
    }
    const report = validate({ registry, traits, domains: [deniedAttempt], knownOperations: new Map() })
    expect(report.issues.some(i => i.message.includes('guest-cannot-hard-delete'))).toBe(false)
  })

  it('dedupes unsupported-predicate warnings (one per constraint, not per persona)', () => {
    // synthetic constraint that uses an unsupported predicate path
    const synthRegistry = {
      ...registry,
      constraints: [
        {
          id: 'synthetic-unsupported',
          when: { 'unknown.dimension': 'whatever' },
          forbid: true,
          severity: 'warn' as const,
        },
      ],
    }
    const report = validate({ registry: synthRegistry, traits, domains, knownOperations })
    const skipWarns = report.issues.filter(i =>
      i.severity === 'warn' &&
      i.message.includes("'synthetic-unsupported' skipped"),
    )
    expect(skipWarns.length).toBe(1)
  })

  it('rule 8: expects status code must be declared in operation responses', () => {
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/op1', method: 'get', responses: new Set(['200', '404']) }]])
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'wrong-status',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1'], expects: [200, 418] },     // 418 not declared
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.dimension === 'expects' &&
      i.message.includes('418'),
    )).toBe(true)
  })

  it('rule 8: warns when implemented persona has no expects', () => {
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/op1', method: 'get', responses: new Set(['200']) }]])
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'no-expects',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1'] },     // no expects
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.some(i =>
      i.severity === 'warn' &&
      i.dimension === 'expects' &&
      i.message.includes('no expects'),
    )).toBe(true)
  })

  it('rule 8: range "2XX" satisfies expects 200', () => {
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/op1', method: 'get', responses: new Set(['2XX']) }]])
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'range-match',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1'], expects: [200] },
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.filter(i => i.severity === 'error' && i.dimension === 'expects')).toEqual([])
  })

  it('rule 8: "default" satisfies any expects', () => {
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/op1', method: 'get', responses: new Set(['default']) }]])
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'default-match',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1'], expects: [418] },
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.filter(i => i.severity === 'error' && i.dimension === 'expects')).toEqual([])
  })

  it('rule 8: expects matching declared status passes', () => {
    const synthOps = new Map([['op1', { operationId: 'op1', path: '/op1', method: 'get', responses: new Set(['200']) }]])
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['op1'], expects: [200] },
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: synthOps })
    expect(report.issues.filter(i => i.severity === 'error' && i.dimension === 'expects')).toEqual([])
  })

  it('rule 9: link target must reference an existing persona', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'p1',
        status: 'proposed',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        links: [{ linkType: 'depends_on', target: 'does-not-exist' }],
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.personaId === 'p1' &&
      i.message.includes("'does-not-exist'") &&
      i.message.includes('not a known persona id'),
    )).toBe(true)
  })

  it('rule 9: self-link is rejected', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [{
        id: 'p1',
        status: 'proposed',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        links: [{ linkType: 'refines', target: 'p1' }],
      }],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.message.includes('self-references not allowed'),
    )).toBe(true)
  })

  it('rule 9: depends_on cycles are detected', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [
        { id: 'a', status: 'proposed', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, links: [{ linkType: 'depends_on', target: 'b' }] },
        { id: 'b', status: 'proposed', identity: { actor: 'user', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, links: [{ linkType: 'depends_on', target: 'a' }] },
      ],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'error' &&
      i.domain === '(graph)' &&
      i.message.includes('depends_on cycle'),
    )).toBe(true)
  })

  it('rule 9: supersedes target should not be implemented', () => {
    const matrix: DomainMatrix = {
      domain: 'fake',
      personas: [
        { id: 'old', status: 'implemented', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' } },
        { id: 'new', status: 'implemented', identity: { actor: 'user', data: 'X', intent: 'list', trigger: 'user-support' }, links: [{ linkType: 'supersedes', target: 'old' }] },
      ],
    }
    const report = validate({ registry, traits, domains: [matrix], knownOperations: new Map() })
    expect(report.issues.some(i =>
      i.severity === 'warn' &&
      i.message.includes("supersedes target 'old' is still 'implemented'"),
    )).toBe(true)
  })

  it('drift detection fires when bound spec disagrees with matrices', async () => {
    const { applyBindings } = await import('./bind.js')
    const baseDoc = { info: {}, paths: { '/x': { get: { operationId: 'phantomOp' } } } }
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [{
        id: 'p',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        outcome: { maps_to: ['phantomOp'] },
      }],
    }]
    const bound = applyBindings(baseDoc, synthDomains, { registryVersion: '0.1' })
    // Now mutate the bound spec to simulate drift
    const op = bound.paths!['/x']!['get'] as { 'x-persona': string[] }
    op['x-persona'] = ['stale-id']

    const report = validate({
      registry,
      traits,
      domains: synthDomains,
      knownOperations: new Map([['phantomOp', { operationId: 'phantomOp', path: '/x', method: 'get', responses: new Set(['200']) }]]),
      boundSpec: bound,
    })
    expect(report.issues.some(i => i.severity === 'error' && i.message.includes('drift'))).toBe(true)
    expect(report.ok).toBe(false)
  })
})
