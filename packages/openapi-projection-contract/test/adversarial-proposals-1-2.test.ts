import { describe, it, expect } from 'vitest'
import {
  projectDiscriminatedUnion,
  projectDiscriminatedUnionDocument,
  validateOpenApiProjection,
  OPENAPI_SURFACE_ANCHOR_EXTENSION,
  OPENAPI_SURFACE_PARAM_RANGE_EXTENSION,
  OPENAPI_SURFACE_FINGERPRINT_EXTENSION,
  OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION,
  OPENAPI_SURFACE_PATCH_POLICY_EXTENSION,
  isOpenApiSurfaceExtensionName,
  isSurfaceQuoteStyle,
  isSurfaceFingerprint,
  isSurfaceAnchorMetadata,
  isSurfaceParamRangeMetadata,
  isSurfacePatchPolicyMetadata,
  type DiscriminatedUnionProjectionOptions,
} from '../src/index.js'

describe('Adversarial Stress Suite — Proposal 1 (Discriminated Union Projection)', () => {
  describe('Input Robustness & Malformed Options', () => {
    it('rejects null, undefined, non-object options', () => {
      expect(() => projectDiscriminatedUnion(null as any)).toThrow()
      expect(() => projectDiscriminatedUnion(undefined as any)).toThrow()
      expect(() => projectDiscriminatedUnion('invalid' as any)).toThrow()
      expect(() => projectDiscriminatedUnion(123 as any)).toThrow()
      expect(() => projectDiscriminatedUnion([] as any)).toThrow()
    })

    it('rejects empty or whitespace discriminatorProperty', () => {
      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: '',
          unionSchemaId: 'U',
          variants: { a: {} },
        }),
      ).toThrow(/discriminatorProperty/)

      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: '   ',
          unionSchemaId: 'U',
          variants: { a: {} },
        }),
      ).toThrow(/discriminatorProperty/)
    })

    it('rejects empty or whitespace unionSchemaId', () => {
      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: '',
          variants: { a: {} },
        }),
      ).toThrow(/unionSchemaId/)

      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: '   ',
          variants: { a: {} },
        }),
      ).toThrow(/unionSchemaId/)
    })

    it('rejects non-object or empty variants record', () => {
      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: 'U',
          variants: null as any,
        }),
      ).toThrow(/variants/)

      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: 'U',
          variants: [] as any,
        }),
      ).toThrow(/variants/)

      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: 'U',
          variants: {},
        }),
      ).toThrow(/at least one variant/)
    })

    it('rejects whitespace variant discriminator keys', () => {
      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'type',
          unionSchemaId: 'U',
          variants: { '   ': { type: 'object' } },
        }),
      ).toThrow(/Variant discriminator key must be a non-empty string/)
    })
  })

  describe('Polymorphic & Multiplexed Protocol Contracts', () => {
    it('projects Chrome Native Messaging 4-byte little-endian RPC requests', () => {
      const options: DiscriminatedUnionProjectionOptions = {
        discriminatorProperty: 'method',
        unionSchemaId: 'NativeRpcRequest',
        profile: 'operation-contract',
        pathPrefix: '/rpc',
        baseProperties: {
          id: { type: 'string' },
          jsonrpc: { type: 'string', const: '2.0' },
        },
        baseRequired: ['id', 'jsonrpc'],
        variants: {
          'session.hello': {
            title: 'SessionHelloRequest',
            type: 'object',
            properties: {
              params: {
                type: 'object',
                required: ['clientVersion'],
                properties: { clientVersion: { type: 'string' } },
              },
            },
          },
          'workspace.snapshot.save': {
            title: 'WorkspaceSnapshotSaveRequest',
            type: 'object',
            properties: {
              params: {
                type: 'object',
                required: ['snapshotId', 'data'],
                properties: { snapshotId: { type: 'string' }, data: { type: 'string' } },
              },
            },
          },
        },
      }

      const result = projectDiscriminatedUnion(options)
      expect(result.unionSchema.required).toEqual(expect.arrayContaining(['id', 'jsonrpc', 'method']))
      expect(result.paths).toHaveProperty('/rpc/session.hello')
      expect(result.paths).toHaveProperty('/rpc/workspace.snapshot.save')
      expect(result.variantSchemas['SessionHelloRequest'].properties).toHaveProperty('method')
      expect((result.variantSchemas['SessionHelloRequest'].properties as any).method.const).toBe('session.hello')
    })

    it('projects MCP Stdio JSON-RPC 2.0 multi-operation tools contracts', () => {
      const options: DiscriminatedUnionProjectionOptions = {
        discriminatorProperty: 'method',
        unionSchemaId: 'McpRequest',
        profile: 'operation-contract',
        pathPrefix: '/mcp',
        variants: {
          'tools/list': {
            name: 'ToolsListRequest',
            schema: {
              type: 'object',
              properties: {
                params: { type: 'object', properties: { cursor: { type: 'string' } } },
              },
            },
          },
          'tools/call': {
            name: 'ToolsCallRequest',
            schema: {
              type: 'object',
              properties: {
                params: {
                  type: 'object',
                  required: ['name'],
                  properties: { name: { type: 'string' }, arguments: { type: 'object' } },
                },
              },
            },
          },
        },
      }

      const result = projectDiscriminatedUnion(options)
      expect(result.paths).toHaveProperty('/mcp/tools/list')
      expect(result.paths).toHaveProperty('/mcp/tools/call')
      expect(result.variantSchemas).toHaveProperty('ToolsListRequest')
      expect(result.variantSchemas).toHaveProperty('ToolsCallRequest')
    })
  })

  describe('Profile Tagging & Validation Semantics', () => {
    it('does not generate paths when profile is component-bundle and no pathPrefix given', () => {
      const result = projectDiscriminatedUnion({
        discriminatorProperty: 'kind',
        unionSchemaId: 'DataPayload',
        profile: 'component-bundle',
        variants: {
          text: { type: 'object', properties: { text: { type: 'string' } } },
          binary: { type: 'object', properties: { bytes: { type: 'string' } } },
        },
      })

      expect(result.paths).toBeUndefined()
      expect(result.unionSchema.discriminator).toBeDefined()
      expect(result.variantSchemas).toHaveProperty('DataPayloadText')
      expect(result.variantSchemas).toHaveProperty('DataPayloadBinary')
    })

    it('generates full projection document that passes validateOpenApiProjection', () => {
      const docResult = projectDiscriminatedUnionDocument({
        discriminatorProperty: 'type',
        unionSchemaId: 'UiAction',
        profile: 'operation-contract',
        pathPrefix: '/actions',
        variants: {
          click: {
            title: 'ClickAction',
            type: 'object',
            properties: { targetId: { type: 'string' } },
          },
          hover: {
            title: 'HoverAction',
            type: 'object',
            properties: { targetId: { type: 'string' } },
          },
        },
      })

      const validation = validateOpenApiProjection(docResult)
      expect(validation.valid).toBe(true)
      expect(validation.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0)
    })
  })

  describe('Discriminator Mismatch & Const Injection', () => {
    it('throws when variant schema has mismatched const discriminator property', () => {
      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'action',
          unionSchemaId: 'TestAction',
          variants: {
            submit: {
              type: 'object',
              properties: {
                action: { type: 'string', const: 'cancel' },
              },
            },
          },
        }),
      ).toThrow(/mismatched const value/)
    })

    it('throws when variant schema has mismatched enum discriminator property', () => {
      expect(() =>
        projectDiscriminatedUnion({
          discriminatorProperty: 'action',
          unionSchemaId: 'TestAction',
          variants: {
            submit: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['cancel', 'reset'] },
              },
            },
          },
        }),
      ).toThrow(/mismatched enum value/)
    })

    it('accepts matching const or enum values', () => {
      const result = projectDiscriminatedUnion({
        discriminatorProperty: 'action',
        unionSchemaId: 'TestAction',
        variants: {
          submit: {
            type: 'object',
            properties: {
              action: { type: 'string', const: 'submit' },
              data: { type: 'string' },
            },
          },
          cancel: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['cancel', 'abort'] },
            },
          },
        },
      })

      expect(result.variantSchemas).toHaveProperty('TestActionSubmit')
      expect(result.variantSchemas).toHaveProperty('TestActionCancel')
    })
  })
})

