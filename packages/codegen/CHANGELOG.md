# @oa-sdk/codegen

## 0.11.0

### Minor Changes

- 020ec12: Isolate API, data-only and interface pipelines with an optional shared purpose contract.
  Preserve previous output on plugin diagnostic failures and fail Vite startup builds correctly.
  Use standalone schema validation for plugin guards, align generated declaration names, provide
  self-contained guard types and reject conflicting schemas across targets. Add in-memory guard
  rendering for composition without disk writes. Existing configurations without purpose retain
  their mixed-pipeline behavior.

  Harden schema-name escaping, dollar-sign guard identifiers and split-file collision allocation
  (including case-insensitive filesystems). Reject custom declaration names without a matching
  external type module before replacing output.

- 702034d: Add the OAS 3.2 → Pydantic v2 generation surface: the `generate:pydantic` CLI command, `buildPydanticModels` API and staged functions, the `pydantic` TypeSpec plugin, semantic options and presets, and a build report for Phase 1 `components.schemas` output. The guide is `docs/guides/pydantic-codegen.md`.
- 3feed48: Pydantic code generation now collects deterministic OpenAPI operations into the resolved IR, including merged parameters, request and response schemas, operation naming diagnostics, and the public split or single layout and operation emission options.
- 92482cc: Improve Pydantic generation quality with encoded scalar decoding, model extension metadata, configurable docstrings and frozen models, and clean ruff and pyright output.
- d452aad: Add deterministic Pydantic operation models and metadata for split and single layouts, JSON media type diagnostics, and opt-in exact validation for discriminator-less `oneOf` unions.
- b6152a8: Pydantic generation now emits precise multipart, form, text, binary, streaming item, and discriminated envelope types, with deterministic media metadata in `OPERATIONS`.
- debb1de: Preserve Pydantic schema metadata and prove normalized OpenAPI round-trip parity for generated types, including titles, URI formats, ECMA pattern provenance, and calendar-unit duration diagnostics.

### Patch Changes

- Updated dependencies [020ec12]
- Updated dependencies
  - @oa-sdk/ast-sync@0.3.0
  - @oa-sdk/typespec-decorators@0.5.0

## 0.10.0

### Minor Changes

- 8a06e73: Let `oa-gen typegen` write a TypeSpec origin graph semantic index.

  Pass `--typespec-provenance <json> --graph-semantic-index <json> --graph-file <project-relative>` together with `--output`. Each generated declaration becomes a host with the owning TypeSpec declaration's `.tsp` file and line as evidence, and the sidecar is hash-bound to the generated TypeScript, the restored OpenAPI document and the provenance. `typegen` fails without writing either output when the provenance describes another document or leaves a generated declaration without an owner. With `--incremental`, the index is its own generation target and is reused or regenerated together with the types.

  The new surface is `buildTypeSpecGeneratedGraphSemanticIndex()`, `TYPESPEC_TS_GRAPH_SEMANTIC_SCHEMA`, `typeSpecGraphProvenanceSchema` and the `GeneratedTypeDeclaration`/`TypeSpecGraphProvenance` types.

- 1f37428: Make the TypeSpec plugin pipeline (`@oa-sdk/codegen/plugin`) generate code that compiles as documented, and stop its `clean` from deleting directories outside the project. Review the items marked **behavior change** when upgrading.

  - `runTspPluginPipeline` `clean` removes only a real strict subdirectory of the working directory or the OS temp directory. It never removes the working directory, its ancestors, or a directory that is or contains the TypeSpec entrypoint, and reports `TSP_CLEAN_SKIPPED` instead. It used to remove any path that contained `dist`, `generated`, `tmp` or `temp`, inside the project or not. `builder.build({ outputDir })` is honored instead of writing to and cleaning `./src/generated`.
  - **Behavior change:** when `pluginClient` ran in the same pipeline and `clientFile` is unset, `pluginTanstackQuery` emits `api-client.ts` with the `<clientName>` interface, `create<clientName>()`, `<clientName>CallOptions` and `<clientName>ResponseError`, and `queries.ts`/`hooks.ts` import it; the new `clientAdapter` and `adapterOutput` options turn it off or move it. A 2xx resolves to `data`, a failure with a declared JSON error model rejects with the parsed body, and every other failure rejects with `<clientName>ResponseError` (`status`, `body`, `response`). The TanStack modules used to import an `ApiClient` that `pluginClient` never emitted. Non-split tiers `options` and `hooks`, in the plugin and in `oa-gen generate:tanstack --tier`, write self-contained combined code.
  - **Behavior change:** in the generated `client.ts`, `<Fn>Errors` aliases `<Base>ErrorByStatus` and `isErrorStatus` narrows per status (`KnownErrorStatus` and `ErrorStatusResult` are exported). Request headers are `Record<string, unknown>`, serialized in OpenAPI simple style, and `clientClass: false` keeps a module-private transport and compiles. The axios transport reads text and parses bodies like the fetch transport, so an empty body gives `undefined` instead of `''`, and 204/205/304 responses get a null body. An operation whose function name would be a reserved word, a module binding or another operation's name gets a `_` suffix (`delete` becomes `delete_`), and such a short name is not emitted (`Pets_delete` gives only `petsDelete`). Self-referential and duplicate type aliases are no longer emitted.
  - `TspProjectBuilder.build()` always recompiles, and `cwd` also applies to `introspect()` and `watch()`. `vitePluginTsp` builds once on dev startup, honors `runOnDev: false`, resolves a relative config against Vite's root, and reports a failed rebuild through the logger and the error overlay instead of a full reload. The default `//` banner is added only to JS/TS, `.proto` and `.jsonc` files, so JSON output stays valid. `pluginWire` always imports `BinaryCodecAdapter` and refers to models by their `types.ts` names, and the reserved `raw-binary` codec reports `WIRE_CODEC_NOT_IMPLEMENTED`.
  - New exports from `@oa-sdk/codegen/plugin`: `readClientSdkManifest`, `CLIENT_SDK_MANIFEST_KEY`, `ClientSdkManifest`, `RenderedClientOperation`, `absolutizeTspInput`, `TypeSpecCompilationError`, `isTspPluginEntry`, `DEFAULT_GENERATED_BANNER`, `VitePluginTspResolvedConfig`, `VitePluginTspDevServer` and `VitePluginTspErrorPayload`. `TspWatchEvent` gains `error`, and `RunTspPluginPipelineOptions` gains `oldProgram`.

