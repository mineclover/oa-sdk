import { describe, it, expect } from 'vitest'
import {
  classifyTypeShape,
  auditTypeShapesInSource,
  extractDeclarationShape,
  type ContractShapeFeature,
} from '@oa-sdk/ast-sync'
import { runAuditShapeCli } from './helpers/cli.js'
import ts from 'typescript'

describe('Tier 1: Type Shape Taxonomy & Feasibility Diagnostics (Features 1–4)', () => {
  // =========================================================================
  // Feature 1: TypeScript Syntax Feature Taxonomy
  // =========================================================================
  describe('F1: TypeScript Syntax Feature Taxonomy (24 features)', () => {
    function parseFirstDecl(code: string): ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
      const sf = ts.createSourceFile('test.ts', code, ts.ScriptTarget.Latest, true)
      return sf.statements[0] as ts.InterfaceDeclaration | ts.TypeAliasDeclaration
    }

    it('T1-F1-1: identifies scalar primitive literals and type references', () => {
      const decl = parseFirstDecl('export type Status = "active" | "inactive";')
      const shape = extractDeclarationShape(decl)
      expect(shape.features).toContain('literal')
      expect(shape.features).toContain('union')
    })

    it('T1-F1-2: identifies compound structural features: object, array, tuple, intersection', () => {
      const decl = parseFirstDecl('export interface User { profile: { tags: string[]; tuple: [number, boolean] } & { id: string } }')
      const shape = extractDeclarationShape(decl)
      expect(shape.features).toContain('object')
      expect(shape.features).toContain('array')
      expect(shape.features).toContain('tuple')
      expect(shape.features).toContain('intersection')
    })

    it('T1-F1-3: identifies advanced type constructs: conditional, mapped, indexed-access, type-operator, type-query', () => {
      const decl = parseFirstDecl('export type Transformed<T> = { [K in keyof T]?: T[K] extends string ? typeof K : never };')
      const shape = extractDeclarationShape(decl)
      expect(shape.features).toContain('conditional')
      expect(shape.features).toContain('mapped')
      expect(shape.features).toContain('indexed-access')
      expect(shape.features).toContain('type-operator')
      expect(shape.features).toContain('type-query')
    })

    it('T1-F1-4: identifies generic declarations, generic instantiations, and utility types (Record, Partial)', () => {
      const decl = parseFirstDecl('export interface Container<T> { items: Record<string, T>; }')
      const shape = extractDeclarationShape(decl)
      expect(shape.features).toContain('generic-declaration')
      expect(shape.features).toContain('generic-instantiation')
      expect(shape.features).toContain('utility-type')
      expect(shape.features).toContain('reference')
    })

    it('T1-F1-5: identifies nullability, undefined, optional properties, and inheritance', () => {
      const decl = parseFirstDecl('export interface Base { id: string; } export interface Sub extends Base { opt?: string; nil: null; un: undefined; }')
      const sf = ts.createSourceFile('test.ts', 'export interface Base { id: string; } export interface Sub extends Base { opt?: string; nil: null; un: undefined; }', ts.ScriptTarget.Latest, true)
      const subDecl = sf.statements[1] as ts.InterfaceDeclaration
      const shape = extractDeclarationShape(subDecl)
      expect(shape.features).toContain('inheritance')
      expect(shape.features).toContain('optional')
      expect(shape.features).toContain('nullable')
      expect(shape.features).toContain('undefined')
    })
  })

  // =========================================================================
  // Feature 2: Tripartite Projection Classification
  // =========================================================================
  describe('F2: Tripartite Projection Classification', () => {
    it('T1-F2-1: classifies direct portable schemas with primitives, objects, unions, and arrays as direct', () => {
      const features = new Set<ContractShapeFeature>(['object', 'array', 'literal', 'union', 'intersection'])
      const result = classifyTypeShape(features)
      expect(result.typeSpecProjection).toBe('direct')
      expect(result.features).toEqual(['array', 'intersection', 'literal', 'object', 'union'])
    })

    it('T1-F2-2: classifies types containing tuple, undefined, or utility-type as policy-required', () => {
      const tupleShape = classifyTypeShape(new Set<ContractShapeFeature>(['object', 'tuple']))
      expect(tupleShape.typeSpecProjection).toBe('policy-required')

      const undefinedShape = classifyTypeShape(new Set<ContractShapeFeature>(['union', 'undefined']))
      expect(undefinedShape.typeSpecProjection).toBe('policy-required')

      const utilityShape = classifyTypeShape(new Set<ContractShapeFeature>(['object', 'utility-type', 'generic-instantiation']))
      expect(utilityShape.typeSpecProjection).toBe('policy-required')
    })

    it('T1-F2-3: classifies types containing conditional, mapped, or indexed-access as unsupported', () => {
      const condShape = classifyTypeShape(new Set<ContractShapeFeature>(['conditional', 'union']))
      expect(condShape.typeSpecProjection).toBe('unsupported')

      const mappedShape = classifyTypeShape(new Set<ContractShapeFeature>(['mapped', 'object']))
      expect(mappedShape.typeSpecProjection).toBe('unsupported')

      const indexedShape = classifyTypeShape(new Set<ContractShapeFeature>(['indexed-access']))
      expect(indexedShape.typeSpecProjection).toBe('unsupported')
    })

    it('T1-F2-4: enforces strict precedence: unsupported > policy-required > direct', () => {
      // Both unsupported (conditional) and policy-required (tuple) are present -> must be unsupported
      const mixedShape = classifyTypeShape(new Set<ContractShapeFeature>(['conditional', 'tuple', 'object']))
      expect(mixedShape.typeSpecProjection).toBe('unsupported')

      // Both policy-required (utility-type) and direct (array) are present -> must be policy-required
      const policyDirect = classifyTypeShape(new Set<ContractShapeFeature>(['utility-type', 'array', 'object']))
      expect(policyDirect.typeSpecProjection).toBe('policy-required')
    })

    it('T1-F2-5: classifies mutually recursive reference shapes as direct with recursive-reference tag', () => {
      const recursiveDirect = classifyTypeShape(new Set<ContractShapeFeature>(['object', 'reference', 'recursive-reference']))
      expect(recursiveDirect.typeSpecProjection).toBe('direct')
      expect(recursiveDirect.features).toContain('recursive-reference')
    })
  })

  // =========================================================================
  // Feature 3: AST Shape Diagnostics Engine
  // =========================================================================
  describe('F3: AST Shape Diagnostics Engine', () => {
    it('T1-F3-1: provides exact line and column coordinates for unsupported syntax nodes', () => {
      const source = [
        '// Line 1',
        'export type Broken<T> = { [K in keyof T]: T[K] };',
      ].join('\n')
      const audit = auditTypeShapesInSource(source, 'contracts.ts')
      expect(audit.valid).toBe(false)
      expect(audit.diagnostics.length).toBeGreaterThan(0)
      const mappedDiag = audit.diagnostics.find(d => d.feature === 'mapped')
      expect(mappedDiag).toBeDefined()
      expect(mappedDiag?.file).toBe('contracts.ts')
      expect(mappedDiag?.line).toBe(2)
      expect([1, 25]).toContain(mappedDiag?.column)
    })

    it('T1-F3-2: assigns severity error and code unsupported-shape to unsupported constructs', () => {
      const source = 'export type Conditional<T> = T extends string ? true : false;'
      const audit = auditTypeShapesInSource(source)
      expect(audit.valid).toBe(false)
      const diag = audit.diagnostics.find(d => d.feature === 'conditional')
      expect(diag?.severity).toBe('error')
      expect(diag?.code).toBe('unsupported-shape')
    })

    it('T1-F3-3: assigns severity warning and code policy-required-shape to policy constructs', () => {
      const source = 'export type Pair = [string, number];'
      const audit = auditTypeShapesInSource(source)
      expect(audit.valid).toBe(true) // Warnings do not invalidate file
      const diag = audit.diagnostics.find(d => d.feature === 'tuple')
      expect(diag?.severity).toBe('warning')
      expect(diag?.code).toBe('policy-required-shape')
    })

    it('T1-F3-4: includes code snippet from source in diagnostic record', () => {
      const source = 'export type Bad = { [k: string]: any } extends object ? number : string;'
      const audit = auditTypeShapesInSource(source)
      expect(audit.diagnostics.length).toBeGreaterThan(0)
      expect(audit.diagnostics[0]?.snippet).toBeDefined()
      expect(audit.diagnostics[0]?.snippet?.length).toBeGreaterThan(0)
    })

    it('T1-F3-5: accurately tallies scanned declarations across the entire file', () => {
      const source = [
        'export interface User { id: string; }',
        'export interface Post { title: string; }',
        'export type Id = string;',
      ].join('\n')
      const audit = auditTypeShapesInSource(source)
      expect(audit.valid).toBe(true)
      expect(audit.scannedDeclarations).toBe(3)
      expect(audit.scannedFiles).toBe(1)
      expect(audit.diagnostics.length).toBe(0)
    })
  })

  // =========================================================================
  // Feature 4: CLI Command `oa-gen audit:shape`
  // =========================================================================
  describe('F4: CLI Command `oa-gen audit:shape`', () => {
    it('T1-F4-1: exits with code 0 on clean portable TypeScript bundle', async () => {
      const cleanCode = 'export interface Product { id: string; price: number; tags: string[]; }'
      const result = await runAuditShapeCli({ bundle: 'clean.ts' }, () => cleanCode)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Audited 1 file(s), 1 declaration(s)')
    })

    it('T1-F4-2: formats terminal diagnostics with badges and coordinate pointers', async () => {
      const brokenCode = 'export type Mapped<T> = { [K in keyof T]: string };'
      const result = await runAuditShapeCli({ bundle: 'broken.ts' }, () => brokenCode)
      expect(result.stdout).toContain('❌')
      expect(result.stdout).toContain('broken.ts:1:1')
      expect(result.stdout).toContain('unsupported-shape')
    })

    it('T1-F4-3: exits with code 1 when --fail-on-unsupported is passed on unsupported types', async () => {
      const brokenCode = 'export type Complex<T> = T extends string ? number : boolean;'
      const result = await runAuditShapeCli({ bundle: 'complex.ts', failOnUnsupported: true }, () => brokenCode)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Audit failed with unsupported type shapes')
    })

    it('T1-F4-4: outputs machine-readable JSON structure with --format json', async () => {
      const source = 'export type Coordinate = [number, number];'
      const result = await runAuditShapeCli({ bundle: 'coord.ts', format: 'json' }, () => source)
      expect(result.exitCode).toBe(0)
      const parsed = JSON.parse(result.stdout)
      expect(parsed.scannedDeclarations).toBe(1)
      expect(parsed.diagnostics[0].feature).toBe('tuple')
    })

    it('T1-F4-5: rejects missing bundle parameter with exit code 1 and error message', async () => {
      const result = await runAuditShapeCli({})
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Missing required option --bundle')
    })
  })
})
