---
docType: tutorial
sourceLocale: ko
canonical: true
audience:
  competence: novice
productVersions:
  - "@oa-sdk/codegen 0.6.0 source release candidate (npm latest 0.5.0 until promotion)"
  - "OA SDK API contract 0.5.0"
tested:
  environment: "Node.js 24 LTS+, pnpm 10.30.3, repository checkout"
  at: "2026-08-30"
owner: "OA SDK maintainers"
reviewDue: "2026-11-10"
status: active
sourceOfTruth:
  - package.json
  - packages/codegen/package.json
  - packages/router/package.json
  - packages/client/package.json
  - packages/mock-server/package.json
  - packages/schemas/typespec/version.tsp
  - packages/schemas/typespec/approved.openapi.yaml
---

# Quick Start

5분 안에 oa-sdk 전 파이프라인을 체험합니다.

## 공개 CLI만 사용할 때

비공개 monorepo가 필요 없는 consumer는 공개 npm 배포본으로 자신의 OpenAPI 문서를 검증·생성할
수 있다. `@oa-sdk/codegen`은 `oa-gen` CLI와 필요한 core runtime dependency를 함께 제공한다.

```bash
npm install --save-dev @oa-sdk/codegen
npx oa-gen validate --spec ./openapi.yaml --require-32
npx oa-gen typegen --spec ./openapi.yaml -o types.ts
```

현재 공개 `latest`는 `@oa-sdk/codegen@0.5.0`이며, `0.6.0`은 artifact review 대기 중인
source release candidate다. artifact-only release repository와 npm 무결성 검증을 거쳐
promotion되기 전에는 `0.6.0`을 public install target으로 안내하지 않는다. OA SDK 자체
production schema를 작성하거나 변경하려면 아래의 비공개 source workflow를 사용한다.

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
호출하는 생성 script가 output을 소유한다. 아래 script는 root `.gitignore`가 제외하는
`apps/playground/.oa-sdk/quick-start/generate-integrations.ts`에 저장한다. 따라서 튜토리얼을
실행해도 tracked `examples/` 파일이 생기지 않는다.

```typescript
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateClient } from '@oa-sdk/client'
import { generateRouter } from '@oa-sdk/router'
import type { OasDocument } from '@oa-sdk/parser'
import { parse } from 'yaml'

const quickStartDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(quickStartDirectory, '../../../..')
const spec = parse(readFileSync(resolve(repositoryRoot, 'packages/schemas/src/.merged.yaml'), 'utf8')) as OasDocument
writeFileSync(resolve(quickStartDirectory, 'router.ts'), generateRouter(spec, { typesImport: './types.js' }))
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

→ [Mock 테스팅](./use-cases/mock-testing.md) — 테스트 패턴 + 커버리지 추적
→ [코드젠 워크플로](./use-cases/codegen-workflow.md) — 전체 파이프라인
→ [테스트 피드백](./use-cases/test-feedback.md) — 에러 분석 + API 탐색
→ [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 명령과 조건부 옵션
→ [CLI 세팅](./cli-setup.md) — production/OpenAPI governance workflow
→ [라이브러리 진입점 지도](./library-entrypoints.md) — package와 public import 경계
→ [기본 스펙 사용 기준](./basic-spec-usage.md) — source/artifact/사용처와 구조 경계
→ [API 인덱스](../internal/api-index.md) — 타입·함수 SSOT
