## 2026-09-02T14:53:23Z
You are the Worker for Milestone 2: Non-AST Character Range Patching Metadata Extensions.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/m2_worker
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read PROJECT.md at /Users/junwoobang/workflow/oa-sdk/PROJECT.md.
Read the specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

File Ownership:
- `packages/openapi-projection-contract/src/surface-extensions.ts`
- `packages/openapi-projection-contract/src/index.ts` (exporting surface extensions)
- `packages/openapi-projection-contract/test/surface-extensions.test.ts`
- `packages/parser/src/lint.ts` (adding 'surface' linting category and rules)
- `packages/parser/test/surface-lint.test.ts`

Task:
1. Standardize `x-surface-*` vendor extensions in `packages/openapi-projection-contract/src/surface-extensions.ts`:
   - Constants: `OPENAPI_SURFACE_ANCHOR_EXTENSION = 'x-surface-anchor'`, `OPENAPI_SURFACE_PARAM_RANGE_EXTENSION = 'x-surface-param-range'`, `OPENAPI_SURFACE_FINGERPRINT_EXTENSION = 'x-surface-fingerprint'`, `OPENAPI_SURFACE_QUOTE_STYLE_EXTENSION = 'x-surface-quote-style'`, `OPENAPI_SURFACE_PATCH_POLICY_EXTENSION = 'x-surface-patch-policy'`, `OPENAPI_SURFACE_EXTENSION_NAMES`.
   - Interfaces: `SurfaceAnchorMetadata`, `SurfaceParamRangeMetadata`, `SurfaceQuoteStyle` ('single' | 'double' | 'backtick' | 'none'), `SurfacePatchPolicyMetadata` (`onDrift: 'abort' | 'rebase' | 'force'`).
   - Wire into `packages/openapi-projection-contract/src/index.ts`.
2. Add `'surface'` linting category and rules to `packages/parser/src/lint.ts`:
   - `surface/valid-anchor`: Validate `id` non-empty string, `line >= 1`, `column >= 1`.
   - `surface/valid-param-range`: Validate `targetProperty` exists in schema `properties`, `maxFramerateHz > 0`.
   - `surface/valid-fingerprint`: Validate format `^sha256:[a-f0-9]{64}$`.
   - `surface/valid-quote-style`: Validate enum `'single' | 'double' | 'backtick' | 'none'`.
   - `surface/valid-patch-policy`: Validate `onDrift` is `'abort' | 'rebase' | 'force'`, `retryLimit >= 0`.
   - Update `LintOptions` in `packages/parser/src/lint.ts` to include `'surface'` in `categories`.
3. Write comprehensive unit tests in `packages/openapi-projection-contract/test/surface-extensions.test.ts` and `packages/parser/test/surface-lint.test.ts`.
4. Run tests and typechecks:
   `pnpm --filter @oa-sdk/openapi-projection-contract test`
   `pnpm --filter @oa-sdk/parser test`
   `pnpm --filter @oa-sdk/parser typecheck`
5. Write your handoff report to `/Users/junwoobang/workflow/oa-sdk/.agents/m2_worker/handoff.md`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Send a message to parent upon completion.
