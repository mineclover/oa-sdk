# Artifact Release Preparation

Status: active operating guide. Last reviewed 2026-08-30.

이 가이드는 oa-sdk의 **public package artifact**를 준비하는 maintainer를 위한 것이다.
이 source repository에서 npm publish를 실행하지 않는다. 실제 registry promotion은
별도 `oa-sdk-releases` repository의 승인된 workflow가 담당한다.

## 시작 전 확인

먼저 release의 종류를 구분한다.

| 변경 | 결정할 version channel | 기본 evidence |
| --- | --- | --- |
| public npm package surface | workspace package version + Changeset | package test, pack smoke, public consumer check |
| TypeSpec/OpenAPI contract | `packages/schemas/typespec/version.tsp`의 `ContractVersion` | approved snapshot diff, `schema:validate`, downstream check |
| private/downstream/maintenance workspace | release policy가 허용하는 lifecycle | scope policy와 해당 track 검증 |

API contract version을 올렸다고 npm package를 자동으로 올리거나, 반대로 package patch를 API
contract change로 해석하지 않는다. 공개 배포 후보는 release policy에 있는 다섯 package뿐이다.

## 1. Release intent를 고정한다

1. 어떤 public candidate를 내보낼지 정한다.
2. 각 package의 next version과 user-facing release note를 Changeset으로 기록한다.
3. 변경이 TypeSpec/OpenAPI contract에 닿는다면 approved snapshot diff와 contract semver를 함께
   검토한다.
4. private package의 Changeset만 있는 상태에서는 public package export가 생기지 않는다는 점을
   확인한다.

```bash
pnpm changeset status --verbose
```

Changeset의 대상과 public candidate 목록이 다르면 export 전에 그 차이를 release issue에
명시한다. package가 public candidate에 없으면 이 가이드의 export 대상으로 추가하지 않는다.

## 2. Source repository를 검증한다

작업 중인 초안에서는 다음 명령으로 **read-only 문서·정책 gate만** 점검한다. dirty mode는
build, schema materialization, bundle, test를 실행하지 않으며, 실행 전후 worktree 상태가 달라지면
실패한다. 따라서 생성 artifact를 덮어쓰지 않는 draft sanity check일 뿐 release candidate 검증은 아니다.

```bash
pnpm release:preflight -- --allow-dirty
```

official artifact는 clean, committed worktree에서만 만들 수 있다. 아래 full preflight는 build와
schema validation을 포함하므로 release candidate commit을 확정한 다음 dirty override 없이 실행한다.

```bash
pnpm release:preflight
```

이 검증은 publish를 하지 않는다. 실패한 gate를 우회하기 위해 generated OpenAPI artifact나
approved snapshot을 직접 고치지 않는다. non-dry-run `release:export`도 같은 preflight를 강제하므로,
이 단계를 건너뛰어 official artifact를 만들 수 없다.

이 명령은 전체 CI를 대체하지 않는다. official promotion 전에는 release candidate commit의 CI가
API index, CLI spec, codegen boundary, type registry, feature-test matrix, schema freshness/rollback,
Node 22/24/26 public consumer runtime lane까지 통과했는지 확인한다.

## 3. Artifact export를 만든다

external release repository가 준비되어 있고 immutable release ID가 정해졌을 때만 export를
실행한다. 아래 version 값은 예시이므로 release record의 확정값으로 바꾼다.

```bash
pnpm release:export -- \
  --output ../oa-sdk-releases \
  --release-id 2026-08-30-core-example \
  --version @oa-sdk/core=0.2.0 \
  --version @oa-sdk/openapi-projection-contract=0.1.2 \
  --version @oa-sdk/typespec-decorators=0.1.2 \
  --version @oa-sdk/parser=0.2.0 \
  --version @oa-sdk/codegen=0.6.0
```

exporter는 선택한 package를 clean build하고 source map/test file을 제거한 tarball을 만든다.
official export의 `--version`은 committed workspace package version과 같아야 하므로, 위 예시는
먼저 `pnpm version-packages` 결과를 review·commit한 release candidate에서만 사용한다.
또한 workspace dependency가 public version으로 해소되는지, 모든 public import와 `oa-gen`
consumer smoke가 동작하는지 확인하고 SHA-512 manifest를 기록한다. 이 단계도 npm publish는
하지 않는다.

### Draft export inspection

prospective version이나 tarball 내용을 살펴볼 때는 `--dry-run`을 사용할 수 있다. dry run은
호출한 checkout을 clean/build하지 않고 git-visible source snapshot의 격리된 임시 복사본에서
실행된다.

```bash
pnpm release:export -- --dry-run --skip-registry-preflight \
  --release-id local-draft \
  --version @oa-sdk/core=0.2.0
```

그 결과 manifest에는 `draft.nonPromotable: true`와 source worktree 상태가 기록되고, 출력에도
**DRAFT ONLY — NON-PROMOTABLE**로 표시된다. 이 artifact는 external release repository에 옮기거나
promotion 입력으로 사용하지 않는다. official export는 반드시 clean, committed candidate에서
`--dry-run` 없이 다시 수행한다.

## 4. External promotion을 승인한다

`oa-sdk-releases` repository에서 다음을 확인한 뒤에만 그 repository의 publish workflow를
승인한다.

- release ID, source commit, package/version, tarball SHA-512가 review record와 일치한다.
- package tarball에는 source, test, source map, private repository metadata가 포함되지 않는다.
- required review/branch protection이 충족됐다.
- npm provenance/OIDC 및 registry 권한이 외부 workflow에만 부여돼 있다.

source repository의 `pnpm release` 또는 `pnpm release:export`는 이 최종 promotion을 대신하지
않는다.

## 완료 기준

- [ ] 선택한 package와 version intent가 Changeset/release note에 기록됐다.
- [ ] clean-worktree `pnpm release:preflight`가 통과했다.
- [ ] 같은 release candidate commit의 required CI가 통과했다.
- [ ] contract change라면 TypeSpec snapshot 및 semver evidence를 검토했다.
- [ ] external artifact repository의 manifest와 SHA-512를 검토했다.
- [ ] 실제 npm promotion은 authorized external workflow에서만 실행했다.

정책의 전체 근거와 현재 판단 입력은 [Release Readiness](../internal/release-readiness.md),
package/versioning 규칙은 [Release Management](../internal/release-management.md)를 참조한다.
PR 또는 release issue에 남길 값은 [Release Decision Record Template](../internal/release-decision-record-template.md)를
복사해 사용한다.
