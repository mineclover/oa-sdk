# Original User Request

## 2026-09-05T19:00:09Z

Implement and document the missing components identified in the Typia comparative evaluation: Type-level AST tag parsing (`tags.Type<...>`), standalone vs Typia performance benchmark suite, and architectural positioning documentation across `@oa-sdk`.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Typia Type-Level Tag AST Parsing & Bidirectional Sync (`@oa-sdk/codegen`)
Extend `TypiaTypeAdapter` in `packages/codegen/src/ast-sync/adapters/typia.ts`:
- Support TypeScript 5.x intersection type tags: `number & tags.Type<'int32'>`, `number & tags.Minimum<N>`, `number & tags.Maximum<N>`, `number & tags.ExclusiveMinimum<N>`, `number & tags.ExclusiveMaximum<N>`, `string & tags.Format<'uuid'>`, `string & tags.Pattern<...>`, `string & tags.MinLength<N>`, `string & tags.MaxLength<N>`.
- Parse type-level tags from `ts.IntersectionTypeNode` into normalized `PropertyConstraint` records on `EntityPropertySpec`.
- Roundtrip them back into TypeScript interfaces with proper type intersection syntax when writing or patching code, preserving comments and trivia with 100% bitwise invariance across unedited regions.

### R2. End-to-End Validation Engine Performance Benchmark Suite (`@oa-sdk/codegen`)
Implement a comprehensive, reproducible benchmark runner (`packages/codegen/scripts/bench-validation-engines.ts`):
- Compare 3 paradigms on realistic API payloads (small primitives, nested structures, polymorphic discriminated unions):
  1) Raw Zod runtime parsing (`schema.parse` / `safeParse`)
  2) Standalone pre-compiled type guards (`ajv/dist/standalone` ESM)
  3) Typia AOT validation (`typia.is<T>`)
- Measure:
  - Throughput (operations per second, `ops/sec`)
  - Execution latency (mean, median, p99 in microseconds)
  - Zero-eval & Manifest V3 CSP compliance (`oa-gen audit:csp`)
  - Bundle size impact (unminified, minified, gzip KB)
- Add npm script in `packages/codegen/package.json` (`bench:validation`) for standalone execution.

### R3. Architectural Positioning & Comparative Benchmark Report Documentation
Publish normative documentation in `docs/`:
- `docs/benchmarks/validation-engines.md`: Benchmark methodologies, payload specifications, raw results, throughput comparison tables, and bundle footprint analysis.
- `docs/concepts/runtime-and-generation.md` & `docs/guides/schema-architecture-and-conventions.md`: Update with in-depth comparative analysis between Typia (compiler transformer `ttsc`/`ts-patch`) and Standalone Type Guards (zero-dependency static ESM files), detailing trade-offs in build-chain complexity, CSP safety, and runtime speed.
- `docs/internal/platform-scope.md`: Clarify the lifecycle role and design rationale for `@oa-sdk/typia-mock` (maintenance-only boundary to isolate compiler transform complexity while maintaining integration points for Samchon `ILlmApplication` consumers).

## Acceptance Criteria

### AST Type-Level Tagging Conformance
- [ ] `TypiaTypeAdapter.read()` correctly parses type intersection tags (`number & tags.Minimum<10> & tags.ExclusiveMaximum<100>`, `string & tags.Format<'uuid'>`) into `EntityPropertySpec.constraints`.
- [ ] `TypiaTypeAdapter.write()` and patch edits preserve non-Typia comments and trivia while roundtripping type-level tag constraints.
- [ ] Unit test suite in `packages/codegen/test/ast-sync/typia-adapter.test.ts` passes with 100% coverage on type-level tags.

### Benchmark & Performance Conformance
- [ ] Running `pnpm --filter @oa-sdk/codegen bench:validation` (or `pnpm exec tsx packages/codegen/scripts/bench-validation-engines.ts`) executes synchronously across all 3 engines with synthetic realistic payloads and outputs markdown and JSON reports.
- [ ] Standalone type guards demonstrate <0.5ms latency and pass `oa-gen audit:csp` with 0 violations.

### Documentation & Monorepo Integrity
- [ ] `docs/benchmarks/validation-engines.md` is created and indexed in `docs/README.md`.
- [ ] `docs/concepts/runtime-and-generation.md` and `docs/internal/platform-scope.md` are updated with clear architectural positioning.
- [ ] All package unit test suites pass (`pnpm test`).
- [ ] Full monorepo typecheck clean (`pnpm -r typecheck`).

