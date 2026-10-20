# @oa-sdk/mcp-mesh

도메인별 tool catalog와 여러 runtime session을 등록하고 호출을 라우팅하는 라이브러리와 CLI입니다.
전체 구성은 [WebMCP 피어링·전송·협업·메시 아키텍처](../../docs/concepts/webmcp-peering-mesh-and-collab.md)를 참조하십시오.

## 기능

- `SkillRegistry`는 하나의 canonical domain skill에 여러 `McpSessionInstance`를 연결합니다.
  활성 session을 선택하고 사용할 수 없으면 같은 domain의 사용 가능한 session으로 fallback합니다.
  라운드로빈 부하 분산은 제공하지 않습니다.
- `SkillRegistry#hydratePeerSession(peer, bridgeClient)`(동기 메서드)는 peer alias에서 domain을 추출하고 catalog와 session을 등록합니다.
  생성된 session의 호출에는 HTTP bridge client가 필요하며, 네이티브 WebRTC 연결을 생성하지 않습니다.
- `MeshRouter`는 `{domain}__{tool}`을 라우팅하고 모호한 bare 호출을 거부합니다.
  `getAggregatedTools()`는 여러 domain에 중복된 이름의 bare alias를 방출하지 않습니다.
- 메타 스킬은 필요한 domain을 선언하며 `checkMetaSkillReadiness()`로 활성 session의 존재를 검사합니다.
  이 검사가 여러 도구의 워크플로 실행까지 수행하지는 않습니다.

## CLI

`oa-mesh`와 `oa-tools`는 같은 CLI의 별칭입니다.

```bash
# peer 목록과 bridge 상태 조회
oa-mesh peer list
oa-mesh --bridge http://127.0.0.1:8787 --auth-token "$WEBMCP_PUBLISH_KEY" peer status

# 현재 CLI 프로세스의 registry에 peer catalog를 등록하고 결과 출력
oa-mesh skill pull wireframe-local

# 절대 경로의 파일을 처음 한 번 읽어 인메모리 lattice에 적재
oa-mesh collab start /workspace/project/src --ai assistant
```

`--auth-token`을 생략하면 `WEBMCP_AUTH_TOKEN`을 사용합니다. registry는 기본적으로 메모리에만
있으므로 별도의 `skill pull` 프로세스가 다음 `skill list`나 `call`에 상태를 전달하지 않습니다.
지속적인 registry가 필요한 호스트는 `createMeshCli({ registry })`에 준비한 registry를 주입해야 합니다.

등록된 session이 있는 CLI에서 `call` 인자는 JSON 또는 `key=value` 형식입니다. 예를 들어
`call wireframe__storyboard_page_create 'title=Main Dashboard'`를 사용할 수 있습니다.
`--title` 같은 도구별 옵션은 자동 생성하지 않습니다. namespaced tool도 catalog에 등록돼 있어야 합니다.

`collab start`는 초기 파일 스캔과 선택적인 AI 액터 생성까지 구현되어 있습니다. 파일 watcher,
디스크 쓰기, peer delta 연결은 제공하지 않으며 `collab status`는 실행 중인 공유 세션을 조회하지 않습니다.
`peer`, `skill`, `mesh` 명령은 각각 peer 관리, catalog/registry 조회, 메타 스킬 준비성 진단을 제공합니다.
