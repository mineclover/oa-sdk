# 팝업 브리지 (Popup Bridge) 사용 가이드

`@oa-sdk/popup-bridge`는 별도 도메인에 배포된 팝업 웹 애플리케이션을 Host 웹에서 URL로 열고, 초기화가 끝난 뒤 양방향 RPC와 이벤트로 기능을 주고받는 프로토콜과 어댑터입니다. 이 문서는 선언 규약(타입), RPC 생성 유틸리티 규격, 와이어 규격을 정리합니다.

> 비공개 워크스페이스 패키지(`private: true`)입니다. 의존성이 없고, 프로토콜 코어는 브라우저 API에 의존하지 않습니다. 창 접근은 `HostEnvironment` / `PopupEnvironment` 어댑터를 거치므로 iframe·확장·데스크톱 셸은 어댑터만 바꿔 재사용합니다.

## 1. 구성

| 진입점 | 내용 |
| --- | --- |
| `@oa-sdk/popup-bridge` | 프로토콜(오류·버전·메시지), 계약 선언(`defineContract`, `method`, `event`, `definePopup`), RPC 생성 유틸리티(`createRpcApi`, `createMethodCaller`, `HandlerRegistry`, `describeContract`), 대칭 RPC 엔드포인트(`createRpcEndpoint`), 채널(`fromMessagePort`) |
| `@oa-sdk/popup-bridge/host` | `createPopupBridge().open(definition, options)` → `PopupSession` |
| `@oa-sdk/popup-bridge/popup` | `createPopupRuntime({ contract, allowedHostOrigins })` |
| `@oa-sdk/popup-bridge/testing` | 브라우저 없이 Host·Popup·reload·close·차단을 재현하는 `createMemoryBrowser()` |

```text
Host                                              Popup (다른 Origin)
 bridge.open(def) ── window.open(url#oaBridgeSession=ID) ─▶ 페이지 부팅
        ◀──────────── bridge.hello  (sessionId, instanceId, protocolVersions)
 origin·source·session 검증, 버전 협상
        ── bridge.connect (init) + MessagePort ───────────▶ 검증, init 검증, onInit
        ◀──────────── bridge.ready  (capabilities) ── 이후 JSON-RPC는 모두 Port로
 open() 완료 (READY)
```

## 2. 타입 선언 규약

한 기능은 `defineContract` 값 하나로 선언합니다. Host와 Popup 양쪽의 타입이 이 값에서 파생되므로 메서드 이름·입출력은 한 곳에서만 고칩니다.

```ts
import { defineContract, definePopup, event, method } from '@oa-sdk/popup-bridge'

export const assetContract = defineContract({
  id: 'asset-selector',
  init: parseInit,                                 // 선택: bridge.connect의 init 검증
  methods: {                                       // Popup이 구현, Host가 호출
    'asset.select': method<{ multiple?: boolean }, { assetIds: string[] }>({ version: '1.0.0', permission: 'assets:read' }),
    'asset.getSnapshot': method<void, { revision: number; assetIds: string[] }>(),
  },
  events: {                                        // Popup이 발행, Host가 구독
    'asset.selectionChanged': event<{ assetIds: string[] }>(),
  },
  host: {                                          // Host가 노출, Popup이 호출(역방향)
    'host.document.getSelection': method<void, { text: string }>(),
  },
})

export const assetSelector = definePopup(assetContract, { url: 'https://tools.example.com/asset-selector' })
```

### 규칙

| 항목 | 규약 |
| --- | --- |
| 이름 | `네임스페이스.동사` 이상의 점으로 구분된 lowerCamelCase (`asset.select`, `host.document.getSelection`). 정규식 `^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$` |
| 예약어 | `bridge.` 접두사는 프로토콜 전용입니다. 계약에서 쓰면 `defineContract`가 던집니다 |
| 네임스페이스 | 한 이름이 다른 이름의 접두사일 수 없습니다 (`asset`과 `asset.select` 동시 선언 불가). 점 경로가 중첩 클라이언트의 경로이기 때문입니다 |
| 이벤트 | 일어난 일로 짓습니다(`asset.selectionChanged`). 메서드는 동사로 시작합니다 |
| 입력 | 이름 있는 필드의 객체 또는 `void`. 위치 인자는 쓰지 않습니다. 선택 필드만 있으면 `params`를 생략할 수 있습니다 |
| 출력 | JSON/structured clone 가능한 값. `void` 메서드는 와이어에서 `null`로 도착하므로 값을 쓰지 않습니다 |
| 버전 | 메서드·이벤트마다 `major.minor.patch`. 하위 호환이 깨지면 major를 올립니다. Host는 `^1.0.0` 같은 범위로 요구합니다 |
| 스키마 | 선택. `{ parse(value) }`(Zod 등) 또는 `(value) => T`(typia assert, 직접 작성한 가드) 모두 됩니다. 스키마가 있으면 호출 측과 수신 측이 각자 검증합니다 |
| 호출 옵션 | `timeoutMs`(메서드 선언 < 세션 기본 < 호출별), `signal`, `idempotencyKey` |

타입은 `method<I, O>()`의 제네릭 또는 스키마에서 추론됩니다. 제네릭만 쓰면 런타임 검증이 없으므로 신뢰할 수 없는 쪽(Host가 받는 Popup 응답, Popup이 받는 Host 요청)에는 스키마를 권장합니다.

## 3. RPC 생성 유틸리티 규격