## 2026-09-06T01:08:49Z

Perform deep granular domain analysis across the `oa-sdk` monorepo (17 packages, 5 apps) and construct a modular agent skill architecture under `.agents/skills/` with specialized, deeply actionable skills.

Working directory: /Users/junwoobang/workflow/oa-sdk
Integrity mode: development

## Requirements

### R1. Deep Granular Domain Analysis across 4 Architectural Tiers
- Conduct in-depth source analysis across all 17 packages and 5 applications in `oa-sdk`:
  1. `Core & Codegen`: `@oa-sdk/core`, `@oa-sdk/parser`, `@oa-sdk/codegen` (AST bidirectional sync, Trivia preservation, Type Adapters for Typia, Zod, and TS, `tags.Type<...>` intersection parsing), `@oa-sdk/schemas` (modular OpenAPI 3.1/3.2 bundler).
  2. `Spec-Lens Platform`: `@oa-sdk/spec-lens`, `@oa-sdk/spec-lens-contract`, `apps/spec-lens` (SQLite WAL schema, symbol indexing, projection engine, UI).
  3. `Runtime & Downstream`: `@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, `@oa-sdk/typia-mock` (maintenance boundary).
  4. `TypeSpec & Governance`: `@oa-sdk/typespec-*`, `@oa-sdk/personas` (`packages/personas/src/traits/skill.yaml`), `@oa-sdk/dpm`.
- Extract exact AST patterns, non-obvious invariants, CLI flag signatures (`oa-gen`), and testing requirements for each domain.

### R2. Modular Domain-Specific Skill Architecture (`.agents/skills/`)
- Establish independent, specialized skills under `.agents/skills/`:
  1. `.agents/skills/oa-codegen/SKILL.md`: Deep AST bidirectional sync, trivia preservation rules, Typia AOT tag parsing (`ts.IntersectionTypeNode`), Zod/TS adapters, and `oa-gen audit:csp` zero-eval enforcement.
  2. `.agents/skills/oa-spec-lens/SKILL.md`: SQLite WAL database lifecycle (`.spec-lens.db`), symbol indexing & query APIs, markdown projection, and contract-first architecture.
  3. `.agents/skills/oa-schemas/SKILL.md`: Modular OpenAPI 3.1/3.2 schema fragmentation, bundle/merge algorithms, circular reference resolution, and `oa-gen validate --require-32`.
  4. `.agents/skills/oa-runtime/SKILL.md`: Downstream runtime architecture, route matching, typed client generation, in-memory mock server, and Typia compiler transform isolation.
  5. `.agents/skills/oa-governance/SKILL.md`: API persona capability traits (`skill.yaml`), DPM patterns, Closed-by-Default agent skill governance, and 4-tier build/test verification workflows.
- Each skill must include:
  - Antigravity SKILL frontmatter (`name`, `description`).
  - Clear architectural boundaries and mermaid topology diagrams.
  - Concrete code snippets, CLI recipes, and troubleshooting matrices.

### R3. Closed-by-Default Governance & CI Gate Conformance
- Update `.agents/skills.json` and `.agents/plugins.json` to correctly register and whitelist the modular skills.
- Ensure all skill documentation complies with `@spec-platform/document-gates` (`createAgentConfigGate`, local link gate, CLI example gate).
- Verify `pnpm check:docs` passes with 0 errors across the entire repository.

## Acceptance Criteria

### Skill Modularization & Depth
- [ ] 5 distinct domain skills exist under `.agents/skills/`: `oa-codegen`, `oa-spec-lens`, `oa-schemas`, `oa-runtime`, and `oa-governance`.
- [ ] Each skill provides concrete, non-trivial operational recipes, code examples, and CLI command workflows rather than superficial summaries.
- [ ] AST intersection tag parsing, trivia preservation, and CSP zero-eval rules are thoroughly documented in `oa-codegen`.
- [ ] SQLite WAL schema and query mechanics are explicitly detailed in `oa-spec-lens`.

### Governance & Verification
- [ ] All `SKILL.md` files pass Antigravity frontmatter schema validation.
- [ ] `pnpm check:docs` runs in `/Users/junwoobang/workflow/oa-sdk` and passes with 0 defects.
- [ ] `createAgentConfigGate` passes with 0 violations.
