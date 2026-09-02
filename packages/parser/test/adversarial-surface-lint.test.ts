import { describe, it, expect } from 'vitest'
import { lintDocument, type LintResult } from '../src/lint.js'

describe('Adversarial Stress Suite — Proposal 2 Surface Linting (@oa-sdk/parser)', () => {
  const validBaseDoc = {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1.0.0' },
    paths: {},
  }

  describe('surface/valid-anchor Rule Violations', () => {
    it('detects non-object anchor metadata', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            BadAnchor: {
              type: 'object',
              'x-surface-anchor': 'not-an-object',
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      expect(results.some((r) => r.rule === 'surface/valid-anchor' && r.severity === 'error')).toBe(true)
    })

    it('detects empty id, line < 1, column < 1 in anchor metadata', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            EmptyId: {
              type: 'object',
              'x-surface-anchor': { id: '', line: 1, column: 1 },
            },
            NegativeLine: {
              type: 'object',
              'x-surface-anchor': { id: 'a2', line: -5, column: 1 },
            },
            ZeroColumn: {
              type: 'object',
              'x-surface-anchor': { id: 'a3', line: 1, column: 0 },
            },
            NaNLine: {
              type: 'object',
              'x-surface-anchor': { id: 'a4', line: NaN, column: 1 },
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      const anchorErrors = results.filter((r) => r.rule === 'surface/valid-anchor')
      expect(anchorErrors.length).toBeGreaterThanOrEqual(4)
      expect(anchorErrors.every((r) => r.severity === 'error')).toBe(true)
    })
  })

  describe('surface/valid-param-range Rule Violations', () => {
    it('detects non-object param-range', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            BadParamRange: {
              type: 'object',
              'x-surface-param-range': 'invalid',
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      expect(results.some((r) => r.rule === 'surface/valid-param-range' && r.severity === 'error')).toBe(true)
    })

    it('detects empty targetProperty and non-existent targetProperty', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            EmptyProp: {
              type: 'object',
              properties: { color: { type: 'string' } },
              'x-surface-param-range': { targetProperty: '' },
            },
            MissingProp: {
              type: 'object',
              properties: { color: { type: 'string' } },
              'x-surface-param-range': { targetProperty: 'nonExistentProp' },
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      const rangeErrors = results.filter((r) => r.rule === 'surface/valid-param-range')
      expect(rangeErrors.some((r) => r.message.includes('비어있지 않은 문자열'))).toBe(true)
      expect(rangeErrors.some((r) => r.message.includes('nonExistentProp'))).toBe(true)
    })

    it('detects invalid maxFramerateHz <= 0 or NaN', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            ZeroFps: {
              type: 'object',
              'x-surface-param-range': { maxFramerateHz: 0 },
            },
            NegativeFps: {
              type: 'object',
              'x-surface-param-range': { maxFramerateHz: -60 },
            },
            StringFps: {
              type: 'object',
              'x-surface-param-range': { maxFramerateHz: '60' as any },
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      const fpsErrors = results.filter((r) => r.rule === 'surface/valid-param-range')
      expect(fpsErrors.length).toBe(3)
    })
  })

  describe('surface/valid-fingerprint Rule Violations', () => {
    it('detects invalid sha256 fingerprint strings (non-hex, bad prefix, uppercase, wrong length)', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            BadPrefix: {
              type: 'object',
              'x-surface-fingerprint': 'md5:1234567890abcdef1234567890abcdef',
            },
            UpperCase: {
              type: 'object',
              'x-surface-fingerprint': 'sha256:' + 'A'.repeat(64),
            },
            WrongLength: {
              type: 'object',
              'x-surface-fingerprint': 'sha256:' + 'a'.repeat(63),
            },
            NonHex: {
              type: 'object',
              'x-surface-fingerprint': 'sha256:' + 'z'.repeat(64),
            },
            NonString: {
              type: 'object',
              'x-surface-fingerprint': 12345 as any,
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      const fpErrors = results.filter((r) => r.rule === 'surface/valid-fingerprint')
      expect(fpErrors.length).toBe(5)
      expect(fpErrors.every((r) => r.severity === 'error')).toBe(true)
    })

    it('passes valid sha256 lowercase 64-hex fingerprints', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            GoodFingerprint: {
              type: 'object',
              'x-surface-fingerprint': 'sha256:' + 'f'.repeat(64),
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      expect(results.filter((r) => r.rule === 'surface/valid-fingerprint')).toHaveLength(0)
    })
  })

  describe('surface/valid-quote-style Rule Violations', () => {
    it('detects invalid quotation style values', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            BadQuote: {
              type: 'object',
              'x-surface-quote-style': 'triple',
            },
            EmptyQuote: {
              type: 'object',
              'x-surface-quote-style': '',
            },
            NumberQuote: {
              type: 'object',
              'x-surface-quote-style': 42 as any,
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      const quoteErrors = results.filter((r) => r.rule === 'surface/valid-quote-style')
      expect(quoteErrors.length).toBe(3)
    })

    it('passes single, double, backtick, none quote styles', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            Q1: { type: 'object', 'x-surface-quote-style': 'single' },
            Q2: { type: 'object', 'x-surface-quote-style': 'double' },
            Q3: { type: 'object', 'x-surface-quote-style': 'backtick' },
            Q4: { type: 'object', 'x-surface-quote-style': 'none' },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      expect(results.filter((r) => r.rule === 'surface/valid-quote-style')).toHaveLength(0)
    })
  })

  describe('surface/valid-patch-policy Rule Violations', () => {
    it('detects non-object patch policy, unknown onDrift, negative retryLimit', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            StringPolicy: {
              type: 'object',
              'x-surface-patch-policy': 'abort',
            },
            BadDrift: {
              type: 'object',
              'x-surface-patch-policy': { onDrift: 'ignore' },
            },
            NegativeRetry: {
              type: 'object',
              'x-surface-patch-policy': { onDrift: 'abort', retryLimit: -1 },
            },
            NaNRetry: {
              type: 'object',
              'x-surface-patch-policy': { onDrift: 'abort', retryLimit: NaN },
            },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      const policyErrors = results.filter((r) => r.rule === 'surface/valid-patch-policy')
      expect(policyErrors.length).toBe(4)
    })

    it('passes abort, rebase, force with valid retryLimits', () => {
      const doc = {
        ...validBaseDoc,
        components: {
          schemas: {
            P1: { type: 'object', 'x-surface-patch-policy': { onDrift: 'abort' } },
            P2: { type: 'object', 'x-surface-patch-policy': { onDrift: 'rebase', retryLimit: 5 } },
            P3: { type: 'object', 'x-surface-patch-policy': { onDrift: 'force', retryLimit: 0 } },
          },
        },
      }

      const results = lintDocument(doc, { categories: ['surface'] })
      expect(results.filter((r) => r.rule === 'surface/valid-patch-policy')).toHaveLength(0)
    })
  })

  describe('Category Filtering & Rule Overrides', () => {
    const mixedDoc = {
      ...validBaseDoc,
      components: {
        schemas: {
          Violator: {
            type: 'object',
            'x-surface-fingerprint': 'invalid-hash',
            'x-surface-quote-style': 'triple',
          },
        },
      },
    }

    it('isolates surface category when categories: ["surface"] is requested', () => {
      const results = lintDocument(mixedDoc, { categories: ['surface'] })
      expect(results.every((r) => r.rule.startsWith('surface/'))).toBe(true)
      expect(results.length).toBe(2)
    })

    it('skips surface category when categories does not include "surface"', () => {
      const results = lintDocument(mixedDoc, { categories: ['structure'] })
      expect(results.some((r) => r.rule.startsWith('surface/'))).toBe(false)
    })

    it('honors rules overrides ("off", "warn", "error")', () => {
      const suppressed = lintDocument(mixedDoc, {
        categories: ['surface'],
        rules: {
          'surface/valid-fingerprint': 'off',
          'surface/valid-quote-style': 'warn',
        },
      })

      expect(suppressed.filter((r) => r.rule === 'surface/valid-fingerprint')).toHaveLength(0)
      const quoteWarn = suppressed.filter((r) => r.rule === 'surface/valid-quote-style')
      expect(quoteWarn).toHaveLength(1)
      expect(quoteWarn[0].severity).toBe('warning')
    })
  })

  describe('Deep Traversals across complex schemas', () => {
    it('finds surface extensions embedded in paths, operations, requestBodies, responses, parameters', () => {
      const deepDoc = {
        openapi: '3.1.0',
        info: { title: 'Deep API', version: '1.0.0' },
        paths: {
          '/test': {
            post: {
              operationId: 'testOp',
              summary: 'Test summary',
              parameters: [
                {
                  name: 'p1',
                  in: 'query',
                  schema: {
                    type: 'string',
                    'x-surface-fingerprint': 'bad_param_fp',
                  },
                },
              ],
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        sub: {
                          type: 'object',
                          'x-surface-quote-style': 'invalid_quote',
                        },
                      },
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'OK',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        'x-surface-anchor': { id: '', line: 0, column: 0 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }

      const results = lintDocument(deepDoc, { categories: ['surface'] })
      expect(results.some((r) => r.rule === 'surface/valid-fingerprint')).toBe(true)
      expect(results.some((r) => r.rule === 'surface/valid-quote-style')).toBe(true)
      expect(results.some((r) => r.rule === 'surface/valid-anchor')).toBe(true)
    })
  })
})
