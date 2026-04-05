# ADR-002 — MSW + Node HTTP 듀얼 어댑터

## 상태

채택됨

## 컨텍스트

Mock 서버의 사용 환경이 두 가지:
1. **브라우저/Vitest 환경** — MSW 2.x Service Worker / Node 인터셉터
2. **순수 Node.js 통합 테스트** — 실제 HTTP 포트를 열어 axios/fetch로 요청

하나의 어댑터만으로는 두 환경을 모두 커버할 수 없음.

## 결정

공통 로직(`schema-loader`, `request-validator`, `response-picker`)을 코어로 추출하고,  
두 어댑터가 이를 공유하는 구조:

```
core/  →  adapters/msw.ts
       →  adapters/node-http.ts
```

## 결과

- `createMswHandlers(spec)` — MSW `RequestHandler[]` 반환
- `createNodeMockServer(spec, {port})` — `{start, stop, url}` 반환
- 검증 로직 중복 없음
