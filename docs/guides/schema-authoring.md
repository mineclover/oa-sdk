# 스키마 작성 가이드

## 새 API 작성 경로

Production schema authoring is TypeSpec-first. 기본 경로에서는
`packages/schemas/typespec/main.tsp` entrypoint가 import하는 domain `.tsp` source를 수정한 뒤
`pnpm schema:validate`로 production OpenAPI artifact를 재생성/검증한다.

도메인 배치는 `common.tsp`(공통 인증/에러), `auth.tsp`(인증), `health.tsp`(상태/버전),
`me.tsp`(셀프 서비스), `users.tsp`(사용자/관리/모더레이션)이다. `metadata/service.tsp`는
service/info/server/tag, `metadata/security.tsp`는 security scheme,
`metadata/common-components.tsp`는 reusable component registry를 소유한다. 새 operation은
해당 도메인 파일에 추가하고, 새 파일을 만들면 `main.tsp`의 import와 bundle gate를 같이 확인한다.

`main.tsp`는 계약 사실을 직접 담지 않는 composition root다. emitter가 보존하지 못하는
operation component response reference는 `@oa-sdk/typespec-decorators`의
`@oaUseResponseComponent`처럼 좁은 typed helper를 우선 사용한다. 임의 JSON을 받는
generic extension helper는 추가하지 않는다.

OpenAPI fragments are retained as the Definition Builder rollback/reference path.
아래 fragment workflow를 사용할 때는 기본 TypeSpec artifact가 아니라 rollback path를
검증하는 것이므로 `pnpm schema:validate:openapi`를 실행한다.

기본 스펙의 source/artifact/사용처 구분은 [기본 스펙 사용 기준](./basic-spec-usage.md)을
먼저 따른다.

## TypeSpec 배포 환경 projection

배포별 server URL이 필요한 경우에는 TypeSpec contract를 수정하거나 Definition Builder
target을 production source처럼 사용하지 않는다. restored TypeSpec contract에 server 값만
적용하는 profile을 사용한다.

```bash
pnpm schema:project-typespec:local
pnpm schema:project-typespec:staging
pnpm schema:project-typespec:production
```

profile은 `packages/schemas/typespec/oa-sdk.typespec-projections.json`에 있고 결과는
`packages/schemas/src/.projected/`의 gitignored artifact다. path, schema, security,
response 같은 계약 의미를 profile에서 바꾸면 안 된다.

## OpenAPI fragment fallback 추가

1. `packages/schemas/src/fragments/{kind}/{scope}/{domain}/{name}.yaml` 생성
2. canonical `id`와 OpenAPI fragment body를 작성 (아래 템플릿 참고)
3. `pnpm schema:validate:openapi`로 rollback/reference path 검증

```yaml
# fragments/path/public/my-domain/MyResourcePath.yaml
id: path:public/my-domain/MyResourcePath
path: /my-resource
item:
  get:
    tags: [my-domain]
    operationId: listMyResource
    summary: 목록 조회
    responses:
      "200":
        description: 성공
        content:
          application/json:
            schema:
              $ref: oa://schema/public/my-domain/MyResource
```

```yaml
# fragments/schema/public/my-domain/MyResource.yaml
id: schema:public/my-domain/MyResource
content:
  type: object
  required: [id, name]
  properties:
    id:
      type: string
      format: uuid
    name:
      type: string
```

## OAS 3.2 문법 규칙

### Example Object examples — dataValue / serializedValue 사용

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

### Schema Object examples — JSON Schema 배열 사용

Schema Object의 `examples`는 JSON Schema 2020-12 키워드이므로 배열로 작성합니다.
`dataValue` / `serializedValue`는 Media Type, Parameter, Response Header 등의 Example Object에서 사용합니다.

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

### parameters — dataValue / serializedValue

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

## 공통 컴포넌트 재사용

`common` 도메인이 전체 공유 컴포넌트를 제공합니다.  
아래 항목은 모든 도메인에서 `$ref`로 바로 사용 가능합니다.

| $ref | 내용 |
|---|---|
| `#/components/schemas/Error` | 표준 에러 응답 |
| `#/components/schemas/ValidationError` | 필드 검증 에러 |
| `#/components/responses/BadRequest` | 400 공통 응답 |
| `#/components/responses/Unauthorized` | 401 공통 응답 |
| `#/components/responses/Forbidden` | 403 공통 응답 |
| `#/components/responses/NotFound` | 404 공통 응답 |
| `#/components/responses/UnprocessableEntity` | 422 공통 응답 |
| `#/components/responses/InternalServerError` | 500 공통 응답 |
| `#/components/parameters/Page` | 페이지 번호 쿼리 파라미터 |
| `#/components/parameters/Limit` | 페이지 크기 쿼리 파라미터 |
| `#/components/securitySchemes/bearerAuth` | JWT Bearer 인증 |
| `#/components/securitySchemes/oauth2` | OAuth 2.0 인증 |

## 공통 parameters 운영 시나리오

`components.parameters`는 이름, 위치, 직렬화 방식, 기본 제약이 여러 operation에서
동일한 query/path/header parameter에 사용한다. 모든 filter를 범용 객체 하나로
숨기지 말고, 공통 규칙만 component화하고 실제 필터 필드는 operation별로 명시한다.

