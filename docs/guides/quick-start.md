---
docType: tutorial
sourceLocale: ko
canonical: true
audience:
  competence: novice
productVersions:
  - "@oa-sdk/codegen 0.7.0 (public npm)"
  - "@oa-sdk/ast-sync 0.1.0 (public npm)"
  - "@oa-sdk/core 0.3.0 (public npm)"
  - "@oa-sdk/parser 0.3.0 (public npm)"
  - "OA SDK API contract 0.7.0"
tested:
  environment: "Node.js 24 LTS+, pnpm 10.30.3, repository checkout"
  at: "2026-09-11"
owner: "OA SDK maintainers"
reviewDue: "2026-12-10"
status: active
sourceOfTruth:
  - package.json
  - packages/codegen/package.json
  - packages/ast-sync/package.json
  - packages/router/package.json
  - packages/client/package.json
  - packages/mock-server/package.json
  - packages/schemas/typespec/version.tsp
  - packages/schemas/typespec/approved.openapi.yaml
---

# Quick Start

5분 안에 oa-sdk 전 파이프라인을 체험합니다.

## 공개 CLI만 사용할 때

비공개 monorepo가 필요 없는 일반 컨슈머는 npm에 공식 배포된 `@oa-sdk/codegen`을 통해 자신의 프로젝트에 맞는 프레임워크와 스키마를 30초 만에 자동 감지하고, OpenAPI 3.2 문서를 검증·생성·모킹할 수 있습니다.

```bash
npm install --save-dev @oa-sdk/codegen
# 0. 30초 마찰 제로 온보딩 (프레임워크 및 스키마 자동 감지, oa.config.ts 생성 및 스크립트 구성)
npx oa-gen init --yes

# 1. OAS 3.2 스펙 파싱 및 사전 유효성 검증
npx oa-gen validate --spec ./openapi.yaml --require-32

# 2. OpenAPI 3.2 스펙에서 TypeScript 타입 선언 생성
npx oa-gen typegen --spec ./openapi.yaml -o types.ts

# 3. OpenAPI 3.2 스펙에서 Zod 4 검증 스키마 및 타입 생성
npx oa-gen generate:zod --spec ./openapi.yaml -o schemas.ts

# 4. TypeScript 소스의 구문 특성 및 스키마 투영 적합성 감사
npx oa-gen audit:shape --source ./src/types.ts

# 5. TypeSpec 또는 OpenAPI 기반 실시간 무중단 핫 리로드 Mock HTTP 서버 구동
npx oa-gen mock --spec ./openapi.yaml --watch --port 4010
```

현재 공용 npm 레지스트리(`registry.npmjs.org`)에 `@oa-sdk/codegen@0.7.0`, `@oa-sdk/ast-sync@0.1.0` 등 6종의 배포 아티팩트가 Sigstore SLSA v1 Provenance 서명과 함께 공식 라이브(`latest`) 상태로 제공됩니다. OA SDK 자체 production schema를 작성하거나 변경하려면 아래의 비공개 source workflow를 사용합니다.

## 비공개 source workflow

이 흐름은 OA SDK 저장소의 canonical schema를 검증하고, 타입·라우터·클라이언트·mock server를
생성하는 학습 경로다. 공개 OpenAPI 문서만 소비한다면 위의 npm 명령으로 완료하고 이 절은
건너뛴다.

### 1. 설치

```bash
git clone <repo> && cd oa-sdk
pnpm install
pnpm build:core
```

`build:core`은 TypeSpec validation과 CLI가 요구하는 workspace dependency closure를 함께
materialize한다. fresh checkout에서 `@oa-sdk/codegen`만 단독 build하지 않는다.

### 2. 스키마 빌드 + 검증

```bash
pnpm schema:validate
node packages/codegen/dist/cli/index.js validate \
  --spec packages/schemas/src/.merged.yaml \
  --require-32
```

