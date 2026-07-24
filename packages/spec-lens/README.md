# @oa-sdk/spec-lens

OpenAPI 스펙 변경 이력 관리·관측 서버 패키지. TypeSpec production project와
Definition Builder rollback project를 구분하는 project identity를 제공한다.

git 소스(GitHub / GitLab / 로컬 git)에서 project source 변경 이력을 수집하고, 커밋별 스냅샷 빌드·diff 계산·Read Model 갱신을 수행하며, Hono HTTP API로 제공한다. 브라우저 UI(`apps/spec-lens`)가 이 API를 소비한다.

**전체 사용 가이드**: [`docs/spec-lens/README.md`](../../docs/spec-lens/README.md)

---

## 실행

```bash
# 설정 파일 자동 감지 (spec-lens.config.yaml) 또는 스키마 경로 자동 감지
pnpm exec tsx src/cli.ts

# 직접 실행 (빌드 후)
node dist/cli.js
```

`spec-lens.config.yaml` 예시:

```yaml
source: local-git
project:
  kind: definition-builder
  sourceRoot: packages/schemas/src/fragments
  targetPath: packages/schemas/src/targets/book-notebook-api.yaml
port: 4891
dbPath: .spec-lens.db
```

기존 top-level `fragmentsDir` / `targetPath` 설정도 동일한
`definition-builder` project로 변환되어 계속 동작한다. TypeSpec production
bundle은 다음 판별 설정으로 식별한다.

```yaml
project:
  kind: typespec-bundle
  sourceRoot: packages/schemas/typespec
  manifestPath: packages/schemas/typespec/oa-sdk.typespec-bundle.json
```

TypeSpec bundle은 historical revision마다 격리된 임시 workspace에서 컴파일한
뒤 OA SDK extension/sidecar restore·validation·expected diff를 거쳐
`spec-lens.snapshot.v2`로 저장한다. revision의 `tspconfig`는 실행하지 않으며,
고정 `@typespec/openapi3` config와 검토된 TypeSpec import allowlist만 사용한다.
Revision content read에는 codegen-owned `oa-sdk.spec-lens.source-read-budget.v1`이
필수다. Canonical 상한은 256 files, 2 MiB/file, 16 MiB total, concurrency 4이고
adapter와 codegen admission이 같은 policy를 각각 검증한다. TypeSpec read는
개별 파일을 skip하지 않으므로 count/size/stream/root containment/read failure 중
하나라도 발생하면 partial snapshot 없이 revision 전체가 실패한다. GitLab은
`Content-Length`를 aggregate accounting의 신뢰값으로 사용하지 않고 모든 body에
per-file ceiling을 예약한다. full reservation이 불가능한 마지막 body만 남은 capacity를
독점한다. Tracker-global EOF/overflow probe는 file 또는 aggregate cap 밖에서 최대
1 byte만 소비하며 그 byte는 저장하지 않는다. 실패 시 header-pending fetch를 abort하고
active reader와 queued read를 중단한 뒤 worker 정리를 기다린다.

---

## 패키지 구조

```
src/
├── domain/            표준 데이터 포맷 타입
│   └── types.ts       SpecRevision, SpecSnapshot, SpecTimelineDiff, ...
├── application/
│   ├── ports/         아웃바운드 포트 인터페이스
│   │   ├── spec-source.port.ts      git 소스 어댑터 계약
│   │   ├── snapshot-builder.port.ts 스냅샷 빌드·diff 계약
│   │   └── cache.port.ts            저장소 계약 (clearCache 포함)
│   ├── commands/      쓰기 핸들러 (Command)
│   │   └── refresh-timeline.command.ts
│   └── queries/       읽기 핸들러 (Query)
│       ├── get-timeline.query.ts
│       ├── get-snapshot.query.ts
│       ├── get-diff.query.ts
│       ├── get-paths.query.ts
│       └── get-graph.query.ts
├── infrastructure/    포트 구현체
│   ├── source-adapters/
│   │   ├── github/       GithubAdapter (bare clone + git)
│   │   │                 GithubApiAdapter (REST API 전용)
│   │   │                 DefaultTokenProvider
│   │   ├── gitlab/       GitlabAdapter (REST API + PRIVATE-TOKEN)
│   │   ├── local-git/    LocalGitAdapter
│   │   └── file/         FileDiffAdapter (두 디렉터리 직접 비교)
│   ├── snapshot-engine/  Definition Builder + TypeSpec bundle snapshot builders
│   └── cache/sqlite/     SqliteCache + cache-key
└── presentation/http/ Hono HTTP 서버
    └── server.ts
```

---

