import { describe, expect, it, vi } from 'vitest'
import type { OasDocument } from '@oa-sdk/parser'
import {
  generateZodFromSpec,
  ZodGenerationPreflightError,
} from './generate-zod.js'

describe('generateZodFromSpec - Preflight Validation & Normalization Pipeline', () => {
  const validDoc: OasDocument = {
    openapi: '3.2.0',
    info: { title: 'Valid API', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
          },
        },
      },
    },
  }

  describe('R1: Preflight Validation Pipeline', () => {
    it('succeeds cleanly for a valid OAS 3.2 document', () => {
      const tsCode = generateZodFromSpec(validDoc)
      expect(tsCode).toContain("import { z } from 'zod'")
      expect(tsCode).toContain('export const UserSchema = z.object({')
      expect(tsCode).toContain('export type User = z.infer<typeof UserSchema>')
    })

    it('throws ZodGenerationPreflightError with rule refs/valid-ref when broken $ref is detected', () => {
      const brokenRefDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Broken Ref API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Order: {
              type: 'object',
              properties: {
                customer: { $ref: '#/components/schemas/NonExistentCustomer' },
              },
            },
          },
        },
      }

      expect(() => generateZodFromSpec(brokenRefDoc)).toThrow(ZodGenerationPreflightError)

      try {
        generateZodFromSpec(brokenRefDoc)
      } catch (err) {
        expect(err).toBeInstanceOf(ZodGenerationPreflightError)
        const preflightErr = err as ZodGenerationPreflightError
        expect(preflightErr.diagnostics.length).toBeGreaterThanOrEqual(1)
        const brokenRefDiagnostic = preflightErr.diagnostics.find(d => d.rule === 'refs/valid-ref')
        expect(brokenRefDiagnostic).toBeDefined()
        expect(brokenRefDiagnostic!.severity).toBe('error')
        expect(brokenRefDiagnostic!.path).toBe('#/components/schemas/NonExistentCustomer')
        expect(preflightErr.message).toContain('refs/valid-ref')
        expect(preflightErr.message).toContain('#/components/schemas/NonExistentCustomer')
      }
    })

    it('throws ZodGenerationPreflightError when document structure is missing (no openapi version)', () => {
      const missingOpenApiDoc = {
        info: { title: 'Missing Version API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Simple: { type: 'string' },
          },
        },
      } as unknown as OasDocument

      expect(() => generateZodFromSpec(missingOpenApiDoc)).toThrow(ZodGenerationPreflightError)

      try {
        generateZodFromSpec(missingOpenApiDoc)
      } catch (err) {
        expect(err).toBeInstanceOf(ZodGenerationPreflightError)
        const preflightErr = err as ZodGenerationPreflightError
        const structureDiag = preflightErr.diagnostics.find(d => d.rule === 'structure/openapi-version')
        expect(structureDiag).toBeDefined()
        expect(structureDiag!.severity).toBe('error')
      }
    })

    it('throws ZodGenerationPreflightError when info is missing', () => {
      const missingInfoDoc = {
        openapi: '3.2.0',
        paths: {},
        components: {
          schemas: {
            Simple: { type: 'string' },
          },
        },
      } as unknown as OasDocument

      expect(() => generateZodFromSpec(missingInfoDoc)).toThrow(ZodGenerationPreflightError)

      try {
        generateZodFromSpec(missingInfoDoc)
      } catch (err) {
        expect(err).toBeInstanceOf(ZodGenerationPreflightError)
        const preflightErr = err as ZodGenerationPreflightError
        const infoDiag = preflightErr.diagnostics.find(d => d.rule === 'structure/info-required')
        expect(infoDiag).toBeDefined()
      }
    })

    it('throws ZodGenerationPreflightError when components.schemas contains a non-object schema', () => {
      const corruptSchemaDoc = {
        openapi: '3.2.0',
        info: { title: 'Corrupt Schema API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Corrupt: 'this-is-not-a-schema-object' as any,
          },
        },
      } as unknown as OasDocument

      expect(() => generateZodFromSpec(corruptSchemaDoc)).toThrow(ZodGenerationPreflightError)

      try {
        generateZodFromSpec(corruptSchemaDoc)
      } catch (err) {
        expect(err).toBeInstanceOf(ZodGenerationPreflightError)
        const preflightErr = err as ZodGenerationPreflightError
        const schemaDiag = preflightErr.diagnostics.find(d => d.rule === 'structure/schema-object')
        expect(schemaDiag).toBeDefined()
        expect(schemaDiag!.path).toBe('/components/schemas/Corrupt')
      }
    })

    it('bypasses fatal validation stops when validate: false is passed (best-effort emission)', () => {
      const brokenRefDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Broken Ref API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Order: {
              type: 'object',
              properties: {
                customer: { $ref: '#/components/schemas/NonExistentCustomer' },
              },
            },
          },
        },
      }

      // Should not throw
      const tsCode = generateZodFromSpec(brokenRefDoc, { validate: false })
      expect(tsCode).toContain('export const OrderSchema = z.object({')
      expect(tsCode).toContain('customer: z.lazy(() => NonExistentCustomerSchema).optional()')
    })

    it('bypasses fatal validation stops when force: true is passed, issuing console warnings', () => {
      const brokenRefDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Broken Ref API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Order: {
              type: 'object',
              properties: {
                customer: { $ref: '#/components/schemas/NonExistentCustomer' },
              },
            },
          },
        },
      }

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const tsCode = generateZodFromSpec(brokenRefDoc, { force: true })
      expect(tsCode).toContain('export const OrderSchema = z.object({')
      expect(warnSpy).toHaveBeenCalled()
      expect(warnSpy.mock.calls[0]![0]).toContain('--force enabled, proceeding best-effort')

      warnSpy.mockRestore()
    })

    it('respects lintCategories isolation to only run specified category rules', () => {
      // Document with structure error (missing title) but no surface error
      const brokenDoc: OasDocument = {
        openapi: '3.2.0',
        info: { version: '1.0.0' } as any, // missing title
        paths: {},
        components: {
          schemas: {
            Valid: { type: 'string' },
          },
        },
      }

      // If we only lint 'surface', structure errors should be ignored
      const tsCode = generateZodFromSpec(brokenDoc, { lintCategories: ['surface'] })
      expect(tsCode).toContain('export const ValidSchema = z.string()')
    })

    it('halts on warnings when failOnSeverity: "warning" is configured', () => {
      // Document without paths or webhooks (triggers structure/paths-or-webhooks warning)
      const docWithWarning: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Warning Doc', version: '1.0.0' },
        components: {
          schemas: {
            User: { type: 'string' },
          },
        },
      }

      // By default failOnSeverity is 'error', so warning does not halt
      expect(() => generateZodFromSpec(docWithWarning)).not.toThrow()

      // When failOnSeverity is 'warning', it should halt and throw
      expect(() => generateZodFromSpec(docWithWarning, { failOnSeverity: 'warning' })).toThrow(
        ZodGenerationPreflightError,
      )
    })
  })

  describe('R2: Automatic Schema Normalization', () => {
    it('normalizes collection noise (empty servers/tags) and sorts schema keys by default', () => {
      const noisyDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Noisy API', version: '1.0.0', contact: {} },
        servers: [],
        tags: [],
        paths: {},
        components: {
          schemas: {
            Profile: {
              type: 'object',
              properties: {
                zeta: { type: 'string' },
                alpha: { type: 'number' },
              },
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(noisyDoc)
      expect(tsCode).toContain('export const ProfileSchema = z.object({')
      // Deterministically sorted keys: alpha comes before zeta
      const alphaIndex = tsCode.indexOf('alpha:')
      const zetaIndex = tsCode.indexOf('zeta:')
      expect(alphaIndex).toBeGreaterThan(-1)
      expect(zetaIndex).toBeGreaterThan(-1)
      expect(alphaIndex).toBeLessThan(zetaIndex)
    })

    it('resolves internal pointer aliasing through deep cloning', () => {
      const sharedProps = { name: { type: 'string' } }
      const aliasedDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Aliased API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            User: { type: 'object', properties: sharedProps as any },
            Admin: { type: 'object', properties: sharedProps as any },
          },
        },
      }

      const tsCode = generateZodFromSpec(aliasedDoc)
      expect(tsCode).toContain('export const AdminSchema = z.object({')
      expect(tsCode).toContain('export const UserSchema = z.object({')
    })

    it('bypasses normalization when normalize: false is explicitly passed', () => {
      // Document object where normalization would deep-clone
      const rawDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Raw API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
            },
          },
        },
      }

      // With normalize: false, code generation succeeds directly on the input document
      const tsCode = generateZodFromSpec(rawDoc, { normalize: false })
      expect(tsCode).toContain('export const UserSchema = z.object({')
      expect(tsCode).toContain('name: z.string()')
    })
  })

  describe('Adversarial & Edge Cases', () => {
    it('formats error message containing BOTH pointer and file coordinates when basePath and source locations are provided', () => {
      const corruptDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Corrupt API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            BadSchema: 12345,
          },
        },
      }

      try {
        generateZodFromSpec(corruptDoc, {
          basePath: '/mock/openapi.yaml',
          lookupSourceLocation: (filePath, pointer) => {
            if (pointer === '/components/schemas/BadSchema') {
              return { line: 8, column: 5 }
            }
            return undefined
          },
        })
        expect.unreachable('Should have thrown ZodGenerationPreflightError')
      } catch (err) {
        expect(err).toBeInstanceOf(ZodGenerationPreflightError)
        const preflightErr = err as ZodGenerationPreflightError
        // Must include both the pointer coordinate AND the file coordinate
        expect(preflightErr.message).toContain('/components/schemas/BadSchema')
        expect(preflightErr.message).toContain('/mock/openapi.yaml:8:5')
        // Diagnostics array must also have source populated
        const diag = preflightErr.diagnostics.find(d => d.path === '/components/schemas/BadSchema')
        expect(diag?.source).toBeDefined()
        expect(diag?.source?.filePath).toBe('/mock/openapi.yaml')
        expect(diag?.source?.line).toBe(8)
        expect(diag?.source?.column).toBe(5)
      }
    })

    it('detects unresolvable relative external file $ref when basePath is configured', () => {
      const externalRefDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'External Ref API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Container: {
              type: 'object',
              properties: {
                item: { $ref: './non-existent-shared-schema.yaml#/components/schemas/SharedItem' },
              },
            },
          },
        },
      }

      expect(() =>
        generateZodFromSpec(externalRefDoc, {
          basePath: '/tmp/test-spec.yaml',
        }),
      ).toThrow(ZodGenerationPreflightError)

      try {
        generateZodFromSpec(externalRefDoc, {
          basePath: '/tmp/test-spec.yaml',
        })
      } catch (err) {
        expect(err).toBeInstanceOf(ZodGenerationPreflightError)
        const preflightErr = err as ZodGenerationPreflightError
        const externalDiag = preflightErr.diagnostics.find(d => d.rule === 'refs/valid-ref')
        expect(externalDiag).toBeDefined()
        expect(externalDiag?.severity).toBe('error')
      }
    })

    it('generates valid code for recursive schema definitions without false-positive validation errors', () => {
      const recursiveDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Recursive API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            TreeNode: {
              type: 'object',
              required: ['value'],
              properties: {
                value: { type: 'string' },
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TreeNode' },
                },
              },
            },
          },
        },
      }

      // Must not throw under default settings
      const tsCode = generateZodFromSpec(recursiveDoc)
      expect(tsCode).toContain('export const TreeNodeSchema: z.ZodTypeAny = z.object({')
      expect(tsCode).toContain('children: z.array(z.lazy(() => TreeNodeSchema)).optional()')
    })

    it('supports valid boolean schemas (true and false) in components.schemas without false-positive validation failure', () => {
      const booleanSchemaDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Boolean Schemas API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            AllowAll: true as any,
            BlockAll: false as any,
          },
        },
      }

      // Must not throw preflight error on valid OAS 3.1/3.2 boolean schemas
      const tsCode = generateZodFromSpec(booleanSchemaDoc)
      expect(tsCode).toContain('export const AllowAllSchema = z.unknown()')
      expect(tsCode).toContain('export const BlockAllSchema = z.never()')
    })

    it('safely handles null and non-object documents in best-effort mode without crashing with TypeError', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Under force: true, null doc should not throw TypeError
      expect(() => generateZodFromSpec(null as any, { force: true })).not.toThrow()
      const codeForNull = generateZodFromSpec(null as any, { force: true })
      expect(codeForNull).toContain("import { z } from 'zod'")

      // Under validate: false, null doc should also proceed cleanly
      expect(() => generateZodFromSpec(null as any, { validate: false })).not.toThrow()
      const codeNoVal = generateZodFromSpec(null as any, { validate: false })
      expect(codeNoVal).toContain("import { z } from 'zod'")

      // Under force: true, primitive doc (e.g. string) should not throw TypeError
      expect(() => generateZodFromSpec('invalid-doc' as any, { force: true })).not.toThrow()

      warnSpy.mockRestore()
    })

    it('safely handles corrupt components.schemas primitive values under best-effort mode', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const corruptDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Corrupt Schemas', version: '1.0.0' },
        paths: {},
        components: {
          schemas: 'not-an-object',
        },
      }

      // Under force: true, should not iterate characters of 'not-an-object'
      const tsCode = generateZodFromSpec(corruptDoc, { force: true })
      expect(tsCode).not.toContain('_0Schema')
      expect(tsCode).toContain("import { z } from 'zod'")

      warnSpy.mockRestore()
    })

    it('supports mutually recursive schema graphs without false-positive preflight halts', () => {
      const mutualDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Mutual Recursion API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            User: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                organization: { $ref: '#/components/schemas/Organization' },
              },
            },
            Organization: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                members: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/User' },
                },
              },
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(mutualDoc)
      expect(tsCode).toContain('export const UserSchema: z.ZodTypeAny = z.object({')
      expect(tsCode).toContain('export const OrganizationSchema: z.ZodTypeAny = z.object({')
      expect(tsCode).toContain('organization: z.lazy(() => OrganizationSchema).optional()')
      expect(tsCode).toContain('members: z.array(z.lazy(() => UserSchema)).optional()')
    })

    it('detects circular in-memory object references (YAML anchor loops) and halts with structure/circular-anchor', () => {
      const cyclicDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Cyclic Anchor API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: {},
            },
          },
        },
      }
      cyclicDoc.components.schemas.Node.properties.self = cyclicDoc.components.schemas.Node

      expect(() => generateZodFromSpec(cyclicDoc)).toThrow(ZodGenerationPreflightError)

      try {
        generateZodFromSpec(cyclicDoc)
      } catch (err) {
        expect(err).toBeInstanceOf(ZodGenerationPreflightError)
        const preflightErr = err as ZodGenerationPreflightError
        const cycleDiag = preflightErr.diagnostics.find(d => d.rule === 'structure/circular-anchor')
        expect(cycleDiag).toBeDefined()
        expect(cycleDiag?.path).toBe('/components/schemas/Node/properties/self')
        expect(cycleDiag?.message).toContain('YAML anchor cycle')
      }
    })

    it('proceeds best-effort on circular in-memory object references under force: true without RangeError', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const cyclicDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Cyclic Anchor API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: {},
            },
          },
        },
      }
      cyclicDoc.components.schemas.Node.properties.self = cyclicDoc.components.schemas.Node

      const tsCode = generateZodFromSpec(cyclicDoc, { force: true })
      expect(tsCode).toContain('export const NodeSchema: z.ZodTypeAny = z.object({')
      expect(tsCode).toContain('self: z.lazy(() => NodeSchema).optional()')
      expect(warnSpy).toHaveBeenCalled()

      warnSpy.mockRestore()
    })

    it('proceeds best-effort on circular in-memory object references under validate: false without RangeError', () => {
      const cyclicDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Cyclic Anchor API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: {},
            },
          },
        },
      }
      cyclicDoc.components.schemas.Node.properties.self = cyclicDoc.components.schemas.Node

      const tsCode = generateZodFromSpec(cyclicDoc, { validate: false })
      expect(tsCode).toContain('export const NodeSchema: z.ZodTypeAny = z.object({')
      expect(tsCode).toContain('self: z.lazy(() => NodeSchema).optional()')
    })

    it('handles circular in-memory object references under normalize: false safely', () => {
      const cyclicDoc: any = {
        openapi: '3.2.0',
        info: { title: 'Cyclic Anchor API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: {},
            },
          },
        },
      }
      cyclicDoc.components.schemas.Node.properties.self = cyclicDoc.components.schemas.Node

      // Default validation halts with ZodGenerationPreflightError (not unhandled RangeError)
      expect(() => generateZodFromSpec(cyclicDoc, { normalize: false })).toThrow(ZodGenerationPreflightError)

      // With force: true and normalize: false, succeeds best-effort
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const tsCode = generateZodFromSpec(cyclicDoc, { normalize: false, force: true })
      expect(tsCode).toContain('export const NodeSchema: z.ZodTypeAny = z.object({')
      warnSpy.mockRestore()
    })

    it('supports schema names with special characters (slashes, tildes, dots, dashes) and resolves RFC 6901 refs', () => {
      const specialDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Special Chars API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            'user/profile': {
              type: 'object',
              properties: {
                username: { type: 'string' },
              },
            },
            'config~v1': {
              type: 'object',
              properties: {
                active: { type: 'boolean' },
              },
            },
            'App.Container': {
              type: 'object',
              properties: {
                profile: { $ref: '#/components/schemas/user~1profile' },
                config: { $ref: '#/components/schemas/config~0v1' },
              },
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(specialDoc)
      expect(tsCode).toContain('export const UserProfileSchema = z.object({')
      expect(tsCode).toContain('export const ConfigV1Schema = z.object({')
      expect(tsCode).toContain('export const AppContainerSchema = z.object({')
      expect(tsCode).toContain('profile: z.lazy(() => UserProfileSchema).optional()')
      expect(tsCode).toContain('config: z.lazy(() => ConfigV1Schema).optional()')
    })

    it('disambiguates schema identifier collisions gracefully', () => {
      const collisionDoc: OasDocument = {
        openapi: '3.2.0',
        info: { title: 'Collision API', version: '1.0.0' },
        paths: {},
        components: {
          schemas: {
            'user-profile': {
              type: 'object',
              properties: { a: { type: 'string' } },
            },
            user_profile: {
              type: 'object',
              properties: { b: { type: 'number' } },
            },
          },
        },
      }

      const tsCode = generateZodFromSpec(collisionDoc)
      expect(tsCode).toContain('export const UserProfileSchema = z.object({')
      expect(tsCode).toContain('export const UserProfile2Schema = z.object({')
      expect(tsCode).toContain('export type UserProfile = z.infer<typeof UserProfileSchema>')
      expect(tsCode).toContain('export type UserProfile2 = z.infer<typeof UserProfile2Schema>')
    })
  })
})
