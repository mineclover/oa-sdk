# Original User Request

## 2026-09-10T22:55:03Z

Implement an OpenAPI 3.2 Schema Object (JSON Schema Draft 2020-12) to Zod 4 code generator (`generateZodFromSpec`) and CLI command (`oa-gen generate:zod`) in `@oa-sdk/codegen`, supporting modern Zod 4 idioms and circular references.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. OpenAPI 3.2 Schema Object to Zod 4 Code Generation Engine
Implement `generateZodFromSpec(doc, options)` and `createZod4Algebra()` in `@oa-sdk/codegen` using `@oa-sdk/parser`'s `foldSchema` architecture, translating OpenAPI 3.2 Schema Objects (Draft 2020-12 dialect) into formatted TypeScript source code with idiomatic Zod 4 syntax.

### R2. OAS 3.2 & Draft 2020-12 Full Vocabulary Support
Support all core OpenAPI 3.2 Schema Object keywords including:
- Numeric exclusive boundaries: `exclusiveMinimum` / `exclusiveMaximum` (strictly numeric) mapped to `.gt()` / `.lt()`
- Tuples & Rest: `prefixItems` mapped to `z.tuple([...])` and rest items
- Discriminator (§4.8.24): `propertyName`, `mapping`, and OAS 3.2 `defaultMapping` mapped to `z.discriminatedUnion(...)`
- Object sealing: `unevaluatedProperties` / `additionalProperties: false` mapped to `.strict()`
- Circular & cross-component references: `#/components/schemas/*` mapped to `z.lazy(() => ComponentSchema)`
- JSDoc / Metadata: `.describe()` for description and `.default()` for default values

### R3. Dual Mode: Static Code Generation & Dynamic Runtime Validator
Provide both:
1. Static `.ts` code emission for build-time compilation and IDE autocomplete.
2. An optional in-memory runtime adapter leveraging Zod 4's native `z.fromJSONSchema` for zero-build testing/mock-server usage.

### R4. CLI Integration & Verification Suite
Expose the generator via `oa-gen generate:zod --spec <path> --output <dir>` and provide comprehensive unit/E2E test suites verifying bidirectional parity, cycle resolution, and downstream schema validity.

## Acceptance Criteria

### AST & Code Generation Parity
- [ ] `generateZodFromSpec` translates OpenAPI 3.2 `components.schemas` into clean TypeScript code targeting Zod 4.
- [ ] Numeric bounds (`exclusiveMinimum: n`) correctly compile to `.gt(n)` instead of legacy boolean flags.
- [ ] `prefixItems` generates `z.tuple(...)` matching Draft 2020-12 tuple semantics.
- [ ] Circular schema references successfully resolve at runtime using `z.lazy()` without recursion errors.
- [ ] `discriminator` with `defaultMapping` synthesizes valid `z.discriminatedUnion()`.

### CLI & Test Suite
- [ ] `oa-gen generate:zod` executes cleanly against local OpenAPI 3.2 specs in `packages/schemas`.
- [ ] Generated Zod 4 schemas pass `tsc --noEmit` and runtime `.parse()` / `.safeParse()` assertions.
- [ ] All new tests in `packages/codegen` pass under `pnpm test`.

## 2026-09-10T23:19:49Z

Implement Phases 2, 3, and 4 of the TypeSpec ecosystem expansion in the oa-sdk monorepo: TypeSpec AST Semantic Diff & Breaking Change Analyzer, Zero-Build Instant Mock Server, and Personas/DPM Native TypeSpec Decorator Integration.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. TypeSpec AST Semantic Diff & Breaking Change Analyzer (Phase 2)
Implement `oa-gen tsp diff` CLI command that parses and compares two TypeSpec AST trees (e.g., base git ref vs head, or two file paths). Detect breaking changes: removed operations, altered HTTP methods/routes, removed/renamed models, removed properties, newly required properties, changed status codes, and changed `@operationId`. Support `--fail-on-breaking` flag to exit with non-zero code for CI gates.

### R2. Zero-Build Instant Mock Server (Phase 3)
Implement `oa-gen mock --tsp <path>` (and watch mode `--watch`) that compiles TypeSpec specifications directly in-memory via `@typespec/compiler` without writing intermediate OpenAPI YAML artifacts to disk. Feed the in-memory schema into `@oa-sdk/mock-server` to serve mock responses with HTTP validation on `localhost:4010`.

### R3. Personas & DPM Native TypeSpec Decorators (Phase 4)
Implement `@personaCapability` and `@pseudonymize` decorators in `@oa-sdk/typespec-decorators` (with TypeScript AST / compiler implementations). Emit OpenAPI extension payloads (`x-oa-sdk-persona-traits`, `x-oa-sdk-dpm-projection`) so that `@oa-sdk/personas` and `@oa-sdk/dpm` pipelines consume contracts directly from TypeSpec definitions.

### R4. Monorepo Governance, CLI Documentation & Gates
Register all new commands in `packages/codegen/src/cli/commands.ts` and document them in `docs/guides/cli-command-reference.md`. Ensure all tests, `pnpm check:docs`, and `pnpm schema:typespec-check` pass with 100% compliance.

## Acceptance Criteria

### Semantic Diff (Phase 2)
- [ ] `oa-gen tsp diff --base <ref> --head <ref>` accurately classifies breaking vs non-breaking changes from TypeSpec AST.
- [ ] Exits with code 1 when breaking changes are detected with `--fail-on-breaking`.
- [ ] Unit and integration tests cover operation removal, field deletion, and newly required fields.

### Instant Mock (Phase 3)
- [ ] `oa-gen mock --tsp packages/schemas/typespec/main.tsp` launches an HTTP server without requiring prior `pnpm build:merged`.
- [ ] Responds to valid mock requests matching schema status codes and example values.
- [ ] File watcher detects `.tsp` modifications and updates in-memory routes without restart.

### Personas & DPM Decorators (Phase 4)
- [ ] `@personaCapability` accepts valid capability traits from `skill.yaml` (rejecting unknown traits).
- [ ] `@pseudonymize` attaches column/field pseudonymization rules into emitted extensions.
- [ ] `pnpm personas:check` and DPM validation gates accept the TypeSpec-emitted extensions.

