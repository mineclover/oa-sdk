# 멀티 티어 스키마 아키텍처 및 도구별 역할 분리 가이드 (oa-sdk, ttsc, Atlas)

이 문서는 oa-sdk 생태계에서 **데이터베이스(Storage), 네트워크 API(Transport), 논리 거버넌스(Logical), 런타임 행위(Behavior)**의 4계층 스키마를 어떻게 분리하여 운영하는지, 그리고 **oa-sdk 표준 도구체계, ttsc(TypeScript 컴파일러 플러그인), Atlas(데이터베이스 선언적 마이그레이션)**를 언제 어떤 목적으로 사용해야 하는지 명확한 기준을 제시합니다.

---

## 1. 4계층 스키마 아키텍처 개요

현대 풀스택 애플리케이션의 스키마는 각기 다른 수명주기와 관심사를 가집니다. 단일 도구로 모든 스키마를 표현하려 하면 강한 결합과 런타임 오버헤드가 발생하므로, 아래와 같이 4개 계층으로 분리합니다.

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Storage Tier (Physical) ── Ariga Atlas                             │
│    • 산출물: db/schema.sql, atlas.hcl, migrations/*.sql                │
│    • 책임: 테이블, 물리 컬럼 타입, 인덱스, 파티셔닝, 마이그레이션        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ atlas schema inspect --format json
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. Logical Tier (Governance) ── oa-sdk DPM & Logical ERD               │
│    • 산출물: oa-sdk.logical-erd.v1.json, dpm.manifest.json             │
│    • 책임: 논리 엔티티, 가상 관계, PII 가명화, 요구사항 추적성           │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 공통 모델 어휘
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. API & Transport Tier ── oa-sdk TypeSpec & OpenAPI 3.2               │
│    • 산출물: packages/schemas/**/*.tsp, approved.openapi.yaml          │
│    • 책임: REST API 엔드포인트, DTO, Client SDK, Router, Mock Server  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ 데이터 셰이프 참조 ($ref)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 4. Behavior Tier (Runtime) ── WIREFRAME-BOOK & XState (ttsc AOT)       │
│    • 산출물: Behavior IR, XState v5/v6 상태 머신, Standard Schema      │
│    • 책임: FSM 상태 전이 토폴로지, 가드 조건, 액션 실행, 이벤트 루프     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 도구별 사용 기준 (When to Use What)

### 📌 빠른 판단 요약표

| 개발 시나리오 | 권장 도구 | 이유 및 장점 | 피해야 할 안티패턴 |
|---|---|---|---|
| **HTTP/REST API 스펙 작성 및 클라이언트/서버 생성** | **`oa-sdk` 표준 도구** (`oa-gen`, TypeSpec) | OpenAPI 3.2 준수, 라우터(Hono, Fastify, Express), TanStack Query 생성, Mock 지원 | ttsc나 DB 스키마로부터 직접 OpenAPI 역생성 |
| **초경량 런타임 유효성 검사 (0-Cost AOT)** | **`ttsc` / Typia** | TS 타입을 컴파일 시점에 순수 JS 인라인 검사 코드로 변환하여 번들 크기 0 유지 | 브라우저 클라이언트에 Ajv나 거대한 JSON Schema 파서 번들링 |
| **XState v6 Standard Schema 런타임 검증** | **`ttsc` AOT Standard Schema** | XState v6 `setup({ schemas })`용 표준 스키마 인터페이스를 컴파일 시점에 무의존성으로 생성 | Zod 중복 작성 및 TS ↔ Zod 드리프트 발생 |
| **요구사항 ↔ 코드 심볼 ↔ 스키마 100% 추적성 검증** | **`ttsc` (`@ttsc/evidence`)** | 컴파일 타임에 마크다운 앵커와 코드 심볼 일치성을 강제하는 CI 게이트 | 수작업 체크리스트 또는 관리되지 않는 주석 |
| **데이터베이스 물리 DDL 작성, 선언적 마이그레이션** | **`Atlas` (Ariga Atlas)** | PostgreSQL, SQLite, Cloudflare D1 방언 최적화, 마이그레이션 diff 자동화 및 린팅 | TypeSpec 모델로부터 SQL DDL 자동 생성 |
| **물리 DB 컬럼 ↔ API 계약 간 불일치(Drift) 감지** | **`Atlas` + `oa-sdk` DPM/ERD** | `atlas schema inspect` 출력을 읽기 전용 증거로 읽어 TypeSpec 모델과 정적 비교 | oa-sdk에게 DB 직접 쓰기/마이그레이션 권한 부여 |

---

## 3. 목적별 활성 데코레이터 분리 사용법

