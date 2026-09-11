# Dispatch: Milestone 3 - Personas & DPM Native TypeSpec Decorators

## Mission
Implement Requirement R3 (Phase 4) in `@oa-sdk/typespec-decorators`, `@oa-sdk/personas`, and `@oa-sdk/dpm`:
1. In `@oa-sdk/typespec-decorators`:
   - `lib/decorators.tsp`: Extern declarations for `@personaCapability` (target: Operation, ...traits: valueof string[]) and `@pseudonymize` (target: ModelProperty, transform: valueof string, role?: valueof string, pii?: valueof boolean, relationship?: valueof string).
   - `src/decorators.ts`:
     - `@personaCapability`: validates traits against the 24 capability traits defined in `packages/personas/src/traits/skill.yaml`. Rejects unknown traits by reporting diagnostic `invalid-persona-trait`. Merges, sorts, and emits `x-oa-sdk-persona-traits: string[]` under the OpenAPI Operation Object.
     - `@pseudonymize`: validates transform against DPM transforms (`keep`, `redact`, `mask`, `null`, `hash`, `generalize`, `relationship_token`, `polymorphic_relationship_token`). Enforces DPM safety invariants (`SAF001`: direct_identifier cannot use keep; `SAF002`: pii foreign_identifier requires relationship; `SAF010`: pii field cannot use keep). Emits `x-oa-sdk-dpm-projection` under the OpenAPI Schema property.
   - `src/lib.ts`: Register diagnostics `invalid-persona-trait`, `invalid-pseudonymize-rule`, etc.
2. In `@oa-sdk/personas`:
   - `src/load.ts`: Update `loadOperationsFromMergedSpec` to extract `x-oa-sdk-persona-traits` into `OperationInfo.traits`.
   - `src/validate.ts`: Ensure persona validator checks endpoint trait obligations against persona required skills.
3. In `@oa-sdk/dpm`:
   - Ensure DPM validation gates (`data-binding-validator.ts`, `safety-validator.ts`) recognize and validate `x-oa-sdk-dpm-projection`.
4. Verification:
   - Run `pnpm --filter @oa-sdk/typespec-decorators test`
   - Run `pnpm personas:check`
   - Run `pnpm --filter @oa-sdk/dpm test`

## Exclusive File Ownership
- `packages/typespec-decorators/lib/decorators.tsp`
- `packages/typespec-decorators/src/decorators.ts`
- `packages/typespec-decorators/src/lib.ts`
- `packages/typespec-decorators/src/decorators.test.ts`
- `packages/personas/src/load.ts`
- `packages/personas/src/validate.ts`
- `packages/personas/src/__tests__/persona-traits.test.ts`
- `packages/dpm/src/validator/data-binding-validator.ts`

## Mandatory Rules & Warnings
- MANDATORY INTEGRITY WARNING:
  DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
- Read `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` before starting work.
- Consult the survey findings at `/Users/junwoobang/workflow/oa-sdk/.agents/spec_miner_survey_3/handoff.md`.
- Run builds and tests for affected targets and report results in handoff.

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/handoff.md`.

## 2026-09-10T23:28:44Z
You are the Personas & DPM Decorators Worker for Milestone 3.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3
Read your instructions in /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/DISPATCH.md.
Also read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md, /Users/junwoobang/workflow/oa-sdk/PROJECT.md, and /Users/junwoobang/workflow/oa-sdk/.agents/spec_miner_survey_3/handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement R3 (Phase 4): Native TypeSpec Decorators @personaCapability and @pseudonymize in packages/typespec-decorators, emit extensions x-oa-sdk-persona-traits and x-oa-sdk-dpm-projection, and integrate with packages/personas and packages/dpm.
Run tests and validation gates (pnpm personas:check) to verify compliance.
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m3/handoff.md.
Send a message to parent when complete.
