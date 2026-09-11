# Milestone 3 Handoff Report: Personas & DPM Native TypeSpec Decorators

- **Role**: Personas & DPM Decorators Worker (implementer, qa, specialist)
- **Working Directory**: `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m3`
- **Milestone**: M3 (Requirement R3 / Phase 4)
- **Target Packages**:
  - `packages/typespec-decorators`
  - `packages/personas`
  - `packages/dpm`

---

## 1. Observation

1. **TypeSpec Decorator Architecture**:
   - In `packages/typespec-decorators/lib/decorators.tsp`, the library previously only declared `oaUseResponseComponent(target: Operation, statusCode: valueof string, componentName: valueof string)` importing `../dist/decorators.js` under namespace `OaSdkTypeSpec`.
   - In `packages/typespec-decorators/src/decorators.ts`, decorator functions follow the TypeSpec convention `$decoratorName(context: DecoratorContext, target: TargetType, ...)`. Extensions are attached via `@typespec/openapi` functions `getExtensions(context.program, target)` and `setExtension(context.program, target, extensionName, payload)`.
   - In `packages/typespec-decorators/src/lib.ts`, diagnostics are registered with `createTypeSpecLibrary` using the namespace `@oa-sdk/typespec-decorators`.

2. **Persona Capability Traits Taxonomy**:
   - `packages/personas/src/traits/skill.yaml` defines exactly 24 capability traits across 6 categories:
     - `request-shape`: `pagination`, `filter-by-role`, `filter-by-status`, `full-text-search`, `batch`
     - `response-shape`: `sse-stream`, `etag-supported`, `partial-response`
     - `lifecycle`: `idempotent`, `retryable`, `cacheable`
     - `observability`: `audit-emission`, `metrics-emission`, `trace-context`
     - `security`: `pii-visible-admin`, `pii-masked-default`, `pseudonymized`, `signed-response`, `mtls`
     - `integration`: `webhook-source`, `webhook-target`, `oauth-scope-aware`, `rate-limit-honored`, `idempotency-key-required`

3. **Persona Trait Loading & Validation**:
   - In `packages/personas/src/load.ts` (lines 103-140), `OperationInfo` only tracked `operationId`, `path`, `method`, and `responses: Set<string>`. `loadOperationsFromMergedSpec` did not read `x-oa-sdk-persona-traits`.
   - In `packages/personas/src/validate.ts` (lines 130-155), validation checked `checkMapsTo` and `checkExpects`, but did not check endpoint capability traits against persona required skills (`Persona.skills`).
   - In `packages/personas/scripts/validate.ts`, the validation report exits with code 1 if any issue has severity `'error'`.

4. **DPM Manifest & Data Binding Invariants**:
   - In `packages/dpm/src/validator/safety-column-identifier-gates.ts` (lines 8-31), core DPM safety invariants are defined:
     - `SAF001`: `direct_identifier` columns cannot use `keep` transform.
     - `SAF002`: `pii=true foreign_identifier` columns require a `relationship` reference.
     - `SAF010`: `pii=true` columns cannot leak raw values with `keep` transform.
   - In `packages/dpm/src/validator/data-binding-validator.ts` (lines 170-192), `validateDpmDataBindings` resolved JSON pointers to API targets, but did not inspect `x-oa-sdk-dpm-projection`.

5. **Direct Tool Verification Outputs**:
   - `pnpm --filter @oa-sdk/typespec-decorators test`:
     ```
     Test Files  2 passed (2)
          Tests  13 passed (13)
     Duration  1.80s
     ```
   - `pnpm personas:check`:
     ```
     TypeSpec bundle check: restore targets: 195 applied, 0 missing. 0 errors, 0 warnings.
     TypeSpec schema freshness check: restored normalized diff: pass (0 accepted).
     Personas v0.11 bound: 103 personas (92 implemented · 11 proposed).
     Personas v0.11 validate: 103 personas: 0 errors · 0 warnings. Exit code 0.
     ```
   - `pnpm --filter @oa-sdk/personas test`:
     ```
     Test Files  12 passed (12)
          Tests  160 passed (160)
     Duration  692ms
     ```
   - `pnpm --filter @oa-sdk/dpm test test/validator-data-binding.test.ts test/validator-safety.test.ts`:
     ```
     Test Files  2 passed (2)
          Tests  14 passed (14)
     Duration  8.12s
     ```
   - `pnpm check:dpm-surface`:
     ```
     DPM pack dry-run OK: 56 files. Exit code 0.
     ```
   - `pnpm schema:typespec-check`:
     ```
     restored normalized diff: pass (0 accepted). Exit code 0.
     ```
   - `pnpm --filter @oa-sdk/typespec-decorators typecheck && pnpm --filter @oa-sdk/personas typecheck && pnpm --filter @oa-sdk/dpm typecheck`:
     ```
     Exit code 0 across all 3 packages.
     ```

