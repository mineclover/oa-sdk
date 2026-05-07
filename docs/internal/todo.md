# Todo — 이행 대기 태스크

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.
> 정렬 기준: definition builder → ref correctness → 증분 workspace index → 코드 생성 정책 → 진단 UX → 공개 API → 런타임 활용 → 남은 OAS 스펙 순.
> 증분 설계: [ADR-006 — SQLite 기반 증분 Workspace Index](./architecture/006-incremental-workspace-index.md)
> 다음 PRD: [Definition Builder Domain Backfill](../../tasks/prd-definition-builder-domain-backfill.md)

---

## 다음 세션 실행 순서

Definition Builder PRD(US-001~014)와 Domain Backfill PRD(US-001~009)가 모두 완료되었다. Builder parity artifact는 zero-error diagnostics와 zero normalized OpenAPI drift를 달성했으며, `.merged.yaml` 대체는 아직 범위 밖이다. 다음 우선 작업은 없음 — 잔여 보완 작업 및 운영 관찰 항목 참조.

### [x] OpenAPI definition builder: current-domain fragment backfill
배경: migration plan은 확정되었지만 `packages/schemas/src/fragments`는 아직 builder behavior fixture이며 current `src/domains/{common,health,users}/spec.yaml` 전체와 동등한 source가 아니다. 실행 상세는 [Definition Builder Domain Backfill PRD](../../tasks/prd-definition-builder-domain-backfill.md)를 따른다.
완료: 모든 구현 순서 완료. `parity:build` 34 fragments, 21 selected nodes, 0 errors. `parity:diff` no path/component/security/server differences vs `.merged.yaml`.
구현 순서:
1. 완료: `src/profiles/{local,staging,production}.yaml`의 `servers`를 profile별 parity target config로 복제하고, local parity target config selection을 테스트한다.
2. 완료: `src/domains/common/spec.yaml`의 schemas/responses/parameters/securitySchemes를 `shared/common` fragments로 분리하고 local refs를 `oa://...` canonical refs로 바꿨다.
3. 완료: `src/domains/health/spec.yaml`의 `/health`, `/health/stream`, `HealthStatus`를 path/schema fragments로 옮기고 shared response refs를 canonical refs로 연결했다.
4. 완료: `src/domains/users/spec.yaml`의 `/users`, `/users/{id}`, `User`, `CreateUserRequest`, `UpdateUserRequest`를 path/schema fragments로 옮겼다.
5. 완료: `oa-gen build-spec`로 parallel artifact와 diagnostics/collision reports를 만들고, current `.merged.yaml`과 normalized diff를 생성한다.
6. 완료: Builder artifact를 기존 `downgrade-3.1.ts`, Redocly, Spectral, `oa-gen validate`, typegen 비교, router/client generation, mock-server handler/adaptor 생성 gate에 통과시키는 `pnpm schema:parity:compat`를 추가한다.
7. 완료: `merge.ts` active path, current domain spec rollback, `.merged.3.1.yaml` sidecar compatibility, and exact replacement gates를 문서화한다.
완료 기준 충족: current `.merged.yaml` path를 유지하면서 builder parity artifact가 zero-error diagnostics, zero normalized OpenAPI drift를 달성함. `.builder/local-parity-api.3.1.yaml` compatibility, downstream compatibility report, rollback-safe script boundaries 모두 충족.

## spec-lens 잔여 항목

### [x] RefreshTimeline 병렬 revision 처리
완료: Promise.all로 전체 캐시 조회 병렬화, withConcurrency(4)로 미캐시 빌드 병렬화, 저장은 SQLite WAL 제약상 순차 유지. snapshots 배열은 원래 순서 재조합하여 diff 계산 보존.

### [x] GitLab 어댑터 검증
배경: `GitlabAdapter`(REST API 기반)는 구현되었으나 실제 GitLab 인스턴스 대상 통합 테스트가 없었다.
완료 (2026-04-27): 로컬 GitLab CE 인스턴스(`http://localhost:8929`)에서 4 케이스 통합 테스트 추가 — `listRevisions`(fragments path filter + branch + commits 정렬), `getFileEntries`(tree pagination + file content + sha256 contentHash), 연속 revision 간 content drift 감지, 401/403 auth 에러 메시지 정합성. 테스트는 `GITLAB_INTEGRATION_{HOST,PROJECT_ID,TOKEN,FRAGMENTS_DIR}` 환경변수가 모두 있을 때만 실행되고 그 외엔 깨끗하게 skip — CI 안전. 운영 가이드는 [packages/spec-lens/README.md](../../packages/spec-lens/README.md) 참조.
REST vs bare-clone 결정: REST API 방식 유지. 이유는 (1) 4 케이스 모두 통과해 refresh/timeline 흐름이 검증됨, (2) bare-clone 전환은 `getFileEntries`의 tree pagination 비용을 한 번에 줄일 수는 있지만 git 의존성을 추가하고 GitLab 토큰 → SSH/HTTPS 자격 매핑이 추가 복잡도를 가져옴, (3) GithubAdapter가 bare-clone으로 간 이유는 GitHub API rate limit이 좁기 때문이고 self-hosted GitLab은 같은 압력이 없음. 변환은 rate limit 압력이 실제로 발생할 때 재고려.
완료 기준 충족: 실제 GitLab 레포 대상으로 refresh + 타임라인 + diff 흐름 모두 통과 (`gitlab-adapter.integration.test.ts`).

---

## infra-gitlab 잔여 항목

> 패키지: [`@oa-sdk/infra-gitlab`](../../packages/infra-gitlab/) — Pulumi preset for self-hosted GitLab CE + Runner.
> 운영 절차/노하우: [packages/infra-gitlab/OPERATIONS.md](../../packages/infra-gitlab/OPERATIONS.md).
> 큰 그림: 자율 코딩 에이전트(Symphony 계열)를 GitLab 위에서 돌리는 DevOps substrate. Phase 1(로컬 Docker)만 완료, Phase 2~4 미착수.

### [ ] Phase 2 — K3s variant
배경: Phase 1은 단일 호스트 Docker 한정. K3s에서 같은 스택을 띄우면 (1) ingress + TLS를 표준 패턴으로 풀 수 있고, (2) Symphony가 향후 멀티 인스턴스로 가도 받침대가 됨.

설계 옵션:
- **(a) Omnibus 이미지 + Deployment** — 현 Phase 1을 거의 그대로 K8s manifest로 이식. `gitlab/gitlab-ce` 컨테이너를 단일 Pod에 띄우고 `PersistentVolumeClaim` 3개로 `/etc/gitlab`, `/var/log/gitlab`, `/var/opt/gitlab`. 자원 발자국과 운영 모델이 Phase 1과 동일.
- **(b) `gitlab/gitlab` 공식 Helm chart** — webservice/sidekiq/postgres/redis/gitaly/registry/etc. 분리. cloud-native, 본격 운영급. 단일 노드 기준 자원 요구가 Omnibus보다 큼 (4GB로 시작 X).
- **추천: (a)부터.** Phase 1 mental model 그대로 유지하면서 K8s 표준 ingress/TLS만 얹는 게 ROI가 큼. (b)는 multi-tenant scale이 실제로 필요한 시점에 별도 패키지(`@oa-sdk/infra-gitlab-k3s-ha`)로.

기술 선택:
- Pulumi: `@pulumi/kubernetes` (TS) — kubeconfig를 Pulumi config로 받아 k3s 클러스터 대상 동작.
- 로컬 K3s 대안: `k3d`(macOS에서 docker 위에 K3s) — 문서화로 안내하되 패키지가 강제하지는 않음.
- Ingress: Traefik(K3s 기본) 또는 nginx-ingress. cert-manager로 Let's Encrypt staging issuer를 1차 default.
- 도메인: `<sub>.nip.io` 옵션 (DNS 추가 비용 0) + 사용자 도메인 옵션.

오픈 질문:
- 별도 Pulumi 스택(`k3s`)으로 같은 패키지에 둘지, 신규 패키지(`@oa-sdk/infra-gitlab-k3s`)로 분리할지? Pulumi 관행은 stack-per-environment지만, 현재 프리셋은 *플랫폼*이 다른 것이므로 패키지 분리가 더 명확.
- Runner도 K8s executor로 갈지(`gitlab-runner` Helm chart, `kubernetes` executor) docker executor 그대로 둘지. K8s executor가 cluster-native이고 보안 격리가 더 깔끔.

완료 기준: 동일한 외부 인터페이스(브라우저로 GitLab 사용 가능 + Runner CI 동작)를 K3s 위에서 재현. OPERATIONS.md에 (k3s 환경 가정 + manifest 절차 + ingress 설정) 챕터 추가. Phase 1과 호환되는 방식의 backup 가이드(PVC snapshot).

### [ ] Phase 3 — 클라우드 VM
배경: 로컬 dev/PoC를 넘어 외부 접근 가능한 운영급 GitLab을 한 명령으로 띄울 수 있어야 함. 실제 *팀* 단위로 사용하려면 필수.

