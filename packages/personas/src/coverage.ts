/**
 * v0.2 — bidirectional coverage + cross-cut analysis.
 *
 * Builds inverse maps from the persona matrix:
 *   operationId → personas         (forward — operation justification)
 *   actor       → operationIds     (cross-section)
 *   regulation  → operationIds     (cross-section — compliance footprint)
 *   channel     → operationIds     (cross-section — delivery surface)
 *
 * And surfaces:
 *   - unjustified operations (no implemented persona)
 *   - unmapped proposed personas (gap backlog)
 *
 * No spec mutation, no I/O. Pure data analysis over loaded matrices.
 */

import type { DomainMatrix, PersonaIdentity, PersonaStatus, TraitVocabulary, DataModelPersona } from './types.js'
import type { OperationInfo } from './load.js'
import { isHttpDomain } from './kind.js'

export interface OperationCoverageRow {
  operationId: string
  personas: Array<{
    domain: string
    personaId: string
    status: PersonaStatus
    actor: string
  }>
  actors: string[]
  regulations: string[]
  channels: string[]
  /** Status code keys declared in OpenAPI operation.responses (e.g. "200", "401"). */
  declaredResponses: string[]
  /** Status codes claimed by an implemented persona's outcome.expects. */
  expectedStatuses: string[]
  /** declaredResponses \ expectedStatuses \ acknowledged — un-modeled. */
  orphanResponses: string[]
  /** Status codes the persona matrix has explicitly acknowledged as intentional. */
  acknowledgedOrphanResponses: string[]
}

export interface AcknowledgedOrphanRow {
  domain: string
  operationId: string
  statusCode: string
  reason: string
}

export interface DataModelCoverageRow {
  entity: string
  /** Persona ids whose `identity.data` matches this entity (or a local variant). */
  personaIds: string[]
  /** True when entity declares pii: true in invariants. */
  pii: boolean
  /** True when invariants.audit.required_on is non-empty. */
  auditRequired: boolean
  regulations: string[]
}

export interface CrossSection {
  axis: 'actor' | 'regulation' | 'channel' | 'region' | 'compliance_framework'
  buckets: Array<{ value: string; operationIds: string[]; personaCount: number }>
}

export interface GapEntry {
  domain: string
  personaId: string
  status: PersonaStatus
  identity: PersonaIdentity
  notes?: string
}

export interface TriggerCategoryRow {
  category: string
  description?: string
  personaCount: number
  triggers: string[]      // distinct trigger ids in this category that are actually used
}

export interface CoverageReport {
  operations: OperationCoverageRow[]
  unjustifiedOperations: string[]
  unmappedPersonas: GapEntry[]
  actorCrossSection: CrossSection
  regulationCrossSection: CrossSection
  channelCrossSection: CrossSection
  /** v0.10: data residency / 법적 관할 cross-section */
  regionCrossSection: CrossSection
  /** v0.10: 조직 단위 인증 (SOC2/ISO27001/...) cross-section */
  complianceCrossSection: CrossSection
  /** Optional — only populated when triggerVocab is provided. */
  triggerCategories?: TriggerCategoryRow[]
  /** Triggers used by personas but missing from the vocabulary (drift signal). */
  unknownTriggers?: string[]
  /** Optional — only populated when consumerVocab is provided. */
  consumerCategories?: TriggerCategoryRow[]
  /** Consumer values used but missing from the vocabulary. */
  unknownConsumers?: string[]
  /** v0.11: skill capability tags cross-section (only when skillVocab provided). */
  skillCategories?: TriggerCategoryRow[]
  unknownSkills?: string[]
  /** Intentional orphans (e.g. infrastructure 500) — flat list across domains. */
  acknowledgedOrphans: AcknowledgedOrphanRow[]
  /** Optional — only populated when dataModels are provided. */
  dataModelCoverage?: DataModelCoverageRow[]
  totals: {
    domains: number
    personas: number
    implemented: number
    proposed: number
    deprecated: number
    operationsCovered: number
    operationsTotal: number
  }
}

