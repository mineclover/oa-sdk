---
docType: troubleshooting
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

# TypeSpec 트러블슈팅 및 자주 묻는 질문 (FAQ & Troubleshooting)

TypeSpec(`.tsp`)을 작성하고 검증할 때 만나는 컴파일 오류, decorator 진단, 승인 스냅샷 불일치, 생성물 문제의 원인과 해결 방법입니다. 진단 문구는 TypeSpec 1.16과 `@oa-sdk/codegen` 0.9.0에서 확인했습니다. 2절은 oa-sdk 저장소 기여자용입니다.

---

## 1. 컴파일 오류 및 데코레이터 진단

### Q1. `Cannot decorate alias statement` 오류가 발생합니다.
- **원인**: `alias`에는 decorator(`@doc`, `@summary` 등)를 붙일 수 없습니다(`invalid-decorator-location`).
- **해결책**:
  ```typespec
  // ❌ 잘못된 코드
  @doc("사용자 권한 열거형")
  alias UserRole = "admin" | "user";

  // ✅ 올바른 코드 (문서 주석 사용)
  /** 사용자 권한 열거형 */
  alias UserRole = "admin" | "user";
  ```

---

### Q2. 정의한 템플릿 모델이 OpenAPI `components/schemas`에 불필요하게 생성됩니다.
- **원인**: 템플릿 매개변수(`<T>`)가 없는 `model`은 OpenAPI emitter가 공개 schema 컴포넌트로 출력합니다.
- **해결책**: 아직 쓰지 않는 헬퍼 모델에는 기본값이 있는 템플릿 매개변수를 줍니다.
  ```typespec
  // ❌ #/components/schemas/NoContent 가 출력됨
  model NoContent { @statusCode statusCode: 204; }

  // ✅ 템플릿 매개변수가 있으면 인스턴스화 전까지 출력되지 않음
  model NoContent<T = void> { @statusCode statusCode: 204; }
  ```

---

### Q3. `@oaUseResponseComponent`에서 `invalid-response-component-reference` 오류가 발생합니다.
- **원인**: 상태 코드가 세 자리 숫자(`100`~`599`)나 `default`가 아니거나, 컴포넌트 이름이 영문자로 시작하는 단순 이름(`[A-Za-z][A-Za-z0-9._-]*`)이 아닙니다.
- **해결책**: 상태 코드를 문자열로, 컴포넌트 이름을 단순 이름으로 넘깁니다.
  ```typespec
  @oaUseResponseComponent("401", "Unauthorized")
  @oaUseResponseComponent("404", "NotFound")
  op getUserById(@path id: string): Ok<User> | ErrorResponse<401> | ErrorResponse<404>;
  ```
- 같은 상태 코드를 두 번 선언하면 진단 없이 operation에 가장 가까운(아래쪽) 선언 하나만 남습니다. 오류가 나지 않으므로 리뷰에서 확인합니다.

---

### Q4. `@personaCapability`에서 `invalid-persona-trait` 오류가 발생합니다.
- **원인**: trait 이름이 `packages/personas/src/traits/skill.yaml`의 표준 trait 24종(`VALID_PERSONA_TRAITS`)에 없습니다.
- **해결책**: `pagination`, `sse-stream`, `audit-emission`, `pii-masked-default`, `idempotent` 같은 표준 trait ID로 고칩니다. 전체 목록은 [`@oa-sdk/typespec-decorators` README](../../../packages/typespec-decorators/README.md)의 `VALID_PERSONA_TRAITS` 설명과 `skill.yaml`을 봅니다.

---

## 2. 승인 스냅샷과 검증 게이트 (저장소 기여자용)

