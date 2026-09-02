import { describe, expect, it } from 'vitest'
import { lintDocument } from '../../src/lint.js'
import {
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  OPENAPI_SURFACE_PARAM_RANGE_EXTENSION,
  OPENAPI_SURFACE_PATCH_POLICY_EXTENSION,
  OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION,
} from '@oa-sdk/openapi-projection-contract'

describe('E2E Surface Range Extensions & Linting (Tiers 1-4)', () => {
  const createBaseDoc = (schemas: Record<string, unknown> = {}) => ({
    openapi: '3.1.0',
    info: { title: 'Surface Spec', version: '1.0.0' },
    paths: {
      '/render': {
        post: {
          operationId: 'renderSurface',
          responses: { '200': { description: 'OK' } },
        },
      },
    },
    components: { schemas },
  })

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 tests per feature)
  // =========================================================================

  describe('Tier 1: Feature Coverage (F11 Surface Lint Rules)', () => {
    it('F11-1: surface/valid-anchor passes for valid anchor object', () => {
      const doc = createBaseDoc({
        Button: {
          type: 'object',
          [OPENAPI_SURFACE_ANCHOR_EXTENSION]: {
            id: 'btn-anchor',
            line: 14,
            column: 2,
            raw: '// @surface',
            commentType: 'line',
          },
          properties: { label: { type: 'string' } },
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const anchorErrors = results.filter(r => r.rule === 'surface/valid-anchor')
      expect(anchorErrors).toHaveLength(0)
    })

    it('F11-2: surface/valid-param-range passes when targetProperty exists in properties', () => {
      const doc = createBaseDoc({
        Card: {
          type: 'object',
          properties: {
            width: { type: 'number' },
          },
          [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
            targetProperty: 'width',
            supportsLivePatch: true,
            maxFramerateHz: 60,
          },
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const paramErrors = results.filter(r => r.rule === 'surface/valid-param-range')
      expect(paramErrors).toHaveLength(0)
    })

    it('F11-3: surface/valid-fingerprint passes for valid SHA-256 hash', () => {
      const doc = createBaseDoc({
        Modal: {
          type: 'object',
          [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          properties: { title: { type: 'string' } },
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const fpErrors = results.filter(r => r.rule === 'surface/valid-fingerprint')
      expect(fpErrors).toHaveLength(0)
    })

    it('F11-4: surface/valid-quote-style passes for all valid enum values', () => {
      const styles = ['single', 'double', 'backtick', 'none'] as const
      for (const style of styles) {
        const doc = createBaseDoc({
          Element: {
            type: 'object',
            [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: style,
          },
        })
        const results = lintDocument(doc, { categories: ['surface'] })
        const quoteErrors = results.filter(r => r.rule === 'surface/valid-quote-style')
        expect(quoteErrors).toHaveLength(0)
      }
    })

    it('F11-5: surface/valid-patch-policy passes for abort, rebase, force policies', () => {
      const policies = [
        { onDrift: 'abort' },
        { onDrift: 'rebase', retryLimit: 5 },
        { onDrift: 'force' },
      ]
      for (const policy of policies) {
        const doc = createBaseDoc({
          Block: {
            type: 'object',
            [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]: policy,
          },
        })
        const results = lintDocument(doc, { categories: ['surface'] })
        const policyErrors = results.filter(r => r.rule === 'surface/valid-patch-policy')
        expect(policyErrors).toHaveLength(0)
      }
    })
  })

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('F11-B1: emits error for invalid surface anchor structure (empty id, line <= 0, column <= 0)', () => {
      const doc = createBaseDoc({
        BadAnchor: {
          type: 'object',
          [OPENAPI_SURFACE_ANCHOR_EXTENSION]: {
            id: '',
            line: 0,
            column: -1,
          },
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const errors = results.filter(r => r.rule === 'surface/valid-anchor')
      expect(errors.length).toBeGreaterThanOrEqual(3)
      expect(errors.some(e => e.path.includes('/id'))).toBe(true)
      expect(errors.some(e => e.path.includes('/line'))).toBe(true)
      expect(errors.some(e => e.path.includes('/column'))).toBe(true)
    })

    it('F11-B2: emits error when targetProperty does not exist in schema properties', () => {
      const doc = createBaseDoc({
        MissingProp: {
          type: 'object',
          properties: {
            opacity: { type: 'number' },
          },
          [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
            targetProperty: 'nonExistentProperty',
          },
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const errors = results.filter(r => r.rule === 'surface/valid-param-range')
      expect(errors.length).toBeGreaterThanOrEqual(1)
      expect(errors[0].message).toContain('nonExistentProperty')
    })

    it('F11-B3: emits error when maxFramerateHz is <= 0 or NaN', () => {
      const doc = createBaseDoc({
        BadHz: {
          type: 'object',
          properties: { val: { type: 'string' } },
          [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
            targetProperty: 'val',
            maxFramerateHz: -60,
          },
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const errors = results.filter(r => r.rule === 'surface/valid-param-range')
      expect(errors.length).toBeGreaterThanOrEqual(1)
      expect(errors[0].path).toContain('/maxFramerateHz')
    })

    it('F11-B4: emits error when fingerprint is not a valid SHA-256 format', () => {
      const doc = createBaseDoc({
        BadFp: {
          type: 'object',
          [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'md5:1234567890',
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const errors = results.filter(r => r.rule === 'surface/valid-fingerprint')
      expect(errors.length).toBeGreaterThanOrEqual(1)
      expect(errors[0].rule).toBe('surface/valid-fingerprint')
    })

    it('F11-B5: emits error for invalid quote style', () => {
      const doc = createBaseDoc({
        BadQuote: {
          type: 'object',
          [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'triple-quotes',
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const errors = results.filter(r => r.rule === 'surface/valid-quote-style')
      expect(errors.length).toBeGreaterThanOrEqual(1)
    })

    it('F11-B6: emits error for invalid patch policy onDrift and negative retryLimit', () => {
      const doc = createBaseDoc({
        BadPolicy: {
          type: 'object',
          [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]: {
            onDrift: 'unsupported-action',
            retryLimit: -5,
          },
        },
      })

      const results = lintDocument(doc, { categories: ['surface'] })
      const errors = results.filter(r => r.rule === 'surface/valid-patch-policy')
      expect(errors.length).toBeGreaterThanOrEqual(2)
      expect(errors.some(e => e.path.includes('/onDrift'))).toBe(true)
      expect(errors.some(e => e.path.includes('/retryLimit'))).toBe(true)
    })

    it('F11-B7: respects rule level override configuration ("off", "warn", "error")', () => {
      const doc = createBaseDoc({
        BadFp: {
          type: 'object',
          [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'invalid-sha256',
        },
      })

      // Turn rule to warn
      const warnResults = lintDocument(doc, {
        categories: ['surface'],
        rules: { 'surface/valid-fingerprint': 'warn' },
      })
      expect(warnResults.find(r => r.rule === 'surface/valid-fingerprint')?.severity).toBe('warning')

      // Turn rule off
      const offResults = lintDocument(doc, {
        categories: ['surface'],
        rules: { 'surface/valid-fingerprint': 'off' },
      })
      expect(offResults.find(r => r.rule === 'surface/valid-fingerprint')).toBeUndefined()
    })
  })

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS
  // =========================================================================

  describe('Tier 3: Cross-Feature Interactions', () => {
    it('T3-1: lints deeply nested schemas containing surface metadata across paths and components', () => {
      const doc = {
        openapi: '3.1.0',
        info: { title: 'Complex Surface API', version: '1.0.0' },
        paths: {
          '/surface/patch': {
            post: {
              operationId: 'patchSurface',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      [OPENAPI_SURFACE_ANCHOR_EXTENSION]: { id: 'req-body-anchor', line: 10, column: 1 },
                      properties: {
                        patchPayload: {
                          type: 'string',
                          [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'double',
                        },
                      },
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            SurfaceBlock: {
              type: 'object',
              [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]: { onDrift: 'rebase', retryLimit: 2 },
              properties: {
                cssText: { type: 'string' },
              },
              [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
                targetProperty: 'cssText',
                supportsLivePatch: true,
                maxFramerateHz: 120,
              },
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      const errors = results.filter(r => r.severity === 'error')
      expect(errors).toHaveLength(0)
    })
  })

  // =========================================================================
  // TIER 4: REAL-WORLD SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    it('T4-1: Validates Complete Browser Studio Surface Engine Schema Definition', () => {
      const studioSurfaceSchema = {
        openapi: '3.1.0',
        info: { title: 'Browser Studio Live Editing Surface Spec', version: '3.1.0' },
        paths: {},
        components: {
          schemas: {
            SurfaceBlock: {
              type: 'object',
              required: ['id', 'anchor', 'fingerprint', 'params'],
              [OPENAPI_SURFACE_ANCHOR_EXTENSION]: {
                id: 'surface-block-anchor',
                line: 42,
                column: 1,
                raw: '// @surface block: Header',
                commentType: 'line',
              },
              [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
              [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]: {
                onDrift: 'rebase',
                retryLimit: 5,
              },
              properties: {
                id: { type: 'string' },
                anchor: { $ref: '#/components/schemas/SurfaceAnchor' },
                fingerprint: { type: 'string' },
                params: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/SurfaceParam' },
                },
              },
            },
            SurfaceParam: {
              type: 'object',
              required: ['name', 'value'],
              properties: {
                name: { type: 'string' },
                value: {
                  type: 'string',
                  [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'single',
                },
              },
              [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
                targetProperty: 'value',
                supportsLivePatch: true,
                maxFramerateHz: 120,
              },
            },
          },
        },
      }

      const results = lintDocument(studioSurfaceSchema, { categories: ['surface'] })
      const surfaceErrors = results.filter(r => r.severity === 'error')
      expect(surfaceErrors).toHaveLength(0)
    })
  })
})