- 4538f7c: Make the Protobuf codecs of `ProtobufCodecTargetAdapter` (`pluginWire` codec `protobuf`) lossless and wire-compatible with the `.proto` schema that `Proto3TargetAdapter` emits, verified against protobufjs in both directions.

  - Nested messages and repeated messages are length-delimited submessages. They were written as `Number(value)`, which threw for every model with a nested object (7 of the 16 schema examples of the production contract).
  - Component enums travel as member numbers and decode back to their JSON values. Objects with only `additionalProperties` of a scalar, enum, or message type become `map<string, V>`. Unions, anonymous objects, and nested arrays are sent as JSON text in a `string` field instead of `String(value)` (`"[object Object]"`).
  - Scalars use their real wire types: 64-bit varints for negative and large values, zigzag for `sint32`/`sint64`, 4-byte `float` / `fixed32` / `sfixed32`, 8-byte `fixed64` / `sfixed64`. 64-bit values decode to `number` when safe and to `bigint` otherwise. Integers outside their type's range, non-integers, and unknown enum values throw instead of being truncated. `format: byte` strings travel as raw bytes and decode back to base64.
  - Repeated numeric and enum fields are written packed, and both packed and unpacked forms are read. Unknown fields are skipped; truncated input throws `RangeError`; decoded map keys cannot change object prototypes; required lists and maps decode as empty when absent.
  - `extractWireSchemaFromOas` classifies each field (`kind`: `scalar`, `enum`, `message`, `map`, `json`, with the new `WireFieldKind` and `WireMapValue` types), records enum JSON values in `WireEnum.literals`, maps integer formats (`int8`–`int32` → `int32`, `uint8`–`uint32` → `uint32`, `uint64`), and maps unformatted integers to `int64` instead of `int32`. Automatic field numbers skip numbers declared explicitly and the reserved 19000–19999 range.
  - The `.proto` output references nested types by their message name (including service method input and output), emits `map<>` fields, keeps comments on one line, sanitizes identifiers (with `json_name` when a field name changes), and prefixes enum member names that would clash across enums in the package scope.

- 9743fb4: Add `oa-gen ref-projection`, which exports the ref-preserving `$ref` graph of an OpenAPI document as the versioned JSON artifact `oa-sdk.ref-projection.v1` (registered as `experimental` in the artifact compatibility policy).

  - Nodes are the reusable declarations of the entry document and the external targets its `$ref`s reach. Each resolved `$ref` occurrence whose occurrence and target both lie inside a node is one edge, marked `none`, `guarded` or `unguarded` recursion; every other occurrence is named by a diagnostic.
  - With `--provenance <map written by oa-gen build-spec --provenance>`, each node carries the `canonicalId` of its nearest enclosing provenance entry and its fragment `sourcePath` relative to the project root, or the reason it has none.
  - The output has no timestamps, is sorted, and is validated against its JSON Schema before it is written. The same codegen version writes byte-identical output for inputs with the same bytes at the same project-root-relative paths.
  - The library exports `createRefProjectionArtifact`, `serializeRefProjectionArtifact`, `validateRefProjectionArtifact`, `REF_PROJECTION_SCHEMA_VERSION`, `REF_PROJECTION_ARTIFACT_SCHEMA_V1` and their types; `docs/cli-spec/oa-sdk.ref-projection.v1.schema.json` mirrors the schema.

  Provenance maps read by `oa-gen ref-projection`, and by `oa-gen review` and `oa-gen review-bundle` through `--base-provenance` and `--head-provenance`, now reject an entry whose `canonicalId` is empty.

- f0edbd0: Make Interface Sketch parsing, trace graphs and the contract canary match the source they read. Review the items marked **behavior change** when upgrading.

  - `@oa-sdk/surface-ir` **behavior change:** `INTERFACE_SKETCH_IR_VERSION` is `oa-sdk.interface-sketch-ir.v2`. `InterfaceSketchIr` has a required `diagnostics: SketchDiagnostic[]` and `SketchUnionOrEnumIr` a required `members: SketchVariantIr[]`; `SketchModelIr` gains `templateParameters`, and `baseModel` also covers `extends` and keeps template arguments. `versionHash` values change. The parser is a tokenizer and recursive-descent scanner, so `extends`, templated and `is X;` models and bodies with nested braces are no longer dropped or truncated, and doc comments and decorators attach only to the declaration that follows them.
  - `@oa-sdk/codegen`: `emitSketchArtifacts` accepts a v2 or a v1 IR, upgrading the v1 one, and throws for any other version. Emitted OpenAPI refs point to `#/components/schemas/`, enums carry their values instead of their member names, unions become `anyOf`, undeclared types are tagged `x-oa-sdk-sketch-unresolved-type`, and the Python stub uses `@dataclass(kw_only=True)` (Python 3.10+) so it imports whatever the field order. `oa-gen sketch verify` and `check-contract` use the domain (`--domain`, else the file basename) as the spec name, so `versionHash` no longer depends on the machine, and `verify`, `emit`, `check-contract` and `compare` exit 1 when the IR has error diagnostics. The CLI governance manifest declares the sketch report schema `oa-sdk.interface-sketch-ir.v2`.
  - `@oa-sdk/codegen`: `oa-gen trace` links path-item-level `parameters` `$ref`s to every operation of the path, includes the generated `*PathParams`, `*QueryParams` and `*HeaderParams` symbols of `$ref` parameters, and reads `x-persona` arrays and object-shaped storage, behavior and DPM refs. **Behavior change:** `SpecTraceGovernanceCapabilities` has a required `personas: string[]` (`persona` is deprecated), and interface operation ids are qualified as `operation:<file>:<Interface>.<op>`, with a new `typespec-provenance/duplicate-declaration-id` diagnostic. The spec, provenance map and manifest inputs of `oa-gen trace` are validated, and `loadSpecTraceabilitySidecar` validates the whole sidecar.
  - `@oa-sdk/ast-sync`: `checkImplementationContract` counts a contracted name only when the file binds it. Comments, strings, call sites, property reads and plain imports of an operation no longer count. It honors `language` (`'auto'` detects Python), no longer treats TypeScript `#private` member lines as comments, and matches lock-reflex patterns only in code.

