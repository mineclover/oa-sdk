# Milestone 5 Challenger 1 Handoff Report: Adversarial Verification of OpenAPI 3.2 to Zod 4 Generator

**Verdict**: `REQUEST_CHANGES`
**Timestamp**: 2026-09-10T23:36:30Z
**Agent**: Challenger 1 (`m5_challenger_1`)
**Test Suite**: `packages/codegen/test/zodgen/adversarial-challenger-1.test.ts` (23 passing adversarial tests)

---

## 1. Observation

### Observation 1.1: Circular References Fail TypeScript Strict Compilation (`tsc --noEmit`)
When `generateZodFromSpec` emits code for circular schemas (e.g. self-referencing `TreeNode` or 3-way/4-way cyclic references), it generates declarations of the form:
```typescript
// packages/codegen/src/zodgen/generate-zod.ts:76
export const ASchema = z.object({
  b: z.lazy(() => BSchema).optional(),
})
export type A = z.infer<typeof ASchema>
```
When compiled under TypeScript with `strict: true` (as in `tsconfig.base.json`), the compiler emits verbatim errors:
```
packages/codegen/src/circular-test.ts(6,14): error TS7022: 'ASchema' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
packages/codegen/src/circular-test.ts(7,15): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
```
This failure occurs for 1-way self-referential schemas (`TreeNode`), 2-way mutual recursion, and deep 3-way/4-way circular graphs.

### Observation 1.2: Omitted `required` on Discriminator Property Causes Runtime Exception
In `packages/codegen/src/zodgen/schema-to-zod.ts:184`:
```typescript
const isRequired = required.has(key)
const expr = isRequired ? propCode : `${propCode}.optional()`
```
And in `packages/codegen/src/zodgen/schema-to-zod.ts:253`:
```typescript
let discExpr = `z.discriminatedUnion(${JSON.stringify(s.discriminator.propertyName)}, [${branches.join(', ')}], { unionFallback: true })`
```
When an OpenAPI 3.2 schema defines a `discriminator` on `propertyName: 'kind'` but the child variant schemas define `properties: { kind: { const: 'v1' } }` without explicitly repeating `required: ['kind']`, `schemaToZod` emits `kind: z.literal("v1").optional()`.
At runtime in Zod 4, both variants allow `undefined`, resulting in duplicate discriminator keys. Calling `.parse()` or `.safeParse()` throws an unhandled error:
```
Error: Duplicate discriminator value "undefined"
    at node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js:1153:27
```

### Observation 1.3: Discriminator `mapping` Keyword Ignored & Non-Literal Properties Throw
In `packages/codegen/src/zodgen/schema-to-zod.ts:252-267`:
`s.discriminator.mapping` is completely unreferenced. When child schemas specify `properties: { kind: { type: 'string' } }` instead of a literal `const`, Zod 4's `z.discriminatedUnion` throws at runtime:
```
Error: Invalid discriminated union option at index "0"
```

### Observation 1.4: IEEE 754 Precision in Zod 4 `multipleOf`
In Zod 4's `floatSafeRemainder` (`node_modules/zod/v4/core/util.cjs:11`):
```javascript
const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
```
When validating `z.number().multipleOf(2).safeParse(Number.MAX_SAFE_INTEGER)`, because `tolerance = 1.0 > 0.5`, the check returns `success: true` despite `9007199254740991` being an odd number.
When validating `multipleOf: 0`, division by zero results in `val / 0 = NaN`, causing all numbers to be rejected.

### Observation 1.5: Draft 2020-12 Tuple Default vs Zod 4 Closed Tuple
In `packages/codegen/src/zodgen/schema-to-zod.ts:214-222`:
When `prefixItems: [{ type: 'string' }]` is passed without `items`, `schemaToZod` emits `z.tuple([z.string()])`.
In Draft 2020-12 / OAS 3.2, omitted `items` defaults to `true` (open tuple). But in Zod 4, `z.tuple([z.string()])` is closed by default and rejects extra items (e.g. `['a', 123]` fails).

### Observation 1.6: Combinators with Sibling Properties Emit Redundant `.describe()`
In `packages/codegen/src/zodgen/schema-to-zod.ts:525-530`:
`foldSiblingProperties` extracts `{ ...siblingSchema, type: 'object' }` and folds it, applying `wrapMetadata` to the inner `z.object`. `wrapMetadata` is subsequently called on the outer `.and(...)` expression, emitting duplicate `.describe(...)` calls:
```typescript
z.object({ extra: z.boolean().optional() }).describe("Desc").and(z.union([...])).describe("Desc")
```

---

## 2. Logic Chain

1. **Premise 1 (Acceptance Criteria)**: `ORIGINAL_REQUEST.md` requires:
   - "Generated Zod 4 schemas pass `tsc --noEmit` and runtime `.parse()` / `.safeParse()` assertions."
   - "Circular schema references successfully resolve at runtime using `z.lazy()` without recursion errors."
   - "Discriminator with defaultMapping synthesizes valid `z.discriminatedUnion()`."
2. **Step 2 (Circular Reference Type Inference)**:
   - By Observation 1.1, TypeScript requires explicit type annotations on recursive variable initializers under `strict: true`.
   - `generateZodFromSpec` emits `export const <Name>Schema = z.object(...)` without `: z.ZodTypeAny` or `: z.ZodType<<Name>>`.
   - Therefore, any TypeScript project compiling emitted code with circular schemas fails with TS7022 and TS7024.
