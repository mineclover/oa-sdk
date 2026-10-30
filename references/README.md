# 외부 소스 레퍼런스

이 디렉터리의 외부 저장소는 Git submodule의 commit으로 고정한다. 소스 검토용이며,
추가만으로 workspace dependency나 런타임 저장소 엔진에 연결되지 않는다.

| 레퍼런스 | 원본 | 용도 |
|---|---|---|
| `OpenAPI-Specification` | [OAI/OpenAPI-Specification](https://github.com/OAI/OpenAPI-Specification) | OpenAPI 사양 검토 |
| `bun-graph-db` | [mineclover/bun-graph-db](https://github.com/mineclover/bun-graph-db) | 동적 table schema와 OpenAPI projection producer |
| `kuzu` | [kuzudb/kuzu](https://github.com/kuzudb/kuzu) | Bun Graph DB의 그래프 저장·질의·검색·분석 기능 비교 |

Kuzu 비교 기준은 `89f0263cc7a1fd9c396d2c4953747a013556a7f9`이며,
Bun Graph DB 기준은 `c0655576e9d1d02bd78a6f598e8b27ab2b141d67`이다.
분석 결과와 후속 과제는 [Bun Graph DB / Kuzu 기능 비교](../docs/guides/use-cases/bun-graph-db-kuzu-comparison.md)를 따른다.
알고리즘·문서 관리·계층 분리의 후속 분석과 Bun Graph DB 로컬 변경은
[Kuzu 설계의 복합 분석과 적용](../docs/guides/use-cases/bun-graph-db-kuzu-design-adoption.md)에서 추적한다.

2026-10-27 확인 시 Kuzu 원본은 archived 상태다. 공식 README는 확장 서버 종료도
공지하므로, 유지보수 중인 의존성과 구별해 설계 레퍼런스로 사용한다.

처음 체크아웃한 환경에서 비교용 소스를 준비하려면 저장소 루트에서 실행한다.

```bash
git submodule update --init references/bun-graph-db references/kuzu
git submodule status references/bun-graph-db references/kuzu
```
