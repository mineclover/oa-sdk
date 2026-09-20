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
| `--output <path>` | `-o` | N | 신규 출력 파일 경로 지정 (새 파일 생성 시 필수 헤더 `import "@typespec/http"`, `import "@typespec/openapi"` 및 `Ok<T>`, `Created<T>` 등 제네릭 래퍼를 자동 주입하여 즉시 컴파일 가능) |

### 1.2 대표 활용 예제

#### 예제 1: 표준 CRUD 풀셋 생성 및 기존 파일 주입 (가장 권장됨)
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

#### 예제 4: 기능 도메인 폴더에 독립형 모듈 신규 스캐폴딩 (--output)
```bash
oa-gen tsp-scaffold --route /orders --crud --envelope --output src/features/orders/orders.tsp
```
> 💡 `--output`으로 존재하지 않는 새 파일을 지정하면, 파일 상단에 필수 임포트(`@typespec/http`, `@typespec/openapi`) 및 제네릭 모델(`Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`)이 자동으로 주입되어 별도의 보일러플레이트 작성 없이 즉시 컴파일 및 아티팩트 생성이 가능합니다.

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

## 4. TypeSpec 작성/수정 후 일관된 아티팩트 재생성 워크플로우

`.tsp` 파일을 작성하거나 수정한 후, 다운스트림 코드(OpenAPI, JSON Schema, 타입, 계약, 클라이언트 SDK, 쿼리 훅, 타입 가드)를 재생성하는 방법은 **4가지 표준 경로**가 제공됩니다. 개발 환경과 목적에 따라 가장 적합한 경로를 선택하십시오.

| 경로 | 방식 | 실행 명령 | 언제 사용하는가 |
|---|---|---|---|
| **경로 1** | **선언적 일괄 재생성**<br>*(Declarative Batch, 가장 권장)* | `oa-gen generate` | 프로젝트 전반의 `oa.config.ts` 설정에 따라 모든 아티팩트를 일괄 갱신 및 FSD/DDD 경로로 자동 라우팅할 때 |
| **경로 2** | **CLI 단일 라인 전체 생성**<br>*(One-line Direct CLI)* | `oa-gen generate --spec <path.tsp> --output <dir>` | 설정 파일 없이 단 한 줄의 명령으로 특정 `.tsp`로부터 전체 파이프라인 아티팩트를 특정 폴더에 즉시 뽑아낼 때 |
| **경로 3** | **정밀 서브커맨드 개별 생성**<br>*(Granular Subcommands)* | `oa-gen <subcommand> --spec <path.tsp>` | 클라이언트, Zod, 타입 등 특정 아티팩트만 선별적으로 갱신할 때 |
| **경로 4** | **모노레포 코어 스펙 승인**<br>*(Core Monorepo Maintenance)* | `pnpm schema:validate`<br>`pnpm schema:approve-typespec-reference -- --write` | `packages/schemas/typespec/`의 정규 계약 수정 후 표준 참조 스펙을 갱신하고 PR을 제출할 때 |

---

### 4.1 경로 1: 선언적 일괄 재생성 (`oa.config.ts` 기반, 가장 권장됨)

`oa.config.ts`의 `specs`에 `.tsp` 파일 경로를 `schemaEntry`로 선언해 두면, 인자 없이 `oa-gen generate`만 실행해도 전체 파이프라인이 즉각 동작합니다.

```typescript
// oa.config.ts
import { defineConfig } from "@oa-sdk/codegen";

export default defineConfig({
  product: {
    specs: [
      {
        id: "main-api",
        profile: "full-api-document",
        schemaEntry: "packages/schemas/typespec/main.tsp", // TypeSpec 단일 진실 공급원 (SSOT)
        outDir: "dist/specs",
      },
    ],
    // FSD / DDD 경로 자동 라우팅
    outputRouting: {
      pattern: "src/api/{tag}/{tag}.{kind}.ts",
    },
  },
});
```

실행:
```bash
oa-gen generate
```
**산출물**:
- `dist/specs/main-api.openapi.json` (OpenAPI 3.2 사양)
- `dist/specs/main-api.schema.json` (Draft 2020-12 `$defs` JSON Schema)
- `src/api/{tag}/{tag}.contract.ts` (프레임워크 무의존 순수 핸들러 계약)
- `src/api/{tag}/{tag}.client.ts` (타입 안전 경량 fetch 클라이언트 SDK)
- `src/api/{tag}/{tag}.queries.ts` (TanStack Query v5 3계층 훅/옵션/키)

