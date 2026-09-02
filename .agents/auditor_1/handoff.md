# Forensic Integrity Audit Report

**Work Product**: OA-SDK Codegen CLI Expansions (R1-R3) and Browser-Studio Schema Conventions (R4)  
**Profile**: General Project (Integrity Forensics)  
**Integrity Mode**: Development (per `ORIGINAL_REQUEST.md`)  
**Verdict**: **CLEAN**

---

## 1. Observation

Direct empirical observations across the target workspace:

### 1.1 Source Code Implementation Inspection
1. **Standalone Guards Splitting & Selective Filtering (`packages/codegen/src/standalone-guards/generator.ts`)**:
   - Lines 78–93 implement `--schemas` filtering by matching type names, guard names, and normalized `is` prefixes:
     ```typescript
     if (schemas && schemas.length > 0) {
       const filterList = schemas.map(s => s.trim()).filter(Boolean)
       resolvedGuards = resolvedGuards.filter(guard => { ... })
     }
     ```
   - Lines 99–105 instantiate real Ajv 2020 standalone compiler (`new AjvCtor({ code: { source: true, esm: true }, strict: false })`).
   - Lines 148–223 implement `--split` mode: compiles individual modular guard files (`guards/<TypeName>.js` and `.d.ts`) alongside root barrel `index.js` and `index.d.ts`.
   - AST transform in lines 158–161 converts `export const <name> = <internal>` to explicit named function declarations `export function <name>(data, ...args) { return <internal>(data, ...args); }`.
   - Generated code contains **0 `eval()`**, **0 `new Function()`**, and **0 runtime imports**.

2. **Category-Aware Linting (`packages/codegen/src/cli/commands/lint.ts`)**:
   - Lines 9–18 define `ALLOWED_LINT_CATEGORIES = ['structure', 'operations', 'parameters', 'refs', 'security', 'style', 'components', 'surface']`.
   - Lines 24–44 validate incoming category strings against allowed list.
   - Lines 57–65 invoke `lintDocument(doc, { ... (categories ? { categories } : {}) })` from `@oa-sdk/parser`.
   - Exits with `CliExitError(1)` when error diagnostics are present.

3. **Profile-Aware Validation (`packages/codegen/src/cli/commands/validate.ts`)**:
   - Lines 35–39 validate `--profile` argument against `OPENAPI_PROJECTION_PROFILES` (`component-bundle`, `operation-contract`, `full-api-document`).
   - Lines 71–78 invoke `validateOpenApiProjection({ profile, projection: doc, ... })` from `@oa-sdk/openapi-projection-contract`.
   - Lines 80–92 log diagnostic issues, and line 135 raises `CliExitError(1)` if `!result.valid || (profileResult && !profileResult.valid)`.

4. **Manifest V3 CSP Audit Scanner (`packages/codegen/src/cli/commands/audit-csp.ts`)**:
   - Lines 87–256 implement `auditCspSourceSync` using genuine TypeScript AST parser (`ts.createSourceFile`, `ts.forEachChild`).
   - AST node visitors check:
     - `ts.isCallExpression` for `eval(...)`, `Function(...)`, string `setTimeout(...)`, string `setInterval(...)`, CJS `require(...)`, dynamic `import(...)`.
     - `ts.isNewExpression` for `new Function(...)`.
     - `ts.isImportDeclaration`, `ts.isExportDeclaration`, `ts.isImportEqualsDeclaration` for disallowed schema engines (`ajv`, `zod`, `@oa-sdk`).
   - Lines 310–336 recursively collect all `.js`, `.mjs`, `.cjs` files across bundle directories and report violations with file, line, column, snippet, and summary. Exits with code 1 upon violation.

5. **Authoring Conventions Documentation (`browser-studio/docs/guides/schema-architecture-and-conventions.md`)**:
   - 1,340 lines, 74,640 bytes normative guide.
   - Complete runnable code examples and specifications for:
     - Section 4.4: RFC 9457 `ProblemDetailsSchema` and multi-status OpenAPI 3.1 response mappings (409, 422, 500).
     - Section 6.3: Strict numeric bounds (`exclusiveMinimum: 0` vs `minimum: 0`) and Zod drafting patterns.
     - Section 6.4: Self-referencing recursive schema registry (`z.lazy` + registry cycle-safe projection).
     - Section 6.5: `x-surface-*` scoping rules (object-level `targetProperty` vs inline property-level).
     - Section 5.4–5.6: V3 Unified Architecture JSDoc annotation tag specifications (`@minimum`, `@format`, `@discriminator`).

### 1.2 Independent Verification Runs
- **Typecheck**: `pnpm -r typecheck` succeeded with exit code 0 across all 21 workspace projects.
- **Codegen Unit & Integration Tests**: `pnpm --filter @oa-sdk/codegen test` passed 95 test files (1,141 tests) with 0 failures.
- **End-to-End CLI Tests**: Independent node CLI execution verified clean passes and proper error exits for all commands (`generate --split --schemas`, `audit:csp`, `lint --categories`, `validate --profile`).

---

## 2. Logic Chain

1. **Anti-Cheating / Non-Facade Verification**:
   - Observations 1.1.1 through 1.1.4 establish that no functions return hardcoded constants, mock tables, or dummy responses.
   - All CLI commands execute real AST traversal, real schema validation against `@oa-sdk/parser` and `@oa-sdk/openapi-projection-contract`, and real code compilation using Ajv 2020.
2. **Zero-Eval and Zero-Dependency Verification**:
   - Observation 1.1.1 and test executions confirm that generated standalone type guards compile down to static ESM JavaScript validator functions with zero imports, zero `eval()`, and zero `new Function()`.
   - Observation 1.1.4 confirms that `oa-codegen audit:csp` identifies dynamic evaluation and disallowed imports via TypeScript AST node matching, exiting with code 1 when violations occur.
3. **Acceptance Criteria Fulfillment**:
   - Observation 1.1.1 satisfies R1 (split modular guards and selective filtering).
   - Observations 1.1.2 & 1.1.3 satisfy R2 (category linting and profile validation).
   - Observation 1.1.4 satisfies R3 (Manifest V3 CSP audit scanner).
   - Observation 1.1.5 satisfies R4 (normative conventions documentation).
4. **Monorepo Integrity**:
   - Observation 1.2 confirms monorepo typecheck is 100% clean (21 packages) and unit/e2e test suites pass.

---

## 3. Caveats

No caveats. All four milestone deliverables (R1, R2, R3, R4) were fully implemented, inspected at the AST and source level, and empirically verified with both positive test cases and adversarial error-path scenarios.

---

## 4. Conclusion

**Verdict**: **CLEAN**

All work products for R1, R2, R3, and R4 have been verified to be authentic, production-grade implementations without hardcoded shortcuts, facades, or integrity violations. All acceptance criteria are satisfied.

---

## 5. Verification Method

To independently reproduce the forensic verification results:

```bash
# 1. Monorepo Typecheck
pnpm -r typecheck

# 2. Codegen Test Suite
pnpm --filter @oa-sdk/codegen test

# 3. CLI Build
pnpm --filter @oa-sdk/codegen build

# 4. CLI Help & Command Verification
node packages/codegen/dist/cli/index.js --help
```
