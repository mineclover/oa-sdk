# `oa-gen generate --incremental` 실 실행 검증

검증일: 2026-10-30 (Asia/Seoul)

## 실행 조건

- 입력: 임시 OpenAPI 3.2 JSON 문서 (`paths: {}`, 빈 `components.schemas`)
- 출력: 임시 `generated/` 디렉터리
- 캐시: 임시 `.oa-cache/`
- 명령:

```bash
node --import tsx packages/codegen/src/cli/index.ts generate \
  --spec <api.json> \
  --out-dir <generated> \
  --incremental \
  --cache-dir <.oa-cache>
```

## 결과

| 실행 | stderr incremental 로그 | Artifacts Written | Artifacts Cached |
|---|---|---:|---:|
| 1회차 | `generate target "api" regenerating (no previous generation record)` | 5 | 0 |
| 동일 입력 2회차 | `generate target "api" reused` | 0 | 5 |
| `info.version`을 `1.0.0`에서 `2.0.0`으로 변경한 3회차 | `generate target "api" regenerating (input changed: .../api.json)` | 1 | 4 |

생성·재사용된 target 산출물은 OpenAPI JSON, JSON Schema, handler contract, client SDK,
TanStack Query 파일이다. 3회차에는 OpenAPI 산출물만 다시 쓰였고, 나머지 4개 artifact는
기존 content hash가 유지되어 cache 처리됐다. 최종 OpenAPI 문서의 `info.version`은 `2.0.0`으로
확인했다.

## 의미와 제한

이 결과는 target bundle 재사용과 입력 변경 감지를 실제 CLI에서 확인한 것이다. TypeSpec
입력은 compiler/module-graph observation을 target record에 완전히 연결하기 전까지 안전한
전체 재생성 fallback을 사용한다. guards가 활성화된 target과 실패·누락 companion output이
있는 run도 재사용 bundle을 기록하지 않는다.
