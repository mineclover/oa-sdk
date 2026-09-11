# Remediation Handoff Report: OpenAPI 3.2 to Zod 4 Generator

**Agent**: `remediation_worker_1`  
**Parent**: `parent` (`511ce570-02c1-46b0-8a89-48ef7cededc0`)  
**Date**: 2026-09-11T09:13:00+09:00  
**Status**: COMPLETE / VERIFIED  

---

## 1. Observation

Direct observations before and after applying the remediation blueprint:

### 1.1 Circular Schema Diagnostics (TS7022 / TS7024)
- **Before Remediation**:
  In `packages/codegen/test/zodgen/adversarial-challenger-1.test.ts:205-214`, TypeScript compilation of circular schemas generated from `circular-typecheck.ts` failed with:
  ```
  error TS7022: 'ASchema' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
  error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
  ```
- **After Remediation**:
  `generateZodFromSpec` runs `findCircularSchemas` via DFS graph traversal. Schemas participating in cycles are selectively annotated with `: z.ZodTypeAny` (e.g., `export const ASchema: z.ZodTypeAny = z.object({...})`), while acyclic schemas remain unannotated (`export const UserSchema = z.object({...})`).
  Running in-memory compilation via `ts.getPreEmitDiagnostics`:
  ```
  TS Diagnostics count: 0
  ```

### 1.2 Discriminator Runtime Exceptions on Omitted `required`
- **Before Remediation**:
  In `packages/codegen/test/zodgen/adversarial-challenger-1.test.ts:654-676`, schemas using `discriminator: { propertyName: 'kind' }` without explicit `required: ['kind']` on variant branches marked `kind` as `.optional()`, causing Zod 4's `z.discriminatedUnion` to crash:
  ```
  Error: Duplicate discriminator value "undefined"
  ```
- **After Remediation**:
  1. In `prepareSchemaForZod` (`schema-to-zod.ts:414-448`), when `s.discriminator?.propertyName` exists on `oneOf` or `anyOf`, `discProp` is automatically appended to `prepared.required`.
  2. In `createZod4Algebra` (`schema-to-zod.ts:185-192`), properties listed in `discriminatorProperties` that declare `const` or `enum` are treated as required.
  3. Running `validator.safeParse({ kind: 'v1' })` yields `{ success: true }`, `{ kind: 'v2' }` yields `{ success: true }`, and `{}` yields `{ success: false }` gracefully without crashing.

### 1.3 Redundant Combinator `.describe(...)` Metadata
- **Before Remediation**:
  `foldSiblingProperties` (`schema-to-zod.ts:526`) preserved `description`, causing `.describe(...)` to be emitted both on the synthetic inner object and on the outer `.and(...)` chain.
- **After Remediation**:
  `foldSiblingProperties` strips `description`, `default`, `example`, `title`, and `$comment` before folding.
  Running `matches = code.match(/\.describe\("Unique description"\)/g)` yields:
  ```
  Describe count: 1
  ```

### 1.4 Discriminator Mapping Branch Synthesis
- **Before Remediation**:
  `s.discriminator.mapping` was ignored in `oneOf`.
- **After Remediation**:
  `buildMappingBranches` synthesizes `.extend({ [propertyName]: z.literal(key) })` branches wrapped in `z.lazy`, supporting alias mappings like `dir` -> `DirectoryNode` alongside OAS 3.2 `defaultMapping`.

---

## 2. Logic Chain

1. **Step 1 (Selective Cycle Detection vs Full Inference Retention)**:
   - Unconditional `: z.ZodTypeAny` annotations turn `z.infer<typeof ModelSchema>` into `any` for every generated model, destroying static TypeScript typing.
   - Directed cycle detection via DFS (`findCircularSchemas`) isolates the exact subgraph of circular schemas.
   - Restricting `: z.ZodTypeAny` strictly to `circularSchemas.has(name)` eliminates TS7022/TS7024 while preserving 100% structural type inference for all acyclic models.

2. **Step 2 (Discriminator Invariant Enforcement)**:
   - OpenAPI 3.2 §4.8.24 establishes that the discriminator property is required for variant resolution.
   - Zod 4 builds a lookup map on discriminator keys; optional discriminator fields index `undefined` across options, triggering duplicate key collisions at runtime.
   - Enforcing required status on discriminator fields at both document preparation time (`prepareSchemaForZod`) and component schema algebra folding (`options.discriminatorProperties`) guarantees zero `undefined` collisions across both inline and `$ref`-based variants.

3. **Step 3 (Combinator Sibling AST Normalization)**:
   - Sibling properties on combinator schemas represent supplemental structural fields folded into `.and(...)`.
   - Stripping decorative metadata (`description`, `default`, `example`) from the synthetic sibling object prevents duplicate method chains while allowing `wrapMetadata` to apply description exactly once to the root composite schema.

4. **Step 4 (Test Fixture & Runtime Sanitizer Alignment)**:
   - `new Function('z', ...)` in JavaScript test harnesses cannot parse TypeScript type annotations (`: z.ZodTypeAny`).
   - Adding `.replace(/:\s*z\.ZodTypeAny/g, '')` in eval sanitizers allows pure JS execution while verifying that generated TypeScript code remains strictly valid.

