import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ts from 'typescript';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// Production imports from @oa-sdk/ast-sync
import {
  classifyTypeShape,
  collectShapeFeatures,
  analyzeNodeShape,
  auditTypeShapesInSource,
  getDeclarationShapesInSource,
  createVirtualProgram,
  createInMemoryProgram,
  detectCyclesWithChecker,
  getCanonicalSymbolId,
  resolveAlias,
  referencedSymbols,
  cyclicSchemaIds,
  withRecursiveReference,
  markRecursiveDeclaration,
  cleanupProgram,
  getTypeChecker,
  UNSUPPORTED_SHAPE_FEATURES,
  POLICY_REQUIRED_SHAPE_FEATURES,
  DIRECT_SHAPE_FEATURES,
  ALL_SHAPE_FEATURES,
  UTILITY_TYPE_NAMES,
  type ContractShapeFeature,
  type ContractTypeShape,
  type ShapeDiagnostic,
  type ShapeAuditResult,
} from '../../../packages/ast-sync/src/index.js';

// Production imports from @oa-sdk/parser
import {
  extractOperationsFromSource,
  extractOperationsFromFile,
  toOperationEntry,
  SUPPORTED_HTTP_METHODS,
  OA_OPERATION_REGEX,
  type ExtractedOperation,
  type OperationDiagnostic,
  type OperationExtractResult,
} from '../../../packages/parser/src/index.js';

// Production imports from @oa-sdk/codegen CLI
import {
  auditShapeCommand,
  auditShapeFiles,
  findTypeScriptFiles,
} from '../../../packages/codegen/src/cli/commands/audit-shape.js';

