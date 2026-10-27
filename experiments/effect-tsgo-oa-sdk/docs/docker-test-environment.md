# Docker Node 26 로컬 검증 환경

상태: 2026-10-27 기준 **구성 추가 완료 / 실제 Docker 엔진 실행 미검증**. 결과를 실행 완료로 주장하려면 실행자의 `.reports/latest.json`와 잠금 파일, 도구 판본을 별도로 확보해야 한다.

## 선택 이유

- 이 레퍼런스는 `@effect/tsgo@0.59.0`과 `typescript@7.0.2`가 소비자 코드에 적용되는지를 검사한다. OA-SDK 모노레포의 TypeScript 5.9 기반 빌드·루트 pnpm lock은 바꾸지 않는다.
- `node:26-bookworm`의 Linux 실행환경을 컨테이너로 고정하고, `node_modules`는 호스트와 공유하지 않는다. TypeScript-Go 바이너리가 macOS/Windows에서 설치된 모듈과 섞이지 않도록 별도 Docker volume을 사용한다.
- `contract/openapi.yaml`은 이 예제의 계약 원본이다. OA-SDK production의 TypeSpec 정본은 건드리지 않는다.

## 사전 준비

Docker Desktop 또는 Docker Engine + Compose v2가 있어야 한다. 레퍼런스 코드는 OA-SDK PR #23의 브랜치를 checkout해서 사용한다.

```bash
git fetch origin
git switch experiment/effect-tsgo-oa-reference-20261027
cd experiments/effect-tsgo-oa-sdk
docker compose version
```

### 1. 최초 1회: lockfile 생성

```bash
bash scripts/run-docker.sh bootstrap
git diff -- package-lock.json
git add package-lock.json
# 검토된 lockfile만 이 브랜치에 커밋한다. 생성 도구가 판본을 임의로 변경하지 않는다.
```

`bootstrap`은 `package-lock.json`이 이미 존재할 때 **자동으로 덮어쓰지 않는다**. npm 11/12 버전 차이, peer dependency 충돌, 설치 스크립트 정책 변경을 확인한 뒤 필요시 별도로 수정·검토한다. 명시적으로 `npm install --package-lock-only --ignore-scripts`를 호출하며 설치 바이너리는 만들지 않는다.

### 2. 반복: 잠금 파일 재현 및 검증

```bash
bash scripts/run-docker.sh verify
# 검수 보고서
cat .reports/latest.json
```

`verify`는 매 실행마다 `npm ci --no-audit --no-fund`로 잠금 파일을 검증한 뒤 `npm run review`를 실행하며, **17개 Node 계약 테스트는 review 내부에서 한 번만 실행**한다. 이후 실제 OA-SDK CLI 생성, Effect TSGO 타입 검사·진단, JS emit, Node HTTP 런타임 테스트가 수행된다.

`npm ci`는 불일치한 lockfile을 암묵적으로 수정하지 않는다. 기대하는 negative fixture의 진단은 정상 빌드 결과와 별도로 평가하며, `npm run review`가 `candidate-passed`를 출력해도 **해당 회차만** 검증한 것이다.

```bash
# 의존성을 설치하지 않아도 실행할 수 있는 도구 계약 테스트
bash scripts/run-docker.sh contracts

# 컨테이너 이미지 조회
bash scripts/run-docker.sh image

# 실행 스크립트가 기록한 실제 레지스트리 digest
cat .reports/docker-base-image.json
# 별도 확인: 로컬에 내려받은 Node 공식 이미지
docker image inspect node:26-bookworm --format '{{json .RepoDigests}}'
```

`node:26-bookworm`은 **moving tag**이다. 실행 스크립트는 매번 태그를 pull하고 실제 `node@sha256:...`를 얻어 **같은 digest를 Docker 빌드 인자와 실행 환경에 전달**한다. `.reports/docker-base-image.json`에 관측값이 남는다. 검증 회차 사이 동일 이미지까지 보장하려면 최초 정상 검증에서 확보한 실제 digest를 후속 운영·CI의 버전 관리 대상으로 승격해야 한다. 미확인 digest를 추정하지 않는다.

## 실행 환경 격리

`compose.yaml`의 유일한 서비스 `test`:

- 프로젝트 폴더 `.`만 `/workspace`로 바인드 마운트한다. OA-SDK 루트/상위 디렉터리는 포함하지 않는다.
- `/workspace/node_modules`는 Docker named volume `node_modules`다. host `node_modules`와 플랫폼 바이너리를 공유하지 않는다.
- `/home/node/.npm`은 별도 `npm_cache` named volume이다. cache는 증거가 아니라 다운로드 최적화일 뿐이다.
- 비특권 `node` 사용자로 실행하며 포트를 공개하지 않는다. 테스트 HTTP 서버는 컨테이너 내부 `127.0.0.1`의 임시 포트만 사용한다.
- `node:26-bookworm` 이미지가 제공하는 npm을 사용한다. 호스트에 pnpm, TypeScript, Effect TSGO가 설치될 필요는 없다.

Linux host UID/GID가 1000이 아닌 경우 bind 경로에 쓸 권한을 확인한다. `EACCES`가 나면 소유권을 확인하고 해당 사용자에게 쓰기 권한을 부여한다. 문제를 숨기려고 무조건 `chmod 777` 또는 `sudo npm install`로 실행하지 않는다. Windows라면 WSL2의 Bash 터미널에서 실행하는 것을 권장한다.

재현성·설치 비용을 비교할 때는 cache volume을 지운 cold 설치와 보존한 warm 설치를 분리하여 측정한다. **기존 다른 서비스의 Docker 볼륨 전체를 지우지 않는다.** 해당 프로젝트의 볼륨만 정리해야 하는 경우 `docker compose down -v`의 영향을 먼저 확인한다.

## 실패 분류 및 보고

| 결과 | 의미 | 조치 |
| --- | --- | --- |
| `blocked` | Node 26/lockfile/이미지 digest/정확한 의존성/바이너리 등 준비 누락 | 선행 단계 해결 후 재실행 |
| `failed-or-incomplete` | 계약 생성·컴파일·진단·실행 단계의 실제 실패 | `.reports/latest.json`에서 실패 단계 및 stderr 확인 |
| `candidate-passed` | 해당 입력 digest와 toolchain으로 검수 단계를 관측 | 독립 리뷰, 성능, 에디터 LSP 및 반복성 검증 |

`.reports/latest.json`는 로컬 기계의 파일 경로·진단 메시지 등을 포함할 수 있으므로 기본 Git 제외 상태를 유지한다. 공유할 때 민감한 URL/환경값이 없는지 확인하고, 레시트의 source·lock·이미지 digest를 이슈에 첨부한다.

## 공식 참고 문서

- [Node Docker Official Image](https://hub.docker.com/_/node) · [Node Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
- [Docker bind mount](https://docs.docker.com/engine/storage/bind-mounts/) · [Docker named volumes](https://docs.docker.com/engine/storage/volumes/)
- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) · [npm install lockfile behavior](https://github.com/npm/cli/blob/latest/docs/lib/content/commands/npm-install.md)
- [Effect TSGO README](https://github.com/Effect-TS/tsgo/blob/main/README.md) · [Effect v4 Devtools](https://effect.website/docs/v4/getting-started/devtools)

자세한 평가 기준은 [검증 프로토콜](./verification-protocol.md)과 [참조 근거 목록](./reference-sources.md)을 사용한다.