설계 옵션:
- **(a) Provider-specific 별도 패키지** — `@oa-sdk/infra-gitlab-do` (DigitalOcean), `-aws`, `-gcp` 등 각각. 각자가 자기 Pulumi provider만 의존.
- **(b) Provider 추상화 인터페이스 + 단일 패키지** — `@oa-sdk/infra-gitlab-vm` 안에 `VMProvider` interface, 옵셔널 구현체. 사용자가 active provider 선택.
- **추천: (a) 시작 — DigitalOcean 1개부터.** 추상화는 두 번째 provider가 실제로 필요할 때 (b)로 리팩터. YAGNI.

DigitalOcean 1차 타깃 이유: cheapest GitLab-class droplet(~$24/mo for 4GB), API 단순, Pulumi `@pulumi/digitalocean` 안정적, DNS/Spaces(S3-호환)/Snapshot 한 콘솔에서.

기술 선택:
- VM 사이즈: 4GB RAM minimum (GitLab Omnibus 권장). 8GB가 운영 sweet spot.
- 부트스트랩: `cloud-init`으로 Docker 설치 + 본 repo clone + `pulumi up`으로 Phase 1 stack 자동 기동. 또는 `docker-compose`-equivalent로 단순화.
- DNS: Pulumi-managed `digitalocean.DnsRecord` (사용자가 도메인을 DO nameserver로 위임했다는 가정).
- TLS: 두 옵션 — (i) `caddy` 리버스 프록시(자동 LE) + GitLab은 80에 바인드, (ii) GitLab Omnibus 자체의 LE 모듈 활성. (i)가 운영 단순.
- Backup: DO Volume Snapshot API + cron. 또는 `gitlab-backup` 명령을 cron으로 + DO Spaces 업로드.

오픈 질문:
- 단일 VM vs HA pair. v1은 단일 VM, MTBF 한계는 backup으로 보완.
- Floating IP (DO 기능) 사용해서 VM 교체 시 DNS 변경 없이 갈지. 추가 월 ~$4.

완료 기준: `pulumi up`만으로 외부 접근 가능 GitLab 인스턴스. HTTPS 자동. backup cron 동작 검증. RAM/디스크 사이징과 월 비용 추정치를 OPERATIONS.md (또는 신규 패키지의 README)에 기록.

