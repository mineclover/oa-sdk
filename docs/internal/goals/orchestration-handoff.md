# 오케스트레이션 핸드오프 — 2026-10-05

이 문서는 oa-sdk 남은 작업 전체를 관제하는 오케스트레이션 세션의 진입점이다.
오케스트레이터는 직접 구현하지 않고 아래를 맡는다.

- 작업 스트림(workstream)을 worker 세션에 분배한다.
- 사용자 결정이 필요한 항목을 모아 묻는다.
- 파일 충돌과 머지 순서를 관리한다.
- 결과를 로드맵 정본에 반영한다.

정본 우선순위는 다음과 같다.

| 무엇 | 정본 |
|---|---|
| 제품 범위, Core/Downstream 경계 | [`../platform-scope.md`](../platform-scope.md) |
| goal 목록과 상태 | [`README.md`](./README.md), [`progress-index.md`](./progress-index.md) |
| Goal 69 (parser 성능), Goal 70 (Sirius Web) | [`goal-69-…`](./goal-69-parser-ref-expansion-performance.md), [`goal-70-…`](./goal-70-sirius-web-studio-integration.md) |
| 이 문서 | 위 문서 사이의 남은 일, 결정 대기, 충돌, 실행 순서 |

이 문서와 정본이 다르면 정본이 맞다. 작업이 끝나면 정본을 먼저 갱신하고 이 문서는 그 다음에 맞춘다.

## 1. 현재 스냅샷

- 브랜치는 `main`이고 원격 push는 하지 않았다. HEAD는 `3afc3095`이다.
- 2026-10-05에 들어간 커밋은 다음과 같다.

| 커밋 | 내용 |
|---|---|
| `2b94dfa6` feat(parser) | `$ref` 전개 메모, 재귀 스키마 허용 규칙(`recursion-guard.ts`), 선형 완전성 검사 |
| `f63ece9a` perf(codegen) | `oa-gen generate`가 대상 스펙당 한 번만 파싱 |
| `8aaa8afd` chore(bench) | `pnpm bench:parser` 예산 기반 회귀 게이트 |
| `4324a81f` docs(goals) | Goal 69/70 등록, Goal 65 순환 조항 개정 |
| `01334ab1` perf(parser) | `resolveRefGraph`가 occurrence당 노드 하나만 기록하고, 순환 진단은 SCC로 판정 |
| `782739b6` feat(parser) | `projectRefGraph`(ref 보존 그래프) 추가, spec-lens 그래프에 적용 |
| `3afc3095` docs(goals) | 69.5b, 69.7 결과 기록 |

- **Goal 69는 모든 unit(69.1~69.7)이 완료됐다.** downstream 성능 항목만 결정 대기로 남아 있다.
- **진행 중인 세션은 하나다.**

| 세션 | 작업 | 상태 |
|---|---|---|
| task `task_3f88f37b` (별도 worktree) | `oa-gen audit:csp` e2e 타임아웃 안정화 (WS-A) | 실행 중 |

## 2. 불변 규칙 (모든 worker에게 전달)

1. **정본은 TypeSpec이다** (ADR-009).
   - 정본 위치는 `packages/schemas/typespec/*.tsp`이다.
   - `.merged*.yaml`, `dist/`, 스냅샷은 손으로 수정하지 않는다.
2. **범위 규칙** (`platform-scope.md`): Core Platform 11개 패키지 밖의 신규 기능은 착수 전에 scope-reactivation decision이 기록돼 있어야 한다.
   - Core Platform 11개: core, openapi-projection-contract, typespec-decorators, schemas, parser, surface-ir, codegen, spec-lens, spec-lens-contract, ast-sync, tools
   - 버그처럼 보여도 새 capability를 추가하면 feature로 분류한다.
   - Core 변경을 따라가기 위해 필요한 호환성 수정은 downstream에서도 허용한다.
3. **파서 출력은 DAG다** (Goal 69 계약).
   - `parseDocument` 결과는 하위 객체를 공유한다.
   - 새 소비자는 전역 `seen` 집합이 아니라 조상 경로 기준으로 순환을 막아야 한다.
   - 출력을 직접 고치지 않는다.
