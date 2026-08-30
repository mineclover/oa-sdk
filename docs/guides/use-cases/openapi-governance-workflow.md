# Use Case: OpenAPI Governance Workflow

> OpenAPI artifact를 만들고, path/component surface와 source metadata를 검토하고, PR에 올릴
> review bundle까지 생성하는 운영 흐름.

이 문서는 oa-sdk source checkout을 기준으로 한다. 시작 전에 `pnpm build:core`를 실행하고,
아래 command는 shell PATH의 `oa-gen`이 아니라 built
`node packages/codegen/dist/cli/index.js` entrypoint로 호출한다.

## 언제 쓰는가

다음 상황에서 이 흐름을 사용한다.

- Definition Builder target artifact를 PR에서 검토해야 할 때
- public/admin/internal target이 의도한 path만 포함하는지 CI에서 막고 싶을 때
- fragment duplicate, source provenance, output name collision을 사람이 리뷰해야 할 때
- runtime OpenAPI와 managed OpenAPI drift를 PR evidence로 남겨야 할 때
- diff, freshness, inventory, composition, duplicate review를 하나의 PR comment로 묶고 싶을 때

## 입력과 출력

| 종류 | 예시 | 역할 |
|---|---|---|
| Managed OpenAPI | `packages/schemas/src/.merged.yaml` | 현재 canonical validation input |
| Target config | `packages/schemas/src/targets/local-parity-api.yaml` | Definition Builder target selection input |
| Fragments root | `packages/schemas/src/fragments` | canonical source fragment collection |
| Generated artifact | `packages/schemas/dist/openapi.yaml` | checked/generated artifact freshness 대상 |
| Runtime OpenAPI | `http://localhost:3000/openapi.json` | runtime drift 대상 |
| Review outputs | `artifacts/*.json`, `artifacts/*.md` | PR evidence |

Generated artifact는 직접 고치지 않는다. stale이면 source를 고치고 다시 생성한다.

여러 서비스에 반복 적용할 때는 [OpenAPI Governance Service Template](../openapi-governance-service-template.md)을
서비스별로 복사해 baseline, runtime URL, target, fragments, path gate를 먼저 고정한다.
Path fragment folder와 path 기반 feedback 좌표는 [Path Fragment Conventions](../path-fragment-conventions.md)를 따른다.

## 1. Target artifact와 sidecar 생성

`build-spec`는 target OpenAPI artifact와 machine-readable sidecars를 함께 만든다.

```bash
mkdir -p artifacts/openapi-governance

node packages/codegen/dist/cli/index.js build-spec \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --output artifacts/openapi-governance/local-parity-api.yaml \
  --diagnostics artifacts/openapi-governance/local-parity-api.diagnostics.json \
  --collision-report artifacts/openapi-governance/local-parity-api.collisions.json \
  --composition-report artifacts/openapi-governance/local-parity-api.composition.json \
  --provenance artifacts/openapi-governance/local-parity-api.provenance.json \
  --metadata-registry artifacts/openapi-governance/local-parity-api.metadata.json
```

Sidecar 의미:

- `diagnostics.json`: fragment parse, registry, target selection, emit validation diagnostics
- `collisions.json`: target-local output name allocation report
- `composition.json`: direct paths, retained definitions, transitive components, omitted counts, source refs
- `provenance.json`: emitted OpenAPI pointer → canonical id/source path/source pointer/content hash
- `metadata.json`: emitted OpenAPI pointer → internal metadata, logical identity key, stable key, tracking id, source refs, example pointers

`diagnostics.json`에 error가 있으면 output artifact는 쓰지 않는다.
Metadata registry의 stable key는 canonical id와 operation method 같은 logical slot에서 생성되므로 content/path/output name 변경에도 유지된다. Tracking id나 stable key가 중복되면 diagnostics에 error로 남고 output artifact는 생성하지 않는다.
Canonical id rename은 fragment `metadata.replaces`에 이전 canonical id를 선언해 추적을 이어간다. Output pointer 충돌이나 invalid tracking id도 diagnostics와 metadata sidecar에 함께 남긴다.
`schemaVersion`은 sidecar JSON 구조 버전이고, `oa-meta:v1:{digest}`의 `v1`은 stable key 생성 알고리즘 버전이다. JSON 구조 변경과 key algorithm 변경은 독립적으로 관리한다.

