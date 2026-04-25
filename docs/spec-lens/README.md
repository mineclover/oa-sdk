# spec-lens

OpenAPI 스펙 변경 이력 관리·관측 도구. oa-sdk가 관리하는 definition fragments의 커밋별 변화를 수집하고, 브라우저 UI에서 diff·provenance·fragment 의존 그래프를 시각화한다.

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

---

## 설정 파일

프로젝트 루트에 `spec-lens.config.yaml`을 만들면 자동 감지된다.

```yaml
# spec-lens.config.yaml

source: github              # github | local-git
fragmentsDir: packages/schemas/src/fragments
targetPath: packages/schemas/src/targets/book-notebook-api.yaml
port: 4891
dbPath: .spec-lens.db       # SQLite 캐시 경로

# source: github 일 때
github:
  owner: acme
  repo: my-api
  branch: main              # 생략 시 기본 브랜치

# source: local-git 일 때 (생략 시 현재 디렉터리)
localGit:
  repoPath: .
```

**GitHub 인증**: 다음 순서로 토큰을 자동 탐색한다.

1. `GITHUB_TOKEN` / `GH_TOKEN` 환경변수
2. `gh auth token` CLI (GitHub CLI 설치된 경우)
3. 명시적 config의 `token` 필드 (권장하지 않음)

---

## UI 뷰 설명

### Timeline

커밋 목록을 최신순으로 표시한다. 각 행에서 볼 수 있는 것:

| 요소 | 설명 |
|------|------|
| SHA (파란색) | 커밋 해시 앞 7자리 |
| `+N` 초록 배지 | 해당 커밋에서 추가된 API path 수 |
| `−N` 빨간 배지 | 제거된 API path 수 |
| `~N` 파란 배지 | 변경된 API path 수 |
| `⚡N` 주황 배지 | 기존 클라이언트를 깨뜨리는 변경 수 |
| 파일명 태그 | 변경된 fragment 파일 목록 |

커밋 행을 클릭하면 해당 커밋과 바로 이전 커밋 사이의 diff 뷰로 진입한다.

> **Refresh** 버튼을 누를 때 비로소 git 소스에서 커밋 이력을 가져오고 스냅샷을 빌드한다. 자동 갱신은 30초 간격으로 발생한다.

---

### Diff — Changes 탭 (기본)

변경된 항목을 **OpenAPI 구조 카테고리별**로 묶어 표시한다. 카테고리 설명:

#### Root

문서 최상위 메타데이터. 런타임 동작과 무관하므로 breaking 위험 낮음.

```yaml
openapi: 3.1.0
info:
  title: My API    # ← Root
  version: 1.0.0   # ← Root
tags:
  - name: users    # ← Root
```

#### Servers

API 서버 URL 목록. URL 자체가 바뀌면 클라이언트 연결이 끊기므로 위험도 높음.

```yaml
servers:
  - url: https://api.example.com        # ← Servers
  - url: https://staging.api.example.com
```

#### API Paths

실제 호출 가능한 엔드포인트. 클라이언트가 직접 사용하므로 **가장 위험도가 높다**.

```yaml
paths:
  /users:
    get:  ...    # ← API Paths
  /users/{id}:
    delete: ...  # ← API Paths
```

#### Components

`$ref`로 참조하는 재사용 정의. 여기가 바뀌면 해당 정의를 쓰는 모든 path에 영향이 전파된다.

```yaml
components:
  schemas:
    User: { ... }           # ← Components / schema
    Error: { ... }          # ← Components / schema
  responses:
    NotFound: { ... }       # ← Components / response
  parameters:
    PageSize: { ... }       # ← Components / parameter
  requestBodies:
    CreateUser: { ... }     # ← Components / requestBody
  securitySchemes:
    BearerAuth: { ... }     # ← Components / securityScheme
```

#### Security

전역 보안 요구사항. 여기가 바뀌면 모든 엔드포인트의 인증 동작이 달라진다.

```yaml
security:
  - BearerAuth: []   # ← Security
```

---

각 항목을 클릭하면 **Before / After 인라인 diff**가 펼쳐진다.

- **`+`** (초록): 해당 시점에 없었다가 추가된 것
- **`−`** (빨강): 있었다가 사라진 것
- **`~`** (주황): 두 시점 모두 존재하지만 내용이 바뀐 것
- 줄 단위 색상 하이라이팅 + 단어 단위 인라인 하이라이팅 제공

---

