# Package Hygiene Decisions

상태: planned (사용자 결정 대기)
최종 검토: 2026-10-05
정본: 범위 경계는 [`platform-scope.md`](./platform-scope.md), release 분류는 [`release-policy.json`](./release-policy.json)

이 문서는 다른 workspace가 의존하지 않는 패키지를 유지·추출·제거할지 판단하기 위한 결정
입력 자료다. 오케스트레이션 결정 D5([`orchestration-handoff.md`](./goals/orchestration-handoff.md))에
따라 이번 단계에서는 문서만 작성하고 코드, package manifest, release policy, CI는 바꾸지 않는다.

**유지·추출·제거의 최종 결정은 사용자가 내린다.** 아래의 "권고"는 조사 결과에 근거한 제안일
뿐이며 결정이 아니다. 사용자가 결정하면 그 내용을 [`platform-scope.md`](./platform-scope.md)의
scope decision 형식(사용자 문제, owner, release/CI, 위치, 종료 조건)으로 기록하고, 실제 변경은
별도 작업으로 수행한다.

workspace 의존자가 없다는 사실만으로는 제거 근거가 되지 않는다. UI binding, CLI, HTTP 서버,
compiler fixture처럼 의존 그래프의 말단에 있는 패키지는 원래 의존자가 없다. 이 문서는 실제
사용자(app, script, CI, 외부 저장소, npm 배포)와 유지 비용을 함께 본다.

## 조사 기준

| 항목 | 확인한 자료 |
| --- | --- |
| 기준 commit | `9f8286ea` (2026-10-05, `main`) |
| workspace 의존 | `packages/*`, `apps/*` 전체 manifest의 `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` |
| tier/track | root `package.json`의 `build/test/typecheck:*` turbo filter, `release-policy.json`의 tracks·`distributionCandidates`·`bulkTaskExcluded`, `.changeset/config.json` |
| manifest 밖 소비자 | `.github/workflows/ci.yml`, `apps/*`, `scripts/*`, root `vitest.config.ts`와 `tests/`, `.vscode/`, `docs/` |
| 외부 소비자 | 로컬에 checkout된 형제 저장소 전체의 `package.json`과 source·docs 검색(`browser-studio`, `mineclover/data-governance` 포함), `oa-sdk-releases`의 export 기록, npm registry 조회 |
| 테스트 비용 | 의존 패키지를 build한 뒤 각 패키지의 `test:ci`를 단독 실행했다. 측정 중 load average가 22~25였으므로 절대값이 아니라 패키지 간 상대 비교로만 쓴다. |
| 규모 | git이 추적하는 파일 기준. source는 테스트 경로 밖의 `.ts/.tsx/.js/.mjs/.tsp/.sql` 파일(설정 파일 포함)이고, test는 테스트 경로 안의 같은 확장자 파일(fixture 포함)이다. 추적 파일보다 설치 비용이 큰 `ttsc-compile-fixture`는 플랫폼별 native binary를 포함한 설치 closure를 함께 적었다. |

## 후보 재검증

2026-10-05 survey의 후보 8개를 manifest로 다시 계산했고 목록이 일치했다.

| Workspace | `private` | Track (`release-policy.json`) | Root tier script | Workspace 의존자 | Manifest 밖 소비자 |
| --- | --- | --- | --- | --- | --- |
| `@oa-sdk/chunk-stream-react` | false | `downstream`, distribution candidate | `*:downstream` | 0 | 확인되지 않음 |
| `@oa-sdk/chunk-stream-timeseries` | false | `downstream`, distribution candidate | `*:downstream` | 0 | 확인되지 않음 |
| `@oa-sdk/mcp-mesh` | false | `downstream`, distribution candidate | `*:downstream` | 0 | 문서만 있음 |
| `@oa-sdk/spec-lens` | true | `corePlatform`, release-tracked, candidate 아님 | `*:core` | 0 | `spec-lens-ui`(HTTP), `check:ts7`, root vitest alias |
| `@oa-sdk/typespec-erd` | true | `maintenance`, ignored | `*:maintenance` | 0 | `.vscode` snippet, data-governance acceptance 절차 |
| `@oa-sdk/typespec-tooling` | true | `maintenance`, ignored | `*:maintenance` | 0 | 확인되지 않음 |
| `@oa-sdk/typia-mock` | true | `maintenance`, ignored | `*:maintenance` | 0 | codegen e2e 문서 assertion |
| `@oa-sdk/ttsc-compile-fixture` | true | `maintenance`, ignored, `bulkTaskExcluded` | 없음 (의도된 제외) | 0 | codegen `compile-check.test.ts`, `check:ts7` |

survey에 없던 `@oa-sdk/dpm`도 workspace 의존자가 없다. 그러나 external owner
`mineclover/data-governance`가 extraction 계약의 정본인 WS-G(Goal 68)에서 다루므로 이 문서에서
제외한다. `apps/*`의 app workspace 4개도 의존자가 없지만 원래 말단이므로 제외한다.

### 제거 시 연쇄 효과

후보를 제거하면 다른 패키지가 새로 의존자 없는 상태가 된다.

