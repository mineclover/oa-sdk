# OpenAPI Aggregation Governance Plan

> Status: planned. 이 문서는 아직 구현 완료를 주장하지 않는다.
> 구현 완료 항목은 검증 후 [spec.md](./spec.md), [api-index.md](./api-index.md),
> [feature-test-matrix.md](./feature-test-matrix.md)로 승격한다.

## Purpose

oa-sdk는 여러 라이브러리와 시스템이 제공하는 OpenAPI spec, JSON Schema, schema
projection, definition fragment를 수집해 하나의 관리 가능한 OpenAPI artifact로 통합한다.
이 계획은 그 역할을 더 명시적인 product surface로 만들기 위한 기능 묶음이다.

## Current Baseline

이미 구현된 기반은 다음 문서가 SSOT다.

- 개념: [Concepts](../concepts.md)
- 기능 축: [System Capabilities](../concepts/system-capabilities.md)
- 구현 현황: [Spec](./spec.md)
- Definition Builder: [Definition Builder](../concepts/definition-builder.md)
- CLI manifest: [CLI Spec](../cli-spec/README.md)

현재 구현은 Definition Builder target artifact, composition report sidecar,
source provenance map, normalized OpenAPI diff, breaking diff, artifact freshness,
runtime OpenAPI drift with URL fetch, review report, inventory command를 제공한다. 이
계획은 “수집, duplicate review, target coverage”를 별도 기능으로
올리는 단계다.

## Documentation Boundary

| 문서 | 의미 | 허용 내용 |
|---|---|---|
| `*.plan.md` | 구현 전/진행 중 계획 | 목표, phase, 예상 CLI, acceptance criteria |
| `*.todo.md` | 실행 항목 | 체크박스, migration task, 미구현 단계 |
| `spec.md` | 구현 완료 현황 | 실제 동작, 소스 참조, 검증된 명령 |
| `api-index.md` | 공개 API SSOT | export된 함수/타입/CLI surface |
| `feature-test-matrix.md` | 기능 소유권 | 완료된 기능과 보호 테스트 |

구현 완료 전에는 이 문서의 planned 항목을 `spec.md`에 완료 기능처럼 옮기지 않는다.

## Planned Capabilities

### 1. Source Adapter Layer

여러 source를 공통 수집 모델로 정규화한다.

Planned input classes:

- Zod schemas
- Drizzle table schemas
- raw OpenAPI fragments
- standalone JSON Schema files
- Definition Builder fragments
- OpenAPI Projection envelopes
- Python `ContractSpec` snapshots

Expected shape:

```ts
type OpenApiSourceFragment = {
  id: string
  kind: 'schema' | 'path' | 'operation' | 'response' | 'parameter' | 'securityScheme'
  sourcePath?: string
  sourcePointer?: string
  contentHash: string
  content: unknown
  metadata?: Record<string, unknown>
}
```

Acceptance criteria:

- Source adapters produce deterministic fragment ids and content hashes.
- Adapter diagnostics include source file/pointer.
- Adapter output can feed Definition Builder or inventory.
- Existing Zod/Drizzle/codegen behavior remains backward compatible.

### 2. Duplicate Review

중복 후보를 사람이 검토하기 쉬운 report로 만든다.

Implemented CLI:

```bash
oa-gen duplicate-review --fragments packages/schemas/src/fragments --format markdown
```

Report classes:

- duplicate canonical ids
- same content hash with different canonical ids
- same local name with different shapes
- output name collisions
- explicit `semanticAliasOf` pairs

Acceptance criteria:

- The command does not auto-merge definitions.
- Intentional semantic aliases suppress only the intended duplicate warning.
- Report includes source path and canonical id for every entry.

### 3. Target Coverage Gate

target artifact가 기대한 surface를 포함/제외하는지 검증한다.

Proposed CLI:

```bash
oa-gen target-check \
  --target packages/schemas/src/targets/public-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin
```

Generated artifact mode uses the same assertion core:

```bash
oa-gen target-check \
  --artifact packages/schemas/src/.public-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin \
  --format json
```

Acceptance criteria:

- Public target can assert no admin/internal paths are emitted.
- Missing required paths fail with non-zero exit.
- The same check can run against generated target artifact or target config.
- Markdown and JSON reports include every assertion result and failure.

### 4. Review Bundle

PR review에 필요한 report들을 하나로 묶는다.

Proposed CLI:

```bash
oa-gen review-bundle \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml \
  --inventory \
  --composition-report packages/schemas/src/.builder/local-parity-api.composition.json \
  --format markdown
```

Acceptance criteria:

- Bundle includes recommendation first.
- Breaking diff appears before non-breaking changes.
- Artifact freshness, runtime drift, inventory, composition, duplicate review are separate sections.
- JSON output preserves each underlying report without flattening away detail.

## Phase Order

1. Duplicate review command
2. Target coverage gate
3. Review bundle
4. Source adapter formalization

Inventory, composition report, source provenance map, and runtime OpenAPI URL fetch have been
implemented and promoted to `spec.md`, `api-index.md`, and `feature-test-matrix.json`. Source
adapters come later because they stabilize better after provenance and composition report shapes are
proven.

## Promotion Rules

When a phase is implemented:

1. Add or update tests.
2. Add feature ownership to `feature-test-matrix.json`.
3. Add public exports to `api-index.md` if applicable.
4. Move implemented behavior from this plan into `spec.md`.
5. Keep this plan only for unimplemented phases.
6. Remove the plan file when all phases are implemented and represented in `spec.md`.
