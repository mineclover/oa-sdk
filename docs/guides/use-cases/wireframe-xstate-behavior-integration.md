# WIREFRAME-BOOK & XState v6 런타임 연동 가이드 (AOT Standard Schema v1)

이 문서는 oa-sdk 생태계에서 **TypeSpec 순수 데이터 계약**, **`ttsc` AOT 컴파일러 트랜스폼**, 그리고 **XState v6 상태 머신 런타임**을 번들 크기 증가 없이 0-Cost로 결합하는 실무 연동 유스케이스를 다룹니다.

---

## 1. 아키텍처 배경 및 해결 과제

복잡한 인터랙티브 UI(예: Scene Player, Canvas 에디터, 결제 마법사)를 구축할 때, 유한 상태 머신(FSM)은 예측 가능한 상태 전이를 보장하는 최적의 패턴입니다.

### 기존 방식의 딜레마
1. **XState v5의 정적 캐스팅 한계**:
   - `setup({ types: { context: {} as Context, events: {} as Events } })`는 순수 TypeScript 컴파일 타임 검증만 제공하므로, 런타임에 외부 IPC나 조작된 이벤트가 유입될 때 상태 머신 내부가 오염되는 것을 막을 수 없었습니다.
2. **런타임 검증 라이브러리(Zod, Ajv) 번들링의 한계**:
   - 검증을 위해 클라이언트에 Zod(+50KB)나 Ajv(+100KB)를 포함하면 브라우저 초기 로딩 속도(LCP)가 저하됩니다.
   - 특히 Ajv의 JIT 코드 컴파일(`new Function()`)은 Chrome 확장 프로그램(Manifest V3) 및 엄격한 Content Security Policy(`script-src 'self'`) 환경에서 `unsafe-eval` 보안 위반으로 실행이 차단됩니다.

