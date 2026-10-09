# @oa-sdk/typespec-decorators

Trusted, narrow TypeSpec authoring helpers and standard contracts for OA SDK's versioned extension
contract. The package deliberately does not expose a generic decorator for arbitrary `x-oa-sdk-*` JSON.

`import "@oa-sdk/typespec-decorators";` loads the decorators and the standard contracts together.
Both live in the `OaSdkTypeSpec` namespace, so one `using OaSdkTypeSpec;` brings them into scope.
The contracts use `@typespec/http` decorators, which this package depends on.

## Install

```bash
npm install --save-dev @oa-sdk/typespec-decorators@^0.3.0 \
  @typespec/compiler@^1.16.0 @typespec/http@^1.16.0 @typespec/openapi@^1.16.0
```

- The standard contracts below exist from 0.3.0. Version 0.3.0 is on npm from the `@oa-sdk/codegen`
  0.9.0 release; the [changelog](../../docs/changelog.md) lists the installable versions.
- Install the TypeSpec libraries that your `.tsp` files import (`@typespec/http`, `@typespec/openapi`,
  this package) as direct devDependencies. TypeSpec resolves `import "@typespec/http"` from the
  location of the `.tsp` file, so under pnpm's strict layout the copies that `@oa-sdk/codegen`
  depends on are not visible and compilation fails with `import-not-found`.
- `@typespec/compiler` provides the `tsp` CLI and the editor language server. `oa-gen`
  (`@oa-sdk/codegen`) compiles `.tsp` files in memory with its own TypeSpec compiler, so
  `oa-gen validate`, `typegen`, `generate` and `mock --tsp` need no `tsp compile` step. Use the
  same `^1.16.0` range that `@oa-sdk/codegen` uses.
- `@info(#{ version })` needs `import "@typespec/openapi";` and `using OpenAPI;`.
- `tsp compile` with `@typespec/openapi3` (install it separately) emits OpenAPI 3.0.0 unless you set
  `openapi-versions`; `oa-gen` projects `.tsp` files to OpenAPI 3.2.0.
- The package requires Node.js 22 or later.

Getting started with `oa-gen` itself is covered by the [Quick Start](../../docs/guides/quick-start.md).

## 1. Platform Standard Contracts (`contracts.tsp`)

`@oa-sdk/typespec-decorators` ships standard HTTP response envelopes and error contracts:

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Users" })
namespace UsersApi;

model User {
  id: string;
  name: string;
}

model CreateUserRequest {
  name: string;
}

@route("/users")
interface Users {
  @get list(@query page?: integer, @query limit?: integer): Ok<PageResult<User>> | StandardHttpErrors;
  @get @route("/{id}") read(@path id: string): Ok<User> | ErrorResponse<404>;
  @post create(@body body: CreateUserRequest): Created<User> | ErrorResponse<400> | ErrorResponse<409>;
  @delete @route("/{id}") remove(@path id: string): NoContent | ErrorResponse<404>;
}
```

- **`Ok<T>`**: 200 response whose body is `T` (`{ @statusCode statusCode: 200, @body body: T }`).
- **`Created<T>`**: 201 response whose body is `T` (`{ @statusCode statusCode: 201, @body body: T }`).
- **`NoContent<T = void>`**: 204 response without a body. The unused template parameter has a default, so `NoContent` needs no argument.
- **`PageResult<T>`**: pagination body (`items: T[]`, `total`, optional `page` (default 1) and `limit` (1-100, default 20)). It is a body model, not a response, so wrap it: `Ok<PageResult<T>>`.
- **`ErrorResponse<Status>`**: error response with the given status code and a `StandardError` body.
- **`StandardError`**: error body with `code`, `message`, optional `details: StandardValidationError[]`, and optional `_meta` (`operationId`, `requestId`).
- **`StandardValidationError`**: field-level validation error with `path`, `message`, and optional `received` and `expected`.
- **`StandardHttpErrors`**: an alias for `ErrorResponse<400> | ErrorResponse<401> | ErrorResponse<403> | ErrorResponse<404> | ErrorResponse<500>`. Add other statuses with `ErrorResponse<Status>`, for example `ErrorResponse<409>`.

The OpenAPI emitter names the shared error schemas after their namespace:
`#/components/schemas/OaSdkTypeSpec.StandardError` and `OaSdkTypeSpec.StandardValidationError`.

