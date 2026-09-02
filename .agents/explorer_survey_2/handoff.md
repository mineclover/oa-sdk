# Survey & Investigation Report: Requirements R2 & R3 in `@oa-sdk`

**Author**: Explorer Survey Agent 2  
**Date**: 2026-09-02T15:53:00Z  
**Scope**: 
- **R2**: CLI Category-Aware Linting (`oa-codegen lint --categories`) & Profile-Aware Validation (`oa-codegen validate --profile`)
- **R3**: Automated Manifest V3 CSP Audit Command (`oa-codegen audit:csp --bundle <dir>`)

---

## 1. Observation

### 1.1 CLI Architecture & Command Dispatch in `@oa-sdk/codegen`
- **CLI Entrypoint**: `packages/codegen/src/cli/index.ts` (lines 16–35) parses `process.argv.slice(2)`, uses a Map lookup `commandMap.get(commandName)` from `commands.ts`, and delegates execution to `runCommand(cmd, args.slice(1))` in `packages/codegen/src/cli/lib/run.ts`.
- **Command Registry**: `packages/codegen/src/cli/commands.ts` (lines 26–50) registers all public CLI commands: `generate`, `typegen`, `buildSpecCommand`, `lint`, `validate`, `normalize`, `upgrade`, `collect`, `tspExport`, `tspRestore`, `tspBundleCheck`, `referenceCheck`, `scaffoldGovernance`, `inventory`, `behaviorQuery`, `duplicateReview`, `targetCheck`, `diff`, `checkArtifact`, `drift`, `review`, `reviewBundle`, `parallelEvidence`.
- **Option Parser**: `packages/codegen/src/cli/lib/run.ts` (lines 17–27) converts `cmd.options` into Node.js built-in `node:util` `parseArgs` configuration.
- **Error Handling**: `packages/codegen/src/cli/lib/errors.ts` defines `CliExitError(exitCode = 1)` caught by `runCommand` (lines 38–41) to exit cleanly with `process.exitCode = err.exitCode` without unhandled stack traces.
- **Package Manifest**: `packages/codegen/package.json` line 19 defines `"bin": { "oa-gen": "./dist/cli/index.js" }`.

---

### 1.2 Existing Lint Implementation & Category Support
- **CLI Command `lint`**: `packages/codegen/src/cli/commands/lint.ts` (lines 8–39):
  ```typescript
  export const lint: Command = {
    name: 'lint',
    description: 'OAS 3.2 스펙 린트',
    options: {
      spec: { type: 'string', short: 's', required: true, description: 'OAS spec 파일 경로' },
    },
    async run(args) {
      const { lintDocument } = await import('@oa-sdk/parser')
      const { document: doc, path: resolvedSpecPath, raw } = loadSpecWithPath(str(args, 'spec'))
      const sourceLocations = createCliSourceLocationResolver({ filePath: resolvedSpecPath, raw })
      const results = lintDocument(doc, {
        basePath: resolvedSpecPath,
        lookupSourceLocation: sourceLocations.lookup,
      })
      ...
    }
  }
  ```
- **Underlying Engine in `@oa-sdk/parser`**: `packages/parser/src/lint.ts`:
  - Lines 55–64: `LintCategory` type definition:
    ```typescript
    export type LintCategory =
      | 'structure'
      | 'operations'
      | 'parameters'
      | 'refs'
      | 'security'
      | 'style'
      | 'components'
      | 'surface'
    ```
  - Lines 65–74: `LintOptions` definition:
    ```typescript
    export type LintOptions = {
      /** 실행할 규칙 카테고리 (기본: 전체) */
      categories?: LintCategory[]
      rules?: Record<string, 'off' | 'warn' | 'error'>
      basePath?: string
      lookupSourceLocation?: (filePath: string, pointer: string) => { line: number; column: number } | undefined
    }
    ```
  - Lines 86–98: `lintDocument` selectively triggers rules based on `categories` set:
    ```typescript
    const categories = new Set(options.categories ?? ['structure', 'operations', 'parameters', 'refs', 'security', 'style', 'components', 'surface'])

    if (categories.has('structure')) lintStructure(spec, results)
    if (categories.has('operations')) lintOperations(spec, results)
    if (categories.has('parameters')) lintParameters(spec, results)
    if (categories.has('refs')) {
      lintRefs(spec, results)
      lintDerefDiagnostics(spec, results, options)
    }
    if (categories.has('security')) lintSecurity(spec, results)
    if (categories.has('style')) lintStyle(spec, results)
    if (categories.has('components')) lintComponents(spec, results)
    if (categories.has('surface')) lintSurface(spec, results)
    ```
