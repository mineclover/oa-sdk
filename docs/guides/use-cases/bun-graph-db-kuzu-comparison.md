# Bun Graph DB / Kuzu 기능 비교

Bun Graph DB의 개선 설계를 위한 Kuzu 소스 레퍼런스와 기능 차이를 기록한다.
Kuzu는 임베디드 그래프 질의 엔진에, Bun Graph DB는 동적 스키마를 GraphQL·REST·MCP로
제공하는 애플리케이션 데이터 서비스에 초점이 있다. 현재 구현을 기준으로 보면
Kuzu에서 참고할 핵심은 그래프 질의 계획, 전용 저장 구조, 벡터 검색, 분석 알고리즘이다.
Bun Graph DB의 API·템플릿·OpenAPI projection은 별도로 유지할 가치가 있다.

이 기능표는 아래 고정 snapshot 기준이다. 이후 알고리즘·문서 관리·계층 분리의 분석과
로컬 구현 변경은 [Kuzu 설계의 복합 분석과 적용](./bun-graph-db-kuzu-design-adoption.md)에서 추적한다.

## 비교 기준과 재현 범위

| 항목 | 기준 |
|---|---|
| 확인일 | 2026-10-27 (Asia/Seoul) |
| Bun Graph DB | `references/bun-graph-db`, commit `c0655576e9d1d02bd78a6f598e8b27ab2b141d67` |
| Kuzu | `references/kuzu`, commit `89f0263cc7a1fd9c396d2c4953747a013556a7f9` (`master` 소스 snapshot) |
| 배포판 참고 | [Kuzu v0.11.3 릴리스](https://github.com/kuzudb/kuzu/releases/tag/v0.11.3), 2025-10-10 공개. 위 `master` snapshot과 배포판을 동일시하지 않는다. |
| 확인 방법 | 공식 GitHub 메타데이터·README·릴리스 및 두 저장소의 구현/기존 테스트 정적 검토 |
| 성능 범위 | 두 엔진을 같은 데이터로 실행한 비교 벤치마크는 수행하지 않았다. 구조 차이를 속도 배수나 최대 처리량으로 환산하지 않는다. |
| 추가 범위 | Kuzu를 소스 submodule로 등록. DB 엔진 교체, 패키지 설치, 바인딩 호환성 검증은 후속 작업이다. |

GitHub API에서 Kuzu의 `archived: true`를 확인했다. [공식 README](https://github.com/kuzudb/kuzu/blob/89f0263cc7a1fd9c396d2c4953747a013556a7f9/README.md)는
아카이브와 공식 확장 서버 종료를 공지한다. v0.11.3은 `algo`, `fts`, `json`, `vector`를
사전 포함하며, 다른 확장이나 이전 버전은 자체 확장 서버가 필요하다.
따라서 Kuzu는 고정 소스에서 설계를 학습하는 레퍼런스로 채택하고, 운영 의존성 채택은
별도 판단한다. 확장 소스가 있다는 사실만으로 모든 배포판·WASM에서 로드 가능하다고 보지 않는다.

## 기능 비교

`구현 확인`은 해당 snapshot에서 코드가 존재함을 뜻한다. `미확인`은 이번 검토 범위에서
대응 구현을 찾지 못했다는 뜻이며, 외부 패키지나 별도 프로젝트까지 부재를 단정하지 않는다.
근거 번호는 아래 소스 목록으로 연결된다.

| 기능 | Bun Graph DB 현재 구현 | Kuzu 레퍼런스 | 비교 결과 / 근거 |
|---|---|---|---|
| 실행 구조 | Bun 중심 TypeScript 서버, SQLite 접근 | C++ 임베디드 엔진과 언어 바인딩 | 서비스 계층과 엔진 계층의 역할이 다르다. B1, K1, K7 |
| 그래프 모델 | Table/Node/Attribute/NodeRelation, 외부 ID, 관계 properties/strength | 타입을 선언하는 node/rel table, PK와 관계 endpoint 스키마 | 동적 속성 모델을 Kuzu의 물리 table에 매핑하는 규칙이 필요하다. B2, K2 |
| 스키마 변경·검증 | 런타임 attribute/type, JSON Schema projection과 입력 검증 | 타입 기반 DDL과 catalog | 동적 스키마 계약과 물리 DDL은 동일 기능이 아니다. B2, B7, K2 |
| 질의 언어 | GraphQL/REST/MCP 작업, 검색 필터, GraphQL 템플릿 | Cypher `MATCH`, filter, join, aggregation, subquery | Bun 쪽 범용 Cypher parser/planner는 미확인. GraphQL을 Cypher 지원으로 세지 않는다. B1, B6, K2, K3 |
| 저장 구조 | SQLite tables/indexes와 속성 테이블 조인 | 디스크 columnar storage와 CSR 기반 인접 구조 | 저장 구조·인접 접근 방식이 주요 엔진 차이다. B3, K1 |
| 다중 hop·경로 | SQL recursive CTE 경로, 순환 방지, 단계별 dependency 탐색 | 가변 길이 패턴과 recursive join | Bun에도 구현 확인. 경로 유일성·방향·길이 제한을 맞춰 비교해야 한다. B4, K4 |
| 최단 경로 | GraphQL field resolver의 BFS, hop 수 기준, `maxDepth` | shortest/all-shortest, weighted shortest 경로 구현/테스트 | Bun의 관계 `strength` 저장을 가중 최단 경로 지원으로 해석하지 않는다. B4, K4 |
| 탐색 제한 | SQL 경로 결과 최대 100개, dependency 깊이 10/결과 100개 | 질의 패턴의 길이·조건에 따른 실행 | Bun의 제한은 API별로 다르다. GraphQL BFS에도 같은 상수가 적용된다고 가정하지 않는다. B4 |
| 텍스트 검색 | FTS5 `MATCH`/BM25, 속성 값 `LIKE`, FTS 미존재 시 `LIKE` fallback | `fts` 확장 기반 전문 검색 | 양쪽 모두 구현 확인. 토큰화·검색 대상·점수와 substring 의미가 다르므로 결과 동등성부터 확인한다. B5, K5 |
| 벡터 검색 | Exact cosine in-memory baseline, embedding persistence/ANN API는 미구현 | `vector` 확장의 HNSW 생성·질의 | 정확성 기준선과 recall@k·build/update/delete 비교 조건을 먼저 고정했다. B1, B14, K5 |
| 그래프 분석 | degree 정렬, 2-hop betweenness 근사, SQL PageRank 근사, 정확한 SCC/PageRank 모듈 | `algo`의 반복 PageRank, Louvain, SCC/WCC, k-core 등 | Bun의 근사 정렬을 정식 분석 알고리즘과 구별하고 정확한 SCC/PageRank를 별도 모듈로 추가했다. B8, B12, B13, K6 |
| 질의 최적화·관측 | 수동 SQL 구성, SQLite query plan과 hot-path benchmark | 그래프 planner/optimizer, `EXPLAIN`/`PROFILE`, 병렬 실행 | SQLite 최적화는 활용 중이며 그래프 전용 planner는 미확인. B3, B9, K1, K3 |
| 트랜잭션·복구 | SQLite transaction, node+attribute 원자적 쓰기, FK, 파일 DB의 WAL 기본 활성화 | 공식 serializable ACID 설명, WAL·commit·rollback·checkpoint 구현 | Bun에도 DB 트랜잭션이 있다. 모든 API 요청/비동기 batch가 단일 트랜잭션인지는 별도 확인이 필요하다. B3, K1, K8 |
| 동시 쓰기·병렬성 | SQLite 쓰기 직렬화와 timeout 설정 | 기본 `enableMultiWrites=false`; 활성 write가 있으면 추가 write 거절. 엔진 내부 다중 코어 질의 실행 | Kuzu도 기본 무제한 다중 writer가 아니다. 질의 병렬성과 쓰기 동시성을 분리한다. B3, K8 |
| API 인터페이스 | GraphQL·REST·MCP, root/table 범위 도구 | core와 Node/Python/Rust/Java/C/WASM 바인딩 | Kuzu core에서 대응 HTTP/GraphQL/MCP 서비스 구현은 미확인. 별도 서버 프로젝트/어댑터는 별개다. B1, K7 |
| 재사용 질의 | 템플릿 버전·변수 검증·사용 통계·MCP 도구 노출 | prepared statement와 parameter binding | 엔진 prepared statement는 애플리케이션 템플릿 관리 전체를 대신하지 않는다. B6, K7 |
| OpenAPI/JSON Schema | full document, table component/operation projection, `versionHash` | 대응하는 OA SDK projection producer는 미확인 | Bun의 핵심 통합 기능. backend 변경 시에도 계약 유지가 필요하다. B7 |
| REST·GraphQL·SQL 탐색 의미 | GraphQL field/service와 REST/SQL graph repository가 공통 SQLite path/dependency 결과를 사용하도록 통합 | Kuzu는 parser/planner/processor가 core 경로를 공유 | transport별 응답 모양은 다르지만 path/dependency 선택 semantics는 저장소 계약으로 수렴시켰다. B4, B15, K3 |
| 구독·실시간 | GraphQL subscription/템플릿 구독 경로 | core의 대응 subscription 서비스는 미확인 | WAL을 클라이언트 구독 API나 CDC로 간주하지 않는다. B6, K8 |
| 데이터 이동 | SQLite snapshot, JSONL, schema/table package, JSON export, Sheets 연동 코드 | CSV/Parquet/NumPy `COPY`, DB export/import, JSON 등 확장 | Bun의 업무용 round trip과 Kuzu의 분석 데이터 적재를 각각 평가한다. B10, K9 |
| 인증·table 접근 제어 | Bearer credential, reader/writer/admin, table 범위, 요청 제한 | 임베디드 core에서 대응 HTTP 인증·tenant 정책 미확인 | Bun의 table scope 정책은 Kuzu의 물리 DB 격리와 별개다. B11 |
| 브라우저·JS 호환성 | 현재 저장소에서 브라우저 내 DB 엔진 미확인 | Node native addon 및 WASM 구현 | Node 바인딩 존재만으로 Bun 호환을 보장하지 않는다. WASM은 worker/파일시스템/확장 제약을 따로 검증한다. B1, K7 |
| 분산 확장 | 현재 코드에서 분산 저장/복제 구현 미확인 | 임베디드 단일 DB 중심, core의 분산 클러스터 구현 미확인 | 어느 쪽도 이 비교만으로 수평 확장 해법으로 분류하지 않는다. B1, K1 |

## 우선 적용할 설계 과제

아래 표는 이번에 구현한 항목과 비교에서 남은 후속 작업을 함께 기록한다.

| 우선순위 | 작업 | 완료 판단 기준 |
|---|---|---|
| P0 | 탐색 계약 명시 | 방향, relation type, simple path/중복, hop·결과 제한, table scope, 정렬을 API별로 문서화하고 공통 fixture로 검증한다. 현재 SQL 경로의 100개 제한과 BFS `maxDepth`도 포함한다. |
| P0 | 기존 검색·트랜잭션 보장 고정 | FTS5/fallback·속성 검색의 의미, BM25 정렬, node+attribute rollback 범위, WAL 설정을 기존 테스트와 대응시킨다. |
| 완료 | 분석 알고리즘 정확성 구분 | `StronglyConnectedComponents`와 bounded `PageRank`를 저장소와 무관한 모듈로 추가하고 cycle·dangling node·수렴/반복 상한 정답 테스트를 통과시켰다. 기존 SQL betweenness/PageRank 근사식은 유지한다. |
| 완료 | bulk adjacency 포트 | SQLite `IN` query와 per-node fallback을 연결하고 방향·self-loop·순서 동등성을 테스트했다. |
| P1 | 동일 fixture 성능 비교 | 아래 실험 규약을 적용해 SQLite 경로와 Kuzu 경로의 결과 동등성·latency·memory·디스크 사용량을 기록한다. |
| P2 | 벡터 검색 실험 | embedding 생성 주체, ID 매핑, index 갱신/삭제, metric, 필터 조합과 recall@k를 정의하고 HNSW의 유효성을 측정한다. |
| P2 | 선택적 Kuzu read model | SQLite 원본에서 snapshot 기반 분석 투영을 만들고 freshness/version을 노출한다. 기존 REST/GraphQL/MCP/projection 계약을 통과한 뒤 채택 여부를 정한다. |

현 시점의 제안은 **SQLite 기반 서비스는 유지하고 Kuzu의 질의·분석 설계를 참고하는 것**이다.
분석 read model 실험은 가능하지만, archived 의존성의 유지보수 부담과 동기화·복구 비용을
수용할 근거가 생기기 전에는 주 저장소 교체로 확대하지 않는다. 이는 위 코드 차이에서 도출한
설계 판단이며, 실행 성능 측정 결과가 아니다.

### 성능 실험 규약

1. 같은 node/edge/property와 고정 seed를 사용한다. 작은 그래프부터 fan-out·cycle·다중 hop·속성 수가 큰 그래프로 늘린다.
2. 저장소 조회와 HTTP/GraphQL/MCP 왕복을 별도로 측정한다. 엔진 호출과 서버 왕복 시간을 직접 비교하지 않는다.
3. 1/2/3/5-hop, 최단 경로, 필터+집계, FTS, 일괄 적재를 측정한다. BM25 결과/토큰화가 다르면 동일 질의라고 보고 속도 순위를 매기지 않는다.
4. 방향·경로 유일성·깊이·결과 제한·인덱스·스레드·트랜잭션 설정을 기록하고 결과 ID/경로/집계가 일치하는지 먼저 확인한다.
5. cold/warm을 나누고, 반복 수·median/p95/p99·RSS·DB/index 크기·적재 시간과 실행 계획을 남긴다. 엔진 초기화/FFI 변환 비용도 분리한다.
6. Bun+native addon은 설치·DDL·CRUD·prepare/execute·rollback·재시작 smoke를 통과해야 한다. Node.js/WASM에서의 성공으로 이를 대신하지 않는다.

기존 [hot-path benchmark](../../../references/bun-graph-db/scripts/benchmark-hotpaths.ts)는
Bun Graph DB 내부 기준선으로 활용할 수 있지만, 현재 Kuzu 비교 수치를 제공하는 harness는 아니다.

## 구현 근거

다음 링크는 submodule checkout의 비교 기준 소스를 가리킨다. 새 환경에서는
[레퍼런스 준비 안내](../../../references/README.md)에 따라 두 submodule을 초기화한다.
기존 테스트 소스는 구현 근거이며, 아래 목록 자체가 이번 실행의 통과 기록은 아니다.

| ID | Bun Graph DB 소스 |
|---|---|
| B1 | [package/runtime](../../../references/bun-graph-db/package.json), [서버 진입점](../../../references/bun-graph-db/index.ts) |
| B2 | [Table](../../../references/bun-graph-db/src/domain/entities/Table.ts), [NodeRelation](../../../references/bun-graph-db/src/domain/entities/NodeRelation.ts), [DB schema](../../../references/bun-graph-db/scripts/database/schema.sql) |
| B3 | [SQLite 설정](../../../references/bun-graph-db/src/infrastructure/database/sqlite/SqlitePragmas.ts), [연결/트랜잭션](../../../references/bun-graph-db/src/infrastructure/database/sqlite/SqliteConnection.ts), [원자적 node 쓰기](../../../references/bun-graph-db/src/infrastructure/database/sqlite/SqliteNodeMutationRepository.ts) |
| B4 | [SQL 그래프 탐색](../../../references/bun-graph-db/src/infrastructure/database/sqlite/SqliteGraphRepository.ts), [GraphQL BFS](../../../references/bun-graph-db/src/presentation/graphql/field-resolvers/NodeFieldResolvers.ts), [SQL 탐색 테스트](../../../references/bun-graph-db/tests/unit/sqlite-graph-repository-traversal.test.ts), [BFS 테스트](../../../references/bun-graph-db/tests/unit/node-field-resolvers-graph-traversal.test.ts) |
| B5 | [FTS migration](../../../references/bun-graph-db/src/infrastructure/database/sqlite/DatabaseMigrationRunner.ts), [검색 구현](../../../references/bun-graph-db/src/infrastructure/database/sqlite/SqliteNodeSearchRepository.ts), [검색 테스트](../../../references/bun-graph-db/tests/unit/sqlite-node-search-fulltext.test.ts) |
| B6 | [템플릿 변수/통계](../../../references/bun-graph-db/src/application/use-cases/query-templates/ExecuteQueryTemplate.ts), [GraphQL 실행](../../../references/bun-graph-db/src/application/use-cases/query-templates/ExecuteTemplateWithGraphQL.ts), [구독 실행](../../../references/bun-graph-db/src/application/use-cases/query-templates/ExecuteTemplateWithSubscriptionUseCase.ts), [MCP](../../../references/bun-graph-db/src/presentation/mcp) |
| B7 | [full OpenAPI](../../../references/bun-graph-db/src/core/schema/BunGraphDbOpenApiDocument.ts), [table projection 서비스](../../../references/bun-graph-db/src/application/services/TableSchemaProjectionService.ts), [OA SDK 소비 흐름](./bun-graph-db-projections.md) |
| B8 | [관계/중심성 정렬 및 근사식](../../../references/bun-graph-db/src/application/services/sorting/RelationshipSortStrategy.ts) |
| B9 | [hot-path benchmark와 query plan](../../../references/bun-graph-db/scripts/benchmark-hotpaths.ts) |
| B10 | [SQLite backup](../../../references/bun-graph-db/src/domain/services/SQLiteBackupService.ts), [JSONL backup](../../../references/bun-graph-db/src/domain/services/JsonlBackupService.ts), [tabular 연동](../../../references/bun-graph-db/src/infrastructure/excel) |
| B11 | [접근 제어](../../../references/bun-graph-db/src/application/security/AccessControl.ts), [접근 제어 테스트](../../../references/bun-graph-db/tests/unit/access-control.test.ts) |
| B12 | [SCC 알고리즘](../../../references/bun-graph-db/src/domain/services/graph/StronglyConnectedComponents.ts), [SCC 정답 테스트](../../../references/bun-graph-db/tests/unit/strongly-connected-components.test.ts), [bulk adjacency](../../../references/bun-graph-db/src/infrastructure/database/sqlite/SqliteNodeRelationRepository.ts) |
| B13 | [정확한 PageRank](../../../references/bun-graph-db/src/domain/services/graph/PageRank.ts), [수렴/정규화 테스트](../../../references/bun-graph-db/tests/unit/page-rank.test.ts) |
| B14 | [Exact vector index](../../../references/bun-graph-db/src/domain/services/vector/ExactVectorIndex.ts), [vector/storage benchmark](../../../references/bun-graph-db/scripts/benchmark-vector-storage.ts), [비교 문서](../../../references/bun-graph-db/docs/architecture/vector-and-storage-comparison.md) |
| B15 | [GraphQL RelationQueries](../../../references/bun-graph-db/src/presentation/graphql/queries/RelationQueries.ts), [Graph API controller](../../../references/bun-graph-db/src/presentation/http/controllers/GraphApiController.ts), [SQLite graph repository](../../../references/bun-graph-db/src/infrastructure/database/sqlite/SqliteGraphRepository.ts) |

| ID | Kuzu 소스 |
|---|---|
| K1 | [공식 README/아카이브 공지](../../../references/kuzu/README.md) |
| K2 | [DDL·COPY·MATCH 예제](../../../references/kuzu/tools/nodejs_api/README.md), [catalog](../../../references/kuzu/src/catalog) |
| K3 | [planner](../../../references/kuzu/src/planner), [optimizer](../../../references/kuzu/src/optimizer), [EXPLAIN/PROFILE 테스트](../../../references/kuzu/test/test_files/explain/explain.test) |
| K4 | [recursive join 테스트](../../../references/kuzu/test/test_files/recursive_join), [shortest path 테스트](../../../references/kuzu/test/test_files/shortest_path), [weighted shortest 테스트](../../../references/kuzu/test/test_files/function/gds/weighted_shortest.test) |
| K5 | [FTS 확장](../../../references/kuzu/extension/fts), [HNSW 생성](../../../references/kuzu/extension/vector/src/function/create_hnsw_index.cpp), [HNSW 질의](../../../references/kuzu/extension/vector/src/function/query_hnsw_index.cpp) |
| K6 | [분석 알고리즘](../../../references/kuzu/extension/algo/src/function), [반복 PageRank](../../../references/kuzu/extension/algo/src/function/page_rank.cpp) |
| K7 | [언어 바인딩](../../../references/kuzu/tools), [Node API/prepare/execute](../../../references/kuzu/tools/nodejs_api/src_js/connection.js), [native addon 의존성](../../../references/kuzu/tools/nodejs_api/package.json), [WASM 변형과 제약](../../../references/kuzu/tools/wasm/README.md) |
| K8 | [트랜잭션/WAL/checkpoint](../../../references/kuzu/src/transaction/transaction_manager.cpp), [multi-write 기본값](../../../references/kuzu/src/main/db_config.cpp) |
| K9 | [COPY 형식 테스트](../../../references/kuzu/test/test_files/copy), [DB export/import 테스트](../../../references/kuzu/test/test_files/copy/export_import_db.test), [확장 목록/빌드 설정](../../../references/kuzu/extension/extension_config.cmake) |

## 이번 변경의 검증 결과

2026-10-27에 다음을 실행했다.

- 저장소 루트의 `pnpm check:docs`, `pnpm check:cli-spec`, `pnpm check:release-policy`, `pnpm check:api-index`: 통과.
- `pnpm typecheck:all`: 통과. Turbo 56개 task 전체 cache hit이며, Kuzu C++ 빌드나 바인딩 검증은 포함하지 않는다.
- `references/bun-graph-db`에서 아래 기존 테스트 실행: **20 pass, 0 fail, 71 assertions**. 검색·순환 경로·최단 경로·페이지 처리·원자적 쓰기/rollback을 확인했다.

```bash
bun test tests/unit/sqlite-node-search-fulltext.test.ts \
  tests/unit/sqlite-graph-repository-traversal.test.ts \
  tests/unit/node-field-resolvers-graph-traversal.test.ts \
  tests/unit/sqlite-node-mutation-repository.test.ts
```

이 결과는 Bun Graph DB의 비교 대상 기능에 대한 검증이다. Kuzu 테스트 suite 실행이나
두 엔진의 성능·전체 기능 동등성 검증은 수행하지 않았다.
