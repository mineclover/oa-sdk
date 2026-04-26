# @oa-sdk/spec-lens

OpenAPI 스펙 변경 이력 관리·관측 서버 패키지.

git 소스(GitHub / GitLab / 로컬 git)에서 definition fragments 변경 이력을 수집하고, 커밋별 스냅샷 빌드·diff 계산·Read Model 갱신을 수행하며, Hono HTTP API로 제공한다. 브라우저 UI(`apps/spec-lens`)가 이 API를 소비한다.

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
fragmentsDir: packages/schemas/src/fragments
targetPath: packages/schemas/src/targets/book-notebook-api.yaml
port: 4891
dbPath: .spec-lens.db
```

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
│   │   ├── gitlab/       GitlabAdapter (REST API)  ⚠️ 테스트 환경 미구축
│   │   ├── local-git/    LocalGitAdapter
│   │   └── file/         FileDiffAdapter (두 디렉터리 직접 비교)
│   ├── snapshot-engine/  SnapshotBuilder (oa-gen 파이프라인 인메모리)
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
| `cache-key.test.ts` | 캐시 키 결정성, 파라미터별 격리 |
| `sqlite-cache.test.ts` | save/load 라운드트립, isolation, upsert, limit |
| `snapshot-builder-diff.test.ts` | diff 통계, affectedFragments, null spec 핸들링 |
| `local-git-adapter.test.ts` | 실제 repo 기반 통합 검증 |
| `get-graph-query.test.ts` | 노드 빌드, 엣지 해석, self-loop 제외 |
| `refresh-timeline.test.ts` | full workflow, lastChanged 최신 우선, 빌드 실패 처리 |
| `query-handlers.test.ts` | GetDiff / GetPaths / GetSnapshot / GetTimeline 핸들러 |

## 알려진 제약

- `fragment_blobs` 테이블은 content-addressable이므로 `clearCache` 시 삭제하지 않는다. 장기 운영 시 미참조 blob이 누적될 수 있으나 중복 저장은 없다.
- `source: github` 의 `GithubAdapter`는 bare clone 후 로컬 git으로 동작한다. git CLI가 없는 환경에서는 `GithubApiAdapter`를 직접 사용한다.
- `source: gitlab` 은 테스트 환경 미구축 (TODO).