---

### 4.2 경로 2: CLI 단일 라인 전체 생성 (One-line Direct CLI)

설정 파일(`oa.config.ts`)을 작성하지 않았거나 CI 임시 디렉터리에 빠르게 모든 아티팩트를 방출하고 싶을 때 사용합니다.

```bash
# 단 한 줄로 OpenAPI, JSON Schema, 계약, 클라이언트, TanStack Query까지 일괄 생성
oa-gen generate --spec packages/schemas/typespec/main.tsp --output dist

# 도메인/태그별 분할(Split) 출력
oa-gen generate --spec packages/schemas/typespec/main.tsp --output src/api --split
```

**결과 디렉터리(`dist/`) 구조**:
- `main.openapi.json` (OpenAPI 3.2 명세)
- `main.schema.json` (JSON Schema 2020-12 정의)
- `main.contract.ts` (백엔드 라우터 연동용 순수 핸들러 계약)
- `main.client.ts` (0-런타임 의존성 브라우저/노드 겸용 클라이언트 SDK)
- `main.queries.ts` (TanStack Query v5 쿼리/뮤테이션 팩토리)

---

### 4.3 경로 3: 정밀 서브커맨드 개별 생성 (Granular Subcommands)

OpenAPI YAML/JSON 파일을 사전에 방출(Emit)해 둘 필요 없이, `oa-gen`의 각 서브커맨드에 `.tsp` 파일 경로를 직접 지정할 수 있습니다. CLI 내부의 인메모리 컴파일 엔진(`loadSpecDocumentAsync`)이 백그라운드에서 구동되어 0.5초 내에 해당 아티팩트만 즉시 갱신합니다.

#### (1) 타입 안전 fetch 클라이언트 SDK 생성 (`generate:client`)
```bash
# 기본 소스 파일 생성
oa-gen generate:client --spec packages/schemas/typespec/main.tsp --output src/api/client.ts

# 0-런타임 의존성 단독 패키지(dist/, package.json, README) 빌드
oa-gen generate:client --spec packages/schemas/typespec/main.tsp --pack --output packages/api-client --name @my-org/api-client
```

#### (2) TypeScript 타입 정의 생성 (`typegen`)
```bash
oa-gen typegen --spec packages/schemas/typespec/main.tsp --output src/types/api.ts
```

#### (3) Zod 4 스키마 및 타입 생성 (`generate:zod`)
```bash
oa-gen generate:zod --spec packages/schemas/typespec/main.tsp --output src/schemas/api.zod.ts
```

#### (4) TanStack Query v5 훅 생성 (`generate:tanstack`)
```bash
# 전체 3계층 (Keys, Options, Hooks) 일괄 생성
oa-gen generate:tanstack --spec packages/schemas/typespec/main.tsp --output src/queries/api.ts

# Pure Options만 생성 (Next.js RSC 또는 Vue 호환)
oa-gen generate:tanstack --spec packages/schemas/typespec/main.tsp --output src/queries/api.ts --tier options --framework react
```

#### (5) 독립형 무런타임 타입 가드 생성 (`generate:guards`)
Chrome Extension Manifest V3 등 엄격한 CSP 환경을 위한 0-의존성 정적 가드 생성:
```bash
oa-gen generate:guards --input packages/schemas/typespec/main.tsp --out-dir src/guards --split
```

#### (6) 스펙 검증 및 린트 (`validate` / `lint`)
```bash
oa-gen validate --spec packages/schemas/typespec/main.tsp --require-32
oa-gen lint --spec packages/schemas/typespec/main.tsp
```

---

### 4.4 경로 4: 모노레포 코어 스펙 유지보수 및 승인 (Monorepo Schema Maintenance)

`oa-sdk` 모노레포 내부의 정규 스펙인 `packages/schemas/typespec/main.tsp`를 수정한 경우, 모노레포 거버넌스 스크립트를 통해 검증 및 표준 참조 스펙을 동기화합니다.

```bash
# 1. TypeSpec 문법 및 호환성 유효성 검증
pnpm schema:validate

# 2. 정규 참조 OpenAPI 및 Draft 2020-12 아티팩트 승인 갱신
pnpm schema:approve-typespec-reference -- --write

# 3. 다운스트림 타입 및 계약 영향도 검증
pnpm schema:downstream-check
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
- [아티팩트 생성 토폴로지 및 아키텍처 규칙](./06-generation-topologies-and-rules.md)
