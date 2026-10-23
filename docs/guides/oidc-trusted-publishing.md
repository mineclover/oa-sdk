# OIDC Trusted Publishing 설정 및 업데이트 가이드

Status: active operating guide. Last reviewed 2026-10-23.

이 가이드는 `@oa-sdk/*` package를 npm에 배포할 때 **GitHub Actions OIDC trusted publishing**을
설정하고, repository·workflow·environment가 바뀔 때 trust 관계를 갱신하는 절차를 정리한다.
실제 artifact export와 release PR 절차는 [패키지 릴리즈 준비 가이드](./release-preparation.md)를
따른다.

## 1. 현재 구성 (2026-10-23 기준)

| 항목 | 값 |
| --- | --- |
| 배포 workflow | `mineclover/oa-sdk-releases`의 `.github/workflows/publish.yml` |
| GitHub environment | `npm-publish` |
| Trusted publisher | GitHub Actions |
| 허용 action | `npm publish`, `npm stage publish` |
| Credential path | GitHub OIDC only (no token input) |
| 검증된 package | `@oa-sdk/tools`, `@oa-sdk/mcp-mesh` |
| 첫 OIDC publish | `2026-10-23-tools-v0.2.2` (run `39892391866`) |

`publish.yml`은 publish step에 `NPM_TOKEN`/`NODE_AUTH_TOKEN`을 넘기지 않고 GitHub OIDC로
인증한다. npm은 GitHub가 발급한 단기 token을 registry publish token으로 교환하고 provenance를
자동 생성한다. `publish-release.mjs`의 token 경로는 local/emergency manual run에만 남아 있고,
GitHub Actions workflow는 항상 `--trusted`를 사용한다.

## 2. OIDC가 동작하는 조건

- GitHub-hosted runner에서 실행해야 한다. self-hosted runner는 지원되지 않는다.
- workflow에 `id-token: write` permission이 있어야 한다.
- workflow 파일명, repository, environment가 npm에 등록한 값과 **정확히** 같아야 한다.
- package의 `repository.url`이 실제 GitHub repository와 일치해야 한다.
- npm CLI가 trusted publishing을 지원해야 한다. 이 저장소는 Node 24와 함께 제공되는 npm 11.x를
  사용하며, `npm trust` 명령은 npm 11.19 이상에서 확인했다.

`publish.yml`의 필수 permission:

```yaml
permissions:
  contents: read
  id-token: write
```

## 3. 최초 설정 (package당 한 번, interactive 2FA)

trusted publisher 설정과 조회는 **2FA를 완료할 수 있는 사람의 interactive session**에서만
가능하다. CI의 2FA bypass granular token은 read(`npm trust list`)와 write 모두 `E403`으로
거부되므로 workflow로 자동화할 수 없다.

### 3.1 npm 웹 UI

각 package의 npm 페이지에서 설정한다.

`Package` → `Settings` → `Trusted publishing` → `Add publisher` → `GitHub Actions`

- Organization or user: `mineclover`
- Repository: `oa-sdk-releases`
- Workflow filename: `publish.yml`
- Environment name: `npm-publish`
- Allowed actions: `npm publish` (필요하면 `npm stage publish`도 유지)

`@oa-sdk/tools`, `@oa-sdk/mcp-mesh` 등 배포하는 package마다 반복한다.

### 3.2 npm CLI

```bash
npm login --auth-type=web

npm trust github @oa-sdk/tools \
  --file publish.yml \
  --repo mineclover/oa-sdk-releases \
  --environment npm-publish \
  --allow-publish -y

npm trust github @oa-sdk/mcp-mesh \
  --file publish.yml \
  --repo mineclover/oa-sdk-releases \
  --environment npm-publish \
  --allow-publish -y
```

확인:

```bash
npm trust list @oa-sdk/tools
npm trust list @oa-sdk/mcp-mesh
```

다음 값이 보이면 정상이다.

- `type: github`
- `file: publish.yml`
- `repository: mineclover/oa-sdk-releases`
- `environment: npm-publish`
- `permissions: publish, stage publish`

### 3.3 첫 publish 검증

trust 설정은 **첫 성공적인 OIDC publish**로 검증된다. 설정 후 2일 안에 성공하지 못하면 만료되므로,
설정 직후 다음 release를 OIDC workflow로 배포한다.

`oa-sdk-releases`에서:

```bash
gh workflow run "Publish npm release" \
  --repo mineclover/oa-sdk-releases \
  -f release_id=<release-id>
```

성공 로그에 다음이 보여야 한다.

```text
Publishing with npm trusted publishing (GitHub OIDC)
Registry propagation for <package>@<version> took ...
Verified <package>@<version> on the public registry.
```

## 4. Trust 관계 업데이트

기존 trusted publisher 연결은 **값을 수정할 수 없다**. repository, workflow filename,
environment, permission 중 하나라도 바뀌면 기존 연결을 삭제하고 새로 만든다.

### 4.1 현재 연결 확인

```bash
npm trust list @oa-sdk/tools
npm trust list @oa-sdk/mcp-mesh
```

