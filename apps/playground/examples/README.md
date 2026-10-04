# Playground 실행 가능한 실전 데모 레퍼런스 (Executable Demos & References)

`@oa-sdk/playground`는 OA SDK의 전체 파이프라인(TypeSpec SSOT, OpenAPI 3.2, 책임 분리(SoC) 불변식, 순수 핸들러 계약, Typed Fetch 클라이언트, TanStack Query v5 3계층, 무경량 독립형 가드, 실시간 무중단 목 서버)을 Node.js/브라우저 환경에서 직접 실행하고 검증할 수 있는 공식 실전 데모 모음집입니다.

---

## 📌 7대 실전 데모 목록 및 실행 명령

| # | 데모 스크립트 | 대상 핵심 역량 및 검증 내용 | 실행 명령어 |
|---|---|---|---|
| **1** | **풀 파이프라인 E2E**<br>[`full-pipeline.ts`](./full-pipeline.ts) | OAS 3.2 정본 스펙 파싱 $\rightarrow$ 인메모리 Mock HTTP 서버 가동 $\rightarrow$ 대표 CRUD 호출 $\rightarrow$ 34개 오퍼레이션 커버리지 리포트 방출 | `pnpm --filter @oa-sdk/playground run demo` |
| **2** | **실전 코드 패턴 & 비디오 트랜지션**<br>[`demo-typespec-patterns.ts`](./demo-typespec-patterns.ts) | 다형성 비디오 트랜지션 6종(`Fade`, `Wipe`, `Slide`, `Gl` 등), `@visibility` 단일 모델 CRUD 수명주기 분기 투영, RFC 9457 구조적 에러, 초당 250만 op/s 벤치마크 | `pnpm --filter @oa-sdk/playground run demo:patterns` |
| **3** | **무경량 독립형 가드 & MV3**<br>[`demo-standalone-guards.ts`](./demo-standalone-guards.ts) | 순수 데이터 모델 선언 $\rightarrow$ 제로-런타임 의존성 독립형 가드 컴파일 $\rightarrow$ Chrome MV3 엄격 CSP 샌드박스(eval 차단) 통과 $\rightarrow$ 430만 msg/sec IPC 검증 | `pnpm --filter @oa-sdk/playground run demo:guards` |
| **4** | **프레임워크 무의존 핸들러 계약**<br>[`demo-router-contracts.ts`](./demo-router-contracts.ts) | 프레임워크 무의존 `*.contract.ts` 핸들러 $\rightarrow$ `HandlerResponse<Status, Body>` 다중 상태 유니온 $\rightarrow$ Hono 라우터 어댑터 바인딩 $\rightarrow$ 인메모리 HTTP E2E 테스트 | `pnpm --filter @oa-sdk/playground run demo:router` |
| **5** | **책임 분리(SoC) & Fail-Closed**<br>[`demo-fail-closed-soc.ts`](./demo-fail-closed-soc.ts) | 재귀 스키마 환경에서 파서의 기계적 `ref-cycle` 진단 보존 $\rightarrow$ `cycleStrategy` 옵션 비교 $\rightarrow$ 다운스트림의 `assertParsedDocumentComplete()` 즉시 차단(Fail-Closed) $\rightarrow$ AST 코드젠의 무손실 타입 보존 | `pnpm --filter @oa-sdk/playground run demo:soc` |
| **6** | **Typed Client & TanStack v5**<br>[`demo-client-tanstack.ts`](./demo-client-tanstack.ts) | Typed Fetch Client SDK 생성 $\rightarrow$ TanStack Query v5 3-Tier 아티팩트 분할 방출(Keys, Options, Hooks) $\rightarrow$ `AbortSignal` 전송/취소 결합 $\rightarrow$ `ClientError` 구조화 에러 | `pnpm --filter @oa-sdk/playground run demo:client` |
| **7** | **실시간 원자적 목 핫스왑**<br>[`demo-mock-hotswap.ts`](./demo-mock-hotswap.ts) | Zero-Build 목 서버 기동 $\rightarrow$ `server.updateSpec()`을 통한 무중단 원자적 라우트 테이블 핫스왑(0ms 전환) $\rightarrow$ 문법 오류 주입 시 Error Shielding $\rightarrow$ 응답 오버라이드 | `pnpm --filter @oa-sdk/playground run demo:mock` |
| **★** | **전체 데모 일괄 실행** | 위 7가지 실전 데모를 한 번에 연속 실행하여 전체 무결성 검증 | `pnpm --filter @oa-sdk/playground run demo:all` |

---

## 🚀 데모별 상세 설명 & 아키텍처 레퍼런스

### 1. `demo-fail-closed-soc.ts` (책임 분리 & Fail-Closed 안전성)
- **배경**: OpenAPI 스키마에 상호 참조나 트리형 순환 참조(`Node -> children: Node[]`)가 발생했을 때, 계층별 책임을 어떻게 기계적으로 분리하는지 증명합니다.
- **핵심 불변식**:
  1. **파서의 기계적 판단 (`@oa-sdk/parser`)**: 순환이 감지되면 절대 "성공(complete)"으로 속이지 않고 `resolution.status = 'partial'`과 `ref-cycle` 진단을 남깁니다.
     - 기본 전략: 무한 메모리 루프를 막기 위해 순환 지점을 `{}`로 절단.
     - `cycleStrategy: 'preserve-ref'`: 재귀 타입을 지원하는 도구를 위해 `{$ref: target}` 형태를 유지.
  2. **다운스트림의 Fail-Closed (`@oa-sdk/client`, `@oa-sdk/router`, `@oa-sdk/mock-server`)**:
     - `assertParsedDocumentComplete(doc)`를 즉시 호출하여 `IncompleteParsedDocumentError`를 던집니다. 조용히 깨진 코드를 런타임에 실행하지 않고 즉각 차단합니다.
  3. **Ref-Aware 특화 컨슈머 (`@oa-sdk/codegen`, `@oa-sdk/surface-ir`)**:
     - Codegen의 AST 타입 생성기는 `$ref`를 TypeScript 명명 인터페이스(`interface TreeNode { children?: TreeNode[] }`)로 직접 치환하여 무손실 타입을 방출합니다.

