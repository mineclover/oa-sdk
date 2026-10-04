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

### WS-D — CI·빌드 파이프라인 · `decision` (인프라 비용·정책)

- CI가 `.turbo` 캐시를 유지하지 않는다.
- `build:core`가 job마다 반복된다: `ci`, `public-release-runtime` ×3, `typescript-7-current`.
- 모든 테스트가 `--concurrency=1`, `--maxWorkers 1 --no-file-parallelism`으로 돈다.
- mock-server `test:cli-smoke`가 다시 빌드한다.
- `turbo.json` `build.inputs`에 `tsup.config.ts`가 빠져 있고, `test.inputs`에는 `package.json`이 빠져 있다.
- **결정 사항**: 원격 캐시(`TURBO_TOKEN`) 사용 여부, 병렬화 허용 범위.
- `ci.yml`이 미커밋 변경과 충돌한다.

### WS-E — Core 정리 · `ready`

| 단위 | 내용 | 확인된 근거 | 충돌 |
|---|---|---|---|
| E1 | JSON Pointer escape/unescape 사본 36곳을 `parser/src/json-pointer.ts` export로 통일한다. 대상은 parser, codegen, mock-server, spec-lens, surface-ir, schemas scripts, dpm이다. Goal 69에서 추가한 ref-graph, ref-projection, deref-internal도 포함한다. | 전수 grep (2026-10-05) | 없음 (dpm은 maintenance-only이므로 제외하거나 별도로 처리) |
| E2 | `loadSchema`(`parser/src/schema-loader.ts`)가 `parse-core.ts`를 따로 재구현하면서 어긋났다. webhooks 처리가 0건이고, `additionalOperations`, `x-` 확장, `$ref` 파라미터 처리도 확인이 필요하다. `parse-core` 위에 다시 만든다. | `webhooks` grep: schema-loader 0건, parse-core 5건 | `schema-loader.test.ts`가 미커밋 변경과 충돌 |
| E3 | `--incremental`이 dirty 집합을 계산하지만(`incremental.ts:62`) typegen은 작업을 건너뛰는 데 쓰지 않는다(`typegen.ts`에 `dirty` 참조 0건). 파일 해시도 두 번 계산한다(`workspace-index.ts:205-235`). | grep | 없음 |
| E4 | 전역 identity `seen` 집합이 DAG 입력에서 오동작할 수 있는 곳을 확인한다. `codegen/src/cli/lib/openapi-collect.ts`의 `removeCollectionNoise`는 공유 객체를 노이즈 제거 없이 반환한다. `parser/src/lint.ts`의 `traverseDocumentNodes`는 YAML anchor로 공유된 노드의 두 번째 위치를 lint하지 않는다. | 미검증. 입력이 deref 출력인지 먼저 확인 | 없음 |
| E5 | `DerefFolder`가 `includeInternalFilePath: false`로 동작해서, 외부 문서 안의 내부 ref가 진입 문서와 같은 `<root>` 키 공간을 쓴다. 그래서 순환 판정이 잘못될 수 있다. 메모는 외부 전개를 저장하지 않으므로 메모 정합성은 안전하다. | Goal 69 Decisions | 없음 |
| E6 | `bench:parser`를 CI에 연결한다. 예산 초과 시 실패하게 한다. | — | `ci.yml` 충돌 → WS-D와 함께 처리 |

### WS-F — 패키지 위생 · `decision`

- **의존하는 workspace가 없는 패키지**:
  - public: `chunk-stream-react`, `chunk-stream-timeseries`, `mcp-mesh`
  - private: `spec-lens`(Core tier, 약 6k lines), `typespec-erd`, `typespec-tooling`, `typia-mock`
- `ttsc-compile-fixture`는 어떤 build/test tier에도 속하지 않는다.
- **결정 사항**: 각 패키지를 유지할지, 추출할지, 제거할지.
- 코드 작업은 결정 후에 한다.

### WS-G — Goal 68 DPM · 관제 대상 아님

- external owner(`mineclover/data-governance`)가 extraction contract의 정본이다.
- public release와 breaking removal은 별도 gate로 다룬다.
- 오케스트레이터는 상태만 추적한다.

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
