# Dispatch: E2E Testing Track

## Mission
Design and implement a comprehensive opaque-box E2E test suite for the TypeSpec Ecosystem Expansion (Phases 2, 3, 4):
1. Create `TEST_INFRA.md` at the project root per the template in `PROJECT.md` and the E2E Testing Track specifications.
2. Implement test infrastructure and test cases in `tests/e2e/typespec-ecosystem/`:
   - **Tier 1 - Feature Coverage (>=5 per feature)**:
     - F1-F8 (TypeSpec AST Semantic Diff): test operation removal, route changes, model removal, property removal, required property addition, status code removal, @operationId changes, non-breaking additions.
     - F9-F13 (Zero-Build Instant Mock Server): test mock server startup on port 4010, valid endpoints matching schema, 422 input validation, hot reloading on schema changes.
     - F14-F19 (Personas & DPM Decorators): test @personaCapability with valid traits, rejection of invalid traits, @pseudonymize rules, safety violations (SAF001, SAF002, SAF010), emitted OpenAPI extensions.
   - **Tier 2 - Boundary & Corner Cases (>=5 per feature)**:
     - Empty models, extreme numeric bounds, special characters in routes/identifiers, missing optional parameters, duplicate decorators, circular models.
   - **Tier 3 - Cross-Feature Combinations (Pairwise)**:
     - Mock server serving endpoints decorated with @personaCapability and @pseudonymize.
     - Semantic diff comparing TypeSpec specs with persona and DPM decorators.
   - **Tier 4 - Real-World Application Scenarios (>=5)**:
     - Complete API lifecycle: authoring TypeSpec with personas/DPM -> instant mock preview -> breaking change detection before CI merge -> persona matrix verification.
3. Once the test suite is complete and executable, publish `TEST_READY.md` at project root with test runner command, tier breakdown, and coverage checklist.

## Constraints & Mandatory Rules
- Subagents MUST read `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` before starting work.
- Requirement-driven, opaque-box: derive tests from user requirements, not implementation internals.
- Do not modify implementation source code files in `packages/`.
- Tests must be independently executable via `pnpm test:e2e` or `vitest run tests/e2e/typespec-ecosystem`.

## Inputs
- /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
- /Users/junwoobang/workflow/oa-sdk/PROJECT.md
- /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-sdk/SKILL.md
- /Users/junwoobang/workflow/oa-sdk/.agents/skills/oa-governance/SKILL.md

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/test_writer_e2e/handoff.md`.
Publish `TEST_INFRA.md` and `TEST_READY.md` at project root.

## 2026-09-10T23:28:44Z
You are the E2E Test Writer for the TypeSpec Ecosystem Expansion.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/test_writer_e2e
Read your instructions in /Users/junwoobang/workflow/oa-sdk/.agents/test_writer_e2e/DISPATCH.md.
Also read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md and /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Design and implement the complete opaque-box E2E test suite across Tiers 1-4.
Create TEST_INFRA.md and publish TEST_READY.md when complete.
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/test_writer_e2e/handoff.md.
Send a message to parent when complete.

