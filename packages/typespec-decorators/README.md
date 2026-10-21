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

### `@traceId(id)`, `@replaces(ids...)`, `@requirement(reqIds...)`
Traceability and lineage decorators exported from `@oa-sdk/typespec-decorators/governance` and the root package:
- `@traceId(id)`: assigns a stable, immutable tracking identifier (`x-oa-sdk-trace.trackingId`) to a `Model`, `Operation`, `Enum`, `Union`, `Scalar`, or `ModelProperty` that survives file moves and symbol renames. An id may be written in only one `@traceId` application per program; writing it on a second declaration reports `invalid-trace-rule: Duplicate traceId`. Only the declaration the application is written on (`@traceId` above it, or `@@traceId(Target, ...)` naming it) emits the id. TypeSpec also replays the application onto the types it derives from that declaration, and those types compile without a diagnostic but do not carry the id: `model B is A` and `op b is a` copies, operations cloned by `interface B extends A`, properties copied by a spread (`...A`) or an `is`, and template instances (`Page<User>`, `Page<Order>`, including instances named by `@friendlyName`). Each of them is a separate schema or operation, so `oa-gen trace` gives it a generated tracking id, which keeps `oa-gen trace --verify` free of `traceability/duplicate-tracking-id`. To track a derived type under a stable id, give it its own `@traceId` (`@traceId("TRC-USER-PAGE") model UserPage is Page<User>;`); `@derivedFrom("A", "reason")` records its lineage. A `@traceId` on a template declaration therefore reaches no emitted schema; put it on a named instance instead.
  A clone that TypeSpec's mutation engine (`unsafe_mutateSubgraph*`) makes of the declaration is the same declaration in another view of the program, so it keeps the id. `@typespec/openapi3` takes this path for a `@versioned` service: it builds each per-version document from a `@typespec/versioning` snapshot clone of the service namespace, so a declaration carries its trackingId in each version document it appears in. The derived types listed above still carry no id inside a snapshot.
  Known limit: some emitted variants of one declaration share its id inside one document. `@typespec/openapi3` copies a model's extensions onto the visibility variants it emits (`WidgetCreate`, `WidgetUpdate`). `MergePatchUpdate<Widget>` is built from mutator clones of `Widget` and of the models it references, so `WidgetMergePatchUpdate` and `PartMergePatchUpdate` (for a referenced `Part`) carry the ids of `Widget`, `Part` and their properties. In both cases `oa-gen trace --verify` reports `traceability/duplicate-tracking-id` for each schema that shares the id.
  Known limit: `scalar MyId2 extends MyId;` gets `MyId`'s id too, because `@typespec/openapi3` builds the derived scalar's schema from its base, extensions included, so `oa-gen trace --verify` reports `traceability/duplicate-tracking-id` for both schemas. Give the base scalar no `@traceId`, or track the derived scalar by its own declaration.
  Known limit: TypeSpec shares, rather than copies, some types between a declaration and the types it derives. An operation cloned by `interface B extends A` keeps the base operation's `parameters`, and `op b is a` / `model B is A` keep anonymous body, return and property types. A `@traceId` on a member of such a shared type (`list(@traceId("…") @query x: string)`, or `{ @traceId("…") x: string }` inside an anonymous body) therefore appears on that parameter or property under every derived operation or schema. `oa-gen trace` does not report this, because inline parameters and properties are not graph nodes. Put the id on a named model the operations reference instead.
- `@replaces(...replacedIds)`: declares one or more previous canonical definition IDs or symbol identifiers that a specification element replaces (`x-oa-sdk-trace.replaces`), enabling lossless refactoring lineage.
- `@requirement(...requirementIds)`: links a specification element to external requirement, compliance, or issue identifiers (`x-oa-sdk-trace.requirements`, e.g. `"GDPR-ART-15"`, `"docs/requirements.md#req-user-profile"`).

When paired with `@samchon/typespec-evidence` (`@evidence`, `@evidenceExclude`, Heading-Form `## @evidence`), `@oa-sdk/codegen` reads both `x-oa-sdk-trace` and `x-samchon-evidence`:

- `oa-gen trace --spec <openapi> -o .oa-trace.json` merges them into the `.oa-trace.json` traceability sidecar.
- The JSDoc provenance tags (`@oa-pointer`, `@oa-source`, `@oa-id`, `@oa-trace-id`, `@oa-replaces`, `@oa-requirement`, `@evidence`, `## @evidence`, `@evidenceExclude`) are emitted onto generated TypeScript types only by the library call `generateTypes(parsed, { includeProvenanceAnnotations: true })` or `generateTypesFromSpec(document, { includeProvenanceAnnotations: true })`. `oa-gen typegen` and `oa-gen generate` do not pass that option, so their output carries none of these tags.

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

