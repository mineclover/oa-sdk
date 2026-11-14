# 용도별 파이프라인 완료·검증 기록 — 2026-10-25

상태: checkout 구현 완료, npm 미배포. 이 기록은 공식 release 승인이나 원격 CI 결과가 아니다.

## 완료 범위

- [기능 선택 지도](../guides/feature-map.md): 구현·공개 import·배포 후보·private/maintenance·외부 DPM·미래 TODO의 경계를 구분했다.
- [용도별 파이프라인 구성](../guides/pipeline-configuration.md): TypeSpec 플러그인과 CLI target의 공통 `PipelinePurpose`를 `api | data | interface`로 연결했다. 미지정 설정은 기존 혼합 동작을 유지한다.
- data target의 HTTP operation·endpoint companion 격리, 저장된 artifact의 용도 재검사, 타깃 간 상이한 동명 가드 스키마의 쓰기 전 거부를 구현했다.
- CLI·플러그인 가드는 Ajv standalone 엔진과 typegen 이름 매핑을 공유한다. 자체 `types.d.ts`와 플러그인 `guards.runtime.js`·`.d.ts`를 생성한다.
- 플러그인 오류 진단 시 기존 출력을 보존하고 Vite 최초 build/serve도 실패시킨다. dry-run 무쓰기와 실제 TypeSpec 소비자 compile 회귀를 추가했다.
- import·코드 포맷·테스트 구획과 가이드 탐색 구조를 정리했다. 새 formatter 의존성은 추가하지 않았다.

## 초기 구현 검증 결과 (`020ec128`)

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
- The consumed `purpose-isolated-pipelines` version intent is recorded in the
  `@oa-sdk/codegen` and `@oa-sdk/ast-sync` package changelogs. Actual
  promotion follows the separate [Release Readiness](./release-readiness.md)
  procedure.
- DPM canonical owner는 외부 `mineclover/data-governance`다. 공유 검색은 미래 TODO이며 DB·권한·adapter·서비스 작업을 자동 재개하지 않는다.

## 환경 정리 범위

검증 요약을 이 문서에 보존하고 이번 세션의 임시 로그 37개(`oa-feature-docs-*.log` 7개,
`oa-pipeline-*.log` 30개, 1,029,638 bytes)와 정확한 재현 디렉터리
`oa-pipeline-review.wIK9lk`(29 files, 22,768 bytes)를 정리했다.
대상은 OpenCode 전용 임시 디렉터리의 직접 자식이며, 다른 `oa-*` 자료는 포함하지 않는다.
최종 검사로 재생성된 `.oa-sdk/type-registry/report.json`·`snapshot.json`도 정리했다.
추적 중인 `type-registry-baseline.json`, 기존 SQL·검증 자료·다른 저장소·의존성·공용 캐시는 보존한다.
이번 작업에서 새 DB·Docker·개발 서버를 운영 상태로 남기지 않았다.

## 후속 안정화 — 구현 구조와 경계 조건

초기 커밋 `020ec128` 이후의 별도 안정화 작업이다. 신규 기능이나 배포 승인을 추가하지 않는다.

### 구현 책임 정리

| 단계 | 책임 | 경계 |
| --- | --- | --- |
| 구성 | `TspConfig` / `ProfileTargetConfig` → `PipelinePurpose` | 미지정 설정의 기존 동작 유지 |
| 입력 검사 | `pipeline-purpose.ts` | API operation·data model·interface admission 공유 |
| 대상 투영 | `spec-projector.ts` / CLI generate·validate | data의 HTTP companion 제외, 저장 artifact 용도 검사, 동명 계약 충돌 거부 |
| 타입·가드 연결 | Codegen standalone bridge / TypeScript plugin | typegen 선언 이름 공유, 자체 선언 또는 외부 모듈 중 하나 선택 |
| runtime 생성 | AST-Sync standalone 엔진 | 정적 ESM 가드, 포인터 escape, 충돌 없는 분할 경로 |
| 출력 | runner / bridge | 렌더링·진단 실패 시 기존 출력 보존, dry-run 무쓰기 |

### 재현 후 수정

| 결함 | 수정과 회귀 |
| --- | --- |
| `Domain.User`와 `Domain_User`, 같은 타입을 검증하는 custom guard가 분할 파일을 덮어씀 | 파일명 별도 allocator와 suffix. 대소문자만 다른 이름도 보호하며 기존 충돌 없는 이름 유지 |
| `/`, `~`, `#`, `%`를 포함한 이름의 자동 발견 참조 실패 | RFC 6901 token escape와 URI fragment encoding. `$defs`·`definitions`·`components.schemas`, split 양쪽에서 생성 타입 compile·실제 runtime 검증 |
| `$Value` 타입의 플러그인 wrapper가 사라짐 | runtime export·wrapper 추출 식별자 규칙에 `$` 허용. complete consumer compile 회귀 |
| `typeNames: { User: 'ExternalUser' }`만 지정하면 자체 선언은 `User`인데 가드는 `ExternalUser`를 참조 | 자동 이름을 바꿀 때 외부 `typeImportSpecifier`를 요구하고 쓰기 전 실패. 외부 모듈이 있는 경우 split 양쪽 compile 회귀 |

회귀는 `pipeline-isolation.test.ts` 26 tests와 `guards-rendering.test.ts` 4 tests에 포함한다.
기능 매트릭스는 기존 `pipeline-purpose-isolation` 항목을 보강하며 새 기능 그룹으로 늘리지 않는다.

