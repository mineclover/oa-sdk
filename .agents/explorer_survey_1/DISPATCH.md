## 2026-09-02T15:48:21Z

You are an Explorer agent investigating requirement R1 (Standalone Guards Splitting & Filtering) in @oa-sdk/codegen.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md

Task:
1. Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
2. Investigate packages/codegen (and any related packages in @oa-sdk):
   - Locate the existing standalone type guard generator (e.g. packages/codegen/src/generators/standalone-guards.ts or similar).
   - Trace how CLI arguments are parsed and routed for `oa-codegen generate --target standalone-guards`.
   - Analyze how type guards are generated from OpenAPI/JSON Schema (AST or template-based).
   - Investigate how `--split` and `--schemas <comma-separated>` should be designed and integrated into the generator and CLI.
   - Specifically examine how split output should be structured (individual .js and .d.ts files per schema component, e.g. guards/<TypeName>.js and guards/<TypeName>.d.ts, plus root index.js / index.d.ts re-export barrel).
   - Verify how imports/dependencies between split files should work if schemas reference each other ($ref).
   - Check how `--schemas` should filter components/guard names (e.g. by schema type name or guard function name like `isSurfaceBlock`).
   - Check existing tests for standalone-guards and codegen CLI.
3. Write a comprehensive survey report to /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_1/handoff.md following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method).
4. Send a message to parent when done with a summary and path to your handoff report.
