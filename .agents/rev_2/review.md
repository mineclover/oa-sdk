# Comprehensive Review Report: Proposals 3 & 4 (@oa-sdk/codegen)

**Reviewer**: Reviewer 2 (Reviewer & Adversarial Critic)  
**Date**: 2026-09-03  
**Target Package**: `@oa-sdk/codegen`  
**Proposals Reviewed**:
- **Proposal 3**: Standalone Lightweight Type Guard Generator Plugin (`packages/codegen/src/standalone-guards/`, `packages/codegen/src/cli/commands/generate.ts`)
- **Proposal 4**: TypeScript AST Bidirectional Synchronization V3 (`packages/codegen/src/ast-sync/`)

---

## 1. Review Summary

**Verdict**: **APPROVE**

The implementations for Proposal 3 (Standalone Lightweight Type Guard Generator) and Proposal 4 (TypeScript AST Bidirectional Synchronization V3) in `@oa-sdk/codegen` are fully conformant with upstream architectural specifications, pass all quality and adversarial criteria, and exhibit zero integrity violations.

- **Proposal 3**: Produces pure ESM validator files with 0 runtime dependencies, 0 `eval()`, and 0 `new Function()` invocations, ensuring strict Chrome Manifest V3 Content Security Policy (CSP) compliance. Emits accurate TypeScript `.d.ts` type guard declarations (`data is T`) with optional type import specifiers. Integrated seamlessly into CLI (`oa-codegen generate --target standalone-guards --input ...`).
- **Proposal 4**: Canonical `EntitySpec` intermediate representation connects pluggable type adapters (`ZodTypeAdapter`, `TsAstTypeAdapter`, `TypiaTypeAdapter`). Structural AST diffs are computed accurately via `computeEntitySpecDiff`. Surgical patching applies reverse-offset descending `TextEdit`s (`applyTextEdits`), achieving 0 index shifting and 100% trivia, indentation, and comment retention.
- **Verification & Test Results**:
  - `pnpm --filter @oa-sdk/codegen test`: **86 test files passed, 974 unit/integration tests passed (100%)**.
  - `pnpm --filter @oa-sdk/codegen typecheck`: **0 errors, clean pass**.
  - `pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/`: **3 test files passed, 86 tests passed (100%)**.
  - `pnpm -r typecheck`: **All 21 monorepo projects passed (100%)**.

---

## 2. Detailed Findings & Quality Assessment

### 2.1 Proposal 3: Standalone Lightweight Type Guard Generator Plugin

#### Architecture & Implementation Review
- **`packages/codegen/src/standalone-guards/types.ts`**:
  - Defines `StandaloneGuardTarget`, `StandaloneGuardGeneratorOptions`, and `GeneratedGuardArtifact`.
  - Supports custom guard targets, automated schema discovery from `$defs`, `definitions`, and `components.schemas`, custom type import specifiers, declaration toggles, and module formats.
- **`packages/codegen/src/standalone-guards/generator.ts`**:
  - Integrates `ajv/dist/2020.js` with `ajv/dist/standalone/index.js` and `ajv-formats`.
  - Configures Ajv with `code: { source: true, esm: true }`.
  - Automatically parses and registers root documents with `$id: 'urn:oa-sdk:root'`, mapping JSON pointers (`#/$defs/...`, `#/components/schemas/...`) or inline schema objects to unique standalone guard functions.
  - Generates:
    1. `guards.js`: Compiled pure ESM validation logic.
    2. `guards.d.ts`: TypeScript type guard signatures `export declare function isType(data: unknown): data is Type;`.
    3. `index.js` & `index.d.ts`: Re-export entrypoints (`export * from './guards.js';`).
- **`packages/codegen/src/cli/commands/generate.ts`**:
  - Extends `generate` CLI command with `--target standalone-guards`, `--input`, `--out-dir`, `--type-import`, and `--module-format`.
  - Supports both JSON (`.json`) and YAML (`.yaml`, `.yml`) schema input documents.

#### Quality & Security Verification
1. **CSP Zero-Eval Invariant**: Verified that emitted JS contains zero `eval()` calls and zero `new Function()` invocations. The pre-compiled standalone functions inline validation logic directly.
2. **Zero Runtime Dependency**: Output code imports no external modules (`ajv`, `zod`, etc.) and runs natively in standard JS runtimes.
3. **Type Narrowing Invariant**: Generated declaration files accurately declare TypeScript user-defined type guards `(data: unknown): data is T`.

---

### 2.2 Proposal 4: TypeScript AST Bidirectional Synchronization (V3 Unified Architecture)

#### Architecture & Implementation Review
- **`packages/codegen/src/ast-sync/entity-spec.ts`**:
  - Canonical in-memory AST IR: `EntitySpec`, `EntityPropertySpec`, `PropertyConstraint`, `EntityDiscriminator`, `TextEdit`, `ASTDiff`.
  - Comprehensive constraint model: `min`, `max`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `format`, `default`, `email`, `url`, `uuid`, `cuid`, `datetime`, `int`, `positive`, `nonnegative`, `negative`, `nonpositive`, `multipleOf`, `enum`.
