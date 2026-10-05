# TypeSpec IDE 환경 설정 및 생산성 가이드

이 문서는 TypeSpec(`.tsp`)을 작성할 때 VS Code와 호환 IDE(Cursor 등)에서 하이라이팅, 자동완성, 진단, 포매팅, 스니펫을 켜는 방법을 안내합니다. 1~2절의 `.vscode/` 설정과 스니펫은 oa-sdk 저장소에 들어 있는 것입니다. 다른 프로젝트는 1단계의 확장을 설치하고, 프로젝트에 `@typespec/compiler`와 `.tsp`가 import하는 라이브러리를 설치하면([설치 안내](../../packages/typespec-decorators/README.md#install)) 같은 언어 기능을 씁니다.

---

## 1. 빠른 시작

### 1단계: TypeSpec 확장 설치
저장소를 VS Code로 열면 `.vscode/extensions.json`에 따라 권장 확장 설치 알림이 표시됩니다. 확장 탭(`Ctrl+Shift+X` / `Cmd+Shift+X`)에서 직접 설치해도 됩니다.

* **확장 ID**: `typespec.typespec-vscode`
* **게시자**: Microsoft

확장은 워크스페이스에 설치된 `@typespec/compiler`의 language server(`tsp-server`)를 실행합니다. 저장소에서는 `pnpm install`이 설치한 1.16 컴파일러를 씁니다.

### 2단계: 저장소 설정 확인
`.vscode/settings.json`이 `.tsp` 파일에 다음을 적용합니다.
* `*.tsp`를 TypeSpec 언어로 연결 (`files.associations`)
* 저장 시 자동 포맷 (`editor.formatOnSave: true`, 포매터 `typespec.typespec-vscode`)
* 들여쓰기 공백 2칸 (`editor.tabSize: 2`)

---

## 2. 코드 스니펫

VS Code가 쓰는 스니펫은 `.vscode/typespec.code-snippets` 하나입니다. `.tsp` 편집기에서 접두사를 입력하고 `Tab`을 누르면 펼쳐집니다.

| 접두사 (Prefix) | 이름 | 펼쳐지는 내용 |
|---|---|---|
| `oa-op`, `op-endpoint` | HTTP Operation | `@summary`, `@doc`, `@tag`, `@operationId`, `@route`, 메서드 decorator와 `op` 뼈대 |
| `oa-rc`, `oa-resp-comp` | Response Component | `@oaUseResponseComponent("<상태>", "<컴포넌트>")` 한 줄 |
| `oa-model`, `model-doc` | DTO Model | `@doc`, `@extension("example", ...)`, `@format("uuid") id`가 있는 모델 |
| `oa-response`, `resp-model` | Response Wrapper | `@statusCode`와 `@body`를 가진 `<Operation><상태>Response` 모델 |
| `erd-dataset` | ERD Dataset | `@oa-sdk/typespec-erd` import와 `@dataset` namespace |
| `erd-entity` | ERD Entity | `@entity`, `@field`, `@primaryKey`가 있는 논리 엔티티 |
| `erd-rel`, `erd-relationship` | ERD Relationship | `@relationship` 선언 |

- `oa-rc` 스니펫의 `@oaUseResponseComponent`를 저장소 계약에 쓸 때 필요한 나머지 선언은 [재사용 응답 컴포넌트에 연결하기](./typespec-authoring-conventions.md#31-재사용-응답-컴포넌트에-연결하기)를 봅니다.
- `erd-*` 스니펫이 쓰는 `@oa-sdk/typespec-erd`는 비공개 유지보수 패키지(maintenance-only, 저장소 전용)라서 저장소 밖에서는 import되지 않습니다.
- 비공개 유지보수 패키지 `@oa-sdk/typespec-tooling`에도 스니펫 사본이 있지만 VS Code 설정에 연결되어 있지 않고 `.vscode` 파일과 내용이 다릅니다.

---

## 3. 커스텀 데코레이터 자동완성과 진단

`@oa-sdk/typespec-decorators`처럼 `package.json`에 `tspMain`이 있는 라이브러리는 import하면 language server가 decorator를 자동완성 목록과 호버에 보여 주고, 컴파일러 진단을 편집 중에 표시합니다.

### 3.1 `@oa-sdk/typespec-decorators`
decorator는 `op` 선언 위에 둡니다.

```typespec
import "@typespec/http";
import "@oa-sdk/typespec-decorators";

using Http;
using OaSdkTypeSpec;

model User {
  id: string;
}

// @oa 를 입력하면 OaSdkTypeSpec decorator가 자동완성 목록에 나옴
@route("/users/{id}")
@get
@oaUseResponseComponent("401", "Unauthorized")
@oaUseResponseComponent("404", "NotFound")
op getUser(@path id: string): Ok<User> | ErrorResponse<401> | ErrorResponse<404>;
```
* 잘못된 상태 코드(예: `"999"`)를 넣으면 `invalid-response-component-reference` 진단이 밑줄로 표시됩니다.

### 3.2 페르소나와 DPM decorator
```typespec
// 1. API 페르소나 역량 선언 (skill.yaml의 표준 trait만 허용)
@route("/profiles")
@get
@personaCapability("pagination", "audit-emission", "pii-masked-default")
op listProfiles(): UserProfile[];

// 2. DPM 필드 가명화 규칙 선언: transform, role, pii
model UserProfile {
  id: string;

  @pseudonymize("hash", "direct_identifier", true)
  email: string;
}
```
* 표준에 없는 trait나 transform을 넣으면 각각 `invalid-persona-trait`, `invalid-pseudonymize-rule` 진단이 표시됩니다. 허용 값은 [패키지 README](../../packages/typespec-decorators/README.md)를 봅니다.

### 3.3 `@oa-sdk/typespec-erd`
논리 ERD decorator(`@dataset`, `@entity`, `@field`, `@primaryKey` 등)도 같은 방식으로 자동완성되고, 복합 기본 키의 순서가 겹치면 진단이 표시됩니다. 저장소 전용 prototype이며 사용법은 [TypeSpec Logical ERD Authoring](./typespec-logical-erd-authoring.md)에 있습니다.

### 3.4 lint 경고와 Quick Fix는 동작하지 않습니다
`@oa-sdk/typespec-tooling`에는 `require-operation-id`, `require-documentation`, `suggest-response-components`, `prefer-typed-decorator` lint 규칙이 정의되어 있습니다. 그러나 이 패키지는 TypeSpec이 읽는 linter를 export하지 않고 `packages/schemas/typespec/tspconfig.yaml`에도 `linter` 설정이 없어서, 규칙이 실행되지 않습니다. 따라서 `@operationId`·`@doc` 누락 경고나 그에 대한 Quick Fix(`Cmd+.` / `Alt+Enter`)는 나타나지 않습니다. 이 패키지의 처리 방향은 [패키지 정리 결정](../internal/package-hygiene-decisions.md)에 기록되어 있습니다.

### 3.5 편집 중에 함께 쓰는 CLI
* 엔드포인트 뼈대 생성(`oa-gen tsp-scaffold`)과 TypeSpec 의미 비교(`oa-gen tsp diff`): [스캐폴딩 및 Semantic Diff](./typespec/04-scaffolding-and-diff.md)
* `.tsp`를 바로 서빙하는 mock 서버(`oa-gen mock --tsp --watch`): [스캐폴딩 및 Semantic Diff 3절](./typespec/04-scaffolding-and-diff.md#3-메모리-컴파일-mock-서버-oa-gen-mock---tsp)
* 저장소 계약에 엔드포인트를 추가하는 전체 흐름: [TypeSpec 5분 퀵스타트](./typespec/01-quickstart-5min.md)

---

## 4. 트러블슈팅

### Q1. 자동완성이나 하이라이팅이 동작하지 않습니다.
1. `pnpm install`(다른 프로젝트는 그 프로젝트의 설치 명령)을 실행해 `node_modules/@typespec/compiler`가 있는지 확인합니다.
2. 명령 팔레트(`Cmd+Shift+P` / `Ctrl+Shift+P`)에서 `TypeSpec: Restart Server`를 실행합니다.

### Q2. 저장 시 포맷이 적용되지 않습니다.
* `.vscode/settings.json`의 `"[typespec]"` 항목에 `"editor.defaultFormatter": "typespec.typespec-vscode"`와 `"editor.formatOnSave": true`가 있는지 확인합니다.

---

## 5. 관련 문서
* [TypeSpec 작성 규칙](./typespec-authoring-conventions.md)
* [TypeSpec 논리 ERD 작성 가이드](./typespec-logical-erd-authoring.md)
* [TypeSpec LSP 아키텍처 분석](./typespec-lsp-architecture.md)
