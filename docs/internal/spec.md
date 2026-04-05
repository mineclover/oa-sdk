# Spec — 현재 구현 현황

> 이 문서는 oa-sdk에서 실제로 작동하는 것만 기술합니다.
> 로드맵은 [plan.md](./plan.md), 즉시 태스크는 [todo.md](./todo.md)를 참조하세요.

---

## 패키지 구조

```
core         ← 공유 유틸 (pascalCase, toColonPath, collectTypeNames)
parser       ← core. OAS 3.2 파서 + IR + fold/deref/pipeline + query + lint
codegen      ← core + parser. Zod→OAS + typegen + Drizzle + CLI
mock-server  ← core + parser. AJV 검증 + 응답 선택 + 어댑터
router       ← core + parser. Hono/Express 라우터 스텁 생성
client       ← core + parser. fetch 클라이언트 SDK 생성
schemas      ← 독립. 도메인 분리 OAS 소스 + merge + 검증
```

---

## 패키지별 구현 상태

### `@oa-sdk/core` — 공유 유틸리티 ✅

| 함수 | 파일 | 용도 |
|------|------|------|
| `pascalCase()` | `strings.ts` | snake_case → PascalCase |
| `escapeKey()` | `strings.ts` | 비식별자 키 이스케이프 |
| `toColonPath()` | `strings.ts` | `/users/{id}` → `/users/:id` |
| `collectTypeNames()` | `codegen-utils.ts` | operations → typegen 타입 이름 수집 |

외부 의존 없음. 모든 패키지의 공통 함수 단일 소스.

---

### `@oa-sdk/parser` — OAS 3.2 파서 / IR ✅

| 기능 | 상태 |
|------|------|
| OAS 3.2 전체 타입 (30개 오브젝트, §별 13파일) | ✅ |
| `parseDocument()` → `ParsedDocument` IR | ✅ |
| global security/servers 상속 + trace/query 메서드 | ✅ |
| `$ref` 역참조 + 순환 참조 감지 | ✅ |
| SpecPass[] 파이프라인 + SchemaAlgebra fold | ✅ |
| 경로 매칭 + path param + webhooks | ✅ |
| Query API (`findOperation`, `findByTag`, `describeApi` 등) | ✅ |
| 자체 OAS 3.2 린터 (`lintDocument` — 6카테고리 14규칙) | ✅ |
| 외부 타입 의존 0 (openapi3-ts 불필요) | ✅ |

---

### `@oa-sdk/mock-server` — Mock HTTP 서버 ✅

| 기능 | 상태 |
|------|------|
| `parseDocument()` 기반 라우팅 (parser 타입 직접 사용) | ✅ |
| AJV v8 요청 검증 (8가지 에러 코드) | ✅ |
| Security 검증 (bearer/apiKey/oauth2 자격 증명 존재 확인) | ✅ |
| Parameter style/explode 역직렬화 (form/simple/label/matrix/pipe/space) | ✅ |
| Response headers 전달 (OAS Response.headers → HTTP 응답 헤더) | ✅ |
| 응답 선택 6단계 폴백 + SSE/NDJSON 스트리밍 | ✅ |
| MSW 2.x + Node HTTP 어댑터 | ✅ |
| `createTestClient(server)` — 테스트용 typed fetch wrapper | ✅ |
| `createCoverageTracker()` — operationId별 호출 추적 + 커버리지 비율 | ✅ |

---

### `@oa-sdk/codegen` — 스키마 자동 생성 ✅

| 기능 | 상태 |
|------|------|
| Zod 4 → OAS 3.2 Schema (discriminator 포함) | ✅ |
| Drizzle ORM → Zod → OAS + CLI | ✅ |
| typegen: OAS → TypeScript 타입 ($ref 참조, JSDoc, tsc 검증) | ✅ |
| `oa-gen typegen --spec` CLI | ✅ |

---

### `@oa-sdk/router` — 서버 라우터 스텁 ✅

Hono + Express. typegen 타입 import, path/query/body, 204, JSDoc.

### `@oa-sdk/client` — 클라이언트 SDK ✅

fetch `createClient()`. typegen 타입, template path, query, body, baseUrl, JSDoc.

### `@oa-sdk/schemas` — 도메인 분리 스키마 ✅

도메인별 spec.yaml + 환경 프로필 + merge + Spectral/Redocly 검증.
`pnpm downgrade:3.1` — 3.2→3.1 자동 변환 (Swagger UI/Redocly 호환).

---

## 데이터 흐름

```
수집: Drizzle/Zod → codegen → schemas
소비: schemas → parser (ParsedDocument IR)
                  ↓
         ┌───────┼────────┬─────────┐
         ▼       ▼        ▼         ▼
    mock-server  typegen  router   client
```

공유: `core` → 모든 소비 패키지. 외부 타입 의존 없음.

---

## 테스트 커버리지

| 패키지 | 파일 | 케이스 |
|--------|------|--------|
| core | 2 | 25 |
| parser | 4 | 53 |
| codegen | 10 | 193 |
| mock-server | 19 | 377 |
| router | 1 | 9 |
| client | 1 | 9 |
| playground | 2 | 23 |
| **합계** | **40** | **701** |
