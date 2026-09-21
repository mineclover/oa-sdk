# oa-sdk 가이드 색인 및 아키텍처 지도 (Guide Directory & Architecture Map)

`oa-sdk`는 OpenAPI 3.1/3.2 및 TypeSpec 기반의 API 계약을 **선언(Authoring)**하고, 이를 실무 애플리케이션에서 안전하게 **소비(Consumption)**하기 위한 통합 도구 모음입니다.

이 문서는 엔지니어의 역할과 목적에 따라 가장 적합한 문서를 빠르게 찾을 수 있도록 **선언자 트랙(Author Track)**과 **소비자 트랙(Consumer Track)**으로 이원화된 가이드 탐색 지도를 제공합니다.

---

## 🧭 빠른 탐색 나침반 (Role-Based Fast Track)

```
                                  [ oa-sdk 가이드 에코시스템 ]
                                                │
         ┌──────────────────────────────────────┴──────────────────────────────────────┐
         ▼                                                                             ▼
 [ ✍️ 선언자 트랙 (Author Track) ]                                            [ 💻 소비자 트랙 (Consumer Track) ]
 "스펙, 데이터 모델, 제약 조건을 설계/선언"                                    "타입, SDK, 핸들러, Mock을 가져다 사용"
 
 1. HTTP API 선언 (TypeSpec / OAS 3.2)                                         1. 순수 타입 & 제로-런타임 가드 소비
    • schema-authoring.md                                                         • pure-types-and-guards.md
    • typespec/01~05, typespec-*.md                                               • ../benchmarks/validation-engines.md
    • openapi32-contract-management.md
 
 2. 순수 데이터 모델 & DTO 선언 (Non-HTTP)                                     2. 프론트엔드 SDK & TanStack Query v5
    • pure-types-and-guards.md                                                    • client-and-query-consumption.md
    • schema-architecture-and-conventions.md (Stage 1)                           • client-sdk-distribution.md
 
 3. 스펙 거버넌스 & 변경 관리                                                  3. 백엔드 핸들러 계약 (*.contract.ts)
    • basic-spec-usage.md (SSOT 거버넌스)                                         • backend-handler-contracts.md
    • declarative-spec-configuration.md (oa.config.ts)                            • onboarding-playbook.md
    • duplicate-review.md / path-fragment-conventions.md
                                                                               4. Mock 기반 병렬 개발 & 테스트
                                                                                  • mock-server-usage.md
                                                                                  • use-cases/mock-testing.md
```

| 개발자 역할 | 주요 목적 | 추천 읽기 경로 |
|---|---|---|
| **API / 스펙 설계자** | REST 엔드포인트, 파라미터, 응답 스키마 선언 | [스키마 작성 가이드](./schema-authoring.md) $\rightarrow$ [TypeSpec Quickstart](./typespec/01-quickstart-5min.md) $\rightarrow$ [기본 스펙 사용 기준](./basic-spec-usage.md) |
| **데이터 모델러 (Non-HTTP)** | Chrome MV3 메시징, IPC, DB DTO, 이벤트 버스 타입 선언 | [순수 타입 선언 및 가드 실무 가이드](./pure-types-and-guards.md) $\rightarrow$ [4단계 TypeSpec-First 파이프라인](./schema-architecture-and-conventions.md) |
| **프론트엔드 엔지니어** | 타입 안전한 API 호출, TanStack Query 훅, Mocking | [프론트엔드 SDK 및 쿼리 소비 가이드](./client-and-query-consumption.md) $\rightarrow$ [Mock 서버 활용 가이드](./mock-server-usage.md) $\rightarrow$ [SDK 배포 가이드](./client-sdk-distribution.md) |
| **백엔드 엔지니어** | 비즈니스 로직 작성, 프레임워크 라우터 바인딩, 멀티 에러 반환 | [백엔드 핸들러 계약 가이드](./backend-handler-contracts.md) $\rightarrow$ [온보딩 플레이북](./onboarding-playbook.md) $\rightarrow$ [코드젠 워크플로](./use-cases/codegen-workflow.md) |
| **품질 / DevOps 엔지니어** | CI 파괴적 변경 감지, 제로-eval CSP 보안 감사, 빌드 자동화 | [CLI 명령 레퍼런스](./cli-command-reference.md) $\rightarrow$ [선언적 스펙 설정](./declarative-spec-configuration.md) $\rightarrow$ [검증 엔진 성능 벤치마크](../benchmarks/validation-engines.md) |