- 4538f7c: Project TypeSpec/OpenAPI operations onto typed RPC procedures.

  - `@oa-sdk/surface-ir`: `buildRpcContract(document, options?)` and `toRpcContract(ir, document, options?)` produce the JSON contract `oa-sdk.rpc-contract.v1`. Each operation becomes a dotted-name procedure (`@rpc` service/method names, else the camel-cased first tag and the operationId) with one object input that merges its parameters and request body, its success output, declared error responses, and the HTTP binding needed to rebuild the REST request. Streaming operations are skipped with a warning; collisions are reported as diagnostics.
  - `@oa-sdk/codegen`: `pluginRpc()` and `generateRpcModule(contract, options?)` emit a module with the `<Name>Procedures` type map and the `<name>Contract` data.
  - `@oa-sdk/rpc` (new, private): `createRpcClient` / `createRpcServer` with JSON-RPC 2.0 (`createJsonRpcTransport`, `createJsonRpcFetchHandler`, `handleJsonRpc`) and REST binding (`createHttpTransport`, `createRestFetchHandler`) transports, `createLocalTransport`, `RpcError`, and an Ajv validator at `@oa-sdk/rpc/ajv`.

- 4538f7c: Fix the clients that `RpcContractTargetAdapter` (the `rpc-contract` codec of `pluginWire`) generates.

  - Path, query, header, and cookie parameters are now part of the generated methods (`method(request, params, options)`, or `method(params, options)` without a body) and fill the declared route. Path-level parameters and route variables without a declaration are included; `.` and `..` path values are rejected. Server handlers receive `params` as a third argument when a method has parameters.
  - Request and response bodies follow their declared media types: JSON is serialized directly, and Protobuf / MessagePack messages are encoded and decoded with the `codecs` option, now a model-name → `BinaryCodecAdapter` map (or an array of maps), such as `getGeneratedProtobufCodecs()`. A binary message without a codec fails before the request is sent. Previously the body was passed to `fetch` unserialized and every response was parsed as JSON.
  - Failed calls reject with the exported `WireRpcError` (`method`, `status`, decoded `body`).
  - `extractWireSchemaFromOas` infers `wireFormat` from the declared media types (`json` when nothing binary is declared) instead of always `protobuf`, picks the lowest 2xx response, and adds `parameters`, `requestBody`, and `response` to each `WireMethod` (new `WireParameter`, `WireParameterLocation`, `WirePayload` types).
  - Without `typesImport`, model references in the generated module are typed `unknown` instead of naming types that are not imported. Descriptions are emitted through the escaping JSDoc formatter.

- 0f84ddf: Extract complete wire schemas from composed, map-shaped and namespaced models. **Behavior change:** regenerate `.proto` files and codecs together after upgrading, because field numbers and default names can change.

  - `extractWireSchemaFromOas` merges `allOf` members (inline objects and component `$ref`s), so TypeSpec `extends` models keep their inherited fields. Automatic field numbers are assigned after the explicit ones, inherited fields first, so an inheriting model without `@field` numbers can get other numbers than an earlier version generated. Duplicate or invalid explicit `x-oa-sdk-protobuf-field` numbers (outside 1–536870911, or in the reserved 19000–19999) throw.
  - Default service, tag and method names use `pascalCase` from `@oa-sdk/core` (`TodoItems_list` becomes `TodoItemsList`, not `TodoItemslist`). Map-only and free-form object components become `kind: 'object'` models with a MessagePack codec and a TypeScript type but no `.proto` message or Protobuf codec, instead of empty messages that dropped their content. `WireModel.tsTypeName` and `WireEnum.tsTypeName` hold the `types.ts` names, which the generated Protobuf, MessagePack and RPC TypeScript now uses, so models in sub-namespaces compile.
  - Generated Protobuf decoders fill absent required scalar and enum fields with their proto3 defaults. The synthetic empty message is named `Empty` unless a model, enum or service already uses that name, and `Empty2`, `Empty3` and so on otherwise (`emptyMessageName` and `WireNameScope` are exported). The generated RPC client rejects an empty path value (`''`, `[]`) with a `TypeError` before the request.
  - `Proto3TargetAdapter` honors its `emitEmptyMessage` constructor default. `TypeSpecWirePipeline` treats a string as a path only when it has no newline, `;` or brace and ends in `.tsp` or exists on disk, instead of whenever it contains `model`, `service` or `namespace`, and gains `extractModelFromFile` and `extractModelFromSource`.

### Patch Changes