| 제거 대상 | 새로 의존자가 없어지는 패키지 |
| --- | --- |
| `mcp-mesh` | `peer-server`, `collab-workspace`, Core `tools` (셋 다 `mcp-mesh`가 유일한 workspace 의존자다). `tools`는 npm `0.1.1`로 배포된 공개 library라 원래 말단이므로 그 자체로 정리 대상은 아니다. `peer-transport`는 `peer-server`의 dependency와 `tools`의 devDependency로 남는다. |
| `typespec-erd` | `logical-erd-contract` |
| `chunk-stream-react` | 없음. `chunk-stream-ui`는 `tools`의 devDependency로 남는다. |
| 나머지 후보 | 없음 |

## 요약

| Package | 규모 (파일 · source/test lines) | 실제 소비자 | 권고 |
| --- | --- | --- | --- |
| `chunk-stream-react` | 11 · 432/168 | 확인된 소비자 없음. npm `0.1.0` 배포됨 | owner와 종료 조건을 명시하고 유지 |
| `chunk-stream-timeseries` | 8 · 517/137 | 확인된 소비자 없음. npm `0.1.0` 배포됨 | owner와 종료 조건을 명시하고 유지 |
| `mcp-mesh` | 19 · 1,350/479 | WebMCP stack의 통합 진입점. 외부 소비자 없음 | 현 상태 유지 (2026-09-22 결정에 owner·종료 조건 있음) |
| `spec-lens` | 55 · 6,074/4,226 | `spec-lens-ui`, TS 7 lane, Core 문서 | 현 상태 유지 |
| `typespec-erd` | 18 · 710/158 | data-governance acceptance gate, IDE snippet | 현 상태 유지 (2026-07-28 결정에 owner·종료 조건 있음) |
| `typespec-tooling` | 11 · 436/70 | 없음. linter 미연결, snippet 사본 drift | 제거. snippet 정본은 `.vscode`로 일원화 |
| `typia-mock` | 14 · 585/668 | 없음 | 제거(archive). owner를 지정하면 추출 |
| `ttsc-compile-fixture` | 1 · manifest 11 lines, 설치 closure 약 210 MB(native binary 포함) | codegen Core 테스트, `check:ts7` | 현 상태 유지. CI 설치 범위 축소는 별도 검토 |

## 패키지별 판단 자료

### `@oa-sdk/chunk-stream-react`

| 항목 | 내용 |
| --- | --- |
| 목적 | `chunk-stream`, `chunk-stream-crdt`, `chunk-stream-ui` 위의 React 18/19 binding. `useChunkStreamStore`, `useChunkPlayback`, `useChunkTelemetry`, `usePlaybackAwareness`를 제공한다. |
| 규모 | 추적 파일 11개, source 8개 432 lines, test 1개 168 lines |
| Tier/release | Downstream Integration, release-tracked, distribution candidate. `oa-sdk-releases`의 `2026-09-22-chunk-stream-v0.1.0`으로 export되었고 npm에 `0.1.0`이 배포되어 있다(registry 수정 시각 2026-09-21T16:39Z). |
| 실제 소비자 | workspace, app, script, CI step, 형제 저장소 어디에도 import나 dependency가 없다. npm 최근 30일 다운로드는 117회지만 mirror·scanner를 포함하므로 사용자 근거로 보지 않는다. |
| 테스트/CI 비용 | 6 tests, vitest 0.56s(happy-dom 환경 포함), `build/typecheck/test:downstream`에 포함된다. `react`, `react-dom`, `happy-dom` devDependency를 유지해야 한다. |
| 마지막 의미 있는 변경 | `692c72e9` (2026-09-22) 최초 추가 이후 변경 없음 |

| 선택지 | 결과 |
| --- | --- |
| 현 상태 유지 | 비용은 작다. 다만 chunk-stream 계열에는 WebMCP 패키지와 달리 기록된 scope decision(owner, 종료 조건)이 없어 소비자 없는 공개 패키지가 무기한 남는다. |
| owner와 종료 조건을 명시하고 유지 | 배포된 `0.1.0`의 지원 책임이 분명해진다. 종료 조건을 넘기면 제거나 추출을 다시 판단할 근거가 생긴다. |
| 별도 저장소로 추출 | leaf 하나만 떼면 `chunk-stream`, `crdt`, `ui`를 외부에서 다시 소비해야 한다. 추출한다면 chunk-stream 계열 전체를 함께 판단해야 하고, 그 경우 Core `tools`도 정리해야 한다. `tools`는 `chunk-stream`, `chunk-stream-ui`를 devDependency로 두고 `src/chunk-stream.ts`에서 `chunk-stream-ui`를 dynamic import하며, build 시 `chunk-stream-ui`와 그것이 쓰는 `chunk-stream`의 dist를 lazy chunk로 번들한다. |
| 제거 | 배포된 버전은 registry에 남으므로 deprecate 공지가 필요하다. release policy, distribution candidate 목록과 `scripts/test-release-policy.ts`, 문서 여러 곳을 함께 고쳐야 한다(아래 "결정 후 작업" 참조). |

