# Use Case: bun-graph-db projection 소비

> bun-graph-db가 내보내는 OpenAPI full document와 table projection을 OA SDK에서 안전하게 검증, 타입 생성, 클라이언트 생성, mock 테스트에 사용하는 워크플로우.

## 시나리오

공통 용어는 [Concepts](../../concepts.md)를 따른다.
행동 수집/조회 관점의 개념 정의는 [Behavior ECS](../../concepts/behavior-ecs.md)를 따른다.

bun-graph-db를 OpenAPI projection producer로 둔다. OA SDK는 producer에서 받은 artifact를 파일로 고정하고, 그 snapshot을 기준으로 `validate`, `typegen`, `client`, `mock-server`를 실행한다.
DB 가명처리 설계에서는 같은 projection snapshot을 [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)의
`catalog` 입력으로 사용할 수 있다. Projection은 table 구조와 freshness를 제공하고, DPM은
entity/relationship/column transform/vault/publishing 정책을 별도로 선언한다.

```txt
bun-graph-db
  -> GET /api/openapi                         # stable full document
  -> REST / GraphQL / MCP table projection    # runtime table contract
  -> saved OpenAPI snapshot + versionHash
  -> oa-gen validate / typegen / client
  -> @oa-sdk/mock-server contract tests
```

## Full document와 table projection 경계

`GET /api/openapi`는 bun-graph-db의 stable REST endpoint와 MCP JSON-RPC protocol endpoint를 설명하는 정적 full document다. 이 응답은 OpenAPI tooling이 바로 읽을 수 있도록 `{ success, data }` envelope 없이 raw OpenAPI JSON으로 반환된다.

Table schema는 full document에 inline하지 않는다. Table, attribute, attribute type은 런타임 데이터라서 서버 실행 중에도 바뀔 수 있다. table별 schema가 필요하면 별도 projection을 fetch하고, 그 projection의 `versionHash`를 같이 저장한다.

| Artifact | Profile | Use when |
|---|---|---|
| Static full document | `full-api-document` | Stable REST/MCP endpoint discovery, generic client/mock generation, protocol documentation |
| Table component bundle | `component-bundle` | One runtime table의 reusable `components.schemas`가 필요할 때 |
| Table operation contract | `operation-contract` | One runtime table의 create/update request contract와 operation paths가 필요할 때 |

Table projection export는 현재 `component-bundle`과 `operation-contract`만 지원한다. `full-api-document`는 table-scoped projection profile이 아니므로 요청하지 않는다.

## 1. Static full document fetch

```bash
mkdir -p contracts/bun-graph-db

curl -sS http://localhost:3000/api/openapi \
  -H 'accept: application/json' \
  -o contracts/bun-graph-db/openapi.json
```

이 파일은 raw OpenAPI document다. 바로 OA SDK CLI에 넣는다.

```bash
oa-gen validate --spec contracts/bun-graph-db/openapi.json
oa-gen typegen --spec contracts/bun-graph-db/openapi.json \
  -o src/generated/bun-graph-db-api.types.ts
```

공개 배포 경계는 validation과 typegen까지다. 이 모노레포의 private client/mock 통합은
아래처럼 package API로 검증한다. runtime table별 attribute schema는 table projection
snapshot에서 따로 소비한다.

이 흐름을 governance/audit까지 확장할 때는
[Behavior ECS Spec](../../internal/behavior-ecs.spec.md)의 representative use case와 baseline
test case를 같이 본다.

## 2. REST table projection fetch

REST table projection은 bun-graph-db 표준 REST envelope인 `{ success, data }`로 반환된다. OpenAPI artifact는 `data.projection`이고 freshness marker는 `data.versionHash`다.

```bash
mkdir -p contracts/bun-graph-db/tables/project_tasks

curl -sS \
  'http://localhost:3000/api/tables/project_tasks/openapi-projection?profile=component-bundle' \
  -H 'accept: application/json' \
  -o contracts/bun-graph-db/tables/project_tasks/component-bundle.response.json

jq '.data.projection' \
  contracts/bun-graph-db/tables/project_tasks/component-bundle.response.json \
  > contracts/bun-graph-db/tables/project_tasks/component-bundle.openapi.json

jq -r '.data.versionHash' \
  contracts/bun-graph-db/tables/project_tasks/component-bundle.response.json \
  > contracts/bun-graph-db/tables/project_tasks/component-bundle.versionHash
```