```bash
pnpm --filter @oa-sdk/playground run demo:soc
```

---

### 2. `demo-client-tanstack.ts` (Typed Client SDK & TanStack Query v5 3-Tier)
- **배경**: 배포 승격된 `@oa-sdk/client`의 타입 안전 API 클라이언트와 TanStack Query v5 3계층 아키텍처 생성을 시연합니다.
- **3-Tier 계층 구조**:
  - **Tier 1 (`*Keys` 튜플 트리)**: 프레임워크와 완전히 독립된 순수 키 배열 생성 (`usersKeys.all`, `usersKeys.lists()`, `usersKeys.detail(id)`).
  - **Tier 2 (`queryOptions` 팩토리)**: UI 없이 테스트/SSR/라우터 로더에서도 바로 호출할 수 있는 순수 옵션 생성. `JsonPrimitive<T>`로 와이어 직렬화 불변성을 강제.
  - **Tier 3 (`'use client'` React 훅스)**: 컴포넌트 라이프사이클에 바인딩되는 `useListUsersQuery`, `useCreateUserMutation`.
- **End-to-End 취소 파이프라인**:
  - 모든 클라이언트 메서드는 `signal?: AbortSignal | null`을 수용하며, `__combineSignals` 엔진을 통해 컴포넌트 언마운트나 쿼리 무효화 시 백엔드 네트워크 소켓을 즉시 중단합니다.

```bash
pnpm --filter @oa-sdk/playground run demo:client
```

---

### 3. `demo-mock-hotswap.ts` (실시간 무중단 라우트 핫스왑 & Error Shielding)
- **배경**: 배포 승격된 `@oa-sdk/mock-server`의 원자적(Atomic) 런타임 갱신 능력을 실증합니다.
- **핵심 기능**:
  - **`server.updateSpec(newSpec)`**: HTTP 포트 바인딩을 유지하면서 내부 라우트 인덱스와 응답 직렬화 테이블을 원자적으로 핫스왑합니다 (0ms 컷오프).
  - **Error Shielding (장애 격리)**: 문법 오류나 잘못된 스키마가 주입되더라도 기존에 서비스 중인 정상 라우트 테이블을 보존하여 서버 다운을 방지합니다.
  - **응답 동적 오버라이드 (`server.override`)**: 특정 `operationId`에 대해 실시간으로 목 응답 본문/상태코드를 주입하여 QA 시나리오를 즉각 시뮬레이션합니다.

```bash
pnpm --filter @oa-sdk/playground run demo:mock
```

---

### 4. `demo-router-contracts.ts` (프레임워크 무의존 순수 핸들러 계약)
- **배경**: `@oa-sdk/router`가 프레임워크 런타임 의존성 0개(`dependencies: {}`)로 비즈니스 로직과 라우팅 배선을 분리하는 표준을 보여줍니다.
- **핵심 패턴**:
  - `HandlerResponse<Status, Body, Headers>` 다중 상태 에러 유니온.
  - 비즈니스 도메인 객체와 HTTP 응답 엔벨로프 간의 3단계 충돌 방어(Collision Defense).
  - Hono, Express, Fastify, Bun Elysia 어디든 5줄 내외로 마운트되는 상호운용성.

```bash
pnpm --filter @oa-sdk/playground run demo:router
```

---

### 5. `demo-standalone-guards.ts` (제로-런타임 의존성 Standalone Guard & MV3)
- **배경**: `@oa-sdk/ast-sync` 및 Standalone 가드가 외부 라이브러리(Ajv, Zod 등) 없이 순수 JS 함수로 컴파일되는 원리를 보여줍니다.
- **보안 & 성능**:
  - Chrome Extension Manifest V3의 엄격한 CSP 샌드박스(`eval()` 및 `new Function()` 금지) 100% 준수 (`oa-gen audit:csp`).
  - 마이크로초 미만 지연시간으로 초당 4,000,000건 이상의 직렬화 메시지 패킷 검증 처리량 달성.

```bash
pnpm --filter @oa-sdk/playground run demo:guards
```

---

### 6. `demo-typespec-patterns.ts` (TypeSpec 8대 작성 패턴 & 비디오 트랜지션)
- **배경**: TypeSpec-First 계약 작성 및 다양한 데이터 제약(Cubic Bezier 커브, GLSL 셰이더, RFC 9457 구조적 에러)을 모델링합니다.
- **수명주기 격리**: 단일 `User` 모델에서 `@visibility`를 통해 `Create`(비밀번호 필수), `Read`(해시 은닉), `Update`(불변 필드 수정 방지)로 자동 분기 투영되는 원리를 검증합니다.

```bash
pnpm --filter @oa-sdk/playground run demo:patterns
```

---

### 7. `full-pipeline.ts` (OAS 3.2 정본 스펙 E2E 파이프라인)
- **배경**: 프로덕션 OAS 3.2 정본 스펙(`packages/schemas/src/.merged.yaml`)을 파싱하고, 인메모리 Mock 서버를 띄워 전체 오퍼레이션의 18% 이상을 커버하는 대표 시나리오를 실행합니다.

```bash
pnpm --filter @oa-sdk/playground run demo
```
