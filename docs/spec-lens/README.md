# spec-lens

OpenAPI 스펙 변경 이력 관리·관측 도구. Definition Builder rollback project와
TypeSpec production project의 source 변경을 수집하고, 브라우저 UI에서
diff·provenance·source 의존 그래프를 시각화한다.

> **추적 범위**: spec-lens는 `project.sourceRoot`를 건드린 커밋만 타임라인
> 후보로 표시한다. 앱 코드 변경 커밋은 잡히지 않는다.

---

## 빠른 시작

```bash
# 1. 서버 시작 (자동으로 로컬 git + 스키마 경로 감지)
pnpm exec tsx packages/spec-lens/src/cli.ts

# 2. UI dev server 시작 (별도 터미널)
pnpm --filter @oa-sdk/spec-lens-ui dev

# 3. 브라우저에서 열기
open http://localhost:5174

# 4. Timeline 탭 → Refresh 버튼 클릭 → 커밋 이력 수집
```

서버 기본 포트는 `4891`, UI는 `/api/*`를 서버로 프록시한다.

**권장**: `.gitignore`에 아래 항목을 추가한다.
```
.spec-lens.db*
.spec-lens-repos/
```

---

## 설정 파일

프로젝트 루트에 `spec-lens.config.yaml`을 만들면 자동 감지된다.

```yaml
# spec-lens.config.yaml

source: local-git           # local-git | github | gitlab
project:
  kind: definition-builder
  sourceRoot: packages/schemas/src/fragments
  targetPath: packages/schemas/src/targets/book-notebook-api.yaml
port: 4891
dbPath: .spec-lens.db
```

기존 top-level `fragmentsDir` / `targetPath`도 호환된다. TypeSpec production
bundle 식별 설정은 아래와 같다.

```yaml
source: local-git
project:
  kind: typespec-bundle
  sourceRoot: packages/schemas/typespec
  manifestPath: packages/schemas/typespec/oa-sdk.typespec-bundle.json
```

TypeSpec project는 현재 bundle 변경 후보 수집과 cache boundary까지 구현되어
있다. Historical TypeSpec compile/restore snapshot은 별도 builder adapter가
완료된 뒤 server target으로 승격한다.

**설정 파일이 없으면** 다음 경로를 자동 감지한다:
- `packages/schemas/src/targets/book-notebook-api.yaml`
- `packages/schemas/src/targets/admin-api.yaml`

---

### source: local-git

현재 디렉터리의 git 저장소를 직접 분석한다.

```yaml
source: local-git
branch: main               # 분석할 브랜치 (생략 시 현재 HEAD)
localGit:
  repoPath: .               # 생략 시 현재 디렉터리
```

---

### source: github

레포지토리를 로컬에 bare clone하고 git CLI로 분석한다. GitHub API는 인증에만 사용하고 파일 읽기는 모두 로컬 git으로 처리하므로 rate limit 영향이 없다.

```yaml
source: github
github:
  owner: acme
  repo: my-api
  branch: main              # 생략 시 모든 브랜치 fetch
  repoCache: .spec-lens-repos   # clone 저장 경로 (생략 가능)
  # host: https://ghe.example.com  # GitHub Enterprise
```

**인증** (resolve 순서):
1. `GITHUB_TOKEN` / `GH_TOKEN` 환경변수
2. `gh auth token` CLI (GitHub CLI 설치된 경우)

첫 Refresh 시 `repoCache/<owner>/<repo>/`에 bare clone이 생성된다. 이후 Refresh는 `git fetch`로 업데이트한다.

> REST API만 사용하려면 `GithubApiAdapter`를 직접 인스턴스화한다 (git CLI 불필요).

---

### source: gitlab

> ⚠️ TODO: 테스트 환경 구축 필요. GitLab CE Docker 또는 GitLab.com 계정으로 검증 예정.

```yaml
source: gitlab
gitlab:
  projectId: 12345678       # 숫자 ID 또는 'namespace/project'
  # host: https://gitlab.company.com  # self-hosted
```

**인증** (resolve 순서):
1. `GITLAB_TOKEN` / `GL_TOKEN` / `CI_JOB_TOKEN` 환경변수
2. `glab auth token` CLI (GitLab CLI 설치된 경우)

---

## UI 뷰 설명

### 사이드바 — Target Info

서버 시작 시 현재 관찰 중인 스펙 정보를 사이드바에 표시한다.

| 항목 | 내용 |
|------|------|
| 대상 | `targetConfig.name` (hover 시 전체 경로) |
| 프래그먼트 | `fragmentsDir` 마지막 3 세그먼트 (hover 시 전체 경로) |
| 소스 | `local-git` / `github` / `gitlab` + branch |

