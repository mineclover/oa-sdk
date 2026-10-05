---
docType: guide
sourceLocale: ko
canonical: true
audience:
  competence: competent
productVersions:
  - "@oa-sdk/codegen 0.9.0"
  - "@oa-sdk/parser 0.4.0"
  - "OA SDK API contract 0.5.0"
owner: "OA SDK maintainers"
status: active
lastReviewed: "2026-10-06"
sourceOfTruth:
  - packages/schemas/typespec/
  - packages/schemas/typespec/approved.openapi.yaml
  - packages/schemas/.spectral.yaml
---

# 스키마 작성 가이드 (TypeSpec·OpenAPI 작성 규칙)

> 1~3절은 oa-sdk 저장소 기여자용입니다(`packages/schemas`). 4~8절의 OpenAPI 3.2 문법, 공통 parameter,
> `$ref` 규칙은 OpenAPI 문서를 원본으로 쓰는 경우(이 저장소의 rollback fragment, 외부 서비스 계약,
> `oa.config.ts`의 `schemaEntry`가 YAML·JSON인 프로젝트)에 적용됩니다. 다른 프로젝트에서 처음 시작하려면
> [Quick Start](./quick-start.md)를 따릅니다.

관련 문서:

- [기본 스펙 사용 기준](./basic-spec-usage.md): 원본과 생성물의 구분, 계약 변경 작업 순서
- [TypeSpec 데코레이터 레퍼런스](./typespec/03-decorators-reference.md): TypeSpec 문법과 작성 패턴
- [Schema Annotations](./schema-annotations.md): 스키마 안의 작성자 메모(`$comment`, `annotations`)
- [Path Fragment Conventions](./path-fragment-conventions.md), [Duplicate Review](./duplicate-review.md): rollback 경로 fragment 규칙

## 1. 새 API 작성 경로 (저장소)