| 유틸리티 | 입력 | 출력 | 역할 |
| --- | --- | --- | --- |
| `createRpcApi(methods, call)` | 메서드 맵, `call` | 점 경로를 따르는 중첩 객체 | `api.asset.select(params, options)`. `Proxy`를 쓰지 않는 평범한 객체라 `await api`가 안전합니다 |
| `createMethodCaller(methods, invoke, options)` | 메서드 맵, 전송 함수 | `call(name, params, options)` | 입력 검증 → 타임아웃 결정 → 전송 → 결과 검증. 계약에 없는 이름은 `METHOD_NOT_FOUND` |
| `HandlerRegistry` | 메서드 맵 | `register` · `implement` · `resolve` · `capabilities()` · `missing()` | 핸들러를 이름 기준 플랫 맵으로 등록합니다. 등록된 것만 capability로 광고합니다 |
| `createRpcEndpoint({ channel, resolve, guard })` | `RpcChannel` | `call` · `notify` · `close` | 양쪽이 같은 엔드포인트를 씁니다. 취소·타임아웃·멱등성 포함 |
| `describeContract(contract)` | 계약 | 직렬화 가능한 매니페스트 | 스키마·함수 없이 이름·버전·권한만 담습니다 (배포용 capability 목록) |

핸들러는 `postMessage`/`MessagePort`를 만지지 않습니다.

```ts
runtime.implement({
  'asset.select': async (params, ctx) => pickAssets(params, ctx.signal),
  'asset.getSnapshot': () => store.snapshot(),
})
```

`implement`와 `register(name, handler)`는 계약 이름만 받고, 계약 없이 쓰는 자유 형식은 `registerFeature({ name, version, input, output, handler })`입니다.

## 4. 와이어 규격

### 4.1 부트스트랩 (`window.postMessage`, Origin·Source 검증)

| 메시지 | 방향 | 필드 |
| --- | --- | --- |
| `bridge.hello` | Popup → Host | `sessionId`, `instanceId`, `protocolVersions`(최대 64개), `features?` |
| `bridge.connect` | Host → Popup (+ `MessageChannel.port2`) | `sessionId`, `instanceId`, `protocolVersion`, `init`, `features?` |
| `bridge.reject` | Host → Popup | `sessionId`, `instanceId`, `error` |

세션 ID는 URL fragment(`#oaBridgeSession=…`)로 전달합니다. 서버로 전송되지 않고, 상관 관계용 값일 뿐 권한을 주지 않습니다. `instanceId`는 페이지 로드마다 새로 발급되어 새로고침을 구분합니다. Popup은 `allowedHostOrigins`의 각 Origin으로 HELLO를 보냅니다(브라우저가 일치하지 않는 Origin에는 전달하지 않습니다).

### 4.2 제어 메시지 (Port)

`bridge.ready`(`capabilities`, `features?`), `bridge.init-failed`(`error`), `bridge.close`(`reason`: `host-close` · `popup-close` · `unload` · `error`). 모든 제어 메시지는 `kind`를 가지며 JSON-RPC 메시지와 같은 Port를 공유합니다.

### 4.3 JSON-RPC 2.0 (Port)

요청·응답·알림은 JSON-RPC 2.0 형식입니다. 확장은 두 가지입니다.

- 요청의 최상위 `meta: { idempotencyKey }`
- 알림 `bridge.cancel { id }`: 호출 취소·타임아웃을 상대 핸들러(`ctx.signal`)에 전달합니다

예약 메서드: `bridge.ping`, `bridge.subscribe { events }` → `{ revisions, epoch? }`, `bridge.unsubscribe { events }`, `bridge.replay { name, since }` → `{ epoch, revision, oldest, capacity, entries }`(`events.replay` 합의 시에만), 알림 `bridge.event { name, revision, payload, coalesced? }`. `epoch`는 팝업 런타임 하나를 가리키는 값이고, `coalesced`는 한 이벤트가 합친 발행 수입니다(2 이상일 때만). 자세한 동작은 10장을 봅니다.

창 네트워크 확장(9장): `bridge.attention { id, intent?, effects?, title?, message?, urgency? }` → 결과, 알림 `bridge.attention.ack { id }`, `bridge.topology { depth? }` → 이웃 트리, `bridge.state.subscribe { name }` → `{ revision, value }`, `bridge.state.unsubscribe { name }`, `bridge.state.set { name, value, baseRevision? }`, 알림 `bridge.state.changed { name, revision, value }`. 어느 쪽이든 상대가 구현한 것만 응답하고, 없으면 `METHOD_NOT_FOUND`입니다.

### 4.4 오류 코드

오류는 JSON-RPC `error`로 오가며 문자열 코드가 `error.data.code`에 담깁니다.