출력에서 `id`를 기록한다.

### 4.2 삭제 후 재생성

```bash
npm trust revoke @oa-sdk/tools --id=<trust-id>

npm trust github @oa-sdk/tools \
  --file publish.yml \
  --repo mineclover/oa-sdk-releases \
  --environment npm-publish \
  --allow-publish -y
```

재생성 후 **2일 안에** OIDC publish를 성공시켜 검증한다.

### 4.3 Workflow 이름이나 environment를 바꾸는 경우

1. `publish.yml`의 파일명 또는 environment를 먼저 바꾼다.
2. npm의 기존 trust 연결을 revoke한다.
3. 새 파일명/environment로 `npm trust github`를 다시 실행한다.
4. `publish.yml`이 `--trusted`로 publish하는지, `NPM_TOKEN` env가 없는지 확인한다.
5. 다음 release에서 OIDC publish를 검증한다.

workflow 파일명을 바꾸면 npm 설정과 `publish.yml`의 `--file` 값이 함께 바뀌어야 한다.
environment를 바꾸면 `publish.yml`의 `environment:`와 npm 설정의 environment가 함께 바뀌어야 한다.

## 5. 배포 절차

1. `oa-sdk` source repository에서 changeset, version, `pnpm ci:local`, `pnpm release:preflight`를
   완료한다.
2. `pnpm release:export`로 `oa-sdk-releases/releases/<release-id>/`를 만든다.
3. `oa-sdk-releases`에 release PR을 만들고 merge한다.
4. **Publish npm release**를 실행한다. workflow는 항상 OIDC를 사용한다.

```bash
gh workflow run "Publish npm release" \
  --repo mineclover/oa-sdk-releases \
  -f release_id=<release-id>
```

5. Registry를 확인한다.

```bash
npm view @oa-sdk/<package> version --prefer-online
npm view @oa-sdk/<package> dist-tags --json --prefer-online
```

6. GitHub Release/tag를 만든다.

publish workflow는 artifact boundary를 검증하고, 이미 배포된 version은 skip하며, registry
전파를 최대 15분 기다린다. 전파 지연으로 검증이 실패하면 **같은 release ID로 재실행**한다.
이미 배포된 tarball은 교체하지 않는다.

## 6. Token publish 제한 및 NPM_TOKEN 은퇴

첫 OIDC publish가 성공한 뒤에는 long-lived token 경로를 제한한다.

1. 각 package의 npm Settings → Publishing access에서
   **“Require two-factor authentication and disallow tokens”**를 설정한다.
2. `oa-sdk-releases`의 repository 또는 `npm-publish` environment secret에서 `NPM_TOKEN`을 제거한다.
3. npm 계정의 사용하지 않는 granular token을 revoke한다.
4. private dependency 설치에 token이 필요하면 publish 권한이 없는 read-only token을 별도로 쓴다.

GitHub Actions workflow에는 token fallback이 없다. local/emergency manual run에서만
`publish-release.mjs`를 `--trusted` 없이 실행해 token 경로를 쓸 수 있다.

token을 즉시 revoke하지 않고 만료되도록 두는 경우에도 workflow 변경은 필요 없다. workflow는
token을 전달받지 않으므로 만료가 OIDC 배포에 영향을 주지 않는다. 다만 npm Publishing access를
조이지 않았다면 만료 전까지 token 경로가 registry에 남아 있다는 점은 감수해야 한다.

## 7. 트러블슈팅

| 증상 | 원인 | 조치 |
| --- | --- | --- |
| `E403` with CI token | 2FA bypass granular token은 trust read/write 불가 | interactive `npm login --auth-type=web` 후 다시 실행 |
| `E409 ... already exists` | 같은/겹치는 trust 설정이 이미 존재 | `npm trust list`로 확인. 값이 맞으면 추가하지 않는다. 틀리면 `id`로 revoke 후 재생성 |
| publish 시 `ENEEDAUTH` | repository/workflow/environment 불일치, `id-token: write` 누락, self-hosted runner, `repository.url` 불일치 | 값을 정확히 비교하고 GitHub-hosted runner에서 재실행 |
| trust 설정이 만료됨 | 생성 후 2일 안에 첫 publish 실패 | 삭제 후 재생성하고 2일 안에 publish |
| registry 검증 timeout | npm registry 전파 지연 | 같은 release ID로 재실행. publish script가 기존 version을 skip한다 |
| `npm trust list`가 `EOTP` | interactive 2FA 필요 | 출력된 URL에서 2FA를 완료하거나 `npm login --auth-type=web` 후 재실행 |

## 8. 보안 원칙

- OIDC publish에는 long-lived `NPM_TOKEN`을 넘기지 않는다.
- `publish.yml`은 GitHub-hosted runner와 `npm-publish` environment를 유지한다.
- trust 설정은 package별로 최소 권한(`npm publish`)만 허용한다.
- 이미 배포된 version의 tarball을 교체하거나 같은 release ID로 다른 artifact를 배포하지 않는다.
- release ID는 immutable이며, 검증 재실행에만 같은 ID를 쓴다.
