# Plan — 구현 로드맵

> 목표와 단계별 방향을 기술합니다.
> 핵심 철학과 주 목표는 [Vision](../vision.md)을 참조하세요.
> 실제 구현 현황은 [spec.md](./spec.md), 즉시 태스크는 [todo.md](./todo.md)를 참조하세요.

---

## 시스템 목표

OpenAPI contract를 중심으로 OpenAPI/JSON Schema 호환 입력 수집, modular
schema/definition composition, metadata/path surface management, validation, code
generation, mock/runtime testing, diff/drift/freshness review를 연결한다. 시스템 루프는
[Vision](../vision.md#system-loop)을 따른다.

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

## Phase별 현황

### Next — TypeSpec roundtrip readiness (`@oa-sdk/codegen` v0.3.0)
OpenAPI artifact를 `.tsp`와 OA SDK compatibility sidecar로 변환한 뒤 TypeSpec OpenAPI emitter와 sidecar restore/re-extract를 거쳐 다시 OA SDK 검증/diff 루프에 넣고, authored `.tsp + sidecar` bundle도 같은 검증 루프에 넣는 전환 가능성 평가 트랙입니다. 현재 `oa-gen tsp-export`, `oa-gen tsp-restore --stability-report`, `pnpm typespec:roundtrip -- --fail-on-breaking`, `pnpm typespec:bundle-check -- --fail-on-breaking`이 동작합니다.

목표는 즉시 TSP-first를 선언하는 것이 아니라 다음 `@oa-sdk/codegen` minor에서 roundtrip gap을 줄이고, `.tsp`가 맡을 구조 계약과 OA SDK sidecar가 맡을 runtime/mock/example metadata를 양방향 호환 가능하게 분리하는 것입니다. 상세 로드맵은 [typespec-roundtrip/v0.3.0/implementation-roadmap.plan.md](./typespec-roundtrip/v0.3.0/implementation-roadmap.plan.md)에 둡니다.

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
```

---

## 설계 원칙

1. **OAS 3.2 전용** — 3.1 하위 호환 없음
2. **단일 소스** — spec이 타입, 라우터, mock의 원천
3. **파이프라인 분리** — Parse / Transform / Generate 단계 분리
4. **Faker 미사용** — examples/default/generateMinimal() 순서
5. **점진적 채택** — 각 Phase 독립 사용 가능
