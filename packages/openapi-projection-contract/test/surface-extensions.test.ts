import { describe, it, expect } from 'vitest'
import {
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_PARAM_RANGE_EXTENSION,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION,
  OPENAPI_SURFACE_PATCH_POLICY_EXTENSION,
  OPENAPI_SURFACE_EXTENSION_NAMES,
  SURFACE_QUOTE_STYLES,
  SURFACE_PATCH_POLICY_ON_DRIFT_VALUES,
  isOpenApiSurfaceExtensionName,
  isSurfaceQuoteStyle,
  isSurfaceFingerprint,
  isSurfaceAnchorMetadata,
  isSurfaceParamRangeMetadata,
  isSurfacePatchPolicyMetadata,
  type SurfaceAnchorMetadata,
  type SurfaceParamRangeMetadata,
  type SurfaceQuoteStyle,
  type SurfacePatchPolicyMetadata,
  type SurfaceExtensionFields,
} from '../src/index.js'

describe('surface-extensions constants', () => {
  it('defines correct extension keys', () => {
    expect(OPENAPI_SURFACE_ANCHOR_EXTENSION).toBe('x-surface-anchor')
    expect(OPENAPI_SURFACE_PARAM_RANGE_EXTENSION).toBe('x-surface-param-range')
    expect(OPENAPI_SURFACE_FINGERPRINT_EXTENSION).toBe('x-surface-fingerprint')
    expect(OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION).toBe('x-surface-quote-style')
    expect(OPENAPI_SURFACE_PATCH_POLICY_EXTENSION).toBe('x-surface-patch-policy')
  })

  it('includes all 5 extension names in OPENAPI_SURFACE_EXTENSION_NAMES', () => {
    expect(OPENAPI_SURFACE_EXTENSION_NAMES).toEqual([
      'x-surface-anchor',
      'x-surface-param-range',
      'x-surface-fingerprint',
      'x-surface-quote-style',
      'x-surface-patch-policy',
    ])
  })

  it('defines quote styles and patch policy onDrift values', () => {
    expect(SURFACE_QUOTE_STYLES).toEqual(['single', 'double', 'backtick', 'none'])
    expect(SURFACE_PATCH_POLICY_ON_DRIFT_VALUES).toEqual(['abort', 'rebase', 'force'])
  })
})

describe('isOpenApiSurfaceExtensionName', () => {
  it('returns true for valid surface extension names', () => {
    expect(isOpenApiSurfaceExtensionName('x-surface-anchor')).toBe(true)
    expect(isOpenApiSurfaceExtensionName('x-surface-param-range')).toBe(true)
    expect(isOpenApiSurfaceExtensionName('x-surface-fingerprint')).toBe(true)
    expect(isOpenApiSurfaceExtensionName('x-surface-quote-style')).toBe(true)
    expect(isOpenApiSurfaceExtensionName('x-surface-patch-policy')).toBe(true)
  })

  it('returns false for invalid names', () => {
    expect(isOpenApiSurfaceExtensionName('x-custom-extension')).toBe(false)
    expect(isOpenApiSurfaceExtensionName('')).toBe(false)
    expect(isOpenApiSurfaceExtensionName(123)).toBe(false)
    expect(isOpenApiSurfaceExtensionName(null)).toBe(false)
  })
})

describe('isSurfaceQuoteStyle', () => {
  it('validates quote styles', () => {
    expect(isSurfaceQuoteStyle('single')).toBe(true)
    expect(isSurfaceQuoteStyle('double')).toBe(true)
    expect(isSurfaceQuoteStyle('backtick')).toBe(true)
    expect(isSurfaceQuoteStyle('none')).toBe(true)
    expect(isSurfaceQuoteStyle('triple')).toBe(false)
    expect(isSurfaceQuoteStyle(null)).toBe(false)
  })
})

describe('isSurfaceFingerprint', () => {
  it('validates sha256 64-hex lowercase strings', () => {
    const valid = `sha256:${'a'.repeat(64)}`
    expect(isSurfaceFingerprint(valid)).toBe(true)

    const mixed = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    expect(isSurfaceFingerprint(mixed)).toBe(true)
  })

  it('rejects invalid fingerprints', () => {
    expect(isSurfaceFingerprint('sha256:abc')).toBe(false)
    expect(isSurfaceFingerprint(`sha256:${'A'.repeat(64)}`)).toBe(false) // uppercase
    expect(isSurfaceFingerprint(`sha512:${'a'.repeat(64)}`)).toBe(false)
    expect(isSurfaceFingerprint('')).toBe(false)
    expect(isSurfaceFingerprint(null)).toBe(false)
    expect(isSurfaceFingerprint(123)).toBe(false)
  })
})

