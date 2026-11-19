# 제품 피드백·문서 정리 핸드오프 — 2026-11-16

상태: historical (§3의 A·B·C를 2026-11-16에 수행함. 아래 본문은 수행 전 조사 기록이며 행 번호와 "남은" 서술은 그 시점 기준이다. commit은 하지 않았다)
최종 검토: 2026-11-16
기준 commit: `9bf2d649` (`main`, `origin/main`과 동기화, 작업 트리 clean)
정본: 이 문서는 위임용 작업 지시서다. 작업이 끝나면 삭제하거나 `historical`로 표시한다.

## 1. 요청과 확정된 범위

요청은 "제품 피드백 및 문서 정리"이며, 요청자가 다음 범위를 선택했다.

- 피드백 출처: **`docs/reports/` 전체**. 리포트에 남은 미해결 피드백을 한 곳의 백로그로 모은다.
- 문서 정리 범위 세 가지:
  1. 오래된 현황 문서 갱신
  2. todo·백로그 정리 (완료 항목을 걷어내고 열린 항목만 남김)
  3. 중복·폐기 문서 통합 (대체된 날짜별 문서를 합치거나 삭제하고 색인을 맞춤)

이 핸드오프 작성 시점까지 저장소 파일은 이 문서 외에 수정하지 않았다. commit도 하지 않았다.

## 2. 조사로 확인한 사실

### 2.1 리포트별 미해결 피드백

| 리포트 | 확인한 상태 | 남은 피드백 |
| --- | --- | --- |
| [feature-review-2026-10-26.md](../reports/feature-review-2026-10-26.md) | FR-01~09, TEST-01 **모두 fixed**. [검증 현황](./verification/status.md)의 결함 표가 `open 0, fixed 10`이고, 실행 기록 `tools-20261030-fr05-fr09-v2`(109 통과)가 FR-05~09 회귀를 담는다. 코드에서도 확인했다: `packages/tools/src/table-ir.ts`의 `beforeFingerprint` 대조, `mcp-use.ts`·`cli-anything.ts`의 `restoreState` 호출, `table-file-io.ts`의 workbook relationship 해석 | (a) 리포트 본문이 낡았다: 8행 "FR-05~09를 … 미수정 상태로 기록", 176행 "아직 수정하지 않았다". (b) `external-document-interop` 보장 항목이 `unverified`. (c) 보장 제외 범위로 남은 것: domain 쓰기 후 snapshot I/O 실패 시 rollback, 프로세스 중단 후 lock 복구. (d) 기능 71개 중 65개가 검증 원장에서 미평가 |
| [typespec-builder-usability-report.md](../reports/typespec-builder-usability-report.md) | 2026-10-09 생성 리포트. §5 권고 5건 | §5.1-1 세분화 HMR: `packages/codegen/src/plugin/vite.ts`가 여전히 `full-reload`. §5.1-2 optimistic update 스캐폴딩: `packages/*/src`에 `optimistic` 없음. §5.2-1 `pluginStream`: 없음(`@oa-sdk/client`의 SSE/NDJSON 생성은 별개로 존재). §5.2-2 Wasm 컴파일 가속: 연구 제안, 흔적 없음. §5.2-3 webhook 플러그인: builder 플러그인은 없음(router/client/mock의 webhook 스텁은 존재) |
| [generate-incremental-20261030.md](../reports/generate-incremental-20261030.md) | `--incremental` 재사용 실측 기록 | TypeSpec 입력은 전체 재생성 fallback. guards가 켜진 target과 companion output 실패·누락 run은 재사용 bundle을 기록하지 않음 |
| [typespec-pydantic-codegen-review.md](../reports/typespec-pydantic-codegen-review.md) | Phase 2 types-only 범위가 2026-11-09에 구현 완료([Phase 2 문서](./architecture/pydantic-codegen-phase2.md)). P2c(FastAPI router stub)·P2d(`ContractRegistry` adapter)·manifest/provenance는 **범위 제외로 확정** | (a) 4행 상태 문구가 "Phase 1 구현 완료"에 머물러 있다. (b) scalar alias의 description/title/examples를 필드 사용처에 복원하지 않는 fidelity gap(§8에 Open으로 표기). (c) OAS `in: querystring` parameter 미지원, discriminator 없는 `oneOf`의 exact 보장 등은 [가이드의 알려진 제한](../guides/pydantic-codegen.md)이 정본 |

