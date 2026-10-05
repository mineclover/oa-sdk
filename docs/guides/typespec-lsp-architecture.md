# TypeSpec 오픈소스 Extension 및 LSP 아키텍처 분석

이 문서는 Microsoft TypeSpec의 공식 오픈소스 도구 체계(`typespec-vscode`, `@typespec/compiler`)의 내부 LSP(Language Server Protocol) 동작 원리를 분석하고, `oa-sdk` 모노레포 환경에서 하이라이팅, 자동완성, 정적 검증이 어떻게 통합·수행되는지 설명합니다.

> 이 문서는 사용 안내가 아니라 구조 설명입니다. 편집기 설정과 스니펫은 [TypeSpec IDE 설정](./typespec-ide-setup.md)을 따릅니다. 아래에 나오는 `@oa-sdk/typespec-erd`와 `@oa-sdk/typespec-tooling`은 비공개 유지보수 패키지(maintenance-only, 저장소 전용)입니다.

---

## 1. TypeSpec 도구 체계와 오픈소스 분석

TypeSpec 생태계는 Microsoft의 주도로 **MIT 라이선스**로 공개된 오픈소스 프로젝트([microsoft/typespec](https://github.com/microsoft/typespec))입니다.

### 1.1 핵심 구성 컴포넌트

```
┌─────────────────────────────────────────────────────────────┐
│ Visual Studio Code Client (packages/typespec-vscode)        │
│ - TextMate Grammar (syntaxes/typespec.tmLanguage.json)      │
│ - vscode-languageclient/node 기반 LSP 통신 호스트            │
└──────────────────────────┬──────────────────────────────────┘
                           │ JSON-RPC (IPC / stdio)
┌──────────────────────────▼──────────────────────────────────┐
│ Language Server Host: tsp-server (@typespec/compiler/server)│
│                                                             │
│ ┌──────────────────────┐   ┌──────────────────────────────┐ │
│ │ TextDocument Sync    │   │ Semantic Tokens Provider     │ │
│ └──────────────────────┘   └──────────────────────────────┘ │
│ ┌──────────────────────┐   ┌──────────────────────────────┐ │
│ │ Completion Provider  │   │ Hover & Signature Provider   │ │
│ └──────────────────────┘   └──────────────────────────────┘ │
│ ┌──────────────────────┐   ┌──────────────────────────────┐ │
│ │ Diagnostics Engine   │   │ Linter & Code Action Host    │ │
│ └──────────────────────┘   └──────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ Compiler Program & AST
┌──────────────────────────▼──────────────────────────────────┐
│ Compiler Core (@typespec/compiler)                          │
│ - Parser, Scanner, Type Checker, Symbol Table               │
│ - External Decorator Binding (tspMain -> extern dec)        │
│ - Libraries: @oa-sdk/typespec-decorators, typespec-erd      │
└─────────────────────────────────────────────────────────────┘
```

1. **`typespec-vscode` (Thin Client)**:
   - 에디터 확장은 무거운 컴파일 로직을 직접 품지 않고, 워크스페이스 내 로컬 설치된 `@typespec/compiler`의 서버 진입점(`@typespec/compiler/server`)을 찾아 서브프로세스로 실행하는 LSP 클라이언트입니다.
   - 프로젝트별로 컴파일러 버전이 달라도 워크스페이스의 `node_modules` 버전을 정확히 격리하여 실행합니다.
2. **`tsp-server` (Language Server)**:
   - `@typespec/compiler` 패키지 내부에 구현되어 있습니다.
   - 파일 변경 시 메모리 내 가상 파일 시스템(VFS)과 증분 AST 트리를 갱신하고 표준 LSP 응답을 반환합니다.

---

## 2. LSP 핵심 기능별 지원 여부 및 동작 메커니즘

### 2.1 문법 하이라이팅 (2단계 하이브리드 파이프라인)

TypeSpec은 단순 정규식 하이라이팅의 한계를 극복하기 위해 2단계 파이프라인을 사용합니다:

* **1단계: TextMate 정적 토큰화 (`typespec.tmLanguage.json`)**:
  - 파일 로드 즉시 지연 없이 기본 키워드(`model`, `op`, `namespace`, `alias`, `using`, `import`), 리터럴(`#{`, `#[`), 문자열, 주석, `@` 데코레이터 접두사를 색상화합니다.
* **2단계: AST 기반 시맨틱 토큰 (`textDocument/semanticTokens`)**:
  - `tsp-server`가 AST를 분석하여 단순 식별자 중 무엇이 **모델(타입)**인지, **연산자(Operation)**인지, **네임스페이스 경로**인지, **데코레이터 심볼**인지 구별하여 테마에 맞는 정밀한 시맨틱 하이라이팅을 에디터에 적용합니다.

### 2.2 지능형 자동완성 (Scope-Aware Autocompletion)

TypeSpec LSP의 `textDocument/completion` 핸들러는 커서의 AST 컨텍스트를 판별하여 후보를 필터링합니다:

1. **선언 컨텍스트 기반 키워드 제안**:
   - 루트 레벨: `namespace`, `import`, `using`
   - 네임스페이스 블록 내부: `model`, `op`, `interface`, `alias`, `enum`, `union`
   - 모델 블록 내부: 프로퍼티 선언 문법, 전개 연산자(`...`), 내장 스칼라(`string`, `integer`, `utcDateTime` 등)
2. **데코레이터 타겟 필터링**:
   - 커서가 `op` 위에 있을 때 `@`를 입력하면 타겟이 `Operation`인 데코레이터(`@summary`, `@route`, `@get`, `@oaUseResponseComponent`)만 상단에 정렬됩니다.
   - 커서가 `model` 위에 있을 때는 타겟이 `Model`인 데코레이터(`@doc`, `@extension`, `@entity`)가 우선 제안됩니다.
3. **외부 패키지 심볼 탐색**:
   - `package.json`의 `tspMain`으로 선언된 `@oa-sdk/typespec-decorators`, `@oa-sdk/typespec-erd`의 `extern dec` 심볼을 자동으로 색인하여 제안 목록에 노출합니다.

### 2.3 호버(Hover) 및 시그니처 헬프(Signature Help)

* **호버 (`textDocument/hover`)**:
  - 심볼 위에 마우스를 올리면 TypeSpec 내장 docstring(`@doc`) 및 라이브러리의 JSDoc 주석(`/** ... */`)을 마크다운 형태로 렌더링합니다.
* **시그니처 헬프 (`textDocument/signatureHelp`)**:
  - `@oaUseResponseComponent(` 입력 시 `statusCode: valueof string, componentName: valueof string`과 같이 매개변수 순서와 허용 타입, JSDoc 설명이 인라인 팝업으로 안내됩니다.

### 2.4 실시간 진단 및 검증 (Diagnostics Engine)

TypeSpec LSP는 `textDocument/publishDiagnostics` 알림을 통해 파일 저장 및 편집 시 실시간으로 진단 결과를 제공합니다:

1. **문법/파싱 에러**: 세미콜론 누락, 잘못된 괄호 매칭, 유효하지 않은 연산자.
2. **타입 체커 에러**: 선언되지 않은 모델 참조, 타입 불일치, 순환 참조.
3. **라이브러리 커스텀 진단 (`reportDiagnostic`)**:
   - 예: `@oaUseResponseComponent("999", "Bad")` 입력 시 1~5로 시작하지 않는 상태코드에 대해 즉시 빨간 밑줄과 진단 메시지 출력.
   - 예: `@primaryKey`에 중복 순서 할당 시 컴파일 진단 오류 출력.
4. **플러그인 린터 룰 (Linter Diagnostics)**:
   - TypeSpec은 라이브러리가 export한 linter를 `tspconfig.yaml`의 `linter` 설정으로 켜면 규칙 위반을 경고로 표시합니다.
   - `@oa-sdk/typespec-tooling`에는 `require-operation-id`, `require-documentation` 등의 규칙이 정의되어 있지만, 이 패키지는 TypeSpec이 읽는 linter를 export하지 않고 `packages/schemas/typespec/tspconfig.yaml`에도 `linter` 설정이 없습니다. 현재 이 규칙은 실행되지 않으며 경고와 Quick Fix도 나타나지 않습니다.

---

## 3. 구현 방식 비교 (방법 1, 2, 3)

방법 1만 채택했습니다. 방법 2와 3은 검토한 대안이며 구현되어 있지 않습니다.

| 구분 | 방법 1: IDE Native LSP (채택) | 방법 2: Monaco 경량 토크나이저 (미채택) | 방법 3: 브라우저 WASM/Worker LSP (미채택) |
|---|---|---|---|
| **실행 주체** | VS Code / Cursor + `tsp-server` | 프론트엔드 JavaScript (Monaco) | 브라우저 Web Worker 내 WASM |
| **적용 후보** | 모노레포 실제 스펙 개발 워크스페이스 | 웹 대시보드의 `.tsp` 뷰어/편집기 | 독립 웹 플레이그라운드 |
| **하이라이팅** | TextMate + Semantic Tokens (AST) | Monarch 정규식 매칭 | Semantic Tokens (LSP Client) |
| **자동완성** | AST 스코프 기반 완성 | 정적 토큰/스니펫 목록 반환 | AST 스코프 기반 완성 |
| **실시간 검증** | 컴파일러 + 커스텀 데코레이터 진단 | 없음 (별도 서버 호출 필요) | Worker 내 컴파일러 진단 |
| **추가 웹 번들** | 없음 (IDE 로컬 구동) | 경량 JS | 컴파일러 번들과 가상 FS |

### 채택 결론
`oa-sdk` 모노레포는 로컬 엔지니어링 작업이 중심이므로 **방법 1(IDE Native LSP)**을 표준으로 정했습니다. 모노레포 루트에 `.vscode/` 설정(`settings.json`, `extensions.json`, `typespec.code-snippets`)을 두었습니다. 도구·스니펫·lint 규칙을 묶은 `@oa-sdk/typespec-tooling`도 만들었지만, lint 규칙은 TypeSpec 프로젝트에 연결되어 있지 않고 VS Code는 이 패키지의 스니펫이 아니라 `.vscode/typespec.code-snippets`를 씁니다([패키지 정리 결정](../internal/package-hygiene-decisions.md)).