## 2. Surface inventory 확인

Inventory는 전체 API surface를 PR comment에 넣기 좋은 형태로 요약한다.

```bash
node packages/codegen/dist/cli/index.js inventory \
  --spec artifacts/openapi-governance/local-parity-api.yaml \
  --format markdown

node packages/codegen/dist/cli/index.js inventory \
  --spec artifacts/openapi-governance/local-parity-api.yaml \
  --format json \
  > artifacts/openapi-governance/local-parity-api.inventory.json
```

확인할 항목:

- path count와 operation count가 예상과 맞는가
- tag/domain grouping이 의도한 bounded context와 맞는가
- security scheme이 의도치 않게 unused로 남았는가
- unused component candidates가 실제로 제거 가능한가

## 3. Duplicate review 실행

Duplicate review는 중복 후보를 보고만 한다. 자동 병합하지 않는다.
정책별 검사 범위, 종료 코드, 다중 target 사용법은
[Duplicate Review 가이드](../duplicate-review.md)를 기준으로 한다.

```bash
node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy review \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --format markdown

node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy ci \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --format json \
  > artifacts/openapi-governance/duplicate-review.json
```

`review`는 모든 후보를 PR comment에 남기고, `ci`는 target-local canonical ID/output name
충돌만 기본 gate로 사용한다. 추가 후보를 gate에 포함하려면 `--check`과 `--fail-on`을 명시한다.

## 4. Target path coverage gate

`target-check`는 target이나 generated artifact의 emitted `paths` key를 검증한다.

```bash
node packages/codegen/dist/cli/index.js target-check \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --must-include-path /health \
  --must-include-path /users \
  --must-exclude-path /admin \
  --format json \
  > artifacts/openapi-governance/target-check.json
```

Generated artifact를 직접 검증할 때는 `--artifact`를 사용한다.

```bash
node packages/codegen/dist/cli/index.js target-check \
  --artifact artifacts/openapi-governance/local-parity-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin \
  --format markdown
```

Missing required path 또는 forbidden emitted path는 non-zero로 종료한다.

## 5. Runtime drift 확인

파일 입력:

```bash
node packages/codegen/dist/cli/index.js drift \
  --runtime-openapi runtime.openapi.yaml \
  --managed-openapi packages/schemas/src/.merged.yaml \
  --format json \
  > artifacts/openapi-governance/runtime-drift.json
```

URL 입력:

```bash
node packages/codegen/dist/cli/index.js drift \
  --runtime-openapi-url http://localhost:3000/openapi.json \
  --managed-openapi packages/schemas/src/.merged.yaml \
  --format json \
  > artifacts/openapi-governance/runtime-drift.json
```

인증이 필요한 runtime OpenAPI URL은 `--runtime-header`를 반복해서 전달한다.

```bash
node packages/codegen/dist/cli/index.js drift \
  --runtime-openapi-url https://api.example.test/openapi.json \
  --runtime-header "Authorization: Bearer $OPENAPI_TOKEN" \
  --managed-openapi packages/schemas/src/.merged.yaml \
  --format json \
  > artifacts/openapi-governance/runtime-drift.json
```

URL report의 `runtimeFetch`는 `url`, `finalUrl`, `redirected`, `status`, `statusText`,
`contentType`, `requestHeaders`를 보존한다. `requestHeaders`에는 header 이름만 기록하고
값은 기록하지 않는다. Fetch 실패, non-2xx, parse 실패는
`failure.code: "drift-check-failed"`로 보고하고 non-zero로 종료한다.

## 6. Provenance diff를 review에 포함

Base/head provenance sidecar가 있으면 `oa-gen review`에서 source ownership drift를 별도
섹션으로 볼 수 있다.

```bash
node packages/codegen/dist/cli/index.js review \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml \
  --base-provenance contracts/baselines/v1.provenance.json \
  --head-provenance artifacts/openapi-governance/local-parity-api.provenance.json \
  --base-metadata-registry contracts/baselines/v1.metadata.json \
  --head-metadata-registry artifacts/openapi-governance/local-parity-api.metadata.json \
  --format markdown
```