### 해결책: 0-Cost AOT Standard Schema v1 결합
- **TypeSpec**: 오직 상태 머신에 주입되는 **데이터의 형태(Data Shape)**만을 `@oa-sdk/typespec-decorators/behavior`로 선언합니다.
- **`ttsc` (Typia AST 트랜스폼)**: TypeScript 타입을 컴파일 시점에 순수 평탄한 자바스크립트 조건문(`if (typeof x !== '...')`)으로 펼치고, 커뮤니티 공통 규격인 [Standard Schema v1 (`@standard-schema/spec`)](https://github.com/standard-schema/standard-schema) 인터페이스로 포장합니다.
- **WIREFRAME-BOOK / XState v6**: 상태 머신의 전이 토폴로지, 가드, 액션을 선언하고, `setup({ schemas })`에 AOT 스키마를 주입하여 **0KB 번들 증가, 100% Zero-Eval CSP 호환, 10~50배 빠른 실행 속도**를 달성합니다.

---

## 2. 5단계 엔드투엔드 파이프라인

```
┌──────────────────────────────────────────────────────────┐
│ Step 1. TypeSpec 데이터 계약 저작                        │
│    • models/scene-player.tsp                             │
│    • @actorInput, @machineContext, @eventPayload         │
└────────────────────────────┬─────────────────────────────┘
                             │ oa-gen typegen
                             ▼
┌──────────────────────────────────────────────────────────┐
│ Step 2. 순수 TypeScript 인터페이스 방출                   │
│    • generated/scene-player.types.ts                     │
└────────────────────────────┬─────────────────────────────┘
                             │ ttsc compile transform
                             ▼
┌──────────────────────────────────────────────────────────┐
│ Step 3. AOT Standard Schema v1 합성 (0KB 번들)           │
│    • generated/scene-player.schemas.js                   │
│    • ~standard: { version: 1, vendor: 'ttsc-aot', ... } │
└────────────────────────────┬─────────────────────────────┘
                             │ WIREFRAME-BOOK Behavior IR 결합
                             ▼
┌──────────────────────────────────────────────────────────┐
│ Step 4. XState v6 머신 setup({ schemas }) 실행           │
│    • statechart/scene-player.machine.ts                  │
│    • input 검증, context 보호, O(1) 이벤트 디스패치       │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 단계별 실전 코드 구현

### Step 1: TypeSpec 데이터 계약 저작

상태 머신의 상태 전이 그래프가 아닌, **데이터 계약만을 목적별 서브패스로 선언**합니다:

```typespec
// models/scene-player.tsp
import "@oa-sdk/typespec-decorators/behavior";

using OaSdkTypeSpec;

@service(#{ title: "Scene Player Contracts" })
namespace ScenePlayer;

@behaviorRef("scene-player.v1")
@actorInput
model PlayerActorInput {
  sceneId: string;
  autoplay?: boolean = false;
  initialTime?: float64 = 0;
}

@machineContext
model PlayerMachineContext {
  sceneId: string;
  currentTime: float64;
  playing: boolean;
  playbackSpeed: float64 = 1.0;
}

@eventPayload("PLAY")
model PlayEvent {
  type: "PLAY";
  speed?: float64 = 1.0;
}

@eventPayload("PAUSE")
model PauseEvent {
  type: "PAUSE";
}

@eventPayload("SEEK")
model SeekEvent {
  type: "SEEK";
  time: float64;
}
```

### Step 2: 순수 TypeScript 인터페이스 추출

`oa-gen typegen`을 실행하여 순수 TypeScript 타입을 추출합니다:

```typescript
// generated/scene-player.types.ts
export interface PlayerActorInput {
  sceneId: string;
  autoplay?: boolean;
  initialTime?: number;
}

export interface PlayerMachineContext {
  sceneId: string;
  currentTime: number;
  playing: boolean;
  playbackSpeed?: number;
}

export type PlayerEvent =
  | { type: 'PLAY'; speed?: number }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; time: number };
```

### Step 3: `ttsc` 컴파일러 트랜스폼에 의한 AOT Standard Schema 생성

`ttsc`가 TypeScript AST를 읽고 빌드 시점에 생성하는 최종 JavaScript 산출물입니다. 외부 유효성 검사기 import가 일절 없습니다:

```javascript
// generated/scene-player.schemas.js (ttsc 컴파일 산출물)

function validatePlayerActorInput(input) {
  const issues = [];
  if (typeof input !== "object" || input === null) {
    return { issues: [{ message: "Expected object", path: [] }] };
  }
  if (typeof input.sceneId !== "string" || input.sceneId.length === 0) {
    issues.push({ message: "sceneId must be a non-empty string", path: ["sceneId"] });
  }
  if (input.autoplay !== undefined && typeof input.autoplay !== "boolean") {
    issues.push({ message: "autoplay must be a boolean", path: ["autoplay"] });
  }
  if (input.initialTime !== undefined && (typeof input.initialTime !== "number" || input.initialTime < 0)) {
    issues.push({ message: "initialTime must be a non-negative number", path: ["initialTime"] });
  }

  return issues.length > 0 ? { issues } : { value: input };
}

function validatePlayerEvent(input) {
  if (typeof input !== "object" || input === null) {
    return { issues: [{ message: "Event payload must be an object", path: [] }] };
  }
  // O(1) 식별 유니온 분기 최적화
  switch (input.type) {
    case "PLAY":
      if (input.speed !== undefined && (typeof input.speed !== "number" || input.speed <= 0)) {
        return { issues: [{ message: "Speed must be positive", path: ["speed"] }] };
      }
      return { value: input };
    case "PAUSE":
      return { value: input };
    case "SEEK":
      if (typeof input.time !== "number" || input.time < 0) {
        return { issues: [{ message: "Seek time must be non-negative", path: ["time"] }] };
      }
      return { value: input };
    default:
      return { issues: [{ message: `Unknown event type: ${input.type}`, path: ["type"] }] };
  }
}

export const playerActorInputSchema = {
  '~standard': {
    version: 1,
    vendor: 'ttsc-aot',
    validate: validatePlayerActorInput,
  },
};

export const playerEventSchema = {
  '~standard': {
    version: 1,
    vendor: 'ttsc-aot',
    validate: validatePlayerEvent,
  },
};
```

### Step 4: WIREFRAME-BOOK & XState v6 머신 연결

WIREFRAME-BOOK에서 정의된 상태 차트 전이 토폴로지를 XState v6로 작성하고, AOT 스키마를 바인딩합니다:

```typescript
// statechart/scene-player.machine.ts
import { setup, createActor } from 'xstate';
import {
  playerActorInputSchema,
  playerEventSchema,
} from '../generated/scene-player.schemas.js';
import type { PlayerMachineContext, PlayerEvent } from '../generated/scene-player.types.js';

export const scenePlayerMachine = setup({
  types: {
    context: {} as PlayerMachineContext,
    events: {} as PlayerEvent,
  },
  schemas: {
    input: playerActorInputSchema, // 액터 생성 시 input 검증
    events: playerEventSchema,     // send() 시 이벤트 페이로드 검증
  },
  actions: {
    notifyStateChange: ({ context }) => {
      window.postMessage({ type: 'PLAYER_STATE_UPDATED', playing: context.playing }, '*');
    },
  },
  guards: {
    canPlay: ({ context }) => !context.playing,
  },
}).createMachine({
  id: 'scenePlayer',
  initial: 'idle',
  context: ({ input }) => ({
    sceneId: input.sceneId,
    currentTime: input.initialTime ?? 0,
    playing: input.autoplay ?? false,
    playbackSpeed: 1.0,
  }),
  states: {
    idle: {
      on: {
        PLAY: {
          target: 'playing',
          guard: 'canPlay',
        },
      },
    },
    playing: {
      entry: 'notifyStateChange',
      on: {
        PAUSE: {
          target: 'idle',
          actions: ({ context }) => { context.playing = false; },
        },
        SEEK: {
          actions: ({ context, event }) => {
            context.currentTime = event.time;
          },
        },
      },
    },
  },
});

// 실제 액터 생성 및 사용
const playerActor = createActor(scenePlayerMachine, {
  input: {
    sceneId: 'intro-cutscene',
    autoplay: true,
  },
});

playerActor.start();

// 유효한 이벤트 전송 -> 상태 전이 수행
playerActor.send({ type: 'SEEK', time: 30.5 });

// 잘못된 이벤트 전송 -> FSM 내부 진입 전 즉시 차단
try {
  playerActor.send({ type: 'SEEK', time: -10 }); // Error: Seek time must be non-negative
} catch (err) {
  console.error('Invalid event blocked:', err);
}
```

---

## 4. 검증 및 보안 보증 (Zero-Eval CSP Audit)

생성된 Standard Schema 산출물이 엄격한 CSP 환경(Manifest V3)에서 안전한지 검증하려면 `oa-gen audit:csp` 명령을 실행합니다:

```bash
# 산출물 디렉터리 대상 zero-eval 정적 보안 감사
npx oa-gen audit:csp --bundle generated/
```

- **평가 기준**: 번들 파일 내에 `eval()`, `Function()`/`new Function()`, 문자열 인자 `setTimeout(string)`/`setInterval(string)` 호출과 무거운 런타임 import(`ajv`·`ajv-*`, `zod`, `@oa-sdk/*`)가 0건이어야 합니다. WebAssembly 컴파일은 검사하지 않습니다(Manifest V3 기본 CSP가 `'wasm-unsafe-eval'`을 허용합니다).
- **결과**: `ttsc` 컴파일러 트랜스폼으로 생성된 인라인 조건문은 100% 순수 표현식이므로 감사를 무결하게 통과합니다.

---

## 5. 결론 및 실무 체크리스트

1. **상태 머신 데이터 계약은 TypeSpec에 선언**:
   `@oa-sdk/typespec-decorators/behavior`의 `@actorInput`, `@machineContext`, `@eventPayload`를 사용합니다.
2. **머신 상태 전이 토폴로지는 WIREFRAME-BOOK에 선언**:
   상태 전이 흐름, 가드, 병렬 상태는 Behavior IR 또는 XState v6 머신 파일에 격리합니다.
3. **런타임 검증 엔진은 ttsc AOT Standard Schema v1 채택**:
   외부 검증 파서를 브라우저에 배포하지 않고, 0KB 오버헤드의 Standard Schema v1 객체를 소비합니다.
