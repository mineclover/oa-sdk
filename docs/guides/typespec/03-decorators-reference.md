---
docType: reference
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

# TypeSpec 데코레이터 레퍼런스 및 실무 작성 패턴 (Decorators Reference & .tsp Authoring Patterns)

> **대상**: API 스펙 설계자, 도메인 모델러, 풀스택 엔지니어
> **기준 버전**: TypeSpec 1.16(저장소 고정 버전), `@oa-sdk/typespec-decorators` 0.3.0, OpenAPI 3.2
> **확인 방법**: 이 문서의 TypeSpec 예제는 2026-10-06에 `@typespec/compiler` 1.16.0으로 컴파일했고, 표의 OpenAPI 출력은 `@typespec/openapi3`(`openapi-versions: [3.2.0]`)로 확인했습니다. 예제에 없는 모델(`Workspace` 등)은 컴파일할 때 빈 모델로 채웠습니다.

이 문서는 TypeSpec 기본 decorator와 `@oa-sdk/typespec-decorators`의 decorator, 그리고 그것을 조합한 `.tsp` 작성 패턴을 정리합니다. oa-sdk 저장소의 production 계약에 적용하는 규칙은 [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)이 정본입니다.

---

## 📌 목차 (Table of Contents)

1. [개요](#1-개요)
2. [Part 1: TypeSpec 데코레이터 레퍼런스](#part-1-typespec-데코레이터-레퍼런스)
   - [1.1 Core & 메타데이터 데코레이터](#11-core--메타데이터-데코레이터)
   - [1.2 HTTP 전송 및 바인딩 데코레이터 (`@typespec/http`)](#12-http-전송-및-바인딩-데코레이터-typespechttp)
   - [1.3 OpenAPI 사양 데코레이터 (`@typespec/openapi`)](#13-openapi-사양-데코레이터-typespecopenapi)
   - [1.4 제약 및 유효성 검증 데코레이터](#14-제약-및-유효성-검증-데코레이터)
   - [1.5 다형성 및 모델 수명주기 데코레이터](#15-다형성-및-모델-수명주기-데코레이터)
   - [1.6 `@oa-sdk` 데코레이터와 표준 계약](#16-oa-sdk-데코레이터와-표준-계약)
3. [Part 2: 데코레이터를 활용한 8가지 `.tsp` 작성 패턴](#part-2-데코레이터를-활용한-8가지-tsp-작성-패턴)
   - [패턴 1: 리소스 인터페이스 그룹화 패턴 (`interface Users { ... }`)](#패턴-1-리소스-인터페이스-그룹화-패턴-interface-users---)
   - [패턴 2: 파라미터 그룹화 및 모델 전개 연산자 (`...PaginationParams`)](#패턴-2-파라미터-그룹화-및-모델-전개-연산자-paginationparams)
   - [패턴 3: 다형성 디스크리미네이터 상속 계층 패턴 (`@discriminator`)](#패턴-3-다형성-디스크리미네이터-상속-계층-패턴-discriminator)
   - [패턴 4: `@visibility` 기반 단일 모델 수명주기 투영 패턴](#패턴-4-visibility-기반-단일-모델-수명주기-투영-패턴)
   - [패턴 5: 커스텀 도메인 스칼라(Scalar) 제약 캡슐화 패턴](#패턴-5-커스텀-도메인-스칼라scalar-제약-캡슐화-패턴)
   - [패턴 6: 멀티 스테이터스 에러 유니온 합성 패턴 (`ErrorResponse<Status>`)](#패턴-6-멀티-스테이터스-에러-유니온-합성-패턴-errorresponsestatus)
   - [패턴 7: 벤더 메타데이터 확장 패턴 (`@extension`)](#패턴-7-벤더-메타데이터-확장-패턴-extension)
   - [패턴 8: 커스텀 TypeSpec 데코레이터 제작 (`extern dec`)](#패턴-8-커스텀-typespec-데코레이터-제작-extern-dec)
4. [Part 3: 실무 체크리스트](#part-3-실무-체크리스트)

---

## 1. 개요

TypeSpec(`.tsp`)은 oa-sdk가 권장하는 계약 원본 형식입니다. 데코레이터로 타입 정의 외에 다음을 한곳에 선언합니다.

1. **HTTP 바인딩**: 경로, 메서드, 파라미터 위치, 상태 코드.
2. **값 제약**: 문자열 길이, 숫자 범위(`exclusiveMinimum` 포함), 정규식, 포맷. OpenAPI 3.2 / JSON Schema 2020-12 키워드로 출력됩니다.
3. **OpenAPI 메타데이터**: `operationId`, 외부 문서, `x-*` 확장.
4. **OA SDK 확장**: `@oa-sdk/typespec-decorators`의 decorator로 버전이 있는 `x-oa-sdk-*` 확장을 기록합니다.

`oa-gen`은 이 원본에서 OpenAPI 문서, TypeScript 타입, 클라이언트, 핸들러 계약, 타입 가드를 만듭니다([토폴로지 가이드](./06-generation-topologies-and-rules.md)).

---

## Part 1: TypeSpec 데코레이터 레퍼런스

### 1.1 Core & 메타데이터 데코레이터
TypeSpec 언어 코어와 `@typespec/http`·`@typespec/openapi`가 제공하며 문서화, 예시값, 서비스 선언에 씁니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "Browser Studio Workspace API" })
@info(#{ version: "1.2.0" })
@server("https://api.studio.dev/v1", "Production Gateway")
namespace Studio.Workspace;

@doc("사용자 프로필 정보 엔티티")
@summary("사용자 엔티티")
model UserProfile {
  @doc("사용자 고유 UUID")
  @example("123e4567-e89b-12d3-a456-426614174000")
  id: string;

  @doc("계정 표시 이름")
  name: string;

  #deprecated "v1.5.0부터 'displayName' 필드로 대체됩니다."
  nickname?: string;
}
```

| 데코레이터 | 적용 대상 | 설명 | OpenAPI 출력 |
|---|---|---|---|
| `@doc(text)` | 모든 선언 | 상세 설명 (Markdown 가능) | `description` |
| `@summary(text)` | Operation, Model | 한 줄 요약 | operation `summary`, 모델 schema `title` |
| `@example(value)` | ModelProperty, Model | 예시값 | schema `examples` |
| `#deprecated "reason"` | 모든 선언 (decorator가 아닌 지시문) | 사용 중단 표시 | `deprecated: true` |
| `@service(#{ title })` | Namespace | 서비스 선언과 제목 | `info.title` |
| `@info(#{ version, ... })` | Namespace (`@typespec/openapi`) | 문서 버전 등 `info` 필드 | `info.version` 등 |
| `@server(url, desc?)` | Namespace | 배포 호스트 | `servers[]` |
| `@tag(name)` | Operation, Interface, Namespace | operation 분류 태그 | `tags[]` |

> ⚠️ TypeSpec 1.x에서 `@service`는 `version`을 받지 않고(`invalid-argument: ... ServiceOptions`), `@deprecated` decorator는 없습니다(`Unknown decorator @deprecated`). 버전은 `@info`로, 사용 중단은 `#deprecated` 지시문으로 씁니다.

---

### 1.2 HTTP 전송 및 바인딩 데코레이터 (`@typespec/http`)
HTTP 라우팅, 메서드, 파라미터 위치(Path, Query, Header, Body), 상태 코드를 명시합니다. 예제의 `Ok`, `Created`, `NoContent`는 `@oa-sdk/typespec-decorators`의 표준 계약입니다([1.6](#16-oa-sdk-데코레이터와-표준-계약)).

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using TypeSpec.Http;
using OaSdkTypeSpec;

@route("/workspaces")
@tag("workspaces")
interface WorkspaceOperations {
  // GET /workspaces?limit=20&cursor=xxx
  @get
  op listWorkspaces(
    @query limit?: int32 = 20,
    @query cursor?: string,
    @header("x-client-request-id") requestId?: string
  ): Ok<Workspace[]>;

  // POST /workspaces
  @post
  op createWorkspace(
    @body newWorkspace: CreateWorkspacePayload
  ): Created<Workspace>;

  // GET /workspaces/{id}
  @route("/{id}")
  @get
  op getWorkspace(
    @path id: string
  ): Ok<Workspace>;

  // PATCH /workspaces/{id}
  @route("/{id}")
  @patch
  op updateWorkspace(
    @path id: string,
    @body patch: UpdateWorkspacePayload
  ): Ok<Workspace>;

  // DELETE /workspaces/{id}
  @route("/{id}")
  @delete
  op deleteWorkspace(
    @path id: string
  ): NoContent;
}
```

| 데코레이터 | 적용 대상 | 설명 | OpenAPI 출력 |
|---|---|---|---|
| `@route(path)` | Operation, Interface, Namespace | URL 경로 (interface·namespace에 붙이면 접두사) | `paths` 키 |
| `@get`, `@post`, `@put`, `@patch`, `@delete`, `@head` | Operation | HTTP 메서드 | operation 메서드 |
| `@path` | ModelProperty, Op Parameter | 경로 파라미터 (`{id}`와 이름 일치) | `in: path`, `required: true` |
| `@query(name?)` | ModelProperty, Op Parameter | 쿼리 파라미터 | `in: query` |
| `@header(name?)` | ModelProperty, Op Parameter | 요청·응답 헤더 | `in: header` |
| `@body` | ModelProperty, Op Parameter | 요청·응답 본문 | `requestBody` / 응답 `content` |
| `@statusCode` | ModelProperty | 응답 상태 코드 | `responses`의 상태 키 |

---

### 1.3 OpenAPI 사양 데코레이터 (`@typespec/openapi`)
operation 식별자, 외부 문서, 벤더 확장을 다룹니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using TypeSpec.Http;
using TypeSpec.OpenAPI;
using OaSdkTypeSpec;

@route("/assets")
interface Assets {
  @operationId("uploadMediaAsset")
  @externalDocs("https://docs.studio.dev/media/upload", "Media Upload Protocol Spec")
  @extension("x-schema-engine-profile", "operation-contract")
  @extension("x-rate-limit-tier", "high-throughput")
  @post
  op uploadAsset(@body asset: AssetUploadRequest): Created<AssetUploadResult>;
}
```

| 데코레이터 | 적용 대상 | 설명 | OpenAPI 출력 |
|---|---|---|---|
| `@operationId(id)` | Operation | 클라이언트 함수 이름이 되는 고유 식별자 (`camelCase`) | `operationId` |
| `@extension(name, value)` | 모든 선언 | `x-*` 벤더 확장 | `x-*` 키 |
| `@externalDocs(url, desc?)` | 모든 선언 | 외부 문서 링크 | `externalDocs` |
| `@info(#{ ... })` | Namespace | `info` 필드(버전, 연락처, 라이선스 등) | `info.*` |

> ⚠️ `@operationId`는 `@typespec/http`가 아니라 `@typespec/openapi`에 있습니다. `import "@typespec/openapi";`와 `using OpenAPI;`(또는 `using TypeSpec.OpenAPI;`)가 없으면 `error invalid-ref: Unknown decorator @operationId`가 납니다.

---

### 1.4 제약 및 유효성 검증 데코레이터
OpenAPI 3.2 / JSON Schema 2020-12 검증 키워드로 출력되는 제약입니다.

```typespec
model MediaEncodingJob {
  @doc("작업 식별자 UUID v4")
  @format("uuid")
  jobId: string;

  @doc("비디오 가로 해상도 (최소 128픽셀, 최대 7680픽셀 8K)")
  @minValue(128)
  @maxValue(7680)
  widthPx: int32;

  @doc("프레임 레이트 (FPS, 0보다 커야 함)")
  @minValueExclusive(0)
  framerate: float64;

  @doc("출력 파일명 (1~255자, 영문/숫자/하이픈/언더스코어)")
  @minLength(1)
  @maxLength(255)
  @pattern("^[a-zA-Z0-9_-]+\\.[a-z0-9]+$")
  filename: string;

  @doc("스토리지 암호화 키 (OpenAPI에서 format: password로 마스킹)")
  @secret
  encryptionKey?: string;
}
```

| 데코레이터 | 지원 타입 | 설명 | OpenAPI 3.2 키워드 |
|---|---|---|---|
| `@minValue(n)` | 숫자 | 최솟값 (이상, $x \ge n$) | `minimum: n` |
| `@maxValue(n)` | 숫자 | 최댓값 (이하, $x \le n$) | `maximum: n` |
| `@minValueExclusive(n)` | 숫자 | 최솟값 (초과, $x > n$) | `exclusiveMinimum: n` |
| `@maxValueExclusive(n)` | 숫자 | 최댓값 (미만, $x < n$) | `exclusiveMaximum: n` |
| `@minLength(n)` | `string` | 최소 길이 | `minLength: n` |
| `@maxLength(n)` | `string` | 최대 길이 | `maxLength: n` |
| `@pattern(regex)` | `string` | 정규식 패턴 | `pattern: "regex"` |
| `@format(format)` | `string` | 표준 포맷 (`uuid`, `email`, `uri`, `date-time`, `ipv4`, `ipv6` 등) | `format: "format"` |
| `@secret` | `string` | 민감 데이터 표시 | `format: "password"` |

`@multipleOf`는 TypeSpec 코어가 아니라 `@typespec/json-schema` 라이브러리의 decorator입니다. 이 저장소는 그 라이브러리를 설치하지 않으므로 그대로 쓰면 `Unknown decorator @multipleOf`가 납니다.

---

### 1.5 다형성 및 모델 수명주기 데코레이터
다형성 모델과 단일 모델의 읽기·쓰기 수명주기를 제어합니다.

```typespec
// 1. 다형성 디스크리미네이터 모델링
@discriminator("kind")
model Shape {
  id: string;
  kind: string;
}

model Circle extends Shape {
  kind: "circle";
  @minValue(0) radius: float64;
}

model Rectangle extends Shape {
  kind: "rectangle";
  @minValue(0) width: float64;
  @minValue(0) height: float64;
}

// 2. 단일 모델 생명주기 가시성 제어 (@visibility)
model Article {
  @visibility(Lifecycle.Read)
  id: string;

  title: string;

  content: string;

  @visibility(Lifecycle.Read)
  viewCount: int32;

  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}
```

| 데코레이터 | 적용 대상 | 설명 | OpenAPI 출력 |
|---|---|---|---|
| `@discriminator(prop)` | Model | 다형성 변형을 구분할 속성 | `discriminator: { propertyName: "prop" }` |
| `@visibility(...modifiers)` | ModelProperty | 필드가 보이는 수명주기 단계: `Lifecycle.Read`, `Lifecycle.Create`, `Lifecycle.Update`, `Lifecycle.Delete`, `Lifecycle.Query`. 붙이지 않은 필드는 모든 단계에 보입니다. | 읽기 전용 필드는 `readOnly: true`. 요청 본문에서 빠지는 필드가 있으면 `<Model>Create`, `<Model>Update` 같은 별도 schema |
| `@key(name?)` | ModelProperty | 리소스 식별자 키 (`@typespec/rest` 리소스 경로용) | 이 출력에는 영향 없음 |

> ⚠️ TypeSpec 1.x는 `@visibility("read")` 같은 문자열 인자를 받지 않습니다(`invalid-argument: ... 'valueof EnumMember'`). `Lifecycle` 열거형 멤버를 씁니다.

---

### 1.6 `@oa-sdk` 데코레이터와 표준 계약

#### 1) `@oa-sdk/typespec-decorators` (`using OaSdkTypeSpec;`)

decorator별 인자, 허용 값, 진단 코드는 [패키지 README](../../../packages/typespec-decorators/README.md)가 정본입니다. 요약은 다음과 같습니다.

| 데코레이터 | 대상 | 출력 확장 |
|---|---|---|
| `@oaUseResponseComponent(statusCode, componentName)` | Operation | `x-oa-sdk-operation-component-refs` |
| `@personaCapability(...traits)` | Operation | `x-oa-sdk-persona-traits` (`packages/personas/src/traits/skill.yaml`의 표준 trait 24종만 허용) |
| `@pseudonymize(transform, role?, pii?, relationship?)` | ModelProperty | `x-oa-sdk-dpm-projection` (`transform`: `keep`, `redact`, `mask`, `null`, `hash`, `generalize`, `relationship_token`, `polymorphic_relationship_token`) |
| `@crdt(options)` | ModelProperty | `x-oa-sdk-crdt` |
| `@crdtEntity(options)` | Model | `x-oa-sdk-crdt-entity` |

`@oaUseResponseComponent`는 참조만 기록합니다. 재사용 응답(`#/components/responses/<name>`)으로 바뀌는 곳은 bundle restore(`oa-gen tsp-bundle-check`, 저장소의 `pnpm schema:typespec-check`)뿐이고, `oa-gen mock --tsp`나 `.tsp`를 넣은 `generate`·`typegen`에는 응답이 생기지 않습니다. 일반 프로젝트에서 4xx 응답을 선언할 때는 `ErrorResponse<Status>`나 `StandardHttpErrors`를 씁니다.

`@crdt`·`@crdtEntity` 확장이 있는 스펙에서는 `oa-gen generate`가 CRDT 모듈 4개(`<id>.crdt.contract.ts`, `<id>.crdt.router.ts`, `<id>.crdt.client.ts`, `<id>.crdt.hooks.ts`)도 만듭니다.

#### 2) `@oa-sdk/typespec-erd` (비공개 prototype)

논리 ERD decorator(`@dataset`, `@entity`, `@field`, `@primaryKey`, `@foreignKey`, `@relationship` 등)를 제공하는 비공개 유지보수 패키지(maintenance-only, 저장소 전용)입니다. npm에 배포하지 않으며 OpenAPI를 출력하지 않습니다. 사용법과 한계는 [TypeSpec Logical ERD Authoring](../typespec-logical-erd-authoring.md)을 봅니다.

#### 3) 표준 계약 (`lib/contracts.tsp`, namespace `OaSdkTypeSpec`)
`import "@oa-sdk/typespec-decorators";`가 decorator와 함께 불러오며, decorator와 같은 `OaSdkTypeSpec` namespace에 있으므로 `using OaSdkTypeSpec;` 하나로 둘 다 씁니다. 표준 계약은 0.3.0부터 있습니다.

- `Ok<T>`: 200 단건 응답 (`{ @statusCode statusCode: 200, @body body: T }`)
- `Created<T>`: 201 생성 응답
- `NoContent<T = void>`: 204 본문 없는 응답
- `PageResult<T>`: 페이징 본문 모델 (`items`, `total`, `page`, `limit`). 응답으로 쓰려면 `Ok<PageResult<T>>`처럼 감쌉니다.
- `ErrorResponse<Status>`: 지정한 상태 코드와 `StandardError` 본문을 가진 에러 응답
- `StandardError`: 에러 본문 (`code`, `message`, `details?: StandardValidationError[]`, `_meta?`). RFC 9457 Problem Details 형식은 아닙니다.
- `StandardValidationError`: 필드 수준 검증 에러 (`path`, `message`, `received?`, `expected?`)
- `StandardHttpErrors`: `ErrorResponse<400> | ErrorResponse<401> | ErrorResponse<403> | ErrorResponse<404> | ErrorResponse<500>` 유니온 alias. 그 밖의 상태(409 등)는 `ErrorResponse<409>`처럼 직접 씁니다.

oa-sdk 저장소의 production 번들은 같은 이름의 템플릿을 `packages/schemas/typespec/common.tsp`(namespace `OaSdkApi`, 에러 본문 `Error`)에 따로 두고 그것을 씁니다([TypeSpec 작성 규칙](../typespec-authoring-conventions.md#3-응답-선언)).

---

## Part 2: 데코레이터를 활용한 8가지 `.tsp` 작성 패턴

데코레이터를 조합해 중복을 줄이고 타입 안정성을 높이는 패턴입니다. import 줄이 없는 예제(패턴 2·4 등)는 1.2의 import(`@typespec/http`, `@oa-sdk/typespec-decorators`)를 전제로 합니다.

### 패턴 1: 리소스 인터페이스 그룹화 패턴 (`interface Users { ... }`)
operation을 `interface` 블록에 묶고 `@route`와 `@tag`를 위에 선언하면, 안의 operation이 경로 접두사와 태그를 물려받습니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using TypeSpec.Http;
using TypeSpec.OpenAPI;
using OaSdkTypeSpec;

@route("/api/v1/projects")
@tag("projects")
interface ProjectsResource {
  @summary("프로젝트 목록 조회")
  @operationId("listProjects")
  @get
  op list(@query page?: int32 = 1, @query limit?: int32 = 20): Ok<PageResult<Project>>;

  @summary("프로젝트 신규 생성")
  @operationId("createProject")
  @post
  op create(@body body: CreateProjectRequest): Created<Project>;

  @summary("프로젝트 단건 조회")
  @operationId("getProjectById")
  @route("/{id}")
  @get
  op getById(@path id: string): Ok<Project>;

  @summary("프로젝트 수정")
  @operationId("updateProject")
  @route("/{id}")
  @patch
  op update(@path id: string, @body body: UpdateProjectRequest): Ok<Project>;

  @summary("프로젝트 삭제")
  @operationId("deleteProject")
  @route("/{id}")
  @delete
  op delete(@path id: string): NoContent;
}
```

---

### 패턴 2: 파라미터 그룹화 및 모델 전개 연산자 (`...PaginationParams`)
목록 API마다 `@query page`, `@query limit`, `@query sort`를 반복하지 않고, 파라미터 모델을 선언한 뒤 전개 연산자(`...`)로 operation 시그니처에 넣습니다.

```typespec
@doc("공통 페이징 및 정렬 쿼리 파라미터")
model PaginationParams {
  @doc("페이지 번호 (1부터 시작)")
  @minValue(1)
  @query
  page?: int32 = 1;

  @doc("한 페이지당 항목 수 (최대 100)")
  @minValue(1)
  @maxValue(100)
  @query
  limit?: int32 = 20;

  @doc("정렬 필드 및 방향 (예: 'createdAt:desc')")
  @query
  sort?: string = "createdAt:desc";
}

@route("/users")
interface Users {
  // 전개된 3개 속성이 쿼리 파라미터가 됨
  @get
  op listUsers(
    @query role?: "admin" | "member",
    ...PaginationParams
  ): Ok<PageResult<User>>;
}
```

---

### 패턴 3: 다형성 디스크리미네이터 상속 계층 패턴 (`@discriminator`)
런타임에 형태가 정해지는 모델(비디오 트랜지션, 캔버스 노드, 결제 수단 등)을 `@discriminator`와 `extends`로 모델링합니다.

```typespec
namespace Studio.Timeline;

@doc("비디오 트랜지션 베이스 모델")
@discriminator("type")
model VideoTransitionBase {
  @doc("트랜지션 고유 ID")
  @format("uuid")
  id: string;

  @doc("다형성 판별 태그")
  type: string;

  @doc("재생 지속 시간 (ms, 양수)")
  @minValue(1)
  durationMs: int32 = 500;
}

@doc("크로스페이드 트랜지션")
model FadeTransition extends VideoTransitionBase {
  type: "fade";
  mode: "fade-in" | "fade-out" | "crossfade" = "crossfade";
  @pattern("^#([0-9a-fA-F]{6})$")
  color?: string = "#000000";
}

@doc("와이프 트랜지션")
model WipeTransition extends VideoTransitionBase {
  type: "wipe";
  direction: "left" | "right" | "up" | "down" = "left";
  @minValue(0.0) @maxValue(1.0)
  softness?: float64 = 0.1;
}

@doc("커스텀 GLSL 셰이더 트랜지션")
model GlTransition extends VideoTransitionBase {
  type: "gl";
  @minLength(10)
  shaderSource: string;
  uniforms?: Record<unknown>;
}

alias VideoTransition = FadeTransition | WipeTransition | GlTransition;
```

---

### 패턴 4: `@visibility` 기반 단일 모델 수명주기 투영 패턴
`CreateUserRequest`, `UpdateUserRequest`, `UserResponse`처럼 비슷한 DTO를 여러 벌 쓰지 않고, 모델 하나에 `@visibility`를 붙여 요청 본문과 응답 schema를 나눕니다.

```typespec
model User {
  @doc("시스템 발급 ID (조회 시에만 노출)")
  @visibility(Lifecycle.Read)
  id: string;

  @doc("이메일 주소 (생성 시 필수, 수정 불가, 조회 가능)")
  @visibility(Lifecycle.Create, Lifecycle.Read)
  @format("email")
  email: string;

  @doc("사용자 이름 (생성, 수정, 조회 모두 가능)")
  @minLength(1)
  name: string;

  @doc("비밀번호 (생성 및 수정 시에만 전달, 조회 응답에서는 제외)")
  @visibility(Lifecycle.Create, Lifecycle.Update)
  @secret
  password?: string;

  @doc("계정 생성 일시")
  @visibility(Lifecycle.Read)
  createdAt: utcDateTime;
}

@route("/users")
interface Users {
  // 응답 schema `User`: id, email, name, createdAt (password 제외, id·createdAt은 readOnly)
  @get op getUser(@path id: string): Ok<User>;

  // 요청 schema `UserCreate`: email, name, password
  @post op createUser(@body user: User): Created<User>;

  // 요청 schema `UserUpdate`: name, password
  @patch op updateUser(@path id: string, @body patch: User): Ok<User>;
}
```

---

### 패턴 5: 커스텀 도메인 스칼라(Scalar) 제약 캡슐화 패턴
자주 반복되는 제약 묶음을 `scalar`로 도메인 타입화합니다.

```typespec
// 1. 1부터 100 사이의 페이지 크기 스칼라
@doc("페이징 조회 항목 수 (1~100)")
@minValue(1)
@maxValue(100)
scalar PageSize extends int32;

// 2. 6자리 HEX 색상 스칼라
@doc("6자리 16진수 웹 컬러 코드 (#RRGGBB)")
@pattern("^#([0-9a-fA-F]{6})$")
scalar HexColor extends string;

// 3. 0.0 ~ 1.0 정규화 부동소수 스칼라
@doc("단위 구간 [0.0, 1.0] 내 정규화 비율")
@minValue(0.0)
@maxValue(1.0)
scalar NormalizedRatio extends float64;

// 모델에서 데코레이터 중복 없이 사용
model CanvasLayer {
  id: string;
  name: string;
  opacity: NormalizedRatio = 1.0;
  backgroundColor: HexColor = "#ffffff";
}
```

---

### 패턴 6: 멀티 스테이터스 에러 유니온 합성 패턴 (`ErrorResponse<Status>`)
성공 응답과 상태 코드별 에러 응답(`StandardError` 본문)을 반환 타입에 유니온(`|`)으로 선언합니다. 이 응답은 일반 HTTP 응답이므로 `oa-gen mock --tsp`, `typegen`, `generate`의 출력에도 그대로 나옵니다. `StandardHttpErrors`는 400·401·403·404·500을 한 번에 더하는 alias이고, 그 밖의 상태는 `ErrorResponse<Status>`로 하나씩 더합니다.

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using TypeSpec.Http;
using OaSdkTypeSpec;

@doc("결제 승인 처리")
@route("/payments/charge")
@post
op chargePayment(
  @body req: ChargeRequest
): Ok<ChargeResult>
 | ErrorResponse<400>   // 400 잘못된 카드 정보
 | ErrorResponse<402>   // 402 한도 초과/잔액 부족
 | ErrorResponse<409>   // 409 중복 결제 멱등성 충돌
 | ErrorResponse<500>;  // 500 PG사 통신 실패
```

---

### 패턴 7: 벤더 메타데이터 확장 패턴 (`@extension`)
Surface Engine live-patch 앵커나 UI 편집기 힌트 같은 도구용 메타데이터를 `x-*` 확장으로 선언합니다. `@extension`은 `@typespec/openapi`에 있습니다.

```typespec
model SurfaceToken {
  @extension("x-surface-anchor", #{ id: "token-bg", line: 42, column: 12 })
  @extension("x-surface-live-patch", true)
  @extension("x-surface-ui-editor", "color-picker")
  color: string;

  @extension("x-surface-param-range", #{
    targetProperty: "width",
    supportsLivePatch: true,
    maxFramerateHz: 60
  })
  width: int32;
}
```

`x-oa-sdk-*` 이름은 OA SDK 확장 어휘(`oa-sdk.typespec-extensions.v5`)와 `@oa-sdk/typespec-decorators`가 쓰므로 자체 메타데이터에는 다른 접두사를 씁니다. 저장소 계약에서의 규칙은 [확장 사용 순서](../typespec-authoring-conventions.md#5-확장-사용-순서-extension-convention)를 봅니다.

---

### 패턴 8: 커스텀 TypeSpec 데코레이터 제작 (`extern dec`)

`@oa-sdk/typespec-decorators`처럼 프로젝트 전용 decorator를 TypeScript로 만드는 방법입니다. 아래 세 파일과 `package.json`으로 이루어진 라이브러리를 `tsc`로 빌드하고 `.tsp`에서 import했을 때, 속성 schema에 `x-cache-policy`가 출력되고 TTL이 0 이하이면 컴파일이 진단 에러로 실패하는 것을 확인했습니다.

#### 1단계: TypeSpec 선언 (`lib/main.tsp`)
```typespec
import "../dist/decorators.js";

using TypeSpec.Reflection;

namespace MyPlatform;

/** 모델 프로퍼티에 캐시 TTL 정책을 주입하는 커스텀 데코레이터 */
extern dec cachePolicy(
  target: ModelProperty,
  ttlSeconds: valueof int32,
  scope?: valueof string
);
```

#### 2단계: 라이브러리와 진단 정의 (`src/lib.ts`)
```typescript
import { createTypeSpecLibrary, paramMessage } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name: "@my-org/typespec-cache",
  diagnostics: {
    "invalid-cache-ttl": {
      severity: "error",
      messages: {
        default: paramMessage`Cache TTL must be strictly positive, got ${"ttlSeconds"}`,
      },
    },
  },
});

export const { reportDiagnostic } = $lib;
```

#### 3단계: 검증과 OpenAPI 확장 기록 (`src/decorators.ts`)
```typescript
import type { DecoratorContext, ModelProperty } from "@typespec/compiler";
import { setExtension } from "@typespec/openapi";
import { reportDiagnostic } from "./lib.js";

// lib/main.tsp의 `namespace MyPlatform;`과 같아야 extern dec와 연결됩니다.
export const namespace = "MyPlatform";

export function $cachePolicy(
  context: DecoratorContext,
  target: ModelProperty,
  ttlSeconds: number,
  scope: string = "public",
): void {
  // 컴파일 타임 유효성 검사: 0 이하이면 진단 에러를 내고 확장을 기록하지 않음
  if (ttlSeconds <= 0) {
    reportDiagnostic(context.program, {
      code: "invalid-cache-ttl",
      target: context.getArgumentTarget(0) ?? target,
      format: { ttlSeconds: String(ttlSeconds) },
    });
    return;
  }

  // OpenAPI 벤더 확장으로 기록 (프로퍼티 스키마에 x-cache-policy가 생김)
  setExtension(context.program, target, "x-cache-policy", { ttlSeconds, scope });
}
```

#### 4단계: 패키지 진입점 (`package.json`)
```json
{
  "name": "@my-org/typespec-cache",
  "version": "0.1.0",
  "type": "module",
  "tspMain": "./lib/main.tsp",
  "main": "./dist/decorators.js",
  "files": ["dist", "lib"],
  "peerDependencies": {
    "@typespec/compiler": "^1.16.0",
    "@typespec/openapi": "^1.16.0"
  }
}
```

`tspMain`이 있으면 `import "@my-org/typespec-cache";`로 라이브러리를 불러올 수 있고, 편집기 language server도 decorator를 자동완성합니다. OpenAPI 확장 대신 자체 emitter가 읽을 상태를 남기려면 `context.program.stateMap(key).set(target, value)`를 씁니다. `DecoratorContext` 자체에는 `stateMap`이 없습니다.

---

## Part 3: 실무 체크리스트

- [ ] **import 확인**: `@operationId`, `@extension`, `@info`를 쓸 때 `import "@typespec/openapi"; using TypeSpec.OpenAPI;`를 선언했는가?
- [ ] **오브젝트 값 문법**: decorator 인자로 객체를 넘길 때 TypeSpec 1.x의 **`#{}`** 값 문법을 썼는가?
- [ ] **서비스 버전과 사용 중단**: 버전은 `@info(#{ version })`, 사용 중단은 `#deprecated "사유"`로 썼는가?
- [ ] **단일 모델 가시성**: Create/Update/Read 필드 차이를 DTO 여러 벌 대신 `@visibility(Lifecycle.*)`로 표현할 수 있는지 검토했는가?
- [ ] **수치 경계**: 경계를 포함하면 `@minValue`/`@maxValue`(`minimum`/`maximum`), 제외하면 `@minValueExclusive`/`@maxValueExclusive`(`exclusiveMinimum`/`exclusiveMaximum`)를 썼는가?
- [ ] **다형성 태그**: 베이스 모델에 `@discriminator("type")`를 붙이고 파생 모델에서 리터럴 타입(`type: "fade";`)을 고정했는가?
- [ ] **에러 계약**: 일회성 에러 모델 대신 `ErrorResponse<Status>`, `StandardHttpErrors`(`using OaSdkTypeSpec;`)를 썼는가?

---

## 🔗 관련 문서
- [TypeSpec 작성 규칙 (저장소 정본)](../typespec-authoring-conventions.md)
- [`@oa-sdk/typespec-decorators` README](../../../packages/typespec-decorators/README.md)
- [TypeSpec 5분 퀵스타트 (저장소 기여자용)](./01-quickstart-5min.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [TypeSpec 생성물 배치 토폴로지와 아키텍처 규칙](./06-generation-topologies-and-rules.md)
- [스키마 아키텍처 및 작성 규칙](../schema-architecture-and-conventions.md)
- [선언적 스펙 설정 가이드 (oa.config.ts)](../declarative-spec-configuration.md)
