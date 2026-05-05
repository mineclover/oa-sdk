/**
 * Integration test — full pipeline:
 *   profiles + matrices + spec + mock client + e2e roleplay
 *
 * 검증 목적:
 *   1. profile expand → 페르소나 ids
 *   2. 각 id를 createPersonaMockClient.act() 로 시뮬레이션 → response
 *   3. 모든 response가 spec과 정합
 *
 * playground의 actual HTTP e2e와 별개로, 페르소나 매트릭스 데이터의
 * end-to-end 일관성을 단일 테스트에서 입증.
 */

import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

import {
  createPersonaMockClient,
  expandProfile,
  loadAllDomains,
  loadAllProfiles,
} from './index.js'
import type { MinimalOpenApiDoc } from './bind.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const mergedSpecPath = join(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')

describe('integration — profile × mock client × spec', () => {
  const spec = parse(readFileSync(mergedSpecPath, 'utf8')) as MinimalOpenApiDoc
  const domains = loadAllDomains()
  const profiles = loadAllProfiles()
  const profileMap = new Map(profiles.map(p => [p.id, p]))
  const client = createPersonaMockClient({ spec, domains })

  it('every persona in pipa-compliance profile resolves to a valid spec response', () => {
    const profile = profileMap.get('pipa-compliance')!
    const expanded = expandProfile(profile, { domains, profiles: profileMap })
    expect(expanded.length).toBeGreaterThan(0)

    for (const personaId of expanded) {
      const allPersonas = domains.flatMap(m => m.personas)
      const persona = allPersonas.find(p => p.id === personaId)
      if (!persona || !persona.outcome?.maps_to?.length) continue
      const opId = persona.outcome.maps_to[0]!
      const resolved = client.act(personaId, opId)
      expect(resolved, `${personaId} → ${opId} should resolve`).not.toBeNull()
      expect(resolved!.status, `${personaId} status`).toBeGreaterThanOrEqual(100)
    }
  })

  it('profile with skill selector matches personas that have ALL listed skills', () => {
    const profile = profileMap.get('audit-required')!
    const expanded = expandProfile(profile, { domains, profiles: profileMap })
    const allPersonas = domains.flatMap(m => m.personas)
    for (const id of expanded) {
      const persona = allPersonas.find(p => p.id === id)!
      expect(persona.skills, `${id} should have skills`).toBeDefined()
      expect(persona.skills).toContain('audit-emission')
    }
  })

  it('mobile-app profile + b2b profile have minimal overlap (different consumers)', () => {
    const mobile = expandProfile(profileMap.get('mobile-app')!, { domains, profiles: profileMap })
    const b2b = expandProfile(profileMap.get('b2b-customer-suite')!, { domains, profiles: profileMap })
    const overlap = mobile.filter(id => b2b.includes(id))
    // b2b-customer는 mobile-app channel을 포함하지 않으므로 거의 0
    expect(overlap.length).toBeLessThan(2)
  })

  it('profile expand is deterministic (sorted)', () => {
    for (const profile of profiles) {
      const a = expandProfile(profile, { domains, profiles: profileMap })
      const b = expandProfile(profile, { domains, profiles: profileMap })
      expect(a).toEqual(b)
      expect(a).toEqual([...a].sort())
    }
  })

  // v0.13: cli-tool persona's applyTo silently no-ops (synthetic opIds).
  it('mock-client.applyTo on a cli-tool persona returns empty (no HTTP overrides)', () => {
    const overrides: string[] = []
    const fakeServer = {
      override: (opId: string) => { overrides.push(opId) },
      clearOverride: () => {},
      clearOverrides: () => {},
    }
    // pick any persona from the personas-cli dogfood domain
    const cliPersonaId = 'dev-validates-pre-commit'
    const applied = client.applyTo(fakeServer, cliPersonaId)
    expect(applied).toEqual([])
    expect(overrides).toEqual([])
  })
})
