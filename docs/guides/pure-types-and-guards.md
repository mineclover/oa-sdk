# 순수 타입과 독립형 타입 가드 가이드 (Non-HTTP Data Models & Standalone Type Guards)

> **핵심**: REST 엔드포인트(`paths`) 없이 데이터 모델만 선언해도 `oa-sdk`로 TypeScript 타입과 런타임 타입 가드를 같은 원본에서 만들 수 있습니다.

HTTP 전송 계층이 없는 곳(브라우저 확장 프로그램 MV3 메시징, Node Worker IPC, WebSocket 이벤트, DB DTO, 도메인 엔터티)에서 모델을 선언하고, `oa-gen typegen`으로 타입을, `oa-gen generate:guards`로 외부 의존성 없는 타입 가드를 만드는 방법을 다룹니다. 이 문서는 `@oa-sdk/codegen` 0.9.0 기준입니다. 두 명령은 `@oa-sdk/codegen`만 있으면 동작하고 동반 패키지가 필요 없습니다.

```bash
npm install --save-dev @oa-sdk/codegen
```

---

## 1. 손으로 쓴 타입과 무엇이 다른가

| 과제 | 손으로 쓴 TypeScript 인터페이스 | `oa-sdk` 순수 타입 파이프라인 |
|---|---|---|
| 런타임 검증 | 인터페이스는 컴파일 후 사라지므로 Zod 같은 검증 스키마를 따로 작성하고 맞춰야 합니다. | 같은 원본에서 타입(`typegen`)과 타입 가드(`generate:guards`)를 생성합니다. |
| 보안 정책(Chrome MV3 CSP) | 런타임에 검증 코드를 컴파일하는 라이브러리(`ajv` 런타임 등)는 `eval()`/`new Function()`을 써서 CSP에 걸립니다. | `generate:guards`는 Ajv standalone으로 미리 컴파일한 검증 코드를 씁니다. `eval()`과 `new Function()`을 쓰지 않으며, `oa-gen audit:csp`로 확인할 수 있습니다. |
| 번들 의존성 | 검증 라이브러리 런타임이 번들에 들어갑니다. | 생성된 가드는 아무 패키지도 import하지 않습니다. 코드 크기는 스키마 수와 복잡도에 비례합니다. |
| 검증 처리량 | 라이브러리에 따라 다릅니다. | 저장소 벤치마크(Node 24, Apple Silicon)에서 standalone 가드는 데이터 형태에 따라 초당 약 197만~2,515만 회, Zod 4.4 `safeParse`는 약 2.9만~217만 회였습니다([검증 엔진 벤치마크](../benchmarks/validation-engines.md)). |
| 다른 도구와 공유 | TypeScript 안에서만 쓸 수 있습니다. | 원본이 OpenAPI `components.schemas`(JSON Schema 2020-12)로 투영되므로 다른 언어·문서 도구도 같은 정의를 읽습니다. |

---

## 2. 모델 선언하기

HTTP operation(`@route`, `op`, `paths`) 없이 모델만 선언하는 세 가지 방법이 있습니다.

### 방식 A: TypeSpec (`.tsp`)

`typegen`과 `generate:guards`는 `.tsp` 파일을 직접 받아 `@oa-sdk/codegen`에 들어 있는 TypeSpec 컴파일러로 메모리에서 컴파일합니다. namespace에 `@service`가 없으면 OpenAPI 문서가 만들어지지 않아 빈 결과가 나오므로(종료 코드는 0), 모델만 담은 파일에도 `@service`를 붙입니다.

```typespec
// models/events.tsp
@service(#{ title: "Studio Messaging" })
namespace Studio.Messaging;

@doc("사용자 에디터 활동 이벤트 페이로드")
model EditorActivityEvent {
  @doc("이벤트 고유 식별자 (UUID v4)")
  @format("uuid")
  eventId: string;

  @doc("작업 대상 문서 ID")
  documentId: string;

  @doc("수행된 액션 종류")
  action: "insert" | "delete" | "format" | "undo" | "redo";

  @doc("작업 발생 시각 (UTC)")
  timestamp: utcDateTime;

  @doc("변경된 문자열 범위")
  range?: TextRange;

  @doc("확장 메타데이터")
  metadata?: Record<string>;
}

@doc("텍스트 오프셋 범위")
model TextRange {
  @minValue(0)
  start: int32;

  @minValue(0)
  end: int32;
}
```

