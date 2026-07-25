# CLI 세팅 가이드

## 필수 도구

| 도구 | 역할 | 설치 |
|---|---|---|
| **Redocly CLI** | 스키마 번들/린트/프리뷰 | 루트 devDep |
| **Spectral CLI** | 스타일 가이드 린트 | 루트 devDep |

모두 `pnpm install`로 자동 설치됩니다.

## 초기 세팅

```bash
cd oa-sdk
pnpm install
git submodule update --init --recursive
```

## 주요 워크플로우

### OpenAPI governance checks

API 변경 PR에서는 [OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md)를
기본 흐름으로 사용한다.

`duplicate-review`의 정책 선택, 다중 target, severity override는
[Duplicate Review 가이드](./duplicate-review.md)를 기준으로 한다.

| 명령 | 목적 |
|---|---|
| `oa-gen build-spec` | Definition Builder target artifact와 diagnostics/collision/composition/provenance/metadata sidecar 생성 |
| `oa-gen scaffold-governance` | 외부 OpenAPI 서비스용 config/script/docs 스캐폴드 생성 |
| `oa-gen collect` | 외부 OpenAPI raw 산출물을 normalized governance artifact와 OpenAPI 3.2 upgraded artifact로 수집 |
| `oa-gen normalize` | 외부 OpenAPI 문서를 stable diff 가능한 governance artifact로 정규화 |
| `oa-gen upgrade` | OpenAPI 3.0/3.1 문서를 OpenAPI 3.2 analysis artifact로 파생 |
| `oa-gen inventory` | OpenAPI path/operation/component/security surface 요약 |
| `oa-gen behavior-query` | behavior SQLite projection을 filtered recent/latest와 summary-by-* 기준으로 조회 (`--status`, `--decision-signal`, `latest-by-decision-signal`, `behavior+decision` composite summary 지원) |
| `oa-gen duplicate-review` | 정책 기반 fragment 중복 탐지 및 실제 target output-name 충돌 검토 |
| `oa-gen target-check` | target 또는 artifact path include/exclude assertion 검증 |
| `oa-gen drift` | runtime OpenAPI 파일 또는 URL과 managed OpenAPI drift 비교, optional behavior logging |
| `oa-gen review` | diff, validation, artifact freshness, optional provenance/metadata diff report, optional behavior logging |
| `oa-gen review-bundle` | PR comment용 aggregate review report 생성 (optional provenance/metadata diff + behavior logging 포함) |

최소 PR gate 예시:

```bash
oa-gen diff \
  --base contracts/baselines/v1.openapi.yaml \
  --head packages/schemas/src/.merged.yaml \
  --fail-on-breaking

oa-gen check-artifact \
  --head packages/schemas/src/.merged.yaml \
  --artifact packages/schemas/dist/openapi.yaml

oa-gen duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy ci \
  --target packages/schemas/src/targets/local-parity-api.yaml

oa-gen target-check \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --must-include-path /health \
  --must-exclude-path /admin
```

외부 프레임워크 산출물(NestJS Swagger, FastAPI 등)을 oa-sdk 전체 기능에 연결하는 예시. profile은 `generic`/`nestjs-swagger`/`fastapi`를 지원하고, FastAPI는 `--profile fastapi` + `apps/fastapi-ref` 레퍼런스를 그대로 사용한다.

```bash
# NestJS Swagger
oa-gen scaffold-governance \
  --root apps/nestjs-ref \
  --service nestjs-ref \
  --profile nestjs-swagger \
  --source-command "pnpm export:openapi" \
  --runtime-openapi-url http://localhost:3000/openapi.json

bash apps/nestjs-ref/scripts/openapi-governance.sh all

# FastAPI
oa-gen scaffold-governance \
  --root apps/fastapi-ref \
  --service fastapi-ref \
  --profile fastapi \
  --source-command "uv run python scripts/export_openapi.py" \
  --runtime-openapi-url http://localhost:8000/openapi.json

bash apps/fastapi-ref/scripts/openapi-governance.sh all
```

### 레포 게이트 (drift checks)

루트 `package.json`에서 사용 가능한 정합성 검사:

| 명령 | 검사 대상 |
|---|---|
| `pnpm check:cli-spec` | `oa-gen` / `oa-contract` governance manifest와 `docs/cli-spec/*.json` 정합성 |
| `pnpm check:api-index` | 패키지 export ↔ `docs/internal/api-index.md` drift |
| `pnpm check:docs` | 전체 Markdown local link와 fenced `oa-gen` 명령/옵션 drift |
| `pnpm check:spec-governance` | `.ai/spec-loader.yaml`의 공식 기준 경로·형식 정합성 |
| `pnpm check:feature-tests` | `docs/internal/feature-test-matrix.{md,json}` 항목 ↔ 실제 테스트 경로 |
| `pnpm schema:validate` | TypeSpec production bundle로 `.merged.yaml` 생성 후 downgrade-3.1 / spectral / redocly / strict OpenAPI 3.2 validate 실행 |
| `pnpm schema:validate:openapi` | OpenAPI/Definition Builder rollback path로 `.merged.yaml` 생성 후 동일 검증 실행 |

`check:api-index`는 `pnpm build:scripts` 산출물에 의존하므로 처음에는 빌드 후 실행한다.

### 스키마 검증

```bash
pnpm schema:validate
```

루트 명령은 먼저 parser와 codegen CLI를 빌드한 뒤 아래 스키마 파이프라인을 실행한다.

내부적으로 다음 파이프라인을 순차 실행:
1. `schema:typespec-check` — TypeSpec compile + OA SDK extension restore + approved snapshot drift gate → `src/.merged.yaml`
2. `downgrade:3.1` — OpenAPI 3.2 artifact에서 Redocly-compatible 3.1 artifact 생성
3. `spectral lint .merged.yaml` — 스타일 가이드 검사
4. `redocly lint .merged.3.1.yaml` — $ref 유효성 + 스펙 준수 검사
5. `oa-gen validate --require-32` — OA SDK OpenAPI 3.2 strict validation

OpenAPI/Definition Builder fallback을 검증하려면 다음 명령을 사용한다:

```bash
pnpm schema:validate:openapi
```

### 승인 snapshot 갱신

TypeSpec 계약 변경은 먼저 gitignore된 `.oa-sdk/typespec-candidates/`에 생성한
후보의 normalized diff를 검토한다.

```bash
pnpm schema:approve-typespec-reference
```

검토가 끝난 경우에만 다음 명령으로 manifest가 가리키는 `approved.openapi.yaml`을
갱신한다. 이 파일은 직접 수정하지 않는다.

```bash
pnpm schema:approve-typespec-reference -- --write
```

### 스키마 번들링

```bash
pnpm schema:bundle
```

TypeSpec production bundle이 `packages/schemas/src/.merged.yaml`를 생성한 뒤
3.1 downgrade artifact를 번들:
- `packages/schemas/dist/openapi.yaml`
- `packages/schemas/dist/openapi.json`

OpenAPI/Definition Builder fallback bundle은 `pnpm schema:bundle:openapi`으로 생성한다.

### 문서 미리보기

```bash
pnpm schema:preview
```

브라우저에서 Redoc UI로 스키마를 렌더링합니다.

### Mock 서버 시작

```bash
pnpm mock:start
```

기본 포트: `4010`

## TypeSpec 배포 환경 projection

TypeSpec production contract에서 server URL만 달리한 deployment artifact가 필요하면
다음 명령을 사용한다. profile은 restored contract를 입력으로 하며 approved snapshot이나
Definition Builder fallback을 갱신하지 않는다.

```bash
pnpm schema:project-typespec:local
pnpm schema:project-typespec:staging
pnpm schema:project-typespec:production
```

입력 profile은 `packages/schemas/typespec/oa-sdk.typespec-projections.json`이고 출력은
`packages/schemas/src/.projected/<profile>.openapi.yaml`이다. profile이 바꿀 수 있는
필드는 `servers`뿐이다.

## Definition Builder fallback 환경 프로필

```bash
pnpm schema:build:openapi            # local fallback/reference
pnpm schema:build:openapi:staging    # staging
pnpm schema:build:openapi:production # production
```

Target config: `packages/schemas/src/targets/{local,staging,production}-parity-api.yaml`

## Spectral 규칙 커스텀

`packages/schemas/.spectral.yaml` 파일에서 규칙을 추가/수정합니다.

```yaml
rules:
  my-custom-rule:
    given: "$.paths[*][*]"
    severity: warn
    then:
      function: truthy
```

> OAS 3.2 관련 Spectral 규칙 비활성화 배경 → [ADR-005](../internal/architecture/005-spectral-redocly-split.md)