---

## 3. Caveats

1. **Recursive Type Inference in TypeScript**:
   TypeScript's type system cannot structurally infer recursive types without an explicit type declaration. By design in Zod, `z.infer<typeof CircularSchema>` yields `any` for cyclic schemas unless an external interface is defined. Acyclic schemas maintain 100% full structural inference.
2. **Repository-Wide Package Boundary Test**:
   `packages/codegen/src/__tests__/public-package-boundary.test.ts` fails because `packages/codegen/package.json` contains `"@oa-sdk/mock-server": "workspace:*"`, introduced during Phase 3 mock server development. Per write ownership constraints, `package.json` was not modified by this remediation agent. All 184 zodgen tests and codegen typecheck pass cleanly.

---

## 4. Conclusion

All blocking defects identified by Challenger 1 and mapped in the remediation blueprint have been resolved:
- **Defect 1**: Resolved via `findCircularSchemas` and selective `: z.ZodTypeAny` typing (0 TS7022/TS7024 errors).
- **Defect 2**: Resolved via discriminator required injection, `discriminatorProperties` algebra propagation, and `buildMappingBranches` synthesis.
- **Defect 3**: Resolved via metadata stripping in `foldSiblingProperties` (exactly 1 `.describe(...)` emitted).

All 23 adversarial tests, 51 unit tests, 12 runtime adapter tests, and 98 E2E tests pass with 100% success. TypeScript `tsc --noEmit` compiles with 0 errors.

---

## 5. Verification Method

To independently verify the implementation:

### 5.1 Adversarial Challenger Test Suite
```bash
pnpm --filter @oa-sdk/codegen exec vitest run test/zodgen/adversarial-challenger-1.test.ts
```
**Output**: `23 passed (23)`

### 5.2 Complete Zodgen E2E Test Suite (98 Tests)
```bash
pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/zod4-generator.e2e.test.ts
```
**Output**: `98 passed (98)`

### 5.3 Complete Zodgen Unit Test Suites
```bash
pnpm --filter @oa-sdk/codegen exec vitest run src/zodgen/schema-to-zod.test.ts src/zodgen/runtime-adapter.test.ts
```
**Output**: `63 passed (63)`

### 5.4 TypeScript Compiler Strict Mode (`tsc --noEmit`)
```bash
pnpm --filter @oa-sdk/codegen run typecheck
```
**Output**: `0 errors`

### 5.5 In-Memory TypeScript Strict Compilation on Circular Schemas
```bash
pnpm --filter @oa-sdk/codegen exec node --import tsx -e "
import ts from 'typescript';
import { generateZodFromSpec } from './src/zodgen/index.js';

const doc = {
  openapi: '3.2.0',
  info: { title: 'Circular API', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      A: { type: 'object', properties: { b: { '\$ref': '#/components/schemas/B' } } },
      B: { type: 'object', properties: { a: { '\$ref': '#/components/schemas/A' } } },
    }
  }
};
const code = generateZodFromSpec(doc);
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
const host = ts.createCompilerHost(options);
const orig = host.getSourceFile;
host.getSourceFile = (name, v, onError, create) => name === 'test.ts' ? ts.createSourceFile(name, code, v) : orig(name, v, onError, create);
const prog = ts.createProgram(['test.ts'], options, host);
const diags = ts.getPreEmitDiagnostics(prog).filter(d => d.file?.fileName === 'test.ts');
console.log('TS Diagnostics count:', diags.length);
if (diags.length > 0) process.exit(1);
"
```
**Output**: `TS Diagnostics count: 0`

### 5.6 Runtime Discriminator Omitted-Required Verification
```bash
pnpm --filter @oa-sdk/codegen exec node --import tsx -e "
import { schemaToZod } from './src/zodgen/index.js';
import { z } from 'zod';

const schema = {
  oneOf: [
    { type: 'object', properties: { kind: { const: 'v1' } } },
    { type: 'object', properties: { kind: { const: 'v2' } } },
  ],
  discriminator: { propertyName: 'kind' },
};
const code = schemaToZod(schema);
const fn = new Function('z', 'return ' + code);
const validator = fn(z);
const r1 = validator.safeParse({ kind: 'v1' });
const r2 = validator.safeParse({ kind: 'v2' });
const r3 = validator.safeParse({});
console.log('v1:', r1.success, 'v2:', r2.success, 'empty:', r3.success);
if (!r1.success || !r2.success || r3.success) process.exit(1);
"
```
**Output**: `v1: true v2: true empty: false`

### 5.7 Metadata Cleanliness Verification
```bash
pnpm --filter @oa-sdk/codegen exec node --import tsx -e "
import { schemaToZod } from './src/zodgen/index.js';

const schema = {
  properties: { extra: { type: 'boolean' } },
  description: 'Unique description',
  oneOf: [
    { type: 'object', properties: { a: { type: 'string' } } },
    { type: 'object', properties: { b: { type: 'number' } } },
  ],
};
const code = schemaToZod(schema);
const matches = code.match(/\\.describe\\(\"Unique description\"\\)/g) || [];
console.log('Describe count:', matches.length);
if (matches.length !== 1) process.exit(1);
"
```
**Output**: `Describe count: 1`
