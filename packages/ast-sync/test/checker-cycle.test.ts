import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createVirtualProgram,
  createInMemoryProgram,
  createProgramFromTsconfig,
  cleanupProgram,
  getTypeChecker,
  detectCyclesWithChecker,
  getCanonicalSymbolId,
  resolveAlias,
  referencedSymbols,
  cyclicSchemaIds,
  withRecursiveReference,
  markRecursiveDeclaration,
} from '../src/index.js';

describe('Milestone 4: Checker-Resolved Symbol ID Cycle Detection', () => {
  function getFile(program: ts.Program, relPath: string): ts.SourceFile {
    const clean = relPath.startsWith('/') ? relPath.slice(1) : relPath;
    const file = program.getSourceFiles().find((f) => f.fileName.endsWith(clean));
    if (!file) {
      throw new Error(
        `File not found: ${relPath} in program files: ${program.getSourceFiles().map((f) => f.fileName).join(', ')}`
      );
    }
    return file;
  }

  // =========================================================================
  // Suite 1: Program & TypeChecker Management
  // =========================================================================
  describe('Program & TypeChecker Management', () => {
    it('creates virtual in-memory ts.Program and TypeChecker', () => {
      const program = createVirtualProgram({
        'user.ts': 'export interface User { id: string; }',
      });
      try {
        expect(program).toBeDefined();
        const checker = getTypeChecker(program);
        expect(checker).toBeDefined();
        expect(program.getSourceFiles().some((f) => f.fileName.endsWith('user.ts'))).toBe(true);
      } finally {
        cleanupProgram(program);
      }
    });

    it('supports createInMemoryProgram alias and cleans up resources', () => {
      const program = createInMemoryProgram({
        'item.ts': 'export interface Item { name: string; }',
      });
      const tempDir = (program as any).__tempDir;
      expect(fs.existsSync(tempDir)).toBe(true);
      cleanupProgram(program);
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('loads multi-file virtual source tree into unified program', () => {
      const program = createVirtualProgram({
        'models/a.ts': 'export interface A { name: string; }',
        'models/b.ts': 'import { A } from "./a"; export interface B { a: A; }',
      });
      try {
        const sourceFiles = program.getSourceFiles().filter((f) => !f.isDeclarationFile);
        expect(sourceFiles.length).toBe(2);
        expect(sourceFiles.some((f) => f.fileName.endsWith('models/a.ts'))).toBe(true);
        expect(sourceFiles.some((f) => f.fileName.endsWith('models/b.ts'))).toBe(true);
      } finally {
        cleanupProgram(program);
      }
    });

    it('resolves standard library types (string, number, Date, Promise)', () => {
      const program = createVirtualProgram({
        'api.ts': 'export interface ApiResult { createdAt: Date; items: string[]; count: number; }',
      });
      try {
        const sf = getFile(program, 'api.ts');
        const diags = program.getSemanticDiagnostics(sf);
        expect(diags).toHaveLength(0);
      } finally {
        cleanupProgram(program);
      }
    });

    it('exposes compiler diagnostics for broken types without throwing', () => {
      const program = createVirtualProgram({
        'broken.ts': 'export interface Broken { field: NonExistentType; }',
      });
      try {
        const sf = getFile(program, 'broken.ts');
        const diags = program.getSemanticDiagnostics(sf);
        expect(diags.length).toBeGreaterThan(0);
        expect(diags[0].messageText.toString()).toContain('NonExistentType');
      } finally {
        cleanupProgram(program);
      }
    });

    it('respects custom compiler options', () => {
      const program = createVirtualProgram(
        {
          'config.ts': 'export interface Config { val: string | null; }',
        },
        { strictNullChecks: true }
      );
      try {
        const sf = getFile(program, 'config.ts');
        const diags = program.getSemanticDiagnostics(sf);
        expect(diags).toHaveLength(0);
      } finally {
        cleanupProgram(program);
      }
    });

    it('constructs ts.Program from real disk tsconfig.json', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-tsconfig-test-'));
      try {
        fs.writeFileSync(
          path.join(dir, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
            include: ['src'],
          })
        );
        fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
        fs.writeFileSync(
          path.join(dir, 'src', 'index.ts'),
          'export interface ServerConfig { port: number; }'
        );

        const program = createProgramFromTsconfig(path.join(dir, 'tsconfig.json'));
        expect(program).toBeDefined();
        const sf = getFile(program, 'src/index.ts');
        expect(sf).toBeDefined();
        const checker = program.getTypeChecker();
        expect(checker).toBeDefined();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('throws descriptive error if tsconfig does not exist', () => {
      expect(() => {
        createProgramFromTsconfig('/non/existent/path/tsconfig.json');
      }).toThrow(/tsconfig file not found/);
    });

    it('throws descriptive error if tsconfig has invalid JSON syntax', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-bad-tsconfig-'));
      try {
        fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{ invalid json syntax');
        expect(() => {
          createProgramFromTsconfig(path.join(dir, 'tsconfig.json'));
        }).toThrow(/Failed to (read|parse) tsconfig/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // =========================================================================
  // Suite 2: Canonical Symbol ID Resolution & Alias Dereferencing
  // =========================================================================
  describe('Canonical Symbol ID Resolution & Alias Dereferencing', () => {
    it('resolves local declaration to unique positive integer symbol ID', () => {
      const program = createVirtualProgram({
        'model.ts': 'export interface Item { id: string; }',
      });
      try {
        const sf = getFile(program, 'model.ts');
        const checker = program.getTypeChecker();
        const stmt = sf.statements[0] as ts.InterfaceDeclaration;
        const symbol = checker.getSymbolAtLocation(stmt.name)!;
        const symId = getCanonicalSymbolId(symbol);
        expect(symId).toBeDefined();
        expect(typeof symId).toBe('number');
        expect(symId).toBeGreaterThan(0);
      } finally {
        cleanupProgram(program);
      }
    });

    it('resolves imported type reference to the canonical declaration symbol ID', () => {
      const program = createVirtualProgram({
        'orig.ts': 'export interface Target { val: number; }',
        'consumer.ts': 'import { Target } from "./orig"; export interface Consumer { t: Target; }',
      });
      try {
        const checker = program.getTypeChecker();
        const origSf = getFile(program, 'orig.ts');
        const consSf = getFile(program, 'consumer.ts');

        const targetDecl = origSf.statements[0] as ts.InterfaceDeclaration;
        const targetSymbol = checker.getSymbolAtLocation(targetDecl.name)!;
        const targetId = getCanonicalSymbolId(targetSymbol);

        const consDecl = consSf.statements[1] as ts.InterfaceDeclaration;
        const member = consDecl.members[0] as ts.PropertySignature;
        const refNode = member.type as ts.TypeReferenceNode;
        const importedSymbol = checker.getSymbolAtLocation(refNode.typeName)!;
        const canonicalSymbol = resolveAlias(importedSymbol, checker);

        expect(getCanonicalSymbolId(canonicalSymbol)).toBe(targetId);
      } finally {
        cleanupProgram(program);
      }
    });

    it('resolves multi-hop re-export barrel chain to canonical origin symbol ID', () => {
      const program = createVirtualProgram({
        'source.ts': 'export interface Entity { key: string; }',
        'barrel1.ts': 'export { Entity as FirstAlias } from "./source";',
        'barrel2.ts': 'export { FirstAlias as SecondAlias } from "./barrel1";',
        'app.ts': 'import { SecondAlias } from "./barrel2"; export interface App { e: SecondAlias; }',
      });
      try {
        const checker = program.getTypeChecker();
        const sourceSf = getFile(program, 'source.ts');
        const appSf = getFile(program, 'app.ts');

        const origSymbol = checker.getSymbolAtLocation(
          (sourceSf.statements[0] as ts.InterfaceDeclaration).name
        )!;
        const origId = getCanonicalSymbolId(origSymbol);

        const appDecl = appSf.statements[1] as ts.InterfaceDeclaration;
        const prop = appDecl.members[0] as ts.PropertySignature;
        const ref = prop.type as ts.TypeReferenceNode;
        const sym = checker.getSymbolAtLocation(ref.typeName)!;
        const canonical = resolveAlias(sym, checker);

        expect(getCanonicalSymbolId(canonical)).toBe(origId);
      } finally {
        cleanupProgram(program);
      }
    });

    it('resolves aliased import (import { Type as LocalAlias }) to canonical declaration symbol ID', () => {
      const program = createVirtualProgram({
        'origin.ts': 'export interface Master { id: string; }',
        'consumer.ts': 'import { Master as LocalAlias } from "./origin"; export interface Consumer { m: LocalAlias; }',
      });
      try {
        const checker = program.getTypeChecker();
        const origSf = getFile(program, 'origin.ts');
        const consSf = getFile(program, 'consumer.ts');

        const origSym = checker.getSymbolAtLocation(
          (origSf.statements[0] as ts.InterfaceDeclaration).name
        )!;
        const origId = getCanonicalSymbolId(origSym);

        const consDecl = consSf.statements[1] as ts.InterfaceDeclaration;
        const prop = consDecl.members[0] as ts.PropertySignature;
        const ref = prop.type as ts.TypeReferenceNode;
        const sym = checker.getSymbolAtLocation(ref.typeName)!;
        const canonical = resolveAlias(sym, checker);

        expect(getCanonicalSymbolId(canonical)).toBe(origId);
      } finally {
        cleanupProgram(program);
      }
    });

    it('disambiguates identically named symbols across separate files', () => {
      const program = createVirtualProgram({
        'modA.ts': 'export interface Node { a: string; }',
        'modB.ts': 'export interface Node { b: number; }',
      });
      try {
        const checker = program.getTypeChecker();
        const sfA = getFile(program, 'modA.ts');
        const sfB = getFile(program, 'modB.ts');

        const symA = checker.getSymbolAtLocation(
          (sfA.statements[0] as ts.InterfaceDeclaration).name
        )!;
        const symB = checker.getSymbolAtLocation(
          (sfB.statements[0] as ts.InterfaceDeclaration).name
        )!;

        expect(getCanonicalSymbolId(symA)).not.toBe(getCanonicalSymbolId(symB));
      } finally {
        cleanupProgram(program);
      }
    });
  });

  // =========================================================================
  // Suite 3: Cross-Module Dependency Graph
  // =========================================================================
  describe('Cross-Module Dependency Graph', () => {
    it('constructs directed dependency graph across module boundaries', () => {
      const program = createVirtualProgram({
        'a.ts': 'import { B } from "./b"; export interface A { b: B; }',
        'b.ts': 'export interface B { id: string; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.schemaDependencies.get('/a.ts:A')).toContain('/b.ts:B');
        expect(result.schemaDependencies.get('/b.ts:B')?.size).toBe(0);
      } finally {
        cleanupProgram(program);
      }
    });

    it('correctly registers forward references between files', () => {
      const program = createVirtualProgram({
        'order.ts': 'import { Customer } from "./customer"; export interface Order { customer: Customer; }',
        'customer.ts': 'export interface Customer { name: string; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.schemaDependencies.get('/order.ts:Order')?.has('/customer.ts:Customer')).toBe(true);
      } finally {
        cleanupProgram(program);
      }
    });

    it('excludes external library and built-in type references from schema dependencies', () => {
      const program = createVirtualProgram({
        'profile.ts': 'export interface Profile { createdAt: Date; tags: string[]; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.schemaDependencies.get('/profile.ts:Profile')?.size).toBe(0);
      } finally {
        cleanupProgram(program);
      }
    });

    it('builds transitive reference chains A -> B -> C across 3 files', () => {
      const program = createVirtualProgram({
        'f1.ts': 'import { B } from "./f2"; export interface A { b: B; }',
        'f2.ts': 'import { C } from "./f3"; export interface B { c: C; }',
        'f3.ts': 'export interface C { value: string; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.schemaDependencies.get('/f1.ts:A')).toContain('/f2.ts:B');
        expect(result.schemaDependencies.get('/f2.ts:B')).toContain('/f3.ts:C');
        expect(result.schemaDependencies.get('/f3.ts:C')?.size).toBe(0);
      } finally {
        cleanupProgram(program);
      }
    });

    it('handles diamond dependency graphs without cycle false positives', () => {
      const program = createVirtualProgram({
        'top.ts': 'import { B } from "./left"; import { C } from "./right"; export interface Top { b: B; c: C; }',
        'left.ts': 'import { Bottom } from "./bottom"; export interface B { bottom: Bottom; }',
        'right.ts': 'import { Bottom } from "./bottom"; export interface C { bottom: Bottom; }',
        'bottom.ts': 'export interface Bottom { id: string; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.schemaDependencies.get('/top.ts:Top')?.size).toBe(2);
        expect(result.schemaDependencies.get('/left.ts:B')).toContain('/bottom.ts:Bottom');
        expect(result.schemaDependencies.get('/right.ts:C')).toContain('/bottom.ts:Bottom');
        expect(result.cyclicSchemaIds.size).toBe(0);
      } finally {
        cleanupProgram(program);
      }
    });

    it('captures inheritance dependencies via extends clause', () => {
      const program = createVirtualProgram({
        'base.ts': 'export interface BaseEntity { id: string; }',
        'derived.ts': 'import { BaseEntity } from "./base"; export interface UserEntity extends BaseEntity { name: string; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.schemaDependencies.get('/derived.ts:UserEntity')).toContain('/base.ts:BaseEntity');
        expect(result.cyclicSchemaIds.size).toBe(0);
      } finally {
        cleanupProgram(program);
      }
    });
  });

  // =========================================================================
  // Suite 4: Precision DFS Cycle Detection
  // =========================================================================
  describe('Precision DFS Cycle Detection', () => {
    it('detects direct self-recursion in single declaration (linked list / binary tree)', () => {
      const program = createVirtualProgram({
        'list.ts': 'export interface LinkedListNode { value: number; next?: LinkedListNode; }',
        'tree.ts': 'export interface BinaryTreeNode { value: string; left?: BinaryTreeNode; right?: BinaryTreeNode; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.has('/list.ts:LinkedListNode')).toBe(true);
        expect(result.cyclicSchemaIds.has('/tree.ts:BinaryTreeNode')).toBe(true);
      } finally {
        cleanupProgram(program);
      }
    });

    it('detects 2-node mutual recursion across separate files', () => {
      const program = createVirtualProgram({
        'user.ts': 'import { Role } from "./role"; export interface User { roles: Role[]; }',
        'role.ts': 'import { User } from "./user"; export interface Role { members: User[]; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.has('/user.ts:User')).toBe(true);
        expect(result.cyclicSchemaIds.has('/role.ts:Role')).toBe(true);
        expect(result.cyclicSchemaIds.size).toBe(2);
      } finally {
        cleanupProgram(program);
      }
    });

    it('detects 3-node cycle spanning multiple files (A -> B -> C -> A)', () => {
      const program = createVirtualProgram({
        'nodeA.ts': 'import { NodeB } from "./nodeB"; export interface NodeA { next: NodeB; }',
        'nodeB.ts': 'import { NodeC } from "./nodeC"; export interface NodeB { next: NodeC; }',
        'nodeC.ts': 'import { NodeA } from "./nodeA"; export interface NodeC { next: NodeA; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.has('/nodeA.ts:NodeA')).toBe(true);
        expect(result.cyclicSchemaIds.has('/nodeB.ts:NodeB')).toBe(true);
        expect(result.cyclicSchemaIds.has('/nodeC.ts:NodeC')).toBe(true);
        expect(result.cyclicSchemaIds.size).toBe(3);
      } finally {
        cleanupProgram(program);
      }
    });

    it('resolves mutual recursion through aliased re-export barrel file', () => {
      const program = createVirtualProgram({
        'schemaA.ts': 'import { AliasB } from "./barrel"; export interface SchemaA { b: AliasB; }',
        'schemaB.ts': 'import { SchemaA } from "./schemaA"; export interface SchemaB { a: SchemaA; }',
        'barrel.ts': 'export { SchemaB as AliasB } from "./schemaB";',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.has('/schemaA.ts:SchemaA')).toBe(true);
        expect(result.cyclicSchemaIds.has('/schemaB.ts:SchemaB')).toBe(true);
        expect(result.cyclicSchemaIds.size).toBe(2);
      } finally {
        cleanupProgram(program);
      }
    });

    it('resolves barrel re-export cycle through index.ts files in subfolders', () => {
      const program = createVirtualProgram({
        'subA/index.ts': 'import { TypeB } from "../subB"; export interface TypeA { b: TypeB; }',
        'subB/index.ts': 'import { TypeA } from "../subA"; export interface TypeB { a: TypeA; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.has('/subA/index.ts:TypeA')).toBe(true);
        expect(result.cyclicSchemaIds.has('/subB/index.ts:TypeB')).toBe(true);
        expect(result.cyclicSchemaIds.size).toBe(2);
      } finally {
        cleanupProgram(program);
      }
    });

    it('isolates non-cyclic branches in mixed graph containing both cyclic and acyclic types', () => {
      const program = createVirtualProgram({
        'cyclic.ts': 'export interface C1 { next: C2; } export interface C2 { next: C1; }',
        'acyclic.ts': 'export interface AcyclicLeaf { id: string; } export interface AcyclicRoot { leaf: AcyclicLeaf; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.has('/cyclic.ts:C1')).toBe(true);
        expect(result.cyclicSchemaIds.has('/cyclic.ts:C2')).toBe(true);
        expect(result.cyclicSchemaIds.has('/acyclic.ts:AcyclicLeaf')).toBe(false);
        expect(result.cyclicSchemaIds.has('/acyclic.ts:AcyclicRoot')).toBe(false);
      } finally {
        cleanupProgram(program);
      }
    });

    it('accurately resolves diamond dependency graph with inner cyclic sub-loop', () => {
      const program = createVirtualProgram({
        'diamond.ts': `
          export interface Top { left: Left; right: Right; }
          export interface Left { sub: SubLoop1; }
          export interface Right { val: string; }
          export interface SubLoop1 { loop: SubLoop2; }
          export interface SubLoop2 { loop: SubLoop1; }
        `,
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.size).toBe(2);
        const ids = Array.from(result.cyclicSchemaIds);
        expect(ids.some((id) => id.includes('SubLoop1'))).toBe(true);
        expect(ids.some((id) => id.includes('SubLoop2'))).toBe(true);
        expect(ids.some((id) => id.includes('Top'))).toBe(false);
        expect(ids.some((id) => id.includes('Left'))).toBe(false);
        expect(ids.some((id) => id.includes('Right'))).toBe(false);
      } finally {
        cleanupProgram(program);
      }
    });
  });

  // =========================================================================
  // Suite 5: ContractShapeFeature Tagging with 'recursive-reference'
  // =========================================================================
  describe('Contract Shape Feature Tagging with recursive-reference', () => {
    it('marks cyclic declarations with recursive-reference in declarationShapes', () => {
      const program = createVirtualProgram({
        'models.ts': `
          export interface NodeA { b: NodeB; }
          export interface NodeB { a: NodeA; }
          export interface Standalone { val: string; }
        `,
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.declarationShapes).toBeDefined();

        const shapeA = result.declarationShapes?.get('/models.ts:NodeA');
        const shapeB = result.declarationShapes?.get('/models.ts:NodeB');
        const shapeS = result.declarationShapes?.get('/models.ts:Standalone');

        expect(shapeA?.features).toContain('recursive-reference');
        expect(shapeB?.features).toContain('recursive-reference');
        expect(shapeS?.features).not.toContain('recursive-reference');

        expect(shapeA?.typeSpecProjection).toBe('direct');
        expect(shapeB?.typeSpecProjection).toBe('direct');
        expect(shapeS?.typeSpecProjection).toBe('direct');
      } finally {
        cleanupProgram(program);
      }
    });

    it('withRecursiveReference / markRecursiveDeclaration helper adds feature and updates classification', () => {
      const baseShape = {
        features: ['object' as const, 'reference' as const],
        typeSpecProjection: 'direct' as const,
      };
      const augmented = withRecursiveReference(baseShape);
      expect(augmented.features).toContain('recursive-reference');
      expect(augmented.features).toContain('object');
      expect(augmented.features).toContain('reference');
      expect(augmented.typeSpecProjection).toBe('direct');

      const aliased = markRecursiveDeclaration(baseShape);
      expect(aliased.features).toContain('recursive-reference');
    });
  });

  // =========================================================================
  // Suite 6: Parity with Samchon Reference Test Suite
  // =========================================================================
  describe('Parity with Samchon Reference Test Suite', () => {
    it('classifies portable, policy-required, and unsupported schema shapes with cycle resolution', () => {
      const program = createVirtualProgram({
        'contracts.ts': `
          export interface Node { next?: Node | null; metadata: Record<string, 'internal' | 'public'>; }
          export type Result = ({ code: 'ok' } & { value: string }) | { code: 'error'; message: string };
          export type Page<T> = T[];
          export type Derived<T> = { [K in keyof T]?: T[K] extends string ? \`\${K & string}:\${T[K]}\` : never };
          export type UndefinedValue = string | undefined;
          export interface MutualA { b: MutualB; }
          export interface MutualB { a: MutualA; }
        `,
      });
      try {
        const result = detectCyclesWithChecker(program);

        // Mutual recursion detected
        expect(result.cyclicSchemaIds.has('/contracts.ts:MutualA')).toBe(true);
        expect(result.cyclicSchemaIds.has('/contracts.ts:MutualB')).toBe(true);
        // Self-recursion on Node detected
        expect(result.cyclicSchemaIds.has('/contracts.ts:Node')).toBe(true);

        // Acyclic declarations
        expect(result.cyclicSchemaIds.has('/contracts.ts:Result')).toBe(false);
        expect(result.cyclicSchemaIds.has('/contracts.ts:Page')).toBe(false);
        expect(result.cyclicSchemaIds.has('/contracts.ts:Derived')).toBe(false);
        expect(result.cyclicSchemaIds.has('/contracts.ts:UndefinedValue')).toBe(false);

        // Verify shape features on Node
        const shapeNode = result.declarationShapes?.get('/contracts.ts:Node');
        expect(shapeNode).toBeDefined();
        expect(shapeNode?.features).toContain('recursive-reference');
        expect(shapeNode?.features).toContain('generic-instantiation');
        expect(shapeNode?.features).toContain('utility-type');
        expect(shapeNode?.typeSpecProjection).toBe('policy-required');

        // Verify shape features on Result
        const shapeResult = result.declarationShapes?.get('/contracts.ts:Result');
        expect(shapeResult).toBeDefined();
        expect(shapeResult?.features).toContain('union');
        expect(shapeResult?.features).toContain('intersection');
        expect(shapeResult?.features).toContain('literal');
        expect(shapeResult?.typeSpecProjection).toBe('direct');

        // Verify shape features on Page
        const shapePage = result.declarationShapes?.get('/contracts.ts:Page');
        expect(shapePage).toBeDefined();
        expect(shapePage?.features).toContain('array');
        expect(shapePage?.features).toContain('generic-declaration');
        expect(shapePage?.typeSpecProjection).toBe('policy-required');

        // Verify shape features on Derived
        const shapeDerived = result.declarationShapes?.get('/contracts.ts:Derived');
        expect(shapeDerived).toBeDefined();
        expect(shapeDerived?.features).toContain('conditional');
        expect(shapeDerived?.features).toContain('mapped');
        expect(shapeDerived?.typeSpecProjection).toBe('unsupported');

        // Verify shape features on MutualA and MutualB
        const shapeMutualA = result.declarationShapes?.get('/contracts.ts:MutualA');
        const shapeMutualB = result.declarationShapes?.get('/contracts.ts:MutualB');
        expect(shapeMutualA?.features).toContain('recursive-reference');
        expect(shapeMutualA?.typeSpecProjection).toBe('direct');
        expect(shapeMutualB?.features).toContain('recursive-reference');
        expect(shapeMutualB?.typeSpecProjection).toBe('direct');
      } finally {
        cleanupProgram(program);
      }
    });

    it('cross-file mutual recursion parity between separate files', () => {
      const program = createVirtualProgram({
        'contractsA.ts': 'import { MutualB } from "./contractsB"; export interface MutualA { b: MutualB; }',
        'contractsB.ts': 'import { MutualA } from "./contractsA"; export interface MutualB { a: MutualA; }',
      });
      try {
        const result = detectCyclesWithChecker(program);
        expect(result.cyclicSchemaIds.size).toBe(2);
        expect(result.cyclicSchemaIds.has('/contractsA.ts:MutualA')).toBe(true);
        expect(result.cyclicSchemaIds.has('/contractsB.ts:MutualB')).toBe(true);

        const shapeA = result.declarationShapes?.get('/contractsA.ts:MutualA');
        const shapeB = result.declarationShapes?.get('/contractsB.ts:MutualB');
        expect(shapeA?.features).toContain('recursive-reference');
        expect(shapeB?.features).toContain('recursive-reference');
        expect(shapeA?.typeSpecProjection).toBe('direct');
        expect(shapeB?.typeSpecProjection).toBe('direct');
      } finally {
        cleanupProgram(program);
      }
    });
  });
});