- **Observation**: `@oa-sdk/parser` already implements category filtering in `lintDocument`. However, the CLI command in `packages/codegen/src/cli/commands/lint.ts` does not declare or accept `--categories <list>`.

---

### 1.3 Existing Validation & Profile Semantics in `@oa-sdk/openapi-projection-contract`
- **CLI Command `validate`**: `packages/codegen/src/cli/commands/validate.ts` (lines 15–89):
  - Currently defines options: `spec` (required), `require-32`, `incremental`, `cache-dir`.
  - Step 1 executes `validateDocument(doc, ...)` from `@oa-sdk/parser`.
  - Step 2 checks OAS 3.1 compatibility.
  - Currently does not have `--profile` option.
- **Profile Definitions in `@oa-sdk/openapi-projection-contract`**: `packages/openapi-projection-contract/src/index.ts`:
  - Lines 1–5:
    ```typescript
    export const OPENAPI_PROJECTION_PROFILES = [
      'component-bundle',
      'operation-contract',
      'full-api-document',
    ] as const
    export type OpenApiProjectionProfile = typeof OPENAPI_PROJECTION_PROFILES[number]
    ```
  - Lines 38–87: `OPENAPI_PROJECTION_PROFILE_SEMANTICS`:
    - `component-bundle`: Reusable schema components without requiring an API surface. `paths` may be absent or empty (`rule: 'may-be-empty'`); `components.schemas` is required with at least one schema (`components: { schemas: 'required' }`).
    - `operation-contract`: Request/response contracts represented as OpenAPI operations. `paths` must contain at least one operation object under a path item (`paths: { rule: 'requires-operation' }`).
    - `full-api-document`: A complete OpenAPI document intended for host-level OpenAPI validation (`paths: { rule: 'standard-openapi' }`).
  - Lines 195–216: `validateOpenApiProjection(result: unknown): SchemaValidateResult`:
    - Validates envelope and calls `validateOpenApiDocument(result.projection, profile, diagnostics)` (lines 232–294):
      - Line 285–293:
        ```typescript
        if (profile === 'component-bundle') {
          validateComponentBundleRequirements(components, diagnostics)
        } else if (profile === 'operation-contract' && !pathsHasOperation) {
          addValidationError(
            diagnostics,
            'openapi-projection/profile-requirement',
            'operation-contract projections must contain at least one operation object under paths.',
          )
        }
        ```
      - Line 402–419: `validateComponentBundleRequirements`:
        ```typescript
        const schemas = components?.schemas
        if (!isRecord(schemas)) {
          addValidationError(diagnostics, 'openapi-projection/profile-requirement', 'component-bundle projections must declare components.schemas.')
          return
        }
        if (Object.keys(schemas).length === 0) {
          addValidationError(diagnostics, 'openapi-projection/profile-requirement', 'component-bundle projections must include at least one schema in components.schemas.')
        }
        ```
- **Observation**: `validateOpenApiProjection` rigorously validates the three profiles. Specifically, `operation-contract` fails with code `'openapi-projection/profile-requirement'` if `paths` has no operations.

---

### 1.4 Manifest V3 CSP Audit Requirements (R3)
- **Requirement**: `oa-codegen audit:csp --bundle <dir>` scanning bundled JavaScript files for Content Security Policy violations.
- **Forbidden Patterns**:
  1. Dynamic code evaluation / unsafe-eval:
     - `eval(...)`
     - `new Function(...)` / `Function(...)`
     - `setTimeout(string, ...)`
     - `setInterval(string, ...)`
  2. Disallowed runtime heavy schema engines / imports / requires in extension bundle artifacts:
     - `ajv` (e.g. `import Ajv from 'ajv'`, `require('ajv')`, `from 'ajv/...'`)
     - `zod` (e.g. `import { z } from 'zod'`, `require('zod')`)
     - `@oa-sdk` runtime imports in production extension bundles (e.g. `import ... from '@oa-sdk/...'`, `require('@oa-sdk/...')`)
- **Expected CLI Output**: Formatted diagnostics emitting file path, line, column, error code, violation details, and exit code 1 when any violations exist, or exit code 0 when clean.

---

## 2. Logic Chain

### 2.1 Implementing Category-Aware Linting (`oa-codegen lint --categories <list>`)
1. **Observation**: `@oa-sdk/parser`'s `lintDocument(doc, options)` already accepts `categories?: LintCategory[]` where valid values are `'structure' | 'operations' | 'parameters' | 'refs' | 'security' | 'style' | 'components' | 'surface'`.
2. **Missing Link**: `packages/codegen/src/cli/commands/lint.ts` does not define `categories` in `options` or pass it to `lintDocument`.
3. **Proposed Wiring**:
   - Add option definition:
     ```typescript
     categories: { type: 'string', description: '실행할 규칙 카테고리 (쉼표 구분: structure, operations, parameters, refs, security, style, components, surface)' }
     ```
   - In `run(args)`:
     - Read `optStr(args, 'categories')`.
     - When provided, parse by comma, trim whitespace, and validate each against allowed `LintCategory` set.
     - If an unrecognized category is passed, emit a clear error and exit code 1.
     - Pass `categories: parsedCategories` to `lintDocument(doc, { basePath, lookupSourceLocation, categories: parsedCategories })`.
