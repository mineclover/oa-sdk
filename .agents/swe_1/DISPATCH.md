## 2026-09-11T02:07:12Z
<USER_REQUEST>
You are the SWE Light Orchestrator (teamwork_preview_swe) for the following task.

Target repository: /Users/junwoobang/workflow/oa-sdk
Your working directory: /Users/junwoobang/workflow/oa-sdk/.agents/swe_1
Original request file: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (under section "## 2026-09-11T02:06:35Z")

## Task Description
Integrate an automated preflight schema validation/linting and normalization pipeline into `@oa-sdk/codegen`'s Zod 4 generator (`generateZodFromSpec` and `oa-gen generate:zod`), ensuring broken or unnormalized OpenAPI 3.2 specifications are safely validated, normalized, and reported with actionable diagnostics before emitting code.

Integrity mode: development

## Requirements
### R1. Preflight Validation & Linting Pipeline in `generateZodFromSpec` & CLI
- Integrate `@oa-sdk/parser`'s `lintDocument` / validation pipeline into `generateZodFromSpec` (`validate?: boolean`, `lintCategories?: LintCategory[]`, `failOnSeverity?: LintSeverity`) and `oa-gen generate:zod` (CLI flags: `--validate`, `--no-validate`, `--lint`, `--force`).
- By default, run preflight validation on critical categories (`structure`, `refs`, `components`).
- When fatal errors (e.g. broken/unresolvable `$ref`, missing schema structure) are detected:
  - Halt code generation immediately (fail-fast) with formatted diagnostic messages pointing to file/pointer coordinates.
  - If `--force` or `--no-validate` is passed, issue warnings to stderr/console and proceed in best-effort mode.

### R2. Automatic Schema Normalization Before Generation
- Before traversing schemas with `foldSchema`, pass the spec document through `normalizeOpenApiDocument` from `@oa-sdk/codegen` to remove collection noise, resolve internal pointer aliasing, sort keys deterministically, and resolve YAML anchors.
- Expose `--no-normalize` / `{ normalize?: false }` option to allow consumers to bypass normalization if desired.

### R3. Programmatic API and Error Structures
- Export `ZodGenerationPreflightError` containing `diagnostics: LintResult[]` so programmatic callers can inspect issues without string parsing.
- Preserve full backward compatibility with all existing `generateZodFromSpec(doc, options)` call signatures.

### R4. CLI UX & Verification Suite
- In `oa-gen generate:zod`:
  - Show clean, actionable console diagnostics when validation issues are encountered.
  - Return exit code 1 on fatal validation errors unless `--force` is provided.
- Comprehensive test suite in `packages/codegen`:
  - Unit tests for preflight validation pass/fail paths in `src/zodgen/`.
  - E2E tests verifying `--validate`, `--no-validate`, `--force`, and `--no-normalize` CLI flags.
  - Adversarial tests with broken refs, missing required components, and unnormalized YAML noise to prove fail-fast and best-effort guarantees.
  - Satisfy monorepo verification gates: `pnpm check:docs`, `pnpm check:cli-spec`, and `pnpm check:api-index`.

## Acceptance Criteria
### Preflight Validation & Normalization
- [ ] `generateZodFromSpec` automatically normalizes input specifications via `normalizeOpenApiDocument` unless `{ normalize: false }` is set.
- [ ] Broken `$ref` or invalid schema structure triggers actionable preflight diagnostics and throws `ZodGenerationPreflightError` (or fails with diagnostic report) when validation is enabled.
- [ ] Passing `{ validate: false }` or `--no-validate` / `--force` bypasses fatal validation stops and attempts best-effort emission.

### CLI Integration
- [ ] `oa-gen generate:zod --spec <broken-spec>` fails with exit code 1 and outputs structured lint diagnostics.
- [ ] `oa-gen generate:zod --spec <broken-spec> --force` emits warnings but attempts code generation.
- [ ] `oa-gen generate:zod --spec <valid-spec>` succeeds cleanly without extraneous noise.

### Test & Monorepo Gates
- [ ] All new tests in `packages/codegen` pass under `pnpm test`.
- [ ] `pnpm check:api-index`, `pnpm check:docs`, and `pnpm check:cli-spec` remain green (0 drift).

Please coordinate the SWE Light workflow (implementer + adversarial reviewer rounds), keep your progress.md and BRIEFING.md updated, and notify the sentinel when complete.
</USER_REQUEST>
