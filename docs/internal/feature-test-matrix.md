# Feature Test Matrix

> Machine-readable source: [`feature-test-matrix.json`](./feature-test-matrix.json)

This matrix maps oa-sdk features to the automated tests and commands that protect them. Use it when adding features, moving tests, or changing package responsibilities.

## Maintenance Rules

- Add a feature entry when a new user-visible capability is introduced.
- Add at least one `testPaths` entry for every feature. A path may be a concrete file or a glob.
- Prefer focused test paths over only package-wide commands.
- Keep `commands` runnable from the repository root.
- Run `pnpm check:feature-tests` after moving or renaming tests.

## Assertion Depth Policy

`pnpm check:feature-tests` is a drift guard, not a semantic test runner. It
proves that every feature has owned test paths and commands, then package tests
prove the actual behavior. When a feature's matrix row uses broad globs, the
`Representative Tests` column must name concrete files that contain the core
assertions for that feature.

For deeper assertion audits, review one or two representative tests per feature
before adding new rows. If the representative tests only instantiate code
without checking behavior, add focused assertions or split the matrix row.

## Feature Groups

| Feature ID | Package | Coverage Focus | Representative Tests |
|---|---|---|---|
| `core-utilities` | `@oa-sdk/core` | shared helper behavior | `packages/core/src/__tests__/*.test.ts` |
| `oas32-parser-ir` | `@oa-sdk/parser` | parsing, lint, validation, query APIs | `packages/parser/src/__tests__/parse-document.test.ts`, `validate.test.ts`, `query.test.ts` |
| `refs-source-schema-algebra` | `@oa-sdk/parser` | `$ref`, deref, source locations, schema folding | `packages/parser/src/__tests__/ref-graph.test.ts`, `source-location.test.ts`, `fold.test.ts` |
| `openapi-projection-contract` | `@oa-sdk/openapi-projection-contract` | projection profiles, extensions, validation | `packages/openapi-projection-contract/src/validation.test.ts`, `projection-extensions.test.ts` |
| `definition-builder` | `@oa-sdk/parser`, `@oa-sdk/codegen` | definition registry, target selection, emit, composition/provenance reports, workspace index | `packages/parser/src/__tests__/definition-*.test.ts`, `packages/codegen/src/__tests__/builder-*.test.ts` |
| `schema-authoring-workflow` | `@oa-sdk/schemas` | merge, fixture, upgrade, downgrade scripts | `packages/schemas/scripts/__tests__/merge.test.ts`, `upgrade.test.ts`, `downgrade.test.ts` |
| `zod-drizzle-to-oas` | `@oa-sdk/codegen` | Zod and Drizzle schema generation | `packages/codegen/src/__tests__/zod-to-schema.test.ts`, `packages/codegen/src/__tests__/drizzle/*.test.ts` |
| `source-adapter-boundaries` | `@oa-sdk/codegen` | normalized source fragments for Zod, Drizzle, Projection envelopes, Python snapshots, and file-backed inputs | `packages/codegen/src/__tests__/codegen-source-adapters.test.ts`, `source-file-adapters.test.ts`, `openapi-source-fragments.test.ts` |
| `typegen` | `@oa-sdk/codegen` | TypeScript type generation | `packages/codegen/src/__tests__/typegen/*.test.ts`, `mock-typegen-compat.test.ts` |
| `cli-codegen-workflow` | `@oa-sdk/codegen` | `oa-gen` command behavior, including build-spec sidecars, inventory, runtime URL drift, provenance, review reports, and review bundles | `packages/codegen/src/__tests__/cli*.test.ts`, `cli-scenarios.test.ts` |
| `runtime-openapi-url-drift` | `@oa-sdk/codegen` | runtime OpenAPI URL fetch for drift checks | `packages/codegen/src/__tests__/cli-scenarios.test.ts`, `runtime-openapi-fetch.test.ts` |
| `openapi-provenance` | `@oa-sdk/codegen` | output pointer provenance maps and review provenance diffs | `packages/codegen/src/__tests__/cli-build-spec.test.ts`, `cli-scenarios.test.ts` |
| `openapi-inventory` | `@oa-sdk/codegen` | OpenAPI surface inventory reports | `packages/codegen/src/__tests__/openapi-inventory.test.ts`, `cli-scenarios.test.ts` |
| `router-generation` | `@oa-sdk/router` | Hono/Express router stubs | `packages/router/src/__tests__/generate-router.test.ts`, `router-edge-cases.test.ts` |
| `client-generation` | `@oa-sdk/client` | fetch client and streaming client generation | `packages/client/src/__tests__/generate-client.test.ts`, `sse-client.test.ts` |
| `mock-server` | `@oa-sdk/mock-server` | MSW/Node mock server, validation, callbacks, XML, streaming | `packages/mock-server/src/__tests__/unit/*.test.ts`, `integration/*.test.ts`, `oas32/*.test.ts` |
| `typia-mock` | `@oa-sdk/typia-mock` | typia function validation server | `packages/typia-mock/src/__tests__/unit/*.test.ts`, `integration/server.test.ts` |
| `playground-pipeline` | `playground` | cross-package E2E workflows | `apps/playground/tests/e2e-pipeline.test.ts`, `codegen-pipeline.test.ts` |
| `python-contract-governance-template` | `templates/python-interface-monorepo` | Python contract governance toolkit | `packages/interface-contracts/tests/*.py`, `packages/interface-cli/tests/test_cli.py` |
| `governance-docs` | root | docs, CLI spec, and test-matrix drift guards | `scripts/check-api-index.ts`, `scripts/check-cli-spec.ts`, `scripts/check-feature-test-matrix.ts`, `docs/internal/feature-test-matrix.md` |

## Check

```bash
pnpm check:feature-tests
```

The check fails when:

- feature IDs are duplicated or malformed
- required fields are missing
- a listed concrete path does not exist
- a listed glob matches no files
- a feature has no test path or no command