### 후속 검증

- 관련 Codegen 회귀: 8 files / 114 tests 통과(standalone CLI 포함).
- 플러그인 E2E: 17 files / 130 tests 통과.
- 전체 타입 검사: `pnpm typecheck:all` 56 tasks 성공.
- TS 7/ttsc 호환성: `pnpm check:ts7`의 Core 7개 source 검사·소비자 compile 3 tests 통과.
- 문서·API index·CLI spec·codegen boundary·feature matrix·초안 preflight 통과.
- 전체 Core 회귀: `pnpm test:core:ci` 28 tasks 성공. Codegen 212 files / 4,041 tests, AST-Sync 9 files / 81 tests 통과. Spec-Lens의 기존 환경 조건부 GitLab 통합 4 tests skip 포함.
- 산출물 검증: `pnpm --filter @oa-sdk/codegen smoke:pack`의 clean 재빌드·64파일 tarball·소비자 workflow 모두 통과. 앞서 기존 빌드 결과를 검사한 82파일 tarball에는 이전 해시 chunk가 남아 있었으며, 최종 검증은 clean 재빌드 기준이다.
- Type Registry 사전 검토: private helper 1개 추가, 기존 5개 문법 변경, shape/semantic/public surface 변경 0, violations 0. budget·예외 목록은 변경하지 않는다.
- 검토한 변경만 기준선에 반영한 최종 `type-registry:check`는 drift 0, violations 0으로 통과했다.

이 안정화도 앞 절의 emitter·출력 transaction·release 한계를 확장하지 않는다.
위 후속 검증 시점에는 Downstream 전체 테스트·전체 `ci:local`을 재실행하지 않았으며,
이후 격리 검증은 아래에 별도로 기록한다. 공식 release preflight·원격 CI는 실행하지 않았다.
별도 작업 자료 `docs/PROOF-REQUEST.md`와 `proof-output/`는 수정·스테이징하지 않는다.

## 격리 로컬 CI — 2026-10-25

별도 tools·TypeSpec decorators 구현과 검증을 섞지 않도록 사용자 선택에 따라 임시 worktree에서
`020ec128a6c2aa5ee729e6005451a85267752421` + 안정화 파일 13개만 검증했다.
최초 diff SHA-256은 `27f424ce36deaaf9c6bbdfd467e882b93c60ef969ca9e60a944e2f146a08dd66`다.
원래 작업 트리의 별도 변경·proof 자료는 포함하지 않았다.

- 첫 `pnpm ci:local`: 46 gates 중 45 pass / 1 fail / 0 skip. 실패는 Core의 builder watcher 테스트
  `watch() reports TypeSpec compilation failures as event.error` 1개이며 Codegen 4,040 pass / 1 fail이었다.
- Downstream CI 35 tasks, maintenance/internal/integration, schema 검증·rollback, 정책·문서·pack,
  browser smoke, Node 22.23.1·24.20.0·26.10.0 public runtime, Node 26의 TS7, NestJS/FastAPI governance는 통과했다.
- 실패 로그의 성공 결과는 invalid edit가 아닌 준비 단계 `/a` source의 결과였다. readiness를 위한
  반복 쓰기의 늦은 성공 이벤트를 다음 컴파일의 결과로 잘못 선택하던 테스트 경쟁을 수정했다.
- 제품 watcher 코드는 변경하지 않았다. 테스트는 실제 오류 이벤트를 기다리고, 유효한
  `/recovered` source로 바꾸면 성공 이벤트가 다시 오는지도 검사한다. 테스트 빌드는 dry-run으로 제한했다.
- 격리 worktree의 builder suite 12 tests를 10회 반복해 모두 통과했다.
- watcher 테스트 수정을 포함한 14파일 스냅샷으로 전체 `pnpm ci:local`을 다시 실행해
  **46 gates pass / 0 fail / 0 skip**, `LOCAL CI: ALL PASS`를 확인했다. Core 28 tasks,
  Downstream 35 tasks, Codegen 212 files / 4,041 tests, AST-Sync 9 files / 81 tests 통과다.
  gate skip 0은 환경 조건부 테스트 skip이 없다는 뜻이 아니며 기존 Spec-Lens GitLab 4 tests는 skip됐다.
- 재실행 diff SHA-256은 `c377e8f4174ffef445fea8e5b347780f5c0454f2fe8969f325b504a1b3f1376a`다.
  실행 후 원래 작업 트리·격리 worktree의 14개 파일이 실행 전 스냅샷과 일치함을 확인했고,
  그 뒤 이 결과 기록과 todo만 갱신했다. 최초 실패 기록은 보존한다.

원본 evidence는 OpenCode 임시 디렉터리 `oa-stability-ci-tcqdo8dt`에 보존한다:
`snapshot.json`, `stabilization.patch`, `run/local-ci.log`, `watcher-repeat.log`.
재실행 근거는 `snapshot-retry.json`, `stabilization-retry.patch`, `run-retry/local-ci.log`다.
결과는 이 격리 스냅샷에 한정하며 별도 tools·decorators 변경을 포함한 현재 전체 작업 트리의
통합 검증이나 공식 release 승인·원격 CI 결과는 아니다. 추가 커밋·푸시·배포는 하지 않았다.
