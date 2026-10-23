# Artifact Release Preparation

Status: active operating guide. Last reviewed 2026-10-23.

이 가이드는 oa-sdk의 **public package artifact**를 준비하는 maintainer를 위한 것이다.
이 source repository에서 npm publish를 실행하지 않는다. 실제 registry promotion은
별도 `oa-sdk-releases` repository의 승인된 workflow가 담당한다.

## 실행 위치

| 단계 | 디렉토리 | 명령 |
| --- | --- | --- |
| version 확정, CI, preflight, export | `oa-sdk` source checkout | `pnpm changeset`, `pnpm version-packages`, `pnpm ci:local`, `pnpm release:preflight`, `pnpm release:export` |
| release artifact commit/PR | `oa-sdk-releases` checkout | `git checkout -b`, `git add`, `git commit`, `git push`, `gh pr create` |
| npm promotion | GitHub Actions | `Publish npm release` workflow 또는 `gh workflow run ... --repo mineclover/oa-sdk-releases` |
| registry 확인 | 어디서나 | `npm view ... --prefer-online` |

`npm trust` 명령은 npm registry 작업이라 어느 디렉토리에서든 실행할 수 있지만, **interactive 2FA 세션**이 필요하다. CI의 `NPM_TOKEN`으로는 read(`npm trust list`)와 write 모두 `E403`이므로 workflow에서 실행할 수 없다.

## 시작 전 확인

먼저 release의 종류를 구분한다.

| 변경 | 결정할 version channel | 기본 evidence |
| --- | --- | --- |
| public npm package surface | workspace package version + Changeset | package test, pack smoke, public consumer check |
| TypeSpec/OpenAPI contract | `packages/schemas/typespec/version.tsp`의 `ContractVersion` | approved snapshot diff, `schema:validate`, downstream check |
| private/downstream/maintenance workspace | release policy가 허용하는 lifecycle | scope policy와 해당 track 검증 |

API contract version을 올렸다고 npm package를 자동으로 올리거나, 반대로 package patch를 API
contract change로 해석하지 않는다. 공개 배포 후보는 release policy의 `distributionCandidates`에 있는
package뿐이다.

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

이 명령은 전체 CI를 대체하지 않는다. official promotion 전에는 release candidate commit에서
`pnpm ci:local`(전체 lane: API index, CLI spec, codegen boundary, type registry, feature-test matrix,
schema freshness/rollback, Node 22/24/26 public consumer runtime, TS7, governance)이 통과했는지
확인한다. GitHub CI는 필수 lane만 실행하므로 public runtime/TS7/governance 결과의 근거로 쓰지 않는다.

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
  --version @oa-sdk/codegen=0.6.0 \
  --version @oa-sdk/router=0.2.1 \
  --version @oa-sdk/client=0.2.1 \
  --version @oa-sdk/mock-server=0.1.3