이 저장소의 production 계약은 TypeSpec으로 씁니다. `packages/schemas/typespec/main.tsp`가 import하는 모듈을
고친 뒤 [기본 스펙 사용 기준 3절](./basic-spec-usage.md#3-계약-변경-작업-순서)의 순서로 승인 snapshot을 갱신하고
`pnpm schema:validate`로 검증합니다.

| 모듈 | 소유하는 내용 |
|---|---|
| `common.tsp` | 공통 인증·오류 모델, 명시적으로 소유한 공유 값 집합 |
| `auth.tsp`, `health.tsp`, `me.tsp`, `users.tsp`, `world-model.tsp` | 인증, 상태·버전, 셀프 서비스, 사용자·관리·모더레이션, World Model 제어·projection |
| `metadata/service.tsp` | service, info, server, tag |
| `metadata/security.tsp` | security scheme |
| `metadata/common-components.tsp` | 재사용 parameter·response component |

새 operation은 해당 도메인 모듈에 추가합니다. 새 모듈을 만들면 `main.tsp`에 import를 추가합니다.
`main.tsp`는 계약 내용을 직접 담지 않습니다.

TypeSpec emitter가 보존하지 못하는 OpenAPI 의미는 `@oa-sdk/typespec-decorators`의 좁은 helper로 씁니다.
예를 들어 재사용 response component 참조는 `@oaUseResponseComponent("400", "BadRequest")`로 씁니다. 임의
JSON을 받는 일반 extension helper는 추가하지 않습니다([extension 선택 순서](./typespec-authoring-conventions.md#extension-convention)).

`@oaUseResponseComponent`와 `@extension("x-oa-sdk-operation-component-refs" | "-examples" | "-security", ...)`은
번들 restore 경로(`pnpm schema:typespec-check`, `pnpm schema:validate`)에서만 실제 OpenAPI 응답·예제·security로
바뀝니다. `oa-gen`의 메모리 컴파일 경로(`oa-gen mock --tsp`, `.tsp`를 넣은 `validate`·`typegen`·`generate`)는
extension만 남기므로, 그 경로의 결과에는 해당 4xx 응답이 없습니다. 외부 프로젝트에서 4xx 응답을 선언할 때는
`ErrorResponse<Status>`나 `StandardHttpErrors`를 씁니다([`@oa-sdk/typespec-decorators` README](../../packages/typespec-decorators/README.md)).

production 모듈의 operation별 응답 모델(`RequestUsersExport202Response` 등)과 `x-oa-sdk-operation-*`
extension은 OpenAPI 원본을 TypeSpec으로 옮길 때 만든 형태입니다. 표준 계약(`Ok<T>`, `ErrorResponse<Status>`)은
production 모듈에서 쓰지 않습니다. 형태를 바꾸면 승인 후보 diff에 응답 구조 변경으로 나타나므로, 계약 변경으로
검토합니다.

## 2. TypeSpec enum과 값 집합 (저장소)

production enum은 OA SDK extension이나 `metadata/common-components.tsp`가 아니라 도메인 `.tsp`의 TypeSpec
선언입니다. OpenAPI `enum`은 literal union 등의 선언에서 생성되므로, 생성된 `.merged.yaml`에 값을 추가하거나
enum 전용 `x-oa-sdk-*` extension을 만들지 않습니다.

| 상황 | 작성 규칙 |
|---|---|
| 한 model·property에서만 쓰는 닫힌 값 집합 | 그 위치에 literal union을 인라인으로 쓴다. |
| 한 도메인 안에서 여러 model·property·parameter가 같은 wire 값 집합을 공유 | 가장 작은 소유 도메인 `.tsp`에 named `alias`를 두고 재사용한다. 원본 중복을 줄이는 방법일 뿐, 생성 결과가 `components.schemas` `$ref`가 된다고 가정하지 않는다. |
| 리소스별 query filter | parameter 선언과 `@doc`을 operation에 둔다. `role`, `status`, `type`, `state`를 공통 parameter component로 올리지 않는다. 같은 값 집합이면 도메인 alias를 쓸 수 있지만, operation별 의미·권한·직렬화 규칙은 따로 적는다. |
| 공개 OpenAPI에서 named schema component나 `$ref` identity가 필요 | named TypeSpec `enum`이나 `union`을 쓰고 승인 후보 diff에서 component 구조를 검토한다. 원본 정리가 아니라 공개 계약 형태의 변경이다. |
| 여러 도메인에 걸치지만 소유자가 분명하지 않은 값 집합 | `metadata/common-components.tsp`에 임시 전역 enum을 만들지 않는다. 계약 리뷰에서 소유자와 공개 재사용 여부를 먼저 정한다. |

```typespec
// users.tsp — 같은 wire 값 집합을 도메인 안에서 재사용하는 경우
alias ReportStatus = "open" | "under-review" | "resolved" | "dismissed";

model Report {
  status: ReportStatus;
}

// operation은 filter의 의미를 계속 소유한다.
op listReports(
  @doc("신고 상태 필터") @query status?: ReportStatus,
): Report[];
```

named literal alias는 property·parameter의 `type: string` + `enum`으로 투영됩니다(별도 component가 생기지 않음).
wire 값의 추가·삭제·이름 변경은 선언이 짧아도 계약 변경이므로 [기본 스펙 사용 기준 3절](./basic-spec-usage.md#3-계약-변경-작업-순서)을 그대로 따릅니다.

## 3. 배포 환경 projection과 rollback 경로 (저장소)

### 배포 환경 server URL

배포별 server URL은 TypeSpec 계약을 고치거나 Definition Builder target을 원본처럼 써서 바꾸지 않습니다.
복원한 계약에 server 값만 적용하는 profile을 씁니다.

```bash
pnpm schema:project-typespec:local
pnpm schema:project-typespec:staging
pnpm schema:project-typespec:production
```

profile은 `packages/schemas/typespec/oa-sdk.typespec-projections.json`에 있고 결과는 git이 무시하는
`packages/schemas/src/.projected/`에 생깁니다. profile에서 path, schema, security, response 같은 계약 의미를 바꾸지 않습니다.

### OpenAPI fragment rollback 경로

`packages/schemas/src/fragments/`의 OpenAPI YAML fragment는 새 API를 쓰는 곳이 아니라, TypeSpec 도입 이전
Definition Builder 빌드와의 정합성을 지키는 rollback·참조 경로입니다. fragment를 고쳐야 하면 다음을 따릅니다.

1. **폴더와 파일 이름**: URL 계층을 폴더로 반영하고 path parameter는 `by-{param-name}` 폴더로 씁니다([Path Fragment Conventions](./path-fragment-conventions.md)).
2. **canonical ID**: `kind:scope/domain/name` 형식이며 URL 깊이와 무관하게 평탄하게 유지합니다.
3. **중복·충돌 검토**: [Duplicate Review](./duplicate-review.md)로 확인합니다.
4. **검증**: `pnpm schema:rollback-check`를 씁니다. TypeSpec 검사와 rollback 경로 검증(`pnpm schema:validate:openapi`)을 실행한 뒤 `packages/schemas/src/`를 실행 전 상태로 되돌립니다.

`pnpm schema:validate:openapi`를 직접 실행하면 추적 중인 `packages/schemas/src/.merged.3.1.yaml`과
`.merged.3.1.meta.json`이 rollback 결과로 덮어써집니다. 이때는 커밋 전에 `pnpm schema:validate`를 다시 실행해
TypeSpec 결과로 되돌립니다.

## 4. OpenAPI 3.2 문법 규칙

이 절의 YAML은 OpenAPI 문서에 직접 쓰는 형태입니다. TypeSpec 원본에서는 다음과 같이 씁니다.

| 규칙 | TypeSpec에서 |
|---|---|
| Schema Object `examples` 배열 | model에 `@example(#{ ... })`를 붙이면 `examples: [...]`가 생성됩니다. |
| Example Object `dataValue`·`serializedValue` | `@opExample`은 media type에 3.1 형식의 `example`을 만듭니다. 이 저장소의 production 모듈은 `@extension("x-oa-sdk-operation-examples", ...)`으로 쓰고 번들 restore가 Example Object로 바꿉니다(1절의 restore 경로 제한이 같이 적용). |
| SSE `itemSchema` | `@typespec/sse`의 `SSEStream<T>`와 `@events` union으로 씁니다(`health.tsp`의 `streamHealthEvents`). 생성 결과에 `itemSchema`가 들어갑니다. |
| `discriminator.defaultMapping` | TypeSpec `@discriminator`는 `propertyName`과 `mapping`만 만듭니다. `defaultMapping`이 필요하면 OpenAPI 문서 원본에서 씁니다. |

### Example Object: `dataValue`·`serializedValue`

```yaml
# ✅ OAS 3.2 방식
examples:
  default:
    dataValue:
      id: "123e4567-e89b-12d3-a456-426614174000"
      name: "예시 이름"
    serializedValue: '{"id":"123e4567-...","name":"예시 이름"}'

# ❌ OAS 3.1 방식 — 사용 금지
examples:
  default:
    value:
      id: "..."
```

### Schema Object `examples`: JSON Schema 배열

Schema Object의 `examples`는 JSON Schema 2020-12 키워드이므로 배열로 씁니다. `dataValue`·`serializedValue`는
Media Type, Parameter, Response Header 등의 Example Object에서만 씁니다.

```yaml
components:
  schemas:
    User:
      type: object
      examples:
        - id: "123e4567-e89b-12d3-a456-426614174000"
          name: "예시 이름"
```

### SSE 엔드포인트

```yaml
/events:
  get:
    operationId: streamEvents
    responses:
      "200":
        content:
          text/event-stream:
            schema:
              type: string
            itemSchema:           # OAS 3.2 전용
              $ref: "#/components/schemas/EventPayload"
```

### parameter 예제

```yaml
parameters:
  - name: page
    in: query
    schema:
      type: integer
      default: 1
    examples:
      default:
        dataValue: 1
        serializedValue: "page=1"
```

### discriminator `defaultMapping`

OpenAPI 3.2의 `discriminator.defaultMapping`은 `mapping`에 없는 discriminant 값에 쓸 기본 스키마를 선언합니다.
`oa-gen generate:zod`는 `defaultMapping`이 있으면 `z.discriminatedUnion(...)`과 기본 스키마를 `z.union([...])`으로 묶습니다.

```yaml
components:
  schemas:
    Event:
      type: object
      required: [eventType]
      properties:
        eventType:
          type: string
      discriminator:
        propertyName: eventType
        mapping:
          user_created: "#/components/schemas/UserCreatedEvent"
          user_updated: "#/components/schemas/UserUpdatedEvent"
        defaultMapping: "#/components/schemas/GenericEvent" # OAS 3.2 전용 기본 스키마
```

## 5. 공통 컴포넌트 (저장소 production 계약)

이 저장소의 production 계약에서 모든 도메인이 참조할 수 있는 component입니다. response·parameter는
`metadata/common-components.tsp`, schema는 `common.tsp`, security scheme은 `metadata/security.tsp`가 소유합니다.
목록은 `packages/schemas/typespec/approved.openapi.yaml`의 `components`와 같습니다.

| `$ref` | 내용 |
|---|---|
| `#/components/schemas/Error` | 표준 오류 응답(`code`, `message`, `details?`, `_meta?`) |
| `#/components/schemas/ValidationError` | 필드 검증 오류 |
| `#/components/responses/BadRequest` | 400 |
| `#/components/responses/Unauthorized` | 401 |
| `#/components/responses/Forbidden` | 403 |
| `#/components/responses/NotFound` | 404 |
| `#/components/responses/Conflict` | 409 |
| `#/components/responses/UnprocessableEntity` | 422 |
| `#/components/responses/TooManyRequests` | 429 |
| `#/components/responses/InternalServerError` | 500 |
| `#/components/responses/ServiceUnavailable` | 503 |
| `#/components/parameters/Page` | 페이지 번호 query parameter |
| `#/components/parameters/Limit` | 페이지 크기 query parameter |
| `#/components/securitySchemes/bearerAuth` | JWT Bearer 인증. production operation은 이것만 쓴다 |
| `#/components/securitySchemes/oauth2` | OAuth 2.0 placeholder. 아직 operation 인증 요구사항이 아니다 |

`Error`는 RFC 9457(`application/problem+json`) 형식이 아닙니다. TypeSpec 모듈에서는 response를
`@oaUseResponseComponent`나 component-refs extension으로 참조합니다(1절의 restore 경로 제한 참고).

## 6. 공통 parameter 운영 시나리오 (OpenAPI 문서)

`components.parameters`는 이름, 위치, 직렬화 방식, 기본 제약이 여러 operation에서 같은 query·path·header
parameter에 씁니다. 모든 filter를 범용 객체 하나에 숨기지 말고, 공통 규칙만 component로 만들고 실제 filter
필드는 operation별로 씁니다.

이 저장소의 production 계약에 있는 공통 parameter는 `Page`와 `Limit`뿐입니다. 아래의 `Sort`, `SearchQuery`,
`Cursor`, `CreatedAfter`, `UpdatedBefore`, `IncludeDeleted`, `TimestampMeta`, `ActorMeta`는 후보 패턴이며,
도입하려면 계약 리뷰에서 먼저 정합니다.

### Offset pagination

목록 API의 기본 페이지네이션은 `Page`, `Limit`를 재사용합니다. 정렬·검색이 필요하면 `Sort`, `SearchQuery` 같은 후보를 검토합니다.

```yaml
components:
  parameters:
    Page:
      name: page
      in: query
      description: 1부터 시작하는 페이지 번호
      schema:
        type: integer
        minimum: 1
        default: 1
      examples:
        first:
          dataValue: 1
          serializedValue: "page=1"

    Limit:
      name: limit
      in: query
      description: 페이지 크기
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      examples:
        default:
          dataValue: 20
          serializedValue: "limit=20"

    # 후보 패턴
    Sort:
      name: sort
      in: query
      description: 정렬 필드. `-createdAt`은 내림차순이다.
      schema:
        type: string
      examples:
        createdAtAsc:
          dataValue: "createdAt"
          serializedValue: "sort=createdAt"
        createdAtDesc:
          dataValue: "-createdAt"
          serializedValue: "sort=-createdAt"

    # 후보 패턴
    SearchQuery:
      name: q
      in: query
      description: 사용자 입력 검색어
      schema:
        type: string
        minLength: 1
        maxLength: 200
```

operation은 공통 parameter를 `$ref`로 가져오고, 리소스별 filter는 직접 씁니다.

```yaml
paths:
  /users:
    get:
      operationId: listUsers
      parameters:
        - $ref: "#/components/parameters/Page"
        - $ref: "#/components/parameters/Limit"
        - $ref: "#/components/parameters/Sort"
        - $ref: "#/components/parameters/SearchQuery"
        - name: role
          in: query
          schema:
            type: string
            enum: [admin, user, guest]
        - name: status
          in: query
          schema:
            type: string
            enum: [active, suspended]
```

목록 응답 envelope는 `components.schemas`에 둡니다.

```yaml
components:
  schemas:
    PageMeta:
      type: object
      required: [page, limit, total]
      properties:
        page:
          type: integer
        limit:
          type: integer
        total:
          type: integer

    UserListResponse:
      type: object
      required: [items, meta]
      properties:
        items:
          type: array
          items:
            $ref: "#/components/schemas/User"
        meta:
          $ref: "#/components/schemas/PageMeta"
```

### Cursor pagination

무한 스크롤, feed, event stream처럼 순서가 고정된 목록은 offset pagination과 섞지 말고 cursor 전용 parameter와
meta schema를 씁니다.

```yaml
components:
  parameters:
    Cursor:
      name: cursor
      in: query
      description: 다음 페이지 조회를 위한 opaque cursor
      schema:
        type: string

  schemas:
    CursorMeta:
      type: object
      required: [hasNextPage]
      properties:
        nextCursor:
          type: string
        hasNextPage:
          type: boolean
```

```yaml
paths:
  /activity-feed:
    get:
      operationId: listActivityFeed
      parameters:
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
```

### 기간 조회와 감사 조회

생성일, 수정일, 감사 로그 조회는 공통 parameter 후보지만 endpoint마다 의미가 달라질 수 있습니다. 같은 의미로
반복될 때만 component로 만듭니다.

```yaml
components:
  parameters:
    CreatedAfter:
      name: createdAfter
      in: query
      description: 이 시각 이후 생성된 항목만 조회
      schema:
        type: string
        format: date-time

    UpdatedBefore:
      name: updatedBefore
      in: query
      description: 이 시각 이전 수정된 항목만 조회
      schema:
        type: string
        format: date-time
```

시간 filter는 경계 포함 여부를 description에 적습니다. 정책이 다르면 같은 component를 재사용하지 않습니다.

### soft delete와 관리자 전용 옵션

`includeDeleted`, `includeArchived` 같은 parameter는 접근 권한과 강하게 연결됩니다. 일반 목록 API에 붙이지 말고
관리자 API나 감사 API에서만 씁니다.

```yaml
components:
  parameters:
    IncludeDeleted:
      name: includeDeleted
      in: query
      description: 삭제 처리된 항목을 포함한다. 관리자 권한이 필요하다.
      schema:
        type: boolean
        default: false
```

### 공통 metadata schema

생성 시각, 수정 시각, 작성자 같은 서버 관리 필드는 request DTO가 아니라 response DTO에 조합합니다.

```yaml
components:
  schemas:
    TimestampMeta:
      type: object
      required: [createdAt, updatedAt]
      properties:
        createdAt:
          type: string
          format: date-time
          readOnly: true
        updatedAt:
          type: string
          format: date-time
          readOnly: true

    ActorMeta:
      type: object
      properties:
        createdBy:
          type: string
          format: uuid
          readOnly: true
        updatedBy:
          type: string
          format: uuid
          readOnly: true

    User:
      allOf:
        - type: object
          required: [id, email]
          properties:
            id:
              type: string
              format: uuid
              readOnly: true
            email:
              type: string
              format: email
        - $ref: "#/components/schemas/TimestampMeta"
        - $ref: "#/components/schemas/ActorMeta"
```

create·update request에는 서버 관리 metadata를 넣지 않습니다.

```yaml
components:
  schemas:
    CreateUserRequest:
      type: object
      required: [email]
      properties:
        email:
          type: string
          format: email
```

### component로 만들기 전에 모을 시나리오

| 시나리오 | 후보 parameter | component로 만드는 기준 |
|---|---|---|
| 기본 목록 조회 | `page`, `limit`, `sort`, `q` | 대부분의 목록 API에서 의미와 제약이 같음 |
| feed·무한 스크롤 | `cursor`, `limit` | 정렬 기준이 고정되고 cursor가 opaque 값임 |
| 기간 조회 | `createdAfter`, `createdBefore`, `updatedAfter`, `updatedBefore` | 경계 포함 정책이 같음 |
| soft delete | `includeDeleted`, `includeArchived` | 권한 정책과 노출 범위가 같음 |
| multi-tenant path·query | `orgId`, `workspaceId`, `tenantId` | 위치와 이름이 API 전체에서 안정적임 |
| 리소스별 filter | `role`, `status`, `type`, `state` | component로 만들지 않고 operation별로 enum과 의미를 적음 |

## 7. `$ref` 작성 규칙

참조 문법은 입력 층에 따라 다릅니다. Definition Builder fragment는 원본 identity를 보존하려고
`oa://kind/scope/domain/name`을 쓰고, 조립된 OpenAPI 생성물이나 외부 OpenAPI 문서는 `#/components/...`나
상대 파일 ref를 씁니다. 두 문법을 같은 파일의 규칙으로 섞지 않습니다.

### 내부 `$ref`

OpenAPI 문서 안의 참조는 `#/components/...` 형태를 기본으로 씁니다. 대상이 없는 참조는 `oa-gen lint`와
`oa-gen validate`가 `refs/valid-ref` 오류로 보고합니다.

```yaml
schema:
  $ref: "#/components/schemas/User"
```

### 외부 YAML·JSON `$ref`

상대 경로 외부 참조를 쓸 수 있습니다. CLI는 spec 파일 위치를 기준으로 외부 파일을 찾습니다.

```yaml
schema:
  $ref: "./shared.yaml#/components/schemas/User"
```

외부 파일 누락, pointer 누락, 순환 참조는 `filePath#pointer` 형태의 위치와 함께 출력됩니다.

### `$ref` 옆 필드

`$ref` 옆에 적은 필드는 `$ref`가 어느 위치에 있느냐에 따라 다르게 다룹니다.

- **Schema Object 안(`properties`, `items` 등)**: `description`, `readOnly`, `annotations`, `properties`, `required` 같은 옆 필드가 해석 후에도 보존됩니다. 아래 예에서 typegen은 `readonly id: Uuid`와 `/** 서버가 발급하는 ID */`를 만듭니다.
- **parameter, requestBody, response, callback 위치(Reference Object)**: OpenAPI 3.2 규칙에 따라 `summary`·`description`만 대상을 덮어쓸 수 있습니다(parameter·requestBody는 `description`, response는 둘 다, callback은 없음). `oa-gen typegen`과 `oa-gen generate:client --pack`은 그 외의 옆 필드(`required`, `schema`, `content` 등)를 무시하고, mock 서버가 쓰는 기본 파이프라인(deref pass)은 병합합니다. 도구마다 결과가 달라지지 않도록 이 위치에는 `summary`·`description`만 씁니다([parser 0.4.0 변경 이력](../../packages/parser/CHANGELOG.md)).

```yaml
id:
  $ref: "#/components/schemas/Uuid"
  readOnly: true
  description: 서버가 발급하는 ID
```

### 순환 `$ref`와 재귀 스키마

카테고리 트리나 계층형 댓글처럼 자기 자신이나 서로를 참조하는 스키마는 다음과 같이 처리됩니다.

1. **TypeSpec 원본**: 재귀 모델은 타입 참조로 그대로 씁니다(`model Category { parent?: Category; children?: Category[]; }`).
2. **OpenAPI 3.2·JSON Schema 2020-12**: 순환 `$ref`(`$ref: "#/components/schemas/Category"`)를 그대로 둡니다.
3. **parser 판정**: 순환이 instance 하위로 내려가는 키워드(`properties`, `items` 등)를 지나면 유효한 재귀로 보고 진단하지 않습니다. 하위로 내려가지 않고 제자리에서 도는 순환(예: `A: { $ref: B }`, `B: { $ref: A }`)만 `refs/cycle` 오류입니다. 순환 여부는 (문서, JSON pointer) 쌍으로 판단하므로 외부 파일을 거쳐 돌아오는 순환도 잡습니다. 이 오류는 `oa-gen lint`가 보고합니다. `oa-gen validate`는 현재 `refs/cycle`을 모두 걸러 내므로 이런 순환이 있어도 통과합니다(알려진 결함). 순환 점검에는 `oa-gen lint --spec <파일>`을 함께 실행합니다.
4. **parser 역참조(`derefSpec`의 `cycleStrategy`)**:
   - `empty-schema`(기본값): 순환 진입 지점을 빈 스키마(`{}`)로 끊습니다. mock 서버가 이 방식을 씁니다.
   - `preserve-ref`: 순환 지점의 `$ref`를 진입 문서 기준 표기로 남깁니다.
5. **코드 생성**: `oa-gen generate:zod`는 순환 component를 찾아 `z.lazy(() => CategorySchema)`로 감쌉니다.

### 외부 schema 이름 충돌

외부 파일에서 같은 이름의 schema가 들어오면 typegen은 파일 이름을 붙인 타입명으로 바꾸고 경고를 출력합니다.
로컬 component와 이름이 겹쳐도 외부 schema가 파일 이름을 붙인 타입명을 받습니다.

```yaml
# ./billing.yaml#/components/schemas/User → BillingUser
# ./identity.yaml#/components/schemas/User → IdentityUser
```

## 8. component 이름 충돌과 operationId

Definition Builder target 안에서 같은 출력 component 이름이 충돌하면 기본적으로 오류입니다. 원본 이름을
바꾸지 말고 target의 이름 정책이나 명시적 alias로 해결합니다([Duplicate Review](./duplicate-review.md)).

operationId 규칙:

- 필수입니다. 이 저장소의 Spectral 규칙(`packages/schemas/.spectral.yaml`, `pnpm schema:validate`가 실행)은 operationId가 없으면 오류(`operation-operationId`)입니다. `oa-gen lint`는 없으면 info(`style/operationId`), 중복이면 오류(`operations/unique-operationId`)로 보고합니다.
- camelCase로 씁니다. 같은 Spectral 규칙이 아니면 경고(`operation-id-camel-case`)합니다.
- `{동사}{리소스}` 형태: `listUsers`, `createOrder`, `getItemById`
