import { describe, expect, it } from 'vitest'
import {
  createDefaultVsCodeExtensions,
  createDefaultVsCodeSettings,
  oaSdkLinter,
  requireDocumentationRule,
  requireOperationIdRule,
  suggestResponseComponentsRule,
  typeSpecSnippets,
} from '../src/index.js'

describe('@oa-sdk/typespec-tooling', () => {
  describe('VS Code IDE Configuration', () => {
    it('generates recommended extensions containing typespec.typespec-vscode', () => {
      const extensions = createDefaultVsCodeExtensions()
      expect(extensions.recommendations).toContain('typespec.typespec-vscode')
    })

    it('generates settings with formatOnSave and files association', () => {
      const settings = createDefaultVsCodeSettings()
      expect(settings['[typespec]']?.['editor.defaultFormatter']).toBe('typespec.typespec-vscode')
      expect(settings['[typespec]']?.['editor.formatOnSave']).toBe(true)
      expect(settings['files.associations']?.['*.tsp']).toBe('typespec')
    })
  })

  describe('TypeSpec Snippets', () => {
    it('contains essential oa-sdk snippet templates', () => {
      expect(typeSpecSnippets).toHaveProperty('oa-operation')
      expect(typeSpecSnippets).toHaveProperty('oa-response-component')
      expect(typeSpecSnippets).toHaveProperty('oa-model')
      expect(typeSpecSnippets).toHaveProperty('oa-erd-dataset')
      expect(typeSpecSnippets).toHaveProperty('oa-erd-entity')
    })

    it('validates structure of all snippets', () => {
      for (const [key, snippet] of Object.entries(typeSpecSnippets)) {
        expect(snippet.prefix, `prefix in ${key}`).toBeDefined()
        expect(Array.isArray(snippet.body), `body in ${key}`).toBe(true)
        expect(snippet.body.length).toBeGreaterThan(0)
        expect(snippet.description, `description in ${key}`).toBeDefined()
      }
    })
  })

  describe('Linter Rules & CodeFixes', () => {
    it('exports all 3 linter rules', () => {
      expect(requireOperationIdRule.name).toBe('require-operation-id')
      expect(requireDocumentationRule.name).toBe('require-documentation')
      expect(suggestResponseComponentsRule.name).toBe('suggest-response-components')
    })

    it('defines linter with recommended ruleSet enabling all rules', () => {
      expect(oaSdkLinter.rules).toHaveLength(3)
      expect(oaSdkLinter.ruleSets?.recommended).toBeDefined()
      expect(oaSdkLinter.ruleSets?.recommended?.enable).toEqual({
        '@oa-sdk/typespec-tooling/require-operation-id': true,
        '@oa-sdk/typespec-tooling/require-documentation': true,
        '@oa-sdk/typespec-tooling/suggest-response-components': true,
      })
    })
  })
})