---

## 2. Logic Chain

1. **Implementing Native TypeSpec Decorators (`@oa-sdk/typespec-decorators`)**:
   - **Extern Declarations**: In `lib/decorators.tsp`, added `personaCapability(target: Operation, ...traits: valueof string[])` and `pseudonymize(target: ModelProperty, transform: valueof string, role?: valueof string, pii?: valueof boolean, relationship?: valueof string)`.
   - **Diagnostic Registration**: In `src/lib.ts`, registered `invalid-persona-trait` and `invalid-pseudonymize-rule` diagnostics.
   - **Decorator Implementation**:
     - `$personaCapability`: Validates each trait argument against `VALID_PERSONA_TRAITS` (24 traits). Unknown traits trigger `reportDiagnostic({ code: 'invalid-persona-trait' })`. Valid traits are merged with existing `x-oa-sdk-persona-traits` on the operation, deduplicated using `new Set()`, and sorted alphabetically before being stored via `setExtension(context.program, target, 'x-oa-sdk-persona-traits', merged)`.
     - `$pseudonymize`: Validates `transform` against `VALID_DPM_TRANSFORMS` (8 transforms) and `role` against `VALID_DPM_ROLES` (6 roles). Enforces DPM safety invariants (`SAF001`: direct_identifier cannot use keep; `SAF002`: pii foreign_identifier requires relationship; `SAF010`: pii field cannot use keep). On success, stores `{ transform, role, pii, relationship }` via `setExtension(context.program, target, 'x-oa-sdk-dpm-projection', payload)`.
   - **Compiler Emission Verification**: In `src/decorators.emitter.test.ts`, verified using real `tsp compile` execution that both decorators compile cleanly and emit their extensions into OpenAPI 3.2 YAML output (`paths[path][method]['x-oa-sdk-persona-traits']` and `components.schemas[Model].properties[Field]['x-oa-sdk-dpm-projection']`).

2. **Downstream Consumption in `@oa-sdk/personas`**:
   - **Trait Extraction**: In `packages/personas/src/load.ts`, extended `OperationInfo` with `traits?: Set<string>`. In `loadOperationsFromMergedSpec`, inspected `op['x-oa-sdk-persona-traits']`. If present as an array of strings, populated `traits: new Set(rawTraits)`.
   - **Endpoint Trait Obligation Validation**: In `packages/personas/src/validate.ts`, implemented `checkOperationTraits(persona, domain, knownOperations, issues, kind)`. When an implemented persona on an `openapi-http` domain requires skills (`persona.skills: string[]`) and maps to an operation (`persona.outcome.maps_to`):
     - If the mapped operation declares traits (`op.traits !== undefined`), the validator verifies that `op.traits.has(skill)` for every required skill. Any missing skill produces an error: `endpoint trait obligation shortfall: operation '<id>' lacks required persona skill '<skill>'`.
     - If the mapped operation has not declared traits (`op.traits === undefined`), validation does not report shortfall errors, maintaining backward compatibility with legacy operations.
   - **Unit Testing**: Added `packages/personas/src/__tests__/persona-traits.test.ts` covering trait parsing, fulfillment matching, shortfall detection, and proposed/system persona handling.

