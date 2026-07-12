# CLI Spec

`docs/cli-spec` stores the language-neutral CLI governance manifests used to
keep TS/JS and Python commands aligned.

Core terminology is defined in
[CLI Governance](../concepts/cli-governance.md#cli-governance-manifest).

`docs/cli-spec/oa-gen.governance.json` is mirrored by the typed TS manifest in
`packages/codegen/src/cli/spec/oa-gen-governance.ts`.

`docs/cli-spec/oa-contract.governance.json` is mirrored by the Python template
manifest in
`templates/python-interface-monorepo/packages/interface-cli/src/oa_interface_cli/cli_spec.json`.

## Ownership

The typed TypeScript manifest is the authoring source for `oa-gen` command
options and descriptions. Its JSON file in this directory is the
language-neutral mirror. Change both in the same patch and run the check below.

Operational guidance belongs in `docs/guides/`, rather than in a manifest
description. For the duplicate-review command, use
[Duplicate Review](../guides/duplicate-review.md) as the policy and workflow
guide.

`pnpm check:docs` validates local Markdown links and fenced `oa-gen` command
names/options against the live command registry.

Run:

```bash
pnpm check:cli-spec
```

when adding or changing governance CLI commands.

## Output contract

When a command emits a serialized artifact or machine-readable report to stdout,
stdout contains that payload only. Progress, success paths, warnings, and other
operational messages go to stderr so callers can safely pipe or redirect stdout.
Commands with an explicit output path may still print their artifact location as
an operational message.