3. **Step 3 (Discriminator Runtime Robustness)**:
   - By Observation 1.2, omitting `required` on variant discriminator properties causes `schemaToZod` to mark them `.optional()`.
   - Zod 4 rejects multiple variants sharing the `undefined` discriminator key with `Duplicate discriminator value "undefined"`.
   - Standard OpenAPI 3.2 specs often rely on the discriminator tag without explicitly repeating it in `required`.
   - Therefore, valid OpenAPI 3.2 specs will generate schemas that crash at runtime upon validation.
4. **Step 4 (Mapping Keyword Omission)**:
   - By Observation 1.3, `s.discriminator.mapping` is not implemented in `schema-to-zod.ts`.
   - Any OpenAPI 3.2 spec that relies on `discriminator.mapping` (mapping alternative strings to models) will either misroute or crash at runtime if the model lacks an inline literal.
5. **Step 5 (Verdict Synthesis)**:
   - Because Observation 1.1 violates a mandatory acceptance criterion (`tsc --noEmit` clean pass) and Observation 1.2 causes unhandled runtime crashes on valid OpenAPI documents, the implementation cannot be approved in its current state.

---

## 3. Caveats

1. **JS Runtime vs Typecheck Discrepancy**: At pure JavaScript runtime (e.g. `new Function('z', ...)`), circular references using `z.lazy()` successfully resolve and validate nested instances without stack overflows (as verified in tests). The bug is strictly in TypeScript's compile-time static type inference (`tsc --noEmit`).
2. **Upstream Zod 4 `multipleOf` Behavior**: The behavior observed in Observation 1.4 near `MAX_SAFE_INTEGER` is an upstream limitation of Zod 4's `floatSafeRemainder` epsilon scaling and does not represent an internal bug in `@oa-sdk/codegen`.
3. **Draft 2020-12 Tuple Divergence**: In Observation 1.5, generating closed tuples by default is idiomatic in TypeScript/Zod workflows, though technically narrower than Draft 2020-12's open default.

---

## 4. Conclusion

**Verdict: `REQUEST_CHANGES`**

The OpenAPI 3.2 to Zod 4 generator demonstrates strong algorithmic foundation and clean catamorphic folding, but has two blocking defects that must be remediated:

1. **Remediation 1 (BLOCKING - TS Compilation)**: In `packages/codegen/src/zodgen/generate-zod.ts`, when a schema is referenced circularly or by default, annotate exported schema constants with explicit typing:
   ```typescript
   export const ASchema: z.ZodTypeAny = z.object({ ... })
   ```
   or emit pre-declared interface types to satisfy TypeScript TS7022/TS7024.
2. **Remediation 2 (BLOCKING - Discriminator Crash)**: In `packages/codegen/src/zodgen/schema-to-zod.ts`, when folding variant schemas for `z.discriminatedUnion`, ensure that the property identified by `s.discriminator.propertyName` is strictly required (forced non-optional) across all branches to prevent `Duplicate discriminator value "undefined"` crashes.
3. **Remediation 3 (RECOMMENDED - Metadata Cleanliness)**: In `foldSiblingProperties`, strip `description` and metadata from the synthetic sibling object before folding so that `.describe(...)` is not duplicated.

---

## 5. Verification Method

### 5.1 Run Adversarial Test Suite
Execute the 23-test adversarial suite created by Challenger 1:
```bash
pnpm --filter @oa-sdk/codegen exec vitest run test/zodgen/adversarial-challenger-1.test.ts
```
Expected: 23 passed (23).

### 5.2 Reproduce Circular TS7022 Error
Run in-memory TypeScript typechecking against circular generated code:
```bash
node --import tsx -e "
import ts from 'typescript';
import { generateZodFromSpec } from './packages/codegen/src/zodgen/index.js';
import * as path from 'path';

const doc = {
  openapi: '3.2.0',
  info: { title: 'Circular API', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      A: { type: 'object', properties: { b: { \$ref: '#/components/schemas/B' } } },
      B: { type: 'object', properties: { a: { \$ref: '#/components/schemas/A' } } },
    }
  }
};
const code = generateZodFromSpec(doc);
const fileName = path.resolve('packages/codegen/src/circular-test.ts');
const configPath = ts.findConfigFile('packages/codegen', ts.sys.fileExists, 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, 'packages/codegen');

const host = ts.createCompilerHost(parsedConfig.options);
const origGetSourceFile = host.getSourceFile;
host.getSourceFile = (name, langVersion, onError, shouldCreateNewSourceFile) => {
  if (path.resolve(name) === fileName) return ts.createSourceFile(name, code, langVersion);
  return origGetSourceFile(name, langVersion, onError, shouldCreateNewSourceFile);
};

const program = ts.createProgram([fileName], parsedConfig.options, host);
const diags = ts.getPreEmitDiagnostics(program).filter(d => path.resolve(d.file?.fileName || '') === fileName);
console.log('Errors:', diags.map(d => ts.formatDiagnostic(d, host)));
"
```
Invalidation Condition: Diagnostics count reaches 0.

### 5.3 Reproduce Duplicate Discriminator Value "undefined"
```bash
node -e "
const { z } = require('./packages/codegen/node_modules/zod');
const opt1 = z.object({ kind: z.literal('v1').optional() });
const opt2 = z.object({ kind: z.literal('v2').optional() });
const union = z.discriminatedUnion('kind', [opt1, opt2]);
union.safeParse({ kind: 'v1' });
"
```
Invalidation Condition: SafeParse succeeds without throwing `Duplicate discriminator value "undefined"`.
