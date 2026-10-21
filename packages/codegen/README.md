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

`oa-gen drift` exits with code 0 when the managed and runtime OpenAPI documents match, and with
code 1 when it reports drift or cannot read the runtime OpenAPI. `--managed-openapi` and
`--runtime-openapi` accept relative paths, resolved from the project root, as well as absolute paths.

No `oa-gen` command writes a Fastify, Express, Hono, or Elysia router file. When you need router
code, call `generateRouter()` from `@oa-sdk/router` in a build script. In the oa-sdk source
repository, the step-by-step guide is `docs/guides/quick-start.md` and the full option reference is
`docs/guides/cli-command-reference.md`.

### Scripts `oa-gen init` adds

Every `oa-gen` script `oa-gen init` adds to `package.json` runs as written in the scaffold (through
`bun x oa-gen` on Bun). A framework target also adds dev server and build scripts that run your own
server code; `init` writes neither the server entry file nor `tsconfig.json`, so they run once you
add them:

| Added for | Scripts |
| --- | --- |
| Every target | `generate` (`oa-gen generate`) and `mock` (`oa-gen mock --watch`); a detected framework also gets its dev server script (`dev`, or `start:dev` for NestJS) and, for Fastify, `build` (`tsc`) |
| `--archetype mvp` (default) | `validate` (`oa-gen validate`) |
| `--archetype microservice` | nothing more |
| `--archetype enterprise` | `lint:spec`, `diff`, `baseline:update`, `ci:gate` |

