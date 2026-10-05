---
docType: tutorial
sourceLocale: ko
canonical: true
audience:
  competence: intermediate
productVersions:
  - "@oa-sdk/codegen 0.9.0"
  - "@oa-sdk/typespec-decorators 0.3.0"
tested:
  environment: "Node.js 24.19, pnpm 10.30.3, oa-sdk 저장소 f5e757ac"
  at: "2026-10-06"
  # 0~6단계를 순서대로 실행했다. 2단계의 응답 정리 전에는 승인 명령이
  # `compatibilitySidecar, provenance`로 실패했고, 정리 후에는 승인(--write),
  # schema:typespec-check, schema:downstream-check가 모두 통과했다. 4단계 mock은
  # 인증 헤더 없이 401, 헤더가 있으면 GET /articles 200 {"items":[],"total":0}였다.
  # 확인 후 변경은 되돌렸다.
  owner: "OA SDK maintainers"
  reviewDue: "2026-12-10"
  status: active
---

# TypeSpec 5분 퀵스타트 (oa-sdk 저장소 기여자용)

> 이 문서는 oa-sdk 저장소의 production 계약(`packages/schemas/typespec/`)에 엔드포인트를 추가하는 기여자용입니다. 다른 프로젝트에서 oa-sdk를 쓰려면 [Quick Start](../quick-start.md)를 따르고, `.tsp`를 원본으로 쓸 때 설치할 패키지는 [`@oa-sdk/typespec-decorators` README](../../../packages/typespec-decorators/README.md#install)를 봅니다.

`/articles` CRUD 엔드포인트를 production 번들에 추가하고, mock 서버로 확인하고, breaking change를 검사하고, 승인 스냅샷을 갱신합니다. 각 단계의 규칙은 [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)이 정본입니다.

---

## 0. 준비

이 저장소를 빌드·테스트하려면 Node.js 24 이상과 pnpm 10.30.3이 필요합니다. 저장소 루트에서 의존성을 설치하고 CLI와 동반 패키지를 빌드합니다. `oa-gen mock`은 빌드된 `@oa-sdk/mock-server`를 불러옵니다.

```bash
pnpm install --frozen-lockfile
pnpm build:core
pnpm build:downstream
```

저장소 루트에서는 `oa-gen`이 PATH에 없습니다. 이 문서는 빌드한 CLI를 `node packages/codegen/dist/cli/index.js <명령>`으로 실행합니다. 편집기 설정은 [TypeSpec IDE 설정](../typespec-ide-setup.md)을 봅니다.

---

## 1. 모듈 파일 만들기

`oa-gen tsp-scaffold --file`은 이미 있는 파일 끝에 코드를 덧붙이므로, 파일이 없으면 `Target TypeSpec file not found`로 실패합니다. 먼저 `packages/schemas/typespec/articles.tsp`를 기존 모듈과 같은 머리말로 만듭니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

namespace OaSdkApi;
```

`namespace OaSdkApi;`가 없으면 operation이 서비스 namespace 밖에 놓여 번들에 나오지 않습니다. 각 줄이 필요한 이유는 [새 도메인 모듈의 머리말](../typespec-authoring-conventions.md#11-새-도메인-모듈의-머리말)에 있습니다.

---

## 2. CRUD 스캐폴딩과 응답 정리

```bash
node packages/codegen/dist/cli/index.js tsp-scaffold --route /articles --crud --envelope --file packages/schemas/typespec/articles.tsp
```

파일에 다음이 추가됩니다.

- 모델: `Article`(`id`, `createdAt`, `updatedAt?`), `CreateArticleRequest`, `UpdateArticleRequest`(필드는 `TODO` 주석으로 비어 있음)
- operation: `listArticles`(`GET /articles`), `getArticleById`(`GET /articles/{id}`), `createArticle`(`POST /articles`), `updateArticle`(`PUT /articles/{id}`), `deleteArticle`(`DELETE /articles/{id}`)
- 모든 operation에 `@useAuth(bearerAuth)`와 `@oaUseResponseComponent(...)` 줄

스캐폴드는 `@oaUseResponseComponent`를 넣지만 반환 타입에는 성공 응답만 둡니다. 이대로 두면 6단계 승인이 `cannot approve TypeSpec snapshot: compatibilitySidecar, provenance`로 실패합니다. 재사용 응답 컴포넌트를 쓰려면 반환 타입의 상태 응답과 응답 예제 확장도 함께 있어야 하기 때문입니다([재사용 응답 컴포넌트에 연결하기](../typespec-authoring-conventions.md#31-재사용-응답-컴포넌트에-연결하기)). 이 퀵스타트에서는 `@oaUseResponseComponent` 줄을 모두 지우고, 같은 상태를 반환 타입에 `ErrorResponse<Status>`로 선언합니다.

| operation | 정리한 반환 타입 |
|---|---|
| `listArticles` | `Ok<PageResult<Article>> \| ErrorResponse<400> \| ErrorResponse<401>` |
| `getArticleById` | `Ok<Article> \| ErrorResponse<401> \| ErrorResponse<404>` |
| `createArticle` | `Created<Article> \| ErrorResponse<400> \| ErrorResponse<401>` |
| `updateArticle` | `Ok<Article> \| ErrorResponse<400> \| ErrorResponse<401> \| ErrorResponse<404>` |
| `deleteArticle` | `NoContent \| ErrorResponse<401> \| ErrorResponse<404>` |

`CreateArticleRequest`와 `UpdateArticleRequest`의 `TODO` 자리에는 실제 필드를 채웁니다. 비워 두어도 컴파일과 승인은 통과합니다.

단일 엔드포인트는 `--crud` 없이 만듭니다. `--file`이나 `--output`이 없으면 코드를 stdout에 출력합니다.

```bash
node packages/codegen/dist/cli/index.js tsp-scaffold --route /articles/{id}/audit --method get --summary "게시글 감사 로그 조회"
```

옵션 전체는 [스캐폴딩 가이드](./04-scaffolding-and-diff.md#1-typespec-코드-스캐폴딩-oa-gen-tsp-scaffold)를 봅니다.

---

## 3. `main.tsp`에 등록

번들 구성 파일 `packages/schemas/typespec/main.tsp`의 import 목록 끝에 새 모듈을 추가합니다.

```typespec
// Bundle composition root. Contract facts live in the imported owner modules.
import "./metadata/common-components.tsp";
import "./metadata/service.tsp";
import "./metadata/security.tsp";
import "./version.tsp";
import "./common.tsp";
import "./auth.tsp";
import "./health.tsp";
import "./me.tsp";
import "./users.tsp";
import "./world-model.tsp";
import "./articles.tsp"; // 추가

namespace OaSdkApi;
```

---

## 4. mock 서버로 확인

중간 OpenAPI 파일을 쓰지 않고 `.tsp`를 메모리에서 컴파일해 mock 서버를 띄웁니다. 기본 주소는 `http://127.0.0.1:4010`이고, `--watch`를 주면 `.tsp`가 바뀔 때 서버를 재시작하지 않고 route를 교체합니다.

```bash
node packages/codegen/dist/cli/index.js mock --tsp packages/schemas/typespec/main.tsp --watch
```

다른 터미널에서 호출합니다. 스캐폴드가 `@useAuth(bearerAuth)`를 붙였으므로 `Authorization` 헤더가 없으면 401이 돌아옵니다.

```bash
curl -H "Authorization: Bearer test" http://127.0.0.1:4010/articles
# {"items":[],"total":0}
```

메모리 컴파일은 반환 타입에 선언한 응답만 만들고, `@oaUseResponseComponent` 같은 확장을 재사용 응답으로 바꾸지 않습니다. 그 변환은 6단계의 bundle restore에서 일어납니다.

---

## 5. breaking change 검사

TypeSpec 원본을 의미 단위로 비교합니다. `--base`의 git ref는 그 커밋의 `packages/schemas/typespec/main.tsp`를 꺼내 컴파일하고, `--head`의 파일 경로는 커밋하지 않은 작업 트리를 그대로 읽습니다.

```bash
node packages/codegen/dist/cli/index.js tsp diff --base origin/main --head packages/schemas/typespec/main.tsp --fail-on-breaking
```

- 이 예제처럼 operation과 모델을 추가하면 `operation-added`, `model-added`로 보고되고 종료 코드는 0입니다.
- 필수 속성 추가(`required-property-added`)나 operation 삭제 같은 breaking change가 있으면 종료 코드 1로 끝납니다.
- `--head HEAD`처럼 git ref를 주면 커밋된 내용끼리 비교하므로 방금 고친 내용이 보이지 않습니다(`No semantic changes detected`). 경로를 직접 지정하려면 `--base origin/main:packages/schemas/typespec/main.tsp`처럼 `ref:path` 형식을 씁니다.

---

## 6. 승인 스냅샷 갱신

먼저 candidate를 만들어 정규화된 OpenAPI diff를 확인합니다. gitignore된 `.oa-sdk/typespec-candidates/`에만 쓰고 커밋 대상 파일은 바꾸지 않습니다.

```bash
pnpm schema:approve-typespec-reference
```

diff가 의도한 변경이면 승인 스냅샷(`packages/schemas/typespec/approved.openapi.yaml`)을 갱신하고 gate를 다시 실행합니다.

```bash
pnpm schema:approve-typespec-reference -- --write
pnpm schema:typespec-check
pnpm schema:downstream-check
```

`articles.tsp`, `main.tsp`, `approved.openapi.yaml`을 같은 PR에 넣습니다. `ContractVersion`을 올릴지는 [버전 채널](../typespec-authoring-conventions.md#6-버전-채널-versioning) 규칙을 따릅니다. 승인 명령이 실패할 때는 [트러블슈팅](./05-troubleshooting.md)을 봅니다.

---

## 다음 단계
- [TypeSpec 작성 규칙](../typespec-authoring-conventions.md)
- [TypeSpec 데코레이터 레퍼런스](./03-decorators-reference.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
- [생성물 배치 토폴로지와 아키텍처 규칙](./06-generation-topologies-and-rules.md)