describe('EMPIRICAL CHALLENGER: Stress-Testing & Adversarial Verification', () => {

  // =========================================================================
  // CHALLENGE 1: Type Shape Taxonomy & Feasibility Diagnostics
  // =========================================================================
  describe('Challenge 1: Type Shape Taxonomy & Feasibility Diagnostics', () => {

    describe('1.1: Complex Syntax Constructs: Conditional Types', () => {
      it('evaluates direct conditional type as unsupported with feature conditional', () => {
        const source = 'export type IsString<T> = T extends string ? true : false;';
        const shapes = getDeclarationShapesInSource(source);
        const shape = shapes.get('IsString');
        expect(shape).toBeDefined();
        expect(shape!.features).toContain('conditional');
        expect(shape!.typeSpecProjection).toBe('unsupported');

        const audit = auditTypeShapesInSource(source, 'conditional.ts');
        expect(audit.valid).toBe(false);
        const diag = audit.diagnostics.find((d) => d.feature === 'conditional');
        expect(diag).toBeDefined();
        expect(diag!.code).toBe('unsupported-shape');
        expect(diag!.severity).toBe('error');
        expect(diag!.line).toBe(1);
        expect(diag!.column).toBe(27);
      });

      it('evaluates deeply nested conditional types as unsupported', () => {
        const source = `
          export type NestedCond<T, U, V> = T extends string
            ? (U extends number
                ? (V extends boolean ? 'bool' : 'not-bool')
                : 'not-num')
            : 'not-str';
        `;
        const audit = auditTypeShapesInSource(source, 'nested-cond.ts');
        expect(audit.valid).toBe(false);
        const condDiags = audit.diagnostics.filter((d) => d.feature === 'conditional');
        expect(condDiags.length).toBeGreaterThanOrEqual(1);
        expect(condDiags.every((d) => d.severity === 'error')).toBe(true);
      });

      it('evaluates distributive conditional over union', () => {
        const source = `export type ToArray<T> = T extends any ? T[] : never;`;
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('ToArray')!.typeSpecProjection).toBe('unsupported');
        expect(shapes.get('ToArray')!.features).toContain('conditional');
      });

      it('evaluates conditional inside interface property', () => {
        const source = `
          export interface WithCond {
            status: string extends number ? 'impossible' : 'possible';
          }
        `;
        const audit = auditTypeShapesInSource(source, 'iface-cond.ts');
        expect(audit.valid).toBe(false);
        const diag = audit.diagnostics.find((d) => d.feature === 'conditional');
        expect(diag).toBeDefined();
        expect(diag!.file).toBe('iface-cond.ts');
        expect(diag!.line).toBe(3);
      });
    });

    describe('1.2: Complex Syntax Constructs: Mapped Types', () => {
      it('evaluates basic mapped type as unsupported', () => {
        const source = 'export type StringMap = { [K in string]: number };';
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('StringMap')!.features).toContain('mapped');
        expect(shapes.get('StringMap')!.typeSpecProjection).toBe('unsupported');

        const audit = auditTypeShapesInSource(source);
        expect(audit.valid).toBe(false);
        expect(audit.diagnostics.some((d) => d.feature === 'mapped' && d.severity === 'error')).toBe(true);
      });

      it('evaluates key-remapped mapped type (as clause)', () => {
        const source = `
          export type Getters<T> = {
            [K in keyof T as \`get\${Capitalize<string & K>}\`]: () => T[K]
          };
        `;
        const audit = auditTypeShapesInSource(source);
        expect(audit.valid).toBe(false);
        const features = audit.diagnostics.map((d) => d.feature);
        expect(features).toContain('mapped');
      });

      it('evaluates modifier mapped type (-readonly / ?)', () => {
        const source = `export type MutablePartial<T> = { -readonly [K in keyof T]?: T[K] };`;
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('MutablePartial')!.features).toContain('mapped');
        expect(shapes.get('MutablePartial')!.typeSpecProjection).toBe('unsupported');
      });
    });

    describe('1.3: Complex Syntax Constructs: Indexed Access', () => {
      it('evaluates single-level indexed access as unsupported', () => {
        const source = `
          export interface Config { port: number; host: string; }
          export type Host = Config['host'];
        `;
        const audit = auditTypeShapesInSource(source, 'config.ts');
        const diag = audit.diagnostics.find((d) => d.feature === 'indexed-access');
        expect(diag).toBeDefined();
        expect(diag!.code).toBe('unsupported-shape');
        expect(diag!.severity).toBe('error');
        expect(diag!.line).toBe(3);
      });

      it('evaluates nested indexed access Deep[a][b][c]', () => {
        const source = `
          export interface Deep { a: { b: { c: string } } }
          export type C = Deep['a']['b']['c'];
        `;
        const audit = auditTypeShapesInSource(source);
        const diags = audit.diagnostics.filter((d) => d.feature === 'indexed-access');
        expect(diags.length).toBeGreaterThanOrEqual(1);
      });

      it('evaluates generic indexed access T[K]', () => {
        const source = `export type Prop<T, K extends keyof T> = T[K];`;
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('Prop')!.features).toContain('indexed-access');
        expect(shapes.get('Prop')!.typeSpecProjection).toBe('unsupported');
      });
    });

    describe('1.4: Complex Syntax Constructs: Template Literals', () => {
      it('evaluates simple template literal as unsupported', () => {
        const source = 'export type Event = `on${string}`;';
        const audit = auditTypeShapesInSource(source, 'events.ts');
        expect(audit.valid).toBe(false);
        const diag = audit.diagnostics.find((d) => d.feature === 'template-literal');
        expect(diag).toBeDefined();
        expect(diag!.severity).toBe('error');
        expect(diag!.line).toBe(1);
      });

      it('evaluates multi-placeholder template literal', () => {
        const source = 'export type Route = `/api/${"v1" | "v2"}/${string}`;';
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('Route')!.features).toContain('template-literal');
        expect(shapes.get('Route')!.typeSpecProjection).toBe('unsupported');
      });

      it('evaluates template literal in interface property', () => {
        const source = `
          export interface Msg {
            header: string;
            id: \`msg_\${number}\`;
          }
        `;
        const audit = auditTypeShapesInSource(source, 'msg.ts');
        const diag = audit.diagnostics.find((d) => d.feature === 'template-literal');
        expect(diag).toBeDefined();
        expect(diag!.line).toBe(4);
      });
    });

    describe('1.5: Utility Types & Tuples (Policy-Required)', () => {
      it('recognizes all 17 standard utility types as policy-required utility-type', () => {
        for (const util of UTILITY_TYPE_NAMES) {
          const source = `export type TestUtil = ${util}<any>;`;
          const shapes = getDeclarationShapesInSource(source);
          const shape = shapes.get('TestUtil');
          expect(shape).toBeDefined();
          expect(shape!.features).toContain('utility-type');
          expect(shape!.typeSpecProjection).toBe('policy-required');
        }
      });

      it('evaluates fixed-length, optional, rest, and labeled tuples as policy-required', () => {
        const source = `
          export type FixedTuple = [string, number];
          export type OptTuple = [string, number?];
          export type RestTuple = [string, ...boolean[]];
          export type LabeledTuple = [id: string, count: number];
          export type EmptyTuple = [];
        `;
        const audit = auditTypeShapesInSource(source, 'tuples.ts');
        expect(audit.valid).toBe(true); // Warnings do not make file invalid
        const tupleWarnings = audit.diagnostics.filter((d) => d.feature === 'tuple');
        expect(tupleWarnings.length).toBe(5);
        expect(tupleWarnings.every((w) => w.severity === 'warning')).toBe(true);
      });
    });

    describe('1.6: Intersections & Composite Types (Direct Projection)', () => {
      it('evaluates object literal intersection as direct', () => {
        const source = `export type Composite = { a: string } & { b: number };`;
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('Composite')!.typeSpecProjection).toBe('direct');
        expect(shapes.get('Composite')!.features).toContain('intersection');
        expect(shapes.get('Composite')!.features).toContain('object');
      });

      it('evaluates intersection of named references as direct', () => {
        const source = `
          export interface User { id: string; }
          export interface Timestamp { createdAt: string; }
          export type UserWithTime = User & Timestamp;
        `;
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('UserWithTime')!.typeSpecProjection).toBe('direct');
        expect(shapes.get('UserWithTime')!.features).toContain('intersection');
        expect(shapes.get('UserWithTime')!.features).toContain('reference');
      });

      it('evaluates union of intersections as direct', () => {
        const source = `
          export type Polymorphic = ({ tag: 'a' } & { val: string }) | ({ tag: 'b' } & { val: number });
        `;
        const shapes = getDeclarationShapesInSource(source);
        expect(shapes.get('Polymorphic')!.typeSpecProjection).toBe('direct');
        expect(shapes.get('Polymorphic')!.features).toContain('union');
        expect(shapes.get('Polymorphic')!.features).toContain('intersection');
      });
    });

    describe('1.7: Coordinate Precision & Snippet Verification', () => {
      it('verifies exact 1-indexed line and column coordinates and code snippet', () => {
        const source = [
          '// Header line 1',
          '// Header line 2',
          'export type BadType = Config["key"];',
        ].join('\n');

        const audit = auditTypeShapesInSource(source, 'source.ts');
        expect(audit.valid).toBe(false);
        const diag = audit.diagnostics.find((d) => d.feature === 'indexed-access')!;
        expect(diag).toBeDefined();
        expect(diag.line).toBe(3);
        expect(diag.column).toBe(23); // Position of Config["key"]
        expect(diag.snippet).toBe('export type BadType = Config["key"];');
      });
    });

    describe('1.8: CLI Command `oa-gen audit:shape` Integration', () => {
      let tempDir: string;

      beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-chal-shape-'));
      });

      afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
      });

      it('CLI exits cleanly on valid direct types', async () => {
        const cleanFile = path.join(tempDir, 'clean.ts');
        fs.writeFileSync(cleanFile, 'export interface Good { id: string; num: number; }');

        let output = '';
        const origLog = console.log;
        console.log = (msg: any) => { output += msg + '\n'; };
        try {
          await auditShapeCommand.run({ source: cleanFile });
          expect(output).toContain('TypeScript Shape Feasibility Audit');
          expect(output).toContain('✅ 0 shape issues found');
        } finally {
          console.log = origLog;
        }
      });

      it('CLI throws CliExitError(1) on unsupported types when --fail-on-unsupported is active', async () => {
        const brokenFile = path.join(tempDir, 'broken.ts');
        fs.writeFileSync(brokenFile, 'export type Bad = { [K in string]: number };');

        let caughtError: any;
        const origLog = console.log;
        console.log = () => {};
        try {
          await auditShapeCommand.run({ source: brokenFile, 'fail-on-unsupported': true });
        } catch (err) {
          caughtError = err;
        } finally {
          console.log = origLog;
        }

        expect(caughtError).toBeDefined();
        expect(caughtError.exitCode).toBe(1);
      });

      it('CLI does not throw when --no-fail-on-unsupported is set', async () => {
        const brokenFile = path.join(tempDir, 'broken.ts');
        fs.writeFileSync(brokenFile, 'export type Bad = { [K in string]: number };');

        let caughtError: any;
        const origLog = console.log;
        console.log = () => {};
        try {
          await auditShapeCommand.run({ source: brokenFile, 'no-fail-on-unsupported': true });
        } catch (err) {
          caughtError = err;
        } finally {
          console.log = origLog;
        }

        expect(caughtError).toBeUndefined();
      });

      it('CLI outputs valid JSON structure with --json flag', async () => {
        const file = path.join(tempDir, 'model.ts');
        fs.writeFileSync(file, 'export type Coord = [number, number];');

        let jsonOutput = '';
        const origLog = console.log;
        console.log = (msg: any) => { jsonOutput += msg; };
        try {
          await auditShapeCommand.run({ source: file, json: true });
          const parsed = JSON.parse(jsonOutput);
          expect(parsed.valid).toBe(true);
          expect(parsed.scannedDeclarations).toBe(1);
          expect(parsed.scannedFiles).toBe(1);
          expect(parsed.diagnostics).toHaveLength(1);
          expect(parsed.diagnostics[0].feature).toBe('tuple');
        } finally {
          console.log = origLog;
        }
      });
    });
  });

  // =========================================================================
  // CHALLENGE 2: Checker-Resolved Symbol ID Cycle Detection
  // =========================================================================
  describe('Challenge 2: Checker-Resolved Symbol ID Cycle Detection', () => {

    describe('2.1: Multi-Node Mutual Recursions (3, 4, 5 nodes)', () => {
      it('detects 3-node cycle across 3 separate files (A -> B -> C -> A)', () => {
        const program = createVirtualProgram({
          'a.ts': 'import { B } from "./b"; export interface A { b: B; }',
          'b.ts': 'import { C } from "./c"; export interface B { c: C; }',
          'c.ts': 'import { A } from "./a"; export interface C { a: A; }',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(3);
          expect(result.cyclicSchemaIds.has('/a.ts:A')).toBe(true);
          expect(result.cyclicSchemaIds.has('/b.ts:B')).toBe(true);
          expect(result.cyclicSchemaIds.has('/c.ts:C')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });

      it('detects 4-node cycle across 4 separate files (A -> B -> C -> D -> A)', () => {
        const program = createVirtualProgram({
          'n1.ts': 'import { N2 } from "./n2"; export interface N1 { next: N2; }',
          'n2.ts': 'import { N3 } from "./n3"; export interface N2 { next: N3; }',
          'n3.ts': 'import { N4 } from "./n4"; export interface N3 { next: N4; }',
          'n4.ts': 'import { N1 } from "./n1"; export interface N4 { next: N1; }',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(4);
          expect(result.cyclicSchemaIds.has('/n1.ts:N1')).toBe(true);
          expect(result.cyclicSchemaIds.has('/n2.ts:N2')).toBe(true);
          expect(result.cyclicSchemaIds.has('/n3.ts:N3')).toBe(true);
          expect(result.cyclicSchemaIds.has('/n4.ts:N4')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });

      it('detects 5-node cycle across 5 separate files (A -> B -> C -> D -> E -> A)', () => {
        const program = createVirtualProgram({
          'p1.ts': 'import { P2 } from "./p2"; export interface P1 { p: P2; }',
          'p2.ts': 'import { P3 } from "./p3"; export interface P2 { p: P3; }',
          'p3.ts': 'import { P4 } from "./p4"; export interface P3 { p: P4; }',
          'p4.ts': 'import { P5 } from "./p5"; export interface P4 { p: P5; }',
          'p5.ts': 'import { P1 } from "./p1"; export interface P5 { p: P1; }',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(5);
        } finally {
          cleanupProgram(program);
        }
      });
    });

    describe('2.2: Barrel Re-Export Hops (Multi-Hop Resolution)', () => {
      it('resolves 2-hop barrel chain: index.ts -> sub.ts -> model.ts with mutual cycle', () => {
        const program = createVirtualProgram({
          'models/modelA.ts': 'import { ModelB } from "../index"; export interface ModelA { b: ModelB; }',
          'models/modelB.ts': 'import { ModelA } from "./modelA"; export interface ModelB { a: ModelA; }',
          'models/sub.ts': 'export { ModelB } from "./modelB";',
          'index.ts': 'export { ModelB } from "./models/sub";',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.has('/models/modelA.ts:ModelA')).toBe(true);
          expect(result.cyclicSchemaIds.has('/models/modelB.ts:ModelB')).toBe(true);
          expect(result.cyclicSchemaIds.size).toBe(2);
        } finally {
          cleanupProgram(program);
        }
      });

      it('resolves 3-hop barrel chain with alias renames at each hop', () => {
        const program = createVirtualProgram({
          'origin.ts': 'import { Hop3 } from "./hop2"; export interface Origin { loop: Hop3; }',
          'hop1.ts': 'export { Origin as Hop1 } from "./origin";',
          'hop2.ts': 'export { Hop1 as Hop2 } from "./hop1"; export { Hop2 as Hop3 } from "./hop2";',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.has('/origin.ts:Origin')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });
    });

    describe('2.3: Aliased Imports', () => {
      it('resolves multiple aliased imports from the same file to identical canonical symbol ID', () => {
        const program = createVirtualProgram({
          'target.ts': 'export interface Target { id: string; }',
          'consumer.ts': `
            import { Target as AliasOne } from "./target";
            import { Target as AliasTwo } from "./target";
            export interface Consumer { one: AliasOne; two: AliasTwo; }
          `,
        });
        try {
          const checker = program.getTypeChecker();
          const targetSf = program.getSourceFiles().find((f) => f.fileName.endsWith('target.ts'))!;
          const targetDecl = targetSf.statements[0] as ts.InterfaceDeclaration;
          const targetSym = checker.getSymbolAtLocation(targetDecl.name)!;
          const canonicalId = getCanonicalSymbolId(targetSym);

          const consSf = program.getSourceFiles().find((f) => f.fileName.endsWith('consumer.ts'))!;
          const consDecl = consSf.statements[2] as ts.InterfaceDeclaration;
          const propOne = consDecl.members[0] as ts.PropertySignature;
          const propTwo = consDecl.members[1] as ts.PropertySignature;

          const symOne = checker.getSymbolAtLocation((propOne.type as ts.TypeReferenceNode).typeName)!;
          const symTwo = checker.getSymbolAtLocation((propTwo.type as ts.TypeReferenceNode).typeName)!;

          expect(getCanonicalSymbolId(resolveAlias(symOne, checker))).toBe(canonicalId);
          expect(getCanonicalSymbolId(resolveAlias(symTwo, checker))).toBe(canonicalId);
        } finally {
          cleanupProgram(program);
        }
      });
    });

    describe('2.4: Self-Loops & Variations', () => {
      it('detects direct self-loop', () => {
        const program = createVirtualProgram({
          'self.ts': 'export interface Self { next: Self; }',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.has('/self.ts:Self')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });

      it('detects optional self-loop', () => {
        const program = createVirtualProgram({
          'opt.ts': 'export interface SelfOpt { next?: SelfOpt; }',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.has('/opt.ts:SelfOpt')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });

      it('detects array-wrapped self-loop', () => {
        const program = createVirtualProgram({
          'arr.ts': 'export interface SelfArr { children: SelfArr[]; }',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.has('/arr.ts:SelfArr')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });

      it('detects nested object literal self-loop', () => {
        const program = createVirtualProgram({
          'nest.ts': 'export interface SelfNest { meta: { parent?: SelfNest }; }',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.has('/nest.ts:SelfNest')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });

      it('detects type alias self-loop (binary tree)', () => {
        const program = createVirtualProgram({
          'tree.ts': 'export type BinaryTree = { value: number; left?: BinaryTree; right?: BinaryTree };',
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.has('/tree.ts:BinaryTree')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });
    });

    describe('2.5: Acyclic Graphs: Diamond Graphs & Pipelines (0 False Positives)', () => {
      it('4-node diamond graph produces 0 false positives', () => {
        const program = createVirtualProgram({
          'diamond.ts': `
            export interface Top { l: Left; r: Right; }
            export interface Left { b: Bottom; }
            export interface Right { b: Bottom; }
            export interface Bottom { val: string; }
          `,
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(0);
        } finally {
          cleanupProgram(program);
        }
      });

      it('6-node multi-level diamond produces 0 false positives', () => {
        const program = createVirtualProgram({
          'multidiamond.ts': `
            export interface Root { l1: L1; r1: R1; }
            export interface L1 { l2: L2; }
            export interface R1 { r2: R2; }
            export interface L2 { leaf: Leaf; }
            export interface R2 { leaf: Leaf; }
            export interface Leaf { id: string; }
          `,
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(0);
        } finally {
          cleanupProgram(program);
        }
      });

      it('wide fan-out diamond (1 -> 5 -> 1) produces 0 false positives', () => {
        const program = createVirtualProgram({
          'wide.ts': `
            export interface Top { a: A; b: B; c: C; d: D; e: E; }
            export interface A { sink: Sink; }
            export interface B { sink: Sink; }
            export interface C { sink: Sink; }
            export interface D { sink: Sink; }
            export interface E { sink: Sink; }
            export interface Sink { done: boolean; }
          `,
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(0);
        } finally {
          cleanupProgram(program);
        }
      });

      it('10-node linear pipeline produces 0 false positives', () => {
        const program = createVirtualProgram({
          'pipe.ts': `
            export interface N1 { next: N2; }
            export interface N2 { next: N3; }
            export interface N3 { next: N4; }
            export interface N4 { next: N5; }
            export interface N5 { next: N6; }
            export interface N6 { next: N7; }
            export interface N7 { next: N8; }
            export interface N8 { next: N9; }
            export interface N9 { next: N10; }
            export interface N10 { end: boolean; }
          `,
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(0);
        } finally {
          cleanupProgram(program);
        }
      });
    });

    describe('2.6: Disjoint Cycles & Figure-8 Cycles', () => {
      it('correctly segregates 2 disjoint cycles and an acyclic branch in a single program', () => {
        const program = createVirtualProgram({
          'disjoint.ts': `
            // Cycle 1 (size 2)
            export interface C1A { b: C1B; }
            export interface C1B { a: C1A; }

            // Cycle 2 (size 3)
            export interface C2A { b: C2B; }
            export interface C2B { c: C2C; }
            export interface C2C { a: C2A; }

            // Acyclic branch
            export interface A1 { next: A2; }
            export interface A2 { next: A3; }
            export interface A3 { leaf: boolean; }
          `,
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(5);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:C1A')).toBe(true);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:C1B')).toBe(true);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:C2A')).toBe(true);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:C2B')).toBe(true);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:C2C')).toBe(true);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:A1')).toBe(false);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:A2')).toBe(false);
          expect(result.cyclicSchemaIds.has('/disjoint.ts:A3')).toBe(false);
        } finally {
          cleanupProgram(program);
        }
      });

      it('detects figure-8 cycle where node C is shared between two loops', () => {
        const program = createVirtualProgram({
          'fig8.ts': `
            export interface A { c: C; }
            export interface B { a: A; }
            export interface C { b: B; d: D; }
            export interface D { e: E; }
            export interface E { c: C; }
          `,
        });
        try {
          const result = detectCyclesWithChecker(program);
          expect(result.cyclicSchemaIds.size).toBe(5);
          expect(result.cyclicSchemaIds.has('/fig8.ts:A')).toBe(true);
          expect(result.cyclicSchemaIds.has('/fig8.ts:B')).toBe(true);
          expect(result.cyclicSchemaIds.has('/fig8.ts:C')).toBe(true);
          expect(result.cyclicSchemaIds.has('/fig8.ts:D')).toBe(true);
          expect(result.cyclicSchemaIds.has('/fig8.ts:E')).toBe(true);
        } finally {
          cleanupProgram(program);
        }
      });
    });
  });

  // =========================================================================
  // CHALLENGE 3: JSDoc @oaOperation Extractor (@oa-sdk/parser)
  // =========================================================================
  describe('Challenge 3: JSDoc @oaOperation Extractor (@oa-sdk/parser)', () => {

    describe('3.1: All HTTP Verbs & Lowercase Formats', () => {
      const allVerbs = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const;

      for (const verb of allVerbs) {
        it(`extracts uppercase ${verb.toUpperCase()} into normalized lowercase '${verb}'`, () => {
          const source = `
            /** @oaOperation ${verb.toUpperCase()} /test/${verb} */
            export function handleOp() {}
          `;
          const result = extractOperationsFromSource(source, 'op.ts');
          expect(result.diagnostics).toHaveLength(0);
          expect(result.operations).toHaveLength(1);
          expect(result.operations[0].method).toBe(verb);
          expect(result.operations[0].path).toBe(`/test/${verb}`);
          expect(result.operations[0].operationEntry.method).toBe(verb);
        });

        it(`extracts lowercase ${verb} into normalized lowercase '${verb}'`, () => {
          const source = `
            /** @oaOperation ${verb} /test/lower-${verb} */
            export function handleLowerOp() {}
          `;
          const result = extractOperationsFromSource(source, 'lower-op.ts');
          expect(result.diagnostics).toHaveLength(0);
          expect(result.operations).toHaveLength(1);
          expect(result.operations[0].method).toBe(verb);
          expect(result.operations[0].path).toBe(`/test/lower-${verb}`);
        });

        it(`extracts mixed-case ${verb.charAt(0).toUpperCase() + verb.slice(1)}`, () => {
          const mixed = verb.charAt(0).toUpperCase() + verb.slice(1);
          const source = `
            /** @oaOperation ${mixed} /test/mixed-${verb} */
            export function handleMixedOp() {}
          `;
          const result = extractOperationsFromSource(source, 'mixed-op.ts');
          expect(result.diagnostics).toHaveLength(0);
          expect(result.operations).toHaveLength(1);
          expect(result.operations[0].method).toBe(verb);
        });
      }

      it('specifically verifies OAS 3.2 QUERY on both function and type-alias declarations', () => {
        const source = `
          /** @oaOperation QUERY /items/search */
          export function queryItems(params: unknown) {}

          /** @oaOperation query /users/filter */
          export type FilterUsersOp = { body: unknown };
        `;
        const result = extractOperationsFromSource(source, 'query.ts');
        expect(result.diagnostics).toHaveLength(0);
        expect(result.operations).toHaveLength(2);
        expect(result.operations[0].method).toBe('query');
        expect(result.operations[0].declarationKind).toBe('function');
        expect(result.operations[1].method).toBe('query');
        expect(result.operations[1].declarationKind).toBe('type-alias');
      });
    });

    describe('3.2: Path Parameter Syntax & Extraction', () => {
      it('extracts single path parameter with required: true and in: path', () => {
        const source = `
          /** @oaOperation GET /users/{userId} */
          export function getUser() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.diagnostics).toHaveLength(0);
        const op = result.operations[0];
        expect(op.operationEntry.parameters).toEqual([
          { name: 'userId', in: 'path', required: true },
        ]);
      });

      it('extracts multiple path parameters in correct order', () => {
        const source = `
          /** @oaOperation GET /orgs/{orgId}/repos/{repoId}/issues/{issueNum} */
          export function getIssue() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.diagnostics).toHaveLength(0);
        const params = result.operations[0].operationEntry.parameters;
        expect(params).toHaveLength(3);
        expect(params.map((p) => p.name)).toEqual(['orgId', 'repoId', 'issueNum']);
        expect(params.every((p) => p.in === 'path' && p.required === true)).toBe(true);
      });

      it('handles hyphens and underscores in path parameter names', () => {
        const source = `
          /** @oaOperation GET /api/{user_id}/{account-uuid} */
          export function getAccount() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.diagnostics).toHaveLength(0);
        expect(result.operations[0].operationEntry.parameters.map((p) => p.name)).toEqual([
          'user_id',
          'account-uuid',
        ]);
      });
    });

    describe('3.3: Path Parameter Syntax Violations (Strict Diagnostics)', () => {
      it('rejects empty parameter braces /users/{}', () => {
        const source = `
          /** @oaOperation GET /users/{} */
          export function badEmpty() {}
        `;
        const result = extractOperationsFromSource(source, 'bad-empty.ts');
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].code).toBe('invalid-oa-operation');
        expect(result.diagnostics[0].message).toContain('empty parameter name');
      });

      it('rejects whitespace-only parameter braces /users/{   }', () => {
        const source = `
          /** @oaOperation GET /users/{   } */
          export function badSpace() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].code).toBe('invalid-oa-operation');
        expect(result.diagnostics[0].message).toContain("@oaOperation must have the form '<METHOD> /path'");
      });

      it('rejects nested parameter braces /users/{{id}}', () => {
        const source = `
          /** @oaOperation GET /users/{{id}} */
          export function badNested() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain('nested parameter braces');
      });

      it('rejects unclosed parameter brace /users/{id', () => {
        const source = `
          /** @oaOperation GET /users/{id */
          export function badUnclosed() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain('unclosed parameter brace');
      });

      it('rejects unmatched closing brace /users/id}', () => {
        const source = `
          /** @oaOperation GET /users/id} */
          export function badUnmatched() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain('unmatched closing brace');
      });

      it('rejects path without leading slash users/{id}', () => {
        const source = `
          /** @oaOperation GET users/{id} */
          export function badNoSlash() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain("Path must begin with leading '/': 'users/{id}'");
      });
    });

    describe('3.4: Malformed Tags', () => {
      it('rejects empty tag /** @oaOperation */', () => {
        const source = `
          /** @oaOperation */
          export function empty() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain("@oaOperation must have the form '<METHOD> /path'");
      });

      it('rejects only verb /** @oaOperation GET */', () => {
        const source = `
          /** @oaOperation GET */
          export function verbOnly() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain('Missing path component');
      });

      it('rejects only lowercase verb /** @oaOperation get */', () => {
        const source = `
          /** @oaOperation get */
          export function verbOnlyLower() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain('Missing path component');
      });

      it('rejects unsupported HTTP verb /** @oaOperation FOOBAR /users */', () => {
        const source = `
          /** @oaOperation FOOBAR /users */
          export function unsupported() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain('Unsupported HTTP method: FOOBAR');
      });

      it('rejects invalid tag with extra tokens /** @oaOperation GET /users extra */', () => {
        const source = `
          /** @oaOperation GET /users extra */
          export function extraTokens() {}
        `;
        const result = extractOperationsFromSource(source);
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0].message).toContain("@oaOperation must have the form '<METHOD> /path'");
      });
    });

    describe('3.5: Unannotated Declarations Strictly Ignored', () => {
      it('strictly ignores exported declarations without @oaOperation', () => {
        const source = `
          export function standardFunction(x: number) { return x * 2; }
          export async function asyncFn() {}
          export function* generatorFn() { yield 1; }
          export type StandardType = { id: string; };
          export interface StandardInterface { name: string; }
          export class StandardClass { val: number = 1; }
          export enum StandardEnum { A, B }
          export const CONSTANT = 42;
        `;
        const result = extractOperationsFromSource(source, 'unannotated.ts');
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(0);
        expect(result.operationEntries).toHaveLength(0);
      });

      it('strictly ignores unexported declarations even when annotated with @oaOperation', () => {
        const source = `
          /** @oaOperation GET /internal/secret */
          function internalSecret() {}

          /** @oaOperation POST /internal/type */
          type InternalType = { body: string };
        `;
        const result = extractOperationsFromSource(source, 'internal.ts');
        expect(result.operations).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(0);
      });
    });
  });
});

describe('CHALLENGER: Extra Edge-Case Stress Tests', () => {
  it('detects mutual cycle between interface and type alias union', () => {
    const program = createVirtualProgram({
      'a.ts': 'import { BUnion } from "./b"; export interface A { b: BUnion; }',
      'b.ts': 'import { A } from "./a"; export type BUnion = string | { a: A };',
    });
    try {
      const result = detectCyclesWithChecker(program);
      expect(result.cyclicSchemaIds.size).toBe(2);
      expect(result.cyclicSchemaIds.has('/a.ts:A')).toBe(true);
      expect(result.cyclicSchemaIds.has('/b.ts:BUnion')).toBe(true);
    } finally {
      cleanupProgram(program);
    }
  });

  it('detects cycle formed via heritage clause extends across files', () => {
    const program = createVirtualProgram({
      'base.ts': 'import { Sub } from "./sub"; export interface Base { sub: Sub; }',
      'sub.ts': 'import { Base } from "./base"; export interface Sub extends Base { extra: string; }',
    });
    try {
      const result = detectCyclesWithChecker(program);
      expect(result.cyclicSchemaIds.size).toBe(2);
      expect(result.cyclicSchemaIds.has('/base.ts:Base')).toBe(true);
      expect(result.cyclicSchemaIds.has('/sub.ts:Sub')).toBe(true);
    } finally {
      cleanupProgram(program);
    }
  });

  it('handles declaration with one valid and one invalid @oaOperation tag', () => {
    const source = `
      /**
       * @oaOperation GET /users
       * @oaOperation POST users
       */
      export function manageUsers() {}
    `;
    const result = extractOperationsFromSource(source, 'mixed-tags.ts');
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].method).toBe('get');
    expect(result.operations[0].path).toBe('/users');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('invalid-oa-operation');
    expect(result.diagnostics[0].message).toContain("Path must begin with leading '/': 'users'");
  });

  it('verifies class declaration with generics triggers generic-declaration warning', () => {
    const source = `export class Repository<T> { item!: T; }`;
    const audit = auditTypeShapesInSource(source, 'repo.ts');
    expect(audit.valid).toBe(true);
    const diag = audit.diagnostics.find((d) => d.feature === 'generic-declaration');
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe('warning');
    expect(diag!.code).toBe('policy-required-shape');
  });

  it('verifies enum declaration evaluates as direct with 0 diagnostics', () => {
    const source = `export enum UserRole { ADMIN = 'admin', GUEST = 'guest' }`;
    const audit = auditTypeShapesInSource(source, 'role.ts');
    expect(audit.valid).toBe(true);
    expect(audit.diagnostics).toHaveLength(0);
    expect(audit.scannedDeclarations).toBe(1);
  });
});
