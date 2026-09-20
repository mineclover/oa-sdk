# TypeSpec 작성 규칙 및 컨벤션 표준 (TypeSpec Authoring Conventions)

이 문서는 `oa-sdk` 모노레포에서 TypeSpec(`.tsp`) 코드를 작성할 때 준수해야 하는 구조적 오너십, 네이밍 규칙, 제네릭 템플릿 사용법, 버전 관리 원칙을 정의합니다.

---

## 1. 파일 및 디렉토리 오너십 구조

모든 API 계약은 `packages/schemas/typespec/` 하위에 위치하며, 다음과 같은 엄격한 책임 분리를 가집니다:

| 경로 | 역할 | 작성 규칙 |
|---|---|---|
| `main.tsp` | 번들 통합 루트 (Composition Root) | `import` 구문과 루트 `namespace` 선언만 포함. 모델 및 오퍼레이션 직접 작성 금지. |
| `version.tsp` | API 계약 버전 | `ContractVersion` 문자열 상수만 정의. OpenAPI `info.version`의 유일한 출처. |
| `metadata/service.tsp` | 서비스 전역 메타데이터 | `@service`, `@server`, `@info`, `@tagMetadata` 전역 설정 소유. |
| `metadata/security.tsp` | 인증/보안 스킴 | `@extension("x-oa-sdk-security-schemes", ...)` 및 전역 보안 스킴 소유. |
| `metadata/common-components.tsp` | 공통 컴포넌트 카탈로그 | 파라미터(Limit, Page) 및 공통 응답(BadRequest, Unauthorized 등) 소유. |
| `common.tsp` | 공통 에러 및 제네릭 템플릿 | `Error`, `ValidationError`, `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>` 소유. |
| `<domain>.tsp` | 도메인별 리소스 모듈 | 도메인 모델, DTO, HTTP Operation 정의 (`users.tsp`, `auth.tsp` 등). |

---

## 2. 네이밍 컨벤션 표준

### 2.1 HTTP Operation (`op`)
- **`operationId`**: `camelCase` 동사 + 명사 조합을 사용합니다.
  - 단건 조회: `getUserById`, `getOrderById`
  - 목록 조회: `listUsers`, `listOrders`
  - 리소스 생성: `createUser`, `createArticle`
  - 리소스 수정: `updateUser`, `updateOrder`
  - 리소스 삭제: `deleteUser`, `deleteOrder`
- **필수 메타데이터 4종**:
  모든 오퍼레이션은 `@summary`, `@doc`, `@tag`, `@operationId`를 반드시 명시해야 합니다:
  ```typespec
  @summary("사용자 단건 조회")
  @doc("UUID를 통해 특정 사용자의 전체 프로필 정보를 조회합니다.")
  @tag("users")
  @operationId("getUserById")
  @route("/users/{id}")
  @get
  op getUserById(@path id: string): Ok<User>;
  ```

> 💡 **필수 임포트 주의**: `@operationId` 데코레이터는 `@typespec/http`가 아니라 `@typespec/openapi`에 속해 있습니다. 따라서 파일 상단에 `import "@typespec/openapi"; using OpenAPI;`가 반드시 선언되어야 합니다.

### 2.2 DTO 및 모델 네이밍
- **엔티티 모델**: 파스칼케이스(`PascalCase`) 단수형 명사 (`User`, `Article`, `Order`).
- **생성 요청 DTO**: `Create<Resource>Request` (`CreateUserRequest`).
- **수정 요청 DTO**: `Update<Resource>Request` (`UpdateUserRequest`).
- **배치/특수 요청 DTO**: `<Action><Resource>Request` (`PurgeUserRequest`).
- **열거형 / 유니온**: TypeSpec 네이티브 문자열 리터럴 유니온 사용을 권장합니다:
  ```typespec
  alias UserRole = "admin" | "user" | "guest";
  alias OrderStatus = "pending" | "paid" | "shipped" | "cancelled";
  ```

---

## 3. 표준 제네릭 응답 템플릿 활용 (`common.tsp` 및 `OaSdkContracts`)

각 엔드포인트마다 `*200Response`, `*401Response` 등의 반복적인 일회성 모델을 직접 정의하지 않고 표준 제네릭 템플릿을 사용합니다.
이 템플릿들은 `packages/schemas/typespec/common.tsp`에 정의되어 있을 뿐만 아니라, `@oa-sdk/typespec-decorators`에 패키징되어 있어 외부 패키지나 타 프로젝트에서도 `import "@oa-sdk/typespec-decorators"; using OaSdkContracts;` 구문으로 동일하게 재사용할 수 있습니다:

