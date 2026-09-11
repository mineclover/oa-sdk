# BRIEFING — 2026-09-11T08:21:16+09:00

## Mission
Investigate the codebase for R2 (Phase 3): Zero-Build Instant Mock Server (`oa-gen mock --tsp <path>` and `--watch`, in-memory TypeSpec compilation via `@typespec/compiler`, `@oa-sdk/mock-server` integration, hot reload/file watching without restart).

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2
- Original parent: c8e6c449-4228-4443-bc32-e90615c118a5
- Milestone: survey
- Sub-Identity (2026-09-10T23:21:16Z): Instant Mock Server Explorer
- Current parent: c665389a-7f3c-4d31-a717-f16983c4bb03
- Milestone: Phase 3 Instant Mock Server Survey

## 🔒 Key Constraints
- Read-only investigation — do NOT implement
- Produce 5-component handoff report (Observation, Logic Chain, Caveats, Conclusion, Verification Method)
- Closed-by-default agent skill governance
- Zero-build instant mock: compile TypeSpec directly in-memory without writing intermediate OpenAPI YAML artifacts to disk
- Hot reload without dropping port binding or restarting process

## Current Parent
- Conversation ID: c665389a-7f3c-4d31-a717-f16983c4bb03
- Updated: 2026-09-10T23:21:16Z

## Investigation State
- **Explored paths**:
  - `packages/mock-server/src/adapters/node-http.ts`: `createNodeMockServer`, port 4010 default, `parseDocument`, `matchRoute`, `handleRequest`, `pickResponse`, error redaction.
  - `packages/mock-server/src/cli/main.ts`: standalone `oa-mock` CLI with `--spec` and `--port`.
  - `packages/codegen/src/cli/commands.ts`: CLI registry (27 commands, `mock` not yet present).
  - `packages/codegen/src/cli/lib/run.ts` & `types.ts`: `Command`, `OptionDef`, `runCommand`, `GLOBAL_OPTIONS`.
  - `@typespec/compiler` & `@typespec/openapi3`: tested in-memory compilation with `compile(NodeHost, tspPath, { noEmit: true }, oldProgram)` and `getOpenAPI3(program, { 'openapi-versions': ['3.2.0'] })`. Confirmed zero disk I/O, ~800ms initial, ~360ms incremental.
  - Hot reload: verified atomic routing state swap (`state = nextState`) in `createNodeMockServer` without dropping port binding or restarting HTTP server.
  - Governance & Documentation gates: `scripts/check-cli-spec.ts` (`undocumentedOaGenCommands`) and `scripts/check-docs.ts` (`docs/guides/cli-command-reference.md`).
- **Key findings**:
  - In-memory TypeSpec to OpenAPI 3.2 conversion is 100% native via `@typespec/compiler` + `@typespec/openapi3` (both already dependencies of `@oa-sdk/codegen`).
  - Adding `updateSpec(spec)` to `NodeMockServer` in `packages/mock-server/src/adapters/node-http.ts` enables zero-restart hot reload on port 4010.
  - `oa-gen mock --tsp <path> [--watch] [--port <port>]` command cleanly integrates into `packages/codegen/src/cli/commands/mock.ts`.
- **Unexplored areas**: None. Full solution verified via executable Node prototypes.

## Key Decisions Made
- Confirmed `@typespec/compiler`'s `compile(NodeHost, path, { noEmit: true }, oldProgram)` + `getOpenAPI3(program, { 'openapi-versions': ['3.2.0'] })` produces valid OAS 3.2 in-memory objects directly.
- Confirmed `NodeMockServer` in `packages/mock-server/src/adapters/node-http.ts` should expose `updateSpec(spec): { routesCount: number }`.
- Designed `packages/codegen/src/cli/lib/typespec-mock-compiler.ts` to isolate TypeSpec compilation and watch utilities, keeping `packages/mock-server` lightweight.
- Confirmed watch strategy: extract active non-node_modules source files from `program.sourceFiles`, watch directories using `fs.watch(dir, { recursive: true })` with 100ms debounce, and apply atomic `server.updateSpec()`.

## Artifact Index
- /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md — Final investigation handoff report
