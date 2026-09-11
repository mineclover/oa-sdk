# @oa-sdk/core

OA SDK 패키지와 소비자가 함께 쓰는 ESM 유틸리티입니다. It provides string,
code-generation, formatting, response-selection, and Node HTTP helpers; it is
not a complete API client or OpenAPI parser.

## Install / 설치

```bash
npm install @oa-sdk/core
```

Node.js **22 이상** (`>=22.0.0`)이 필요합니다.

## Supported imports / 지원 import 경계

- `@oa-sdk/core`는 Node용 root entry point이며 `pascalCase`,
  `formatGeneratedTs`, `createHttpServer` 등을 제공합니다.
- `@oa-sdk/core/browser`는 browser-safe entry point이며 Node HTTP helper를
  제외합니다.

이 두 exported path만 지원합니다. `src/` 또는 `dist/` 파일을 deep import하지
마세요.

## Minimal ESM example / 최소 ESM 예제

```js
import { pascalCase, toColonPath } from '@oa-sdk/core'

console.log(pascalCase('list_users')) // ListUsers
console.log(toColonPath('/users/{userId}')) // /users/:userId
```

## Wire-Format Safety / 직렬화 타입 안정성

`@oa-sdk/core`는 JSON 직렬화 경계에서 함수, 메서드, 게터, 심볼, 클래스 프로토타입을 제거하고 원시 타입(`Date` → `string`)으로 변환하는 wire-safe 유틸리티 타입을 제공합니다:

```typescript
import type { JsonPrimitive, Resolved } from '@oa-sdk/core'

type ApiPayload = Resolved<{
  id: string
  created: Date
  computeHash(): string
}>
// Result: { id: string; created: string }
```

지원 symbol의 기준은 package root와 `./browser` export가 제공하는 TypeScript declaration이다.
공개 artifact에는 private source repository의 문서·테스트·개발 이력이 포함되지 않는다.