확인하지 못한 것:

- Pydantic 리뷰 §8 표의 `@discriminated` envelope("전용 처리 없음")과 모델 수준 `x-*`("IR에만 보존") 두 행은 Phase 1 시점 서술이다. [Changelog](../changelog.md) 2026-11-09 항목은 envelope union 지원과 `extensions` 옵션을 말하므로 낡았을 가능성이 높다. 코드나 golden fixture로 확인한 뒤 고친다.
- npm registry의 실제 배포 버전은 조회하지 않았다. 로컬 `oa-sdk-releases` 저장소 log에는 `2026-10-31-ftp-contract-v0.3.0`과 `2026-11-14 typespec decorators v0.5.0` 릴리스 commit이 있다.

### 2.2 오래된 현황 문서

| 문서 | 문제 |
| --- | --- |
| `HANDOFF.md` (저장소 루트, 마지막 수정 `c080be1e` 2026-10-23) | 전체가 2026-10-23 기준이다. 아래 2.3의 현재 사실과 어긋난다 |
| [docs/README.md](../README.md) 11행 | "최신 구현의 검증 범위와 한계"를 2026-10-25 완료 기록으로 안내한다. 그 뒤 popup-bridge, incremental generate, Pydantic Phase 1·2가 들어왔다 |
| [docs/README.md](../README.md) 색인 | `docs/reports/`의 feature-review, generate-incremental, pydantic 리뷰가 색인에 없다. SSOT 표에 `todo.md`, `verification/status.md`가 없다 |
| [docs/internal/README.md](./README.md) | "ADR 001~011"로 적혀 있으나 013까지 있다. `verification/`과 `todo.md` 행이 없다 |
| [todo.md](./todo.md) | 548행 중 열린 항목은 44행의 `[ ]` 하나뿐이고 나머지는 완료 이력이다 |
| `backlog-handoff-2026-10-23.md` | 대부분 종료된 기록이다. "GitHub Actions billing 미복구"(C절)는 더 이상 사실이 아니다 |

### 2.3 HANDOFF.md 갱신에 쓸 현재 사실 (2026-11-16 확인)

