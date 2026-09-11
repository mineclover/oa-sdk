# TypeSpec IDE 환경 설정 및 생산성 가이드

이 문서는 `oa-sdk` 모노레포에서 TypeSpec(`.tsp`) 작성 시 VS Code 및 호환 IDE(Cursor 등)의 자동완성, 하이라이팅, 포매팅, 스니펫 기능을 1분 만에 활성화하는 방법을 안내합니다.

---

## 1. 빠른 시작 (1분 설정)

모노레포 루트에는 이미 `.vscode/extensions.json` 및 `.vscode/settings.json` 권장 설정이 포함되어 있습니다.

### 1단계: TypeSpec 확장 설치
VS Code에서 이 저장소를 열면 하단에 **권장 확장 설치 알림**이 표시됩니다. 또는 확장 탭(`Ctrl+Shift+X` / `Cmd+Shift+X`)에서 아래 확장을 검색하여 설치합니다:

* **확장 ID**: `typespec.typespec-vscode`
* **게시자**: Microsoft

### 2단계: 자동 설정 확인
`.vscode/settings.json`에 의해 아래 설정이 자동 적용됩니다:
* `*.tsp` 파일 저장 시 자동 포맷 (`editor.formatOnSave: true`)
* 들여쓰기 공백 2칸 (`editor.tabSize: 2`)
* 로컬 모노레포의 `@typespec/compiler` 내장 `tsp-server` 자동 실행

---

## 2. 제공되는 코드 스니펫 목록

`oa-sdk` 전용 TypeSpec 스니펫이 `.vscode/typespec.code-snippets` 및 `@oa-sdk/typespec-tooling`에 등록되어 있습니다. `.tsp` 편집기에서 접두사를 입력하고 `Tab`을 누르면 자동 완성됩니다.

| 접두사 (Prefix) | 이름 | 용도 및 설명 |
|---|---|---|
| `oa-op`, `op-endpoint` | **HTTP Operation** | `@summary`, `@doc`, `@tag`, `@operationId`, `@route`, `@get` 뼈대 일괄 생성 |
| `oa-rc`, `oa-resp-comp` | **Response Component** | `@oaUseResponseComponent("401", "Unauthorized")` 공통 응답 바인딩 |
| `oa-model`, `model-doc` | **DTO Model** | `@doc`, `@extension("example", ...)`가 포함된 표준 DTO 모델 생성 |
| `oa-response`, `resp-model` | **Response Wrapper** | `@statusCode`와 `@body`를 갖는 표준 응답 래퍼 모델 생성 |
| `erd-dataset` | **ERD Dataset** | `@dataset` 네임스페이스 선언 (@oa-sdk/typespec-erd) |
| `erd-entity` | **ERD Entity** | `@entity`, `@field`, `@primaryKey`를 포함한 논리 엔티티 생성 |
| `erd-rel` | **ERD Relationship** | `@relationship` 외래키/카디널리티 관계 선언 |

---

## 3. 커스텀 데코레이터 자동완성 및 검증 안내

`oa-sdk`의 커스텀 라이브러리들은 `package.json`의 `tspMain` 진입점을 통해 LSP에 심볼과 타입을 자동으로 공급합니다.

### 3.1 `@oa-sdk/typespec-decorators`
```typespec
import "@oa-sdk/typespec-decorators";
using OaSdkTypeSpec;

op getUser(@path id: string): User {
  // @oa 입력 시 자동완성 팝업 노출
  @oaUseResponseComponent("401", "Unauthorized")
  @oaUseResponseComponent("404", "NotFound")
}
```
* 잘못된 상태코드(예: `"999"`)를 입력하면 컴파일러와 LSP가 실시간으로 에러 밑줄(Diagnostics)을 띄웁니다.

### 3.2 `@oa-sdk/typespec-erd`
```typespec
import "@oa-sdk/typespec-erd";
using OaSdkErd;

@dataset("commerce")
namespace Commerce {
  @entity("commerce.customer")
  model Customer {
    @field("commerce.customer.id")
    @primaryKey
    id: string;
  }
}
```
* 복합 기본 키 사용 시 `@primaryKey("group", order)`에서 order가 중복되면 즉시 진단 에러가 발생합니다.