## HTTP API

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/api/config` | 서버 설정 조회 (target, source, fragmentsDir) |
| `POST` | `/api/refresh` | git 소스에서 이력 수집 및 스냅샷 빌드 |
| `DELETE` | `/api/cache` | 현재 target의 캐시 전체 삭제 |
| `GET` | `/api/timeline` | 타임라인 목록 (Read Model) |
| `GET` | `/api/snapshot/:revisionId` | 특정 revision의 빌드된 스펙 |
| `GET` | `/api/snapshot/:revisionId?include=entries` | + fragment 원문 포함 |
| `GET` | `/api/diff/:baseId/:headId` | 두 revision 간 diff |
| `GET` | `/api/paths` | 현재 스펙의 path 목록 + provenance (Read Model) |
| `GET` | `/api/graph` | fragment $ref 의존 그래프 (최신 revision) |
| `GET` | `/api/graph?revision=:id` | 특정 revision의 fragment 그래프 |

---

## 의존성

- `@oa-sdk/codegen/spec-lens` — `loadDefinitionFragmentsFromEntries`, diff 유틸 re-export
- `@oa-sdk/parser` — DefinitionRegistry, 스펙 emit 파이프라인
- `hono` + `@hono/node-server` — HTTP 서버
- `better-sqlite3` — 스냅샷·diff·Read Model 캐시

---

## 테스트

```bash
pnpm test
```

| 파일 | 커버 범위 |
|------|---------|
| `cache-key.test.ts` | project build + repository/ref observation identity와 legacy config 호환 |
| `sqlite-cache.test.ts` | project 격리, nested fail-closed decode, full-history reconcile, v1 invalidation |
| `snapshot-builder-diff.test.ts` | diff 통계, affectedFragments, null spec 핸들링 |
| `local-git-adapter.test.ts` | 실제 repo, TypeSpec-only revision, detached-HEAD SHA pinning |
| `file-diff-adapter.test.ts` | stat-before-read, count/size budget, root-escaping symlink rejection |
| `github-api-source-read-budget.test.ts` | tree size preflight, bounded blob response/decoded size, concurrency, whole-revision failure |
| `gitlab-source-budget.test.ts` | file count, raw Content-Length/stream/aggregate cap, concurrency |
| `source-read-budget.test.ts` | required/canonical/stricter/upward budget contract와 queued-read stop |
| `get-graph-query.test.ts` | 노드 빌드, 엣지 해석, self-loop 제외 |
| `refresh-timeline.test.ts` | full workflow, lastChanged 최신 우선, 빌드 실패 처리 |
| `typespec-bundle-snapshot-builder.test.ts` | TypeSpec revision compile, timeline/cache reuse, failure state |
| `revision-pagination.test.ts` | GitHub/GitLab authoritative full-history pagination과 bounded limit |
| `query-handlers.test.ts` | GetDiff / GetPaths / GetSnapshot / GetTimeline 핸들러 |
| `gitlab-adapter.integration.test.ts` | listRevisions / getFileEntries / 연속 revision content drift / 401 auth 에러 (env-gated, GitLab 인스턴스 필요) |

### GitLab integration test 실행

`gitlab-adapter.integration.test.ts`는 다음 환경변수가 모두 있을 때만 실행되고, 그 외엔 깨끗하게 skip된다.

| 변수 | 의미 |
|---|---|
| `GITLAB_INTEGRATION_HOST` | GitLab base URL. 예: `http://localhost:8929` |
| `GITLAB_INTEGRATION_PROJECT_ID` | 프로젝트의 numeric ID 또는 `namespace/path` |
| `GITLAB_INTEGRATION_TOKEN` | `api`+`read_repository` scope를 가진 PAT (`glpat-...`) |
| `GITLAB_INTEGRATION_FRAGMENTS_DIR` | optional, 기본 `fragments` |

테스트 대상 프로젝트는 `fragments/` 디렉토리 아래에 OpenAPI fragment YAML/JSON이 들어있고 그 디렉토리를 변경한 commit이 최소 2개 이상 있어야 한다. 새 인스턴스라면 GitLab API로 프로젝트 + 커밋 3개를 직접 만들 수 있다 — `POST /api/v4/projects` + `POST/PUT /api/v4/projects/:id/repository/files/...`.

```bash
GITLAB_INTEGRATION_HOST=http://localhost:8929 \
GITLAB_INTEGRATION_PROJECT_ID=1 \
GITLAB_INTEGRATION_TOKEN=glpat-xxx \
pnpm --filter @oa-sdk/spec-lens test -- src/__tests__/gitlab-adapter.integration.test.ts
```

## 알려진 제약

- cache schema v2는 project identity가 없는 v1 DB를 열 때 기존 cache/read model을 폐기하고 Git history에서 재구축한다.
- TypeSpec output pointer를 원본 `.tsp` 선언으로 매핑하는 compiler provenance는 아직 없다. Snapshot/graph에는 reachable source-file evidence를 노출하고 path projection은 저장하지 않으며 API/UI는 명시적 `unavailable` 상태를 표시한다.
- revision 후보는 `project.sourceRoot` 변경 단위다. sourceRoot 밖 lockfile/emitter 의존성은 명시적 `watchPaths` 계약이 도입되기 전에는 관측하지 않는다.
- `source: github` 의 `GithubAdapter`는 bare clone 후 로컬 git으로 동작한다. git CLI가 없는 환경에서는 `GithubApiAdapter`를 직접 사용한다.
- `source: gitlab` 은 REST API 방식. self-hosted GitLab은 GitHub처럼 좁은 API rate limit이 없으므로 bare-clone 변환은 도입하지 않았다 — rate limit 압력이 실제로 발생하면 재고려.
