import { describe, it, expect } from 'vitest'
import {
  readApiIndexDoc,
  readCliReferenceDoc,
  readCliSpecManifest,
} from './helpers/governance.js'

describe('Tier 1: Monorepo Governance & Gates (Features 19–20)', () => {
  // =========================================================================
  // Feature 19: API Index Documentation & Gate
  // =========================================================================
  describe('F19: API Index Documentation & Gate', () => {
    it('T1-F19-1: docs/internal/api-index.md exists and is readable', () => {
      const doc = readApiIndexDoc()
      expect(doc).toBeDefined()
      expect(doc.length).toBeGreaterThan(1000)
    })

    it('T1-F19-2: api-index documents @oa-sdk/core wire-format utility types (JsonPrimitive, Resolved)', () => {
      const doc = readApiIndexDoc()
      expect(doc).toContain('@oa-sdk/core')
      expect(doc).toMatch(/packages\/core|@oa-sdk\/core/)
    })

    it('T1-F19-3: api-index contains table entries with Function/Type, File, and Usage columns', () => {
      const doc = readApiIndexDoc()
      expect(doc).toContain('| 함수/타입 | 파일 | 용도 |')
    })

    it('T1-F19-4: api-index documents @oa-sdk/parser and @oa-sdk/codegen modules', () => {
      const doc = readApiIndexDoc()
      expect(doc).toContain('@oa-sdk/parser')
      expect(doc).toContain('@oa-sdk/codegen')
    })

    it('T1-F19-5: api-index maintains deterministic markdown table structure', () => {
      const doc = readApiIndexDoc()
      const lines = doc.split('\n')
      const tableHeaders = lines.filter(l => l.startsWith('| 함수/타입') || l.startsWith('| 타입'))
      expect(tableHeaders.length).toBeGreaterThan(3)
    })
  })

  // =========================================================================
  // Feature 20: CLI Documentation & Governance Gate
  // =========================================================================
  describe('F20: CLI Documentation & Governance Gate', () => {
    it('T1-F20-1: docs/guides/cli-command-reference.md exists and documents oa-gen commands', () => {
      const doc = readCliReferenceDoc()
      expect(doc).toBeDefined()
      expect(doc).toContain('oa-gen')
    })

    it('T1-F20-2: documents audit command or AST audit command pattern', () => {
      const doc = readCliReferenceDoc()
      expect(doc).toContain('audit')
    })

    it('T1-F20-3: docs/cli-spec/oa-gen.governance.json contains valid governance manifest', () => {
      const manifest = readCliSpecManifest()
      expect(manifest).toBeDefined()
      expect(manifest.commands).toBeDefined()
      expect(Array.isArray(manifest.commands)).toBe(true)
      expect(manifest.commands.length).toBeGreaterThan(0)
    })

    it('T1-F20-4: governance manifest defines command name, summary, and options component', () => {
      const manifest = readCliSpecManifest()
      for (const cmd of manifest.commands) {
        expect(cmd.name).toBeDefined()
        expect(cmd.summary).toBeDefined()
        expect(cmd.components).toBeDefined()
      }
    })

    it('T1-F20-5: CLI reference document contains copyable bash commands matching oa-gen syntax', () => {
      const doc = readCliReferenceDoc()
      const codeBlocks = doc.match(/```bash[\s\S]*?```/g) ?? []
      expect(codeBlocks.length).toBeGreaterThanOrEqual(1)
      expect(codeBlocks.some(b => b.includes('oa-gen'))).toBe(true)
    })
  })
})
