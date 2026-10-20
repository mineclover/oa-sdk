# WebMCP relay protocol `webmcp-peer/1`

상태: active
최종 검토: 2026-10-20
정본: docs/internal/webmcp-relay-protocol.md
구현 패키지: `packages/webmcp-peer` (relay `src/server`, provider `src/provider`, agent client `src/client`, 공용 상수 `src/config`). 이 문서의 규칙은 모두 이 패키지의 현재 코드와 테스트를 근거로 한다.

이 문서는 WebMCP relay protocol의 단일 정본이다. [README](../../packages/webmcp-peer/README.md),
[api-index](./api-index.md)의 webmcp-peer 절, [relay guide](../guides/webmcp-projection-and-relay-guide.md)는
wire 규칙을 따로 유지하지 않고 이 문서를 링크한다. 이 문서는 코드가 지금 하는 일을 규범으로 옮긴
것이다. 코드끼리 어긋나는 곳은 경우마다 현재 동작을 그대로 적고 10장 열린 문제에 올린다. 열린 문제를
해결하는 변경은 해당 요건과 이 문서를 함께 고친다.

## 1. 범위와 용어

### 1.1 범위

다루는 것: relay와 provider·agent 사이에서 WebSocket(`/p/{roomId}/provider`, `/p/{roomId}/client`)과
HTTP로 오가는 모든 메시지. upgrade와 RFC 6455 framing, close code, backpressure, HTTP body·CORS·cache,
상한, room·session 수명주기 route, signaling frame, tool catalog, MCP JSON-RPC 라우팅, 오류, 그리고 이
규칙을 지키기 위한 provider·agent의 의무.

다루지 않는 것: provider와 agent가 WebRTC DataChannel로 직접 주고받는 frame(relay를 거치지 않는다.
provider 측 framing만 9.1에 요약한다), host adapter·AI run ledger·CommitReceipt의 내부 의미, relay 설정
파일·환경 변수 해석(wire에 드러나는 Origin 허용 목록, publish key, rate limit만 다룬다),
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
- **roomEpoch**: room 세대 번호. 생성 시 1이고, rotate로 만든 대체 room은 이전 값 + 1이다. reclaim,
  approval, revoke, rotate의 binding 검사가 이 값을 비교한다.
- **ticket** (`ClientSessionTicket`): join이 발급하는 client 자격. `clientToken`과 `sessionId`를 가지며
  `status`는 `pending`, `approved`, `rejected`, `revoked`, `expired`, `room-rotated` 중 하나다. 만료 시각은
  발급 시점 room의 `expiresAt`이다. invite가 1회용이므로 room 하나가 발급하는 ticket은 최대 1개다.
- **approval request**: 승인이 필요한 room에서 pending ticket마다 하나 만드는 승인 요청(`requestId`).
- **pending request**: relay가 provider에게 전달하고 답을 기다리는 JSON-RPC 요청(room의 `mcpPending`).

### 1.4 토큰과 식별자

| 이름 | 형식 | 발급 | 제시 방법 |
|---|---|---|---|
| `roomId` (`id`) | `randomBytes(16)` 소문자 hex 32자 | `POST /p`, rotate(대체 room) | URL 경로 `/p/{roomId}/…` |
| `providerToken` | `randomBytes(24)` hex 48자 | `POST /p`, rotate, reclaim(재발급) | provider socket subprotocol `ticket.<token>`, `Authorization: Bearer <token>`(approval, rotate, revoke, session status) |
| `inviteToken` | hex 48자, 1회용 | `POST /p`, rotate | join body `inviteToken`, 초대 URL `#invite=` |
| `reconnectToken` (lease token) | hex 48자. relay는 SHA-256 hex만 비교한다 | `POST /p`, rotate, reclaim(재발급) | reclaim body `leaseToken` |
| `clientToken` | hex 48자 | join | client socket subprotocol `ticket.<token>`, `Authorization: Bearer <token>` |
| `sessionId` | `peer-session-` + hex 32자 | join | frame의 `sessionId`, 경로 `/sessions/:sessionId` |
| approval `requestId` | `approval-` + hex 32자 | 승인 요청 생성 | 경로 `/approval/:requestId`, frame |
| publish key | 운영자 설정 문자열 | relay 설정 | `POST /p`의 `Authorization: Bearer` 또는 `X-Publish-Key` |

비밀 값은 providerToken, inviteToken, reconnectToken, clientToken, publish key다.

### 1.5 프로토콜 식별자

- `webmcp-peer/1`: 이 문서가 규정하는 protocol의 이름. relay control frame의 `protocol` 필드,
  `GET /config`의 `protocol`, config profile의 `protocol` 값이다.
- `webmcp-peer.v1` (`WEBMCP_SUBPROTOCOL`, `src/config/types.ts:1`): WebSocket subprotocol 토큰이며
  `GET /p/:id/mcp`·`GET /mcp/catalog` 응답의 `protocol` 값이다.
- 두 표기는 같은 protocol을 가리킨다(→ O-14).
- MCP revision: relay가 HTTP에서 협상하는 `MCP_INITIALIZE_PROTOCOL_VERSIONS` = `2025-11-25`,
  `2025-06-18`, `2025-03-26`, `2024-11-05`. provider의 `MCP_PROTOCOL_VERSION` = `2026-07-28`
  (`MCP_PROTOCOL_VERSIONS`는 이 값과 앞의 4개). client의 `PROTOCOL_VERSION` = `2025-11-25`.

### 1.6 표기 규칙

- MUST, MUST NOT, SHOULD, MAY는 RFC 2119의 의미다.
- 요건 ID는 `R-<AREA>-<NNN>`이다. AREA는 WS(WebSocket 전송), HTTP(HTTP 전송), LIM(상한),
  ROOM(room·session 수명주기), SIG(signaling frame), CAT(catalog), MCP(JSON-RPC 라우팅), ERR(오류),
  PEER(peer 의무)다. ID는 바뀌지 않고, 폐기한 번호는 재사용하지 않는다.
- 근거 경로는 모두 `packages/webmcp-peer/` 기준이다. 코드는 `src/…:줄`, 테스트는 `test/파일` › `it 제목`
  (소스에 적힌 그대로, `%s`·`${…}` 포함)으로 적는다. 테스트가 없으면 "테스트: 없음"이다.
- 바이트 수는 `JSON.stringify` 결과의 UTF-8 byte 길이(`utf8ByteLength`)다. 시각은 epoch ms
  (`Date.now()`)이고, "ISO"는 `Date#toISOString()` 문자열이다.
- "파기"는 HTTP 응답 없이 TCP socket을 `destroy()`하는 것이다.
- O-NN은 10장의 열린 문제 번호다.

## 2. 전송

### 2.1 WebSocket endpoint와 upgrade

**R-WS-001** relay는 WebSocket upgrade를 `/p/{roomId}/provider`와 `/p/{roomId}/client` 두 경로에서만 MUST
받는다. 두 경로의 `{roomId}`는 `^[a-f0-9]+$`(소문자 hex, 길이 제한 없음)에 맞아야 한다. 그 밖의 경로로 온
upgrade는 `customUpgradeHandler`가 처리하지 않는 한 응답 없이 socket을 MUST 파기한다.\
근거: `src/server/peer-server.ts:2512`, `src/server/peer-server.ts:2513`, `src/server/peer-server.ts:2831`; 테스트: 없음

**R-WS-002** relay는 upgrade를 다음 순서로 MUST 처리한다. 어느 단계에서든 예외가 나면 socket을 파기한다.

1. socket에 `error` listener(파기)를 단다. hook이 기다리는 동안 client가 연결을 reset해도 process가 죽지 않는다.
2. Origin을 검사한다(R-WS-003).
3. `req.url`을 `http://{host}:{port}` 기준 WHATWG URL로 해석한다(R-HTTP-015). 해석되지 않는 target과 IPv6 literal
   host(R-HTTP-016)는 여기서 예외가 되어 socket이 파기된다.
4. `customUpgradeHandler(req, socket, head, url, origin, server)`를 부르고, `true`를 돌려주면 더 하지 않는다.
5. hook이 끝난 뒤 socket이 `destroyed`, `readableEnded`이거나 writable이 아니면 파기하고 아무것도 붙이지 않는다.
6. 경로를 맞춘다(R-WS-001).
7. room을 찾는다(R-WS-004).
8. ticket을 검사한다(R-WS-006, R-WS-007).
9. RFC 6455 handshake를 한다(R-WS-008).

근거: `src/server/peer-server.ts:2490`, `src/server/peer-server.ts:2492`, `src/server/peer-server.ts:2499`, `src/server/peer-server.ts:2500`, `src/server/peer-server.ts:2506`, `src/server/peer-server.ts:2832`, `src/server/peer-server.ts:474`; 테스트: `test/relay-message-limit.test.ts` › `survives a client that resets its connection while a customUpgradeHandler is awaiting`; `test/relay-message-limit.test.ts` › `does not attach a provider socket whose client went away (%s) while a customUpgradeHandler was awaiting`

**R-WS-003** Origin header가 있고 허용 목록(R-HTTP-012)에 없으면 relay는 hook보다 먼저 정확히
`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nOrigin not allowed\r\n`
(Content-Length 없음)을 쓰고 바로 socket을 MUST 파기한다. Origin header가 없는 upgrade는 MUST 허용한다(→ O-25).\
근거: `src/server/peer-server.ts:2492`, `src/server/peer-server.ts:2494`, `src/server/peer-server.ts:2495`, `src/server/server-config.ts:437`; 테스트: 없음

**R-WS-004** 두 endpoint 모두 room이 없거나 `expiresAt <= now`이면 relay는 HTTP status 없이 socket을 MUST
파기한다. rotate는 이전 room의 `expiresAt`을 rotate 시각으로 바꾸므로 rotate된 room도 여기서 거절된다.
upgrade 경로는 만료 sweep을 돌리지 않는다.\
근거: `src/server/peer-server.ts:2518`, `src/server/peer-server.ts:2644`, `src/server/peer-server.ts:2436`; 테스트: 없음

**R-WS-005** provider와 agent는 자격을 `Sec-WebSocket-Protocol`의 `ticket.<token>` 항목으로만 MUST 제시한다.
relay는 header를 `,`로 나누고 각 값을 trim한 뒤 `ticket.`으로 시작하는 첫 항목을 MUST 쓴다. upgrade에서
query string과 `Authorization`은 읽지 않는다.\
근거: `src/server/peer-server.ts:2522`, `src/server/peer-server.ts:2524`, `src/server/peer-server.ts:2648`, `src/server/peer-server.ts:2650`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-WS-006** provider upgrade에서 relay는 ticket을 room의 현재 `providerToken`과 상수 시간으로 MUST 비교한다
(UTF-8 byte 길이가 같을 때만 `timingSafeEqual`). ticket이 없거나 비었거나 다르면 status 없이 파기한다.\
근거: `src/server/peer-server.ts:2525`, `src/server/peer-server.ts:1199`; 테스트: 없음

**R-WS-007** client upgrade에서 relay는 ticket을 room의 `clientTokens` Map에서 MUST 찾는다(상수 시간 비교가
아니다 → O-15). ticket이 없거나, `ticket.expiresAt <= now`이거나, status가 `revoked`, `rejected`, `expired`,
`room-rotated`면 파기한다. `pending`과 `approved` ticket은 MUST 받는다.\
근거: `src/server/peer-server.ts:2651`, `src/server/peer-server.ts:2652`, `src/server/peer-server.ts:1328`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`

**R-WS-008** relay가 upgrade로 다루는 요청은 node:http가 `'upgrade'` event로 넘긴 것뿐이다. node:http는 `Upgrade`
header가 있고 `Connection` header에 `upgrade` token이 있을 때만(llhttp `F_UPGRADE`와 `F_CONNECTION_UPGRADE`) 그렇게 한다.
그렇지 않은 요청(`Connection: close`, `Connection` 없음 등)은 `/p/{roomId}/provider`·`/p/{roomId}/client`로 와도 보통 HTTP
요청으로 R-HTTP-001을 거쳐 404 `{error:'NOT_FOUND'}`를 받고(허용되지 않은 Origin이면 403 `ORIGIN_NOT_ALLOWED`,
`customHttpHandler`가 처리하면 그 응답), socket은 파기되지 않는다. `'upgrade'`로 넘어온 요청의 handshake 검사는 room·ticket
검사 다음에 한다. relay는 `Upgrade`가 `websocket`(대소문자 무시), `Sec-WebSocket-Version`이 정확히 `13`,
`Sec-WebSocket-Key`가 문자열임을 MUST 확인하고, 어기면 `BAD_UPGRADE`로 socket을 파기한다. 400·426 응답도
`Sec-WebSocket-Version` 안내도 보내지 않는다. key 형식, request method, HTTP version은 검사하지 않고, relay 코드는
`Connection` header를 읽지 않는다(→ O-21).\
근거: `src/server/peer-server.ts:461`, `src/server/peer-server.ts:473`, `src/server/peer-server.ts:2482`, `src/server/ws-upgrade.ts:276`, `src/server/ws-upgrade.ts:280`, `src/server/ws-upgrade.ts:281`, `src/server/peer-server.ts:2832`; 테스트: 없음

**R-WS-009** 101 응답은 정확히 `HTTP/1.1 101 Switching Protocols`, `Upgrade: websocket`,
`Connection: Upgrade`, `Sec-WebSocket-Accept: base64(SHA-1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`
줄과 선택적인 `Sec-WebSocket-Protocol` 줄로 MUST 이루어진다. relay는 `Sec-WebSocket-Extensions`를 MUST NOT
보낸다. 따라서 permessage-deflate 같은 extension은 협상되지 않는다.\
근거: `src/server/ws-upgrade.ts:284`, `src/server/ws-upgrade.ts:336`, `src/server/ws-upgrade.ts:337`; 테스트: `test/server-ws-frames.test.ts` › `accepts a single frame of exactly the limit, measured in UTF-8 bytes`

**R-WS-010** relay는 요청한 subprotocol 목록(`,`로 나누고 trim)에 `webmcp-peer.v1`이 있으면 그것을 MUST
고른다. 없고 header가 있으면 첫 값을 그대로 돌려준다. 모르는 값, 빈 문자열, `ticket.<token>` 비밀도
그대로다(→ O-22). header가 없으면 응답에도 넣지 않는다. 그러므로 peer는 `webmcp-peer.v1`을 ticket과 함께
SHOULD 제시한다. 참조 구현 둘 다 `['webmcp-peer.v1', 'ticket.<token>']`을 보낸다.\
근거: `src/server/ws-upgrade.ts:288`, `src/server/ws-upgrade.ts:293`, `src/server/ws-upgrade.ts:296`, `src/provider/peer-client.ts:830`, `src/client/session.ts:339`; 테스트: 없음

**R-WS-011** `upgradeWebSocket`이 불릴 때 socket이 이미 `destroyed`, `readableEnded`(peer가 FIN을 보냄)이거나
writable이 아니면 codec은 101을 MUST NOT 쓰고, socket을 파기하고 head bytes를 버린다. `send`는 즉시
`closed`를 돌려주고, `onClose`는 함수가 돌아간 뒤 microtask에서 정확히 한 번 돈다. 이 socket은 `ready` 전송이
실패하므로 room에 붙지 않는다(R-ROOM-052, R-ROOM-056).\
근거: `src/server/ws-upgrade.ts:332`, `src/server/ws-upgrade.ts:334`, `src/server/ws-upgrade.ts:363`, `src/server/ws-upgrade.ts:631`; 테스트: `test/server-ws-frames.test.ts` › `calls onClose once, after upgradeWebSocket returns, for a socket destroyed before the upgrade (%s)`; `test/server-ws-frames.test.ts` › `calls onClose once and destroys the socket when an upgrade handler that awaits gets one whose client already sent FIN`

**R-WS-012** HTTP parser가 upgrade 요청 뒤까지 읽은 bytes(head)는 이후 socket data보다 먼저 MUST 해석한다.
`upgradeWebSocket`이 돌아간 뒤의 microtask나 첫 `data` event 중 먼저 오는 쪽에서 해석한다. `onText`와
`onClose`는 `upgradeWebSocket`이 돌아가기 전에 MUST NOT 돈다.\
근거: `src/server/ws-upgrade.ts:363`, `src/server/ws-upgrade.ts:604`, `src/server/ws-upgrade.ts:611`, `src/server/ws-upgrade.ts:632`; 테스트: `test/server-ws-frames.test.ts` › `parses head (%s) before a chunk the socket emits in the same tick`; `test/server-ws-frames.test.ts` › `delivers a message in head only after upgradeWebSocket returns, even with no later read`

### 2.2 수신 framing

**R-WS-013** relay는 수신 frame마다 payload를 읽기 전에 header 첫 2 byte로 다음을 이 순서로 MUST 검사한다.
RSV bit가 하나라도 있으면 1002 `RESERVED_BITS`(협상한 extension이 없다). opcode 3-7, 11-15면 1002
`RESERVED_OPCODE`. binary opcode 0x2면 1003 `TEXT_ONLY`(mask 검사보다 먼저이므로 mask 없는 binary도 1003).
MASK bit가 없으면 1002 `UNMASKED_FRAME`. 다음으로 control frame 규칙(R-WS-014). fragmented message가 열려
있는데 text frame이 오면 1002 `INTERLEAVED`. 열린 message 없이 continuation이 오면 1002
`BAD_CONTINUATION`. continuation이 fragment 상한을 넘으면 1009 `FRAGMENT_LIMIT`(R-WS-015). 이 절의 이름(`RESERVED_BITS`,
`FRAME_LIMIT`, `MESSAGE_LIMIT`, `INVALID_UTF8`, `BAD_CLOSE_PAYLOAD` 등)은 codec 내부의 오류 이름이며 wire에 나가지 않는다.
relay가 보내는 close frame은 2-byte status code만 담는다(R-WS-027).\
근거: `src/server/ws-upgrade.ts:464`, `src/server/ws-upgrade.ts:471`, `src/server/ws-upgrade.ts:472`, `src/server/ws-upgrade.ts:473`, `src/server/ws-upgrade.ts:474`, `src/server/ws-upgrade.ts:479`, `src/server/ws-upgrade.ts:481`, `src/server/ws-upgrade.ts:482`, `src/server/ws-upgrade.ts:440`, `src/server/ws-upgrade.ts:600`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1002 on a protocol violation: %s`; `test/server-ws-frames.test.ts` › `closes with 1002 from the header of a frame with reserved opcode %i`; `test/server-ws-frames.test.ts` › `closes with 1003 from a binary frame header alone, without waiting for its payload`

**R-WS-014** control frame(close 0x8, ping 0x9, pong 0xA)은 FIN이 있고 7-bit length 값이 125 이하여야 하며,
아니면 relay는 1002 `BAD_CONTROL_FRAME`으로 MUST 닫는다. 이 검사는 64-bit length 검사보다 먼저이므로 큰 길이를
선언한 ping은 1009가 아니라 1002를 받는다. control frame은 message의 fragment 사이에 올 수 있고, message
byte 수에도 fragment 수에도 MUST NOT 포함된다.\
근거: `src/server/ws-upgrade.ts:145`, `src/server/ws-upgrade.ts:475`, `src/server/ws-upgrade.ts:476`, `src/server/ws-upgrade.ts:501`, `src/server/ws-upgrade.ts:528`; 테스트: `test/server-ws-frames.test.ts` › `assembles a fragmented message of exactly the limit and answers a ping between its fragments`; `test/relay-message-limit.test.ts` › `counts only continuation frames toward a fragmented message, not a ping between them`

**R-WS-015** 수신 message 하나는 첫 frame과 continuation을 합쳐 최대 `MAX_WEBSOCKET_MESSAGE_FRAGMENTS` = 1024
frame이다. relay는 1025번째 frame을 header에서 1009 `FRAGMENT_LIMIT`로 MUST 거절한다. 빈 continuation은 허용하며
메모리를 할당하지 않고 이 상한에만 센다.\
근거: `src/server/ws-upgrade.ts:58`, `src/server/ws-upgrade.ts:482`, `src/server/ws-upgrade.ts:534`; 테스트: `test/server-ws-frames.test.ts` › `refuses the 1-byte fragment past the cap with 1009 from its header`; `test/server-ws-frames.test.ts` › `closes a flood of empty continuation frames with 1009 at the cap instead of buffering it`

**R-WS-016** 수신 message는 단일 frame이든 fragment든 최대 262144 UTF-8 byte(`PEER_RELAY_MAX_MESSAGE_BYTES`)다.
64-bit length가 262144를 넘으면 relay는 masking key가 오기 전, length bytes를 받는 즉시 1009 `FRAME_LIMIT`로
MUST 닫는다(2^53+1, 2^63, 2^64−1 포함). 7-bit length는 최대 125, 16-bit length는 최대 65535이므로 262144를 넘는 단일
frame은 언제나 `FRAME_LIMIT`다. continuation의 length가 이미 조립한 byte와 합쳐 262144를 넘으면 그 header에서 1009
`MESSAGE_LIMIT`로 MUST 닫는다. 첫 frame에는 조립한 byte가 없으므로 `MESSAGE_LIMIT`는 continuation에서만 나온다(코드의
`length > MAX_WEBSOCKET_FRAME_BYTES` 비교는 `FRAME_LIMIT` 검사 뒤라 참이 되지 않는다). 정확히 262144 byte인 message는 MUST
받는다. 최소 길이가 아닌 length 인코딩은 거절하지 않는다.\
근거: `src/server/ws-upgrade.ts:43`, `src/server/ws-upgrade.ts:48`, `src/server/ws-upgrade.ts:494`, `src/server/ws-upgrade.ts:501`, `src/server/ws-upgrade.ts:502`; 테스트: `test/server-ws-frames.test.ts` › `refuses a 64-bit payload length of %s with 1009 from the length alone`; `test/server-ws-frames.test.ts` › `refuses the continuation frame that would take a message over the limit from its header`; `test/relay-message-limit.test.ts` › `accepts a single frame of exactly the limit and refuses one byte more with 1009 from the header alone`

**R-WS-017** relay는 완성된 text message(FIN 시점)를 fatal UTF-8 decoder(RFC 3629)로 MUST 해석한다. 0xFF/0xFE,
인코딩된 UTF-16 surrogate, overlong 형식, 끝에서 잘린 sequence는 1007 `INVALID_UTF8`로 닫는다. 검사는
fragment마다가 아니라 message가 완성될 때 한다. 앞의 U+FEFF BOM은 지우지 않고(`ignoreBOM: true`), 빈 text
message는 `''`로 전달한다(→ O-38).\
근거: `src/server/ws-upgrade.ts:193`, `src/server/ws-upgrade.ts:567`, `src/server/ws-upgrade.ts:571`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1007 for a text message that is not valid UTF-8: %s`; `test/server-ws-frames.test.ts` › `delivers a text message that starts with a byte-order mark unchanged`

**R-WS-018** relay는 header, masking key, payload가 어느 read 경계에서 나뉘어 와도 MUST 조립한다. 참고로 codec이
read 사이에 남기는 것은 진행 중인 frame의 header(최대 14 byte = 2 + 확장 길이 8 + mask 4)와 조립 중인 payload뿐이다.
단일 frame message는 정확히 그 크기의 buffer를, fragmented message는 16384 byte에서 시작해 262144 byte까지
기하급수로 키운 buffer를 쓴다.\
근거: `src/server/ws-upgrade.ts:143`, `src/server/ws-upgrade.ts:148`, `src/server/ws-upgrade.ts:349`, `src/server/ws-upgrade.ts:508`; 테스트: `test/server-ws-frames.test.ts` › `assembles a frame with %s whose header and masking key arrive one byte per read`; `test/server-ws-frames.test.ts` › `assembles a limit-sized frame fed one byte per read in time linear in its size`

**R-WS-019** peer가 close frame을 보내면 relay는 2-byte status만 담은 close frame(reason은 절대 되돌리지 않음)으로
답하고 FIN을 MUST 보낸다. 빈 payload에는 1000, 1-byte payload에는 1002로 답한다. status가 1000-1003, 1007-1014
(client 전용 1010과 1012-1014 포함), 3000-4999이고 reason이 유효한 UTF-8이면 그 status를 그대로 되돌린다. 그 밖의
status(0, 999, 1004, 1005, 1006, 1015, 1016-2999, 5000 이상)나 UTF-8이 아닌 reason에는 1002 `BAD_CLOSE_PAYLOAD`로
답한다(→ O-23).\
근거: `src/server/ws-upgrade.ts:213`, `src/server/ws-upgrade.ts:224`, `src/server/ws-upgrade.ts:226`, `src/server/ws-upgrade.ts:228`, `src/server/ws-upgrade.ts:556`; 테스트: `test/server-ws-frames.test.ts` › `answers a client close frame with 1000, calls onClose once, and send then returns 'closed'`; `test/server-ws-frames.test.ts` › `answers a valid close frame with %s with status %i`; `test/server-ws-frames.test.ts` › `answers a malformed close frame (%s) with 1002`

**R-WS-020** codec은 소유자의 `onText`가 던지면 1011로 socket을 MUST 닫고 이후 frame을 전달하지 않는다. relay의
provider·client `onText` 처리기는 모든 예외를 스스로 삼키므로 relay는 frame 처리 때문에 1011을 보내지 않는다.\
근거: `src/server/ws-upgrade.ts:599`, `src/server/ws-upgrade.ts:600`, `src/server/peer-server.ts:2612`, `src/server/peer-server.ts:2798`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1011 when onText throws, and calls onClose once`

**R-WS-021** relay는 수신 ping마다 같은 payload의 pong으로 MUST 답한다. 단 `writableLength` + pong의 wire byte가
송신 상한(R-WS-024) 안일 때만 보낸다. 들어가지 않는 pong은 socket을 닫지 않고 버리며 stall timer(R-WS-026)를
시작한다. 수신 pong은 무시한다. relay는 스스로 WebSocket ping을 MUST NOT 보내고 idle·liveness timeout도 없다(→ O-42).\
근거: `src/server/ws-upgrade.ts:548`, `src/server/ws-upgrade.ts:552`, `src/server/ws-upgrade.ts:555`; 테스트: `test/server-ws-frames.test.ts` › `drops the pongs that do not fit for a peer that floods pings without reading them, and keeps it open`; `test/server-ws-frames.test.ts` › `drops the pongs a raw client that floods pings without reading cannot take, without closing it`

### 2.3 송신 framing과 close

**R-WS-022** relay가 보내는 frame은 mask가 없고 RSV가 0이며 최소 길이 인코딩(126 미만은 7-bit, 65535 이하는 16-bit,
그 이상은 64-bit)을 MUST 쓴다. 131072 byte 이하 message는 FIN text frame 하나로 보낸다. 더 큰 message는 131072 byte
fragment로 나눠 첫 frame은 text, 나머지는 continuation, 마지막에만 FIN을 둔다. 262144 byte message는 header 10 byte
frame 2개, 모두 262164 wire byte다.\
근거: `src/server/ws-upgrade.ts:74`, `src/server/ws-upgrade.ts:77`, `src/server/ws-upgrade.ts:367`, `src/server/ws-upgrade.ts:409`, `src/server/ws-upgrade.ts:413`; 테스트: `test/server-ws-frames.test.ts` › `returns 'sent' for a 200 KiB message and sends it as 128 KiB fragments the client reassembles`; `test/relay-message-limit.test.ts` › `accepts an announcement of exactly PEER_RELAY_MAX_ANNOUNCEMENT_BYTES and sends it to agents in 128 KiB fragments`

**R-WS-023** `PeerSocket.send(value)`는 `JSON.stringify`로 직렬화하고 다음 중 하나를 MUST 돌려준다. socket이
멈췄거나 파기됐거나 writable이 아니면 `closed`. UTF-8 길이가 262144를 넘으면 `too-large`(보내지 않고 socket은 열어 둔다).
송신 상한에 들어가지 않으면 `busy`(아무것도 queue하거나 할당하지 않는다). 그 밖에는 `sent`. `too-large`와 `busy`는
socket을 MUST NOT 닫는다.\
근거: `src/server/ws-upgrade.ts:14`, `src/server/ws-upgrade.ts:400`, `src/server/ws-upgrade.ts:404`, `src/server/ws-upgrade.ts:407`, `src/server/ws-upgrade.ts:635`; 테스트: `test/server-ws-frames.test.ts` › `returns 'too-large' for a message over the limit without closing the socket; the next message arrives`; `test/server-ws-frames.test.ts` › `returns 'sent' for a message of exactly the limit, which a browser WebSocket receives intact`

**R-WS-024** relay는 `socket.writableLength` + 다음 frame의 wire byte가 `maxOutboundBufferBytes` 이하일 때만 frame
(message 또는 pong)을 MUST queue한다. 기본값은 `MAX_WEBSOCKET_OUTBOUND_BUFFER_BYTES` = 1048576(4 × 262144)이다.
`writableLength`에는 아직 나가지 않은 101 응답 byte도 들어간다. 상한에 정확히 닿는 message는 queue되고, 다음 것은
`busy`다. peer가 읽으면 다시 보낼 수 있고, 앞서 보낸 message는 모두 순서대로 도착한다.\
근거: `src/server/ws-upgrade.ts:102`, `src/server/ws-upgrade.ts:387`, `src/server/ws-upgrade.ts:388`; 테스트: `test/server-ws-frames.test.ts` › `queues a message that fills the queue to exactly the bound; the next one is refused with 'busy', queuing nothing and keeping the socket open`; `test/server-ws-frames.test.ts` › `refuses messages with 'busy' while a raw client is not reading, without closing it; once it reads, it gets every message sent, in order, and the socket works again`

**R-WS-025** relay는 `upgradeWebSocket`을 option 없이 부르므로 close timeout 5000 ms, stall timeout 30000 ms,
송신 상한 1048576 byte를 MUST 쓴다. codec option은 101을 쓰기 전에 검사한다. `closeTimeoutMs`와
`stalledOutboundTimeoutMs`는 [1, 2147483647] 범위의 유한한 수, `maxOutboundBufferBytes`는 262164 이상의 safe
integer여야 하며 아니면 `RangeError`다.\
근거: `src/server/ws-upgrade.ts:152`, `src/server/ws-upgrade.ts:160`, `src/server/ws-upgrade.ts:300`, `src/server/peer-server.ts:2530`, `src/server/peer-server.ts:2657`; 테스트: `test/server-ws-frames.test.ts` › `refuses %s of %s with a RangeError before answering the upgrade`; `test/server-ws-frames.test.ts` › `refuses maxOutboundBufferBytes of %s with a RangeError before answering the upgrade`

**R-WS-026** 처음 거절된 frame(message 또는 pong)이 `stalledOutboundTimeoutMs`(기본
`WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS` = 30000 ms) timer를 MUST 시작한다. 이후 거절은 timer를 다시 시작하지 않는다.
queue된 write가 오류 없이 하나라도 끝나면 timer를 지운다. 그러므로 느리게라도 읽는 peer는 열려 있고, 다음 거절이 새
대기를 시작한다. timer가 끝나면 relay는 1013(Try Again Later)으로 닫는다. 이미 queue된 것과 close frame은 close
timeout 전에 peer가 읽으면 순서대로 나간다. 송신 queue가 가득 찬 것 때문에 생기는 close는 이것뿐이다. relay가
`AgentOutbox`에서 건너뛴 broadcast(R-WS-032)는 codec에 제시되지 않으므로 거절이 아니고 이 timer를 시작하지 않는다(R-WS-035).\
근거: `src/server/ws-upgrade.ts:71`, `src/server/ws-upgrade.ts:112`, `src/server/ws-upgrade.ts:324`, `src/server/ws-upgrade.ts:389`, `src/server/ws-upgrade.ts:392`, `src/server/peer-server.ts:333`, `src/server/peer-server.ts:334`; 테스트: `test/server-ws-frames.test.ts` › `closes a peer that reads nothing for WEBSOCKET_STALLED_OUTBOUND_TIMEOUT_MS after a frame was refused with 1013, calling onClose once`; `test/server-ws-frames.test.ts` › `keeps a peer open that reads part of its full queue within the timeout; the next refused frame starts a new wait`

**R-WS-027** relay가 `close(code)`를 하면 writable일 때 2-byte status만 담은 close frame을 송신 상한을 무시하고(4 byte)
쓰고, 즉시 `socket.end()`(FIN)를 하고, `closeTimeoutMs`(기본 `WEBSOCKET_CLOSE_TIMEOUT_MS` = 5000 ms) 뒤 peer가 끊지
않았으면 socket을 파기하는 timer를 MUST 시작한다. socket은 그 자리에서 멈춘다(`onClose`가 돌고 `send`는 `closed`).
두 번째 close는 아무것도 하지 않고, 멈춘 뒤 들어온 data는 버린다.\
근거: `src/server/ws-upgrade.ts:64`, `src/server/ws-upgrade.ts:436`, `src/server/ws-upgrade.ts:439`, `src/server/ws-upgrade.ts:445`, `src/server/ws-upgrade.ts:448`, `src/server/ws-upgrade.ts:576`; 테스트: `test/server-ws-frames.test.ts` › `returns 'closed' after the relay closes the socket, which calls onClose at once and closes only once`; `test/server-ws-frames.test.ts` › `closes within the close timeout while a provider ignores the relay's close`

**R-WS-028** `PeerSocket.close(code)`는 정수 1000-1003, 1007-1009, 1011-1014, 3000-4999만 MUST 받고 기본값은 1000이다.
1004-1006, 1010, 1015, 2999, 5000, 소수, NaN, Infinity 같은 다른 값은 socket 상태와 무관하게 아무것도 보내지 않고
`RangeError('close code must be an integer from 1000 to 1003, 1007 to 1009, 1011 to 1014 or 3000 to 4999, got <code>')`를
던진다. 단 R-WS-019의 되돌림은 이 검사를 거치지 않으므로 1010도 wire에 나갈 수 있다(→ O-23).\
근거: `src/server/ws-upgrade.ts:219`, `src/server/ws-upgrade.ts:638`, `src/server/ws-upgrade.ts:639`; 테스트: `test/server-ws-frames.test.ts` › `refuses close code %s with a RangeError, sending nothing and leaving the socket open`; `test/server-ws-frames.test.ts` › `sends 1000 (Normal Closure) for close() and close(undefined)`

**R-WS-029** peer가 TCP를 끝내면(`end`, close frame 유무와 무관) relay는 close frame 없이 socket을 멈추고(`onClose`)
MUST 파기한다. node:http upgrade socket은 그러지 않으면 half-open으로 남는다. `error`면 멈추고 파기하며, `close`면
close timer를 지우고 멈춘다. 어느 경우든 `onClose`는 정확히 한 번 돌고 조립 중이던 message는 버린다.\
근거: `src/server/ws-upgrade.ts:423`, `src/server/ws-upgrade.ts:617`, `src/server/ws-upgrade.ts:621`, `src/server/ws-upgrade.ts:625`; 테스트: `test/server-ws-frames.test.ts` › `calls onClose once and destroys the socket when the client ends TCP without a close frame`; `test/server-ws-frames.test.ts` › `returns 'closed' after the client resets the connection without a close frame`

### 2.4 relay가 보내는 close code

| code | relay가 보내는 경우 |
|---|---|
| 1000 | `WebMcpPeerServer.close()`; provider socket 교체·분리(`detachClosedProvider`); room rotate(provider와 client socket); 만료 sweep; 승인 만료(`approval.expired` 뒤); ticket 거절·revoke·rotate(`approval.rejected`·`session.revoked`·`room.rotated` 뒤); ticket당 socket 상한으로 밀려난 socket; room에 붙어 있지 않거나 만료된 socket이 보낸 text frame; `ready` 전송 실패; peer가 보낸 1000·빈 close frame의 되돌림 |
| 1002 | 수신 protocol 위반(R-WS-013, R-WS-014), 잘못된 close payload(R-WS-019) |
| 1003 | binary frame(R-WS-013) |
| 1007 | UTF-8이 아닌 text message(R-WS-017) |
| 1009 | 상한을 넘는 frame·message·fragment 수(R-WS-015, R-WS-016) |
| 1011 | 소유자 `onText` 예외(R-WS-020). relay에서는 실제로 나오지 않는다 |
| 1013 | 송신 queue stall(R-WS-026) |
| peer의 code | peer close frame의 유효한 status 되돌림(R-WS-019) |

**R-WS-030** relay가 먼저 닫는 close는 위 표의 code만 MUST 쓴다. relay는 1008을 보내지 않고, 1013은 stall timer로만
보낸다. relay는 다시 시도할 수 있는 상황(provider 교체, ticket당 socket 상한, provider가 닫히는 중)에도 1000을 쓴다(→ O-23).\
근거: `src/server/peer-server.ts:512`, `src/server/peer-server.ts:771`, `src/server/peer-server.ts:1406`, `src/server/peer-server.ts:1536`, `src/server/peer-server.ts:1619`, `src/server/peer-server.ts:2463`, `src/server/peer-server.ts:2539`, `src/server/peer-server.ts:2627`, `src/server/peer-server.ts:2666`, `src/server/peer-server.ts:2812`, `src/server/peer-server.ts:2820`, `src/server/ws-upgrade.ts:392`; 테스트: `test/relay-message-limit.test.ts` › `closes with 1003 for binary data, 1002 for protocol violations and 1000 for a normal close`; `test/relay-message-limit.test.ts` › `holds at most 4 client sockets per ticket, closing the oldest for a new one`; `test/server-ws-frames.test.ts` › `names 1013 (Try Again Later), the code that sheds a peer it may retry`

### 2.5 backpressure

**R-WS-031** agent가 요청한 frame — 자신의 `mcp` 요청에 대한 provider 답과 relay 오류, `approval.pending`,
`approval.approved`와 그 뒤의 `ready`, `offer.refused` — 은 agent socket마다 둔 `AgentOutbox`로 MUST 보낸다. 이런
frame은 queue가 가득 찼다는 이유로 버려지지 않고 socket을 닫지도 않는다. 첫 `busy`에서 frame은 socket별 FIFO에서
기다리고, relay는 그 agent의 TCP socket 읽기를 멈춘다(`pause`). 가장 오래 기다린 frame을 `drain`과
`AGENT_OUTBOX_RETRY_MS` = 1000 ms마다 다시 보낸다. 그래서 거절이 이어지는 동안 codec의 30 s stall close가 계속
유효하다. 기다리는 frame이 다 나가면 읽기를 재개한다. 이미 기다리는 frame이 있을 때 262144 byte를 넘는 새 frame은
queue하지 않고 `too-large`를 돌려준다. socket이 멈추면 기다리던 frame은 버리고 읽기를 재개한다. 기다리는 frame은
pending 상한(R-MCP-032)에 센다.\
근거: `src/server/peer-server.ts:276`, `src/server/peer-server.ts:314`, `src/server/peer-server.ts:318`, `src/server/peer-server.ts:320`, `src/server/peer-server.ts:339`, `src/server/peer-server.ts:347`, `src/server/peer-server.ts:360`, `src/server/peer-server.ts:738`; 테스트: `test/relay-backpressure.test.ts` › `keeps an agent that falls behind on the replies it asked for, reads nothing more from it meanwhile, and delivers them all in order once it reads`; `test/relay-backpressure.test.ts` › `offers the oldest waiting reply again while the agent reads nothing, so the codec's stall close stays armed`; `test/relay-backpressure.test.ts` › `drops the replies waiting for an agent that goes away, and keeps the room serving`

**R-WS-032** 어떤 agent도 요청하지 않은 frame — catalog announcement, `notifications/tools/list_changed`, broadcast되는
모든 provider frame — 은 UTF-8 길이를 한 번 재고 room의 client socket마다 제시한다. 그 socket의 outbox에 기다리는
frame이 없고 `writableLength` + JSON byte + 20(`MAX_MESSAGE_HEADER_BYTES`)이 786412
(`MAX_UNREQUESTED_QUEUE_BYTES` = 1048576 − 262164) 이하일 때만 relay는 MUST 보낸다. 아니면 그 agent에게만 건너뛰고
socket은 열어 둔다. 남은 공간은 상한 크기의 답 하나를 위한 것이다. 재는 JSON과 건너뛴 frame의 효과는 R-WS-036,
R-WS-035다.\
근거: `src/server/peer-server.ts:258`, `src/server/peer-server.ts:266`, `src/server/peer-server.ts:332`, `src/server/peer-server.ts:334`, `src/server/peer-server.ts:749`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`

**R-WS-036** relay는 broadcast하는 provider frame을 받은 text가 아니라 `JSON.parse`한 값을 `JSON.stringify`로 다시 쓴
JSON으로 MUST 재고 보낸다. 다시 쓴 JSON은 받은 text보다 길 수 있다(예: `1e20`은 `100000000000000000000`이 된다). 그래서
262144 byte 안으로 받은 provider frame이라도 다시 쓴 길이가 262144를 넘으면 socket마다 건너뛰어지거나 `send`가
`too-large`(R-WS-023)를 돌려줘 어떤 agent에게도 가지 않는다. relay는 이것을 provider에게도 agent에게도 알리지 않는다.\
근거: `src/server/peer-server.ts:2542`, `src/server/peer-server.ts:2611`, `src/server/peer-server.ts:751`, `src/server/peer-server.ts:754`, `src/server/peer-server.ts:335`, `src/server/ws-upgrade.ts:404`; 테스트: 없음

**R-WS-035** `AgentOutbox.offer`는 frame을 건너뛸 때 `PeerSocket.send`를 MUST NOT 부른다. 그래서 건너뛴 broadcast는
codec의 거절이 아니고 stall timer(R-WS-026)를 시작하지 않는다. 요청한 frame이 없어 요청하지 않은 frame만 받는 agent가
읽지 않으면, broadcast만으로는 그 queue가 786412 byte를 넘지 않고 relay는 그 socket을 닫지 않은 채 계속 붙여 둔다(→ O-42).\
근거: `src/server/peer-server.ts:333`, `src/server/peer-server.ts:334`, `src/server/peer-server.ts:335`, `src/server/ws-upgrade.ts:387`, `src/server/ws-upgrade.ts:389`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`

**R-WS-033** 다음 agent 방향 frame은 `AgentOutbox`를 거치지 않고 `PeerSocket.send`로 보낸다. 그래서 `busy`면 사라지고,
기다리는 답보다 먼저 나갈 수 있다: client 부착 시의 첫 `ready`, `pong`, `approval.expired`, ticket 종료 시의
`session.revoked`·`room.rotated`·`approval.rejected`. 종료 frame 뒤에는 close가 이어지고 기다리던 frame은 버려진다(→ O-35).\
근거: `src/server/peer-server.ts:2811`, `src/server/peer-server.ts:2671`, `src/server/peer-server.ts:1405`, `src/server/peer-server.ts:1522`; 테스트: 없음

**R-WS-034** relay는 provider socket에 outbox를 두지 않고, provider 방향 frame은 모두 `PeerSocket.send`로 MUST 보낸다.
provider queue가 가득 차도(`busy`) provider를 닫지 않는다. 그 결과는 frame마다 다르다. id가 있는 중계 요청은
PROVIDER_BUSY로 답하고(R-MCP-024, R-MCP-035), offer는 `offer.refused`(PROVIDER_BUSY)로 답한다(R-SIG-018). WebSocket
JSON-RPC notification은 답 없이 버린다(R-MCP-030. HTTP notification은 503 `PROVIDER_BUSY`, R-MCP-022). 승인 요청은 다음
접촉 때 다시 보낸다(R-ROOM-025). 다음 frame은 다시 보내지 않고 사라진다: `pong`, register 거절(`CATALOG_INVALID`·
`CATALOG_TOO_LARGE`), 승인 결정 echo(`approval.approved`·`approval.rejected`), `INVALID_APPROVAL` error frame,
`approval.restored`, rotate 때의 provider용 `room.rotated`(그 뒤 provider socket은 닫힌다).\
근거: `src/server/peer-server.ts:2543`, `src/server/peer-server.ts:2548`, `src/server/peer-server.ts:2766`, `src/server/peer-server.ts:2788`, `src/server/peer-server.ts:2711`, `src/server/peer-server.ts:2112`, `src/server/peer-server.ts:2114`, `src/server/peer-server.ts:1427`, `src/server/peer-server.ts:933`, `src/server/peer-server.ts:2563`, `src/server/peer-server.ts:2576`, `src/server/peer-server.ts:1458`, `src/server/peer-server.ts:2441`, `src/server/peer-server.ts:2463`; 테스트: `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`; `test/server-ws-frames.test.ts` › `answers the agent requests a provider that stops reading cannot take with a retryable PROVIDER_BUSY, and keeps the provider`; `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`

### 2.6 HTTP dispatch와 공통 응답

**R-HTTP-001** relay는 HTTP 요청마다 `req.url`을 해석하고(R-HTTP-015) 만료 room sweep(`cleanupExpiredRooms`,
R-ROOM-049)을 돌린 뒤 다음 순서로 MUST 경로를 맞춘다. WebSocket upgrade는 sweep을 돌리지 않는다. 경로는 정규화된
pathname만 쓰고 query string은 무시한다.

1. 모든 경로의 `OPTIONS`(R-HTTP-010)
2. 허용되지 않은 Origin 거절(R-HTTP-011)
3. method와 무관하게 `/status`, `/health`, `/ping`(R-ROOM-006)
4. `GET /config`(R-ROOM-007)
5. `customHttpHandler`. `true`를 돌려주면 끝
6. `POST /p`, `POST /p/:id/reclaim`
7. `GET /mcp/catalog`, `GET /mcp/catalog/:hash`
8. SSE만 받는 `GET /p/:id/mcp`(405), `DELETE /p/:id/mcp`(405), `GET /p/:id/mcp`, `GET /p/:id/mcp/tools`, `POST /p/:id/mcp`
9. `POST /p/:id/join`, `POST /p/:id/approval/:requestId`, `GET /p/:id/sessions/:sessionId`, `POST /p/:id/session/revoke`·`POST /p/:id/sessions/:sessionId/revoke`, `POST /p/:id/rotate`
10. 그 밖은 404 `{error:'NOT_FOUND'}`. 알려진 경로에 맞지 않는 method(예: `GET /p/:id/join`, `PUT /p/:id/mcp`)도 404다(→ O-46).

근거: `src/server/peer-server.ts:1641`, `src/server/peer-server.ts:1643`, `src/server/peer-server.ts:1644`, `src/server/peer-server.ts:1647`, `src/server/peer-server.ts:1669`, `src/server/peer-server.ts:1675`, `src/server/peer-server.ts:1685`, `src/server/peer-server.ts:1700`, `src/server/peer-server.ts:2482`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`

**R-HTTP-015** relay는 HTTP 요청과 upgrade 모두 `new URL(req.url ?? '/', 'http://{host}:{port}')`(WHATWG URL)의
`pathname`으로 MUST 경로를 맞춘다. 그래서 request-target은 맞추기 전에 정규화된다. dot segment는 지운다
(`/p/abc/../def/join` → `/p/def/join`. `%2e%2e`도 dot segment다). 경로 안의 `\`는 `/`로 읽는다(`/a\..\p` → `/p`. `\`로
시작하는 target은 node:http가 먼저 400으로 거절한다). `//`로 시작하는 target은 첫 segment가 authority로 읽혀 빠진다
(`POST //x/p`는 `POST /p`로 room을 만든다). 해석되지 않는 target(예: `//`)은 예외가 된다. HTTP에서는 이 해석이 sweep,
`OPTIONS`, Origin 검사보다 먼저이므로 그런 요청은 `OPTIONS`이든 허용되지 않은 Origin이든 R-HTTP-003의 500
`PEER_REQUEST_FAILED`(또는 `formatHttpError` 결과)를 받는다. upgrade에서는 Origin 검사 뒤, hook 앞에서 예외가 되어
socket이 파기된다(R-WS-002).\
근거: `src/server/peer-server.ts:1643`, `src/server/peer-server.ts:1644`, `src/server/peer-server.ts:462`, `src/server/peer-server.ts:2499`, `src/server/peer-server.ts:2832`; 테스트: 없음

**R-HTTP-016** 운영자는 relay의 `host`로 IPv6 literal을 MUST NOT 쓴다. IPv4 주소나 hostname만 동작한다. relay는 base
URL을 `http://${host}:${port}`로 대괄호 없이 만들므로, `::`나 `::1` 같은 host에서는 R-HTTP-015의 해석이 언제나
`ERR_INVALID_URL`로 실패한다. 그러면 모든 HTTP 요청이 sweep·`OPTIONS`·Origin 검사 전에 R-HTTP-003의 500
`PEER_REQUEST_FAILED`(또는 `formatHttpError` 결과)를 받고, Origin 검사(R-WS-003)를 지난 모든 upgrade가 파기된다.
대괄호를 쓴 `[::1]`은 URL로는 해석되지만 `server.listen`이 그 이름을 찾지 못해(`ENOTFOUND`) relay가 시작되지 않는다. 같은
대괄호 없는 형식이 `requestOrigin`의 fallback host(R-HTTP-013), preflight `Access-Control-Allow-Origin`의 fallback
(R-HTTP-010), 실효 Origin 목록의 `http://{host}:{port}` 항목(R-HTTP-012)에도 쓰인다. relay는 host 값을 검사하지 않는다.\
근거: `src/server/peer-server.ts:1643`, `src/server/peer-server.ts:2499`, `src/server/peer-server.ts:495`, `src/server/peer-server.ts:589`, `src/server/peer-server.ts:1656`, `src/server/server-config.ts:324`, `src/server/server-config.ts:401`, `src/server/server-config.ts:413`; 테스트: 없음

**R-HTTP-002** 경로의 room id 문법은 route마다 MUST 다음과 같다(→ O-16). reclaim, join, approval, sessions, revoke,
rotate와 WebSocket upgrade는 `[a-f0-9]+`(길이 제한 없음). `/p/:id/mcp`와 `/p/:id/mcp/tools`는 `[A-Za-z0-9_-]{1,128}`.
`/mcp/catalog/:hash`는 `[a-f0-9]{64}`. 문법에 맞지 않는 id는 route에 닿지 않고 404 `NOT_FOUND`를 받는다
(`ROOM_NOT_FOUND`가 아니다).\
근거: `src/server/peer-server.ts:1771`, `src/server/peer-server.ts:1831`, `src/server/peer-server.ts:1858`, `src/server/peer-server.ts:1904`, `src/server/peer-server.ts:2160`, `src/server/peer-server.ts:2243`, `src/server/peer-server.ts:2294`, `src/server/peer-server.ts:2338`, `src/server/peer-server.ts:2401`; 테스트: 없음

**R-HTTP-003** 처리 중 잡히지 않은 예외는 `formatHttpError` hook이 있으면 그 `{status, error, requestId?}`로, 없으면
500 `{error:'PEER_REQUEST_FAILED'}`로 MUST 답한다(Origin이 허용되면 CORS header 포함). header를 이미 보냈으면 response를
파기한다. approval의 `:requestId`와 session status의 `:sessionId`는 다른 검사보다 먼저 `decodeURIComponent`를 거치므로
잘못된 percent-encoding(예: `%E0`)은 바로 500 `PEER_REQUEST_FAILED`가 된다. `POST /p/:id/sessions/:sessionId/revoke`의
`:sessionId`는 room 검사와 body 읽기(R-HTTP-008, R-HTTP-009) 뒤에 decode하므로, 같은 encoding이라도 먼저 404
`ROOM_NOT_FOUND`, 413 `BODY_TOO_LARGE`, 400 `INVALID_JSON_BODY`, 500 `BODY_CONSUMED`를 받을 수 있고 그것을 모두 지나야
500 `PEER_REQUEST_FAILED`가 된다(→ O-57).\
근거: `src/server/peer-server.ts:461`, `src/server/peer-server.ts:463`, `src/server/peer-server.ts:485`, `src/server/peer-server.ts:2246`, `src/server/peer-server.ts:2297`, `src/server/peer-server.ts:2351`, `src/server/peer-server.ts:2354`, `src/server/peer-server.ts:2355`, `src/server/peer-server.ts:2356`; 테스트: 없음

**R-HTTP-017** `formatHttpError` hook은 MUST NOT 던진다. relay는 전역 `.catch` 안에서 hook을 다시 감싸지 않고 부르므로,
hook이 던지면 그 요청에는 아무 응답도 가지 않고 그 rejection은 처리되지 않는다. Node 기본값
(`--unhandled-rejections=throw`)에서는 relay process가 끝난다.\
근거: `src/server/peer-server.ts:462`, `src/server/peer-server.ts:464`, `src/server/peer-server.ts:483`; 테스트: 없음

**R-HTTP-004** JSON 응답(`sendJson`)은 `Content-Type: application/json`과 기본 `Cache-Control: no-store`를 MUST 가진다.
Origin이 허용 목록에 있으면 `Access-Control-Allow-Origin: <Origin>`, `Access-Control-Allow-Headers:` 아래 목록,
`Vary: Origin`을 더한다. route 고유 header(catalog `Cache-Control`, `ETag`, `Vary`, `X-RateLimit-*`, `Retry-After`,
`Allow`)는 이 기본값을 덮어쓴다. 202 응답(`sendAccepted`)은 본문과 `Content-Type`이 없고 같은 기본 header를 가진다.
relay는 `Access-Control-Allow-Credentials`와 `Access-Control-Expose-Headers`를 보내지 않는다(→ O-27). 목록은
`Content-Type, Authorization, X-Requested-With, X-Publish-Key, X-Framebook-Owner, X-Owner-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name`
(`BROWSER_ALLOWED_REQUEST_HEADERS`)이다.\
근거: `src/server/peer-server.ts:380`, `src/server/peer-server.ts:1178`, `src/server/peer-server.ts:1184`, `src/server/peer-server.ts:1189`, `src/server/peer-server.ts:1196`; 테스트: `test/mcp-http-interop.test.ts` › `lets a browser send the MCP request headers through the CORS preflight`; `test/mcp-http-interop.test.ts` › `answers a notification with 202 and an empty body`

**R-HTTP-005** relay는 어떤 POST에서도 `Content-Type`을 검사하지 않고, `Content-Length`로 크기를 미리 판단하지 않는다.
`Accept`는 `GET /p/:id/mcp`에서만 읽는다(R-ROOM-059).\
근거: `src/server/peer-server.ts:647`, `src/server/peer-server.ts:1859`, `src/server/http-body.ts:52`; 테스트: 없음

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
400 `{error:'INVALID_JSON_BODY'}`. `BODY_CONSUMED`: request가 끝났고 header를 안 보냈으면 500 `{error:'BODY_CONSUMED'}`,
아니면 파기. abort: 파기. 비었거나 공백뿐인 body(`String#trim`, U+FEFF도 지운다)는 `{}`다.\
근거: `src/server/peer-server.ts:63`, `src/server/peer-server.ts:1271`, `src/server/peer-server.ts:1287`, `src/server/peer-server.ts:1301`, `src/server/peer-server.ts:1302`, `src/server/peer-server.ts:1308`, `src/server/peer-server.ts:1320`; 테스트: `test/relay-message-limit.test.ts` › `delivers 413 BODY_TOO_LARGE for join bodies over 64 KiB and leaves the connection usable`; `test/relay-message-limit.test.ts` › `revokes no session on an oversized, aborted or malformed body (an empty one would revoke them all)`; `test/relay-message-limit.test.ts` › `answers 500 BODY_CONSUMED instead of acting on a body a customHttpHandler read, and reads one it only paused`

**R-HTTP-009** 상태를 바꾸는 route(reclaim, join, approval, revoke, rotate)는 body를 읽기 전과 다 읽은 뒤 두 번 room
검사를 MUST 한다. 자격 검사의 시점은 route마다 다르다. approval과 rotate는 `Authorization: Bearer`의 providerToken도
body 전과 뒤에 두 번 검사한다. revoke는 body 전에는 room만 보고, providerToken·clientToken은 body를 다 읽고 room을 다시
검사한 뒤 한 번만 본다. join(`inviteToken`)과 reclaim(`leaseToken`)은 자격이 body에 있으므로 body 뒤 room 재검사 다음에
한 번만 검사한다. 어느 경우든 자격 검사는 마지막 room 검사 뒤이므로 body가 오는 사이에 일어난 rotate, reclaim(새
providerToken), 만료가 이긴다.\
근거: `src/server/peer-server.ts:1796`, `src/server/peer-server.ts:1798`, `src/server/peer-server.ts:1800`, `src/server/peer-server.ts:2177`, `src/server/peer-server.ts:2179`, `src/server/peer-server.ts:2180`, `src/server/peer-server.ts:2257`, `src/server/peer-server.ts:2263`, `src/server/peer-server.ts:2265`, `src/server/peer-server.ts:2344`, `src/server/peer-server.ts:2351`, `src/server/peer-server.ts:2355`, `src/server/peer-server.ts:2362`, `src/server/peer-server.ts:2381`, `src/server/peer-server.ts:2415`, `src/server/peer-server.ts:2421`, `src/server/peer-server.ts:2423`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`; `test/relay-message-limit.test.ts` › `refuses a slow approval or rotation signed with a provider token a reclaim replaced meanwhile`

`POST /p/:id/mcp`의 body 규칙은 R-MCP-008, R-MCP-009에 있다.

### 2.8 CORS, Origin, Host

**R-HTTP-010** relay는 모든 경로의 `OPTIONS`에 routing과 hook보다 먼저 MUST 답한다. Origin이 있고 허용되지 않으면
403, `Content-Type: application/json`, `Cache-Control: no-store`, 본문 `{error:'CORS_ORIGIN_DENIED', origin}`이고 CORS
header와 `Vary`는 없다. 아니면 204와 `Access-Control-Allow-Origin: <Origin>`(Origin이 없으면 `http://{host}:{port}`),
`Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS`, `Access-Control-Allow-Headers:` R-HTTP-004의 목록,
`Access-Control-Max-Age: 86400`, `Vary: Origin`이다. `Access-Control-Request-Method`·`-Headers`는 검사하지 않는다(→ O-27).\
근거: `src/server/peer-server.ts:1647`, `src/server/peer-server.ts:1648`, `src/server/peer-server.ts:1653`, `src/server/peer-server.ts:1656`, `src/server/peer-server.ts:1657`; 테스트: `test/mcp-http-interop.test.ts` › `lets a browser send the MCP request headers through the CORS preflight`

**R-HTTP-011** `OPTIONS`가 아닌 요청의 Origin이 있고 허용되지 않으면 relay는 `/health`, `/config`, MCP route를 포함한
모든 route에서 403 `{error:'ORIGIN_NOT_ALLOWED', origin}`으로 MUST 답하고 `Access-Control-Allow-Origin`을 보내지
않는다. Origin header가 없는 요청(브라우저가 아닌 client)은 언제나 허용한다.\
근거: `src/server/peer-server.ts:1669`, `src/server/peer-server.ts:1670`, `src/server/server-config.ts:437`; 테스트: 없음

**R-HTTP-012** `isOriginAllowed`는 다음 경우 MUST 참이다(→ O-25). Origin 없음(빈 값 포함). 목록에 `*`. 목록 항목과
문자열이 정확히 같음. URL hostname이 `localhost`, `127.0.0.1`, `[::1]`(scheme·port 무관, 고정).
`framebook-storyboard.pages.dev`와 그 하위 도메인(고정). `*.suffix` 규칙: hostname이 suffix와 같거나 `.suffix`로 끝남(맨
도메인도 맞는다. scheme·port 무관). `proto://*.domain` 규칙: scheme이 같고 hostname이 domain과 같거나 `.domain`으로 끝남
(맨 도메인도 맞는다. 규칙에 적은 port는 무시). `domain[:port]` 규칙(`://` 없음): hostname이 같고, 규칙에 port가 있으면
Origin URL의 `port`와도 같음. URL의 `port`는 scheme 기본 port(http 80, https 443)이면 `''`이므로 port 규칙은 Origin에
기본이 아닌 port가 적혀 있을 때만 맞는다(`example.com:443`은 `https://example.com`에 맞지 않는다). 해석할 수 없는
Origin(`null` 포함)은 거절한다. 실효 목록은 `http://{host}:{port}`(IPv6 literal host면 쓸 수 없는 문자열이다,
R-HTTP-016), `http://127.0.0.1:{port}`, `http://localhost:{port}`, `DEFAULT_ALLOWED_ORIGINS`(loopback의 4500, 5173 port,
`http://localhost:3000`, `http://127.0.0.1:3000`, `https://framebook-storyboard.pages.dev`), 설정 파일, `ALLOWED_ORIGINS`,
option, CLI의 합집합이므로 넓어지기만 한다.\
근거: `src/server/server-config.ts:33`, `src/server/server-config.ts:400`, `src/server/server-config.ts:401`, `src/server/server-config.ts:436`, `src/server/server-config.ts:437`, `src/server/server-config.ts:445`, `src/server/server-config.ts:449`, `src/server/server-config.ts:461`, `src/server/server-config.ts:463`, `src/server/server-config.ts:464`, `src/server/server-config.ts:468`, `src/server/server-config.ts:470`, `src/server/server-config.ts:473`; 테스트: 없음

**R-HTTP-013** relay는 Host header로 요청을 MUST NOT 거절한다(→ O-24). Host는 descriptor와 `/config`에 넣을 base URL
(`requestOrigin`)을 고를 때만 쓴다. scheme은 `X-Forwarded-Proto`를 그대로, 없으면 TLS socket이면 `https`, 아니면 `http`다.
host는 `X-Forwarded-Host`, 없으면 `Host`, 없으면 `{host}:{port}`이고, `isHostAllowed`가 거절하면 `{host}:{port}`로 바꾼다.
`isHostAllowed`는 Host 없음, `*`, hostname이 loopback 이름(port 무관), `host:port` 또는 host와 같은 규칙, `*.suffix`
(맨 도메인도 맞는다), `domain:port` 규칙, 허용 Origin 중 http(s) 항목의 hostname이면 참이다. 실효 host 목록은 host,
`{host}:{port}`, `DEFAULT_ALLOWED_HOSTS`(`*.pages.dev`, `*.workers.dev`, `*.trycloudflare.com` 포함), 설정 파일,
`ALLOWED_HOSTS`, option, CLI의 합집합이다.\
근거: `src/server/peer-server.ts:585`, `src/server/peer-server.ts:586`, `src/server/peer-server.ts:590`, `src/server/peer-server.ts:591`, `src/server/server-config.ts:45`, `src/server/server-config.ts:411`, `src/server/server-config.ts:484`, `src/server/server-config.ts:527`; 테스트: 없음

### 2.9 조건부 GET

**R-HTTP-014** `GET /p/:id/mcp`, `GET /p/:id/mcp/tools`(200이 될 때), `GET /mcp/catalog[/:hash]`에서 `If-None-Match`
(여러 개면 `,`로 합친다)의 `,` 구분 token 하나를 trim한 값이 ETag와 정확히 같거나 값이 `*`면 relay는 304와 그 route의
cache header, `Content-Length: 0`으로 MUST 답한다. Origin이 허용되면 `Access-Control-Allow-Origin`과
`Access-Control-Allow-Headers`를 더한다. 304에는 `Cache-Control: no-store`가 붙지 않는다. weak validator(`W/"…"`)는
맞지 않는다.\
근거: `src/server/peer-server.ts:1087`, `src/server/peer-server.ts:1089`, `src/server/peer-server.ts:1092`, `src/server/peer-server.ts:1095`, `src/server/peer-server.ts:1100`; 테스트: 없음

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
| R-LIM-009 | `MIN_WEBSOCKET_OUTBOUND_BUFFER_BYTES`, `MAX_TIMER_DELAY_MS` | 262164, 2147483647 ms | `upgradeWebSocket` option | codec API | `RangeError`(relay는 option을 쓰지 않는다) |
| R-LIM-010 | `PEER_RELAY_MAX_REQUEST_BYTES` | 261120 (262144 − 1024) | agent JSON-RPC 요청: WS는 받은 text와 `JSON.stringify(frame)` 둘 다, HTTP는 body와 `JSON.stringify(rpc)` 둘 다; `offer` frame | relay, agent client(보내기 전) | `REQUEST_TOO_LARGE` −32600 `{limitBytes:261120}`(HTTP 413). WS notification은 버림. offer는 `offer.refused`. client는 `PeerMcpError` |
| R-LIM-011 | MCP POST drain 상한 | 4177920 (16 × 261120) | `POST /p/:id/mcp` body | relay | request 파기, 응답 없음 |
| R-LIM-012 | `PEER_RELAY_MAX_REQUEST_ID_BYTES` (`MAX_RPC_ID_BYTES`) | 1024 | 문자열 JSON-RPC id와 offer `requestId`의 JSON text(따옴표 포함). 숫자 id는 대상 아님 | relay, agent client(raw가 아닌 transport) | `REQUEST_ID_TOO_LARGE` −32600 `{limitBytes:1024}`, id null 또는 requestId 없음. HTTP 400 |
| R-LIM-013 | `PEER_RELAY_MAX_PENDING_REQUESTS` (`MAX_PENDING_REQUESTS_PER_SOCKET`) | 64 | agent WebSocket 하나: provider를 기다리는 요청 + outbox에서 기다리는 frame | relay, agent client(raw가 아닌 transport) | relay: `TOO_MANY_PENDING_REQUESTS` −32087 `{limit:64}`. client: FIFO 대기 |
| R-LIM-014 | `MAX_CLIENT_SOCKETS_PER_TICKET` | 4 | client ticket 하나의 WebSocket 수 | relay | 가장 오래된 socket을 1000으로 닫고 그 pending 요청을 답 없이 버림 |
| R-LIM-015 | invite 1회 사용 | room당 ticket 1개 | `POST /p/:id/join` | relay | 409 `INVITE_TOKEN_CONSUMED` |
| R-LIM-016 | `PEER_RELAY_MAX_CATALOG_BYTES` | 258048 (262144 − 4096) | provider `register` frame(`registerSeq` 포함) | provider | 보내지 않음. session error `CATALOG_TOO_LARGE` |
| R-LIM-017 | `PEER_RELAY_MAX_ANNOUNCEMENT_BYTES` | 260096 (262144 − 2048) | stamp한 catalog announcement(`registerSeq` 제외) | relay | register: error frame `CATALOG_TOO_LARGE`. listing 답: relay catalog로 답하거나 −32603 `CATALOG_TOO_LARGE` |
| R-LIM-018 | `MAX_CATALOG_TOOLS` | 128 tool | catalog | relay, agent client | relay `CATALOG_INVALID`, client `INVALID_TOOLS_LIST` |
| R-LIM-019 | `MAX_TOOL_NAME_LENGTH` | 256 UTF-16 code unit | tool `name` | relay, agent client | relay `CATALOG_INVALID`, client `TOOL_NAME_TOO_LONG` |
| R-LIM-020 | `REGISTER_EVALUATION_BURST`, `REGISTER_EVALUATION_INTERVAL_MS` | 8, 1000 ms | room당 아무것도 바꾸지 않는 register 평가 | relay | 다음 평가가 허용될 때까지 대기(거절 아님) |
| R-LIM-021 | `MAX_JSON_BODY_BYTES` | 65536 (drain 1048576) | JSON body route | relay | 413 `BODY_TOO_LARGE`, drain 상한 초과면 파기 |
| R-LIM-041 | node:http 기본값(relay는 바꾸지 않는다) | `maxHeaderSize` 16384 byte, `headersTimeout` 60000 ms, `requestTimeout` 300000 ms, `keepAliveTimeout` 5000 ms | 모든 HTTP 요청과 upgrade 요청의 header 크기, header 수신 시간, body를 포함한 요청 전체 수신 시간(R-HTTP-009의 느린 body 포함), keep-alive 연결의 idle 시간 | node:http | header 초과는 431(upgrade 요청도 같다), 수신 시간 초과는 아직 아무것도 쓰지 않았으면 408을 쓰고 연결 종료, idle 초과는 연결 종료. webmcp-peer/1의 일부가 아니며 배포가 Node 설정(`--max-http-header-size`, `server.headersTimeout` 등)으로 바꿀 수 있다 |
| R-LIM-022 | `MAX_CLIENT_LABEL_CODE_POINTS` | 256 code point | join `clientLabel` | relay | 잘라냄(거절 아님) |
| R-LIM-023 | `MAX_UNREQUESTED_QUEUE_BYTES` | 786412 (+ header 20) | broadcast 시점의 agent queue | relay | 그 agent에게만 건너뜀 |
| R-LIM-024 | `AGENT_OUTBOX_RETRY_MS` | 1000 ms | outbox 재시도 주기 | relay | 해당 없음(주기) |
| R-LIM-025 | `mcpRequestTimeoutMs` | 30000 ms(최소 1000) | 중계 요청, 승인 요청 수명 | relay | `MCP_REQUEST_TIMEOUT` −32001. 승인 요청은 ticket `expired` |
| R-LIM-026 | room TTL | 기본 7200000 ms, `[60000, maxRoomTtlMs]`. `maxRoomTtlMs` 기본 86400000, `[60000, 31536000000]` | `POST /p`, rotate의 `ttlMs` | relay | clamp |
| R-LIM-027 | reconnect lease | `min(expiresAt, 생성·reclaim 시각 + 900000)` | reclaim | relay | 404 `ROOM_EXPIRED` |
| R-LIM-028 | `ROOM_METADATA_RETAIN_MS` | 원래 `expiresAt` + 86400000 | 만료·rotate된 room 보존 | relay | room 삭제(이후 404) |
| R-LIM-029 | rotated 보존 | rotate 시각 + 300000 | rotate된 room | relay | 효과 없음(→ O-49) |
| R-LIM-030 | `roomSweepIntervalMs` | 30000 ms(최소 1000, 0이면 timer 없음), HTTP 요청마다 추가 | 만료 room | relay | sweep(R-ROOM-050) |
| R-LIM-031 | publish rate limit | window 60000 ms(설정 시 floor 후 최소 1000), max: publish key가 있으면 30, 없으면 0(무제한), 설정 시 floor(1 미만은 0, 무제한) | `POST /p`, (remote address, 자격 등급)별 | relay | 429 `PUBLISH_RATE_LIMITED`, store 실패 시 503 `PUBLISH_RATE_LIMIT_UNAVAILABLE` |
| R-LIM-032 | `MAX_IN_MEMORY_BUCKETS` | 4096 key | in-memory rate-limit store | relay | 만료 window 정리 후 가장 오래된 window 축출 |
| R-LIM-033 | `PROVIDER_BUSY_RETRY_AFTER_SECONDS` | 1 s | HTTP 503 `PROVIDER_BUSY` | relay | `Retry-After: 1` |
| R-LIM-034 | provider keepalive, ready 대기 | 25000 ms, 10000 ms | provider socket | provider | `{type:'ping'}` 송신; `Signaling connection timeout` |
| R-LIM-035 | provider 재접속 | `min(1000 × 1.5^(n−1), 15000)` ms; reclaim 최대 4회, 100·200·300 ms 대기 | provider | provider | 해당 없음(일정) |
| R-LIM-036 | provider ICE 대기 | 2000 ms | `answer` 전 | provider | 대기를 끝내고 answer 송신 |
| R-LIM-037 | `MAX_PAYLOAD_TEXT_BLOCK_BYTES` | 16384 | CallToolResult text block | provider | 짧은 안내 text로 대체 |
| R-LIM-038 | `MAX_TRACKED_RUNS` | 128 run | provider AI run | provider | `AI_RUN_LIMIT_EXCEEDED` |
| R-LIM-039 | client 시간 | 요청·ready 10000 ms(`DEFAULT_TIMEOUT_MS`), 재시도 100 → 2000 ms, 승인 poll 250 ms(최소 25)·30000 ms, probe 5000 ms(최소 250) | agent client | agent client | `REQUEST_TIMEOUT`, `TRANSPORT_TIMEOUT`, `APPROVAL_TIMEOUT`, probe 실패 |
| R-LIM-040 | DataChannel framing | 수신 ≤ 512 chunk × 16384 문자, 미완성 frame ≤ 51; 송신 chunk 2048 UTF-16 unit | provider DataChannel(relay 밖) | provider | 범위를 벗어난 chunk 무시. 새 id의 chunk가 올 때 미완성 frame이 50개를 넘으면(51개) 미완성 전부 폐기 |

### 3.1 상한별 근거

- **R-LIM-001** 근거: `src/config/limits.ts:17`, `src/server/ws-upgrade.ts:43`, `src/server/ws-upgrade.ts:404`, `src/server/ws-upgrade.ts:494`, `src/server/ws-upgrade.ts:501`, `src/provider/tool-call.ts:47`, `src/provider/peer-client.ts:105`; 테스트: `test/server-ws-frames.test.ts` › `uses one 256 KiB limit for single frames and assembled messages`; `test/client-request-limit.test.ts` › `is one 256 KiB limit exported from the config tier and the package root, equal to the relay's limits`
- **R-LIM-002** 근거: `src/server/ws-upgrade.ts:48`, `src/server/ws-upgrade.ts:494`; 테스트: `test/server-ws-frames.test.ts` › `refuses a single frame of limit + 1 bytes with 1009 from its header, without waiting for the payload`
- **R-LIM-003** 근거: `src/server/ws-upgrade.ts:58`, `src/server/ws-upgrade.ts:482`; 테스트: `test/server-ws-frames.test.ts` › `caps a message at 1024 frames, far more than the two the relay itself sends for the largest message`
- **R-LIM-004** 근거: `src/server/ws-upgrade.ts:145`, `src/server/ws-upgrade.ts:476`; 테스트: `test/server-ws-frames.test.ts` › `closes with 1002 on a protocol violation: %s`
- **R-LIM-005** 근거: `src/server/ws-upgrade.ts:74`, `src/server/ws-upgrade.ts:409`, `src/server/ws-upgrade.ts:413`; 테스트: `test/server-ws-frames.test.ts` › `returns 'sent' for a 200 KiB message and sends it as 128 KiB fragments the client reassembles`; `test/relay-message-limit.test.ts` › `accepts an announcement of exactly PEER_RELAY_MAX_ANNOUNCEMENT_BYTES and sends it to agents in 128 KiB fragments`
- **R-LIM-006** 근거: `src/server/ws-upgrade.ts:102`, `src/server/ws-upgrade.ts:388`, `src/server/ws-upgrade.ts:552`; 테스트: `test/server-ws-frames.test.ts` › `bounds the queue at four messages of the full limit, and waits 30 seconds for a peer that stops reading a full one`
- **R-LIM-007** 근거: `src/server/ws-upgrade.ts:112`, `src/server/ws-upgrade.ts:390`; 테스트: `test/server-ws-frames.test.ts` › `keeps a peer open that drains its full queue within stalledOutboundTimeoutMs`
- **R-LIM-008** 근거: `src/server/ws-upgrade.ts:64`, `src/server/ws-upgrade.ts:448`; 테스트: `test/server-ws-frames.test.ts` › `keeps a closed socket for the longest valid close timeout, and destroys it after the shortest`
- **R-LIM-009** 근거: `src/server/ws-upgrade.ts:118`, `src/server/ws-upgrade.ts:141`, `src/server/ws-upgrade.ts:154`, `src/server/ws-upgrade.ts:162`; 테스트: `test/server-ws-frames.test.ts` › `keeps a stalled socket open for the longest valid stalledOutboundTimeoutMs, and closes it after the shortest`
- **R-LIM-010** 근거: `src/config/limits.ts:28`, `src/server/peer-server.ts:214`, `src/server/peer-server.ts:1937`, `src/server/peer-server.ts:1963`, `src/server/peer-server.ts:2678`, `src/server/peer-server.ts:2786`, `src/client/transport.ts:51`; 테스트: `test/relay-message-limit.test.ts` › `applies the request limit to a request as the relay re-serializes it, over HTTP and WebSocket`; `test/client-request-limit.test.ts` › `has a request limit 1 KiB under the message limit, exported from the config tier and the package root`
- **R-LIM-011** 근거: `src/server/http-body.ts:31`, `src/server/peer-server.ts:1942`; 테스트: `test/relay-message-limit.test.ts` › `drains an oversized body up to 16x the limit so its 413 arrives, and cuts off a larger one without hanging`
- **R-LIM-012** 근거: `src/config/limits.ts:55`, `src/server/peer-server.ts:73`, `src/server/peer-server.ts:220`, `src/client/transport.ts:67`; 테스트: `test/relay-message-limit.test.ts` › `refuses a request id over 1 KiB of JSON without echoing or forwarding it, over WebSocket and HTTP`; `test/client-pending-limit.test.ts` › `is refused before it is sent when its id is over 1 KiB of JSON, which the relay would answer with id null`
- **R-LIM-013** 근거: `src/config/limits.ts:65`, `src/server/peer-server.ts:79`, `src/server/peer-server.ts:715`, `src/server/peer-server.ts:2740`, `src/client/session.ts:613`; 테스트: `test/relay-message-limit.test.ts` › `lets an agent socket have at most 64 requests waiting for the provider`; `test/client-pending-limit.test.ts` › `is the relay's limit of 64, exported from the config tier and the package root`
- **R-LIM-014** 근거: `src/server/peer-server.ts:86`, `src/server/peer-server.ts:2817`, `src/server/peer-server.ts:2823`; 테스트: `test/relay-message-limit.test.ts` › `holds at most 4 client sockets per ticket, closing the oldest for a new one`
- **R-LIM-015** 근거: `src/server/peer-server.ts:2185`, `src/server/peer-server.ts:2203`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`
- **R-LIM-016** 근거: `src/config/limits.ts:36`, `src/provider/peer-client.ts:318`; 테스트: `test/provider-register-limit.test.ts` › `is the message limit less 4 KiB, exported from the config tier and the package root`; `test/provider-register-limit.test.ts` › `sends a register frame of exactly the catalog limit and withholds one a byte larger`
- **R-LIM-017** 근거: `src/config/limits.ts:46`, `src/server/peer-server.ts:850`, `src/server/peer-server.ts:938`, `src/server/peer-server.ts:978`; 테스트: `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`
- **R-LIM-018** 근거: `src/server/deployment-catalog.ts:5`, `src/server/deployment-catalog.ts:71`, `src/client/catalog-hash.ts:70`; 테스트: `test/catalog-contract.test.ts` › `rejects catalogs clients would reject and keeps every tier on the last valid catalog`
- **R-LIM-019** 근거: `src/server/deployment-catalog.ts:61`, `src/server/deployment-catalog.ts:77`, `src/client/catalog-hash.ts:80`; 테스트: `test/catalog-contract.test.ts` › `rejects catalogs clients would reject and keeps every tier on the last valid catalog`
- **R-LIM-020** 근거: `src/server/peer-server.ts:95`, `src/server/peer-server.ts:97`, `src/server/peer-server.ts:903`, `src/server/peer-server.ts:913`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates at most ${BURST} at once and then one a second, always the latest, and still takes a changed catalog`
- **R-LIM-021** 근거: `src/server/peer-server.ts:63`, `src/server/peer-server.ts:1301`, `src/server/http-body.ts:31`; 테스트: `test/relay-message-limit.test.ts` › `delivers 413 BODY_TOO_LARGE for join bodies over 64 KiB and leaves the connection usable`
- **R-LIM-041** 근거: `src/server/peer-server.ts:461`, `src/server/peer-server.ts:383`; 테스트: 없음
- **R-LIM-022** 근거: `src/server/peer-server.ts:130`, `src/server/peer-server.ts:234`, `src/server/peer-server.ts:2209`; 테스트: `test/relay-message-limit.test.ts` › `trims a join's clientLabel and keeps at most its first 256 code points`
- **R-LIM-023** 근거: `src/server/peer-server.ts:258`, `src/server/peer-server.ts:266`, `src/server/peer-server.ts:334`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`
- **R-LIM-024** 근거: `src/server/peer-server.ts:276`, `src/server/peer-server.ts:349`; 테스트: `test/relay-backpressure.test.ts` › `offers the oldest waiting reply again while the agent reads nothing, so the codec's stall close stays armed`
- **R-LIM-025** 근거: `src/server/peer-server.ts:442`, `src/server/peer-server.ts:1391`, `src/server/peer-server.ts:2141`, `src/server/peer-server.ts:2750`; 테스트: 없음
- **R-LIM-026** 근거: `src/server/peer-server.ts:57`, `src/server/peer-server.ts:58`, `src/server/peer-server.ts:60`, `src/server/peer-server.ts:443`, `src/server/peer-server.ts:581`, `src/server/peer-server.ts:1754`, `src/server/peer-server.ts:2429`; 테스트: `test/server-room-lifecycle.test.ts` › `clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable`; `test/server-room-lifecycle.test.ts` › `honours a configured maxRoomTtlMs and advertises it in /config`
- **R-LIM-027** 근거: `src/server/peer-server.ts:561`, `src/server/peer-server.ts:1790`, `src/server/peer-server.ts:1819`; 테스트: 없음
- **R-LIM-028** 근거: `src/server/peer-server.ts:61`, `src/server/peer-server.ts:562`, `src/server/peer-server.ts:1613`, `src/server/peer-server.ts:1637`; 테스트: 없음
- **R-LIM-029** 근거: `src/server/peer-server.ts:2437`, `src/server/peer-server.ts:1613`; 테스트: 없음
- **R-LIM-030** 근거: `src/server/peer-server.ts:454`, `src/server/peer-server.ts:1644`; 테스트: 없음
- **R-LIM-031** 근거: `src/server/server-config.ts:56`, `src/server/server-config.ts:57`, `src/server/server-config.ts:382`, `src/server/server-config.ts:385`, `src/server/server-config.ts:387`, `src/server/peer-server.ts:1242`, `src/server/peer-server.ts:1722`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`
- **R-LIM-032** 근거: `src/server/rate-limit.ts:94`, `src/server/rate-limit.ts:109`; 테스트: `test/server-publish-rate-limit.test.ts` › `bounds the in-memory store and evicts the oldest windows first`
- **R-LIM-033** 근거: `src/server/peer-server.ts:124`, `src/server/peer-server.ts:792`; 테스트: `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`
- **R-LIM-034** 근거: `src/provider/peer-client.ts:834`, `src/provider/peer-client.ts:1090`; 테스트: 없음
- **R-LIM-035** 근거: `src/provider/peer-client.ts:632`, `src/provider/peer-client.ts:778`, `src/provider/peer-client.ts:796`; 테스트: `test/provider-reconnect.test.ts` › `keeps retrying with growing delays while the relay is down, then reclaims the room`
- **R-LIM-036** 근거: `src/provider/peer-client.ts:995`; 테스트: 없음
- **R-LIM-037** 근거: `src/provider/tool-call.ts:55`, `src/provider/tool-call.ts:150`; 테스트: `test/provider-tool-call.test.ts` › `repeats a payload up to the text budget and points at structuredContent past it`
- **R-LIM-038** 근거: `src/provider/ai-run-controller.ts:72`, `src/provider/peer-client.ts:1465`; 테스트: `test/provider-tool-call.test.ts` › `answers a call immediately when every tracked run has work in flight, then evicts idle runs`
- **R-LIM-039** 근거: `src/client/types.ts:2`, `src/client/session.ts:98`, `src/client/session.ts:100`, `src/client/room-lifecycle.ts:214`, `src/config/probe.ts:77`, `src/config/probe.ts:174`; 테스트: `test/client-busy-retry.test.ts` › `doubles its backoff up to 2 s and no further`
- **R-LIM-040** 근거: `src/provider/wire-schemas.ts:25`, `src/provider/wire-schemas.ts:27`, `src/provider/wire-schemas.ts:46`, `src/provider/wire-schemas.ts:52`, `src/provider/peer-client.ts:1218`, `src/provider/peer-client.ts:1219`, `src/provider/peer-client.ts:1221`, `src/provider/peer-client.ts:1553`; 테스트: 없음

## 4. room·session 수명주기

### 4.1 공통 규칙

**R-ROOM-001** relay는 식별자와 토큰을 1.4의 형식으로 MUST 만든다. roomId는 `randomBytes(16)` hex,
providerToken·inviteToken·reconnectToken·clientToken은 `randomBytes(24)` hex, sessionId는
`peer-session-` + `randomBytes(16)` hex, 승인 requestId는 `approval-` + `randomBytes(16)` hex다.\
근거: `src/server/peer-server.ts:540`, `src/server/peer-server.ts:541`, `src/server/peer-server.ts:543`, `src/server/peer-server.ts:1381`, `src/server/peer-server.ts:2204`, `src/server/peer-server.ts:2205`; 테스트: 없음

**R-ROOM-002** room의 `expiresAt`은 `now + min(maxRoomTtlMs, max(60000, ttlMs))`로 MUST 정한다. `POST /p`와 rotate는
body의 `ttlMs`가 없거나 수가 아니거나 유한하지 않으면(JSON 넘침 `1e400`이 만드는 Infinity 포함) 7200000으로 바꾼 뒤 이
clamp를 적용한다(R-ROOM-012, R-ROOM-043). 그러므로 `{"ttlMs":1e400}`은 2시간 room이다. `clampRoomTtl` 자체는 유한하지 않은
값을 60000으로 보지만 wire 입력은 거기에 닿지 않는다. `maxRoomTtlMs`는 option으로만 정하며(CLI·env·설정 파일 없음) 기본
86400000이고 `[60000, 31536000000]`으로 clamp하며, 유한하지 않으면 기본값이다. 이 clamp는 `POST /p`, rotate, `/config`의
`defaults.roomTtlMs`에 쓴다.\
근거: `src/server/peer-server.ts:57`, `src/server/peer-server.ts:443`, `src/server/peer-server.ts:544`, `src/server/peer-server.ts:581`, `src/server/peer-server.ts:582`, `src/server/peer-server.ts:1754`, `src/server/peer-server.ts:2429`; 테스트: `test/server-room-lifecycle.test.ts` › `clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable`

**R-ROOM-003** `roomState`는 다음처럼 MUST 바뀐다. 생성 시 `provisioned`. provider 부착 시 ticket이 없으면
`provider-connected`, 있으면 `accepting-clients`. join은 `provisioned`·`provider-connected`를 `accepting-clients`로
바꾸고 그 밖은 둔다. 승인과 승인 replay는 `active`. reclaim은 ticket이 있으면 `accepting-clients`, 없으면
`provisioned`. rotate는 `rotating`을 거쳐 같은 동기 구간에서 `rotated`. sweep과 ticket 해석 중 만료 발견은
`expired`(rotated는 유지). provider 연결 해제는 상태를 바꾸지 않는다. descriptor와 MCP `_meta`가 보고하는
`mcpRoomState`는 room이 없으면 `unknown`, `rotatedTo`가 있으면 `rotated`, `expiresAt <= now`이거나 상태가
`expired`면 `expired`, 아니면 `roomState`다. `POST /p`, reclaim, rotate 응답의 `state`는 `roomState` 그대로다.
`rotating`은 wire에서 보이지 않는다(→ O-47).\
근거: `src/server/types.ts:60`, `src/server/peer-server.ts:548`, `src/server/peer-server.ts:1108`, `src/server/peer-server.ts:1332`, `src/server/peer-server.ts:1506`, `src/server/peer-server.ts:1558`, `src/server/peer-server.ts:1616`, `src/server/peer-server.ts:1821`, `src/server/peer-server.ts:2221`, `src/server/peer-server.ts:2431`, `src/server/peer-server.ts:2438`, `src/server/peer-server.ts:2635`; 테스트: `test/server-provider-reattach.test.ts` › `restores an approved ticket to the new socket with an approval.restored frame`

**R-ROOM-004** 비밀 값은 `POST /p`, reclaim, rotate 응답(providerToken, inviteToken, reconnectToken)과 join 응답
(clientToken)에만 MUST 실린다. 예외가 하나 있다. peer가 `webmcp-peer.v1`을 제시하지 않고 첫 subprotocol이
`ticket.<token>`이면 101 응답의 `Sec-WebSocket-Protocol`이 그 providerToken이나 clientToken을 그대로 되돌린다(R-WS-010,
→ O-22). 참조 구현은 `webmcp-peer.v1`을 함께 보내므로 이 경우가 없다. `GET /config`, `GET /p/:id/mcp`,
`GET /p/:id/mcp/tools`, `GET /mcp/catalog`, session status 응답에는 비밀 값이 없다.\
근거: `src/server/peer-server.ts:595`, `src/server/peer-server.ts:1687`, `src/server/peer-server.ts:1878`, `src/server/peer-server.ts:2226`, `src/server/peer-server.ts:2322`, `src/server/ws-upgrade.ts:293`, `src/server/ws-upgrade.ts:296`; 테스트: 없음

**R-ROOM-005** room 하나는 client ticket을 최대 1개 MUST 발급한다. invite는 처음 성공한 join에서 소비되고,
새 invite는 rotate로만 생긴다(R-ROOM-021, R-ROOM-043). provider의 승인 상태 모델은 이 불변식에 기댄다(→ O-43).\
근거: `src/server/peer-server.ts:2185`, `src/server/peer-server.ts:2203`, `src/server/peer-server.ts:1484`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`

### 4.2 `/status`, `/health`, `/ping`

**R-ROOM-006** relay는 세 경로 모두 HTTP method와 무관하게 200 `{status:'healthy', activeRooms, uptimeSec}`로
MUST 답한다. `activeRooms`는 보존 중인 rotate·만료 room을 포함한 `rooms.size`, `uptimeSec`는 `process.uptime()`이다.
Origin 검사 뒤, `customHttpHandler` 앞에서 처리하므로 hook이 덮어쓸 수 없다(→ O-46).\
근거: `src/server/peer-server.ts:1675`, `src/server/peer-server.ts:1676`, `src/server/peer-server.ts:1678`, `src/server/peer-server.ts:1679`; 테스트: `test/relay-message-limit.test.ts` › `survives a client that resets its connection while a customUpgradeHandler is awaiting`; `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

### 4.3 `GET /config`

**R-ROOM-007** `GET /config`(GET만)는 200과 `{type:'framebook.peer.config', version:1, serverUrl,
protocol:'webmcp-peer/1', mcpEndpointTemplate:'<serverUrl>/p/{roomId}/mcp',
clientEndpointTemplate:'<serverUrl의 앞 http를 ws로>/p/{roomId}/client', roomEndpoint:'<serverUrl>/p',
defaults:{approvalRequired:true, roomTtlMs: clamp(7200000), maxRoomTtlMs}}`를 MUST 돌려준다. `serverUrl`은
`requestOrigin`(R-HTTP-013)이다. GET이 아닌 `/config`는 hook을 거쳐 404다.\
근거: `src/server/peer-server.ts:1685`, `src/server/peer-server.ts:1688`, `src/server/peer-server.ts:1693`, `src/server/peer-server.ts:1695`; 테스트: `test/server-room-lifecycle.test.ts` › `honours a configured maxRoomTtlMs and advertises it in /config`

### 4.4 `POST /p` (room 생성)

**R-ROOM-008** `POST /p`는 다음 순서로 MUST 검사한다. 그러므로 실패한 인증도 rate-limit 할당량을 쓰고, bucket이 다
차면 401 대신 429를 받는다.

1. publish rate-limit 단위 하나를 소비한다(store 불가 503, 초과 429; R-ROOM-010).
2. publish key 결과를 적용한다(401; R-ROOM-009).
3. body를 읽는다(413, 400, 500; R-HTTP-008).
4. owner binding(403; R-ROOM-011).
5. capabilities(400; R-ROOM-012).
6. room을 만들고 201로 답한다(R-ROOM-013).

근거: `src/server/peer-server.ts:1707`, `src/server/peer-server.ts:1708`, `src/server/peer-server.ts:1735`, `src/server/peer-server.ts:1739`, `src/server/peer-server.ts:1746`, `src/server/peer-server.ts:1756`, `src/server/peer-server.ts:1766`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`

**R-ROOM-009** publish key가 설정돼 있으면 relay는 token을 MUST 다음처럼 읽는다(→ O-15). `Authorization`(첫 값)이
`/^Bearer\s+/i`(대소문자 무시)에 맞으면 그 뒤를 trim한 값이고, 이때 `X-Publish-Key`는 읽지 않는다. 그래서 Bearer 값이
틀려도 `X-Publish-Key`로 넘어가지 않는다. 맞지 않으면(`Authorization` 없음, `Basic …`, 값 없는 `Bearer` 등) trim한
`X-Publish-Key`다. 그러므로 `Authorization: Basic …`과 유효한 `X-Publish-Key`를 함께 보내면 받아들인다. token의 SHA-256
hex를 설정 key의 SHA-256 hex와 상수 시간으로 비교한다. 빈 token은 401 `{error:'PUBLISH_KEY_REQUIRED'}`, 다른 token은 401
`{error:'PUBLISH_KEY_INVALID'}`다. publish key가 없으면 모든 `POST /p`를 허용한다.\
근거: `src/server/peer-server.ts:439`, `src/server/peer-server.ts:1206`, `src/server/peer-server.ts:1209`, `src/server/peer-server.ts:1210`, `src/server/peer-server.ts:1212`, `src/server/peer-server.ts:1213`, `src/server/peer-server.ts:1223`, `src/server/peer-server.ts:1228`, `src/server/peer-server.ts:1230`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`

**R-ROOM-010** publish rate limit은 다음을 MUST 따른다.

- bucket key는 `<req.socket.remoteAddress ?? 'unknown'>\u0000<tokenHash>`다. `tokenHash`는 유효한 publish key의 SHA-256
  hex, key가 설정되지 않았으면 `anonymous`, 실패한 시도(없거나 틀린 key)는 모두 `unauthenticated`다. `X-Forwarded-For`는
  보지 않는다(→ O-24).
- `publishRateLimitMax`가 0이면 store를 부르지 않고 모두 허용하며 201에 `X-RateLimit-*`를 붙이지 않는다(설정한 max는
  floor한다, R-ROOM-069). 설정하지 않은 max는 publish key가 있으면 30(`DEFAULT_PUBLISH_RATE_LIMIT_MAX`), 없으면 0이다.
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
- 성공한 201은 max > 0일 때 `X-RateLimit-Limit: <max>`, `X-RateLimit-Remaining: <remaining>`을 가진다.
- store는 option의 `publishRateLimitStore`, 아니면 `publishRateLimitPath`의 File store, 아니면 in-memory store다
  (4096 key 상한, R-LIM-032). SQLite store는 명시적으로 넘길 때만 쓴다(→ O-53).

근거: `src/server/peer-server.ts:1234`, `src/server/peer-server.ts:1238`, `src/server/peer-server.ts:1242`, `src/server/peer-server.ts:1254`, `src/server/peer-server.ts:1709`, `src/server/peer-server.ts:1722`, `src/server/peer-server.ts:1762`, `src/server/peer-server.ts:435`, `src/server/rate-limit.ts:75`, `src/server/rate-limit.ts:101`, `src/server/rate-limit.ts:121`, `src/server/server-config.ts:382`, `src/server/server-config.ts:385`; 테스트: `test/server-publish-rate-limit.test.ts` › `throttles distinct wrong publish keys from one address and keeps the valid key's quota separate`; `test/server-publish-rate-limit.test.ts` › `validates the File store's persisted state`; `test/server-publish-rate-limit.test.ts` › `deletes expired SQLite windows instead of keeping a row per key forever`

**R-ROOM-069** 설정한 `publishRateLimitMax`는 `floor`한 값을 MUST 쓴다(음수나 유한하지 않은 값은 설정 단계에서
`PUBLISH_RATE_LIMIT_MAX_INVALID`로 던진다). 그래서 1 미만의 소수(예: 0.5)는 0이 되고, publish key가 있어도 rate limit이
없다(R-ROOM-010의 0 규칙). `X-RateLimit-Limit`·`X-RateLimit-Remaining`은 201(max > 0일 때), 429, 503에만 붙는다.
rate-limit 단위를 쓴 뒤 401(R-ROOM-009), 413·400·500(R-HTTP-008), 403(R-ROOM-011), 400 `CAPABILITIES_INVALID`
(R-ROOM-012)로 끝난 `POST /p`에는 `X-RateLimit-*`가 없다.\
근거: `src/server/server-config.ts:379`, `src/server/server-config.ts:387`, `src/server/peer-server.ts:1717`, `src/server/peer-server.ts:1730`, `src/server/peer-server.ts:1736`, `src/server/peer-server.ts:1739`, `src/server/peer-server.ts:1749`, `src/server/peer-server.ts:1757`, `src/server/peer-server.ts:1762`; 테스트: 없음

**R-ROOM-011** owner binding: header owner는 `X-Framebook-Owner ?? X-Owner-Id`를 trim한 값이다. `??`는 header가 없을 때만
넘어가므로 빈 `X-Framebook-Owner`도 `X-Owner-Id`를 가린다(그러면 header owner는 없다). 반복 header는 node:http가 `, `로
이어 붙인 한 문자열이고 그대로 비교한다(`X-Framebook-Owner: a`를 두 번 보내면 `a, a`이므로 body owner나 설정 owner `a`와
다르다). body owner는 문자열 `body.ownerId`(trim. 문자열이면 비어 있어도 `owner`를 보지 않는다), 아니면 문자열
`body.owner`(trim)다. 설정 owner는 publish key가 있을 때만 `publishKeyOwner ?? 'publish-key-owner'`다. header owner와 body
owner가 둘 다 있고 다르거나, 설정 owner가 있고 비어 있지 않은 header·body owner가 그와 다르면 relay는 403
`{error:'PUBLISH_OWNER_BINDING_INVALID'}`로 MUST 답한다. room의 `ownerId`는 설정 owner에서만 온다(→ O-51).\
근거: `src/server/peer-server.ts:1741`, `src/server/peer-server.ts:1742`, `src/server/peer-server.ts:1743`, `src/server/peer-server.ts:1744`, `src/server/peer-server.ts:1745`, `src/server/peer-server.ts:1746`, `src/server/peer-server.ts:1749`; 테스트: 없음

**R-ROOM-012** body option은 다음과 같이 MUST 해석한다. `alias`: trim해서 비어 있지 않으면 그 값, 아니면
`wireframe-local`(길이 제한 없음, → O-52). `approvalRequired`: 정확히 `false`일 때만 false. `ttlMs`: 유한한 수면 그 값,
아니면 7200000(그 뒤 R-ROOM-002 clamp). `capabilities`: `undefined`면 `['mcp-control']`, 아니면 비어 있지 않은 배열이고
중복 제거한 원소가 모두 `mcp-control` 또는 `mcp-crdt`여야 하며 아니면 400 `{error:'CAPABILITIES_INVALID'}`.
`mcp-control`이 없으면 앞에 넣고, room의 capabilities는 언제나 `mcp-control`이 맨 앞이다(`createRoomEntry`가 다시 앞에 두고
중복을 지운다). 그 밖의 member(`title` 등)는 무시한다.\
근거: `src/server/peer-server.ts:621`, `src/server/peer-server.ts:1752`, `src/server/peer-server.ts:1753`, `src/server/peer-server.ts:1754`, `src/server/peer-server.ts:1755`, `src/server/peer-server.ts:1757`, `src/server/peer-server.ts:556`; 테스트: 없음

**R-ROOM-013** 성공한 `POST /p`는 201과 room descriptor `{id, roomId(같은 값), roomEpoch:1, providerToken, inviteToken,
reconnectToken, reconnectTokenExpiresAt(epoch ms), descriptorUrl:'<requestOrigin>/p/<id>/mcp', expiresAt(epoch ms),
state:'provisioned', createdAt(ISO), updatedAt(ISO), approvalRequired, capabilities, alias, ownerId?}`로 MUST 답한다.
새 room은 `inviteConsumed: false`, ticket 없음, `reconnectLeaseExpiresAt = min(expiresAt, now + 900000)`,
`metadataRetainUntil = expiresAt + 86400000`이다. deployment catalog에 tool이 있으면 그 사본을 room catalog로 갖고
(`catalogSource: 'deployment'`, deployment의 version과 hash), 없으면 catalog 없이 `catalogVersion: 0`,
`catalogHash = SHA-256('[]')`이다.\
근거: `src/server/peer-server.ts:532`, `src/server/peer-server.ts:555`, `src/server/peer-server.ts:561`, `src/server/peer-server.ts:562`, `src/server/peer-server.ts:566`, `src/server/peer-server.ts:573`, `src/server/peer-server.ts:595`, `src/server/peer-server.ts:1766`; 테스트: 없음

### 4.5 `POST /p/:id/reclaim` (provider lease 회수)

**R-ROOM-014** reclaim은 body를 읽기 전과 뒤에 room을 MUST 검사한다. room이 없거나 map에서 다른 entry로 바뀌었으면
404 `{error:'ROOM_NOT_FOUND'}`. rotate됐으면 410 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch,
replacementRoomId}`. `expiresAt <= now`이거나 `reconnectLeaseExpiresAt <= now`이면 404 `{error:'ROOM_EXPIRED'}`(code
없음)다(→ O-05, O-06).\
근거: `src/server/peer-server.ts:1777`, `src/server/peer-server.ts:1779`, `src/server/peer-server.ts:1783`, `src/server/peer-server.ts:1790`, `src/server/peer-server.ts:1791`, `src/server/peer-server.ts:1798`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`

**R-ROOM-015** reclaim은 `Authorization`을 읽지 않고 `body.leaseToken`을 자격으로 MUST 쓴다. leaseToken은 trim해서
비어 있지 않은 문자열이어야 하고, `body.roomEpoch`(없으면 현재 epoch)는 현재 epoch와 엄격히 같아야 하며, `body.roomId`가
있으면 경로 id와 같아야 한다. 어기면 409 `{error:'ROOM_LEASE_BINDING_INVALID', code:-32002, roomId, roomEpoch}`다.
그다음 `SHA-256(leaseToken)`을 저장한 hash와 상수 시간으로 비교하고 다르면 401 `{error:'ROOM_LEASE_INVALID'}`다.\
근거: `src/server/peer-server.ts:1800`, `src/server/peer-server.ts:1801`, `src/server/peer-server.ts:1802`, `src/server/peer-server.ts:1803`, `src/server/peer-server.ts:1806`, `src/server/peer-server.ts:1808`; 테스트: 없음

**R-ROOM-016** room에 provider socket이 붙어 있으면 409 `{error:'ROOM_PROVIDER_ACTIVE', roomId, roomEpoch}`(code 없음)로
MUST 답한다. relay가 이미 떼어 낸 socket(send가 `closed`를 돌려 분리된 것, 새 socket에 밀린 것, hook 대기 중 client가
떠나 붙지 않은 것)은 reclaim을 막지 않는다.\
근거: `src/server/peer-server.ts:1811`, `src/server/peer-server.ts:1812`, `src/server/peer-server.ts:766`, `src/server/peer-server.ts:2506`; 테스트: `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`; `test/relay-message-limit.test.ts` › `does not attach a provider socket whose client went away (%s) while a customUpgradeHandler was awaiting`

**R-ROOM-017** 성공한 reclaim은 새 providerToken(이전 token은 진행 중인 느린 approval·rotate 요청을 포함해 이후 거절된다),
새 reconnectToken과 hash, `reconnectLeaseExpiresAt = min(expiresAt, now + 900000)`을 MUST 발급하고 `updatedAt`과
`roomState`(R-ROOM-003)를 바꾼다. roomEpoch, inviteToken(이미 소비됐어도), ticket, catalog는 그대로다. 응답은 200
`{...room descriptor, reclaimed:true, reclaimedAt(ISO)}`다.\
근거: `src/server/peer-server.ts:1816`, `src/server/peer-server.ts:1817`, `src/server/peer-server.ts:1819`, `src/server/peer-server.ts:1821`, `src/server/peer-server.ts:1822`; 테스트: `test/relay-message-limit.test.ts` › `refuses a slow approval or rotation signed with a provider token a reclaim replaced meanwhile`; `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`; `test/server-provider-reattach.test.ts` › `keeps an approved agent working after the provider socket drops and the host reclaims the room`

**R-ROOM-018** `reconnectLeaseExpiresAt`은 room 생성과 성공한 reclaim에서만 MUST 정한다. 붙어 있는 provider socket이나
keepalive는 lease를 늘리지 않는다. 그래서 마지막 생성·reclaim 뒤 900000 ms(15분)가 지나 끊긴 provider는 room이 유효해도
reclaim에서 404 `ROOM_EXPIRED`를 받는다(→ O-06).\
근거: `src/server/peer-server.ts:561`, `src/server/peer-server.ts:1790`, `src/server/peer-server.ts:1819`; 테스트: 없음

### 4.6 `POST /p/:id/join`

**R-ROOM-019** join은 body를 읽기 전과 뒤에 room을 MUST 검사한다. `rotatedTo`가 있으면 invite 없이도 먼저 410
`{error:'ROOM_ROTATED', code:-32057, replacementRoomId, roomId, roomEpoch}`. room이 없거나 바뀌었거나
`expiresAt < now`(엄격한 비교, → O-48)면 404 `{error:'ROOM_NOT_FOUND'}`다.\
근거: `src/server/peer-server.ts:2166`, `src/server/peer-server.ts:2167`, `src/server/peer-server.ts:2171`, `src/server/peer-server.ts:2179`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`

**R-ROOM-020** invite token은 trim한 문자열 `body.inviteToken`이다. relay는 다음 순서로 MUST 검사한다. 비었으면 401
`{error:'INVITE_TOKEN_REQUIRED'}`. invite가 이미 소비됐으면 token이 맞는지 보기 전에 409 `{error:'INVITE_TOKEN_CONSUMED'}`.
상수 시간 비교가 다르면 403 `{error:'INVITE_TOKEN_INVALID'}`. capabilities가 R-ROOM-012 규칙에 맞지 않으면 400
`{error:'CAPABILITIES_INVALID'}`. `mcp-crdt`를 요청했는데 room에 없으면 403 `{error:'CRDT_CAPABILITY_NOT_GRANTED'}`(→ O-13).\
근거: `src/server/peer-server.ts:2180`, `src/server/peer-server.ts:2182`, `src/server/peer-server.ts:2185`, `src/server/peer-server.ts:2189`, `src/server/peer-server.ts:2193`, `src/server/peer-server.ts:2198`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`

**R-ROOM-021** invite는 모든 검사를 통과한 join에서만 MUST 소비한다(`inviteConsumed = true`). body 때문에 거절된 join(413,
400, 500 `BODY_CONSUMED`)과 R-ROOM-019·R-ROOM-020에서 거절된 join은 invite를 소비하지 않는다.\
근거: `src/server/peer-server.ts:2203`; 테스트: `test/relay-message-limit.test.ts` › `answers 500 BODY_CONSUMED instead of acting on a body a customHttpHandler read, and reads one it only paused`

**R-ROOM-022** 발급하는 ticket은 `clientToken`, `sessionId`, `issuedAt = now`, `expiresAt = room.expiresAt`, 요청한
capabilities를 MUST 가진다. status는 `approvalRequired`면 `pending`, 아니면 `approved`이고 그때 `approvedAt = issuedAt`이다.
`clientLabel`은 비어 있지 않은 문자열이면 trim한 뒤 앞 256 code point만 남기고(surrogate pair 중간에서 자르지 않고,
자른 뒤 끝 공백도 지운다), 아니면 `MCP client`다. 더 긴 label은 거절하지 않고 자른다. roomState 전이는 R-ROOM-003이며,
그래서 승인 불필요 room은 join으로 `active`가 되지 않는다.\
근거: `src/server/peer-server.ts:130`, `src/server/peer-server.ts:234`, `src/server/peer-server.ts:2204`, `src/server/peer-server.ts:2209`, `src/server/peer-server.ts:2211`, `src/server/peer-server.ts:2221`; 테스트: `test/relay-message-limit.test.ts` › `trims a join's clientLabel and keeps at most its first 256 code points`; `test/server-provider-reattach.test.ts` › `re-sends a pending request and restores no revoked, expired or approval-free ticket`

**R-ROOM-023** join 응답은 201 `{roomId, roomEpoch, clientToken, sessionId, issuedAt(epoch ms), expiresAt(epoch ms),
approvalRequired, capabilities, approvalState:'pending'|'approved', state:'pending-approval'|'approved',
approvalRequestId?}`이다. `approvalRequestId`는 승인 요청을 만들었을 때만 MUST 있다(R-ROOM-024).\
근거: `src/server/peer-server.ts:2224`, `src/server/peer-server.ts:2226`, `src/server/peer-server.ts:2237`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

### 4.7 승인 요청의 수명

**R-ROOM-024** 승인이 필요한 room에서 pending ticket의 승인 요청은 `requestId = 'approval-' + 32 hex`,
`createdAt = now`, `expiresAt = min(room.expiresAt, now + mcpRequestTimeoutMs)`(기본 30000 ms, → O-07),
`clientLabel = ticket.clientLabel || 'MCP client'`로 MUST 만든다. ticket이 room의 `pendingApprovals`에 남아 있는 요청을
가리키면(그 `expiresAt`이 지났어도, R-ROOM-026) 새로 만들지 않고 그 요청을 다시 쓴다. 만드는 시점은 join이고, 이후 접촉에서
요청이 없으면 다시 만든다.\
근거: `src/server/peer-server.ts:1365`, `src/server/peer-server.ts:1367`, `src/server/peer-server.ts:1380`, `src/server/peer-server.ts:1391`, `src/server/peer-server.ts:442`; 테스트: `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`

**R-ROOM-025** relay는 승인 요청을 provider socket마다 최대 한 번 `approval.request`(R-SIG-008)로 MUST 보낸다. `send`가
`sent`일 때만 전달로 기록한다. 받지 못한 요청(provider 없음, `busy`, `too-large`)은 미전달로 남고 ticket 소유자의 다음 접촉
— join, 그 pending ticket bearer로 ticket 해석 단계(R-MCP-007의 6단계)까지 간 `POST /p/:id/mcp`(metadata method 포함),
client socket 부착, client bearer로 한 `GET /p/:id/sessions/:sessionId` — 이나 provider 부착 replay 때 다시 보낸다. 그 앞 단계에서
거절된 POST(body 읽기의 413·500 `BODY_CONSUMED`, 400 `PARSE_ERROR`·`REQUEST_ID_TOO_LARGE`·`INVALID_REQUEST`, 다시 직렬화한 크기의
413, 400 `UNSUPPORTED_PROTOCOL_VERSION`)와 client socket이 보낸 frame(R-SIG-013)은 아무것도 보내지 않는다. `closed`면 provider를
분리한다(`detachClosedProvider`). 새 provider socket은 같은 요청을 다시 한 번 받는다.\
근거: `src/server/peer-server.ts:1423`, `src/server/peer-server.ts:1425`, `src/server/peer-server.ts:1448`, `src/server/peer-server.ts:1449`, `src/server/peer-server.ts:1943`, `src/server/peer-server.ts:1953`, `src/server/peer-server.ts:1958`, `src/server/peer-server.ts:1964`, `src/server/peer-server.ts:1973`, `src/server/peer-server.ts:1985`, `src/server/peer-server.ts:1988`, `src/server/peer-server.ts:2224`, `src/server/peer-server.ts:2320`, `src/server/peer-server.ts:2827`; 테스트: `test/relay-backpressure.test.ts` › `sends a pending approval request the provider could not take on the agent's next call, and only once`; `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`

**R-ROOM-026** relay는 승인 요청을 만들 때 `max(1, expiresAt − Date.now())` ms 뒤에 도는 timer를 하나 건다. timer가 돌 때
요청이 아직 `pendingApprovals`에 있고 `expiresAt <= Date.now()`이면 relay는 요청을 지우고, ticket이 아직 `pending`이면 `expired`
(`revokedAt` 설정, `approvalRequestId` 해제)로 MUST 바꾼다. ticket에 묶인 client socket마다 `approval.expired`(R-SIG-012)를
plain `send`로 보내고 닫고(1000) room에서 뺀다. provider에는 아무것도 보내지 않는다. invite는 소비된 채 남아 rotate 전에는
새 join을 받지 않는다. 이 timer는 provider가 붙어 있지 않아도 돈다. timer가 돌 때 `expiresAt > Date.now()`이면 relay는 아무것도
하지 않고 timer를 다시 걸지 않는다. Node timer는 `Date.now()`가 `expiresAt`에 닿기 전에 돌 수 있고(timer의 시작 시각은 libuv
loop의 cached 시각이고 `Date.now()`는 wall clock이다), 2147483647 ms보다 긴 지연은 1 ms로 바뀌므로 이 경우가 생긴다. 그러면
요청은 `pendingApprovals`에 남고 ticket은 결정이나 ticket 종료(R-ROOM-047·R-ROOM-048: revoke, rotate, 만료 sweep)까지 `pending`이다.
그동안 relay는 새 provider socket에 지난 `expiresAt`을 담은 같은 `approval.request`를 보내고(R-ROOM-024, R-ROOM-025), 늦은
HTTP·WebSocket 결정도 받아들인다(결정은 요청의 `expiresAt`을 보지 않는다, → O-07, O-18).\
근거: `src/server/peer-server.ts:1395`, `src/server/peer-server.ts:1397`, `src/server/peer-server.ts:1398`, `src/server/peer-server.ts:1399`, `src/server/peer-server.ts:1400`, `src/server/peer-server.ts:1405`, `src/server/peer-server.ts:1406`, `src/server/peer-server.ts:1410`, `src/server/peer-server.ts:1367`, `src/server/peer-server.ts:1545`; 테스트: 없음

### 4.8 `POST /p/:id/approval/:requestId`

**R-ROOM-027** approval route는 body를 읽기 전과 뒤에 room과 token을 MUST 검사한다. room이 없거나 바뀌었거나
`expiresAt <= now`(rotate된 room 포함)면 404 `{error:'ROOM_NOT_FOUND'}`. `Authorization`이 정확히 `Bearer `(대소문자 구분,
공백 하나)로 시작하고 `slice(7).trim()`이 현재 providerToken과 상수 시간으로 같아야 하며, 아니면 token이 없든 틀리든 401
`{error:'PROVIDER_TOKEN_REQUIRED'}`다(→ O-13, O-15).\
근거: `src/server/peer-server.ts:2249`, `src/server/peer-server.ts:2253`, `src/server/peer-server.ts:2254`, `src/server/peer-server.ts:2257`, `src/server/peer-server.ts:2258`, `src/server/peer-server.ts:2265`; 테스트: `test/relay-message-limit.test.ts` › `refuses a slow approval or rotation signed with a provider token a reclaim replaced meanwhile`

**R-ROOM-028** 경로 requestId의 pending 요청이 있어야 하고, `body.sessionId`는 그 요청의 sessionId와 같은 비어 있지 않은
문자열, `body.roomId`는 경로 roomId와 엄격히 같은 값(필수), `body.roomEpoch`는 현재 epoch와 같은 수(필수), `decision`은
`approved` 또는 `rejected`여야 한다. `reason`은 선택이며 문자열이 아니면 무시한다. 하나라도 어기거나 ticket이 사라졌거나 다른
요청에 묶여 있으면 relay는 409 `{error:'INVALID_APPROVAL', code:-32081}`로 MUST 답한다. 결정한 요청은 지우므로 같은 결정을 반복하면
409다. ticket이 사라졌거나 다른 요청에 묶여 409가 될 때도 그 요청은 이미 지운 뒤다(→ O-10, O-50).\
근거: `src/server/peer-server.ts:2266`, `src/server/peer-server.ts:2270`, `src/server/peer-server.ts:2272`, `src/server/peer-server.ts:2275`, `src/server/peer-server.ts:2277`, `src/server/peer-server.ts:1548`, `src/server/peer-server.ts:1549`; 테스트: 없음

**R-ROOM-029** 승인하면 ticket은 `approved`, `approvedAt = now`, room은 `active`가 MUST 된다. ticket에 묶인 client
socket마다 outbox로 `approval.approved`(R-SIG-010)를, 그것이 `sent`나 `queued`일 때만 이어서
`{type:'ready', role:'client', roomId, roomEpoch, sessionId, capabilities, expiresAt: ticket.expiresAt, approval:'approved'}`를
보낸다. HTTP 결정은 provider socket에 echo하지 않는다(WebSocket `approval.decision`은 echo한다, R-SIG-009; → O-18).\
근거: `src/server/peer-server.ts:1556`, `src/server/peer-server.ts:1558`, `src/server/peer-server.ts:1565`, `src/server/peer-server.ts:1577`, `src/server/peer-server.ts:1578`, `src/server/peer-server.ts:2275`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`

**R-ROOM-030** 거절하면 ticket은 `rejected`가 되고, relay는 reason(HTTP는 비어 있지 않은 문자열 `body.reason`, WebSocket은
R-SIG-011의 값, 없으면 `CLIENT_APPROVAL_DENIED`)으로 ticket 종료(R-ROOM-047)를 MUST 한다. `rejected` ticket은 다시 `pending`이나
`approved`가 되지 않고, 그동안 그 ticket의 MCP 호출은 403 −32054 `CLIENT_APPROVAL_DENIED`다. 다만 뒤의 ticket 종료 — provider 단일
revoke(R-ROOM-039), client 자기 revoke(R-ROOM-040), 전체 revoke·rotate·만료 sweep(R-ROOM-048) — 는 이 status를 `revoked`나
`room-rotated`로 덮어쓴다. invite는 소비된 채 남는다.\
근거: `src/server/peer-server.ts:1550`, `src/server/peer-server.ts:1551`, `src/server/peer-server.ts:1553`, `src/server/peer-server.ts:2275`, `src/server/peer-server.ts:1345`, `src/server/peer-server.ts:1514`, `src/server/peer-server.ts:2377`, `src/server/peer-server.ts:2395`, `src/server/peer-server.ts:1594`; 테스트: `test/live-demo.e2e.test.ts` › `a host rejection denies the session`

**R-ROOM-031** 결정한 approval은 200 `{requestId, sessionId, roomId, roomEpoch, state:<decision>,
clientTokenActive:<decision === 'approved'>, decidedAt(ISO), expiresAt(ISO)}`로 MUST 답한다. 여기서 `expiresAt`은 ticket이
아니라 승인 요청의 만료다(→ O-17).\
근거: `src/server/peer-server.ts:2280`, `src/server/peer-server.ts:2288`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`

### 4.9 `GET /p/:id/sessions/:sessionId`

**R-ROOM-032** session status는 room이 없으면 404 `{error:'ROOM_NOT_FOUND'}`, rotate됐으면 인증보다 먼저 410
`{error:'ROOM_ROTATED', code:-32057, replacementRoomId, roomId, roomEpoch}`로 MUST 답한다. room 만료는 검사하지 않으므로
보존 중인 만료 room도 답한다.\
근거: `src/server/peer-server.ts:2299`, `src/server/peer-server.ts:2300`, `src/server/peer-server.ts:2303`, `src/server/peer-server.ts:2304`; 테스트: 없음

**R-ROOM-033** bearer(`Bearer ` 접두어, 대소문자 구분)는 그 session ticket의 clientToken이나 room의 providerToken과 상수
시간으로 MUST 같아야 한다. 아니면 401 `{error:'CLIENT_TOKEN_REQUIRED'}`다. 모르는 session에 client token을 쓰거나 다른
session의 token을 써도 401이다. providerToken으로 모르는 session을 물으면 404 `{error:'SESSION_NOT_FOUND'}`다. 모든 status의
ticket(revoked, rejected 포함)을 읽을 수 있다.\
근거: `src/server/peer-server.ts:2308`, `src/server/peer-server.ts:2309`, `src/server/peer-server.ts:2310`, `src/server/peer-server.ts:2311`, `src/server/peer-server.ts:2313`; 테스트: `test/client-session.test.ts` › `revokes a README-style Streamable HTTP session after initialize`

**R-ROOM-034** `ticket.expiresAt <= now`이고 status가 `revoked`·`rejected`가 아니면 status를 `expired`로 MUST 바꾼다.
client token으로 pending ticket을 조회하면 승인 요청을 전달한다(R-ROOM-025, provider token 조회는 하지 않는다). 응답은 200
`{roomId, roomEpoch, sessionId, state, clientLabel, approvalRequestId(문자열 또는 null), issuedAt(ISO), expiresAt(ISO),
approvedAt?(ISO), revokedAt?(ISO)}`이다. `state`는 `pending`이면 `pending-approval`, 아니면 status 그대로
(`approved`, `rejected`, `revoked`, `expired`)다. `revokedAt`은 거절과 승인 만료에도 설정된다.\
근거: `src/server/peer-server.ts:2317`, `src/server/peer-server.ts:2320`, `src/server/peer-server.ts:2321`, `src/server/peer-server.ts:2322`, `src/server/peer-server.ts:2331`, `src/server/peer-server.ts:2332`; 테스트: `test/client-session.test.ts` › `revokes a ticket that is still waiting for approval`; `test/relay-backpressure.test.ts` › `sends a pending approval request the provider could not take on the agent's next call, and only once`

**R-ROOM-035** HTTP 요청마다 sweep이 먼저 돌므로, sweep의 일회성 정리(R-ROOM-050)가 돈 만료 room의 ticket은 status route가
읽기 전에 모두 `revoked`(reason `ROOM_EXPIRED`)가 된다. 그런 room에서 이 route는 24시간 보존 동안 `state:'revoked'`와 sweep 시각의
`revokedAt`을 MUST 보고하고 `expired`를 보고하지 않는다. ticket 해석이 먼저 `roomState`를 `expired`로 바꿔 정리를 건너뛴 room
(R-ROOM-067)에서는 `pending`·`approved` ticket이 R-ROOM-034대로 `expired`가 되어 `state:'expired'`로 보이고, `revokedAt`은
그 전에 설정된 경우에만 있다. room이 삭제되면 404 `ROOM_NOT_FOUND`다(→ O-05, O-47).\
근거: `src/server/peer-server.ts:1644`, `src/server/peer-server.ts:1615`, `src/server/peer-server.ts:1618`, `src/server/peer-server.ts:1594`, `src/server/peer-server.ts:1514`, `src/server/peer-server.ts:1332`, `src/server/peer-server.ts:1336`, `src/server/peer-server.ts:2317`; 테스트: 없음

### 4.10 `POST /p/:id/session/revoke`, `POST /p/:id/sessions/:sessionId/revoke`

**R-ROOM-036** 두 revoke route는 body를 읽기 전과 뒤에 room을 MUST 검사한다. room이 없거나 바뀌었거나
`expiresAt <= now`(rotate된 room 포함)면 404 `{error:'ROOM_NOT_FOUND'}`다(→ O-09).\
근거: `src/server/peer-server.ts:2344`, `src/server/peer-server.ts:2345`, `src/server/peer-server.ts:2346`, `src/server/peer-server.ts:2355`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`

**R-ROOM-037** 경로형 `/sessions/:sessionId/revoke`에서는 token 검사보다 먼저 `body.roomId`가 경로 roomId와,
`body.roomEpoch`가 현재 epoch와 엄격히 같아야 하며(둘 다 필수) 아니면 409
`{error:'SESSION_BINDING_INVALID', code:-32002}`다. 통과하면 경로 sessionId가 `body.sessionId`를 MUST 대신한다(→ O-10).\
근거: `src/server/peer-server.ts:2356`, `src/server/peer-server.ts:2357`, `src/server/peer-server.ts:2358`, `src/server/peer-server.ts:2361`; 테스트: `test/server-room-lifecycle.test.ts` › `reports alreadyRevoked false then true for a provider revocation`

**R-ROOM-038** bearer가 providerToken(`Bearer ` 접두어)이고 sessionId가 없으면(`body.sessionId`가 없거나 문자열이 아니거나
빈 값; `/session/revoke`에서만 가능) relay는 reason `ROOM_REVOKED`로 모든 ticket을 MUST revoke한다(R-ROOM-048). 이 경우
roomId·roomEpoch binding 검사가 없어서 빈 body `{}`도 전부 revoke한다. 응답은 200
`{roomId, revoked:true, revokedSessions:true}`이고 `roomState`는 바뀌지 않는다(→ O-10, O-50).\
근거: `src/server/peer-server.ts:2362`, `src/server/peer-server.ts:2364`, `src/server/peer-server.ts:2365`, `src/server/peer-server.ts:2366`; 테스트: `test/server-pending-settlement.test.ts` › `answers SESSION_INVALID when the provider revokes every session`; `test/live-demo.e2e.test.ts` › `revoke pushes session.revoked and purges the host credentials`

**R-ROOM-039** providerToken과 sessionId가 있으면, 모르는 session은 404 `{error:'SESSION_NOT_FOUND'}`다. 아니면 ticket이
이미 `revoked`가 아닌 한 reason `SESSION_REVOKED`로 ticket을 MUST 종료(R-ROOM-047)하며, `rejected`·`expired`도 `revoked`로
덮어쓴다. 응답은 200 `{roomId, roomEpoch, sessionId, state:'revoked', revoked:true, revokedAt(ISO; 반복이면 원래 시각),
reason, alreadyRevoked}`이다. `reason`은 `body.reason ?? 'provider-request'`라서 `null`이 아닌 JSON 값이면 무엇이든 그대로
돌려주고, 없거나 `null`이면 `'provider-request'`다. `/session/revoke`에 `body.sessionId`를 준 provider는 binding 검사가 없다.\
근거: `src/server/peer-server.ts:2369`, `src/server/peer-server.ts:2371`, `src/server/peer-server.ts:2376`, `src/server/peer-server.ts:2377`, `src/server/peer-server.ts:2378`; 테스트: `test/server-room-lifecycle.test.ts` › `reports alreadyRevoked false then true for a provider revocation`

**R-ROOM-040** bearer가 client token이면 room의 ticket(모든 status)으로 해석돼야 하고, 아니면 401
`{error:'CLIENT_TOKEN_REQUIRED'}`다. 비어 있지 않은 문자열 `body.sessionId`(또는 경로 sessionId)가 ticket의 것과 다르면 403
`{error:'SESSION_BINDING_INVALID'}`(code 없음). `body.roomId`·`body.roomEpoch`가 경로 roomId·현재 epoch와 같지 않으면(둘 다
필수) 409 `{error:'SESSION_BINDING_INVALID', code:-32002}`. 통과하면 이미 `revoked`가 아닌 한 reason `CLIENT_REVOKED`로
ticket을 MUST 종료한다. 응답은 200 `{roomId, roomEpoch, sessionId, state:'revoked', revoked:true, revokedAt, reason,
alreadyRevoked}`이다. `reason`은 `body.reason ?? 'client-request'`라서 `null`이 아닌 JSON 값이면 그대로, 없거나 `null`이면
`'client-request'`다. pending, approved, expired, rejected ticket 모두 스스로 revoke할 수 있다(→ O-11).\
근거: `src/server/peer-server.ts:2381`, `src/server/peer-server.ts:2383`, `src/server/peer-server.ts:2386`, `src/server/peer-server.ts:2387`, `src/server/peer-server.ts:2390`, `src/server/peer-server.ts:2391`, `src/server/peer-server.ts:2395`, `src/server/peer-server.ts:2396`; 테스트: `test/server-room-lifecycle.test.ts` › `reports alreadyRevoked false then true for a client revocation`; `test/client-session.test.ts` › `revokes a ticket that is still waiting for approval`

### 4.11 `POST /p/:id/rotate`

**R-ROOM-041** rotate는 body를 읽기 전과 뒤에 room과 token을 MUST 검사한다. room이 없거나 바뀌었거나 이미 rotate됐거나
만료됐으면 404 `{error:'ROOM_NOT_FOUND'}`(그래서 동시에 온 두 번째 rotate도 404). bearer(`Bearer ` 접두어)가 현재
providerToken이 아니면 401 `{error:'PROVIDER_TOKEN_REQUIRED'}`.\
근거: `src/server/peer-server.ts:2406`, `src/server/peer-server.ts:2411`, `src/server/peer-server.ts:2412`, `src/server/peer-server.ts:2415`, `src/server/peer-server.ts:2416`, `src/server/peer-server.ts:2423`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`

**R-ROOM-042** `body.roomId`와 `body.roomEpoch`는 선택이지만, 있으면 경로 roomId·현재 epoch와 엄격히 같아야 한다. 다르면
room이 rotate되지 않았는데도 409 `{error:'ROOM_ROTATED', code:-32057, roomId, roomEpoch, replacementRoomId:null}`로 MUST
답한다(→ O-04).\
근거: `src/server/peer-server.ts:2424`, `src/server/peer-server.ts:2425`; 테스트: 없음

**R-ROOM-043** 대체 room은 `alias = trim한 비어 있지 않은 body.alias, 아니면 이전 alias`, `ttlMs = 유한한 body.ttlMs, 아니면
7200000`(이전 TTL을 물려받지 않음, R-ROOM-002 clamp), 이전 room의 `approvalRequired`·`capabilities`·`ownerId`,
`roomEpoch = 이전 + 1`로 MUST 만든다. 새 token들, 소비되지 않은 invite, 빈 ticket, deployment catalog(R-ROOM-013)를 가지며
provider가 등록한 catalog는 넘어가지 않는다.\
근거: `src/server/peer-server.ts:2428`, `src/server/peer-server.ts:2429`, `src/server/peer-server.ts:2433`, `src/server/peer-server.ts:2434`; 테스트: `test/server-room-lifecycle.test.ts` › `clamps a huge ttlMs on creation and rotation so the room expires and session status stays readable`; `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`

**R-ROOM-044** 이전 room에는 다음을 MUST 한다. `rotatedTo = 대체 id`, `expiresAt = rotate 시각`, `rotatedRetainUntil = rotate 시각
+ 300000`, `roomState = 'rotated'`. 모든 ticket을 `room-rotated`로 종료한다(R-ROOM-048: client socket은 replacement id 없는
`room.rotated`를 받고, pending WebSocket 요청은 data 없는 −32057 `ROOM_ROTATED`로 끝나고, 닫힌다). 진행 중인 HTTP MCP
요청은 −32057 `ROOM_ROTATED`, data `{replacementRoomId, roomId, roomEpoch}`로 끝난다. provider socket에는 전체
`room.rotated`(R-SIG-016)를 보내고 닫는다. room의 socket 목록을 모두 비운다(→ O-08).\
근거: `src/server/peer-server.ts:2430`, `src/server/peer-server.ts:2435`, `src/server/peer-server.ts:2436`, `src/server/peer-server.ts:2437`, `src/server/peer-server.ts:2438`, `src/server/peer-server.ts:2440`, `src/server/peer-server.ts:2441`, `src/server/peer-server.ts:2463`, `src/server/peer-server.ts:1587`; 테스트: `test/server-pending-settlement.test.ts` › `answers ROOM_ROTATED with the replacement room when the provider rotates`; `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`

**R-ROOM-045** rotate는 201 `{...대체 room의 descriptor, rotatedFrom, previousRoomId, previousRoomEpoch, previousState:'rotated',
replacementRoomId, replacementRoomEpoch, rotatedAt(ISO), invalidatedSessionCount}`로 MUST 답한다. `invalidatedSessionCount`는
이전 room이 발급한 ticket 수(`clientTokens.size`, 최대 1)다. relay는 rotate 시각(`Date.now()`) 하나를 이전 room의 `expiresAt`과
`rotatedRetainUntil`에 쓰지만, 응답의 `rotatedAt`, provider용 `room.rotated`의 `sentAt`과 `payload.rotatedAt`은 각각 그 자리에서
새로 찍은 `new Date()`라서 서로, 그리고 저장한 rotate 시각과 ms 단위로 다를 수 있다(→ O-17).\
근거: `src/server/peer-server.ts:2468`, `src/server/peer-server.ts:2477`, `src/server/peer-server.ts:2430`, `src/server/peer-server.ts:2436`, `src/server/peer-server.ts:2437`, `src/server/peer-server.ts:2447`, `src/server/peer-server.ts:2448`, `src/server/peer-server.ts:2476`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`

**R-ROOM-046** rotate 뒤 이전 room id로 온 요청에 relay는 다음과 같이 MUST 답한다(→ O-09).

| 요청 | 응답 |
|---|---|
| join, session status, reclaim | 410 `ROOM_ROTATED`, `replacementRoomId` 포함 |
| approval, 두 revoke route, rotate | 404 `ROOM_NOT_FOUND` |
| `POST /p/:id/mcp` 중계 method | 410, JSON-RPC −32057 `ROOM_ROTATED`, data `{replacementRoomId, roomId, roomEpoch}` |
| `POST /p/:id/mcp` `initialize` | 200(R-MCP-016), `_meta.roomState:'rotated'`, `roomValid:false` |
| `POST /p/:id/mcp` `tools/list`, `server/discover` | room에 마지막 catalog가 있으면 200, `result._meta.roomState:'rotated'`, `roomValid:false`. catalog snapshot이 비었으면 503 −32090 `CATALOG_UNAVAILABLE`(R-MCP-015) |
| `POST /p/:id/mcp` `ping` | 200 `{jsonrpc:'2.0', id, result:{}}`(`_meta` 없음) |
| `POST /p/:id/mcp` `notifications/initialized` | 202, 빈 본문 |
| `GET /p/:id/mcp` | 200, `state:'rotated'`, `roomValid:false`, `rotatedTo`, 마지막 catalog의 version·hash |
| `GET /p/:id/mcp/tools` | snapshot에 tool이 있으면 200, `state:'rotated'`, `roomValid:false`, 마지막 catalog. 없으면 503 `CATALOG_UNAVAILABLE`(R-ROOM-063) |
| provider·client WebSocket upgrade | 파기(`expiresAt <= now`) |

근거: `src/server/peer-server.ts:2167`, `src/server/peer-server.ts:2303`, `src/server/peer-server.ts:1782`, `src/server/peer-server.ts:2253`, `src/server/peer-server.ts:2345`, `src/server/peer-server.ts:2411`, `src/server/peer-server.ts:1995`, `src/server/peer-server.ts:2008`, `src/server/peer-server.ts:2026`, `src/server/peer-server.ts:2045`, `src/server/peer-server.ts:2050`, `src/server/peer-server.ts:1896`, `src/server/peer-server.ts:1921`, `src/server/peer-server.ts:2518`; 테스트: `test/relay-message-limit.test.ts` › `checks the room again once a slow body has arrived, so a rotation that happened meanwhile wins`

### 4.12 ticket 종료

**R-ROOM-047** ticket 종료(`closeClientTicket`, status는 `rejected`, `revoked`, `room-rotated` 중 하나)는 이전 status와 무관하게
status와 `revokedAt = now`를 정하고 ticket의 pending 승인 요청을 지운다. ticket에 묶인 client socket마다 plain `send`로 종료 frame
(`approval.rejected`, `session.revoked`, `room.rotated`; R-SIG-011, R-SIG-015, R-SIG-016)을 보내고, 그 socket의 pending
WebSocket 요청을 data 없이 각각 −32054 `CLIENT_APPROVAL_DENIED`, −32001 `SESSION_INVALID`, −32057 `ROOM_ROTATED`로 끝내고,
닫고(1000) room에서 MUST 뗀다. provider socket에는 frame을 보내지 않는다. 같은 ticket으로 진행 중인 HTTP 요청은 이 단계에서
끝내지 않는다(→ O-19).\
근거: `src/server/peer-server.ts:1511`, `src/server/peer-server.ts:1514`, `src/server/peer-server.ts:1517`, `src/server/peer-server.ts:1521`, `src/server/peer-server.ts:1522`, `src/server/peer-server.ts:1535`, `src/server/peer-server.ts:1536`; 테스트: `test/live-demo.e2e.test.ts` › `revoke pushes session.revoked and purges the host credentials`; `test/live-demo.e2e.test.ts` › `a host rejection denies the session`

**R-ROOM-048** 전체 revoke(`revokeAllClientTickets`: provider revoke-all, rotate, 만료 sweep)는 이전 status와 무관하게 room의
모든 ticket을 R-ROOM-047로 종료해 `revoked`(또는 `room-rotated`)로 MUST 덮어쓴다. 그다음 남은 pending 요청(HTTP bridge)을 모두
`roomClosedRpcError`로 끝내고 승인 요청을 비운다. 오류는 rotate면 −32057 `ROOM_ROTATED` `{replacementRoomId, roomId,
roomEpoch}`, reason이 `ROOM_EXPIRED`면 −32056 `ROOM_EXPIRED` `{roomId, roomEpoch}`, 그 밖은 data 없는 −32001
`SESSION_INVALID`다(→ O-05).\
근거: `src/server/peer-server.ts:1585`, `src/server/peer-server.ts:1587`, `src/server/peer-server.ts:1589`, `src/server/peer-server.ts:1590`, `src/server/peer-server.ts:1593`, `src/server/peer-server.ts:1594`, `src/server/peer-server.ts:1598`, `src/server/peer-server.ts:1599`; 테스트: `test/server-pending-settlement.test.ts` › `answers SESSION_INVALID when the provider revokes every session`; `test/server-pending-settlement.test.ts` › `answers ROOM_EXPIRED when the sweeper expires the room %s`

### 4.13 room 만료와 sweep

**R-ROOM-049** relay는 `roomSweepIntervalMs`가 0이 아니면 `max(1000, roomSweepIntervalMs ?? 30000)` ms마다(unref timer),
그리고 timer와 별개로 모든 HTTP 요청 시작 때 `cleanupExpiredRooms`를 MUST 돌린다.\
근거: `src/server/peer-server.ts:454`, `src/server/peer-server.ts:457`, `src/server/peer-server.ts:1644`; 테스트: 없음

**R-ROOM-068** relay는 `roomSweepIntervalMs`가 유한한 수인지 검사하지 않는다. `NaN`이면 `max(1000, NaN)`이 `NaN`이고
`NaN > 0`이 거짓이므로 relay는 sweep timer를 MUST NOT 건다(HTTP 요청 때의 sweep만 돈다). `Infinity`나 2147483647보다 큰 값이면
Node가 interval 지연을 1 ms로 바꾸므로(`TimeoutOverflowWarning`) sweep이 약 1 ms마다 돈다.\
근거: `src/server/peer-server.ts:454`, `src/server/peer-server.ts:455`, `src/server/peer-server.ts:456`, `src/server/peer-server.ts:457`; 테스트: 없음

**R-ROOM-050** sweep은 `expiresAt <= now`인 room마다 보존 기한 `retainUntil = max(metadataRetainUntil, rotatedRetainUntil)`을
본다. `now < retainUntil`이면 이미 `expired`이거나 rotate된 room이 아닐 때 한 번만 다음을 MUST 한다. `roomState = 'expired'`,
reason `ROOM_EXPIRED`로 전체 revoke(R-ROOM-048: client socket은 reason `ROOM_EXPIRED`의 `session.revoked`, WebSocket pending
요청은 −32001 `SESSION_INVALID`, HTTP 진행 요청은 −32056 `ROOM_EXPIRED`), provider socket은 frame 없이 닫기, client socket
닫기, room은 보존. 보존 기한이 지나면 `roomState`와 무관하게 같은 일을 하고 room을 지운다. `metadataRetainUntil`은 원래
`expiresAt` + 86400000이다. ticket 해석이 먼저 `expired`로 바꾼 room은 R-ROOM-067다(→ O-05).\
근거: `src/server/peer-server.ts:1610`, `src/server/peer-server.ts:1613`, `src/server/peer-server.ts:1615`, `src/server/peer-server.ts:1618`, `src/server/peer-server.ts:1619`, `src/server/peer-server.ts:1629`, `src/server/peer-server.ts:1637`; 테스트: `test/server-pending-settlement.test.ts` › `answers ROOM_EXPIRED when the sweeper expires the room %s`

**R-ROOM-067** ticket 해석(`resolveClientTicket`)은 bearer token이 room의 ticket과 맞고 room이 `expiresAt <= now`이면, rotate되지
않은 room의 `roomState`를 `expired`로 MUST 바꾼다. 이때 ticket revoke도 socket 닫기도 하지 않는다(해석한 ticket은
`ticket.expiresAt <= now`이고 `revoked`·`rejected`·`room-rotated`가 아니면 `expired`가 된다). R-ROOM-050의 일회성 정리는
`roomState`가 이미 `expired`인 room을 건너뛰므로, 그런 room은 보존 기한이 지나 지워질 때까지 정리되지 않는다. sweep은 HTTP 요청
시작 때 돌고 `POST /p/:id/mcp`는 body를 다 읽은 뒤 ticket을 해석하므로, 만료 전에 시작해 만료 뒤에 body가 끝난 MCP POST가 그
사이에 sweep이 돌지 않았으면 이 경로를 탄다(client upgrade와 client revoke는 자기 만료 검사 바로 뒤에 해석하므로 같은 ms
경계에서만). 그동안 ticket은 revoke되지 않고, client socket은 `session.revoked` 없이 frame을 보낼 때까지(R-ROOM-057), provider
socket도 frame을 보낼 때까지(R-ROOM-055) 붙어 있으며, 진행 중인 HTTP 요청은 `ROOM_EXPIRED`로 끝나지 않고
`MCP_REQUEST_TIMEOUT`(R-MCP-004)이나 provider socket이 닫힐 때의 `PROVIDER_DISCONNECTED`(R-ROOM-054)로 끝난다(→ O-05).\
근거: `src/server/peer-server.ts:1329`, `src/server/peer-server.ts:1331`, `src/server/peer-server.ts:1332`, `src/server/peer-server.ts:1336`, `src/server/peer-server.ts:1615`, `src/server/peer-server.ts:1644`, `src/server/peer-server.ts:1985`, `src/server/peer-server.ts:2381`, `src/server/peer-server.ts:2651`, `src/server/peer-server.ts:2538`, `src/server/peer-server.ts:2665`; 테스트: 없음

**R-ROOM-051** 보존 기한 안의 rotate된 room은 sweep이 건드리지 않는다. rotate는 만료 전에 일어나므로 실효 보존 기한은 언제나
원래 `expiresAt` + 24시간이다(`rotatedRetainUntil`은 효과가 없다, → O-49). 지워진 room id에는 모든 수명주기 route가 404
`ROOM_NOT_FOUND`로 MUST 답한다.\
근거: `src/server/peer-server.ts:562`, `src/server/peer-server.ts:1613`, `src/server/peer-server.ts:1615`, `src/server/peer-server.ts:2437`; 테스트: 없음

### 4.14 provider socket (`/p/{roomId}/provider`) 부착

**R-ROOM-052** R-WS-001~R-WS-012를 통과한 provider socket에 relay는 먼저 `ready`(R-SIG-006)를 MUST 보낸다. 그 `send`가
`sent`가 아니면 socket을 닫고 붙이지 않는다. 그래서 죽은 upgrade는 살아 있는 provider를 밀어내지 못한다. 그다음 다른
provider socket이 붙어 있으면 그것을 분리한다: `providerSocket`을 비우고, room의 모든 pending 요청(어느 agent의 WebSocket이든
HTTP든)을 −32001 `PROVIDER_DISCONNECTED`로 끝내고, 1000으로 닫는다. 새 socket을 붙이고 `roomState`를 정한 뒤(R-ROOM-003)
승인 replay(R-ROOM-053)를 한다. room에는 provider socket이 하나뿐이다.\
근거: `src/server/peer-server.ts:2626`, `src/server/peer-server.ts:2627`, `src/server/peer-server.ts:2633`, `src/server/peer-server.ts:2634`, `src/server/peer-server.ts:2635`, `src/server/peer-server.ts:2637`, `src/server/peer-server.ts:766`, `src/server/peer-server.ts:1033`; 테스트: `test/relay-message-limit.test.ts` › `does not let a dead provider upgrade displace the attached provider`; `test/relay-message-limit.test.ts` › `closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on`

**R-ROOM-053** `approvalRequired` room에서 provider가 (다시) 붙으면 relay는 `ready` 바로 뒤에 ticket 승인 상태를 MUST
replay한다. `expiresAt > now`인 approved ticket마다 `approval.restored`(R-SIG-014, 전송 결과를 보지 않는다)를, pending ticket마다
그 승인 요청(R-ROOM-025)을 보낸다. 순서는 approved는 `approvedAt ?? issuedAt`, pending은 요청의 `createdAt ?? now` 기준 오름차순이다.
approved ticket을 하나라도 replay하면 `roomState = 'active'`다. `approvalRequired: false` room과 revoked·expired ticket은
replay하지 않는다.\
근거: `src/server/peer-server.ts:1487`, `src/server/peer-server.ts:1488`, `src/server/peer-server.ts:1492`, `src/server/peer-server.ts:1494`, `src/server/peer-server.ts:1499`, `src/server/peer-server.ts:1505`; 테스트: `test/server-provider-reattach.test.ts` › `re-sends a pending request and restores no revoked, expired or approval-free ticket`; `test/server-provider-reattach.test.ts` › `replays several tickets in the order they were requested or approved`

**R-ROOM-054** 붙어 있는 provider socket이 닫히면 relay는 그 socket이 남긴 평가 대기 register frame을 버리고,
`providerSocket`을 비우고, room의 모든 pending 요청을 −32001 `PROVIDER_DISCONNECTED`로 MUST 끝낸다. agent socket은 열어
두며 provider 존재에 관한 frame을 보내지 않는다(`providerConnected`는 HTTP descriptor로만 보인다). `roomState`는 바뀌지
않는다.\
근거: `src/server/peer-server.ts:2614`, `src/server/peer-server.ts:2615`, `src/server/peer-server.ts:2616`, `src/server/peer-server.ts:2618`; 테스트: `test/server-provider-reattach.test.ts` › `keeps an approved agent working after the provider socket drops and the host reclaims the room`

**R-ROOM-055** provider socket의 frame 처리기는 그 socket이 room에 붙어 있는 provider socket이 아니거나 room이 만료됐으면
(`expiresAt <= now`) frame을 처리하지 않고 그 socket을 1000으로 MUST 닫는다. 닫으면 R-ROOM-054대로 분리되고 pending 요청은
`PROVIDER_DISCONNECTED`로 끝난다. relay는 provider socket을 room에서 뗄 때(교체·분리, rotate, sweep, `ready` 전송 실패) 언제나 먼저
닫으므로, 뗀 socket이 보낸 frame은 codec이 버려(R-WS-027) 이 처리기에 닿지 않는다. 그래서 이 검사가 실제로 닫는 것은 room이 만료된
뒤 frame을 보낸 붙어 있는 socket이다. 어느 경우든 늦은 답이나 register는 처리하지 않는다.\
근거: `src/server/peer-server.ts:2538`, `src/server/peer-server.ts:2539`, `src/server/peer-server.ts:771`, `src/server/peer-server.ts:2627`, `src/server/peer-server.ts:1619`, `src/server/peer-server.ts:2463`, `src/server/peer-server.ts:2616`, `src/server/ws-upgrade.ts:579`; 테스트: `test/relay-message-limit.test.ts` › `closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on`

### 4.15 client socket (`/p/{roomId}/client`) 부착

**R-ROOM-056** R-WS-001~R-WS-012를 통과한 client socket에 relay는 다음을 순서대로 MUST 한다. `AgentOutbox`를 만든다.
`ready`(R-SIG-006)를 plain `send`로 보내고, `sent`가 아니면 닫고 붙이지 않는다. 같은 ticket에 묶인 socket 중 부착 순서로 가장
오래된 것들을 새 socket을 포함해 4개(`MAX_CLIENT_SOCKETS_PER_TICKET`)가 넘지 않도록 1000으로 닫고 room에서 빼며, 그 pending
요청은 오류 없이 버린다. 새 socket을 room과 ticket에 묶는다. ticket이 pending이면 승인 요청을 provider에 전달하고(R-ROOM-025)
이 socket에 outbox로 `approval.pending`(R-SIG-013)을 보낸다.\
근거: `src/server/peer-server.ts:2807`, `src/server/peer-server.ts:2811`, `src/server/peer-server.ts:2812`, `src/server/peer-server.ts:2817`, `src/server/peer-server.ts:2820`, `src/server/peer-server.ts:2823`, `src/server/peer-server.ts:2825`, `src/server/peer-server.ts:2827`; 테스트: `test/relay-message-limit.test.ts` › `holds at most 4 client sockets per ticket, closing the oldest for a new one`; `test/relay-message-limit.test.ts` › `does not attach a client socket whose client went away while a customUpgradeHandler was awaiting`

**R-ROOM-057** client socket의 frame 처리기는 그 socket이 room의 client socket 목록에 없거나, room(`expiresAt <= now`)이나
ticket(`ticket.expiresAt <= now`)이 만료됐으면 frame을 처리하지 않고 그 socket을 1000으로 MUST 닫는다. relay는 client socket을 목록에서
뺄 때(ticket 종료, 승인 만료, ticket당 socket 상한, rotate, sweep) 언제나 먼저 닫고 `ready` 전송에 실패한 socket은 붙이지 않고 닫으므로,
그런 socket이 보낸 frame은 codec이 버려(R-WS-027) 이 처리기에 닿지 않는다. 그래서 이 검사가 실제로 닫는 것은 만료 뒤 frame을 보낸
붙어 있는 socket이다.\
근거: `src/server/peer-server.ts:2665`, `src/server/peer-server.ts:2666`, `src/server/peer-server.ts:1406`, `src/server/peer-server.ts:1536`, `src/server/peer-server.ts:2812`, `src/server/peer-server.ts:2820`, `src/server/peer-server.ts:1621`, `src/server/peer-server.ts:2464`, `src/server/ws-upgrade.ts:579`; 테스트: 없음

**R-ROOM-058** client socket이 닫히면 relay는 그 outbox에서 기다리던 frame을 버리고, room과 ticket 묶음에서 빼고, 그 socket의
pending 요청을 답 없이 MUST 지운다. 이후 provider의 답은 버린다. room과 provider는 영향받지 않는다.\
근거: `src/server/peer-server.ts:2801`, `src/server/peer-server.ts:2802`, `src/server/peer-server.ts:2804`, `src/server/peer-server.ts:2598`; 테스트: `test/relay-backpressure.test.ts` › `drops the replies waiting for an agent that goes away, and keeps the room serving`

### 4.16 `GET /p/:id/mcp`, `DELETE /p/:id/mcp`, `GET /p/:id/mcp/tools`, `GET /mcp/catalog`

**R-ROOM-059** `GET /p/:id/mcp`의 `Accept`(소문자로)가 `text/event-stream`을 포함하고 `application/json`을 포함하지 않으면
relay는 room 조회 전에 405, `Allow: POST`, `{jsonrpc:'2.0', id:null, error:{code:-32000, message:'SSE_STREAM_NOT_SUPPORTED'}}`로
MUST 답한다. 다른 `Accept`(없음 포함)는 descriptor를 받는다(→ O-46).\
근거: `src/server/peer-server.ts:646`, `src/server/peer-server.ts:1859`, `src/server/peer-server.ts:1864`; 테스트: `test/mcp-http-interop.test.ts` › `refuses the optional SSE GET with 405 while plain GETs keep returning the descriptor`

**R-ROOM-060** `GET /p/:id/mcp`는 인증 없이, 문법에 맞는 모든 id(모르는 id 포함)에 200
`{roomId, roomEpoch(모르면 0), alias(모르면 'unknown-room'), protocol:'webmcp-peer.v1', status, state(둘 다 mcpRoomState),
roomValid(entry가 있고 rotate되지 않았고 expiresAt > now), expiresAt(epoch ms 또는 null), catalogVersion, catalogHash,
toolCount, catalogUpdatedAt, providerConnected, approvalRequired(기본 true), auth, pendingApprovalCount,
activeClientCount(approved ticket 수), rotatedTo(또는 null)}`로 MUST 답한다. catalog 필드는 R-CAT-005의 snapshot이다.\
근거: `src/server/peer-server.ts:1872`, `src/server/peer-server.ts:1878`, `src/server/peer-server.ts:1882`, `src/server/peer-server.ts:1891`, `src/server/peer-server.ts:1895`; 테스트: `test/mcp-http-interop.test.ts` › `refuses the optional SSE GET with 405 while plain GETs keep returning the descriptor`; `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`; `test/relay-message-limit.test.ts` › `does not attach a provider socket whose client went away (%s) while a customUpgradeHandler was awaiting`

**R-ROOM-061** `GET /p/:id/mcp`와 200인 `GET /p/:id/mcp/tools`는 `Cache-Control: public, max-age=5, s-maxage=30,
stale-while-revalidate=60, stale-if-error=300`, `ETag: "mcp-descriptor-<응답 본문 JSON의 SHA-256 hex>"`,
`X-MCP-Catalog-Version`, `X-MCP-Catalog-Hash`, `Vary: Origin, Accept-Encoding`을 MUST 보낸다. ETag는 본문 전체에서 나오므로
state, providerConnected, 승인 수가 바뀌어도 바뀐다. 조건부 GET은 R-HTTP-014다(→ O-46).\
근거: `src/server/peer-server.ts:1058`, `src/server/peer-server.ts:1061`, `src/server/peer-server.ts:1062`, `src/server/peer-server.ts:1898`, `src/server/peer-server.ts:1925`; 테스트: 없음

**R-ROOM-062** `DELETE /p/:id/mcp`에는 405, `Allow: GET, POST`, `{jsonrpc:'2.0', id:null, error:{code:-32000,
message:'SESSION_TERMINATION_NOT_SUPPORTED'}}`로 MUST 답한다. relay는 `Mcp-Session-Id`를 발급하지도 읽지도 않는다.\
근거: `src/server/peer-server.ts:1867`, `src/server/peer-server.ts:1869`; 테스트: `test/mcp-http-interop.test.ts` › `answers DELETE with 405 because the relay issues no session`

**R-ROOM-063** `GET /p/:id/mcp/tools`는 R-CAT-005 snapshot을 쓴다(모르는 id도 deployment catalog, state `unknown`). tool이
없으면 503 `{error:'CATALOG_UNAVAILABLE', catalogVersion:0, catalogHash, auth}`, `Cache-Control: no-store`, ETag 없음이다
(`catalogVersion: 0`은 고정값이다, → O-39). 아니면 200 `{roomId, tools, catalogVersion, catalogHash, updatedAt, state, roomValid,
providerConnected, auth}`와 R-ROOM-061 header다. 보존 중인 rotate·만료 room은 `roomValid: false`로 마지막 catalog를 계속
MUST 준다.\
근거: `src/server/peer-server.ts:1904`, `src/server/peer-server.ts:1910`, `src/server/peer-server.ts:1921`, `src/server/peer-server.ts:1922`, `src/server/peer-server.ts:1925`; 테스트: `test/server-catalog-hash.test.ts` › `stamps a provider-registered catalog with the same hash as the deployment catalog`

**R-ROOM-064** `GET /mcp/catalog`와 `GET /mcp/catalog/<64 소문자 hex>`는 room과 무관하게 deployment catalog를 MUST 준다.
deployment tool이 없으면 503 `{error:'CATALOG_UNAVAILABLE', catalogVersion:0, catalogHash}`. hash가 현재 것이 아니면 404
`{error:'CATALOG_HASH_NOT_FOUND', catalogHash:<현재>}`. 아니면 200 `{protocol:'webmcp-peer.v1', source('deployment'·
'injected'), tools, catalogVersion, catalogHash, catalogUrl:'/mcp/catalog/<hash>'(상대 경로), updatedAt, auth}`다.
`/mcp/catalog`는 `Cache-Control: public, max-age=30, s-maxage=300, stale-while-revalidate=60, stale-if-error=600`,
`ETag: "mcp-catalog-<version>-<hash>"`, hash URL은 `Cache-Control: public, max-age=31536000, s-maxage=31536000, immutable`,
`CDN-Cache-Control: public, max-age=31536000, immutable`, `ETag: "mcp-deployment-catalog-<version>-<hash>"`다. 둘 다
`X-MCP-Catalog-Version`, `X-MCP-Catalog-Hash`, `Vary: Origin, Accept-Encoding`을 보낸다.\
근거: `src/server/peer-server.ts:1831`, `src/server/peer-server.ts:1835`, `src/server/peer-server.ts:1839`, `src/server/peer-server.ts:1842`, `src/server/peer-server.ts:1037`, `src/server/peer-server.ts:1047`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-ROOM-065** descriptor·catalog 응답의 `auth`는 MUST `{discovery:'public', execution:'client-ticket-and-approval',
clientTokenRequired:true, approvalRequired: entry?.approvalRequired ?? true, state}`이다. GET route의 `state`는 언제나
`not-joined`이고, MCP POST에서는 bearer ticket의 status, 없으면 `not-joined`다.\
근거: `src/server/peer-server.ts:1128`, `src/server/peer-server.ts:1893`, `src/server/peer-server.ts:2037`; 테스트: 없음

`POST /p/:id/mcp`는 7장에서 다룬다.

### 4.17 relay 종료

**R-ROOM-066** `WebMcpPeerServer.close()`는 모든 pending 요청을 `PROVIDER_DISCONNECTED`로 끝내고, 요청 timer를 지우고,
모든 provider·client socket을 1000으로 닫고, room을 비우고 HTTP server를 MUST 닫는다. close를 무시하는 peer는 5000 ms 뒤
파기되므로 종료가 끝난다.\
근거: `src/server/peer-server.ts:505`, `src/server/peer-server.ts:509`, `src/server/peer-server.ts:512`, `src/server/peer-server.ts:515`, `src/server/peer-server.ts:516`; 테스트: `test/server-ws-frames.test.ts` › `closes within the close timeout while a provider ignores the relay's close`

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
| `approval.expired` | R→A | 5.8 |
| `approval.pending` | R→A | 5.9 |
| `approval.restored` | R→P | 5.10 |
| `session.revoked` | R→A | 5.11 |
| `room.rotated` | R→P, R→A | 5.12 |
| `offer` | A→R→P | 5.13 |
| `offer.refused` | R→A | 5.14 |
| `answer`, `release` | P→R→A(broadcast) | 5.15 |
| `register` | P→R, R→A(announcement) | 5.16, 6장 |
| `error` | R→P | 5.17 |
| `mcp` | A→R→P, P→R→A | 5.18, 7장 |

### 5.1 공통 규칙

**R-SIG-001** relay는 provider·client socket에서 받은 완성 text message를 `JSON.parse`하고 `PeerFrameSchema`(null이나 배열이
아닌 object, 문자열 `type`)로 MUST 검사한다. 그 밖(잘못된 JSON, 수, 배열, null, `type` 없음·문자열 아님)은 답하지 않고
socket을 닫지 않고 broadcast하지도 않고 무시한다. frame 처리 중 예외도 삼킨다. provider도 relay frame에 같은 모양 규칙
(`ProviderFrameSchema`)을 MUST 적용하고, 문자열이 아닌 data를 포함해 나머지는 무시한다.\
근거: `src/server/wire-schemas.ts:23`, `src/server/wire-schemas.ts:36`, `src/server/peer-server.ts:2542`, `src/server/peer-server.ts:2612`, `src/server/peer-server.ts:2669`, `src/server/peer-server.ts:2798`, `src/provider/wire-schemas.ts:15`, `src/provider/peer-client.ts:120`; 테스트: `test/server-signaling-frames.test.ts` › `ignores provider frames that are not typed JSON objects instead of broadcasting them`

**R-SIG-002** relay control frame(`approval.request`, `approval.approved`, `approval.rejected`, `approval.restored`,
`session.revoked`, `room.rotated`)과 승인 결정 echo(R-SIG-009)는 `protocol:'webmcp-peer/1'`, `messageId`, `type`, `roomId`,
`roomEpoch`, `sentAt`(ISO), `payload`를 MUST 가진다. 그 밖의 relay frame에는 이 envelope이 없다. `ready`와 `approval.pending`에는
`protocol`·`messageId`·`sentAt`·`payload`가 없고, `approval.expired`에는 `sentAt`·`payload`가 없다. `pong`(`{type, timestamp}`),
`offer.refused`(`{type, requestId?, error}`), provider에 가는 `error`(`{type, code, message}`에 `reason`·`limitBytes`·`registerSeq`·
`requestId` 중 해당하는 것, R-SIG-021)에는 `roomId`·`roomEpoch`도 없다. `messageId` 형식은 frame마다 다르다(→ O-17).\
근거: `src/server/peer-server.ts:1427`, `src/server/peer-server.ts:1458`, `src/server/peer-server.ts:1522`, `src/server/peer-server.ts:1565`, `src/server/peer-server.ts:2576`, `src/server/peer-server.ts:1371`, `src/server/peer-server.ts:1405`, `src/server/peer-server.ts:2441`, `src/server/peer-server.ts:2548`, `src/server/peer-server.ts:2782`, `src/server/peer-server.ts:2793`, `src/server/peer-server.ts:936`, `src/server/peer-server.ts:938`, `src/server/peer-server.ts:2563`; 테스트: `test/server-provider-reattach.test.ts` › `restores an approved ticket to the new socket with an approval.restored frame`

**R-SIG-003** agent socket이 보낸 frame 중 relay가 다루는 type은 `mcp`(7장), `ping`(5.3), `offer`(5.13, approved ticket만)
뿐이다(`CLIENT_SIGNALING_FRAME_TYPES = {'offer'}`). 그 밖의 type — `ice`, `answer`, `release`, `register`, `ready`, `error`,
`pong`, `approval.*`, `session.*`, `room.*` 등 — 과 approved가 아닌 ticket의 `offer`는 답 없이 MUST 버린다. 그래서 agent는
relay control frame을 provider에 주입할 수 없다.\
근거: `src/server/peer-server.ts:104`, `src/server/peer-server.ts:2777`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`

**R-SIG-004** provider frame 중 `ping`, `approval.decision`, `register`, JSON-RPC 답을 담은 `mcp`가 아닌 것은 모두 relay가
stamp 없이 수정하지 않고 room의 모든 client socket(pending ticket 포함)에 MUST broadcast(R-WS-032)한다. 여기에는 `answer`,
`release`, 답이 아닌 `mcp`(notification, server→client 요청, id가 null인 답)와 relay 전용 type(`ready`, `error`,
`session.revoked`, `room.rotated`, `approval.*`)도 들어간다. relay는 이 frame들을 type으로 걸러 내지
않는다(→ O-20).\
근거: `src/server/peer-server.ts:2547`, `src/server/peer-server.ts:2551`, `src/server/peer-server.ts:2591`, `src/server/peer-server.ts:2595`, `src/server/peer-server.ts:2611`, `src/server/peer-server.ts:749`; 테스트: `test/server-signaling-frames.test.ts` › `ignores provider frames that are not typed JSON objects instead of broadcasting them`

**R-SIG-005** relay가 agent 대신 provider에 전달하는 frame(WebSocket `mcp` 요청과 notification, HTTP 요청과 notification,
`offer`)에는 `from:'client'`와 ticket의 `sessionId`를 MUST 찍는다. agent가 frame에 넣은 `from`·`sessionId`는 덮어쓴다.
WebSocket frame에 agent가 넣은 다른 envelope 필드는 그대로 전달된다. HTTP 요청은 `{type:'mcp', from:'client', sessionId?,
message}`이며 `sessionId`는 ticket을 해석했을 때만 있다.\
근거: `src/server/peer-server.ts:2705`, `src/server/peer-server.ts:2711`, `src/server/peer-server.ts:2766`, `src/server/peer-server.ts:2788`, `src/server/peer-server.ts:2109`, `src/server/peer-server.ts:2143`; 테스트: `test/relay-message-limit.test.ts` › `stamps every mcp frame it forwards to the provider with from: client and the ticket's sessionId`

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

**R-SIG-006** relay는 socket이 붙을 때 첫 frame으로 `ready`를 MUST 보낸다(R-ROOM-052, R-ROOM-056). client용 첫 `ready`는
plain `send`다. ticket이 승인되면 relay는 `approval.approved` 뒤에 `approval:'approved'`인 `ready`를 outbox로 다시
보낸다(R-ROOM-029).\
근거: `src/server/peer-server.ts:2626`, `src/server/peer-server.ts:2811`, `src/server/peer-server.ts:1578`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`

### 5.3 `ping`, `pong`

| 필드 | 값 |
|---|---|
| `type` | `'ping'` 또는 `'pong'` |
| `timestamp` | epoch ms. relay의 `pong`은 `Date.now()` |

**R-SIG-007** 붙어 있는 provider socket이나 room의 client socket(ticket status 무관, 승인 검사보다 먼저)이 `{type:'ping'}`을
보내면 relay는 `{type:'pong', timestamp: Date.now()}`로 MUST 답한다. 답은 plain `send`라서 queue가 가득 차면 사라진다. relay는
JSON `ping`을 스스로 보내지 않고 ping을 요구하지 않는다. agent가 보낸 `pong`은 R-SIG-003에 따라 버린다.\
근거: `src/server/peer-server.ts:2547`, `src/server/peer-server.ts:2548`, `src/server/peer-server.ts:2670`, `src/server/peer-server.ts:2671`; 테스트: `test/relay-backpressure.test.ts` › `skips announcements an agent that is not reading did not ask for, keeps its socket, and keeps room for the reply it asked for`

### 5.4 `approval.request` (R→P)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.request'` |
| `messageId` | `'approval-' + requestId`(requestId가 이미 `approval-`로 시작하므로 `approval-approval-…`) |
| `roomId`, `roomEpoch`, `sessionId`, `requestId` | room, ticket, 요청 값 |
| `sentAt` | 요청 `createdAt`의 ISO |
| `expiresAt` | 요청 만료(epoch ms) |
| `payload` | `{requestId, sessionId, roomId, roomEpoch, clientLabel, capabilities, requestedAt(ISO), expiresAt}` |

**R-SIG-008** relay는 승인 요청을 위 모양으로 provider socket마다 최대 한 번 MUST 보낸다(R-ROOM-025).\
근거: `src/server/peer-server.ts:1426`, `src/server/peer-server.ts:1427`, `src/server/peer-server.ts:1437`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`

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
requestId: <requestId 또는 null>}`로 MUST 답한다. 그 `requestId`의 pending 요청이 없거나 요청의 `sessionId`가 다르거나, ticket이
더는 그 요청을 가리키지 않아도(이때 요청은 지운다) 같은 오류(requestId 포함)다. 받아들인 결정은 R-ROOM-029·R-ROOM-030대로
처리하고, 결정한 provider socket에 `{protocol:'webmcp-peer/1', messageId:'approval-decision-<requestId>',
type:'approval.approved'|'approval.rejected', roomId, roomEpoch, sessionId, requestId, sentAt, expiresAt:<요청 만료>,
payload:{requestId, sessionId, roomId, roomEpoch, state:<decision>, clientTokenActive:<decision === 'approved'>, decidedAt,
expiresAt:<요청 만료>}, reason?}`를 plain `send`로 echo한다.\
근거: `src/server/peer-server.ts:2551`, `src/server/peer-server.ts:2552`, `src/server/peer-server.ts:2558`, `src/server/peer-server.ts:2563`, `src/server/peer-server.ts:2567`, `src/server/peer-server.ts:2568`, `src/server/peer-server.ts:2573`, `src/server/peer-server.ts:2576`, `src/server/peer-server.ts:1548`; 테스트: `test/server-provider-reattach.test.ts` › `keeps an approved agent working after the provider socket drops and the host reclaims the room`

### 5.6 `approval.approved` (R→A)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.approved'` |
| `messageId` | `'approval-approved-' + requestId` |
| `roomId`, `roomEpoch`, `sessionId`, `requestId` | |
| `sentAt` | `approvedAt`의 ISO |
| `expiresAt` | ticket 만료(epoch ms) |
| `payload` | `{requestId, sessionId, roomId, roomEpoch, state:'approved', clientTokenActive:true, decidedAt(ISO), expiresAt(ticket 만료)}` |

**R-SIG-010** 승인(HTTP·WebSocket) 시 relay는 ticket에 묶인 client socket마다 위 frame을 outbox로 MUST 보낸다. provider용 echo는
R-SIG-009의 모양이며 `expiresAt`이 승인 요청 만료라는 점이 다르다(→ O-17).\
근거: `src/server/peer-server.ts:1565`, `src/server/peer-server.ts:1574`, `src/server/peer-server.ts:1575`; 테스트: `test/server-signaling-frames.test.ts` › `drops forged control frames and only relays approved, allow-listed signaling stamped by the relay`

### 5.7 `approval.rejected` (R→A)

ticket 종료(R-ROOM-047)가 보내는 frame 셋(`approval.rejected`, `session.revoked`, client용 `room.rotated`)은 같은 모양이다.

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, 해당 type |
| `messageId` | `'<type>-<sessionId>-<Date.now()>'` |
| `roomId`, `roomEpoch`, `sessionId` | |
| `requestId` | ticket에 pending 승인 요청이 있을 때만 |
| `sentAt` | ISO |
| `payload` | `{requestId?, sessionId, roomId, roomEpoch, reason}` |
| `reason` | reason 문자열 |

**R-SIG-011** 거절 시 relay는 ticket에 묶인 client socket마다 reason이 비어 있지 않은 문자열 `body.reason`(HTTP) 또는
`payload.reason`(WebSocket), 아니면 `CLIENT_APPROVAL_DENIED`인 `approval.rejected`를 위 모양으로 MUST 보낸다. provider용 echo는
WebSocket 결정에만 있다(R-SIG-009).\
근거: `src/server/peer-server.ts:1553`, `src/server/peer-server.ts:1521`, `src/server/peer-server.ts:1522`, `src/server/peer-server.ts:2275`, `src/server/peer-server.ts:2557`; 테스트: `test/live-demo.e2e.test.ts` › `a host rejection denies the session`

### 5.8 `approval.expired` (R→A)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.expired'` |
| `messageId` | `'approval-expired-' + requestId` |
| `roomId`, `roomEpoch`, `sessionId`, `requestId` | |
| `reason` | `'APPROVAL_EXPIRED'` |

**R-SIG-012** 승인 요청이 만료되면(R-ROOM-026) relay는 ticket에 묶인 client socket마다 위 frame을 plain `send`로 보내고 1000으로
MUST 닫는다. provider에는 보내지 않는다. timer가 요청의 `expiresAt` 전에 돌아 요청을 만료시키지 않은 경우(R-ROOM-026)에는 이
frame이 가지 않는다.\
근거: `src/server/peer-server.ts:1397`, `src/server/peer-server.ts:1405`, `src/server/peer-server.ts:1406`; 테스트: 없음

### 5.9 `approval.pending` (R→A)

| 필드 | 값 |
|---|---|
| `type` | `'approval.pending'` |
| `roomId`, `roomEpoch`, `requestId`, `sessionId`, `capabilities` | |
| `expiresAt` | 승인 요청 만료(epoch ms) |

**R-SIG-013** pending ticket의 client socket이 붙으면 relay는 그 socket에만 위 frame을 outbox로 MUST 보낸다. 붙은 뒤 그 socket이
보내는 frame(`mcp`, `ping` 포함)은 승인 요청을 다시 보내지 않는다. 같은 pending ticket의 HTTP `POST /p/:id/mcp`와 session status
poll은 다시 보낸다(R-ROOM-025; → O-30).\
근거: `src/server/peer-server.ts:1370`, `src/server/peer-server.ts:1371`, `src/server/peer-server.ts:2827`, `src/server/peer-server.ts:2694`, `src/server/peer-server.ts:1988`, `src/server/peer-server.ts:2320`; 테스트: `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`

### 5.10 `approval.restored` (R→P)

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'approval.restored'` |
| `messageId` | `'approval-restored-' + sessionId` |
| `roomId`, `roomEpoch`, `sessionId` | |
| `sentAt` | 보낸 시각 ISO |
| `payload` | `{sessionId, roomId, roomEpoch, clientLabel(기본 'MCP client'), capabilities, approvedAt, expiresAt(ticket 만료)}` |

**R-SIG-014** relay는 provider 부착 replay(R-ROOM-053)에서 approved ticket마다 위 frame을 plain `send`로 한 번 MUST 보내고 그 결과를
보지 않는다. `busy`·`too-large`면 frame은 사라지고 전달 기록도 재전송도 없으며, `closed`여도 provider를 분리하지 않는다
(`approval.request`와 다르다, R-ROOM-025). 그러면 그 provider socket은 그 ticket의 승인 상태를 받지 못한 채 남는다.\
근거: `src/server/peer-server.ts:1457`, `src/server/peer-server.ts:1458`, `src/server/peer-server.ts:1466`, `src/server/peer-server.ts:1501`, `src/server/peer-server.ts:1448`, `src/server/peer-server.ts:1449`; 테스트: `test/server-provider-reattach.test.ts` › `restores an approved ticket to the new socket with an approval.restored frame`

### 5.11 `session.revoked` (R→A)

**R-SIG-015** revoke 시 relay는 ticket에 묶인 client socket마다 5.7 모양의 `session.revoked`를 MUST 보낸다. reason은 provider의
단일 revoke면 `SESSION_REVOKED`, client 자기 revoke면 `CLIENT_REVOKED`, provider 전체 revoke면 `ROOM_REVOKED`, 만료 sweep이면
`ROOM_EXPIRED`다. HTTP revoke 응답의 `reason`(R-ROOM-039, R-ROOM-040)과는 다른 값이다(→ O-50).\
근거: `src/server/peer-server.ts:1521`, `src/server/peer-server.ts:2365`, `src/server/peer-server.ts:2377`, `src/server/peer-server.ts:2395`, `src/server/peer-server.ts:1618`; 테스트: `test/live-demo.e2e.test.ts` › `revoke pushes session.revoked and purges the host credentials`

### 5.12 `room.rotated`

provider용(R→P):

| 필드 | 값 |
|---|---|
| `protocol`, `type` | `'webmcp-peer/1'`, `'room.rotated'` |
| `messageId` | `'room-rotated-' + 이전 roomId` |
| `roomId`, `roomEpoch` | 이전 room |
| `sentAt` | ISO |
| `payload` | `{previousRoomId, previousRoomEpoch, previousState:'rotated', replacementRoomId, replacementRoomEpoch, rotatedAt(ISO), invalidatedSessionCount}` |
| `rotatedTo` | 대체 roomId |

client용(R→A)은 5.7 모양이며 reason은 `ROOM_ROTATED`이고 `replacementRoomId`·`rotatedTo`가 없다.

**R-SIG-016** rotate 시 relay는 provider socket에 provider용 frame을 보내고 닫으며, client socket에는 ticket 종료(R-ROOM-047)로
client용 frame을 MUST 보낸다. rotate handler에 provider용 모양을 client socket에 보내는 loop가 있지만, 그때는 ticket 종료가 이미
모든 client socket을 뗐으므로 아무 socket에도 닿지 않는다(→ O-08).\
근거: `src/server/peer-server.ts:2440`, `src/server/peer-server.ts:2441`, `src/server/peer-server.ts:2448`, `src/server/peer-server.ts:2451`, `src/server/peer-server.ts:1537`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`

### 5.13 `offer` (A→R→P)

| 필드 | 값 |
|---|---|
| `type` | `'offer'` |
| `requestId` | 선택. 문자열이면 JSON text 1024 byte 이하 |
| `sdp` | relay는 검사하지 않는다 |
| `from`, `sessionId` | relay가 `'client'`와 ticket sessionId로 덮어쓴다 |
| 그 밖 | 그대로 전달 |

**R-SIG-017** relay는 approved ticket의 `offer`만 다룬다. 문자열 `requestId`의 JSON text가 1024 byte를 넘으면 전달하지 않고
`{type:'offer.refused', error: REQUEST_ID_TOO_LARGE}`(requestId 없음)로 답한다. 받은 text나 `JSON.stringify(frame)`이 261120
byte를 넘으면 `too-large`로 본다. 아니면 R-SIG-005대로 stamp해 provider에 MUST 보낸다. offer는 pending 상한에 세지 않고
rate limit도 없다(→ O-58).\
근거: `src/server/peer-server.ts:2777`, `src/server/peer-server.ts:2781`, `src/server/peer-server.ts:2782`, `src/server/peer-server.ts:2786`, `src/server/peer-server.ts:2788`; 테스트: `test/relay-backpressure.test.ts` › `forwards an offer of exactly the request limit and refuses one byte more with REQUEST_TOO_LARGE`; `test/relay-message-limit.test.ts` › `refuses an offer whose requestId is over 1 KiB of JSON without echoing or forwarding it, since the provider's answer repeats it`

### 5.14 `offer.refused` (R→A)

| 필드 | 값 |
|---|---|
| `type` | `'offer.refused'`(`${type}.refused`로 만든다) |
| `requestId` | offer의 `requestId`가 문자열일 때만 |
| `error` | JSON-RPC 오류 object |

**R-SIG-018** 전달하지 못한 offer에 relay는 outbox로 위 frame을 MUST 보낸다. `error`는 `too-large`면 `REQUEST_TOO_LARGE`
(−32600, `{limitBytes:261120}`), provider queue가 가득 차면 `PROVIDER_BUSY`(−32001, `{retryable:true}`, provider는 붙어 있음),
provider가 없거나 닫히는 중이면 `PROVIDER_UNAVAILABLE`(−32001)이다. 닫히는 provider는 분리한다(모든 pending 요청이
`PROVIDER_DISCONNECTED`).\
근거: `src/server/peer-server.ts:224`, `src/server/peer-server.ts:2789`, `src/server/peer-server.ts:2790`, `src/server/peer-server.ts:2793`; 테스트: `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`

### 5.15 `answer`, `release` (P→R→A)

| type | 필드 |
|---|---|
| `answer` | `requestId`, `sdp`(ICE 수집을 마친 전체 SDP) |
| `release` | `requestId` |

**R-SIG-019** relay는 provider의 `answer`와 `release`를 R-SIG-004대로 room의 모든 client socket에 MUST broadcast한다. offer를 보낸
agent에게만 보내지 않는다(→ O-20). provider의 송신 규칙은 R-PEER-022, R-PEER-023이다.\
근거: `src/server/peer-server.ts:2611`, `src/provider/peer-client.ts:999`, `src/provider/peer-client.ts:1288`; 테스트: `test/server-signaling-frames.test.ts` › `ignores provider frames that are not typed JSON objects instead of broadcasting them`

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
근거: `src/server/peer-server.ts:875`, `src/server/peer-server.ts:925`, `src/server/peer-server.ts:2591`; 테스트: `test/catalog-contract.test.ts` › `announces accepted catalogs with the relay's authoritative version and hash`

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
`send`로 MUST 보낸다. agent는 relay 오류를 `mcp` frame의 JSON-RPC 오류로 받는다. 다만 provider가 보낸 `error` frame은 R-SIG-004로
agent에게 broadcast된다.\
근거: `src/server/peer-server.ts:933`, `src/server/peer-server.ts:936`, `src/server/peer-server.ts:938`, `src/server/peer-server.ts:2563`; 테스트: `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`

### 5.18 `mcp`

| 필드 | 방향 | 값 |
|---|---|---|
| `type` | 양방향 | `'mcp'` |
| `message` | 양방향 | JSON-RPC 2.0 message |
| `from` | R→P | `'client'`(relay가 찍음) |
| `sessionId` | R→P | ticket sessionId(relay가 찍음) |
| 그 밖 | A→R→P | 그대로 전달 |

**R-SIG-022** `mcp` frame의 라우팅은 7장을 MUST 따른다.\
근거: `src/server/peer-server.ts:2595`, `src/server/peer-server.ts:2674`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

## 6. catalog

room catalog은 relay가 소유하는 tool descriptor 목록(`cachedTools`)과 그 `catalogVersion`·`catalogHash`다. relay는 이 catalog로
`tools/call`을 검사하고(R-MCP-020) HTTP·WebSocket listing에 답한다.

**R-CAT-001** relay가 받아들이는 catalog는 tool이 최대 128개(`MAX_CATALOG_TOOLS`)인 배열이어야 한다. 각 tool은 배열이 아닌
object이고, `name`은 비어 있지 않고 자기 trim과 같고 256 UTF-16 code unit(`MAX_TOOL_NAME_LENGTH`) 이하이며 유일한 문자열이고,
`inputSchema`는 `type === 'object'`인 배열 아닌 object여야 한다. relay는 각 tool을 `structuredClone`으로 깊이 복사하고(실패하면
무효) 다른 descriptor 필드는 MUST 유지한다. 그 밖(배열이 아닌 `tools`, `tools` 없음 포함)은 `CATALOG_INVALID`다. agent client의
검사와는 앞뒤 공백 이름 처리가 다르다(→ O-32).\
근거: `src/server/deployment-catalog.ts:5`, `src/server/deployment-catalog.ts:61`, `src/server/deployment-catalog.ts:70`, `src/server/deployment-catalog.ts:75`, `src/server/deployment-catalog.ts:77`, `src/server/deployment-catalog.ts:79`, `src/server/deployment-catalog.ts:80`; 테스트: `test/catalog-contract.test.ts` › `validates tool catalogs with the client contract`; `test/catalog-contract.test.ts` › `rejects catalogs clients would reject and keeps every tier on the last valid catalog`

**R-CAT-002** `catalogHash`는 `SHA-256(JSON.stringify(canonical))`의 소문자 hex다. canonical은 tool을 `String(tool.name ?? '')`의
UTF-16 code unit 순서로 안정 정렬한 사본(`localeCompare` 쓰지 않음)이고, 모든 object의 key를 `Object.keys().sort()`로 재귀
정렬하며 배열 순서는 유지한다. key는 `Object.defineProperty`로 넣어 자기 `__proto__` key도 hash에 들어간다. relay의 room hash,
deployment hash, agent client의 `hashTools`는 이 알고리즘을 MUST 똑같이 쓴다. tool이 없는 catalog의 hash는 `SHA-256('[]')`다.\
근거: `src/server/deployment-catalog.ts:26`, `src/server/deployment-catalog.ts:32`, `src/server/deployment-catalog.ts:46`, `src/server/deployment-catalog.ts:56`, `src/server/peer-server.ts:528`, `src/server/peer-server.ts:659`, `src/client/catalog-hash.ts:7`, `src/client/catalog-hash.ts:44`; 테스트: `test/server-catalog-hash.test.ts` › `hashes tools in code-unit name order, independent of input order`; `test/server-catalog-hash.test.ts` › `does not depend on the runtime's collation locale`; `test/client-catalog-hash.test.ts` › `hashTools equals hashDeploymentCatalog for every input order`; `test/client-catalog-hash.test.ts` › `hashes catalogs that differ only under a __proto__ key differently, on the relay and the client`

**R-CAT-003** room은 deployment catalog가 비었으면 `catalogVersion: 0`, `SHA-256('[]')`, catalog 없음으로, 아니면 deployment의
tools·version·hash로 시작한다(R-ROOM-013). catalog가 바뀔 때마다(register나 listing 답) `catalogVersion`을 1 MUST 올린다.
`catalogVersion`이 0이면 hash가 같아도(빈 catalog `[]`) 받아들여 version 1이 된다(→ O-39).\
근거: `src/server/peer-server.ts:566`, `src/server/peer-server.ts:573`, `src/server/peer-server.ts:574`, `src/server/peer-server.ts:812`, `src/server/peer-server.ts:816`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates a repeated frame again once the room catalog changed in between`

**R-CAT-004** deployment catalog는 option `deploymentCatalog`(source `injected`)이고, 없으면 `$WEBMCP_CATALOG_PATH`,
`$FRAMEBOOK_MCP_CATALOG_PATH`, `<process.cwd()>/api/webmcp-tools.json`, `<process.cwd()>/../../api/webmcp-tools.json`,
`<process.cwd()>/packages/peer-server/api/webmcp-tools.json` 중 처음 존재하고 정규화한 `tools`가 비어 있지 않은 JSON object 파일
(source `deployment`), 없으면 빈 catalog(source `empty`)를 MUST 쓴다. 무효한 tool 목록은 `[]`가 된다. `catalogVersion`은 입력의
0보다 큰 safe integer(파일은 기본 1), 아니면 tool이 있으면 1, 없으면 0이다. 입력 `catalogHash`는 계산값과 같을 때만 쓴다.
`catalogUpdatedAt`은 유한한 입력값, 아니면 `deployment`는 0, 그 밖은 `Date.now()`다(→ O-53).\
근거: `src/server/deployment-catalog.ts:89`, `src/server/deployment-catalog.ts:99`, `src/server/deployment-catalog.ts:102`, `src/server/deployment-catalog.ts:105`, `src/server/deployment-catalog.ts:112`, `src/server/deployment-catalog.ts:117`, `src/server/deployment-catalog.ts:119`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-CAT-005** HTTP가 쓰는 catalog snapshot은 room에 catalog가 있으면 그 `cachedTools`의 사본과 room의 version·hash·updatedAt이고,
없으면 deployment catalog의 사본(비어 있지 않을 때), 그것도 없으면 `tools: []`, `catalogVersion: 0`, `SHA-256('[]')`다. relay는
이 규칙을 MUST 쓴다.\
근거: `src/server/peer-server.ts:1115`, `src/server/peer-server.ts:1117`, `src/server/peer-server.ts:1121`; 테스트: `test/provider-register-limit.test.ts` › `gets a WebSocket agent of a new room the relay's CATALOG_UNAVAILABLE, not the catalog of the room before`

**R-CAT-006** 붙어 있는 provider socket의 `register` frame을 받으면 relay는 그것을 `registerSeq`와 나머지 `frame`(`type`, `alias`
포함)으로 나누고, `frame`의 fingerprint를 `SHA-256(JSON.stringify(frame))` hex(key 순서에 민감)로 정하고, room에서 평가를
기다리던 register frame을 답 없이 버린 뒤 처리(R-CAT-011~R-CAT-013)를 MUST 시작한다.\
근거: `src/server/peer-server.ts:874`, `src/server/peer-server.ts:875`, `src/server/peer-server.ts:881`, `src/server/peer-server.ts:882`, `src/server/peer-server.ts:2591`; 테스트: `test/server-register-evaluation.test.ts` › `keeps the budget across the room's provider sockets and never evaluates a waiting frame from a replaced one`

**R-CAT-007** catalog 평가(`acceptProviderCatalog`)는 다음 순서로 결과를 MUST 정한다. R-CAT-001에 어긋나면 `invalid`. 아니면 hash를
계산하고 announcement `{...fields, tools:<정규화한 tools>, catalogVersion:<unchanged면 현재, 아니면 현재 + 1>, catalogHash}`를
만든다(`fields`는 register frame에서 `registerSeq`를 뺀 것, listing 답이면 `{type:'register'}`). 그 JSON이 260096 byte
(`PEER_RELAY_MAX_ANNOUNCEMENT_BYTES`)를 넘으면 `too-large`(unchanged 판정보다 먼저). `catalogVersion > 0`이고 hash가 room과 같으면
`unchanged`. 아니면 `accepted`이고, 알리는 announcement는 잰 object 그대로다(그 `tools`가 room의 `cachedTools`다).\
근거: `src/server/peer-server.ts:841`, `src/server/peer-server.ts:843`, `src/server/peer-server.ts:845`, `src/server/peer-server.ts:846`, `src/server/peer-server.ts:850`, `src/server/peer-server.ts:851`, `src/server/peer-server.ts:852`; 테스트: `test/relay-message-limit.test.ts` › `accepts an announcement of exactly PEER_RELAY_MAX_ANNOUNCEMENT_BYTES and sends it to agents in 128 KiB fragments`; `test/relay-message-limit.test.ts` › `announces only the catalog it measured, never one over the announcement limit`

**R-CAT-008** `accepted`면 relay는 room catalog를 바꾸고(`cachedTools`, `catalogSource: 'provider'`, `catalogHash`,
`catalogVersion += 1`, `catalogUpdatedAt = Date.now()`) 모든 agent에게 이 순서로 MUST broadcast한다:
`{type:'mcp', message:{jsonrpc:'2.0', method:'notifications/tools/list_changed', params:{catalogVersion, catalogHash}}}`, 그다음
register frame에서 온 catalog일 때만 announcement. provider에는 ack를 보내지 않는다.\
근거: `src/server/peer-server.ts:811`, `src/server/peer-server.ts:813`, `src/server/peer-server.ts:816`, `src/server/peer-server.ts:820`, `src/server/peer-server.ts:925`; 테스트: `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`; `test/catalog-contract.test.ts` › `announces accepted catalogs with the relay's authoritative version and hash`

**R-CAT-009** 거절한 register(`invalid`, `too-large`)에 relay는 보낸 provider socket에만 plain `send`로 MUST 답한다(queue가 가득
차면 사라진다). `invalid`는 `{type:'error', code:-32602, message:'CATALOG_INVALID', reason:'register.tools must be at most 128
uniquely named tools with an object inputSchema'}`, `too-large`는 `{type:'error', code:-32602, message:'CATALOG_TOO_LARGE',
limitBytes:260096, reason:'the catalog announcement is <n> bytes, over the relay's 260096-byte announcement limit'}`다. frame의
`registerSeq`가 수일 때만 그것을 echo한다(문자열은 echo하지 않음). room은 이전 catalog를 유지하고 agent는 아무것도 받지 않는다.\
근거: `src/server/peer-server.ts:933`, `src/server/peer-server.ts:934`, `src/server/peer-server.ts:936`, `src/server/peer-server.ts:938`; 테스트: `test/relay-message-limit.test.ts` › `refuses a register whose announcement is over PEER_RELAY_MAX_ANNOUNCEMENT_BYTES with CATALOG_TOO_LARGE for its registerSeq, and keeps the previous catalog`; `test/provider-reconnect.test.ts` › `surfaces CATALOG_INVALID as the session error until a new catalog is sent`

**R-CAT-010** `unchanged` register(tool 순서·key 순서와 무관하게 room과 같은 hash)에 relay는 답하지 않고, announcement와
`list_changed`를 보내지 않으며, version을 MUST NOT 바꾼다. 그래서 alias 같은 tool 외 필드만 바뀐 register는 알리지 않는다.\
근거: `src/server/peer-server.ts:812`, `src/server/peer-server.ts:851`, `src/server/peer-server.ts:923`, `src/server/peer-server.ts:926`; 테스트: `test/relay-message-limit.test.ts` › `announces a register only when its catalog changed`; `test/catalog-contract.test.ts` › `publishes the same descriptor via register and tools/list so the relay catalog never flaps`

**R-CAT-011** fingerprint가 마지막으로 평가한 frame과 같고 room의 `catalogVersion`·`catalogHash`가 그 평가가 남긴 값 그대로면
relay는 다시 평가하지 않고 budget도 쓰지 않으며, 저장한 결과로 MUST 답한다(같은 거절을 이 frame의 `registerSeq`로, 받아들였거나
unchanged였으면 답 없음). 그사이 room catalog가 바뀌었으면(예: listing 답) 같은 frame도 다시 평가한다.\
근거: `src/server/peer-server.ts:896`, `src/server/peer-server.ts:897`, `src/server/peer-server.ts:899`, `src/server/peer-server.ts:924`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates a frame that repeats the last one once, and answers every repeat as that one was, under its own registerSeq`; `test/server-register-evaluation.test.ts` › `evaluates a repeated frame again once the room catalog changed in between`

**R-CAT-012** room마다 token bucket이 평가를 MUST 제한한다. 처음 8개(`REGISTER_EVALUATION_BURST`)로 시작하고 1000 ms
(`REGISTER_EVALUATION_INTERVAL_MS`)마다 1개씩 연속으로 채워 8개까지 둔다. 평가마다 1개를 쓰고, catalog를 받아들이면 돌려준다.
그래서 받아들인 catalog는 budget을 쓰지 않고, 거절·unchanged·예외 평가는 쓴 채로 남는다. token이 1 미만이면 frame은
`ceil((1 − tokens) × 1000)` ms를 기다렸다가 처리된다(반복 shortcut을 다시 확인). 최신 frame은 rate 때문에 거절되지 않는다(→ O-40).\
근거: `src/server/peer-server.ts:95`, `src/server/peer-server.ts:97`, `src/server/peer-server.ts:878`, `src/server/peer-server.ts:903`, `src/server/peer-server.ts:905`, `src/server/peer-server.ts:913`, `src/server/peer-server.ts:920`, `src/server/peer-server.ts:922`; 테스트: `test/server-register-evaluation.test.ts` › `evaluates at most ${BURST} at once and then one a second, always the latest, and still takes a changed catalog`

**R-CAT-013** 기다리는 frame은 더 새로운 register가 오거나, 보낸 socket이 더는 붙어 있는 provider가 아니거나(교체·닫힘), room이
만료되면 답 없이 MUST 버린다. budget 상태는 room entry에 속하므로 다시 붙거나 교체한 provider socket이 이어받고, rotate한 대체
room은 새 budget으로 시작한다.\
근거: `src/server/peer-server.ts:415`, `src/server/peer-server.ts:881`, `src/server/peer-server.ts:887`, `src/server/peer-server.ts:909`, `src/server/peer-server.ts:2615`; 테스트: `test/server-register-evaluation.test.ts` › `keeps the budget across the room's provider sockets and never evaluates a waiting frame from a replaced one`

**R-CAT-014** relay는 WebSocket agent의 whole-catalog listing(`server/discover`, 또는 `params.cursor`가 `undefined`·`null`인
`tools/list`)에 대한 provider 답에서만 catalog를 MUST 받아들인다. 오류가 없고 `result.nextCursor`가 `undefined`·`null`일 때
`result.tools`를 fields `{type:'register'}`로 R-CAT-007에 넣는다. 이 경로는 register budget을 쓰지 않고, 받아들이면
`list_changed`만 broadcast한다(announcement 없음, → O-40). `tools/call` 결과(그 안에 `tools`가 있어도), cursor로 요청한 page,
`nextCursor`가 있는 첫 page는 room catalog를 바꾸지 않는다. 답의 처리는 R-MCP-038이다. HTTP listing은 relay가 직접 답하므로
catalog를 바꾸지 않는다.\
근거: `src/server/peer-server.ts:2754`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:966`, `src/server/peer-server.ts:971`, `src/server/peer-server.ts:972`; 테스트: `test/relay-message-limit.test.ts` › `takes a catalog only from a whole tools/list result, not from a tools/call result or a page of a listing`; `test/relay-message-limit.test.ts` › `takes a catalog from a server/discover result like a tools/list one, and answers a refused one from the relay's catalog`

## 7. MCP JSON-RPC 라우팅

### 7.1 공통

**R-MCP-001** relay는 `jsonrpc === '2.0'`이고 `method`가 문자열이며 `id`가 없거나 `undefined`·`null`·문자열·수인 object만
JSON-RPC 요청으로 MUST 본다. 문자열 id의 JSON text(따옴표 포함)가 1024 byte를 넘으면 요청이 아니다(REQUEST_ID_TOO_LARGE). 배열
(batch)은 요청이 아니다. 수 id는 크기 검사를 받지 않는다.\
근거: `src/server/peer-server.ts:664`, `src/server/peer-server.ts:666`, `src/server/peer-server.ts:673`, `src/server/peer-server.ts:675`, `src/server/peer-server.ts:220`; 테스트: `test/relay-message-limit.test.ts` › `refuses a request id over 1 KiB of JSON without echoing or forwarding it, over WebSocket and HTTP`

**R-MCP-002** provider의 `mcp` frame은 `message`가 `jsonrpc === '2.0'`, 문자열이나 수인 `id`, `result`나 `error` member를 가질 때만
답으로 MUST 본다. id가 null인 답은 답이 아니므로 R-MCP-041로 broadcast된다(→ O-03).\
근거: `src/server/peer-server.ts:685`, `src/server/peer-server.ts:687`, `src/server/peer-server.ts:2595`; 테스트: 없음

**R-MCP-003** pending 요청은 room마다 하나인 map에 `rpcKey(id) = '<typeof id>:<String(id)>'`로 둔다. WebSocket socket과 HTTP
bridge가 이 map을 함께 쓴다. agent id의 key가 이미 pending이면 relay는 요청을 wire id
`framebook:<n>:<typeof id>:<String(id)>`(n은 server 전체에서 증가하는 counter, 빈 key가 나올 때까지 증가)로 MUST 전달하고, 답의
id를 agent의 id로 되돌린다. provider는 wire id만 본다. 그래서 수 1과 문자열 `"1"`은 다른 key다. 요청 상한 아래 1 KiB가 wire
id와 stamp를 담는다.\
근거: `src/server/peer-server.ts:691`, `src/server/peer-server.ts:695`, `src/server/peer-server.ts:699`, `src/server/peer-server.ts:964`, `src/server/peer-server.ts:2120`, `src/server/peer-server.ts:2744`, `src/config/limits.ts:28`; 테스트: `test/relay-message-limit.test.ts` › `forwards and answers a body of exactly the request limit under a rewritten duplicate id, clears its pending slot, and refuses one byte more`; `test/client-request-limit.test.ts` › `forwards and answers a WebSocket request of exactly the request limit under a rewritten duplicate id, and refuses one byte more`

**R-MCP-004** 전달한 요청마다 relay는 `mcpRequestTimeoutMs = max(1000, option ?? 30000)` ms timer를 MUST 둔다. 시간이 지나면
pending 항목을 지우고 data 없는 −32001 `MCP_REQUEST_TIMEOUT`으로 답한다(HTTP는 200). 그 뒤 온 provider 답은 버린다.\
근거: `src/server/peer-server.ts:442`, `src/server/peer-server.ts:2141`, `src/server/peer-server.ts:2750`, `src/server/peer-server.ts:2598`; 테스트: 없음

**R-MCP-044** relay는 `mcpRequestTimeoutMs`가 유한한 수인지 검사하지 않는다. `max(1000, NaN)`은 `NaN`, `max(1000, Infinity)`는
`Infinity`이고, Node timer는 `NaN`이나 2147483647 ms보다 긴 지연을 1 ms로 바꾼다. 그래서 `NaN`, `Infinity`, 2147483647보다 큰 값이면
relay는 전달한 모든 요청을 약 1 ms 뒤 `MCP_REQUEST_TIMEOUT`(R-MCP-004)으로 MUST 끝낸다. `NaN`이면 승인 요청의 `expiresAt`도
`NaN`이 되어 timer가 약 1 ms 뒤 요청을 만료시키고(R-ROOM-026의 `expiresAt > Date.now()` 검사가 거짓이다), `approval.request`·
`approval.pending`의 `expiresAt`은 JSON `null`이다. `Infinity`면 승인 요청의 `expiresAt`은 room의 `expiresAt`이다.\
근거: `src/server/peer-server.ts:442`, `src/server/peer-server.ts:1391`, `src/server/peer-server.ts:1397`, `src/server/peer-server.ts:1410`, `src/server/peer-server.ts:1373`, `src/server/peer-server.ts:1436`, `src/server/peer-server.ts:2141`, `src/server/peer-server.ts:2750`; 테스트: 없음

**R-MCP-005** pending 요청은 다음과 같이 MUST 끝난다. provider socket이 닫히거나 교체·분리되면 room의 모든 pending 요청이
data 없는 −32001 `PROVIDER_DISCONNECTED`(R-ROOM-052, R-ROOM-054). ticket 종료는 그 ticket socket의 WebSocket 요청(R-ROOM-047).
전체 revoke·rotate·만료는 남은 HTTP 요청(R-ROOM-048). agent socket이 닫히면 그 socket의 요청은 답 없이 지운다(R-ROOM-058).
HTTP agent의 연결이 끊기면 그 요청 slot을 즉시 비운다(R-MCP-025). 단일 session revoke는 그 ticket의 진행 중인 HTTP 요청을
끝내지 않는다(→ O-19).\
근거: `src/server/peer-server.ts:1029`, `src/server/peer-server.ts:1033`, `src/server/peer-server.ts:1535`, `src/server/peer-server.ts:1598`, `src/server/peer-server.ts:2804`, `src/server/peer-server.ts:2138`; 테스트: `test/relay-message-limit.test.ts` › `closes the provider socket a new one with the same token replaces, fails its pending requests, and ignores it from then on`

**R-MCP-006** relay는 provider 답으로 agent에게 넘길 frame을 이렇게 MUST 만든다. wire id가 agent id와 같으면 provider frame을 받은
그대로, 다르면 `{...providerFrame, message:{...rpc, id:<agent id>}}`다. WebSocket agent는 이 frame을 그대로(provider가 넣은 envelope
필드 포함) 받는다. HTTP bridge는 `type`이 `mcp`인 frame에서 `message`만 꺼내므로, HTTP agent의 응답 body는 id를 agent의 것으로
되돌린 JSON-RPC message뿐이고 provider의 envelope 필드는 전달되지 않는다(R-MCP-023). whole-catalog listing이 아닌 답은 stamp 없이
전달하고 room catalog를 바꾸지 않는다.\
근거: `src/server/peer-server.ts:963`, `src/server/peer-server.ts:964`, `src/server/peer-server.ts:965`, `src/server/peer-server.ts:966`, `src/server/peer-server.ts:2127`, `src/server/peer-server.ts:2155`; 테스트: `test/relay-message-limit.test.ts` › `forwards an agent request of exactly the request limit under a rewritten id, and answers one byte more with REQUEST_TOO_LARGE on the agent's socket`; `test/relay-message-limit.test.ts` › `forwards and answers a body of exactly the request limit under a rewritten duplicate id, clears its pending slot, and refuses one byte more`

### 7.2 HTTP `POST /p/:id/mcp`

**R-MCP-007** relay는 `POST /p/:id/mcp`를 다음 순서로 MUST 처리한다.

1. body를 261120 byte 상한으로 읽는다(R-MCP-008).
2. UTF-8과 JSON으로 해석하고 요청인지 검사한다(R-MCP-009).
3. `id: null`을 거절한다(R-MCP-009).
4. 다시 직렬화한 크기를 검사한다(R-MCP-010).
5. `MCP-Protocol-Version` header를 검사한다(R-MCP-011).
6. room이 있으면 bearer ticket을 해석하고, pending ticket이면 승인 요청을 전달한다(R-ROOM-025).
7. metadata method가 아니면 room 상태를 검사한다(R-MCP-013).
8. metadata method가 아니면 ticket을 검사한다(R-MCP-014).
9. `tools/list`·`server/discover`의 snapshot이 비었으면 503이다(R-MCP-015).
10. `initialize`, `ping`, `notifications/initialized`, `server/discover`, `tools/list`는 relay가 직접 답한다(R-MCP-016~R-MCP-019).
11. `tools/call`이면 fail-closed 검사를 한다(R-MCP-020). id가 없는 `tools/call`도 13단계의 notification 분기보다 먼저 여기서 검사한다.
12. provider가 없으면 503(R-MCP-021).
13. notification은 전달하고 202(R-MCP-022), 요청은 전달하고 답을 기다린다(R-MCP-023).

11단계 앞에 room이 없으면 404로 답하는 코드(`src/server/peer-server.ts:2075`)가 있지만 닿지 않는다. metadata method는 9·10단계에서
모두 끝나고, 그 밖의 method는 room이 없으면 7단계에서 이미 404를 받는다.

근거: `src/server/peer-server.ts:1931`, `src/server/peer-server.ts:1937`, `src/server/peer-server.ts:1947`, `src/server/peer-server.ts:1957`, `src/server/peer-server.ts:1963`, `src/server/peer-server.ts:1970`, `src/server/peer-server.ts:1985`, `src/server/peer-server.ts:1991`, `src/server/peer-server.ts:2003`, `src/server/peer-server.ts:2008`, `src/server/peer-server.ts:2012`, `src/server/peer-server.ts:2075`, `src/server/peer-server.ts:2079`, `src/server/peer-server.ts:2103`, `src/server/peer-server.ts:2111`, `src/server/peer-server.ts:2120`; 테스트: 없음

**R-MCP-008** MCP POST body 상한은 261120 byte(`PEER_RELAY_MAX_REQUEST_BYTES`)이고 drain 상한은 4177920 byte다. 상한을 넘었고
drain됐으면 413 `{jsonrpc:'2.0', id:null, error:{code:-32600, message:'REQUEST_TOO_LARGE', data:{limitBytes:261120}}}`, drain
상한을 넘었으면 request가 파기돼 응답이 없다(response에 `destroy()`를 따로 부르지 않는다, → O-57). `BODY_CONSUMED`는 request가
끝난 뒤 500 `{jsonrpc:'2.0', id:null, error:{code:-32603, message:'BODY_CONSUMED'}}`, abort는 response 파기다. 어느 경우에도
아무것도 MUST NOT 전달한다.\
근거: `src/server/peer-server.ts:1937`, `src/server/peer-server.ts:1939`, `src/server/peer-server.ts:1942`, `src/server/peer-server.ts:1943`, `src/server/peer-server.ts:156`, `src/server/peer-server.ts:1320`; 테스트: `test/relay-message-limit.test.ts` › `answers an MCP POST body one byte over the request limit with 413 REQUEST_TOO_LARGE, and the room keeps working`; `test/mcp-http-interop.test.ts` › `answers a body over the limit with 413 instead of a truncated parse`; `test/relay-message-limit.test.ts` › `answers 500 BODY_CONSUMED instead of acting on a body a customHttpHandler read, and reads one it only paused`

**R-MCP-009** body는 엄격한 UTF-8(`isUtf8`)이어야 하고 `JSON.parse`로 해석한다. UTF-8이 아니거나 JSON 문법 오류(빈 body, 앞의
BOM 포함)면 400 `{code:-32700, message:'PARSE_ERROR'}`. 문자열 id가 1024 byte를 넘으면(다른 결함보다 먼저) 400
`{code:-32600, message:'REQUEST_ID_TOO_LARGE', data:{limitBytes:1024}}`. R-MCP-001의 요청이 아니면(batch 배열 포함) 400
`{code:-32600, message:'INVALID_REQUEST'}`. `id: null`도 400 `INVALID_REQUEST`다. 이 모두 `id: null`로 MUST 답한다(→ O-03, O-38).\
근거: `src/server/peer-server.ts:205`, `src/server/peer-server.ts:1947`, `src/server/peer-server.ts:1948`, `src/server/peer-server.ts:1950`, `src/server/peer-server.ts:1953`, `src/server/peer-server.ts:1957`, `src/server/peer-server.ts:1958`; 테스트: `test/relay-message-limit.test.ts` › `answers a body that is not valid UTF-8 with 400 PARSE_ERROR instead of acting on altered content`; `test/mcp-http-interop.test.ts` › `rejects a request with id null as an invalid request`

**R-MCP-010** 해석한 요청의 `JSON.stringify` 결과가 261120 byte를 넘으면(`1e20` 확장, escape 증가 등) relay는 요청 id(`rpc.id ?? null`)로
413 `REQUEST_TOO_LARGE`를 MUST 답한다. 읽기 단계의 413은 id null이므로 두 413의 id가 다르다(→ O-37).\
근거: `src/server/peer-server.ts:1963`, `src/server/peer-server.ts:1964`; 테스트: `test/relay-message-limit.test.ts` › `applies the request limit to a request as the relay re-serializes it, over HTTP and WebSocket`

**R-MCP-011** `initialize`가 아닌 요청(`ping`, `notifications/initialized` 포함)에 `MCP-Protocol-Version` header가 있고 그 값을
trim한 것이 `MCP_INITIALIZE_PROTOCOL_VERSIONS`에 없으면 relay는 room 조회와 ticket 인증보다 먼저 400 `{jsonrpc:'2.0',
id:<rpc.id ?? null>, error:{code:-32600, message:'UNSUPPORTED_PROTOCOL_VERSION', data:{supported:[4개 버전], requested:<header 값>}}}`로
MUST 답한다. node:http는 반복된 이 header를 `, `로 합친 문자열 하나로 넘기므로 header 값은 언제나 문자열이다(문자열이 아닌 값을
거절하는 분기는 닿지 않는다). 그래서 지원하는 version을 두 번 보내도 trim한 값이 `2025-11-25, 2025-11-25`처럼 목록에 없어 400이고,
`requested`도 그 합친 문자열이다. header가 없으면 받는다. `initialize`는 header로 막지 않는다. `2026-07-28` client가
`server/discover`로 먼저 물으면 400을 받고 `initialize`로 물러난다.\
근거: `src/server/peer-server.ts:1970`, `src/server/peer-server.ts:1971`, `src/server/peer-server.ts:1972`, `src/server/peer-server.ts:1975`, `src/provider/commit-receipt.ts:8`; 테스트: `test/mcp-http-interop.test.ts` › `rejects an unsupported MCP-Protocol-Version header and accepts a supported or missing one`; `test/mcp-http-interop.test.ts` › `serves the official MCP v2 client in %s negotiation mode`

**R-MCP-012** `initialize`, `server/discover`, `tools/list`, `ping`, `notifications/initialized`(metadata method)는 relay가 직접 답하고
provider에 MUST NOT 전달한다. room이 없거나 rotate·만료됐어도, ticket이 없거나 어떤 status여도 답한다. `_meta.auth.state`는
ticket status, 없으면 `not-joined`다(→ O-30).\
근거: `src/server/peer-server.ts:1980`, `src/server/peer-server.ts:1991`, `src/server/peer-server.ts:2004`, `src/server/peer-server.ts:2037`; 테스트: `test/client-session.test.ts` › `revokes a ticket that is still waiting for approval`; `test/relay-message-limit.test.ts` › `sends a pending ticket's approval request to each provider socket once, however often the agent calls`

**R-MCP-013** metadata method가 아니면 relay는 이 순서로 room을 MUST 검사한다. 모르는 room: 404
`{code:-32004, message:'ROOM_NOT_FOUND', data:{roomId}}`. rotate된 room: 410 `{code:-32057, message:'ROOM_ROTATED',
data:{replacementRoomId, roomId, roomEpoch}}`. `expiresAt <= now`: 410 `{code:-32056, message:'ROOM_EXPIRED', data:{roomId,
roomEpoch}}`. 모두 JSON-RPC 오류 body에 요청 id를 담는다.\
근거: `src/server/peer-server.ts:1991`, `src/server/peer-server.ts:1992`, `src/server/peer-server.ts:1995`, `src/server/peer-server.ts:1996`, `src/server/peer-server.ts:1999`, `src/server/peer-server.ts:2000`; 테스트: `test/live-demo.e2e.test.ts` › `rotation pushes room.rotated, voids old tickets, and issues a fresh single-use invite`

**R-MCP-014** metadata method가 아니면 ticket은 정확히 `Bearer `(대소문자 구분, 공백 하나)로 시작하는 `Authorization`에서 MUST
가져온다. ticket이 없거나 모르는 token: 401 −32003 `CLIENT_TOKEN_REQUIRED`. pending: 403 −32053 `CLIENT_APPROVAL_REQUIRED`.
rejected: 403 −32054 `CLIENT_APPROVAL_DENIED`. expired: 410 −32056 `SESSION_EXPIRED`. revoked: 401 −32001 `SESSION_INVALID`. data는
`{roomId, sessionId(없으면 null), approvalRequired}`다. `room-rotated` ticket에는 대응 오류가 없지만 rotate된 room은 R-MCP-013에서
먼저 거절된다(→ O-02, O-11).\
근거: `src/server/peer-server.ts:1342`, `src/server/peer-server.ts:1343`, `src/server/peer-server.ts:1344`, `src/server/peer-server.ts:1347`, `src/server/peer-server.ts:1602`, `src/server/peer-server.ts:1604`, `src/server/peer-server.ts:2003`, `src/server/peer-server.ts:2005`; 테스트: `test/live-demo.e2e.test.ts` › `reports a revoked session as SESSION_INVALID instead of catalog drift`; `test/live-demo.e2e.test.ts` › `a host rejection denies the session`

**R-MCP-015** catalog snapshot(R-CAT-005)에 tool이 없으면 relay는 `tools/list`와 `server/discover`에 503 `{code:-32090,
message:'CATALOG_UNAVAILABLE', data:{catalogSource:<deployment catalog의 source>}}`로 MUST 답한다. 유효한 빈 catalog를 가진 room도
마찬가지다(→ O-39). `initialize`는 catalog가 비어도 답한다.\
근거: `src/server/peer-server.ts:2008`, `src/server/peer-server.ts:2009`; 테스트: `test/provider-register-limit.test.ts` › `gets a WebSocket agent of a new room the relay's CATALOG_UNAVAILABLE, not the catalog of the room before`

**R-MCP-016** `initialize`에 relay는 200과 `result:{protocolVersion, capabilities:{tools:{listChanged:false}, stateless:true},
serverInfo:{name, version}, tools, _meta}`로 MUST 답한다. `protocolVersion`은 `params.protocolVersion`이
`MCP_INITIALIZE_PROTOCOL_VERSIONS`에 있으면 그 값, 아니면(`2026-07-28`, 모르는 값, 없음) `2025-11-25`다. `serverInfo`는
`serverName`(기본 `framebook-peer-server`)과 `serverVersion`(기본 `0.4.0`)이다. `_meta`는 `{roomId, roomEpoch(모르면 0), roomState,
roomValid, catalogVersion, catalogHash, toolCount, bootstrapCatalog:{tools, catalogVersion, catalogHash, source:<room
catalogSource ?? deployment source>}, auth}`다. header는 `Cache-Control: no-store`, `X-MCP-Catalog-Version`,
`X-MCP-Catalog-Hash`, `Vary: Origin`이다. WebSocket의 `initialize`는 다르게 처리된다(R-MCP-036, → O-01).\
근거: `src/server/peer-server.ts:636`, `src/server/peer-server.ts:2012`, `src/server/peer-server.ts:2016`, `src/server/peer-server.ts:2020`, `src/server/peer-server.ts:2023`, `src/server/peer-server.ts:1069`, `src/server/peer-server.ts:448`; 테스트: `test/mcp-http-interop.test.ts` › `negotiates initialize-era version %s as requested`; `test/mcp-http-interop.test.ts` › `answers 2026-07-28, unknown, and missing initialize versions with 2025-11-25`; `test/mcp-http-interop.test.ts` › `advertises tools.listChanged false because the HTTP endpoint has no server-to-client stream`

**R-MCP-017** `ping`에는 id가 없어도 200 `{jsonrpc:'2.0', id:<id ?? null>, result:{}}`와 catalog header로 MUST 답한다(202가 아니다).
`notifications/initialized`에는 id가 있어도 202, 빈 본문, `Content-Type` 없음, `Cache-Control: no-store`와 catalog header로 답하고
전달하지 않는다(→ O-29).\
근거: `src/server/peer-server.ts:1979`, `src/server/peer-server.ts:2045`, `src/server/peer-server.ts:2050`, `src/server/peer-server.ts:2051`; 테스트: `test/mcp-http-interop.test.ts` › `answers a notification with 202 and an empty body`

**R-MCP-018** HTTP `tools/list`에 relay는 200 `result:{tools, _meta:{roomId, roomEpoch, roomState, roomValid, catalogVersion,
catalogHash, auth}}`와 catalog header로 MUST 답한다. `tools`는 R-CAT-005 snapshot이다. `params.cursor`와 `params._meta`는
무시하고(pagination 없음), catalog stamp는 언제나 `result._meta` 안에 있다(→ O-31).\
근거: `src/server/peer-server.ts:2063`, `src/server/peer-server.ts:2068`, `src/server/peer-server.ts:1142`; 테스트: `test/relay-message-limit.test.ts` › `registers a catalog whose register frame is between 128 KiB and 256 KiB and lists it to agents`; `test/relay-message-limit.test.ts` › `keeps a fresh WebSocket PeerMcpSession listing and calling the relay's catalog after the relay refused the provider's newer one`

**R-MCP-019** HTTP `server/discover`에 relay는 200 `result:{protocolVersion:<R-MCP-016과 같은 협상>, serverInfo, tools,
_meta:<R-MCP-018과 같은 listing meta>}`로 MUST 답한다. `capabilities`와 `supportedProtocolVersions`는 없다(→ O-01).\
근거: `src/server/peer-server.ts:2054`, `src/server/peer-server.ts:2057`, `src/server/peer-server.ts:1163`; 테스트: `test/relay-message-limit.test.ts` › `answers a WebSocket agent's tools/list and server/discover from the relay's catalog when the provider answers with an error`

**R-MCP-020** relay는 `tools/call`을 전달하기 전에 다음을 MUST 검사한다. (1) `params`는 비어 있지 않은 문자열 `name`을 가진
object, 아니면 −32602 `tools/call params are invalid`. (2) `params._meta.catalogVersion`이 room `catalogVersion`과 다른 수이거나
`params._meta.catalogHash`가 room `catalogHash`와 다른 문자열이면 −32010 `CATALOG_CHANGED`, data `{catalogVersion, catalogHash}`(relay의
현재 값). (3) room에 catalog(`cachedTools`)가 있고 그 이름의 tool이 없으면 −32602 `TOOL_NOT_FOUND`(data 없음). catalog가 없는 room은
(3)을 건너뛴다. 검사하는 `tools/call`은 transport마다 다르다. HTTP는 id와 무관하게 모든 `tools/call`을 검사하고(R-MCP-007의 11단계가
notification 분기보다 앞이다) status는 400, 409, 400이다. id가 없는 `tools/call`은 이 오류를 id null로 받고, 통과하면
notification으로 전달된다(R-MCP-022). WebSocket은 id가 문자열이나 수인 `tools/call`만 검사한다. approved ticket의 id가 없거나 null인
`tools/call`은 notification으로 보고 이 검사 없이 provider에 전달한다(R-MCP-030). relay는 `_meta.runtimeEpoch`와 `_meta.sessionId`를
보지 않는다(→ O-34).\
근거: `src/server/peer-server.ts:2079`, `src/server/peer-server.ts:2082`, `src/server/peer-server.ts:2086`, `src/server/peer-server.ts:2092`, `src/server/peer-server.ts:2098`, `src/server/peer-server.ts:2111`, `src/server/peer-server.ts:2707`, `src/server/peer-server.ts:2711`, `src/server/peer-server.ts:2714`, `src/server/peer-server.ts:2723`, `src/server/peer-server.ts:2731`; 테스트: `test/live-demo.e2e.test.ts` › `rejects stale writes with CATALOG_CHANGED without touching the host, then resyncs`; `test/live-demo.e2e.test.ts` › `surfaces relay catalog drift over HTTP as PeerMcpCatalogChangedError (no host write)`

**R-MCP-021** room에 provider socket이 없으면 relay는 중계할 요청과 notification에 503 `{jsonrpc:'2.0', id:<id 또는 null>,
error:{code:-32001, message:'PROVIDER_UNAVAILABLE'}}`(data·`Retry-After` 없음)로 MUST 답한다. relay가 닫은 provider socket(예:
1009)도 여기서 답한다. codec의 `close()`는 그 자리에서 `onClose`를 부르고, relay의 `onClose`가 그 socket을 room에서 떼기
때문이다(R-WS-027, R-ROOM-054).\
근거: `src/server/peer-server.ts:2103`, `src/server/peer-server.ts:2104`, `src/server/ws-upgrade.ts:433`, `src/server/ws-upgrade.ts:451`, `src/server/peer-server.ts:2616`, `src/server/peer-server.ts:2617`; 테스트: `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`; `test/server-ws-frames.test.ts` › `answers PROVIDER_UNAVAILABLE, not REQUEST_TOO_LARGE, while the closed provider has not hung up`

**R-MCP-022** id가 없는 message(`id: null`은 R-MCP-009에서 거절)로 metadata method가 아닌 것은 room·ticket·`tools/call`(R-MCP-020)·
provider 검사를 거쳐 `{type:'mcp', from:'client', sessionId, message}`로 전달한다. 중계 method는 approved ticket만 통과하므로
(`room-rotated` ticket의 room은 R-MCP-013에서 먼저 거절된다) `sessionId`는 언제나 있다. ticket이 없을 때 `sessionId`를 빼는 분기
(`src/server/peer-server.ts:2109`)는 닿지 않는다. provider socket이 받으면 202, 빈 본문, catalog header 없음으로 MUST 답한다. 못 받으면
id null로 `too-large`는 413 `REQUEST_TOO_LARGE`, `busy`는 503 `PROVIDER_BUSY`와 `Retry-After: 1`, `closed`는 503
`PROVIDER_UNAVAILABLE`(provider 분리)이다(→ O-29).\
근거: `src/server/peer-server.ts:1342`, `src/server/peer-server.ts:2003`, `src/server/peer-server.ts:2109`, `src/server/peer-server.ts:2111`, `src/server/peer-server.ts:2112`, `src/server/peer-server.ts:2114`, `src/server/peer-server.ts:2117`; 테스트: `test/mcp-http-interop.test.ts` › `forwards a provider notification and answers 202 with an empty body`; `test/relay-message-limit.test.ts` › `stamps every mcp frame it forwards to the provider with from: client and the ticket's sessionId`; `test/relay-message-limit.test.ts` › `forwards an HTTP notification of exactly the request limit, and answers one byte more with 413 and forwards nothing`; `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`

**R-MCP-023** 중계하는 HTTP 요청마다 relay는 요청별 bridge socket을 만든다. bridge의 `send`는 언제나 `sent`를 돌려주고 크기 상한이
없다. pending 항목 `{socket, timer, method, id, wireId}`를 두고 stamp한 frame을 보낸 뒤 기다린다. 답은 MUST 200과 provider의 JSON-RPC
message(id는 agent의 것으로 되돌림)이며 `X-MCP-Catalog-*` header가 없다. provider의 JSON-RPC 오류, 그리고 timeout·provider 끊김·
rotate·만료처럼 진행 중에 생긴 relay 오류도 200이다(→ O-28).\
근거: `src/server/peer-server.ts:2124`, `src/server/peer-server.ts:2126`, `src/server/peer-server.ts:2142`, `src/server/peer-server.ts:2143`, `src/server/peer-server.ts:2155`; 테스트: `test/relay-message-limit.test.ts` › `delivers a ~200 KB tool result to an HTTP agent intact while the provider stays connected`; `test/server-pending-settlement.test.ts` › `answers ROOM_ROTATED with the replacement room when the provider rotates`

**R-MCP-024** provider socket이 요청을 받지 못하면 relay는 pending 항목을 지우고 요청 id로 MUST 답한다. `too-large`: 413
`REQUEST_TOO_LARGE {limitBytes:261120}`. `busy`: 503 `{code:-32001, message:'PROVIDER_BUSY', data:{retryable:true}}`와
`Retry-After: 1`, provider는 붙어 있다. `closed`: provider를 분리하고(모든 pending 요청이 `PROVIDER_DISCONNECTED`) `close()`한 뒤 503
`PROVIDER_UNAVAILABLE`. `send`가 `closed`를 돌려주는 것은 socket이 파기됐거나 writable이 아니지만 codec이 아직 멈추지 않은(그 event가
아직 처리되지 않은) 짧은 사이뿐이다. codec이 멈추면 바로 `onClose`가 돌아 relay가 provider를 떼므로, 그 뒤의 요청은 R-MCP-021로 답을
받는다.\
근거: `src/server/peer-server.ts:2144`, `src/server/peer-server.ts:2148`, `src/server/peer-server.ts:2149`, `src/server/peer-server.ts:779`, `src/server/peer-server.ts:787`, `src/server/peer-server.ts:791`, `src/server/peer-server.ts:796`, `src/server/peer-server.ts:771`, `src/server/ws-upgrade.ts:365`, `src/server/ws-upgrade.ts:400`; 테스트: `test/relay-backpressure.test.ts` › `answers agent requests PROVIDER_BUSY instead of closing the provider, and serves them again once it reads`

**R-MCP-025** HTTP response가 쓰이기 전에 닫히면 relay는 그 요청의 pending 항목을 즉시 MUST 지운다. 그때 만드는 −32001
`CLIENT_DISCONNECTED`는 bridge에만 전달되고 wire에 나가지 않으며, 이후 provider 답은 버린다.\
근거: `src/server/peer-server.ts:2134`, `src/server/peer-server.ts:2138`, `src/server/peer-server.ts:2140`, `src/server/peer-server.ts:2154`; 테스트: `test/server-pending-settlement.test.ts` › `releases the pending slot as soon as the HTTP agent disconnects`

### 7.3 WebSocket `mcp` envelope (agent → relay)

**R-MCP-026** relay는 approved가 아닌 경우를 포함해 client socket의 `{type:'mcp', message}` frame을 다음 순서로 MUST 처리한다.

1. 크기(R-MCP-027). 유효한 요청에만 잰다.
2. 요청 유효성(R-MCP-028)
3. ticket status(R-MCP-029)
4. id가 없거나 null이면 `tools/call`이라도 notification으로 전달하고 끝(R-MCP-030)
5. `tools/call` 검사(R-MCP-020)
6. 같은 socket의 중복 id(R-MCP-031)
7. pending 상한(R-MCP-032)
8. wire id 할당(R-MCP-003), provider 유무(R-MCP-033)
9. pending 항목 생성(R-MCP-034)과 전달(R-MCP-035)

HTTP(R-MCP-007)와 순서가 다른 곳이 둘 있다. HTTP는 body 크기를 해석하기 전에 재지만 WebSocket의 1단계는 유효한 요청에만 적용되므로
id 크기와 유효성 오류가 크기 오류보다 앞선다(R-MCP-027). HTTP는 `tools/call` 검사가 notification 분기보다 앞이지만 WebSocket은
뒤다(R-MCP-020).

근거: `src/server/peer-server.ts:2674`, `src/server/peer-server.ts:2678`, `src/server/peer-server.ts:2684`, `src/server/peer-server.ts:2694`, `src/server/peer-server.ts:2707`, `src/server/peer-server.ts:2714`, `src/server/peer-server.ts:2736`, `src/server/peer-server.ts:2740`, `src/server/peer-server.ts:2744`, `src/server/peer-server.ts:2746`, `src/server/peer-server.ts:2755`, `src/server/peer-server.ts:2766`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`

**R-MCP-027** `message`가 유효한 요청(R-MCP-001)이고 받은 text나 `JSON.stringify(frame)`이 261120 byte를 넘으면, id가
`undefined`·`null`이 아닌 요청에는 그 id로 `{code:-32600, message:'REQUEST_TOO_LARGE', data:{limitBytes:261120}}`를 보내고, 그 밖은
답 없이 버린다. 아무것도 MUST NOT 전달한다. 크기는 `{type:'mcp', message}` envelope 전체로 잰다(→ O-37). 정확히 261120 byte인 요청은
relay의 stamp와 wire id가 붙어 커져도 전달한다. 262144 byte를 넘는 frame은 여기 오기 전에 codec이 1009로 닫는다. 유효한 요청이 아닌
`message`는 크기를 재지 않고 R-MCP-028로 간다. 그래서 261121~262144 byte frame이라도 문자열 id가 1024 byte를 넘으면
`REQUEST_ID_TOO_LARGE`(id null)를, 요청이 아니고 id가 문자열·수·null이면 그 id로 `INVALID_REQUEST`를 받는다. 같은 내용의 HTTP body는
해석하기 전에 413 `REQUEST_TOO_LARGE`(id null)를 받는다(R-MCP-008, → O-37).\
근거: `src/server/peer-server.ts:214`, `src/server/peer-server.ts:2678`, `src/server/peer-server.ts:2679`, `src/server/peer-server.ts:2680`, `src/server/peer-server.ts:2684`, `src/server/peer-server.ts:2687`, `src/server/peer-server.ts:2691`, `src/server/peer-server.ts:1942`; 테스트: `test/relay-message-limit.test.ts` › `forwards an agent request of exactly the request limit under a rewritten id, and answers one byte more with REQUEST_TOO_LARGE on the agent's socket`

**R-MCP-028** `message`가 요청이 아니면: object이고 문자열 id가 1024 byte를 넘으면 id null로 `REQUEST_ID_TOO_LARGE`
(`{limitBytes:1024}`). 아니면 id가 문자열·수·null이면 그 id로 data 없는 −32600 `INVALID_REQUEST`. id가 없거나 그 밖의 type이면,
또는 `message`가 object가 아니면 답하지 않는다. 어느 경우에도 MUST NOT 전달한다.\
근거: `src/server/peer-server.ts:2684`, `src/server/peer-server.ts:2685`, `src/server/peer-server.ts:2687`, `src/server/peer-server.ts:2690`, `src/server/peer-server.ts:2691`, `src/server/peer-server.ts:723`; 테스트: `test/relay-message-limit.test.ts` › `refuses a request id over 1 KiB of JSON without echoing or forwarding it, over WebSocket and HTTP`

**R-MCP-029** socket ticket이 approved가 아니면 relay는 method와 무관하게(`initialize`, `ping`, `tools/list` 포함) 전달하지 않고
data `{sessionId, approvalRequestId?}`로 MUST 답한다(ticket에 `approvalRequestId`가 없으면 그 member가 없다): pending은 −32053
`CLIENT_APPROVAL_REQUIRED`, rejected는 −32054 `CLIENT_APPROVAL_DENIED`, expired는 −32056 `SESSION_EXPIRED`, revoked·room-rotated는
−32001 `SESSION_INVALID`. id가 없으면 답하지 않고, id가 null이면 id null로 답한다(→ O-03, O-11, O-30). room에 붙어 있는 client
socket에서 실제로 나오는 것은 pending의 `CLIENT_APPROVAL_REQUIRED`뿐이다. ticket을 rejected·revoked·room-rotated로 바꾸는 모든
경로(R-ROOM-047)와 승인 만료(R-ROOM-026)는 그 ticket의 socket을 먼저 닫고 room에서 떼고, 목록에 없는 socket이나 ticket·room이 만료된
socket의 frame은 해석하기 전에 닫는다(R-ROOM-057). 나머지 세 분기는 방어용이다.\
근거: `src/server/peer-server.ts:2694`, `src/server/peer-server.ts:2695`, `src/server/peer-server.ts:2696`, `src/server/peer-server.ts:2697`, `src/server/peer-server.ts:2699`, `src/server/peer-server.ts:724`, `src/server/peer-server.ts:2665`, `src/server/peer-server.ts:1406`, `src/server/peer-server.ts:1408`, `src/server/peer-server.ts:1536`, `src/server/peer-server.ts:1538`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`

**R-MCP-030** approved ticket의 `message` id가 `undefined`나 `null`이면 relay는 method와 무관하게 notification으로 보고
`{...frame, from:'client', sessionId}`로 provider에 MUST 전달한다. `tools/call`도 R-MCP-020의 검사 없이 전달된다. provider가 없거나
`busy`·`too-large`면 답 없이 버리고, `closed`면 provider를 분리해 다음 요청이 `PROVIDER_UNAVAILABLE`을 받게 한다. HTTP와 다르다
(→ O-03, O-29). 참조 provider는 id가 없는 message에는 답하지 않지만 id가 null인 요청은 처리해 id null로 답한다(R-PEER-012). 그래서
id가 null인 `tools/call`은 relay의 catalog 검사 없이 승인 상태의 provider에서 host tool을 실행하고, 그 답은 room의 모든 agent
WebSocket에 broadcast된다(R-MCP-041).\
근거: `src/server/peer-server.ts:2705`, `src/server/peer-server.ts:2707`, `src/server/peer-server.ts:2711`, `src/server/peer-server.ts:2714`, `src/provider/peer-client.ts:1346`, `src/provider/peer-client.ts:1347`, `src/server/peer-server.ts:2611`; 테스트: `test/relay-backpressure.test.ts` › `drops an agent notification it cannot queue and refuses an offer to its sender, keeping the provider`

**R-MCP-031** 같은 agent socket에 id가 엄격히 같은(`===`) 요청이 provider를 기다리고 있으면 relay는 data 없는 −32600
`DUPLICATE_REQUEST_ID`로 MUST 답하고 전달하지 않는다. outbox에서 기다리는 frame은 비교하지 않는다. HTTP에는 이 검사가 없고
중복 id를 wire id로 바꾼다(→ O-36).\
근거: `src/server/peer-server.ts:704`, `src/server/peer-server.ts:706`, `src/server/peer-server.ts:2736`, `src/server/peer-server.ts:2737`; 테스트: 없음

**R-MCP-032** socket의 pending 수(room map에서 그 socket의 항목 + 그 outbox에서 기다리는 frame)가 이미 64 이상이면 relay는
`{code:-32087, message:'TOO_MANY_PENDING_REQUESTS', data:{limit:64}}`로 MUST 답한다. 답 하나가 slot 하나를 비운다. HTTP 요청은
agent별로 세지 않는다(→ O-36). 이 상한은 요청을 provider에 전달할지만 정한다. relay가 그 agent에게 쌓아 두는 frame 수의 상한이
아니다(R-MCP-042).\
근거: `src/server/peer-server.ts:79`, `src/server/peer-server.ts:150`, `src/server/peer-server.ts:715`, `src/server/peer-server.ts:2740`, `src/server/peer-server.ts:2741`; 테스트: `test/relay-message-limit.test.ts` › `lets an agent socket have at most 64 requests waiting for the provider`; `test/client-pending-limit.test.ts` › `still refuses the 65th request of an agent that does not queue, so the session's queue is what keeps to it`

**R-MCP-042** relay가 client socket에 직접 만드는 답 — `REQUEST_TOO_LARGE`, `REQUEST_ID_TOO_LARGE`, `INVALID_REQUEST`, 승인 상태
오류(R-MCP-029), `tools/call params are invalid`, `CATALOG_CHANGED`, `TOOL_NOT_FOUND`, `DUPLICATE_REQUEST_ID`,
`TOO_MANY_PENDING_REQUESTS` 자신, `offer.refused` — 은 pending 상한(R-MCP-032)에 막히지 않고 `replyToAgent`로 그 socket의
`AgentOutbox`에 MUST 들어간다(R-WS-031). outbox에는 기다리는 frame 수의 상한이 없다(이미 기다리는 frame이 있을 때 262144 byte를
넘는 frame만 `too-large`로 거절한다). 그 agent에게서 더 읽지 않는 것(`pause`)만이 상한인데, codec은 이미 읽은 chunk의
frame을 끝까지 처리하므로 한 번 읽은 chunk에 든 작은 요청마다 답이 queue에 쌓일 수 있다. 64(R-LIM-013)는 relay가 한 agent를 위해
쥐는 frame 수를 묶지 않는다.\
근거: `src/server/peer-server.ts:723`, `src/server/peer-server.ts:727`, `src/server/peer-server.ts:738`, `src/server/peer-server.ts:314`, `src/server/peer-server.ts:318`, `src/server/peer-server.ts:320`, `src/server/peer-server.ts:323`, `src/server/peer-server.ts:2694`, `src/server/peer-server.ts:2740`, `src/server/peer-server.ts:2793`, `src/server/ws-upgrade.ts:611`, `src/server/ws-upgrade.ts:613`; 테스트: `test/relay-backpressure.test.ts` › `sends an agent that is behind its approval, then ready, after the replies queued before them`

**R-MCP-033** 붙어 있는 provider가 없으면 relay는 data 없는 −32001 `PROVIDER_UNAVAILABLE`로 MUST 답한다.\
근거: `src/server/peer-server.ts:2746`, `src/server/peer-server.ts:2747`; 테스트: `test/relay-message-limit.test.ts` › `answers a %s agent PROVIDER_UNAVAILABLE and lets a reclaim attach a new provider`

**R-MCP-034** WebSocket pending 항목은 `includeCatalogMeta`(`params._meta`가 object면, `{}`도 참), `listsCatalog`(`server/discover`는
cursor와 무관하게, `tools/list`는 `params.cursor`가 `undefined`·`null`일 때 참), `server/discover`이면 `params.protocolVersion`으로
협상한 `protocolVersion`(R-MCP-016과 같은 규칙)을 MUST 기록한다.\
근거: `src/server/peer-server.ts:2753`, `src/server/peer-server.ts:2754`, `src/server/peer-server.ts:2761`, `src/server/peer-server.ts:2763`, `src/server/peer-server.ts:2764`; 테스트: `test/relay-message-limit.test.ts` › `answers a tools/list whose catalog the relay refuses with the relay's own catalog, never the refused one`

**R-MCP-035** relay는 `{...frame, from:'client', sessionId, message:<wire id로 바꾼 요청>}`을 provider에 보낸다. provider socket이
받지 못하면 pending 항목을 지우고 요청 id로 MUST 답한다. `too-large`는 `REQUEST_TOO_LARGE`, `busy`는 `PROVIDER_BUSY {retryable:true}`
(provider 유지), `closed`는 `PROVIDER_UNAVAILABLE`이고, `closed`면 그 답 뒤에 provider를 분리하고 `close()`한다
(`detachClosedProvider`: 다른 pending 요청은 `PROVIDER_DISCONNECTED`, codec이 이미 멈췄으면 close는 아무것도 하지 않는다).
`busy`·`too-large`는 어느 socket도 닫지 않고, `closed`도 agent socket은 닫지 않는다. `closed`는 R-MCP-024와 같은 짧은 사이에만 나온다.\
근거: `src/server/peer-server.ts:2766`, `src/server/peer-server.ts:2767`, `src/server/peer-server.ts:2770`, `src/server/peer-server.ts:2771`, `src/server/peer-server.ts:224`, `src/server/peer-server.ts:771`, `src/server/ws-upgrade.ts:437`; 테스트: `test/server-ws-frames.test.ts` › `answers the agent requests a provider that stops reading cannot take with a retryable PROVIDER_BUSY, and keeps the provider`

**R-MCP-036** WebSocket에서 relay는 어떤 MCP method에도 직접 답하지 않는다. `initialize`, `ping`, `tools/list`, `server/discover`,
`notifications/initialized`를 포함해 모두 provider에 MUST 전달한다. 그래서 WebSocket agent의 `initialize`에 provider는 agent가 요청한
version과 무관하게 `protocolVersion:'2026-07-28'`, `capabilities.tools.listChanged:true`로 답한다(R-PEER-015). relay가 개입하는 것은
whole-catalog listing 답뿐이다(R-MCP-038). 이것은 HTTP의 R-MCP-016과 `MCP_INITIALIZE_PROTOCOL_VERSIONS`의 설명과 다르다(→ O-01).\
근거: `src/server/peer-server.ts:2674`, `src/server/peer-server.ts:2766`, `src/provider/peer-client.ts:1392`, `src/provider/peer-client.ts:1397`, `src/provider/commit-receipt.ts:3`; 테스트: `test/relay-message-limit.test.ts` › `stamps every mcp frame it forwards to the provider with from: client and the ticket's sessionId`

### 7.4 provider 답 처리

**R-MCP-037** relay는 붙어 있는 provider socket의 답(R-MCP-002)을 `rpcKey(id)`로 pending 항목과 맞춘다. 맞는 항목이 없으면 조용히
버린다. 맞으면 timer와 항목을 지우고 agent에게 `replyToAgent`(WebSocket은 outbox, HTTP는 bridge)로 MUST 보낸다. 모양은
R-MCP-006, listing이면 R-MCP-038이다.\
근거: `src/server/peer-server.ts:2595`, `src/server/peer-server.ts:2597`, `src/server/peer-server.ts:2598`, `src/server/peer-server.ts:2599`, `src/server/peer-server.ts:2604`; 테스트: `test/relay-message-limit.test.ts` › `delivers a ~200 KB tool result to a WebSocket agent (fragmented by the relay) and keeps both sockets`

**R-MCP-038** `listsCatalog` 답은 다음과 같이 MUST 처리한다.

- 오류가 없고 `result.nextCursor`가 `undefined`·`null`이 아니면 그대로 전달한다.
- 오류가 없으면 R-CAT-014로 `result.tools`를 평가한다. `accepted`·`unchanged`면 provider 답을 전달한다. agent가 `_meta`를
  보냈으면 `result` 최상위에 relay의 `catalogVersion`·`catalogHash`를 덮어 넣는다(`_meta` 안이 아니다, → O-31).
- 평가가 `invalid`·`too-large`이거나 provider가 오류로 답했고 room에 catalog가 있으면, agent의 id로 relay 자신의 listing
  (R-MCP-039)을 보낸다. 거절한 catalog는 절대 넘기지 않는다.
- room에 catalog가 없으면 거절은 −32603 `CATALOG_TOO_LARGE` `{limitBytes:260096, announcementBytes}` 또는 data 없는 −32603
  `CATALOG_INVALID`로, provider 오류(예: −32090 `CATALOG_UNAVAILABLE`)는 그대로 전달한다.

근거: `src/server/peer-server.ts:966`, `src/server/peer-server.ts:971`, `src/server/peer-server.ts:972`, `src/server/peer-server.ts:974`, `src/server/peer-server.ts:976`, `src/server/peer-server.ts:978`, `src/server/peer-server.ts:986`, `src/server/peer-server.ts:989`; 테스트: `test/relay-message-limit.test.ts` › `answers a tools/list whose catalog the relay refuses with the relay's own catalog, never the refused one`; `test/relay-message-limit.test.ts` › `answers CATALOG_TOO_LARGE or CATALOG_INVALID to a tools/list whose catalog the relay refuses while it holds none`; `test/relay-message-limit.test.ts` › `passes on the provider's CATALOG_UNAVAILABLE to a WebSocket listing while the relay holds no catalog`

**R-MCP-039** relay 자신의 WebSocket listing은 `tools/list`면 `result:{tools, catalogVersion?, catalogHash?}`(stamp는 agent가 `_meta`를
보냈을 때만, `_meta` object 없음), `server/discover`면 HTTP 결과(R-MCP-019: 기록한 협상 version, `serverInfo`, `tools`, socket
ticket status를 `auth.state`로 한 `_meta`)에 `_meta`를 보냈으면 최상위 stamp를 더한 것이다. relay는 이 모양을 MUST 쓴다.\
근거: `src/server/peer-server.ts:998`, `src/server/peer-server.ts:999`, `src/server/peer-server.ts:1000`, `src/server/peer-server.ts:1001`, `src/server/peer-server.ts:1004`; 테스트: `test/relay-message-limit.test.ts` › `answers a WebSocket agent's tools/list and server/discover from the relay's catalog when the provider answers with an error`; `test/relay-message-limit.test.ts` › `takes a catalog from a server/discover result like a tools/list one, and answers a refused one from the relay's catalog`

**R-MCP-040** WebSocket agent에게 보낼 답 frame이 relay의 stamp 뒤 262144 byte를 넘어 outbox가 `too-large`를 돌려주면 relay는 대신
agent의 id로 `{code:-32603, message:'RESULT_TOO_LARGE', data:{limitBytes:262144}}`를 MUST 보낸다. 어느 socket도 닫지 않는다.
HTTP bridge에는 크기 상한이 없어 이 오류가 없다(→ O-11).\
근거: `src/server/peer-server.ts:132`, `src/server/peer-server.ts:2604`, `src/server/peer-server.ts:2605`, `src/server/peer-server.ts:320`, `src/server/peer-server.ts:2126`; 테스트: `test/relay-message-limit.test.ts` › `answers RESULT_TOO_LARGE when the relay's catalog metadata pushes a provider reply over the limit`

**R-MCP-041** 답이 아닌 provider `mcp` message(notification, server→client 요청, id가 null인 답)는 R-SIG-004대로 pending ticket의
socket을 포함한 모든 agent WebSocket에 MUST broadcast한다. HTTP agent는 이것을 받지 못한다. relay가 만드는
`notifications/tools/list_changed`(R-CAT-008)와 provider가 보낸 것은 agent에게 구별되지 않는다.\
근거: `src/server/peer-server.ts:2595`, `src/server/peer-server.ts:2611`, `src/server/peer-server.ts:820`; 테스트: 없음

**R-MCP-043** relay는 수 id가 유한한지 보지 않으므로 agent는 `JSON.parse`가 유한한 수로 읽는 id를 SHOULD 쓴다. `JSON.parse`는
`1e400`을 `Infinity`로 읽고, 그런 id는 R-MCP-001의 요청이며(수 id는 크기 검사도 없다) pending key는 `number:Infinity`다.
relay가 쓰는 frame과 HTTP body는 모두 `JSON.stringify`를 거치므로 이 id는 wire에서 `null`이 된다: provider에 전달하는 요청도,
relay 자신의 답과 오류도 id null이다. 참조 provider는 id null 요청에 id null로 답하고(R-PEER-012), relay는 그 답을 답으로 보지
않아(R-MCP-002) room의 모든 agent WebSocket에 broadcast한다(R-MCP-041). 그래서 중계한 요청의 pending 항목은 timeout까지 남고,
agent는 id null인 `MCP_REQUEST_TIMEOUT`을 받는다. HTTP와 WebSocket이 같다. `-0`은 key가 `number:0`이고 `0`으로 직렬화되며,
2^53을 넘는 정수 id는 `JSON.parse`가 반올림한 값으로 되돌아간다.\
근거: `src/server/peer-server.ts:675`, `src/server/peer-server.ts:221`, `src/server/peer-server.ts:691`, `src/server/peer-server.ts:687`, `src/server/peer-server.ts:2141`, `src/server/peer-server.ts:2143`, `src/server/peer-server.ts:2155`, `src/server/peer-server.ts:2750`, `src/server/peer-server.ts:2766`, `src/server/peer-server.ts:2611`, `src/provider/tool-call.ts:83`; 테스트: 없음

### 7.5 버전 협상 요약

| 경로 | 누가 답하나 | `protocolVersion` | capabilities |
|---|---|---|---|
| HTTP `initialize` | relay | 요청값이 initialize-era 4개 중 하나면 그 값, 아니면 `2025-11-25` | `{tools:{listChanged:false}, stateless:true}` |
| HTTP `server/discover` | relay | 위와 같은 협상 | 없음 |
| HTTP 그 밖 | — | `MCP-Protocol-Version` header가 있으면 initialize-era 값이어야 함(R-MCP-011) | — |
| WebSocket `initialize` | provider | 언제나 `2026-07-28` | `{tools:{listChanged:true}, stateless:true}` |
| WebSocket `server/discover` | provider(catalog를 받아들일 때) 또는 relay(거절·오류 시) | provider: `2026-07-28`와 `supportedProtocolVersions` 5개. relay: 협상 값 | provider만 있음 |
| `PeerMcpSession.initialize` 요청 | client | `options.protocolVersion ?? '2025-11-25'` | `{}` |

근거는 R-MCP-016, R-MCP-019, R-MCP-011, R-MCP-036, R-PEER-015, R-PEER-039에 있다(→ O-01).

## 8. 오류

**R-ERR-001** relay는 JSON-RPC 오류를 `{code:<정수>, message:<canonical 이름>, data?}`로 MUST 보낸다. canonical 이름은 UPPER_SNAKE
문자열이다. 예외는 relay·provider의 `tools/call params are invalid`와 provider의 `Invalid Request`, `Method not found`,
`Internal error`다. 많은 이름이 code를 공유하므로 agent는 code만으로 오류를 구별할 수 없고 `message`로 구별해야 한다(→ O-12).
JSON-RPC code를 공유하는 것은 −32000(`SSE_STREAM_NOT_SUPPORTED`, `SESSION_TERMINATION_NOT_SUPPORTED`), −32001, −32003(relay의
`CLIENT_TOKEN_REQUIRED`, provider의 `CLIENT_APPROVAL_REQUIRED`, → O-02), −32008, −32056, −32600, −32602, −32603이다. 수명주기 body의
`code` −32002도 `ROOM_LEASE_BINDING_INVALID`와 `SESSION_BINDING_INVALID`가 함께 쓴다.\
근거: `src/server/peer-server.ts:110`, `src/server/peer-server.ts:116`, `src/server/peer-server.ts:122`, `src/server/peer-server.ts:723`, `src/server/peer-server.ts:1343`, `src/server/peer-server.ts:1803`, `src/server/peer-server.ts:1864`, `src/server/peer-server.ts:1869`, `src/server/peer-server.ts:2358`, `src/provider/peer-client.ts:1349`, `src/provider/peer-client.ts:1356`, `src/provider/peer-client.ts:1413`, `src/client/errors.ts:62`; 테스트: `test/live-demo.e2e.test.ts` › `resolves canonical error names from numeric JSON-RPC errors`; `test/live-demo.e2e.test.ts` › `reports a revoked session as SESSION_INVALID instead of catalog drift`

**R-ERR-002** relay의 수명주기 HTTP 오류 body는 `{error:<이름>, code?:<정수>, …문맥 필드}`이고 status는 아래 표를 MUST 따른다.
MCP endpoint(`POST`·`GET`·`DELETE /p/:id/mcp`의 JSON-RPC 응답)는 `{jsonrpc:'2.0', id, error}` 모양이다. `/p/:id/mcp` 경로에도
수명주기 모양으로 답하는 경우가 넷 있다. 허용되지 않은 Origin의 `OPTIONS` preflight는 403 `{error:'CORS_ORIGIN_DENIED', origin}`
(R-HTTP-010), 그 밖의 method는 403 `{error:'ORIGIN_NOT_ALLOWED', origin}`(R-HTTP-011)이다. id가 `[A-Za-z0-9_-]{1,128}`에 맞지
않거나 method가 `OPTIONS`·`GET`·`POST`·`DELETE`가 아니면(예: `PUT`, `PATCH`, `HEAD`) 404 `{error:'NOT_FOUND'}`(R-HTTP-001,
R-HTTP-002)다. 잡히지 않은 예외는 500 `{error:'PEER_REQUEST_FAILED'}` 또는 `formatHttpError`가 정한 `{error, requestId?}`(R-HTTP-003)다.
`customHttpHandler`가 먼저 답한 응답은 이 규칙 밖이다.\
근거: `src/server/peer-server.ts:1653`, `src/server/peer-server.ts:1670`, `src/server/peer-server.ts:1736`, `src/server/peer-server.ts:1858`, `src/server/peer-server.ts:1864`, `src/server/peer-server.ts:1953`, `src/server/peer-server.ts:2005`, `src/server/peer-server.ts:2482`, `src/server/peer-server.ts:468`, `src/server/peer-server.ts:485`; 테스트: `test/client-request-limit.test.ts` › `surfaces the relay's HTTP 413 REQUEST_TOO_LARGE as a JSON-RPC error of that call only`

**R-ERR-003** relay와 provider는 아래 표의 오류를 표의 code, status, close code, data로, 표의 조건에서 MUST 낸다. 표는 이 문서의
다른 요건이 규정한 오류를 한곳에 모은 것이며, 둘이 어긋나면 해당 요건이 우선한다. "—"는 해당 없음, "200(진행)"은 진행 중인 HTTP
요청에 200으로 전달된다는 뜻이다.\
근거: `src/server/peer-server.ts:1342`, `src/server/peer-server.ts:1585`, `src/server/peer-server.ts:2695`; 테스트: `test/server-pending-settlement.test.ts` › `answers ROOM_EXPIRED when the sweeper expires the room %s`

**R-ERR-004** agent client는 relay의 JSON-RPC 오류를 `PeerMcpRpcError`로 MUST 올린다. 그 `code`는 canonical 이름이다: 문자열
`error.code`, 아니면 UPPER_SNAKE인 `data.code`, 아니면 UPPER_SNAKE인 `message`, 아니면 `MCP_RPC_ERROR`. HTTP transport는 JSON-RPC
오류 body가 있는 non-2xx에 `error.httpStatus`를 붙이고(id가 null이면 요청 id로 채움), 그 밖의 non-2xx는 `{code:'HTTP_<status>',
message: body.error || statusText || 'MCP endpoint failed'}`로 만든다. 로컬 오류는 문자열 code의 `PeerMcpError`다.\
근거: `src/client/errors.ts:15`, `src/client/errors.ts:62`, `src/client/transport.ts:161`, `src/client/transport.ts:166`, `src/client/transport.ts:176`; 테스트: `test/live-demo.e2e.test.ts` › `resolves canonical error names from numeric JSON-RPC errors`; `test/live-demo.e2e.test.ts` › `reports a revoked session as SESSION_INVALID instead of catalog drift`

### 8.1 오류 표

행은 relay MCP JSON-RPC 오류, provider JSON-RPC·tool 결과 오류, signaling `error` frame, relay HTTP 수명주기 오류(body
`{error, …}`), WebSocket upgrade 거절과 close code, agent client·provider 로컬 오류(wire에 나가지 않음) 순서다. "code" 열은
JSON-RPC code 또는 수명주기 body의 `code` 필드다.

| 이름 | code (JSON-RPC·body) | HTTP status | close | data | 발신 | 조건 | 근거 |
|---|---|---|---|---|---|---|---|
| `PARSE_ERROR` | −32700 | 400 | — | 없음, id null | relay HTTP | MCP body가 UTF-8·JSON이 아님(빈 body, BOM 포함) | `src/server/peer-server.ts:1949` |
| `INVALID_REQUEST` | −32600 | 400(HTTP) | — | 없음 | relay | JSON-RPC 요청이 아님, batch, HTTP `id: null`. HTTP는 id null, WS는 문자열·수·null id를 echo | `src/server/peer-server.ts:1952`, `src/server/peer-server.ts:1958`, `src/server/peer-server.ts:2691` |
| `REQUEST_ID_TOO_LARGE` | −32600 | 400(HTTP) | — | `{limitBytes:1024}`, id null 또는 requestId 없음 | relay | 문자열 id·offer requestId의 JSON이 1024 byte 초과 | `src/server/peer-server.ts:141`, `src/server/peer-server.ts:1951`, `src/server/peer-server.ts:2687`, `src/server/peer-server.ts:2782` |
| `REQUEST_TOO_LARGE` | −32600 | 413(HTTP) | — | `{limitBytes:261120}` | relay(HTTP, WS, `offer.refused`) | 요청이 받은 그대로나 재직렬화로 261120 byte 초과, 또는 provider `send`가 `too-large` | `src/server/peer-server.ts:110`, `src/server/peer-server.ts:1943`, `src/server/peer-server.ts:1964`, `src/server/peer-server.ts:2680` |
| `DUPLICATE_REQUEST_ID` | −32600 | — | — | 없음 | relay WS | 같은 socket에 `===` 같은 id가 pending | `src/server/peer-server.ts:2737` |
| `UNSUPPORTED_PROTOCOL_VERSION` | −32600 | 400 | — | `{supported:[4개], requested}` | relay HTTP | `initialize`가 아닌 POST의 지원하지 않는 `MCP-Protocol-Version` | `src/server/peer-server.ts:1975` |
| `TOO_MANY_PENDING_REQUESTS` | −32087 | — | — | `{limit:64}` | relay WS | socket pending + outbox 대기가 64 이상 | `src/server/peer-server.ts:150`, `src/server/peer-server.ts:2741` |
| `PROVIDER_UNAVAILABLE` | −32001 | 503 | — | 없음 | relay(HTTP, WS, `offer.refused`) | provider socket 없음, 또는 `send`가 `closed`(provider 분리) | `src/server/peer-server.ts:116`, `src/server/peer-server.ts:2104`, `src/server/peer-server.ts:2747` |
| `PROVIDER_BUSY` | −32001 | 503 + `Retry-After: 1` | — | `{retryable:true}` | relay(HTTP, WS, `offer.refused`) | provider 송신 queue가 가득 참. provider 유지 | `src/server/peer-server.ts:122`, `src/server/peer-server.ts:791` |
| `PROVIDER_DISCONNECTED` | −32001 | 200(진행) | — | 없음 | relay | pending 중 provider socket이 닫힘·교체·분리, server 종료 | `src/server/peer-server.ts:1033` |
| `MCP_REQUEST_TIMEOUT` | −32001 | 200(진행) | — | 없음 | relay | `mcpRequestTimeoutMs` 안에 답 없음 | `src/server/peer-server.ts:2141`, `src/server/peer-server.ts:2751` |
| `CLIENT_DISCONNECTED` | −32001 | wire에 안 나감 | — | 없음 | relay 내부 | HTTP response가 쓰기 전에 닫힘 | `src/server/peer-server.ts:2138` |
| `SESSION_INVALID` | −32001 | 401(새 요청), 200(진행) | — | HTTP `{roomId, sessionId, approvalRequired}`, WS `{sessionId, approvalRequestId?}`, 진행·종료는 없음 | relay | revoked ticket(WS는 room-rotated도. 붙은 socket에서는 닿지 않음, R-MCP-029), 전체 revoke의 진행 요청, revoke·만료된 ticket socket의 pending 요청 | `src/server/peer-server.ts:1347`, `src/server/peer-server.ts:1535`, `src/server/peer-server.ts:1590`, `src/server/peer-server.ts:2696` |
| `CLIENT_TOKEN_REQUIRED` | −32003 | 401 | — | `{roomId, sessionId:null, approvalRequired}` | relay HTTP | 중계 method에 유효한 `Bearer` ticket 없음 | `src/server/peer-server.ts:1343` |
| `ROOM_NOT_FOUND` | −32004 | 404 | — | `{roomId}` | relay HTTP | 중계 method의 모르는 room | `src/server/peer-server.ts:1992` |
| `CATALOG_CHANGED` | −32010 | 409(HTTP) | — | `{catalogVersion, catalogHash}`(relay 현재 값) | relay | `tools/call`의 `_meta` catalog 값이 room과 다름(WS는 id가 있는 `tools/call`만) | `src/server/peer-server.ts:2092`, `src/server/peer-server.ts:2725` |
| `CLIENT_APPROVAL_REQUIRED` | −32053 | 403 | — | HTTP `{roomId, sessionId, approvalRequired}`, WS `{sessionId, approvalRequestId?}` | relay | pending ticket | `src/server/peer-server.ts:1344`, `src/server/peer-server.ts:2696` |
| `CLIENT_APPROVAL_DENIED` | −32054 | 403 | — | 위와 같음, 종료 시 pending 요청은 없음 | relay | rejected ticket(WS는 붙은 socket에서 닿지 않음, R-MCP-029), 거절된 ticket socket의 pending 요청 | `src/server/peer-server.ts:1345`, `src/server/peer-server.ts:1535` |
| `SESSION_EXPIRED` | −32056 | 410 | — | 위와 같음 | relay | expired ticket(예: 승인 만료. WS는 붙은 socket에서 닿지 않음, R-MCP-029) | `src/server/peer-server.ts:1346`, `src/server/peer-server.ts:2696` |
| `ROOM_EXPIRED` (MCP) | −32056 | 410(새 요청), 200(진행) | — | `{roomId, roomEpoch}` | relay HTTP | 중계 method의 만료 room, sweep이 끝낸 진행 요청 | `src/server/peer-server.ts:2000`, `src/server/peer-server.ts:1589` |
| `ROOM_ROTATED` (MCP) | −32057 | 410(새 요청), 200(진행) | — | HTTP `{replacementRoomId, roomId, roomEpoch}`, WS pending은 없음 | relay | 중계 method의 rotate된 room, rotate가 끝낸 진행 요청, rotate된 ticket socket의 pending 요청 | `src/server/peer-server.ts:1996`, `src/server/peer-server.ts:1587`, `src/server/peer-server.ts:1535` |
| `CATALOG_UNAVAILABLE` (relay) | −32090 | 503 | — | `{catalogSource}` | relay HTTP | `tools/list`·`server/discover`의 snapshot이 빔 | `src/server/peer-server.ts:2009` |
| `tools/call params are invalid` | −32602 | 400(HTTP) | — | 없음 | relay, provider | `tools/call`에 비어 있지 않은 문자열 `name`이 없음 | `src/server/peer-server.ts:2082`, `src/server/peer-server.ts:2717`, `src/provider/peer-client.ts:1428` |
| `TOOL_NOT_FOUND` | −32602 | 400(HTTP) | — | 없음 | relay | room catalog에 없는 tool 이름(WS는 id가 있는 `tools/call`만) | `src/server/peer-server.ts:2099`, `src/server/peer-server.ts:2732` |
| `RESULT_TOO_LARGE` (relay) | −32603 | — | — | `{limitBytes:262144}` | relay WS | stamp 뒤 답 frame이 262144 byte 초과 | `src/server/peer-server.ts:132`, `src/server/peer-server.ts:2605` |
| `CATALOG_TOO_LARGE` (listing 답) | −32603 | — | — | `{limitBytes:260096, announcementBytes}` | relay WS | catalog 없는 room에서 listing 답의 announcement 초과 | `src/server/peer-server.ts:979` |
| `CATALOG_INVALID` (listing 답) | −32603 | — | — | 없음 | relay WS | catalog 없는 room에서 listing 답의 catalog 무효 | `src/server/peer-server.ts:984` |
| `BODY_CONSUMED` (MCP) | −32603 | 500 | — | 없음, id null | relay HTTP | 앞선 reader가 MCP body를 읽음 | `src/server/peer-server.ts:156`, `src/server/peer-server.ts:1939` |
| `SSE_STREAM_NOT_SUPPORTED` | −32000 | 405, `Allow: POST` | — | 없음, id null | relay HTTP | SSE만 받는 `GET /p/:id/mcp` | `src/server/peer-server.ts:1864` |
| `SESSION_TERMINATION_NOT_SUPPORTED` | −32000 | 405, `Allow: GET, POST` | — | 없음, id null | relay HTTP | `DELETE /p/:id/mcp` | `src/server/peer-server.ts:1869` |
| `Invalid Request` | −32600 | — | — | 없음, id null | provider | `jsonrpc:'2.0'`이지만 id가 문자열·수·null이 아닌 DataChannel 요청. relay는 id가 없거나 null·문자열·수인 message만 전달하므로(R-MCP-001) relay socket으로는 오지 않는다. 만들어져 relay에 가더라도 id null 답이라 답으로 보지 않고 broadcast한다(R-MCP-041) | `src/provider/peer-client.ts:1349`, `src/server/peer-server.ts:675`, `src/server/peer-server.ts:2611` |
| `Method not found` | −32601 | 200 | — | 없음 | provider | 처리하지 않는 method | `src/provider/peer-client.ts:1413` |
| `Internal error` | −32603 | 200 | — | 없음 | provider | 요청 처리 중 예외 | `src/provider/peer-client.ts:1330` |
| `CLIENT_APPROVAL_REQUIRED` (provider) | −32003 | 200 | — | 없음 | provider | provider의 approvalState가 `approved`가 아님(→ O-02) | `src/provider/peer-client.ts:1356` |
| `PEER_SESSION_SUPERSEDED` | −32008 | 200 | — | 없음 | provider | 지난 connection generation의 요청 | `src/provider/peer-client.ts:1352` |
| `OUTCOME_UNKNOWN` | −32008 | 200 | — | 없음 | provider | tool 실행 중 generation이 바뀌거나 run이 사라짐 | `src/provider/peer-client.ts:1520` |
| `CATALOG_UNAVAILABLE` (provider) | −32090 | 200 | — | `{reason}` | provider | 중계된 `tools/list`·`server/discover`에 등록한 catalog가 없거나 거절됨 | `src/provider/peer-client.ts:1373` |
| `RESULT_TOO_LARGE` (provider) | −32603(`tools/call` 외) | 200 | — | 없음. `tools/call`은 `isError` 결과의 `error.code:'RESULT_TOO_LARGE'`(문자열) | provider | provider 답 frame이 262144 byte 초과 | `src/provider/tool-call.ts:237`, `src/provider/tool-call.ts:246` |
| `AI_RUN_TERMINAL`, `AI_RUN_LIMIT_EXCEEDED`, `AI_RUN_REJECTED`, `RECONCILIATION_REQUIRED` | — | 200 | — | `isError` 결과의 문자열 `error.code` | provider | 종료된 run, 128 run 모두 진행 중, 그 밖의 run 시작 실패, ledger의 outcome-unknown 기록 | `src/provider/peer-client.ts:1446`, `src/provider/peer-client.ts:1465`, `src/provider/peer-client.ts:1477` |
| host 예외 | — | 200 | — | `isError` 결과의 `error.code: -32603`(수) | provider | host `invoke`가 던짐 | `src/provider/peer-client.ts:1546` |
| `CATALOG_INVALID` (frame) | −32602 | — | — | `reason`, `registerSeq?` | relay→provider | register catalog 무효 | `src/server/peer-server.ts:936` |
| `CATALOG_TOO_LARGE` (frame) | −32602 | — | — | `limitBytes:260096`, `reason`, `registerSeq?` | relay→provider | announcement가 260096 byte 초과 | `src/server/peer-server.ts:938` |
| `INVALID_APPROVAL` (frame) | −32081 | — | — | `requestId`(문자열 또는 null) | relay→provider | `approval.decision`이 무효이거나 대상 요청이 없음 | `src/server/peer-server.ts:2563` |
| `CORS_ORIGIN_DENIED` | — | 403 | — | `{origin}` | relay | 허용되지 않은 Origin의 preflight | `src/server/peer-server.ts:1653` |
| `ORIGIN_NOT_ALLOWED` | — | 403 | — | `{origin}` | relay | 허용되지 않은 Origin의 그 밖 요청 | `src/server/peer-server.ts:1670` |
| `NOT_FOUND` | — | 404 | — | — | relay | 맞는 route 없음(method·id 문법 불일치 포함) | `src/server/peer-server.ts:2482` |
| `PEER_REQUEST_FAILED` | — | 500 | — | `{requestId?}` | relay | 처리되지 않은 예외(hook 없음) | `src/server/peer-server.ts:485` |
| `BODY_TOO_LARGE` | — | 413 | — | — | relay | JSON body가 65536 byte 초과(drain 안) | `src/server/peer-server.ts:1301` |
| `INVALID_JSON_BODY` | — | 400 | — | — | relay | JSON body가 UTF-8·JSON·object가 아님 | `src/server/peer-server.ts:1308` |
| `BODY_CONSUMED` | — | 500 | — | — | relay | 앞선 reader가 JSON body를 읽음 | `src/server/peer-server.ts:1297` |
| `PUBLISH_RATE_LIMITED` | −32088 | 429 | — | `{retryAfterMs}`, `Retry-After`, `X-RateLimit-*` | relay | `POST /p` rate 초과 | `src/server/peer-server.ts:1724` |
| `PUBLISH_RATE_LIMIT_UNAVAILABLE` | −32089 | 503 | — | `{retryAfterMs:1000}`, `Retry-After: 1`, `X-RateLimit-*` | relay | rate-limit store 실패 | `src/server/peer-server.ts:1711` |
| `PUBLISH_KEY_REQUIRED` | — | 401 | — | — | relay | publish key 설정 시 token 없음 | `src/server/peer-server.ts:1228` |
| `PUBLISH_KEY_INVALID` | — | 401 | — | — | relay | 틀린 publish key | `src/server/peer-server.ts:1230` |
| `PUBLISH_OWNER_BINDING_INVALID` | — | 403 | — | — | relay | owner 힌트 충돌 | `src/server/peer-server.ts:1749` |
| `CAPABILITIES_INVALID` | — | 400 | — | — | relay | `POST /p`·join의 capabilities 무효 | `src/server/peer-server.ts:1757`, `src/server/peer-server.ts:2195` |
| `ROOM_NOT_FOUND` | — | 404 | — | — | relay | 수명주기 route의 room 없음·교체·만료(route별 R-ROOM 요건) | `src/server/peer-server.ts:1779`, `src/server/peer-server.ts:2172`, `src/server/peer-server.ts:2254`, `src/server/peer-server.ts:2300`, `src/server/peer-server.ts:2346`, `src/server/peer-server.ts:2412` |
| `ROOM_ROTATED` | −32057 | 410 | — | `{roomId, roomEpoch, replacementRoomId}` | relay | join, session status, reclaim의 rotate된 room | `src/server/peer-server.ts:1783`, `src/server/peer-server.ts:2168`, `src/server/peer-server.ts:2304` |
| `ROOM_ROTATED` (rotate binding) | −32057 | 409 | — | `{roomId, roomEpoch, replacementRoomId:null}` | relay | rotate body의 roomId·roomEpoch 불일치(→ O-04) | `src/server/peer-server.ts:2425` |
| `ROOM_EXPIRED` (reclaim) | — | 404 | — | — | relay | room 또는 reconnect lease 만료 | `src/server/peer-server.ts:1791` |
| `ROOM_LEASE_BINDING_INVALID` | −32002 | 409 | — | `{roomId, roomEpoch}` | relay | reclaim leaseToken 없음, epoch·roomId 불일치 | `src/server/peer-server.ts:1803` |
| `ROOM_LEASE_INVALID` | — | 401 | — | — | relay | lease hash 불일치 | `src/server/peer-server.ts:1808` |
| `ROOM_PROVIDER_ACTIVE` | — | 409 | — | `{roomId, roomEpoch}` | relay | provider socket이 붙어 있는 room의 reclaim | `src/server/peer-server.ts:1812` |
| `INVITE_TOKEN_REQUIRED` | — | 401 | — | — | relay | join에 invite 없음 | `src/server/peer-server.ts:2182` |
| `INVITE_TOKEN_CONSUMED` | — | 409 | — | — | relay | 소비된 invite(유효성 확인 전) | `src/server/peer-server.ts:2186` |
| `INVITE_TOKEN_INVALID` | — | 403 | — | — | relay | 틀린 invite | `src/server/peer-server.ts:2190` |
| `CRDT_CAPABILITY_NOT_GRANTED` | — | 403 | — | — | relay | room에 없는 `mcp-crdt` 요청 | `src/server/peer-server.ts:2199` |
| `PROVIDER_TOKEN_REQUIRED` | — | 401 | — | — | relay | approval·rotate의 providerToken 없음·틀림 | `src/server/peer-server.ts:2258`, `src/server/peer-server.ts:2416` |
| `INVALID_APPROVAL` | −32081 | 409 | — | — | relay | HTTP 결정 body 불일치, 이미 결정됨 | `src/server/peer-server.ts:2272`, `src/server/peer-server.ts:2277` |
| `CLIENT_TOKEN_REQUIRED` | — | 401 | — | — | relay | session status·client revoke의 token 불일치 | `src/server/peer-server.ts:2313`, `src/server/peer-server.ts:2383` |
| `SESSION_NOT_FOUND` | — | 404 | — | — | relay | providerToken으로 모르는 session | `src/server/peer-server.ts:2313`, `src/server/peer-server.ts:2371` |
| `SESSION_BINDING_INVALID` | −32002 | 409 | — | — | relay | revoke의 roomId·roomEpoch 불일치 | `src/server/peer-server.ts:2358`, `src/server/peer-server.ts:2391` |
| `SESSION_BINDING_INVALID` (session) | — | 403 | — | — | relay | client revoke가 다른 sessionId를 지목 | `src/server/peer-server.ts:2387` |
| `CATALOG_UNAVAILABLE` (GET) | — | 503 | — | `{catalogVersion:0, catalogHash, auth?}` | relay | `GET /p/:id/mcp/tools`·`GET /mcp/catalog`에 tool 없음 | `src/server/peer-server.ts:1835`, `src/server/peer-server.ts:1922` |
| `CATALOG_HASH_NOT_FOUND` | — | 404 | — | `{catalogHash:<현재>}` | relay | 현재가 아닌 catalog hash | `src/server/peer-server.ts:1839` |
| Origin not allowed (upgrade) | — | 403 raw text | — | 본문 `Origin not allowed` | relay | upgrade Origin 거절 | `src/server/peer-server.ts:2494` |
| upgrade 거절 | — | 없음(파기) | — | — | relay | 경로·room·ticket 거절, 예외 | `src/server/peer-server.ts:2519`, `src/server/peer-server.ts:2526`, `src/server/peer-server.ts:2653`, `src/server/peer-server.ts:2831` |
| `BAD_UPGRADE` | — | 없음(파기) | — | — | relay codec | `Upgrade`·version·key 위반 | `src/server/ws-upgrade.ts:281` |
| `RESERVED_BITS`, `RESERVED_OPCODE`, `UNMASKED_FRAME`, `BAD_CONTROL_FRAME`, `INTERLEAVED`, `BAD_CONTINUATION`, `BAD_CLOSE_PAYLOAD` | — | — | 1002 | — | relay codec | R-WS-013, R-WS-014, R-WS-019 | `src/server/ws-upgrade.ts:471`, `src/server/ws-upgrade.ts:476`, `src/server/ws-upgrade.ts:226` |
| `TEXT_ONLY` | — | — | 1003 | — | relay codec | binary frame | `src/server/ws-upgrade.ts:473` |
| `INVALID_UTF8` | — | — | 1007 | — | relay codec | UTF-8이 아닌 text message | `src/server/ws-upgrade.ts:571` |
| `FRAGMENT_LIMIT`, `FRAME_LIMIT`, `MESSAGE_LIMIT` | — | — | 1009 | — | relay codec | R-WS-015, R-WS-016 | `src/server/ws-upgrade.ts:482`, `src/server/ws-upgrade.ts:494`, `src/server/ws-upgrade.ts:502` |
| owner 예외 | — | — | 1011 | — | relay codec | `onText` 예외(relay에서는 나오지 않음) | `src/server/ws-upgrade.ts:600` |
| stall | — | — | 1013 | — | relay codec | R-WS-026 | `src/server/ws-upgrade.ts:392` |
| 정상 close | — | — | 1000 | — | relay | 2.4 표 | `src/server/peer-server.ts:771` |
| `REQUEST_TOO_LARGE` (client) | 문자열 | — | — | `{bytes, limitBytes:261120}` | client | 보낼 frame·body가 261120 byte 초과 | `src/client/transport.ts:54` |
| `REQUEST_ID_TOO_LARGE` (client) | 문자열 | — | — | `{bytes, limitBytes:1024}` | client | raw가 아닌 transport의 문자열 id가 1024 byte 초과 | `src/client/transport.ts:71` |
| `REQUEST_TIMEOUT` | 문자열 | — | — | `{method, id}` | client | 요청(slot 대기 포함) 시간 초과 | `src/client/session.ts:634`, `src/client/session.ts:725` |
| `TRANSPORT_TIMEOUT` | 문자열 | — | — | 없음 | client | socket이 열리지 않은 채 ready 대기 시간 초과 | `src/client/session.ts:395` |
| `PEER_TRANSPORT_ERROR` | 문자열 | — | — | 받은 relay `error` frame, 또는 Error가 아닌 transport 오류 값 | client | 문자열 `code`가 없는 relay `error` frame(있으면 그 문자열이 code다), Error가 아닌 transport 오류 | `src/client/session.ts:512`, `src/client/session.ts:513`, `src/client/session.ts:555` |
| `TRANSPORT_CLOSED`, `SESSION_DISCONNECTED`, `TRANSPORT_NOT_OPEN`, `NOT_CONNECTED`, `ROOM_ID_REQUIRED`, `INVALID_TRANSPORT`, `TRANSPORT_UNAVAILABLE` | 문자열 | — | — | — | client | transport 닫힘·끊음, 열리기 전 send, transport 없음 | `src/client/session.ts:565`, `src/client/session.ts:897`, `src/client/transport.ts:118` |
| `TOOL_NAME_REQUIRED`, `TOOL_NOT_FOUND` (client), `INVALID_TOOL_RESULT`, `INVALID_RESPONSE`, `INVALID_TOOLS_LIST`, `INVALID_TOOL_DESCRIPTOR`, `TOOL_NAME_TOO_LONG`, `DUPLICATE_TOOL`, `MCP_RPC_ERROR`, `HTTP_<status>` | 문자열 | — | — | — | client | R-PEER-033~R-PEER-044 | `src/client/session.ts:818`, `src/client/session.ts:822`, `src/client/catalog-hash.ts:70`, `src/client/errors.ts:23` |
| `CATALOG_CHANGED` (`PeerMcpCatalogChangedError`) | 문자열 | — | — | catalog snapshot | client | drift 오류를 받고 catalog를 새로 읽은 뒤 | `src/client/session.ts:843` |
| `SESSION_REVOKED`, `ROOM_ROTATED`, `APPROVAL_EXPIRED`, `SESSION_EXPIRED`, `CLIENT_APPROVAL_DENIED` (client) | 문자열 | — | — | 받은 frame | client | relay 종료 frame, `waitForPeerApproval` 상태 | `src/client/session.ts:465`, `src/client/room-lifecycle.ts:227` |
| `CLIENT_TOKEN_REQUIRED`, `SESSION_REVOKE_FAILED`, `INVITE_TOKEN_REQUIRED`, `INVALID_JOIN_RESPONSE`, `SESSION_REQUIRED`, `INVALID_SESSION_STATUS`, `APPROVAL_ABORTED`, `APPROVAL_TIMEOUT`, `PROVIDER_TOKEN_REQUIRED`, `INVALID_ROTATE_RESPONSE`, `SESSION_NOT_FOUND` (service) | 문자열 | — | — | — | client | 수명주기 helper(R-PEER-046~R-PEER-051) | `src/client/session.ts:923`, `src/client/session.ts:953`, `src/client/room-lifecycle.ts:107`, `src/client/room-lifecycle.ts:143`, `src/client/room-lifecycle.ts:239`, `src/client/service.ts:62` |
| `CATALOG_TOO_LARGE` (session error) | — | — | — | 문자열 | provider | register frame이 258048 byte 초과 | `src/provider/peer-client.ts:320` |
| `Signaling connection timeout`, `Signaling WebSocket error`, `Signaling socket closed unexpectedly`, `ROOM_PROVIDER_ACTIVE`, `INVALID_ROOM_DESCRIPTOR`, `INVALID_RECLAIMED_ROOM_DESCRIPTOR`, `PEER_SESSION_NOT_CONFIGURED`, `PEER_SESSION_SUPERSEDED` | — | — | — | — | provider | R-PEER-001~R-PEER-005, R-PEER-024, R-PEER-026 | `src/provider/peer-client.ts:834`, `src/provider/peer-client.ts:857`, `src/provider/peer-client.ts:862`, `src/provider/peer-client.ts:799`, `src/provider/peer-client.ts:756`, `src/provider/peer-client.ts:790`, `src/provider/peer-client.ts:1894` |

signaling frame의 reason 값: `approval.expired`는 `APPROVAL_EXPIRED`, `approval.rejected`는 결정 reason 또는 `CLIENT_APPROVAL_DENIED`,
`session.revoked`는 `SESSION_REVOKED`·`CLIENT_REVOKED`·`ROOM_REVOKED`·`ROOM_EXPIRED`, client용 `room.rotated`는 `ROOM_ROTATED`다.

## 9. peer 의무

### 9.1 provider (`WebMcpPeerClient`)

**R-PEER-001** provider는 `connect()`에서 먼저 `disconnect()`하고 serverUrl을 정규화한다(끝 `/` 제거, `http://`·`https://`로
시작하지 않으면(대소문자 구분) `http://` 붙임). 그다음 `POST <serverUrl>/p`를 `Content-Type: application/json`,
`Authorization: Bearer <publishKey || 'local-development-only'>`, body `{alias, title, capabilities}`로 MUST 보낸다.
`capabilities`는 `enableCrdt === true`면 `['mcp-control','mcp-crdt']`, 아니면 `['mcp-control']`이다. `approvalRequired`와
`ttlMs`는 보내지 않으므로 provider가 만든 room은 언제나 승인이 필요하고 기본 TTL이다. 520-526은 Cloudflare edge 오류로, 그 밖의
non-2xx는 body `error` 또는 `HTTP <status>: Failed to create signaling room`으로 실패한다.\
근거: `src/provider/peer-client.ts:699`, `src/provider/peer-client.ts:709`, `src/provider/peer-client.ts:731`, `src/provider/peer-client.ts:741`, `src/provider/peer-client.ts:746`, `src/provider/peer-client.ts:753`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-PEER-002** provider는 `POST /p`, reclaim, rotate의 descriptor가 `/^[A-Za-z0-9_-]{1,128}$/`에 맞는 `id`와 비어 있지 않은
`providerToken`, `descriptorUrl`, `inviteToken`을 가지는지 MUST 검사하고, 아니면 `INVALID_ROOM_DESCRIPTOR`(reclaim은
`INVALID_RECLAIMED_ROOM_DESCRIPTOR`)로 실패한다. 형식이 틀린 선택 필드(safe integer ≥ 0이 아닌 `roomEpoch`, 유한하지 않은
`expiresAt`·`reconnectTokenExpiresAt`, 문자열이 아닌 capability)는 거절하지 않고 버린다. 초대 URL은
`<descriptorUrl>#invite=<inviteToken>`(인코딩 없음)이다. 로컬 만료는 descriptor의 `expiresAt`이 미래면 그 값, 아니면 now + 30분이다
(→ O-54).\
근거: `src/provider/wire-schemas.ts:74`, `src/provider/wire-schemas.ts:89`, `src/provider/peer-client.ts:130`, `src/provider/peer-client.ts:822`, `src/provider/peer-client.ts:825`; 테스트: 없음

**R-PEER-003** provider는 `<serverUrl의 앞 http를 ws로(대소문자 구분)>/p/<id>/provider`(roomId 인코딩 없음)를 subprotocol
`['webmcp-peer.v1', 'ticket.<providerToken>']`으로 MUST 연다(→ O-16).\
근거: `src/provider/peer-client.ts:829`, `src/provider/peer-client.ts:830`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-PEER-004** provider는 `type:'ready'` frame을 최대 10000 ms MUST 기다린다. 그 전의 다른 frame은 무시한다. 시간이 지나면
`Signaling connection timeout`, socket 오류면 `Signaling WebSocket error`, `ready` 전에 socket이 닫히면(state가 아직 `creating`이거나,
그 socket이 현재 socket이 아니거나, generation이 바뀌었을 때) `Signaling socket closed unexpectedly`로 실패한다. `ready`가 왔지만
generation이 바뀌었으면 `PEER_SESSION_SUPERSEDED`다. timeout이나 socket 오류로 실패해도 provider는 그 socket을 닫지도 떼지도 않고
`ready` handler도 남겨 둔다. 그래서 같은 generation에 늦게 온 `ready`는 `connect()`가 이미 거절된 뒤에도 아래 처리를 모두 한다.
`ready`를 받으면 state를 `waiting`으로 하고 재접속 횟수를 0으로 되돌리고, 25000 ms마다 `{type:'ping', timestamp}`를 보내는
keepalive를 시작하고, 첫 `register`를 보내고, 같은 read에 이어 오는 승인 frame(pending 재전송, `approval.restored`)을 놓치지 않도록
정상 상태 handler를 동기적으로 단다. `ready`의 roomEpoch·capabilities·expiresAt은 읽지 않고 descriptor 값을 쓴다. relay의 `pong`은
무시한다.\
근거: `src/provider/peer-client.ts:833`, `src/provider/peer-client.ts:834`, `src/provider/peer-client.ts:836`, `src/provider/peer-client.ts:838`, `src/provider/peer-client.ts:842`, `src/provider/peer-client.ts:844`, `src/provider/peer-client.ts:845`, `src/provider/peer-client.ts:848`, `src/provider/peer-client.ts:852`, `src/provider/peer-client.ts:855`, `src/provider/peer-client.ts:857`, `src/provider/peer-client.ts:859`, `src/provider/peer-client.ts:861`, `src/provider/peer-client.ts:862`, `src/provider/peer-client.ts:759`, `src/provider/peer-client.ts:885`, `src/provider/peer-client.ts:1090`; 테스트: `test/provider-reconnect.test.ts` › `are not lost when they arrive in the same read as ready`; `test/provider-reconnect.test.ts` › `serves an approved client announced right after ready, in the same read`

**R-PEER-005** provider가 relay socket에 보내는 모든 frame(`register`, `mcp` 답, `answer`, `release`, `ping`, `approval.decision`)은
`sendRelayFrame`을 거친다. 직렬화한 UTF-8 크기가 262144 byte를 넘으면 보내지 않고 `console.warn('[WebMCP] The <n>-byte <label>
frame exceeds the relay's 262144-byte message limit; it was not sent.')`을 남긴다. `ws.send`가 던져도 보내지 않은 것이다. provider는
262144 byte를 넘는 frame을 MUST NOT 보낸다.\
근거: `src/provider/peer-client.ts:102`, `src/provider/peer-client.ts:105`, `src/provider/peer-client.ts:111`, `src/provider/tool-call.ts:47`; 테스트: `test/provider-register-limit.test.ts` › `does not send an approval decision over the limit, and leaves the request pending`; `test/provider-register-limit.test.ts` › `drops the answer to an offer whose requestId takes it over the limit, and keeps the provider socket`

**R-PEER-006** provider는 `ready` 뒤와 `syncTools()`마다 `{type:'register', alias, registerSeq, tools}`를 MUST 보낸다.
`registerSeq`는 이전 값 + 1이고 client 객체 수명 동안(연결·room을 넘어) 계속 증가한다. host `listTools`가 던지면 아무것도 보내지
않고 번호도 쓰지 않는다. 직렬화하고 나면 번호를 쓴 것이며, 보냈든 보류했든 socket이 거절했든 마찬가지다.\
근거: `src/provider/peer-client.ts:299`, `src/provider/peer-client.ts:302`, `src/provider/peer-client.ts:306`, `src/provider/peer-client.ts:316`; 테스트: `test/provider-register-limit.test.ts` › `stamps every register frame with a registerSeq that keeps increasing, across connections too`

**R-PEER-007** `syncTools()`는 frame을 열린(readyState 1) socket에 넘겼을 때만 `true`를 MUST 돌려준다.\
근거: `src/provider/peer-client.ts:267`, `src/provider/peer-client.ts:270`, `src/provider/peer-client.ts:273`, `src/provider/peer-client.ts:327`; 테스트: `test/relay-message-limit.test.ts` › `withholds a register frame over 256 KiB, reports CATALOG_TOO_LARGE on an open socket, and registers once the catalog shrinks`

**R-PEER-008** register, `tools/list`, `server/discover`는 모두 `toWireToolDescriptor(tool)` = `{name, title?(truthy일 때만),
description, inputSchema(기본 {type:'object', properties:{}}), outputSchema?, annotations?}`를 MUST 쓴다. 그래서 relay catalog가
채널마다 흔들리지 않는다.\
근거: `src/provider/types.ts:115`, `src/provider/types.ts:123`; 테스트: `test/catalog-contract.test.ts` › `publishes the same descriptor via register and tools/list so the relay catalog never flaps`; `test/catalog-contract.test.ts` › `serializes host tools deterministically with an MCP-valid inputSchema`

**R-PEER-009** UTF-8 크기가 258048 byte(`PEER_RELAY_MAX_CATALOG_BYTES`)를 넘는 register frame을 provider는 MUST NOT 보낸다. socket은
열어 두고 relay에는 알리지 않으며, session error를 `CATALOG_TOO_LARGE: the register frame for N tool(s) is B bytes, over the relay
protocol's 258048-byte catalog limit`로 정한다. 정확히 258048 byte면 보낸다. frame을 socket에 넘기면 `CATALOG_INVALID`·
`CATALOG_TOO_LARGE`로 시작하는 session error를 지운다. session error가 바뀔 때마다 구독자에게 알린다.\
근거: `src/provider/peer-client.ts:318`, `src/provider/peer-client.ts:320`, `src/provider/peer-client.ts:331`, `src/provider/peer-client.ts:361`; 테스트: `test/provider-register-limit.test.ts` › `sends a register frame of exactly the catalog limit and withholds one a byte larger`; `test/provider-register-limit.test.ts` › `notifies a CATALOG_TOO_LARGE set during connect() to a listener subscribed before it, and the cleared error later`

**R-PEER-010** `message`가 정확히 `CATALOG_INVALID` 또는 `CATALOG_TOO_LARGE`인 relay `error` frame은 거절 문구
`<message>: <reason ?? 'relay rejected the tool catalog'>`가 된다. provider는 frame의 `registerSeq`가 없거나 마지막으로 보낸
catalog의 번호와 같으면 그 catalog에 거절을 기록하고, `registerSeq`가 없거나(이전 relay) 최신 번호(보냈든 보류했든)와 같을 때만
session error로 MUST 삼는다. 더 오래된 번호의 거절은 무시한다. 다른 relay `error` frame(예: −32081 `INVALID_APPROVAL`)은 기록만
하고 상태를 바꾸지 않는다.\
근거: `src/provider/peer-client.ts:1042`, `src/provider/peer-client.ts:1044`, `src/provider/peer-client.ts:1047`, `src/provider/peer-client.ts:1050`, `src/provider/peer-client.ts:1054`; 테스트: `test/provider-register-limit.test.ts` › `ignores the late rejection of an earlier register once a newer one was sent`; `test/provider-register-limit.test.ts` › `takes a rejection without registerSeq, from a relay that predates it, to answer the latest register`; `test/provider-reconnect.test.ts` › `does not report unrelated relay errors as a catalog failure`

**R-PEER-011** relay socket으로 온 `tools/list`·`server/discover`에 provider는 현재 (serverUrl, roomId)에 마지막으로 보낸 register
frame의 tools(보낸 직렬화 그대로)로 MUST 답한다. live host catalog로 답하지 않는다. 이 room에 보낸 frame이 없거나 relay가 그것을
거절했으면 `{code:-32090, message:'CATALOG_UNAVAILABLE', data:{reason}}`이다. reason은 거절 문구, 현재 `CATALOG_*` session error,
또는 `the provider has not registered a tool catalog with this relay room`이다. reclaim한 room(같은 roomId)은 끊기기 전 등록한
catalog를 계속 쓴다. DataChannel로 온 요청에는 live host catalog로 답한다.\
근거: `src/provider/peer-client.ts:347`, `src/provider/peer-client.ts:349`, `src/provider/peer-client.ts:356`, `src/provider/peer-client.ts:1367`, `src/provider/peer-client.ts:1373`; 테스트: `test/provider-register-limit.test.ts` › `answers tools/list and server/discover with the last registered catalog while a larger one is withheld`; `test/provider-register-limit.test.ts` › `lists the catalog as it was sent, not host descriptors changed in place since`; `test/provider-register-limit.test.ts` › `lists the live host catalog to a DataChannel agent, which talks to the provider directly`

**R-PEER-012** provider는 `jsonrpc:'2.0'`이고 `id` member가 있는 object에만 MUST 답한다(id 없음은 notification, 답 없음). id가
문자열·수·null이 아니면 `{id:null, error:{code:-32600, message:'Invalid Request'}}`. 지난 connection generation의 요청은 −32008
`PEER_SESSION_SUPERSEDED`. provider 하나의 room 단위 `approvalState`가 `approved`가 아니면 relay socket의 모든 method에 −32003
`CLIENT_APPROVAL_REQUIRED`(→ O-02)다. DataChannel은 승인 상태에서만 frame을 받으므로 그 전의 요청은 답 없이 버린다. relay가 찍은 `from`·`sessionId`나 `params._meta.sessionId`는 승인된 session과 비교하지 않는다
(→ O-43). `ping`은 `result:{}`, 모르는 method는 −32601 `Method not found`, 예상하지 못한 예외는 −32603 `Internal error`다. id가
null인 요청은 id null로 답한다(→ O-03).\
근거: `src/provider/peer-client.ts:1345`, `src/provider/peer-client.ts:1346`, `src/provider/peer-client.ts:1349`, `src/provider/peer-client.ts:1352`, `src/provider/peer-client.ts:1356`, `src/provider/peer-client.ts:1250`, `src/provider/peer-client.ts:1405`, `src/provider/peer-client.ts:1413`, `src/provider/peer-client.ts:1330`; 테스트: `test/provider-reconnect.test.ts` › `ignores a restored approval for another room epoch`

**R-PEER-013** `tools/call`은 비어 있지 않은 문자열 `params.name`이 MUST 있어야 하고, 없으면 −32602 `tools/call params are invalid`다.
`arguments`가 object가 아니면 `{}`다. host를 `invoke(name, args, {signal})`로 부른다(`stopAiRun`이 abort한다). host를 부른 결과와
run·ledger 규칙(R-PEER-016)으로 거절하거나 되풀이한 결과는 언제나 JSON-RPC `result`(CallToolResult)다. `tools/call`이 JSON-RPC `error`로
답하는 것은 이 params 무효(−32602)와 −32008 `OUTCOME_UNKNOWN`(R-PEER-016)뿐이다(R-PEER-012의 거절은 이보다 앞선다).
host 값이 비어 있지 않은 MCP content block 목록(`text`, `image`, `audio`, `resource_link`, `resource`), object
`structuredContent`, boolean `isError` 중 하나를 가지면 CallToolResult로 보고 `isError`를 다시 계산해
(`res.isError === true`, 또는 `res.ok`·`structuredContent.ok`가 있고 falsy) 넘기며, 유효한 content가 없으면 payload text block을
만든다. 그 밖의 값은 payload P(object가 아니면 `{value}`)로 `{content:[text], structuredContent:P, data:P, isError:('ok' in P &&
!P.ok)}`다. text block은 JSON(P)가 16384 byte 이하일 때만 P를 되풀이한다. host가 던지면 `{isError:true, content:[{type:'text',
text}], structuredContent:{ok:false, error:{code:-32603, message}}, data, error}`다(→ O-59).\
근거: `src/provider/peer-client.ts:1421`, `src/provider/peer-client.ts:1428`, `src/provider/peer-client.ts:1491`, `src/provider/peer-client.ts:1520`, `src/provider/peer-client.ts:1539`, `src/provider/peer-client.ts:1546`, `src/provider/tool-call.ts:36`, `src/provider/tool-call.ts:105`, `src/provider/tool-call.ts:150`, `src/provider/tool-call.ts:201`; 테스트: `test/provider-tool-call.test.ts` › `forwards a host CallToolResult as is instead of nesting it`; `test/provider-tool-call.test.ts` › `publishes a plain payload as structuredContent with a JSON text block`; `test/provider-tool-call.test.ts` › `gives a thrown host error a readable text block`

**R-PEER-014** relay socket으로 보낼 답 frame `{type:'mcp', message}`이 262144 byte를 넘으면 provider는 그것을 MUST 바꾼다.
결과가 있는 `tools/call`은 `toolErrorResult({code:'RESULT_TOO_LARGE', message:'The result of tool "<name>" is <B> bytes, over the
relay's 262144-byte message limit; the tool ran but its result was not delivered'})` 결과로, 그 밖은 data 없는 `{code:-32603,
message:'RESULT_TOO_LARGE'}`로 바꾼다. 대체한 것도 들어가지 않으면 보내지 않는다(기록). socket은 열어 둔다. DataChannel 답은 크기를
검사하지 않는다(→ O-11).\
근거: `src/provider/tool-call.ts:226`, `src/provider/tool-call.ts:237`, `src/provider/tool-call.ts:246`, `src/provider/tool-call.ts:248`, `src/provider/peer-client.ts:892`; 테스트: `test/provider-tool-call.test.ts` › `answers RESULT_TOO_LARGE for a result over the limit and keeps the socket open`; `test/provider-tool-call.test.ts` › `answers a non-tools/call request with a JSON-RPC error`; `test/provider-tool-call.test.ts` › `drops a reply when not even the error fits`

**R-PEER-015** provider는 `initialize`에 요청 version과 무관하게 `{protocolVersion:'2026-07-28', capabilities:{tools:{listChanged:true},
stateless:true}, serverInfo, instructions}`로, `server/discover`에 `{protocolVersion:'2026-07-28',
supportedProtocolVersions:MCP_PROTOCOL_VERSIONS, capabilities:{tools:{listChanged:true}, stateless:true}, serverInfo, instructions,
tools}`로 MUST 답한다. 기본 serverInfo는 `{name:'wireframe-storyboard-toolkit', version:'0.4.2'}`다. relay는 WebSocket에서 이 답을
그대로(`server/discover`는 R-MCP-038에 따라) 전달한다(→ O-01).\
근거: `src/provider/peer-client.ts:1362`, `src/provider/peer-client.ts:1376`, `src/provider/peer-client.ts:1392`, `src/provider/commit-receipt.ts:1`, `src/provider/commit-receipt.ts:2`; 테스트: 없음

**R-PEER-016** `tools/call`의 AI run id는 trim한 `params._meta.framebook.aiTrace.runId`(128자 이하), 없으면 암묵 run
`remote-webmcp-<roomId 앞 6자>`다. stopped·completed·failed·rolled-back run의 호출은 `isError` 결과 `{code:'AI_RUN_TERMINAL'}`,
추적하는 128개 run이 모두 작업 중이면 즉시 `{code:'AI_RUN_LIMIT_EXCEEDED'}`다. 결과(`isError`, `{ok:false}`, 예외)로 run을 실패시키거나
완료하는 것은 명시한 run뿐이고 암묵 run은 끝나지 않는다. tool 실행 중 generation이 바뀌거나 run이 사라지면 결과 대신 −32008
`OUTCOME_UNKNOWN`이다. ledger가 설정됐고 `arguments.context.requestId`가 있으면 outcome-unknown 기록은 host를 부르지 않고
`RECONCILIATION_REQUIRED`, durable·replicating·replicated 기록은 host를 부르지 않고 `{ok:true, receipt, data:{replayed:true}}`로
되풀이한다. provider는 이 규칙을 MUST 따른다.\
근거: `src/provider/peer-client.ts:1417`, `src/provider/peer-client.ts:1438`, `src/provider/peer-client.ts:1446`, `src/provider/peer-client.ts:1465`, `src/provider/peer-client.ts:1477`, `src/provider/peer-client.ts:1520`, `src/provider/ai-run-controller.ts:72`; 테스트: `test/provider-tool-call.test.ts` › `keeps answering untraced calls after a host throw and after an { ok: false } result`; `test/provider-tool-call.test.ts` › `still fails a run the agent named, and refuses later calls on it`; `test/provider-tool-call.test.ts` › `answers a call immediately when every tracked run has work in flight, then evicts idle runs`

**R-PEER-017** `approval.request`를 받으면 provider는 `requestId`(`payload.requestId ?? frame.requestId`), `clientLabel`
(`payload.clientLabel`, 기본 `AI Agent`), `sessionId`, `roomEpoch`(payload 먼저, 다음 frame, 없으면 room 값)를 읽고
`approvalState = 'pending'`, state `waiting`으로 MUST 바꾸고 알린다. 새 `approval.request`는 `approved`를 포함한 이전 승인 상태를
덮어쓴다(→ O-43).\
근거: `src/provider/peer-client.ts:914`, `src/provider/peer-client.ts:917`, `src/provider/peer-client.ts:918`, `src/provider/peer-client.ts:929`, `src/provider/peer-client.ts:934`; 테스트: `test/provider-reconnect.test.ts` › `are not lost when they arrive in the same read as ready`

**R-PEER-018** `approveClient(requestId)`와 `rejectClient`는 `approvalState`가 `pending`이고 socket이 열려 있을 때만
`{protocol:'webmcp-peer/1', messageId:'approval-<requestId>-<Date.now()>', type:'approval.decision', roomId,
roomEpoch: approvalRoomEpoch ?? roomEpoch ?? 0, sessionId?, requestId, sentAt, payload:{requestId, sessionId(없으면 ''),
roomId(없으면 ''), roomEpoch, decision, decidedAt, reason?}}`를 MUST 보낸다. 거절의 reason은 `CLIENT_REJECTED`다. frame을 보내지
못하면(크기 초과 등) `false`를 돌려주고 요청은 pending으로 남는다. 보내면 relay의 echo를 기다리지 않고 승인은 `approved`, 거절은
`revoked`로 바꾼다(→ O-18).\
근거: `src/provider/peer-client.ts:1834`, `src/provider/peer-client.ts:1838`, `src/provider/peer-client.ts:1839`, `src/provider/peer-client.ts:1844`, `src/provider/peer-client.ts:1866`; 테스트: `test/provider-register-limit.test.ts` › `does not send an approval decision over the limit, and leaves the request pending`

**R-PEER-019** relay의 `approval.approved` echo는 provider가 이미 스스로 `approved`일 때만 RTCPeerConnection을 MUST 준비한다.
`approval.rejected`는 `approvalState`를 `revoked`로, state를 `waiting`으로 둔다.\
근거: `src/provider/peer-client.ts:940`, `src/provider/peer-client.ts:941`, `src/provider/peer-client.ts:946`; 테스트: 없음

**R-PEER-020** `approval.restored`는 `sessionId`가 비어 있지 않고, provider에 roomEpoch가 있고 frame의 roomEpoch(payload 먼저)와
같고, `roomId`가 있으면 현재 room과 같고, `payload.expiresAt`이 수면 미래일 때만 MUST 받아들인다. 받아들이면
`approvalState = 'approved'`, 그 session을 승인 session·carrier session으로, `clientLabel = payload ?? 이전 ?? 'AI Agent'`,
`approvalRequestId = null`로 한다.\
근거: `src/provider/peer-client.ts:1062`, `src/provider/peer-client.ts:1068`, `src/provider/peer-client.ts:1069`, `src/provider/peer-client.ts:1070`, `src/provider/peer-client.ts:1077`; 테스트: `test/provider-reconnect.test.ts` › `ignores a restored approval for another room epoch`; `test/provider-reconnect.test.ts` › `keeps an approved agent working across a lease reclaim`

**R-PEER-021** provider는 `approval.expired`를 `APPROVAL_EXPIRED`, `collaboration.expired`를 `SESSION_EXPIRED`, `room.rotated`를
`ROOM_ROTATED`로 session 만료(approvalState `expired`, state `disconnected`, transport 정리, 재접속 없음)로 MUST 처리한다.
`session.revoked`, `collaboration.revoked`, `collaboration.role-updated`, `collaboration.guest-linked`는 `SESSION_REVOKED`로 revoke하고
auto-reconnect를 끄며 localStorage `webmcp:auto-reconnect`를 `'false'`로 둔다. 그 밖의 type은 무시한다. 이 중 relay가 provider
socket에 실제로 보내는 것은 rotate의 `room.rotated`뿐이다(결정 echo `approval.approved`·`approval.rejected`는 R-PEER-019, → O-18).\
근거: `src/provider/peer-client.ts:954`, `src/provider/peer-client.ts:959`, `src/provider/peer-client.ts:964`, `src/provider/peer-client.ts:1137`, `src/provider/peer-client.ts:1146`, `src/server/peer-server.ts:2441`; 테스트: 없음

**R-PEER-022** provider는 `approvalState`가 `approved`일 때만 `offer`에 답한다. requestId는 `offer.requestId`가 비어 있지 않은
문자열이면 그 값, 아니면 이 signaling socket에서 받은 마지막 `approval.request`의 requestId(`payload.requestId ?? frame.requestId`),
그것도 없으면 `''`다. 이 값은 socket마다 따로 두고 `approval.restored`는 바꾸지 않으므로, reclaim 뒤 relay가 승인을
`approval.restored`로만 되살린 socket에 requestId 없는 offer가 오면 `{type:'answer', requestId:'', sdp}`로 답한다. `approval.approved`
echo로 RTCPeerConnection을 준비할 때 쓰는 requestId도 같은 규칙이다. RTCPeerConnection(기본 `iceServers`
`[{urls:'stun:stun.l.google.com:19302'}]`, `bundlePolicy:'max-bundle'`)을 만들거나 다시 쓰고, offer를 적용하고 answer를 만들고 ICE
수집이 끝나거나 2000 ms가 될 때까지 기다린 뒤 `{type:'answer', requestId, sdp}`를 MUST 보낸다. trickle ICE frame은 없다. answer를
보내지 못하면 반쯤 협상한 RTCPeerConnection을 닫는다. RTCPeerConnection이 없는 환경에서는 아무것도 하지 않는다.\
근거: `src/provider/peer-client.ts:877`, `src/provider/peer-client.ts:916`, `src/provider/peer-client.ts:942`, `src/provider/peer-client.ts:974`, `src/provider/peer-client.ts:976`, `src/provider/peer-client.ts:1077`, `src/provider/peer-client.ts:995`, `src/provider/peer-client.ts:999`, `src/provider/peer-client.ts:1004`, `src/provider/peer-client.ts:1174`; 테스트: `test/provider-register-limit.test.ts` › `drops the answer to an offer whose requestId takes it over the limit, and keeps the provider socket`

**R-PEER-023** 승인 상태에서 DataChannel(원격이 만든 label `mcp`)로 `{type:'hello'}`가 오면 provider는 state를 `connected`로 하고
채널에 `{type:'grant', protocol:'webmcp-peer/1', requestId, sessionId, expiresAt}`를 보낸 뒤 relay socket에 `{type:'release',
requestId}`를 보내고 relay socket을 MUST 닫는다(재접속하지 않음). 그 뒤 relay에는 이 room의 provider socket이 없다. DataChannel이
닫히면 state는 `disconnected`, `approved`는 `revoked`다. 이 package에는 offer·hello를 보내는 agent 구현이 없다(→ O-45).\
근거: `src/provider/peer-client.ts:1252`, `src/provider/peer-client.ts:1264`, `src/provider/peer-client.ts:1267`, `src/provider/peer-client.ts:1286`, `src/provider/peer-client.ts:1288`, `src/provider/peer-client.ts:1289`; 테스트: 없음

**R-PEER-024** 브라우저(window 있음)에서 provider는 room lease를 localStorage `webmcp:room-lease:<encodeURIComponent(serverUrl)>:
<encodeURIComponent(replicaId)>`에 `{serverUrl, roomId, roomEpoch, leaseToken:reconnectToken, expiresAt: reconnectTokenExpiresAt ??
expiresAt, alias?}`로 저장한다(token과 roomId가 있고 roomEpoch가 safe integer ≥ 0이고 만료 전일 때만). `reclaimLease: true`이고
저장한 lease의 serverUrl이 현재 serverUrl과 같으면(끝 `/` 무시) `POST <serverUrl>/p/<encodeURIComponent(roomId)>/reclaim`을
`Content-Type`만 단 채 body `{roomId, roomEpoch, leaseToken}`으로 MUST 보낸다. 2xx면 descriptor를 검사해
(`INVALID_RECLAIMED_ROOM_DESCRIPTOR`) 그 room에 붙는다. 409 `ROOM_PROVIDER_ACTIVE`는 모두 4번 시도하도록 100, 200, 300 ms 뒤 다시
보내고 그래도 409 `ROOM_PROVIDER_ACTIVE`면 `ROOM_PROVIDER_ACTIVE`로 실패한다. 그 밖의 non-2xx는 401·404·410이면 저장한 lease를 지우고,
그 밖(예: 409 `ROOM_LEASE_BINDING_INVALID`)이면 lease를 둔 채, 어느 경우든 새 room을 `POST /p`로 조용히 만든다(새 초대 URL, → O-44).
lease가 없거나 serverUrl이 다르면 reclaim 없이 `POST /p`다. reclaim `fetch`가 던지면(네트워크 오류) `POST /p`로 물러나지 않고
`connect()`가 그 오류로 실패한다(state `error`). `reclaimLease`가 없는 수동 `connect()`는 먼저 lease를 지운다.\
근거: `src/provider/peer-client.ts:418`, `src/provider/peer-client.ts:438`, `src/provider/peer-client.ts:707`, `src/provider/peer-client.ts:727`, `src/provider/peer-client.ts:728`, `src/provider/peer-client.ts:759`, `src/provider/peer-client.ts:761`, `src/provider/peer-client.ts:775`, `src/provider/peer-client.ts:777`, `src/provider/peer-client.ts:778`, `src/provider/peer-client.ts:779`, `src/provider/peer-client.ts:790`, `src/provider/peer-client.ts:794`, `src/provider/peer-client.ts:796`, `src/provider/peer-client.ts:799`, `src/provider/peer-client.ts:801`, `src/provider/peer-client.ts:804`; 테스트: `test/provider-reconnect.test.ts` › `keeps an approved agent working across a lease reclaim`

**R-PEER-025** signaling socket이 닫히면(DataChannel로 넘긴 경우·지난 generation 제외) state `connected`·`waiting`은
`disconnected`가 되고, `autoReconnect`가 켜져 있고 approvalState가 `expired`가 아니고 state가 `idle`이 아니면
`min(1000 × 1.5^(n−1), 15000)` ms 뒤 재접속을 MUST 예약한다. 시도마다 저장한 설정을 읽어 `connect({..., reclaimLease:true})`를
부른다. state를 `error`로 남긴 실패만 다음 시도를 예약하고, 성공한 `ready`가 횟수를 되돌리며, `disconnect()`가 반복을 멈춘다.
auto-reconnect는 브라우저에서만 돈다: window가 없거나, `shouldSuppressAutoReconnect(window.location)`이 참이거나, localStorage
`webmcp:auto-reconnect`가 `'false'`이거나, `webmcp:server-url`이 없으면 시도를 건너뛰고 반복이 끝난다. close code는 읽지 않는다
(→ O-23, O-44).\
근거: `src/provider/peer-client.ts:582`, `src/provider/peer-client.ts:602`, `src/provider/peer-client.ts:628`, `src/provider/peer-client.ts:632`, `src/provider/peer-client.ts:645`, `src/provider/peer-client.ts:1018`, `src/provider/types.ts:55`; 테스트: `test/provider-reconnect.test.ts` › `keeps retrying with growing delays while the relay is down, then reclaims the room`; `test/provider-reconnect.test.ts` › `stops retrying after a manual disconnect`

**R-PEER-026** `refreshRoom(overrides)`는 이전 `connect()`가 없으면 `PEER_SESSION_NOT_CONFIGURED`로 실패하고, room이나
providerToken이 없으면 이전 option에 overrides를 합쳐 그냥 연결한다. 있으면 현재 serverUrl로 `POST <serverUrl>/p/<roomId>/rotate`를
`Authorization: Bearer <providerToken>`, body `{roomId, roomEpoch: roomEpoch ?? 0, requestedAt(ISO), alias}`로 보낸다. non-2xx면 끊지 않고
`body.error` 또는 `HTTP <status>: Failed to rotate peer room`으로 실패하고, 2xx body가 descriptor가 아니면 `INVALID_ROOM_DESCRIPTOR`로
실패한다. 성공하면 끊고, 합친 option의 serverUrl에서 끝 `/`를 지우고 `/^(?!https?:\/\/)/i`(대소문자 무시)로 `http://`를 붙여
serverUrl을 정한 뒤 대체 descriptor로 붙는다. `connect()`는 대소문자를 구분하므로(R-PEER-001) `HTTPS://x`는 `refreshRoom`에서는
그대로, `connect()`에서는 `http://HTTPS://x`가 된다. 두 경로 모두 ws URL은 대소문자를 구분하는 `/^http/` 치환으로 만든다
(R-PEER-003, → O-16). `disconnect(true)`(`revokeClient`)는 room, providerToken, 승인 sessionId를 알 때
`POST <serverUrl>/p/<roomId>/sessions/<encodeURIComponent(sessionId)>/revoke`를 providerToken bearer와 body `{roomId, roomEpoch:
roomEpoch ?? 0, sessionId, requestedAt, reason:'provider-request'}`로 기다리지 않고 보내고, auto-reconnect를 끄고 lease를 지운다.
provider는 이 요청 모양을 MUST 쓴다(→ O-04).\
근거: `src/provider/peer-client.ts:1892`, `src/provider/peer-client.ts:1894`, `src/provider/peer-client.ts:1898`, `src/provider/peer-client.ts:1900`, `src/provider/peer-client.ts:1908`, `src/provider/peer-client.ts:1913`, `src/provider/peer-client.ts:1915`, `src/provider/peer-client.ts:1917`, `src/provider/peer-client.ts:1918`, `src/provider/peer-client.ts:1925`, `src/provider/peer-client.ts:1935`, `src/provider/peer-client.ts:700`, `src/provider/peer-client.ts:829`, `src/provider/peer-client.ts:1963`; 테스트: 없음

**R-PEER-027** provider는 `expiresAt`(descriptor 값 또는 now + 30분, DataChannel `hello`에서 다시 설정)에 timer를 두고, 시간이 되면
`SESSION_EXPIRED`로 재접속 없이 transport를 MUST 정리한다.\
근거: `src/provider/peer-client.ts:827`, `src/provider/peer-client.ts:1263`, `src/provider/peer-client.ts:1938`; 테스트: 없음

**R-PEER-028** provider SDK는 write 동의 때문에 tool 호출을 거절하지 않는다. `writeEnabled`는 host adapter의 상태일 뿐이다.
`connect()`는 `enableWrite`가 `true`이거나(option 없음 시) localStorage `webmcp:write-enabled`가 `'true'`일 때만
`setWriteEnabled(true)`를 부르고, auto-reconnect는 그 값이 정확히 `'false'`가 아니면 켠다. provider는 이 규칙을 MUST 따른다
(→ O-44).\
근거: `src/provider/peer-client.ts:468`, `src/provider/peer-client.ts:592`, `src/provider/peer-client.ts:611`, `src/provider/peer-client.ts:687`; 테스트: 없음

**R-PEER-029** DataChannel framing(relay 밖): provider는 수신 chunk가 `{v:1, id:safe int, index:0..total−1, total:1..512,
data:16384자 이하 문자열}`일 때만 MUST 받고, id별로 조립한다(같은 index는 무시, total이 바뀌면 다시 시작, 미완성 frame이 50개를
넘으면 모두 버림). 조립한 text는 문자열 `type`을 가진 JSON object여야 한다. 송신은 2048 UTF-16 code unit chunk
`{v:1, id:++frameSeq, index, total, data}`이고 total에 상한이 없으며 `readyState`가 `open`일 때만 보낸다. 승인 상태에서만 chunk를
받는다(→ O-45).\
근거: `src/provider/wire-schemas.ts:25`, `src/provider/wire-schemas.ts:27`, `src/provider/wire-schemas.ts:46`, `src/provider/wire-schemas.ts:52`, `src/provider/peer-client.ts:1219`, `src/provider/peer-client.ts:1553`; 테스트: 없음

### 9.2 agent client (`PeerMcpSession`)

**R-PEER-030** `PeerMcpSession`은 transport를 이 순서로 MUST 고른다: `transportFactory(url, protocols, callbacks)`, 넘겨받은
`transport`, `mcpEndpoint`가 있으면(roomId·serverUrl이 함께 있어도) Streamable HTTP transport, 아니면 `wsUrl` 또는
`<normalizeServerUrl(serverUrl)의 앞 http를 ws로(대소문자 무시)>/p/<encodeURIComponent(roomId)>/client`의 WebSocket. subprotocol은
`['webmcp-peer.v1']`에 clientToken이 있으면 `ticket.<clientToken>`을 더한 것이다. roomId·wsUrl·mcpEndpoint·transport·factory가 모두
없으면 `ROOM_ID_REQUIRED`, `send` 없는 transport는 `INVALID_TRANSPORT`다. WebSocket transport는 `onopen` 전이고 readyState가
정의돼 있고 1이 아니면 `TRANSPORT_NOT_OPEN`을 던진다. option이 `undefined`·`null`이면 `process.env`가 있을 때 환경 변수를 읽는다.
serverUrl은 option, `FRAMEBOOK_PEER_URL`, `WEBMCP_PEER_URL` 순이고 모두 없으면 `http://127.0.0.1:8787`이다. roomId는 option `roomId`,
option `descriptorUrl`, `FRAMEBOOK_PEER_ROOM_ID`, `WEBMCP_PEER_ROOM_ID`, `FRAMEBOOK_PEER_DESCRIPTOR` 순이다. mcpEndpoint는 option, 다음
`FRAMEBOOK_PEER_MCP_URL`이고, alias는 option `peerAlias`, `alias`, `FRAMEBOOK_PEER_ALIAS` 순이다. 그래서 `FRAMEBOOK_PEER_MCP_URL`이 설정된
process에서는 serverUrl·roomId를 넘겨도 Streamable HTTP transport를 쓴다.\
근거: `src/client/session.ts:153`, `src/client/session.ts:154`, `src/client/session.ts:156`, `src/client/session.ts:159`, `src/client/session.ts:164`, `src/client/session.ts:166`, `src/client/transport.ts:23`, `src/client/session.ts:313`, `src/client/session.ts:338`, `src/client/session.ts:339`, `src/client/session.ts:348`, `src/client/session.ts:357`, `src/client/session.ts:362`, `src/client/transport.ts:29`, `src/client/transport.ts:117`, `src/client/types.ts:1`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-PEER-031** `connect()`는 동시 호출과 연결 중에 만든 요청이 한 시도를 MUST 함께 쓴다. `{type:'ready'}`를 기다리며,
`requestTimeoutMs`(기본 10000 ms)가 지나면 socket이 열렸을 때는 그대로 진행하고 아니면 `TRANSPORT_TIMEOUT`이다. `ready`는
roomId(없을 때만), roomEpoch(safe integer), sessionId(비어 있지 않으면, relay가 묶은 id로 표시)를 정한다. 연결 뒤 sessionId가 없으면
`peer-session-<uuid>`를 만든다(relay가 묶은 id가 아님). HTTP transport는 만들 때 `{type:'ready', role:'client', transport:'http'}`를
스스로 낸다.\
근거: `src/client/session.ts:310`, `src/client/session.ts:385`, `src/client/session.ts:393`, `src/client/session.ts:430`, `src/client/session.ts:439`, `src/client/session.ts:372`, `src/client/transport.ts:142`; 테스트: `test/client-session.test.ts` › `wait for the shared connect instead of writing to a socket that is not open`; `test/client-session.test.ts` › `adopt the relay's session id from the ready frame`

**R-PEER-032** `request(method, params, {id, timeoutMs, raw})`는 `{jsonrpc:'2.0', id, method, params}`를 보내며 기본 id는
`'<sessionId || "peer">-<++n>'` 문자열이다. raw가 아닌 transport에는 `options.raw`가 아니면 `{type:'mcp', message}`로 싸서 보내고,
HTTP transport(raw)는 그대로 POST한다. client는 받은 message(`mcp` envelope이면 그 `message`)가 `jsonrpc:'2.0'`이고 `id`, `result`,
`error` 중 하나라도 `undefined`가 아니면 답으로 MUST 본다. method가 있는 server→client 요청과 id가 null인 message도 여기 들어간다.
답을 받으면 먼저 `String(id)`가 쥔 slot(R-PEER-035)을 풀고, 같은 `String(id)`의 pending 요청이 있으면 `error`가 truthy일 때
`PeerMcpRpcError`로 거절하고 아니면 그 message로 끝낸다. 그래서 client에서는 수 1과 문자열 `"1"`이 같은 key다. relay는 문자열·수 id와
`result`·`error` member가 있는 것만 답으로 보고 key에 type을 넣으므로(R-MCP-002, R-MCP-003) 둘의 분류가 다르다. broadcast된 provider
frame(R-MCP-041)이 pending id와 같은 id의 server→client 요청이면 client는 그 요청을 답이 아닌 message로 끝내고 slot을 비우지만, relay는
그 요청을 계속 센다(→ O-20).\
근거: `src/client/session.ts:681`, `src/client/session.ts:736`, `src/client/session.ts:518`, `src/client/session.ts:528`, `src/client/session.ts:531`, `src/client/session.ts:532`, `src/client/session.ts:536`, `src/client/session.ts:537`, `src/client/session.ts:61`, `src/client/session.ts:63`, `src/server/peer-server.ts:687`, `src/server/peer-server.ts:691`; 테스트: `test/client-request-limit.test.ts` › `sends a request of exactly the limit and refuses one byte more`

**R-PEER-033** 두 내장 transport는 wire에 놓을 것의 UTF-8 크기(WebSocket은 `{type:'mcp'}` envelope을 포함한 직렬화 frame, HTTP는
`JSON.stringify(rpc)` body)를 재고, 261120 byte를 넘으면 아무것도 쓰지 않고 `PeerMcpError('Peer MCP request is <B> bytes, over the
relay's 261120-byte request limit', 'REQUEST_TOO_LARGE', {bytes, limitBytes:261120})`를 MUST 던진다. 그 호출만 실패하고 session은
연결된 채다. 정확히 261120 byte는 보낸다. WebSocket transport는 pong을 포함한 모든 frame에 이 검사를 한다.\
근거: `src/client/transport.ts:51`, `src/client/transport.ts:53`, `src/client/transport.ts:121`, `src/client/transport.ts:149`; 테스트: `test/client-request-limit.test.ts` › `rejects only the oversized tools/call, writes nothing, and keeps the session and a concurrent call alive`; `test/client-request-limit.test.ts` › `counts the limit in UTF-8 bytes, not UTF-16 code units: %s`; `test/client-request-limit.test.ts` › `posts a body of exactly the limit and refuses a larger one without calling fetchImpl`

**R-PEER-034** raw가 아닌 transport에서 JSON text가 1024 byte를 넘는 문자열 id는 보내기 전에 `REQUEST_ID_TOO_LARGE`
(`{bytes, limitBytes:1024}`)로 MUST 거절한다. 수 id는 검사하지 않는다. HTTP transport는 id를 검사하지 않고, id가 null인 JSON-RPC
오류 body에 요청 id를 채운다.\
근거: `src/client/transport.ts:67`, `src/client/transport.ts:68`, `src/client/session.ts:711`, `src/client/transport.ts:166`; 테스트: `test/client-pending-limit.test.ts` › `is refused before it is sent when its id is over 1 KiB of JSON, which the relay would answer with id null`

**R-PEER-035** raw가 아닌 transport에서 session은 요청 id를 최대 64개(`PEER_RELAY_MAX_PENDING_REQUESTS`) 진행 중으로 MUST 둔다. 그
이상은 앞선 대기자 뒤에서 FIFO로 기다리다가 slot이 비면 보낸다. slot은 그 id의 답이 오면(호출자가 이미 timeout됐어도) 또는 send가
던지면 풀린다. transport 오류·close·`disconnect()`는 모두 비운다. 대기 시간은 요청 timeout에 들어가며 시간이 지나면 보내지 않고
`REQUEST_TIMEOUT`이다. raw transport에는 상한이 없다. outbox 대기 frame은 세지 않는다(→ O-36).\
근거: `src/client/session.ts:613`, `src/client/session.ts:616`, `src/client/session.ts:634`, `src/client/session.ts:642`, `src/client/session.ts:581`, `src/client/session.ts:739`; 테스트: `test/client-pending-limit.test.ts` › `sends a request past them once an earlier one is answered, so 100 concurrent calls all succeed`; `test/client-pending-limit.test.ts` › `keeps a request's slot after its caller timed out, until the relay answers it`; `test/client-pending-limit.test.ts` › `is not bounded: each request is answered on its own, so all of them are sent at once`

**R-PEER-036** `rpcError.data.retryable === true`인 `PeerMcpRpcError`(relay의 `PROVIDER_BUSY`)는 100 ms 뒤 같은 id로 다시 보내고, 지연을
두 배씩 2000 ms까지 늘린다(100, 200, 400, 800, 1600, 2000, 2000, …). `deadline − now`가 다음 지연 이하가 되면 마지막 거절을 던진다
(`REQUEST_TIMEOUT`이 아니다). 그 밖의 오류(retryable 없는 −32001 포함)는 바로 던진다. backoff 중의 disconnect·transport 오류·close는
재접속·재전송 없이 대기를 거절한다. HTTP `Retry-After`는 읽지 않는다. client는 이 규칙을 MUST 따른다(→ O-41).\
근거: `src/client/session.ts:98`, `src/client/session.ts:100`, `src/client/session.ts:103`, `src/client/session.ts:676`, `src/client/session.ts:684`, `src/client/session.ts:592`; 테스트: `test/client-busy-retry.test.ts` › `is sent again under the same id after 100 ms, then 200 ms, and resolves with the answer that got through`; `test/client-busy-retry.test.ts` › `stops once the next backoff would outlast its %i ms timeout and rejects with the last PROVIDER_BUSY`; `test/client-busy-retry.test.ts` › `is the only kind retried: %s is reported at once`

**R-PEER-037** HTTP transport는 `mcpEndpoint`에 `content-type: application/json`, `accept: application/json`,
`user-agent: framebook-peer-mcp-client/0.1.0`, clientToken이 있으면 `authorization: Bearer <clientToken>`으로 POST한다.
`MCP-Protocol-Version`은 보내지 않는다. 응답 처리는 R-ERR-004를 MUST 따르고, 2xx는 해석한 body를 넘긴다(빈 202는 무시된다).\
근거: `src/client/transport.ts:132`, `src/client/transport.ts:150`, `src/client/transport.ts:155`, `src/client/transport.ts:161`, `src/client/transport.ts:171`, `src/client/transport.ts:182`, `src/client/types.ts:5`; 테스트: `test/client-request-limit.test.ts` › `surfaces the relay's HTTP 413 REQUEST_TOO_LARGE as a JSON-RPC error of that call only`

**R-PEER-038** WebSocket frame `session.revoked`·`collaboration.revoked`는 `SESSION_REVOKED`, `room.rotated`는 `ROOM_ROTATED`,
`approval.expired`는 `APPROVAL_EXPIRED`, `collaboration.expired`는 `SESSION_EXPIRED`, `approval.rejected`는 `CLIENT_APPROVAL_DENIED`
(`PeerMcpError`, message는 `reason` || `message` || 기본 문구, details는 받은 frame)로 session을 `error` 상태로 MUST 끝내고, ready
대기와 모든 pending·slot 대기·backoff 요청을 거절한다. `{type:'error'}` frame은 ready 대기와 모든 pending·slot 대기·backoff 요청을
`PeerMcpError(code: 문자열 code 또는 PEER_TRANSPORT_ERROR, details: 받은 frame)`로 거절한다. 연결 중(ready 전)이면 그래서 `connect()`가
실패하고 state가 `error`가 된다. 연결된 뒤에는 state를 바꾸지 않는다(→ O-20). `{type:'ping'}`에는 `{type:'pong', timestamp}`로 답하고
send 실패는 삼킨다. `approval.pending`, `approval.approved`, `offer.refused`, `answer`는 무시한다.\
근거: `src/client/session.ts:450`, `src/client/session.ts:457`, `src/client/session.ts:465`, `src/client/session.ts:488`, `src/client/session.ts:489`, `src/client/session.ts:491`, `src/client/session.ts:508`, `src/client/session.ts:513`, `src/client/session.ts:514`, `src/client/session.ts:515`, `src/client/session.ts:376`, `src/client/session.ts:377`, `src/client/session.ts:547`, `src/client/session.ts:581`; 테스트: `test/client-request-limit.test.ts` › `drops an asynchronously failed pong send without an unhandled rejection and keeps the session`

**R-PEER-039** `initialize()`는 params `{protocolVersion: options.protocolVersion ?? '2025-11-25', capabilities:{}, clientInfo:{name:
'framebook-cli', version:'0.1.0'}}`를 MUST 보낸다. 결과가 object가 아니면 `INVALID_RESPONSE`다. `result._meta.roomEpoch`(safe integer
≥ 0, roomId가 맞을 때)를 받아들인다. 협상된 `protocolVersion`은 검사하지 않고 `notifications/initialized`도 보내지 않는다(→ O-41).\
근거: `src/client/types.ts:4`, `src/client/session.ts:752`, `src/client/session.ts:760`, `src/client/session.ts:762`, `src/client/session.ts:773`; 테스트: `test/client-session.test.ts` › `revokes a README-style Streamable HTTP session after initialize`

**R-PEER-040** `listTools()`는 params `{cursor?, _meta:{sessionId, runtimeEpoch, catalogVersion, catalogHash}}`를 보낸다(`_meta`가 늘
있으므로 relay는 WebSocket listing에 stamp한다). tools를 `normalizeTools`(128개 이하 object 배열, trim한 비어 있지 않은 256자 이하
유일한 이름, `inputSchema.type === 'object'`; 아니면 `INVALID_TOOLS_LIST`·`INVALID_TOOL_DESCRIPTOR`·`TOOL_NAME_TOO_LONG`·
`DUPLICATE_TOOL`)로 검사하고, `catalogVersion`·`catalogHash`를 `result.X ?? result._meta.X`(WebSocket 최상위와 HTTP `_meta`를 둘 다)
에서 읽어 catalog cache를 MUST 바꾼다.\
근거: `src/client/session.ts:782`, `src/client/session.ts:785`, `src/client/session.ts:792`, `src/client/session.ts:798`, `src/client/catalog-hash.ts:66`; 테스트: `test/catalog-contract.test.ts` › `announces accepted catalogs with the relay's authoritative version and hash`

**R-PEER-041** client는 relay가 준 `catalogHash`를 그대로 쓰고 tools로 다시 계산해 검증하지 않는다. hash가 없을 때만 `hashTools`로
계산한다. version이 없으면 hash가 바뀌었을 때 이전 + 1(이전이 수가 아니면 1), 아니면 이전 값(없으면 0)이다. 저장한 cache를 되살릴
때는 hash를 다시 계산한다. 데모 agent는 모든 hash를 다시 계산한다(→ O-33). client는 이 규칙을 MUST 따른다.\
근거: `src/client/session.ts:862`, `src/client/session.ts:864`, `src/client/session.ts:865`, `src/client/session.ts:276`; 테스트: `test/client-session.test.ts` › `loads only a valid catalog cache from a JSON store`

**R-PEER-042** tools 배열을 가진 `register` frame은 catalog cache를 그 frame의 `catalogVersion`·`catalogHash`로 MUST 바꾼다. 무효한
frame은 handler 안에서 잡아 session error로 남기고 이전 catalog를 유지한다. `catalogChanged`·`catalog.changed` frame과
`notifications/tools/list_changed`(bare 또는 `mcp` envelope)는 `onCatalogChanged` listener만 부르고 catalog를 새로 읽지 않는다.\
근거: `src/client/session.ts:418`, `src/client/session.ts:496`, `src/client/session.ts:500`, `src/client/session.ts:519`; 테스트: `test/catalog-contract.test.ts` › `drops an invalid register frame from a legacy relay instead of throwing out of the socket handler`

**R-PEER-043** `callTool(name)`은 빈 이름에 `TOOL_NAME_REQUIRED`를 던진다. cache가 비었고 `refresh !== false`면 먼저 catalog를 읽는다.
cache에 없는 tool은 요청 없이 로컬 `TOOL_NOT_FOUND`(`{name, catalog}`)다. params `{name, arguments, _meta:{sessionId, runtimeEpoch,
catalogVersion, catalogHash}}`를 보낸다. drift 오류(R-PEER-044)를 받으면 catalog를 다시 읽고 `PeerMcpCatalogChangedError`(code
`CATALOG_CHANGED`, snapshot)를 던진다. 단 `readOnly: true`와 `retryOnCatalogChanged: true`면 `refresh: false`로 한 번 다시 시도한다.
결과는 `PeerMcpCallToolResultSchema`(content는 `{type:string}` 배열, `structuredContent`는 object, `isError`는 boolean)를 통과해야
하며 아니면 `INVALID_TOOL_RESULT`다. client는 이 규칙을 MUST 따른다.\
근거: `src/client/session.ts:812`, `src/client/session.ts:818`, `src/client/session.ts:819`, `src/client/session.ts:822`, `src/client/session.ts:827`, `src/client/session.ts:841`, `src/client/session.ts:844`, `src/client/session.ts:852`, `src/client/schemas.ts:32`; 테스트: `test/live-demo.e2e.test.ts` › `surfaces relay catalog drift over HTTP as PeerMcpCatalogChangedError (no host write)`; `test/client-session.test.ts` › `rejects a tools/call result that is not a CallToolResult`

**R-PEER-044** `isCatalogChangedRpcError`는 수 `error.code`(또는 `data.code`)가 있으면 그것만으로 판단해 −32010·−32027일 때만 참이다.
수 code가 없으면 canonical 이름이 `CATALOG_CHANGED`, `CATALOG_STALE`, `SOURCE_CHANGED`, `RUNTIME_EPOCH_MISMATCH`일 때 참이다. client는
이 분류를 MUST 쓴다. relay와 provider는 −32027과 뒤의 세 이름을 내지 않는다(→ O-34).\
근거: `src/client/errors.ts:46`, `src/client/errors.ts:50`, `src/client/errors.ts:75`, `src/client/errors.ts:78`; 테스트: `test/live-demo.e2e.test.ts` › `only treats registry drift codes as catalog changes`

**R-PEER-045** transport close는 state가 `disconnecting`·`idle`·`error`가 아니면 state를 `disconnected`로 하고 모든 요청을
`TRANSPORT_CLOSED`로, transport 오류는 그 오류(Error가 아니면 `PEER_TRANSPORT_ERROR`)로 거절한다. `disconnect()`는
`SESSION_DISCONNECTED`로 거절하고 transport를 닫고 state를 `idle`로 한다. session은 스스로 재접속하지 않고 close code를 읽지
않으며, 이후 `request()`가 다시 `connect()`한다. client는 이 규칙을 MUST 따른다(→ O-23).\
근거: `src/client/session.ts:554`, `src/client/session.ts:562`, `src/client/session.ts:565`, `src/client/session.ts:895`, `src/client/session.ts:706`, `src/client/transport.ts:109`; 테스트: `test/client-request-limit.test.ts` › `rejects a call whose session disconnects during its HTTP POST without an unhandled rejection`

**R-PEER-046** `revoke(reason = 'client-request')`는 clientToken이 MUST 있어야 한다(`CLIENT_TOKEN_REQUIRED`). sessionId가 relay가 묶은
것이면 `POST <roomBase>/sessions/<sessionId>/revoke`, 아니면 `POST <roomBase>/session/revoke`를 `authorization: Bearer <clientToken>`과
body `{sessionId?, roomId, roomEpoch, reason, requestedAt}`으로 보낸다. roomBase는 `mcpEndpoint`에서 `/mcp`를 뺀 것, 아니면
`<serverUrl>/p/<roomId>`다. roomEpoch를 모르면 먼저 `GET …/sessions/<sessionId>`(묶인 id일 때), 다음으로 MCP endpoint에 metadata
`initialize` POST로 알아낸다. non-2xx는 message `body.error`, code `body.code`(문자열일 때)·아니면 `SESSION_REVOKE_FAILED`로 던지고,
성공하면 끊는다(→ O-56).\
근거: `src/client/session.ts:921`, `src/client/session.ts:927`, `src/client/session.ts:928`, `src/client/session.ts:937`, `src/client/session.ts:938`, `src/client/session.ts:953`, `src/client/session.ts:967`; 테스트: `test/client-session.test.ts` › `revokes an HTTP session that never called initialize`; `test/client-session.test.ts` › `revokes a WebSocket session constructed without a session id`

**R-PEER-047** `joinPeerRoom`은 roomId(`ROOM_ID_REQUIRED`)와 inviteToken(`INVITE_TOKEN_REQUIRED`)을 로컬에서 검사한 뒤
`POST <serverUrl>/p/<encodeURIComponent(roomId)>/join`을 `content-type`·`accept: application/json`, `user-agent:
framebook-peer-mcp-client/0.1.0`, body `{inviteToken, clientLabel(비어 있지 않은 option 또는 'MCP client'), capabilities(비어 있지
않은 option 배열 또는 ['mcp-control'])}`로 MUST 보낸다. non-2xx는 code `body.error || 'HTTP_<status>'`로 던진다. 2xx body는
`PeerClientTicketSchema`(roomId·clientToken·sessionId 비어 있지 않은 문자열, roomEpoch safe integer ≥ 0, issuedAt·expiresAt 유한한 수,
approvalRequired boolean, capabilities 문자열 배열, approvalState·state 문자열, approvalRequestId는 있으면 문자열)를 통과해야 하며
아니면 `INVALID_JOIN_RESPONSE`다. ticket과 serverUrl, wsUrl, mcpEndpoint를 돌려준다.\
근거: `src/client/room-lifecycle.ts:96`, `src/client/room-lifecycle.ts:105`, `src/client/room-lifecycle.ts:107`, `src/client/room-lifecycle.ts:114`, `src/client/room-lifecycle.ts:131`, `src/client/room-lifecycle.ts:141`, `src/client/schemas.ts:55`; 테스트: `test/client-session.test.ts` › `rejects a join response that is not a client ticket`

**R-PEER-048** `getPeerSessionStatus`는 `GET <serverUrl>/p/<enc roomId>/sessions/<enc sessionId>`를 `authorization: Bearer
<clientToken>`으로 보낸다(로컬 검사 `ROOM_ID_REQUIRED`, `SESSION_REQUIRED`, `CLIENT_TOKEN_REQUIRED`). non-2xx는 code `body.error ||
'HTTP_<status>'`, body에 문자열 `state`가 없거나 roomEpoch가 safe integer ≥ 0이 아니면 `INVALID_SESSION_STATUS`다.
`waitForPeerApproval`은 `max(25, pollIntervalMs ?? 250)` ms마다 `max(poll, timeoutMs ?? 30000)` ms까지 조회한다. `approved`면 끝,
`rejected`는 `CLIENT_APPROVAL_DENIED`, `revoked`는 `SESSION_REVOKED`, `expired`는 `APPROVAL_EXPIRED`, `room-rotated`는 `ROOM_ROTATED`,
기한 초과는 `APPROVAL_TIMEOUT`, abort는 `APPROVAL_ABORTED`이며 그 밖의 state(`pending-approval` 등)는 계속 조회한다. client는 이
규칙을 MUST 따른다(→ O-47).\
근거: `src/client/room-lifecycle.ts:173`, `src/client/room-lifecycle.ts:184`, `src/client/room-lifecycle.ts:188`, `src/client/room-lifecycle.ts:203`, `src/client/room-lifecycle.ts:211`, `src/client/room-lifecycle.ts:214`, `src/client/room-lifecycle.ts:227`, `src/client/room-lifecycle.ts:239`, `src/client/schemas.ts:112`; 테스트: `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-PEER-049** `discoverPeerCatalog`는 room(roomId, invitationUrl, mcpEndpoint)이 주어지면 일회용 HTTP `PeerMcpSession`으로
`initialize`와 `tools/list`를 해서 serverInfo, protocolVersion(initialize의 것), tools, catalogVersion·catalogHash를 돌려준다. serverUrl만
있으면 `GET <serverUrl>/mcp/catalog`(accept JSON, client user-agent)를 보내고 catalogVersion(유한한 수나 비어 있지 않은 문자열, 아니면
1), catalogHash(아니면 `hashTools`), `protocolVersion = body.protocol || '2025-11-25'`을 돌려준다. client는 이 규칙을 MUST 따른다
(→ O-14).\
근거: `src/client/room-lifecycle.ts:28`, `src/client/room-lifecycle.ts:44`, `src/client/room-lifecycle.ts:62`, `src/client/room-lifecycle.ts:77`; 테스트: `test/client-session.test.ts` › `initializes and lists tools for ${target.label}`; `test/client-session.test.ts` › `falls back to version 1 for a non-scalar catalogVersion (${JSON.stringify(catalogVersion)})`

**R-PEER-050** `rotatePeerRoom`은 roomId(`ROOM_ID_REQUIRED`)와 providerToken(`PROVIDER_TOKEN_REQUIRED`)을 로컬에서 검사한 뒤
`POST <serverUrl>/p/<enc roomId>/rotate`를 `authorization: Bearer <providerToken>`, body `{roomId, roomEpoch?(safe integer만),
alias?(비어 있지 않을 때), requestedAt}`으로 MUST 보낸다. `ttlMs` option은 없다. non-2xx는 code `body.error || 'HTTP_<status>'`, object가
아닌 2xx body는 `INVALID_ROTATE_RESPONSE`다.\
근거: `src/client/room-lifecycle.ts:245`, `src/client/room-lifecycle.ts:255`, `src/client/room-lifecycle.ts:257`, `src/client/room-lifecycle.ts:260`, `src/client/room-lifecycle.ts:275`; 테스트: `test/webmcp-peer.test.ts` › `supports customHttpHandler plugin hook and headless HTTP approval + room rotation`

**R-PEER-051** `probePeerHealth`는 `GET <base>/health`(accept JSON, timeout `max(250, timeoutMs ?? 5000)` ms)를 보내 2xx이고
`body.status === 'healthy'`일 때만 healthy(그 status 포함)로 보고, 그 밖의 응답은 그 status를 담은 `unhealthy`다. 요청이 던지는 catch
경로(네트워크 오류, timeout, 요청 중 abort)는 `unreachable`이고 `status: null`이다. 요청을 보내기 전의 실패에는 `status` member가 없다:
빈 URL은 `unhealthy`, `fetch`가 없거나 signal이 이미 abort됐으면 `unreachable`이다. `fetchPeerServerConfig`는 빈 URL과 `fetch` 없음을
거절하고, 이미 abort된 signal은 요청 없이 그 reason(기본 `AbortError`)으로 거절한다. `GET <base>/config`(같은 timeout)를 보내 non-2xx면
문자열 `body.error` 또는 `HTTP <status>`로 실패하고, 선언 member의 type이 틀리면(문자열 `type`·`serverUrl`·`protocol`·template·
`roomEndpoint`, 유한한 `version`, `defaults.approvalRequired` boolean, `defaults.roomTtlMs` 유한한 수) 거절한다. config tier는 이 규칙을
MUST 따른다.\
근거: `src/config/probe.ts:57`, `src/config/probe.ts:60`, `src/config/probe.ts:70`, `src/config/probe.ts:77`, `src/config/probe.ts:82`, `src/config/probe.ts:105`, `src/config/probe.ts:117`, `src/config/probe.ts:126`, `src/config/probe.ts:143`, `src/config/probe.ts:146`, `src/config/probe.ts:165`, `src/config/probe.ts:170`, `src/config/probe.ts:173`, `src/config/probe.ts:174`, `src/config/probe.ts:180`, `src/config/probe.ts:198`; 테스트: `test/client-config.test.ts` › `rejects a config document whose declared members have the wrong type`; `test/client-config.test.ts` › `rejects an already-aborted signal without sending a request`; `test/client-config.test.ts` › `reports the relay's error text for a failed response`; `test/webmcp-peer.test.ts` › `runs end-to-end 3-tier Peer-Based Server Routing MCP (Provider -> Server -> Client & PeerMcpService)`

**R-PEER-052** `parseInvitationUrl`은 `<origin>/p/<roomId>` 또는 `<origin>/p/<roomId>/mcp`(끝 `/` 허용)에 `#invite=<t>`(대안
`?invite=<t>`)를 받아 `{serverUrl:origin, roomId(decode), descriptorUrl:'<serverUrl>/p/<encodeURIComponent(roomId)>',
inviteToken(trim), mcpEndpoint:'<serverUrl>/p/<encodeURIComponent(roomId)>/mcp'}` 또는 null을 돌려준다. `buildInvitationUrl`은 `<hash와
끝 /를 뺀 descriptorUrl, 또는 <serverUrl(기본 http://127.0.0.1:8787)>/p/<enc roomId>>#invite=<encodeURIComponent(token)>`을 MUST 만든다.
`createPeerConfigProfile`은 `protocol:'webmcp-peer/1'`과 `defaults:{approvalRequired:true, roomTtlMs:7200000, …}`인 profile을 만들고, 비밀
key(`publishKey`, `providerToken`, `reconnectToken`, `leaseToken`, `clientToken`, `inviteToken`)는 `defaults`에서만 지운다. profile의
`invitationUrl`은 trim한 `input.invitationUrl` 그대로이거나, 그것이 없으면 roomId와 inviteToken(input 또는 초대 URL에서 읽은 값)으로
`buildInvitationUrl({serverUrl, roomId, inviteToken})`이 만든 것(`#invite=<encodeURIComponent(token)>`)이다. 그래서 초대 URL에 담긴
inviteToken은 가려지지 않고 profile에 들어간다(→ O-54, O-55).\
근거: `src/config/invitation.ts:72`, `src/config/invitation.ts:87`, `src/config/invitation.ts:96`, `src/config/invitation.ts:110`, `src/config/profile.ts:16`, `src/config/profile.ts:20`, `src/config/profile.ts:32`, `src/config/profile.ts:45`, `src/config/profile.ts:47`, `src/config/profile.ts:48`, `src/config/profile.ts:57`, `src/config/profile.ts:60`, `src/config/profile.ts:64`; 테스트: `test/webmcp-peer.test.ts` › `normalizes peer config profiles and invitation URLs`

### 9.3 일반 Streamable HTTP agent

**R-PEER-053** `PeerMcpSession`이 아닌 MCP client가 `POST /p/:id/mcp`를 쓸 때는 다음을 MUST 지킨다. 중계 method에는
`Authorization: Bearer <clientToken>`(정확히 `Bearer `와 공백 하나)을 보낸다. 요청 id는 문자열이나 유한한 수이고 null이 아니다
(R-MCP-009, R-MCP-043). 문자열 id의 JSON text는 1024 byte 이하다(넘으면 400 `REQUEST_ID_TOO_LARGE`, id null). batch 배열을 보내지
않는다. body는 엄격한 UTF-8 JSON이고 BOM이 없으며, 보낸 그대로와 `JSON.stringify`로 다시 직렬화한 것이 모두 261120 byte 이하다(넘으면
413 `REQUEST_TOO_LARGE`, R-MCP-008, R-MCP-010). `MCP-Protocol-Version`은 보내지 않거나 initialize-era 값 하나를 보낸다. SSE stream과
`Mcp-Session-Id`를 기대하지 않는다(GET은 descriptor 또는 405, DELETE는 405). 성공을 HTTP status로만 판단하지 않는다: 진행 중인 요청에
생긴 relay 오류(`MCP_REQUEST_TIMEOUT`, `PROVIDER_DISCONNECTED`, `ROOM_ROTATED`, `ROOM_EXPIRED`, `SESSION_INVALID`)는 200 body의 JSON-RPC
`error`로 오므로 그런 200을 실패로 다룬다(R-MCP-023). id가 없는 `ping`·`initialize`·`tools/list`·`server/discover`는 202가 아니라 id
null인 200 JSON을 받는다(R-MCP-016~R-MCP-019, → O-29). catalog 변경은 push되지 않는다. client는 `tools/call`의 `params._meta`에
`catalogVersion`·`catalogHash`를 SHOULD 넣는다. 넣어야 −32010 `CATALOG_CHANGED`로 drift를 fail-closed로 알 수 있고, 이를 받으면
`tools/list`를 다시 읽는다. 둘 다 넣지 않는 일반 MCP client에게 catalog 변경은 없어진 tool의 400 `TOOL_NOT_FOUND`나 새 catalog에 대한
조용한 호출로만 드러난다(R-MCP-020). 503 `PROVIDER_BUSY`(`data.retryable: true`)는 다시 보낼 수 있다.\
근거: `src/server/peer-server.ts:1604`, `src/server/peer-server.ts:1937`, `src/server/peer-server.ts:1943`, `src/server/peer-server.ts:1947`, `src/server/peer-server.ts:1951`, `src/server/peer-server.ts:1957`, `src/server/peer-server.ts:1963`, `src/server/peer-server.ts:1970`, `src/server/peer-server.ts:1980`, `src/server/peer-server.ts:1864`, `src/server/peer-server.ts:1869`, `src/server/peer-server.ts:2020`, `src/server/peer-server.ts:2045`, `src/server/peer-server.ts:2085`, `src/server/peer-server.ts:2086`, `src/server/peer-server.ts:2098`, `src/server/peer-server.ts:2155`, `src/server/peer-server.ts:122`; 테스트: `test/mcp-http-interop.test.ts` › `serves the official MCP v2 client in %s negotiation mode`

## 10. 열린 문제

각 항목은 코드끼리, 또는 코드와 문서가 어긋나는 곳이다. 이 문서는 현재 동작을 규정했고, 바꾸려면 결정과 함께 해당 요건을 고친다.
심각도는 high, medium, low다. 위치는 `packages/webmcp-peer/` 기준이다(저장소 문서는 저장소 루트 기준).

**O-01 (high) WebSocket `initialize`·`server/discover`의 version과 모양이 HTTP와 다르다.** relay는 WebSocket agent의 `initialize`를
provider에 넘기고, provider는 요청과 무관하게 `2026-07-28`, `listChanged:true`, host serverInfo로 답한다. HTTP는 initialize-era
version으로 협상해 기본 `2025-11-25`, `listChanged:false`, relay serverInfo다. `MCP_INITIALIZE_PROTOCOL_VERSIONS` 주석("never
answered with 2026-07-28")과 어긋난다. WebSocket `server/discover`도 relay가 provider catalog를 받아들이면 provider 모양(`2026-07-28`,
`supportedProtocolVersions` 5개), 거절하면 relay 모양(협상 version, capabilities 없음)이고, `UNSUPPORTED_PROTOCOL_VERSION`의
`supported`는 4개다. 위치: `src/provider/peer-client.ts:1392`, `src/provider/peer-client.ts:1376`, `src/provider/commit-receipt.ts:3`,
`src/server/peer-server.ts:2012`, `src/server/peer-server.ts:1163`, `src/server/peer-server.ts:2766`, `.changeset/webmcp-peer-initialize-era-transport.md`.
관련: R-MCP-016, R-MCP-019, R-MCP-036, R-PEER-015.

**O-02 (high) `CLIENT_APPROVAL_REQUIRED`의 code가 둘이다.** relay는 −32053, provider는 −32003을 쓰며, −32003은 relay의
`CLIENT_TOKEN_REQUIRED`다. 위치: `src/server/peer-server.ts:1343`, `src/server/peer-server.ts:1344`, `src/server/peer-server.ts:2696`,
`src/provider/peer-client.ts:1356`. 관련: R-MCP-014, R-MCP-029, R-PEER-012.

**O-03 (high) `id: null` 처리가 transport마다 다르다.** HTTP는 400 `INVALID_REQUEST`로 거절한다. WebSocket은 approved ticket이면
notification으로 provider에 넘기고, 아니면 id null 오류로 답한다. provider는 id null 요청에 id null로 답하는데, relay는 이 답을 답으로
보지 않고 room의 모든 agent에 broadcast한다. 위치: `src/server/peer-server.ts:1957`, `src/server/peer-server.ts:2707`,
`src/server/peer-server.ts:685`, `src/server/peer-server.ts:2611`, `src/provider/peer-client.ts:1346`. 관련: R-MCP-002, R-MCP-009,
R-MCP-029, R-MCP-030, R-PEER-012.

**O-04 (high) rotate의 binding 불일치가 `ROOM_ROTATED`로 보고된다.** rotate되지 않은 room에 409 `ROOM_ROTATED`
`replacementRoomId:null`을 주고, 진짜로 rotate된 room의 두 번째 rotate는 404 `ROOM_NOT_FOUND`다. 다른 곳의 `ROOM_ROTATED`는 410이다.
provider `refreshRoom`은 `roomEpoch ?? 0`을 보내므로 epoch를 모르면 이 409를 받는다. 위치: `src/server/peer-server.ts:2424`,
`src/server/peer-server.ts:2411`, `src/server/peer-server.ts:2168`, `src/provider/peer-client.ts:1908`. 관련: R-ROOM-041, R-ROOM-042,
R-PEER-026.

**O-05 (high) room 만료가 표면마다 다르게 보인다.** reclaim 404 `ROOM_EXPIRED`(code 없음, lease 만료도 같음), join·approval·revoke·
rotate 404 `ROOM_NOT_FOUND`, MCP POST 410 −32056 `ROOM_EXPIRED`, 진행 중 HTTP −32056, 같은 room의 WebSocket pending −32001
`SESSION_INVALID`, client socket은 `room.expired`가 아닌 reason `ROOM_EXPIRED`의 `session.revoked`, session status는 `expired`가 아닌
`revoked`(그래서 `waitForPeerApproval`은 `APPROVAL_EXPIRED`가 아닌 `SESSION_REVOKED`), provider socket은 frame 없이 닫힘. 위치:
`src/server/peer-server.ts:1791`, `src/server/peer-server.ts:2171`, `src/server/peer-server.ts:2000`, `src/server/peer-server.ts:1589`,
`src/server/peer-server.ts:1535`, `src/server/peer-server.ts:1618`, `src/client/room-lifecycle.ts:229`. 관련: R-ROOM-014, R-ROOM-035,
R-ROOM-048, R-ROOM-050.

**O-06 (high) reconnect lease가 15분 뒤 늘어나지 않는다.** lease는 생성과 reclaim에서만 정해진다. 2시간 room에서 15분 넘게 지나 새로고침한
browser는 room이 유효한데도 reclaim이 404 `ROOM_EXPIRED`이고, lease를 지우고 새 room을 만들어 agent의 ticket과 소비된 invite를
잃는다. README의 F5 handoff·auto-reconnect 설명("until it succeeds")에는 이 창이 없다. 위치: `src/server/peer-server.ts:561`,
`src/server/peer-server.ts:1790`, `src/server/peer-server.ts:1819`, `src/provider/peer-client.ts:801`, `README.md:196`. 관련: R-ROOM-018,
R-LIM-027, R-PEER-024.

**O-07 (high) 승인 요청의 수명이 MCP request timeout(30 s)이다.** timer는 provider가 없어도 돈다. 만료되면 ticket은 영구히 `expired`,
invite는 소비된 채라 rotate 전에는 다시 join할 수 없다. provider에는 아무 frame도 가지 않아 UI가 요청을 계속 보이고 뒤늦은 결정은
`INVALID_APPROVAL`이다. README와 테스트 어디에도 이 창이 없다. 위치: `src/server/peer-server.ts:1391`, `src/server/peer-server.ts:1395`,
`src/server/peer-server.ts:442`, `README.md:120`. 관련: R-ROOM-024, R-ROOM-026, R-LIM-025.

**O-08 (medium) rotate의 대체 room 정보가 WebSocket agent에 가지 않는다.** ticket 종료가 client socket을 먼저 떼므로, `rotatedTo`·
`replacementRoomId`가 든 `room.rotated`를 보내는 뒤의 loop는 아무 socket에도 닿지 않는다(죽은 코드). WebSocket pending은 data 없는
−32057이고 HTTP 진행 요청만 `replacementRoomId`를 받는다. 위치: `src/server/peer-server.ts:1518`, `src/server/peer-server.ts:1535`,
`src/server/peer-server.ts:2440`, `src/server/peer-server.ts:2451`, `src/server/peer-server.ts:1587`. 관련: R-ROOM-044, R-SIG-016.

**O-09 (medium) rotate된 room의 응답이 route마다 다르다.** join, session status, reclaim은 410 `ROOM_ROTATED`, approval, revoke,
rotate는 404 `ROOM_NOT_FOUND`(rotate가 `expiresAt`을 rotate 시각으로 바꾸기 때문). 위치: `src/server/peer-server.ts:2167`,
`src/server/peer-server.ts:2303`, `src/server/peer-server.ts:1782`, `src/server/peer-server.ts:2253`, `src/server/peer-server.ts:2345`,
`src/server/peer-server.ts:2411`, `src/server/peer-server.ts:2436`. 관련: R-ROOM-046.

**O-10 (medium) roomId·roomEpoch binding 규칙이 route마다 다르다.** reclaim은 둘 다 선택(409 `ROOM_LEASE_BINDING_INVALID` −32002),
rotate는 선택(409 `ROOM_ROTATED` −32057), approval은 필수(409 `INVALID_APPROVAL` −32081), 경로형 revoke는 필수이고 token 검사보다
먼저(409 `SESSION_BINDING_INVALID` −32002), provider의 `/session/revoke`는 검사 없음(빈 body가 전부 revoke), client revoke는 필수.
위치: `src/server/peer-server.ts:1801`, `src/server/peer-server.ts:2424`, `src/server/peer-server.ts:2270`, `src/server/peer-server.ts:2357`,
`src/server/peer-server.ts:2364`, `src/server/peer-server.ts:2390`. 관련: R-ROOM-015, R-ROOM-028, R-ROOM-037, R-ROOM-038, R-ROOM-040, R-ROOM-042.

**O-11 (medium) 같은 이름이 여러 status·code·모양을 가진다.** `SESSION_BINDING_INVALID`는 409 −32002와 403 code 없음.
`ROOM_NOT_FOUND`·`CLIENT_TOKEN_REQUIRED`는 수명주기 route에서 code 없고 MCP POST에서 −32004·−32003. `CATALOG_UNAVAILABLE`은 GET에서
code 없고 MCP POST −32090(data `{catalogSource}`), provider는 data `{reason}`. `ROOM_EXPIRED`는 reclaim 404 code 없음, MCP 410 −32056.
`CATALOG_INVALID`·`CATALOG_TOO_LARGE`는 provider frame −32602(최상위 필드), agent 답 −32603(data). `RESULT_TOO_LARGE`는 relay −32603
`{limitBytes}`, provider는 data 없는 −32603, `tools/call`에는 문자열 `error.code`의 `isError` 결과. 승인 안 된 ticket의 data는 WebSocket
`{sessionId, approvalRequestId}`, HTTP `{roomId, sessionId, approvalRequired}`. HTTP ticket 오류 표에는 `room-rotated`가 없고 WebSocket은
`SESSION_INVALID`다. 위치: `src/server/peer-server.ts:2387`, `src/server/peer-server.ts:2391`, `src/server/peer-server.ts:2300`,
`src/server/peer-server.ts:1992`, `src/server/peer-server.ts:1922`, `src/server/peer-server.ts:2009`, `src/server/peer-server.ts:936`,
`src/server/peer-server.ts:978`, `src/server/peer-server.ts:132`, `src/provider/tool-call.ts:246`, `src/server/peer-server.ts:1342`,
`src/server/peer-server.ts:2697`. 관련: R-ERR-003, R-MCP-014, R-MCP-029, R-MCP-040, R-PEER-014.

**O-12 (medium) 한 code에 여러 이름이 있다.** −32001: `SESSION_INVALID`, `PROVIDER_UNAVAILABLE`, `PROVIDER_BUSY`(유일하게
`data.retryable`), `PROVIDER_DISCONNECTED`, `MCP_REQUEST_TIMEOUT`, `CLIENT_DISCONNECTED`. −32600: `INVALID_REQUEST`, `REQUEST_TOO_LARGE`,
`REQUEST_ID_TOO_LARGE`, `DUPLICATE_REQUEST_ID`, `UNSUPPORTED_PROTOCOL_VERSION`. −32056: `SESSION_EXPIRED`, `ROOM_EXPIRED`. −32002:
`ROOM_LEASE_BINDING_INVALID`, `SESSION_BINDING_INVALID`. −32008: `PEER_SESSION_SUPERSEDED`, `OUTCOME_UNKNOWN`. −32602: catalog 거절,
잘못된 `tools/call` params, `TOOL_NOT_FOUND`. −32603: `RESULT_TOO_LARGE`, `BODY_CONSUMED`, catalog 거절 답. provider의 `Invalid Request`,
`Method not found`, `Internal error`는 canonical 이름이 아니다. 위치: `src/server/peer-server.ts:116`, `src/server/peer-server.ts:122`,
`src/server/peer-server.ts:1033`, `src/server/peer-server.ts:2737`, `src/server/peer-server.ts:1346`, `src/provider/peer-client.ts:1349`,
`src/client/errors.ts:62`. 관련: R-ERR-001.

**O-13 (medium) 자격 오류의 이름과 status가 일관되지 않다.** publish key는 401 `PUBLISH_KEY_REQUIRED`·`PUBLISH_KEY_INVALID`, invite는
401 `INVITE_TOKEN_REQUIRED`·403 `INVITE_TOKEN_INVALID`, lease는 401 `ROOM_LEASE_INVALID`, providerToken은 없음·틀림 모두 401
`PROVIDER_TOKEN_REQUIRED`, session status·client revoke는 틀린 token도 401 `CLIENT_TOKEN_REQUIRED`. join은 token이 맞는지 보기 전에 409
`INVITE_TOKEN_CONSUMED`를 알린다. 위치: `src/server/peer-server.ts:1228`, `src/server/peer-server.ts:1230`, `src/server/peer-server.ts:2182`,
`src/server/peer-server.ts:2185`, `src/server/peer-server.ts:2190`, `src/server/peer-server.ts:1808`, `src/server/peer-server.ts:2258`,
`src/server/peer-server.ts:2313`. 관련: R-ROOM-009, R-ROOM-020, R-ROOM-027, R-ROOM-033.

**O-14 (medium) protocol 식별자가 둘이다.** frame, `/config`, profile은 `webmcp-peer/1`, subprotocol, descriptor, `/mcp/catalog`는
`webmcp-peer.v1`이다. `discoverPeerCatalog`는 `/mcp/catalog`의 `protocol`(`webmcp-peer.v1`)을 MCP revision을 담는 `protocolVersion`에
넣는다. `WEBMCP_SUBPROTOCOL` 상수가 있는데 codec, provider, session, demo가 문자열을 각자 적는다. 위치: `src/server/peer-server.ts:1691`,
`src/server/peer-server.ts:1843`, `src/server/peer-server.ts:1882`, `src/config/types.ts:1`, `src/server/ws-upgrade.ts:293`,
`src/provider/peer-client.ts:830`, `src/client/session.ts:339`, `src/client/room-lifecycle.ts:62`, `examples/live-demo/peer-protocol.js:4`.
관련: R-PEER-049, 1.5.

**O-15 (medium) Bearer 해석과 token 비교가 자격마다 다르다.** publish key는 `/^Bearer\s+/i`와 `X-Publish-Key`, 나머지 route는 정확한
`Bearer `(대소문자 구분, 공백 하나)라서 `bearer <token>`은 `POST /p`만 통과한다. providerToken은 상수 시간 비교, clientToken은 upgrade와
HTTP 모두 Map 조회다. 위치: `src/server/peer-server.ts:1209`, `src/server/peer-server.ts:1604`, `src/server/peer-server.ts:2249`,
`src/server/peer-server.ts:2525`, `src/server/peer-server.ts:1329`. 관련: R-ROOM-009, R-ROOM-027, R-MCP-014, R-WS-006, R-WS-007.

**O-16 (medium) room id 문법과 URL 만들기가 다르다.** 수명주기 route와 upgrade는 `[a-f0-9]+`(길이 무제한), MCP route와 provider
descriptor schema는 `[A-Za-z0-9_-]{1,128}`, client `parseRoomId`는 아무 segment나 받는다. 대문자·hex 아닌 id는 descriptor를 받지만
join은 `NOT_FOUND`다. provider는 roomId를 인코딩하지 않고 `/^http/`를 대소문자 구분으로, client는 인코딩하고 대소문자 무시로 바꾼다.
위치: `src/server/peer-server.ts:1771`, `src/server/peer-server.ts:1858`, `src/server/peer-server.ts:2160`, `src/provider/wire-schemas.ts:74`,
`src/client/transport.ts:30`, `src/client/transport.ts:33`, `src/provider/peer-client.ts:829`. 관련: R-HTTP-002, R-PEER-003, R-PEER-030.

**O-17 (medium) 시각 형식과 frame envelope이 고르지 않다.** epoch ms(`expiresAt`, `reconnectTokenExpiresAt`, join `issuedAt`·
`expiresAt`, frame `expiresAt`)와 ISO(`createdAt`, `updatedAt`, `reclaimedAt`, `rotatedAt`, session status, `decidedAt`, revoke
`revokedAt`)가 섞인다. HTTP approval 응답의 `expiresAt`은 승인 요청 만료(ISO), client용 `approval.approved`는 ticket 만료(ms), provider
echo는 승인 요청 만료(ms)다. `approval.pending`·`approval.expired`에는 공통 envelope 필드가 빠지고, `messageId`는 `room-rotated-…`와
`room.rotated-<sessionId>-<ms>`가 섞이며 `approval.request`는 `approval-approval-…`가 된다. 위치: `src/server/peer-server.ts:604`,
`src/server/peer-server.ts:608`, `src/server/peer-server.ts:2229`, `src/server/peer-server.ts:2288`, `src/server/peer-server.ts:1574`,
`src/server/peer-server.ts:2585`, `src/server/peer-server.ts:1371`, `src/server/peer-server.ts:1405`, `src/server/peer-server.ts:1524`,
`src/server/peer-server.ts:1429`. 관련: R-SIG-002, R-SIG-010, R-ROOM-031.

**O-18 (medium) provider가 남이 바꾼 승인 상태를 듣지 못한다.** HTTP 승인 결정, client 자기 revoke, provider의 HTTP 단일 revoke,
승인 만료는 provider socket에 아무것도 보내지 않는다(WebSocket 결정만 echo). provider는 결정 frame을 보내자마자 `approved`가 되고
`INVALID_APPROVAL`은 기록만 하므로 만료된 요청을 승인했다고 믿을 수 있다. relay가 provider에 보내지 않는 `session.revoked`,
`approval.expired`, `collaboration.*` handler가 provider에 있다. 위치: `src/server/peer-server.ts:2275`, `src/server/peer-server.ts:2576`,
`src/server/peer-server.ts:1405`, `src/server/peer-server.ts:1518`, `src/provider/peer-client.ts:1838`, `src/provider/peer-client.ts:1054`,
`src/provider/peer-client.ts:954`. 관련: R-ROOM-026, R-ROOM-029, R-PEER-018, R-PEER-021.

**O-19 (medium) 단일 session revoke가 진행 중인 HTTP 요청을 끝내지 않는다.** ticket 종료는 그 ticket socket의 WebSocket 요청만
끝내고, 같은 ticket의 HTTP bridge 요청은 계속 돌아 revoke 뒤 provider의 답을 받는다. 전체 revoke, rotate, 만료는 HTTP 요청도 끝낸다.
위치: `src/server/peer-server.ts:1518`, `src/server/peer-server.ts:1598`, `src/server/peer-server.ts:2377`, `src/server/peer-server.ts:2395`.
관련: R-ROOM-047, R-MCP-005.

**O-20 (medium) provider→agent broadcast를 거르지 않는다.** agent→provider는 `offer`만 허용하지만, provider frame은 `ready`, `error`,
`session.revoked`, `room.rotated`, `approval.*`를 포함해 그대로 pending ticket을 포함한 모든 agent에 간다. `PeerMcpSession`은 `ready`로
sessionId를 다시 묶고, `error`로 모든 pending을 거절하고, `session.revoked`·`room.rotated`로 session을 끝낸다. 한 agent의 offer에 대한
`answer`가 room의 모든 agent에 간다. 위치: `src/server/peer-server.ts:104`, `src/server/peer-server.ts:2611`, `src/server/peer-server.ts:749`,
`src/client/session.ts:430`, `src/client/session.ts:508`, `README.md:126`. 관련: R-SIG-004, R-SIG-019, R-PEER-038.

**O-21 (medium) upgrade 거절에 HTTP 응답이 없고 handshake 검사가 늦고 느슨하다.** Origin 외의 모든 upgrade 거절(경로, room 없음·만료·
rotate, ticket, version, key)은 socket 파기뿐이다. HTTP route는 같은 조건에 typed status를 준다. RFC 6455 §4.4의 version 불일치 426도
없다. client는 틀린 ticket과 죽은 room을 구별할 수 없다. `BAD_UPGRADE`는 room·ticket 검사 뒤에 하고, method와 key 형식은 보지 않는다.
테스트가 없다. 위치: `src/server/peer-server.ts:2519`, `src/server/peer-server.ts:2526`, `src/server/peer-server.ts:2653`,
`src/server/peer-server.ts:2831`, `src/server/ws-upgrade.ts:280`. 관련: R-WS-001, R-WS-004, R-WS-008.

**O-22 (medium) subprotocol 협상이 RFC 6455 §4.2.2와 다르다.** `webmcp-peer.v1`을 제시하지 않으면 relay는 첫 값을 그대로 돌려준다. 그
값은 모르는 protocol, 빈 문자열, 비밀 `ticket.<token>`일 수 있다. 테스트가 없다. 위치: `src/server/ws-upgrade.ts:293`,
`src/server/ws-upgrade.ts:296`. 관련: R-WS-010.

**O-23 (medium) close code의 의미가 쓰이지 않는다.** codec 문서는 1000을 의도된 최종 close, 1013을 다시 시도할 수 있는 shed로 설명하지만,
relay는 provider 교체·ticket당 socket 상한처럼 다시 시도할 수 있는 상황에 1000을 쓴다. endpoint는 close code를 읽지 않는다.
`PeerMcpSession`은 1013에도 재접속하지 않고, provider는 rotate·만료의 1000에도 재접속한다. relay `close()`는 1010을 금지하지만 close
frame 되돌림은 1010을 wire에 낸다(테스트 없음). 위치: `src/server/ws-upgrade.ts:26`, `src/server/ws-upgrade.ts:66`,
`src/server/ws-upgrade.ts:219`, `src/server/ws-upgrade.ts:556`, `src/server/peer-server.ts:771`, `src/server/peer-server.ts:2820`,
`src/client/session.ts:562`, `src/provider/peer-client.ts:1018`. 관련: R-WS-019, R-WS-028, R-WS-030, R-PEER-025, R-PEER-045.

**O-24 (medium) Host header를 강제하지 않고 proxy header를 아무에게서나 믿는다.** README는 "Origin and Host header guards"라 하지만
`isHostAllowed`는 descriptor URL만 고른다. 어떤 Host도 HTTP·WebSocket에서 처리되므로 DNS rebinding 방어가 없다. `X-Forwarded-Proto`는
그대로, `X-Forwarded-Host`는 허용 host(기본 `*.pages.dev`, `*.workers.dev`, `*.trycloudflare.com` 포함)면 누구에게서 와도 믿는다.
반면 publish rate-limit 신원은 `X-Forwarded-For`를 보지 않으므로 proxy 뒤에서는 모든 호출자가 자격 등급마다 bucket 하나를 나눈다. 위치:
`src/server/peer-server.ts:585`, `src/server/peer-server.ts:586`, `src/server/peer-server.ts:1235`, `src/server/server-config.ts:45`,
`src/server/server-config.ts:484`, `README.md:84`. 관련: R-HTTP-013, R-ROOM-010.

**O-25 (medium) Origin 허용 목록을 좁힐 수 없고 거절 표현이 넷이다.** loopback origin(모든 scheme·port)과
`framebook-storyboard.pages.dev`(하위 도메인 포함)는 설정과 무관하게 허용되고, 설정 목록은 `DEFAULT_ALLOWED_ORIGINS`와 합쳐져
port별 기본값은 효과가 없다. 거절은 upgrade의 403 text(`Content-Length` 없이 write 직후 파기), preflight `CORS_ORIGIN_DENIED`, 그 밖
`ORIGIN_NOT_ALLOWED`이고, client 테스트 fixture는 relay가 내지 않는 `ORIGIN_DENIED`를 쓴다. 실제 Origin 거절을 확인하는 테스트가 없다.
위치: `src/server/server-config.ts:33`, `src/server/server-config.ts:400`, `src/server/server-config.ts:445`, `src/server/server-config.ts:449`,
`src/server/peer-server.ts:2494`, `src/server/peer-server.ts:1653`, `src/server/peer-server.ts:1670`, `test/client-config.test.ts:46`.
관련: R-WS-003, R-HTTP-010, R-HTTP-011, R-HTTP-012.

**O-26 (medium) 기본 설정에서 room 생성에 상한이 없다.** publish key가 없으면 rate limit max 기본값이 0(무제한)이고 Origin 없는 요청은
언제나 허용된다. room map에 크기 상한이 없고 모든 room은 `expiresAt` + 24시간까지 남는다. README는 "every room expires and is swept"라고
하지만 동시에 존재하는 room 수를 제한하는 것은 없다. 위치: `src/server/server-config.ts:389`, `src/server/peer-server.ts:1242`,
`src/server/peer-server.ts:562`, `README.md:123`. 관련: R-ROOM-010, R-LIM-031.

**O-27 (medium) CORS 응답에 빈틈이 있다.** `Access-Control-Expose-Headers`가 없어 browser는 `Retry-After`, `ETag`, `X-MCP-Catalog-*`,
`X-RateLimit-*`를 읽지 못한다. preflight는 쓰지 않는 `PATCH`를 알리고 `DELETE`(`/p/:id/mcp`의 405)를 빠뜨린다. Origin 없는 preflight는
`Access-Control-Allow-Origin: http://{host}:{port}`(예: `http://0.0.0.0:8787`)다. preflight 403과 `ORIGIN_NOT_ALLOWED`에는 `Vary`가 없다.
위치: `src/server/peer-server.ts:1189`, `src/server/peer-server.ts:1656`, `src/server/peer-server.ts:1659`, `src/server/peer-server.ts:791`.
관련: R-HTTP-004, R-HTTP-010.

**O-28 (medium) 진행 중 HTTP 요청의 relay 오류는 200이다.** bridge 답은 `sendJson(res, 200, …)`이라 `MCP_REQUEST_TIMEOUT`,
`PROVIDER_DISCONNECTED`, `ROOM_ROTATED`, `ROOM_EXPIRED`, `SESSION_INVALID`가 200으로 가고, 새 요청의 같은 이름은 410·401·503이다. client
HTTP transport는 non-2xx에만 `httpStatus`를 붙인다. 위치: `src/server/peer-server.ts:2155`, `src/server/peer-server.ts:1996`,
`src/server/peer-server.ts:2000`, `src/client/transport.ts:161`. 관련: R-MCP-023.

**O-29 (medium) notification 처리가 transport와 method마다 다르다.** WebSocket notification은 provider가 바쁘거나 없거나 너무 크면 조용히
버려지고, HTTP는 503·413을 id null로 받는다. relay가 직접 답하는 method를 id 없이 보내면(`ping`, `initialize`, `tools/list`,
`server/discover`) 202가 아니라 200 JSON(id null)이고, id가 있는 `notifications/initialized`는 202다. changeset은 "notifications (no id)
get 202 with an empty body"라고 한다. 위치: `src/server/peer-server.ts:2711`, `src/server/peer-server.ts:2111`, `src/server/peer-server.ts:1979`,
`src/server/peer-server.ts:2050`, `.changeset/webmcp-peer-initialize-era-transport.md:9`. 관련: R-MCP-017, R-MCP-022, R-MCP-030.

**O-30 (low) metadata method의 취급이 transport마다 다르다.** HTTP는 `initialize`, `ping`, `tools/list`, `server/discover`,
`notifications/initialized`를 room·ticket 상태와 무관하게 relay가 답한다. WebSocket은 모두 provider에 넘기고 approved ticket을
요구한다(pending ticket의 `ping`도 −32053). WebSocket `tools/list`는 room catalog를 바꿀 수 있고 HTTP는 바꾸지 않는다. 위치:
`src/server/peer-server.ts:1980`, `src/server/peer-server.ts:2694`, `src/server/peer-server.ts:2766`, `src/server/peer-server.ts:972`.
관련: R-MCP-012, R-MCP-029, R-MCP-036, R-CAT-014.

**O-31 (medium) catalog stamp의 위치가 다르다.** HTTP `tools/list`·`server/discover`는 `result._meta`, WebSocket listing 답은 agent가
`_meta`를 보냈을 때만 `result` 최상위, relay의 WebSocket `tools/list` fallback에는 `_meta` object가 없다. README의 "HTTP and WebSocket
agents therefore see the same catalog"는 tools에만 맞는다. 위치: `src/server/peer-server.ts:2068`, `src/server/peer-server.ts:976`,
`src/server/peer-server.ts:1000`, `src/client/session.ts:798`, `README.md:188`. 관련: R-MCP-018, R-MCP-038, R-MCP-039.

**O-32 (medium) tool 이름 공백 규칙이 relay와 client에서 다르다.** relay는 앞뒤 공백 있는 이름을 거절하고 client `normalizeTools`는
trim해서 받는다. `deployment-catalog.ts`는 client 계약대로 검사한다고 하고, catalog-contract 테스트도 client가 받는 `' padded '`를 거절
대상에 넣었다. 128·256 상한은 client에서 따로 쓴 숫자이고, `CATALOG_INVALID` reason에는 길이·공백 규칙이 빠졌다. 위치:
`src/server/deployment-catalog.ts:63`, `src/server/deployment-catalog.ts:77`, `src/client/catalog-hash.ts:70`, `src/client/catalog-hash.ts:76`,
`src/client/catalog-hash.ts:79`, `src/server/peer-server.ts:936`. 관련: R-CAT-001, R-LIM-018, R-LIM-019.

**O-33 (medium) client가 relay의 catalogHash를 검증하지 않는다.** `PeerMcpSession`은 받은 hash를 그대로 쓰고 자기 cache만 다시 계산한다.
데모 agent는 모든 hash를 다시 계산해 `CATALOG_INTEGRITY_UNVERIFIED`로 막는다. README는 `PeerMcpSession`을 "Catalog Drift Fail-Closed
Guard"라 부르고 agent가 hash를 검증한다고 쓰는데, 그것은 데모에만 맞다. 위치: `src/client/session.ts:862`, `src/client/session.ts:276`,
`examples/live-demo/agent-client.js:173`, `README.md:28`, `README.md:277`. 관련: R-PEER-041.

**O-34 (low) 아무도 내지 않는 drift code를 client가 기다린다.** client는 −32027 `SOURCE_CHANGED`·`RUNTIME_EPOCH_MISMATCH`와
`CATALOG_STALE`을 drift로 보고 모든 호출에 `_meta.runtimeEpoch`를 보내지만, relay와 provider는 이 code를 내지도 `runtimeEpoch`를 보지도
않는다. README:251과 api-index는 −32027을 계약처럼 쓴다. 위치: `src/client/errors.ts:46`, `src/client/session.ts:832`,
`src/server/peer-server.ts:2085`, `README.md:251`, `docs/internal/api-index.md:2025`. 관련: R-MCP-020, R-PEER-044.

**O-35 (low) 종료 frame이 AgentOutbox를 우회한다.** `replyToAgent` 주석과 README:191은 agent의 승인 상태가 버려지지 않고 순서대로
간다고 하지만, `approval.pending`·`approval.approved`(그리고 `ready`)만 outbox로 가고 `approval.rejected`, `session.revoked`,
`room.rotated`, `approval.expired`는 plain `send`라 `busy`로 사라지거나 기다리는 답을 앞지를 수 있으며 뒤의 close가 대기 frame을
버린다. 위치: `src/server/peer-server.ts:730`, `src/server/peer-server.ts:1405`, `src/server/peer-server.ts:1522`, `README.md:191`.
관련: R-WS-033.

**O-36 (low) pending 상한과 중복 id 규칙이 WebSocket에만 있다.** HTTP 요청은 agent별로 세지 않고 중복 id를 wire id로 바꾼다.
WebSocket은 같은 socket의 중복을 거절한다. relay의 64에는 outbox의 답 아닌 frame(`approval.pending`, `approval.approved`, `ready`,
`offer.refused`)도 들어가지만 client는 그것을 세지 않으므로, limits.ts의 "agent's count … always includes every one the relay counts"와
달리 client가 64 미만이라 믿을 때 `TOO_MANY_PENDING_REQUESTS`를 받을 수 있다. 위치: `src/server/peer-server.ts:2736`,
`src/server/peer-server.ts:2740`, `src/server/peer-server.ts:716`, `src/server/peer-server.ts:2120`, `src/config/limits.ts:61`,
`src/client/session.ts:616`. 관련: R-MCP-031, R-MCP-032, R-PEER-035.

**O-37 (low) 요청 상한을 재는 byte가 transport마다 다르다.** WebSocket은 `{type:'mcp', message}` frame 전체(agent가 더한 필드 포함),
HTTP는 JSON-RPC body만 잰다. 그래서 261120 byte에 약 25 byte 이내인 요청은 HTTP에서는 받고 WebSocket에서는 거절된다(limits.ts가 문서화).
id echo도 다르다: HTTP 읽기 단계 413은 id null, 재직렬화 413은 요청 id, WebSocket은 요청 id. 위치: `src/config/limits.ts:20`,
`src/server/peer-server.ts:214`, `src/server/peer-server.ts:1943`, `src/server/peer-server.ts:1964`. 관련: R-MCP-008, R-MCP-010, R-MCP-027.

**O-38 (low) UTF-8과 BOM 처리가 transport마다 다르다.** 잘못된 UTF-8은 WebSocket에서 1007 close, MCP POST에서 400 `PARSE_ERROR`, JSON
body route에서 400 `INVALID_JSON_BODY`다. 앞의 BOM은 WebSocket codec이 남기므로 `JSON.parse`가 실패해 frame이 조용히 무시되고, MCP POST는
400 `PARSE_ERROR`, JSON body route는 `String#trim`이 지워서 받는다. 위치: `src/server/ws-upgrade.ts:193`, `src/server/peer-server.ts:205`,
`src/server/peer-server.ts:1272`, `src/server/peer-server.ts:1947`. 관련: R-WS-017, R-HTTP-008, R-MCP-009.

**O-39 (low) 빈 catalog가 transport마다 다르게 보인다.** version 0인 room이 `[]`를 등록하면 version 1로 받아들이고 WebSocket
`tools/list`는 빈 목록을 준다. HTTP `tools/list`·`server/discover`와 `GET /p/:id/mcp/tools`는 503 `CATALOG_UNAVAILABLE`이고, GET body의
`catalogVersion`은 0으로 고정돼 있으며 descriptor는 실제 version과 `toolCount: 0`을 보고한다. 위치: `src/server/peer-server.ts:812`,
`src/server/peer-server.ts:1922`, `src/server/peer-server.ts:2008`, `src/server/peer-server.ts:1887`. 관련: R-CAT-003, R-MCP-015, R-ROOM-063.

**O-40 (low) register 평가 budget은 아무것도 바꾸지 않는 frame만 제한한다.** 받아들인 catalog는 token을 돌려주므로 두 catalog를 번갈아
보내는 provider는 매번 평가·versioning·broadcast(`list_changed`와 최대 260096 byte announcement)를 받는다. WebSocket listing 답에서 받은
catalog는 budget을 쓰지 않고 `list_changed`만 알린다. 위치: `src/server/peer-server.ts:920`, `src/server/peer-server.ts:922`,
`src/server/peer-server.ts:972`, `src/server/peer-server.ts:820`. 관련: R-CAT-012, R-CAT-014.

**O-41 (low) client가 relay의 HTTP 규칙 일부를 따르지 않는다.** HTTP `PROVIDER_BUSY`의 `Retry-After: 1`을 읽지 않고 자체 backoff(100 ms부터)를
쓴다. `MCP-Protocol-Version` header와 `notifications/initialized`를 보내지 않는다(relay는 둘 다 없어도 받는다). 위치:
`src/client/session.ts:98`, `src/client/transport.ts:152`, `src/client/session.ts:760`, `src/server/peer-server.ts:792`. 관련: R-PEER-036,
R-PEER-037, R-PEER-039.

**O-42 (low) relay에 liveness 검출이 없다.** relay는 WebSocket ping을 보내지 않고 idle timeout이 없다. provider의 25 s application ping은
아무것도 요구하지 않고, `PeerMcpSession`은 ping을 보내지 않는다. FIN·RST 없이 사라진 peer는 TCP 오류나 room 만료까지 붙어 있다. 위치:
`src/server/ws-upgrade.ts:548`, `src/provider/peer-client.ts:1090`, `src/server/peer-server.ts:2547`. 관련: R-WS-021, R-SIG-007.

**O-43 (low) provider의 승인 slot이 room에 하나다.** provider는 relay가 찍은 `sessionId`를 보지 않고 room 단위 `approvalState` 하나로
막는다. 새 `approval.request`가 `approved`를 덮어쓰고 거절·DataChannel close가 room 전체를 revoke한다. relay가 room당 ticket 하나만
발급하므로(1회용 invite) 지금은 일관된다. 이 불변식을 protocol로 고정할지, provider가 session별로 승인을 추적할지 결정해야 한다. 위치:
`src/provider/peer-client.ts:914`, `src/provider/peer-client.ts:1355`, `src/server/peer-server.ts:1484`, `src/server/peer-server.ts:2705`.
관련: R-ROOM-005, R-PEER-012, R-PEER-017.

**O-44 (medium) auto-reconnect의 조건이 문서보다 좁고 write 동의를 다시 켠다.** README는 성공할 때까지 재접속한다고 하지만 코드는
browser에서만 돌고, `room.rotated`, 승인 만료, session 만료, revoke frame, 건너뛴 시도, DataChannel 인계 뒤에는 영구히 멈춘다.
401·404·410 또는 409 `ROOM_LEASE_BINDING_INVALID`로 거절된 reclaim은 새 room과 새 초대 URL로 조용히 넘어간다. auto-reconnect 경로는
localStorage `webmcp:write-enabled`가 정확히 `'false'`가 아니면 write를 켜는데, provider는 이 key를 쓰지 않는다. 테스트가 없다. 위치:
`README.md:196`, `src/provider/peer-client.ts:583`, `src/provider/peer-client.ts:592`, `src/provider/peer-client.ts:611`,
`src/provider/peer-client.ts:628`, `src/provider/peer-client.ts:801`, `src/provider/peer-client.ts:1021`. 관련: R-PEER-024, R-PEER-025, R-PEER-028.

**O-45 (medium) DataChannel framing은 비대칭이고 구현이 한쪽뿐이다.** provider는 2048 단위 chunk를 개수 제한 없이 보내지만 받을 때는 512
chunk × 16384 문자로 제한한다. 1048576자를 넘는 provider 답은 자기 수신 규칙을 깬다. offer·answer·hello·grant·release의 agent 쪽 구현이
package에 없어(client SDK와 데모 모두) 이 부분은 provider만 정의하고 fake로만 시험한다. `release` 뒤 relay에는 이 room의 provider
socket이 없어 HTTP·WebSocket agent가 `PROVIDER_UNAVAILABLE`을 받는다. 위치: `src/provider/peer-client.ts:1550`,
`src/provider/wire-schemas.ts:24`, `src/provider/peer-client.ts:1252`, `src/provider/peer-client.ts:1289`. 관련: R-PEER-023, R-PEER-029.

**O-46 (low) HTTP method·cache 처리가 고르지 않다.** descriptor는 `Accept`에 따라 달라지지만(SSE만이면 405) `Vary`에는 `Origin,
Accept-Encoding`만 있다. 같은 resource의 405가 `Allow: POST`(SSE)와 `Allow: GET, POST`(DELETE)로 다르다. `PUT`·`PATCH`는 405가 아니라
404다. `/health`·`/status`·`/ping`은 아무 method나, `/config`는 GET만 받고, `activeRooms`는 보존 중인 room을 센다. ETag·304·cache header를
확인하는 테스트가 없다. 위치: `src/server/peer-server.ts:1058`, `src/server/peer-server.ts:1864`, `src/server/peer-server.ts:1869`,
`src/server/peer-server.ts:2482`, `src/server/peer-server.ts:1675`, `src/server/peer-server.ts:1685`. 관련: R-HTTP-001, R-HTTP-014,
R-ROOM-006, R-ROOM-059, R-ROOM-061.

**O-47 (low) 일부 상태가 wire에서 관찰되지 않는다.** 만료 room의 session status는 sweep 때문에 `revoked`다. `waitForPeerApproval`은
`room-rotated` state를 처리하지만 relay는 그 state를 보고하지 않고 rotate된 room에 410을 준다. `ClientSessionStatus`의 `room-rotated`와
`roomState`의 `rotating`은 wire에서 보이지 않는다. 위치: `src/server/peer-server.ts:1644`, `src/client/room-lifecycle.ts:235`,
`src/server/peer-server.ts:2303`, `src/server/types.ts:9`, `src/server/types.ts:60`. 관련: R-ROOM-003, R-ROOM-035, R-PEER-048.

**O-48 (low) join만 만료 비교가 엄격하다.** join은 `expiresAt < now`, 다른 route는 `expiresAt <= now`다. `expiresAt == now`인 같은 ms에 join은
sweep이 막 revoke한 room에서 이미 만료된 ticket을 발급할 수 있다. 위치: `src/server/peer-server.ts:2171`, `src/server/peer-server.ts:1790`,
`src/server/peer-server.ts:2253`. 관련: R-ROOM-019.

**O-49 (low) `rotatedRetainUntil`은 효과가 없다.** 보존 기한은 `max(metadataRetainUntil, rotatedRetainUntil)`이고 `metadataRetainUntil`
(원래 `expiresAt` + 24시간)이 언제나 더 늦으므로, rotate된 room은 TTL + 24시간까지 남아 410 `ROOM_ROTATED`를 준다. 위치:
`src/server/peer-server.ts:2437`, `src/server/peer-server.ts:1613`, `src/server/peer-server.ts:562`. 관련: R-ROOM-051, R-LIM-029.

**O-50 (low) revoke 응답 모양과 reason이 고르지 않다.** 전체 revoke는 `{roomId, revoked, revokedSessions}`뿐이다. 단일 revoke는
`body.reason`을 검사 없이 되돌리고(어떤 JSON 값이든, 기본 `provider-request`·`client-request`), `session.revoked` frame은 고정 reason
(`SESSION_REVOKED`, `CLIENT_REVOKED`, `ROOM_REVOKED`)을 쓴다. revoke는 멱등(`alreadyRevoked`)이지만 같은 승인 결정의 반복은 409다. 위치:
`src/server/peer-server.ts:2366`, `src/server/peer-server.ts:2378`, `src/server/peer-server.ts:2396`, `src/server/peer-server.ts:2272`.
관련: R-ROOM-028, R-ROOM-038, R-ROOM-039, R-SIG-015.

**O-51 (low) owner 힌트는 검사만 하고 버린다.** publish key가 없어도 header·body owner가 충돌하면 403이지만, room의 `ownerId`는
`publishKeyOwner`(또는 key가 있을 때 `publish-key-owner`)에서만 온다. 위치: `src/server/peer-server.ts:1745`, `src/server/peer-server.ts:1746`,
`src/server/peer-server.ts:1760`. 관련: R-ROOM-011.

**O-52 (low) alias에 길이 상한이 없다.** join `clientLabel`은 256 code point로 자르지만 `POST /p`·rotate의 alias는 64 KiB body 외에 상한이
없고 공개 `GET /p/:id/mcp`에 그대로 나온다. 위치: `src/server/peer-server.ts:1752`, `src/server/peer-server.ts:2428`,
`src/server/peer-server.ts:2209`. 관련: R-ROOM-012, R-LIM-022.

**O-53 (low) 설정과 catalog loader에 남은 것이 있다.** SQLite rate-limit store의 env(`FRAMEBOOK_PUBLISH_RATE_LIMIT_SQLITE_PATH`,
`WEBMCP_PUBLISH_RATE_LIMIT_SQLITE_PATH`)는 server가 부르지 않는 함수만 읽는다. deployment catalog loader는 `options.cwd`가 아니라
`process.cwd()`를 쓰고 다른 package 경로(`packages/peer-server/api/webmcp-tools.json`)를 본다. `journalPath`는 해석만 하고 쓰지 않는다.
위치: `src/server/rate-limit.ts:293`, `src/server/peer-server.ts:435`, `src/server/deployment-catalog.ts:119`, `src/server/server-config.ts:332`.
관련: R-ROOM-010, R-CAT-004.

**O-54 (low) 기본값이 서로 다르다.** `createPeerConfigProfile`은 `defaults.roomTtlMs` 7200000을 clamp 없이 쓰고, `/config`는
`clampRoomTtl(2 h)`(예: `maxRoomTtlMs` 10분이면 600000)를 알린다. `PeerServerPublicConfig` type에는 `/config`가 보내는
`defaults.maxRoomTtlMs`가 없다. provider는 descriptor에 만료가 없으면 relay 기본 2시간이 아닌 30분을 가정한다. 위치:
`src/config/profile.ts:16`, `src/server/peer-server.ts:1695`, `src/config/types.ts:59`, `src/provider/peer-client.ts:825`. 관련: R-ROOM-007,
R-PEER-002, R-PEER-052.

**O-55 (medium) config library의 `descriptorUrl`이 route가 아니다.** `parseInvitationUrl`과 `buildInvitationUrl`은 descriptorUrl을
`<server>/p/<roomId>`로 만들지만 relay의 descriptorUrl과 provider가 공유하는 URL은 `<server>/p/<roomId>/mcp`이고, `GET /p/<roomId>`는
404 `NOT_FOUND`다. 위치: `src/config/invitation.ts:87`, `src/config/invitation.ts:109`, `src/server/peer-server.ts:605`. 관련: R-PEER-052.

**O-56 (medium) client revoke 오류 code와 service 등록 key가 혼동된다.** `PeerMcpSession.revoke`는 `body.code`가 문자열일 때만 code로
쓰는데 relay는 문자열 code를 보내지 않아(수 −32002 또는 없음) 실패는 언제나 `SESSION_REVOKE_FAILED`다. 다른 helper는 `body.error`를
code로 쓴다. `PeerMcpService`의 `options.sessionId`는 등록 key이자 relay가 묶은 session id로 쓰여, 임의 key로 등록한 session은 bearer
전용 route 대신 `/sessions/<key>/revoke`로 revoke한다. 위치: `src/client/session.ts:953`, `src/client/room-lifecycle.ts:164`,
`src/client/service.ts:28`, `src/client/session.ts:176`, `src/client/session.ts:927`. 관련: R-PEER-046.

**O-57 (low) 오류 경로 두 곳이 덜 다듬어졌다.** `:requestId`·`:sessionId`의 잘못된 percent-encoding은 `decodeURIComponent`가 던져 4xx가
아닌 500 `PEER_REQUEST_FAILED`다. MCP POST는 drain 상한을 넘은 body에 `res.destroy()`를 부르지 않고 `req.destroy()`에 기댄다(JSON body route는
부른다). 위치: `src/server/peer-server.ts:2246`, `src/server/peer-server.ts:2297`, `src/server/peer-server.ts:2356`,
`src/server/peer-server.ts:1942`, `src/server/peer-server.ts:1302`. 관련: R-HTTP-003, R-MCP-008.

**O-58 (low) offer에 상한이 덜 걸린다.** relay는 문자열 `requestId`만 크기를 보고, `offer.refused`도 문자열일 때만 되돌린다. provider는
문자열이 아닌 requestId를 무시하고 마지막 승인 requestId로 답한다. offer는 pending 상한에 세지 않고 rate limit도 없다. agent `ice` frame은
조용히 버려진다(trickle ICE 없음). 위치: `src/server/peer-server.ts:220`, `src/server/peer-server.ts:2795`, `src/provider/peer-client.ts:976`,
`src/server/peer-server.ts:104`. 관련: R-SIG-017, R-SIG-018, R-PEER-022.

**O-59 (mixed) 문서와 주석이 코드와 다르다.**

- `README.md:84`: "Origin and Host header guards". Host는 강제하지 않는다(O-24).
- `README.md:182`, `src/provider/peer-client.ts:96`, `src/provider/tool-call.ts:41`: "a closed provider socket drops every agent of the
  room". 실제로는 agent socket이 열려 있고 pending 요청만 `PROVIDER_DISCONNECTED`로 끝난다(R-ROOM-054).
- `README.md:190`: "only a queue that stays full for 30 s closes it". 실제로는 거절 뒤 30 s 동안 write가 하나도 끝나지 않을 때만 닫는다
  (R-WS-026).
- `README.md:192`: clientLabel "trimmed to 256 characters". 실제로는 trim 뒤 256 code point로 자르고 끝 공백을 지운다(R-ROOM-022).
- `README.md:179`: host CallToolResult "is forwarded as is". `isError`를 늘 다시 계산하고 content가 없으면 text block을 만든다(R-PEER-013).
- `README.md:194`: 유효한 receipt는 "is recorded in the AI run ledger". ledger는 기본으로 없다(`setAiRunLedger` 필요).
- `README.md:28`, `README.md:277`: catalog hash 검증은 데모 agent만 한다(O-33). `README.md:251`: −32027(O-34).
- `docs/internal/api-index.md:2027`: client가 message 상한 초과를 거절한다고 하지만 기준은 request 상한(261120)이다. `:2035`: 보류 기준은
  `PEER_RELAY_MAX_CATALOG_BYTES`(258048)다.
- `.changeset/webmcp-peer-stabilization.md:12`: "128 KiB frame limit". 코드와 다른 changeset은 256 KiB다.
- `docs/changelog.md:7`: 2026-10-20 항목은 relay protocol이 바뀌지 않았다고 하지만 같은 항목이 offer의 `REQUEST_ID_TOO_LARGE`
  `offer.refused`와 register 거절 시점(rate limit, 반복 생략)을 바꾼다.
- `docs/guides/webmcp-projection-and-relay-guide.md:310`: 소비된 invite를 `409 ROOM_BUSY`로 적는다(`@oa-sdk/peer-server`의 동작).
  webmcp-peer는 409 `INVITE_TOKEN_CONSUMED`다. 이 guide는 두 package의 `/p/:id/...` 경로를 섞어 쓴다.
- `docs/security/webmcp-hardening.md`와 `docs/concepts/webmcp-peering-mesh-and-collab.md`는 webmcp-peer를 다루지 않는다. relay의
  publish key, ticket subprotocol, 승인 gate, 상한을 다루는 보안 문서가 없다.
- `src/server/peer-server.ts:200`: `unforwardedRpcError`의 JSDoc이 `decodeUtf8Body` 위에 떨어져 있다.
- `src/client/types.ts:5`: `PACKAGE_VERSION` `0.1.0`은 손으로 맞춘 값이라 대기 중인 changeset의 minor bump 뒤 틀린다.

**O-60 (medium) 테스트가 없는 요건이 있다.** 다음 요건은 근거 테스트가 없다: R-WS-001, R-WS-003, R-WS-004, R-WS-006, R-WS-008,
R-WS-010, R-WS-033, R-HTTP-002, R-HTTP-003, R-HTTP-005, R-HTTP-011, R-HTTP-012, R-HTTP-013, R-HTTP-014, R-LIM-025, R-LIM-027,
R-LIM-029, R-LIM-030, R-LIM-034, R-LIM-036, R-LIM-040, R-ROOM-001, R-ROOM-011, R-ROOM-015, R-ROOM-018, R-ROOM-026, R-ROOM-035,
R-ROOM-042, R-ROOM-049, R-ROOM-051, R-ROOM-057, R-ROOM-061, R-ROOM-065, R-SIG-002, R-SIG-009, R-SIG-012, R-SIG-019, R-MCP-002,
R-MCP-004, R-MCP-013, R-MCP-031, R-MCP-036, R-PEER-002, R-PEER-015, R-PEER-019, R-PEER-021, R-PEER-023, R-PEER-026, R-PEER-027,
R-PEER-028, R-PEER-029. 근거 테스트가 있어도 일부 경우만 다루는 것: WebSocket `INVALID_REQUEST`(R-MCP-028), relay가 내는 WebSocket
`CATALOG_CHANGED`·`TOOL_NOT_FOUND`·잘못된 params(R-MCP-020), batch 거절(R-MCP-009), `SESSION_INVALID` 외의 HTTP ticket 오류(R-MCP-014),
SSE·DELETE 405의 body, `initialize`의 `_meta.bootstrapCatalog`와 `X-MCP-Catalog-*`(R-MCP-016), `list_changed`가 announcement보다 먼저인
순서(R-CAT-008), pending ticket에 가는 provider broadcast(R-SIG-004), register 경로를 거친 자기 `__proto__` key(R-CAT-002), ledger
replay·`RECONCILIATION_REQUIRED`·`OUTCOME_UNKNOWN`·`PEER_SESSION_SUPERSEDED`(R-PEER-012, R-PEER-016), client `initialize`의
`protocolVersion`(R-PEER-039).

## 11. 변경 이력

| 날짜 | 변경 | 이유 | 영향 범위 |
|---|---|---|---|
| 2026-10-20 | 최초 작성. `packages/webmcp-peer`의 relay·provider·agent client 코드와 테스트에서 현재 wire 동작을 추출해 요건 R-WS, R-HTTP, R-LIM, R-ROOM, R-SIG, R-CAT, R-MCP, R-ERR, R-PEER로 정리하고, 코드 간 불일치를 O-01~O-60으로 기록했다. | 동작은 확인됐고 스펙 안정화가 필요했다. README·api-index·guide에 흩어진 relay 규칙을 한 정본으로 모은다. | 문서만. 코드·테스트·다른 문서는 바꾸지 않았다. 다른 문서가 이 문서를 링크하도록 바꾸는 일은 후속 작업이다. |
