# oa-sdk 가이드 색인 및 아키텍처 지도 (Guide Directory & Architecture Map)

이 문서는 엔지니어의 역할과 목적에 따라 가장 적합한 문서를 빠르게 찾을 수 있도록 **시작하기**, **선언자 트랙(Author Track)**, **소비자 트랙(Consumer Track)**, **기여자·메인테이너** 경로로 나눈 가이드 탐색 지도를 제공합니다. 다른 프로젝트에서 공개 패키지를 쓰는 흐름과 oa-sdk 저장소 자체에 기여하는 흐름은 서로 다른 문서를 따릅니다.

---

## oa-sdk가 해결하는 문제와 핵심 가치

oa-sdk는 API 계약(API가 받는 요청과 돌려주는 응답의 약속)을 관리하는 도구 모음입니다. 사람이 고치는 원본을 하나로 정하고, 그 원본에서 만드는 OpenAPI 문서, TypeScript 타입, 클라이언트, 핸들러 계약을 언제든 다시 만들 수 있는 생성물로 다룹니다. mock 서버도 같은 원본을 읽어 띄웁니다. 이 절은 사용자 관점의 요약이며, 제품 범위의 정본은 [Platform Scope](../internal/platform-scope.md#core-mission)입니다.

이 절의 동작은 `@oa-sdk/codegen` 0.10.0 기준입니다. 공개 패키지는 Node.js 22 이상에서 동작합니다. registry에 배포된 버전은 [변경 이력](../changelog.md)과 `npm view @oa-sdk/codegen version`으로 확인합니다.

### 왜 계약 관리 도구가 필요한가

API 계약이 스펙 문서, 서버 코드, 클라이언트 타입, mock 데이터, 외부 서비스가 내보낸 Swagger 문서에 흩어져 있으면 다음 문제가 반복됩니다.

- 생성된 파일을 손으로 고치면 다음 생성에서 수정이 사라지거나, 원본과 어긋난 생성물이 그대로 머지됩니다.
- 도구마다 같은 스펙을 다르게 읽습니다. 예를 들어 `$ref` 옆에 적은 필드를 한 도구는 반영하고 다른 도구는 무시하면, mock 서버에서 통과한 요청이 생성된 클라이언트에서는 다르게 만들어집니다.
- 기존 소비자를 깨뜨리는 변경(breaking change)을 PR 리뷰가 아니라 소비자의 런타임 오류로 처음 알게 됩니다.
- 실행 중인 서버가 내보내는 OpenAPI 문서가 관리 중인 계약과 달라져도(runtime drift) 드러나지 않습니다.

oa-sdk는 고칠 곳을 하나로 정하고 나머지는 다시 만들 수 있는 생성물로 다룹니다. 각 규칙은 CLI 종료 코드로 확인하므로 CI에 그대로 걸 수 있습니다.

### 핵심 가치

| 가치 | 사용자가 얻는 것 | 동작 방식과 근거 |
|---|---|---|
| 고칠 곳은 한 곳 | 계약은 원본에서만 고치고, 생성물은 언제든 다시 만듭니다. | `oa.config.ts`의 spec target이 원본(`schemaEntry`)을 정합니다. TypeSpec(`.tsp`, Microsoft의 API 정의 언어)을 권장하고, OpenAPI YAML/JSON 문서나 Zod 스키마를 export하는 TypeScript 모듈도 받습니다([선언적 스펙 설정](./declarative-spec-configuration.md)). `oa-gen check-artifact`는 생성된 OpenAPI 문서(`<id>.openapi.json`)가 원본에서 다시 만든 결과와 다르면 종료 코드 1로 실패하므로 CI에 걸 수 있습니다. 이 저장소의 production 계약은 같은 원칙을 TypeSpec 원본, 승인 snapshot, CI gate로 지킵니다([기본 스펙 사용 기준](./basic-spec-usage.md)). |
| 이미 있는 스키마에서 시작 | TypeSpec으로 옮기지 않아도 기존 OpenAPI 문서로 검증, 타입 생성, mock부터 시작합니다. NestJS·FastAPI가 런타임에 내보내는 OpenAPI도 같은 검증·diff·drift 도구로 관리합니다. | `oa-gen collect`는 원본 문서를 그대로 두고 정규화본과 OpenAPI 3.2 분석본을 따로 씁니다(`--profile nestjs-swagger`, `fastapi`). 수집한 문서는 그 서비스의 계약으로 따로 관리하며 TypeSpec 원본과 합치지 않습니다. `oa-gen scaffold-governance`는 서비스별 수집·검사 스크립트를 만들고, Drizzle 테이블은 `oa-gen generate:drizzle`로 OpenAPI 컴포넌트를 만들어 기존 스펙에 병합합니다(`--merge-into`). [NestJS Swagger / FastAPI Governance](./use-cases/nestjs-swagger-governance.md) |
| 같은 parser로 해석 | 타입·Zod 스키마 생성, 클라이언트·핸들러 계약 생성, mock 서버가 같은 route 목록과 `$ref` 해석을 씁니다. OpenAPI 3.2 문법(`additionalOperations`, `querystring` 파라미터, 스트리밍 응답의 `itemSchema`)도 읽습니다. | `@oa-sdk/parser`가 파싱, `$ref` 해석, 린트, 검증을 맡습니다. `oa-gen validate --require-32`는 구조·참조·린트 오류가 있거나 문서가 OpenAPI 3.2.x가 아니면 실패합니다. 남은 차이도 있습니다. `$ref` 옆에 `summary`·`description` 외의 필드를 적은 경우, 응답 헤더나 media type 안의 `$ref`, 다른 파일을 가리키는 operation 수준 `$ref`에서는 생성된 타입과 클라이언트가 다를 수 있습니다([parser CHANGELOG 0.4.0](../../packages/parser/CHANGELOG.md)). [OpenAPI 3.2 계약 관리](./openapi32-contract-management.md) |
| 계약에서 소비자 코드까지 | CLI 하나로 TypeScript 타입, Zod 4 스키마, 런타임 라이브러리 없이 동작하는 타입 가드, fetch 클라이언트, TanStack Query v5 키·옵션·훅을 만듭니다. 서버 쪽에는 프레임워크와 무관한 핸들러 인터페이스(`*.contract.ts`)를 만들고, 대상 프레임워크가 정해지면 그 프레임워크용 라우터(`*.router.ts`)도 만듭니다. 생성기는 구현 파일을 쓰지 않으므로 다시 생성해도 구현 코드는 그대로입니다. | `oa-gen`(`@oa-sdk/codegen`)이 명령을 제공하고, 핸들러 계약·클라이언트·mock은 동반 패키지(`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`)가 만듭니다. 설정에서 켠 산출물과 그 산출물 전용 명령(`generate:client`, `generate:tanstack`, `mock`)은 동반 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다. 기본값으로만 켜진 산출물은 경고와 설치 명령을 남기고 건너뜁니다. 라우터 대상(`core.router.target`, 없으면 `specs[].target`, 그다음 `product.framework`)이 Fastify·Express·Hono·Elysia이면 `oa-gen generate`가 `<id>.router.ts`도 쓰고, 빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter()`로 직접 만들 때는 `core.router.target: 'generic'`으로 끕니다([선언적 스펙 설정 2.2절](./declarative-spec-configuration.md#22-서버-쪽-생성물의-범위)). [동반 패키지](./cli-setup.md#동반-패키지-companion-packages) |
| 프로그래머블 빌더 플랫폼 | TypeSpec 단일 정본에서 디스크 I/O 없이 openapi-ts 스타일 클라이언트, TanStack Query, 멀티 타깃 코드를 프로그래머블하게 생성하고 Vite HMR과 연동합니다. | `@oa-sdk/codegen`의 `createTspBuilder()` API와 플러그인 파이프라인(`pluginTypeScript`, `pluginClient`, `pluginTanStackQuery`, `pluginRouter`, `pluginWire`)을 제공합니다. `vitePluginTsp`로 개발 루프 내에서 가상 모듈로 즉시 소비하며, 결과물은 openapi-ts 단일 객체 인자 규약 및 `isErrorStatus` 멀티 상태 에러 유니온을 완벽히 지원합니다. [TypeSpec Builder Platform](./typespec-builder-platform.md), [사용성 평가 리포트](../reports/typespec-builder-usability-report.md) |
| 같은 계약으로 mock과 테스트 | 백엔드 구현 전에도 계약대로 응답하고 계약에 맞지 않는 요청은 거절하는 서버로 개발·테스트합니다. | `oa-gen mock`은 `.tsp`나 OpenAPI 문서를 디스크에 산출물을 쓰지 않고 서빙하며, 경로를 생략하면 `oa.config.ts`의 spec target(하나일 때)을 씁니다. `--watch`를 주면 원본이 바뀔 때 서버를 재시작하지 않고 route를 교체합니다. 요청은 파라미터·본문·보안 요구사항으로 검증해 잘못되면 422, 인증 정보가 없으면 401로 답하고, 응답은 문서의 예제나 스키마로 만듭니다. 테스트 코드에서는 `createNodeMockServer`(`@oa-sdk/mock-server/adapters/node-http`)를 씁니다. `msw`는 MSW 어댑터(`@oa-sdk/mock-server/adapters/msw`, `/browser`)를 쓸 때만 설치합니다. [Mock 서버 사용법](./mock-server-usage.md) |
| 변경을 기계가 먼저 분류 | breaking change, 원본과 어긋난 생성물, runtime drift가 리뷰 전에 종료 코드와 PR 리포트로 드러납니다. | `oa-gen diff --fail-on-breaking`은 두 OpenAPI 문서를 endpoint 단위로 비교합니다. 요청·응답·파라미터 스키마가 바뀌면 선택 필드 추가도 breaking으로 판정하는 보수적 규칙입니다. TypeSpec 원본은 `oa-gen tsp diff`가 선택 속성 추가 같은 호환 변경을 non-breaking으로 구분합니다. `oa-gen drift`는 실행 중인 서버가 내보내는 OpenAPI(`--runtime-openapi-url`)를 관리 중인 계약과 비교하고, drift가 있으면 종료 코드 1로 실패합니다. `oa-gen review-bundle`은 breaking diff와 생성물 비교에 drift·inventory·provenance 결과를 더해 PR 리포트 하나로 묶습니다. [OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md) |

공개 패키지 설치는 [Quick Start](./quick-start.md) 0단계를 따릅니다. 각 가치는 다음 명령으로 시작합니다.

```bash
# oa.config.ts와 package.json 스크립트 구성
npx oa-gen init --yes
# 구조·참조·린트 오류가 있거나 OpenAPI 3.2.x가 아니면 실패
npx oa-gen validate --spec ./openapi.yaml --require-32
# oa.config.ts에 선언한 산출물 일괄 생성
npx oa-gen generate
# 생성된 OpenAPI 문서가 원본에서 다시 만든 결과와 다르면 실패
npx oa-gen check-artifact
# 같은 계약으로 mock 서버 구동, 원본이 바뀌면 route 교체
npx oa-gen mock --spec ./openapi.yaml --watch
# 이전 계약 대비 breaking change가 있으면 종료 코드 1
npx oa-gen diff --base ./openapi.base.yaml --head ./openapi.yaml --fail-on-breaking
# 외부 서비스 산출물 수집: 원본 보존, 정규화, 3.2 분석본 생성
npx oa-gen collect --spec ./openapi.raw.yaml --normalized ./openapi.normalized.yaml --upgraded ./openapi.upgraded.yaml --profile nestjs-swagger
```

처음부터 모두 쓸 필요는 없습니다. 기존 OpenAPI 문서에 `oa-gen validate`와 `oa-gen typegen`부터 적용하고, mock 서버와 diff·drift gate는 필요할 때 더합니다.

이 저장소의 production 계약은 `pnpm schema:validate`로 같은 흐름을 확인합니다. `@oa-sdk/schemas`, 변경 이력을 관측하는 `@oa-sdk/spec-lens`, `pnpm schema:*` 명령은 저장소 안에서만 쓰며 npm에 배포하지 않습니다.

### oa-sdk가 하지 않는 것

- 비즈니스 로직과 프레임워크 런타임을 대신하지 않습니다. `oa-gen`이 서버 쪽에 생성하는 것은 핸들러 계약이고, 구현과 서버 구성은 사용자 코드에 남습니다.
- API를 호스팅하지 않습니다. mock 서버는 개발·테스트용이고, 운영 base URL과 인증 메타데이터는 API를 운영하는 쪽이 정합니다([Release Readiness](../internal/release-readiness.md)).
- 서비스 아키텍처의 의도와 API·BFF·UI·DB·ADR 관계는 소유하지 않습니다([Architecture Governance Boundary](../internal/platform-scope.md#architecture-governance-boundary)). DB 물리 스키마와 마이그레이션도 다루지 않으며, Drizzle DB 모델과 API 계약은 서로 다른 원본으로 둡니다([코드젠 워크플로](./use-cases/codegen-workflow.md)).
- 생성물을 손으로 고치는 경로를 두지 않습니다. 생성물이 틀리면 원본을 고치고 다시 생성합니다.

패키지별 범위(Core Platform, Downstream Integration, Maintenance-only)와 신규 기능 승인 기준은 기여자용 [Scope Tiers](../internal/platform-scope.md#scope-tiers)를 따릅니다.

### 누가 무엇을 얻는가

- **API·스펙 설계자**: 고칠 곳이 원본 하나이고, `oa-gen tsp diff`나 `oa-gen diff`로 변경의 영향을 머지 전에 봅니다.
- **데이터 모델러(Non-HTTP)**: HTTP operation 없이 선언한 모델에서 TypeScript 타입(`oa-gen typegen`)과 타입 가드(`oa-gen generate:guards`)를 만듭니다.
- **프론트엔드 엔지니어**: 계약에서 만든 fetch 클라이언트와 TanStack Query 키·옵션·훅을 쓰고, 백엔드 없이 `oa-gen mock`으로 띄운 서버로 개발합니다.
- **백엔드 엔지니어**: 생성된 핸들러 계약과 분리된 파일에 구현하므로 다시 생성해도 구현이 덮어쓰이지 않습니다. 프레임워크 라우터 코드가 필요하면 `@oa-sdk/router`의 `generateRouter()`로 Fastify·Express·Hono·Elysia 중 하나를 대상으로 만듭니다.
- **품질·DevOps 엔지니어**: breaking change(`diff`, `tsp diff`), 원본과 어긋난 생성물(`check-artifact`), runtime drift(`drift`)를 종료 코드로 CI에 걸고, `review-bundle`로 PR 리포트를 남깁니다.
- **외부 서비스(NestJS·FastAPI) 팀**: 런타임이 내보낸 OpenAPI를 `oa-gen collect`와 `oa-gen scaffold-governance`로 같은 검증·diff·drift 흐름에 올립니다.
- **SDK target·integration 엔지니어**: 같은 계약에서 `oa-gen surface`로 Cloudflare Forge용 SDK·CLI 정의와 command별 OpenAPI Overlay를 만듭니다([Cloudflare Forge 지원](./forge-support.md)).

역할별 읽기 경로는 아래 빠른 탐색 나침반을 따릅니다.

---

## 🚀 0. 시작하기 (Getting Started)

다른 프로젝트에서 공개 패키지를 쓰는 경우 다음 순서로 읽습니다.

1. **[Quick Start](./quick-start.md)**: `oa-gen init`부터 검증, 타입·Zod 스키마 생성, TanStack Query, `oa-gen generate`, mock 서버까지 한 프로젝트에서 실행합니다.
2. **[CLI 설치 및 환경 설정](./cli-setup.md)**: Node.js 22 이상, 패키지 매니저별 설치, 동반 패키지(`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`)와 없을 때의 동작.
3. **[CLI 명령 레퍼런스](./cli-command-reference.md)**: `oa-gen` 전체 명령의 목적, 최소 입력, 주요 옵션.
4. **[라이브러리 진입점 지도](./library-entrypoints.md)**: `@oa-sdk/*` 패키지별 배포 상태와 import할 수 있는 entrypoint.
5. **[TypeScript 호환성](./typescript-compatibility.md)**: 공개 패키지 사용자 요구사항과 저장소의 컴파일러 검증 lane.
6. **[프로젝트 온보딩 & 점진적 도입 플레이북](./onboarding-playbook.md)**: 기존·신규 프로젝트에 단계적으로 도입하는 순서와 Fastify·Express·Hono·Elysia·NestJS 연결 레시피.

oa-sdk 저장소 자체에 기여하는 경우는 아래 4절(기여자·메인테이너)을 따릅니다.

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
    • typespec/03, typespec/05                                                    • pure-types-and-guards.md
    • openapi32-contract-management.md                                            • ../benchmarks/validation-engines.md
    • 저장소 TypeSpec 계약 문서: 4절
                                                                               2. 프론트엔드 SDK & TanStack Query v5
 2. 순수 데이터 모델 & DTO 선언 (Non-HTTP)                                         • client-and-query-consumption.md
    • pure-types-and-guards.md                                                    • client-sdk-distribution.md
    • schema-architecture-and-conventions.md (Stage 1)                            • typespec-builder-platform.md

 3. 스펙 거버넌스 & 변경 관리                                                     3. 백엔드 핸들러 계약 (*.contract.ts)
    • basic-spec-usage.md (저장소 스펙 거버넌스)                                  • backend-handler-contracts.md
    • declarative-spec-configuration.md (oa.config.ts)                            • onboarding-playbook.md
    • duplicate-review.md / path-fragment-conventions.md
                                                                               4. Mock 기반 병렬 개발 & 테스트
 4. 프로그래머블 빌더 & 파이프라인                                                • mock-server-usage.md
    • typespec-builder-platform.md                                                • use-cases/mock-testing.md
    • ../reports/typespec-builder-usability-report.md
                                                                                5. Cloudflare Forge SDK/CLI projection
                                                                                   • forge-support.md
                                                                                6. WebMCP 프로젝션 게이트웨이 & P2P 중계
                                                                                   • webmcp-projection-and-relay-guide.md
                                                                                7. 계약 기반 RPC (JSON-RPC · REST · Protobuf)
                                                                                   • typespec-rpc.md
```

| 개발자 역할 | 주요 목적 | 추천 읽기 경로 |
|---|---|---|
| **API / 스펙 설계자** | REST 엔드포인트, 파라미터, 응답 스키마 선언, 프로그래머블 빌더 파이프라인 | [Quick Start](./quick-start.md) $\rightarrow$ [TypeSpec 데코레이터 레퍼런스](./typespec/03-decorators-reference.md) $\rightarrow$ [TypeSpec Builder Platform](./typespec-builder-platform.md) $\rightarrow$ [OpenAPI 3.2 계약 관리](./openapi32-contract-management.md) |
| **데이터 모델러 (Non-HTTP)** | Chrome MV3 메시징, IPC, DB DTO, 이벤트 버스, XState 런타임 타입 선언 | [순수 타입 선언 및 가드 실무 가이드](./pure-types-and-guards.md) $\rightarrow$ [멀티 티어 스키마 및 ttsc·Atlas 가이드](./schema-architecture-and-ttsc-guide.md) $\rightarrow$ [4단계 TypeSpec-First 파이프라인](./schema-architecture-and-conventions.md) |
| **프론트엔드 엔지니어** | 타입 안전한 API 호출, TanStack Query 훅, Mocking, openapi-ts 스타일 클라이언트 | [프론트엔드 SDK 및 쿼리 소비 가이드](./client-and-query-consumption.md) $\rightarrow$ [TypeSpec Builder Platform](./typespec-builder-platform.md) $\rightarrow$ [Mock 서버 활용 가이드](./mock-server-usage.md) $\rightarrow$ [SDK 배포 가이드](./client-sdk-distribution.md) |
| **백엔드 엔지니어** | 비즈니스 로직 작성, 프레임워크 라우터 연결, 멀티 에러 반환 | [백엔드 핸들러 계약 가이드](./backend-handler-contracts.md) $\rightarrow$ [온보딩 플레이북](./onboarding-playbook.md) $\rightarrow$ [코드젠 워크플로](./use-cases/codegen-workflow.md) |
| **품질 / DevOps 엔지니어** | CI breaking change 감지, 제로-eval CSP 보안 감사, 빌드 자동화 | [CLI 명령 레퍼런스](./cli-command-reference.md) $\rightarrow$ [OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md) $\rightarrow$ [선언적 스펙 설정](./declarative-spec-configuration.md) |
| **SDK target/integration 엔지니어** | OpenAPI artifact를 Forge SDK/CLI 표면으로 투영하고 target별 runtime 제한을 검증 | [Cloudflare Forge 지원](./forge-support.md) $\rightarrow$ [CLI 명령 레퍼런스](./cli-command-reference.md) |
| **RPC / 서비스 간 통신 엔지니어** | TypeSpec operation을 typed procedure로 호출·제공, JSON-RPC 2.0 endpoint, Protobuf payload와 `.proto` 공유 | [TypeSpec 계약을 RPC로 쓰기](./typespec-rpc.md) $\rightarrow$ [TypeSpec Builder Platform](./typespec-builder-platform.md) $\rightarrow$ [rpc README](../../packages/rpc/README.md) |
| **Web / 에이전트 통합 엔지니어** | 브라우저 인-페이지 도구를 외부에 투영, WebSocket 릴레이, Cloud Transit 연동 | [WebMCP 프로젝션 가이드](./webmcp-projection-and-relay-guide.md) $\rightarrow$ [WebMCP 개념 아키텍처](../concepts/webmcp-peering-mesh-and-collab.md) |
| **oa-sdk 저장소 기여자** | production TypeSpec 계약, 패키지 소스, 문서 변경 | [기여자 온보딩](./onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩) $\rightarrow$ [TypeSpec 기여 워크플로](./typespec/01-quickstart-5min.md) $\rightarrow$ [기본 스펙 사용 기준](./basic-spec-usage.md) |

---

## ✍️ 1. 선언자 트랙 (Spec & Model Author Track)

스펙과 도메인 모델을 설계하고, 제약 조건을 정의하며, 팀이 함께 고치는 원본을 유지하는 엔지니어를 위한 문서입니다.

### 1.1 HTTP API 및 REST 엔드포인트 선언
다른 프로젝트에서 TypeSpec 및 OpenAPI 3.2로 API 스펙을 선언할 때 읽는 문서입니다. 다른 프로젝트에서는 `.tsp` 파일을 `oa-gen validate`·`typegen`·`generate`·`mock --tsp`에 바로 넘깁니다([Quick Start](./quick-start.md)). 이 저장소의 `packages/schemas` production TypeSpec 계약과 `pnpm schema:*` 명령을 쓰는 작성 문서(스키마 작성 가이드, `typespec/01`·`02`·`04`·`06`, TypeSpec Authoring Conventions, TypeSpec IDE 설정)는 4절(기여자·메인테이너)에 있습니다.
- **[TypeSpec 종합 데코레이터 레퍼런스 및 8대 실전 작성 패턴](./typespec/03-decorators-reference.md)**: 코어 메타데이터, HTTP, OpenAPI, JSON Schema 제약, 다형성/라이프사이클, `@oa-sdk` 확장 데코레이터 및 `.tsp` 작성 패턴.
- **[TypeSpec 트러블슈팅](./typespec/05-troubleshooting.md)**: 컴파일 에러, 순환 참조 해결 가이드. 2절(승인 snapshot drift)은 저장소 기여자용입니다.
- **[OpenAPI 3.2 계약 관리](./openapi32-contract-management.md)**: OAS 3.2 strict validation gate 및 계약 불변식.

### 1.2 순수 데이터 모델 & DTO 선언 (Non-HTTP Use Cases)
HTTP 전송 계층 없이 브라우저 확장프로그램(MV3), Worker IPC, WebSocket, Database DTO용 순수 타입을 선언하는 가이드입니다.
- **[멀티 티어 스키마 아키텍처 및 ttsc·Atlas 역할 분리 가이드](./schema-architecture-and-ttsc-guide.md) (★ 권장)**: Storage(Atlas), Logical ERD(DPM), API(TypeSpec), Behavior(XState v5/v6) 4계층 분리, ttsc AOT Standard Schema v1 변환, Atlas 물리 스키마 연계.
- **[순수 타입 선언 및 제로-런타임 가드 가이드](./pure-types-and-guards.md) (★ 권장)**: HTTP 엔드포인트가 없는 순수 모델 정의 방법(TypeSpec models without ops / Zod Master Schemas), `oa-gen typegen`을 통한 순수 인터페이스 방출, `oa-gen generate:guards`를 통한 제로-eval 타입 가드(`isUser`) 생성.
- **[TypeSpec Behavior / 런타임 데이터 스키마 작성 연구 및 지침](../spec-governance/typespec-behavior-schema-authoring-research.md)**: TypeSpec을 Behavior/FSM의 Data Schema SSOT로 사용하고 Topology/바인딩은 독립 소유하는 Partial adopt 표준 ([TypeSpec 저작 규칙 부록 9](./typespec-authoring-conventions.md#9-부록-behavior-및-런타임-데이터-스키마-작성-지침-partial-adopt) 연계).
- **[스키마 아키텍처 및 작성 규칙](./schema-architecture-and-conventions.md)**: TypeSpec $\rightarrow$ JSON Schema 2020-12 $\rightarrow$ OAS 3.1/3.2 $\rightarrow$ Standalone AJV Type Guards 파이프라인, 비디오 트랜지션 파라미터 표준.
- **[스키마 대수 (Schema Algebra)](./schema-algebra.md)**: 재사용 가능한 복합 모델 합성 및 fold 패턴.
- **[스키마 어노테이션 컨벤션](./schema-annotations.md)**: 작성자 메모, 내부 메타데이터 표기 표준.
- **[TypeSpec 논리 ERD 작성](./typespec-logical-erd-authoring.md)**: 비즈니스 엔터티 간 관계 모델링(비공개 유지보수 패키지 `@oa-sdk/typespec-erd`, 저장소 전용).

### 1.3 스펙 거버넌스 및 변경 관리 (정본 & 롤백 격리)
원본을 보호하고, 기존 소비자를 깨뜨리는 변경(breaking change)을 머지 전에 드러내는 운영 가이드입니다.

#### 1) 정본(Canonical) 거버넌스 파이프라인
- **[기본 스펙 사용 기준](./basic-spec-usage.md)**: 이 저장소의 TypeSpec 스펙 원본과 생성물(Generated Artifacts)의 소유권 경계 및 파이프라인.
- **[선언적 스펙 설정 (oa.config.ts)](./declarative-spec-configuration.md)**: 다중 프로파일(`operation-contract`, `component-bundle`), 라이프사이클 아키타입, 출력 라우팅 설정.
- **[멀티 티어 스키마 및 ttsc·Atlas 역할 분리 가이드](./schema-architecture-and-ttsc-guide.md)**: 4계층(Storage, Logical, API, Behavior) 경계, ttsc AOT Standard Schema, Atlas 물리 DB 연계.
- **로컬 Breaking Diff 및 Schema Drift 검출**: `pnpm check:local-diff` 및 `pnpm check:local-drift`를 통해 CI 실행 전 로컬에서 스키마 브레이킹 변경과 런타임 드리프트를 즉시 감지.
- **[OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md)**: target sidecar와 PR review gate(`oa-gen review-bundle`).
- **[외부 서비스 거버넌스 템플릿](./openapi-governance-service-template.md)**: NestJS, FastAPI 등 런타임 추출 스펙의 거버넌스 파이프라인.

#### 2) 격리된 레거시 & 롤백 참조 (Isolated Legacy / Rollback References)
> [!NOTE]
> 아래 문서는 TypeSpec 도입 이전의 Definition Builder 레거시 YAML 프래그먼트 유지보수 및 롤백 경로 전용 참조 자료입니다. 신규 API 계약에는 사용하지 않습니다.
- **[중복 스펙 검토 (Duplicate Review)](./duplicate-review.md)**: 레거시 프래그먼트 중복 탐지 정책 및 CI 게이트 (롤백 경로 전용).
- **[패스 프래그먼트 컨벤션](./path-fragment-conventions.md)**: 레거시 롤백 경로용 YAML 프래그먼트 파일시스템 계층 규칙 (롤백 경로 전용).

### 1.4 프로그래머블 빌더 플랫폼 (TypeSpec Builder Platform)
TypeSpec(`.tsp`)을 단일 정본(SSOT)으로 삼아 디스크 I/O 없이 인메모리 컴파일, 플러그인 변환, Vite dev loop 실시간 HMR을 연결하는 최신 아키텍처 가이드입니다.
- **[TypeSpec Builder Platform 종합 가이드](./typespec-builder-platform.md) (★ 권장)**:
  - `createTspBuilder` 프로그래머블 빌더 API 및 플러그인 파이프라인(`pluginTypeScript`, `pluginClient`, `pluginTanStackQuery`, `pluginRouter`, `pluginWire`).
  - openapi-ts 스타일 단일 객체 호출 규약(오퍼레이션별 독립 함수 `listUsers({ query })`·`getUserById({ path: { userId } })`, `Client` 인스턴스의 소문자 HTTP 메서드 `client.get({ url: '/users', query })`) 및 `isErrorStatus(res, 404)` 멀티 상태 에러 식별 유니온.
  - Vite HMR 플러그인(`vitePluginTsp`) 및 인메모리 가상 모듈 연동.
- **[TypeSpec Builder 사용성 평가 및 DX 벤치마크 리포트](../reports/typespec-builder-usability-report.md)**:
  - 18개 E2E 실전 시나리오 검증, 콜드 컴파일 95ms / 웜 캐시 0.18ms, Wire 직렬화 73.74% 압축률, DX 종합 만족도 4.92 / 5.0 벤치마크.

### 1.5 생성 타입의 TypeSpec 출처 (Graph Semantic Index)
생성된 TypeScript 선언을 TypeSpec 원본 선언에 연결하는 sidecar를 만들고, 그래프 라우터에서 hash로 stale 여부를 거절하는 가이드입니다.
- **[TypeSpec origin graph semantic index 가이드](./typespec-graph-semantic-index.md)**: `oa-gen typegen --typespec-provenance --graph-semantic-index --graph-file`, provenance/restored OpenAPI의 hash 결속, incremental 재생성 규칙, 실패 진단.

---

## 💻 2. 소비자 트랙 (Type, SDK & Contract Consumer Track)

생성된 스키마 산출물을 가져다 프론트엔드 화면 개발, 백엔드 비즈니스 서비스 구현, E2E 통합 테스트를 진행하는 엔지니어를 위한 문서입니다.

### 2.1 순수 타입 & 제로-런타임 가드 소비
- **[순수 타입 선언 및 제로-런타임 가드 가이드](./pure-types-and-guards.md)**:
  - `oa-gen typegen`으로 생성된 TypeScript 인터페이스 소비.
  - `oa-gen generate:guards`(또는 `oa-gen generate --target standalone-guards`)로 생성된 무의존성 타입 가드(`isUserProfile`)를 이용해 Chrome MV3, Node Worker, Event Bus 메시지 검증.
- **[검증 엔진 성능 벤치마크](../benchmarks/validation-engines.md)**: Zod vs Standalone Type Guards vs Typia AOT 처리량, 지연시간, 번들 크기 비교(측정 환경과 명령 기록 포함).

### 2.2 프론트엔드 SDK 및 TanStack Query v5 소비
- **[프론트엔드 SDK 및 쿼리 소비 가이드](./client-and-query-consumption.md) (★ 권장)**:
  - `@oa-sdk/client` 초기화, 인증 미들웨어(`bearerAuth`, `apiKeyAuth`), 지수 백오프 재시도.
  - 생성된 메서드의 호출 규칙: 위치 인자(`client.getUser({ userId }, { signal })`)와 단일 객체 인자.
  - 쿼리 파라미터 오염 방지 및 `AbortSignal` 취소 연동.
  - `withResponse`를 통한 헤더 및 원본 HTTP Response 접근.
  - TanStack Query v5 3계층(키·옵션·훅) 연동. Vue·Svelte는 keys+options를 생성하고(옵션은 프레임워크 중립 타입), 훅은 React 전용입니다. `--split --tier options|hooks`는 하위 계층을 함께 생성합니다([명령 옵션](./cli-command-reference.md#generatetanstack-옵션-및-인수-명세)).
- **[클라이언트 SDK 배포 가이드](./client-sdk-distribution.md)**:
  - Model A: 로컬 온디맨드 소스 공급 (`devDependencies` + `oa-gen generate:client`)
  - Model B: 독립 사전 빌드 패키지 배포 (`oa-gen generate:client --pack`, 런타임 의존성 0개, `dist/index.js` + `.d.ts`)
- **[TypeSpec Builder Platform 및 openapi-ts 파이프라인](./typespec-builder-platform.md)**:
  - openapi-ts 스타일 단일 객체 인자 규약(독립 함수 `listUsers({ query })`, 또는 `client.get({ url: '/users', query })`처럼 소문자 HTTP 메서드를 가진 `Client` 인스턴스), `isErrorStatus` 멀티 상태 에러 유니온 분기, TanStack Query v5 3계층 통합.
  - 디스크 I/O 없는 인메모리 빌더 및 Vite dev server HMR 연동.
  - 실전 사용성 평가 및 성능 벤치마크: [TypeSpec Builder Usability Report](../reports/typespec-builder-usability-report.md).

### 2.3 백엔드 서비스 및 핸들러 계약 구현
- **[백엔드 핸들러 계약 구현 가이드](./backend-handler-contracts.md) (★ 권장)**:
  - 핸들러 계약(`*.contract.ts`) 구현 방법. 비즈니스 로직 파일은 생성기가 쓰지 않으므로 다시 생성해도 덮어쓰이지 않습니다.
  - 순수 데이터 컨텍스트(`{ params, query, body }`)와 멀티 상태 에러 유니온(`HandlerResponse`).
  - 라우터 코드에 핸들러를 연결하는 방법. 대상 프레임워크가 Fastify·Express·Hono·Elysia이면 `oa-gen generate`가 계약 옆에 라우터(`<id>.router.ts`)도 만들고, 빌드 스크립트에서는 `@oa-sdk/router`의 `generateRouter()`로 직접 만들 수도 있습니다([선언적 스펙 설정 2.2절](./declarative-spec-configuration.md#22-서버-쪽-생성물의-범위)).
- **[프로젝트 온보딩 & 점진적 도입 플레이북](./onboarding-playbook.md)**:
  - 도입 단계(1단계 검증·타입 $\rightarrow$ 2단계 계약 분리 $\rightarrow$ 3단계 CI gate)와 각 단계에서 쓰는 명령.
  - Fastify, Express, Hono, Elysia, NestJS 연결 레시피.
- **[코드젠 워크플로 유스케이스](./use-cases/codegen-workflow.md)**:
  - Drizzle ORM $\rightarrow$ OAS $\rightarrow$ TypeScript $\rightarrow$ 라우터 $\rightarrow$ 클라이언트 파이프라인.

### 2.4 Mock 기반 병렬 개발 및 통합 테스트
- **[Mock 서버 사용법](./mock-server-usage.md)**:
  - `oa-gen mock --watch`: 스키마를 수정하면 서버를 재시작하지 않고 route를 교체하는 인메모리 mock 서버.
  - Node HTTP 어댑터 및 MSW(Mock Service Worker) 브라우저 어댑터 구동(MSW 어댑터만 `msw` 설치 필요).
  - 상태 유지 Mocking: REST 컬렉션 자동 CRUD 및 seed/reset 지원 (`--stateful`).
- **[Mock 테스팅 유스케이스](./use-cases/mock-testing.md)**:
  - 백엔드 개발 완료를 기다리지 않고 프론트엔드/QA 팀이 독립적으로 테스트를 수행하는 패턴.

### 2.5 Cloudflare Forge SDK/CLI projection
- **[Cloudflare Forge 지원](./forge-support.md)**:
  - OpenAPI 3.1 bundle을 Surface IR로 변환하고 Forge SDK group/method와 command catalog를 생성.
  - `x-fern-*`/`x-forge-*` operation projection 및 command별 OpenAPI Overlay 생성.
  - pagination, SSE `itemSchema`, direct/envelope response runtime의 target별 제한 진단.

### 2.6 행위 런타임, 시나리오 FSM 및 멀티 티어 스키마 연동 (XState v6, Spec-Lens, Atlas)
- **[멀티 티어 스키마 및 ttsc·Atlas 역할 분리 가이드](./schema-architecture-and-ttsc-guide.md)**:
  - 4개 티어(Tier 1 API Wire, Tier 2 Physical Storage, Tier 3 Internal Behavior, Tier 4 CRDT)의 명확한 책임 경계와 `ttsc` AOT 컴파일러 트랜스폼 경계 표준.
- **[WIREFRAME-BOOK & XState v6 런타임 연동 가이드](./use-cases/wireframe-xstate-behavior-integration.md)**:
  - `@oa-sdk/typespec-decorators/behavior`로 데이터 형태 정의 $\rightarrow$ `ttsc` AOT 컴파일러 트랜스폼으로 Standard Schema v1 합성 $\rightarrow$ XState v6 `setup({ schemas })` 바인딩 (번들 0KB 증가, Zero-eval CSP).
- **[유저 시나리오 주제 단위 화면 네비게이션 & BEHAVIOR FSM 엔진 가이드](./scenario-navigation-fsm-engine.md)**:
  - Bounded Context 기반 4대 표준 유저 시나리오 정의 (`spec-drift-triage`, `endpoint-exploration`, `breaking-impact-analysis`, `circular-ref-diagnostic`).
  - $O(|V| \times |A|)$ 상태 공간 폭발 방지 및 순수 FSM 리듀서 + 정적 경로 수집기(`ScenarioFlowEnumerator`).
  - Context-Action React 계층(`ScenarioProvider`, `ScenarioProgressHUD`, `ScenarioFlowModal`, `ScenarioSelector`)과 Spec-Lens 대시보드 실전 연동.
- **[시나리오 라이프사이클, 아티팩트 및 프리뷰어 거버넌스 가이드](./scenario-lifecycle-and-artifacts.md)**:
  - 5단계 시나리오 라이프사이클(선언 $\rightarrow$ 정적 컴파일 $\rightarrow$ 런타임 실행 $\rightarrow$ 핸드오프 $\rightarrow$ CI 검증).
  - `spec-lens scenario` CLI(`list`, `inspect`, `preview`, `verify`, `export`), `docs/artifacts/scenarios/` 아티팩트 규격, 듀얼 프리뷰어(터미널 ASCII & 웹 UI) 및 거버넌스 컨벤션.
- **[Ariga Atlas 물리 DB 스키마 드리프트 거버넌스 가이드](./use-cases/atlas-schema-drift-governance.md)**:
  - `@oa-sdk/typespec-decorators/governance`의 `verifyAtlasSchemaDrift(evidence, mappings)`가 `atlas schema inspect --format json` 출력을 읽기 전용 카탈로그 증거로 받아, 호출자가 `@storageRef` 대상을 옮겨 적은 매핑의 테이블·컬럼 누락(오류)과 타입 불일치(경고)를 CI에서 정적으로 탐지 (Zero DB Write).
  - 검증기는 TypeSpec 소스나 `x-oa-sdk-storage-ref`를 읽지 않으며, `@oa-sdk/dpm`과 `oa-erd check`도 Atlas 증거를 읽지 않습니다.
- **[TypeSpec Behavior / 런타임 데이터 스키마 작성 연구 및 PoC](../spec-governance/typespec-behavior-schema-authoring-research.md)**:
  - TypeSpec data shape $\rightarrow$ Draft 2020-12 $\rightarrow$ Standard Schema v1 어댑터 $\rightarrow$ XState v5(`setup.types`) 및 v6(`setup.schemas` / state-level schemas) 검증 (14/14 tests pass, Partial adopt 판정).
- **[공유 컨텍스트 협업 하네스 계약 평가 리포트](../spec-governance/shared-context-harness-contract-evaluation.md)**:
  - `@oa-sdk/tools` 기반 Read-Only 도구 인터페이스(MCP/CLI/REST) 및 fail-closed 보안 경계 검증 (22/22 tests pass).

### 2.7 WebMCP 프로젝션 게이트웨이 및 P2P 중계 연동
- **[WebMCP 프로젝션 게이트웨이 및 P2P 중계 연동 가이드](./webmcp-projection-and-relay-guide.md) (★ 권장)**:
  - 브라우저 인-페이지 런타임(Wireframe/Storyboard 툴킷, 캔버스 에디터 등)의 도구와 상태를 외부 AI 에이전트에 노출하는 3계층 프로젝션 토폴로지.
  - `createPeerServer({ enableRelay: true, enableCloudTransit: true })`를 통한 단 15줄 로컬 게이트웨이 데몬 구동.
  - `P2pTransportChannel` + `createWebSocketTransportAdapter` 기반 브라우저 Page Connector 구현 (도구 포트 개설).
  - `createCloudTransitClient` 및 `@oa-sdk/mcp-mesh`(`SkillRegistry#hydratePeerSession`)를 통한 투명한 브라우저 도구 원격 호출 및 오케스트레이션.
  - 새로고침(F5) 시 3채널 메모리 버퍼링 및 우선순위 플러시(`mcp-jsonrpc` > `crdt-delta` > `presence`), 48-hex 단일 사용 티켓 및 32-프레임 플러딩 차단 등 보안 강화.

### 2.8 계약 기반 RPC (JSON-RPC 2.0 · REST binding · Protobuf)
- **[TypeSpec 계약을 RPC로 쓰기](./typespec-rpc.md)**:
  - `pluginRpc`로 procedure 타입과 contract를 생성하고, `@oa-sdk/rpc`의 한 handler 집합으로 JSON-RPC 2.0과 원래 REST route를 함께 제공.
  - `createHttpTransport` / `createJsonRpcTransport` 클라이언트, `handleJsonRpc`로 메시지 채널 연동, `RpcError` 오류 모델.
  - `pluginWire`의 Protobuf codec과 `<Service>RpcClient`: 생성된 `.proto`와 wire 호환(protobufjs 양방향 검증), JSON Schema ↔ Protobuf 매핑, 크기 비교와 한계.

---


## 🔧 3. 저장소 안에서 실행하는 데모 (Repository Demos)

아래 데모는 oa-sdk 저장소를 clone하고 빌드한 뒤 저장소 루트에서 실행합니다. 각 데모의 내용은 [실행 데모 가이드](../examples/README.md)에 있습니다.

- `pnpm --filter @oa-sdk/playground run demo`: OpenAPI 3.2 파싱과 mock 서버 풀 파이프라인.
- `pnpm --filter @oa-sdk/playground run demo:patterns`: 다형성 비디오 트랜지션, `@visibility` CRUD 분기 투영, RFC 9457 에러 패턴.
- `pnpm --filter @oa-sdk/playground run demo:guards`: Chrome Extension Manifest V3 CSP(eval 차단) 환경의 독립형 가드와 Worker IPC 검증.
- `pnpm --filter @oa-sdk/playground run demo:router`: 프레임워크와 무관한 `*.contract.ts` 핸들러 계약 패턴과 Hono 라우터 마운트.
- `pnpm --filter @oa-sdk/playground run demo:soc`: 순환 참조 문서에서 parser 진단과 downstream fail-closed 동작.
- `pnpm --filter @oa-sdk/playground run demo:client`: `@oa-sdk/client` fetch 클라이언트와 TanStack Query 3계층 생성.
- `pnpm --filter @oa-sdk/playground run demo:mock`: mock 서버 route 교체(`updateSpec`), 응답 override, stateful 컬렉션.
- `pnpm --filter @oa-sdk/playground run demo:all`: 위 7개 데모를 순서대로 실행.

---

## 🛠️ 4. 기여자·메인테이너 (Contributors & Maintainers)

oa-sdk 저장소 자체의 패키지 소스, production TypeSpec 계약, 문서를 바꾸는 기여자와 릴리스를 준비하는 메인테이너를 위한 문서입니다. 저장소 루트에서는 `oa-gen`이 PATH에 없으므로 `pnpm --filter @oa-sdk/codegen build` 후 `node packages/codegen/dist/cli/index.js <명령>`으로 실행합니다.

- **[기여자 온보딩](./onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩)**: Node 24/26 듀얼 레인, 정본 결정 매트릭스, TypeSpec 계약 변경·승인 워크플로, 완료 게이트.
- **[TypeSpec 기여 워크플로](./typespec/01-quickstart-5min.md)**와 **[TypeSpec 스캐폴딩 및 Diff](./typespec/04-scaffolding-and-diff.md)**: `packages/schemas`의 production 계약 수정과 승인 snapshot.
- **[스키마 작성 가이드 (Schema Authoring)](./schema-authoring.md)**: `packages/schemas/typespec/main.tsp`에 도메인 모델, 오퍼레이션, 파라미터, OAS 3.2 신규 문법(`dataValue`, `itemSchema`, `defaultMapping`)을 작성하고 `pnpm schema:*`로 검증하는 흐름.
- **[TypeSpec 작성 컨벤션](./typespec/02-authoring-conventions.md)**과 **[TypeSpec Authoring Conventions](./typespec-authoring-conventions.md)**: `packages/schemas/typespec/`의 모듈 분할, 네임스페이스, literal union, alias 표준과 production TypeSpec source, 승인 snapshot, extension ownership.
- **[TypeSpec 아티팩트 생성 토폴로지 및 아키텍처 규칙](./typespec/06-generation-topologies-and-rules.md)**: Co-located(피처 인접), FSD, Monorepo 생성 토폴로지와 아키텍처 규칙.
- **[TypeSpec IDE 설정 가이드](./typespec-ide-setup.md)**: 저장소에 포함된 VSCode/Cursor 권장 설정, LSP, 코드 조각(Snippets).
- **[기본 스펙 사용 기준](./basic-spec-usage.md)**: 저장소 스펙 원본, 승인 snapshot, 생성물의 소유권 경계.
- **[패키지 릴리즈 준비 가이드](./release-preparation.md)**: 메인테이너용 artifact 전용 패키지 릴리즈 절차.
- **[OIDC Trusted Publishing 설정 및 업데이트 가이드](./oidc-trusted-publishing.md)**: npm trusted publisher 최초 설정, E409/E403 대응, repository·workflow·environment 변경 시 trust 관계 갱신, OIDC publish 검증과 token 은퇴 절차.
