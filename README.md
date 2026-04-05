# oa-sdk

OpenAPI 3.2를 중심으로 한 양방향 API 인프라 모노레포.

```
Drizzle ORM ──▶                        ──▶ Mock Server
Zod Schema  ──▶  OpenAPI 3.2 Spec      ──▶ TypeScript 타입
               (단일 소스 + 검증)       ──▶ 서버 라우터 스텁
                                        ──▶ 클라이언트 SDK
```

## 패키지

| 패키지 | 역할 | 상태 |
|--------|------|------|
| `@oa-sdk/core` | 패키지 간 공유 유틸리티 (문자열 변환, 코드젠 헬퍼) | ✅ |
| `@oa-sdk/schemas` | 도메인 분리 OAS 3.2 스키마 + 검증 + 번들 | ✅ |
| `@oa-sdk/parser` | OAS 3.2 파서 — Parse/Transform/Fold 파이프라인 | ✅ |
| `@oa-sdk/mock-server` | AJV Mock 서버 (MSW + Node HTTP) + Security 검증 | ✅ |
| `@oa-sdk/codegen` | Drizzle/Zod → OAS + OAS → TypeScript 타입 | ✅ |
| `@oa-sdk/router` | OAS → Hono/Express 라우터 스텁 | ✅ |
| `@oa-sdk/client` | OAS → fetch 기반 타입 안전 클라이언트 | ✅ |

## 빠른 시작

```bash
pnpm install
git submodule update --init --recursive

pnpm schema:validate    # 스키마 검증 (merge → spectral → redocly)
pnpm schema:bundle      # dist/openapi.{yaml,json} 빌드
pnpm mock:start         # Mock 서버 (포트 4010)
```

```bash
# 코드 생성
oa-gen generate --config codegen.config.mjs      # Zod/Drizzle → OAS
oa-gen typegen  --spec openapi.yaml -o types.ts   # OAS → TypeScript 타입
oa-gen router   --spec openapi.yaml -o router.ts  # OAS → Hono 라우터 스텁
oa-gen client   --spec openapi.yaml -o client.ts  # OAS → fetch 클라이언트
oa-gen lint     --spec openapi.yaml               # OAS 3.2 구조 검증

# 데모 (API 구조 + Mock 서버 + 커버리지)
pnpm demo
```

## 문서

| 문서 | |
|------|-|
| [Quick Start](./docs/guides/quick-start.md) | 5분 안에 전 파이프라인 체험 |
| [전체 문서](./docs/README.md) | 유저 가이드 + 프로젝트 관리 SSOT |
| [구현 현황](./docs/internal/spec.md) | 7패키지, 819 테스트 |
| [API 인덱스](./docs/internal/api-index.md) | 타입·함수 단일 소스 |
