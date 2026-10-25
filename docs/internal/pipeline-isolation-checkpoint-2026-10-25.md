# 용도별 파이프라인 완료·검증 기록 — 2026-10-25

상태: checkout 구현 완료, npm 미배포. 이 기록은 공식 release 승인이나 원격 CI 결과가 아니다.

## 완료 범위

- [기능 선택 지도](../guides/feature-map.md): 구현·공개 import·배포 후보·private/maintenance·외부 DPM·미래 TODO의 경계를 구분했다.
- [용도별 파이프라인 구성](../guides/pipeline-configuration.md): TypeSpec 플러그인과 CLI target의 공통 `PipelinePurpose`를 `api | data | interface`로 연결했다. 미지정 설정은 기존 혼합 동작을 유지한다.
- data target의 HTTP operation·endpoint companion 격리, 저장된 artifact의 용도 재검사, 타깃 간 상이한 동명 가드 스키마의 쓰기 전 거부를 구현했다.
- CLI·플러그인 가드는 Ajv standalone 엔진과 typegen 이름 매핑을 공유한다. 자체 `types.d.ts`와 플러그인 `guards.runtime.js`·`.d.ts`를 생성한다.
- 플러그인 오류 진단 시 기존 출력을 보존하고 Vite 최초 build/serve도 실패시킨다. dry-run 무쓰기와 실제 TypeSpec 소비자 compile 회귀를 추가했다.
- import·코드 포맷·테스트 구획과 가이드 탐색 구조를 정리했다. 새 formatter 의존성은 추가하지 않았다.

## 검증 결과

같은 작업에서 실행한 로컬 결과다. 전체 회귀 이후 마지막 변경은 코드·문서 정렬과
검토된 Type Registry 기준선 갱신이며, 그 뒤 관련 회귀와 전체 타입·정책 gate를 재실행했다.

| 구간 | 검증 | 결과 |
| --- | --- | --- |
| 정렬 전 전체 | `pnpm test:core:ci` | 28 tasks 성공. Codegen 212 files / 4,029 tests 통과; Spec-Lens의 기존 4 tests skip 포함 |
| 정렬 전 전체 | `pnpm test:downstream:ci` | 35 tasks 성공. Client 277 tests 모두 통과 |
| 정렬 전 통합 | `pnpm test:e2e:typespec-plugin` | 17 files / 130 tests 통과 |
| 정렬 전 산출물 | 스키마 검증·Codegen pack smoke | 통과. workspace protocol·미선언 import 검사 및 소비자 generate/mock/validate 검증 포함 |
| 정렬 후 관련 회귀 | Codegen purpose·runner·Vite·TypeScript/wire·CLI config·standalone generator | 7 files / 96 tests 통과 |
| 정렬 후 공유 엔진 | `pnpm --filter @oa-sdk/ast-sync test` | 9 files / 79 tests 통과 |
| 정렬 후 타입 | `pnpm typecheck:all` | 56 tasks 성공 |
| 최종 정합성 | 문서·API index·CLI spec·codegen boundary·feature matrix | 통과. Feature matrix 64 features |
| 최종 타입 기준선 | `pnpm type-registry:check` | drift 0, violations 0. budget·예외 목록 확대 없음 |
| 초안 릴리스 | `pnpm release:preflight --allow-dirty` | read-only 문서·버전·spec governance·release policy gate 통과 |

정렬 diff는 Type Registry에서 syntax 8개, shape/semantic/public surface 0개로 확인한 뒤
기준선에 반영했다. 이는 신규 기능 전체의 공개 API 변경이 없다는 뜻이 아니라 **정렬 단계만의 비교**다.

초기 병렬 Downstream 실행에서 client 취소 테스트 2개가 timeout됐으나 코드 변경 없이
순차 CI 실행에서 모두 통과했다. 원인을 부하로 확정하지 않았다. 가드 출력에 `types.d.ts`가
추가되며 기존 파일 수 assertion이 실패한 건은 기대 목록과 strict compile 검증을 보강한 뒤
전체 Core 회귀로 재검증했다.

## 한계와 다음 판단

- 모델 전용 `.tsp`도 현재 OpenAPI emitter에서는 `@service`가 필요하다. native JSON Schema emitter를 추가한 것은 아니다.
- `clean` 기본값은 `true`다. 용도별 출력 디렉터리를 분리하고 수기 코드와 섞지 않는다.
- 출력 보존은 검증·렌더링·플러그인 진단 실패에 대한 규칙이다. 커스텀 플러그인의 자체 부작용이나 모든 디스크 I/O 장애의 transaction을 보장하지 않는다.
- 공식 full release preflight·artifact export·npm publish·원격 CI 재실행은 하지 않았다. 전체 `ci:local` 실행을 대신하지도 않는다.
- [`purpose-isolated-pipelines` Changeset](../../.changeset/purpose-isolated-pipelines.md)은 codegen·ast-sync minor 의도다. 실제 배포는 [Release Readiness](./release-readiness.md)의 별도 절차를 따른다.
- DPM canonical owner는 외부 `mineclover/data-governance`다. 공유 검색은 미래 TODO이며 DB·권한·adapter·서비스 작업을 자동 재개하지 않는다.

## 환경 정리 범위

검증 요약을 이 문서에 보존하고 이번 세션의 임시 로그 37개(`oa-feature-docs-*.log` 7개,
`oa-pipeline-*.log` 30개, 1,029,638 bytes)와 정확한 재현 디렉터리
`oa-pipeline-review.wIK9lk`(29 files, 22,768 bytes)를 정리했다.
대상은 OpenCode 전용 임시 디렉터리의 직접 자식이며, 다른 `oa-*` 자료는 포함하지 않는다.
최종 검사로 재생성된 `.oa-sdk/type-registry/report.json`·`snapshot.json`도 정리했다.
추적 중인 `type-registry-baseline.json`, 기존 SQL·검증 자료·다른 저장소·의존성·공용 캐시는 보존한다.
이번 작업에서 새 DB·Docker·개발 서버를 운영 상태로 남기지 않았다.