### 3.1 제공되는 표준 템플릿
```typespec
// 단건 성공 (200 OK)
model Ok<T> {
  @statusCode statusCode: 200;
  @body body: T;
}

// 생성 완료 (201 Created)
model Created<T> {
  @statusCode statusCode: 201;
  @body body: T;
}

// 본문 없음 (204 No Content)
model NoContent<T = void> {
  @statusCode statusCode: 204;
}

// 페이징 결과 목록 (200 OK)
model PageResult<T> {
  items: T[];
  @minValue(0)
  total: integer;
  @minValue(1)
  page?: integer = 1;
  @minValue(1)
  @maxValue(100)
  limit?: integer = 20;
}

// 상태코드별 에러 응답
model ErrorResponse<Status extends integer> {
  @statusCode statusCode: Status;
  @body body: Error;
}
```

### 3.2 엔드포인트 적용 예시
```typespec
// 1. 목록 조회
@summary("사용자 목록 조회")
@tag("users")
@operationId("listUsers")
@route("/users")
@get
@oaUseResponseComponent("400", "BadRequest")
@oaUseResponseComponent("401", "Unauthorized")
op listUsers(@query page?: integer = 1, @query limit?: integer = 20): Ok<PageResult<User>>;

// 2. 단건 조회
@summary("사용자 단건 조회")
@tag("users")
@operationId("getUserById")
@route("/users/{id}")
@get
@oaUseResponseComponent("401", "Unauthorized")
@oaUseResponseComponent("404", "NotFound")
op getUserById(@path id: string): Ok<User>;

// 3. 삭제
@summary("사용자 삭제")
@tag("users")
@operationId("deleteUser")
@route("/users/{id}")
@delete
@oaUseResponseComponent("401", "Unauthorized")
@oaUseResponseComponent("404", "NotFound")
op deleteUser(@path id: string): NoContent;
```

---

## 4. 데이터 타입 검증 어노테이션 규칙

단순 `string`이나 `integer` 선언을 지양하고, 의도가 명확한 제약 데코레이터를 적용합니다:

| 타입 목적 | 권장 데코레이터 | 예시 |
|---|---|---|
| 식별자 (UUID) | `@format("uuid")` | `@format("uuid") id: string;` |
| 이메일 | `@format("email")` | `@format("email") email: string;` |
| 생성/수정 일시 | `utcDateTime` | `createdAt: utcDateTime;` |
| 문자열 길이 제약 | `@minLength(min)`, `@maxLength(max)` | `@minLength(1) @maxLength(100) name: string;` |
| 숫자 범위 제약 | `@minValue(min)`, `@maxValue(max)` | `@minValue(1) @maxValue(100) limit: integer;` |
| 정규식 패턴 | `@pattern(regex)` | `@pattern("^[a-z0-9-]+$") slug: string;` |

---

## 5. 3계층 버전 격리 원칙 (Strict Version Invariant)

`oa-sdk`는 3개의 독립적인 버전 채널을 엄격히 분리하여 관리합니다:

1. **API 계약 버전 (`ContractVersion` in `version.tsp`)**:
   - OpenAPI의 `info.version`으로 노출되는 외부 소비자 계약 버전입니다.
   - 브레이킹 체인지 시 Major, 하위 호환 추가 시 Minor를 증가시킵니다.
2. **패키지 배포 버전 (`package.json`)**:
   - Changesets와 릴리스 정책(Policy v5)에 따라 관리되는 NPM 패키지 버전입니다.
   - API 스키마 변경 여부와 독립적으로 관리됩니다.
3. **아티팩트 스키마 버전 (`schemaVersion`)**:
   - 번들 매니페스트(`oa-sdk.typespec-bundle.v1`) 등 도구 간 교환 아티팩트의 포맷 버전입니다.

---

## 다음 단계
- [TypeSpec 5분 퀵스타트 가이드](./01-quickstart-5min.md)
- [커스텀 데코레이터 상세 레퍼런스](./03-decorators-reference.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
- [아티팩트 생성 토폴로지 및 아키텍처 규칙](./06-generation-topologies-and-rules.md)
