# spec-lens Design

OpenAPI 스펙 변경 이력 관리·관측 도구. oa-sdk가 관리하는 definition fragments의 커밋별 변화를 수집하고, path provenance·diff·fragment 그래프를 시각화한다.

---

## 목표

- 커밋 단위로 OpenAPI 스펙 변경 이력 수집
- 다양한 git 소스(GitHub, GitLab, 로컬 git, 파일 직접 비교)를 어댑터로 추상화
- path가 어느 fragment에서 왔는지 추적 (provenance)
- 브라우저 UI: 타임라인 → diff → path 출처 → fragment 그래프

## 비목표

- `oa-gen build-spec` 코어 로직 변경
- 실시간 스펙 모니터링 (배치·온디맨드만)
- Kafka / Redis Stack 등 분산 인프라 (로컬 개발 도구이므로 SQLite 단일 저장소)

---

## CQRS 데이터 흐름

spec-lens는 단일 Command(쓰기)와 다수 Query(읽기)로 구성된다.

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation (Hono HTTP)                                    │
│  POST /api/refresh ──► [Command]  RefreshTimeline           │
│  GET  /api/timeline ──► [Query]   GetTimeline               │
│  GET  /api/snapshot/:id ──► [Query]  GetSnapshot            │
│  GET  /api/diff/:base/:head ──► [Query]  GetDiff            │
│  GET  /api/paths ──► [Query]  GetPaths                      │
│  GET  /api/graph ──► [Query]  GetGraph                      │
└───────────┬────────────────────────┬─────────────────────────┘
            │                        │
   🔴 Write Flow              🔵 Read Flow
            │                        │
            ▼                        ▼
┌───────────────────┐    ┌──────────────────────┐
│ Application       │    │ Application           │
│ Commands/         │    │ Queries/              │
│ RefreshTimeline   │    │ GetTimeline           │
│ Handler           │    │ GetSnapshot ...       │
└────────┬──────────┘    └──────────┬────────────┘
         │ outbound port             │ outbound port
         ▼                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Infrastructure                                              │
│                                                              │
│  source-adapters/     snapshot-engine/     cache/           │
│  (SpecSourcePort)     (SnapshotBuilderPort) (CachePort)     │
│  ├ GitHub             SnapshotBuilder       SqliteCache      │
│  ├ LocalGit           DiffBuilder                            │
│  └ File                                                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  SQLite (spec-lens.db)                                  │ │
│  │                                                         │ │
│  │  Write Side (Primary):    Read Side (Read Model):       │ │
│  │  ├ snapshots              ├ timeline_entries ◄─ Sync    │ │
│  │  ├ diffs                  └ path_entries     ◄─ Worker  │ │
│  │  ├ fragment_blobs                                        │ │
│  │  └ snapshot_entries                                      │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 🔴 Write Flow (RefreshTimeline Command)

1. `POST /api/refresh` → `RefreshTimelineHandler`
2. `SpecSourcePort.listRevisions()` → 새 revision 목록
3. 각 revision: `SpecSourcePort.getFileEntries()` → `SpecFileEntry[]`
4. `SnapshotBuilderPort.build()` → `SpecSnapshot` (인메모리 빌드)
5. `SnapshotBuilderPort.diff()` → `SpecTimelineDiff` (인접 revision 비교)
6. `CachePort.saveSnapshot()` + `CachePort.saveDiff()` → SQLite Write Side (tx)
7. Sync Worker: Write Side 반영 후 `timeline_entries` / `path_entries` 비정규화 갱신

Application 코드는 6번에서 종료 (클라이언트 응답). Sync Worker는 비동기.

### 🔵 Read Flow (Query)

- `GetTimelineHandler` → `CachePort.listTimeline()` → **Read Model(`timeline_entries`)만** 조회
- `GetSnapshotHandler` → `CachePort.getSnapshot()` → snapshots 테이블
- `GetDiffHandler` → `CachePort.getDiff()` → diffs 테이블 (미캐시 시 on-demand 계산)
- `GetPathsHandler` → `CachePort.listPaths()` → **Read Model(`path_entries`)만** 조회

---

## 표준 데이터 포맷

모든 어댑터는 이 포맷으로 데이터를 생산한다.

### SpecRevision — 시점 식별자

