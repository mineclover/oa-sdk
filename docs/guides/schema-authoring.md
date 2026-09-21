# 스키마 작성 가이드 (TypeSpec & OpenAPI 3.2 Practical Authoring Playbook)

> 🧭 **스펙 문서 체계 안내 (Schema Triad SSOT)**:
> - **[가이드 종합 색인 및 아키텍처 지도](./README.md)**: 선언자(Author)와 소비자(Consumer) 트랙별 전체 가이드 맵과 추천 읽기 경로를 제공합니다.
> - **[기본 스펙 사용 기준](./basic-spec-usage.md)**: 저장소 스펙 거버넌스 및 산출물 소유권 SSOT. 어떤 파일이 정본(SSOT)이고 어떤 파일이 생성물(Generated Artifact)인지, 다운스트림 패키지가 어떤 산출물을 소비하는지 정의합니다.
> - **[순수 타입 선언 및 가드 실무 가이드](./pure-types-and-guards.md)**: HTTP 엔드포인트 없는 순수 데이터 모델/DTO 선언, 타입 생성 및 제로-eval 독립형 가드 실무를 다룹니다.
> - **[스키마 작성 가이드 (현재 문서)](./schema-authoring.md)**: 실무 TypeSpec & OpenAPI 3.2 작성 플레이북. TypeSpec 도메인 모델, 오퍼레이션, 파라미터, OAS 3.2 신규 문법(dataValue, itemSchema, defaultMapping) 실무 작성 규칙을 다룹니다.
> - **[TypeSpec 데코레이터 레퍼런스 및 8대 실전 작성 패턴](./typespec/03-decorators-reference.md)**: Core, HTTP, OpenAPI, 정밀 제약, 다형성 데코레이터 및 8대 실전 .tsp 작성 패러다임 바이블을 다룹니다.
> - **[스키마 아키텍처 및 작성 규칙](./schema-architecture-and-conventions.md)**: 4단계 TypeSpec-First 파이프라인 SSOT (TypeSpec $\rightarrow$ JSON Schema 2020-12 $\rightarrow$ OAS 3.1/3.2 $\rightarrow$ Standalone AJV Type Guards with zero eval for Chrome MV3 CSP) 및 비디오 트랜지션 파라미터 다양화 표준을 다룹니다.
> - **[패스 프래그먼트 컨벤션](./path-fragment-conventions.md)**: Definition Builder 롤백/참조 경로용 YAML 프래그먼트 작성 규칙 및 폴더 계층 표준을 다룹니다.
> - **[선언적 스펙 설정 가이드](./declarative-spec-configuration.md)**: `oa.config.ts`의 이중 레이어 구조(`core` vs `product`), 라이프사이클 아키타입(`mvp`, `microservice`, `enterprise`), 출력 경로 라우팅(`outputRouting`) 설정 표준을 다룹니다.

## 새 API 작성 경로

Production schema authoring is TypeSpec-first. 기본 개발 경로에서는
`packages/schemas/typespec/main.tsp` entrypoint가 import하는 domain `.tsp` source를 수정한 뒤
`pnpm schema:validate`로 production OpenAPI artifact를 재생성/검증한다.

도메인 배치는 `common.tsp`(공통 인증/에러/명시적으로 소유한 공유 wire vocabulary), `auth.tsp`(인증), `health.tsp`(상태/버전),
`me.tsp`(셀프 서비스), `users.tsp`(사용자/관리/모더레이션),
`world-model.tsp`(World Model 제어/프로젝션)이다. `metadata/service.tsp`는
service/info/server/tag, `metadata/security.tsp`는 security scheme,
`metadata/common-components.tsp`는 reusable parameter/response component registry를 소유한다.
새 operation은 해당 도메인 파일에 추가하고, 새 파일을 만들면 `main.tsp`의 import와 bundle gate를 같이 확인한다.

