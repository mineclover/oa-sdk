# 백엔드 핸들러 계약 구현 가이드 (Backend Handler Contracts & Framework Binders)

`@oa-sdk/router`는 OpenAPI 3.1/3.2 스펙으로부터 **순수 핸들러 인터페이스 계약(`*.contract.ts`)**과 **프레임워크별 고속 라우터 바인더**를 분리하여 생성합니다.

이 가이드는 백엔드 엔지니어가 스키마 재생성 시 코드 덮어쓰기 사고(Regeneration Anxiety) 없이 비즈니스 로직을 안전하게 구현하고, 프레임워크(Fastify, Elysia, Hono, Express)에 독립적인 클린 아키텍처를 유지하는 방법을 다룹니다.

---

## 1. 핵심 아키텍처: 3중 분리 원칙 (Tri-Separation)

기존의 코드 생성 도구(Swagger Codegen 등)는 컨트롤러 스텁 파일 하나에 라우팅, 유효성 검사, 비즈니스 로직 템플릿을 한꺼번에 생성하여, 스펙이 변경될 때마다 개발자가 손수 작성한 코드가 지워질 위험(덮어쓰기 딜레마)이 있었습니다.

`@oa-sdk/router`는 역할을 엄격히 3개 파일로 격리합니다:

```
┌───────────────────────────────────┐
│ 1. 순수 계약 (api.contract.ts)   │ ◄── oa-gen으로 매번 100% 안전하게 재생성
│    - 핸들러 인터페이스 정의       │     (런타임 프레임워크 의존성 0개)
│    - 입출력 타입 & Context        │
└─────────────────┬─────────────────┘
                  │ implements
┌─────────────────▼─────────────────┐
│ 2. 비즈니스 로직 (user.service.ts) │ ◄── 개발자가 순수 TypeScript로 작성
│    - DB 쿼리, 도메인 비즈니스     │     (코드 생성기가 절대 덮어쓰지 않음!)
│    - HandlerResponse 반환         │
└─────────────────┬─────────────────┘
                  │ binds
┌─────────────────▼─────────────────┐
│ 3. 프레임워크 바인더 (router.ts)  │ ◄── 프레임워크 어댑터 (Fastify / Hono / Elysia)
│    - JIT 스키마 컴파일 / 제로카피  │     (바인더만 교체하면 프레임워크 즉시 전환)
└───────────────────────────────────┘
```

---

## 2. 순수 핸들러 계약 (`api.contract.ts`)

`oa-gen init --target <framework>` 또는 `oa-gen generate`를 실행하면 프레임워크 의존성이 없는 순수 인터페이스가 생성됩니다.

```typescript
// api.contract.ts (자동 생성물 - 직접 수정 금지)
import type { HandlerResponse } from '@oa-sdk/router';

export interface GetUserContext {
  params: { userId: string };
  query?: { includeHistory?: boolean };
  headers: Record<string, string>;
}

export type GetUserResponse =
  | HandlerResponse<200, UserProfile>
  | HandlerResponse<404, ErrorPayload>;

export interface ApiHandlers {
  getUser(ctx: GetUserContext): Promise<GetUserResponse> | GetUserResponse;
  updateUser(ctx: UpdateUserContext): Promise<UpdateUserResponse> | UpdateUserResponse;
  // ... 스펙에 정의된 모든 오퍼레이션
}
```

---

## 3. 비즈니스 서비스 구현하기 (`user.service.ts`)

개발자는 `ApiHandlers` 인터페이스를 구현하는 클래스나 객체를 작성합니다. 이 파일은 코드 생성기가 절대 건드리지 않으므로 안전합니다.

### 3.1 엄격한 `HandlerResponse` 타입 검사
TypeScript 컴파일러는 OpenAPI 스펙에 선언된 상태 코드와 응답 바디 타입만을 반환하도록 강제합니다. 스펙에 없는 상태 코드나 속성을 반환하면 컴파일 에러가 발생합니다.

```typescript
// services/user.service.ts
import type { ApiHandlers, GetUserContext, GetUserResponse } from '../api.contract';
import { db } from '../db';

export class UserService implements Partial<ApiHandlers> {
  async getUser({ params, query }: GetUserContext): Promise<GetUserResponse> {
    const user = await db.users.findById(params.userId);

    // 1. 404 에러 반환 (스펙에 404 스키마가 정의되어 있어야 유효함)
    if (!user) {
      return {
        status: 404,
        body: {
          code: 'USER_NOT_FOUND',
          message: `User with id ${params.userId} not found`
        }
      };
    }

    // 2. 200 성공 반환
    return {
      status: 200,
      body: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt.toISOString()
      }
    };
  }
}
```

