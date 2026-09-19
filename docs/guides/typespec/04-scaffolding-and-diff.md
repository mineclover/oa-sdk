# TypeSpec 스캐폴딩 및 Semantic Diff 도구 활용법 (Scaffolding & Diff CLI)

이 문서는 `oa-sdk`가 제공하는 CLI 도구군(`oa-gen tsp-*`)을 활용하여 TypeSpec 코드를 빠르게 생성하고, 브레이킹 체인지를 사전에 방지하며, 즉각적인 로컬 테스트를 수행하는 방법을 안내합니다.

---

## 1. TypeSpec 코드 스캐폴딩 (`oa-gen tsp scaffold` / `oa-gen tsp-scaffold`)

수작업으로 DTO 모델과 엔드포인트 코드를 타이핑할 필요 없이, 표준 컨벤션에 맞는 코드를 자동 생성합니다. 공백 구분(`oa-gen tsp scaffold`)과 케밥케이스(`oa-gen tsp-scaffold`)를 모두 지원합니다.

### 1.1 주요 옵션 레퍼런스
| 옵션 | 단축키 | 필수 | 설명 |
|---|---|---|---|
| `--route <path>` | `-r` | **Y** | 엔드포인트 HTTP 라우트 경로 (예: `/articles/{id}`) |
| `--method <method>` | `-m` | N | HTTP 메서드 (`get`, `post`, `put`, `patch`, `delete`, 기본값: `get`) |
| `--operation-id <id>` | | N | 고유 operationId (기본값: route 및 method로부터 자동 유추) |
| `--domain <name>` | `-d` | N | 도메인/태그 이름 (기본값: route 첫 번째 세그먼트) |
| `--summary <text>` | | N | 오퍼레이션 한 줄 요약 |
| `--auth <scheme>` | | N | 인증 방식 (기본값: `bearerAuth`, 미사용 시 `none`) |
| `--crud` | | N | **리소스 전체 CRUD(목록, 단건, 생성, 수정, 삭제) 5종 일괄 생성** |
| `--envelope` | | N | **표준 제네릭 래퍼(`Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`) 적용** |
| `--resource <name>` | | N | CRUD 리소스 엔티티 이름 (기본값: route로부터 자동 유추) |
| `--file <path>` | `-f` | N | 생성된 코드를 기존 `.tsp` 파일 끝에 자동으로 추가 주입 |
| `--output <path>` | `-o` | N | 출력 파일 경로 지정 (미지정 시 stdout 또는 `--file` 주입) |

### 1.2 대표 활용 예제

#### 예제 1: 표준 CRUD 풀셋 생성 및 파일 주입 (가장 권장됨)
```bash
oa-gen tsp-scaffold --route /products --crud --envelope --file packages/schemas/typespec/products.tsp
```

#### 예제 2: 단일 POST 엔드포인트 생성
```bash
oa-gen tsp-scaffold --route /articles --method post --operation-id createArticle --summary "게시글 등록"
```

#### 예제 3: 공개(인증 불필요) 엔드포인트 생성
```bash
oa-gen tsp-scaffold --route /public/stats --method get --auth none --summary "공개 통계 조회"
```

---

## 2. TypeSpec AST Semantic Diff (`oa-gen tsp diff`)

OpenAPI YAML로 컴파일하기 전, TypeSpec AST 레벨에서 두 Git 브랜치(또는 파일) 간의 변경 사항을 0.5초 만에 비교 분석합니다.

### 2.1 주요 옵션 레퍼런스
| 옵션 | 필수 | 설명 |
|---|---|---|
| `--base <ref>` | **Y** | 비교 기준 Git ref 또는 파일 경로 (`main`, `origin/main`, `HEAD~1` 등) |
| `--head <ref>` | **Y** | 비교 대상 Git ref 또는 파일 경로 (`HEAD`, 현재 작업 트리) |
| `--fail-on-breaking` | N | 파괴적 변경(Breaking Change) 감지 시 exit code 1로 종료 (CI 차단용) |
| `--format <type>` | N | 출력 형식 (`markdown` 또는 `json`, 기본값: `markdown`) |