### 3.3 LSP Quick Fix (Code Action) 활용
`@oa-sdk/typespec-tooling` linter 규칙이 활성화되어 있어 다음과 같은 경고 발생 시 **전구 아이콘(`Cmd+.` / `Alt+Enter`)**을 눌러 원클릭으로 코드를 자동 보정할 수 있습니다:
* **`@operationId` 누락 시**: `Add @operationId("<name>")` 자동 삽입
* **`@doc` 누락 시**: `Add @doc("<name> 설명")` 템플릿 자동 삽입
* **공통 응답 누락 시**: `Add @oaUseResponseComponent("401", "Unauthorized")` 자동 삽입

### 3.4 TypeSpec Scaffolding CLI (`oa-gen tsp-scaffold`)
신규 엔드포인트와 DTO 모델을 손으로 처음부터 작성하는 대신, CLI로 표준 뼈대를 일괄 생성·주입할 수 있습니다:

```bash
# 기본 GET 엔드포인트 코드 생성 (stdout 출력)
oa-gen tsp-scaffold --route /users/{id}/audit --method get

# POST 엔드포인트와 Request/Response DTO를 생성하여 기존 .tsp 파일에 즉시 주입
oa-gen tsp-scaffold --route /articles --method post --operation-id createArticle --summary "게시글 작성" --file packages/schemas/typespec/users.tsp
```

### 3.5 TypeSpec AST Semantic Diff (`oa-gen tsp diff`)
TypeSpec 소스 파일 간의 파괴적/비파괴적 변경 사항을 컴파일 전에 AST 레벨에서 0.5초 만에 비교 분석합니다:

```bash
# Git ref 간 비교 및 파괴적 변경 시 exit code 1 반환 (CI 차단 게이트)
oa-gen tsp diff --base origin/main --head HEAD --fail-on-breaking

# JSON 포맷 출력
oa-gen tsp diff --base origin/main --head HEAD --format json
```

### 3.6 Zero-Build Instant Mock Server (`oa-gen mock --tsp`)
중간 OpenAPI YAML 파일을 디스크에 생성하지 않고, `@typespec/compiler` 인메모리 컴파일러를 통해 `localhost:4010`에 즉각적인 HTTP Mock 서버를 구동합니다:

```bash
# TypeSpec 파일 직접 지정하여 Mock 서버 구동 및 파일 변경 감지(핫 리로드)
oa-gen mock --tsp packages/schemas/typespec/main.tsp --watch --port 4010
```

### 3.7 Personas & DPM 네이티브 데코레이터
API 권한 및 역량 검증, 데이터 가명화 정책을 TypeSpec 코드에 직접 선언합니다:

```typespec
// 1. API 페르소나 역량 선언 (skill.yaml 검증)
@personaCapability("pagination", "audit-emission", "pii-masked-default")
op listUsers(): User[];

// 2. DPM 필드 가명화 규칙 선언
model UserProfile {
  id: string;
  @pseudonymize(UserProfile.email, "hmac-sha256")
  email: string;
}
```

---

## 4. 트러블슈팅

### Q1. 자동완성이나 하이라이팅이 동작하지 않습니다.
1. `pnpm install`을 실행하여 `node_modules/@typespec/compiler`가 설치되어 있는지 확인합니다.
2. VS Code 명령 팔레트(`Cmd+Shift+P` / `Ctrl+Shift+P`)를 열고 `TypeSpec: Restart Server`를 실행합니다.

### Q2. 포맷터가 저장 시 작동하지 않습니다.
* `.vscode/settings.json`에 `"[typespec]": { "editor.defaultFormatter": "typespec.typespec-vscode" }`가 정상 활성화되어 있는지 확인합니다.

---

## 5. 관련 문서
* [TypeSpec 작성 규칙 가이드](./typespec-authoring-conventions.md)
* [TypeSpec 논리 ERD 작성 가이드](./typespec-logical-erd-authoring.md)
* [TypeSpec LSP 아키텍처 분석](./typespec-lsp-architecture.md)