A model you declare in your own namespace takes precedence over these names. If you also `using`
another namespace that declares `Ok`, `Created`, `NoContent`, `PageResult`, `ErrorResponse`,
`StandardError`, `StandardValidationError` or `StandardHttpErrors`, TypeSpec reports an
`ambiguous-symbol` error; use the fully qualified name, such as `OaSdkTypeSpec.Ok`.

These contracts are ordinary HTTP responses, so the 4xx responses they declare appear in every
output, including `oa-gen mock --tsp` and `oa-gen typegen`/`generate` run on a `.tsp` file.

## 2. Authoring Decorators

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Members" })
namespace MembersApi;

@crdtEntity(#{ partitionKey: "teamId", compaction: "checkpoint-squash" })
model Member {
  id: string;
  teamId: string;

  @pseudonymize("mask", "direct_identifier", true)
  email: string;

  @crdt(#{ type: "lww-register", resolution: "last-write-wins", role: "value" })
  displayName: string;
}

@route("/members")
@personaCapability("pagination", "filter-by-role")
@oaUseResponseComponent("400", "BadRequest")
op listMembers(): Member[];
```

### `@oaUseResponseComponent(statusCode, componentName)`
Emits only the existing `oa-sdk.typespec-extensions.v5` operation-response component-reference shape
(`x-oa-sdk-operation-component-refs`). It accepts a three-digit status code (or `default`) and a
simple component name; anything else reports `invalid-response-component-reference`. When the same
status code is declared twice, no diagnostic is reported and only the declaration closest to the
operation is kept.

The decorator records the reference; it does not create a response. Only the OA SDK bundle restore
(`oa-gen tsp-bundle-check`, and `pnpm schema:typespec-check` in the OA SDK repository) replaces the
operation's response for that status with `$ref: '#/components/responses/<componentName>'`, and the
restore needs three things: the operation's return type must already declare that status, the name
must be a response component the bundle defines (the OA SDK repository keeps them in the
`x-oa-sdk-components` catalog), and the response examples must be recorded in
`x-oa-sdk-operation-examples`. `oa-gen`'s in-memory paths (`oa-gen mock --tsp`, and
`generate`, `typegen` or `validate` run on a `.tsp` file) keep only the extension, so the response
does not appear there. To declare 4xx responses in an ordinary project, use `ErrorResponse<Status>` or
`StandardHttpErrors`. The repository rules are in the
[TypeSpec authoring conventions](../../docs/guides/typespec-authoring-conventions.md#31-재사용-응답-컴포넌트에-연결하기).

### `@personaCapability(traits...)`
Declares formal API persona capabilities on an operation (e.g. `@personaCapability("pagination", "audit-emission")`).
Each trait must be one of the 24 standard capability traits from `packages/personas/src/traits/skill.yaml`
(exported as `VALID_PERSONA_TRAITS`); an unknown trait reports `invalid-persona-trait`. The decorator
emits `x-oa-sdk-persona-traits`.

### `@pseudonymize(transform, role?, pii?, relationship?)`
Annotates a model property with a DPM pseudonymization contract and emits `x-oa-sdk-dpm-projection`.
`transform` is one of `VALID_DPM_TRANSFORMS` (`keep`, `redact`, `mask`, `null`, `hash`, `generalize`,
`relationship_token`, `polymorphic_relationship_token`) and `role` one of `VALID_DPM_ROLES`
(`direct_identifier`, `foreign_identifier`, `business_identifier`, `business_metric`,
`unstructured_text`, `code_lookup`). A `direct_identifier`, or any `pii: true` field, cannot use
`keep`, and a `pii: true` `foreign_identifier` needs `relationship`. A rule that breaks these
constraints reports `invalid-pseudonymize-rule`.

### `@crdt(options)` & `@crdtEntity(options)`
Declare CRDT replication and conflict-resolution policies on model properties (`@crdt`, emitting
`x-oa-sdk-crdt`) and models (`@crdtEntity`, emitting `x-oa-sdk-crdt-entity`). `@crdt` requires a
`type` (`VALID_CRDT_TYPES`) and accepts `resolution`, `engine` and `role`; `@crdtEntity` accepts
`partitionKey`, `timeRange`, `compaction` (`VALID_CRDT_COMPACTIONS`) and `strategy`.

When a spec has a model with `@crdtEntity`, `oa-gen generate` also writes four CRDT modules for that
spec target: a CRDT handler contract, a WebSocket router, a client and hooks. `@crdt` on properties
alone does not: its `x-oa-sdk-crdt` sits inside the schema's `properties`, and `generate` looks only
at the top level of each schema. The modules are generated by the companion packages
`@oa-sdk/router` and `@oa-sdk/client`; see
[companion packages](../../docs/guides/cli-setup.md#동반-패키지-companion-packages) for what happens
when they are not installed.

Where the modules go depends on `outputRouting`:

- Without `outputRouting`, they are `<id>.crdt.contract.ts`, `<id>.crdt.router.ts`,
  `<id>.crdt.client.ts` and `<id>.crdt.hooks.ts` in the spec target's `outDir`.
- With `outputRouting`, their paths come from the routing template (`pattern`, `byKind` or `rules`)
  like the other generated files, and `{kind}` becomes `crdt-contract`, `crdt-router`,
  `crdt-client` and `crdt-hooks`. Under the pattern that `oa-gen init` writes
  (`src/api/{tag}/{tag}.{kind}.ts`, where `{tag}` is the spec target id) the files are
  `src/api/<id>/<id>.crdt-contract.ts`, `<id>.crdt-router.ts`, `<id>.crdt-client.ts` and
  `<id>.crdt-hooks.ts`.

Known limitation: the generated CRDT router file is always a Hono WebSocket router (it imports
`hono` and `hono/ws`), and no setting changes that. For Fastify, Express or Elysia, call
`generateCrdtRouter(spec, { target, contractImport })` from `@oa-sdk/router` in a build script, set
`contractImport` to the generated CRDT contract module (for example `./<id>.crdt-contract.js` under
the `oa-gen init` pattern), and write the result to a file of your own, because the next
`oa-gen generate` run overwrites the generated CRDT router file.

### `@actorInput`, `@machineContext`, `@eventPayload(eventType?)`, `@behaviorRef(behaviorId)`
Decorators for XState / Behavior runtime data shape modeling (resolving Issue #1). They are exported from
`@oa-sdk/typespec-decorators/behavior` and the root package:
- `@actorInput`: marks a model as an Actor Input contract (`x-oa-sdk-behavior-actor-input: true`).
- `@machineContext`: marks a model as a Machine Context contract (`x-oa-sdk-behavior-machine-context: true`).
- `@eventPayload(eventType?)`: marks a model as an Event Payload (`x-oa-sdk-behavior-event-payload: { eventType }`).
- `@behaviorRef(behaviorId)`: links a model to a canonical Behavior IR artifact ID (`x-oa-sdk-behavior-ref: { behaviorId }`).

These decorators specify only the **Data Shape** of state machine contracts; the FSM transitions, topology, and action execution
remain owned by the external Behavior IR (WIREFRAME-BOOK). In production API compilation (`approved.openapi.yaml`), these
extensions are strictly stripped or kept internal.

### `@storageRef(target)` & `@storageCatalog(catalogName)`
Decorators for linking TypeSpec models with Ariga Atlas physical database evidence without DDL mutation. Exported from
`@oa-sdk/typespec-decorators/storage` and the root package:
- `@storageRef(target)`: binds a model or model property to a physical table or column identifier (`x-oa-sdk-storage-ref: { target }`).
- `@storageCatalog(catalogName)`: binds a namespace to a physical database catalog (`x-oa-sdk-storage-catalog: { catalog }`).

Consumed by `@oa-sdk/dpm` and `oa-erd check` to perform static drift verification against `atlas schema inspect --format json`.

## 3. Purpose-Driven Modular Subpaths

To avoid schema pollution and cross-domain coupling in large projects, `@oa-sdk/typespec-decorators` provides modular entrypoints:

```typespec
// Import only the slice you need
import "@oa-sdk/typespec-decorators/api";        // HTTP responses & @oaUseResponseComponent
import "@oa-sdk/typespec-decorators/governance"; // @personaCapability & @pseudonymize
import "@oa-sdk/typespec-decorators/crdt";       // @crdt & @crdtEntity
import "@oa-sdk/typespec-decorators/behavior";   // @actorInput, @machineContext, etc.
import "@oa-sdk/typespec-decorators/storage";    // @storageRef & @storageCatalog
```

For complete architecture details and toolchain boundary rules (including `ttsc` AOT Standard Schema compilation for XState v6), see
the [Schema Architecture and ttsc Guide](../../docs/guides/schema-architecture-and-ttsc-guide.md).

## Maintainers

Because custom TypeSpec decorators execute JavaScript, this package is included
in spec-lens's allowlisted runtime and its exact runtime artifact digest is part
of the TypeSpec toolchain fingerprint. Update the package, spec-lens allowlist,
and focused restored-OpenAPI coverage together.