| 코드 | 상황 |
| --- | --- |
| `POPUP_BLOCKED` | 브라우저가 팝업을 차단. `open()`을 클릭 핸들러에서 `await` 없이 호출해야 합니다 |
| `HANDSHAKE_TIMEOUT` | HELLO 또는 READY가 제한 시간(기본 15초) 안에 오지 않음 |
| `ORIGIN_MISMATCH` | 팝업이 `expectedOrigin`이 아닌 Origin에서 응답. 보안 이벤트도 남깁니다 |
| `PROTOCOL_INCOMPATIBLE` | 공통 프로토콜 버전 없음. `data`에 양쪽 목록 |
| `INIT_INVALID` | `init` 스키마 또는 `onInit` 실패 |
| `CAPABILITY_UNAVAILABLE` | 필수 capability 누락·버전 불일치, 계약에 없는 이벤트 구독 |
| `PERMISSION_DENIED` | `authorize` 훅이 거부 |
| `RPC_TIMEOUT` | 응답 지연 (기본 30초). 키 없는 호출은 상대에 `bridge.cancel`을 보냅니다 |
| `SESSION_CLOSED` | 세션 종료·팝업 새로고침으로 미완료 호출 실패 |
| `SESSION_NOT_READY` | READY 이전·재연결 중 호출 |
| `METHOD_NOT_FOUND` · `INVALID_PARAMS` · `INVALID_RESULT` · `INVALID_REQUEST` · `INTERNAL` | JSON-RPC 표준 범위. `INTERNAL`의 메시지는 일반 문구로 바꿔 내부 정보를 노출하지 않습니다 |
| `CANCELLED` · `IDEMPOTENCY_CONFLICT` · `HOST_UNAVAILABLE` | 취소, 같은 키에 다른 params, opener 없이 열린 페이지 |
| `NOT_CLONEABLE` | params·결과·이벤트 payload에 복제할 수 없는 값(함수 등)이 있거나 transfer 목록이 잘못됨. 호출자·발행자에게 그대로 전달됩니다 |
| `PEER_UNRESPONSIVE` | 하트비트에 제한 시간 안에 응답하지 않음 (페이지 멈춤·정지). 대기 중 호출이 즉시 이 코드로 실패합니다 |
| `OVERLOADED` | 동시 처리 한도(`limits.maxInflight`)를 넘은 요청 |
| `STATE_CONFLICT` | 공유 상태 쓰기의 `baseRevision`이 소유자의 현재 revision과 다름. `data`에 `{ revision, value }` |

## 5. 사용 예

Host:

```ts
import { createPopupBridge } from '@oa-sdk/popup-bridge/host'

const bridge = createPopupBridge()

button.onclick = async () => {                       // 사용자 클릭 안에서 await 이전에 호출
  const popup = await bridge.open(assetSelector, {
    init: { documentId: 'doc-123', locale: 'ko-KR' },
    host: { 'host.document.getSelection': () => ({ text: editor.selectedText() }) },
    authorize: ({ permission }) => permission !== 'document:write',
  })
  const { assetIds } = await popup.api.asset.select({ multiple: false })
  const off = await popup.subscribe('asset.selectionChanged', (payload, meta) => {
    if (meta.gap) refreshFrom(popup)                 // 누락 의심 → 스냅샷 재조회
  })
  popup.on('reconnect', () => refreshFrom(popup))    // 팝업 새로고침 후 재동기화
  await popup.close()
}
```

Popup:

```ts
import { createPopupRuntime } from '@oa-sdk/popup-bridge/popup'

const runtime = createPopupRuntime({
  contract: assetContract,
  allowedHostOrigins: ['https://app.example.com'],
  onInit: init => store.load(init.documentId),
})
runtime.implement({ 'asset.select': pick, 'asset.getSnapshot': () => store.snapshot() })
await runtime.start()                                // 핸들러 등록 후 시작
store.onChange(ids => runtime.emit('asset.selectionChanged', { assetIds: ids }))
const { text } = await runtime.host.call('host.document.getSelection')
```

## 6. 상태·수명 주기

Host: `CREATED → OPENING → WAITING_HELLO → CONNECTING → INITIALIZING → READY → CLOSING → CLOSED` (READY 이전 실패는 `FAILED`). Popup: `BOOTING → WAITING_CONNECT → INITIALIZING → READY`.

- READY 이전의 기능 호출은 양쪽에서 `SESSION_NOT_READY`입니다.
- 팝업 새로고침: `pagehide`의 `bridge.close(unload)` 또는 새 `instanceId`의 HELLO로 감지합니다. 이전 Port를 닫고 진행 중 호출을 `SESSION_CLOSED`로 실패시킨 뒤 같은 `init`으로 다시 연결하며, 이벤트 구독은 자동 복원되고 revision은 새로 시작합니다. 완료되면 `reconnect` 이벤트가 발생합니다. 제한 시간 안에 HELLO가 없으면 세션이 종료됩니다(`allowReconnect: false`면 즉시 종료).
- 창 닫힘은 Host가 `closed`를 폴링해(기본 500ms) 감지하고 `window-closed`로 종료합니다.
- Host 새로고침은 v0.1에서 자동 복구하지 않습니다. Host는 `pagehide`에서 `host-close`를 보내고, Popup은 `onClose`로 연결 해제를 표시합니다.
- 하트비트: READY 동안 Host가 `bridge.ping`을 주기적으로 보냅니다(`heartbeat.intervalMs` 기본 5초, `timeoutMs` 기본 10초). 응답이 늦으면 `session.health`가 `unresponsive`가 되고 `health` 이벤트가 나가며, 제한 시간을 넘기면 세션을 `PEER_UNRESPONSIVE`로 종료해 대기 중 호출이 30초를 기다리지 않고 바로 실패합니다. `heartbeat: false`로 끕니다. Host와 Popup이 같은 렌더러 프로세스를 공유하면(같은 사이트 등) 멈춘 팝업이 Host의 타이머까지 막으므로 탐지가 늦어질 수 있습니다.
- 복원(bfcache): `pageshow`의 `persisted`로 복원되면 Popup 런타임이 새 `instanceId`로 다시 HELLO를 보내 재연결하고 `runtime.onReconnect`를 호출합니다. Chromium은 `opener`가 있는 페이지를 bfcache에 넣지 않으므로 이 경로는 다른 엔진을 위한 방어적 처리이며 메모리 브라우저(`freeze()`/`restore()`)로만 검증했습니다.
- 수신 한도: `limits`(기본 `maxInflight` 256, `maxNotificationsPerSecond` 5 000)로 덜 신뢰하는 쪽이 일으키는 부하를 막습니다. 초과 요청은 `OVERLOADED`, 초과 알림은 버려지며(이벤트 revision에 gap이 생깁니다) `onSecurityEvent`에 `rate-limited`가 한 번 보고됩니다. `bridge.cancel`은 제한하지 않습니다.
- 대용량 전송: `call(name, params, { transfer: [buffer] })`, 핸들러는 `withTransfer(result, [buffer])`, 이벤트는 `emit(name, payload, { transfer })`로 `ArrayBuffer`를 복사 없이 넘깁니다. 보낸 쪽 버퍼는 detach됩니다. `idempotencyKey`가 있는 호출의 결과는 재시도 응답을 위해 복제됩니다. Node 프로세스 내 측정에서 64MB 기준 복제 약 40ms, 전송 약 0.6ms였습니다.
- 멱등성: 같은 `idempotencyKey`의 재시도는 한 번만 실행되고 진행 중이면 같은 결과를 공유합니다. 성공 결과만 저장하며, 실패·취소한 시도는 다시 실행됩니다. 같은 키에 다른 params는 `IDEMPOTENCY_CONFLICT`입니다. 응답 누락으로 타임아웃된 키 있는 호출은 상대 실행을 취소하지 않으므로 재시도가 합류합니다.

