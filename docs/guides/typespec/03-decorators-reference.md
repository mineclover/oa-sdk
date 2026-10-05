# TypeSpec 데코레이터 종합 레퍼런스 및 실무 작성 패턴 바이블 (Comprehensive Decorators Reference & .tsp Authoring Paradigms)

> **Canonical Authority**: `@oa-sdk/schemas`, `@oa-sdk/typespec-decorators`, `@oa-sdk/codegen`  
> **Target Audience**: API 스펙 설계자, 도메인 모델러, 풀스택 엔지니어, 플랫폼 아키텍트  
> **최신 표준 버전**: TypeSpec 0.60+ / OpenAPI 3.1 & 3.2 Canonical Specification  

---

## 📌 목차 (Table of Contents)

1. [개요 및 아키텍처 원칙](#1-개요-및-아키텍처-원칙)
2. [Part 1: TypeSpec 데코레이터 종합 레퍼런스](#part-1-typespec-데코레이터-종합-레퍼런스)
   - [1.1 Core & 메타데이터 데코레이터](#11-core--메타데이터-데코레이터)
   - [1.2 HTTP 전송 및 바인딩 데코레이터 (`@typespec/http`)](#12-http-전송-및-바인딩-데코레이터-typespechttp)
   - [1.3 OpenAPI 3.1/3.2 사양 데코레이터 (`@typespec/openapi`)](#13-openapi-3132-사양-데코레이터-typespecopenapi)
   - [1.4 정밀 제약 및 유효성 검증 데코레이터 (RFC / JSON Schema 2020-12)](#14-정밀-제약-및-유효성-검증-데코레이터-rfc--json-schema-2020-12)
   - [1.5 다형성 및 모델 수명주기 데코레이터](#15-다형성-및-모델-수명주기-데코레이터)
   - [1.6 `@oa-sdk` 거버넌스 및 플랫폼 확장 데코레이터](#16-oa-sdk-거버넌스-및-플랫폼-확장-데코레이터)
3. [Part 2: 데코레이터를 활용한 8대 실전 `.tsp` 작성 패러다임](#part-2-데코레이터를-활용한-8대-실전-tsp-작성-패러다임)
   - [패턴 1: 리소스 인터페이스 그룹화 패턴 (`interface Users { ... }`)](#패턴-1-리소스-인터페이스-그룹화-패턴-interface-users---)
   - [패턴 2: 파라미터 그룹화 및 모델 전개 연산자 (`...PaginationParams`)](#패턴-2-파라미터-그룹화-및-모델-전개-연산자-paginationparams)
   - [패턴 3: 다형성 디스크리미네이터 상속 계층 패턴 (`@discriminator`)](#패턴-3-다형성-디스크리미네이터-상속-계층-패턴-discriminator)
   - [패턴 4: `@visibility` 기반 단일 모델 수명주기 투영 패턴](#패턴-4-visibility-기반-단일-모델-수명주기-투영-패턴)
   - [패턴 5: 커스텀 도메인 스칼라(Scalar) 제약 캡슐화 패턴](#패턴-5-커스텀-도메인-스칼라scalar-제약-캡슐화-패턴)
   - [패턴 6: 멀티 스테이터스 에러 유니온 합성 패턴 (`RFC 9457`)](#패턴-6-멀티-스테이터스-에러-유니온-합성-패턴-rfc-9457)
   - [패턴 7: 비침습적 벤더 메타데이터 확장 주입 패턴 (`@extension`)](#패턴-7-비침습적-벤더-메타데이터-확장-주입-패턴-extension)
   - [패턴 8: 커스텀 TypeSpec 데코레이터 제작 및 컴파일 방법 (`extern dec`)](#패턴-8-커스텀-typespec-데코레이터-제작-및-컴파일-방법-extern-dec)
4. [Part 3: 실무 체크리스트 및 안티패턴 방어](#part-3-실무-체크리스트-및-안티패턴-방어)

---

## 1. 개요 및 아키텍처 원칙

TypeSpec(`.tsp`)은 프로덕션 API 계약 및 도메인 스키마를 표현하는 **단일 진실 공급원(SSOT)**입니다. TypeSpec의 가장 큰 강점은 **풍부한 데코레이터 생태계**를 통해 단순한 타입 정의를 넘어 다음을 단일 원천에서 선언할 수 있다는 점입니다:

1. **전송 프로토콜 독립성**: HTTP/REST 엔드포인트뿐 아니라 순수 데이터 구조체, RPC, WebSocket, 메시지 버스 페이로드를 동일한 언어로 선언.
2. **엄격한 수치/문자열 계약**: JSON Schema Draft 2020-12 및 OpenAPI 3.1/3.2의 정밀한 수학적 경계(`exclusiveMinimum: 0` 등)를 메타데이터 손실 없이 완벽 방출.
3. **컴파일 타임 정적 검증**: 런타임 검증 라이브러리(Zod, AJV 등)의 번들 비대화나 `eval()` 호출 없이, 제로-런타임 정적 가드와 클라이언트를 자동 파생.
4. **선언적 확장성**: `@oa-sdk/typespec-decorators`, `@oa-sdk/typespec-erd`처럼 도메인 전용 데코레이터를 TypeScript로 직접 제작하여 컴파일 파이프라인에 주입 가능.

---

## Part 1: TypeSpec 데코레이터 종합 레퍼런스

### 1.1 Core & 메타데이터 데코레이터
TypeSpec 언어 코어에서 제공하며 문서화, 샘플 데이터 제공, 서비스 선언에 사용됩니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{
  title: "Browser Studio Workspace API",
  version: "1.2.0"
})
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

  @deprecated("v1.5.0부터 'displayName' 필드로 대체됩니다.")
  nickname?: string;
}
```

| 데코레이터 | 적용 대상 | 설명 | 투영 산출물 |
|---|---|---|---|
| `@doc(text)` | Any declaration | 상세 설명 문서화 (Markdown 지원) | OpenAPI `description` |
| `@summary(text)` | Operation, Model | 간결한 1줄 요약 | OpenAPI `summary` |
| `@example(value)` | ModelProperty, Model, Op | 샘플 페이로드 또는 필드 예시값 | OpenAPI `example` / `examples` |
| `@deprecated(reason)` | Any declaration | 사용 중단 표시 및 사유 기재 | OpenAPI `deprecated: true` |
| `@service(options)` | Namespace | 서비스 제목 및 메타데이터 선언 (`#{}` 문법 필수) | OpenAPI `info.title`, `info.version` |
| `@server(url, desc?)` | Namespace | 배포 대상 호스트 및 게이트웨이 엔드포인트 | OpenAPI `servers[]` |
| `@tag(name)` | Operation, Interface, Namespace | 오퍼레이션 카테고리 태그 분류 | OpenAPI `tags[]` |

---

### 1.2 HTTP 전송 및 바인딩 데코레이터 (`@typespec/http`)
HTTP 프로토콜 라우팅, 메서드, 파라미터 위치(Path, Query, Header, Body), 상태 코드를 명시합니다.

```typespec
import "@typespec/http";
using TypeSpec.Http;

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

| 데코레이터 | 적용 대상 | 설명 | 투영 산출물 |
|---|---|---|---|
| `@route(path)` | Operation, Interface, Namespace | URL 엔드포인트 상대 또는 절대 경로 | OpenAPI `paths` 키 |
| `@get`, `@post`, `@put`, `@patch`, `@delete`, `@head` | Operation | HTTP 메서드 동사 명시 | OpenAPI Operation Method |
| `@path` | ModelProperty, Op Parameter | URL 경로 매개변수 (`{id}`와 이름 일치 필요) | OpenAPI `in: path`, `required: true` |
| `@query(name?)` | ModelProperty, Op Parameter | URL 쿼리 스트링 매개변수 | OpenAPI `in: query` |
| `@header(name?)` | ModelProperty, Op Parameter | HTTP 요청/응답 헤더 매개변수 | OpenAPI `in: header` |
| `@body` | ModelProperty, Op Parameter | HTTP 요청 또는 응답 본문 페이로드 | OpenAPI `requestBody` / response body |
| `@statusCode` | ModelProperty | HTTP 상태 코드 선언 (`200`, `201`, `400` 등) | OpenAPI `responses` Status Key |

---

### 1.3 OpenAPI 3.1/3.2 사양 데코레이터 (`@typespec/openapi`)
OpenAPI 스펙 생성기(Emitter)의 오퍼레이션 식별자, 외부 문서, 커스텀 벤더 확장을 다룹니다.

```typespec
import "@typespec/openapi";
using TypeSpec.OpenAPI;

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

| 데코레이터 | 적용 대상 | 설명 | 투영 산출물 |
|---|---|---|---|
| `@operationId(id)` | Operation | 언어 중립 클라이언트 함수명 및 고유 식별자 (`camelCase`) | OpenAPI `operationId` |
| `@extension(name, value)` | Any declaration | 임의의 `x-*` OpenAPI 벤더 확장 메타데이터 주입 | OpenAPI `x-*` key/value |
| `@externalDocs(url, desc?)` | Any declaration | 상세 기술 명세서 외부 URL 링크 | OpenAPI `externalDocs` |

> ⚠️ **주의 (Import 누락 방지)**:  
> `@operationId`는 `@typespec/http`가 아니라 **`@typespec/openapi`**에 속합니다. 누락 시 컴파일 에러(`error invalid-ref: Unknown decorator @operationId`)가 발생하므로 항상 세트로 임포트하십시오.

---

### 1.4 정밀 제약 및 유효성 검증 데코레이터 (RFC / JSON Schema 2020-12)
`@oa-sdk`의 4단계 파이프라인(JSON Schema Draft 2020-12 및 OpenAPI 3.1)으로 컴파일될 때 비트 단위로 일치하는 검증 제약을 정의합니다.

```typespec
model MediaEncodingJob {
  @doc("작업 식별자 UUID v4")
  @format("uuid")
  jobId: string;

  @doc("비디오 가로 해상도 (최소 128픽셀, 최대 7680픽셀 8K)")
  @minValue(128)
  @maxValue(7680)
  widthPx: int32;

  @doc("프레임 레이트 (FPS, 0보다 엄격히 커야 함)")
  @minValue(0.01)
  framerate: float64;

  @doc("출력 파일명 (1~255자, 영문/숫자/하이픈/언더스코어)")
  @minLength(1)
  @maxLength(255)
  @pattern("^[a-zA-Z0-9_-]+\\.[a-z0-9]+$")
  filename: string;

  @doc("오디오 채널 수 (스테레오/5.1 등, 2의 배수)")
  @multipleOf(2)
  audioChannels: int32;

  @doc("스토리지 암호화 키 (OpenAPI에서 format: password로 마스킹)")
  @secret
  encryptionKey?: string;
}
```

| 데코레이터 | 지원 타입 | 설명 | JSON Schema 2020-12 / OAS 3.1 키워드 |
|---|---|---|---|
| `@minValue(n)` | `int32`, `int64`, `float64` 등 | 최솟값 경계 (이상, $x \ge n$) | `minimum: n` |
| `@maxValue(n)` | `int32`, `int64`, `float64` 등 | 최댓값 경계 (이하, $x \le n$) | `maximum: n` |
| `@multipleOf(n)` | Numeric | 배수 제약 ($x \pmod n = 0$) | `multipleOf: n` |
| `@minLength(n)` | `string` | 문자열 최소 길이 ($\text{length} \ge n$) | `minLength: n` |
| `@maxLength(n)` | `string` | 문자열 최대 길이 ($\text{length} \le n$) | `maxLength: n` |
| `@pattern(regex)` | `string` | 정규표현식 검증 패턴 | `pattern: "regex"` |
| `@format(format)` | `string` | 표준 포맷 (`uuid`, `email`, `uri`, `date-time`, `ipv4`, `ipv6` 등) | `format: "format"` |
| `@secret` | `string` | 민감 데이터 마스킹 플래그 | `format: "password"` |

---

### 1.5 다형성 및 모델 수명주기 데코레이터
복합 다형성 유니언과 단일 엔터티 모델의 읽기/쓰기 수명주기를 제어합니다.

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
  @visibility("read")
  id: string;

  @visibility("create", "update", "read")
  title: string;

  @visibility("create", "update", "read")
  content: string;

  @visibility("read")
  viewCount: int32;

  @visibility("read")
  createdAt: utcDateTime;
}
```

| 데코레이터 | 적용 대상 | 설명 | 투영 산출물 |
|---|---|---|---|
| `@discriminator(prop)` | Model | 다형성 변형체를 식별할 태그 프로퍼티 명시 | OpenAPI `discriminator: { propertyName: "prop" }` |
| `@visibility(...roles)` | ModelProperty | 읽기(`read`), 생성(`create`), 수정(`update`), 쿼리(`query`) 시의 필드 가시성 제어 | 요청/응답 별도 DTO 자동 분기 방출 |
| `@key(name?)` | ModelProperty | 리소스의 기본 식별자 키 지정 | REST 경로 파라미터 자동 매핑 |

---

### 1.6 `@oa-sdk` 거버넌스 및 플랫폼 확장 데코레이터

`oa-sdk` 모노레포 및 다운스트림 서비스의 아키텍처 거버넌스, 페르소나 역량, 데이터 가명화(DPM), 논리 ERD를 지원하는 공식 데코레이터 패키지입니다.

#### 1) `@oa-sdk/typespec-decorators` (`using OaSdkTypeSpec;`)
- **`@oaUseResponseComponent(statusCode, componentName)`**:  
  재사용 가능한 OpenAPI 응답 컴포넌트(`#/components/responses/<name>`)를 연결.
- **`@personaCapability(...traits)`**:  
  API 오퍼레이션이 지원하는 페르소나 역량(`pagination`, `full-text-search`, `pii-masked-default` 등 21종)을 선언. OpenAPI `x-oa-sdk-persona-traits`로 투영.
- **`@pseudonymize(transform, role?, pii?, relationship?)`**:  
  DPM 데이터 보호 정책에 따른 필드 가명화(`hmac-sha256`, `tokenization`) 및 마스킹 규칙 선언. OpenAPI `x-oa-sdk-dpm-projection`으로 투영.
- **`@crdt(options)` / `@crdtEntity(options)`**:  
  분산 동시성 제어 및 CRDT 복제 정책 선언. OpenAPI `x-oa-sdk-crdt`로 투영.

#### 2) `@oa-sdk/typespec-erd` (`using OaSdkErd;`)
- **`@dataset(id)`**: 네임스페이스 레벨의 논리 데이터셋 스코프 선언.
- **`@entity(id)`**: 리네임에 안전한 논리 엔티티 식별자 선언.
- **`@field(id)`**: 물리 DB 컬럼과 매핑 가능한 논리 필드 식별자 선언.
- **`@primaryKey(groupId?, order?)`**: 기본 키 또는 복합 기본 키 지정.
- **`@unique`**: 유니크 제약 조건 선언.
- **`@foreignKey(targetField)`**: 논리 외래 키 참조 관계 선언.
- **`@relationship(id, from, to, cardinality)`**: 두 필드 간 카디널리티(`one-to-one`, `one-to-many`, `many-to-one`) 선언.

#### 3) 플랫폼 공통 계약 (`lib/contracts.tsp`, namespace `OaSdkTypeSpec`)
`import "@oa-sdk/typespec-decorators";`가 데코레이터와 함께 불러오며, 데코레이터와 같은 `OaSdkTypeSpec` namespace에 있으므로 `using OaSdkTypeSpec;` 하나로 둘 다 사용합니다.

- `Ok<T>`: 200 OK 단건 응답 (`{ @statusCode statusCode: 200, @body body: T }`)
- `Created<T>`: 201 Created 리소스 생성 완료 응답
- `NoContent<T = void>`: 204 No Content 바디 없는 응답
- `PageResult<T>`: 표준 페이징 body 모델 (`items`, `total`, `page`, `limit`). 응답으로 쓰려면 `Ok<PageResult<T>>`처럼 감쌉니다.
- `ErrorResponse<Status>`: 지정한 상태 코드와 `StandardError` body를 가진 에러 응답
- `StandardError`: 에러 body (`code`, `message`, `details?: StandardValidationError[]`, `_meta?`). RFC 9457 Problem Details 형식은 아닙니다.
- `StandardValidationError`: 필드 수준 검증 에러 (`path`, `message`, `received?`, `expected?`)
- `StandardHttpErrors`: `ErrorResponse<400> | ErrorResponse<401> | ErrorResponse<403> | ErrorResponse<404> | ErrorResponse<500>` 유니온 alias. 그 밖의 상태(409 등)는 `ErrorResponse<409>`처럼 직접 씁니다.

---

## Part 2: 데코레이터를 활용한 8대 실전 `.tsp` 작성 패러다임

실무에서 `.tsp`를 작성할 때 데코레이터를 조합하여 코드 중복을 제거하고 강력한 타입 안정성을 확보하는 8대 핵심 패러다임입니다.

### 패턴 1: 리소스 인터페이스 그룹화 패턴 (`interface Users { ... }`)
오퍼레이션을 개별 전역 함수로 나열하는 대신, `interface` 블록에 묶고 `@route`와 `@tag`를 상단에 선언합니다. 하위 모든 오퍼레이션이 경로 접두사와 태그를 자동으로 승계받습니다.

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
모든 목록 API마다 `@query page`, `@query limit`, `@query sort`를 반복 작성하지 않고, 파라미터 모델을 선언한 뒤 전개 연산자(`...`)로 오퍼레이션 시그니처에 주입합니다.

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
  // ...전개 연산자로 3개 쿼리 파라미터가 자동으로 HTTP 쿼리 파라미터로 바인딩됨
  @get
  op listUsers(
    @query role?: "admin" | "member",
    ...PaginationParams
  ): Ok<PageResult<User>>;
}
```

---

### 패턴 3: 다형성 디스크리미네이터 상속 계층 패턴 (`@discriminator`)
비디오 트랜지션, 캔버스 그래픽 노드, 결제 수단 등 런타임에 형태가 동적으로 결정되는 복합 모델을 `@discriminator`와 `extends`로 모델링합니다.

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
`CreateUserRequest`, `UpdateUserRequest`, `UserResponse`처럼 유사한 필드를 가진 DTO를 3~4개씩 중복 작성하지 않고, **단일 도메인 모델**에 `@visibility` 데코레이터를 적용하여 컴파일러가 요청 바디와 응답 스키마를 자동 분기하도록 설계합니다.

```typespec
model User {
  @doc("시스템 발급 ID (조회 시에만 노출)")
  @visibility("read")
  id: string;

  @doc("이메일 주소 (생성 시 필수, 수정 불가, 조회 가능)")
  @visibility("create", "read")
  @format("email")
  email: string;

  @doc("사용자 이름 (생성, 수정, 조회 모두 가능)")
  @visibility("create", "update", "read")
  @minLength(1)
  name: string;

  @doc("비밀번호 (생성 및 수정 시에만 전달, 조회 응답에서는 완전 배제)")
  @visibility("create", "update")
  @secret
  password?: string;

  @doc("계정 생성 일시")
  @visibility("read")
  createdAt: utcDateTime;
}

@route("/users")
interface Users {
  // OpenAPI 투영 시 password가 제외된 User 응답 스키마 생성
  @get op getUser(@path id: string): Ok<User>;

  // OpenAPI 투영 시 id, createdAt, viewCount가 배제되고 email, name, password만 포함된 Create 스키마 생성
  @post op createUser(@body user: User): Created<User>;

  // OpenAPI 투영 시 email이 배제되고 name, password만 선택 가능한 Update 스키마 생성
  @patch op updateUser(@path id: string, @body patch: User): Ok<User>;
}
```

---

### 패턴 5: 커스텀 도메인 스칼라(Scalar) 제약 캡슐화 패턴
자주 반복되는 유효성 검증 데코레이터 세트를 `scalar` 키워드로 도메인 타입화하여 재사용성을 극대화합니다.

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

// 모델에서 데코레이터 중복 없이 간결하게 소비
model CanvasLayer {
  id: string;
  name: string;
  opacity: NormalizedRatio = 1.0;
  backgroundColor: HexColor = "#ffffff";
}
```

---

### 패턴 6: 멀티 스테이터스 에러 유니온 합성 패턴 (`ErrorResponse<Status>`)
성공 응답과 상태 코드별 에러 응답(`StandardError` body)을 오퍼레이션 반환 타입에 유니온(`|`)으로 명시하여, 클라이언트 SDK 및 백엔드 핸들러 계약(`*.contract.ts`)에 강력한 다중 상태 분기 타입을 주입합니다. `StandardHttpErrors`는 400·401·403·404·500을 한 번에 더하는 alias이고, 그 밖의 상태는 `ErrorResponse<Status>`로 하나씩 더합니다.

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

### 패턴 7: 비침습적 벤더 메타데이터 확장 주입 패턴 (`@extension`)
소스 코드를 오염시키지 않고 Surface Engine live-patch 앵커, CI 모의 서버 지연시간 힌트, 레이트 리밋 메타데이터를 OpenAPI 확장에 선언합니다.

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

---

### 패턴 8: 커스텀 TypeSpec 데코레이터 제작 및 컴파일 방법 (`extern dec`)

`@oa-sdk/typespec-decorators`처럼 조직이나 프로젝트 전용의 커스텀 데코레이터를 TypeScript로 직접 개발하는 표준 방법입니다.

#### 1단계: TypeSpec 인터페이스 선언 (`lib/decorators.tsp`)
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

#### 2단계: TypeScript 검증 및 OpenAPI 확장 Emitter 구현 (`src/decorators.ts`)
```typescript
import type { DecoratorContext, ModelProperty, Type } from "@typespec/compiler";

// 데코레이터 상태 저장을 위한 컴파일 컨텍스트 키
const cachePolicyKey = Symbol.for("MyPlatform.cachePolicy");

export function $cachePolicy(
  context: DecoratorContext,
  target: ModelProperty,
  ttlSeconds: number,
  scope: string = "public"
) {
  // 컴파일 타임 유효성 검사 (0보다 작으면 진단 에러 방출)
  if (ttlSeconds <= 0) {
    context.program.reportDiagnostic({
      code: "invalid-cache-ttl",
      message: `Cache TTL must be strictly positive, got ${ttlSeconds}`,
      target,
      severity: "error",
    });
    return;
  }

  // AST 상태 저장 및 OpenAPI 벤더 확장 맵에 바인딩
  context.stateMap(cachePolicyKey).set(target, { ttlSeconds, scope });
}
```

---

## Part 3: 실무 체크리스트 및 안티패턴 방어

TypeSpec 데코레이터 및 `.tsp` 모델 작성 시 반드시 확인해야 하는 실무 가이드라인입니다.

- [ ] **필수 임포트 분리**: `@operationId`를 사용할 때는 반드시 상단에 `import "@typespec/openapi"; using TypeSpec.OpenAPI;`를 선언했는가?
- [ ] **오브젝트 리터럴 문법**: 데코레이터 인자로 객체를 넘길 때 일반 `{}` 대신 TypeSpec 0.60+ 규격인 **`#{}`** 표기법을 사용했는가?
- [ ] **단일 모델 가시성 활용**: 동일 리소스의 Create/Update/Read 필드 차이를 위해 DTO를 난립시키지 않고 **`@visibility`** 패턴 도입을 우선 검토했는가?
- [ ] **엄격한 수치 제약**: 부동소수점 및 정수 경계에 `@minValue` 및 `@maxValue`를 명시하여 OpenAPI `exclusiveMinimum` / `minimum` 키워드가 정상 방출되도록 했는가?
- [ ] **다형성 식별자 태그**: 다형성 상속 모델에서 베이스 모델에 `@discriminator("type")`을 붙이고 파생 모델에서 리터럴 타입(`type: "fade";`)을 명확히 고정했는가?
- [ ] **제네릭 에러 계약**: 일회성 에러 모델 대신 `@oa-sdk/typespec-decorators`(`using OaSdkTypeSpec;`)의 `StandardError`, `ErrorResponse<Status>`, `StandardHttpErrors` 템플릿을 활용했는가?

---

## 🔗 관련 문서
- [스키마 아키텍처 및 작성 규칙 (4-Stage TypeSpec SSOT & 비디오 트랜지션 파라미터 다양화)](../schema-architecture-and-conventions.md)
- [TypeSpec 5분 퀵스타트 가이드](./01-quickstart-5min.md)
- [TypeSpec 작성 규칙 및 컨벤션 표준](./02-authoring-conventions.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [TypeSpec 아티팩트 생성 토폴로지 및 아키텍처 규칙](./06-generation-topologies-and-rules.md)
- [선언적 스펙 설정 가이드 (oa.config.ts)](../declarative-spec-configuration.md)