export interface CoverageInput {
  domains: DomainMatrix[]
  /** All operations known to exist in .merged.yaml. Required for unjustified detection + status orphan analysis. */
  knownOperations: Map<string, OperationInfo>
  /** Optional — when provided, coverage includes a Trigger category cross-section. */
  triggerVocab?: TraitVocabulary
  /** Optional — when provided, coverage includes a Consumer category cross-section. */
  consumerVocab?: TraitVocabulary
  /** v0.11: when provided, coverage builds Skill capability cross-section. */
  skillVocab?: TraitVocabulary
  /** Optional — when provided, coverage builds entity → personas index. */
  dataModels?: DataModelPersona[]
}

export function analyzeCoverage(input: CoverageInput): CoverageReport {
  const opIndex = new Map<string, OperationCoverageRow>()
  for (const [id, info] of input.knownOperations.entries()) {
    opIndex.set(id, {
      operationId: id,
      personas: [],
      actors: [],
      regulations: [],
      channels: [],
      declaredResponses: [...info.responses].sort(),
      expectedStatuses: [],
      orphanResponses: [],
      acknowledgedOrphanResponses: [],
    })
  }

  // Collect acknowledged orphans across domains: operationId → Set<statusCode> + flat rows
  const acknowledgedSet = new Map<string, Set<string>>()
  const acknowledgedRows: AcknowledgedOrphanRow[] = []
  for (const m of input.domains) {
    for (const ack of m.acknowledged_orphans ?? []) {
      let set = acknowledgedSet.get(ack.operationId)
      if (!set) {
        set = new Set()
        acknowledgedSet.set(ack.operationId, set)
      }
      set.add(ack.statusCode)
      acknowledgedRows.push({
        domain: m.domain,
        operationId: ack.operationId,
        statusCode: ack.statusCode,
        reason: ack.reason,
      })
    }
  }

  const actorOps = new Map<string, Set<string>>()
  const actorPersonaCount = new Map<string, number>()
  const regulationOps = new Map<string, Set<string>>()
  const regulationPersonaCount = new Map<string, number>()
  const channelOps = new Map<string, Set<string>>()
  const channelPersonaCount = new Map<string, number>()
  const regionOps = new Map<string, Set<string>>()
  const regionPersonaCount = new Map<string, number>()
  const complianceOps = new Map<string, Set<string>>()
  const compliancePersonaCount = new Map<string, number>()

  const unmapped: GapEntry[] = []
  const totals = { domains: input.domains.length, personas: 0, implemented: 0, proposed: 0, deprecated: 0, operationsCovered: 0, operationsTotal: input.knownOperations.size }

  for (const matrix of input.domains) {
    // v0.13: only openapi-http domains participate in maps_to coverage tracking.
    // cli-tool / library-api / event-stream personas have synthetic operationIds (or none),
    // so "unmapped" doesn't apply.
    const matrixIsHttp = isHttpDomain(matrix)
    for (const persona of matrix.personas) {
      totals.personas++
      if (persona.status === 'implemented') totals.implemented++
      else if (persona.status === 'proposed') totals.proposed++
      else if (persona.status === 'deprecated') totals.deprecated++

      const actor = persona.identity?.actor ?? '(missing)'
      const regulations = persona.reference?.regulation ?? []
      const channels = persona.reference?.channel ?? []
      const regions = persona.reference?.region ?? []
      const compliances = persona.reference?.compliance_framework ?? []
      const ids = persona.outcome?.maps_to ?? []

      // unmapped tracking — proposed without operation, or deprecated still mapped
      // (skip non-openapi-http surfaces — they don't have operationIds to map to)
      if (matrixIsHttp && persona.status === 'proposed' && ids.length === 0) {
        const entry: GapEntry = {
          domain: matrix.domain,
          personaId: persona.id,
          status: persona.status,
          identity: persona.identity,
        }
        if (persona.notes !== undefined) entry.notes = persona.notes
        unmapped.push(entry)
      }

      // forward: operation row aggregation (only implemented personas justify a surface)
      if (persona.status === 'implemented') {
        const expects = (persona.outcome?.expects ?? []).map(String)
        for (const id of ids) {
          const row = opIndex.get(id)
          if (!row) continue   // unknown operationId — validator separately surfaces this
          row.personas.push({ domain: matrix.domain, personaId: persona.id, status: persona.status, actor })
          if (!row.actors.includes(actor)) row.actors.push(actor)
          for (const r of regulations) if (!row.regulations.includes(r)) row.regulations.push(r)
          for (const c of channels) if (!row.channels.includes(c)) row.channels.push(c)
          for (const code of expects) if (!row.expectedStatuses.includes(code)) row.expectedStatuses.push(code)
        }
      }

      // cross-sections: aggregate operationIds and persona counts
      // (consider all statuses for reference dimensions — proposed personas tell us coverage *intent*)
      bumpCount(actorPersonaCount, actor)
      for (const r of regulations) bumpCount(regulationPersonaCount, r)
      for (const c of channels) bumpCount(channelPersonaCount, c)
      for (const r of regions) bumpCount(regionPersonaCount, r)
      for (const f of compliances) bumpCount(compliancePersonaCount, f)

      // for the operation set side, only count implemented mappings (real surface)
      if (persona.status === 'implemented') {
        for (const id of ids) {
          addToSet(actorOps, actor, id)
          for (const r of regulations) addToSet(regulationOps, r, id)
          for (const c of channels) addToSet(channelOps, c, id)
          for (const r of regions) addToSet(regionOps, r, id)
          for (const f of compliances) addToSet(complianceOps, f, id)
        }
      }
    }
  }

  // unjustified: operationId with no implemented persona
  const unjustifiedOperations: string[] = []
  for (const [id, row] of opIndex.entries()) {
    if (row.personas.length === 0) unjustifiedOperations.push(id)
    // orphan responses: declared in spec but no persona expects them, minus acknowledged
    const acked = acknowledgedSet.get(id) ?? new Set<string>()
    row.expectedStatuses.sort()
    row.acknowledgedOrphanResponses = row.declaredResponses.filter(c => acked.has(c))
    row.orphanResponses = row.declaredResponses.filter(
      c => !row.expectedStatuses.includes(c) && !acked.has(c),
    )
  }
  unjustifiedOperations.sort()

  totals.operationsCovered = totals.operationsTotal - unjustifiedOperations.length

  acknowledgedRows.sort((a, b) =>
    a.domain.localeCompare(b.domain) ||
    a.operationId.localeCompare(b.operationId) ||
    a.statusCode.localeCompare(b.statusCode),
  )

  const report: CoverageReport = {
    operations: [...opIndex.values()].sort((a, b) => a.operationId.localeCompare(b.operationId)),
    unjustifiedOperations,
    unmappedPersonas: unmapped,
    actorCrossSection: buildCrossSection('actor', actorOps, actorPersonaCount),
    regulationCrossSection: buildCrossSection('regulation', regulationOps, regulationPersonaCount),
    channelCrossSection: buildCrossSection('channel', channelOps, channelPersonaCount),
    regionCrossSection: buildCrossSection('region', regionOps, regionPersonaCount),
    complianceCrossSection: buildCrossSection('compliance_framework', complianceOps, compliancePersonaCount),
    acknowledgedOrphans: acknowledgedRows,
    totals,
  }

  if (input.triggerVocab) {
    const { categories: triggerCategories, unknownValues } = buildIdentityCategoryView(
      input.domains, input.triggerVocab, p => p.identity?.trigger,
    )
    report.triggerCategories = triggerCategories
    if (unknownValues.length > 0) report.unknownTriggers = unknownValues
  }

  if (input.consumerVocab) {
    const { categories: consumerCategories, unknownValues } = buildIdentityCategoryView(
      input.domains, input.consumerVocab, p => p.identity?.consumer,
    )
    report.consumerCategories = consumerCategories
    if (unknownValues.length > 0) report.unknownConsumers = unknownValues
  }

  if (input.skillVocab) {
    // skills field가 array — 카테고리별로 펼쳐서 카운트
    const { categories: skillCategories, unknownValues } = buildSkillCategoryView(
      input.domains, input.skillVocab,
    )
    report.skillCategories = skillCategories
    if (unknownValues.length > 0) report.unknownSkills = unknownValues
  }

  if (input.dataModels && input.dataModels.length > 0) {
    report.dataModelCoverage = buildDataModelCoverage(input.domains, input.dataModels)
  }

  return report
}