### Governance & Verification
- [ ] `pnpm check:docs` passes with 0 errors across all gates.
- [ ] `pnpm schema:typespec-check` passes with zero drift.
- [ ] All package test suites pass under `turbo run test`.

## 2026-09-11T02:05:38Z

oa-sdk 모노레포의 4대 핵심 컴포넌트(TypeSpec 인메모리 컴파일/핫리로드, AST Semantic Diff, Zod 4/Codegen 엔진, Mock Server HTTP 처리량)에 대한 정량적 부하 및 성능 벤치마크 테스트를 구축하고, V8 프로파일링을 통해 병목 지점을 정량적으로 식별하여 종합 프로파일링 리포트를 도출합니다.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. 4대 핵심 컴포넌트 종합 벤치마크 스위트 구축
다음 4가지 핵심 파이프라인에 대한 실측 벤치마크 테스트 및 부하 시나리오를 구성하고 실행합니다:
1. **TypeSpec 인메모리 컴파일 & 핫리로드**: Cold compilation 지연 시간, `oldProgram` 재사용 증분 컴파일 지연 시간, 대규모 모델 스펙에서의 컴파일 처리량.
2. **TypeSpec AST Semantic Diff (`oa-gen tsp diff`)**: Git ref 간 및 파일 간 AST 시맨틱 파싱 속도, 대규모(100+ 엔드포인트/모델) 스펙 비교 지연 시간, 비파괴적/파괴적 변경 탐지 처리율.
3. **Zod 4 / Codegen 엔진**: OpenAPI 3.2 스펙으로부터 Zod 4 코드 생성 속도, 순환 참조 DFS 탐색 지연 시간, 대형 스키마 변환 처리율.
4. **Mock Server HTTP 처리량 & 라우팅 지연**: 동시 요청 부하에 따른 QPS(Throughput), p50/p95/p99 응답 지연 시간, 복합 라우트 우선순위 매칭(`compareRouteSpecificity`) 오버헤드.

### R2. 시스템 자원 프로파일링 및 병목 지점(Bottleneck) 식별
1. V8 CPU 프로파일링 및 이벤트 루프 블로킹 함수 분석을 통해 각 파이프라인의 주요 연산 핫스팟을 식별합니다.
2. 장시간 부하 및 반복 컴파일/핫리로드 시의 힙 메모리 추이(Heap Allocation/Retained Memory), 가비지 컬렉션 빈도, 파일 디스크립터(FD) 누수 여부를 점검합니다.

### R3. 정량적 성능 벤치마크 및 병목 분석 리포트 도출
측정된 지표(Throughput, p50/p95/p99 레이턴시, 메모리 델타)와 식별된 상위 병목 지점, 각 병목의 근본 원인 분석, 향후 성능 튜닝 및 최적화 권장사항을 체계적으로 정리한 마크다운 분석 보고서를 작성합니다.

## Acceptance Criteria

### Benchmark Execution
- [ ] 4대 파이프라인(TypeSpec 컴파일, AST Diff, Zod 4 Codegen, Mock Server) 모두에 대해 실측 벤치마크가 정상 실행되어 구체적인 정량적 데이터(ms, ops/sec, QPS)를 산출한다.
- [ ] Mock Server 부하 테스트가 안정적으로 수행되며(에러율 0.1% 이하), p50, p95, p99 지연 시간이 명확히 기록된다.

### Bottleneck & Resource Profiling
- [ ] 반복 핫리로드 및 Mock 요청 시 메모리/FD 누수 없이 자원이 안정적으로 회수됨이 확인된다.
- [ ] V8 CPU 프로파일 또는 타이밍 분석을 통해 각 파이프라인별 상위 병목 함수(Hotspot)와 병목 요인이 구체적으로 명시된다.

### Deliverables & Governance
- [ ] 모든 측정 결과와 병목 분석, 최적화 제안이 포함된 마크다운 보고서가 생성된다.
- [ ] 기존 모노레포 테스트 및 문서 검증(`pnpm check:docs`) 무결성이 유지된다.

## 2026-09-11T02:06:35Z

This is a single self-contained fix; keep it small and focused.
Integrate an automated preflight schema validation/linting and normalization pipeline into `@oa-sdk/codegen`'s Zod 4 generator (`generateZodFromSpec` and `oa-gen generate:zod`), ensuring broken or unnormalized OpenAPI 3.2 specifications are safely validated, normalized, and reported with actionable diagnostics before emitting code.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Preflight Validation & Linting Pipeline in `generateZodFromSpec` & CLI
- Integrate `@oa-sdk/parser`'s `lintDocument` / validation pipeline into `generateZodFromSpec` (`validate?: boolean`, `lintCategories?: LintCategory[]`, `failOnSeverity?: LintSeverity`) and `oa-gen generate:zod` (CLI flags: `--validate`, `--no-validate`, `--lint`, `--force`).
- By default, run preflight validation on critical categories (`structure`, `refs`, `components`).
- When fatal errors (e.g. broken/unresolvable `$ref`, missing schema structure) are detected:
  - Halt code generation immediately (fail-fast) with formatted diagnostic messages pointing to file/pointer coordinates.
  - If `--force` or `--no-validate` is passed, issue warnings to stderr/console and proceed in best-effort mode.

### R2. Automatic Schema Normalization Before Generation
- Before traversing schemas with `foldSchema`, pass the spec document through `normalizeOpenApiDocument` from `@oa-sdk/codegen` to remove collection noise, resolve internal pointer aliasing, sort keys deterministically, and resolve YAML anchors.
- Expose `--no-normalize` / `{ normalize?: false }` option to allow consumers to bypass normalization if desired.

### R3. Programmatic API and Error Structures
- Export `ZodGenerationPreflightError` containing `diagnostics: LintResult[]` so programmatic callers can inspect issues without string parsing.
- Preserve full backward compatibility with all existing `generateZodFromSpec(doc, options)` call signatures.

