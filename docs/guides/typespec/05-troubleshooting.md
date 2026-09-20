# TypeSpec 트러블슈팅 및 자주 묻는 질문 (FAQ & Troubleshooting)

이 문서는 TypeSpec(`.tsp`) 작성 및 검증 과정에서 마주칠 수 있는 대표적인 컴파일 오류, 데코레이터 진단 경고, 스냅샷 불일치(Drift) 문제의 원인과 해결 방법을 안내합니다.

---

## 1. 컴파일 오류 및 데코레이터 진단

### Q1. `Cannot decorate alias statement` 오류가 발생합니다.
- **원인**: TypeSpec에서 `alias` 구문은 컴파일러 차원에서 데코레이터(`@doc`, `@summary` 등)를 지원하지 않습니다.
- **해결책**:
  ```typespec
  // ❌ 잘못된 코드
  @doc("사용자 권한 열거형")
  alias UserRole = "admin" | "user";

  // ✅ 올바른 코드 (JSDoc 또는 주석 사용)
  /** 사용자 권한 열거형 */
  alias UserRole = "admin" | "user";
  ```

---

### Q2. 정의한 템플릿 모델이 OpenAPI `components/schemas`에 불필요하게 생성됩니다.
- **원인**: 제네릭 인자(`<T>`)가 없는 일반 `model`은 TypeSpec 컴파일러가 공개 스키마 컴포넌트로 간주하여 무조건 OpenAPI로 방출합니다.
- **해결책**:
  - 실제 엔드포인트에서 아직 사용하지 않는 헬퍼 모델은 제네릭 매개변수(기본값 포함)를 부여하여 템플릿화합니다:
  ```typespec
  // ❌ 컴파일 시 #/components/schemas/NoContent 자동 방출
  model NoContent { @statusCode statusCode: 204; }

  // ✅ 제네릭 매개변수 부여 시 인스턴스화 전까지 방출되지 않음
  model NoContent<T = void> { @statusCode statusCode: 204; }
  ```

---

### Q3. `@oaUseResponseComponent`에서 중복 또는 잘못된 상태 코드 오류가 발생합니다.
- **원인**:
  1. 하나의 Operation에 동일한 상태 코드가 2회 이상 선언된 경우 (예: 401이 2개).
  2. 상태 코드가 3자리 숫자(`100`~`599`) 또는 `default` 형식이 아닌 경우.
- **해결책**:
  - 중복된 상태 코드를 제거하고, 올바른 상태 코드 문자열을 전달합니다:
  ```typespec
  // ✅ 올바른 코드
  @oaUseResponseComponent("401", "Unauthorized")
  @oaUseResponseComponent("404", "NotFound")
  op getUserById(@path id: string): Ok<User>;
  ```

---

### Q4. `@personaCapability`에서 진단 오류가 발생합니다.
- **원인**: 선언된 특성(Trait) 이름이 `packages/personas/src/traits/skill.yaml`의 21대 역량 카탈로그에 등록되어 있지 않은 경우입니다.
- **해결책**:
  - `skill.yaml`에 정의된 공식 특성 ID(`pagination`, `sse-stream`, `audit-emission`, `pii-masked-default`, `idempotent` 등)를 확인하고 철자를 수정합니다.

---

## 2. 스냅샷 불일치(Drift) 및 검증 게이트 해결

### Q5. `pnpm schema:typespec-check` 실행 시 `restored normalized diff: fail`이 뜹니다.
- **원인**: `.tsp` 파일을 수정하여 OpenAPI 스펙에 변경이 발생했으나, 커밋된 베이스라인 스냅샷(`packages/schemas/typespec/approved.openapi.yaml`)이 아직 갱신되지 않았기 때문입니다.
- **해결 절차**:
  1. 먼저 변경 사항이 의도된 것인지 정규화된 Diff를 확인합니다:
     ```bash
     pnpm schema:approve-typespec-reference
     ```
  2. 변경 사항이 올바르다면 베이스라인 스냅샷을 갱신합니다:
     ```bash
     pnpm schema:approve-typespec-reference -- --write
     ```
  3. 다시 게이트를 실행하여 통과를 확인합니다:
     ```bash
     pnpm schema:typespec-check
     ```

