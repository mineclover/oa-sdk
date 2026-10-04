# WebMCP 통신·인증·데이터 처리 보안 감사

2026-09-22 기준으로 `peer-server`, `peer-transport`, `collab-workspace`, `mcp-mesh`,
`tools`의 구현된 경계와 운영 가정을 기록한다. 아래 검증은 저장소의 회귀 테스트를 가리키며,
실제 WebRTC 연결이나 다중 프로세스 환경의 인증·전달 보증을 뜻하지 않는다.

| 영역 | 확인된 위험 | 구현된 조치 | 회귀 테스트 |
| --- | --- | --- | --- |
| peer-server 인증·입력 | endpoint의 원격 무인증 노출, 큰 본문, pending RPC 누적 | loopback 외 listener의 `publishKey` 강제, Bearer/X-Peer-Publish-Key 비교, origin 정책, 기본 1MiB/최대 16MiB 본문, pending call 상한·timeout | [HTTP 경계](../../packages/peer-server/test/peer-server.test.ts), [room/store](../../packages/peer-server/test/room-store.test.ts) |
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
- 네이티브 WebRTC 연결, WebSocket signaling, 파일 watcher·디스크 쓰기, OAuth/OIDC 서비스와
  분산 rate limit은 현재 패키지의 구현 범위에 포함되지 않는다.

관련 회귀 명령은 `pnpm test:downstream`, `pnpm --filter @oa-sdk/tools test`,
`pnpm typecheck:downstream`, `pnpm check:docs`, `pnpm check:feature-tests`,
`pnpm check:release-policy`다.
