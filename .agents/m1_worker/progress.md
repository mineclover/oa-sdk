# Progress — Milestone M1: Documentation Deduplication & Consolidation

Last visited: 2026-09-13T02:20:45Z

## Status
- [x] Initialized BRIEFING.md and DISPATCH.md
- [x] Read input reports from m1_spec_miner_onboarding, m1_spec_miner_cli_config, and m1_spec_miner_schemas
- [x] Task 1: Onboarding Consolidation & Link Retargeting
  - [x] Update `docs/guides/onboarding-playbook.md` (append §9 and update line 938 reference)
  - [x] Replace `docs/guides/system-onboarding.md` with canonical redirection notice
  - [x] Retarget 8 external inbound link files (`README.md`, `docs/README.md`, `docs/guides/cli-command-reference.md`, `docs/internal/feature-test-matrix.json`, `docs/internal/feature-test-matrix.md`, `docs/internal/typespec-roundtrip/logical-erd-typespec-profile.plan.md`, `docs/spec-governance/decision-log.md`)
- [x] Task 2: CLI Setup & Config SSOT
  - [x] Replace `docs/guides/cli-setup.md` with downstream installation SSOT
  - [x] Streamline `docs/guides/quick-start.md`
  - [x] Replace `docs/guides/declarative-spec-configuration.md` with full dual-layer & outputRouting SSOT
- [x] Task 3: Schema Triad Harmonization
  - [x] Update `docs/guides/basic-spec-usage.md` (navigation banner, downstream consumption matrix, CLI updates)
  - [x] Update `docs/guides/schema-authoring.md` (navigation banner, strip 38-line fragment tutorial, add OAS 3.2 defaultMapping, circular ref model)
  - [x] Update `docs/guides/schema-architecture-and-conventions.md` (navigation banner, dual-world scope, config SSOT link)
- [x] Verification & Governance Gates
  - [x] Run `pnpm check:docs` -> PASS (0 errors across 236 markdown files + 24 OAS reference files)
  - [x] Run `pnpm check:cli-spec` -> PASS (0 drift across 2 manifests, 29 commands)
  - [x] Run `pnpm check:feature-tests` -> PASS (50 features, 309 test path patterns)
  - [x] Run `pnpm check:api-index` -> PASS (0 drift)
  - [x] Run `pnpm check:spec-governance` -> PASS (loader schema and paths valid)
  - [x] Run `git diff --check` -> PASS (0 trailing whitespace or formatting warnings)
  - [x] Run `git diff --stat` -> PASS (only exclusively owned and inbound link files modified)
  - [ ] Write `handoff.md`
  - [ ] Send completion message via `send_message`
