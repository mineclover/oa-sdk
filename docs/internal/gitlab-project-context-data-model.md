# GitLab Project Context Data Model

> 목적: GitLab을 Linear 대체 tracker가 아니라 프로젝트 중앙 컨텍스트 관리 도구로 쓸 때, 기본 제공 데이터 저장 유형을 먼저 분석한다. 이 문서는 구현 계획이 아니라 데이터 구조 분석 기준선이다.

## 관점

GitLab의 데이터 표면은 크게 세 저장 계열로 나뉜다.

1. **DB-backed project objects**: issue, merge request, milestone, label, board, note, discussion, release, pipeline처럼 GitLab DB에 저장되고 API로 조작되는 객체.
2. **Git-backed content**: repository files와 wiki처럼 Git repository에 저장되어 branch/ref/commit history를 갖는 문서/코드 콘텐츠.
3. **Artifact-backed records**: pipeline job artifacts, release evidence, packages, snippets처럼 특정 실행/배포/공유 산출물에 붙는 보조 저장소.

프로젝트 컨텍스트 시스템을 설계할 때 중요한 질문은 각 데이터 유형이 `무엇을 저장 단위로 삼는가`, `branch/ref를 직접 지원하는가`, `metadata를 어디에 저장하는가`이다.

## 저장 유형 매트릭스

| 유형 | 저장 단위 | Branch/ref 지원 | 메타데이터 저장 체계 | 컨텍스트 용도 |
|---|---|---|---|---|
| Project | project | default branch 속성은 있으나 project 자체는 branch 대상 아님 | project DB row: id, path, namespace, visibility, default_branch, features | 전체 컨텍스트 boundary |
| Issue / Work item | project-local IID issue | 직접 branch 없음. MR/commit/branch cross-reference는 가능 | DB object: title, description, state, labels, assignees, milestone, due date, weight, time tracking, references | 작업 선언, task contract, human decision thread |
| Label | project/group/instance label | 없음 | DB taxonomy: name, color, description, scope-like naming convention | 상태, routing, taxonomy, priority/severity |
| Milestone | project/group milestone | 없음 | DB object: title, description, start/due date, state | release/sprint/goal grouping |
| Issue board | board + board lists | 없음. issue metadata를 시각화/수정 | DB view config: labels, assignee, milestone, iteration, status list, WIP limit | workflow view, capacity/control surface |
| Merge request | project-local IID MR | **직접 지원**: source_branch, target_branch, source/target project, diff refs | DB object + Git refs: title, description, state, reviewers, approvals, labels, milestone, diff_refs, head_pipeline | 변경 제안, review, 검증 단위 |
| Note | note on issue/MR/commit/snippet/wiki page | 대상 객체에 종속. 자체 branch 없음 | DB object: body, author, created/updated_at, system/internal flag | agent turn log, command, status report |
| Discussion | thread of notes | 대상 객체에 종속. MR diff discussion은 file/line/SHA position metadata 보유 | DB thread + discussion notes: resolvable state, position, author/timestamps | unresolved question, review thread, human approval checkpoint |
| Repository file | file path in project repository | **직접 지원**: branch/tag/commit ref read, branch write, optional start_branch | Git blob + commit metadata: file_path, blob_id, commit_id, last_commit_id, content_sha256 | versioned docs, release notes, ADR, specs |
| Commit | commit SHA | immutable ref target. branch/tag가 commit을 가리킴 | Git object + GitLab DB/API projection: author, date, title/message, stats | audit trail, exact context snapshot |
| Wiki page | page file in separate wiki Git repository | Git repository라 branch 가능. API는 page abstraction 중심 | Wiki Git file + page metadata: slug, title, format, content, encoding | living knowledge base, runbook, decision log |
| Snippet | snippet with one or more files | snippet repository file API는 branch/tag/commit `ref`로 raw file read 가능. 일반 project branch와 별도 | DB snippet object + snippet repo files: title, description, visibility, files | large logs, prompt snapshots, temporary artifacts |
| Pipeline | pipeline run | **ref 기반**: branch/tag/MR ref/SHA에 연결 | DB execution record: status, source, ref, sha, user, created/updated_at | verification gate, execution history |
| Job artifact | job artifact file | pipeline/job에 종속. branch는 pipeline ref를 통해 간접 연결 | artifact storage + job metadata: paths, reports, expiry, download URLs | test reports, build outputs, release evidence input |
| Release | release bound to Git tag | tag 기반. branch는 release 생성 전 tag source로만 관여 | DB release object: tag_name, name, description, released_at, milestones, assets | published snapshot, release notes |
| Release evidence | JSON evidence snapshot per release | release tag에 종속 | generated JSON: release metadata, linked milestones, packages, report artifacts | audit-ready release record |
| Package / release asset | package version or asset link | release/tag/version과 간접 연결 | package registry metadata or release asset link metadata | distributable artifact, release attachment |

