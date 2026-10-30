# External Document Interoperability and Autocomplete Metadata Plan

Status: **offline harness implemented; external-e2e deferred**

This plan defines the work that remains after the local table-file regressions. It does not
change the current TODO item or promote the `external-document-interop` verification claim.
The claim stays `unverified` until product-generated files and external execution evidence are
available.

The offline harness is implemented under
`test/integration/tools-document-interop/`: CSV and XLSX oracle adapters, product prerequisite
detection, an external-e2e boundary README, and a focused harness `tsconfig.json`. The optional
oracles are skipped when their harness-only packages are absent; the native invariant tests and
driver detection tests remain runnable in the default checkout.

Actual Office, LibreOffice, Google Sheets, and Notion fixtures plus product execution remain in
the existing TODO and are intentionally deferred. This plan does not promote the external
interop claim or alter the verification registry.

## Decision boundary

`@oa-sdk/tools` remains the owner of the canonical `UnifiedTableIR`, deterministic patch plans,
and built-in file adapters. Its production path continues to use Node's `node:fs`, `node:path`,
and `node:zlib`; Office, Google, Notion, and third-party parser libraries do not become runtime
dependencies of the package.

External products are verification oracles. Their files are evidence fixtures, not new schema
sources. The interop harness must exercise `read → patch → write → reopen` and compare the
result against explicit invariants before any support claim or autocomplete metadata is updated.

## Ownership and target files

| Responsibility | Owner | Files and scope | Update rule |
|---|---|---|---|
| Canonical table behavior | tools core owner | `packages/tools/src/table-ir.ts`, local table regression tests | Preserve IR, fingerprint, and patch semantics. |
| Native file I/O | tools I/O owner | `packages/tools/src/table-file-io.ts` | Keep the zero-dependency Node reader/writer; change it only for a reproduced codec defect. |
| Public exports | tools API owner | `packages/tools/src/index.ts`, `packages/tools/package.json`, generated `packages/tools/dist/index.d.ts` | Update only when the supported public surface changes; never edit `dist/` by hand. |
| Package autocomplete/API description | documentation owner | `packages/tools/README.md`, `docs/guides/library-entrypoints.md`, `docs/guides/feature-map.md` | Align supported formats, metadata guarantees, non-goals, and examples with verified scope. |
| API symbol index | API-index owner | `docs/internal/api-index.md`, `scripts/check-api-index.ts`, `scripts/lib/api-index.ts` | Update the index for public export changes; the check remains the authority for symbol parity. |
| Test ownership and capability map | test-matrix owner | `docs/internal/feature-test-matrix.json`, `.md`, and regression tests | Add interop paths and capability descriptions only when the corresponding tests exist. |
| Verification evidence | verification owner | `docs/internal/verification/registry.json`, generated `status.md`, `docs/reports/tools-document-interop-*.json` | Keep `external-document-interop` unverified until product/version evidence is captured. |
| Dependency and declaration governance | release/type-registry owner | `test/integration/tools-document-interop/package.json`, its `pnpm-lock.yaml`, `docs/internal/type-registry-baseline.json`, `docs/internal/release-policy.json` when applicable | Update harness locks with oracle changes; update root type/release records only when a public declaration or workspace boundary changes. |

The implementation harness belongs under `test/integration/tools-document-interop/`:
`csv-oracle.ts`, `xlsx-oracle.ts`, `product-drivers.ts`, their focused tests,
`fixtures/manifest.example.json`, the harness `package.json`, and the harness `tsconfig.json`.
It must not be exported from `@oa-sdk/tools`.
Product credentials, installed binaries, and browser sessions are optional gates for the
external-e2e lane and are never required by default package tests.

## Fixed library and oracle roles

| Role | Library or executable | Scope | Boundary |
|---|---|---|---|
| Production codec | Node built-ins: `node:fs`, `node:path`, `node:zlib` | Canonical ZIP/XML and CSV implementation in `@oa-sdk/tools` | No third-party document library in the runtime package. |
| Independent XLSX oracle | `exceljs@4.4.0` | Test-only semantic fixture generation and worksheet/value comparison | Do not replace the native writer; raw OOXML relationship, merge, validation, and style checks remain direct XML assertions. |
| Independent CSV oracle | `csv-parse@7.0.3` and `csv-stringify@6.9.0` | Test-only RFC 4180 multiline, escaped-quote, encoding, and roundtrip comparison | Harness-only dev dependencies; production parsing stays native. |
| Office/LibreOffice oracle | Installed `soffice`/LibreOffice CLI and Office-generated fixtures | Product conversion and reopen checks for XLSX/CSV | Missing binaries skip the external lane and never produce a false pass. |
| Google Sheets adapter | Official `googleapis` client in the integration harness | Authenticated export/download and optional re-import fixture capture | Credentials and network access are external-e2e prerequisites; no package runtime dependency. |
| Notion adapter | Official `@notionhq/client` in the integration harness | Database/table export or API fixture capture | Keep API credentials and product semantics outside the core table codec. |
| Browser product workflow | Existing Playwright harness, only where needed | UI export/import flows unavailable through an API or file export | Opt-in external-e2e only; not part of the default tools lane. |

If an oracle must enter production or add a new package subpath, stop and promote that decision
to an architecture ADR before changing `packages/tools/package.json`.

## Implementation phases

1. **Contract matrix** — collect product-generated XLSX/CSV fixtures and record product,
   version, locale, encoding, sheet names, relationships, formulas, merges, validations,
   styles, and line-ending conventions.
2. **Offline differential harness** — compare the native codec with the XLSX and CSV oracles;
   assert values, formulas, relationships, merge ranges, validation rules, styles, encodings,
   and multiline fields after reopen.
3. **Office/LibreOffice lane** — run the same matrix through installed `soffice` and Office
   fixtures. Keep the lane versioned and separate from local fixture results.
4. **Google/Notion lane** — capture export or API fixtures with official clients, then run the
   same read/patch/write/reopen contract. Use Playwright only where the UI is the only export path.
5. **Metadata promotion** — after evidence passes, update README, library entrypoints, feature
   map, API index, feature-test matrix, package declarations, and type-registry/release records
   as applicable. Record external-e2e evidence and only then promote the registry claim.

## Completion gates

- Each supported product/version fixture completes read → patch → write → reopen.
- XLSX relationship targets, `mergeCells`, `dataValidations`, formulas, styles, and selected
  worksheet identity remain correct; CSV multiline fields, escaped quotes, encoding, and line
  endings remain correct.
- Public exports and generated declarations match `api-index.md`; package entrypoint and
  feature-test metadata describe the same verified scope.
- `pnpm check:docs`, `pnpm check:api-index`, `pnpm check:feature-tests`, relevant type checks,
  and external-e2e evidence validation pass.
- `external-document-interop` is promoted from `unverified` only with product/version evidence.

## Non-goals

- Replacing the deterministic native codec with ExcelJS or a CSV library.
- Requiring Office, LibreOffice, Google, Notion, credentials, or a browser in default CI.
- Claiming product compatibility from self-generated fixtures.
- Editing the existing TODO or verification status before external evidence exists.
