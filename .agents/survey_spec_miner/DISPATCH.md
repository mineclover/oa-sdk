## 2026-09-02T14:48:15Z

You are a Specification Miner.
Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/survey_spec_miner
Read ORIGINAL_REQUEST.md at /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
Read the authoritative specification at /Users/junwoobang/workflow/browser-studio/docs/specs/oa-sdk-integration-proposals.md.

Task:
Extract and document the complete specification for the 4 Upstream Architectural Proposals:
1. Native Discriminated Union Projection (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/codegen`)
   - Multiplexed single-stream RPC/stdio operations & polymorphic Zod/JSON schemas -> canonical OpenAPI 3.1 discriminator + oneOf models.
   - `projectDiscriminatedUnion` helper API and projection contract profile integrations.
2. Non-AST Character Range Patching Metadata Extensions (`@oa-sdk/openapi-projection-contract`, `@oa-sdk/parser`)
   - `x-surface-*` vendor extensions (`x-surface-anchor`, `x-surface-param-range`, `x-surface-fingerprint`, `x-surface-quote-style`, `x-surface-patch-policy`) across schema envelopes and parser linting rules.
3. Standalone Lightweight Type Guard Generator Plugin (`@oa-sdk/codegen`)
   - Zero-eval, zero-runtime dependency pre-compiled static ESM type guard generator (`oa-codegen generate --target standalone-guards`) using `ajv/dist/2020` and `ajv/dist/standalone`. Pure ESM `.js` + `.d.ts` type guards (`data is T`).
4. TypeScript AST Bidirectional Synchronization (`@oa-sdk/codegen`, `@oa-sdk/spec-lens`, `@oa-sdk/schemas`)
   - V3 Unified Architecture bidirectional synchronization engine between `EntitySpec` intermediate representations and source code.
   - Pluggable Type Adapters (`ZodAdapter`, `TsAstAdapter`, `TypiaAdapter`), reverse-offset bottom-up TextEdit diffing, lossless comment/formatting retention.

Write your comprehensive feature and requirement breakdown to:
`/Users/junwoobang/workflow/oa-sdk/.agents/survey_spec_miner/spec_inventory.md`
And write your handoff report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/survey_spec_miner/handoff.md`