```typescript
type SpecSourceKind = 'github' | 'gitlab' | 'local-git' | 'file'

type SpecRevision = {
  id: string             // 전체 커밋 SHA, 또는 파일 경로 식별자
  shortId: string        // 7자 SHA 또는 약칭
  timestamp: number      // unix epoch ms
  message: string        // 커밋 메시지 또는 설명
  author?: string
  source: SpecSourceKind
  sourceRef?: string     // 브랜치명, 태그 등
  metadata?: Record<string, unknown>
}
```

### SpecFileEntry — fragment 파일 하나의 내용

```typescript
type SpecFileEntry = {
  relativePath: string   // fragmentsDir 기준 상대 경로
  content: string        // 원본 YAML/JSON 텍스트
  contentHash: string    // sha256(content)
}
```

### SpecSnapshot — 한 시점의 빌드 결과 (Write Side)

```typescript
// wire 타입 (API 응답)
type SpecSnapshot = {
  schemaVersion: 'spec-lens.snapshot.v1'
  revision: SpecRevision
  fragmentsDir: string
  targetPath: string
  spec: Record<string, unknown> | null
  provenance: BuildSpecProvenanceMap     // @oa-sdk/codegen/spec-lens 재사용
  composition: BuildSpecCompositionReport
  diagnostics: SpecSnapshotDiagnostic[]
  builtAt: number
  entries?: SpecFileEntry[]              // ?include=entries 파라미터 시만 포함
}

// storage 타입 (SQLite 저장)
type SpecSnapshotStored = Omit<SpecSnapshot, 'entries'> & {
  entryRefs: Array<{ relativePath: string; contentHash: string }>
}
```

### SpecTimelineDiff — 두 시점 간 차이 (Write Side)

```typescript
type SpecTimelineDiff = {
  schemaVersion: 'spec-lens.diff.v1'
  baseRevision: SpecRevision
  headRevision: SpecRevision
  normalizedDiff: OpenApiNormalizedDiffEntry[]   // @oa-sdk/codegen 재사용
  breakingDiff: ContractDiffChange[]             // @oa-sdk/codegen 재사용
  provenanceDiff: BuildSpecProvenanceDiffEntry[] // @oa-sdk/codegen 재사용
  affectedFragments: string[]
  stats: {
    pathsAdded: number; pathsRemoved: number; pathsChanged: number
    schemasAdded: number; schemasRemoved: number; schemasChanged: number
    breakingChanges: number
  }
}
```

### Read Model 타입 — 비정규화 조회 전용

```typescript
// timeline_entries: 타임라인 목록 화면용
type SpecTimelineEntry = {
  revision: SpecRevision
  affectedFiles: string[]
  snapshotCached: boolean
  diffStats: {
    pathsAdded: number; pathsRemoved: number; pathsChanged: number
    breakingChanges: number
  }
}

// path_entries: path provenance 화면용
type SpecPathEntry = {
  path: string
  methods: string[]
  canonicalId: string
  scope: string
  domain: string
  sourceFile: string
  contentHash: string
  lastChangedRevisionId: string
  lastChangedTimestamp: number
}
```

---

## 포트 인터페이스 (application/ports/)

### SpecSourcePort — 외부 소스 어댑터 계약

```typescript
// application/ports/spec-source.port.ts
interface SpecSourcePort {
  readonly kind: SpecSourceKind

  listRevisions(options: {
    fragmentsDir: string
    branch?: string
    limit?: number
    since?: number  // unix epoch ms
    until?: number
  }): Promise<SpecRevision[]>

  getFileEntries(options: {
    revision: SpecRevision
    fragmentsDir: string
  }): Promise<SpecFileEntry[]>

  getChangedFiles(options: {
    baseRevision: SpecRevision
    headRevision: SpecRevision
    fragmentsDir: string
  }): Promise<string[]>
}
```

### SnapshotBuilderPort — 스펙 빌드 계약

```typescript
// application/ports/snapshot-builder.port.ts
interface SnapshotBuilderPort {
  build(options: {
    revision: SpecRevision
    entries: SpecFileEntry[]
    fragmentsDir: string
    targetConfig: DefinitionTargetConfig
  }): Promise<SpecSnapshot>

  diff(base: SpecSnapshot, head: SpecSnapshot): SpecTimelineDiff
}
```

### CachePort — 저장소 계약