function buildDataModelCoverage(domains: DomainMatrix[], models: DataModelPersona[]): DataModelCoverageRow[] {
  return models.map(model => {
    const variants = new Set<string>([
      model.entity,
      ...((model.local_variants ?? []).map(v => v.id)),
    ])
    const personaIds: string[] = []
    for (const m of domains) {
      for (const p of m.personas) {
        const data = p.identity?.data
        if (!data) continue
        // Match exact or "Entity(...)" prefix variant
        if (variants.has(data) || data.startsWith(`${model.entity}(`)) {
          personaIds.push(p.id)
        }
      }
    }
    const inv = (model.invariants ?? {}) as Record<string, unknown>
    const auditObj = inv['audit'] as Record<string, unknown> | undefined
    const requiredOn = (auditObj?.['required_on'] as unknown[] | undefined) ?? []
    return {
      entity: model.entity,
      personaIds: personaIds.sort(),
      pii: inv['pii'] === true,
      auditRequired: requiredOn.length > 0,
      regulations: (model.regulations ?? []) as string[],
    }
  }).sort((a, b) => a.entity.localeCompare(b.entity))
}

/**
 * v0.11: skills는 array field — buildIdentityCategoryView과 달리 한 페르소나가 여러 값.
 * 각 skill 등장마다 한 번씩 카운트.
 */
