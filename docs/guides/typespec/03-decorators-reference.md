# TypeSpec 커스텀 데코레이터 레퍼런스 (Decorators Reference)

`oa-sdk`는 OpenAPI 3.2 및 거버넌스 정책 준수, Persona 역량 모델링, DPM 데이터 가명화, 논리 ERD 추출을 위해 전용 TypeSpec 데코레이터 패키지를 제공합니다.

---

## 1. `@oa-sdk/typespec-decorators`

오퍼레이션 계약 강화, 공통 응답 바인딩, 페르소나 역량 선언 및 데이터 가명화를 위한 핵심 데코레이터 모음입니다.

### 1.1 `@oaUseResponseComponent`
HTTP Operation에 재사용 가능한 OpenAPI 응답 컴포넌트(`#/components/responses/<name>`)를 연결합니다.

```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkTypeSpec;

@summary("사용자 조회")
@oaUseResponseComponent("401", "Unauthorized")
@oaUseResponseComponent("404", "NotFound")
op getUser(@path id: string): Ok<User>;
```

- **타겟**: `Operation`
- **매개변수**:
  - `statusCode: valueof string`: HTTP 상태 코드 (`"100"` ~ `"599"` 또는 `"default"`)
  - `componentName: valueof string`: `metadata/common-components.tsp`에 정의된 응답 컴포넌트 식별자
- **출력 확장**: OpenAPI `x-oa-sdk-operation-component-refs`
- **검증 규칙**:
  - 상태 코드는 `/^(?:[1-5][0-9]{2}|default)$/` 정규식을 만족해야 합니다.
  - 동일한 Operation에 동일한 상태 코드가 중복 선언되면 컴파일 진단 에러가 발생합니다.

---

### 1.2 `@personaCapability`
API 오퍼레이션이 지원하는 페르소나 역량 특성(Capability Traits)을 선언합니다.

```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkTypeSpec;

@summary("사용자 목록 검색")
@personaCapability("pagination", "full-text-search", "audit-emission", "pii-masked-default")
op searchUsers(@query q: string): Ok<PageResult<User>>;
```

- **타겟**: `Operation`
- **매개변수**:
  - `...traits: valueof string[]`: `packages/personas/src/traits/skill.yaml`에 정의된 21대 역량 특성 ID
- **출력 확장**: OpenAPI `x-oa-sdk-persona-traits`
- **검증 규칙**:
  - `skill.yaml`에 등록되지 않은 특성 이름을 전달하면 컴파일 시 즉시 진단 오류가 발생합니다.
  - 지원 카테고리: `request-shape`, `response-shape`, `lifecycle`, `observability`, `security`, `integration`

---

### 1.3 `@pseudonymize`
DPM(Dynamic Package Manager) 데이터 보호 정책에 따라 특정 필드의 가명화 및 마스킹 규칙을 선언합니다.

```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkTypeSpec;

model UserProfile {
  id: string;

  @doc("이메일 — HMAC 가명화 적용")
  @pseudonymize("hmac-sha256", "admin", true)
  email: string;

  @doc("주민등록번호/개인 식별 토큰")
  @pseudonymize("tokenization", "compliance", true)
  nationalId: string;
}
```

- **타겟**: `ModelProperty`
- **매개변수**:
  - `transform: valueof string`: 가명화 변환 알고리즘 (`"hmac-sha256"`, `"tokenization"`, `"masking"` 등)
  - `role?: valueof string`: 열람 권한 롤 (`"admin"`, `"compliance"` 등)
  - `pii?: valueof boolean`: 개인정보(PII) 포함 여부
  - `relationship?: valueof string`: 연관 외래 식별자 키
- **출력 확장**: OpenAPI `x-oa-sdk-dpm-projection`

---

### 1.4 `@crdt` 및 `@crdtEntity`
분산 환경에서의 동시성 제어 및 CRDT(Conflict-free Replicated Data Type) 복제 정책을 선언합니다.

```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkTypeSpec;

@crdtEntity(#{ strategy: "state-based", sharding: "hash-ring" })
model DocumentNode {
  id: string;

  @crdt(#{ type: "lww-register", clock: "lamport" })
  content: string;
}
```

---