describe('Adversarial Stress Suite — Proposal 2 (Surface Extensions & Predicates)', () => {
  describe('Extension Constants', () => {
    it('defines exact vendor extension names', () => {
      expect(OPENAPI_SURFACE_ANCHOR_EXTENSION).toBe('x-surface-anchor')
      expect(OPENAPI_SURFACE_PARAM_RANGE_EXTENSION).toBe('x-surface-param-range')
      expect(OPENAPI_SURFACE_FINGERPRINT_EXTENSION).toBe('x-surface-fingerprint')
      expect(OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION).toBe('x-surface-quote-style')
      expect(OPENAPI_SURFACE_PATCH_POLICY_EXTENSION).toBe('x-surface-patch-policy')
    })
  })

  describe('isOpenApiSurfaceExtensionName predicate', () => {
    it('accepts all 5 surface extension names', () => {
      expect(isOpenApiSurfaceExtensionName('x-surface-anchor')).toBe(true)
      expect(isOpenApiSurfaceExtensionName('x-surface-param-range')).toBe(true)
      expect(isOpenApiSurfaceExtensionName('x-surface-fingerprint')).toBe(true)
      expect(isOpenApiSurfaceExtensionName('x-surface-quote-style')).toBe(true)
      expect(isOpenApiSurfaceExtensionName('x-surface-patch-policy')).toBe(true)
    })

    it('rejects invalid or non-surface extension names', () => {
      expect(isOpenApiSurfaceExtensionName('x-surface-other')).toBe(false)
      expect(isOpenApiSurfaceExtensionName('x-custom')).toBe(false)
      expect(isOpenApiSurfaceExtensionName('')).toBe(false)
      expect(isOpenApiSurfaceExtensionName(null)).toBe(false)
      expect(isOpenApiSurfaceExtensionName(123)).toBe(false)
    })
  })

  describe('isSurfaceQuoteStyle predicate', () => {
    it('accepts single, double, backtick, none', () => {
      expect(isSurfaceQuoteStyle('single')).toBe(true)
      expect(isSurfaceQuoteStyle('double')).toBe(true)
      expect(isSurfaceQuoteStyle('backtick')).toBe(true)
      expect(isSurfaceQuoteStyle('none')).toBe(true)
    })

    it('rejects invalid quote styles', () => {
      expect(isSurfaceQuoteStyle('triple')).toBe(false)
      expect(isSurfaceQuoteStyle('auto')).toBe(false)
      expect(isSurfaceQuoteStyle('')).toBe(false)
      expect(isSurfaceQuoteStyle(null)).toBe(false)
      expect(isSurfaceQuoteStyle(123)).toBe(false)
    })
  })

  describe('isSurfaceFingerprint predicate', () => {
    it('accepts valid sha256 lowercase 64-char hex strings', () => {
      expect(isSurfaceFingerprint('sha256:' + 'a'.repeat(64))).toBe(true)
      expect(isSurfaceFingerprint('sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')).toBe(true)
    })

    it('rejects invalid prefixes, lengths, upper case, and non-hex characters', () => {
      expect(isSurfaceFingerprint('md5:' + 'a'.repeat(32))).toBe(false)
      expect(isSurfaceFingerprint('sha256:' + 'A'.repeat(64))).toBe(false)
      expect(isSurfaceFingerprint('sha256:' + 'a'.repeat(63))).toBe(false)
      expect(isSurfaceFingerprint('sha256:' + 'a'.repeat(65))).toBe(false)
      expect(isSurfaceFingerprint('sha256:' + 'z'.repeat(64))).toBe(false)
      expect(isSurfaceFingerprint('sha256:')).toBe(false)
      expect(isSurfaceFingerprint('')).toBe(false)
      expect(isSurfaceFingerprint(null)).toBe(false)
      expect(isSurfaceFingerprint(12345)).toBe(false)
    })
  })

  describe('isSurfaceAnchorMetadata predicate', () => {
    it('accepts valid anchor metadata', () => {
      expect(isSurfaceAnchorMetadata({ id: 'anchor_1', line: 1, column: 1 })).toBe(true)
      expect(
        isSurfaceAnchorMetadata({
          id: 'anchor_2',
          line: 42,
          column: 15,
          raw: '// @surface:anchor_2',
          commentType: 'line',
        }),
      ).toBe(true)
    })

    it('rejects invalid anchor coordinates and id', () => {
      expect(isSurfaceAnchorMetadata({ id: '', line: 1, column: 1 })).toBe(false)
      expect(isSurfaceAnchorMetadata({ id: '   ', line: 1, column: 1 })).toBe(false)
      expect(isSurfaceAnchorMetadata({ id: 'a', line: 0, column: 1 })).toBe(false)
      expect(isSurfaceAnchorMetadata({ id: 'a', line: -1, column: 1 })).toBe(false)
      expect(isSurfaceAnchorMetadata({ id: 'a', line: 1, column: 0 })).toBe(false)
      expect(isSurfaceAnchorMetadata({ id: 'a', line: 1, column: -1 })).toBe(false)
      expect(isSurfaceAnchorMetadata(null)).toBe(false)
      expect(isSurfaceAnchorMetadata('string')).toBe(false)
    })
  })

  describe('isSurfaceParamRangeMetadata predicate', () => {
    it('accepts valid param range metadata', () => {
      expect(
        isSurfaceParamRangeMetadata({
          targetProperty: 'opacity',
          start: 100,
          end: 104,
          unquotedStart: 100,
          unquotedEnd: 104,
          supportsLivePatch: true,
          maxFramerateHz: 60,
        }),
      ).toBe(true)
      expect(isSurfaceParamRangeMetadata({})).toBe(true)
    })

    it('rejects negative offsets, zero/negative framerate, invalid types', () => {
      expect(isSurfaceParamRangeMetadata({ start: -1 })).toBe(false)
      expect(isSurfaceParamRangeMetadata({ end: -5 })).toBe(false)
      expect(isSurfaceParamRangeMetadata({ unquotedStart: -1 })).toBe(false)
      expect(isSurfaceParamRangeMetadata({ unquotedEnd: -1 })).toBe(false)
      expect(isSurfaceParamRangeMetadata({ maxFramerateHz: 0 })).toBe(false)
      expect(isSurfaceParamRangeMetadata({ maxFramerateHz: -60 })).toBe(false)
      expect(isSurfaceParamRangeMetadata({ supportsLivePatch: 'yes' as any })).toBe(false)
      expect(isSurfaceParamRangeMetadata({ targetProperty: '' })).toBe(false)
    })
  })

  describe('isSurfacePatchPolicyMetadata predicate', () => {
    it('accepts valid patch policy metadata', () => {
      expect(isSurfacePatchPolicyMetadata({ onDrift: 'abort' })).toBe(true)
      expect(isSurfacePatchPolicyMetadata({ onDrift: 'rebase', retryLimit: 3 })).toBe(true)
      expect(isSurfacePatchPolicyMetadata({ onDrift: 'force', retryLimit: 0 })).toBe(true)
    })

    it('rejects unknown drift policies and negative retryLimit', () => {
      expect(isSurfacePatchPolicyMetadata({ onDrift: 'ignore' as any })).toBe(false)
      expect(isSurfacePatchPolicyMetadata({ onDrift: 'override' as any })).toBe(false)
      expect(isSurfacePatchPolicyMetadata({ onDrift: 'abort', retryLimit: -1 })).toBe(false)
      expect(isSurfacePatchPolicyMetadata({ onDrift: 'abort', retryLimit: '3' as any })).toBe(false)
      expect(isSurfacePatchPolicyMetadata(null)).toBe(false)
    })
  })
})