```typescript
// application/ports/cache.port.ts
interface CachePort {
  // Write Side
  saveSnapshot(snapshot: SpecSnapshotStored, entries: SpecFileEntry[]): Promise<void>
  saveDiff(diff: SpecTimelineDiff): Promise<void>

  // Read Model (갱신은 Sync Worker만)
  upsertTimelineEntry(entry: SpecTimelineEntry): Promise<void>
  upsertPathEntries(revisionId: string, entries: SpecPathEntry[]): Promise<void>

  // Read
  listTimeline(options: { fragmentsDir: string; limit?: number }): Promise<SpecTimelineEntry[]>
  getSnapshot(revisionId: string): Promise<SpecSnapshotStored | null>
  getDiff(baseId: string, headId: string): Promise<SpecTimelineDiff | null>
  listPaths(options: { fragmentsDir: string; scope?: string; domain?: string }): Promise<SpecPathEntry[]>
  getFragmentBlob(contentHash: string): Promise<string | null>
}
```

---

## 어댑터 구현 (infrastructure/)

### GithubAdapter

```typescript
// infrastructure/source-adapters/github/
type GithubAdapterConfig = {
  owner: string
  repo: string
  tokenProvider: TokenProvider
  baseUrl?: string  // GitHub Enterprise
}

interface TokenProvider {
  getToken(repoKey: string): Promise<string>
}
// resolve 순서: GITHUB_TOKEN env → gh auth token CLI → explicit config
```

| 작업 | GitHub API |
|------|-----------|
| 커밋 목록 | `GET /repos/{owner}/{repo}/commits?path={fragmentsDir}&sha={branch}` |
| 커밋 트리 | `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1` |
| Blob 내용 | `GET /repos/{owner}/{repo}/git/blobs/{blob_sha}` (base64) |
| 변경 파일 | `GET /repos/{owner}/{repo}/compare/{base}...{head}` |

### LocalGitAdapter

`child_process`로 git CLI 직접 호출. 외부 의존성 없음.

| 작업 | git 명령 |
|------|---------|
| 커밋 목록 | `git log --format="%H%n%aI%n%s%n%an" -- <fragmentsDir>` |
| 파일 목록 | `git ls-tree -r --name-only <sha> -- <fragmentsDir>` |
| 파일 내용 | `git show <sha>:<relativePath>` |
| 변경 파일 | `git diff --name-only <base>..<head> -- <fragmentsDir>` |

### FileDiffAdapter

두 디렉터리 직접 비교. `listRevisions()` → `[headRevision, baseRevision]` 두 항목만 반환.

---

## codegen 확장 — loadDefinitionFragmentsFromEntries

어댑터가 넘겨주는 `SpecFileEntry[]`에서 기존 `LoadedDefinitionFragments`를 생성하는 공개 함수.

```typescript
// packages/codegen/src/spec-lens/index.ts (새 subpath export)
export function loadDefinitionFragmentsFromEntries(
  entries: SpecFileEntry[],
  fragmentsDir: string,
): LoadedDefinitionFragments

// re-export (spec-lens가 필요한 타입·빌더)
export type { BuildSpecProvenanceMap, BuildSpecCompositionReport, BuildSpecProvenanceDiffEntry }
export { createBuildSpecProvenanceMap, createBuildSpecCompositionReport, diffOpenApiDocuments, diffEndpoints }
```

구현: 기존 `adaptDefinitionBuilderFragmentFile(filePath)` 내부의 `readAdapterSourceFile` 를
`adaptDefinitionBuilderFragmentFileFromContent(relativePath, content, fragmentsDir)` 로 분리.
`process.cwd()` 의존 없이 가상 절대 경로만 사용.

---

## 캐시 키 설계

```typescript
// infrastructure/cache/sqlite/cache-key.ts
type CacheKeyInput = {
  revisionId: string
  fragmentsDir: string
  targetConfigDigest: string  // 정규화 JSON → sha256
  codegenVersion: string      // @oa-sdk/codegen 패키지 버전
  schemaVersion: string       // 'spec-lens.snapshot.v1'
}

function buildCacheKey(input: CacheKeyInput): string
// sha256(JSON.stringify(sorted(input)))
```

- branch HEAD listing: 짧은 TTL (force-push/rebase 대응)
- revision SHA 기반 snapshot: `cacheKey` hit 시 영구

---

## SQLite 스키마