## 2. 플랫폼 공통 표준 계약 모듈 (`OaSdkContracts`)

`@oa-sdk/typespec-decorators`는 모든 마이크로서비스 및 도메인 스펙 간의 일관성을 위해 기본 계약 템플릿(`contracts.tsp`)을 내장하고 있습니다. 별도의 `common.tsp` 정의 없이 라이브러리 import만으로 즉시 사용할 수 있습니다.

```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkTypeSpec;
using OaSdkContracts;

// 성공 제네릭 응답 (200 OK / 201 Created / 204 No Content)
op getOrder(@path id: string): Ok<Order>;
op createOrder(@body body: CreateOrderRequest): Created<Order>;
op deleteOrder(@path id: string): NoContent;

// 페이징 목록 응답 (PageResult<T>)
op listOrders(@query page?: integer, @query limit?: integer): Ok<PageResult<Order>>;

// 표준 에러 응답 직접 반환
op validatePayment(@body body: PaymentRequest): Ok<PaymentResult> | StandardHttpErrors.BadRequest;
```

### 2.1 제공되는 표준 계약 타입 목록

| 계약 타입 | HTTP 상태 | 설명 |
|---|---|---|
| `Ok<T>` | 200 OK | 단건 성공 응답 바디 래퍼 (`{ @statusCode: 200, @body body: T }`) |
| `Created<T>` | 201 Created | 리소스 생성 완료 응답 (`{ @statusCode: 201, @body body: T }`) |
| `NoContent<T = void>` | 204 No Content | 응답 바디가 없는 성공 응답 (기본 제네릭 파라미터로 스키마 드리프트 방지) |
| `PageResult<T>` | - | 페이징 응답 객체 (`items: T[]`, `total: integer`, `page: integer`, `limit: integer`) |
| `StandardError` | - | 공통 RFC 7807/RFC 9457 호환 에러 DTO (`code`, `message`, `details?`) |
| `StandardValidationError` | - | 필드 검증 실패 에러 DTO (`field`, `code`, `message`) |
| `ErrorResponse<Status>` | `Status` | 임의의 HTTP 상태 코드를 갖는 표준 에러 응답 |
| `StandardHttpErrors.*` | 400 ~ 500 | `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `InternalServerError` |

---

## 3. `@oa-sdk/typespec-erd`

TypeSpec 모델로부터 논리 ERD(`logical-erd.json`)를 컴파일 타임에 추출하기 위한 전용 데코레이터입니다.

```typespec
import "@oa-sdk/typespec-erd";
using OaSdkErd;

@dataset("ecommerce")
namespace Store {
  @entity("users")
  model User {
    @primaryKey
    @field("usr_id")
    id: string;

    @unique
    @field("usr_email")
    email: string;
  }

  @entity("orders")
  model Order {
    @primaryKey
    @field("ord_id")
    id: string;

    @foreignKey(User.id)
    @field("ord_user_id")
    userId: string;
  }

  @relationship("rel_user_orders", User.id, Order.userId, "one-to-many")
  namespace Relations {}
}
```

| 데코레이터 | 타겟 | 설명 |
|---|---|---|
| `@dataset(id)` | `Namespace` | 논리 데이터셋 스코프 선언 |
| `@entity(id)` | `Model` | 리네임에 안전한 논리 엔티티 식별자 선언 |
| `@field(id)` | `ModelProperty` | 물리 DB 컬럼과 매핑 가능한 논리 필드 식별자 선언 |
| `@primaryKey(groupId?, order?)` | `ModelProperty` | 기본 키 또는 복합 기본 키 지정 |
| `@unique` | `ModelProperty` | 유니크 제약 조건 선언 |
| `@foreignKey(targetField)` | `ModelProperty` | 논리 외래 키 참조 선언 |
| `@relationship(id, from, to, cardinality)` | `Namespace` | 두 필드 간의 관계 및 카디널리티(`one-to-one`, `one-to-many`, `many-to-one`) 선언 |

---

## 다음 단계
- [TypeSpec 5분 퀵스타트 가이드](./01-quickstart-5min.md)
- [TypeSpec 작성 규칙 및 컨벤션 표준](./02-authoring-conventions.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