### R4. CLI UX & Verification Suite
- In `oa-gen generate:zod`:
  - Show clean, actionable console diagnostics when validation issues are encountered.
  - Return exit code 1 on fatal validation errors unless `--force` is provided.
- Comprehensive test suite in `packages/codegen`:
  - Unit tests for preflight validation pass/fail paths in `src/zodgen/`.
  - E2E tests verifying `--validate`, `--no-validate`, `--force`, and `--no-normalize` CLI flags.
  - Adversarial tests with broken refs, missing required components, and unnormalized YAML noise to prove fail-fast and best-effort guarantees.
  - Satisfy monorepo verification gates: `pnpm check:docs`, `pnpm check:cli-spec`, and `pnpm check:api-index`.

## Acceptance Criteria

### Preflight Validation & Normalization
- [ ] `generateZodFromSpec` automatically normalizes input specifications via `normalizeOpenApiDocument` unless `{ normalize: false }` is set.
- [ ] Broken `$ref` or invalid schema structure triggers actionable preflight diagnostics and throws `ZodGenerationPreflightError` (or fails with diagnostic report) when validation is enabled.
- [ ] Passing `{ validate: false }` or `--no-validate` / `--force` bypasses fatal validation stops and attempts best-effort emission.

### CLI Integration
- [ ] `oa-gen generate:zod --spec <broken-spec>` fails with exit code 1 and outputs structured lint diagnostics.
- [ ] `oa-gen generate:zod --spec <broken-spec> --force` emits warnings but attempts code generation.
- [ ] `oa-gen generate:zod --spec <valid-spec>` succeeds cleanly without extraneous noise.

### Test & Monorepo Gates
- [ ] All new tests in `packages/codegen` pass under `pnpm test`.
- [ ] `pnpm check:api-index`, `pnpm check:docs`, and `pnpm check:cli-spec` remain green (0 drift).

## 2026-09-11T04:41:22Z

Incorporate the 5 core type management, AST analysis, and contract provenance improvements inspired by `@samchon` into `@oa-sdk`: Type Shape Taxonomy & Feasibility Diagnostics (`@oa-sdk/ast-sync`), `JsonPrimitive<T>` Wire-Format Safety (`@oa-sdk/client`), `@oaOperation` JSDoc Route Extraction (`@oa-sdk/codegen`), Checker-Resolved Symbol Cycle Detection (`@oa-sdk/ast-sync`), and Transitive `tsconfig` Configuration Universe Digestion (`@oa-sdk/spec-lens`).

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Type Shape Taxonomy & Feasibility Diagnostics (`@oa-sdk/ast-sync` & CLI)
- Implement a type shape taxonomy analyzer in `@oa-sdk/ast-sync` covering 23 TypeScript syntax features (array, conditional, constructor-type, function-type, generic-declaration, generic-instantiation, import-type, indexed-access, inheritance, intersection, literal, mapped, nullable, object, optional, recursive-reference, reference, template-literal, tuple, type-operator, type-query, undefined, union, utility-type).
- Classify type projection feasibility into:
  - `direct`: Suitable for direct OpenAPI 3.2 / TypeSpec schema mapping.
  - `policy-required`: Requires an explicit TypeAdapter authoring policy.
  - `unsupported`: Complex code-level constructs (e.g. conditional, mapped, indexed-access).
- Expose diagnostic reporting and integrate with `oa-gen audit:shape` (or preflight typecheck) so developers receive actionable guidance instead of silent fidelity loss.

### R2. Wire-Format Safety with `JsonPrimitive<T>` / `Resolved<T>` (`@oa-sdk/client` & `@oa-sdk/core`)
- Provide canonical `JsonPrimitive<T>` and `Resolved<T>` recursive utility types in `@oa-sdk/core` that strip functions, methods, getters, symbols, and class prototypes to match pure JSON wire serialization (e.g., `Date` $\rightarrow$ `string`).
- Apply wire-format types to generated client SDK response payloads and parameters in `@oa-sdk/client` to guarantee wire type safety for consumers.

### R3. Zero-Decorator Operation Extraction via `@oaOperation` JSDoc (`@oa-sdk/codegen` & `@oa-sdk/parser`)
- Support explicit `@oaOperation <METHOD> <PATH>` JSDoc tags on exported functions and type aliases to extract OpenAPI 3.2 operations without runtime decorator dependencies or route name guessing heuristics.
- Validate HTTP method syntax (GET, POST, PUT, DELETE, PATCH, etc.) and path coordinates, reporting invalid annotations as structured diagnostics.

### R4. Checker-Resolved Symbol ID Cycle Detection (`@oa-sdk/ast-sync`)
- Upgrade multi-file TypeScript AST synchronization to resolve type aliases and imports to canonical TypeChecker symbol IDs (`symbol.id` via `checker.getSymbolAtLocation` and `checker.getAliasedSymbol`).
- Implement DFS cycle detection across checker-resolved symbols so mutual recursions spanning across module re-exports and aliased imports are detected with 100% precision.

### R5. Transitive `tsconfig` Configuration Universe Hashing (`@oa-sdk/spec-lens`)
- Collect transitive `tsconfig` closures (the active tsconfig, all `extends` chains, project references, and resolved root files) and compute SHA-256 configuration digests.
- Integrate the configuration universe digest into `@oa-sdk/spec-lens` SQLite WAL cache key calculation (`cache-key.ts`) to guarantee automatic cache invalidation when compiler options or base tsconfigs change.

## Verification Resources
- Reference implementations and patterns in `~/workflow/samchon`:
  - `packages/ttsc-contract-provenance/src/contracts.ts` (syntax taxonomy, projection enum, configuration universe)
  - `packages/ttsc-contract-provenance/src/extract.ts` (Checker symbol cycle detection, `@oaOperation` regex)
  - `examples/ttsc-fullstack-workspace/packages/api-sdk/src/Primitive.ts` (wire-safe primitive typing)
- Existing test suites in `@oa-sdk/ast-sync`, `@oa-sdk/codegen`, `@oa-sdk/client`, and `@oa-sdk/spec-lens`.