3. **Downstream Consumption in `@oa-sdk/dpm`**:
   - **Data Binding Validator**: In `packages/dpm/src/validator/data-binding-validator.ts`, when resolving an API binding's JSON pointer to the target schema property:
     - Detects `x-oa-sdk-dpm-projection`.
     - Validates DPM safety invariants `SAF001`, `SAF002`, and `SAF010` directly on the projected property.
     - When the data field is linked to physical storage (`storageRef`), compares the OpenAPI projection's `role` and `transform` against the DPM manifest's declared column policy, reporting `DAT008` on policy mismatch.
   - **Safety Validator**: In `packages/dpm/src/validator/safety-validator.ts`, when validating manifest columns, checks for `x-oa-sdk-dpm-projection` and merges projected policies into `validateSafetyColumnGates`.
   - **Unit Testing**: Added 5 integration tests in `packages/dpm/test/validator-data-binding.test.ts` covering valid matching projections, SAF001, SAF002, SAF010 violations, and manifest-projection mismatch detection.

---

## 3. Caveats

- **Existing Spec Coverage**: In `packages/schemas/src/.merged.yaml`, production operations do not yet use `@personaCapability` decorators because Milestone 3 establishes the decorator infrastructure and governance gates. The validation logic was designed so that unannotated endpoints (`op.traits === undefined`) pass cleanly without breaking existing CI gates, while annotated endpoints strictly enforce trait obligations.
- **TypeScript AST Emitter Coupling**: `@oa-sdk/typespec-decorators` defines the 24 standard capability traits statically to prevent heavy runtime circular dependencies between `@oa-sdk/personas` and `@oa-sdk/typespec-decorators`. The static list matches `packages/personas/src/traits/skill.yaml` 1:1.
- No other caveats.

---

## 4. Conclusion

Requirement R3 (Phase 4) is fully implemented and genuinely verified across all three target packages:
1. `@oa-sdk/typespec-decorators` exports `@personaCapability` and `@pseudonymize` with strict validation against canonical traits and DPM safety invariants (`SAF001`, `SAF002`, `SAF010`), emitting `x-oa-sdk-persona-traits` and `x-oa-sdk-dpm-projection`.
2. `@oa-sdk/personas` loads `x-oa-sdk-persona-traits` into `OperationInfo.traits` and validates endpoint trait obligations during `personas:check`.
3. `@oa-sdk/dpm` recognizes `x-oa-sdk-dpm-projection` in `validateDpmDataBindings` and enforces safety invariants and manifest column alignment.
4. All unit tests, emitter integration tests, packaging surface checks, and governance gates pass with 100% compliance.

---

## 5. Verification Method

To independently verify the implementation:

1. **Run TypeSpec Decorators Tests (Unit & Compiler Integration)**:
   ```bash
   pnpm --filter @oa-sdk/typespec-decorators test
   ```
   *Expected output*: 13 tests passed across `decorators.test.ts` and `decorators.emitter.test.ts`.

2. **Run Personas Check & Unit Tests**:
   ```bash
   pnpm personas:check
   pnpm --filter @oa-sdk/personas test
   ```
   *Expected output*: 103 personas verified with 0 errors and 0 warnings. 160 unit tests pass.

3. **Run DPM Tests & Surface Gate**:
   ```bash
   pnpm --filter @oa-sdk/dpm test test/validator-data-binding.test.ts test/validator-safety.test.ts
   pnpm check:dpm-surface
   ```
   *Expected output*: All validator tests pass. DPM pack dry-run OK: 56 files.

4. **Run TypeSpec Schema Freshness Gate**:
   ```bash
   pnpm schema:typespec-check
   ```
   *Expected output*: 195 restore targets applied, restored normalized diff: pass (0 accepted). Exit code 0.

5. **Typecheck All Targets**:
   ```bash
   pnpm --filter @oa-sdk/typespec-decorators typecheck && pnpm --filter @oa-sdk/personas typecheck && pnpm --filter @oa-sdk/dpm typecheck
   ```
   *Expected output*: Clean exit code 0.

### Invalidation Conditions
- An unrecognized trait (e.g. `@personaCapability("invalid")`) compiles without reporting diagnostic `invalid-persona-trait`.
- Direct identifier with keep transform (`@pseudonymize("keep", "direct_identifier")`) compiles without reporting diagnostic `invalid-pseudonymize-rule`.
- `loadOperationsFromMergedSpec` fails to extract `x-oa-sdk-persona-traits` into `OperationInfo.traits`.
- `validate` allows an implemented persona with required skills to map to an operation that lacks those declared traits.
- `validateDpmDataBindings` permits raw PII leaks (`SAF001`, `SAF010`) in `x-oa-sdk-dpm-projection`.
