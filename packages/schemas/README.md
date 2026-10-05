# @oa-sdk/schemas

이 저장소의 production API 계약(`OA SDK API`)을 담는 모노레포 전용 패키지입니다. `package.json`이
`private: true`이므로 npm에 배포하지 않으며, 다른 프로젝트에서 설치할 수 없습니다. `@oa-sdk/schemas`,
`@oa-sdk/spec-lens`, `pnpm schema:*` 명령은 이 저장소 안에서만 씁니다. 다른 프로젝트에서 API 계약을
관리하려면 [Quick Start](../../docs/guides/quick-start.md)를 따릅니다.

- 원본: `typespec/`의 TypeSpec 모듈([ADR-009](../../docs/internal/architecture/009-typespec-first-authoring.md)).
- 정본 생성물: `src/.merged.yaml`(OpenAPI 3.2). 저장소 안의 parser, codegen, mock 서버, downstream gate가 이 파일을 읽습니다.
- 패키지 export: `dist/openapi.{json,yaml}`. OpenAPI **3.1** 호환 번들이며 3.2 정본이 아닙니다.

어떤 파일을 고치고 어떤 명령으로 검증하는지는 [기본 스펙 사용 기준](../../docs/guides/basic-spec-usage.md)이
정본입니다. 이 README는 패키지 안의 배치와 스크립트만 설명합니다. `package.json`의 `description`
("OpenAPI 3.2 modular schema definitions — source of truth")은 TypeSpec 원본 전환 이전 문구이며,
현재 원본은 `typespec/`입니다.

## 디렉터리와 파일

| 경로 | 역할 | git | 직접 수정 |
|---|---|---|---|
| `typespec/main.tsp` | 번들 진입점. 아래 모듈을 import만 한다 | 추적 | import 추가 시 |
| `typespec/metadata/{service,security,common-components}.tsp` | service·info·server·tag, security scheme, 재사용 parameter·response component | 추적 | 수정 |
| `typespec/version.tsp` | `ContractVersion`(생성되는 `info.version`) | 추적 | 계약 버전 변경 시 |
| `typespec/{common,auth,health,me,users,world-model}.tsp` | 도메인 모델·응답·operation | 추적 | 수정 |
| `typespec/chunk-stream.tsp` | chunk-stream 모델 선언. `main.tsp`가 import하지 않으므로 production 계약에 들어가지 않는다 | 추적 | - |
| `typespec/oa-sdk.typespec-bundle.json` | 번들 manifest(진입점, 승인 snapshot, `oa-sdk.typespec-extensions.v5`) | 추적 | 의미 변경 시 |
| `typespec/approved.openapi.yaml` | 검토를 거친 OpenAPI 3.2 snapshot | 추적 | 금지. 승인 명령으로만 갱신 |
| `typespec/accepted-restored-drift.json` | 승인된 restore 차이 목록(현재 0건) | 추적 | 검토 후 |
| `typespec/oa-sdk.typespec-projections.json` | 배포 환경별 server URL profile | 추적 | server 값만 |
| `src/.merged.yaml` | TypeSpec에서 만든 정본 OpenAPI 3.2 생성물 | 무시(`.gitignore`) | 금지 |
| `src/.merged.3.1.yaml`, `src/.merged.3.1.meta.json` | 3.1 호환 생성물과 3.2 전용 필드 sidecar | 추적(CI가 최신인지 확인) | 금지 |
| `src/.builder/`, `src/.projected/` | 번들 리포트, 배포 환경 projection 출력 | 무시 | 금지 |
| `src/fragments/`, `src/targets/` | Definition Builder rollback·참조 경로의 원본 | 추적 | rollback 경로를 고칠 때만 |
| `src/domains/`, `src/profiles/`, `src/openapi.yaml` | Definition Builder 이전의 도메인·프로필 문서. 빌드·검증 스크립트는 읽지 않는다 | 추적 | - |
| `src/.merged.upgraded.3.2.yaml` | `upgrade:3.2` 스크립트로 만든 3.1→3.2 변환 결과. 빌드가 다시 만들지 않아 현재 계약보다 오래되었다(`info.version: 0.1.0`) | 추적 | - |
| `dist/openapi.{json,yaml}` | 패키지 export인 3.1 호환 번들 | 무시 | 금지 |

