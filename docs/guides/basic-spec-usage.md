# 기본 스펙 사용 기준

Status: active operating guide. Last reviewed 2026-07-23.

이 문서에서 말하는 “기본 스펙”은 사람이 직접 수정하는 원천과 각 소비자가
읽는 계약 artifact를 구분한 운영 단위다. 현재 production 기준은 TypeSpec-first이며,
OpenAPI 3.2는 내부 소비자가 공유하는 canonical contract artifact다.

## 1. 기준 결정

| 구분 | 현재 기준 | 직접 수정 여부 |
|---|---|---:|
| Production authoring source | `packages/schemas/typespec/main.tsp` entrypoint와 domain `.tsp` 모듈, bundle manifest | 수정 |
| Production bundle identity | `packages/schemas/typespec/oa-sdk.typespec-bundle.json` | 의미 변경 시 수정 |
| Reviewed reference | `packages/schemas/typespec/expected.openapi.yaml` | 의도한 계약 변경 검토 후 수정 |
| Canonical OpenAPI artifact | `packages/schemas/src/.merged.yaml` (OpenAPI 3.2) | 금지, 생성물 |
| Compatibility artifact | `packages/schemas/src/.merged.3.1.yaml`, `.meta.json` | 금지, 생성물 |
| Package bundle | `packages/schemas/dist/openapi.{yaml,json}` (현재 3.1 호환 출력) | 금지, 생성물 |
| Rollback/reference source | `packages/schemas/src/fragments` + `src/targets` | rollback 기간에만 수정 |
| External service intake | `raw → normalized → upgraded` artifact | 서비스별 source에서 생성 |
| Projection exchange | `@oa-sdk/openapi-projection-contract` envelope | source loader가 아닌 교환 경계 |

핵심 규칙은 다음과 같다.

- `.tsp`와 manifest를 먼저 수정한다. `.merged*`, `dist/openapi*`, sidecar report를 직접 고치지 않는다.
- 내부 parser, codegen, router, client, mock-server는 `.merged.yaml`을 기본 입력으로 사용한다.
- Swagger UI나 OpenAPI 3.1 전용 도구가 필요하면 `.merged.3.1.yaml` 또는 `dist/openapi.*`를 사용한다.
- fragments/targets와 `build-spec`는 현재 production authoring 경로가 아니라 Definition Builder rollback/reference 경로다.
- NestJS/FastAPI처럼 외부 runtime이 산출한 문서는 TypeSpec production source와 섞지 않고 governance intake 경로로 처리한다.

## 2. 사용처별 계약

| 사용처 | 입력 | 출력/검증 | 권장 명령 또는 API |
|---|---|---|---|
| 계약 작성 | `typespec/main.tsp` + domain `.tsp` 모듈 | bundle-check, expected diff | `pnpm schema:validate` |
| 계약 strict 검증 | `.merged.yaml` | OpenAPI 3.2 validation, Spectral, Redocly | `pnpm schema:validate` |
| 타입/라우터/클라이언트 생성 | `.merged.yaml` | generated TypeScript | `oa-gen typegen/router/client` |
| Mock 및 통합 테스트 | `.merged.yaml` | MSW/Node HTTP handlers, request/response validation | `pnpm mock:start`, playground |
| 변경 검토 | base/head OpenAPI + optional sidecars | diff, inventory, provenance, review bundle | `oa-gen diff/review/review-bundle` |
| target별 surface 생성 | fragments + target config | target OpenAPI 3.2 | `oa-gen build-spec` 또는 `schema:validate:openapi` |
| Swagger/3.1 호환 | `.merged.3.1.yaml` 또는 `dist/openapi.*` | OpenAPI 3.1 bundle | `pnpm schema:bundle` |
| 외부 서비스 governance | raw runtime artifact | normalized/3.2 upgraded artifact | `oa-gen scaffold-governance`, `collect` |
| 변경 이력/관측 | TypeSpec bundle 또는 Definition Builder project | snapshot, diff, provenance | `spec-lens` |