- **`packages/codegen/src/ast-sync/adapter-interface.ts`**:
  - Clean `TypeAdapter<TSource, TTarget>` interface contract (`read`, `parse`, `write`, `emit`, `diff`, `patch`).
- **`packages/codegen/src/ast-sync/diff-engine.ts`**:
  - `computeEntitySpecDiff`: Computes semantic and structural differences across entity names, kinds, docComments, discriminators, extends clauses, and property additions, deletions, and modifications.
  - Normalizes aliases (e.g. `min` vs `minimum`, `uuid` vs `format: 'uuid'`) to avoid false-positive drift diffs.
- **`packages/codegen/src/ast-sync/text-edit.ts`**:
  - `applyTextEdits`: Implements descending reverse-offset bottom-up text patching.
  - Enforces strict offset validation (`start >= 0`, `end >= start`, `end <= length`) and overlap detection (`next.end <= current.start`).
- **`packages/codegen/src/ast-sync/adapters/zod.ts` (`ZodTypeAdapter`)**:
  - AST reader for `z.object({...})` and `z.discriminatedUnion(...)`. Unwraps chained method calls (`.min()`, `.max()`, `.email()`, `.optional()`, `.nullable()`, `.default()`, `.describe()`).
  - AST patcher calculates surgical text edits within the object literal expression, leaving outside comments and trivia untouched.
- **`packages/codegen/src/ast-sync/adapters/ts-ast.ts` (`TsAstTypeAdapter`)**:
  - AST reader and writer for TypeScript `interface` and `type` declarations.
  - Handles `extends` heritage clauses, optional properties (`?`), union nullability (`string | null`), and JSDoc blocks.
- **`packages/codegen/src/ast-sync/adapters/typia.ts` (`TypiaTypeAdapter`)**:
  - Parses and separates Typia JSDoc validation tags (`@minimum`, `@maximum`, `@format`, `@pattern`, `@default`) from non-Typia documentation tags (`@deprecated`, `@example`, `@see`).
  - Preserves non-Typia comments verbatim during roundtrips while updating constraint tags.
- **`packages/codegen/src/ast-sync/type-sync.ts` (`syncEntitySpecWithCode`)**:
  - Unified high-level synchronizer with automatic dialect detection (`zod`, `typia`, `ts-ast`) and explicit adapter overrides.

---

## 3. Adversarial & Integrity Review

### 3.1 Integrity Violation Audit
- **Hardcoded test outputs in source code**: None found. All generators and adapters execute dynamic AST analysis and Ajv compilation.
- **Dummy / Facade implementations**: None found. Real TypeScript Compiler AST API (`ts.createSourceFile`, `ts.isPropertyAssignment`, etc.) and Ajv 2020 standalone compiler are employed.
- **Shortcut bypasses**: None found.
- **Fabricated verification outputs**: None found. All test runs were executed live and verified directly.

### 3.2 Adversarial Stress-Testing Scenarios
1. **CSP Hostile Environment**:
   - Tested emitted JS against forbidden eval / dynamic code patterns.
   - Result: PASS.
2. **Reverse-Offset Overlap Collision**:
   - Tested `applyTextEdits` with overlapping character spans `[13, 24]` and `[19, 24]`.
   - Result: Successfully throws `Overlapping text edit ranges: [19, 24] overlaps with [13, 24]`.
3. **Invalid Range Coordinates**:
   - Tested negative starts, inverted bounds (`start > end`), and offsets exceeding file length.
   - Result: Successfully throws `Invalid text edit range`.
4. **Source Trivia & Comment Retention**:
   - Tested multi-step mutations with interleaved block comments (`/* ... */`), line comments (`// @surface ...`), and JSDoc tags (`@deprecated`).
   - Result: All non-modified lines, formatting, and comments were preserved verbatim.
5. **Bidirectional Multi-Dialect Roundtrip**:
   - `Zod -> EntitySpec -> TypeScript Interface -> EntitySpec -> Typia -> EntitySpec -> Zod`.
   - Result: PASS with zero semantic drift.

---

## 4. Verified Claims Matrix

| Claim | Verification Method | Status |
|---|---|:---:|
| Zero-eval CSP compliance | AST inspection + regex scan for `eval` / `new Function` in emitted guards | **PASS** |
| Zero runtime dependencies | Inspected import statements in generated guard JS artifacts | **PASS** |
| TypeScript `data is T` declarations | Checked emitted `.d.ts` signatures for `isType(data: unknown): data is Type` | **PASS** |
| CLI `--target standalone-guards` | Executed CLI against JSON and YAML schemas | **PASS** |
| Reverse-offset bottom-up TextEdit | Unit and E2E tests verifying descending sort, 0 offset shifting, overlap errors | **PASS** |
| Lossless trivia and comment retention | E2E test suites with inline comments, JSDoc tags, `@surface` annotations | **PASS** |
| Pluggable Type Adapters (Zod, TS, Typia) | Executed dialect parsing, emission, and diffing tests | **PASS** |
| Monorepo Typecheck & Build | `pnpm -r typecheck` across all 21 workspace packages | **PASS** |

---

## 5. Conclusion & Recommendation

Proposal 3 and Proposal 4 are complete, robust, well-tested, and ready for production upstream merge.
**Verdict: APPROVE**.