---

## 🎮 0. 바로 실행해보는 실무 데모 (Interactive Executable Demos)

이론적 학습에 앞서, oa-sdk의 다양한 실전 코드 패턴과 파이프라인을 직접 터미널에서 즉시 실행하고 검증할 수 있습니다.

- **[공식 실행 데모 모음 및 가이드](../examples/README.md)**:
  - `pnpm --filter @oa-sdk/playground run demo:patterns`: 다형성 비디오 트랜지션 6종, `@visibility` CRUD 분기 투영, RFC 9457 에러, 250만 op/s 가드 벤치마크.
  - `pnpm --filter @oa-sdk/playground run demo:guards`: Chrome Extension Manifest V3 CSP 샌드박스(eval 차단) 완벽 준수 및 430만 msg/s Worker IPC 검증.
  - `pnpm --filter @oa-sdk/playground run demo:router`: 프레임워크 무의존 `*.contract.ts` 순수 핸들러 계약 및 Hono 라우터 마운트.
  - `pnpm --filter @oa-sdk/playground run demo`: 풀 파이프라인 OpenAPI 3.2 파싱 및 Mock Server 가동.
  - `pnpm --filter @oa-sdk/playground run demo:all`: 4가지 실무 데모 일괄 실행.

---

스펙과 도메인 모델을 설계하고, 제약 조건을 정의하며, 팀 간의 단일 진실 공급원(SSOT)을 유지하는 엔지니어를 위한 문서입니다.

### 1.1 HTTP API 및 REST 엔드포인트 선언
TypeSpec 및 OpenAPI 3.2를 사용하여 프로덕션 레벨의 API 스펙을 선언하는 실무 가이드입니다.
- **[스키마 작성 가이드 (Schema Authoring)](./schema-authoring.md)**: TypeSpec-first 실무 플레이북. 도메인 모델, 오퍼레이션, 파라미터, OAS 3.2 신규 문법(`dataValue`, `itemSchema`, `defaultMapping`) 작성 규칙.
- **[TypeSpec 5분 퀵스타트](./typespec/01-quickstart-5min.md)**: TypeSpec 입문 및 프로젝트 구성 기초.
- **[TypeSpec 작성 컨벤션](./typespec/02-authoring-conventions.md)**: 모듈 분할, 네임스페이스, literal union, alias 사용 표준.
- **[TypeSpec 종합 데코레이터 레퍼런스 및 8대 실전 작성 패턴](./typespec/03-decorators-reference.md)**: 코어 메타데이터, HTTP, OpenAPI, JSON Schema 제약, 다형성/라이프사이클, `@oa-sdk` 확장 데코레이터 및 8대 프로덕션 `.tsp` 작성 패턴 바이블.
- **[TypeSpec 스캐폴딩 및 Diff](./typespec/04-scaffolding-and-diff.md)**: 스펙 변경 시점의 candidate diff 확인 및 승인 스냅샷 관리.
- **[TypeSpec 트러블슈팅](./typespec/05-troubleshooting.md)**: 컴파일 에러, 순환 참조 해결 가이드.
- **[TypeSpec 아티팩트 생성 토폴로지 및 아키텍처 규칙](./typespec/06-generation-topologies-and-rules.md)**: Co-located(피처 인접), FSD, Monorepo 4대 생성 토폴로지, 5대 아키텍처 불변 규칙, 5대 작성 컨벤션.
- **[TypeSpec IDE 설정 가이드](./typespec-ide-setup.md)**: VSCode/Cursor용 LSP, 코드 조각(Snippets), 실시간 린터 설정.
- **[OpenAPI 3.2 계약 관리](./openapi32-contract-management.md)**: OAS 3.2 strict validation gate 및 계약 불변식.