function buildSkillCategoryView(
  domains: DomainMatrix[],
  vocab: TraitVocabulary,
): { categories: TriggerCategoryRow[]; unknownValues: string[] } {
  const valueToCategory = new Map<string, string>()
  for (const v of vocab.values) {
    if (v.category) valueToCategory.set(v.id, v.category)
  }
  const categoryDefs = vocab.categories ?? []

  const counts = new Map<string, { personas: number; values: Set<string> }>()
  for (const cat of categoryDefs) counts.set(cat.id, { personas: 0, values: new Set() })

  const unknown = new Set<string>()
  for (const m of domains) {
    for (const p of m.personas) {
      const skills = p.skills ?? []
      const seenCats = new Set<string>()
      for (const s of skills) {
        const cat = valueToCategory.get(s)
        if (!cat) {
          unknown.add(s)
          continue
        }
        let bucket = counts.get(cat)
        if (!bucket) {
          bucket = { personas: 0, values: new Set() }
          counts.set(cat, bucket)
        }
        bucket.values.add(s)
        if (!seenCats.has(cat)) {
          // 한 페르소나가 같은 카테고리에 여러 skill을 가지면 personas는 1로만 카운트
          bucket.personas++
          seenCats.add(cat)
        }
      }
    }
  }

  const categories: TriggerCategoryRow[] = categoryDefs.map(cat => {
    const c = counts.get(cat.id) ?? { personas: 0, values: new Set<string>() }
    const row: TriggerCategoryRow = {
      category: cat.id,
      personaCount: c.personas,
      triggers: [...c.values].sort(),
    }
    if (cat.description) row.description = cat.description
    return row
  })
  return { categories, unknownValues: [...unknown].sort() }
}

