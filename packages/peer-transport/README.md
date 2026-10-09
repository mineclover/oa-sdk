# @oa-sdk/peer-transport

HTTP bridge client, WebRTC/WebSocket 전송 채널, signaling 프로토콜 및 호스트 adapter 라이브러리입니다.
Node.js 22 이상 및 브라우저 환경을 지원합니다.

전체 구성은 [WebMCP 피어링·전송·협업·메시 아키텍처](../../docs/concepts/webmcp-peering-mesh-and-collab.md)를 참조하십시오.

## 기능

- `WebMcpBridgeClient`: 로컬 HTTP bridge의 상태, peer catalog, 도구 호출을 처리하며 읽기 작업은 로컬 peer store로 fallback할 수 있습니다.
- `P2pTransportChannel`: `mcp-jsonrpc`, `crdt-delta`, `presence` 3개 채널을 다중화(multiplexing)하고, 연결 단절 시 메모리 버퍼링 및 재연결 후 우선순위 기반 플러시를 수행합니다.
- `WebSocketTransportAdapter` (`@oa-sdk/peer-transport/adapters`): `P2pTransportChannel`을 WebSocket 릴레이 서버에 연결하는 호스트 어댑터로, 자동 재연결 및 릴레이 패킷 unboxing을 제공합니다.
- `CloudTransitClient` (`@oa-sdk/peer-transport/adapters`): Cloud Transit Proxy(`/transit/:peer/mcp`)를 경유하여 방화벽/NAT 너머의 브라우저 또는 로컬 데몬 도구를 호출하는 클라이언트입니다.
- `relay-protocol`: WebMCP signaling wire protocol, `SignalMessage` discriminated union, SDP 검증기 (`validateSdp`), byte bounds (`MAX_SIGNAL_BYTES = 64KB`, `MAX_RELAY_BYTES = 1MB`)를 포함합니다.

## 사용법

### 1. HTTP Bridge Client

```typescript
import { WebMcpBridgeClient } from '@oa-sdk/peer-transport'

const client = new WebMcpBridgeClient({
  serverUrl: 'http://127.0.0.1:8787',
  alias: 'wireframe-local',
  authToken: process.env.WEBMCP_PUBLISH_KEY,
})

const status = await client.getStatus()
const result = await client.callTool({
  tool: 'storyboard_page_create',
  args: { title: 'Intro Screen' },
})
```

### 2. WebSocket Transport Adapter (중계 전송)

```typescript
import {
  P2pTransportChannel,
  createWebSocketTransportAdapter,
} from '@oa-sdk/peer-transport'

const channel = new P2pTransportChannel({
  peerId: 'client-01',
  alias: 'wireframe-local',
})

const adapter = createWebSocketTransportAdapter(channel, {
  url: 'ws://127.0.0.1:8787/ws',
  tokenOrTicket: clientToken,
})

await adapter.connect()

// 패킷 전송 (직접 DataChannel이 없더라도 릴레이를 통해 전달)
await channel.send('mcp-jsonrpc', {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'storyboard_page_create', arguments: { title: 'Home' } },
})
```

### 3. Cloud Transit Client (클라우드 경유 도구 호출)

```typescript
import { createCloudTransitClient } from '@oa-sdk/peer-transport/adapters'

const transit = createCloudTransitClient({
  serverUrl: 'https://relay.example.com',
  peerAlias: 'wireframe-local',
  authToken: process.env.WEBMCP_PUBLISH_KEY,
})

const result = await transit.callTool({
  tool: 'storyboard_page_create',
  args: { title: 'Design' },
})
```