### Offset pagination

목록 API의 기본 페이지네이션은 `Page`, `Limit`, `Sort`, `SearchQuery`를 재사용한다.

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

    SearchQuery:
      name: q
      in: query
      description: 사용자 입력 검색어
      schema:
        type: string
        minLength: 1
        maxLength: 200
```

operation에서는 공통 parameter를 `$ref`로 가져오고, 리소스별 필터는 직접 작성한다.

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

목록 응답 envelope는 `components.schemas`에 둔다.

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

무한 스크롤, feed, event stream처럼 순서가 고정된 목록은 offset pagination과 섞지 말고
cursor 전용 parameter와 meta schema를 사용한다.

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

### Date range와 audit query

생성일, 수정일, 감사 로그 조회는 공통 parameter 후보지만 의미가 endpoint마다 달라질 수 있다.
동일한 의미로 반복되는 경우에만 component화한다.

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

시간 필터는 inclusive/exclusive 정책을 description에 명시한다. 정책이 다르면 같은
component를 재사용하지 않는다.

### Soft delete와 관리자 전용 옵션

`includeDeleted`, `includeArchived` 같은 parameter는 접근 권한과 강하게 연결된다.
일반 목록 API에 무조건 붙이지 말고, 관리자 API나 audit API에서만 사용한다.

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

생성 시간, 수정 시간, 작성자 같은 서버 관리 필드는 request DTO가 아니라 response DTO에
조합한다.

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

create/update request에는 서버 관리 metadata를 넣지 않는다.

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

### 수집할 운영 시나리오

공통 parameter를 추가하기 전에 아래 항목을 먼저 수집한다.

| 시나리오 | 후보 parameter | component화 기준 |
|---|---|---|
| 기본 목록 조회 | `page`, `limit`, `sort`, `q` | 대부분의 목록 API에서 의미와 제약이 같음 |
| feed/무한 스크롤 | `cursor`, `limit` | 정렬 기준이 고정되고 cursor가 opaque 값임 |
| 기간 조회 | `createdAfter`, `createdBefore`, `updatedAfter`, `updatedBefore` | inclusive/exclusive 정책이 동일함 |
| soft delete | `includeDeleted`, `includeArchived` | 권한 정책과 노출 범위가 동일함 |
| multi-tenant path/query | `orgId`, `workspaceId`, `tenantId` | 위치와 이름이 API 전체에서 안정적임 |
| 리소스별 필터 | `role`, `status`, `type`, `state` | component화하지 않고 operation별로 enum과 의미를 명시함 |

## `$ref` 작성 규칙

참조 문법은 입력 층에 따라 다르다. Definition Builder fragment에서는 source identity를
보존하기 위해 `oa://kind/scope/domain/name`을 사용하고, 조립된 OpenAPI artifact나 외부
OpenAPI 문서에서는 `#/components/...` 또는 지원되는 상대 file ref를 사용한다. 두 문법을
같은 파일의 규칙으로 간주하지 않는다.

### 내부 `$ref`

조립된 OpenAPI artifact의 내부 참조는 `#/components/...` 형태를 기본으로 사용합니다. 누락된
내부 참조는 `oa-gen lint`와 `oa-gen validate`에서 `refs/valid-ref` 오류로 보고됩니다.

```yaml
schema:
  $ref: "#/components/schemas/User"
```

### 외부 YAML/JSON `$ref`

상대 경로 외부 참조를 사용할 수 있습니다. CLI는 spec 파일 경로를 기준으로 외부 파일을 해소합니다.

```yaml
schema:
  $ref: "./shared.yaml#/components/schemas/User"
```

외부 파일 누락, 포인터 누락, 순환 참조는 `filePath#pointer` 형태의 source와 함께 출력됩니다.

### `$ref` sibling 보존

`description`, `readOnly`, `annotations`, `properties`, `required` 같은 sibling 구조 정보는 `$ref` 해소 후에도 보존됩니다.

```yaml
id:
  $ref: "#/components/schemas/Uuid"
  readOnly: true
  description: 서버가 발급하는 ID
```

### 순환 `$ref`

기본 deref 동작은 순환 지점을 빈 스키마로 끊어 기존 mock/typegen 호환성을 유지합니다. 구조 손실을 줄여야 하는 파서 소비자는 `cycleStrategy: preserve-ref`를 사용할 수 있습니다.

### 외부 schema 이름 충돌

외부 파일에서 같은 schema 이름이 들어오면 typegen은 파일명 기반 타입명으로 rename하고 경고를 출력합니다.

```yaml
# ./billing.yaml#/components/schemas/User → BillingUser
# ./identity.yaml#/components/schemas/User → IdentityUser
```

로컬 component와 외부 schema 이름이 충돌해도 외부 schema는 파일명 기반 타입명으로 생성됩니다.

## Component 이름 충돌

Definition Builder target 안에서 같은 output component name이 충돌하면 기본 오류입니다.
해결은 source 이름 변경이 아니라 target-local naming policy 또는 명시 alias로 처리합니다.

## operationId 컨벤션

- 필수 (없으면 Spectral 오류)
- camelCase (없으면 Spectral 경고)
- 패턴: `{동사}{리소스}` — `listUsers`, `createOrder`, `getItemById`
