# @oa-sdk/codegen

`@oa-sdk/codegen` provides the `oa-gen` CLI for OpenAPI collection, review, validation,
TypeScript generation, and external-service governance scaffolding.

## Install

The package is published to the public npm registry. Install it as a development dependency:

```bash
pnpm add -D @oa-sdk/codegen
pnpm exec oa-gen --help
```

The published package includes its runtime dependencies (`@oa-sdk/core`,
`@oa-sdk/parser`, `@oa-sdk/openapi-projection-contract`, and
`@oa-sdk/typespec-decorators`). It requires Node.js 22 or later.

This distribution boundary covers the core OA Gen CLI: collection, normalization, review,
validation, type generation, provenance/evidence, and governance scaffolding.

### Companion packages

Router, client, and mock outputs come from companion packages that `oa-gen` loads on demand. They
are not dependencies of `@oa-sdk/codegen` (the release policy keeps Downstream Integration packages
out of a Core Platform package's published manifest), so installing codegen does not install them.
Add the ones you use:

| Package | Needed for |
| --- | --- |
| `@oa-sdk/router` | handler contracts and CRDT contract/router modules from `oa-gen generate` |
| `@oa-sdk/client` | `oa-gen generate:client`, `pack:client`, `generate:tanstack`, and the client SDK, TanStack Query options, and CRDT client/hook modules from `oa-gen generate` |
| `@oa-sdk/mock-server` | `oa-gen mock` |

```bash
pnpm add -D @oa-sdk/router @oa-sdk/client @oa-sdk/mock-server
```

The companions are versioned independently of codegen. Each codegen release supports the companion
releases compatible (`^`) with the versions it was built and tested against, and every install
command `oa-gen` prints pins the packages to that range, for example
`pnpm add -D "@oa-sdk/router@^<version>"`. The unpinned command above installs the latest releases
instead.

`oa-gen init` lists the companions its scaffold uses in `devDependencies`: the generated
`oa.config.ts` turns handler contracts and the client SDK on (`core.contracts.pureHandlers: true`,
`core.client.enabled: true`), and the generated `mock` script runs `oa-gen mock`.

The specifier `oa-gen init` writes for each `@oa-sdk` package, `@oa-sdk/codegen` included, follows
where the project installs it from:

- `workspace:*` when the project is a member of a pnpm workspace (`pnpm-workspace.yaml`) that also
  has the package as a member, such as an app inside the oa-sdk repository.
- Otherwise the range compatible with the release this codegen was built and tested against
  (`^<version>`). npm rejects the `workspace:` protocol (`EUNSUPPORTEDPROTOCOL`), so outside such a
  workspace this range is what installs.
- `@oa-sdk/personas`, which the `enterprise` archetype recommends, is private and not published.
  `init` adds it only inside a workspace that has it, and otherwise prints that it left it out.

`init` keeps entries `package.json` already has unless `--force` is given (`--force` also
overwrites `oa.config.ts` and the scripts). It then reports every `@oa-sdk` entry the project
cannot install where it lives, with what to do about it:

- A `workspace:` entry outside a workspace that has the package, such as one an earlier `init`
  wrote: replace it with the range `init` prints. `--force` does this for the packages `init` writes.
- `@oa-sdk/personas` outside a workspace that has it, whatever its specifier: remove it. No
  registry has it, and `--force` leaves the entry in place because `init` no longer writes it.

When one of them is not installed, `oa-gen` never drops the output silently:

- `mock`, `generate:client`, `pack:client`, and `generate:tanstack` exist to produce that output, so
  they exit with status 1 and print the install command.
- `oa-gen generate` exits with status 1, before writing any file, when the configuration file turns
  the output on explicitly, whether you or `oa-gen init` wrote the switch:
  `core.contracts.pureHandlers: true` needs `@oa-sdk/router` and `core.client.enabled: true` needs
  `@oa-sdk/client`. Set the switch to `false` to stop generating that output instead.
- Outputs that are only implied are skipped with a warning that names the package and the install
  command: switches left unset (archetype presets included), TanStack Query options, CRDT modules,
  and every companion output of a direct `oa-gen generate --spec <file>` run. Files an earlier run
  generated for a skipped output are kept, not pruned as orphans.

## First governance scaffold

```bash
pnpm exec oa-gen scaffold-governance \
  --root . \
  --service orders \
  --profile nestjs-swagger \
  --source-command "pnpm export:openapi" \
  --typegen-policy verify-only
```

Use `commit-required` only when the generated TypeScript output is intentionally committed and
reviewed. The generated `openapi-governance.md` documents the produced contract and CI setup.

TypeSpec remains the human-authored contract source for OA SDK production schemas. AST provenance
and external OpenAPI governance evidence are review and traceability artifacts; they do not become
an alternate schema authority.

## Zod 4 Schema Code Generation

Generate idiomatic Zod 4 validation schemas and inferred TypeScript types from OpenAPI 3.2 (JSON Schema Draft 2020-12) specifications:

```bash
# CLI: generate Zod schemas from an OpenAPI spec
pnpm exec oa-gen generate:zod --spec packages/schemas/dist/openapi.yaml --output ./generated/zod
```

Programmatic usage:

```typescript
import { generateZodFromSpec, createRuntimeZodValidators } from '@oa-sdk/codegen/zodgen';

// 1. Static TypeScript code emission:
const { source, schemaNames } = generateZodFromSpec(openApiDoc, {
  exportTypes: true,
  style: 'both',
});

// 2. In-memory dynamic runtime validator (native Zod 4 z.fromJSONSchema):
const validators = createRuntimeZodValidators(openApiDoc);
const result = validators.User.safeParse(data);
```

### Preflight Validation & Normalization

`oa-gen generate:zod` and `generateZodFromSpec` include an automated preflight schema validation, linting, and normalization pipeline. Broken `$ref`s or schema defects trigger structured fail-fast diagnostics:

```bash
# Validate and normalize before generation (default)
pnpm exec oa-gen generate:zod --spec spec.yaml --output ./zod

# Bypass validation or normalization when required
pnpm exec oa-gen generate:zod --spec spec.yaml --output ./zod --no-validate --no-normalize
pnpm exec oa-gen generate:zod --spec spec.yaml --output ./zod --force
```

## TypeScript Shape Taxonomy Audit

Audit TypeScript source files against the 24-feature syntax taxonomy to determine OpenAPI/TypeSpec projection feasibility:

```bash
# Audit declarations for projection feasibility
pnpm exec oa-gen audit:shape --source src/models/types.ts
```

## Standalone Type Guard Generation (AOT Fast-Path & Polymorphic Dispatch)

Generate self-contained, zero-dependency validation functions with CSP compliance (zero `eval`, zero `new Function`), \(O(1)\) tiered fast-path short-circuiting, and polymorphic `oneOf` hash table dispatch:

```typescript
import { generateStandaloneGuards } from '@oa-sdk/codegen';

const artifacts = await generateStandaloneGuards({
  schemaDocument: openApiDoc,
  outDir: './src/guards',
  tiered: true,               // Inlines O(1) is<Name>Fast() checks
  polymorphicDispatch: true,  // Emits O(1) hash map dispatch for discriminated unions
  guards: [
    { name: 'isActionPayload', schema: '#/$defs/ActionPayload', typeName: 'ActionPayload' },
    { name: 'isTimeSeriesPayload', schema: '#/$defs/TimeSeriesPayload', typeName: 'TimeSeriesPayload' },
    { name: 'isStreamItem', schema: '#/$defs/StreamItem', typeName: 'StreamItem' },
  ],
});
```

## TypeSpec Direct Codegen & Scaffolding

`oa-gen` compiles TypeSpec (`.tsp`) files directly in-memory to generate TypeScript types, Zod schemas, TanStack Query hooks, and run validations without intermediate OpenAPI YAML build artifacts:

```bash
# Direct TypeScript type generation from .tsp
pnpm exec oa-gen typegen --spec api.tsp -o types.ts

# Direct Zod 4 schema generation from .tsp
pnpm exec oa-gen generate:zod --spec api.tsp -o schemas.ts

# Direct TanStack Query v5 3-tier generation from .tsp
pnpm exec oa-gen generate:tanstack --spec api.tsp -o src/queries

# Direct specification validation and linting from .tsp
pnpm exec oa-gen validate --spec api.tsp
pnpm exec oa-gen lint --spec api.tsp

# Scaffold standard 5-operation CRUD with generic envelopes (Ok<T>, NoContent, etc.)
pnpm exec oa-gen tsp-scaffold --route /orders --crud --envelope --file orders.tsp

# TypeSpec AST semantic diff
pnpm exec oa-gen tsp diff --base origin/main --head HEAD --fail-on-breaking
```