## 7. 보안 요약

- Host: `event.source === popupWindow` 와 `event.origin === expectedOrigin` 을 확인합니다. 그 Origin이 아닌 HELLO는 거부하고 `onSecurityEvent`에 남깁니다.
- Popup: `event.source === opener`, `allowedHostOrigins`, `sessionId`, `instanceId`를 확인합니다. `*`는 허용하지 않습니다.
- 모든 `postMessage`는 정확한 `targetOrigin`을 지정합니다. Port 이후 메시지는 부트스트랩에서 세운 신뢰에 기대므로, 요청마다 `authorize`와 스키마로 권한·형식을 확인합니다.
- Host가 노출한 메서드만 Popup이 호출할 수 있습니다(`host` 옵션). 노출하지 않은 이름은 `METHOD_NOT_FOUND`입니다.
- URL에는 토큰·업무 데이터를 넣지 않습니다(세션 ID만 fragment로). 대용량 데이터는 ID·참조로 전달합니다.
- Host가 `Cross-Origin-Opener-Policy: same-origin`이면 `window.opener` 참조가 끊겨 이 직접 연결은 동작하지 않습니다. 이 경우 서버 중계 방식이 별도로 필요하며 이 패키지의 범위가 아닙니다.

## 8. 테스트

메모리 브라우저(빠른 단위·통합)와 실제 Chromium E2E를 함께 씁니다.

```ts
import { createMemoryBrowser } from '@oa-sdk/popup-bridge/testing'

const browser = createMemoryBrowser()
browser.onPopupLoad(page => { /* createPopupRuntime({ env: page.env, ... }).start() */ })
const bridge = createPopupBridge({ env: browser.hostEnv })
browser.popups[0].reload()    // 새로고침
browser.popups[0].close()     // 사용자가 창을 닫음
browser.blockPopups = true    // 팝업 차단
```

`createMemoryBrowser`는 비동기 `postMessage`, `targetOrigin` 필터, 전송된 Port, `event.origin`/`event.source`를 재현합니다. COOP 같은 브라우저 정책은 재현하지 않습니다.

실제 브라우저 E2E는 `packages/popup-bridge/e2e`에 있고 `corepack pnpm --filter @oa-sdk/popup-bridge test:e2e`로 실행합니다. `playwright-core`와 그 버전이 요구하는 Chromium 리비전(`npx playwright-core install chromium`)이 필요하며, 기본 `test`/CI 대상에는 포함되지 않습니다. 하네스는 호스트(`localhost`), 팝업(`127.0.0.1:A`), 위장 팝업(`127.0.0.1:B`) 세 Origin을 띄우고 `--site-per-process`로 Host와 Popup을 서로 다른 렌더러 프로세스에 둡니다. 확인하는 것은 다음과 같습니다.