## 유형별 분석

### Issue / Work Item

Issue는 프로젝트 컨텍스트에서 가장 자연스러운 **작업 선언 단위**다. GitLab API는 issue 생성/수정/삭제, assignee, label, milestone, time tracking, cross-reference 같은 metadata를 직접 다룬다.

저장 단위:
- `project_id + issue_iid`
- title
- Markdown description
- labels
- assignees
- milestone
- state
- notes/discussions

Branch 지원:
- issue 자체는 branch/ref를 갖지 않는다.
- MR, commit, branch 이름을 description/comment에서 cross-reference하거나 MR과 연결해 간접 추적한다.

메타데이터 전략:
- 상태 전이는 label 또는 work item status로 표현한다.
- agent task contract는 issue description에 Markdown section 또는 fenced YAML block으로 둔다.
- 실행 로그는 note/discussion으로 분리한다.

권장 용도:
- 작업 의도, acceptance criteria, human context, routing metadata.

### Label

Label은 GitLab 전체에서 가장 가벼운 taxonomy 저장소다. 상태, 우선순위, 영역, agent routing을 모두 표현할 수 있지만 값은 문자열 중심이다.

저장 단위:
- project/group/instance label
- issue/MR/epic에 연결되는 label assignment

Branch 지원:
- 없음.

메타데이터 전략:
- scoped naming convention을 사용한다.
- 예: `agent::ready`, `agent::running`, `area::docs`, `risk::high`, `priority::1`.
- label description은 taxonomy 설명의 SSOT로 쓸 수 있다.

권장 용도:
- state machine
- routing
- board list
- filtering

주의:
- label만으로 복잡한 상태 history를 복원하지 말고 system notes/events 또는 별도 history를 함께 본다.

### Milestone

Milestone은 시간축 또는 release/goal 단위 grouping에 적합하다. issue와 MR은 milestone 하나에 배정될 수 있다.

저장 단위:
- project/group milestone
- title, description, start date, due date, state

Branch 지원:
- 없음.

메타데이터 전략:
- release train, sprint, roadmap goal을 milestone title로 표현한다.
- release와 연결할 때 milestone due date를 release target date로 사용할 수 있다.

권장 용도:
- release planning
- multi-issue progress view
- release notes aggregation boundary

### Issue Board

Issue board는 별도 content 저장소라기보다 issue metadata를 시각화하고 편집하는 **workflow view**다.

저장 단위:
- board
- list config
- board scope/filter

Branch 지원:
- 없음.

메타데이터 전략:
- board list는 label, assignee, milestone, iteration, status 같은 metadata에 매핑된다.
- agent state labels를 board list로 노출하면 운영자가 drag/drop으로 개입할 수 있다.

권장 용도:
- agent queue dashboard
- WIP control
- team-specific work view

### Merge Request

MR은 GitLab에서 변경 제안과 검증을 묶는 가장 강한 단위다. source branch와 target branch를 직접 갖고, diff refs와 pipeline 상태를 가진다.

저장 단위:
- `project_id + merge_request_iid`
- source branch
- target branch
- title/description
- reviewers/assignees
- labels/milestone
- diff refs
- notes/discussions
- head pipeline

Branch 지원:
- 직접 지원한다.
- `source_branch`, `target_branch`, `source_project_id`, `target_project_id`가 핵심 metadata다.

메타데이터 전략:
- agent output은 issue note보다 MR을 primary artifact로 승격하는 것이 좋다.
- MR description에 change summary, test evidence, linked issue, release-note fragment를 둔다.
- MR discussion은 code review 및 unresolved question의 SSOT가 된다.

권장 용도:
- code/docs change proposal
- review gate
- pipeline gate
- issue close linkage

### Notes and Discussions

Note는 단일 comment이고, Discussion은 thread다. GitLab API에서는 issue, MR, commit, snippet, wiki page 등에 notes/discussions가 붙는다.

