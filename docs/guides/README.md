# oa-sdk 가이드 색인 및 아키텍처 지도 (Guide Directory & Architecture Map)

이 문서는 엔지니어의 역할과 목적에 따라 가장 적합한 문서를 빠르게 찾을 수 있도록 **시작하기**, **선언자 트랙(Author Track)**, **소비자 트랙(Consumer Track)**, **기여자·메인테이너** 경로로 나눈 가이드 탐색 지도를 제공합니다. 다른 프로젝트에서 공개 패키지를 쓰는 흐름과 oa-sdk 저장소 자체에 기여하는 흐름은 서로 다른 문서를 따릅니다.

---

## oa-sdk가 해결하는 문제와 핵심 가치

oa-sdk는 API 계약(API가 받는 요청과 돌려주는 응답의 약속)을 관리하는 도구 모음입니다. 사람이 고치는 원본을 하나로 정하고, 그 원본에서 만드는 OpenAPI 문서, TypeScript 타입, 클라이언트, 핸들러 계약을 언제든 다시 만들 수 있는 생성물로 다룹니다. mock 서버도 같은 원본을 읽어 띄웁니다. 이 절은 사용자 관점의 요약이며, 제품 범위의 정본은 [Platform Scope](../internal/platform-scope.md#core-mission)입니다.

이 절의 동작은 `@oa-sdk/codegen` 0.9.0 기준입니다. 공개 패키지는 Node.js 22 이상에서 동작합니다. `@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, `@oa-sdk/surface-ir`는 `@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포되므로, 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은 [변경 이력](../changelog.md)에서 확인합니다.

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
| 계약에서 소비자 코드까지 | CLI 하나로 TypeScript 타입, Zod 4 스키마, 런타임 라이브러리 없이 동작하는 타입 가드, fetch 클라이언트, TanStack Query v5 키·옵션·훅을 만듭니다. 서버 쪽에는 프레임워크와 무관한 핸들러 인터페이스(`*.contract.ts`)를 만듭니다. 생성기는 구현 파일을 쓰지 않으므로 다시 생성해도 구현 코드는 그대로입니다. | `oa-gen`(`@oa-sdk/codegen`)이 명령을 제공하고, 핸들러 계약·클라이언트·mock은 동반 패키지(`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`)가 만듭니다. 설정에서 켠 산출물과 그 산출물 전용 명령(`generate:client`, `generate:tanstack`, `mock`)은 동반 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다. 기본값으로만 켜진 산출물은 경고와 설치 명령을 남기고 건너뜁니다. Fastify·Express·Hono·Elysia 라우터 코드가 필요하면 빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter()`를 호출합니다. `oa-gen` 명령은 라우터 파일을 만들지 않습니다. [동반 패키지](./cli-setup.md#동반-패키지-companion-packages) |
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
    • schema-architecture-and-conventions.md (Stage 1)
                                                                               3. 백엔드 핸들러 계약 (*.contract.ts)
 3. 스펙 거버넌스 & 변경 관리                                                     • backend-handler-contracts.md
    • basic-spec-usage.md (저장소 스펙 거버넌스)                                  • onboarding-playbook.md
    • declarative-spec-configuration.md (oa.config.ts)
    • duplicate-review.md / path-fragment-conventions.md                       4. Mock 기반 병렬 개발 & 테스트
                                                                                  • mock-server-usage.md
                                                                                  • use-cases/mock-testing.md
                                                                               5. Cloudflare Forge SDK/CLI projection
                                                                                  • forge-support.md
```

| 개발자 역할 | 주요 목적 | 추천 읽기 경로 |
|---|---|---|
| **API / 스펙 설계자** | REST 엔드포인트, 파라미터, 응답 스키마 선언 | [Quick Start](./quick-start.md) $\rightarrow$ [TypeSpec 데코레이터 레퍼런스](./typespec/03-decorators-reference.md) $\rightarrow$ [OpenAPI 3.2 계약 관리](./openapi32-contract-management.md) |
| **데이터 모델러 (Non-HTTP)** | Chrome MV3 메시징, IPC, DB DTO, 이벤트 버스 타입 선언 | [순수 타입 선언 및 가드 실무 가이드](./pure-types-and-guards.md) $\rightarrow$ [4단계 TypeSpec-First 파이프라인](./schema-architecture-and-conventions.md) |
| **프론트엔드 엔지니어** | 타입 안전한 API 호출, TanStack Query 훅, Mocking | [프론트엔드 SDK 및 쿼리 소비 가이드](./client-and-query-consumption.md) $\rightarrow$ [Mock 서버 활용 가이드](./mock-server-usage.md) $\rightarrow$ [SDK 배포 가이드](./client-sdk-distribution.md) |
| **백엔드 엔지니어** | 비즈니스 로직 작성, 프레임워크 라우터 연결, 멀티 에러 반환 | [백엔드 핸들러 계약 가이드](./backend-handler-contracts.md) $\rightarrow$ [온보딩 플레이북](./onboarding-playbook.md) $\rightarrow$ [코드젠 워크플로](./use-cases/codegen-workflow.md) |
| **품질 / DevOps 엔지니어** | CI breaking change 감지, 제로-eval CSP 보안 감사, 빌드 자동화 | [CLI 명령 레퍼런스](./cli-command-reference.md) $\rightarrow$ [OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md) $\rightarrow$ [선언적 스펙 설정](./declarative-spec-configuration.md) |
| **SDK target/integration 엔지니어** | OpenAPI artifact를 Forge SDK/CLI 표면으로 투영하고 target별 runtime 제한을 검증 | [Cloudflare Forge 지원](./forge-support.md) $\rightarrow$ [CLI 명령 레퍼런스](./cli-command-reference.md) |
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
- **[순수 타입 선언 및 제로-런타임 가드 가이드](./pure-types-and-guards.md) (★ 권장)**: HTTP 엔드포인트가 없는 순수 모델 정의 방법(TypeSpec models without ops / Zod Master Schemas), `oa-gen typegen`을 통한 순수 인터페이스 방출, `oa-gen generate:guards`를 통한 제로-eval 타입 가드(`isUser`) 생성.
- **[스키마 아키텍처 및 작성 규칙](./schema-architecture-and-conventions.md)**: TypeSpec $\rightarrow$ JSON Schema 2020-12 $\rightarrow$ OAS 3.1/3.2 $\rightarrow$ Standalone AJV Type Guards 파이프라인, 비디오 트랜지션 파라미터 표준.
- **[스키마 대수 (Schema Algebra)](./schema-algebra.md)**: 재사용 가능한 복합 모델 합성 및 fold 패턴.
- **[스키마 어노테이션 컨벤션](./schema-annotations.md)**: 작성자 메모, 내부 메타데이터 표기 표준.
- **[TypeSpec 논리 ERD 작성](./typespec-logical-erd-authoring.md)**: 비즈니스 엔터티 간 관계 모델링(비공개 유지보수 패키지 `@oa-sdk/typespec-erd`, 저장소 전용).

### 1.3 스펙 거버넌스 및 변경 관리
원본을 보호하고, 기존 소비자를 깨뜨리는 변경(breaking change)을 머지 전에 드러내는 운영 가이드입니다.
- **[기본 스펙 사용 기준](./basic-spec-usage.md)**: 이 저장소의 스펙 원본과 생성물(Generated Artifacts)의 소유권 경계 및 파이프라인.
- **[선언적 스펙 설정 (oa.config.ts)](./declarative-spec-configuration.md)**: 다중 프로파일(`operation-contract`, `component-bundle`), 라이프사이클 아키타입, 출력 라우팅 설정.
- **[OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md)**: target sidecar와 PR review gate(`oa-gen review-bundle`).
- **[중복 스펙 검토 (Duplicate Review)](./duplicate-review.md)**: 프래그먼트 중복 탐지 정책 및 CI 게이트.
- **[패스 프래그먼트 컨벤션](./path-fragment-conventions.md)**: 레거시 롤백 경로용 YAML 프래그먼트 파일시스템 계층 규칙.
- **[외부 서비스 거버넌스 템플릿](./openapi-governance-service-template.md)**: NestJS, FastAPI 등 런타임 추출 스펙의 거버넌스 파이프라인.

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
  - TanStack Query v5 3계층(키·옵션·훅) React 연동. Vue·Svelte 출력(`--framework vue|svelte`)과 `--tier options|hooks` 단독 출력은 현재 컴파일되지 않습니다([알려진 제한](./cli-command-reference.md#generatetanstack-옵션-및-인수-명세)).
- **[클라이언트 SDK 배포 가이드](./client-sdk-distribution.md)**:
  - Model A: 로컬 온디맨드 소스 공급 (`devDependencies` + `oa-gen generate:client`)
  - Model B: 독립 사전 빌드 패키지 배포 (`oa-gen generate:client --pack`, 런타임 의존성 0개, `dist/index.js` + `.d.ts`)

### 2.3 백엔드 서비스 및 핸들러 계약 구현
- **[백엔드 핸들러 계약 구현 가이드](./backend-handler-contracts.md) (★ 권장)**:
  - 핸들러 계약(`*.contract.ts`) 구현 방법. 비즈니스 로직 파일은 생성기가 쓰지 않으므로 다시 생성해도 덮어쓰이지 않습니다.
  - 순수 데이터 컨텍스트(`{ params, query, body }`)와 멀티 상태 에러 유니온(`HandlerResponse`).
  - `@oa-sdk/router`의 `generateRouter()`로 만든 Fastify·Express·Hono·Elysia 라우터 코드에 핸들러를 연결하는 방법(`oa-gen` 명령은 라우터 파일을 만들지 않습니다).
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
