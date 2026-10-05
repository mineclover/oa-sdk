---
docType: guide
sourceLocale: ko
canonical: true
audience:
  competence: intermediate
productVersions:
  - "@oa-sdk/codegen 0.9.0"
  - "@oa-sdk/typespec-decorators 0.3.0"
owner: "OA SDK maintainers"
status: active
---

# TypeSpec 작성 규칙 (TypeSpec Authoring Conventions)

이 문서는 oa-sdk 저장소의 production 계약(`packages/schemas/typespec/`)을 고치는 기여자용 정본 규칙입니다. 파일 오너십, 이름, 응답 선언, 확장, 버전 채널, 변경·승인 절차를 정합니다. 다른 프로젝트에서 oa-sdk를 쓰려면 [Quick Start](./quick-start.md)를 따르고, `.tsp`를 원본으로 쓸 때 설치할 패키지는 [`@oa-sdk/typespec-decorators` README](../../packages/typespec-decorators/README.md#install)를 봅니다.

상태: active · 최종 검토: 2026-10-06 · 정본: `packages/schemas/typespec/main.tsp`와 그 파일이 import하는 모듈

이 저장소에서 사람이 고치는 계약 원본은 TypeSpec뿐이고, OpenAPI YAML은 리뷰 근거로 쓰는 생성물입니다. 원본에서 무엇을 만들고 어떤 검사를 거는지는 [가이드 색인의 핵심 가치](./README.md#oa-sdk가-해결하는-문제와-핵심-가치)에 정리되어 있습니다.

명령은 저장소 루트에서 실행합니다. 루트에서는 `oa-gen`이 PATH에 없으므로 `pnpm --filter @oa-sdk/codegen build` 후 `node packages/codegen/dist/cli/index.js <명령>`으로 실행합니다.

## 1. 파일 오너십 (Ownership)

| 계약 사실 | 작성 위치 | 규칙 |
|---|---|---|
| 번들 구성 | `main.tsp` | import 목록과 루트 `namespace OaSdkApi;`만 둔다. 모델과 operation을 쓰지 않는다. |
| 서비스 메타데이터 | `metadata/service.tsp` | `@service`, `@server`, `@info`, `@tagMetadata`. 루트 수준 변경만 한다. |
| 보안 스킴 | `metadata/security.tsp` | `x-oa-sdk-security-schemes` 확장과 전역 보안 스킴. |
| 재사용 컴포넌트 | `metadata/common-components.tsp` | 재사용 파라미터(`Limit`, `Page`)와 재사용 응답(`BadRequest`, `Unauthorized`, `NotFound` 등)을 `x-oa-sdk-components` 확장으로 둔다. 도메인 모델·operation과 섞지 않는다. |
| API 계약 버전 | `version.tsp`(`ContractVersion`) | OpenAPI `info.version`의 유일한 출처. package나 빌드 버전에서 끌어오지 않는다. |
| 공통 에러와 응답 템플릿 | `common.tsp` | `Error`, `ValidationError`, `bearerAuth`, `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`, `ErrorResponse<Status>`, `StandardHttpErrors`. |
| 도메인 모델, DTO, operation | 해당 도메인 모듈(`users.tsp`, `auth.tsp` 등) | TypeSpec 기본 문법을 우선한다. |
| 열거형과 값 어휘 | 가장 작은 소유 도메인 모듈. 계약 리뷰가 여러 도메인 공용으로 정한 경우에만 `common.tsp` | literal union이나 alias로 쓴다. 리소스 전용 필터는 그 operation에 둔다. `metadata/common-components.tsp`는 전역 enum 저장소가 아니다. |
| emitter가 보존하지 못하는 OpenAPI 사실 | OA SDK TypeSpec 확장 | 버전이 있고 문서화된 확장만 쓴다. 의미를 주석에 넣지 않는다. |
| 생성된 OpenAPI | `src/.merged*.yaml`, `dist/openapi.*` | 직접 고치지 않는다. 이 중 `src/.merged.3.1.yaml`과 `.merged.3.1.meta.json`은 커밋하는 생성물이므로 [계약 변경 절차](#7-계약-변경-절차-contract-change-workflow)대로 다시 만들어 커밋한다. |
| 승인 스냅샷 | `approved.openapi.yaml` | 직접 고치지 않는다. 승인 명령으로만 갱신한다. |

확장을 추가하기 전에 [ownership guide](../internal/typespec-roundtrip/authoring-ownership-guide.md)를 확인합니다. 현재 sidecar 없이 받는 확장 어휘는 [`oa-sdk.typespec-extensions.v5`](../internal/typespec-roundtrip/oa-sdk-typespec-extensions.v5.md) 하나입니다. 복원에 쓰이는 확장을 바꾸려면 새 버전, 명시적 migration, bundle-check 테스트가 필요합니다.

### 1.1 새 도메인 모듈의 머리말

새 모듈은 아래 머리말로 시작하고 `main.tsp`의 import 목록에 추가합니다. 서비스 namespace(`OaSdkApi`) 밖에 선언한 operation은 번들의 OpenAPI에 나오지 않습니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

namespace OaSdkApi;
```

- `@operationId`, `@extension`, `@info`는 `@typespec/openapi`에 있으므로 `import "@typespec/openapi";`와 `using OpenAPI;`가 필요합니다. 없으면 `Unknown decorator @operationId`로 실패합니다.
- `@oaUseResponseComponent` 같은 OA SDK decorator를 쓰려면 `@oa-sdk/typespec-decorators` import와 `using OaSdkTypeSpec;`이 필요합니다.
- `OaSdkApi` 안에서 `Ok`, `ErrorResponse` 같은 이름은 `common.tsp`의 선언으로 해석됩니다. 자기 namespace의 선언이 `using`으로 가져온 같은 이름보다 우선하기 때문입니다. 그래서 이 번들의 `ErrorResponse<Status>` 본문은 패키지의 `StandardError`가 아니라 `common.tsp`의 `Error`입니다.

## 2. 이름 규칙

- **operationId**: `camelCase` 동사+명사. 목록 `listUsers`, 단건 `getUserById`, 생성 `createUser`, 수정 `updateUser`, 삭제 `deleteUser`.
- **operation 메타데이터**: 새 operation에는 `@summary`, `@doc`, `@tag`, `@operationId`를 모두 둡니다. 새 tag를 쓰면 설명을 `metadata/service.tsp`의 `@tagMetadata`에 추가합니다.
- **엔티티 모델**: `PascalCase` 단수 명사(`User`, `Article`).
- **요청 DTO**: 생성 `Create<Resource>Request`, 수정 `Update<Resource>Request`, 그 밖의 동작 `<Action><Resource>Request`(`PurgeUserRequest`).
- **열거형**: literal union alias(`alias UserRole = "admin" | "user" | "guest";`). alias에는 decorator를 붙일 수 없으므로 설명은 `/** ... */` 주석으로 씁니다.

## 3. 응답 선언

새 operation은 `common.tsp`의 템플릿으로 응답을 선언합니다.

| 응답 | 템플릿 |
|---|---|
| 200 단건 | `Ok<T>` |
| 200 목록 | `Ok<PageResult<T>>` (`PageResult<T>`는 본문 모델이므로 `Ok`로 감쌉니다) |
| 201 생성 | `Created<T>` |
| 204 본문 없음 | `NoContent` |
| 에러 | `ErrorResponse<Status>`, 400·401·403·404·500 묶음은 `StandardHttpErrors` |

```typespec
@summary("Article 단건 조회")
@doc("ID로 Article 단건 정보를 조회합니다.")
@tag("articles")
@useAuth(bearerAuth)
@operationId("getArticleById")
@route("/articles/{id}")
@get
op getArticleById(@path id: string): Ok<Article> | ErrorResponse<401> | ErrorResponse<404>;
```

기존 모듈(`auth.tsp`, `users.tsp`, `me.tsp` 등)은 canonical fixture에서 bootstrap한 형태를 그대로 유지합니다. operation마다 `GetUserById200Response` 같은 상태별 응답 모델을 두고, 재사용 응답·예제·보안을 `@extension("x-oa-sdk-operation-component-refs" | "x-oa-sdk-operation-examples" | "x-oa-sdk-operation-security", ...)` payload로 기록한 형태입니다. 이 payload는 bootstrap 결과이며 새 operation이 따를 본보기가 아닙니다.

### 3.1 재사용 응답 컴포넌트에 연결하기

응답을 `metadata/common-components.tsp`의 재사용 응답(`#/components/responses/NotFound` 등)으로 내보내려면 세 가지를 함께 둡니다. 승인 명령(`pnpm schema:approve-typespec-reference`)은 하나라도 빠지면 `cannot approve TypeSpec snapshot`으로 실패합니다.

1. 반환 타입에 그 상태의 응답(`ErrorResponse<404>`). 없으면 bundle check가 `restore targets: N applied, M missing`을 보고합니다.
2. `@oaUseResponseComponent("404", "NotFound")`. 같은 일을 하는 raw `x-oa-sdk-operation-component-refs` payload 대신 이 decorator를 씁니다.
3. `x-oa-sdk-operation-examples` 확장에 그 응답의 예제. 값은 컴포넌트의 예제와 같게 둡니다. 없으면 `sidecar re-extract` 단계가 실패합니다. 이 확장에는 아직 decorator가 없습니다.

```typespec
@summary("Article 단건 조회")
@doc("ID로 Article 단건 정보를 조회합니다.")
@tag("articles")
@useAuth(bearerAuth)
@operationId("getArticleById")
@route("/articles/{id}")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{ code: "NOT_FOUND", message: "요청한 리소스를 찾을 수 없습니다" },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
@oaUseResponseComponent("404", "NotFound")
op getArticleById(@path id: string): Ok<Article> | ErrorResponse<404>;
```

`@oaUseResponseComponent`와 위 확장은 bundle restore(`pnpm schema:approve-typespec-reference`, `pnpm schema:typespec-check`, `oa-gen tsp-bundle-check`)에서만 재사용 응답과 예제로 바뀝니다. `oa-gen`의 메모리 컴파일 경로(`oa-gen mock --tsp`, `.tsp`를 넣은 `generate`·`typegen`·`validate`)에서는 확장만 남고, 응답은 반환 타입에 선언한 것만 나옵니다. `oa-gen tsp-scaffold`가 만든 코드는 반환 타입에 에러 상태 없이 `@oaUseResponseComponent`만 넣으므로 그대로는 승인되지 않습니다. 정리 방법은 [TypeSpec 5분 퀵스타트](./typespec/01-quickstart-5min.md#2-crud-스캐폴딩과-응답-정리)에 있습니다.

## 4. 데이터 타입 제약

| 목적 | decorator·타입 | 예 |
|---|---|---|
| 식별자(UUID) | `@format("uuid")` | `@format("uuid") id: string;` |
| 이메일 | `@format("email")` | `@format("email") email: string;` |
| 생성·수정 시각 | `utcDateTime` | `createdAt: utcDateTime;` |
| 문자열 길이 | `@minLength`, `@maxLength` | `@minLength(1) @maxLength(100) name: string;` |
| 숫자 범위(경계 포함) | `@minValue`, `@maxValue` | `@minValue(1) @maxValue(100) limit: integer;` |
| 숫자 범위(경계 제외) | `@minValueExclusive`, `@maxValueExclusive` | `@minValueExclusive(0) price: float64;` |
| 정규식 | `@pattern` | `@pattern("^[a-z0-9-]+$") slug: string;` |

decorator 전체와 OpenAPI 투영 결과는 [데코레이터 레퍼런스](./typespec/03-decorators-reference.md)를 봅니다.

## 5. 확장 사용 순서 (Extension Convention)

다음 순서로 고릅니다.

1. TypeSpec 기본 decorator나 모델 문법.
2. ownership guide가 문서화한 기존 OA SDK 확장.
3. 번들이 생성물이거나 확장이 그 사실을 소유할 수 없을 때만 compatibility sidecar.
4. 복원에 쓰이는 새 필드는 버전이 있는 확장 설계를 먼저 제안한다.

TypeSpec 기본 문법으로 표현할 수 있는 enum이나 값 어휘를 위해 OA SDK 확장을 추가하지 않습니다. 값별 메타데이터나 다른 OpenAPI 고유 사실이 왕복되지 않으면 오너십을 명시적으로 결정하고, 필요하면 버전이 있는 확장을 제안합니다. 검증되지 않은 의미를 주석이나 범용 확장 payload에 넣지 않습니다.

전용 decorator가 있는 확장은 raw `@extension` payload 대신 decorator를 씁니다. decorator 목록과 각 decorator가 내보내는 확장은 [`@oa-sdk/typespec-decorators` README](../../packages/typespec-decorators/README.md)가 정본입니다. decorator가 아직 없는 확장(`x-oa-sdk-operation-examples` 등)은 payload를 그 operation 바로 위에 두고, 복원된 OpenAPI 결과를 보여 주는 예제나 테스트를 함께 추가합니다.

## 6. 버전 채널 (Versioning)

다음 버전 채널은 서로 독립입니다.

| 채널 | 기준 | 올리는 규칙 |
|---|---|---|
| API 계약 | `version.tsp`의 `ContractVersion`(OpenAPI `info.version`으로 출력) | Semantic Versioning. 기존 소비자를 깨뜨리는 변경(breaking change)은 major, 하위 호환 추가는 minor, 하위 호환 수정은 patch. 1.0 이전에는 breaking change가 `0.MINOR`를 올린다. |
| workspace package | package `version`, Changesets, 릴리스 정책 | 패키지 배포 생명주기. API 스냅샷이 바뀌었다는 이유만으로 바꾸지 않는다. |
| TypeSpec bundle, 확장, candidate, drift, 저장소 간 증거 schema | 각 artifact의 `schemaVersion`과 [artifact compatibility policy](../cli-spec/oa-sdk-artifact-compatibility-policy.v1.json) | 그 artifact의 기계 판독 형식이 호환되지 않게 바뀔 때만 올린다. API 버전이 아니다. 정책이 reader migration을 명시하지 않으면 현재 major schema만 지원한다. |
| 승인 스냅샷 | Git commit과 내용 hash | 자체 semantic version이 없다. 리뷰한 계약 변경 뒤 승인 명령으로만 다시 만든다. |
| 실행 빌드 정보 | 배포 환경, `GET /version` 응답 | 배포 식별자. 그 예제 값이 `ContractVersion`을 정하지 않는다. |

계약 버전을 바꾸면 소유 `.tsp` 변경, 리뷰한 승인 스냅샷, 다시 생성한 `src/.merged.3.1.yaml`([계약 변경 절차](#7-계약-변경-절차-contract-change-workflow) 7·8단계), API diff 요약을 같은 PR에 넣습니다. 소비자가 볼 수 있는 계약 변경이 없는 스냅샷 변경은 버전을 올리지 않아도 됩니다.

PR CI는 base와 head의 승인 스냅샷도 비교합니다. breaking API diff가 있는데 `ContractVersion`이 필요한 만큼 올라가지 않았으면(1.0 이후 major, 1.0 미만 minor) CI가 실패합니다. 이 gate는 `pnpm schema:check-contract-version -- --base-ref <git-ref>`입니다.

## 7. 계약 변경 절차 (Contract Change Workflow)

1. 가장 작은 소유 `.tsp` 모듈을 고칩니다. emitter가 보존하는 모델과 HTTP 의미는 TypeSpec 기본 문법으로 둡니다. 새 엔드포인트의 뼈대는 `oa-gen tsp-scaffold`로 만들 수 있습니다([스캐폴딩 가이드](./typespec/04-scaffolding-and-diff.md#1-typespec-코드-스캐폴딩-oa-gen-tsp-scaffold)).
2. TypeSpec 원본을 의미 단위로 비교해 breaking change를 미리 봅니다. head에 파일 경로를 주면 커밋하지 않은 작업 트리를 비교합니다. `--head HEAD`처럼 git ref를 주면 커밋된 내용끼리 비교하므로 방금 고친 내용이 보이지 않습니다.

   ```bash
   node packages/codegen/dist/cli/index.js tsp diff --base origin/main --head packages/schemas/typespec/main.tsp --fail-on-breaking
   ```

3. 바뀐 API를 mock 서버로 확인하려면 `node packages/codegen/dist/cli/index.js mock --tsp packages/schemas/typespec/main.tsp --watch`를 실행합니다.
4. `pnpm schema:approve-typespec-reference`를 실행합니다. gitignore된 `.oa-sdk/typespec-candidates/`에 candidate를 컴파일·복원하고 정규화된 OpenAPI diff를 출력합니다. 커밋 대상 파일은 바꾸지 않습니다.
5. `.tsp` 변경과 candidate diff를 함께 리뷰합니다. operation, 재사용 컴포넌트, 예제, 보안 규칙이 바뀌면 계약 변경입니다.
6. 승인되면 `pnpm schema:approve-typespec-reference -- --write`를 실행합니다. `approved.openapi.yaml`을 갱신하는 유일한 명령입니다.
7. `pnpm schema:validate`를 실행합니다. `pnpm schema:typespec-check`와 같은 검사, Spectral·Redocly lint, `--require-32` 검증을 실행하고, 커밋하는 생성물 `packages/schemas/src/.merged.3.1.yaml`과 `.merged.3.1.meta.json`을 다시 씁니다. 다운스트림 소비자에 영향을 주는 변경이면 `pnpm schema:downstream-check`도 실행합니다.
8. 소유 `.tsp` 변경, `approved.openapi.yaml`, 7단계가 다시 쓴 `.merged.3.1.yaml`을 같은 PR에 커밋합니다. `.merged.3.1.meta.json`은 OpenAPI 3.2 전용 필드(예제의 `dataValue` 등)가 바뀔 때만 달라지며, 바뀌었으면 함께 커밋합니다. CI는 `@oa-sdk/schemas`를 다시 빌드해 이 파일들이 커밋된 내용과 다르면 `Schema freshness check` 단계에서 `Schema generated files are stale`로 실패합니다.

wire 값 집합을 바꾸는 것은 계약 변경입니다. 이름 있는 alias는 TypeSpec 선언 중복을 줄이지만 이름 있는 OpenAPI schema 컴포넌트를 만들지 않을 수 있습니다. 반대로 공개 컴포넌트나 `$ref` 식별자가 필요하면 이름 있는 기본 `enum`이나 `union`이 필요하고, 이는 출력 계약의 구조를 바꾸므로 candidate diff에서 리뷰해야 합니다. 어느 쪽도 단순 포맷 변경으로 분류하지 않습니다.

승인 스냅샷은 리뷰 가능한 기준선이므로 의도적으로 커밋합니다. candidate는 로컬에서 자주 다시 만들며 manifest 경로와 원본·기준선·candidate hash를 기록합니다. 승격은 항상 그 manifest가 선언한 스냅샷을 쓰고 기준선이 바뀌지 않았는지 확인합니다. 스냅샷은 두 번째 원본이 아니며 일반 빌드가 다시 만들어서는 안 됩니다. 그러면 diff gate가 candidate를 자기 자신과 비교하게 됩니다.

승격이 accepted drift도 함께 지우면, 명령은 커밋 대상 파일을 바꾸기 전에 gitignore된 로컬 승격 journal을 기록합니다. 다음 승인 명령이나 TypeSpec 검증 명령은 두 파일이 기록된 전후 hash와 여전히 같을 때만 그 쌍을 마저 반영합니다. 관련 없는 수동 수정이 있으면 덮어쓰지 않고 복구가 실패합니다.

## 8. 리뷰 증거 (Required Review Evidence)

- 승인 스냅샷 diff가 의도한 변경이다.
- 스냅샷 갱신 뒤 `pnpm schema:typespec-check`가 통과한다.
- `pnpm schema:typespec-provenance-check`가 통과한다. 모든 production operation, 재사용 컴포넌트, `$ref` 출처에 TypeSpec AST 선언이나 버전이 있는 확장의 복원 소유자가 있어야 한다. 로컬 artifact는 증거이지 두 번째 작성 원본이 아니다.
- `accepted-restored-drift.json`이 비어 있거나, 모든 항목이 리뷰되고 복원값·참조값에 hash로 고정되어 있다.
- accepted restored drift를 대체하는 승격은 `--clear-accepted-restored-drift`를 써서 승인 스냅샷과 drift 상태를 함께 리뷰한다.
- 복원 뒤에도 재사용 응답·파라미터 참조가 유효하다.
- `pnpm schema:validate`가 통과하고, 그 명령이 다시 쓴 `src/.merged.3.1.yaml`이 PR에 들어 있다. 다운스트림 변경은 다운스트림 gate도 통과한다.

rollback 경로는 두 번째 작성 경로가 아닙니다. `:openapi` 명령은 되돌릴 수 있음을 증명하거나 실패한 TypeSpec migration을 복구할 때만 쓰고, 생성된 production artifact를 커밋하기 전에 `pnpm schema:validate`를 다시 실행합니다.

## 참고 문서

- [TypeSpec 5분 퀵스타트 (저장소 기여자용)](./typespec/01-quickstart-5min.md)
- [TypeSpec 데코레이터 레퍼런스](./typespec/03-decorators-reference.md)
- [TypeSpec 스캐폴딩 및 Semantic Diff](./typespec/04-scaffolding-and-diff.md)
- [TypeSpec 트러블슈팅](./typespec/05-troubleshooting.md)
- [TypeSpec IDE 설정](./typespec-ide-setup.md)
- [Canonical schema pipeline and governance spec](../internal/spec.md)
- [TypeSpec-first authoring ADR](../internal/architecture/009-typespec-first-authoring.md)
- [Production operations and promotion runbook](../internal/typespec-roundtrip/production-operations.md)