### 2.2 대표 활용 예제

#### 로컬 작업 중 파괴적 변경 사전 점검
```bash
oa-gen tsp diff --base origin/main --head HEAD --fail-on-breaking
```

#### CI 파이프라인에서 JSON 리포트 생성
```bash
oa-gen tsp diff --base origin/main --head HEAD --format json > diff-report.json
```

---

## 3. 무빌드 실시간 Mock 서버 (`oa-gen mock --tsp`)

OpenAPI 산출물을 중간에 생성할 필요 없이, `@typespec/compiler` 인메모리 파서를 통해 즉시 Mock API 서버를 띄웁니다.

```bash
oa-gen mock --tsp packages/schemas/typespec/main.tsp --watch --port 4010
```

- **`--watch`**: `.tsp` 파일이 수정되면 100ms 내에 인메모리 컴파일 후 라우트를 핫 리로드합니다.
- **`--port`**: Mock 서버 포트 지정 (기본값: 4010).

---

## 4. 인메모리 컴파일 기반 Direct TypeSpec 코드젠

OpenAPI YAML/JSON 파일을 사전에 방출(Emit)해 둘 필요 없이, `oa-gen`의 주요 코드 생성 및 검증 명령에 `.tsp` 파일 경로를 직접 지정할 수 있습니다. CLI가 백그라운드에서 인메모리 컴파일(`loadSpecDocumentAsync`)을 수행하여 초고속으로 대상 아티팩트를 생성합니다.

### 4.1 TypeScript 타입 생성 (`oa-gen typegen`)
```bash
oa-gen typegen --spec packages/schemas/typespec/main.tsp --output src/types/api.ts
```

### 4.2 Zod 스키마 생성 (`oa-gen generate:zod`)
```bash
oa-gen generate:zod --spec packages/schemas/typespec/main.tsp --output src/schemas/api.zod.ts
```

### 4.3 TanStack Query v5 훅 생성 (`oa-gen generate:tanstack`)
```bash
oa-gen generate:tanstack --spec packages/schemas/typespec/main.tsp --output src/queries/api.ts
```

### 4.4 직접 스펙 검증 및 린트 (`oa-gen validate` / `oa-gen lint`)
```bash
oa-gen validate --spec packages/schemas/typespec/main.tsp
oa-gen lint --spec packages/schemas/typespec/main.tsp
```

---

## 5. 번들 검증 및 복원 도구군 (`oa-gen tsp bundle-check` 등)

모노레포 정적 검증 파이프라인에서 사용되는 저수준 도구들입니다. 공백 구분과 케밥케이스 서브커맨드를 모두 지원합니다:

- **`oa-gen tsp bundle-check` (`oa-gen tsp-bundle-check`)**:
  `oa-sdk.typespec-bundle.json` 매니페스트에 정의된 번들을 컴파일하고 사이드카/익스텐션 무결성을 검증합니다.
- **`oa-gen tsp restore` (`oa-gen tsp-restore`)**:
  TypeSpec에서 방출된 OpenAPI에 사이드카 및 v5 익스텐션을 결합하여 최종 프로덕션 OpenAPI 3.2를 복원합니다.
- **`oa-gen tsp export` (`oa-gen tsp-export`)**:
  기존 OpenAPI 스펙을 기반으로 초기 `.tsp` 파일과 호환성 사이드카를 자동 추출합니다.

---

## 다음 단계
- [TypeSpec 5분 퀵스타트 가이드](./01-quickstart-5min.md)
- [TypeSpec 작성 규칙 및 컨벤션 표준](./02-authoring-conventions.md)
- [커스텀 데코레이터 상세 레퍼런스](./03-decorators-reference.md)
- [트러블슈팅 및 자주 묻는 질문(FAQ)](./05-troubleshooting.md)
