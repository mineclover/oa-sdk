# Project: OA-SDK & Browser-Studio CLI Expansions & Conventions

## Architecture
This project implements high-priority CLI feature expansions in `@oa-sdk/codegen` and updates normative schema authoring conventions across `@oa-sdk` and `@browser-studio`.

### Core Subsystems
1. **Standalone Guards Generation Engine (`packages/codegen/src/standalone-guards/`)**:
   - Compiles OpenAPI 3.1 / JSON Schema 2020-12 definitions to standalone ESM JavaScript validators and TypeScript declaration files with 0 `eval()`, 0 `new Function()`, and 0 runtime dependencies.
   - Built-in zero-dependency format registry (`STANDALONE_FORMATS`) for RFC 3339 date/time/date-time, RFC 3986 URI, email, UUID, IPv4, IPv6, duration, byte, int32, int64, json-pointer, and inlined `__ucs2length` and `__equal` helpers.
   - Provides `--split` modular generation (`guards/<TypeName>.js`, `guards/<TypeName>.d.ts`, root barrel `index.js`/`index.d.ts`, and root `package.json` with `"type": "module"`).
   - Provides `--schemas <list>` selective filtering matching type names or guard function names.

2. **CLI Governance & Lint/Validation Engine (`packages/codegen/src/cli/`)**:
   - `oa-codegen lint --categories <list>`: Category-targeted rule execution (`structure`, `operations`, `parameters`, `refs`, `security`, `style`, `components`, `surface`).
   - `oa-codegen validate --profile <profile>`: Profile-aware projection validation (`component-bundle`, `operation-contract`, `full-api-document`) via `@oa-sdk/openapi-projection-contract`.

3. **Manifest V3 CSP Audit Scanner (`packages/codegen/src/cli/commands/audit-csp.ts`)**:
   - `oa-codegen audit:csp --bundle <dir>`: TypeScript AST scanning for unsafe dynamic execution (`eval`, `new Function`, string `setTimeout`/`setInterval`) and disallowed heavy runtime dependencies (`ajv`, `zod`, `@oa-sdk`) in extension bundles, exiting with code 1 on violations.

4. **Schema Authoring Conventions (`browser-studio/docs/guides/schema-architecture-and-conventions.md`)**:
   - Normative specifications for RFC 9457 `ProblemDetailsSchema`, strict numeric bounds (`exclusiveMinimum: 0` vs `minimum: 0`), self-referencing recursive schema registry (`z.lazy`), `x-surface-*` scope rules (`targetProperty`), and V3 Unified Architecture JSDoc annotation tags.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| 1 | Standalone Guards `--split` Option | Outputs individual modular files per schema (`guards/<TypeName>.js` and `.d.ts`) plus unified root `index.js` / `index.d.ts` barrel. | M1 | R1, ORIGINAL_REQUEST §R1 |
