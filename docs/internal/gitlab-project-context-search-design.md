# GitLab Project Context Search Design

> 목적: GitLab project context store를 추후 공통화/API/UI로 고도화하기 위한 검색 설계 기준선이다. 데이터 저장 유형 분석은 [GitLab Project Context Data Model](./gitlab-project-context-data-model.md)을 따른다.

## 문제 정의

GitLab을 project context hub로 쓰면 context는 여러 표면에 분산된다.

- Issue: 작업 선언, 상태, label, note
- Merge request: 변경 제안, diff, review discussion, pipeline
- Repository docs: versioned release/docs artifact
- Wiki: living knowledge
- Snippet: large log, prompt snapshot, generated report
- Pipeline/release: 검증과 배포 기록

검색 설계는 단순 full-text search가 아니라 다음 질문에 답해야 한다.

1. **어떤 저장 유형에서 찾을 것인가?**
2. **어떤 ref/branch/time 기준의 context인가?**
3. **어떤 metadata filter를 적용할 것인가?**
4. **UI와 agent가 같은 검색 계약을 쓸 수 있는가?**
5. **GitLab CE에서 기본 API만으로 가능한가, 별도 index가 필요한가?**

## 설계 원칙

1. **GitLab object id를 잃지 않는다.**
   - 모든 검색 결과는 원본 GitLab 좌표를 가진다.
   - 예: `issue:1#42`, `mr:1!7`, `repo:1:main:docs/x.md`, `wiki:1:Runbook/Deploy`.

2. **검색과 fetch를 분리한다.**
   - search result는 작고 빠른 preview다.
   - 상세 context pack은 별도 fetch/expand 단계에서 만든다.

3. **branch-aware와 branchless를 구분한다.**
   - repo docs, MR, pipeline은 branch/ref가 핵심이다.
   - issue, label, milestone, board, release는 branchless 또는 tag-bound다.

4. **GitLab API filter를 우선 사용하고, 부족한 부분만 local index로 보강한다.**
   - 초기 구현은 API-first.
   - UI/agent latency가 문제될 때 SQLite/FTS index를 추가한다.

5. **CE capability 차이를 명시적으로 모델링한다.**
   - release evidence처럼 CE에서 404인 표면은 optional capability다.
   - 검색 UI는 unavailable capability를 숨기거나 disabled reason을 표시한다.

## 검색 대상 표면

| 표면 | 기본 검색 방식 | 정렬/필터 축 | branch/ref | local index 필요성 |
|---|---|---|---|---|
| Issues | Issues API search/filter | state, labels, assignee, milestone, created/updated, due date | 없음 | 중간. description/note 통합 검색에는 필요 |
| Issue notes | Notes API per issue | author, created/updated, system flag | 없음 | 높음. GitLab API는 project-wide note search에 약함 |
| Merge requests | MR API search/filter | state, labels, source/target branch, author, reviewer, milestone, updated | source/target branch | 낮음 |
| MR discussions | Discussions API per MR | resolved, author, position, created | MR diff refs | 높음. unresolved/thread search에는 index 유리 |
| Repository docs | Repository tree/files/search | path, extension, ref, last_commit_id, content hash | 직접 지원 | 중간. full-text/semantic search에는 필요 |
| Wiki pages | Wikis API list/read | slug/path/title/format | wiki repo abstraction | 중간. content search에는 필요 |
| Snippets | Snippets API | title, visibility, updated, file path | snippet ref | 중간 |
| Pipelines/jobs | Pipelines/jobs API | ref, sha, source, status, created/updated | ref/sha | 낮음 |
| Releases | Releases API | tag, released_at, milestone, assets | tag-bound | 낮음 |
| Labels/milestones/boards | API list/filter | taxonomy/grouping/status | 없음 | 낮음 |

## 공통 검색 인터페이스

초기 공통화 대상은 `@oa-sdk/orchestrator-gitlab` 안의 `GitlabProjectClient` 위에 얹는 read-only port다.

```ts
export type GitlabContextKind =
  | "issue"
  | "issue_note"
  | "merge_request"
  | "discussion"
  | "repo_file"
  | "wiki_page"
  | "snippet"
  | "pipeline"
  | "release"
  | "label"
  | "milestone"
  | "board";

export interface GitlabContextSearchQuery {
  readonly text?: string;
  readonly kinds?: ReadonlyArray<GitlabContextKind>;
  readonly labels?: ReadonlyArray<string>;
  readonly state?: "opened" | "closed" | "merged" | "all";
  readonly branch?: string;
  readonly ref?: string;
  readonly milestone?: string;
  readonly authorUsername?: string;
  readonly updatedAfter?: string;
  readonly updatedBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface GitlabContextSearchResult {
  readonly id: string;
  readonly kind: GitlabContextKind;
  readonly title: string;
  readonly url?: string;
  readonly preview?: string;
  readonly score?: number;
  readonly updatedAt?: string;
  readonly ref?: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}
```

