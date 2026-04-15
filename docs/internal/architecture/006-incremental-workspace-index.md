# ADR-006 — SQLite 기반 증분 Workspace Index

## 상태

채택됨

## 컨텍스트

OAS 3.2 스펙은 도메인별 YAML, 외부 `$ref`, JSON Schema 2020-12 `$ref` sibling 보존, typegen external alias, schema meta validation을 함께 처리한다.
단발 `validate`/`typegen` 실행은 메모리 `Map`/`Set` 기반 full scan이 단순하고 안전하지만, watch mode나 반복 CLI 실행에서는 변경된 파일과 그 영향 범위만 다시 계산해야 한다.

증분 업데이트에는 이전 실행의 파일 hash, component 소유권, `$ref` edge, source location, diagnostic, type alias 결과가 필요하다.
JSON manifest는 dependency query와 무효화가 복잡해지므로 로컬 SQLite DB를 workspace index로 사용한다.

## 결정

SQLite는 parser correctness 경로에 넣지 않는다.  
`@oa-sdk/parser`는 Node/browser 양쪽에서 동작하는 메모리 기반 `RefResolver`를 유지하고, SQLite는 `@oa-sdk/codegen` CLI/dev/schema pipeline의 선택적 증분 인덱스 레이어로 둔다.

기본 원칙:
- 기본 단발 실행은 full scan + 메모리 cache.
- `--incremental` 또는 `dev` watch mode에서만 `.oa-cache/state.sqlite`를 사용.
- SQLite cache miss, schema mismatch, DB 손상 시 full rebuild로 fallback.
- 중복 component, ref 해소, cycle diagnostic의 최종 판단은 현재 파일 내용 기준으로 재계산 가능해야 한다.
- DB는 정답 저장소가 아니라 변경 감지와 영향도 계산용 index다.

## 책임 분리

| 레이어 | 책임 |
|---|---|
| `RefResolver` | 내부/외부 `$ref` 해소, pointer lookup, per-run cache, cycle stack, source pointer |
| `SourceMapIndex` | YAML AST 기반 pointer → line/column 매핑 |
| `WorkspaceIndex` | 파일 hash, component, ref edge, diagnostics, type alias metadata 저장/조회 |
| `SQLiteWorkspaceIndex` | `.oa-cache/state.sqlite` 구현체, transaction, WAL, invalidation query |
| CLI orchestration | scan → changed detect → invalidate → dirty re-index → validate/typegen |

## SQLite 스키마 초안

```sql
create table meta (
  key text primary key,
  value text not null
);

create table files (
  file_path text primary key,
  real_path text not null,
  content_hash text not null,
  size integer not null,
  mtime_ms integer not null,
  parser_version text not null,
  last_seen_run text not null
);

create table components (
  file_path text not null,
  section text not null,
  name text not null,
  pointer text not null,
  content_hash text not null,
  owner text,
  line integer,
  column integer,
  primary key (file_path, section, name)
);

create table refs (
  from_file text not null,
  from_pointer text not null,
  ref_text text not null,
  to_file text,
  to_pointer text,
  kind text not null,
  resolved integer not null,
  diagnostic_code text,
  primary key (from_file, from_pointer, ref_text)
);

create table source_locations (
  file_path text not null,
  pointer text not null,
  line integer not null,
  column integer not null,
  primary key (file_path, pointer)
);

create table diagnostics (
  producer text not null,
  file_path text,
  pointer text,
  line integer,
  column integer,
  severity text not null,
  code text not null,
  message text not null
);

create table type_aliases (
  source_file text not null,
  source_pointer text not null,
  ref_text text not null,
  alias_name text not null,
  renamed_from text,
  content_hash text not null,
  primary key (source_file, source_pointer, ref_text)
);
```

필수 index:

```sql
create index refs_to_file_idx on refs(to_file);
create index refs_from_file_idx on refs(from_file);
create index components_key_idx on components(section, name);
create index diagnostics_file_idx on diagnostics(file_path);
```

## 증분 알고리즘

1. scan
   - entry spec, domain specs, profile specs, external ref 후보 파일을 수집한다.
   - `realpath`, `size`, `mtime`, `sha256(content)`를 계산한다.