Create/update request contract가 필요하면 `operation-contract` profile을 fetch한다.

```bash
curl -sS \
  'http://localhost:3000/api/tables/project_tasks/openapi-projection?profile=operation-contract' \
  -H 'accept: application/json' \
  -o contracts/bun-graph-db/tables/project_tasks/operation-contract.response.json

jq '.data.projection' \
  contracts/bun-graph-db/tables/project_tasks/operation-contract.response.json \
  > contracts/bun-graph-db/tables/project_tasks/operation-contract.openapi.json

jq -r '.data.versionHash' \
  contracts/bun-graph-db/tables/project_tasks/operation-contract.response.json \
  > contracts/bun-graph-db/tables/project_tasks/operation-contract.versionHash
```

## 3. GraphQL table projection fetch

GraphQL은 같은 projection result를 JSON scalar로 반환한다. `tableId` 또는 `identifier` 중 하나를 전달한다.
Static full document는 selected GraphQL operation을 OpenAPI wrapper로 확장하지 않는다.
GraphQL은 projection fetch transport 중 하나로 사용하고, stable endpoint/client/mock 생성은
`GET /api/openapi` full document 또는 table projection snapshot을 기준으로 한다.

```graphql
query TableProjection($tableId: ID!, $profile: String!) {
  tableOpenApiProjection(tableId: $tableId, profile: $profile)
}
```

Variables:

```json
{
  "tableId": "project_tasks",
  "profile": "component-bundle"
}
```

Identifier 기반 조회도 가능하다.

```graphql
query TableOperationProjection($identifier: String!, $profile: String!) {
  tableOpenApiProjection(identifier: $identifier, profile: $profile)
}
```

Variables:

```json
{
  "identifier": "project_tasks",
  "profile": "operation-contract"
}
```

GraphQL 응답에서 `data.tableOpenApiProjection.projection`을 OpenAPI snapshot으로 저장하고, `data.tableOpenApiProjection.versionHash`를 같은 artifact 옆에 저장한다.

## 4. MCP table projection fetch

Table-scoped MCP endpoint는 `/sub/{tableId}/mcp`다. 먼저 `tools/list`로 현재 table server가 광고하는 tool 이름과 `inputSchema`를 확인한다.
현재 bun-graph-db MCP HTTP server는 single JSON-RPC request만 문서화하고 지원한다.
JSON-RPC batch request가 필요하면 서버 구현과 static OpenAPI document를 함께 확장해야 한다.

```bash
curl -sS http://localhost:3000/sub/project_tasks/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": "tools",
    "method": "tools/list",
    "params": {}
  }'
```

Projection export tool 이름은 `get-openapi-projection-{tableId}` 형식이다.

```bash
curl -sS http://localhost:3000/sub/project_tasks/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": "projection",
    "method": "tools/call",
    "params": {
      "name": "get-openapi-projection-project_tasks",
      "arguments": {
        "profile": "operation-contract"
      }
    }
  }'
```

MCP response의 `result.content[0].text`는 JSON 문자열이다. 파싱하면 다음 형태가 나온다.

```json
{
  "projection": {
    "profile": "operation-contract",
    "projection": {
      "openapi": "3.2.0",
      "paths": {},
      "components": {}
    },
    "versionHash": "...",
    "refs": [],
    "sources": {},
    "diagnostics": [],
    "typeTargets": []
  },
  "validation": {
    "valid": true,
    "diagnostics": []
  }
}
```

MCP에서 받은 projection도 다른 transport와 같은 규칙으로 저장한다. `projection.projection`은 OpenAPI artifact이고, `projection.versionHash`는 freshness marker다. `validation.valid`가 `false`이거나 `result.isError`가 `true`면 generated artifact로 사용하지 않는다.

## 5. OA SDK 소비 규칙

### validate

OpenAPI artifact 자체는 `oa-gen validate --spec`로 검증한다.

```bash
oa-gen validate --spec contracts/bun-graph-db/openapi.json
oa-gen validate --spec contracts/bun-graph-db/tables/project_tasks/operation-contract.openapi.json
```

Projection envelope 전체를 검증해야 하면 `@oa-sdk/openapi-projection-contract`의 `validateOpenApiProjection()`을 사용한다. REST envelope의 경우 `response.data`, GraphQL의 경우 `data.tableOpenApiProjection`, MCP의 경우 parsed `projection` 값을 넘긴다.

