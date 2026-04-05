# CLI 세팅 가이드

## 필수 도구

| 도구 | 역할 | 설치 |
|---|---|---|
| **Redocly CLI** | 스키마 번들/린트/프리뷰 | 루트 devDep |
| **Spectral CLI** | 스타일 가이드 린트 | 루트 devDep |

모두 `pnpm install`로 자동 설치됩니다.

## 초기 세팅

```bash
cd oa-sdk
pnpm install
git submodule update --init --recursive
```

## 주요 워크플로우

### 스키마 검증

```bash
pnpm schema:validate
```

내부적으로 세 단계를 순차 실행:
1. `merge.ts` — 도메인 spec 병합 → `src/.merged.yaml`
2. `spectral lint .merged.yaml` — 스타일 가이드 검사
3. `redocly lint .merged.yaml` — $ref 유효성 + 스펙 준수 검사

### 스키마 번들링

```bash
pnpm schema:bundle
```

`packages/schemas/src/domains/*/spec.yaml` 을 병합 → 번들:
- `packages/schemas/dist/openapi.yaml`
- `packages/schemas/dist/openapi.json`

### 문서 미리보기

```bash
pnpm schema:preview
```

브라우저에서 Redoc UI로 스키마를 렌더링합니다.

### Mock 서버 시작

```bash
pnpm mock:start
```

기본 포트: `4010`

## 환경 프로필

```bash
pnpm --filter @oa-sdk/schemas merge            # local (기본)
pnpm --filter @oa-sdk/schemas merge:staging    # staging
pnpm --filter @oa-sdk/schemas merge:production # production
```

프로필 파일: `packages/schemas/src/profiles/{local,staging,production}.yaml`

## Spectral 규칙 커스텀

`packages/schemas/.spectral.yaml` 파일에서 규칙을 추가/수정합니다.

```yaml
rules:
  my-custom-rule:
    given: "$.paths[*][*]"
    severity: warn
    then:
      function: truthy
```

> OAS 3.2 관련 Spectral 규칙 비활성화 배경 → [ADR-005](../architecture/005-spectral-redocly-split.md)
