# Quick Start

5분 안에 oa-sdk 전 파이프라인을 체험합니다.

## 1. 설치

```bash
git clone <repo> && cd oa-sdk
pnpm install
```

## 2. 스키마 확인

```bash
pnpm --filter @oa-sdk/schemas run merge
# → 4개 경로, 17개 컴포넌트
```

## 3. 린트

```bash
oa-gen lint --spec packages/schemas/src/.merged.yaml
# → 0 errors, 0 warnings
```

## 4. TypeScript 타입 생성

```bash
oa-gen typegen --spec packages/schemas/src/.merged.yaml -o types.ts
```

```typescript
// 생성 결과 (types.ts)
/** 사용자 정보 */
export type User = {
  id: string
  email: string
  name: string
  role: 'admin' | 'user' | 'guest'
  createdAt: string
}
```

## 5. 라우터 스텁 생성

```bash
oa-gen router --spec packages/schemas/src/.merged.yaml --types-import './types' -o router.ts
```

## 6. 클라이언트 SDK 생성

```bash
oa-gen client --spec packages/schemas/src/.merged.yaml --types-import './types' -o client.ts
```

## 7. 데모 (Mock 서버 + 전체 흐름)

```bash
pnpm demo
```

```
━━━ API 구조 ━━━
OA SDK API v0.1.0 — 7개 오퍼레이션, 6개 스키마
━━━ Mock Server ━━━
GET  /health        → 200 {"status":"ok"}
POST /users (유효)  → 201
━━━ 커버리지 ━━━
86% (6/7)
```

## 다음 단계

| 하고 싶은 것 | 가이드 |
|------------|--------|
| Mock 서버로 테스트 작성 | → [Mock 테스팅](./use-cases/mock-testing.md) |
| Drizzle에서 스키마 자동 생성 | → [코드젠 워크플로](./use-cases/codegen-workflow.md) |
| 테스트 커버리지 추적 | → [테스트 피드백](./use-cases/test-feedback.md) |
| CLI 전체 명령어 | → [CLI 세팅](./cli-setup.md) |
| API 상세 | → [API 인덱스](../internal/api-index.md) (SSOT) |
