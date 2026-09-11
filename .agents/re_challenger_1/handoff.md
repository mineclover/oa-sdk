# Milestone 5 Gate Re-Verification Handoff Report: OpenAPI 3.2 to Zod 4 Generator

**Agent**: `re_challenger_1` (Vocabulary Re-Challenger)  
**Parent**: `parent` (`511ce570-02c1-46b0-8a89-48ef7cededc0`)  
**Date**: 2026-09-11T09:23:00+09:00  
**Verdict**: **APPROVE**

---

## 1. Observation

Direct empirical evidence obtained by executing stress tests and TypeScript compiler validations against the remediated OpenAPI 3.2 to Zod 4 generator:

### 1.1 Adversarial Test Suite Execution (All 23 Tests Passing)
Executed command:
```bash
pnpm --filter @oa-sdk/codegen exec vitest run test/zodgen/adversarial-challenger-1.test.ts
```
**Observed Output**:
```
 RUN  v4.1.4 /Users/junwoobang/workflow/oa-sdk/packages/codegen

 ✓ test/zodgen/adversarial-challenger-1.test.ts (23 tests) 766ms
       ✓ stress-tests circular references under TypeScript tsc --noEmit compiler  548ms

 Test Files  1 passed (1)
      Tests  23 passed (23)
   Start at  09:13:45
   Duration  1.23s
```
All 23 adversarial tests across 5 target stress areas (circular references, numeric boundary extremes, tuples/rest, polymorphic discriminators, sibling keywords on combinators) pass cleanly.

### 1.2 TypeScript Strict Compilation on Circular Schemas (TS7022 / TS7024 Resolved)
Evaluated in-memory TypeScript compiler check using `ts.getPreEmitDiagnostics` on circular schema cycles (`A <-> B`):
```typescript
const doc = {
  openapi: '3.2.0',
  info: { title: 'Circular API', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
      B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
    }
  }
};
```
Generated code:
```typescript
export const ASchema: z.ZodTypeAny = z.object({
  b: z.lazy(() => BSchema).optional(),
})
export type A = z.infer<typeof ASchema>

export const BSchema: z.ZodTypeAny = z.object({
  a: z.lazy(() => ASchema).optional(),
})
export type B = z.infer<typeof BSchema>
```
**Diagnostic Count**: `0 diagnostics` (error TS7022 and TS7024 are 100% eliminated).

### 1.3 Full Structural Type Inference Retention on Acyclic Schemas
Tested acyclic schema generation and static type inspection under TypeScript strict mode:
```typescript
const doc = {
  openapi: '3.2.0',
  components: {
    schemas: {
      Address: { type: 'object', required: ['street', 'city'], properties: { street: { type: 'string' }, city: { type: 'string' } } },
      User: { type: 'object', required: ['id', 'name', 'address'], properties: { id: { type: 'string' }, name: { type: 'string' }, address: { $ref: '#/components/schemas/Address' } } },
    }
  }
};
```
Generated code:
```typescript
export const AddressSchema = z.object({
  city: z.string(),
  street: z.string(),
})
export type Address = z.infer<typeof AddressSchema>

export const UserSchema = z.object({
  address: z.lazy(() => AddressSchema),
  id: z.string(),
  name: z.string(),
})
export type User = z.infer<typeof UserSchema>
```
**Evidence of Type Preservation**:
- Code inspection: Zero occurrences of `: z.ZodTypeAny` in generated acyclic schemas.
- In-memory type checker assertion:
  ```typescript
  type IsAny<T> = 0 extends (1 & T) ? true : false;
  type TestUserNotAny = IsAny<User>;
  const testUserNotAny: TestUserNotAny = false; // Confirmed: User is NOT any
  ```
- Structural assignment: Assigning `{ id: 123 }` triggers `error TS2322: Type 'number' is not assignable to type 'string'`, verifying full compile-time static type safety is intact.

### 1.4 Discriminator Runtime Safety on Omitted Required Properties
Evaluated both inline `oneOf` and component `$ref` schemas with discriminator properties omitting explicit `required: ['<prop>']`:
1. **Inline Variant**:
   - `validator.safeParse({ kind: 'alpha', valA: 'hello' })` -> `{ success: true }`
   - `validator.safeParse({ kind: 'beta', valB: 42 })` -> `{ success: true }`
   - `validator.safeParse({})` -> `{ success: false }` (No exception thrown)
   - `validator.safeParse({ kind: 'gamma' })` -> `{ success: false }` (No exception thrown)
   - `validator.safeParse(null)` -> `{ success: false }` (No exception thrown)