승인 절차의 정본은 [계약 변경 절차](../typespec-authoring-conventions.md#7-계약-변경-절차-contract-change-workflow)입니다.

### Q5. `pnpm schema:typespec-check` 결과에 `restored normalized diff: fail`이 나옵니다.
- **원인**: `.tsp`를 고쳐 OpenAPI가 바뀌었지만 커밋된 승인 스냅샷(`packages/schemas/typespec/approved.openapi.yaml`)을 아직 갱신하지 않았습니다.
- **해결 절차**: `pnpm schema:approve-typespec-reference`로 candidate diff가 의도한 변경인지 확인하고, `pnpm schema:approve-typespec-reference -- --write`로 갱신한 뒤 `pnpm schema:typespec-check`를 다시 실행합니다.

---

### Q6. 승인 명령이 `cannot promote while ... has N accepted entries`로 거부됩니다.
- **원인**: 이전에 수용한 drift(`accepted-restored-drift.json`)가 남아 있는 상태에서 스냅샷을 승격하려 했습니다. 경고가 아니라 오류로 승격을 거부합니다.
- **해결책**: 남은 항목을 리뷰한 뒤, drift manifest 초기화와 스냅샷 승격을 함께 수행합니다.
  ```bash
  pnpm schema:approve-typespec-reference -- --write --clear-accepted-restored-drift
  ```

---

### Q7. 승인 명령이 `cannot approve TypeSpec snapshot: compatibilitySidecar` 또는 `compatibilitySidecar, provenance`로 실패합니다.
- **원인**: `@oaUseResponseComponent`(또는 raw `x-oa-sdk-operation-component-refs`)를 쓴 operation에 필요한 나머지가 없습니다. 반환 타입에 그 상태 응답이 없으면 bundle check 출력에 `restore targets: N applied, M missing`이, 응답 예제 확장(`x-oa-sdk-operation-examples`)이 없으면 `sidecar re-extract`의 불일치가 보입니다. `oa-gen tsp-scaffold`가 만든 코드를 그대로 승인하면 이렇게 실패합니다.
- **해결책**: [재사용 응답 컴포넌트에 연결하기](../typespec-authoring-conventions.md#31-재사용-응답-컴포넌트에-연결하기)의 세 가지를 갖추거나, `@oaUseResponseComponent` 줄을 지우고 반환 타입에 `ErrorResponse<Status>`를 선언합니다([퀵스타트 2단계](./01-quickstart-5min.md#2-crud-스캐폴딩과-응답-정리)).

---

## 3. IDE 및 LSP

### Q8. VS Code에서 자동완성이나 하이라이팅이 동작하지 않습니다.
[TypeSpec IDE 설정의 트러블슈팅](../typespec-ide-setup.md#4-트러블슈팅)을 봅니다.

---

## 4. 컴파일러 및 생성물

### Q9. `error invalid-ref: Unknown decorator @operationId` 에러가 발생합니다.
- **원인**: `@operationId`는 `@typespec/http`가 아니라 `@typespec/openapi`에 있습니다.
- **해결책**: 파일 상단에 `@typespec/openapi` import와 `using OpenAPI;`를 추가합니다.
  ```typespec
  import "@typespec/http";
  import "@typespec/openapi";

  using Http;
  using OpenAPI;
  ```

### Q10. `error expect-value: Is a model expression type, but is being used as a value here. Use #{} to create an object value.` 에러가 발생합니다.
- **원인**: TypeSpec 1.x에서 `@service`, `@extension` 같은 decorator에 일반 객체 리터럴(`{ key: "val" }`)을 넘기면 모델 표현식으로 해석됩니다.
- **해결책**: 객체 값 문법 `#{}`를 씁니다.
  ```typespec
  // ❌ 에러 발생
  @service({ title: "My API" })

  // ✅ 정상 동작
  @service(#{ title: "My API" })
  ```

### Q11. 생성된 `queries.ts`에서 모듈을 찾을 수 없다고 나옵니다.
- **원인**: 생성된 fetch 클라이언트(`*.client.ts`)와 핸들러 계약(`*.contract.ts`)은 import가 없습니다. TanStack Query 코드(`*.queries.ts`, `tanstack-query.ts`)만 `@tanstack/react-query`와 `@oa-sdk/client`의 타입(`import type { JsonPrimitive, Resolved } from '@oa-sdk/client'`)을 import합니다.
- **해결책**: 이 코드를 쓰는 프로젝트에 두 패키지를 설치합니다.
  ```bash
  npm install @tanstack/react-query
  npm install --save-dev @oa-sdk/client
  ```
  `@oa-sdk/client`는 `@oa-sdk/codegen` 0.9.0 릴리스부터 npm에서 제공됩니다.

### Q12. `Couldn't resolve import "@typespec/http"` (`import-not-found`) 에러가 발생합니다.
- **원인**: TypeSpec은 `.tsp`의 `import "@typespec/http"`를 그 파일 위치에서 Node 방식으로 찾습니다. pnpm처럼 엄격한 레이아웃에서는 `@oa-sdk/codegen`이 의존하는 사본이 보이지 않으므로, 프로젝트에 직접 설치하지 않았으면 실패합니다. 프로젝트 밖(예: `/tmp`)에 둔 `.tsp`도 같은 이유로 실패합니다.
- **해결책**: `.tsp`가 import하는 라이브러리(`@typespec/http`, `@typespec/openapi`, `@oa-sdk/typespec-decorators`)를 프로젝트의 직접 devDependency로 설치합니다. 설치 명령은 [`@oa-sdk/typespec-decorators` README](../../../packages/typespec-decorators/README.md#install)에 있습니다.

### Q13. `oa-gen mock`, `generate:client`, `generate:tanstack`이 설치 명령을 출력하고 종료 코드 1로 끝납니다.
- **원인**: 이 명령은 `@oa-sdk/codegen`에 포함되지 않은 동반 패키지(companion package)를 불러옵니다. `oa-gen mock`은 `@oa-sdk/mock-server`, `generate:client`와 `generate:tanstack`은 `@oa-sdk/client`가 필요합니다.
- **해결책**: 출력된 설치 명령을 실행합니다. 명령별 필요 패키지와 `oa-gen generate`에서의 동작은 [동반 패키지](../cli-setup.md#동반-패키지-companion-packages)를 봅니다.

### Q14. `@oaUseResponseComponent`로 선언한 4xx 응답이 mock 서버나 생성된 타입에 없습니다.
- **원인**: 이 decorator는 `x-oa-sdk-operation-component-refs` 확장만 기록합니다. 재사용 응답으로 바뀌는 곳은 bundle restore(`oa-gen tsp-bundle-check`, 저장소의 `pnpm schema:typespec-check`)뿐이고, `oa-gen mock --tsp`나 `.tsp`를 넣은 `generate`·`typegen`은 반환 타입에 선언한 응답만 만듭니다.
- **해결책**: 4xx 응답을 반환 타입에 `ErrorResponse<Status>`나 `StandardHttpErrors`로 선언합니다. 이 응답은 메모리 컴파일 경로에도 나옵니다.

---

## 다음 단계
- [TypeSpec 5분 퀵스타트 (저장소 기여자용)](./01-quickstart-5min.md)
- [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)
- [TypeSpec 데코레이터 레퍼런스](./03-decorators-reference.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [아티팩트 생성 토폴로지 및 아키텍처 규칙](./06-generation-topologies-and-rules.md)
