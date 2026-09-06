# Progress

- Last visited: 2026-09-05T07:18:00Z
- Status: Gate remediation complete and 100% verified.
  - Task 1: Fixed `.annotate(...)` call in `docs/guides/schema-architecture-and-conventions.md:1209-1245` with clean Zod master schema authoring and typed `SurfaceExtensionFields` contract. Confirmed snippet executes cleanly with tsx.
  - Task 2: Fixed `runSpecValidation` in `packages/codegen/src/cli/commands/validate.ts` by extracting `isRecursiveRefCycle` and applying consistent circular ref suppression for recursive OAS 3.1 schemas in single `--spec` mode. Confirmed `oa-gen validate --spec ... --profile component-bundle` exits with code 0 on `visual-ir.openapi.json`.
  - Verification:
    - `pnpm --filter @oa-sdk/codegen test src/__tests__/e2e`: 202/202 tests pass (100% pass, including T1-F14-4).
    - `pnpm -r typecheck`: 0 errors across 21 packages.
    - `pnpm check:docs`: 0 errors across 230 markdown files and 24 OAS reference files.
    - `pnpm exec tsx scripts/check-cli-spec.ts`: 0 errors (2 manifests, 27 commands).
    - Documentation snippet execution: 0 errors, parses valid parameters cleanly.