새로 clone한 저장소에는 `src/.merged.yaml`과 `dist/`가 없습니다. 루트에서 `corepack pnpm build:core`나
`corepack pnpm schema:validate`를 한 번 실행해야 이 파일을 읽는 codegen·mock 명령이 동작합니다.

## 스크립트

루트 스크립트(`pnpm schema:*`)를 쓰는 것이 기본입니다. 패키지 스크립트 이름은 `pnpm --filter @oa-sdk/schemas run <name>`으로 실행합니다.

| 루트 명령 | 패키지 스크립트 | 하는 일 |
|---|---|---|
| `pnpm schema:validate` | `validate` | 필요한 패키지를 빌드하고 TypeSpec 번들을 검사해 `src/.merged.yaml`을 쓴 뒤, 3.1 변환, Spectral, Redocly, `oa-gen validate --require-32`를 실행한다 |
| `pnpm schema:typespec-check` | `typespec:check` | 번들 검사, 승인 snapshot과의 normalized diff, `accepted-restored-drift.json` 대조 |
| `pnpm schema:approve-typespec-reference` | `typespec:approve-reference` | 승인 후보를 `.oa-sdk/typespec-candidates/`에 쓰고 diff를 보여 준다. `-- --write`를 붙여야 `approved.openapi.yaml`을 갱신한다 |
| `pnpm schema:downstream-check` | `downstream:check` | 생성물을 parser, typegen, router·client 생성, mock 핸들러에 넣고 생성 코드를 컴파일한다 |
| `pnpm schema:rollback-check` | `rollback:check` | TypeSpec 검사와 rollback 경로 검증을 차례로 실행하고, 끝나면 `src/`를 실행 전 상태로 되돌린다 |
| `pnpm schema:validate:openapi` | `validate:openapi` | rollback 경로(`src/fragments` + `src/targets/local-parity-api.yaml`)로 `src/.merged.yaml`을 다시 만들어 검증한다. 추적 중인 `src/.merged.3.1.*`도 rollback 결과로 덮어쓴다 |
| `pnpm schema:bundle` | `bundle`(`build`) | TypeSpec 번들에서 `dist/openapi.{yaml,json}`(3.1)을 만든다 |
| `pnpm schema:project-typespec:{local,staging,production}` | - | 복원한 계약에 server URL만 바꾼 결과를 `src/.projected/`에 쓴다 |
| `pnpm schema:preview` | `preview` | 3.1 호환 생성물을 Redocly로 미리 본다 |
| - | `test` | `scripts/__tests__`의 3.1 변환·왕복 테스트 |

`:openapi`가 붙은 명령(`schema:validate:openapi`, `schema:bundle:openapi`, `schema:preview:openapi`, 패키지의
`build:openapi`)은 rollback 경로를 씁니다. rollback 경로를 검증한 뒤 커밋하기 전에는 `pnpm schema:validate`를
다시 실행해 추적 파일을 TypeSpec 결과로 되돌리거나, 처음부터 `pnpm schema:rollback-check`를 씁니다.

## 관련 문서

- [기본 스펙 사용 기준](../../docs/guides/basic-spec-usage.md): 원본·생성물 구분과 변경 작업 순서
- [스키마 작성 가이드](../../docs/guides/schema-authoring.md): TypeSpec·OpenAPI 작성 규칙
- [TypeSpec 원본 README](./typespec/README.md): 모듈별 소유 범위와 G9~G12 gate
- [Production operations runbook](../../docs/internal/typespec-roundtrip/production-operations.md): 승격·복구·rollback 절차