> 💡 **심화 모델링**: 다형성 모델(`@discriminator`), 수명주기별 필드(`@visibility(Lifecycle.Read)`), 도메인 scalar 등은 [TypeSpec 데코레이터 레퍼런스](./typespec/03-decorators-reference.md)와 [비디오 트랜지션 파라미터 다양화 표준](./schema-architecture-and-conventions.md#61-비디오-트랜지션-파라미터-다양화-및-다형성-스키마-모델링-video-transition-parameter-diversification-standard)을 참고합니다.

### 방식 B: Zod 스키마 모듈

`typegen`과 `generate:guards`는 Zod를 직접 읽지 않습니다. Zod 스키마를 export하는 모듈을 `oa.config.ts`의 spec target 원본(`schemaEntry`)으로 지정하고 `oa-gen generate`로 OpenAPI 문서(`<id>.openapi.json`)를 만든 뒤, 그 문서를 입력으로 씁니다.

```typescript
// src/schemas/editor-events.ts
import { z } from 'zod'

export const TextRange = z.object({
  start: z.number().int().nonnegative().describe('0-based start offset'),
  end: z.number().int().nonnegative().describe('0-based end offset'),
})

export const EditorActivityEvent = z.object({
  eventId: z.string().uuid().describe('Event UUID'),
  documentId: z.string().min(1).describe('Document ID'),
  action: z.enum(['insert', 'delete', 'format', 'undo', 'redo']),
  timestamp: z.string().datetime().describe('ISO-8601 Timestamp'),
  range: TextRange.optional(),
  metadata: z.record(z.string(), z.string()).optional(),
})

export type EditorActivityEvent = z.infer<typeof EditorActivityEvent>
export type TextRange = z.infer<typeof TextRange>
```

```typescript
// oa.config.ts
import { defineConfig } from '@oa-sdk/codegen'

export default defineConfig({
  specs: [
    { id: 'editor-events', schemaEntry: 'src/schemas/editor-events.ts', outDir: './src/generated', target: 'generic' },
  ],
  core: {
    // 모델만 다루므로 핸들러 계약과 클라이언트(동반 패키지 산출물)를 끈다
    contracts: { pureHandlers: false },
    client: { enabled: false },
  },
})
```

```bash
npx oa-gen generate   # src/generated/editor-events.openapi.json, editor-events.schema.json
```

export된 Zod 스키마의 이름이 컴포넌트 이름이 됩니다(`EditorActivityEvent`, `TextRange`). `@oa-sdk/client`가 설치되어 있지 않으면 `generate`는 TanStack Query 코드를 경고와 함께 건너뛰고 종료 코드 0으로 끝납니다. 설정 형식은 [선언적 스펙 설정](./declarative-spec-configuration.md)을 따릅니다.

### 방식 C: OpenAPI 문서

`components.schemas`만 있는 OpenAPI 3.1/3.2 YAML/JSON 문서도 그대로 입력으로 씁니다(`paths: {}`).

---

## 3. 생성하기

### 3.1 TypeScript 타입 (`oa-gen typegen`)

```bash
npx oa-gen typegen --spec models/events.tsp -o src/types/events.ts
# Zod 방식: --spec src/generated/editor-events.openapi.json
```

생성 결과(`src/types/events.ts`):

```typescript
// Auto-generated from OpenAPI spec. Do not edit.
// @oa-sdk/codegen typegen

/** 사용자 에디터 활동 이벤트 페이로드 */
export type EditorActivityEvent = {
  /** 수행된 액션 종류 */
  action: 'insert' | 'delete' | 'format' | 'undo' | 'redo'
  /** 작업 대상 문서 ID */
  documentId: string
  /**
  * 이벤트 고유 식별자 (UUID v4)
  * @format uuid
  */
  eventId: string
  /** 확장 메타데이터 */
  metadata?: Record<string, string>
  /** 변경된 문자열 범위 */
  range?: TextRange
  /**
  * 작업 발생 시각 (UTC)
  * @format date-time
  */
  timestamp: string
}

/** 텍스트 오프셋 범위 */
export type TextRange = {
  /**
  * @format int32
  * @minimum 0
  */
  end: number
  /**
  * @format int32
  * @minimum 0
  */
  start: number
}
```

- 기본은 `export type`이고 `--style interface`이면 `interface`로 씁니다.
- 속성은 이름순으로 정렬하고, `format`·`minimum` 같은 제약은 JSDoc 태그로 남깁니다.
- `--incremental`은 입력·옵션·출력이 그대로인 대상의 재생성을 건너뜁니다(`--cache-dir`, 기본 `./.oa-cache`).

### 3.2 독립형 타입 가드 (`oa-gen generate:guards`)

```bash
npx oa-gen generate:guards --input models/events.tsp -o src/guards --type-import ../types/events.js
```

출력 디렉터리에 다음 파일을 씁니다.

| 파일 | 내용 |
|---|---|
| `guards.js` | 컴포넌트마다 `is<TypeName>(data)` 함수. Ajv standalone으로 미리 컴파일한 검증 코드(import 없음, `eval` 없음) |
| `guards.d.ts` | `export declare function isEditorActivityEvent(data: unknown): data is EditorActivityEvent;` 같은 타입 술어 선언 |
| `index.js`, `index.d.ts` | `guards.js`를 다시 export |
| `package.json` | `{ "type": "module" }` (ESM) |

- `--type-import`는 `.d.ts`가 타입을 가져올 경로입니다. 생성된 `.d.ts` 파일 위치 기준으로 쓰므로, 위 예처럼 `src/guards/`에서 `src/types/events.ts`를 가리키면 `../types/events.js`입니다. 생략하면 `.d.ts`가 import 없이 타입 이름을 참조해 `TS2304`(`skipLibCheck`가 꺼진 경우)가 나거나 좁혀진 타입이 `any`가 되므로 항상 지정합니다.
- `--split`이면 `guards/<TypeName>.js`·`.d.ts`로 나눠 쓰고 `index.js`가 모두 다시 export합니다. 파일이 한 단계 깊어지므로 `--type-import` 경로도 한 단계 더 올라가야 합니다(`../../types/events.js`).
- `--schemas EditorActivityEvent,TextRange`로 대상 컴포넌트를 고를 수 있습니다. 점이 들어간 컴포넌트 이름(TypeSpec의 `OaSdkTypeSpec.StandardError` 등)도 원래 이름으로 고를 수 있고, 함수 이름은 JavaScript 식별자로 정규화됩니다(`isOaSdkTypeSpec_StandardError`). `.d.ts`의 타입 술어는 `data is OaSdkTypeSpec.StandardError`를 유지하며 namespace 루트(`OaSdkTypeSpec`)를 import합니다.
- `oa-gen generate --target standalone-guards --input <파일> --out-dir <디렉터리>`도 같은 가드를 만듭니다. `oa.config.ts`의 `guards` 설정으로 `oa-gen generate`에 포함할 수도 있습니다([선언적 스펙 설정](./declarative-spec-configuration.md#63-독립형-정적-타입-가드-guards)).

---

## 4. 소비 패턴

가드는 `index.js`에서 import합니다. 타입 술어이므로 검사를 통과한 값은 해당 타입으로 좁혀집니다.

### 4.1 Chrome 확장 프로그램(MV3) 메시징

MV3의 기본 CSP는 `eval()`과 동적 코드 생성을 막습니다. 생성된 가드는 이 정책 안에서 동작합니다.

```typescript
// content-script.ts
import { isEditorActivityEvent } from './guards/index.js'

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isEditorActivityEvent(message)) {
    // message는 EditorActivityEvent 타입으로 좁혀짐
    console.log(`Document ${message.documentId} action: ${message.action}`)
    sendResponse({ status: 'ok' })
  } else {
    sendResponse({ status: 'error', reason: 'malformed_payload' })
  }
})
```

확장 프로그램을 빌드한 뒤 번들 전체를 감사합니다. `eval`, `new Function`, 문자열을 넘긴 `setTimeout`/`setInterval`, 허용되지 않은 런타임 패키지 import가 있으면 종료 코드 1로 실패합니다.

```bash
npx oa-gen audit:csp --bundle dist
```

### 4.2 Node.js Worker Threads / IPC

```typescript
// worker-host.ts
import { parentPort } from 'node:worker_threads'
import { isEditorActivityEvent } from './guards/index.js'

parentPort?.on('message', (raw: unknown) => {
  if (!isEditorActivityEvent(raw)) {
    throw new Error('IPC Protocol Violation: malformed event payload')
  }
  processEvent(raw) // raw: EditorActivityEvent
})
```

### 4.3 WebSocket / 이벤트 버스

```typescript
// socket-gateway.ts
import { isEditorActivityEvent } from './guards/index.js'

socket.on('message', (buffer) => {
  const json: unknown = JSON.parse(buffer.toString('utf-8'))

  if (isEditorActivityEvent(json)) {
    eventBus.emit('editor:action', json)
  } else {
    metrics.increment('socket.dropped_malformed')
  }
})
```

---

## 5. 정리

- HTTP API가 없어도 모델 원본 하나에서 타입과 런타임 가드를 만들 수 있습니다. 원본을 고치면 `typegen`과 `generate:guards`를 다시 실행합니다.
- 가드는 외부 패키지를 import하지 않고 `eval`을 쓰지 않으므로 MV3 확장 프로그램 같은 제한된 환경에도 넣을 수 있습니다.
- 다형성 유니언, 상속 모델, 정밀한 수치 제약이 필요한 엔터티는 [스키마 아키텍처 및 작성 규칙](./schema-architecture-and-conventions.md)을 참고합니다.
- XState v6 상태 머신 런타임 스키마 검증이나 `ttsc` 컴파일러 트랜스폼을 통한 무의존성 AOT Standard Schema 생성이 필요한 경우, [멀티 티어 스키마 및 ttsc·Atlas 가이드](./schema-architecture-and-ttsc-guide.md)를 참고합니다.

