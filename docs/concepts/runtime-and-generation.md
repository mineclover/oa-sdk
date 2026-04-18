# Runtime And Generation

## Runtime Adapter

Runtime adapter는 framework runtime에서 OpenAPI document를 추출하는 경계다.

Python template의 FastAPI adapter가 첫 구현체다. TS/JS 쪽은 Hono, Express, Fastify,
Nest 등으로 확장할 수 있다.

## Workspace Index

Workspace Index는 파일 hash, component, `$ref`, source location, diagnostic, generated type
alias metadata를 저장하는 증분 최적화 계층이다.

정확성의 최종 기준은 항상 현재 파일을 다시 읽어 계산한 parser/codegen output이다. Index는
dirty detection과 영향도 계산을 돕지만 source of truth가 아니다.

구현 상세는 [ADR-006](../internal/architecture/006-incremental-workspace-index.md)을 참조한다.

## SchemaAlgebra

SchemaAlgebra는 OpenAPI schema tree를 타입별로 fold하는 해석 패턴이다.

typegen, mock data generation, validation support logic처럼 schema를 여러 방식으로 해석하는
코드가 같은 순회 규칙을 공유할 때 사용한다.

사용 패턴은 [SchemaAlgebra guide](../guides/schema-algebra.md)를 참조한다.