| 시나리오 | 결과 |
| --- | --- |
| 교차 Origin 열기, 양방향 RPC, 이벤트·revision | READY 후 정상 |
| 느린 팝업 로딩 | 핸드셰이크 유지 |
| 다른 Origin이 응답 | `ORIGIN_MISMATCH` + 보안 이벤트 |
| 팝업이 허용하지 않은 Host Origin | 연결되지 않음 (`HANDSHAKE_TIMEOUT`) |
| 팝업 `init` 거부 · 필수 capability 누락 | `INIT_INVALID` · `CAPABILITY_UNAVAILABLE` |
| 팝업 새로고침 | 진행 중 호출 `SESSION_CLOSED`, 재연결, 구독 복원 |
| 사용자가 팝업 닫기 | `window-closed`, 미완료 호출 정리 |
| Host `close()` · Host 새로고침 | 팝업이 `host-close`를 받음 (`bridge.close`가 Port를 통과, `pagehide` 알림 도달) |
| 동시 팝업 2개 | 세션·이벤트가 섞이지 않음 |
| 16MB 버퍼 업로드·다운로드 | transfer로 전달, 보낸 버퍼 detach |
| 결과에 함수 포함 | `NOT_CLONEABLE` |
| 팝업 페이지가 멈춤 (메인 스레드 점유) | 하트비트로 `PEER_UNRESPONSIVE`, 대기 호출 즉시 실패 |
| 이벤트 폭주 (Host 속도 한도) | 한도만큼만 전달, `rate-limited` 보고 |
| Host가 COOP `same-origin` | 팝업은 `HOST_UNAVAILABLE`, 연결 불가 |
| 팝업이 팝업을 엶 (Host → A → B, Origin 3개) | A는 Host의 팝업이면서 B의 Host. 두 이웃이 한 노드를 공유 |
| B가 Host인 A에 주의 요청 | A 탭 제목이 `● 제목`과 원래 제목으로 번갈아 바뀌고, 돌아오면 멈추며 B가 확인(ack)을 받음 |
| A가 B에 `return` 요청 | B가 `window.focus()`를 호출하고, 브라우저가 올리지 않으면 `focusObserved: false`와 제목 점멸로 대체 |
| 세 Origin 사이의 `focus()` | B→A, A→B, A→Host 모두 교차 Origin 오류 없이 호출됨 |
| 알림 권한이 있는 Host에 `input-needed` | `notification` 효과 적용 (헤드리스에서는 Notification API를 대역으로 대체) |
| 루트에서 트리 조회 | Host → A → B 전체와 각 `peerOrigin`, B는 Host를 통해 형제를 조회 |
| 공유 상태 | Host가 소유하고 A가 쓰기, A가 소유하고 B가 따라감 |
| B 닫기 | A의 노드에서 링크가 사라짐 |

팝업 차단은 Playwright가 `--disable-popup-blocking`으로 실행하므로 E2E에서 재현하지 못합니다. 메모리 브라우저 테스트가 `POPUP_BLOCKED`를 다룹니다.

## 9. 창 네트워크: 노드, 주의 요청, 공유 상태

팝업이 다시 팝업을 여는 구조(Host → A → B)에서 A는 Host의 팝업이면서 B의 Host입니다. 이때 두 이웃을 같은 방식으로 다루려고 페이지마다 노드 하나를 둡니다.

```ts
import { createBridgeNode } from '@oa-sdk/popup-bridge'

// 페이지 A: Host의 팝업이면서 B의 Host
const node = createBridgeNode({ name: 'a', topology: true, attention: { onAttention: showToast } })
const runtime = createPopupRuntime({ contract, allowedHostOrigins: [hostOrigin], node })
const bridge = createPopupBridge({ node })
```

노드는 이 페이지의 주의 정책, 점검 스트림, 공유 상태를 가지고, 이웃을 `PeerLink`로 보여줍니다. 링크는 어느 쪽에서 보든 같은 표면입니다: `role`(`host` 또는 `popup`), `sessionId`, `peerOrigin`, `status`, `attention`, `replicate()`, `call()`. Host의 세션은 `session.link`와 `session.attention`, 팝업은 `runtime.link`와 `runtime.host.attention`입니다. 노드를 넘기지 않아도 `focus()`와 주의 요청 보내기는 동작하고, 받으려면 노드에 `attention`이 있어야 합니다.

### 9.1 주의 요청 (HostAttention)

한 창이 상대 창에 "사용자가 봐야 할 일이 있다"고 알리는 표준 인터페이스입니다. **보내는 쪽은 무슨 일인지(`intent`)만 말하고, 어떻게 보여줄지는 받는 쪽 정책이 정합니다.** 받는 쪽만 자기 페이지가 앞에 있는지, 알림 권한이 있는지, 포커스 가로채기를 어디까지 허용할지 알기 때문입니다.

```ts
// B → 자신의 Host A: 입력을 기다리는 중
const { result, acknowledged } = await runtime.host.attention.requestAndWait({
  intent: 'input-needed', title: '파일을 골라 주세요', message: '팝업이 기다리고 있습니다',
})

// A → 자신이 연 B: 돌아와 달라는 요청
const result = await session.attention.request({ intent: 'return' })
if (result.focusObserved === false) { /* 브라우저가 창을 올리지 않음: 제목 점멸로 대체됨 */ }
```

| `intent` | 기본 효과 |
| --- | --- |
| `info` · `completed` | `toast`, `blink` (`urgency: 'high'`면 `notification`도) |
| `input-needed` | `toast`, `blink`, `notification` |
| `return` | `focus`, `blink` |

효과는 `focus`(창 올리기 시도), `blink`(탭 제목 번갈아 바꾸기와 파비콘 표시), `notification`(시스템 알림, 권한이 있을 때만), `toast`(페이지 자체 UI, `onAttention` 콜백)입니다. 보내는 쪽이 `effects`로 희망 효과를 줄 수 있지만 받는 쪽 `allow`와의 교집합만 적용됩니다. 받는 쪽은 현재 상태로 한 번 더 거릅니다.

| 받는 페이지 상태 | 동작 |
| --- | --- |
| 앞에 있음 (`focused`) | `toast`만. 점멸·알림·포커스는 `not-needed`로 건너뛰고 즉시 확인(ack) 처리 |
| 보이지만 포커스 없음 (`visible`) | `blink`, `focus`, `notification` 모두 가능 |
| 숨겨짐 (`hidden`, 다른 탭) | 같음. 점멸은 사용자가 돌아와 포커스·표시 상태가 될 때까지 계속되고 그때 멈춥니다 |