4. **재귀 규칙**: 재귀 스키마인지는 `recursion-guard.ts` 한 곳에서만 정의한다. parse와 lint가 이 정의를 공유하므로 둘이 판정이 갈리게 바꾸지 않는다.
5. **커밋 규칙**
   - 주제별 conventional commit으로 나눈다. 예: `feat(parser):`, `perf(codegen):`, `docs(goals):`
   - 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다.
   - 사용자가 요청할 때만 커밋한다. push는 별도 승인을 받는다.
6. **기존 미커밋 변경은 건드리지 않는다** (3절).
   - 섞인 파일은 hunk 단위로 골라 스테이징한다(`git apply --cached`).
   - 대화형 `git add -p`는 쓸 수 없다.

## 3. 워킹트리의 기존 미커밋 변경 (소유자 미확인)

이번 작업 전부터 워킹트리에 미커밋 변경 75개가 있었다. 소유자와 의도가 확인되지 않았다.

- 이 변경들은 아무 커밋에도 포함하지 않았다.
- worker의 worktree는 HEAD에서 만들어지므로 이 변경을 보지 못한다. 그래서 머지할 때 충돌이 날 수 있다.

| 영역 | 파일 | 충돌하는 workstream |
|---|---|---|
| codegen e2e 테스트 | `packages/codegen/src/__tests__/e2e/tier1~4*.test.ts`, `subdirectory-conformance.test.ts`, `challenger-m4-*.test.ts` | **WS-A (실행 중)** |
| codegen CLI | `cli/commands.ts`, `cli/spec/oa-gen-governance.ts`, `docs/cli-spec/oa-gen.governance.json`, `package.json` | WS-C4 |
| mock-server 어댑터 | `src/adapters/node-http.ts`, `src/adapters/msw.ts`, `package.json` | WS-C1 |
| tools | `packages/tools/src/*`, `test/*`, `README.md`, `package.json` | (현재 없음) |
| CI·릴리스 | `.github/workflows/ci.yml`, `docs/internal/release-*.md`, `release-policy.json`, `scripts/check-release-policy.ts`, `scripts/test-release-policy.ts` | WS-D, WS-H |
| 범위 문서 | `docs/internal/platform-scope.md`, `spec.md`, `docs/internal/goals/README.md`(범위 문단만), 루트 `package.json`(build/test tier 필터에 surface-ir 등 추가) | 결정 기록이 필요한 모든 WS |
| 기타 | `apps/playground/*`, `docs/guides/*`, `README.md`, `.agents/skills/*`, `pnpm-lock.yaml`, `references/bun-graph-db`, `packages/parser/src/__tests__/schema-loader.test.ts` | WS-E2 (`schema-loader.test.ts`) |

**오케스트레이터의 첫 과제 (Wave 0)**: 사용자에게 이 변경의 처리 방침을 받는다.

- 선택지는 두 가지다: 주제별 커밋, 또는 소유 세션에 반환.
- 처리 전에는 위 표에서 충돌하는 workstream을 착수하지 않거나, 머지 순서를 미리 정해 둔다.

## 4. Workstream 목록

상태 범례:
- `running`: 실행 중
- `ready`: 결정 없이 착수 가능
- `decision`: 사용자 결정 대기
- `blocked`: 선행 작업 대기

### WS-A — `oa-gen audit:csp` e2e 타임아웃 안정화 · A1 `done`, A2·A3 `ready`

- **문제**: 전체 codegen 테스트를 돌릴 때마다 `audit:csp` 하위 프로세스 테스트 3~6개가 30~60초 타임아웃 또는 exit 143으로 실패했다.
  - 실패 조건은 호스트 부하 평균이 10을 넘는 경우다.
  - 같은 테스트를 단독으로 재실행하면 통과한다.
- **원인**: TS 로드(약 0.1초)나 CLI 기동(약 0.33초)이 아니라 스캔 자체였다. browser-studio `dist/guards`(264개 파일, 73 MB)를 파일마다 전체 AST + 부모 포인터로 파싱하느라 약 5.5초가 걸렸다.

