# DISPATCH: m1_worker
Task: Implement Milestone M1: Documentation Deduplication & Consolidation across docs/guides/ and update all 9 inbound links.

## 2026-09-13T02:14:29Z
You are the Implementation Worker for Milestone M1 (Documentation Deduplication & Consolidation).
Your assigned working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/m1_worker
Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (specifically the latest request under `## 2026-09-13T02:03:17Z`), /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_12/PROJECT.md, and DISPATCH.md in your working directory.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Inputs & Specification Reports:
1. `/Users/junwoobang/workflow/oa-sdk/.agents/m1_spec_miner_onboarding/report.md`
2. `/Users/junwoobang/workflow/oa-sdk/.agents/m1_spec_miner_cli_config/report.md`
3. `/Users/junwoobang/workflow/oa-sdk/.agents/m1_spec_miner_schemas/report.md`

Exclusively Owned Files:
- `docs/guides/onboarding-playbook.md`
- `docs/guides/system-onboarding.md`
- `docs/guides/cli-setup.md`
- `docs/guides/quick-start.md`
- `docs/guides/declarative-spec-configuration.md`
- `docs/guides/basic-spec-usage.md`
- `docs/guides/schema-authoring.md`
- `docs/guides/schema-architecture-and-conventions.md`
- Inbound links to update: `README.md`, `docs/README.md`, `docs/guides/cli-command-reference.md`, `docs/internal/feature-test-matrix.json`, `docs/internal/feature-test-matrix.md`, `docs/internal/typespec-roundtrip/logical-erd-typespec-profile.plan.md`, `docs/spec-governance/decision-log.md`

Implementation Tasks:
1. Apply the Section 9 contributor onboarding migration to `docs/guides/onboarding-playbook.md`, replace `docs/guides/system-onboarding.md` with the redirection stub, and update all 9 inbound links as specified in `m1_spec_miner_onboarding/report.md`.
2. Apply the CLI setup overhaul in `docs/guides/cli-setup.md`, streamline `docs/guides/quick-start.md`, and expand `docs/guides/declarative-spec-configuration.md` as specified in `m1_spec_miner_cli_config/report.md`.
3. Apply the schema triad harmonization across `docs/guides/basic-spec-usage.md`, `docs/guides/schema-authoring.md` (stripping 38-line raw fragment tutorial), and `docs/guides/schema-architecture-and-conventions.md` as specified in `m1_spec_miner_schemas/report.md`.

Verification Requirements:
- Run `pnpm check:docs` and verify that ALL local markdown links, anchors, and CLI command references pass with 0 errors.
- Run `pnpm check:cli-spec` to verify CLI example alignment.
- Run `git diff --stat` to verify only the intended documentation and link files were modified.
- Document the verification commands and exact results in your `handoff.md`.
- Report completion via `send_message`.
