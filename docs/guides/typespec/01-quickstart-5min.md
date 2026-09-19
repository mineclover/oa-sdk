# TypeSpec 5분 퀵스타트 가이드 (TypeSpec 5-Minute Quickstart)

이 문서는 `oa-sdk` 모노레포에서 TypeSpec(`.tsp`)을 사용하여 새로운 API 엔드포인트를 선언하고, 실시간 Mock 서버로 검증하며, 브레이킹 체인지 검사 및 스펙 승인까지 5분 만에 완료하는 일일 개발 워크플로우를 안내합니다.

---

## 1. 전제 조건 및 1분 IDE 설정

모노레포 루트에는 이미 `.vscode/settings.json`과 `.vscode/extensions.json`이 설정되어 있습니다.

1. **TypeSpec 확장 설치**:
   - VS Code 확장 마켓플레이스(`Cmd+Shift+X` / `Ctrl+Shift+X`)에서 `typespec.typespec-vscode` (Microsoft)를 설치합니다.
2. **자동 포매팅 및 진단 확인**:
   - `.tsp` 파일을 저장할 때 자동 포맷팅(`editor.formatOnSave: true`)과 컴파일러 기반 실시간 진단 밑줄(Diagnostics)이 활성화됩니다.

---

## 2. 1단계: 신규 리소스 엔드포인트 스캐폴딩

`oa-gen tsp-scaffold` 명령어를 사용하여 엔드포인트와 DTO 뼈대를 손쉽게 생성합니다.

### A. 리소스 CRUD 풀셋 생성 (권장)
표준 제네릭 래퍼(`Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`)를 적용한 전체 CRUD 엔드포인트를 생성하려면 `--crud --envelope` 플래그를 사용합니다:

```bash
oa-gen tsp-scaffold --route /articles --crud --envelope --file packages/schemas/typespec/articles.tsp
```

생성된 파일에는 다음 구성요소가 자동으로 작성됩니다:
- **DTO**: `Article`, `CreateArticleRequest`, `UpdateArticleRequest`
- **Operations**:
  - `listArticles()`: `Ok<PageResult<Article>>`
  - `getArticleById(@path id: string)`: `Ok<Article>`
  - `createArticle(@body body: CreateArticleRequest)`: `Created<Article>`
  - `updateArticle(@path id: string, @body body: UpdateArticleRequest)`: `Ok<Article>`
  - `deleteArticle(@path id: string)`: `NoContent`

### B. 단일 엔드포인트 생성
특정 단일 엔드포인트만 추가하려면 다음과 같이 실행합니다:

```bash
oa-gen tsp-scaffold --route /users/{id}/audit --method get --summary "사용자 감사 로그 조회"
```

---

## 3. 2단계: 번들 통합 루트 등록

새로운 도메인 모듈(`.tsp`)을 생성했다면, 번들 통합 루트인 `packages/schemas/typespec/main.tsp`에 import합니다:

```typespec
// packages/schemas/typespec/main.tsp
import "./metadata/common-components.tsp";
import "./metadata/service.tsp";
import "./metadata/security.tsp";
import "./version.tsp";
import "./common.tsp";
import "./auth.tsp";
import "./health.tsp";
import "./me.tsp";
import "./users.tsp";
import "./articles.tsp"; // 신규 추가
```

---

## 4. 3단계: 무빌드 실시간 Mock 서버 테스트

중간 OpenAPI YAML 파일을 빌드할 필요 없이, 메모리 내 TypeSpec 컴파일러를 통해 즉시 로컬 Mock 서버를 구동합니다:

```bash
oa-gen mock --tsp packages/schemas/typespec/main.tsp --watch --port 4010
```

- 파일 변경 시 즉시 핫 리로드(Hot-Reload)됩니다.
- `curl http://localhost:4010/articles` 또는 브라우저에서 스펙 기반 가상 Mock 데이터를 바로 조회할 수 있습니다.

---

## 5. 4단계: AST Semantic Diff 및 파괴적 변경 검사

Git 베이스 브랜치와 현재 작업 브랜치 간의 사양 변경 사항을 컴파일 전에 AST 레벨에서 비교합니다:

```bash
oa-gen tsp diff --base origin/main --head HEAD --fail-on-breaking
```

- 하위 호환 가능한 필드 추가: 정상 통과.
- 필수 필드 추가, 엔드포인트 삭제 등 파괴적 변경(Breaking Change) 감지 시: exit code 1로 종료되어 CI 단계에서 자동 차단.

---

## 6. 5단계: 스펙 후보 검증 및 베이스라인 스냅샷 갱신

스펙 작업이 완료되면 승인 커맨드를 실행하여 OpenAPI 베이스라인 스냅샷(`approved.openapi.yaml`)을 갱신합니다.

1. **로컬 후보 검토 (미적용)**:
   ```bash
   pnpm schema:approve-typespec-reference
   ```
   - `.oa-sdk/typespec-candidates/`에 후보 아티팩트를 생성하고 정규화된 OpenAPI Diff를 화면에 출력합니다.
2. **스냅샷 승인 및 커밋 반영**:
   ```bash
   pnpm schema:approve-typespec-reference -- --write
   ```
   - 승인된 변경 사항이 `packages/schemas/typespec/approved.openapi.yaml`에 기록됩니다.
3. **최종 게이트 검증**:
   ```bash
   pnpm schema:typespec-check
   pnpm schema:downstream-check
   ```

---

## 다음 단계
- [TypeSpec 작성 규칙 및 컨벤션 표준](./02-authoring-conventions.md)
- [커스텀 데코레이터 상세 레퍼런스](./03-decorators-reference.md)
- [스캐폴딩 및 Semantic Diff 도구 활용법](./04-scaffolding-and-diff.md)
- [트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