| 2 | Standalone Guards `--schemas` Filtering | Filters guard generation to only requested schema type names or guard function names (e.g. `isSurfaceBlock,isSurfaceParam`). | M1 | R1, ORIGINAL_REQUEST §R1 |
| 3 | Split Guards $ref Inlining & Zero Dependencies | Ensures split guard modules inline all referenced schemas and format validators, maintaining 0 eval, 0 new Function, and 0 runtime dependencies. | M1 | R1, ORIGINAL_REQUEST §R1 |
| 4 | CLI Lint `--categories` Flag | Executes only specified lint rule categories (e.g. `surface,structure,operations`) via `@oa-sdk/parser`. | M2 | R2, ORIGINAL_REQUEST §R2 |
| 5 | CLI Validate `--profile` Flag | Enforces profile-specific projection invariants via `@oa-sdk/openapi-projection-contract` (`component-bundle`, `operation-contract`, `full-api-document`). | M2 | R2, ORIGINAL_REQUEST §R2 |
| 6 | Operation-Contract Validation Rule | Rejects OpenAPI specs with empty/missing operations under `paths` when `--profile operation-contract` is specified. | M2 | R2, ORIGINAL_REQUEST §R2 |
| 7 | Manifest V3 CSP Audit Command | Implements `oa-codegen audit:csp --bundle <dir>` scanning bundled JS files for CSP violations and disallowed runtime imports. | M3 | R3, ORIGINAL_REQUEST §R3 |
| 8 | CSP Unsafe Code & Engine Import Detection | AST detection of `eval(`, `new Function(`, string `setTimeout`/`setInterval`, and imports of `ajv`, `zod`, `@oa-sdk`. | M3 | R3, ORIGINAL_REQUEST §R3 |
| 9 | CSP Audit CLI Diagnostics & Exit Code | Emits structured diagnostics and exits with code 1 upon violation, or code 0 when clean. | M3 | R3, ORIGINAL_REQUEST §R3 |
| 10 | RFC 9457 Problem Details Specification | Documentation and runnable examples for RFC 9457 `ProblemDetailsSchema` and 422/409/500 operation responses. | M4 | R4, ORIGINAL_REQUEST §R4 |
| 11 | Strict Numeric Bounds Specification | Documentation of numeric `exclusiveMinimum: 0` vs `minimum: 0` in Draft 2020-12 / OAS 3.1 and Zod drafting patterns. | M4 | R4, ORIGINAL_REQUEST §R4 |
| 12 | Recursive Schemas with `z.lazy` Specification | Documentation for self-referential schema registry and cyclic `$ref` projection without infinite recursion. | M4 | R4, ORIGINAL_REQUEST §R4 |
| 13 | `x-surface-*` Scope Rules Specification | Documentation of object-level `targetProperty` vs inline property-level metadata. | M4 | R4, ORIGINAL_REQUEST §R4 |
| 14 | V3 Unified Architecture JSDoc Tag Specifications | Documentation of `@minimum`, `@format`, `@discriminator`, and constraint annotations in AST bidirectional sync. | M4 | R4, ORIGINAL_REQUEST §R4 |
| 15 | Monorepo Integrity & E2E Verification | 100% pass across full E2E test suites (Tiers 1-4) and adversarial hardening (Tier 5), `pnpm test`, and `pnpm -r typecheck`. | Final Milestone | ORIGINAL_REQUEST Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| E2E | E2E Testing Track | Design & write comprehensive test suites (Tiers 1-4) across R1, R2, R3, R4 -> publish TEST_READY.md | none | DONE |
| M1 | Standalone Guards Splitting & Filtering | Implement `--split`, `--schemas`, and zero-dependency inlined formats in `packages/codegen` (Features 1, 2, 3) | none | DONE |
| M2 | CLI Lint Categories & Profile Validation | Implement `--categories` in `lint` and `--profile` in `validate` in `packages/codegen` (Features 4, 5, 6) | none | DONE |
| M3 | Manifest V3 CSP Audit Command | Implement `audit:csp` CLI command and AST scanner in `packages/codegen` (Features 7, 8, 9) | none | DONE |
| M4 | Authoring Conventions Documentation | Update `browser-studio/docs/guides/schema-architecture-and-conventions.md` with complete specifications and code examples (Features 10-14) | none | DONE |
| Remediation | Victory Audit Remediation | Zero-dependency format regex inlining, helper inlining, package.json module declaration, and clean monorepo pnpm test | M1, M3 | DONE |
| Final | Full E2E Pass & Adversarial Hardening | Verify 100% passing E2E tests across all tiers, adversarial coverage audit, `pnpm test`, `pnpm -r typecheck` | all | DONE |

## Code Layout
- Exclusive Write Ownership:
  - M1 Worker: `packages/codegen/src/standalone-guards/`, `packages/codegen/src/cli/commands/generate.ts`, `packages/codegen/test/standalone-guards/`
  - M2 Worker: `packages/codegen/src/cli/commands/lint.ts`, `packages/codegen/src/cli/commands/validate.ts`, `packages/codegen/test/cli/`
  - M3 Worker: `packages/codegen/src/cli/commands/audit-csp.ts`, `packages/codegen/src/cli/commands.ts`, `packages/codegen/test/audit-csp/`
  - M4 Worker: `/Users/junwoobang/workflow/browser-studio/docs/guides/schema-architecture-and-conventions.md` (and mirrored documentation)
  - E2E Test Writer: `packages/codegen/test/e2e/`
