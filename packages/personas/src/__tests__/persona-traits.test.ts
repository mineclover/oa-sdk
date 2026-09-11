import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { loadOperationsFromMergedSpec, loadRegistry, loadAllTraits, type OperationInfo } from '../load.js'
import { validate } from '../validate.js'
import type { DomainMatrix, Persona } from '../types.js'

describe('Persona Capability Traits Integration', () => {
  const registry = loadRegistry()
  const traits = loadAllTraits(registry)

  describe('loadOperationsFromMergedSpec', () => {
    it('extracts x-oa-sdk-persona-traits into OperationInfo.traits as Set<string>', () => {
      const dir = mkdtempSync(join(tmpdir(), 'persona-traits-spec-'))
      const specPath = join(dir, 'spec.yaml')
      const doc = {
        openapi: '3.2.0',
        info: { title: 'Test Spec', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'listUsers',
              'x-oa-sdk-persona-traits': ['pagination', 'filter-by-role', 'filter-by-status'],
              responses: {
                '200': { description: 'OK' },
              },
            },
            post: {
              operationId: 'createUser',
              responses: {
                '201': { description: 'Created' },
              },
            },
          },
        },
      }

      try {
        writeFileSync(specPath, stringify(doc), 'utf8')
        const ops = loadOperationsFromMergedSpec(specPath)
        expect(ops).not.toBeNull()
        expect(ops!.size).toBe(2)

        const listUsers = ops!.get('listUsers')
        expect(listUsers).toBeDefined()
        expect(listUsers!.traits).toBeDefined()
        expect(listUsers!.traits!.has('pagination')).toBe(true)
        expect(listUsers!.traits!.has('filter-by-role')).toBe(true)
        expect(listUsers!.traits!.has('filter-by-status')).toBe(true)
        expect(listUsers!.traits!.has('batch')).toBe(false)

        const createUser = ops!.get('createUser')
        expect(createUser).toBeDefined()
        expect(createUser!.traits).toBeUndefined()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('validate endpoint trait obligations', () => {
    it('passes when operation declares all required persona skills', () => {
      const persona: Persona = {
        id: 'member-users-list',
        status: 'implemented',
        identity: { actor: 'member', data: 'user-profile', intent: 'read', trigger: 'user-action' },
        outcome: { maps_to: ['listUsers'], expects: [200] },
        skills: ['pagination', 'filter-by-role'],
      }
      const matrix: DomainMatrix = {
        domain: 'users',
        personas: [persona],
      }

      const knownOperations = new Map<string, OperationInfo>([
        ['listUsers', {
          operationId: 'listUsers',
          path: '/users',
          method: 'get',
          responses: new Set(['200']),
          traits: new Set(['pagination', 'filter-by-role', 'audit-emission']),
        }],
      ])

      const report = validate({ registry, traits, domains: [matrix], knownOperations })
      const traitIssues = report.issues.filter(i => i.dimension === 'traits')
      expect(traitIssues).toHaveLength(0)
    })

    it('reports error when operation lacks a required persona skill', () => {
      const persona: Persona = {
        id: 'member-users-list',
        status: 'implemented',
        identity: { actor: 'member', data: 'user-profile', intent: 'read', trigger: 'user-action' },
        outcome: { maps_to: ['listUsers'], expects: [200] },
        skills: ['pagination', 'filter-by-role', 'sse-stream'],
      }
      const matrix: DomainMatrix = {
        domain: 'users',
        personas: [persona],
      }

      const knownOperations = new Map<string, OperationInfo>([
        ['listUsers', {
          operationId: 'listUsers',
          path: '/users',
          method: 'get',
          responses: new Set(['200']),
          traits: new Set(['pagination', 'filter-by-role']),
        }],
      ])

      const report = validate({ registry, traits, domains: [matrix], knownOperations })
      const traitIssues = report.issues.filter(i => i.dimension === 'traits')
      expect(traitIssues).toHaveLength(1)
      expect(traitIssues[0]?.severity).toBe('error')
      expect(traitIssues[0]?.message).toContain("operation 'listUsers' lacks required persona skill 'sse-stream'")
    })

    it('does not check trait obligations when operation has no declared traits', () => {
      const persona: Persona = {
        id: 'member-users-list',
        status: 'implemented',
        identity: { actor: 'member', data: 'user-profile', intent: 'read', trigger: 'user-action' },
        outcome: { maps_to: ['listUsers'], expects: [200] },
        skills: ['pagination'],
      }
      const matrix: DomainMatrix = {
        domain: 'users',
        personas: [persona],
      }

      const knownOperations = new Map<string, OperationInfo>([
        ['listUsers', {
          operationId: 'listUsers',
          path: '/users',
          method: 'get',
          responses: new Set(['200']),
          // traits undefined
        }],
      ])

      const report = validate({ registry, traits, domains: [matrix], knownOperations })
      const traitIssues = report.issues.filter(i => i.dimension === 'traits')
      expect(traitIssues).toHaveLength(0)
    })

    it('skips trait obligation check for proposed personas', () => {
      const persona: Persona = {
        id: 'proposed-users-list',
        status: 'proposed',
        identity: { actor: 'member', data: 'user-profile', intent: 'read', trigger: 'user-action' },
        outcome: { maps_to: ['listUsers'] },
        skills: ['pagination', 'sse-stream'],
      }
      const matrix: DomainMatrix = {
        domain: 'users',
        personas: [persona],
      }

      const knownOperations = new Map<string, OperationInfo>([
        ['listUsers', {
          operationId: 'listUsers',
          path: '/users',
          method: 'get',
          responses: new Set(['200']),
          traits: new Set(['pagination']), // missing sse-stream
        }],
      ])

      const report = validate({ registry, traits, domains: [matrix], knownOperations })
      const traitIssues = report.issues.filter(i => i.dimension === 'traits')
      expect(traitIssues).toHaveLength(0)
    })
  })
})