### 1.2 순수 데이터 모델 & DTO 선언 (Non-HTTP Use Cases)
HTTP 전송 계층 없이 브라우저 확장프로그램(MV3), Worker IPC, WebSocket, Database DTO용 순수 타입을 선언하는 가이드입니다.
- **[순수 타입 선언 및 제로-런타임 가드 가이드](./pure-types-and-guards.md) (★ 권장)**: HTTP 엔드포인트가 없는 순수 모델 정의 방법(TypeSpec models without ops / Zod Master Schemas), `oa-gen typegen`을 통한 순수 인터페이스 방출, 제로-eval/제로-런타임 가드(`isUser`) 생성.
- **[스키마 아키텍처 및 작성 규칙 (4-Stage TypeSpec-First Pipeline SSOT & Video Transitions)](./schema-architecture-and-conventions.md)**: TypeSpec SSOT $\rightarrow$ JSON Schema 2020-12 $\rightarrow$ OAS 3.1/3.2 $\rightarrow$ Standalone AJV Type Guards 파이프라인, 비디오 트랜지션 파라미터 다양화 표준, MCP/CLI 도구 브릿지.
- **[스키마 대수 (Schema Algebra)](./schema-algebra.md)**: 재사용 가능한 복합 모델 합성 및 fold 패턴.
- **[스키마 어노테이션 컨벤션](./schema-annotations.md)**: 작성자 메모, 내부 메타데이터 표기 표준.
- **[TypeSpec 논리 ERD 작성](./typespec-logical-erd-authoring.md)**: 비즈니스 엔터티 간 관계 모델링.

### 1.3 스펙 거버넌스 및 변경 관리
스펙의 단일 진실 공급원(SSOT)을 보호하고, 파괴적 변경(Breaking Drift)을 사전에 차단하는 운영 가이드입니다.
- **[기본 스펙 사용 기준 (Spec Governance SSOT)](./basic-spec-usage.md)**: 저장소 스펙 정본과 생성물(Generated Artifacts)의 소유권 경계 및 파이프라인.
- **[선언적 스펙 설정 (oa.config.ts)](./declarative-spec-configuration.md)**: 다중 프로파일(`operation-contract`, `component-bundle`), 라이프사이클 아키타입, 출력 라우팅 설정.
- **[중복 스펙 검토 (Duplicate Review)](./duplicate-review.md)**: 프래그먼트 중복 탐지 정책 및 CI 게이트.
- **[패스 프래그먼트 컨벤션](./path-fragment-conventions.md)**: 레거시 롤백 경로용 YAML 프래그먼트 파일시스템 계층 규칙.
- **[외부 서비스 거버넌스 템플릿](./openapi-governance-service-template.md)**: NestJS, FastAPI 등 런타임 추출 스펙의 거버넌스 파이프라인.

---

## 💻 2. 소비자 트랙 (Type, SDK & Contract Consumer Track)

생성된 스키마 산출물을 가져다 프론트엔드 화면 개발, 백엔드 비즈니스 서비스 구현, E2E 통합 테스트를 진행하는 엔지니어를 위한 문서입니다.

### 2.1 순수 타입 & 제로-런타임 가드 소비
- **[순수 타입 선언 및 제로-런타임 가드 가이드](./pure-types-and-guards.md)**:
  - `oa-gen typegen`으로 생성된 TypeScript 인터페이스 소비.
  - `oa-gen standalone-guards`로 생성된 무의존성 타입 가드(`isUserProfile`)를 이용해 Chrome MV3, Node Worker, Event Bus 메시지 검증.
- **[TypeScript 호환성 가이드](./typescript-compatibility.md)**: TS 5.x baseline과 TS 7/`ttsc` 컴파일러 호환 경계.
- **[검증 엔진 성능 벤치마크](../benchmarks/validation-engines.md)**: Zod vs Standalone Type Guards vs Typia AOT 처리량, 지연시간, 번들 크기 비교.

### 2.2 프론트엔드 SDK 및 TanStack Query v5 소비
- **[프론트엔드 SDK 및 쿼리 소비 가이드](./client-and-query-consumption.md) (★ 권장)**:
  - `@oa-sdk/client` 초기화, 인증 미들웨어(`bearerAuth`, `apiKeyAuth`), 지수 백오프 재시도.
  - 듀얼 콜 컨벤션: 위치 인자(`client.getUser(id)`) 및 단일 객체 인자(`client.getUser({ params, signal })`).
  - 쿼리 파라미터 오염 방지 및 `AbortSignal` 취소 연동.
  - `withResponse`를 통한 헤더 및 원본 HTTP Response 접근.
  - TanStack Query v5 3계층 옵션 팩토리(`--tier`, `--framework react|vue|svelte`, `--split`) 연동.
