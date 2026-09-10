## 2026-09-11T08:03:00Z
You are the E2E Test Suite Designer (Test Writer) for the OpenAPI 3.2 to Zod 4 generator project.
Your working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/e2e_test_writer
Your parent is: orchestrator_2 (ID: d1a29c40-f205-4940-b852-9c16208d555d).

MANDATORY INPUTS:
- Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md
- Read /Users/junwoobang/workflow/oa-sdk/.agents/PROJECT.md
- Read /Users/junwoobang/workflow/oa-sdk/.agents/survey_oas32_spec/handoff.md
- Read /Users/junwoobang/workflow/oa-sdk/.agents/survey_parser_fold/handoff.md
- Read /Users/junwoobang/workflow/oa-sdk/.agents/survey_codegen_cli/handoff.md

SCOPE & WRITE OWNERSHIP:
- You exclusively own:
  1. /Users/junwoobang/workflow/oa-sdk/.agents/TEST_INFRA.md
  2. /Users/junwoobang/workflow/oa-sdk/.agents/TEST_READY.md
  3. packages/codegen/test/e2e/zod4-generator.e2e.test.ts
  4. Any test fixtures needed under packages/codegen/test/fixtures/
- You must NOT modify any implementation code in packages/codegen/src/.

OBJECTIVE:
Design and implement a comprehensive 4-Tier E2E test suite for OpenAPI 3.2 to Zod 4 generator and CLI:
1. Methodology (4 tiers):
   - Tier 1 (Feature Coverage, >=5 tests per feature):
     - Numeric exclusive bounds (exclusiveMinimum / exclusiveMaximum) -> .gt() / .lt()
     - Tuples & Rest (prefixItems -> z.tuple([...]), rest via items)
     - Discriminator (§4.8.24) with propertyName, mapping, and OAS 3.2 defaultMapping -> z.discriminatedUnion()
     - Object sealing (unevaluatedProperties / additionalProperties: false -> .strict())
     - Circular references (#/components/schemas/* -> z.lazy(() => Schema))
     - JSDoc / Metadata (.describe(), .default())
     - Static code generation (generateZodFromSpec)
     - Dynamic runtime validation (z.fromJSONSchema / createRuntimeZodValidators)
     - CLI execution (oa-gen generate:zod --spec <path> --output <dir>)
   - Tier 2 (Boundary & Corner Cases):
     - Float bounds (0.001), negative bounds (-50), zero bounds (0)
     - Closed tuples (items: false) vs open tuples vs tuples with rest
     - Empty objects sealed with .strict()
     - Mutual cross-component recursion (A -> B -> A) and self-recursion (Node -> Node)
     - Complex nested discriminator hierarchies
   - Tier 3 (Cross-Feature Combinations):
     - Sealed object containing tuple with rest and exclusive numeric bounds
     - Recursive tree with discriminated union variants and metadata
     - Full approved OpenAPI 3.2 spec (packages/schemas/typespec/approved.openapi.yaml)
   - Tier 4 (Real-World Application Scenarios):
     - E-commerce order lifecycle schema
     - File system tree with recursive directory entries and typed file payloads
     - RFC 9457 ProblemDetails with discriminated union extensions

2. Deliverables:
   - Create /Users/junwoobang/workflow/oa-sdk/.agents/TEST_INFRA.md following the project pattern template.
   - Implement `packages/codegen/test/e2e/zod4-generator.e2e.test.ts`. Note: use dynamic imports or safe assertions so that tests can be loaded and executed via Vitest.
   - Create /Users/junwoobang/workflow/oa-sdk/.agents/TEST_READY.md summarizing test counts, runner command, and coverage checklist.
   - Run `pnpm --filter @oa-sdk/codegen exec vitest run test/e2e/zod4-generator.e2e.test.ts` to document baseline test runner behavior.
   - Write completion report to /Users/junwoobang/workflow/oa-sdk/.agents/e2e_test_writer/handoff.md and notify parent via send_message.
