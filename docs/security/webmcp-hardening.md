# WebMCP 통신·인증·데이터 처리 보안 감사

2026-09-22 기준(relay·Cloud Transit 행은 2026-10-19 갱신, webmcp-peer 절은 2026-10-20 추가)으로 `peer-server`, `peer-transport`,
`collab-workspace`, `mcp-mesh`, `tools`, `webmcp-peer`의 구현된 경계와 운영 가정을 기록한다. 아래 검증은 저장소의 회귀 테스트를
가리키며, 실제 WebRTC 연결이나 다중 프로세스 환경의 인증·전달 보증을 뜻하지 않는다.

| 영역 | 확인된 위험 | 구현된 조치 | 회귀 테스트 |
| --- | --- | --- | --- |
| peer-server 인증·입력 | endpoint의 원격 무인증 노출, 큰 본문, pending RPC 누적 | loopback 외 listener의 `publishKey` 강제, Bearer/X-Peer-Publish-Key 비교, origin 정책, 기본 1MiB/최대 16MiB 본문, pending call 상한·timeout | [HTTP 경계](../../packages/peer-server/test/peer-server.test.ts), [room/store](../../packages/peer-server/test/room-store.test.ts) |
| peer-server relay·Cloud Transit | 잘못된 Host로 인한 프로세스 종료, 승인 전 relay packet 전달, 위조 control signal, 무제한 relay 세션, standalone transit 무인증 노출 | 업그레이드 Host 파싱 실패를 400으로 거절, `POST /p/:id/join`은 publishKey 대신 room invite token으로 인증, WebSocket 업그레이드는 room별 단일 사용 ticket으로 인증, 승인 전 packet은 `RELAY_NOT_APPROVED`, 역할에 맞지 않는 signal은 `FORBIDDEN_SIGNAL`, 승인 시 `allowedTools` 강제, relay idle/최대 세션 시간 제한, standalone transit handler의 `publishKey`(401)·`allowedOrigins`(403, 기본 loopback) 강제 | [relay hardening](../../packages/peer-server/test/relay-server-hardening.test.ts), [signaling session](../../packages/peer-server/test/signaling-room-session.test.ts), [transit access](../../packages/peer-server/test/transit-access.test.ts) |
| peer store | 손상·동시 갱신, 파일 권한·prototype key 위험 | schema 검사, 프로세스 내 per-path mutation queue, temp+rename 저장, 디렉터리 0700/파일 0600, token 응답 redaction | [store integrity/concurrency](../../packages/peer-server/test/room-store.test.ts) |
| bridge transport | redirect, 큰 응답, 임의 재시도, 인증 누락 | redirect 거부, 4MiB 응답 크기 검사, Bearer 전달, `503 PEER_UNAVAILABLE`만 재시도, AbortSignal 결합 | [bridge auth/retry](../../packages/peer-transport/test/peer-transport.test.ts) |
| packet channel | 큰 패킷·replay, 무제한 큐, 멈춘 sender, listener 예외 | 채널별 bounded queue, deadline, sender timeout, 선택적 heartbeat 송신, session epoch/sequence 검사, listener error hook | [packet boundary/queue/heartbeat](../../packages/peer-transport/test/peer-transport.test.ts) |
| collab workspace | path traversal, 잘못된 원격 identity, replay·sparse render, lock 밖 AI 편집 | source capability와 identity 검사, client watermark, age window·state limits, tombstone 정리, render 상한, TTL/version을 제한한 IntentLock | [ingress/lock/merge/retention](../../packages/collab-workspace/test/collab-workspace.test.ts) |
| MCP mesh | catalog 밖 호출, 모호한 bare 이름, 비활성 session, 잘못된 입력 | catalog/JSON Schema 검사, 고유 bare alias만 집계, 활성 session 선택, dispatch 전 입력 검사 | [routing/session/aggregate](../../packages/mcp-mesh/test/mcp-mesh.test.ts) |
| tools HTTP/MCP | auth surface 차이, malformed JSON, schema 제약 누락, 내부 오류 노출 | schema/docs와 도구의 공통 auth/origin/body 정책, 명시적 health 정책, Ajv 검증, request ID 기반 오류, close 가능한 HTTP handle | [security boundaries](../../packages/tools/test/security-boundaries.test.ts), [schema validation](../../packages/tools/test/schema-validation.test.ts) |