The drift check is `verifyAtlasSchemaDrift(evidence, mappings)`, a JavaScript function exported from the `@oa-sdk/typespec-decorators/governance` subpath (not from the root package). It compares
caller-supplied mappings (entity, table, columns and expected logical type, usually transcribed from the `@storageRef` targets)
against the JSON snapshot `atlas schema inspect --format '{{ json . }}'` prints, and reports missing tables and columns as errors
and incompatible column types as warnings. Pass the snapshot through `AtlasSchemaInspectOutputSchema.parse` first. Outside this
check, only `oa-gen trace` reads `x-oa-sdk-storage-ref`, recording its `target` as `governance.storageRef` on the trace node;
`@oa-sdk/dpm` and `oa-erd check` consume neither the storage extensions nor Atlas evidence.
See the [Atlas schema drift governance guide](../../docs/guides/use-cases/atlas-schema-drift-governance.md).

### `@chunkStream(options?)`
Declares Chunk Stream transmission parameters, presets, and memory residency policies on a `Model`, `Operation`, or `Interface`. Exported from `@oa-sdk/typespec-decorators/chunk-stream` and the root package, emitting `x-oa-sdk-chunk-stream`.

```typespec
import "@oa-sdk/typespec-decorators/chunk-stream";
using OaSdkTypeSpec;

@chunkStream(#{ preset: "optimal-web", memoryPreset: "standard", fps: 30 })
op streamStoryboard(): void;
```

Options (all optional):

| Option | Values | Default |
|---|---|---|
| `preset` | `ultra-low-latency` (1460), `optimal-web` (7168), `standard-buffer` (8192), `initcwnd-burst` (14336), `large-payload` (65536), `heavy-media` (262144), `bulk-data` (1048576): the `targetChunkBytes` it implies | `optimal-web` |
| `memoryPreset` | `mobile` (64 MiB), `standard` (128 MiB), `highperf` (256 MiB): the `maxResidentBytes` it implies | `standard` |
| `mode` | `adaptive`, `eager`, `manual` | `adaptive` |
| `targetChunkBytes`, `maxResidentBytes` | positive integers that override the preset values | from `preset` / `memoryPreset` |
| `maxL1MemoryBytes` | positive integer | half of `maxResidentBytes` |
| `fps`, `chunkFrames`, `lookaheadFrames` | positive integers | `30`, `fps`, `fps * 2` |
| `retentionFrames` | non-negative integer | `fps` |
| `payloadFormat` | any string | `ui-action@v1` |

The emitted extension has the same resolved shape and key order as the runtime `defineChunkStreamConfig` from `@oa-sdk/chunk-stream` (`schemaVersion`, `preset`, `targetChunkBytes`, `memoryPreset`, `maxResidentBytes`, `maxL1MemoryBytes`, `payloadFormat`, `fps`, `chunkFrames`, `mode`, `lookaheadFrames`, `retentionFrames`). Only an absent option takes its default. An options argument that is not an object (e.g. `@chunkStream("optimal-web")`), a value of the wrong type (for example `preset: 5`, `mode: true` or `memoryPreset: null`), an unknown `preset`, `memoryPreset` or `mode`, or a numeric option that is not an integer in its range is reported as `invalid-chunk-stream-rule` and no extension is emitted; the decorator never clamps a value or silently replaces it with the default.

## 3. Purpose-Driven Modular Subpaths

To avoid schema pollution and cross-domain coupling in large projects, `@oa-sdk/typespec-decorators` provides modular entrypoints:

```typespec
// Import only the slice you need
import "@oa-sdk/typespec-decorators/api";          // HTTP responses & @oaUseResponseComponent
import "@oa-sdk/typespec-decorators/governance";   // @personaCapability, @pseudonymize, @traceId, @replaces, @requirement
import "@oa-sdk/typespec-decorators/crdt";         // @crdt & @crdtEntity
import "@oa-sdk/typespec-decorators/behavior";     // @actorInput, @machineContext, etc.
import "@oa-sdk/typespec-decorators/storage";      // @storageRef & @storageCatalog
import "@oa-sdk/typespec-decorators/chunk-stream"; // @chunkStream
```

The `./governance` subpath also exports, for JavaScript only, the Atlas drift check: import `verifyAtlasSchemaDrift` and
`AtlasSchemaInspectOutputSchema` from `@oa-sdk/typespec-decorators/governance` in a CI script (see `@storageRef` above). The
package has no separate `storage-drift` subpath.

For complete architecture details and toolchain boundary rules (including `ttsc@0.33.1` AOT Standard Schema compilation for XState v6 and `@wrtnlabs/evidence@0.8.0` provenance), see
the [Schema Architecture and ttsc Guide](../../docs/guides/schema-architecture-and-ttsc-guide.md).

## Maintainers

Because custom TypeSpec decorators execute JavaScript, this package is included
in spec-lens's allowlisted runtime and its exact runtime artifact digest is part
of the TypeSpec toolchain fingerprint. Update the package, spec-lens allowlist,
and focused restored-OpenAPI coverage together.
