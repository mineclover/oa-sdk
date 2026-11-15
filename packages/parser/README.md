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

## Output is a shared, read-only graph / 출력은 공유 그래프(DAG)

`parseDocument()`는 같은 `$ref` 대상을 한 번만 전개하고 그 결과 객체를 사용처마다 공유합니다.
예를 들어 두 operation의 응답이 모두 `#/components/schemas/User`를 가리키면 두 위치의 schema는
같은 객체입니다. 결과는 순환이 없는 DAG이므로 다음을 지킵니다.

- 반환된 문서와 하위 객체를 수정하지 않습니다. 고치면 같은 객체를 공유하는 다른 위치도 바뀝니다.
  입력 문서도 수정하지 않으며, 결과의 일부는 입력과 객체를 공유합니다.
- 재귀 순회의 방문 체크를 전역 `seen` 집합으로 하지 않습니다. 같은 객체가 형제 위치에 다시 나오면
  두 번째 위치를 건너뛰게 됩니다. 현재 경로의 조상 목록으로 순환만 막습니다.
- 재귀 스키마의 순환 지점은 기본적으로 `{}`가 되고, `cycleStrategy: 'preserve-ref'`이면 `$ref`로
  남습니다.

## Route index and matching / 라우트 인덱스와 매칭

- `parseDocument(spec).routes`와 `loadSchema(spec, passes?)`는 같은 route index 빌더를 씁니다.
  `loadSchema`는 `ParsedDocument`의 나머지(참조 완결성 정보 포함)를 만들지 않으므로, 미해결
  참조를 확인해야 하면 `parseDocument`를 씁니다. browser entry의 `loadSchema(spec)`는 pass 목록을
  받지 않고 `parseDocument(spec).routes`를 반환합니다(참조가 완결되지 않으면 예외).
- Reference Object 위치(parameter, requestBody, response, callback)의 `$ref` 옆 필드: 기본
  pipeline(deref pass)은 옆에 적은 필드를 모두 해소된 대상에 덮어씁니다. `$ref`를 해소하는 pass가
  없는 pipeline(예: `loadSchema(spec, [])`)은 OAS 3.2 규칙대로 `summary`·`description`만 적용합니다
  (parameter·requestBody는 `description`, response는 둘 다). 따라서 `$ref` 옆에 다른 필드를 적은
  문서는 pipeline에 따라 결과가 다를 수 있습니다.
- `matchRoute(index, method, path)`는 `found`, `method_not_allowed`, `not_found` 중 하나를
  반환합니다. 구체적인 경로(`/users/me`)가 템플릿 경로(`/users/{id}`)보다 우선하고, path parameter
  값은 percent-decoding 없이 받은 그대로 돌려줍니다.

## Zero-Decorator Route Extraction (@oaOperation)

TypeScript 소스 코드의 JSDoc 주석(`/** @oaOperation <METHOD> <PATH> */`)으로부터 런타임 데코레이터 없이 직접 OpenAPI 3.2 operation 메타데이터를 추출합니다:

```typescript
import { extractOperationsFromSource } from '@oa-sdk/parser'

const source = `
/**
 * @oaOperation GET /users/{id}
 * @summary Get user profile
 */
export function getUser(id: string) {}
`

const { operations, diagnostics } = extractOperationsFromSource(source)
console.log(operations[0]?.method) // 'get'
console.log(operations[0]?.path)   // '/users/{id}'
console.log(diagnostics.length)    // 0
```

`extractOperationsFromSource(sourceText, filePath?)`와 `extractOperationsFromFile(filePath)`는
`{ operations, operationEntries, diagnostics }`를 반환합니다. `operationEntries`는 route index와
같은 `OperationEntry` 형태입니다.

## API overview / API 목록

| 영역 | export |
|---|---|
| 파싱과 IR | `parseDocument`, `isParsedDocument`, `isParsedDocumentComplete`, `assertParsedDocumentComplete`, `IncompleteParsedDocumentError` |
| 라우팅 | `loadSchema`, `matchRoute`, `HTTP_METHODS` |
| 조회 | `findOperation`, `findByTag`, `findByPath`, `getSchema`, `getTag`, `groupByTag`, `describeApi`, `resolveServerUrl`, `getQuerystringParameter` |
| 검증과 린트 | `validateDocument`, `lintDocument` |
| `$ref` 전개와 그래프 | `DerefFolder`, `derefSpec`, `derefSpecWithDiagnostics`, `runPipeline`, `derefPass`, `createDerefPass`, `DEFAULT_PASSES`, `collectRefs`, `resolveRefGraph`, `projectRefGraph`, `resolvePointer`, `isRelativeRef` |
| 스키마 순회 | `foldSchema`, `SchemaFolder` |
| JSON Pointer와 원본 위치 | `appendJsonPointer`, `escapeJsonPointerToken`, `formatJsonPointer`, `parseJsonPointer`, `unescapeJsonPointerToken`, `createSourceLocationIndex`, `createYamlSourceLocationIndex` |
| `@oaOperation` 추출 | `extractOperationsFromSource`, `extractOperationsFromFile`, `toOperationEntry`, `buildPathPointer`, `SUPPORTED_HTTP_METHODS` |
| Definition Builder | `parseDefinitionId`, `validateDefinitionId(s)`, `createDefinitionNode`, `createDefinitionRef`, `createDefinitionRegistry`, `collectDefinitionRefs`, `allocateDefinitionOutputNames`, `selectDefinitionTarget`, `emitDefinitionOpenApiDocument`, `toDefinitionOpenApiProjectionResult` 등 |

정확한 목록과 시그니처는 package root와 `./browser` export의 TypeScript declaration을 따릅니다.

지원 symbol의 기준은 package root와 `./browser` export가 제공하는 TypeScript declaration이다.
공개 artifact에는 source repository의 문서·테스트·개발 이력이 포함되지 않는다.

