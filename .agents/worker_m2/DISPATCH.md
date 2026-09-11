# Dispatch: Milestone 2 - Zero-Build Instant Mock Server

## Mission
Implement Requirement R2 (Phase 3) in `@oa-sdk/mock-server` and `@oa-sdk/codegen`:
1. In `@oa-sdk/mock-server`:
   - `packages/mock-server/src/adapters/node-http.ts`:
     - Add `updateSpec(spec: OasDocument | Record<string, unknown>): { routesCount: number }` to `NodeMockServer`.
     - Extract `compileRoutingState(spec, context)` so internal routing state (`parsed`, `basePath`, `index`) can be atomically hot-swapped at runtime without restarting the underlying `node:http` server or dropping port binding / socket connections.
     - Add unit tests in `packages/mock-server` verifying that `updateSpec` dynamically updates routes on the running port without connection reset.
2. In `@oa-sdk/codegen`:
   - `packages/codegen/package.json`: Add `"@oa-sdk/mock-server": "workspace:*"` to `dependencies`.
   - `packages/codegen/src/cli/lib/typespec-mock-compiler.ts`:
     - Implement `compileTypeSpecInMemory(tspPath, options)` using `@typespec/compiler` (`compile(NodeHost, tspPath, { noEmit: true }, oldProgram)`) and `@typespec/openapi3` (`getOpenAPI3(program, { 'openapi-versions': ['3.2.0'] })`) producing in-memory OpenAPI 3.2 document with zero disk writes.
     - Implement `watchTypeSpec(sourceFiles, onChange, onError)` watching `.tsp` source files with debouncing (100ms) to trigger recompilation with `oldProgram` and hot route reload.
   - `packages/codegen/src/cli/commands/mock.ts`:
     - CLI command `oa-gen mock` accepting `--tsp <path>`, `--spec <path>`, `--port <port>` (default: 4010), `--host <host>` (default: 127.0.0.1), and `--watch`.
     - Handles graceful shutdown on `SIGINT` / `SIGTERM`.
   - `packages/codegen/src/cli/index.ts`:
     - Register `mock` command.
   - `packages/codegen/src/__tests__/mock.test.ts`:
     - Comprehensive tests verifying zero-build mock server startup, mock responses matching schema status codes, 422 request validation with redacted values, and dynamic hot-reloading via `updateSpec`.
3. Verification:
   - Run `pnpm --filter @oa-sdk/mock-server test`
   - Run `pnpm --filter @oa-sdk/codegen test`
   - Run `pnpm --filter @oa-sdk/codegen build`

## Exclusive File Ownership
- `packages/mock-server/src/adapters/node-http.ts`
- `packages/mock-server/test/` (or test files in mock-server)
- `packages/codegen/package.json`
- `packages/codegen/src/cli/commands/mock.ts`
- `packages/codegen/src/cli/lib/typespec-mock-compiler.ts`
- `packages/codegen/src/cli/index.ts` (registering mock command)
- `packages/codegen/src/__tests__/mock.test.ts`

## Mandatory Rules & Warnings
- MANDATORY INTEGRITY WARNING:
  DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
- Read `/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` before starting work.
- Consult the survey findings at `/Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md`.
- Run builds and tests for affected targets and report results in handoff.

## Output
Write report to `/Users/junwoobang/workflow/oa-sdk/.agents/worker_m2/handoff.md`.
Send a message to parent when complete.

## 2026-09-10T23:41:27Z
You are the Instant Mock Server Worker for Milestone 2.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m2
Read your instructions in /Users/junwoobang/workflow/oa-sdk/.agents/worker_m2/DISPATCH.md.
Also read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md, /Users/junwoobang/workflow/oa-sdk/PROJECT.md, and /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Implement R2 (Phase 3): Zero-Build Instant Mock Server:
1. Implement updateSpec in packages/mock-server/src/adapters/node-http.ts.
2. Implement in-memory zero-disk compilation and watcher in packages/codegen/src/cli/lib/typespec-mock-compiler.ts.
3. Implement oa-gen mock command in packages/codegen/src/cli/commands/mock.ts and register it.
4. Add comprehensive unit and integration tests in mock-server and codegen.
Run tests and build to verify.
Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m2/handoff.md.
Send a message to parent when complete.
