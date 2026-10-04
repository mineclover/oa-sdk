# @oa-sdk/peer-transport

HTTP bridge client와 주입 가능한 패킷 sender를 사용하는 전송 채널 라이브러리입니다.
현재 배포 타깃은 Node.js 22 이상이며, WebRTC 연결 생성이나 SDP/ICE signaling은 호스트 adapter가 담당합니다.

전체 구성은 [WebMCP 피어링·전송·협업·메시 아키텍처](../../docs/concepts/webmcp-peering-mesh-and-collab.md)를 참조하십시오.

## 기능

- `WebMcpBridgeClient`: 로컬 HTTP bridge의 상태, peer catalog, 도구 호출을 처리하며 읽기 작업은 로컬 peer store로 fallback할 수 있습니다.
- `P2pTransportChannel`: `mcp-jsonrpc`, `crdt-delta`, `presence` 패킷을 구분하고 sender 함수와 수신 listener를 연결합니다.
- 채널별 메모리 큐: 재연결 시 MCP, CRDT, presence 순서로 플러시하며, 기본 deadline 5초를 넘은 패킷을 버립니다.
- 송신 timeout, 선택적 heartbeat 송신, sequence/epoch 검사, 패킷 크기와 전체 큐 크기 제한을 제공합니다.

## HTTP bridge 사용

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

bridge client는 redirect를 거부하고 응답 크기를 검사합니다. `503 PEER_UNAVAILABLE`만 기본
5초 retry window에서 재시도합니다. timeout·네트워크 오류·404는 자동 재시도하지 않습니다.
인증 token을 쓰는 비-loopback URL에는 HTTPS가 필요합니다.

## 호스트 adapter 계약

호스트는 `setConnectionState(connected, sender)`로 연결 상태와 실제 sender를 제공하고,
받은 패킷을 `receivePacket()`에 전달합니다. sender가 반환하는 `true`는 로컬 송신 성공으로,
원격 도구 실행 완료를 보장하지 않습니다. heartbeat 수신 감시, 실패 판정, 재접속, peer 인증도
adapter가 담당합니다.

큐가 가득 차면 presence, CRDT, MCP 순서로 기존 패킷을 제거합니다. 큐는 프로세스 메모리에만
있으므로 무손실·영속 전달을 보장하지 않습니다. `send()`의 `false`는 직접 전송되지 않았다는 뜻이며,
보관 여부나 이후 전송 완료를 보장하지 않습니다. `dispose()`는 heartbeat와 보관된 sender/큐를 정리합니다.
재접속 epoch은 동일 channel 인스턴스에서 증가하며 새 인스턴스 사이에는 별도의 session 정책이 필요합니다.