저장 단위:
- note: one comment body
- discussion: thread id + discussion notes

Branch 지원:
- note/discussion 자체는 branch를 갖지 않는다.
- MR diff discussion은 file path, line, base/head/start SHA 같은 position metadata로 코드 위치와 연결된다.

메타데이터 전략:
- agent status report는 note로 충분하다.
- human approval, unresolved question, code review는 discussion으로 둔다.
- 명령형 comment는 `/agent retry`, `/agent stop`, `/agent summarize` 같은 command channel로 파싱 가능하다.

권장 용도:
- agent-human interaction log
- review thread
- command channel

### Repository Docs / Repository Files

Repository files는 branch/ref를 가장 명확하게 지원하는 versioned 문서 저장소다. GitLab Repository Files API는 file read에 branch/tag/commit ref를 사용하고, create/update/delete는 branch에 commit을 만든다.

저장 단위:
- repository file path
- Git blob
- commit

Branch 지원:
- 직접 지원한다.
- read: branch/tag/commit ref
- write: branch required, optional `start_branch`
- optimistic update에는 `last_commit_id`를 사용할 수 있다.

메타데이터 전략:
- 문서 metadata는 Markdown front matter 또는 파일 경로 convention으로 둔다.
- Git metadata는 commit id, author, last_commit_id, content_sha256로 추적한다.
- release 문서는 branch/MR review를 거쳐 merge되어야 하는 versioned artifact로 취급한다.

권장 용도:
- `docs/releases/<version>.md`
- `CHANGELOG.md`
- ADR
- API docs
- migration guides
- versioned specs

### Wiki

Wiki는 별도 Git repository로 저장되는 living documentation이다. 코드 repo와 분리되지만 같은 project/group context 안에 있다.

저장 단위:
- wiki page
- page path/slug
- wiki Git file

Branch 지원:
- Wiki 자체가 Git repository이므로 branch/ref 개념을 가진다.
- GitLab Wiki API는 page abstraction 중심이고, 일반 project branch workflow보다는 wiki repository workflow로 보는 것이 맞다.

메타데이터 전략:
- page title/path/format/content가 기본 metadata다.
- page hierarchy는 path로 표현한다.
- living context는 Wiki에 두고, release-tagged 문서는 repository docs나 releases에 둔다.

권장 용도:
- project memory
- runbook
- troubleshooting
- decision log
- current architecture overview

주의:
- release artifact처럼 코드 변경과 동일한 review gate가 필요하면 repository docs가 더 적합하다.

### Snippets

Snippet은 작은 코드/text bundle을 저장하는 공유 단위다. 여러 파일을 가질 수 있고 snippet repository file API는 ref 기반 raw read를 제공한다.

저장 단위:
- snippet object
- one or more files

Branch 지원:
- 일반 project branch와는 별개다.
- snippet repository file read는 `ref`를 받는다.

메타데이터 전략:
- title, description, visibility, files가 핵심 metadata다.
- 긴 agent log, prompt snapshot, temporary patch를 issue note에 직접 붙이지 않고 snippet 링크로 남길 수 있다.

권장 용도:
- large logs
- prompt/context snapshots
- generated reports
- temporary artifacts

### Pipeline / Job Artifact

Pipeline은 branch/tag/MR ref와 commit SHA에 연결되는 검증 실행 record다. GitLab CI/CD는 `.gitlab-ci.yml`로 정의되고, API로 pipeline list/get/create가 가능하다.

저장 단위:
- pipeline
- job
- job artifact

Branch 지원:
- pipeline은 `ref`와 `sha`를 가진다.
- branch pipeline, tag pipeline, MR pipeline으로 해석할 수 있다.

메타데이터 전략:
- pipeline status를 agent completion gate로 사용한다.
- job artifact는 test report, coverage, generated docs, build output으로 저장한다.
- 실패 로그는 issue/MR discussion으로 요약하고, 원본은 job log/artifact 링크로 둔다.

권장 용도:
- authoritative verification
- release evidence input
- quality gate

### Release and Release Evidence

Release는 Git tag에 묶인 published snapshot이다. release notes, milestones, assets를 연결할 수 있고 release evidence는 감사 가능한 JSON snapshot이다.

저장 단위:
- release keyed by `tag_name`
- release asset links
- release evidence JSON snapshot