2. **Component Component Variant with `$ref`**:
   - `PetSchema.safeParse({ petType: 'cat', meow: true })` -> `{ success: true }`
   - `PetSchema.safeParse({ petType: 'dog', bark: true })` -> `{ success: true }`
   - `PetSchema.safeParse({})` -> `{ success: false }` (No exception thrown)
   - `PetSchema.safeParse({ petType: 'bird' })` -> `{ success: false }` (No exception thrown)

### 1.5 Metadata Cleanliness on Combinator Sibling Properties
Tested `oneOf`, `allOf`, and `anyOf` with top-level `description` and sibling `properties`:
- `oneOf`: Exactly 1 `.describe("Top-level description for oneOf")` emitted on the composite chain.
- `allOf`: Exactly 1 `.describe("Top-level description for allOf")` emitted on the composite chain.
- `anyOf`: Exactly 1 `.describe("Top-level description for anyOf")` emitted on the composite chain.
- Synthetic sibling object stripped of `description`, `default`, `example`, `title`, and `$comment`.

### 1.6 Additional Topological Stress & OAS 3.2 Conformance Tests
- **Self-referencing cycle** (`Folder -> subfolders: Folder[]`): Correctly tagged with `: z.ZodTypeAny` while sibling referenced acyclic models (`LeafItem`) remain unannotated.
- **Cycle reachability from acyclic entry** (`Entry -> CycleA <-> CycleB`): `EntrySchema` remains unannotated (`z.infer<Entry>` retains structural typing), while `CycleASchema` and `CycleBSchema` receive `: z.ZodTypeAny`.
- **Encoded JSON Pointer keys** (`#/components/schemas/A~1B`): Properly unescaped to `A/B` and identified in cycles.
- **OAS 3.2 `defaultMapping` Fallback**: Tested `Vehicle` schema with `defaultMapping: '#/components/schemas/UnknownVehicle'`. Known variants (`car`, `truck`) parsed cleanly; unknown variant (`drone`) safely routed to fallback schema without throwing.

---

## 2. Logic Chain

1. **Cycle Isolation via Directed Graph Traversal**:
   - `findCircularSchemas` performs DFS cycle detection from every component schema.
   - Restricting `: z.ZodTypeAny` strictly to nodes where `circularSchemas.has(name)` eliminates the circular type inference paradox (TS7022 / TS7024) without polluting the type inference of acyclic models.
   - Observations 1.2, 1.3, and 1.6 directly confirm that acyclic schemas remain unannotated and retain full structural inference (`z.infer`), while circular models compile with 0 TypeScript diagnostics.

2. **Discriminator Invariant Synthesis**:
   - In Zod 4, `z.discriminatedUnion(key, ...)` indexes variant schemas by the literal value of `key`. If `key` is optional, `undefined` is indexed, colliding across variants and throwing `Error: Duplicate discriminator value "undefined"`.
   - By automatically injecting `discProp` into `prepared.required` during `prepareSchemaForZod` and enforcing required status in `createZod4Algebra` when property keys exist in `discriminatorProperties` with `const` or `enum`, the generator guarantees that discriminator properties are emitted as non-optional literals/enums.
   - Observation 1.4 confirms that parsing valid variants succeeds while missing or invalid discriminator properties return `{ success: false }` gracefully without uncaught exceptions.

3. **Sibling AST Normalization**:
   - In OpenAPI 3.2, combinators (`oneOf`, `allOf`, `anyOf`) may declare sibling fields (`properties`, `description`, etc.).
   - Sibling fields are folded into `.and(siblingObject)`. If decorative metadata is retained on `siblingObject`, both `siblingObject` and the root composite schema receive `.describe(...)`.
   - Stripping decorative metadata (`description`, `default`, etc.) in `foldSiblingProperties` before folding ensures that metadata is wrapped exactly once at the top-level expression. Observation 1.5 confirms describe count is strictly 1.

---

## 3. Caveats