`@oa-sdk/typespec-decorators`는 목적에 따라 명확하게 분리된 서브패스를 제공합니다. 필요한 도메인의 데코레이터만 선택적으로 import하여 스키마 오염을 방지합니다.

### 1) API / Transport 계약 저작 시
HTTP 엔드포인트 및 공통 응답 컴포넌트를 작성할 때 사용합니다:
```typespec
import "@oa-sdk/typespec-decorators/api";

using Http;
using OaSdkTypeSpec;

@route("/users")
interface UsersApi {
  @get list(): Ok<PageResult<User>> | StandardHttpErrors;
  @oaUseResponseComponent("400", "BadRequest")
  @post create(@body body: CreateUserRequest): Created<User>;
}
```

### 2) 데이터 거버넌스 및 PII 가명화 저작 시
DPM 정책 및 Persona capability를 부여할 때 사용합니다:
```typespec
import "@oa-sdk/typespec-decorators/governance";

using OaSdkTypeSpec;

model Member {
  id: string;

  @pseudonymize("mask", "direct_identifier", true)
  email: string;
}

@personaCapability("pagination", "audit-emission")
op listMembers(): Member[];
```

### 3) 실시간 동시성 및 CRDT 데이터 저작 시
분산 상태 동기화 및 CRDT 머지 정책을 선언할 때 사용합니다:
```typespec
import "@oa-sdk/typespec-decorators/crdt";

using OaSdkTypeSpec;

@crdtEntity(#{ partitionKey: "docId", compaction: "checkpoint-squash" })
model Document {
  id: string;

  @crdt(#{ type: "text-sequence", resolution: "last-write-wins", role: "value" })
  content: string;
}
```

### 4) XState / Behavior 런타임 데이터 스키마 저작 시 (이슈 #1 대응)
상태 머신이 소비할 Actor 입력, 컨텍스트, 이벤트 페이로드를 작성할 때 사용합니다:
```typespec
import "@oa-sdk/typespec-decorators/behavior";

using OaSdkTypeSpec;

@behaviorRef("scene-player.v1")
@actorInput
model PlayerInput {
  sceneId: string;
  autoplay?: boolean = false;
}

@machineContext
model PlayerContext {
  currentTime: float64;
  playing: boolean;
}

@eventPayload("SEEK")
model SeekEvent {
  type: "SEEK";
  time: float64;
}
```
> **주의**: 상태 전이 그래프(Transition), 가드(Guard), 머신 구조는 TypeSpec에 작성하지 않고 **WIREFRAME-BOOK(Behavior IR)**에 작성합니다.

### 5) Atlas 물리 DB 스키마 증거 연결 시
물리 테이블/컬럼과의 드리프트 검증용 참조 메타데이터를 선언할 때 사용합니다:
```typespec
import "@oa-sdk/typespec-decorators/storage";

using OaSdkTypeSpec;

@storageCatalog("sqlite")
namespace Commerce;

@storageRef("users")
model UserEntity {
  @storageRef("users.user_id")
  id: string;

  @storageRef("users.email_address")
  email: string;
}
```

---

## 4. Atlas와의 실제 연계 파이프라인 가이드

물리 DB를 관리하는 프로젝트(예: Cloudflare D1 기반 `board-platform`)에서 oa-sdk와 Atlas를 연계하는 정석 워크플로우입니다:

1. **물리 스키마 변경 및 마이그레이션 (`Atlas`가 소유)**:
   ```bash
   # db/schema.sql 수정 후 선언적 마이그레이션 diff 생성
   atlas migrate diff --env local
   ```
2. **카탈로그 증거 추출 (`Atlas` → JSON)**:
   ```bash
   # DB 물리 스키마를 JSON 형태로 덤프
   atlas schema inspect --env local --format '{{ json . }}' > .schema-evidence.json
   ```
3. **드리프트 정적 검증 (`oa-sdk`가 소유)**:
   - CI에서 `oa-erd check` 또는 DPM 카탈로그 검증기가 `.schema-evidence.json`을 읽고,
   - TypeSpec의 `@storageRef` 또는 Logical ERD의 엔티티/필드와 대조하여 누락되거나 타입이 불일치하는 필드를 탐지합니다.
   - **이 과정에서 oa-sdk는 DB를 전혀 변경하지 않는 안전한 읽기 전용 검증 게이트로 작동합니다.**

---

## 5. 심층 분석: XState v6 AOT Standard Schema v1 생성 및 ttsc 컴파일러 트랜스폼

XState v5에서는 `setup({ types: { context: {} as TContext, events: {} as TEvents } })`와 같이 순수한 TypeScript 타입 캐스팅을 사용하므로 런타임 검증이 전혀 수행되지 않았습니다. 반면 **XState v6**에서는 **`setup({ schemas })`**를 통해 런타임에 액터 입력(input), 컨텍스트(context), 이벤트(events), 그리고 상태 레벨(state-level) 스키마를 유효성 검사할 수 있는 강력한 기능이 도입되었습니다.

