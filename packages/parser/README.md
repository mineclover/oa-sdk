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
  `$ref`를 해석할 수 있습니다. 순환 `$ref` 판정은 (문서, JSON Pointer) 단위입니다.
  외부 파일 안의 `#/...`는 그 파일의 대상이고, 외부 파일이 `basePath` 파일을 다시
  참조하면 진입 문서로 돌아온 순환으로 봅니다. `cycleStrategy: 'preserve-ref'`가
  남기는 유효한 재귀 지점 `$ref`(및 `recursiveRefs`)는 결과 문서 기준으로 표기합니다:
  진입 문서 대상은 `#/...`, 다른 파일 대상은 `basePath` 디렉터리 기준 상대 경로
  (`./sub/tree.yaml#/...`)입니다. 진단된 순환(`ref-cycle`)과 다른 미해결 ref는 작성된
  표기를 그대로 두며, 진단의 `sourceFilePath`가 그 표기를 해석할 파일입니다.
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

## JSON Pointer helpers / JSON Pointer 헬퍼 (RFC 6901)

두 entry point 모두 RFC 6901 reference token 처리 헬퍼를 export합니다. `~0` / `~1`
escape를 직접 구현하지 말고 이 헬퍼를 쓰세요.

```js
import { appendJsonPointer, formatJsonPointer, parseJsonPointer, unescapeJsonPointerToken } from '@oa-sdk/parser'

formatJsonPointer(['paths', '/pets/{id}', 'get']) // '/paths/~1pets~1{id}/get'
formatJsonPointer([])                             // '' (root pointer)
appendJsonPointer('#/components/schemas', 'a/b')  // '#/components/schemas/a~1b'
parseJsonPointer('/paths/~1pets~1{id}/get')       // ['paths', '/pets/{id}', 'get']
parseJsonPointer('/a~2')                          // undefined (malformed escape)
unescapeJsonPointerToken('~01')                   // '~1' (never '/')
```

- `escapeJsonPointerToken` / `unescapeJsonPointerToken`은 token 하나를 변환합니다.
  unescape는 잘못된 `~` 시퀀스를 그대로 둡니다. 검증이 필요하면 `parseJsonPointer`를
  쓰세요.
- URI fragment로 쓸 때는 결과 앞에 `#`를 붙입니다. 헬퍼는 percent-encoding을 하지
  않습니다.

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