**권고: owner와 종료 조건을 명시하고 유지한다.** 이미 npm에 배포된 UI binding이므로 말단인 것이
자연스럽고 유지 비용도 작다. 대신 chunk-stream 계열 전체에 대해 owner(예: OA SDK maintainers)와
종료 조건(예: 다음 chunk-stream minor release까지 repo 안 예제나 외부 소비자가 확인되지 않으면
deprecate와 제거를 다시 판단)을 기록할 것을 제안한다.

### `@oa-sdk/chunk-stream-timeseries`

| 항목 | 내용 |
| --- | --- |
| 목적 | `chunk-stream` 위의 다채널 시계열 telemetry adapter, LTTB downsampling, decimation |
| 규모 | 추적 파일 8개, source 5개 517 lines, test 1개 137 lines |
| Tier/release | Downstream Integration, release-tracked, distribution candidate. `chunk-stream-react`와 같은 release로 npm `0.1.0`이 배포되어 있다. |
| 실제 소비자 | 확인되지 않음. npm 최근 30일 다운로드 97회(사용자 근거로 보지 않음) |
| 테스트/CI 비용 | 5 tests, vitest 0.22s. 외부 runtime dependency 없이 `chunk-stream`에만 의존한다. |
| 마지막 의미 있는 변경 | `692c72e9` (2026-09-22) 최초 추가 이후 변경 없음 |

선택지와 결과는 `chunk-stream-react`와 같다. 다른 점은 React 관련 devDependency가 없어 유지 비용이
더 작다는 것이다.

**권고: owner와 종료 조건을 명시하고 유지한다.** chunk-stream 계열 결정 하나에 함께 기록한다.

### `@oa-sdk/mcp-mesh`

| 항목 | 내용 |
| --- | --- |
| 목적 | domain skill과 여러 runtime session을 등록하고 `{domain}__{tool}` 호출을 검증 후 라우팅하는 라이브러리와 `oa-mesh`/`oa-tools` CLI ([WebMCP 아키텍처](../concepts/webmcp-peering-mesh-and-collab.md)) |
| 규모 | 추적 파일 19개, source 14개 1,350 lines, test 2개 479 lines |
| Tier/release | Downstream Integration, release-tracked, distribution candidate. npm에는 배포되지 않았다(registry 404). |
| 실제 소비자 | workspace·app·script·CI·형제 저장소 소비자는 없다. `tools`, `peer-server`, `peer-transport`, `collab-workspace`를 모두 소비하는 WebMCP stack의 통합 진입점이며, `peer-server`, `collab-workspace`, Core `tools`의 유일한 workspace 의존자다. 반대 방향 결합도 있다. Core `tools`는 `peer-transport`를 `workspace:*` devDependency로 두고 `src/peer.ts`의 `createWebMcpPeerApp`에서 `await import('@oa-sdk/peer-transport')`로 불러오며(실패하면 local bridge 구현으로 fallback), tsup build가 이 import를 `peer-transport` dist의 lazy chunk로 `tools` dist에 번들한다. |
| 테스트/CI 비용 | 12 tests, vitest 0.82s. `*:downstream`에 포함된다. |
| 마지막 의미 있는 변경 | `df77e657` (2026-10-05). git 기록상 최초 commit이지만, 2026-09-22 결정 시점에 이미 미커밋 구현으로 존재했고 D0 정리 때 commit되었다. |

