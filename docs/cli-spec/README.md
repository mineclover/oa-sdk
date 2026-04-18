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

Run:

```bash
pnpm check:cli-spec
```

when adding or changing governance CLI commands.