| 단위 | 내용 | 상태 |
|---|---|---|
| A1 | 어휘 사전 검사(`mayContainCspViolation`)로 위반이 불가능한 파일의 파싱을 건너뛰고, TS를 지연 로드하고, `setParentNodes`를 끈다. dist 기준 약 6.2초 → 1.6초, 264개 중 263개 파일이 파싱을 건너뛴다. 하위 프로세스 테스트 자체는 바꾸지 않았다(실제 CLI를 바깥에서 실행하는 것이 목적). | **done** (`1d63b225`) |
| A2 | **부하 상태 검증 미완.** A1 커밋 시점까지 load average 11 이상에서 돌린 `packages/codegen` 전체 스위트 결과가 나오지 않았다. 원래 실패하던 tier4, subdirectory-conformance, challenger-m4 테스트가 부하 상태에서 통과하는지 확인한다. 통과하지 않으면 원인(스캔 / 기동 / 테스트 타임아웃 예산)을 분류해 고친다. | ready |
| A3 | **사전 검사와 규칙의 이중 관리 제거.** 사전 검사의 단어 목록(`eval`/`Function`/`setTimeout`/`setInterval`, `ajv`/`zod`/`@oa-sdk`)과 AST 규칙의 대상(`target === 'eval'`, `DISALLOWED_IMPORT_PATTERN`)이 따로 적혀 있어, 규칙을 추가하면서 사전 검사를 빠뜨리면 위반이 조용히 누락된다. 규칙 표 하나에서 AST 검사와 사전 검사를 함께 도출하고, 모든 `CspRuleId`에 사전 검사 회귀 사례가 있는지 타입 수준에서 강제한다. | ready |
| A4 | A2 측정 결과, 부하 40 이상·swap 고갈 상태에서는 tsx CLI를 5번 이상 순차 실행하는 테스트(T1-F02-3, T3-06, T4-03, challenger-m3 "non-object valid JSON" 등)가 60초 예산을 넘는다. 원인은 실행마다 CLI 모듈 약 950개를 즉시 로드하는 것이다. `src/cli/commands.ts`를 지연 command registry로 바꿔 실행한 명령만 로드한다. CLI 사용자 체감 속도도 함께 개선된다. C4·E3와 같은 파일을 만지므로 Wave 1 통합 뒤에 한다. | ready (Wave 1 이후) |

### WS-B — Goal 70 Sirius Web 통합 · `decision`

- **필요한 결정**: Goal 70을 진행할지에 대한 scope decision과 Sirius 저장소 소유자.
  - Sirius 쪽은 Java로 작성하며 이 모노레포 밖에 둔다.
  - oa-sdk 쪽 변경은 Core 패키지(parser, codegen, spec-lens-contract, ast-sync, tools) 안에 머문다.
- **결정 기록 형식**: `platform-scope.md`의 Scope Reactivation Decision 형식(사용자 문제 / Core 관계 / 소유자·CI / 위치 / 종료 조건)을 Goal 70 문서에 남긴다.
- **승인 후 Phase A 분해안**:

| 단위 | 내용 | 위치 |
|---|---|---|
| B1 | `projectRefGraph` 결과를 버전이 붙은 산출물(예: `oa-sdk.ref-projection.v1` JSON)로 내보내는 `oa-gen` 명령을 만든다. 스키마 계약과 테스트를 포함한다. | codegen, parser |
| B2 | 노드 id를 provenance `canonicalId`에 매핑한다. spec-lens `nearestCanonicalId` 로직을 공용 함수로 승격한다. 이 id가 Sirius 레이아웃 키가 된다. | parser 또는 codegen, spec-lens |
| B3 | Sirius Web importer를 만든다. EMF 모델로 매핑하고, `sirius-components-view-builder`로 다이어그램과 테이블 View를 정의한다. | 별도 Java 저장소 |
| B4 | 결정 게이트: 같은 사용 사례를 `apps/spec-lens`(React + d3) 확장으로 처리할 때와 비교한다. 모델 단위 편집이나 다중 표기법이 필요할 때만 Phase B로 간다. | 문서 |

- **Phase B (편집 제안)**:
  - TypeSpec용 span `TextEdit` 어댑터를 만든다(ast-sync 확장).
  - `defineTool`로 편집 API를 노출한다.
  - 결과는 git 브랜치로 남기고 `schema:typespec-check`, provenance 검사, `tsp diff`로 다시 검증한다.
  - B4 이후에 분해한다.

### WS-C — Downstream 성능·정확성 · `decision` (C4만 `ready`)