테스트 개수 대신 파일을 연결해 각 경계의 실제 검증 내용을 추적한다. 개별 테스트가 모든 운영 조건을
검증하지는 않는다. 특히 아래 책임은 호스트 또는 배포 환경에 남아 있다.

- `peer-server`의 `publishKey`는 비-loopback listener에서 필수다. `tools`의 `authToken`은 선택적이므로
  보호할 HTTP/MCP 배포에는 명시적으로 설정해야 한다. HTTP `/health`는 기본 공개이며
  `publicHealth: false`로 인증 대상에 포함할 수 있다.
- transport capability는 로컬 코드가 발급하는 표식이다. 자체적으로 peer를 인증하지 않으므로
  호스트 adapter가 인증된 연결의 workspace/client identity와 결합해야 한다.
- packet channel은 주입된 sender와 메모리 큐를 제공한다. 큐 포화·deadline 경과·프로세스 종료 시
  패킷이 유실될 수 있으며 heartbeat 수신 감시와 재접속은 구현하지 않는다. epoch과 CRDT watermark도
  새 인스턴스나 재시작 이후에 자동 유지되지 않는다.
- tombstone retention과 원격 age window, 전달 순서, 재동기화 정책을 호스트가 함께 관리해야 한다.
  인메모리 파일 lattice의 결정적 병합은 모든 경쟁 편집을 보존하는 텍스트 병합 보증이 아니다.
- peer store의 mutation queue는 같은 프로세스에만 적용된다. 다중 프로세스 writer 조정은 별도 책임이다.
- 네이티브 WebRTC 연결, 파일 watcher·디스크 쓰기, OAuth/OIDC 서비스와 분산 rate limit은 위 패키지의 구현 범위에
  포함되지 않는다. WebSocket signaling은 `peer-server`의 relay와 아래 `webmcp-peer`의 relay가 구현한다.

## webmcp-peer relay

`@oa-sdk/webmcp-peer`의 relay(`WebMcpPeerServer`), 브라우저 provider(`WebMcpPeerClient`), agent client(`PeerMcpSession`)의 경계다.
규칙의 정본은 [WebMCP relay protocol](../internal/webmcp-relay-protocol.md)이고, 아래는 보안에 관한 요건을 요약해 그 ID를 적는다.
테스트는 모두 `packages/webmcp-peer/test/` 아래다.