```typescript
import { validateOpenApiProjection } from '@oa-sdk/openapi-projection-contract'

const result = validateOpenApiProjection(tableProjectionEnvelope)
if (!result.valid) {
  throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'))
}
```

### typegen

Stable API 타입은 full document에서 생성한다.

```bash
oa-gen typegen --spec contracts/bun-graph-db/openapi.json \
  -o src/generated/bun-graph-db-api.types.ts
```

Table-specific request 타입은 저장된 table projection snapshot에서 생성한다. Operation paths가 필요한 타입 묶음은 `operation-contract`를 우선 사용한다.

```bash
oa-gen typegen --spec contracts/bun-graph-db/tables/project_tasks/operation-contract.openapi.json \
  -o src/generated/project-tasks.types.ts
```

`component-bundle`은 reusable schema alias가 목적이다. Client나 mock처럼 operation이 필요한 도구에는 `operation-contract`를 사용한다.

### client

`@oa-sdk/client`는 private workspace integration이다. Full document client는 stable
bun-graph-db REST/MCP discovery surface에 맞추되 공개 `oa-gen` 명령으로 광고하지 않는다.

```typescript
import { readFileSync, writeFileSync } from 'node:fs'
import { generateClient } from '@oa-sdk/client'
import type { OasDocument } from '@oa-sdk/parser'

const fullDocument = JSON.parse(
  readFileSync('contracts/bun-graph-db/openapi.json', 'utf8'),
) as OasDocument

writeFileSync(
  'src/generated/bun-graph-db-api.client.ts',
  generateClient(fullDocument, { typesImport: './bun-graph-db-api.types' }),
)
```

Table projection client는 projection snapshot의 `versionHash`와 함께 관리한다. table attribute가 바뀌면 같은 파일을 재사용하지 말고 projection을 다시 fetch한 뒤 typegen/client를 다시 실행한다.

```typescript
const tableDocument = JSON.parse(
  readFileSync(
    'contracts/bun-graph-db/tables/project_tasks/operation-contract.openapi.json',
    'utf8',
  ),
) as OasDocument

writeFileSync(
  'src/generated/project-tasks.client.ts',
  generateClient(tableDocument, { typesImport: './project-tasks.types' }),
)
```

### mock-server

Mock server는 operation이 있는 OpenAPI document를 입력으로 받는다. Stable API mock은 full document를 사용한다.

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient } from '@oa-sdk/mock-server'
import spec from './contracts/bun-graph-db/openapi.json'

const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)
```

Table-specific create/update payload test는 `operation-contract` snapshot을 fixture로 사용한다.

```typescript
import projectionSpec from './contracts/bun-graph-db/tables/project_tasks/operation-contract.openapi.json'

const server = createNodeMockServer(projectionSpec, { port: 0 })
await server.start()
```

`component-bundle`은 operation path가 없으므로 mock-server용 endpoint fixture가 아니다. schema-only 검증이나 custom validator 입력으로 사용한다.

## versionHash freshness 체크

Table runtime schema를 소비하는 generated artifact는 항상 `{ tableId 또는 identifier, profile, versionHash }` tuple로 추적한다.

```json
{
  "producer": "bun-graph-db",
  "tableIdentifier": "project_tasks",
  "profile": "operation-contract",
  "versionHash": "sha256:..."
}
```

운영 규칙:

- table, attribute, attribute type 변경 후에는 projection을 다시 fetch한다.
- 저장된 `versionHash`와 새 `versionHash`가 다르면 typegen, client, mock fixture를 다시 생성한다.
- `versionHash`가 다른 projection으로 생성된 타입과 mock fixture를 섞지 않는다.
- static full document의 버전과 table projection `versionHash`를 같은 freshness marker로 취급하지 않는다.
- CI에서는 projection snapshot 파일과 `.versionHash` 파일을 함께 diff로 리뷰한다.

## Related

→ [코드젠 워크플로](./codegen-workflow.md)  
→ [CLI 세팅](../cli-setup.md)  
→ [OpenAPI Projection Contract](../../../packages/openapi-projection-contract/README.md)  
→ [Data Pseudonymization Manifest](../../concepts/data-pseudonymization-manifest.md)\
→ [Shared SchemaEngine vocabulary](../../internal/architecture/007-shared-schema-engine-vocabulary.md)  
→ [bun-graph-db full document scope](https://github.com/mineclover/bun-graph-db/blob/main/docs/development/FULL_OPENAPI_DOCUMENT_SCOPE.md)