`main.tsp`는 계약 사실을 직접 담지 않는 composition root다. emitter가 보존하지 못하는
operation component response reference는 `@oa-sdk/typespec-decorators`의
`@oaUseResponseComponent`처럼 좁은 typed helper를 우선 사용한다. 임의 JSON을 받는
generic extension helper는 추가하지 않는다.

OpenAPI fragments are retained as the Definition Builder rollback/reference path.
아래 fragment workflow를 사용할 때는 기본 TypeSpec artifact가 아니라 rollback path를
검증하는 것이므로 `pnpm schema:validate:openapi`를 실행한다.

기본 스펙의 source/artifact/사용처 구분은 [기본 스펙 사용 기준](./basic-spec-usage.md)을
먼저 따른다.

## TypeSpec enum 및 value vocabulary 작성

Production enum은 OA SDK extension이나 `metadata/common-components.tsp` catalog가 아니라
도메인 `.tsp`의 TypeSpec-native schema fact다. OpenAPI `enum`은 TypeSpec literal union 등의
선언으로부터 생성되므로, 생성된 `.merged.yaml`에 값을 직접 추가하거나 enum 전용
`x-oa-sdk-*` extension을 만들지 않는다.

| 상황 | 작성 규칙 |
|---|---|
| 한 model/property에서만 쓰는 닫힌 값 집합 | 해당 사용 위치에 literal union을 인라인으로 작성한다. |
| 명확한 도메인 안에서 여러 model/property/parameter가 정확히 같은 wire value 집합을 공유 | 가장 작은 owning domain `.tsp`에 named `alias`를 두고 재사용한다. 이는 source 중복을 줄이는 방식이며, emitter 결과가 자동으로 `components.schemas` `$ref`가 된다고 가정하지 않는다. |
| 리소스별 query filter | parameter 선언과 `@doc`을 operation에 남긴다. `role`, `status`, `type`, `state`를 공통 parameter component로 승격하지 않는다. 같은 value vocabulary를 정확히 공유한다면 domain alias를 사용할 수 있지만, 각 operation의 의미·권한·직렬화 규칙은 별도로 명시한다. |
| 공개 OpenAPI에서 named schema component / `$ref` identity가 필요한 경우 | named native TypeSpec `enum` 또는 `union` 후보를 작성하고 candidate OpenAPI diff로 component topology를 검토한다. literal-union alias만으로 component identity를 가정하지 않는다. 이는 source 정리가 아니라 public contract shape 변경이다. |
| 여러 도메인에 걸치지만 명확한 owner가 없는 값 집합 | `metadata/common-components.tsp`에 임시 global enum registry를 만들지 않는다. contract review에서 owner와 public reuse 필요성을 먼저 결정한다. |

```typespec
// users.tsp — 같은 wire vocabulary를 domain 안에서 재사용하는 경우
alias ReportStatus = "open" | "under-review" | "resolved" | "dismissed";

model Report {
  status: ReportStatus;
}

// operation은 filter의 의미를 계속 소유한다.
op listReports(
  @doc("신고 상태 필터") @query status?: ReportStatus,
): Report[];
```

현재 emitter에서 named literal alias는 property/parameter의 OpenAPI `type: string` + `enum`
표현으로 투영될 수 있다. 따라서 alias 도입은 source-level reuse의 선택이지, 별도 OpenAPI
component를 보장하거나 요구하는 선택이 아니다.

### Enum 값 변경 관리

wire value의 추가, 제거, 이름 변경은 TypeSpec 선언이 짧더라도 contract change로 취급한다.
owning `.tsp`를 수정한 뒤 `pnpm schema:approve-typespec-reference`로 normalized OpenAPI diff를
검토하고, 승인된 경우에만 `--write`로 snapshot을 갱신한다. 이후 `pnpm schema:validate`를
실행하고 downstream consumer에 영향이 있으면 `pnpm schema:downstream-check`를 실행한다.
API `ContractVersion`, workspace package version, TypeSpec bundle/extension `schemaVersion`은
서로 다른 version channel이므로 enum 변경만으로 서로를 대체하거나 혼동하지 않는다.

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

