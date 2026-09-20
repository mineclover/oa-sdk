# 순수 타입 선언 및 제로-런타임 타입 가드 실무 가이드 (Non-HTTP Pure Data Models & Standalone Type Guards)

> **핵심 원칙**: `oa-sdk`는 REST 엔드포인트(`paths`, `GET /users`) 없이도 **순수 데이터 모델, DTO, 이벤트 페이로드 선언 및 타입 생성**에 완벽하게 활용될 수 있습니다.

이 가이드는 HTTP 전송 계층이 존재하지 않는 환경(브라우저 확장프로그램 MV3 메시징, Node Worker IPC, WebSocket 이벤트 패킷, Database DTO, 도메인 엔터티)에서 `oa-sdk`를 활용하여 순수 타입을 선언하고, 런타임 의존성이 전혀 없는 무경량 타입 가드를 생성·소비하는 방법을 다룹니다.

---

## 1. 왜 단순 타입 선언에도 `oa-sdk`를 사용하는가?

단순히 TypeScript에서 `interface UserProfile { ... }`을 손으로 작성하는 것과 비교할 때, `oa-sdk` 파이프라인을 거치면 다음과 같은 강력한 엔지니어링 이점을 빌드 타임에 얻을 수 있습니다:

| 과제 / 요구사항 | 일반적인 수작업 TypeScript 인터페이스 | `oa-sdk` 순수 타입 파이프라인 |
|---|---|---|
| **런타임 검증 (Runtime Validation)** | 인터페이스는 컴파일 후 소멸하므로, 별도로 Zod나 Joi 스키마를 이중 작성해야 함. (동기화 누락 위험) | 스펙/스키마 선언으로부터 **순수 타입 + 런타임 타입 가드 함수**가 단일 원천에서 100% 일치하게 자동 파생됨. |
| **보안 및 CSP (Chrome MV3)** | 런타임 AJV나 일부 검증 라이브러리는 `eval()` 또는 `new Function()`을 사용하여 보안 정책(CSP) 위반. | **`oa-gen standalone-guards`**: `eval()`이 완전히 배제된 순수 정적 JavaScript 함수(`isUser(v)`)를 생성하여 MV3 CSP 완벽 준수. |
| **번들 크기 및 의존성** | 클라이언트나 익스텐션 번들에 무거운 검증 라이브러리(Zod, AJV 등) 런타임이 포함됨 (수십~수백 KB). | **Zero-Runtime Weight**: 외부 의존성이 0개(`dependencies: {}`)인 순수 함수로 방출되어 번들 용량 오버헤드가 사실상 0. |
| **검증 처리량 (Throughput)** | 동적 AST 해석으로 초당 수천~수만 건 처리 수준. | 사전 컴파일된 직렬식 IF 검사 코드로 **초당 1,500만~3,500만 op/s** 처리 (마이크로초 미만 지연시간). |
| **표준 포맷 상호운용성** | TypeScript 내부에서만 갇혀 DB, 타 언어, 문서화 도구로 확장 불가. | JSON Schema Draft 2020-12 및 OpenAPI 3.1 `$defs` 표준 규격으로 자동 투영되어 메타데이터 저장소에 카탈로그화 가능. |

---

## 2. 순수 데이터 모델 선언하기 (Authoring Track)

HTTP 엔드포인트(`@route`, `op`) 없이 데이터 모델만 선언하는 두 가지 표준 경로가 제공됩니다.

### 방식 A: TypeSpec 기반 순수 모델 선언 (`.tsp`)
TypeSpec은 HTTP 데코레이터 없이 순수 데이터 구조체만을 명쾌하게 기술할 수 있습니다.

```typespec
// models/events.tsp
namespace Studio.Messaging;

@doc("사용자 에디터 활동 이벤트 페이로드")
model EditorActivityEvent {
  @doc("이벤트 고유 식별자 (UUID v4)")
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

> **컴파일 & 프로젝션**: 위 파일은 `oa-gen build-spec` 또는 TypeSpec 컴파일러를 통해 `components.schemas`만 포함된 OpenAPI 3.1/3.2 스펙 또는 JSON Schema로 방출됩니다.

---

### 방식 B: Zod 마스터 스키마 선언 (4-Stage Pipeline)
TypeScript 내부에서 직접 SSOT를 작성하고 싶다면 Zod 마스터 스키마 방식을 사용합니다.

```typescript
// packages/shared-types/src/schemas/editor-events.ts
import { z } from 'zod';

export const TextRangeSchema = z.object({
  start: z.number().int().nonnegative().describe('0-based start offset'),
  end: z.number().int().nonnegative().describe('0-based end offset'),
});

export const EditorActivityEventSchema = z.object({
  eventId: z.string().uuid().describe('Event UUID'),
  documentId: z.string().min(1).describe('Document ID'),
  action: z.enum(['insert', 'delete', 'format', 'undo', 'redo']),
  timestamp: z.string().datetime().describe('ISO-8601 Timestamp'),
  range: TextRangeSchema.optional(),
  metadata: z.record(z.string()).optional(),
});