| 선택지 | 결과 |
| --- | --- |
| 현 상태 유지 | [2026-09-22 WebMCP libraries hardening 결정](./platform-scope.md#webmcp-libraries-hardening--2026-09-22)이 owner, release/CI, 위치, 종료 조건을 이미 기록했다. 추가 기록이 필요 없다. |
| owner와 종료 조건을 명시하고 유지 | 위 결정과 중복된다. |
| 별도 저장소로 추출 | `peer-server`, `collab-workspace`가 의존자 없는 상태가 되므로 WebMCP 네 패키지(`mcp-mesh`, `peer-server`, `peer-transport`, `collab-workspace`)를 한 단위로 옮겨야 한다. Core `tools`도 함께 정리해야 한다. `tools`의 `peer-transport` devDependency와 dynamic import를 npm에 배포된 `peer-transport`로 바꾸거나(현재 registry 404이므로 추출 저장소의 배포가 먼저다) 제거해야 하고, 어느 쪽이든 `tools` dist에 번들되던 chunk가 바뀌므로 Core 공개 artifact의 변경으로 다뤄야 한다. |
| 제거 | 같은 연쇄 효과(`tools`의 workspace 의존자 소실 포함)가 생기고, 이미 기록된 사용자 결정(네 패키지를 모노레포에 유지)을 뒤집는다. 네 패키지를 모두 제거한다면 추출과 같은 `tools` 정리가 필요하다. |

**권고: 현 상태 유지.** 의존자가 없는 것은 통합 진입점이라서다. 결정을 바꾼다면 네 패키지와 Core
`tools`의 `peer-transport` 결합을 한 단위로 다룬다.

### `@oa-sdk/spec-lens`

| 항목 | 내용 |
| --- | --- |
| 목적 | spec revision, diff, timeline, provenance와 source 관측. Hono HTTP 서버(기본 포트 4891)와 SQLite cache를 가진 CLI 성격의 도구다 ([사용 가이드](../spec-lens/README.md)). |
| 규모 | 추적 파일 55개, source 36개 6,074 lines, test 15개 4,226 lines |
| Tier/release | Core Platform, release-tracked, distribution candidate 아님, `private: true` |
| 실제 소비자 | `apps/spec-lens`(`@oa-sdk/spec-lens-ui`)가 `spec-lens-contract`로 HTTP API를 소비한다(Vite proxy `/api` → 4891). `scripts/check-ts7.ts`가 TS 7 검사 대상 Core 패키지로 포함한다. root `vitest.config.ts` alias와 `tests/e2e/samchon-improvements`가 `computeTsconfigUniverse`를 import한다(이 테스트를 실행하는 script·CI는 없다). `@oa-sdk/codegen`의 `./spec-lens` subpath는 이 패키지를 위해 존재하며 `check:codegen-boundaries`가 그 경계를 검사한다. `mineclover/data-governance` 문서는 gateway drift 관측 용도로 언급한다. |
| 테스트/CI 비용 | 165 tests(4 skipped), vitest 10.5s로 후보 중 가장 크다. `build/typecheck/test:core`, `check:ts7`, `public-release-runtime` job의 `build:core`에 포함된다. optional native dependency `better-sqlite3`가 있다. |
| 마지막 의미 있는 변경 | `782739b6` (2026-10-05) graph query를 `projectRefGraph`로 전환 |

| 선택지 | 결과 |
| --- | --- |
| 현 상태 유지 | Core Mission의 "변경 이력 관측"을 담당하는 실행 도구로 계속 활발히 바뀌고 있다. |
| owner와 종료 조건을 명시하고 유지 | Core Platform은 기본 투자 범위이므로 별도 종료 조건이 필요 없다. |
| 별도 저장소로 추출 | Core 범위에서 빠지고 `codegen/spec-lens` subpath, `spec-lens-contract`, `spec-lens-ui`까지 함께 옮겨야 한다. scope 변경 결정이다. |
| 제거 | Core Mission의 관측 기능을 잃고 UI app이 쓸모없어진다. |

**권고: 현 상태 유지.** 의존자가 없는 것은 HTTP 서버와 CLI가 그래프의 말단이기 때문이다. 다만
`private: true`이면서 Core release-tracked이고, `bin` 없이 source를 `tsx`로 실행하는 배포 경로는
이 문서와 별개로 정리할 항목이다(아래 "부수 관찰").

### `@oa-sdk/typespec-erd`

| 항목 | 내용 |
| --- | --- |
| 목적 | logical ERD TypeSpec library와 emitter, `oa-sdk.logical-erd.v1` artifact를 다루는 `oa-erd` CLI |
| 규모 | 추적 파일 18개, source 11개 710 lines(예제 `.tsp` 포함), test 2개 158 lines |
| Tier/release | Maintenance-only, ignored, private |
| 실제 소비자 | `mineclover/data-governance`의 logical ERD bridge 계약과 acceptance checklist가 oa-sdk에서 `oa-erd check`/`oa-erd review`를 실행하는 것을 upstream gate로 요구한다(코드 의존이 아닌 절차 의존). `.vscode/typespec.code-snippets`의 ERD snippet이 이 library를 import한다. `logical-erd-contract`의 유일한 의존자다. |
| 테스트/CI 비용 | 4 tests, vitest 3.6s. `test`/`test:ci`가 매번 `pnpm build`(tsc)를 먼저 실행하므로 CI에서 build가 두 번 돈다(측정 wall time 6.1s). |
| 마지막 의미 있는 변경 | source는 `021e78cd` (2026-08-03), 이후 `5ab2dae6` (2026-09-19)의 manifest 수정만 있다. |

| 선택지 | 결과 |
| --- | --- |
| 현 상태 유지 | [2026-07-28 reactivation 결정](./platform-scope.md#typespec-logical-erd-prototype-reactivation--2026-07-28)이 owner와 종료 조건(`oa-sdk.logical-erd.v1` adoption decision)을 이미 기록했다. |
| owner와 종료 조건을 명시하고 유지 | 위 결정과 중복된다. |
| 별도 저장소로 추출 | `logical-erd-contract`와 함께 옮겨야 한다. data-governance로 옮기면 "TypeSpec이 logical intent를 소유하고 DPM은 선택적 소비자"라는 기존 권한 분리와 어긋나므로, 추출한다면 TypeSpec 쪽 별도 저장소가 맞다. |
| 제거 | data-governance acceptance 절차의 upstream gate가 사라지고 `logical-erd-contract`도 의존자를 잃는다. |

**권고: 현 상태 유지.** 외부 저장소가 절차로 소비하고 있고 종료 조건도 이미 기록되어 있다.
`test` script의 중복 build는 비용 개선 후보지만 이번 범위의 코드 변경은 아니다.

### `@oa-sdk/typespec-tooling`

| 항목 | 내용 |
| --- | --- |
| 목적 | TypeSpec IDE 설정 생성 함수, snippet, linter rule 4개(`require-operation-id` 등) |
| 규모 | 추적 파일 11개, source 7개 436 lines, test 1개 70 lines |
| Tier/release | Maintenance-only, ignored, private. 이 패키지에 대한 scope decision 기록은 없다. |
| 실제 소비자 | 확인되지 않음. linter는 `defineLinter`로 정의만 되어 있고 TypeSpec compiler가 읽는 `$lib`/`$linter` export가 없으며, `packages/schemas/typespec/tspconfig.yaml`에도 `linter` 설정이 없다. 확인한 범위에서 rule이 실행되는 경로가 없다. `.vscode/typespec.code-snippets`는 이 패키지에서 생성되지 않은 수동 사본이고 snippet 수가 다르다(`.vscode` 7개, 패키지 10개). `.vscode/settings.json`과 `extensions.json`도 생성 함수를 쓰지 않는다. |
| 테스트/CI 비용 | 6 tests, vitest 0.29s. `test`가 build를 먼저 실행한다(wall time 2.9s). `@typespec/compiler`, `@typespec/openapi` 업그레이드를 따라가야 한다. |
| 마지막 의미 있는 변경 | `4b207041` (2026-09-19) rule과 snippet 추가 |

| 선택지 | 결과 |
| --- | --- |
| 현 상태 유지 | 문서([TypeSpec IDE 설정](../guides/typespec-ide-setup.md) §3.3, [LSP 아키텍처](../guides/typespec-lsp-architecture.md))는 linter가 활성화되어 있다고 설명하지만 실제로는 동작하지 않는 상태가 계속된다. snippet 두 벌도 계속 어긋난다. |
| owner와 종료 조건을 명시하고 유지 | linter를 TypeSpec library로 등록하고 Core인 `schemas` tspconfig에서 켜야 의미가 생긴다. 이는 Core 계약 작성 경로를 바꾸는 기능 작업이므로 별도 scope 결정이 필요하다. |
| 별도 저장소로 추출 | 소비자가 없어 옮길 이유가 없다. |
| 제거 | snippet 정본을 `.vscode/typespec.code-snippets` 하나로 정하고 필요한 snippet(`oa-envelope-ok`, `oa-envelope-paged`, `oa-crud`)을 옮긴 뒤 패키지를 지운다. 두 가이드의 linter 설명도 고쳐야 한다. |

**권고: 제거.** 실제 소비자가 없고 주장하는 기능(IDE linting)이 연결되어 있지 않다. linter를 실제로
쓰고 싶다면 제거 대신 "owner와 종료 조건을 명시하고 유지"를 택하고 linter 연결을 별도 결정으로
진행한다. 어느 쪽이든 가이드의 linter 설명은 현재 사실과 다르다.

### `@oa-sdk/typia-mock`

| 항목 | 내용 |
| --- | --- |
| 목적 | typia `ILlmApplication` 구조와 호환되는 LLM function call 검증 mock HTTP 서버(parse → coerce → validate). typia는 optional peer이며 source는 최소 type stub만 쓴다. |
| 규모 | 추적 파일 14개, source 8개 585 lines, test 파일 3개와 fixture 1개 668 lines |
| Tier/release | Maintenance-only, ignored, private. [release-management.md](./release-management.md)는 "Experiment/archive candidate"로 분류한다. |
| 실제 소비자 | workspace·app·script·CI·형제 저장소 소비자는 없다. 다만 Core 테스트인 `packages/codegen/test/e2e/typia-benchmark-docs.e2e.test.ts`의 F17, T2-F17, T4-03이 `platform-scope.md`에 typia-mock quarantine 설명이 있는지 검사한다. data-governance 문서는 "experiment or archive"로 분류한다. |
| 테스트/CI 비용 | 53 tests, vitest 1.25s. `*:maintenance`에 포함된다. |
| 마지막 의미 있는 변경 | source는 `98ab8258` (2026-04-14) 최초 추가 이후 바뀌지 않았다. 이후에는 `2489b8ee` (2026-08-11) tsup target 한 줄 같은 설정 변경만 있다. |

| 선택지 | 결과 |
| --- | --- |
| 현 상태 유지 | 현재 종료 조건은 외부 `typia-tools`/`samchon-adapter` 저장소 준비인데 그런 저장소와 owner가 없다. 그래서 종료 조건이 충족될 수 없는 상태로 남는다. |
| owner와 종료 조건을 명시하고 유지 | owner를 지정할 수 있을 때만 의미가 있다. |
| 별도 저장소로 추출 | Repository Separation 표의 `typia-adapter` 후보다. 저장소와 owner를 먼저 정해야 한다. 추출 후에도 `core`, `parser`를 외부 패키지로 소비해야 한다. |
| 제거(archive) | git 기록으로 보존된다. `platform-scope.md`의 typia 절, codegen e2e 문서 assertion, release policy와 문서 여러 곳을 함께 고쳐야 한다. |

**권고: 제거(archive).** 6개월 가까이 source 변경이 없고 소비자가 없으며, 종료 조건이 존재하지 않는
저장소에 묶여 있다. 사용자가 `typia-adapter` 저장소의 owner를 지정하면 제거 대신 추출한다.

### `@oa-sdk/ttsc-compile-fixture`

| 항목 | 내용 |
| --- | --- |
| 목적 | TypeScript 7.0.2와 `ttsc` 0.26.0을 workspace의 TS 5.9.3과 격리해 설치하는 fixture ([TypeScript 호환 lane](../guides/typescript-compatibility.md)) |
| 규모 | 추적 파일은 `package.json` 하나(11 lines)지만 설치 closure가 크다. lockfile에서 `ttsc@0.26.0`과 `typescript@7.0.2`를 직접 지정하는 importer는 이 fixture뿐이고, 두 패키지는 플랫폼별 native binary를 optional dependency로 가져온다. darwin-arm64에서 pnpm store 크기를 재면 약 211 MB다: `@ttsc/darwin-arm64` 176 MB(번들된 `go` 실행 파일 137 MB 포함), TS 7 native compiler `@typescript/typescript-darwin-arm64` 26 MB, JS shim `ttsc` 5.1 MB와 `typescript` 3.5 MB. CI runner(ubuntu-latest, linux-x64)에서는 직접 재지 않았고, npm registry의 `dist.unpackedSize`로는 `@ttsc/linux-x64` 180.0 MB, `@typescript/typescript-linux-x64` 27.9 MB, 합계 약 214 MB다. fixture의 `node_modules`만 재면(`du -shL`) JS shim symlink 두 개(8.6 MB)만 잡히므로 native binary 패키지를 따로 더해야 한다. |
| Tier/release | Maintenance-only, ignored, `bulkTaskExcluded`. task script가 없어 tier filter에서 빠지는 것이 의도이며, `check:release-policy`가 이 제외를 강제한다. |
| 실제 소비자 | manifest가 아니라 경로로 소비된다. `packages/codegen/src/__tests__/typegen/compile-check.test.ts`가 fixture 경로에서 `ttsc`와 TS 7을 resolve해 같은 생성 타입을 workspace `tsc`와 `ttsc`로 함께 검증한다. root `pnpm check:ts7`은 `scripts/check-ts7.ts`(Core 패키지 source를 fixture의 `ttsc`로 검사)를 실행한 뒤 `codegen test:ts7`로 이 compile-check 파일을 실행한다. 따라서 CI에서 compile-check는 두 번 돈다. 한 번은 `ci` job(Node 24)의 `test:core:ci`(codegen `test:ci`가 전체 vitest를 실행)이고, 다른 한 번은 `typescript-7-current` job(Node 26)의 `check:ts7`이다. 이와 별개로 lockfile에서 `packages/schemas`의 `vitest` → `msw` optional peer `typescript`가 `typescript@7.0.2`로 해석되어 있어, fixture를 제거하거나 설치에서 빼면 이 해석도 함께 바뀐다. |
| 테스트/CI 비용 | 자체 테스트는 없다. 소비 테스트 `codegen test:ts7`이 3 tests, vitest 3.9s이고, CI에서는 위처럼 `ci`와 `typescript-7-current`에서 한 번씩 돈다. 주된 유지 비용은 설치다. `.github/workflows/ci.yml`의 job 4개(`ci`, Node 22/24/26 matrix인 `public-release-runtime`, `typescript-7-current`, `governance-references`)가 모두 root에서 `pnpm install --frozen-lockfile`을 실행하므로, matrix를 펼친 job 6개가 CI run마다 이 closure를 설치한다. 이 중 fixture를 쓰는 것은 `ci`(`test:core:ci`의 compile-check)와 `typescript-7-current`(`check:ts7`) 두 job뿐이다. `actions/setup-node`의 `cache: pnpm`이 pnpm store를 캐시하므로 cache 크기와 복원 시간에도 포함되고, 로컬 개발자 설치도 같은 closure를 받는다. |
| 마지막 의미 있는 변경 | `2489b8ee` (2026-08-11) `ttsc` 0.22.0 → 0.26.0 |

| 선택지 | 결과 |
| --- | --- |
| 현 상태 유지 | Core 테스트와 TS 7 CI job이 계속 동작한다. 약 210 MB 설치가 fixture를 쓰지 않는 job 4개(matrix를 펼친 기준)를 포함한 모든 job에서 계속된다. |
| owner와 종료 조건을 명시하고 유지 | [typescript-compatibility.md](../guides/typescript-compatibility.md)가 이미 책임과 갱신 절차를 정의한다. |
| 유지하되 설치 범위 축소 | TS 7 lane 설치를 필요한 job으로 한정한다. 두 단계로 나눌 수 있다. 첫째, fixture를 쓰지 않는 `public-release-runtime`(matrix 3개)과 `governance-references`에서 pnpm filter 등으로 fixture importer를 설치 대상에서 빼는 것은 workflow 변경만으로 되고 테스트 코드는 바꾸지 않는다. 둘째, `ci` job에서도 빼면 TS 7 closure는 `typescript-7-current` job에서만 설치된다. `typescript-7-current`가 이미 `check:ts7`로 같은 compile-check를 실행하므로, 이 단계는 TS 7 검증의 위치를 옮기는 것이 아니라 `ci`의 중복 실행을 없애는 것이다. 남는 차이는 두 가지다. ttsc 검증이 Node 24에서는 더 이상 돌지 않고 Node 26에서만 돈다. 또 `typescript-7-current`는 `needs: ci`라 `ci`가 성공한 뒤에만 돌므로 ttsc 실패가 더 늦게 드러난다. compile-check는 module 로드 시점에 fixture에서 `ttsc`를 resolve하므로, fixture가 없을 때 ttsc 쪽 검증만 건너뛰고 `tsc` 검증은 유지하도록 바꾸는 코드 변경이 필요하다. `check:ts7`의 첫 단계인 `scripts/check-ts7.ts`는 fixture에서 `ttsc`를 resolve하지 못하면 실패하므로, `typescript-7-current`에서 ttsc 검증이 조용히 건너뛰어지지는 않는다. `schemas`의 `typescript@7.0.2` peer 해석 때문에 TS 7 패키지 일부는 계속 설치될 수 있으므로, 적용할 때 실제 설치 결과를 확인해야 한다. |
| 별도 저장소로 추출 | 경로 기반 resolve가 깨지고, 격리 목적(TS 5 `node_modules/.bin/tsc`를 덮어쓰지 않기)을 다른 방식으로 다시 구현해야 한다. |
| 제거 | `test:core:ci`의 compile-check와 `typescript-7-current` job이 실패한다. |

**권고: 패키지는 현 상태 유지.** tier에 속하지 않는 것은 설계상 의도이고, manifest에 보이지 않는 Core
소비자가 있다. 다만 이 패키지의 주된 비용은 테스트가 아니라 모든 CI job의 약 210 MB 설치이므로,
"유지하되 설치 범위 축소"를 별도 CI 개선 후보로 기록할 것을 제안한다. TS 7 compile-check는 이미
`typescript-7-current`에서도 돌기 때문에 TS 7 보장이 사라지지는 않는다. `ci`에서 빼면 Node 24의 ttsc 검증과
`ci` 단계의 조기 실패 신호가 줄어드는 대가가 있을 뿐이다. 다만 CI workflow와 테스트 코드를 바꾸는 작업이라
문서만 다루는 이번 범위에서는 수행하지 않는다.

## 결정 후 작업

이 절은 사용자가 제거나 추출을 고른 경우에 필요한 변경 범위다. 이번 작업에서는 수행하지 않는다.

- `docs/internal/release-policy.json`의 tracks, `releaseTracked`/`ignored`, `distributionCandidates`,
  `bulkTaskExcluded`와 `.changeset/config.json`
- root `package.json`의 `build/test/typecheck:*` filter. `pnpm check:release-policy`가 track과 정확히 일치하는지 검사한다.
- [release-management.md](./release-management.md)의 정책 스냅샷 문장과 package 표(같은 검사 대상),
  distribution candidate라면 `scripts/test-release-policy.ts`의 기대 목록
- [platform-scope.md](./platform-scope.md)의 tier 표와 결정 기록, [architecture/packages.md](./architecture/packages.md),
  [spec.md](./spec.md), [api-index.md](./api-index.md), [feature-test-matrix.md](./feature-test-matrix.md)와 JSON
  (`pnpm check:feature-tests`)
- [library-entrypoints.md](../guides/library-entrypoints.md). `pnpm check:docs`의 package entrypoint gate가 workspace 목록과 대조한다.
- root `README.md`, `.agents/skills/` 문서, `pnpm-lock.yaml`
- [`type-registry-baseline.json`](./type-registry-baseline.json)과 [`type-registry-policy.json`](./type-registry-policy.json).
  제거나 추출로 TypeScript source가 사라지면 baseline drift가 되어 CI `ci` job의 `pnpm type-registry:check`가
  실패한다. [Type Registry governance](./type-registry-governance.md)는 drift를 검토한 뒤 같은 변경에서
  `pnpm type-registry:write`로 baseline을 다시 쓰고, boundary가 사라지면 policy의 budget ceiling
  (`boundaryBudgets[].maximum`)도 같은 변경에서 낮추도록 요구한다. policy를 바꾸면 policy hash drift로 같은
  검토에 들어간다.
  - **선행 조건: 기존 budget 초과 해소.** `type-registry:write`는 policy gate가 하나라도 실패하면 baseline
    쓰기를 거부한다(`scripts/type-registry-governance-lib.ts`의 `Refusing to write a failing Type Registry baseline`).
    기준 commit에서는 budget 3종이 이미 초과되어 있으므로(아래 "부수 관찰"), 어떤 후보를 제거하거나 추출해도
    그 변경만으로는 baseline을 다시 쓸 수 없다. TypeScript source가 있는 후보 7개의 boundary를 모두 빼도 `any`는 223에서 206이
    되어 ceiling 183을 넘고, 후보에는 double-assertion이 없어 47/38은 그대로다. 아래의 함께 다룰 패키지까지 모두
    빼도 `any` 195/183, double-assertion 42/38로 여전히 초과한다. 따라서 기존 초과를 source 수정이나
    `type-registry-policy.json`의 검토된 budget 변경으로 먼저 해소하고, 기존 baseline drift(added 352 등)도 따로
    검토해 baseline을 갱신하는 별도 작업이 모든 제거·추출의 선행 조건이다. 이 순서를 지키지 않으면 baseline
    재작성 때 무관한 변경이 함께 승인된다.
  - **후보별로 사라지는 boundary.** 기준 commit snapshot의 `boundaryEvidence`를 package별로 센 값이다.
    `spec-lens` unvalidated-deserialize 25(추출 시 함께 옮길 `spec-lens-ui`는 `any` 2, deserialize 2,
    `spec-lens-contract`는 0), `typespec-erd` deserialize 2(함께 다룰 `logical-erd-contract`는 deserialize 1,
    double-assertion 1), `typespec-tooling` `any` 4, `typia-mock` deserialize 1, `mcp-mesh` `any` 13과
    deserialize 1(네 패키지를 함께 다루면 `peer-server` `any` 4·deserialize 2·double-assertion 2,
    `peer-transport` `any` 5·deserialize 2·double-assertion 2, `collab-workspace` 0이 더해진다)이다.
    `chunk-stream-react`, `chunk-stream-timeseries`는 0이다. 선행 작업으로 budget이 통과하게 된 뒤, 제거하는
    변경에서 해당 ceiling을 이 수만큼 낮춘다.
  - **baseline 항목.** 기준 commit의 baseline에 항목이 있는 후보는 `spec-lens`, `typespec-erd`, `typespec-tooling`,
    `typia-mock`이고, `typespec-erd`를 제거하거나 추출하면 `logical-erd-contract` 항목도 바뀐다.
    `chunk-stream-react`, `chunk-stream-timeseries`, `mcp-mesh`는 아직 baseline에 없지만, 선행 작업으로 baseline에
    들어간 뒤에는 같은 절차가 필요하다. 이 세 패키지의 boundary는 baseline과 관계없이 지금도 budget 집계에
    들어간다. `ttsc-compile-fixture`는 TypeScript source가 없어 해당하지 않는다.
- npm에 배포된 패키지(`chunk-stream-react`, `chunk-stream-timeseries`)는 배포된 버전이 남으므로 `oa-sdk-releases` 쪽에서 deprecate 공지를 함께 결정한다.
- 결정 내용은 [platform-scope.md](./platform-scope.md)에 기록하고, 이 문서의 상태를 결정 결과에 맞게 갱신한다.

## 부수 관찰

결정과 별개로 확인된 문서·설정 drift다. 이번 작업에서는 고치지 않았다.

| 관찰 | 근거 |
| --- | --- |
| IDE 가이드가 `typespec-tooling` linter가 활성화되어 있다고 설명하지만 연결 경로가 없다. | `typespec-ide-setup.md` §3.3, `typespec-lsp-architecture.md`, `packages/schemas/typespec/tspconfig.yaml` |
| `.vscode/typespec.code-snippets`와 `typespec-tooling` snippet이 서로 다르다. | `.vscode` 7개, 패키지 10개 |
| `spec-lens`는 `private: true`인 Core release-tracked 패키지이고 `bin`이 없어 배포 경로가 정해져 있지 않다. | `packages/spec-lens/package.json`, [release-readiness.md](./release-readiness.md)의 non-candidate 표 |
| typia-mock 종료 조건의 저장소 이름이 문서 안에서 다르다. | `platform-scope.md`의 typia 표(`typia-tools`/`samchon-adapter`)와 Repository Separation 표(`typia-adapter`) |
| Maintenance 패키지 설명이 Core codegen e2e 테스트의 문서 assertion에 묶여 있다. | `typia-benchmark-docs.e2e.test.ts` F17, T2-F17, T4-03 |
| root vitest의 `@oa-sdk/spec-lens` alias를 쓰는 `tests/e2e/samchon-improvements`를 실행하는 script나 CI step이 없다. | root `package.json`의 `test:e2e`는 `tests/e2e/typespec-ecosystem`만 실행한다. |
| 기준 commit에서 `pnpm type-registry:check`가 이미 실패한다. baseline이 2026-09-20 이후 갱신되지 않아 `chunk-stream` 계열 5개, WebMCP 4개, `surface-ir`의 source가 baseline에 없고(added 352, removed 2, semantic 22 등), boundary budget 3종도 초과한다(`any` 223/183, double-assertion 47/38, unvalidated-deserialize 142/121). budget 초과가 남아 있는 동안 `pnpm type-registry:write`는 baseline 쓰기를 거부하므로, drift 검토만으로는 gate를 되돌릴 수 없다. | baseline 마지막 변경 `949bf77c`(2026-09-20), 2026-10-05 `scripts/type-registry-governance.ts --output-dir <임시 경로>` 실행 결과(exit 1) |
| `ttsc-compile-fixture`의 약 210 MB TS 7 closure를 fixture를 쓰지 않는 CI job도 설치한다. 또 TS 7 compile-check가 `ci`와 `typescript-7-current`에서 중복 실행된다. | `.github/workflows/ci.yml`의 job별 `pnpm install --frozen-lockfile`, `pnpm-lock.yaml`의 `packages/ttsc-compile-fixture` importer, root `check:ts7`과 codegen `test:ts7`·`test:ci` script |
