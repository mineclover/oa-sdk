# Changelog

릴리스 단위가 아닌, 굵직한 surface 변경이 떨어졌을 때 한 항목으로 기록한다. 자세한 구현 상태는 [spec.md](./internal/spec.md), API 단일 소스는 [api-index.md](./internal/api-index.md), 기능↔테스트는 [feature-test-matrix.md](./internal/feature-test-matrix.md) 참조.

## 2026-10-21 — WebMCP relay 열린 문제 O-62~O-69 결정 (`@oa-sdk/webmcp-peer`)

protocol review가 [WebMCP relay protocol spec](./internal/webmcp-relay-protocol.md) 10.2에 남긴 열린 문제 여덟 건을 결정하고 구현해 spec 10.1로 옮겼다. 패키지별 **Behavior change**는 `.changeset/webmcp-peer-protocol-c10-open-problems.md`에 있다.

- **동작 변경: relay**: id 없는 WebSocket `tools/call`도 HTTP와 같은 catalog 검사를 거치고, 거절된 것은 답 없이 버린다(O-62). provider가 보낸 `notifications/tools/list_changed`는 agent에게 가지 않아, agent가 받는 catalog stamp는 언제나 relay가 `tools/call`을 검사하는 값이다(O-63). room 만료는 아직 끝나지 않은 session만 `expired`로 끝내, 만료 전에 거절·revoke된 session은 session status에 그대로 남는다(O-65).
- **동작 변경: agent client**: `PeerMcpSession`은 relay처럼 문자열·수 id와 `result`·`error`를 가진 message만 답으로 보고, 진행 중인 id로 다시 요청하면 보내지 않고 `DUPLICATE_REQUEST_ID`로 거절해 relay와 세는 진행 중 요청이 어긋나지 않는다(O-64). `revoke()`는 POST 하나만 보낸다(O-67). `onMessage`가 없는 넘겨받은 `transport`의 `onMessage`는 그 transport로 마지막에 connect한 session으로 가서, `PeerMcpService({ transport })`의 두 번째 session이 `TRANSPORT_TIMEOUT`으로 끝나지 않는다(O-69). 구현 뒤 review에서, 요청은 `request()` 호출이 끝날 때까지(재시도 대기와 HTTP POST 전체 포함) 진행 중이라 timeout 뒤에도 POST가 끝나지 않은 HTTP 요청의 답을 같은 id의 다른 요청이 가져가지 않고, 재시도를 기다리는 요청은 자기 재시도를 `DUPLICATE_REQUEST_ID`로 거절당하지 않는다(R-PEER-032). `disconnect()`가 끝낸 connect는 늦게 끝나도 넘겨받은 transport의 `onMessage`를 가져가지 않아, 그동안 그 transport로 connect한 session이 연결된 채 답을 받지 못하는 일이 없다(R-PEER-031).
- **동작 변경: provider**: 끝난 연결의 요청과 실행 중에 연결이 끝난 `tools/call`에는 답하지 않고, 아무 agent에게도 닿지 않던 `PEER_SESSION_SUPERSEDED`·`OUTCOME_UNKNOWN` JSON-RPC 오류와 −32008 class를 없앴다. host가 실행한 호출은 연결이 끝나도 AI run에 기록해, revoke·만료 뒤 run을 rollback할 수 없던 결함을 고쳤다(`AiRunController.hasAction` 새 method, O-68). 구현 뒤 review에서, ledger 조회를 기다리는 동안 연결이 끝난 호출은 ledger에 기록된 결과(`RECONCILIATION_REQUIRED`, replay)로도 답하지 않는다(R-PEER-016). host를 부르기 전에 provider가 부른 host code(host adapter의 `getServerInfo`, 그 호출의 run을 알리는 `subscribeAiRuns` listener)가 연결을 끝낸 호출도 실행하지도 답하지도 run에 남기지도 않는다(R-PEER-012, R-PEER-016). 그런 호출을 agent는 relay가 그 요청을 끝낸 오류로 안다: HTTP revoke는 `SESSION_INVALID`, relay의 room 만료·rotate는 `ROOM_EXPIRED`·`ROOM_ROTATED`, provider socket이 먼저 닫히면 `PROVIDER_DISCONNECTED`다.
- **규범: bearer ticket만**: relay의 401 `WWW-Authenticate: Bearer`는 OAuth discovery를 가리키지 않으며 relay는 RFC 9728·RFC 8414·OpenID discovery metadata를 제공하지 않는다(404). agent는 join이 발급한 client token을 정적 `Authorization: Bearer`로 보낸다. wire는 바뀌지 않았고 테스트가 고정한다(O-66, 사용자 결정).

## 2026-10-20 — WebMCP relay protocol 안정화: 단일 spec, 결정 60건 구현, spec 적합성 검사 (`@oa-sdk/webmcp-peer`)

relay·provider·agent client의 wire 규칙을 [WebMCP relay protocol spec](./internal/webmcp-relay-protocol.md) 하나로 모았다. 코드에서 요건(`R-*`)을 추출한 초안이 코드끼리, 또는 코드와 문서가 어긋난 곳 60건(O-01~O-60)을 올렸고, 패키지가 아직 배포되지 않은 0.1.0이라 권고안을 모두 채택하고 breaking wire 변경을 지금 냈다. 결정과 구현 위치는 spec 10장에, 패키지별 **Behavior change**는 `.changeset/webmcp-peer-protocol-c1-foundation.md`~`c9-docs.md`에 있다. 업그레이드할 때는 changeset의 **Behavior change** 항목을 확인한다.

- **동작 변경: 공유 protocol 상수와 해석 규칙**: protocol 식별자(`WEBMCP_PROTOCOL` 새 export), `Authorization` 해석 하나와 clientToken의 hash 보관, room id 문법 하나(`WEBMCP_ROOM_ID_PATTERN`), 공유 catalog 계약(`PEER_CATALOG_MAX_TOOLS`·`PEER_CATALOG_MAX_TOOL_NAME_LENGTH`), alias 상한, `descriptorUrl`의 `/p/<id>/mcp`.
- **동작 변경: 오류 모델**: 이름 하나에 code 하나(code는 class이고 이름이 식별자), 없는 자격 `_REQUIRED`와 틀린 자격 `_INVALID`, 모든 401의 `WWW-Authenticate: Bearer`, 모든 수명주기 route의 rotate된 room 410, 잘못된 경로 encoding의 400 `INVALID_PATH`, `PeerMcpService`의 등록 `key`·`activeKey`.
- **동작 변경: room 만료와 rotate**: 만료는 `room.expired` frame과 두 transport의 같은 `ROOM_EXPIRED` 하나로 알리고, 보존 중인 만료 room은 410, WebSocket agent도 rotate의 대체 room을 받는다.
- **동작 변경: 승인과 lease**: 승인 요청은 `approvalTimeoutMs`(기본 5분)를 쓰고, lease는 provider socket이 붙어 있는 동안 만료되지 않으며, provider는 relay가 socket 밖에서 한 결정·만료·revoke를 frame으로 받는다. 단일 revoke가 진행 중인 HTTP 요청도 끝낸다.
- **동작 변경: MCP 라우팅**: 두 transport의 같은 `id: null`·notification 규칙, WebSocket의 relay `ping`과 승인 전 공개 discovery, `result._meta`의 catalog stamp, `PeerMcpSession`의 catalogHash 검증과 Streamable HTTP client 규칙(`Accept`, `notifications/initialized`, `MCP-Protocol-Version`, `Retry-After`).
- **동작 변경: signaling**: provider→agent allow-list, offer `requestId` 계약과 socket당 offer 하나, 종료 frame의 순서 보장, 결과와 무관한 register 평가 budget, auto-reconnect가 room을 새로 열지 않음.
- **동작 변경: WebSocket**: 거절한 upgrade마다 HTTP 응답, subprotocol `webmcp-peer.v1` 하나, close code의 뜻(`WEBMCP_CLOSE_CODES` 새 export), 30 s ping과 75 s idle timeout, JSON 입력의 맨 앞 BOM 무시.
- **동작 변경: HTTP 보안**: loopback relay의 Host 검사(`HOST_NOT_ALLOWED`), `trustProxy`가 신뢰하는 proxy의 `X-Forwarded-*`만, 정한 Origin·host 목록이 기본 목록을 대신함, publish key 없이도 기본 publish rate limit, `maxRooms`, CORS 노출 header, route마다의 405 `METHOD_NOT_ALLOWED`.
- **문서·검사**: README, api-index, relay guide, 개념 문서, 보안 감사(새 webmcp-peer 절)가 wire 규칙을 요약하고 spec을 링크한다. `packages/webmcp-peer/test/protocol-spec.test.ts`가 spec의 요건 ID, 근거 줄, 테스트 제목, 상한·close code·오류 class 표를 코드와 테스트에 맞춰 검사하며, 테스트가 없던 요건에 회귀 테스트를 더했다. 남은 열린 문제였던 O-62~O-69는 2026-10-21에 결정했다(위 항목).
- **동작 변경: protocol review 수정**: 문서 단계 뒤 adversarial review가 재현한 결함을 고쳤다. relay는 뒤처진 agent의 frame을 이미 읽은 read의 것까지 처리하지 않고(R-WS-040) catalog를 얼린 하나로 함께 써서, 승인 전 agent가 listing 요청을 쏟아 relay 메모리를 채우던 길을 막았다. rotate가 publish rate limit을 쓰고(O-61), Host 검사는 신뢰한 proxy가 알린 host와 함께 요청의 `Host`도 본다. relay 자신의 WebSocket `initialize`는 message 상한에 들고, 넘치는 relay 답과 다시 쓴 offer 결과는 버리지 않고 `RESULT_TOO_LARGE`로 알린다. `PeerMcpSession`은 다시 붙어도 되는 close 뒤에는 새 socket으로 다시 연결하고 그 밖의 close·종료 frame 뒤에는 다시 연결하지 않으며, provider는 끝난 room의 lease를 지우고 agent의 revoke로 auto-reconnect 설정을 바꾸지 않는다. 재확인에서 provider는 승인 요청 거절(`approval.rejected`)도 invite가 소비된 room의 끝으로 보고 session을 끝내며 lease를 지우고, `PeerMcpSession.disconnect()`는 진행 중인 connect를 `SESSION_DISCONNECTED`로 끝내며, 그동안 부른 connect·요청은 disconnect가 socket을 닫은 뒤 연결해 닫히지 않는 socket을 남기지 않는다. 두 번째 재확인에서 relay는 room이 살아 있는 동안 끝난 ticket의 종료 frame을 다시 붙는 provider socket에 replay해, provider socket이 없는 동안 끝난 room도 provider가 내리고 lease를 지운다(R-ROOM-053). `disconnect()` 뒤에는 넘겨받은 `transport`가 알리는 것도 session을 바꾸지 않고, 끝난 connect는 다음 connect가 쓰는 transport를 닫지 않는다. 세 번째 재확인에서 provider용 `ready`는 room의 ticket이 끝났으면 그 끝 frame의 type을 `ticketEnded`로 알려, 다시 열린 페이지의 reconnect는 이미 끝난 session으로 성공하지 않고 실패한다(`autoReconnectIfSaved()`는 false, R-PEER-004). 넘겨받은 `transport`도 마지막 connect의 callback만 session을 대신하므로 `close()` 뒤에 오는 close event가 다음 connect를 끊지 않고, session이 그 transport에 한 번 다는 `onMessage`는 그 transport를 붙든 연결로 보낸다(R-PEER-031).

## 2026-10-20 — WebMCP relay 남은 강화: `register` 평가 상한, offer `requestId` 상한, 이미 끝난 socket의 upgrade, client 요청 queue (`@oa-sdk/webmcp-peer`)