```

exporter는 선택한 package를 clean build하고 source map/test file을 제거한 tarball을 만든다.
official export의 `--version`은 committed workspace package version과 같아야 하므로, 위 예시는
먼저 `pnpm version-packages` 결과를 review·commit한 release candidate에서만 사용한다.
또한 workspace dependency가 public version으로 해소되는지, 모든 public import와 `oa-gen`
consumer smoke가 동작하는지 확인하고 SHA-512 manifest를 기록한다. 이 단계도 npm publish는
하지 않는다.

### Consumer smoke와 optional peer

exporter의 consumer smoke와 `pnpm ci:local`의 Node 22/24/26 public runtime smoke(`scripts/public-runtime-smoke.mjs`)는
pack된 tarball을 빈 consumer project에 설치하고 모든 public entry point(root와 각 export subpath)를
import한다. consumer에는 사용자의 package manager가 함께 설치하는 것, 즉 dependency와 required peer
dependency만 둔다. `peerDependenciesMeta`에서 optional로 표시한 peer는 npm과 pnpm이 설치하지 않으므로
consumer에도 설치하지 않는다.

- optional peer를 import하는 entry point는 `docs/internal/release-policy.json`의
  `optionalPeerEntryPoints`에 package → export subpath → optional peer 목록으로 선언한다. 현재 선언은
  `@oa-sdk/mock-server`의 `./adapters/msw`와 `./browser`(`msw`)뿐이다.
- 선언하지 않은 entry point가 optional peer나 manifest에 선언하지 않은 package를 import하면 smoke가
  실패한다. root entry point는 선언할 수 없고, 선언한 subpath와 peer는 그 package의 export와 optional
  peer여야 한다. `pnpm check:release-policy`가 source manifest에서 이를 먼저 검사한다.
- 선언한 entry point는 그 peer가 없을 때 바로 그 peer 때문에 실패해야 하고(필요 없어진 선언이나
  빠진 peer를 찾는다), peer를 설치한 consumer에서는 import되어야 한다.
- `oa-gen` 명령도 optional peer 없는 consumer에서 실행한다. runtime smoke는 `validate`, `typegen`과
  함께 `oa-gen init` scaffold의 `mock` script가 실행하는 `oa-gen mock`을 띄워 요청 하나를 보낸다.

### Internal dependency version gate

public manifest의 `workspace:` runtime/optional/peer dependency는 다음 순서로 version이 정해진다.

- 같은 export에 `--version <dependency>=<version>`으로 포함되어 있으면 그 version을 쓴다.
- 포함되어 있지 않으면 그 dependency의 committed source version(`package.json`의 version)을 쓰며,
  그 version은 이미 public npm에 publish되어 있어야 한다.

dependent package는 committed source version으로 build·test되므로, 그 version이 npm에 없을 때
npm의 latest release로 대체하면 test하지 않은 (대개 더 오래된) release에 의존하는 package가
publish된다. 그래서 exporter는 대체하지 않고 export를 실패시키며, 실패 메시지는 dependent와
dependency version, 그리고 그 export에 `--version <dependency>=<version>`을 추가하거나 dependency를
먼저 release하라는 두 해결 방법을 나열한다. 예를 들어 committed version이 `@oa-sdk/core` 0.3.1인데
npm에는 0.3.0까지만 있다면, core를 빼고 parser나 codegen을 export하는 것은 실패한다.

### `@oa-sdk/codegen` built-against version gate

`oa-gen`은 codegen이 build될 때 사용한 `@oa-sdk` package version을 build에 embed하고, 그 version과
호환되는 range(`^<version>`)를 사용자에게 알려 준다.

- `oa-gen init`은 workspace 밖의 project에 scaffold가 쓰는 registry package를 그 range로 쓴다.
  `@oa-sdk/codegen` 자신과 companion(`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`),
  그리고 `microservice`·`enterprise` archetype의 `@oa-sdk/core`가 여기에 해당한다.
- `oa-gen`은 companion을 dynamic import하고, companion이 설치되어 있지 않으면 같은 range로 고정한
  설치 명령(예: `npm install --save-dev "@oa-sdk/router@^0.2.5"`)을 출력한다.

이 range는 public manifest를 거치지 않는다. release policy상 Core Platform package인 codegen은
Downstream companion을 devDependencies로만 참조할 수 있고 public manifest에서는 devDependencies가
제거된다. `@oa-sdk/core`처럼 runtime dependency로 남는 package도, manifest의 dependency version과
init이 쓰는 range는 별개다. 따라서 위의 internal dependency gate만으로는 이 range가 설치
가능한지 보장되지 않는다.

그래서 export에 `@oa-sdk/codegen`이 포함되면 exporter는 pack된 codegen tarball에서 embed된 version을
읽고, gate 대상 package마다 다음 중 하나를 만족하지 않으면 export를 실패시킨다.

- 같은 export의 `--version <package>=<version>`에 정확히 그 version으로 포함되어 있다.
- 그 version이 이미 public npm에 publish되어 있다.

gate 대상은 codegen이 registry에서 설치하라고 안내하는 package 전체, 즉 codegen의
`OA_SDK_INIT_PACKAGES`에서 `registry`로 표시된 package(`REGISTRY_OA_SDK_PACKAGES`) 중 codegen
자신을 뺀 것이다. exporter는 이 목록을 codegen source에서 그대로 가져오며 별도 목록을 두지 않는다.
companion은 type 제약에 의해 이 목록에 반드시 `registry`로 포함되므로, init이 새 registry package를
쓰게 되거나 companion이 추가되면 gate도 함께 따라온다. 비공개 `@oa-sdk/personas`처럼
`workspace`로 표시된 package는 workspace 밖에서 쓰이지 않으므로 대상이 아니다. codegen 자신의
range는 export가 codegen을 source version 그대로 release하므로 이미 충족된다.

즉 codegen export는 gate 대상 package를 같은 export에 함께 넣거나 그보다 먼저 release한 뒤에만
만들 수 있다. 예를 들어 codegen 0.10.0이 core 0.3.1로 build되었다면, `--version @oa-sdk/core=0.3.1`
없이(그리고 core 0.3.1이 npm에 없는 상태에서) codegen을 export하는 것은 실패한다. 실패 메시지는
해당 package와 version을 나열하므로, 그 export에 `--version <package>=<version>`을 추가하거나 그
package를 먼저 release한다. official export의 `--version`은 committed source version과 같아야 하고
codegen은 workspace의 source version으로 build되므로, 추가할 version은 해당 package의
`package.json` version이다.

두 gate는 `--dry-run`과 `--skip-registry-preflight`에서도 생략되지 않는다. export에 없는
package는 public npm registry에서 조회하며, E404 이외의 registry 오류는 미배포로 간주하지 않고
그대로 export 실패로 드러낸다.

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

## 4. Release PR과 npm promotion

### 4.1 `oa-sdk-releases` release PR

export가 만든 `releases/<release-id>/`를 branch로 commit하고 PR을 만든다.

```bash
cd ../oa-sdk-releases
git checkout -b release/<release-id>
git add releases/<release-id>
git commit -m "release: <release-id>"
git push -u origin HEAD
gh pr create
```

PR에서 다음을 확인한 뒤 merge한다.

- release ID, source commit, package/version, tarball SHA-512가 review record와 일치한다.
- package tarball에는 source, test, source map, private repository metadata가 포함되지 않는다.
- required review/branch protection이 충족됐다.
- npm provenance/OIDC 및 registry 권한이 외부 workflow에만 부여돼 있다.

### 4.2 Trusted publishing으로 publish

`oa-sdk-releases`의 `publish.yml`은 GitHub OIDC 전용이다. publish step에 `NPM_TOKEN`을
넘기지 않고 항상 `publish-release.mjs --trusted`를 실행한다.

```bash
gh workflow run "Publish npm release" \
  --repo mineclover/oa-sdk-releases \
  -f release_id=<release-id>
