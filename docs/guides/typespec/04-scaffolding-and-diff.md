---
docType: guide
sourceLocale: ko
canonical: true
audience:
  competence: intermediate
productVersions:
  - "@oa-sdk/codegen 0.9.0"
owner: "OA SDK maintainers"
status: active
---

# TypeSpec 스캐폴딩 및 Semantic Diff 도구 활용법 (Scaffolding & Diff CLI)

이 문서는 `oa-gen`의 TypeSpec 명령으로 `.tsp` 코드를 만들고, breaking change를 미리 검사하고, mock 서버와 생성 명령으로 결과를 확인하는 방법을 안내합니다. 이 문서는 `@oa-sdk/codegen` 0.9.0 기준입니다.

| 절 | 대상 | 실행 형태 |
|---|---|---|
| 1~4.3 | `@oa-sdk/codegen`을 설치한 모든 프로젝트 | `npx oa-gen <명령>` (설치는 [Quick Start](../quick-start.md)) |
| 4.4, 5 | oa-sdk 저장소 기여자 | 저장소 루트에서 `node packages/codegen/dist/cli/index.js <명령>` (`oa-gen`은 PATH에 없음) |

옵션의 정확한 형식은 `oa-gen <명령> --help`가 정본입니다.

---

## 1. TypeSpec 코드 스캐폴딩 (`oa-gen tsp-scaffold`)

엔드포인트와 DTO 모델의 뼈대 코드를 만듭니다. `oa-gen tsp scaffold`(공백 구분)도 같은 명령입니다.

### 1.1 옵션
| 옵션 | 단축키 | 필수 | 설명 |
|---|---|---|---|
| `--route <path>` | `-r` | **Y** | HTTP 경로 (예: `/articles/{id}`) |
| `--method <method>` | `-m` | N | `get`, `post`, `put`, `patch`, `delete` (기본값 `get`) |
| `--operation-id <id>` | | N | operationId (기본값: 경로와 메서드에서 유추) |
| `--domain <name>` | `-d` | N | `@tag` 값 (기본값: 경로의 첫 세그먼트) |
| `--summary <text>` | | N | `@summary`와 `@doc` 문구 |
| `--auth <scheme>` | | N | `@useAuth(<scheme>)`에 넣을 인증 모델 이름 (기본값 `bearerAuth`). `none`이면 `@useAuth`를 넣지 않음 |
| `--crud` | | N | 목록·단건·생성·수정(`PUT`)·삭제 5개 operation과 DTO를 한 번에 생성 |
| `--envelope` | | N | 응답을 `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`로 감쌈. 없으면 operation별 `*200Response` 같은 응답 모델을 생성 |
| `--resource <name>` | | N | `--crud`의 엔티티 이름 (기본값: 경로에서 유추) |
| `--file <path>` | `-f` | N | **이미 있는** `.tsp` 파일 끝에 덧붙임. 파일이 없으면 `Target TypeSpec file not found`로 실패 |
| `--output <path>` | `-o` | N | 파일에 씀. 새 파일이면 머리말을 붙이고, **이미 있는 파일이면 내용을 스캐폴드 코드로 덮어씀**. `-`이면 stdout |

`--file`과 `--output`이 모두 없으면 stdout에 출력합니다. 생성 코드의 모든 operation에는 `@oaUseResponseComponent("400" | "401" | "404", ...)` 줄이 들어갑니다(1.3 참고).

### 1.2 예제

```bash
# 이미 있는 모듈에 CRUD 5개 operation 추가
npx oa-gen tsp-scaffold --route /products --crud --envelope --file ./src/api/products.tsp

# 단일 POST 엔드포인트를 stdout으로 출력
npx oa-gen tsp-scaffold --route /articles --method post --operation-id createArticle --summary "게시글 등록"

# 인증 없는 공개 엔드포인트
npx oa-gen tsp-scaffold --route /public/stats --method get --auth none --summary "공개 통계 조회"

# 새 파일로 생성
npx oa-gen tsp-scaffold --route /orders --crud --envelope --output ./src/features/orders/orders.tsp
```