- 6239a85: Make `pluginClient` generate a compiling `client.ts` when operation type names or `clientName` collide with names the module declares or refers to.

  - **Behavior change:** a per-operation type in `client.ts` (an import from the types file such as `<Base>Response`, or a declared `<Fn>Data`, `<Fn>Response`, `<Fn>Errors`, `<Fn>ErrorUnion` or fallback) whose name is a type `client.ts` declares (the client class, `RequestParameters`, `RequestOptions`, `KnownErrorStatus`, `ClientResult`, `ClientResponse`, `ErrorUnion`, `ErrorStatusResult`, `ClientConfig`) or a global type it refers to gets a `_` suffix (then `_2`, ...), like operation function names. A root-level operation `client` has its response type as `ClientResponse_` in `client.ts` (imported as `ClientResponse as ClientResponse_` and re-exported, or declared as `void` without a success response), and `ClientResponse` stays the generic helper. The types file is unchanged. Before, the import clashed with the helper or the `void` fallback duplicated it, and `client.ts` did not compile.
  - **Behavior change:** `pluginClient({ clientName })` reports a `CLIENT_INVALID_CLIENT_NAME` error diagnostic and emits no `client.ts` (nor the `client:sdk` manifest) when `clientName` is not an identifier, is a reserved word or a TypeScript predefined type name, is another name `client.ts` declares (`createClient`, `client`, `ClientConfig`, ...), is a global it refers to (`fetch`, `Response`, `Record`, ...), or is a name it binds where it refers to the class (`TData`, `TError`, `config`). Before, such a name declared a class that shadowed the global or clashed with the helper. A `clientName` named like an operation function or type is accepted, and the operation name is escaped instead.

- fe143f7: Improve the onboarding path.

  - `oa-gen init` now adds `@types/node` at `^22.0.0`, matching the Node.js 22 floor the packages require (it added `^20.0.0` before), and prints the install and `generate` steps after the summary.
  - Loading an `oa.config.ts` that imports a package the project has not installed now appends an install hint to the error, instead of only the bare `Cannot find package` message.

- c565468: Make `oa-gen typegen` emit a compiling declaration for a recursive map schema.

  - **Behavior change:** a component schema that is a recursive map (`type: object` with `additionalProperties` that refers back to the schema, directly or around a cycle) was emitted as `export type Node = Record<string, Node>`, which TypeScript rejects with TS2456 ("Type alias 'Node' circularly references itself"). It is now emitted as an index-signature object type (`export type Node = { [key: string]: Node }`, or `export interface Node { [key: string]: Node }` under `--style interface`). Non-recursive maps keep the shorter `Record<string, T>` spelling.

- 791657c: Report a `typegen --incremental` run with `--graph-semantic-index` as regenerating both outputs when only the index needs a fresh generation. Because the index is derived from the declarations of a fresh generation, the types are regenerated too; the command no longer prints `typegen up to date, regeneration skipped` for the types and then rewrites them.
- 3063402: TanStack options/keys now work for Vue and Svelte, streaming operations no longer emit unusable cache artifacts, and guard generation accepts dotted TypeSpec contract names.

  **@oa-sdk/client**

  - Tier 2 (pure query/mutation options) imports the framework-neutral `QueryObserverOptions`,
    `MutationObserverOptions` and `InfiniteQueryObserverOptions` types that every TanStack adapter
    re-exports from `@tanstack/query-core`, instead of React-only `UndefinedInitialDataOptions` /
    `UseMutationOptions`. `generate:tanstack --framework vue|svelte` output now compiles.
  - Streaming operations (SSE, NDJSON, JSONL, `application/stream+json` in the response or request
    body) keep their query keys but no longer generate `QueryOptions`, `MutationOptions` or hooks,
    because a `queryFn` returning an `AsyncGenerator` cannot be cached.
  - Infinite query options use a distinct key (`[...<listKey>, 'infinite']`). List and infinite
    caches with the same filters no longer collide, and invalidating the list key still matches the
    infinite entry by prefix.
  - `TError` for operations with a documented error model is now `<Op>Error | Error`, so transport
    failures (network errors, aborts, `ApiClientResponseError`) are part of the generated type.

  **@oa-sdk/codegen**

  - `generate:tanstack --split --tier options|hooks` emits the lower tiers the requested tier imports
    (`options` → keys + queries, `hooks` → keys + queries + hooks), so the output compiles.
  - `generate:tanstack --framework vue|svelte --tier hooks` fails with a clear error instead of writing
    React hooks against a Vue/Svelte package.
  - `check-artifact` and `drift:check` read targets through `resolveConfigWithDefaults`, so a config
    that declares only `product.specs` no longer fails with `specs 목록이 비어 있습니다`.
  - Added a regression test for pattern-based `outputRouting` with `--split`, resolving every generated
    relative import against the routed files.

  **@oa-sdk/ast-sync**

  - Standalone guards normalize component names that are not JavaScript identifiers (for example the
    TypeSpec namespace-qualified `OaSdkTypeSpec.StandardError` to `isOaSdkTypeSpec_StandardError`)
    while keeping the qualified type in the `data is ...` declaration. Split mode uses the normalized
    file name and imports the namespace root (`import type { OaSdkTypeSpec }`) because
    `import type { A.B }` is invalid TypeScript. `--schemas` matching accepts the original dotted name.

- e4e82a7: Shared `@traceId` variants are accepted as lineage, ast-sync type boundaries are modelled, and Fastify/Hono streaming is verified with the real frameworks.

  **@oa-sdk/typespec-decorators**

  - `@traceId` now emits `x-oa-sdk-trace.declarationId` next to `trackingId`. It is a hash of the
    declaration the application is written on, so visibility variants and `MergePatchUpdate<T>`
    clones (and shared parameter/anonymous types and derived scalars) carry the same evidence.
  - The `.tsp` documentation and README describe the shared-variant policy instead of listing it as
    a known defect that fails `oa-gen trace --verify`.

  **@oa-sdk/codegen**

  - `buildSpecTraceabilityGraph` accepts one explicit `trackingId` when every node has the same
    `declarationId`; an id shared by independent declarations, or without evidence, still reports
    `traceability/duplicate-tracking-id`.
  - The trace sidecar validator accepts the optional `declarationId` field.

  **@oa-sdk/ast-sync**

  - JSON Schema `read()`/`patch()` validate parsed input through `toJsonSchemaObject` /
    `parseJsonSchemaObject`; typia `@default` tags go through `parseJsonDefaultTag`.
  - Replaced the remaining explicit `any` escapes: TypeScript's internal `symbol.id` and declaration
    names have modelled accessors, virtual-program temp directories live in a `WeakMap` exposed by
    `getProgramTempDir`, and Ajv/standalone imports plus format validators are typed.

  **@oa-sdk/spec-lens-contract**

  - Added `customData?: Record<unknown>` to `ScenarioMachineContext` in `scenario.tsp`, matching the
    TypeScript interface, with a drift test.

  **@oa-sdk/router**

  - Added real Fastify 5.12 / Hono 4.12 streaming tests: `AsyncIterable`, Web `ReadableStream` and
    Node streams send with the declared content type, and client disconnects cancel the source
    iterator. Documentation now describes the verified behaviour instead of the retired defects.

