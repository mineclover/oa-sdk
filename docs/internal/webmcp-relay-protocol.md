# WebMCP relay protocol `webmcp-peer/1`

상태: active
최종 검토: 2026-10-20
정본: docs/internal/webmcp-relay-protocol.md
구현 패키지: `packages/webmcp-peer` (relay `src/server`, provider `src/provider`, agent client `src/client`, 공용 상수 `src/config`). 이 문서의 규칙은 모두 이 패키지의 현재 코드와 테스트를 근거로 한다.

이 문서는 WebMCP relay protocol의 단일 정본이다([문서 거버넌스](../spec-governance/README.md)의 정본 표). [README](../../packages/webmcp-peer/README.md),
[api-index](./api-index.md)의 webmcp-peer 절, [relay guide](../guides/webmcp-projection-and-relay-guide.md),
[개념 문서](../concepts/webmcp-peering-mesh-and-collab.md), [보안 감사](../security/webmcp-hardening.md)의 webmcp-peer 절은 wire 규칙을
따로 유지하지 않고 요약과 함께 이 문서와 요건 ID를 링크한다. 요건은 코드와 테스트를 근거로 하며, 코드나 다른 문서가 요건과
어긋나면 그쪽이 결함이다. wire 동작을 바꾸는 변경은 해당 요건, 그 근거 줄, 10장의 기록을 같은 변경에서 고친다.
`test/protocol-spec.test.ts`는 이 문서를 그 형식대로 읽어 요건 ID의 정의와 참조, 근거 줄이 가리키는 소스 줄과 테스트 제목의 존재,
상한 표·close code 표·오류 class 표와 export한 상수의 일치, 이 문서를 링크하는 문서가 적은 요건 ID를 검사한다.

## 1. 범위와 용어

### 1.1 범위

다루는 것: relay와 provider·agent 사이에서 WebSocket(`/p/{roomId}/provider`, `/p/{roomId}/client`)과
HTTP로 오가는 모든 메시지. upgrade와 RFC 6455 framing, close code, backpressure, HTTP body·CORS·cache,
상한, room·session 수명주기 route, signaling frame, tool catalog, MCP JSON-RPC 라우팅, 오류, 그리고 이
규칙을 지키기 위한 provider·agent의 의무.

다루지 않는 것: provider와 agent가 WebRTC DataChannel로 직접 주고받는 frame(relay를 거치지 않는다.
실험적인 DataChannel 인계의 provider 쪽 규칙과 framing만 9.1에 적는다, R-PEER-023, R-PEER-029), host adapter·AI run ledger·CommitReceipt의 내부 의미, relay 설정
파일·환경 변수 해석(wire에 드러나는 Origin·Host 허용 목록, proxy 신뢰, publish key, rate limit, room 수 상한만 다룬다),
`examples/live-demo`.

### 1.2 행위자

| 행위자 | 구현 | 역할 |
|---|---|---|
| relay | `WebMcpPeerServer` (`src/server/peer-server.ts`), RFC 6455 codec `upgradeWebSocket` (`src/server/ws-upgrade.ts`) | room을 만들고 provider socket 하나와 agent의 WebSocket·HTTP 요청을 중계한다. ticket, 승인 상태, room catalog를 소유한다. |
| provider | `WebMcpPeerClient` (`src/provider/peer-client.ts`) | 브라우저 host. room을 만들고 provider socket으로 붙어 tool catalog를 `register`로 알리고, 중계된 MCP 요청에 답하고, 승인을 결정한다. |
| agent (client) | `PeerMcpSession`·`PeerMcpService` (`src/client`) 또는 임의의 MCP Streamable HTTP client | invite로 join해 client ticket을 받고 client socket이나 `POST /p/:id/mcp`로 MCP 요청을 보낸다. |

### 1.3 room, epoch, ticket

- **room**: relay의 `RoomEntry`. provider socket을 0개 또는 1개, client socket을 여러 개 가진다.
  `roomState`는 `provisioned`, `provider-connected`, `accepting-clients`, `active`, `rotating`, `rotated`,
  `expired` 중 하나다(전이는 R-ROOM-003).
- **roomEpoch**: room 세대 번호. 생성 시 1이고, rotate로 만든 대체 room은 이전 값 + 1이다. 한 room id의 epoch는
  바뀌지 않는다(rotate는 새 id를 만든다). 그래서 reclaim, approval, revoke, rotate body의 `roomId`·`roomEpoch`는 선택이고,
  보내면 relay가 이 값과 비교하는 일관성 검사다(R-ROOM-071).
- **ticket** (`ClientSessionTicket`): join이 발급하는 client 자격. `clientToken`과 `sessionId`를 가지며
  `status`는 `pending`, `approved`, `rejected`, `revoked`, `expired`, `room-rotated` 중 하나다. 만료 시각은
  발급 시점 room의 `expiresAt`이다. invite가 1회용이므로 room 하나가 발급하는 ticket은 최대 1개다.
- **approval request**: 승인이 필요한 room에서 pending ticket마다 하나 만드는 승인 요청(`requestId`). 수명은
  `approvalTimeoutMs`(기본 5분)이고 room 만료를 넘지 않는다(R-ROOM-024).
- **pending request**: relay가 provider에게 전달하고 답을 기다리는 JSON-RPC 요청(room의 `mcpPending`).

### 1.4 토큰과 식별자

| 이름 | 형식 | 발급 | 제시 방법 |
|---|---|---|---|
| `roomId` (`id`) | 문법 `^[A-Za-z0-9_-]{1,128}$`(`WEBMCP_ROOM_ID_PATTERN`, R-HTTP-002). 이 relay는 `randomBytes(16)` 소문자 hex 32자를 발급한다 | `POST /p`, rotate(대체 room) | URL 경로 `/p/{roomId}/…` |
| `providerToken` | `randomBytes(24)` hex 48자 | `POST /p`, rotate, reclaim(재발급) | provider socket subprotocol `ticket.<token>`, `Authorization: Bearer <token>`(R-HTTP-018; approval, rotate, revoke, session status) |
| `inviteToken` | hex 48자, 1회용 | `POST /p`, rotate | join body `inviteToken`, 초대 URL `#invite=` |
| `reconnectToken` (lease token) | hex 48자. relay는 SHA-256 hex만 비교한다 | `POST /p`, rotate, reclaim(재발급) | reclaim body `leaseToken` |
| `clientToken` | hex 48자. relay는 SHA-256 hex만 보관하고 그 hash로 ticket을 찾는다(R-WS-007) | join | client socket subprotocol `ticket.<token>`, `Authorization: Bearer <token>`(R-HTTP-018) |
| `sessionId` | `peer-session-` + hex 32자 | join | frame의 `sessionId`, 경로 `/sessions/:sessionId` |
| approval `requestId` | `approval-` + hex 32자 | 승인 요청 생성 | 경로 `/approval/:requestId`, frame |
| publish key | 운영자 설정 문자열. relay는 SHA-256 hex로 비교한다 | relay 설정 | `POST /p`의 `Authorization: Bearer`(R-HTTP-018), Bearer 자격이 없을 때만 `X-Publish-Key`(R-ROOM-009) |

비밀 값은 providerToken, inviteToken, reconnectToken, clientToken, publish key다.

### 1.5 프로토콜 식별자

- `webmcp-peer/1` (`WEBMCP_PROTOCOL`, `src/config/types.ts:7`): 이 문서가 규정하는 protocol의 이름. relay control
  frame과 provider frame(`approval.decision`, DataChannel `grant`)의 `protocol` 필드, `GET /config`의 `protocol`, config
  profile의 `protocol` 값이다.
- `webmcp-peer.v1` (`WEBMCP_SUBPROTOCOL`, `src/config/types.ts:12`): 같은 protocol의 WebSocket subprotocol 토큰이며
  `GET /p/:id/mcp`·`GET /mcp/catalog` 응답의 `protocol` 값이다.
- 두 표기는 같은 protocol을 가리킨다. subprotocol은 RFC 6455 §4.1의 token이고 token에는 `/`를 쓸 수 없으므로
  subprotocol에는 `.v1` 표기를 쓴다. relay, codec, provider, agent client는 문자열 대신 두 상수를 쓴다. 라이브 데모
  (`examples/live-demo/peer-protocol.js`)는 package를 import할 수 없는 브라우저 module이라 같은 값의 사본을 두고, 테스트가
  두 값이 같음을 확인한다. `discoverPeerCatalog`는 `/mcp/catalog`의 `protocol`을 MCP revision과 섞지 않고 `protocol`로
  돌려준다(R-PEER-049).
- MCP revision: relay와 provider가 `initialize`(그리고 relay를 거치는 `server/discover`)에서 협상하는
  `MCP_INITIALIZE_PROTOCOL_VERSIONS` = `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. 둘은 협상 함수
  `negotiateInitializeProtocolVersion`(`src/provider/commit-receipt.ts`)을 함께 쓴다(R-MCP-016, R-PEER-015). provider의
  `MCP_PROTOCOL_VERSION` = `2026-07-28`(`MCP_PROTOCOL_VERSIONS`는 이 값과 앞의 4개)은 DataChannel의 `server/discover`만 보고한다.
  client의 `PROTOCOL_VERSION` = `2025-11-25`.

### 1.6 표기 규칙

- MUST, MUST NOT, SHOULD, MAY는 RFC 2119의 의미다.
- 요건 ID는 `R-<AREA>-<NNN>`이다. AREA는 WS(WebSocket 전송), HTTP(HTTP 전송), LIM(상한),
  ROOM(room·session 수명주기), SIG(signaling frame), CAT(catalog), MCP(JSON-RPC 라우팅), ERR(오류),
  PEER(peer 의무)다. ID는 바뀌지 않고, 폐기한 번호는 재사용하지 않는다.
- 요건마다 근거 줄이 하나이고, 근거 경로는 모두 `packages/webmcp-peer/` 기준이다. 코드는 `src/…:줄`로 적고, 테스트는 test 파일
  경로와 `it`·`test` 제목을 따로 backtick으로 감싸 ` › `로 잇는다(제목은 소스에 적힌 그대로, `%s`·`${…}` 포함). 상한 표의 요건은
  표 다음 목록에서 근거 줄이 ID를 먼저 적는다. 테스트가 없으면 "테스트: 없음"이고, 그런 요건과 이유는 10장의 O-60 기록에 있다.
- 바이트 수는 `JSON.stringify` 결과의 UTF-8 byte 길이(`utf8ByteLength`)다. 시각은 epoch ms
  (`Date.now()`)이고, "ISO"는 `Date#toISOString()` 문자열이다.
- "파기"는 HTTP 응답 없이 TCP socket을 `destroy()`하는 것이다.
- O-NN은 10장의 기록 번호다. 결정한 항목은 결정과 구현 위치를, 남은 열린 문제는 이유와 심각도를 적는다.

## 2. 전송

### 2.1 WebSocket endpoint와 upgrade

**R-WS-001** relay는 WebSocket upgrade를 `/p/{roomId}/provider`와 `/p/{roomId}/client` 두 경로에서만 MUST
받는다. 두 경로의 `{roomId}`는 다른 room route와 같은 room id 문법 `^[A-Za-z0-9_-]{1,128}$`(R-HTTP-002)에 맞아야 한다.
그 밖의 경로(문법에 맞지 않는 id 포함)로 온 upgrade에는 `customUpgradeHandler`가 처리하지 않는 한, handshake와 subprotocol
검사(R-WS-008, R-WS-010)를 지난 뒤 404 `{error:'NOT_FOUND'}`(R-WS-038)로 MUST 답한다. 문법에 맞지만 없는 room은 R-WS-004다.\
근거: `src/server/peer-server.ts:407`, `src/server/peer-server.ts:418`, `src/server/peer-server.ts:419`, `src/server/peer-server.ts:3820`, `src/server/peer-server.ts:3821`, `src/server/peer-server.ts:4132`; 테스트: `test/server-upgrade.test.ts` › `answers a path that is not a socket endpoint with 404 NOT_FOUND`

**R-WS-002** relay는 upgrade를 다음 순서로 MUST 처리한다. 어느 단계에서든 예외가 나면 응답 없이 socket을 파기한다.

1. socket에 `error` listener(파기)를 단다. hook이 기다리는 동안 client가 연결을 reset해도 process가 죽지 않는다.
2. Host와 Origin을 검사한다(R-WS-003).
3. `req.url`을 `http://{host}:{port}` 기준 WHATWG URL로 해석한다(R-HTTP-015). 해석되지 않는 target과 IPv6 literal
   host(R-HTTP-016)는 여기서 예외가 되어 socket이 파기된다.
4. `customUpgradeHandler(req, socket, head, url, origin, server)`를 부르고, `true`를 돌려주면 더 하지 않는다. hook은 아래
   검사 전에 불리므로 WebSocket이 아닌 upgrade도 맡을 수 있다.
5. hook이 끝난 뒤 socket이 `destroyed`, `readableEnded`이거나 writable이 아니면 파기하고 아무것도 붙이지 않는다.
6. opening handshake를 검사한다(R-WS-008).
7. subprotocol을 검사하고 ticket 항목을 읽는다(R-WS-010, R-WS-005).
8. 경로를 맞춘다(R-WS-001).
9. room을 검사한다(R-WS-004).
10. ticket을 검사한다(R-WS-006, R-WS-007).
11. 101로 답하고(R-WS-009) socket을 room에 붙인다(R-ROOM-052, R-ROOM-056).

2단계와 6~10단계의 거절은 모두 R-WS-038의 HTTP 응답이다. handshake와 subprotocol 검사가 먼저이므로 opening handshake가 아닌 요청은
경로·room·ticket 조회와 그 조회가 하는 만료 처리(R-ROOM-067)를 일으키지 않는다.

근거: `src/server/peer-server.ts:3775`, `src/server/peer-server.ts:3779`, `src/server/peer-server.ts:3784`, `src/server/peer-server.ts:3790`, `src/server/peer-server.ts:3791`, `src/server/peer-server.ts:3797`, `src/server/peer-server.ts:3806`, `src/server/peer-server.ts:3813`, `src/server/peer-server.ts:3820`, `src/server/peer-server.ts:3826`, `src/server/peer-server.ts:3827`, `src/server/peer-server.ts:3965`, `src/server/peer-server.ts:3967`, `src/server/peer-server.ts:4133`, `src/server/peer-server.ts:930`; 테스트: `test/relay-message-limit.test.ts` › `survives a client that resets its connection while a customUpgradeHandler is awaiting`; `test/relay-message-limit.test.ts` › `does not attach a provider socket whose client went away (%s) while a customUpgradeHandler was awaiting`; `test/server-upgrade.test.ts` › `answers %s with an HTTP response before looking at the path, the room or the ticket`

**R-WS-003** relay는 upgrade의 Host와 Origin을 HTTP 요청과 같은 규칙으로, hook과 URL 해석보다 먼저 이 순서로 MUST 검사한다.
Host 검사(R-HTTP-020)가 켜져 있고 요청의 host(`requestHost`, 신뢰한 proxy의 `X-Forwarded-Host`가 있으면 그것)나 요청의 `Host`가 허용되지 않으면 403
`{error:'HOST_NOT_ALLOWED', host}`, Origin header가 있고 허용되지 않으면(R-HTTP-012) 403 `{error:'ORIGIN_NOT_ALLOWED', origin}`과
`Vary: Origin`이다. 둘 다 HTTP route가 같은 조건에 보내는 것과 같은 이름과 body의 R-WS-038 응답(`Content-Length`, `Connection: close`)이다.
Origin header가 없는 upgrade는 MUST 허용한다(브라우저 page가 아니다). 그래서 거절된 upgrade는 hook에 닿지 않는다.\
근거: `src/server/peer-server.ts:3779`, `src/server/peer-server.ts:3781`, `src/server/peer-server.ts:3785`, `src/server/peer-server.ts:3786`, `src/server/peer-server.ts:549`, `src/server/peer-server.ts:1094`, `src/server/server-config.ts:592`; 테스트: `test/server-upgrade.test.ts` › `refuses an upgrade for a host it does not serve or from an Origin it does not allow as an HTTP request is refused, before any hook`

**R-WS-004** 두 endpoint 모두 room을 수명주기 route와 같은 검사(`lifecycleRoomRefusal`, R-ROOM-014, R-ROOM-046, R-ROOM-070)로 MUST 확인하고, 거절은
그 route와 같은 status와 body의 R-WS-038 응답이다. room이 없으면(보존 기한이 지나 지운 room 포함) 404 `{error:'ROOM_NOT_FOUND',
code:-32004}`, rotate된 room이면 410 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch, replacementRoomId}`, `expiresAt <= now`이면 410
`{error:'ROOM_EXPIRED', code:-32056, roomId, roomEpoch}`다. rotate는 이전 room의 `expiresAt`을 rotate 시각으로 바꾸므로 rotate 검사가
만료 검사보다 먼저다. upgrade 경로는 sweep을 돌리지 않지만, 대상 room이 만료됐는데 아직 만료 처리되지 않았으면 답하기 전에 그 처리를
한다(R-ROOM-067). 그래서 peer는 HTTP route에서처럼 없는 room, rotate, 만료를 구별한다.\
근거: `src/server/peer-server.ts:2143`, `src/server/peer-server.ts:2144`, `src/server/peer-server.ts:2145`, `src/server/peer-server.ts:2146`, `src/server/peer-server.ts:2162`, `src/server/peer-server.ts:3826`, `src/server/peer-server.ts:3965`, `src/server/peer-server.ts:3727`, `src/server/peer-server.ts:2933`; 테스트: `test/server-pending-settlement.test.ts` › `carries out the room's expiry where it is found first, not only at the sweep: %s`; `test/server-upgrade.test.ts` › `answers an upgrade to a room that is gone, rotated or expired as the lifecycle routes do`

**R-WS-005** provider와 agent는 자격을 `Sec-WebSocket-Protocol`의 `ticket.<token>` 항목으로만 MUST 제시한다.
relay는 header를 `,`로 나누고 각 값을 trim해 빈 값을 버린 뒤(`requestedSubprotocols`) `ticket.`으로 시작하는 첫 항목을 MUST 쓴다.
그런 항목이 없거나 `ticket.` 뒤가 비면 자격을 제시하지 않은 것이다. upgrade에서 query string과 `Authorization`은 읽지 않는다.
101 응답은 이 항목을 되돌리지 않는다(R-WS-010).\
근거: `src/server/ws-upgrade.ts:270`, `src/server/ws-upgrade.ts:272`, `src/server/peer-server.ts:3813`, `src/server/peer-server.ts:3818`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/server-upgrade.test.ts` › `tells a missing provider token from a wrong one, with a Bearer challenge`

**R-WS-006** provider upgrade에서 relay는 ticket을 room의 현재 `providerToken`과 상수 시간으로 MUST 비교한다
(UTF-8 byte 길이가 같을 때만 `timingSafeEqual`). 검사는 approval·rotate route와 같은 `providerTokenRefusal`이다. ticket이 없거나
비었으면 401 `{error:'PROVIDER_TOKEN_REQUIRED'}`와 `WWW-Authenticate: Bearer`, 다르면 401 `{error:'PROVIDER_TOKEN_INVALID'}`와
`WWW-Authenticate: Bearer error="invalid_token"`의 R-WS-038 응답이다(R-HTTP-019).\
근거: `src/server/peer-server.ts:3827`, `src/server/peer-server.ts:2173`, `src/server/peer-server.ts:2174`, `src/server/peer-server.ts:2175`, `src/server/peer-server.ts:2234`; 테스트: `test/server-upgrade.test.ts` › `tells a missing provider token from a wrong one, with a Bearer challenge`

**R-WS-007** client upgrade에서 relay는 ticket의 SHA-256 hex로 room의 `clientTickets` Map에서 ticket을 MUST 찾는다.
relay는 clientToken 자체를 보관하지 않으므로(join이 hash만 저장한다) 비밀 문자열을 문자 단위로 비교하거나 찾지 않는다(R-HTTP-018).
`pending`과 `approved` ticket은 MUST 받는다(pending ticket은 socket에서 승인 결과를 받는다). 그 밖에는 같은 token의 `POST /p/:id/mcp`가
받는 status와 이름(`clientTicketError`, R-MCP-014)의 R-WS-038 응답으로 MUST 거절한다(`checkUpgradeTicket`). 자격이 없으면 401 −32003
`CLIENT_TOKEN_REQUIRED`, room이 발급하지 않은 token이면 401 −32003 `CLIENT_TOKEN_INVALID`, revoke된 ticket은 401 −32001 `SESSION_INVALID`,
거절된 ticket은 403 −32054 `CLIENT_APPROVAL_DENIED`, 만료된 ticket은 410 −32056 `SESSION_EXPIRED`다. 401은 R-HTTP-019의 Bearer challenge를
가진다. ticket은 room의 만료와 함께 만료되고 rotate된 room은 R-WS-004가 먼저 거절하므로, `expired`와 `room-rotated` ticket의 거절은
방어용이다.\
근거: `src/server/peer-server.ts:3966`, `src/server/peer-server.ts:3967`, `src/server/peer-server.ts:2186`, `src/server/peer-server.ts:2187`, `src/server/peer-server.ts:2188`, `src/server/peer-server.ts:2191`, `src/server/peer-server.ts:2414`, `src/server/peer-server.ts:2415`, `src/server/peer-server.ts:2432`, `src/server/peer-server.ts:3469`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`; `test/server-room-lifecycle.test.ts` › `keeps a client token only as its SHA-256 hash, the key its ticket is found by`; `test/server-upgrade.test.ts` › `refuses a client ticket with the status and name an MCP POST of the same token gets`

**R-WS-008** relay가 upgrade로 다루는 요청은 node:http가 `'upgrade'` event로 넘긴 것뿐이다. node:http는 `Upgrade`
header가 있고 `Connection` header에 `upgrade` token이 있을 때만(llhttp `F_UPGRADE`와 `F_CONNECTION_UPGRADE`) 그렇게 한다.
그렇지 않은 요청(`Connection: close`, `Connection` 없음 등)은 `/p/{roomId}/provider`·`/p/{roomId}/client`로 와도 보통 HTTP
요청으로 R-HTTP-001을 거쳐 404 `{error:'NOT_FOUND'}`를 받고(허용되지 않은 host면 403 `HOST_NOT_ALLOWED`, 허용되지 않은 Origin이면 403 `ORIGIN_NOT_ALLOWED`,
`customHttpHandler`가 처리하면 그 응답), socket은 파기되지 않는다. `'upgrade'`로 넘어온 요청은 hook 다음, subprotocol·경로·room·ticket
검사보다 먼저 RFC 6455 §4.2.1의 opening handshake인지 MUST 검사한다(`webSocketHandshakeRefusal`). method가 `GET`이 아니거나,
HTTP version이 1.1보다 낮거나, `Upgrade`의 `,` 구분 token(대소문자 무시)에 `websocket`이 없거나, `Connection`의 token에 `upgrade`가
없으면 400 `{error:'BAD_UPGRADE'}`다. 그다음 `Sec-WebSocket-Version`이 정확히 `13`이 아니면(없음, `13, 8` 포함) 426
`{error:'UNSUPPORTED_WEBSOCKET_VERSION'}`이고, 응답은 `Sec-WebSocket-Version: 13`, `Upgrade: websocket`, `Connection: Upgrade, close`를
가진다(RFC 6455 §4.4, RFC 9110 §15.5.22, §7.8). version을 key보다 먼저 보는 것은 다른 version의 client가 key를 다르게 만들 수 있어서다.
마지막으로 `Sec-WebSocket-Key`가 16 byte의 base64(`^[A-Za-z0-9+/]{22}==$`)가 아니면 400 `BAD_UPGRADE`다. 거절은 R-WS-038의 응답이다.
codec(`upgradeWebSocket`)도 101을 쓰기 전에 같은 검사를 하고, 걸리면 던지지 않고 같은 응답을 쓴 뒤 socket을 멈춘다(R-WS-011).\
근거: `src/server/peer-server.ts:917`, `src/server/peer-server.ts:929`, `src/server/peer-server.ts:3767`, `src/server/peer-server.ts:3806`, `src/server/peer-server.ts:3808`, `src/server/ws-upgrade.ts:218`, `src/server/ws-upgrade.ts:223`, `src/server/ws-upgrade.ts:225`, `src/server/ws-upgrade.ts:245`, `src/server/ws-upgrade.ts:246`, `src/server/ws-upgrade.ts:247`, `src/server/ws-upgrade.ts:252`, `src/server/ws-upgrade.ts:257`, `src/server/ws-upgrade.ts:261`, `src/server/ws-upgrade.ts:473`, `src/server/ws-upgrade.ts:479`; 테스트: `test/server-ws-frames.test.ts` › `refuses %s with 400 BAD_UPGRADE and stops the socket, without throwing`; `test/server-ws-frames.test.ts` › `refuses %s with 426, naming version 13 and the protocol to upgrade to`; `test/server-ws-frames.test.ts` › `checks the version before the key, which a client of another version may build otherwise`; `test/server-ws-frames.test.ts` › `completes a handshake whose Upgrade and Connection list their token among others, in any case`; `test/server-upgrade.test.ts` › `answers %s with an HTTP response before looking at the path, the room or the ticket`

**R-WS-009** 101 응답은 정확히 `HTTP/1.1 101 Switching Protocols`, `Upgrade: websocket`,
`Connection: Upgrade`, `Sec-WebSocket-Accept: base64(SHA-1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))` 줄과, 요청이
`webmcp-peer.v1`을 제시했을 때의 `Sec-WebSocket-Protocol: webmcp-peer.v1` 줄로 MUST 이루어진다. relay가 받는 upgrade는 언제나
`webmcp-peer.v1`을 제시하므로(R-WS-010) relay의 101에는 이 줄이 늘 있다. relay는 `Sec-WebSocket-Extensions`를 MUST NOT 보낸다.
따라서 permessage-deflate 같은 extension은 협상되지 않는다.\
근거: `src/server/ws-upgrade.ts:481`, `src/server/ws-upgrade.ts:485`, `src/server/ws-upgrade.ts:488`, `src/server/ws-upgrade.ts:489`; 테스트: `test/server-ws-frames.test.ts` › `accepts a single frame of exactly the limit, measured in UTF-8 bytes`; `test/server-upgrade.test.ts` › `selects webmcp-peer.v1 for an upgrade it takes, whatever else the request offers`

**R-WS-010** relay가 말하는 subprotocol은 `webmcp-peer.v1`(`WEBMCP_SUBPROTOCOL`) 하나다. relay는 handshake 검사(R-WS-008) 다음,
경로·room·ticket 검사보다 먼저, 요청한 subprotocol 목록(R-WS-005)에 `webmcp-peer.v1`이 없으면 400 `{error:'SUBPROTOCOL_REQUIRED'}`의
R-WS-038 응답으로 MUST 거절한다. header가 없거나, `ticket.<token>`만 있거나, 모르는 값만 있는 경우다. 받은 upgrade의 101은
`webmcp-peer.v1`을 고른다(RFC 6455 §4.2.2: server가 쓸 의향이 있는 값). codec은 목록에 `webmcp-peer.v1`이 있을 때만 그것을 고르고,
없으면 `Sec-WebSocket-Protocol`을 넣지 않는다. 어느 경우에도 `ticket.*`, 빈 값, 모르는 값은 응답 header에 MUST NOT 실린다. 그러므로
peer는 `webmcp-peer.v1`을 ticket과 함께 MUST 제시한다. 참조 구현 둘 다 `[WEBMCP_SUBPROTOCOL, 'ticket.<token>']`, 곧 `['webmcp-peer.v1',
'ticket.<token>']`을 보낸다.\
근거: `src/config/types.ts:12`, `src/server/ws-upgrade.ts:270`, `src/server/ws-upgrade.ts:272`, `src/server/ws-upgrade.ts:485`, `src/server/peer-server.ts:3813`, `src/server/peer-server.ts:3814`, `src/server/peer-server.ts:3815`, `src/provider/peer-client.ts:991`, `src/provider/peer-client.ts:992`, `src/client/session.ts:612`; 테스트: `test/server-ws-frames.test.ts` › `selects webmcp-peer.v1 and nothing else from a request offering %s`; `test/server-upgrade.test.ts` › `answers %s with an HTTP response before looking at the path, the room or the ticket`

**R-WS-011** `upgradeWebSocket`이 불릴 때 socket이 이미 `destroyed`, `readableEnded`(peer가 FIN을 보냄)이거나
writable이 아니면, 또는 요청이 opening handshake가 아니면(R-WS-008) codec은 101을 MUST NOT 쓴다. 이미 간 socket은 파기하고,
handshake가 아닌 요청에는 R-WS-038의 응답(400 `BAD_UPGRADE`, 426 `UNSUPPORTED_WEBSOCKET_VERSION`)을 쓴 뒤 닫는다. 어느 쪽이든
head bytes를 버리고 liveness timer(R-WS-039)를 걸지 않으며, `send`는 즉시 `closed`를 돌려주고, `onClose`는 함수가 돌아간 뒤
microtask에서 정확히 한 번 돈다. 이 socket은 `ready` 전송이 실패하므로 room에 붙지 않는다(R-ROOM-052, R-ROOM-056).\
근거: `src/server/ws-upgrade.ts:472`, `src/server/ws-upgrade.ts:473`, `src/server/ws-upgrade.ts:475`, `src/server/ws-upgrade.ts:477`, `src/server/ws-upgrade.ts:479`, `src/server/ws-upgrade.ts:516`, `src/server/ws-upgrade.ts:826`, `src/server/ws-upgrade.ts:827`; 테스트: `test/server-ws-frames.test.ts` › `calls onClose once, after upgradeWebSocket returns, for a socket destroyed before the upgrade (%s)`; `test/server-ws-frames.test.ts` › `calls onClose once and destroys the socket when an upgrade handler that awaits gets one whose client already sent FIN`; `test/server-ws-frames.test.ts` › `refuses %s with 400 BAD_UPGRADE and stops the socket, without throwing`

**R-WS-012** HTTP parser가 upgrade 요청 뒤까지 읽은 bytes(head)는 이후 socket data보다 먼저 MUST 해석한다.
`upgradeWebSocket`이 돌아간 뒤의 microtask나 첫 `data` event 중 먼저 오는 쪽에서 해석한다. 소유자가 멈춘 동안 남은 read의 byte도 같은
자리에 두므로, 재개(`resume`)나 다음 `data` event에서 그 뒤의 read보다 먼저 해석한다(R-WS-040). `onText`와
`onClose`는 `upgradeWebSocket`이 돌아가기 전에 MUST NOT 돈다.\
근거: `src/server/ws-upgrade.ts:516`, `src/server/ws-upgrade.ts:793`, `src/server/ws-upgrade.ts:800`, `src/server/ws-upgrade.ts:834`; 테스트: `test/server-ws-frames.test.ts` › `parses head (%s) before a chunk the socket emits in the same tick`; `test/server-ws-frames.test.ts` › `delivers a message in head only after upgradeWebSocket returns, even with no later read`

**R-WS-038** relay와 codec은 받지 않는 upgrade(R-WS-001, R-WS-003, R-WS-004, R-WS-006, R-WS-007, R-WS-008, R-WS-010)에 RFC 6455 §4.2.2대로
HTTP 응답을 MUST 쓴 뒤 연결을 닫는다(`refuseWebSocketUpgrade`). 응답은 `HTTP/1.1 <status> <reason phrase>`, `Content-Type:
application/json`, `Content-Length: <body의 byte 수>`, `Cache-Control: no-store`, `Connection: close`와 거절마다의 header(401의
`WWW-Authenticate`, 426의 `Upgrade`·`Sec-WebSocket-Version`과 `Connection: Upgrade, close`, `ORIGIN_NOT_ALLOWED`의 `Vary: Origin`)이고,
body는 수명주기 오류 body `{error, code?, …}`(`lifecycleErrorBody`, R-ERR-002)다. CORS header는 없다. relay는 응답을 다 쓴 뒤(`finish`) socket을 파기하고, 응답을
읽지 않는 peer의 연결은 `WEBSOCKET_CLOSE_TIMEOUT_MS`(5000 ms) 뒤 파기한다. 이미 쓸 수 없는 socket은 응답 없이 파기한다. 이름과 status는
같은 조건의 HTTP route와 같으므로, 브라우저 WebSocket API는 status를 보여 주지 않지만(연결 실패와 close 1006) 다른 client는 없는 경로,
틀린 자격, 없는 room, rotate, 만료를 구별한다. 예외(R-WS-002)만 이 규칙 밖이다.\
근거: `src/server/ws-upgrade.ts:284`, `src/server/ws-upgrade.ts:293`, `src/server/ws-upgrade.ts:300`, `src/server/ws-upgrade.ts:302`, `src/server/ws-upgrade.ts:308`, `src/server/ws-upgrade.ts:311`, `src/server/ws-upgrade.ts:312`, `src/server/peer-server.ts:2112`, `src/server/peer-server.ts:2113`, `src/server/peer-server.ts:550`; 테스트: `test/server-ws-frames.test.ts` › `answers a raw client's refused upgrade with a complete response, then closes the connection`; `test/server-upgrade.test.ts` › `answers %s with an HTTP response before looking at the path, the room or the ticket`; `test/server-upgrade.test.ts` › `refuses a client ticket with the status and name an MCP POST of the same token gets`; `test/server-upgrade.test.ts` › `refuses an upgrade for a host it does not serve or from an Origin it does not allow as an HTTP request is refused, before any hook`

### 2.2 수신 framing

**R-WS-013** relay는 수신 frame마다 payload를 읽기 전에 header 첫 2 byte로 다음을 이 순서로 MUST 검사한다.
RSV bit가 하나라도 있으면 1002 `RESERVED_BITS`(협상한 extension이 없다). opcode 3-7, 11-15면 1002
`RESERVED_OPCODE`. binary opcode 0x2면 1003 `TEXT_ONLY`(mask 검사보다 먼저이므로 mask 없는 binary도 1003).
MASK bit가 없으면 1002 `UNMASKED_FRAME`. 다음으로 control frame 규칙(R-WS-014). fragmented message가 열려
있는데 text frame이 오면 1002 `INTERLEAVED`. 열린 message 없이 continuation이 오면 1002
`BAD_CONTINUATION`. continuation이 fragment 상한을 넘으면 1009 `FRAGMENT_LIMIT`(R-WS-015). 이 절의 이름(`RESERVED_BITS`,
`FRAME_LIMIT`, `MESSAGE_LIMIT`, `INVALID_UTF8`, `BAD_CLOSE_PAYLOAD` 등)은 codec 내부의 오류 이름이며 wire에 나가지 않는다.
relay가 보내는 close frame은 2-byte status code만 담는다(R-WS-027).\
근거: `src/server/ws-upgrade.ts:622`, `src/server/ws-upgrade.ts:629`, `src/server/ws-upgrade.ts:630`, `src/server/ws-upgrade.ts:631`, `src/server/ws-upgrade.ts:632`, `src/server/ws-upgrade.ts:637`, `src/server/ws-upgrade.ts:639`, `src/server/ws-upgrade.ts:640`, `src/server/ws-upgrade.ts:598`, `src/server/ws-upgrade.ts:789`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1002 on a protocol violation: %s`; `test/server-ws-frames.test.ts` › `closes with 1002 from the header of a frame with reserved opcode %i`; `test/server-ws-frames.test.ts` › `closes with 1003 from a binary frame header alone, without waiting for its payload`

**R-WS-014** control frame(close 0x8, ping 0x9, pong 0xA)은 FIN이 있고 7-bit length 값이 125 이하여야 하며,
아니면 relay는 1002 `BAD_CONTROL_FRAME`으로 MUST 닫는다. 이 검사는 64-bit length 검사보다 먼저이므로 큰 길이를
선언한 ping은 1009가 아니라 1002를 받는다. control frame은 message의 fragment 사이에 올 수 있고, message
byte 수에도 fragment 수에도 MUST NOT 포함된다.\
근거: `src/server/ws-upgrade.ts:173`, `src/server/ws-upgrade.ts:633`, `src/server/ws-upgrade.ts:634`, `src/server/ws-upgrade.ts:659`, `src/server/ws-upgrade.ts:686`; 테스트: `test/server-ws-frames.test.ts` › `assembles a fragmented message of exactly the limit and answers a ping between its fragments`; `test/relay-message-limit.test.ts` › `counts only continuation frames toward a fragmented message, not a ping between them`

**R-WS-015** 수신 message 하나는 첫 frame과 continuation을 합쳐 최대 `MAX_WEBSOCKET_MESSAGE_FRAGMENTS` = 1024
frame이다. relay는 1025번째 frame을 header에서 1009 `FRAGMENT_LIMIT`로 MUST 거절한다. 빈 continuation은 허용하며
메모리를 할당하지 않고 이 상한에만 센다.\
근거: `src/server/ws-upgrade.ts:60`, `src/server/ws-upgrade.ts:640`, `src/server/ws-upgrade.ts:692`; 테스트: `test/server-ws-frames.test.ts` › `refuses the 1-byte fragment past the cap with 1009 from its header`; `test/server-ws-frames.test.ts` › `closes a flood of empty continuation frames with 1009 at the cap instead of buffering it`

**R-WS-016** 수신 message는 단일 frame이든 fragment든 최대 262144 UTF-8 byte(`PEER_RELAY_MAX_MESSAGE_BYTES`)다.
64-bit length가 262144를 넘으면 relay는 masking key가 오기 전, length bytes를 받는 즉시 1009 `FRAME_LIMIT`로
MUST 닫는다(2^53+1, 2^63, 2^64−1 포함). 7-bit length는 최대 125, 16-bit length는 최대 65535이므로 262144를 넘는 단일
frame은 언제나 `FRAME_LIMIT`다. continuation의 length가 이미 조립한 byte와 합쳐 262144를 넘으면 그 header에서 1009
`MESSAGE_LIMIT`로 MUST 닫는다. 첫 frame에는 조립한 byte가 없으므로 `MESSAGE_LIMIT`는 continuation에서만 나온다(코드의
`length > MAX_WEBSOCKET_FRAME_BYTES` 비교는 `FRAME_LIMIT` 검사 뒤라 참이 되지 않는다). 정확히 262144 byte인 message는 MUST
받는다. 최소 길이가 아닌 length 인코딩은 거절하지 않는다.\
근거: `src/server/ws-upgrade.ts:45`, `src/server/ws-upgrade.ts:50`, `src/server/ws-upgrade.ts:652`, `src/server/ws-upgrade.ts:659`, `src/server/ws-upgrade.ts:660`; 테스트: `test/server-ws-frames.test.ts` › `refuses a 64-bit payload length of %s with 1009 from the length alone`; `test/server-ws-frames.test.ts` › `refuses the continuation frame that would take a message over the limit from its header`; `test/relay-message-limit.test.ts` › `accepts a single frame of exactly the limit and refuses one byte more with 1009 from the header alone`

**R-WS-017** relay는 완성된 text message(FIN 시점)를 fatal UTF-8 decoder(RFC 3629)로 MUST 해석한다. 0xFF/0xFE,
인코딩된 UTF-16 surrogate, overlong 형식, 끝에서 잘린 sequence는 1007 `INVALID_UTF8`로 닫는다. 검사는
fragment마다가 아니라 message가 완성될 때 한다. codec은 앞의 U+FEFF BOM을 지우지 않고(`ignoreBOM: true`) 그대로 소유자에게
넘기며, relay의 frame 처리기가 JSON으로 해석하기 전에 하나를 지운다(R-SIG-001). 빈 text message는 `''`로 전달한다.\
근거: `src/server/ws-upgrade.ts:341`, `src/server/ws-upgrade.ts:747`, `src/server/ws-upgrade.ts:751`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1007 for a text message that is not valid UTF-8: %s`; `test/server-ws-frames.test.ts` › `delivers a text message that starts with a byte-order mark unchanged`

**R-WS-018** relay는 header, masking key, payload가 어느 read 경계에서 나뉘어 와도 MUST 조립한다. 참고로 codec이
read 사이에 남기는 것은 진행 중인 frame의 header(최대 14 byte = 2 + 확장 길이 8 + mask 4)와 조립 중인 payload, 그리고 소유자가
socket을 멈춘 동안 처리하지 않은 read의 나머지(R-WS-040)뿐이다.
단일 frame message는 정확히 그 크기의 buffer를, fragmented message는 16384 byte에서 시작해 262144 byte까지
기하급수로 키운 buffer를 쓴다.\
근거: `src/server/ws-upgrade.ts:171`, `src/server/ws-upgrade.ts:176`, `src/server/ws-upgrade.ts:501`, `src/server/ws-upgrade.ts:666`; 테스트: `test/server-ws-frames.test.ts` › `assembles a frame with %s whose header and masking key arrive one byte per read`; `test/server-ws-frames.test.ts` › `assembles a limit-sized frame fed one byte per read in time linear in its size`

**R-WS-040** 소유자가 socket 읽기를 멈춘 동안(`socket.pause()`. relay는 요청한 frame에 뒤처진 agent를 멈춘다, R-WS-031) codec은 수신
frame을 하나도 MUST NOT 처리한다. 이미 읽은 read 안의 frame도 마찬가지다. codec은 frame마다 멈춤을 확인하고, 멈춘 자리부터 그 read의
나머지 byte를 해석하지 않은 채 두었다가, 소유자가 읽기를 재개하면(`resume` event) 그 뒤의 어떤 read보다 먼저 순서대로 처리한다. 그래서
한 read에 담긴 message 가운데 소유자의 `onText`가 socket을 멈추게 한 message 뒤의 것은 재개 전까지 `onText`에 가지 않고, 그 사이의
control frame(ping의 pong, close)도 재개 뒤에 처리한다. 멈춘 동안 codec이 더 쥐는 것은 그 read의 나머지뿐이고(read 하나 이하. 그 뒤의
read는 멈춘 socket이 넘기지 않는다), 이것이 relay가 읽지 않는 agent에게 답을 쌓는 양의 상한을 만든다(R-MCP-042).\
근거: `src/server/ws-upgrade.ts:516`, `src/server/ws-upgrade.ts:762`, `src/server/ws-upgrade.ts:765`, `src/server/ws-upgrade.ts:808`; 테스트: `test/server-ws-frames.test.ts` › `handles no frame of a read while its owner has the socket paused, and the rest in order once it resumes`; `test/relay-backpressure.test.ts` › `holds one catalog listing for an agent waiting for approval that does not read, however many one read asks for, and delivers every listing in order once it reads`

**R-WS-019** peer가 close frame을 보내면 relay는 2-byte status만 담은 close frame(reason은 절대 되돌리지 않음)으로
답하고 FIN을 MUST 보낸다. 빈 payload에는 1000, 1-byte payload에는 1002로 답한다. status가 1000-1003, 1007-1014
(1012-1014 포함), 3000-4999이고 reason이 유효한 UTF-8이면 그 status를 그대로 되돌리되, client 전용 1010에는 1000으로 답한다
(server는 1010을 보내지 않는다, R-WS-028). 그 밖의 status(0, 999, 1004, 1005, 1006, 1015, 1016-2999, 5000 이상)나 UTF-8이 아닌
reason에는 1002 `BAD_CLOSE_PAYLOAD`로 답한다.\
근거: `src/server/ws-upgrade.ts:361`, `src/server/ws-upgrade.ts:375`, `src/server/ws-upgrade.ts:377`, `src/server/ws-upgrade.ts:379`, `src/server/ws-upgrade.ts:382`, `src/server/ws-upgrade.ts:736`; 테스트: `test/server-ws-frames.test.ts` › `answers a client close frame with 1000, calls onClose once, and send then returns 'closed'`; `test/server-ws-frames.test.ts` › `answers a valid close frame with %s with status %i`; `test/server-ws-frames.test.ts` › `answers a malformed close frame (%s) with 1002`

**R-WS-020** codec은 소유자의 `onText`가 던지면 1011로 socket을 MUST 닫고 이후 frame을 전달하지 않는다. relay의
provider·client `onText` 처리기는 모든 예외를 스스로 삼키므로 relay는 frame 처리 때문에 1011을 보내지 않는다.\
근거: `src/server/ws-upgrade.ts:788`, `src/server/ws-upgrade.ts:789`, `src/server/peer-server.ts:3923`, `src/server/peer-server.ts:4098`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1011 when onText throws, and calls onClose once`

**R-WS-021** relay는 수신 ping마다 같은 payload의 pong으로 MUST 답한다. 단 `writableLength` + pong의 wire byte가
송신 상한(R-WS-024) 안일 때만 보낸다. 들어가지 않는 pong은 socket을 닫지 않고 버리며 stall timer(R-WS-026)를
시작한다. 수신 pong은 다른 수신처럼 idle timer를 다시 시작할 뿐 따로 처리하지 않는다. relay가 스스로 보내는 ping과 liveness
timeout은 R-WS-039다.\
근거: `src/server/ws-upgrade.ts:728`, `src/server/ws-upgrade.ts:732`, `src/server/ws-upgrade.ts:735`, `src/server/ws-upgrade.ts:802`; 테스트: `test/server-ws-frames.test.ts` › `drops the pongs that do not fit for a peer that floods pings without reading them, and keeps it open`; `test/server-ws-frames.test.ts` › `drops the pongs a raw client that floods pings without reading cannot take, without closing it`; `test/server-ws-frames.test.ts` › `keeps a peer open while it sends anything, %s included`

**R-WS-039** relay는 붙인 provider·client socket마다 `webSocketPingIntervalMs`(기본 `WEBSOCKET_PING_INTERVAL_MS` = 30000 ms)
간격으로 payload 없는 RFC 6455 ping을 MUST 보낸다. 101을 쓴 뒤부터 socket이 멈출 때까지이며 timer는 process를 붙잡지 않는다(unref).
ping은 pong처럼 송신 상한(R-WS-024) 안일 때만 쓰고, 들어가지 않으면 버리며 stall timer를 시작한다. relay는 그 socket에서 무엇이든(어느
frame, pong, frame의 일부) 마지막으로 읽은 뒤 `webSocketIdleTimeoutMs`(기본 `WEBSOCKET_IDLE_TIMEOUT_MS` = 75000 ms) 동안 아무것도 읽지
못하면 그 socket을 1001(Going Away)로 MUST 닫고, peer가 끊지 않으면 close timeout(R-WS-027)이 연결을 파기한다. 단 소유자가 socket 읽기를
멈춘 동안(`pause`. relay는 요청한 frame에 뒤처진 agent를 읽지 않는다, R-WS-031)에는 닫지 않고 기다림을 다시 시작한다. 읽지 않으니 pong이
와 있을 수 있고, 그동안 사라진 peer는 쓰기를 받지 않으므로 stall close(R-WS-026)가 닫는다. 브라우저와 Node WebSocket은 ping에 스스로
pong하므로(RFC 6455 §5.5.2) application이 아무것도 보내지 않는 살아 있는 peer도 닫히지 않는다. 그래서 FIN·RST 없이 사라진 provider
socket은 idle timeout 안에 떨어져 reclaim을 막지 않고(R-ROOM-016) 그 room의 pending 요청은 `PROVIDER_DISCONNECTED`로 끝난다(R-ROOM-054).
두 relay option은 [1, 2147483647] ms의 수이고 idle timeout이 ping 간격보다 길어야 하며, 아니면 relay 생성자가 `RangeError`를 던진다.
peer에게는 ping 의무가 없다(provider의 25 s JSON `ping`, R-SIG-007, R-LIM-034는 선택이다).\
근거: `src/server/ws-upgrade.ts:79`, `src/server/ws-upgrade.ts:88`, `src/server/ws-upgrade.ts:209`, `src/server/ws-upgrade.ts:210`, `src/server/ws-upgrade.ts:211`, `src/server/ws-upgrade.ts:580`, `src/server/ws-upgrade.ts:710`, `src/server/ws-upgrade.ts:711`, `src/server/ws-upgrade.ts:720`, `src/server/ws-upgrade.ts:721`, `src/server/ws-upgrade.ts:725`, `src/server/ws-upgrade.ts:802`, `src/server/ws-upgrade.ts:830`, `src/server/ws-upgrade.ts:832`, `src/server/peer-server.ts:901`, `src/server/peer-server.ts:902`, `src/server/peer-server.ts:3933`, `src/server/peer-server.ts:4106`, `src/server/types.ts:177`, `src/server/types.ts:184`; 테스트: `test/server-ws-frames.test.ts` › `pings the peer every WEBSOCKET_PING_INTERVAL_MS with an empty ping`; `test/server-ws-frames.test.ts` › `closes a peer it hears nothing from for WEBSOCKET_IDLE_TIMEOUT_MS with 1001, and the close timeout destroys it`; `test/server-ws-frames.test.ts` › `keeps a peer open while it sends anything, %s included`; `test/server-ws-frames.test.ts` › `does not close a socket its owner paused, whose pongs may be waiting unread, and starts the wait again`; `test/server-upgrade.test.ts` › `pings every socket and closes one it stops hearing from with 1001, detaching the provider`; `test/server-upgrade.test.ts` › `keeps a WebSocket that answers its pings on its own open past the idle timeout`; `test/server-upgrade.test.ts` › `refuses %s when constructed`

### 2.3 송신 framing과 close

**R-WS-022** relay가 보내는 frame은 mask가 없고 RSV가 0이며 최소 길이 인코딩(126 미만은 7-bit, 65535 이하는 16-bit,
그 이상은 64-bit)을 MUST 쓴다. 131072 byte 이하 message는 FIN text frame 하나로 보낸다. 더 큰 message는 131072 byte
fragment로 나눠 첫 frame은 text, 나머지는 continuation, 마지막에만 FIN을 둔다. 262144 byte message는 header 10 byte
frame 2개, 모두 262164 wire byte다.\
근거: `src/server/ws-upgrade.ts:91`, `src/server/ws-upgrade.ts:94`, `src/server/ws-upgrade.ts:520`, `src/server/ws-upgrade.ts:562`, `src/server/ws-upgrade.ts:566`; 테스트: `test/server-ws-frames.test.ts` › `returns 'sent' for a 200 KiB message and sends it as 128 KiB fragments the client reassembles`; `test/relay-message-limit.test.ts` › `accepts an announcement of exactly PEER_RELAY_MAX_ANNOUNCEMENT_BYTES and sends it to agents in 128 KiB fragments`

**R-WS-023** `PeerSocket.send(value)`는 `JSON.stringify`로 직렬화하고 다음 중 하나를 MUST 돌려준다. socket이
멈췄거나 파기됐거나 writable이 아니면 `closed`. UTF-8 길이가 262144를 넘으면 `too-large`(보내지 않고 socket은 열어 둔다).
송신 상한에 들어가지 않으면 `busy`(아무것도 queue하거나 할당하지 않는다). 그 밖에는 `sent`. `too-large`와 `busy`는
socket을 MUST NOT 닫는다.\
근거: `src/server/ws-upgrade.ts:15`, `src/server/ws-upgrade.ts:553`, `src/server/ws-upgrade.ts:557`, `src/server/ws-upgrade.ts:560`, `src/server/ws-upgrade.ts:838`; 테스트: `test/server-ws-frames.test.ts` › `returns 'too-large' for a message over the limit without closing the socket; the next message arrives`; `test/server-ws-frames.test.ts` › `returns 'sent' for a message of exactly the limit, which a browser WebSocket receives intact`

**R-WS-024** relay는 `socket.writableLength` + 다음 frame의 wire byte가 `maxOutboundBufferBytes` 이하일 때만 frame
(message 또는 pong)을 MUST queue한다. 기본값은 `MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES` = 1048576(4 × 262144)이다.
`writableLength`에는 아직 나가지 않은 101 응답 byte도 들어간다. 상한에 정확히 닿는 message는 queue되고, 다음 것은
`busy`다. peer가 읽으면 다시 보낼 수 있고, 앞서 보낸 message는 모두 순서대로 도착한다.\
근거: `src/server/ws-upgrade.ts:119`, `src/server/ws-upgrade.ts:540`, `src/server/ws-upgrade.ts:541`; 테스트: `test/server-ws-frames.test.ts` › `queues a message that fills the queue to exactly the bound; the next one is refused with 'busy', queuing nothing and keeping the socket open`; `test/server-ws-frames.test.ts` › `refuses messages with 'busy' while a raw client is not reading, without closing it; once it reads, it gets every message sent, in order, and the socket works again`

**R-WS-025** relay는 `upgradeWebSocket`에 liveness option(`pingIntervalMs`·`idleTimeoutMs`, relay option `webSocketPingIntervalMs`·
`webSocketIdleTimeoutMs`의 값, R-WS-039)만 넘기므로 close timeout 5000 ms, stall timeout 30000 ms, 송신 상한 1048576 byte를 MUST 쓴다.
codec option은 101을 쓰기 전에 검사한다(`resolveUpgradeWebSocketOptions`). `closeTimeoutMs`, `stalledOutboundTimeoutMs`, `pingIntervalMs`,
`idleTimeoutMs`는 [1, 2147483647] 범위의 유한한 수이고 `idleTimeoutMs`는 `pingIntervalMs`보다 커야 하며, `maxOutboundBufferBytes`는 262164
이상의 safe integer여야 한다. 아니면 `RangeError`다. relay는 자기 liveness option을 생성할 때 같은 함수로 검사한다.\
근거: `src/server/ws-upgrade.ts:180`, `src/server/ws-upgrade.ts:188`, `src/server/ws-upgrade.ts:201`, `src/server/ws-upgrade.ts:211`, `src/server/ws-upgrade.ts:442`, `src/server/peer-server.ts:902`, `src/server/peer-server.ts:3933`, `src/server/peer-server.ts:4106`; 테스트: `test/server-ws-frames.test.ts` › `refuses %s of %s with a RangeError before answering the upgrade`; `test/server-ws-frames.test.ts` › `refuses an idle timeout %s with a RangeError before answering the upgrade`; `test/server-ws-frames.test.ts` › `refuses maxOutboundBufferBytes of %s with a RangeError before answering the upgrade`; `test/server-upgrade.test.ts` › `refuses %s when constructed`

**R-WS-026** 처음 거절된 frame(message 또는 pong)이 `stalledOutboundTimeoutMs`(기본
`WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS` = 30000 ms) timer를 MUST 시작한다. 이후 거절은 timer를 다시 시작하지 않는다.
queue된 write가 오류 없이 하나라도 끝나면 timer를 지운다. 그러므로 느리게라도 읽는 peer는 열려 있고, 다음 거절이 새
대기를 시작한다. timer가 끝나면 relay는 1013(Try Again Later)으로 닫는다. 이미 queue된 것과 close frame은 close
timeout 전에 peer가 읽으면 순서대로 나간다. 송신 queue가 가득 찬 것 때문에 생기는 close는 이것뿐이다. relay가
`AgentOutbox`에서 건너뛴 broadcast(R-WS-032)는 codec에 제시되지 않으므로 거절이 아니고 이 timer를 시작하지 않는다(R-WS-035).\
근거: `src/server/ws-upgrade.ts:73`, `src/server/ws-upgrade.ts:129`, `src/server/ws-upgrade.ts:464`, `src/server/ws-upgrade.ts:542`, `src/server/ws-upgrade.ts:545`, `src/server/peer-server.ts:711`, `src/server/peer-server.ts:712`; 테스트: `test/server-ws-frames.test.ts` › `closes a peer that reads nothing for WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS after a frame was refused with 1013, calling onClose once`; `test/server-ws-frames.test.ts` › `keeps a peer open that reads part of its full queue within the timeout; the next refused frame starts a new wait`

**R-WS-027** relay가 `close(code)`를 하면 writable일 때 2-byte status만 담은 close frame을 송신 상한을 무시하고(4 byte)
쓰고, 즉시 `socket.end()`(FIN)를 하고, `closeTimeoutMs`(기본 `WEBSOCKET_CLOSE_TIMEOUT_MS` = 5000 ms) 뒤 peer가 끊지
않았으면 socket을 파기하는 timer를 MUST 시작한다. socket은 그 자리에서 멈춘다(`onClose`가 돌고 `send`는 `closed`).
두 번째 close는 아무것도 하지 않고, 멈춘 뒤 들어온 data는 버린다.\
근거: `src/server/ws-upgrade.ts:66`, `src/server/ws-upgrade.ts:594`, `src/server/ws-upgrade.ts:597`, `src/server/ws-upgrade.ts:603`, `src/server/ws-upgrade.ts:606`, `src/server/ws-upgrade.ts:756`; 테스트: `test/server-ws-frames.test.ts` › `returns 'closed' after the relay closes the socket, which calls onClose at once and closes only once`; `test/server-ws-frames.test.ts` › `closes within the close timeout while a provider ignores the relay's close`

**R-WS-028** `PeerSocket.close(code)`는 정수 1000-1003, 1007-1009, 1011-1014, 3000-4999만 MUST 받고 기본값은 1000이다.
1004-1006, 1010, 1015, 2999, 5000, 소수, NaN, Infinity 같은 다른 값은 socket 상태와 무관하게 아무것도 보내지 않고
`RangeError('close code must be an integer from 1000 to 1003, 1007 to 1009, 1011 to 1014 or 3000 to 4999, got <code>')`를
던진다. R-WS-019의 되돌림도 1010을 보내지 않으므로 relay가 쓰는 close frame에는 1010이 없다.\
근거: `src/server/ws-upgrade.ts:367`, `src/server/ws-upgrade.ts:841`, `src/server/ws-upgrade.ts:842`; 테스트: `test/server-ws-frames.test.ts` › `refuses close code %s with a RangeError, sending nothing and leaving the socket open`; `test/server-ws-frames.test.ts` › `sends 1000 (Normal Closure) for close() and close(undefined)`

**R-WS-029** peer가 TCP를 끝내면(`end`, close frame 유무와 무관) relay는 close frame 없이 socket을 멈추고(`onClose`)
MUST 파기한다. node:http upgrade socket은 그러지 않으면 half-open으로 남는다. `error`면 멈추고 파기하며, `close`면
close timer를 지우고 멈춘다. 어느 경우든 `onClose`는 정확히 한 번 돌고 조립 중이던 message는 버린다.\
근거: `src/server/ws-upgrade.ts:576`, `src/server/ws-upgrade.ts:811`, `src/server/ws-upgrade.ts:815`, `src/server/ws-upgrade.ts:819`; 테스트: `test/server-ws-frames.test.ts` › `calls onClose once and destroys the socket when the client ends TCP without a close frame`; `test/server-ws-frames.test.ts` › `returns 'closed' after the client resets the connection without a close frame`

### 2.4 relay가 보내는 close code

| code | 뜻 | relay가 보내는 경우 |
|---|---|---|
| 1000 | 최종 close. 이유는 그 앞의 frame이 알린다 | 승인 만료(`approval.expired` 뒤); ticket 거절·revoke·rotate·room 만료(`approval.rejected`·`session.revoked`·`room.rotated`·`room.expired` 뒤, R-WS-037); room rotate의 provider socket(`room.rotated` 뒤); peer가 보낸 1000·1010·빈 close frame의 답(R-WS-019); session이 끝나 닫히는 중인 client socket이 보낸 frame(R-ROOM-057); `ready` 전송에 실패한 socket(쓸 수 없는 socket이라 frame은 나가지 않는다) |
| 1001 | relay가 사라진다. 다시 붙어도 된다 | `WebMcpPeerServer.close()`(모든 provider·client socket과 닫히는 중인 agent socket, R-ROOM-066); liveness timeout(R-WS-039) |
| 1002 | peer의 frame 거절 | 수신 protocol 위반(R-WS-013, R-WS-014), 잘못된 close payload(R-WS-019) |
| 1003 | peer의 frame 거절 | binary frame(R-WS-013) |
| 1007 | peer의 frame 거절 | UTF-8이 아닌 text message(R-WS-017) |
| 1009 | peer의 frame 거절 | 상한을 넘는 frame·message·fragment 수(R-WS-015, R-WS-016) |
| 1011 | 소유자 오류 | 소유자 `onText` 예외(R-WS-020). relay에서는 실제로 나오지 않는다 |
| 1013 | 다시 시도해도 되는 shed | 송신 queue stall(R-WS-026) |
| 4001 `SUPERSEDED` | 다른 socket이 이 socket을 대신한다. 다시 붙지 않는다 | provider socket 교체·분리(`detachClosedProvider`, R-ROOM-052); ticket당 socket 상한으로 밀려난 client socket(R-ROOM-056); room에 붙어 있지 않은 provider socket이 보낸 frame(R-ROOM-055, 방어용) |
| 4002 `ROOM_EXPIRED` | room이 만료됐다. 다시 붙지 않는다 | room 만료 처리의 provider socket(R-ROOM-050, frame 없음); ticket이 만료된 client socket이 보낸 frame(R-ROOM-057, 방어용. ticket 만료는 room 만료다) |
| peer의 code | — | peer close frame의 유효한 status 되돌림(R-WS-019) |

**R-WS-030** relay가 먼저 닫는 close는 위 표의 code만 표의 뜻으로 MUST 쓴다(`WEBMCP_CLOSE_CODES`). 1000은 이유를 frame으로 알린 뒤의
최종 close이고, frame 없이 닫는 이유는 application code(4001 `SUPERSEDED`, 4002 `ROOM_EXPIRED`)로 싣는다. relay는 1008을 보내지 않고,
1013은 stall timer로만, 1001은 relay 종료와 liveness timeout으로만 보낸다. peer는 다시 붙을지를 close code로 MUST 정한다. 1001, 1006(close
frame 없이 끊긴 연결), 1013 뒤에는 다시 붙어도 된다. 1000, 4001, 4002와 peer 자신의 frame을 거절한 code(1002, 1003, 1007, 1009, 1011) 뒤에는
MUST NOT 다시 붙는다. 4001 뒤에 다시 붙으면 자기를 대신한 socket을 다시 밀어내고, 다른 code는 같은 거절을 다시 받는다. provider의
auto-reconnect는 R-PEER-025, agent client는 R-PEER-045다.\
근거: `src/config/close-codes.ts:21`, `src/config/close-codes.ts:43`, `src/server/peer-server.ts:969`, `src/server/peer-server.ts:970`, `src/server/peer-server.ts:972`, `src/server/peer-server.ts:1512`, `src/server/peer-server.ts:2561`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:2924`, `src/server/peer-server.ts:3744`, `src/server/peer-server.ts:3843`, `src/server/peer-server.ts:3945`, `src/server/peer-server.ts:3986`, `src/server/peer-server.ts:4113`, `src/server/peer-server.ts:4122`, `src/server/ws-upgrade.ts:545`, `src/server/ws-upgrade.ts:725`; 테스트: `test/relay-message-limit.test.ts` › `closes with 1003 for binary data, 1002 for protocol violations and 1000 for a normal close`; `test/relay-message-limit.test.ts` › `holds at most 4 client sockets per ticket, closing the oldest for a new one`; `test/relay-message-limit.test.ts` › `closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on`; `test/server-ws-frames.test.ts` › `names 1013 (Try Again Later), the code that sheds a peer it may retry`; `test/server-ws-frames.test.ts` › `closes within the close timeout while a provider ignores the relay's close`; `test/server-upgrade.test.ts` › `closes the provider socket of a room that expires with 4002 ROOM_EXPIRED, and an agent's with 1000 after room.expired`

### 2.5 backpressure

**R-WS-031** agent가 요청한 frame — 자신의 `mcp` 요청에 대한 provider 답과 relay의 답·오류, `approval.pending`,
`approval.approved`와 그 뒤의 `ready`, 자기 offer의 `answer`·`release`와 `offer.refused`, session을 끝내는 종료 frame(R-WS-037) — 은
agent socket마다 둔 `AgentOutbox`로 MUST 보낸다. 이런 frame은 queue가 가득 찼다는 이유로 버려지지 않고 socket을 닫지도 않는다. 첫
`busy`에서 frame은 socket별 FIFO에서 기다리고, relay는 그 agent의 TCP socket 읽기를 멈춘다(`pause`). 그 뒤로 codec은 그 agent의 frame을,
이미 읽은 read에 남은 것까지 처리하지 않는다(R-WS-040). 가장 오래 기다린 frame을 `drain`과
`AGENT_OUTBOX_RETRY_MS` = 1000 ms마다 다시 보낸다. 그래서 거절이 이어지는 동안 codec의 30 s stall close가 계속 유효하다. 기다리는
frame이 다 나가면 읽기를 재개한다. 이미 기다리는 frame이 있을 때 262144 byte를 넘는 새 frame은 queue하지 않고 `too-large`를 돌려준다.
socket이 멈추면 기다리던 frame은 버리고 읽기를 재개한다. 기다리는 frame 가운데 JSON-RPC 답만 pending 상한(R-MCP-032)에 센다.\
근거: `src/server/peer-server.ts:628`, `src/server/peer-server.ts:688`, `src/server/peer-server.ts:693`, `src/server/peer-server.ts:695`, `src/server/peer-server.ts:731`, `src/server/peer-server.ts:740`, `src/server/peer-server.ts:756`, `src/server/peer-server.ts:698`, `src/server/peer-server.ts:1328`, `src/server/peer-server.ts:1391`, `src/server/peer-server.ts:1470`; 테스트: `test/relay-backpressure.test.ts` › `keeps an agent that falls behind on the replies it asked for, reads nothing more from it meanwhile, and delivers them all in order once it reads`; `test/relay-backpressure.test.ts` › `offers the oldest waiting reply again while the agent reads nothing, so the codec's stall close stays armed`; `test/relay-backpressure.test.ts` › `drops the replies waiting for an agent that goes away, and keeps the room serving`; `test/relay-backpressure.test.ts` › `ends the session of an agent that is behind on %s after the replies it asked for, then closes it`; `test/relay-backpressure.test.ts` › `holds one catalog listing for an agent waiting for approval that does not read, however many one read asks for, and delivers every listing in order once it reads`

**R-WS-032** 어떤 agent도 요청하지 않은 frame — catalog announcement, `notifications/tools/list_changed`, provider가 보낸
JSON-RPC notification·요청(R-SIG-004) — 은 UTF-8 길이를 한 번 재고 room의 client socket마다(provider frame은 approved ticket에 묶인
socket마다) 제시한다. 그 socket의 outbox에 기다리는 frame이 없고 `writableLength` + JSON byte + 20(`MAX_MESSAGE_HEADER_BYTES`)이 786412
(`MAX_UNREQUESTED_QUEUE_BYTES` = 1048576 − 262164) 이하일 때만 relay는 MUST 보낸다. 아니면 그 agent에게만 건너뛰고 socket은 열어 둔다.
남은 공간은 상한 크기의 답 하나를 위한 것이다. 재는 JSON과 건너뛴 frame의 효과는 R-WS-036, R-WS-035다.\
근거: `src/server/peer-server.ts:610`, `src/server/peer-server.ts:618`, `src/server/peer-server.ts:709`, `src/server/peer-server.ts:712`, `src/server/peer-server.ts:1366`, `src/server/peer-server.ts:1370`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`

**R-WS-036** relay는 broadcast하는 provider frame을 받은 text가 아니라 `JSON.parse`한 값을 `JSON.stringify`로 다시 쓴
JSON으로 MUST 재고 보낸다. 다시 쓴 JSON은 받은 text보다 길 수 있다(예: `1e20`은 `100000000000000000000`이 된다). 그래서
262144 byte 안으로 받은 provider frame이라도 다시 쓴 길이가 262144를 넘으면 socket마다 건너뛰어지거나 `send`가
`too-large`(R-WS-023)를 돌려줘 어떤 agent에게도 가지 않는다. relay는 이것을 provider에게도 agent에게도 알리지 않는다. agent가
요청한 provider frame은 다시 써도 같은 방식으로 재지만 버리지 않는다. 다시 쓴 offer의 `answer`·`release`는 R-SIG-019를 따른다.\
근거: `src/server/peer-server.ts:3847`, `src/server/peer-server.ts:3912`, `src/server/peer-server.ts:1368`, `src/server/peer-server.ts:1372`, `src/server/peer-server.ts:713`, `src/server/ws-upgrade.ts:557`; 테스트: `test/server-signaling-frames.test.ts` › `measures a provider notification as it writes it again, so one that grows past the message limit reaches no agent`

**R-WS-035** `AgentOutbox.offer`는 frame을 건너뛸 때 `PeerSocket.send`를 MUST NOT 부른다. 그래서 건너뛴 broadcast는
codec의 거절이 아니고 stall timer(R-WS-026)를 시작하지 않는다. 요청한 frame이 없어 요청하지 않은 frame만 받는 agent가
읽지 않으면, broadcast만으로는 그 queue가 786412 byte를 넘지 않으므로 relay는 그 때문에 socket을 닫지 않는다. 읽지도 보내지도 않는(pong
포함) agent는 liveness timeout(R-WS-039)이 1001로 닫는다.\
근거: `src/server/peer-server.ts:711`, `src/server/peer-server.ts:712`, `src/server/peer-server.ts:713`, `src/server/ws-upgrade.ts:540`, `src/server/ws-upgrade.ts:542`, `src/server/ws-upgrade.ts:725`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`; `test/server-upgrade.test.ts` › `pings every socket and closes one it stops hearing from with 1001, detaching the provider`

**R-WS-033** agent 방향 frame 가운데 `AgentOutbox`를 거치지 않고 `PeerSocket.send`로 보내는 것은 client 부착 시의 첫
`ready`와 `pong`뿐이다. 첫 `ready`는 그 socket에 아무것도 보내지 않은 때에 가므로 queue에 막히지 않고(`sent`가 아니면 socket을 붙이지
않는다, R-ROOM-056), `pong`은 queue가 가득 차면 사라진다(R-SIG-007). 그 밖의 relay frame은 모두 outbox를 MUST 거친다(R-WS-031,
R-WS-032). 그래서 session을 끝내는 frame도 기다리는 답을 앞지르지 않고 `busy`로 사라지지 않는다(R-WS-037).\
근거: `src/server/peer-server.ts:4112`, `src/server/peer-server.ts:3992`, `src/server/peer-server.ts:1328`; 테스트: `test/relay-backpressure.test.ts` › `ends the session of an agent that is behind on %s after the replies it asked for, then closes it`; `test/relay-backpressure.test.ts` › `expires the approval of an agent that is behind after the answers it asked for, then closes it`

**R-WS-037** relay가 agent socket의 session을 끝낼 때 — 승인 요청 만료(R-ROOM-026)와 ticket 종료(R-ROOM-047: 거절, revoke,
rotate, room 만료) — 그 socket마다 다음 순서를 MUST 따른다. 먼저 socket을 room과 ticket 묶음에서 떼어(`detachClientSocket`) 그 뒤의
broadcast와 provider frame을 받지 않게 하고, 그 socket이 전달한 offer의 경로를 잊는다(R-SIG-026). 종료 frame(`approval.expired`,
`approval.rejected`, `session.revoked`, `room.rotated`, `room.expired`)을 outbox로 보내고, ticket 종료라면 그 socket의 pending 요청을 오류로
끝낸 뒤(그 오류도 outbox로 간다), `closeAgentSocket`으로 닫는다. `closeAgentSocket`은 outbox의 `closeAfterFlush`로, 기다리는 frame이 없으면
바로, 있으면 마지막 frame이 나간 직후 1000으로 닫는다. 그때부터 outbox는 frame을 더 받지 않는다(`deliver`·`offer`는 `closed`). 그래서
agent는 끝나기 전에 요청한 frame — outbox에서 기다리던 답, 이미 실행된 `tools/call`의 결과 포함 — 을 순서대로 모두 받고, 그다음 종료
frame과 pending 요청의 오류를, 마지막으로 close를 받는다. 닫히는 동안 읽지 않는 agent는 codec의 stall close(R-WS-026, 1013)로 닫히고
기다리던 frame은 버려진다. 그 사이 이미 읽은 frame은 처리하지 않는다(R-ROOM-057). relay의 `close()`는 닫히는 중인 socket도 바로 1001로
닫는다. ticket당 socket 상한(R-ROOM-056)이 밀어내는 socket은 session이 끝난 것이 아니므로 frame 없이 바로 4001로 닫는다.\
근거: `src/server/peer-server.ts:657`, `src/server/peer-server.ts:670`, `src/server/peer-server.ts:689`, `src/server/peer-server.ts:710`, `src/server/peer-server.ts:724`, `src/server/peer-server.ts:727`, `src/server/peer-server.ts:770`, `src/server/peer-server.ts:1338`, `src/server/peer-server.ts:1344`, `src/server/peer-server.ts:1345`, `src/server/peer-server.ts:1353`, `src/server/peer-server.ts:2559`, `src/server/peer-server.ts:2560`, `src/server/peer-server.ts:2561`, `src/server/peer-server.ts:2760`, `src/server/peer-server.ts:2761`, `src/server/peer-server.ts:2762`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:972`, `src/server/peer-server.ts:4122`; 테스트: `test/relay-backpressure.test.ts` › `ends the session of an agent that is behind on %s after the replies it asked for, then closes it`; `test/relay-backpressure.test.ts` › `expires the approval of an agent that is behind after the answers it asked for, then closes it`

**R-WS-034** relay는 provider socket에 outbox를 두지 않고, provider 방향 frame은 모두 `PeerSocket.send`로 MUST 보낸다.
provider queue가 가득 차도(`busy`) provider를 닫지 않는다. 그 결과는 frame마다 다르다. id가 있는 중계 요청은
PROVIDER_BUSY로 답하고(R-MCP-024, R-MCP-035), offer는 `offer.refused`(PROVIDER_BUSY)로 답한다(R-SIG-018). WebSocket
JSON-RPC notification은 답 없이 버린다(R-MCP-030. HTTP notification은 503 `PROVIDER_BUSY`, R-MCP-022). 승인 요청은 다음
접촉 때 다시 보낸다(R-ROOM-025). 다음 frame은 다시 보내지 않고 사라진다: `pong`, register 거절(`CATALOG_INVALID`·
`CATALOG_TOO_LARGE`), 승인 결정 echo(`approval.approved`·`approval.rejected`), `INVALID_APPROVAL` error frame,
`approval.restored`, 승인 요청 만료의 `approval.expired`, revoke의 `session.revoked`(R-SIG-024), rotate 때의 provider용
`room.rotated`(그 뒤 provider socket은 닫힌다). 그 socket에 다시 보내지 않을 뿐, ticket 종료를 알린 `approval.rejected`·`approval.expired`·
`session.revoked`는 그 뒤 붙는 provider socket에 replay한다(R-ROOM-053).\
근거: `src/server/peer-server.ts:3848`, `src/server/peer-server.ts:3853`, `src/server/peer-server.ts:4084`, `src/server/peer-server.ts:1414`, `src/server/peer-server.ts:4050`, `src/server/peer-server.ts:3366`, `src/server/peer-server.ts:3368`, `src/server/peer-server.ts:2593`, `src/server/peer-server.ts:1704`, `src/server/peer-server.ts:3868`, `src/server/peer-server.ts:2864`, `src/server/peer-server.ts:2865`, `src/server/peer-server.ts:2624`, `src/server/peer-server.ts:2578`, `src/server/peer-server.ts:2768`, `src/server/peer-server.ts:2696`, `src/server/peer-server.ts:3734`, `src/server/peer-server.ts:3744`; 테스트: `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`; `test/server-ws-frames.test.ts` › `answers the agent requests a provider that stops reading cannot take with a retryable PROVIDER_BUSY, and keeps the provider`; `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`

### 2.6 HTTP dispatch와 공통 응답

**R-HTTP-001** relay는 HTTP 요청마다 먼저 Host를 검사하고(R-HTTP-020), `req.url`을 해석하고(R-HTTP-015) 만료 room sweep
(`cleanupExpiredRooms`, R-ROOM-049)을 돌린 뒤 다음 순서로 MUST 경로를 맞춘다. WebSocket upgrade는 sweep을 돌리지 않는다(대상 room의
만료만 R-ROOM-067대로 처리한다). 경로는 정규화된 pathname만 쓰고 query string은 무시한다.

1. 모든 경로의 `OPTIONS`(R-HTTP-010)
2. 허용되지 않은 Origin 거절(R-HTTP-011)
3. 1단계가 끝낸 `OPTIONS`를 뺀 모든 method의 `/status`, `/health`, `/ping`(R-ROOM-006)
4. `GET /config`(R-ROOM-007)
5. `customHttpHandler`. `true`를 돌려주면 끝
6. `POST /p`, `POST /p/:id/reclaim`
7. `GET /mcp/catalog`, `GET /mcp/catalog/:hash`
8. SSE만 받는 `GET /p/:id/mcp`(405), `DELETE /p/:id/mcp`(405), `GET /p/:id/mcp`, `GET /p/:id/mcp/tools`, `POST /p/:id/mcp`
9. `POST /p/:id/join`, `POST /p/:id/approval/:requestId`, `GET /p/:id/sessions/:sessionId`, `POST /p/:id/session/revoke`·`POST /p/:id/sessions/:sessionId/revoke`, `POST /p/:id/rotate`
10. 경로가 3~9의 route이지만 method가 그 route의 것이 아니면(예: `GET /p/:id/join`, `PUT /p/:id/mcp`, `POST /config`) 405
    `{error:'METHOD_NOT_ALLOWED'}`와 그 route의 `Allow`(R-HTTP-022). 그 밖은 404 `{error:'NOT_FOUND'}`.

근거: `src/server/peer-server.ts:2953`, `src/server/peer-server.ts:2956`, `src/server/peer-server.ts:2961`, `src/server/peer-server.ts:2962`, `src/server/peer-server.ts:2966`, `src/server/peer-server.ts:2983`, `src/server/peer-server.ts:2990`, `src/server/peer-server.ts:3004`, `src/server/peer-server.ts:3019`, `src/server/peer-server.ts:3762`, `src/server/peer-server.ts:3767`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`; `test/server-http-security.test.ts` › `answers a method a route does not take with 405 and the methods it does`; `test/server-http-security.test.ts` › `matches a route on the path a WHATWG URL makes of the request target`

**R-HTTP-015** relay는 HTTP 요청과 upgrade 모두 `new URL(req.url ?? '/', 'http://{host}:{port}')`(WHATWG URL)의
`pathname`으로 MUST 경로를 맞춘다. 그래서 request-target은 맞추기 전에 정규화된다. dot segment는 지운다
(`/p/abc/../def/join` → `/p/def/join`. `%2e%2e`도 dot segment다). 경로 안의 `\`는 `/`로 읽는다(`/a\..\p` → `/p`. `\`로
시작하는 target은 node:http가 먼저 400으로 거절한다). `//`로 시작하는 target은 첫 segment가 authority로 읽혀 빠진다
(`POST //x/p`는 `POST /p`로 room을 만든다). 해석되지 않는 target(예: `//`)은 예외가 된다. HTTP에서는 이 해석이 Host 검사
(R-HTTP-020) 뒤이고 sweep, `OPTIONS`, Origin 검사보다 먼저이므로 허용된 host로 온 그런 요청은 `OPTIONS`이든 허용되지 않은 Origin이든
R-HTTP-003의 500 `PEER_REQUEST_FAILED`(또는 `formatHttpError` 결과)를 받는다. upgrade에서는 Host·Origin 검사 뒤, hook 앞에서 예외가
되어 socket이 파기된다(R-WS-002).\
근거: `src/server/peer-server.ts:2956`, `src/server/peer-server.ts:2961`, `src/server/peer-server.ts:2962`, `src/server/peer-server.ts:918`, `src/server/peer-server.ts:3790`, `src/server/peer-server.ts:4133`; 테스트: `test/server-http-security.test.ts` › `matches a route on the path a WHATWG URL makes of the request target`

**R-HTTP-016** 운영자는 relay의 `host`로 IPv6 literal을 MUST NOT 쓴다. IPv4 주소나 hostname만 동작한다. relay는 base
URL을 `http://${host}:${port}`로 대괄호 없이 만들므로, `::`나 `::1` 같은 host에서는 R-HTTP-015의 해석이 언제나
`ERR_INVALID_URL`로 실패한다. 그러면 Host 검사(R-HTTP-020)를 지난 모든 HTTP 요청이 sweep·`OPTIONS`·Origin 검사 전에 R-HTTP-003의 500
`PEER_REQUEST_FAILED`(또는 `formatHttpError` 결과)를 받고, Host·Origin 검사(R-WS-003)를 지난 모든 upgrade가 파기된다.
대괄호를 쓴 `[::1]`은 URL로는 해석되지만 `server.listen`이 그 이름을 찾지 못해(`ENOTFOUND`) relay가 시작되지 않는다. 같은
대괄호 없는 형식이 `requestOrigin`의 fallback host(R-HTTP-013), 기본 Origin 목록의 `http://{host}:{port}` 항목(R-HTTP-012),
host 목록의 `{host}:{port}` 항목(R-HTTP-020)에도 쓰인다. relay는 host 값을 검사하지 않고, loopback인지만 본다(R-HTTP-020).\
근거: `src/server/peer-server.ts:2961`, `src/server/peer-server.ts:3790`, `src/server/peer-server.ts:951`, `src/server/peer-server.ts:1114`, `src/server/server-config.ts:456`, `src/server/server-config.ts:541`, `src/server/server-config.ts:550`, `src/server/server-config.ts:568`; 테스트: 없음

**R-HTTP-002** 모든 room route와 WebSocket upgrade 경로(reclaim, join, approval, sessions, revoke, rotate,
`/p/:id/mcp`, `/p/:id/mcp/tools`, `/p/:id/provider`, `/p/:id/client`)의 room id는 protocol의 room id 문법
`^[A-Za-z0-9_-]{1,128}$`(`WEBMCP_ROOM_ID_PATTERN`: 1~128자의 `A-Z`, `a-z`, `0-9`, `_`, `-`)에 MUST 맞아야 한다. 이 relay가
발급하는 id는 소문자 hex 32자(R-ROOM-001)이지만, 다른 relay가 발급한 id도 provider(R-PEER-002)와 agent client(R-PEER-054)가
받으므로 route는 문법 전체를 받는다. 문법에 맞지 않는 id(129자 이상, `.`, percent-encoding 등)는 route에 닿지 않고 404
`{error:'NOT_FOUND'}`를 받는다(upgrade는 404 `NOT_FOUND` 응답, R-WS-001). 문법에 맞지만 없는 id에는 route마다 자기 답을 한다. 수명주기
route는 404 `{error:'ROOM_NOT_FOUND', code:-32004}`(R-ERR-005), `GET /p/:id/mcp`는 `unknown` descriptor(R-ROOM-060),
`POST /p/:id/mcp`는 R-MCP-013의 답이다. room id는 대소문자를 구분한다. `/mcp/catalog/:hash`의 hash는 `[a-f0-9]{64}`다.\
근거: `src/config/types.ts:17`, `src/config/types.ts:25`, `src/server/peer-server.ts:407`, `src/server/peer-server.ts:408`, `src/server/peer-server.ts:410`, `src/server/peer-server.ts:417`, `src/server/peer-server.ts:3075`, `src/server/peer-server.ts:3132`, `src/server/peer-server.ts:3159`, `src/server/peer-server.ts:3206`, `src/server/peer-server.ts:3415`, `src/server/peer-server.ts:3492`, `src/server/peer-server.ts:3544`, `src/server/peer-server.ts:3607`, `src/server/peer-server.ts:3679`; 테스트: `test/server-room-lifecycle.test.ts` › `answers ROOM_NOT_FOUND for an unknown id of the protocol's grammar on every lifecycle route`; `test/server-room-lifecycle.test.ts` › `answers NOT_FOUND for an id outside the grammar on every room route, the MCP routes included`

**R-HTTP-018** `Authorization`으로 자격을 받는 모든 route — `POST /p`의 publish key, approval·rotate·revoke·session status의
providerToken, session status·revoke·`POST /p/:id/mcp`의 clientToken — 는 header를 한 가지 방법(`bearerCredential`)으로 MUST
읽는다. 첫 header 값만 쓴다(node:http는 반복된 `Authorization`의 첫 값만 남긴다). scheme `Bearer`는 대소문자를 무시하고
(RFC 9110 §11.1) 뒤에 공백 문자가 하나 이상 와야 하며, 그 뒤를 trim한 값이 token이다. 그래서 `bearer <t>`, `BEARER  <t>`도
같은 token이다. 다른 scheme(`Basic …` 등)이나 token 없는 `Bearer`는 Bearer 자격이 없는 요청이다. `X-Publish-Key`는 publish
key에서만, 그것도 Bearer 자격이 없을 때만 읽는다(R-ROOM-009). 공개 method `bearerToken(req)`도 이 규칙의 token(없으면 `''`)을
돌려주고 `X-Publish-Key`는 읽지 않는다. relay는 비밀 token을 문자 단위로 비교하지 않는다. providerToken은 상수 시간으로
비교하고(R-WS-006), clientToken은 SHA-256 hex로 ticket을 찾고(R-WS-007), publish key와 reconnectToken은 SHA-256 hex를 상수
시간으로 비교한다(R-ROOM-009, R-ROOM-015).\
근거: `src/server/peer-server.ts:452`, `src/server/peer-server.ts:453`, `src/server/peer-server.ts:455`, `src/server/peer-server.ts:456`, `src/server/peer-server.ts:464`, `src/server/peer-server.ts:2245`, `src/server/peer-server.ts:2253`, `src/server/peer-server.ts:2901`, `src/server/peer-server.ts:3294`, `src/server/peer-server.ts:3501`, `src/server/peer-server.ts:3562`, `src/server/peer-server.ts:3620`, `src/server/peer-server.ts:3683`; 테스트: `test/server-room-lifecycle.test.ts` › `takes a Bearer token with a scheme of any case and one or more spaces on every route`; `test/server-room-lifecycle.test.ts` › `reads X-Publish-Key for the publish key only`

**R-HTTP-019** relay는 거절한 자격을 그 자격이 오는 자리에 따라 한 규칙으로 MUST 알린다.

- `Authorization` 자격(R-HTTP-018): 요청에 Bearer 자격이 없으면 401 `<X>_REQUIRED`, 있지만 맞지 않으면 401 `<X>_INVALID`다.
  publish key는 `PUBLISH_KEY_REQUIRED`·`PUBLISH_KEY_INVALID`(`X-Publish-Key`도 자격이다, R-ROOM-009), approval과 rotate의
  providerToken은 `PROVIDER_TOKEN_REQUIRED`·`PROVIDER_TOKEN_INVALID`, session status·두 revoke·`POST /p/:id/mcp`의 clientToken은
  −32003 `CLIENT_TOKEN_REQUIRED`·`CLIENT_TOKEN_INVALID`다. providerToken도 받는 session status와 revoke에서는 providerToken도
  room의 client token도 아닌 token이 `CLIENT_TOKEN_INVALID`다.
- relay의 모든 401은 `WWW-Authenticate` challenge를 가진다(RFC 9110 §15.5.2). 자격이 없던 요청에는 `Bearer`, 자격을 낸 요청에는
  `Bearer error="invalid_token"`(RFC 6750 §3)이다. revoke된 ticket의 MCP POST가 받는 401 −32001 `SESSION_INVALID`(R-MCP-014)도
  후자다. 자격이 `Authorization`이 아니라 subprotocol의 `ticket.<token>`인 WebSocket upgrade의 401(R-WS-006, R-WS-007)도 같은 이름과
  challenge다.
- relay의 bearer 자격은 OAuth access token이 아니라 relay가 발급한 token(publish key는 운영자가 정한다, providerToken은 room 생성이,
  clientToken은 join이 발급한다)이고, relay는 OAuth 2.0 authorization(MCP authorization)을 제공하지 않는다. 그래서 challenge에
  `resource_metadata`(RFC 9728 §5.1)나 `scope` 같은 discovery 매개변수를 MUST NOT 싣고, protected resource metadata(RFC 9728:
  `/.well-known/oauth-protected-resource`와 그 아래 resource 경로), authorization server metadata(RFC 8414:
  `/.well-known/oauth-authorization-server`), OpenID Connect discovery(`/.well-known/openid-configuration`)를 제공하지 않는다(모두 404).
  challenge는 401에 RFC 9110이 요구하므로 보내며, agent가 그것으로 OAuth discovery를 시작하라는 뜻이 아니다(R-PEER-053).
- body 자격(join의 `inviteToken`, reclaim의 `leaseToken`)은 `Authorization`이 아니므로 401이 아니다. 없으면 400
  `INVITE_TOKEN_REQUIRED`·`ROOM_LEASE_REQUIRED`, 틀리면 403 `INVITE_TOKEN_INVALID`·`ROOM_LEASE_INVALID`이고 challenge가 없다.
- 맞는 자격으로 그 자격이 할 수 없는 일을 요청하면 401이 아니다. client token이 자기 것이 아닌 session을 지목하면 403
  `SESSION_NOT_OWNED`(R-ROOM-033, R-ROOM-040)이고, 이미 쓴 invite는 맞는 invite에만 409 `INVITE_TOKEN_CONSUMED`로 알린다(R-ROOM-020).

근거: `src/server/peer-server.ts:519`, `src/server/peer-server.ts:520`, `src/server/peer-server.ts:2121`, `src/server/peer-server.ts:2122`, `src/server/peer-server.ts:2198`, `src/server/peer-server.ts:2174`, `src/server/peer-server.ts:2175`, `src/server/peer-server.ts:2191`, `src/server/peer-server.ts:3827`, `src/server/peer-server.ts:3033`, `src/server/peer-server.ts:2434`, `src/server/peer-server.ts:2438`, `src/server/peer-server.ts:3296`, `src/server/peer-server.ts:3326`, `src/server/peer-server.ts:3567`, `src/server/peer-server.ts:3572`, `src/server/peer-server.ts:3576`, `src/server/peer-server.ts:3654`, `src/server/peer-server.ts:3659`, `src/server/peer-server.ts:3665`, `src/server/peer-server.ts:3430`, `src/server/peer-server.ts:3434`, `src/server/peer-server.ts:3438`, `src/server/peer-server.ts:3098`, `src/server/peer-server.ts:3103`; 테스트: `test/server-error-model.test.ts` › `tells a missing Authorization credential from a wrong one, with a Bearer challenge`; `test/server-error-model.test.ts` › `answers a missing body credential with 400 and a wrong one with 403, without a challenge`; `test/server-error-model.test.ts` › `tells only the right invite that it was already used`; `test/server-error-model.test.ts` › `lets a client token read the status of its own session only`; `test/server-upgrade.test.ts` › `tells a missing provider token from a wrong one, with a Bearer challenge`; `test/server-error-model.test.ts` › `offers no OAuth discovery: its Bearer challenge names no resource metadata, and every metadata path an OAuth client tries is 404`

**R-HTTP-003** 처리 중 잡히지 않은 예외는 `formatHttpError` hook이 있으면 그 `{status, error, requestId?}`로, 없으면
500 `{error:'PEER_REQUEST_FAILED'}`로 MUST 답한다(Origin이 허용되면 CORS header 포함). header를 이미 보냈으면 response를
파기한다. 경로 parameter의 잘못된 percent-encoding은 예외가 아니라 client 입력 오류다(RFC 9110 §15.5.1). approval의
`:requestId`, session status의 `:sessionId`, `POST /p/:id/sessions/:sessionId/revoke`의 `:sessionId`는 room 조회, 인증, body
읽기보다 먼저 decode하고(`decodePathParameter`), decode에 실패하면(예: `%E0`, `%E0%A4`) relay는 400 `{error:'INVALID_PATH'}`로
MUST 답한다. 이때 room과 ticket은 바뀌지 않는다.\
근거: `src/server/peer-server.ts:917`, `src/server/peer-server.ts:919`, `src/server/peer-server.ts:941`, `src/server/peer-server.ts:567`, `src/server/peer-server.ts:569`, `src/server/peer-server.ts:3495`, `src/server/peer-server.ts:3497`, `src/server/peer-server.ts:3547`, `src/server/peer-server.ts:3549`, `src/server/peer-server.ts:3610`, `src/server/peer-server.ts:3612`; 테스트: `test/server-error-model.test.ts` › `answers a malformed percent-encoding with 400 INVALID_PATH instead of failing the request`

**R-HTTP-017** `formatHttpError` hook은 MUST NOT 던진다. relay는 전역 `.catch` 안에서 hook을 다시 감싸지 않고 부르므로,
hook이 던지면 그 요청에는 아무 응답도 가지 않고 그 rejection은 처리되지 않는다. Node 기본값
(`--unhandled-rejections=throw`)에서는 relay process가 끝난다.\
근거: `src/server/peer-server.ts:918`, `src/server/peer-server.ts:920`, `src/server/peer-server.ts:939`; 테스트: 없음

**R-HTTP-004** JSON 응답(`sendJson`)은 `Content-Type: application/json`, body의 byte 수인 `Content-Length`(chunked가 아니다), 기본
`Cache-Control: no-store`, 기본 `Vary: Origin`을 MUST 가진다. relay의 모든 응답은 Origin에 따라 달라지므로(Origin이 거절되거나 CORS
header를 받는다) `Vary`는 Origin이 없는 요청의 응답에도 있다. Origin이 허용 목록에 있으면 CORS header(`corsHeaders`)
`Access-Control-Allow-Origin: <Origin>`, `Access-Control-Allow-Headers:` 아래 목록, `Access-Control-Expose-Headers:` 아래 목록을 더한다.
route 고유 header(catalog `Cache-Control`, `ETag`, `Vary`, `X-RateLimit-*`, `Retry-After`, `Allow`)는 이 기본값을 덮어쓰고, cache되는
route의 `Vary`도 `Origin`을 포함한다(R-ROOM-061, R-ROOM-064). 202 응답(`sendAccepted`)은 본문과 `Content-Type`·`Content-Length`가 없고
같은 기본 header를 가진다. relay는 `Access-Control-Allow-Credentials`를 보내지 않는다. 허용 request header 목록은
`Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name`
(`BROWSER_ALLOWED_REQUEST_HEADERS`)이다. 노출 header 목록은 CORS safelist에 없어 cross-origin script가 이것 없이는 읽지 못하는, relay가
client를 위해 보내는 header `Retry-After, ETag, X-MCP-Catalog-Version, X-MCP-Catalog-Hash, X-RateLimit-Limit, X-RateLimit-Remaining`
(`BROWSER_EXPOSED_RESPONSE_HEADERS`)이다. 그래서 browser agent도 `PROVIDER_BUSY`·rate limit의 `Retry-After`, 조건부 GET의 `ETag`, catalog
stamp, publish 할당량을 읽는다.\
근거: `src/server/peer-server.ts:778`, `src/server/peer-server.ts:786`, `src/server/peer-server.ts:2078`, `src/server/peer-server.ts:2083`, `src/server/peer-server.ts:2205`, `src/server/peer-server.ts:2215`, `src/server/peer-server.ts:2220`, `src/server/peer-server.ts:2229`, `src/server/peer-server.ts:2230`, `src/server/peer-server.ts:2231`; 테스트: `test/mcp-http-interop.test.ts` › `lets a browser send the MCP request headers through the CORS preflight`; `test/mcp-http-interop.test.ts` › `answers a notification with 202 and an empty body`; `test/server-http-security.test.ts` › `lets a browser read the headers the relay sends for its clients, on 200, 304 and 429 alike`; `test/server-http-security.test.ts` › `names Origin in the Vary of every response, the descriptor's also Accept`; `test/server-http-security.test.ts` › `refuses a disallowed Origin with one 403 ORIGIN_NOT_ALLOWED, on a preflight as on any other request`

**R-HTTP-005** relay는 어떤 POST에서도 `Content-Type`을 검사하지 않고, `Content-Length`로 크기를 미리 판단하지 않는다.
`Accept`는 `GET /p/:id/mcp`에서만 읽는다(R-ROOM-059).\
근거: `src/server/peer-server.ts:1205`, `src/server/peer-server.ts:3160`, `src/server/http-body.ts:52`; 테스트: `test/mcp-http-interop.test.ts` › `takes a POST whatever its Content-Type, and reads Accept only on the descriptor GET`

### 2.7 HTTP body

**R-HTTP-006** relay는 body를 `readBoundedBody(req, maxBytes, drainLimitBytes = 16 × maxBytes)`로 MUST 읽는다.
`maxBytes`까지는 보관한다. 넘으면 나머지는 버리면서 끝까지 읽고 `{kind:'too-large', drained:true}`가 된다. 받은 양이
`drainLimitBytes`를 넘는 순간 request를 파기하고 `{kind:'too-large', drained:false}`가 된다. 두 상한은 경계값을 포함한다
(정확히 `maxBytes`는 통과). chunked body도 같다.\
근거: `src/server/http-body.ts:31`, `src/server/http-body.ts:55`, `src/server/http-body.ts:85`, `src/server/http-body.ts:92`, `src/server/http-body.ts:104`; 테스트: `test/server-http-body.test.ts` › `drains a body over the limit (within the drain limit) so a response still reaches the client`; `test/server-http-body.test.ts` › `destroys the request once its body goes past the drain limit`; `test/server-http-body.test.ts` › `treats both limits as inclusive`; `test/server-http-body.test.ts` › `reads chunked bodies without a Content-Length under the same limit`

**R-HTTP-007** `readBoundedBody`는 먼저 request 상태를 MUST 본다. 이미 끝났고 body를 조금이라도 읽은 적이 있으면
(`readableDidRead`) `BODY_CONSUMED`로 거절하고, 끝났지만 읽은 적이 없으면 빈 body다. 파기됐으면 `BODY_ABORTED`(읽은 적이
있으면 `BODY_CONSUMED`)로 거절한다. 일부만 읽혔으면 남은 것을 drain한 뒤(drain 상한을 넘으면 파기) `BODY_CONSUMED`로
거절한다. 멈춘(paused) request는 다시 흐르게 한다. body 중간의 abort·close는 `BODY_ABORTED`(또는 request 자신의
오류)이고, 끝날 때 붙인 listener를 모두 뗀다.\
근거: `src/server/http-body.ts:18`, `src/server/http-body.ts:23`, `src/server/http-body.ts:57`, `src/server/http-body.ts:59`, `src/server/http-body.ts:64`, `src/server/http-body.ts:107`, `src/server/http-body.ts:108`, `src/server/http-body.ts:115`; 테스트: `test/server-http-body.test.ts` › `rejects BODY_ABORTED at once for a request destroyed before the read`; `test/server-http-body.test.ts` › `rejects BODY_CONSUMED for a body an earlier reader took part of, once it has drained the rest`; `test/server-http-body.test.ts` › `resumes a request an earlier hook paused instead of waiting for data that never flows`; `test/server-http-body.test.ts` › `rejects a request aborted mid-body and removes every listener it attached`

**R-HTTP-008** JSON body route(`POST /p`, reclaim, join, approval, 두 revoke, rotate)는 `MAX_JSON_BODY_BYTES` = 65536
byte로 읽는다(drain 상한 1048576). 다음 경우 endpoint는 아무 동작도 MUST NOT 하고 이렇게 답한다. 상한을 넘었고
drain됨: 413 `{error:'BODY_TOO_LARGE'}`. drain 상한을 넘음: response 파기. UTF-8이 아니거나 JSON이 아니거나 object가 아님:
400 `{error:'INVALID_JSON_BODY'}`. `BODY_CONSUMED`: request가 끝났고 header를 안 보냈으면 500 `{error:'BODY_CONSUMED',
code:-32603}`(MCP의 같은 이름과 같은 code, R-ERR-005), 아니면 파기. abort: 파기. 맨 앞의 U+FEFF(BOM) 하나는 모든 JSON 입력처럼 해석 전에 지운다(R-SIG-001, RFC 8259 §8.1). 그 뒤 비었거나
`String#trim`이 지우는 공백뿐인 body는 `{}`다(trim은 Unicode 공백과 남은 U+FEFF도 지운다).\
근거: `src/server/peer-server.ts:106`, `src/server/peer-server.ts:373`, `src/server/peer-server.ts:384`, `src/server/peer-server.ts:2352`, `src/server/peer-server.ts:2368`, `src/server/peer-server.ts:2378`, `src/server/peer-server.ts:2382`, `src/server/peer-server.ts:2383`, `src/server/peer-server.ts:2389`, `src/server/peer-server.ts:2401`; 테스트: `test/relay-message-limit.test.ts` › `delivers 413 BODY_TOO_LARGE for join bodies over 64 KiB and leaves the connection usable`; `test/relay-message-limit.test.ts` › `revokes no session on an oversized, aborted or malformed body (an empty one would revoke them all)`; `test/relay-message-limit.test.ts` › `answers 500 BODY_CONSUMED instead of acting on a body a customHttpHandler read, and reads one it only paused`; `test/server-byte-order-mark.test.ts` › `is ignored in a JSON body route's body, as it was`

**R-HTTP-009** 상태를 바꾸는 route(reclaim, join, approval, revoke, rotate)는 body를 읽기 전과 다 읽은 뒤 두 번 room
검사를 MUST 한다. 자격 검사의 시점은 route마다 다르다. approval과 rotate는 `Authorization: Bearer`의 providerToken도
body 전과 뒤에 두 번 검사한다. revoke는 body 전에는 room만 보고, providerToken·clientToken은 body를 다 읽고 room을 다시
검사한 뒤 한 번만 본다. join(`inviteToken`)과 reclaim(`leaseToken`)은 자격이 body에 있으므로 body 뒤 room 재검사 다음에
한 번만 검사한다. 어느 경우든 자격 검사는 마지막 room 검사 뒤이므로 body가 오는 사이에 일어난 rotate, reclaim(새
providerToken), 만료가 이긴다.\
근거: `src/server/peer-server.ts:3091`, `src/server/peer-server.ts:3093`, `src/server/peer-server.ts:3096`, `src/server/peer-server.ts:3423`, `src/server/peer-server.ts:3425`, `src/server/peer-server.ts:3428`, `src/server/peer-server.ts:3505`, `src/server/peer-server.ts:3507`, `src/server/peer-server.ts:3509`, `src/server/peer-server.ts:3618`, `src/server/peer-server.ts:3619`, `src/server/peer-server.ts:3622`, `src/server/peer-server.ts:3626`, `src/server/peer-server.ts:3657`, `src/server/peer-server.ts:3689`, `src/server/peer-server.ts:3691`, `src/server/peer-server.ts:3703`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`; `test/relay-message-limit.test.ts` › `refuses a slow approval or rotation signed with a provider token a reclaim replaced meanwhile`

`POST /p/:id/mcp`의 body 규칙은 R-MCP-008, R-MCP-009에 있다.

### 2.8 CORS, Origin, Host

**R-HTTP-010** relay는 모든 경로의 `OPTIONS`에 Host 검사(R-HTTP-020) 다음, routing과 hook보다 먼저 MUST 답한다. Origin이 있고
허용되지 않으면 R-HTTP-011과 같은 403 `{error:'ORIGIN_NOT_ALLOWED', origin}`(`Content-Length`, `Vary: Origin`, CORS header 없음)이다.
아니면 204와 `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`(`BROWSER_ALLOWED_METHODS`, relay route가 받는 method),
`Access-Control-Allow-Headers:` R-HTTP-004의 목록, `Access-Control-Max-Age: 86400`, `Vary: Origin`이고, Origin이 있으면
`Access-Control-Allow-Origin: <Origin>`을 더한다. Origin이 없는 `OPTIONS`는 preflight가 아니므로 `Access-Control-Allow-Origin`을 MUST NOT
보낸다. `DELETE`가 목록에 있으므로 browser MCP client의 session 종료는 CORS 실패가 아니라 endpoint의 405(R-ROOM-062)를 받는다.
`Access-Control-Request-Method`·`-Headers`는 검사하지 않는다.\
근거: `src/server/peer-server.ts:782`, `src/server/peer-server.ts:2966`, `src/server/peer-server.ts:2967`, `src/server/peer-server.ts:2968`, `src/server/peer-server.ts:2971`, `src/server/peer-server.ts:2972`, `src/server/peer-server.ts:2973`; 테스트: `test/mcp-http-interop.test.ts` › `lets a browser send the MCP request headers through the CORS preflight`; `test/server-http-security.test.ts` › `answers a preflight with the methods the routes take, and an Origin-less OPTIONS without Access-Control-Allow-Origin`; `test/server-http-security.test.ts` › `refuses a disallowed Origin with one 403 ORIGIN_NOT_ALLOWED, on a preflight as on any other request`

**R-HTTP-011** relay는 Origin header가 있고 허용되지 않는 요청을 어디서 받든 같은 하나의 거절(`originRefusal`)로 MUST 답한다: 403
`{error:'ORIGIN_NOT_ALLOWED', origin}`, `Content-Type: application/json`, `Content-Length`, `Cache-Control: no-store`, `Vary: Origin`이고
`Access-Control-Allow-Origin`은 없다. `OPTIONS` preflight(R-HTTP-010), `/health`·`/config`·MCP route를 포함한 그 밖의 모든 method와 route,
WebSocket upgrade(R-WS-003, R-WS-038의 응답)가 모두 이 이름과 body다. Origin header가 없는 요청(브라우저 page가 아닌 client)은 언제나
허용한다.\
근거: `src/server/peer-server.ts:549`, `src/server/peer-server.ts:550`, `src/server/peer-server.ts:2968`, `src/server/peer-server.ts:2983`, `src/server/peer-server.ts:2984`, `src/server/peer-server.ts:3786`, `src/server/server-config.ts:592`; 테스트: `test/server-http-security.test.ts` › `refuses a disallowed Origin with one 403 ORIGIN_NOT_ALLOWED, on a preflight as on any other request`; `test/server-upgrade.test.ts` › `refuses an upgrade for a host it does not serve or from an Origin it does not allow as an HTTP request is refused, before any hook`

**R-HTTP-012** `isOriginAllowed(origin, list)`는 다음 경우에만 MUST 참이다. Origin 없음(빈 값 포함). 목록에 `*`. 목록 항목과 문자열이
정확히 같음. `*.suffix` 규칙: hostname이 suffix와 같거나 `.suffix`로 끝남(맨 도메인도 맞는다. scheme·port 무관). `proto://*.domain`
규칙: scheme이 같고 hostname이 domain과 같거나 `.domain`으로 끝남(맨 도메인도 맞는다. 규칙에 적은 port는 무시). `host[:port]` 규칙(`://`
없음): hostname이 같고, 규칙에 port가 있으면 Origin URL의 `port`와도 같음. IPv6 host는 대괄호로 쓴다(`[::1]`, `[::1]:4500`). URL의
`port`는 scheme 기본 port(http 80, https 443)이면 `''`이므로 port 규칙은 Origin에 기본이 아닌 port가 적혀 있을 때만 맞는다
(`example.com:443`은 `https://example.com`에 맞지 않는다). 해석할 수 없는 Origin(`null` 포함)은 `*`이나 같은 문자열 항목이 없으면
거절한다. 목록 밖에서 고정으로 허용하는 origin은 없다. 실효 목록(`PeerServerConfig.allowedOrigins`)은 설정 파일, `ALLOWED_ORIGINS`,
option, CLI 중 어디서든 목록을 정하면 그 목록들의 합집합이고(빈 목록도 정한 것이다. 그러면 브라우저 page는 모두 거절된다), 아무 데서도
정하지 않으면 기본 정책 `http://{host}:{port}`(relay 자신, IPv6 literal host면 쓸 수 없는 문자열이다, R-HTTP-016)와
`DEFAULT_ALLOWED_ORIGINS`다. 기본 목록은 `localhost`, `127.0.0.1`, `[::1]`(loopback page, scheme·port 무관)과
`*.framebook-storyboard.pages.dev`(그 app과 하위 도메인)다. 그래서 정한 목록은 기본 목록을 넓히지 않고 대신하며, 운영자는 "이 origin만"을
표현할 수 있다. 빈 `ALLOWED_ORIGINS`는 정하지 않은 것이다.\
근거: `src/server/server-config.ts:70`, `src/server/server-config.ts:71`, `src/server/server-config.ts:74`, `src/server/server-config.ts:341`, `src/server/server-config.ts:445`, `src/server/server-config.ts:537`, `src/server/server-config.ts:539`, `src/server/server-config.ts:541`, `src/server/server-config.ts:591`, `src/server/server-config.ts:592`, `src/server/server-config.ts:593`, `src/server/server-config.ts:594`, `src/server/server-config.ts:600`, `src/server/server-config.ts:609`, `src/server/server-config.ts:611`, `src/server/server-config.ts:612`, `src/server/server-config.ts:614`, `src/server/server-config.ts:618`, `src/server/server-config.ts:620`; 테스트: `test/server-http-security.test.ts` › `allows a loopback page of any scheme and port and the storyboard app by default, which a configured list leaves out`; `test/server-http-security.test.ts` › `replaces the default origins with the lists configured anywhere, merged`; `test/server-http-security.test.ts` › `serves only the configured origins once allowedOrigins is set, a loopback page included`

**R-HTTP-020** relay가 Host 검사를 켠 경우(`enforceAllowedHosts`) 요청의 host(`requestHost`: 신뢰한 proxy가 보낸 `X-Forwarded-Host`의
마지막 값, 없으면 `Host`, R-HTTP-021)와 요청이 가진 `Host` header가 모두 `isHostAllowed`에 맞아야 한다. 하나라도 맞지 않으면 relay는 HTTP
요청이든 upgrade든 다른 무엇보다 먼저(URL 해석, sweep, `OPTIONS`, Origin 검사, hook보다 앞) 403 `{error:'HOST_NOT_ALLOWED', host}`로 MUST
답한다(`hostRefusal`, upgrade는 R-WS-038의 응답). `host`는 맞지 않은 첫 값이다(`requestHost`, 그다음 `Host`). 신뢰한 proxy가 host를 알려도
`Host`를 보는 이유는 local tunnel 뒤의 loopback relay다. 그 relay가 신뢰하는 loopback 주소에서는 DNS rebinding으로 relay의 machine을 가리킨
page도 연결하고, page는 `X-Forwarded-Host`를 보낼 수 있다(Fetch의 금지 header가 아니다). loopback upstream `Host`를 그대로 두거나 공개
host를 전하는 proxy는 통과한다. `Host`를 다른 내부 이름으로 바꾸는 proxy를 두는 운영자는 그 이름을 `allowedHosts`에 MUST 넣는다. Host 검사는 `allowedHosts`를 설정 파일, `ALLOWED_HOSTS`, option, CLI 중 어디서든 정했거나 relay의 `host`가 loopback이면
(`isLoopbackHost`: `localhost`와 `.localhost` 이름, 127.0.0.0/8, `::1`) 켜진다. 그래서 기본 `host` 127.0.0.1의 relay는 DNS rebinding으로
자기 이름을 relay에 가리킨 page(Origin 없는 same-origin GET 포함)에 `/health`, descriptor를 포함한 어떤 route도 주지 않는다. 그 밖의
relay(예: `0.0.0.0`에 bind하고 목록을 정하지 않음)는 host로 거절하지 않고, host는 base URL을 고를 때만 쓴다(R-HTTP-013). 실효 host
목록(`PeerServerConfig.allowedHosts`)은 relay의 `host`와 `{host}:{port}`에, 정한 목록들의 합집합을, 아무 데서도 정하지 않았으면
`DEFAULT_ALLOWED_HOSTS`(`localhost`, `127.0.0.1`, `[::1]`, `framebook-storyboard.pages.dev`, `*.framebook-storyboard.pages.dev`,
`*.trycloudflare.com`, `*.workers.dev`, `*.pages.dev`)를 더한 것이다. 정한 목록은 기본 목록을 대신한다. `isHostAllowed(host, hosts,
origins)`는 host 없음, `hosts`의 `*`, loopback 이름(`localhost`, `127.0.0.1`, `[::1]`, port 무관. DNS-rebound page는 이 이름을 보내지 않으므로
목록과 무관하게 맞는다), 항목과 같은 `host:port` 또는 host, `*.suffix`(맨 도메인도 맞는다), 그 port의 `host:port` 규칙(IPv6는 대괄호), 허용
Origin 중 http(s) URL 항목의 hostname이면 참이다.\
근거: `src/server/peer-server.ts:1078`, `src/server/peer-server.ts:1079`, `src/server/peer-server.ts:1094`, `src/server/peer-server.ts:1095`, `src/server/peer-server.ts:1096`, `src/server/peer-server.ts:1097`, `src/server/peer-server.ts:2956`, `src/server/peer-server.ts:2958`, `src/server/peer-server.ts:3779`, `src/server/peer-server.ts:3781`, `src/server/server-config.ts:81`, `src/server/server-config.ts:330`, `src/server/server-config.ts:446`, `src/server/server-config.ts:546`, `src/server/server-config.ts:548`, `src/server/server-config.ts:551`, `src/server/server-config.ts:568`, `src/server/server-config.ts:627`, `src/server/server-config.ts:632`, `src/server/server-config.ts:633`, `src/server/server-config.ts:636`, `src/server/server-config.ts:642`, `src/server/server-config.ts:652`, `src/server/server-config.ts:656`, `src/server/server-config.ts:659`, `src/server/server-config.ts:667`; 테스트: `test/server-http-security.test.ts` › `refuses a request for a host it does not serve with 403 HOST_NOT_ALLOWED on every route, its public ones included`; `test/server-http-security.test.ts` › `serves only its own address and the configured hosts once allowedHosts is set`; `test/server-http-security.test.ts` › `enforces the host list only when it is configured or the relay binds the loopback interface`; `test/server-upgrade.test.ts` › `refuses an upgrade for a host it does not serve or from an Origin it does not allow as an HTTP request is refused, before any hook`; `test/server-http-security.test.ts` › `refuses a rebound page that names an allowed host to it through X-Forwarded-Host, trusting %s`

**R-HTTP-021** relay는 `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-For`를 `trustProxy`가 신뢰하는 peer에게서만 MUST 읽고, 그
밖에서는 누가 보냈든 MUST 무시한다(`createProxyTrust`). `false`(기본)는 아무도 신뢰하지 않는다. `true`는 relay의 peer(socket의 remote
address) 하나, 곧 relay 앞의 proxy 한 hop만 신뢰하고, 그 proxy가 전한 주소는 신뢰하지 않는다. 목록은 그 IPv4·IPv6 주소와 CIDR 범위
(`10.0.0.0/8`)를 path의 어느 hop에서든 신뢰한다(IPv4-mapped IPv6 주소는 그 IPv4 항목에 맞는다). relay의 peer가 신뢰되면 다음을 따른다.

- scheme과 host는 그 header의 마지막 값(가장 가까운 proxy가 쓴 값)이다. scheme은 소문자로 `http`나 `https`일 때만 쓴다(R-HTTP-013).
  Host 검사는 그 host와 함께 요청의 `Host`도 본다(R-HTTP-020).
- 요청의 주소(`clientAddress`)는 `X-Forwarded-For`를 가장 가까운 hop부터 거꾸로 읽어, 신뢰하는 hop인 동안 한 칸씩 넘어간 주소, 곧 신뢰
  경계 밖의 첫 주소다(모든 hop을 신뢰하면 맨 왼쪽 주소). 그래서 caller가 자기 proxy가 붙인 주소 앞에 쓴 주소는 닿지 않는다. peer가
  신뢰되지 않으면 socket의 remote address(없으면 `unknown`)다. 이 주소가 publish rate-limit bucket의 신원이다(R-ROOM-010).

`trustProxy`는 option, 설정 파일 `trustProxy`(boolean 또는 문자열 목록), env `PEER_SERVER_TRUST_PROXY`, CLI `--trust-proxy`(둘 다 대소문자를
무시한 `true`·`false` 또는 `,` 구분 목록)에서 CLI, option, 설정 파일, env 순으로 읽는다. 주소도 CIDR도 아닌 항목, 범위를 벗어난 prefix,
boolean도 목록도 아닌 값은 `TRUST_PROXY_INVALID`로 던진다. relay를 직접 노출하지 않고 proxy 뒤에 두는 배포는 그 proxy를 `trustProxy`로
MUST 지정한다. 그러지 않으면 descriptor는 relay가 받은 Host와 socket의 scheme을 쓰고, 모든 caller가 proxy의 주소 하나로 rate-limit
bucket을 나눈다.\
근거: `src/server/peer-server.ts:1048`, `src/server/peer-server.ts:1050`, `src/server/peer-server.ts:1057`, `src/server/peer-server.ts:1058`, `src/server/peer-server.ts:1068`, `src/server/peer-server.ts:1071`, `src/server/peer-server.ts:1072`, `src/server/peer-server.ts:868`, `src/server/server-config.ts:208`, `src/server/server-config.ts:273`, `src/server/server-config.ts:296`, `src/server/server-config.ts:297`, `src/server/server-config.ts:298`, `src/server/server-config.ts:306`, `src/server/server-config.ts:312`, `src/server/server-config.ts:317`, `src/server/server-config.ts:385`, `src/server/server-config.ts:388`, `src/server/server-config.ts:554`, `src/server/server-config.ts:561`; 테스트: `test/server-http-security.test.ts` › `names the scheme and host X-Forwarded-* give only when they come from a proxy it trusts`; `test/server-http-security.test.ts` › `counts a publish against the client past the trusted hops, trusting %s`; `test/server-http-security.test.ts` › `does not let a caller pick its bucket by writing an address ahead of its proxy's`; `test/server-http-security.test.ts` › `reads trustProxy from the CLI, the options, the config file and the environment, and refuses an entry that is no address`

**R-HTTP-013** relay는 descriptor와 `/config`에 넣을 base URL(`requestOrigin`)을 다음으로 MUST 만든다. scheme은 신뢰한 proxy가 보낸
`X-Forwarded-Proto`의 마지막 값이 `http`·`https`면 그것, 아니면 TLS socket이면 `https`, 아니면 `http`다. host는 요청의 host
(`requestHost`: 신뢰한 proxy의 `X-Forwarded-Host`, 없으면 `Host`, R-HTTP-021), 없으면 `{host}:{port}`이고, `isHostAllowed`(R-HTTP-020)가
거절하면 `{host}:{port}`로 바꾼다. Host 검사를 켠 relay에서는 거절된 host의 요청이 여기까지 오지 않는다(R-HTTP-020). 신뢰하지 않는 peer의
`X-Forwarded-*`는 base URL을 바꾸지 않는다.\
근거: `src/server/peer-server.ts:1107`, `src/server/peer-server.ts:1108`, `src/server/peer-server.ts:1109`, `src/server/peer-server.ts:1114`, `src/server/peer-server.ts:1115`, `src/server/peer-server.ts:1116`; 테스트: `test/server-http-security.test.ts` › `names the scheme and host X-Forwarded-* give only when they come from a proxy it trusts`; `test/server-http-security.test.ts` › `checks the host a trusted proxy names, and nothing an untrusted peer names`

**R-HTTP-022** relay route의 경로에 그 route가 받지 않는 method로 온 요청에는, `customHttpHandler`가 처리하지 않았으면 405
`{error:'METHOD_NOT_ALLOWED'}`와 그 route가 받는 method의 `Allow`로 MUST 답한다(RFC 9110 §15.5.6, `routeMethods`). route가 바뀌지 않으므로
room과 ticket은 바뀌지 않는다. `Allow`는 MCP endpoint `/p/:id/mcp`가 `GET, POST`(`MCP_ENDPOINT_METHODS`), `/config`, `/mcp/catalog`,
`/mcp/catalog/:hash`, `/p/:id/mcp/tools`, `/p/:id/sessions/:sessionId`가 `GET`, `/p`, reclaim, join, approval, 두 revoke route, rotate가
`POST`다. MCP endpoint의 다른 405 둘(SSE만 받는 GET, R-ROOM-059. DELETE, R-ROOM-062)도 같은 `Allow: GET, POST`를 보내므로 한 resource의
`Allow`는 하나다. `/status`, `/health`, `/ping`은 `OPTIONS`를 뺀 모든 method를 받는다(R-ROOM-006). `OPTIONS`는 어느 경로에서든
routing보다 먼저 preflight로 답하므로(R-HTTP-010) `Allow`에 없는 route에서도 405가 아니다. relay route가 아닌 경로(socket endpoint
`/p/:id/provider`·`/p/:id/client`에 온 보통 HTTP 요청 포함, R-WS-008)는 404 `NOT_FOUND`다. `HEAD`는 받는 method가 아니다.\
근거: `src/server/peer-server.ts:423`, `src/server/peer-server.ts:430`, `src/server/peer-server.ts:431`, `src/server/peer-server.ts:433`, `src/server/peer-server.ts:435`, `src/server/peer-server.ts:3166`, `src/server/peer-server.ts:3171`, `src/server/peer-server.ts:3762`, `src/server/peer-server.ts:3764`, `src/server/peer-server.ts:3767`, `src/server/peer-server.ts:2966`; 테스트: `test/server-http-security.test.ts` › `answers a method a route does not take with 405 and the methods it does`; `test/mcp-http-interop.test.ts` › `refuses the optional SSE GET with 405 while plain GETs keep returning the descriptor`; `test/server-http-security.test.ts` › `answers /status, /health and /ping for every method but OPTIONS, which is the preflight on every path`

### 2.9 조건부 GET

**R-HTTP-014** `GET /p/:id/mcp`, `GET /p/:id/mcp/tools`(200이 될 때), `GET /mcp/catalog[/:hash]`에서 `If-None-Match`
(여러 개면 `,`로 합친다)의 `,` 구분 token 하나를 trim한 값이 ETag와 정확히 같거나 값이 `*`면 relay는 304와 그 route의
cache header(`Cache-Control`, `ETag`, `X-MCP-Catalog-*`, `Vary`), `Content-Length: 0`으로 MUST 답한다. Origin이 허용되면 R-HTTP-004의 CORS
header(`Access-Control-Allow-Origin`, `-Allow-Headers`, `-Expose-Headers`)를 더한다. 304에는 `Cache-Control: no-store`가 붙지 않고 본문이
없다. weak validator(`W/"…"`)와 다른 tag는 맞지 않아 200이다.\
근거: `src/server/peer-server.ts:1917`, `src/server/peer-server.ts:1919`, `src/server/peer-server.ts:1922`, `src/server/peer-server.ts:1924`, `src/server/peer-server.ts:2215`; 테스트: `test/server-http-security.test.ts` › `answers a conditional GET whose If-None-Match names the ETag with 304 and the route's cache headers`; `test/server-http-security.test.ts` › `lets a browser read the headers the relay sends for its clients, on 200, 304 and 429 alike`

## 3. 상한

아래 표의 각 행은 규범 요건이다. "강제 주체"는 값이 상한을 넘을 때 "초과 시" 동작을 MUST 수행한다. byte는 UTF-8
byte다. 근거는 표 다음 목록에 있다.

| ID | 이름 | 값 | 적용 대상 | 강제 주체 | 초과 시 |
|---|---|---|---|---|---|
| R-LIM-001 | `PEER_RELAY_MAX_MESSAGE_BYTES` (`MAX_WEBSOCKET_MESSAGE_BYTES`, provider `RELAY_MAX_MESSAGE_BYTES`) | 262144 (256 KiB) | relay WebSocket message 하나, 양방향, 단일 frame이든 fragment든 | relay codec, provider | 수신: 1009(단일 frame은 `FRAME_LIMIT`, 조립한 byte와 합쳐 넘는 continuation은 `MESSAGE_LIMIT`). relay 송신: `send`가 `too-large`(WS agent 답은 `RESULT_TOO_LARGE`). provider: 보내지 않음, 답은 `RESULT_TOO_LARGE` |
| R-LIM-002 | `MAX_WEBSOCKET_FRAME_BYTES` | 262144 | 수신 frame 하나의 길이 | relay codec | 1009 `FRAME_LIMIT`(상한을 넘을 수 있는 것은 64-bit length뿐이다) |
| R-LIM-003 | `MAX_WEBSOCKET_MESSAGE_FRAGMENTS` | 1024 frame | 수신 message 하나의 frame 수 | relay codec | 1025번째 frame header에서 1009 `FRAGMENT_LIMIT` |
| R-LIM-004 | `MAX_CONTROL_PAYLOAD_BYTES` | 125 | control frame payload | relay codec | 1002 `BAD_CONTROL_FRAME` |
| R-LIM-005 | `OUTBOUND_FRAGMENT_BYTES` | 131072 (128 KiB) | relay 송신 fragment 크기 | relay codec | 더 큰 message는 131072 단위로 나눈다(오류 아님) |
| R-LIM-006 | `MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES` | 1048576 | `writableLength` + 다음 frame wire byte | relay codec | message는 `busy`, pong은 버림, stall timer 시작 |
| R-LIM-007 | `WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS` | 30000 ms | frame 거절 뒤 write가 하나도 끝나지 않은 시간 | relay codec | close 1013 |
| R-LIM-008 | `WEBSOCKET_CLOSE_TIMEOUT_MS` | 5000 ms | relay close 뒤 peer가 연결을 끊지 않는 시간 | relay codec | socket 파기 |
| R-LIM-045 | `WEBSOCKET_PING_INTERVAL_MS` (relay option `webSocketPingIntervalMs`) | 30000 ms | 붙인 provider·client socket마다 relay가 보내는 RFC 6455 ping의 간격 | relay codec | 해당 없음(주기). 송신 상한에 들어가지 않는 ping은 버리고 stall timer를 시작 |
| R-LIM-046 | `WEBSOCKET_IDLE_TIMEOUT_MS` (relay option `webSocketIdleTimeoutMs`) | 75000 ms(ping 간격보다 길어야 한다) | socket에서 아무것도 읽지 못한 시간. 소유자가 읽기를 멈춘 동안은 다시 센다 | relay codec | close 1001, peer가 끊지 않으면 close timeout 뒤 파기(R-WS-039) |
| R-LIM-009 | `MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES`, `MAX_TIMER_DELAY_MS` | 262164, 2147483647 ms | `upgradeWebSocket` option과 relay의 liveness option. `idleTimeoutMs`는 `pingIntervalMs`보다 커야 한다 | codec API, relay 생성자 | `RangeError`(relay는 liveness option만 넘긴다, R-WS-025) |
| R-LIM-010 | `PEER_RELAY_MAX_REQUEST_BYTES` | 261120 (262144 − 1024) | agent JSON-RPC 요청, 각 transport가 나르는 것: WS는 받은 `mcp` envelope text와 `JSON.stringify(frame)` 둘 다, HTTP는 body와 `JSON.stringify(rpc)` 둘 다; `offer` frame | relay, agent client(보내기 전, 같은 기준) | `REQUEST_TOO_LARGE` −32600 `{limitBytes:261120}`(HTTP 413: 읽기 단계는 id null, 해석 뒤는 요청 id). WS notification은 버림. offer는 `offer.refused`. client는 `PeerMcpError` |
| R-LIM-011 | MCP POST drain 상한 | 4177920 (16 × 261120) | `POST /p/:id/mcp` body | relay | request 파기, 응답 없음 |
| R-LIM-012 | `PEER_RELAY_MAX_REQUEST_ID_BYTES` (`MAX_RPC_ID_BYTES`) | 1024 | 문자열 JSON-RPC id와 offer `requestId`(비어 있지 않은 문자열이어야 한다, R-SIG-017)의 JSON text(따옴표 포함). 숫자 id는 대상 아님 | relay, agent client(raw가 아닌 transport) | `REQUEST_ID_TOO_LARGE` −32600 `{limitBytes:1024}`, id null 또는 requestId 없음. HTTP 400 |
| R-LIM-013 | `PEER_RELAY_MAX_PENDING_REQUESTS` (`MAX_PENDING_REQUESTS_PER_SOCKET`) | 64 | agent WebSocket 하나: provider를 기다리는 요청 + outbox에서 기다리는 그 요청들의 JSON-RPC 답(답이 아닌 frame은 세지 않음, R-MCP-032). HTTP는 세지 않음 | relay, agent client(raw가 아닌 transport) | relay: `TOO_MANY_PENDING_REQUESTS` −32087 `{limit:64}`. client: FIFO 대기 |
| R-LIM-014 | `MAX_CLIENT_SOCKETS_PER_TICKET` | 4 | client ticket 하나의 WebSocket 수 | relay | 가장 오래된 socket을 4001 `SUPERSEDED`로 닫고 그 pending 요청을 답 없이 버림 |
| R-LIM-015 | invite 1회 사용 | room당 ticket 1개 | `POST /p/:id/join` | relay | 409 `INVITE_TOKEN_CONSUMED` |
| R-LIM-016 | `PEER_RELAY_MAX_CATALOG_BYTES` | 258048 (262144 − 4096) | provider `register` frame(`registerSeq` 포함) | provider | 보내지 않음. session error `CATALOG_TOO_LARGE` |
| R-LIM-017 | `PEER_RELAY_MAX_ANNOUNCEMENT_BYTES` | 260096 (262144 − 2048) | stamp한 catalog announcement(`registerSeq` 제외). 남은 2048 byte는 같은 catalog의 WebSocket `tools/list` 답에 붙는 envelope, 1024 byte 이하의 id, relay의 `result._meta` stamp(relay 자신의 listing이면 listing metadata 전체)와 deprecated 최상위 stamp를 담는다(최대 약 1.6 KiB). relay 자신의 WebSocket `initialize` 답도 catalog를 한 번만 담으므로(bootstrap catalog는 tool 없이 그것을 가리킨다, R-MCP-016) 이 안에 든다 | relay | register: error frame `CATALOG_TOO_LARGE`. listing 답: relay catalog로 답하거나 −32603 `CATALOG_TOO_LARGE`. relay 자신의 metadata 답이 relay option 때문에 넘치면 −32603 `RESULT_TOO_LARGE`(R-MCP-036) |
| R-LIM-018 | `PEER_CATALOG_MAX_TOOLS` | 128 tool | catalog | relay, agent client(같은 상수) | relay `CATALOG_INVALID`, client `INVALID_TOOLS_LIST` |
| R-LIM-019 | `PEER_CATALOG_MAX_TOOL_NAME_LENGTH` | 256 UTF-16 code unit | tool `name` | relay, agent client(같은 상수) | relay `CATALOG_INVALID`, client `TOOL_NAME_TOO_LONG` |
| R-LIM-020 | `REGISTER_EVALUATION_BURST`, `REGISTER_EVALUATION_INTERVAL_MS` | 8, 1000 ms | room당 register 평가, 결과와 무관(거절, unchanged, 받아들인 catalog) | relay | 다음 평가가 허용될 때까지 대기(거절 아님). 기다리는 frame은 다음 frame이 대체 |
| R-LIM-021 | `MAX_JSON_BODY_BYTES` | 65536 (drain 1048576) | JSON body route | relay | 413 `BODY_TOO_LARGE`, drain 상한 초과면 파기 |
| R-LIM-041 | node:http 기본값(relay는 바꾸지 않는다) | `maxHeaderSize` 16384 byte, `headersTimeout` 60000 ms, `requestTimeout` 300000 ms, `keepAliveTimeout` 5000 ms | 모든 HTTP 요청과 upgrade 요청의 header 크기, header 수신 시간, body를 포함한 요청 전체 수신 시간(R-HTTP-009의 느린 body 포함), keep-alive 연결의 idle 시간 | node:http | header 초과는 431(upgrade 요청도 같다), 수신 시간 초과는 아직 아무것도 쓰지 않았으면 408을 쓰고 연결 종료, idle 초과는 연결 종료. webmcp-peer/1의 일부가 아니며 배포가 Node 설정(`--max-http-header-size`, `server.headersTimeout` 등)으로 바꿀 수 있다 |
| R-LIM-022 | `MAX_CLIENT_LABEL_CODE_POINTS` | 256 code point | join `clientLabel` | relay | 잘라냄(거절 아님) |
| R-LIM-042 | `MAX_ROOM_ALIAS_CODE_POINTS` | 256 code point | `POST /p`·rotate의 `alias` | relay | trim한 뒤 잘라냄(거절 아님) |
| R-LIM-023 | `MAX_UNREQUESTED_QUEUE_BYTES` | 786412 (+ header 20) | broadcast 시점의 agent queue | relay | 그 agent에게만 건너뜀 |
| R-LIM-024 | `AGENT_OUTBOX_RETRY_MS` | 1000 ms | outbox 재시도 주기 | relay | 해당 없음(주기) |
| R-LIM-025 | `mcpRequestTimeoutMs` | 30000 ms(최소 1000) | 중계 요청, answer를 기다리는 offer(승인 요청의 수명과는 무관, R-LIM-043) | relay | `MCP_REQUEST_TIMEOUT` −32001(offer는 `offer.refused`, R-SIG-026) |
| R-LIM-044 | `MAX_PENDING_OFFERS_PER_SOCKET` | 1 | agent WebSocket 하나에서 provider의 answer를 기다리는 offer | relay | `offer.refused` `TOO_MANY_PENDING_REQUESTS` −32087 `{limit:1}`(requestId echo) |
| R-LIM-043 | `approvalTimeoutMs` (`DEFAULT_APPROVAL_TIMEOUT_MS`) | 300000 ms(최소 1000; `Infinity`는 room 수명, `NaN`은 기본값). room `expiresAt`이 상한 | 승인 요청 수명 | relay | ticket `expired`, agent·provider에 `approval.expired`(R-ROOM-026). invite가 소비된 채라 rotate해야 다시 join을 받는다 |
| R-LIM-026 | room TTL | 기본 7200000 ms, `[60000, maxRoomTtlMs]`. `maxRoomTtlMs` 기본 86400000, `[60000, 31536000000]` | `POST /p`, rotate의 `ttlMs` | relay | clamp |
| R-LIM-027 | reconnect lease (`RECONNECT_GRACE_MS`) | provider socket이 붙어 있는 동안 room `expiresAt`, 붙어 있지 않으면 `min(expiresAt, 생성·reclaim·provider socket 분리 시각 + 900000)`. descriptor는 `reconnectTokenExpiresAt = expiresAt`, `reconnectGraceMs = 900000` | reclaim | relay | 410 `ROOM_LEASE_EXPIRED`(room이 살아 있을 때, R-ROOM-014) |
| R-LIM-028 | `ROOM_METADATA_RETAIN_MS` | 원래 `expiresAt` + 86400000(`metadataRetainUntil`) | 만료·rotate된 room 보존 | relay | room 삭제(그 전에는 410 `ROOM_EXPIRED`·`ROOM_ROTATED`, 이후 404 `ROOM_NOT_FOUND`). 보존 중인 room도 `maxRooms`에 든다(R-LIM-047) |
| R-LIM-029 | rotated 보존 | R-LIM-028과 같은 기한(원래 `expiresAt` + 86400000). rotate 시각에 따른 보존 기한은 없다 | rotate된 room | relay | room 삭제(그 전에는 410 `ROOM_ROTATED`와 `replacementRoomId`, 이후 404) |
| R-LIM-030 | `roomSweepIntervalMs` | 30000 ms(최소 1000, 0이면 timer 없음), HTTP 요청마다 추가 | 만료 room | relay | sweep(R-ROOM-050) |
| R-LIM-031 | publish rate limit | window 60000 ms(설정 시 floor 후 최소 1000), max: 30(`DEFAULT_PUBLISH_RATE_LIMIT_MAX`, publish key와 무관), 설정 시 floor(0과 1 미만은 무제한) | `POST /p`와 room을 하나 더하는 rotate(R-ROOM-073), (요청 주소 `clientAddress`, 자격 등급)별(R-HTTP-021) | relay | 429 `PUBLISH_RATE_LIMITED`, store 실패 시 503 `PUBLISH_RATE_LIMIT_UNAVAILABLE` |
| R-LIM-047 | `maxRooms` (`DEFAULT_MAX_ROOMS`) | 10000 room(floor 후 최소 1, `Infinity`는 무제한, `NaN`은 기본값). 보존 중인 만료·rotate room 포함 | relay가 동시에 가진 room(`rooms.size`), `POST /p`와 rotate가 room 하나를 더할 때 | relay | 503 `ROOM_CAPACITY_EXCEEDED` `{retryAfterMs}`와 `Retry-After`. 아무것도 만들거나 바꾸지 않는다(R-ROOM-008, R-ROOM-042) |
| R-LIM-032 | `MAX_IN_MEMORY_BUCKETS` | 4096 key | in-memory rate-limit store | relay | 만료 window 정리 후 가장 오래된 window 축출 |
| R-LIM-033 | `PROVIDER_BUSY_RETRY_AFTER_SECONDS` | 1 s | HTTP 503 `PROVIDER_BUSY` | relay, agent client | relay: `Retry-After: 1`. client: `retryAfterMs`로 받아 그만큼은 기다린 뒤 다시 보냄(R-PEER-036) |
| R-LIM-034 | provider keepalive, ready 대기 | 25000 ms, 10000 ms | provider socket | provider | `{type:'ping'}` 송신; `Signaling connection timeout` |
| R-LIM-035 | provider 재접속 | `min(1000 × 1.5^(n−1), 15000)` ms; reclaim 최대 4회, 100·200·300 ms 대기 | provider | provider | 해당 없음(일정) |
| R-LIM-036 | provider ICE 대기 | 2000 ms | `answer` 전 | provider | 대기를 끝내고 answer 송신 |
| R-LIM-037 | `MAX_PAYLOAD_TEXT_BLOCK_BYTES` | 16384 | CallToolResult text block | provider | 짧은 안내 text로 대체 |
| R-LIM-038 | `MAX_TRACKED_RUNS` | 128 run | provider AI run | provider | `AI_RUN_LIMIT_EXCEEDED` |
| R-LIM-039 | client 시간 | 요청·ready 10000 ms(`DEFAULT_TIMEOUT_MS`), 재시도 100 → 2000 ms(`Retry-After`가 더 길면 그 값), 승인 poll 250 ms(최소 25)·30000 ms, probe 5000 ms(최소 250) | agent client | agent client | `REQUEST_TIMEOUT`, `TRANSPORT_TIMEOUT`, `APPROVAL_TIMEOUT`, probe 실패 |
| R-LIM-040 | DataChannel framing (`MAX_DATA_CHANNEL_CHUNKS`, `MAX_DATA_CHANNEL_CHUNK_CHARS`, `DATA_CHANNEL_SEND_CHUNK_CHARS`, `MAX_DATA_CHANNEL_FRAME_CHARS`) | 양방향 message당 ≤ 512 chunk, chunk당 ≤ 16384 UTF-16 code unit; provider 송신 chunk 2048 unit, 그래서 frame ≤ 1048576 unit; 미완성 frame ≤ 51 | provider DataChannel(relay 밖, 실험적) | provider | 수신: 범위를 벗어난 chunk 무시. 새 id의 chunk가 올 때 미완성 frame이 50개를 넘으면(51개) 미완성 전부 폐기. 송신: 답은 `RESULT_TOO_LARGE` `{limitCodeUnits:1048576}`(R-PEER-014), 그 밖의 frame은 보내지 않고 기록 |

### 3.1 상한별 근거

- **R-LIM-001** 근거: `src/config/limits.ts:17`, `src/server/ws-upgrade.ts:45`, `src/server/ws-upgrade.ts:557`, `src/server/ws-upgrade.ts:652`, `src/server/ws-upgrade.ts:659`, `src/provider/tool-call.ts:52`, `src/provider/peer-client.ts:175`; 테스트: `test/server-ws-frames.test.ts` › `uses one 256 KiB limit for single frames and assembled messages`; `test/client-request-limit.test.ts` › `is one 256 KiB limit exported from the config tier and the package root, equal to the relay's limits`
- **R-LIM-002** 근거: `src/server/ws-upgrade.ts:50`, `src/server/ws-upgrade.ts:652`; 테스트: `test/server-ws-frames.test.ts` › `refuses a single frame of limit + 1 bytes with 1009 from its header, without waiting for the payload`
- **R-LIM-003** 근거: `src/server/ws-upgrade.ts:60`, `src/server/ws-upgrade.ts:640`; 테스트: `test/server-ws-frames.test.ts` › `caps a message at 1024 frames, far more than the two the relay itself sends for the largest message`
- **R-LIM-004** 근거: `src/server/ws-upgrade.ts:173`, `src/server/ws-upgrade.ts:634`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1002 on a protocol violation: %s`
- **R-LIM-005** 근거: `src/server/ws-upgrade.ts:91`, `src/server/ws-upgrade.ts:562`, `src/server/ws-upgrade.ts:566`; 테스트: `test/server-ws-frames.test.ts` › `returns 'sent' for a 200 KiB message and sends it as 128 KiB fragments the client reassembles`; `test/relay-message-limit.test.ts` › `accepts an announcement of exactly PEER_RELAY_MAX_ANNOUNCEMENT_BYTES and sends it to agents in 128 KiB fragments`
- **R-LIM-006** 근거: `src/server/ws-upgrade.ts:119`, `src/server/ws-upgrade.ts:541`, `src/server/ws-upgrade.ts:732`; 테스트: `test/server-ws-frames.test.ts` › `bounds the queue at four messages of the full limit, and waits 30 seconds for a peer that stops reading a full one`
- **R-LIM-007** 근거: `src/server/ws-upgrade.ts:129`, `src/server/ws-upgrade.ts:543`; 테스트: `test/server-ws-frames.test.ts` › `keeps a peer open that drains its full queue within stalledOutboundTimeoutMs`
- **R-LIM-008** 근거: `src/server/ws-upgrade.ts:66`, `src/server/ws-upgrade.ts:606`; 테스트: `test/server-ws-frames.test.ts` › `keeps a closed socket for the longest valid close timeout, and destroys it after the shortest`
- **R-LIM-045** 근거: `src/server/ws-upgrade.ts:79`, `src/server/ws-upgrade.ts:710`, `src/server/ws-upgrade.ts:711`, `src/server/ws-upgrade.ts:830`, `src/server/peer-server.ts:901`; 테스트: `test/server-ws-frames.test.ts` › `pings every 30 seconds and gives up on a peer it hears nothing from for 75`; `test/server-ws-frames.test.ts` › `pings the peer every WEBSOCKET_PING_INTERVAL_MS with an empty ping`
- **R-LIM-046** 근거: `src/server/ws-upgrade.ts:88`, `src/server/ws-upgrade.ts:211`, `src/server/ws-upgrade.ts:720`, `src/server/ws-upgrade.ts:721`, `src/server/ws-upgrade.ts:725`, `src/server/ws-upgrade.ts:802`, `src/server/ws-upgrade.ts:832`, `src/server/peer-server.ts:901`, `src/server/peer-server.ts:902`; 테스트: `test/server-ws-frames.test.ts` › `closes a peer it hears nothing from for WEBSOCKET_IDLE_TIMEOUT_MS with 1001, and the close timeout destroys it`; `test/server-ws-frames.test.ts` › `does not close a socket its owner paused, whose pongs may be waiting unread, and starts the wait again`; `test/server-upgrade.test.ts` › `refuses %s when constructed`
- **R-LIM-009** 근거: `src/server/ws-upgrade.ts:135`, `src/server/ws-upgrade.ts:169`, `src/server/ws-upgrade.ts:182`, `src/server/ws-upgrade.ts:190`, `src/server/ws-upgrade.ts:201`, `src/server/ws-upgrade.ts:211`, `src/server/peer-server.ts:902`; 테스트: `test/server-ws-frames.test.ts` › `keeps a stalled socket open for the longest valid stalledOutboundTimeoutMs, and closes it after the shortest`; `test/server-ws-frames.test.ts` › `refuses an idle timeout %s with a RangeError before answering the upgrade`
- **R-LIM-010** 근거: `src/config/limits.ts:32`, `src/server/peer-server.ts:391`, `src/server/peer-server.ts:3242`, `src/server/peer-server.ts:3250`, `src/server/peer-server.ts:3276`, `src/server/peer-server.ts:3277`, `src/server/peer-server.ts:4017`, `src/server/peer-server.ts:1412`, `src/client/transport.ts:77`; 테스트: `test/relay-message-limit.test.ts` › `applies the request limit to a request as the relay re-serializes it, over HTTP and WebSocket`; `test/client-request-limit.test.ts` › `has a request limit 1 KiB under the message limit, exported from the config tier and the package root`
- **R-LIM-011** 근거: `src/server/http-body.ts:31`, `src/server/peer-server.ts:3247`; 테스트: `test/relay-message-limit.test.ts` › `drains an oversized body up to 16x the limit so its 413 arrives, and cuts off a larger one without hanging`
- **R-LIM-012** 근거: `src/config/limits.ts:65`, `src/server/peer-server.ts:116`, `src/server/peer-server.ts:397`, `src/client/transport.ts:93`; 테스트: `test/relay-message-limit.test.ts` › `refuses a request id over 1 KiB of JSON without echoing or forwarding it, over WebSocket and HTTP`; `test/client-pending-limit.test.ts` › `is refused before it is sent when its id is over 1 KiB of JSON, which the relay would answer with id null`
- **R-LIM-013** 근거: `src/config/limits.ts:79`, `src/server/peer-server.ts:123`, `src/server/peer-server.ts:678`, `src/server/peer-server.ts:1299`, `src/server/peer-server.ts:1300`, `src/server/peer-server.ts:4057`, `src/client/session.ts:1066`; 테스트: `test/relay-message-limit.test.ts` › `lets an agent socket have at most 64 requests waiting for the provider`; `test/client-pending-limit.test.ts` › `is the relay's limit of 64, exported from the config tier and the package root`; `test/server-mcp-routing.test.ts` › `handles nothing more of an agent behind on what it asked for, the rest of its read included, and counts its 64 requests once it reads`
- **R-LIM-014** 근거: `src/server/peer-server.ts:130`, `src/server/peer-server.ts:4119`, `src/server/peer-server.ts:4122`, `src/server/peer-server.ts:4124`; 테스트: `test/relay-message-limit.test.ts` › `holds at most 4 client sockets per ticket, closing the oldest for a new one`
- **R-LIM-015** 근거: `src/server/peer-server.ts:3433`, `src/server/peer-server.ts:3451`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`
- **R-LIM-016** 근거: `src/config/limits.ts:40`, `src/provider/peer-client.ts:415`; 테스트: `test/provider-register-limit.test.ts` › `is the message limit less 4 KiB, exported from the config tier and the package root`; `test/provider-register-limit.test.ts` › `sends a register frame of exactly the catalog limit and withholds one a byte larger`
- **R-LIM-017** 근거: `src/config/limits.ts:56`, `src/server/peer-server.ts:1620`, `src/server/peer-server.ts:1709`, `src/server/peer-server.ts:1759`, `src/server/peer-server.ts:1756`, `src/server/peer-server.ts:1787`, `src/server/peer-server.ts:2068`; 테스트: `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`; `test/relay-message-limit.test.ts` › `lets a WebSocket agent list every catalog the relay accepts, up to an announcement of PEER_RELAY_MAX_ANNOUNCEMENT_BYTES`; `test/relay-message-limit.test.ts` › `fits its own listing of the largest catalog it accepts, with the room's listing metadata, under the longest id`; `test/relay-message-limit.test.ts` › `fits its own WebSocket initialize of the largest catalog it accepts under the longest id, naming the bootstrap catalog without listing it twice`
- **R-LIM-018** 근거: `src/config/catalog.ts:12`, `src/server/deployment-catalog.ts:69`, `src/client/catalog-hash.ts:87`; 테스트: `test/catalog-contract.test.ts` › `rejects catalogs clients would reject and keeps every tier on the last valid catalog`; `test/catalog-contract.test.ts` › `refuses exactly the catalogs the client refuses, and neither side trims a tool name`
- **R-LIM-019** 근거: `src/config/catalog.ts:15`, `src/config/catalog.ts:32`, `src/server/deployment-catalog.ts:75`, `src/client/catalog-hash.ts:108`; 테스트: `test/catalog-contract.test.ts` › `rejects catalogs clients would reject and keeps every tier on the last valid catalog`; `test/catalog-contract.test.ts` › `refuses exactly the catalogs the client refuses, and neither side trims a tool name`
- **R-LIM-020** 근거: `src/server/peer-server.ts:140`, `src/server/peer-server.ts:142`, `src/server/peer-server.ts:1675`, `src/server/peer-server.ts:1685`, `src/server/peer-server.ts:1692`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates at most ${BURST} at once and then one a second, always the latest, and still takes a changed catalog`; `test/server-register-evaluation.test.ts` › `evaluates and announces catalogs that change it at most ${BURST} at once and then one a second, the latest last`
- **R-LIM-021** 근거: `src/server/peer-server.ts:106`, `src/server/peer-server.ts:2382`, `src/server/http-body.ts:31`; 테스트: `test/relay-message-limit.test.ts` › `delivers 413 BODY_TOO_LARGE for join bodies over 64 KiB and leaves the connection usable`
- **R-LIM-041** 근거: `src/server/peer-server.ts:917`, `src/server/peer-server.ts:792`; 테스트: `test/server-http-security.test.ts` › `leaves node:http's 16 KiB header limit in place, for an upgrade as for a request`
- **R-LIM-022** 근거: `src/server/peer-server.ts:195`, `src/server/peer-server.ts:586`, `src/server/peer-server.ts:3457`; 테스트: `test/relay-message-limit.test.ts` › `trims a join's clientLabel and keeps at most its first 256 code points`
- **R-LIM-042** 근거: `src/server/peer-server.ts:201`, `src/server/peer-server.ts:586`, `src/server/peer-server.ts:3054`, `src/server/peer-server.ts:3717`; 테스트: `test/relay-message-limit.test.ts` › `trims a room's alias and keeps at most its first 256 code points, on creation and on rotation`
- **R-LIM-023** 근거: `src/server/peer-server.ts:610`, `src/server/peer-server.ts:618`, `src/server/peer-server.ts:712`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`
- **R-LIM-024** 근거: `src/server/peer-server.ts:628`, `src/server/peer-server.ts:742`; 테스트: `test/relay-backpressure.test.ts` › `offers the oldest waiting reply again while the agent reads nothing, so the codec's stall close stays armed`
- **R-LIM-025** 근거: `src/server/peer-server.ts:887`, `src/server/peer-server.ts:3395`, `src/server/peer-server.ts:4067`, `src/server/peer-server.ts:1423`, `src/server/peer-server.ts:1426`; 테스트: `test/server-approval-lease.test.ts` › `is approvalTimeoutMs %s, not the MCP request timeout`; `test/server-mcp-routing.test.ts` › `answers a request the provider does not answer within mcpRequestTimeoutMs, at least 1000 ms, and drops the late answer`
- **R-LIM-043** 근거: `src/server/peer-server.ts:101`, `src/server/peer-server.ts:102`, `src/server/peer-server.ts:889`, `src/server/peer-server.ts:890`, `src/server/peer-server.ts:892`, `src/server/peer-server.ts:2508`; 테스트: `test/server-approval-lease.test.ts` › `is approvalTimeoutMs %s, not the MCP request timeout`; `test/server-approval-lease.test.ts` › `never outlives the room, which an infinite approvalTimeoutMs waits for`; `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`
- **R-LIM-026** 근거: `src/server/peer-server.ts:80`, `src/server/peer-server.ts:81`, `src/server/peer-server.ts:83`, `src/server/peer-server.ts:893`, `src/server/peer-server.ts:1043`, `src/server/peer-server.ts:3056`, `src/server/peer-server.ts:3718`; 테스트: `test/server-room-lifecycle.test.ts` › `clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable`; `test/server-room-lifecycle.test.ts` › `honours a configured maxRoomTtlMs and advertises it in /config`
- **R-LIM-027** 근거: `src/server/peer-server.ts:99`, `src/server/peer-server.ts:1022`, `src/server/peer-server.ts:1159`, `src/server/peer-server.ts:1160`, `src/server/peer-server.ts:1520`, `src/server/peer-server.ts:3085`, `src/server/peer-server.ts:3086`, `src/server/peer-server.ts:3120`, `src/server/peer-server.ts:3929`, `src/server/peer-server.ts:3955`; 테스트: `test/server-room-lifecycle.test.ts` › `refuses a reclaim of a live room whose lease expired with 410 ROOM_LEASE_EXPIRED, not the room's ROOM_EXPIRED`; `test/server-approval-lease.test.ts` › `does not expire while a provider socket is attached, and lasts 15 minutes after the socket goes away`; `test/server-approval-lease.test.ts` › `expires 15 minutes after the provider socket went away, however long it was attached`
- **R-LIM-028** 근거: `src/server/peer-server.ts:84`, `src/server/peer-server.ts:1023`, `src/server/peer-server.ts:2949`, `src/server/types.ts:118`; 테스트: `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`
- **R-LIM-029** 근거: `src/server/peer-server.ts:3727`, `src/server/peer-server.ts:2949`; 테스트: `test/server-room-lifecycle.test.ts` › `retains a rotated room, answering 410 ROOM_ROTATED with its replacement, until a day after its original expiry`
- **R-LIM-030** 근거: `src/server/peer-server.ts:910`, `src/server/peer-server.ts:2962`; 테스트: `test/server-room-lifecycle.test.ts` › `arms one timer of max(1000, roomSweepIntervalMs ?? 30000) ms, and none for 0 or NaN`; `test/server-room-lifecycle.test.ts` › `expires a room from its timer without any request, and at the start of an HTTP request without a timer`
- **R-LIM-031** 근거: `src/server/server-config.ts:92`, `src/server/server-config.ts:93`, `src/server/server-config.ts:508`, `src/server/server-config.ts:513`, `src/server/server-config.ts:514`, `src/server/server-config.ts:515`, `src/server/peer-server.ts:2280`, `src/server/peer-server.ts:2320`, `src/server/peer-server.ts:2299`, `src/server/peer-server.ts:3697`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`; `test/server-http-security.test.ts` › `throttles room creation without a publish key, 30 rooms a minute from one address by default`; `test/server-publish-rate-limit.test.ts` › `floors a configured publishRateLimitMax, so one under 1 turns the limit off, and names the quota only on 201, 429 and 503`; `test/server-publish-rate-limit.test.ts` › `spends a unit of the publisher's bucket on every rotation, as on a creation, %s`
- **R-LIM-047** 근거: `src/server/peer-server.ts:91`, `src/server/peer-server.ts:899`, `src/server/peer-server.ts:1130`, `src/server/peer-server.ts:1131`, `src/server/peer-server.ts:1133`, `src/server/peer-server.ts:1134`, `src/server/peer-server.ts:1139`, `src/server/peer-server.ts:3063`, `src/server/peer-server.ts:3711`, `src/server/types.ts:197`; 테스트: `test/server-http-security.test.ts` › `holds at most maxRooms rooms, retained ones included, refusing creation and rotation with 503 ROOM_CAPACITY_EXCEEDED`
- **R-LIM-032** 근거: `src/server/rate-limit.ts:94`, `src/server/rate-limit.ts:109`; 테스트: `test/server-publish-rate-limit.test.ts` › `bounds the in-memory store and evicts the oldest windows first`
- **R-LIM-033** 근거: `src/server/peer-server.ts:189`, `src/server/peer-server.ts:1562`, `src/client/transport.ts:258`, `src/client/session.ts:1270`; 테스트: `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`; `test/client-busy-retry.test.ts` › `waits at least as long as Retry-After asks before sending the request again`
- **R-LIM-034** 근거: `src/provider/peer-client.ts:998`, `src/provider/peer-client.ts:1311`; 테스트: `test/provider-reconnect.test.ts` › `sends a keepalive ping every 25 s while it is attached`; `test/provider-reconnect.test.ts` › `gives up on a provider socket that sends no ready within 10 s`
- **R-LIM-035** 근거: `src/provider/peer-client.ts:764`, `src/provider/peer-client.ts:936`, `src/provider/peer-client.ts:954`; 테스트: `test/provider-reconnect.test.ts` › `keeps retrying with growing delays while the relay is down, then reclaims the room`
- **R-LIM-036** 근거: `src/provider/peer-client.ts:1163`; 테스트: `test/provider-data-channel.test.ts` › `waits at most 2000 ms for ICE gathering before it answers`
- **R-LIM-037** 근거: `src/provider/tool-call.ts:60`, `src/provider/tool-call.ts:159`; 테스트: `test/provider-tool-call.test.ts` › `repeats a payload up to the text budget and points at structuredContent past it`
- **R-LIM-038** 근거: `src/provider/ai-run-controller.ts:72`, `src/provider/peer-client.ts:1791`; 테스트: `test/provider-tool-call.test.ts` › `answers a call immediately when every tracked run has work in flight, then evicts idle runs`
- **R-LIM-039** 근거: `src/client/types.ts:2`, `src/client/session.ts:267`, `src/client/session.ts:269`, `src/client/room-lifecycle.ts:217`, `src/config/probe.ts:80`, `src/config/probe.ts:178`; 테스트: `test/client-busy-retry.test.ts` › `doubles its backoff up to 2 s and no further`
- **R-LIM-040** 근거: `src/provider/wire-schemas.ts:31`, `src/provider/wire-schemas.ts:33`, `src/provider/wire-schemas.ts:39`, `src/provider/wire-schemas.ts:45`, `src/provider/wire-schemas.ts:64`, `src/provider/wire-schemas.ts:70`, `src/provider/peer-client.ts:1478`, `src/provider/peer-client.ts:1918`, `src/provider/peer-client.ts:1925`, `src/provider/tool-call.ts:297`; 테스트: `test/provider-data-channel.test.ts` › `sends a frame in at most ${MAX_CHUNKS} chunks of at most ${CHUNK_CHARS} code units, up to ${FRAME_LIMIT} code units`; `test/provider-data-channel.test.ts` › `answers a tools/call whose result the framing cannot carry with an isError RESULT_TOO_LARGE result`; `test/provider-data-channel.test.ts` › `does not send a frame other than a reply that the framing cannot carry`
- **R-LIM-044** 근거: `src/server/peer-server.ts:225`, `src/server/peer-server.ts:227`, `src/server/peer-server.ts:1402`, `src/server/peer-server.ts:1403`; 테스트: `test/server-signaling-frames.test.ts` › `lets an agent socket have one offer waiting for its answer, until the provider answers it or the request timeout passes`

## 4. room·session 수명주기

### 4.1 공통 규칙

**R-ROOM-001** relay는 식별자와 토큰을 1.4의 형식으로 MUST 만든다. roomId는 `randomBytes(16)` hex,
providerToken·inviteToken·reconnectToken·clientToken은 `randomBytes(24)` hex, sessionId는
`peer-session-` + `randomBytes(16)` hex, 승인 requestId는 `approval-` + `randomBytes(16)` hex다.\
근거: `src/server/peer-server.ts:999`, `src/server/peer-server.ts:1000`, `src/server/peer-server.ts:1002`, `src/server/peer-server.ts:2497`, `src/server/peer-server.ts:3452`, `src/server/peer-server.ts:3453`; 테스트: `test/server-room-lifecycle.test.ts` › `issues room ids, tokens, session ids and approval request ids of the protocol's formats, fresh each time`

**R-ROOM-002** room의 `expiresAt`은 `now + min(maxRoomTtlMs, max(60000, ttlMs))`로 MUST 정한다. `POST /p`와 rotate는
body의 `ttlMs`가 없거나 수가 아니거나 유한하지 않으면(JSON 넘침 `1e400`이 만드는 Infinity 포함) 7200000으로 바꾼 뒤 이
clamp를 적용한다(R-ROOM-012, R-ROOM-043). 그러므로 `{"ttlMs":1e400}`은 2시간 room이다. `clampRoomTtl` 자체는 유한하지 않은
값을 60000으로 보지만 wire 입력은 거기에 닿지 않는다. `maxRoomTtlMs`는 option으로만 정하며(CLI·env·설정 파일 없음) 기본
86400000이고 `[60000, 31536000000]`으로 clamp하며, 유한하지 않으면 기본값이다. 이 clamp는 `POST /p`, rotate, `/config`의
`defaults.roomTtlMs`에 쓴다.\
근거: `src/server/peer-server.ts:80`, `src/server/peer-server.ts:893`, `src/server/peer-server.ts:1004`, `src/server/peer-server.ts:1043`, `src/server/peer-server.ts:1044`, `src/server/peer-server.ts:3056`, `src/server/peer-server.ts:3718`; 테스트: `test/server-room-lifecycle.test.ts` › `clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable`

**R-ROOM-003** `roomState`는 다음처럼 MUST 바뀐다. 생성 시 `provisioned`. provider 부착 시 ticket이 없으면
`provider-connected`, 있으면 `accepting-clients`. join은 `provisioned`·`provider-connected`를 `accepting-clients`로
바꾸고 그 밖은 둔다. 승인과 승인 replay는 `active`. reclaim은 ticket이 있으면 `accepting-clients`, 없으면
`provisioned`. rotate는 `rotating`을 거쳐 같은 동기 구간에서 `rotated`. room 만료 처리(R-ROOM-050. sweep이 하든
R-ROOM-067의 다른 자리가 먼저 하든)는 `expired`(rotated는 유지). provider 연결 해제는 상태를 바꾸지 않는다. descriptor와
MCP `_meta`가 보고하는 `mcpRoomState`는 room이 없으면 `unknown`, `rotatedTo`가 있으면 `rotated`, `expiresAt <= now`이거나
상태가 `expired`면 `expired`, 아니면 `roomState`다. `POST /p`, reclaim, rotate 응답의 `state`는 `roomState` 그대로다.
`rotating`은 rotate의 한 동기 구간 안에서만 있는 내부 상태이고 relay는 이 값을 어떤 응답이나 frame에도 MUST NOT 싣는다.\
근거: `src/server/types.ts:77`, `src/server/peer-server.ts:1008`, `src/server/peer-server.ts:1932`, `src/server/peer-server.ts:2417`, `src/server/peer-server.ts:2702`, `src/server/peer-server.ts:2793`, `src/server/peer-server.ts:2918`, `src/server/peer-server.ts:3122`, `src/server/peer-server.ts:3470`, `src/server/peer-server.ts:3720`, `src/server/peer-server.ts:3728`, `src/server/peer-server.ts:3956`; 테스트: `test/server-provider-reattach.test.ts` › `restores an approved ticket to the new socket with an approval.restored frame`

**R-ROOM-004** 비밀 값은 `POST /p`, reclaim, rotate 응답(providerToken, inviteToken, reconnectToken)과 join 응답
(clientToken)에만 MUST 실린다. upgrade의 101 응답과 거절 응답은 요청이 subprotocol로 낸 `ticket.<token>`을 되돌리지 않는다(R-WS-010,
R-WS-038). `GET /config`, `GET /p/:id/mcp`, `GET /p/:id/mcp/tools`, `GET /mcp/catalog`, session status 응답에도 비밀 값이 없다.\
근거: `src/server/peer-server.ts:1150`, `src/server/peer-server.ts:3006`, `src/server/peer-server.ts:3180`, `src/server/peer-server.ts:3475`, `src/server/peer-server.ts:3591`, `src/server/ws-upgrade.ts:485`; 테스트: `test/server-ws-frames.test.ts` › `selects webmcp-peer.v1 and nothing else from a request offering %s`; `test/server-upgrade.test.ts` › `answers %s with an HTTP response before looking at the path, the room or the ticket`

**R-ROOM-005** room 하나는 room epoch마다 client ticket을 최대 1개 MUST 발급한다. invite는 처음 성공한 join에서 소비되고, 새
invite는 rotate로만 생기며(R-ROOM-021, R-ROOM-043) rotate는 새 room id와 epoch를 만든다. 이것은 provider가 기댈 수 있는 protocol
불변식이다. provider는 room 단위 승인 상태 하나만 두고(R-PEER-017), relay가 전달한 요청의 `sessionId`(R-SIG-005)가 그 승인 session이
아니면 승인되지 않은 요청으로 답한다(R-PEER-012). 한 room에 여러 agent를 받는 것은 이 버전의 protocol에 없다. 그러려면 invite를 여러 번
발급하고 provider가 session별 승인을 추적해야 하므로 별도 버전에서 다룬다.\
근거: `src/server/peer-server.ts:3437`, `src/server/peer-server.ts:3451`, `src/server/peer-server.ts:2689`, `src/provider/peer-client.ts:1655`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`; `test/provider-approval-state.test.ts` › `is answered CLIENT_APPROVAL_REQUIRED and not run, as one without the relay's session stamp is`

**R-ROOM-071** room을 바꾸는 수명주기 route — reclaim, approval, 두 revoke route, rotate — 의 body `roomId`와 `roomEpoch`는 모두
선택이며, 있으면 각각 경로 roomId·room의 현재 epoch와 엄격히(`===`) 같아야 한다(`bodyNamesRoom`). 한 room id의 epoch는 바뀌지
않으므로(rotate는 새 id를 만든다) 이 검사는 stale 요청을 막는 보안 장치가 아니라 caller의 일관성 확인이다. relay는 이 검사를 그 route의
자격 검사 — reclaim의 lease, approval·rotate의 provider token, revoke의 provider·client token과 `SESSION_NOT_OWNED` — 뒤에 MUST 하고,
불일치는 409와 route마다의 이름으로 답한다: reclaim `ROOM_LEASE_BINDING_INVALID`(−32002, `{roomId, roomEpoch}`), approval
`INVALID_APPROVAL`(−32081), 두 revoke route `SESSION_BINDING_INVALID`(−32002), rotate `ROOM_BINDING_INVALID`(−32002, `{roomId, roomEpoch}`).
그래서 자격이 없거나 틀린 요청은 binding이 맞든 틀리든 같은 401·403을 받는다. join은 binding을 보지 않는다(room을 가리키는 자격은
invite다). provider socket의 `approval.decision`은 route가 아니며 `payload.roomId`와 epoch를 요구한다(R-SIG-009).\
근거: `src/server/peer-server.ts:1539`, `src/server/peer-server.ts:1540`, `src/server/peer-server.ts:3107`, `src/server/peer-server.ts:3108`, `src/server/peer-server.ts:3516`, `src/server/peer-server.ts:3518`, `src/server/peer-server.ts:3627`, `src/server/peer-server.ts:3628`, `src/server/peer-server.ts:3668`, `src/server/peer-server.ts:3669`, `src/server/peer-server.ts:3705`, `src/server/peer-server.ts:3706`; 테스트: `test/server-approval-lease.test.ts` › `is optional on approval and both revoke routes`; `test/server-approval-lease.test.ts` › `must name the room and its epoch when present, on every route under its own name`; `test/server-approval-lease.test.ts` › `is checked after the request's credential`; `test/server-error-model.test.ts` › `refuses a rotate whose body names another room or epoch with ROOM_BINDING_INVALID`

**R-ROOM-072** relay HTTP 응답의 시각 필드는 아래 형식을 MUST 따른다. 기존 필드의 형식은 바꾸지 않는다(바꾸면 그 값을 parse하는
peer가 깨진다). 새로 만드는 시각 필드는 epoch ms로만 만들고, 같은 이름이 응답마다 다른 시각을 가리키는 `expiresAt`은 새 필드로 뜻을
나눈다: 승인 요청 만료는 `approvalExpiresAt`, ticket 만료는 `ticketExpiresAt`이다(frame은 R-SIG-025). 기간은 ms 수(`reconnectGraceMs`,
`/config`의 `defaults`)이고 `/status`의 `uptimeSec`만 초다.

| 응답 | epoch ms | ISO |
|---|---|---|
| room descriptor(`POST /p`, reclaim, rotate) | `expiresAt`, `reconnectTokenExpiresAt` | `createdAt`, `updatedAt`, reclaim의 `reclaimedAt`, rotate의 `rotatedAt` |
| join | `issuedAt`, `expiresAt` | — |
| approval | `approvalExpiresAt`, `ticketExpiresAt` | `decidedAt`, `expiresAt`(승인 요청 만료) |
| session status | — | `issuedAt`, `expiresAt`, `approvedAt`, `revokedAt` |
| 단일 revoke | — | `revokedAt` |
| `GET /p/:id/mcp` | `expiresAt`(room이 없으면 null), `catalogUpdatedAt`(catalog가 없으면 null) | — |
| `GET /p/:id/mcp/tools`, `GET /mcp/catalog` | `updatedAt`(catalog가 없으면 null) | — |

근거: `src/server/peer-server.ts:1159`, `src/server/peer-server.ts:1162`, `src/server/peer-server.ts:1164`, `src/server/peer-server.ts:1165`, `src/server/peer-server.ts:3126`, `src/server/peer-server.ts:3536`, `src/server/peer-server.ts:3537`, `src/server/peer-server.ts:3538`, `src/server/peer-server.ts:2831`; 테스트: `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`; `test/server-approval-lease.test.ts` › `reports the room's expiry and a 15-minute grace in the room descriptor`

### 4.2 `/status`, `/health`, `/ping`

**R-ROOM-006** relay는 세 경로 모두 `OPTIONS`를 뺀 모든 HTTP method에 200 `{status:'healthy', activeRooms, retainedRooms, uptimeSec}`로
MUST 답한다. `OPTIONS`는 어느 경로에서든 이 route보다 먼저 CORS preflight의 204(허용되지 않은 Origin이면 403 `ORIGIN_NOT_ALLOWED`)를
받는다(R-HTTP-010, R-HTTP-001의 1단계). `activeRooms`는 살아 있는 room(rotate되지 않았고 `expiresAt > now`, `isLiveRoom`) 수, `retainedRooms`는 relay가 아직
보존하는 만료·rotate room 수(`rooms.size - activeRooms`)이고, 둘의 합이 `maxRooms`에 드는 room 수다(R-LIM-047). 요청마다 sweep이 먼저
돌므로(R-HTTP-001) 만료됐지만 처리되지 않은 room은 없다. `uptimeSec`는 `process.uptime()`이다. Host·Origin 검사 뒤, `customHttpHandler`
앞에서 처리하므로 hook이 덮어쓸 수 없다.\
근거: `src/server/peer-server.ts:2966`, `src/server/peer-server.ts:2990`, `src/server/peer-server.ts:2993`, `src/server/peer-server.ts:2996`, `src/server/peer-server.ts:2997`, `src/server/peer-server.ts:2998`, `src/server/peer-server.ts:1121`; 테스트: `test/relay-message-limit.test.ts` › `survives a client that resets its connection while a customUpgradeHandler is awaiting`; `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/server-http-security.test.ts` › `reports the live rooms as activeRooms and the expired or rotated ones it retains as retainedRooms`; `test/server-http-security.test.ts` › `answers /status, /health and /ping for every method but OPTIONS, which is the preflight on every path`

### 4.3 `GET /config`

**R-ROOM-007** `GET /config`(GET만)는 200과 `{type:'framebook.peer.config', version:1, serverUrl,
protocol:'webmcp-peer/1', mcpEndpointTemplate:'<serverUrl>/p/{roomId}/mcp',
clientEndpointTemplate:'<serverUrl의 앞 http를 ws로>/p/{roomId}/client', roomEndpoint:'<serverUrl>/p',
defaults:{approvalRequired:true, roomTtlMs: clamp(7200000), maxRoomTtlMs}}`를 MUST 돌려준다(`type`과 `protocol`은
`WEBMCP_PEER_CONFIG_TYPE`, `WEBMCP_PROTOCOL`). `serverUrl`은 `requestOrigin`(R-HTTP-013)이다. `defaults`의 세 member는 config
tier의 `PeerServerPublicConfig.defaults`가 선언하고 `fetchPeerServerConfig`가 type을 검사한다(R-PEER-051). `defaults.roomTtlMs`는
이미 clamp한 값이다. GET이 아닌 `/config`는 hook을 거쳐 405 `METHOD_NOT_ALLOWED`와 `Allow: GET`이다(R-HTTP-022).\
근거: `src/server/peer-server.ts:3004`, `src/server/peer-server.ts:3007`, `src/server/peer-server.ts:3010`, `src/server/peer-server.ts:3012`, `src/server/peer-server.ts:3014`, `src/config/types.ts:90`, `src/config/types.ts:95`; 테스트: `test/server-room-lifecycle.test.ts` › `honours a configured maxRoomTtlMs and advertises it in /config`; `test/client-config.test.ts` › `rejects a config document whose defaults.maxRoomTtlMs is not a finite number`

### 4.4 `POST /p` (room 생성)

**R-ROOM-008** `POST /p`는 다음 순서로 MUST 검사한다. 그러므로 실패한 인증도 rate-limit 할당량을 쓰고, bucket이 다
차면 401 대신 429를 받는다.

1. publish rate-limit 단위 하나를 소비한다(store 불가 503, 초과 429; R-ROOM-010).
2. publish key 결과를 적용한다(401; R-ROOM-009).
3. body를 읽는다(413, 400, 500; R-HTTP-008).
4. owner binding(403; R-ROOM-011).
5. capabilities(400; R-ROOM-012).
6. room 수 상한(503 `ROOM_CAPACITY_EXCEEDED`; R-LIM-047). body가 다 온 뒤, room을 만드는 같은 동기 구간에서 보므로 동시에 온 생성
   요청들이 함께 통과하지 않는다.
7. room을 만들고 201로 답한다(R-ROOM-013).

근거: `src/server/peer-server.ts:3026`, `src/server/peer-server.ts:3027`, `src/server/peer-server.ts:3032`, `src/server/peer-server.ts:3036`, `src/server/peer-server.ts:3046`, `src/server/peer-server.ts:3058`, `src/server/peer-server.ts:3063`, `src/server/peer-server.ts:3068`, `src/server/peer-server.ts:3070`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`; `test/server-http-security.test.ts` › `holds at most maxRooms rooms, retained ones included, refusing creation and rotation with 503 ROOM_CAPACITY_EXCEEDED`

**R-ROOM-009** publish key가 설정돼 있으면 relay는 token을 MUST 다음처럼 읽는다. 요청에 Bearer 자격(R-HTTP-018)이 있으면
그 token이고, 이때 `X-Publish-Key`는 읽지 않는다. 그래서 Bearer 값이 틀려도 `X-Publish-Key`로 넘어가지 않는다. Bearer 자격이
없으면(`Authorization` 없음, `Basic …`, token 없는 `Bearer` 등) trim한 `X-Publish-Key`다. 그러므로 `Authorization: Basic …`과
유효한 `X-Publish-Key`를 함께 보내면 받아들인다. `X-Publish-Key`를 읽는 곳은 `POST /p`뿐이다. token의 SHA-256 hex를 설정 key의
SHA-256 hex와 상수 시간으로 비교한다. 빈 token은 401 `{error:'PUBLISH_KEY_REQUIRED'}`와 `WWW-Authenticate: Bearer`, 다른
token은 401 `{error:'PUBLISH_KEY_INVALID'}`와 `WWW-Authenticate: Bearer error="invalid_token"`이다(R-HTTP-019). publish key가 없으면
모든 `POST /p`를 허용한다.\
근거: `src/server/peer-server.ts:886`, `src/server/peer-server.ts:2253`, `src/server/peer-server.ts:2254`, `src/server/peer-server.ts:2255`, `src/server/peer-server.ts:2256`, `src/server/peer-server.ts:2257`, `src/server/peer-server.ts:2267`, `src/server/peer-server.ts:2272`, `src/server/peer-server.ts:2274`, `src/server/peer-server.ts:3033`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`; `test/server-room-lifecycle.test.ts` › `reads X-Publish-Key for the publish key only`; `test/server-error-model.test.ts` › `tells a missing Authorization credential from a wrong one, with a Bearer challenge`

**R-ROOM-010** publish rate limit은 다음을 MUST 따른다.

- bucket key는 `<clientAddress>\u0000<tokenHash>`다. `clientAddress`는 요청의 주소로, 신뢰한 proxy를 거친 요청이면
  `X-Forwarded-For`에서 신뢰 경계 밖의 첫 주소, 아니면 socket의 remote address(없으면 `unknown`)다(R-HTTP-021). 신뢰하지 않는 peer의
  `X-Forwarded-For`는 bucket을 바꾸지 않는다. `tokenHash`는 유효한 publish key의 SHA-256 hex, key가 설정되지 않았으면
  `anonymous`, 실패한 시도(없거나 틀린 key)는 모두 `unauthenticated`다. room을 하나 더하는 rotate도 단위 하나를 쓰며(R-ROOM-073), 그
  bucket은 rotate를 요청한 주소와 유효한 publisher의 `tokenHash`(설정한 publish key의 hash, key가 없으면 `anonymous`)다. 그래서 생성과
  rotate는 한 주소에서 같은 할당량을 함께 쓴다.
- `publishRateLimitMax`가 0이면 store를 부르지 않고 모두 허용하며 201에 `X-RateLimit-*`를 붙이지 않는다(설정한 max는
  floor한다, R-ROOM-069). 설정하지 않은 max는 publish key가 있든 없든 30(`DEFAULT_PUBLISH_RATE_LIMIT_MAX`)이다. room 하나는 지워질
  때까지 relay 메모리를 쓰므로 익명 생성도 기본으로 제한하며, 끄려면 0을 MUST 명시한다.
  window 기본값은 60000 ms(`DEFAULT_PUBLISH_RATE_LIMIT_WINDOW_MS`)이고 설정값은 `max(1000, floor(value))`다.
- 고정 window: key마다 첫 요청에 window를 고정한다. `nowMs − windowStartedAt >= windowMs`면 새 window(count 1, 허용,
  `retryAfterMs = windowMs`, `remaining = max − 1`). 아니면 count를 늘리고(거절된 요청도 센다) `count <= max`일 때 허용,
  `retryAfterMs = max(1, windowMs − 경과)`, `remaining = max(0, max − count)`. window 경계에서 최대 약 2 × max가 통과할 수 있다.
- 거절은 429 `{error:'PUBLISH_RATE_LIMITED', code:-32088, retryAfterMs}`와 `Retry-After: max(1, ceil(retryAfterMs/1000))`,
  `X-RateLimit-Limit: <max>`, `X-RateLimit-Remaining: 0`이다.
- store가 던지거나 형식이 틀린 결정(`allowed`가 boolean이 아님, `retryAfterMs`가 유한하지 않거나 음수, `remaining`이
  음수이거나 +Infinity가 아닌 비유한값)을 돌려주면 닫힌 쪽으로 실패한다: 503 `{error:'PUBLISH_RATE_LIMIT_UNAVAILABLE',
  code:-32089, retryAfterMs:1000}`, `Retry-After: 1`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`. 유효한 결정의
  `retryAfterMs`는 올림, `remaining`은 내림한다(Infinity는 유지).
- 성공한 201(`POST /p`, rotate)은 max > 0일 때 `X-RateLimit-Limit: <max>`, `X-RateLimit-Remaining: <remaining>`을 가진다.
- store는 option의 `publishRateLimitStore`, 아니면 설정의 `publishRateLimitSqlitePath`에 relay가 여는 SQLite store, 아니면
  `publishRateLimitPath`의 File store, 아니면 in-memory store다(4096 key 상한, R-LIM-032). `resolvePeerServerConfig`는
  `publishRateLimitSqlitePath`를 CLI `--publish-rate-limit-sqlite-path`, option, 설정 파일 `publishRateLimitSqlitePath`, env
  `FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH`, `WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH` 순으로 읽고 `cwd` 기준으로 resolve한다. 비었거나
  NUL이 있으면 `PUBLISH_RATE_LIMIT_SQLITE_PATH_INVALID`로 던진다. relay가 연 SQLite store는 relay의 `close()`가 닫는다.

근거: `src/server/peer-server.ts:2279`, `src/server/peer-server.ts:2280`, `src/server/peer-server.ts:1068`, `src/server/peer-server.ts:2316`, `src/server/peer-server.ts:2320`, `src/server/peer-server.ts:2332`, `src/server/peer-server.ts:3028`, `src/server/peer-server.ts:2299`, `src/server/peer-server.ts:2310`, `src/server/peer-server.ts:876`, `src/server/peer-server.ts:878`, `src/server/peer-server.ts:879`, `src/server/peer-server.ts:882`, `src/server/peer-server.ts:974`, `src/server/rate-limit.ts:75`, `src/server/rate-limit.ts:101`, `src/server/rate-limit.ts:121`, `src/server/rate-limit.ts:298`, `src/server/server-config.ts:525`, `src/server/server-config.ts:531`, `src/server/server-config.ts:576`, `src/server/server-config.ts:515`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`; `test/server-publish-rate-limit.test.ts` › `validates the File store's persisted state`; `test/server-publish-rate-limit.test.ts` › `deletes expired SQLite windows instead of keeping a row per key forever`; `test/server-publish-rate-limit.test.ts` › `is the SQLite database the environment names, ahead of a JSON file, closed with the relay`; `test/server-publish-rate-limit.test.ts` › `resolves the SQLite path from the CLI, the options, the config file and the environment, in that order`; `test/server-http-security.test.ts` › `counts a publish against the client past the trusted hops, trusting %s`; `test/server-http-security.test.ts` › `throttles room creation without a publish key, 30 rooms a minute from one address by default`; `test/server-publish-rate-limit.test.ts` › `spends a unit of the publisher's bucket on every rotation, as on a creation, %s`

**R-ROOM-069** 설정한 `publishRateLimitMax`는 `floor`한 값을 MUST 쓴다(음수나 유한하지 않은 값은 설정 단계에서
`PUBLISH_RATE_LIMIT_MAX_INVALID`로 던진다). 그래서 1 미만의 소수(예: 0.5)는 0이 되고, publish key가 있어도 rate limit이
없다(R-ROOM-010의 0 규칙). `X-RateLimit-Limit`·`X-RateLimit-Remaining`은 `POST /p`와 rotate의 201(max > 0일 때), 429, 503
`PUBLISH_RATE_LIMIT_UNAVAILABLE`에만 붙는다. rate-limit 단위를 쓴 뒤 401(R-ROOM-009), 413·400·500(R-HTTP-008), 403(R-ROOM-011), 400
`CAPABILITIES_INVALID`(R-ROOM-012), 503 `ROOM_CAPACITY_EXCEEDED`(R-LIM-047)로 끝난 `POST /p`와, 단위를 쓴 뒤 body·binding·room 수 상한으로
끝난 rotate(R-ROOM-073)에는 `X-RateLimit-*`가 없다.\
근거: `src/server/server-config.ts:505`, `src/server/server-config.ts:514`, `src/server/peer-server.ts:2303`, `src/server/peer-server.ts:2304`, `src/server/peer-server.ts:3033`, `src/server/peer-server.ts:3036`, `src/server/peer-server.ts:3049`, `src/server/peer-server.ts:3059`, `src/server/peer-server.ts:2310`; 테스트: `test/server-publish-rate-limit.test.ts` › `floors a configured publishRateLimitMax, so one under 1 turns the limit off, and names the quota only on 201, 429 and 503`

**R-ROOM-011** owner binding: header owner는 `X-Framebook-Owner ?? X-Owner-Id`를 trim한 값이다. `??`는 header가 없을 때만
넘어가므로 빈 `X-Framebook-Owner`도 `X-Owner-Id`를 가린다(그러면 header owner는 없다). 반복 header는 node:http가 `, `로
이어 붙인 한 문자열이고 그대로 비교한다(`X-Framebook-Owner: a`를 두 번 보내면 `a, a`이므로 body owner나 설정 owner `a`와
다르다). body owner는 문자열 `body.ownerId`(trim. 문자열이면 비어 있어도 `owner`를 보지 않는다), 아니면 문자열
`body.owner`(trim)다. 설정 owner는 publish key가 있을 때만 `publishKeyOwner ?? 'publish-key-owner'`다. header owner와 body
owner가 둘 다 있고 다르거나, 설정 owner가 있고 비어 있지 않은 header·body owner가 그와 다르면 relay는 403
`{error:'PUBLISH_OWNER_BINDING_INVALID'}`로 MUST 답한다. room의 `ownerId`는 설정 owner에서만 MUST 온다. publish key가 없으면 header·body
owner는 아무것도 인증하지 않은 주장이라 room에 넣지 않고 descriptor에도 싣지 않는다. 그래도 서로 모순된 두 힌트는 모순된 요청으로 보아
거절하므로, 나중에 key를 켜도 같은 요청은 같은 결과를 낸다.\
근거: `src/server/peer-server.ts:3038`, `src/server/peer-server.ts:3039`, `src/server/peer-server.ts:3040`, `src/server/peer-server.ts:3041`, `src/server/peer-server.ts:3045`, `src/server/peer-server.ts:3046`, `src/server/peer-server.ts:3049`; 테스트: `test/server-approval-lease.test.ts` › `refuse hints that contradict each other and never become the room's owner`

**R-ROOM-012** body option은 다음과 같이 MUST 해석한다. `alias`: 문자열이고 trim해서 비어 있지 않으면 그 값의 처음
256 code point(`MAX_ROOM_ALIAS_CODE_POINTS`, R-LIM-042. surrogate pair 안에서 자르지 않고, 자른 끝의 공백은 지운다), 아니면
`wireframe-local`. alias는 공개 `GET /p/:id/mcp`를 포함한 모든 room descriptor에 나오는 표시용 값이라 거절하지 않고 자른다.
`approvalRequired`: 정확히 `false`일 때만 false. `ttlMs`: 유한한 수면 그 값,
아니면 7200000(그 뒤 R-ROOM-002 clamp). `capabilities`: `undefined`면 `['mcp-control']`, 아니면 비어 있지 않은 배열이고
중복 제거한 원소가 모두 `mcp-control` 또는 `mcp-crdt`여야 하며 아니면 400 `{error:'CAPABILITIES_INVALID'}`.
`mcp-control`이 없으면 앞에 넣고, room의 capabilities는 언제나 `mcp-control`이 맨 앞이다(`createRoomEntry`가 다시 앞에 두고
중복을 지운다). 그 밖의 member(`title` 등)는 무시한다.\
근거: `src/server/peer-server.ts:1177`, `src/server/peer-server.ts:3053`, `src/server/peer-server.ts:3054`, `src/server/peer-server.ts:3055`, `src/server/peer-server.ts:3056`, `src/server/peer-server.ts:3057`, `src/server/peer-server.ts:3059`, `src/server/peer-server.ts:1016`; 테스트: `test/relay-message-limit.test.ts` › `trims a room's alias and keeps at most its first 256 code points, on creation and on rotation`

**R-ROOM-013** 성공한 `POST /p`는 201과 room descriptor `{id, roomId(같은 값), roomEpoch:1, providerToken, inviteToken,
reconnectToken, reconnectTokenExpiresAt(epoch ms), reconnectGraceMs, descriptorUrl:'<requestOrigin>/p/<id>/mcp', expiresAt(epoch ms),
state:'provisioned', createdAt(ISO), updatedAt(ISO), approvalRequired, capabilities, alias, ownerId?}`로 MUST 답한다.
`reconnectTokenExpiresAt`은 lease를 쓸 수 있는 가장 늦은 시각인 room의 `expiresAt`이고, `reconnectGraceMs`(900000,
`RECONNECT_GRACE_MS`)는 provider socket이 붙어 있지 않을 때 lease가 남는 시간이다(R-ROOM-018). reclaim과 rotate의 descriptor도 같은
`roomDescriptor`로 만든다. 새 room은 `inviteConsumed: false`, ticket 없음, 아직 provider socket이 없으므로
`reconnectLeaseExpiresAt = min(expiresAt, now + 900000)`, `metadataRetainUntil = expiresAt + 86400000`이다. deployment catalog에
tool이 있으면 그 catalog를 사본 없이 room catalog로 갖고(얼린 하나를 함께 쓴다, R-MCP-042. `catalogSource: 'deployment'`, deployment의 version과 hash), 없으면 catalog 없이
`catalogVersion: 0`, `catalogHash = SHA-256('[]')`이다.\
근거: `src/server/peer-server.ts:991`, `src/server/peer-server.ts:1015`, `src/server/peer-server.ts:1022`, `src/server/peer-server.ts:1023`, `src/server/peer-server.ts:1028`, `src/server/peer-server.ts:1035`, `src/server/peer-server.ts:1150`, `src/server/peer-server.ts:1159`, `src/server/peer-server.ts:1160`, `src/server/peer-server.ts:3070`; 테스트: `test/server-approval-lease.test.ts` › `reports the room's expiry and a 15-minute grace in the room descriptor`

### 4.5 `POST /p/:id/reclaim` (provider lease 회수)

**R-ROOM-014** reclaim은 body를 읽기 전과 뒤에 room을 join·approval·revoke·rotate와 같은 검사(`checkLifecycleRoom`)로 MUST
검사한다. room이 없거나 map에서 다른 entry로 바뀌었으면(보존 기한이 지나 삭제된 room 포함) 404 `{error:'ROOM_NOT_FOUND',
code:-32004}`. rotate됐으면 410 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch, replacementRoomId}`(`sendRoomRotated`, 모든
수명주기 route가 같은 body다, R-ROOM-046). `expiresAt <= now`이면 410 `{error:'ROOM_EXPIRED', code:-32056, roomId, roomEpoch}`
(`sendRoomExpired`, R-ROOM-070)이고, 그 room을 아직 만료 처리하지 않았으면 이때 처리한다(R-ROOM-067). room이 살아 있는데
`reconnectLeaseExpiresAt <= now`이면 room 만료와 다른 이름인 410 `{error:'ROOM_LEASE_EXPIRED', roomId, roomEpoch}`(code 없음)다. lease가
언제 만료되는지는 R-ROOM-018이다.\
근거: `src/server/peer-server.ts:3083`, `src/server/peer-server.ts:3084`, `src/server/peer-server.ts:3085`, `src/server/peer-server.ts:3086`, `src/server/peer-server.ts:3091`, `src/server/peer-server.ts:3093`, `src/server/peer-server.ts:2155`, `src/server/peer-server.ts:2146`, `src/server/peer-server.ts:2126`, `src/server/peer-server.ts:2131`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`; `test/server-error-model.test.ts` › `puts the code of an error's JSON-RPC namesake in its lifecycle body`; `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`; `test/server-room-lifecycle.test.ts` › `refuses a reclaim of a live room whose lease expired with 410 ROOM_LEASE_EXPIRED, not the room's ROOM_EXPIRED`

**R-ROOM-015** reclaim은 `Authorization`을 읽지 않고 `body.leaseToken`을 자격으로 MUST 쓴다(body 자격, R-HTTP-019). 다음
순서로 검사한다. trim한 문자열 leaseToken이 비었으면 400 `{error:'ROOM_LEASE_REQUIRED'}`. `SHA-256(leaseToken)`을 저장한 hash와 상수
시간으로 비교해 다르면 403 `{error:'ROOM_LEASE_INVALID'}`. 그다음 binding(R-ROOM-071)이다: `body.roomId`·`body.roomEpoch` 중 있는 것이
경로 id·현재 epoch와 엄격히 같지 않으면 409 `{error:'ROOM_LEASE_BINDING_INVALID', code:-32002, roomId, roomEpoch}`다. binding은 lease
뒤에 보므로, 맞는 lease를 낸 요청만 binding 불일치를 안다.\
근거: `src/server/peer-server.ts:3096`, `src/server/peer-server.ts:3097`, `src/server/peer-server.ts:3098`, `src/server/peer-server.ts:3102`, `src/server/peer-server.ts:3103`, `src/server/peer-server.ts:3107`, `src/server/peer-server.ts:3108`, `src/server/peer-server.ts:1539`; 테스트: `test/server-error-model.test.ts` › `answers a missing body credential with 400 and a wrong one with 403, without a challenge`; `test/server-approval-lease.test.ts` › `must name the room and its epoch when present, on every route under its own name`; `test/server-approval-lease.test.ts` › `is checked after the request's credential`

**R-ROOM-016** room에 provider socket이 붙어 있으면 409 `{error:'ROOM_PROVIDER_ACTIVE', roomId, roomEpoch}`(code 없음)로
MUST 답한다. relay가 이미 떼어 낸 socket(send가 `closed`를 돌려 분리된 것, 새 socket에 밀린 것, hook 대기 중 client가
떠나 붙지 않은 것, liveness timeout으로 닫은 것, R-WS-039)은 reclaim을 막지 않는다. 그래서 FIN·RST 없이 사라진 provider socket도
`webSocketIdleTimeoutMs`(기본 75000 ms) 안에 reclaim을 막지 않게 된다.\
근거: `src/server/peer-server.ts:3111`, `src/server/peer-server.ts:3112`, `src/server/peer-server.ts:1506`, `src/server/peer-server.ts:3797`; 테스트: `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`; `test/relay-message-limit.test.ts` › `does not attach a provider socket whose client went away (%s) while a customUpgradeHandler was awaiting`; `test/server-upgrade.test.ts` › `pings every socket and closes one it stops hearing from with 1001, detaching the provider`

**R-ROOM-017** 성공한 reclaim은 새 providerToken(이전 token은 진행 중인 느린 approval·rotate 요청을 포함해 이후 거절된다),
새 reconnectToken과 hash를 MUST 발급한다. 이때 provider socket은 없으므로 새 lease의 유예를 시작해
`reconnectLeaseExpiresAt = min(expiresAt, now + 900000)`으로 정하고(R-ROOM-018), `updatedAt`과 `roomState`(R-ROOM-003)를 바꾼다.
roomEpoch, inviteToken(이미 소비됐어도), ticket, catalog는 그대로다. 응답은 200 `{...room descriptor(R-ROOM-013), reclaimed:true,
reclaimedAt(ISO)}`다.\
근거: `src/server/peer-server.ts:3116`, `src/server/peer-server.ts:3117`, `src/server/peer-server.ts:3118`, `src/server/peer-server.ts:3120`, `src/server/peer-server.ts:3122`, `src/server/peer-server.ts:3123`, `src/server/peer-server.ts:1520`; 테스트: `test/relay-message-limit.test.ts` › `refuses a slow approval or rotation signed with a provider token a reclaim replaced meanwhile`; `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`; `test/server-provider-reattach.test.ts` › `keeps an approved agent working after the provider socket drops and the host reclaims the room`; `test/server-approval-lease.test.ts` › `does not expire while a provider socket is attached, and lasts 15 minutes after the socket goes away`

**R-ROOM-018** reconnect lease는 provider socket이 붙어 있는 동안 MUST NOT 만료된다. relay는 provider socket을 붙일 때
`reconnectLeaseExpiresAt = expiresAt`(room 수명)으로 두고, room에 provider socket이 없게 될 때마다 — room 생성(R-ROOM-013), 성공한
reclaim(R-ROOM-017), 붙어 있던 provider socket의 close(R-ROOM-054), relay가 socket을 떼는 분리(`detachClosedProvider`: 새 socket의
교체, `closed`인 send) — 유예를 시작해 `reconnectLeaseExpiresAt = min(expiresAt, 그 시각 + 900000)`(`startReconnectGrace`)으로 MUST
정한다. keepalive는 lease를 바꾸지 않는다. 그래서 room 수명 내내 socket을 붙여 둔 host도 새로고침 뒤 15분 안에 reclaim할 수 있고,
새어 나간 lease는 provider가 떠난 뒤 최대 15분만 쓸 수 있다. 유예가 지난 reclaim은 room이 유효해도 410 `ROOM_LEASE_EXPIRED`
(R-ROOM-014)이고, provider socket이 붙어 있는 동안의 reclaim은 lease가 유효하므로 409 `ROOM_PROVIDER_ACTIVE`(R-ROOM-016)다.
descriptor는 lease의 상한인 room `expiresAt`을 `reconnectTokenExpiresAt`으로, 유예를 `reconnectGraceMs`로 알린다(R-ROOM-013).\
근거: `src/server/peer-server.ts:99`, `src/server/peer-server.ts:1022`, `src/server/peer-server.ts:1510`, `src/server/peer-server.ts:1520`, `src/server/peer-server.ts:1521`, `src/server/peer-server.ts:3085`, `src/server/peer-server.ts:3120`, `src/server/peer-server.ts:3929`, `src/server/peer-server.ts:3955`, `src/server/peer-server.ts:1159`, `src/server/peer-server.ts:1160`; 테스트: `test/server-room-lifecycle.test.ts` › `refuses a reclaim of a live room whose lease expired with 410 ROOM_LEASE_EXPIRED, not the room's ROOM_EXPIRED`; `test/server-approval-lease.test.ts` › `does not expire while a provider socket is attached, and lasts 15 minutes after the socket goes away`; `test/server-approval-lease.test.ts` › `expires 15 minutes after the provider socket went away, however long it was attached`

### 4.6 `POST /p/:id/join`

**R-ROOM-019** join은 body를 읽기 전과 뒤에 room을 R-ROOM-014와 같은 검사(`checkLifecycleRoom`)로 MUST 검사하며, invite보다
먼저 본다. room이 없거나 바뀌었으면 404 `{error:'ROOM_NOT_FOUND', code:-32004}`, `rotatedTo`가 있으면 410 `{error:'ROOM_ROTATED',
code:-32057, roomId, roomEpoch, replacementRoomId}`, `expiresAt <= now`이면 410 `{error:'ROOM_EXPIRED', code:-32056, roomId,
roomEpoch}`다. 만료 비교는 다른 모든 route와 sweep처럼 `<=`이므로, `expiresAt`과 같은 ms에 온 join도 invite를 소비하거나 이미
만료된 ticket을 발급하지 않는다.\
근거: `src/server/peer-server.ts:3422`, `src/server/peer-server.ts:3423`, `src/server/peer-server.ts:3425`, `src/server/peer-server.ts:2155`, `src/server/peer-server.ts:2146`, `src/server/peer-server.ts:2934`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`; `test/server-room-lifecycle.test.ts` › `refuses a join in the millisecond its room expires, as every other route does, and keeps the invite`

**R-ROOM-020** invite token은 trim한 문자열 `body.inviteToken`이고 body 자격이다(R-HTTP-019). relay는 다음 순서로 MUST
검사한다. 비었으면 400 `{error:'INVITE_TOKEN_REQUIRED'}`. room의 invite와 상수 시간 비교가 다르면 403
`{error:'INVITE_TOKEN_INVALID'}`. 맞는 invite가 이미 소비됐으면 409 `{error:'INVITE_TOKEN_CONSUMED'}`. 그래서 소비 여부는 맞는
invite를 낸 요청만 안다. capabilities가 R-ROOM-012 규칙에 맞지 않으면 400 `{error:'CAPABILITIES_INVALID'}`. `mcp-crdt`를
요청했는데 room에 없으면 403 `{error:'CRDT_CAPABILITY_NOT_GRANTED'}`.\
근거: `src/server/peer-server.ts:3428`, `src/server/peer-server.ts:3430`, `src/server/peer-server.ts:3433`, `src/server/peer-server.ts:3434`, `src/server/peer-server.ts:3437`, `src/server/peer-server.ts:3438`, `src/server/peer-server.ts:3441`, `src/server/peer-server.ts:3446`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`; `test/server-error-model.test.ts` › `tells only the right invite that it was already used`; `test/server-error-model.test.ts` › `answers a missing body credential with 400 and a wrong one with 403, without a challenge`

**R-ROOM-021** invite는 모든 검사를 통과한 join에서만 MUST 소비한다(`inviteConsumed = true`). body 때문에 거절된 join(413,
400, 500 `BODY_CONSUMED`)과 R-ROOM-019·R-ROOM-020에서 거절된 join은 invite를 소비하지 않는다.\
근거: `src/server/peer-server.ts:3451`; 테스트: `test/relay-message-limit.test.ts` › `answers 500 BODY_CONSUMED instead of acting on a body a customHttpHandler read, and reads one it only paused`; `test/server-room-lifecycle.test.ts` › `refuses a join in the millisecond its room expires, as every other route does, and keeps the invite`

**R-ROOM-022** 발급하는 ticket은 `clientToken`, `sessionId`, `issuedAt = now`, `expiresAt = room.expiresAt`, 요청한
capabilities를 MUST 가진다. status는 `approvalRequired`면 `pending`, 아니면 `approved`이고 그때 `approvedAt = issuedAt`이다.
`clientLabel`은 비어 있지 않은 문자열이면 trim한 뒤 앞 256 code point만 남기고(surrogate pair 중간에서 자르지 않고,
자른 뒤 끝 공백도 지운다), 아니면 `MCP client`다. 더 긴 label은 거절하지 않고 자른다. roomState 전이는 R-ROOM-003이며,
그래서 승인 불필요 room은 join으로 `active`가 되지 않는다.\
근거: `src/server/peer-server.ts:195`, `src/server/peer-server.ts:586`, `src/server/peer-server.ts:3452`, `src/server/peer-server.ts:3457`, `src/server/peer-server.ts:3459`, `src/server/peer-server.ts:3470`; 테스트: `test/relay-message-limit.test.ts` › `trims a join's clientLabel and keeps at most its first 256 code points`; `test/server-provider-reattach.test.ts` › `re-sends a pending request and restores no expired or approval-free ticket`

**R-ROOM-023** join 응답은 201 `{roomId, roomEpoch, clientToken, sessionId, issuedAt(epoch ms), expiresAt(epoch ms),
approvalRequired, capabilities, approvalState:'pending'|'approved', state:'pending-approval'|'approved',
approvalRequestId?}`이다. `approvalRequestId`는 승인 요청을 만들었을 때만 MUST 있다(R-ROOM-024).\
근거: `src/server/peer-server.ts:3473`, `src/server/peer-server.ts:3475`, `src/server/peer-server.ts:3486`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

### 4.7 승인 요청의 수명

**R-ROOM-024** 승인이 필요한 room에서 pending ticket의 승인 요청은 `requestId = 'approval-' + 32 hex`,
`createdAt = now`, `expiresAt = min(room.expiresAt, now + approvalTimeoutMs)`(R-LIM-043, 기본 300000 ms),
`clientLabel = ticket.clientLabel || 'MCP client'`로 MUST 만든다. 사람이 결정하는 창이므로 중계 요청의 `mcpRequestTimeoutMs`
(R-LIM-025)와 관계가 없다. ticket이 room의 `pendingApprovals`에 남아 있는 요청을 가리키면 새로 만들지 않고 그 요청을 다시 쓴다.
만드는 시점은 join이고, 이후 접촉에서 요청이 없으면 다시 만든다. 요청이 만료되면 ticket도 `expired`로 끝나고(R-ROOM-026) invite는
소비된 채이므로, 그 room은 rotate(R-ROOM-043)로 새 invite를 내기 전에는 다른 agent를 받지 않는다.\
근거: `src/server/peer-server.ts:2470`, `src/server/peer-server.ts:2472`, `src/server/peer-server.ts:2496`, `src/server/peer-server.ts:2508`, `src/server/peer-server.ts:889`; 테스트: `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`; `test/server-approval-lease.test.ts` › `is approvalTimeoutMs %s, not the MCP request timeout`; `test/server-approval-lease.test.ts` › `never outlives the room, which an infinite approvalTimeoutMs waits for`

**R-ROOM-025** relay는 승인 요청을 provider socket마다 최대 한 번 `approval.request`(R-SIG-008)로 MUST 보낸다. `send`가
`sent`일 때만 전달로 기록한다. 받지 못한 요청(provider 없음, `busy`, `too-large`)은 미전달로 남고 ticket 소유자의 다음 접촉
— join, 그 pending ticket bearer로 ticket 해석 단계(R-MCP-007의 6단계)까지 간 `POST /p/:id/mcp`(metadata method 포함),
client socket 부착, client bearer로 한 `GET /p/:id/sessions/:sessionId` — 이나 provider 부착 replay 때 다시 보낸다. 그 앞 단계에서
거절된 POST(body 읽기의 413·500 `BODY_CONSUMED`, 400 `PARSE_ERROR`·`REQUEST_ID_TOO_LARGE`·`INVALID_REQUEST`, 다시 직렬화한 크기의
413, 400 `UNSUPPORTED_PROTOCOL_VERSION`)와 client socket이 보낸 frame(R-SIG-013)은 아무것도 보내지 않는다. `closed`면 provider를
분리한다(`detachClosedProvider`). 새 provider socket은 같은 요청을 다시 한 번 받는다.\
근거: `src/server/peer-server.ts:2589`, `src/server/peer-server.ts:2591`, `src/server/peer-server.ts:2614`, `src/server/peer-server.ts:2615`, `src/server/peer-server.ts:3250`, `src/server/peer-server.ts:3261`, `src/server/peer-server.ts:3267`, `src/server/peer-server.ts:3277`, `src/server/peer-server.ts:3286`, `src/server/peer-server.ts:3294`, `src/server/peer-server.ts:3299`, `src/server/peer-server.ts:3473`, `src/server/peer-server.ts:3589`, `src/server/peer-server.ts:4128`; 테스트: `test/relay-backpressure.test.ts` › `sends a pending approval request the provider could not take on the agent's next call, and only once`; `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`

**R-ROOM-026** relay는 승인 요청을 만들 때 `min(2147483647, max(1, expiresAt − Date.now()))` ms 뒤에 도는 timer를 MUST 건다
(`scheduleApprovalExpiry`). timer가 돌 때 요청이 `pendingApprovals`에 없으면(결정됐거나 ticket이 끝났다) 아무것도 하지 않는다. room이
만료됐으면 room 만료 처리(R-ROOM-067)를 하고, 그것이 ticket을 끝낸다. 요청이 아직 만기가 아니면(`expiresAt > Date.now()`) 남은 시간으로
timer를 다시 건다. Node timer는 `Date.now()`가 `expiresAt`에 닿기 전에 돌 수 있고(timer의 시작 시각은 libuv loop의 cached 시각이고
`Date.now()`는 wall clock이다) 2147483647 ms보다 긴 지연은 1 ms로 바뀌므로, 다시 걸지 않으면 요청이 만료되지 않는다. 만기면 relay는
요청을 지우고(`expireApprovalRequest`), ticket이 아직 `pending`이면 `expired`(`revokedAt` 설정, `approvalRequestId` 해제)로 바꾼 뒤
ticket에 묶인 client socket마다 그 socket을 room에서 빼고 `approval.expired`(R-SIG-012)를 outbox로 보내고 R-WS-037대로 닫으며(1000), room의
provider socket에도 같은 frame을 plain `send`로 보낸다. 그래서 host는 요청을 내린다. 결정은 요청의 `expiresAt`을 보지 않으므로 timer가
요청을 지우기 전의 결정은 받아들이고, 지운 뒤의 HTTP·WebSocket 결정은 409·error frame `INVALID_APPROVAL`이다(R-ROOM-028, R-SIG-009).
invite는 소비된 채 남아 rotate 전에는 새 join을 받지 않는다. 이 timer는 provider가 붙어 있지 않아도 돈다.\
근거: `src/server/peer-server.ts:104`, `src/server/peer-server.ts:2512`, `src/server/peer-server.ts:2523`, `src/server/peer-server.ts:2525`, `src/server/peer-server.ts:2526`, `src/server/peer-server.ts:2527`, `src/server/peer-server.ts:2528`, `src/server/peer-server.ts:2540`, `src/server/peer-server.ts:2541`, `src/server/peer-server.ts:2542`, `src/server/peer-server.ts:2543`, `src/server/peer-server.ts:2544`, `src/server/peer-server.ts:2545`, `src/server/peer-server.ts:2560`, `src/server/peer-server.ts:2561`, `src/server/peer-server.ts:2559`, `src/server/peer-server.ts:2578`; 테스트: `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`; `test/server-approval-lease.test.ts` › `expires a request whose timer fired before it was due, once it is`; `test/provider-approval-state.test.ts` › `takes an approval request nobody decided in time down when the relay expires it`; `test/relay-backpressure.test.ts` › `expires the approval of an agent that is behind after the answers it asked for, then closes it`

### 4.8 `POST /p/:id/approval/:requestId`

**R-ROOM-027** approval route는 경로 `:requestId`를 먼저 decode하고(실패하면 400 `INVALID_PATH`, R-HTTP-003) body를 읽기
전과 뒤에 room과 token을 MUST 검사한다(`checkLifecycleRoom`, `checkProviderToken`). room이 없거나 바뀌었으면 404
`{error:'ROOM_NOT_FOUND', code:-32004}`. rotate됐으면 만료 검사보다 먼저 410 `{error:'ROOM_ROTATED', code:-32057, roomId,
roomEpoch, replacementRoomId}`(R-ROOM-046). `expiresAt <= now`면 410 `{error:'ROOM_EXPIRED', code:-32056, roomId, roomEpoch}`
(R-ROOM-070). 그다음 Bearer 자격(R-HTTP-018)이 없으면
401 `{error:'PROVIDER_TOKEN_REQUIRED'}`, 현재 providerToken과 상수 시간으로 같지 않으면 401 `{error:'PROVIDER_TOKEN_INVALID'}`이고,
둘 다 R-HTTP-019의 challenge를 가진다.\
근거: `src/server/peer-server.ts:3495`, `src/server/peer-server.ts:3501`, `src/server/peer-server.ts:3505`, `src/server/peer-server.ts:3509`, `src/server/peer-server.ts:2144`, `src/server/peer-server.ts:2145`, `src/server/peer-server.ts:2146`, `src/server/peer-server.ts:2174`, `src/server/peer-server.ts:2175`; 테스트: `test/relay-message-limit.test.ts` › `refuses a slow approval or rotation signed with a provider token a reclaim replaced meanwhile`; `test/server-room-lifecycle.test.ts` › `takes a Bearer token with a scheme of any case and one or more spaces on every route`; `test/server-error-model.test.ts` › `tells a missing Authorization credential from a wrong one, with a Bearer challenge`; `test/server-error-model.test.ts` › `answers every lifecycle route of a rotated room with 410 ROOM_ROTATED and its replacement`; `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`

**R-ROOM-028** 경로 requestId의 pending 요청이 있어야 하고, `body.sessionId`는 그 요청의 sessionId와 같은 비어 있지 않은
문자열, `decision`은 `approved` 또는 `rejected`여야 한다. `body.roomId`·`body.roomEpoch`는 선택이며, 있으면 경로 roomId·현재 epoch와
엄격히 같아야 한다(R-ROOM-071). `reason`은 선택이며 문자열이 아니면 무시한다. 하나라도 어기거나 ticket이 사라졌거나 다른 요청에
묶여 있으면 relay는 409 `{error:'INVALID_APPROVAL', code:-32081}`로 MUST 답한다. 결정은 pending 요청을 지우는 1회성 동작이라 relay는
반복된 결정을 오래된 결정과 구별할 수 없다. 그래서 같은 결정을 반복해도 멱등으로 받지 않고 409다. ticket이 사라졌거나 다른 요청에
묶여 409가 될 때도 그 요청은 이미 지운 뒤다. 만료돼 지운 요청(R-ROOM-026)에 온 결정도 409다.\
근거: `src/server/peer-server.ts:3513`, `src/server/peer-server.ts:3514`, `src/server/peer-server.ts:3516`, `src/server/peer-server.ts:3518`, `src/server/peer-server.ts:3522`, `src/server/peer-server.ts:3524`, `src/server/peer-server.ts:2784`, `src/server/peer-server.ts:2785`, `src/server/peer-server.ts:1539`; 테스트: `test/server-approval-lease.test.ts` › `is optional on approval and both revoke routes`; `test/server-approval-lease.test.ts` › `must name the room and its epoch when present, on every route under its own name`; `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`

**R-ROOM-029** 승인하면 ticket은 `approved`, `approvedAt = now`, room은 `active`가 MUST 된다. ticket에 묶인 client
socket마다 outbox로 `approval.approved`(R-SIG-010)를, 그것이 `sent`나 `queued`일 때만 이어서
`{type:'ready', role:'client', roomId, roomEpoch, sessionId, capabilities, expiresAt: ticket.expiresAt, approval:'approved'}`를
보낸다. 그다음 결정 경로와 무관하게(HTTP route든 provider socket의 `approval.decision`이든) room의 provider socket에 결정 echo
(R-SIG-009)를 MUST 보낸다(R-SIG-024). 거절(R-ROOM-030)도 echo를 보낸다.\
근거: `src/server/peer-server.ts:2791`, `src/server/peer-server.ts:2792`, `src/server/peer-server.ts:2793`, `src/server/peer-server.ts:2817`, `src/server/peer-server.ts:2818`, `src/server/peer-server.ts:2819`, `src/server/peer-server.ts:2822`, `src/server/peer-server.ts:2788`, `src/server/peer-server.ts:3522`, `src/server/peer-server.ts:3878`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`; `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`; `test/server-approval-lease.test.ts` › `echoes a decision made on its own socket once`

**R-ROOM-030** 거절하면 ticket은 `rejected`가 되고, relay는 reason(HTTP는 비어 있지 않은 문자열 `body.reason`, WebSocket은
R-SIG-011의 값, 없으면 `CLIENT_APPROVAL_DENIED`)으로 ticket 종료(R-ROOM-047)를 MUST 한다. `rejected` ticket은 다시 `pending`이나
`approved`가 되지 않고, 그동안 그 ticket의 MCP 호출은 403 −32054 `CLIENT_APPROVAL_DENIED`다. 다만 뒤의 ticket 종료 — provider 단일
revoke(R-ROOM-039), client 자기 revoke(R-ROOM-040), 전체 revoke·rotate(R-ROOM-048) — 는 이 status를 `revoked`, `room-rotated`로
덮어쓴다. room 만료는 덮어쓰지 않는다(R-ROOM-048, R-ROOM-035). invite는 소비된 채 남는다.\
근거: `src/server/peer-server.ts:2786`, `src/server/peer-server.ts:2787`, `src/server/peer-server.ts:3522`, `src/server/peer-server.ts:2436`, `src/server/peer-server.ts:2728`, `src/server/peer-server.ts:3649`, `src/server/peer-server.ts:3673`, `src/server/peer-server.ts:2892`, `src/server/peer-server.ts:2891`; 테스트: `test/live-demo.e2e.test.ts` › `a host rejection denies the session`; `test/server-room-lifecycle.test.ts` › `keeps the state and revokedAt of a session %s before its room expired, instead of ending it again with the room`

**R-ROOM-031** 결정한 approval은 200 `{requestId, sessionId, roomId, roomEpoch, state:<decision>,
clientTokenActive:<decision === 'approved'>, decidedAt(ISO), expiresAt(ISO), approvalExpiresAt(epoch ms), ticketExpiresAt(epoch ms)}`로
MUST 답한다. `expiresAt`은 ticket이 아니라 승인 요청의 만료이고 기존 필드라 형식과 뜻을 바꾸지 않는다. 같은 승인 요청 만료를 epoch
ms로 `approvalExpiresAt`에, ticket의 만료를 `ticketExpiresAt`에 싣는다(R-ROOM-072). `decidedAt`은 ticket이 기록한 결정 시각(승인은
`approvedAt`, 거절은 `revokedAt`)이라 provider echo의 `sentAt`·`payload.decidedAt`(R-SIG-009)과 같다.\
근거: `src/server/peer-server.ts:3528`, `src/server/peer-server.ts:3529`, `src/server/peer-server.ts:3536`, `src/server/peer-server.ts:3537`, `src/server/peer-server.ts:3538`, `src/server/peer-server.ts:2831`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`; `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`

### 4.9 `GET /p/:id/sessions/:sessionId`

**R-ROOM-032** session status는 경로 `:sessionId`를 먼저 decode하고(실패하면 400 `INVALID_PATH`, R-HTTP-003), room이 없으면
404 `{error:'ROOM_NOT_FOUND', code:-32004}`, rotate됐으면 인증보다 먼저 410 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch,
replacementRoomId}`로 MUST 답한다. room 만료는 검사하지 않으므로 보존 중인 만료 room도 답한다.\
근거: `src/server/peer-server.ts:3547`, `src/server/peer-server.ts:3549`, `src/server/peer-server.ts:3553`, `src/server/peer-server.ts:3554`, `src/server/peer-server.ts:3557`, `src/server/peer-server.ts:3558`; 테스트: `test/server-error-model.test.ts` › `answers every lifecycle route of a rotated room with 410 ROOM_ROTATED and its replacement`

**R-ROOM-033** bearer(R-HTTP-018)가 room의 providerToken과 상수 시간으로 같으면 room의 모든 session을 읽을 수 있고, 모르는
session은 404 `{error:'SESSION_NOT_FOUND'}`다. 그 밖의 bearer는 client token이어야 하며 relay는 MUST 다음 순서로 검사한다. bearer가
없으면 401 `{error:'CLIENT_TOKEN_REQUIRED', code:-32003}`. token의 SHA-256 hex로 찾은 room의 ticket이 없으면 401
`{error:'CLIENT_TOKEN_INVALID', code:-32003}`(둘 다 R-HTTP-019의 challenge를 가진다). 그 ticket이 경로의 session이 아니면(모르는
session 포함) 403 `{error:'SESSION_NOT_OWNED'}`. 모든 status의 ticket(revoked, rejected 포함)을 읽을 수 있다.\
근거: `src/server/peer-server.ts:3562`, `src/server/peer-server.ts:3563`, `src/server/peer-server.ts:3564`, `src/server/peer-server.ts:3567`, `src/server/peer-server.ts:3570`, `src/server/peer-server.ts:3572`, `src/server/peer-server.ts:3576`, `src/server/peer-server.ts:3581`; 테스트: `test/client-session.test.ts` › `revokes a README-style Streamable HTTP session after initialize`; `test/server-room-lifecycle.test.ts` › `takes a Bearer token with a scheme of any case and one or more spaces on every route`; `test/server-error-model.test.ts` › `lets a client token read the status of its own session only`; `test/server-error-model.test.ts` › `tells a missing Authorization credential from a wrong one, with a Bearer challenge`

**R-ROOM-034** `ticket.expiresAt <= now`이고 status가 `revoked`·`rejected`가 아니면 status를 `expired`로 MUST 바꾼다.
client token으로 pending ticket을 조회하면 승인 요청을 전달한다(R-ROOM-025, provider token 조회는 하지 않는다). 응답은 200
`{roomId, roomEpoch, sessionId, state, clientLabel, approvalRequestId(문자열 또는 null), issuedAt(ISO), expiresAt(ISO),
approvedAt?(ISO), revokedAt?(ISO)}`이다. `state`는 `pending`이면 `pending-approval`, 아니면 status 그대로
(`approved`, `rejected`, `revoked`, `expired`)다. `revokedAt`은 ticket이 끝난 시각이라 거절, 승인 만료, room 만료에도 설정된다.\
근거: `src/server/peer-server.ts:3586`, `src/server/peer-server.ts:3589`, `src/server/peer-server.ts:3590`, `src/server/peer-server.ts:3591`, `src/server/peer-server.ts:3600`, `src/server/peer-server.ts:3601`; 테스트: `test/client-session.test.ts` › `revokes a ticket that is still waiting for approval`; `test/relay-backpressure.test.ts` › `sends a pending approval request the provider could not take on the agent's next call, and only once`

**R-ROOM-035** room 만료 처리(R-ROOM-050)는 아직 끝나지 않은(`pending`, `approved`) ticket만 `expired`로 끝내고, 그 전에 끝난 ticket은
끝난 status와 `revokedAt`을 그대로 둔다(R-ROOM-048). 그래서 보존 중인 만료 room에서 이 route는 room이 만료될 때 살아 있던 session에
`state:'expired'`와 만료 처리 시각의 `revokedAt`을 MUST 보고하고 `revoked`를 보고하지 않으며, 그 전에 거절·revoke되거나 승인 요청이
만료된 session에는 그때의 `state`(`rejected`, `revoked`, `expired`)와 `revokedAt`을 MUST 보고한다. ticket 자신의 `expiresAt`이 지날 때
`revoked`·`rejected`를 덮어쓰지 않는 것(R-ROOM-034)과 같은 규칙이다. 그래서 agent는 room 만료와 revoke를, 만료 전의 거절과 만료를
구별하고, 승인을 기다리던 agent의 `waitForPeerApproval`은 `APPROVAL_EXPIRED`로 끝난다(R-PEER-048). HTTP 요청마다 sweep이 먼저 돌고 이
route는 body가 없으므로, 응답할 때 만료 room은 언제나 이미 만료 처리돼 있다. room이 보존 기한(R-ROOM-051)이 지나 삭제되면 404
`ROOM_NOT_FOUND`다.\
근거: `src/server/peer-server.ts:2962`, `src/server/peer-server.ts:2948`, `src/server/peer-server.ts:2921`, `src/server/peer-server.ts:2891`, `src/server/peer-server.ts:2892`, `src/server/peer-server.ts:2728`, `src/server/peer-server.ts:2729`, `src/server/peer-server.ts:3586`, `src/server/peer-server.ts:3601`; 테스트: `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`; `test/server-room-lifecycle.test.ts` › `keeps the state and revokedAt of a session %s before its room expired, instead of ending it again with the room`; `test/client-session.test.ts` › `reports a session still waiting for approval as expired, so waitForPeerApproval throws APPROVAL_EXPIRED`

### 4.10 `POST /p/:id/session/revoke`, `POST /p/:id/sessions/:sessionId/revoke`

**R-ROOM-036** 두 revoke route는 경로형의 `:sessionId`를 먼저 decode하고(실패하면 400 `INVALID_PATH`, R-HTTP-003), body를
읽기 전과 뒤에 room을 R-ROOM-027과 같이(`checkLifecycleRoom`) MUST 검사한다. room이 없거나 바뀌었으면 404
`{error:'ROOM_NOT_FOUND', code:-32004}`, rotate됐으면 410 `ROOM_ROTATED`(R-ROOM-046), 만료됐으면 410 `ROOM_EXPIRED`(R-ROOM-070)다.\
근거: `src/server/peer-server.ts:3610`, `src/server/peer-server.ts:3612`, `src/server/peer-server.ts:3618`, `src/server/peer-server.ts:3619`, `src/server/peer-server.ts:3622`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`; `test/server-error-model.test.ts` › `answers every lifecycle route of a rotated room with 410 ROOM_ROTATED and its replacement`

**R-ROOM-037** 경로형 `/sessions/:sessionId/revoke`에서는 경로 sessionId가 `body.sessionId`를 MUST 대신한다. body binding은 두
revoke route 모두 R-ROOM-071을 따른다: `body.roomId`·`body.roomEpoch`는 선택이고, 있으면 경로 roomId·현재 epoch와 엄격히 같아야 하며
아니면 409 `{error:'SESSION_BINDING_INVALID', code:-32002}`다. 검사는 자격 뒤다: provider token이면 그 확인 바로 뒤(R-ROOM-038·R-ROOM-039보다
먼저), 아니면 R-ROOM-040의 순서다. 그래서 자격이 없거나 틀린 요청은 binding이 틀려도 401을 받는다.\
근거: `src/server/peer-server.ts:3610`, `src/server/peer-server.ts:3623`, `src/server/peer-server.ts:3626`, `src/server/peer-server.ts:3627`, `src/server/peer-server.ts:3628`, `src/server/peer-server.ts:3668`, `src/server/peer-server.ts:3669`; 테스트: `test/server-room-lifecycle.test.ts` › `reports alreadyRevoked false then true for a provider revocation`; `test/server-approval-lease.test.ts` › `is optional on approval and both revoke routes`; `test/server-approval-lease.test.ts` › `must name the room and its epoch when present, on every route under its own name`; `test/server-approval-lease.test.ts` › `is checked after the request's credential`

**R-ROOM-038** bearer(R-HTTP-018)가 providerToken이고 binding(R-ROOM-037)을 통과했고 sessionId가 없으면(`body.sessionId`가 없거나
문자열이 아니거나 빈 값; `/session/revoke`에서만 가능) relay는 이를 room의 모든 session을 revoke하라는 명시적 요청으로 보고 reason
`ROOM_REVOKED`로 모든 ticket을 MUST revoke한다(R-ROOM-048). revoke route에는 다른 범위 지정이 없으므로 빈 body `{}`도 전부 revoke한다.
`roomId`·`roomEpoch`를 보냈으면 binding이 맞아야 하고, 틀리면 아무것도 revoke하지 않고 409다. 응답은 200
`{roomId, revoked:true, revokedSessions:true}`이고(단일 revoke와 모양이 다르다) `roomState`는 바뀌지 않는다.\
근거: `src/server/peer-server.ts:3626`, `src/server/peer-server.ts:3627`, `src/server/peer-server.ts:3634`, `src/server/peer-server.ts:3635`, `src/server/peer-server.ts:3636`; 테스트: `test/server-pending-settlement.test.ts` › `answers SESSION_INVALID when the provider revokes every session`; `test/live-demo.e2e.test.ts` › `revoke pushes session.revoked and purges the host credentials`; `test/server-approval-lease.test.ts` › `must name the room and its epoch when present, on every route under its own name`

**R-ROOM-039** providerToken과 sessionId가 있으면, 모르는 session은 404 `{error:'SESSION_NOT_FOUND'}`다. 아니면 ticket이
이미 `revoked`가 아닌 한 reason `SESSION_REVOKED`로 ticket을 MUST 종료(R-ROOM-047)하며, `rejected`·`expired`도 `revoked`로
덮어쓴다. revoke는 ticket을 '끝남'으로 수렴시키므로 멱등이다. 응답은 200 `{roomId, roomEpoch, sessionId, state:'revoked', revoked:true,
revokedAt(ISO; 반복이면 원래 시각), reason, alreadyRevoked}`이다. `reason`은 `body.reason ?? 'provider-request'`라서 `null`이 아닌 JSON
값이면 무엇이든 그대로 돌려주고, 없거나 `null`이면 `'provider-request'`다. 이 echo는 요청자에게만 돌아가고 저장되거나 전달되지
않는다. agent와 provider socket이 받는 `session.revoked`의 reason은 relay가 정한 고정값이라(R-SIG-015) 호출자가 agent 화면에 임의
문자열을 넣을 수 없다.\
근거: `src/server/peer-server.ts:3639`, `src/server/peer-server.ts:3640`, `src/server/peer-server.ts:3641`, `src/server/peer-server.ts:3648`, `src/server/peer-server.ts:3649`, `src/server/peer-server.ts:3650`; 테스트: `test/server-room-lifecycle.test.ts` › `reports alreadyRevoked false then true for a provider revocation`; `test/server-approval-lease.test.ts` › `tells it of %s with session.revoked`

**R-ROOM-040** bearer(R-HTTP-018)가 providerToken이 아니면 relay는 client revoke로 보고 MUST 다음 순서로 검사한다. bearer가
없으면 401 `{error:'CLIENT_TOKEN_REQUIRED', code:-32003}`. token의 SHA-256 hex로 room의 ticket(모든 status)을 찾지 못하면 401
`{error:'CLIENT_TOKEN_INVALID', code:-32003}`(둘 다 R-HTTP-019의 challenge를 가진다). 비어 있지 않은 문자열 `body.sessionId`(또는
경로 sessionId)가 ticket의 것과 다르면 403 `{error:'SESSION_NOT_OWNED'}`. `body.roomId`·`body.roomEpoch` 중 있는 것이 경로 roomId·현재
epoch와 같지 않으면(R-ROOM-071) 409 `{error:'SESSION_BINDING_INVALID', code:-32002}`. 그래서 `SESSION_BINDING_INVALID`는 binding 불일치
하나만 뜻한다. 통과하면 이미 `revoked`가 아닌 한 reason `CLIENT_REVOKED`로 ticket을 종료한다(R-ROOM-047. provider socket도
`session.revoked`를 받는다). 응답은 200 `{roomId, roomEpoch, sessionId, state:'revoked', revoked:true, revokedAt, reason, alreadyRevoked}`다.
`reason`은 `body.reason ?? 'client-request'`라서 `null`이 아닌 JSON 값이면 그대로, 없거나 `null`이면 `'client-request'`이고,
R-ROOM-039처럼 요청자에게만 돌아간다. pending, approved, expired, rejected ticket 모두 스스로 revoke할 수 있다.\
근거: `src/server/peer-server.ts:3653`, `src/server/peer-server.ts:3654`, `src/server/peer-server.ts:3657`, `src/server/peer-server.ts:3659`, `src/server/peer-server.ts:3664`, `src/server/peer-server.ts:3665`, `src/server/peer-server.ts:3668`, `src/server/peer-server.ts:3669`, `src/server/peer-server.ts:3673`, `src/server/peer-server.ts:3674`; 테스트: `test/server-room-lifecycle.test.ts` › `reports alreadyRevoked false then true for a client revocation`; `test/client-session.test.ts` › `revokes a ticket that is still waiting for approval`; `test/server-room-lifecycle.test.ts` › `takes a Bearer token with a scheme of any case and one or more spaces on every route`; `test/server-error-model.test.ts` › `refuses a client revoke naming another session with SESSION_NOT_OWNED, not a binding error`; `test/server-error-model.test.ts` › `tells a missing Authorization credential from a wrong one, with a Bearer challenge`; `test/server-approval-lease.test.ts` › `is optional on approval and both revoke routes`; `test/server-approval-lease.test.ts` › `tells it of %s with session.revoked`

### 4.11 `POST /p/:id/rotate`

**R-ROOM-041** rotate는 body를 읽기 전과 뒤에 room과 token을 R-ROOM-027과 같이(`checkLifecycleRoom`, `checkProviderToken`)
MUST 검사한다. room이 없거나 바뀌었으면 404 `{error:'ROOM_NOT_FOUND', code:-32004}`. 이미 rotate됐으면 410
`{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch, replacementRoomId}`이므로 동시에 온 두 번째 rotate도 대체 room을 받고
room을 두 번 rotate하지 않는다. 만료됐으면 410 `ROOM_EXPIRED`(R-ROOM-070)이므로 만료 room은 rotate할 수 없다. bearer가 없으면 401
`PROVIDER_TOKEN_REQUIRED`, 현재 providerToken이 아니면 401 `PROVIDER_TOKEN_INVALID`다(R-HTTP-019).\
근거: `src/server/peer-server.ts:3683`, `src/server/peer-server.ts:3688`, `src/server/peer-server.ts:3689`, `src/server/peer-server.ts:3691`, `src/server/peer-server.ts:3703`, `src/server/peer-server.ts:2145`, `src/server/peer-server.ts:2174`, `src/server/peer-server.ts:2175`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`; `test/server-error-model.test.ts` › `answers every lifecycle route of a rotated room with 410 ROOM_ROTATED and its replacement`; `test/server-error-model.test.ts` › `tells a missing Authorization credential from a wrong one, with a Bearer challenge`; `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`

**R-ROOM-073** room과 token 검사(R-ROOM-041)를 통과한 rotate는 body를 읽기 전에 publish rate-limit 단위 하나를 MUST 소비한다(R-ROOM-010).
대체 room은 room 하나를 더하므로 rotate도 생성처럼 센다. bucket은 rotate를 요청한 주소와 유효한 publisher의 `tokenHash`(설정한 publish key의
hash, 없으면 `anonymous`)이므로 그 주소의 `POST /p`와 같은 할당량을 쓴다. 단위를 얻지 못하면 `POST /p`와 같은 429 `PUBLISH_RATE_LIMITED`나
503 `PUBLISH_RATE_LIMIT_UNAVAILABLE`(`Retry-After`, `X-RateLimit-*`)로 답하고 rotate하지 않는다. 이전 room과 그 ticket·socket은 그대로다.
단위를 쓴 뒤 body, binding(R-ROOM-042), room 수 상한으로 끝난 rotate도 그 단위를 쓴 것이다. store를 기다리는 동안 room이 바뀔 수 있으므로
body 뒤의 다시 검사(R-ROOM-041)가 그것도 다룬다. 그래서 providerToken을 가진 provider가 rotate를 되풀이해도 한 주소에서 생성보다 빨리 room을
채우지 못한다(O-61).\
근거: `src/server/peer-server.ts:3697`, `src/server/peer-server.ts:3698`, `src/server/peer-server.ts:3699`, `src/server/peer-server.ts:3703`, `src/server/peer-server.ts:2288`, `src/server/peer-server.ts:2289`, `src/server/peer-server.ts:2299`; 테스트: `test/server-publish-rate-limit.test.ts` › `spends a unit of the publisher's bucket on every rotation, as on a creation, %s`

**R-ROOM-042** `body.roomId`와 `body.roomEpoch`는 선택이지만, 있으면 경로 roomId·현재 epoch와 엄격히 같아야 한다(R-ROOM-071).
다르면 relay는 rotate하지 않고 409 `{error:'ROOM_BINDING_INVALID', code:-32002, roomId, roomEpoch}`(현재 epoch)로 MUST 답한다.
`ROOM_ROTATED`는 실제로 rotate된 room에만 쓴다(R-ROOM-041). provider는 모르는 epoch를 보내지 않는다(R-PEER-026).
binding이 맞으면 relay는 room 수 상한(R-LIM-047)을 MUST 본다. 대체 room은 room 하나를 더하므로(이전 room은 보존된다) relay가 이미
`maxRooms`개를 가졌으면 503 `{error:'ROOM_CAPACITY_EXCEEDED', retryAfterMs}`와 `Retry-After`로 답하고 rotate하지 않는다. 이전 room과 그
ticket·socket은 그대로다.\
근거: `src/server/peer-server.ts:3705`, `src/server/peer-server.ts:3706`, `src/server/peer-server.ts:1539`, `src/server/peer-server.ts:3711`; 테스트: `test/server-error-model.test.ts` › `refuses a rotate whose body names another room or epoch with ROOM_BINDING_INVALID`; `test/server-approval-lease.test.ts` › `must name the room and its epoch when present, on every route under its own name`; `test/server-http-security.test.ts` › `holds at most maxRooms rooms, retained ones included, refusing creation and rotation with 503 ROOM_CAPACITY_EXCEEDED`

**R-ROOM-043** 대체 room은 `alias = trim한 비어 있지 않은 문자열 body.alias를 R-ROOM-012처럼 처음 256 code point로 자른 값,
아니면 이전 alias`, `ttlMs = 유한한 body.ttlMs, 아니면
7200000`(이전 TTL을 물려받지 않음, R-ROOM-002 clamp), 이전 room의 `approvalRequired`·`capabilities`·`ownerId`,
`roomEpoch = 이전 + 1`로 MUST 만든다. 새 token들, 소비되지 않은 invite, 빈 ticket, deployment catalog(R-ROOM-013)를 가지며
provider가 등록한 catalog는 넘어가지 않는다.\
근거: `src/server/peer-server.ts:3716`, `src/server/peer-server.ts:3717`, `src/server/peer-server.ts:3718`, `src/server/peer-server.ts:3722`, `src/server/peer-server.ts:3723`; 테스트: `test/server-room-lifecycle.test.ts` › `clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable`; `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`; `test/relay-message-limit.test.ts` › `trims a room's alias and keeps at most its first 256 code points, on creation and on rotation`

**R-ROOM-044** 이전 room에는 다음을 MUST 한다. `rotatedTo = 대체 id`, `expiresAt = rotate 시각`, `roomState = 'rotated'`.
보존 기한은 만료 room과 같은 `metadataRetainUntil`(원래 `expiresAt` + 86400000)이며 rotate가 바꾸지 않는다(R-ROOM-051). 모든 ticket을
`room-rotated`로 종료한다(R-ROOM-048). 그래서 client socket은 `rotatedTo`와 payload `replacementRoomId`·`replacementRoomEpoch`가 든
`room.rotated`(R-SIG-016)를 받고 닫히며, 그 socket의 pending WebSocket 요청과 진행 중인 HTTP MCP 요청은 모두 −32057 `ROOM_ROTATED`,
data `{replacementRoomId, roomId, roomEpoch}`로 끝난다. client socket은 모두 ticket에 묶여 있으므로 이 종료가 room의 client socket을
모두 뗀다. 그다음 provider socket에는 provider용 `room.rotated`(R-SIG-016)를 보내고 닫고 뗀다.\
근거: `src/server/peer-server.ts:3719`, `src/server/peer-server.ts:3726`, `src/server/peer-server.ts:3727`, `src/server/peer-server.ts:3728`, `src/server/peer-server.ts:3733`, `src/server/peer-server.ts:3734`, `src/server/peer-server.ts:3744`, `src/server/peer-server.ts:3745`, `src/server/peer-server.ts:2734`, `src/server/peer-server.ts:2754`, `src/server/peer-server.ts:2875`; 테스트: `test/server-pending-settlement.test.ts` › `answers ROOM_ROTATED with the replacement room when the provider rotates`; `test/server-pending-settlement.test.ts` › `names the replacement room to a WebSocket agent, in its room.rotated and its request's error, as to an HTTP one`; `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`

**R-ROOM-045** rotate는 201 `{...대체 room의 descriptor, rotatedFrom, previousRoomId, previousRoomEpoch, previousState:'rotated',
replacementRoomId, replacementRoomEpoch, rotatedAt(ISO), invalidatedSessionCount}`와, publish rate limit이 있으면(max > 0) 그 할당량의
`X-RateLimit-Limit`·`X-RateLimit-Remaining`(R-ROOM-073)으로 MUST 답한다. `invalidatedSessionCount`는
이전 room이 발급한 ticket 수(`clientTickets.size`, 최대 1)다. relay는 rotate 시각(`Date.now()`) 하나를 이전 room의 `expiresAt`과
`updatedAt`에 쓰지만, 응답의 `rotatedAt`, provider용 `room.rotated`의 `sentAt`과 `payload.rotatedAt`은 각각 그 자리에서
새로 찍은 `new Date()`라서 서로, 그리고 저장한 rotate 시각과 ms 단위로 다를 수 있다(시각 필드의 형식은 R-ROOM-072, R-SIG-025).\
근거: `src/server/peer-server.ts:3746`, `src/server/peer-server.ts:3755`, `src/server/peer-server.ts:3719`, `src/server/peer-server.ts:3727`, `src/server/peer-server.ts:3729`, `src/server/peer-server.ts:3740`, `src/server/peer-server.ts:3741`, `src/server/peer-server.ts:3754`, `src/server/peer-server.ts:3756`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`; `test/server-publish-rate-limit.test.ts` › `spends a unit of the publisher's bucket on every rotation, as on a creation, %s`

**R-ROOM-046** rotate 뒤 이전 room id로 온 요청에 relay는 다음과 같이 MUST 답한다. 모든 수명주기 route는 같은 410 body를
인증보다 먼저 보낸다. `rotatedTo`는 공개 descriptor(R-ROOM-060)에도 있으므로 새로 드러나는 것은 없다. route마다 rotate 검사는
만료 검사보다 앞이다(rotate는 `expiresAt`을 rotate 시각으로 바꾼다, R-ROOM-044).

| 요청 | 응답 |
|---|---|
| join, session status, reclaim, approval, 두 revoke route, rotate | 410 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch, replacementRoomId}` |
| `POST /p/:id/mcp` 중계 method | 410, JSON-RPC −32057 `ROOM_ROTATED`, data `{replacementRoomId, roomId, roomEpoch}` |
| `POST /p/:id/mcp` `initialize` | 200(R-MCP-016), `_meta.roomState:'rotated'`, `roomValid:false` |
| `POST /p/:id/mcp` `tools/list`, `server/discover` | room에 마지막 catalog가 있으면(빈 catalog 포함) 200, `result._meta.roomState:'rotated'`, `roomValid:false`. snapshot에 catalog가 없으면 503 −32090 `CATALOG_UNAVAILABLE`(R-MCP-015) |
| `POST /p/:id/mcp` `ping` | 200 `{jsonrpc:'2.0', id, result:{}}`(`_meta` 없음) |
| `POST /p/:id/mcp` notification(`notifications/initialized` 등 id 없는 metadata method) | 202, 빈 본문(R-MCP-017) |
| `GET /p/:id/mcp` | 200, `state:'rotated'`, `roomValid:false`, `rotatedTo`, 마지막 catalog의 version·hash |
| `GET /p/:id/mcp/tools` | snapshot에 catalog가 있으면 200, `state:'rotated'`, `roomValid:false`, 마지막 catalog. 없으면 503 `CATALOG_UNAVAILABLE`(R-ROOM-063) |
| provider·client WebSocket upgrade | 410 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch, replacementRoomId}`의 R-WS-038 응답(R-WS-004) |

근거: `src/server/peer-server.ts:2126`, `src/server/peer-server.ts:2145`, `src/server/peer-server.ts:3422`, `src/server/peer-server.ts:3557`, `src/server/peer-server.ts:3084`, `src/server/peer-server.ts:3505`, `src/server/peer-server.ts:3618`, `src/server/peer-server.ts:3689`, `src/server/peer-server.ts:3313`, `src/server/peer-server.ts:3305`, `src/server/peer-server.ts:3329`, `src/server/peer-server.ts:3333`, `src/server/peer-server.ts:3198`, `src/server/peer-server.ts:3224`, `src/server/peer-server.ts:3826`, `src/server/peer-server.ts:3965`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`; `test/server-error-model.test.ts` › `answers every lifecycle route of a rotated room with 410 ROOM_ROTATED and its replacement`; `test/server-upgrade.test.ts` › `answers an upgrade to a room that is gone, rotated or expired as the lifecycle routes do`

### 4.12 ticket 종료

**R-ROOM-047** ticket 종료(`closeClientTicket(entry, tokenHash, …)`. ticket은 client token의 SHA-256 hex로 고른다. status는
`rejected`, `revoked`, `room-rotated`, `expired` 중 하나이고, `expired`는 room 만료 처리(R-ROOM-050)만 쓴다. 승인 요청의 만료는
R-ROOM-026이다)는 이전 status와 무관하게 status와 `revokedAt = now`를 정하고 ticket의 pending 승인 요청을 지운다. status의 종료 frame
(`TICKET_END_FRAMES`: `approval.rejected`, `session.revoked`, `room.rotated`, `room.expired`; R-SIG-011, R-SIG-015, R-SIG-016, R-SIG-023)을
하나 만들어, ticket에 묶인 client socket마다 그 socket을 room에서 떼고, 이 frame을 outbox로 보내고, 그 socket의 pending WebSocket 요청을
`ticketClosedRpcError`로 끝낸 뒤 R-WS-037대로 MUST 닫는다(1000). 그다음 그 ticket이 인증한 남은 진행 요청(`PendingMcpRequest.ticket`), 곧 ticket의 socket에
묶이지 않은 HTTP 요청도 같은 오류로 MUST 끝낸다. 오류는 −32054 `CLIENT_APPROVAL_DENIED`(data 없음), −32001 `SESSION_INVALID`(data
없음), −32057 `ROOM_ROTATED` `{replacementRoomId, roomId, roomEpoch}`, −32056 `ROOM_EXPIRED` `{roomId, roomEpoch}`이고 두 transport에서
같다. 각 socket은 outbox에서 기다리던 답을 먼저, 그다음 종료 frame을, 그다음 오류를 받는다(R-WS-037). 이미 provider에 간 요청은 provider에서 실행될 수 있다. relay는 그 답을 기다리지
않고, 늦게 온 답은 pending 항목이 없어 버린다(R-MCP-005). status가 `revoked`이면 같은 `session.revoked`를 room의 provider socket에도
plain `send`로 보내고, 그 뒤 붙는 provider socket을 위해 기억한다(R-SIG-024, R-ROOM-053). 다른 status는 provider socket에 이 frame을 보내지 않는다(거절은 결정 echo가, rotate는 provider용
`room.rotated`가, room 만료는 socket close가 알린다).\
근거: `src/server/peer-server.ts:2725`, `src/server/peer-server.ts:2728`, `src/server/peer-server.ts:2729`, `src/server/peer-server.ts:2731`, `src/server/peer-server.ts:2732`, `src/server/peer-server.ts:2737`, `src/server/peer-server.ts:2757`, `src/server/peer-server.ts:2761`, `src/server/peer-server.ts:2762`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:2765`, `src/server/peer-server.ts:2766`, `src/server/peer-server.ts:2768`, `src/server/peer-server.ts:168`, `src/server/peer-server.ts:2873`, `src/server/peer-server.ts:3397`, `src/server/peer-server.ts:4078`; 테스트: `test/live-demo.e2e.test.ts` › `revoke pushes session.revoked and purges the host credentials`; `test/live-demo.e2e.test.ts` › `a host rejection denies the session`; `test/server-pending-settlement.test.ts` › `names the replacement room to a WebSocket agent, in its room.rotated and its request's error, as to an HTTP one`; `test/server-pending-settlement.test.ts` › `ends a WebSocket agent's request with the ROOM_EXPIRED an HTTP one gets, after a room.expired frame`; `test/server-pending-settlement.test.ts` › `answers SESSION_INVALID when %s alone, as a revoke of every session does`; `test/server-approval-lease.test.ts` › `tells it of %s with session.revoked`; `test/relay-backpressure.test.ts` › `ends the session of an agent that is behind on %s after the replies it asked for, then closes it`

**R-ROOM-048** 전체 revoke(`revokeAllClientTickets`: provider revoke-all은 `revoked`, rotate는 `room-rotated`, room 만료 처리는
`expired`)는 room의 ticket을 R-ROOM-047로 종료해 그 status로 MUST 바꾼다. revoke-all과 rotate는 이전 status와 무관하게 모든 ticket을
덮어쓴다. room 만료는 아직 끝나지 않은 ticket(`pending`, `approved`)만 끝내고, 이미 끝난 ticket(`rejected`, `revoked`, 승인 요청이 만료된
`expired`)의 status와 `revokedAt`은 MUST NOT 바꾼다(R-ROOM-035). 끝난 ticket에는 socket도 진행 요청도 남아 있지 않다. ticket 종료가 그 ticket이
인증한 요청을 모두 끝내고, 그다음 relay는 그래도 남은 pending 요청을 같은 status의 `ticketClosedRpcError`로 끝내고 승인 요청을 비운다.
오류는 rotate면 −32057 `ROOM_ROTATED` `{replacementRoomId, roomId, roomEpoch}`, room 만료면 −32056 `ROOM_EXPIRED` `{roomId, roomEpoch}`,
revoke-all이면 data 없는 −32001 `SESSION_INVALID`다. 그래서 한 종료에서 WebSocket과 HTTP 요청은 같은 오류를 받는다. 단일 revoke
(R-ROOM-039, R-ROOM-040)도 R-ROOM-047로 그 ticket의 HTTP 요청을 끝내므로, room당 ticket이 하나인 지금 단일 revoke와 전체 revoke는
진행 요청에 같은 결과를 낸다.\
근거: `src/server/peer-server.ts:2873`, `src/server/peer-server.ts:2875`, `src/server/peer-server.ts:2877`, `src/server/peer-server.ts:2879`, `src/server/peer-server.ts:2889`, `src/server/peer-server.ts:2890`, `src/server/peer-server.ts:2891`, `src/server/peer-server.ts:2892`, `src/server/peer-server.ts:2896`, `src/server/peer-server.ts:2897`, `src/server/peer-server.ts:2898`; 테스트: `test/server-pending-settlement.test.ts` › `answers SESSION_INVALID when the provider revokes every session`; `test/server-room-lifecycle.test.ts` › `keeps the state and revokedAt of a session %s before its room expired, instead of ending it again with the room`; `test/server-pending-settlement.test.ts` › `answers ROOM_EXPIRED when the sweeper expires the room %s`; `test/server-pending-settlement.test.ts` › `names the replacement room to a WebSocket agent, in its room.rotated and its request's error, as to an HTTP one`; `test/server-pending-settlement.test.ts` › `ends a WebSocket agent's request with the ROOM_EXPIRED an HTTP one gets, after a room.expired frame`; `test/server-pending-settlement.test.ts` › `answers SESSION_INVALID when %s alone, as a revoke of every session does`

### 4.13 room 만료와 sweep

**R-ROOM-049** relay는 `roomSweepIntervalMs`가 0이 아니면 `max(1000, roomSweepIntervalMs ?? 30000)` ms마다(unref timer),
그리고 timer와 별개로 모든 HTTP 요청 시작 때 `cleanupExpiredRooms`를 MUST 돌린다.\
근거: `src/server/peer-server.ts:910`, `src/server/peer-server.ts:913`, `src/server/peer-server.ts:2962`; 테스트: `test/server-room-lifecycle.test.ts` › `arms one timer of max(1000, roomSweepIntervalMs ?? 30000) ms, and none for 0 or NaN`; `test/server-room-lifecycle.test.ts` › `expires a room from its timer without any request, and at the start of an HTTP request without a timer`

**R-ROOM-068** relay는 `roomSweepIntervalMs`가 유한한 수인지 검사하지 않는다. `NaN`이면 `max(1000, NaN)`이 `NaN`이고
`NaN > 0`이 거짓이므로 relay는 sweep timer를 MUST NOT 건다(HTTP 요청 때의 sweep만 돈다). `Infinity`나 2147483647보다 큰 값이면
Node가 interval 지연을 1 ms로 바꾸므로(`TimeoutOverflowWarning`) sweep이 약 1 ms마다 돈다.\
근거: `src/server/peer-server.ts:910`, `src/server/peer-server.ts:911`, `src/server/peer-server.ts:912`, `src/server/peer-server.ts:913`; 테스트: `test/server-room-lifecycle.test.ts` › `arms one timer of max(1000, roomSweepIntervalMs ?? 30000) ms, and none for 0 or NaN`; `test/server-room-lifecycle.test.ts` › `expires a room from its timer without any request, and at the start of an HTTP request without a timer`

**R-ROOM-050** sweep(`cleanupExpiredRooms(now)`)은 `expiresAt <= now`인 room마다 만료 처리(`expireRoom`)를 하고, 그 room의
`metadataRetainUntil <= now`이면 room을 지운다(R-ROOM-051). 만료 처리는 rotate되지 않은 room에 한 번만 MUST 한다. `roomState`가
이미 `expired`이거나 `rotatedTo`가 있으면 아무것도 하지 않는다(rotate가 이미 ticket과 socket을 끝냈다). 처리는 다음과 같다.
`roomState = 'expired'`, `updatedAt = now`. reason `ROOM_EXPIRED`로 아직 끝나지 않은 모든 ticket을 `expired`로 종료한다(R-ROOM-048. 이미 끝난
ticket은 그대로 둔다): ticket의 client
socket마다 `room.expired`(R-SIG-023)를 outbox로 보내고, 그 socket의 pending 요청을 −32056 `ROOM_EXPIRED` `{roomId, roomEpoch}`로 끝내고,
R-WS-037대로 1000으로 닫는다. HTTP 진행 요청도 같은 오류로 끝나고 승인 요청은 비워진다. client socket은 모두 ticket에 묶여 있으므로 이것이 room의
client socket을 모두 뗀다. 그다음 provider socket을 떼고 frame 없이 close code 4002 `ROOM_EXPIRED`로 닫는다(R-WS-030). provider는 이
code로 만료를 알고 다시 붙지 않는다(R-PEER-025). room은 보존 기한까지 남고, 그동안 수명주기
route는 410 `ROOM_EXPIRED`로 답한다(R-ROOM-070). 보존 기한이 지나 지울 room을 그때까지 아무도 만료 처리하지 않았으면(sweep도 요청도
없었던 경우) 지우기 전에 처리한다. sweep 말고 만료를 먼저 발견한 자리도 같은 처리를 한다(R-ROOM-067).\
근거: `src/server/peer-server.ts:2945`, `src/server/peer-server.ts:2947`, `src/server/peer-server.ts:2948`, `src/server/peer-server.ts:2949`, `src/server/peer-server.ts:2916`, `src/server/peer-server.ts:2917`, `src/server/peer-server.ts:2918`, `src/server/peer-server.ts:2919`, `src/server/peer-server.ts:2921`, `src/server/peer-server.ts:2923`, `src/server/peer-server.ts:2924`; 테스트: `test/server-pending-settlement.test.ts` › `answers ROOM_EXPIRED when the sweeper expires the room %s`; `test/server-pending-settlement.test.ts` › `ends a WebSocket agent's request with the ROOM_EXPIRED an HTTP one gets, after a room.expired frame`; `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`; `test/server-upgrade.test.ts` › `closes the provider socket of a room that expires with 4002 ROOM_EXPIRED, and an agent's with 1000 after room.expired`

**R-ROOM-067** relay는 sweep 말고도 room을 보는 다음 자리에서 `expiresAt <= now`인 room을 찾으면 그 자리의 동작보다 먼저
R-ROOM-050의 만료 처리를 MUST 한다(`expireRoomIfDue`. 이미 처리했거나 rotate된 room이면 아무것도 하지 않는다).

- 수명주기 route의 room 검사(`checkLifecycleRoom`: join, reclaim, approval, 두 revoke route, rotate. body 전과 뒤 모두)
- `POST /p/:id/mcp`의 중계 method 만료 검사(R-MCP-013)
- ticket 해석(`resolveClientTicket`: bearer가 있는 `POST /p/:id/mcp`, client revoke, client upgrade). 그래서 해석한 ticket은 `expired`다
- provider·client upgrade의 room 검사(R-WS-004)
- room에 붙어 있는 provider·client socket이 보낸 frame(R-ROOM-055, R-ROOM-057)
- 기다리던 register 평가(R-CAT-013)

그래서 sweep이 돌기 전(body가 오는 사이, sweep timer 사이, sweep을 돌리지 않는 upgrade) 다른 자리가 만료를 먼저 발견해도, agent는
sweep이 처리할 때와 같은 신호(`room.expired`, −32056 `ROOM_EXPIRED`)를 받고 진행 중인 HTTP 요청도 `ROOM_EXPIRED`로 끝난다. 뒤의
sweep은 처리한 room을 다시 처리하지 않는다. session status와 GET route는 body가 없어 요청 시작의 sweep이 이미 처리한 room을 읽을
뿐이다. body를 다 읽은 뒤 bearer 없이 온 metadata method(`POST /p/:id/mcp`)는 처리하지 않고 `_meta.roomState:'expired'`로
보고한다(그 room은 다음 sweep이나 위의 자리에서 처리된다).\
근거: `src/server/peer-server.ts:2933`, `src/server/peer-server.ts:2934`, `src/server/peer-server.ts:2935`, `src/server/peer-server.ts:2146`, `src/server/peer-server.ts:3317`, `src/server/peer-server.ts:2417`, `src/server/peer-server.ts:3826`, `src/server/peer-server.ts:3965`, `src/server/peer-server.ts:3846`, `src/server/peer-server.ts:3983`, `src/server/peer-server.ts:1681`, `src/server/peer-server.ts:2917`; 테스트: `test/server-pending-settlement.test.ts` › `carries out the room's expiry where it is found first, not only at the sweep: %s`

**R-ROOM-051** 만료 room과 rotate된 room은 같은 보존 기한 `metadataRetainUntil`(원래 `expiresAt` + 86400000, R-LIM-028)까지
MUST 남는다. rotate는 이 기한을 바꾸지 않으므로(R-LIM-029) rotate된 room은 그때까지 모든 수명주기 route에 410 `ROOM_ROTATED`와
`replacementRoomId`(R-ROOM-046)로, 만료 room은 410 `ROOM_EXPIRED`(R-ROOM-070)로 답한다. sweep은 `metadataRetainUntil <= now`인
room을 지우고, 지워진 room id에는 모든 수명주기 route와 session status가 404 `ROOM_NOT_FOUND`로 MUST 답한다.\
근거: `src/server/peer-server.ts:1023`, `src/server/peer-server.ts:2949`, `src/server/peer-server.ts:3726`, `src/server/peer-server.ts:3727`, `src/server/peer-server.ts:2144`, `src/server/types.ts:118`; 테스트: `test/server-room-lifecycle.test.ts` › `retains a rotated room, answering 410 ROOM_ROTATED with its replacement, until a day after its original expiry`; `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`

**R-ROOM-070** 보존 중인 만료 room(`expiresAt <= now`, rotate되지 않음)의 id로 온 요청에 relay는 다음과 같이 MUST 답한다.
수명주기 route는 같은 410 body(`sendRoomExpired`)를 인증과 body 자격보다 먼저 보내고(rotate 검사가 그보다 먼저다, R-ROOM-046),
아직 만료 처리하지 않은 room이면 그 처리를 한다(R-ROOM-067). 그래서 agent와 provider는 만료(410)를 미존재(404 `ROOM_NOT_FOUND`,
R-ROOM-051)와, room 만료(`ROOM_EXPIRED`)를 살아 있는 room의 lease 만료(`ROOM_LEASE_EXPIRED`, R-ROOM-014)와 구별한다.

| 요청 | 응답 |
|---|---|
| join, reclaim, approval, 두 revoke route, rotate | 410 `{error:'ROOM_EXPIRED', code:-32056, roomId, roomEpoch}` |
| session status | 200, `state:'expired'`(R-ROOM-035) |
| `POST /p/:id/mcp` 중계 method | 410, JSON-RPC −32056 `ROOM_EXPIRED`, data `{roomId, roomEpoch}`(R-MCP-013) |
| `POST /p/:id/mcp` metadata method | R-MCP-016~R-MCP-019대로 답하고, `_meta`가 있는 답은 `roomState:'expired'`, `roomValid:false` |
| `GET /p/:id/mcp`, `GET /p/:id/mcp/tools` | `state:'expired'`, `roomValid:false`(R-ROOM-060, R-ROOM-063) |
| provider·client WebSocket upgrade | 410 `{error:'ROOM_EXPIRED', code:-32056, roomId, roomEpoch}`의 R-WS-038 응답(R-WS-004) |

근거: `src/server/peer-server.ts:2131`, `src/server/peer-server.ts:2132`, `src/server/peer-server.ts:2146`, `src/server/peer-server.ts:2162`, `src/server/peer-server.ts:3084`, `src/server/peer-server.ts:3422`, `src/server/peer-server.ts:3317`, `src/server/peer-server.ts:3318`, `src/server/peer-server.ts:3586`; 테스트: `test/server-room-lifecycle.test.ts` › `answers every lifecycle route of an expired room 410 ROOM_EXPIRED while it is retained, and 404 once it is deleted`; `test/server-error-model.test.ts` › `puts the code of an error's JSON-RPC namesake in its lifecycle body`; `test/server-upgrade.test.ts` › `answers an upgrade to a room that is gone, rotated or expired as the lifecycle routes do`

### 4.14 provider socket (`/p/{roomId}/provider`) 부착

**R-ROOM-052** R-WS-001~R-WS-012를 통과한 provider socket에 relay는 먼저 `ready`(R-SIG-006)를 MUST 보낸다. 그 `send`가
`sent`가 아니면 socket을 닫고 붙이지 않는다. 그래서 죽은 upgrade는 살아 있는 provider를 밀어내지 못한다. 그다음 다른
provider socket이 붙어 있으면 그것을 분리한다: `providerSocket`을 비우고, room의 모든 pending 요청(어느 agent의 WebSocket이든
HTTP든)을 −32001 `PROVIDER_DISCONNECTED`로 끝내고, frame 없이 4001 `SUPERSEDED`로 닫는다(밀려난 provider는 다시 붙지 않는다,
R-WS-030). 새 socket을 붙이고, socket이 붙어 있는 동안 reconnect lease가
만료되지 않도록 `reconnectLeaseExpiresAt = expiresAt`으로 두고(R-ROOM-018), `roomState`를 정한 뒤(R-ROOM-003) client 상태 replay(R-ROOM-053)를
한다. room에는 provider socket이 하나뿐이다.\
근거: `src/server/peer-server.ts:3942`, `src/server/peer-server.ts:3945`, `src/server/peer-server.ts:3951`, `src/server/peer-server.ts:3952`, `src/server/peer-server.ts:3955`, `src/server/peer-server.ts:3956`, `src/server/peer-server.ts:3958`, `src/server/peer-server.ts:1506`, `src/server/peer-server.ts:1512`, `src/server/peer-server.ts:1852`; 테스트: `test/relay-message-limit.test.ts` › `does not let a dead provider upgrade displace the attached provider`; `test/relay-message-limit.test.ts` › `closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on`

**R-ROOM-053** provider가 (다시) 붙으면 relay는 `ready` 바로 뒤에 room의 client 상태를 MUST replay한다. room이 살아 있는 동안
끝난 ticket(승인 요청의 거절·만료, revoke)마다 그 끝을 provider에 알린 frame(결정 echo `approval.rejected`, `approval.expired`,
`session.revoked`, R-SIG-024)을 새 `messageId`로 다시 보낸다. 그래서 그 끝을 듣지 못한 provider(socket이 없는 동안 끝났거나 plain
`send`가 사라졌다, R-WS-034)도 다시 붙으면 session을 끝내고 room lease를 지운다(R-PEER-021). `approvalRequired` room에서는 그 밖에
`expiresAt > now`인 approved ticket마다 `approval.restored`(R-SIG-014, 전송 결과를 보지 않는다)를, pending ticket마다 그 승인
요청(R-ROOM-025)을 보낸다. 순서는 끝난 ticket은 `revokedAt`, approved는 `approvedAt ?? issuedAt`, pending은 요청의 `createdAt ?? now`
기준 오름차순이다. approved ticket을 하나라도 replay하면 `roomState = 'active'`다. `approvalRequired: false` room은 끝난 ticket만
replay하고, 끝을 알린 frame이 없는 ticket(`expiresAt`이 지난 approved ticket)은 replay하지 않는다. 끝난 ticket이 있으면 relay는
그 앞의 `ready`에 이 순서로 처음 replay할 끝 frame의 type을 `ticketEnded`로 MUST 담는다(R-SIG-006). 그래서 provider는 `ready` 뒤의
frame을 언제 읽든(브라우저는 message마다 따로 처리한다) `ready`에서 그 room이 agent를 받지 않는다는 것을 알고, 다시 붙은 것을 살아 있는
session으로 받지 않는다(R-PEER-004).\
근거: `src/server/peer-server.ts:2653`, `src/server/peer-server.ts:2657`, `src/server/peer-server.ts:2659`, `src/server/peer-server.ts:2660`, `src/server/peer-server.ts:2662`, `src/server/peer-server.ts:2664`, `src/server/peer-server.ts:2669`, `src/server/peer-server.ts:2692`, `src/server/peer-server.ts:2696`, `src/server/peer-server.ts:2701`, `src/server/peer-server.ts:2577`, `src/server/peer-server.ts:2680`, `src/server/peer-server.ts:2681`, `src/server/peer-server.ts:3940`, `src/server/peer-server.ts:3943`; 테스트: `test/server-provider-reattach.test.ts` › `re-sends a pending request and restores no expired or approval-free ticket`; `test/server-provider-reattach.test.ts` › `tells a provider socket that attaches after %s how the ticket ended, every time one attaches`; `test/server-provider-reattach.test.ts` › `replays several tickets in the order they were requested or approved`; `test/server-provider-reattach.test.ts` › `takes the room down and forgets its lease when the host reattaches after %s while its socket was away`; `test/server-provider-reattach.test.ts` › `fails a reloaded page's reconnect to a room whose ticket ended while the page was away (%s), with the session ended`

**R-ROOM-054** 붙어 있는 provider socket이 닫히면 relay는 그 socket이 남긴 평가 대기 register frame을 버리고,
`providerSocket`을 비우고, reconnect lease의 유예를 시작하고(R-ROOM-018), room의 모든 pending 요청을 −32001 `PROVIDER_DISCONNECTED`로
MUST 끝낸다. answer를 기다리던 offer는 `offer.refused` `PROVIDER_DISCONNECTED`로 끝내고 answer를 받은 offer의 경로는 잊는다(R-SIG-026).
relay가 provider socket을 떼는 분리(`detachClosedProvider`)도 같다. agent socket은 열어 두며 provider 존재에 관한 frame을 보내지 않는다
(`providerConnected`는 HTTP descriptor로만 보인다). `roomState`는 바뀌지 않는다.\
근거: `src/server/peer-server.ts:3925`, `src/server/peer-server.ts:3926`, `src/server/peer-server.ts:3927`, `src/server/peer-server.ts:3929`, `src/server/peer-server.ts:3930`, `src/server/peer-server.ts:1854`, `src/server/peer-server.ts:1485`; 테스트: `test/server-provider-reattach.test.ts` › `keeps an approved agent working after the provider socket drops and the host reclaims the room`; `test/server-signaling-frames.test.ts` › `refuses an offer still waiting for an answer with PROVIDER_DISCONNECTED when the provider socket goes away`

**R-ROOM-055** provider socket의 frame 처리기는 그 socket이 room에 붙어 있는 provider socket이 아니면 frame을 처리하지 않고 그
socket을 4001 `SUPERSEDED`로 MUST 닫는다. 붙어 있는 socket의 frame이 만료된 room(`expiresAt <= now`)을 찾으면 frame을 처리하지 않고 room의 만료
처리(R-ROOM-067, R-ROOM-050)를 MUST 한다. 그 처리가 ticket을 끝내 agent에게 `room.expired`와 `ROOM_EXPIRED`를 보내고 이 socket을 떼고
닫는다. relay는 provider socket을 room에서 뗄 때(교체·분리, rotate, 만료 처리, `ready` 전송 실패) 언제나 먼저 닫으므로, 뗀 socket이 보낸
frame은 codec이 버려(R-WS-027) 이 처리기에 닿지 않으므로 첫 검사는 방어용이다. 어느 경우든 늦은 답이나 register는
처리하지 않는다.\
근거: `src/server/peer-server.ts:3842`, `src/server/peer-server.ts:3843`, `src/server/peer-server.ts:3846`, `src/server/peer-server.ts:1512`, `src/server/peer-server.ts:3945`, `src/server/peer-server.ts:2924`, `src/server/peer-server.ts:3744`, `src/server/peer-server.ts:3927`, `src/server/ws-upgrade.ts:759`; 테스트: `test/relay-message-limit.test.ts` › `closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on`; `test/server-pending-settlement.test.ts` › `carries out the room's expiry where it is found first, not only at the sweep: %s`

### 4.15 client socket (`/p/{roomId}/client`) 부착

**R-ROOM-056** R-WS-001~R-WS-012를 통과한 client socket에 relay는 다음을 순서대로 MUST 한다. `AgentOutbox`를 만든다.
`ready`(R-SIG-006)를 plain `send`로 보내고, `sent`가 아니면 닫고 붙이지 않는다. 같은 ticket에 묶인 socket 중 부착 순서로 가장
오래된 것들을 새 socket을 포함해 4개(`MAX_CLIENT_SOCKETS_PER_TICKET`)가 넘지 않도록 frame 없이 4001 `SUPERSEDED`로 닫고(session은 새
socket에서 이어지므로 agent는 밀려난 socket을 다시 붙이지 않는다, R-WS-030) room에서 빼며, 그 pending 요청은 오류 없이 버린다. 그 요청을
보낸 `PeerMcpSession`은 transport close로 `TRANSPORT_CLOSED` `{code:4001}`을 받는다(R-PEER-045). 새 socket을 room과 ticket에 묶는다. ticket이 pending이면 승인 요청을 provider에 전달하고(R-ROOM-025)
이 socket에 outbox로 `approval.pending`(R-SIG-013)을 보낸다.\
근거: `src/server/peer-server.ts:4108`, `src/server/peer-server.ts:4112`, `src/server/peer-server.ts:4113`, `src/server/peer-server.ts:4119`, `src/server/peer-server.ts:4122`, `src/server/peer-server.ts:4124`, `src/server/peer-server.ts:4126`, `src/server/peer-server.ts:4128`; 테스트: `test/relay-message-limit.test.ts` › `holds at most 4 client sockets per ticket, closing the oldest for a new one`; `test/relay-message-limit.test.ts` › `does not attach a client socket whose client went away while a customUpgradeHandler was awaiting`; `test/client-session.test.ts` › `rejects a request in flight with TRANSPORT_CLOSED, whose details carry the close code`

**R-ROOM-057** client socket의 frame 처리기는 다음 순서로 MUST 검사한다. 그 socket이 room의 client socket 목록에 없으면 frame을
처리하지 않고 `closeAgentSocket`으로 닫는다(session이 끝나 닫히는 중인 socket이면 닫기를 그대로 이어 간다, R-WS-037). room이
만료됐으면(`expiresAt <= now`) frame을 처리하지 않고 room의 만료 처리(R-ROOM-067, R-ROOM-050)를 한다. 이 socket도 `room.expired`를 받고
pending 요청이 `ROOM_EXPIRED`로 끝난 뒤 닫힌다. ticket이 만료됐으면(`ticket.expiresAt <= now`) 4002 `ROOM_EXPIRED`로 닫는다(ticket의 만료는 room의
원래 만료이고 rotate는 socket을 남기지 않으므로 방어용이다). ticket당 socket 상한으로 뺀 socket과 `ready` 전송에 실패한 socket은 relay가
먼저 닫으므로 그 frame은 codec이 버려(R-WS-027) 이 처리기에 닿지 않는다. session이 끝나 뺀 socket(ticket 종료, 승인 만료, rotate, 만료
처리)은 기다리던 frame이 나갈 때까지 열려 있지만, 그동안 relay는 그 socket을 멈추고 codec은 이미 읽은 read의 frame도 처리하지 않으며
(R-WS-031, R-WS-040), 기다리는 frame이 없으면 바로 닫는다. 그래서 이 처리기에 그런 socket의 frame은 닿지 않고, 닿더라도 처리하지 않는다.\
근거: `src/server/peer-server.ts:3979`, `src/server/peer-server.ts:3980`, `src/server/peer-server.ts:3983`, `src/server/peer-server.ts:3985`, `src/server/peer-server.ts:3986`, `src/server/peer-server.ts:2561`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:4112`, `src/server/peer-server.ts:4122`, `src/server/peer-server.ts:693`, `src/server/ws-upgrade.ts:762`; 테스트: `test/server-pending-settlement.test.ts` › `carries out the room's expiry where it is found first, not only at the sweep: %s`; `test/relay-backpressure.test.ts` › `ends the session of an agent that is behind on %s after the replies it asked for, then closes it`

**R-ROOM-058** client socket이 닫히면 relay는 그 outbox에서 기다리던 frame을 버리고, room과 ticket 묶음에서 빼고, 그 socket이
전달한 offer의 경로를 잊고(늦은 `answer`·`release`는 버린다), 그 socket의 pending 요청을 답 없이 MUST 지운다. 이후 provider의 답은
버린다. room과 provider는 영향받지 않는다.\
근거: `src/server/peer-server.ts:4101`, `src/server/peer-server.ts:4102`, `src/server/peer-server.ts:4103`, `src/server/peer-server.ts:4104`, `src/server/peer-server.ts:1442`; 테스트: `test/relay-backpressure.test.ts` › `drops the replies waiting for an agent that goes away, and keeps the room serving`

### 4.16 `GET /p/:id/mcp`, `DELETE /p/:id/mcp`, `GET /p/:id/mcp/tools`, `GET /mcp/catalog`

**R-ROOM-059** `GET /p/:id/mcp`의 `Accept`(소문자로)가 `text/event-stream`을 포함하고 `application/json`을 포함하지 않으면
relay는 room 조회 전에 405, `Allow: GET, POST`(endpoint의 method, R-HTTP-022), `Cache-Control: no-store`,
`{jsonrpc:'2.0', id:null, error:{code:-32000, message:'SSE_STREAM_NOT_SUPPORTED'}}`로 MUST 답한다. 다른 `Accept`(없음 포함)는 descriptor를
받는다. 응답이 `Accept`에 따라 갈리므로 descriptor는 `Vary`에 `Accept`를 넣는다(R-ROOM-061).\
근거: `src/server/peer-server.ts:1204`, `src/server/peer-server.ts:3160`, `src/server/peer-server.ts:3166`; 테스트: `test/mcp-http-interop.test.ts` › `refuses the optional SSE GET with 405 while plain GETs keep returning the descriptor`; `test/server-http-security.test.ts` › `answers a method a route does not take with 405 and the methods it does`; `test/mcp-http-interop.test.ts` › `answers the SSE GET and DELETE with a JSON-RPC error of id null that is never cached`

**R-ROOM-060** `GET /p/:id/mcp`는 인증 없이, 문법에 맞는 모든 id(모르는 id 포함)에 200
`{roomId, roomEpoch(모르면 0), alias(모르면 'unknown-room'), protocol:'webmcp-peer.v1'(WEBMCP_SUBPROTOCOL), status, state(둘 다 mcpRoomState),
roomValid(entry가 있고 rotate되지 않았고 expiresAt > now), expiresAt(epoch ms 또는 null), catalogVersion, catalogHash,
toolCount, catalogUpdatedAt, providerConnected, approvalRequired(기본 true), auth, pendingApprovalCount,
activeClientCount(approved ticket 수), rotatedTo(또는 null)}`로 MUST 답한다. catalog 필드는 R-CAT-005의 snapshot이다.\
근거: `src/server/peer-server.ts:3174`, `src/server/peer-server.ts:3180`, `src/server/peer-server.ts:3184`, `src/server/peer-server.ts:3193`, `src/server/peer-server.ts:3197`; 테스트: `test/mcp-http-interop.test.ts` › `refuses the optional SSE GET with 405 while plain GETs keep returning the descriptor`; `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`; `test/relay-message-limit.test.ts` › `does not attach a provider socket whose client went away (%s) while a customUpgradeHandler was awaiting`

**R-ROOM-061** `GET /p/:id/mcp`와 200인 `GET /p/:id/mcp/tools`는 `Cache-Control: public, max-age=5, s-maxage=30,
stale-while-revalidate=60, stale-if-error=300`, `ETag: "mcp-descriptor-<응답 본문 JSON의 SHA-256 hex>"`, `X-MCP-Catalog-Version`,
`X-MCP-Catalog-Hash`를 MUST 보낸다. `Vary`는 `GET /p/:id/mcp`가 `Origin, Accept, Accept-Encoding`(`DESCRIPTOR_VARY`), `GET /p/:id/mcp/tools`가
`Origin, Accept-Encoding`이고 304(R-HTTP-014)도 같은 `Vary`다. descriptor는 SSE만 받는 `Accept`에 405를 주므로(R-ROOM-059) `Accept`가
`Vary`에 없으면 공유 cache가 cache한 200을 SSE 요청에 돌려줄 수 있고(RFC 9110 §12.5.5, RFC 9111 §4.1), MCP SDK는 그것을 끝난 stream으로
보고 다시 접속하기를 되풀이한다. ETag는 본문 전체에서 나오므로 state, providerConnected, 승인 수가 바뀌어도 바뀐다. 조건부 GET은
R-HTTP-014다.\
근거: `src/server/peer-server.ts:789`, `src/server/peer-server.ts:1883`, `src/server/peer-server.ts:1891`, `src/server/peer-server.ts:1892`, `src/server/peer-server.ts:1895`, `src/server/peer-server.ts:3201`, `src/server/peer-server.ts:3231`; 테스트: `test/server-http-security.test.ts` › `names Origin in the Vary of every response, the descriptor's also Accept`; `test/server-http-security.test.ts` › `answers a conditional GET whose If-None-Match names the ETag with 304 and the route's cache headers`

**R-ROOM-062** `DELETE /p/:id/mcp`에는 405, `Allow: GET, POST`(endpoint의 다른 405와 같다, R-HTTP-022), `{jsonrpc:'2.0', id:null, error:{code:-32000,
message:'SESSION_TERMINATION_NOT_SUPPORTED'}}`로 MUST 답한다. preflight가 `DELETE`를 허용하므로(R-HTTP-010) browser client도 이 405를 받는다. relay는 `Mcp-Session-Id`를 발급하지도 읽지도 않는다.\
근거: `src/server/peer-server.ts:3169`, `src/server/peer-server.ts:3171`; 테스트: `test/mcp-http-interop.test.ts` › `answers DELETE with 405 because the relay issues no session`; `test/mcp-http-interop.test.ts` › `answers the SSE GET and DELETE with a JSON-RPC error of id null that is never cached`

**R-ROOM-063** `GET /p/:id/mcp/tools`는 R-CAT-005 snapshot을 쓴다(모르는 id도 deployment catalog, state `unknown`). snapshot이
`available`이 아니면 503 `{error:'CATALOG_UNAVAILABLE', code:-32090, catalogVersion:<snapshot의 값, 이때 언제나 0>, catalogHash, auth}`,
`Cache-Control: no-store`, ETag 없음이다. provider가 등록한 빈 catalog는 catalog이므로 200 `tools: []`다. 아니면 200 `{roomId, tools, catalogVersion, catalogHash, updatedAt, state, roomValid,
providerConnected, auth}`와 R-ROOM-061 header다. 보존 중인 rotate·만료 room은 `roomValid: false`로 마지막 catalog를 계속
MUST 준다.\
근거: `src/server/peer-server.ts:3206`, `src/server/peer-server.ts:3212`, `src/server/peer-server.ts:3223`, `src/server/peer-server.ts:3224`, `src/server/peer-server.ts:3225`, `src/server/peer-server.ts:3230`; 테스트: `test/server-catalog-hash.test.ts` › `stamps a provider-registered catalog with the same hash as the deployment catalog`; `test/server-error-model.test.ts` › `puts the code of an error's JSON-RPC namesake in its lifecycle body`; `test/server-mcp-routing.test.ts` › `is listed as tools: [] on every route, not as CATALOG_UNAVAILABLE`

**R-ROOM-064** `GET /mcp/catalog`와 `GET /mcp/catalog/<64 소문자 hex>`는 room과 무관하게 deployment catalog를 MUST 준다.
deployment catalog가 없으면(snapshot이 `available`이 아니면) 503 `{error:'CATALOG_UNAVAILABLE', code:-32090, catalogVersion:<snapshot의 값, 0>,
catalogHash}`. hash가 현재 것이 아니면 404
`{error:'CATALOG_HASH_NOT_FOUND', catalogHash:<현재>}`. 아니면 200 `{protocol:'webmcp-peer.v1'(WEBMCP_SUBPROTOCOL), source('deployment'·
'injected'), tools, catalogVersion, catalogHash, catalogUrl:'/mcp/catalog/<hash>'(상대 경로), updatedAt, auth}`다.
`/mcp/catalog`는 `Cache-Control: public, max-age=30, s-maxage=300, stale-while-revalidate=60, stale-if-error=600`,
`ETag: "mcp-catalog-<version>-<hash>"`, hash URL은 `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`,
`CDN-Cache-Control: public, max-age=31536000, immutable`, `ETag: "mcp-deployment-catalog-<version>-<hash>"`다. 둘 다
`X-MCP-Catalog-Version`, `X-MCP-Catalog-Hash`, `Vary: Origin, Accept-Encoding`을 보낸다.\
근거: `src/server/peer-server.ts:420`, `src/server/peer-server.ts:3132`, `src/server/peer-server.ts:3135`, `src/server/peer-server.ts:3140`, `src/server/peer-server.ts:3143`, `src/server/peer-server.ts:1857`, `src/server/peer-server.ts:1867`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/server-error-model.test.ts` › `puts the code of an error's JSON-RPC namesake in its lifecycle body`; `test/server-http-security.test.ts` › `answers a conditional GET whose If-None-Match names the ETag with 304 and the route's cache headers`

**R-ROOM-065** descriptor·catalog 응답의 `auth`는 MUST `{discovery:'public', execution:'client-ticket-and-approval',
clientTokenRequired:true, approvalRequired: entry?.approvalRequired ?? true, state}`이다. GET route의 `state`는 언제나
`not-joined`이고, MCP POST에서는 bearer ticket의 status, 없으면 `not-joined`다. relay가 답하는 WebSocket metadata(R-MCP-036)에서는 socket
ticket의 status다. 그래서 session status가 보고하지 않는 ticket status
`room-rotated`(rotate된 room의 session status는 410이다, R-ROOM-032)도 rotate된 room에 bearer로 보낸 metadata method의
`_meta.auth.state`에는 나온다. 이 값은 내부 상태가 아니라 wire 값이다.\
근거: `src/server/peer-server.ts:1966`, `src/server/peer-server.ts:3195`, `src/server/peer-server.ts:3301`, `src/server/peer-server.ts:1806`, `src/server/peer-server.ts:1815`, `src/server/types.ts:15`; 테스트: `test/server-mcp-routing.test.ts` › `gives a ticket waiting for approval the relay's public discovery, as the HTTP route does`

`POST /p/:id/mcp`는 7장에서 다룬다.

### 4.17 relay 종료

**R-ROOM-066** `WebMcpPeerServer.close()`는 모든 pending 요청을 `PROVIDER_DISCONNECTED`로 끝내고, 요청 timer를 지우고,
모든 provider·client socket(session이 끝나 닫히는 중인 agent socket 포함)을 1001(Going Away)로 닫고, room을 비우고 HTTP server를 MUST
닫는다. 1001은 relay가 사라진다는 뜻이므로 provider는 다른 relay 실행에 다시 붙을 수 있다(R-WS-030). close를 무시하는 peer는 5000 ms 뒤
파기되므로 종료가 끝난다.\
근거: `src/server/peer-server.ts:961`, `src/server/peer-server.ts:965`, `src/server/peer-server.ts:969`, `src/server/peer-server.ts:970`, `src/server/peer-server.ts:972`, `src/server/peer-server.ts:973`, `src/server/peer-server.ts:975`; 테스트: `test/server-ws-frames.test.ts` › `closes within the close timeout while a provider ignores the relay's close`

## 5. signaling frame

모든 signaling frame은 WebSocket text message 하나에 담긴 JSON object다. 아래 표의 "방향"은 P(provider), R(relay),
A(agent client socket)로 적는다.

| type | 방향 | 절 |
|---|---|---|
| `ready` | R→P, R→A | 5.2 |
| `ping`, `pong` | P→R→P, A→R→A, A→R(버림) | 5.3 |
| `approval.request` | R→P | 5.4 |
| `approval.decision` | P→R | 5.5 |
| `approval.approved` | R→A, R→P(echo) | 5.6 |
| `approval.rejected` | R→A, R→P(echo) | 5.7 |
| `approval.expired` | R→A, R→P | 5.8 |
| `approval.pending` | R→A | 5.9 |
| `approval.restored` | R→P | 5.10 |
| `session.revoked` | R→A, R→P | 5.11 |
| `room.expired` | R→A | 5.11 |
| `room.rotated` | R→P, R→A | 5.12 |
| `offer` | A→R→P | 5.13 |
| `offer.refused` | R→A | 5.14 |
| `answer`, `release` | P→R→A(offer를 보낸 socket) | 5.15 |
| `register` | P→R, R→A(announcement) | 5.16, 6장 |
| `error` | R→P | 5.17 |
| `mcp` | A→R→P, P→R→A | 5.18, 7장 |

### 5.1 공통 규칙

**R-SIG-001** relay는 provider·client socket에서 받은 완성 text message를 `JSON.parse`하고 `PeerFrameSchema`(null이나 배열이
아닌 object, 문자열 `type`)로 MUST 검사한다. 그 밖(잘못된 JSON, 수, 배열, null, `type` 없음·문자열 아님)은 답하지 않고
socket을 닫지 않고 broadcast하지도 않고 무시한다. frame 처리 중 예외도 삼킨다. relay는 `JSON.parse` 전에 text 맨 앞의 U+FEFF(BOM)
하나를 MUST 지운다(`withoutByteOrderMark`, RFC 8259 §8.1의 MAY). 그래서 BOM으로 시작하는 frame도 BOM이 없는 frame처럼 처리되고, 두 번째 BOM은
JSON 공백이 아니므로 잘못된 JSON이다. MCP POST body(R-MCP-009)와 JSON body route(R-HTTP-008)도 같은 규칙이다. provider도 relay frame에 같은
모양 규칙(`ProviderFrameSchema`)을 MUST 적용하고, 문자열이 아닌 data를 포함해 나머지는 무시한다.\
근거: `src/server/wire-schemas.ts:23`, `src/server/wire-schemas.ts:36`, `src/server/peer-server.ts:373`, `src/server/peer-server.ts:374`, `src/server/peer-server.ts:3847`, `src/server/peer-server.ts:3923`, `src/server/peer-server.ts:3989`, `src/server/peer-server.ts:3990`, `src/server/peer-server.ts:4098`, `src/provider/wire-schemas.ts:16`, `src/provider/peer-client.ts:190`; 테스트: `test/server-signaling-frames.test.ts` › `ignores provider frames that are not typed JSON objects instead of broadcasting them`; `test/server-byte-order-mark.test.ts` › `is ignored in an agent's socket frame, whose request is answered`; `test/server-byte-order-mark.test.ts` › `is ignored in a provider's socket frame, whose catalog the relay takes`

**R-SIG-002** relay control frame(`approval.request`, `approval.pending`, `approval.approved`, `approval.rejected`, `approval.expired`,
`approval.restored`, `session.revoked`, `room.rotated`, `room.expired`)과 승인 결정 echo(R-SIG-009)는 `protocol:'webmcp-peer/1'`
(`WEBMCP_PROTOCOL`), `messageId`, `type`, `roomId`, `roomEpoch`, `sentAt`(ISO)을 MUST 가진다. `approval.pending`과 `approval.expired`를 뺀
control frame과 echo는 `payload`도 가진다. `messageId`는 message마다 새로 만드는 불투명한 고유 문자열이다(R-SIG-025). 그 밖의 relay
frame에는 이 envelope이 없다: `ready`에는 `protocol`·`messageId`·`sentAt`·`payload`가 없고, `pong`(`{type, timestamp}`),
`offer.refused`(`{type, requestId?, error}`), provider에 가는 `error`(`{type, code, message}`에 `reason`·`limitBytes`·`registerSeq`·
`requestId` 중 해당하는 것, R-SIG-021)에는 `roomId`·`roomEpoch`도 없다.\
근거: `src/server/peer-server.ts:2593`, `src/server/peer-server.ts:2476`, `src/server/peer-server.ts:2546`, `src/server/peer-server.ts:2624`, `src/server/peer-server.ts:2737`, `src/server/peer-server.ts:2797`, `src/server/peer-server.ts:2864`, `src/server/peer-server.ts:2865`, `src/server/peer-server.ts:3734`, `src/server/peer-server.ts:1529`, `src/server/peer-server.ts:3853`, `src/server/peer-server.ts:1399`, `src/server/peer-server.ts:1419`, `src/server/peer-server.ts:1707`, `src/server/peer-server.ts:1709`, `src/server/peer-server.ts:3868`; 테스트: `test/server-provider-reattach.test.ts` › `restores an approved ticket to the new socket with an approval.restored frame`; `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`; `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`

**R-SIG-003** agent socket이 보낸 frame 중 relay가 다루는 type은 `mcp`(7장), `ping`(5.3), `offer`(5.13, approved ticket만)
뿐이다(`CLIENT_SIGNALING_FRAME_TYPES = {'offer'}`). 그 밖의 type — `ice`, `answer`, `release`, `register`, `ready`, `error`,
`pong`, `approval.*`, `session.*`, `room.*` 등 — 과 approved가 아닌 ticket의 `offer`는 답 없이 MUST 버린다. 그래서 agent는
relay control frame을 provider에 주입할 수 없다. protocol에는 trickle ICE가 없다: agent는 ICE 수집을 마친 SDP를 offer에 담고 provider도
그런 answer를 보내며(R-PEER-022), `ice` frame은 어느 방향으로도 전달되지 않는다(provider 쪽은 R-SIG-004).\
근거: `src/server/peer-server.ts:149`, `src/server/peer-server.ts:4096`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`

**R-SIG-004** provider frame 가운데 relay가 스스로 처리하는 것(`ping`, `approval.decision`, `register`, JSON-RPC 답을 담은 `mcp`)
밖에서 agent에게 가는 것은 다음 둘뿐이다(allow-list). JSON-RPC notification이나 server→client 요청(`jsonrpc:'2.0'`과 문자열 `method`)을
담은 `mcp` frame은 stamp 없이 수정하지 않고 room의 approved ticket에 묶인 client socket마다 MUST broadcast(R-WS-032)한다. pending ticket의
socket은 받지 않는다. 다만 method가 `notifications/tools/list_changed`인 것은 MUST 버린다. 그 notification은 relay가 받아들인 catalog를
그 `catalogVersion`·`catalogHash`와 함께 알리는 relay의 것이고(R-CAT-008), provider는 catalog를 `register`로 알린다(R-CAT-006). `answer`와 `release`(`PROVIDER_SIGNALING_FRAME_TYPES`)는 그것이 이름 짓는 offer를 보낸 socket 하나에만 간다
(R-SIG-019). 그 밖의 provider frame — relay 전용 type(`ready`, `error`, `pong`, `session.*`, `room.*`, `approval.*`, `offer.refused`),
`ice`, 모르는 type, JSON-RPC message가 없는 `mcp` — 은 답 없이 MUST 버린다. 그래서 agent client socket의 frame 경계(R-SIG-003)처럼 provider도
relay control frame을 agent에게 주입할 수 없고, agent에게 session의 상태(`ready`의 `sessionId`, 승인, 종료)를 알리는 것은 relay뿐이다.
답은 맞출 요청이 없으면 버린다(R-MCP-002).\
근거: `src/server/peer-server.ts:3852`, `src/server/peer-server.ts:3856`, `src/server/peer-server.ts:3883`, `src/server/peer-server.ts:3887`, `src/server/peer-server.ts:244`, `src/server/peer-server.ts:255`, `src/server/peer-server.ts:3911`, `src/server/peer-server.ts:3912`, `src/server/peer-server.ts:159`, `src/server/peer-server.ts:3917`, `src/server/peer-server.ts:3921`, `src/server/peer-server.ts:1370`; 테스트: `test/server-signaling-frames.test.ts` › `drops frames of the relay's own types and of types it does not relay, and passes on the provider's notifications`; `test/server-signaling-frames.test.ts` › `keeps a PeerMcpSession's session and calls when its provider sends the relay's frame types`; `test/server-signaling-frames.test.ts` › `passes a provider's notification only to the agents of an approved ticket`; `test/server-signaling-frames.test.ts` › `ignores provider frames that are not typed JSON objects instead of broadcasting them`; `test/server-signaling-frames.test.ts` › `drops the provider's own notifications/tools/list_changed, so its agents hear of a catalog change from the relay alone`

**R-SIG-005** relay가 agent 대신 provider에 전달하는 frame(WebSocket `mcp` 요청과 notification, HTTP 요청과 notification,
`offer`)에는 `from:'client'`와 ticket의 `sessionId`를 MUST 찍는다. agent가 frame에 넣은 `from`·`sessionId`는 덮어쓴다.
WebSocket frame에 agent가 넣은 다른 envelope 필드는 그대로 전달된다. HTTP 요청은 `{type:'mcp', from:'client', sessionId?,
message}`이며 `sessionId`는 ticket을 해석했을 때만 있다.\
근거: `src/server/peer-server.ts:4038`, `src/server/peer-server.ts:4050`, `src/server/peer-server.ts:4084`, `src/server/peer-server.ts:1414`, `src/server/peer-server.ts:3363`, `src/server/peer-server.ts:3398`; 테스트: `test/relay-message-limit.test.ts` › `stamps every mcp frame it forwards to the provider with from: client and the ticket's sessionId`

**R-SIG-024** relay는 provider socket에서 오지 않은 ticket 상태 변화도 room의 provider socket에 MUST 알린다. room당 ticket이 하나이므로
ticket의 종료는 그 room의 agent 쪽 종료이고, provider는 이 frame으로 자기 승인 상태를 relay와 맞춘다(R-PEER-019, R-PEER-021).

| 변화 | provider socket이 받는 frame |
|---|---|
| 승인 결정(HTTP route, 또는 provider socket의 `approval.decision`) | 결정 echo `approval.approved`·`approval.rejected`(R-SIG-009), 결정마다 한 번 |
| 승인 요청 만료(R-ROOM-026) | `approval.expired`(R-SIG-012) |
| revoke(provider 단일·전체, client 자기 revoke. 모두 HTTP) | `session.revoked`(R-SIG-015) |
| rotate | provider용 `room.rotated`(R-SIG-016) |
| room 만료 | frame 없이 close code 4002 `ROOM_EXPIRED`(R-ROOM-050, R-WS-030) |

이 frame은 모두 plain `send`라 provider queue가 가득 차면 사라진다(R-WS-034). 그래서 provider는 결정 frame을 보내자마자 그 결정대로
상태를 바꾸고, relay가 그 결정을 `INVALID_APPROVAL`로 거절하면 되돌린다(R-PEER-018). ticket이 끝났다는 frame(거절의 결정 echo
`approval.rejected`, `approval.expired`, `session.revoked`)은 relay가 MUST 기억해 그 뒤 붙는 provider socket마다 다시 보내고, 그
socket의 `ready`에도 그 type을 `ticketEnded`로 담는다(R-ROOM-053). 그래서 provider socket이 없는 동안(재접속 backoff, reload) 끝난
ticket과 사라진 frame도 provider가 다시 붙으면 `ready`에서 안다.

근거: `src/server/peer-server.ts:2822`, `src/server/peer-server.ts:2788`, `src/server/peer-server.ts:2864`, `src/server/peer-server.ts:2865`, `src/server/peer-server.ts:2563`, `src/server/peer-server.ts:2576`, `src/server/peer-server.ts:2577`, `src/server/peer-server.ts:2578`, `src/server/peer-server.ts:2768`, `src/server/peer-server.ts:3734`, `src/server/peer-server.ts:3878`, `src/server/peer-server.ts:2696`, `src/server/peer-server.ts:3943`; 테스트: `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`; `test/server-approval-lease.test.ts` › `echoes a decision made on its own socket once`; `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`; `test/server-approval-lease.test.ts` › `tells it of %s with session.revoked`; `test/provider-approval-state.test.ts` › `learns an approval made over HTTP from the relay and serves the agent`; `test/server-provider-reattach.test.ts` › `tells a provider socket that attaches after %s how the ticket ended, every time one attaches`

**R-SIG-025** relay frame의 시각 필드는 아래 형식을 MUST 따른다. R-ROOM-072처럼 기존 필드의 형식은 바꾸지 않고, 새 시각 필드는
epoch ms로만 만들며, frame마다 다른 시각을 가리키는 `expiresAt`은 새 필드로 뜻을 나눈다: 승인 요청 만료는 `approvalExpiresAt`, ticket
만료는 `ticketExpiresAt`이다. `messageId`는 relay가 message마다 새로 만드는 불투명한 고유 문자열이다(`messageId(type)`. 한 frame을 여러
socket에 보내면 같은 값이고, 같은 내용을 다시 보내면 새 값이다). 수신자는 `messageId`를 비교할 수 있을 뿐이고 그 형식에서 뜻을 MUST NOT
읽는다.

| frame | epoch ms | ISO |
|---|---|---|
| `ready` | `expiresAt`(provider용은 room 만료, client용은 ticket 만료) | — |
| `pong` | `timestamp` | — |
| `approval.request` | `expiresAt`, `payload.expiresAt`(승인 요청 만료) | `sentAt`, `payload.requestedAt` |
| `approval.pending` | `expiresAt`(승인 요청 만료) | `sentAt` |
| client용 `approval.approved` | `expiresAt`·`payload.expiresAt`(ticket 만료), `approvalExpiresAt`, `ticketExpiresAt`(top-level과 payload) | `sentAt`, `payload.decidedAt` |
| 결정 echo `approval.approved`·`approval.rejected` | `expiresAt`·`payload.expiresAt`(승인 요청 만료), `approvalExpiresAt`, `ticketExpiresAt`(top-level과 payload) | `sentAt`, `payload.decidedAt` |
| `approval.expired` | — | `sentAt` |
| `approval.restored` | `payload.approvedAt`, `payload.expiresAt`(ticket 만료) | `sentAt` |
| ticket 종료 frame(5.7) | — | `sentAt` |
| provider용 `room.rotated` | — | `sentAt`, `payload.rotatedAt` |

근거: `src/server/peer-server.ts:1529`, `src/server/peer-server.ts:1530`, `src/server/peer-server.ts:2478`, `src/server/peer-server.ts:2485`, `src/server/peer-server.ts:2486`, `src/server/peer-server.ts:2548`, `src/server/peer-server.ts:2554`, `src/server/peer-server.ts:2595`, `src/server/peer-server.ts:2601`, `src/server/peer-server.ts:2602`, `src/server/peer-server.ts:2626`, `src/server/peer-server.ts:2739`, `src/server/peer-server.ts:2745`, `src/server/peer-server.ts:2795`, `src/server/peer-server.ts:2799`, `src/server/peer-server.ts:2806`, `src/server/peer-server.ts:2807`, `src/server/peer-server.ts:2849`, `src/server/peer-server.ts:2855`, `src/server/peer-server.ts:2856`, `src/server/peer-server.ts:2857`, `src/server/peer-server.ts:2831`; 테스트: `test/server-approval-lease.test.ts` › `gives every message an id of its own, a repeated one included`; `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`; `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`

### 5.2 `ready`

| 필드 | provider용 | client용 | 값 |
|---|---|---|---|
| `type` | 있음 | 있음 | `'ready'` |
| `role` | 있음 | 있음 | `'provider'` / `'client'` |
| `roomId`, `roomEpoch` | 있음 | 있음 | room 값 |
| `sessionId` | 없음 | 있음 | ticket의 sessionId |
| `capabilities` | 있음 | 있음 | room / ticket capabilities |
| `expiresAt` | 있음 | 있음 | room 만료 / ticket 만료(epoch ms) |
| `approval` | 없음 | 있음 | ticket status |
| `ticketEnded` | room의 ticket이 끝났을 때만 | 없음 | 그 끝을 provider에 알린 frame의 type(`approval.rejected`, `approval.expired`, `session.revoked`, R-ROOM-053) |

**R-SIG-006** relay는 socket이 붙을 때 첫 frame으로 `ready`를 MUST 보낸다(R-ROOM-052, R-ROOM-056). client용 첫 `ready`는
plain `send`다. ticket이 승인되면 relay는 `approval.approved` 뒤에 `approval:'approved'`인 `ready`를 outbox로 다시
보낸다(R-ROOM-029). provider용 `ready`는 room이 살아 있는 동안 끝난 ticket이 있으면 `ticketEnded`를 MUST 담는다(R-ROOM-053).\
근거: `src/server/peer-server.ts:3942`, `src/server/peer-server.ts:3943`, `src/server/peer-server.ts:4112`, `src/server/peer-server.ts:2819`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`; `test/server-provider-reattach.test.ts` › `tells a provider socket that attaches after %s how the ticket ended, every time one attaches`

### 5.3 `ping`, `pong`

| 필드 | 값 |
|---|---|
| `type` | `'ping'` 또는 `'pong'` |
| `timestamp` | epoch ms. relay의 `pong`은 `Date.now()` |

**R-SIG-007** 붙어 있는 provider socket이나 room의 client socket(ticket status 무관, 승인 검사보다 먼저)이 `{type:'ping'}`을
보내면 relay는 `{type:'pong', timestamp: Date.now()}`로 MUST 답한다. 답은 plain `send`라서 queue가 가득 차면 사라진다. relay는
JSON `ping`을 스스로 보내지 않고 ping을 요구하지 않는다. relay가 socket의 생존을 확인하는 것은 RFC 6455 ping과 idle timeout(R-WS-039)이다.
agent가 보낸 `pong`은 R-SIG-003에 따라 버린다.\
근거: `src/server/peer-server.ts:3852`, `src/server/peer-server.ts:3853`, `src/server/peer-server.ts:3991`, `src/server/peer-server.ts:3992`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`

### 5.4 `approval.request` (R→P)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.request'` |
| `messageId` | 불투명한 고유 문자열(R-SIG-025) |
| `roomId`, `roomEpoch`, `sessionId`, `requestId` | room, ticket, 요청 값 |
| `sentAt` | 요청 `createdAt`의 ISO |
| `expiresAt` | 요청 만료(epoch ms) |
| `payload` | `{requestId, sessionId, roomId, roomEpoch, clientLabel, capabilities, requestedAt(ISO), expiresAt}` |

**R-SIG-008** relay는 승인 요청을 위 모양으로 provider socket마다 최대 한 번 MUST 보낸다(R-ROOM-025).\
근거: `src/server/peer-server.ts:2592`, `src/server/peer-server.ts:2593`, `src/server/peer-server.ts:2603`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`

### 5.5 `approval.decision` (P→R)

| 필드 | 필수 | 값 |
|---|---|---|
| `protocol` | 예 | `'webmcp-peer/1'` |
| `messageId` | 예 | 문자열 |
| `type` | 예 | `'approval.decision'` |
| `roomId`, `sessionId` | 아니오 | 있으면 room id, payload의 sessionId와 같아야 함 |
| `roomEpoch` | 조건부 | `payload.roomEpoch`가 수가 아니면 이 값을 쓴다 |
| `payload` | 아니오 | object면 아래 필드를 여기서, 아니면 frame에서 읽는다 |
| `payload.requestId`, `payload.sessionId` | 예 | 비어 있지 않은 문자열 |
| `payload.roomId` | 예 | room id |
| `payload.roomEpoch` | 조건부 | 현재 epoch |
| `payload.decision` | 예 | `'approved'` 또는 `'rejected'` |
| `payload.reason` | 아니오 | 문자열 |

**R-SIG-009** relay는 위 조건 중 하나라도 어긴 `approval.decision`에 `{type:'error', code:-32081, message:'INVALID_APPROVAL',
requestId: <requestId 또는 null>}`로 MUST 답한다. 이 frame에서 `payload.roomId`와 epoch는 필수다(HTTP route의 선택 binding, R-ROOM-071과
다르다. provider는 언제나 보낸다). 그 `requestId`의 pending 요청이 없거나 요청의 `sessionId`가 다르거나, ticket이 더는 그 요청을
가리키지 않아도(이때 요청은 지운다) 같은 오류(requestId 포함)다. 받아들인 결정은 R-ROOM-029·R-ROOM-030대로 처리한다. 결정 echo는
결정 경로와 무관하게(이 frame이든 HTTP route든, R-SIG-024) room의 provider socket에 plain `send`로 한 번 MUST 간다:
`{protocol:'webmcp-peer/1', messageId, type:'approval.approved'|'approval.rejected', roomId, roomEpoch, sessionId, requestId,
sentAt:<decidedAt>, expiresAt:<요청 만료>, approvalExpiresAt:<요청 만료>, ticketExpiresAt:<ticket 만료>, payload:{requestId, sessionId,
roomId, roomEpoch, state:<decision>, clientTokenActive:<decision === 'approved'>, decidedAt, expiresAt:<요청 만료>, approvalExpiresAt,
ticketExpiresAt}, reason?}`. `decidedAt`은 ticket이 기록한 결정 시각(ISO)이고 `reason`은 결정의 비어 있지 않은 문자열 reason이다.\
근거: `src/server/peer-server.ts:3856`, `src/server/peer-server.ts:3857`, `src/server/peer-server.ts:3863`, `src/server/peer-server.ts:3868`, `src/server/peer-server.ts:3872`, `src/server/peer-server.ts:3873`, `src/server/peer-server.ts:3878`, `src/server/peer-server.ts:3879`, `src/server/peer-server.ts:2784`, `src/server/peer-server.ts:2842`, `src/server/peer-server.ts:2845`, `src/server/peer-server.ts:2864`, `src/server/peer-server.ts:2865`, `src/server/peer-server.ts:2856`, `src/server/peer-server.ts:2857`, `src/server/peer-server.ts:2862`; 테스트: `test/server-provider-reattach.test.ts` › `keeps an approved agent working after the provider socket drops and the host reclaims the room`; `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`; `test/server-approval-lease.test.ts` › `echoes a decision made on its own socket once`

### 5.6 `approval.approved` (R→A)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.approved'` |
| `messageId` | 불투명한 고유 문자열(R-SIG-025) |
| `roomId`, `roomEpoch`, `sessionId`, `requestId` | |
| `sentAt` | `approvedAt`의 ISO |
| `expiresAt` | ticket 만료(epoch ms) |
| `approvalExpiresAt`, `ticketExpiresAt` | 승인 요청 만료, ticket 만료(epoch ms) |
| `payload` | `{requestId, sessionId, roomId, roomEpoch, state:'approved', clientTokenActive:true, decidedAt(ISO), expiresAt(ticket 만료), approvalExpiresAt, ticketExpiresAt}` |

**R-SIG-010** 승인(HTTP·WebSocket) 시 relay는 ticket에 묶인 client socket마다 위 frame을 outbox로 MUST 보낸다. 이 frame의 `expiresAt`은
ticket 만료이고, provider용 echo(R-SIG-009)의 같은 이름 필드는 승인 요청 만료다. 두 frame 모두 두 만료를 `approvalExpiresAt`(승인
요청)과 `ticketExpiresAt`(ticket)으로 따로 싣으므로, 수신자는 `expiresAt` 대신 이 둘을 읽으면 된다(R-SIG-025).\
근거: `src/server/peer-server.ts:2795`, `src/server/peer-server.ts:2796`, `src/server/peer-server.ts:2797`, `src/server/peer-server.ts:2806`, `src/server/peer-server.ts:2807`, `src/server/peer-server.ts:2810`, `src/server/peer-server.ts:2817`, `src/server/peer-server.ts:2856`, `src/server/peer-server.ts:2857`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`; `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`

### 5.7 `approval.rejected` (R→A)

ticket 종료(R-ROOM-047)가 보내는 frame 넷(`approval.rejected`, `session.revoked`, client용 `room.rotated`, `room.expired`)은 같은
모양이다. client용 `room.rotated`만 대체 room을 더 싣는다.

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, 해당 type |
| `messageId` | 불투명한 고유 문자열(R-SIG-025). 한 종료의 frame은 모든 socket에 같은 값 |
| `roomId`, `roomEpoch`, `sessionId` | |
| `requestId` | ticket에 pending 승인 요청이 있을 때만 |
| `sentAt` | ticket을 끝낸 시각(`revokedAt`)의 ISO |
| `payload` | `{requestId?, sessionId, roomId, roomEpoch, reason}`. client용 `room.rotated`는 `replacementRoomId`, `replacementRoomEpoch`도 |
| `rotatedTo` | client용 `room.rotated`만: 대체 roomId |
| `reason` | reason 문자열 |

**R-SIG-011** 거절 시 relay는 ticket에 묶인 client socket마다 reason이 비어 있지 않은 문자열 `body.reason`(HTTP) 또는
`payload.reason`(WebSocket), 아니면 `CLIENT_APPROVAL_DENIED`인 `approval.rejected`를 위 모양으로 outbox로 MUST 보낸다(R-WS-037). provider socket은 결정
경로와 무관하게 결정 echo `approval.rejected`(R-SIG-009)를 받고, 그 echo로 session을 끝낸다(R-PEER-019, R-PEER-021). relay는 그
echo를 그 뒤 붙는 provider socket에도 다시 보낸다(R-ROOM-053).\
근거: `src/server/peer-server.ts:2787`, `src/server/peer-server.ts:2788`, `src/server/peer-server.ts:2732`, `src/server/peer-server.ts:2761`, `src/server/peer-server.ts:169`, `src/server/peer-server.ts:3522`, `src/server/peer-server.ts:3862`, `src/server/peer-server.ts:2864`; 테스트: `test/live-demo.e2e.test.ts` › `a host rejection denies the session`; `test/server-approval-lease.test.ts` › `echoes a decision made over HTTP (%s), with both expiries`

### 5.8 `approval.expired` (R→A, R→P)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.expired'` |
| `messageId` | 불투명한 고유 문자열(R-SIG-025). agent와 provider에 같은 값 |
| `roomId`, `roomEpoch`, `sessionId`, `requestId` | |
| `sentAt` | ticket을 끝낸 시각(`revokedAt`)의 ISO |
| `reason` | `'APPROVAL_EXPIRED'` |

**R-SIG-012** 승인 요청이 만료되면(R-ROOM-026) relay는 위 frame을 ticket에 묶인 client socket마다 outbox로 보내고 그 socket을
R-WS-037대로 1000으로 닫으며, room의 provider socket에도 같은 frame을 plain `send`로 MUST 보낸다(R-SIG-024). provider는 이 frame으로 승인 요청을
내리고 session을 끝낸다(R-PEER-021). relay는 이 frame을 그 뒤 붙는 provider socket에도 다시 보낸다(R-ROOM-053).\
근거: `src/server/peer-server.ts:2546`, `src/server/peer-server.ts:2554`, `src/server/peer-server.ts:2555`, `src/server/peer-server.ts:2560`, `src/server/peer-server.ts:2561`, `src/server/peer-server.ts:2563`, `src/server/peer-server.ts:2578`; 테스트: `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`; `test/provider-approval-state.test.ts` › `takes an approval request nobody decided in time down when the relay expires it`; `test/relay-backpressure.test.ts` › `expires the approval of an agent that is behind after the answers it asked for, then closes it`

### 5.9 `approval.pending` (R→A)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.pending'` |
| `messageId` | 불투명한 고유 문자열(R-SIG-025) |
| `roomId`, `roomEpoch`, `requestId`, `sessionId`, `capabilities` | |
| `sentAt` | 보낸 시각 ISO |
| `expiresAt` | 승인 요청 만료(epoch ms) |

**R-SIG-013** pending ticket의 client socket이 붙으면 relay는 그 socket에만 위 frame을 outbox로 MUST 보낸다. 붙은 뒤 그 socket이
보내는 frame(`mcp`, `ping`, relay가 답하는 metadata 요청 포함, R-MCP-036)은 승인 요청을 다시 보내지 않는다. 같은 pending ticket의 HTTP
`POST /p/:id/mcp`와 session status poll은 다시 보낸다(R-ROOM-025).\
근거: `src/server/peer-server.ts:2475`, `src/server/peer-server.ts:2476`, `src/server/peer-server.ts:2485`, `src/server/peer-server.ts:4128`, `src/server/peer-server.ts:4027`, `src/server/peer-server.ts:3299`, `src/server/peer-server.ts:3589`; 테스트: `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`; `test/server-approval-lease.test.ts` › `ends with approval.expired to the agent and the provider, and a decision after it is refused`

### 5.10 `approval.restored` (R→P)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.restored'` |
| `messageId` | 불투명한 고유 문자열(R-SIG-025). 부착마다 새 값 |
| `roomId`, `roomEpoch`, `sessionId` | |
| `sentAt` | 보낸 시각 ISO |
| `payload` | `{sessionId, roomId, roomEpoch, clientLabel(기본 'MCP client'), capabilities, approvedAt, expiresAt(ticket 만료)}` |

**R-SIG-014** relay는 provider 부착 replay(R-ROOM-053)에서 approved ticket마다 위 frame을 plain `send`로 한 번 MUST 보내고 그 결과를
보지 않는다. `busy`·`too-large`면 frame은 사라지고 전달 기록도 재전송도 없으며, `closed`여도 provider를 분리하지 않는다
(`approval.request`와 다르다, R-ROOM-025). 그러면 그 provider socket은 그 ticket의 승인 상태를 받지 못한 채 남는다.\
근거: `src/server/peer-server.ts:2623`, `src/server/peer-server.ts:2624`, `src/server/peer-server.ts:2632`, `src/server/peer-server.ts:2697`, `src/server/peer-server.ts:2614`, `src/server/peer-server.ts:2615`; 테스트: `test/server-provider-reattach.test.ts` › `restores an approved ticket to the new socket with an approval.restored frame`

### 5.11 `session.revoked` (R→A, R→P), `room.expired` (R→A)

**R-SIG-015** revoke 시 relay는 ticket에 묶인 client socket마다(outbox로, R-WS-037), 그리고 room의 provider socket에도(R-SIG-024) 5.7
모양의 `session.revoked`를 MUST 보낸다. reason은 provider의 단일 revoke면 `SESSION_REVOKED`, client 자기 revoke면 `CLIENT_REVOKED`, provider
전체 revoke면 `ROOM_REVOKED`로 relay가 정한 고정값이다. 그래서 HTTP revoke 응답이 되돌리는 호출자의 `reason`(R-ROOM-039, R-ROOM-040)은
어느 frame에도 실리지 않는다. room 만료는 revoke가 아니므로 `session.revoked`를 보내지 않는다(R-SIG-023). relay는 provider에 보낸
`session.revoked`를 그 뒤 붙는 provider socket에도 다시 보낸다(R-ROOM-053).\
근거: `src/server/peer-server.ts:2761`, `src/server/peer-server.ts:2768`, `src/server/peer-server.ts:170`, `src/server/peer-server.ts:3635`, `src/server/peer-server.ts:3649`, `src/server/peer-server.ts:3673`, `src/server/peer-server.ts:2577`; 테스트: `test/live-demo.e2e.test.ts` › `revoke pushes session.revoked and purges the host credentials`; `test/server-approval-lease.test.ts` › `tells it of %s with session.revoked`; `test/relay-backpressure.test.ts` › `ends the session of an agent that is behind on %s after the replies it asked for, then closes it`

**R-SIG-023** room 만료 처리(R-ROOM-050) 시 relay는 room의 ticket마다 그 ticket에 묶인 client socket에 5.7 모양의 `room.expired`
(reason `ROOM_EXPIRED`)를 outbox로 MUST 보낸다(R-WS-037). 그 뒤 그 socket의 pending 요청은 −32056 `ROOM_EXPIRED` `{roomId, roomEpoch}`로
끝나고(HTTP 진행 요청과 같은 오류, R-ROOM-048) socket은 1000으로 닫힌다. 만료를 sweep이 처리하든 다른 자리가 먼저 처리하든
(R-ROOM-067) 같은 frame이다. provider socket에는 이 frame을 보내지 않고 close code 4002 `ROOM_EXPIRED`로 닫는다(R-ROOM-050,
R-WS-030).\
근거: `src/server/peer-server.ts:172`, `src/server/peer-server.ts:2732`, `src/server/peer-server.ts:2761`, `src/server/peer-server.ts:2762`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:2877`, `src/server/peer-server.ts:2921`, `src/server/peer-server.ts:2924`; 테스트: `test/server-pending-settlement.test.ts` › `ends a WebSocket agent's request with the ROOM_EXPIRED an HTTP one gets, after a room.expired frame`; `test/server-pending-settlement.test.ts` › `carries out the room's expiry where it is found first, not only at the sweep: %s`; `test/server-upgrade.test.ts` › `closes the provider socket of a room that expires with 4002 ROOM_EXPIRED, and an agent's with 1000 after room.expired`

### 5.12 `room.rotated`

provider용(R→P):

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'room.rotated'` |
| `messageId` | 불투명한 고유 문자열(R-SIG-025) |
| `roomId`, `roomEpoch` | 이전 room |
| `sentAt` | ISO |
| `payload` | `{previousRoomId, previousRoomEpoch, previousState:'rotated', replacementRoomId, replacementRoomEpoch, rotatedAt(ISO), invalidatedSessionCount}` |
| `rotatedTo` | 대체 roomId |

client용(R→A)은 5.7 모양이며 reason은 `ROOM_ROTATED`이고, 대체 room을 `rotatedTo`와 payload의 `replacementRoomId`·
`replacementRoomEpoch`로 싣는다.

**R-SIG-016** rotate 시 relay는 먼저 ticket 종료(R-ROOM-047)로 client socket마다 client용 frame을 보내고(그 socket의 pending 요청은
−32057 `ROOM_ROTATED` `{replacementRoomId, roomId, roomEpoch}`로 끝난다), 그다음 provider socket에 provider용 frame을 보내고 MUST
닫는다. 그래서 WebSocket agent도 HTTP agent(R-ROOM-046)와 같이 대체 room을 안다. ticket 종료가 client socket을 모두 떼므로 rotate는
client socket에 따로 frame을 보내지 않는다.\
근거: `src/server/peer-server.ts:3733`, `src/server/peer-server.ts:3734`, `src/server/peer-server.ts:3741`, `src/server/peer-server.ts:3744`, `src/server/peer-server.ts:2734`, `src/server/peer-server.ts:2751`, `src/server/peer-server.ts:2754`, `src/server/peer-server.ts:2875`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`; `test/server-pending-settlement.test.ts` › `names the replacement room to a WebSocket agent, in its room.rotated and its request's error, as to an HTTP one`; `test/relay-backpressure.test.ts` › `ends the session of an agent that is behind on %s after the replies it asked for, then closes it`

### 5.13 `offer` (A→R→P)

| 필드 | 값 |
|---|---|
| `type` | `'offer'` |
| `requestId` | 필수. 비어 있지 않은 문자열, JSON text 1024 byte 이하. provider의 `answer`·`release`가 되풀이한다 |
| `sdp` | relay는 검사하지 않는다 |
| `from`, `sessionId` | relay가 `'client'`와 ticket sessionId로 덮어쓴다 |
| 그 밖 | 그대로 전달 |

**R-SIG-017** relay는 approved ticket의 `offer`만 다루며(R-SIG-003) 다음 순서로 MUST 검사한다(`forwardOffer`). `requestId`가
비어 있지 않은 문자열이 아니면(없음, 빈 문자열, 수, null, object 등) answer를 맞출 수 없으므로 전달하지 않고 `{type:'offer.refused',
error: INVALID_REQUEST}`(−32600, requestId 없음)로 답한다. JSON text가 1024 byte를 넘으면 `{type:'offer.refused', error:
REQUEST_ID_TOO_LARGE}`(requestId 없음)다. 그 socket이 전달한 offer가 아직 answer를 기다리면(socket당 1개, R-LIM-044)
`TOO_MANY_PENDING_REQUESTS`(−32087, `{limit:1}`), 같은 room의 다른 socket의 offer 경로가 그 `requestId`이면(answer를 기다리거나 release를
기다린다) `DUPLICATE_REQUEST_ID`(−32600)로, 둘 다 requestId를 echo해 답한다. 받은 text나 `JSON.stringify(frame)`이 261120 byte를 넘으면
`too-large`로 본다. 아니면 R-SIG-005대로 stamp해 provider에 MUST 보내고, 보냈으면 그 socket의 offer 경로를 기록한다(R-SIG-026). offer는
JSON-RPC pending 상한(R-MCP-032)에는 세지 않는다.\
근거: `src/server/peer-server.ts:4096`, `src/server/peer-server.ts:1389`, `src/server/peer-server.ts:1394`, `src/server/peer-server.ts:1395`, `src/server/peer-server.ts:1398`, `src/server/peer-server.ts:1399`, `src/server/peer-server.ts:1402`, `src/server/peer-server.ts:1403`, `src/server/peer-server.ts:1406`, `src/server/peer-server.ts:1408`, `src/server/peer-server.ts:1412`, `src/server/peer-server.ts:1414`, `src/server/peer-server.ts:1430`; 테스트: `test/relay-backpressure.test.ts` › `forwards an offer of exactly the request limit and refuses one byte more with REQUEST_TOO_LARGE`; `test/relay-message-limit.test.ts` › `refuses an offer whose requestId is over 1 KiB of JSON without echoing or forwarding it, since the provider's answer repeats it`; `test/server-signaling-frames.test.ts` › `refuses an offer without a requestId the answer can be matched by, without forwarding it`; `test/server-signaling-frames.test.ts` › `lets an agent socket have one offer waiting for its answer, until the provider answers it or the request timeout passes`; `test/server-signaling-frames.test.ts` › `refuses an offer whose requestId another agent socket of the room waits on`

### 5.14 `offer.refused` (R→A)

| 필드 | 값 |
|---|---|
| `type` | `'offer.refused'` |
| `requestId` | offer의 `requestId`. 그것이 거절 이유인 `INVALID_REQUEST`·`REQUEST_ID_TOO_LARGE`에는 없다 |
| `error` | JSON-RPC 오류 object |

**R-SIG-018** 전달하지 않은 offer와 answer를 받지 못한 offer에 relay는 outbox로 위 frame을 MUST 보낸다. `error`는 R-SIG-017의
거절(`INVALID_REQUEST`, `REQUEST_ID_TOO_LARGE`, `TOO_MANY_PENDING_REQUESTS` `{limit:1}`, `DUPLICATE_REQUEST_ID`), `too-large`면
`REQUEST_TOO_LARGE`(−32600, `{limitBytes:261120}`), provider queue가 가득 차면 `PROVIDER_BUSY`(−32001, `{retryable:true}`, provider는 붙어
있음), provider가 없거나 닫히는 중이면 `PROVIDER_UNAVAILABLE`(−32001)이다. 닫히는 provider는 분리한다(모든 pending 요청이
`PROVIDER_DISCONNECTED`). 전달한 offer의 거절(`MCP_REQUEST_TIMEOUT`, `PROVIDER_DISCONNECTED`)은 R-SIG-026이다.\
근거: `src/server/peer-server.ts:576`, `src/server/peer-server.ts:1390`, `src/server/peer-server.ts:1391`, `src/server/peer-server.ts:1415`, `src/server/peer-server.ts:1416`, `src/server/peer-server.ts:1419`; 테스트: `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`

### 5.15 `answer`, `release` (P→R→A)

| type | 필드 |
|---|---|
| `answer` | `requestId`, `sdp`(ICE 수집을 마친 전체 SDP) |
| `release` | `requestId` |

**R-SIG-019** relay는 provider의 `answer`와 `release`를 문자열 `requestId`로 room의 offer 경로(R-SIG-017)에서 찾아, 그 offer를 보낸
agent socket 하나에만 수정하지 않고 outbox로 MUST 보낸다(`deliverOfferOutcome`). 어느 socket의 경로와도 맞지 않는 frame(늦은 것, 모르는
것, 경로가 끝난 것, `requestId`가 문자열이 아닌 것)은 버린다. 첫 `answer`가 그 offer를 끝내므로 그 socket은 다음 offer를 보낼 수 있고, 같은
offer의 두 번째 `answer`는 버린다. `release`는 agent가 DataChannel로 session을 넘겨받았다는 provider의 통지이고 그 경로를 끝낸다. relay는
parse한 frame을 다시 써서 보내므로(R-WS-036) provider가 262144 byte 안으로 보낸 frame도 다시 쓴 길이가 그보다 길 수 있다. 그런 `answer`는
보내지 못하므로 relay는 그 offer를 `offer.refused` `RESULT_TOO_LARGE`(−32603, `{limitBytes:262144}`, requestId echo)로 거절하고 경로를 끝내며,
그런 `release`는 `release`가 전하는 전부인 `{type:'release', requestId}`로 보낸다. provider의 송신 규칙은 R-PEER-022, R-PEER-023이다.\
근거: `src/server/peer-server.ts:159`, `src/server/peer-server.ts:3918`, `src/server/peer-server.ts:1461`, `src/server/peer-server.ts:1462`, `src/server/peer-server.ts:1434`, `src/server/peer-server.ts:1467`, `src/server/peer-server.ts:1470`, `src/server/peer-server.ts:1472`, `src/server/peer-server.ts:1477`, `src/provider/peer-client.ts:1169`, `src/provider/peer-client.ts:1548`; 테스트: `test/server-signaling-frames.test.ts` › `sends the answer and the release of an offer to the agent socket that offered, and drops one that names no offer`; `test/server-signaling-frames.test.ts` › `lets an agent socket have one offer waiting for its answer, until the provider answers it or the request timeout passes`; `test/server-signaling-frames.test.ts` › `ends an offer whose answer or release grows past the message limit as it writes it again: a refusal, and a release of the requestId alone`

**R-SIG-026** relay가 전달한 offer는 그 agent socket이 열려 있는 한 다음 중 하나로 MUST 끝난다. provider의 `answer`(R-SIG-019).
`mcpRequestTimeoutMs`(R-LIM-025) 안에 answer가 없으면 `offer.refused` `MCP_REQUEST_TIMEOUT`(−32001, requestId echo)이고 relay는 그 경로를
잊으므로 늦은 answer는 버린다. answer를 기다리는 동안 provider socket이 닫히거나 교체·분리되면 `offer.refused` `PROVIDER_DISCONNECTED`
(−32001, requestId echo)다(R-ROOM-054). relay가 다시 쓴 길이로 보낼 수 없는 answer는 `offer.refused` `RESULT_TOO_LARGE`다(R-SIG-019).
answer를 받은 offer의 경로는 `release`, 그 socket의 다음 offer, provider socket의 끝, socket이 room에서
빠지거나 닫힐 때(R-WS-037, R-ROOM-058) 끝나고, 끝난 경로에 오는 `answer`·`release`는 버린다. 그래서 offer를 보낸 agent는 전달된 offer마다
answer나 `offer.refused`를 하나 받거나 socket의 close를 받는다.\
근거: `src/server/peer-server.ts:235`, `src/server/peer-server.ts:1423`, `src/server/peer-server.ts:1426`, `src/server/peer-server.ts:1429`, `src/server/peer-server.ts:1442`, `src/server/peer-server.ts:1485`, `src/server/peer-server.ts:1491`, `src/server/peer-server.ts:1854`, `src/server/peer-server.ts:1356`; 테스트: `test/server-signaling-frames.test.ts` › `lets an agent socket have one offer waiting for its answer, until the provider answers it or the request timeout passes`; `test/server-signaling-frames.test.ts` › `refuses an offer still waiting for an answer with PROVIDER_DISCONNECTED when the provider socket goes away`; `test/server-signaling-frames.test.ts` › `sends the answer and the release of an offer to the agent socket that offered, and drops one that names no offer`; `test/server-signaling-frames.test.ts` › `ends an offer whose answer or release grows past the message limit as it writes it again: a refusal, and a release of the requestId alone`

### 5.16 `register`

provider→relay:

| 필드 | 값 |
|---|---|
| `type` | `'register'` |
| `alias` | provider alias |
| `registerSeq` | provider가 매기는 증가 번호 |
| `tools` | tool descriptor 배열(R-PEER-008) |
| 그 밖 | announcement에 그대로 실린다 |

relay→agent announcement: `{type:'register', alias?, …provider의 다른 필드, tools:<정규화한 tools>, catalogVersion, catalogHash}`.
`registerSeq`는 MUST NOT 포함한다.

**R-SIG-020** relay는 `register`를 6장대로 MUST 처리한다. 받아들인 catalog는 provider에 알리지 않는다.\
근거: `src/server/peer-server.ts:1647`, `src/server/peer-server.ts:1696`, `src/server/peer-server.ts:3883`; 테스트: `test/catalog-contract.test.ts` › `announces accepted catalogs with the relay's authoritative version and hash`; `test/catalog-contract.test.ts` › `tells every agent the catalog changed before it announces the catalog, under the relay's version and hash`

### 5.17 `error` (R→P)

| 필드 | 값 |
|---|---|
| `type` | `'error'` |
| `code` | −32602(catalog 거절), −32081(`INVALID_APPROVAL`) |
| `message` | `CATALOG_INVALID`, `CATALOG_TOO_LARGE`, `INVALID_APPROVAL` |
| `reason` | catalog 거절 설명 |
| `limitBytes` | `CATALOG_TOO_LARGE`일 때 260096 |
| `registerSeq` | 거절한 frame의 `registerSeq`가 수일 때만 |
| `requestId` | `INVALID_APPROVAL`일 때(문자열 또는 null) |

**R-SIG-021** relay는 `error` frame을 provider socket에만, catalog 거절(R-CAT-009)과 `INVALID_APPROVAL`(R-SIG-009) 때만 plain
`send`로 MUST 보낸다. agent는 relay 오류를 `mcp` frame의 JSON-RPC 오류로 받는다. provider가 보낸 `error` frame은 R-SIG-004로 버리므로
agent에게 가지 않는다.\
근거: `src/server/peer-server.ts:1704`, `src/server/peer-server.ts:1707`, `src/server/peer-server.ts:1709`, `src/server/peer-server.ts:3868`; 테스트: `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`

### 5.18 `mcp`

| 필드 | 방향 | 값 |
|---|---|---|
| `type` | 양방향 | `'mcp'` |
| `message` | 양방향 | JSON-RPC 2.0 message |
| `from` | R→P | `'client'`(relay가 찍음) |
| `sessionId` | R→P | ticket sessionId(relay가 찍음) |
| 그 밖 | A→R→P | 그대로 전달 |

**R-SIG-022** `mcp` frame의 라우팅은 7장을 MUST 따른다.\
근거: `src/server/peer-server.ts:3887`, `src/server/peer-server.ts:3995`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

## 6. catalog

room catalog은 relay가 소유하는 tool descriptor 목록(`cachedTools`)과 그 `catalogVersion`·`catalogHash`다. relay는 이 catalog로
`tools/call`을 검사하고(R-MCP-020) HTTP·WebSocket listing에 답한다.

**R-CAT-001** relay가 받아들이는 catalog는 protocol의 catalog 계약(`src/config/catalog.ts`)을 MUST 따른다. agent client의
`normalizeTools`(R-PEER-040)도 같은 상수와 같은 검사 함수를 쓰므로, relay와 client는 같은 catalog만 받는다. catalog는 tool이
최대 128개(`PEER_CATALOG_MAX_TOOLS`)인 배열이어야 한다. 각 tool은 배열이 아닌 object이고, `name`은 비어 있지 않고 앞뒤 공백이
없으며(자기 trim과 같다) 256 UTF-16 code unit(`PEER_CATALOG_MAX_TOOL_NAME_LENGTH`) 이하인 유일한 문자열이고, `inputSchema`는
`type === 'object'`인 배열 아닌 object여야 한다. 이름은 trim해서 받지 않는다. `tools/call`은 목록의 이름을 그대로 쓰므로 trim한
이름은 provider가 알리지 않은 이름이 되기 때문이다. relay는 각 tool을 `structuredClone`으로 깊이 복사하고(실패하면 무효) 다른
descriptor 필드는 MUST 유지한다. 그 밖(배열이 아닌 `tools`, `tools` 없음 포함)은 `CATALOG_INVALID`다.\
근거: `src/config/catalog.ts:12`, `src/config/catalog.ts:15`, `src/config/catalog.ts:30`, `src/config/catalog.ts:31`, `src/config/catalog.ts:37`, `src/server/deployment-catalog.ts:68`, `src/server/deployment-catalog.ts:69`, `src/server/deployment-catalog.ts:73`, `src/server/deployment-catalog.ts:75`, `src/server/deployment-catalog.ts:77`, `src/server/deployment-catalog.ts:78`, `src/client/catalog-hash.ts:100`; 테스트: `test/catalog-contract.test.ts` › `validates tool catalogs with the client contract`; `test/catalog-contract.test.ts` › `rejects catalogs clients would reject and keeps every tier on the last valid catalog`; `test/catalog-contract.test.ts` › `refuses exactly the catalogs the client refuses, and neither side trims a tool name`

**R-CAT-002** `catalogHash`는 `SHA-256(JSON.stringify(canonical))`의 소문자 hex다. canonical은 tool을 `String(tool.name ?? '')`의
UTF-16 code unit 순서로 안정 정렬한 사본(`localeCompare` 쓰지 않음)이고, 모든 object의 key를 `Object.keys().sort()`로 재귀
정렬하며 배열 순서는 유지한다. key는 `Object.defineProperty`로 넣어 자기 `__proto__` key도 hash에 들어간다. relay의 room hash,
deployment hash, agent client의 `hashTools`는 이 알고리즘을 MUST 똑같이 쓴다. tool이 없는 catalog의 hash는 `SHA-256('[]')`다.\
근거: `src/server/deployment-catalog.ts:25`, `src/server/deployment-catalog.ts:31`, `src/server/deployment-catalog.ts:45`, `src/server/deployment-catalog.ts:55`, `src/server/peer-server.ts:987`, `src/server/peer-server.ts:1217`, `src/client/catalog-hash.ts:13`, `src/client/catalog-hash.ts:50`; 테스트: `test/server-catalog-hash.test.ts` › `hashes tools in code-unit name order, independent of input order`; `test/server-catalog-hash.test.ts` › `does not depend on the runtime's collation locale`; `test/client-catalog-hash.test.ts` › `hashTools equals hashDeploymentCatalog for every input order`; `test/client-catalog-hash.test.ts` › `hashes catalogs that differ only under a __proto__ key differently, on the relay and the client`; `test/catalog-contract.test.ts` › `hashes a catalog that came with a tool's own __proto__ key as the client hashes what it lists`

**R-CAT-003** room은 deployment catalog가 비었으면 `catalogVersion: 0`, `SHA-256('[]')`, catalog 없음으로, 아니면 deployment의
tools·version·hash로 시작한다(R-ROOM-013). catalog가 바뀔 때마다(register나 listing 답) `catalogVersion`을 1 MUST 올린다.
`catalogVersion`이 0이면 hash가 같아도(빈 catalog `[]`) 받아들여 version 1이 된다. 그렇게 받은 빈 catalog도 room의 catalog이므로 모든
route가 `tools: []`로 나열한다(R-CAT-005).\
근거: `src/server/peer-server.ts:1028`, `src/server/peer-server.ts:1035`, `src/server/peer-server.ts:1036`, `src/server/peer-server.ts:1582`, `src/server/peer-server.ts:1586`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates a repeated frame again once the room catalog changed in between`

**R-CAT-004** deployment catalog는 option `deploymentCatalog`(source `injected`)이고, 없으면 `$WEBMCP_CATALOG_PATH`,
`$FRAMEBOOK_MCP_CATALOG_PATH`, `<cwd>/api/webmcp-tools.json`, `<cwd>/../../api/webmcp-tools.json` 중 처음 존재하고 정규화한
`tools`가 비어 있지 않은 JSON object 파일(source `deployment`), 없으면 빈 catalog(source `empty`)를 MUST 쓴다. `cwd`는 relay의
`cwd` option(기본 `process.cwd()`)이고, 환경 변수의 상대 경로도 `cwd` 기준으로 resolve한다. 다른 package의 경로는 보지 않는다.
무효한 tool 목록은 `[]`가 된다. `catalogVersion`은 입력의
0보다 큰 safe integer(파일은 기본 1), 아니면 tool이 있으면 1, 없으면 0이다. 입력 `catalogHash`는 계산값과 같을 때만 쓴다.
`catalogUpdatedAt`은 유한한 입력값, 아니면 `deployment`는 0, 그 밖은 `Date.now()`다.\
근거: `src/server/deployment-catalog.ts:105`, `src/server/deployment-catalog.ts:115`, `src/server/deployment-catalog.ts:118`, `src/server/deployment-catalog.ts:121`, `src/server/deployment-catalog.ts:128`, `src/server/deployment-catalog.ts:140`, `src/server/deployment-catalog.ts:142`, `src/server/deployment-catalog.ts:147`, `src/server/peer-server.ts:855`, `src/server/peer-server.ts:903`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/server-config-optin.test.ts` › `loads the deployment catalog from the cwd option, not from the process's working directory`; `test/server-config-optin.test.ts` › `does not look for a deployment catalog in another package's directory`

**R-CAT-005** relay가 나열하는 catalog snapshot(`mcpCatalogSnapshot`)은 room에 catalog(`cachedTools`, 빈 배열 포함)가 있으면 그 catalog와
room의 version·hash·updatedAt이고, 없으면 deployment catalog(비어 있지 않을 때), 그것도 없으면 `tools: []`, `catalogVersion: 0`,
`SHA-256('[]')`다. snapshot의 `available`은 앞의 두 경우에 참이고, 거짓일 때만 listing이 `CATALOG_UNAVAILABLE`이다(R-MCP-015, R-MCP-036,
R-MCP-038, R-ROOM-063, R-ROOM-064). HTTP route와 relay가 직접 답하는 WebSocket listing(R-MCP-039)이 이 snapshot을 쓴다. snapshot의 `tools`는 사본이 아니라 relay가 얼려
(`freezeToolCatalog`) 함께 쓰는 catalog 그 자체다(R-MCP-042). relay는 이 규칙을 MUST 쓴다.\
근거: `src/server/peer-server.ts:1950`, `src/server/peer-server.ts:1951`, `src/server/peer-server.ts:1952`, `src/server/peer-server.ts:1954`, `src/server/peer-server.ts:1962`, `src/server/peer-server.ts:1963`; 테스트: `test/provider-register-limit.test.ts` › `gets a WebSocket agent of a new room the relay's CATALOG_UNAVAILABLE, not the catalog of the room before`; `test/server-mcp-routing.test.ts` › `is listed as tools: [] on every route, not as CATALOG_UNAVAILABLE`

**R-CAT-006** 붙어 있는 provider socket의 `register` frame을 받으면 relay는 그것을 `registerSeq`와 나머지 `frame`(`type`, `alias`
포함)으로 나누고, `frame`의 fingerprint를 `SHA-256(JSON.stringify(frame))` hex(key 순서에 민감)로 정하고, room에서 평가를
기다리던 register frame을 답 없이 버린 뒤 처리(R-CAT-011~R-CAT-013)를 MUST 시작한다.\
근거: `src/server/peer-server.ts:1646`, `src/server/peer-server.ts:1647`, `src/server/peer-server.ts:1653`, `src/server/peer-server.ts:1654`, `src/server/peer-server.ts:3883`; 테스트: `test/server-register-evaluation.test.ts` › `keeps the budget across the room's provider sockets and never evaluates a waiting frame from a replaced one`

**R-CAT-007** catalog 평가(`acceptProviderCatalog`)는 다음 순서로 결과를 MUST 정한다. R-CAT-001에 어긋나면 `invalid`. 아니면 hash를
계산하고 announcement `{...fields, tools:<정규화한 tools>, catalogVersion:<unchanged면 현재, 아니면 현재 + 1>, catalogHash}`를
만든다(`fields`는 register frame에서 `registerSeq`를 뺀 것, listing 답이면 `{type:'register'}`). 그 JSON이 260096 byte
(`PEER_RELAY_MAX_ANNOUNCEMENT_BYTES`)를 넘으면 `too-large`(unchanged 판정보다 먼저). `catalogVersion > 0`이고 hash가 room과 같으면
`unchanged`. 아니면 `accepted`이고, 알리는 announcement는 잰 object 그대로다(그 `tools`가 room의 `cachedTools`다).\
근거: `src/server/peer-server.ts:1611`, `src/server/peer-server.ts:1613`, `src/server/peer-server.ts:1615`, `src/server/peer-server.ts:1616`, `src/server/peer-server.ts:1620`, `src/server/peer-server.ts:1621`, `src/server/peer-server.ts:1622`; 테스트: `test/relay-message-limit.test.ts` › `accepts an announcement of exactly PEER_RELAY_MAX_ANNOUNCEMENT_BYTES and sends it to agents in 128 KiB fragments`; `test/relay-message-limit.test.ts` › `announces only the catalog it measured, never one over the announcement limit`

**R-CAT-008** `accepted`면 relay는 room catalog를 바꾸고(`cachedTools`, `catalogSource: 'provider'`, `catalogHash`,
`catalogVersion += 1`, `catalogUpdatedAt = Date.now()`) 모든 agent에게 이 순서로 MUST broadcast한다:
`{type:'mcp', message:{jsonrpc:'2.0', method:'notifications/tools/list_changed', params:{catalogVersion, catalogHash}}}`, 그다음
register frame에서 온 catalog일 때만 announcement. provider에는 ack를 보내지 않는다. agent에게 가는 이 method의 notification은 이것뿐이다
(provider가 보낸 것은 relay가 버린다, R-SIG-004).\
근거: `src/server/peer-server.ts:1581`, `src/server/peer-server.ts:1583`, `src/server/peer-server.ts:1586`, `src/server/peer-server.ts:1590`, `src/server/peer-server.ts:1696`; 테스트: `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`; `test/catalog-contract.test.ts` › `announces accepted catalogs with the relay's authoritative version and hash`; `test/catalog-contract.test.ts` › `tells every agent the catalog changed before it announces the catalog, under the relay's version and hash`

**R-CAT-009** 거절한 register(`invalid`, `too-large`)에 relay는 보낸 provider socket에만 plain `send`로 MUST 답한다(queue가 가득
차면 사라진다). `invalid`는 `{type:'error', code:-32602, message:'CATALOG_INVALID', reason:'register.tools must be an array of at most 128
tools, each with a unique, non-empty name of at most 256 UTF-16 code units without leading or trailing whitespace and an
inputSchema object of type "object"'}`(`CATALOG_INVALID_REASON`, R-CAT-001의 계약을 상수에서 만든다), `too-large`는 `{type:'error', code:-32602, message:'CATALOG_TOO_LARGE',
limitBytes:260096, reason:'the catalog announcement is <n> bytes, over the relay's 260096-byte announcement limit'}`다. frame의
`registerSeq`가 수일 때만 그것을 echo한다(문자열은 echo하지 않음). room은 이전 catalog를 유지하고 agent는 아무것도 받지 않는다.\
근거: `src/server/peer-server.ts:203`, `src/server/peer-server.ts:1704`, `src/server/peer-server.ts:1705`, `src/server/peer-server.ts:1707`, `src/server/peer-server.ts:1709`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates a frame that repeats the last one once, and answers every repeat as that one was, under its own registerSeq`; `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`; `test/provider-reconnect.test.ts` › `surfaces CATALOG_INVALID as the session error until a new catalog is sent`

**R-CAT-010** `unchanged` register(tool 순서·key 순서와 무관하게 room과 같은 hash)에 relay는 답하지 않고, announcement와
`list_changed`를 보내지 않으며, version을 MUST NOT 바꾼다. 그래서 alias 같은 tool 외 필드만 바뀐 register는 알리지 않는다.\
근거: `src/server/peer-server.ts:1582`, `src/server/peer-server.ts:1621`, `src/server/peer-server.ts:1694`, `src/server/peer-server.ts:1697`; 테스트: `test/relay-message-limit.test.ts` › `announces a register only when its catalog changed`; `test/catalog-contract.test.ts` › `publishes the same descriptor via register and tools/list so the relay catalog never flaps`

**R-CAT-011** fingerprint가 마지막으로 평가한 frame과 같고 room의 `catalogVersion`·`catalogHash`가 그 평가가 남긴 값 그대로면
relay는 다시 평가하지 않고 budget도 쓰지 않으며, 저장한 결과로 MUST 답한다(같은 거절을 이 frame의 `registerSeq`로, 받아들였거나
unchanged였으면 답 없음). 그사이 room catalog가 바뀌었으면(예: catalog가 없던 room의 listing 답, R-CAT-014) 같은 frame도 다시
평가한다.\
근거: `src/server/peer-server.ts:1668`, `src/server/peer-server.ts:1669`, `src/server/peer-server.ts:1671`, `src/server/peer-server.ts:1695`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates a frame that repeats the last one once, and answers every repeat as that one was, under its own registerSeq`; `test/server-register-evaluation.test.ts` › `evaluates a repeated frame again once the room catalog changed in between`

**R-CAT-012** room마다 token bucket이 평가를 MUST 제한한다. 처음 8개(`REGISTER_EVALUATION_BURST`)로 시작하고 1000 ms
(`REGISTER_EVALUATION_INTERVAL_MS`)마다 1개씩 연속으로 채워 8개까지 둔다. 평가는 결과와 무관하게(거절, unchanged, 받아들인 catalog,
예외) 1개를 쓰고 돌려주지 않는다. catalog를 받아들이는 평가는 정규화·hash·측정에 더해 version을 올리고 모든 agent에게 `list_changed`와
최대 260096 byte의 announcement를 보내므로, 두 catalog를 번갈아 보내는 provider도 처음 8개 뒤에는 초당 1개만 평가받고 공지된다. token이
1 미만이면 frame은 `ceil((1 − tokens) × 1000)` ms를 기다렸다가 처리되고(반복 shortcut을 다시 확인), 기다리는 frame은 다음 frame이
대체한다(R-CAT-006). 그래서 provider가 마지막으로 보낸 frame은 언제나 평가되고, 그 catalog가 유효하면 늦게라도 공지되며, rate 때문에
거절되는 frame은 없다.\
근거: `src/server/peer-server.ts:140`, `src/server/peer-server.ts:142`, `src/server/peer-server.ts:1650`, `src/server/peer-server.ts:1675`, `src/server/peer-server.ts:1677`, `src/server/peer-server.ts:1685`, `src/server/peer-server.ts:1692`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates at most ${BURST} at once and then one a second, always the latest, and still takes a changed catalog`; `test/server-register-evaluation.test.ts` › `evaluates and announces catalogs that change it at most ${BURST} at once and then one a second, the latest last`

**R-CAT-013** 기다리는 frame은 더 새로운 register가 오거나, 보낸 socket이 더는 붙어 있는 provider가 아니거나(교체·닫힘), room이
만료되면 답 없이 MUST 버린다. 평가할 차례에 room이 만료됐으면 그 room을 만료 처리한다(R-ROOM-067). budget 상태는 room entry에 속하므로 다시 붙거나 교체한 provider socket이 이어받고, rotate한 대체
room은 새 budget으로 시작한다.\
근거: `src/server/peer-server.ts:848`, `src/server/peer-server.ts:1653`, `src/server/peer-server.ts:1659`, `src/server/peer-server.ts:1681`, `src/server/peer-server.ts:3926`; 테스트: `test/server-register-evaluation.test.ts` › `keeps the budget across the room's provider sockets and never evaluates a waiting frame from a replaced one`

**R-CAT-014** relay는 WebSocket agent의 whole-catalog listing(`server/discover`, 또는 `params.cursor`가 `undefined`·`null`인
`tools/list`)에 대한 provider 답에서만, 그것도 room의 snapshot이 `available`이 아닐 때만(room catalog도 deployment catalog도 없을 때,
R-CAT-005) catalog를 MUST 받아들인다. 그때 오류가 없고 `result.nextCursor`가 `undefined`·`null`이면 `result.tools`를 fields
`{type:'register'}`로 R-CAT-007에 넣고, 받아들이면 `list_changed`만 broadcast한다(announcement 없음). relay가 catalog를 가진 동안에는
provider 답을 평가하지 않고 자기 catalog로 답한다(R-MCP-038). 그래서 catalog는 평가가 제한되는 `register`(R-CAT-012)로만 바뀌고, listing
답의 평가는 room이 처음 catalog를 받기 전까지만 일어나며 register budget을 쓰지 않는다. `tools/call` 결과(그 안에 `tools`가 있어도),
cursor로 요청한 page, `nextCursor`가 있는 첫 page는 room catalog를 바꾸지 않는다. HTTP listing과 approved가 아닌 ticket의 WebSocket listing은
relay가 직접 답하므로(R-MCP-012, R-MCP-036) catalog를 바꾸지 않는다.\
근거: `src/server/peer-server.ts:4071`, `src/server/peer-server.ts:4081`, `src/server/peer-server.ts:1741`, `src/server/peer-server.ts:1749`, `src/server/peer-server.ts:1750`, `src/server/peer-server.ts:1742`, `src/server/peer-server.ts:1743`; 테스트: `test/relay-message-limit.test.ts` › `takes a catalog only from a whole tools/list result, not from a tools/call result or a page of a listing`; `test/relay-message-limit.test.ts` › `takes a catalog from a server/discover result like a tools/list one, and answers a refused one from the relay's catalog`; `test/relay-message-limit.test.ts` › `answers a tools/list whose catalog the relay refuses with the relay's own catalog, never the refused one`; `test/server-register-evaluation.test.ts` › `evaluates a repeated frame again once the room catalog changed in between`

## 7. MCP JSON-RPC 라우팅

### 7.1 공통

**R-MCP-001** relay는 `jsonrpc === '2.0'`이고 `method`가 문자열이며 `id`가 없거나 `undefined`·`null`·문자열·수인 object만
JSON-RPC 요청 모양으로 MUST 본다. 문자열 id의 JSON text(따옴표 포함)가 1024 byte를 넘으면 요청이 아니다(REQUEST_ID_TOO_LARGE). 배열
(batch)은 요청이 아니다. 수 id는 크기 검사를 받지 않는다. 이 모양의 message 가운데 id가 없는 것만 notification이고, id가 null인 것과
id와 `notifications/` method를 함께 가진 것은 무효한 요청이다(R-MCP-045).\
근거: `src/server/peer-server.ts:1222`, `src/server/peer-server.ts:1224`, `src/server/peer-server.ts:1231`, `src/server/peer-server.ts:1233`, `src/server/peer-server.ts:397`, `src/server/peer-server.ts:353`; 테스트: `test/relay-message-limit.test.ts` › `refuses a request id over 1 KiB of JSON without echoing or forwarding it, over WebSocket and HTTP`

**R-MCP-002** provider의 `mcp` frame은 `message`가 `jsonrpc === '2.0'`이고 `result`나 `error` member를 가지면 답이다
(`isRpcReplyMessage`). relay는 id가 문자열이나 수인 답(`isRpcResponse`)만 pending 요청과 맞추고(R-MCP-037), 맞출 요청이 없는 답(timeout
등으로 지운 요청의 늦은 답, id가 null이거나 문자열·수가 아닌 답)은 MUST 버린다. 답은 그것이 답하는 요청의 agent에게만 가고 broadcast되지
않는다(R-MCP-041).\
근거: `src/server/peer-server.ts:327`, `src/server/peer-server.ts:328`, `src/server/peer-server.ts:1243`, `src/server/peer-server.ts:3887`, `src/server/peer-server.ts:3892`, `src/server/peer-server.ts:3894`; 테스트: `test/server-mcp-routing.test.ts` › `drops a provider reply it cannot match to a request instead of broadcasting it to every agent`

**R-MCP-003** pending 요청은 room마다 하나인 map에 `rpcKey(id) = '<typeof id>:<String(id)>'`로 둔다. WebSocket socket과 HTTP
bridge가 이 map을 함께 쓴다. agent id의 key가 이미 pending이면 relay는 요청을 wire id
`framebook:<n>:<typeof id>:<String(id)>`(n은 server 전체에서 증가하는 counter, 빈 key가 나올 때까지 증가)로 MUST 전달하고, 답의
id를 agent의 id로 되돌린다. provider는 wire id만 본다. 그래서 수 1과 문자열 `"1"`은 다른 key다. 요청 상한 아래 1 KiB가 wire
id와 stamp를 담는다.\
근거: `src/server/peer-server.ts:1249`, `src/server/peer-server.ts:1253`, `src/server/peer-server.ts:1257`, `src/server/peer-server.ts:1739`, `src/server/peer-server.ts:3374`, `src/server/peer-server.ts:4061`, `src/config/limits.ts:32`; 테스트: `test/relay-message-limit.test.ts` › `forwards and answers a body of exactly the request limit under a rewritten duplicate id, clears its pending slot, and refuses one byte more`; `test/client-request-limit.test.ts` › `forwards and answers a WebSocket request of exactly the request limit under a rewritten duplicate id, and refuses one byte more`; `test/server-mcp-routing.test.ts` › `refuses a WebSocket request whose id is still pending on its socket, and forwards the same id over HTTP under a wire id`

**R-MCP-004** 전달한 요청마다 relay는 `mcpRequestTimeoutMs = max(1000, option ?? 30000)` ms timer를 MUST 둔다. 시간이 지나면
pending 항목을 지우고 data 없는 −32001 `MCP_REQUEST_TIMEOUT`으로 답한다(HTTP는 200). 그 뒤 온 provider 답은 버린다.\
근거: `src/server/peer-server.ts:887`, `src/server/peer-server.ts:3395`, `src/server/peer-server.ts:4067`, `src/server/peer-server.ts:3894`; 테스트: `test/server-mcp-routing.test.ts` › `answers a request the provider does not answer within mcpRequestTimeoutMs, at least 1000 ms, and drops the late answer`

**R-MCP-044** relay는 `mcpRequestTimeoutMs`가 유한한 수인지 검사하지 않는다. `max(1000, NaN)`은 `NaN`, `max(1000, Infinity)`는
`Infinity`이고, Node timer는 `NaN`이나 2147483647 ms보다 긴 지연을 1 ms로 바꾼다. 그래서 `NaN`, `Infinity`, 2147483647보다 큰 값이면
relay는 전달한 모든 요청을 약 1 ms 뒤 `MCP_REQUEST_TIMEOUT`(R-MCP-004)으로 MUST 끝낸다. 승인 요청의 수명은 이 값과 무관하다
(`approvalTimeoutMs`, R-LIM-043. 그 option은 `NaN`을 기본값으로, `Infinity`를 room 수명으로 읽고, timer는 2147483647 ms 이하로
나눠 건다, R-ROOM-026).\
근거: `src/server/peer-server.ts:887`, `src/server/peer-server.ts:3395`, `src/server/peer-server.ts:4067`, `src/server/peer-server.ts:890`, `src/server/peer-server.ts:2528`; 테스트: `test/server-mcp-routing.test.ts` › `times every forwarded request out at once for mcpRequestTimeoutMs %s, which Node's timer runs after 1 ms`

**R-MCP-005** pending 요청은 다음과 같이 MUST 끝난다. provider socket이 닫히거나 교체·분리되면 room의 모든 pending 요청이
data 없는 −32001 `PROVIDER_DISCONNECTED`(R-ROOM-052, R-ROOM-054). ticket 종료(단일 revoke, 거절, rotate, room 만료)는 그 ticket이
인증한 모든 요청을 WebSocket이든 HTTP든 같은 오류로 끝낸다(R-ROOM-047, R-ROOM-048). agent socket이 닫히면 그 socket의 요청은 답 없이
지운다(R-ROOM-058). HTTP agent의 연결이 끊기면 그 요청 slot을 즉시 비운다(R-MCP-025). relay가 이렇게 끝낸 요청이 이미 provider에
갔다면 provider에서 실행될 수 있다. relay는 실행을 되돌리지 않고, pending 항목이 없는 늦은 답을 버릴 뿐이다.\
근거: `src/server/peer-server.ts:1848`, `src/server/peer-server.ts:1852`, `src/server/peer-server.ts:2762`, `src/server/peer-server.ts:2766`, `src/server/peer-server.ts:2897`, `src/server/peer-server.ts:4104`, `src/server/peer-server.ts:3392`, `src/server/peer-server.ts:3397`, `src/server/peer-server.ts:4078`, `src/server/peer-server.ts:3894`; 테스트: `test/relay-message-limit.test.ts` › `closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on`; `test/server-pending-settlement.test.ts` › `ends a WebSocket agent's request with the ROOM_EXPIRED an HTTP one gets, after a room.expired frame`; `test/server-pending-settlement.test.ts` › `answers SESSION_INVALID when %s alone, as a revoke of every session does`

**R-MCP-006** relay는 provider 답으로 agent에게 넘길 frame을 이렇게 MUST 만든다. wire id가 agent id와 같으면 provider frame을 받은
그대로, 다르면 `{...providerFrame, message:{...rpc, id:<agent id>}}`다. WebSocket agent는 이 frame을 그대로(provider가 넣은 envelope
필드 포함) 받는다. HTTP bridge는 `type`이 `mcp`인 frame에서 `message`만 꺼내므로, HTTP agent의 응답 body는 id를 agent의 것으로
되돌린 JSON-RPC message뿐이고 provider의 envelope 필드는 전달되지 않는다(R-MCP-023). whole-catalog listing이 아닌 답은 stamp 없이
전달하고 room catalog를 바꾸지 않는다.\
근거: `src/server/peer-server.ts:1738`, `src/server/peer-server.ts:1739`, `src/server/peer-server.ts:1740`, `src/server/peer-server.ts:1741`, `src/server/peer-server.ts:3381`, `src/server/peer-server.ts:3410`; 테스트: `test/relay-message-limit.test.ts` › `forwards an agent request of exactly the request limit under a rewritten id, and answers one byte more with REQUEST_TOO_LARGE on the agent's socket`; `test/relay-message-limit.test.ts` › `forwards and answers a body of exactly the request limit under a rewritten duplicate id, clears its pending slot, and refuses one byte more`

**R-MCP-045** JSON-RPC 2.0과 MCP에서 notification은 id가 없는 message이고, 요청 id는 null일 수 없다(MCP: "ID MUST NOT be null").
두 transport는 다음을 MUST 같게 다룬다. (1) id가 없는 message만 notification이다. relay는 그 결과를 답하지 않는다(HTTP는 받아들인 notification에 202, 받아들이지
않은 것에는 id null의 오류를 그 status로 알린다, R-MCP-017, R-MCP-022. WebSocket에서 전달하지 못한 notification은 알리지 않고 버린다, R-MCP-030). (2) `id: null`인 요청은 ticket status와 무관하게
id null의 −32600 `INVALID_REQUEST`로 거절하고 전달하지 않는다(HTTP는 400). notification으로 전달하지 않으므로 id가 null인 `tools/call`이
relay의 catalog 검사(R-MCP-020)를 건너뛰어 host에서 실행되는 일이 없다. (3) id가 있으면서 method가 `notifications/`로 시작하는 message(예:
id가 있는 `notifications/initialized`)는 MCP가 정의하지 않는 요청이므로 그 id의 −32600 `INVALID_REQUEST`로 거절하고 전달하지 않는다(HTTP는
400). provider도 id가 null인 요청을 실행하지 않는다(R-PEER-012).\
근거: `src/server/peer-server.ts:353`, `src/server/peer-server.ts:3266`, `src/server/peer-server.ts:3270`, `src/server/peer-server.ts:3271`, `src/server/peer-server.ts:4010`, `src/server/peer-server.ts:4011`, `src/provider/tool-call.ts:89`, `src/provider/tool-call.ts:92`; 테스트: `test/mcp-http-interop.test.ts` › `rejects a request with id null as an invalid request`; `test/server-mcp-routing.test.ts` › `refuses a WebSocket request with id null as an invalid request, for a ticket in any state, and forwards nothing`; `test/server-mcp-routing.test.ts` › `refuses a notification method sent with an id as an invalid request, over HTTP and WebSocket`

### 7.2 HTTP `POST /p/:id/mcp`

**R-MCP-007** relay는 `POST /p/:id/mcp`를 다음 순서로 MUST 처리한다.

1. body를 261120 byte 상한으로 읽는다(R-MCP-008).
2. UTF-8과 JSON으로 해석하고 요청인지 검사한다(R-MCP-009).
3. `id: null`과 id가 있는 `notifications/*`를 거절한다(R-MCP-045).
4. 다시 직렬화한 크기를 검사한다(R-MCP-010).
5. `MCP-Protocol-Version` header를 검사한다(R-MCP-011).
6. room이 있으면 bearer ticket을 해석하고, pending ticket이면 승인 요청을 전달한다(R-ROOM-025).
7. id가 없는 metadata method는 202로 끝낸다(R-MCP-017).
8. metadata method가 아니면 room 상태를 검사한다(R-MCP-013).
9. metadata method가 아니면 ticket을 검사한다(R-MCP-014).
10. `tools/list`·`server/discover`의 snapshot에 catalog가 없으면 503이다(R-MCP-015).
11. `initialize`, `ping`, `server/discover`, `tools/list`는 relay가 직접 답한다(R-MCP-016~R-MCP-019).
12. `tools/call`이면 fail-closed 검사를 한다(R-MCP-020). id가 없는 `tools/call`도 14단계의 notification 분기보다 먼저 여기서 검사한다
    (WebSocket도 같다, R-MCP-026).
13. provider가 없으면 503(R-MCP-021).
14. notification은 전달하고 202(R-MCP-022), 요청은 전달하고 답을 기다린다(R-MCP-023).

12단계 앞에 room이 없으면 404로 답하는 코드(`src/server/peer-server.ts:3348`)가 있지만 닿지 않는다. metadata method는 7·11단계에서
모두 끝나고, 그 밖의 method는 room이 없으면 8단계에서 이미 404를 받는다.

근거: `src/server/peer-server.ts:3235`, `src/server/peer-server.ts:3242`, `src/server/peer-server.ts:3255`, `src/server/peer-server.ts:3266`, `src/server/peer-server.ts:3270`, `src/server/peer-server.ts:3276`, `src/server/peer-server.ts:3283`, `src/server/peer-server.ts:3294`, `src/server/peer-server.ts:3299`, `src/server/peer-server.ts:3305`, `src/server/peer-server.ts:3309`, `src/server/peer-server.ts:3321`, `src/server/peer-server.ts:3329`, `src/server/peer-server.ts:3333`, `src/server/peer-server.ts:3348`, `src/server/peer-server.ts:3352`, `src/server/peer-server.ts:3357`, `src/server/peer-server.ts:3365`, `src/server/peer-server.ts:3374`; 테스트: `test/server-mcp-routing.test.ts` › `answers a notification of a method the relay answers itself 202 with an empty body, without checking the room, the ticket or the catalog`; `test/server-mcp-routing.test.ts` › `checks a notification of any other method as it checks a request, and answers it 202 once the provider takes it`

**R-MCP-008** MCP POST body 상한은 261120 byte(`PEER_RELAY_MAX_REQUEST_BYTES`)이고 drain 상한은 4177920 byte다. 상한을 넘었고
drain됐으면 413 `{jsonrpc:'2.0', id:null, error:{code:-32600, message:'REQUEST_TOO_LARGE', data:{limitBytes:261120}}}`, drain
상한을 넘었으면 request가 파기되고 relay는 JSON body route(R-HTTP-008)처럼 response도 파기하므로 응답이 없다. 읽기 단계의 413은
요청을 해석하기 전이라 id를 알 수 없으므로 JSON-RPC 2.0 §5대로 id null이다(R-MCP-010). `BODY_CONSUMED`는 request가
끝난 뒤 500 `{jsonrpc:'2.0', id:null, error:{code:-32603, message:'BODY_CONSUMED'}}`, abort는 response 파기다. 어느 경우에도
아무것도 MUST NOT 전달한다.\
근거: `src/server/peer-server.ts:3242`, `src/server/peer-server.ts:3244`, `src/server/peer-server.ts:3247`, `src/server/peer-server.ts:3250`, `src/server/peer-server.ts:3251`, `src/server/peer-server.ts:219`, `src/server/peer-server.ts:2401`; 테스트: `test/relay-message-limit.test.ts` › `answers an MCP POST body one byte over the request limit with 413 REQUEST_TOO_LARGE, and the room keeps working`; `test/mcp-http-interop.test.ts` › `answers a body over the limit with 413 instead of a truncated parse`; `test/relay-message-limit.test.ts` › `answers 500 BODY_CONSUMED instead of acting on a body a customHttpHandler read, and reads one it only paused`

**R-MCP-009** body는 엄격한 UTF-8(`isUtf8`)이어야 하고, 맨 앞의 U+FEFF(BOM) 하나를 지운 뒤(R-SIG-001과 같은 규칙) `JSON.parse`로
해석한다. UTF-8이 아니거나 JSON 문법 오류(빈 body, 두 번째 BOM 포함)면 400 `{code:-32700, message:'PARSE_ERROR'}`. 문자열 id가 1024 byte를 넘으면(다른 결함보다 먼저) 400
`{code:-32600, message:'REQUEST_ID_TOO_LARGE', data:{limitBytes:1024}}`. R-MCP-001의 요청이 아니면(batch 배열 포함) 400
`{code:-32600, message:'INVALID_REQUEST'}`. `id: null`도 400 `INVALID_REQUEST`다(R-MCP-045). 이 모두 `id: null`로 MUST 답한다.\
근거: `src/server/peer-server.ts:373`, `src/server/peer-server.ts:382`, `src/server/peer-server.ts:384`, `src/server/peer-server.ts:3255`, `src/server/peer-server.ts:3256`, `src/server/peer-server.ts:3258`, `src/server/peer-server.ts:3261`, `src/server/peer-server.ts:3266`, `src/server/peer-server.ts:3267`; 테스트: `test/relay-message-limit.test.ts` › `answers a body that is not valid UTF-8 with 400 PARSE_ERROR instead of acting on altered content`; `test/mcp-http-interop.test.ts` › `rejects a request with id null as an invalid request`; `test/server-byte-order-mark.test.ts` › `is ignored in an MCP POST body`; `test/mcp-http-interop.test.ts` › `refuses a batch with 400 INVALID_REQUEST under id null, and runs none of it`

**R-MCP-010** 해석한 요청의 `JSON.stringify` 결과가 261120 byte를 넘으면(`1e20` 확장, escape 증가 등) relay는 요청 id(`rpc.id ?? null`)로
413 `REQUEST_TOO_LARGE`를 MUST 답한다. id를 알게 된 뒤이므로 요청 id를 echo하고, id가 없는 notification은 id null로 받는다. 읽기 단계의
413(R-MCP-008)은 id를 알기 전이라 id null이다. HTTP는 나르는 body를 재고 WebSocket은 나르는 `mcp` envelope을 잰다(R-MCP-027).\
근거: `src/server/peer-server.ts:3276`, `src/server/peer-server.ts:3277`, `src/server/peer-server.ts:3250`; 테스트: `test/relay-message-limit.test.ts` › `applies the request limit to a request as the relay re-serializes it, over HTTP and WebSocket`

**R-MCP-011** `initialize`가 아닌 요청(`ping`, `notifications/initialized` 포함)에 `MCP-Protocol-Version` header가 있고 그 값을
trim한 것이 `MCP_INITIALIZE_PROTOCOL_VERSIONS`에 없으면 relay는 room 조회와 ticket 인증보다 먼저 400 `{jsonrpc:'2.0',
id:<rpc.id ?? null>, error:{code:-32600, message:'UNSUPPORTED_PROTOCOL_VERSION', data:{supported:[4개 버전], requested:<header 값>}}}`로
MUST 답한다. node:http는 반복된 이 header를 `, `로 합친 문자열 하나로 넘기므로 header 값은 언제나 문자열이다(문자열이 아닌 값을
거절하는 분기는 닿지 않는다). 그래서 지원하는 version을 두 번 보내도 trim한 값이 `2025-11-25, 2025-11-25`처럼 목록에 없어 400이고,
`requested`도 그 합친 문자열이다. header가 없으면 받는다. `initialize`는 header로 막지 않는다. `2026-07-28` client가
`server/discover`로 먼저 물으면 400을 받고 `initialize`로 물러난다.\
근거: `src/server/peer-server.ts:3283`, `src/server/peer-server.ts:3284`, `src/server/peer-server.ts:3285`, `src/server/peer-server.ts:3288`, `src/provider/commit-receipt.ts:10`; 테스트: `test/mcp-http-interop.test.ts` › `rejects an unsupported MCP-Protocol-Version header and accepts a supported or missing one`; `test/mcp-http-interop.test.ts` › `serves the official MCP v2 client in %s negotiation mode`

**R-MCP-012** `initialize`, `server/discover`, `tools/list`, `ping`, `notifications/initialized`(metadata method, `RELAY_METADATA_METHODS`)는
HTTP에서 relay가 직접 처리하고 provider에 MUST NOT 전달한다. room이 없거나 rotate·만료됐어도, ticket이 없거나 어떤 status여도 같다
(discovery는 공개다). id가 있으면 답하고(R-MCP-016~R-MCP-019), 없으면 202로 끝낸다(R-MCP-017). `_meta.auth.state`는 ticket status, 없으면
`not-joined`다. WebSocket에서는 `ping`을 언제나, 나머지를 approved가 아닌 ticket에만 relay가 같은 결과로 답한다(R-MCP-036).\
근거: `src/server/peer-server.ts:347`, `src/server/peer-server.ts:3293`, `src/server/peer-server.ts:3301`, `src/server/peer-server.ts:3305`, `src/server/peer-server.ts:3309`, `src/server/peer-server.ts:3322`, `src/server/peer-server.ts:3333`; 테스트: `test/client-session.test.ts` › `revokes a ticket that is still waiting for approval`; `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`; `test/server-mcp-routing.test.ts` › `gives a ticket waiting for approval the relay's public discovery, as the HTTP route does`

**R-MCP-013** metadata method가 아니면 relay는 이 순서로 room을 MUST 검사한다. 모르는 room: 404
`{code:-32004, message:'ROOM_NOT_FOUND', data:{roomId}}`. rotate된 room: 410 `{code:-32057, message:'ROOM_ROTATED',
data:{replacementRoomId, roomId, roomEpoch}}`. `expiresAt <= now`: 410 `{code:-32056, message:'ROOM_EXPIRED', data:{roomId,
roomEpoch}}`이고, 그 room을 아직 만료 처리하지 않았으면 이때 처리한다(R-ROOM-067). 모두 JSON-RPC 오류 body에 요청 id를 담는다.\
근거: `src/server/peer-server.ts:3309`, `src/server/peer-server.ts:3310`, `src/server/peer-server.ts:3313`, `src/server/peer-server.ts:3314`, `src/server/peer-server.ts:3317`, `src/server/peer-server.ts:3318`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`; `test/server-pending-settlement.test.ts` › `carries out the room's expiry where it is found first, not only at the sweep: %s`

**R-MCP-014** metadata method가 아니면 ticket은 Bearer 자격(R-HTTP-018)의 token으로 MUST 찾는다(token의 SHA-256 hex,
R-WS-007). 오류는 두 transport가 함께 쓰는 `clientTicketError`로 정한다. Bearer 자격이 없으면 401 −32003 `CLIENT_TOKEN_REQUIRED`,
있지만 room이 발급하지 않은 token이면 401 −32003 `CLIENT_TOKEN_INVALID`. pending: 403 −32053 `CLIENT_APPROVAL_REQUIRED`. rejected:
403 −32054 `CLIENT_APPROVAL_DENIED`. expired: 410 −32056 `SESSION_EXPIRED`. revoked·room-rotated: 401 −32001 `SESSION_INVALID`
(room-rotated ticket의 room은 R-MCP-013에서 먼저 거절된다). 401은 R-HTTP-019의 `WWW-Authenticate` challenge를 가진다. data는
`clientTicketErrorData`의 `{roomId, sessionId, approvalRequestId, approvalRequired}`이고, ticket이 없으면 `sessionId`와
`approvalRequestId`가, 승인 요청이 없으면 `approvalRequestId`가 `null`이다. WebSocket도 같은 data다(R-MCP-029).\
근거: `src/server/peer-server.ts:2432`, `src/server/peer-server.ts:2434`, `src/server/peer-server.ts:2435`, `src/server/peer-server.ts:2438`, `src/server/peer-server.ts:2446`, `src/server/peer-server.ts:2901`, `src/server/peer-server.ts:2902`, `src/server/peer-server.ts:3294`, `src/server/peer-server.ts:3296`, `src/server/peer-server.ts:3321`, `src/server/peer-server.ts:3325`, `src/server/peer-server.ts:3326`; 테스트: `test/live-demo.e2e.test.ts` › `reports a revoked session as SESSION_INVALID instead of catalog drift`; `test/live-demo.e2e.test.ts` › `a host rejection denies the session`; `test/server-room-lifecycle.test.ts` › `takes a Bearer token with a scheme of any case and one or more spaces on every route`; `test/server-error-model.test.ts` › `tells a missing Authorization credential from a wrong one, with a Bearer challenge`; `test/server-error-model.test.ts` › `gives an unapproved ticket's error the same data over HTTP and WebSocket`

**R-MCP-015** catalog snapshot(R-CAT-005)이 `available`이 아니면, 곧 room에 catalog가 없고 deployment catalog도 없으면, relay는 id가 있는
`tools/list`와 `server/discover`에 503 `{code:-32090, message:'CATALOG_UNAVAILABLE', data:{catalogSource:<deployment catalog의 source>}}`로
MUST 답한다. provider가 빈 catalog를 등록한 room은 catalog가 있으므로 200 `tools: []`를 받는다(R-CAT-003). `initialize`는 catalog가 없어도
답한다.\
근거: `src/server/peer-server.ts:1950`, `src/server/peer-server.ts:1963`, `src/server/peer-server.ts:3329`, `src/server/peer-server.ts:3330`; 테스트: `test/provider-register-limit.test.ts` › `gets a WebSocket agent of a new room the relay's CATALOG_UNAVAILABLE, not the catalog of the room before`; `test/server-mcp-routing.test.ts` › `is listed as tools: [] on every route, not as CATALOG_UNAVAILABLE`

**R-MCP-016** `initialize`에 relay는 200과 `mcpInitializeResult`의 `result:{protocolVersion, capabilities:{tools:{listChanged:false},
stateless:true}, serverInfo:{name, version}, tools, _meta}`로 MUST 답한다. `protocolVersion`은 provider와 함께 쓰는
`negotiateInitializeProtocolVersion`(`src/provider/commit-receipt.ts`)으로 정한다: `params.protocolVersion`이 `MCP_INITIALIZE_PROTOCOL_VERSIONS`에
있으면 그 값, 아니면(`2026-07-28`, 모르는 값, 없음) `2025-11-25`다. `serverInfo`는 `serverName`(기본 `framebook-peer-server`)과
`serverVersion`(기본 `0.4.0`)이다. `_meta`는 `{roomId, roomEpoch(모르면 0), roomState, roomValid, catalogVersion, catalogHash, toolCount,
bootstrapCatalog:{tools, catalogVersion, catalogHash, source:<room catalogSource ?? deployment source>}, auth}`다. header는
`Cache-Control: no-store`, `X-MCP-Catalog-Version`, `X-MCP-Catalog-Hash`, `Vary: Origin`이다. approved가 아닌 ticket의 WebSocket
`initialize`는 같은 result를 두 가지만 다르게 받는다(R-MCP-036). `listChanged`가 `true`이고, relay message 상한에 들어가도록 catalog를
`tools`에 한 번만 담아 `_meta.bootstrapCatalog`는 `tools` 없이 `{catalogVersion, catalogHash, source}`로 그 catalog를 가리킨다(R-LIM-017).
HTTP에는 message 상한이 없으므로 bootstrap catalog도 tool을 담는다. approved ticket의 WebSocket `initialize`에는 provider가 같은 협상으로
답한다(R-PEER-015).\
근거: `src/provider/commit-receipt.ts:27`, `src/provider/commit-receipt.ts:29`, `src/server/peer-server.ts:1195`, `src/server/peer-server.ts:1196`, `src/server/peer-server.ts:2046`, `src/server/peer-server.ts:2056`, `src/server/peer-server.ts:2068`, `src/server/peer-server.ts:3338`, `src/server/peer-server.ts:1899`, `src/server/peer-server.ts:904`; 테스트: `test/mcp-http-interop.test.ts` › `negotiates initialize-era version %s as requested`; `test/mcp-http-interop.test.ts` › `answers 2026-07-28, unknown, and missing initialize versions with 2025-11-25`; `test/mcp-http-interop.test.ts` › `advertises tools.listChanged false because the HTTP endpoint has no server-to-client stream`; `test/mcp-http-interop.test.ts` › `answers initialize with the bootstrap catalog in _meta and the catalog headers, never cached`

**R-MCP-017** relay가 받아들인 id 없는 message(notification)에는 method와 무관하게 202와 빈 본문으로 MUST 답한다(Streamable HTTP).
받아들이지 않은 notification에는 같은 검사에 걸린 요청과 같은 status와 id null의 JSON-RPC 오류로 답한다. method보다 먼저 보는 R-MCP-007의
1~5단계(400·413, R-MCP-008~R-MCP-011)는 어느 notification에나 적용된다. metadata method의 notification(`notifications/initialized`, 그리고
id가 없는 `ping`·`initialize`·`tools/list`·`server/discover`)은 relay가 할 일이 없으므로, 그 단계를 지나면 room·ticket·catalog를 검사하지 않고
언제나 받아들여 `Content-Type` 없이 `Cache-Control: no-store`와 catalog header로 202를 답하며 전달하지 않는다. 그 밖의 notification은 요청처럼
room·ticket·`tools/call`·provider 검사를 거치고, provider에 전달될 때만 202를 받으며 그 검사에서 거절되면 그 status를 받는다(R-MCP-013,
R-MCP-014, R-MCP-020, R-MCP-021, R-MCP-022). id가 있는 `ping`에는 200 `{jsonrpc:'2.0', id, result:{}}`와 catalog header로 답한다.\
근거: `src/server/peer-server.ts:3305`, `src/server/peer-server.ts:3306`, `src/server/peer-server.ts:2205`, `src/server/peer-server.ts:3309`, `src/server/peer-server.ts:3321`, `src/server/peer-server.ts:3357`, `src/server/peer-server.ts:3344`; 테스트: `test/mcp-http-interop.test.ts` › `answers a notification with 202 and an empty body`; `test/server-mcp-routing.test.ts` › `answers a notification of a method the relay answers itself 202 with an empty body, without checking the room, the ticket or the catalog`; `test/server-mcp-routing.test.ts` › `checks a notification of any other method as it checks a request, and answers it 202 once the provider takes it`

**R-MCP-018** HTTP `tools/list`에 relay는 200 `result:{tools, _meta:{roomId, roomEpoch, roomState, roomValid, catalogVersion,
catalogHash, auth}}`와 catalog header로 MUST 답한다. `tools`는 R-CAT-005 snapshot이다. `params.cursor`와 `params._meta`는
무시하고(pagination 없음), catalog stamp는 언제나 `result._meta` 안에 있다. 이 자리가 두 transport의 모든 listing이 stamp를 두는 정본
자리다(R-MCP-038).\
근거: `src/server/peer-server.ts:3342`, `src/server/peer-server.ts:2024`, `src/server/peer-server.ts:1980`; 테스트: `test/relay-message-limit.test.ts` › `registers a catalog whose register frame is between 128 KiB and 256 KiB and lists it to agents`; `test/relay-message-limit.test.ts` › `keeps a fresh WebSocket PeerMcpSession listing and calling the relay's catalog after the relay refused the provider's newer one`

**R-MCP-019** HTTP `server/discover`에 relay는 200과 `mcpDiscoverResult`의 `result:{protocolVersion:<R-MCP-016과 같은 협상>,
supportedProtocolVersions:<MCP_INITIALIZE_PROTOCOL_VERSIONS 4개>, capabilities:{tools:{listChanged:false}, stateless:true}, serverInfo, tools,
_meta:<R-MCP-018과 같은 listing meta>}`로 MUST 답한다. relay가 WebSocket에서 답하는 `server/discover`(R-MCP-036, R-MCP-039)는
`listChanged:true`만 다르고, provider가 relay를 거쳐 답하는 것도 같은 협상과 `supportedProtocolVersions`, `capabilities`를 보고한다
(R-PEER-015). 그래서 WebSocket agent의 `server/discover` 답은 relay가 provider의 catalog를 받아들이든 거절하든 같은 협상·version 목록·
capabilities를 가진다. 다른 것은 답한 쪽의 `serverInfo`, provider의 `instructions`, relay의 listing metadata(`_meta`)뿐이다.\
근거: `src/server/peer-server.ts:2005`, `src/server/peer-server.ts:2015`, `src/server/peer-server.ts:2016`, `src/server/peer-server.ts:363`, `src/server/peer-server.ts:3340`; 테스트: `test/server-mcp-routing.test.ts` › `negotiates initialize and server/discover as the HTTP route does in a provider's room, whichever answers them`; `test/relay-message-limit.test.ts` › `answers a WebSocket agent's tools/list and server/discover from the relay's catalog when the provider answers with an error`

**R-MCP-020** relay는 `tools/call`을 전달하기 전에 다음을 MUST 검사한다. (1) `params`는 비어 있지 않은 문자열 `name`을 가진
object, 아니면 −32602 `tools/call params are invalid`. (2) `params._meta.catalogVersion`이 room `catalogVersion`과 다른 수이거나
`params._meta.catalogHash`가 room `catalogHash`와 다른 문자열이면 −32010 `CATALOG_CHANGED`, data `{catalogVersion, catalogHash}`(relay의
현재 값). (3) room에 catalog(`cachedTools`)가 있고 그 이름의 tool이 없으면 −32602 `TOOL_NOT_FOUND`(data 없음). catalog가 없는 room은
(3)을 건너뛴다. 두 transport는 이 검사 하나(`toolCallRefusal`)를 함께 쓰고, id가 없는 것을 포함해 모든 `tools/call`을 notification
분기보다 먼저 검사한다(R-MCP-007의 12단계, R-MCP-026의 6단계). 그래서 catalog drift는 id가 없는 message를 실행하는 provider에도 닿지 않는다.
HTTP status는 400, 409, 400이다. id가 없는 HTTP `tools/call`은 이 오류를 id null로 받고, id가 없는 WebSocket `tools/call`은 답 없이
버려진다(notification에는 답하지 않는다, R-MCP-030). 둘 다 통과하면 notification으로 전달된다(R-MCP-022, R-MCP-030). id가 null인
`tools/call`은 어느 transport에서도 전달되지 않는다(R-MCP-045). relay는 `_meta.runtimeEpoch`와 `_meta.sessionId`를 보지 않는다(R-ERR-006).\
근거: `src/server/peer-server.ts:1270`, `src/server/peer-server.ts:1272`, `src/server/peer-server.ts:1276`, `src/server/peer-server.ts:1278`, `src/server/peer-server.ts:1280`, `src/server/peer-server.ts:3352`, `src/server/peer-server.ts:3354`, `src/server/peer-server.ts:3365`, `src/server/peer-server.ts:4041`, `src/server/peer-server.ts:4043`, `src/server/peer-server.ts:4046`, `src/server/peer-server.ts:4050`; 테스트: `test/live-demo.e2e.test.ts` › `rejects stale writes with CATALOG_CHANGED without touching the host, then resyncs`; `test/live-demo.e2e.test.ts` › `surfaces relay catalog drift over HTTP as PeerMcpCatalogChangedError (no host write)`; `test/server-mcp-routing.test.ts` › `refuses invalid params, a catalog stamp that is not the room's and an unknown tool before the provider sees them`; `test/server-mcp-routing.test.ts` › `checks a tools/call without an id as one with an id on both transports, and drops one it refuses over WebSocket unanswered`

**R-MCP-021** room에 provider socket이 없으면 relay는 중계할 요청과 notification에 503 `{jsonrpc:'2.0', id:<id 또는 null>,
error:{code:-32001, message:'PROVIDER_UNAVAILABLE'}}`(data·`Retry-After` 없음)로 MUST 답한다. relay가 닫은 provider socket(예:
1009)도 여기서 답한다. codec의 `close()`는 그 자리에서 `onClose`를 부르고, relay의 `onClose`가 그 socket을 room에서 떼기
때문이다(R-WS-027, R-ROOM-054).\
근거: `src/server/peer-server.ts:3357`, `src/server/peer-server.ts:3358`, `src/server/ws-upgrade.ts:591`, `src/server/ws-upgrade.ts:609`, `src/server/peer-server.ts:3927`, `src/server/peer-server.ts:3928`; 테스트: `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`; `test/server-ws-frames.test.ts` › `answers PROVIDER_UNAVAILABLE, not REQUEST_TOO_LARGE, while the closed provider has not hung up`

**R-MCP-022** id가 없는 message(`id: null`은 무효한 요청이다, R-MCP-045)로 metadata method가 아닌 것은 room·ticket·`tools/call`(R-MCP-020)·
provider 검사를 거쳐 `{type:'mcp', from:'client', sessionId, message}`로 전달한다. 그 검사에서 거절된 notification은 같은 검사에 걸린 요청과
같은 status와 id null의 JSON-RPC 오류를 받는다(R-MCP-013, R-MCP-014, R-MCP-020, R-MCP-021). 중계 method는 approved ticket만 통과하므로
(`room-rotated` ticket의 room은 R-MCP-013에서 먼저 거절된다) `sessionId`는 언제나 있다. ticket이 없을 때 `sessionId`를 빼는 분기
(`src/server/peer-server.ts:3363`)는 닿지 않는다. provider socket이 받으면 202, 빈 본문, catalog header 없음으로 MUST 답한다. 못 받으면
id null로 `too-large`는 413 `REQUEST_TOO_LARGE`, `busy`는 503 `PROVIDER_BUSY`와 `Retry-After: 1`, `closed`는 503
`PROVIDER_UNAVAILABLE`(provider 분리)이다. notification에는 답할 수 없지만(JSON-RPC 2.0 §4.1) Streamable HTTP는 받아들이지 않은
message를 status로 알리므로, HTTP는 전달하지 못한 notification을 이렇게 알린다(WebSocket은 버린다, R-MCP-030).\
근거: `src/server/peer-server.ts:2432`, `src/server/peer-server.ts:3321`, `src/server/peer-server.ts:3363`, `src/server/peer-server.ts:3365`, `src/server/peer-server.ts:3366`, `src/server/peer-server.ts:3368`, `src/server/peer-server.ts:3371`; 테스트: `test/mcp-http-interop.test.ts` › `forwards a provider notification and answers 202 with an empty body`; `test/relay-message-limit.test.ts` › `stamps every mcp frame it forwards to the provider with from: client and the ticket's sessionId`; `test/relay-message-limit.test.ts` › `forwards an HTTP notification of exactly the request limit, and answers one byte more with 413 and forwards nothing`; `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`; `test/server-mcp-routing.test.ts` › `checks a notification of any other method as it checks a request, and answers it 202 once the provider takes it`

**R-MCP-023** 중계하는 HTTP 요청마다 relay는 요청별 bridge socket을 만든다. bridge의 `send`는 언제나 `sent`를 돌려주고 크기 상한이
없다. pending 항목 `{socket, timer, method, id, wireId, ticket}`(ticket은 요청을 인증한 것이라 ticket 종료가 요청을 끝낸다, R-ROOM-047)을
두고 stamp한 frame을 보낸 뒤 기다린다. relay가 요청을 provider에 전달하기 전에 거절한 것(R-MCP-007의 1~13단계와 R-MCP-024)은 R-ERR-003
표의 4xx·5xx로 답하고, 전달한 요청의 결과는 provider의 답(JSON-RPC 오류 포함)이든 진행 중에 relay가 끝낸 것(`MCP_REQUEST_TIMEOUT`,
`PROVIDER_DISCONNECTED`, `ROOM_ROTATED`, `ROOM_EXPIRED`, `SESSION_INVALID`, R-MCP-005)이든 MUST 200과 JSON-RPC message(id는 agent의 것으로
되돌림)로 답하며 `X-MCP-Catalog-*` header가 없다. 그래서 같은 이름의 오류가 새 요청에는 410·401·503으로, 진행 중인 요청에는 200으로 온다.
MCP Streamable HTTP는 JSON-RPC 오류에 쓸 HTTP status를 정하지 않고 공식 SDK는 non-2xx를 transport 오류로 바꿔 body를 넘기지 않으므로,
이미 전달한 요청의 결과는 200으로 주어야 stock host가 JSON-RPC 오류를 그대로 받는다. agent는 HTTP status가 아니라 JSON-RPC `error`로
성패를 판단한다(R-PEER-053). 패키지 HTTP transport는 두 경우 모두 JSON-RPC 오류로 올린다(R-ERR-004).\
근거: `src/server/peer-server.ts:3378`, `src/server/peer-server.ts:3380`, `src/server/peer-server.ts:3397`, `src/server/peer-server.ts:3398`, `src/server/peer-server.ts:3410`; 테스트: `test/relay-message-limit.test.ts` › `delivers a ~200 KB tool result to an HTTP agent intact while the provider stays connected`; `test/server-pending-settlement.test.ts` › `answers ROOM_ROTATED with the replacement room when the provider rotates`

**R-MCP-024** provider socket이 요청을 받지 못하면 relay는 pending 항목을 지우고 요청 id로 MUST 답한다. `too-large`: 413
`REQUEST_TOO_LARGE {limitBytes:261120}`. `busy`: 503 `{code:-32001, message:'PROVIDER_BUSY', data:{retryable:true}}`와
`Retry-After: 1`, provider는 붙어 있다. `closed`: provider를 분리하고(모든 pending 요청이 `PROVIDER_DISCONNECTED`) `close()`한 뒤 503
`PROVIDER_UNAVAILABLE`. `send`가 `closed`를 돌려주는 것은 socket이 파기됐거나 writable이 아니지만 codec이 아직 멈추지 않은(그 event가
아직 처리되지 않은) 짧은 사이뿐이다. codec이 멈추면 바로 `onClose`가 돌아 relay가 provider를 떼므로, 그 뒤의 요청은 R-MCP-021로 답을
받는다.\
근거: `src/server/peer-server.ts:3399`, `src/server/peer-server.ts:3403`, `src/server/peer-server.ts:3404`, `src/server/peer-server.ts:1549`, `src/server/peer-server.ts:1557`, `src/server/peer-server.ts:1561`, `src/server/peer-server.ts:1566`, `src/server/peer-server.ts:1512`, `src/server/ws-upgrade.ts:518`, `src/server/ws-upgrade.ts:553`; 테스트: `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`

**R-MCP-025** HTTP response가 쓰이기 전에 닫히면 relay는 그 요청의 pending 항목을 즉시 MUST 지운다. 그때 만드는 −32001
`CLIENT_DISCONNECTED`는 bridge에만 전달되고 wire에 나가지 않으며, 이후 provider 답은 버린다.\
근거: `src/server/peer-server.ts:3388`, `src/server/peer-server.ts:3392`, `src/server/peer-server.ts:3394`, `src/server/peer-server.ts:3409`; 테스트: `test/server-pending-settlement.test.ts` › `releases the pending slot as soon as the HTTP agent disconnects`

### 7.3 WebSocket `mcp` envelope (agent → relay)

**R-MCP-026** relay는 approved가 아닌 경우를 포함해 client socket의 `{type:'mcp', message}` frame을 다음 순서로 MUST 처리한다.

1. 요청 유효성(R-MCP-028)
2. `id: null`과 id가 있는 `notifications/*`의 거절(R-MCP-045)
3. 크기(R-MCP-027)
4. `ping`이면 relay가 답하고 끝(R-MCP-036)
5. ticket status. approved가 아니면 metadata 요청은 relay가 답하고 그 밖은 오류로 답한 뒤 끝(R-MCP-029, R-MCP-036)
6. `tools/call` 검사(R-MCP-020). id가 없는 `tools/call`도 검사하고, 거절한 것은 답 없이 버린다
7. id가 없으면 notification으로 전달하고 끝(R-MCP-030)
8. 같은 socket의 중복 id(R-MCP-031)
9. pending 상한(R-MCP-032)
10. wire id 할당(R-MCP-003), provider 유무(R-MCP-033)
11. pending 항목 생성(R-MCP-034)과 전달(R-MCP-035)

HTTP(R-MCP-007)와 순서가 다른 곳은 크기다. HTTP는 body 크기를 해석하기 전에 재지만 WebSocket은 1·2단계를 통과한 요청만 재므로
id 크기와 유효성 오류가 크기 오류보다 앞선다(R-MCP-027). `tools/call` 검사는 두 transport 모두 notification 분기보다 앞이다(R-MCP-020).

근거: `src/server/peer-server.ts:3995`, `src/server/peer-server.ts:3997`, `src/server/peer-server.ts:4010`, `src/server/peer-server.ts:4017`, `src/server/peer-server.ts:4023`, `src/server/peer-server.ts:4027`, `src/server/peer-server.ts:4032`, `src/server/peer-server.ts:4041`, `src/server/peer-server.ts:4046`, `src/server/peer-server.ts:4053`, `src/server/peer-server.ts:4057`, `src/server/peer-server.ts:4061`, `src/server/peer-server.ts:4063`, `src/server/peer-server.ts:4072`, `src/server/peer-server.ts:4084`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`; `test/server-mcp-routing.test.ts` › `refuses a WebSocket request with id null as an invalid request, for a ticket in any state, and forwards nothing`

**R-MCP-027** `message`가 유효한 요청(R-MCP-001)이고 R-MCP-045로 거절되지 않았으면 relay는 받은 text와 `JSON.stringify(frame)`의 크기를 잰다.
어느 하나가 261120 byte를 넘으면 id가 있는 요청에는 그 id로 `{code:-32600, message:'REQUEST_TOO_LARGE', data:{limitBytes:261120}}`를 보내고,
notification은 답 없이 버린다. 아무것도 MUST NOT 전달한다. 각 transport는 자기가 나르는 것을 잰다. WebSocket은 agent가 `message` 옆에 넣은
필드까지 포함한 `{type:'mcp', message}` envelope 전체를 재고(relay가 그 필드도 provider에 전달한다), HTTP는 body만 잰다(R-MCP-008,
R-MCP-010). 그래서 261120 byte에 약 25 byte 이내인 같은 JSON-RPC 요청은 HTTP로는 전달되고 WebSocket으로는 거절될 수 있고, 어느 transport든
실제로 전달하는 byte에 상한이 걸린다. client transport도 같은 것을 잰다(R-PEER-033). 정확히 261120 byte인 요청은 relay의 stamp와 wire id가
붙어 커져도 전달한다. 262144 byte를 넘는 frame은 여기 오기 전에 codec이 1009로 닫는다. 유효한 요청이 아닌 `message`는 크기를 재지 않고
R-MCP-028로, id가 null인 요청은 R-MCP-045로 간다. 그래서 261121~262144 byte frame이라도 문자열 id가 1024 byte를 넘으면
`REQUEST_ID_TOO_LARGE`(id null)를, 요청이 아니고 id가 문자열·수·null이면 그 id로 `INVALID_REQUEST`를, id가 null인 요청이면 id null의
`INVALID_REQUEST`를 받는다. 같은 내용의 HTTP body는 해석하기 전에 413 `REQUEST_TOO_LARGE`(id null)를 받는다(R-MCP-008).\
근거: `src/server/peer-server.ts:391`, `src/server/peer-server.ts:3997`, `src/server/peer-server.ts:4000`, `src/server/peer-server.ts:4004`, `src/server/peer-server.ts:4010`, `src/server/peer-server.ts:4017`, `src/server/peer-server.ts:4018`, `src/server/peer-server.ts:3250`, `src/config/limits.ts:32`, `src/client/transport.ts:77`; 테스트: `test/relay-message-limit.test.ts` › `forwards an agent request of exactly the request limit under a rewritten id, and answers one byte more with REQUEST_TOO_LARGE on the agent's socket`

**R-MCP-028** `message`가 요청이 아니면: object이고 문자열 id가 1024 byte를 넘으면 id null로 `REQUEST_ID_TOO_LARGE`
(`{limitBytes:1024}`). 아니면 id가 문자열·수·null이면 그 id로 data 없는 −32600 `INVALID_REQUEST`. id가 없거나 그 밖의 type이면,
또는 `message`가 object가 아니면 답하지 않는다. 어느 경우에도 MUST NOT 전달한다.\
근거: `src/server/peer-server.ts:3997`, `src/server/peer-server.ts:3998`, `src/server/peer-server.ts:4000`, `src/server/peer-server.ts:4003`, `src/server/peer-server.ts:4004`, `src/server/peer-server.ts:1307`; 테스트: `test/relay-message-limit.test.ts` › `refuses a request id over 1 KiB of JSON without echoing or forwarding it, over WebSocket and HTTP`; `test/server-mcp-routing.test.ts` › `answers a WebSocket message that is not a request INVALID_REQUEST under its id, and nothing without one`

**R-MCP-029** socket ticket이 approved가 아니면 relay는 요청을 provider에 전달하지 않는다. `ping`(R-MCP-036이 ticket 검사보다 먼저 답한다)과
id가 있는 `initialize`·`tools/list`·`server/discover`(R-MCP-036)에는 relay가 답한다. 그 밖의 method에는 HTTP와 같은 `clientTicketError`의
오류와 같은 data `{roomId, sessionId, approvalRequestId, approvalRequired}`(승인 요청이 없으면 `approvalRequestId: null`, R-MCP-014)로
MUST 답한다: pending은 −32053 `CLIENT_APPROVAL_REQUIRED`, rejected는 −32054 `CLIENT_APPROVAL_DENIED`, expired는 −32056 `SESSION_EXPIRED`,
revoked·room-rotated는 −32001 `SESSION_INVALID`. notification(id 없음)에는 답하지 않는다. id가 null인 요청은 이보다 먼저 거절된다
(R-MCP-045). room에 붙어 있는 client socket에서 실제로 나오는 것은 pending의 `CLIENT_APPROVAL_REQUIRED`뿐이다. ticket을
rejected·revoked·room-rotated·expired로 바꾸는 모든 경로(R-ROOM-047)와 승인 만료(R-ROOM-026)는 그 ticket의 socket을 먼저 닫고 room에서
떼고, 목록에 없는 socket이나 ticket·room이 만료된 socket의 frame은 해석하기 전에 닫거나 room을 만료 처리한다(R-ROOM-057). 나머지 세 분기는
방어용이다.\
근거: `src/server/peer-server.ts:4027`, `src/server/peer-server.ts:4032`, `src/server/peer-server.ts:4033`, `src/server/peer-server.ts:2432`, `src/server/peer-server.ts:2446`, `src/server/peer-server.ts:1308`, `src/server/peer-server.ts:3979`, `src/server/peer-server.ts:3983`, `src/server/peer-server.ts:2561`, `src/server/peer-server.ts:2559`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:2760`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`; `test/server-error-model.test.ts` › `gives an unapproved ticket's error the same data over HTTP and WebSocket`; `test/server-mcp-routing.test.ts` › `gives a ticket waiting for approval the relay's public discovery, as the HTTP route does`

**R-MCP-030** approved ticket의 `message`에 id가 없으면(notification) relay는 method와 무관하게 `{...frame, from:'client', sessionId}`로
provider에 MUST 전달한다. 다만 `tools/call`은 R-MCP-020의 검사를 먼저 거치고, 거절되면 답 없이 버린다. 참조 provider는 id가 없는 message에
답하지도 그것을 실행하지도 않지만(R-PEER-012), 그런 message를 실행하는 provider에도 catalog가 맞지 않는 호출은 닿지 않는다. provider가 없거나 `busy`·`too-large`면 답 없이 버리고, `closed`면 provider를 분리해 다음 요청이 `PROVIDER_UNAVAILABLE`을
받게 한다. notification에는 답할 수 없으므로(JSON-RPC 2.0 §4.1) 버린 것을 알리지 않는다. HTTP는 같은 경우를 4xx·5xx로 알린다(R-MCP-022).
id가 null인 message는 notification이 아니다(R-MCP-045).\
근거: `src/server/peer-server.ts:4041`, `src/server/peer-server.ts:4043`, `src/server/peer-server.ts:4046`, `src/server/peer-server.ts:4050`, `src/provider/peer-client.ts:1637`; 테스트: `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`; `test/server-mcp-routing.test.ts` › `refuses invalid params, a catalog stamp that is not the room's and an unknown tool before the provider sees them`; `test/server-mcp-routing.test.ts` › `checks a tools/call without an id as one with an id on both transports, and drops one it refuses over WebSocket unanswered`

**R-MCP-031** 같은 agent socket에 id가 엄격히 같은(`===`) 요청이 provider를 기다리고 있으면 relay는 data 없는 −32600
`DUPLICATE_REQUEST_ID`로 MUST 답하고 전달하지 않는다. outbox에서 기다리는 frame은 비교하지 않는다. HTTP에는 이 검사가 없다. HTTP
요청은 저마다 자기 response로 답을 받는 독립 요청이므로, 이미 pending인 id의 HTTP 요청은 wire id로 바꿔 전달한다(R-MCP-003).\
근거: `src/server/peer-server.ts:1286`, `src/server/peer-server.ts:1288`, `src/server/peer-server.ts:4053`, `src/server/peer-server.ts:4054`; 테스트: `test/server-mcp-routing.test.ts` › `refuses a WebSocket request whose id is still pending on its socket, and forwards the same id over HTTP under a wire id`

**R-MCP-032** socket의 pending 수 — room map에서 그 socket의 항목, 그리고 그 outbox에서 기다리는 JSON-RPC 답(`isAgentReplyFrame`: id가
문자열이나 수인 답을 담은 `mcp` frame)의 수 — 가 이미 64 이상이면 relay는 `{code:-32087, message:'TOO_MANY_PENDING_REQUESTS',
data:{limit:64}}`로 MUST 답한다. outbox에서 기다리는 답이 아닌 frame(`approval.pending`, `approval.approved`, `ready`, offer의 `answer`·`release`·`offer.refused`, 종료 frame)은
어느 요청에도 답하지 않으므로 세지 않는다. outbox에 frame이 기다리는 동안 relay는 그 agent의 frame을 처리하지 않으므로(R-WS-040), relay가
요청을 이 상한에 비춰 볼 때 그 outbox는 비어 있다. 그래서 실제로 세어지는 것은 provider를 기다리는 요청이고, 기다리는 답을 세는 규칙은
방어용이다. relay가 세는 요청은 모두 agent가 보내고 아직 답을 받지 못한 것이라, 진행 중인 요청을 세는
agent(R-PEER-035)는 relay보다 적게 세지 않는다. 답 하나가 slot 하나를 비운다. HTTP 요청은 agent별로 세지 않는다(R-MCP-031). 이 상한은
요청을 provider에 전달할지만 정한다. relay가 그 agent에게 쌓아 두는 frame의 상한은 R-MCP-042다.\
근거: `src/server/peer-server.ts:123`, `src/server/peer-server.ts:217`, `src/server/peer-server.ts:336`, `src/server/peer-server.ts:678`, `src/server/peer-server.ts:698`, `src/server/peer-server.ts:768`, `src/server/peer-server.ts:1299`, `src/server/peer-server.ts:1300`, `src/server/peer-server.ts:4057`, `src/server/peer-server.ts:4058`; 테스트: `test/relay-message-limit.test.ts` › `lets an agent socket have at most 64 requests waiting for the provider`; `test/client-pending-limit.test.ts` › `still refuses the 65th request of an agent that does not queue, so the session's queue is what keeps to it`; `test/server-mcp-routing.test.ts` › `handles nothing more of an agent behind on what it asked for, the rest of its read included, and counts its 64 requests once it reads`

**R-MCP-042** relay가 client socket에 직접 만드는 답 — `REQUEST_TOO_LARGE`, `REQUEST_ID_TOO_LARGE`, `INVALID_REQUEST`, `ping`과 metadata
요청의 답(R-MCP-036), 승인 상태 오류(R-MCP-029), `tools/call params are invalid`, `CATALOG_CHANGED`, `TOOL_NOT_FOUND`,
`DUPLICATE_REQUEST_ID`, `TOO_MANY_PENDING_REQUESTS` 자신, `offer.refused` — 은 pending 상한(R-MCP-032)에 막히지 않고 `replyToAgent`로 그
socket의 `AgentOutbox`에 MUST 들어간다(R-WS-031). 그중 id가 문자열이나 수인 JSON-RPC 답은 기다리는 동안 pending 수에 들어간다. relay가 한
agent를 위해 쥐는 frame은 다음으로 MUST 묶인다. outbox에 frame이 기다리기 시작하면 relay는 그 socket을 멈추고, codec은 그 agent의 frame을
이미 읽은 read에 남은 것까지 처리하지 않는다(R-WS-040). 그래서 기다리는 frame은 provider를 기다리던 요청(최대 64, R-MCP-032)의 답, 첫
frame이 기다리게 됐을 때 처리하던 frame 하나의 답, 그리고 그 agent의 승인·offer·session 종료 frame 몇 개뿐이다. agent가 한 read에 요청을
몇 개 담든, 그것이 relay가 스스로 답하는 metadata 요청(catalog 전체를 담는 listing과 `initialize` 포함, 승인을 기다리는 ticket도 보낼 수
있다)이든 마찬가지다. 기다리는 frame은 저마다 262144 byte 이하다(이미 기다리는 frame이 있을 때 그보다 큰 frame은 `too-large`로 거절한다).
relay의 답이 싣는 catalog는 사본이 아니다. relay는 가진 catalog를 얼려(`freezeToolCatalog`) 바꾸지 않고 교체만 하며, 모든 listing과 기다리는
답이 그 하나를 함께 쓴다(`mcpCatalogSnapshot`). 읽지 않는 agent는 stall close(R-WS-026, 1013)로 닫히고 기다리던 frame은 버려진다.\
근거: `src/server/peer-server.ts:1307`, `src/server/peer-server.ts:1311`, `src/server/peer-server.ts:1328`, `src/server/peer-server.ts:688`, `src/server/peer-server.ts:693`, `src/server/peer-server.ts:695`, `src/server/peer-server.ts:699`, `src/server/peer-server.ts:4027`, `src/server/peer-server.ts:4057`, `src/server/peer-server.ts:1419`, `src/server/peer-server.ts:1030`, `src/server/peer-server.ts:1583`, `src/server/peer-server.ts:1955`, `src/server/deployment-catalog.ts:89`, `src/server/deployment-catalog.ts:125`, `src/server/ws-upgrade.ts:762`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`; `test/relay-backpressure.test.ts` › `holds one catalog listing for an agent waiting for approval that does not read, however many one read asks for, and delivers every listing in order once it reads`; `test/relay-backpressure.test.ts` › `lists the one frozen catalog it holds in every reply instead of a copy of its own`; `test/server-mcp-routing.test.ts` › `handles nothing more of an agent behind on what it asked for, the rest of its read included, and counts its 64 requests once it reads`

**R-MCP-033** 붙어 있는 provider가 없으면 relay는 data 없는 −32001 `PROVIDER_UNAVAILABLE`로 MUST 답한다.\
근거: `src/server/peer-server.ts:4063`, `src/server/peer-server.ts:4064`; 테스트: `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`

**R-MCP-034** WebSocket pending 항목은 `includeCatalogMeta`(`params._meta`가 object면, `{}`도 참), `listsCatalog`(`server/discover`는
cursor와 무관하게, `tools/list`는 `params.cursor`가 `undefined`·`null`일 때 참), `server/discover`이면 `params.protocolVersion`으로
협상한 `protocolVersion`(R-MCP-016과 같은 규칙)을 MUST 기록한다.\
근거: `src/server/peer-server.ts:4070`, `src/server/peer-server.ts:4071`, `src/server/peer-server.ts:4079`, `src/server/peer-server.ts:4081`, `src/server/peer-server.ts:4082`; 테스트: `test/relay-message-limit.test.ts` › `answers a tools/list whose catalog the relay refuses with the relay's own catalog, never the refused one`

**R-MCP-035** relay는 `{...frame, from:'client', sessionId, message:<wire id로 바꾼 요청>}`을 provider에 보낸다. provider socket이
받지 못하면 pending 항목을 지우고 요청 id로 MUST 답한다. `too-large`는 `REQUEST_TOO_LARGE`, `busy`는 `PROVIDER_BUSY {retryable:true}`
(provider 유지), `closed`는 `PROVIDER_UNAVAILABLE`이고, `closed`면 그 답 뒤에 provider를 분리하고 `close()`한다
(`detachClosedProvider`: 다른 pending 요청은 `PROVIDER_DISCONNECTED`, codec이 이미 멈췄으면 close는 아무것도 하지 않는다).
`busy`·`too-large`는 어느 socket도 닫지 않고, `closed`도 agent socket은 닫지 않는다. `closed`는 R-MCP-024와 같은 짧은 사이에만 나온다.\
근거: `src/server/peer-server.ts:4084`, `src/server/peer-server.ts:4085`, `src/server/peer-server.ts:4088`, `src/server/peer-server.ts:4089`, `src/server/peer-server.ts:576`, `src/server/peer-server.ts:1512`, `src/server/ws-upgrade.ts:595`; 테스트: `test/server-ws-frames.test.ts` › `answers the agent requests a provider that stops reading cannot take with a retryable PROVIDER_BUSY, and keeps the provider`

**R-MCP-036** WebSocket에서 relay는 MCP method를 다음과 같이 MUST 나눈다. id가 있는 `ping`에는 ticket status와 무관하게 HTTP처럼
`{jsonrpc:'2.0', id, result:{}}`로 직접 답하고 전달하지 않는다. id가 없는 `ping`은 버린다. approved가 아닌 ticket의 id가 있는
`initialize`·`tools/list`·`server/discover`에는 같은 ticket의 HTTP 요청이 받는 relay 응답으로 답한다(공개 discovery, `answerAgentMetadata`).
`initialize`는 R-MCP-016의 WebSocket result(bootstrap catalog가 tool을 다시 담지 않는다), listing은 R-MCP-039의 relay listing, room에 catalog가
없으면 R-MCP-015의 `CATALOG_UNAVAILABLE`이고, `capabilities.tools.listChanged`는 `true`다(이 socket은 catalog 변경을 push 받는다, R-CAT-008).
답이 262144 byte를 넘으면(relay option이 `serverInfo`를 길게 만든 경우 등) 그 id로 `RESULT_TOO_LARGE {limitBytes:262144}`를 보낸다. agent가
요청한 답이므로 버리지 않는다(R-WS-031). approved ticket의 `initialize`·`tools/list`·
`server/discover`와 그 밖의 method는 provider에 전달한다. 그래서 approved ticket의 `initialize`에는 provider가
`negotiateInitializeProtocolVersion`으로 협상해 host의 serverInfo로 답하고(R-PEER-015), listing 답은 room catalog를 갱신할 수 있다(R-CAT-014,
R-MCP-038). approved ticket의 `notifications/initialized`는 notification으로 전달된다(R-MCP-030).\
근거: `src/server/peer-server.ts:4023`, `src/server/peer-server.ts:4024`, `src/server/peer-server.ts:4032`, `src/server/peer-server.ts:1800`, `src/server/peer-server.ts:1802`, `src/server/peer-server.ts:1806`, `src/server/peer-server.ts:1808`, `src/server/peer-server.ts:1811`, `src/server/peer-server.ts:1818`, `src/server/peer-server.ts:1819`, `src/server/peer-server.ts:4084`, `src/provider/peer-client.ts:1700`; 테스트: `test/server-mcp-routing.test.ts` › `answers ping itself for a ticket in any state, and never forwards it`; `test/relay-message-limit.test.ts` › `answers its own WebSocket metadata result over the message limit RESULT_TOO_LARGE instead of dropping it`; `test/server-mcp-routing.test.ts` › `gives a ticket waiting for approval the relay's public discovery, as the HTTP route does`; `test/server-mcp-routing.test.ts` › `answers a waiting ticket's listing CATALOG_UNAVAILABLE while the room has no catalog`; `test/server-mcp-routing.test.ts` › `negotiates initialize and server/discover as the HTTP route does in a provider's room, whichever answers them`

### 7.4 provider 답 처리

**R-MCP-037** relay는 붙어 있는 provider socket의 답(R-MCP-002)을 `rpcKey(id)`로 pending 항목과 맞춘다. id가 문자열·수가 아니거나 맞는
항목이 없으면 조용히 버린다. 맞으면 timer와 항목을 지우고 agent에게 `replyToAgent`(WebSocket은 outbox, HTTP는 bridge)로 MUST 보낸다. 모양은
R-MCP-006, listing이면 R-MCP-038이다.\
근거: `src/server/peer-server.ts:3887`, `src/server/peer-server.ts:3893`, `src/server/peer-server.ts:3894`, `src/server/peer-server.ts:3895`, `src/server/peer-server.ts:3900`; 테스트: `test/relay-message-limit.test.ts` › `delivers a ~200 KB tool result to a WebSocket agent (fragmented by the relay) and keeps both sockets`

**R-MCP-038** `listsCatalog` 답은 다음과 같이 MUST 처리한다.

- room의 snapshot이 `available`이면(R-CAT-005) provider 답을 — result든 오류든, 첫 page든 — 평가하지 않고 agent의 id로 relay 자신의
  listing(R-MCP-039)을 보낸다. 그래서 relay가 catalog를 가진 동안 WebSocket agent는 HTTP agent와 같은 catalog를 같은 모양으로 받는다.
- snapshot이 `available`이 아니면 provider 오류(예: −32090 `CATALOG_UNAVAILABLE`)와 `result.nextCursor`가 `undefined`·`null`이 아닌 답은
  그대로 전달하고, 그 밖은 R-CAT-014로 `result.tools`를 평가한다.
- 평가가 `accepted`(·`unchanged`)면 provider 답을 전달하되, agent가 `_meta`를 보냈는지와 무관하게 `result._meta`에 relay의
  `catalogVersion`·`catalogHash`를 넣는다(`catalogStamp`). provider가 보낸 `result._meta`의 다른 member는 두고 같은 이름은 relay 값으로
  덮는다. 이것이 HTTP listing과 같은 정본 자리다(R-MCP-018). agent가 `_meta`를 보냈으면 같은 값을 `result` 최상위에도 덮어 넣는다. 이
  최상위 stamp는 deprecated이고 호환을 위해 한 minor 동안 남는다.
- 평가가 `invalid`·`too-large`면 −32603 `CATALOG_TOO_LARGE` `{limitBytes:260096, announcementBytes}` 또는 data 없는 −32603
  `CATALOG_INVALID`로 답한다. 거절한 catalog는 절대 넘기지 않는다.

근거: `src/server/peer-server.ts:1742`, `src/server/peer-server.ts:1743`, `src/server/peer-server.ts:1745`, `src/server/peer-server.ts:1747`, `src/server/peer-server.ts:1749`, `src/server/peer-server.ts:1750`, `src/server/peer-server.ts:1751`, `src/server/peer-server.ts:1752`, `src/server/peer-server.ts:1753`, `src/server/peer-server.ts:1756`, `src/server/peer-server.ts:1759`, `src/server/peer-server.ts:1762`, `src/server/peer-server.ts:1771`; 테스트: `test/relay-message-limit.test.ts` › `answers a tools/list whose catalog the relay refuses with the relay's own catalog, never the refused one`; `test/relay-message-limit.test.ts` › `answers CATALOG_TOO_LARGE or CATALOG_INVALID to a tools/list whose catalog the relay refuses while it holds none`; `test/relay-message-limit.test.ts` › `passes on the provider's CATALOG_UNAVAILABLE to a WebSocket listing while the relay holds no catalog`; `test/server-mcp-routing.test.ts` › `stamps a forwarded listing in result._meta, keeping the provider's own _meta members`; `test/relay-message-limit.test.ts` › `takes a catalog from a server/discover result like a tools/list one, and answers a refused one from the relay's catalog`; `test/relay-message-limit.test.ts` › `lets a WebSocket agent list every catalog the relay accepts, up to an announcement of PEER_RELAY_MAX_ANNOUNCEMENT_BYTES`

**R-MCP-039** relay 자신의 WebSocket listing(`relayCatalogListing`)은 같은 ticket의 HTTP 요청이 받는 result다. `tools/list`는 R-MCP-018의
`{tools, _meta:<listing meta>}`이고, `server/discover`는 기록하거나 협상한 version의 R-MCP-019 result에서 `capabilities.tools.listChanged`만
`true`다. listing meta의 `auth.state`는 socket ticket의 status다. agent가 `_meta`를 보냈으면 snapshot의 `catalogVersion`·`catalogHash`를
`result` 최상위에도 넣는다(deprecated, R-MCP-038). relay는 이 모양을 MUST 쓴다. relay가 받아들이는 가장 큰 catalog를 가장 긴 id(1024 byte)로
나열해도 이 답은 262144 byte 안에 든다(R-LIM-017).\
근거: `src/server/peer-server.ts:1783`, `src/server/peer-server.ts:1785`, `src/server/peer-server.ts:1786`, `src/server/peer-server.ts:1787`, `src/server/peer-server.ts:2005`, `src/server/peer-server.ts:2024`; 테스트: `test/relay-message-limit.test.ts` › `answers a WebSocket agent's tools/list and server/discover from the relay's catalog when the provider answers with an error`; `test/relay-message-limit.test.ts` › `takes a catalog from a server/discover result like a tools/list one, and answers a refused one from the relay's catalog`; `test/relay-message-limit.test.ts` › `fits its own listing of the largest catalog it accepts, with the room's listing metadata, under the longest id`

**R-MCP-040** WebSocket agent에게 보낼 답 frame이 relay의 stamp 뒤 262144 byte를 넘어 outbox가 `too-large`를 돌려주면 relay는 대신
agent의 id로 `{code:-32603, message:'RESULT_TOO_LARGE', data:{limitBytes:262144}}`를 MUST 보낸다. 어느 socket도 닫지 않는다.
provider의 같은 이름의 오류도 같은 data key를 가진다(R-PEER-014). HTTP bridge에는 크기 상한이 없어 relay가 이 오류를 만들지 않는다.\
근거: `src/server/peer-server.ts:207`, `src/server/peer-server.ts:3900`, `src/server/peer-server.ts:3901`, `src/server/peer-server.ts:695`, `src/server/peer-server.ts:3380`; 테스트: `test/relay-message-limit.test.ts` › `answers RESULT_TOO_LARGE when the relay's catalog metadata pushes a provider reply over the limit`

**R-MCP-041** 답이 아닌 provider `mcp` message(notification, server→client 요청)는 R-SIG-004대로 approved ticket에 묶인 agent
WebSocket에만 MUST broadcast한다. pending ticket의 socket과 HTTP agent는 받지 못한다. 답(R-MCP-002)은 broadcast하지 않는다. relay가 만드는
`notifications/tools/list_changed`(R-CAT-008)는 room의 모든 client socket에 가고, provider가 보낸 같은 method의 notification은 버린다
(R-SIG-004). 그래서 agent가 받는 `notifications/tools/list_changed`는 언제나 relay의 것이고, 그 `params`의 `catalogVersion`·`catalogHash`는
relay가 `tools/call`을 검사하는(R-MCP-020) 값이다.\
근거: `src/server/peer-server.ts:3887`, `src/server/peer-server.ts:3892`, `src/server/peer-server.ts:3911`, `src/server/peer-server.ts:3912`, `src/server/peer-server.ts:1590`, `src/server/peer-server.ts:1594`, `src/server/peer-server.ts:1370`; 테스트: `test/server-mcp-routing.test.ts` › `drops a provider reply it cannot match to a request instead of broadcasting it to every agent`; `test/server-signaling-frames.test.ts` › `passes a provider's notification only to the agents of an approved ticket`; `test/server-signaling-frames.test.ts` › `drops the provider's own notifications/tools/list_changed, so its agents hear of a catalog change from the relay alone`

**R-MCP-043** relay는 수 id가 유한한지 보지 않으므로 agent는 `JSON.parse`가 유한한 수로 읽는 id를 SHOULD 쓴다. `JSON.parse`는
`1e400`을 `Infinity`로 읽고, 그런 id는 R-MCP-001의 요청이며(수 id는 크기 검사도 없다) pending key는 `number:Infinity`다.
relay가 쓰는 frame과 HTTP body는 모두 `JSON.stringify`를 거치므로 이 id는 wire에서 `null`이 된다: provider에 전달하는 요청도,
relay 자신의 답과 오류도 id null이다. 참조 provider는 id가 null인 요청을 실행하지 않고 id null의 `Invalid Request`로 답하며
(R-PEER-012), relay는 맞출 요청이 없는 그 답을 버린다(R-MCP-002). 그래서 중계한 요청의 pending 항목은 timeout까지 남고, agent는 id
null인 `MCP_REQUEST_TIMEOUT`을 받는다. HTTP와 WebSocket이 같다. `-0`은 key가 `number:0`이고 `0`으로 직렬화되며,
2^53을 넘는 정수 id는 `JSON.parse`가 반올림한 값으로 되돌아간다.\
근거: `src/server/peer-server.ts:1233`, `src/server/peer-server.ts:398`, `src/server/peer-server.ts:1249`, `src/server/peer-server.ts:1245`, `src/server/peer-server.ts:3395`, `src/server/peer-server.ts:3398`, `src/server/peer-server.ts:3410`, `src/server/peer-server.ts:4067`, `src/server/peer-server.ts:4084`, `src/server/peer-server.ts:3912`, `src/provider/tool-call.ts:92`; 테스트: `test/server-mcp-routing.test.ts` › `forwards a request whose id JSON.parse reads as Infinity under id null, and times it out under id null`

### 7.5 버전 협상 요약

| 경로 | 누가 답하나 | `protocolVersion` | capabilities |
|---|---|---|---|
| HTTP `initialize` | relay | 요청값이 initialize-era 4개 중 하나면 그 값, 아니면 `2025-11-25`(`negotiateInitializeProtocolVersion`) | `{tools:{listChanged:false}, stateless:true}` |
| HTTP `server/discover` | relay | 위와 같은 협상, `supportedProtocolVersions` 4개 | `{tools:{listChanged:false}, stateless:true}` |
| HTTP 그 밖 | — | `MCP-Protocol-Version` header가 있으면 initialize-era 값이어야 함(R-MCP-011) | — |
| WebSocket `initialize` | approved ticket: provider. 그 밖: relay | 위와 같은 협상 | `{tools:{listChanged:true}, stateless:true}` |
| WebSocket `server/discover` | relay(room이 catalog를 가진 동안, R-MCP-038; approved가 아닌 ticket은 언제나). catalog가 없는 room의 approved ticket: provider(답의 catalog를 받아들일 때) | 위와 같은 협상, `supportedProtocolVersions` 4개 | `{tools:{listChanged:true}, stateless:true}` |
| DataChannel `initialize` | provider | 위와 같은 협상 | `{tools:{listChanged:true}, stateless:true}` |
| DataChannel `server/discover` | provider | `2026-07-28`, `supportedProtocolVersions` 5개(`MCP_PROTOCOL_VERSIONS`) | `{tools:{listChanged:true}, stateless:true}` |
| `PeerMcpSession.initialize` 요청 | client | `options.protocolVersion ?? '2025-11-25'`. 이후 HTTP 요청은 협상 값을 `MCP-Protocol-Version`으로 보낸다(R-PEER-037) | `{}` |

근거는 R-MCP-016, R-MCP-019, R-MCP-011, R-MCP-036, R-PEER-015, R-PEER-037, R-PEER-039에 있다.

## 8. 오류

**R-ERR-001** relay와 provider는 JSON-RPC 오류를 `{code:<정수>, message:<canonical 이름>, data?}`로 MUST 보낸다. 오류를
식별하는 것은 canonical 이름(UPPER_SNAKE인 `message`, 그것이 없으면 `data.code`, R-ERR-004)이고, JSON-RPC `code`는 그 오류의
class다. 그래서 agent는 오류를 이름으로 MUST 구별하고 code로는 class만 안다. 다시 보내도 되는지는 code가 아니라
`data.retryable === true`(지금은 `PROVIDER_BUSY`뿐, R-PEER-036)로만 판단한다. JSON-RPC 2.0 §5.1의 code(−32700, −32600, −32602,
−32603)는 그 표준 의미 안에서 여러 이름이 쓰고(MCP도 모르는 tool에 −32602를 쓴다), 패키지 class −32000·−32001·−32002·−32003·
−32056도 여러 이름이 쓴다. 이 공유는 표준과 패키지 client의 해석(`canonicalRpcErrorCode`가 `message`를 이름으로 쓴다)에 맞다.
canonical 이름이 없는 오류는 relay·provider의 `tools/call params are invalid`(−32602)와 provider의 `Invalid Request`(−32600),
`Method not found`(−32601), `Internal error`(−32603)뿐이고, 이것들은 JSON-RPC 표준 code로만 식별된다.

| code | class | 이름 |
|---|---|---|
| −32700 | JSON-RPC parse error | `PARSE_ERROR` |
| −32600 | JSON-RPC invalid request | `INVALID_REQUEST`, `REQUEST_ID_TOO_LARGE`, `REQUEST_TOO_LARGE`, `DUPLICATE_REQUEST_ID`, `UNSUPPORTED_PROTOCOL_VERSION` |
| −32602 | JSON-RPC invalid params | `TOOL_NOT_FOUND` |
| −32603 | JSON-RPC internal error | `RESULT_TOO_LARGE`, `CATALOG_INVALID`, `CATALOG_TOO_LARGE`, `BODY_CONSUMED` |
| −32000 | relay가 제공하지 않는 Streamable HTTP 기능 | `SSE_STREAM_NOT_SUPPORTED`, `SESSION_TERMINATION_NOT_SUPPORTED` |
| −32001 | session이나 그 뒤의 provider가 요청을 처리할 수 없음 | `SESSION_INVALID`, `PROVIDER_UNAVAILABLE`, `PROVIDER_BUSY`, `PROVIDER_DISCONNECTED`, `MCP_REQUEST_TIMEOUT`, `CLIENT_DISCONNECTED` |
| −32002 | 요청이 닿은 것과 다른 room·epoch를 지목함 | `ROOM_BINDING_INVALID`, `ROOM_LEASE_BINDING_INVALID`, `SESSION_BINDING_INVALID` |
| −32003 | 유효한 client token 없음 | `CLIENT_TOKEN_REQUIRED`, `CLIENT_TOKEN_INVALID` |
| −32056 | session이나 room이 만료됨 | `SESSION_EXPIRED`, `ROOM_EXPIRED` |
| −32027 | 예약됨: 이 relay와 provider는 내지 않는다(R-ERR-006) | `SOURCE_CHANGED`, `RUNTIME_EPOCH_MISMATCH` |

나머지 code는 이름 하나에만 쓴다: −32004 `ROOM_NOT_FOUND`, −32010 `CATALOG_CHANGED`, −32053 `CLIENT_APPROVAL_REQUIRED`,
−32054 `CLIENT_APPROVAL_DENIED`, −32057 `ROOM_ROTATED`, −32081 `INVALID_APPROVAL`, −32087 `TOO_MANY_PENDING_REQUESTS`, −32088
`PUBLISH_RATE_LIMITED`, −32089 `PUBLISH_RATE_LIMIT_UNAVAILABLE`, −32090 `CATALOG_UNAVAILABLE`.\
근거: `src/config/errors.ts:19`, `src/config/errors.ts:74`, `src/server/peer-server.ts:179`, `src/server/peer-server.ts:181`, `src/server/peer-server.ts:187`, `src/server/peer-server.ts:1307`, `src/server/peer-server.ts:1273`, `src/provider/peer-client.ts:1649`, `src/provider/peer-client.ts:1716`, `src/provider/peer-client.ts:1748`, `src/client/errors.ts:68`, `src/client/session.ts:272`; 테스트: `test/live-demo.e2e.test.ts` › `resolves canonical error names from numeric JSON-RPC errors`; `test/live-demo.e2e.test.ts` › `reports a revoked session as SESSION_INVALID instead of catalog drift`; `test/client-busy-retry.test.ts` › `is the only kind retried: %s is reported at once`

**R-ERR-002** relay의 수명주기 HTTP 오류 body는 `lifecycleErrorBody`의 `{error:<이름>, code?:<정수>, …문맥 필드}`이고 status는 아래
표를 MUST 따른다. `code`는 이름이 JSON-RPC code를 가질 때만 있고, 그 이름의 JSON-RPC 오류와 같은 값이다(R-ERR-005).
MCP endpoint(`POST`·`GET`·`DELETE /p/:id/mcp`의 JSON-RPC 응답)는 `{jsonrpc:'2.0', id, error}` 모양이다. `/p/:id/mcp` 경로에도
수명주기 모양으로 답하는 경우가 다섯 있다. 허용되지 않은 host는 403 `{error:'HOST_NOT_ALLOWED', host}`(R-HTTP-020), 허용되지 않은
Origin은 `OPTIONS` preflight든 그 밖의 method든 403 `{error:'ORIGIN_NOT_ALLOWED', origin}`(R-HTTP-010, R-HTTP-011)이다. method가
`OPTIONS`·`GET`·`POST`·`DELETE`가 아니면(예: `PUT`, `PATCH`, `HEAD`) 405 `{error:'METHOD_NOT_ALLOWED'}`와 `Allow: GET, POST`
(R-HTTP-022), id가 `[A-Za-z0-9_-]{1,128}`에 맞지 않으면 404 `{error:'NOT_FOUND'}`(R-HTTP-001, R-HTTP-002)다. 잡히지 않은 예외는 500 `{error:'PEER_REQUEST_FAILED'}` 또는 `formatHttpError`가 정한 `{error, requestId?}`(R-HTTP-003)다.
WebSocket upgrade를 거절하는 HTTP 응답의 body도 이 수명주기 모양이다(R-WS-038). `customHttpHandler`가 먼저 답한 응답은 이 규칙 밖이다.\
근거: `src/server/peer-server.ts:510`, `src/server/peer-server.ts:511`, `src/server/peer-server.ts:2090`, `src/server/peer-server.ts:2958`, `src/server/peer-server.ts:2968`, `src/server/peer-server.ts:2984`, `src/server/peer-server.ts:3764`, `src/server/peer-server.ts:3033`, `src/server/peer-server.ts:3159`, `src/server/peer-server.ts:3166`, `src/server/peer-server.ts:3261`, `src/server/peer-server.ts:3323`, `src/server/peer-server.ts:3767`, `src/server/peer-server.ts:2113`, `src/server/peer-server.ts:924`, `src/server/peer-server.ts:941`; 테스트: `test/client-request-limit.test.ts` › `surfaces the relay's HTTP 413 REQUEST_TOO_LARGE as a JSON-RPC error of that call only`; `test/server-error-model.test.ts` › `puts the code of an error's JSON-RPC namesake in its lifecycle body`

**R-ERR-003** relay와 provider는 아래 표의 오류를 표의 code, status, close code, data로, 표의 조건에서 MUST 낸다. 표는 이 문서의
다른 요건이 규정한 오류를 한곳에 모은 것이며, 둘이 어긋나면 해당 요건이 우선한다. "—"는 해당 없음, "200(진행)"은 진행 중인 HTTP
요청에 200으로 전달된다는 뜻이다.\
근거: `src/server/peer-server.ts:2432`, `src/server/peer-server.ts:2873`, `src/server/peer-server.ts:4027`; 테스트: `test/server-pending-settlement.test.ts` › `answers ROOM_EXPIRED when the sweeper expires the room %s`

**R-ERR-004** agent client는 relay의 JSON-RPC 오류를 `PeerMcpRpcError`로 MUST 올린다. 그 `code`는 canonical 이름이다: 문자열
`error.code`, 아니면 UPPER_SNAKE인 `data.code`, 아니면 UPPER_SNAKE인 `message`, 아니면 `MCP_RPC_ERROR`. HTTP transport는 JSON-RPC
오류 body가 있는 non-2xx에 `error.httpStatus`와, `Retry-After` header가 있으면 그것이 정한 지연(delay-seconds 또는 HTTP-date까지 남은
시간)을 `error.retryAfterMs`(ms)로 붙이고(id가 null이면 요청 id로 채움), 그 밖의 non-2xx는 `{code:'HTTP_<status>',
message: body.error || statusText || 'MCP endpoint failed'}`로 만든다. 로컬 오류는 문자열 code의 `PeerMcpError`다.\
근거: `src/client/errors.ts:15`, `src/client/errors.ts:68`, `src/client/transport.ts:253`, `src/client/transport.ts:258`, `src/client/transport.ts:262`, `src/client/transport.ts:264`, `src/client/transport.ts:265`, `src/client/transport.ts:275`; 테스트: `test/live-demo.e2e.test.ts` › `resolves canonical error names from numeric JSON-RPC errors`; `test/live-demo.e2e.test.ts` › `reports a revoked session as SESSION_INVALID instead of catalog drift`

**R-ERR-005** canonical 이름 하나는 agent가 받는 모든 자리(relay·provider의 JSON-RPC 오류, 수명주기 body의 `code`)에서 code를
하나만 MUST 가진다. relay와 provider는 code를 `PEER_ERROR_CODES`(`src/config/errors.ts`, 두 tier가 함께 쓰는 내부 표)에서 얻는다.
그래서 provider의 `CLIENT_APPROVAL_REQUIRED`는 relay와 같은 −32053이고, 수명주기 body의 `ROOM_NOT_FOUND`(−32004),
`ROOM_EXPIRED`(−32056), `CLIENT_TOKEN_REQUIRED`·`CLIENT_TOKEN_INVALID`(−32003), `CATALOG_UNAVAILABLE`(−32090),
`BODY_CONSUMED`(−32603)도 JSON-RPC 쪽과 같은 code를 싣는다. 표에 없는 이름(예: `NOT_FOUND`, `PROVIDER_TOKEN_*`,
`INVITE_TOKEN_*`, `ROOM_LEASE_REQUIRED`·`ROOM_LEASE_INVALID`·`ROOM_LEASE_EXPIRED`, `SESSION_NOT_FOUND`, `SESSION_NOT_OWNED`,
`INVALID_PATH`, `METHOD_NOT_ALLOWED`, `HOST_NOT_ALLOWED`, `ORIGIN_NOT_ALLOWED`, `ROOM_CAPACITY_EXCEEDED`, upgrade의 `BAD_UPGRADE`·`UNSUPPORTED_WEBSOCKET_VERSION`·`SUBPROTOCOL_REQUIRED`)은 code 없이 보낸다. 한 이름은 한 조건만 뜻한다. `ROOM_EXPIRED`는 room 만료이고 살아 있는 room의 reconnect lease
만료는 `ROOM_LEASE_EXPIRED`다(R-ROOM-014). `SESSION_BINDING_INVALID`는 409 binding 불일치이고 다른 session을 지목한 client revoke는
`SESSION_NOT_OWNED`다(R-ROOM-040). `ROOM_ROTATED`는 rotate된 room이고 rotate body의 binding 불일치는 `ROOM_BINDING_INVALID`다
(R-ROOM-042). 같은 오류의 data도 transport와 발신자에 따라 key가 다르지 않다. 승인되지 않은 ticket의 오류는 두 transport 모두
`{roomId, sessionId, approvalRequestId, approvalRequired}`(R-MCP-014, R-MCP-029), `RESULT_TOO_LARGE`는 relay와 provider 모두
`{limitBytes}`(R-MCP-040, R-PEER-014), `CATALOG_UNAVAILABLE`은 모두 `{catalogSource, …}`(relay는 deployment catalog의 source,
provider는 `provider`와 `reason`, R-MCP-015, R-PEER-011)다. 예외는 relay가 provider에게 보내는 signaling `error` frame(R-SIG-021)이며,
수신자가 다른 family라 자기 code를 쓴다(`register` 거절 `CATALOG_INVALID`·`CATALOG_TOO_LARGE`는 frame에서 −32602, agent의 listing
답에서는 −32603, R-MCP-038).\
근거: `src/config/errors.ts:19`, `src/config/errors.ts:69`, `src/config/errors.ts:74`, `src/server/peer-server.ts:510`, `src/server/peer-server.ts:511`, `src/server/peer-server.ts:2432`, `src/server/peer-server.ts:2446`, `src/server/peer-server.ts:1760`, `src/provider/peer-client.ts:1656`, `src/provider/peer-client.ts:1675`, `src/provider/tool-call.ts:260`; 테스트: `test/server-error-model.test.ts` › `puts the code of an error's JSON-RPC namesake in its lifecycle body`; `test/server-error-model.test.ts` › `gives an unapproved ticket's error the same data over HTTP and WebSocket`; `test/server-error-model.test.ts` › `refuses a client revoke naming another session with SESSION_NOT_OWNED, not a binding error`; `test/provider-reconnect.test.ts` › `ignores a restored approval for another room epoch`; `test/provider-tool-call.test.ts` › `answers a non-tools/call request with a JSON-RPC error`; `test/provider-register-limit.test.ts` › `answers CATALOG_UNAVAILABLE, with the withheld catalog's error, when no catalog was sent to the room`

**R-ERR-006** −32027과 그 이름 `SOURCE_CHANGED`·`RUNTIME_EPOCH_MISMATCH`, 그리고 −32010 class의 이름 `CATALOG_STALE`은 예약된 값이다. 이
relay와 provider는 이것들을 MUST NOT 내고, −32027을 다른 의미로도 쓰지 않는다(`PEER_ERROR_CODES`에 없다). agent client는 다른 relay와의 호환을
위해 이것들을 catalog drift로 분류한다(R-PEER-044). agent가 `tools/list`·`tools/call`의 `params._meta.runtimeEpoch`로 보내는 값(R-PEER-040,
R-PEER-043)은 relay와 provider가 해석하지 않는 정보 필드이고, relay는 `_meta.sessionId`도 보지 않는다(R-MCP-020).\
근거: `src/client/errors.ts:52`, `src/client/errors.ts:54`, `src/client/errors.ts:56`, `src/config/errors.ts:19`, `src/client/session.ts:1430`, `src/client/session.ts:1475`; 테스트: `test/live-demo.e2e.test.ts` › `only treats registry drift codes as catalog changes`

### 8.1 오류 표

행은 relay MCP JSON-RPC 오류, provider JSON-RPC·tool 결과 오류, signaling `error` frame, relay HTTP 수명주기 오류(body
`{error, …}`), WebSocket upgrade 거절과 close code, agent client·provider 로컬 오류(wire에 나가지 않음) 순서다. "code" 열은
JSON-RPC code 또는 수명주기 body의 `code` 필드다.

| 이름 | code (JSON-RPC·body) | HTTP status | close | data | 발신 | 조건 | 근거 |
|---|---|---|---|---|---|---|---|
| `PARSE_ERROR` | −32700 | 400 | — | 없음, id null | relay HTTP | MCP body가 UTF-8·JSON이 아님(빈 body, 맨 앞 BOM 하나를 지운 뒤 남은 두 번째 BOM 포함) | `src/server/peer-server.ts:3257`, `src/server/peer-server.ts:384` |
| `INVALID_REQUEST` | −32600 | 400(HTTP) | — | 없음 | relay(HTTP, WS, `offer.refused`) | JSON-RPC 요청이 아님, batch, `id: null`(두 transport), id가 있는 `notifications/*`(두 transport, R-MCP-045). HTTP는 해석 실패와 `id: null`에 id null, `notifications/*`에 그 id. WS는 문자열·수·null id를 echo. offer의 `requestId`가 비어 있지 않은 문자열이 아님(requestId 없음, R-SIG-017) | `src/server/peer-server.ts:3260`, `src/server/peer-server.ts:3267`, `src/server/peer-server.ts:3271`, `src/server/peer-server.ts:4004`, `src/server/peer-server.ts:4011`, `src/server/peer-server.ts:1395` |
| `REQUEST_ID_TOO_LARGE` | −32600 | 400(HTTP) | — | `{limitBytes:1024}`, id null 또는 requestId 없음 | relay | 문자열 id·offer requestId의 JSON이 1024 byte 초과 | `src/server/peer-server.ts:212`, `src/server/peer-server.ts:3259`, `src/server/peer-server.ts:4000`, `src/server/peer-server.ts:1399` |
| `REQUEST_TOO_LARGE` | −32600 | 413(HTTP) | — | `{limitBytes:261120}` | relay(HTTP, WS, `offer.refused`) | 요청이 받은 그대로나 재직렬화로 261120 byte 초과, 또는 provider `send`가 `too-large` | `src/server/peer-server.ts:179`, `src/server/peer-server.ts:3250`, `src/server/peer-server.ts:3277`, `src/server/peer-server.ts:4018` |
| `DUPLICATE_REQUEST_ID` | −32600 | — | — | 없음 | relay WS(`offer.refused` 포함) | 같은 socket에 `===` 같은 id가 pending. offer의 `requestId`가 room의 다른 socket의 offer 경로(R-SIG-017) | `src/server/peer-server.ts:4054`, `src/server/peer-server.ts:1408` |
| `UNSUPPORTED_PROTOCOL_VERSION` | −32600 | 400 | — | `{supported:[4개], requested}` | relay HTTP | `initialize`가 아닌 POST의 지원하지 않는 `MCP-Protocol-Version` | `src/server/peer-server.ts:3288` |
| `TOO_MANY_PENDING_REQUESTS` | −32087 | — | — | `{limit:64}`. offer는 `{limit:1}` | relay WS(`offer.refused` 포함) | socket pending + outbox에서 기다리는 JSON-RPC 답이 64 이상(R-MCP-032). socket의 offer가 아직 answer를 기다림(R-LIM-044) | `src/server/peer-server.ts:217`, `src/server/peer-server.ts:4058`, `src/server/peer-server.ts:227`, `src/server/peer-server.ts:1403` |
| `PROVIDER_UNAVAILABLE` | −32001 | 503 | — | 없음 | relay(HTTP, WS, `offer.refused`) | provider socket 없음, 또는 `send`가 `closed`(provider 분리) | `src/server/peer-server.ts:181`, `src/server/peer-server.ts:3358`, `src/server/peer-server.ts:4064` |
| `PROVIDER_BUSY` | −32001 | 503 + `Retry-After: 1` | — | `{retryable:true}` | relay(HTTP, WS, `offer.refused`) | provider 송신 queue가 가득 참. provider 유지 | `src/server/peer-server.ts:187`, `src/server/peer-server.ts:1561` |
| `PROVIDER_DISCONNECTED` | −32001 | 200(진행) | — | 없음 | relay | pending 중 provider socket이 닫힘·교체·분리, server 종료. answer를 기다리던 offer는 `offer.refused`(R-SIG-026) | `src/server/peer-server.ts:1852`, `src/server/peer-server.ts:1491` |
| `MCP_REQUEST_TIMEOUT` | −32001 | 200(진행) | — | 없음 | relay | `mcpRequestTimeoutMs` 안에 답 없음. offer는 answer가 없으면 `offer.refused`(R-SIG-026) | `src/server/peer-server.ts:3395`, `src/server/peer-server.ts:4068`, `src/server/peer-server.ts:1426` |
| `CLIENT_DISCONNECTED` | −32001 | wire에 안 나감 | — | 없음 | relay 내부 | HTTP response가 쓰기 전에 닫힘 | `src/server/peer-server.ts:3392` |
| `SESSION_INVALID` | −32001 | 401(새 요청, `WWW-Authenticate: Bearer error="invalid_token"`), 200(진행) | — | 새 요청은 `{roomId, sessionId, approvalRequestId, approvalRequired}`(없는 값은 `null`, 두 transport 같음), 진행·종료는 없음 | relay | revoked·room-rotated ticket(room-rotated의 HTTP 요청은 R-MCP-013이 먼저 거절하고, 붙은 socket에서는 닿지 않음, R-MCP-029), 전체 revoke의 진행 요청, revoke된 ticket socket의 pending 요청, revoke된 ticket의 client upgrade(401 응답, R-WS-007) | `src/server/peer-server.ts:2438`, `src/server/peer-server.ts:2762`, `src/server/peer-server.ts:2879`, `src/server/peer-server.ts:4028`, `src/server/peer-server.ts:2191` |
| `CLIENT_TOKEN_REQUIRED` | −32003 | 401, `WWW-Authenticate: Bearer` | — | `{roomId, sessionId, approvalRequestId, approvalRequired}`(없는 값은 `null`, 두 transport 같음) | relay HTTP | 중계 method에 Bearer 자격이 없음 | `src/server/peer-server.ts:2434`, `src/server/peer-server.ts:3326` |
| `CLIENT_TOKEN_INVALID` | −32003 | 401, `WWW-Authenticate: Bearer error="invalid_token"` | — | `{roomId, sessionId, approvalRequestId, approvalRequired}`(없는 값은 `null`, 두 transport 같음) | relay HTTP | 중계 method의 Bearer token을 room이 발급하지 않음 | `src/server/peer-server.ts:2434`, `src/server/peer-server.ts:3326` |
| `ROOM_NOT_FOUND` | −32004 | 404 | — | `{roomId}` | relay HTTP | 중계 method의 모르는 room | `src/server/peer-server.ts:3310` |
| `CATALOG_CHANGED` | −32010 | 409(HTTP) | — | `{catalogVersion, catalogHash}`(relay 현재 값) | relay | `tools/call`의 `_meta` catalog 값이 room과 다름(id가 없는 WS `tools/call`은 답 없이 버린다) | `src/server/peer-server.ts:1278`, `src/server/peer-server.ts:4043` |
| `SOURCE_CHANGED`, `RUNTIME_EPOCH_MISMATCH`, `CATALOG_STALE` | −32027, −32010 | — | — | — | 없음(예약) | 이 relay와 provider는 내지 않는다. client는 drift로 분류한다(R-ERR-006) | `src/client/errors.ts:52`, `src/client/errors.ts:56` |
| `CLIENT_APPROVAL_REQUIRED` | −32053 | 403 | — | `{roomId, sessionId, approvalRequestId, approvalRequired}`(없는 값은 `null`, 두 transport 같음) | relay | pending ticket | `src/server/peer-server.ts:2435`, `src/server/peer-server.ts:2446`, `src/server/peer-server.ts:4033` |
| `CLIENT_APPROVAL_DENIED` | −32054 | 403 | — | 위와 같음, 종료 시 pending 요청은 없음 | relay | rejected ticket(WS는 붙은 socket에서 닿지 않음, R-MCP-029), 거절된 ticket socket의 pending 요청, 거절된 ticket의 client upgrade(403 응답, R-WS-007) | `src/server/peer-server.ts:2436`, `src/server/peer-server.ts:2762`, `src/server/peer-server.ts:2878`, `src/server/peer-server.ts:2191` |
| `SESSION_EXPIRED` | −32056 | 410 | — | 위와 같음 | relay | expired ticket(예: 승인 만료. WS는 붙은 socket에서 닿지 않음, R-MCP-029), 만료된 ticket의 client upgrade(410 응답, 방어용, R-WS-007) | `src/server/peer-server.ts:2437`, `src/server/peer-server.ts:4033`, `src/server/peer-server.ts:2191` |
| `ROOM_EXPIRED` (MCP) | −32056 | 410(새 요청), 200(진행) | — | `{roomId, roomEpoch}`(두 transport 같음) | relay | 중계 method의 만료 room(HTTP), room 만료 처리가 끝낸 진행 요청(HTTP, 만료된 ticket socket의 WebSocket pending 요청) | `src/server/peer-server.ts:3318`, `src/server/peer-server.ts:2877`, `src/server/peer-server.ts:2762` |
| `ROOM_ROTATED` (MCP) | −32057 | 410(새 요청), 200(진행) | — | `{replacementRoomId, roomId, roomEpoch}`(두 transport 같음) | relay | 중계 method의 rotate된 room, rotate가 끝낸 진행 요청, rotate된 ticket socket의 pending 요청 | `src/server/peer-server.ts:3314`, `src/server/peer-server.ts:2875`, `src/server/peer-server.ts:2762` |
| `CATALOG_UNAVAILABLE` (relay) | −32090 | 503(HTTP) | — | `{catalogSource}` | relay(HTTP, approved가 아닌 ticket의 WS) | `tools/list`·`server/discover`에 room catalog도 deployment catalog도 없음(R-MCP-015) | `src/server/peer-server.ts:3330`, `src/server/peer-server.ts:1808` |
| `tools/call params are invalid` | −32602 | 400(HTTP) | — | 없음 | relay, provider | `tools/call`에 비어 있지 않은 문자열 `name`이 없음 | `src/server/peer-server.ts:1273`, `src/server/peer-server.ts:4043`, `src/provider/peer-client.ts:1748` |
| `TOOL_NOT_FOUND` | −32602 | 400(HTTP) | — | 없음 | relay | room catalog에 없는 tool 이름(id가 없는 WS `tools/call`은 답 없이 버린다) | `src/server/peer-server.ts:1281`, `src/server/peer-server.ts:4043` |
| `RESULT_TOO_LARGE` (relay) | −32603 | — | — | `{limitBytes:262144}` | relay WS(`offer.refused` 포함) | stamp 뒤 provider 답 frame, relay 자신의 metadata 답(R-MCP-036), 다시 쓴 offer `answer`(R-SIG-019)가 262144 byte 초과 | `src/server/peer-server.ts:207`, `src/server/peer-server.ts:3901`, `src/server/peer-server.ts:1819`, `src/server/peer-server.ts:1472` |
| `CATALOG_TOO_LARGE` (listing 답) | −32603 | — | — | `{limitBytes:260096, announcementBytes}` | relay WS | catalog 없는 room에서 listing 답의 announcement 초과 | `src/server/peer-server.ts:1760` |
| `CATALOG_INVALID` (listing 답) | −32603 | — | — | 없음 | relay WS | catalog 없는 room에서 listing 답의 catalog 무효 | `src/server/peer-server.ts:1761` |
| `BODY_CONSUMED` (MCP) | −32603 | 500 | — | 없음, id null | relay HTTP | 앞선 reader가 MCP body를 읽음 | `src/server/peer-server.ts:219`, `src/server/peer-server.ts:3244` |
| `SSE_STREAM_NOT_SUPPORTED` | −32000 | 405, `Allow: GET, POST` | — | 없음, id null | relay HTTP | SSE만 받는 `GET /p/:id/mcp` | `src/server/peer-server.ts:3166` |
| `SESSION_TERMINATION_NOT_SUPPORTED` | −32000 | 405, `Allow: GET, POST` | — | 없음, id null | relay HTTP | `DELETE /p/:id/mcp` | `src/server/peer-server.ts:3171` |
| `Invalid Request` | −32600 | — | — | 없음, id null | provider | `jsonrpc:'2.0'`이지만 id가 문자열·수가 아닌 요청(null 포함, R-PEER-012). 실행하지 않는다. relay는 id가 없거나 문자열·수인 요청만 전달하므로(R-MCP-045) relay socket으로는 오지 않고, 만들어져 relay에 가더라도 맞출 요청이 없는 답이라 버린다(R-MCP-002) | `src/provider/peer-client.ts:1649`, `src/server/peer-server.ts:1233`, `src/server/peer-server.ts:3912` |
| `Method not found` | −32601 | 200 | — | 없음 | provider | 처리하지 않는 method | `src/provider/peer-client.ts:1716` |
| `Internal error` | −32603 | 200 | — | 없음 | provider | 요청 처리 중 예외 | `src/provider/peer-client.ts:1608` |
| `CLIENT_APPROVAL_REQUIRED` (provider) | −32053 | 200 | — | 없음 | provider | provider의 approvalState가 `approved`가 아님(relay와 같은 code, R-ERR-005) | `src/provider/peer-client.ts:1656` |
| `CATALOG_UNAVAILABLE` (provider) | −32090 | 200 | — | `{catalogSource:'provider', reason}` | provider | 중계된 `tools/list`·`server/discover`에 등록한 catalog가 없거나 거절됨 | `src/provider/peer-client.ts:1675` |
| `RESULT_TOO_LARGE` (provider) | −32603(`tools/call` 외) | 200 | — | `{limitBytes:262144}`(relay와 같은 key). `tools/call`은 `isError` 결과의 `error.code:'RESULT_TOO_LARGE'`(문자열). DataChannel 답은 `{limitCodeUnits:1048576}` | provider | provider 답 frame이 relay socket에서 262144 byte, DataChannel에서 1048576 UTF-16 code unit 초과(R-PEER-014) | `src/provider/tool-call.ts:277`, `src/provider/tool-call.ts:260`, `src/provider/tool-call.ts:294`, `src/provider/tool-call.ts:305` |
| `AI_RUN_TERMINAL`, `AI_RUN_LIMIT_EXCEEDED`, `AI_RUN_REJECTED`, `RECONCILIATION_REQUIRED` | — | 200 | — | `isError` 결과의 문자열 `error.code` | provider | 종료된 run, 128 run 모두 진행 중, 그 밖의 run 시작 실패, ledger의 outcome-unknown 기록 | `src/provider/peer-client.ts:1768`, `src/provider/peer-client.ts:1791`, `src/provider/peer-client.ts:1806` |
| host 예외 | — | 200 | — | `isError` 결과의 `error.code: -32603`(수) | provider | host `invoke`가 던짐 | `src/provider/peer-client.ts:1888` |
| `CATALOG_INVALID` (frame) | −32602 | — | — | `reason`, `registerSeq?` | relay→provider | register catalog 무효 | `src/server/peer-server.ts:1707` |
| `CATALOG_TOO_LARGE` (frame) | −32602 | — | — | `limitBytes:260096`, `reason`, `registerSeq?` | relay→provider | announcement가 260096 byte 초과 | `src/server/peer-server.ts:1709` |
| `INVALID_APPROVAL` (frame) | −32081 | — | — | `requestId`(문자열 또는 null) | relay→provider | `approval.decision`이 무효이거나 대상 요청이 없음 | `src/server/peer-server.ts:3868` |
| `HOST_NOT_ALLOWED` | — | 403 | — | `{host}` | relay | Host 검사를 켠 relay(R-HTTP-020)에 허용되지 않은 host(신뢰한 proxy의 host나 요청의 `Host`)로 온 HTTP 요청·upgrade | `src/server/peer-server.ts:1097`, `src/server/peer-server.ts:2958`, `src/server/peer-server.ts:3781` |
| `ORIGIN_NOT_ALLOWED` | — | 403, `Vary: Origin` | — | `{origin}` | relay | 허용되지 않은 Origin의 preflight, 그 밖 요청, upgrade(R-HTTP-011) | `src/server/peer-server.ts:550`, `src/server/peer-server.ts:2968`, `src/server/peer-server.ts:2984`, `src/server/peer-server.ts:3786` |
| `METHOD_NOT_ALLOWED` | — | 405, `Allow`: route의 method | — | — | relay | relay route에 그 route가 받지 않는 method(R-HTTP-022) | `src/server/peer-server.ts:430`, `src/server/peer-server.ts:3764` |
| `NOT_FOUND` | — | 404 | — | — | relay | 맞는 route 없음(id 문법 불일치 포함), socket endpoint가 아닌 경로의 upgrade(R-WS-001) | `src/server/peer-server.ts:3767`, `src/server/peer-server.ts:4132` |
| `PEER_REQUEST_FAILED` | — | 500 | — | `{requestId?}` | relay | 처리되지 않은 예외(hook 없음) | `src/server/peer-server.ts:941` |
| `INVALID_PATH` | — | 400 | — | — | relay | approval·session status·경로형 revoke의 경로 parameter가 잘못된 percent-encoding | `src/server/peer-server.ts:567`, `src/server/peer-server.ts:3497`, `src/server/peer-server.ts:3549`, `src/server/peer-server.ts:3612` |
| `BODY_TOO_LARGE` | — | 413 | — | — | relay | JSON body가 65536 byte 초과(drain 안) | `src/server/peer-server.ts:2382` |
| `INVALID_JSON_BODY` | — | 400 | — | — | relay | JSON body가 UTF-8·JSON·object가 아님 | `src/server/peer-server.ts:2389` |
| `BODY_CONSUMED` | −32603 | 500 | — | — | relay | 앞선 reader가 JSON body를 읽음 | `src/server/peer-server.ts:2378` |
| `PUBLISH_RATE_LIMITED` | −32088 | 429 | — | `{retryAfterMs}`, `Retry-After`, `X-RateLimit-*` | relay | `POST /p`·rotate rate 초과 | `src/server/peer-server.ts:2299` |
| `PUBLISH_RATE_LIMIT_UNAVAILABLE` | −32089 | 503 | — | `{retryAfterMs:1000}`, `Retry-After: 1`, `X-RateLimit-*` | relay | rate-limit store 실패 | `src/server/peer-server.ts:2299` |
| `ROOM_CAPACITY_EXCEEDED` | — | 503 | — | `{retryAfterMs}`, `Retry-After` | relay | `POST /p`나 rotate가 `maxRooms`개를 가진 relay에 room을 더함(R-LIM-047) | `src/server/peer-server.ts:1137`, `src/server/peer-server.ts:3063`, `src/server/peer-server.ts:3711` |
| `PUBLISH_KEY_REQUIRED` | — | 401, `WWW-Authenticate: Bearer` | — | — | relay | publish key 설정 시 token 없음 | `src/server/peer-server.ts:2272`, `src/server/peer-server.ts:3033` |
| `PUBLISH_KEY_INVALID` | — | 401, `WWW-Authenticate: Bearer error="invalid_token"` | — | — | relay | 틀린 publish key | `src/server/peer-server.ts:2274`, `src/server/peer-server.ts:3033` |
| `PUBLISH_OWNER_BINDING_INVALID` | — | 403 | — | — | relay | owner 힌트 충돌 | `src/server/peer-server.ts:3049` |
| `CAPABILITIES_INVALID` | — | 400 | — | — | relay | `POST /p`·join의 capabilities 무효 | `src/server/peer-server.ts:3059`, `src/server/peer-server.ts:3443` |
| `ROOM_NOT_FOUND` | −32004 | 404 | — | — | relay | 수명주기 route의 room 없음·교체(보존 기한이 지나 지운 room 포함, R-ROOM-051), provider·client upgrade의 room 없음(R-WS-004) | `src/server/peer-server.ts:2144`, `src/server/peer-server.ts:3084`, `src/server/peer-server.ts:3422`, `src/server/peer-server.ts:3554`, `src/server/peer-server.ts:2162` |
| `ROOM_ROTATED` | −32057 | 410 | — | `{roomId, roomEpoch, replacementRoomId}` | relay | 모든 수명주기 route(join, session status, reclaim, approval, 두 revoke, rotate)의 rotate된 room(R-ROOM-046), provider·client upgrade의 rotate된 room(R-WS-004) | `src/server/peer-server.ts:2126`, `src/server/peer-server.ts:2145`, `src/server/peer-server.ts:3084`, `src/server/peer-server.ts:3422`, `src/server/peer-server.ts:3558`, `src/server/peer-server.ts:2162` |
| `ROOM_BINDING_INVALID` | −32002 | 409 | — | `{roomId, roomEpoch}`(현재 epoch) | relay | rotate되지 않은 room의 rotate body가 다른 roomId·roomEpoch를 지목 | `src/server/peer-server.ts:3706` |
| `ROOM_EXPIRED` | −32056 | 410 | — | `{roomId, roomEpoch}` | relay | 보존 중인 만료 room의 join, reclaim, approval, 두 revoke, rotate(R-ROOM-070. rotate 검사가 먼저), provider·client upgrade의 만료 room(R-WS-004) | `src/server/peer-server.ts:2131`, `src/server/peer-server.ts:2132`, `src/server/peer-server.ts:2146`, `src/server/peer-server.ts:2162` |
| `ROOM_LEASE_EXPIRED` | — | 410 | — | `{roomId, roomEpoch}` | relay | 살아 있는 room의 reclaim에 reconnect lease 만료(R-ROOM-014) | `src/server/peer-server.ts:3085`, `src/server/peer-server.ts:3086` |
| `ROOM_LEASE_REQUIRED` | — | 400 | — | — | relay | reclaim에 leaseToken 없음 | `src/server/peer-server.ts:3098` |
| `ROOM_LEASE_BINDING_INVALID` | −32002 | 409 | — | `{roomId, roomEpoch}` | relay | reclaim body에 있는 epoch·roomId의 불일치(R-ROOM-071) | `src/server/peer-server.ts:3108` |
| `ROOM_LEASE_INVALID` | — | 403 | — | — | relay | lease hash 불일치 | `src/server/peer-server.ts:3103` |
| `ROOM_PROVIDER_ACTIVE` | — | 409 | — | `{roomId, roomEpoch}` | relay | provider socket이 붙어 있는 room의 reclaim | `src/server/peer-server.ts:3112` |
| `INVITE_TOKEN_REQUIRED` | — | 400 | — | — | relay | join에 invite 없음 | `src/server/peer-server.ts:3430` |
| `INVITE_TOKEN_INVALID` | — | 403 | — | — | relay | 틀린 invite(소비 여부와 무관) | `src/server/peer-server.ts:3434` |
| `INVITE_TOKEN_CONSUMED` | — | 409 | — | — | relay | 맞는 invite가 이미 소비됨 | `src/server/peer-server.ts:3438` |
| `CRDT_CAPABILITY_NOT_GRANTED` | — | 403 | — | — | relay | room에 없는 `mcp-crdt` 요청 | `src/server/peer-server.ts:3447` |
| `PROVIDER_TOKEN_REQUIRED` | — | 401, `WWW-Authenticate: Bearer` | — | — | relay | approval·rotate에 Bearer 자격 없음, provider upgrade에 `ticket.` 항목 없음(R-WS-006) | `src/server/peer-server.ts:2174`, `src/server/peer-server.ts:3827` |
| `PROVIDER_TOKEN_INVALID` | — | 401, `WWW-Authenticate: Bearer error="invalid_token"` | — | — | relay | approval·rotate의 token, provider upgrade의 ticket이 현재 providerToken이 아님(R-WS-006) | `src/server/peer-server.ts:2175`, `src/server/peer-server.ts:3827` |
| `INVALID_APPROVAL` | −32081 | 409 | — | — | relay | HTTP 결정 body 불일치, 이미 결정됨 | `src/server/peer-server.ts:3518`, `src/server/peer-server.ts:3524` |
| `CLIENT_TOKEN_REQUIRED` | −32003 | 401, `WWW-Authenticate: Bearer` | — | — | relay | session status·client revoke에 Bearer 자격 없음, client upgrade에 `ticket.` 항목 없음(R-WS-007) | `src/server/peer-server.ts:3567`, `src/server/peer-server.ts:3654`, `src/server/peer-server.ts:2191` |
| `CLIENT_TOKEN_INVALID` | −32003 | 401, `WWW-Authenticate: Bearer error="invalid_token"` | — | — | relay | session status·client revoke의 token이 providerToken도 room의 client token도 아님, client upgrade의 ticket을 room이 발급하지 않음(R-WS-007) | `src/server/peer-server.ts:3572`, `src/server/peer-server.ts:3659`, `src/server/peer-server.ts:2191` |
| `SESSION_NOT_FOUND` | — | 404 | — | — | relay | providerToken으로 모르는 session | `src/server/peer-server.ts:3581`, `src/server/peer-server.ts:3641` |
| `SESSION_BINDING_INVALID` | −32002 | 409 | — | — | relay | revoke body에 있는 roomId·roomEpoch의 불일치(R-ROOM-071) | `src/server/peer-server.ts:3628`, `src/server/peer-server.ts:3669` |
| `SESSION_NOT_OWNED` | — | 403 | — | — | relay | client token이 자기 것이 아닌 session의 status를 묻거나 revoke를 지목 | `src/server/peer-server.ts:3576`, `src/server/peer-server.ts:3665` |
| `CATALOG_UNAVAILABLE` (GET) | −32090 | 503 | — | `{catalogVersion:<snapshot, 이때 0>, catalogHash, auth?}` | relay | `GET /p/:id/mcp/tools`·`GET /mcp/catalog`에 catalog가 없음(R-CAT-005의 `available`이 거짓) | `src/server/peer-server.ts:3135`, `src/server/peer-server.ts:3225` |
| `CATALOG_HASH_NOT_FOUND` | — | 404 | — | `{catalogHash:<현재>}` | relay | 현재가 아닌 catalog hash | `src/server/peer-server.ts:3140` |
| upgrade 중 예외 | — | 없음(파기) | — | — | relay | URL 해석·hook 등 upgrade 처리 중 잡히지 않은 예외(R-WS-002) | `src/server/peer-server.ts:4133`, `src/server/peer-server.ts:930` |
| `BAD_UPGRADE` | — | 400 | — | — | relay, relay codec | opening handshake 위반: `GET`·HTTP/1.1·`Upgrade: websocket`·`Connection: upgrade`·16 byte key(R-WS-008) | `src/server/ws-upgrade.ts:247`, `src/server/ws-upgrade.ts:261`, `src/server/ws-upgrade.ts:479`, `src/server/peer-server.ts:3808` |
| `UNSUPPORTED_WEBSOCKET_VERSION` | — | 426, `Sec-WebSocket-Version: 13`, `Upgrade: websocket`, `Connection: Upgrade, close` | — | — | relay, relay codec | `Sec-WebSocket-Version`이 13이 아님(없음 포함, R-WS-008) | `src/server/ws-upgrade.ts:252`, `src/server/ws-upgrade.ts:257` |
| `SUBPROTOCOL_REQUIRED` | — | 400 | — | — | relay | upgrade가 `webmcp-peer.v1`을 제시하지 않음(R-WS-010) | `src/server/peer-server.ts:3814`, `src/server/peer-server.ts:3815` |
| `RESERVED_BITS`, `RESERVED_OPCODE`, `UNMASKED_FRAME`, `BAD_CONTROL_FRAME`, `INTERLEAVED`, `BAD_CONTINUATION`, `BAD_CLOSE_PAYLOAD` | — | — | 1002 | — | relay codec | R-WS-013, R-WS-014, R-WS-019 | `src/server/ws-upgrade.ts:629`, `src/server/ws-upgrade.ts:634`, `src/server/ws-upgrade.ts:377` |
| `TEXT_ONLY` | — | — | 1003 | — | relay codec | binary frame | `src/server/ws-upgrade.ts:631` |
| `INVALID_UTF8` | — | — | 1007 | — | relay codec | UTF-8이 아닌 text message | `src/server/ws-upgrade.ts:751` |
| `FRAGMENT_LIMIT`, `FRAME_LIMIT`, `MESSAGE_LIMIT` | — | — | 1009 | — | relay codec | R-WS-015, R-WS-016 | `src/server/ws-upgrade.ts:640`, `src/server/ws-upgrade.ts:652`, `src/server/ws-upgrade.ts:660` |
| owner 예외 | — | — | 1011 | — | relay codec | `onText` 예외(relay에서는 나오지 않음) | `src/server/ws-upgrade.ts:789` |
| stall | — | — | 1013 | — | relay codec | R-WS-026 | `src/server/ws-upgrade.ts:545` |
| 최종 close | — | — | 1000 | — | relay | 종료 frame 뒤의 close(2.4 표) | `src/server/peer-server.ts:2561`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:3744` |
| going away | — | — | 1001 | — | relay | relay `close()`, liveness timeout(R-WS-039) | `src/server/peer-server.ts:969`, `src/server/ws-upgrade.ts:725` |
| `SUPERSEDED` (close) | — | — | 4001 | — | relay | provider socket 교체·분리, ticket당 socket 상한(R-WS-030) | `src/server/peer-server.ts:1512`, `src/server/peer-server.ts:4122` |
| `ROOM_EXPIRED` (close) | — | — | 4002 | — | relay | room 만료 처리의 provider socket(R-ROOM-050) | `src/server/peer-server.ts:2924` |
| `REQUEST_TOO_LARGE` (client) | 문자열 | — | — | `{bytes, limitBytes:261120}` | client | 보낼 frame·body가 261120 byte 초과 | `src/client/transport.ts:80` |
| `REQUEST_ID_TOO_LARGE` (client) | 문자열 | — | — | `{bytes, limitBytes:1024}` | client | raw가 아닌 transport의 문자열 id가 1024 byte 초과 | `src/client/transport.ts:97` |
| `DUPLICATE_REQUEST_ID` (client) | 문자열 | — | — | `{method, id}` | client | 요청 id가 진행 중인 요청(`request()`부터 답이 오거나 연결이 끝날 때까지: 연결·slot·답·재시도 대기, 보내는 중, HTTP POST 중, timeout이나 연결을 끝내지 않는 오류 뒤 답을 기다리는 요청. 다음 연결이 다시 쓰는 transport에서는 끝난 연결의 아직 도는 send와 그 연결에 나간 그 요청도)의 id와 `String(id)`가 같음. 보내지 않는다(R-PEER-032) | `src/client/session.ts:129` |
| `REQUEST_TIMEOUT` | 문자열 | — | — | `{method, id}` | client | 요청(slot 대기 포함) 시간 초과 | `src/client/session.ts:1087`, `src/client/session.ts:1337` |
| `TRANSPORT_TIMEOUT` | 문자열 | — | — | 없음 | client | socket이 열리지 않은 채 ready 대기 시간 초과 | `src/client/session.ts:788` |
| `PEER_TRANSPORT_ERROR` | 문자열 | — | — | 받은 relay `error` frame, 또는 Error가 아닌 transport 오류 값 | client | 문자열 `code`가 없는 relay `error` frame(있으면 그 문자열이 code다), Error가 아닌 transport 오류 | `src/client/session.ts:882`, `src/client/session.ts:883`, `src/client/session.ts:933` |
| `TRANSPORT_CLOSED`, `SESSION_DISCONNECTED`, `TRANSPORT_NOT_OPEN`, `NOT_CONNECTED`, `ROOM_ID_REQUIRED`, `INVALID_TRANSPORT`, `TRANSPORT_UNAVAILABLE` | 문자열 | — | — | `TRANSPORT_CLOSED`는 close code를 알린 transport면 `{code, reason}`(R-PEER-045), 그 밖은 없음 | client | transport 닫힘·끊음, 열리기 전 send, transport 없음 | `src/client/session.ts:954`, `src/client/session.ts:955`, `src/client/session.ts:124`, `src/client/transport.ts:152` |
| `CATALOG_INTEGRITY_UNVERIFIED` | 문자열 | — | — | `{catalogHash, computedHash}` | client | relay가 준 `catalogHash`가 tools의 hash와 다름(R-PEER-041) | `src/client/session.ts:1519` |
| `ROOM_ID_INVALID` | 문자열 | — | — | 없음 | client | caller가 준 room 값이 room id 문법(R-HTTP-002)에 맞는 id를 담지 않음(R-PEER-054) | `src/client/transport.ts:63` |
| `TOOL_NAME_REQUIRED`, `TOOL_NOT_FOUND` (client), `INVALID_TOOL_RESULT`, `INVALID_RESPONSE`, `INVALID_TOOLS_LIST`, `INVALID_TOOL_DESCRIPTOR`, `TOOL_NAME_TOO_LONG`, `DUPLICATE_TOOL`, `MCP_RPC_ERROR`, `HTTP_<status>` | 문자열 | — | — | — | client | R-PEER-033~R-PEER-044 | `src/client/session.ts:1461`, `src/client/session.ts:1465`, `src/client/catalog-hash.ts:84`, `src/client/errors.ts:23` |
| `CATALOG_CHANGED` (`PeerMcpCatalogChangedError`) | 문자열 | — | — | catalog snapshot | client | drift 오류를 받고 catalog를 새로 읽은 뒤 | `src/client/session.ts:1486` |
| `SESSION_REVOKED`, `ROOM_ROTATED`, `ROOM_EXPIRED`, `APPROVAL_EXPIRED`, `SESSION_EXPIRED`, `CLIENT_APPROVAL_DENIED` (client) | 문자열 | — | — | 받은 frame | client | relay 종료 frame(R-PEER-038), `waitForPeerApproval` 상태(R-PEER-048) | `src/client/session.ts:256`, `src/client/session.ts:850`, `src/client/room-lifecycle.ts:236`, `src/client/room-lifecycle.ts:241` |
| `CLIENT_TOKEN_REQUIRED`, `SESSION_REVOKE_FAILED`, `INVITE_TOKEN_REQUIRED`, `INVALID_JOIN_RESPONSE`, `SESSION_REQUIRED`, `INVALID_SESSION_STATUS`, `APPROVAL_ABORTED`, `APPROVAL_TIMEOUT`, `PROVIDER_TOKEN_REQUIRED`, `INVALID_ROTATE_RESPONSE`, `SESSION_NOT_FOUND` (service) | 문자열 | — | — | — | client | 수명주기 helper(R-PEER-046~R-PEER-051, R-PEER-055) | `src/client/session.ts:1626`, `src/client/session.ts:1656`, `src/client/room-lifecycle.ts:110`, `src/client/room-lifecycle.ts:146`, `src/client/room-lifecycle.ts:245`, `src/client/service.ts:74` |
| `CATALOG_TOO_LARGE` (session error) | — | — | — | 문자열 | provider | register frame이 258048 byte 초과 | `src/provider/peer-client.ts:417` |
| `ROOM_LEASE_LOST` (session error) | — | — | — | 문자열 | provider | auto-reconnect가 내민 저장 lease를 relay가 거절했거나 lease가 없음. 새 room을 열지 않고 멈춘다(R-PEER-024) | `src/provider/peer-client.ts:81`, `src/provider/peer-client.ts:960` |
| `CLIENT_APPROVAL_DENIED`, `SESSION_REVOKED`, `APPROVAL_EXPIRED`, `SESSION_EXPIRED`, `ROOM_ROTATED` (session error) | — | — | — | 문자열 | provider | relay가 session을 끝낸 frame(R-PEER-021). 다시 붙은 socket의 `ready`가 `ticketEnded`로 그 끝을 알리면 그 attach(`connect()`, auto-reconnect)도 이 이름으로 실패한다(R-PEER-004) | `src/provider/peer-client.ts:113`, `src/provider/peer-client.ts:1012`, `src/provider/peer-client.ts:1015` |
| `ROOM_EXPIRED`, `PEER_SESSION_SUPERSEDED`, `SIGNALING_CLOSED` (session error) | — | — | — | 문자열 | provider | provider socket이 4002, 4001, 그 밖의 최종 close code로 닫힘. 재접속하지 않는다(R-PEER-025) | `src/provider/peer-client.ts:86`, `src/provider/peer-client.ts:91`, `src/provider/peer-client.ts:1197`, `src/provider/peer-client.ts:1201` |
| `Signaling connection timeout`, `Signaling WebSocket error`, `Signaling socket closed unexpectedly`, `ROOM_PROVIDER_ACTIVE`, `INVALID_ROOM_DESCRIPTOR`, `INVALID_RECLAIMED_ROOM_DESCRIPTOR`, `PEER_SESSION_NOT_CONFIGURED`, `PEER_SESSION_SUPERSEDED` | — | — | — | — | provider | R-PEER-001~R-PEER-005, R-PEER-024, R-PEER-026 | `src/provider/peer-client.ts:998`, `src/provider/peer-client.ts:1033`, `src/provider/peer-client.ts:1038`, `src/provider/peer-client.ts:953`, `src/provider/peer-client.ts:898`, `src/provider/peer-client.ts:948`, `src/provider/peer-client.ts:2276` |

signaling frame의 reason 값: `approval.expired`는 `APPROVAL_EXPIRED`, `approval.rejected`는 결정 reason 또는 `CLIENT_APPROVAL_DENIED`,
`session.revoked`는 `SESSION_REVOKED`·`CLIENT_REVOKED`·`ROOM_REVOKED`, client용 `room.rotated`는 `ROOM_ROTATED`, `room.expired`는
`ROOM_EXPIRED`다.

## 9. peer 의무

### 9.1 provider (`WebMcpPeerClient`)

**R-PEER-001** provider는 `connect()`에서 먼저 `disconnect()`하고 serverUrl을 `normalizePeerConfigUrl`로 정규화한다(trim, 끝 `/`
제거, `http://`·`https://`로 시작하지 않으면(대소문자 무시) `http://` 붙임. `refreshRoom`과 agent client의 `normalizeServerUrl`도
같은 규칙이다). 그다음 `POST <serverUrl>/p`를 `Content-Type: application/json`,
`Authorization: Bearer <publishKey || 'local-development-only'>`, body `{alias, title, capabilities}`로 MUST 보낸다.
`capabilities`는 `enableCrdt === true`면 `['mcp-control','mcp-crdt']`, 아니면 `['mcp-control']`이다. `approvalRequired`와
`ttlMs`는 보내지 않으므로 provider가 만든 room은 언제나 승인이 필요하고 기본 TTL이다. 520-526은 Cloudflare edge 오류로, 그 밖의
non-2xx는 body `error` 또는 `HTTP <status>: Failed to create signaling room`으로 실패한다.\
근거: `src/provider/peer-client.ts:845`, `src/provider/peer-client.ts:851`, `src/provider/peer-client.ts:873`, `src/provider/peer-client.ts:883`, `src/provider/peer-client.ts:888`, `src/provider/peer-client.ts:895`, `src/config/invitation.ts:13`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/provider-reconnect.test.ts` › `builds them like the agent client from a server URL of any scheme case`

**R-PEER-002** provider는 `POST /p`, reclaim, rotate의 descriptor가 protocol의 room id 문법(`WEBMCP_ROOM_ID_PATTERN`,
R-HTTP-002)에 맞는 `id`와 비어 있지 않은
`providerToken`, `descriptorUrl`, `inviteToken`을 가지는지 MUST 검사하고, 아니면 `INVALID_ROOM_DESCRIPTOR`(reclaim은
`INVALID_RECLAIMED_ROOM_DESCRIPTOR`)로 실패한다. 형식이 틀린 선택 필드(safe integer ≥ 0이 아닌 `roomEpoch`, 유한하지 않은
`expiresAt`·`reconnectTokenExpiresAt`, 문자열이 아닌 capability)는 거절하지 않고 버린다. 초대 URL은
`<descriptorUrl>#invite=<inviteToken>`(인코딩 없음)이다. 로컬 만료는 descriptor의 `expiresAt`이 미래면 그 값, 아니면 now + 30분
(`ROOM_EXPIRY_FALLBACK_MS`)이다. 30분은 `expiresAt`을 보내지 않는 relay를 위한 fallback이다. 이 relay는 모든 room descriptor에
`expiresAt`을 담으므로(R-ROOM-013) 그 값이 쓰인다.\
근거: `src/config/types.ts:25`, `src/provider/wire-schemas.ts:110`, `src/provider/wire-schemas.ts:105`, `src/provider/peer-client.ts:213`, `src/provider/peer-client.ts:216`, `src/provider/peer-client.ts:984`, `src/provider/peer-client.ts:987`; 테스트: `test/provider-reconnect.test.ts` › `refuses a room descriptor with %s as INVALID_ROOM_DESCRIPTOR, opening no socket`; `test/provider-reconnect.test.ts` › `refuses a reclaimed room descriptor it cannot use as INVALID_RECLAIMED_ROOM_DESCRIPTOR`; `test/provider-reconnect.test.ts` › `drops the malformed optional members of a descriptor, and assumes a room of 30 minutes without expiresAt`

**R-PEER-003** provider는 `<serverUrl의 앞 http를 ws로(대소문자 무시)>/p/<encodeURIComponent(id)>/provider`를 subprotocol
`[WEBMCP_SUBPROTOCOL, 'ticket.<providerToken>']`(`['webmcp-peer.v1', 'ticket.<providerToken>']`)으로 MUST 연다. reclaim, rotate,
session revoke의 URL도 같은 방법(`relayRoomUrl`)으로 roomId를 encode해 만든다. agent client의 `websocketUrl`(R-PEER-030)과 같은
규칙이다.\
근거: `src/provider/peer-client.ts:204`, `src/provider/peer-client.ts:205`, `src/provider/peer-client.ts:206`, `src/provider/peer-client.ts:937`, `src/provider/peer-client.ts:991`, `src/provider/peer-client.ts:992`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/provider-reconnect.test.ts` › `builds them like the agent client from a server URL of any scheme case`

**R-PEER-004** provider는 `type:'ready'` frame을 최대 10000 ms MUST 기다린다. 그 전의 다른 frame은 무시한다. 시간이 지나면
`Signaling connection timeout`, socket 오류면 `Signaling WebSocket error`, `ready` 전에 socket이 닫히면(state가 아직 `creating`이거나,
그 socket이 현재 socket이 아니거나, generation이 바뀌었을 때) `Signaling socket closed unexpectedly`로 실패한다. `ready`가 왔지만
generation이 바뀌었으면 `PEER_SESSION_SUPERSEDED`다. timeout이나 socket 오류로 실패해도 provider는 그 socket을 닫지도 떼지도 않고
`ready` handler도 남겨 둔다. 그래서 같은 generation에 늦게 온 `ready`는 `connect()`가 이미 거절된 뒤에도 아래 처리를 모두 한다.
`ready`를 받으면 state를 `waiting`으로 하고 재접속 횟수를 0으로 되돌리고, 25000 ms마다 `{type:'ping', timestamp}`를 보내는
keepalive를 시작하고, 첫 `register`를 보내고, 같은 read에 이어 오는 승인 frame(pending 재전송, `approval.restored`)을 놓치지 않도록
정상 상태 handler를 동기적으로 단다. 다만 `ready`의 `ticketEnded`가 session을 끝내는 frame type(R-PEER-021)이면, 곧 그 room의
ticket이 이 provider의 socket이 없는 동안 끝났으면(R-ROOM-053), provider는 그 대신 그 frame을 받은 것처럼 session을 MUST 끝내고(lease
삭제, transport 정리, 재접속 없음) 그 session error로 실패한다. 그래서 그 attach를 부른 `connect()`와 auto-reconnect(R-PEER-024,
R-PEER-025)는 `ready` 뒤 frame을 언제 읽든 이미 끝난 session으로 성공하지 않는다. 뒤이어 오는 replay frame은 끝난 generation의 것이라
아무것도 바꾸지 않는다. `ready`의 roomEpoch·capabilities·expiresAt은 읽지 않고 descriptor 값을 쓴다. relay의 `pong`은
무시한다.\
근거: `src/provider/peer-client.ts:997`, `src/provider/peer-client.ts:998`, `src/provider/peer-client.ts:1001`, `src/provider/peer-client.ts:1003`, `src/provider/peer-client.ts:1012`, `src/provider/peer-client.ts:1014`, `src/provider/peer-client.ts:1015`, `src/provider/peer-client.ts:1018`, `src/provider/peer-client.ts:1020`, `src/provider/peer-client.ts:1021`, `src/provider/peer-client.ts:1024`, `src/provider/peer-client.ts:1028`, `src/provider/peer-client.ts:1031`, `src/provider/peer-client.ts:1033`, `src/provider/peer-client.ts:1035`, `src/provider/peer-client.ts:1037`, `src/provider/peer-client.ts:1038`, `src/provider/peer-client.ts:901`, `src/provider/peer-client.ts:1059`, `src/provider/peer-client.ts:1311`; 테스트: `test/provider-reconnect.test.ts` › `are not lost when they arrive in the same read as ready`; `test/provider-reconnect.test.ts` › `serves an approved client announced right after ready, in the same read`; `test/provider-reconnect.test.ts` › `sends a keepalive ping every 25 s while it is attached`; `test/provider-reconnect.test.ts` › `gives up on a provider socket that sends no ready within 10 s`; `test/server-provider-reattach.test.ts` › `fails a reloaded page's reconnect to a room whose ticket ended while the page was away (%s), with the session ended`

**R-PEER-005** provider가 relay socket에 보내는 모든 frame(`register`, `mcp` 답, `answer`, `release`, `ping`, `approval.decision`)은
`sendRelayFrame`을 거친다. 직렬화한 UTF-8 크기가 262144 byte를 넘으면 보내지 않고 `console.warn('[WebMCP] The <n>-byte <label>
frame exceeds the relay's 262144-byte message limit; it was not sent.')`을 남긴다. `ws.send`가 던져도 보내지 않은 것이다. provider는
262144 byte를 넘는 frame을 MUST NOT 보낸다.\
근거: `src/provider/peer-client.ts:172`, `src/provider/peer-client.ts:175`, `src/provider/peer-client.ts:181`, `src/provider/tool-call.ts:52`; 테스트: `test/provider-register-limit.test.ts` › `does not send an approval decision over the limit, and leaves the request pending`; `test/provider-register-limit.test.ts` › `drops the answer to an offer whose requestId takes it over the limit, and keeps the provider socket`

**R-PEER-006** provider는 `ready` 뒤와 `syncTools()`마다 `{type:'register', alias, registerSeq, tools}`를 MUST 보낸다.
`registerSeq`는 이전 값 + 1이고 client 객체 수명 동안(연결·room을 넘어) 계속 증가한다. host `listTools`가 던지면 아무것도 보내지
않고 번호도 쓰지 않는다. 직렬화하고 나면 번호를 쓴 것이며, 보냈든 보류했든 socket이 거절했든 마찬가지다.\
근거: `src/provider/peer-client.ts:396`, `src/provider/peer-client.ts:399`, `src/provider/peer-client.ts:403`, `src/provider/peer-client.ts:413`; 테스트: `test/provider-register-limit.test.ts` › `stamps every register frame with a registerSeq that keeps increasing, across connections too`

**R-PEER-007** `syncTools()`는 frame을 열린(readyState 1) socket에 넘겼을 때만 `true`를 MUST 돌려준다.\
근거: `src/provider/peer-client.ts:364`, `src/provider/peer-client.ts:367`, `src/provider/peer-client.ts:370`, `src/provider/peer-client.ts:424`; 테스트: `test/relay-message-limit.test.ts` › `withholds a register frame over 256 KiB, reports CATALOG_TOO_LARGE on an open socket, and registers once the catalog shrinks`

**R-PEER-008** register, `tools/list`, `server/discover`는 모두 `toWireToolDescriptor(tool)` = `{name, title?(truthy일 때만),
description, inputSchema(기본 {type:'object', properties:{}}), outputSchema?, annotations?}`를 MUST 쓴다. 그래서 relay catalog가
채널마다 흔들리지 않는다.\
근거: `src/provider/types.ts:115`, `src/provider/types.ts:123`; 테스트: `test/catalog-contract.test.ts` › `publishes the same descriptor via register and tools/list so the relay catalog never flaps`; `test/catalog-contract.test.ts` › `serializes host tools deterministically with an MCP-valid inputSchema`

**R-PEER-009** UTF-8 크기가 258048 byte(`PEER_RELAY_MAX_CATALOG_BYTES`)를 넘는 register frame을 provider는 MUST NOT 보낸다. socket은
열어 두고 relay에는 알리지 않으며, session error를 `CATALOG_TOO_LARGE: the register frame for N tool(s) is B bytes, over the relay
protocol's 258048-byte catalog limit`로 정한다. 정확히 258048 byte면 보낸다. frame을 socket에 넘기면 `CATALOG_INVALID`·
`CATALOG_TOO_LARGE`로 시작하는 session error를 지운다. session error가 바뀔 때마다 구독자에게 알린다.\
근거: `src/provider/peer-client.ts:415`, `src/provider/peer-client.ts:417`, `src/provider/peer-client.ts:428`, `src/provider/peer-client.ts:458`; 테스트: `test/provider-register-limit.test.ts` › `sends a register frame of exactly the catalog limit and withholds one a byte larger`; `test/provider-register-limit.test.ts` › `notifies a CATALOG_TOO_LARGE set during connect() to a listener subscribed before it, and the cleared error later`

**R-PEER-010** `message`가 정확히 `CATALOG_INVALID` 또는 `CATALOG_TOO_LARGE`인 relay `error` frame은 거절 문구
`<message>: <reason ?? 'relay rejected the tool catalog'>`가 된다. provider는 frame의 `registerSeq`가 없거나 마지막으로 보낸
catalog의 번호와 같으면 그 catalog에 거절을 기록하고, `registerSeq`가 없거나(이전 relay) 최신 번호(보냈든 보류했든)와 같을 때만
session error로 MUST 삼는다. 더 오래된 번호의 거절은 무시한다. 다른 relay `error` frame(예: −32081 `INVALID_APPROVAL`)은 기록만
하고 상태를 바꾸지 않는다.\
근거: `src/provider/peer-client.ts:1224`, `src/provider/peer-client.ts:1226`, `src/provider/peer-client.ts:1229`, `src/provider/peer-client.ts:1232`, `src/provider/peer-client.ts:1240`; 테스트: `test/provider-register-limit.test.ts` › `ignores the late rejection of an earlier register once a newer one was sent`; `test/provider-register-limit.test.ts` › `takes a rejection without registerSeq, from a relay that predates it, to answer the latest register`; `test/provider-reconnect.test.ts` › `does not report unrelated relay errors as a catalog failure`

**R-PEER-011** relay socket으로 온 `tools/list`·`server/discover`에 provider는 현재 (serverUrl, roomId)에 마지막으로 보낸 register
frame의 tools(보낸 직렬화 그대로)로 MUST 답한다. live host catalog로 답하지 않는다. 이 room에 보낸 frame이 없거나 relay가 그것을
거절했으면 relay의 같은 오류(R-MCP-015)와 같은 code·data key의 `{code:-32090, message:'CATALOG_UNAVAILABLE', data:{catalogSource:'provider',
reason}}`이다. `catalogSource`는 없는 catalog가 provider가 등록하는 것임을 뜻한다. reason은 거절 문구, 현재 `CATALOG_*` session error,
또는 `the provider has not registered a tool catalog with this relay room`이다. reclaim한 room(같은 roomId)은 끊기기 전 등록한
catalog를 계속 쓴다. DataChannel로 온 요청에는 live host catalog로 답한다.\
근거: `src/provider/peer-client.ts:444`, `src/provider/peer-client.ts:446`, `src/provider/peer-client.ts:453`, `src/provider/peer-client.ts:1667`, `src/provider/peer-client.ts:1675`; 테스트: `test/provider-register-limit.test.ts` › `answers tools/list and server/discover with the last registered catalog while a larger one is withheld`; `test/provider-register-limit.test.ts` › `answers CATALOG_UNAVAILABLE, with the withheld catalog's error, when no catalog was sent to the room`; `test/provider-register-limit.test.ts` › `answers CATALOG_UNAVAILABLE when the relay refused the last catalog sent, also after a newer one was withheld`; `test/provider-register-limit.test.ts` › `lists the catalog as it was sent, not host descriptors changed in place since`; `test/provider-register-limit.test.ts` › `lists the live host catalog to a DataChannel agent, which talks to the provider directly`

**R-PEER-012** provider는 `jsonrpc:'2.0'`이고 `id` member가 있는 object에만 MUST 답한다(id 없음은 notification이라 답하지도 실행하지도
않는다). id가 문자열이나 수가 아니면, null을 포함해(MCP는 null id를 금지한다, R-MCP-045) 요청을 실행하지 않고 `{id:null,
error:{code:-32600, message:'Invalid Request'}}`로 답한다(`rpcRequestId`는 문자열·수 id만 돌려준다). 끝난 connection generation의 요청은
실행하지도 답하지도 MUST NOT 한다: generation을 바꾸는 일(연결 해제, 재연결, rotate, 만료, revoke, 최종 close)은 그 전의 relay socket과
DataChannel을 먼저 닫으므로 답이 갈 곳이 없고, 두 channel의 frame 처리기는 지난 generation의 frame을 해석하기 전에 버린다. 요청 처리기도
요청을 읽기 전에 generation을 다시 보고 버린다. frame을 읽는 동안 host code가 연결을 끝낼 수 있기 때문이다(DataChannel의 `tools/call`은
먼저 그 agent를 host의 CRDT transport에 알린다). 요청을 읽은 뒤 provider가 부르는 host code(host adapter의 `getServerInfo`, DataChannel의
`tools/list`·`server/discover`가 부르는 `listTools`, ledger store, host의 tool, `tools/call`의 run을 알리는 `subscribeAiRuns` listener)도
연결을 끝낼 수 있으므로, 모든 요청은 method와 channel(relay socket, DataChannel)에 관계없이 답이 준비된 뒤(요청 처리기가 돌아오거나 던진
뒤) generation을 다시 보고, 끝났으면 답하지 않는다. 처리기가 던진 예외의 −32603 `Internal error`도 그렇다(예외는 기록한다). 답을 내는 곳
하나(`answerMcpRpc`)가 이것을 보고, 그 앞의 검사는 끝난 연결을 위해 host code가 돌지 않게 할 뿐이다. 그래서 `tools/call`은 host를 부를
때까지 그런 host code가 돌 때마다 generation을 다시 본다(R-PEER-016). 실행 중에 generation이 끝난 `tools/call`은 R-PEER-016이다.
provider 하나의 room 단위 `approvalState`가 `approved`가 아니면 relay socket의 모든 method에 relay와 같은
code의 −32053 `CLIENT_APPROVAL_REQUIRED`(R-ERR-005)다. relay가 승인했지만 provider가 아직 모르는 agent(relay의 `approval.approved`나
`approval.restored`가 오기 전, R-PEER-019, R-PEER-020)도 이 오류를 그대로 받으므로 code로 분기하는 agent도 승인 대기로 읽는다. DataChannel은 승인 상태에서만 frame을 받으므로 그 전의 요청은 답 없이 버린다.
relay socket의 요청은 relay가 찍은 `sessionId`(R-SIG-005)가 승인한 session(`approvalSessionId`)과 같을 때만 처리하고, 다르거나 없으면 같은
−32053 `CLIENT_APPROVAL_REQUIRED`로 답한다(room epoch당 ticket은 하나다, R-ROOM-005). `from`과 `params._meta.sessionId`는 보지 않는다. `ping`은 `result:{}`, 모르는 method는 −32601 `Method not found`, 예상하지 못한 예외는 −32603 `Internal error`다.\
근거: `src/provider/peer-client.ts:1636`, `src/provider/peer-client.ts:1637`, `src/provider/peer-client.ts:1647`, `src/provider/peer-client.ts:1649`, `src/provider/tool-call.ts:89`, `src/provider/tool-call.ts:92`, `src/provider/peer-client.ts:1644`, `src/provider/peer-client.ts:1565`, `src/provider/peer-client.ts:1656`, `src/provider/peer-client.ts:1508`, `src/provider/peer-client.ts:1708`, `src/provider/peer-client.ts:1716`, `src/provider/peer-client.ts:1608`, `src/provider/peer-client.ts:1068`, `src/provider/peer-client.ts:1069`, `src/provider/peer-client.ts:1655`, `src/provider/peer-client.ts:1055`, `src/provider/peer-client.ts:1466`, `src/provider/peer-client.ts:1322`, `src/provider/peer-client.ts:1342`, `src/provider/peer-client.ts:1786`, `src/provider/peer-client.ts:1603`, `src/provider/peer-client.ts:1606`; 테스트: `test/provider-reconnect.test.ts` › `ignores a restored approval for another room epoch`; `test/provider-tool-call.test.ts` › `answers a request with id null as an invalid request and does not run it`; `test/provider-approval-state.test.ts` › `is answered CLIENT_APPROVAL_REQUIRED and not run, as one without the relay's session stamp is`; `test/provider-data-channel.test.ts` › `is neither run nor answered when the host ended the session as the agent's tools/call reached its CRDT transport`; `test/provider-tool-call.test.ts` › `is neither run, nor answered, nor left in a run when %s ends the session`; `test/provider-tool-call.test.ts` › `is not answered, %s, when the host adapter's getServerInfo ends the session and %s`; `test/provider-data-channel.test.ts` › `is not answered when the host's listTools ends the session as the provider lists the catalog for %s`; `test/provider-tool-call.test.ts` › `answers nothing for a call whose session ended while the ledger lookup that then failed was pending`

**R-PEER-013** `tools/call`은 비어 있지 않은 문자열 `params.name`이 MUST 있어야 하고, 없으면 −32602 `tools/call params are invalid`다.
`arguments`가 object가 아니면 `{}`다. host를 `invoke(name, args, {signal})`로 부른다(`stopAiRun`이 abort한다). host를 부른 결과와
run·ledger 규칙(R-PEER-016)으로 거절하거나 되풀이한 결과는 언제나 JSON-RPC `result`(CallToolResult)다. `tools/call`이 JSON-RPC `error`로
답하는 것은 이 params 무효(−32602)뿐이다(R-PEER-012의 거절은 이보다 앞선다). 실행 중에 connection이 끝난 호출에는 답하지 않는다(R-PEER-016).
host 값이 비어 있지 않은 MCP content block 목록(`text`, `image`, `audio`, `resource_link`, `resource`), object
`structuredContent`, boolean `isError` 중 하나를 가지면 CallToolResult로 보고 `isError`를 다시 계산해
(`res.isError === true`, 또는 `res.ok`·`structuredContent.ok`가 있고 falsy) 넘기며, 유효한 content가 없으면 payload text block을
만든다. 그 밖의 값은 payload P(object가 아니면 `{value}`)로 `{content:[text], structuredContent:P, data:P, isError:('ok' in P &&
!P.ok)}`다. text block은 JSON(P)가 16384 byte 이하일 때만 P를 되풀이한다. host가 던지면 `{isError:true, content:[{type:'text',
text}], structuredContent:{ok:false, error:{code:-32603, message}}, data, error}`다.\
근거: `src/provider/peer-client.ts:1741`, `src/provider/peer-client.ts:1748`, `src/provider/peer-client.ts:1825`, `src/provider/peer-client.ts:1875`, `src/provider/peer-client.ts:1888`, `src/provider/tool-call.ts:40`, `src/provider/tool-call.ts:114`, `src/provider/tool-call.ts:159`, `src/provider/tool-call.ts:210`; 테스트: `test/provider-tool-call.test.ts` › `forwards a host CallToolResult as is instead of nesting it`; `test/provider-tool-call.test.ts` › `publishes a plain payload as structuredContent with a JSON text block`; `test/provider-tool-call.test.ts` › `gives a thrown host error a readable text block`

**R-PEER-014** relay socket으로 보낼 답 frame `{type:'mcp', message}`이 262144 byte를 넘으면 provider는 그것을 MUST 바꾼다.
결과가 있는 `tools/call`은 `toolErrorResult({code:'RESULT_TOO_LARGE', message:'The result of tool "<name>" is <B> bytes, over the
relay's 262144-byte message limit; the tool ran but its result was not delivered'})` 결과로, 그 밖은 relay의 같은 오류(R-MCP-040)와
같은 data key의 `{code:-32603, message:'RESULT_TOO_LARGE', data:{limitBytes:262144}}`로 바꾼다. 대체한 것도 들어가지 않으면 보내지
않는다(기록). socket은 열어 둔다. DataChannel 답 frame은 R-PEER-029의 framing에 실려야 하므로, 그 JSON text가 1048576 UTF-16 code
unit(`MAX_DATA_CHANNEL_FRAME_CHARS`)을 넘으면 같은 방식으로 MUST 바꾼다. 결과가 있는 `tools/call`은 `'... is <N> UTF-16 code units, over the
DataChannel's 1048576-code-unit message limit; the tool ran but its result was not delivered'` 결과로, 그 밖은 `{code:-32603,
message:'RESULT_TOO_LARGE', data:{limitCodeUnits:1048576}}`로 바꾼다. framing이 UTF-16 code unit을 세므로 data key가 relay socket의 것과
다르다. 대체한 것도 들어가지 않으면 보내지 않는다(기록).\
근거: `src/provider/tool-call.ts:269`, `src/provider/tool-call.ts:277`, `src/provider/tool-call.ts:260`, `src/provider/tool-call.ts:284`, `src/provider/peer-client.ts:1066`, `src/provider/tool-call.ts:243`, `src/provider/tool-call.ts:294`, `src/provider/tool-call.ts:300`, `src/provider/tool-call.ts:305`, `src/provider/peer-client.ts:1572`, `src/provider/peer-client.ts:1580`; 테스트: `test/provider-tool-call.test.ts` › `answers RESULT_TOO_LARGE for a result over the limit and keeps the socket open`; `test/provider-tool-call.test.ts` › `answers a non-tools/call request with a JSON-RPC error`; `test/provider-tool-call.test.ts` › `drops a reply when not even the error fits`; `test/provider-data-channel.test.ts` › `answers a tools/call whose result the framing cannot carry with an isError RESULT_TOO_LARGE result`; `test/provider-data-channel.test.ts` › `answers another request whose reply the framing cannot carry with the JSON-RPC RESULT_TOO_LARGE`

**R-PEER-015** provider는 모든 channel에서 `initialize`에 `{protocolVersion:<negotiateInitializeProtocolVersion(params)>,
capabilities:{tools:{listChanged:true}, stateless:true}, serverInfo, instructions}`로 MUST 답한다. 협상은 relay의 HTTP route와 같은
함수다(R-MCP-016): 요청 version이 `MCP_INITIALIZE_PROTOCOL_VERSIONS`에 있으면 그 값, 아니면 `2025-11-25`이고, `initialize`가 없는 revision인
`2026-07-28`로는 답하지 않는다. `server/discover`에는 relay socket에서 `{protocolVersion:<같은 협상>,
supportedProtocolVersions:MCP_INITIALIZE_PROTOCOL_VERSIONS, capabilities:{tools:{listChanged:true}, stateless:true}, serverInfo, instructions,
tools}`로, DataChannel에서는 `protocolVersion:'2026-07-28'`과 `supportedProtocolVersions:MCP_PROTOCOL_VERSIONS`로 답한다. 그래서 relay를
거친 discover 답은 relay 자신의 discover result(R-MCP-019)와 같은 협상과 member를 가진다. 기본 serverInfo는 `{name:'wireframe-storyboard-toolkit',
version:'0.4.2'}`이고, 기본 instructions는 보고한 revision을 적는다. relay는 approved ticket의 `initialize` 답을 그대로 전달하고,
`server/discover` 답은 R-MCP-038에 따른다(room이 catalog를 가진 동안 relay는 자기 discover result로 답한다).\
근거: `src/provider/commit-receipt.ts:10`, `src/provider/commit-receipt.ts:27`, `src/provider/commit-receipt.ts:29`, `src/provider/peer-client.ts:1678`, `src/provider/peer-client.ts:1684`, `src/provider/peer-client.ts:1700`, `src/provider/commit-receipt.ts:3`, `src/provider/commit-receipt.ts:4`; 테스트: `test/provider-tool-call.test.ts` › `negotiates initialize as the relay's HTTP route does, never answering 2026-07-28`; `test/provider-tool-call.test.ts` › `reports the relay's negotiation in a server/discover forwarded by the relay`; `test/server-mcp-routing.test.ts` › `negotiates initialize and server/discover as the HTTP route does in a provider's room, whichever answers them`

**R-PEER-016** `tools/call`의 AI run id는 trim한 `params._meta.framebook.aiTrace.runId`(128자 이하), 없으면 암묵 run
`remote-webmcp-<roomId 앞 6자>`다. stopped·completed·failed·rolled-back run의 호출은 `isError` 결과 `{code:'AI_RUN_TERMINAL'}`,
추적하는 128개 run이 모두 작업 중이면 즉시 `{code:'AI_RUN_LIMIT_EXCEEDED'}`다. 결과(`isError`, `{ok:false}`, 예외)로 run을 실패시키거나
완료하는 것은 명시한 run뿐이고 암묵 run은 끝나지 않는다. tool 실행 중 요청의 connection generation이 끝나면(R-PEER-012) provider는 그
호출에 MUST NOT 답한다. 답을 실을 relay socket이나 DataChannel은 generation을 바꿀 때 먼저 닫혔다. 그래도 host가 실행한 호출은 그것을
쥔 run이 MUST 기록한다. run이 그 action을 아직 쥐고 있으면(`AiRunController.hasAction`. 실행 중인 run은 `disconnect()`만 지우므로 revoke,
만료, 4001 같은 session 종료 뒤에도 run은 남는다) action을 settle하고 step(과 receipt의 operation)을 기록하며 결과대로 run을 멈추거나 실패·
완료시킨다. 그래서 그 run은 멈추고 rollback하고 내보낼 수 있으며 rollback은 그 호출도 되돌린다. `disconnect()`가 run을 지웠으면(같은
id로 새로 시작한 run은 그 action을 쥐지 않는다) 아무것도 기록하지 않는다. 이 변경(settle, step 기록, 멈춤·실패·완료)마다
`subscribeAiRuns` listener가 불리고 그 listener의 `disconnect()`가 run을 지울 수 있으므로, provider는 run이 아직 있을 때만 다음 변경을
한다. 지운 run을 바꾸려다 예외로 끝나지 않는다. listener가 던진 예외는 run과 호출을 바꾸지 MUST NOT 한다. `AiRunController`는 session
listener처럼 listener마다 예외를 버리고(`clear` 포함) 변경을 그대로 두며 다른 listener에게도 알린다. 그래서 listener가 던져도 등록한
action으로 host를 부르고, host가 실행한 호출의 step(과 operation)을 기록하고 그 결과로 답하며, `disconnect()`는 연결을 끝까지 정리한다.
ledger 조회를 기다리는 동안 generation이 끝난 호출은 조회가 끝나자마자 버린다: host를 부르지 않고, 아래의 기록된 결과
(`RECONCILIATION_REQUIRED`나 replay)로도, 조회가 실패한 −32603 `Internal error`로도 답하지 않는다(R-PEER-012). host를 부르기 전에
provider가 부른 host code가 generation을 끝낸 호출도 실행하지 않고 답하지 않으며 run에 남기지 않는다. 그래서 provider는 ledger 조회가 없어도
run을 시작하기 전에(요청을 읽은 뒤 host adapter의 `getServerInfo`가 돌았다), 새로 시작한 run을 `subscribeAiRuns` listener에 알린 뒤,
run에 등록한 action을 다시 알린 뒤 host를 부르기 전에 generation을 본다. host code는 `disconnect()`로 연결을 끝내고(`connect()`와
`revokeClient()`도 그것을 부른다) 그것이 run을 지우므로 남는 action은 없다. agent는 그 호출이 끝난
것을 relay가 진행 중인 그 요청을 끝낸 오류로 알며, 그 요청은 host에서 실행됐을 수 있다(R-MCP-005). 오류는 relay가 먼저 본 종료가 정한다.
HTTP revoke(agent 자신의 것이든 host의 것이든, 전체 revoke 포함. R-ROOM-039, R-ROOM-040)는 ticket을 끝내며 provider에 `session.revoked`를
보내기 전에 그 요청을 −32001 `SESSION_INVALID`로 끝낸다(R-ROOM-047). relay가 수행한 room 만료는 provider socket을 4002로 닫기 전에
−32056 `ROOM_EXPIRED`로, rotate는 provider에 `room.rotated`를 보내기 전에 −32057 `ROOM_ROTATED`로 끝낸다(R-ROOM-048). provider socket이
먼저 닫히면 −32001 `PROVIDER_DISCONNECTED`다(R-ROOM-054): provider 자신의 `disconnect()`·`revokeClient()`(socket의 close가 revoke POST보다
relay에 먼저 닿으면), 4001 교체(R-ROOM-052), 끊긴 provider socket, relay가 room 만료를 수행하기 전에 provider의 만료 timer가 닫은 socket이다.
ledger가 있으면 같은 `context.requestId`로 다시 호출해 아래의 기록된 결과로 확인한다(receipt는 generation과 무관하게 ledger에 기록된다). ledger가 설정됐고 `arguments.context.requestId`가 있으면 outcome-unknown 기록은 host를 부르지 않고
`RECONCILIATION_REQUIRED`, durable·replicating·replicated 기록은 host를 부르지 않고 `{ok:true, receipt, data:{replayed:true}}`로
되풀이한다. provider는 이 규칙을 MUST 따른다.\
근거: `src/provider/peer-client.ts:1720`, `src/provider/peer-client.ts:1758`, `src/provider/peer-client.ts:1603`, `src/provider/peer-client.ts:1768`, `src/provider/peer-client.ts:1786`, `src/provider/peer-client.ts:1791`, `src/provider/peer-client.ts:1805`, `src/provider/peer-client.ts:1806`, `src/provider/peer-client.ts:1822`, `src/provider/peer-client.ts:1855`, `src/provider/peer-client.ts:1859`, `src/provider/peer-client.ts:1875`, `src/provider/peer-client.ts:1878`, `src/provider/peer-client.ts:1888`, `src/provider/ai-run-controller.ts:254`, `src/provider/ai-run-controller.ts:72`, `src/provider/peer-client.ts:1070`, `src/provider/peer-client.ts:1916`, `src/provider/peer-client.ts:1342`, `src/provider/peer-client.ts:2334`, `src/provider/peer-client.ts:1900`, `src/provider/ai-run-controller.ts:462`, `src/provider/ai-run-controller.ts:419`, `src/provider/ai-run-controller.ts:454`; 테스트: `test/provider-tool-call.test.ts` › `keeps answering untraced calls after a host throw and after an { ok: false } result`; `test/provider-tool-call.test.ts` › `still fails a run the agent named, and refuses later calls on it`; `test/provider-tool-call.test.ts` › `answers a call immediately when every tracked run has work in flight, then evicts idle runs`; `test/provider-tool-call.test.ts` › `answers a call whose request it holds as durable with the recorded receipt, without calling the host again`; `test/provider-tool-call.test.ts` › `refuses a call whose request it holds as outcome-unknown with RECONCILIATION_REQUIRED, without calling the host`; `test/provider-tool-call.test.ts` › `is accounted for in its run once the host is done, and answered with nothing, when %s`; `test/provider-tool-call.test.ts` › `neither runs nor answers a call whose session ended while the ledger looked up the request it %s`; `test/provider-tool-call.test.ts` › `is neither run, nor answered, nor left in a run when %s ends the session`; `test/provider-tool-call.test.ts` › `answers nothing for a call whose session ended while the ledger lookup that then failed was pending`; `test/provider-tool-call.test.ts` › `is answered with nothing, and leaves no run behind, when the listener ends the session as the run %s`; `test/provider-tool-call.test.ts` › `lets the call run, be answered and settle when it throws as the call registers its action`; `test/provider-tool-call.test.ts` › `records the write the host committed, and answers it, when it throws as the call settles its action`; `test/provider-tool-call.test.ts` › `does not keep disconnect() from ending the session when it throws as the runs are cleared`; `test/provider-tool-call.test.ts` › `are all told of every change, clear included, and the change is made, though one throws`

**R-PEER-017** `approval.request`를 받으면 provider는 `requestId`(`payload.requestId ?? frame.requestId`), `clientLabel`
(`payload.clientLabel`, 기본 `AI Agent`), `sessionId`, `roomEpoch`(payload 먼저, 다음 frame, 없으면 room 값)를 읽고
`approvalState = 'pending'`, state `waiting`으로 MUST 바꾸고 알린다. 새 `approval.request`는 `approved`를 포함한 이전 승인 상태를
덮어쓴다. room epoch당 ticket은 하나이므로(R-ROOM-005) provider는 승인 상태를 room에 하나만 둔다.\
근거: `src/provider/peer-client.ts:1090`, `src/provider/peer-client.ts:1092`, `src/provider/peer-client.ts:1093`, `src/provider/peer-client.ts:1104`, `src/provider/peer-client.ts:1109`; 테스트: `test/provider-reconnect.test.ts` › `are not lost when they arrive in the same read as ready`

**R-PEER-018** `approveClient(requestId)`와 `rejectClient`는 `approvalState`가 `pending`이고 socket이 열려 있을 때만
`{protocol:'webmcp-peer/1', messageId:'approval-<requestId>-<Date.now()>', type:'approval.decision', roomId,
roomEpoch: approvalRoomEpoch ?? roomEpoch ?? 0, sessionId?, requestId, sentAt, payload:{requestId, sessionId(없으면 ''),
roomId(없으면 ''), roomEpoch, decision, decidedAt, reason?}}`를 MUST 보낸다. 거절의 reason은 `CLIENT_REJECTED`다. frame을 보내지
못하면(크기 초과 등) `false`를 돌려주고 요청은 pending으로 남는다. 보내면 relay의 echo를 기다리지 않고(echo는 plain `send`라 사라질
수 있다, R-SIG-024) 승인은 `approved`, 거절은 `revoked`로 바꾸고 그 결정을 기억한다. 그 결정이 relay의 echo, 새 `approval.request`,
`approval.restored`로 정리되기 전에 같은 requestId의 `INVALID_APPROVAL` error frame(R-SIG-009)이 오면 결정은 효력이 없었으므로,
provider는 상태를 그 requestId의 `pending`으로 되돌리고 session error를 `INVALID_APPROVAL`로 MUST 둔다. 정리된 뒤 온 같은 requestId의
거절과 다른 requestId의 거절은 상태를 바꾸지 않는다. 다음 결정이나 relay가 알리는 다음 승인 상태가 이 session error를 지운다.\
근거: `src/provider/peer-client.ts:2211`, `src/provider/peer-client.ts:2215`, `src/provider/peer-client.ts:2216`, `src/provider/peer-client.ts:2218`, `src/provider/peer-client.ts:2224`, `src/provider/peer-client.ts:2229`, `src/provider/peer-client.ts:2231`, `src/provider/peer-client.ts:2248`, `src/provider/peer-client.ts:1236`, `src/provider/peer-client.ts:1237`, `src/provider/peer-client.ts:1251`, `src/provider/peer-client.ts:1253`, `src/provider/peer-client.ts:1258`, `src/provider/peer-client.ts:1259`, `src/provider/peer-client.ts:1260`, `src/provider/peer-client.ts:1111`, `src/provider/peer-client.ts:1123`, `src/provider/peer-client.ts:1400`; 테스트: `test/provider-register-limit.test.ts` › `does not send an approval decision over the limit, and leaves the request pending`; `test/provider-approval-state.test.ts` › `is undone: the %s did not take effect`; `test/provider-approval-state.test.ts` › `stands once the relay has confirmed it, so a refused repeat changes nothing`

**R-PEER-019** relay의 `approval.approved`를 받은 provider는 이미 스스로 `approved`면 그것을 자기 결정의 echo로 보고 결정을
확정한다. 아니면 다른 경로(HTTP 등)로 한 승인이므로 R-PEER-020의 검사를 통과할 때만 MUST 받아들여 `approvalState = 'approved'`로
한다. 어느 쪽이든 그다음 RTCPeerConnection을 준비하고, 검사를 통과하지 못한 frame은 무시한다. `approval.rejected`(host 자신의 거절이든 HTTP
거절이든 그 결정 echo)는 relay가 ticket을 끝냈다는 뜻이므로, provider는 기억한 결정을 지우고 R-PEER-021대로 session을 `CLIENT_APPROVAL_DENIED`
revoke(approvalState `revoked`, state `disconnected`, 저장한 room lease 삭제, 재접속 없음)로 MUST 끝낸다.\
근거: `src/provider/peer-client.ts:1118`, `src/provider/peer-client.ts:1123`, `src/provider/peer-client.ts:1124`, `src/provider/peer-client.ts:1125`, `src/provider/peer-client.ts:1132`, `src/provider/peer-client.ts:114`, `src/provider/peer-client.ts:1400`, `src/provider/peer-client.ts:1279`; 테스트: `test/provider-approval-state.test.ts` › `is adopted when it was made over HTTP, so the agent is served`; `test/provider-approval-state.test.ts` › `is not adopted for %s`; `test/provider-approval-state.test.ts` › `learns an approval made over HTTP from the relay and serves the agent`; `test/provider-approval-state.test.ts` › `ends the session when the relay confirms a rejection %s, since the rejected agent spent the room's one invite`

**R-PEER-020** `approval.restored`와 다른 경로의 `approval.approved`(R-PEER-019)는 `sessionId`가 비어 있지 않고, provider에 roomEpoch가
있고 frame의 roomEpoch(payload 먼저)와 같고, `roomId`(payload 먼저)가 있으면 현재 room과 같고, 보고한 ticket 만료(`approval.restored`는
`payload.expiresAt`, `approval.approved`는 `payload.ticketExpiresAt ?? ticketExpiresAt`)가 수면 미래일 때만 MUST 받아들인다
(`adoptRelayApproval`). 받아들이면 `approvalState = 'approved'`, 그 session을 승인 session·carrier session으로,
`clientLabel = payload ?? 이전 ?? 'AI Agent'`, `approvalRequestId = null`로 하고, 기억한 결정과 `INVALID_APPROVAL` session error를 지운다.\
근거: `src/provider/peer-client.ts:1085`, `src/provider/peer-client.ts:1086`, `src/provider/peer-client.ts:1279`, `src/provider/peer-client.ts:1281`, `src/provider/peer-client.ts:1284`, `src/provider/peer-client.ts:1286`, `src/provider/peer-client.ts:1287`, `src/provider/peer-client.ts:1288`, `src/provider/peer-client.ts:1296`; 테스트: `test/provider-reconnect.test.ts` › `ignores a restored approval for another room epoch`; `test/provider-reconnect.test.ts` › `keeps an approved agent working across a lease reclaim`; `test/provider-approval-state.test.ts` › `is not adopted for %s`

**R-PEER-021** provider는 `approval.expired`를 `APPROVAL_EXPIRED`, `collaboration.expired`를 `SESSION_EXPIRED`, `room.rotated`를
`ROOM_ROTATED`로 session 만료(approvalState `expired`, state `disconnected`, 저장한 room lease 삭제, transport 정리, 재접속 없음)로 MUST 처리한다.
`session.revoked`, `collaboration.revoked`, `collaboration.role-updated`, `collaboration.guest-linked`는 `SESSION_REVOKED`로, 승인 요청을
거절한 `approval.rejected`(R-PEER-019)는 `CLIENT_APPROVAL_DENIED`로 revoke한다(approvalState `revoked`, state `disconnected`, 저장한 room lease
삭제, transport 정리, 재접속 없음). revoke는 누가 요청하거나 거절했든(agent 자신의 revoke, host 자신의 거절 포함, R-SIG-024) host의
auto-reconnect 설정(`autoReconnect`, localStorage `webmcp:auto-reconnect`)을 MUST NOT 바꾼다. 그 설정은 host가 다음에 여는 room에도
쓰이고, 이 room에 다시 붙지 않는 것은 transport 정리(generation 종료)와 lease 삭제가 보장한다. host 자신의
`revokeClient()`(`disconnect(true)`)만 설정을 끄고 `'false'`로 저장한다. 그 밖의 type은 무시한다. 이 중 relay가 provider
socket에 보내는 것은 거절의 결정 echo `approval.rejected`(R-SIG-009), 승인 요청 만료의 `approval.expired`(R-SIG-012), revoke의
`session.revoked`(R-SIG-015), rotate의 `room.rotated`다(R-SIG-024). room당 ticket이 하나이고 그 agent가 invite를 소비했으므로(R-ROOM-005)
승인 요청의 거절·만료나 revoke 뒤의 room은 다른 agent를 받지 않는다(다음 join은 409 `INVITE_TOKEN_CONSUMED`). 그래서 provider는 그 room의
lease를 지워 다시 열린 host 페이지가 그 room을 되찾아(R-PEER-025) 아무도 쓸 수 없는 초대를 보이지 않게 하고, host가 room을 새로 열게
한다. provider socket이 없는 동안(재접속 backoff, reload) 승인 요청이 거절·만료되거나 revoke되어도 같다. relay는 다시 붙는 provider
socket의 `ready`에 그 frame의 type을 `ticketEnded`로 담고 그 frame을 replay하며(R-ROOM-053), provider는 `ready`에서 그 frame을 받은
것처럼(이 표대로) session을 끝내고 그 attach를 실패로 끝낸다(R-PEER-004). room 만료에서 relay는 provider socket을 frame 없이 close code 4002
`ROOM_EXPIRED`로 닫고(R-ROOM-050), provider는 그 close를 `ROOM_EXPIRED` session 만료로 처리한다(R-PEER-025). relay보다 먼저 시간이 되면
provider는 자기 expiry timer(room `expiresAt`)로 `SESSION_EXPIRED` 만료를 한다(R-PEER-027).\
근거: `src/provider/peer-client.ts:113`, `src/provider/peer-client.ts:119`, `src/provider/peer-client.ts:120`, `src/provider/peer-client.ts:121`, `src/provider/peer-client.ts:115`, `src/provider/peer-client.ts:116`, `src/provider/peer-client.ts:1132`, `src/provider/peer-client.ts:1134`, `src/provider/peer-client.ts:114`, `src/provider/peer-client.ts:96`, `src/provider/peer-client.ts:1410`, `src/provider/peer-client.ts:1411`, `src/provider/peer-client.ts:1012`, `src/provider/peer-client.ts:1365`, `src/provider/peer-client.ts:1371`, `src/provider/peer-client.ts:1397`, `src/provider/peer-client.ts:1403`, `src/provider/peer-client.ts:2383`, `src/provider/peer-client.ts:2328`, `src/server/peer-server.ts:2578`, `src/server/peer-server.ts:2768`, `src/server/peer-server.ts:3734`, `src/server/peer-server.ts:2924`, `src/server/peer-server.ts:2864`, `src/server/peer-server.ts:3437`, `src/provider/peer-client.ts:1195`, `src/provider/peer-client.ts:1197`, `src/server/peer-server.ts:2696`; 테스트: `test/provider-approval-state.test.ts` › `takes an approval request nobody decided in time down when the relay expires it`; `test/provider-approval-state.test.ts` › `ends the session when the relay confirms a rejection %s, since the rejected agent spent the room's one invite`; `test/provider-reconnect.test.ts` › `ends the session as expired after 4002 ROOM_EXPIRED, without reconnecting`; `test/provider-reconnect.test.ts` › `forgets the room's lease after %s, so a reloaded page reclaims no room nobody can join`; `test/provider-reconnect.test.ts` › `keeps the host's auto-reconnect preference when the agent revokes its session, for the rooms it opens next`; `test/provider-reconnect.test.ts` › `turns auto-reconnect off when the host revokes the session itself`; `test/server-provider-reattach.test.ts` › `takes the room down and forgets its lease when the host reattaches after %s while its socket was away`; `test/server-provider-reattach.test.ts` › `fails a reloaded page's reconnect to a room whose ticket ended while the page was away (%s), with the session ended`

**R-PEER-022** provider는 `approvalState`가 `approved`이고 `offer.requestId`가 비어 있지 않은 문자열일 때만 `offer`에 MUST
답한다. requestId가 없거나 문자열이 아니면 답을 맞출 수 없으므로 offer를 무시한다(relay는 그런 offer를 전달하지 않는다, R-SIG-017).
RTCPeerConnection이 없으면(relay의 `approval.approved` echo가 미리 준비한다, R-PEER-019) 기본 `iceServers`
`[{urls:'stun:stun.l.google.com:19302'}]`, `bundlePolicy:'max-bundle'`로 만들고, offer를 적용하고 answer를 만들고 ICE 수집이 끝나거나 2000
ms가 될 때까지 기다린 뒤 `{type:'answer', requestId:<offer의 requestId>, sdp}`를 MUST 보낸다. trickle ICE frame은 없다. answer를 보내면 그
RTCPeerConnection은 그 offer의 session이 되어, 그 위에서 열린 DataChannel의 `grant`와 relay `release`가 그 requestId를 되풀이한다
(R-PEER-023). answer를 보내지 못하면 반쯤 협상한 RTCPeerConnection을 닫는다. RTCPeerConnection이 없는 환경에서는 아무것도 하지 않는다.\
근거: `src/provider/peer-client.ts:1138`, `src/provider/peer-client.ts:1143`, `src/provider/peer-client.ts:1144`, `src/provider/peer-client.ts:1146`, `src/provider/peer-client.ts:1150`, `src/provider/peer-client.ts:1163`, `src/provider/peer-client.ts:1167`, `src/provider/peer-client.ts:1169`, `src/provider/peer-client.ts:1173`, `src/provider/peer-client.ts:1174`, `src/provider/peer-client.ts:1125`, `src/provider/peer-client.ts:1433`; 테스트: `test/provider-register-limit.test.ts` › `drops the answer to an offer whose requestId takes it over the limit, and keeps the provider socket`; `test/provider-data-channel.test.ts` › `is answered under its own requestId, which the DataChannel's grant and the relay release repeat`; `test/provider-data-channel.test.ts` › `is not answered without a requestId to answer it under`; `test/provider-data-channel.test.ts` › `waits at most 2000 ms for ICE gathering before it answers`

**R-PEER-023** DataChannel 인계(offer, answer, `hello`, `grant`, `release`)는 실험적이다(MAY). 이 package는 provider 쪽만 구현하고
offer와 `hello`를 보내는 agent 구현은 없다(client SDK와 데모 모두). agent 쪽 규칙은 package에 agent 구현이 생길 때 규범으로 올린다.
인계를 구현한 provider는 다음을 MUST 따른다. 승인 상태에서 DataChannel(원격이 만든 label `mcp`)로 `{type:'hello'}`가 오면 state를
`connected`로 하고 채널에 `{type:'grant', protocol:'webmcp-peer/1', requestId, sessionId, expiresAt}`를 보낸 뒤 relay socket에 `{type:'release',
requestId}`를 보내고 relay socket을 닫는다(재접속하지 않음). `requestId`는 그 RTCPeerConnection에서 답한 offer의 것이므로(R-PEER-022)
relay는 `release`를 offer를 보낸 agent socket에 보낸다(R-SIG-019). 답한 offer가 없으면 두 frame 모두 `requestId`를 뺀다. release 뒤 relay에는
이 room의 provider socket이 없으므로 그 room의 HTTP·WebSocket agent 요청은 `PROVIDER_UNAVAILABLE`을 받는다(R-MCP-024). DataChannel이 닫히면
state는 `disconnected`, `approved`는 `revoked`다.\
근거: `src/provider/peer-client.ts:308`, `src/provider/peer-client.ts:1510`, `src/provider/peer-client.ts:1522`, `src/provider/peer-client.ts:1525`, `src/provider/peer-client.ts:1528`, `src/provider/peer-client.ts:1530`, `src/provider/peer-client.ts:1546`, `src/provider/peer-client.ts:1548`, `src/provider/peer-client.ts:1549`, `src/provider/peer-client.ts:1346`; 테스트: `test/provider-data-channel.test.ts` › `is answered under its own requestId, which the DataChannel's grant and the relay release repeat`

**R-PEER-024** 브라우저(window 있음)에서 provider는 room lease를 localStorage `webmcp:room-lease:<encodeURIComponent(serverUrl)>:
<encodeURIComponent(replicaId)>`에 `{serverUrl, roomId, roomEpoch, leaseToken:reconnectToken, expiresAt: reconnectTokenExpiresAt ??
expiresAt, alias?}`로 저장한다(token과 roomId가 있고 roomEpoch가 safe integer ≥ 0이고 만료 전일 때만). relay의
`reconnectTokenExpiresAt`은 room `expiresAt`이므로(R-ROOM-013) 저장한 lease는 room 수명 동안 남고, 그 전에 유예가 지난 lease는 reclaim의
410 `ROOM_LEASE_EXPIRED`가 지운다(R-ROOM-018). `reclaimLease: true`이고 저장한 lease의 serverUrl이 현재 serverUrl과 같으면(끝 `/` 무시)
`POST <serverUrl>/p/<encodeURIComponent(roomId)>/reclaim`을 `Content-Type`만 단 채 body `{roomId, roomEpoch, leaseToken}`으로 MUST 보낸다.
2xx면 descriptor를 검사해(`INVALID_RECLAIMED_ROOM_DESCRIPTOR`) 그 room에 붙는다. 409 `ROOM_PROVIDER_ACTIVE`는 모두 4번 시도하도록 100, 200,
300 ms 뒤 다시 보내고 그래도 409 `ROOM_PROVIDER_ACTIVE`면 `ROOM_PROVIDER_ACTIVE`로 실패한다. lease 자체를 거절한 status — 400
`ROOM_LEASE_REQUIRED`, 401, 403 `ROOM_LEASE_INVALID`(R-ROOM-015), 404, 그 밖의 409(예: `ROOM_LEASE_BINDING_INVALID`), 410(rotate된 room, 만료
room, lease 만료, R-ROOM-014) — 이면 같은 lease로는 다시 될 수 없으므로 저장한 lease를 지운다(`refusesRoomLease`). 그다음은 부른 쪽에
따른다. host가 부른 `connect({reclaimLease:true})`는 lease를 쓸 수 없으면(없음, serverUrl이 다름, 거절, 그 밖의 실패) 새 room을 `POST /p`로
만든다. auto-reconnect(R-PEER-025)는 새 room을 만들지 않는다. lease가 없거나 거절되면 session error `ROOM_LEASE_LOST`로 state `error`에서
멈추고(새 초대는 host가 `connect()`로 만든다), 그 밖의 실패(5xx 등)는 lease를 둔 채 relay의 `error` 이름이나 `HTTP <status>: Failed to
reclaim the peer room`으로 실패해 다음 시도를 기다린다. reclaim `fetch`가 던지면(네트워크 오류) 어느 쪽이든 `POST /p`로 물러나지 않고 그
오류로 실패한다(state `error`). reclaim한 room의 ticket이 provider socket이 없는 동안 끝났으면, 붙은 socket의 `ready`가 그것을 알리고
(R-ROOM-053) provider는 session을 끝내며 lease를 지운다(R-PEER-004). 그러면 어느 쪽이든 `POST /p`로 물러나지 않고 그 session error로
실패하며, lease가 없으므로 host의 다음 `connect()`가 새 room을 만든다. `reclaimLease`가 없는 수동 `connect()`는 먼저 lease를 지운다.\
근거: `src/provider/peer-client.ts:515`, `src/provider/peer-client.ts:535`, `src/provider/peer-client.ts:539`, `src/provider/peer-client.ts:849`, `src/provider/peer-client.ts:869`, `src/provider/peer-client.ts:870`, `src/provider/peer-client.ts:901`, `src/provider/peer-client.ts:903`, `src/provider/peer-client.ts:926`, `src/provider/peer-client.ts:932`, `src/provider/peer-client.ts:936`, `src/provider/peer-client.ts:937`, `src/provider/peer-client.ts:948`, `src/provider/peer-client.ts:951`, `src/provider/peer-client.ts:954`, `src/provider/peer-client.ts:953`, `src/provider/peer-client.ts:957`, `src/provider/peer-client.ts:966`, `src/provider/peer-client.ts:81`, `src/provider/peer-client.ts:133`, `src/provider/peer-client.ts:134`, `src/provider/peer-client.ts:135`, `src/provider/peer-client.ts:815`, `src/provider/peer-client.ts:868`, `src/provider/peer-client.ts:933`, `src/provider/peer-client.ts:960`, `src/provider/peer-client.ts:964`, `src/provider/peer-client.ts:1012`, `src/provider/peer-client.ts:1015`; 테스트: `test/provider-reconnect.test.ts` › `keeps an approved agent working across a lease reclaim`; `test/provider-reconnect.test.ts` › `is forgotten, so the next auto-reconnect does not present it again`; `test/provider-reconnect.test.ts` › `stops at ROOM_LEASE_LOST for %i %o, and opens no new room`; `test/provider-reconnect.test.ts` › `keeps the lease and retries a reclaim that failed for another reason, without opening a new room`; `test/server-provider-reattach.test.ts` › `rejects a host's connect({ reclaimLease: true }) to a room whose ticket ended while it was away, so its next connect opens a room`

**R-PEER-025** signaling socket이 닫히면(DataChannel로 넘긴 경우·지난 generation 제외) provider는 그 close code(close event의 `code`, 없으면
close frame 없이 끊긴 1006)로 다음을 MUST 정한다(R-WS-030). 4002 `ROOM_EXPIRED`는 session 만료다(session error `ROOM_EXPIRED`, approvalState
`expired`, state `disconnected`, 저장한 room lease 삭제, transport 정리, 재접속 없음). 다시 붙어도 되는 1001, 1006, 1013(`isReconnectableCloseCode`)이면 state `connected`·
`waiting`은 `disconnected`가 되고, `autoReconnect`가 켜져 있고 approvalState가 `expired`가 아니고 state가 `idle`이 아니면 `min(1000 × 1.5^(n−1),
15000)` ms 뒤 재접속을 예약한다. 그 밖의 code(1000, 4001, 1002·1003·1007·1009·1011 등)는 재접속 없이 transport를 정리하고 state를
`disconnected`로 하며, session error는 4001이면 `PEER_SESSION_SUPERSEDED`(다른 provider socket이 room을 맡았으므로 되찾으러 가지 않는다), 아니면
`SIGNALING_CLOSED`다. approvalState는 그대로 둔다. auto-reconnect는 저장한 room으로 돌아가는 것이고 room을 새로 열지 않는다.
시도마다 저장한 설정을 읽어 저장한 room을 reclaim한다(R-PEER-024). 다시 될 수 있는 실패(state `error`, `ROOM_LEASE_LOST`가 아님)만 다음
시도를 예약하고, 성공한 `ready`가 횟수를 되돌리며, `disconnect()`가 반복을 멈춘다. auto-reconnect는 브라우저에서만 돈다. window가 없거나,
`shouldSuppressAutoReconnect(window.location)`이 참이거나, localStorage `webmcp:auto-reconnect`가 `'false'`이거나, `webmcp:server-url`이
없거나, 그 relay에 저장한 lease가 없으면 시도를 건너뛰고 반복이 끝난다. 그래서 다시 열린 host 페이지(`getShared()`는 처음 만들 때 한 번
시도한다)는 저장한 room이 살아 있으면 그 room에 다시 붙고 아니면 room을 열지 않는다. `room.rotated`, 승인 요청의 거절·만료, session 만료,
revoke(R-PEER-021), DataChannel 인계(R-PEER-023) 뒤에는 재접속하지 않는다. DataChannel 인계를 뺀 이 경우들은 그 room의 lease도 지우므로 다시
열린 host 페이지도 그 room을 되찾지 않는다. provider socket이 없는 동안 그렇게 된 room도 같다. 거절·만료된 승인 요청과 revoke는
reclaim으로 다시 붙은 socket이 relay의 `ready`(`ticketEnded`, R-ROOM-053)로 알아 session을 끝내고 lease를 지우며(R-PEER-004), 그 시도는
다시 될 수 없는 실패다. `autoReconnectIfSaved()`는 그 session이 끝난 채(state `disconnected`, 그 session error) MUST false로 끝나고, 예약된
시도는 다음 시도를 예약하지 않는다(state가 `error`가 아니다). rotate·만료된 room은 reclaim이 410으로 거절되어 lease를
지운다(R-PEER-024). 이 경우들은 auto-reconnect 설정을 바꾸지 않으므로 host가 다음에 여는 room은 그 설정대로 다시
붙는다.\
근거: `src/provider/peer-client.ts:712`, `src/provider/peer-client.ts:734`, `src/provider/peer-client.ts:760`, `src/provider/peer-client.ts:764`, `src/provider/peer-client.ts:778`, `src/provider/peer-client.ts:86`, `src/provider/peer-client.ts:91`, `src/provider/peer-client.ts:1188`, `src/provider/peer-client.ts:1194`, `src/provider/peer-client.ts:1195`, `src/provider/peer-client.ts:1197`, `src/provider/peer-client.ts:1200`, `src/provider/peer-client.ts:1201`, `src/provider/peer-client.ts:1208`, `src/provider/peer-client.ts:1381`, `src/config/close-codes.ts:43`, `src/provider/types.ts:55`, `src/provider/peer-client.ts:716`, `src/provider/peer-client.ts:745`, `src/provider/peer-client.ts:750`, `src/provider/peer-client.ts:702`, `src/provider/peer-client.ts:1012`, `src/provider/peer-client.ts:1015`; 테스트: `test/provider-reconnect.test.ts` › `keeps retrying with growing delays while the relay is down, then reclaims the room`; `test/provider-reconnect.test.ts` › `stops retrying after a manual disconnect`; `test/provider-reconnect.test.ts` › `does not run without a saved lease, so a reload never opens a room by itself`; `test/provider-reconnect.test.ts` › `stops at ROOM_LEASE_LOST for %i %o, and opens no new room`; `test/provider-reconnect.test.ts` › `is reconnected after %s, by reclaiming its room`; `test/provider-reconnect.test.ts` › `is not reconnected after %s`; `test/provider-reconnect.test.ts` › `ends the session as expired after 4002 ROOM_EXPIRED, without reconnecting`; `test/provider-reconnect.test.ts` › `forgets the room's lease after %s, so a reloaded page reclaims no room nobody can join`; `test/provider-reconnect.test.ts` › `keeps the host's auto-reconnect preference when the agent revokes its session, for the rooms it opens next`; `test/server-provider-reattach.test.ts` › `takes the room down and forgets its lease when the host reattaches after %s while its socket was away`; `test/server-provider-reattach.test.ts` › `fails a reloaded page's reconnect to a room whose ticket ended while the page was away (%s), with the session ended`

**R-PEER-026** `refreshRoom(overrides)`는 이전 `connect()`가 없으면 `PEER_SESSION_NOT_CONFIGURED`로 실패하고, room이나
providerToken이 없으면 이전 option에 overrides를 합쳐 그냥 연결한다. 있으면 현재 serverUrl로 `POST <serverUrl>/p/<encodeURIComponent(roomId)>/rotate`를
`Authorization: Bearer <providerToken>`, body `{roomId, roomEpoch?, requestedAt(ISO), alias}`로 보낸다. `roomEpoch`는 provider가 아는
epoch(descriptor의 `roomEpoch`)일 때만 넣고, 모르면 member를 뺀다. relay는 보낸 epoch가 다르면 `ROOM_BINDING_INVALID`로 거절하므로
(R-ROOM-042) 0을 짐작해 보내지 않는다. non-2xx면 끊지 않고
`body.error` 또는 `HTTP <status>: Failed to rotate peer room`으로 실패하고, 2xx body가 descriptor가 아니면 `INVALID_ROOM_DESCRIPTOR`로
실패한다. 성공하면 끊고, 합친 option의 serverUrl을 `connect()`와 같은 `normalizePeerConfigUrl`(R-PEER-001)로 정규화한 뒤 대체
descriptor로 붙는다(socket URL은 R-PEER-003). `disconnect(true)`(`revokeClient`)는 room, providerToken, 승인 sessionId를 알 때
`POST <serverUrl>/p/<encodeURIComponent(roomId)>/sessions/<encodeURIComponent(sessionId)>/revoke`를 providerToken bearer와 body `{roomId,
roomEpoch?, sessionId, requestedAt, reason:'provider-request'}`로 기다리지 않고 보내고, auto-reconnect를 끄고 lease를 지운다. 여기서도
`roomEpoch`는 아는 epoch일 때만 넣는다(relay는 보낸 epoch만 비교한다, R-ROOM-071).
provider는 이 요청 모양을 MUST 쓴다.\
근거: `src/provider/peer-client.ts:2274`, `src/provider/peer-client.ts:2276`, `src/provider/peer-client.ts:2280`, `src/provider/peer-client.ts:2282`, `src/provider/peer-client.ts:2292`, `src/provider/peer-client.ts:2297`, `src/provider/peer-client.ts:2299`, `src/provider/peer-client.ts:2301`, `src/provider/peer-client.ts:2302`, `src/provider/peer-client.ts:2309`, `src/provider/peer-client.ts:2320`, `src/provider/peer-client.ts:845`, `src/provider/peer-client.ts:991`, `src/provider/peer-client.ts:2348`, `src/provider/peer-client.ts:2359`; 테스트: `test/provider-reconnect.test.ts` › `sends the room epoch the provider knows, and leaves out one it does not instead of guessing 0`; `test/provider-approval-state.test.ts` › `names the room epoch only when it knows it (%s)`

**R-PEER-027** provider는 `expiresAt`(descriptor 값 또는 now + 30분, DataChannel `hello`에서 다시 설정)에 timer를 두고, 시간이 되면
`SESSION_EXPIRED`로 재접속 없이 transport를 MUST 정리한다.\
근거: `src/provider/peer-client.ts:989`, `src/provider/peer-client.ts:1521`, `src/provider/peer-client.ts:2323`; 테스트: `test/provider-reconnect.test.ts` › `ends the session as SESSION_EXPIRED once the room's expiresAt passes, and does not reconnect`

**R-PEER-028** provider SDK는 write 동의 때문에 tool 호출을 거절하지 않는다. `writeEnabled`는 host adapter의 상태일 뿐이다.
`setWriteEnabled(enabled)`와 `toggleWrite()`는 host adapter가 보고한 결과 상태(보고가 없으면 `setWriteEnabled`는 `enabled`, `toggleWrite`는
`false`)를 브라우저의 localStorage `webmcp:write-enabled`에 `'true'`·`'false'`로 MUST 저장한다. `connect()`는 `enableWrite`가 `true`이거나
(option 없음 시) 그 값이 `'true'`일 때만, auto-reconnect도 그 값이 `'true'`일 때만 `setWriteEnabled(true)`를 부른다. 그래서 재접속은 사용자가
켜지 않은 write나 끈 write를 켜지 않는다.\
근거: `src/provider/peer-client.ts:565`, `src/provider/peer-client.ts:125`, `src/provider/peer-client.ts:660`, `src/provider/peer-client.ts:669`, `src/provider/peer-client.ts:679`, `src/provider/peer-client.ts:681`, `src/provider/peer-client.ts:722`, `src/provider/peer-client.ts:835`, `src/provider/peer-client.ts:840`; 테스트: `test/provider-reconnect.test.ts` › `is restored only as the user last set it, the rule connect() reads it by`

**R-PEER-029** DataChannel framing(relay 밖, R-PEER-023의 실험적 인계)은 양방향 같은 규칙이다. message(JSON frame 하나)는 chunk
`{v:1, id:safe int, index:0..total−1, total:1..512, data}`로 나뉘고, 각 `data`는 frame JSON text를 UTF-16 code unit으로 자른 16384 unit 이하의
조각이다(`MAX_DATA_CHANNEL_CHUNKS`, `MAX_DATA_CHANNEL_CHUNK_CHARS`). provider는 이 범위의 chunk만 MUST 받고 id별로 조립한다(같은 index는
무시, total이 바뀌면 다시 시작, 미완성 frame이 50개를 넘으면 모두 버림). 조립한 text는 문자열 `type`을 가진 JSON object여야 한다. 승인
상태에서만 chunk를 받는다. provider는 2048 unit chunk(`DATA_CHANNEL_SEND_CHUNK_CHARS`)로, `readyState`가 `open`일 때만 보내고, 512 chunk에
들어가지 않는 frame, 곧 JSON text가 1048576 unit(`MAX_DATA_CHANNEL_FRAME_CHARS`)을 넘는 frame은 MUST NOT 보낸다. 그런 답은 RESULT_TOO_LARGE로
바꾸고(R-PEER-014), 그 밖의 frame(`grant`, `crdt`)은 보내지 않고 기록한다.\
근거: `src/provider/wire-schemas.ts:31`, `src/provider/wire-schemas.ts:33`, `src/provider/wire-schemas.ts:39`, `src/provider/wire-schemas.ts:45`, `src/provider/wire-schemas.ts:64`, `src/provider/wire-schemas.ts:70`, `src/provider/peer-client.ts:1478`, `src/provider/peer-client.ts:1915`, `src/provider/peer-client.ts:1916`, `src/provider/peer-client.ts:1918`, `src/provider/peer-client.ts:1925`, `src/provider/peer-client.ts:1929`; 테스트: `test/provider-data-channel.test.ts` › `sends a frame in at most ${MAX_CHUNKS} chunks of at most ${CHUNK_CHARS} code units, up to ${FRAME_LIMIT} code units`; `test/provider-data-channel.test.ts` › `does not send a frame other than a reply that the framing cannot carry`

### 9.2 agent client (`PeerMcpSession`)

**R-PEER-030** `PeerMcpSession`은 transport를 이 순서로 MUST 고른다: `transportFactory(url, protocols, callbacks)`, 넘겨받은
`transport`, `mcpEndpoint`가 있으면(roomId·serverUrl이 함께 있어도) Streamable HTTP transport, 아니면 `wsUrl` 또는
`<normalizeServerUrl(serverUrl)의 앞 http를 ws로(대소문자 무시)>/p/<encodeURIComponent(roomId)>/client`의 WebSocket. subprotocol은
`[WEBMCP_SUBPROTOCOL]`(`['webmcp-peer.v1']`)에 clientToken이 있으면 `ticket.<clientToken>`을 더한 것이다. roomId·wsUrl·mcpEndpoint·transport·factory가 모두
없으면 `ROOM_ID_REQUIRED`, `send` 없는 transport는 `INVALID_TRANSPORT`다. WebSocket transport는 `onopen` 전이고 readyState가
정의돼 있고 1이 아니면 `TRANSPORT_NOT_OPEN`을 던진다. option이 `undefined`·`null`이면 `process.env`가 있을 때 환경 변수를 읽는다.
serverUrl은 option, `FRAMEBOOK_PEER_URL`, `WEBMCP_PEER_URL` 순이고 모두 없으면 `http://127.0.0.1:8787`이다. roomId는 option `roomId`,
option `descriptorUrl`, `FRAMEBOOK_PEER_ROOM_ID`, `WEBMCP_PEER_ROOM_ID`, `FRAMEBOOK_PEER_DESCRIPTOR` 순이고, 처음 나온 값이 문법에 맞는 room id를 담지
않으면 생성자가 `ROOM_ID_INVALID`로 던진다(R-PEER-054). mcpEndpoint는 option, 다음
`FRAMEBOOK_PEER_MCP_URL`이고, alias는 option `peerAlias`, `alias`, `FRAMEBOOK_PEER_ALIAS` 순이다. 그래서 `FRAMEBOOK_PEER_MCP_URL`이 설정된
process에서는 serverUrl·roomId를 넘겨도 Streamable HTTP transport를 쓴다.\
근거: `src/client/session.ts:385`, `src/client/session.ts:386`, `src/client/session.ts:390`, `src/client/session.ts:393`, `src/client/session.ts:398`, `src/client/session.ts:400`, `src/client/transport.ts:24`, `src/client/session.ts:555`, `src/client/session.ts:611`, `src/client/session.ts:612`, `src/client/session.ts:630`, `src/client/session.ts:648`, `src/client/session.ts:661`, `src/client/transport.ts:30`, `src/client/transport.ts:151`, `src/client/types.ts:1`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-PEER-031** `connect()`는 동시 호출과 연결 중에 만든 요청이 한 시도를 MUST 함께 쓴다. `{type:'ready'}`를 기다리며,
`requestTimeoutMs`(기본 10000 ms)가 지나면 socket이 열렸을 때는 그대로 진행하고 아니면 `TRANSPORT_TIMEOUT`이다. `ready`는
roomId(없을 때만), roomEpoch(safe integer), sessionId(비어 있지 않으면, relay가 묶은 id로 표시)를 정한다. 연결 뒤 sessionId가 없으면
`peer-session-<uuid>`를 만든다(relay가 묶은 id가 아님). HTTP transport는 만들 때 `{type:'ready', role:'client', transport:'http'}`를
스스로 낸다. connect는 MUST 매번 새 연결이다. `transportFactory`, Streamable HTTP, WebSocket transport는 connect마다 새로 만들고(닫힌
WebSocket은 다시 열 수 없다), 넘겨받은 `transport`만 다시 쓴다(있으면 그 `connect(callbacks)`를 부른다). 새 transport를 만들면 직전 connect가
만든 transport는 새 것을 얻은 뒤 닫는다(factory가 같은 것을 다시 돌려준 경우 제외). callback은 session이 붙든 연결(마지막 connect의 것으로,
다음 connect나 `disconnect()`가 놓을 때까지)에 준 것만 session을 대신하므로, 늦게 온 이전 socket의 close나 `ready`가 새 연결을 끝내거나 열린
것으로 만들지 않는다. 다시 쓰는 넘겨받은 `transport`도 같다. connect마다 callback을 새로 받으므로 마지막 connect의 callback만 session을
대신하고, 이전 connect의 callback으로 늦게 알리는 것(`close()`가 끝난 뒤에 오는 WebSocket의 close event, 그 앞의 종료 frame)은 다음
connect를 끝내지 않으며, 붙든 연결이 없으면(`disconnect()` 뒤) 아무것도 대신하지 않는다(R-PEER-045). `onMessage`가 없는 넘겨받은
transport에 session이 다는 `onMessage`는 그 transport가 connect와 session을 넘어 가지는 것이라 어느 connect의 것도 아니다. 그것은 transport
객체마다 하나인 dispatcher이고, 같은 transport 객체를 받은 session 가운데(`PeerMcpService({transport})`는 만드는 session마다 같은 객체를
넘긴다, R-PEER-055) 그 transport로 마지막에 connect한 session으로 MUST 간다. 그 session에서는 그때 그 transport를 붙든 연결(마지막
connect의 것)을 대신하고, 그 session이 transport를 놓으면(`disconnect()`) 다음 connect가 잡을 때까지 아무것도 대신하지 않는다. 그래서
`disconnect()`한 session 뒤에 같은 transport로 connect하는 session은 그 transport의 `ready`와 답을 받는다. `disconnect()`가 끝낸 connect는
늦게 끝나도 그 dispatcher를 잡지 않으므로(R-PEER-045), 그동안 같은 transport로 connect한 다른 session에게서 그것을 가져가지 않는다.
transport가 이미 가진 caller 자신의 `onMessage`는 바꾸지 않는다. 이 길로는 이전 연결의 frame과 지금 연결의 것을 가를 수 없으므로 `connect(callbacks)`가 있는
transport는 그 callback으로 SHOULD 알린다. 같은 까닭으로 다시 쓰는 transport는 이전 connect의 것(그 연결에 이미 나간 요청의 늦은 답)을 다음
connect의 callback으로 SHOULD NOT 알린다. session이 끝난 연결의 요청을 다음 연결에서 아직 진행 중으로 두는 것은 그 send가 다음 연결에 쓸 수 있을
때뿐이다(R-PEER-032). transport가
닫힐 때(R-PEER-045)와 connect를 시작할 때 이전 연결이 열린
시각(`connectedAt`)과 그 `ready`를 받았다는 표시(`readySeen`)를 지우므로, 닫힌 session의 `connectedAt`은 null이고 timeout은 열리지 않은 새
socket을 열린 것으로 보지 않는다(relay가 아직 돌아오지 않았으면 `TRANSPORT_TIMEOUT`). `disconnect()`가 진행 중일 때 부른 connect는 그
disconnect가 끝난 뒤 시작한다(R-PEER-045).\
근거: `src/client/session.ts:552`, `src/client/session.ts:778`, `src/client/session.ts:786`, `src/client/session.ts:823`, `src/client/session.ts:832`, `src/client/session.ts:673`, `src/client/transport.ts:226`, `src/client/session.ts:340`, `src/client/session.ts:588`, `src/client/session.ts:591`, `src/client/session.ts:952`, `src/client/session.ts:953`, `src/client/session.ts:594`, `src/client/session.ts:603`, `src/client/session.ts:609`, `src/client/session.ts:619`, `src/client/session.ts:632`, `src/client/session.ts:746`, `src/client/session.ts:695`, `src/client/session.ts:697`, `src/client/session.ts:568`, `src/client/session.ts:600`, `src/client/session.ts:601`, `src/client/session.ts:380`, `src/client/session.ts:381`, `src/client/session.ts:81`, `src/client/session.ts:87`, `src/client/session.ts:643`, `src/client/session.ts:644`, `src/client/session.ts:645`, `src/client/session.ts:646`, `src/client/session.ts:705`; 테스트: `test/client-session.test.ts` › `wait for the shared connect instead of writing to a socket that is not open`; `test/client-session.test.ts` › `adopt the relay's session id from the ready frame`; `test/client-session.test.ts` › `connects again on a new socket for the next request after %s`; `test/client-session.test.ts` › `closes the transport a connect replaces, and lets none of its late events speak for the new one`; `test/client-session.test.ts` › `does not take a new transport that never opens for the one that was open, after %s`; `test/client-session.test.ts` › `lets %s made while it runs connect once it has closed the socket, so one socket stays open`; `test/client-session.test.ts` › `leaves open a transport a factory hands out again to the connect after it, when %s`; `test/client-session.test.ts` › `lets nothing the transport reports while it closes end the session, so the next request connects again`; `test/client-session.test.ts` › `lets nothing it reports late through an earlier connect's callbacks (%s) end the connect after it`; `test/client-session.test.ts` › `delivers what reaches the onMessage the session gave it to the connect that holds it, and to nothing after disconnect()`; `test/client-session.test.ts` › `delivers what reaches the onMessage a session gave it to the session that took it last, of every session handed it`; `test/client-session.test.ts` › `lets a connect disconnect() ended take that onMessage from no session, though it finishes after another session took it`

**R-PEER-032** `request(method, params, {id, timeoutMs, raw})`는 `{jsonrpc:'2.0', id, method, params}`를 보내며 기본 id는
`'<sessionId || "peer">-<++n>'` 문자열이다. raw가 아닌 transport에는 `options.raw`가 아니면 `{type:'mcp', message}`로 싸서 보내고,
HTTP transport(raw)는 그대로 POST한다. client는 받은 message(`mcp` envelope이면 그 `message`)를 relay와 같은 규칙(R-MCP-002)으로 답으로
MUST 본다: `jsonrpc:'2.0'`, 문자열이나 수인 id, 그리고 `result`나 `error` member. method가 있는 message(provider의 notification과
server→client 요청, R-MCP-041)는 id가 무엇이든 답이 아니고, id가 null이거나 없는 message도 답이 아니다. 답을 받으면 먼저 `String(id)`가 쥔
slot(R-PEER-035)을 풀고, 같은 `String(id)`의 pending 요청이 있으면 `error`가 truthy일 때 `PeerMcpRpcError`로 거절하고 아니면 그 message로
끝낸다. 그래서 provider의 요청이 진행 중인 요청과 같은 id를 가져도 그 요청을 끝내거나 relay가 아직 세는 slot을 비우지 않는다. client는
답을 `String(id)`로 맞추므로 수 1과 문자열 `"1"`을 한 id로 본다. 그래서 진행 중인 요청과 `String(id)`가 같은 id의 요청은 보내지 않고
`PeerMcpError('Peer MCP request id <id> is already in flight', 'DUPLICATE_REQUEST_ID', {method, id})`로 MUST 거절한다(raw transport 포함).
요청은 모든 transport에서 같은 규칙으로 `request()`를 부른 때부터 그 답이 오거나 그 연결이 끝날 때까지 MUST 진행 중이다. 연결, slot,
답, 재시도(R-PEER-036)를 기다리거나 보내는 중인 요청이 그렇고, 호출자가 timeout으로 멈춘 뒤에도 답이 오기 전에는 그렇다(relay가 아직
답하지 않아 slot을 쥔 요청, send가 답보다 먼저 돌아오는 raw transport의 요청). 내장 HTTP transport는 send가 POST 전체이고 답이 그 POST와
함께 오므로, 그 요청은 timeout이 pending을 거절한 뒤에도 POST가 끝날 때까지 진행 중이고, POST가 답 없이 끝나도 거기서 끝난다. 연결을
끝내지 않는 transport 오류(`onError`)와 `{type:'error'}` frame(R-PEER-038)은 기다리는 요청을 그 오류로 거절하지만 id를 놓지 않는다. 그 연결은
이어지고 그 callback이 session을 대신하므로, 보냈거나 보내는 중인 요청은 timeout된 요청처럼 그 답이 올 때까지(내장 HTTP transport에서는 POST가
끝날 때까지, send가 실패하면 거기서) MUST 진행 중이고 slot도 그대로다(R-PEER-035). 연결이 끝나면(`disconnect()`, transport close, R-PEER-038의
session을 끝내는 frame, 실패한 connect) 그 요청을 모두 거절하고 그 요청들은 id를 MUST 바로 놓는다. 아직 끝나지 않은 send가 있어도 같다.
`disconnect()`나 다음 connect가 놓은 연결의 callback은 session을 대신하지 않으므로(R-PEER-031) 그 연결의 늦은 답은 다음 연결의 요청에 닿지
않는다. 그 send는 나중에 끝나도 그 요청을 보내거나 다시 보내지 않고, 그동안 같은 id로 보낸 요청의 id·pending·slot을 건드리지 않는다. 다만 그
send는 중간에 끊을 수 없고 그 transport가 쓸 때 가진 연결에 쓰므로, 다음 연결이 같은 transport를 다시 쓰면(넘겨받은 `transport`, factory가
다시 돌려준 transport) 그 요청은 그 연결에 나갈 수 있다. 그래서 그 send가 도는 동안 그 transport를 쓰는 살아 있는 연결에서 그 id는 MUST 진행
중이다(그 id의 요청은 보내지 않고 거절한다. transport를 아직 얻는 중인 connect를 기다린 요청은 그 connect가 transport를 얻은 뒤 보내기 전에
거절한다). 그 send가 성공해 끝난 때 session의 살아 있는 연결이 그 transport를 쓰면(아직 transport를 얻는 중이라 그것일 수 있을 때도) 그 요청은 그 연결에 나간
것으로 보고, 그 답이 오거나 그 연결이 끝날 때까지 그 연결에서 진행 중이다. 그동안 그 요청은 그 연결의 slot 하나를 센다(R-PEER-035). send가
실패하거나 그 transport를 쓰는 살아 있는 연결이 없으면 거기서 끝난다. 연결마다 자기 transport를 쓰는 WebSocket·Streamable HTTP transport에서는
그런 요청이 다음 연결의 id를 막지 않는다. 다시 쓰는 transport는 이전 connect로 이미 보낸 요청의 답을 다음 connect의 callback으로 SHOULD NOT
알린다. session은 그것을 다음 연결의 답과 가를 수 없다(R-PEER-031). 연결을 기다리는 요청은 `disconnect()`가 그 connect보다 먼저 바로 끝내므로(R-PEER-045), transport를 얻는 중이라 아직 끝나지
않은 connect를 기다리며 id를 쥐고 남지 않는다. 재시도를 기다리는 요청은 다시 보낼 때 자신의 id를 그대로 쓴다. MCP는 한 session 안에서 요청 id를
다시 쓰지 않게 하고, 다시 보낸 요청은 앞 요청의 답을 가로채거나 relay가 아직 세는 slot을 비울 것이기 때문이다(relay socket에서는 relay도
같은 id를 `DUPLICATE_REQUEST_ID`로 거절한다, R-MCP-031). relay가 key에 id의 type을 넣는 것(R-MCP-003)보다 엄격하므로 session이 진행 중으로
세는 요청은 relay가 세는 요청을 모두 포함한다(R-PEER-035).\
근거: `src/client/session.ts:1254`, `src/client/session.ts:1353`, `src/client/session.ts:889`, `src/client/session.ts:899`, `src/client/session.ts:902`, `src/client/session.ts:904`, `src/client/session.ts:908`, `src/client/session.ts:909`, `src/client/session.ts:142`, `src/client/session.ts:144`, `src/client/session.ts:1258`, `src/client/session.ts:1106`, `src/client/session.ts:129`, `src/client/session.ts:984`, `src/client/session.ts:1262`, `src/client/session.ts:1279`, `src/client/session.ts:1308`, `src/client/session.ts:903`, `src/client/session.ts:1156`, `src/client/session.ts:1172`, `src/client/session.ts:1348`, `src/client/session.ts:1357`, `src/client/session.ts:653`, `src/client/session.ts:1014`, `src/client/session.ts:1017`, `src/client/session.ts:1309`, `src/client/session.ts:1321`, `src/client/session.ts:1364`, `src/client/session.ts:1365`, `src/client/session.ts:886`, `src/client/session.ts:936`, `src/client/session.ts:995`, `src/client/session.ts:1015`, `src/client/session.ts:1019`, `src/client/session.ts:730`, `src/client/session.ts:1350`, `src/client/session.ts:1125`, `src/client/session.ts:1126`, `src/client/session.ts:1314`, `src/client/session.ts:1372`, `src/client/session.ts:1139`, `src/client/session.ts:1140`, `src/client/session.ts:1161`, `src/server/peer-server.ts:1245`, `src/server/peer-server.ts:1249`; 테스트: `test/client-request-limit.test.ts` › `sends a request of exactly the limit and refuses one byte more`; `test/client-pending-limit.test.ts` › `takes no request of the provider's for the answer to a call in flight under its id, so the call keeps the slot the relay counts`; `test/client-pending-limit.test.ts` › `is refused DUPLICATE_REQUEST_ID for another request, unsent, until it is answered, %s`; `test/client-pending-limit.test.ts` › `is refused for another request while its request holds a slot its caller gave up, or waits for one`; `test/client-pending-limit.test.ts` › `is refused for another request while the HTTP POST of a request that timed out still runs, so the other does not take its answer`; `test/client-pending-limit.test.ts` › `is freed once the HTTP POST of a request that timed out has ended, though no answer came with it`; `test/client-pending-limit.test.ts` › `is refused for another request after its caller timed out over a raw transport whose send returns first, until its answer arrives, so the other does not take it`; `test/client-busy-retry.test.ts` › `keeps its id in flight while it waits to be sent again, so another request under it is refused and its own retry is not`; `test/client-session.test.ts` › `ends a request at once whose connect %s, so a request under its id is sent after the next connect`; `test/client-session.test.ts` › `gives back at once the id of a request whose send still runs, and that send, when it %s later, touches nothing of the request sent under its id after the next connect`; `test/client-session.test.ts` › `keeps the id of a request whose send still runs on %s in flight on the next connect, which uses it again, until its answer, so a request under it takes neither that answer nor a slot`; `test/client-session.test.ts` › `keeps in flight the id of a request whose send goes out while a factory still makes the next connect's transport, once that turns out to be the same transport again`; `test/client-pending-limit.test.ts` › `is refused for another request while the HTTP POST of a request an error frame rejected still runs, since that frame ends no connection, so the other does not take its answer`; `test/client-pending-limit.test.ts` › `is refused for another request while a request %s rejected is still sent or answered on the connection it left open, which still counts its slot`

**R-PEER-033** 두 내장 transport는 wire에 놓을 것의 UTF-8 크기(WebSocket은 `{type:'mcp'}` envelope을 포함한 직렬화 frame, HTTP는
`JSON.stringify(rpc)` body)를 재고, 261120 byte를 넘으면 아무것도 쓰지 않고 `PeerMcpError('Peer MCP request is <B> bytes, over the
relay's 261120-byte request limit', 'REQUEST_TOO_LARGE', {bytes, limitBytes:261120})`를 MUST 던진다. 그 호출만 실패하고 session은
연결된 채다. 정확히 261120 byte는 보낸다. relay가 각 transport에서 재는 것과 같은 byte다(R-MCP-027). WebSocket transport는 pong을 포함한 모든 frame에 이 검사를 한다.\
근거: `src/client/transport.ts:77`, `src/client/transport.ts:79`, `src/client/transport.ts:155`, `src/client/transport.ts:233`; 테스트: `test/client-request-limit.test.ts` › `rejects only the oversized tools/call, writes nothing, and keeps the session and a concurrent call alive`; `test/client-request-limit.test.ts` › `counts the limit in UTF-8 bytes, not UTF-16 code units: %s`; `test/client-request-limit.test.ts` › `posts a body of exactly the limit and refuses a larger one without calling fetchImpl`

**R-PEER-034** raw가 아닌 transport에서 JSON text가 1024 byte를 넘는 문자열 id는 보내기 전에 `REQUEST_ID_TOO_LARGE`
(`{bytes, limitBytes:1024}`)로 MUST 거절한다. 수 id는 검사하지 않는다. HTTP transport는 id를 검사하지 않고, id가 null인 JSON-RPC
오류 body에 요청 id를 채운다.\
근거: `src/client/transport.ts:93`, `src/client/transport.ts:94`, `src/client/session.ts:1316`, `src/client/transport.ts:261`; 테스트: `test/client-pending-limit.test.ts` › `is refused before it is sent when its id is over 1 KiB of JSON, which the relay would answer with id null`

**R-PEER-035** raw가 아닌 transport에서 session은 요청 id를 최대 64개(`PEER_RELAY_MAX_PENDING_REQUESTS`) 진행 중으로 MUST 둔다. 그
이상은 앞선 대기자 뒤에서 FIFO로 기다리다가 slot이 비면 보낸다. slot은 그 id의 답이 오면(호출자가 이미 timeout됐어도) 또는 send가
던지면 풀린다. 연결이 끝나면(close, `disconnect()`, session을 끝내는 frame, 실패한 connect) 모두 비운다. 연결을 끝내지 않는 transport 오류와
`{type:'error'}` frame은 slot을 기다리는 요청만 거절하고, 보낸 요청의 slot은 그 답이 올 때까지 그대로 둔다(relay가 아직 센다, R-PEER-032).
연결이 끝날 때 send가 아직 돌던 요청은 다음 연결이 같은 transport를 다시 쓰면 그 send가 도는 동안과 그 연결에 나간 뒤 답이 올 때까지 그 연결의
slot 하나를 센다(R-PEER-032). 대기 시간은 요청 timeout에 들어가며 시간이 지나면 보내지 않고
`REQUEST_TIMEOUT`이다. raw transport에는 상한이 없다. relay는 outbox에서 기다리는 답만 세고 답이 아닌 frame은 세지 않으며(R-MCP-032),
session은 relay가 답으로 보는 message로만 slot을 풀고(provider의 요청은 slot을 풀지 않는다) 진행 중인 id를 다시 쓰지 않으므로(R-PEER-032),
session이 진행 중으로 세는 요청은 relay가 세는 요청을 모두 포함한다.\
근거: `src/client/session.ts:1066`, `src/client/session.ts:1069`, `src/client/session.ts:1087`, `src/client/session.ts:1176`, `src/client/session.ts:1012`, `src/client/session.ts:1359`, `src/client/session.ts:1021`, `src/client/session.ts:1034`, `src/client/session.ts:1182`, `src/client/session.ts:1194`, `src/client/session.ts:1161`; 테스트: `test/client-pending-limit.test.ts` › `sends a request past them once an earlier one is answered, so 100 concurrent calls all succeed`; `test/client-pending-limit.test.ts` › `keeps a request's slot after its caller timed out, until the relay answers it`; `test/client-pending-limit.test.ts` › `is not bounded: each request is answered on its own, so all of them are sent at once`; `test/client-pending-limit.test.ts` › `is refused for another request while a request %s rejected is still sent or answered on the connection it left open, which still counts its slot`; `test/client-session.test.ts` › `keeps the id of a request whose send still runs on %s in flight on the next connect, which uses it again, until its answer, so a request under it takes neither that answer nor a slot`

**R-PEER-036** `rpcError.data.retryable === true`인 `PeerMcpRpcError`(relay의 `PROVIDER_BUSY`)는 같은 id로 다시 보낸다. backoff는 100 ms에서
시작해 두 배씩 2000 ms까지 늘고(100, 200, 400, 800, 1600, 2000, 2000, …), 매번 기다리는 시간은 `max(backoff, rpcError.retryAfterMs)`다.
`retryAfterMs`는 HTTP transport가 응답의 `Retry-After`(delay-seconds 또는 HTTP-date, RFC 9110 §10.2.3)에서 읽은 지연이므로(R-ERR-004),
relay의 503 `PROVIDER_BUSY`(`Retry-After: 1`)는 1000 ms 뒤에 다시 보낸다. `deadline − now`가 그 기다림 이하가 되면 마지막 거절을
던진다(`REQUEST_TIMEOUT`이 아니다). 그 밖의 오류(retryable 없는 −32001 포함)는 바로 던진다. backoff 중의 disconnect·transport 오류·close는
재접속·재전송 없이 대기를 거절한다. backoff 동안에도 그 요청은 진행 중이므로 같은 id의 다른 요청은 `DUPLICATE_REQUEST_ID`이고, 다시 보내는
그 요청 자신은 거절되지 않는다(R-PEER-032). client는 이 규칙을 MUST 따른다.\
근거: `src/client/session.ts:267`, `src/client/session.ts:269`, `src/client/session.ts:272`, `src/client/session.ts:282`, `src/client/session.ts:1249`, `src/client/session.ts:1270`, `src/client/session.ts:1271`, `src/client/session.ts:1273`, `src/client/session.ts:1274`, `src/client/session.ts:1041`, `src/client/session.ts:1262`, `src/client/transport.ts:188`, `src/client/transport.ts:258`; 테스트: `test/client-busy-retry.test.ts` › `is sent again under the same id after 100 ms, then 200 ms, and resolves with the answer that got through`; `test/client-busy-retry.test.ts` › `keeps its id in flight while it waits to be sent again, so another request under it is refused and its own retry is not`; `test/client-busy-retry.test.ts` › `stops once the next backoff would outlast its %i ms timeout and rejects with the last PROVIDER_BUSY`; `test/client-busy-retry.test.ts` › `is the only kind retried: %s is reported at once`; `test/client-busy-retry.test.ts` › `waits at least as long as Retry-After asks before sending the request again`; `test/client-busy-retry.test.ts` › `reports the refusal at once when Retry-After asks for longer than the request's timeout leaves`

**R-PEER-037** HTTP transport는 `mcpEndpoint`에 `content-type: application/json`, `accept: application/json, text/event-stream`
(`MCP_HTTP_ACCEPT`, Streamable HTTP가 요구하는 두 형식), `user-agent: framebook-peer-mcp-client/<PACKAGE_VERSION>`(이 package의 version,
지금 `0.1.0`. `PACKAGE_VERSION`은 package.json의 `version`과 같아야 하며 테스트가 이를 강제한다), clientToken이 있으면
`authorization: Bearer <clientToken>`으로 POST한다. `initialize()`가 성공한 뒤 다음 `disconnect()`까지의 모든 POST에는 협상된
`result.protocolVersion`을 `mcp-protocol-version` header로 MUST 싣는다(`initialize` 자신에는 싣지 않는다). 2xx `text/event-stream` 응답은
각 event의 `data` line을 이어 붙인 JSON object를 차례로 넘긴다(JSON object가 아닌 event는 건너뛴다). 그 밖의 응답 처리는 R-ERR-004를
따르고, 2xx는 해석한 body를 넘긴다(빈 202는 무시된다).\
근거: `src/client/transport.ts:170`, `src/client/transport.ts:201`, `src/client/transport.ts:215`, `src/client/transport.ts:235`, `src/client/transport.ts:239`, `src/client/transport.ts:240`, `src/client/transport.ts:241`, `src/client/transport.ts:243`, `src/client/transport.ts:248`, `src/client/transport.ts:249`, `src/client/transport.ts:281`, `src/client/session.ts:651`, `src/client/session.ts:1585`, `src/client/types.ts:10`; 테스트: `test/client-request-limit.test.ts` › `surfaces the relay's HTTP 413 REQUEST_TOO_LARGE as a JSON-RPC error of that call only`; `test/client-session.test.ts` › `accepts JSON and SSE, ends initialize with notifications/initialized, and names the negotiated revision on every later request`; `test/client-session.test.ts` › `is served by the relay with the revision it negotiated`; `test/client-session.test.ts` › `reads a response the server sends as an event stream`; `test/client-session.test.ts` › `names the package's own version as clientInfo.version and in its user-agent`

**R-PEER-038** WebSocket frame `session.revoked`·`collaboration.revoked`는 `SESSION_REVOKED`, `room.rotated`는 `ROOM_ROTATED`,
`room.expired`는 `ROOM_EXPIRED`, `approval.expired`는 `APPROVAL_EXPIRED`, `collaboration.expired`는 `SESSION_EXPIRED`,
`approval.rejected`는 `CLIENT_APPROVAL_DENIED`(`TERMINAL_FRAMES`. `PeerMcpError`, message는 `reason` || `message` || 기본 문구,
details는 받은 frame이라 `room.rotated`의 대체 room도 담는다)로 session을 `error` 상태로 MUST 끝내고, ready
대기와 모든 pending·slot 대기·backoff 요청을 거절한다. 그 frame은 연결을 끝내므로 요청들은 id와 slot을 바로 놓고(R-PEER-032), 그 연결은
넘겨받은 `transport`를 더는 붙들지 않는다(R-PEER-045). 그 뒤의 요청도 다시 연결하지 않고 같은 오류로 거절한다(R-PEER-045). `{type:'error'}` frame은 ready 대기와 모든 pending·slot 대기·backoff 요청을
`PeerMcpError(code: 문자열 code 또는 PEER_TRANSPORT_ERROR, details: 받은 frame)`로 거절한다. 연결 중(ready 전)이면 그래서 `connect()`가
실패하고 state가 `error`가 된다. 연결된 뒤에는 state를 바꾸지 않고 연결을 끝내지 않으므로, 보냈거나 보내는 중인 요청은 거절된 뒤에도 그 답이
올 때까지 id와 slot을 MUST 쥔다(R-PEER-032, R-PEER-035). 이 relay는 agent에게 `error` frame을 보내지 않고 provider가 보낸
것도 전달하지 않는다(R-SIG-004, R-SIG-021). `{type:'ping'}`에는 `{type:'pong', timestamp}`로 답하고
send 실패는 삼킨다. `approval.pending`, `approval.approved`, `offer.refused`, `answer`는 무시한다.\
근거: `src/client/session.ts:256`, `src/client/session.ts:260`, `src/client/session.ts:843`, `src/client/session.ts:850`, `src/client/session.ts:851`, `src/client/session.ts:855`, `src/client/session.ts:856`, `src/client/session.ts:860`, `src/client/session.ts:878`, `src/client/session.ts:883`, `src/client/session.ts:885`, `src/client/session.ts:886`, `src/client/session.ts:677`, `src/client/session.ts:680`, `src/client/session.ts:919`, `src/client/session.ts:1012`, `src/client/session.ts:861`, `src/client/session.ts:862`, `src/client/session.ts:1032`; 테스트: `test/client-request-limit.test.ts` › `drops an asynchronously failed pong send without an unhandled rejection and keeps the session`; `test/client-session.test.ts` › `rejects a WebSocket request in flight with ROOM_EXPIRED, not SESSION_REVOKED`; `test/client-pending-limit.test.ts` › `is refused for another request while the HTTP POST of a request an error frame rejected still runs, since that frame ends no connection, so the other does not take its answer`; `test/client-pending-limit.test.ts` › `is refused for another request while a request %s rejected is still sent or answered on the connection it left open, which still counts its slot`

**R-PEER-039** `initialize()`는 params `{protocolVersion: options.protocolVersion ?? '2025-11-25', capabilities:{}, clientInfo:{name:
'framebook-cli', version: PACKAGE_VERSION}}`(R-PEER-037)를 MUST 보낸다. 결과가 object가 아니면 `INVALID_RESPONSE`다. `result._meta.roomEpoch`(safe integer
≥ 0, roomId가 맞을 때)를 받아들인다. 그다음 비어 있지 않은 문자열 `result.protocolVersion`을 협상된 revision으로 기록하고(HTTP transport가
header로 싣는다, R-PEER-037), MCP lifecycle대로 `notifications/initialized` notification(id 없음, raw가 아닌 transport에서는 `mcp`
envelope)을 보낸 뒤 결과를 돌려준다. notification을 보내지 못하면 initialization이 끝나지 않았으므로 그 오류로 거절한다. 협상된 version이
client가 아는 것인지는 검사하지 않는다.\
근거: `src/client/types.ts:4`, `src/client/session.ts:1377`, `src/client/session.ts:1381`, `src/client/session.ts:1391`, `src/client/session.ts:1396`, `src/client/session.ts:1397`, `src/client/session.ts:1398`, `src/client/session.ts:1403`, `src/client/session.ts:1409`, `src/client/types.ts:10`; 테스트: `test/client-session.test.ts` › `revokes a README-style Streamable HTTP session after initialize`; `test/client-session.test.ts` › `accepts JSON and SSE, ends initialize with notifications/initialized, and names the negotiated revision on every later request`; `test/client-session.test.ts` › `initializes and lists tools for ${target.label}`; `test/client-session.test.ts` › `names the package's own version as clientInfo.version and in its user-agent`

**R-PEER-040** `listTools()`는 params `{cursor?, _meta:{sessionId, runtimeEpoch, catalogVersion, catalogHash}}`를 보낸다(`_meta`가 늘
있으므로 relay는 WebSocket listing의 `result._meta`와, deprecated인 `result` 최상위에 stamp한다, R-MCP-038). tools를 `normalizeTools`로 relay와 같은 catalog 계약(R-CAT-001)에 따라 검사한다.
배열이 아니거나 128개를 넘으면 `INVALID_TOOLS_LIST`, object가 아니거나, 이름이 문자열이 아니거나 비었거나 앞뒤 공백이 있거나(trim하지
않는다), `inputSchema.type !== 'object'`이면 `INVALID_TOOL_DESCRIPTOR`, 이름이 256 UTF-16 code unit을 넘으면 `TOOL_NAME_TOO_LONG`,
이름이 겹치면 `DUPLICATE_TOOL`이다. 검사한 뒤 `catalogVersion`·`catalogHash`를 `result.X ?? result._meta.X`(WebSocket 최상위와 HTTP `_meta`를 둘 다)
에서 읽어 catalog cache를 MUST 바꾼다.\
근거: `src/client/session.ts:1425`, `src/client/session.ts:1428`, `src/client/session.ts:1435`, `src/client/session.ts:1441`, `src/client/catalog-hash.ts:80`, `src/client/catalog-hash.ts:87`, `src/client/catalog-hash.ts:100`, `src/client/catalog-hash.ts:120`; 테스트: `test/catalog-contract.test.ts` › `announces accepted catalogs with the relay's authoritative version and hash`; `test/catalog-contract.test.ts` › `refuses exactly the catalogs the client refuses, and neither side trims a tool name`

**R-PEER-041** client는 relay가 준 `catalogHash`를 그대로 받지 않고, 정규화한 tools를 relay와 같은 알고리즘의 `hashTools`(R-CAT-002)로 다시
계산해 MUST 비교한다. 다르면 catalog를 바꾸지 않고 `PeerMcpError('Peer catalog hash <relay hash> does not match its tools, which hash to
<계산값>', 'CATALOG_INTEGRITY_UNVERIFIED', {catalogHash, computedHash})`를 던진다(listing은 호출자에게, `register` frame은 session error로,
R-PEER-042). 같은 알고리즘을 쓰는 relay에서는 이 거절이 생기지 않는다. hash가 없으면 계산값을 쓴다. version이 없으면 hash가 바뀌었을 때
이전 + 1(이전이 수가 아니면 1), 아니면 이전 값(없으면 0)이다. 저장한 cache를 되살릴 때도 hash를 다시 계산한다. 그래서 session이
`tools/call`에 싣는 catalog stamp는 언제나 client가 검사한 tools를 기술한다. 데모 agent도 같은 이름으로 막는다.\
근거: `src/client/session.ts:1512`, `src/client/session.ts:1514`, `src/client/session.ts:1515`, `src/client/session.ts:1516`, `src/client/session.ts:1519`, `src/client/session.ts:519`; 테스트: `test/client-session.test.ts` › `loads only a valid catalog cache from a JSON store`; `test/client-session.test.ts` › `is checked against the tools, so a listing it does not describe is refused and the cached catalog stays`

**R-PEER-042** tools 배열을 가진 `register` frame은 catalog cache를 그 frame의 `catalogVersion`·`catalogHash`로 MUST 바꾼다. 무효한
frame과 `catalogHash`가 tools와 맞지 않는 frame(R-PEER-041)은 handler 안에서 잡아 session error로 남기고 이전 catalog를 유지한다.
`catalogChanged`·`catalog.changed` frame과
`notifications/tools/list_changed`(bare 또는 `mcp` envelope)는 `onCatalogChanged` listener만 부르고 catalog를 새로 읽지 않는다.\
근거: `src/client/session.ts:811`, `src/client/session.ts:866`, `src/client/session.ts:867`, `src/client/session.ts:870`, `src/client/session.ts:890`; 테스트: `test/catalog-contract.test.ts` › `drops an invalid register frame from a legacy relay instead of throwing out of the socket handler`; `test/client-session.test.ts` › `is checked against the tools, so a listing it does not describe is refused and the cached catalog stays`

**R-PEER-043** `callTool(name)`은 빈 이름에 `TOOL_NAME_REQUIRED`를 던진다. cache가 비었고 `refresh !== false`면 먼저 catalog를 읽는다.
cache에 없는 tool은 요청 없이 로컬 `TOOL_NOT_FOUND`(`{name, catalog}`)다. params `{name, arguments, _meta:{sessionId, runtimeEpoch,
catalogVersion, catalogHash}}`를 보낸다. drift 오류(R-PEER-044)를 받으면 catalog를 다시 읽고 `PeerMcpCatalogChangedError`(code
`CATALOG_CHANGED`, snapshot)를 던진다. 단 `readOnly: true`와 `retryOnCatalogChanged: true`면 `refresh: false`로 한 번 다시 시도한다.
결과는 `PeerMcpCallToolResultSchema`(content는 `{type:string}` 배열, `structuredContent`는 object, `isError`는 boolean)를 통과해야
하며 아니면 `INVALID_TOOL_RESULT`다. client는 이 규칙을 MUST 따른다.\
근거: `src/client/session.ts:1455`, `src/client/session.ts:1461`, `src/client/session.ts:1462`, `src/client/session.ts:1465`, `src/client/session.ts:1470`, `src/client/session.ts:1484`, `src/client/session.ts:1487`, `src/client/session.ts:1495`, `src/client/schemas.ts:32`; 테스트: `test/live-demo.e2e.test.ts` › `surfaces relay catalog drift over HTTP as PeerMcpCatalogChangedError (no host write)`; `test/client-session.test.ts` › `rejects a tools/call result that is not a CallToolResult`

**R-PEER-044** `isCatalogChangedRpcError`는 수 `error.code`(또는 `data.code`)가 있으면 그것만으로 판단해 −32010·−32027일 때만 참이다.
수 code가 없으면 canonical 이름이 `CATALOG_CHANGED`, `CATALOG_STALE`, `SOURCE_CHANGED`, `RUNTIME_EPOCH_MISMATCH`일 때 참이다. client는
이 분류를 MUST 쓴다. −32027과 뒤의 세 이름은 예약된 값이다(R-ERR-006). 이 relay와 provider는 내지 않지만, 그것을 내는 다른 relay와의
호환을 위해 client는 drift로 분류한다.\
근거: `src/client/errors.ts:52`, `src/client/errors.ts:56`, `src/client/errors.ts:81`, `src/client/errors.ts:84`; 테스트: `test/live-demo.e2e.test.ts` › `only treats registry drift codes as catalog changes`

**R-PEER-045** transport close는 state가 `disconnecting`·`idle`·`error`가 아니면 state를 `disconnected`로 하고 모든 요청을
`TRANSPORT_CLOSED`로, transport 오류는 그 오류(Error가 아니면 `PEER_TRANSPORT_ERROR`)로 거절한다. close는 연결을 끝내 요청들이 id를 놓지만,
transport 오류는 연결을 끝내지 않으므로 기다리는 요청만 거절하고 보낸 요청의 id와 slot은 그 답이 올 때까지 MUST 둔다(R-PEER-032, R-PEER-035).
연결을 끝내는 오류는 transport가 close로 알린다. transport가 close code를 알리면
(`PeerMcpTransportCallbacks.onClose(close)`, WebSocket transport는 close event의 `code`·`reason`을 `PeerMcpTransportClose`로 넘긴다)
`TRANSPORT_CLOSED`의 `details`는 `{code, reason}`이다. code가 없는 transport(Streamable HTTP, code를 알리지 않는 custom transport)면 `details`가
없다. `disconnect()`는 기다리는 요청과 진행 중인 connect를 바로 `SESSION_DISCONNECTED`로 MUST 거절한다(`ready`를 기다리던 connect도
timeout을 기다리지 않고, 그 대기는 다음 connect에 남지 않는다). 모든 요청은 그때 id를 MUST 바로 놓는다(R-PEER-032). 아직 끝나지 않은 send가
있는 요청도 그 send를 기다리지 않는다. 그 send가 나중에 끝나도 다음 연결에서 같은 id로 보낸 요청을 건드리지 않는다. 다음 연결이 그 transport를
다시 쓰면(넘겨받은 `transport`, factory가 다시 돌려준 transport) 그 send는 그 연결에 쓸 수 있으므로, 그 send가 도는 동안과 그 요청이 그 연결에
나간 뒤 답이 올 때까지 그 연결에서 그 id는 진행 중이다(R-PEER-032). connect를
기다리던 요청도 그 connect를 기다리지 않고 MUST 바로 끝나 자신의 id를 놓는다(R-PEER-032). transport를 얻는 중인 connect(`transportFactory`나 넘겨받은 `transport`의 `connect`가 아직 돌아오지 않은
것)는 중간에 끊을 수 없어 그것이 돌아온 뒤에야 `SESSION_DISCONNECTED`로 끝나고, 요청의 timeout은 connect 뒤에 시작하기 때문이다(transport
오류와 close도 connect를 기다리는 요청을 그 오류로 바로 끝낸다). 그다음 session이 붙든 연결을 놓아 그 transport가 닫히며 또는 그 뒤에 그
연결의 callback으로 알리는 것(close, `ready`, session을 끝내는 frame)이 session을 바꾸지 않게 하고(다음 connect가 넘겨받은 `transport`를 다시
연결한 뒤에 와도 같다, R-PEER-031), 붙든 transport를 닫은 뒤 state를 `idle`로 한다. 붙든 transport는 연결의
transport(진행 중인 connect가 연결하던 넘겨받은 `transport` 포함)와 그 연결이 대신하려던 이전 transport다. transport를 얻는 중이던 connect는
그 뒤에 얻은 transport를 닫는다. 다만 그때 그 transport를 붙든 연결이 있으면 MUST 닫지 않는다. 넘겨받은 `transport`는 그 transport 객체를
받은 어느 session의 연결이든 붙들고 있으면 닫지 않는다(이 session의 다음 connect, 같은 transport를 받은 다른 session의 connect. 연결은 그
connect를 시작할 때부터 끝날 때까지 그것을 붙들고, 아직 연결하는 중이어도 붙든 것이다. 연결은 그 connect가 실패하거나, transport가 닫히거나,
session을 끝내는 frame이 오거나(R-PEER-038), 다음 connect나 `disconnect()`가 놓으면 끝나 더는 붙들지 않는다. 끝난 연결은 그 transport를 쓰지
않으므로, session을 다시 연결하지 않고 남은 그런 연결이 아무도 쓰지 않는 transport를 열어 두지 않는다). factory가 만든
transport는 session이 그때 붙든 연결이 같은 transport를 쓰면(factory가 다시 돌려준 transport) 닫지 않고, 그 연결이 아직 transport를 얻는
중이면 그 연결이 자기 transport를 얻은 뒤 그것과 다를 때 닫는다. 그래서 `disconnect()`한 session의 connect가 늦게 끝나도 그동안 같은
transport로 connect한 다른 session(`PeerMcpService({transport})`의 다음 session)은 그 transport를 그대로 쓴다. 끝난
connect는 `ready`가 같은 tick에 왔어도 `connected`가 되지 않고 state를 바꾸지 않으며, 넘겨받은 `transport`의 `onMessage` dispatcher(R-PEER-031)를
잡지도 않는다. disconnect가 끝나기 전에 부른 `connect()`나 요청의
connect는 disconnect가 transport를 닫고 `idle`로 한 뒤 MUST 시작하고(await한 `disconnect()` 뒤와 같다), 그 connect가 시작하기 전에 다시 부른
`disconnect()`는 그 connect도 `SESSION_DISCONNECTED`로 끝내고 진행 중인 disconnect가 transport를 닫은 뒤 함께 끝난다. 그래서 열린 채 남는
transport가 없고 session이 쓰는 transport는 많아야 하나이며, 이 호출들 가운데 마지막 것이 끝 state를 정한다. session은 스스로 재접속하지 않는다. 다음
`request()`는 close code에 따라 R-WS-030을 MUST 따른다. 다시 붙어도 되는 close(1001, 1006, 1013, `isReconnectableCloseCode`. code를 알리지 않은
close는 close frame 없이 끊긴 1006으로 본다) 뒤에는 `connect()`로 새 transport를 열어(R-PEER-031) 보낸다. 그 밖의 close(1000, 4001, 4002,
1002·1003·1007·1009·1011 등) 뒤와 session을 끝낸 frame(`approval.rejected`, `approval.expired`, `session.revoked`, `room.rotated`, `room.expired`,
state `error`) 뒤에는 다시 연결하지 않고 그 `TRANSPORT_CLOSED`(같은 `details`)나 그 frame의 오류로 거절한다. 4001 뒤에 다시 붙으면 자기를
대신한 socket을 밀어낸다. 그 상태는 호출자의 `connect()`(그리고 `disconnect()`)만 끝내며, 다시 연결할지는 호출자가 `details.code`나 오류
code로 정한다. `PeerMcpService`의 `callTool`·`refreshCatalog`도 session의 요청으로 연결하므로 같은 규칙을 따른다.\
근거: `src/client/session.ts:622`, `src/client/session.ts:932`, `src/client/session.ts:949`, `src/client/session.ts:954`, `src/client/session.ts:955`, `src/client/session.ts:1572`, `src/client/session.ts:1574`, `src/client/session.ts:1576`, `src/client/session.ts:1579`, `src/client/session.ts:1583`, `src/client/session.ts:1584`, `src/client/session.ts:1591`, `src/client/session.ts:1592`, `src/client/session.ts:1602`, `src/client/session.ts:1607`, `src/client/session.ts:568`, `src/client/session.ts:585`, `src/client/session.ts:644`, `src/client/session.ts:660`, `src/client/session.ts:670`, `src/client/session.ts:748`, `src/client/session.ts:766`, `src/client/session.ts:103`, `src/client/session.ts:605`, `src/client/session.ts:720`, `src/client/session.ts:1014`, `src/client/session.ts:771`, `src/client/session.ts:774`, `src/client/session.ts:775`, `src/client/session.ts:679`, `src/client/session.ts:1305`, `src/client/session.ts:859`, `src/client/session.ts:956`, `src/client/session.ts:1307`, `src/client/session.ts:592`, `src/client/session.ts:1586`, `src/client/session.ts:971`, `src/client/session.ts:1049`, `src/client/session.ts:1209`, `src/client/session.ts:1308`, `src/client/session.ts:936`, `src/client/session.ts:597`, `src/client/session.ts:682`, `src/client/session.ts:861`, `src/client/session.ts:958`, `src/client/session.ts:702`, `src/client/session.ts:719`, `src/client/session.ts:1015`, `src/client/session.ts:1314`, `src/client/service.ts:89`, `src/client/service.ts:105`, `src/config/close-codes.ts:43`, `src/client/transport.ts:136`, `src/client/transport.ts:137`, `src/client/transport.ts:139`, `src/client/types.ts:110`, `src/client/types.ts:119`, `src/client/types.ts:125`; 테스트: `test/client-request-limit.test.ts` › `rejects a call whose session disconnects during its HTTP POST without an unhandled rejection`; `test/client-session.test.ts` › `rejects a request in flight with TRANSPORT_CLOSED, whose details carry the close code`; `test/client-session.test.ts` › `connects again on a new socket for the next request after %s`; `test/client-session.test.ts` › `fails the next request after %s without connecting again, until connect() is called`; `test/client-session.test.ts` › `fails the next request after the frame that ended its session, without connecting again`; `test/client-session.test.ts` › `lets a PeerMcpService call connect only as a request would, so it does not displace the socket that replaced its own`; `test/client-session.test.ts` › `lets %s made while it runs connect once it has closed the socket, so one socket stays open`; `test/client-session.test.ts` › `ends a connect %s with SESSION_DISCONNECTED at once, closes its transport and leaves the session idle`; `test/client-session.test.ts` › `ends a request at once whose connect %s, so a request under its id is sent after the next connect`; `test/client-session.test.ts` › `gives back at once the id of a request whose send still runs, and that send, when it %s later, touches nothing of the request sent under its id after the next connect`; `test/client-session.test.ts` › `ends a request waiting for a connect at once with TRANSPORT_CLOSED when that connect's transport closes while a factory still makes it`; `test/client-session.test.ts` › `ends a connect whose ready arrives in the same tick as disconnect(), so the session stays idle`; `test/client-session.test.ts` › `starts a new connect for a connect() made right after it, instead of handing out the one it ended`; `test/client-session.test.ts` › `ends a connect asked for while it runs when disconnect() is called again before that connect starts`; `test/client-session.test.ts` › `resolves a second disconnect() once the first has closed the transport, so neither leaves a later connect idle`; `test/client-session.test.ts` › `closes the transport a connect was replacing when it ends that connect, without waiting for its new one`; `test/client-session.test.ts` › `closes the transport a connect it ended gets %s, and only that one`; `test/client-session.test.ts` › `leaves open a transport a factory hands out again to the connect after it, when %s`; `test/client-session.test.ts` › `lets nothing the transport reports while it closes end the session, so the next request connects again`; `test/client-session.test.ts` › `closes the transport a connect is connecting, and leaves it to the connect after it, when %s`; `test/client-session.test.ts` › `closes the transport again once a connect it ended has connected it, when no connect uses it`; `test/client-session.test.ts` › `leaves open the transport another session holds when a connect disconnect() ended connects it late, %s`; `test/client-session.test.ts` › `lets nothing it reports late through an earlier connect's callbacks (%s) end the connect after it`; `test/client-session.test.ts` › `lets a connect disconnect() ended take that onMessage from no session, though it finishes after another session took it`; `test/client-session.test.ts` › `closes the transport again once a connect it ended has connected it, though another session's connection held it until %s`; `test/client-session.test.ts` › `closes the transport again once a connect it ended has connected it, though the connect after it failed`; `test/client-session.test.ts` › `keeps the id of a request whose send still runs on %s in flight on the next connect, which uses it again, until its answer, so a request under it takes neither that answer nor a slot`; `test/client-pending-limit.test.ts` › `is refused for another request while a request %s rejected is still sent or answered on the connection it left open, which still counts its slot`

**R-PEER-046** `revoke(reason = 'client-request')`는 clientToken이 MUST 있어야 한다(`CLIENT_TOKEN_REQUIRED`). sessionId가 relay가 묶은
것이면 `POST <roomBase>/sessions/<sessionId>/revoke`, 아니면 `POST <roomBase>/session/revoke`를 `authorization: Bearer <clientToken>`과
body `{sessionId?, roomId?, roomEpoch?, reason, requestedAt}`으로 MUST 한 번만 보낸다. roomBase는 `mcpEndpoint`에서 `/mcp`를 뺀 것, 아니면
`<serverUrl>/p/<roomId>`다. body의 `roomId`·`roomEpoch`는 session이 이미 아는 값(option, `ready` frame, `initialize`·`tools/list` metadata,
`mcpEndpoint`의 room id)일 때만 싣는다. relay는 둘을 요구하지 않고 있을 때만 검사하므로(R-ROOM-071) session은 그것을 알아내려고 먼저
다른 요청(session status, metadata `initialize`)을 보내지 않는다. non-2xx는 다른 수명주기 helper(`readRelayObject`)처럼 비어 있지 않은 문자열 `body.error`를 message와
code로 던지고(relay의 수 `body.code`는 class라 code로 쓰지 않는다, R-ERR-002), `body.error`가 없을 때만 code
`SESSION_REVOKE_FAILED`다. 그래서 호출자는 `SESSION_BINDING_INVALID`, `SESSION_NOT_OWNED`, `CLIENT_TOKEN_INVALID` 등으로 원인을
구별한다. 성공하면 끊는다.\
근거: `src/client/session.ts:1624`, `src/client/session.ts:1630`, `src/client/session.ts:1631`, `src/client/session.ts:1640`, `src/client/session.ts:1645`, `src/client/session.ts:1646`, `src/client/session.ts:1655`, `src/client/session.ts:1656`, `src/client/room-lifecycle.ts:162`; 테스트: `test/client-session.test.ts` › `revokes an HTTP session that never called initialize`; `test/client-session.test.ts` › `revokes an HTTP session %s that never learned its room epoch with one POST, leaving the epoch out`; `test/client-session.test.ts` › `revokes a WebSocket session constructed without a session id`; `test/client-session.test.ts` › `reports the relay's error name as the code of a refused revoke`

**R-PEER-047** `joinPeerRoom`은 roomId(`ROOM_ID_REQUIRED`, 문법 위반은 `ROOM_ID_INVALID`, R-PEER-054)와 inviteToken(`INVITE_TOKEN_REQUIRED`)을 로컬에서 검사한 뒤
`POST <serverUrl>/p/<encodeURIComponent(roomId)>/join`을 `content-type`·`accept: application/json`, `user-agent:
framebook-peer-mcp-client/<PACKAGE_VERSION>`(R-PEER-037), body `{inviteToken, clientLabel(비어 있지 않은 option 또는 'MCP client'), capabilities(비어 있지
않은 option 배열 또는 ['mcp-control'])}`로 MUST 보낸다. non-2xx는 code `body.error || 'HTTP_<status>'`로 던진다. 2xx body는
`PeerClientTicketSchema`(roomId·clientToken·sessionId 비어 있지 않은 문자열, roomEpoch safe integer ≥ 0, issuedAt·expiresAt 유한한 수,
approvalRequired boolean, capabilities 문자열 배열, approvalState·state 문자열, approvalRequestId는 있으면 문자열)를 통과해야 하며
아니면 `INVALID_JOIN_RESPONSE`다. ticket과 serverUrl, wsUrl, mcpEndpoint를 돌려준다.\
근거: `src/client/room-lifecycle.ts:99`, `src/client/room-lifecycle.ts:106`, `src/client/room-lifecycle.ts:108`, `src/client/room-lifecycle.ts:110`, `src/client/room-lifecycle.ts:117`, `src/client/room-lifecycle.ts:134`, `src/client/room-lifecycle.ts:144`, `src/client/schemas.ts:55`, `src/client/types.ts:10`; 테스트: `test/client-session.test.ts` › `rejects a join response that is not a client ticket`

**R-PEER-048** `getPeerSessionStatus`는 `GET <serverUrl>/p/<enc roomId>/sessions/<enc sessionId>`를 `authorization: Bearer
<clientToken>`으로 보낸다(로컬 검사 `ROOM_ID_REQUIRED`, `ROOM_ID_INVALID`(R-PEER-054), `SESSION_REQUIRED`, `CLIENT_TOKEN_REQUIRED`). non-2xx는 code `body.error ||
'HTTP_<status>'`, body에 문자열 `state`가 없거나 roomEpoch가 safe integer ≥ 0이 아니면 `INVALID_SESSION_STATUS`다.
`waitForPeerApproval`은 `max(25, pollIntervalMs ?? 250)` ms마다 `max(poll, timeoutMs ?? 30000)` ms까지 조회한다. `approved`면 끝,
`rejected`는 `CLIENT_APPROVAL_DENIED`, `revoked`는 `SESSION_REVOKED`, `expired`는 `APPROVAL_EXPIRED`(승인 요청 만료와 room 만료가
모두 `expired`다, R-ROOM-035), `room-rotated`는 `ROOM_ROTATED`, 기한 초과는 `APPROVAL_TIMEOUT`, abort는 `APPROVAL_ABORTED`이며 그 밖의
state(`pending-approval` 등)는 계속 조회한다. client는 이 규칙을 MUST 따른다. relay는 rotate된 room의 session status를 410
`ROOM_ROTATED`로 답하므로 `getPeerSessionStatus`가 이미 그 code로 던지고, `room-rotated` 분기는 방어용이다.\
근거: `src/client/room-lifecycle.ts:176`, `src/client/room-lifecycle.ts:187`, `src/client/room-lifecycle.ts:191`, `src/client/room-lifecycle.ts:206`, `src/client/room-lifecycle.ts:214`, `src/client/room-lifecycle.ts:217`, `src/client/room-lifecycle.ts:230`, `src/client/room-lifecycle.ts:236`, `src/client/room-lifecycle.ts:241`, `src/client/room-lifecycle.ts:245`, `src/client/schemas.ts:112`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/client-session.test.ts` › `reports a session still waiting for approval as expired, so waitForPeerApproval throws APPROVAL_EXPIRED`

**R-PEER-049** `discoverPeerCatalog`는 room(roomId, invitationUrl, mcpEndpoint)이 주어지면 일회용 HTTP `PeerMcpSession`으로
`initialize`와 `tools/list`를 해서 serverInfo, protocolVersion(initialize가 협상한 MCP revision), tools, catalogVersion·catalogHash를
돌려준다. serverUrl만 있으면 `GET <serverUrl>/mcp/catalog`(accept JSON, client user-agent)를 보내고 catalogVersion(유한한 수나 비어
있지 않은 문자열, 아니면 1), catalogHash(아니면 `hashTools`), `protocol`(body의 비어 있지 않은 `protocol`. 이 relay는
`webmcp-peer.v1`이고, 없으면 member도 없다), `protocolVersion = PROTOCOL_VERSION`(`2025-11-25`, client의 MCP revision)을 돌려준다.
relay protocol 식별자는 MCP revision 자리(`protocolVersion`)에 MUST NOT 넣는다. 주어진 roomId가 문법에 맞지 않으면 `/mcp/catalog`로
가지 않고 `ROOM_ID_INVALID`로 실패한다(R-PEER-054). client는 이 규칙을 MUST 따른다.\
근거: `src/client/room-lifecycle.ts:28`, `src/client/room-lifecycle.ts:37`, `src/client/room-lifecycle.ts:44`, `src/client/room-lifecycle.ts:62`, `src/client/room-lifecycle.ts:64`, `src/client/room-lifecycle.ts:65`, `src/client/room-lifecycle.ts:80`, `src/client/room-lifecycle.ts:88`, `src/client/types.ts:217`; 테스트: `test/client-session.test.ts` › `initializes and lists tools for ${target.label}`; `test/client-session.test.ts` › `falls back to version 1 for a non-scalar catalogVersion (${JSON.stringify(catalogVersion)})`; `test/client-session.test.ts` › `reports the relay protocol as protocol, not as the MCP revision`

**R-PEER-050** `rotatePeerRoom`은 roomId(`ROOM_ID_REQUIRED`, `ROOM_ID_INVALID`)와 providerToken(`PROVIDER_TOKEN_REQUIRED`)을 로컬에서 검사한 뒤
`POST <serverUrl>/p/<enc roomId>/rotate`를 `authorization: Bearer <providerToken>`, body `{roomId, roomEpoch?(safe integer만),
alias?(비어 있지 않을 때), requestedAt}`으로 MUST 보낸다. `ttlMs` option은 없다. non-2xx는 code `body.error || 'HTTP_<status>'`, object가
아닌 2xx body는 `INVALID_ROTATE_RESPONSE`다.\
근거: `src/client/room-lifecycle.ts:251`, `src/client/room-lifecycle.ts:261`, `src/client/room-lifecycle.ts:263`, `src/client/room-lifecycle.ts:266`, `src/client/room-lifecycle.ts:281`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`

**R-PEER-051** `probePeerHealth`는 `GET <base>/health`(accept JSON, timeout `max(250, timeoutMs ?? 5000)` ms)를 보내 2xx이고
`body.status === 'healthy'`일 때만 healthy(그 status 포함)로 보고, 그 밖의 응답은 그 status를 담은 `unhealthy`다. healthy 결과는 body의
수인 `activeRooms`·`retainedRooms`·`uptimeSec`를 그대로 싣는다(R-ROOM-006). 요청이 던지는 catch
경로(네트워크 오류, timeout, 요청 중 abort)는 `unreachable`이고 `status: null`이다. 요청을 보내기 전의 실패에는 `status` member가 없다:
빈 URL은 `unhealthy`, `fetch`가 없거나 signal이 이미 abort됐으면 `unreachable`이다. `fetchPeerServerConfig`는 빈 URL과 `fetch` 없음을
거절하고, 이미 abort된 signal은 요청 없이 그 reason(기본 `AbortError`)으로 거절한다. `GET <base>/config`(같은 timeout)를 보내 non-2xx면
문자열 `body.error` 또는 `HTTP <status>`로 실패하고, 선언 member의 type이 틀리면(문자열 `type`·`serverUrl`·`protocol`·template·
`roomEndpoint`, 유한한 `version`, `defaults.approvalRequired` boolean, `defaults.roomTtlMs`·`defaults.maxRoomTtlMs` 유한한 수)
거절한다. config tier는 이 규칙을
MUST 따른다.\
근거: `src/config/probe.ts:60`, `src/config/probe.ts:63`, `src/config/probe.ts:73`, `src/config/probe.ts:80`, `src/config/probe.ts:85`, `src/config/probe.ts:108`, `src/config/probe.ts:120`, `src/config/probe.ts:129`, `src/config/probe.ts:134`, `src/config/probe.ts:135`, `src/config/probe.ts:147`, `src/config/probe.ts:150`, `src/config/probe.ts:169`, `src/config/probe.ts:174`, `src/config/probe.ts:177`, `src/config/probe.ts:178`, `src/config/probe.ts:184`, `src/config/probe.ts:202`, `src/config/probe.ts:18`, `src/config/probe.ts:43`; 테스트: `test/client-config.test.ts` › `rejects a config document whose declared members have the wrong type`; `test/client-config.test.ts` › `rejects a config document whose defaults.maxRoomTtlMs is not a finite number`; `test/client-config.test.ts` › `rejects an already-aborted signal without sending a request`; `test/client-config.test.ts` › `reports the relay's error text for a failed response`; `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`; `test/client-config.test.ts` › `reports the relay's live rooms and the expired or rotated ones it still retains apart`

**R-PEER-052** `parseInvitationUrl`은 `<origin>/p/<roomId>` 또는 `<origin>/p/<roomId>/mcp`(끝 `/` 허용)에 `#invite=<t>`(대안
`?invite=<t>`)를 받아 `{serverUrl:origin, roomId(decode), descriptorUrl:'<serverUrl>/p/<encodeURIComponent(roomId)>/mcp',
inviteToken(trim), mcpEndpoint:(descriptorUrl과 같은 값)}` 또는 null을 돌려준다. 두 형태 모두 relay가 보고하는 `descriptorUrl`
(R-ROOM-013)과 같은 room descriptor route를 준다. `buildInvitationUrl`은 `<hash와 끝 /를 뺀 descriptorUrl, 또는 <serverUrl(기본
http://127.0.0.1:8787)>/p/<enc roomId>/mcp>#invite=<encodeURIComponent(token)>`을 MUST 만든다. `createPeerConfigProfile`은
`protocol: WEBMCP_PROTOCOL`(`webmcp-peer/1`)과 `defaults:{approvalRequired:true, roomTtlMs:7200000, …}`인 profile을 만들고, 비밀
key(`publishKey`, `providerToken`, `reconnectToken`, `leaseToken`, `clientToken`, `inviteToken`)는 `defaults`에서만 지운다.
`roomTtlMs` 7200000은 room이 요청하는 기본 TTL이고 relay가 `maxRoomTtlMs`로 clamp하기 전 값이다. client 쪽 library는 relay의
`maxRoomTtlMs`를 모르므로 직접 clamp하지 않는다. relay가 실제로 쓰는 값을 담으려는 호출자는 `GET /config`의 `defaults`
(R-ROOM-007, `fetchPeerServerConfig`)를 `defaults`로 넘긴다. profile의 `invitationUrl`은 trim한 `input.invitationUrl` 그대로이거나,
그것이 없으면 roomId와 inviteToken(input 또는 초대 URL에서 읽은 값)으로 `buildInvitationUrl({serverUrl, roomId, inviteToken})`이 만든 것
(`/p/<roomId>/mcp#invite=<encodeURIComponent(token)>`)이다. 그래서 초대 URL에 담긴 inviteToken은 가려지지 않고 profile에 들어간다.\
근거: `src/config/invitation.ts:79`, `src/config/invitation.ts:84`, `src/config/invitation.ts:90`, `src/config/invitation.ts:94`, `src/config/invitation.ts:96`, `src/config/invitation.ts:108`, `src/config/invitation.ts:121`, `src/config/invitation.ts:122`, `src/config/profile.ts:21`, `src/config/profile.ts:23`, `src/config/profile.ts:27`, `src/config/profile.ts:39`, `src/config/profile.ts:58`, `src/config/profile.ts:60`, `src/config/profile.ts:61`, `src/config/profile.ts:70`, `src/config/profile.ts:73`, `src/config/profile.ts:77`; 테스트: `test/webmcp-peer.test.ts` › `normalizes peer config profiles and invitation URLs`; `test/client-config.test.ts` › `name the relay's room descriptor route as descriptorUrl, from either invitation form`

**R-PEER-054** agent client는 room id를 protocol의 문법(`WEBMCP_ROOM_ID_PATTERN`, R-HTTP-002)으로 MUST 검사한다. `parseRoomId(value)`는
room id, `/p/<id>`, `/p/<id>/mcp`, 또는 경로가 `/p/<id>`나 `/p/<id>/mcp`(끝 `/` 허용)로 끝나는 URL에서 id를 꺼내 문법에 맞을 때만
돌려주고, 비었거나 맞지 않으면 `undefined`다(percent-encoding은 풀지 않으므로 `a%20b`도 맞지 않는다). caller가 준 room 값 —
`PeerMcpSession`의 roomId·descriptorUrl·환경 변수(R-PEER-030), `discoverPeerCatalog`·`joinPeerRoom`의 roomId와 초대 URL의 room,
`getPeerSessionStatus`·`waitForPeerApproval`·`rotatePeerRoom`의 roomId — 가 비어 있지 않은데 문법에 맞는 id를 담지 않으면 요청을
보내기 전에 `ROOM_ID_INVALID`(`PeerMcpError`)로 실패한다. 값은 초대 token을 담은 URL일 수 있으므로 오류 message에 넣지 않는다.
session이 자기 `mcpEndpoint`에서 room을 읽을 때(revoke, `roomEpoch` 채택)는 `parseRoomId`가 `undefined`를 돌려줄 뿐 실패하지 않는다.\
근거: `src/config/types.ts:25`, `src/client/transport.ts:40`, `src/client/transport.ts:50`, `src/client/transport.ts:58`, `src/client/transport.ts:61`, `src/client/transport.ts:63`, `src/client/session.ts:390`, `src/client/room-lifecycle.ts:37`, `src/client/room-lifecycle.ts:106`, `src/client/room-lifecycle.ts:184`, `src/client/room-lifecycle.ts:259`; 테스트: `test/client-session.test.ts` › `are taken only in the protocol's grammar, from an id, a room path or a room URL`; `test/client-session.test.ts` › `refuses an id outside the grammar with ROOM_ID_INVALID before any request`

**R-PEER-055** `PeerMcpService`는 session을 호출자가 정하는 등록 key로 MUST 관리하고, key를 relay에 보내지 않는다.
`createSession`·`connect`는 `PeerMcpServiceSessionOptions`(session option + `key`)를 받아 `key`, 없으면 session의 `sessionId`, 그것도
없으면 새 `peer-session-<uuid>`로 등록하고 그 session을 활성(`activeKey`)으로 한다. 같은 key의 session은 바뀐다. service의 option은
만드는 session마다 그대로 넘기므로 넘겨받은 `transport`는 모든 session이 같은 객체를 쓴다(그 `onMessage`의 전달은 R-PEER-031). `key`는 session option에
넘기지 않으며 service는 session의 `sessionId`를 덮어쓰지 않는다. 그래서 `sessionId`에는 caller가 준 relay session id(`joinPeerRoom`의
`sessionId`)나 relay `ready` frame이 준 id만 있고, 임의 key로 등록한 session의 `revoke`도 R-PEER-046대로 relay가 묶은 id가 없으면
bearer 전용 `/session/revoke`를 쓴다. `getSession`, `disconnect`, `revoke`, `refreshCatalog`는 key(기본 `activeKey`)를,
`callTool(name, args, {key, ...})`는 option `key`를 받고 나머지 option을 session에 넘긴다. 등록이 없으면 `revoke`·`refreshCatalog`·
`callTool`은 `SESSION_NOT_FOUND`, `disconnect`는 `undefined`다. `disconnect`·`revoke`가 활성 session을 지우면 남은 첫 session이 활성이
된다.\
근거: `src/client/types.ts:171`, `src/client/types.ts:177`, `src/client/service.ts:41`, `src/client/service.ts:42`, `src/client/service.ts:43`, `src/client/service.ts:44`, `src/client/service.ts:45`, `src/client/service.ts:46`, `src/client/service.ts:74`, `src/client/service.ts:102`, `src/client/service.ts:109`; 테스트: `test/client-session.test.ts` › `revokes a session a PeerMcpService registered under a key of its own`; `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

### 9.3 일반 Streamable HTTP agent

**R-PEER-053** `PeerMcpSession`이 아닌 MCP client가 `POST /p/:id/mcp`를 쓸 때는 다음을 MUST 지킨다. 중계 method에는
`Authorization: Bearer <clientToken>`을 보낸다(relay는 scheme의 대소문자와 공백 수를 따지지 않는다, R-HTTP-018). clientToken은 join이 발급한
정적 bearer 자격이고 OAuth로 얻는 token이 아니므로, client는 MCP authorization(OAuth)을 쓰지 않고 401의 `WWW-Authenticate`로 discovery를
시작하지 않는다(relay는 그 metadata를 제공하지 않는다, R-HTTP-019). 공식 MCP SDK client라면 auth provider 없이 transport의 요청 header
(`requestInit.headers`)로 보낸다. 401은 token이 없거나 room이 발급하지 않았거나(−32003) ticket이 revoke됐다(−32001 `SESSION_INVALID`)는
뜻이며, 새 ticket은 invite로 join해야 얻는다. 요청 id는 문자열이나 유한한 수이고 null이 아니다
(R-MCP-009, R-MCP-043). 문자열 id의 JSON text는 1024 byte 이하다(넘으면 400 `REQUEST_ID_TOO_LARGE`, id null). batch 배열을 보내지
않는다. body는 엄격한 UTF-8 JSON이고 BOM을 붙이지 않으며(RFC 8259 §8.1. relay는 맨 앞 BOM 하나는 무시한다, R-MCP-009), 보낸 그대로와 `JSON.stringify`로 다시 직렬화한 것이 모두 261120 byte 이하다(넘으면
413 `REQUEST_TOO_LARGE`, R-MCP-008, R-MCP-010). `MCP-Protocol-Version`은 보내지 않거나 initialize-era 값 하나를 보낸다. SSE stream과
`Mcp-Session-Id`를 기대하지 않는다(GET은 descriptor 또는 405, DELETE는 405). 성패는 HTTP status가 아니라 JSON-RPC `error`로 판단한다:
relay가 전달하기 전에 거절한 요청은 4xx·5xx지만, 전달한 요청에 생긴 relay 오류(`MCP_REQUEST_TIMEOUT`, `PROVIDER_DISCONNECTED`,
`ROOM_ROTATED`, `ROOM_EXPIRED`, `SESSION_INVALID`)는 200 body의 JSON-RPC `error`로 오므로 그런 200을 실패로 다룬다(R-MCP-023).
relay가 받아들인 notification(id 없음)은 method와 무관하게 202와 빈 본문을 받는다. relay가 직접 처리하는 method의 notification은 room과
ticket 없이도 받아들여지고, 그 밖의 notification은 요청처럼 room·ticket(Bearer 자격)·provider 검사를 거치고 거절되면 요청과 같은 status다. id가 있는
`notifications/*`는 400 `INVALID_REQUEST`다(R-MCP-017, R-MCP-022, R-MCP-045). MCP lifecycle대로 `initialize` 뒤 `notifications/initialized`를 보내고 이후 요청에 협상된 `MCP-Protocol-Version`을 실을 수
있다(relay는 둘 다 받지만 요구하지 않는다). catalog 변경은 push되지 않는다. client는 `tools/call`의 `params._meta`에
`catalogVersion`·`catalogHash`를 SHOULD 넣는다. 넣어야 −32010 `CATALOG_CHANGED`로 drift를 fail-closed로 알 수 있고, 이를 받으면
`tools/list`를 다시 읽는다. 둘 다 넣지 않는 일반 MCP client에게 catalog 변경은 없어진 tool의 400 `TOOL_NOT_FOUND`나 새 catalog에 대한
조용한 호출로만 드러난다(R-MCP-020). 503 `PROVIDER_BUSY`(`data.retryable: true`)는 `Retry-After`(1초) 뒤에 다시 보낼 수 있다.\
근거: `src/server/peer-server.ts:2902`, `src/server/peer-server.ts:3242`, `src/server/peer-server.ts:3250`, `src/server/peer-server.ts:3255`, `src/server/peer-server.ts:3259`, `src/server/peer-server.ts:3266`, `src/server/peer-server.ts:3276`, `src/server/peer-server.ts:3283`, `src/server/peer-server.ts:3293`, `src/server/peer-server.ts:3166`, `src/server/peer-server.ts:3171`, `src/server/peer-server.ts:3333`, `src/server/peer-server.ts:3344`, `src/server/peer-server.ts:1275`, `src/server/peer-server.ts:1276`, `src/server/peer-server.ts:1280`, `src/server/peer-server.ts:3410`, `src/server/peer-server.ts:187`, `src/server/peer-server.ts:3305`, `src/server/peer-server.ts:3270`; 테스트: `test/mcp-http-interop.test.ts` › `serves the official MCP v2 client in %s negotiation mode`; `test/server-mcp-routing.test.ts` › `answers a notification of a method the relay answers itself 202 with an empty body, without checking the room, the ticket or the catalog`; `test/server-mcp-routing.test.ts` › `checks a notification of any other method as it checks a request, and answers it 202 once the provider takes it`; `test/server-error-model.test.ts` › `offers no OAuth discovery: its Bearer challenge names no resource metadata, and every metadata path an OAuth client tries is 404`

## 10. 결정 기록과 열린 문제

초안(2026-10-20)은 코드끼리, 또는 코드와 문서가 어긋나는 곳을 O-01~O-60으로 올렸다. 사용자는 모든 항목에 권고안을 채택하고,
패키지가 아직 배포되지 않은 0.1.0이므로 breaking wire 변경을 지금 내기로 했다. 10.1은 항목마다 결정, 권고와 다르게 구현한 곳의 이유,
그 결정이 고친 요건, 구현한 commit과 changeset(`.changeset/<이름>.md`)을 적는다. O-59와 O-60은 이 문서를 고친 문서 단계의 기록이고, O-61은
문서 단계 뒤의 review가 결정한 기록이다. O-62~O-69는 그 뒤 review가 10.2에 올린 열린 문제를 결정한 기록이다(2026-10-21). O-66은 사용자가
두 안 가운데 골랐고, 나머지는 기록한 대로 결함을 고쳤다. 10.2는 결정을 구현하며 드러났지만 권고 밖이라 이 버전에서 바꾸지 않은 열린 문제다. 심각도는 high, medium, low다. 위치는
`packages/webmcp-peer/` 기준이다(저장소 문서는 저장소 루트 기준).

### 10.1 결정 기록

**O-01 (결정 2026-10-20)** relay와 provider가 MCP revision 협상 함수 하나(`negotiateInitializeProtocolVersion`,
`src/provider/commit-receipt.ts`)를 함께 쓴다. provider는 모든 channel의 `initialize`에 요청한 initialize-era version, 아니면 `2025-11-25`로
답하고 `2026-07-28`로는 답하지 않는다. relay를 거친 `server/discover`도 같은 협상 값과 `supportedProtocolVersions:
MCP_INITIALIZE_PROTOCOL_VERSIONS`를 보고하고(DataChannel은 `2026-07-28`과 5개), relay 자신의 discover result에 `capabilities`(HTTP는
`listChanged:false`, WebSocket은 `true`)와 같은 `supportedProtocolVersions`를 넣었다. 그래서 WebSocket 답의 협상·version 목록·
capabilities는 relay가 catalog를 받아들이는지와 무관하다(답한 쪽의 `serverInfo`와 `instructions`·`_meta`는 다르다). 관련: R-MCP-016, R-MCP-019, R-MCP-036, R-MCP-039, R-PEER-015, 7.5 표. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-02 (결정 2026-10-20)** provider의 미승인 오류를 relay와 같은 −32053 `CLIENT_APPROVAL_REQUIRED`로 바꿨다. −32003은 client
token class로만 쓰며, 이 class에는 `CLIENT_TOKEN_REQUIRED`와 O-13이 더한 `CLIENT_TOKEN_INVALID`가 있다(O-12의 class 규칙). relay와
provider는 code를 함께 쓰는 내부 표 `PEER_ERROR_CODES`(`src/config/errors.ts`)에서 얻으므로 한 이름이 tier마다 다른 code를 갖지
않는다. 관련: R-PEER-012, R-MCP-014, R-ERR-001, R-ERR-005. 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-03 (결정 2026-10-20)** `id: null`은 두 transport 모두 무효한 요청이다. WebSocket도 ticket status와 무관하게 id null의 −32600
`INVALID_REQUEST`로 거절하고 전달하지 않으며(notification 분기는 id가 없을 때만이다), provider는 id가 null인 요청을 실행하지 않고
`Invalid Request`로 답한다(`rpcRequestId`가 null을 받지 않는다). relay는 맞출 요청이 없는 provider 답(id null 포함)을 broadcast하지 않고
버린다. 관련: R-MCP-001, R-MCP-002, R-MCP-029, R-MCP-030, R-MCP-041, R-MCP-043, R-MCP-045, R-PEER-012, R-SIG-004. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-04 (결정 2026-10-20)** rotate되지 않은 room의 rotate body가 다른 `roomId`·`roomEpoch`를 지목하면 409
`{error:'ROOM_BINDING_INVALID', code:-32002, roomId, roomEpoch}`다. `ROOM_ROTATED`는 실제로 rotate된 room의 410(O-09)에만 쓴다.
provider `refreshRoom`은 epoch를 모르면 `roomEpoch`를 보내지 않는다(이전에는 0을 보내 이 409를 받았다). 관련: R-ROOM-042,
R-PEER-026, R-ERR-001. 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-05 (결정 2026-10-20)** room 만료를 한 신호로 통일했다. 만료 처리(`expireRoom`)는 모든 ticket을 `expired`로 끝내고, client
socket에 새 frame `room.expired`(R-SIG-023)를 보내며, WebSocket pending 요청과 HTTP 진행 요청을 모두 −32056 `ROOM_EXPIRED`
`{roomId, roomEpoch}`로 끝낸다(`ticketClosedRpcError`). client는 `room.expired`를 `ROOM_EXPIRED`로 올린다. 보존 중인 만료 room의
join·reclaim·approval·두 revoke·rotate는 410 `{error:'ROOM_EXPIRED', code:-32056, roomId, roomEpoch}`(R-ROOM-070)이고, 지운 뒤에는
404 `ROOM_NOT_FOUND`다. 살아 있는 room의 reclaim lease 만료는 410 `ROOM_LEASE_EXPIRED`(code 없음)로 나눴다. 권고를 한 가지 넓혔다.
sweep 말고 만료를 먼저 발견한 자리(수명주기·MCP route의 room 검사, ticket 해석, upgrade, socket frame, register 평가)도 같은 처리를
한다(`expireRoomIfDue`, R-ROOM-067). 전에는 ticket 해석이 `roomState`만 `expired`로 바꿔 sweep의 처리를 막았고, 그 room의 진행
요청은 `ROOM_EXPIRED`를 받지 못했다. provider socket은 지금처럼 frame 없이 닫고, close code로 이유를 알리는 일은 O-23에 남긴다.
관련: R-ROOM-014, R-ROOM-019, R-ROOM-027, R-ROOM-036, R-ROOM-041, R-ROOM-047, R-ROOM-048, R-ROOM-050, R-ROOM-067, R-ROOM-070,
R-SIG-015, R-SIG-023, R-MCP-013, R-PEER-038, R-ERR-005. 구현: commit `ff6b5c19`, changeset `webmcp-peer-protocol-c3-expiry-rotation`.

**O-06 (결정 2026-10-20)** reconnect lease는 provider socket이 붙어 있는 동안 만료되지 않고, room에 provider socket이 없게 될 때
(생성, reclaim, socket close, relay의 분리)부터 15분(`RECONNECT_GRACE_MS`) 또는 room 만료까지 남는다(`startReconnectGrace`). 그래서 room
수명 내내 붙어 있던 host도 새로고침 뒤 reclaim할 수 있고, 새어 나간 lease를 쓸 수 있는 창은 여전히 provider가 떠난 뒤 15분이다. room
descriptor는 `reconnectTokenExpiresAt`으로 room `expiresAt`을, 새 필드 `reconnectGraceMs`(900000)로 유예를 알린다. provider는 이미
`reconnectTokenExpiresAt`까지 lease를 저장하므로 코드를 바꾸지 않았다. 관련: R-ROOM-013, R-ROOM-014, R-ROOM-017, R-ROOM-018,
R-ROOM-052, R-ROOM-054, R-LIM-027, R-PEER-024. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-07 (결정 2026-10-20)** 승인 요청 수명을 `mcpRequestTimeoutMs`에서 떼어 새 option `approvalTimeoutMs`(기본 300000 ms, 최소 1000,
`Infinity`는 room 수명, room `expiresAt`이 상한)로 정했다. 만료되면 agent의 client socket과 함께 provider socket도 `approval.expired`를
받아 host가 요청을 내린다. 만료 timer는 만기 전에 돌면(Node timer의 이른 발화, 2147483647 ms 상한) 남은 시간으로 다시 걸리므로 요청이
만료되지 않고 남는 경우가 없어졌고, room이 먼저 만료됐으면 room 만료를 처리한다. 만료 뒤에는 invite가 소비된 채라 rotate가 필요하다는
점을 요건에 적었다. README의 설명은 문서 단계(O-59)에서 이 문서를 링크하는 요약으로 고쳤다. 관련: R-ROOM-024, R-ROOM-026, R-LIM-025, R-LIM-043(신규), R-SIG-012,
R-MCP-044, R-PEER-021. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-08 (결정 2026-10-20)** ticket 종료가 보내는 client용 `room.rotated`에 `rotatedTo`와 payload `replacementRoomId`·
`replacementRoomEpoch`를 넣었다. 그 socket의 pending 요청은 HTTP 진행 요청과 같은 −32057 `ROOM_ROTATED` `{replacementRoomId,
roomId, roomEpoch}`로 끝난다(`ticketClosedRpcError`. `failPendingForSocket`이 오류의 data도 보낸다). 어떤 socket에도 닿지 않던 rotate
route의 client socket loop는 지웠다. 관련: R-ROOM-044, R-ROOM-047, R-SIG-016. 구현: commit `ff6b5c19`, changeset `webmcp-peer-protocol-c3-expiry-rotation`.

**O-09 (결정 2026-10-20)** approval, 두 revoke route, rotate도 room을 찾은 직후, 만료 검사보다 먼저 `rotatedTo`를 보고
(`checkLifecycleRoom`) 410 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch, replacementRoomId}`로 답한다. 모든 수명주기 route가
같은 body(`sendRoomRotated`)를 보내고, 동시에 온 두 번째 rotate도 대체 room을 받는다. 관련: R-ROOM-027, R-ROOM-036, R-ROOM-041,
R-ROOM-046. 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-10 (결정 2026-10-20)** body의 `roomId`·`roomEpoch`를 reclaim, approval, 두 revoke route, rotate에서 모두 선택으로 하고, 있으면
엄격히 같아야 하는 한 규칙(`bodyNamesRoom`)으로 정했다. 검사는 route의 자격 검사 뒤라, token보다 먼저 보던 경로형 revoke와 lease보다
먼저 보던 reclaim의 순서를 고쳤다. 불일치는 모두 409이고 이름은 route별 기존 것(`ROOM_LEASE_BINDING_INVALID`, `INVALID_APPROVAL`,
`SESSION_BINDING_INVALID`, O-04의 `ROOM_BINDING_INVALID`)이다. 빈 body의 provider 전체 revoke는 명시적 요청으로 규범화했고, binding을
보낸 전체 revoke는 binding이 맞아야 한다. provider의 `disconnect(true)` revoke는 모르는 epoch를 0으로 짐작하지 않고 뺀다. join은
binding을 보지 않고, provider socket의 `approval.decision` frame은 route가 아니어서 `payload.roomId`·epoch를 계속 요구한다. 관련:
R-ROOM-071(신규), R-ROOM-015, R-ROOM-028, R-ROOM-037, R-ROOM-038, R-ROOM-040, R-ROOM-042, R-SIG-009, R-PEER-026. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-11 (결정 2026-10-20)** canonical 이름 하나에 code 하나를 규범으로 했다(R-ERR-005). 수명주기 body는 이름이 JSON-RPC code를
가지면 그 code를 싣는다(`ROOM_NOT_FOUND` −32004, `ROOM_EXPIRED` −32056, `CLIENT_TOKEN_REQUIRED`·`CLIENT_TOKEN_INVALID` −32003,
`CATALOG_UNAVAILABLE` −32090, 권고 밖이지만 같은 원칙으로 `BODY_CONSUMED` −32603). client revoke가 다른 session을 지목하면 403
`SESSION_NOT_OWNED`이고 `SESSION_BINDING_INVALID`는 409 −32002 하나다. 두 transport가 한 함수(`clientTicketError`,
`clientTicketErrorData`)를 써서 승인되지 않은 ticket의 오류 data는 `{roomId, sessionId, approvalRequestId, approvalRequired}`(없는 값은
`null`)이고, room-rotated ticket은 HTTP에서도 `SESSION_INVALID`다. provider의 `RESULT_TOO_LARGE`는 `{limitBytes}`,
`CATALOG_UNAVAILABLE`은 `{catalogSource:'provider', reason}`을 싣는다. provider frame의 −32602와 agent listing 답의 −32603은 수신자
family가 달라 그대로 둔다. 관련: R-ERR-002, R-ERR-005, R-HTTP-008, R-ROOM-014, R-ROOM-040, R-ROOM-063, R-ROOM-064, R-MCP-014,
R-MCP-029, R-MCP-040, R-PEER-011, R-PEER-014. 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-12 (결정 2026-10-20)** JSON-RPC `code`는 오류의 class이고 식별자는 canonical 이름(`message`, 없으면 `data.code`)이라고
R-ERR-001에 규범으로 적었다. JSON-RPC 표준 code(−32700, −32600, −32602, −32603)와 패키지 class(−32000, −32001, −32002, −32003,
−32008, −32056)가 어떤 이름에 쓰이는지 표로 고정했고, 재시도 가능 여부는 `data.retryable`로만 판단한다. wire와 코드는 바꾸지
않았다. 관련: R-ERR-001, R-ERR-005, R-PEER-036. 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-13 (결정 2026-10-20)** 자격 오류를 한 규칙으로 정했다(R-HTTP-019, 신규). `Authorization` 자격은 없으면 401 `<X>_REQUIRED`,
틀리면 401 `<X>_INVALID`(`PROVIDER_TOKEN_INVALID`, `CLIENT_TOKEN_INVALID` 신설)이고 relay의 모든 401에 `WWW-Authenticate: Bearer`
(틀린 자격은 `error="invalid_token"`)가 붙는다. body 자격은 없으면 400(`INVITE_TOKEN_REQUIRED`, 신설 `ROOM_LEASE_REQUIRED`), 틀리면
403(`INVITE_TOKEN_INVALID`, `ROOM_LEASE_INVALID`)이다. join은 invite를 상수 시간 비교로 확인한 뒤에만 409 `INVITE_TOKEN_CONSUMED`를
알린다. 권고를 넓혀 session status도 room의 client token이 다른 session을 물으면 revoke처럼 403 `SESSION_NOT_OWNED`다. provider의
reclaim은 lease를 400·403·404·410에 지운다. 관련: R-HTTP-019, R-ROOM-009, R-ROOM-015, R-ROOM-020, R-ROOM-027, R-ROOM-033,
R-ROOM-040, R-ROOM-041, R-MCP-014, R-PEER-024. 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-14 (결정 2026-10-20)** 두 식별자를 유지한다. subprotocol은 RFC 6455 §4.1의 token이라 `/`를 쓸 수 없으므로
`webmcp-peer.v1`(`WEBMCP_SUBPROTOCOL`)은 subprotocol과 descriptor·`/mcp/catalog`의 `protocol`에, `webmcp-peer/1`
(`WEBMCP_PROTOCOL`, 새 export)은 frame·`/config`·profile의 `protocol`에 쓴다. relay, codec, provider, agent client는 문자열 대신 두
상수를 쓰고, 브라우저 module인 라이브 데모는 사본을 두되 테스트가 값을 맞춘다. `discoverPeerCatalog`는 `/mcp/catalog`의 `protocol`을
새 `protocol` 필드로 돌려주고 `protocolVersion`에는 MCP revision(`PROTOCOL_VERSION`)을 둔다. 관련: 1.5, R-WS-010, R-ROOM-007,
R-SIG-002, R-PEER-003, R-PEER-030, R-PEER-049, R-PEER-052. 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-15 (결정 2026-10-20)** `Authorization` 해석을 helper 하나(`bearerCredential`)로 모았다. 첫 값만 쓰고, scheme
`Bearer`는 대소문자를 무시하며 뒤에 공백 하나 이상을 받는다(RFC 9110 §11.1). publish key, approval, session status, revoke, rotate,
MCP POST가 모두 이 규칙을 쓰고, `X-Publish-Key`는 publish key에서 Bearer 자격이 없을 때만 읽는다. 공개 `bearerToken(req)`는 더 이상
`X-Publish-Key`를 돌려주지 않는다. clientToken은 providerToken처럼 비밀 비교 규칙을 따른다. relay는 `RoomEntry.clientTickets`
(이전 `clientTokens`)를 token의 SHA-256 hex로 key하고 그 hash로 ticket을 찾으며, token 자체는 보관하지 않는다
(`PendingApprovalRequest.clientTokenHash`). 관련: R-HTTP-018(신규), R-WS-007, R-ROOM-009, R-ROOM-027, R-ROOM-033, R-ROOM-038,
R-ROOM-040, R-ROOM-041, R-ROOM-047, R-MCP-014, R-PEER-053. 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-16 (결정 2026-10-20)** room id 문법을 `^[A-Za-z0-9_-]{1,128}$` 하나로 정했다(`WEBMCP_ROOM_ID_PATTERN`, 새 export).
수명주기 route, MCP route, WebSocket upgrade 경로, provider descriptor schema, client `parseRoomId`가 같은 상수를 쓴다. 문법에 맞지만
없는 id에 수명주기 route는 404 `ROOM_NOT_FOUND`, 문법 밖의 id(129자 이상 포함)는 모든 room route에서 404 `NOT_FOUND`다. client는
caller가 준 잘못된 room id를 요청 전에 `ROOM_ID_INVALID`로 거절한다. provider는 serverUrl을 `connect()`와 `refreshRoom` 모두
`normalizePeerConfigUrl`(scheme 대소문자 무시)로 정규화하고, roomId를 `encodeURIComponent`하며 socket URL을 `/^http/i`로 만들어
client의 `websocketUrl`과 같게 한다. 관련: R-HTTP-002, R-WS-001, R-PEER-001, R-PEER-002, R-PEER-003, R-PEER-026, R-PEER-030,
R-PEER-054(신규). 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-17 (결정 2026-10-20)** 기존 시각 필드의 형식은 바꾸지 않고, HTTP 응답과 frame의 형식을 표로 고정했으며 새 시각 필드는 epoch
ms로만 만든다는 규칙을 두었다. `expiresAt`의 뜻이 수신자마다 다른 곳에는 `approvalExpiresAt`(승인 요청 만료)과 `ticketExpiresAt`(ticket
만료)을 더했다: HTTP approval 응답, provider용 결정 echo, client용 `approval.approved`. `approval.pending`·`approval.expired`에 `protocol`·
`messageId`·`sentAt`을 채웠다. `messageId`는 불투명한 고유 문자열로 규정했고, relay가 message마다 새로 만든다(`messageId(type)`.
reattach마다 같은 값을 되풀이하던 `approval.restored`도 이제 매번 새 값이다). 관련: R-ROOM-072(신규), R-SIG-025(신규), R-ROOM-031,
R-SIG-002, R-SIG-008, R-SIG-010, R-SIG-012, R-SIG-013. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-18 (결정 2026-10-20)** relay는 provider socket에서 오지 않은 ticket 상태 변화도 provider socket에 알린다: HTTP 결정에는
WebSocket 결정과 같은 echo를 한 번(`sendDecisionEcho`), 승인 만료에는 `approval.expired`, HTTP로 한 모든 revoke(provider 단일·전체,
client 자기 revoke)에는 `session.revoked`를 보낸다. provider는 relay의 `approval.approved`를 다른 경로의 승인으로도 받아들이고
(`approval.restored`와 같은 검사), 결정을 보낸 뒤 그 결정이 echo로 정리되기 전에 같은 requestId의 `INVALID_APPROVAL`을 받으면 결정을
되돌려 `pending`으로 두고 session error `INVALID_APPROVAL`을 올린다. 관련: R-SIG-024(신규), R-ROOM-026, R-ROOM-029, R-ROOM-039,
R-ROOM-040, R-ROOM-047, R-SIG-009, R-SIG-010, R-SIG-011, R-SIG-015, R-PEER-018, R-PEER-019, R-PEER-020, R-PEER-021. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-19 (결정 2026-10-20)** pending 항목에 그 요청을 인증한 ticket(`PendingMcpRequest.ticket`)을 기록하고, ticket 종료
(`closeClientTicket`)가 그 ticket의 HTTP 진행 요청도 WebSocket 요청과 같은 오류(revoke −32001 `SESSION_INVALID`, 거절 −32054, rotate
−32057과 data, room 만료 −32056)로 끝내게 했다. 그래서 단일 revoke와 전체 revoke가 진행 요청에 같은 결과를 낸다. 이미 provider에 간
요청은 실행될 수 있고 relay는 늦게 온 답을 버릴 뿐이라고 적었다. 관련: R-ROOM-047, R-ROOM-048, R-MCP-005, R-MCP-023. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-20 (결정 2026-10-20)** relay가 provider→agent 방향에도 allow-list를 둔다. provider frame 중 JSON-RPC notification·요청을
담은 `mcp`는 approved ticket의 socket에만 broadcast하고, `answer`·`release`는 relay가 offer를 전달할 때 기록한 requestId→socket 경로로
그 offer를 보낸 socket에만 outbox로 보낸다. relay 전용 type(`ready`, `error`, `pong`, `session.*`, `room.*`, `approval.*`, `offer.refused`)과
`ice`, 모르는 type, JSON-RPC message가 없는 `mcp`는 버린다. 경로가 release까지 이어지도록 provider의 `grant`·`release`가 승인 요청의
requestId 대신 답한 offer의 requestId를 쓰게 고쳤다(권고에 없던 부분이다). 관련: R-SIG-004, R-SIG-019, R-SIG-021, R-SIG-026, R-WS-032,
R-MCP-041, R-PEER-022, R-PEER-023, R-PEER-038. 구현: commit `5049527d`, changeset `webmcp-peer-protocol-c6-signaling`.

**O-21 (결정 2026-10-20)** upgrade 거절을 모두 HTTP 응답으로 바꿨다. relay는 hook 다음에 opening handshake(GET, HTTP/1.1 이상,
`Upgrade: websocket`, `Connection: upgrade`, 16 byte base64 key, version 13)를 subprotocol·경로·room·ticket 검사보다 먼저 보고, 거절마다
`Content-Length`와 `Connection: close`가 있는 수명주기 JSON 응답을 쓴 뒤 닫는다. handshake 위반은 400 `BAD_UPGRADE`, version 불일치는 426
`UNSUPPORTED_WEBSOCKET_VERSION`과 `Sec-WebSocket-Version: 13`, 경로 없음은 404 `NOT_FOUND`, room은 수명주기 route와 같은 404 `ROOM_NOT_FOUND`·
410 `ROOM_ROTATED`·410 `ROOM_EXPIRED`, provider ticket은 401 `PROVIDER_TOKEN_REQUIRED`·`PROVIDER_TOKEN_INVALID`(Bearer challenge)다. 권고와 다른
점: 끝난 client ticket을 일률적으로 403으로 거절하지 않고, 같은 token의 MCP POST가 받는 status와 이름(`clientTicketError`)으로 답한다.
revoke된 ticket은 401 `SESSION_INVALID`, 거절된 ticket은 403 `CLIENT_APPROVAL_DENIED`, 만료된 ticket은 410 `SESSION_EXPIRED`다. O-12·O-13이
두 transport에 둔 오류 모델을 upgrade에도 그대로 쓰기 위해서다. codec `upgradeWebSocket`도 handshake가 아닌 요청에 던지지 않고 같은
400·426을 쓴 뒤 socket을 멈춘다. Origin 거절(O-25의 몫)과 처리 중 예외의 파기는 바꾸지 않았다. 관련: R-WS-001, R-WS-002, R-WS-004,
R-WS-006, R-WS-007, R-WS-008, R-WS-011, R-WS-038(신규), R-HTTP-019, R-ROOM-046, R-ROOM-070, R-ERR-005. 구현: commit `4df54672`, changeset `webmcp-peer-protocol-c7-websocket`.

**O-22 (결정 2026-10-20)** relay는 `webmcp-peer.v1`을 제시하지 않은 upgrade를 400 `SUBPROTOCOL_REQUIRED`로 거절한다(handshake 검사 다음,
경로·room·ticket 검사보다 먼저). codec은 목록에 `webmcp-peer.v1`이 있을 때만 그것을 고르고, 없으면 `Sec-WebSocket-Protocol`을 넣지 않는다.
`ticket.*`, 빈 값, 모르는 값은 어떤 응답에도 실리지 않으므로 101이 비밀을 되돌리던 예외(R-ROOM-004)가 없어졌다. 관련: R-WS-005, R-WS-009,
R-WS-010, R-ROOM-004. 구현: commit `4df54672`, changeset `webmcp-peer-protocol-c7-websocket`.

**O-23 (결정 2026-10-20)** close code의 뜻을 고정하고 `WEBMCP_CLOSE_CODES`(새 export)로 공유한다. 1000은 이유 frame 뒤의 최종 close,
1001은 relay `close()`와 liveness timeout(O-42), 1013은 다시 시도해도 되는 stall이다. frame 없이 닫는 이유는 4001 `SUPERSEDED`(provider 교체·
분리, ticket당 socket 상한, room에 붙지 않은 provider socket의 frame)와 4002 `ROOM_EXPIRED`(room 만료의 provider socket, 만료된 ticket의
frame)로 싣는다. close frame 되돌림은 client 전용 1010에 1000으로 답한다. provider auto-reconnect는 1001, 1006(code를 알리지 않는 close 포함),
1013 뒤에만 다시 붙는다. 4002는 session error `ROOM_EXPIRED`의 session 만료이고, 4001은 `PEER_SESSION_SUPERSEDED`, 그 밖의 최종 code는
`SIGNALING_CLOSED`로 재접속 없이 멈춘다. `PeerMcpSession`은 `TRANSPORT_CLOSED`의 `details`에 `{code, reason}`을 담는다(`PeerMcpTransportCallbacks.onClose(close)`,
새 type `PeerMcpTransportClose`). session이 스스로 재접속하지 않는 규칙은 그대로다. 관련: R-WS-019, R-WS-028, R-WS-030, R-WS-037, R-ROOM-050,
R-ROOM-052, R-ROOM-055, R-ROOM-056, R-ROOM-057, R-ROOM-066, R-SIG-023, R-SIG-024, R-PEER-021, R-PEER-025, R-PEER-045, R-LIM-014. 구현: commit `4df54672`, changeset `webmcp-peer-protocol-c7-websocket`.

**O-24 (결정 2026-10-20)** Host를 강제하고 proxy header는 신뢰한 proxy에게서만 읽는다. `allowedHosts`를 어디서든 정했거나 relay가
loopback에 bind하면(기본 `127.0.0.1`) 허용 목록 밖 host의 HTTP 요청과 upgrade를 URL 해석·`OPTIONS`·Origin 검사·hook보다 먼저 403
`{error:'HOST_NOT_ALLOWED', host}`로 거절해 DNS rebinding을 막는다(`enforceAllowedHosts`). 새 option `trustProxy`(기본 `false`. 설정 파일
`trustProxy`, `PEER_SERVER_TRUST_PROXY`, `--trust-proxy`로도 정한다)가 신뢰하는 peer의 `X-Forwarded-*`만 읽는다. scheme은 `http`·`https`일
때만 쓰고, scheme과 host는 가장 가까운 proxy가 쓴 마지막 값이며, publish rate-limit 신원은 `X-Forwarded-For`의 신뢰 경계 밖 첫 주소다.
권고의 `true`는 relay의 peer 한 hop만 신뢰하는 것으로 정했다. 모든 hop을 믿으면 caller가 쓴 맨 왼쪽 주소가 신원이 되어 caller가 bucket을
고를 수 있다. 여러 hop의 proxy는 주소·CIDR 목록으로 지정한다. 권고를 넘어, 정한 `allowedHosts`가 O-25의 origin처럼 기본 host 목록을
대신한다(relay 자신의 `host`·`host:port`와 loopback 이름은 늘 맞는다). 그러지 않으면 목록을 정한 운영자도 `*.pages.dev` 같은 기본 host를
뺄 수 없다. README의 "Host header guards" 문구는 문서 단계(O-59)에서 고쳤다. 관련: R-HTTP-013, R-HTTP-020, R-HTTP-021, R-WS-003,
R-ROOM-010. 구현: commit `ba304513`, changeset `webmcp-peer-protocol-c8-http-security`.

**O-25 (결정 2026-10-20)** 정한 `allowedOrigins`(option, 설정 파일, `ALLOWED_ORIGINS`, CLI. 여럿이면 합집합)가 기본 정책을 통째로
대신한다. `isOriginAllowed`의 고정 허용(loopback origin, `framebook-storyboard.pages.dev`)을 없애고 `DEFAULT_ALLOWED_ORIGINS`(`localhost`,
`127.0.0.1`, `[::1]`, `*.framebook-storyboard.pages.dev`)로 옮겼으며, relay 자신의 `http://{host}:{port}`도 기본 정책에만 든다. 그래서
운영자는 "이 origin만"을 정할 수 있다. 그 기본 목록이 쓰는 `host[:port]` 규칙이 IPv6 대괄호(`[::1]:4500`)를 읽게 고쳤다. 거절은
preflight, 그 밖의 요청, upgrade 모두 403 `{error:'ORIGIN_NOT_ALLOWED', origin}`(JSON, `Content-Length`, `Vary: Origin`) 하나다
(`CORS_ORIGIN_DENIED`와 upgrade의 text 응답은 없어졌다). `Content-Length`는 그 거절만이 아니라 `sendJson`의 모든 응답에 붙인다. client
fixture의 `ORIGIN_DENIED`를 relay의 이름으로 고쳤고 실제 거절을 확인하는 테스트를 더했다. 관련: R-HTTP-004, R-HTTP-010, R-HTTP-011,
R-HTTP-012, R-WS-003, R-WS-038, 8.1 표. 구현: commit `ba304513`, changeset `webmcp-peer-protocol-c8-http-security`.

**O-26 (결정 2026-10-20)** publish key가 없어도 publish rate limit이 기본으로 켜진다(요청 주소당 60000 ms에 30, 끄려면 0을 정한다).
새 option `maxRooms`(기본 10000, 보존 중인 만료·rotate room 포함, `Infinity`는 무제한)에 이른 relay는 `POST /p`와 rotate를 503
`{error:'ROOM_CAPACITY_EXCEEDED', retryAfterMs}`와 `Retry-After`로 거절하고 아무것도 바꾸지 않는다. `retryAfterMs`는 가진 room 중 가장
먼저 지워질 room의 보존 기한(`expiresAt` + 24시간)까지 남은 시간이다. 상한은 body를 다 읽은 뒤, room을 만드는 동기 구간에서 보므로 동시
요청이 함께 넘지 않는다. README의 동시 room 상한·보존 기간 요약은 문서 단계(O-59)에서 더했다. 관련: R-LIM-028, R-LIM-031, R-LIM-047,
R-ROOM-008, R-ROOM-010, R-ROOM-042, R-ROOM-069. 구현: commit `ba304513`, changeset `webmcp-peer-protocol-c8-http-security`.

**O-27 (결정 2026-10-20)** CORS 응답(304 포함)이 `Access-Control-Expose-Headers: Retry-After, ETag, X-MCP-Catalog-Version,
X-MCP-Catalog-Hash, X-RateLimit-Limit, X-RateLimit-Remaining`을 가지고, preflight의 `Access-Control-Allow-Methods`는 `GET, POST, DELETE,
OPTIONS`다. O-46의 권고(`GET, POST, OPTIONS`)와 갈린 `DELETE`는 O-27대로 넣었다. `DELETE /p/:id/mcp`는 있는 route이고, browser MCP client의
session 종료가 CORS 실패 대신 MCP client가 견디는 405를 받아야 한다. Origin 없는 `OPTIONS`에는 `Access-Control-Allow-Origin`이 없다.
권고의 "Origin에 따라 달라지는 모든 응답"을 relay의 모든 응답으로 읽어 기본 `Vary: Origin`을 모든 응답에 둔다. Origin 하나가 응답을
거절로 바꾸거나 CORS header를 더하기 때문이다. 관련: R-HTTP-004, R-HTTP-010, R-HTTP-011, R-HTTP-014. 구현: commit `ba304513`, changeset `webmcp-peer-protocol-c8-http-security`.

**O-28 (결정 2026-10-20)** 현재 동작을 규범화했다. relay가 전달하기 전에 거절한 요청은 오류 표의 4xx·5xx로, 전달한 요청의 결과는
provider 답이든 진행 중에 생긴 relay 오류(`MCP_REQUEST_TIMEOUT`, `PROVIDER_DISCONNECTED`, `ROOM_ROTATED`, `ROOM_EXPIRED`,
`SESSION_INVALID`)든 200과 JSON-RPC body로 답한다. agent는 HTTP status가 아니라 JSON-RPC `error`로 판단한다. 관련: R-MCP-023,
R-PEER-053. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-29 (결정 2026-10-20)** HTTP는 먼저 id 유무로 나눈다. relay가 받아들인 id 없는 message는 method와 무관하게 202와 빈 본문이다.
relay가 직접 처리하는 method(`ping`, `initialize`, `tools/list`, `server/discover`, `notifications/initialized`)의 notification은 room·ticket을
검사하지 않고 받아들여 아무것도 하지 않는다. 전달할 notification은 지금처럼 요청과 같은 room·ticket·provider 검사를 거치고, 거절되거나
provider가 받지 못하면 4xx·5xx와 id null이다. id가 있는 `notifications/*`는 그 id의 400 −32600
`INVALID_REQUEST`이고, 두 transport의 규칙을 하나로 두려고 WebSocket에도 같은 거절을 적용했다(권고는 HTTP만 말했다). WebSocket이 전달하지
못한 notification을 답 없이 버리는 것은 규범화했다. 관련: R-MCP-007, R-MCP-017, R-MCP-022, R-MCP-030, R-MCP-045, R-PEER-053. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-30 (결정 2026-10-20)** WebSocket에서도 relay가 `ping`에 ticket status와 무관하게 `result:{}`로 답하고 전달하지 않는다.
approved가 아닌 ticket의 `initialize`·`tools/list`·`server/discover`에는 HTTP와 같은 relay 응답(공개 discovery, `listChanged:true`, catalog가
없으면 `CATALOG_UNAVAILABLE`)으로 답한다(`answerAgentMetadata`). approved ticket의 `initialize`와 listing은 provider에 전달해 R-CAT-014의
catalog 갱신 경로를 유지한다. 관련: R-MCP-012, R-MCP-026, R-MCP-029, R-MCP-036, R-CAT-014, R-ROOM-065, R-SIG-013. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-31 (결정 2026-10-20)** catalog stamp의 정본 자리는 `result._meta`다. relay는 WebSocket listing 답(전달하는 provider 답과
relay 자신의 답 모두)에 agent가 `_meta`를 보냈는지와 무관하게 `result._meta.catalogVersion`·`catalogHash`를 넣고, provider가 보낸
`result._meta`의 다른 member는 둔다. agent가 `_meta`를 보냈을 때의 최상위 stamp는 호환용으로 한 minor 동안 남기고 deprecated로 적었다.
relay 자신의 WebSocket listing은 HTTP와 같은 listing metadata를 가진다. 늘어난 byte를 넣어도 announcement 여유 2 KiB 안에 든다(가장 긴 id로
최대 약 1.6 KiB, `PEER_RELAY_MAX_ANNOUNCEMENT_BYTES` 주석과 테스트). 관련: R-MCP-018, R-MCP-038, R-MCP-039, R-PEER-040, R-LIM-017. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-32 (결정 2026-10-20)** catalog 계약을 공유 module `src/config/catalog.ts`로 옮겼다. `PEER_CATALOG_MAX_TOOLS`(128),
`PEER_CATALOG_MAX_TOOL_NAME_LENGTH`(256, 새 export)와 이름 검사(비어 있지 않음, 자기 trim과 같음, 유일), `inputSchema` 검사를 relay
`normalizeToolCatalog`와 client `normalizeTools`가 함께 쓴다. client는 앞뒤 공백이 있는 이름을 trim해 받지 않고
`INVALID_TOOL_DESCRIPTOR`로 거절한다. `CATALOG_INVALID`의 `reason`은 상수에서 만든 'at most 128 tools, each with a unique, non-empty
name of at most 256 UTF-16 code units without leading or trailing whitespace and an inputSchema object of type "object"'이다. 관련:
R-CAT-001, R-CAT-009, R-LIM-018, R-LIM-019, R-PEER-040. 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-33 (결정 2026-10-20)** `PeerMcpSession.#replaceCatalog`가 relay의 `catalogHash`를 받아들이기 전에 `hashTools`로 다시 계산해
비교한다. 다르면 catalog를 바꾸지 않고 `CATALOG_INTEGRITY_UNVERIFIED`(`{catalogHash, computedHash}`)를 던진다(listing은 호출자에게,
`register` frame은 session error로). relay와 client는 같은 hash 알고리즘을 쓰므로 정상 relay에서는 이 거절이 생기지 않는다. 관련:
R-PEER-041, R-PEER-042. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-34 (결정 2026-10-20)** client의 drift 분류(−32010·−32027과 네 이름)와 `_meta.runtimeEpoch` 전송은 그대로 둔다. −32027
`SOURCE_CHANGED`·`RUNTIME_EPOCH_MISMATCH`와 `CATALOG_STALE`은 이 relay와 provider가 내지 않고 다른 의미로도 쓰지 않는 예약값이고,
`runtimeEpoch`는 relay와 provider가 해석하지 않는 정보 필드라고 적었다. api-index의 client errors 행에도 이 relay가 −32027을 내지 않는다는
문장을 더했다(README의 같은 문장은 문서 단계(O-59)에서 고쳤다). 관련: R-ERR-006, R-ERR-001, R-PEER-044, R-MCP-020. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-35 (결정 2026-10-20)** 종료 frame(`approval.rejected`, `approval.expired`, `session.revoked`, `room.rotated`, `room.expired`)을
`replyToAgent`(outbox)로 보내고, `AgentOutbox.closeAfterFlush`로 기다리던 frame이 다 나간 직후 닫는다(`closeAgentSocket`). relay는 먼저 socket을
room에서 떼고, 종료 frame, pending 요청의 오류, close 순서로 보내므로 outbox에 이미 있던 provider 답(실행된 `tools/call` 결과 포함)이 종료
frame보다 먼저 간다. 권고의 `WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS` 기한은 별도 timer 없이 codec의 stall close(1013)가 맡는다: 닫히는
outbox는 frame을 더 받지 않으므로 기다리는 양은 유한하고, 읽지 않는 agent는 그 close로 닫힌다. 관련: R-WS-031, R-WS-033, R-WS-037,
R-ROOM-026, R-ROOM-047, R-ROOM-050, R-ROOM-057, R-SIG-011, R-SIG-012, R-SIG-015, R-SIG-016, R-SIG-023. 구현: commit `5049527d`, changeset `webmcp-peer-protocol-c6-signaling`.

**O-36 (결정 2026-10-20)** `AgentOutbox`가 기다리는 frame 중 JSON-RPC 답(id가 문자열·수인 답을 담은 `mcp` frame)의 수를 따로 세고,
`pendingRequestCount`는 그 수만 더한다. `approval.pending`·`approval.approved`·`ready`·`offer.refused`는 읽기 중지에는 그대로 쓰되 64에 넣지
않는다. HTTP의 중복 id wire id 재작성과 agent별 상한 없음은 HTTP 요청이 서로 독립이라는 근거로 규범화했다. 관련: R-MCP-031, R-MCP-032,
R-MCP-042, R-PEER-035, R-WS-031, R-LIM-013. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-37 (결정 2026-10-20)** 현재 규칙을 규범화했다. 각 transport는 자기가 나르는 것을 잰다: WebSocket은 agent가 보낸 `mcp` frame
전체와 그 재직렬화를, HTTP는 body와 그 재직렬화를 261120 byte로 잰다. HTTP 읽기 단계의 413은 id를 알 수 없으므로 id null이고, 해석한
뒤의 413은 요청 id를 echo한다. client transport도 같은 기준으로 미리 거절한다. 관련: R-MCP-008, R-MCP-010, R-MCP-027, R-PEER-033,
R-LIM-010. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-38 (결정 2026-10-20)** relay는 JSON을 해석하는 세 자리(MCP POST body, JSON body route, provider·client socket의 text message)에서 맨 앞의
U+FEFF 하나를 지운다(`withoutByteOrderMark`, RFC 8259 §8.1의 MAY). 그래서 BOM으로 시작하는 WebSocket 요청이 답 없이 버려지거나 MCP POST가
400 `PARSE_ERROR`를 받던 일이 없다. 두 번째 BOM은 여전히 잘못된 JSON이다. 잘못된 UTF-8의 transport별 오류(1007, 400 `PARSE_ERROR`, 400
`INVALID_JSON_BODY`)와 codec(BOM을 그대로 넘긴다)은 바꾸지 않았고, JSON body route의 빈 body 판정(`String#trim`)도 그대로다. 관련: R-WS-017,
R-HTTP-008, R-MCP-009, R-SIG-001, R-PEER-053. 구현: commit `4df54672`, changeset `webmcp-peer-protocol-c7-websocket`.

**O-39 (결정 2026-10-20)** catalog snapshot에 `available`을 두고(room catalog나 deployment catalog가 있으면 참), HTTP
`tools/list`·`server/discover`, `GET /p/:id/mcp/tools`, `GET /mcp/catalog`의 503 조건을 `tools.length === 0`에서 `available`이 아님으로
바꿨다. provider가 `[]`를 등록한 room은 이제 모든 route에서 200 `tools: []`(version 1)이고, 503 body의 `catalogVersion`은 고정값 0 대신
snapshot 값이다. 관련: R-CAT-003, R-CAT-005, R-MCP-015, R-ROOM-063, R-ROOM-064. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-40 (결정 2026-10-20)** 받아들인 register에 token을 돌려주던 코드를 없애 모든 register 평가가 같은 bucket(burst 8개, 이후
초당 1개)을 쓰게 했다. 기다리는 frame은 다음 frame이 대체하고 마지막 frame은 언제나 평가하므로 정상 provider의 최신 catalog는 늦게라도
공지된다. WebSocket listing 답은 권고의 첫 안을 택해, room이 catalog(room 또는 deployment)를 가진 동안 평가하지 않고 relay 자신의
listing으로 답한다. 그래서 listing 답의 평가는 catalog가 없는 room에서만 일어나고, 그때 WebSocket `server/discover`도 relay가 답한다.
관련: R-CAT-011, R-CAT-012, R-CAT-014, R-MCP-038, R-LIM-020, 7.5 표. 구현: commit `5049527d`, changeset `webmcp-peer-protocol-c6-signaling`.

**O-41 (결정 2026-10-20)** HTTP transport는 `Accept: application/json, text/event-stream`을 보내고, 그렇게 알린 만큼 2xx
`text/event-stream` 응답도 읽는다(권고에 없던 부분이다). `initialize()`가 성공하면 `notifications/initialized`를 보내고, 그 뒤
`disconnect()`까지의 HTTP 요청은 협상된 `result.protocolVersion`을 `MCP-Protocol-Version`으로 싣는다. non-2xx JSON-RPC 오류의 `Retry-After`는
`retryAfterMs`로 넘어가고 `request()` backoff는 `max(현재 지연, retryAfterMs)`를 기다린다. 관련: R-PEER-036, R-PEER-037, R-PEER-039,
R-PEER-053, R-ERR-004, R-LIM-033, R-LIM-039. 구현: commit `965f20f0`, changeset `webmcp-peer-protocol-c5-mcp-routing`.

**O-42 (결정 2026-10-20)** codec이 붙은 provider·client socket마다 30 s(`WEBSOCKET_PING_INTERVAL_MS`)마다 RFC 6455 ping을 보내고, 무엇이든
마지막으로 읽은 뒤 75 s(`WEBSOCKET_IDLE_TIMEOUT_MS`) 동안 아무것도 읽지 못하면 1001로 닫는다. 끊지 않는 peer는 기존 close timeout이 파기한다.
relay option `webSocketPingIntervalMs`·`webSocketIdleTimeoutMs`(새 option, idle은 ping 간격보다 길어야 하며 생성자가 검사한다)와 codec option
`pingIntervalMs`·`idleTimeoutMs`로 바꿀 수 있다. 권고에 없던 부분: 소유자가 읽기를 멈춘 socket(relay가 요청한 frame에 뒤처진 agent를 읽지
않는 동안, R-WS-031)은 pong이 읽히지 않은 채 와 있을 수 있으므로 idle timeout이 닫지 않고 다시 센다. 그동안 사라진 peer는 stall close(1013)가
닫는다. 브라우저와 Node WebSocket은 ping에 스스로 답하므로 provider SDK, `PeerMcpSession`, 일반 client는 바꾸지 않았다. 관련: R-WS-021,
R-WS-025, R-WS-035, R-WS-039(신규), R-ROOM-016, R-SIG-007, R-LIM-009, R-LIM-045(신규), R-LIM-046(신규). 구현: commit `4df54672`, changeset `webmcp-peer-protocol-c7-websocket`.

**O-43 (결정 2026-10-20)** "room epoch당 client ticket 최대 1개"를 provider가 기댈 수 있는 protocol 불변식으로 고정했다. provider는
relay socket 요청의 `sessionId`(relay가 찍은 것)가 승인한 session과 다르거나 없으면 실행하지 않고 −32053 `CLIENT_APPROVAL_REQUIRED`로
답한다. 여러 agent를 한 room에 받는 기능은 session별 승인과 함께 별도 버전에서 다룬다. 관련: R-ROOM-005, R-PEER-012, R-PEER-017. 구현: commit `5049527d`, changeset `webmcp-peer-protocol-c6-signaling`.

**O-44 (결정 2026-10-20)** auto-reconnect의 write 규칙을 `connect()`와 같은 `webmcp:write-enabled === 'true'`로 바꾸고,
`setWriteEnabled`·`toggleWrite`가 host가 보고한 결과 상태를 그 key에 저장하게 했다. auto-reconnect는 저장한 room을 reclaim만 하고 room을
새로 열지 않는다. lease가 거절되면(400·401·403·404·410, `ROOM_PROVIDER_ACTIVE`가 아닌 409) lease를 지우고 session error `ROOM_LEASE_LOST`로
state `error`에서 멈추며 다음 시도를 예약하지 않는다. 권고를 넘어, 저장한 lease가 없으면 auto-reconnect를 건너뛰고(새로고침이 room을 혼자
열지 않는다), 다른 실패(5xx 등)는 lease를 둔 채 다시 시도하며, 409 binding 거절도 lease를 지운다(전에는 남겼다). host가 부른
`connect({reclaimLease:true})`는 전처럼 새 room으로 물러난다. README의 auto-reconnect 설명은 문서 단계(O-59)에서 고쳤다. 관련: R-PEER-024, R-PEER-025, R-PEER-028. 구현: commit `5049527d`, changeset `webmcp-peer-protocol-c6-signaling`.

**O-45 (결정 2026-10-20)** DataChannel framing을 양방향 같은 규칙(message당 512 chunk 이하, chunk당 16384 UTF-16 code unit
이하)으로 규정했다. provider는 2048 unit chunk로 보내므로 frame은 1048576 unit 이하이고, 그보다 큰 `mcp` 답은 RESULT_TOO_LARGE로 바꾼다(data
key는 단위에 맞춰 `limitCodeUnits`). 그 밖의 큰 frame(`grant`, `crdt`)은 보내지 않고 기록한다. offer·answer·hello·grant·release 인계는 package에
agent 구현이 생길 때까지 실험적(MAY), provider만 구현으로 표시했고, release 뒤 그 room의 relay agent가 `PROVIDER_UNAVAILABLE`을 받는 동작을
그대로 적었다. 관련: R-PEER-014, R-PEER-023, R-PEER-029, R-LIM-040, 8.1 표, 1.1. 구현: commit `5049527d`, changeset `webmcp-peer-protocol-c6-signaling`.

**O-46 (결정 2026-10-20)** descriptor(`GET /p/:id/mcp`)의 200·304 `Vary`가 `Origin, Accept, Accept-Encoding`이므로 공유 cache는
SSE만 받는 GET(405)에 cache한 descriptor를 주지 않는다. MCP endpoint의 SSE 405와 DELETE 405, 그 밖의 method(`PUT`, `PATCH` 등)는 모두
`Allow: GET, POST`의 405다. 권고를 넘어 같은 규칙을 모든 relay route에 적용했다. route가 받지 않는 method는 hook 뒤에 405
`{error:'METHOD_NOT_ALLOWED'}`와 그 route의 `Allow`(`GET /p/:id/join`은 `Allow: POST`, `POST /config`는 `Allow: GET`)이고, relay route가 아닌
경로만 404다(RFC 9110 §15.5.6). preflight method 목록은 O-27의 결정을 따른다. `/health`·`/status`·`/ping`은 `OPTIONS`(어느 경로에서든
preflight다, R-HTTP-010)를 뺀 모든 method를 받는 현재 동작을 유지했다. 세 경로는 `activeRooms`(살아 있는 room)와 `retainedRooms`(보존 중인 만료·rotate room)를 따로 알리고, `probePeerHealth`도
`PeerHealthResult.retainedRooms`로 그 값을 넘긴다. ETag·304·cache header 테스트를 더했다. 관련: R-HTTP-001, R-HTTP-014, R-HTTP-022,
R-ROOM-006, R-ROOM-007, R-ROOM-059, R-ROOM-061, R-ROOM-062, R-PEER-051. 구현: commit `ba304513`, changeset `webmcp-peer-protocol-c8-http-security`.

**O-47 (결정 2026-10-20)** 만료 처리가 ticket을 `revoked`가 아닌 `expired`로 끝내므로(`closeClientTicket`의 새 status) session
status는 `state:'expired'`와 만료 처리 시각의 `revokedAt`을 보고하고, 승인을 기다리던 `waitForPeerApproval`은 `APPROVAL_EXPIRED`를
던진다. WebSocket pending 요청은 HTTP와 같은 `ROOM_EXPIRED`다. 권고의 "호환용 `session.revoked` frame"은 O-05의 `room.expired`로
대신했다. 한 사건에 frame 하나를 쓰고 breaking 변경을 지금 낸다는 결정을 따랐다. `roomState`의 `rotating`은 wire에 나오지 않는 내부
상태로 적었다. 권고와 달리 ticket의 `room-rotated`는 내부 상태로 적지 않았다. session status에는 나오지 않지만 bearer로 보낸 MCP
metadata method의 `_meta.auth.state`에는 나오는 wire 값이다. `waitForPeerApproval`의 `room-rotated` 분기는 방어 코드로 두었다. 관련:
R-ROOM-003, R-ROOM-034, R-ROOM-035, R-ROOM-048, R-ROOM-065, R-PEER-048. 구현: commit `ff6b5c19`, changeset `webmcp-peer-protocol-c3-expiry-rotation`.

**O-48 (결정 2026-10-20)** join이 다른 수명주기 route와 같은 room 검사(`checkLifecycleRoom`)를 써서 만료 비교가 sweep과 같은
`expiresAt <= now`다. `expiresAt`과 같은 ms에 온 join은 invite를 소비하지 않고 ticket도 발급하지 않으며, O-05에 따라 404가 아닌 410
`ROOM_EXPIRED`로 답한다. 검사 순서도 다른 route와 같아져, 지운 room은 rotate 여부와 무관하게 404다. 관련: R-ROOM-019, R-ROOM-021. 구현: commit `ff6b5c19`, changeset `webmcp-peer-protocol-c3-expiry-rotation`.

**O-49 (결정 2026-10-20)** 실제 동작을 규범으로 정했다. rotate된 room은 만료 room과 같은 `metadataRetainUntil`(원래
`expiresAt` + 24시간)까지 남아 410 `ROOM_ROTATED`와 `replacementRoomId`로 답하고, 그 뒤에는 404다. 효과가 없던
`RoomEntry.rotatedRetainUntil`과 sweep의 `max()`는 지웠다. wire 동작은 바뀌지 않는다. rotate는 publish rate limit을 쓰지 않아 반복
rotate로 보존 room이 쌓일 수 있는데, 이는 보존 기간이 아니라 rotate 빈도의 문제라 따로 다룬다. 관련: R-ROOM-044, R-ROOM-050,
R-ROOM-051, R-LIM-028, R-LIM-029. 구현: commit `ff6b5c19`, changeset `webmcp-peer-protocol-c3-expiry-rotation`.

**O-50 (결정 2026-10-20)** 현재 동작을 규범으로 정했다. 전체 revoke는 200 `{roomId, revoked:true, revokedSessions:true}`이고, 단일
revoke는 멱등(`alreadyRevoked`)이며 `reason`은 호출자 body 값을 그대로 echo한다(기본 `provider-request`·`client-request`). echo는
요청자에게만 돌아가고 저장·전달되지 않는다. `session.revoked`의 reason은 relay가 정한 고정값(`SESSION_REVOKED`, `CLIENT_REVOKED`,
`ROOM_REVOKED`)이라 호출자가 agent 화면에 임의 문자열을 넣을 수 없다. 승인 결정은 1회성이라 반복 결정은 409 `INVALID_APPROVAL`이다.
wire 동작은 바뀌지 않는다. 관련: R-ROOM-028, R-ROOM-038, R-ROOM-039, R-ROOM-040, R-SIG-015. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-51 (결정 2026-10-20)** 현재 동작을 규범으로 정했다. publish key가 없으면 header·body owner는 인증되지 않은 주장이라 room
`ownerId`에 넣지 않고, 둘이 서로 다르면 모순된 요청으로 보아 403 `PUBLISH_OWNER_BINDING_INVALID`로 답한다. key가 있으면
`publishKeyOwner ?? 'publish-key-owner'`만 owner가 된다. wire 동작은 바뀌지 않으며, 이 규칙을 확인하는 테스트를 더했다. 관련: R-ROOM-011. 구현: commit `8199dcbb`, changeset `webmcp-peer-protocol-c4-approval-lease`.

**O-52 (결정 2026-10-20)** `POST /p`와 rotate의 `alias`를 join `clientLabel`처럼 trim한 뒤 처음 256 code point
(`MAX_ROOM_ALIAS_CODE_POINTS`)로 잘라 저장한다. 거절하지 않는다. 관련: R-ROOM-012, R-ROOM-043, R-LIM-042(신규). 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-53 (결정 2026-10-20)** `loadDeploymentCatalog(injected, cwd)`는 relay의 `cwd` option(기본 `process.cwd()`)을 기준으로
후보와 환경 변수의 상대 경로를 resolve하고, 다른 package 경로(`packages/peer-server/api/webmcp-tools.json`)는 보지 않는다.
`resolvePeerServerConfig`는 `publishRateLimitSqlitePath`(CLI `--publish-rate-limit-sqlite-path`, option, 설정 파일, env
`FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH`·`WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH`)를 읽고, relay는 주입 store > SQLite > file > memory
순으로 store를 고르며 자기가 연 SQLite store를 `close()`에서 닫는다. 쓰이지 않던 `journalPath`, `--journal-path`,
`FRAMEBOOK_COLLAB_JOURNAL_PATH`는 제거했다. 관련: R-ROOM-010, R-CAT-004. 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-54 (결정 2026-10-20)** `PeerServerPublicConfig.defaults`에 `/config`가 보내는 `maxRoomTtlMs?: number`를 더했고
`fetchPeerServerConfig`가 그 type을 검사한다. `createPeerConfigProfile`의 `roomTtlMs` 7200000은 relay가 clamp하기 전의 요청 기본값이며
실제 값은 `/config`의 `defaults`를 넘겨야 한다고 JSDoc과 이 문서에 적었다(profile은 직접 clamp하지 않는다). provider의 30분은
`expiresAt`이 없는 descriptor를 위한 fallback(`ROOM_EXPIRY_FALLBACK_MS`)이고 이 relay는 언제나 `expiresAt`을 보낸다. 관련:
R-ROOM-007, R-PEER-002, R-PEER-051, R-PEER-052. 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-55 (결정 2026-10-20)** `parseInvitationUrl`의 `descriptorUrl`과 `buildInvitationUrl`의 기본 base를 relay와 같은
`<server>/p/<roomId>/mcp`로 바꿨다. `parseInvitationUrl`은 `/p/<id>`와 `/p/<id>/mcp` 두 형태를 계속 받으므로 이미 배포된
`/p/<id>#invite=` URL도 동작한다. 관련: R-PEER-052, R-ROOM-013. 구현: commit `54a8063a`, changeset `webmcp-peer-protocol-c1-foundation`.

**O-56 (결정 2026-10-20)** `PeerMcpSession.revoke`의 실패 code는 다른 helper처럼 비어 있지 않은 문자열 `body.error`이고 없을
때만 `SESSION_REVOKE_FAILED`다. `PeerMcpService`는 등록 key를 option `key`(`PeerMcpServiceSessionOptions`, 새 export)로 받고 session의
`sessionId`를 덮어쓰지 않으므로 `sessionId`에는 relay가 발급한 id만 있다. 이름을 맞춰 `activeSessionId`는 `activeKey`, `callTool`의
option `sessionId`는 `key`가 됐다. 관련: R-PEER-046, R-PEER-055(신규). 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-57 (결정 2026-10-20)** approval의 `:requestId`, session status와 경로형 revoke의 `:sessionId`를 room 조회·인증·body 읽기보다
먼저, 실패하면 null을 돌려주는 `decodePathParameter`로 decode하고 실패하면 400 `{error:'INVALID_PATH'}`로 답한다. MCP POST가 drain
상한을 넘으면 JSON body route처럼 `res.destroy()`도 부른다(request 파기가 이미 socket을 끊으므로 관찰되는 동작은 같다). 관련:
R-HTTP-003, R-MCP-008. 구현: commit `13a88ee3`, changeset `webmcp-peer-protocol-c2-errors`.

**O-58 (결정 2026-10-20)** relay는 offer의 `requestId`로 비어 있지 않은 문자열(JSON 1024 byte 이하)을 요구하고, 아니면
`offer.refused` −32600 `INVALID_REQUEST`(requestId 없음)로 답한다. 1024 byte를 넘는 것은 전처럼 `REQUEST_ID_TOO_LARGE`로 둔다(같은 −32600
class의 더 구체적인 이름이다). agent socket마다 answer를 기다리는 offer는 하나이고(`TOO_MANY_PENDING_REQUESTS` `{limit:1}`), 다음 offer는
answer·`offer.refused`를 받은 뒤 보낼 수 있다. 권고를 넘어, `mcpRequestTimeoutMs` 안에 answer가 없는 offer와 provider가 사라진 offer에도
`offer.refused`(`MCP_REQUEST_TIMEOUT`, `PROVIDER_DISCONNECTED`)를 보내고, room의 다른 socket이 쓰는 requestId는 `DUPLICATE_REQUEST_ID`로
거절한다(answer를 한 socket으로만 보내기 위해). provider도 requestId가 없는 offer를 무시한다. trickle ICE가 없다는 것(`ice` frame 무시)을
규범으로 적었다. 관련: R-SIG-003, R-SIG-017, R-SIG-018, R-SIG-026, R-LIM-012, R-LIM-025, R-LIM-044, R-PEER-022. 구현: commit `5049527d`, changeset `webmcp-peer-protocol-c6-signaling`.

**O-59 (결정 2026-10-20)** 문서와 주석을 코드에 맞추고, wire 규칙은 이 문서에만 둔다. README, api-index의 webmcp-peer 절, relay
guide, 개념 문서는 wire 규칙을 요약하고 이 문서와 요건 ID를 링크한다. 초안이 짚은 틀린 문장을 모두 고쳤다: README의 Host 검사
(R-HTTP-020), provider socket이 닫혀도 agent socket은 남고 pending 요청만 `PROVIDER_DISCONNECTED`로 끝난다는 것(R-ROOM-054. README와 provider의
`sendRelayFrame`·`RELAY_MAX_MESSAGE_BYTES` 주석), stall close의 조건(R-WS-026), `clientLabel`의 code point 절단(R-ROOM-022), host
CallToolResult의 `isError` 재계산(R-PEER-013), ledger는 `setAiRunLedger`로 줄 때만 있다는 것, client의 catalogHash 검증(O-33)과 예약값
−32027(O-34), api-index의 client 요청 상한(261120 byte)과 register 보류 기준(`PEER_RELAY_MAX_CATALOG_BYTES`, 258048 byte),
`.changeset/webmcp-peer-stabilization.md`의 256 KiB, `docs/changelog.md` 2026-10-20 항목의 wire 동작 변경, 두 package의 `/p/:id/...` 경로를
섞어 쓰던 guide(`@oa-sdk/peer-server`의 409 `ROOM_BUSY`와 webmcp-peer의 409 `INVITE_TOKEN_CONSUMED`). 앞 cluster들이 README에 남긴 것(close
code, upgrade 거절, liveness, 승인 수명, `maxRooms`, `trustProxy`, 기본 publish rate limit, `PeerMcpService`의 `key`, auto-reconnect의 lease
상실)도 요약에 맞췄다. 보안 감사(`docs/security/webmcp-hardening.md`)에는 webmcp-peer 절(room 생성, 자격과 ticket subprotocol, 승인 gate,
frame 경계, Host·Origin·proxy, 상한, 배포 책임)을 더했다. `unforwardedRpcError`의 JSDoc을 그 함수 위로 옮겼다. `PACKAGE_VERSION`은 build
때 생성하지 않고 검사로 일치를 강제한다. browser에서도 도는 client tier는 package.json을 읽지 못하고, package.json은 tsc의 `rootDir`
밖이다. 대신 테스트가 `clientInfo.version`과 user-agent의 version이 package.json의 `version`과 같은지 확인하므로, changeset의 version
bump는 그 상수를 함께 바꿔야 test가 통과한다. 관련: R-PEER-037, R-PEER-039, R-PEER-047. 구현: 문서 단계(changeset
`webmcp-peer-protocol-c9-docs`).

**O-60 (결정 2026-10-20)** 테스트가 없던 요건에 테스트를 더하고 근거 줄에 정확한 제목을 적었다. 초안의 목록 가운데 앞 cluster들이
동작을 고치며 테스트를 더한 요건(R-ROOM-011 owner binding, R-HTTP-014·R-ROOM-061 ETag·304·Vary, R-WS-033 outbox 우회, R-PEER-028
auto-reconnect write, R-ROOM-035·R-ROOM-051 보존, R-SIG-002·R-SIG-009·R-SIG-012·R-SIG-019, R-PEER-023·R-PEER-029 DataChannel 등) 밖에 남은 요건에
이 단계가 테스트를 더했다: 같은 socket의 중복 id와 HTTP의 wire id(R-MCP-031, R-MCP-003), 식별자 형식(R-ROOM-001), publish rate limit의 floor와
quota header(R-ROOM-069), sweep timer와 요청마다의 sweep(R-ROOM-049, R-ROOM-068, R-LIM-030), 중계 요청의 timeout과 Node timer가 담지 못하는
값(R-MCP-004, R-MCP-044), `Infinity` id(R-MCP-043), 다시 쓴 provider frame의 측정(R-WS-036), request target의 정규화(R-HTTP-015),
`Content-Type`·`Accept`(R-HTTP-005), node:http의 header 상한(R-LIM-041), provider의 keepalive와 `ready` 대기(R-LIM-034, R-PEER-004), ICE 대기
(R-LIM-036), descriptor 검사(R-PEER-002), 만료 timer(R-PEER-027). 일부 경우만 다루던 요건에는 빠진 경우를 더했다: WebSocket `tools/call`의
relay 검사(R-MCP-020), WebSocket의 요청이 아닌 message(R-MCP-028), batch(R-MCP-009), `initialize`의 `bootstrapCatalog`와 catalog header
(R-MCP-016), SSE·DELETE 405의 body(R-ROOM-059, R-ROOM-062), `list_changed`가 announcement보다 먼저인 순서(R-CAT-008), register로 받은 자기
`__proto__` key(R-CAT-002), ledger replay와 `RECONCILIATION_REQUIRED`(R-PEER-016), package version(R-PEER-037, R-PEER-039). 이 문서와 코드가
다시 어긋나지 않도록 `test/protocol-spec.test.ts`가 요건 ID의 정의와 참조, 근거 줄의 형식과 그것이 가리키는 소스 줄·테스트 제목, 상한 표·
close code 표·오류 class 표와 export한 상수, 이 문서를 링크하는 문서의 요건 ID를 검사한다. 테스트가 없는 요건은 둘이다. R-HTTP-016(IPv6
literal host)은 운영자가 하지 말아야 할 설정이고 결과가 test host에 IPv6 loopback이 있는지에 달려 있다. R-HTTP-017(던지는
`formatHttpError`)은 결과가 relay process의 종료(처리되지 않은 rejection)라 test process 안에서 확인할 수 없다. 테스트를 쓰며 R-PEER-012의
`PEER_SESSION_SUPERSEDED`와 R-PEER-016의 `OUTCOME_UNKNOWN`이 wire에 나가지 않는다는 것을 확인했다(그 답을 실을 channel이 먼저 닫힌다). 두
요건과 오류 표에 방어용이라고 적었고, wire에서 관찰할 수 없으므로 테스트하지 않는다(O-68). 구현: 문서 단계(changeset
`webmcp-peer-protocol-c9-docs`).

**O-61 (결정 2026-10-20)** rotate가 publish rate-limit 단위 하나를 쓴다. 초안 뒤의 adversarial review가 rotate만으로 relay의 room을
채우는 길을 확인했다. 익명 `POST /p` 한 번으로 받은 providerToken으로 rotate를 되풀이하면 rotate마다 새 providerToken과 대체 room이 나오고 이전
room은 원래 만료 + 24시간까지 보존되므로(O-49), 기본 `maxRooms` 10000을 약 20초에 채워 그 room들이 지워질 때까지(24시간 TTL이면 약 48시간)
모든 `POST /p`와 rotate가 503 `ROOM_CAPACITY_EXCEEDED`를 받았다. 대체 room은 room 하나를 더하므로 rotate를 생성처럼 센다. room과 token 검사를
통과한 rotate는 body를 읽기 전에 rotate를 요청한 주소와 유효한 publisher의 `tokenHash`(설정한 publish key의 hash, 없으면 `anonymous`) bucket에서
단위 하나를 쓰고, 단위를 얻지 못하면 `POST /p`와 같은 429·503으로 답하며 room을 바꾸지 않는다. 그래서 한 주소는 생성과 rotate를 합쳐 기본 60초에
30개까지만 room을 더하고, `DEFAULT_MAX_ROOMS`의 주석(한 주소가 채우는 데 약 5.5시간)이 rotate에도 맞는다. rotate 요청에는 publish key가 없으므로
room을 만든 요청의 key를 다시 확인하지 않고, relay에 설정된 publisher bucket을 쓴다(설정된 key는 하나다). rotate된 room의 보존 기한(O-49)은 바꾸지
않았다. rotate된 room은 만료 room처럼 원래 만료 + 24시간까지 남아 생성한 room보다 오래 남지 않으므로, 빈도가 생성과 함께 묶이면 rotate가 relay를
더 빨리 채우지 못한다. 관련: R-ROOM-010, R-ROOM-069, R-ROOM-073, R-ROOM-045, R-LIM-031, R-LIM-047. 구현: commit `89c9737b`, changeset
`webmcp-peer-protocol-c8-http-security`.

**O-62 (결정 2026-10-21)** relay의 두 transport는 `tools/call` 검사 하나(`toolCallRefusal`)를 함께 쓰고, WebSocket도 HTTP처럼 id가 없는
`tools/call`을 notification 분기보다 먼저 검사한다. 거절한 notification에는 답할 수 없으므로 WebSocket은 답 없이 버린다(HTTP는 같은 경우를
id null의 오류와 status로 알린다). 그래서 참조 provider처럼 id 없는 message를 실행하지 않는 provider뿐 아니라 실행하는 provider에도 catalog가
맞지 않는 호출은 닿지 않는다. 관련: R-MCP-007, R-MCP-020, R-MCP-026, R-MCP-030. 구현: commit `f167735a`, changeset `webmcp-peer-protocol-c10-open-problems`.

**O-63 (결정 2026-10-21)** relay는 provider가 보낸 `notifications/tools/list_changed`를 agent에게 전달하지 않고 버린다. 그 notification은
relay가 받아들인 catalog를 relay의 `catalogVersion`·`catalogHash`와 함께 알리는 relay의 것이고, provider는 catalog를 `register`로 알린다.
그래서 agent가 받는 이 notification의 stamp는 언제나 relay가 `tools/call`을 검사하는 값이다. provider의 다른 notification과 server→client
요청은 전처럼 approved ticket의 socket에 broadcast한다. 참조 provider는 relay socket으로 이 notification을 보내지 않는다. 관련: R-SIG-004,
R-MCP-041, R-CAT-008. 구현: commit `f167735a`, changeset `webmcp-peer-protocol-c10-open-problems`.

**O-64 (결정 2026-10-21)** client는 relay와 같은 규칙(R-MCP-002)으로 답을 가린다: `jsonrpc:'2.0'`, 문자열이나 수인 id, `result`나 `error`
member. method가 있는 message는 id와 무관하게 답이 아니므로 provider의 server→client 요청이 진행 중인 요청을 끝내거나 relay가 아직 세는
slot을 비우지 않는다. 권고를 넘어, client가 답을 `String(id)`로 맞추며 생기는 같은 어긋남도 막았다. 진행 중인 요청(답이나 slot을 기다리는
것, 호출자가 멈췄지만 slot을 쥔 것)과 `String(id)`가 같은 id로 요청하면 보내지 않고 `DUPLICATE_REQUEST_ID`로 거절한다. 그렇지 않으면 두 번째
요청이 첫 요청의 답을 가로채거나(HTTP transport), relay socket에서는 relay가 두 번째를 `DUPLICATE_REQUEST_ID`로 거절하는 답이 relay가 아직
세는 첫 요청의 slot을 비웠다. 수 1과 문자열 `"1"`도 relay에서는 다른 key지만 client에서는 slot 하나라 같은 일이 생겼다. MCP도 한 session에서
요청 id를 다시 쓰지 않게 한다. 그래서 client가 진행 중으로 세는 요청은 relay가 세는 요청을 모두 포함한다. 구현 뒤 review가 찾은 두 빈틈도
막았다. 요청은 `request()` 호출이 끝날 때까지 진행 중이라, timeout이 pending을 지운 뒤에도 POST가 끝나지 않은 HTTP 요청과 재시도를 기다리는
요청도 센다. 그렇지 않으면 같은 id의 두 번째 요청이 첫 요청의 늦은 답을 가로채거나, 첫 요청의 재시도가 `DUPLICATE_REQUEST_ID`로
거절됐다(11장). 그 수정의 재확인이 찾은 빈틈도 막았다. 연결을 기다리는 요청은 `disconnect()`가 바로 끝내 id를 놓는다. 그렇지 않으면
transport를 얻는 중이라 끝나지 않은 connect를 기다리며 id를 쥐어, 다시 연결한 session에서 그 id의 요청이 거절됐다(R-PEER-045, 11장). 그
재확인이 찾은 두 빈틈은 규칙 하나로 막았다. 요청은 모든 transport에서 `request()`부터 그 답이 오거나 그 연결이 끝날 때까지 진행 중이고(내장
HTTP transport에서는 답이 POST와 함께 오므로 POST가 끝날 때까지), 연결이 끝나면 그 연결의 id를 모두 바로 놓는다. 그렇지 않으면 send가 답보다
먼저 돌아오는 raw transport에서 timeout된 요청의 id로 보낸 요청이 그 늦은 답을 받았고, `disconnect()` 때 raw가 아닌 send가 끝나지 않은 요청은
그 send가 끝날 때까지 id를 쥐어 다시 연결한 session에서 그 id의 요청이 거절됐다(R-PEER-032, R-PEER-045, 11장). 그 규칙의 재확인이 찾은 두
빈틈도 막았다. 연결이 끝날 때 아직 도는 send는 그 transport가 쓸 때 가진 연결에 쓰므로, 다음 연결이 같은 transport를 다시 쓰면(넘겨받은
`transport`, factory가 다시 돌려준 transport) 그 send가 도는 동안과 그 요청이 그 연결에 나간 뒤 답이 올 때까지 그 연결에서 id를 진행 중으로 두고
slot 하나를 센다. 그렇지 않으면 그 id로 보낸 요청이, 늦게 나간 첫 요청을 relay가 `DUPLICATE_REQUEST_ID`로 거절한 답을 받았다. 또 연결을
끝내지 않는 transport 오류와 `{type:'error'}` frame은 기다리는 요청만 거절하고 id와 slot을 놓지 않는다. 그렇지 않으면 같은 연결에서 그 id로
보낸 요청이 첫 요청의 늦은 답을 받았다(R-PEER-032, R-PEER-035, R-PEER-038, 11장). 관련:
R-PEER-032, R-PEER-035, R-PEER-036, R-PEER-038, R-PEER-045, R-MCP-031, R-MCP-032. 구현: commit `f167735a`, changeset `webmcp-peer-protocol-c10-open-problems`.

**O-65 (결정 2026-10-21)** room 만료 처리는 아직 끝나지 않은(`pending`, `approved`) ticket만 `expired`로 끝내고, 그 전에 끝난 ticket
(`rejected`, `revoked`, 승인 요청이 만료된 `expired`)의 status와 `revokedAt`은 그대로 둔다. ticket 자신의 `expiresAt`이 지날 때 `revoked`·
`rejected`를 덮어쓰지 않는 규칙(R-ROOM-034)과 같다. 그래서 보존 중인 만료 room의 session status는 만료 전에 거절·revoke된 session을 그때의
state와 시각으로 보고한다. 끝난 ticket에는 socket도 진행 요청도 없으므로 만료가 그 ticket에 할 일은 없다. revoke-all과 rotate는 전처럼 모든
ticket을 덮어쓴다. rotate된 room의 session status는 410이라 보이지 않고, revoke-all이 덮어쓰는 것은 단일 revoke(R-ROOM-039)와 같은 규칙이다.
관련: R-ROOM-030, R-ROOM-035, R-ROOM-048, R-ROOM-050. 구현: commit `f167735a`, changeset `webmcp-peer-protocol-c10-open-problems`.

**O-66 (결정 2026-10-21)** 사용자는 relay가 bearer ticket만 쓰고 OAuth discovery를 제공하지 않는 안을 골랐다(RFC 9728 protected resource
metadata를 제공하는 안 대신). MCP authorization은 선택이고, MCP가 요구하는 protected resource metadata는 authorization server를 하나 이상
가져야 하는데 relay에는 없다. relay의 token은 운영자의 publish key와 room 생성·join이 발급하는 token이다. 그래서 metadata를 제공해도 OAuth
client는 한 단계 뒤에서 실패하고, 맞추려면 invite를 token으로 바꾸는 authorization server를 새로 만들어야 한다. 이제 relay의 401은 RFC 9110이
요구하는 `WWW-Authenticate: Bearer` challenge를 계속 보내되 `resource_metadata`·`scope` 같은 discovery 매개변수를 싣지 않고, RFC 9728·RFC 8414·
OpenID Connect의 well-known 경로는 404로 둔다는 것을 규범으로 적었다. 일반 Streamable HTTP agent는 clientToken을 정적 bearer 자격으로 보내고
401로 OAuth discovery를 시작하지 않는다(공식 SDK라면 auth provider 없이 `requestInit.headers`). wire 동작은 바뀌지 않았고, 테스트가 challenge와
그 경로들의 404를 고정한다. 관련: R-HTTP-019, R-PEER-053. 구현: commit `f167735a`, changeset `webmcp-peer-protocol-c10-open-problems`.

**O-67 (결정 2026-10-21)** `PeerMcpSession.revoke`는 POST 하나만 보낸다. body의 `roomId`·`roomEpoch`는 session이 이미 아는 값일 때만 싣고,
모르는 roomEpoch를 알아내려고 session status나 metadata `initialize`를 먼저 보내지 않는다. relay는 둘을 요구하지 않고 있을 때만
검사한다(R-ROOM-071). 그 왕복을 위한 `#learnRoomEpoch`와 두 helper를 지웠다. 관련: R-PEER-046, R-PEER-037. 구현: commit `f167735a`, changeset
`webmcp-peer-protocol-c10-open-problems`.

**O-68 (결정 2026-10-21)** 두 답의 분기를 지우고 결과를 전할 새 방법은 두지 않았다. provider는 끝난 connection generation의 요청을 실행하지도
답하지도 않고, 실행 중에 generation이 끝난 `tools/call`에도 답하지 않는다. 답을 실을 channel은 generation을 바꿀 때 먼저 닫히므로 어떤 답도
agent에게 닿지 않는다. agent는 relay가 진행 중인 그 요청을 끝낸 오류로 알고(실행됐을 수 있다, R-MCP-005), ledger가 있으면 같은
`context.requestId`로 다시 호출해 기록된 receipt의 replay나 `RECONCILIATION_REQUIRED`로 결과를 확인한다(receipt는 generation과 무관하게
ledger에 기록된다). 그 오류는 HTTP revoke(agent나 host의 것)면 `SESSION_INVALID`, relay가 수행한 room 만료나 rotate면 `ROOM_EXPIRED`나
`ROOM_ROTATED`, provider socket이 먼저 닫혔으면(provider 자신의 `disconnect()`·`revokeClient()`, 4001 교체, 끊긴 socket)
`PROVIDER_DISCONNECTED`다(R-PEER-016). 처음 이 기록은 `PROVIDER_DISCONNECTED`만 적었다(11장). 이 두
이름을 쓰던 곳이 없으므로 relay와 provider가 함께 쓰는 `PEER_ERROR_CODES`에서 두 이름과 −32008 class를 뺐다(`PEER_SESSION_SUPERSEDED`는
provider의 session error 이름으로 남는다). 분기를 지우며 드러난 결함도 고쳤다. 그 분기는 host가 실행한 호출의 bookkeeping도 건너뛰어, revoke·
만료·4001처럼 run을 지우지 않고 generation만 끝내는 session 종료 뒤에 끝난 호출의 action이 run에 실행 중으로 남았다. 그 run은 멈춘 뒤에도
rollback할 수 없었고(`AI run still has in-flight actions`) 내보낼 수도 없었으며, 그 호출의 step이 기록되지 않아 rollback이 되돌리지 못했다.
이제 run이 그 action을 쥐고 있으면(새 `AiRunController.hasAction`. `disconnect()` 뒤 같은 id로 새로 시작한 run은 쥐지 않는다) action을
settle하고 step을 기록한다. ledger를 기다리는 동안 generation이 끝난 호출은 host를 부르지 않는다. 구현 뒤 review가 찾은 빈틈도 막았다.
그런 호출이 ledger에 outcome-unknown이나 durable로 기록돼 있으면 `RECONCILIATION_REQUIRED`나 replay로 답했는데(닫힌 channel이라 wire에는 나가지
않았다), 이제 조회 직후 generation을 보고 답하지 않는다(11장). 그 수정은 run을 시작하기 전의 generation 검사를 ledger 분기 안으로 옮겨,
ledger 조회가 없는 호출은 요청을 읽은 뒤 host adapter의 `getServerInfo`가 연결을 끝내도 host에서 실행됐다. 그 전부터 run을 알리는
`subscribeAiRuns` listener가 연결을 끝낸 호출도 막지 못했다. 이제 run을 시작하기 전에는 언제나, run을 시작한 뒤와 action을 등록한 뒤에도
generation을 본다(11장). 그 수정들의 재확인이 찾은 빈틈도 막았다. 답을 막는 검사가 요청을 읽기 전과 `tools/call` 안에만 있어, 요청을
읽은 뒤 provider가 부른 host code(`getServerInfo`, DataChannel의 `listTools`)가 연결을 끝내면 다른 method는 끝난 연결에 답했고, 처리기가
던지면(ledger 조회 실패, 연결을 끝낸 뒤 던진 host code, listener가 지운 run을 바꾸려던 bookkeeping) −32603으로 답했다. 이제 답을 내는 곳
하나가 두 channel의 모든 요청에 generation을 보고, 그 앞의 검사는 host code가 돌지 않게 하는 것만 남았다. 또 `subscribeAiRuns` listener가
던진 예외가 run의 bookkeeping을 끊어, 등록된 action이 남아 run을 rollback할 수 없거나 host가 커밋한 쓰기가 기록되지 않고 −32603으로
답했다. 이제 `AiRunController`가 listener의 예외를 버리고, provider는 listener의 `disconnect()`가 지운 run을 더 바꾸지 않는다(11장). 관련:
R-PEER-012, R-PEER-013, R-PEER-016, R-ERR-001. 구현: commit `f167735a`, changeset `webmcp-peer-protocol-c10-open-problems`.

**O-69 (결정 2026-10-21)** `onMessage`가 없는 넘겨받은 transport에 session이 다는 `onMessage`를 transport 객체마다 하나인 dispatcher로
바꿨다. 그것은 같은 transport 객체를 받은 session 가운데 그 transport로 마지막에 connect한 session으로 가고, 그 session이 `disconnect()`로
놓으면 다음 connect까지 아무것에도 가지 않는다. 그래서 `PeerMcpService({ transport })`의 `connect()`, `disconnect()`, `connect()`에서 두
번째 session이 `ready`와 답을 받아 `TRANSPORT_TIMEOUT`으로 끝나지 않고, 두 session이 함께 transport를 쥐면 마지막에 connect한 session이 받는다.
caller 자신의 `onMessage`는 전처럼 바꾸지 않는다. 구현 뒤 review가 찾은 빈틈도 막았다. `disconnect()`가 끝낸 connect는 늦게 끝나도 dispatcher를
잡지 않는다. 그렇지 않으면 그동안 같은 transport로 connect한 session이 `connected`인 채 아무 frame도 받지 못했다(11장). 그 수정의 재확인이
찾은 빈틈도 막았다. `disconnect()`가 끝낸 connect는 늦게 끝나도, 같은 transport 객체를 받은 다른 session의 연결이 그 transport를 붙들고
있으면 닫지 않는다. 그렇지 않으면 그 session은 `connected`인 채 요청마다 실패했고, 닫힘이 1000으로 알려지면 `TRANSPORT_CLOSED`로 끝나 다시
연결하지 않았다. 그래서 넘겨받은 transport마다(`onMessage`가 있든 없든) 그것을 붙든 연결을 모든 session에 걸쳐 기록하고, 끝난
connect는 그 기록을 본다(R-PEER-045, 11장). 그 기록의 재확인이 찾은 빈틈도 막았다. 끝난 연결(connect가 실패했거나, transport가 닫혔거나,
session을 끝내는 frame이 온 것)은 그 transport를 붙들지 않는다. 그렇지 않으면 다시 연결하지 않은 그런 연결이 남은 동안(버려진 session이면
영영) 끝난 connect가 늦게 다시 연 transport를 아무도 닫지 않았다(R-PEER-045, 11장). 관련: R-PEER-031, R-PEER-045, R-PEER-055. 구현: commit `f167735a`, changeset `webmcp-peer-protocol-c10-open-problems`.

### 10.2 남은 열린 문제

10.2에 올렸던 O-62~O-69는 10.1에 결정으로 옮겼다. O-70~O-77은 그 결정을 구현한 수정과 그 재확인 수정(11장)의 검증이 재현했지만 이
버전에서 고치지 않은 것이다. 항목마다 마지막 수정 뒤의 코드에서 scratch 테스트로 다시 재현했고, 그 전 commit의 코드로도 돌려 언제부터인지
적었다.

**O-70 (low) 답을 막는 검사 뒤 그 답을 보내기 전에 연결이 끝나면 provider는 끝난 연결의 답을 보내려 한다.** `answerMcpRpc`는 처리기가
돌아온 뒤 generation을 보고 답을 돌려주지만(R-PEER-012), 두 channel의 frame 처리기는 그 답을 `await`한 다음 microtask에서 보내며 그때
generation을 다시 보지 않는다(relay socket은 `readyState`만, DataChannel은 답이 있는지만 본다). 그 사이에 같은 turn에 온 다른 요청이 연결을
끝낼 수 있다. 예: 한 network read가 relay frame `{jsonrpc:'2.0', id:'A', method:'ping'}`과 `tools/call` 'B'를 한 turn에 전하고(Node `ws`가
그렇게 전한다), host가 'B'를 실행한 뒤 그 action을 settle할 때 `subscribeAiRuns` listener가 `disconnect()`를 부른다. A의 검사는 연결이 살아
있을 때 지나가고, 그다음 B의 continuation이 generation을 끝내며(B에는 바르게 답하지 않는다), 이어서 A의 처리기가 `{id:'A', result:{}}`를
보낸다. provider state는 `idle`인데, 열린 채 둔 테스트의 relay socket과 DataChannel이 모두 그 답을 기록한다. generation을 바꾸는 일은 channel을
먼저 닫으므로 실제 WebSocket은 CLOSING이고 RTCDataChannel은 `open`이 아니어서, 보내기 전의 검사가 막아 wire에는 나가지 않는다. 이번 수정들
전부터 있었다. 49b1c814에서는 같은 순서로 A와 B 모두에 답했고(B는 −32603), b90ab15e가 답을 내는 곳 하나로 모은 검사가 B만 막았다. wire에
영향이 없는 낮은 심각도라 이 버전에서 바꾸지 않는다. 권고: 보내는 곳이 `answerMcpRpc`를 기다린 뒤 generation을 다시 본다(relay socket은
`generation === this.connectionGeneration && ws.readyState === WebSocket.OPEN`, DataChannel은 `generation === this.connectionGeneration`).
또는 `answerMcpRpc`가 검사한 turn에 직접 보낸다. 회귀 테스트는 `ping`과 `tools/call`을 한 turn에 전하고 그 호출이 settle할 때 연결을 끝내는
run listener를 쓴다. 위치: `src/provider/peer-client.ts:1069`, `src/provider/peer-client.ts:1070`, `src/provider/peer-client.ts:1569`,
`src/provider/peer-client.ts:1570`, `src/provider/peer-client.ts:1603`.

**O-71 (low) run을 알릴 때 host의 CRDT transport가 던지면, host가 커밋한 `tools/call`에 −32603으로 답하고 이름 붙은 run을 실패시킨다.**
host가 실행한 호출의 run을 바꾼 뒤 `changeAiRun`은 `publishAiRunAwareness`로 그 run을 host의 CRDT transport에 알린다(`introduceRemotePeer`가
`receiveVerified`를, roomEpoch가 없으면 `receiveExternal`을 부른다). `introduceRemotePeer`의 다른 호출처(DataChannel의 hello와 `tools/call`,
`attachCrdtTransport`)와 달리 이 호출만 예외를 잡지 않는다. 예: DataChannel session(state `connected`, `mcp-crdt` room)에서
`attachCrdtTransport`로 단 transport의 `receiveVerified`가 host가 tool을 실행한 뒤 동기로 던진다. agent가 `_meta.framebook.aiTrace.runId`
'task-x'로 `tools/call` 'write'를 보내고, host는 `{ok:true, receipt:{status:'durable', operationId:'op1', …}}`를 돌려준다. `changeAiRun`은
action을 settle하고 op1을 기록한 뒤 알리다 던지고, `handleToolCall`의 catch는 run을 그 예외의 message로 실패시킨 뒤 다시 알리다 또 던진다.
그 예외를 받은 `answerMcpRpc`는 `{error:{code:-32603, message:'Internal error'}}`로 답한다. run 'task-x'는 `phase:'failed'`,
`operationIds:['op1']`이고 그 run의 다음 호출은 `AI_RUN_TERMINAL`이다. 이름 없는 호출도 커밋한 뒤 −32603을 받고, host의 `stopAiRun`도 run을
멈춘 뒤 같은 예외를 던진다(`rollbackAiRun`도 같은 알림을 부른다). agent는 커밋된 쓰기를 내부 오류로 알아 다시 시도할 수 있다(ledger가 없으면
두 번 쓴다). R-PEER-013(host를 부른 결과는 언제나 CallToolResult)과 R-PEER-016(host가 실행한 호출은 그 결과대로 run에 기록하고 끝낸다)을
어긴다. relay socket에서는 provider state가 `connected`가 아니어서 알리지 않으므로 생기지 않는다. 9f34ff94에서도 같았다. b90ab15e가 고친
`subscribeAiRuns` listener의 예외와 같은 결과를 이번에는 host의 CRDT transport가 낸다. 던지는 transport는 host의 결함이고 op1은 run에 기록되어
rollback이 되돌릴 수 있으므로 낮은 심각도이고, 이 버전에서 바꾸지 않는다. 권고: `publishAiRunAwareness`가 `introduceRemotePeer` 호출을 다른
호출처처럼 try/catch로 감싸 기록만 한다(그러면 `stopAiRun`·`rollbackAiRun`도 던지지 않는다). 또는 run 알림을 `handleToolCall`의 try 밖에서 해,
알림의 실패가 호출의 bookkeeping과 답을 바꾸지 않게 한다. 회귀 테스트는 DataChannel에서 던지는 `receiveVerified`로 한다. 위치:
`src/provider/peer-client.ts:1904`, `src/provider/peer-client.ts:1879`, `src/provider/peer-client.ts:2182`, `src/provider/peer-client.ts:2185`,
`src/provider/peer-client.ts:2170`, `src/provider/peer-client.ts:1565`, `src/provider/peer-client.ts:2058`.

**O-72 (low) R-PEER-013은 `tools/call`의 JSON-RPC 오류 답을 −32602뿐이라 적지만, 살아 있는 연결에서 ledger 조회가 실패한 호출은 −32603으로
답한다.** R-PEER-013은 "`tools/call`이 JSON-RPC `error`로 답하는 것은 이 params 무효(−32602)뿐이다"라고 적는다. 그런데 ledger 조회
(`aiRunLedger.find`)는 `handleToolCall`의 try 밖에 있어, 조회가 reject하면 그 예외를 받은 `answerMcpRpc`가 살아 있는 연결에 −32603
`Internal error`로 답한다. R-PEER-012의 "예상하지 못한 예외는 −32603"과 R-PEER-016(끝난 연결이면 그 −32603도 답하지 않는다)은 이것을
전제하고, 테스트도 연결이 살아 있는 동안의 id 1에 그 답을 확인한다:
`test/provider-tool-call.test.ts` › `answers nothing for a call whose session ended while the ledger lookup that then failed was pending`.
O-71은 같은 −32603의 다른 길이다. 그 문장은 초안부터 있었고(그때는 −32008 `OUTCOME_UNKNOWN`과 함께였다) O-68이 −32008을 빼며 −32602만
남았다. ledger 조회는 초안 때도 try 밖이었다. wire 동작이 아니라 요건끼리의 어긋남이고, 문장과 동작 가운데 어느 것을 고칠지가 결정이라 이
버전에서 바꾸지 않는다. 권고: R-PEER-013을 "params 무효(−32602)와, host 호출 밖에서 일어난 예상하지 못한 예외(실패한 ledger 조회 등, −32603
`Internal error`, R-PEER-012)"로 고치고 위 위치와 테스트를 근거로 단다. 또는 실패한 조회를 `isError` CallToolResult로 답해 "−32602뿐"을 지킨다.
위치: `src/provider/peer-client.ts:1763`, `src/provider/peer-client.ts:1608`.

**O-73 (medium) 답이 이미 온 요청의 send가 연결이 끝날 때 아직 돌면, 같은 transport로 다시 연결한 연결에서 그 id와 relay slot 하나가 그
연결이 끝날 때까지 남는다.** 연결이 끝날 때(`#endRequests`) send가 아직 도는 요청은 답이 이미 왔는지 보지 않고 늦은 send(`#lateSends`)가 되고,
그 send가 성공해 끝나면(`#lateSendEnded`) 그 transport를 쓰는 살아 있는 다음 연결에 나간 것으로 보아 그 연결에서 답을 기다린다(R-PEER-032,
R-PEER-035). 그 답은 끝난 연결에 이미 왔으므로 다음 연결에서는 오지 않는다. 예: caller 자신의 transport T(factory가 다시 돌려준 transport도
같다)의 send는 바로 쓰고 relay는 바로 답하지만, send의 promise는 쓰기가 확인된 뒤에 끝난다. `connect()` 뒤 `request('ping', {}, {id:'x'})`의
답이 와 pending이 끝났고 send는 아직 돌 때 `await disconnect()`와 `await connect()`가 T를 다시 연결하고, 그 뒤 send가 끝난다. 첫 요청은 그
결과로 끝났는데, 다시 연결한 연결에서 `request('ping', {}, {id:'x'})`는 400 ms 뒤에도 `DUPLICATE_REQUEST_ID`로 거절되고, 그 요청은 그 연결의
slot 하나를 센다. `disconnect()` 전에 그런 요청이 64개였으면 모두 결과로 끝났는데도 다시 연결한 연결은 새 요청을 하나도 쓰지 못하고
`REQUEST_TIMEOUT`으로 끝낸다. 그 연결이 끝날 때까지 그렇다. 2e5a728f가 늦은 send를 다음 연결에 남기며 만든 회귀다(b90ab15e와 49b1c814에서는
같은 순서로 'x'를 보내고 64개 뒤의 새 요청도 쓴다). R-PEER-032의 "그 답이 오거나 그 연결이 끝날 때까지"에서 그 답은 이미 왔다. send가 쓰기
확인을 기다리는 transport에서 그 사이에 `disconnect()`가 올 때만 생기지만, 남는 slot은 기본 id의 요청까지 막으므로 중간 심각도다. 고치면 이번에
정한 늦은 send의 규칙(R-PEER-032)을 다시 정해야 하므로 이 버전에서 바꾸지 않는다. 권고: 답을 아직 기다리는 요청만 늦은 send로 둔다
(`#endRequests`에서 `hold.sending && hold.awaitingAnswer`). session이 그 답을 본 것은 그 send가 끝난 연결의 wire에 이미 썼다는 증거이므로,
`#lateSendEnded`도 답이 온 hold에는 `landedOn`을 정하지 않는다. 위치: `src/client/session.ts:1015`, `src/client/session.ts:1139`,
`src/client/session.ts:1140`, `src/client/session.ts:1156`, `src/client/session.ts:1358`.

**O-74 (medium) 한 session의 늦은 send는 같은 넘겨받은 `transport`를 받은 다른 session의 연결에서는 진행 중이 아니다.** 늦은 send
(`#lateSends`)는 session마다 기록되므로, 그것이 막는 id와 세는 slot은 그 session의 다음 연결에만 있다. 그런데 `PeerMcpService({ transport })`는
만드는 session마다 같은 transport 객체를 넘기므로(R-PEER-055) 다른 session의 연결이 그것을 다시 쓴다. 예: connect마다 새 wire를 여는 transport
T에서 붙잡힌 send는 그때 T가 가진 wire에 쓰고, relay는 wire마다 진행 중인 id를 `DUPLICATE_REQUEST_ID`로 거절한다(R-MCP-031). relay의 `ready`가
sessionId 'S'를 주므로 두 session의 기본 id는 모두 'S-1'이다. `service.connect()`가 session A를 주고, A의 `request('ping')`(id 'S-1')의 send가
붙잡힌 채 `service.disconnect()`, 그다음 `service.connect()`가 T로 session B를 준다. B의 `request('ping')`(id 'S-1')를 쓴 뒤 A의 send가 풀려
B의 wire에 'S-1'을 쓴다(쓴 순서는 B, A). B의 pending 'S-1'은 relay가 A의 늦은 요청을 거절한 `DUPLICATE_REQUEST_ID`로 끝나, B는 다른 요청의
답을 받고 자신의 답은 버리며 relay가 아직 세는 slot을 비운다. 순서가 반대면(늦은 send가 먼저) relay가 B의 요청을 거절한다. R-PEER-032는 그
id가 "그 transport를 쓰는 살아 있는 연결에서" MUST 진행 중이라 하고, 이것은 O-69가 다룬 바로 그 service 흐름이다. 이번 수정들 전부터
있었고(49b1c814에서도 같다), 2e5a728f의 늦은 send 수정은 같은 session만 다룬다. 다른 요청의 답을 받으므로 중간 심각도다. session마다인 id의
기록(R-PEER-032)을 같은 transport를 받은 session들에 걸쳐 넓히는 일이라 결정이 필요해 이 버전에서 바꾸지 않는다. 권고: 넘겨받은 transport의
늦은 send를 transport 객체마다 session을 넘어 기록한다(`suppliedTransportHolders`처럼 transport에서 key와 hold로 가는 WeakMap).
`#assertIdNotInFlight`, `#requestOnce`의 재검사, `#slotsInUse`가 그것을 보고, 어느 session의 `#answered`든 그 기록에 닿으면 지운다. 위치:
`src/client/session.ts:995`, `src/client/session.ts:1106`, `src/client/session.ts:1125`, `src/client/session.ts:1194`, `src/client/service.ts:43`.

**O-75 (low) 끝난 connect가 늦게 다시 연 넘겨받은 `transport`는, 그때 그것을 붙들던 연결의 connect가 그 뒤 실패하면 열린 채 남는다.**
`disconnect()`가 끝낸 connect가 넘겨받은 transport T를 늦게 다시 열 때 T를 붙든 살아 있는 연결이 있으면 닫지 않는다(`#closeUnlessInUse`,
R-PEER-045). 그 연결이 아직 T를 연결하는 중이었고 그 connect가 그 뒤 실패하면, 그 연결은 끝나 붙든 기록에서 빠지지만(`#connectionEnded`)
아무도 T를 다시 보지 않는다. 같은 session에서: connect 1이 T의 `connect`를 기다리는 동안 `await disconnect()`가 T를 닫고(close 1번), connect
2가 T의 `connect`를 기다린다. connect 1의 것이 끝나 T를 열면 connect 2의 연결이 붙들어 닫지 않고, connect 2의 것이 'relay unreachable'로
실패해 session은 `error`다. close는 1번이고 T는 열려 있다. 두 session에서: 같은 T를 받은 A와 B(`PeerMcpService({ transport })`의 connect,
disconnect, connect)에서 A의 connect가 T를 연결하는 동안 `A.disconnect()`(close 1번), B의 connect가 T를 연결하는 동안 A의 것이 끝나 T를
열고, 그 뒤 B의 것이 실패한다. A는 `idle`, B는 `error`, close는 1번이고 T는 열려 있다. T는 그 session의 `disconnect()`까지, 실패한
`PeerMcpService.connect()`의 session을 버리면 영영 열린 채다. 반대 순서(connect 2가 connect 1보다 먼저 실패)는 닫히고 테스트가 확인한다:
`test/client-session.test.ts` › `closes the transport again once a connect it ended has connected it, though the connect after it failed`.
같은 session의 이 순서는 이번 수정들 전부터 그랬고, 두 session의 이 순서는 9f34ff94가 다른 session의 연결도 붙든 것으로 세면서
생겼다(49b1c814에서는 A가 T를 닫았다). R-PEER-045의 "끝난 연결은 ... 아무도 쓰지 않는 transport를 열어 두지 않는다"와 O-69가 막으려던
결과다. 결과가 열린 transport 하나이고 그 session의 다음 `disconnect()`가 닫으므로 낮은 심각도이며, 붙든 연결의 끝을 기다려 닫는 기록을 새로
두는 일이라 이 버전에서 바꾸지 않는다. 권고: `#closeUnlessInUse`가 살아 있는 연결 때문에 닫지 않으면 그 transport에 미룬 닫기를 기록한다
(transport 객체마다, `suppliedTransportHolders` 옆에). transport를 연결하지 못하고 끝난 연결(실패한 connect) 때문에 붙든 기록이 비면 그 닫기를
하고, 붙든 연결의 connect가 성공하면 그 기록을 지운다. 회귀 테스트는 두 순서를 같은 session과 두 session에서 모두 다룬다. 위치:
`src/client/session.ts:766`, `src/client/session.ts:748`, `src/client/session.ts:682`, `src/client/session.ts:720`.

**O-76 (low) 같은 key로 바뀐 `PeerMcpService`의 session은 다른 session의 `disconnect()`가 넘겨받은 `transport`를 닫은 뒤에도 그것을 붙든
연결로 남는다.** `createSession`은 같은 key의 session을 `disconnect()`하지 않고 바꾼다(R-PEER-055). 바뀐 session이 연결된 채면 그 연결은
넘겨받은 transport T를 계속 붙든다. T의 close는 그 transport의 마지막 connect의 callback으로만 알려지므로(R-PEER-031), 다른 session의
`disconnect()`가 T를 닫아도 바뀐 session은 그것을 모르고 `connected`에 살아 있는 연결로 남는다. 예: `PeerMcpService({ transport, sessionId: 'S' })`
(connect마다 key 'S')에서 `a = await service.connect()`, `b = await service.connect()`가 a를 바꾸고, `service.disconnect()`가 b의 T를 닫는다
(close 1번, 1000은 b의 callback으로 간다). `c = service.connect()`가 T의 `connect`를 기다리는 동안 `service.disconnect()`(close 2번), 그 뒤 c의
`connect`가 끝나 T를 다시 연다. `#closeUnlessInUse`는 a의 연결이 붙들어 닫지 않는다. close는 2번, T는 열려 있고 `service.listSessions()`는
비었으며 a는 `connected`다. 9f34ff94 전에는 같은 순서가 close 3번으로 T를 닫았다. R-PEER-045는 transport가 닫힌 연결은 그것을 붙들지 않는다고
적지만, 그 닫힘은 다른 session의 callback으로만 알려진다. 바뀐 session을 그대로 둔 호출자에게만 생기고 결과가 열린 transport 하나라 낮은
심각도다. R-PEER-055의 바꾸기를 바꾸거나 닫힘을 그 transport의 모든 연결에 알리는 일이라 결정이 필요해 이 버전에서 바꾸지 않는다. 권고:
session이 넘겨받은 transport를 닫을 때(`disconnect()`, `#closeUnlessInUse`) 그 transport를 붙든 것으로 기록된 모든 연결을 끝낸다
(`live = false`로 하고 기록을 비운다). 닫힌 뒤에는 어느 연결도 열린 그 transport를 붙들지 않기 때문이다. 또는 `PeerMcpService.createSession`이 바꾸는
session을 `disconnect()`한다. 위치: `src/client/session.ts:766`, `src/client/session.ts:605`, `src/client/session.ts:622`,
`src/client/session.ts:958`, `src/client/service.ts:45`.

**O-77 (low) connect가 transport를 얻는 동안 온 session을 끝내는 frame은 connect를 끝내지 않아, connect는 `connected`로 끝나고 그 뒤 요청을
보낸다.** `transportFactory`나 넘겨받은 transport의 `connect(callbacks)`가 돌아오기 전에 `onOpen()`, `onMessage({type:'session.revoked'})`,
`onClose({code:1000})`를 부르면, frame은 state를 `error`로 하고 `#ended`를 정하지만 그때는 `ready`를 기다리지 않으므로(`#readyReject`가 없다)
connect를 끝내지 않는다. 1000 close는 state가 `error`라 무시된다. connect는 이어서 `ready`를 기다리고, `onOpen`이 `connectedAt`을 정했으므로
timeout에 진행해 state를 `connected`로 한다. `error`에는 `CLIENT_REVOKED`가 남는다. 다음 요청은 state가 `connected`라 `#ended`를 보지 않고
보내져, `SESSION_REVOKED`(R-PEER-038, R-PEER-045) 대신 `REQUEST_TIMEOUT`으로 끝난다. 그 연결은 frame으로 끝났으므로(2e5a728f 뒤로는
`live = false`) 넘겨받은 transport를 붙들지도 않는다. 이번 수정들 전부터 있었다(b90ab15e와 그 전에도 같다). 내장 WebSocket transport는 socket
event를 만든 뒤에야 알리고 Streamable HTTP transport는 session을 끝내는 frame을 알리지 않으므로 생기지 않고, connect 안에서 동기로 알리는
custom transport에서만 생기므로 낮은 심각도다. connect가 실패하는 길을 하나 더하는 일이라 이 버전에서 바꾸지 않는다. 권고: `#connectImpl`이
`#settleTransport` 뒤와 `#waitForReady` 뒤에, 이 connect 동안 `#ended`가 정해졌거나 그 연결이 끝났으면(`connection.live === false`) 그 오류로
connect를 실패시킨다(`#disconnects` 검사처럼 `#ended`를 던진다). 위치: `src/client/session.ts:860`, `src/client/session.ts:950`,
`src/client/session.ts:668`, `src/client/session.ts:787`, `src/client/session.ts:671`, `src/client/session.ts:1305`.

## 11. 변경 이력

| 날짜 | 변경 | 이유 | 영향 범위 |
|---|---|---|---|
| 2026-10-20 | 최초 작성. `packages/webmcp-peer`의 relay·provider·agent client 코드와 테스트에서 현재 wire 동작을 추출해 요건 R-WS, R-HTTP, R-LIM, R-ROOM, R-SIG, R-CAT, R-MCP, R-ERR, R-PEER로 정리하고, 코드 간 불일치를 O-01~O-60으로 기록했다. | 동작은 확인됐고 스펙 안정화가 필요했다. README·api-index·guide에 흩어진 relay 규칙을 한 정본으로 모은다. | 문서만. 코드·테스트·다른 문서는 바꾸지 않았다. 다른 문서가 이 문서를 링크하도록 바꾸는 일은 후속 작업이다. |
| 2026-10-20 | 공유 protocol 상수와 해석 규칙(O-14, O-15, O-16, O-32, O-52, O-53, O-54, O-55)을 결정대로 구현하고 요건을 고쳤다. protocol 식별자 상수, `Authorization` 해석 하나와 clientToken hash 조회, room id 문법 하나, 공유 catalog 계약, alias 상한, catalog loader의 `cwd`와 SQLite rate-limit 설정, `/config` defaults type, config library의 `descriptorUrl`. 새 요건 R-HTTP-018, R-LIM-042, R-PEER-054. 다른 요건의 `peer-server.ts` 등 근거 줄 번호를 코드에 맞게 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·provider·agent client·config 코드와 테스트, api-index, changeset `webmcp-peer-protocol-c1-foundation`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | 오류 모델(O-02, O-04, O-09, O-11, O-12, O-13, O-56, O-57)을 결정대로 구현하고 요건을 고쳤다. 이름 하나에 code 하나(relay와 provider가 함께 쓰는 `PEER_ERROR_CODES`, 수명주기 body의 `code`, 두 transport가 같은 ticket 오류 data), code는 class이고 식별자는 이름이라는 규칙, 자격 오류의 `_REQUIRED`·`_INVALID`와 401 challenge·body 자격의 400·403, 모든 수명주기 route의 rotate된 room 410과 rotate binding의 `ROOM_BINDING_INVALID`, 잘못된 경로 encoding의 400 `INVALID_PATH`, client revoke 오류 code와 `PeerMcpService` 등록 key. 새 요건 R-HTTP-019, R-ERR-005, R-PEER-055. 바뀐 코드에 맞춰 1~9장의 근거 줄 번호를 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·provider·agent client 코드와 테스트, 새 내부 module `src/config/errors.ts`, api-index, changeset `webmcp-peer-protocol-c2-errors`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | room 만료·rotate 신호와 보존(O-05, O-08, O-47, O-48, O-49)을 결정대로 구현하고 요건을 고쳤다. 만료는 한 번의 만료 처리로 ticket을 `expired`로 끝내고 `room.expired` frame과 두 transport에 같은 `ROOM_EXPIRED`를 보내며, sweep 말고 만료를 먼저 발견한 자리도 같은 처리를 한다. 보존 중인 만료 room은 410 `ROOM_EXPIRED`, lease 만료는 410 `ROOM_LEASE_EXPIRED`, join의 만료 비교는 `<=`, WebSocket agent도 rotate의 대체 room을 받고, rotate된 room은 만료 room과 같은 기한까지 보존한다. 새 요건 R-ROOM-070, R-SIG-023. R-ROOM-067은 새 규칙(만료를 먼저 발견한 자리의 처리)으로 다시 썼다. 바뀐 코드에 맞춰 1~9장의 근거 줄 번호를 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·agent client 코드와 테스트, 라이브 데모 agent, type-registry baseline, changeset `webmcp-peer-protocol-c3-expiry-rotation`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | 승인 수명·reconnect lease·binding·provider 통지(O-06, O-07, O-10, O-17, O-18, O-19, O-50, O-51)를 결정대로 구현하고 요건을 고쳤다. lease는 provider socket이 붙어 있는 동안 만료되지 않고 떠난 뒤 15분 남는다(`reconnectGraceMs`). 승인 요청은 `approvalTimeoutMs`(기본 5분)를 쓰고, 만료는 provider에도 `approval.expired`로 알리며 이른 timer는 다시 건다. body의 `roomId`·`roomEpoch`는 모든 상태 변경 route에서 선택이고 자격 뒤에 검사한다. HTTP 결정 echo, revoke의 `session.revoked`가 provider에 가고 provider는 relay의 승인을 받아들이며 거절된 결정을 되돌린다. 단일 revoke가 그 ticket의 HTTP 진행 요청도 끝낸다. 시각 필드 표, `approvalExpiresAt`·`ticketExpiresAt`, 고유 `messageId`. revoke 응답과 owner 힌트는 현재 동작을 규범화했다. 새 요건 R-ROOM-071, R-ROOM-072, R-SIG-024, R-SIG-025, R-LIM-043. 바뀐 코드에 맞춰 1~9장의 근거 줄 번호를 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·provider·agent client(문서 주석) 코드와 테스트, 라이브 데모 host, api-index, type-registry baseline, changeset `webmcp-peer-protocol-c4-approval-lease`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | MCP JSON-RPC 라우팅과 client 적합성(O-01, O-03, O-28, O-29, O-30, O-31, O-33, O-34, O-36, O-37, O-39, O-41)을 결정대로 구현하고 요건을 고쳤다. relay와 provider가 함께 쓰는 revision 협상과 discover result의 member, 두 transport의 `id: null`·notification 규칙과 맞출 수 없는 provider 답의 폐기, WebSocket의 relay `ping`과 approved가 아닌 ticket의 공개 discovery, `result._meta`의 catalog stamp(최상위 stamp는 deprecated), 답만 세는 pending 상한, 빈 catalog의 listing, client의 catalogHash 검증과 Streamable HTTP 규칙(`Accept`, `notifications/initialized`, `MCP-Protocol-Version`, `Retry-After`)이다. HTTP status 규칙, transport별 요청 크기, 예약 code는 현재 동작을 규범화했다. 새 요건 R-MCP-045, R-ERR-006. 바뀐 코드에 맞춰 1~9장의 근거 줄 번호를 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·provider·agent client 코드와 테스트, api-index, type-registry baseline, changeset `webmcp-peer-protocol-c5-mcp-routing`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | signaling frame·outbox 순서·register budget·provider 동작(O-20, O-35, O-40, O-43, O-44, O-45, O-58)을 결정대로 구현하고 요건을 고쳤다. relay의 provider→agent allow-list와 offer 경로(answer·release는 offer를 보낸 socket에만), 종료 frame의 outbox 전달과 flush 뒤 close, 결과와 무관한 register 평가 budget과 catalog를 가진 room의 relay listing, provider가 기댈 수 있는 room당 ticket 하나와 provider의 session 검사, auto-reconnect의 write 규칙·lease 상실 시 정지, 양방향 DataChannel framing과 RESULT_TOO_LARGE, offer `requestId` 계약과 socket당 offer 하나. 새 요건 R-WS-037, R-SIG-026, R-LIM-044. 바뀐 코드에 맞춰 1~9장의 근거 줄 번호를 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·provider 코드와 테스트, changeset `webmcp-peer-protocol-c6-signaling`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | WebSocket upgrade·subprotocol·close code·liveness·BOM(O-21, O-22, O-23, O-38, O-42)을 결정대로 구현하고 요건을 고쳤다. 모든 upgrade 거절의 HTTP 응답(`Content-Length`, `Connection: close`, 수명주기 body)과 경로·room·ticket보다 앞선 opening handshake 검사, `webmcp-peer.v1`만 고르는 subprotocol 협상과 400 `SUBPROTOCOL_REQUIRED`, close code의 뜻(1000·1001·1013·4001·4002)과 그것을 읽는 provider auto-reconnect·client `TRANSPORT_CLOSED` details, 세 JSON 입력의 맨 앞 BOM 무시, relay의 30 s ping과 75 s idle timeout이다. 새 요건 R-WS-038, R-WS-039, R-LIM-045, R-LIM-046. 바뀐 코드에 맞춰 1~9장의 근거 줄 번호를 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·codec·provider·agent client 코드와 테스트, api-index, type-registry baseline, changeset `webmcp-peer-protocol-c7-websocket`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | Host·proxy 신뢰, Origin 목록, 기본 room 상한, CORS, HTTP method·cache(O-24, O-25, O-26, O-27, O-46)를 결정대로 구현하고 요건을 고쳤다. loopback relay나 `allowedHosts`를 정한 relay의 `HOST_NOT_ALLOWED`, `trustProxy`가 신뢰하는 proxy에게서만 읽는 `X-Forwarded-*`와 그것으로 정하는 rate-limit 신원, 기본 목록을 대신하는 정한 Origin·host 목록과 하나의 `ORIGIN_NOT_ALLOWED`, 기본 publish rate limit과 `maxRooms`의 `ROOM_CAPACITY_EXCEEDED`, `Access-Control-Expose-Headers`·preflight method·`Vary: Origin`·`Content-Length`, descriptor의 `Vary: Accept`와 route마다의 405 `METHOD_NOT_ALLOWED`, `/health`의 `retainedRooms`다. 새 요건 R-HTTP-020, R-HTTP-021, R-HTTP-022, R-LIM-047. 바뀐 코드에 맞춰 1~9장의 근거 줄 번호를 옮겼다. | 사용자가 열린 문제의 권고안을 채택하고 breaking wire 변경을 0.1.0에서 내기로 했다. | relay·config 코드와 테스트, api-index, type-registry baseline, changeset `webmcp-peer-protocol-c8-http-security`. README·guide·changelog는 후속 문서 단계에서 고친다. |
| 2026-10-20 | 문서 단계(O-59, O-60). 이 문서를 relay protocol의 정본으로 거버넌스에 등록하고(정본 표, `.ai/spec-loader.yaml`, decision log), README·api-index·guide·개념 문서·보안 감사가 wire 규칙을 요약하며 이 문서와 요건 ID를 링크하게 했다. 10장을 결정 기록(결정마다 구현 commit과 changeset)과 남은 열린 문제 O-61~O-68로 바꿨다. 테스트가 없던 요건 대부분과 일부 경우만 다루던 요건에 테스트를 더해 근거 줄에 적었고, 남은 둘(R-HTTP-016, R-HTTP-017)의 이유를 O-60에 적었다. `test/protocol-spec.test.ts`가 요건 ID, 근거 줄, 테스트 제목, 상한·close code·오류 class 표를 코드와 테스트에 맞춰 검사한다. R-PEER-012·R-PEER-016의 두 답이 wire에 나가지 않음을 적고, R-PEER-037·R-PEER-039·R-PEER-047의 version을 `PACKAGE_VERSION`으로 적었다. 바뀐 주석과 JSDoc 위치에 맞춰 근거 줄 번호를 옮겼다. | 결정을 모두 구현한 뒤 문서와 테스트가 코드와 다시 어긋나지 않게 한다. | 이 문서와 다른 문서(README, api-index, guide, 개념·보안 문서, 거버넌스, feature-test matrix, changelog, todo), 테스트, provider 주석, relay의 JSDoc 위치, `PACKAGE_VERSION` 주석, changeset `webmcp-peer-protocol-c9-docs`. wire 동작은 바뀌지 않는다. |
| 2026-10-20 | 문서 단계 뒤 adversarial review가 확인한 결함을 고쳤다(O-61 결정 포함). codec은 소유자가 socket을 멈춘 동안 이미 읽은 read의 frame도 처리하지 않고(새 요건 R-WS-040), 그래서 승인을 기다리는 agent가 한 read에 담은 listing 요청마다 catalog 사본을 relay outbox에 쌓던 길이 막혔다. relay가 가진 catalog는 얼려 모든 listing이 함께 쓴다(R-MCP-042, R-MCP-032). relay 자신의 WebSocket `initialize`는 catalog를 한 번만 담아 message 상한에 들고 넘치는 metadata 답은 `RESULT_TOO_LARGE`다(R-MCP-016, R-MCP-036, R-LIM-017). 다시 쓴 길이로 보낼 수 없는 offer의 `answer`는 `offer.refused` `RESULT_TOO_LARGE`, `release`는 requestId만으로 보낸다(R-SIG-019, R-SIG-026, R-WS-036). Host 검사는 신뢰한 proxy의 host와 함께 요청의 `Host`도 본다(R-HTTP-020, R-HTTP-021). rotate는 publish rate-limit 단위를 쓴다(새 요건 R-ROOM-073, R-ROOM-010, R-ROOM-069, R-ROOM-045, O-61). provider는 session 만료·revoke 뒤 room lease를 지우고 revoke로 auto-reconnect 설정을 바꾸지 않는다(R-PEER-021, R-PEER-025). agent client는 connect마다 새 transport를 쓰고 직전 transport의 늦은 event를 무시하며, 다시 붙으면 안 되는 close와 session을 끝낸 frame 뒤에는 `request()`가 다시 연결하지 않는다(R-PEER-031, R-PEER-045). 바뀐 코드에 맞춰 근거 줄 번호를 옮겼다. | review가 재현한 결함(메모리 DoS, rotate로 room 상한 채우기, 버려지는 relay 답과 offer 결과, loopback relay의 Host 우회, 재접속하지 못하는 session, host 설정을 바꾸는 agent revoke, 되찾을 수 없는 room의 lease)을 고친다. | relay·codec·provider·agent client 코드와 테스트, 라이브 데모 agent, 보안 감사, README, api-index, changelog, todo, type-registry baseline, changeset `webmcp-peer-protocol-c4-approval-lease`·`c5-mcp-routing`·`c6-signaling`·`c7-websocket`·`c8-http-security`. |
| 2026-10-20 | 같은 review가 확인한 문서 결함을 고쳤다. HTTP notification의 202는 relay가 받아들인 것에만 해당한다. relay가 직접 처리하는 method의 notification은 room·ticket·catalog 검사 없이 받아들이고, 그 밖의 notification은 요청처럼 room·ticket·provider 검사를 거쳐 거절되면 그 status다(R-MCP-017, R-MCP-022, R-MCP-045, R-PEER-053, O-29). `/status`·`/health`·`/ping`은 `OPTIONS`를 뺀 모든 method를 받고, `OPTIONS`는 어느 경로에서든 preflight다(R-HTTP-001, R-HTTP-022, R-ROOM-006, O-46). R-LIM-040의 근거에서 DataChannel framing과 무관한 두 테스트를 빼고, register 평가 테스트는 R-LIM-020으로 옮겼다. publish rate limit의 대상에 rotate를 적고(R-LIM-031) O-61에 구현 commit을 적었다. 앞 수정이 바꾼 요건의 근거 줄을 코드와 다시 대조했다. | 요건이 코드보다 넓은 MUST를 적었고, 근거 줄이 요건과 무관한 테스트를 가리켰다. wire 동작은 바뀌지 않는다. | 이 문서, 테스트 `server-mcp-routing`·`server-http-security`, changeset `webmcp-peer-protocol-c5-mcp-routing`·`c7-websocket`. |
| 2026-10-20 | review 수정의 재확인이 찾은 결함을 고쳤다. `disconnect()`가 진행 중일 때 부른 connect·요청이 새 socket을 열면 disconnect가 그 socket을 닫지 않고 놓아 열린 채 남고, session은 `idle`을 돌려준 뒤 `error`로 끝났다. 이제 `disconnect()`는 진행 중인 connect를 `SESSION_DISCONNECTED`로 끝내고, 그동안 부른 connect는 disconnect가 transport를 닫고 `idle`로 한 뒤 시작하며, 그 전에 다시 부른 `disconnect()`가 그것도 끝낸다(R-PEER-045, R-PEER-031). provider는 relay의 `approval.rejected`로 session을 `CLIENT_APPROVAL_DENIED` revoke로 끝내고 lease를 지운다. 거절된 agent가 room의 하나뿐인 invite를 썼기 때문이다(R-PEER-019, R-PEER-021, R-PEER-025, R-SIG-011). provider의 다른 종료 경로도 대조했다. DataChannel 인계 뒤 relay의 ticket은 승인된 채 남아 reload가 `approval.restored`로 되찾고, 4001과 그 밖의 최종 close는 room을 끝내지 않으므로 lease를 둔다. 테스트가 없던 두 수정에 회귀 테스트를 더했다. 닫힘과 connect가 지우는 `connectedAt`·`readySeen`(R-PEER-031)과 라이브 데모 agent가 session status polling으로 room 만료와 승인 요청 만료를 구별하는 길이다. 바뀐 코드에 맞춰 근거 줄 번호를 옮겼다. | 재확인이 재현한 결함(닫히지 않는 socket과 끝 state, 아무도 쓸 수 없는 초대를 보이는 거절된 room)과 테스트 공백을 고친다. | agent client·provider 코드와 테스트, 라이브 데모 server option과 e2e 테스트, README, api-index, changelog, changeset `webmcp-peer-protocol-c4-approval-lease`·`c7-websocket`. |
| 2026-10-21 | 두 번째 재확인이 찾은 결함을 고쳤다. 넘겨받은 `transport`의 callback은 `disconnect()` 뒤에도 session을 대신해, 그 transport가 닫히며 알린 종료 frame이 `idle`로 끝난 session을 끝난 것으로 남겼다. 또 `disconnect()`가 끝낸 connect가 늦게 얻은 transport를 닫아, 그 transport를 다시 쓰는 다음 connect(넘겨받은 `transport`, factory가 다시 돌려준 transport)를 끊었다. 이제 callback은 session이 붙든 연결의 것만 대신하고, `disconnect()`는 진행 중인 connect가 연결하던 넘겨받은 `transport`와 connect가 대신하려던 이전 transport까지 닫으며, 끝난 connect가 늦게 얻은 transport는 session이 그때 붙든 연결이 쓰지 않을 때만 닫는다(R-PEER-031, R-PEER-045). relay는 room이 살아 있는 동안 끝난 ticket(거절, 승인 요청 만료, revoke)을 provider에 알린 frame을 기억해 그 뒤 붙는 provider socket마다 다시 보낸다. 그래서 provider socket이 없는 동안 끝난 ticket도 다시 붙은 provider가 알고 session을 끝내며 lease를 지운다(R-ROOM-053, R-SIG-024, R-PEER-021, R-PEER-025). provider의 다른 종료 경로도 대조했다. rotate·만료된 room은 reclaim이 410으로 거절되어 lease가 지워지고, DataChannel 인계 뒤의 revoke도 이 replay로 알린다. disconnect 수정의 guard마다 그것 없이는 실패하는 회귀 테스트를 더했다. 바뀐 코드에 맞춰 근거 줄 번호를 옮겼다. | 재확인이 재현한 결함(disconnect 뒤 다시 연결하지 않는 session, 다음 connect가 쓰는 transport를 닫는 끝난 connect, provider가 없는 동안 끝난 ticket의 lease)과 테스트 공백을 고친다. | agent client·relay 코드와 테스트, README, api-index, changelog, changeset `webmcp-peer-protocol-c4-approval-lease`·`c7-websocket`. |
| 2026-10-21 | 세 번째 재확인이 찾은 두 결함을 고쳤다. provider socket이 없는 동안 ticket이 끝난 room에 다시 열린 페이지가 reclaim으로 붙으면 `autoReconnectIfSaved()`는 `ready`에서 true로 끝났고, session은 그 뒤 replay frame으로 끝났다(브라우저에서는 message마다 따로 처리하므로 true를 돌려준 뒤에야 끝난다). 이제 relay는 provider용 `ready`에 처음 replay할 끝 frame의 type을 `ticketEnded`로 담고(R-SIG-006, R-ROOM-053, R-SIG-024), provider는 `ready`에서 그 frame을 받은 것처럼 session을 끝내고 lease를 지우며 그 attach를 그 session error로 실패시킨다. 그래서 `autoReconnectIfSaved()`는 끝난 session으로 false를, `connect({reclaimLease:true})`는 그 오류를 돌려준다(R-PEER-004, R-PEER-021, R-PEER-024, R-PEER-025). 또 넘겨받은 `transport`의 callback은 어느 connect의 것이든 그 transport를 붙든 연결을 대신해, `close()`가 끝난 뒤에 오는 close event가 그 transport를 다시 연결한 다음 connect를 끝냈다. 이제 넘겨받은 `transport`도 마지막 connect의 callback만 대신하고, session이 한 번 다는 `onMessage`는 그 transport를 붙든 연결로 보내는 session 수준 dispatcher다(R-PEER-031, R-PEER-045). 오류 표에 provider의 session 종료 error 행을 더했다. 바뀐 코드에 맞춰 근거 줄 번호를 옮겼다. | 재확인이 재현한 결함(이미 끝난 session으로 성공하는 reload의 reconnect, 늦은 close event에 끊기는 다음 connect)을 고친다. 두 결함은 낮은 심각도다. | relay·provider·agent client 코드와 테스트, README, api-index, changelog, changeset `webmcp-peer-protocol-c4-approval-lease`·`c7-websocket`. |
| 2026-10-21 | 세 번째 재확인 수정의 재검토가 찾은 남은 client edge case를 열린 문제 O-69로 기록했다. 넘겨받은 `transport`를 두 번째 session이 다시 쓰면 그 transport의 `onMessage`는 첫 session의 dispatcher로 남는다. | 고친 두 결함은 다시 재현되지 않았고 그 회귀 테스트는 수정 없이는 실패한다. 남은 edge case는 수정 전에도 같았고 낮은 심각도라 이 버전에서 바꾸지 않는다. | 문서만(이 문서의 10.2와 11장, changelog와 todo의 열린 문제 범위). 코드와 테스트는 바꾸지 않았다. |
| 2026-10-21 | 열린 문제 O-62~O-69를 결정하고 구현했다(10.1). relay는 id 없는 WebSocket `tools/call`도 HTTP와 같은 검사(`toolCallRefusal`)로 거르고 거절한 것은 답 없이 버리며(R-MCP-007, R-MCP-020, R-MCP-026, R-MCP-030), provider가 보낸 `notifications/tools/list_changed`를 버리고(R-SIG-004, R-MCP-041, R-CAT-008), room 만료는 아직 끝나지 않은 ticket만 `expired`로 끝낸다(R-ROOM-030, R-ROOM-035, R-ROOM-048, R-ROOM-050). agent client는 relay와 같은 규칙으로 답을 가리고 진행 중인 id의 요청을 `DUPLICATE_REQUEST_ID`로 거절하며(R-PEER-032, R-PEER-035), revoke는 POST 하나만 보내고(R-PEER-046, R-PEER-037), 넘겨받은 transport의 `onMessage`는 그 transport로 마지막에 connect한 session으로 보낸다(R-PEER-031, R-PEER-055). provider는 끝난 연결의 요청과 실행 중에 연결이 끝난 `tools/call`에 답하지 않되 host가 실행한 호출은 run에 기록하고, 아무도 쓰지 않는 −32008 class를 `PEER_ERROR_CODES`에서 뺐다(R-PEER-012, R-PEER-013, R-PEER-016, R-ERR-001). 사용자가 고른 O-66대로 relay가 bearer ticket만 쓰고 OAuth discovery를 제공하지 않는다는 것을 규범으로 적었다(R-HTTP-019, R-PEER-053). 바뀐 코드에 맞춰 근거 줄 번호를 옮겼다. | review가 올린 열린 문제를 이 버전에서 닫는다. 결함마다 그것 없이는 실패하는 회귀 테스트를 더했다. O-66은 wire를 바꾸지 않고 테스트로 고정했다. | relay·provider·agent client 코드와 테스트, `AiRunController.hasAction`(새 public method), README, api-index, 보안 감사, changelog, todo, type-registry baseline, changeset `webmcp-peer-protocol-c10-open-problems`. |
| 2026-10-21 | O-62~O-69 구현의 review가 확인한 agent client 결함 셋과 provider·relay 쪽 결함·테스트 공백을 고쳤다. HTTP transport에서 요청의 timeout이 pending을 지운 뒤에도 그 POST는 이어지는데, 그동안 같은 id로 보낸 요청은 거절되지 않고 첫 요청의 늦은 답을 받았으며 자기 답은 버려졌다. retryable 거절 뒤 backoff를 기다리는 요청은 진행 중으로 세지 않아, 그동안 같은 id로 보낸 요청 때문에 자신의 재시도가 `DUPLICATE_REQUEST_ID`로 거절됐다. 이제 요청은 `request()` 호출이 끝날 때까지(연결·slot·답·재시도 대기와 보내는 중, HTTP POST 전체 포함) 진행 중이고, 그 id는 호출이 처음에 한 번 검사하고 끝날 때 놓는다(R-PEER-032, R-PEER-036, O-64). 또 `disconnect()`가 끝낸 connect가 넘겨받은 `transport`의 connect를 늦게 끝내면 그 `onMessage` dispatcher를 자기 session으로 가져가, 그동안 같은 transport로 connect한 다른 session은 `connected`인 채 아무 frame도 받지 못하고 요청마다 `REQUEST_TIMEOUT`으로 끝났다. 이제 끝난 connect는 dispatcher를 잡지 않는다(R-PEER-031, R-PEER-045, O-69). 같은 review가 확인한 provider·relay 쪽 공백도 메웠다. ledger 조회를 기다리는 동안 연결이 끝난 `tools/call`은 조회가 null이면 host를 부르지 않았지만 그 검사를 지워도 모든 테스트가 통과했고, 조회가 outcome-unknown이나 durable 기록이면 `RECONCILIATION_REQUIRED`나 replay로 답했다(답을 실을 channel이 이미 닫혀 wire에는 나가지 않았다). 이제 조회 직후 generation을 보고, 끝났으면 실행하지도 답하지도 않는다(R-PEER-012, R-PEER-016, O-68). 그 수정은 run을 시작하기 전의 검사를 ledger 분기 안으로 옮겨, ledger 조회가 없는 호출은 요청을 읽은 뒤 provider가 부르는 host adapter의 `getServerInfo`가 연결을 끝내도 host에서 실행됐다(답은 host가 돌아온 뒤의 검사가 막았다). 같은 빈틈은 그 전부터 run을 알리는 `subscribeAiRuns` listener에도 있었다. 새 run을 알릴 때 listener가 연결을 끝내면 `Unknown AI run` 예외의 −32603 `Internal error`를 끝난 연결의 socket에 보내려 했고, 등록한 action을 알릴 때 끝내면 abort된 signal로 host를 불렀다. 이제 run을 시작하기 전에는 언제나, run을 시작한 뒤와 action을 등록한 뒤에도 generation을 보고, 끝났으면 실행하지도 답하지도 run을 남기지도 않는다(R-PEER-012, R-PEER-016, O-68). 답하지 않는 provider의 다른 guard 셋(요청을 읽기 전의 generation 검사, host가 돌려주거나 던진 뒤의 검사)도 지울 수 있었다. 테스트의 fake socket이 이미 닫혀 있어 provider의 readyState 검사가 답을 감췄기 때문이다. 이제 테스트의 relay socket과 DataChannel은 닫힌 뒤에도 provider에게 열린 채 남아 provider가 보내려는 답을 기록하고, 요청을 읽기 전의 검사는 host의 CRDT transport가 연결을 끝내는 경우로 확인한다(R-PEER-012, R-PEER-013). room 만료가 승인 요청이 만료된 session의 `revokedAt`을 덮어쓰지 않는 것도 테스트한다(R-ROOM-035, R-ROOM-048). R-PEER-016과 O-68은 실행 중에 연결이 끝난 호출을 agent가 `PROVIDER_DISCONNECTED`로 안다고 적었지만, relay는 HTTP revoke면 `SESSION_INVALID`, 자신이 수행한 room 만료나 rotate면 `ROOM_EXPIRED`나 `ROOM_ROTATED`로 그 요청을 먼저 끝낸다. 코드와 테스트로 확인해 경우마다의 오류를 적었다(R-PEER-016, O-68). id를 잡는 수정의 재확인이 찾은 agent client 결함도 고쳤다. 요청은 id를 잡은 뒤 connect를 기다리는데, `disconnect()`는 transport를 얻는 중인 connect(아직 돌아오지 않은 `transportFactory`나 넘겨받은 `transport`의 `connect`)를 그것이 돌아온 뒤에야 끝내므로 그 connect를 기다리는 요청도 그때까지 끝나지 않았다(요청의 timeout은 connect 뒤에 시작한다). 그래서 다시 연결한 session에서 그 id의 요청이 `DUPLICATE_REQUEST_ID`로 거절됐고, factory가 돌아오지 않으면 요청과 id 거절이 영영 남았다. 끝나지 않는 요청은 그 전부터였고 id 거절은 id를 잡는 수정이 만들었다. 이제 connect를 기다리는 요청은 slot·재시도 대기처럼 `disconnect()`·transport 오류·close가 바로 같은 오류로 끝내 id를 놓는다(R-PEER-045, R-PEER-032, O-64). connect 자신은 전처럼 transport를 얻은 뒤 끝난다. 바뀐 코드에 맞춰 근거 줄 번호를 옮겼다. | review가 재현한 결함(다른 요청의 답을 받는 HTTP 요청, 자신의 재시도를 거절당하는 요청, 연결된 채 답을 받지 못하는 session)을 고친다. 첫 결함은 중간, 나머지 둘은 낮은 심각도다. 고친 것마다 그것 없이는 실패하는 회귀 테스트를 더했다. 결정한 규칙(진행 중인 id의 거절, 마지막에 connect한 session으로 가는 `onMessage`)은 바꾸지 않았다. provider의 ledger replay는 wire에 영향이 없는 낮은 심각도다. 검사를 옮긴 수정의 회귀와 run listener의 같은 빈틈도 wire에 영향이 없는 낮은 심각도지만, 끝난 연결의 호출을 host가 실행했다. 검사마다 그것 없이는 실패하는 회귀 테스트를 더했다. 테스트가 없던 guard마다 그것을 지우면 실패하는 테스트를 더했고, 테스트가 provider가 보내려 한 답을 직접 본다. connect를 기다리는 요청의 결함(`disconnect()` 뒤에도 끝나지 않는 요청과 다시 연결한 session에서 거절되는 id)은 낮은 심각도이고, 그것 없이는 실패하는 회귀 테스트를 더했다. | agent client·provider 코드와 테스트(`client-pending-limit`, `client-busy-retry`, `client-session`, `provider-tool-call`, `provider-data-channel`, `provider-fakes`, `server-room-lifecycle`), README, api-index, changelog, type-registry baseline, changeset `webmcp-peer-protocol-c10-open-problems`. |
| 2026-10-21 | id를 잡는 수정과 connect를 기다리는 요청 수정의 재확인이 찾은 agent client 결함 셋을 고쳤다. 첫째, `disconnect()` 때 raw가 아닌 transport의 send가 아직 끝나지 않은 요청은 `disconnect()`가 pending을 거절해도 그 send를 기다리며 id를 쥐어, 다시 연결한 session에서 그 id의 요청이 send가 끝날 때까지 `DUPLICATE_REQUEST_ID`로 거절됐다(id를 잡는 수정이 만들었다). 둘째, send가 기록한 뒤 바로 돌아오고 답은 나중에 오는 raw transport에서 timeout된 요청은 `request()`가 끝나 id를 놓았으므로, 같은 id로 보낸 요청이 그 늦은 답을 받았다. id를 잡는 수정은 send가 POST 전체인 내장 HTTP transport에서만 이것을 막았다. 이제 규칙은 transport마다 하나다. 요청은 `request()`부터 그 답이 오거나 그 연결이 끝날 때까지 진행 중이고(timeout 뒤에도, 내장 HTTP transport에서는 POST가 끝날 때까지), 연결이 끝나면(`disconnect()`, transport close·오류, session을 끝내는 frame) 그 연결이 쥔 id를 모두 바로 놓는다. 그때 아직 도는 send는 나중에 끝나도 그 요청을 보내지 않고, 그동안 같은 id로 보낸 요청의 id·pending·slot을 건드리지 않는다(R-PEER-032, R-PEER-045, O-64). 셋째, `disconnect()`가 끝낸 connect가 넘겨받은 `transport`의 `connect`를 늦게 끝내면, 그 session에 붙든 연결이 없다는 이유로 그 transport를 닫았다. 그동안 같은 transport로 connect한 다른 session(`PeerMcpService({transport})`의 connect, `disconnect()`, connect)은 `connected`인 채 요청마다 실패했고, 닫힘이 1000으로 알려지면 `TRANSPORT_CLOSED`로 끝나 다시 연결하지 않았다. 이제 넘겨받은 transport마다 그것을 붙든 연결을 모든 session에 걸쳐 기록하고, 끝난 connect는 붙든 연결이 하나도 없을 때만 닫는다(R-PEER-045, O-69). 같은 재확인이 찾은 provider 결함 둘도 고쳤다. 첫째, 끝난 연결의 요청에 답하지 않는 검사가 요청을 읽기 전과 `tools/call` 안에만 있었다. 그래서 요청을 읽은 뒤 provider가 부르는 host adapter의 `getServerInfo`가 `disconnect()`로 연결을 끝내면 `ping`은 `result:{}`, `initialize`는 전체 result, `tools/list`·`server/discover`는 `CATALOG_UNAVAILABLE`, 모르는 method는 −32601로 끝난 연결에 답했고(DataChannel의 `tools/list`·`server/discover`가 부르는 host의 `listTools`도 같다), 처리기가 던지면 −32603 `Internal error`로 답했다. 연결을 끝낸 뒤 던진 `getServerInfo`, ledger 조회를 기다리는 동안 연결이 끝난 뒤 실패한 조회, host가 돌아온 뒤 step 기록을 알릴 때 `subscribeAiRuns` listener가 연결을 끝내 지운 run을 이어서 완료·실패시키려던 bookkeeping(`Unknown AI run`)이 그랬다. 이제 답을 내는 곳 하나(`answerMcpRpc`)가 처리기가 돌아오거나 던진 뒤 두 channel의 모든 요청에 generation을 보고, 끝났으면 답하지 않는다(예외는 기록한다). 그 앞의 검사는 host code가 돌지 않게 하는 것만 남기고, 답만 막던 `tools/call`의 검사(ledger 조회 직후, host가 돌아오거나 던진 뒤)는 그곳으로 합쳤다(R-PEER-012, R-PEER-016, O-68). 둘째, `subscribeAiRuns` listener가 던지면 그 예외가 `AiRunController`의 알림을 끊고 provider의 bookkeeping까지 올라왔다. run이 `running`이 될 때(action을 등록할 때) 던지면 host를 부르지 않고 −32603으로 답했는데 action은 등록된 채 남아, run을 멈춰도 rollback이 `AI run still has in-flight actions`로 거절되고 run을 내보낼 수도 없었다. host가 durable receipt를 돌려준 뒤 settle을 알릴 때 던지면 step이 기록되지 않고 run이 그 예외로 실패해, 커밋된 쓰기에 −32603으로 답하고 rollback이 그 operation을 되돌리지 못했다. `clear`를 알릴 때 던지면 `disconnect()`가 socket을 닫기 전에 그 예외로 멈췄다. 이제 `AiRunController`는 session listener처럼 listener마다 예외를 버리고(`clear` 포함) 다른 listener에게도 알리며, provider는 host가 실행한 호출의 run 변경마다 run이 아직 있을 때만 다음 변경을 해 listener의 `disconnect()`가 지운 run을 바꾸려다 던지지 않는다(R-PEER-016, O-68). 이 수정들의 재확인이 찾은 agent client 결함 넷도 고쳤다. 첫째, 연결이 끝날 때 id를 바로 놓는 규칙은 다음 연결이 다른 transport를 쓸 때만 맞았다. 넘겨받은 `transport`(또는 factory가 다시 돌려준 transport)에서 `disconnect()` 때 send가 아직 돌던 요청은 다시 연결한 session에서 같은 id로 보낸 요청을 막지 않았고, 그 send가 나중에 다시 연결된 wire에 쓰면 relay가 그것을 `DUPLICATE_REQUEST_ID`로 거절한 답을 두 번째 요청이 받았으며 relay가 아직 세는 slot도 풀었다(id를 잡는 수정 전에는 두 번째 요청이 보내지 않고 거절됐다). 이제 끝난 연결의 아직 도는 send는 다음 연결이 같은 transport를 쓰면, 그 send가 도는 동안과 그 요청이 그 연결에 나간 뒤 답이 올 때까지 그 연결에서 그 id를 진행 중으로 두고 slot 하나를 센다. transport를 얻는 중인 connect를 기다린 요청은 그 connect가 transport를 얻은 뒤 보내기 전에 거절한다. 연결마다 새 transport를 쓰면 전처럼 id를 바로 놓는다(R-PEER-032, R-PEER-035, R-PEER-045, O-64). 둘째, 연결을 끝내지 않는 `{type:'error'}` frame과 transport 오류(`onError`)도 연결의 끝처럼 모든 id와 slot을 놓아, 같은 연결에서 그 id로 보낸 요청이 첫 요청의 늦은 답을 받았다(내장 HTTP transport의 아직 끝나지 않은 POST, send가 비동기인 socket). 이제 둘은 기다리는 요청만 거절하고, 보냈거나 보내는 중인 요청은 timeout된 요청처럼 답이 올 때까지 id와 slot을 쥔다(R-PEER-032, R-PEER-035, R-PEER-038, R-PEER-045, O-64). 셋째와 넷째, connect가 실패했거나 transport가 닫혔거나 session을 끝내는 frame이 온 연결도 다음 connect나 `disconnect()` 전까지 넘겨받은 `transport`를 붙든 것으로 세어, 같은 transport를 받은 다른 session(또는 같은 session)의 `disconnect()`가 끝낸 connect가 늦게 다시 연 transport를 닫지 않았다. 그런 연결을 남긴 session을 버리면(실패한 `PeerMcpService.connect()`의 session) 그 transport는 영영 열린 채였다. 이제 연결은 끝나면 그 transport를 붙들지 않는다(R-PEER-045, O-69). `PeerMcpTransportCallbacks.onError`가 연결을 끝내지 않는 오류라는 것과, 다시 쓰는 transport가 이전 connect의 답을 다음 connect의 callback으로 알리지 않아야 한다는 것을 적었다(R-PEER-031, R-PEER-032). 바뀐 코드에 맞춰 근거 줄 번호를 옮겼다. | 셋 다 scratch 테스트로 재현했다. 둘째는 다른 요청의 답을 받으므로 앞 review의 HTTP 결함과 같은 중간 심각도이고, 첫째는 같은 id를 다시 쓰는 호출자에게만 생기는 낮은 심각도다. 셋째는 낮은 심각도지만 O-69가 지키려던 두 번째 session을 끊는다. 결정한 규칙(진행 중인 id의 거절, 마지막에 connect한 session으로 가는 `onMessage`)은 그대로이고, 결함마다 그것 없이는 실패하는 회귀 테스트를 더했다. provider의 첫째는 답을 실을 channel이 이미 닫혀 wire에 나가지 않는 낮은 심각도지만 R-PEER-012를 어겼고, 검사를 method마다 더하지 않고 답을 내는 곳 하나로 모아 같은 빈틈이 새 method나 host code에서 다시 생기지 않게 했다. 둘째는 host의 listener 하나가 커밋된 쓰기를 실패로 답하고 rollback에서 빠뜨리므로 중간 심각도다. 회귀 테스트는 열린 채 남긴 fake socket과 DataChannel로 provider가 보내려 한 답을 본다. 요청을 읽기 전의 검사는 지워도 테스트가 실패하지 않는다. host code가 연결을 끝내는 길(`disconnect()`, 그것을 부르는 `connect()`·`revokeClient()`)은 모두 승인 상태도 바꾸므로 바로 뒤의 승인 검사가 host adapter를 부르기 전에 거절하고, 그 답은 답의 검사가 막기 때문이다. 그 검사는 끝난 연결을 위해 host code를 부르지 않는다는 규칙을 승인 상태에 기대지 않고 지키는 방어로 남겼다. 재확인의 결함 넷은 scratch 테스트로 재현했다. 첫째는 다른 요청의 답(relay의 거절)을 받으므로 중간 심각도이고 이번 수정이 만든 회귀다. 둘째는 낮은 심각도다. 이 relay는 agent에게 `error` frame을 보내지 않고, 동기 send의 WebSocket에서는 그 전부터 그랬다. 셋째와 넷째는 낮은 심각도지만 2026-10-20에 고친, 열린 채 남는 transport를 다시 만들었다. 결함마다 그것 없이는 실패하는 회귀 테스트를 더했다. HTTP의 `error` frame 경우는 첫째의 규칙도 막으므로, 둘째만 되돌리면 실패하는 테스트는 relay socket의 경우다. 다시 쓰는 transport가 끝난 연결에서 이미 나간 요청(timeout된 raw 요청 등)의 늦은 답을 다음 connect의 callback으로 알리는 경우는 고치지 않았다. 그 send는 이미 끝나 다음 연결에 쓸 수 없고, session은 그 답을 다음 연결의 답과 가를 수 없으며, 그 id를 다음 연결에서도 쥐면 오지 않을 답 때문에 그 연결 내내 거절하게 된다. 그래서 transport가 그렇게 하지 않아야 한다고 적었다. | agent client(`PeerMcpTransportCallbacks.onError` 문서 포함)·provider 코드와 테스트(`client-session`, `client-pending-limit`, `provider-tool-call`, `provider-data-channel`), README, api-index, changelog, type-registry baseline, changeset `webmcp-peer-protocol-c10-open-problems`. |
| 2026-10-21 | O-62~O-69 구현과 그 재확인 수정들의 검증이 재현했지만 마지막 수정(2e5a728f)까지 다루지 않은 것을 마지막 수정 뒤의 코드에서 다시 확인해, 남은 여덟 가지를 열린 문제 O-70~O-77로 기록했다. provider는 답을 막는 검사 뒤 보내기 전에 끝난 연결의 답을 보내려 하고(O-70), run을 알릴 때 던지는 host의 CRDT transport 때문에 커밋된 `tools/call`에 −32603으로 답하며(O-71), R-PEER-013은 `tools/call`의 JSON-RPC 오류를 −32602뿐이라 적어 R-PEER-012·R-PEER-016과 어긋난다(O-72). agent client는 답이 이미 온 늦은 send의 id와 slot을 다시 연결한 연결에 남기고(O-73), 한 session의 늦은 send를 같은 transport를 받은 다른 session에서 세지 않으며(O-74), 끝난 connect가 늦게 다시 연 넘겨받은 transport를 그것을 붙들던 연결의 connect가 실패하거나(O-75) 같은 key로 바뀐 `PeerMcpService` session이 붙든 채 남으면(O-76) 열어 두고, transport를 얻는 동안 온 session을 끝내는 frame으로 connect를 끝내지 않는다(O-77). | 재현마다 scratch 테스트로 다시 확인하고 그 전 commit의 코드로도 돌려 언제부터인지 적었다. 연결을 끝내지 않는 transport 오류 뒤 같은 연결에서 같은 id의 요청이 앞 요청의 늦은 답을 받던 것은 2e5a728f가 고쳐 다시 재현되지 않았으므로 뺐다(R-PEER-032, R-PEER-045). 같은 결함을 두 번 올린 것은 하나로 합쳤다(O-71, O-75). O-73·O-74는 연결을 쓰지 못하게 하거나 다른 요청의 답을 받는 중간 심각도이고 나머지는 낮은 심각도다. O-73, O-75의 두 session 경우, O-76은 이번 수정들이 만들었고 나머지는 그 전부터 있었다. 결정이 필요하거나 방금 정한 규칙을 다시 정하는 일이라 이 버전에서 코드를 바꾸지 않는다. | 문서만(이 문서의 10.2와 11장, changelog와 todo의 열린 문제 범위). 코드와 테스트는 바꾸지 않았다. |
