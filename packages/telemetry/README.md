# @oa-sdk/telemetry

> Design-driven telemetry, tracking symbol registry, XState v5 non-intrusive inspector, and a keyed pseudonymization sanitizer.

소프트웨어 개발 막바지에 로그나 마케팅 추적 코드를 사후에 덕지덕지 붙이는 한계를 극복하고, **기획·도메인 모델링·XState 상태 머신(FSM)·UI 인터랙션 설계 단계부터 추적 심볼(Tracking Symbol)을 체계적으로 식별·할당·전파하는 '설계 주도 텔레메트리(Design-Driven Telemetry)' 표준 패키지**입니다.

## 특징

1. **닫힌 심볼 레지스트리 (Closed Symbol Registry)**:
   - `[Layer]:[Domain]:[Entity]:[Action]:[Aspect]` 정규 문법을 `register()` 시점에 런타임으로 검증합니다 (심볼 타입은 `string`이며 컴파일 타임 검증은 없습니다).
   - strict 레지스트리(기본값)의 `get()`은 미등록 심볼 조회를 예외로 거부합니다. 인스펙터는 `has()`로 먼저 조회하므로 레지스트리의 strict 여부가 머신 동작을 깨뜨리지 않습니다.
2. **비침습 XState v5 인스펙터 (`createTelemetryInspector`)**:
   - 컴포넌트나 상태 머신 내부에 `dataLayer.push`나 `Sentry.captureMessage`를 직접 호출하지 않고, XState v5의 `inspect` 스트림만 관찰해 자동 라우팅합니다. 액터를 구독하지 않으므로 XState의 미처리 에러 보고 방식도 바뀌지 않습니다.
   - 텔레메트리 실패(디스패처 예외, `strictSymbols` 위반, 살균 실패)는 절대 XState로 전파되지 않아 `actor.send()`·`createActor()`를 중단시키지 않습니다. 실패는 `onError`로 전달되며, 지정하지 않으면 XState가 자체 observer 에러를 다루듯 `setTimeout`으로 비동기 재throw됩니다.
   - `xstate.*`가 아닌 모든 이벤트를 수신 액터의 `actorId`와 수신 시점의 `stateNode`와 함께 디스패치합니다. 액터 에러(액션·가드·entry 예외, 자식 액터 실패)는 액터마다 한 번 `dispatchError`로 보고됩니다. 자식 에러가 부모 체인을 타고 올라가 부모까지 실패시키면(처리되지 않았거나, 부모가 그 에러 이벤트를 처리하면서 `sendParent(({ event }) => event)`처럼 위로 전달한 경우), 그 에러는 발생한 자식에 대해 한 번만 보고됩니다. 이 체인 밖의 액터가 같은 에러 객체로 실패하면(캐시된 rejected promise, 공유 abort reason 등) 각각 따로 보고됩니다. 에러를 전달하거나 `xstate.error.actor.*` 이벤트를 직접 보낸 액터는 실행 중이므로 실패로 보고되지 않으며, 그 이벤트가 받는 쪽을 실패시키면 받는 쪽의 에러로 한 번 보고됩니다.
   - 루트 액터는 모든 inspection 이벤트의 `rootId`로 식별하므로, `actor.system.inspect(inspector)`로 `start()` 이후에 연결해도 이벤트와 루트·자식 에러가 보고됩니다. 다만 Span과 자식의 trace id 상속은 액터의 시작(`xstate.init`)을 관찰해야 하므로, 연결 이전에 이미 실행 중이던 액터에는 Span이 없고 그 자식들은 루트와 trace id를 공유하지 않습니다. 전체 계측이 필요하면 `createActor(machine, { inspect })`로 연결하세요.
3. **키 기반 가명화 살균기 (`createDpmTelemetryAdapter`)**:
   - 식별자 키(`userId`, `customerId`, `orderId`, `accountId`, `email`, `phone` 및 `customerEmail` 같은 변형)를 HMAC-SHA-256 기반 결정론적 토큰 `dpm_tok_<entity>_<32 hex>`(128비트)로 치환해 퍼널 연관성을 보존합니다. 토큰은 이벤트 도메인이 아니라 엔티티 종류로 네임스페이스되므로 같은 사용자는 `CART`와 `CHECKOUT` 도메인에서 같은 토큰을 가집니다.
   - 내장 토크나이저는 이 패키지 안의 동기식 HMAC 구현이며 `@oa-sdk/dpm`에 의존하지 않습니다. `@oa-sdk/dpm`의 키 기반 실행기(서버)와 연동하려면 `customTokenizer`를 전달합니다.
   - 공개 기본 솔트는 없습니다. `tokenKey`를 생략하면 인스턴스마다 `crypto.getRandomValues`로 무작위 키를 만들므로 토큰은 해당 어댑터 수명(페이지 로드/프로세스) 동안만 안정적입니다. 브라우저 번들에 포함된 `tokenKey`는 비밀이 아니므로 추측 가능한 값(이메일, 순차 ID)은 사전 공격으로 재식별될 수 있습니다. 실제 PII 보호가 필요하면 서버가 발급한 토큰을 `TelemetryIdentity.pseudonymToken`으로 넘기거나 서버 기반 `customTokenizer`를 사용하세요.