| 영역 | 확인된 위험 | 구현된 조치 | 회귀 테스트 |
| --- | --- | --- | --- |
| room 생성 | 누구나 room을 만들어 relay 메모리를 채움, rotate를 되풀이해 room 상한을 채움, publish key 추측 | publish key는 `Authorization: Bearer`(Bearer 자격이 없을 때만 `X-Publish-Key`)를 SHA-256 hex로 상수 시간 비교(R-ROOM-009). publish key와 무관하게 요청 주소당 기본 60초에 30회(R-ROOM-010), room을 하나 더하는 rotate도 같은 할당량에서 단위 하나를 씀(R-ROOM-073, O-61), 실패한 시도는 주소마다 한 bucket, relay가 가진 room은 보존 중인 것을 포함해 `maxRooms`(10000)까지(R-LIM-047) | [rate limit](../../packages/webmcp-peer/test/server-publish-rate-limit.test.ts), [HTTP security](../../packages/webmcp-peer/test/server-http-security.test.ts) |
| 자격 | 비밀 token의 유출·추측, 자격 오류로 room 존재 노출 | providerToken·inviteToken·reconnectToken·clientToken은 `randomBytes(24)`(R-ROOM-001). WebSocket은 subprotocol `webmcp-peer.v1`과 `ticket.<token>`으로만 자격을 받고 101이 그것을 되돌리지 않음(R-WS-005, R-WS-010). relay는 clientToken의 SHA-256만 보관하고, providerToken·lease·publish key를 상수 시간으로 비교(R-HTTP-018). invite는 1회용(R-ROOM-005, R-ROOM-020). 없는 자격과 틀린 자격을 `_REQUIRED`·`_INVALID`로 나누고 401에 `WWW-Authenticate`(R-HTTP-019). relay의 자격은 relay가 발급한 bearer token뿐이라 challenge에 `resource_metadata`가 없고 OAuth·OpenID discovery metadata를 제공하지 않으므로(well-known 경로는 404), agent가 401을 보고 다른 곳의 authorization server로 token을 보내게 유도되지 않음(R-HTTP-019, R-PEER-053) | [error model](../../packages/webmcp-peer/test/server-error-model.test.ts), [room lifecycle](../../packages/webmcp-peer/test/server-room-lifecycle.test.ts), [upgrade](../../packages/webmcp-peer/test/server-upgrade.test.ts) |
| 승인 gate | 승인 전 agent의 tool 실행, 다른 session의 요청 실행 | 승인되지 않은 ticket은 공개 discovery(`initialize`, `tools/list`, `server/discover`, `ping`)만 받고 그 밖의 요청은 provider에 가지 않은 채 ticket status의 오류(승인 대기는 −32053 `CLIENT_APPROVAL_REQUIRED`)를 받음(R-MCP-014, R-MCP-029, R-MCP-036). provider도 relay가 찍은 `sessionId`가 자기가 승인한 session일 때만 실행(R-PEER-012). 승인 요청은 `approvalTimeoutMs`(기본 5분) 뒤 만료(R-ROOM-026). revoke·거절·rotate·만료는 진행 중인 HTTP·WebSocket 요청까지 끝냄(R-ROOM-047) | [approval and lease](../../packages/webmcp-peer/test/server-approval-lease.test.ts), [provider approval](../../packages/webmcp-peer/test/provider-approval-state.test.ts), [pending settlement](../../packages/webmcp-peer/test/server-pending-settlement.test.ts) |
| frame 경계 | agent나 provider가 relay control frame을 위조해 상대를 속임 | agent socket에서는 `mcp`, `ping`, 승인된 ticket의 `offer`만 다루고(R-SIG-003), provider에서는 JSON-RPC notification·요청과 자기 offer의 `answer`·`release`만 상대에게 보내며 나머지는 버림(R-SIG-004). provider가 보낸 `notifications/tools/list_changed`도 버려, agent가 받는 catalog stamp는 언제나 relay가 `tools/call`을 검사하는 값임(R-MCP-041). relay는 id 없는 `tools/call`도 두 transport에서 같은 catalog 검사로 거름(R-MCP-020) relay는 전달하는 frame에 `from`과 ticket의 `sessionId`를 덮어씀(R-SIG-005) | [signaling frames](../../packages/webmcp-peer/test/server-signaling-frames.test.ts) |
| Host·Origin·proxy | DNS rebinding으로 local relay에 닿는 page(local tunnel 뒤에서 `X-Forwarded-Host`를 쓰는 page 포함), 허용되지 않은 browser origin, 위조한 `X-Forwarded-*` | loopback에 bind하거나 `allowedHosts`를 정한 relay는 목록 밖 host를 다른 무엇보다 먼저 403 `HOST_NOT_ALLOWED`. 신뢰한 proxy가 알린 host와 요청의 `Host`를 모두 봄(R-HTTP-020). 허용되지 않은 Origin은 preflight·요청·upgrade 모두 403 `ORIGIN_NOT_ALLOWED`, 정한 목록이 기본 목록을 대신함(R-HTTP-011, R-HTTP-012). `X-Forwarded-*`는 `trustProxy`가 신뢰하는 peer에게서만 읽음(R-HTTP-021) | [HTTP security](../../packages/webmcp-peer/test/server-http-security.test.ts), [upgrade](../../packages/webmcp-peer/test/server-upgrade.test.ts) |
| 상한·자원 | 큰 frame·body, 쌓이는 요청과 socket, 읽지 않는 agent에게 쌓이는 답(승인 전의 catalog listing 포함), 계산 비용이 큰 catalog 반복, 사라진 peer | message 256 KiB(1009), agent 요청 255 KiB, JSON body 64 KiB, socket당 provider를 기다리는 요청 64개와 offer 1개, ticket당 socket 4개, request id 1 KiB(3장 상한 표). agent에게 답이 기다리기 시작하면 relay는 그 socket을 멈추고 이미 읽은 read의 frame도 처리하지 않으므로, 읽지 않는 agent를 위해 쥐는 frame은 진행 중인 요청의 답, 처리하던 frame 하나의 답, 승인·offer·종료 frame 몇 개로 묶이고, listing은 relay가 얼린 catalog 하나를 함께 씀(R-WS-040, R-MCP-042). register 평가는 room마다 8개 뒤 초당 1개(R-CAT-012). 송신 queue가 차도 닫지 않고 30초 정체만 1013(R-WS-026). 30초 ping과 75초 idle timeout(R-WS-039) | [message limits](../../packages/webmcp-peer/test/relay-message-limit.test.ts), [backpressure](../../packages/webmcp-peer/test/relay-backpressure.test.ts), [WebSocket codec](../../packages/webmcp-peer/test/server-ws-frames.test.ts), [register evaluation](../../packages/webmcp-peer/test/server-register-evaluation.test.ts) |
| 문서와 코드의 일치 | 보안 규칙을 적은 문서가 코드와 어긋남 | spec의 요건 ID, 근거 줄, 테스트 제목, 상한·close code·오류 class 표를 코드와 테스트에 맞춰 검사 | [protocol spec](../../packages/webmcp-peer/test/protocol-spec.test.ts) |

