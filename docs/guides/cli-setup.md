# CLI 설치 및 환경 설정 가이드 (CLI Setup)

> **Canonical Authority**: `@oa-sdk/codegen` CLI (`oa-gen`)
> **Target Audience**: `oa-sdk`를 프로젝트에 도입하는 애플리케이션 개발자, 플랫폼 엔지니어, CI/CD 관리자
> **Supported Environments**: Node.js 22 이상 (CI 검증: Node.js 22·24·26)

`@oa-sdk/codegen` 패키지가 제공하는 `oa-gen` CLI는 OpenAPI 3.1/3.2 사양 검증, Zod 4 및 TypeScript 타입 생성, fetch 클라이언트와 TanStack Query v5 코드 생성, 핸들러 계약 생성, mock 서버 구동을 하나의 CLI로 제공합니다.

이 문서는 다른 프로젝트에서 공개 패키지를 쓰는 사용자를 위한 설치 및 환경 설정의 정본입니다. 이 문서의 동작은 `@oa-sdk/codegen` 0.9.0 기준입니다.

---

## 1. 런타임 요구사항 (Runtime Prerequisites)

공개 패키지는 Node.js 22 이상에서 동작합니다. CI가 Node.js 22·24·26에서 배포 후보를 설치해 확인합니다.

| 런타임 | 지원 버전 | 비고 |
|---|---|---|
| **Node.js** | $\ge$ 22.0.0 | 모든 공개 `@oa-sdk/*` 패키지의 `engines.node`가 `>=22.0.0`입니다. |
| **Bun** | 지원 환경 아님 | Bun은 CI에서 검증하지 않습니다. `oa-gen init`이 Bun용 스크립트를 쓸 수는 있지만 지원 환경으로 약속하지 않습니다. |
| **운영체제** | macOS, Linux, Windows | Linux에서는 `oa-gen mock --watch`가 하위 디렉터리마다 감시를 걸어 재귀 파일 감시를 대신합니다. |