Branch 지원:
- release 자체는 branch가 아니라 tag 기반이다.
- 생성 시 tag source로 branch/commit을 사용할 수 있지만, 저장 모델은 tag 중심이다.

메타데이터 전략:
- release description은 published release note다.
- milestone은 release scope boundary다.
- release evidence는 자동/수동 수집되는 audit record다.

권장 용도:
- official release notes
- published documentation snapshot
- audit/compliance record

### Package / Release Asset

Package registry와 release asset은 배포 산출물 저장소다. release evidence는 release tag와 matching되는 package를 포함할 수 있다.

저장 단위:
- package name/version/type
- release asset link/file

Branch 지원:
- 직접 branch 없음.
- version/tag/release와 연결한다.

메타데이터 전략:
- package version과 release tag를 맞춘다.
- release asset에 runbook, binary, generated documentation bundle을 붙인다.

권장 용도:
- user-facing distributable artifact
- release-attached docs bundle

## 설계상 1차 결론

GitLab을 프로젝트 중앙 컨텍스트로 쓰려면 저장 단위를 다음처럼 분리하는 것이 안전하다.

| 컨텍스트 성격 | 1차 저장소 | 이유 |
|---|---|---|
| 진행 중인 작업 선언 | Issue | 상태/담당자/label/comment가 자연스럽다 |
| 작업 상태 machine | Label + Issue state | board와 filtering에 바로 반영된다 |
| 긴 실행 로그/중간 산출물 | Snippet 또는 job artifact | issue note noise를 줄인다 |
| code/docs 변경 | Merge request | branch, diff, review, pipeline이 결합된다 |
| 검증 결과 | Pipeline/job artifact | CI가 authoritative gate다 |
| living project memory | Wiki | 코드 release와 독립적으로 계속 갱신된다 |
| versioned docs/release docs | Repository docs | branch/MR/review/tag와 함께 간다 |
| 공식 배포 기록 | Release + release evidence | tag 기반 snapshot과 audit trail이 있다 |
| 계획/범위 grouping | Milestone | issue/MR/release 범위를 묶는다 |

## CE 검증 범위

이 문서의 1차 범위는 `@oa-sdk/infra-gitlab`이 띄우는 GitLab CE Omnibus 인스턴스다. 공식 문서상 아래 표면은 Free tier에 포함되며, 로컬 CE 인스턴스(`GITLAB_INTEGRATION_BASE_URL=http://127.0.0.1:8929`)에서 integration smoke로 확인했다.

검증 테스트:

```bash
set -a
source .env.gitlab-integration.local
set +a
pnpm --filter @oa-sdk/orchestrator-gitlab test test/integration/gitlab-context-crud.integration.test.ts
```

테스트 파일:

- `packages/orchestrator-gitlab/test/integration/gitlab-context-crud.integration.test.ts`

확인된 CRUD 표면:

| 표면 | 확인한 동작 | CE 판정 |
|---|---|---|
| Project labels | create, update/rename, delete | 지원 |
| Project milestones | create, read/update, delete | 지원 |
| Issues | create, update metadata, close | 지원 |
| Issue notes | create, update, delete | 지원 |
| Repository docs file | throwaway branch 생성, file create/read/update/delete, branch cleanup | 지원 |
| Wiki page | create/read/update/delete | 지원. API 응답 title은 slug를 humanize할 수 있어 slug/content 기준으로 식별 |
| Project snippets | create/read/update/delete, raw file read by ref | 지원 |
| Releases | create/read/update/delete for a tag-bound release | 지원 |

2차 workflow 표면도 별도 integration smoke로 확인했다.

검증 테스트:

```bash
set -a
source .env.gitlab-integration.local
set +a
pnpm --filter @oa-sdk/orchestrator-gitlab test test/integration/gitlab-context-workflow.integration.test.ts
```

테스트 파일:

- `packages/orchestrator-gitlab/test/integration/gitlab-context-workflow.integration.test.ts`

확인된 workflow 표면:

| 표면 | 확인한 동작 | CE 판정 |
|---|---|---|
| Merge requests | throwaway branch/file 생성, MR create/read/update/close | 지원 |
| MR discussions | MR discussion create, note update, discussion read | 지원 |
| Issue boards | project board create/list/update/delete | 지원 |
| Pipelines | branch ref에 `.gitlab-ci.yml` 생성, pipeline create/read/cancel | 지원. job artifact 검증은 runner/job 성공 상태에 종속되어 별도 |
| Release evidence | release 생성 후 evidence endpoint POST/GET probe | CE 18.11.2 Omnibus에서 404. release CRUD와 분리해 unsupported/probe-only로 취급 |