`schema:validate`는 source를 `.merged.yaml`로 materialize한 뒤 strict 3.2 gate를
실행한다. `schema:bundle`은 현재 3.1 downgrade 결과를 `dist`에 기록하므로,
3.2 기능을 보존한 입력이 필요하면 `packages/schemas/src/.merged.yaml`을 사용한다.

## 3. 기본 작업 흐름

```text
TypeSpec source
  → bundle-check / expected diff
  → .merged.yaml (OpenAPI 3.2)
  → validate / diff / typegen / router / client / mock / spec-lens snapshot
  → .merged.3.1.yaml 또는 dist/openapi.* (호환 출력)
```

유지보수자는 다음 순서로 작업한다.

1. 변경 대상에 따라 `packages/schemas/typespec/{common,auth,health,me,users}.tsp`를 수정한다. root service metadata나 공유 component registry를 바꿀 때만 `main.tsp`를 수정한다.
2. OpenAPI native 의미를 TypeSpec으로 표현할 수 없으면 [authoring ownership guide](../internal/typespec-roundtrip/authoring-ownership-guide.md)에 따라 native syntax, OA SDK extension, compatibility sidecar 중 하나를 선택한다.
3. 계약 변경이면 `expected.openapi.yaml`과 변경 이유를 함께 검토한다.
4. `pnpm schema:validate`를 실행한다.
5. downstream 사용이 필요한 변경이면 `pnpm schema:downstream-check`를 실행한다.
6. 검증된 `.merged.yaml`을 codegen, mock, review, spec-lens의 입력으로 사용한다.

## 4. 현재 디렉터리 구조

```text
packages/schemas/
├── typespec/
│   ├── main.tsp                         # bundle entrypoint + root metadata
│   ├── common.tsp                       # shared auth/error models
│   ├── auth.tsp                         # authentication domain
│   ├── health.tsp                       # health/version domain
│   ├── me.tsp                           # self-service domain
│   ├── users.tsp                         # users/admin/moderation domain
│   ├── oa-sdk.typespec-bundle.json     # bundle identity + extension version
│   ├── expected.openapi.yaml            # reviewed reference
│   └── accepted-restored-drift.json     # reviewed exception set
├── src/
│   ├── .merged.yaml                     # generated OpenAPI 3.2 input
│   ├── .merged.3.1.yaml                 # generated compatibility input
│   ├── fragments/                        # Definition Builder rollback/reference
│   └── targets/                          # target selection for rollback/reference
└── dist/openapi.{yaml,json}             # generated 3.1 bundle output
```

`@oa-sdk/parser`는 OpenAPI 3.2 document를 IR로 변환하고, `@oa-sdk/codegen`은
검증·diff·생성·governance CLI를 제공한다. `@oa-sdk/router`, `@oa-sdk/client`,
`@oa-sdk/mock-server`는 이 canonical artifact의 downstream consumer다.

### HTTP 오류와 업무 판정

권한 거부처럼 HTTP 오류 상태이면서 호출자가 읽어야 하는 업무 결과가 있는 경우에는
상태 코드를 200으로 바꾸지 않고 typed error contract를 사용한다. 예를 들어 `403`
응답 body가 `AuthorizationDecision`이면 TypeSpec에서 해당 body를 명시하고, client는
`ClientError`의 `status`, `body`, `response`를 보존한다. typegen은 4xx/5xx/default의
JSON body와 status map을 생성하고, client error alias와 operation-specific guard를
status별 union으로 만들므로 호출자는 `status`와 `body`를 함께 좁혀 `reasonCode`나
`trace`를 처리할 수 있다. 동일 status에 여러 업무 오류 body가 있으면 body의
discriminant도 추가로 확인해야 한다.

예를 들어 `checkAuthorization`의 403은 denied decision과 정책 오류가 함께 올 수
있으므로, 생성된 operation-specific guard와 body discriminant를 같이 사용한다.

```ts
import { isCheckAuthorizationClientError } from './generated/client'

try {
  await client.checkAuthorization(request)
} catch (error) {
  if (isCheckAuthorizationClientError(error, 403)) {
    if ('allowed' in error.body) {
    // AuthorizationDeniedDecision: 권한 판정 결과를 업무 흐름에서 처리
    console.log(error.body.reasonCode, error.body.trace)
    } else if ('error' in error.body) {
    // actor mismatch / tenant scope 등 접근 정책 오류
    console.log(error.body.error, error.body.message)
    }
    return
  }
  throw error
}
```

