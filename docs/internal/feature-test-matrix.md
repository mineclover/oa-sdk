# Feature Test Matrix

> Machine-readable source: [`feature-test-matrix.json`](./feature-test-matrix.json)

This matrix maps oa-sdk features to the automated tests and commands that protect them. Use it when adding features, moving tests, or changing package responsibilities.

## Maintenance Rules

- Add a feature entry when a new user-visible capability is introduced.
- Add at least one `testPaths` entry for every feature. A path may be a concrete file or a glob.
- Prefer focused test paths over only package-wide commands.
- Keep `commands` runnable from the repository root.
- Run `pnpm check:feature-tests` after moving or renaming tests.

## Feature Groups

| Feature ID | Package | Coverage Focus |
|---|---|---|
| `core-utilities` | `@oa-sdk/core` | shared helper behavior |
| `oas32-parser-ir` | `@oa-sdk/parser` | parsing, lint, validation, query APIs |
| `refs-source-schema-algebra` | `@oa-sdk/parser` | `$ref`, deref, source locations, schema folding |
| `openapi-projection-contract` | `@oa-sdk/openapi-projection-contract` | projection profiles, extensions, validation |
| `definition-builder` | `@oa-sdk/parser`, `@oa-sdk/codegen` | definition registry, target selection, emit, workspace index |
| `schema-authoring-workflow` | `@oa-sdk/schemas` | merge, fixture, upgrade, downgrade scripts |
| `zod-drizzle-to-oas` | `@oa-sdk/codegen` | Zod and Drizzle schema generation |
| `typegen` | `@oa-sdk/codegen` | TypeScript type generation |
| `cli-codegen-workflow` | `@oa-sdk/codegen` | `oa-gen` command behavior |
| `router-generation` | `@oa-sdk/router` | Hono/Express router stubs |
| `client-generation` | `@oa-sdk/client` | fetch client and streaming client generation |
| `mock-server` | `@oa-sdk/mock-server` | MSW/Node mock server, validation, callbacks, XML, streaming |
| `typia-mock` | `@oa-sdk/typia-mock` | typia function validation server |
| `playground-pipeline` | `playground` | cross-package E2E workflows |
| `governance-docs` | root | docs and test-matrix drift guards |

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