oa-sdk 저장소의 production 번들에 추가하는 절차는 [TypeSpec 5분 퀵스타트](./01-quickstart-5min.md)에 있습니다.

### 1.3 생성 코드를 컴파일되는 파일로 만들기

스캐폴드 결과는 그대로 컴파일되지 않습니다. `--output`이 새 파일에 붙이는 머리말은 `@typespec/http`·`@typespec/openapi` import와 (`--envelope`이면) 로컬 `Ok`/`Created`/`NoContent`/`PageResult` 템플릿뿐이어서, 그대로 `tsp compile`하면 `Unknown decorator @oaUseResponseComponent`와 `Unknown identifier bearerAuth`로 실패합니다. 위 마지막 예제의 `orders.tsp`는 다음처럼 머리말을 고치면 컴파일되고 `oa-gen validate --require-32`도 통과합니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

@service(#{ title: "Orders" })
namespace OrdersApi;

model bearerAuth is BearerAuth;

// 아래는 스캐폴드가 만든 템플릿, 모델, operation 그대로
```

- `@oa-sdk/typespec-decorators`와 `@typespec/*`는 프로젝트에 직접 설치합니다([설치 안내](../../../packages/typespec-decorators/README.md#install)).
- 인증이 없는 API면 `--auth none`으로 생성하고 `bearerAuth` 모델을 두지 않습니다.
- `--file`로 덧붙일 때는 대상 파일이 이미 이 머리말과 namespace를 갖추고 있어야 합니다.

`@oaUseResponseComponent`는 참조만 기록합니다. `oa-gen`의 메모리 컴파일(`oa-gen mock --tsp`, `.tsp`를 넣은 `generate`·`typegen`·`validate`)에서는 확장만 남고 4xx 응답이 생기지 않습니다. 확인한 출력은 operation마다 `200`·`201`·`204` 응답 하나와 `x-oa-sdk-operation-component-refs` 확장이었습니다. 외부 프로젝트에서 4xx 응답을 선언할 때는 반환 타입에 `ErrorResponse<Status>`나 `StandardHttpErrors`를 씁니다(예: `Ok<Order> | ErrorResponse<404>`). `@oaUseResponseComponent`는 이 저장소의 bundle restore 경로에서만 응답으로 바뀝니다.

---

## 2. TypeSpec Semantic Diff (`oa-gen tsp diff`)

두 TypeSpec 원본을 컴파일해 AST 단위로 비교하고 breaking change를 분류합니다.

### 2.1 옵션
| 옵션 | 필수 | 설명 |
|---|---|---|
| `--base <ref>` | **Y** | 기준 쪽. `.tsp` 파일, 디렉터리(`main.tsp` 또는 `tspconfig.yaml`이 있는), git ref(`main`, `origin/main`, `HEAD~1`), `ref:path` |
| `--head <ref>` | **Y** | 비교 대상. 파일 경로, 디렉터리, git ref(`HEAD`, 커밋 해시), `ref:path` |
| `--fail-on-breaking` | N | breaking change가 있으면 종료 코드 1 |
| `--format <type>` | N | `markdown`(기본값) 또는 `json` |

값이 실제 경로이면 경로로 읽고(상대 경로는 명령을 실행한 디렉터리부터 찾음), 아니면 git ref로 보고 `git archive`로 그 커밋을 임시 디렉터리에 꺼냅니다. 그래서 git ref는 작업 트리가 아니라 **커밋된 내용**입니다. `ref:path`의 `path`는 저장소 루트 기준입니다. 커밋 안의 진입점이 그 커밋에 들어 있는 심볼릭 링크(절대 경로 링크 등)를 따라 커밋 밖으로 나가면, 커밋에 없는 파일을 읽지 않고 `<ref>:<path>`를 달라는 오류로 끝납니다.

경로 없이 git ref만 주면(`--base origin/main`, `--head HEAD`) 진입점을 다음 순서로 정합니다.

1. 상대편의 진입점이 저장소 안에 있으면(파일·디렉터리 경로, `ref:path`, 먼저 정해진 base 진입점) 같은 저장소 루트 기준 경로를 이 ref의 커밋에서 읽습니다. `--base origin/main --head HEAD`이면 head는 base가 찾은 진입점과 같은 경로를 `HEAD` 커밋에서 꺼냅니다. 그 경로가 이 커밋에 없으면(파일을 옮긴 경우 등) 다른 파일을 추측하지 않고 `<ref>:<path>`를 달라는 오류(종료 코드 1)로 끝납니다. 작업 트리 경로가 저장소 안의 심볼릭 링크를 지나면 링크 이름을 그대로 씁니다. `current -> v1` 링크가 있을 때 `--head ./current/main.tsp`는 `current/main.tsp`가 되므로, 이 ref의 커밋에서 `current`가 가리키던 대상을 읽습니다. 저장소 밖으로 나가는 링크를 지나 저장소 밖 파일에 닿는 경로는 저장소 밖 경로로 봅니다.
2. 그렇지 않으면 `packages/schemas/typespec/main.tsp`, `packages/schemas/typespec`, `main.tsp` 순서로 찾고, 셋 다 없으면 커밋 안에 `main.tsp`가 하나뿐일 때만 그것을 씁니다. `main.tsp`가 여러 개면 후보 목록과 함께 `<ref>:<path>`를 달라는 오류로 끝납니다.

`--base`와 `--head`가 같은 커밋의 같은 진입점이 되면(`--base HEAD --head HEAD`) 같은 내용끼리 비교하므로 결과는 늘 `No semantic changes detected`입니다. 이때는 stderr에 그 사실과 작업 트리 경로를 `--head`에 주라는 안내를 출력합니다(`--format json`의 stdout은 그대로 JSON). 커밋하지 않은 수정까지 보려면 `--head`에 파일 경로를 줍니다.

판정 기준은 의미 단위입니다. 선택 속성 추가(`property-added`)와 operation 추가(`operation-added`)는 non-breaking, 필수 속성 추가(`required-property-added`)는 breaking입니다. 두 OpenAPI 파일을 비교하는 `oa-gen diff`는 요청·응답·파라미터 스키마가 바뀌면 선택 필드 추가도 breaking으로 보는 보수적 규칙이고 git ref를 받지 않습니다.

### 2.2 예제

```bash
# 커밋 전 작업 트리를 base 브랜치와 비교 (head에 파일 경로)
npx oa-gen tsp diff --base origin/main:main.tsp --head ./main.tsp --fail-on-breaking

# 두 커밋 비교 (양쪽 모두 ref:path)
npx oa-gen tsp diff --base HEAD~1:main.tsp --head HEAD:main.tsp

# 두 커밋 비교 (경로 없는 ref: head는 base가 찾은 진입점과 같은 경로를 HEAD 커밋에서 읽음)
npx oa-gen tsp diff --base origin/main --head HEAD --fail-on-breaking

# CI: checkout한 작업 트리가 PR head이므로 head에 파일 경로를 주고 JSON 리포트 저장
npx oa-gen tsp diff --base origin/main:main.tsp --head ./main.tsp --format json > diff-report.json
```

CI에서는 base 브랜치 ref가 있어야 합니다. GitHub Actions라면 `actions/checkout`에 `fetch-depth: 0`을 주어 `origin/main`까지 받아 둡니다.

---

## 3. 메모리 컴파일 mock 서버 (`oa-gen mock --tsp`)

OpenAPI 파일을 디스크에 쓰지 않고 `.tsp`를 메모리에서 컴파일해 mock 서버를 띄웁니다.

```bash
npx oa-gen mock --tsp ./main.tsp --watch
```

- 기본 주소는 `http://127.0.0.1:4010`이고 `--port`, `--host`로 바꿉니다.
- `--watch`를 주면 원본이 바뀔 때 서버를 재시작하지 않고 route를 교체합니다.
- 요청은 파라미터·본문·보안 요구사항으로 검증해 잘못되면 422, 인증 정보가 없으면 401로 답합니다.
- `oa-gen mock`은 동반 패키지(companion package) `@oa-sdk/mock-server`가 필요합니다. 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다([동반 패키지](../cli-setup.md#동반-패키지-companion-packages)).

옵션 전체는 [Mock 서버 사용법](../mock-server-usage.md)을 봅니다.

---

## 4. `.tsp` 수정 후 생성물 다시 만들기

`.tsp`에서 OpenAPI, JSON Schema, 타입, 핸들러 계약, 클라이언트, TanStack Query 코드, 타입 가드를 다시 만드는 경로는 네 가지입니다.

| 경로 | 방식 | 명령 | 언제 쓰는가 |
|---|---|---|---|
| **경로 1** | 설정 기반 일괄 생성 | `oa-gen generate` | `oa.config.ts`의 spec target 전체를 갱신할 때 |
| **경로 2** | 설정 없이 한 스펙 일괄 생성 | `oa-gen generate --spec <path.tsp> --out-dir <dir>` | 설정 파일 없이 한 스펙의 생성물을 한 폴더에 만들 때 |
| **경로 3** | 생성물별 명령 | `oa-gen <subcommand> --spec <path.tsp>` | 클라이언트, Zod, 타입 등 하나만 갱신할 때 |
| **경로 4** | 저장소 계약 승인 | `pnpm schema:approve-typespec-reference -- --write` 등 | oa-sdk 저장소의 `packages/schemas/typespec/`를 고쳤을 때 |

핸들러 계약(`<id>.contract.ts`)은 `@oa-sdk/router`, 클라이언트·TanStack Query 코드는 `@oa-sdk/client`가 만듭니다. 이 동반 패키지가 없을 때 경로 1·2는 설정에서 명시적으로 켠 생성물(`core.contracts.pureHandlers: true`, `core.client.enabled: true`)이면 종료 코드 1로 실패하고, 기본값으로만 켜진 생성물은 경고와 설치 명령을 남기고 건너뜁니다. `generate:client`, `generate:tanstack`은 `@oa-sdk/client`가 없으면 실패합니다. 자세한 동작은 [동반 패키지](../cli-setup.md#동반-패키지-companion-packages)를 봅니다.

---

### 4.1 경로 1: `oa.config.ts` 기반 일괄 생성

`oa.config.ts`의 `specs`에 `.tsp`를 `schemaEntry`로 선언하면 인자 없이 `oa-gen generate`로 전체를 만듭니다.

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  product: {
    specs: [
      {
        id: "main-api",
        profile: "full-api-document",
        schemaEntry: "./main.tsp",
        outDir: "dist/specs",
      },
    ],
    outputRouting: {
      pattern: "src/api/{tag}/{tag}.{kind}.ts",
    },
  },
});
```

```bash
npx oa-gen generate
```

**생성물**:
- `dist/specs/main-api.openapi.json` (OpenAPI 3.2.0 문서. 실행 요약에도 `OpenAPI 3.2.0`으로 표시)
- `dist/specs/main-api.schema.json` (JSON Schema 2020-12, `$defs`)
- `src/api/main-api/main-api.contract.ts` (프레임워크와 무관한 핸들러 계약)
- `src/api/main-api/main-api.client.ts` (fetch 클라이언트, 런타임 의존성 없음)
- `src/api/main-api/main-api.keys.ts` (TanStack Query 키)
- `src/api/main-api/main-api.queries.ts` (TanStack Query 옵션. `outputRouting`이 있으면 훅은 쓰지 않음)

`{tag}`는 OpenAPI tag가 아니라 **spec target id**로 바뀝니다. spec target 하나에서 도메인별 폴더가 나오지 않으므로, 폴더를 나누려면 spec target을 나눕니다([토폴로지 가이드](./06-generation-topologies-and-rules.md)).

`oa-gen generate`는 `.oa-manifest.json`에 기록된 생성 파일 중 같은 설정 파일로 실행한 `oa-gen generate`가 만들었던 파일 가운데 이번 실행이 만들지 않고 내용도 바뀌지 않은 파일을 지웁니다. `oa-gen generate:tanstack` 등 다른 명령이 쓴 파일은 지우지 않고, `outputRouting.pruneOrphans: false`면 아무 파일도 지우지 않습니다([생성 파일 정리](../declarative-spec-configuration.md#45-생성-파일-정리)).

---

### 4.2 경로 2: 설정 없이 한 스펙 일괄 생성

```bash
npx oa-gen generate --spec ./main.tsp --out-dir ./dist
```

spec target id는 파일 이름(`main`)이 되고, `./dist`에 다음이 생깁니다. `.oa-manifest.json`은 프로젝트 루트에 쓰입니다. 이 경로의 실행은 설정 파일이 없으므로 이전 `--spec` 실행이 같은 스펙 파일(`main.tsp`)로 기록한 파일만 정리하고, 4.1의 설정 파일 실행이 쓴 파일은 지우지 않습니다.

- `main.openapi.json` (OpenAPI 3.2)
- `main.schema.json` (JSON Schema 2020-12)
- `main.contract.ts` (핸들러 계약)
- `main.client.ts` (fetch 클라이언트)
- `main.queries.ts` (TanStack Query 키·옵션·훅 한 파일)

`--split`은 이 경로의 출력을 나누지 않습니다. 타입 가드 생성에만 쓰는 옵션입니다.

---

### 4.3 경로 3: 생성물별 명령

각 명령에 `.tsp` 경로를 직접 줄 수 있습니다. CLI가 메모리에서 컴파일하므로 OpenAPI 파일을 먼저 만들 필요가 없습니다.

#### (1) fetch 클라이언트 (`generate:client`)
```bash
# 소스 파일 하나 생성
npx oa-gen generate:client --spec ./main.tsp --output src/api/client.ts

# 배포용 패키지(src/, dist/, package.json, README.md) 생성
npx oa-gen generate:client --spec ./main.tsp --pack --output packages/api-client --name @my-org/api-client
```

#### (2) TypeScript 타입 (`typegen`)
```bash
npx oa-gen typegen --spec ./main.tsp --output src/api/types.ts
```
`--incremental`을 주면 입력·옵션·출력이 그대로인 대상의 재생성을 건너뜁니다(색인 위치 `--cache-dir`, 기본값 `./.oa-cache`). 입력 판정 규칙은 [CLI 명령 레퍼런스](../cli-command-reference.md)를 봅니다.

#### (3) Zod 4 스키마 (`generate:zod`)
```bash
npx oa-gen generate:zod --spec ./main.tsp --output src/api/api.zod.ts
```

#### (4) TanStack Query v5 (`generate:tanstack`)
`--output`은 디렉터리이고, 그 안에 `tanstack-query.ts`를 씁니다. 이 파일은 같은 디렉터리의 `./client.js`를 import하므로 (1)의 클라이언트를 같은 디렉터리에 둡니다.
```bash
# 키·옵션·훅 3계층을 src/api/tanstack-query.ts 한 파일에 생성 (@tanstack/react-query)
npx oa-gen generate:tanstack --spec ./main.tsp --output src/api

# 키 팩토리만 생성 (프레임워크 import 없음)
npx oa-gen generate:tanstack --spec ./main.tsp --output src/api --tier keys
```
`tsc`를 통과하는 출력은 기본값(3계층, React)과 `--tier keys`뿐입니다. 나머지 옵션 조합에는 알려진 결함이 있습니다.

- `--tier options`, `--tier hooks`: 한 파일만 쓰면서 이 명령이 쓰지 않는 `./keys.js`(`hooks`는 `./queries.js`도)를 import하므로 `tsc`가 TS2307로 실패합니다. 훅 없는 옵션 파일이 필요하면 `outputRouting`을 둔 `oa-gen generate`가 쓰는 `<id>.keys.ts`와 `<id>.queries.ts`를 씁니다([4.1](#41-경로-1-oaconfigts-기반-일괄-생성)).
- `--framework vue`, `--framework svelte`: import 경로만 `@tanstack/vue-query`·`@tanstack/svelte-query`로 바꾸고 React용 이름(`UndefinedInitialDataOptions`, `UseMutationOptions`, `mutationOptions` 등)을 그대로 import합니다. 그 패키지에 없는 이름이라 `tsc`가 TS2724로 실패합니다. Vue·Svelte 프로젝트는 `--tier keys`로 키만 생성하고 쿼리 옵션은 직접 작성합니다. `oa-gen generate`를 쓰는 프로젝트라면 4.1의 정리 규칙 때문에 `generate:tanstack` 출력 대신 `outputRouting`을 둔 `oa-gen generate`의 `<id>.keys.ts`를 씁니다.

훅까지 담은 한 파일 출력(`tanstack-query.ts`, `outputRouting` 없는 `oa-gen generate`의 `<id>.queries.ts`)은 맨 앞에 `'use client'` 지시문이 있습니다. React Server Component에서 옵션 팩토리를 호출하려면 지시문이 없는 파일, 즉 `outputRouting`을 둔 `oa-gen generate`의 `<id>.queries.ts`를 import합니다.

`generate:tanstack --types-import`에는 `oa-gen typegen` 출력을 그대로 넘깁니다. 클라이언트와 TanStack에 같은 모듈을 넘기면 `--split`을 포함해 `tsc`를 통과합니다. `<Operation>ClientError`는 클라이언트가 스스로 선언하므로 typegen 출력에 없어도 됩니다. TanStack에만 생략하면 typed 클라이언트와 파라미터 타입이 맞지 않아 `TS2345`가 나므로, 둘 다 같은 모듈을 넘깁니다.

#### (5) 런타임 의존성 없는 타입 가드 (`generate:guards`)
Chrome Extension Manifest V3처럼 CSP가 엄격한 환경용입니다.
```bash
npx oa-gen generate:guards --input ./main.tsp --out-dir src/guards --split
```
`@oa-sdk/typespec-decorators`의 에러 계약(`ErrorResponse<Status>`, `StandardHttpErrors`)을 쓰는 스펙은 컴포넌트 이름에 점이 들어가(`OaSdkTypeSpec.StandardError`) `invalid export name` 오류로 실패합니다(알려진 결함). 이때는 `--schemas User,CreateUserRequest`처럼 가드를 만들 컴포넌트를 지정합니다.

#### (6) 검증과 린트 (`validate` / `lint`)
```bash
npx oa-gen validate --spec ./main.tsp --require-32
npx oa-gen lint --spec ./main.tsp
```

---

### 4.4 경로 4: oa-sdk 저장소 계약 승인

oa-sdk 저장소의 `packages/schemas/typespec/main.tsp`와 그 모듈을 고쳤다면 저장소 스크립트로 승인 스냅샷을 갱신하고 gate를 실행합니다.

```bash
pnpm schema:approve-typespec-reference
pnpm schema:approve-typespec-reference -- --write
pnpm schema:validate
pnpm schema:downstream-check
```

각 단계의 의미와 리뷰 기준은 [계약 변경 절차](../typespec-authoring-conventions.md#7-계약-변경-절차-contract-change-workflow)가 정본입니다.

---

## 5. 번들 검증 및 복원 도구

저장소의 정적 검증 파이프라인이 쓰는 저수준 명령입니다. 공백 구분 이름(`oa-gen tsp bundle-check` 등)도 같은 명령입니다.

- **`oa-gen tsp-bundle-check`**: `oa-sdk.typespec-bundle.json` manifest가 가리키는 번들을 컴파일하고, v5 확장을 복원하고, 검증과 기대 스냅샷 비교를 합니다. `pnpm schema:typespec-check`와 승인 명령이 같은 경로를 씁니다.
- **`oa-gen tsp-restore`**: TypeSpec이 출력한 OpenAPI에 compatibility sidecar를 적용합니다.
- **`oa-gen tsp-export`**: 기존 OpenAPI 문서에서 `.tsp` 초안과 진단을 만듭니다.

---

## 다음 단계
- [TypeSpec 5분 퀵스타트 (저장소 기여자용)](./01-quickstart-5min.md)
- [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)
- [TypeSpec 데코레이터 레퍼런스](./03-decorators-reference.md)
- [트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
- [생성물 배치 토폴로지와 아키텍처 규칙](./06-generation-topologies-and-rules.md)