```sql
-- Write Side: 정밀 데이터
CREATE TABLE fragment_blobs (
  content_hash TEXT PRIMARY KEY,
  content      TEXT NOT NULL
);

CREATE TABLE snapshot_entries (
  cache_key     TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash  TEXT NOT NULL REFERENCES fragment_blobs(content_hash),
  PRIMARY KEY (cache_key, relative_path)
);

CREATE TABLE snapshots (
  cache_key     TEXT PRIMARY KEY,
  revision_id   TEXT NOT NULL,
  fragments_dir TEXT NOT NULL,
  target_path   TEXT NOT NULL,
  data          TEXT NOT NULL,  -- JSON(SpecSnapshotStored, entries 제외)
  built_at      INTEGER NOT NULL
);

CREATE TABLE diffs (
  base_revision_id TEXT NOT NULL,
  head_revision_id TEXT NOT NULL,
  fragments_dir    TEXT NOT NULL,
  target_path      TEXT NOT NULL,
  data             TEXT NOT NULL,  -- JSON(SpecTimelineDiff)
  PRIMARY KEY (base_revision_id, head_revision_id, fragments_dir, target_path)
);

-- Read Model: Sync Worker가 갱신, Query는 여기만 조회
CREATE TABLE timeline_entries (
  revision_id        TEXT NOT NULL,
  fragments_dir      TEXT NOT NULL,
  short_id           TEXT NOT NULL,
  timestamp          INTEGER NOT NULL,
  message            TEXT NOT NULL,
  author             TEXT,
  affected_files     TEXT NOT NULL,  -- JSON array
  snapshot_cached    INTEGER NOT NULL DEFAULT 0,
  paths_added        INTEGER NOT NULL DEFAULT 0,
  paths_removed      INTEGER NOT NULL DEFAULT 0,
  paths_changed      INTEGER NOT NULL DEFAULT 0,
  breaking_changes   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (revision_id, fragments_dir)
);

CREATE TABLE path_entries (
  fragments_dir           TEXT NOT NULL,
  path                    TEXT NOT NULL,
  methods                 TEXT NOT NULL,  -- JSON array
  canonical_id            TEXT NOT NULL,
  scope                   TEXT NOT NULL,
  domain                  TEXT NOT NULL,
  source_file             TEXT NOT NULL,
  content_hash            TEXT NOT NULL,
  last_changed_revision   TEXT NOT NULL,
  last_changed_timestamp  INTEGER NOT NULL,
  PRIMARY KEY (fragments_dir, path)
);
```

---

## HTTP 서버 (Hono)

```typescript
type SpecLensServerConfig = {
  adapter: SpecSourcePort
  fragmentsDir: string
  targetPath: string
  branch?: string
  port?: number
  dbPath?: string
  uiDir?: string  // 정적 파일 위치 (빌드된 apps/spec-lens)
}
```

| Method | Path | Handler | 반환 |
|--------|------|---------|------|
| `POST` | `/api/refresh` | RefreshTimelineHandler | `{ queued: true }` |
| `GET` | `/api/timeline` | GetTimelineHandler | `SpecTimelineEntry[]` (Read Model) |
| `GET` | `/api/snapshot/:id` | GetSnapshotHandler | `SpecSnapshot` |
| `GET` | `/api/snapshot/:id?include=entries` | GetSnapshotHandler | `SpecSnapshot + entries` |
| `GET` | `/api/diff/:baseId/:headId` | GetDiffHandler | `SpecTimelineDiff` |
| `GET` | `/api/paths` | GetPathsHandler | `SpecPathEntry[]` (Read Model) |
| `GET` | `/api/graph` | GetGraphHandler | `{ nodes, edges }` |
| `GET` | `/ui/*` | serveStatic | React 앱 |

---

## UI (apps/spec-lens)

스택: React + Vite + TanStack Query + Monaco Editor + D3.js

운영: `packages/spec-lens` 서버가 `apps/spec-lens` 빌드 결과를 `/ui/` 경로로 서빙  
개발: `apps/spec-lens` Vite dev server (포트 5173) + `/api/*` → Hono 프록시

### 뷰

| 뷰 | 데이터 소스 | 주요 기능 |
|----|-----------|---------|
| **Timeline** | `GET /api/timeline` (Read Model) | 커밋 목록, +/- 배지, ⚡breaking 배지, 클릭 → Diff |
| **Diff** | `GET /api/diff/:base/:head` | 좌(base)/우(head) Monaco diff, breaking changes 탭 |
| **Path Provenance** | `GET /api/paths` (Read Model) | path 테이블, scope/domain 필터, last changed |
| **Fragment Graph** | `GET /api/graph` | D3 force-graph, $ref 엣지, scope별 색상 |