- Updated dependencies [9743fb4]
- Updated dependencies [fadcf07]
- Updated dependencies [3063402]
- Updated dependencies [f0edbd0]
- Updated dependencies [e4e82a7]
- Updated dependencies [f0edbd0]
- Updated dependencies [4538f7c]
  - @oa-sdk/parser@0.5.0
  - @oa-sdk/surface-ir@0.2.0
  - @oa-sdk/ast-sync@0.2.1
  - @oa-sdk/typespec-decorators@0.4.0

## 0.9.0

### Minor Changes

- `oa-gen init` writes `@oa-sdk` dependency specifiers the project can install: `workspace:*` only when the project and the package are members of the same pnpm workspace, otherwise the range of the release this codegen was built against (`^<version>`). `@oa-sdk/personas`, which is private, is added only inside a workspace that contains it, and `init` says when it leaves it out.
- `oa-gen init` lists the companion packages its scaffold needs (`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`). `mock`, `generate:client`, `pack:client`, `generate:tanstack`, and `oa-gen generate` for explicitly enabled outputs exit with an install command pinned to the companion versions this codegen was built against instead of silently skipping the output.
- `oa-gen init` then reports every `@oa-sdk` entry of package.json that the project cannot install where it lives, with what to do about it, instead of leaving it unreported or printing "not added" for it. A `workspace:` entry outside a pnpm workspace that has the package, such as one an earlier `init` wrote, is to be replaced with the range `init` prints (`--force` does this for the packages `init` writes). `@oa-sdk/personas` outside a workspace that has it is to be removed whatever its specifier: no registry has it, and `--force` leaves the entry in place because `init` no longer writes it.
- `oa-gen mock` runs without `msw`, an optional peer of `@oa-sdk/mock-server` that neither the package manager nor `oa-gen init` installs. It loads the root of `@oa-sdk/mock-server`, which does not load the MSW adapter: that adapter imports `msw` and is exported only from `@oa-sdk/mock-server/adapters/msw` and `@oa-sdk/mock-server/browser`. While the root still re-exported it, `oa-gen mock` failed on a clean install with `Cannot find package 'msw'`.
- Without `--tsp` and `--spec`, `oa-gen mock` serves the spec target of the project configuration, compiling a `.tsp` schema entry as `--tsp` does. The `mock` script that `oa-gen init` adds (`oa-gen mock --watch`) now starts a server; before, it exited 1 asking for `--tsp` or `--spec`. A configuration with several spec targets, or none, still needs one of the options.
- `oa-gen validate` without `--spec` reads the spec targets with their configuration defaults, as `oa-gen generate` does. A target without `profile`, which `oa-gen init` writes, is validated as a `full-api-document` instead of failing with `openapi-projection/invalid-profile`, so the `validate` script of an init scaffold passes, and `product.specs` is used when `specs` is absent.
- A TypeScript configuration written as an ES module, like the `oa.config.ts` that `oa-gen init` writes, loads in a project whose `package.json` has `"type": "commonjs"`, which `npm init` writes since npm 11. Node loaded the file as CommonJS, and every command that reads the configuration (`generate`, `validate`, `generate:tanstack` and the others) failed with "Cannot use import statement outside a module". Such a file is now transpiled to a temporary ES module first; a configuration written as CommonJS still loads natively.
- `oa-gen typegen --incremental` now reuses earlier output. Before, an incremental run parsed, generated and wrote everything again. typegen keeps one record per target (command, entry spec and output destination) in the SQLite workspace index (`--cache-dir`, default `./.oa-cache`) and skips regeneration when all of these are unchanged:

  - the installed versions of the generator packages (codegen, parser, core and yaml, plus `@typespec/compiler` and `@typespec/openapi3` for a `.tsp` entry);
  - `--style`;
  - every input the previous run consumed: the entry spec and every external `$ref` document by content (a document that was missing is recorded as absent, so creating it invalidates the target), and for a `.tsp` entry every file the TypeSpec compiler read, whether each path it probed while resolving imports was a file, a directory or missing, where links resolved, and the module graph of the JavaScript decorator libraries it loaded (authored modules by content and import resolution, installed packages by their `package.json`, failed optional imports by the candidates Node checked);
  - the output: a file output must still exist with the recorded hash. A stdout output and the warnings of the recorded run are replayed from the record.

  A reused run does not parse or compile the spec and leaves the workspace index unchanged. Every incremental run prints one status line on stderr: `incremental: typegen up to date, regeneration skipped (<output>)` or `incremental: typegen regenerating (<reason>)`. An input that may have changed while typegen generated, or that a run cannot check again, is recorded as unverified and makes the next run regenerate (`input not verified: <path> (<reason>)`); before Node.js 22.15, a target with authored JavaScript decorators therefore regenerates every time. Files that decorator code reads by itself are not tracked. When the SQLite index is unavailable, typegen regenerates (`incremental state unavailable`).

  The records live in two new workspace index tables, `generation_targets` and `generation_target_observations`. They are additive: the index schema version is unchanged, older readers ignore them, and a compatibility reset clears them with the rest of the cache.