## Acceptance Criteria

### Type Classification & Diagnostics
- [ ] TypeScript AST type nodes are categorized into `direct`, `policy-required`, and `unsupported` with unit tests covering complex shapes (e.g. `Record<K, V>`, `T[K]`, `T extends U ? A : B`).
- [ ] Unsupported types trigger clear, actionable diagnostic messages with source location pointers.

### Client Wire Safety
- [ ] `JsonPrimitive<T>` strips methods and prototypes and maps `Date` to `string` in TypeScript compiler type tests.
- [ ] `@oa-sdk/client` code generator uses wire-safe response signatures.

### JSDoc Operations & Checker Cycle Detection
- [ ] Functions and type aliases annotated with `/** @oaOperation GET /items */` are extracted into valid OpenAPI 3.2 operations.
- [ ] Aliased re-export cycles across separate files resolve accurately using checker symbol IDs.

### Spec-Lens Cache Invalidation
- [ ] Modifying an extended `tsconfig` file invalidates the `@oa-sdk/spec-lens` cache key.

### Monorepo Gates
- [ ] All new and existing tests pass under `pnpm test`.
- [ ] `pnpm check:api-index`, `pnpm check:docs`, and `pnpm check:cli-spec` pass with zero drift.

## 2026-09-11T05:20:05Z

성능 프로파일링 보고서에서 식별된 3대 핵심 병목 지점(Zod 4 DFS 순환 참조 extractRefs 메모이제이션, Mock Server HTTP 응답/헤더 최적화, AST Semantic Diff 순회 최적화)을 코드 레벨에 직접 구현하고, 벤치마크 재측정을 통해 회귀 없이 정량적 성능 향상을 입증합니다.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Zod 4 DFS 순환 참조 탐색 최적화 (`extractRefs` 메모이제이션)
- `packages/codegen/src/zodgen/generate-zod.ts`의 `findCircularSchemas` 파이프라인에서 각 스키마 객체의 `$ref` 추출 결과를 캐싱(메모이제이션)하여 중복 재귀 순회 오버헤드를 제거합니다 (V8 Self-Time 69.1% 병목 완화).
- 순환 참조 탐색 결과의 의미적 정확성(Semantic Correctness)을 100% 보존합니다.

### R2. Mock Server HTTP 응답 직렬화 및 정적 헤더 프리얼로케이션
- `packages/mock-server/src/adapters/node-http.ts`에서 매 응답마다 발생하는 문자열 포맷팅 및 불필요한 소켓 버퍼 할당(`writeLatin1String`, `writev`)을 최소화하기 위해 공통 헤더(`Content-Type`, `Date` 등)를 프리얼로케이션하거나 직렬화 경로를 최적화합니다.
- 대량 동시 요청 부하 시의 QPS를 극대화하고 응답 지연 시간을 단축합니다.

### R3. AST Semantic Diff 순회 및 상태 검사 최적화
- `packages/codegen/src/cli/lib/typespec-ast-diff.ts`에서 모델 및 프로퍼티 비교 순회 시 참조 검사 오버헤드를 최적화하여 대규모 스펙 대상의 diffing 처리 속도를 향상합니다.

### R4. 성능 재측정 및 회귀 방지 전수 검증
- `pnpm bench:all`을 실행하여 최적화 전/후의 정량적 성능 지표(Throughput, p50/p95 지연 시간, Heap Delta)를 비교 측정하고 보고서에 반영합니다.
- 기존 모노레포 전체 테스트 스위트, 150종 TypeSpec 생태계 E2E 테스트, 그리고 `pnpm check:docs` 문서 게이트가 결함 없이 100% 통과함을 입증합니다.

## Acceptance Criteria

### Optimization Implementation
- [ ] Zod 4 DFS cycle 탐색에 스키마 레벨 참조 메모이제이션이 적용되어 중복 탐색이 제거된다.
- [ ] Mock Server 응답 핸들러에서 헤더/버퍼 직렬화 오버헤드가 단축된다.
- [ ] AST Semantic Diff에서 순회/방문 알고리즘이 효율적으로 최적화된다.

### Empirical Performance Gain
- [ ] `pnpm bench:all` 벤치마크가 정상 실행되며, 최적화 전 대비 주요 지표의 정량적 개선(또는 대등한 수준 이상)이 확인된다.
- [ ] Mock Server 에러율 0.00% 및 FD 누수 0건 불변식이 유지된다.

### Regressions & Governance
- [ ] 모노레포 단위/통합 테스트 및 150종 E2E 테스트가 100% 통과한다.
- [ ] `pnpm check:docs` 및 `pnpm check:cli-spec`이 0 에러로 통과한다.

## 2026-09-12T02:41:06Z

Implement multi-framework backend router stubs (Fastify JIT schema & Bun Elysia context destructuring, plus modernized Hono & Express) with handler contract separation in `@oa-sdk/router`, target-separated interactive onboarding engine (`oa-gen init`) in `@oa-sdk/codegen`, and live OpenAPI/source route hot-reloading (`oa-gen mock --watch`) across `@oa-sdk/codegen` and `@oa-sdk/mock-server`.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Multi-Framework Router Stubs & Handler Contract Separation (`@oa-sdk/router`)
- Deconstruct the monolithic `generate-router-renderer.ts` into a clean, modular topology:
  - `src/contracts/handler-contract.ts`: Generates pure TypeScript handler signatures (`*.contract.ts`) completely decoupled from framework runtime APIs, ensuring developers' business logic is never overwritten when OpenAPI specifications update.
  - `src/targets/{hono,express,fastify,elysia}.ts`: Target-specific framework binders that mount handler contracts to route instances.
  - `src/common/{route-utils,body-parser,querystring-helper,response-headers,jsdoc}.ts`: Shared AST formatting, parameter extraction, and serialization helpers.
- Implement Fastify target (`fastify.ts`):
  - Emits idiomatic `FastifyPluginAsync` module pattern.
  - Inlines OpenAPI 3.2 Schema Objects into Fastify route options `schema: { params, querystring, body, response }` for `fast-json-stringify` JIT serialization acceleration.