### [x] Phase 4 — Symphony GitLab tracker integration: 옵션 (c) 자체 구현으로 결정
배경: Symphony SPEC §5.3.1은 현재 `tracker.kind: linear`만 지원([SPEC](https://github.com/openai/symphony/blob/main/SPEC.md#531-tracker-object)). 옵션 (a) Symphony fork에 GitLab tracker 추가, (b) GitLab→Linear-shaped proxy, (c) Symphony 우회 직접 오케스트레이션.
결정 (2026-05-07): (c) 채택. 이유 — (a)는 upstream merge 부담 영구화, (b)는 Linear GraphQL 모사 비용 대비 가치 낮음, (c)는 Symphony SPEC을 *디자인 레퍼런스*로만 가져와 GitLab 네이티브로 다시 구현 (코드 의존성 0). 후속 작업은 [`@oa-sdk/orchestrator-gitlab`](../../packages/orchestrator-gitlab/) 패키지에서 phase A/B/C로 추적.

### [ ] Runner 등록 자동화
배경: 현재 등록은 수동(UI에서 `glrt-...` 토큰 발급 → `pnpm register:runner`). 운영 자동화에 마찰을 만든다.
범위: GitLab API로 instance/group runner 사전 생성 → 토큰을 Pulumi config secret에 저장 → 컨테이너 기동 시 `gitlab-runner register --non-interactive` 자동 실행. GitLab 16.0+의 auth token 모델에 맞춰야 함.
완료 기준: `pnpm up`만으로 Runner가 실제로 등록 완료된 상태로 뜸. 토큰 회전 절차 OPERATIONS.md에 기록.

### [ ] 호스트 가시 readiness — `monitoring_whitelist` 확장 옵션
배경: `/-/health`가 host에서 404를 내는 quirk(OPERATIONS.md 문서화 완료). 외부 모니터링 도구(Prometheus blackbox 등)에서 직접 hit해야 할 때를 위한 opt-in 토글이 없다.
범위: Pulumi config `enableExternalHealthProbe: boolean` 추가, true이면 Omnibus config의 `gitlab_rails['monitoring_whitelist']`에 Docker bridge 게이트웨이 IP 대역 포함.
완료 기준: 토글 on 상태에서 host의 `/-/health` 200, off일 때 기존(404) 동작 유지.

### [ ] Pause helper script — destroy/up 대신 stop/start
배경: 장기 dev 인스턴스는 destroy 시 GitLab 상태가 사라지므로 `docker stop`을 권장(OPERATIONS.md). 매번 두 컨테이너명을 외우는 마찰 제거.
범위: `pnpm pause` (= `docker stop gitlab gitlab-runner`), `pnpm resume` (= `docker start ...`) script 추가.
완료 기준: 두 명령으로 상태 보존된 stop/start이 가능.

---

## orchestrator-gitlab 잔여 항목

> 패키지: [`@oa-sdk/orchestrator-gitlab`](../../packages/orchestrator-gitlab/) — GitLab-네이티브 코딩 에이전트 오케스트레이터.
> 디자인 결정 + Phase A 범위: [packages/orchestrator-gitlab/docs/prd-phase-a.md](../../packages/orchestrator-gitlab/docs/prd-phase-a.md).
> 위 infra-gitlab Phase 4 항목의 후속.

### 전략 결정 (2026-05-07)

**Symphony 와 GitLab 연동의 진짜 의도**: "Symphony-style 오케스트레이션이 GitLab에서 돌면 됨"(결과 중심).

**현재 path = (c) 자체 구현**. orchestrator-gitlab을 발전시키는 길.

**Path 2 = (a) Symphony fork**는 *최적화 후보로 보류*. 다음 신호 중 **둘 이상**이 실측되면 진지하게 재평가:

1. Codex `app-server` stdio JSON-RPC가 정말 필요해짐 — 단일 턴 `codex exec`만으로는 multi-turn 내 streaming events / sub-agent 호출 / sandbox approval flow를 못 받쳐줄 때.
2. OTP supervisor의 견고함이 실측 차이로 드러남 — 워커 crash 시 부분 상태 잔존, 메모리 누수 누적 등.
3. 운영자 dashboard가 본격 필요 — Ops tooling Phase 1의 HTTP `/state`만으로 부족.
4. Symphony SPEC 추적 비용이 부담 — Symphony가 SPEC을 진화시킬 때마다 우리가 따라잡아야 하는 운영 비용 누적.
5. 다중 트래커 지원이 요건이 됨 — GitHub Issues / Linear / Jira 등 추가. Symphony는 이미 트래커 추상화가 되어 있음.

**Path 1 그대로 가야 하는 신호** (재평가 *불필요*):
- 단일 GitLab 단일 프로젝트 위주 운영
- 단일 턴 (`codex exec` / `claude --print`)으로 충분한 워크로드
- TypeScript/Node 친숙도 > Elixir/OTP 친숙도
- Symphony 자체 기능보다 *우리 사용 사례에 정확히 fit하는 것*이 더 가치 있음

**(b) Linear-shaped proxy는 영구 폐기**. 큰 GraphQL 표면적 모사 비용 vs marginal benefit 합당하지 않음.

### [x] Phase A — MVP 오케스트레이션 루프
완료 (2026-05-07): label 기반 polling → 워크스페이스 ensure → agent 실행 → 결과를 GitLab note로 회신 + label 전이 (`agent-ready` → `agent-running` → `agent-done`/`agent-failed`). `EchoAgent` (deterministic, 테스트용) + `CodexAgent` (`codex exec` subprocess wrapper). `GitlabTracker` REST 어댑터, `FsWorkspaceManager` (Symphony §4.2 sanitize). CLI `run`/`dry-run`. 6 테스트 통과 (orchestrator end-to-end + 실패 경로 + concurrency dedup + sanitize + EchoAgent abort).

추가 (2026-05-07): env-gated 통합 테스트 2건 (`test/integration/`) — 실제 GitLab 인스턴스 상대 happy path / failure path 모두 통과. `pnpm test:integration`으로 실행, env 미설정 시 깨끗하게 skip.

### [x] Phase B.1 — SubprocessAgent 추출 + ClaudeAgent
완료 (2026-05-07): 공통 subprocess 머신(spawn/timeout/abort/stdout-capture)을 `SubprocessAgent`로 추출, `CodexAgent`는 그 위 thin subclass로 재작성. `ClaudeAgent` 신규 (`claude --print` 헤드리스, prompt는 stdin 기본). 단위 테스트 10건 (`test/subprocess-agent.test.ts`) — node를 fake binary로 사용해 OS-portable. 결정 기록: Claude Agent SDK 통합은 보류, `claude` CLI 호환이 더 가볍고 SDK 변경에 덜 노출됨. Total 16 unit + 2 integration 통과.

### [x] Phase B.2 — 견고성 (retries / state reconciliation / max_turns / token aggregation)
완료 (2026-05-07): Symphony SPEC §7-8의 4개 안정성 기능을 한 라운드에 도입.
- **Per-turn retry**: `maxAttempts × min(base * 2^(attempt-1), max)` 지수 백오프. `failed`/`timed-out`만 재시도, `cancelled`는 즉시 종료. 디폴트 `maxAttempts=1`이라 기존 동작 변화 없음 (operator opt-in).
- **State reconciliation**: 워커 시작 시 `reconciliationIntervalMs` 주기로 issue를 re-fetch. issue가 closed로 가거나 running 라벨이 외부에서 제거되면 in-flight agent 즉시 cancel (AbortSignal.any로 parent + reconcile 신호 합성). 디폴트 15s 주기, `0`이면 끔.
- **`max_turns` continuation**: 성공 turn 후 issue를 다시 fetch해 `continueLabel`이 남아 있으면 다음 turn 실행 (`PromptInput.turnNumber` + `previousTurnResult` 전달). `maxTurns` 캡 도달 또는 라벨 제거 시 종료. 디폴트 `maxTurns=1`.
- **Token aggregation**: `AgentResult.tokens`(input/output/total) 옵셔널 필드 추가. agent가 채우면 GitLab note에 표시, 오케스트레이터 종료 시 누적 합계 로깅.
타입 변경: `PromptBuilder.build`가 `(input: PromptInput)` 받음 (turn/attempt/previousTurnResult). `Tracker.getIssue` REQUIRED. 21 unit + 2 integration 모두 통과 (기존 11 + B.2 신규 5: retry-success/retry-give-up/reconciliation-cancel/continuation/token-note + 기타 갱신).

### [ ] Phase C — `WORKFLOW.md` 호환 + Liquid prompt + hot reload
배경:
- 현재 config는 TS 모듈에서 `OrchestratorConfig` 객체를 default-export하는 형태. 코드 한 줄 바꾸려면 빌드/재시작 필요.
- Symphony 사용자가 기존 `WORKFLOW.md`를 그대로 가져오면 마찰이 적어짐 (Symphony가 닦은 prompt 컨벤션 + workpad 구조 그대로 재활용 가능).
- Operator가 prompt 한 줄 다듬을 때마다 ts 빌드는 과함. 텍스트 파일이 더 적합.

3개의 독립 가능한 sub-track:

**C.1 — `WorkflowFileLoader`** (Symphony §5.1–5.3 파일 형식)
- 입력: `WORKFLOW.md` 경로
- 처리: `---` ... `---` YAML front matter 파싱 → `WorkflowConfig`로 코어스, 본문 trim → `prompt_template`
- 출력: `{ config, prompt_template }`
- 검증 도구 후보: `zod`(런타임 dev중), `typia`(이 모노레포가 typia-mock으로 검증된 typia 도입 사례 있음 — 빌드타임 코드 생성으로 빠름). **추천: typia**, 모노레포 일관성 + 컴파일타임 스키마.
- Symphony front matter 호환: `tracker.kind`만 `gitlab` 추가. 나머지(`polling`, `workspace`, `hooks`, `agent`, `codex`)는 명시적 매핑/무시 결정 필요. **추천 매핑**:
  - `polling.interval_ms` → `pollIntervalMs`
  - `agent.max_concurrent_agents` → `maxConcurrent`
  - `agent.max_turns` → `maxTurns`
  - `agent.max_retry_backoff_ms` → `maxRetryBackoffMs`
  - `codex.*` → 무시 (우리는 agent를 코드로 plug-in)
  - `hooks.after_create` → `FsWorkspaceManager.afterCreate`로 배선
  - 신규 GitLab-specific top-level: `tracker.gitlab.{base_url, token_var, project_id}`, `tracker.gitlab.labels.{ready,running,done,failed}`, `tracker.gitlab.continue_label`

**C.2 — `LiquidPromptBuilder`** (Symphony §5.4 Liquid-호환 strict mode)
- 입력: `prompt_template` 문자열 + `PromptInput`
- 처리: Liquid 호환 엔진(`liquidjs` 후보) strict mode — unknown variable/filter는 render 실패
- 변수 매핑: Symphony가 노출하는 `{{ issue.identifier }}`(Linear 키 형식)와 우리 `{{ issue.iid }}`(GitLab `#42`) 간 갭. 두 가지 호환 전략:
  - (i) **alias 등록** — Liquid context에 `issue.identifier`를 `issue.iid`의 alias로 노출. Symphony WORKFLOW.md를 한 글자도 안 고치고 가져오기 가능.
  - (ii) **명시적 마이그레이션 가이드** — 변수명을 GitLab-친화적으로 바꾸도록 안내.
  - **추천: (i)** — 마찰 최소화가 이 트랙의 가치 자체.
- 추가 변수: `attempt`(이미 Symphony 호환), `turn_number`(Symphony에는 없는 신규).

**C.3 — Hot reload** (Symphony §6.2)
- 파일 watch 라이브러리: `chokidar`(이미 vitest dep로 들어와 있을 가능성) 또는 `node:fs.watch`(외부 dep 0). **추천: `node:fs.watch`** + 100ms debounce — macOS의 fsevents 신뢰성 문제는 polling fallback으로 완화 가능. dependency 0이 큼.
- semantics:
  - 파일이 변경될 때마다 reload → parse → validate
  - 성공 시 새 config 적용. **In-flight 워커는 죽이지 않음** (Symphony §6.2 그대로). `pollIntervalMs`/`maxConcurrent`는 다음 tick부터 적용.
  - 실패 시 last-known-good 유지 + reload 에러 로그.
- prompt template 변경은 *다음 turn build*부터 반영 — agent.run 중인 worker는 그대로.

오픈 질문:
- C.1/C.2/C.3 같은 PR로 갈지 분리할지. C.1 + C.2는 함께 가야 의미 있음 (둘 다 없으면 WORKFLOW.md 못 씀). C.3은 분리 가능.
- 기존 TS 모듈 config도 계속 지원할지(즉 두 입력 모드 병존), WORKFLOW.md로 단일화할지. 기존 사용자(이미 있는 통합 테스트 등)를 깨고 싶지 않으니 **병존**이 안전.

완료 기준: Symphony elixir 레퍼런스의 `WORKFLOW.md`(tracker.kind만 gitlab으로 바꿔)를 로드해 일반 GitLab 흐름이 한 turn 이상 통과. WORKFLOW.md 수정 후 재시작 없이 다음 polling tick부터 새 prompt 반영. 통합 테스트 1건 추가 (실 GitLab + WORKFLOW.md fixture).

### [ ] 운영 도구 — observability + dashboard
배경: 현재 가시성은 stdout 로그뿐. 다중 에이전트가 동시 진행 중일 때 "어느 issue가 어느 phase에 있는지", "최근 에러는 무엇인지", "토큰 누계" 같은 질문에 즉답이 어렵다. 단순 production 운영도 어렵다.

상태 노출 두 surface:

**(a) HTTP endpoint** — 외부 의존성 0, 즉시 유용
- `GET /healthz` → `200` if orchestrator loop alive, `503` if shutdown 진행중. liveness probe.
- `GET /state` → JSON: `{ inFlight: [...], metrics: {...}, lastError: ... }`. Symphony Phoenix LiveView의 JSON 등가물.
- `GET /issues/:iid` → 해당 issue의 워커 상태 (있으면 turn/attempt + last note 시각).
- 구현: `node:http` 한 페이지. 외부 dep 0. configurable via `OrchestratorConfig.httpPort`.
- 상태 노출 위해 orchestrator 내부 리팩터 필요 — 현재 `run()` 함수 안의 `metrics`와 `inFlight`를 외부에서 read-only로 볼 수 있게 인스턴스화 (또는 observer 콜백).

**(b) OpenTelemetry export** — production observability
- metrics: `orchestrator.dispatched`, `.succeeded`, `.failed`, `.cancelled`, `.tokens.total` (Counter); `.in_flight` (UpDownCounter); `.turn.duration` (Histogram).
- spans: `orchestrator.process_issue` (root) → `agent.run` (child). attributes: `issue.iid`, `agent.name`, `turn.number`, `attempt.number`.
- 구현: `@opentelemetry/api` (interface 전용) + 사용자가 SDK 선택해 wire (Prometheus exporter, OTLP 등). 패키지는 SDK 강제 안 함 — 무거워짐.
- 트레이드오프: OTel 코드 추가는 cheap이지만, 정확한 attribute 합의는 future-proofing 비용. Phase 1로 (a)만 만들고, OTel은 별도 PR.

권고 phase 분할:
- **운영 도구.1**: HTTP `/healthz` + `/state` 만. 30분짜리 작업, 즉시 운영 가시성 확보.
- **운영 도구.2**: 같은 endpoint에 `/issues/:iid` 추가 + 워커 history short ring buffer.
- **운영 도구.3**: OpenTelemetry instrumentation. attribute 컨벤션 결정 후 착수.

오픈 질문:
- HTTP 서버를 orchestrator-gitlab에 in-process로 넣을지, 별도 sidecar 프로세스로 분리할지. **추천: in-process**, 단순 + 상태 공유 무료. shutdown signal로 함께 정리.
- Auth: dev에서는 unprotected, production에서는 `Authorization: Bearer <token>` 옵션 (config의 `httpAuthToken`).

완료 기준: `pulumi up`된 GitLab과 `orchestrator-gitlab run` 동시 가동 상태에서 `curl http://localhost:<port>/state | jq`로 in-flight 워커 수 + 최근 metrics가 정확히 보임. README에 endpoint 명세 + curl 예제.

---

## 잔여 보완 작업

### [x] 외부 OpenAPI artifact governance scaffold (NestJS Swagger, FastAPI 등)
배경: NestJS Swagger / FastAPI처럼 코드퍼스트로 OpenAPI를 생성하는 외부 프레임워크 산출물을 oa-sdk governance 파이프라인에 표준 방식으로 연결할 수단이 없었다.
완료 (2026-04-27): `oa-gen scaffold-governance` / `collect` / `normalize` / `upgrade` CLI 4종을 `@oa-sdk/codegen`에 추가. scaffold는 `openapi-governance.config.json` (artifact interface + consumer 매핑), `scripts/openapi-governance.sh` (collect/check/review/review-bundle/typegen/inventory/validate-upgraded/drift/update-baseline/all), `openapi-governance.md`를 생성하고 contracts/scripts/src 디렉토리를 만든다. `apps/nestjs-ref`(NestJS 10 + Swagger 7, `--profile nestjs-swagger`)와 `apps/fastapi-ref`(FastAPI 0.115 + Pydantic 2, `--profile fastapi`)를 두 레퍼런스 구현으로 추가했다 — 두 profile 모두 빈 `info.contact`/루트 `servers`/루트 `tags` noise 제거 동작을 공유한다.
하드닝:
- 스크립트가 `git rev-parse --show-toplevel`로 repo root를 자동 감지하고, baseline 미존재 시 `update-baseline` 힌트와 함께 친절한 exit 1을 낸다.
- `OA_GEN` 환경변수 split이 glob 확장하지 않도록 `read -ra OA_GEN_CMD <<<` 사용.
- `--runtime-openapi-url`을 scaffold 시 `URL` 파서로 검증해 http(s) 아닌 값을 거절.
- `--source-command`는 trusted 셸 입력임을 rendered 스크립트 주석으로 명시.
- `upgradeOpenApiDocumentTo32`가 `paths`/`webhooks`/`components.{schemas,responses,parameters,requestBodies,headers,callbacks,pathItems}`를 모두 재귀 순회하여 nullable 변환을 빠뜨리지 않는다.
- `cloneJson`은 `structuredClone` 사용으로 undefined 손실 방지.
완료 기준: 레퍼런스 앱에서 `bash scripts/openapi-governance.sh all`이 collect → check → review → typegen → validate-upgraded까지 통과하고, 신규 4 CLI는 manifest/api-index/feature-test-matrix gates와 정합. 신규 helper 4개와 type 8개를 `@oa-sdk/codegen` public surface로 등록함.

### [x] OAS 3.2 coverage table drift 정리
배경: `docs/internal/oas32-coverage.md`의 런타임 지원 표가 일부 최신 구현을 반영하지 못한다. `Webhooks`는 parser/router/client/mock-server 쪽 테스트가 있고, `Encoding`도 multipart field-level handling 구현이 완료됐지만 표에는 일부 `—`로 남아 있다.
작업:
1. `docs/internal/oas32-coverage.md`의 `Webhooks`, `Encoding`, 관련 parser/mock-server/codegen/router/client 칸을 실제 구현 상태와 맞춘다.
2. 근거 테스트 파일을 `feature-test-matrix.json` 또는 표 주석에 연결할지 결정한다.
3. `pnpm check:feature-tests`를 실행한다.
완료: `docs/internal/oas32-coverage.md`의 `Webhooks`와 `Encoding` row를 실제 parser/mock-server/codegen/router/client 지원 상태에 맞추고, 보강 근거 테스트 파일을 표 아래에 추가함.
완료 기준: coverage 표가 `docs/internal/spec.md`와 모순되지 않고, 지원 범위와 non-goal이 구분된다.

### [x] Feature-test matrix assertion depth 보강 검토
배경: `pnpm check:feature-tests`는 경로 존재와 glob 매칭을 검증하지만, 각 capability가 실제 assertion으로 보호되는지는 검증하지 않는다.
작업:
1. matrix feature별로 대표 테스트 1~2개가 핵심 assertion을 포함하는지 샘플 리뷰한다.
2. assertion gap이 큰 feature에는 더 구체적인 `testPaths`를 추가하거나 신규 테스트를 작성한다.
3. 필요하면 JSON schema 수준의 필드 규칙을 강화한다.
완료: `feature-test-matrix.md`에 assertion depth policy를 추가해 drift guard와 semantic test runner의 역할을 분리하고, broad glob row는 대표 테스트 파일을 명시해야 한다는 관리 규칙을 문서화함.
완료 기준: matrix가 단순 파일 존재표가 아니라 회귀 방지 의도를 설명하는 수준으로 유지된다.

### [x] Preview app coverage 정책 결정
배경: `apps/preview`는 문서에 노출되어 있지만 현재 feature-test matrix의 핵심 검증 대상에는 포함하지 않았다. 현재 cross-package E2E 증명은 `apps/playground`가 담당한다.
작업:
1. `apps/preview`를 제품 surface로 볼지, 데모/수동 확인 surface로 볼지 결정한다.
2. 제품 surface라면 최소 smoke test 또는 build/typecheck script를 추가한다.
3. 데모 surface라면 docs에 자동 검증 범위 밖임을 명시한다.
완료: `apps/preview`는 브라우저 수동 프리뷰 surface로 두고, 자동 E2E 보증은 `apps/playground`가 담당한다고 `docs/README.md`에 명시함.
완료 기준: preview app의 품질 책임이 문서와 CI에서 모호하지 않다.

### [x] JSON-RPC batch support 결정
배경: bun-graph-db MCP OpenAPI full document는 현재 single JSON-RPC request만 문서화한다. 서버도 batch request를 처리하지 않는다.
작업:
1. MCP server가 batch를 지원해야 하는지 결정한다.
2. 지원한다면 `McpHttpServer`와 table-scoped MCP server 모두에 batch 처리와 tests를 추가한다.
3. 지원하지 않는다면 docs에 single-request only 정책을 유지한다.
완료: 현재 정책은 single JSON-RPC request only로 유지한다. `bun-graph-db projection 소비` 가이드에 batch가 필요하면 서버 구현과 static OpenAPI document를 함께 확장해야 한다고 명시함.
완료 기준: static OpenAPI document와 실제 MCP server 동작이 계속 일치한다.

### [x] GraphQL OpenAPI wrapper 범위 결정
배경: bun-graph-db full document는 stable REST/MCP endpoint discovery에 집중한다. GraphQL introspection 또는 selected GraphQL operation wrapper는 future question으로 남아 있다.
작업:
1. `/graphql` 자체만 문서화할지, selected GraphQL operation을 REST/OpenAPI wrapper로 제공할지 결정한다.
2. wrapper가 필요하면 별도 PRD로 분리한다.
완료: 현재 static full document는 selected GraphQL operation을 OpenAPI wrapper로 확장하지 않는다. GraphQL은 projection fetch transport 중 하나로 유지하고, stable endpoint/client/mock 생성은 `GET /api/openapi` 또는 table projection snapshot을 기준으로 한다고 문서화함.
완료 기준: GraphQL과 OpenAPI full document의 경계가 문서상 모호하지 않다.

### [x] 운영 관찰: SQLite optional native dependency 설치성
배경: `better-sqlite3`는 증분 WorkspaceIndex의 primary driver지만 native optional dependency라 환경별 설치 실패 가능성이 있음.
이전 정책 (2026-04-17 ~ 2026-04-28): 설치 성공 시 `better-sqlite3` 사용, 실패 시 `node:sqlite`, 둘 다 실패하거나 DB 오류가 나면 full rebuild fallback + CLI warning.
현재 정책 (2026-04-28~): `node:sqlite`(Node 22+ 내장)를 우선 시도하고 `better-sqlite3`는 fallback. 호환성 영향: 기존 cache는 driver name meta가 다르므로 첫 실행 1회 cache invalidation + full rebuild이 일어나고 그 이후 정상.
시그널 #1 — Forced fallback 동작 검증 (2026-04-28): `packages/codegen/src/__tests__/workspace-index-fallback.test.ts`가 `Module._load`를 monkey-patch해 두 driver를 각각 / 양쪽 모두 require 실패시키며 `loadSqliteDriver()` + `createSQLiteWorkspaceIndex` lifecycle을 검증. 5 cases (better-sqlite3 fail → node:sqlite, full lifecycle, persistence across reopen, 양쪽 모두 fail 시 진단 메시지, node:sqlite fail → better-sqlite3) 모두 pass — fallback 경로에 hardening 필요한 결함 없음.
시그널 #2 — Driver 벤치마크 (2026-04-28, Node 24.15 / darwin arm64, 75 files × 5 components × 5 refs, median of 3): cold = better-sqlite3 22.2ms vs node:sqlite 26.6ms (15-17% 차이, 임계 30% 미달); warm = better-sqlite3 11.5ms vs **node:sqlite 7.9ms** (40-46% 더 빠름). 측정/스크립트는 `packages/codegen/scripts/bench-sqlite-driver.ts`, JSON은 `packages/codegen/.bench/sqlite-driver.json`(gitignored). 워크로드의 warm 경로가 incremental 도구의 일반 동작이라는 점에서 "better-sqlite3 우선" 정책의 perf 정당성이 사라짐 → 우선순위 inversion 결정.
완료 기준 충족: 두 시그널 확보 + 정책 변경 + 테스트/문서 갱신, codegen 655 tests / 48 files pass, repo gates(check:cli-spec/api-index/feature-tests) green.

### [x] 운영 관찰: Spectral response-example 힌트 4건
배경: `pnpm schema:validate`는 통과하지만 Spectral `response-example-recommended` hint가 4건 남아 있음.
현재 처리: 0 error / 0 warning / 4 hint로 문서화. schema correctness에는 영향 없음.
후속 기준: Prism/mock 예제 품질을 더 강화하기로 하면 `paths./users.get.responses[200]`, `components.schemas.Error`, `HealthStatus`, `User` 예제를 보강.
완료: `users` 목록 응답 inline schema와 `Error`, `HealthStatus`, `User` component schemas에 singular `example`을 추가해 Spectral `response-example-recommended` hint를 제거함. `pnpm --filter @oa-sdk/schemas run validate`, `pnpm --filter @oa-sdk/schemas test`, `pnpm check:feature-tests` 통과.

### [x] 운영 관찰: node:sqlite experimental warning in tests
배경: 실제 `SQLiteWorkspaceIndex`는 `better-sqlite3`를 primary로 잡지만, 일부 테스트 헬퍼가 DB meta 확인용으로 `node:sqlite`를 직접 열어 warning이 출력됨.
현재 처리: 기능 실패는 아니며 `better-sqlite3` driver 사용은 수동 검증 완료.
후속 기준: 테스트 로그 소음을 줄여야 하면 테스트 헬퍼도 selected driver adapter를 재사용하도록 정리.
완료: `workspace-index.test.ts`의 SQLite meta 확인 helper가 직접 `node:sqlite`를 require하지 않고 `loadSqliteDriver().open()`을 사용하도록 변경함. `pnpm --filter @oa-sdk/codegen test -- src/__tests__/workspace-index.test.ts`와 `pnpm --filter @oa-sdk/codegen typecheck` 통과, experimental warning 출력 없음.

---

## 완료된 실행 항목

### [x] Definition Builder Domain Backfill: current merge source inventory
배경: current domain specs를 fragment equivalents로 backfill하기 전에 현재 merge input surface를 빠짐없이 고정해야 함.
완료: [domain-merge-inventory.md](./domain-merge-inventory.md)에 `src/profiles/{local,staging,production}.yaml`, `src/domains/{common,health,users}/spec.yaml`, common shared components, health/users path operations, `.merged.yaml`/`.merged.3.1.yaml` artifact path, validation commands, and source-section-to-fragment-kind mapping을 기록함.
완료 기준: 후속 parity target, common fragment, health fragment, users fragment stories가 동일 checklist를 기준으로 migration completeness를 검증할 수 있음.

### [x] OpenAPI definition builder: migration comparison plan
배경: 현재 `packages/schemas/scripts/merge.ts`를 즉시 제거하지 않고 새 builder를 병렬 검증해야 함.
완료: `docs/internal/spec.md`에 current domain merge path와 `oa-gen build-spec` builder path를 side-by-side로 문서화하고, current `openapi.yaml`/profile/domain sections가 어떤 fragment/target source로 이동하는지 정의함. `.merged.yaml`은 OpenAPI 3.2 canonical validation input으로, `.merged.3.1.yaml`은 기존 downgrade sidecar contract로 유지해야 한다는 compatibility gate를 명시함.
완료 기준: rollback은 현재 `merge.ts`/schema scripts를 source-of-truth로 유지하는 방식이며, builder output은 모든 current source section이 fragment equivalent를 갖고 diagnostics/validation/normalized diff/downstream codegen diff가 승인된 뒤에만 `.merged.yaml`을 대체할 수 있음.

### [x] OpenAPI definition builder: WorkspaceIndex metadata integration
배경: large spec build에서 fragment-level 변경이 모든 target bundle을 무조건 dirty 처리하지 않도록, builder가 target/fragment dependency metadata를 WorkspaceIndex에 남겨야 함.
완료: `@oa-sdk/codegen`에 builder index adapter를 추가해 target config와 definition fragment source 파일을 scan하고, fragment id/content hash는 `definition-fragment` component row로, target bundle은 `definition-target` component row로 기록한다. Fragment source `$ref`는 fragment file → target fragment file `refs` edge로 저장하고, target config는 direct path root fragment로 향하는 edge를 저장한다.
완료 기준: schema fragment 변경이 fragment ref graph를 거쳐 dependent target만 dirty 처리되는 테스트, target config 변경이 해당 target만 dirty 처리되는 테스트, no-op fallback에서 scanned target을 full rebuild 대상으로 취급하는 테스트가 통과함. SQLite schema shape는 변경하지 않아 existing ADR-006 driver fallback/full rebuild 원칙을 유지한다.

### [x] OpenAPI definition builder: CLI artifact build entry
배경: target selection과 OpenAPI emit이 parser에 구현되었으므로 로컬/CI에서 target config를 지정해 builder artifact와 sidecar reports를 생성할 entry가 필요함.
완료: `@oa-sdk/codegen` CLI에 `oa-gen build-spec --target ...` 커맨드를 추가함. Target config sibling `../fragments`를 기본 fragment root로 사용하고 `--fragments`로 override할 수 있으며, valid build는 `--output` OpenAPI YAML artifact 또는 stdout으로 출력한다. `--diagnostics`는 registry/target/output-name/emit diagnostics JSON을 실패 시에도 기록하고, `--collision-report`는 target-local naming collision report row array를 machine-readable JSON으로 기록한다. `--metadata-registry`는 output pointer별 internal metadata, identity/stable key, tracking id, source refs, example source pointers를 기록하고 duplicate output pointer/tracking/stable key, invalid tracking id, invalid replacement id를 diagnostics로 승격한다.
완료 기준: duplicate canonical id, missing/unsupported source ref, target disallowed ref, output name collision, unrewritten ref, emitted document validation error가 있으면 output artifact를 쓰지 않고 exit code 1로 종료함. CLI tests가 success artifact/report 생성, duplicate canonical ID failure, unresolved required ref failure를 검증함. Public package exports는 변경하지 않아 `docs/internal/api-index.md` 업데이트는 불필요함.

### [x] OpenAPI definition builder: OpenAPI document emit
배경: target selection 결과를 기존 `.merged.yaml` 교체 없이 병렬 검증 가능한 OpenAPI 3.2 artifact로 만들 수 있어야 함.
완료: `emitDefinitionOpenApiDocument()`가 selected target result를 받아 root `openapi`/`info`/`servers`/`paths`/`webhooks`/`components` document를 생성함. Emit은 target-local output name allocation을 ref rewrite에 주입하므로 output에는 local OpenAPI `$ref`만 남고, source ref가 남으면 `definition-openapi-emit/unrewritten-ref` error diagnostic으로 실패함. `itemSchema`, `dataValue`, `serializedValue` 같은 OAS 3.2 field는 content filter 없이 보존하며, renamed definition alias metadata는 `x-oa-sdk-definition-aliases` root extension과 result sidecar report에 포함함.
완료 기준: emitted document가 `validateDocument()`를 통과하는 parser 테스트, book/notebook `Note` source-name collision이 `BookNote`/`NotebookNote`로 materialize되는 테스트, public book+notebook fixture target 검증이 통과함. 기존 `.merged.yaml` 교체는 후속 CLI/migration story로 남김.

### [x] OpenAPI definition builder: target bundle configuration and selection
배경: public/admin/internal target별로 선택된 scopes, domains, servers, paths만 후속 OpenAPI emit에 넘길 수 있어야 함.
완료: `DefinitionTargetConfig` format을 `name`, `scopes`, `domains`, `servers`, `includePaths`, optional `namingPolicy.aliases`로 고정하고, `selectDefinitionTarget()`가 exact path match에서 시작해 registry ref edge를 재귀 순회함. Shared + target-specific scopes를 함께 선언할 수 있으며, configured scope/domain 밖의 recursive ref는 `definition-target/disallowed-ref`, 매칭되지 않는 include path는 `definition-target/path-not-found` error diagnostic으로 보고함. Selection 결과는 selected nodes/refEdges/directPathIds와 target-local `allocateDefinitionOutputNames()` 결과를 함께 제공함.
완료 기준: public/admin target selection이 각각 직접 매칭된 path와 shared + target-specific schema/parameter/response/requestBody refs를 포함하고 반대 target node를 제외하는 parser 테스트, target-local naming alias가 다른 target으로 새지 않는 parser 테스트, public/admin/internal target fixture shape 검증이 통과함.

### [x] OpenAPI definition builder: duplicate and dedupe policy
배경: structural similarity가 semantic identity를 암시하지 않도록 canonical id, output name, schema hash 중복 정책을 명시해야 함.
완료: registry가 duplicate canonical id를 계속 error로 처리하고, 같은 schema content hash가 다른 canonical id에서 발견되면 기본 `info` severity의 `definition-registry/structural-duplicate` diagnostic만 생성하도록 함. `nodes`와 `nodeById`는 canonical id별로 유지되어 동일 shape라도 다른 의미의 정의는 자동 병합되지 않음. 의도적 semantic dedupe는 `metadata.semanticAliasOf`가 등록된 canonical id 또는 `oa://...` ref를 가리킬 때만 `semanticAliases`로 기록됨.
완료 기준: 동일 shape/different meaning이 별도 registry node로 남고 info diagnostic만 생성되는 테스트, explicit semantic alias metadata만 structural duplicate warning을 suppress하고 alias metadata를 생성하는 테스트, 기존 duplicate output name collision/naming policy 테스트가 통과함.

### [x] OpenAPI definition builder: path flattening guard simulation
배경: `schema:public/a/Name`과 `schema:public/aname/Name`처럼 canonical path가 다른 정의가 naive flattened output name에서 같아져도 semantic identity가 같다고 추론하면 안 됨.
완료: `schema:public/a/Name`, `schema:public/aname/Name`, `schema:public/a-name/Name`, `schema:admin/a/Name` fixture를 추가하고 public/admin target fixture에 포함함. Parser 테스트는 네 canonical ID가 registry에서 모두 distinct node로 유지되는 것을 확인한 뒤, 세 public fixture가 모두 attempted output name `AName`으로 매핑되는 flattened naming simulation을 실행해 `definition-output-name/collision` diagnostic과 `collisionReport`의 `output-name-collision` error row를 검증함.
완료 기준: collision diagnostic은 attempted output name과 모든 colliding canonical IDs를 포함하며, default fail-on-collision policy에서 builder가 semantic dedupe나 임의 rename 없이 실패함.

### [x] OpenAPI definition builder: output naming and collision simulation
배경: 같은 local name `Note`라도 book note와 notebook note는 의미가 다를 수 있어 source 정의를 바꾸지 않고 output naming으로 충돌을 해결해야 함.
완료: `allocateDefinitionOutputNames()`가 target에 포함된 component-like registry node 집합 안에서 output name을 할당함. Explicit alias가 있으면 우선 적용하고, alias가 없는 unique local name은 preserve-if-unique로 보존하며, 같은 kind/local name이 target 안에서 충돌하면 domain-prefix로 `BookNote`/`NotebookNote`처럼 분리함. 결과는 canonical id → output name map, canonical id → policy reason 포함 alias metadata map, target name/scope/domain/localName/outputName/reason/severity를 담은 machine-readable collision report를 제공하고, 최종 output name collision은 자동 병합하지 않고 `definition-output-name/collision` error diagnostic으로 보고함.
완료 기준: unique name preserve, cross-domain local name collision, explicit alias, public/admin target fixture 기반 target-local report, output ref rewrite 연동이 parser/schemas 테스트로 검증됨. Full target fixture emit은 다음 target bundle emit 단계에서 다룸.

### [x] OpenAPI definition builder: output ref rewrite
배경: registry graph는 source `$ref`를 canonical id로 정규화하지만, 실제 build output은 canonical id를 target-local OpenAPI `$ref`로 rewrite해야 함.
완료: `rewriteDefinitionOutputRefs()`가 registry의 resolved `targetId`를 사용해 nested fragment content와 refs의 source `$ref`를 OpenAPI component `$ref`로 변환함. Schema/response/parameter/requestBody/header/link/callback/securityScheme은 각각 `#/components/schemas`, `#/components/responses`, `#/components/parameters`, `#/components/requestBodies`, `#/components/headers`, `#/components/links`, `#/components/callbacks`, `#/components/securitySchemes`로 매핑하며, output name map/callback으로 target-local alias를 주입할 수 있음.
완료 기준: nested canonical/file ref rewrite, 모든 component-like kind 위치, `oa://` 미포함 output refs, diagnostic source path/pointer 보존이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: canonical/file source ref resolution
배경: fragment source는 emitted OpenAPI component name이 아니라 canonical concept identity를 참조해야 함.
완료: registry가 `oa://{kind}/{scope}/{domain}/{name}` source ref를 `kind:scope/domain/name` canonical id로 정규화하고, registered definition source와 일치하는 상대 file ref도 canonical id로 해소함. Missing target은 `definition-registry/missing-ref`, legacy/internal/invalid canonical ref는 `definition-registry/unsupported-ref` diagnostic으로 보고하며 raw ref와 source path/pointer, optional line/column을 보존함.
완료 기준: canonical ref, relative file ref, missing ref, unsupported ref, nested transitive ref resolution이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: registry graph + ref edge collection
배경: `$ref`는 구성요소 정의를 연결하는 그래프 edge이므로 build 전에 fragment registry에서 raw source refs와 duplicate id를 분석해야 함.
완료: `@oa-sdk/parser`에 public `DefinitionRegistry`, `DefinitionRegistryRefEdge`, `DefinitionRegistryDiagnostic` 모델과 `createDefinitionRegistry()` / `collectDefinitionRefs()`를 추가함. Registry는 unique canonical id node map을 만들고 duplicate canonical id를 error diagnostic으로 보고하며, fragment content를 JSON Pointer-aware traversal로 순회해 `$ref` edge와 canonical `oa://...` target id를 수집함.
완료 기준: node registration, ref edge collection, duplicate canonical id rejection이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: fragment definition node model
배경: Canonical ID가 확정되었으므로 각 fragment가 source metadata, refs, content hash, classification metadata를 운반할 node 모델이 필요함.
완료: `@oa-sdk/parser`에 public `DefinitionNode`, `DefinitionRef`, `DefinitionMetadata` 타입과 `createDefinitionNode()` / `createDefinitionRef()` 생성 helper를 추가함. node 생성은 canonical id에서 kind/scope/domain/localName을 파생하고 source path/pointer, content hash, optional metadata, refs를 보존함.
완료 기준: definition node construction과 source metadata preservation이 parser 테스트로 검증됨.

### [x] OpenAPI definition builder: canonical ID grammar
배경: OpenAPI fragment source identity를 output component name과 분리하려면 고정 canonical id 문법이 필요함.
완료: `@oa-sdk/parser`에 `kind:scope/domain/name` parser/validator를 추가하고 supported kind, lower-case scope/domain, component-like PascalCase name, malformed/nested id, duplicate canonical id diagnostic을 테스트함. `@oa-sdk/schemas`에 `schema:public/book/Note`, `schema:public/notebook/Note`, `schema:shared/common/Error` fixture를 추가함.
완료 기준: source identity와 output component name 분리가 문서화되고 malformed/nested/duplicate canonical id가 error로 검출됨.

### [x] router/client: ResponseHeaders 활용
배경: typegen은 `XxxResponseHeaders`를 생성하지만 router/client 런타임 API는 아직 타입을 적극 활용하지 않음.
진행: router는 문서화된 응답 헤더가 있으면 `Partial<XxxResponseHeaders>` placeholder와 Hono/Express 공용 header setter helper를 생성해 handler stub에서 타입 힌트를 제공함.
완료: client는 문서화된 응답 헤더가 있는 non-streaming operation에 `withResponse.<operation>()`을 생성해 기존 body 반환 메서드는 유지하고 `{ body, headers, response }` 형태로 typed `XxxResponseHeaders` 접근을 제공함. Header lookup은 Fetch `Headers` 기반 case-insensitive 조회와 fallback 순회를 사용하며, 누락된 optional header는 결과에서 생략됨.
완료 기준: 생성된 Op 타입의 `headers`가 router/client 사용 예제와 테스트에서 실제로 소비됨.

### [x] 리뷰 보완: lint source pointer escaping
문제: `paths` 아래 lint path가 JSON Pointer escape 되지 않아 `/bad`가 `#/paths//bad/get`처럼 기록되고 YAML line/column lookup이 실패함.
완료: lint path 생성에 JSON Pointer escaping helper를 적용해 `#/paths/~1bad/get`로 source lookup되며, CLI validate/lint가 `file:line:column`을 출력함.

### [x] 리뷰 보완: SQLite fallback visibility
문제: `--incremental` 사용 시 SQLite open 실패가 조용히 full rebuild로 fallback되어 사용자가 persistent cache 사용 여부를 알기 어려움.
완료: SQLite fallback reason을 CLI warning으로 출력.

### [x] 리뷰 보완: type alias metadata persistence
문제: `type_aliases` table/schema는 있었지만 CLI typegen 경로에서 external alias metadata를 기록하지 않음.
완료: `ExternalSchemaTypeAlias` metadata를 `analyzeExternalSchemaRefs()`에서 생성하고, `oa-gen typegen --incremental`이 WorkspaceIndex `type_aliases`에 기록.

### [x] 리뷰 보완: SQLite driver policy
문제: `node:sqlite`와 `better-sqlite3`가 같은 DB 파일을 번갈아 열 때 cache 안정성 정책이 명시되지 않음.
완료: `better-sqlite3`를 primary optional driver로 추가하고, `node:sqlite` fallback을 유지. `meta.driver_name`을 저장해 driver 변경 시 index row를 비우고 한 번 full rebuild diff를 강제.

---

## 단기 미구현 스펙

### 7. [x] Encoding — multipart 필드별 인코딩
배경: 타입은 준비됐지만 request-validator multipart 파싱과 필드별 `contentType`/`style` 처리는 남아 있음.
작업: multipart part 단위 decoding과 OpenAPI Encoding Object 규칙을 request validation에 연결.
완료: mock-server multipart 파서가 part별 Content-Type/header metadata를 보존하고, request validator가 Encoding Object의 필드별 `contentType` 검증, JSON part decoding, `form` style `explode=false` 배열/객체와 배열 `explode=true` 처리를 수행함. 지원하지 않는 object style/explode 조합은 `PROTOCOL_MISMATCH` diagnostic으로 명시적으로 실패한다.
완료 기준: 필드별 content type, style/explode, 잘못된 part encoding 실패 케이스가 테스트됨.

### 8. [x] Links — 응답 관계 정보
배경: Links는 타입과 파싱은 완료됐지만 mock 응답과 typegen 소비는 아직 얕음.
작업: Operation Object의 Link 정보를 mock 응답 메타데이터와 typegen Link 타입으로 연결.
완료: typegen이 성공 응답 Link Object를 `XxxResponseLinks` 타입으로 생성하고 Op bundle에 `responseLinks` 메타데이터 필드를 포함한다. mock-server `pickResponse()`는 선택된 응답의 resolved Link Object를 `PickedResponse.links`로 노출하며, HTTP 어댑터는 link metadata를 body payload에 주입하지 않는다.
완료 기준: 응답에서 다음 operation 관계를 추적할 수 있고, Link 타입 생성 테스트가 있음.

### 9. [x] Callbacks — 아웃바운드 웹훅
배경: Callbacks는 타입과 파싱은 완료됐지만 mock-server에서 outbound 호출 시뮬레이션이 없음.
작업: callback URL expression 평가와 mock outbound POST 흐름을 설계하고 테스트 헬퍼로 노출.
완료: mock-server 성공 응답에서 Operation callbacks를 읽어 지원 runtime expression(`$url`, `$method`, `$statusCode`, `$request.path/query/header/body`, `$response.header/body`)을 평가하고, callback Path Item의 `post` requestBody를 기존 mock body 생성 우선순위로 payload화해 simulated outbound POST attempt로 노출한다. MSW/Node 옵션의 `onCallback` hook과 `createCallbackTracker()` 테스트 헬퍼로 성공/실패 attempt를 관찰할 수 있으며, URL 미해결/invalid 표현은 inbound 응답을 실패시키지 않고 attempt error metadata로 기록한다.
완료 기준: 요청 처리 후 callback route로 payload를 보내는 성공/실패 시나리오가 테스트됨.

### 10. [x] XML 직렬화
배경: XML 타입은 준비됐지만 `application/xml` body parsing/serialization은 미지원.
작업: XML Object 규칙, request body parsing, response serialization 범위를 최소 지원부터 정함.
완료: mock-server가 `application/xml` 요청을 element-only XML로 파싱하고 schema-aware primitive coercion/object/array 검증을 수행한다. 응답은 같은 최소 범위로 XML 문자열을 직렬화하며 MSW/Node adapters의 content-type별 응답 serialization에 연결했다. 지원 범위는 object child elements, repeated element arrays, primitive text, `xml.name` element rename이며 attributes, namespaces/prefixes, CDATA/text node modeling, non-element `nodeType`, wrapped array semantics는 non-goal로 두고 request validation/preflight에서 명확한 diagnostic을 반환한다.
완료 기준: 기본 object/array XML 직렬화와 content-type negotiation 테스트가 있음.

---

## 최근 완료

### [x] Links 응답 관계 메타데이터
성공 응답의 Link Object를 typegen `XxxResponseLinks` 타입과 Op bundle `responseLinks` 필드로 생성한다.
`parameters`와 `requestBody` runtime expression 문자열은 literal metadata type으로 보존한다.
mock-server 응답 선택 결과는 `links` 메타데이터를 노출하되, HTTP 응답 body semantics는 그대로 유지한다.

### [x] Callbacks outbound simulation
Operation callbacks의 URL runtime expression을 요청/응답 컨텍스트에서 평가하고 callback `post` requestBody를 mock payload로 생성한다.
실제 네트워크 호출 대신 `CallbackPostAttempt` metadata를 생성하며, `onCallback` hook과 `createCallbackTracker()`로 테스트에서 outbound webhook behavior를 관찰한다.
미해결 또는 invalid URL expression은 inbound mock response를 유지하면서 attempt error metadata에 기록한다.

### [x] codegen: TypegenOptions/SchemaToTsOptions 공개 API 정리
`TypegenOptions`는 `generateTypes*()`가 root entry에서도 공개되어 있으므로 `@oa-sdk/codegen`과 `@oa-sdk/codegen/typegen` 양쪽에서 지원한다.
`schemaToTs()`도 양쪽 entry에서 공개된 함수이므로 `SchemaToTsOptions`를 같은 두 entry에서 public type으로 export한다.
package exports는 `.`, `./drizzle`, `./typegen`만 유지해 `@oa-sdk/codegen/typegen/schema-to-ts` 같은 deep implementation import는 비공개로 둔다.
공개 옵션 타입 import와 비공개 deep subpath 정책은 codegen public API 테스트와 API index에 반영했다.
package import fixture가 `@oa-sdk/codegen` / `@oa-sdk/codegen/typegen`의 `TypegenOptions`와 `SchemaToTsOptions` import를 typecheck하고, API index validation도 typegen option subpath 정책을 검증한다.

### [x] diagnostics: YAML line/column source map
YAML AST range와 `LineCounter`를 사용하는 `createSourceLocationIndex()` / `createYamlSourceLocationIndex()`를 parser public API로 추가.
object key, array index, nested schema pointer를 `filePath` + JSON Pointer + line/column으로 조회할 수 있고, JSON 입력은 YAML 전용 metadata 없이 빈 index로 유지한다.
`oa-gen lint`/`oa-gen validate` 출력은 source mapping이 있으면 `file:line:column`을 보여주며, target `file#pointer` fallback은 계속 포함한다.
Ref graph, lint, schema meta validation diagnostic 구조도 mapping이 있으면 source `line`/`column`을 보존한다.
증분 WorkspaceIndex 기록도 YAML source_locations와 diagnostic line/column을 함께 보강한다.

### [x] codegen: 외부 `$defs` / 비 components schema alias 정책
외부 YAML/JSON schema-position `$ref` alias 정책을 components-only에서 schema object target으로 확장.
`#/components/schemas/*`, `#/$defs/*`, `#/schemas/*`, `#/models/*` 같은 비 components schema root는 generated alias로 정규화한다.
alias 이름은 JSON Pointer 마지막 segment를 사용하고, 기존 file-stem 기반 deterministic rename과 resolver diagnostic/source metadata 보존 규칙을 유지한다.
`$defs`와 비 components root의 nested internal ref도 absolute file+pointer identity로 rewrite해 source 외부 문서 기준 alias를 가리키도록 테스트로 고정.
operation 생성 타입과 충돌하는 외부 alias도 file-stem 기반 deterministic rename을 사용하고, 지원하지 않는 외부 pointer root는 경고와 함께 `unknown`으로 생성한다.

### [x] codegen CLI: 증분 validate/typegen 연결
`oa-gen validate`와 `oa-gen typegen`에 opt-in `--incremental --cache-dir` 옵션을 추가.
두 커맨드와 `oa-gen dev` watch mode가 공통 CLI incremental helper를 통해 scan → dirty detect → refs.to_file reverse invalidation → output generation → index refresh 순서를 공유.
단발 validate/typegen 기본 실행은 SQLite를 사용하지 않는 full rebuild 출력 경로로 유지하며, 증분 CLI 테스트에서 full rebuild 출력과 일치함을 검증.

### [x] codegen CLI: dirty detection and dependency invalidation primitive
entry spec, domain spec, profile spec, external ref 파일을 absolute path + realpath + size + mtime + sha256으로 scan하는 helper를 추가.
WorkspaceIndex와 비교해 new/modified/deleted/unchanged를 분류하고, changed/deleted target의 `refs.to_file` 역방향 source file을 dirty로 전파한 뒤 stale index row invalidation 입력으로 사용.
외부 ref 파일 변경이 참조 spec을 dirty 처리하는 사례와 deleted file diagnostic 제거 사례를 테스트로 고정.

### [x] codegen CLI: SQLiteWorkspaceIndex 구현
`.oa-cache/state.sqlite` 기본 경로에 `meta`, `files`, `components`, `refs`, `source_locations`, `diagnostics`, `type_aliases` 테이블을 생성하는 `SQLiteWorkspaceIndex`를 추가.
WAL, busy timeout, foreign key, transaction-wrapped write를 적용하고 `schema_version`/option compatibility metadata mismatch 또는 DB 오류 시 full rebuild fallback으로 전환.
schema init, version/options mismatch, rollback, fallback 테스트를 추가.

### [x] codegen CLI: WorkspaceIndex 인터페이스 도입
parser correctness와 분리된 `WorkspaceIndex` 경계를 `@oa-sdk/codegen`에 추가.
file hash/component/ref/source location/diagnostic/type alias metadata 모델과 noop/memory 구현을 제공.
기본 noop index는 scan 입력 전체를 changed로 반환해 기존 full rebuild 동작을 유지하며, parser 패키지는 SQLite 의존성을 갖지 않음.

### [x] codegen: external ref source identity 정규화
`analyzeExternalSchemaRefs()`가 shared `resolveRefGraph()` 결과만 사용하고 별도 `derefSpec()` fallback을 제거.
entry 문서 raw ref는 기존 override로 유지하되, 외부 schema 내부 nested ref는 absolute file+pointer identity로 정규화해
같은 raw relative ref 문자열이 서로 다른 source document에서 다른 파일을 가리키는 경우에도 안정적으로 타입 alias에 연결.
missing/read/pointer 실패 diagnostic은 resolver code와 sourceFilePath/sourcePointer/filePath/pointer를 유지.
이름 충돌/로컬 shadow rename warning은 resolved file+pointer와 생성 타입명을 포함.

### [x] parser/codegen: ref resolver 단일화 심화
`resolveRefGraph()`와 `derefSpec()`가 parser 내부 `RefResolver` contract를 공유하도록 정리.
외부 YAML/JSON 문서 로딩, JSON Pointer 해소, cache key/document cache key, source pointer, file/pointer metadata,
missing/circular/read-failed diagnostic을 `RefResolution` 결과 객체에서 일관되게 제공. public parser index export는 변경하지 않음.

### [x] parser: Schema Object 메타 검증 추가
`validateDocument()`에서 OpenAPI 문서 내 Schema Object를 수집하고 JSON Schema 2020-12 메타스키마로 검증.
잘못된 `type`, `minimum`, `items` 등 스키마 키워드 자체의 정합성을 `schema/meta-valid` 에러로 보고.

### [x] mock-server: AJV schema compile 실패를 검증 에러로 노출
요청 body/parameter 검증 시 미해결 `$ref` 또는 잘못된 Schema Object가 있으면 검증을 건너뛰지 않고
`SCHEMA_COMPILE_ERROR`로 반환.

### [x] parser: 손실 없는 $ref 정규화
JSON Schema 2020-12 기준으로 `$ref` sibling keyword 보존, 외부 YAML/JSON ref 해소, cycle diagnostic,
source pointer 추적을 포함하는 resolver로 확장. `resolveRefGraph()`와 `cycleStrategy`까지 구현 완료.

### [x] schemas: schema:validate와 oa-gen validate 검증 범위 통합
로컬 `pnpm schema:validate`와 CI `oa-gen validate`가 같은 표준 파이프라인을 타도록 정리.

### [x] schemas: component overwrite 기본 차단
도메인 병합 시 중복 component key는 기본 오류. `ALLOW_COMPONENT_OVERRIDES=1` 또는 `ALLOW_COMPONENT_OVERRIDE_KEYS`로 명시 허용.

### [x] codegen: operation 묶음 타입 생성
`typegen/generate-types.ts`에서 Operation 묶음 타입 생성 완료.
`type XxxOp = { method, path, params, query, body, response, headers }`.

### [x] mock-server: Server variables 적용
`resolveServerUrl()` client에서 연결 완료. 서버 변수 해소로 동적 baseUrl 지원.

---

## 완료 항목

<details>
<summary>접기 (65+개)</summary>

- [x] Phase 1~6 전체 구현 (schemas/parser/mock-server/codegen/router/client)
- [x] Tags 계층 describeApi + resolveServerUrl + ResponseHeaders typegen + Discriminator AJV
- [x] Security 검증 (bearer/apiKey/oauth2/oidc/mTLS/AND/OR)
- [x] 자체 린터 + validateDocument + 3.2↔3.1 변환 (사이드카)
- [x] createTestClient + createCoverageTracker + Query API
- [x] @oa-sdk/core + 중복 함수 통합 + 타입 캐스트 정리
- [x] dataValue: null 버그 수정 + 문서 drift 수정
- [x] 819 테스트 + 16 커밋 + 문서 SSOT/가이드 분리 + traceability
- [x] Operation 묶음 타입 (codegen typegen)
- [x] Server variables 해소 (client resolveServerUrl 연결)
- [x] RouteFilter (mock-server filterRouteIndex)
- [x] Content-type aware router 스텁 + security requirement hints
- [x] NDJSON vs SSE 스트림 분리 (client)
- [x] 899 테스트 (parser 120, codegen 197, mock-server 508, playground 38, router 18, client 18)
- [x] Webhooks — router/client/mock-server 웹훅 핸들러 스텁/타입/라우트 병합
- [x] additionalProperties → Record<string, T> + index signature (typegen)
- [x] Hono 타입드 라우터 — 응답/바디 타입 캐스팅 (as any 제거)
- [x] MSW override — createMswMockServer() + override/clearOverride/clearOverrides
- [x] Client middleware — onRequest/onResponse/onError 인터셉터
- [x] ZodLazy → $ref 재귀 스키마
- [x] Error body 타입 (4xx/5xx → ${baseName}Error + Op 번들 포함)
- [x] CLI dev watch 모드
- [x] External $ref 기본 지원 (상대 파일 경로)
- [x] matchRoute regex 캐시 (WeakMap)
- [x] if/then/else 스키마 (anyOf 시맨틱)
- [x] 브라우저 번들 (@oa-sdk/mock-server/browser)
- [x] 프리뷰 웹앱 (apps/preview) — Service Worker 기반 mock 서버 + 코드 생성 미리보기
- [x] 어댑터 중복 제거 (generateStreamChunks, mergeWebhookRoutes, parseQueryParams 공유화)
- [x] 테스트 픽스처 공유 (specs.ts)
- [x] schemas 스크립트 테스트 (merge/downgrade/upgrade)
- [x] 1141 테스트 (parser 128, codegen 218, mock-server 553, playground 114, router 28, client 27, schemas 73)
- [x] CI 자동화 (GitHub Actions: build/typecheck/test/validate/freshness/spec-diff/api-index)
- [x] CLI 커맨드 모듈 분리 (commands/*.ts + lib/ 공유 유틸)
- [x] typegen 개선 (제약→JSDoc, readOnly→readonly, deprecated→@deprecated, annotations 옵션, const 중첩 수정, schema/Op 중복 방지)
- [x] mock-server allOf merge 수정 (branches[0] → 전체 merge)
- [x] schema annotations 컨벤션 ($comment + annotations 객체)
- [x] 1487 테스트 (core 51, parser 171, codegen 454, mock-server 553, playground 114, router 35, client 36, schemas 73)
- [x] ref graph resolver + 외부 `$ref` source diagnostic + cycleStrategy
- [x] component overwrite 기본 오류 + external schema name collision warning
- [x] 1577 테스트 (core 51, parser 190, codegen 464, mock-server 561, playground 114, router 35, client 36, schemas 73, typia-mock 53)
- [x] 1594 테스트 (core 51, parser 196, codegen 473, mock-server 561, playground 114, router 35, client 36, schemas 75, typia-mock 53)
- [x] 1676 테스트 (core 52, parser 230, codegen 495, mock-server 580, playground 114, router 36, client 39, schemas 77, typia-mock 53)

</details>