이때 핵심은 **"런타임 스키마 파서(Ajv, Zod 등)를 브라우저 번들에 포함시키지 않고, 어떻게 가볍고 안전하게 Standard Schema v1 객체를 공급할 것인가"**입니다.

### 5.1 Standard Schema v1 (`~standard`) 규격과 XState v6

XState v6는 특정 스키마 라이브러리에 하드코딩되지 않고, 커뮤니티 표준인 [Standard Schema v1 (`@standard-schema/spec`)](https://github.com/standard-schema/standard-schema)을 직접 지원합니다.

```typescript
// Standard Schema v1 핵심 인터페이스
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaV1.Result<Output> | Promise<StandardSchemaV1.Result<Output>>;
    readonly types?: {
      readonly input: Input;
      readonly output: Output;
    };
  };
}

export type Result<Output> = SuccessResult<Output> | FailureResult;
export interface SuccessResult<Output> { readonly value: Output; readonly issues?: undefined; }
export interface FailureResult { readonly issues: ReadonlyArray<Issue>; }
```

XState v6 액터가 초기화되거나(`createActor(machine, { input })`) 이벤트를 수신할 때(`actor.send(event)`), 내부적으로 `schema['~standard'].validate(payload)`를 동기 호출하여 유효하지 않은 데이터가 FSM 내부로 유입되는 것을 즉시 차단합니다.

---

### 5.2 기존 런타임 스키마 엔진(Ajv/Zod)의 한계

| 접근 방식 | 번들 크기 영향 | 런타임 성능 | CSP 보안 (Zero-Eval) | 드리프트 위험 |
|---|---|---|---|---|
| **TypeSpec → JSON Schema → Ajv** | **+100KB 이상** (거대 엔진) | JIT 컴파일 오버헤드 | `unsafe-eval` 필요 (CSP 차단 위험) | 스키마 2중 변환으로 포맷 제약 손실 |
| **TypeSpec → Generated Zod** | **+45~55KB** (Zod 런타임) | 함수 체인 호출 오버헤드 | CSP 안전 | TypeSpec과 Zod 코드 간 동기화 불일치 |
| **TypeSpec → ttsc AOT Standard Schema** | **0KB (순수 인라인 JS)** | **10~50배 빠름** (단순 `if`문) | **100% 안전 (Zero-Eval)** | **완전 무손실 (TS 타입 직접 변환)** |

---

### 5.3 ttsc / Typia 컴파일러 AST 트랜스폼 작동 원리

`ttsc` (TypeScript-Go Toolchain)는 `tsc` 빌드 타임에 AST를 직접 분석하여, 타입 정의를 읽고 **순수 원시 JavaScript 조건문(flat if statements)**으로 구성된 검증 함수를 인라인 생성합니다.

```
[TypeSpec Model]
      │
      ▼ (tsp compile or oa-gen)
[TypeScript Interface (.ts)]
      │
      ▼ (ttsc compile transform: Typia AST pass)
[AOT Standard Schema Object]
      │  • 외부 검증 라이브러리 import 없음 (0 dependencies)
      │  • 각 필드별 평탄화된 if (typeof x !== '...') 검사문
      │  • ~standard: { version: 1, vendor: 'ttsc-typia', validate }
      ▼
[XState v6 setup({ schemas })]
```

---

### 5.4 AOT 생성 코드 예시 (AOT Standard Schema)

TypeSpec으로 정의한 Scene Player의 `PlayerActorInput` 모델이 `ttsc`를 거쳐 빌드된 최종 JavaScript 결과물입니다:

```javascript
// generated/scene-player.schemas.js (ttsc가 AOT 빌드한 산출물)

function validatePlayerActorInput(input) {
  const issues = [];
  if (typeof input !== "object" || input === null) {
    return { issues: [{ message: "Expected object", path: [] }] };
  }
  if (typeof input.sceneId !== "string") {
    issues.push({ message: "Expected string", path: ["sceneId"] });
  }
  if (input.autoplay !== undefined && typeof input.autoplay !== "boolean") {
    issues.push({ message: "Expected boolean", path: ["autoplay"] });
  }
  if (input.initialTime !== undefined && (typeof input.initialTime !== "number" || Number.isNaN(input.initialTime))) {
    issues.push({ message: "Expected number", path: ["initialTime"] });
  }

  return issues.length > 0 ? { issues } : { value: input };
}

// Standard Schema v1 규격 래퍼
export const playerActorInputSchema = {
  '~standard': {
    version: 1,
    vendor: 'ttsc-aot',
    validate: validatePlayerActorInput,
  },
};
```

* **라이브러리 의존성 0**: `import { z } from 'zod'`나 `import Ajv from 'ajv'`가 전혀 없습니다.
* **평탄화된 실행**: 함수 체이닝이나 정규식 엔진 해석기 없이 V8 JIT 최적화가 바로 적용되는 가장 단순한 조건문입니다.
* **번들 크기 최소화**: 모델 1개당 생성되는 코드는 수십 바이트 수준에 불과합니다.

---

### 5.5 XState v6 머신 연결 실전 패턴

```typescript
import { setup } from 'xstate';
import {
  playerActorInputSchema,
  playerContextSchema,
  playerEventSchema,
  playingStateInputSchema,
} from './generated/scene-player.schemas.js';

export const scenePlayerMachine = setup({
  schemas: {
    input: playerActorInputSchema,     // 머신 시작 시 input 검증
    context: playerContextSchema,      // 컨텍스트 구조 검증
    events: playerEventSchema,         // 전송되는 이벤트 payload 검증
  },
  actions: {
    playAnimation: (_, params: { animationId: string; speed: number }) => {
      // 액션 로직
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
        PLAY: { target: 'playing', guard: 'canPlay' },
      },
    },
    playing: {
      schemas: {
        input: playingStateInputSchema, // State 진입 시 인풋 검증 (XState v6 신규 기능)
      },
      on: {
        PAUSE: { target: 'idle' },
      },
    },
  },
});
```

---

### 5.6 실무 도입 시 고려사항 및 베스트 프랙티스

1. **닫힌 객체(Closed) vs 열린 객체(Open) 정책**:
   - API 응답이나 FSM 이벤트에서 정의되지 않은 추가 속성을 허용할지 여부(excess properties check)를 결정해야 합니다.
   - 보안 및 FSM 무결성이 중요한 경우 strict 모드를 켜서 잉여 속성 유입을 차단합니다.
2. **Discriminated Union(식별 유니온) 이벤트 처리**:
   - `type: "PLAY" | "PAUSE" | "SEEK"`와 같은 이벤트 유니온은 `ttsc`가 첫 번째 프로퍼티인 `type`의 `switch` 분기문으로 최적화하여 $O(1)$ 속도로 이벤트 검증을 수행합니다.
3. **Behavior IR와의 오너십 분리 유지**:
   - 상태 머신의 전이 흐름(Flow), 다이어그램, 계층 구조는 여전히 **WIREFRAME-BOOK(Behavior IR)**에 두고, TypeSpec과 `ttsc`는 오직 **입출력 데이터의 형태(Shape)**만을 컴파일하여 제공해야 합니다.

---

## 6. 형식 이론: 4계층 스키마 대수 및 사상 보존 법칙 (Formal Schema Algebra)

4계층 스키마 분리가 단순한 도구 선택의 문제를 넘어 소프트웨어 공학적으로 필수적인 이유는, 각 계층이 서로 다른 수학적 대수(Algebra)와 불변식(Invariants)을 기반으로 동작하기 때문입니다.

### 6.1 계층별 형식 정의 (Formal Mathematical Definitions)

1. **물리 스토리지 계층 (Physical Storage Tier, $S_{phys}$)**
   $$S_{phys} = \langle T, C, K, I, M \rangle$$
   * $T$: 테이블 집합
   * $C$: 물리 컬럼 명세 (SQL 방언 종속적 데이터 타입, Nullability, Default 표현식)
   * $K$: 무결성 제약조건 ($K_{pk}$ 기본키, $K_{fk}$ 외래키)
   * $I$: 물리 인덱스 구조 (B-Tree, Hash, Partial/Filtered, Composite)
   * $M$: 시계열적 상태 전이 마이그레이션 함수 $M: S_{phys}^{(t)} \to S_{phys}^{(t+1)}$

2. **논리 거버넌스 계층 (Logical Governance Tier, $M_{log}$)**
   $$M_{log} = \langle E, R, P, G \rangle$$
   * $E$: 비즈니스 도메인 엔터티 집합
   * $R$: 엔터티 간 의미론적 관계 (1:1, 1:N, N:M 논리 연관성)
   * $P$: 개인정보 보호 및 가명화 사상 함수 $P: \text{Attr}(E) \to \{\text{mask}, \text{tokenize}, \text{clear}\}$
   * $G$: 요구사항 추적성 그래프 $G = (V_{req}, V_{model}, E_{trace})$

3. **API 전송 계층 (API & Transport Tier, $C_{api}$)**
   $$C_{api} = \langle O, \Omega, D, \Sigma \rangle$$
   * $O$: HTTP Operation 튜플 $\langle \text{Method}, \text{Path}, \text{Params} \rangle$
   * $\Omega$: 상태 코드별 응답 컴포넌트 맵 $\Omega: \text{StatusCode} \to \text{Schema}$
   * $D$: 직렬화 및 와이어 포맷 제약 (JSON, Multipart, SSE Streaming)
   * $\Sigma$: OpenAPI 3.1/3.2 AST 스펙트럼

4. **행위 런타임 계층 (Behavior Runtime Tier, $B_{fsm}$)**
   $$B_{fsm} = \langle S, \Sigma_{in}, \delta, s_0, F, E_{shape} \rangle$$
   * $S$: 유한 상태(States) 집합 및 계층적 상태 트리(Hierarchy)
   * $\Sigma_{in}$: 입력 이벤트 알파벳 집합
   * $\delta$: 전이 함수 $\delta: S \times \Sigma_{in} \times \text{Guard} \to S \times \text{Actions}$
   * $s_0$: 초기 상태, $F$: 최종 상태 집합
   * $E_{shape}$: 상태 머신에 주입되는 데이터 계약 집합 (Actor Input, Context, Event Payloads)

### 6.2 계층 간 사상 사상(Morphisms)과 역방향 금지 불변식

계층 간의 데이터 흐름은 **엄격한 단방향 사상(Unidirectional Morphism)**을 준수해야 하며, 역방향 투영은 시스템 결합도를 무한대로 증가시키므로 엄격히 차단됩니다.

```
       [ Storage: S_phys ]
               │
               │ (read-only catalog inspection)
               ▼
       [ Logical: M_log ]
               │
               │ (semantic projection)
               ▼
       [ API & Transport: C_api ]
               │
               │ (data shape extraction)
               ▼
       [ Behavior: B_fsm ]
```

1. **카탈로그 증거 사상 ($\phi_{inspect}$)**:
   $$\phi_{inspect}: S_{phys} \to O_{evidence}$$
   물리 DB 스키마는 `atlas schema inspect`를 통해 읽기 전용 JSON 오라클 $O_{evidence}$로 투영됩니다. 이 투영은 순수 관측(Observation)이며, 어떤 상태 변경도 수반하지 않습니다.

2. **정적 드리프트 검증 사상 ($\psi_{drift}$)**:
   $$\psi_{drift}: M_{log} \times O_{evidence} \to \{\text{PASS}, \text{DRIFT\_ERROR}\}$$
   논리 모델 $M_{log}$의 속성 $\text{Attr}(E)$가 물리 컬럼 $C$와 일치하는지 정적으로 검증합니다. 일치하지 않는 경우 CI 게이트가 실패합니다.

3. **형태 추출 사상 ($\tau_{shape}$)**:
   $$\tau_{shape}: C_{api} \to E_{shape}(B_{fsm})$$
   상태 머신 $B_{fsm}$의 입력 및 이벤트 데이터 형태는 API 모델 $C_{api}$로부터 파생될 수 있습니다.

4. **역방향 금지 불변식 (Invariance of Non-Reverse Projection)**:
   * **Invariant 1 (Non-DDL Invariant)**: $\mathcal{F}_{emit}: C_{api} \not\to S_{phys}$  
     API 스펙이나 코드젠 도구가 직접 SQL DDL을 생성하거나 DB를 변경하는 사상은 금지됩니다. 물리 최적화(인덱스, 파티셔닝, 방언) 정보가 손실되기 때문입니다.
   * **Invariant 2 (Non-Topology Invariant)**: $\mathcal{F}_{emit}: C_{api} \not\to \delta(B_{fsm})$  
     API 스펙(TypeSpec/OpenAPI)이 상태 머신의 상태 전이 함수 $\delta$나 그래프 토폴로지를 선언하는 사상은 금지됩니다. API 언어는 본질적으로 요청-응답 쌍을 정의할 뿐, 순환 루프나 계층형 FSM 수명주기를 표현하기에 부적합하기 때문입니다.

---

## 7. 런타임 스키마 파싱 vs AOT 컴파일러 트랜스폼 심층 이론

### 7.1 복잡도 분석: $O(N)$ AST 해석기 vs $O(1)$ 플랫 조건문 분기

런타임 스키마 검증기(Ajv, Zod, Valibot)와 `ttsc` AOT 컴파일러 트랜스폼 간의 근본적인 차이는 **연산 시점(Evaluation Phase)**과 **엔진 수준의 실행 모델(Execution Model)**에 있습니다.

```
[런타임 스키마 인터프리터 (Zod/Ajv)]
Runtime Data ──▶ [Schema AST Walker] ──▶ Dynamic Type Checks ──▶ Object Allocations
                 • O(N) 스키마 노드 순회
                 • 함수 체이닝 인디렉션
                 • 메가모픽(Megamorphic) 호출 발생

[ttsc AOT 컴파일러 트랜스폼 (Typia)]
Compile-time TS AST ──(AST Transform)──▶ Flat Primitive `if` Statements
                                                │
Runtime Data ───────────────────────────────────┴──▶ Direct CPU Branching (JIT Inlined)
                                                     • O(1) 플랫 조건문
                                                     • 0 외부 함수 호출
                                                     • 모노모픽(Monomorphic) 인라인 캐싱
```

1. **해석기 오버헤드 ($O(N)$)**:
   - Zod나 Ajv는 런타임에 객체 스키마 트리(AST)를 순회하며 필드마다 검증 체인을 호출합니다.
   - 객체 1개를 검증할 때마다 내부적으로 수십~수백 개의 클로저 함수 호출과 이슈 객체 메모리 할당이 발생하여 V8 가비지 컬렉터(GC)에 지속적인 압력을 가합니다.
2. **AOT 플랫 조건문 ($O(1)$ Direct Branching)**:
   - `ttsc`는 빌드 타임에 TypeScript AST를 분석하여, 검증 대상 객체의 필드들을 순수 `if (typeof obj.prop !== 'string')` 형태의 직선형(straight-line) 코드로 펼칩니다.
   - 함수 체이닝이나 중간 객체 할당이 0이므로, V8 JIT 컴파일러가 이 함수를 완벽히 인라인 캐싱(Monomorphic Inline Cache)하여 네이티브 머신 코드로 컴파일합니다.

### 7.2 Strict Content Security Policy (CSP)와 Zero-Eval 무결성

현대 웹 애플리케이션, 특히 Chrome 확장 프로그램(Manifest V3), 금융/엔터프라이즈 포털, 의료 정보 시스템은 다음과 같은 엄격한 CSP 헤더를 강제합니다:

```http
Content-Security-Policy: default-src 'self'; script-src 'self';
```

- **Ajv의 치명적 딜레마**:
  - Ajv가 빠른 성능을 내기 위해 사용하는 방식은 런타임에 JSON Schema를 파싱한 뒤 `new Function("data", code)`을 실행하여 검증 함수를 동적 생성(JIT compilation)하는 것입니다.
  - 하지만 엄격한 CSP 환경에서는 `unsafe-eval` 키워드가 없으면 브라우저가 `EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script`를 던지며 애플리케이션 실행을 즉시 중단합니다.
  - Ajv의 Standalone 모드는 사전 컴파일을 지원하지만, 번들 크기가 매우 크고 TypeSpec 및 TypeScript 모델과의 직접적인 AST 연동이 불가능합니다.
- **`ttsc`의 Zero-Eval 보장**:
  - `ttsc`는 `tsc` 컴파일러 패스에서 순수한 `.js` 소스 코드로 변환을 끝마칩니다.
  - 런타임에 `eval()`, `new Function()`, `WebAssembly.compile()` 등 동적 코드 실행 API를 단 1회도 호출하지 않으므로, **Strict CSP 환경에서 100% 무결성을 보장**합니다.

### 7.3 Standard Schema v1 (`~standard`) 인터페이스의 형식적 규격

[Standard Schema v1 (`@standard-schema/spec`)](https://github.com/standard-schema/standard-schema)은 Zod, Valibot, ArkType 등 다양한 스키마 라이브러리가 상호 운용될 수 있도록 제정된 공통 규격입니다.

$$V_{std}: \text{Input} \to \text{Result}\langle \text{Output} \rangle$$

$$\text{Result}\langle \text{Output} \rangle = \{ \text{value}: \text{Output} \} \mid \{ \text{issues}: \text{ReadonlyArray}\langle \text{Issue} \rangle \}$$

XState v6는 `createActor(machine, { input })` 또는 `actor.send(event)`가 호출될 때 다음과 같은 불변식을 실행합니다:

```typescript
// XState v6 내부 실행 메커니즘
function assertValid<T>(schema: StandardSchemaV1<unknown, T>, value: unknown): T {
  const result = schema['~standard'].validate(value);
  if ('issues' in result && result.issues && result.issues.length > 0) {
    throw new Error(`[XState Schema Violation] ${JSON.stringify(result.issues)}`);
  }
  return ('value' in result ? result.value : value) as T;
}
```

`ttsc`가 생성한 AOT Standard Schema 객체는 외부 라이브러리 없이 이 명세를 완벽히 충족하므로, 번들 크기를 1바이트도 증가시키지 않으면서 XState v6의 런타임 검증을 100% 가동할 수 있습니다.

---

## 8. 도구별 및 역할별 책임 분리 매트릭스 (RACI)

### 8.1 4대 도구 책임 한계선 (Hard Invariants)

| 도구 | 절대 소유해야 하는 책임 (MUST DO) | 절대 소유해서는 안 되는 영역 (NEVER DO) |
|---|---|---|
| **`oa-sdk`** | • TypeSpec 기반 OpenAPI 3.1/3.2 계약 생성<br>• 프레임워크 라우터 핸들러 계약(`*.contract.ts`) 생성<br>• 타입 안전 클라이언트 SDK 및 TanStack Query v5 훅 생성<br>• 실시간 Mock 서버(`oa-gen mock`) 서빙<br>• Breaking Diff 및 런타임 드리프트 방어 | • 데이터베이스 물리 DDL 작성 및 SQL 생성<br>• DB 마이그레이션 실행 및 스키마 변경 적용<br>• FSM 상태 머신 전이 토폴로지 저작<br>• 비즈니스 도메인 서비스 구현 로직 소유 |
| **`ttsc`** | • TypeScript AST의 AOT 순수 JS 검증 코드 저수준 강하<br>• 런타임 의존성 0KB의 Standard Schema v1 객체 합성<br>• 요구사항 앵커 ↔ 코드 심볼 간 추적성 증거 검증(`@ttsc/evidence`)<br>• 컴파일러 지식 그래프 및 의존성 분석 | • OpenAPI 스펙 문서 자체의 정본 저작<br>• HTTP 네트워크 라우팅 및 직렬화 처리<br>• 물리 데이터베이스 마이그레이션 관리 |
| **`Atlas`** | • 물리 데이터베이스 선언적 DDL(`db/schema.sql`, HCL) 관리<br>• 버전 관리된 마이그레이션 diff 및 린트(`atlas migrate`)<br>• RDBMS 방언별 물리 최적화 (인덱스, 파티셔닝, 무결성 제약)<br>• 스키마 스냅샷 덤프(`atlas schema inspect --format json`) | • 네트워크 API DTO 및 HTTP 계약 저작<br>• 브라우저/클라이언트 런타임 코드 생성<br>• 상태 머신 데이터 검증 인터페이스 제공 |
| **`WIREFRAME-BOOK / XState`** | • FSM 상태 전이 다이어그램 및 토폴로지 정의<br>• 계층형 상태 차트(Parallel, Compound) 오케스트레이션<br>• 가드(Guards), 액션(Actions), 액터 스폰 수명주기 관리 | • 글로벌 API 엔드포인트 계약 선언<br>• 물리 데이터베이스 스키마 관리 |

---

### 8.2 엔지니어 역할별 RACI 매트릭스

* **R (Responsible)**: 실제 산출물을 작성하고 책임을 지는 역할
* **A (Accountable)**: 최종 승인 권한을 가지며 결과에 대해 책임을 지는 역할
* **C (Consulted)**: 산출물 작성 시 자문 및 피드백을 제공하는 역할
* **I (Informed)**: 변경 사항을 통보받고 산출물을 소비하는 역할

| 작업 영역 및 산출물 | API / 스펙 아키텍트 | 프론트엔드 / 상태 엔지니어 | 백엔드 / 시스템 엔지니어 | 데이터 / 인프라 엔지니어 |
|---|---|---|---|---|
| **물리 DDL 및 DB 마이그레이션 (`Atlas`)** | I | I | C | **R / A** |
| **논리 모델 및 PII 가명화 (`DPM`, `oa-erd`)** | **A** | I | R | C |
| **HTTP API 계약 및 OpenAPI 3.2 (`TypeSpec`)** | **R / A** | C | C | I |
| **클라이언트 SDK 및 TanStack Query (`oa-gen`)** | A | **R** | I | I |
| **백엔드 핸들러 계약 구현 (`*.contract.ts`)** | A | I | **R** | C |
| **XState v6 상태 머신 토폴로지 (`WIREFRAME-BOOK`)** | I | **R / A** | C | I |
| **AOT Standard Schema 컴파일 (`ttsc`)** | C | **R** | R | I |
| **물리 DB ↔ API 계약 드리프트 게이트 (`CI`)** | **A** | I | R | **R** |

---

## 9. 5대 치명적 안티패턴 및 실패 모드 (Anti-Pattern Encyclopedia)

### ❌ 안티패턴 1: 만능 DDL 모놀리스 (Universal DDL Monolith)
* **증상**: TypeSpec 모델에 데이터베이스 인덱스, 외래키 삭제 캐스케이드, 파티셔닝 데코레이터를 추가하고 TypeSpec emitter로 SQL DDL을 직접 생성하려는 시도.
* **실패 원인**: API 전송 계층의 모델링 요구사항(예: 민감 정보 제거, DTO 평탄화)과 DB 물리 계층의 요구사항(예: 정규화, 성능 최적화, 스토리지 엔진 특성)은 라이프사이클이 완전히 다릅니다. TypeSpec이 DDL을 소유하면 DB 인덱스 변경 하나 때문에 전체 API 스펙이 릴리스되어야 하는 심각한 결합이 발생합니다.
* **해결책**: DDL과 마이그레이션은 **Ariga Atlas**에게 전적으로 위임하고, oa-sdk는 `atlas schema inspect` 출력을 읽기 전용 증거로 소비하여 드리프트만 정적으로 검사합니다.

### ❌ 안티패턴 2: 브라우저 번들에 Ajv / JSON Schema 엔진 번들링 (Runtime Ajv Bundling)
* **증상**: TypeSpec에서 추출한 JSON Schema를 브라우저나 Electron 클라이언트로 그대로 가져와 Ajv 런타임으로 검증하는 행위.
* **실패 원인**:
  1. 클라이언트 번들 크기가 **100KB 이상** 급증합니다.
  2. Strict CSP(`script-src 'self'`) 환경에서 Ajv의 `new Function()` JIT 컴파일이 차단되어 런타임 예외가 발생합니다.
  3. FSM 이벤트 루프에서 매 이벤트마다 복잡한 AST 파싱 오버헤드가 발생하여 UI 프레임 드랍이 일어납니다.
* **해결책**: `ttsc` (Typia AST 트랜스폼)를 적용하여 컴파일 타임에 순수 원시 자바스크립트 조건문으로 펼쳐진 **AOT Standard Schema v1 (번들 크기 0KB, Zero-Eval)**을 주입합니다.

### ❌ 안티패턴 3: TypeScript 타입과 Zod 스키마 수작업 이중 작성 (Manual Dual-Authoring)
* **증상**: TypeScript 인터페이스를 작성하고, 동일한 데이터 검증을 위해 별도의 Zod 스키마 코드를 개발자가 손으로 따로 작성하는 행위.
* **실패 원인**: 프로젝트가 발전함에 따라 TypeScript 타입과 Zod 스키마 간의 불일치(Drift)가 반드시 발생하며, 이는 런타임에 잡기 어려운 유령 버그를 유발합니다. 또한 Zod 런타임(약 50KB)이 번들에 영구히 남아있게 됩니다.
* **해결책**: TypeSpec을 SSOT로 두어 `oa-gen typegen`으로 순수 TypeScript 타입을 추출하고, 런타임 검증이 필요한 경우 `ttsc`가 그 타입으로부터 AOT Standard Schema를 자동 생성하도록 단일 파이프라인을 구축합니다.

### ❌ 안티패턴 4: TypeSpec에 FSM 상태 전이 다이어그램 인코딩 (FSM Inversion in TypeSpec)
* **증상**: TypeSpec 모델 안에 `@transition("PLAY", "playing")`과 같은 커스텀 데코레이터를 덕지덕지 붙여 상태 머신 그래프를 표현하려는 시도.
* **실패 원인**: TypeSpec의 컴파일러 구조와 OpenAPI 스펙트럼은 요청/응답 지향적입니다. 순환 상태 그래프, 계층적 히스토리 상태, 이벤트 병렬 처리, 액터 라이프사이클을 TypeSpec으로 모델링하면 언어의 표현력을 벗어나 스키마가 극도로 오염되고 다른 도구(Redocly, Spectral)에서 유효성 검증이 실패합니다.
* **해결책**: 상태 머신 토폴로지, 전이 조건, 가드는 **WIREFRAME-BOOK (Behavior IR)**이 소유하고, TypeSpec은 상태 머신이 소비하는 **입출력 데이터의 형태(Shape)**만을 `@actorInput`, `@machineContext`, `@eventPayload` 데코레이터로 제공합니다.

### ❌ 안티패턴 5: API 코드젠에게 DB 변경/마이그레이션 권한 부여 (Bidirectional DB Mutation)
* **증상**: `oa-gen` 명령어가 실행될 때 로컬이나 원격 DB에 직접 접속하여 컬럼을 생성하거나 `ALTER TABLE`을 날리도록 구성하는 행위.
* **실패 원인**: 코드 생성이 일어나는 개발 환경, CI 환경, 배포 환경에서 예측할 수 없는 DB 락 충돌과 마이그레이션 꼬임이 발생하며, 롤백 경로가 상실됩니다.
* **해결책**: `oa-sdk`는 **데이터베이스에 대해 100% 읽기 전용(Read-Only)** 불변식을 지킵니다. DB 변경은 반드시 Atlas 마이그레이션 파이프라인을 통해서만 배포됩니다.