- Implement Bun Elysia target (`elysia.ts`):
  - Emits `new Elysia().get().post()` builder method chaining.
  - Utilizes Bun native C++ zero-copy context destructuring (`{ params, query, body, set }`).
- Modernize Hono and Express targets to support binding to the generated handler contract while maintaining backward compatibility with legacy inline stub generation.
- **Zero Framework Runtime Leaks**: `@oa-sdk/router` MUST NOT include `fastify`, `elysia`, `hono`, or `express` in runtime `dependencies`; it remains a pure code string/AST emitter.

### R2. Target-Separated Interactive Onboarding Engine (`oa-gen init`) (`@oa-sdk/codegen`)
- Implement `oa-gen init` in `packages/codegen/src/cli/commands/init.ts` and `packages/codegen/src/cli/lib/init/`.
- Implement Target Strategy Pattern in `packages/codegen/src/cli/lib/init/targets/`:
  - Separate mutually exclusive framework providers: `fastify.ts`, `elysia.ts`, `hono.ts`, `express.ts`, `nestjs.ts`, `generic.ts`.
  - Each target implements `TargetProfile` (`detect`, `generateConfig`, `getRecommendedScripts`, `getRecommendedDependencies`).
  - Strict runtime isolation: Bun/Elysia targets only inject Bun scripts (`bun --watch`, `bun x`) without Node tooling (`tsx`, `nodemon`); Node/Fastify targets inject Node ESM scripts (`tsx watch`) and Fastify-specific `oa.config.ts`.
- Implement common detection and patch engines in `packages/codegen/src/cli/lib/init/common/`:
  - `schema-detector.ts`: Detects `.tsp`, `openapi.yaml`, `openapi.json`, and `@oaOperation` JSDoc annotations independently of backend frameworks.
  - `package-patcher.ts`: Safely parses, merges, and updates `package.json` scripts and devDependencies without clobbering formatting or existing commands.

### R3. Live OpenAPI & Source Route Hot-Reload (`oa-gen mock --watch`) (`@oa-sdk/codegen`)
- Extend `oa-gen mock` so `--watch` functions with `--spec <path>` (OpenAPI YAML/JSON) in addition to `--tsp`.
- Implement `packages/codegen/src/cli/lib/spec-watcher.ts` to monitor OpenAPI specification files and TypeScript source files containing `@oaOperation` JSDoc annotations.
- On file modifications, re-parse the document and invoke `@oa-sdk/mock-server`'s atomic `server.updateSpec(newDoc)` without dropping active sockets or restarting the HTTP server.

## Verification Resources
- Existing router test suite: `packages/router/src/__tests__/generate-router.test.ts`
- Existing mock server hot-swap test suite: `packages/mock-server/src/__tests__/integration/node-http.test.ts`
- Existing CLI commands & spec: `packages/codegen/src/cli/commands/mock.ts`, `packages/codegen/src/cli/spec/cli-spec.json`
- Architecture scope: `docs/internal/architecture/packages.md`, `docs/internal/platform-scope.md`

## Acceptance Criteria

### Router Code Generation & Contracts
- [ ] `generateHandlerContract` emits valid, standalone TypeScript interface definitions matching operations, parameters, request bodies, and responses.
- [ ] Fastify target emits valid `FastifyPluginAsync` with inlined schemas and correct HTTP method bindings (including OAS 3.2 `QUERY`, `HEAD`, `TRACE`).
- [ ] Bun Elysia target emits valid `new Elysia()` chaining with zero-copy context destructuring.
- [ ] Generated Fastify and Elysia router files pass `tsc --noEmit` typechecking when provided dummy handler implementations.
- [ ] `@oa-sdk/router` has 0 framework runtime dependencies in `package.json`.

### Onboarding CLI (`oa-gen init`)
- [ ] `targets/fastify.ts` detects Fastify projects and generates Fastify-optimized `oa.config.ts` and `npm run dev` scripts.
- [ ] `targets/elysia.ts` detects Bun/Elysia projects and generates Bun-native commands without Node.js `tsx`.
- [ ] `common/schema-detector.ts` locates `.tsp`, `.yaml`, `.json` schemas across nested directories.
- [ ] `common/package-patcher.ts` merges scripts into `package.json` non-destructively.

### Live Mock Hot-Reload (`oa-gen mock --watch`)
- [ ] `oa-gen mock --spec spec.yaml --watch` starts a mock server and hot-reloads routes when `spec.yaml` is modified without process restart.
- [ ] Server continues serving requests without socket disconnection during route update.

### Monorepo Governance & Gates
- [ ] All new tests in `packages/router` and `packages/codegen` pass under `pnpm test`.
- [ ] Monorepo integrity gates pass cleanly: `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy`, `pnpm typecheck:all`.

## 2026-09-12T06:25:12Z

Design an end-to-end Project Onboarding & Adoption Playbook and configure a dedicated Agent Skill (`oa-onboarding`) to introduce `oa-sdk`'s core value (zero-value overhead elimination, single-source-of-truth contracts, handler contract separation, and live mock hot-reloading) into external greenfield and brownfield projects.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. 3-Tier Progressive Onboarding Playbook (`docs/guides/onboarding-playbook.md`)
- Author a comprehensive, practical adoption playbook structured around a 3-tier value adoption ladder for both Greenfield and Brownfield codebases:
  - **Tier 1 (Instant Discovery & Zero-Friction Scan)**: 30-second setup using `oa-gen init` for auto-detecting existing frameworks (Fastify, Elysia, Express, NestJS) and schemas with zero architectural changes.
  - **Tier 2 (Contract-First Decoupling)**: Adopting `@oa-sdk/router` handler contract separation (`*.contract.ts` vs framework binders) to isolate business logic from routing plumbing and eliminate overwrite fears.
  - **Tier 3 (Automated Governance & Drift Defense)**: Integrating `oa-gen diff --fail-on-breaking` and live mock hot-reloading (`oa-gen mock --watch`) into team workflows and CI/CD pipelines.