결과는 `{ accepted, appliedEffects, skipped[{ effect, reason }], focusObserved?, visibility?, reason? }`입니다. 거부(`denied`), 한도 초과(`rate-limited`), 상대가 구현하지 않음(`unsupported`)은 예외가 아니라 `accepted: false`로 돌아옵니다. 잘못된 형식만 `INVALID_PARAMS`입니다. 사용자가 돌아오면 받는 쪽이 `bridge.attention.ack`를 보내므로 `requestAndWait`가 `acknowledged: true`로 끝나고, `onAcknowledge`로 계속 구독할 수도 있습니다.

받는 쪽 정책(`createBridgeNode({ attention })` 또는 `createAttentionManager`):

| 옵션 | 기본 | 의미 |
| --- | --- | --- |
| `allow` | 전부 | 상대가 일으킬 수 있는 효과 |
| `authorize(request, source)` | 허용 | 링크별로 요청 자체를 거부 |
| `select(request, { visibility, defaults })` | — | 기본 효과 선택을 대체 |
| `minIntervalMs` | 1 000 | 같은 효과가 이 간격 안에 다시 일어나지 않음 |
| `maxRequestsPerMinute` | 30 | 모든 상대를 합친 분당 요청 수 |
| `blinkIntervalMs` · `focusSettleMs` | 1 000 · 100 | 점멸 주기, `focus` 뒤 결과를 읽기까지 대기 |
| `onAttention` | — | `toast` 효과가 부르는 페이지 자체 UI |

상대가 보낸 제목은 120자, 메시지는 500자로 잘라 표시합니다.

**창 올리기(`focus()`)는 요청과 별개입니다.** `link.attention.focus()`는 상대 창 핸들의 `focus()`를 이 창에서 직접 부르므로 상대 페이지를 거치지 않고, 클릭 핸들러 안에서 부르면 사용자 제스처가 유지되어 가장 성공하기 쉽습니다(`window.opener.focus()`와 `popup.focus()`는 교차 Origin에서도 허용되는 호출입니다). 반면 `request({ intent: 'return' })`는 상대 페이지가 스스로 `window.focus()`를 시도하게 하는 것이라 제스처가 없어 거절될 가능성이 높고, 그 경우 `focusObserved: false`로 알려 준 뒤 점멸로 대체합니다. 사용자 버튼 → `focus()`, 사용자 없는 알림 → `request()`로 나눠 쓰세요.

한계: OS 작업 표시줄이나 브라우저 탭 자체의 깜빡임은 브라우저·OS가 정하므로 보장하지 않으며, 점멸은 탭 제목과 파비콘을 바꾸는 것입니다. 백그라운드 탭은 타이머가 제한되어 점멸 간격이 정확하지 않을 수 있습니다. 시스템 알림은 받는 페이지의 Origin이 `Notification.requestPermission()`을 사용자 클릭 안에서 이미 받아 둬야 하고, 없으면 `notification`은 `unsupported`로 건너뜁니다.

### 9.2 이웃 조회와 점검

- `node.links`: 아직 끝나지 않은 링크(Host와 열어 둔 팝업). 팝업이 닫히면 목록에서 빠집니다.
- `node.topology({ depth })` 또는 `link.call('bridge.topology', { depth })`: 이웃의 트리를 돌려줍니다. 아래 방향(자기가 연 팝업)으로만 내려가고 묻는 쪽으로는 되돌아가지 않으므로, B는 Host A에게 물어 A의 다른 팝업(형제)을 알 수 있습니다. 이웃의 Origin을 드러내므로 상대에게는 **기본 비공개**이고 `createBridgeNode({ topology: true })` 또는 링크별 함수로 열어야 합니다. 상대가 보낸 트리는 깊이·개수·길이를 제한해 정제합니다.
- `node.inspect()`: 링크 상태, 건강 상태, 진행 중 호출 수, 최근 이벤트를 담은 직렬화 가능한 스냅샷(시각화·디버그 패널용). `node.onTrace(listener)`: 링크 상태 변화, 호출(방향·메서드·소요 시간·오류 코드), 알림, 주의 요청, 보안 이벤트, 상태 변경을 실시간으로 받습니다. 기록은 `traceBuffer`(기본 200)개만 보관하고, `bridge.ping`은 기록하지 않으며, 관찰자의 예외는 브리지에 영향을 주지 않습니다.

### 9.3 공유 상태

한 페이지가 이름 붙은 값의 원본을 소유하고, 링크로 연결된 창이 실시간 복제본을 가집니다. 모든 변경은 revision이 붙은 **전체 스냅샷**으로 전달되므로 놓치거나 재연결한 복제본은 다음 변경이나 재동기화로 따라잡고 병합할 필요가 없습니다.

```ts
const selection = defineSharedState<{ ids: string[] }>({ name: 'document.selection', initial: { ids: [] }, writable: true })

// 소유자(어느 쪽 페이지든)
const owned = node.state.own(selection)      // get / set / update / onChange / subscribers
owned.set({ ids: ['a1'] })

// 복제본(링크 반대편)
const replica = link.replicate(selection)    // status / ready / get / onChange / set / update
await replica.ready                          // 첫 스냅샷, 소유하지 않은 상대면 CAPABILITY_UNAVAILABLE로 거부
await replica.update(current => ({ ids: [...current.ids, 'a2'] }))   // 충돌 시 소유자의 최신 값으로 재시도
```