4. **다중 프로바이더 프로젝션 (GTM, Sentry, OpenTelemetry)**:
   - GTM dataLayer: GA4 이벤트명 치환 및 화이트리스트 필터링. `event`, `track_symbol`, `trace_id`, `actor_id`, `state_node`는 페이로드보다 우선하므로 페이로드 필드가 덮어쓸 수 없습니다.
   - Sentry: 디스패치된 이벤트마다 Breadcrumb을 남기고 `setContext('xstate:<actorId>', { stateNode, traceId, lastSymbol })`를 갱신합니다. 액터 에러는 `state_node`·`actor_id`·`trace_id` 태그와 `telemetry_context` extra를 붙여 `captureException`합니다. 머신 Context 스냅샷은 첨부하지 않습니다.
   - OpenTelemetry: `@opentelemetry/api`의 `trace.getTracer()`와 `trace.getActiveSpan()`을 그대로 받습니다(`OtelLikeTracer`·`OtelLikeSpan`은 실제 `Tracer`·`Span`의 상위 타입). `tracer`를 전달하면 인스펙터 연결 후 시작된 액터마다 Span을 하나 만들고(시작되지 않은 액터는 제외) 완료·중지·에러 시 한 번 종료합니다. Span 속성 중 OpenTelemetry가 표현할 수 없는 값(객체, 함수, 타입이 섞인 배열)은 OTel SDK처럼 버립니다. 이벤트는 `getActiveSpan` 옵션이 돌려주는 활성 Span에, 없으면 그 이벤트를 받은 액터 인스턴스의 Span(`xstate.actor.session_id` 속성과 엔벨로프의 `context.actorSessionId`로 식별)에 기록됩니다. `actorId`는 같은 invoke id를 쓰는 모든 인스턴스가 공유하므로 대체 키로 쓰지 않습니다. `dispatchError`는 활성 Span에만 기록하고, 에러로 끝난 액터의 Span은 인스펙터가 종료할 때 에러 상태와 예외를 한 번 기록합니다. `tracer`가 없으면 Span을 만들지 않습니다. W3C `traceparent` 전파는 아직 구현되지 않았습니다.

## PII 등급

| `piiLevel` | 동작 |
| :--- | :--- |
| `none` | 민감 키(`password`, `token`, `secret`, `apiKey`, `cardNumber`, `ssn`, `authorization` 등)만 `***MASKED***`. 나머지는 원본 전달 |
| `masked` | 민감 키와 식별자 키를 모두 `***MASKED***` (이벤트 간 상관관계 없음) |
| `pseudonymized` | 민감 키는 마스킹, 식별자 키는 결정론적 키 기반 토큰으로 치환 (이벤트 간 상관관계 보존) |
| `restricted` | 페이로드 전체 드롭 (이벤트 미디스패치) |

키 매칭은 대소문자와 `-`/`_`를 무시하는 부분 문자열 매칭입니다. `sensitiveKeys`와 `piiKeys` 옵션은 기본값(`DEFAULT_SENSITIVE_KEYS`, `DEFAULT_PII_KEYS`)을 대체하므로, 확장하려면 기본값을 펼쳐 넣으세요. 순환 참조는 `'[Circular]'`, 10단계를 넘는 중첩은 `'[MaxDepth]'`, `toJSON()`이 있는 값(Date, XState 액터 ref)은 그 결과로, 그 밖의 비평범 객체(Map, Set, 클래스 인스턴스)는 `'[ClassName]'`으로 치환됩니다. 전역 identity의 `userId`도 `pseudonymToken`이 없으면 같은 방식(`user` 네임스페이스)으로 토큰화되어 원본이 컨텍스트에 들어가지 않습니다.

## 빠른 시작 (Quick Start)

```typescript
import { setup, createActor } from 'xstate';
import { trace } from '@opentelemetry/api';
import {
  createSymbolRegistry,
  createTelemetryInspector,
  createCompositeDispatcher,
  createGtmDispatcher,
  createSentryDispatcher,
  createOtelDispatcher,
  createDpmTelemetryAdapter,
} from '@oa-sdk/telemetry';

// 1. 심볼 레지스트리 정의
const registry = createSymbolRegistry();
registry.register({
  symbol: 'FSM:AUTH:USER:LOGIN_SUBMITTED',
  description: '사용자 로그인 폼 제출',
  piiLevel: 'pseudonymized', // 식별자 키를 결정론적 토큰으로 치환
  routing: {
    gtm: { eventName: 'login_attempt' },
    sentry: { level: 'info', asBreadcrumb: true },
  },
});

// 2. 다중 프로바이더 디스패처 구성
const dispatcher = createCompositeDispatcher(
  createGtmDispatcher({ whitelistOnly: true }),
  createSentryDispatcher(),
  // tracer가 없으면 OTel 디스패처는 Span을 만들지 않습니다.
  createOtelDispatcher({ tracer: trace.getTracer('app'), getActiveSpan: () => trace.getActiveSpan() }),
);

// 3. 텔레메트리 인스펙터 생성
const telemetryInspector = createTelemetryInspector({
  dispatcher,
  registry,
  // tokenKey를 생략하면 인스턴스별 무작위 키를 사용합니다 (세션 간 토큰 불일치).
  // 번들에 포함된 키는 비밀이 아닙니다: 위 '키 기반 가명화 살균기' 주의사항 참고.
  dpmAdapter: createDpmTelemetryAdapter({ tokenKey: telemetryTokenKey }),
  onError: (error) => console.warn('[telemetry]', error),
});

// 4. XState v5 머신에 비침습 연결
const authActor = createActor(authMachine, {
  inspect: telemetryInspector,
});
authActor.start();
```

`getContext`로 `traceId` 등을 공급할 수 있으며, 값이 `undefined`인 필드는 기본값(생성된 trace id, `actorId`, `stateNode`, identity 토큰)을 지우지 않습니다. `traceId`를 공급하지 않으면 한 액터 시스템(루트와 자식 액터)의 이벤트와 에러가 하나의 생성된 W3C trace id를 공유합니다.