- Include concrete Before/After architecture diagrams and tangible ROI metrics (reduced sync meetings, eliminated duplicate DTOs, zero drift incidents).

### R2. Dedicated Agent Skill Architecture (`.agents/skills/oa-onboarding/SKILL.md`)
- Create a production-grade, authoritative Agent Skill (`oa-onboarding`) following Antigravity / AGY skill specifications:
  - Clear YAML frontmatter (`name: oa-onboarding`, concise description, trigger keywords).
  - Diagnostic decision matrix for classifying target codebases (Runtime: Bun vs Node, Framework: Fastify / Elysia / Hono / Express / NestJS / Generic).
  - Actionable step-by-step agent procedures for executing `oa-gen init`, validating generated `oa.config.ts`, generating contracts, and wiring scripts into `package.json`.
  - Anti-patterns and guardrails (preventing framework runtime leaks, maintaining handler contract purity, avoiding Node tools in Bun projects).

### R3. Skill Synchronization Across Monorepo Skill Catalog
- Update existing core skills (`.agents/skills/oa-runtime/SKILL.md`, `.agents/skills/oa-codegen/SKILL.md`, `.agents/skills/oa-sdk/SKILL.md`):
  - Document Fastify (`FastifyPluginAsync` + inline JIT schema) and Bun Elysia (chaining + context destructuring) router capabilities.
  - Document `oa-gen init` target-separated profile architecture and live mock hot-reload (`oa-gen mock --watch`).
- Update global documentation indices (`docs/guides/quick-start.md`, `docs/internal/plan.md`) to maintain 100% architectural coherence.

### R4. Verification & Governance Gates
- Validate onboarding recipe execution against test reference apps (`apps/nestjs-ref`, sample Fastify/Elysia fixtures).
- Monorepo governance gates pass cleanly: `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy`, `pnpm typecheck:all`.

## Acceptance Criteria

### Onboarding Playbook & User Experience
- [ ] `docs/guides/onboarding-playbook.md` provides clear, copy-pasteable recipes for Fastify, Bun Elysia, Express, and NestJS projects.
- [ ] The playbook explicitly quantifies the elimination of the 5 zero-value management points (sync overhead, overwrite dilemmas, mock delays, framework lock-in, breaking changes).

### Agent Skill
- [ ] `.agents/skills/oa-onboarding/SKILL.md` passes skill syntax standards with complete YAML frontmatter, execution workflows, and troubleshooting matrix.
- [ ] Existing skills (`oa-runtime`, `oa-codegen`, `oa-sdk`) are fully updated with newly implemented capabilities.

### Governance & Monorepo Gates
- [ ] All monorepo governance checks (`pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy`, `pnpm typecheck:all`) pass with zero errors and zero documentation drift.

## 2026-09-12T07:18:45Z

Systematize the `oa-sdk` project onboarding architecture to govern the entire product lifecycle by strictly decoupling **Shared Platform Concepts** (universal contract generation, wire typing, breaking diffs, pure handlers) from **Product-Specific Concepts** (domain archetypes, lifecycle stages, infrastructure bindings, persona traits) within `oa-gen init`, `oa.config.ts`, and `.agents/skills/oa-onboarding`.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Dual-Layer Configuration Architecture in `oa.config.ts` (`packages/codegen/src/config.ts`)
- Establish a formal boundary in `OaConfig` between:
  - **Shared Platform Core (불변 공유 코어)**: Platform-level SSOT contracts (OpenAPI 3.2 dialect, canonical projection contract, typegen rules, pure handler contract generation, CI drift gates).
  - **Product-Specific Domain Layer (제품 특화 확장 레이어)**: Product lifecycle archetype (`mvp` | `microservice` | `enterprise`), domain targets (`ProfileTargetConfig`), security schemes, and persona capability traits (`@oa-sdk/personas`).
- Ensure the configuration schema supports seamless evolution: a project starting as an `mvp` can transition to `microservice` or `enterprise` without modifying its shared core contract.

### R2. Lifecycle Archetype Presets in `oa-gen init` (`packages/codegen/src/cli/lib/init/`)
- Introduce a modular Archetype Engine (`packages/codegen/src/cli/lib/init/archetypes/`):
  - **MVP Archetype (`mvp`)**: Rapid iteration, live mock-first (`mock --watch`), instant client SDK emission, lightweight validation gates.
  - **Microservice Archetype (`microservice`)**: High-throughput runtime optimization (Fastify JIT / Bun Elysia Zero-Copy), strict wire typing (`JsonPrimitive<T>`), automated contract tests.
  - **Enterprise Archetype (`enterprise`)**: Semantic breaking change CI gates (`oa-gen diff --fail-on-breaking`), persona capability traits, multi-target bundle projections, strict preflight schema linting.
- Allow `oa-gen init` to accept `--archetype <mvp|microservice|enterprise>` and prompt for archetype selection during interactive setup alongside framework detection.

### R3. Decoupled Lifecycle Boundary in Handler Contracts & Binders (`@oa-sdk/router`)
- Reinforce the boundary in `@oa-sdk/router`:
  - **Shared Contract Signatures (`*.contract.ts`)**: Pure TypeScript interface signatures representing the wire API contract, completely decoupled from runtime frameworks.
  - **Product-Specific Context Injection**: Support injecting product-level context (tenancy, user session, tracing headers) into handler signatures without polluting the OpenAPI schema definition.

### R4. Systematized Onboarding Skill & Playbook Updates
- Update `.agents/skills/oa-onboarding/SKILL.md` and `docs/guides/onboarding-playbook.md`:
  - Formalize the "Shared vs. Product-Specific" architectural taxonomy.
  - Document the Day 1 Lifecycle Archetype decision matrix (`mvp` vs `microservice` vs `enterprise`).
  - Provide transition runbooks detailing how to evolve a project across lifecycle stages without contract breakage.

### R5. Verification & Governance Gates
- Comprehensive unit and integration test suites in `packages/codegen` testing archetype detection, configuration generation, and script composition.
- Monorepo governance gates pass cleanly: `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy`, `pnpm typecheck:all`.

## Acceptance Criteria