- `oa-gen typegen` and `oa-gen validate` without `--incremental` no longer scan the entry spec for a workspace index they do not use.
- New `oa-gen surface --spec <openapi|typespec>` builds the target-neutral surface IR of the new `@oa-sdk/surface-ir` dependency and writes `surface-ir.json`, the Forge projection, one OpenAPI Overlay per top-level Forge command and `surface-manifest.json` to `--out-dir` (default `artifacts/surface/forge`). It accepts `--target forge` (the only target), `--mapping <json|yaml>` for operation group, method, lifecycle and CLI overrides, and `--fail-on-warning`.
- Normalization (`normalizeOpenApiDocument()`, `oa-gen normalize`, `oa-gen collect`) handles a node that the input shares at several locations, for example through YAML aliases, at every location: noise removal and key ordering apply at each, and the output keeps the input's sharing, cycles included. Before, only the first location was normalized. `upgradeOpenApiDocumentTo32()` (`oa-gen upgrade`, `oa-gen collect`) reports a conversion at every location of a shared container instead of only the first.
- `zodToSchema()` expands only the root of a conversion and emits `$ref: '#/components/schemas/<name>'` for every registered schema below it, so its result no longer depends on earlier conversions or on component order. A registered schema used at several locations is referenced at each instead of being inlined at the first, and `generateComponents()` and `adaptZodSchemas()` no longer emit a self-reference such as `Id: { $ref: '#/components/schemas/Id' }` for a component first met inside another one.
- TypeSpec reference provenance attributes emitted enum components to their `enum` declarations.
- Faster startup and generation: the TypeSpec compiler and TypeScript load only in the commands that use them, `oa-gen generate` parses each projected spec once, and `audit:csp` skips files that cannot violate its rules.
- `oa-gen tsp diff` with a git ref that has no path (`--base origin/main --head HEAD`) reads the other side's repository-relative entry point from its own commit. Before, it re-read the base extraction, compared the base with itself, printed "No semantic changes detected" and let `--fail-on-breaking` pass. When the entry point cannot be determined (missing from that commit, or several `main.tsp` files), the command fails and asks for `<ref>:<path>`; when both sides resolve to the same commit and entry point it says so on stderr. Symbolic links in a working-tree entry keep their names, so each commit resolves them itself; a `<ref>:<path>` or committed link that leaves the repository is rejected.
- `oa-gen drift`, `oa-gen drift:live` and `oa-gen review` accept relative paths. Before, a relative `--managed-openapi`, `--runtime-openapi` or `--base` exited 1 with `Invalid behavior record: ... must match between input and target` even when nothing differed. Relative paths resolve from the project root, and reports and behavior records hold absolute paths. A missing or doubled runtime source is reported as a usage error.
- `oa-gen generate` honors `outputRouting.pruneOrphans: false` and, with pruning on, deletes only orphaned files its own runs recorded in `.oa-manifest.json` for the same configuration file (or, with `--spec`, the same spec file). It no longer deletes `oa-gen generate:tanstack` output or files from other configurations or spec files. Manifest records gain optional `producer`, `configFile`, `specFile` and `target` fields (records from before 0.9.0 are attributed to configuration runs by spec target id), `OaManifestManager.writeArtifacts` records `producer: "unspecified"` when none is given, and the new `PruneOrphansOptions.scope` limits what a `pruneOrphans` call may delete.
- `oa-gen generate` exits 1, writing no files and leaving `.oa-manifest.json` unchanged, when an output the configuration turns on explicitly (`core.contracts.pureHandlers: true`, `core.client.enabled: true`) throws during generation. An output that is only on by default is skipped with a warning naming the error. The summary counts operations instead of paths and prints the version the document declares (for example `OpenAPI 3.2.0`) instead of a fixed "OpenAPI 3.1"; the schema pipeline report header does the same, and `SchemaPipelineTransparencyManifest.stages.stage3_openApi31.specVersion` is now a `string` holding the projected documents' versions.
- `oa-gen init` writes only scripts that run as written. Every target gets `generate` and `mock`, and `mvp` adds `validate`. The `generate:router`, `generate:client` and `generate:contract` aliases are gone (they only ran `oa-gen generate`); `microservice` no longer adds `test:contract` or `audit:wire`; `enterprise` replaces `diff`, `ci:gate`, `lint:spec`, `audit:csp`, `audit:shape` and `personas:check` with `lint:spec`, `diff`, `baseline:update` and `ci:gate` on the spec entry point, compared against a committed `openapi.baseline.yaml` that init creates with `oa-gen normalize` and never overwrites. On a package.json from an earlier init, init lists each retired script that still has the earlier command, with the reason and what to do (`InitResult.retiredScripts`). An upper-case `.yaml`/`.yml`/`.json` spec extension is recognized.
- `oa-gen normalize` reads TypeSpec (`.tsp`) specs. `oa-gen normalize` and `oa-gen diff` copy in the files a spec's `$ref`s name, so a breaking change in a referenced file fails `diff --fail-on-breaking`, and `oa-gen diff` compares the operations of a `paths` entry that is a `$ref` to `#/components/pathItems/...`.
- `oa-gen generate`, `oa-gen generate:tanstack` and `oa-gen mock` resolve the `$ref`s of a spec that point into other files (`./schemas.yaml#/Health`, `./paths/user.yaml`) from the spec file, as `oa-gen generate:client` does, before the router, client and mock-server companions read the spec, and `oa-gen generate` looks for CRDT entities in the resolved schemas. Before, the companions received those references unresolved and rejected the spec (`requires complete $ref resolution; received a partial ParsedDocument: unsupported-ref (./schemas.yaml#/Health)`), so these commands produced no handler contracts, client SDK, TanStack Query options or mock server for a spec split across files, and `generate` left out the four CRDT modules, without a warning, for a CRDT entity whose `components.schemas` entry is a `$ref` to its schema in another file. A `$ref` that still cannot be resolved, such as one to a missing file or a cycle of references, fails the same way, and the error names it with its diagnostic code (`external-ref-read-failed (./missing.yaml#/Health)`, `ref-cycle (./a.yaml#/A)`); `generate` exits 1 for an output the configuration turns on explicitly. The new `oa-gen surface` resolves them the same way before it builds the Surface IR, so the operations of a path item in another file are projected, and exits 1 with the `surface-ir/incomplete-document` error when one cannot be resolved. The `<id>.openapi.json` and `<id>.schema.json` that `generate` writes keep the `$ref`s as the spec writes them, relative to the spec file.
- The `N ops` of the `oa-gen generate` summary counts the operations of the spec the generators read, with its `$ref`s into other files resolved, so a path item in another file (`/users/{id}: { $ref: './paths/user.yaml' }`) adds its operations. Before, the summary counted the document as written and left them out. A document the parser cannot read, such as one with a `null` entry in `tags`, is still counted as written, so the count never fails the run. The `operationCount` of `projectTargetSpec()` and of the `executeSchemaPipeline()` report still counts the document as written.