function buildIdentityCategoryView(
  domains: DomainMatrix[],
  vocab: TraitVocabulary,
  pick: (p: { identity?: PersonaIdentity }) => string | undefined,
): { categories: TriggerCategoryRow[]; unknownValues: string[] } {
  const valueToCategory = new Map<string, string>()
  for (const v of vocab.values) {
    if (v.category) valueToCategory.set(v.id, v.category)
  }
  const categoryDefs = vocab.categories ?? []

  const counts = new Map<string, { personas: number; values: Set<string> }>()
  for (const cat of categoryDefs) counts.set(cat.id, { personas: 0, values: new Set() })

  const unknown = new Set<string>()
  for (const m of domains) {
    for (const p of m.personas) {
      const value = pick(p)
      if (!value) continue
      const cat = valueToCategory.get(value)
      if (!cat) {
        unknown.add(value)
        continue
      }
      let bucket = counts.get(cat)
      if (!bucket) {
        bucket = { personas: 0, values: new Set() }
        counts.set(cat, bucket)
      }
      bucket.personas++
      bucket.values.add(value)
    }
  }

  const categories: TriggerCategoryRow[] = categoryDefs.map(cat => {
    const c = counts.get(cat.id) ?? { personas: 0, values: new Set<string>() }
    const row: TriggerCategoryRow = {
      category: cat.id,
      personaCount: c.personas,
      triggers: [...c.values].sort(),
    }
    if (cat.description) row.description = cat.description
    return row
  })
  return { categories, unknownValues: [...unknown].sort() }
}

function bumpCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

function addToSet(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key)
  if (!set) {
    set = new Set()
    map.set(key, set)
  }
  set.add(value)
}

function buildCrossSection(
  axis: CrossSection['axis'],
  ops: Map<string, Set<string>>,
  personaCounts: Map<string, number>,
): CrossSection {
  const allKeys = new Set<string>([...ops.keys(), ...personaCounts.keys()])
  const buckets = [...allKeys]
    .map(value => ({
      value,
      operationIds: [...(ops.get(value) ?? new Set<string>())].sort(),
      personaCount: personaCounts.get(value) ?? 0,
    }))
    .sort((a, b) => b.operationIds.length - a.operationIds.length || a.value.localeCompare(b.value))
  return { axis, buckets }
}

// ─── markdown rendering ────────────────────────────────────────────────────