- 이름은 메서드·이벤트와 같은 규약(`namespace.name`, `bridge.` 예약)입니다. 값은 복제 가능해야 하며(`NOT_CLONEABLE`), `schema`가 있으면 소유자가 커밋하는 값과 복제본이 받는 스냅샷을 모두 검증합니다.
- 복제본은 기본적으로 읽기 전용입니다. `writable: true`여야 `set`을 제안할 수 있고, 소유자가 검증한 뒤 커밋합니다. `baseRevision`을 주면 그 사이 바뀌었을 때 `STATE_CONFLICT`(`data`에 최신 `{ revision, value }`)로 거부합니다. 소유자는 `authorize('read' | 'write', link)`로 링크별 접근을 제한합니다.
- 팝업이 새로고침되면 복제본은 다시 구독하고, 소유자가 다시 시작해 revision이 낮아져도 새 구독의 스냅샷을 그대로 받아들입니다. 링크가 끝나면 소유자 쪽 구독자도 정리됩니다.
- 한 이름은 노드당 한 번만 소유할 수 있습니다. 중계가 필요하면 중간 페이지가 위쪽 복제본을 받아 자기 소유 상태로 다시 `set`합니다(Host → A → B).

## 10. 기능 협상, 이벤트 재전송·합치기, 재연결 백오프

프로토콜 버전(`1.0`)은 어떤 메시지가 있는지를 정하고, **기능(feature)** 은 그 위에 얹는 선택 동작을 정합니다. 기능을 모르는 상대와도 그대로 연결되어야 하므로 양쪽이 서로 제공하는 기능의 교집합만 씁니다.

### 10.1 기능 협상

```text
Popup  HELLO{ features: 팝업 제공 }
Host   CONNECT{ features: 호스트 제공 ∩ 팝업 제공 }
Popup  실제 사용 = 팝업 제공 ∩ CONNECT.features        READY{ features: 실제 사용 }
Host   실제 사용 = (호스트 제공 ∩ 팝업 제공) ∩ READY.features
```

- 기본 제공은 `DEFAULT_FEATURES`(`events.replay`, `events.coalesce`)입니다. Host는 `open(def, { features })`, Popup은 `createPopupRuntime({ features })`로 바꾸며 `[]`면 기능을 모르는 상대와 똑같이 동작합니다. 잘못된 id는 창을 열기 전에(Popup은 런타임을 만들 때) `TypeError`입니다.
- id는 `lowerCamel`을 `.` 또는 `-`로 이은 이름(최대 64자)입니다. 앱 고유 기능은 `x.` 접두를 씁니다(`isFeatureId`, `assertFeatureIds`).
- `features` 멤버가 없거나 배열이 아니면 "제공 없음"으로 읽고 연결은 거절하지 않습니다. 목록은 앞쪽 일부(`MAX_FEATURES` 64개 한도, 훑는 범위는 그 4배)만 읽습니다. READY가 CONNECT에 없던 기능을 더할 수는 없습니다. `protocolVersions`는 64개를 넘으면 잘못된 메시지로 봅니다.
- 합의된 집합은 `session.features`, `runtime.features`, `link.features`, `onInit`의 `context.features`로 읽습니다. 연결이 끝나거나 팝업이 다시 연결되는 동안은 비어 있습니다. 협상 결과가 없는 기능의 내장 메서드(`bridge.replay`)는 `METHOD_NOT_FOUND`입니다.
- Host는 source·origin 검증을 통과한 메시지만 해석합니다. 검증 전 창에서 온 메시지는 읽지 않습니다.

### 10.2 이벤트 재전송 버퍼 (`events.replay`)

알림이 하나 유실되거나 팝업이 bfcache에서 복원되는 사이 놓친 이벤트를, 스냅샷을 새로 받는 대신 팝업의 유한한 버퍼에서 다시 받습니다.

```ts
const progress = event<{ percent: number }>({ replay: { capacity: 64 } })   // 이벤트별 선언(1~1000)
createPopupRuntime({ contract, allowedHostOrigins, replay: { capacity: 16 } }) // 선언 없는 이벤트의 기본값, 기본 0
createPopupBridge().open(def, { init, replay: { timeoutMs: 5_000, maxHeld: 256 } })
```

- 팝업은 발행마다 payload 사본을 버퍼에 남기므로(`structuredClone`) 크기에 맞게 `capacity`를 정합니다. `transfer`로 보낸 payload는 복사본이 없어 버퍼를 비우고, 이전 revision도 함께 버립니다. 이어지지 않는 창이 연속이라고 주장하지 않기 위해서입니다.
- Host는 revision이 건너뛰면 그 이벤트를 붙잡아 두고 `bridge.replay`로 빠진 구간을 받은 뒤 순서대로 전달합니다(`meta.replayed: true`). 그 사이 라이브로 도착한 이벤트도 붙잡았다가(최대 `maxHeld`, 넘치면 오래된 것부터 버립니다) 버퍼에 없는 revision은 라이브 사본으로 같은 순서에 끼워 전달하므로 잃지 않습니다. 같은 revision이 양쪽에 있으면 재전송본을 씁니다.
- 버퍼가 놓친 구간을 모두 덮지 못하면 가능한 만큼 전달하고 `meta.gap: true`와 `missed`로 알립니다. `ResyncResult.missed`는 같은 revision 계산에서 나오므로 이벤트들의 `meta.missed` 합과 일치합니다.
- `epoch`가 바뀌면 다른 팝업 페이지(새로고침)이므로 재전송하지 않고 revision을 처음부터 다시 셉니다(`reset`).
- 재연결(`reconnect` 이벤트)의 `ReconnectInfo.replay`는 이벤트별 결과이고, 직접 확인하려면 `await session.resync(name?)`을 씁니다. 결과는 `current` · `replayed` · `gap` · `reset` · `unsupported` · `failed`입니다. 마지막 이벤트가 유실되면 다음 이벤트가 오지 않아 gap이 드러나지 않으므로 `resync`가 필요합니다. 팝업은 아직 한 번도 발행하지 않은 이벤트도 선언한 `capacity`를 알리므로 시작할 때 `resync`를 호출해도 이후 복구가 꺼지지 않습니다.
- 버퍼 내용은 `bridge.replay`를 호출할 수 있는 쪽, 곧 그 이벤트를 구독할 수 있는 쪽이면 읽을 수 있습니다. `REPLAY_METHOD`는 `bridge.replay` 이름 상수입니다.

