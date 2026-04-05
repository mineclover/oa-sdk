# Spec — 현재 구현 현황

> 이 문서는 oa-sdk에서 실제로 작동하는 것만 기술합니다.
> 로드맵은 [plan.md](./plan.md), API 상세는 [api-index.md](./api-index.md)를 참조하세요.

---

## 패키지 구조

```
core         ← 공유 유틸 (pascalCase, toColonPath, collectTypeNames, formatGeneratedTs)
parser       ← core. OAS 3.2 파서 + IR + fold/deref/pipeline + query + lint + validate
codegen      ← core + parser + router + client. Zod→OAS + typegen + Drizzle + CLI 7개
mock-server  ← core + parser. AJV 검증 + Security + 어댑터 + 테스트 헬퍼
router       ← core + parser. Hono/Express 라우터 스텁
client       ← core + parser. fetch 클라이언트 SDK + SSE stream
schemas      ← 독립. 도메인 분리 OAS 소스 + merge + 3.1 다운/업그레이드
```

---

## 패키지별 구현 상태

### `@oa-sdk/core` ✅
pascalCase, escapeKey, toColonPath, collectTypeNames, formatGeneratedTs.
외부 의존 없음. 32 테스트.

### `@oa-sdk/parser` ✅
OAS 3.2 전체 타입 (30개, §별 13파일) + parseDocument + SchemaAlgebra fold + lint(7카테고리 17규칙) + validate + Query API(findOperation, findByTag, describeApi). 119 테스트.

### `@oa-sdk/mock-server` ✅
AJV 검증(8 에러코드) + Security(bearer/apiKey/oauth2/oidc/mTLS, OR/AND 의미론) + style/explode + Response headers + SSE/NDJSON + MSW/Node HTTP 어댑터 + createTestClient + createCoverageTracker. 417 테스트.

### `@oa-sdk/codegen` ✅
Zod 4→OAS(discriminator) + Drizzle→Zod→OAS + typegen($ref, JSDoc, tsc 검증) + CLI 7커맨드(generate/typegen/router/client/lint/validate/help). 193 테스트.

### `@oa-sdk/router` ✅
Hono/Express 스텁. typegen 타입 import, path/query/body, 204, JSDoc. 9 테스트.

### `@oa-sdk/client` ✅
fetch createClient() + SSE async generator. typegen 타입, template path, baseUrl, JSDoc. 14 테스트.

### `@oa-sdk/schemas` ✅
도메인 분리 spec.yaml + 환경 프로필 + merge + 3.2→3.1 다운그레이드(사이드카) + 3.1→3.2 업그레이드.

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

## 검증 체계

```
자체 린터 (3.2 네이티브): 0 에러, 0 경고
Redocly   (3.1 다운그레이드): valid, 4 경고 (의도적)
Spectral  (3.1 다운그레이드): 0 에러, 1 힌트
```

---

## 테스트 커버리지

| 패키지 | 파일 | 케이스 |
|--------|------|--------|
| core | 3 | 32 |
| parser | 11 | 119 |
| codegen | 10 | 193 |
| mock-server | 21 | 417 |
| router | 1 | 9 |
| client | 2 | 14 |
| playground | 4 | 35 |
| **합계** | **52** | **819** |