2026-10-19 relay 메시지 상한 작업 뒤에 남긴 [강화 항목](./internal/todo.md#x-webmcp-relay-남은-강화-항목) 다섯 가지를 마쳤다. relay의 wire 동작 두 가지가 바뀌었다: offer의 `requestId` 상한을 넘으면 `offer.refused`(`REQUEST_ID_TOO_LARGE`)로 답하고, `register` 거절이 오는 시점을 평가 상한(반복 frame은 다시 평가하지 않고, 평가는 room마다 제한한다)이 정한다. provider SDK는 그대로다.

- **동작 변경: `register` 평가 상한**: relay는 room마다 마지막으로 평가한 `register` frame(`registerSeq`를 뺀 frame의 SHA-256)과 그 frame이 남긴 room catalog(version·hash)를 기억한다. 같은 frame이 다시 오면 room catalog가 그대로인 동안 정규화·hash·크기 측정을 하지 않고 같은 답(거부면 새 frame의 `registerSeq`를 담은 같은 거부, 아니면 답 없음)을 돌려준다. catalog를 바꾸지 않는 frame(`CATALOG_INVALID`·`CATALOG_TOO_LARGE`로 거부되거나 room이 이미 가진 catalog)은 room마다 한 번에 8개, 그 뒤로 초당 1개까지만 평가한다. 그 사이에 온 frame은 기다리고 provider의 다음 `register`가 그것을 대신하므로, 마지막 frame은 늦게라도 항상 평가되고 속도 때문에 거부되지 않는다. budget은 room에 속해 provider socket을 바꿔도 초기화되지 않는다. 이전에는 provider token을 가진 쪽이 거부되거나 아무것도 바꾸지 않는 `register`를 반복해 보낸 만큼 relay CPU를 쓸 수 있었다.
- **동작 변경: offer `requestId` 상한**: relay는 `requestId`가 JSON 1 KiB(JSON-RPC id와 같은 상한)를 넘는 승인된 agent의 offer를 provider에 전달하지 않고 `{ type: "offer.refused", error: REQUEST_ID_TOO_LARGE }`로 답한다(id는 되돌려 주지 않는다). provider의 `answer`·`release` frame이 그 id를 되풀이하므로, 이전에는 그런 offer가 전달되고도 provider가 상한을 넘는 답을 보내지 않아 응답을 받지 못했다.
- **정확성: 이미 끝난 socket의 upgrade**: `upgradeWebSocket`은 호출 시점에 파기됐거나, peer가 이미 FIN을 보냈거나(`readableEnded`), 더 쓸 수 없는 socket에 101을 보내지 않고 socket을 파기하며, `send`는 곧바로 `'closed'`를 돌려주고 `onClose`는 호출이 반환된 뒤 한 번 실행된다. 이전에는 `'end'` event가 이미 지나간 socket이 half-open으로 남아 `onClose`가 불리지 않았다. `WebMcpPeerServer`는 직접 확인했지만 다른 호출자는 보호받지 못했다.
- **동작 변경: client 요청 queue**: `PeerMcpSession`은 relay socket(`raw`가 아닌 transport. Streamable HTTP는 `raw`)에서 진행 중 요청을 새 상수 `PEER_RELAY_MAX_PENDING_REQUESTS`(64, `./config`와 root에서 export, relay도 같은 값을 쓴다)개까지만 보내고, 그 뒤 요청은 순서대로 기다렸다가 앞선 요청이 답을 받으면 보낸다. relay는 답할 때까지 요청을 세므로, 호출자가 더 짧은 timeout으로 포기한 요청도 relay의 답이 올 때까지 자리를 차지한다. 기다린 시간은 요청 timeout에 들어가고(`REQUEST_TIMEOUT`, 보내지 않음), `disconnect()`·transport 종료는 기다리는 요청도 끝낸다. relay가 id 없이 답하는 JSON 1 KiB 초과 id는 보내기 전에 `REQUEST_ID_TOO_LARGE`(`details: { bytes, limitBytes }`)로 거부한다. 이전에는 65번째 요청이 relay의 `TOO_MANY_PENDING_REQUESTS`(-32087)로 실패했고, 1 KiB 초과 id의 요청은 timeout까지 답을 받지 못했다.
- **예제: live demo `registerSeq`**: `examples/live-demo/host-provider.js`의 `register`도 SDK처럼 증가하는 `registerSeq`를 담고, relay의 `CATALOG_INVALID`·`CATALOG_TOO_LARGE` 거부를 그 번호로 frame에 맞춘다. 마지막 frame에 대한 거부만 Provider 배지(`catalogRefusal`)에 표시하고, 이미 대체된 frame에 대한 거부는 wire log에 무시했다고 남긴다.

## 2026-10-20 — `pluginClient` operation type 이름 escape와 `clientName` 검증 (`@oa-sdk/codegen`)

2026-10-19 안정화에서 남긴 `pluginClient` 후속 두 건이다. 두 변경 모두 이전에 컴파일되지 않던 생성 코드에만 영향을 준다.

- **동작 변경: 생성 `client.ts`의 operation type 이름 (`@oa-sdk/codegen`)**: per-operation type(types 파일에서 import하는 `<Base>Response`·`<Base>Error` 등과 `client.ts`가 선언하는 `<Fn>Data`·`<Fn>Response`·`<Fn>Errors`·`<Fn>ErrorUnion`·fallback)의 이름이 `client.ts`가 선언하는 type(client class, `RequestParameters`, `RequestOptions`, `KnownErrorStatus`, `ClientResult`, `ClientResponse`, `ErrorUnion`, `ErrorStatusResult`, `ClientConfig`)이나 type 위치에서 참조하는 global type(`Promise`, `Record`, `Response` 등)과 같으면, 함수 이름처럼 끝에 `_`(이어서 `_2`, ...)를 붙인다. root-level operation `client`의 응답 type은 `client.ts`에서 `ClientResponse_`이다. types 파일의 `ClientResponse`를 `ClientResponse as ClientResponse_`로 import해 `export type { ClientResponse_ }`로 다시 export하고, 성공 응답이 없으면 `export type ClientResponse_ = void`를 선언한다. `ClientResponse`는 그대로 generic helper다. 이전에는 import가 helper 선언과 충돌하거나 fallback이 helper와 중복돼 `client.ts`가 컴파일되지 않았다. types 파일의 이름은 바뀌지 않는다. `clientName`과 같은 이름의 operation type(`clientName: 'ListItemsResponse'`)도 같은 규칙으로 escape된다.
- **동작 변경: `pluginClient({ clientName })` 검증 (`@oa-sdk/codegen`)**: `clientName`이 식별자가 아니거나, 예약어나 TypeScript predefined type 이름(`string` 등)이거나, `client.ts`가 선언하는 다른 이름(`createClient`, `defaultClient`, `client`, `ClientConfig`, `ClientResponse` 등)이거나, `client.ts`가 참조하는 global(`fetch`, `Response`, `Record`, `RequestInit` 등)이거나, `client.ts`가 class를 참조하는 자리에서 묶는 이름(`TData`, `TError`, `config`)이면 `pluginClient`가 `CLIENT_INVALID_CLIENT_NAME` 오류 진단(예: `clientName "Response" would shadow the global \`Response\` that the generated client module refers to`)을 내고 `client.ts`와 `client:sdk` manifest를 만들지 않는다. 이전에는 그런 class를 선언해 global이나 helper를 가리는 코드를 생성했다. operation 함수·type과 같은 이름은 허용하고 operation 쪽 이름을 escape한다.

## 2026-10-19 — 안정화: relay·transit 보안, HMAC 가명화, 컴파일되지 않던 생성 코드 수정 (`@oa-sdk/peer-server`, `@oa-sdk/peer-transport`, `@oa-sdk/webmcp-peer`, `@oa-sdk/telemetry`, `@oa-sdk/codegen`, `@oa-sdk/typespec-decorators`, `@oa-sdk/surface-ir`, `@oa-sdk/client`, `@oa-sdk/router`, `@oa-sdk/chunk-stream`, `@oa-sdk/chunk-stream-ui`, `@oa-sdk/ast-sync`; private `@oa-sdk/rpc`, `@oa-sdk/spec-lens-contract`, `@oa-sdk/spec-lens`)

전수 코드 리뷰에서 확인된 결함 146건을 대상으로 한 안정화 패스다. 보안 결함, 문서대로 컴파일·동작하지 않던 생성 코드와 런타임, 없는 API를 안내하던 문서를 고쳤다. **동작 변경** 항목은 업그레이드할 때 호출 코드, 설정, 저장해 둔 값(가명 token, catalog hash, 생성된 `.proto`)을 바꿔야 할 수 있다. 패키지별 bump 의도는 `.changeset/`에 있다.

- **보안: WebSocket relay 승인 게이트 (`@oa-sdk/peer-server`, `@oa-sdk/peer-transport`)**: upgrade 요청의 `Host` header를 파싱하지 않는다. 이전에는 잘못된 `Host` 하나로 upgrade listener가 예외를 던져 서버 프로세스가 종료됐다. relay packet은 provider가 승인한 방에서만 상대에게 전달되고, 승인 전에 보내면 `RELAY_NOT_APPROVED`로 보낸 쪽 socket을 닫는다. relay만 보내는 신호(`ready`, `request`, `approved`, `released`, `closed`)를 peer가 보내면 `FORBIDDEN_SIGNAL`로 거부한다. 이전에는 승인 전 relay packet과 peer가 위조한 제어 신호가 그대로 상대에게 전달됐다. provider `decision`의 `allowedTools`(`approved` 신호에도 실린다)는 relay가 집행한다. 목록 밖 tool을 부르는 `tools/call`(그런 호출이 든 JSON-RPC batch는 통째로)은 provider에 보내지 않고 `TOOL_NOT_ALLOWED`(-32602) 오류로 답한다. `parseSignalMessage`는 frame 원문에 `"type":"relay"`가 들어 있다는 이유로 64 KiB 신호 상한을 건너뛰지 않고 파싱한 `type`으로 상한을 정하며, envelope를 다시 만들어 알 수 없는 member를 버린다.
- **보안: Cloud Transit 접근 정책과 초대 참여 (`@oa-sdk/peer-server`)**: 단독 handler `handleCloudTransitHttpRequest`(Node)와 `handleCloudTransitWorker`(Workers)가 받은 `publishKey`와 `allowedOrigins`를 집행한다. 허용되지 않은 `Origin`은 CORS header 없이 403, `publishKey`가 설정됐는데 key(`X-Peer-Publish-Key` 또는 `Authorization: Bearer`)가 없거나 틀린 요청은 preflight를 빼고 401이다. `allowedOrigins`가 없으면 정확한 loopback origin만 허용하고, `Origin`이 없는 서버·CLI 요청은 origin 검사를 받지 않는다. 이전에는 두 option을 받기만 하고 집행하지 않았으며 어떤 `Origin`이든 되돌려 보냈다. CORS preflight는 `CloudTransitClient`가 항상 보내는 `X-Target-Peer`도 허용한다. `POST /p/:roomId/join`은 server 전체 `publishKey` 대신 방 초대 토큰(body의 `inviteToken` 또는 `Authorization: Bearer`)을 자격으로 받는다. 이전에는 `publishKey`를 설정한 서버에서 초대 참여가 항상 401이었다. 없는 방에는 400 대신 404로 답한다.
- **보안: relay 제어 frame과 publish rate limit (`@oa-sdk/webmcp-peer`)**: `WebMcpPeerServer`는 client socket의 `mcp` frame과 승인된 client의 `offer` frame만 provider에 전달하고, 전달하는 frame에 `from: 'client'`와 relay가 발급한 `sessionId`를 덧붙인다. 그 밖의 client frame은 버린다. 이전에는 승인되지 않은 client도 `session.revoked`, `room.rotated`, `approval.request` 같은 제어 frame을 provider에 그대로 보낼 수 있었다. `POST /p`의 publish rate limit은 실패한 시도를 모두 주소별 공용 bucket(`tokenHash: 'unauthenticated'`)으로 센다. 이전에는 시도한 key의 hash가 bucket이 되어, 매번 다른 key를 보내면 throttle되지 않았고 bucket이 요청마다 늘었다. `InMemoryPublishRateLimitStore`는 4096 key를 넘으면 만료된 window를, 그다음 가장 오래된 window를 버린다. room `ttlMs`는 `[60초, maxRoomTtlMs]`(새 option, 기본 24시간)로 제한된다. 이전에는 상한이 없어 만료되지 않는 방을 만들 수 있었다.
- **보안: DPM 가명화 (`@oa-sdk/telemetry`)**: `createDpmTelemetryAdapter`가 가명 token을 32-bit FNV-1a와 소스에 공개된 기본 salt 대신 HMAC-SHA-256(출력의 앞 128 bit)으로 만든다. 기본 key는 없다. `tokenKey`(`string | Uint8Array`)를 주지 않으면 instance마다 무작위 key를 쓰므로 token은 그 instance 안에서만 일관되고, 빈 `tokenKey`는 `TelemetryConfigError`를 던진다. `crypto.getRandomValues`가 없는 runtime에서 `tokenKey`나 `customTokenizer` 없이 가명화해도 같은 오류다. 이전 token은 key 없이 사전 대입으로 되돌리거나 위조할 수 있었다. `'masked'`는 식별자 key(`DEFAULT_PII_KEYS`의 `userid`·`customerid`·`orderid`·`accountid`·`email`·`phone`, 대소문자와 `-`·`_`를 무시한 부분 일치)의 값을 `***MASKED***`로 가린다. 이전에는 `'none'`과 같아 원본 값이 그대로 나갔다. 사용자 지정 `sensitiveKeys`도 대소문자와 `-`·`_`를 무시하고 비교하며, XState inspector는 전역 identity의 원본 `userId` 대신 `pseudonymToken` 또는 tokenize한 값을 context에 넣는다. 순환 참조는 `[Circular]`, 10단계보다 깊은 값은 `[MaxDepth]`로 요약하므로 전송이 실패하지 않는다.
- **보안: MessagePack decode (`@oa-sdk/client`)**: `decodeMessagePack`과 `messagePackAdapter`가 map key를 own data property로 저장하므로 `__proto__` key가 decode된 object의 prototype을 바꾸지 못한다. 모든 byte를 경계 검사해, 잘린 str·bin·array·map이나 값 뒤에 남은 byte는 `RangeError`로 실패한다. 이전에는 잘린 payload를 조용히 깨진 값으로 돌려줬다.
- **보안: chunk server 요청 검증 (`@oa-sdk/chunk-stream`)**: `server.fetch()`가 path segment를 하나씩 decode하므로 잘못된 percent-encoding에는 400 `BAD_REQUEST`로 답하고(이전에는 `URIError`로 reject), 인코딩된 `%2F`는 id 안에 남는다. seek frame은 0 이상의 safe integer(number 또는 10진 문자열)만 받고, 그 밖의 값은 `seekFrame`을 부르지 않고 400으로 답한다. frame이 없으면 전처럼 0이다. 이전에는 잘못된 값이나 문자열 frame이 frame 0으로의 seek이 되어 상태를 바꿨다. 비어 있지 않은 POST seek body는 frame이 number나 string인 JSON object여야 한다. 이에 따라 `ChunkStreamBadRequestError`가 export되고, `ChunkStreamRouteResponse.status`에 400이, `seekStreamFrame`의 반환 union에 `ChunkStreamBadRequestError`가 더해지며, `SeekStreamFrameContext.body`는 `{ frame?: number | string }`이다.
- **보안: TypeSpec plugin 출력 정리 (`@oa-sdk/codegen`)**: `runTspPluginPipeline`의 `clean`은 realpath 기준으로 cwd나 OS temp 디렉터리의 엄격한 하위 디렉터리만 지운다. cwd와 그 상위, TypeSpec entrypoint이거나 그것을 담은 디렉터리는 지우지 않고 `TSP_CLEAN_SKIPPED`를 보고한다. 이전에는 경로 문자열에 `dist`·`generated`·`tmp`·`temp`가 들어 있기만 하면 cwd 밖이라도 지웠다. `builder.build({ outputDir })` override도 지킨다. 이전에는 이를 무시하고 `./src/generated`에 쓰면서 그곳을 지웠다.
- **동작 변경: durable JSONL (`@oa-sdk/webmcp-peer`)**: `readDurableJsonLinesSync(filePath, errorCode, schema, options?)`(`./server`와 root)는 세 번째 인자로 row schema(`DurableJsonRowSchema<T>`, `parse(value)`)를 받아야 한다. 모든 row를 그 schema로 검증하고, 빈 row는 `<errorCode>: empty row N`, 파싱 실패와 schema 거부는 `<errorCode>: row N`(끝나지 않은 마지막 row면 `truncated final row`)으로 원인을 `cause`에 담아 던진다. `ignoreUnterminatedTail` option과 `truncateUnterminatedTailSync`가 추가됐다. `FileAiRunLedgerStore`는 append가 끝나지 않은 마지막 row를 읽지 않고 다음 append 전에 잘라내므로, 이전처럼 한 번의 부분 기록이 ledger를 영구히 읽지 못하게 만들지 않는다.
- **동작 변경: catalog hash 순서 (`@oa-sdk/webmcp-peer`)**: `hashDeploymentCatalog`(`./server`), `hashTools`(`./client`와 root), room `catalogHash`가 tool을 `localeCompare` 대신 UTF-16 code unit 순서로 정렬한다. 같은 catalog는 runtime locale과 관계없이 같은 hash가 되고, client가 계산한 값이 relay 값과 같다. 대소문자가 섞이거나 `-`·`_`·숫자가 든 이름의 catalog는 hash가 바뀌므로, 외부에 고정한 `/mcp/catalog/:hash` URL이나 deployment `catalogHash`는 한 번 다시 만들어야 한다. 저장된 `PeerMcpCatalogCache`는 복원할 때 hash를 다시 계산하고, live demo(`examples/live-demo/peer-protocol.js`)도 같은 순서를 쓴다.
- **동작 변경: embedded `WebMcpPeerServer` (`@oa-sdk/webmcp-peer`)**: constructor가 더 이상 `process.argv`를 파싱하지 않고, cwd와 그 상위의 `.env.local`·`.env` 파일을 읽어 `process.env`에 쓰지도 않는다. CLI entry point는 `argv: process.argv.slice(2)`와 `loadEnvFiles: true`(필요하면 `cwd`)로 켠다. 환경 변수는 전처럼 읽고, `argv`를 주면 그 CLI flag가 constructor option보다 우선한다. 이전에는 host process의 CLI flag가 명시한 constructor option을 덮어썼다. `authorizePublishRequest`의 실패 결과는 `tokenHash: 'unauthenticated'`를 담는다.
- **동작 변경: relay 메시지 상한과 WebSocket codec (`@oa-sdk/webmcp-peer`)**: relay 메시지 하나는 단일 WebSocket frame이든 단편화든 양방향 모두 `PEER_RELAY_MAX_MESSAGE_BYTES`(UTF-8 JSON 256 KiB)까지다. 브라우저와 Node WebSocket client는 message를 frame 하나로 보내는데 relay가 128 KiB를 넘는 단일 frame에 socket을 닫았으므로 실제 상한은 128 KiB였고, provider socket이 닫히면 그 room의 진행 중 요청이 모두 실패했다. 이제 `MAX_WEBSOCKET_FRAME_BYTES`는 `MAX_WEBSOCKET_MESSAGE_BYTES`와 같다. relay의 수신 parser는 streaming으로 다시 써서 frame header 필드마다 도착하는 즉시 검사하고, 상한이나 message당 1024 frame(`MAX_WEBSOCKET_MESSAGE_FRAGMENTS`)을 넘으면 payload를 버퍼링하기 전에 close code 1009로 닫는다. 프로토콜 위반(예약 opcode·RSV bit·mask 없는 frame·잘못된 control·close frame)은 1002, binary는 1003, 유효하지 않은 UTF-8은 1007(U+FFFD 치환 없음), owner `onText` 예외는 1011로 닫는다(이전에는 모두 1000이었고, 길이 0 continuation frame을 무한히 쌓을 수 있었으며, 읽을 때마다 버퍼 전체를 다시 복사했다). 읽지 않는 peer의 송신 queue는 `MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES`(1 MiB)까지만 쌓는다. 넘을 메시지는 queue에 넣지 않고 `'busy'`로 거부하며 socket은 닫지 않고, 들어가지 않는 pong은 버린다. 거부 뒤 queue가 `WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS`(30초) 동안 비지 않는 peer만 1013(`WEBSOCKET_CLOSE_TRY_AGAIN_LATER`)으로 닫는다. FIN만 보내고 끊는 peer와 relay의 close에 답하지 않는 peer는 `WEBSOCKET_CLOSE_TIMEOUT_MS`(5초) 안에 파기하므로 `WebMcpPeerServer.close()`가 멈추지 않고, `onClose`는 socket이 멈추는 즉시 한 번 호출된다. `upgradeWebSocket`은 선택적 6번째 인자 `UpgradeWebSocketOptions`(`closeTimeoutMs`, `stalledOutboundTimeoutMs`, `maxOutboundBufferBytes`)를 받는다. `PeerSocket.send`는 `'sent' | 'too-large' | 'busy' | 'closed'`(`PeerSendResult`)를 돌려주고 보낼 수 없는 message에 받는 쪽 socket을 닫지 않으며, `PeerSocket.close(code?)`는 close code를 받는다. 이전에는 relay가 상한을 넘는 agent 요청을 전달하다 provider socket을 닫아 room 전체를 끊었다.
- **동작 변경: relay가 보낸 쪽에 답한다 (`@oa-sdk/webmcp-peer`)**: agent 요청은 보낸 그대로, 그리고 relay가 전달할 `JSON.stringify` 형태로 재어 `PEER_RELAY_MAX_REQUEST_BYTES`(256 KiB - 1 KiB)까지이며(`JSON.stringify`로 직렬화하는 client에서는 둘이 같다), relay가 붙이는 `from`/`sessionId` stamp와 wire id 재작성은 항상 남은 1 KiB에 들어가므로 상한 안의 요청은 모두 전달된다. 넘는 요청은 HTTP `POST /p/:id/mcp`면 HTTP 413과 JSON-RPC `-32600 REQUEST_TOO_LARGE`로(이전에는 150,000 byte에서 잘라 `PARSE_ERROR`가 됐다), WebSocket이면 JSON-RPC 오류로 답하고, 승인된 agent의 offer는 `offer.refused`로 답한다. provider의 송신 queue가 가득 차면 요청을 넣지 않고 재시도 가능한 `-32001 PROVIDER_BUSY`(`data.retryable: true`, HTTP는 503과 `Retry-After: 1`)로 답하며 provider를 끊지 않는다. 이미 닫히는 provider로 가는 요청은 `PROVIDER_UNAVAILABLE`(HTTP 503 / `-32001`), WebSocket agent에게 더는 맞지 않는 응답은 `-32603 RESULT_TOO_LARGE`로 답한다. agent가 요청한 응답(`approval.pending`·`approval.approved`·`ready`·`offer.refused` 포함)은 그 agent가 늦게 읽어도 닫지도 버리지도 않고 순서대로 기다렸다 보내며, 그동안 그 agent socket은 더 읽지 않는다. 요청하지 않은 broadcast(catalog 알림, `list_changed`, provider signaling)는 뒤처진 agent에게 건너뛴다. relay는 provider로 전달하는 모든 `mcp` envelope와 offer에 권위 있는 `from: 'client'`와 `sessionId`를 덮어쓴다(이전에는 offer만 그랬다). `/join` `clientLabel`은 256자로 자르고, 대기 중인 ticket의 `approval.request`는 provider socket마다 한 번만 보낸다(이전에는 요청마다 다시 보냈다). async `customUpgradeHandler`가 기다리는 동안 client가 연결을 끊어도 relay process가 죽지 않는다. JSON-RPC id는 JSON 1 KiB까지(`REQUEST_ID_TOO_LARGE`), agent WebSocket 하나에서 provider를 기다리는 요청은 64개까지(`-32087 TOO_MANY_PENDING_REQUESTS`), client ticket 하나의 WebSocket은 4개까지(다섯 번째가 가장 오래된 것을 닫는다)다. 같은 provider token으로 새 provider WebSocket이 붙으면 이전 socket을 닫는다(이전에는 열린 채 catalog를 바꾸고 요청을 settle할 수 있었다). JSON body endpoint는 64 KiB를 넘는 body에 413 `BODY_TOO_LARGE`, 유효한 UTF-8이 아니거나 JSON object가 아닌 body에 400 `INVALID_JSON_BODY`로 답하고(`POST /p/:id/mcp`는 잘못된 UTF-8에 400 `PARSE_ERROR`) 아무 동작도 하지 않는다. 이전에는 잘못된 byte를 U+FFFD로 바꿔 바뀐 내용으로 실행했다. 이전에는 approval·revoke·rotate가 그런 body를 `{}`로 보고 실행해, provider bearer의 revoke가 모든 session을 취소하거나 rotate가 기본값으로 실행됐다. 크기를 넘는 body는 상한의 16배까지 읽어 버리므로 응답이 실제로 도착한다(이전에는 Node가 연결을 끊어 client가 EPIPE를 받았다). `customHttpHandler`가 body를 읽고 `false`를 돌려주면 500 `BODY_CONSUMED`로 답한다. 상태를 바꾸는 endpoint는 body가 도착한 뒤 room을 다시 확인한다.
- **동작 변경: catalog 크기 (`@oa-sdk/webmcp-peer`)**: provider는 `PEER_RELAY_MAX_CATALOG_BYTES`(256 KiB - 4 KiB)를 넘는 `register`를 보내지 않는다. `syncTools()`는 `false`, `getSession().error`는 `CATALOG_TOO_LARGE: ...`가 되고 socket은 열린 채로 둔다. 이전에는 큰 catalog가 auto-reconnect backoff 아래에서 ready → register → close를 반복할 수 있었다. relay는 알림(`catalogVersion`/`catalogHash` 포함)이 `PEER_RELAY_MAX_ANNOUNCEMENT_BYTES`(256 KiB - 2 KiB)를 넘는 catalog를 `CATALOG_TOO_LARGE` error frame으로 거부하고 기존 catalog를 유지하며, provider `tools/list` 결과의 catalog에도 같은 기준을 적용한다. 그래서 relay가 받은 catalog는 모든 transport에서 나열할 수 있다. `register`는 증가하는 `registerSeq`를 담고 relay가 거부 frame에 그대로 돌려주므로, provider는 이미 바꾼 catalog에 대한 늦은 거부를 무시한다. provider는 relay가 전달한 `tools/list`·`server/discover`에 마지막으로 보낸 `register`의 catalog로 답하고(보내지 않은 catalog는 내보내지 않는다), provider 답이 오류이거나 relay가 거부한 catalog이면 relay가 자신의 catalog로 답하므로 HTTP와 WebSocket agent가 같은 catalog를 본다. relay 소켓으로 보내는 모든 frame을 상한과 비교해 넘으면 보내지 않는다. 세션 오류가 바뀔 때마다(연결·자동 재연결 중 포함) 구독자에게 알린다. relay·client·live demo의 catalog hash는 own `__proto__` key도 포함한다(이전에는 그 key만 다른 catalog가 같은 hash였다).
- **동작 변경: agent client (`@oa-sdk/webmcp-peer`)**: `PEER_RELAY_MAX_REQUEST_BYTES`를 넘는 요청은 보내기 전에 `PeerMcpError` `REQUEST_TOO_LARGE`(`details: { bytes, limitBytes }`)로 거부해 그 호출만 실패한다. relay가 재시도 가능하다고 표시한 거부(`data.retryable: true`, 예: `PROVIDER_BUSY`)는 아무에게도 전달되지 않았으므로 요청 timeout 안에서 backoff(100 ms에서 2초까지 두 배씩)로 다시 보낸다. HTTP 요청이 진행 중일 때 timeout·`disconnect()`로 거부된 호출, ping 응답 전송 실패, CRDT carrier 전송 실패가 더는 unhandled rejection이 되지 않는다(`--unhandled-rejections=throw`에서 agent process가 종료될 수 있었다).
- **동작 변경: provider와 client의 MCP 결과 (`@oa-sdk/webmcp-peer`)**: provider는 `tools/call` 결과를 MCP `CallToolResult`로 보낸다. host가 `CallToolResult`를 돌려주면 `content`와 `isError`를 그대로 전달하고, 그 밖의 값은 `structuredContent`와 text block(JSON 16 KiB까지, 넘으면 `structuredContent`를 가리키는 짧은 안내)으로 감싼다. relay 메시지 상한(위 'relay 메시지 상한과 WebSocket codec' 항목의 256 KiB)을 넘는 응답은 `tools/call`이면 `RESULT_TOO_LARGE` `isError` 결과로, 다른 method면 JSON-RPC 오류 `-32603 RESULT_TOO_LARGE`로 바꾼다. `PeerMcpSession.request()`는 `PeerMcpRpcResponse`를, `callTool()`은 검증한 `PeerMcpCallToolResult`를 돌려주고, 형식이 맞지 않는 결과는 `INVALID_TOOL_RESULT`로 실패한다. 동시 AI run이 128개에 이르면 `AiRunController.begin()`이 끝난 run, 그다음 idle run을 내보내고, 모두 진행 중이면 `AiRunLimitExceededError`(`AI_RUN_LIMIT_EXCEEDED`)를 던진다. 이전에는 그 뒤의 추적 호출이 응답 없이 timeout됐다.
- **정확성: WebMCP peer 세션 (`@oa-sdk/webmcp-peer`)**: provider socket이 다시 붙으면 relay가 승인된 미만료 ticket을 `approval.restored` frame으로 알리고 provider가 승인된 client를 복원한다. 이전에는 lease 회수나 자동 재연결 뒤 agent가 `CLIENT_APPROVAL_REQUIRED`를 받았다. 자동 재연결은 backoff로 재시도하고, relay의 `CATALOG_INVALID` 거부는 `getSession().error`에 드러난다. rotate·revoke-all·room 만료 때 진행 중이던 HTTP `tools/call`은 `ROOM_ROTATED`(-32057)·`SESSION_INVALID`(-32001)·`ROOM_EXPIRED`(-32056)로 답을 받으므로 걸려 있지 않고 `server.close()`도 멈추지 않는다. revoke 응답의 `alreadyRevoked`가 정확해졌고, 연결 중의 동시 요청이 `TRANSPORT_NOT_OPEN`으로, 한 번 실패한 untraced `tools/call` 뒤의 호출이 `AI_RUN_TERMINAL`로 실패하지 않는다. `discoverPeerCatalog`, `PeerMcpSession.revoke()`(relay session id가 없으면 bearer token으로 `/p/:id/session/revoke`), 이미 abort된 signal을 받은 `fetchPeerServerConfig`, 잘못된 percent-encoding의 `redactInvitationUrl`도 고쳤다.
- **동작 변경: `CloudTransitClient`와 `WebSocketTransportAdapter` (`@oa-sdk/peer-transport`)**: `CloudTransitClient.listTools(peerAlias?, { signal, timeoutMs }?)`는 `GET /tools?peer=` 대신 `/transit/:peer/mcp`에 JSON-RPC `tools/list`를 POST하고, 검증한 `CloudTransitTool[]`를 돌려주며, HTTP·JSON-RPC 오류와 timeout, 취소에 `Failed to list tools: ...`를 던진다. 이전에는 transit을 거치지 않아 단독·Worker transit proxy에서 실패했고 timeout도 없었다. `callTool`은 이미 abort된 signal로는 요청을 보내지 않고, 사용자 취소를 timeout이 아닌 `TOOL_CALL_CANCELLED`로 알린다. `createWebSocketTransportAdapter`의 `connect()`는 socket이 열릴 때가 아니라 relay의 `ready` 신호에 resolve하고, ticket이 거부되거나 socket이 먼저 닫히면 reject한다. channel은 `approved`를 받은 뒤에만 연결 상태가 되고, 승인 전에 받은 relay packet은 버린다. `disconnect()`·`dispose()`·종료 신호·1000/1008 close 뒤에는 재연결하지 않으며(비정상 끊김 뒤에만 재연결), `dispose()` 뒤의 `connect()`는 reject한다. 이전에는 `disconnect()`가 자동 재연결을 일으켰고, 오래된 `onclose`가 새 연결의 상태를 덮어썼다. `ws` socket이 CONNECTING 중에 닫혀도 처리되지 않은 `'error'`가 나지 않는다.
- **동작 변경: relay 세션 수명과 upgrade·HTTP 응답 (`@oa-sdk/peer-server`)**: 승인 뒤 60초 signaling window는 offer·answer·release에만 적용되고, 승인된 relay 세션은 새 `relayIdleTimeoutMs`(기본 5분, relay frame마다 갱신, 0이면 끔)와 `relayMaxSessionMs`(기본 24시간)로 끝난다. 이전에는 duplex relay 세션이 승인 60초 뒤와 room TTL에 강제로 끊겼다. `PeerRelayManagerOptions.roomTtlMs`가 지켜지고, 잘못된 시간 option은 `PeerRelayManager`를 만들 때(`createPeerServer`가 relay를 만들 때 포함) `RangeError`로 실패한다. 만료된 방은 양쪽 socket을 모두 닫으므로 상대 socket이 열린 채 남아 `close()`를 막지 않는다. listener를 ticket 검사 전에 붙여 그 사이의 frame(크기가 제한된 queue)과 close를 놓치지 않는다. room이나 role이 없거나 잘못된 `/ws`·`/relay`·`/p/...` upgrade는 400, 다른 upgrade listener가 없을 때 알 수 없는 경로는 404로 답한다. 이전에는 이런 upgrade에 응답하지 않았다. 새 `RelayTransitBridge`(`enableRelay`와 `enableCloudTransit`을 함께 켜면 `createPeerServer`가 붙인다)가 `alias=`로 접속한 relay provider 방의 가상 client가 되어, Cloud Transit(`/transit/:peer/mcp`, `/call`)이 그 provider에 닿는다. 이전에는 문서의 이 topology가 구현돼 있지 않았다. relay frame 상한을 넘는 transit 호출은 provider의 relay 세션을 끝내지 않고 `POST /call`에서 413으로 실패한다.
- **동작 변경: telemetry token과 type (`@oa-sdk/telemetry`)**: token은 `dpm_tok_<entity>_<32 hex>`(이전 8 hex)이고, namespace는 이벤트 symbol의 domain이 아니라 식별자 key의 entity 종류(`DEFAULT_PII_KEYS` 또는 새 `piiKeys` option)다. 같은 사용자는 domain이 달라도 같은 token을 받으며, 이전 버전이 만든 token과는 일치하지 않는다. `sanitize`의 `namespace` 인자는 남아 있지만 token에 영향을 주지 않는다. `DEFAULT_SENSITIVE_KEYS`(`apikey` 추가)와 `DEFAULT_PII_KEYS`가 export된다. `GtmDispatcherOptions.dataLayer`는 `GtmDataLayerLike`이고, Sentry dispatcher는 `SentryLikeScope`를 쓴다. `OtelLikeSpan.addEvent`·`recordException`과 `OtelLikeTracer.startSpan`은 `OtelAttributes`·`OtelException`을 받으므로 실제 `@opentelemetry/api`의 `Tracer`·`Span`을 그대로 넘길 수 있다. 새 `getActiveSpan` option이 ambient span을 알려 주고, 없으면 event는 actor instance의 span에 붙는다. 이전에는 README 설정과 실제 Tracer에서 OTel dispatcher가 아무것도 기록하지 않았다. GTM `dataLayer`의 `event`·`track_symbol`·`trace_id`·`actor_id`·`state_node`와 Sentry breadcrumb의 `actorId`·`stateNode`·`traceId`는 payload의 같은 key가 덮어쓰지 못한다.
- **정확성: XState inspector와 dispatcher (`@oa-sdk/telemetry`)**: `createTelemetryInspector`는 XState로 예외를 던지지 않고 actor를 구독하지 않는다. 등록되지 않은 symbol은 `strictSymbols`일 때만 거부하고 새 `onError` option으로 보고한다. 이전에는 `strictSymbols`가 꺼져 있어도 inspector 예외가 `actor.send()` 안으로 퍼져 전이가 사라졌고, inspector의 error observer가 XState의 처리되지 않은 오류 보고를 가렸다. machine 오류는 actor마다 한 번 dispatch되고, 부모로 올라가는 오류는 시작한 actor에서만 보고된다. envelope의 `actorId`·`stateNode`는 `@xstate.event`의 `actorRef`·`sourceRef`로 채운다. 이전에는 없는 `targetActor`를 읽어 비어 있었다. span 상태는 `ActorRef` object 기준이라 id가 같은 actor끼리 span이 새거나 엉뚱한 span이 닫히지 않고, `TelemetryContext.actorSessionId`가 추가됐다. composite dispatcher의 `dispatchSpanStart`는 span을 지원하는 모든 child에 실패를 격리해 전달하고 `cspan_<n>` id를 돌려준다. 명시적인 `undefined` context 값은 envelope 기본값(`traceId` 등)을 지우지 않는다.
- **동작 변경: MessagePack encoding (`@oa-sdk/client`)**: `encodeMessagePack`과 `messagePackAdapter`는 `bigint`를 문자열 대신 정수로(safe 범위 밖은 uint64/int64, 64 bit를 넘으면 `RangeError`) 인코딩하고, `toJSON()`을 따르므로 `Date`는 `{}` 대신 ISO 문자열이 된다. 모든 `ArrayBuffer` view는 bin이 되고, `symbol`·function·`Map`·`Set`은 `TypeError`를 던진다. decode는 ±(2^53−1) 밖의 uint64/int64를 반올림한 `number` 대신 `bigint`로 돌려준다.
- **동작 변경: Accept 협상과 null-body status (`@oa-sdk/router`)**: `negotiateResponseMediaType`이 Accept의 q-value와 wildcard를 따른다(RFC 9110 §12.5.1). 서버가 낼 수 있는 type(선언한 type, 없으면 `application/json`, 그다음 codec type)마다 가장 구체적으로 일치하는 Accept range의 weight를 매겨 가장 높은 type을 고르고, `q=0` range(`type/*;q=0`, `*/*;q=0` 포함)는 그 range가 다스리는 type을 거부한다. 선언한 type은 전달된 그대로(대소문자와 parameter 포함) 돌려준다. 이전에는 q-value와 wildcard를 무시했고, 정확히 일치하면 소문자로 바꾼 Accept 항목을 돌려줬다. 생성된 Hono contract router는 204·205·304 envelope에 `c.body(null, status)`로 답한다. 이전에는 chunk-stream의 304 Not Modified가 500이 됐다. contract 모드가 아닌 Hono/Express stub은 선언되지 않은 `options`를 참조하지 않고 binary request body를 raw byte로 읽는다(Express는 `express.raw()` middleware가 필요하다).
- **동작 변경: canonical JSON과 Interface Sketch IR v2 (`@oa-sdk/surface-ir`)**: `canonicalJsonStringify`와 `computeCanonicalHash`는 RFC 8785 표현이 없는 입력(NaN·Infinity, `bigint`, lone surrogate, `toJSON` 없는 `Map`·`Set`·class instance, 최상위 `undefined`·function·symbol)에 `TypeError`를 던진다. `toJSON`과 boxed primitive는 `JSON.stringify`처럼 처리하고, 배열 안의 `undefined`·function·symbol은 `null`이 된다. 이전에는 이런 값에 충돌하거나 유효하지 않은 출력을 돌려줬다. `INTERFACE_SKETCH_IR_VERSION`은 `oa-sdk.interface-sketch-ir.v2`이고, `InterfaceSketchIr.diagnostics`와 `SketchUnionOrEnumIr.members`가 필수가 되며 `versionHash` 값이 바뀐다. sketch parser는 tokenizer와 재귀 하강 scanner로 바뀌어 `extends`·template·`is X;` model과 중첩 `}`가 든 본문을 버리거나 자르지 않고, doc comment와 decorator는 바로 뒤의 선언에만 붙는다.
- **동작 변경: TypeSpec plugin이 만드는 client와 TanStack 코드 (`@oa-sdk/codegen`)**: 같은 pipeline에서 `pluginClient`가 돌았고 `clientFile`이 없으면 `pluginTanstackQuery`가 operation-method adapter `api-client.ts`(기본 이름 기준 `ApiClient` interface, `createApiClient(client?)`, `ApiClientResponseError`)를 만들고 `queries.ts`·`hooks.ts`가 그것을 import한다. `clientAdapter: false`로 끄고 `adapterOutput`으로 경로를 바꾼다. 이전에는 `queries.ts`가 `pluginClient`가 만들지 않는 `ApiClient`를 import해 문서의 builder pipeline이 컴파일되지 않았다. adapter method는 2xx면 `data`로 resolve하고, 선언된 JSON error model이 있는 status의 실패는 파싱한 body로, 그 밖의 실패는 `status`·`body`·`response`를 담은 `ApiClientResponseError`로 reject한다. 생성 `client.ts`에서 `<Fn>Errors`는 typegen의 `<Base>ErrorByStatus`이고 `isErrorStatus`가 status별로 좁힌다. 요청 header는 `Record<string, unknown>`이며 OpenAPI simple style로 직렬화하고, `clientClass: false`도 컴파일된다. axios transport는 `responseType: 'text'`로 받아 fetch transport와 같은 규칙으로 파싱하므로 빈 body의 `data`·`error`가 `''` 대신 `undefined`이고, 204·205·304에서 `Response` 생성이 throw하지 않는다. 예약어나 module binding(`createClient` 등)과 겹치는 operation 함수 이름에는 `_`를 붙이고(`delete` → `delete_`), 그런 짧은 이름은 내보내지 않는다(`Pets_delete`는 `petsDelete`만). 비분할 tier `options`·`hooks` 출력(plugin과 `oa-gen generate:tanstack --tier`)은 존재하지 않는 module을 import하지 않는 self-contained 코드다.
- **정확성: TypeSpec builder·Vite·pluginWire (`@oa-sdk/codegen`)**: `TspProjectBuilder.build()`는 항상 다시 컴파일하므로 `introspect()` 뒤에 낡은 문서를 쓰지 않고, `cwd`는 `introspect()`·`watch()`에도 적용된다. `vitePluginTsp`는 dev 시작 때 한 번만 빌드하고(`runOnDev: false` 존중), 상대 config를 Vite root 기준으로 풀며, rebuild 실패를 `logger.error`와 Vite error overlay로 알리고 full-reload하지 않는다. 기본 `//` banner는 JS/TS·`.proto`·`.jsonc` 파일에만 붙어 JSON 출력이 깨지지 않는다. `pluginWire`는 `BinaryCodecAdapter`를 import하고 model을 `types.ts`의 이름으로 참조하므로 `proto3` codec과 sub-namespace model에서도 컴파일되며, 예약된 `raw-binary` codec은 `WIRE_CODEC_NOT_IMPLEMENTED`를 보고한다.
- **동작 변경: wire schema 추출 (`@oa-sdk/codegen`, `@oa-sdk/typespec-decorators`)**: `extractWireSchemaFromOas`가 `allOf`(inline object와 component `$ref`)를 병합하므로 TypeSpec `extends` model이 상속 field를 잃지 않는다. 자동 field 번호는 명시 번호를 먼저 예약한 뒤 상속 field부터 매기므로, `@field` 번호 없이 상속하는 model은 이전 버전이 만든 `.proto`·codec과 번호가 달라질 수 있어 양쪽을 함께 다시 생성해야 한다. 중복되거나 범위(1–536870911, 19000–19999 예약 제외)를 벗어난 명시 `x-oa-sdk-protobuf-field` 번호는 오류로 실패한다. 기본 service·method 이름은 `@oa-sdk/core`의 `pascalCase`를 따른다(`TodoItems_list` → `TodoItemsList`, 이전 `TodoItemslist`). map-only·free-form object component는 내용이 사라진 빈 message가 되지 않고, `.proto` message와 Protobuf codec 없이 MessagePack codec과 TS type만 갖는다. 생성 Protobuf decoder는 기본값이라 생략된 required scalar·enum field를 proto3 기본값으로 채운다. payload 없는 method의 message 이름은 `Empty`이고, user model 등이 그 이름을 쓰면 `Empty2`, `Empty3`… 이 된다. 생성 RPC client는 빈 path 값(`''`, 빈 배열)을 요청 전에 `TypeError`로 거부한다. `Proto3TargetAdapter`는 constructor의 `emitEmptyMessage`를 지키고, `TypeSpecWirePipeline`은 경로에 `model`·`service`·`namespace`가 들어 있다는 이유로 source로 취급하지 않으며 `extractModelFromFile`·`extractModelFromSource`를 따로 제공한다. `@oa-sdk/typespec-decorators`에서는 Interface에 붙인 `@rpc`·`@wireFormat`이 member operation에 적용되고(operation 값 우선), Interface의 `@protobuf`와 `methodName`은 진단으로 보고된다. 중복 `@field` 번호는 `$onValidate` 진단이 되며, 상속 property를 재선언한 property(discriminator literal 등)는 base를 대체하므로 잘못 보고되지 않는다.
- **동작 변경: `@traceId`·`@chunkStream`과 governance export (`@oa-sdk/typespec-decorators`)**: `@traceId`의 `x-oa-sdk-trace.trackingId`는 선언한 type과, TypeSpec mutation engine이 만든 그 clone(`@typespec/versioning`의 버전별 snapshot, `MergePatchUpdate<T>`)에 붙는다. 그래서 `@versioned` service와 merge-patch 변형이 컴파일되고(이전에는 Duplicate traceId) 버전별 문서마다 id가 남는다. `model B is A`·`op b is a` 복사본, `interface B extends A`가 복제한 operation, spread 복사본, template instance(`@friendlyName` 포함) 같은 파생 type은 id 없이 컴파일된다. 이전에는 `model B is A`와 template instance가 Duplicate traceId 컴파일 오류였다. 한 번만 instantiate한 template도 이제 template의 id를 갖지 않는다. `@chunkStream`은 `targetChunkBytes`·`maxResidentBytes`·`maxL1MemoryBytes` override를 지키고(payload에 `maxL1MemoryBytes`가 추가되며 기본값은 `maxResidentBytes`의 절반), 타입이 틀리거나 범위를 벗어난 숫자·문자열 option과 object가 아닌 options 인자를 기본값으로 바꾸지 않고 `invalid-chunk-stream-rule` 오류로 보고하며 extension을 내지 않는다. 이전에 조용히 기본값으로 컴파일되던 그런 spec은 이제 컴파일 오류가 난다. `./governance`는 `verifyAtlasSchemaDrift`, `AtlasSchemaInspectOutputSchema`와 drift 검증 type을 export한다(`./storage-drift` subpath는 없다).
- **정확성: trace·sketch·contract canary (`@oa-sdk/codegen`, `@oa-sdk/ast-sync`)**: `oa-gen trace`는 path item 단위 `parameters`의 `$ref`를 그 path의 모든 operation에 연결하고, `$ref` parameter의 `*PathParams`·`*QueryParams`·`*HeaderParams` symbol을 포함하며, `x-persona` 배열과 object 모양의 storage·behavior·DPM ref를 읽는다(`SpecTraceGovernanceCapabilities.personas: string[]`, `persona`는 deprecated). interface operation id는 `operation:<file>:<Interface>.<op>`로 한정해 다른 interface의 같은 이름 operation이 source 좌표를 공유하지 않고(새 `typespec-provenance/duplicate-declaration-id` 진단), spec·provenance map·manifest 입력과 sidecar를 schema로 검증한다. `oa-gen sketch`의 `verify`·`check-contract`는 domain(`--domain`, 없으면 파일 basename)을 spec 이름으로 써서 `versionHash`가 machine과 무관하고, IR에 error 진단이 있으면 `verify`·`emit`·`check-contract`·`compare`가 종료 코드 1로 끝난다. 방출하는 OpenAPI의 ref는 `#/components/schemas/`를 가리키고, enum은 member 이름이 아닌 값으로, union은 `anyOf`로 내며, 선언되지 않은 type은 `x-oa-sdk-sketch-unresolved-type`으로 표시한다. Python stub은 `@dataclass(kw_only=True)`(Python 3.10+)라 optional field 뒤에 required field가 와도 import가 실패하지 않는다. `emitSketchArtifacts`는 v1 IR도 받아 v2로 올리고, CLI governance manifest의 sketch report schema도 `oa-sdk.interface-sketch-ir.v2`다. `@oa-sdk/ast-sync`의 `checkImplementationContract`는 계약 이름이 file에서 실제로 binding될 때만 구현으로 세고(주석·문자열·호출 위치·plain import는 세지 않는다), `language`를 지키며(`'auto'`는 Python을 감지), TypeScript `#private` member 줄을 주석으로 보지 않고, lock-reflex 패턴을 주석·문자열에서 찾지 않는다.
- **정확성: storyboard chunk server와 tiered storage (`@oa-sdk/chunk-stream-ui`, `@oa-sdk/chunk-stream`)**: `defineStoryboardChunkServer`는 문서 revision(`id`와 `changeToken`, token이 없으면 object identity)마다 bundle을 캐시하므로, provider가 매번 새 object를 돌려줘도 bridge와 seek 상태를 잃지 않고 대체된 bundle은 닫고 dispose한다. `close()`는 되돌릴 수 없어 handler와 `fetch`가 404로 답하고 `seek()`은 `E_CLOSED`로 실패한다. 이전에는 다음 호출이 조용히 새 bridge를 만들었다. `TieredStoragePort`는 `StorageTierOptions.memoryPreset`을 지켜 L1 예산을 preset의 50%로 잡는다(`maxL1MemoryBytes`가 우선이고 기본 32 MiB는 그대로).
- **동작 변경: RPC runtime (private `@oa-sdk/rpc`)**: `UntypedProcedures`는 `Record<string, RpcProcedureTypes>`(input·output `unknown`)이므로 type 인자 없는 `createRpcCaller(...).call()`은 `Promise<unknown>`을 돌려준다(untyped `createRpcClient`·`createRpcServer` handler는 그대로 `any`). 빈 path parameter는 `INVALID_INPUT`으로 거부한다. 이전에는 `''`가 parent route로 가서 다른 procedure가 실행됐다(`getUser({ id: '' })`가 사용자 목록을 돌려줬다). JSON-RPC fetch handler는 직렬화할 수 없는 결과를 그 항목만 -32603 `INTERNAL`로 바꾸므로 batch 전체를 잃지 않는다. JSON-RPC client는 응답을 엄격히 검증해, 형식이 틀린 error object, result와 error가 모두 없는 응답, 단일 호출에 대한 batch 응답을 `TRANSPORT`로 거부한다. `createAjvValidator`는 `format: binary` 문자열 schema에서 codec이 만든 값(`Uint8Array`·`File` 등)을 받는다.
- **정확성: Spec-Lens scenario (private `@oa-sdk/spec-lens-contract`, `@oa-sdk/spec-lens`, Spec-Lens UI)**: Spec-Lens UI의 scenario FSM과 렌더링된 view가 하나의 URL 상태를 공유하고 view가 전이를 dispatch하므로 browser 뒤로 가기, HUD, Diff가 일치한다. `createInitialScenarioState`는 scenario의 `initialView`를 따르므로 `?scenario=<id>` deep link가 전이 없는 view에서 시작하지 않는다. diff 단계 breadcrumb은 `baseId`·`headId`를 기록하고 `STEP_BACK`이 그 쌍을 복원하며, 기본 scenario의 재진입 규칙은 payload를 context에 쓴다. `spec-lens scenario verify`는 도달할 수 없는 view, `boundedViews` 밖의 `initialView`·전이·goal, 선언되지 않은 guard를 실패로 보고한다.
- **정확성: integration harness (`test/integration`)**: EWIC `ewic_verify_execution`은 검증 전에 actor를 인가하므로 거부된 호출자에게 현재 hash를 돌려주지 않고, shared-context harness tool은 provider 예외를 숨기고 fail-closed로 답하며, `SourceReferenceAdapter`는 `web`·`semantic` provider를 `drive`로 바꾸지 않는다.
- **문서·게이트**: [TypeSpec builder platform](./guides/typespec-builder-platform.md), [client and query consumption](./guides/client-and-query-consumption.md) §8, [declarative spec configuration](./guides/declarative-spec-configuration.md)(`oa-gen generate`의 router 방출), [library entrypoints](./guides/library-entrypoints.md)(`@oa-sdk/codegen/plugin`), [TypeSpec RPC](./guides/typespec-rpc.md), [WebMCP projection and relay](./guides/webmcp-projection-and-relay-guide.md), scenario lifecycle·FSM guide, use case guide, telemetry·DPM concept 문서와 package README를 현재 코드에 맞게 고쳐 없는 API·endpoint·상수를 안내하지 않는다. [platform-scope](./internal/platform-scope.md)의 Downstream Integration에 `webmcp-peer`를 넣어 15개로 맞췄다. `test/e2e/typespec-plugin`은 실제 shipped plugin으로 pipeline을 돌리고 생성 코드를 typecheck하며, CI가 integration harness 다음 단계에서 새 root script `pnpm test:e2e:typespec-plugin`으로 실행한다. `@oa-sdk/rpc`와 `@oa-sdk/telemetry`의 `typecheck`는 `tsconfig.test.json`으로 test file도 검사한다. CI의 `pnpm type-registry:check`가 다시 통과한다. 명시적 `any`는 249에서 134로, 이중 assertion은 37에서 27로, 이름 있는 validator를 거치지 않는 deserialize는 175에서 118로 줄었고 [policy](./internal/type-registry-policy.json)의 budget을 그 값으로 낮췄다. 검증할 domain type이 없는 detector false positive 9건(string→string percent-decoder `decode`, `TextDecoder.decode`, `unknown`을 돌려주는 `@oa-sdk/rpc` body codec)은 만료일이 있는 allowlist로 올렸다. `tests/e2e/output-routing-tanstack`은 2026-10-18 skill 재배치에 맞춰 `.agents/skills-optional/`을 본다.

## 2026-10-13 — TypeSpec 계약 기반 RPC와 wire 호환 Protobuf codec (`@oa-sdk/surface-ir`, `@oa-sdk/codegen`, 새 private `@oa-sdk/rpc`)

TypeSpec으로 선언한 operation을 REST route 단위가 아니라 typed procedure 호출로 쓸 수 있게 했다. 사용법은
[TypeSpec 계약을 RPC로 쓰기](./guides/typespec-rpc.md)에 있다.

- **RPC contract (`@oa-sdk/surface-ir`)**: `buildRpcContract()`가 operation마다 dotted-name procedure(`@rpc` 이름 → 첫 tag camelCase + operationId), 파라미터와 body를 합친 object 입력, 성공 출력, status별 오류, REST request를 다시 만들 HTTP binding을 담은 JSON 계약 `oa-sdk.rpc-contract.v1`을 만든다. streaming operation과 이름·필드 충돌은 진단과 함께 제외한다.
- **타입 생성 (`@oa-sdk/codegen`)**: `pluginRpc()` / `generateRpcModule()`이 `<Name>Procedures` 타입 맵과 `<name>Contract` 데이터를 방출한다.
- **런타임 (`@oa-sdk/rpc`, private)**: `createRpcServer`의 한 handler 집합이 JSON-RPC 2.0(`createJsonRpcFetchHandler`, 메시지 채널용 `handleJsonRpc`)과 원래 REST route(`createRestFetchHandler`)를 함께 제공하고, `createRpcClient`는 `createHttpTransport`·`createJsonRpcTransport`·`createLocalTransport`로 호출한다. OpenAPI style/explode 직렬화, `RpcError` 오류 모델, Ajv 검증기(`./ajv`), 내부 예외 은닉, body 키·`__proto__`·`..` path 방어를 포함한다.
- **Wire RPC client (`@oa-sdk/codegen`)**: `pluginWire`의 `rpc-contract`가 만드는 `<Service>RpcClient`가 path·query·header·cookie 파라미터로 route를 채우고, 선언된 media type대로 JSON 또는 `BinaryCodecAdapter`로 body를 인코딩·디코딩하며, 실패를 `WireRpcError`로 알린다. 이전에는 파라미터가 빠지고 body를 직렬화하지 않았다.
- **Protobuf codec (`@oa-sdk/codegen`)**: 생성 codec이 생성 `.proto`와 같은 wire format을 쓴다. 중첩·반복 message, enum 번호, `map<>`, 64-bit·zigzag·fixed 타입, packed repeated, union 등의 JSON fallback을 지원하고 protobufjs와 양방향으로 검증한다. 이전에는 중첩 object가 있는 model(production 계약 예시 16개 중 7개)에서 인코딩이 throw했고 object field가 `"[object Object]"`가 됐다. production 계약 예시 기준 크기는 JSON의 45–75%다.
- **문서·게이트**: [Spec](./internal/spec.md#typespec-계약-rpc와-바이너리-wire-), API index, feature-test-matrix(`typespec-rpc-contract-runtime`, `wire-binary-codecs`), release policy(Downstream 14개), [scope decision](./internal/platform-scope.md#typespec-contract-rpc-runtime--2026-10-12)을 갱신했다.

## 2026-10-05 — Installable onboarding: companion packages and registry specifiers (`@oa-sdk/codegen` 0.9.0, `@oa-sdk/parser` 0.4.0, `@oa-sdk/typespec-decorators` 0.3.0, `@oa-sdk/core` 0.3.1; first npm release candidates `@oa-sdk/router` 0.2.2, `@oa-sdk/client` 0.2.2, `@oa-sdk/mock-server` 0.1.4, `@oa-sdk/surface-ir` 0.1.1)

`npx @oa-sdk/codegen init --yes` → 설치 → `oa-gen generate`로 이어지는 공개 온보딩 흐름이 oa-sdk 워크스페이스 밖에서도 끝까지 동작하도록 정리했다.

- **`oa-gen init`의 `@oa-sdk` 지정자 (`@oa-sdk/codegen`)**: 프로젝트와 해당 패키지가 같은 pnpm 워크스페이스의 멤버일 때만 `workspace:*`를, 그 밖에는 codegen이 빌드된 릴리스와 호환되는 범위(`^<version>`)를 쓴다. 이전에는 항상 `workspace:*`를 써서 npm이 `EUNSUPPORTEDPROTOCOL`로 설치를 거부했다. 비공개 `@oa-sdk/personas`는 그 패키지를 가진 워크스페이스 안에서만 추가하고, 밖에서는 추가하지 않은 이유를 출력한다. 그 뒤 `package.json`에서 프로젝트가 있는 위치에서 설치할 수 없는 `@oa-sdk` 항목을 모두 해야 할 조치와 함께 출력한다. 해당 패키지를 가진 워크스페이스 밖의 `workspace:` 항목(이전 `init`이 쓴 항목 등)은 출력한 범위로 바꾸고(`init`이 쓰는 패키지는 `--force`가 바꾼다), 그 밖의 `@oa-sdk/personas` 항목은 지정자와 관계없이 삭제하라고 안내한다(`--force`도 그대로 둔다). 이전에는 `init --force`가 personas에 "not added"만 출력해 설치를 깨는 항목이 남아 있음을 드러내지 않았다.
- **Companion package (`@oa-sdk/codegen`)**: router·client·mock-server가 만드는 산출물을 조용히 건너뛰지 않는다. 그 산출물만을 위한 명령과 명시적으로 켠 산출물의 `oa-gen generate`는 빌드 기준 버전으로 고정한 설치 명령을 출력하고 실패한다. `init`은 스캐폴드가 쓰는 companion을 `devDependencies`에 기록한다. `oa-gen mock`은 mock-server의 선택적 peer인 `msw` 없이 동작한다.
- **mock-server entry point (`@oa-sdk/mock-server`)**: MSW adapter(`createMswHandlers`, `createMswMockServer`, `MswHandlerOptions`, `MswMockServer`)는 `@oa-sdk/mock-server/adapters/msw`(Node, Vitest)와 `@oa-sdk/mock-server/browser`(browser bundle)에만 있고, 패키지 루트는 더 이상 이를 다시 export하지 않는다. 선택적 peer인 `msw`는 이 두 entry point에만 필요하므로 루트·`/adapters/node-http`·`oa-mock` CLI와, 루트를 불러오는 `oa-gen mock`은 `msw` 없이 로드된다. 루트가 MSW adapter를 다시 export하던 candidate에서는 깨끗한 설치의 `oa-gen mock`과 `init`이 추가한 `mock` 스크립트가 `Cannot find package 'msw'`로 실패했다.
- **스캐폴드 스크립트 (`@oa-sdk/codegen`)**: `init`이 추가하는 스크립트가 그대로 실행된다. `oa-gen mock`은 `--tsp`/`--spec` 없이 실행하면 설정의 spec target(하나일 때)을 서빙하고, `oa-gen validate`는 `profile` 없는 target을 `oa-gen generate`처럼 `full-api-document`로 검증한다. npm 11의 `npm init`이 쓰는 `"type": "commonjs"` 프로젝트에서도 ES module로 작성된 `oa.config.ts`를 ES module로 변환해 불러오므로, 이전처럼 설정을 읽는 명령이 "Cannot use import statement outside a module"로 실패하지 않는다.
- **Release gate**: codegen export는 embed된 빌드 기준 버전(companion과 `init`이 범위를 쓰는 `@oa-sdk/core` 등)이 같은 export에 있거나 이미 npm에 있어야 통과한다. exporter와 public runtime smoke는 선택적 peer 없이 설치한 consumer에서 모든 public entry point를 import하고(public runtime smoke는 `oa-gen mock`도 실행한다), 선택적 peer가 필요한 entry point는 `release-policy.json`의 `optionalPeerEntryPoints`에 선언한다. codegen pack smoke는 pack된 `oa-gen init`이 모든 archetype에서 워크스페이스 밖에 registry 범위만 쓰는지 확인하고, `"type": "commonjs"` 프로젝트에서 그 스캐폴드의 `validate`·`mock` 스크립트를 실행한다. codegen 테스트는 `oa-gen`이 불러오는 companion entry point가 선택적 peer 없이 로드되는지 확인한다.
- **공유 route index (`@oa-sdk/parser`, `@oa-sdk/codegen`, `@oa-sdk/mock-server`)**: `loadSchema()`가 `parseDocument()`와 같은 route indexer로 `RouteIndex`를 만들어 두 진입점이 같은 route를 돌려준다. operation 위치의 Reference Object 처리와 typegen 출력 변화는 각 패키지 CHANGELOG에 정리했다.
- **증분 typegen (`@oa-sdk/codegen`)**: `oa-gen typegen --incremental`이 이전 출력을 재사용한다. 이전에는 증분 실행도 매번 전부 다시 파싱·생성·기록했다. generator package version, `--style`, 이전 실행이 소비한 모든 입력(entry spec과 외부 `$ref` 문서의 내용, `.tsp`이면 TypeSpec 컴파일러가 읽은 파일·import 해석 중 확인한 경로·link 대상·JS decorator 모듈 그래프), 출력 hash가 그대로면 재생성을 건너뛰고, 증분 실행마다 stderr에 `incremental: typegen up to date, regeneration skipped (...)` 또는 `incremental: typegen regenerating (<reason>)` 한 줄을 남긴다. 기록은 SQLite workspace index의 새 테이블 `generation_targets`, `generation_target_observations`에 저장한다(추가 테이블이라 index schema version은 그대로). `--incremental` 없는 `typegen`·`validate`는 더 이상 쓰지 않는 index를 위해 entry spec을 스캔하지 않는다.
- **`oa-gen surface` (`@oa-sdk/codegen`, `@oa-sdk/surface-ir`)**: OpenAPI 또는 TypeSpec artifact에서 target-neutral surface IR, Forge projection, command별 OpenAPI Overlay, manifest를 만든다. surface IR은 새 `@oa-sdk/surface-ir` 패키지가 소유한다.
- **공유 노드 처리 (`@oa-sdk/codegen`)**: YAML alias처럼 입력의 여러 위치가 공유하는 노드를 정규화(`oa-gen normalize`/`collect`)와 3.2 upgrade 보고가 모든 위치에서 처리한다. `zodToSchema()`는 변환 root만 펼치고 그 아래의 등록된 schema는 모두 `$ref`로 내보내므로, `generateComponents()`의 결과가 component 순서에 따라 달라지거나 self-reference(`Id: { $ref: '#/components/schemas/Id' }`)를 만들지 않는다.
- **표준 TypeSpec 계약 (`@oa-sdk/typespec-decorators`)**: `lib/contracts.tsp`의 `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`, `ErrorResponse<Status>`, `StandardError`, `StandardValidationError`, `StandardHttpErrors`를 `import "@oa-sdk/typespec-decorators"`가 함께 불러온다. 데코레이터와 같은 `OaSdkTypeSpec` namespace에 있으므로 `using OaSdkTypeSpec;`으로 쓴다(README와 가이드가 안내하던 `OaSdkContracts` namespace는 없다).
- **`oa-gen tsp diff`의 git ref 비교 (`@oa-sdk/codegen`)**: `--base origin/main --head HEAD`처럼 경로 없는 git ref가 자기 커밋에서 상대편의 entry point를 읽는다. 이전에는 base를 자기 자신과 비교해 `--fail-on-breaking`이 항상 통과했다. entry point를 정할 수 없으면 `<ref>:<path>`를 요구하며 실패한다.
- **상대 경로 (`@oa-sdk/codegen`)**: `oa-gen drift`, `drift:live`, `review`가 상대 경로를 받는다. 이전에는 차이가 없어도 `Invalid behavior record`로 종료 코드 1이 났다.
- **`oa-gen generate`의 정리와 실패 처리 (`@oa-sdk/codegen`)**: `outputRouting.pruneOrphans: false`를 지키고, 정리할 때는 같은 설정 파일(또는 같은 `--spec` 파일)로 자기가 기록한 파일만 지운다. `generate:tanstack` 산출물이나 다른 설정의 파일은 지우지 않는다. 명시적으로 켠 산출물이 생성 중 오류를 내면 파일을 쓰지 않고 종료 코드 1로 끝난다. 요약은 operation 수와 문서가 선언한 OpenAPI 버전을 표시한다.
- **여러 파일로 나눈 스펙 (`@oa-sdk/codegen`)**: `oa-gen generate`, `generate:tanstack`, `mock`이 다른 파일을 가리키는 `$ref`(`./schemas.yaml#/Health`, `./paths/user.yaml` 등)를 `generate:client`처럼 스펙 파일의 위치에서 풀어 router·client·mock-server에 넘기고, `generate`는 CRDT 엔티티도 푼 스키마에서 찾는다. 이전에는 풀지 않은 채 넘겨 동반 패키지가 스펙을 거부했으므로(`requires complete $ref resolution; received a partial ParsedDocument: unsupported-ref ...`), 여러 파일로 나눈 스펙에서는 핸들러 계약·클라이언트·TanStack 옵션·mock 서버가 만들어지지 않았고, `components.schemas`의 항목이 다른 파일의 스키마를 가리키는 CRDT 엔티티는 CRDT 모듈 4개가 경고 없이 빠졌다. 없는 파일이나 서로만 가리키는 `$ref`처럼 풀 수 없는 `$ref`는 같은 방식으로 실패하며 오류가 그 `$ref`와 진단 코드(`external-ref-read-failed`, `ref-cycle`)를 출력하고, `generate`는 명시적으로 켠 산출물이면 종료 코드 1로 끝난다. 새 `oa-gen surface`도 같은 방식으로 풀어 Surface IR을 만들므로 다른 파일에 있는 path item의 operation도 투영하고, 풀 수 없는 `$ref`가 있으면 `surface-ir/incomplete-document` 오류와 함께 종료 코드 1로 끝난다. `generate`가 쓰는 `<id>.openapi.json`·`<id>.schema.json`에는 `$ref`가 스펙에 쓴 그대로 남는다.
- **여러 파일로 나눈 스펙의 `oa-mock`과 operation 수 (`@oa-sdk/mock-server`, `@oa-sdk/codegen`)**: `oa-mock` CLI가 다른 파일을 가리키는 `$ref`를 검증할 때처럼 스펙 파일의 위치에서 풀어 서버에 넘기므로, 다른 파일에 있는 path item의 operation도 서빙한다. 이전에는 `$ref`를 풀어 검증하고도 서버에는 풀지 않은 문서를 넘겨, 여러 파일로 나눈 스펙에서는 항상 `서버 시작 실패: ... unsupported-ref ...`로 종료 코드 1이 났다. `oa-gen generate` 요약의 `N ops`도 생성기가 읽는, `$ref`를 푼 스펙에서 세므로 다른 파일에 있는 path item의 operation을 포함한다. `tags`에 `null` 항목이 있는 문서처럼 파서가 읽을 수 없는 문서는 쓴 그대로의 문서에서 세므로, operation 수 때문에 실행이 실패하지는 않는다.
- **`oa-gen init` 스크립트 (`@oa-sdk/codegen`)**: 그대로 실행되는 스크립트만 쓴다. `generate:router`·`generate:client`·`generate:contract` 별칭과 동작하지 않던 `test:contract`, `audit:wire`, `audit:csp`, `audit:shape`, `personas:check`를 뺐고, enterprise는 커밋된 `openapi.baseline.yaml`과 비교하는 `lint:spec`·`diff`·`baseline:update`·`ci:gate`를 쓴다. 이전 init이 남긴 스크립트는 이유와 조치를 함께 알린다.
- **성능 (`@oa-sdk/codegen`)**: TypeSpec 컴파일러와 TypeScript는 그것을 쓰는 명령에서만 불러오고, `oa-gen generate`는 projection된 spec을 한 번만 파싱하며, `audit:csp`는 규칙을 위반할 수 없는 파일의 AST 파싱을 건너뛴다.
- **버전**: npm의 codegen 0.8.1, parser 0.3.0, core 0.3.0, typespec-decorators 0.2.0은 현재 소스와 내용이 달라 함께 올렸다. 새 codegen은 parser 0.3.0에 없는 `appendJsonPointer`를 import한다. router·client·mock-server·surface-ir는 이 릴리스에서 처음 npm에 배포된다. 각 패키지가 배포하는 surface는 패키지 CHANGELOG의 첫 배포 항목에 정리했다.

## 2026-09-13 — Platform deficiency remediation: router response envelope defense, typed handler error unions, AbortSignal pass-through, infinite queries, monorepo import resolver, unified codegen pipeline, and Linux file watching (`@oa-sdk/codegen` 0.8.1, `@oa-sdk/client` 0.2.1, `@oa-sdk/router` 0.2.1, `@oa-sdk/spec-lens` 0.1.5)

전수 코드 리뷰를 통해 식별된 9대 플랫폼 결함(R1–R9)을 전면 해결하고 실증 회귀 검증을 완료했다.

- **Router 응답 엔벨로프 충돌 방어 (`@oa-sdk/router`)**:
  - `'status' in result` 조건으로 인해 비즈니스 엔티티(`{ id: 'order_1', status: 'PENDING' }` 등)의 데이터가 유실되던 결함을 3중 엄격 검증(`'body' in result && typeof result.status === 'number'`)으로 수정하여 200 OK JSON 본문으로 온전하게 직렬화.
- **핸들러 컨트랙트 Multi-Status 및 Typed Error 응답 유니언 (`@oa-sdk/router`)**:
  - `HandlerResponse`를 문서화된 모든 상태 코드(2xx, 4xx, 5xx)를 포괄하는 식별된 유니언(Discriminated Union)으로 확장하여 `as any` 없이 타입 안전한 에러 응답(`{ status: 404, body: NotFoundError }`) 반환 지원.
- **`AbortSignal` 및 `RequestInit` 관통 파이프라인 (`@oa-sdk/client`)**:
  - 모든 생성 클라이언트 메서드에 `options?: { signal?: AbortSignal, headers?: Record<string, string> }`를 확장하고 네이티브 `fetch`로 전달. TanStack Query `queryFn`에서 전달된 취소 시그널을 실제 HTTP 요청 중단으로 관통.
- **TanStack Query Infinite Query 자동 생성기 (`@oa-sdk/client`)**:
  - 커서/오프셋/페이지네이션 파라미터 감지 휴리스틱(`detectPagination`)을 탑재하여 `*InfiniteQueryOptions()` 및 `initialPageParam`, `getNextPageParam` 팩토리 자동 합성.
- **모노레포 패키지 경계 인식 임포트 해석기 (`@oa-sdk/codegen`)**:
  - 워크스페이스 간 산출물 분산 배포 시 깊은 상대 경로 대신 대상 패키지의 정규 이름(`@oa-sdk/client` 등)으로 자동 임포트(`findNearestPackageJson`, `resolvePackageSpecifier`).
- **`RouterRenderOptions` 컨텍스트 주입 타이핑 보강 (`@oa-sdk/router`)**:
  - `contextInjection`, `contextImport`, `contextTypeName` 필드를 정규 선언하여 무타입 단언 제거.
- **단일 선언적 종합 파이프라인 통합 (`oa-gen generate`)**:
  - `oa-gen generate` 단일 커맨드로 스펙 프로젝션 $\rightarrow$ 타입 가드 $\rightarrow$ 핸들러 컨트랙트 $\rightarrow$ 클라이언트 SDK $\rightarrow$ TanStack Query 옵션 일괄 생성 및 `outputRouting` 디스패치 파이프라인 완결.
- **`oa-gen init` 내 `outputRouting` 프리셋 지원 (`@oa-sdk/codegen`)**:
  - `--routing <default|fsd|monorepo|by-kind>` 플래그 및 대화형 설정을 지원하여 아키텍처별 경로 자동 구성.
- **Linux 환경 파일 와칭 재귀 폴백 엔진 (`@oa-sdk/codegen`)**:
  - Linux `fs.watch({ recursive: true })` 제약을 극복하는 재귀 디렉터리 와커 및 동적 생성 폴더 추적 엔진 탑재.

## 2026-09-12 — Output routing, TanStack Query v5 3-tier generator, multi-framework routers, target onboarding, and live mock watch (`@oa-sdk/codegen` 0.8.0, `@oa-sdk/client` 0.2.0, `@oa-sdk/router` 0.2.0)

모노레포의 5대 핵심 플랫폼 역량이 완비되어, 프론트엔드/백엔드 풀스택 코드 생성 및 개발자 경험(DX) 워크플로우를 포괄적으로 확장했다.

- **산출물 경로 라우팅 커스터마이징 엔진 (`outputRouting`)**:
  - `oa.config.ts`에 `outputRouting` 설정을 도입하여 템플릿 패턴(`{tag}`, `{kind}`, `{operationId}`, `{group}`, `{method}`, `{target}`) 및 케이싱 변환(`kebab`, `camel`, `pascal`)을 지원.
  - 태그/메서드/오퍼레이션/종류별 세부 규칙 매처(`rules`) 및 산출물 분류별 디스패칭(`byKind`) 지원.
  - 서로 다른 디렉토리로 분산 방출되는 산출물 간의 상대 import 경로(`path.relative`) 및 `tsconfig.json` path alias 자동 계산.
  - `.oa-manifest.json` 기반의 3단계 안전 고아 파일 정리(`pruneOrphans: true`)로 수동 작성 코드 손상 없이 이전 생성 산출물만 안전하게 정리.
- **TanStack Query (React Query) v5 3계층 코드 생성기 (`oa-gen generate:tanstack`)**:
  - **Tier 1 (Key Factory)**: `*Keys` 계층형 쿼리 키 트리(`all`, `lists()`, `list(filters)`, `details()`, `detail(id)`) 자동 생성.
  - **Tier 2 (Options Factory)**: `@tanstack/react-query`의 `queryOptions()` 및 `mutationOptions()`를 순수 팩토리 함수로 생성. 프론트엔드 런타임 의존성 없이 SSR prefetching(`queryClient.prefetchQuery`) 및 클라이언트 훅에서 공용 사용 가능.
  - **Tier 3 (Hook Factory)**: React 19 호환 `use<Op>Query`, `use<Op>Mutation`, `useSuspense<Op>Query` 클라이언트 훅 생성.
  - `oa-gen generate:tanstack --spec <path> --output <dir> [--tier 1|2|3|all]` CLI 지원 및 `outputRouting` 완벽 연동.
  - 라우터 핸들러 계약 및 `@oa-sdk/client`와 100% 일치하는 와이어 파라미터/응답 타입 보장.
- **다중 프레임워크 라우터 스텁 및 순수 핸들러 계약 분리 (`@oa-sdk/router`)**:
  - **핸들러 계약 분리 패턴 (`*.contract.ts`)**: `generateHandlerContract`를 통해 비즈니스 로직 시그니처와 프레임워크 라우팅 코드를 물리적으로 분리하여 스펙 재컴파일 시 구현 코드 덮어쓰기 방지.
  - **다중 프레임워크 라우터 바인더 (`generateRouter`)**:
    - `fastify`: JIT 인라인 스키마 컴파일 및 `fast-json-stringify` 최적화 지원.
    - `elysia`: Bun 네이티브 Zero-copy 컨텍스트 구조분해(`{ params, query, body, set }`) 및 메서드 체이닝 지원.
    - `hono`: Cloudflare Workers, Node, Bun을 위한 Web 표준 Fetch 기반 라우터 생성.
    - `express`: 레거시 및 기존 Express 미들웨어 호환 라우터 생성.
- **타깃 분리형 대화형/비대화형 온보딩 엔진 (`oa-gen init`)**:
  - `oa-gen init [--target <framework>] [--archetype <mvp|microservice|enterprise>] [--yes] [--dry-run] [--force]` 지원.
  - 6대 타깃 프로필(`fastify`, `elysia`, `hono`, `express`, `nestjs`, `generic`) 및 3대 수명주기 아키타입 사전 설정.
  - **엄격한 런타임 격리 (Strict Runtime Isolation)**: Bun 환경에는 순수 Bun 스크립트(`bun --watch`, `bun x oa-gen`)와 `@types/bun`만 주입하고 Node 도구 오염을 원천 차단; Node 환경에는 Node ESM 스크립트(`tsx watch`) 주입.
  - `common/schema-detector.ts`를 통한 `.tsp`, `openapi.yaml`, `openapi.json`, `@oaOperation` JSDoc 소스 신뢰도 점수 기반 자동 식별.
  - `common/package-patcher.ts`를 통한 들여쓰기/개행 보존 및 비파괴적 `package.json` 병합.
- **실시간 소스 관측 Mock Server (`oa-gen mock --watch`)**:
  - `.tsp`, `.yaml`, `.json`, `@oaOperation` 소스를 100ms 디바운스로 실시간 관측하여 인메모리 컴파일.
  - `@oa-sdk/mock-server`의 원자적 `server.updateSpec(newDoc)` 라우트 스왑을 호출하여 소켓 단절이나 서버 재시작 없이 즉시 핫 리로드.
  - 구문/컴파일 오류 시 기존 정상 라우트를 유지하는 에러 쉴딩(Error Shielding) 적용.

## 2026-08-30 — World stimulus and projection integrity (`0.5.0`)

Breaking pre-1.0 World Model contract hardening: action role bindings now require
UUID values, time-advance alternatives are sealed, and projection bundle items
inherit their World/model/revision context from the outer envelope.

- A time-advance request can no longer carry both `targetLogicalTime` and
  `duration`; unknown variant fields are rejected.
- `ProjectionBundleItem` contains only `projectionId` and `value`, preventing a
  bundle from representing a child projection from a different World or revision.
- Schema-driven mock SSE responses end by closing the response rather than
  emitting an undocumented `[DONE]` frame outside the declared item schema.

## 2026-08-30 — Validation summary and self-update hardening (`0.4.0`)

Breaking pre-1.0 contract hardening: validation details can now contain only the
content-free summary shapes emitted by the mock server, and `PATCH /me` requires
a non-empty `name` update while rejecting `role` and other unknown fields.

- `ValidationError.received` now references a sealed string/array/object/scalar
  summary union, so raw submitted passwords, tokens, objects, and arrays are
  invalid contract values rather than merely discouraged documentation.
- `UpdateMeRequest` is sealed and requires `name`; callers can no longer send
  an empty update or a self-role change through the documented request schema.

## 2026-08-30 — Contract safety and native SSE (`0.3.0`)

production TypeSpec contract를 `0.3.0`으로 올리고, consumer-visible 안전성·streaming·user
creation contract gaps를 정리했다.

- `POST /users`는 duplicate email에 대한 `409 Conflict`를 명시하고, persona matrix에도
  negative-path를 연결했다. hard-delete `deleteUser`와 audited `purgeUser`의 lifecycle 설명도
  서로 모순되지 않도록 정렬했다.
- `/health/stream`은 native TypeSpec SSE contract로 승격했다. generated OpenAPI는
  `text/event-stream`과 OAS 3.2 `itemSchema`를 제공하며, mock server와 generated client는 named
  SSE frame을 생성·소비한다.
- mock validation error는 password, token, secret, XML, multipart와 전체 request object의 원문을
  더 이상 반사하지 않는다. `received`/legacy `value`는 type/length/count 요약만 반환한다.
- TypeSpec provenance와 Spec Lens toolchain은 native event union/SSE dependencies를 인식하며,
  OAS 3.2-aware unused-component lint가 native pure-ref event alias를 올바르게 처리한다.

## 2026-08-30 — Artifact release readiness and guide alignment

artifact-only public package release를 준비하는 source-repository 절차를 한 곳으로 정리하고,
사용자 가이드의 obsolete CLI 경로를 실제 public surface와 맞췄다.

- `pnpm release:preflight`는 clean-worktree 확인과 문서·release policy·TypeSpec·downstream·Core
  build/typecheck/test·codegen package pack smoke를 순차 실행한다. 이는 npm publish를 실행하지 않으며, 실제 registry promotion은
  별도 artifact repository의 승인 workflow로 남는다.
- `release-readiness.md`와 release preparation guide는 package artifact export, external promotion,
  API runtime launch를 별도 판단으로 분리한다. 현재 roadmap도 active Core Platform work와
  historical/maintenance context를 구분한다.
- Quick Start와 World Model guide는 존재하지 않는 `oa-gen router`/`oa-gen client` command 대신
  private `generateRouter()`/`generateClient()` package API를 안내한다. docs gate는 built CLI form도
  live command registry로 검증해 같은 문서 drift를 차단한다.
- public distribution candidate인 core와 parser에 package README를 추가했다. exporter는 public npm
  registry와 `@oa-sdk` scope registry를 명시하고, non-404 registry failure를 unpublished version처럼
  취급하지 않으며, official `--version`이 committed source package version과 일치할 때만 export한다.

## 2026-08-10 — TypeSpec extension vocabulary v5 consolidation

Sidecar-less authored bundle의 extension vocabulary를 v5 하나로 통합하고, 완료된
roundtrip 이관 계획을 현재 운영 자료로 정리했다.

- `oa-sdk.typespec-extensions.v1`부터 v4까지의 parser support, fixture manifest, extension 문서를
  제거했다. bundle check는 v5 이외의 extension schema version을 거부한다.
- current source-of-truth는 v5 schema, authoring ownership guide, production operations로 구성한다.
  완료된 평가·migration·versioned roadmap 문서는 제거했고 ADR과 이 changelog는 결정 이력으로 보존한다.
- production TypeSpec source와 canonical fixture는 v5 manifest를 사용한다. 이 변경은 contract
  version이나 npm package version을 올리지 않는다.

## 2026-08-10 — Release policy v4 and documentation alignment

현재 release policy를 v4로 승격하고, policy manifest를 기준으로 문서의 workspace 분류와
버전 표기를 정렬했다.

- Core Platform은 `@oa-sdk/typespec-decorators`를 포함한 8개 package이며, Downstream 3개를
  더한 11개 package가 release-tracked다. 10개 maintenance/app workspace는 ignored 상태를 유지한다.
- npm distribution candidate는 core, openapi-projection-contract, typespec-decorators, parser,
  codegen의 5개다. 이 변경은 publish 승인이나 package version bump를 수행하지 않는다.
- `pnpm check:release-policy`는 release-management의 정책 스냅샷을 manifest에서 재계산해
  검증하므로, 이후 수동 count 표기 drift를 gate에서 차단한다.
- OAS 3.2 reference 분할본의 source·appendix 링크를 복구하고 이를 docs gate에 포함했다.
  ADR-004는 canonical 3.2 authoring과 generated 3.1 compatibility output의 경계를 분명히 한다.
- `@oa-sdk/schemas`의 기본 build와 prepack은 canonical TypeSpec contract에서 3.1 bundle을
  생성한다. CI는 bundle을 canonical 3.1 artifact와 비교해 stale package export를 차단한다.
- 사용자 가이드의 contract version 예시와 persona 도구의 merged-spec 복구 안내를
  TypeSpec-first 생산 경로로 정렬했다.
- persona check와 bundle artifact 비교 예제도 rollback source가 아닌 canonical TypeSpec
  artifact를 사용하도록 정리했다.

## 2026-07-25 — TypeSpec external observation evidence

spec-lens의 외부 경로 관측을 typed `observationInputs`로 승격했다.

- `candidate-only`는 revision 후보만 확장하고, `evidence-only`는 revision별 SHA-256 또는
  `missing`/`unreadable` 상태를 TypeSpec snapshot provenance에 보존한다.
- Local Git, GitHub, GitLab, file-diff adapter는 evidence를 data로만 bounded read한다. 이 입력은
  compiler entry, revision `tspconfig`, arbitrary emitter config로 절대 승격되지 않는다.
- 입력은 최대 16개이며, evidence는 파일 최대 4개(각 2 MiB, 총 8 MiB)를 adapter당 동시 2개씩
  읽는다. directory evidence는 `unreadable`로, 없는 경로는 `missing`으로 남긴다.
- 기존 `watchPaths`는 `candidate-only` 호환 별칭으로 유지한다. 실제 TypeSpec emitter fixture와
  adapter/cache/contract 회귀 테스트로 이 경계를 검증한다.

## 2026-07-24 — TypeSpec ownership, trusted helpers, and deployment projections

Production TypeSpec source의 composition/metadata/runtime 관측 경계를 명시적으로
분리했다.

- `main.tsp`는 composition root로 축소하고, service/info/server/tag,
  security scheme, reusable component metadata를 각각 `typespec/metadata/`의 owner
  module로 이동했다.
- `@oa-sdk/typespec-decorators`는 arbitrary JSON extension helper 대신 v5 response
  component reference를 검증하는 좁은 `@oaUseResponseComponent` helper를 제공한다.
  spec-lens는 이 trusted package의 source/lib/dist digest를 toolchain evidence에 포함한다.
- `oa-sdk.typespec-projections.json`과 `schema:project-typespec:{local,staging,production}`은
  restored TypeSpec contract에서 `servers`만 바꾼 gitignored deployment artifact를 만든다.
  이 projection은 승인 snapshot 또는 두 번째 contract source가 아니다.
- spec-lens TypeSpec project는 `observationInputs`로 lockfile, root package, trusted decorator
  package 변경을 관측한다. `evidence-only` lockfile은 hash/status provenance만 남기며, 모든
  observed path와 revision `tspconfig`는 compiler workspace에 실행/주입하지 않는다.

현재 기본 자동 감지 TypeSpec project의 `observationInputs`는 `package.json`, `pnpm-lock.yaml`,
`packages/typespec-decorators`다. 운영 절차는 [TypeSpec authoring conventions](./guides/typespec-authoring-conventions.md),
[basic spec usage](./guides/basic-spec-usage.md), [spec-lens](./spec-lens/README.md)에 정리했다.

## 2026-07-11 — Markdown과 GitLab agent operations 저장소 분리

Core schema/spec management가 아닌 제품 surface를 두 독립 Git 저장소로 물리 추출했다.

- `markdown-editor`: `@oa-sdk/markdown-editor`, GLFM reference, editor PRD와 자체 CI/lockfile을 소유한다.
- `gitlab-agent-ops`: `@oa-sdk/infra-gitlab`, `@oa-sdk/orchestrator-gitlab`, `@oa-sdk/orchestrator-gitlab-ui`, GitLab context 설계와 운영 백로그를 소유한다. Markdown source는 복제하지 않고 `markdown-editor` submodule을 소비한다.

추출 이력은 각 저장소에 보존했다. `oa-sdk`에서는 네 workspace와 관련 product 문서를 제거하고,
release policy를 version 3의 네 track으로 축소했다: Core Platform 6, Downstream 3,
Maintenance 3, Applications 4. Changesets는 기존 9개 release-tracked package와 남은 7개 ignored
workspace만 관리한다. `spec-lens`의 GitLab source adapter는 spec observation 책임이므로 Core에 유지한다.

## 2026-06-22 — TypeSpec-first schema source switch (`@oa-sdk/codegen` 0.3.0)

ADR-009의 TypeSpec-first authoring 결정을 production schema build path에 반영했다. `packages/schemas/typespec/`가 production TypeSpec source bundle이고, 기본 `pnpm schema:validate`, `pnpm schema:bundle`, `pnpm schema:preview`, package-level `build`가 TypeSpec compile + OA SDK extension restore + expected/reference drift gate로 `packages/schemas/src/.merged.yaml`을 생성한다.

OpenAPI/Definition Builder path는 제거하지 않고 explicit rollback/reference command로 유지한다:

- `pnpm schema:validate:openapi`
- `pnpm schema:bundle:openapi`
- `pnpm schema:preview:openapi`
- `pnpm --filter @oa-sdk/schemas run build:openapi`

주요 게이트:

- `pnpm schema:validate` — TypeSpec source path + downgrade + Spectral/Redocly + strict OA SDK OpenAPI 3.2 validate.
- `pnpm schema:rollback-check` — TypeSpec gate와 OpenAPI/Definition Builder rollback gate 동시 검증.
- `pnpm schema:downstream-check` — TypeSpec-restored artifact를 parser/codegen/router/client/mock-server와 synthetic webhook/header compile smoke에 통과.
- `pnpm schema:bundle` — TypeSpec-derived 3.1 artifact를 `dist/openapi.{yaml,json}`으로 bundle.

현재 accepted restored-vs-reference drift는 0 entries다. reusable component identity는 `oa-sdk.typespec-extensions.v5`로 복원했고, response wrapper projection schemas, component schema metadata drift, operation/path metadata drift를 TypeSpec authoring 및 restore normalization으로 제거했다.

운영 정책은 `docs/internal/typespec-roundtrip/production-operations.md`로 분리했다. 당시 `@oa-sdk/codegen` `0.3.0`은 npm publish 대상이 아닌 내부 milestone이었고, rollback command 제거는 별도 deprecation/removal ADR 전까지 보류한다. 이후 제한된 레지스트리 배포 준비 상태는 release management 문서에서 별도로 관리한다.

## 2026-04-28 — SQLite driver priority inverted: prefer node:sqlite

`loadSqliteDriver()`가 `better-sqlite3` → `node:sqlite` 순서로 시도하던 정책을 뒤집어, 사용 가능한 런타임에서는 `node:sqlite`(Node 22.5+ 추가, Node 22.13+에서는 플래그 없이 사용 가능)를 우선 시도하고 `better-sqlite3`는 fallback으로만 사용한다.

근거 — 두 신호로 정책 변경 정당화 (자세한 내역은 `docs/internal/todo.md` "운영 관찰: SQLite optional native dependency 설치성"):

1. **Forced fallback functional**: `packages/codegen/src/__tests__/workspace-index-fallback.test.ts`가 `Module._load`를 monkey-patch해 두 driver 각각 / 양쪽 모두 require 실패시키며 `loadSqliteDriver` + `createSQLiteWorkspaceIndex` lifecycle을 검증. 5 cases pass — fallback 경로에 hardening 필요한 결함 없음.
2. **Driver benchmark**: `packages/codegen/scripts/bench-sqlite-driver.ts`가 75 file × 5 components × 5 refs 워크로드를 cold/warm 단계로 측정 (Node 24.15 / darwin arm64 / median of 3):
   - cold: better-sqlite3 22.2ms vs node:sqlite 26.6ms — 15-17% 차이 (≥30% 임계 미달)
   - warm: better-sqlite3 11.5ms vs **node:sqlite 7.9ms** — node:sqlite가 40-46% 더 빠름

Incremental 도구의 일반 동작은 warm path이므로 두 번째 결과가 더 결정적. 추가 효과: `better-sqlite3`는 native optional dep이라 환경별 install 실패 가능성이 있는데, node:sqlite를 우선하면 그 경로를 거의 타지 않는다.

호환성 영향:
- 기존 SQLite cache는 driver name이 meta에 저장되어 있어 첫 실행 시 `cache invalidation + full rebuild` 1회 발생. 이후 정상 동작.
- Node <22 환경에서는 자동으로 `better-sqlite3` fallback으로 감 (설치되어 있다면).

## 2026-04-27 — External OpenAPI Artifact Governance Scaffold

NestJS Swagger / FastAPI처럼 외부 프레임워크가 생성한 OpenAPI 산출물을 oa-sdk 계약 관리 파이프라인에 표준 방식으로 연결하는 일련의 도구가 추가되었다.

### CLI surface

`@oa-sdk/codegen`에 4개 명령 추가 (oa-gen CLI 명령 17 → 21):

- `oa-gen scaffold-governance --root <서비스> --service <이름> --profile <generic|nestjs-swagger|fastapi> [--source-command "..."] [--runtime-openapi-url "..."]` — `openapi-governance.config.json`(`oa-gen.openapi-governance.v1` schema), `scripts/openapi-governance.sh`, `openapi-governance.md`를 생성하고 contracts/scripts/src 디렉토리를 만든다.
- `oa-gen collect --spec <raw> --normalized <out> --upgraded <out> [--report <out>] [--raw <copy>] [--profile <profile>]` — raw 보존 + normalized governance artifact + OpenAPI 3.2 분석 artifact + collect report를 한 번에 생성.
- `oa-gen normalize --spec <raw> [--output <out>] [--profile <profile>]` — 의미 보존 normalize만(stable diff용).
- `oa-gen upgrade --spec <normalized> [--output <out>] [--report <out>]` — 3.0/3.1 → 3.2 변환만.

### Reference implementation

두 개의 작동하는 레퍼런스가 같은 scaffold 출력을 사용한다 — profile만 다름:

- `apps/nestjs-ref/` — NestJS 10 + Swagger 7 (TypeScript / pnpm), `--profile nestjs-swagger`.
- `apps/fastapi-ref/` — FastAPI 0.115 + Pydantic 2 (Python / uv), `--profile fastapi`.

두 곳 모두 `bash scripts/openapi-governance.sh all`이 collect → check-artifact → review → typegen → validate-upgraded까지 통과한다. `review-bundle`/`inventory`/`drift`/`update-baseline`도 별도 타깃으로 노출. FastAPI/NestJS profile은 빈 `info.contact` / 루트 `servers` / 루트 `tags` noise 제거 동작을 공유한다 (generic profile은 보존).

### Hardening

여러 라운드에 걸친 안정화:

- **Upgrade 재귀 보강**: `nullable: true`가 `paths`/`webhooks`/`components.{schemas,responses,parameters,requestBodies,headers,callbacks,pathItems}` 어디에 있어도 3.2 null union으로 변환. 이전엔 `#/components/schemas`만 처리해 inline schema가 누락되었음.
- **Clone 안전성**: `cloneJson`이 `structuredClone` 사용 — `JSON.parse(JSON.stringify())`로 인한 undefined/NaN 손실 제거.
- **Repo root 자동 감지**: 스크립트가 `git rev-parse --show-toplevel` 우선, 기존 `apps/<service>` 2-deep 가정은 fallback. 다른 깊이에서도 동작.
- **Friendly missing-baseline**: 첫 실행 시 baseline 없으면 `update-baseline` 힌트와 함께 exit 1.
- **Shell hardening**: `OA_GEN` env가 `read -ra OA_GEN_CMD <<<`로 split되어 glob 확장 없음. `--source-command`는 trusted 셸 입력임을 rendered 스크립트 주석으로 명시.
- **Runtime URL 검증**: `--runtime-openapi-url`을 scaffold time에 `URL` 파서로 검증, http(s) 외 protocol 거절.
- **Drift 인자 forwarding**: `bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"`처럼 추가 인자 그대로 전달.
- **Consumers field가 source of truth**: rendered 스크립트가 `consumers.{governance,review,typegen,inventory,validate,driftManaged}` 매핑을 셸 변수명으로 해소해 baked. 알 수 없는 mapping은 scaffold time 거절.
- **Config fingerprint**: 렌더링된 스크립트 헤더 `# config fingerprint: <16자 sha256>` 라인이 profile/source/artifacts/consumers 정렬 직렬화 해시. JSON hand-edit 후 re-scaffold 누락 시 visible 신호. `fingerprintGovernanceConfig()` public helper로 외부 도구가 재계산 가능.

### Public API

`@oa-sdk/codegen` root entry에 추가 export:

- 함수: `parseOpenApiCollectProfile`, `normalizeOpenApiDocument`, `upgradeOpenApiDocumentTo32`, `stringifyOpenApiYaml`, `createOpenApiCollectReport`, `createOpenApiGovernanceInterface`, `scaffoldOpenApiGovernance`, `formatScaffoldResult`, `fingerprintGovernanceConfig`
- 타입: `OpenApiCollectProfile`, `OpenApiCollectReport`, `OpenApiTransformWarning`, `OpenApiUpgradeReport`, `OpenApiGovernanceInterface`, `OpenApiGovernanceScaffoldOptions`, `OpenApiGovernanceScaffoldResult`

### Docs

- 신규: [`docs/guides/use-cases/nestjs-swagger-governance.md`](./guides/use-cases/nestjs-swagger-governance.md), [`apps/nestjs-ref/README.md`](../apps/nestjs-ref/README.md).
- 갱신: [`docs/guides/openapi-governance-service-template.md`](./guides/openapi-governance-service-template.md)(Adoption Checklist를 external-artifact / Definition Builder 두 경로로 분리), [`docs/guides/cli-setup.md`](./guides/cli-setup.md), [`README.md`](../README.md), [`docs/internal/api-index.md`](./internal/api-index.md), [`docs/internal/feature-test-matrix.{md,json}`](./internal/feature-test-matrix.md), [`docs/internal/spec.md`](./internal/spec.md).

### Gates

- 47 test files / 648 tests passing.
- `pnpm check:cli-spec` — 22 command entities (oa-gen 15 + oa-contract 7 manifest entries; the runtime CLI itself exports 21 commands, of which 15 are governance-tracked).
- `pnpm check:api-index` — exports와 문서 정합.
- `pnpm check:feature-tests` — 23 features / 86 test paths (신규 `external-openapi-governance-scaffold` 항목 등록).
