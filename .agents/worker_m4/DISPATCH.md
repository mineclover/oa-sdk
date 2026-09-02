## 2026-09-02T22:06:00Z
You are the implementation Worker for Milestone 4: Authoring Conventions Documentation & Schema Updates (R4).
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/worker_m4
Project root: /Users/junwoobang/workflow/oa-sdk
Authoritative user request: /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
Project plan: /Users/junwoobang/workflow/oa-sdk/PROJECT.md
Survey handoff: /Users/junwoobang/workflow/oa-sdk/.agents/explorer_survey_3_r2/handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Exclusive Write Ownership:
- /Users/junwoobang/workflow/browser-studio/docs/guides/schema-architecture-and-conventions.md
- /Users/junwoobang/workflow/oa-sdk/docs/guides/schema-architecture-and-conventions.md (mirrored documentation)

Task:
1. Read ORIGINAL_REQUEST.md, PROJECT.md, and .agents/explorer_survey_3_r2/handoff.md.
2. Update /Users/junwoobang/workflow/browser-studio/docs/guides/schema-architecture-and-conventions.md with normative specifications and complete runnable code examples for:
   - RFC 9457 `ProblemDetailsSchema` convention for error responses (422/500/conflict) with standard fields (type, title, status, detail, instance) and extension members (code, invalidParams, details), plus OpenAPI 3.1 operation response mappings.
   - Strict numeric bounds (`exclusiveMinimum: 0` vs `minimum: 0`) and Zod drafting patterns (`.nonnegative()` vs `.positive()`).
   - Self-referencing recursive schema registry conventions (`z.lazy` + registry refs and cycle-safe projection).
   - `x-surface-*` scope rules (object-level `targetProperty` vs inline property-level).
   - V3 Unified Architecture JSDoc annotation tag specifications (`@minimum`, `@format`, `@discriminator`, etc.) and bidirectional AST sync mapping.
3. Mirror the updated guide file to /Users/junwoobang/workflow/oa-sdk/docs/guides/schema-architecture-and-conventions.md.
4. Verify markdown formatting, code block syntax, and specification completeness.
5. Write your handoff report to /Users/junwoobang/workflow/oa-sdk/.agents/worker_m4/handoff.md and notify parent via send_message.
