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
  fragments/
    path/public/...     ← path fragments
    schema/public/...   ← schema fragments
    response/shared/... ← shared response fragments
  targets/
    local-parity-api.yaml
    staging-parity-api.yaml
    production-parity-api.yaml
```

### 빌드 규칙

`pnpm --filter @oa-sdk/schemas run build:merged` 실행 시 Definition Builder가:
1. `targets/local-parity-api.yaml`의 root metadata, servers, tags, includePaths를 읽음
2. `fragments/**/*.yaml`를 canonical id registry로 로드
3. include path와 retained definitions에서 시작해 `$ref` graph를 재귀 선택
4. source `oa://...` ref를 OpenAPI local `$ref`로 rewrite
5. `src/.merged.yaml` 출력

중복 canonical id, unresolved ref, target 밖 ref, output-name collision, unrewritten ref, validation error → 즉시 오류 종료.

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
pnpm --filter @oa-sdk/schemas run build:merged
pnpm --filter @oa-sdk/schemas run build:merged:staging
pnpm --filter @oa-sdk/schemas run build:merged:production
pnpm schema:validate         # build-spec → downgrade → spectral → redocly → strict 3.2 validate
pnpm schema:bundle           # validate → dist/openapi.{yaml,json}
pnpm schema:preview          # Redoc 미리보기
```