| 단위 | 문제 (근거) | 범위 | 상태 |
|---|---|---|---|
| C1 | mock-server가 요청마다 응답 본문을 다시 생성하고 Ajv로 다시 검증한다(`core/media-body.ts:46`, `handler.ts:151,183`). 그래서 `node-http.ts`의 사전 계산 fast path가 사실상 쓰이지 않는다. `allowedHeadersCache` 키가 구체 URL이라 끝없이 커진다(`node-http.ts:283`). 생성기가 선택 속성까지 모두 접은 뒤 버린다(`core/generate.ts:44`). | mock-server | decision. `node-http.ts`가 미커밋 변경과 충돌 |
| C2 | `route-match.ts:62-86`이 요청마다 모든 라우트 정규식을 검사한다. 정적 경로 Map과 세그먼트 trie가 필요하다. | parser(Core) 파일이지만 mock-server 런타임 성능 문제 | **ready**로 볼 수 있음. 파일이 Core에 있으므로 사용자 확인 권장 |
| C3 | 생성된 client가 호출마다 `JSON.parse("…")`로 스키마를 다시 만들고(`generate-client-renderer.ts:126`), 검사마다 `new RegExp`를 만든다(`runtime-schema.ts:82`). 스키마를 모듈 상수로 빼고 정규식을 캐시해야 한다. | client | decision |
| C4 | codegen이 `@oa-sdk/client`, `router`, `mock-server`를 devDependencies로 두고(`codegen/package.json:86-88`) `oa-gen generate`에서 동적 import한다. 그래서 배포된 패키지에서는 경고만 남기고 산출물을 건너뛴다. optional peer dependency 또는 플러그인 인터페이스로 바꿔야 한다. | codegen(Core) 배포 버그 | **ready**. `codegen/package.json`이 미커밋 변경과 충돌 |

### WS-D — CI·빌드 파이프라인 · D1 `done`, D2 `ready`

결정 D4 범위(로컬 캐시 + artifact 공유 + inputs + `bench:parser` 게이트)만 다룬다. 원격 캐시와 테스트 병렬화는 하지 않는다.

| 단위 | 내용 | 상태 |
|---|---|---|
| D1 (+E6) | `ci` job이 `.turbo/cache`를 복원·저장하고, 한 번 빌드한 dist를 `workspace-build-outputs` artifact로 `public-release-runtime` ×3, `typescript-7-current`, `governance-references`에 넘긴다. turbo inputs는 `$TURBO_DEFAULT$`로 바꿔 `tsup.config.ts`, `package.json` 등을 키에 포함한다. mock-server CI smoke는 turbo가 만든 빌드를 재사용한다. `bench:parser`는 needs가 없는 별도 `parser-bench` job에서 CPU 시간·고정 seed 셔플·round별 비율 median으로 판정한다(부하 21-40에서 8/8 통과, 이전 스크립트는 4/8 실패). | **done** (`a58fb935`..`16684c41`) |
| D2 | 리뷰 잔여(low): (1) `build.inputs`의 `$TURBO_DEFAULT$`가 tsup 패키지의 테스트 파일까지 빌드 키에 넣어 테스트만 고쳐도 빌드 캐시가 깨진다(codegen 355개 입력 중 174개가 테스트). tsc로 테스트까지 emit하는 5개 workspace만 전체 입력을 유지한다. (2) `test:ci`를 turbo 밖에서 직접 돌리면 mock-server smoke가 오래된 dist로 통과할 수 있다. | ready |

- **남은 위험**: GitHub runner에서 아직 한 번도 돌리지 않았다. cache·artifact 동작, `BENCH_PARSER_BUDGET_SCALE=2` 가정, hosted runner의 CPU 시간 정확도는 첫 CI 실행에서 확인한다.

### WS-E — Core 정리 · E1·E5·E6 `done`, 나머지 진행 중

