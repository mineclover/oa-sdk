# Dispatch — Challenger 2 (Empirical Link Crawl & CLI Parser Fuzzing)

## Mandatory Context
Read the authoritative user request at:
`/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md` (specifically ## 2026-09-05T06:38:42Z).

Read the Project Plan at:
`/Users/junwoobang/workflow/oa-sdk/.agents/teamwork_preview_orchestrator_docs_1/PROJECT.md`

## Your Working Directory
`/Users/junwoobang/workflow/oa-sdk/.agents/challenger_2`

## Adversarial Challenge Scope
Empirically verify link resolution and CLI option alignment across the monorepo documentation.

## Challenge Tasks
1. Crawl all markdown links across `docs/`:
   - Check every relative link (`../...`, `./...`).
   - Check every markdown anchor (`#...`) to confirm it matches a valid heading slug in the target document.
   - Verify that there are 0 broken file links and 0 broken anchor links across the entire repository.
2. CLI Command & Option Alignment:
   - Run `pnpm exec tsx scripts/check-cli-spec.ts`.
   - Fuzz or cross-reference all 25 CLI commands, arguments, and options documented in `docs/guides/cli-command-reference.md` against `packages/codegen/src/cli/commands/` and `oa-gen.governance.json`.
   - Ensure every documented command line syntax works identically to the CLI binary.
3. Verdict: Explicitly state `APPROVE` (100% link resolution and CLI match) or `REJECT` (broken links or discrepancies found).

## Output Requirements
Write your detailed challenge report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/challenger_2/challenge.md`
and write your structured handoff report to:
`/Users/junwoobang/workflow/oa-sdk/.agents/challenger_2/handoff.md`.
Send a completion message back to parent with your verdict and summary.

## 2026-09-05T06:56:48Z
You are challenger_2.
Read the authoritative user request at:
/Users/junwoobang/workflow/oa-sdk/.agents/ORIGINAL_REQUEST.md

Read your dispatch instructions at:
/Users/junwoobang/workflow/oa-sdk/.agents/challenger_2/DISPATCH.md

Read the project plan at:
/Users/junwoobang/workflow/oa-sdk/.agents/teamwork_preview_orchestrator_docs_1/PROJECT.md

Your working directory is:
/Users/junwoobang/workflow/oa-sdk/.agents/challenger_2

Adversarially crawl and verify all markdown links and anchors across docs/. Verify that 0 broken links or anchors exist.
Verify CLI command parsing and option syntax against scripts/check-cli-spec.ts and CLI binary commands.
Write challenge report to /Users/junwoobang/workflow/oa-sdk/.agents/challenger_2/challenge.md and handoff to /Users/junwoobang/workflow/oa-sdk/.agents/challenger_2/handoff.md.
State explicit verdict: APPROVE or REJECT.
Send completion message to parent.