2. detect changes
   - `files` 테이블과 비교하여 new/modified/deleted 파일을 찾는다.
   - cache key에는 `oa-sdk` version, index schema version, resolver options, profile, override config, typegen options를 포함한다.

3. invalidate
   - changed/deleted file의 `components`, `refs`, `diagnostics`, `source_locations`, `type_aliases`를 삭제한다.
   - `refs.to_file` 역방향 query로 영향을 받는 source file을 dirty 처리한다.

4. re-index dirty files
   - YAML/JSON parse, source map 생성, component 수집, `$ref` edge 수집을 다시 수행한다.
   - transaction 안에서 새 index row를 기록한다.

5. validate global constraints
   - component 중복은 `components(section, name)` group query로 판정한다.
   - ref cycle은 DB edge를 읽어 메모리 graph DFS/Tarjan으로 판정한다.
   - missing external ref는 resolver diagnostic으로 기록한다.

6. run affected outputs
   - validate는 dirty/impacted 파일 diagnostic을 갱신한다.
   - typegen은 external alias/type output 영향이 있을 때 재생성한다.
   - merge는 path/component 중복을 현재 파일 기준으로 다시 확인한다.

7. fallback
   - DB schema version mismatch, DB 오류, 옵션 mismatch, cache 불일치가 있으면 full rebuild를 수행한다.

## Component 중복 정책

중복 차단 정책은 현재 `merge.ts`와 동일하다.

- 중복 path는 항상 오류.
- 중복 component는 기본 오류.
- `ALLOW_COMPONENT_OVERRIDES=1`이면 warning 후 허용.
- `ALLOW_COMPONENT_OVERRIDE_KEYS=schemas.User,...`는 지정 key만 허용.
- 두 component의 content hash가 같아도 기본 오류다. 동일 내용 중복을 허용하면 소유권이 흐려지고, 이후 한쪽만 바뀔 때 증분 결과가 불안정해진다.

SQLite 판정 query:

```sql
select section, name, count(*) as n, group_concat(file_path) as owners
from components
group by section, name
having n > 1;
```

## CLI 노출

초기에는 opt-in만 허용한다.

```bash
oa-gen validate --spec .merged.yaml --incremental --cache-dir .oa-cache
oa-gen typegen --spec .merged.yaml -o types.ts --incremental --cache-dir .oa-cache
oa-gen dev --spec .merged.yaml --cache-dir .oa-cache
oa-gen cache clear --cache-dir .oa-cache
```

`dev` watch mode는 안정화 후 기본 증분 사용을 검토할 수 있다. 단발 `validate`/`typegen`은 full mode를 기본으로 유지한다.

## SQLite 운영

```sql
pragma journal_mode = wal;
pragma busy_timeout = 5000;
pragma foreign_keys = on;
```

- writer는 한 번에 하나만 둔다.
- index 갱신은 transaction 단위로 수행한다.
- 실패 시 해당 run의 변경분은 rollback한다.
- DB 오류는 warning 후 full rebuild로 fallback한다.
- full rebuild 결과가 DB 증분 결과보다 우선한다.

## 구현 순서

1. 메모리 `RefResolver` 인터페이스 도입.
2. `resolveRefGraph()`를 resolver 기반으로 이전.
3. `derefSpec()`를 resolver 기반으로 이전.
4. `WorkspaceIndex` 인터페이스와 noop/memory 구현 도입. (US-007 완료)
5. `SQLiteWorkspaceIndex` 구현. (US-008 완료)
6. scan + dirty detection + refs.to_file dependency invalidation primitive 구현. (US-009 완료)
7. `oa-gen validate --incremental` 연결.
8. `oa-gen typegen --incremental` 연결.
9. `oa-gen dev` watch invalidation에 연결.

## 결과

- parser 패키지는 SQLite 의존성을 갖지 않는다.
- 브라우저/mock-server 번들 안전성을 유지한다.
- 단발 실행은 현재처럼 단순한 full validation/typegen을 유지한다.
- 반복 실행과 watch mode에서만 SQLite workspace index로 변경 감지와 영향도 계산을 최적화한다.