| 단위 | 내용 | 상태 |
|---|---|---|
| E1 | JSON Pointer escape/unescape 사본 38곳을 `parser/src/json-pointer.ts`의 공용 helper(`escapeJsonPointerToken`, `unescapeJsonPointerToken`, `appendJsonPointer`, `formatJsonPointer`, `parseJsonPointer`)로 통일했다. `@oa-sdk/parser`와 `/browser` 양쪽에서 export한다. 교체한 사본은 모두 RFC 6901 순서가 맞아 출력은 바뀌지 않는다. 별도로 spec-lens timeline이 `#/paths/~1users`를 `//users`로 디코드하던 버그를 고쳤다. | **done** (`05124488`..`6ea63d46`, `896ca666`) |
| E1-r | E1 잔여: (1) schemas scripts는 CommonJS로 실행되는데 parser exports에 `import` 조건만 있어 helper를 쓸 수 없다. schemas를 ESM으로 바꿀지, parser에 `default` 조건을 추가할지 결정이 필요하다. (2) 루트 scripts(`schema-typespec-check.ts`, `typespec-create-authored-canonical-fixture.ts`)는 helper import로 바꿀 수 있다. (3) `personas/src/resolver.ts`는 unescape를 하지 않아 이름에 `/`·`~`가 든 ref를 못 푼다(maintenance-only). | decision (1), ready (2), maintenance (3) |
| E2 | `loadSchema`를 parse-core의 공용 route-index builder 위로 다시 만든다. webhooks, `additionalOperations`, `x-` 확장, `$ref` 파라미터를 맞춘다. | 진행 중 (3차 리뷰 지적: Reference Object sibling overlay를 OAS 3.2대로 `summary`/`description`만 허용) |
| E3 | `--incremental`이 dirty 집합으로 typegen 작업을 건너뛰게 하고, 파일 해시를 한 번만 계산한다. | 진행 중 |
| E4 | DAG 입력에서 전역 identity `seen` 집합이 두 번째 위치를 건너뛰는 곳을 찾아 고친다. | 진행 중 |
| E5 | `$ref` 순환 판정을 (문서, pointer) 키로 바꿔 외부 문서의 내부 ref가 진입 문서와 키를 공유하지 않게 했다. `preserve-ref`가 남기는 재귀 절단 ref는 진입 문서 기준으로 표기한다. | **done** (`c42dd12a`..`e88ef9df`) |
| E6 | `bench:parser` CI 게이트 | **done** (WS-D D1과 함께) |
| E7 | deref pass는 Reference Object 위치(parameter, requestBody, response, callback)에서 sibling을 모두 덮어쓴다. OAS 3.2는 `summary`/`description`만 허용한다. Schema Object 위치는 JSON Schema 의미대로 sibling을 유지하고, Reference Object 위치만 제한하는 위치 인지 overlay가 필요하다. E2가 route-index builder를 OAS 3.2에 맞추면 deref 경로와 비-deref 경로의 결과가 갈리므로 E2 다음에 처리한다. | ready (E2 이후) |

### WS-F — 패키지 위생 · 결정 입력 문서 `done`, 최종 결정은 사용자

- [`../package-hygiene-decisions.md`](../package-hygiene-decisions.md)에 무의존 workspace별 목적, 크기, tier, 실제 소비자(외부 저장소 포함), CI 비용, 선택지와 권장안을 정리했다(`7995a3d7`..`4701eaad`). 코드·manifest·정책은 바꾸지 않았다.
- 어떤 제거·추출도 WS-H(type-registry 게이트 복구)가 먼저 끝나야 한다. 후보를 모두 빼도 boundary 예산 초과가 남기 때문이다.

### WS-H — type-registry 게이트 복구 · 위반 해소 `done`, baseline 갱신은 사용자 승인 대기

- **문제**: main에서 `pnpm type-registry:check`(CI `ci` job gate)가 boundary 예산 3종 초과로 실패했다: `any` 223/183, double-assertion 47/38, unvalidated-deserialize 142/121.
- **원인**: 2026-10-05에 주제별로 커밋한 기존 작업(peer 패키지 4종, surface-ir, tools 보안 강화, chunk-stream 계열)이 baseline에 없던 선언과 boundary를 들여왔다.
- **결과**: 예산·정책·allowlist는 그대로 두고 source를 고쳐 136/183, 30/38, 113/121로 되돌렸다(위반 0). tools·peer-transport·peer-server·mcp-mesh·chunk-stream·client·spec-lens·typespec-erd 등에서 MCP/REST/peer 입력, 저장소 파일, 설정 파일을 이름 있는 스키마로 검증한다. 리뷰에서 나온 회귀 6건(personas 술어 비교, null stream body, `params: null`, peer-server 도구 메타데이터 유실, `allowedTools` fail-open, typia-mock 오류 분류)도 고쳤다. 커밋 33개, 리뷰 승인.
- **동작 변화(잘못된 입력만)**: 잘못된 `allowedTools`는 빈 허용 목록으로 처리한다(fail closed). spec-lens 설정은 CLI가 읽는 키만 검증하고, 알 수 없는 `source`는 거부한다. preview는 잘못된 헤더를 조용히 버리지 않고 오류를 표시한다. preview 앱이 `test:internal`·`typecheck:internal`에 들어갔다.
- **남은 일**: 설계상 baseline drift만으로도 check가 실패한다(added 약 444, removed 44 등, 모두 커밋된 작업의 의도된 결과). parser·codegen 병렬 단위가 모두 머지된 뒤 drift를 검토하고 `corepack pnpm type-registry:write`로 baseline을 갱신해 커밋한다. **baseline 쓰기는 사용자 승인 후에만 한다.** 예산 상한을 낮출지는 정책 결정이므로 사용자에게 남긴다.

