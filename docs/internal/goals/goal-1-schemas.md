# Goal 1 — 모듈형 스키마 관리

**상태: ✅ 구현 완료**

## 목표

- OpenAPI 3.2.0을 단일 소스로 관리
- 도메인 단위 분리로 팀별 독립 작업 가능
- 환경별(local / staging / production) 서버 주소를 별도 프로필로 관리
- Spectral(스타일) + Redocly(구조) 이중 검증

## 구현

### 디렉터리 구조

```
packages/schemas/src/
  openapi.yaml          ← info + tags 전용 (paths/components/servers 없음)
  profiles/
    local.yaml          ← servers: [localhost:4010, localhost:3000]
    staging.yaml
    production.yaml
  domains/
    common/spec.yaml    ← 공유 components (Error, 공통 responses, OAuth)
    health/spec.yaml    ← /health, /health/stream paths
    {새 도메인}/spec.yaml
```

### 병합 규칙

`pnpm merge` 실행 시 `scripts/merge.ts`가:
1. `openapi.yaml` (info + tags) 을 base로 읽음
2. `profiles/{PROFILE}.yaml` 에서 servers 주입 (기본값: local)
3. `domains/*/spec.yaml` 를 스캔 — common 먼저, 나머지 알파벳 순
4. `src/.merged.yaml` 출력

중복 path → 즉시 오류 종료  
중복 component key → 경고 후 나중 도메인이 덮어씀

### 검증 체계

| 도구 | 담당 |
|---|---|
| Spectral | 스타일 규칙 (operationId, camelCase 등) |
| Redocly | $ref 해석 + 스펙 구조 검증 |

Spectral은 OpenAPI 3.2를 미지원(2026-04 기준)하므로 구조 검증 규칙은 전부 off.  
→ [ADR-005](../architecture/005-spectral-redocly-split.md) 참조

### OpenAPI 3.2 주요 적용 사항

- `examples` 필드: `value` 대신 `dataValue` / `serializedValue` 사용
- SSE 응답: `text/event-stream` + `itemSchema` 필드
- OAuth: `deviceAuthorization` flow + `oauth2MetadataUrl` (RFC 8628 / RFC 8414)
- 하위 호환성 없음 — 3.1 문법 사용 금지

## 스크립트

```bash
pnpm merge                   # local 프로필로 병합
pnpm merge staging           # staging 프로필
PROFILE=production pnpm merge
pnpm schema:validate         # merge → spectral → redocly
pnpm schema:bundle           # validate → dist/openapi.{yaml,json}
pnpm schema:preview          # Redoc 미리보기
```