webmcp-peer 배포에 남는 책임:

- 인터넷에 노출하는 relay에는 publish key를 정하고, proxy 뒤에 두면 그 proxy를 `trustProxy`로 지정한다. 지정하지 않으면 모든
  caller가 proxy 주소의 rate-limit bucket을 함께 쓰고 descriptor URL은 relay가 받은 Host를 쓴다(R-HTTP-021). Host 검사를 켠 relay 앞의
  proxy가 upstream `Host`를 loopback도 공개 host도 아닌 다른 이름으로 바꾸면 그 이름을 `allowedHosts`에 넣는다(R-HTTP-020).
- `0.0.0.0` 등 loopback이 아닌 주소에 bind하고 `allowedHosts`를 정하지 않은 relay는 host로 거절하지 않는다(R-HTTP-020).
  relay의 `host`에 IPv6 literal을 쓰면 모든 요청이 실패한다(R-HTTP-016).
- `formatHttpError` hook이 던지면 relay process가 끝나므로 hook은 던지지 않아야 한다(R-HTTP-017).
- provider의 승인 UI는 host 책임이다. provider SDK는 write 동의 때문에 tool 호출을 거절하지 않는다(R-PEER-028).
- AI run ledger는 host가 `setAiRunLedger`로 줄 때만 있으며, durable 요청의 재실행 방지는 ledger가 있을 때만 동작한다(R-PEER-016).

관련 회귀 명령은 `pnpm test:downstream`, `pnpm --filter @oa-sdk/tools test`,
`pnpm typecheck:downstream`, `pnpm check:docs`, `pnpm check:feature-tests`,
`pnpm check:release-policy`, `pnpm --filter @oa-sdk/webmcp-peer test:ci`다.