### WS-I — 사용 가이드 정비와 핵심 가치 · 조사 `done`, 작성은 RC 통합 이후 (2026-10-06 사용자 요청)

- **조사 결과**: 사용자 대상 문서 약 50개에서 238건의 어긋남(틀림·낡음·누락·깨진 예제·중복)을 찾았다. major-update/rewrite 판정이 20여 개다(README, 가이드 색인, onboarding-playbook, codegen README, client·router·mock-server·surface-ir·tools README, client/backend/pure-types 가이드, typespec/01~06, schema-authoring, schema-architecture, basic-spec-usage, declarative-spec-configuration, typespec-decorators·schemas README).
- **공통 문제**: 핵심 가치 설명 부재, 외부 사용자와 모노레포 기여자 흐름이 섞임, CLI가 만들지 않는 프레임워크 라우터 바인더를 생성한다고 설명, 패키지 공개 상태·Node 버전 표기 불일치, TanStack 예제의 export 이름 오류, TypeSpec 예제가 compiler 1.16에서 컴파일 실패, 비공개 `@oa-sdk/schemas`를 설치 가능한 것처럼 import.
- **핵심 가치 초안**(반박 리뷰 반영): 사람이 고치는 원본 하나와 다시 만들 수 있는 생성물, 기존 OpenAPI·외부 스키마의 점진 수용, 같은 parser 해석을 쓰는 생성·mock, 계약에서 소비자 코드까지, 계약을 지키는 mock, 변경 분류와 CI gate. 비목표(비즈니스 로직·호스팅·DB 물리 스키마·이 저장소에서의 npm publish)도 함께 적는다.
- **진행 방식**: RC 통합이 main에 들어간 뒤, 공통 사실표(Node 버전, 공개 패키지, companion 동작, msw, 바인더 현실)를 먼저 고정하고 문서 묶음별로 작성·정확성 리뷰를 한다. RC 이후 기능(ref-projection, mock-server 응답 재사용)은 아직 쓸 수 있는 기능으로 쓰지 않는다.

### WS-J — 조사에서 드러난 코드 결함 · `ready`

| 결함 | 근거 |
|---|---|
| `oa-gen init --archetype enterprise`가 쓰는 스크립트 3개가 동작하지 않는다: `oa-gen diff --base origin/main --head HEAD`(diff는 파일 경로만 받음, ENOENT), `ci:gate`에 필수 `--head` 없음, 없는 명령 `oa-gen personas:check` | 가이드 조사 중 직접 실행 |
| `oa-gen generate`가 companion 패키지 안의 생성 오류를 경고만 남기고 넘어간다 | 가이드 조사 |
| `oa-gen generate`가 `outputRouting.pruneOrphans: false`여도 다른 명령(`generate:tanstack`)이 쓴 산출물까지 지우고, 요약의 operation 수가 틀린다 | RC-N quick-start 재검증 |
| `generate:tanstack --types-import` 출력이 typegen이 만들지 않는 `<Op>ClientError`를 import해 `tsc` TS2305로 실패한다 | RC-N quick-start 재검증 |
| `oa-gen diff`가 응답 스키마에 선택 필드만 추가해도 breaking(exit 1)으로 분류한다(스키마 fingerprint가 다르면 무조건 breaking) | 핵심 가치 비평에서 직접 실행 |
| 문서는 CLI가 프레임워크 라우터 바인더(`*.router.ts`)를 만든다고 하지만 어떤 `oa-gen` 명령도 만들지 않는다. 생성할지, 문서를 고칠지 결정 필요 | 가이드 조사. `@oa-sdk/router`는 빌드 시점 `generateRouter()`(hono, express, fastify, elysia)만 제공한다. 사실표 확정 전까지 문서는 `generateRouter()` 기준으로 쓴다 |
| init이 쓰는 스크립트 가운데 동작하지 않는 것이 더 있다: enterprise `lint:spec`, `audit:csp`, `audit:shape`, microservice `test:contract`, `audit:wire`. `generate:router`·`generate:client`·`generate:contract`는 `generate`가 무시하는 `--target`을 넘겨 결국 일반 `generate`를 실행한다. pack smoke는 mvp의 `validate`·`mock`만 실행해 이를 잡지 못한다 | 사실표 확정(2026-10-06) |
| `oa-gen generate` 요약이 3.2.0 파일을 'OpenAPI 3.1'로 표시하고, companion 안의 생성 오류는 경고만 남긴 채 exit 0으로 끝난다. 생성된 contract와 client는 타입이 `unknown`이다 | 사실표 확정 |
| `generate:tanstack --split`은 `outputRouting` 아래에서 상대 import가 깨진다 | 사실표 확정 |
| `oa-gen diff`는 OpenAPI 파일 경로만 받고 스키마 fingerprint가 바뀌면 모두 breaking이다. `tsp diff` 방식의 additive 분류로 바꿀지 정책 결정 필요 | 사실표 확정 |