The `enterprise` scripts gate the spec entry point against a contract baseline,
`openapi.baseline.yaml`, which `init` creates from the spec: the document `oa-gen normalize` writes
for it (TypeSpec is compiled to OpenAPI 3.2, and the files the spec's `$ref`s name are copied in).
Commit it. `diff` runs
`oa-gen diff --base openapi.baseline.yaml --head <spec> --fail-on-breaking`, which also compares
what those files hold (path items included, with the fields written next to their `$ref` kept as
OpenAPI defines them), `ci:gate` runs
`oa-gen validate --spec <spec> --require-32`, `oa-gen lint --spec <spec>` and that diff, and
`baseline:update` makes the current spec the baseline when you release. `init` never overwrites an
existing baseline. The spec is the `schemaEntry` of the `oa.config.ts` the project keeps: rerunning
`init --archetype enterprise` without `--force` loads that file (install the project's
dependencies first) and gates its spec target, or the one of several that `--spec` names; when it
cannot tell which spec to gate, it adds neither the baseline nor these scripts and prints why. Scripts that earlier versions of `init` added and that failed or only ran
`oa-gen generate` (`generate:router`, `generate:client`, `generate:contract`, `test:contract`,
`audit:wire`, `audit:csp`, `audit:shape`, `personas:check`) are no longer added; remove them from
`package.json`. Earlier enterprise scaffolds also have `diff`, `ci:gate` and `lint:spec` commands
that fail (`oa-gen diff --base origin/main ...`), which a rerun without `--force` keeps. `init`
lists each of these scripts still in `package.json` with why and what to do: remove it, or replace
it with the command `init` now writes under that name.

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

## TypeSpec Builder Platform (openapi-ts Style Pipeline)

Beyond standalone CLI commands, `@oa-sdk/codegen` provides a comprehensive programmatic builder platform (`createTspBuilder`, `defineTspConfig`) that treats TypeSpec (`.tsp`) as the Single Source of Truth (SSOT). It performs in-memory AST compilation without writing intermediate OpenAPI YAML files to disk, schedules plugins via a topological DAG (Kahn's algorithm), and renders openapi-ts style client SDKs, TanStack Query v5 3-tier hooks, framework router contracts, and binary codecs.

### Quickstart

```typescript
import {
  createTspBuilder,
  defineTspConfig,
  pluginTypescript,
  pluginClient,
  pluginTanstackQuery,
  pluginRouter,
  pluginWire,
} from '@oa-sdk/codegen';

// 1. Initialize builder with fluent chaining or defineTspConfig
const builder = createTspBuilder('./api/main.tsp', {
  openApiVersion: '3.2.0',
});

// 2. Register multi-target plugins (DAG resolves topological order automatically)
builder
  .use(pluginTypescript({ output: 'types.ts', typeGuards: true }))
  .use(pluginClient({ output: 'client.ts', httpClient: 'fetch' }))
  .use(pluginTanstackQuery({ output: 'queries.ts', split: false })) // queries.ts + the api-client.ts adapter
  .use(pluginRouter({ target: 'hono', output: 'router.ts' }))
  .use(pluginWire({ codecs: ['protobuf', 'msgpack'] }));

// 3. Programmatic introspection (compiled in memory once; later calls return the cached report)
const report = await builder.introspect();
console.log(`Routes: ${report.routesCount}, Models: ${report.models.length}`);

// 4. Build all targets to virtual file system or disk
const result = await builder.build({
  output: './src/generated',
  clean: true,
});
```

The generated TanStack Query options and hooks do not call `client.ts` directly: they take an
operation-method client. Because `pluginClient` runs in the same pipeline, `pluginTanstackQuery`
also emits `api-client.ts`, which `queries.ts` (and `hooks.ts` with `split: true`) import. It
exports an `ApiClient` interface and a `createApiClient(client?)` factory whose methods forward to
the matching `pluginClient` functions; without an argument each call uses the SDK's current default
client. Wrap a client from `createClient(...)` and pass it to the options or hooks:

```typescript
import { QueryClient } from '@tanstack/react-query';
import { createClient } from './src/generated/client.js';
import { ApiClientResponseError, createApiClient } from './src/generated/api-client.js';
// TanStack names come from the full operationId: Pets_getPetById gives petsGetPetByIdQueryOptions
import { petsGetPetByIdQueryOptions } from './src/generated/queries.js';

const apiClient = createApiClient(createClient({ baseUrl: 'https://api.example.com' }));
const queryClient = new QueryClient();

try {
  const pet = await queryClient.fetchQuery(petsGetPetByIdQueryOptions(apiClient, { petId: 'p1' }));
  console.log(pet);
} catch (error) {
  if (error instanceof ApiClientResponseError) console.error(error.status, error.body);
}
```

Each adapter method calls its SDK function with `throwOnError: false` and resolves to the 2xx
payload. The value a query or mutation rejects with matches the error type (`TError`) the generated
code declares:

- A failed response whose status the operation declares an `application/json` error model for (an
  explicit 4xx/5xx response, or `default` for the statuses no other response covers) rejects with
  the parsed error body. The generated code types the error as `<Operation>Error`, the union of
  those models.
- Every other failed response rejects with `ApiClientResponseError` (`status`, parsed `body`,
  `response`): an undeclared status, a `4XX`/`5XX` range response, an empty body (with either
  transport), and any failure of an operation that declares no error models, whose `TError` is
  `Error`. Where the operation does declare error models, this class is not part of
  `<Operation>Error` (nor are network errors and aborts), so narrow with `instanceof` first.

`pluginTanstackQuery({ clientName })` renames the interface, the factory and the error class
(`<clientName>`, `create<clientName>`, `<clientName>ResponseError`). Set `clientFile` to use a
hand-written operation-method client instead of the adapter, or `clientAdapter: false` to emit no
adapter.

### Multi-Target Plugin Matrix

| Plugin | Dependencies | Default Output | Description |
| --- | --- | --- | --- |
| `pluginTypescript` | None | `types.ts` (`guards.ts` with `typeGuards: true`) | TypeScript DTO models, enums (`union`/`typescript`/`javascript`), JSDoc docstrings, and standalone zero-eval type guards |
| `pluginClient` (`pluginSdk`) | `typescript` | `client.ts` | openapi-ts calling convention `{ path, query, body, headers }`, `{ data, error, response }` discriminated union, status-based `isErrorStatus(res, 404)` narrowing, and tree-shakeable functional endpoints. A short name that cannot be declared falls back to the full operationId name (`Pets_delete` exports only `petsDelete`), and a full name that cannot be declared gets a `_` suffix (root-level `delete` becomes `delete_`); so does an operation type named like a `client.ts` helper (root-level `client`: `ClientResponse_`). A `clientName` that is not an identifier, is reserved, or collides with a name `client.ts` declares or a global it refers to fails with `CLIENT_INVALID_CLIENT_NAME` |
| `pluginTanstackQuery` | `typescript`, `client` | `queries.ts`, `api-client.ts` (`split: true`: `keys.ts`, `queries.ts`, `hooks.ts`, `api-client.ts`) | TanStack Query v5 3-Tier architecture: Tier 1 Keys (`*Keys`), Tier 2 Options (`*QueryOptions`, `*MutationOptions`, `*InfiniteQueryOptions`), Tier 3 Hooks (`use*Query`, `use*Mutation`). The options and hooks take the `ApiClient` of the generated `api-client.ts` adapter over `pluginClient` (`createApiClient(createClient(...))`); queries and mutations reject with the declared error body or an `ApiClientResponseError` |
| `pluginRouter` | `typescript` | `api.contract.ts`, `router.ts` | Framework-independent handler contracts (`HandlerResponse<TSuccess, TErrorMap>`) and router adapters for Hono, Express, Fastify (JIT inline schema), and Bun Elysia (zero-copy) |
| `pluginWire` | `typescript` | `wire.ts` (`schema.proto` with the `proto3` codec) | Zero-eval CSP-safe Protobuf and MessagePack binary codecs, Protocol Buffers v3 `.proto` schemas, and dynamic MIME negotiation (`resolveBinaryCodec`) |

### Vite Integration (`vitePluginTsp`)

Integrate code generation and TypeSpec live reloading into your Vite development server:

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { vitePluginTsp, pluginTypescript, pluginClient } from '@oa-sdk/codegen';

export default defineConfig({
  plugins: [
    vitePluginTsp({
      config: {
        input: './api/main.tsp',
        output: './src/generated',
        plugins: [pluginTypescript(), pluginClient()],
      },
      runOnDev: true,   // Build on dev server start
      runOnBuild: true, // Build before bundle
      watch: true,      // Watch .tsp files and trigger full-reload HMR
      debounceMs: 150,
    }),
  ],
});
```

For full documentation, architecture diagrams, and migration details, see the [TypeSpec Builder Platform Guide](../../docs/guides/typespec-builder-platform.md).

## TypeSpec Direct Codegen & Scaffolding

`oa-gen` compiles TypeSpec (`.tsp`) files directly in-memory to generate TypeScript types, Zod schemas, TanStack Query hooks, and run validations without intermediate OpenAPI YAML build artifacts. The libraries a `.tsp` file imports are resolved from the file's location, so add them as direct development dependencies; strict layouts such as pnpm otherwise fail with `import-not-found`:

```bash
npm install --save-dev @oa-sdk/typespec-decorators@^0.3.0 \
  @typespec/compiler@^1.16.0 @typespec/http@^1.16.0 @typespec/openapi@^1.16.0
```

`tsp-scaffold --file` appends to an existing file and adds no `import` or `using` lines. The scaffold
always emits `@operationId` (from `@typespec/openapi`) and `@oaUseResponseComponent` (from
`@oa-sdk/typespec-decorators`), and `--envelope` uses the standard `Ok<T>`, `Created<T>`, `NoContent` and
`PageResult<T>` contracts from `@oa-sdk/typespec-decorators`. The target file therefore needs this header;
without it `oa-gen validate` fails with `Unknown decorator @operationId` or
`Unknown decorator @oaUseResponseComponent`:

```typespec
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

@service(#{ title: "Orders" })
namespace OrdersApi;
```

The default `--auth bearerAuth` emits `@useAuth(bearerAuth)`, which compiles only when the file also declares
`model bearerAuth is BearerAuth;`; pass `--auth none` otherwise. `--output` starts a new file with only the
`@typespec/http` and `@typespec/openapi` imports and overwrites an existing file with the scaffold alone, so its
output does not compile as written; create the file with the header above and use `--file`.

When `oa-gen` compiles a `.tsp` file in memory, `@oaUseResponseComponent` stays an
`x-oa-sdk-operation-component-refs` extension rather than a response; add `ErrorResponse<Status>` or
`StandardHttpErrors` to an operation's return type for 4xx responses.

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

# Committed content only: a git ref without a path reads the other side's entry point (api.tsp) from its own commit
pnpm exec oa-gen tsp diff --base origin/main:api.tsp --head HEAD --fail-on-breaking
```

`tsp diff` takes a `.tsp` file, a directory, a git ref or `<ref>:<path>` on either side. A git ref is read with
`git archive`, so it never sees uncommitted edits. When a path-less ref's entry point cannot be determined (the other
side's path is missing from that commit, or the commit has several `main.tsp` files), the command fails and asks for
`<ref>:<path>`; when both sides resolve to the same commit and entry point, it says so on stderr.

## TypeSpec origin in a graph semantic index

Generate the restored OpenAPI document and its provenance in the same TypeSpec check, then pass
both to `typegen`. The resulting semantic index is a sidecar: generated TypeScript stays free of
origin comments, and the index is hash-bound to the generated TypeScript, its restored OpenAPI input
and the TypeSpec provenance.

```bash
node --import tsx scripts/schema-typespec-check.ts \
  --output .oa-sdk/typespec/restored.openapi.yaml \
  --provenance .oa-sdk/typespec/declaration-ref-provenance.json

pnpm exec oa-gen typegen \
  --spec .oa-sdk/typespec/restored.openapi.yaml \
  --output src/generated/api.ts \
  --typespec-provenance .oa-sdk/typespec/declaration-ref-provenance.json \
  --graph-semantic-index .graph/oa-sdk-typespec.semantic.json \
  --graph-file src/generated/api.ts
```

Each exported declaration generated from a schema or operation of the document becomes a host tagged
`oa-sdk-typespec`, with the owning TypeSpec declaration's `.tsp` file (relative to the TypeSpec
source root of the provenance) and line as evidence. A nested schema with its own alias takes the
owner of its enclosing schema; a schema inlined from another document gets no host. `typegen` fails
when the provenance was produced for another document or leaves a generated declaration without an
owner. With `--incremental`, the index is recorded as its own target next to the types, and both are
reused or regenerated together: a changed provenance file, `--graph-file`, or a modified or
missing index regenerates both.

Configure `.graph/oa-sdk-typespec.semantic.json` as the project's `semanticIndex` in the graph router,
which rejects the sidecar once the generated TypeScript hash no longer matches.