---

### Q6. 변경 사항 승인 시 `accepted restored drift` 경고가 발생합니다.
- **원인**: 이전에 임시로 수용한 드리프트(`accepted-restored-drift.json`)가 존재하는 상태에서 새로운 스냅샷 승인이 이루어지는 경우입니다.
- **해결책**:
  - 드리프트를 초기화하고 스냅샷을 함께 승인하도록 플래그를 추가합니다:
  ```bash
  pnpm schema:approve-typespec-reference -- --write --clear-accepted-restored-drift
  ```

---

## 3. IDE 및 LSP 관련 트러블슈팅

### Q7. VS Code에서 자동완성이나 하이라이팅이 동작하지 않습니다.
1. `pnpm install`을 실행하여 로컬 `node_modules/@typespec/compiler`가 정상 설치되어 있는지 확인합니다.
2. 명령 팔레트(`Cmd+Shift+P` / `Ctrl+Shift+P`)를 열고 `TypeSpec: Restart Server`를 실행합니다.
3. `.vscode/settings.json`에서 `typespec.typespec-vscode`가 활성화되어 있는지 확인합니다.

---

## 4. 컴파일러 및 아티팩트 생성 실무 트러블슈팅

### Q8. `error invalid-ref: Unknown decorator @operationId` 에러가 발생합니다.
- **원인**: TypeSpec에서 `@operationId`는 기본 `@typespec/http`가 아니라 **`@typespec/openapi` 패키지에 속해 있습니다.**
- **해결책**: 파일 상단에 `@typespec/openapi` 임포트와 `using OpenAPI;`를 추가하십시오:
  ```typespec
  import "@typespec/http";
  import "@typespec/openapi";

  using Http;
  using OpenAPI;
  ```

### Q9. `error expect-value: Is a model expression type, but is being used as a value here. Use #{}` 에러가 발생합니다.
- **원인**: TypeSpec 0.60+ 최신 사양에서는 `@service`나 `@extension` 등의 데코레이터 인자로 일반 객체 리터럴(`{ key: "val" }`)을 전달하면 모델 표현식으로 파싱되어 에러가 발생합니다.
- **해결책**: 반드시 `#{}` 표기법(객체 값 리터럴)을 사용하십시오:
  ```typespec
  // ❌ 에러 발생
  @service({ title: "My API" })

  // ✅ 정상 동작
  @service(#{ title: "My API" })
  ```

### Q10. 생성된 `queries.ts`나 `client.ts`에서 TypeScript 모듈을 찾을 수 없다고 나옵니다.
- **원인**: 백엔드 계약(`*.contract.ts`)은 무의존성이지만, 생성된 쿼리 훅(`*.queries.ts`)은 `@tanstack/react-query`, 클라이언트(`*.client.ts`)는 `@oa-sdk/client`의 정적 타입을 참조합니다.
- **해결책**: 해당 코드를 사용하는 프론트엔드/소비자 패키지에 의존성을 설치하십시오:
  ```bash
  pnpm add @tanstack/react-query
  pnpm add -D @oa-sdk/client
  ```

### Q11. `Couldn't resolve import "@typespec/http"` 에러가 발생합니다.
- **원인**: `@typespec/compiler`가 프로젝트 루트 외부(예: `/tmp/`)에서 실행되어 상향 경로에서 `node_modules`를 찾을 수 없는 경우입니다.
- **해결책**: `.tsp` 파일은 반드시 `@typespec/http` 및 `@typespec/compiler`가 설치된 프로젝트/모노레포 루트 내부의 경로에 위치시켜 실행하십시오.

---

## 다음 단계
- [TypeSpec 5분 퀵스타트 가이드](./01-quickstart-5min.md)
- [TypeSpec 작성 규칙 및 컨벤션 표준](./02-authoring-conventions.md)
- [커스텀 데코레이터 상세 레퍼런스](./03-decorators-reference.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [아티팩트 생성 토폴로지 및 아키텍처 규칙](./06-generation-topologies-and-rules.md)