### WS-G — Goal 68 DPM · 관제 대상 아님

- external owner(`mineclover/data-governance`)가 extraction contract의 정본이다.
- public release와 breaking removal은 별도 gate로 다룬다.
- 오케스트레이터는 상태만 추적한다.

## 4.1 통합 현황 (2026-10-05 20:00 기준)

main에 통합된 단위: E1, E2, E3, E4, E5, C2, A2, A3, C4(+companion release gate), WS-D/E6, D5, WS-H, task_7b355ede(`oa-gen init` 설치 가능 지정자). main은 **codegen 0.9.0 릴리스 후보**다(`f8a9d42b`: codegen 0.9.0, parser 0.4.0, typespec-decorators 0.3.0, core 0.3.1, router 0.2.2, client 0.2.2, mock-server 0.1.4, surface-ir 0.1.1, spec-lens 0.1.6). origin보다 160여 커밋 앞서 있고 push 전이다.

**RC 진행 순서 (사용자 결정 2026-10-05)**: RC 보강 → type-registry baseline 갱신(승인됨) → 로컬 CI 미러 재확인 → push(별도 승인) → GitHub CI → `release:export`(router·client·mock-server·surface-ir 첫 배포 포함) → `oa-sdk-releases` PR·머지 → publish workflow 승인. Wave 2b는 RC export 이후 다음 릴리스용 changeset과 함께 통합한다.

| 항목 | 상태 |
|---|---|
| RC 보강 (RC-T) | 진행 중: export 게이트가 companion만 검사하고 init이 쓰는 `@oa-sdk/core` 범위를 검사하지 않음, pack smoke의 archetype 범위, personas `workspace:*` 보고, `chunk-stream-ui` `engines.node` 누락(public-release-runtime CI 실패), `schema:rollback-check`가 추적 파일을 덮어씀 |
| RC 보강 (RC-N) | 진행 중: codegen 0.9.0에 E3 누락, 첫 공개 패키지(router·client·mock-server·surface-ir) changelog, 이미 배포된 tools·chunk-stream의 changeset 누락, typespec-decorators README 네임스페이스 오류, release-readiness 버전 표 |
| Wave 2b: B(B1+B2), C1, D2 | 구현·리뷰 중. RC export 이후 통합 |
| codex `typespec-ts-origin` | 그대로 병합 불가(E3 구조 충돌, TS 의존성, 이름 귀속 버그). 시험 포팅본 `.claude/worktrees/merge-trial-typespec-ts-origin`(2a0f98e7) 검증 완료. 포팅 여부·공개 API 범위는 사용자 결정 |
| E7 | E2 이후 ready |
| A4 | E3·task_7b355ede 머지 완료로 ready (codex 포팅 뒤 권장) |

## 5. 결정 기록 (2026-10-05 사용자 확정)