4. **Acceptance Test Satisfied**: Running `oa-codegen lint --spec <spec> --categories surface` executes only `lintSurface` rules, ignoring structure/operations/parameters.

---

### 2.2 Implementing Profile-Aware Validation (`oa-codegen validate --profile <profile>`)
1. **Observation**: `@oa-sdk/openapi-projection-contract` exports `OPENAPI_PROJECTION_PROFILES` (`component-bundle`, `operation-contract`, `full-api-document`), `isOpenApiProjectionProfile()`, and `validateOpenApiProjection()`.
2. **Missing Link**: `packages/codegen/src/cli/commands/validate.ts` only runs generic `validateDocument()` and OAS 3.1 compatibility checks, ignoring projection profile constraints.
3. **Proposed Wiring**:
   - Add option definition in `validate.ts`:
     ```typescript
     profile: { type: 'string', description: 'OpenAPI 프로젝션 프로필 (component-bundle | operation-contract | full-api-document)' }
     ```
   - In `run(args)`:
     - Read `optStr(args, 'profile')`.
     - If `profile` is provided:
       - Validate using `isOpenApiProjectionProfile(profile)`. If invalid, throw `Error(`--profile 값은 ${OPENAPI_PROJECTION_PROFILES.join(' | ')} 중 하나여야 합니다: ${profile}`)`.
       - Execute profile validation using `validateOpenApiProjection`:
         ```typescript
         const projectionResult = validateOpenApiProjection({
           profile,
           projection: doc as Record<string, unknown>,
           refs: [],
           diagnostics: [],
           sources: {},
           versionHash: 'cli-validation',
         })
         ```
       - Print Step header (e.g. `━━━ Step 1.5: 프로젝션 프로필 검증 (${profile}) ━━━`) and format profile diagnostics.
       - If `!projectionResult.valid`, mark overall validation as invalid and ensure `throw new CliExitError(1)`.
4. **Acceptance Test Satisfied**:
   - Spec with empty/operationless `paths`: `validate --spec <spec> --profile operation-contract` fails with `'openapi-projection/profile-requirement'` diagnostic and exits code 1.
   - Valid spec with operations: `validate --spec <spec> --profile operation-contract` passes with exit code 0.

---

### 2.3 Implementing Automated Manifest V3 CSP Audit (`oa-codegen audit:csp --bundle <dir>`)
1. **Observation**: Standalone guard artifacts are designed for Manifest V3 content scripts where `script-src 'self'` disallows string code evaluation, and bundle size constraints disallow heavy engines like AJV or Zod.
2. **Design of `audit:csp`**:
   - Create new command `packages/codegen/src/cli/commands/audit-csp.ts`:
     ```typescript
     export const auditCsp: Command = {
       name: 'audit:csp',
       description: 'Manifest V3 번들의 Content Security Policy (CSP) 위반 및 런타임 의존성 감사',
       options: {
         bundle: { type: 'string', short: 'b', required: true, description: '번들 디렉토리 또는 JS 파일 경로' },
       },
       async run(args) { ... }
     }
     ```
   - Register in `packages/codegen/src/cli/commands.ts` and export.
   - **Scanning Strategy**:
     - Locate all `.js`, `.mjs`, `.cjs` files inside the specified `--bundle` target directory (recursively or flat).
     - Parse each file using TypeScript AST (`ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)`).
     - AST Visitor checks:
       1. `ts.isCallExpression`:
          - Function identifier is `eval` -> `csp/no-eval` ("Disallowed eval() execution in Manifest V3 bundle")
          - Function identifier is `setTimeout` or `setInterval` and argument 0 is a string literal / template literal (`ts.isStringLiteral`, `ts.isNoSubstitutionTemplateLiteral`, `ts.isTemplateExpression`) -> `csp/no-string-settimeout` / `csp/no-string-setinterval` ("Disallowed string evaluation in setTimeout/setInterval")
          - Function identifier is `require` with argument matching `/^(ajv|zod|@oa-sdk(\/.*)?)$/` -> `csp/no-disallowed-import` ("Disallowed runtime dependency import: require(...)")
       2. `ts.isNewExpression`:
          - Constructor identifier is `Function` -> `csp/no-new-function` ("Disallowed new Function() code evaluation in Manifest V3 bundle")
       3. `ts.isImportDeclaration` / `ts.isExportDeclaration`:
          - `moduleSpecifier` text matches `/^(ajv|zod|@oa-sdk(\/.*)?)$/` or `/^ajv(\/.*)?$/` -> `csp/no-disallowed-import` ("Disallowed heavy schema engine or SDK runtime import: ...")
       4. Regex scanning fallback for minified bundle strings or edge occurrences.
   - **Diagnostics & Exit**:
     - Format diagnostics with line/column (retrieved via `sourceFile.getLineAndCharacterOfPosition(node.getStart())`), icon `❌`, rule name, file location, and offending line snippet.
     - If any violations are found: print summary (e.g. `❌ 3 CSP violations detected across 2 files`) and throw `CliExitError(1)`.
     - If 0 violations found: print `✅ 0 CSP violations found across N bundle files.` and return 0.

