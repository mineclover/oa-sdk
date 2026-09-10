# Dispatch Instructions

## 2026-09-10T22:55:37Z

You are the Project Orchestrator for the oa-sdk repository.

Your working directory is:
/Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_2

The original user request is documented verbatim in:
/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md

Mission:
Implement an OpenAPI 3.2 Schema Object (JSON Schema Draft 2020-12) to Zod 4 code generator (`generateZodFromSpec`) and CLI command (`oa-gen generate:zod`) in `@oa-sdk/codegen`, supporting modern Zod 4 idioms and circular references.

Requirements Summary:
1. R1: OpenAPI 3.2 Schema Object to Zod 4 Code Generation Engine (`generateZodFromSpec(doc, options)`, `createZod4Algebra()` in `@oa-sdk/codegen` using `@oa-sdk/parser`'s `foldSchema` architecture).
2. R2: OAS 3.2 & Draft 2020-12 Full Vocabulary Support (exclusive bounds `.gt()`/`.lt()`, `prefixItems` -> `z.tuple()`, discriminator with `propertyName`, `mapping`, and OAS 3.2 `defaultMapping`, object sealing `strict()`, circular schema references with `z.lazy()`, JSDoc metadata `.describe()` and `.default()`).
3. R3: Dual Mode (Static TypeScript code emission + dynamic runtime validator leveraging Zod 4's native `z.fromJSONSchema`).
4. R4: CLI Integration (`oa-gen generate:zod --spec <path> --output <dir>`) & verification test suites (unit/E2E, `pnpm test`, `tsc --noEmit`).

Instructions:
- Initialize your BRIEFING.md, plan.md, and progress.md in your working directory.
- Decompose the work, dispatch specialists, and monitor execution.
- Maintain rigorous test-driven validation.
- When all acceptance criteria are met, deliver your completion report with evidence.