```
━━━ Step 1: 파싱 + 구조 검증 ━━━
✅ Valid — 0 warnings, 0 infos
━━━ Step 2: 3.1 호환성 ━━━
  3.2 전용 필드 사용: 실제 문서에서 사용된 3.2 전용 필드와 횟수가 출력된다
```

### 3. TypeScript 타입 생성

```bash
mkdir -p apps/playground/.oa-sdk/quick-start
node packages/codegen/dist/cli/index.js typegen \
  --spec packages/schemas/src/.merged.yaml \
  --output apps/playground/.oa-sdk/quick-start/types.ts
```

`apps/playground/.oa-sdk/quick-start/types.ts`가 생성되어야 한다. 다음 단계에서 private
generator API의 `typesImport` 옵션으로 사용한다.

```typescript
/** 사용자 정보 */
export type User = {
  /** @format date-time */
  createdAt: string
  id: string
  /** 이메일 주소 */
  email: string
  name: string
  role: 'admin' | 'user' | 'guest'
}

export type ListUsersResponse = { items: User[]; total: number }
export type CreateUserBody = CreateUserRequest
export type CreateUserResponse = User
export type CreateUserOp = { method: 'post'; path: '/users'; body: CreateUserBody; response: CreateUserResponse }
```

위 TypeScript는 생성 결과의 일부다. 실제 `types.ts`에는 스펙의 모든 schema와 operation이
포함된다.

### 4. 라우터 + 클라이언트 private integration 생성

라우터·클라이언트·mock server는 private downstream package이므로 별도로 빌드한다.

```bash
pnpm build:downstream
```

세 package의 `dist`가 생성된 뒤 다음 명령을 실행한다.

`oa-gen`의 공개 CLI에는 `router`나 `client` command가 없다. private workspace에서 package API를
호출하는 생성 script가 output을 소유한다. `@oa-sdk/router`는 **다중 프레임워크 바인더**(Hono, Express, Fastify, Bun Elysia)와 **순수 핸들러 계약 분리(Handler Contract Separation)**를 지원한다:
- **Fastify (`target: 'fastify'`)**: `FastifyPluginAsync` 패턴으로 방출되며, OpenAPI 3.2 Schema를 Fastify의 라우트 옵션 `schema: { params, querystring, body, response }`로 인라인 주입하여 `fast-json-stringify` JIT 직렬화 가속을 활성화합니다 (OAS 3.2 `QUERY`, `HEAD`, `TRACE` 지원).
- **Bun Elysia (`target: 'elysia'`)**: fluent 빌더 메서드 체이닝 `new Elysia().get().post()`과 선택적 Zero-copy 컨텍스트 구조분해(`{ params, query, body, set }`)를 통해 TS6133 미사용 변수 경고 없이 초고속 처리를 달성합니다.
- **핸들러 계약 분리 (`generateHandlerContract`)**: 순수 TypeScript 인터페이스 `ApiHandlers`, `<Operation>Context`, `HandlerResponse`를 담은 `routes.contract.ts`를 생성하여 비즈니스 로직과 라우팅 배선을 물리적으로 분리합니다. 스펙 재생성 시에도 비즈니스 로직이 덮어쓰여지지 않습니다 (0 framework runtime dependencies).

아래 script는 root `.gitignore`가 제외하는
`apps/playground/.oa-sdk/quick-start/generate-integrations.ts`에 저장한다. 따라서 튜토리얼을
실행해도 tracked `examples/` 파일이 생기지 않는다.

```typescript
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateClient } from '@oa-sdk/client'
import { generateRouter, generateHandlerContract } from '@oa-sdk/router'
import type { OasDocument } from '@oa-sdk/parser'
import { parse } from 'yaml'

const quickStartDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(quickStartDirectory, '../../../..')
const spec = parse(readFileSync(resolve(repositoryRoot, 'packages/schemas/src/.merged.yaml'), 'utf8')) as OasDocument

// 1. 순수 TypeScript 핸들러 계약 분리 생성 (비즈니스 로직 덮어쓰기 원천 차단)
writeFileSync(resolve(quickStartDirectory, 'api.contract.ts'), generateHandlerContract(spec, { typesImport: './types.js' }))

// 2. 프레임워크 라우터 바인더 생성 (Fastify JIT 스키마 인라인 가속 또는 Elysia, Hono, Express)
writeFileSync(resolve(quickStartDirectory, 'router.ts'), generateRouter(spec, { target: 'hono', typesImport: './types.js', contractImport: './api.contract.js' }))

// 3. 타입 안전 클라이언트 SDK 생성
writeFileSync(resolve(quickStartDirectory, 'client.ts'), generateClient(spec, { typesImport: './types.js' }))
```