describe('isSurfaceAnchorMetadata', () => {
  it('validates valid anchor metadata', () => {
    const anchor: SurfaceAnchorMetadata = {
      id: 'param-1',
      line: 12,
      column: 4,
      raw: 'const x = 1',
      commentType: 'line',
    }
    expect(isSurfaceAnchorMetadata(anchor)).toBe(true)

    expect(isSurfaceAnchorMetadata({ id: 'a', line: 1, column: 1 })).toBe(true)
  })

  it('rejects invalid anchor metadata', () => {
    expect(isSurfaceAnchorMetadata(null)).toBe(false)
    expect(isSurfaceAnchorMetadata({})).toBe(false)
    expect(isSurfaceAnchorMetadata({ id: '', line: 1, column: 1 })).toBe(false)
    expect(isSurfaceAnchorMetadata({ id: 'a', line: 0, column: 1 })).toBe(false)
    expect(isSurfaceAnchorMetadata({ id: 'a', line: 1, column: 0 })).toBe(false)
    expect(isSurfaceAnchorMetadata({ id: 'a', line: -1, column: 1 })).toBe(false)
    expect(isSurfaceAnchorMetadata({ id: 'a', line: 1, column: '1' })).toBe(false)
  })
})

describe('isSurfaceParamRangeMetadata', () => {
  it('validates valid param range metadata', () => {
    const range: SurfaceParamRangeMetadata = {
      targetProperty: 'color',
      start: 10,
      end: 20,
      unquotedStart: 11,
      unquotedEnd: 19,
      supportsLivePatch: true,
      maxFramerateHz: 60,
    }
    expect(isSurfaceParamRangeMetadata(range)).toBe(true)
    expect(isSurfaceParamRangeMetadata({})).toBe(true)
  })

  it('rejects invalid param range metadata', () => {
    expect(isSurfaceParamRangeMetadata(null)).toBe(false)
    expect(isSurfaceParamRangeMetadata({ targetProperty: '' })).toBe(false)
    expect(isSurfaceParamRangeMetadata({ maxFramerateHz: 0 })).toBe(false)
    expect(isSurfaceParamRangeMetadata({ maxFramerateHz: -10 })).toBe(false)
    expect(isSurfaceParamRangeMetadata({ start: -1 })).toBe(false)
    expect(isSurfaceParamRangeMetadata({ supportsLivePatch: 'yes' })).toBe(false)
  })
})

describe('isSurfacePatchPolicyMetadata', () => {
  it('validates valid patch policy metadata', () => {
    const policy: SurfacePatchPolicyMetadata = {
      onDrift: 'rebase',
      retryLimit: 3,
    }
    expect(isSurfacePatchPolicyMetadata(policy)).toBe(true)
    expect(isSurfacePatchPolicyMetadata({ onDrift: 'abort' })).toBe(true)
    expect(isSurfacePatchPolicyMetadata({ onDrift: 'force', retryLimit: 0 })).toBe(true)
  })

  it('rejects invalid patch policy metadata', () => {
    expect(isSurfacePatchPolicyMetadata(null)).toBe(false)
    expect(isSurfacePatchPolicyMetadata({})).toBe(false)
    expect(isSurfacePatchPolicyMetadata({ onDrift: 'invalid' })).toBe(false)
    expect(isSurfacePatchPolicyMetadata({ onDrift: 'abort', retryLimit: -1 })).toBe(false)
  })
})

describe('SurfaceExtensionFields typing and schema attachment', () => {
  it('allows constructing full surface extensions dictionary', () => {
    const extensions: SurfaceExtensionFields = {
      'x-surface-anchor': { id: 'node-1', line: 5, column: 2 },
      'x-surface-param-range': { targetProperty: 'value', maxFramerateHz: 120 },
      'x-surface-fingerprint': `sha256:${'f'.repeat(64)}`,
      'x-surface-quote-style': 'double',
      'x-surface-patch-policy': { onDrift: 'abort', retryLimit: 2 },
    }
    expect(extensions[OPENAPI_SURFACE_ANCHOR_EXTENSION]?.id).toBe('node-1')
    expect(extensions[OPENAPI_SURFACE_PARAM_RANGE_EXTENSION]?.maxFramerateHz).toBe(120)
    expect(extensions[OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION]).toBe('double')
    expect(extensions[OPENAPI_SURFACE_PATCH_POLICY_EXTENSION]?.onDrift).toBe('abort')
  })
})
