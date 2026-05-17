# Goal 2 — Drizzle/TS ↔ OpenAPI 코드젠 브릿지

**상태: ✅ Phase 2~6 전부 완료**

## 달성된 목표 (Phase 2)

- Drizzle ORM 테이블 스키마 → OpenAPI `components/schemas` 자동 생성
- Zod 4 스키마 → OAS 3.2 JSON Schema 2020-12 변환
- select / insert / update 세 가지 스키마 타입 생성
- 기존 `spec.yaml`에 병합 (`mergeIntoSpec`)
- `oa-gen generate` CLI

## 미달성 목표 (향후 Phase)

- OAS 3.2 → TypeScript 타입 생성 (Phase 4)
- OAS 3.2 → 서버 라우터 스텁 (Phase 5)
- OAS 3.2 → 클라이언트 SDK (Phase 6)

자세한 로드맵 → [plan.md](../plan.md)

---

## 패키지

`packages/codegen` (`@oa-sdk/codegen`)

## 구현

### Drizzle → OAS 파이프라인

```
Drizzle 스키마 파일 (.ts)
  ↓ extractTablesFromPath()      ← Symbol.for('drizzle:IsDrizzleTable') 감지
ExtractedTable[] (sqlName, table, dialect)
  ↓ convertTables()              ← drizzle-orm/zod: createSelectSchema 등
Zod 4 스키마
  ↓ zodToSchema()                ← Zod 4 → OAS 3.2 Schema
OasSchema
  ↓ generateFromDrizzle()        ← components.yaml 출력 or spec.yaml 병합
```

### Zod 4 타입 지원

| 카테고리 | 지원 타입 |
|----------|----------|
| 원시 타입 | string, number, bigint, boolean, date, null, undefined, void, any, unknown, never |
| 래퍼 | optional, nullable, default, catch, pipe (transform), readonly, lazy |
| 복합 | object, array, tuple, record, map, set |
| 조합 | union, discriminatedUnion, intersection |
| 값 | literal (단일/복수), enum, nativeEnum |

### 출력 예시

```yaml
# components.yaml (생성 결과)
components:
  schemas:
    User:
      type: object
      properties:
        id: { type: integer }
        name: { type: string }
        email: { type: string, format: email }
      required: [id, name, email]
    InsertUser:
      type: object
      properties:
        name: { type: string }
        email: { type: string, format: email }
      required: [name, email]
    UpdateUser:
      type: object
      properties:
        name: { type: string }
        email: { type: string, format: email }
```

### API

```typescript
import { generateFromDrizzle } from '@oa-sdk/codegen/drizzle'

await generateFromDrizzle({
  schemaPath: './src/db/schema.ts',
  output: './packages/schemas/src/fragments/schema/public/users/',
  schemas: ['select', 'insert', 'update'],  // 기본값: 전체
})

// spec.yaml에 직접 병합
await generateFromDrizzle({
  schemaPath: './src/db/schema.ts',
  mergeIntoSpec: true,
  specPath: './packages/schemas/src/fragments/schema/public/users/User.yaml',
})
```

### CLI

```bash
# codegen.config.mjs 기반
oa-gen generate --config codegen.config.mjs
```

## 알려진 제약

- drizzle-orm 1.x 전용 (`drizzle-orm/zod` 내장 버전)
- drizzle-orm/zod는 Zod 4를 내부적으로 사용 — 동일 버전이어야 함
- `lazy` (재귀 스키마)는 `{}` 반환 — `$ref` 수동 처리 필요
