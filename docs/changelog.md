# Changelog

릴리스 단위가 아닌, 굵직한 surface 변경이 떨어졌을 때 한 항목으로 기록한다. 자세한 구현 상태는 [spec.md](./internal/spec.md), API 단일 소스는 [api-index.md](./internal/api-index.md), 기능↔테스트는 [feature-test-matrix.md](./internal/feature-test-matrix.md) 참조.

## 2026-04-27 — External OpenAPI Artifact Governance Scaffold

NestJS Swagger / FastAPI처럼 외부 프레임워크가 생성한 OpenAPI 산출물을 oa-sdk 계약 관리 파이프라인에 표준 방식으로 연결하는 일련의 도구가 추가되었다.

### CLI surface

`@oa-sdk/codegen`에 4개 명령 추가 (CLI 명령 18 → 22):

- `oa-gen scaffold-governance --root <서비스> --service <이름> --profile <generic|nestjs-swagger> [--source-command "..."] [--runtime-openapi-url "..."]` — `openapi-governance.config.json`(`oa-gen.openapi-governance.v1` schema), `scripts/openapi-governance.sh`, `openapi-governance.md`를 생성하고 contracts/scripts/src 디렉토리를 만든다.
- `oa-gen collect --spec <raw> --normalized <out> --upgraded <out> [--report <out>] [--raw <copy>] [--profile <profile>]` — raw 보존 + normalized governance artifact + OpenAPI 3.2 분석 artifact + collect report를 한 번에 생성.
- `oa-gen normalize --spec <raw> [--output <out>] [--profile <profile>]` — 의미 보존 normalize만(stable diff용).
- `oa-gen upgrade --spec <normalized> [--output <out>] [--report <out>]` — 3.0/3.1 → 3.2 변환만.

### Reference implementation

`apps/nestjs-ref/`에 NestJS 10 + Swagger 7 레퍼런스 서비스 추가. `bash scripts/openapi-governance.sh all`이 collect → check-artifact → review → typegen → validate-upgraded까지 통과한다. `review-bundle`/`inventory`/`drift`/`update-baseline`도 별도 타깃으로 노출.

### Hardening

여러 라운드에 걸친 안정화:

- **Upgrade 재귀 보강**: `nullable: true`가 `paths`/`webhooks`/`components.{schemas,responses,parameters,requestBodies,headers,callbacks,pathItems}` 어디에 있어도 3.2 null union으로 변환. 이전엔 `#/components/schemas`만 처리해 inline schema가 누락되었음.
- **Clone 안전성**: `cloneJson`이 `structuredClone` 사용 — `JSON.parse(JSON.stringify())`로 인한 undefined/NaN 손실 제거.
- **Repo root 자동 감지**: 스크립트가 `git rev-parse --show-toplevel` 우선, 기존 `apps/<service>` 2-deep 가정은 fallback. 다른 깊이에서도 동작.
- **Friendly missing-baseline**: 첫 실행 시 baseline 없으면 `update-baseline` 힌트와 함께 exit 1.
- **Shell hardening**: `OA_GEN` env가 `read -ra OA_GEN_CMD <<<`로 split되어 glob 확장 없음. `--source-command`는 trusted 셸 입력임을 rendered 스크립트 주석으로 명시.
- **Runtime URL 검증**: `--runtime-openapi-url`을 scaffold time에 `URL` 파서로 검증, http(s) 외 protocol 거절.
- **Drift 인자 forwarding**: `bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"`처럼 추가 인자 그대로 전달.
- **Consumers field가 source of truth**: rendered 스크립트가 `consumers.{governance,review,typegen,inventory,validate,driftManaged}` 매핑을 셸 변수명으로 해소해 baked. 알 수 없는 mapping은 scaffold time 거절.
- **Config fingerprint**: 렌더링된 스크립트 헤더 `# config fingerprint: <16자 sha256>` 라인이 profile/source/artifacts/consumers 정렬 직렬화 해시. JSON hand-edit 후 re-scaffold 누락 시 visible 신호. `fingerprintGovernanceConfig()` public helper로 외부 도구가 재계산 가능.

### Public API

`@oa-sdk/codegen` root entry에 추가 export:

- 함수: `parseOpenApiCollectProfile`, `normalizeOpenApiDocument`, `upgradeOpenApiDocumentTo32`, `stringifyOpenApiYaml`, `createOpenApiCollectReport`, `createOpenApiGovernanceInterface`, `scaffoldOpenApiGovernance`, `formatScaffoldResult`, `fingerprintGovernanceConfig`
- 타입: `OpenApiCollectProfile`, `OpenApiCollectReport`, `OpenApiTransformWarning`, `OpenApiUpgradeReport`, `OpenApiGovernanceInterface`, `OpenApiGovernanceScaffoldOptions`, `OpenApiGovernanceScaffoldResult`

### Docs

- 신규: [`docs/guides/use-cases/nestjs-swagger-governance.md`](./guides/use-cases/nestjs-swagger-governance.md), [`apps/nestjs-ref/README.md`](../apps/nestjs-ref/README.md).
- 갱신: [`docs/guides/openapi-governance-service-template.md`](./guides/openapi-governance-service-template.md)(Adoption Checklist를 external-artifact / Definition Builder 두 경로로 분리), [`docs/guides/cli-setup.md`](./guides/cli-setup.md), [`README.md`](../README.md), [`docs/internal/api-index.md`](./internal/api-index.md), [`docs/internal/feature-test-matrix.{md,json}`](./internal/feature-test-matrix.md), [`docs/internal/spec.md`](./internal/spec.md).

### Gates

- 47 test files / 648 tests passing.
- `pnpm check:cli-spec` — 22 command entities.
- `pnpm check:api-index` — exports와 문서 정합.
- `pnpm check:feature-tests` — 23 features / 86 test paths (신규 `external-openapi-governance-scaffold` 항목 등록).