---

## 패키지 구조

```
packages/spec-lens/
├── src/
│   ├── domain/
│   │   ├── types.ts                        # 표준 포맷 타입 전체
│   │   └── index.ts                        # Barrel export
│   │
│   ├── application/
│   │   ├── commands/
│   │   │   ├── refresh-timeline.command.ts # Command + Handler
│   │   │   └── sync-read-model.command.ts  # Sync Worker (Read Model 갱신)
│   │   ├── queries/
│   │   │   ├── get-timeline.query.ts
│   │   │   ├── get-snapshot.query.ts
│   │   │   ├── get-diff.query.ts
│   │   │   ├── get-paths.query.ts
│   │   │   └── get-graph.query.ts
│   │   ├── ports/
│   │   │   ├── spec-source.port.ts         # SpecSourcePort 인터페이스
│   │   │   ├── snapshot-builder.port.ts    # SnapshotBuilderPort 인터페이스
│   │   │   └── cache.port.ts               # CachePort 인터페이스
│   │   └── index.ts
│   │
│   ├── infrastructure/
│   │   ├── source-adapters/
│   │   │   ├── github/
│   │   │   │   ├── github.adapter.ts
│   │   │   │   └── token-provider.ts
│   │   │   ├── local-git/
│   │   │   │   └── local-git.adapter.ts
│   │   │   └── file/
│   │   │       └── file-diff.adapter.ts
│   │   ├── snapshot-engine/
│   │   │   ├── snapshot-builder.ts         # SnapshotBuilderPort 구현
│   │   │   └── diff-builder.ts
│   │   ├── cache/
│   │   │   └── sqlite/
│   │   │       ├── sqlite-cache.ts         # CachePort 구현
│   │   │       ├── cache-key.ts            # 캐시 키 산정 (단위 테스트 박제)
│   │   │       └── schema.sql
│   │   └── index.ts
│   │
│   ├── presentation/
│   │   └── http/
│   │       ├── server.ts                   # Hono 서버 설정
│   │       └── routes/
│   │           ├── refresh.route.ts
│   │           ├── timeline.route.ts
│   │           ├── snapshot.route.ts
│   │           ├── diff.route.ts
│   │           ├── paths.route.ts
│   │           └── graph.route.ts
│   │
│   └── index.ts                            # 공개 API (serve 함수 등)
│
├── package.json
└── tsconfig.json

packages/codegen/
└── src/
    └── spec-lens/                          # 신규 subpath export
        └── index.ts                        # loadDefinitionFragmentsFromEntries + 타입 re-export

apps/spec-lens/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── api/                               # TanStack Query hooks
│   ├── views/
│   │   ├── Timeline.tsx
│   │   ├── DiffView.tsx
│   │   ├── PathProvenance.tsx
│   │   └── FragmentGraph.tsx
│   └── components/
├── index.html
├── vite.config.ts
└── package.json
```

---

## 구현 순서

| 단계 | 내용 | 위치 |
|------|------|------|
| 1 | `domain/types.ts` 표준 포맷 타입 | `packages/spec-lens/src/domain/` |
| 2 | `application/ports/` 3개 포트 인터페이스 | `packages/spec-lens/src/application/ports/` |
| 3 | `packages/codegen` spec-lens subpath export + `loadDefinitionFragmentsFromEntries` | `packages/codegen/src/spec-lens/` |
| 4 | `infrastructure/snapshot-engine/` SnapshotBuilderPort 구현 | `packages/spec-lens/src/infrastructure/snapshot-engine/` |
| 5 | `infrastructure/cache/sqlite/` CachePort 구현 + 스키마 | `packages/spec-lens/src/infrastructure/cache/sqlite/` |
| 6 | `infrastructure/source-adapters/github/` GithubAdapter | `packages/spec-lens/src/infrastructure/source-adapters/github/` |
| 7 | `infrastructure/source-adapters/local-git/` LocalGitAdapter | `packages/spec-lens/src/infrastructure/source-adapters/local-git/` |
| 8 | `application/commands/` RefreshTimeline + SyncReadModel | `packages/spec-lens/src/application/commands/` |
| 9 | `application/queries/` 5개 Query Handler | `packages/spec-lens/src/application/queries/` |
| 10 | `presentation/http/` Hono 서버 + routes | `packages/spec-lens/src/presentation/http/` |
| 11 | `apps/spec-lens/` React UI | `apps/spec-lens/` |