### Diff — Breaking 탭

기존 클라이언트를 **업데이트 없이 깨뜨릴 수 있는 변경**만 추려서 보여준다.

| severity | 의미 | 예시 |
|----------|------|------|
| `breaking` | 기존 호출이 즉시 오류 또는 잘못된 동작 | 필수 파라미터 추가, 필드 타입 변경 |
| `non-breaking` | 동작은 유지되나 컨트랙트 변화 | 응답 필드 제거, status code 추가 |

---

### Diff — Full YAML 탭

빌드된 전체 OpenAPI 문서를 side-by-side 또는 inline 모드로 비교한다.  
Monaco Editor 기반이므로 전체 파일을 스크롤하며 확인할 때 사용한다.

---

### Diff — Fragments 탭

변경에 관여한 **definition fragment 파일 목록**. 어느 `.yaml` 파일이 이 커밋에서 바뀌었는지 확인한다.

---

### Path Provenance

현재 스펙의 모든 API path를 테이블로 표시한다.

| 컬럼 | 설명 |
|------|------|
| Path | `/users`, `/notes/{id}` 등 |
| Methods | HTTP 메서드 (GET/POST/...) |
| Canonical ID | `operation:public/users/ListUsers` 형태의 oa-sdk 내부 식별자 |
| Scope | `public`, `admin`, `shared` 등 접근 범위 |
| Domain | `users`, `book`, `common` 등 비즈니스 도메인 |
| Source File | 이 path를 정의하는 fragment 파일 |
| Last Changed | 마지막으로 변경된 커밋 SHA + 시간 |

scope / domain 드롭다운과 검색창으로 필터링 가능하다.

---

### Fragment Graph

definition fragment들 사이의 `$ref` 의존 관계를 D3 force-directed 그래프로 시각화한다.

- **노드**: fragment 하나 (schema, operation, path, response 등)
- **엣지**: `$ref` 참조 방향
- **색상**: scope별 구분
  - 파랑 `public` · 초록 `shared` · 주황 `admin` · 보라 `internal` · 주황 계열 `partner`
- 노드를 클릭하면 우측 패널에 상세 정보 표시
- 마우스 휠 줌 / 드래그 이동 지원
- kind / scope 드롭다운으로 필터링 가능

---

## 아키텍처

```
┌─ Presentation ──────────────────────────────────┐
│  POST /api/refresh   → RefreshTimelineHandler   │  Command (쓰기)
│  GET  /api/timeline  → GetTimelineHandler        │  Query  (읽기, Read Model)
│  GET  /api/snapshot  → GetSnapshotHandler        │  Query
│  GET  /api/diff      → GetDiffHandler            │  Query
│  GET  /api/paths     → GetPathsHandler           │  Query  (Read Model)
│  GET  /api/graph     → GetGraphHandler           │  Query
└────────────────┬────────────────────────────────┘
                 │ Ports (interface)
┌─ Infrastructure ────────────────────────────────┐
│  SpecSourcePort    GithubAdapter / LocalGitAdapter
│  SnapshotBuilderPort   SnapshotBuilder (oa-gen 파이프라인)
│  CachePort         SqliteCache
│    Write Side: snapshots, diffs, fragment_blobs
│    Read Model: timeline_entries, path_entries   │
└─────────────────────────────────────────────────┘
```

CQRS 패턴을 적용했다. `POST /refresh`만 쓰기이고, 나머지는 전부 Read Model 또는 캐시에서 읽는다. 동일 revision SHA는 변하지 않으므로 스냅샷·diff는 영구 캐시된다.

---

## 데이터 흐름 (Refresh)

```
POST /refresh
  → adapter.listRevisions()         git log / GitHub API
  → adapter.getFileEntries()         git show / blob API  (revision별)
  → SnapshotBuilder.build()          oa-gen 파이프라인 인메모리 실행
  → SqliteCache.saveSnapshot()       Write Side에 저장
  → SnapshotBuilder.diff()           인접 revision 간 diff 계산
  → SqliteCache.saveDiff()           Write Side에 저장
  → SqliteCache.upsertTimelineEntry() Read Model 갱신 (timeline_entries)
```

---

## 관련 문서

- [설계 문서](./design.md) — 전체 아키텍처 결정 기록 (Opus 자문 포함)
- [Concepts](../concepts.md) — oa-sdk 공통 용어
- [OpenAPI Governance Workflow](../guides/use-cases/openapi-governance-workflow.md)
