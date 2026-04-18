# Vision

## One Sentence

oa-sdk는 OpenAPI contract를 API 개발의 중심 산출물로 두고, authoring, validation,
code generation, mock/runtime testing, diff, drift, artifact freshness, review gate를
하나의 폐루프로 연결한다.

## Core Beliefs

1. OpenAPI는 정적 문서가 아니라 실행 가능한 API 계약이다.
2. Source of truth와 generated artifact는 분리되어야 한다.
3. API 변경은 사람이 읽기 전에 기계가 먼저 분류해야 한다.
4. Breaking change, runtime drift, stale artifact는 CI에서 막아야 한다.
5. TS/JS와 Python은 같은 governance vocabulary와 CLI manifest를 공유해야 한다.
6. 각 도구는 독립적으로 쓸 수 있어야 하지만, 함께 쓸 때 계약 폐루프가 닫혀야 한다.

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
Drizzle / Zod / OpenAPI fragments / Pydantic DTOs
  -> OpenAPI or ContractSpec source of truth
  -> deterministic generated artifacts
  -> typegen / router / client / mock server
  -> runtime and artifact drift checks
  -> review report
```

## Product Boundaries

oa-sdk is:

- an OpenAPI 3.2-first contract toolchain
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
2. **Generated artifacts are disposable**: regenerate instead of manually editing.
3. **Deterministic output**: stable diffs are a product feature.
4. **Reviewable changes**: diff and review reports should be readable without inspecting raw OpenAPI.
5. **Drift is a failure mode**: runtime, artifact, docs, and manifest drift need explicit checks.
6. **Language-neutral governance**: shared manifest and vocabulary come before per-language CLI details.
7. **Incremental adoption**: teams can start with validation or typegen and add stronger gates later.

## Reference Map

- Terms: [Concepts](./concepts.md)
- Feature axes: [System Capabilities](./concepts/system-capabilities.md)
- Current implementation: [Spec](./internal/spec.md)
- Roadmap: [Plan](./internal/plan.md)
- CLI manifest: [CLI Spec](./cli-spec/README.md)
- Tests and ownership: [Feature Test Matrix](./internal/feature-test-matrix.md)
