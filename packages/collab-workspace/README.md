# @oa-sdk/collab-workspace

파일·라인 단위 상태, AI 편집 액터, IntentLock과 presence 이벤트를 제공하는 인메모리 협업 엔진입니다.
전체 구성은 [WebMCP 피어링·전송·협업·메시 아키텍처](../../docs/concepts/webmcp-peering-mesh-and-collab.md)를 참조하십시오.

## 기능과 범위

- `WorkspaceTreeLattice`는 파일 경로와 라인 index별 chunk를 보관하고 CRDT metadata 및 content
  tie-breaker로 경쟁 변경을 결정합니다. 같은 chunk 집합을 결정적으로 병합하지만 모든 경쟁 텍스트의 보존을 보장하지 않습니다.
- `WorkspaceSyncer`는 인간 편집과 원격 chunk를 적용하고 delta/presence 구독을 제공합니다.
  `rootPath`는 workspace 설정이며 파일 읽기·쓰기, watcher, 네트워크 전송은 호스트가 연결해야 합니다.
- `AiEditorActor`는 독립적인 client ID로 라인 또는 블록을 수정합니다. 수정 범위를 포함하는
  활성 IntentLock을 소유해야 하며 잠금 TTL은 최대 5분입니다. `renewIntent()`로 갱신할 수 있습니다.
- 파일·chunk·content·lock·presence 상한, sparse render 상한, 만료된 presence 정리와
  `compactTombstones()`를 제공합니다. 디스크 persistence나 peer 간 compaction 합의는 포함하지 않습니다.

IntentLock은 AI 편집 API에 적용됩니다. 인간·원격 변경을 모두 차단하는 전역 잠금이나 에디터의
가상 커서 UI를 제공하지는 않으며, 호스트 UI가 presence와 lock 정보를 표시할 수 있습니다.

## 사용

```typescript
import { WorkspaceSyncer } from '@oa-sdk/collab-workspace'

const syncer = new WorkspaceSyncer({
  rootPath: '/workspace/project',
  workspaceId: 'project-1',
  clientId: 'client:human:dev1',
  role: 'human',
  allowedExtensions: ['.ts', '.tsx'],
})

// 호스트가 읽은 파일 내용을 적용합니다.
syncer.applyHumanEdit('src/Button.tsx', 'export const Button = () => null')
const ai = syncer.createAiEditor('assistant', 'AI Assistant')

// 라인 index는 0부터 시작합니다.
const lock = ai.acquireIntent('src/Button.tsx', { startLine: 0, endLine: 0 }, '버튼 내용 수정')
if (lock) {
  ai.streamBlockEdit('src/Button.tsx', 0, ['export const Button = () => <button />'])
  ai.completeIntent(lock.id)
}

const content = syncer.getFileContent('src/Button.tsx')
// 호스트가 content를 디스크/에디터에 반영하고 onDelta()를 transport에 연결합니다.
```

client ID에는 영문자, 숫자, `:`, `_`, `-`만 사용할 수 있습니다. 파일 경로는
workspace-relative여야 하며 `..`, 절대 경로, NUL 문자를 거부합니다.

원격 `ingestRemoteChunk()`는 opaque capability가 포함된 source를 요구합니다.
`createRemoteTransportCapability()`는 네트워크 인증 함수가 아니라 로컬 adapter용 표식 생성 함수입니다.
호스트가 peer 인증을 끝내고 workspace/client identity를 연결한 뒤 capability를 발급해야 하며,
원격 payload로 capability를 받거나 직렬화해서 보내면 안 됩니다. 필요하면
`authenticateRemoteSource`와 `allowedRemoteClientIds`로 추가 정책을 적용하십시오.

원격 watermark는 메모리에만 유지됩니다. 호스트는 재시작 후 재동기화와 전달 순서,
허용하는 원격 age window 및 tombstone retention을 함께 정해야 합니다.
