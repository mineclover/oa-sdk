# Original User Request

## Initial Request — 2026-09-02T15:46:07Z

Implement the high-priority (P1 & P2) CLI feature expansions in `@oa-sdk/codegen` and update authoring conventions across `@oa-sdk` and `@browser-studio`: (1) Standalone guards module splitting (`--split`) and selective filtering (`--schemas`), (2) Category-aware linting (`--categories`) and profile-aware validation (`--profile`), (3) Automated Manifest V3 CSP audit command (`oa-codegen audit:csp`), and (4) Standardized convention guide enhancements (RFC 9457 Problem Details, numeric bounds, self-referential schemas, x-surface-* scopes, and V3 JSDoc tags).

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Standalone Guards Splitting & Filtering (`oa-codegen generate --target standalone-guards`)
Extend the standalone type guard generator in `@oa-sdk/codegen` with:
- `--split`: Outputs individual modular files per schema (e.g. `guards/<TypeName>.js` and `guards/<TypeName>.d.ts`) alongside a unified `index.js` re-export, enabling tree-shaking and preventing gigantic single-file bundles.
- `--schemas <comma-separated>`: Filters generation to only the requested schema type names or guard function names.

### R2. CLI Category-Aware Linting & Profile-Aware Validation (`oa-codegen lint`, `oa-codegen validate`)
- Add `--categories <list>` flag to `oa-codegen lint` allowing targeted rule execution (e.g. `--categories surface,structure,operations`).
- Add `--profile <component-bundle | operation-contract | full-api-document>` flag to `oa-codegen validate` enforcing profile-specific projection invariants via `@oa-sdk/openapi-projection-contract`.

### R3. Automated Manifest V3 CSP Audit Command (`oa-codegen audit:csp`)
Implement a dedicated CLI command `oa-codegen audit:csp --bundle <dir>` that scans bundled JavaScript files for Content Security Policy violations:
- Detects any occurrences of `eval(`, `new Function(`, `setTimeout(string)`, or `setInterval(string)`.
- Detects disallowed runtime heavy schema engines (`ajv`, `zod`, `@oa-sdk`) in production extension bundles.
- Emits structured CLI diagnostics with exit code 1 upon violation.

### R4. Authoring Conventions Documentation & Schema Updates
Update `docs/guides/schema-architecture-and-conventions.md` in `browser-studio` with normative specifications for:
- RFC 9457 `ProblemDetailsSchema` convention for error responses (422/500/conflict).
- Strict numeric bounds (`exclusiveMinimum: 0` vs `minimum: 0`) and Zod drafting patterns.
- Self-referencing recursive schema registry conventions (`z.lazy` + registry refs).
- `x-surface-*` scope rules (object-level `targetProperty` vs inline property-level).
- V3 Unified Architecture JSDoc annotation tag specifications (`@minimum`, `@format`, `@discriminator`).

## Acceptance Criteria

### Standalone Guards Splitting & Filtering
- [ ] Running `oa-codegen generate --target standalone-guards --input <spec> --out-dir <dir> --split` produces separate `.js` and `.d.ts` files for each schema component plus a root `index.js` barrel.
- [ ] Running with `--schemas isSurfaceBlock,isSurfaceParam` emits only the targeted type guards.
- [ ] All split guard modules maintain 0 eval, 0 new Function, and 0 runtime dependencies.

### CLI Lint & Validate Options
- [ ] `oa-codegen lint --spec <spec> --categories surface` executes only surface rules.
- [ ] `oa-codegen validate --spec <spec> --profile operation-contract` fails if `paths` has no operations and passes when valid.

### CSP Audit Command
- [ ] `oa-codegen audit:csp --bundle <dir>` correctly passes clean standalone guard bundles and exits with code 1 on bundles containing forbidden patterns (`eval`, `new Function`, `from 'ajv'`).

### Conventions Documentation
- [ ] `schema-architecture-and-conventions.md` contains complete, runnable code examples for RFC 9457, recursive schemas, and JSDoc tag mapping.

### Monorepo Integrity
- [ ] All unit tests pass in `@oa-sdk` (`pnpm test`).
- [ ] Monorepo typecheck is clean (`pnpm -r typecheck`).
