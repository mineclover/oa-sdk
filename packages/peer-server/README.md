# @oa-sdk/peer-server

WebMCP peer registry, HTTP bridge route와 provider room을 제공하는 Node.js 서버입니다.
전체 구성은 [WebMCP 피어링·전송·협업·메시 아키텍처](../../docs/concepts/webmcp-peering-mesh-and-collab.md)를 참조하십시오.

## 기능

- 기본 포트 8787에서 `/status`, `/tools`, `/announce`, `/call`을 제공합니다.
- `GET /p/:id/mcp`는 signaling URL과 ICE 설정을 담은 rendezvous descriptor를 반환합니다.
  `POST`는 `426 P2P_TRANSPORT_REQUIRED`를 반환합니다.
- `PeerRoomManager`는 호스트가 연결한 provider socket으로 RPC를 보내고 응답을 연결합니다.
  HTTP `/call`은 provider를 최대 3.5초 기다리고, 전송 후 응답은 최대 30초 기다립니다.
- `/home/mcp`는 서버 진단용 tool catalog와 JSON-RPC `tools/list`, `tools/call`을 처리합니다.
- `FilePeerStore`는 기본 `~/.webmcp/peers.json`에 peer metadata와 tool catalog를 원자적으로 저장합니다.
  저장되는 tool은 `name`, `description`, `inputSchema`만 가집니다.
- 연결된 peer의 `GET /tools`는 `/announce`로 받은 tool member를 그대로 반환합니다(`title`,
  `annotations`, `outputSchema`, `_meta` 등). `description`이나 `inputSchema`의 타입이 틀리면
  announce가 400으로 거부됩니다. 타입이 틀린 `title`, `annotations`, `outputSchema`와 JSON 값이
  아닌 그 밖의 member는 announce를 거부하지 않고 catalog에서만 뺍니다.

서버는 WebSocket upgrade handler나 SDP/ICE 교환을 구현하지 않습니다. descriptor의 `/ws` URL을
사용하려면 호스트가 signaling adapter를 제공해야 합니다. `/announce`의 metadata 등록만으로
실행 가능한 provider socket이 연결되지는 않습니다.

## 사용

```bash
pnpm add @oa-sdk/peer-server
```

```typescript
import { createPeerServer } from '@oa-sdk/peer-server'

const server = createPeerServer({
  port: 8787,
  hostname: '127.0.0.1',
  publishKey: process.env.WEBMCP_PUBLISH_KEY,
  allowedOrigins: ['http://localhost:3000'],
})

await server.start()
// 종료 시: await server.close()
```

loopback 외부 listener에는 `publishKey`가 필수입니다. 키를 설정하면 HTTP 요청은
`Authorization: Bearer <key>` 또는 `X-Peer-Publish-Key`로 인증해야 합니다. CORS preflight는
별도로 처리합니다. 본문은 기본 1MiB, 최대 16MiB로 제한하며 상태 응답에서는 token과 invitation URL을 제거합니다.

`peer-server`는 `peer-transport`의 계약을 사용하고, `mcp-mesh`가 서버·클라이언트 API를 조합합니다.
