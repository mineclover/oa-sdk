# TypeSpec Sidecar-to-Extension Migration

Status: implementation-backed workflow, dated 2026-06-22.

This workflow supports G6 of the TypeSpec-first roadmap. It reduces the manual work needed before the full canonical authored fixture by converting supported `oa-sdk.typespec-compat-sidecar.v1` entries into TypeSpec `@extension(...)` snippets.

The tool does not edit `.tsp` files in place. It writes:

- TypeSpec snippets for supported OA SDK extension metadata.
- A residual compatibility sidecar for entries that must remain sidecar-owned.
- A machine-readable report explaining every converted or remaining entry.

## Command

```bash
pnpm typespec:sidecar-to-extensions -- \
  --sidecar artifacts/oa-sdk.typespec-compat-sidecar.json \
  --output artifacts/oa-sdk.typespec-extension-snippets.tsp \
  --remaining-sidecar artifacts/oa-sdk.typespec-compat-sidecar.remaining.json \
  --report artifacts/oa-sdk.typespec-sidecar-to-extensions-report.json
```

Use `--extension-schema-version oa-sdk.typespec-extensions.v1` only when the authored bundle must stay on v1. The default is `oa-sdk.typespec-extensions.v2`, because request body media examples are accepted only in v2.

## Supported Conversions

| Sidecar kind | TypeSpec target | Extension metadata |
|---|---|---|
| `parameter-examples` with `target.method` | Matching operation decorator | `x-oa-sdk-operation-examples.parameters` |
| `request-media-examples` | Matching operation decorator | `x-oa-sdk-operation-examples.requestBody`, v2 only |
| `response-media-examples` | Matching operation decorator | `x-oa-sdk-operation-examples.responses` |
| `security-scheme` | Namespace or service declaration decorator | `x-oa-sdk-security-schemes` |

Unsupported entries remain in the residual sidecar with a reason. Current known residual cases include:

- Path-level parameter examples without explicit operation placement.
- Request body media examples when targeting `oa-sdk.typespec-extensions.v1`.
- Values that cannot be rendered as TypeSpec value literals.

The tool must not convert unsupported metadata into comments or unchecked extension payloads.

Current canonical evidence: applying the workflow to a generated canonical roundtrip sidecar with `oa-sdk.typespec-extensions.v2` converts 99/102 entries and leaves 3 path-level parameter example entries in the residual sidecar.

## Migration Loop

1. Export or collect the candidate compatibility sidecar.
2. Run `pnpm typespec:sidecar-to-extensions` and inspect the report.
3. Paste each operation snippet directly above the matching TypeSpec operation.
4. Paste the security scheme snippet above the namespace or service declaration.
5. Keep the residual sidecar only for entries that the report leaves sidecar-owned.
6. Set the bundle manifest to the narrowest extension schema version that covers the pasted snippets.
7. Run `pnpm typespec:bundle-check -- --manifest <bundle>/oa-sdk.typespec-bundle.json --fail-on-breaking`.

For sidecar-less authored bundles, step 5 must produce an empty residual sidecar before the sidecar file can be removed from the bundle manifest.
