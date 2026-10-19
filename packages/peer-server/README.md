# @oa-sdk/peer-server

WebMCP peer registry, HTTP bridge route, WebSocket signaling relay, 그리고 Cloud Transit Proxy를 제공하는 서버 라이브러리입니다.
전체 구성은 [WebMCP 피어링·전송·협업·메시 아키텍처](../../docs/concepts/webmcp-peering-mesh-and-collab.md)를 참조하십시오.

## 기능

- **HTTP Peering & Registry**: 기본 포트 8787에서 `/status`, `/tools`, `/announce`, `/call`을 제공합니다.
- **Rendezvous & Descriptors**: `GET /p/:id/mcp`는 ICE 설정과, 릴레이가 켜진 서버의 릴레이 룸 ID에 대해서는 실제 바인딩 포트의 signaling URL(`ws://host:port/p/:id/client`)을 담은 descriptor를 반환하며, `POST`는 `426 P2P_TRANSPORT_REQUIRED`를 반환합니다.
- **인증**: `publishKey`는 `POST /p/:id/join`을 제외한 모든 HTTP 요청에 필요합니다(`X-Peer-Publish-Key` 또는 `Authorization: Bearer`). 초대 조인은 룸 초대 토큰(`Authorization: Bearer <inviteToken>` 또는 본문 `inviteToken`)이 자격이며, WebSocket 업그레이드는 룸 티켓으로 인가됩니다.
- **WebSocket Signaling & Packet Relay** (`@oa-sdk/peer-server/relay`):
  - `SignalingRoom`: 7단계 FSM (`provider-wait` -> `client-wait` -> `pending` -> `approved` -> `offered` -> `answered` -> `closed`), 48-hex 티켓 인증. relay 패킷은 승인 후에만 전달되고(`RELAY_NOT_APPROVED`), 피어가 보낸 릴레이 전용 신호(`ready`/`request`/`approved`/`released`/`closed`)는 `FORBIDDEN_SIGNAL`로 거절되며, decision의 `allowedTools`는 `approved` 신호로 양측에 전달되고 client `tools/call`에 강제됩니다.
  - `PeerRelayManager` / `attachWebSocketRelay`: Node.js `ws` 기반 signaling 및 duplex packet relay. 업그레이드 경로는 `/p/:roomId/:role`과 `/ws?room=:roomId&role=:role`이며 룸·역할이 없거나 잘못되면 `400`, 다른 경로는 다른 `upgrade` 리스너가 없을 때 `404`로 응답합니다.
  - 직접 WebRTC DataChannel 수립이 불가능한 방화벽 환경에서 3채널(`mcp-jsonrpc`, `crdt-delta`, `presence`) 패킷을 안전하게 중계합니다. 승인 후 시그널링(offer/answer/release)은 60초 안에 끝나야 하고, relay 세션은 유휴 한도(`relayIdleTimeoutMs`, 기본 5분, relay 프레임마다 갱신)와 하드 한도(`relayMaxSessionMs`, 기본 24시간)를 가집니다. 범위를 벗어난 한도는 `createPeerServer`/`new PeerRelayManager` 시점에 `RangeError`로 거부됩니다. 티켓은 1회용이므로 소켓이 끊기면 세션이 끝납니다.
  - `RelayTransitBridge`: `enableRelay`와 `enableCloudTransit`을 함께 켜면, `alias=<피어 alias>`를 붙여 접속한 relay provider가 그 alias의 Cloud Transit 호출(`/transit/:peer/mcp`, `/call`)을 처리합니다. 카탈로그는 `POST /announce`로 공지합니다. relay 프레임이 `MAX_RELAY_BYTES`(1 MiB)를 넘는 호출은 그 호출만 `PAYLOAD_TOO_LARGE`로 실패하고(`/call`은 413) provider 세션은 유지됩니다.
- **Cloud Transit Proxy** (`@oa-sdk/peer-server/cloud`):
  - `POST /transit/:peer/mcp` 및 `POST /mcp`를 통해 Streamable HTTP MCP JSON-RPC 2.0 요청(`initialize`, `ping`, `tools/list`, `tools/call`)을 처리하고 피어로 라우팅합니다.
  - Cloudflare Worker 환경용 `handleCloudTransitWorker` 제공.
  - 독립 실행 `handleCloudTransitHttpRequest`와 `handleCloudTransitWorker`는 주어진 `publishKey`(없거나 틀리면 `401`)와 `allowedOrigins`(허용되지 않은 Origin은 CORS 헤더 없이 `403`, 미설정 시 loopback 오리진만 허용)를 강제하며, CORS 응답은 허용된 Origin만 반향합니다. Origin 헤더가 없는 요청(서버·CLI)은 Origin 검사 대상이 아닙니다.
- **Home MCP Endpoint**: `/home/mcp`는 서버 진단용 tool catalog와 JSON-RPC 제어를 제공합니다.
- **FilePeerStore**: `~/.webmcp/peers.json`에 peer metadata와 tool catalog를 원자적으로 저장합니다.

## 사용법

```bash
pnpm add @oa-sdk/peer-server
```

### 1. 단일 서버에서 Peering + Relay + Cloud Transit 가동

```typescript
import { createPeerServer } from '@oa-sdk/peer-server'

const server = createPeerServer({
  port: 8787,
  hostname: '127.0.0.1',
  publishKey: process.env.WEBMCP_PUBLISH_KEY,
  enableRelay: true,          // WebSocket signaling & 패킷 중계 활성화
  enableCloudTransit: true,   // /transit/:peer/mcp 엔드포인트 활성화
  allowedOrigins: ['http://localhost:3000'],
})

const { port } = await server.start()
console.log(`WebMCP Peer Server listening on port ${port}`)
```

### 2. Edge / Cloudflare Workers 환경 배포

```typescript
import { CloudTransitProxy, handleCloudTransitWorker, PeerRoomManager } from '@oa-sdk/peer-server/cloud'

const roomManager = new PeerRoomManager() // provider 소켓을 붙이는 방식은 배포 환경에 맞게 구성

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const transitProxy = new CloudTransitProxy({
      roomManager,
      publishKey: env.WEBMCP_PUBLISH_KEY,          // 없거나 틀린 키는 401
      allowedOrigins: ['https://app.example.com'], // 그 외 브라우저 Origin은 403
    })
    const url = new URL(request.url)
    if (url.pathname.startsWith('/transit/')) {
      return handleCloudTransitWorker(request, transitProxy)
    }
    // ...
  }
}
```

> 상세한 트러블슈팅 및 8대 함정 방어 가이드는 [WebMCP 프로젝션 및 중계 연동 가이드](../../docs/guides/webmcp-projection-and-relay-guide.md#7-실전-도입-트러블슈팅-및-8대-함정gotchas-방어-가이드)를 참조하십시오.

