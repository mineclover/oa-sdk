# @oa-sdk/telemetry

> Design-driven telemetry, tracking symbol registry, XState v5 non-intrusive inspector, and DPM pseudonymization bridge.

소프트웨어 개발 막바지에 로그나 마케팅 추적 코드를 사후에 덕지덕지 붙이는 한계를 극복하고, **기획·도메인 모델링·XState 상태 머신(FSM)·UI 인터랙션 설계 단계부터 추적 심볼(Tracking Symbol)을 체계적으로 식별·할당·전파하는 '설계 주도 텔레메트리(Design-Driven Telemetry)' 표준 패키지**입니다.

## 특징

1. **닫힌 심볼 레지스트리 (Closed Symbol Registry)**:
   - `[Layer]:[Domain]:[Entity]:[Action]:[Aspect]` 정규 문법 검증.
   - 컴파일 타임 검증 및 미등록 심볼 차단 (엄격한 거버넌스).
2. **비침습 XState v5 인스펙터 (`createTelemetryInspector`)**:
   - 컴포넌트나 상태 머신 내부에 `dataLayer.push`나 `Sentry.captureMessage`를 직접 호출하지 않고, XState v5의 `inspect` 라이프사이클을 통해 단일 진실 공급원(SSOT)에서 자동 라우팅.
3. **DPM 관계 보존 가명화 브릿지 (`createDpmTelemetryAdapter`)**:
   - 단순 마스킹(`***`)으로 인한 유저 여정/퍼널 단절을 극복하고, `@oa-sdk/dpm`의 결정론적 가명화(Deterministic Pseudonymization Token)를 통해 PII를 원천 보호하면서도 E2E 연관성 보존.
4. **다중 프로바이더 프로젝션 (GTM, Sentry, OpenTelemetry)**:
   - GTM dataLayer: GA4 규격 치환 및 화이트리스트 필터링.
   - Sentry: 상태 전이 자동 Breadcrumb, 에러 상태 시 머신 Context 스냅샷 자동 첨부.
   - OpenTelemetry: 비동기 액터(Promise/Child Actor)의 Span 자동 생성 및 완료 계측.

## 빠른 시작 (Quick Start)

```typescript
import { setup, createActor } from 'xstate';
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
  piiLevel: 'pseudonymized', // DPM 가명화 대상
  routing: {
    gtm: { eventName: 'login_attempt' },
    sentry: { level: 'info', asBreadcrumb: true },
  },
});

// 2. 다중 프로바이더 디스패처 구성
const dispatcher = createCompositeDispatcher(
  createGtmDispatcher({ whitelistOnly: true }),
  createSentryDispatcher(),
  createOtelDispatcher(),
);

// 3. 텔레메트리 인스펙터 생성
const telemetryInspector = createTelemetryInspector({
  dispatcher,
  registry,
  dpmAdapter: createDpmTelemetryAdapter({ tokenKey: 'app-secret-salt' }),
});

// 4. XState v5 머신에 비침습 연결
const authActor = createActor(authMachine, {
  inspect: telemetryInspector,
});
authActor.start();
```
