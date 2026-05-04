/**
 * v0.2 coverage analyzer — smoke tests.
 */

import { describe, expect, it } from 'vitest'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { analyzeCoverage, renderMarkdown } from './coverage.js'
import { loadAllDomains, loadOperationsFromMergedSpec } from './load.js'
import type { DomainMatrix } from './types.js'
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

  it('bundled matrices currently have zero gap backlog (all promoted)', () => {
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

  it('renderMarkdown emits stable section headers', () => {
    const report = analyzeCoverage({ domains, knownOperations })
    const md = renderMarkdown(report)
    expect(md).toContain('# Personas Coverage Report')
    expect(md).toContain('## Operation coverage')
    expect(md).toContain('## Actor cross-section')
    expect(md).toContain('## Regulation cross-section')
    expect(md).toContain('## Channel cross-section')
    // Gap backlog section appears only when there are unmapped personas; no longer always present
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
})