## OpenAPI fragment fallback 경로

OpenAPI YAML 프래그먼트(`packages/schemas/src/fragments/`)는 신규 API 개발을 위한 작성 원천이 아니라,
TypeSpec 도입 이전의 레거시 Definition Builder 빌드 체계와의 정합성을 보장하기 위한 **롤백 및 참조(Rollback/Reference) 경로**입니다.

롤백 경로에 프래그먼트를 추가하거나 수정해야 하는 경우, 인라인 예제나 수동 YAML 작성을 지양하고 아래 전용 규격을 준수합니다:

1. **폴더 및 파일 명명 표준**: URL 계층을 파일시스템에 반영하며, 파라미터 세그먼트는 `by-{param-name}` 폴더로 격리합니다. 상세 규칙과 템플릿은 **[패스 프래그먼트 컨벤션 가이드](./path-fragment-conventions.md)**를 준수하십시오.
2. **Canonical ID 표준**: `kind:scope/domain/name` 3단계 형식을 준수해야 하며 URL 깊이와 무관하게 평탄하게 유지합니다.
3. **중복 및 충돌 검토**: 프래그먼트 추가 후 발생할 수 있는 이름 충돌과 중복 정의는 **[중복 검토 가이드](./duplicate-review.md)**에 따라 점검합니다.
4. **롤백 경로 검증 게이트**: 프래그먼트 작성 후에는 TypeSpec 빌드가 아닌 롤백 전용 검증 명령인 `pnpm schema:validate:openapi`를 실행하여 무결성을 검증합니다.

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

### discriminator — defaultMapping (OAS 3.2 신규 기능)

OpenAPI 3.2에서는 `discriminator` 객체에 `defaultMapping` 키워드가 도입되어,
명시적 매핑에 매칭되지 않는 discriminant 값에 대한 기본 폴백 스키마를 선언할 수 있습니다.
이는 다운스트림 `@oa-sdk/codegen`의 Zod 4 `z.discriminatedUnion()` 변환 시 안전한 기본값으로 직결됩니다.

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
        defaultMapping: "#/components/schemas/GenericEvent" # OAS 3.2 전용 기본 폴백
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

### 순환 `$ref` 및 재귀 스키마 처리 모델

카테고리 트리나 계층형 댓글처럼 자기 자신 또는 상호 참조하는 순환 스키마는 다음과 같이 전 계층에 걸쳐 체계적으로 처리됩니다:

1. **TypeSpec 원천 선언**: 재귀 모델은 네이티브 타입 참조로 직관적으로 선언합니다 (`model Category { parent?: Category; children?: Category[]; }`).
2. **OpenAPI 3.2 / JSON Schema Draft 2020-12**: 순환 `$ref` 포인터(`$ref: "#/components/schemas/Category"`)를 표준 사양에 맞게 보존합니다.
3. **파서 역참조 전략 (`dereference`)**:
   - `empty-schema` (기본값): 기존 mock 서버 및 레거시 툴체인 호환성을 위해 순환 진입 지점을 빈 스키마(`{}`)로 차단하여 스택 오버플로우를 방지합니다.
   - `preserve-ref`: 파서 소비자가 완전한 AST 순환 그래프를 유지해야 하는 경우 `$ref` 포인터를 끊지 않고 보존합니다.
4. **다운스트림 코드 생성 (`@oa-sdk/codegen`)**:
   - Zod 4 변환기(`generateZodFromSpec`)는 DFS 순환 탐색 알고리즘을 통해 순환 컴포넌트를 정확히 식별하고, 자동으로 `z.lazy(() => CategorySchema)` 래퍼를 생성합니다. 이를 통해 무한 런타임 재귀 루프를 방지하고 TypeScript 컴파일러 재귀 한계 오류를 원천 차단합니다.

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