---

---

## 4. 프레임워크 바인더 연결 (Framework Router Mounting)

`@oa-sdk/router`는 각 웹 프레임워크의 네이티브 플러그인 또는 라우터 팩토리 함수를 생성합니다. 프레임워크 전용 문법을 복잡하게 배울 필요 없이, 생성된 라우터에 비즈니스 핸들러(`UserService`)를 전달하기만 하면 연결이 완료됩니다.

### Fastify (JIT 스키마 컴파일 플러그인)
Fastify의 표준 플러그인 규격(`FastifyPluginAsync`)으로 방출되며, OpenAPI 스키마가 인라인되어 `fast-json-stringify` JIT 직렬화로 최대 처리량을 냅니다.
```typescript
import Fastify from 'fastify';
import { apiRouter } from './api.fastify';
import { UserService } from './services/user.service';

const app = Fastify();

// FastifyPluginAsync 등록: options.handlers로 비즈니스 서비스 주입
await app.register(apiRouter, { handlers: new UserService() });

await app.listen({ port: 3000 });
```

### Hono (Cloudflare Workers / Node / Bun 이식성)
`createRouter(handlers)` 함수를 통해 순수 `Hono` 인스턴스를 반환하므로, 서브라우트로 마운트하거나 직접 export할 수 있습니다.
```typescript
import { Hono } from 'hono';
import { createRouter } from './api.hono';
import { UserService } from './services/user.service';

// 핸들러를 주입하여 Hono 라우터 인스턴스 생성
const apiApp = createRouter(new UserService());

const app = new Hono();
app.route('/v1', apiApp);

export default app;
```

### Bun + Elysia (Zero-Copy 지원)
`createRouter(handlers)` 함수를 통해 `Elysia` 인스턴스를 반환하며, Bun의 고속 네이티브 환경에서 `app.use()`로 즉시 합성됩니다.
```typescript
import { Elysia } from 'elysia';
import { createRouter } from './api.elysia';
import { UserService } from './services/user.service';

const app = new Elysia()
  .use(createRouter(new UserService()))
  .listen(3000);

console.log(`Server listening at ${app.server?.url}`);
```

### Express (기존 레거시 서버 호환)
표준 `express.Router` 인스턴스를 방출하여 기존 Express 미들웨어 스택에 즉시 장착할 수 있습니다.
```typescript
import express from 'express';
import { createRouter } from './api.express';
import { UserService } from './services/user.service';

const app = express();
app.use(express.json());

// Express 서브 라우터로 마운트
app.use('/api', createRouter(new UserService()));

app.listen(3000);
```

---

## 5. `HandlerResponse`의 유연한 반환 패턴

`HandlerResponse`는 컴파일 타임의 엄격함과 실무 개발의 생산성을 동시에 제공합니다:

1. **원시 바디 직접 반환 (Shorthand)**:
   - 성공 시 상태 코드를 매번 객체로 감쌀 필요 없이, 데이터 객체를 바로 반환할 수 있습니다.
   - `return user;` ➔ 자동으로 HTTP 200 + `application/json`으로 응답.
2. **상세 헤더 및 상태 코드 지정**:
   - `return { status: 200, body: user, headers: { 'Cache-Control': 'max-age=3600' } };`
3. **스펙 기반 엄격한 에러 반환**:
   - 스펙에 정의된 에러 모델 및 상태 코드에 맞게 반환:
   - `return { status: 404, body: { code: 'NOT_FOUND', message: '...' } };`
4. **실시간 스트리밍 바디 (Streaming)**:
   - `ReadableStream`, `AsyncIterable`, `Uint8Array`를 반환하여 SSE 및 청크 스트리밍 처리 지원.

---

## 6. 온보딩 및 빠른 시작 (`oa-gen init`)

새로운 프로젝트나 기존 프로젝트에 백엔드 라우터를 세팅하려면 인터랙티브 온보딩 명령을 실행합니다:

```bash
# 원하는 대상 프레임워크를 지정하여 30초 온보딩
oa-gen init --target fastify --yes
```

이 명령어는 다음 작업을 비파괴적으로 수행합니다:
1. `oa.config.ts` 설정 파일 생성 (대상 프레임워크 타겟 및 코어 계약 구성)
2. `package.json`의 scripts에 `generate:router` 자동 등록
3. 프레임워크 바인더 템플릿 생성 및 진입점 연결