- **GitHub Actions가 다시 동작한다.** `gh run list`에서 `main`의 최근 `workflow_dispatch` 실행 3회가 연속 성공했다(2026-11-15 UTC). `.github/workflows/ci.yml`은 `pull_request`와 `workflow_dispatch`에서만 실행되고 `ubuntu-24.04`, Node 26을 쓴다. 단, `ci.yml` 상단 주석은 아직 "billing currently cannot start those jobs"라고 적혀 있다(문서 범위 밖이므로 보고만 한다).
- 2026-10-23 이후 `main`에 51개 commit. 주요 내용: 용도별 파이프라인 격리(10-25), popup-bridge(10-28), incremental generate(10-30), ftp-contract 0.3.0(10-31), Pydantic Phase 1·2(PR #25~#37, 11-07~11-09), CI gate 복구(PR #38, #39), typespec-decorators 0.5.0 릴리스 준비(11-14), Node 26 CI lane(11-16).
- 소스 버전: `codegen 0.11.0`, `tools 0.2.3`, `typespec-decorators 0.5.0`, `ftp-contract 0.3.0`, `mcp-mesh 0.1.4`, `parser 0.5.0`, `client 0.3.0`, `router 0.2.5`, `popup-bridge 0.2.0`(private).
- 대기 중 changeset 1개: `.changeset/ftp-contract-turbo-output.md` (`@oa-sdk/ftp-contract` patch).
- 열린 PR: #23 (draft, `experiment/effect-tsgo-oa-reference-20261027`).
- worktree 3개: main, `.claude/worktrees/vibrant-nightingale-658fc0`(`fix/pydantic-encoding-degraded`), opencode의 `pipeline-stability-validation`(detached `020ec128`). 로컬 브랜치에 `wip/pydantic-p2c-fastapi-router`, `release/typespec-tool-pipeline`, `fix/ftp-contract-dist-fixtures` 등이 남아 있다.
- 개발 환경: `engines.node`는 `>=24.0.0 || >=26.0.0`, pnpm `11.28.6`. 로컬 Node는 24.22.1.

## 3. 작업 항목

### A. 리포트 피드백 백로그를 `todo.md`로 모으기

[todo.md](./todo.md)를 열린 항목만 남긴 짧은 문서로 다시 쓴다. 구성 제안:

1. 머리말: 결함 상태의 정본은 검증 원장이라는 기존 안내(3~4행)를 유지한다.
2. 열린 항목: 기존 `[ ] 외부 문서 상호운용 및 자동완성 메타데이터 정합성`을 그대로 둔다. [계획 문서](./external-document-interop-autocomplete.plan.md)를 링크한다.
3. 리포트 피드백 백로그: 2.1의 "남은 피드백"을 표로 옮긴다. 열은 출처 리포트, 항목, 현재 상태, 착수 조건. 이 항목들은 **결정 대기 backlog이지 승인된 작업이 아니다.** `[ ]` 체크박스로 만들지 않는다.
4. owner-gated backlog: backlog-handoff에서 아직 유효한 것만 옮긴다. oa-sdk CI가 submodule을 검사하지 않음(`pnpm check:cross-repo-projection`은 수동 gate), contract release 경계, DPM Phase 10은 외부 owner 결정 전까지 no-op.
5. 완료 이력 안내: 아래 B의 archive 링크.

결함 상태를 todo에 복제하지 않는다. FR-xx의 상태는 [registry.json](./verification/registry.json)만 정본이다.

### B. 완료 이력을 archive로 분리

- `todo.md`의 61행 이후(완료 항목 전부)를 새 파일 `docs/internal/todo-archive.md`로 옮긴다. 삭제하지 않는 이유: SQLite driver 정책 전환 근거, GitLab REST 유지 결정 같은 결정 근거가 다른 문서에 없다.
- `backlog-handoff-2026-10-23.md`의 종료된 내용(A.2~A.6 검증 기록 포함)을 같은 archive의 부록 절로 합치고 원본 파일을 삭제한다. 같은 디렉터리이므로 상대 링크는 그대로 유효하다. 제목 수준만 한 단계씩 내린다.
- 함께 고쳐야 하는 참조:
  - [changelog.md](../changelog.md) 81행: `./internal/todo.md#x-webmcp-relay-남은-강화-항목` → archive 파일의 같은 anchor
  - [changelog.md](../changelog.md) 389행: `docs/internal/todo.md` "운영 관찰: SQLite optional native dependency 설치성" 언급
  - [pydantic-codegen-phase2.md](./architecture/pydantic-codegen-phase2.md) 49행, 52행: `docs/internal/todo.md:108`, `:158` 행 번호 인용 → archive의 새 행 번호
  - `todo.md` 내부 anchor `#x-2026-10-19-시스템-안정화-pass`는 archive 안에서 같은 파일 anchor로 유지된다
  - `HANDOFF.md` 53행의 backlog-handoff 링크 (C에서 다시 쓰므로 함께 정리)
- `tasks/prd*.json`·`tasks/prd*.md`의 "update docs/internal/todo.md" 문구는 일반 지시이므로 고치지 않는다.

### C. 오래된 현황 문서 갱신

1. **`HANDOFF.md`**: 2.3의 사실로 다시 쓴다. 영어 문서이므로 영어를 유지한다. 2026-10-21~23 세션의 상세 기록(§2 landed 표, §3 verification evidence, §4 Released/Resolved)은 `git show c080be1e:HANDOFF.md`로 볼 수 있다고 한 줄로 안내하고 본문에서 뺀다. "Remaining work"는 `docs/internal/todo.md`를 가리키게 한다. P0.1(billing blocked)은 해소로 바꾸고, `NPM_TOKEN` 만료 방치 결정과 dev-only advisory 4건은 재확인 없이는 "2026-10-23 기준"이라고 날짜를 붙여 남긴다.
2. **리포트 본문의 낡은 문구**:
   - feature-review 8행과 176행을 "FR-05~09는 2026-10-30에 수정·회귀 등록됨, 상태 정본은 검증 원장"으로 고친다. 재현 서술 자체는 날짜별 관측 기록이므로 지우지 않는다.
   - pydantic 리뷰 4행 상태 문구를 Phase 2 types-only 완료로 갱신한다. §8의 두 행은 2.1의 "확인하지 못한 것"을 확인한 뒤 고친다.
   - usability 리포트 §5와 generate-incremental 리포트 "의미와 제한"에 "추적 상태는 todo.md" 한 줄을 넣는다.
3. **[docs/README.md](../README.md)**: 11행을 검증 현황과 Changelog를 가리키는 문장으로 바꾼다. SSOT 표에 `todo.md`, `verification/status.md` 행을 추가하고, 색인에 없는 리포트 3건을 넣는다.
4. **[docs/internal/README.md](./README.md)**: ADR 범위를 001~013으로, 문서별 역할 표에 `todo.md`, `todo-archive.md`, `verification/`을 추가한다.
5. **[decision-log.md](../spec-governance/decision-log.md)**: todo 이력을 archive로 분리한 구조 변경을 표 맨 위에 한 행으로 기록한다(변경 내용, 이유, 영향 범위, 저장 위치).

## 4. 건드리지 않는 것

- 저장소 루트의 `PROJECT.md`, `TEST_INFRA.md`, `TEST_READY.md`: 날짜는 오래됐지만 E2E 테스트가 내용을 고정한다. `tests/e2e/output-routing-tanstack/tier1-feature-coverage.test.ts`의 T1-F13-5, T1-F14-1, T1-F14-2가 파일 존재와 "14 features" 서술을 검사한다.
- [verification/status.md](./verification/status.md): `pnpm verification:report`가 생성한다. 손으로 고치지 않는다.
- [pipeline-isolation-checkpoint-2026-10-25.md](./pipeline-isolation-checkpoint-2026-10-25.md): changelog, plan, release-readiness, docs/README에서 참조하는 완료 기록이다. 유지한다.
- `docs/internal/goals/`(79개 파일), `docs/PROOF-REQUEST.md`와 `proof-output/`: 이번 범위가 아니다.
- `.merged*.yaml`, `dist/`, 생성 sidecar, `docs/reports/*.json` 증거 파일.

## 5. 검증과 완료 기준

문서만 바꾸는 변경이므로 [문서 정책](../spec-governance/document-policy.md)의 최소 조건을 따른다.

```bash
corepack pnpm check:docs
```

```bash
corepack pnpm check:spec-governance
```

```bash
corepack pnpm check:verification
```

```bash
git diff --check
```

- `check:verification`은 리포트 파일 경로와 source hash를 검사한다. 리포트 본문을 고친 뒤 실패하면 hash 대상이 무엇인지 확인하고, 생성 파일을 손으로 맞추지 말고 `pnpm verification:report`로 재생성한다.
- 완료 기준: 위 gate 통과, `todo.md`에 완료 항목이 남아 있지 않음, 삭제·이동한 파일을 가리키는 링크 0건, `HANDOFF.md`의 날짜와 CI 서술이 2.3과 일치.
- commit은 요청자가 따로 지시할 때만 한다. 현재 브랜치가 `main`이므로 commit 전에 브랜치를 만든다.
