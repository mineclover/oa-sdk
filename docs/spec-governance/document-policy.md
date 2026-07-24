# 문서 유형과 품질 기준

## 문서 유형별 소유권

| 유형 | 파일 규칙 | 반드시 답해야 하는 질문 | 완료 시 갱신 |
|---|---|---|---|
| 거버넌스 | `docs/spec-governance/` | 어떻게 판단·검증·변경하는가? | `decision-log.md` |
| 범위/현황 SSOT | `docs/internal/platform-scope.md`, `spec.md` | 무엇을 소유하고 현재 무엇이 작동하는가? | feature/test 관련 표 |
| API/계약 SSOT | `api-index.md`, `packages/schemas/typespec/**/*.tsp` | 어떤 계약과 표면을 제공하는가? | approved snapshot, diff |
| 계획/결정 | `*.plan.md`, `goals/`, `architecture/` | 왜 하며 무엇이 아직 남았는가? | 완료 시 SSOT로 승격 |
| 사용자 가이드/운영 | `docs/guides/` | 사용·검토·복구를 어떻게 하는가? | 명령·링크 검증 |
| 생성/참조 자료 | `approved.openapi.yaml`, `dist/`, 예제 | 어떤 정본에서 파생되었는가? | 원천 변경 시 재생성 |

새 문서를 추가하기 전에 기존 문서의 적절한 유형과 소유 위치를 선택한다. 같은 사실을
두 문서에 독립적으로 유지하지 말고, 한쪽은 정본으로 두고 다른 쪽은 링크·요약만 둔다.

## 문서 품질 기준

문서는 다음을 만족해야 완료로 판단한다.

- 목적, 적용 범위, 상태(`active`, `planned`, `historical` 등), 소유 정본이 드러난다.
- 규범적 문장에는 정본 파일, 명령, 테스트 또는 외부 표준 중 하나의 근거가 있다.
- 계획과 현재 사실을 섞지 않는다. 계획은 구현 완료처럼 표현하지 않는다.
- 명령 예제는 현재 package script와 일치하고, 상대 링크는 실제 파일을 가리킨다.
- 생성 artifact를 사람이 작성한 정본처럼 설명하지 않는다.
- 예외·충돌·임시 호환 동작은 범위와 종료 조건을 기록한다.
- 변경 이력에 변경 내용, 이유, 영향 범위, 저장 위치가 남는다.

## 완료 판단과 검증 선택

| 변경 종류 | 최소 완료 조건 |
|---|---|
| 문서/링크/예제만 | `pnpm check:docs`, `pnpm check:spec-governance`, `git diff --check` |
| 구현 현황·API·테스트 매핑 | 위 조건 + 관련 테스트/검증 + `pnpm check:feature-tests` |
| TypeSpec/OpenAPI 계약 | candidate diff 검토 + `pnpm schema:typespec-check` + `pnpm schema:validate` |
| parser/codegen/router/client/mock 영향 | 계약 조건 + `pnpm schema:downstream-check` 및 영향 package test/typecheck |
| release/version/policy | 관련 검증 + `pnpm check:release-policy` 및 변경 이력 |

검증을 생략할 때는 이유와 대체 증거를 변경 기록에 남긴다. 한 명령의 성공만으로
계약 변경 완료를 주장하지 않는다.

## 기록 형식

정본 문서의 상단에는 최소한 다음을 표시한다.

```text
상태: active | planned | historical
최종 검토: YYYY-MM-DD
정본: path/to/source
```

이미 형식이 있는 기존 문서는 일괄 개편하지 않는다. 다음 변경 시 필요한 메타데이터를
보완한다.
