# Vision

## One Sentence

oa-sdk는 OpenAPI 3.2 contract를 중심으로 세부 definition fragment와 schema 입력을
조합해 완성된 API artifact를 만들고, validation, code generation, mock/runtime testing,
diff, drift, artifact freshness, review gate를 하나의 폐루프로 연결한다.

## Core Beliefs

1. OpenAPI는 정적 문서가 아니라 실행 가능한 API 계약이다.
2. Source of truth와 generated artifact는 분리되어야 한다.
3. 완성된 OpenAPI는 작은 definition/schema 조각을 조합해 만들 수 있어야 한다.
4. 중복과 이름 충돌은 자동 병합하지 말고 source identity와 output identity를 분리해야 한다.
5. API 변경은 사람이 읽기 전에 기계가 먼저 분류해야 한다.
6. Breaking change, runtime drift, stale artifact는 CI에서 막아야 한다.
7. TS/JS와 Python은 같은 governance vocabulary와 CLI manifest를 공유해야 한다.
8. 각 도구는 독립적으로 쓸 수 있어야 하지만, 함께 쓸 때 계약 폐루프가 닫혀야 한다.

## Primary Workflows

```txt
Author contract
  -> Validate contract
  -> Generate consumers
  -> Test against mock/runtime
  -> Review diff/drift/artifact freshness
  -> Release snapshot/baseline
```

## System Loop

```txt
Drizzle / Zod / OpenAPI fragments / Definition Builder fragments / Pydantic DTOs
  -> OpenAPI or ContractSpec source of truth
  -> target-specific OpenAPI assembly
  -> deterministic generated artifacts
  -> typegen / router / client / mock server
  -> runtime and artifact drift checks
  -> review report
```

## Product Boundaries

oa-sdk is:

- an OpenAPI 3.2-first contract toolchain
- a parser/builder that combines modular schema and definition inputs into OpenAPI artifacts
- a code generation bridge from contract to consumers
- a mock/test runtime for contract behavior
- a governance toolkit for diff, drift, freshness, and review
- a cross-language vocabulary shared by TS/JS and Python templates

oa-sdk is not:

- a replacement for application business logic
- a source of truth for database internals
- a place to manually patch generated artifacts
- a framework runtime by itself

## Design Principles

1. **Contract first**: API-facing behavior is described as contract data before it is consumed by generators.
2. **Modular assembly**: complete OpenAPI artifacts can be built from smaller schema, path, operation, response, and security definitions.
3. **Identity separation**: source canonical identity and output component names are different concerns.
4. **No silent dedupe**: duplicate ids and output collisions are diagnostics, not hidden merges.
5. **Generated artifacts are disposable**: regenerate instead of manually editing.
6. **Deterministic output**: stable diffs are a product feature.
7. **Reviewable changes**: diff and review reports should be readable without inspecting raw OpenAPI.
8. **Drift is a failure mode**: runtime, artifact, docs, and manifest drift need explicit checks.
9. **Language-neutral governance**: shared manifest and vocabulary come before per-language CLI details.
10. **Incremental adoption**: teams can start with validation or typegen and add stronger gates later.

## Reference Map

- Terms: [Concepts](./concepts.md)
- Feature axes: [System Capabilities](./concepts/system-capabilities.md)
- Current implementation: [Spec](./internal/spec.md)
- Roadmap: [Plan](./internal/plan.md)
- CLI manifest: [CLI Spec](./cli-spec/README.md)
- Tests and ownership: [Feature Test Matrix](./internal/feature-test-matrix.md)