// TypeScript 정적 타입 추론
export type EditorActivityEvent = z.infer<typeof EditorActivityEventSchema>;
export type TextRange = z.infer<typeof TextRangeSchema>;
```

---

## 3. 코드 생성 및 산출물 추출 (Generation)

### 3.1 순수 TypeScript 인터페이스 생성 (`oa-gen typegen`)
스키마 파일로부터 런타임 코드 없는 순수 TypeScript 선언(`.ts` / `.d.ts`)을 추출합니다.

```bash
# OpenAPI 스펙 또는 스키마 번들로부터 순수 타입 추출
oa-gen typegen --spec schemas/event-models.json --output src/types/events.ts
```

**생성 결과 예시 (`src/types/events.ts`)**:
```typescript
/**
 * 사용자 에디터 활동 이벤트 페이로드
 */
export interface EditorActivityEvent {
  /** 이벤트 고유 식별자 (UUID v4) */
  eventId: string;
  /** 작업 대상 문서 ID */
  documentId: string;
  /** 수행된 액션 종류 */
  action: 'insert' | 'delete' | 'format' | 'undo' | 'redo';
  /** 작업 발생 시각 (UTC) */
  timestamp: string;
  /** 변경된 문자열 범위 */
  range?: TextRange;
  /** 확장 메타데이터 */
  metadata?: Record<string, string>;
}

export interface TextRange {
  start: number;
  end: number;
}
```

---

### 3.2 제로-런타임 의존성 독립형 타입 가드 생성 (`oa-gen generate:guards`)
외부 라이브러리 설치가 필요 없고 `eval()`을 쓰지 않는 고속 런타임 타입 가드 함수를 생성합니다.

```bash
# 독립형 무런타임 타입 가드 생성 (타입 선언과 연결: --type-import)
oa-gen generate:guards --input schemas/event-models.json --output src/guards/ --type-import ../types/events.js
```

**생성 결과 예시 (`src/guards/isEditorActivityEvent.js`)**:
```javascript
// Pre-compiled pure ESM guard (0 external dependencies, 100% CSP safe)
export function isEditorActivityEvent(data) {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.eventId !== 'string') return false;
  if (typeof data.documentId !== 'string') return false;
  if (!['insert', 'delete', 'format', 'undo', 'redo'].includes(data.action)) return false;
  if (typeof data.timestamp !== 'string') return false;
  if (data.range !== undefined) {
    if (!data.range || typeof data.range !== 'object') return false;
    if (typeof data.range.start !== 'number' || data.range.start < 0) return false;
    if (typeof data.range.end !== 'number' || data.range.end < 0) return false;
  }
  return true;
}
```

---

## 4. 실무 소비 패턴 (Consumer Track)

### 4.1 Chrome 확장프로그램(MV3) 메시징 검증
Chrome 확장프로그램은 강력한 콘텐츠 보안 정책(CSP) 때문에 `eval()`이나 동적 코드 생성이 차단됩니다. `oa-gen standalone-guards` 산출물은 안전하게 동작합니다.

```typescript
// content-script.ts
import { isEditorActivityEvent } from './guards/isEditorActivityEvent.js';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 런타임 검증과 TypeScript 타입 단언이 한 번에 완료됨
  if (isEditorActivityEvent(message)) {
    // message는 이제 EditorActivityEvent 타입으로 100% 안전하게 추론됨
    console.log(`Document ${message.documentId} action: ${message.action}`);
    sendResponse({ status: 'ok' });
  } else {
    console.error('Invalid message format received');
    sendResponse({ status: 'error', reason: 'malformed_payload' });
  }
});
```

### 4.2 Node.js Worker Threads / IPC 메시지 검증
Worker 프로세스 간 주고받는 직렬화된 데이터의 무결성을 마이크로초 단위로 빠르게 검증합니다.

```typescript
// worker-host.ts
import { parentPort } from 'node:worker_threads';
import { isEditorActivityEvent } from './guards/isEditorActivityEvent.js';

parentPort?.on('message', (raw) => {
  if (!isEditorActivityEvent(raw)) {
    throw new Error(`IPC Protocol Violation: malformed event payload`);
  }
  
  // 타입 보장된 안전한 처리
  processEvent(raw);
});
```

### 4.3 WebSocket / Event Bus 메시지 라우터
수천 건의 이벤트 패킷이 쏟아지는 소켓 게이트웨이에서 부하 없이 안전하게 라우팅합니다.

```typescript
// socket-gateway.ts
import { isEditorActivityEvent } from './guards/isEditorActivityEvent.js';

socket.on('message', (buffer) => {
  const json = JSON.parse(buffer.toString('utf-8'));

  if (isEditorActivityEvent(json)) {
    eventBus.emit('editor:action', json);
  } else {
    metrics.increment('socket.dropped_malformed');
  }
});
```

---

## 5. 결론 및 선택 가이드

- **HTTP API가 없더라도** 데이터 모델의 단일 진실 공급원(SSOT) 구축, 타입 생성, 런타임 무경량 가드 생성을 위해 `oa-sdk`를 적극 권장합니다.
- 복잡한 프레임워크나 런타임 검증 라이브러리를 번들에 추가하지 않고도, 최고 수준의 타입 안전성과 처리량을 확보할 수 있습니다.
