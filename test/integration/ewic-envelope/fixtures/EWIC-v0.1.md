# Entity/Workflow Interchange Convention (EWIC) v0.1

## 목적
AI, Google Drive, Colab, 저장소 코드, 그래프·검색·임베딩 소비자가 동일한 구조로 엔티티를 작성·검증·참조한다.

## 정본과 파생물
- 정본은 `entity-source/v1`이다. `identity`, `provenance`, `content`, `refs`를 포함한다.
- 파생물은 `entity-derived/v1`이다. 검색 텍스트, 그래프, 임베딩 descriptor, 시각화 layout을 포함한다.
- 정본에는 vector payload, inferred edge, layout 좌표를 넣지 않는다.
- 파생물은 `sourceRevision + sourceContentHash + pipelineVersion + config/model hash`로 키를 만든다.

## 엔티티 종류
`spec`, `framework`, `resource`, `workflow`, `execution`, `evidence`

## 식별자·버전
- ID는 `ent_<UUIDv7>` 불변 값이다. slug는 별칭이지 identity가 아니다.
- namespace는 소문자 점 표기(`project.scope`)로 분리한다.
- revision은 양의 정수이며 semantic 변경은 새 revision으로 기록한다.
- URI는 `entity://<namespace>/<kind>/<entityId>@<revision>` 형식이다.
- published 참조는 revision과 resolvedContentHash를 고정한다. `latestPublished`는 draft에서만 허용한다.
- semantic hash는 RFC 8785 방식 canonical JSON의 schema·identity 안정 필드·content·refs로 계산하며, provenance 시간/경로·파생 metadata는 제외한다.

## 참조·격리
- 관계는 `contains`, `implements`, `depends_on`, `invokes`, `reads`, `writes`, `produces`, `references`, `supersedes` 등 typed relation으로만 기록한다.
- workflow는 namespace/import/allowedNamespaces를 선언한다.
- cross-workflow·cross-namespace 참조는 명시적 import와 input/output contract가 필요하다.
- similarity·co-occurrence는 자동으로 참조 관계가 되지 않고 `candidate`로 남긴다.

## Workflow
- XState v5 호환 subset을 사용한다. initial, states, events, targets, guards, actions, invoke, final/parallel/history를 보존한다.
- guard/action/service는 실행 코드가 아니라 이름·params·source hash descriptor로 저장한다.
- 원본 XState config와 normalized FSM을 함께 보존한다.
- deterministic target resolution, reachability, guard/action validity를 publish 전에 검증한다.

## Colab 파이프라인
`ingest → canonicalize → schema/identity/hash validate → refs/ACL resolve → FSM compile → graph consistency → reconcile proposals → embed/graph/viz → publish report`

Colab은 원본을 자동 덮어쓰지 않는다. AI/LLM 보강은 base revision/hash, JSON patch, evidence, confidence가 있는 proposal로 저장한다. 승인된 변경만 새 revision을 만든다. 각 run은 snapshot hash, code/notebook/dependency/config/model hash, stage checkpoints, warnings/errors, output hashes를 남긴다.

## 검색·그래프·임베딩
- graph edge는 source/target revision, relation, status(`asserted|candidate|rejected|superseded`), provenance, confidence를 가진다.
- 임베딩 descriptor는 purpose, provider/name/version, dimensions, dtype, metric, encoding, vectorRef, sourceFields, sourceRevision, contentHash를 가진다.
- vector는 외부 sidecar에 저장하고 source hash/model/dimension이 달라지면 stale 처리한다.
- 시각화 layout은 graph snapshot hash와 layout engine/version에 귀속된 파생물이다.

## Google Drive 저장 규칙
- `entities/<namespace>/<kind>/<entityId>/source/r<revision>.json`
- `entities/<namespace>/<kind>/<entityId>/derived/r<revision>/<runId>/<pass>.json`
- `runs/<runId>/`에 snapshot, checkpoint, proposal, conflict, evidence를 둔다.
- `published/current.json` 또는 index bundle pointer는 모든 검증이 끝난 뒤 마지막에 교체한다.
- Drive file ID와 content hash가 정본 식별자이며 이름·경로만으로 identity를 판단하지 않는다.

## 검증·게시 게이트
문법 → 구조 → identity/revision/hash → reference/namespace/ACL → FSM 의미 → provenance → graph/index/vector/layout 정합성 순으로 검사한다. hard error는 quarantine하고 게시하지 않는다. 이전 pointer는 유지하며 rollback은 pointer 재지정으로 한다.

## 인터페이스 의무
- AI: envelope를 보존하고 entity URI/hash를 인용하며 proposal만 생성한다.
- Colab: idempotent stage, immutable snapshot, durable receipt, stale-base rejection, atomic bundle publish를 제공한다.
- Google Drive: source/evidence/revision history와 manifest를 보존한다.
- 각 저장소: schema, fixture, validator, CI, commit/notebook provenance를 제공한다.
