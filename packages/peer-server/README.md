# @oa-sdk/peer-server

WebMCP peer registry, HTTP bridge route, WebSocket signaling relay, 그리고 Cloud Transit Proxy를 제공하는 서버 라이브러리입니다.
전체 구성은 [WebMCP 피어링·전송·협업·메시 아키텍처](../../docs/concepts/webmcp-peering-mesh-and-collab.md)를 참조하십시오.

## 기능

- **HTTP Peering & Registry**: 기본 포트 8787에서 `/status`, `/tools`, `/announce`, `/call`을 제공합니다.
- **Rendezvous & Descriptors**: `GET /p/:id/mcp`는 signaling URL과 ICE 설정을 담은 descriptor를 반환하며, `POST`는 `426 P2P_TRANSPORT_REQUIRED`를 반환합니다.
- **WebSocket Signaling & Packet Relay** (`@oa-sdk/peer-server/relay`):
  - `SignalingRoom`: 7단계 FSM (`provider-wait` -> `client-wait` -> `pending` -> `approved` -> `offered` -> `answered` -> `closed`), 48-hex 티켓 인증.
  - `PeerRelayManager` / `attachWebSocketRelay`: Node.js `ws` 및 Edge/Cloudflare Workers (`WebSocketPair`) 호환 signaling 및 duplex packet relay 지원.
  - 직접 WebRTC DataChannel 수립이 불가능한 방화벽 환경에서 3채널(`mcp-jsonrpc`, `crdt-delta`, `presence`) 패킷을 안전하게 중계합니다.
- **Cloud Transit Proxy** (`@oa-sdk/peer-server/cloud`):
  - `POST /transit/:peer/mcp` 및 `POST /mcp`를 통해 Streamable HTTP MCP JSON-RPC 2.0 요청(`initialize`, `ping`, `tools/list`, `tools/call`)을 처리하고 피어로 라우팅합니다.
  - Cloudflare Worker 환경용 `handleCloudTransitWorker` 제공.
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
import {
  SignalingRoom,
  CloudTransitProxy,
  handleCloudTransitWorker,
} from '@oa-sdk/peer-server'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/transit/')) {
      return handleCloudTransitWorker(request, transitProxy)
    }
    // ...
  }
}
```

> 상세한 트러블슈팅 및 8대 함정 방어 가이드는 [WebMCP 프로젝션 및 중계 연동 가이드](../../docs/guides/webmcp-projection-and-relay-guide.md#7-실전-도입-트러블슈팅-및-8대-함정gotchas-방어-가이드)를 참조하십시오.

