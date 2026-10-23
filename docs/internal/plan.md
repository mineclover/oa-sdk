# Plan — 구현 로드맵

> 목표와 단계별 방향을 기술합니다.
> 핵심 철학과 주 목표는 [Vision](../vision.md)을 참조하세요.
> 실제 구현 현황은 [spec.md](./spec.md), 즉시 태스크는 [todo.md](./todo.md)를 참조하세요.
> artifact release의 판단 입력과 책임 경계는 [release-readiness.md](./release-readiness.md)를
> 기준으로 한다.

---

## 시스템 목표

OpenAPI contract를 중심으로 OpenAPI/JSON Schema 호환 입력 수집, modular
schema/definition composition, metadata/path surface management, validation, code
generation, mock/runtime testing, diff/drift/freshness review를 연결한다. 시스템 루프는
[Vision](../vision.md#system-loop)을 따른다.

---

## 제품 로드맵 — Core Platform 안정화 및 실효성 중심 구현 단계

Status: active

현재 제품 투자는 [Platform Scope](./platform-scope.md)의 Core Platform(9개 패키지)에 집중하며, 배포 아티팩트의 실사용성(Viability), 엔터프라이즈 거버넌스, 개발자 경험(DX)을 극대화하는 4단계 실효성 로드맵을 운영한다.

### 마일스톤 및 호라이즌 개요

| 단계 (Phase) | 목표 및 핵심 마일스톤 | 완료 증거 | 상태 |
| :--- | :--- | :--- | :---: |
| **Phase 1: 코어 플랫폼 및 2계층 격리 배포 완비** | OAS 3.2 Zod 4 생성기, AST 양방향 동기화, Samchon 5대 개선, 2계층 격리 릴리스 파이프라인 및 Sigstore SLSA Provenance npm 배포 | `2026-09-11-core-release` 배포 완료, 6종 패키지 npm 라이브, 소비자 스모크 테스트 100% 통과 | **완료 (Done)** |
| **Phase 2: 개발자 경험(DX) 및 마찰 제로 온보딩** | `oa-gen init` 타깃 분리형 온보딩 CLI, 엄격 런타임 격리(Bun vs Node), 산출물 경로 라우팅 커스터마이징(`outputRouting`), `.ts` 소스 변경 실시간 반영 `oa-gen mock --watch` 핫 리로드, 전용 에이전트 스킬 `oa-onboarding` 및 3계층 온보딩 플레이북 | `oa-gen init` 6대 프로필(Fastify, Elysia, Hono, Express, NestJS, Generic), 스키마 디텍터, 패키지 패처, `outputRouting` 경로/임포트/고아정리 엔진, `mock --watch` 다중 포맷 핫 스왑 테스트 통과, `onboarding-playbook.md` 및 `oa-onboarding` 스킬 완비 | **완료 (Done)** |
| **Phase 3: 엔터프라이즈 CI/CD 및 드리프트 자동 방어** | PR 단위 Breaking Change 자동 차단 봇, 프로덕션 런타임 드리프트(`oa-gen drift`) 크론 모니터링 및 알림, 멀티 서비스 원격 스키마 연합(Federation) | GitHub Actions PR 코멘트 봇, Slack/Webhook 드리프트 알림 어댑터, 교차 서비스 `$ref` 번들러 | **계획 (Planned)** |
| **Phase 4: 풀스택 클라이언트/서버 런타임 확장** | TanStack Query v5 3계층(Keys/Options/Hooks) 생성기(`@oa-sdk/client`, `oa-gen generate:tanstack`), 다중 프레임워크 라우터 스텁 및 순수 핸들러 계약 분리(`@oa-sdk/router`), `JsonPrimitive<T>` Zero-copy 직렬화 가속 | 생성된 훅의 React 19 컴파일 및 SSR 테스트, TanStack Query v5 3계층 아키텍처 검증, Fastify/Elysia/Hono/Express 라우터 및 핸들러 계약 E2E 패리티 테스트 통과 | **완료 (Done)** |

### 단계별 상세 구현 명세 (Practical Viability Specifications)

#### 1. Phase 1: 코어 플랫폼 및 2계층 격리 배포 완비 (완료 ✅)
- **OAS 3.2 $\leftrightarrow$ Zod 4 파이프라인**: Draft 2020-12 어휘(수치 한계, `prefixItems`, `discriminator`, `z.lazy()` 순환참조) 지원 및 사전 검증/정규화 파이프라인 완비.
- **Samchon 5대 코어 개선**: 24종 구문 특성 분류기(`audit:shape`), `JsonPrimitive<T>` 와이어 타입, `@oaOperation` JSDoc 라우트 추출, TypeChecker 심볼 ID 순환 참조 DFS 탐지, transitive tsconfig universe 캐시 무효화.
- **2계층 격리 릴리스 파이프라인**: 9대 사전 검증 관문(`release:preflight`) $\rightarrow$ 무결성 아티팩트 익스포터(`release:export`) $\rightarrow$ 배포 전용 리포지토리(`oa-sdk-releases`) $\rightarrow$ Sigstore SLSA v1 Provenance 연동 공용 npm 레지스트리 배포 완료.

#### 2. Phase 2: 개발자 경험(DX) 및 마찰 제로 온보딩 (완료 ✅)
- **`oa-gen init` 타깃 분리형 대화형/비대화형 온보딩 엔진**:
  - 기존 프로젝트(Fastify, Elysia, Hono, Express, NestJS, Generic)에 진입하여 프레임워크와 스키마 위치를 자동 감지하고 `oa.config.ts` 및 최적화된 거버넌스 스크립트 1클릭 주입.
  - **Strategy Pattern 기반 6대 타깃 프로필**: 각 프레임워크에 특화된 설정 및 스크립트 도출 (`packages/codegen/src/cli/lib/init/targets/`).
  - **엄격한 런타임 격리 (Strict Runtime Isolation)**: Bun/Elysia 프로젝트는 순수 Bun 스크립트(`bun --watch`, `bun x oa-gen`)와 `@types/bun` devDependency만 주입하여 Node 도구(`tsx`, `nodemon`, `@types/node`) 오염을 원천 방지; Node/Fastify 프로젝트는 Node ESM(`tsx watch`) 기반 구성.
  - **재귀적 스키마 감지기 (`common/schema-detector.ts`)**: 디렉토리 트리를 순회하여 `.tsp`, `openapi.yaml`, `openapi.json`, `@oaOperation` JSDoc 소스를 신뢰도 점수 기반으로 자동 식별.
  - **비파괴적 패키지 패처 (`common/package-patcher.ts`)**: 공백/탭 들여쓰기, CRLF/LF 개행, 기존 스크립트 보존 및 충돌 방어(`--force` 제어)가 완비된 안전한 `package.json` 병합.
- **실시간 소스 관측 Mock Server (`oa-gen mock --watch`)**:
  - `spec-watcher.ts`를 통해 TypeSpec(`.tsp`), OpenAPI(`.yaml`, `.json`), `@oaOperation` JSDoc(`.ts`) 파일을 100ms 디바운스로 실시간 관측.
  - 파일 수정 시 인메모리 재컴파일 후 `@oa-sdk/mock-server`의 원자적 `server.updateSpec(newDoc)` 라우트 스왑을 호출하여 소켓 단절이나 프로세스 재시작 없이 즉각 핫 스왑.
  - 문법 오류 발생 시 에러 쉴딩(Error Shielding)을 통해 기존 정상 라우트를 유지하여 클라이언트 중단 방지.
- **프로젝트 온보딩 플레이북 및 전용 에이전트 스킬**:
  - `docs/guides/onboarding-playbook.md`: Greenfield/Brownfield 3계층 점진적 가치 도입 사다리 및 5대 무가치 관리 포인트 제거 가이드.
  - `.agents/skills/oa-onboarding/SKILL.md`: Antigravity/AGY 규격을 준수하는 권위 있는 에이전트 온보딩 지침.
- **산출물 경로 라우팅 커스터마이징 엔진 (`outputRouting`)**:
  - `oa.config.ts`의 `outputRouting` 설정을 통해 생성 산출물의 디렉토리 레이아웃을 패턴(`{tag}`, `{kind}`, `{operationId}` 등) 및 규칙 기반으로 완벽히 제어 (`packages/codegen/src/routing/`).
  - 서로 다른 폴더로 분산 방출되는 산출물 간의 상대 import 경로(`path.relative`) 및 `tsconfig.json` path alias 자동 계산.
  - `.oa-manifest.json` 기반의 3단계 안전 고아 파일 정리(`pruneOrphans: true`)를 지원하여 수동 작성 코드를 손상시키지 않고 이전 산출물만 안전하게 제거.
- **VS Code / TypeScript LSP 인라인 진단**:
  - `audit:shape`를 LSP/TypeScript 플러그인과 결합하여 OpenAPI로 투영 불가능한 `unsupported` 타입(조건부/맵드 타입) 선언 시 에디터 상에서 실시간 밑줄 경고 표시.
  - `/** @oaOperation <METHOD> <PATH> */` JSDoc 태그의 자동완성 및 유효 경로 문법 실시간 검사.

#### 3. Phase 3: 엔터프라이즈 CI/CD 및 드리프트 자동 방어 (계획 ⏳)
- **Pull Request Breaking Change 가드 봇**:
  - PR 생성/업데이트 시 CI 워크플로우에서 `oa-gen diff --fail-on-breaking`을 자동 수행하고, 스펙 변경 내역과 하위 호환성 위험도를 PR 마크다운 코멘트로 자동 게시.
- **운영 서버 스펙 일치 여부 정기 검사 (`oa-gen drift`)**:
  - 이미 운영(Production)에 배포된 서버의 라이브 엔드포인트(`--runtime-openapi-url`)를 주기적으로 호출하여, 개발자가 로컬에서 수정한 스펙과 실제 배포된 서버 사이에 스키마 괴리(Drift)가 생기지 않았는지 대조하고 불일치 시 알림.
- **멀티 서비스 스키마 연합 (Federation & Contract Registry)**:
  - 대규모 마이크로서비스 아키텍처 환경에서 여러 서비스의 OpenAPI 조각을 안정적으로 교차 참조(`$ref`)하고 통합 번들링하는 원격 레지스트리 캐시 레이어 구현.

#### 4. Phase 4: 고성능 백엔드 라우터 스텁 및 풀스택 런타임 확장 (완료 ✅)

> **완료 안내**: 다중 프레임워크 라우터 스텁(Fastify JIT 스키마 인라인 가속, Bun Elysia Zero-copy 구조분해, 현대화된 Hono 및 Express)과 순수 핸들러 계약 분리(`generateHandlerContract`)가 `@oa-sdk/router`에 구현 완료되었으며, TanStack Query v5 3계층 생성기(Key Factory, Options Factory, Hook Factory)가 `@oa-sdk/client` 및 `oa-gen generate:tanstack`에 완비되어 풀스택 클라이언트/서버 런타임 확장이 완료되었습니다.

백엔드 엔지니어가 OpenAPI 스펙을 기반으로 서버를 구축할 때, 보일러플레이트 없이 비즈니스 로직에만 집중할 수 있도록 **다중 프레임워크 지원 라우터 스텁 생성기 (`@oa-sdk/router`)**를 대폭 고도화한다.

##### 4.1 핵심 아키텍처: 핸들러 계약 분리 패턴 (Handler Contract Separation)
*   **문제점**: 라우터 파일에 비즈니스 로직을 인라인으로 작성하면, OpenAPI 스펙이 변경되어 코드를 재생성할 때 개발자의 구현 코드가 덮어씌워지는(Overwrite) 치명적인 충돌 발생.
*   **해결책**: 순수 비즈니스 로직 인터페이스(`routes.contract.ts`)와 프레임워크별 라우팅 바인더(`routes.<framework>.ts`)를 물리적으로 분리 방출.
    1. `routes.contract.ts`: 순수 TypeScript로 작성된 핸들러 시그니처 (프레임워크 무관).
       ```typescript
       export interface UsersApiHandlers {
         getUserById(params: { id: string }, query: GetUserQuery): Promise<UserResponse>;
         createUser(body: CreateUserBody): Promise<UserResponse>;
       }
       ```
    2. 개발자는 위 인터페이스를 만족하는 Service/Controller 클래스만 작성.
    3. 프레임워크 라우터 팩토리에 해당 서비스를 주입하여 1줄로 라우트 바인딩 완료.

##### 4.2 타깃 프레임워크별 상세 설계

| 타깃 | 런타임 환경 | 라우터 구조 및 특징 | 핵심 가치 |
| :--- | :--- | :--- | :--- |
| **`hono`** (기본) | Cloudflare Workers, Node, Bun, Deno | `const app = new Hono()` 및 Web Fetch 표준 기반 | 에지(Edge) 및 서버리스 최적화 |
| **`express`** | Node.js | `const router = Router()` 및 Express 미들웨어 호환 | 레거시 및 기존 Express 프로젝트 연동 |
| **`fastify`** (신규) | Node.js | `FastifyPluginAsync` 플러그인 모듈 및 JSON Schema 인라인화 | Node.js 최고 수준 처리량 및 `fast-json-stringify` 직렬화 가속 |
| **`elysia`** (신규) | Bun | `new Elysia().get().post()` 메서드 체이닝 및 구조분해 컨텍스트 | Bun 네이티브 C++ 엔진 성능 극대화 및 간결한 DX |

##### 4.3 Fastify 라우터 스텁 상세 설계 (`target: 'fastify'`)
*   **Fastify 플러그인 표준 준수**: `FastifyPluginAsync` 시그니처로 방출하여 프리픽스(`/api/v1`) 및 글로벌 인증 훅(`preHandler`)과 자연스럽게 결합.
*   **`fast-json-stringify` 직렬화 가속 활성화**: OpenAPI 3.2 Schema Object를 Fastify의 라우트 옵션 `schema: { params, querystring, body, response }`로 인라인 주입. Fastify 내부 컴파일러가 이를 바탕으로 일반 `JSON.stringify()` 대비 2~3배 빠른 고속 직렬화 코드 자동 생성.
*   **생성 코드 구조 예시**:
    ```typescript
    import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
    import type { UsersApiHandlers } from './users.contract.js';

    export function createUsersFastifyPlugin(handlers: UsersApiHandlers): FastifyPluginAsync {
      return async (fastify) => {
        fastify.get('/users/:id', {
          schema: {
            params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
            response: { 200: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } }
          }
        }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
          const result = await handlers.getUserById(request.params, request.query as any);
          return reply.code(200).send(result);
        });
      };
    }
    ```

##### 4.4 Bun Elysia 라우터 스텁 상세 설계 (`target: 'elysia'`)
*   **Bun 네이티브 고속 구조분해 컨텍스트**: Bun 런타임의 Zero-copy 메모리 구조에 맞추어 `{ params, query, body, set }` 형태의 객체 구조분해 파라미터 매핑.
*   **Elysia 메서드 체이닝 패턴**: 가독성이 높고 번들 크기가 작은 Elysia 특유의 빌더 패턴 방출.
*   **생성 코드 구조 예시**:
    ```typescript
    import { Elysia } from 'elysia';
    import type { UsersApiHandlers } from './users.contract.js';

    export function createUsersElysiaRouter(handlers: UsersApiHandlers) {
      return new Elysia({ prefix: '/users' })
        .get('/:id', async ({ params, query, set }) => {
          const result = await handlers.getUserById(params as { id: string }, query as any);
          set.status = 200;
          return result;
        })
        .post('/', async ({ body, set }) => {
          const result = await handlers.createUser(body as any);
          set.status = 201;
          return result;
        });
    }
    ```

##### 4.5 CLI 및 프로그래밍 방식 연동
*   `@oa-sdk/router`의 `generateRouter` 및 `generateHandlerContract` API를 통해 프레임워크 라우터 바인더와 순수 핸들러 계약을 원클릭으로 생성합니다.
*   `oa-gen init`은 프레임워크 대상에도 `generate` 스크립트(`oa-gen generate`)를 `package.json`에 비파괴적으로 등록합니다. `oa-gen generate`는 라우터 바인더를 만들지 않으므로, 라우터 코드는 빌드 스크립트에서 `generateRouter()`로 생성합니다(CLI 바인더 생성은 하지 않기로 결정, 2026-10-06).

##### 4.6 TanStack Query (React Query) v5 3계층 코드 생성기 (`oa-gen generate:tanstack`) (완료 ✅)
*   **Tier 1 — 계층형 쿼리 키 트리 (`key-factory-generator.ts`)**: `userKeys.all`, `userKeys.lists()`, `userKeys.list(filters)`, `userKeys.details()`, `userKeys.detail(id)` 등 타입 안전 튜플 구조 자동 생성.
*   **Tier 2 — 순수 Options 팩토리 (`options-factory-generator.ts`)**: `@tanstack/react-query`의 `queryOptions()` 및 `mutationOptions()`를 순수 팩토리 함수로 생성. 프론트엔드 런타임 의존성 없이 SSR prefetching(`queryClient.prefetchQuery`) 및 클라이언트 훅에서 공용 사용 가능.
*   **Tier 3 — 클라이언트 컴포지션 훅 (`hook-factory-generator.ts`)**: React 19 호환 `use<Op>Query`, `use<Op>Mutation`, `useSuspense<Op>Query` 훅 생성.
*   **Zero-Copy 와이어 직렬화 안전성**: `@oa-sdk/core`의 `JsonPrimitive<T>`와 결합하여 네트워크 직렬화 경계의 100% 타입 안전성 보장.

현재 Core Platform의 태스크 체크리스트는 [todo.md](./todo.md)에, 아티팩트 릴리스 준비 절차는 [Artifact Release Preparation](../guides/release-preparation.md)에 둔다.

---

## Historical and maintenance context

아래 내용은 완료된 implementation history 또는 maintenance-only의 소유·추출 경계를 보존한다.
현재 Core Platform의 active feature roadmap으로 해석하지 않는다.

### Implemented maintenance track — Data Pseudonymization Manifest

API 설계 범위를 DB 설계 연결까지 확장하는 privacy track이다. 핵심 결정은
[Data Pseudonymization Manifest](../concepts/data-pseudonymization-manifest.md)를 독립 YAML
DSL로 두고, OpenAPI는 manifest 등록/검증/컴파일/dry-run/실행/리포트 gateway API만
설명하는 것이다.

실행 계획은 [Data Pseudonymization Manifest PRD](../../tasks/prd-data-pseudonymization-manifest.md)를 따른다.
이 track은 DB catalog snapshot 또는 OpenAPI projection envelope을 `catalog` 입력으로 소비하고,
Relationship Registry의 approved snapshot으로 namespace binding을 확정한다. DPM은 entity,
relationship-aware column transform, vault, quality gate, publishing 정책을 소유한다. Registry
snapshot, compiled plan, runtime validation report, AI schema context는 generated/review artifact로
취급한다.

Goal 4의 relationship-first core loop는 `@oa-sdk/dpm`으로 구현되었다. Runtime/storage 후속은
[Goal 5 — DPM Runtime/Storage Integration](./goals/goal-5-dpm-runtime-storage-integration.md)에 둔다.

후속 구현의 첫 bounded data-plane slice는 `@oa-sdk/dpm/execution`의 `executeDpmRows()`다.
이 adapter는 caller-owned in-memory row batch에 compiled plan을 적용하고, caller가 전달한
ephemeral HMAC key로 relationship token/hash를 생성하며, orphan policy와 parent/child 변환
일관성을 검증한다. 결과 report에는 raw value나 key material을 포함하지 않고, 오류가 있으면
output row를 반환하지 않는다. DB 연결, vault resolver, production row rewrite는 여전히 별도
단계로 남아 있다.

현재 `data_definitions` 구조와 `@oa-sdk/dpm/data` public seam은 논리 field/API/DB object
식별을 분리하는 compatibility slice로 추가되었다. namespace-safe identity contract는 Goal 68.1로
완료했고 artifact/catalog semantic binding은 Goal 68.2로 완료했다. Goal 68.3의 neutral
artifact와 compiled provenance 통합도 완료했으며, public external owner
`mineclover/data-governance`를 생성하고 DPM extraction rehearsal과 owner acceptance를
완료했다. External owner가 extraction contract의 canonical owner이고 `@oa-sdk/dpm@0.1.2`를
2026-07-28에 배포했다. `oa-sdk`는 non-publishing source/compatibility mirror이며 한 번의
compatibility release 동안 forwarding adapter로 동작한다. 향후 release와 breaking
removal은 별도 승인 대상이며 scope-gated
[Goal 68](./goals/goal-68-dpm-logical-data-definition-boundary.md)을 따른다.

Goal 간 선행 관계와 잔여 gap은 [DPM Master Roadmap](./goals/dpm-master-roadmap.md)을
통합 기준으로 사용한다. Goal 4~67은 완료된 capability history이며, Goal 68은 2026-07-14
temporary monorepo reactivation decision 후 68.1 identity contract, 68.2 semantic binding,
68.3 neutral artifact/provenance integration을 완료했고 68.4 private
`mineclover/data-governance` repository push와 external packed-consumer rehearsal도 runtime,
declaration, rollback, workflow, pack, owner CI, and owner `check:docs` gate까지 통과했다. GitHub Issues와 structured Goal 68.4 acceptance form이 현재 issue/review workflow로 준비되어 있다. Accepted owner decision은 [external owner decision record](https://github.com/mineclover/data-governance/blob/main/docs/internal/goals/owner-decision-record.md)와 [Goal 68.4 Issue #1](https://github.com/mineclover/data-governance/issues/1)에 기록했다. `data_definitions` 1.0은 구조적 호환성
계약으로 동결하고, 1.1 identity contract는 experimental로 취급한다. migration/rollback 규칙은
[Goal 68 extraction contract](./goals/goal-68-dpm-extraction-migration.md)에 기록했고 accepted owner handoff는 [Goal 68.4 acceptance checklist](./goals/goal-68-extraction-acceptance-checklist.md)에 정리했다. 검색, draft/edit/publish, diff/rollback, 작성 편의성은 stable
neutral artifact 위에 두는 별도의 owner-authorized control-plane capability이며 아직 active
goal은 아니다.

#### Historical DPM public-release policy

현재는 repository와 package를 private으로 유지한다. 공개 전환의 기본 패키지명은
`@mineclover/dpm`으로 검토하고, 기존 `@oa-sdk/dpm`은 compatibility adapter로 유지한다.
`T1`은 `main`의 owner-approved SemVer tag 또는 GitHub Release 중 release-gate workflow가
통과한 경우로만 인정한다. 일반 branch build, private rehearsal은 `T1`이 아니다. `T1` 전에는
public package metadata, license, registry publication을 추가하지 않는다.
`T1` 이후에는 기존 import를 1회 compatibility release 동안 유지하고 deprecation notice를
추가하며, 제거는 별도 승인된 major release로만 진행한다.

---

## 아키텍처 — SWC 스타일 Parse → Transform → Generate

```
OAS 3.2 spec (YAML/JSON)
     │
     ▼ Parse
  ParsedDocument (IR)              ← @oa-sdk/parser
  ├─ operations: OperationEntry[]
  ├─ routes: RouteIndex
  ├─ schemas: Record<string, OasSchema>
  ├─ securitySchemes, tags, webhooks, components
  └─ raw: 원본 OasDocument
     │
     ▼ Transform (SpecPass[])      ← @oa-sdk/parser
  derefPass ($ref 인라인)
  [사용자 정의 Pass]
     │
     ▼ Generate (Backend별)
  MockServerBackend                ← @oa-sdk/mock-server  ✅
  TypeScriptTypesBackend           ← @oa-sdk/codegen      ✅
  ServerRouterBackend              ← @oa-sdk/router       ✅
  ClientSdkBackend                 ← @oa-sdk/client       ✅
```

SWC에서 참조하는 패턴:
- **AST 노드 설계**: 자기 완결적 타입 (`types/` 13파일, 스펙 섹션 1:1 매핑)
- **Visitor/Fold**: `SchemaAlgebra<T>` + `foldSchema()` — 타입별 의미 해석
- **Pass 체인**: `SpecPass[]` + `runPipeline()` — 독립 변환 합성
- **Backend 교체**: 동일 IR에서 여러 출력 생성

---

## Historical implementation phases

### Completed — TypeSpec roundtrip readiness (`@oa-sdk/codegen` v0.3.0)
OpenAPI artifact를 `.tsp`와 OA SDK compatibility sidecar 및 `oa-sdk.typespec-bundle.v1` manifest로 변환한 뒤 TypeSpec OpenAPI emitter와 sidecar restore/re-extract를 거쳐 다시 OA SDK 검증/diff 루프에 넣고, authored `.tsp + sidecar` bundle 및 sidecar-less `.tsp` extension bundle도 같은 manifest로 검증 루프에 넣는 전환 가능성 평가 트랙입니다. 현재 `oa-gen tsp-export --bundle-manifest`, `oa-gen tsp-restore --stability-report`, `oa-gen tsp-bundle-check --fail-on-breaking`, `pnpm typespec:roundtrip -- --fail-on-breaking`, `pnpm typespec:bundle-check -- --fail-on-breaking`, `pnpm schema:validate`, `pnpm schema:rollback-check`, `pnpm schema:downstream-check`이 동작합니다.

이 트랙은 roundtrip gap을 줄이고, `.tsp`가 맡을 구조 계약과 OA SDK extension/sidecar가 맡을 runtime/mock/example metadata를 양방향 호환 가능하게 분리한 뒤 ADR-009와 production TypeSpec source switch까지 연결했습니다. 현재 운영 절차는 [typespec-roundtrip/production-operations.md](./typespec-roundtrip/production-operations.md)에 둡니다.

### Phase 1 — 스키마 관리 ✅
도메인 분리 + Spectral/Redocly 이중 검증 + 환경 프로필

### Phase 2 — 수집 방향 코드젠 + Mock 서버 ✅
Zod 4 → OAS + Drizzle → Zod + CLI + AJV Mock 서버 (MSW + Node HTTP)

### Phase 3 — OAS 파서 / IR ✅
- `@oa-sdk/parser`: OAS 3.2 전체 30개 타입 자체 정의 (스펙 §별 13파일 분할)
- `parseDocument()` → `ParsedDocument` IR (풀 파서)
- mock-server 전체가 parser 타입 직접 사용 (`openapi3-ts` 완전 제거, 타입 캐스트 0)
- global security/servers 상속, trace/query 메서드
- codegen `OasSchema`가 parser 정식 타입 참조
- 타입 중복 제거 (`SchemaEntry`→`NamedSchema`, re-export chain 단순화)

### Phase 4 — TypeScript 타입 생성 ✅
- `@oa-sdk/codegen/typegen`: `schemaToTs()` (SchemaAlgebra 기반) + `generateTypes()`
- $ref → 이름 참조, JSDoc, nullable, enum, tsc strict 통과
- `oa-gen typegen --spec` CLI

### Phase 5 — 서버 라우터 스텁 ✅
- `@oa-sdk/router`: Hono + Express 라우터 스텁 생성
- typegen 타입 import, path params, query, body, 204, JSDoc

### Phase 6 — 클라이언트 SDK ✅
- `@oa-sdk/client`: fetch 기반 타입 안전 클라이언트
- createClient(), template literal path, query, body, JSDoc

---

## 패키지 현황

```
packages/
  core/         ← 공유 유틸 (의존 없음)        ✅
  schemas/      ← OAS 소스                    ✅
  parser/       ← OAS → IR (Parse/Transform)  ✅
  mock-server/  ← IR → mock handlers          ✅
  codegen/      ← Drizzle/Zod → OAS + typegen ✅
  router/       ← IR → 서버 라우터 스텁        ✅
  client/       ← IR → 클라이언트 SDK          ✅
  dpm/          ← Relationship-first DPM       ✅
```

---

## 설계 원칙

1. **OAS 3.2 전용** — 3.1 하위 호환 없음
2. **단일 소스** — spec이 타입, 라우터, mock의 원천
3. **파이프라인 분리** — Parse / Transform / Generate 단계 분리
4. **Faker 미사용** — examples/default/generateMinimal() 순서
5. **점진적 채택** — 각 Phase 독립 사용 가능
