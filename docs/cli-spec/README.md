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

`docs/cli-spec/oa-sdk-artifact-compatibility-policy.v1.json` is the
machine-readable support and migration declaration for provenance, parallel
evidence, and governance-config artifacts. It is mirrored by
`packages/codegen/src/cli/lib/artifact-compatibility-policy.ts`.

`docs/cli-spec/oa-sdk.ref-projection.v1.schema.json` is the JSON Schema of the
`oa-sdk.ref-projection.v1` artifact that `oa-gen ref-projection` emits, for readers
outside TypeScript. It is mirrored by `REF_PROJECTION_ARTIFACT_SCHEMA_V1` in
`packages/codegen/src/cli/lib/ref-projection-artifact-schema.ts`, which is the
authoring source.

## Ownership

The typed TypeScript manifest is the authoring source for the governance-tracked
`oa-gen` command options and descriptions. Its JSON file in this directory is the
language-neutral mirror. Commands that are intentionally documented outside this
governance manifest, such as the general `generate`, `typegen`, and `lint`, are
listed in `undocumentedOaGenCommands` in `scripts/check-cli-spec.ts`. Change both
manifest files in the same patch and run the check below.

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
stdout contains that payload only. Commands with an explicit output path, or commands
that use a human-readable report, may print success and artifact-location messages to
stdout; consumers should read the named file when they need a machine-readable artifact.
