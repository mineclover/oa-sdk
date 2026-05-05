/**
 * v0.11.5 — persona profile (saved query bundle).
 *
 * Profile = 페르소나 query 결과를 yaml로 저장한 재사용 단위. RPG 캐릭터의
 * "skill loadout"처럼 stakeholder가 보유한 페르소나 set을 표현.
 *
 * 4 가지 정의 방식 조합:
 *   - selector  : 동적 매칭 (status / 도메인 / identity·reference·outcome·skills)
 *   - personas  : 명시적 id 추가 (selector 결과에 union)
 *   - extends   : 다른 profile 흡수 (재귀 expand)
 *   - exclude   : 결과에서 빠질 id
 *
 * Pure: no I/O. expandProfile은 매트릭스를 받아 페르소나 id set 반환.
 */

import type { DomainMatrix, Persona, PersonaProfile, ProfileSelector } from './types.js'

export interface ExpandOptions {
  domains: DomainMatrix[]
  /** 다른 profile들을 id → PersonaProfile 형태로 — extends 해석에 필요. */
  profiles?: Map<string, PersonaProfile>
}

/**
 * Profile을 페르소나 id 집합으로 expand.
 * 알고리즘:
 *   1. selector 매칭 결과 수집
 *   2. personas 명시 추가
 *   3. extends 재귀 expand union (사이클 방지)
 *   4. exclude 차감
 *   5. 정렬 + dedupe
 */
export function expandProfile(profile: PersonaProfile, opts: ExpandOptions): string[] {
  return [...expandRec(profile, opts, new Set())].sort()
}

function expandRec(
  profile: PersonaProfile,
  opts: ExpandOptions,
  visited: Set<string>,
): Set<string> {
  if (visited.has(profile.id)) return new Set()       // cycle protection
  visited.add(profile.id)

  const result = new Set<string>()
  const allPersonas = opts.domains.flatMap(m => m.personas.map(p => ({ persona: p, domain: m.domain })))

  // 1. selector
  if (profile.selector) {
    for (const { persona, domain } of allPersonas) {
      if (matchesSelector(persona, domain, profile.selector)) {
        result.add(persona.id)
      }
    }
  }

  // 2. explicit personas
  for (const id of profile.personas ?? []) result.add(id)

  // 3. extends — recursive
  if (profile.extends && opts.profiles) {
    for (const ref of profile.extends) {
      const target = opts.profiles.get(ref)
      if (!target) continue
      for (const id of expandRec(target, opts, visited)) result.add(id)
    }
  }

  // 4. exclude
  for (const id of profile.exclude ?? []) result.delete(id)

  return result
}

export function matchesSelector(persona: Persona, domain: string, sel: ProfileSelector): boolean {
  // 모든 조건 AND
  if (sel.status && !sel.status.includes(persona.status)) return false
  if (sel.domain && !sel.domain.includes(domain)) return false

  if (sel.actor && !sel.actor.includes(persona.identity.actor)) return false
  if (sel.intent && !sel.intent.includes(persona.identity.intent)) return false
  if (sel.trigger && !sel.trigger.includes(persona.identity.trigger)) return false
  if (sel.consumer && (!persona.identity.consumer || !sel.consumer.includes(persona.identity.consumer))) return false
  if (sel.proficiency && (!persona.identity.proficiency || !sel.proficiency.includes(persona.identity.proficiency))) return false

  if (sel.regulation && !arrayOverlap(persona.reference?.regulation, sel.regulation)) return false
  if (sel.channel && !arrayOverlap(persona.reference?.channel, sel.channel)) return false
  if (sel.region && !arrayOverlap(persona.reference?.region, sel.region)) return false
  if (sel.compliance_framework && !arrayOverlap(persona.reference?.compliance_framework, sel.compliance_framework)) return false

  if (sel.shape && (!persona.outcome?.shape || !sel.shape.includes(persona.outcome.shape))) return false
  if (sel.access && !arrayOverlap(persona.outcome?.access, sel.access)) return false

  // v0.11 P3 — skills는 AND (모든 명시 skill 보유)
  if (sel.skills && sel.skills.length > 0) {
    const personaSkills = new Set(persona.skills ?? [])
    if (!sel.skills.every(s => personaSkills.has(s))) return false
  }

  return true
}

function arrayOverlap(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length === 0) return false
  return b.some(x => a.includes(x))
}

// ─── markdown rendering ────────────────────────────────────────────────────

export function renderProfileMarkdown(
  profile: PersonaProfile,
  expanded: string[],
): string {
  const lines: string[] = []
  lines.push(`# Profile: ${profile.id}`)
  lines.push('')
  if (profile.description) {
    lines.push(profile.description)
    lines.push('')
  }
  lines.push(`- expanded personas: **${expanded.length}**`)
  if (profile.selector) {
    const keys = Object.keys(profile.selector).filter(k => {
      const v = (profile.selector as Record<string, unknown>)[k]
      return Array.isArray(v) ? v.length > 0 : v !== undefined
    })
    if (keys.length > 0) lines.push(`- selector keys: ${keys.map(k => `\`${k}\``).join(', ')}`)
  }
  if (profile.extends && profile.extends.length > 0) {
    lines.push(`- extends: ${profile.extends.map(e => `\`${e}\``).join(', ')}`)
  }
  if (profile.exclude && profile.exclude.length > 0) {
    lines.push(`- excluded: ${profile.exclude.map(e => `\`${e}\``).join(', ')}`)
  }
  lines.push('')
  lines.push('## Personas in this profile')
  lines.push('')
  for (const id of expanded) lines.push(`- \`${id}\``)
  return lines.join('\n') + '\n'
}
