/**
 * v0.2 coverage analyzer — smoke tests.
 */

import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyzeCoverage, renderMarkdown } from './coverage.js'
import { loadAllDataModels, loadAllDomains, loadOperationsFromMergedSpec } from './load.js'
import type { DataModelPersona, DomainMatrix, TraitVocabulary } from './types.js'
import type { OperationInfo } from './load.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const mergedSpecPath = join(__dir, '..', '..', 'schemas', 'src', '.merged.yaml')

describe('coverage analyzer', () => {
  const domains = loadAllDomains()
  const knownOperations = loadOperationsFromMergedSpec(mergedSpecPath)
  if (knownOperations === null) throw new Error('merged spec required for coverage tests')

  it('every implemented persona maps to a known operation in the bundled matrices', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    expect(report.totals.operationsTotal).toBe(knownOperations.size)
    expect(report.totals.operationsCovered).toBe(knownOperations.size)
    expect(report.unjustifiedOperations).toEqual([])
  })

  it('proposed personas appear in gap backlog when maps_to is empty', () => {
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [{
        id: 'future-p',
        status: 'proposed',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
      }],
    }]
    const report = analyzeCoverage({ domains: synthDomains, knownOperations })
    expect(report.unmappedPersonas.length).toBe(1)
    expect(report.unmappedPersonas[0]!.status).toBe('proposed')
    expect(report.unmappedPersonas[0]!.personaId).toBe('future-p')
  })

  it('bundled matrices have no unmapped gap backlog after v0.8 promotion', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    expect(report.unmappedPersonas).toEqual([])
  })

  it('detects unjustified operations when persona matrix is empty', () => {
    const empty: DomainMatrix[] = []
    const report = analyzeCoverage({ domains: empty, knownOperations })
    expect(report.unjustifiedOperations.sort()).toEqual([...knownOperations.keys()].sort())
    expect(report.totals.operationsCovered).toBe(0)
  })

  it('actor cross-section aggregates operation reach', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const adminBucket = report.actorCrossSection.buckets.find(b => b.value === 'admin')
    expect(adminBucket).toBeDefined()
    expect(adminBucket!.operationIds).toContain('listUsers')
    expect(adminBucket!.operationIds).toContain('deleteUser')
  })

  it('regulation cross-section reflects PIPA footprint', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const pipa = report.regulationCrossSection.buckets.find(b => b.value === 'pii-kr-pipa')
    expect(pipa).toBeDefined()
    expect(pipa!.operationIds).toContain('register')
    expect(pipa!.operationIds).toContain('listUsers')
  })

  it('v0.10: region cross-section is populated when personas declare region', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const kr = report.regionCrossSection.buckets.find(b => b.value === 'KR')
    expect(kr).toBeDefined()
    expect(kr!.operationIds).toEqual(expect.arrayContaining(['register', 'listUsers']))
    const eu = report.regionCrossSection.buckets.find(b => b.value === 'EU')
    expect(eu).toBeDefined()
    expect(eu!.operationIds).toContain('requestMyDataExport')
  })

  it('v0.10: compliance framework cross-section orthogonal to regulation', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const soc2 = report.complianceCrossSection.buckets.find(b => b.value === 'SOC2')
    expect(soc2).toBeDefined()
    expect(soc2!.operationIds).toContain('listUsers')
  })

  it('v0.11: skill capability cross-section populated when skillVocab provided', () => {
    const skillVocab: TraitVocabulary = {
      categories: [
        { id: 'request-shape' },
        { id: 'observability' },
      ],
      values: [
        { id: 'pagination', category: 'request-shape' },
        { id: 'audit-emission', category: 'observability' },
      ],
    }
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [
        { id: 'a', status: 'implemented', identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, skills: ['pagination', 'audit-emission'] },
        { id: 'b', status: 'implemented', identity: { actor: 'user', data: 'X', intent: 'list', trigger: 'ops-monitoring' }, skills: ['pagination'] },
      ],
    }]
    const report = analyzeCoverage({ domains: synthDomains, knownOperations, skillVocab })
    expect(report.skillCategories).toBeDefined()
    const requestShape = report.skillCategories!.find(c => c.category === 'request-shape')
    const observability = report.skillCategories!.find(c => c.category === 'observability')
    expect(requestShape!.personaCount).toBe(2)        // a + b have pagination
    expect(observability!.personaCount).toBe(1)       // only a has audit-emission
  })

  it('v0.11: unknown skills appear in unknownSkills list', () => {
    const skillVocab: TraitVocabulary = { categories: [{ id: 'cat' }], values: [{ id: 'known', category: 'cat' }] }
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [{
        id: 'p',
        status: 'implemented',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
        skills: ['known', 'rogue-skill'],
      }],
    }]
    const report = analyzeCoverage({ domains: synthDomains, knownOperations, skillVocab })
    expect(report.unknownSkills).toContain('rogue-skill')
  })

  it('v0.10: renderMarkdown includes Region + Compliance sections when populated', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const md = renderMarkdown(report)
    expect(md).toContain('## Region cross-section')
    expect(md).toContain('## Compliance framework cross-section')
  })

  it('renderMarkdown emits stable section headers', () => {
    const consumerVocab: TraitVocabulary = {
      categories: [
        { id: 'product' },
      ],
      values: [
        { id: 'end-user', category: 'product' },
      ],
    }
    const report = analyzeCoverage({
      domains,
      knownOperations,
      consumerVocab,
      dataModels: loadAllDataModels(),
    })
    const md = renderMarkdown(report)
    expect(md).toContain('# Personas Coverage Report')
    expect(md).toContain('## Operation coverage')
    expect(md).toContain('## Actor cross-section')
    expect(md).toContain('## Regulation cross-section')
    expect(md).toContain('## Channel cross-section')
    expect(md).toContain('## Consumer category coverage')
    expect(md).toContain('## Data model coverage')
    // Gap backlog section appears only when there are unmapped personas; no longer always present
  })

  it('buildDataModelCoverage maps entity variants back to authored data models', () => {
    const dataModels: DataModelPersona[] = [{
      entity: 'User',
      local_variants: [
        { id: 'User(any)' },
        { id: 'User(self)' },
      ],
      invariants: {
        pii: true,
        audit: { required_on: ['read-detail'] },
      },
      regulations: ['pii-gdpr'],
    }]
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [
        {
          id: 'admin-user-any',
          status: 'implemented',
          identity: { actor: 'admin', data: 'User(any)', intent: 'read-detail', trigger: 'ops-monitoring' },
        },
        {
          id: 'owner-user-self',
          status: 'implemented',
          identity: { actor: 'owner-self', data: 'User(self)', intent: 'read-detail', trigger: 'profile-opened' },
        },
        {
          id: 'user-other',
          status: 'implemented',
          identity: { actor: 'user', data: 'User(other)', intent: 'read-detail', trigger: 'profile-opened' },
        },
      ],
    }]
    const report = analyzeCoverage({ domains: synthDomains, knownOperations: new Map(), dataModels })
    expect(report.dataModelCoverage).toEqual([{
      entity: 'User',
      personaIds: ['admin-user-any', 'owner-user-self', 'user-other'],
      pii: true,
      auditRequired: true,
      regulations: ['pii-gdpr'],
    }])
  })

  it('consumer category cross-section counts personas by consumer vocabulary category', () => {
    const consumerVocab: TraitVocabulary = {
      categories: [
        { id: 'product' },
        { id: 'integration' },
      ],
      values: [
        { id: 'end-user', category: 'product' },
        { id: 'backend', category: 'integration' },
      ],
    }
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [
        {
          id: 'product-consumer',
          status: 'implemented',
          identity: { actor: 'owner-self', data: 'User(self)', intent: 'read-detail', trigger: 'profile-opened', consumer: 'end-user' },
        },
        {
          id: 'backend-consumer',
          status: 'implemented',
          identity: { actor: 'system', data: 'User(any)', intent: 'list', trigger: 'service-sync', consumer: 'backend' },
        },
      ],
    }]
    const report = analyzeCoverage({ domains: synthDomains, knownOperations: new Map(), consumerVocab })
    expect(report.consumerCategories).toEqual([
      { category: 'product', personaCount: 1, triggers: ['end-user'] },
      { category: 'integration', personaCount: 1, triggers: ['backend'] },
    ])
  })

  it('acknowledged_orphans subtract from orphanResponses and surface in dedicated list', () => {
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      acknowledged_orphans: [
        { operationId: 'createUser', statusCode: '500', reason: 'infra error' },
      ],
      personas: [{
        id: 'happy',
        status: 'implemented',
        identity: { actor: 'admin', data: 'User(any)', intent: 'create', trigger: 'bulk-onboarding' },
        outcome: { maps_to: ['createUser'], expects: [201] },
      }],
    }]
    const report = analyzeCoverage({ domains: synthDomains, knownOperations })
    const row = report.operations.find(r => r.operationId === 'createUser')
    expect(row).toBeDefined()
    expect(row!.acknowledgedOrphanResponses).toContain('500')
    expect(row!.orphanResponses).not.toContain('500')
    expect(report.acknowledgedOrphans).toEqual([
      { domain: 'fake', operationId: 'createUser', statusCode: '500', reason: 'infra error' },
    ])
  })

  it('renderMarkdown includes Gap backlog section when there are unmapped personas', () => {
    const synthDomains: DomainMatrix[] = [{
      domain: 'fake',
      personas: [{
        id: 'future-p',
        status: 'proposed',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
      }],
    }]
    const report = analyzeCoverage({ domains: synthDomains, knownOperations })
    expect(renderMarkdown(report)).toContain('## Gap backlog')
  })

  it('response status coverage shows declared, expected, and orphans', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const updateUserRow = report.operations.find(r => r.operationId === 'updateUser')
    expect(updateUserRow).toBeDefined()
    expect(updateUserRow!.declaredResponses).toEqual(expect.arrayContaining(['200', '401', '403', '404', '422']))
    // After v0.6 propose+promote: 200 + 400 + 401 + 403 + 404 + 422 all covered
    expect(updateUserRow!.expectedStatuses).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404', '422']))
    expect(updateUserRow!.orphanResponses).toEqual([])
  })

  it('renderMarkdown includes Response status coverage section', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const md = renderMarkdown(report)
    expect(md).toContain('## Response status coverage')
    expect(md).toContain('persona-expected')
    expect(md).toContain('orphans')
  })

  it('synthetic unjustified operation surfaces in report', () => {
    const phantom: OperationInfo = { operationId: 'phantomOperation', path: '/phantom', method: 'get', responses: new Set(['200']) }
    const augmented = new Map(knownOperations)
    augmented.set('phantomOperation', phantom)
    const report = analyzeCoverage({ domains, knownOperations: augmented })
    expect(report.unjustifiedOperations).toContain('phantomOperation')
  })

  // ── v0.13: kind-aware coverage ─────────────────────────────────────
  it('cli-tool proposed persona without maps_to does NOT appear in unmapped backlog', () => {
    const cliDomain: DomainMatrix = {
      domain: 'cli-fake',
      metadata: { kind: 'cli-tool' },
      personas: [{
        id: 'cli-no-maps',
        status: 'proposed',
        identity: { actor: 'framework-developer', data: 'PersonaMatrix', intent: 'validate', trigger: 'pre-commit', consumer: 'internal-tool' },
      }],
    }
    const report = analyzeCoverage({ domains: [cliDomain], knownOperations })
    expect(report.unmappedPersonas).toEqual([])
  })

  it('openapi-http proposed persona without maps_to still appears in unmapped backlog', () => {
    const httpDomain: DomainMatrix = {
      domain: 'http-fake',
      metadata: { kind: 'openapi-http' },
      personas: [{
        id: 'http-no-maps',
        status: 'proposed',
        identity: { actor: 'admin', data: 'X', intent: 'list', trigger: 'ops-monitoring' },
      }],
    }
    const report = analyzeCoverage({ domains: [httpDomain], knownOperations })
    expect(report.unmappedPersonas.length).toBe(1)
    expect(report.unmappedPersonas[0]!.personaId).toBe('http-no-maps')
  })
})