---

## 3. Caveats

1. **CLI Binary Names**:
   - `packages/codegen/package.json` specifies `"oa-gen": "./dist/cli/index.js"`.
   - The user request refers to `oa-codegen`. In test runners, commands are invoked via `packages/codegen/dist/cli/index.js` (or via `oa-gen`). If an alias `"oa-codegen": "./dist/cli/index.js"` is desired in `package.json`, adding it to `bin` ensures both `oa-gen` and `oa-codegen` work globally/via npx.
2. **Subcommand Syntax**:
   - `audit:csp` uses colon notation. Because `index.ts` matches `args[0]` against `commandMap.get(commandName)`, naming the command `audit:csp` works natively with `oa-gen audit:csp --bundle <dir>`.
3. **Empty Directories in `--bundle`**:
   - If `--bundle` points to an empty directory or contains no `.js`/`.mjs`/`.cjs` files, the command should throw a user-friendly error with exit code 1 stating that no JavaScript files were found to audit.

---

## 4. Conclusion & Actionable Tasks

### Architecture Map of Required Changes
```
packages/codegen/
├── src/
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── lint.ts            # [R2] Add --categories option & forward to lintDocument
│   │   │   ├── validate.ts        # [R2] Add --profile option & validateOpenApiProjection check
│   │   │   └── audit-csp.ts       # [R3] NEW: audit:csp command implementation with AST CSP checks
│   │   └── commands.ts            # Register auditCsp command
│   └── __tests__/
│       ├── cli-scenarios.test.ts  # Add tests for --categories, --profile, audit:csp
│       └── cli-audit-csp.test.ts  # Dedicated unit tests for CSP auditor
```

### Specific Acceptance Criteria Realization
1. **Category-Aware Linting**:
   - `oa-codegen lint --spec <spec> --categories surface` only runs `lintSurface`.
2. **Profile-Aware Validation**:
   - `oa-codegen validate --spec <spec> --profile operation-contract` fails if `paths` has no operations and passes when valid.
3. **CSP Audit Command**:
   - `oa-codegen audit:csp --bundle <dir>` cleanly passes standalone guard bundles and exits with code 1 on bundles containing `eval`, `new Function`, `from 'ajv'`, etc.

---

## 5. Verification Method

### 5.1 Project Commands
```bash
# Build core packages
pnpm build:core

# Run codegen test suite
pnpm --filter @oa-sdk/codegen test

# Run parser test suite
pnpm --filter @oa-sdk/parser test

# Run openapi-projection-contract test suite
pnpm --filter @oa-sdk/openapi-projection-contract test

# Full typecheck
pnpm typecheck:core
```

### 5.2 Verification Test Matrix
1. **`lint --categories`**:
   - Test spec with both a `structure` error (e.g. missing `info.title`) and a `surface` error.
   - Run `lint --categories surface` -> reports ONLY surface error, ignores structure error.
   - Run `lint --categories structure` -> reports ONLY structure error.
2. **`validate --profile`**:
   - Test spec with `paths: {}` (no operations):
     - `validate --profile operation-contract` -> exits with code 1, reports `openapi-projection/profile-requirement`.
     - `validate --profile component-bundle` (with `components.schemas`) -> passes.
   - Test spec with valid operations -> `validate --profile operation-contract` passes (code 0).
3. **`audit:csp`**:
   - Directory A with generated standalone guards -> `audit:csp --bundle dirA` passes with 0 errors (code 0).
   - Directory B with file containing `eval('alert(1)')` -> fails with code 1 (`csp/no-eval`).
   - Directory C with file containing `new Function('return 1')` -> fails with code 1 (`csp/no-new-function`).
   - Directory D with file containing `setTimeout('doSomething()', 100)` -> fails with code 1 (`csp/no-string-settimeout`).
   - Directory E with file containing `import Ajv from 'ajv'` -> fails with code 1 (`csp/no-disallowed-import`).
