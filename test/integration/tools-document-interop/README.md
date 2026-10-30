# Document interop external-e2e harness

This directory owns product-specific prerequisites and fixtures for the external document
interop claim. It is deliberately separate from `@oa-sdk/tools` runtime code and default tests.

Install the offline oracle dependencies only for this harness:

```bash
pnpm --dir test/integration/tools-document-interop install --frozen-lockfile
pnpm --dir test/integration/tools-document-interop typecheck
pnpm --dir test/integration/tools-document-interop test
```

Without that opt-in install, the native invariant tests still run and the optional oracle tests
report an explicit skip.

## Driver detection

`product-drivers.ts` only detects local prerequisites. It does not make a network request, open a
browser, invoke Office, or read a credential secret. Use `detectExternalInteropDrivers()` to
produce a `tools-document-interop/drivers/v1` manifest and `assertExternalInteropDriversAvailable()`
when a product-specific lane requires a capability.

| Driver | Local prerequisite | Credential/network gate |
|---|---|---|
| `soffice` | `soffice` or `libreoffice` on `PATH`, or `SOFFICE_BIN` | None; product conversion remains an external-e2e operation |
| `google-sheets` | `googleapis` installed in the harness | One of `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_OAUTH_ACCESS_TOKEN`, or `GOOGLE_SHEETS_INTEROP_TOKEN` plus network access |
| `notion` | `@notionhq/client` installed in the harness | `NOTION_TOKEN` and `NOTION_DATABASE_ID` plus network access |
| `playwright` | `playwright-core` installed in the harness | Browser binary, product session, and network access |

Credential environment variables are presence markers only. The detector never prints their
values or reads token contents. A driver marked `available` means that local prerequisites and
markers exist; it does not prove that a product request will succeed.

## External-e2e boundary

The harness must run the same contract for every product fixture:

1. capture a product-generated XLSX or CSV fixture and record product/version/locale metadata;
2. read it with the native `@oa-sdk/tools` adapter;
3. apply a deterministic patch;
4. write the result to a new artifact;
5. reopen it with the product or its official export/import path;
6. assert values, formulas, worksheet relationships, merges, validations, styles, encoding, and
   multiline/escaped CSV fields;
7. write an immutable evidence report before changing the public support or autocomplete scope.

The default CI lane must not require Office, Google, Notion, credentials, or browser binaries.
Missing prerequisites are a skipped external lane, never a product compatibility pass.
