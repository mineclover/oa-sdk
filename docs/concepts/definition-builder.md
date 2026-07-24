# Definition Builder

Definition Builder는 OpenAPI document를 직접 편집하는 대신 canonical definition fragment를
선택하고 조립해 target-specific OpenAPI document를 만드는 흐름이다.

핵심 축은 다음과 같다.

- canonical id
- registry graph
- target selection
- output naming
- `$ref` rewrite
- collision report

## Builder Characteristics

- **Modular input**: schema, response, parameter, requestBody, path, operation,
  server, tag, securityScheme 같은 작은 definition fragment를 입력으로 받는다.
- **Schema collection**: OpenAPI/JSON Schema-compatible fragments and projections are
  collected as contract inputs before they are emitted as one OpenAPI artifact.
- **Parser-backed registry**: fragment content에서 `$ref`를 수집하고 canonical source
  ref 또는 relative file ref를 registry graph edge로 해석한다.
- **Target assembly**: target config가 scopes/domains/includePaths/includeDefinitions를
  기준으로 필요한 definition을 선택하고 transitive refs를 포함한다.
- **Path surface management**: selected path definitions define the emitted API surface,
  while transitive components are included through registry refs.
- **Source/output identity separation**: source canonical id는 유지하고, output component
  name은 target-local naming policy로 할당한다.
- **Duplicate prevention**: duplicate canonical id는 error다. 같은 structural hash는
  자동 병합하지 않고 diagnostic으로 남긴다.
- **Collision prevention**: output component name collision은 error이며, collision report로
  canonical id, target, output name, reason, severity를 남긴다.
- **OpenAPI artifact emission**: selected definitions are emitted as complete OpenAPI 3.2
  target artifacts, then consumed by validation, diff, typegen, client, router, and mock tools.

구현 상세와 현재 상태는 [기본 스펙 사용 기준](../guides/basic-spec-usage.md)과
[spec.md](../internal/spec.md#openapi-definition-builder-rollbackreference-implementation)와
[definition-builder-compatibility-gates.md](../internal/definition-builder-compatibility-gates.md)를
참조한다.