```bash
pnpm --filter @oa-sdk/playground exec tsx .oa-sdk/quick-start/generate-integrations.ts
```

이 튜토리얼의 공개 npm 경로는 `oa-gen validate`와 `oa-gen typegen`이다. router/client integration은
배포 후보가 아닌 private downstream package 경계이며, 자세한 구조는
[코드젠 워크플로](./use-cases/codegen-workflow.md)를 따른다.

playground의 기본 TypeScript 설정은 NodeNext이므로 generated file은 type-only import에도
`./types.js` specifier를 사용한다. TypeScript는 이를 sibling `types.ts`로 해석한다.

### 5. Mock 서버 테스트

`@oa-sdk/mock-server`는 private workspace package이므로 root가 아닌
`apps/playground` workspace에서 예제를 실행한다.

```bash
pnpm --filter @oa-sdk/playground exec tsx examples/quick-start-mock.ts
```

다음 결과가 표시되어야 한다.

```text
Mock server request OK: 201
Validation failure: 422 /body/email: 필수 필드 누락: 'email'
```

전체 코드는 [quick-start-mock.ts](../../apps/playground/examples/quick-start-mock.ts)에
있다. 이 예제는 정상 요청과 인증된 검증 실패 요청을 확인한 뒤 `finally`에서 서버를
종료한다.

### 6. API 탐색

```typescript
import { parseDocument, describeApi } from '@oa-sdk/parser'
// `spec`는 앞 절에서 .merged.yaml을 읽어 만든 값을 재사용한다.

console.log(describeApi(parseDocument(spec)))
```

```
OA SDK API v0.5.0
서버: http://localhost:4010, http://localhost:3000
스키마: 49개
오퍼레이션: 34개

[world-model] — World Model Kernel — World bootstrap, stimulus ingress, revision-pinned projection query
  GET /world-model/execution-profiles — 선택 가능한 실행 profile 목록
  POST /worlds — 새 World bootstrap
  ...

(나머지 tag와 operation은 생략)
```

### 7. 데모

```bash
pnpm demo
```

### 8. 3.1 호환 (Swagger UI)

```bash
pnpm --filter @oa-sdk/schemas run downgrade:3.1
# → .merged.3.1.yaml (순수 3.1) + .merged.3.1.meta.json (사이드카)
```

## 다음 단계

→ [프로젝트 온보딩 플레이북](./onboarding-playbook.md) — 3계층 온보딩 사다리(Fastify, Bun Elysia, Express, NestJS) 및 마찰 제로 통합 가이드
→ [Mock 테스팅](./use-cases/mock-testing.md) — 테스트 패턴 + 커버리지 추적
→ [코드젠 워크플로](./use-cases/codegen-workflow.md) — 전체 파이프라인
→ [테스트 피드백](./use-cases/test-feedback.md) — 에러 분석 + API 탐색
→ [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 명령과 조건부 옵션
→ [CLI 세팅](./cli-setup.md) — production/OpenAPI governance workflow
→ [라이브러리 진입점 지도](./library-entrypoints.md) — package와 public import 경계
→ [기본 스펙 사용 기준](./basic-spec-usage.md) — source/artifact/사용처와 구조 경계
→ [시스템 온보딩 가이드](./system-onboarding.md) — oa-sdk 모노레포 기여자 전용 환경 구축 및 테스트 검증
→ [API 인덱스](../internal/api-index.md) — 타입·함수 SSOT
