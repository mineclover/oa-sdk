# DISPATCH: m2_worker
Task: Implement Milestone M2: Modernization Across Guides & Agent Skills.

## 2026-09-13T02:30:42Z
You are the Implementation Worker for Milestone M2 (Platform Modernization Across Guides & Agent Skills).
Your assigned working directory is: /Users/junwoobang/workflow/oa-sdk/.agents/m2_worker
Read /Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md (specifically the latest request under `## 2026-09-13T02:03:17Z`), /Users/junwoobang/workflow/oa-sdk/.agents/orchestrator_12/PROJECT.md, and DISPATCH.md in your working directory.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Inputs & Specification Reports:
1. `/Users/junwoobang/workflow/oa-sdk/.agents/m2_spec_miner_guides/report.md`
2. `/Users/junwoobang/workflow/oa-sdk/.agents/m2_spec_miner_skills_core/report.md`
3. `/Users/junwoobang/workflow/oa-sdk/.agents/m2_spec_miner_skills_ecosystem/report.md`

Exclusively Owned Files:
- `docs/guides/onboarding-playbook.md`
- `docs/guides/cli-command-reference.md`
- `docs/guides/declarative-spec-configuration.md`
- `.agents/skills/oa-codegen/SKILL.md`
- `.agents/skills/oa-runtime/SKILL.md`
- `.agents/skills/oa-onboarding/SKILL.md`
- `.agents/skills/oa-sdk/SKILL.md`
- `.agents/skills/oa-schemas/SKILL.md`
- `.agents/skills/oa-governance/SKILL.md`
- `.agents/skills/oa-spec-lens/SKILL.md`

Implementation Tasks:
1. Apply the user guide updates to `onboarding-playbook.md`, `cli-command-reference.md`, and `declarative-spec-configuration.md` as specified in `m2_spec_miner_guides/report.md`.
2. Apply the core skill updates to `.agents/skills/oa-codegen/SKILL.md`, `.agents/skills/oa-runtime/SKILL.md`, and `.agents/skills/oa-onboarding/SKILL.md` as specified in `m2_spec_miner_skills_core/report.md`.
3. Apply the ecosystem skill updates to `.agents/skills/oa-sdk/SKILL.md`, `.agents/skills/oa-schemas/SKILL.md`, `.agents/skills/oa-governance/SKILL.md`, and `.agents/skills/oa-spec-lens/SKILL.md` as specified in `m2_spec_miner_skills_ecosystem/report.md`.

Verification Requirements:
- Run `pnpm check:docs` to verify zero broken links, valid anchors, and 100% CLI command reference alignment.
- Run `pnpm check:cli-spec` to verify CLI command manifest alignment.
- Run `pnpm check:release-policy` and `pnpm check:api-index`.
- Run `git diff --stat` to ensure only the specified guides and skills were modified.
- Document the verification commands and exact results in your `handoff.md`.
- Report completion via `send_message`.
