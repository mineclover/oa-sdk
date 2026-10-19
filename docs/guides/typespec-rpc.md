# TypeSpec 계약을 RPC로 쓰기

TypeSpec으로 선언한 operation을 REST route 단위가 아니라 **procedure 호출**로 쓰는 방법을 정리한다.
같은 계약에서 두 경로를 고를 수 있다.

| | JSON procedure RPC | 바이너리 wire RPC |
| --- | --- | --- |
| 생성 | `pluginRpc()` (`@oa-sdk/codegen`) | `pluginWire({ codecs: ['protobuf', 'rpc-contract'] })` |
| 런타임 | `@oa-sdk/rpc` (서버·클라이언트·transport) | 생성된 module 안의 client class |
| 호출 모양 | `client.users.getUserById({ id })` | `orders.getOrder({ orderId })` |
| 전송 | JSON-RPC 2.0 단일 endpoint, 또는 원래 REST route | 원래 REST route |
| payload | JSON | 선언된 media type: JSON, Protobuf, MessagePack |
| 서버 | `createRpcServer` + fetch handler (REST·JSON-RPC 동시 제공) | `<Service>ServerHandlers` 인터페이스만 생성 |
| 쓰는 때 | 한 handler 집합을 REST와 RPC로 함께 열고 싶을 때, 메시지 채널(WebSocket, data channel) 위 호출 | payload 크기가 중요하고 계약이 `application/x-protobuf` 등을 선언할 때, 다른 언어와 `.proto`를 공유할 때 |