export function renderMarkdown(report: CoverageReport): string {
  const lines: string[] = []
  const t = report.totals
  lines.push('# Personas Coverage Report')
  lines.push('')
  lines.push(`- domains: **${t.domains}**`)
  lines.push(`- personas: **${t.personas}** (${t.implemented} implemented · ${t.proposed} proposed · ${t.deprecated} deprecated)`)
  lines.push(`- operations: **${t.operationsCovered}/${t.operationsTotal} covered** by an implemented persona`)
  lines.push(`- unjustified surface: **${report.unjustifiedOperations.length}**`)
  lines.push(`- gap backlog (proposed without maps_to): **${report.unmappedPersonas.length}**`)
  lines.push(`- acknowledged orphans (intentional): **${report.acknowledgedOrphans.length}**`)
  lines.push('')

  lines.push('## Operation coverage')
  lines.push('')
  lines.push('| operationId | personas | actors | regulations | channels |')
  lines.push('|---|---:|---|---|---|')
  for (const row of report.operations) {
    const actors = row.personas.length === 0 ? '_(unjustified)_' : row.actors.join(', ')
    lines.push(`| \`${row.operationId}\` | ${row.personas.length} | ${actors} | ${row.regulations.join(', ') || '—'} | ${row.channels.join(', ') || '—'} |`)
  }
  lines.push('')

  lines.push('## Response status coverage')
  lines.push('')
  lines.push('Status codes declared in OpenAPI vs. claimed by an implemented persona\'s `outcome.expects`. ')
  lines.push('Orphans = declared response but no persona ever expects it → either author a negative-path persona or remove the unused response.')
  lines.push('')
  lines.push('| operationId | declared | persona-expected | orphans |')
  lines.push('|---|---|---|---|')
  for (const row of report.operations) {
    const declared = row.declaredResponses.join(', ') || '—'
    const expected = row.expectedStatuses.join(', ') || '_(none)_'
    const orphanParts: string[] = []
    if (row.orphanResponses.length > 0) orphanParts.push(...row.orphanResponses.map(c => `\`${c}\``))
    if (row.acknowledgedOrphanResponses.length > 0) {
      orphanParts.push(...row.acknowledgedOrphanResponses.map(c => `\`${c}\` _(ack)_`))
    }
    const orphans = orphanParts.length === 0 ? '—' : orphanParts.join(', ')
    lines.push(`| \`${row.operationId}\` | ${declared} | ${expected} | ${orphans} |`)
  }
  lines.push('')

  if (report.unjustifiedOperations.length > 0) {
    lines.push('## Unjustified operations')
    lines.push('')
    lines.push('Operations present in spec but no `implemented` persona claims them. Either author a persona or remove the surface.')
    lines.push('')
    for (const id of report.unjustifiedOperations) {
      lines.push(`- \`${id}\``)
    }
    lines.push('')
  }

  lines.push('## Actor cross-section')
  lines.push('')
  lines.push('| actor | operations | personas |')
  lines.push('|---|---|---:|')
  for (const b of report.actorCrossSection.buckets) {
    lines.push(`| \`${b.value}\` | ${b.operationIds.map(o => `\`${o}\``).join(', ') || '—'} | ${b.personaCount} |`)
  }
  lines.push('')

  lines.push('## Regulation cross-section')
  lines.push('')
  if (report.regulationCrossSection.buckets.length === 0) {
    lines.push('_No regulation tags applied._')
  } else {
    lines.push('| regulation | operations | personas |')
    lines.push('|---|---|---:|')
    for (const b of report.regulationCrossSection.buckets) {
      lines.push(`| \`${b.value}\` | ${b.operationIds.map(o => `\`${o}\``).join(', ') || '—'} | ${b.personaCount} |`)
    }
  }
  lines.push('')

  lines.push('## Channel cross-section')
  lines.push('')
  if (report.regionCrossSection.buckets.length > 0) {
    lines.push('## Region cross-section')
    lines.push('')
    lines.push('데이터 residency / 법적 관할. 미설정 페르소나는 region-agnostic.')
    lines.push('')
    lines.push('| region | operations | personas |')
    lines.push('|---|---|---:|')
    for (const b of report.regionCrossSection.buckets) {
      lines.push(`| \`${b.value}\` | ${b.operationIds.map(o => `\`${o}\``).join(', ') || '—'} | ${b.personaCount} |`)
    }
    lines.push('')
  }

  if (report.complianceCrossSection.buckets.length > 0) {
    lines.push('## Compliance framework cross-section')
    lines.push('')
    lines.push('조직 단위 인증 (SOC2/ISO27001/HIPAA …). regulation(법)과 직교.')
    lines.push('')
    lines.push('| framework | operations | personas |')
    lines.push('|---|---|---:|')
    for (const b of report.complianceCrossSection.buckets) {
      lines.push(`| \`${b.value}\` | ${b.operationIds.map(o => `\`${o}\``).join(', ') || '—'} | ${b.personaCount} |`)
    }
    lines.push('')
  }

  if (report.channelCrossSection.buckets.length === 0) {
    lines.push('_No channel tags applied._')
  } else {
    lines.push('| channel | operations | personas |')
    lines.push('|---|---|---:|')
    for (const b of report.channelCrossSection.buckets) {
      lines.push(`| \`${b.value}\` | ${b.operationIds.map(o => `\`${o}\``).join(', ') || '—'} | ${b.personaCount} |`)
    }
  }
  lines.push('')

  if (report.acknowledgedOrphans.length > 0) {
    lines.push('## Acknowledged orphans (intentional)')
    lines.push('')
    lines.push('Status codes declared in spec but intentionally not modeled as personas. These are acknowledged via `acknowledged_orphans` in the persona matrix.')
    lines.push('')
    lines.push('| domain | operation | status | reason |')
    lines.push('|---|---|---|---|')
    for (const r of report.acknowledgedOrphans) {
      lines.push(`| ${r.domain} | \`${r.operationId}\` | \`${r.statusCode}\` | ${r.reason.replace(/\|/g, '\\|')} |`)
    }
    lines.push('')
  }

  if (report.triggerCategories && report.triggerCategories.length > 0) {
    lines.push('## Trigger category coverage')
    lines.push('')
    lines.push('| category | personas | distinct triggers |')
    lines.push('|---|---:|---|')
    for (const row of report.triggerCategories) {
      lines.push(`| \`${row.category}\` | ${row.personaCount} | ${row.triggers.map(t => `\`${t}\``).join(', ') || '—'} |`)
    }
    lines.push('')
    if (report.unknownTriggers && report.unknownTriggers.length > 0) {
      lines.push('### Unknown triggers (drift signal)')
      lines.push('')
      for (const t of report.unknownTriggers) lines.push(`- \`${t}\``)
      lines.push('')
    }
  }

  if (report.skillCategories && report.skillCategories.length > 0) {
    lines.push('## Skill capability cross-section')
    lines.push('')
    lines.push('페르소나 고유 보유 능력 (capability tags). 한 페르소나가 여러 카테고리에 걸쳐 skills 보유 가능.')
    lines.push('')
    lines.push('| category | personas | distinct skills |')
    lines.push('|---|---:|---|')
    for (const row of report.skillCategories) {
      lines.push(`| \`${row.category}\` | ${row.personaCount} | ${row.triggers.map(s => `\`${s}\``).join(', ') || '—'} |`)
    }
    lines.push('')
    if (report.unknownSkills && report.unknownSkills.length > 0) {
      lines.push('### Unknown skills (drift)')
      lines.push('')
      for (const s of report.unknownSkills) lines.push(`- \`${s}\``)
      lines.push('')
    }
  }

  if (report.consumerCategories && report.consumerCategories.length > 0) {
    lines.push('## Consumer category coverage')
    lines.push('')
    lines.push('Personas tagged by API-consumer perspective. Personas without explicit `consumer` are implicitly `end-user`.')
    lines.push('')
    lines.push('| category | personas | distinct consumers |')
    lines.push('|---|---:|---|')
    for (const row of report.consumerCategories) {
      lines.push(`| \`${row.category}\` | ${row.personaCount} | ${row.triggers.map(c => `\`${c}\``).join(', ') || '—'} |`)
    }
    lines.push('')
    if (report.unknownConsumers && report.unknownConsumers.length > 0) {
      lines.push('### Unknown consumers (drift signal)')
      lines.push('')
      for (const c of report.unknownConsumers) lines.push(`- \`${c}\``)
      lines.push('')
    }
  }

  if (report.dataModelCoverage && report.dataModelCoverage.length > 0) {
    lines.push('## Data model coverage')
    lines.push('')
    lines.push('Authored data-modeling personas (in `data-models/`) cross-referenced with API consumer personas.')
    lines.push('')
    lines.push('| entity | personas | PII | audit | regulations |')
    lines.push('|---|---:|:---:|:---:|---|')
    for (const row of report.dataModelCoverage) {
      const pii = row.pii ? '✓' : '—'
      const audit = row.auditRequired ? '✓' : '—'
      const regs = row.regulations.length === 0 ? '—' : row.regulations.map(r => `\`${r}\``).join(', ')
      lines.push(`| \`${row.entity}\` | ${row.personaIds.length} | ${pii} | ${audit} | ${regs} |`)
    }
    lines.push('')
  }

  if (report.unmappedPersonas.length > 0) {
    lines.push('## Gap backlog')
    lines.push('')
    lines.push('Proposed personas without an operation — next API surface candidates.')
    lines.push('')
    lines.push('| domain | persona | actor | data | intent | trigger | notes |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const g of report.unmappedPersonas) {
      const note = (g.notes ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 80)
      lines.push(`| ${g.domain} | \`${g.personaId}\` | ${g.identity.actor} | ${g.identity.data} | ${g.identity.intent} | ${g.identity.trigger} | ${note} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