여러 스펙을 관리하는 프로젝트에서 어떤 타겟을 보고 있는지 한눈에 확인할 수 있다.

---

### Timeline

커밋 목록을 최신순으로 표시한다. **`fragmentsDir`을 건드린 커밋만 표시**된다.

| 요소 | 설명 |
|------|------|
| SHA (파란색) | 커밋 해시 앞 7자리 |
| `+N` 초록 배지 | 해당 커밋에서 추가된 API path 수 |
| `−N` 빨간 배지 | 제거된 API path 수 |
| `~N` 파란 배지 | 변경된 API path 수 |
| `⚡N` 주황 배지 | 기존 클라이언트를 깨뜨리는 변경 수 |
| `build failed` 주황 배지 | 해당 revision의 스냅샷 빌드 실패 |
| 파일명 태그 | 변경된 fragment 파일 목록 |

커밋 행을 클릭하면 해당 커밋과 바로 이전 커밋 사이의 diff 뷰로 진입한다.

**Refresh** 버튼: git 소스에서 커밋 이력을 가져오고 스냅샷을 빌드한다. 자동 갱신은 30초 간격으로 발생한다.

**캐시 초기화** 버튼: 현재 target의 모든 캐시(스냅샷, diff, 타임라인, path 항목)를 삭제한다. 확인 다이얼로그 후 실행된다. fragment_blobs는 content-addressable이므로 삭제하지 않는다.

---

### Diff — Changes 탭 (기본)

변경된 항목을 **OpenAPI 구조 카테고리별**로 묶어 표시한다.

각 항목을 클릭하면 **Before / After 인라인 diff**가 펼쳐진다.
- **`+`** (초록): 해당 시점에 없었다가 추가된 것
- **`−`** (빨강): 있었다가 사라진 것
- **`~`** (주황): 두 시점 모두 존재하지만 내용이 바뀐 것

#### 카테고리 설명

| 카테고리 | 위치 | Breaking 위험 |
|---------|------|--------------|
| **Root** | `info`, `tags`, `openapi` 버전 | 낮음 — 런타임 무관 |
| **Servers** | `servers[].url` | 높음 — URL 변경 시 연결 끊김 |
| **API Paths** | `paths./users`, `paths./users/{id}` 등 | 가장 높음 — 클라이언트 직접 호출 |
| **Components** | `components.schemas`, `responses`, `parameters`, `requestBodies`, `securitySchemes` | 중간~높음 — `$ref` 전파 |
| **Security** | `security[]` 전역 인증 요구사항 | 높음 — 모든 엔드포인트 영향 |

---

### Diff — Breaking 탭

기존 클라이언트를 **업데이트 없이 깨뜨릴 수 있는 변경**만 추려서 보여준다.

| severity | 의미 | 예시 |
|----------|------|------|
| `breaking` | 기존 호출이 즉시 오류 또는 잘못된 동작 | 필수 파라미터 추가, 필드 타입 변경, path 제거 |
| `non-breaking` | 동작은 유지되나 컨트랙트 변화 | 응답 필드 제거, 선택 파라미터 추가 |

상단 필터 바에서 **전체 / Breaking / Non-breaking**을 선택해 원하는 항목만 표시할 수 있다. `breaking N개 · non-breaking N개` 요약이 함께 표시된다.

---

### Diff — Full YAML 탭

빌드된 전체 OpenAPI 문서를 side-by-side 또는 inline 모드로 비교한다.
Monaco Editor 기반이므로 전체 파일을 스크롤하며 확인할 때 사용한다.

---

### Diff — Fragments 탭

변경에 관여한 **definition fragment 파일 목록**. 파일명을 클릭하면 해당 `.yaml` 파일의 Before/After 인라인 diff가 펼쳐진다.

---

### Path Provenance

현재 최신 스펙의 모든 API path를 테이블로 표시한다.

| 컬럼 | 설명 |
|------|------|
| Path | `/users`, `/notes/{id}` 등 |
| Methods | HTTP 메서드 (GET/POST/...) |
| Canonical ID | `path:public/users/Users` 형태의 oa-sdk 내부 식별자 |
| Scope | `public`, `admin`, `shared` 등 접근 범위 |
| Domain | `users`, `book`, `common` 등 비즈니스 도메인 |
| Source File | 이 path를 정의하는 fragment 파일 |
| Last Changed | 마지막으로 변경된 커밋 SHA + 시간 |

scope / domain 드롭다운과 검색창으로 필터링 가능하다. 행을 클릭하면 Canonical ID · 전체 소스 파일 경로 · Content Hash · 마지막 변경 revision 상세 정보가 확장된다.

---

### Fragment Graph

