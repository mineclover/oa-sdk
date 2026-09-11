import { describe, it, expect } from 'vitest'
import {
  createInMemoryProgram,
  detectCyclesWithChecker,
  resolveAlias,
  getCanonicalSymbolId,
} from './helpers/cycles.js'
import ts from 'typescript'

describe('Tier 1: Checker-Resolved Symbol ID Cycle Detection (Features 11–14)', () => {
  // =========================================================================
  // Feature 11: TypeChecker Program Management
  // =========================================================================
  describe('F11: TypeChecker Program Management', () => {
    function getFile(program: ts.Program, relPath: string): ts.SourceFile {
      const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath
      const file = program.getSourceFiles().find(f => f.fileName.endsWith(clean))
      if (!file) {
        throw new Error(`File not found: ${relPath} in program files: ${program.getSourceFiles().map(f => f.fileName).join(', ')}`)
      }
      return file
    }

    it('T1-F11-1: creates in-memory ts.Program and TypeChecker with virtual host', () => {
      const program = createInMemoryProgram({
        'user.ts': 'export interface User { id: string; }',
      })
      expect(program).toBeDefined()
      const checker = program.getTypeChecker()
      expect(checker).toBeDefined()
    })

    it('T1-F11-2: loads multi-file virtual source tree into a unified program instance', () => {
      const program = createInMemoryProgram({
        'models/a.ts': 'export interface A { name: string; }',
        'models/b.ts': 'import { A } from "./a"; export interface B { a: A; }',
      })
      const sourceFiles = program.getSourceFiles().filter(f => !f.isDeclarationFile)
      expect(sourceFiles.length).toBe(2)
      expect(sourceFiles.some(f => f.fileName.endsWith('models/a.ts'))).toBe(true)
      expect(sourceFiles.some(f => f.fileName.endsWith('models/b.ts'))).toBe(true)
    })

    it('T1-F11-3: resolves standard library declarations (string, number, Promise, Date)', () => {
      const program = createInMemoryProgram({
        'api.ts': 'export interface ApiResult { createdAt: Date; items: string[]; count: number; }',
      })
      const sf = getFile(program, 'api.ts')
      expect(sf).toBeDefined()
      const diags = program.getSemanticDiagnostics(sf)
      expect(diags).toHaveLength(0)
    })

    it('T1-F11-4: exposes TypeScript compiler diagnostics without throwing exceptions', () => {
      const program = createInMemoryProgram({
        'broken.ts': 'export interface Broken { field: NonExistentType; }',
      })
      const sf = getFile(program, 'broken.ts')
      const diags = program.getSemanticDiagnostics(sf)
      expect(diags.length).toBeGreaterThan(0)
      expect(diags[0].messageText.toString()).toContain('NonExistentType')
    })

    it('T1-F11-5: respects custom compiler options (e.g. strictNullChecks, noImplicitAny)', () => {
      const program = createInMemoryProgram(
        {
          'types.ts': 'export interface Config { val: string | null; }',
        },
        { strictNullChecks: true },
      )
      const sf = getFile(program, 'types.ts')
      const diags = program.getSemanticDiagnostics(sf)
      expect(diags).toHaveLength(0)
    })
  })

  // =========================================================================
  // Feature 12: Canonical Symbol ID Resolution
  // =========================================================================
  describe('F12: Canonical Symbol ID Resolution', () => {
    function getFile(program: ts.Program, relPath: string): ts.SourceFile {
      const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath
      return program.getSourceFiles().find(f => f.fileName.endsWith(clean))!
    }

    it('T1-F12-1: resolves local interface declaration to unique canonical symbol ID', () => {
      const program = createInMemoryProgram({
        'model.ts': 'export interface Item { id: string; }',
      })
      const sf = getFile(program, 'model.ts')
      const checker = program.getTypeChecker()
      const stmt = sf.statements[0] as ts.InterfaceDeclaration
      const symbol = checker.getSymbolAtLocation(stmt.name)!
      const symId = getCanonicalSymbolId(symbol)
      expect(symId).toBeDefined()
      expect(typeof symId).toBe('number')
      expect(symId).toBeGreaterThan(0)
    })

    it('T1-F12-2: resolves imported type reference to the canonical declaration symbol ID', () => {
      const program = createInMemoryProgram({
        'orig.ts': 'export interface Target { val: number; }',
        'consumer.ts': 'import { Target } from "./orig"; export interface Consumer { t: Target; }',
      })
      const checker = program.getTypeChecker()
      const origSf = getFile(program, 'orig.ts')
      const consSf = getFile(program, 'consumer.ts')

      const targetDecl = origSf.statements[0] as ts.InterfaceDeclaration
      const targetSymbol = checker.getSymbolAtLocation(targetDecl.name)!
      const targetId = getCanonicalSymbolId(targetSymbol)

      const consDecl = consSf.statements[1] as ts.InterfaceDeclaration
      const member = consDecl.members[0] as ts.PropertySignature
      const refNode = member.type as ts.TypeReferenceNode
      const importedSymbol = checker.getSymbolAtLocation(refNode.typeName)!
      const canonicalSymbol = resolveAlias(importedSymbol, checker)

      expect(getCanonicalSymbolId(canonicalSymbol)).toBe(targetId)
    })

    it('T1-F12-3: follows re-export barrel chain and resolves to identical original symbol ID', () => {
      const program = createInMemoryProgram({
        'source.ts': 'export interface Entity { key: string; }',
        'barrel.ts': 'export { Entity as AliasedEntity } from "./source";',
        'app.ts': 'import { AliasedEntity } from "./barrel"; export interface App { e: AliasedEntity; }',
      })
      const checker = program.getTypeChecker()
      const sourceSf = getFile(program, 'source.ts')
      const appSf = getFile(program, 'app.ts')

      const originalSymbol = checker.getSymbolAtLocation((sourceSf.statements[0] as ts.InterfaceDeclaration).name)!
      const originalId = getCanonicalSymbolId(originalSymbol)

      const appDecl = appSf.statements[1] as ts.InterfaceDeclaration
      const prop = appDecl.members[0] as ts.PropertySignature
      const ref = prop.type as ts.TypeReferenceNode
      const sym = checker.getSymbolAtLocation(ref.typeName)!
      const canonical = resolveAlias(sym, checker)

      expect(getCanonicalSymbolId(canonical)).toBe(originalId)
    })

    it('T1-F12-4: disambiguates identically named symbols across different files', () => {
      const program = createInMemoryProgram({
        'modA.ts': 'export interface Node { a: string; }',
        'modB.ts': 'export interface Node { b: number; }',
      })
      const checker = program.getTypeChecker()
      const sfA = getFile(program, 'modA.ts')
      const sfB = getFile(program, 'modB.ts')

      const symA = checker.getSymbolAtLocation((sfA.statements[0] as ts.InterfaceDeclaration).name)!
      const symB = checker.getSymbolAtLocation((sfB.statements[0] as ts.InterfaceDeclaration).name)!

      expect(getCanonicalSymbolId(symA)).not.toBe(getCanonicalSymbolId(symB))
    })

    it('T1-F12-5: resolves aliased type references inside union or property signatures', () => {
      const program = createInMemoryProgram({
        'base.ts': 'export type Status = "ok" | "err";',
        'use.ts': 'import { Status } from "./base"; export interface Wrapper { status: Status | null; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.symbolIdMap.size).toBe(2)
      expect(result.schemaDependencies.get('/use.ts:Wrapper')).toContain('/base.ts:Status')
    })
  })

  // =========================================================================
  // Feature 13: Cross-Module Dependency Graph
  // =========================================================================
  describe('F13: Cross-Module Dependency Graph', () => {
    it('T1-F13-1: constructs directed dependency graph across module boundaries', () => {
      const program = createInMemoryProgram({
        'a.ts': 'import { B } from "./b"; export interface A { b: B; }',
        'b.ts': 'export interface B { id: string; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.schemaDependencies.get('/a.ts:A')).toContain('/b.ts:B')
      expect(result.schemaDependencies.get('/b.ts:B')?.size).toBe(0)
    })

    it('T1-F13-2: correctly registers forward references between files', () => {
      const program = createInMemoryProgram({
        'order.ts': 'import { Customer } from "./customer"; export interface Order { customer: Customer; }',
        'customer.ts': 'export interface Customer { name: string; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.schemaDependencies.get('/order.ts:Order')?.has('/customer.ts:Customer')).toBe(true)
    })

    it('T1-F13-3: excludes external library and built-in type references from schema dependencies', () => {
      const program = createInMemoryProgram({
        'profile.ts': 'export interface Profile { createdAt: Date; tags: string[]; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.schemaDependencies.get('/profile.ts:Profile')?.size).toBe(0)
    })

    it('T1-F13-4: builds transitive reference chains A -> B -> C across 3 files', () => {
      const program = createInMemoryProgram({
        'f1.ts': 'import { B } from "./f2"; export interface A { b: B; }',
        'f2.ts': 'import { C } from "./f3"; export interface B { c: C; }',
        'f3.ts': 'export interface C { value: string; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.schemaDependencies.get('/f1.ts:A')).toContain('/f2.ts:B')
      expect(result.schemaDependencies.get('/f2.ts:B')).toContain('/f3.ts:C')
      expect(result.schemaDependencies.get('/f3.ts:C')?.size).toBe(0)
    })

    it('T1-F13-5: handles diamond dependency graphs (A -> B, A -> C, B -> D, C -> D)', () => {
      const program = createInMemoryProgram({
        'top.ts': 'import { B } from "./left"; import { C } from "./right"; export interface Top { b: B; c: C; }',
        'left.ts': 'import { Bottom } from "./bottom"; export interface B { bottom: Bottom; }',
        'right.ts': 'import { Bottom } from "./bottom"; export interface C { bottom: Bottom; }',
        'bottom.ts': 'export interface Bottom { id: string; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.schemaDependencies.get('/top.ts:Top')?.size).toBe(2)
      expect(result.schemaDependencies.get('/left.ts:B')).toContain('/bottom.ts:Bottom')
      expect(result.schemaDependencies.get('/right.ts:C')).toContain('/bottom.ts:Bottom')
      expect(result.cyclicSchemaIds.size).toBe(0)
    })
  })

  // =========================================================================
  // Feature 14: Precision DFS Cycle Detection
  // =========================================================================
  describe('F14: Precision DFS Cycle Detection', () => {
    it('T1-F14-1: detects direct self-recursion within a single declaration', () => {
      const program = createInMemoryProgram({
        'tree.ts': 'export interface TreeNode { value: string; parent?: TreeNode; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.has('/tree.ts:TreeNode')).toBe(true)
    })

    it('T1-F14-2: detects 2-node mutual recursion across separate module files', () => {
      const program = createInMemoryProgram({
        'user.ts': 'import { Role } from "./role"; export interface User { roles: Role[]; }',
        'role.ts': 'import { User } from "./user"; export interface Role { members: User[]; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.has('/user.ts:User')).toBe(true)
      expect(result.cyclicSchemaIds.has('/role.ts:Role')).toBe(true)
    })

    it('T1-F14-3: detects 3-node cycle spanning multiple files (A -> B -> C -> A)', () => {
      const program = createInMemoryProgram({
        'nodeA.ts': 'import { NodeB } from "./nodeB"; export interface NodeA { next: NodeB; }',
        'nodeB.ts': 'import { NodeC } from "./nodeC"; export interface NodeB { next: NodeC; }',
        'nodeC.ts': 'import { NodeA } from "./nodeA"; export interface NodeC { next: NodeA; }',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.has('/nodeA.ts:NodeA')).toBe(true)
      expect(result.cyclicSchemaIds.has('/nodeB.ts:NodeB')).toBe(true)
      expect(result.cyclicSchemaIds.has('/nodeC.ts:NodeC')).toBe(true)
    })

    it('T1-F14-4: resolves mutual recursion through aliased re-export barrel file', () => {
      const program = createInMemoryProgram({
        'schemaA.ts': 'import { AliasB } from "./barrel"; export interface SchemaA { b: AliasB; }',
        'schemaB.ts': 'import { SchemaA } from "./schemaA"; export interface SchemaB { a: SchemaA; }',
        'barrel.ts': 'export { SchemaB as AliasB } from "./schemaB";',
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.has('/schemaA.ts:SchemaA')).toBe(true)
      expect(result.cyclicSchemaIds.has('/schemaB.ts:SchemaB')).toBe(true)
    })

    it('T1-F14-5: isolates non-cyclic branches in a mixed graph containing both cyclic and acyclic types', () => {
      const program = createInMemoryProgram({
        'graph.ts': `
          export interface Cyclic1 { next: Cyclic2; }
          export interface Cyclic2 { next: Cyclic1; }
          export interface AcyclicLeaf { id: string; }
          export interface AcyclicRoot { leaf: AcyclicLeaf; }
        `,
      })
      const result = detectCyclesWithChecker(program)
      expect(result.cyclicSchemaIds.has('/graph.ts:Cyclic1')).toBe(true)
      expect(result.cyclicSchemaIds.has('/graph.ts:Cyclic2')).toBe(true)
      expect(result.cyclicSchemaIds.has('/graph.ts:AcyclicLeaf')).toBe(false)
      expect(result.cyclicSchemaIds.has('/graph.ts:AcyclicRoot')).toBe(false)
    })
  })
})