```

GitHub UI에서는 `Actions` → `Publish npm release` → `Run workflow`에서 release ID만 넣는다.

package별 trusted publisher는 최초 한 번 interactive 2FA로 설정한다. 설정 값은 owner
`mineclover`, repository `oa-sdk-releases`, workflow `publish.yml`, environment `npm-publish`,
allowed action `npm publish`다. `npm trust list <package>`로 확인한다. `npm trust github`의
`E409`는 이미 같은 설정이 있다는 뜻이고, CI token의 `E403`은 자동 관리가 금지된 것이다.
자세한 수동 절차, trust 관계 갱신, `E409`/`E403` 트러블슈팅은
[OIDC Trusted Publishing 설정 및 업데이트 가이드](./oidc-trusted-publishing.md)와
`oa-sdk-releases/README.md`를 따른다.

첫 OIDC publish가 성공해야 trust 설정이 검증된다. 설정 후 2일 안에 성공하지 못하면 만료되므로
삭제 후 재생성해야 한다.

publish workflow는 artifact boundary를 검증하고, 이미 배포된 version은 skip하며, registry
전파를 최대 15분 기다린다. 전파 지연으로 검증이 실패하면 **같은 release ID로 재실행**한다.
이미 배포된 version은 다시 publish하지 않는다.

### 4.3 배포 확인

```bash
npm view @oa-sdk/<package> version --prefer-online
npm view @oa-sdk/<package> dist-tags --json --prefer-online
```

`latest`가 새 version을 가리키는지 확인하고 GitHub Release/tag를 만든다. 첫 trusted publish가
성공하면 npm package 설정에서 token 기반 publishing을 제한하고 `NPM_TOKEN`을 은퇴시킨다.

source repository의 `pnpm release` 또는 `pnpm release:export`는 이 최종 promotion을 대신하지
않는다.

## 완료 기준

- [ ] 선택한 package와 version intent가 Changeset/release note에 기록됐다.
- [ ] clean-worktree `pnpm release:preflight`가 통과했다.
- [ ] export한 package의 internal dependency가 같은 export에 포함됐거나 committed version으로 이미 npm에 있다.
- [ ] codegen을 export했다면 `oa-gen`이 안내하는 package(companion, `@oa-sdk/core`)가 built-against version으로 같은 export에 포함됐거나 이미 npm에 있다.
- [ ] 같은 release candidate commit의 `pnpm ci:local`이 통과했고, GitHub CI가 실행됐다면 필수 lane도 통과했다.
- [ ] contract change라면 TypeSpec snapshot 및 semver evidence를 검토했다.
- [ ] external artifact repository의 manifest와 SHA-512를 검토하고 release PR을 merge했다.
- [ ] export한 package마다 trusted publisher가 설정됐고, 첫 OIDC publish가 성공했다.
- [ ] `npm view --prefer-online`으로 `latest`를 확인하고 GitHub Release/tag를 만들었다.
- [ ] 첫 trusted publish 성공 후 token 기반 publishing을 제한하고 `NPM_TOKEN`을 은퇴시켰다.
- [ ] 실제 npm promotion은 authorized external workflow에서만 실행했다.

정책의 전체 근거와 현재 판단 입력은 [Release Readiness](../internal/release-readiness.md),
package/versioning 규칙은 [Release Management](../internal/release-management.md)를 참조한다.
PR 또는 release issue에 남길 값은 [Release Decision Record Template](../internal/release-decision-record-template.md)를
복사해 사용한다.
