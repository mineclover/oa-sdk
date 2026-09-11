# @oa-sdk/parser

`@oa-sdk/parser`는 이미 메모리에 올린 OpenAPI 3.2 document를 query, validation,
lint, dereference, downstream tooling용 `ParsedDocument` IR로 변환합니다. JSON/YAML
text를 직접 읽지는 않으므로 API를 호출하기 전에 object로 파싱하세요.

## Install / 설치

```bash
npm install @oa-sdk/parser
```

Node.js **22 이상** (`>=22.0.0`)이 필요합니다.

## Supported imports / 지원 import 경계

- `@oa-sdk/parser`는 Node용 root entry point입니다. Full parser, pipeline,
  definition API를 제공하며 `parseDocument()`에 Node-side `basePath`를 주면 external
  `$ref`를 해석할 수 있습니다.
- `@oa-sdk/parser/browser`는 browser에서 이미 로드된 document를 파싱합니다. In-memory/
  internal reference만 해석하며 external reference는 unresolved 상태로 남고 반환된
  document의 resolution metadata에 보고됩니다.

이 두 exported path만 지원합니다. `src/` 또는 `dist/` 파일을 deep import하지
마세요.

## Minimal ESM example / 최소 ESM 예제

```js
import { parseDocument } from '@oa-sdk/parser'

const parsed = parseDocument({
  openapi: '3.2.0',
  info: { title: 'Pets API', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
})

console.log(parsed.operations.map(({ method, openApiPath }) => `${method.toUpperCase()} ${openApiPath}`))
// [ 'GET /pets' ]
```

## Zero-Decorator Route Extraction (@oaOperation)

TypeScript 소스 코드의 JSDoc 주석(`/** @oaOperation <METHOD> <PATH> */`)으로부터 런타임 데코레이터 없이 직접 OpenAPI 3.2 operation 메타데이터를 추출합니다:

```typescript
import { extractTsOperationsFromSource } from '@oa-sdk/parser'

const source = `
/**
 * @oaOperation GET /users/{id}
 * @summary Get user profile
 */
export function getUser(id: string) {}
`

const operations = extractTsOperationsFromSource(source)
console.log(operations[0].method) // 'get'
console.log(operations[0].path)   // '/users/{id}'
```

지원 symbol의 기준은 package root와 `./browser` export가 제공하는 TypeScript declaration이다.
공개 artifact에는 private source repository의 문서·테스트·개발 이력이 포함되지 않는다.