선택한 revision의 definition fragment들 사이의 `$ref` 의존 관계를 D3 force-directed 그래프로 시각화한다.

- **노드**: fragment 하나 (schema, operation, path, response 등)
- **엣지**: `$ref` 참조 방향
- **색상**: scope별 구분 — 파랑 `public` · 초록 `shared` · 주황 `admin` · 보라 `internal`
- 상단 드롭다운으로 **revision 선택** (캐시된 revision만 표시)
- kind / scope 드롭다운으로 필터링 가능
- 마우스 휠 줌 / 드래그 이동 지원

**노드 클릭** 시 우측 패널에 상세 정보가 표시된다:

| 필드 | 내용 |
|------|------|
| Name | fragment 로컬 이름 |
| Kind | path / schema / response / parameter 등 |
| Scope / Domain | 접근 범위, 비즈니스 도메인 |
| ID | canonical ID 전체 |
| Hash | content hash 앞 12자리 |
| Source | 소스 파일 경로 (마지막 3 세그먼트) |
| References (N) | 이 fragment가 `$ref`로 참조하는 fragment 목록 |
| Referenced by (N) | 이 fragment를 `$ref`로 참조하는 fragment 목록 |

---

## 언어 설정

사이드바 하단의 **`EN` / `한국어`** 버튼으로 UI 언어를 전환한다. 선택한 언어는 `localStorage`에 저장되어 다음 방문 시에도 유지된다. 기본값은 한국어.

---

## 아키텍처

```
┌─ Presentation ──────────────────────────────────────────┐
│  GET  /api/config                                       │  서버 설정 조회
│  POST /api/refresh        RefreshTimelineHandler        │  Command (쓰기)
│  DELETE /api/cache        CachePort.clearCache()        │  Command (캐시 초기화)
│  GET  /api/timeline       GetTimelineHandler            │  Query  (Read Model)
│  GET  /api/snapshot/:id   GetSnapshotHandler            │  Query
│  GET  /api/diff/:b/:h     GetDiffHandler                │  Query
│  GET  /api/paths          GetPathsHandler               │  Query  (Read Model)
│  GET  /api/graph[?revision=:id] GetGraphHandler         │  Query
└────────────────────┬────────────────────────────────────┘
                     │ Ports (interface)
┌─ Infrastructure ───────────────────────────────────────┐
│  SpecSourcePort    GithubAdapter / LocalGitAdapter /   │
│                    GitlabAdapter / GithubApiAdapter     │
│  SnapshotBuilderPort   SnapshotBuilder                 │
│  CachePort         SqliteCache                         │
│    Write Side : snapshots, diffs, fragment_blobs       │
│    Read Model : timeline_entries, path_entries         │
└────────────────────────────────────────────────────────┘
```

CQRS 패턴 적용. `POST /refresh`, `DELETE /api/cache`만 쓰기이고, 나머지는 전부 Read Model 또는 캐시에서 읽는다.

**캐시 키 격리 v2**: `SpecProjectKey`는 project kind, source root,
manifest/target digest, builder version, snapshot schema version을 포함한다.
snapshot, diff, timeline, path read model이 모두 같은 project key로 격리되므로
동일 revision이라도 target/manifest 또는 builder가 바뀌면 이전 diff를 재사용하지 않는다.
project identity가 없던 v1 SQLite cache는 안전하게 폐기한 뒤 Git history에서 재구축한다.

---

## 데이터 흐름 (Refresh)

```
POST /refresh
  → adapter.listRevisions()
      local-git:  git log -- project.sourceRoot
      github:     git fetch → git log (bare clone 로컬 실행)
      gitlab:     GitLab Commits API
  → adapter.getFileEntries()          (revision별)
      local-git:  git ls-tree + git show
      github:     git ls-tree + git show (로컬 clone)
      gitlab:     GitLab Tree API + Files API
  → SnapshotBuilder.build()           oa-gen 파이프라인 인메모리 실행
  → SqliteCache.saveSnapshot()        Write Side 저장 (fragment_blobs dedup)
  → SnapshotBuilder.diff()            인접 revision 간 diff 계산
  → SqliteCache.saveDiff()            Write Side 저장
  → SqliteCache.upsertTimelineEntry() Read Model 갱신 (timeline_entries)
  → SqliteCache.upsertPathEntries()   Read Model 갱신 (path_entries)
```

---

## 관련 문서

- [설계 문서](./design.md) — 전체 아키텍처 결정 기록
- [Concepts](../concepts.md) — oa-sdk 공통 용어
- [OpenAPI Governance Workflow](../guides/use-cases/openapi-governance-workflow.md)
- [packages/spec-lens README](../../packages/spec-lens/README.md)
- [apps/spec-lens README](../../apps/spec-lens/README.md)
