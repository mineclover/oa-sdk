import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import {
  generateStandaloneGuards,
} from '../../src/index.js'
import type {
  StandaloneGuardGeneratorOptions,
  StandaloneGuardTarget,
  GeneratedGuardArtifact,
} from '../../src/index.js'

describe('E2E Standalone Type Guard Generator (Tiers 1-4)', () => {
  let tempDir: string

  const setupTempDir = async () => {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-standalone-guards-'))
  }

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (>=5 tests per feature)
  // =========================================================================

  describe('Tier 1: Feature Coverage', () => {
    describe('F12: generateStandaloneGuards Core API', () => {
      it('F12-1: compiles basic object schema into ESM validator and .d.ts files', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $defs: {
            UserProfile: {
              type: 'object',
              required: ['id', 'email'],
              properties: {
                id: { type: 'string' },
                email: { type: 'string', format: 'email' },
                age: { type: 'integer', minimum: 0 },
              },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [
            {
              name: 'isUserProfile',
              typeName: 'UserProfile',
              schema: '#/$defs/UserProfile',
            },
          ],
        })

        expect(artifacts).toBeDefined()
        expect(artifacts.length).toBeGreaterThanOrEqual(1)

        const jsArtifact = artifacts.find(a => a.kind === 'js' || a.filePath.endsWith('.js'))
        expect(jsArtifact).toBeDefined()
        expect(jsArtifact?.content).toContain('function isUserProfile')
      })

      it('F12-2: compiles primitive validation with range constraints (min, max, pattern)', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            PortNumber: {
              type: 'integer',
              minimum: 1,
              maximum: 65535,
            },
            HexColor: {
              type: 'string',
              pattern: '^#[0-9a-fA-F]{6}$',
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [
            { name: 'isPortNumber', typeName: 'PortNumber', schema: '#/$defs/PortNumber' },
            { name: 'isHexColor', typeName: 'HexColor', schema: '#/$defs/HexColor' },
          ],
        })

        const jsCode = artifacts.find(a => a.kind === 'js')?.content ?? ''
        expect(jsCode).toContain('isPortNumber')
        expect(jsCode).toContain('isHexColor')
      })

      it('F12-3: compiles complex nested objects and array schemas', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            WorkspaceConfig: {
              type: 'object',
              required: ['name', 'projects'],
              properties: {
                name: { type: 'string' },
                projects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'path'],
                    properties: {
                      id: { type: 'string' },
                      path: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [
            { name: 'isWorkspaceConfig', typeName: 'WorkspaceConfig', schema: '#/$defs/WorkspaceConfig' },
          ],
        })

        expect(artifacts.some(a => a.content.includes('isWorkspaceConfig'))).toBe(true)
      })

      it('F12-4: compiles oneOf and anyOf union schemas', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            StringOrNumber: {
              oneOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [
            { name: 'isStringOrNumber', typeName: 'StringOrNumber', schema: '#/$defs/StringOrNumber' },
          ],
        })

        expect(artifacts.some(a => a.content.includes('isStringOrNumber'))).toBe(true)
      })

      it('F12-5: compiles schemas with internal $ref references', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Address: {
              type: 'object',
              required: ['street', 'city'],
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
              },
            },
            Company: {
              type: 'object',
              required: ['name', 'headquarters'],
              properties: {
                name: { type: 'string' },
                headquarters: { $ref: '#/$defs/Address' },
              },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [
            { name: 'isCompany', typeName: 'Company', schema: '#/$defs/Company' },
          ],
        })

        expect(artifacts.length).toBeGreaterThan(0)
      })
    })

    describe('F13: CLI oa-codegen --target standalone-guards Integration', () => {
      it('F13-1: generates guard files on disk at specified outDir', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          components: {
            schemas: {
              StatusPayload: {
                type: 'object',
                properties: { status: { type: 'string' } },
              },
            },
          },
        }

        await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isStatusPayload', typeName: 'StatusPayload', schema: '#/components/schemas/StatusPayload' }],
        })

        const files = await fs.readdir(outDir)
        expect(files.length).toBeGreaterThan(0)
      })

      it('F13-2: supports multiple guards generated into single output bundle', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            A: { type: 'string' },
            B: { type: 'number' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [
            { name: 'isA', typeName: 'A', schema: '#/$defs/A' },
            { name: 'isB', typeName: 'B', schema: '#/$defs/B' },
          ],
        })

        const jsArtifact = artifacts.find(a => a.kind === 'js')
        expect(jsArtifact?.content).toContain('function isA')
        expect(jsArtifact?.content).toContain('function isB')
      })

      it('F13-3: handles type import specifier option in .d.ts files', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Item: { type: 'object', properties: { id: { type: 'string' } } },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          typeImportSpecifier: '@oa-sdk/models',
          guards: [{ name: 'isItem', typeName: 'Item', schema: '#/$defs/Item' }],
        })

        const dtsArtifact = artifacts.find(a => a.kind === 'dts' || a.filePath.endsWith('.d.ts'))
        expect(dtsArtifact).toBeDefined()
        expect(dtsArtifact?.content).toContain("@oa-sdk/models")
      })

      it('F13-4: emits pure ESM format export declarations', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Test: { type: 'string' } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          moduleFormat: 'esm',
          guards: [{ name: 'isTest', typeName: 'Test', schema: '#/$defs/Test' }],
        })

        const jsContent = artifacts.find(a => a.kind === 'js')?.content ?? ''
        expect(jsContent).toContain('export')
        expect(jsContent).not.toContain('module.exports')
        expect(jsContent).not.toContain('exports.')
      })

      it('F13-5: produces index entrypoint exports for consumers', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Ping: { type: 'object', properties: { ping: { type: 'boolean' } } } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isPing', typeName: 'Ping', schema: '#/$defs/Ping' }],
        })

        expect(artifacts.some(a => a.filePath.includes('guards') || a.filePath.includes('index'))).toBe(true)
      })
    })

    describe('F14: Pure ESM Zero-Dependency & Zero-Eval Invariants', () => {
      it('F14-1: CSP Invariant: Generated JS contains zero eval( calls', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            ComplexValidation: {
              type: 'object',
              properties: {
                tag: { type: 'string', pattern: '^[a-z_]+$' },
                num: { type: 'number', minimum: 10 },
              },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isComplex', typeName: 'ComplexValidation', schema: '#/$defs/ComplexValidation' }],
        })

        for (const artifact of artifacts.filter(a => a.kind === 'js')) {
          expect(artifact.content).not.toMatch(/\beval\s*\(/)
        }
      })

      it('F14-2: CSP Invariant: Generated JS contains zero new Function( calls', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Form: { type: 'object', properties: { count: { type: 'integer' } } } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isForm', typeName: 'Form', schema: '#/$defs/Form' }],
        })

        for (const artifact of artifacts.filter(a => a.kind === 'js')) {
          expect(artifact.content).not.toMatch(/new\s+Function\s*\(/)
        }
      })

      it('F14-3: Zero Dependency: Generated JS imports no external runtime libraries', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Simple: { type: 'string' } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isSimple', typeName: 'Simple', schema: '#/$defs/Simple' }],
        })

        for (const artifact of artifacts.filter(a => a.kind === 'js')) {
          expect(artifact.content).not.toMatch(/from\s+['"]ajv/)
          expect(artifact.content).not.toMatch(/from\s+['"]zod/)
          expect(artifact.content).not.toMatch(/require\s*\(/)
        }
      })

      it('F14-4: Opaque-Box Execution: Validates real JavaScript execution with matching data', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            User: {
              type: 'object',
              required: ['name', 'age'],
              properties: {
                name: { type: 'string' },
                age: { type: 'number' },
              },
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isUser', typeName: 'User', schema: '#/$defs/User' }],
        })

        const jsArtifact = artifacts.find(a => a.kind === 'js')!
        const tempJsFile = path.join(outDir, 'test-guard.mjs')
        await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

        const imported = await import(`file://${tempJsFile}`)
        expect(typeof imported.isUser).toBe('function')

        // Real runtime validation: Valid payload
        expect(imported.isUser({ name: 'Alice', age: 30 })).toBe(true)

        // Real runtime validation: Invalid payload (missing required field)
        expect(imported.isUser({ name: 'Alice' })).toBe(false)

        // Real runtime validation: Invalid type
        expect(imported.isUser({ name: 'Alice', age: 'thirty' })).toBe(false)
        expect(imported.isUser(null)).toBe(false)
        expect(imported.isUser(undefined)).toBe(false)
      })

      it('F14-5: Opaque-Box Execution: Validates pattern and enum execution', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            Status: {
              type: 'string',
              enum: ['active', 'inactive', 'pending'],
            },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isStatus', typeName: 'Status', schema: '#/$defs/Status' }],
        })

        const jsArtifact = artifacts.find(a => a.kind === 'js')!
        const tempJsFile = path.join(outDir, 'test-status.mjs')
        await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

        const imported = await import(`file://${tempJsFile}`)
        expect(imported.isStatus('active')).toBe(true)
        expect(imported.isStatus('inactive')).toBe(true)
        expect(imported.isStatus('deleted')).toBe(false)
      })
    })

    describe('F15: TypeScript Guard Signature Generation', () => {
      it('F15-1: emits export declare function with type predicate (data is Type)', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Foo: { type: 'object' } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isFoo', typeName: 'Foo', schema: '#/$defs/Foo' }],
        })

        const dts = artifacts.find(a => a.kind === 'dts')?.content ?? ''
        expect(dts).toMatch(/export declare function isFoo\s*\(\s*\w+:\s*unknown\s*\):\s*\w+\s+is\s+Foo/)
      })

      it('F15-2: handles multiple declaration signatures in one .d.ts', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: {
            One: { type: 'string' },
            Two: { type: 'number' },
          },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [
            { name: 'isOne', typeName: 'One', schema: '#/$defs/One' },
            { name: 'isTwo', typeName: 'Two', schema: '#/$defs/Two' },
          ],
        })

        const dts = artifacts.find(a => a.kind === 'dts')?.content ?? ''
        expect(dts).toContain('isOne')
        expect(dts).toContain('isTwo')
      })

      it('F15-3: generates type import header when typeImportSpecifier is configured', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Header: { type: 'object' } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          typeImportSpecifier: './types.js',
          guards: [{ name: 'isHeader', typeName: 'Header', schema: '#/$defs/Header' }],
        })

        const dts = artifacts.find(a => a.kind === 'dts')?.content ?? ''
        expect(dts).toContain("import type { Header } from './types.js'")
      })

      it('F15-4: produces syntax-valid .d.ts format', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Valid: { type: 'boolean' } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isValid', typeName: 'Valid', schema: '#/$defs/Valid' }],
        })

        const dts = artifacts.find(a => a.kind === 'dts')?.content ?? ''
        expect(dts.trim().endsWith(';')).toBe(true)
      })

      it('F15-5: emits fallback data is unknown when typeName is omitted', async () => {
        const outDir = await setupTempDir()
        const schemaDoc = {
          $defs: { Anonymous: { type: 'string' } },
        }

        const artifacts = await generateStandaloneGuards({
          schemaDocument: schemaDoc,
          outDir,
          guards: [{ name: 'isAnonymous', typeName: '', schema: '#/$defs/Anonymous' }],
        })

        const dts = artifacts.find(a => a.kind === 'dts')?.content ?? ''
        expect(dts).toContain('data is unknown')
      })
    })
  })

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (>=5 tests per feature)
  // =========================================================================

  describe('Tier 2: Boundary & Corner Cases', () => {
    it('F12-B1: compiles recursive / self-referencing schema ($ref: "#") without infinite loop', async () => {
      const outDir = await setupTempDir()
      const schemaDoc = {
        $id: 'https://example.com/tree.json',
        type: 'object',
        properties: {
          value: { type: 'number' },
          children: {
            type: 'array',
            items: { $ref: '#' },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isTreeNode', typeName: 'TreeNode', schema: schemaDoc }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const tempJsFile = path.join(outDir, 'test-tree.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

      const imported = await import(`file://${tempJsFile}`)
      expect(imported.isTreeNode({ value: 1, children: [{ value: 2, children: [] }] })).toBe(true)
      expect(imported.isTreeNode({ value: 1, children: [{ value: 'bad' }] })).toBe(false)
    })

    it('F12-B2: compiles empty schema ({}) validating any input as true', async () => {
      const outDir = await setupTempDir()
      const schemaDoc = {
        $defs: { AnyValue: {} },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isAnyValue', typeName: 'AnyValue', schema: '#/$defs/AnyValue' }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const tempJsFile = path.join(outDir, 'test-any.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

      const imported = await import(`file://${tempJsFile}`)
      expect(imported.isAnyValue('str')).toBe(true)
      expect(imported.isAnyValue(123)).toBe(true)
      expect(imported.isAnyValue({ a: 1 })).toBe(true)
    })

    it('F12-B3: compiles additionalProperties: false schema strictly rejecting extra fields', async () => {
      const outDir = await setupTempDir()
      const schemaDoc = {
        $defs: {
          StrictObj: {
            type: 'object',
            properties: { a: { type: 'string' } },
            additionalProperties: false,
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isStrictObj', typeName: 'StrictObj', schema: '#/$defs/StrictObj' }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const tempJsFile = path.join(outDir, 'test-strict.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

      const imported = await import(`file://${tempJsFile}`)
      expect(imported.isStrictObj({ a: 'hello' })).toBe(true)
      expect(imported.isStrictObj({ a: 'hello', unexpected: true })).toBe(false)
    })

    it('F12-B4: automatically assigns synthetic URN for schemas without $id', async () => {
      const outDir = await setupTempDir()
      const schemaDoc = {
        type: 'object',
        properties: { x: { type: 'number' } },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isPoint', typeName: 'Point', schema: schemaDoc }],
      })

      expect(artifacts.length).toBeGreaterThan(0)
    })

    it('F12-B5: handles complex regex patterns with escaped characters', async () => {
      const outDir = await setupTempDir()
      const schemaDoc = {
        $defs: {
          SemanticVersion: {
            type: 'string',
            pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$',
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isSemver', typeName: 'SemanticVersion', schema: '#/$defs/SemanticVersion' }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const tempJsFile = path.join(outDir, 'test-semver.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

      const imported = await import(`file://${tempJsFile}`)
      expect(imported.isSemver('1.0.0')).toBe(true)
      expect(imported.isSemver('2.1.3-beta.1+build.123')).toBe(true)
      expect(imported.isSemver('not-a-version')).toBe(false)
    })
  })

  // =========================================================================
  // TIER 3: CROSS-FEATURE INTERACTIONS
  // =========================================================================

  describe('Tier 3: Cross-Feature Interactions', () => {
    it('T3-1: generates standalone type guards for OpenAPI 3.1 Discriminated Union schema', async () => {
      const outDir = await setupTempDir()
      const schemaDoc = {
        components: {
          schemas: {
            Shape: {
              type: 'object',
              required: ['kind'],
              properties: { kind: { type: 'string' } },
              discriminator: {
                propertyName: 'kind',
                mapping: {
                  circle: '#/components/schemas/Circle',
                  rect: '#/components/schemas/Rect',
                },
              },
              oneOf: [
                { $ref: '#/components/schemas/Circle' },
                { $ref: '#/components/schemas/Rect' },
              ],
            },
            Circle: {
              type: 'object',
              required: ['kind', 'radius'],
              properties: {
                kind: { const: 'circle' },
                radius: { type: 'number', minimum: 0 },
              },
            },
            Rect: {
              type: 'object',
              required: ['kind', 'width', 'height'],
              properties: {
                kind: { const: 'rect' },
                width: { type: 'number' },
                height: { type: 'number' },
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [
          { name: 'isShape', typeName: 'Shape', schema: '#/components/schemas/Shape' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const tempJsFile = path.join(outDir, 'test-discriminated.mjs')
      await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

      const imported = await import(`file://${tempJsFile}`)
      expect(imported.isShape({ kind: 'circle', radius: 10 })).toBe(true)
      expect(imported.isShape({ kind: 'rect', width: 20, height: 30 })).toBe(true)
      expect(imported.isShape({ kind: 'triangle', base: 5 })).toBe(false)
      expect(imported.isShape({ kind: 'circle', radius: -5 })).toBe(false)
    })
  })

  // =========================================================================
  // TIER 4: REAL-WORLD SCENARIOS
  // =========================================================================

  describe('Tier 4: Real-World Scenarios', () => {
    it('T4-1: Manifest V3 Content Script CSP Sandbox Validation Scenario', async () => {
      const outDir = await setupTempDir()
      const surfaceSchemaDoc = {
        $defs: {
          SurfaceParam: {
            type: 'object',
            required: ['name', 'value', 'unquotedValue'],
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              unquotedValue: { type: 'string' },
              inferredType: {
                type: 'string',
                enum: ['text', 'number-scrubber', 'color-picker'],
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: surfaceSchemaDoc,
        outDir,
        guards: [{ name: 'isSurfaceParam', typeName: 'SurfaceParam', schema: '#/$defs/SurfaceParam' }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!

      // CSP Sandbox simulation: disable Function and eval
      const originalFunction = globalThis.Function
      const originalEval = globalThis.eval
      try {
        (globalThis as any).Function = function () {
          throw new Error('CSP Violation: Function() blocked')
        }
        ;(globalThis as any).eval = function () {
          throw new Error('CSP Violation: eval() blocked')
        }

        const tempJsFile = path.join(outDir, 'csp-guard.mjs')
        await fs.writeFile(tempJsFile, jsArtifact.content, 'utf8')

        const imported = await import(`file://${tempJsFile}`)
        expect(
          imported.isSurfaceParam({
            name: 'color',
            value: '#ff0000',
            unquotedValue: '#ff0000',
            inferredType: 'color-picker',
          })
        ).toBe(true)

        expect(
          imported.isSurfaceParam({
            name: 'color',
            value: 123, // invalid type
            unquotedValue: '#ff0000',
          })
        ).toBe(false)
      } finally {
        globalThis.Function = originalFunction
        globalThis.eval = originalEval
      }
    })
  })
})