구현 현황과 검증 범위는 [Spec](../internal/spec.md#typespec-계약-rpc와-바이너리-wire-)에, export 목록은
[API index](../internal/api-index.md)에 둔다. `@oa-sdk/rpc`는 저장소 전용(private) 패키지다
([scope decision](../internal/platform-scope.md#typespec-contract-rpc-runtime--2026-10-12)).

---

## 1. TypeSpec 작성

평범한 HTTP operation이면 충분하다. procedure 이름만 바꾸고 싶으면 `@rpc`를 붙인다.

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

@service(#{ title: "Todo Service" })
namespace Todos;

model Todo {
  id: int32;
  title: string;
  done: boolean;
}

model NotFound {
  @statusCode statusCode: 404;
  code: string;
  message: string;
}

@tag("Todo Items")
@route("/todos")
interface TodoItems {
  @get list(@query done?: boolean, @query limit?: int32): Todo[];

  @get get(@path id: int32): Todo | NotFound;

  @post
  @rpc(#{ serviceName: "TodoService", methodName: "Create" })
  create(@body todo: { title: string }): { @statusCode statusCode: 201; @body todo: Todo };
}
```

procedure 이름은 `[group, method].join('.')`이다.

| 부분 | 결정 순서 |
| --- | --- |
| group | `@rpc(#{ serviceName })` → 첫 tag의 camelCase (`"Todo Items"` → `todoItems`) → 없음(최상위) |
| method | `@rpc(#{ methodName })` → operationId (TypeSpec interface operation은 `TodoItems_list` 형태) |

위 예시는 `todoItems.TodoItems_list`, `todoItems.TodoItems_get`, `TodoService.Create`가 된다. operationId가
길면 TypeSpec `@operationId("list")`나 `@rpc(#{ methodName: "list" })`로 다듬는다.

`@rpc`와 `@wireFormat`은 interface에도 붙일 수 있다. interface의 `serviceName`·`streaming`과 wire format은
그 interface의 모든 operation에 들어가고, operation에 직접 붙인 값이 이긴다. `methodName`은 operation 하나의
이름이라 interface에 쓰면 `invalid-rpc-rule` 오류다. `@protobuf`는 model 전용이며 interface에 붙이면
`invalid-protobuf-rule` 오류다.

```typespec
@route("/widgets")
@rpc(#{ serviceName: "WidgetService" })
@wireFormat("protobuf")
interface Widgets {
  @get list(): Widget[];                                  // WidgetService, protobuf
  @get @route("/{id}") @rpc(#{ methodName: "Read" })
  read(@path id: string): Widget;                         // WidgetService.Read, protobuf
}
```

---

## 2. JSON procedure RPC

### 2.1 계약과 타입 생성

```ts
// tsp.config.ts
import { defineTspConfig, pluginRpc } from '@oa-sdk/codegen'

export default defineTspConfig({
  input: 'typespec/main.tsp',
  outputDir: 'src/generated',
  plugins: [pluginRpc({ name: 'todo', output: 'rpc.ts' })],
})
```

`rpc.ts`에는 두 export가 생긴다.

- `TodoProcedures`: procedure 이름별 `{ input; output }` 타입
- `todoContract`: 런타임이 쓰는 계약 데이터 (`RpcContract`, JSON)

플러그인 없이 코드에서 직접 만들 수도 있다.

```ts
import { parseDocument } from '@oa-sdk/parser'
import { buildRpcContract } from '@oa-sdk/surface-ir'
import { generateRpcModule } from '@oa-sdk/codegen'

const contract = buildRpcContract(parseDocument(openapi), {
  operationOverrides: { getUserById: { groupPath: ['users'], methodName: 'get' } },
})
for (const d of contract.diagnostics) console.warn(d.severity, d.code, d.message)
const source = generateRpcModule(contract, { name: 'api' })
```

### 2.2 입력이 만들어지는 규칙

procedure 하나의 입력은 **object 하나**다. path·query·header·cookie 파라미터가 이름 그대로 필드가 되고,
request body는 둘 중 하나로 들어간다.

| body | 입력 | 예 |
| --- | --- | --- |
| 평범한 object schema (`allOf`로 합친 object 포함), 파라미터 이름과 겹치지 않음, required이거나 required 속성이 없음 | 속성을 펼친다 (`spread`) | `updateUser({ id, name, role })` |
| 그 밖 (배열, union, 이름 충돌, optional body인데 required 속성이 있음) | `body` 필드 (`bodyField`로 이름 변경) | `replacePhotos({ petId, body: ['a.png'] })` |

`bodyMode: 'field'`면 항상 `body` 필드를 쓴다. OpenAPI 규칙대로 `Accept`, `Content-Type`,
`Authorization` header 파라미터는 무시한다.

출력은 가장 낮은 2xx 응답의 schema다. 내용 없는 2xx(예: 204)는 `void`가 된다. 나머지 응답은
`errors`에 status별로 기록된다.

계약에서 빠지는 operation과 진단:

| 코드 | 수준 | 상황 |
| --- | --- | --- |
| `rpc-contract/streaming-not-supported` | warning | SSE·NDJSON 응답 또는 `@rpc(#{ streaming })`이 `none`이 아님. 제외됨 |
| `rpc-contract/no-success-response` | warning | 2xx가 없음. 출력이 `{}` |
| `rpc-contract/field-collision` | error | 두 파라미터(또는 파라미터와 body 필드)가 같은 입력 필드. 제외됨 |
| `rpc-contract/invalid-procedure-name` | error | 이름 조각이 비었거나 `.` 포함. 제외됨 |
| `rpc-contract/namespace-conflict` | error | procedure 이름이 다른 procedure의 group과 같음. 제외됨 |

### 2.3 서버

handler는 procedure 이름대로 중첩한다. 같은 handler가 JSON-RPC와 원래 REST route를 함께 받는다.

```ts
import { createJsonRpcFetchHandler, createRestFetchHandler, createRpcServer, RpcError } from '@oa-sdk/rpc'
import { createAjvValidator } from '@oa-sdk/rpc/ajv'
import { todoContract, type TodoProcedures } from './generated/rpc.js'

type Context = { userId: string }

const server = createRpcServer<TodoProcedures, Context>(todoContract, {
  todoItems: {
    TodoItems_list: ({ done, limit }) => db.todos.list({ done, limit }),
    TodoItems_get: async ({ id }) => {
      const todo = await db.todos.find(id)
      if (!todo) throw new RpcError('NOT_FOUND', 'Todo not found', { data: { code: 'NOT_FOUND', message: `todo ${id}` } })
      return todo
    },
  },
  TodoService: {
    Create: ({ title }, { context }) => db.todos.create({ title, owner: context.userId }),
  },
}, { validator: createAjvValidator() })

const createContext = (request: Request): Context => ({ userId: request.headers.get('x-user-id') ?? 'anonymous' })
const rpc = createJsonRpcFetchHandler(server, { path: '/rpc', createContext })
const rest = createRestFetchHandler(server, { basePath: '/v1', createContext })

export default {
  async fetch(request: Request) {
    return (await rpc(request)) ?? (await rest(request)) ?? new Response('Not found', { status: 404 })
  },
}
```

- handler가 하나라도 없으면 `createRpcServer`가 throw한다. 일부만 열려면 `allowPartial: true` (없는 procedure는 `NOT_IMPLEMENTED`, 501).
- `validator`가 있으면 입력을 검증하고(`INVALID_INPUT`, 400), `validateOutput: true`면 결과도 검증한다(`INVALID_OUTPUT`, 500).
- `RpcError`가 아닌 예외는 호출자에게 `INTERNAL`, 메시지 `Internal server error`로만 보인다. 원래 예외는 `onError`로 받는다.
- 두 fetch handler는 자기 요청이 아니면 `undefined`를 돌려주므로 위처럼 이어 붙인다. REST handler는 알려진 path에 다른 method가 오면 `Allow` header와 함께 405를 돌려준다.
- WebSocket·WebRTC data channel·`postMessage` 같은 메시지 채널에서는 `handleJsonRpc(server, message, { context })`를 직접 호출한다. batch와 notification을 처리하고, notification만 왔으면 `undefined`를 돌려준다.

REST handler는 OpenAPI `style`/`explode` 규칙대로 파라미터를 되돌리고(`simple`, `label`, `matrix`,
`form`, `spaceDelimited`, `pipeDelimited`, `deepObject`, `content` 파라미터), schema에 맞춰 숫자·불리언으로
바꾼다. body는 JSON, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/*`, 바이너리를 읽는다.
body의 키가 선언된 파라미터를 덮어쓰지 않으며, `__proto__` 같은 키도 일반 데이터로만 들어간다.

### 2.4 클라이언트

```ts
import { createHttpTransport, createJsonRpcTransport, createRpcClient } from '@oa-sdk/rpc'
import { todoContract, type TodoProcedures } from './generated/rpc.js'

// 원래 REST route로 호출: GET /v1/todos?done=true&limit=10
const rest = createRpcClient<TodoProcedures>(todoContract, createHttpTransport({
  baseUrl: 'https://api.example.com/v1',
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
}))
await rest.todoItems.TodoItems_list({ done: true, limit: 10 })

// JSON-RPC 2.0: POST /rpc {"jsonrpc":"2.0","method":"TodoService.Create",...}
const rpc = createRpcClient<TodoProcedures>(todoContract, createJsonRpcTransport({ url: 'https://api.example.com/rpc' }))
await rpc.TodoService.Create({ title: 'write docs' }, { signal })
```

| transport | 용도 |
| --- | --- |
| `createHttpTransport({ baseUrl, fetch?, headers? })` | 계약의 REST route로 호출. 서버가 RPC endpoint를 열지 않아도 된다 |
| `createJsonRpcTransport({ url, fetch?, headers? })` | JSON-RPC 2.0 endpoint로 호출 |
| `createLocalTransport(server, { context })` | 같은 프로세스의 서버를 직접 호출 (테스트). 입출력은 `structuredClone`된다 |
| 직접 구현 | `(request: { procedure, input, signal?, headers? }) => Promise<output>` |

이름으로 호출하려면 `createRpcCaller<P>(contract, transport).call('TodoService.Create', input)`.
`createRpcClient`에 `validator`를 주면 잘못된 입력은 transport를 타기 전에 거부된다.

### 2.5 오류

실패는 `RpcError`(`code`, `status`, `data`)로 reject된다. 예외는 `signal`로 취소한 호출이다. 이 호출은 중단된
`fetch`의 오류, 즉 signal의 reason(기본값은 `AbortError`)으로 reject되며, 응답 body를 읽는 중에 취소해도 같다.

| 출처 | `code` | `status` | `data` |
| --- | --- | --- | --- |
| handler가 던진 `new RpcError(code, message, { status?, data? })` | 그대로 | 지정값 또는 code 기본값 | 그대로 (REST에서는 응답 body) |
| 입력 검증 실패 | `INVALID_INPUT` | 400 | `{ code, message, issues: [{ path, message }] }` |
| 없는 procedure | `PROCEDURE_NOT_FOUND` | 404 | — |
| REST 응답이 2xx가 아님 | body의 문자열 `code`, 없으면 status에서 (`NOT_FOUND`, `CONFLICT`, … 또는 `HTTP_<status>`) | 응답 status | 응답 body |
| 네트워크 실패, 읽을 수 없는 응답, JSON-RPC가 아닌 응답 (다른 요청 id에 답한 응답 포함) | `TRANSPORT` | 네트워크 실패는 502, 응답을 받았지만 읽을 수 없거나 JSON-RPC가 아니면 그 HTTP 응답 status | — |

JSON-RPC에서는 protocol 오류가 표준 코드(`-32700`, `-32600`, `-32601`, `-32602`, `-32603`)를 쓰고,
application 오류는 `-32000`에 `error.data = { code, status, data }`를 담아 클라이언트가 같은 `RpcError`를
복원한다. `createContext`가 던진 오류도 같은 방식으로 돌아간다.

---

## 3. 바이너리 wire RPC

계약이 `application/x-protobuf`나 `application/msgpack` body를 선언하면 `pluginWire`로 codec과
클라이언트를 만든다.

```ts
import { defineTspConfig, pluginTypescript, pluginWire } from '@oa-sdk/codegen'

export default defineTspConfig({
  input: 'typespec/main.tsp',
  outputDir: 'src/generated',
  plugins: [
    pluginTypescript(),
    pluginWire({ output: 'wire.ts', codecs: ['protobuf', 'rpc-contract', 'proto3'], proto3Output: 'schema.proto' }),
  ],
})
```

```ts
import { getGeneratedProtobufCodecs, OrderServiceRpcClient, WireRpcError } from './generated/wire.js'

const orders = new OrderServiceRpcClient({
  baseUrl: 'https://api.example.com',
  codecs: getGeneratedProtobufCodecs(), // model 이름 → codec. 여러 map을 배열로 넘겨도 된다
})

// body가 있으면 (request, params, options), 없으면 (params, options)
const order = await orders.getOrder({ orderId: 'o-1', expand: ['items'] })
await orders.createOrder({ id: 'draft', amount: 7 })
```

- 서비스·메서드 이름은 `@rpc(#{ serviceName, methodName })`, 없으면 첫 tag + `Service`와 operationId의 PascalCase다.
  PascalCase는 `_`·`-`·공백을 지우고 그 다음 글자를 대문자로 만든다: `TodoItems_list` → `TodoItemsList`
  (클라이언트 메서드 `todoItemsList()`), `"Todo Items"` → `TodoItemsService`. tag도 없으면 `@service` title을
  package 이름으로 바꾼 것의 PascalCase + `Service`다 (`"Todo Service"` → `todo_service` → `TodoServiceService`).
- 생성된 TypeScript는 `types.ts`와 같은 타입 이름을 쓴다. 하위 namespace의 `Inventory.Widget`는 `InventoryWidget`이고,
  정리한 이름이 겹치면 `types.ts`처럼 숫자를 붙인다. `getGeneratedProtobufCodecs()` 같은 codec map의 key는
  component 이름(`'Inventory.Widget'`) 그대로다.
- 클라이언트는 선언된 route를 path·query·header·cookie 파라미터로 채운다. path-level 파라미터와 선언되지 않은 route 변수도 포함한다.
  빈 path 값(`''`, 빈 배열)과 `.`·`..`은 다른 route를 호출하게 되므로 요청을 보내기 전에 `TypeError`로 거부한다.
- body와 응답은 선언된 media type을 따른다. JSON은 그대로 직렬화하고, Protobuf·MessagePack 메시지는 model 이름으로 찾은 codec으로 인코딩·디코딩한다. 요청 메시지의 codec이 없으면 요청을 보내지 않고 실패하고, 응답 메시지의 codec이 없으면 `TypeError`로 reject된다.
- 2xx가 아닌 응답은 `WireRpcError`(`method`, `status`, 디코딩한 `body`)로 reject된다.
- 서버 쪽은 `<Service>ServerHandlers<TContext>` 인터페이스만 생성한다. handler는 `(request, context, params)`를 받으며 파라미터가 없는 메서드에는 `params`가 없다. HTTP mount와 codec 적용은 서버 코드가 맡는다.

### 3.1 Protobuf 매핑

생성된 codec과 `schema.proto`는 같은 wire format이다. 다른 언어의 Protobuf 구현이 `schema.proto`로 같은
bytes를 읽고 쓸 수 있으며, protobufjs와 양방향으로 검증한다.

| JSON Schema | Protobuf | TypeScript 값 |
| --- | --- | --- |
| `string` | `string` | `string` |
| `string` + `format: binary` | `bytes` | `Uint8Array` |
| `string` + `format: byte` | `bytes` | base64 `string` (wire에는 원래 bytes) |
| `integer` + `int8`/`int16`/`int32` | `int32` | `number` |
| `integer` + `uint8`/`uint16`/`uint32` | `uint32` | `number` |
| `integer` (format 없음) / `int64` | `int64` | `number`, 안전 범위 밖이면 `bigint` |
| `integer` + `uint64` | `uint64` | `number` 또는 `bigint` |
| `number` + `float`/`float32` | `float` | `number` (32-bit 정밀도) |
| `number` | `double` | `number` |
| `boolean` | `bool` | `boolean` |
| component enum | `enum` (값 순서가 member 번호) | 원래 JSON 값 |
| component object | 중첩 `message` | object |
| `allOf`로 합친 component object (TypeSpec `extends`) | 상속 field를 앞에 둔 하나의 `message` | object |
| 배열 | `repeated` (숫자·enum은 packed) | 배열 |
| `additionalProperties`만 있는 object, inline이든 component 참조든 (`Record<string>` 등) | `map<string, V>` | `Record<string, V>` |
| union, 이름 없는 object, free-form object (`Record<unknown>`), `oneOf`·`anyOf`·`not`이 있는 object, 중첩 배열 등 | `string` (JSON 텍스트) | 원래 값 |

`x-oa-sdk-protobuf-field`(TypeSpec `@field(n, #{ type })`)로 field 번호와 `sint32`·`sint64`·`fixed32`·
`fixed64`·`sfixed32`·`sfixed64` 같은 scalar를 지정할 수 있다. 번호를 지정하지 않은 field는 지정된 번호와
예약 범위 19000–19999를 피해 선언 순서대로 받는다. 상속한 field가 먼저 오므로 base model에 field를 더하면
파생 model의 자동 번호가 밀린다. 상속 관계에서는 번호를 지정해 둔다. **배포된 schema에서는 field 번호를
바꾸지 않는다.** 새 field는 끝에 추가하고, 지운 번호는 다시 쓰지 않는다.

한 model 안에서 (상속한 field 포함) 같은 번호를 두 번 쓰면 TypeSpec 컴파일이 `invalid-protobuf-rule`로 실패한다.
상속한 property를 파생 model이 다시 선언하면 (literal로 좁힌 discriminator 등) 그 선언이 상속한 field를 대신하므로,
같은 번호를 다시 써도 되고 다른 번호를 쓰면 원래 번호는 비게 된다.
decorator를 거치지 않은 OpenAPI 입력에서는 `extractWireSchemaFromOas`가 같은 번호나 범위를 벗어난 번호에서 throw한다.

map-only·free-form object component는 `.proto` message도 Protobuf codec도 없다. TypeScript 타입과 MessagePack
codec은 그대로 생긴다. body나 응답이 없거나, 이런 component나 enum·scalar를 body나 응답으로 쓰는 메서드는
`schema.proto`에서 빈 message를 쓴다. 빈 message의 이름은 `Empty`이고, 이미 그 이름을 쓰는 model·enum·service가
있으면 (`model Empty {}` 등) `Empty2`, `Empty3`, … 중 처음 비는 이름이다. 사용자 `Empty` model은 자기 이름(또는
`messageName`)과 field를 그대로 쓴다. 추출한 wire model의 `WireMethod.inputType`·`outputType`도 빈 message를 이 이름으로
가리킨다.

이런 body를 Protobuf media type으로 보낼 때, map-only·free-form object body와 문자열이 아닌 enum·scalar body는
인코딩할 codec이 없으므로 클라이언트가 요청을 보내기 전에 실패한다. 문자열 enum·scalar body는 그 텍스트가 그대로
body로 간다.

범위를 벗어난 정수, 정수가 아닌 값, enum에 없는 값은 인코딩할 때 throw한다. 알 수 없는 field는 건너뛰고,
잘린 입력은 `RangeError`로 실패한다.

### 3.2 Protobuf가 구분하지 못하는 값

- 명시적 `null`과 field 없음은 같은 bytes가 된다. optional field는 디코딩하면 없다.
- 표준 proto3 encoder(Go, Java, protobuf-es 등)는 기본값(`0`, `''`, `false`, 빈 bytes, 첫 enum 값)인 scalar·enum을
  보내지 않는다. required scalar·enum field는 디코딩할 때 이 기본값으로 채운다. 그래서 required이면서 nullable인
  scalar를 `null`로 보내면 기본값으로 돌아온다.
- optional 빈 배열·map은 없음으로 돌아온다. required 배열·map은 빈 값으로 돌아온다.
- `float`는 32-bit로 반올림된다.

### 3.3 크기

production 계약(`packages/schemas`)의 schema 예시 기준이다.

| payload | JSON | Protobuf | 비율 |
| --- | ---: | ---: | ---: |
| `TokenPair` | 109 B | 50 B | 0.46 |
| `ReadinessReport` (중첩 배열) | 108 B | 49 B | 0.45 |
| `WorldHead` (중첩 message) | 340 B | 166 B | 0.49 |
| `User` | 141 B | 96 B | 0.68 |
| `User` 100개 | 14,548 B | 10,047 B | 0.69 |
| `User` 100개, gzip 후 | 975 B | 902 B | 0.93 |

HTTP 압축(gzip)을 함께 쓰면 큰 payload에서는 차이가 작아진다. 이득은 압축하지 않는 채널, 작은 메시지,
디코딩 비용에서 크다. MessagePack codec은 schema를 쓰지 않는 범용 인코더라 JSON의 85% 안팎이다.

---

## 4. 한계

- unary 호출만 다룬다. streaming operation은 JSON 계약에서 제외되고, 바이너리 클라이언트도 streaming을 구현하지 않는다.
- `@oa-sdk/rpc` 클라이언트는 JSON-RPC batch를 보내지 않는다. 서버는 다른 클라이언트의 batch를 처리한다.
- 인증, rate limit, CORS는 fetch handler를 감싸는 코드가 맡는다.
- 바이너리 wire 서버 runtime(라우팅·codec 적용)은 생성하지 않는다.
