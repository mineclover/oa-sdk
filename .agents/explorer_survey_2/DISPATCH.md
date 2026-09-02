## 2026-09-02T15:48:23Z
You are an Explorer agent investigating requirements R2 (CLI Category-Aware Linting & Profile-Aware Validation) and R3 (Automated Manifest V3 CSP Audit Command) in @oa-sdk.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md

Task:
1. Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md.
2. Investigate packages/codegen CLI commands and @oa-sdk/openapi-projection-contract (and any lint/validation packages):
   - Locate `oa-codegen lint` and `oa-codegen validate` implementations and CLI definitions.
   - Investigate rule categories in linting (e.g. surface, structure, operations) and how `--categories <list>` should be wired up to filter rule execution.
   - Investigate profile-aware validation: check `@oa-sdk/openapi-projection-contract`, what profiles exist (`component-bundle`, `operation-contract`, `full-api-document`), what projection invariants/validators are provided, and how `--profile <name>` should validate OpenAPI specs. Specifically, check the acceptance criterion: `oa-codegen validate --spec <spec> --profile operation-contract` fails if `paths` has no operations and passes when valid.
   - Investigate `oa-codegen audit:csp` requirement:
     - CLI command `oa-codegen audit:csp --bundle <dir>` scanning bundled JS files for Content Security Policy violations.
     - Forbidden patterns: `eval(`, `new Function(`, `setTimeout(string)`, `setInterval(string)`.
     - Forbidden runtime heavy schema engines: `ajv`, `zod`, `@oa-sdk` imports/requires/mentions in production extension bundles.
     - CLI diagnostics emission and exit code 1 upon violation.
   - Examine existing CLI test suites, bin/cli entrypoints, commander / yargs / cac setup.
3. Write a comprehensive survey report to /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_2/handoff.md following the Handoff Protocol (Observation, Logic Chain, Caveats, Conclusion, Verification Method).
4. Send a message to parent when done with a summary and path to your handoff report.
