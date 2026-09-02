import { describe, expect, it } from 'vitest'
import {
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_EXTENSION_NAMES,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  OPENAPI_SURFACE_PARAM_RANGE_EXTENSION,
  OPENAPI_SURFACE_PATCH_POLICY_EXTENSION,
  OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION,
  SURFACE_PATCH_POLICY_ON_DRIFT_VALUES,
  SURFACE_QUOTE_STYLES,
  isOpenApiSurfaceExtensionName,
  isSurfaceAnchorMetadata,
  isSurfaceFingerprint,
  isSurfaceParamRangeMetadata,
  isSurfacePatchPolicyMetadata,
  isSurfaceQuoteStyle,
} from '../../src/index.js'
import type {
  OpenApiSurfaceExtensionName,
  SurfaceAnchorMetadata,
  SurfaceExtensionFields,
  SurfaceParamRangeMetadata,
  SurfacePatchPolicyMetadata,
  SurfacePatchPolicyOnDrift,
  SurfaceQuoteStyle,
} from '../../src/index.js'

describe('E2E Surface Extensions Contract (Tiers 1-4)', () => {
  // =========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 tests per feature)
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    describe('F6: x-surface-anchor Extension', () => {
      it('F6-1: validates standard line/column anchor with unique ID', () => {
        const anchor: SurfaceAnchorMetadata = {
          id: 'anchor-header-title',
          line: 12,
          column: 5,
        }
        expect(isSurfaceAnchorMetadata(anchor)).toBe(true)
      })

      it('F6-2: validates anchor with raw snippet and line comment type', () => {
        const anchor: SurfaceAnchorMetadata = {
          id: 'anchor-width-prop',
          line: 45,
          column: 3,
          raw: '// @surface width: 100px',
          commentType: 'line',
        }
        expect(isSurfaceAnchorMetadata(anchor)).toBe(true)
      })

      it('F6-3: validates anchor with block comment type', () => {
        const anchor: SurfaceAnchorMetadata = {
          id: 'anchor-block-meta',
          line: 100,
          column: 1,
          raw: '/* @surface block id: hero */',
          commentType: 'block',
        }
        expect(isSurfaceAnchorMetadata(anchor)).toBe(true)
      })

      it('F6-4: validates anchor with doc comment type', () => {
        const anchor: SurfaceAnchorMetadata = {
          id: 'anchor-doc-meta',
          line: 1,
          column: 1,
          raw: '/** @surface block id: layout */',
          commentType: 'doc',
        }
        expect(isSurfaceAnchorMetadata(anchor)).toBe(true)
      })

      it('F6-5: recognizes OPENAPI_SURFACE_ANCHOR_EXTENSION name constant', () => {
        expect(OPENAPI_SURFACE_ANCHOR_EXTENSION).toBe('x-surface-anchor')
        expect(isOpenApiSurfaceExtensionName('x-surface-anchor')).toBe(true)
      })
    })

    describe('F7: x-surface-param-range Extension', () => {
      it('F7-1: validates parameter range with start and end offsets', () => {
        const range: SurfaceParamRangeMetadata = {
          targetProperty: 'color',
          start: 120,
          end: 135,
        }
        expect(isSurfaceParamRangeMetadata(range)).toBe(true)
      })

      it('F7-2: validates unquoted offsets for string literal scrubbing', () => {
        const range: SurfaceParamRangeMetadata = {
          targetProperty: 'fontSize',
          start: 40,
          end: 46,
          unquotedStart: 41,
          unquotedEnd: 45,
        }
        expect(isSurfaceParamRangeMetadata(range)).toBe(true)
      })

      it('F7-3: validates live patch capability flags', () => {
        const range: SurfaceParamRangeMetadata = {
          targetProperty: 'opacity',
          supportsLivePatch: true,
          maxFramerateHz: 60,
        }
        expect(isSurfaceParamRangeMetadata(range)).toBe(true)
      })

      it('F7-4: validates high-framerate 120Hz live slider configuration', () => {
        const range: SurfaceParamRangeMetadata = {
          targetProperty: 'transformX',
          start: 200,
          end: 205,
          supportsLivePatch: true,
          maxFramerateHz: 120,
        }
        expect(isSurfaceParamRangeMetadata(range)).toBe(true)
      })

      it('F7-5: recognizes OPENAPI_SURFACE_PARAM_RANGE_EXTENSION name constant', () => {
        expect(OPENAPI_SURFACE_PARAM_RANGE_EXTENSION).toBe('x-surface-param-range')
        expect(isOpenApiSurfaceExtensionName('x-surface-param-range')).toBe(true)
      })
    })

    describe('F8: x-surface-fingerprint Extension', () => {
      it('F8-1: validates standard SHA-256 hex string with sha256 prefix', () => {
        const hash = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
        expect(isSurfaceFingerprint(hash)).toBe(true)
      })

      it('F8-2: validates all-zero hash digest format', () => {
        const hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
        expect(isSurfaceFingerprint(hash)).toBe(true)
      })

      it('F8-3: validates all-f hash digest format', () => {
        const hash = 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        expect(isSurfaceFingerprint(hash)).toBe(true)
      })

      it('F8-4: validates mixed alphanumeric valid SHA-256 digest', () => {
        const hash = 'sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
        expect(isSurfaceFingerprint(hash)).toBe(true)
      })

      it('F8-5: recognizes OPENAPI_SURFACE_FINGERPRINT_EXTENSION name constant', () => {
        expect(OPENAPI_SURFACE_FINGERPRINT_EXTENSION).toBe('x-surface-fingerprint')
        expect(isOpenApiSurfaceExtensionName('x-surface-fingerprint')).toBe(true)
      })
    })

    describe('F9: x-surface-quote-style Extension', () => {
      it('F9-1: validates single quote style', () => {
        expect(isSurfaceQuoteStyle('single')).toBe(true)
      })

      it('F9-2: validates double quote style', () => {
        expect(isSurfaceQuoteStyle('double')).toBe(true)
      })

      it('F9-3: validates backtick quote style', () => {
        expect(isSurfaceQuoteStyle('backtick')).toBe(true)
      })

      it('F9-4: validates none quote style for numeric/boolean literals', () => {
        expect(isSurfaceQuoteStyle('none')).toBe(true)
      })

      it('F9-5: recognizes OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION name and enum collection', () => {
        expect(OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION).toBe('x-surface-quote-style')
        expect(isOpenApiSurfaceExtensionName('x-surface-quote-style')).toBe(true)
        expect(SURFACE_QUOTE_STYLES).toEqual(['single', 'double', 'backtick', 'none'])
      })
    })

    describe('F10: x-surface-patch-policy Extension', () => {
      it('F10-1: validates abort on drift policy', () => {
        const policy: SurfacePatchPolicyMetadata = { onDrift: 'abort' }
        expect(isSurfacePatchPolicyMetadata(policy)).toBe(true)
      })

      it('F10-2: validates rebase on drift policy with retryLimit', () => {
        const policy: SurfacePatchPolicyMetadata = { onDrift: 'rebase', retryLimit: 3 }
        expect(isSurfacePatchPolicyMetadata(policy)).toBe(true)
      })

      it('F10-3: validates force on drift policy', () => {
        const policy: SurfacePatchPolicyMetadata = { onDrift: 'force' }
        expect(isSurfacePatchPolicyMetadata(policy)).toBe(true)
      })

      it('F10-4: validates retryLimit of 0 as non-negative integer', () => {
        const policy: SurfacePatchPolicyMetadata = { onDrift: 'rebase', retryLimit: 0 }
        expect(isSurfacePatchPolicyMetadata(policy)).toBe(true)
      })

      it('F10-5: recognizes OPENAPI_SURFACE_PATCH_POLICY_EXTENSION name and onDrift values', () => {
        expect(OPENAPI_SURFACE_PATCH_POLICY_EXTENSION).toBe('x-surface-patch-policy')
        expect(isOpenApiSurfaceExtensionName('x-surface-patch-policy')).toBe(true)
        expect(SURFACE_PATCH_POLICY_ON_DRIFT_VALUES).toEqual(['abort', 'rebase', 'force'])
      })
    })
  })

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    describe('F6 Boundary Cases: x-surface-anchor', () => {
      it('F6-B1: rejects non-positive line coordinates (line <= 0)', () => {
        expect(isSurfaceAnchorMetadata({ id: 'a1', line: 0, column: 1 })).toBe(false)
        expect(isSurfaceAnchorMetadata({ id: 'a1', line: -5, column: 1 })).toBe(false)
      })

      it('F6-B2: rejects non-positive column coordinates (column <= 0)', () => {
        expect(isSurfaceAnchorMetadata({ id: 'a1', line: 1, column: 0 })).toBe(false)
        expect(isSurfaceAnchorMetadata({ id: 'a1', line: 1, column: -10 })).toBe(false)
      })

      it('F6-B3: rejects empty or whitespace-only id string', () => {
        expect(isSurfaceAnchorMetadata({ id: '', line: 1, column: 1 })).toBe(false)
        expect(isSurfaceAnchorMetadata({ id: '   ', line: 1, column: 1 })).toBe(false)
      })

      it('F6-B4: rejects non-object or null candidates', () => {
        expect(isSurfaceAnchorMetadata(null)).toBe(false)
        expect(isSurfaceAnchorMetadata(undefined)).toBe(false)
        expect(isSurfaceAnchorMetadata('anchor')).toBe(false)
        expect(isSurfaceAnchorMetadata([])).toBe(false)
      })

      it('F6-B5: accepts large coordinates and multi-line raw anchor strings', () => {
        const largeAnchor = {
          id: 'anchor-deep-nested',
          line: 100_000,
          column: 500,
          raw: '/**\n * Multi-line block\n * @surface\n */',
        }
        expect(isSurfaceAnchorMetadata(largeAnchor)).toBe(true)
      })
    })

    describe('F7 Boundary Cases: x-surface-param-range', () => {
      it('F7-B1: rejects negative start or end offsets', () => {
        expect(isSurfaceParamRangeMetadata({ start: -1, end: 10 })).toBe(false)
        expect(isSurfaceParamRangeMetadata({ start: 10, end: -1 })).toBe(false)
      })

      it('F7-B2: rejects negative unquoted offsets', () => {
        expect(isSurfaceParamRangeMetadata({ unquotedStart: -5 })).toBe(false)
        expect(isSurfaceParamRangeMetadata({ unquotedEnd: -1 })).toBe(false)
      })

      it('F7-B3: rejects non-positive maxFramerateHz (<= 0)', () => {
        expect(isSurfaceParamRangeMetadata({ maxFramerateHz: 0 })).toBe(false)
        expect(isSurfaceParamRangeMetadata({ maxFramerateHz: -30 })).toBe(false)
      })

      it('F7-B4: rejects empty targetProperty string if provided', () => {
        expect(isSurfaceParamRangeMetadata({ targetProperty: '' })).toBe(false)
      })

      it('F7-B5: rejects non-boolean supportsLivePatch', () => {
        expect(isSurfaceParamRangeMetadata({ supportsLivePatch: 'true' as unknown as boolean })).toBe(false)
      })
    })

    describe('F8 Boundary Cases: x-surface-fingerprint', () => {
      it('F8-B1: rejects hash without sha256 prefix', () => {
        expect(isSurfaceFingerprint('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(false)
      })

      it('F8-B2: rejects hash with uppercase hex characters', () => {
        expect(isSurfaceFingerprint('sha256:E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855')).toBe(false)
      })

      it('F8-B3: rejects hash with invalid length (too short or too long)', () => {
        expect(isSurfaceFingerprint('sha256:e3b0c442')).toBe(false)
        expect(isSurfaceFingerprint('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85599')).toBe(false)
      })

      it('F8-B4: rejects non-hex characters in digest', () => {
        expect(isSurfaceFingerprint('sha256:g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8zz')).toBe(false)
      })

      it('F8-B5: rejects non-string types (null, numbers, objects)', () => {
        expect(isSurfaceFingerprint(null)).toBe(false)
        expect(isSurfaceFingerprint(undefined)).toBe(false)
        expect(isSurfaceFingerprint(123456)).toBe(false)
        expect(isSurfaceFingerprint({})).toBe(false)
      })
    })

    describe('F9 Boundary Cases: x-surface-quote-style', () => {
      it('F9-B1: rejects invalid quote style strings', () => {
        expect(isSurfaceQuoteStyle('triple')).toBe(false)
        expect(isSurfaceQuoteStyle('single-quote')).toBe(false)
        expect(isSurfaceQuoteStyle('')).toBe(false)
      })

      it('F9-B2: rejects case variations (SINGLE, Double)', () => {
        expect(isSurfaceQuoteStyle('SINGLE')).toBe(false)
        expect(isSurfaceQuoteStyle('Double')).toBe(false)
      })

      it('F9-B3: rejects non-string types', () => {
        expect(isSurfaceQuoteStyle(null)).toBe(false)
        expect(isSurfaceQuoteStyle(undefined)).toBe(false)
        expect(isSurfaceQuoteStyle(1)).toBe(false)
      })

      it('F9-B4: validates all extension names in OPENAPI_SURFACE_EXTENSION_NAMES', () => {
        for (const ext of OPENAPI_SURFACE_EXTENSION_NAMES) {
          expect(isOpenApiSurfaceExtensionName(ext)).toBe(true)
        }
      })

      it('F9-B5: rejects unknown vendor extensions not in OPENAPI_SURFACE_EXTENSION_NAMES', () => {
        expect(isOpenApiSurfaceExtensionName('x-surface-unknown')).toBe(false)
        expect(isOpenApiSurfaceExtensionName('x-custom-param')).toBe(false)
        expect(isOpenApiSurfaceExtensionName('')).toBe(false)
      })
    })

    describe('F10 Boundary Cases: x-surface-patch-policy', () => {
      it('F10-B1: rejects unrecognized onDrift values', () => {
        expect(isSurfacePatchPolicyMetadata({ onDrift: 'ignore' as unknown as SurfacePatchPolicyOnDrift })).toBe(false)
        expect(isSurfacePatchPolicyMetadata({ onDrift: 'prompt' as unknown as SurfacePatchPolicyOnDrift })).toBe(false)
      })

      it('F10-B2: rejects negative retryLimit', () => {
        expect(isSurfacePatchPolicyMetadata({ onDrift: 'rebase', retryLimit: -1 })).toBe(false)
      })

      it('F10-B3: rejects non-integer or non-finite retryLimit', () => {
        expect(isSurfacePatchPolicyMetadata({ onDrift: 'rebase', retryLimit: Infinity })).toBe(false)
        expect(isSurfacePatchPolicyMetadata({ onDrift: 'rebase', retryLimit: NaN })).toBe(false)
      })

      it('F10-B4: rejects non-object or null candidate', () => {
        expect(isSurfacePatchPolicyMetadata(null)).toBe(false)
        expect(isSurfacePatchPolicyMetadata(undefined)).toBe(false)
        expect(isSurfacePatchPolicyMetadata('rebase')).toBe(false)
      })

      it('F10-B5: allows high retry limits and force policy', () => {
        expect(isSurfacePatchPolicyMetadata({ onDrift: 'force', retryLimit: 100 })).toBe(true)
      })
    })
  })

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS
  // =========================================================================

  describe('Tier 3: Cross-Feature Interactions', () => {
    it('T3-1: combines all 5 x-surface-* extensions on a single schema definition', () => {
      const surfaceSchema: SurfaceExtensionFields & Record<string, unknown> = {
        type: 'object',
        properties: {
          backgroundColor: {
            type: 'string',
            [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
              targetProperty: 'backgroundColor',
              start: 105,
              end: 114,
              unquotedStart: 106,
              unquotedEnd: 113,
              supportsLivePatch: true,
              maxFramerateHz: 120,
            },
            [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'single',
          },
        },
        [OPENAPI_SURFACE_ANCHOR_EXTENSION]: {
          id: 'component-card-style',
          line: 10,
          column: 3,
          raw: '// @surface component: Card',
          commentType: 'line',
        },
        [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]: {
          onDrift: 'rebase',
          retryLimit: 5,
        },
      }

      expect(isSurfaceAnchorMetadata(surfaceSchema[OPENAPI_SURFACE_ANCHOR_EXTENSION])).toBe(true)
      expect(isSurfaceFingerprint(surfaceSchema[OPENAPI_SURFACE_FINGERPRINT_EXTENSION])).toBe(true)
      expect(isSurfacePatchPolicyMetadata(surfaceSchema[OPENAPI_SURFACE_PATCH_POLICY_EXTENSION])).toBe(true)

      const prop = (surfaceSchema.properties as Record<string, any>).backgroundColor
      expect(isSurfaceParamRangeMetadata(prop[OPENAPI_SURFACE_PARAM_RANGE_EXTENSION])).toBe(true)
      expect(isSurfaceQuoteStyle(prop[OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION])).toBe(true)
    })

    it('T3-2: supports multiple properties with different quote styles and framerate limits', () => {
      const properties = {
        color: {
          type: 'string',
          [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'double',
          [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
            targetProperty: 'color',
            start: 10,
            end: 19,
            supportsLivePatch: true,
            maxFramerateHz: 60,
          },
        },
        padding: {
          type: 'number',
          [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'none',
          [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
            targetProperty: 'padding',
            start: 35,
            end: 37,
            supportsLivePatch: true,
            maxFramerateHz: 120,
          },
        },
        template: {
          type: 'string',
          [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'backtick',
          [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
            targetProperty: 'template',
            start: 50,
            end: 75,
            supportsLivePatch: false,
          },
        },
      }

      expect(isSurfaceQuoteStyle(properties.color[OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION])).toBe(true)
      expect(isSurfaceQuoteStyle(properties.padding[OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION])).toBe(true)
      expect(isSurfaceQuoteStyle(properties.template[OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION])).toBe(true)
      expect(isSurfaceParamRangeMetadata(properties.color[OPENAPI_SURFACE_PARAM_RANGE_EXTENSION])).toBe(true)
      expect(isSurfaceParamRangeMetadata(properties.padding[OPENAPI_SURFACE_PARAM_RANGE_EXTENSION])).toBe(true)
      expect(isSurfaceParamRangeMetadata(properties.template[OPENAPI_SURFACE_PARAM_RANGE_EXTENSION])).toBe(true)
    })
  })

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    it('T4-1: Visual Design Tool 60fps / 120fps Parameter Slider Live Patching Configuration', () => {
      // Simulating a live CSS scrubber modifying 'borderRadius' in a React component
      const sliderConfig: SurfaceExtensionFields = {
        [OPENAPI_SURFACE_ANCHOR_EXTENSION]: {
          id: 'hero-button-border-radius',
          line: 88,
          column: 16,
          raw: 'borderRadius: 8, // @surface',
          commentType: 'line',
        },
        [OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]: {
          targetProperty: 'borderRadius',
          start: 1420,
          end: 1421,
          supportsLivePatch: true,
          maxFramerateHz: 120,
        },
        [OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]: 'none',
        [OPENAPI_SURFACE_FINGERPRINT_EXTENSION]: 'sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
        [OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]: {
          onDrift: 'rebase',
          retryLimit: 10,
        },
      }

      // Assert complete valid surface configuration for live engine
      expect(isSurfaceAnchorMetadata(sliderConfig[OPENAPI_SURFACE_ANCHOR_EXTENSION])).toBe(true)
      expect(isSurfaceParamRangeMetadata(sliderConfig[OPENAPI_SURFACE_PARAM_RANGE_EXTENSION])).toBe(true)
      expect(sliderConfig[OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]?.maxFramerateHz).toBe(120)
      expect(isSurfaceQuoteStyle(sliderConfig[OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION])).toBe(true)
      expect(isSurfaceFingerprint(sliderConfig[OPENAPI_SURFACE_FINGERPRINT_EXTENSION])).toBe(true)
      expect(isSurfacePatchPolicyMetadata(sliderConfig[OPENAPI_SURFACE_PATCH_POLICY_EXTENSION])).toBe(true)
    })
  })
})