### Patch Changes

- b4f5dd4: @oa-sdk/parser: `loadSchema()` now builds its `RouteIndex` with the same route indexer as `parseDocument()`, so both return the same routes.

  These changes apply to every document, including fully dereferenced ones on the default pipeline:

  - `loadSchema()`, which `@oa-sdk/mock-server` re-exports, now indexes OAS 3.2 `additionalOperations` and copies operation `x-*` extensions onto route entries.
  - In both `loadSchema()` and `parseDocument()`, an `additionalOperations` entry is now ignored when it repeats a method that the same Path Item defines as a fixed field. The method names are compared case-insensitively. Code generated from `parseDocument()`, such as typegen output and generated clients and routers, no longer includes that entry.

  The following changes only affect documents that still contain Reference Objects at operation positions (Path Item, parameter, requestBody, response, callback) after the pass pipeline. What happens to them depends on whether a pass of the pipeline resolves `$ref`s. `SpecPass` has a new optional `resolvesRefs` flag for this. `createDerefPass()` sets it, so `derefPass`, the default passes and the deref pass that `parseDocument()` builds from its options have it. Set it on a custom pass that resolves references, for example one that wraps `derefSpec()`.

  Before this change, the two entry points handled such references differently, whatever the pipeline:

  - `parseDocument()` resolved a parameter or response `$ref` one hop against the entry document, without `summary`/`description` overrides, and dropped it when that hop found no object. It dropped requestBody `$ref`s and every Path Item that has a `$ref`, including the operations declared beside it. It kept callback Reference Objects as written.
  - `loadSchema()` returned parameter, requestBody, response and callback Reference Objects as written. Several `$ref` parameters collapsed into one entry under the merge key `undefined:undefined`. For a Path Item with a `$ref`, it indexed only the operations declared beside the `$ref`.

  With a pass that resolves `$ref`s, a reference left at an operation position is one the pass could not resolve, such as an external file without `basePath`, a missing target or a cycle. Route entries now omit it.

  - The reference keeps the spelling of the file it was written in. With `basePath`, that can be an external file that the pass inlined, so resolving it against the entry document could return an unrelated object with the same pointer.
  - This includes the default pipeline. `loadSchema()`, which `@oa-sdk/mock-server` re-exports, no longer returns Reference Objects in `parameters`, `requestBody`, `responses` or `callbacks`, and `parseDocument()` no longer returns callback Reference Objects. To detect references that stayed unresolved, check `parseDocument(...).resolution`: its status is `partial` and its diagnostics list the unresolved `$ref` values.
  - Fields declared beside a Path Item `$ref` that could not be resolved still apply.

  Without such a pass, for example with a custom pass list like `[]`, local references at operation positions are now resolved by following the reference chain, and the overrides below apply.

  - At parameter, requestBody, response and callback positions, the `$ref` is an OAS 3.2 Reference Object. Only a `summary` or `description` beside it overrides the target, and only when the target's object type defines that field: `description` for parameters and request bodies, both for responses, neither for callbacks. Other sibling fields are ignored.
  - Fields declared beside a Path Item `$ref` overlay the referenced Path Item.
  - A reference that cannot be resolved locally (an external file, a missing target, a cycle) is omitted at parameter, requestBody, response and callback positions.
  - When a Path Item `$ref` chain cannot be followed to its end, the fields declared beside every `$ref` up to the failing hop still apply, and the outermost wins. The deref pass keeps the same fields, so both pipelines index the same operations.

  References that the default pipeline's deref pass resolves are not affected by these changes. That pass resolves them before indexing and still merges every sibling field into the target.

  `derefSpec()`, `DerefFolder` and the deref pass, which `@oa-sdk/mock-server` re-exports, now dereference the fields beside a `$ref` they cannot resolve, as `derefInternalSpec()` already did. The `$ref` itself stays as written. Before, the whole object was kept as written, so, for example, the operations declared beside an unresolvable Path Item `$ref` kept their own parameter, requestBody, response and callback references unresolved. Inside an external file, those fields resolve against that file.

  @oa-sdk/codegen: `generateTypesFromSpec()`, used by `oa-gen typegen` and `generate-client --pack`, parses with `parseDocument(spec, [])`. Its output changes in the following cases.

  Local references at operation positions:

  - A `$ref` requestBody now emits `<Op>Body` and a `body` field on `<Op>Op`. Whether the body is required comes from the referenced request body.
  - A Path Item `$ref` in `paths` or `webhooks` now emits the operation types of the referenced Path Item.
    - Operations, `parameters` and other fields declared beside the `$ref` replace the referenced ones.
    - Operations declared beside a Path Item `$ref` that cannot be resolved, such as one into another file, are now emitted too. This includes the operations declared beside every `$ref` of a Path Item `$ref` chain whose later hop cannot be followed. Before, the whole Path Item was skipped.
  - A `description` beside a parameter `$ref` now replaces the referenced description in the generated JSDoc.
  - A parameter or response `$ref` whose target is itself a Reference Object is now followed to the final target. The parameter field and `<Op>Response` are now emitted.
  - A callback `$ref` is now resolved. Typegen emits no callback types, but nested component schema references inside the referenced callback, such as `#/components/schemas/Pet/properties/owner`, now get exported alias declarations. Inline callbacks already got them.
  - Other fields beside a Reference Object, such as `required`, `name`, `in`, `schema` or `content`, are still ignored and do not change the generated types.

  Other changes:

  - An `additionalOperations` entry that repeats a fixed-field method of the same Path Item no longer emits operation types.
  - An exported name that typegen numbered or renamed to avoid a collision can now refer to a different operation or schema. Typegen numbers operation types in sorted `operationId` order and nested schema aliases in sorted reference order, and it renames external schema aliases that collide with operation type names. The cases above add or remove operations and nested schema references, which changes those collisions. For example, when an ignored `additionalOperations` entry has an `operationId` with the same type name as the fixed operation, the fixed operation's types can lose their numeric suffix and take the names the ignored entry had.

  `generateTypesFromSpec()` from `@oa-sdk/codegen/typegen/browser` parses with the browser `parseDocument()`, which resolves internal references in memory before indexing. Of the changes above, only the `additionalOperations` rule, the operations beside an unresolvable Path Item `$ref`, and the resulting name changes affect it.

  For local references at operation level (a Path Item under `paths` or `webhooks`, and an operation's parameters, requestBody and responses) that carry no fields other than `summary` and `description`, the generated `types.ts` now declares the operation types that the generated client imports for them.

  The generated client and `types.ts` can still disagree in these cases:

  - References nested inside those objects, such as a response header `$ref` or an OAS 3.2 media-type `$ref` under `content`. Typegen does not resolve them, so the client can import `<Op>ResponseHeaders`, `<Op>Body` or `<Op>Response` without `types.ts` declaring it.
  - Operation-level references into other files, which typegen does not resolve either.
  - Fields other than `summary` and `description` beside a parameter, requestBody or response Reference Object. `generateClient()` parses with the default deref pass, which still merges every such field into the target, while typegen ignores them.
    - `in: header` beside a `$ref` to a query parameter makes the client import `<Op>HeaderParams`, which `types.ts` does not declare.
    - A `content` sibling that adds `application/json` to a request body without a JSON media type makes the client import `<Op>Body`, which `types.ts` does not declare.
    - `required: true` beside a parameter `$ref` makes the client reject calls without that parameter, while `types.ts` keeps it optional.

    This lasts until the deref pass applies only `summary` and `description` at Reference Object positions.

- Updated dependencies
- Updated dependencies
- Updated dependencies [b4f5dd4]
- Updated dependencies
  - @oa-sdk/core@0.3.1
  - @oa-sdk/parser@0.4.0
  - @oa-sdk/typespec-decorators@0.3.0
  - @oa-sdk/surface-ir@0.1.1

## 0.8.1

### Patch Changes

- Resolve 9 platform deficiencies across router envelope defense, handler error typing, AbortSignal pass-through, infinite queries, monorepo import resolution, RouterRenderOptions typing, unified oa-gen generate pipeline, init outputRouting presets, and Linux file watching fallback.

## 0.8.0

### Minor Changes

- - @oa-sdk/codegen: Add Output Path Routing Customization Engine (`outputRouting`), Target-Separated Interactive Onboarding Engine (`oa-gen init`), TanStack Query generation CLI (`oa-gen generate:tanstack`), and Live Mock Hot-Reloading (`oa-gen mock --watch`).
  - @oa-sdk/client: Implement TanStack Query (React Query) v5 3-Tier Generator (Tier 1 hierarchical query keys, Tier 2 pure options factories, Tier 3 client composition wrappers).
  - @oa-sdk/router: Implement multi-framework router stubs (Fastify JIT schema, Elysia zero-copy context, Hono, Express) and decoupled handler contracts (`*.contract.ts`).

## 0.7.0

### Minor Changes

- - @oa-sdk/core: Introduce recursive `JsonPrimitive<T>` and `Resolved<T>` wire-format types stripping methods, getters, and symbols to guarantee JSON wire safety.
  - @oa-sdk/parser: Add zero-decorator `@oaOperation <METHOD> <PATH>` JSDoc route extraction (`extractTsOperationsFromSource`, `extractTsOperationsFromFile`).
  - @oa-sdk/codegen: Implement OpenAPI 3.2 Schema Object to Zod 4 generator (`generateZodFromSpec`, `oa-gen generate:zod`) with automated preflight validation/normalization, and add `oa-gen audit:shape` CLI for 24-feature TypeScript shape taxonomy auditing.
  - @oa-sdk/client: Apply wire-safe response payload signatures using `Resolved<T>`.
  - @oa-sdk/spec-lens: Add transitive `tsconfig` universe dependency digestion (`computeTsconfigUniverse`) and SQLite cache key invalidation.

### Patch Changes

- Updated dependencies
  - @oa-sdk/core@0.3.0
  - @oa-sdk/parser@0.3.0

## 0.6.0

### Minor Changes

- Harden public OpenAPI generation and release tooling. Core now exposes safe
  TypeScript literal helpers; parser adds OAS 3.2 querystring support and stricter
  reference handling; codegen improves generated client/type output and fails
  closed when TypeSpec export would lose contract-bearing semantics.

### Patch Changes

- Updated dependencies
  - @oa-sdk/core@0.2.0
  - @oa-sdk/parser@0.2.0

## 0.5.0

### Minor Changes

- e0f2d5b: Prepare the OA Gen CLI and its runtime dependency closure (including the TypeSpec decorator
  library required by provenance tooling) for public npm distribution,
  including explicit package boundaries, Node runtime requirements, and a packed-artifact smoke test.

### Patch Changes

- Updated dependencies [e0f2d5b]
  - @oa-sdk/core@0.1.2
  - @oa-sdk/openapi-projection-contract@0.1.2
  - @oa-sdk/parser@0.1.2
  - @oa-sdk/typespec-decorators@0.1.2
  - @oa-sdk/client@0.1.1
  - @oa-sdk/router@0.1.1