Provenance change는 OpenAPI content diff를 대체하지 않는다. API content가 같아도 source
fragment ownership, source pointer, content hash 변화가 있으면 review evidence로 드러낸다.
Metadata registry change도 별도 evidence다. API content가 같아도 stable key, tracking id,
logical identity drift가 있으면 review에서 분리해서 볼 수 있다.

## 7. PR review bundle 생성

`review-bundle`은 PR comment에 사용할 단일 report를 만든다.

```bash
node packages/codegen/dist/cli/index.js review-bundle \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml \
  --inventory \
  --runtime-drift artifacts/openapi-governance/runtime-drift.json \
  --base-provenance contracts/baselines/v1.provenance.json \
  --head-provenance artifacts/openapi-governance/local-parity-api.provenance.json \
  --composition-report artifacts/openapi-governance/local-parity-api.composition.json \
  --metadata-registry artifacts/openapi-governance/local-parity-api.metadata.json \
  --base-metadata-registry contracts/baselines/v1.metadata.json \
  --head-metadata-registry artifacts/openapi-governance/local-parity-api.metadata.json \
  --duplicate-review artifacts/openapi-governance/duplicate-review.json \
  --format markdown
```

Markdown은 recommendation과 summary로 시작하고, breaking changes를 non-breaking changes보다
먼저 보여준다. JSON 출력은 각 원본 report를 nested section으로 보존한다.

```bash
node packages/codegen/dist/cli/index.js review-bundle \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml \
  --inventory \
  --runtime-drift artifacts/openapi-governance/runtime-drift.json \
  --base-provenance contracts/baselines/v1.provenance.json \
  --head-provenance artifacts/openapi-governance/local-parity-api.provenance.json \
  --composition-report artifacts/openapi-governance/local-parity-api.composition.json \
  --metadata-registry artifacts/openapi-governance/local-parity-api.metadata.json \
  --base-metadata-registry contracts/baselines/v1.metadata.json \
  --head-metadata-registry artifacts/openapi-governance/local-parity-api.metadata.json \
  --duplicate-review artifacts/openapi-governance/duplicate-review.json \
  --format json \
  > artifacts/openapi-governance/review-bundle.json
```

Recommendation policy:

- `REQUEST_CHANGES`: breaking change, stale artifact, runtime drift/check failure, duplicate-review policy decision `REQUEST_CHANGES`
- `COMMENT`: non-breaking change, optional findings, incomplete freshness check, duplicate-review policy decision `COMMENT`
- `APPROVE`: clean required checks

## CI 예시

```bash
pnpm --filter @oa-sdk/codegen build
pnpm --filter @oa-sdk/codegen typecheck
pnpm --filter @oa-sdk/codegen test
pnpm check:cli-spec
pnpm check:feature-tests
pnpm check:api-index

node packages/codegen/dist/cli/index.js target-check \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin

node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy ci \
  --target packages/schemas/src/targets/local-parity-api.yaml
```

## 실패 대응

| 실패 | 대응 |
|---|---|
| `definition-registry/duplicate-id` | canonical id를 변경하거나 중복 fragment를 제거 |
| `definition-output-name/collision` | target naming policy alias를 추가하거나 domain/local name을 조정 |
| `target-coverage/missing-required-path` | target `includePaths` 또는 fragment metadata path를 확인 |
| `target-coverage/forbidden-path-emitted` | public target scope/domain/includePaths를 좁힘 |
| `drift-check-failed` | runtime URL, HTTP status, response content-type, OpenAPI parse 가능 여부를 확인 |
| stale artifact | generated artifact를 다시 생성하고 source diff를 확인 |

## 관련 문서

- [Behavior ECS](../../concepts/behavior-ecs.md)
- [Behavior ECS Spec](../../internal/behavior-ecs.spec.md)
- [코드젠 워크플로](./codegen-workflow.md)
- [CLI 세팅](../cli-setup.md)
- [OpenAPI Governance Service Template](../openapi-governance-service-template.md)
- [Path Fragment Conventions](../path-fragment-conventions.md)
- [구현 현황](../../internal/spec.md)
- [API 인덱스](../../internal/api-index.md)