1. **Circular Type Inference Degradation is Standard in TypeScript / Zod**:
   For circular schemas (`export const ASchema: z.ZodTypeAny = ...`), TypeScript cannot structurally infer recursive types without an explicit interface declaration. By design in Zod, `z.infer<typeof ASchema>` yields `any` for cycle participants. Acyclic schemas maintain 100% full structural inference.
2. **Workspace Package Boundary Dependency in `@oa-sdk/codegen`**:
   `packages/codegen/package.json` contains `"@oa-sdk/mock-server": "workspace:*"`, introduced during Phase 3 mock server CLI integration. This causes `packages/codegen/src/__tests__/public-package-boundary.test.ts` to fail (1 out of 2254 tests). Per code ownership constraints, this was not touched. All 184 zodgen tests and `typecheck` pass cleanly.

---

## 4. Conclusion

All defects that prompted `REQUEST_CHANGES` in Iteration 1 have been thoroughly remediated and empirically verified:
1. **TS7022 / TS7024**: Resolved cleanly via DFS cycle detection and selective `: z.ZodTypeAny` typing (0 compiler diagnostics).
2. **Structural Type Inference**: 100% preserved on all acyclic models (`z.infer` does not degrade to `any`).
3. **Discriminator Runtime Safety**: Omitted `required` on variant discriminator properties no longer crashes Zod 4; returns `{ success: true }` for valid inputs and `{ success: false }` for invalid/empty inputs.
4. **Metadata Cleanliness**: Redundant `.describe(...)` on combinator sibling properties is eliminated (exactly 1 describe emitted).
5. **Specification Conformance**: Numeric bounds (`.gt()`, `.lt()`), Draft 2020-12 tuples (`z.tuple()`), object sealing (`.strict()`), and OAS 3.2 `defaultMapping` all function correctly.

**Final Verdict**: **APPROVE**

---

## 5. Verification Method

To independently reproduce and verify all findings:

### 5.1 Adversarial Test Suite
```bash
pnpm --filter @oa-sdk/codegen exec vitest run test/zodgen/adversarial-challenger-1.test.ts
```

### 5.2 TypeScript In-Memory Strict Compilation (Circular Schemas)
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
console.log('Diagnostics count:', diags.length);
if (diags.length > 0) process.exit(1);
"
```

### 5.3 Static Type Inference Check (Acyclic Schemas)
```bash
pnpm --filter @oa-sdk/codegen exec node --import tsx -e "
import ts from 'typescript';
import { generateZodFromSpec } from './src/zodgen/index.js';

const doc = {
  openapi: '3.2.0',
  info: { title: 'Acyclic API', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name'],
        properties: { id: { type: 'string' }, name: { type: 'string' } },
      },
    },
  },
};
const code = generateZodFromSpec(doc);
if (code.includes('z.ZodTypeAny')) process.exit(1);
const check = code + \`
type IsAny<T> = 0 extends (1 & T) ? true : false;
const checkNotAny: IsAny<User> = false;
const validUser: User = { id: 'u1', name: 'Alice' };
const invalidUser: User = {
  // @ts-expect-error Type number not assignable to string
  id: 123,
  name: 'Bob',
};
\`;
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
const host = ts.createCompilerHost(options);
const orig = host.getSourceFile;
host.getSourceFile = (name, v, onError, create) => name === 'test.ts' ? ts.createSourceFile(name, check, v) : orig(name, v, onError, create);
const prog = ts.createProgram(['test.ts'], options, host);
const diags = ts.getPreEmitDiagnostics(prog).filter(d => d.file?.fileName === 'test.ts');
console.log('Diagnostics count:', diags.length);
if (diags.length > 0) process.exit(1);
"
```

### 5.4 Runtime Discriminator Without Required
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
const validator = new Function('z', 'return ' + code)(z);
const r1 = validator.safeParse({ kind: 'v1' });
const r2 = validator.safeParse({ kind: 'v2' });
const r3 = validator.safeParse({});
if (!r1.success || !r2.success || r3.success) process.exit(1);
console.log('Discriminator runtime safeParse verified.');
"
```

### 5.5 Metadata Cleanliness Verification
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
if (matches.length !== 1) process.exit(1);
console.log('Describe count:', matches.length);
"
```