| # | 질문 | 결정 |
|---|---|---|
| D0 | 기존 미커밋 변경 75개를 어떻게 처리할지 | 소유 세션이 모두 끝났음을 확인. 주제별 커밋으로 정리한다. `.agents/teamwork/` 세션 산출물은 커밋하지 않고 ignore한다 |
| D1 | Goal 70 Sirius 진행 여부와 Java 저장소 소유자 | Phase A의 B1·B2(oa-sdk 쪽, Core 범위)만 진행. B3은 B4 비교 후 결정 |
| D2 | WS-C downstream 성능(C1, C3) reactivation | C1만 진행. C3는 보류 |
| D3 | C2 route-match 개선을 Core 작업으로 진행할지 | 진행 (파일이 parser에 있으므로 Core 작업) |
| D4 | WS-D CI 원격 캐시와 병렬화 | `.turbo` 로컬 캐시 + dist artifact 공유 + turbo inputs 누락 수정 + `bench:parser` 게이트(E6)만. 원격 캐시와 테스트 병렬화는 하지 않음 |
| D5 | WS-F 무의존 패키지 처리 | 결정 문서만 작성하고 코드 변경은 하지 않음 |

## 6. 실행 순서 (wave)

```text
Wave 0  D0 처리 (미커밋 변경 정리) ── WS-A 결과 수신·머지
Wave 1  결정 불필요 + 충돌 없음:  E1 · E3 · E4 · E5   (서로 독립, 병렬 가능)
        결정 불필요 + D0 이후:     E2 · C4 · (D3 승인 시) C2
Wave 2  결정 후:  B1 → B2 → B3/B4 (D1),  C1 (D2),  WS-D + E6 (D4)
Wave 3  B4 게이트 통과 시 Goal 70 Phase B 분해
```

병렬 실행 시 주의할 점:

- E1은 여러 패키지에 걸친 넓은 리팩터다. 같은 파일을 만지는 E3·E4·E5와 머지 순서를 정한다. E1을 먼저 머지하는 것을 권장한다.
- parser를 바꾸면 downstream 테스트 전에 `packages/parser`에서 `npm run build`를 해야 한다. 소비 패키지들은 `dist`를 읽는다.
- 같은 호스트에서 다른 프로젝트 테스트가 돌면 CLI 하위 프로세스 테스트가 타임아웃난다. 실패가 `audit:csp`나 exit 143이면 단독 재실행으로 확인하고, 결과 보고에 부하 평균을 적는다.

## 7. Worker 세션 지시 템플릿

```text
저장소: /Users/junwoobang/workflow/oa-sdk (pnpm 모노레포, main 기준 worktree)
작업: <WS-ID / 단위> — <한 줄 목표>
정본: docs/internal/goals/orchestration-handoff.md §2(불변 규칙), <관련 goal 문서>
범위: <수정할 패키지/파일>. 이 밖은 수정하지 말 것.
배경: <이 문서의 해당 행 근거를 그대로 복사>
완료 조건:
  - 변경 패키지: npx tsc --noEmit -p . / npx vitest run 통과
  - parser 변경 시 parser 빌드 후 client, router, mock-server, codegen, spec-lens 테스트 실행
  - 성능 변경 시 before/after 수치 (같은 머신, 같은 입력, median)
  - 관련 goal 문서의 unit 상태와 결과 갱신
보고 형식: 변경 파일, 테스트 결과(실패는 원인 분류 포함), 측정치, 남은 리스크, 제안 커밋 메시지
커밋: 사용자/오케스트레이터 승인 후 주제별로. push 금지.
```

## 8. 검증 명령 모음

```bash
# 패키지 단위
cd packages/<pkg> && npx tsc --noEmit -p . && npx vitest run

# parser 변경을 downstream에 반영
cd packages/parser && npm run build

# 파서 성능 회귀 게이트
corepack pnpm bench:parser

# 계층별 (루트)
corepack pnpm test:core
corepack pnpm test:downstream
```

## 9. 참고

- Goal 69 계약, 결정, 측정 근거: [`goal-69-parser-ref-expansion-performance.md`](./goal-69-parser-ref-expansion-performance.md)
- Goal 70 단계와 소유 경계: [`goal-70-sirius-web-studio-integration.md`](./goal-70-sirius-web-studio-integration.md)
- 재귀 규칙: `packages/parser/src/recursion-guard.ts`
- 메모: `packages/parser/src/ref-expansion-memo.ts`
- ref 그래프와 투영: `packages/parser/src/ref-graph.ts`, `packages/parser/src/ref-projection.ts`
- 범위 결정 형식: [`../platform-scope.md`](../platform-scope.md) §Scope Reactivation Decision