### 10.3 이벤트 합치기 (`events.coalesce`)

초당 수십~수백 번 나가는 이벤트(커서 이동, 진행률)를 창(window) 안에서 합쳐 하나만 보냅니다.

```ts
const cursor = event<{ x: number; y: number }>({ coalesce: { windowMs: 50, strategy: 'latest' } })
const touched = event<{ ids: string[] }>({
  coalesce: { windowMs: 50, leading: true, strategy: (acc, next) => ({ ids: [...new Set([...acc.ids, ...next.ids])] }) },
})
```

- 스로틀 방식으로 창마다 최대 한 번 나갑니다. `leading: true`는 조용한 구간의 첫 발행을 바로 보내고 이후만 합칩니다. `windowMs`는 0보다 크고 2 147 483 647 이하입니다.
- `strategy`는 `'latest'`(마지막 payload만) 또는 순수 리듀서 `(accumulated: P, next: P) => P`입니다. 리듀서의 매개변수 타입은 `P`와 엄격하게 비교하므로 다른 타입을 받는 리듀서는 컴파일 오류입니다. 계약에는 소거된 형태(`ErasedCoalescePolicy`)로 저장되어 어떤 `EventSpec<P>`도 `AnyEventSpec`에 대입할 수 있습니다.
- revision은 실제로 나갈 때 한 번 소비하므로 합쳐서 사라진 발행은 gap이 아닙니다. 받는 쪽은 `meta.coalesced`(합친 발행 수, 합치지 않으면 1)를 봅니다. `replay`와 함께 쓰면 합친 이벤트도 재전송됩니다.
- 합치기는 Host가 `events.coalesce`를 합의하고 구독 중일 때만 합니다. 아니면 바로 보냅니다. 구독 해제·종료·복원 전에는 대기 중인 이벤트를 먼저 내보내며, `runtime.flushEvents(name?)`로 직접 내보낼 수도 있습니다. `coalesce`가 있는 이벤트는 `transfer`와 함께 발행할 수 없습니다(`TypeError`).

### 10.4 재연결 백오프

- Popup: Host가 연결하기 전에는 HELLO를 지수 백오프와 지터로 다시 보냅니다(`helloRetry`, 기본 6회, 250ms에서 시작해 4 000ms 상한). 같은 `instanceId`의 같은 메시지라 이미 응답한 Host는 무시합니다. 전체 기한은 `handshakeTimeoutMs`입니다. `false`면 한 번만 보냅니다.
- Host: 팝업이 새로고침·복원된 뒤 이벤트를 다시 구독할 때 `bridge.subscribe`가 시간 초과·`OVERLOADED`·팝업 내부 오류로 실패하면 이벤트별로 다시 시도합니다(`resubscribeRetry`, 기본 4회, `timeoutMs` 기본 10 000). `false`면 한 번만 시도합니다.
- 정책은 `{ initialMs, factor, maxMs, jitter, maxRetries }`이고 지연은 `min(maxMs, initialMs × factor^(n-1)) × (1 - jitter + jitter × random())`입니다. 지터는 지연을 줄이기만 하므로 `maxMs`가 상한입니다. 지연과 시간 제한은 32비트 타이머 한도(2 147 483 647ms)를 넘을 수 없습니다. 넘으면 타이머가 약 1ms 뒤에 울려 재시도가 한꺼번에 일어나므로 옵션 단계에서 `TypeError`입니다.
- 진행은 `session.on('retry', …)`와 `runtime.onRetry(…)`로 봅니다(`RetryEvent`: `target` `hello` · `resubscribe`, `phase` `scheduled` · `attempt` · `recovered` · `exhausted`). 시간(`clock.after`)과 난수(`clock.random`)는 `Clock`으로 주입하므로 테스트에서는 수동 시계로 같은 지연을 재현합니다. `createBackoff`, `backoffDelay`, `resolveBackoff`는 같은 산식을 직접 쓰는 순수 함수입니다.
- 복원(bfcache)으로 연결을 다시 만들 때 `onInit`이 아직 끝나지 않았다면 이전 연결의 `onInit` 결과는 버립니다. 늦게 끝나거나 실패해도 새 연결을 READY로 만들거나 닫지 않습니다.

## 11. 범위

구현됨: P0–P6(계약, 부트스트랩, 통신, 기능 레지스트리, 수명 주기, 보안 검증, SDK), 창 네트워크(노드·링크, 주의 요청, 이웃 조회·점검, 공유 상태), 기능 협상, 이벤트 재전송 버퍼·합치기, 재연결 백오프, 단위·메모리 브라우저 테스트, Chromium 실제 Origin E2E. 아직 없는 것: Firefox/WebKit 검증, 배포 환경(실제 도메인·CDN·CSP) 검증, 인증 정책과 허용 Host 관리, Host 새로고침 복구는 후속 과제입니다.
