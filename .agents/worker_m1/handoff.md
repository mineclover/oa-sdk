# Handoff Report: Milestone 1 — Standalone Guards Splitting & Filtering (R1)

## 1. Observation

### 1.1 Modified Files and Content
1. **`packages/codegen/src/standalone-guards/types.ts`**:
   - Added `schemas?: string[] | undefined` to `StandaloneGuardGeneratorOptions` to support filtering by schema type names or guard function names.
   - Added `split?: boolean | undefined` to `StandaloneGuardGeneratorOptions` to support modular per-schema file output.

2. **`packages/codegen/src/standalone-guards/generator.ts`**:
   - Implemented schema filtering on `resolvedGuards`:
     - Matches exact guard name (`guard.name === term`).
     - Matches exact schema type name (`guard.typeName === term`).
     - Matches prefix-normalized identifier (`term.startsWith('is') && guard.typeName === term.slice(2)` or `!term.startsWith('is') && guard.name === 'is' + term`).
     - Case-insensitive fallback for resilient CLI input parsing.
     - Returns empty artifact array `[]` when filtering leaves no candidate targets.
   - Implemented split generation when `options.split === true`:
     - Emits individual standalone validator modules to `guards/<TypeName>.js` and TypeScript declarations to `guards/<TypeName>.d.ts`.
     - Inlines any `$ref` sub-schemas so each split guard module is 100% self-contained at runtime with 0 runtime dependencies and 0 `eval()` / `new Function()`.
     - Emits root barrel re-exports `index.js` (`export * from './guards/<TypeName>.js';`) and `index.d.ts` (`export * from './guards/<TypeName>.js';`).
     - Honors `generateDeclarations: false` and custom `typeImportSpecifier`.

3. **`packages/codegen/src/cli/commands/generate.ts`**:
   - Declared `split: { type: 'boolean', description: '개별 가드 모듈 분할 생성 (guards/<TypeName>.js)' }` in `generate.options`.
   - Updated `schemas` description to explain guard/component filtering.
   - Parsed `bool(args, 'split')` and `optStr(args, 'schemas')` in `runStandaloneGuards` and forwarded them in `generatorOptions`.

4. **`packages/codegen/test/standalone-guards/generator.test.ts`**:
   - Added unit test suite `Split Mode Generation (split: true)` verifying:
     - Modular file emission (`guards/SurfaceBlock.js`, `guards/SurfaceBlock.d.ts`, `guards/SurfaceParam.js`, `guards/SurfaceParam.d.ts`, `index.js`, `index.d.ts`).
     - Zero eval, zero new Function, and zero external imports in split files.
     - Inlined `$ref` sub-schemas enabling isolated standalone execution with zero runtime dependencies.
     - Split mode with `generateDeclarations: false`.
   - Added unit test suite `Selective Filtering (schemas option)` verifying:
     - Filtering by exact guard function names.
     - Filtering by exact schema type names.
     - Filtering with prefix normalization.
     - Combined `split: true` and `schemas` filtering.
     - Empty result handling on non-matching filters.

5. **`packages/codegen/test/standalone-guards/cli.test.ts`**:
   - Added CLI tests verifying:
     - `generate --target standalone-guards --input ... --out-dir ... --split`
     - `generate --target standalone-guards --input ... --out-dir ... --schemas ...`
     - `generate --target standalone-guards --input ... --out-dir ... --split --schemas ...`

---

## 2. Logic Chain

1. **Modular Splitting (`--split`)**:
   - In large OpenAPI specifications, bundling all compiled validator functions into a single `guards.js` forces downstream consumers (such as Chrome Extension Manifest V3 background workers) to parse and evaluate unused schemas.
   - By creating `guards/<TypeName>.js` per component using `standaloneCode(ajv, { [guard.name]: guard.name })`, Ajv extracts only the AST nodes required for that specific schema while embedding all necessary `$ref` sub-validators inlined within the file scope.
   - Root `index.js` and `index.d.ts` barrel re-exports preserve backward compatibility with unified bundle imports (`import { isSurfaceBlock } from './guards'`).

2. **Selective Filtering (`--schemas`)**:
   - Developers often need to generate type guards for only a specific subset of OpenAPI schemas.
   - Normalizing schema filter terms across `is` prefixes (e.g. `SurfaceBlock` vs `isSurfaceBlock`) allows flexible CLI invocation (`--schemas SurfaceBlock,SurfaceParam` or `--schemas isSurfaceBlock,isSurfaceParam`).

3. **Inlined $ref & Zero-Dependency Invariant**:
   - Because the root OpenAPI document is added to the Ajv compilation instance before generating single-target code, all internal `$ref` pointers resolve cleanly at build-time and generate pure self-contained JavaScript without cross-file imports or runtime dependencies.

---

## 3. Caveats

- **Anonymous Root Documents**:
  - When an input document has no `components.schemas` or `$defs` and no `title` or `name`, the generator defaults `guard.name` to `'isRoot'` and `guard.typeName` to `''`. In split mode, this generates `guards/isRoot.js` and `guards/isRoot.d.ts` with predicate `data is unknown`.
- **Empty Filter Results**:
  - If a filter list in `--schemas` does not match any schemas in the input spec, the generator returns `[]` without writing empty files.

---

## 4. Conclusion

Milestone 1 (Standalone Guards Splitting & Filtering - R1) is fully implemented, verified, and ready for integration.
- `StandaloneGuardGeneratorOptions` supports `split` and `schemas`.
- Split generation creates individual modular files in `guards/` alongside root barrel exports.
- All split files are 100% self-contained with zero runtime dependencies and 0 `eval()` / `new Function()`.
- CLI `oa-codegen generate` supports `--split` and `--schemas`.
- All unit, CLI, and E2E tests for R1 pass (100%).
- Monorepo typecheck is clean.

---

## 5. Verification Method

### 5.1 Project Test Commands
```bash
# 1. Run standalone guards unit & CLI tests
pnpm --filter @oa-sdk/codegen test test/standalone-guards

# 2. Run standalone guards E2E test suite
pnpm --filter @oa-sdk/codegen test test/e2e/standalone-guards.e2e.test.ts

# 3. Run R1 E2E tests in cli-expansions suite
pnpm --filter @oa-sdk/codegen test -t "R1" test/e2e/cli-expansions.e2e.test.ts

# 4. Monorepo TypeScript compilation check
pnpm -r typecheck
```

### 5.2 Test Results
- `test/standalone-guards/generator.test.ts`: 17 passed
- `test/standalone-guards/cli.test.ts`: 6 passed
- `test/e2e/standalone-guards.e2e.test.ts`: 27 passed
- `test/e2e/cli-expansions.e2e.test.ts` (R1 tests): 20 passed
- `pnpm -r typecheck`: 21/21 workspace packages clean (0 errors)