`ClientError`는 `status`, 파싱된 `body`, 원본 `response`를 보존한다. 공통 네트워크
오류나 문서에 선언되지 않은 오류는 operation-specific guard를 통과하지 않으므로,
호출자 공통 오류 처리기로 넘겨야 한다. `is...ClientError(error, status)`를 사용하면
status별 body 타입과 runtime schema를 함께 좁힐 수 있다.

생성 client의 `config.validate: true`는 required field와 JSON Schema의 기본 제약을
fetch 전에 검사한다. retry는 GET/HEAD/OPTIONS/DELETE에만 기본 적용되며, POST/PUT/PATCH는
operation에 `x-oa-sdk-retryable: true`를 선언한 경우에만 재시도한다. 관계 쓰기처럼
중복 실행 위험이 있는 operation은 명시하지 않는다.

## 5. 발견된 모순과 사용성 이슈

### 정리한 문서 모순

- 일부 문서는 fragments를 현재 source of truth처럼 설명하고, 다른 문서는 TypeSpec-first라고 설명한다.
- Definition Builder 구현이 `spec.md`에서 아직 “계획”으로 보인다.
- `schema:bundle`의 3.1 출력과 `.merged.yaml`의 3.2 역할이 한눈에 구분되지 않는다.
- fragment 내부의 `oa://...` source ref와 조립된 OpenAPI의 `#/components/...` ref 규칙이 한 문서에 섞여 있다.
- spec-lens의 설명이 `fragmentsDir` 중심이라 TypeSpec bundle 관측 범위를 놓치기 쉽다.

이번 정렬에서 위 상위 문서의 기준을 이 문서와 일치시킨다.

### 남아 있는 구조적 사용성 이슈

1. **root metadata와 domain source의 경계가 다르다.** 도메인 model/response/operation은 모듈로
   나뉘었지만 `x-oa-sdk-components`, service/info, server, tag metadata는 `main.tsp`에 남아 있다.
   새 공유 component를 추가할 때는 root registry와 `common.tsp`의 책임을 함께 확인해야 한다.
2. **환경별 target이 TypeSpec 경로에 아직 없다.** local/mock server는 production bundle에
   선언되어 있지만 staging/production 서버 선택은 Definition Builder target에 남아 있다.
   환경별 artifact가 필요해지면 TypeSpec source와 target overlay 중 어느 쪽이 ownership을
   가질지 별도 결정해야 한다.
3. **extension metadata의 진입장벽이 높다.** 예시, reusable response/parameter identity,
   explicit security override가 TypeSpec native syntax와 `@extension` 사이에 나뉜다. 새 계약
   추가 전에 ownership guide와 manifest extension version을 확인해야 한다.
4. **spec-lens의 관측 범위가 sourceRoot에 묶인다.** TypeSpec source 변경은 추적하지만 lockfile,
   emitter 설정, extension implementation 변경은 현재 자동 timeline 후보가 아니다. 관련 변경을
   함께 검토할 때는 별도 watchPaths 계약이 필요하다.

## 6. 다음 구조 정렬 순서

| 우선순위 | 작업 | 완료 기준 |
|---|---|---|
| P0 | 문서와 command naming을 이 운영 기준에 맞춤 | docs/API/CLI gates 통과, source ownership 단일화 |
| P1 | TypeSpec domain import 구조 유지 | 신규 도메인은 module + `main.tsp` import + normalized diff/downstream gate를 함께 갱신 |
| P1 | staging/production target ownership 결정 | TypeSpec overlay 또는 target artifact 중 하나를 명시 |
| P1 | extension authoring helper/example 추가 | 예시 1개를 ownership guide 없이도 작성 가능 |
| P2 | spec-lens `watchPaths` 도입 검토 | source와 build/runtime dependency 변경을 같은 revision evidence로 연결 |

새 사용처는 이 문서의 사용처 표에 먼저 추가하고, 해당 입력 artifact와 성공 gate가 정해진
뒤에 패키지나 adapter를 확장한다.