### 좌표 규칙

검색 결과 `id`는 UI routing과 agent context pack fetch의 안정 키다.

| 종류 | id 형식 |
|---|---|
| issue | `gitlab://project/{projectId}/issues/{iid}` |
| issue note | `gitlab://project/{projectId}/issues/{iid}/notes/{noteId}` |
| merge request | `gitlab://project/{projectId}/merge-requests/{iid}` |
| discussion | `gitlab://project/{projectId}/merge-requests/{iid}/discussions/{discussionId}` |
| repo file | `gitlab://project/{projectId}/repository/files/{path}?ref={ref}` |
| wiki page | `gitlab://project/{projectId}/wiki/{slug}` |
| snippet | `gitlab://project/{projectId}/snippets/{snippetId}` |
| pipeline | `gitlab://project/{projectId}/pipelines/{pipelineId}` |
| release | `gitlab://project/{projectId}/releases/{tagName}` |

## Search vs Expand

검색 결과는 preview만 제공하고, 상세 context는 expand 단계에서 만든다.

```ts
export interface GitlabContextExpandOptions {
  readonly includeBody?: boolean;
  readonly includeComments?: boolean;
  readonly includeDiscussions?: boolean;
  readonly includeDiffSummary?: boolean;
  readonly includePipelineStatus?: boolean;
  readonly includeLinkedObjects?: boolean;
  readonly maxBodyChars?: number;
  readonly maxComments?: number;
}

export interface GitlabContextDocument {
  readonly id: string;
  readonly kind: GitlabContextKind;
  readonly title: string;
  readonly body?: string;
  readonly url?: string;
  readonly ref?: string;
  readonly updatedAt?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly links: ReadonlyArray<{ readonly rel: string; readonly target: string }>;
}
```

이 분리는 UI와 agent가 같은 검색 결과를 쓰되, 필요한 context 깊이를 다르게 가져갈 수 있게 한다.

현재 구현된 expand 계약:
- issue expand: description, labels, optional notes(`includeComments`), optional note links(`includeLinkedObjects`)
- merge request expand: description, branch metadata, optional discussions(`includeDiscussions`), optional `head_pipeline` summary/link(`includePipelineStatus`)
- repo file expand: branch/ref-aware metadata + raw file body
- wiki/snippet/release expand: metadata + body/description

## 인덱스 설계

### Phase 1: API-first federated search

구현:
- `GitlabProjectClient`를 주입받는 `GitlabContextSearchService`.
- kinds별 API 호출을 병렬 수행.
- GitLab API가 제공하는 filter를 최대한 사용.
- 결과를 normalized `GitlabContextSearchResult`로 합친다.

장점:
- 저장소 추가 없음.
- CE compatibility 확인이 쉽다.
- GitLab이 source of truth로 남는다.

한계:
- notes/discussions/wiki/repo content full-text 검색이 약하다.
- UI에서 빠른 global search를 제공하기 어렵다.

### Phase 2: SQLite FTS local index

구현:
- project-local cache DB.
- `context_documents` table + FTS table.
- GitLab object 좌표, kind, title, body, metadata JSON, updatedAt, contentHash 저장.
- incremental sync는 `updated_after`, branch ref, last_commit_id, ETag-like metadata를 사용한다.

권장 schema 초안:

```sql
CREATE TABLE gitlab_context_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  ref TEXT,
  updated_at TEXT,
  content_hash TEXT,
  metadata_json TEXT NOT NULL
);

CREATE VIRTUAL TABLE gitlab_context_documents_fts
USING fts5(id UNINDEXED, title, body, kind UNINDEXED, metadata_json UNINDEXED);
```

동기화 단위:
- issues/MRs/releases/pipelines: `updated_at` 기반.
- repo docs: branch tree + `last_commit_id` / `content_sha256`.
- wiki: page list + page content hash.
- snippets: updated timestamp + file content hash.
- discussions/notes: parent object updated_at 기반 재수집.

### Phase 3: Semantic retrieval

FTS가 안정된 뒤 embedding index를 추가한다.

대상:
- issue description
- MR description and discussion summary
- repo docs
- wiki pages
- snippets marked as context artifacts

주의:
- token/privacy 정책이 먼저 필요하다.
- raw logs와 secrets는 embedding 대상에서 제외하거나 redaction한다.

## UI 고도화 방향

### 기본 화면

1. **Global Context Search**
   - kind filter
   - label/milestone/branch/status filter
   - result preview
   - source icon: issue, MR, docs, wiki, snippet, pipeline, release

