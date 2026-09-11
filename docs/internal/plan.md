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
| **Phase 2: 개발자 경험(DX) 및 마찰 제로 온보딩** | `oa-gen init` 대화형 온보딩 CLI, VS Code 인라인 타입 진단, `.ts` 소스 변경 실시간 반영 `oa-gen mock --watch` 핫 리로드 | `oa-gen init` 스캐폴더, JSDoc `@oaOperation` 실시간 파싱 및 가상 프로그램 핫 스왑 테스트 통과 | **진행 중 (Active)** |
| **Phase 3: 엔터프라이즈 CI/CD 및 드리프트 자동 방어** | PR 단위 Breaking Change 자동 차단 봇, 프로덕션 런타임 드리프트(`oa-gen drift`) 크론 모니터링 및 알림, 멀티 서비스 원격 스키마 연합(Federation) | GitHub Actions PR 코멘트 봇, Slack/Webhook 드리프트 알림 어댑터, 교차 서비스 `$ref` 번들러 | **계획 (Planned)** |
| **Phase 4: 풀스택 클라이언트/서버 런타임 확장** | TanStack Query / React Query 훅 생성기(`@oa-sdk/client`), Fastify / Elysia 고성능 라우터 스텁(`@oa-sdk/router`), `JsonPrimitive<T>` Zero-copy 직렬화 가속 | 생성된 훅의 React 19 컴파일 및 SSR 테스트, Fastify 벤치마크, AOT 타입 가드 벤치마크 통과 | **향후 과제 (Future)** |

### 단계별 상세 구현 명세 (Practical Viability Specifications)

#### 1. Phase 1: 코어 플랫폼 및 2계층 격리 배포 완비 (완료 ✅)
- **OAS 3.2 $\leftrightarrow$ Zod 4 파이프라인**: Draft 2020-12 어휘(수치 한계, `prefixItems`, `discriminator`, `z.lazy()` 순환참조) 지원 및 사전 검증/정규화 파이프라인 완비.
- **Samchon 5대 코어 개선**: 24종 구문 특성 분류기(`audit:shape`), `JsonPrimitive<T>` 와이어 타입, `@oaOperation` JSDoc 라우트 추출, TypeChecker 심볼 ID 순환 참조 DFS 탐지, transitive tsconfig universe 캐시 무효화.
- **2계층 격리 릴리스 파이프라인**: 9대 사전 검증 관문(`release:preflight`) $\rightarrow$ 무결성 아티팩트 익스포터(`release:export`) $\rightarrow$ 배포 전용 리포지토리(`oa-sdk-releases`) $\rightarrow$ Sigstore SLSA v1 Provenance 연동 공용 npm 레지스트리 배포 완료.

#### 2. Phase 2: 개발자 경험(DX) 및 마찰 제로 온보딩 (진행 중 🚀)
- **`oa-gen init` 대화형 스캐폴더**:
  - 기존 프로젝트(NestJS, Express, FastAPI, Next.js 등)에 진입하여 프레임워크와 스키마 위치를 자동 감지하고 `oa.config.ts` 및 기본 거버넌스 스크립트 1클릭 주입.
- **VS Code / TypeScript LSP 인라인 진단**:
  - `audit:shape`를 LSP/TypeScript 플러그인과 결합하여 OpenAPI로 투영 불가능한 `unsupported` 타입(조건부/맵드 타입) 선언 시 에디터 상에서 실시간 밑줄 경고 표시.
  - `/** @oaOperation <METHOD> <PATH> */` JSDoc 태그의 자동완성 및 유효 경로 문법 실시간 검사.
- **실시간 소스 관측 Mock Server (`oa-gen mock --watch`)**:
  - 기존 `.tsp` 파일뿐만 아니라 `@oaOperation` JSDoc이 작성된 `.ts` 소스 파일 수정 시에도 서버 재시작 없이 라우트 테이블 및 응답 스키마를 즉각 핫 스왑.

#### 3. Phase 3: 엔터프라이즈 CI/CD 및 드리프트 자동 방어 (계획 ⏳)
- **Pull Request Breaking Change 가드 봇**:
  - PR 생성/업데이트 시 CI 워크플로우에서 `oa-gen diff --fail-on-breaking`을 자동 수행하고, 스펙 변경 내역과 하위 호환성 위험도를 PR 마크다운 코멘트로 자동 게시.
- **런타임 드리프트 크론 모니터링 (Runtime Drift Sentinel)**:
  - 배포된 운영/스테이징 API 서버(`--runtime-openapi-url`)를 대상으로 주기적인 스펙 드리프트를 감지하고, 비정상 괴리 발생 시 웹훅/Slack/PagerDuty로 구조화된 경보 발송.
- **멀티 서비스 스키마 연합 (Federation & Contract Registry)**:
  - 대규모 마이크로서비스 아키텍처 환경에서 여러 서비스의 OpenAPI 조각을 안정적으로 교차 참조(`$ref`)하고 통합 번들링하는 원격 레지스트리 캐시 레이어 구현.

#### 4. Phase 4: 풀스택 클라이언트/서버 런타임 확장 (향후 과제 🔮)
- **프론트엔드 React Query / TanStack Query 훅 생성기**:
  - `@oa-sdk/client`에서 단순 Fetch SDK뿐만 아니라, React/Vue/Svelte 생태계를 위한 타입 세이프 `useQuery`, `useMutation`, `useInfiniteQuery` 훅 자동 방출.
- **차세대 고성능 백엔드 라우터 스텁**:
  - Hono, Express 외에 Node.js 진영의 Fastify 및 Bun 생태계의 Elysia를 지원하는 고성능 비동기 라우터 스텁 생성 지원.
- **Zero-Copy 와이어 직렬화 가속**:
  - `JsonPrimitive<T>`와 `@oa-sdk/ast-sync`의 독립형 AOT 타입 가드를 결합하여 런타임 유효성 검사 오버헤드를 극소화하는 고속 직렬화/역직렬화 엔진 구축.

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
artifact와 compiled provenance 통합도 완료했으며, private external owner
`mineclover/data-governance`를 생성하고 DPM extraction rehearsal과 private owner acceptance를
완료했다. External owner가 extraction contract의 canonical owner이며, `oa-sdk`는 첫 accepted
owner artifact release(`T1`)까지 source/compatibility implementation으로 유지되고 이후 한 번의
compatibility release 동안 forwarding adapter로 동작한다. Public registry publication과 breaking
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
