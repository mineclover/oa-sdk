# BRIEFING — 2026-09-02T14:51:45Z

## Mission
Deeply investigate @oa-sdk/openapi-projection-contract, @oa-sdk/parser, @oa-sdk/codegen, @oa-sdk/spec-lens, @oa-sdk/schemas and identify all necessary modifications, creations, AST transformations, AJV usage, and npm dependencies for the 4 proposals in oa-sdk-integration-proposals.md.

## 🔒 My Identity
- Archetype: explorer
- Roles: Codegen & AST Integration Explorer
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast
- Original parent: 68ae2354-2e51-4b8a-8016-61950725263e
- Milestone: Investigation & Analysis Complete

## 🔒 Key Constraints
- Read-only investigation — do NOT modify codebase source code.
- Write only to /Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/
- Focus on Codegen, AST Handling, Projection Contracts, Parsers, Spec-Lens, and Schemas across the 4 proposals.

## Current Parent
- Conversation ID: 68ae2354-2e51-4b8a-8016-61950725263e
- Updated: 2026-09-02T14:51:45Z

## Investigation State
- **Explored paths**:
  - `packages/openapi-projection-contract/` (projection profiles, envelope validation)
  - `packages/parser/` (linter, schema validator, definition projection)
  - `packages/codegen/` (CLI commands, typegen, source adapters, canonical IR, zod-to-schema)
  - `packages/spec-lens/` & `packages/spec-lens-contract/` (spec contracts, snapshot builders)
  - `packages/schemas/` (OpenAPI definitions and validation tooling)
- **Key findings**:
  - Proposal 1: `projectDiscriminatedUnion` helper in `@oa-sdk/openapi-projection-contract` + `zod-to-schema.ts`.
  - Proposal 2: Standardized `x-surface-*` extensions in `@oa-sdk/openapi-projection-contract` + `lint.ts` in `@oa-sdk/parser`.
  - Proposal 3: Standalone type guard plugin (`oa-gen generate --target standalone-guards`) in `@oa-sdk/codegen` via `ajv/dist/standalone` + add `"ajv": "^8.17.0"` dependency.
  - Proposal 4: V3 Unified Architecture `EntitySpec` + `TypeAdapter`s (`TsAstAdapter`, `ZodAdapter`, `TypiaAdapter`) with reverse-offset bottom-up `TextEdit` patching in `@oa-sdk/codegen`.
- **Unexplored areas**: None within the scope of this investigation.

## Key Decisions Made
- Authored comprehensive integration analysis at `/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/analysis.md`.
- Authored 5-component handoff report at `/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/handoff.md`.

## Artifact Index
- `/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/analysis.md` — Comprehensive integration analysis report
- `/Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_ast/handoff.md` — 5-component handoff report