2. **Context Graph**
   - issue -> MR -> pipeline -> release
   - issue -> wiki decision
   - MR -> repo docs
   - release -> release notes/assets

3. **Agent Context Pack Preview**
   - agent가 실제로 가져갈 context 목록
   - 각 document의 token/char budget
   - excluded reason 표시

4. **Capability Matrix**
   - 현재 GitLab instance/version/edition에서 가능한 표면 표시
   - 예: release evidence disabled: CE endpoint 404

### UI 필터 모델

```ts
export interface GitlabContextSearchViewState {
  readonly query: string;
  readonly kinds: ReadonlySet<GitlabContextKind>;
  readonly labels: ReadonlySet<string>;
  readonly branch: string | undefined;
  readonly state: string | undefined;
  readonly milestone: string | undefined;
  readonly timeRange: { readonly from?: string; readonly to?: string };
  readonly sort: "relevance" | "updated_desc" | "created_desc";
}
```

## Agent 활용 모델

Agent는 검색을 직접 UI처럼 쓰지 않고, task에서 context pack을 조립한다.

흐름:

```text
issue selected
→ expand issue body/labels/milestone
→ search linked MRs and docs by labels/path/title
→ fetch wiki runbook pages by area label
→ fetch recent pipeline failures for branch/MR
→ assemble context pack with budget
```

Context pack policy:
- Issue body는 항상 포함.
- Linked MR은 최신 3개까지.
- Wiki runbook은 label/path match 우선.
- Repo docs는 branch-aware하게 target branch 기준.
- Snippet은 `context-artifact` label/convention이 있을 때만 포함.
- Pipeline logs는 summary만 포함하고 raw log는 link로 둔다.

## Capability Discovery

검색 UI/API는 GitLab edition/version 차이를 알아야 한다.

```ts
export interface GitlabContextCapabilities {
  readonly version: string;
  readonly enterprise: boolean;
  readonly supportsWiki: boolean;
  readonly supportsProjectSnippets: boolean;
  readonly supportsIssueBoards: boolean;
  readonly supportsMergeRequests: boolean;
  readonly supportsPipelineCreate: boolean;
  readonly supportsReleaseEvidence: boolean;
}
```

초기 discovery:
- `GET /version`
- project feature flags from `GET /projects/:id`
- cheap probe endpoints:
  - `/boards`
  - `/wikis`
  - `/snippets`
  - `/pipelines`
  - `/releases/:tag/evidence` only when release exists or in test fixture

CE 18.11.2 local observation:
- `enterprise: false`
- boards/MRs/wiki/snippets/pipelines/releases supported
- release evidence endpoint returned 404

현재 구현은 `GitlabContextSearchService.discoverCapabilities()`로 version과 cheap probe 결과를 반환한다. `supportsReleaseEvidence`는 CE baseline에서 false로 취급하고, Enterprise/Premium 검증은 별도 fixture release가 있을 때 probe를 확장한다.

## 구현 순서

1. **Read-only interface**
   - `GitlabContextSearchQuery`
   - `GitlabContextSearchResult`
   - `GitlabContextDocument`
   - coordinate/id helpers

2. **API-first search service**
   - issues
   - MRs
   - repo docs tree/path search
   - wiki page list/title search
   - snippets title search
   - releases/tags

3. **Expand service**
   - issue details + notes
   - MR details + discussions + pipeline summary
   - repo file content
   - wiki content
   - snippet raw files

4. **Capability discovery**
   - version/edition/probe cache
   - UI disabled reasons

5. **Local index**
   - SQLite FTS schema
   - incremental sync
   - search ranking normalization

6. **UI**
   - global search
   - context graph
   - agent context pack preview

## 테스트 전략

Unit tests:
- query normalization
- coordinate encode/decode
- result normalization per surface
- ranking merge
- capability fallback behavior

Integration tests against GitLab CE:
- existing CRUD/workflow suites remain capability smoke tests.
- add read-only search suite:
  - create issue/MR/wiki/repo doc/snippet/release fixtures
  - search by text/kind/label/branch
  - expand each result kind
  - assert stable coordinates

Index tests:
- sync fixtures into SQLite
- FTS query returns expected kinds
- update/delete invalidates rows
- branch-aware repo docs do not cross refs accidentally

## 비목표

- GitLab Advanced Search/Elasticsearch 의존.
- Premium/Ultimate-only 기능을 baseline으로 삼기.
- 모든 note/discussion을 실시간 global search하는 것. 초기에는 parent object expand에서 충분하다.
- UI에서 raw CI log 전체를 직접 렌더링하는 것. raw log는 link, summary는 context document로 둔다.