TypeScript 버전과 생성 코드의 호환 범위는 [TypeScript 호환성](./typescript-compatibility.md#consumer-support)을 따릅니다.

---

## 2. 패키지 매니저별 설치 (Package Manager Matrix)

프로젝트에서 사용하는 패키지 매니저에 맞춰 `@oa-sdk/codegen`을 **개발 의존성(`devDependencies`)**으로 설치합니다.

### npm
```bash
npm install --save-dev @oa-sdk/codegen
```

### pnpm
```bash
pnpm add -D @oa-sdk/codegen
```

### yarn
```bash
yarn add -D @oa-sdk/codegen
```

### bun (CI 검증 대상 아님)
```bash
bun add -d @oa-sdk/codegen
```

`@oa-sdk/codegen`은 `@oa-sdk/core`, `@oa-sdk/parser`, `@oa-sdk/surface-ir` 등 런타임 의존성과 TypeSpec 컴파일러를 함께 설치합니다. 패키지별 배포 상태는 [라이브러리 진입점 지도](./library-entrypoints.md)를 따릅니다.

### 동반 패키지 (Companion Packages)

핸들러 계약·클라이언트·mock 서버 산출물은 `oa-gen`이 필요할 때 불러오는 **동반 패키지(companion package)**가 생성합니다. 릴리스 정책상 Core Platform 패키지(`@oa-sdk/codegen`)는 Downstream Integration 패키지를 배포 manifest에 의존성으로 선언하지 않으므로, `@oa-sdk/codegen`을 설치해도 이들은 설치되지 않습니다. 사용하는 산출물에 맞춰 직접 추가합니다.

`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`는 `@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포됩니다. 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은 [변경 이력](../changelog.md)에서 확인합니다. 아래의 설치 명령 고정, `init`의 버전 지정자, 패키지가 없을 때 실패하는 동작은 모두 `@oa-sdk/codegen` 0.9.0 이상 기준입니다.

| 패키지 | 필요한 산출물 |
|---|---|
| `@oa-sdk/router` | `oa-gen generate`의 핸들러 계약(`*.contract.ts`)과 CRDT 계약/라우터 모듈. 프레임워크 라우터 코드는 `oa-gen` 명령이 아니라 이 패키지의 `generateRouter()`를 빌드 스크립트에서 호출해 만듭니다. |
| `@oa-sdk/client` | `oa-gen generate:client`, `pack:client`, `generate:tanstack`, 그리고 `oa-gen generate`의 클라이언트 SDK, TanStack Query 옵션, CRDT 클라이언트/훅 모듈 |
| `@oa-sdk/mock-server` | `oa-gen mock`. `msw`는 필요하지 않습니다. `msw`는 MSW 어댑터(`@oa-sdk/mock-server/adapters/msw`, `@oa-sdk/mock-server/browser`)를 쓸 때만 설치합니다. |

```bash
pnpm add -D @oa-sdk/router @oa-sdk/client @oa-sdk/mock-server
```

동반 패키지의 버전은 `@oa-sdk/codegen`과 독립적으로 매겨집니다. 각 codegen 릴리스는 빌드·테스트에 사용한 동반 패키지 버전과 호환되는(`^`) 릴리스를 지원하며, `oa-gen`이 출력하는 설치 명령은 모두 그 범위로 버전을 고정합니다(예: `pnpm add -D "@oa-sdk/router@^<버전>"`). 위의 버전 없는 명령은 대신 최신 릴리스를 설치합니다.

`oa-gen init`은 스캐폴드가 사용하는 동반 패키지를 `devDependencies`에 추가합니다. 생성되는 `oa.config.ts`가 핸들러 계약과 클라이언트 SDK를 켜고(`core.contracts.pureHandlers: true`, `core.client.enabled: true`), 생성되는 `mock` 스크립트가 `oa-gen mock`을 실행하기 때문입니다.

`oa-gen init`이 `@oa-sdk` 패키지(`@oa-sdk/codegen` 자신과 동반 패키지 포함)에 쓰는 버전 지정자는 프로젝트가 그 패키지를 설치하는 위치를 따릅니다.

- 프로젝트가 pnpm 워크스페이스(`pnpm-workspace.yaml`)의 멤버이고 그 워크스페이스가 해당 패키지도 멤버로 가지면 `workspace:*`를 씁니다. oa-sdk 저장소 안의 앱이 이 경우입니다.
- 그 밖에는 이 codegen이 빌드·테스트에 사용한 릴리스와 호환되는 범위(`^<버전>`)를 씁니다. npm은 `workspace:` 프로토콜을 지원하지 않으므로(`EUNSUPPORTEDPROTOCOL`), 워크스페이스 밖에서 설치되는 것은 이 범위입니다.
- `enterprise` 아키타입이 권장하는 `@oa-sdk/personas`는 레지스트리에 배포되지 않는 비공개 패키지입니다. 이 패키지를 멤버로 가진 워크스페이스 안에서만 추가하고, 그 밖에서는 추가하지 않은 이유를 `init` 출력에 표시합니다.

`init`은 `package.json`에 이미 있는 항목을 `--force` 없이는 바꾸지 않습니다(`--force`는 `oa.config.ts`와 스크립트도 덮어씁니다). 그 뒤 프로젝트가 있는 위치에서 설치할 수 없는 `@oa-sdk` 항목을 모두, 해야 할 조치와 함께 출력합니다.

- 해당 패키지를 멤버로 가진 워크스페이스 밖의 `workspace:` 항목(이전 버전의 `init`이 쓴 항목 등)은 `init`이 출력하는 범위로 바꿉니다. `init`이 쓰는 패키지라면 `--force`가 이렇게 바꿉니다.
- 그 패키지를 멤버로 가진 워크스페이스 밖의 `@oa-sdk/personas` 항목은 지정자와 관계없이 삭제합니다. 레지스트리에 없는 패키지이고, `init`이 더 이상 쓰지 않으므로 `--force`도 그 항목을 그대로 둡니다.

패키지가 설치되어 있지 않으면 `oa-gen`은 해당 산출물을 조용히 건너뛰지 않습니다.

- `mock`, `generate:client`, `pack:client`, `generate:tanstack`은 그 산출물만을 위한 명령이므로 설치 명령을 출력하고 종료 코드 1로 실패합니다.
- `oa-gen generate`는 설정 파일이 산출물을 **명시적으로** 켠 경우(`core.contracts.pureHandlers: true` → `@oa-sdk/router`, `core.client.enabled: true` → `@oa-sdk/client`) 어떤 파일도 쓰기 전에 종료 코드 1로 실패합니다. 스위치를 사용자가 썼는지 `oa-gen init`이 썼는지는 구분하지 않습니다. 해당 산출물이 필요 없다면 스위치를 `false`로 설정합니다.
- 기본값으로만 **암시된** 산출물(값을 지정하지 않은 스위치와 아키타입 프리셋, TanStack Query 옵션, CRDT 모듈, `--spec` 직접 실행의 모든 동반 패키지 산출물)은 패키지 이름과 설치 명령을 담은 경고와 함께 건너뜁니다. 이전 실행이 생성한 해당 산출물 파일은 고아 파일로 정리되지 않고 유지됩니다.
- 패키지가 설치되어 있어도 산출물을 만드는 중 동반 패키지에서 오류가 나면 같은 구분을 따릅니다. 명시적으로 켠 산출물이면 오류를 출력하고 어떤 파일도 쓰지 않은 채 종료 코드 1로 실패하고, 암시된 산출물이면 오류를 담은 경고와 함께 그 산출물만 건너뜁니다(이전 파일 유지).

자세한 설정 규칙은 [선언적 사양 설정 가이드](./declarative-spec-configuration.md#명시적-요청과-암시적-기본값-동반-패키지)를 참고하세요.

### TypeSpec 작성 의존성

`oa-gen`의 `validate`, `typegen`, `generate`, `generate:zod`, `generate:client`, `generate:tanstack`, `mock --tsp`, `tsp diff`에 `.tsp` 파일을 넘기면 `@oa-sdk/codegen`에 들어 있는 TypeSpec 컴파일러(`@typespec/compiler` 1.16)로 메모리에서 컴파일하므로 별도의 `tsp compile` 단계가 필요 없습니다. 다만 `.tsp`의 `import "@typespec/http"` 같은 라이브러리 import는 `.tsp` 파일 위치에서 찾습니다. pnpm처럼 의존성을 끌어올리지(hoist) 않는 패키지 매니저에서는 `@oa-sdk/codegen`만 설치하면 `import-not-found`로 실패하므로, `.tsp`가 import하는 라이브러리를 프로젝트의 직접 개발 의존성으로 둡니다.

```bash
npm install --save-dev @oa-sdk/codegen @oa-sdk/typespec-decorators@^0.3.0 \
  @typespec/compiler@^1.16.0 @typespec/http@^1.16.0 @typespec/openapi@^1.16.0
```

- `@typespec/compiler`는 `tsp` CLI와 IDE 확장이 쓰며, 버전은 codegen과 같은 `^1.16.0`입니다.
- 표준 계약(`Ok`, `Created`, `NoContent`, `PageResult`, `ErrorResponse`, `StandardHttpErrors`)은 `@oa-sdk/typespec-decorators` 0.3.0부터 있으며, `import "@oa-sdk/typespec-decorators";`와 `using OaSdkTypeSpec;`으로 씁니다. 0.3.0은 `@oa-sdk/codegen` 0.9.0 릴리스부터 npm에서 제공됩니다.
- `.tsp` 작성 규칙과 데코레이터는 [TypeSpec 데코레이터 레퍼런스](./typespec/03-decorators-reference.md)를 따릅니다.

---

## 3. 로컬 설치 권장 vs 전역 설치 안티패턴

`@oa-sdk` 팀은 CLI를 전역(`npm install -g @oa-sdk/codegen`)으로 설치하지 않고, 각 프로젝트의 **로컬 `devDependencies`로 설치하여 관리하는 방식을 강력히 권장**합니다.

### 로컬 devDependencies 설치의 이점
1. **버전 차이 방지**: 프로젝트의 락파일(`package-lock.json`, `pnpm-lock.yaml`)에 CLI 버전이 고정되어, 모든 팀원과 CI/CD 파이프라인이 같은 코드젠 엔진과 검증 규칙을 사용합니다.
2. **다중 프로젝트 격리**: 서로 다른 OpenAPI 사양 버전이나 설정 체계를 사용하는 복수의 저장소 간 충돌을 방지합니다.
3. **CI/CD 재현성 보장**: 추가적인 전역 설치 단계 없이 `pnpm install` 또는 `npm ci` 직후 즉시 스크립트 실행이 가능합니다.

### 로컬 CLI 실행 방법
로컬에 설치된 `oa-gen`은 다음 명령을 통해 즉시 실행할 수 있습니다:

```bash
# npx를 통한 실행
npx oa-gen --help

# pnpm 환경
pnpm exec oa-gen --help

# yarn 환경
yarn oa-gen --help
```

### `package.json` 스크립트
`oa-gen init`은 다음 스크립트를 `package.json`에 추가합니다(이미 있는 이름은 `--force` 없이는 바꾸지 않습니다). 추가하는 스크립트는 모두 쓰인 그대로 스캐폴드에서 실행됩니다.

| 스크립트 | 추가하는 경우 | 명령 | 동작 |
|---|---|---|---|
| `generate` | 모든 대상 | `oa-gen generate` | `oa.config.ts`에 선언한 산출물(OpenAPI 문서, 핸들러 계약, 클라이언트 SDK, TanStack Query 키·옵션) 일괄 생성. 라우터 파일은 만들지 않습니다. |
| `mock` | 모든 대상 | `oa-gen mock --watch` | `oa.config.ts`의 spec target(하나일 때)을 mock 서버로 서빙 |
| `validate` | `mvp` 아키타입 | `oa-gen validate` | `oa.config.ts`의 모든 spec target 검증 |
| `lint:spec`, `diff`, `baseline:update`, `ci:gate` | `enterprise` 아키타입 | `oa-gen lint`, `oa-gen diff`, `oa-gen normalize`, `oa-gen validate`(스펙 진입점과 계약 기준선 `openapi.baseline.yaml` 대상) | 스펙 린트와 기준선 대비 breaking change gate. [CLI 명령 레퍼런스](./cli-command-reference.md#enterprise의-breaking-change-gate) |

Bun 런타임 대상(elysia)에서는 `oa-gen` 대신 `bun x oa-gen`을 씁니다. 프레임워크 대상은 개발 서버 스크립트(fastify `dev: tsx watch src/server.ts`와 `build: tsc`, express `tsx watch src/app.ts`, hono `tsx watch src/index.ts`, elysia `bun --watch src/index.ts`, nestjs `start:dev: nest start --watch`)와 프레임워크 의존성도 추가하지만, 서버 진입 파일과 `tsconfig.json`은 만들지 않으므로 이 스크립트는 직접 작성한 서버 코드가 있어야 실행됩니다. Fastify·Express·Hono·Elysia 라우터 코드는 빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter()`로 씁니다.

이전 버전의 `init`이 추가한 `generate:router`·`generate:client`·`generate:contract`(`oa-gen generate`와 같은 일만 함)와 `test:contract`·`audit:wire`·`audit:csp`·`audit:shape`·`personas:check`(그대로는 동작하지 않음)는 지금의 `init`이 추가하지 않습니다. `init --force`도 이 스크립트를 지우지 않으므로 `package.json`에서 직접 지웁니다([CLI 명령 레퍼런스](./cli-command-reference.md#아키타입---archetype)).

`init`을 쓰지 않는 프로젝트는 같은 이름으로 직접 등록합니다.

```json
{
  "scripts": {
    "generate": "oa-gen generate",
    "validate": "oa-gen validate",
    "mock": "oa-gen mock --watch",
    "check:artifact": "oa-gen check-artifact"
  }
}
```

`oa-gen validate`와 `oa-gen mock`은 경로 옵션 없이 실행하면 `oa.config.ts`의 spec target을 사용합니다. `validate`는 모든 target을 검증하고, `mock`은 target이 하나일 때 그 스펙을 서빙합니다(여러 개면 `--spec` 또는 `--tsp`로 지정). `oa.config.ts`는 ES module로 작성되며, `package.json`이 `"type": "commonjs"`인 프로젝트(npm 11의 `npm init` 기본값)에서도 `oa-gen`이 ES module로 변환해 불러옵니다.

---

## 4. 설치 없이 일회성 실행 (npx Ephemeral Execution)

프로젝트에 설치하기 전에 온보딩을 실행하거나 일회성 검증을 할 때는 `npx`로 실행할 수 있습니다.

```bash
# 대화형 온보딩 (프레임워크 감지 및 oa.config.ts 생성)
npx @oa-sdk/codegen init

# 비대화형(Headless) 온보딩 (기본값 자동 수락)
npx @oa-sdk/codegen init --yes

# 기존 OpenAPI 사양 검증
npx @oa-sdk/codegen validate --spec ./openapi.yaml --require-32

# mock 서버 구동 (포트 4010, 동반 패키지 @oa-sdk/mock-server 포함)
npx -p @oa-sdk/codegen -p @oa-sdk/mock-server oa-gen mock --spec ./openapi.yaml --watch --port 4010
```

---

## 5. 설치 검증 (Installation Verification)

설치가 완료되면 CLI 전체 명령 및 사용 가능한 서브커맨드 목록을 확인합니다.

```bash
# 전체 명령 및 옵션 도움말 출력
npx oa-gen --help
```

---

## 6. 계층적 상향 프로젝트 루트 탐색 (6-Tier Project Root Resolution)

`oa-gen` CLI는 모노레포의 깊은 하위 디렉터리나 Git 서브모듈 내부에서 호출되더라도, 상향 디렉터리 순회(Upward Traversal)를 통해 최상위 프로젝트 루트를 자동으로 식별합니다.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    프로젝트 루트 식별 6단계 우선순위 (6 Tiers)               │
├───────────────────────────────────────────────────────────────────────────┤
│ Tier 1. CLI 명시 옵션: --project-root <dir> 또는 --root <dir>              │
│    ⬇ (미지정 시)                                                          │
│ Tier 2. 환경 변수: process.env.OA_PROJECT_ROOT                            │
│    ⬇ (미설정 또는 공백 시)                                                 │
│ Tier 3. 스펙 설정 파일: oa.config.ts, oa.config.mjs, oa.config.json,      │
│         .oarc.json                                                        │
│    ⬇ (조상 디렉터리 탐색 후 미발견 시)                                      │
│ Tier 4. 모노레포 워크스페이스 마커: pnpm-workspace.yaml, turbo.json,       │
│         lerna.json, package.json (workspaces 필드 선언)                   │
│    ⬇ (미발견 시)                                                          │
│ Tier 5. 형상 관리(VCS) 마커: .git 디렉터리 또는 .git 서브모듈 포인터 파일   │
│    ⬇ (미발견 시)                                                          │
│ Tier 6. 최종 Fallback: process.cwd()                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 전역 `--root` 플래그 활용
특정 하위 패키지나 외부 경로를 기준으로 CLI 파이프라인을 실행해야 하는 경우 전역 플래그를 전달할 수 있습니다:

```bash
npx oa-gen generate --root ./apps/web-service
```

---

## 7. oa-sdk 모노레포 자체 기여자 안내

이 가이드는 다른 프로젝트에서 `oa-sdk` 공개 패키지를 쓰는 사용자를 위한 것입니다.

`oa-sdk` 소스 모노레포(비공개) 자체에 기여하거나, TypeSpec 프로덕션 계약을 직접 수정·승인하고, 내부 통합 빌드(`pnpm build:core`, `pnpm build:downstream`)를 실행하려는 기여자는 Node.js 24 이상과 pnpm 10.30.3이 필요합니다. 저장소 루트에서는 `oa-gen`이 PATH에 없으므로 `pnpm --filter @oa-sdk/codegen build` 후 `node packages/codegen/dist/cli/index.js <명령>`으로 실행합니다. 자세한 내용은 다음 문서를 참고하세요:

👉 [oa-sdk 모노레포 기여자 온보딩 가이드](./onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩)

---

## 8. 다음 단계 (Next Steps)

- **빠른 시작**: [Quick Start](./quick-start.md) — 설치부터 검증·생성·mock 서버까지 한 프로젝트에서 실행
- **점진적 도입 전략**: [프로젝트 온보딩 플레이북](./onboarding-playbook.md) — 단계별 도입 순서와 Fastify, Express, Hono, Elysia, NestJS 연결 레시피
- **선언적 설정**: [선언적 사양 설정 가이드 (oa.config.ts)](./declarative-spec-configuration.md) — 이중 계층 아키텍처, 아키타입, `outputRouting` 상세
- **CLI 전체 명령어 색인**: [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 서브커맨드 및 조건부 옵션 규격