별도 검증으로 남긴 표면:

| 표면 | 이유 |
|---|---|
| MR diff discussions | 일반 MR discussion은 확인했지만 file/line/SHA position metadata는 별도 diff fixture가 필요하다. |
| Pipeline jobs/artifacts | pipeline record는 확인했지만 job artifact는 runner, tag, artifact config, job success에 종속된다. verification gate 설계 단계에서 별도 테스트한다. |
| Release evidence | CE 18.11.2에서는 endpoint가 404다. Premium/Ultimate 또는 GitLab 버전별 차이가 있을 수 있어 release evidence는 optional capability로 둔다. |

## Agent 시스템에 주는 의미

현재 안정화된 1차 인터페이스는 다음 두 층이다.

1. **`GitlabProjectClient`** (`@oa-sdk/orchestrator-gitlab/gitlab-client`)
   - GitLab base URL, token, project id normalization, `PRIVATE-TOKEN` header, JSON body, error surface를 공통화한다.
   - `projectApiPath()`가 project-scoped API path를 생성하므로 `group/project`와 `group%2Fproject` 입력 차이가 하위 port로 새지 않는다.
   - `request()`는 non-2xx를 `GitlabApiError`로 던진다.
   - `requestMaybe()`는 release evidence처럼 CE/edition별 endpoint 존재 여부를 probe해야 하는 capability에 사용한다.
2. **`GitlabTracker`**
   - issue/label/note만 다루는 orchestration tracker port다.
   - 내부 request/encoding은 `GitlabProjectClient`에 위임한다.
   - 이 계층은 기존 `Tracker` contract와 backward-compatible하게 유지한다.

고유 GitLab 시스템으로 확장할 때는 `Tracker` 하나를 키우기보다 `GitlabProjectClient` 위에 다음 port를 얹는다.

```text
GitlabIssueContext        # issue description, labels, assignees, milestone
GitlabDiscussionLog       # notes/discussions/commands
GitlabMergeRequestStore   # source/target branch, MR lifecycle, review state
GitlabPipelineGate        # pipeline status, jobs, artifacts
GitlabRepositoryDocsStore # branch-aware docs files
GitlabWikiStore           # living project memory
GitlabReleaseStore        # releases, assets, evidence
GitlabSnippetStore        # large logs and temporary artifacts
```

초기 확장 순서는 다음이 합리적이다.

1. Issue description을 task contract로 정규화한다.
2. Agent 결과를 note-only에서 MR artifact 중심으로 올린다.
3. Pipeline gate를 completion 조건으로 붙인다.
4. Repository docs에 release-note draft를 쌓는다.
5. Wiki에는 운영 지식과 decision log를 갱신한다.
6. Release 생성 시 docs/milestone/pipeline evidence를 묶는다.

## 공식 문서 근거

- Issues API: https://docs.gitlab.com/api/issues/
- Labels: https://docs.gitlab.com/user/project/labels/
- Milestones: https://docs.gitlab.com/user/project/milestones
- Issue boards: https://docs.gitlab.com/user/project/issue_board/
- Merge requests: https://docs.gitlab.com/user/project/merge_requests/
- Merge requests API: https://docs.gitlab.com/api/merge_requests/
- Notes API: https://docs.gitlab.com/api/notes/
- Discussions API: https://docs.gitlab.com/api/discussions/
- Repository files API: https://docs.gitlab.com/api/repository_files/
- Repositories API: https://docs.gitlab.com/api/repositories/
- Wiki: https://docs.gitlab.com/user/project/wiki/
- Project wikis API: https://docs.gitlab.com/api/wikis/
- Snippets: https://docs.gitlab.com/user/snippets/
- Project snippets API: https://docs.gitlab.com/api/project_snippets/
- CI/CD pipelines: https://docs.gitlab.com/ci/pipelines/
- Pipelines API: https://docs.gitlab.com/api/pipelines/
- Releases: https://docs.gitlab.com/user/project/releases/
- Releases API: https://docs.gitlab.com/api/releases/
- Release evidence: https://docs.gitlab.com/user/project/releases/release_evidence/