- **[클라이언트 SDK 배포 가이드](./client-sdk-distribution.md)**:
  - Model A: 로컬 온디맨드 소스 공급 (`devDependencies` + `oa-gen generate:client`)
  - Model B: 독립 사전 빌드 패키지 배포 (`oa-gen generate:client --pack`, 런타임 의존성 0개, `dist/index.js` + `.d.ts`)
- **[빠른 시작 (Quick Start)](./quick-start.md)**: 5분 만에 공개 OpenAPI로부터 클라이언트 생성 및 호출.

### 2.3 백엔드 서비스 및 핸들러 계약 구현
- **[백엔드 핸들러 계약 구현 가이드](./backend-handler-contracts.md) (★ 권장)**:
  - `@oa-sdk/router`의 순수 핸들러 계약(`*.contract.ts`) 구현 방법.
  - 재생성 공포(Regeneration Anxiety) 제로: 비즈니스 로직 파일이 절대 덮어쓰이지 않는 격리 아키텍처.
  - 순수 데이터 컨텍스트(`{ params, query, body }`)와 멀티 상태 에러 유니온(`HandlerResponse`).
  - 프레임워크 바인더(Fastify JIT, Bun Elysia Zero-Copy, Hono, Express) 연결 방법.
- **[프로젝트 온보딩 & 점진적 도입 플레이북](./onboarding-playbook.md)**:
  - 5대 무가치 관리 포인트 제거 (동기화 회의, 덮어쓰기 딜레마, 목업 병목, 프레임워크 락인, 무음 드리프트).
  - 3계층 가치 도입 사다리(Tier 1 Discovery $\rightarrow$ Tier 2 Contract-First $\rightarrow$ Tier 3 Multi-Framework).
- **[코드젠 워크플로 유스케이스](./use-cases/codegen-workflow.md)**:
  - Drizzle ORM $\rightarrow$ OAS $\rightarrow$ TypeScript $\rightarrow$ 라우터 $\rightarrow$ 클라이언트 파이프라인.

### 2.4 Mock 기반 병렬 개발 및 통합 테스트
- **[Mock 서버 사용법](./mock-server-usage.md)**:
  - `oa-gen mock --watch`: 스키마 수정 즉시 소켓 단절 없이 핫리로드되는 인메모리 Mock 서버.
  - Node HTTP 어댑터 및 MSW(Mock Service Worker) 브라우저 어댑터 구동.
  - 플러그인 기반 상태 유지 Mocking: REST 컬렉션 자동 CRUD 및 seed/reset 지원 (`--stateful`).
- **[Mock 테스팅 유스케이스](./use-cases/mock-testing.md)**:
  - 백엔드 개발 완료를 기다리지 않고 프론트엔드/QA 팀이 독립적으로 테스트를 수행하는 패턴.

---

## 🛠️ 3. 공통 도구 및 인프라 (Common Tooling & Reference)

선언자와 소비자 모두가 공통으로 활용하는 CLI 명령어와 시스템 레퍼런스입니다.

- **[CLI 명령 레퍼런스](./cli-command-reference.md)**: `oa-gen`의 모든 명령어 명세 (`generate`, `typegen`, `generate:client`, `generate:tanstack`, `mock`, `diff` 등).
- **[CLI 설치 및 환경 설정](./cli-setup.md)**: Node.js, Bun, PNPM 환경에서의 `oa-gen` 설치 및 설정.
- **[라이브러리 진입점 지도](./library-entrypoints.md)**: `@oa-sdk/*` 모노레포 패키지별 루트 및 서브패스 export 경계.
- **[패키지 릴리즈 준비 가이드](./release-preparation.md)**: 아티팩트 전용 패키지 릴리즈 절차.
- **[시스템 온보딩 가이드](./system-onboarding.md)**: 모노레포 신규 기여자를 위한 환경 설정.