### Config & Archetype Systematization
- [ ] `OaConfig` cleanly isolates shared platform core settings from product-specific lifecycle options with full Zod schema validation.
- [ ] `oa-gen init --archetype <type>` generates tailored `oa.config.ts` and `package.json` scripts matching the selected archetype.
- [ ] Framework targets (Fastify, Elysia, Hono, Express) compose orthogonally with all 3 lifecycle archetypes.

### Skill & Documentation Quality
- [ ] `.agents/skills/oa-onboarding/SKILL.md` provides explicit agent guidance on preserving the shared vs. product-specific boundary.
- [ ] `docs/guides/onboarding-playbook.md` contains the complete lifecycle archetype matrix and evolution runbooks.

### Governance & Monorepo Gates
- [ ] All new tests pass under `pnpm test`.
- [ ] All monorepo governance checks (`pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, `pnpm check:release-policy`, `pnpm typecheck:all`) pass with 0 drift.

## 2026-09-12T16:15:58Z

Implement the Output Path Routing Customization Engine (allowing developers to route generated artifacts to any folder architecture like FSD, DDD, or Monorepo) and the TanStack Query (React Query) v5 3-Tier Option/Key Factory Generator in @oa-sdk/codegen and @oa-sdk/client, and verify end-to-end type parity with @oa-sdk/router.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Developer Output Path Routing Engine (packages/codegen/src/config.ts & path dispatcher)
- Path Routing Sovereignty: Eliminate rigid output directory constraints (src/api/generated/). Allow developers to route generated artifacts (*.contract.ts, *.client.ts, *.queries.ts, *.keys.ts, *.guards.ts) to arbitrary project layouts (Feature-Sliced Design src/features/{tag}/api/, Clean Architecture, DDD, or multi-package monorepos).
- Configuration Schema in OaConfig:
  - Add OutputRoutingConfig schema & type under product.outputRouting (and top-level alias outputRouting):
    1. Template Pattern (pattern): Token substitution supporting {tag}, {kind}, {operationId}, {method}, {group} (e.g. 'src/features/{tag}/api/{tag}.{kind}.ts').
    2. Rule Matcher (rules): Array of conditional matchers matching by tag, pathPrefix, method, kind, or profile to custom output directories.
    3. By-Kind Routing (byKind): Explicit mapping per artifact kind (contract, client, queries, keys, guards, schemas).
- Relative Import Path Resolver (path.relative):
  - When files are routed to different directories or separate packages/apps, dynamically resolve and recalculate TypeScript relative import specifiers (or tsconfig path aliases) so emitted imports compile cleanly without manual intervention.
- Safe File Writing & Orphan Pruning (.oa-manifest.json):
  - Track emitted files in .oa-manifest.json.
  - When the OpenAPI spec changes (renamed tags, deleted endpoints), prune only obsolete generated artifacts.
  - NEVER overwrite or delete hand-written developer files.

### R2. TanStack Query (React Query) v5 3-Tier Code Generator (@oa-sdk/client & @oa-sdk/codegen)
- Implement a 3-Tier client generator architecture avoiding fragile 1:1 hook dumping:
  - Tier 1: Hierarchical Query Key Factory (*Keys):
    - Generates structured, type-safe query key trees (all, lists(), list(filters), details(), detail(id)).
    - Guarantees intuitive, type-safe cache invalidation (queryClient.invalidateQueries({ queryKey: userKeys.lists() })).
  - Tier 2: Pure Query & Mutation Options Factory (queryOptions(), mutationOptions()):
    - Generates pure TanStack Query v5 queryOptions() and mutationOptions() factory functions.
    - Zero UI framework lock-in: directly reusable across React, Vue (@tanstack/vue-query), Svelte, and Next.js App Router Server Components / prefetchQuery().
    - Pure functional layer safe for 100% automated regeneration on spec updates.
  - Tier 3: Client Composition Hook Helpers (Optional Thin Wrappers):
    - Generates ergonomic hooks (use*Query, use*Mutation) wrapping the pure options factories while exposing open generics and options overrides (select, enabled, staleTime, retry).
- Zero Framework Runtime Leaks:
  - @oa-sdk/client MUST NOT add @tanstack/react-query as a runtime dependency. Maintain pure code generation or isolated peerDependencies.

### R3. CLI Integration & Multi-Framework Router Verification (@oa-sdk/router)
- Add CLI command oa-gen generate:tanstack (or integrate --tanstack into oa-gen generate and oa-gen generate:client).
- Update CLI spec manifest (packages/codegen/src/cli/spec/oa-gen-governance.ts and docs/cli-spec/oa-gen.governance.json).
- Verify full-stack contract synchronization:
  - Backend @oa-sdk/router handler contracts (*.contract.ts for Fastify, Elysia, Hono, Express) and frontend TanStack Query 3-tier options share identical wire types and operation parameters generated from the same OpenAPI 3.2 spec.

### R4. Onboarding Playbook & Agent Skill Synchronization
- Update docs/guides/onboarding-playbook.md:
  - Add recipes for Feature-Sliced Design (FSD) routing and Monorepo full-stack distribution (outputRouting).
  - Add TanStack Query v5 3-tier adoption guide and SSR / Next.js hydration recipe.
- Update .agents/skills/oa-onboarding/SKILL.md and .agents/skills/oa-codegen/SKILL.md with output path routing decision guidelines and TanStack Query generator procedures.

### R5. Verification & Monorepo Governance Gates
- Comprehensive test suites:
  - Unit tests for outputRouting path resolution, token replacement, and relative import recalculation.
  - E2E tests generating FSD feature folders and Monorepo distributed files.
  - Unit & integration tests for TanStack Query v5 hierarchical keys, queryOptions(), mutation options, and type safety with tsc --noEmit.
  - Full-stack router contract + TanStack Query client integration test.
- Monorepo governance gates pass cleanly:
  - pnpm check:docs
  - pnpm check:cli-spec
  - pnpm check:api-index
  - pnpm check:release-policy
  - pnpm typecheck:all

## Acceptance Criteria

### Output Path Routing Engine
- [ ] OaConfig supports outputRouting with pattern, rules, and byKind strategies.
- [ ] Relative import paths between generated artifacts in separate directories are automatically and correctly calculated.
- [ ] .oa-manifest.json correctly tracks generated files and safely prunes orphan generated files without deleting manual code.

### TanStack Query v5 3-Tier Generator
- [ ] Emitted query key factories produce hierarchical, type-safe tuples (userKeys.all, userKeys.lists(), etc.).
- [ ] Emitted queryOptions() integrate seamlessly with TanStack Query v5 and compile with tsc --noEmit.
- [ ] Generated options are usable in both SSR prefetching (prefetchQuery) and client hooks (useQuery).
- [ ] @oa-sdk/client maintains 0 runtime dependency leaks on @tanstack/react-query.

### Router Parity & Full-Stack Integration
- [ ] Router handler contracts (*.contract.ts) and TanStack Query options share 100% parameter and response wire typing.

### Governance & Monorepo Gates
- [ ] All new tests pass under pnpm test.
- [ ] pnpm check:docs, pnpm check:cli-spec, pnpm check:api-index, pnpm check:release-policy, and pnpm typecheck:all pass with 0 errors and 0 drift.

## 2026-09-12T17:12:46Z

Update all monorepo documentation and changelogs, execute full-spectrum functional and regression test suites, stage and commit the validated changes, and complete the artifact release preflight and export pipeline.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Documentation, Roadmap, and Changelog Synchronization
- **Root Changelog (`docs/changelog.md`)**:
  - Add comprehensive release entries documenting all newly implemented platform capabilities:
    1. Output Path Routing Customization Engine (`outputRouting` with template pattern, rule matchers, by-kind routing, relative import resolution, and 3-gate orphan pruning) in `@oa-sdk/codegen`.
    2. TanStack Query (React Query) v5 3-Tier Generator (Tier 1 `*Keys` hierarchical key tree, Tier 2 pure `queryOptions`/`mutationOptions` factories, Tier 3 client composition wrappers) in `@oa-sdk/client` and `oa-gen generate:tanstack`.
    3. Multi-Framework Router Stubs (`fastify` JIT inline schema, `elysia` zero-copy context destructuring, `hono`, `express`) and pure handler contracts (`*.contract.ts`) in `@oa-sdk/router`.
    4. Target-Separated Interactive Onboarding Engine (`oa-gen init` with 6 framework targets, 3 lifecycle archetypes `mvp`/`microservice`/`enterprise`, and strict Bun vs Node runtime isolation).
    5. Live Mock Hot-Reloading (`oa-gen mock --watch`) with atomic route swapping.
- **Product Roadmap (`docs/internal/plan.md`)**:
  - Update roadmap status: Mark Phase 2 (Developer Experience & Zero-Friction Onboarding) and Phase 4 (High-Performance Router Stubs & TanStack Query 3-Tier Client) as **Completed (Done ✅)**.
- **Changeset & Package Version Bumping**:
  - Generate changeset for modified release-tracked packages:
    - `@oa-sdk/codegen` (minor: `0.8.0`)
    - `@oa-sdk/client` (minor: `0.2.0`)
    - `@oa-sdk/router` (minor: `0.2.0`)
  - Run `pnpm version-packages` to update package manifests and package-level `CHANGELOG.md` files.
  - Update `docs/internal/release-management.md` package version table to match the bumped versions.
- **Documentation Governance Gates**:
  - Ensure `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, and `pnpm check:release-policy` all pass with 0 errors and 0 drift.

### R2. Comprehensive Monorepo Functional & Regression Testing
- Execute the complete testing hierarchy:
  - Downstream integration tests: `pnpm test:downstream` (`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`).
  - Core platform tests: `pnpm test:core` (`@oa-sdk/core`, `@oa-sdk/codegen`, `@oa-sdk/parser`, `@oa-sdk/spec-lens`, `@oa-sdk/ast-sync`, etc.).
  - E2E testing track: `pnpm test:e2e` and newly implemented suites (`tests/e2e/e2e-output-routing.test.ts`, `tests/e2e/e2e-tanstack-query.test.ts`, `tests/e2e/e2e-router-client-parity.test.ts`).
  - Full TypeScript typecheck: `pnpm typecheck:all` across all 33 workspaces.
  - Full build: `pnpm build:all`.
- Verify 100% test pass rate with 0 regressions.

### R3. Clean Git Commit & Artifact Release Export
- **Clean Git Staging & Commit**:
  - Inspect `git status` to ensure only intended source code, tests, documentation, and package manifests are staged.
  - Create a clean git commit following repository conventions:
    `feat: output path routing, TanStack Query v5 3-tier generator, and multi-framework router stubs`
- **Release Preflight & Artifact Export**:
  - Execute full `pnpm release:preflight` on the clean worktree to verify all 9 release gates.
  - Execute `pnpm release` (`pnpm release:export`) to produce verified release tarballs and provenance manifests in the public release export directory.

## Acceptance Criteria

### Documentation & Versioning
- [ ] `docs/changelog.md` and `docs/internal/plan.md` accurately reflect all newly delivered capabilities and roadmap completion.
- [ ] Changesets created and applied; `@oa-sdk/codegen`, `@oa-sdk/client`, and `@oa-sdk/router` have bumped versions and updated `CHANGELOG.md` files.
- [ ] `docs/internal/release-management.md` version table matches package manifests.
- [ ] `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:api-index`, and `pnpm check:release-policy` pass cleanly with 0 drift.

### Functional Testing
- [ ] All package test suites pass (`pnpm test:core`, `pnpm test:downstream`, `pnpm test:e2e`).
- [ ] `pnpm typecheck:all` passes across all 33 workspaces with 0 errors.
- [ ] `pnpm build:all` succeeds without errors.

### Commit & Release
- [ ] Worktree is committed cleanly with no stray temporary or untracked artifacts.
- [ ] `pnpm release:preflight` succeeds on the clean worktree.
- [ ] `pnpm release` produces valid, consumable release package tarballs with verified integrity hashes.
