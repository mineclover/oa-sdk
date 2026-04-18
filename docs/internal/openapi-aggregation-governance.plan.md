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

현재 구현은 Definition Builder target artifact, normalized OpenAPI diff, breaking diff,
artifact freshness, runtime OpenAPI drift, review report를 제공한다. 이 계획은 “수집,
provenance, inventory, composition, duplicate review, target coverage”를 별도 기능으로
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

### 2. Source Provenance Map

OpenAPI artifact의 path/component가 어떤 source에서 왔는지 추적한다.

Expected output:

```json
{
  "#/paths/~1users/get": {
    "sourcePath": "packages/schemas/src/fragments/path/public/users/UsersPath.yaml",
    "sourcePointer": "#/content/get",
    "canonicalId": "path:public/users/UsersPath",
    "contentHash": "sha256:..."
  }
}
```

Acceptance criteria:

- `oa-gen build-spec` can emit a provenance sidecar.
- `oa-gen review` can include changed provenance entries.
- Provenance is stable across repeated builds.
- Provenance never replaces OpenAPI artifact content.

### 3. Inventory Command

전체 API surface를 빠르게 요약한다.

Proposed CLI:

```bash
oa-gen inventory --spec packages/schemas/src/.merged.yaml --format markdown
oa-gen inventory --spec packages/schemas/src/.merged.yaml --format json
```

Report sections:

- path count
- operation count
- component counts by section
- tag/domain grouping
- security scheme summary
- target/source summary when provenance exists
- unused component candidates

Acceptance criteria:

- JSON output is stable and machine-readable.
- Markdown output is compact enough for PR comments.
- Inventory can read plain OpenAPI documents and target artifacts.

### 4. Composition Report

Definition Builder가 무엇을 선택하고 조합했는지 sidecar로 출력한다.

Proposed CLI:

```bash
oa-gen build-spec \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --composition-report packages/schemas/src/.builder/local-parity-api.composition.json
```

Report sections:

- direct path ids
- direct retained definition ids
- transitive component ids
- omitted node counts by scope/domain/kind
- output aliases
- collision report
- source refs

Acceptance criteria:

- Composition report is emitted only from builder data, not by re-parsing output OpenAPI.
- Report links selected output paths/components to canonical ids.
- Report is included in review bundle when present.

### 5. Duplicate Review

중복 후보를 사람이 검토하기 쉬운 report로 만든다.

Proposed CLI:

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

### 6. Target Coverage Gate

target artifact가 기대한 surface를 포함/제외하는지 검증한다.

Proposed CLI:

```bash
oa-gen target-check \
  --target packages/schemas/src/targets/public-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin
```

Acceptance criteria:

- Public target can assert no admin/internal paths are emitted.
- Missing required paths fail with non-zero exit.
- The same check can run against generated target artifact or target config.

### 7. Runtime OpenAPI Fetch

`oa-gen drift`가 file path뿐 아니라 runtime OpenAPI URL도 받을 수 있게 한다.

Proposed CLI:

```bash
oa-gen drift \
  --runtime-openapi-url http://localhost:3000/openapi.json \
  --managed-openapi packages/schemas/src/.merged.yaml
```

Acceptance criteria:

- URL fetch failure is reported as drift-check-failed.
- Redirects and non-2xx responses are visible in JSON output.
- File path behavior remains unchanged.

### 8. Review Bundle

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

1. Inventory command
2. Composition report sidecar
3. Source provenance map
4. Runtime OpenAPI URL fetch for drift
5. Duplicate review command
6. Target coverage gate
7. Review bundle
8. Source adapter formalization

Inventory comes first because it needs only the existing parser and gives immediate visibility into
path/component surface. Source adapters come later because they stabilize better after provenance and
composition report shapes are proven.

## Promotion Rules

When a phase is implemented:

1. Add or update tests.
2. Add feature ownership to `feature-test-matrix.json`.
3. Add public exports to `api-index.md` if applicable.
4. Move implemented behavior from this plan into `spec.md`.
5. Keep this plan only for unimplemented phases.
6. Remove the plan file when all phases are implemented and represented in `spec.md`.
