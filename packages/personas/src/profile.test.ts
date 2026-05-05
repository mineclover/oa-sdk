/**
 * v0.11.5 profile — smoke tests.
 */

import { describe, expect, it } from 'vitest'
import { expandProfile, matchesSelector } from './profile.js'
import { loadAllDomains, loadAllProfiles, loadProfile } from './load.js'
import type { DomainMatrix, PersonaProfile } from './types.js'

describe('profile — bundled', () => {
  const domains = loadAllDomains()
  const profiles = loadAllProfiles()
  const profileMap = new Map(profiles.map(p => [p.id, p]))

  it('all 5 sample profiles load', () => {
    expect(profiles.length).toBe(5)
    expect(profiles.map(p => p.id).sort()).toEqual([
      'audit-required',
      'b2b-customer-suite',
      'infra-ops-monitoring',
      'mobile-app',
      'pipa-compliance',
    ])
  })

  it('mobile-app expands to multiple personas', () => {
    const m = loadProfile('mobile-app')
    const expanded = expandProfile(m, { domains, profiles: profileMap })
    expect(expanded.length).toBeGreaterThan(0)
    // mobile-app channel personas should include user-self-read
    expect(expanded).toContain('user-self-read')
  })

  it('pipa-compliance includes all PIPA-tagged personas', () => {
    const p = loadProfile('pipa-compliance')
    const expanded = expandProfile(p, { domains, profiles: profileMap })
    expect(expanded).toContain('admin-monitor')
    expect(expanded).toContain('guest-signup')      // PIPA에 적용된 register persona
  })

  it('audit-required uses skill-based selector', () => {
    const p = loadProfile('audit-required')
    const expanded = expandProfile(p, { domains, profiles: profileMap })
    expect(expanded.length).toBeGreaterThan(0)
    // every result must have audit-emission skill
    const allPersonas = domains.flatMap(m => m.personas)
    for (const id of expanded) {
      const persona = allPersonas.find(p => p.id === id)
      expect(persona?.skills).toContain('audit-emission')
    }
  })

  it('infra-ops-monitoring is a small focused set', () => {
    const p = loadProfile('infra-ops-monitoring')
    const expanded = expandProfile(p, { domains, profiles: profileMap })
    expect(expanded).toContain('ops-liveness-check')
    expect(expanded).toContain('ops-readiness-check')
  })
})

describe('profile — synthetic', () => {
  const domains: DomainMatrix[] = [{
    domain: 'fake',
    personas: [
      { id: 'a', status: 'implemented', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, skills: ['pagination', 'audit-emission'] },
      { id: 'b', status: 'implemented', identity: { actor: 'user', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, skills: ['pagination'] },
      { id: 'c', status: 'proposed', identity: { actor: 'guest', data: 'X', intent: 'list', trigger: 'ops-monitoring' } },
    ],
  }]

  it('selector with skills (AND) — all skills must be present', () => {
    const profile: PersonaProfile = {
      id: 'p',
      selector: { skills: ['pagination', 'audit-emission'] },
    }
    expect(expandProfile(profile, { domains })).toEqual(['a'])
  })

  it('selector with status filter', () => {
    const profile: PersonaProfile = {
      id: 'p',
      selector: { status: ['proposed'] },
    }
    expect(expandProfile(profile, { domains })).toEqual(['c'])
  })

  it('explicit personas + selector are union', () => {
    const profile: PersonaProfile = {
      id: 'p',
      selector: { skills: ['audit-emission'] },     // matches: a
      personas: ['c'],                                 // adds: c
    }
    expect(expandProfile(profile, { domains })).toEqual(['a', 'c'])
  })

  it('exclude removes from result', () => {
    const profile: PersonaProfile = {
      id: 'p',
      selector: { skills: ['pagination'] },           // matches: a, b
      exclude: ['b'],
    }
    expect(expandProfile(profile, { domains })).toEqual(['a'])
  })

  it('extends recursively merges', () => {
    const child: PersonaProfile = { id: 'child', selector: { actor: ['admin'] } }   // matches: a
    const parent: PersonaProfile = {
      id: 'parent',
      selector: { actor: ['user'] },                  // matches: b
      extends: ['child'],
    }
    const map = new Map([['child', child], ['parent', parent]])
    expect(expandProfile(parent, { domains, profiles: map })).toEqual(['a', 'b'])
  })

  it('extends cycle is silently bounded (no infinite loop)', () => {
    const a: PersonaProfile = { id: 'a', extends: ['b'] }
    const b: PersonaProfile = { id: 'b', extends: ['a'] }
    const map = new Map([['a', a], ['b', b]])
    // expandProfile uses visited-set to break cycles
    expect(expandProfile(a, { domains, profiles: map })).toEqual([])
  })

  it('matchesSelector — array fields use OR (any-of)', () => {
    const persona = domains[0]!.personas[0]!
    expect(matchesSelector(persona, 'fake', { actor: ['admin', 'user'] })).toBe(true)
    expect(matchesSelector(persona, 'fake', { actor: ['guest'] })).toBe(false)
  })
})
