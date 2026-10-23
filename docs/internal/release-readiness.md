# Release Readiness

Status: active
Last reviewed: 2026-10-23
Policy authority: [`release-policy.json`](./release-policy.json)

이 문서는 oa-sdk source repository에서 **검토 가능한 public artifact를 만들 준비가 되었는지**
판단하는 SSOT다. 구현 상태는 [`spec.md`](./spec.md), package version 정책은
[`release-management.md`](./release-management.md), package별 version intent는
[`.changeset/`](../../.changeset/)이 소유한다.

여기서 `ready`는 npm에 이미 배포되었거나 배포가 승인되었다는 뜻이 아니다. 이 저장소는
`artifact-only` 모드이며, 실제 npm promotion은 별도
[`mineclover/oa-sdk-releases`](https://github.com/mineclover/oa-sdk-releases) repository의
승인된 workflow가 소유한다.

## Release boundary

| 구분 | 이 저장소의 책임 | 완료를 증명하는 곳 |
| --- | --- | --- |
| Source readiness | 계약·코드·문서·package boundary를 검증하고 sanitized tarball을 만든다 | 이 저장소의 CI, `release:preflight`, exporter output |
| Artifact review | release ID, source revision, tarball, SHA-512 manifest를 검토한다 | `oa-sdk-releases`의 `releases/<release-id>/` |
| npm promotion | npm provenance와 registry publish를 승인·실행한다 | `oa-sdk-releases`의 보호된 Publish workflow |
| API runtime launch | 실제 base URL, token issuer, scope/권한, 운영 runtime을 확정한다 | runtime 소유 시스템의 운영 문서와 deployment evidence |

`@oa-sdk/schemas`의 OpenAPI contract와 npm package distribution은 별도 lifecycle이다. TypeSpec
`ContractVersion`은 API semantic version이고, workspace package version/Changeset과 동일한
채널이 아니다.

## 현재 판단 입력

| 항목 | 2026-10-22 기준 | 다음 판단 |
| --- | --- | --- |
| Public artifact candidates | release policy의 `distributionCandidates` 20개 (`core`, `openapi-projection-contract`, `typespec-decorators`, `parser`, `codegen`, `ast-sync`, `tools`, `surface-ir`, `chunk-stream*`, `peer-transport`, `peer-server`, `collab-workspace`, `mcp-mesh`, `router`, `client`, `mock-server`) | 선택한 package와 target version을 release record에 고정 |
| Release-tracked, non-candidate packages | `schemas`, `spec-lens-contract`, `spec-lens` 3개 | package lifecycle이 곧 public npm 배포 승인은 아님 |
| Version intent | **Published 2026-10-22:** `2026-10-22-core-v0.10.0` (source `bc7c6f8d`, 21 packages; [release](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-22-core-v0.10.0), [publish run](https://github.com/mineclover/oa-sdk-releases/actions/runs/39708720909)), patch `@oa-sdk/webmcp-peer` `0.2.1` ([release](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-22-webmcp-peer-v0.2.1)), and patches `@oa-sdk/router` `0.2.4` and `0.2.5` ([0.2.5 release](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-22-router-v0.2.5), [publish run](https://github.com/mineclover/oa-sdk-releases/actions/runs/39769873333)). `@oa-sdk/openapi-projection-contract@0.2.0` was already published and was not re-exported. | 다음 release는 새 changeset에서 version intent를 다시 고정한다. |
| Published 2026-10-23 | `@oa-sdk/tools` `0.2.2` and its dependent `@oa-sdk/mcp-mesh` `0.1.3` were exported as `2026-10-23-tools-v0.2.2` from source `d9bdb374` ([release](https://github.com/mineclover/oa-sdk-releases/releases/tag/2026-10-23-tools-v0.2.2), [publish run](https://github.com/mineclover/oa-sdk-releases/actions/runs/39892391866)). This was the first publish through GitHub OIDC trusted publishing. | Registry `latest` confirms both versions. No changesets remain. The workflow is OIDC-only; the unused `NPM_TOKEN` is left to expire, so no workflow change is needed when it does. |
| TypeSpec baseline | approved snapshot과 restored contract drift가 검증 대상 | contract를 변경했다면 snapshot diff와 downstream gate를 다시 실행 |
| Runtime API launch | production server/auth metadata는 이 source repository에서 확정하지 않음 | 실제 API 공개는 runtime owner의 base URL·issuer·scope 결정 전까지 보류 |
| npm promotion | external artifact repository가 소유 | 그 repository의 approval, manifest, provenance/OIDC 정책을 확인한 뒤에만 승인 |

## Required source evidence

### Draft verification

문서나 release script를 준비 중일 때에는 dirty worktree도 허용하는 초안 검증을 실행할 수 있다.
이 결과는 official export 근거가 아니다.

```bash
pnpm release:preflight -- --allow-dirty
```

### Official export preflight

version intent와 release ID를 결정한 뒤, clean committed worktree에서 실행한다.

```bash
pnpm release:preflight
```

이 명령은 local artifact-release gate set으로서 source-worktree clean 상태를 확인하고, 문서·거버넌스·release policy·TypeSpec
validation/downstream contract·Core build/typecheck/test·codegen package pack smoke를 순서대로
실행한다. non-dry-run `release:export`도 이 preflight를 다시 강제한다. registry publish는
실행하지 않는다. official export의 `--version`은 Changesets flow로 갱신·commit한 source package
version과 같아야 한다.

이 preflight는 전체 CI를 대체하지 않는다. official promotion 전에 release candidate commit의
`pnpm ci:local`(API index, CLI spec, codegen boundary, type registry, feature-test matrix, schema
freshness/rollback, Node 22/24/26 public consumer runtime, TS7, governance)이 통과했는지 확인한다.
GitHub CI는 필수 lane만 실행하므로 그 결과만으로 public runtime/TS7/governance를 대체하지 않는다.

계약을 바꾸는 release는 아래 추가 evidence가 필요하다.

```bash
pnpm schema:approve-typespec-reference
# normalized diff review
pnpm schema:approve-typespec-reference -- --write
pnpm schema:typespec-provenance-check
pnpm schema:check-contract-version -- --base-ref origin/main
```

`approved.openapi.yaml`과 `.merged*` artifact는 직접 수정하지 않는다. TypeSpec source와
승인 명령의 역할은 [TypeSpec Authoring Conventions](../guides/typespec-authoring-conventions.md)에
따른다.

## Release decision record

공식 artifact export 전 PR 또는 release issue에 아래 사실을 한 번에 기록한다.

- Source commit SHA와 clean-worktree preflight 결과
- 같은 commit의 `pnpm ci:local` 결과(필수 GitHub CI가 실행됐다면 그 run/result도)
- 선택한 public package와 `package=version` 목록
- 대응 Changeset, user-facing release note, breaking-change 여부
- API contract version 및 approved snapshot diff 여부
- `release-id`와 external artifact repository review location
- external repository의 manifest SHA-512, protected approval, npm provenance/OIDC 확인 결과

하나라도 없으면 source repository에서 artifact를 준비할 수는 있어도 official promotion을
승인하지 않는다.

## Not release blockers for package artifacts

아래는 제품 경계상 중요한 정보지만 source package artifact release와 같은 결정을 하지 않는다.

- private/downstream/maintenance workspace의 신규 feature를 public candidate로 승격하는 결정
- 실제 API runtime의 production URL, OAuth issuer, scope와 authorization policy
- external `oa-sdk-releases` repository의 publish 권한 또는 npm credential 관리

각 항목은 해당 소유자의 승인과 별도 release record를 요구한다.

## Runtime launch decisions kept outside this repository

아래는 package artifact의 source readiness를 막지는 않지만, 이 OpenAPI contract를 실제
runtime에 공개하기 전에 runtime owner가 확정해야 하는 결정이다. 이 목록은 placeholder를
contract 사실로 오해하거나 mock의 credential-presence 검증을 실제 authorization으로 오해하지
않기 위한 launch checklist다.

| 결정 | 현재 contract가 보장하는 범위 | runtime owner가 확정할 내용 |
| --- | --- | --- |
| OAuth와 역할 권한 | production operation은 bearer credential의 존재만 표현한다 | issuer/audience, claim 검증, scope와 role의 매핑, admin-only operation의 403 기준 |
| Export job lifecycle | export POST는 queued receipt만 정의한다 | `Idempotency-Key` scope와 replay 규칙, 완료/실패 조회 또는 download delivery, 동시 job 제한의 응답, raw export 허용 여부와 pseudonymization 정책 |
| World stimulus lifecycle | `StimulusAccepted`는 ingress receipt이며 commit 완료가 아니다 | completion/failure 관찰 경로, `stimulusId` duplicate 동등성·보존 기간, revision 생략 시 조회 기준 |
| Projection bundle status | bundle item은 outer World/model/revision context를 상속한다 | `complete`·`incomplete`·`stale`의 판정 조건과 state transition |

각 결정을 확정할 때에는 runtime deployment evidence와 함께 TypeSpec contract, persona, user
guide를 같은 변경에서 정렬한다. 승인 전에는 위 영역을 새 scope/role/retry/terminal event로
임의 확장하지 않는다.
