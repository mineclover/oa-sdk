# @oa-sdk/codegen

`@oa-sdk/codegen` provides the `oa-gen` CLI. From one API contract (an OpenAPI document, a
TypeSpec `.tsp` entry, or a module that exports Zod schemas) it validates the contract, generates
TypeScript types, Zod 4 schemas, standalone type guards, a fetch client, TanStack Query keys,
options and hooks, and framework-independent handler contracts, serves a mock server, and checks
changes (`diff`, `tsp diff`, `check-artifact`, `drift`, `review-bundle`). It also collects and
normalizes OpenAPI documents that NestJS or FastAPI services export, and scaffolds their governance
scripts. Generated files are never edited by hand: fix the contract and generate again.

## Install

The package is published to the public npm registry. It requires Node.js 22 or later. Install it
as a development dependency, together with the companion packages described below:

```bash
npm install --save-dev @oa-sdk/codegen @oa-sdk/router @oa-sdk/client @oa-sdk/mock-server
npx oa-gen --help
```

The published package installs its runtime dependencies: `@oa-sdk/core`, `@oa-sdk/parser`,
`@oa-sdk/ast-sync`, `@oa-sdk/surface-ir`, `@oa-sdk/openapi-projection-contract`,
`@oa-sdk/typespec-decorators`, and the TypeSpec compiler (`@typespec/compiler` 1.16 and its HTTP
and OpenAPI libraries). `@oa-sdk/surface-ir` is first published to npm with `@oa-sdk/codegen`
0.9.0.

## Quick start

```bash
# Write oa.config.ts and package.json scripts (detects an existing .tsp, openapi.yaml or openapi.json)
npx oa-gen init --yes
# Validate the contract; --require-32 also requires OpenAPI 3.2.x
npx oa-gen validate --spec ./openapi.yaml --require-32
# Generate the OpenAPI document, handler contract, client and TanStack Query factories that oa.config.ts declares
npx oa-gen generate
# Serve the spec target of oa.config.ts as a mock server and swap routes when the file changes
npx oa-gen mock --watch
```

Common commands:

| Command | Output |
| --- | --- |
| `oa-gen typegen` | TypeScript types (`--incremental` skips regeneration when inputs are unchanged) |
| `oa-gen generate:zod` | Zod 4 schemas and inferred types |
| `oa-gen generate:guards` | Standalone, dependency-free type guards |
| `oa-gen generate:client`, `oa-gen generate:tanstack` | fetch client and TanStack Query v5 keys, options and hooks |
| `oa-gen generate` | Everything `oa.config.ts` declares, including handler contracts (`*.contract.ts`) |
| `oa-gen mock` | Mock server that validates requests against the contract |
| `oa-gen diff`, `oa-gen tsp diff` | Breaking-change classification for OpenAPI files and TypeSpec sources |
| `oa-gen check-artifact`, `oa-gen drift` | Generated OpenAPI freshness and runtime drift checks |
| `oa-gen collect`, `oa-gen scaffold-governance` | External OpenAPI intake and governance scaffolding |
| `oa-gen surface` | Surface IR, Forge projection and per-command OpenAPI Overlays |

No `oa-gen` command writes a Fastify, Express, Hono, or Elysia router file. When you need router
code, call `generateRouter()` from `@oa-sdk/router` in a build script. In the oa-sdk source
repository, the step-by-step guide is `docs/guides/quick-start.md` and the full option reference is
`docs/guides/cli-command-reference.md`.

### Companion packages

Handler contract, client, and mock outputs come from companion packages that `oa-gen` loads on
demand. They are not dependencies of `@oa-sdk/codegen` (the release policy keeps Downstream
Integration packages out of a Core Platform package's published manifest), so installing codegen
does not install them. `@oa-sdk/router`, `@oa-sdk/client`, and `@oa-sdk/mock-server` are first
published to npm with `@oa-sdk/codegen` 0.9.0, and the behaviour below (pinned install hints, the
specifiers `init` writes, and failing instead of skipping) applies to codegen 0.9.0 and later. Add
the ones you use:

| Package | Needed for |
| --- | --- |
| `@oa-sdk/router` | handler contracts and CRDT contract/router modules from `oa-gen generate`; framework router code through its `generateRouter()` API |
| `@oa-sdk/client` | `oa-gen generate:client`, `pack:client`, `generate:tanstack`, and the client SDK, TanStack Query options, and CRDT client/hook modules from `oa-gen generate` |
| `@oa-sdk/mock-server` | `oa-gen mock`, which does not need `msw`. Install `msw` only for the MSW adapters (`@oa-sdk/mock-server/adapters/msw`, `@oa-sdk/mock-server/browser`) |

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
`core.client.enabled: true`), and the generated `mock` script runs `oa-gen mock`. The generated
`oa.config.ts` is an ES module; `oa-gen` loads it as one even in a `"type": "commonjs"` project such
as the one `npm init -y` creates.

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

An OpenAPI document collected from an external service stays that service's contract. AST
provenance and external OpenAPI governance evidence are review and traceability artifacts; they do
not become an alternate schema authority.

## Zod 4 Schema Code Generation

Generate idiomatic Zod 4 validation schemas and inferred TypeScript types from OpenAPI 3.2 (JSON Schema Draft 2020-12) specifications:

```bash
# CLI: generate Zod schemas from an OpenAPI spec
pnpm exec oa-gen generate:zod --spec ./openapi.yaml --output ./generated/zod
```

Programmatic usage:

```typescript
import { generateZodFromSpec, createRuntimeZodValidators } from '@oa-sdk/codegen/zodgen';

// 1. Static TypeScript code emission (returns the module source as a string):
const source = generateZodFromSpec(openApiDoc, {
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

`oa-gen` compiles TypeSpec (`.tsp`) files directly in-memory to generate TypeScript types, Zod schemas, TanStack Query hooks, and run validations without intermediate OpenAPI YAML build artifacts. The libraries a `.tsp` file imports are resolved from the file's location, so add them as direct development dependencies; strict layouts such as pnpm otherwise fail with `import-not-found`:

```bash
npm install --save-dev @oa-sdk/typespec-decorators@^0.3.0 \
  @typespec/compiler@^1.16.0 @typespec/http@^1.16.0 @typespec/openapi@^1.16.0
```

`tsp-scaffold --file` appends to an existing file. Its default `--auth bearerAuth` emits `@useAuth(bearerAuth)`, which compiles only when the file declares `model bearerAuth is BearerAuth;`; pass `--auth none` otherwise.

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
pnpm exec oa-gen tsp-scaffold --route /orders --crud --envelope --auth none --file api.tsp

# TypeSpec AST semantic diff against the committed version, including uncommitted edits
pnpm exec oa-gen tsp diff --base origin/main:api.tsp --head api.tsp --fail-on-breaking
```

