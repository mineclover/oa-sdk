# SchemaAlgebra — fold 기반 스키마 해석 패턴

> `@oa-sdk/parser`의 `foldSchema()` + `SchemaAlgebra<T>` 패턴 사용법.
> Phase 4~6(타입 생성, 라우터, 클라이언트)의 핵심 빌딩 블록.

---

## 개념

```
foldSchema(schema, algebra) → T
```

- **foldSchema**: 스키마 트리를 재귀 순회 (타입 분기, 자식 처리)
- **SchemaAlgebra\<T>**: 각 노드에서 `T`를 만드는 방법 (의미 해석)

순회와 의미가 분리되어 있으므로, 같은 스키마에 다른 algebra를 적용하면 다른 결과를 얻는다:

| T | algebra | 용도 |
|---|---------|------|
| `unknown` | `generateAlgebra` | 최소 유효 값 생성 (mock-server) |
| `string` | `typescriptAlgebra` | TypeScript 타입 문자열 생성 (codegen Phase 4) |
| `OasSchema` | 변환 algebra | 스키마 → 스키마 변환 |

---

## foldSchema 순회 규칙

```
입력 노드
  │
  ├─ null / 비객체 / 배열 → fallback(node)
  ├─ { $ref: "..." }     → ref(refString)
  ├─ { example: ... }    → example(value)     ← 타입보다 우선
  ├─ { default: ... }    → default_(value)    ← example 없을 때
  ├─ { allOf: [...] }    → allOf(schema, branches.map(fold))
  ├─ { oneOf: [...] }    → oneOf(schema, branches.map(fold))
  ├─ { anyOf: [...] }    → anyOf(schema, branches.map(fold))
  └─ type 분기:
       string  → string(schema)
       integer → integer(schema)
       number  → number(schema)
       boolean → boolean(schema)
       null    → null(schema)
       object  → object(schema, foldedProperties)
       array   → array(schema, foldedItems)
       기타    → fallback(node)
```

**중요**: `example`/`default`가 있으면 `type` 분기를 타지 않음. algebra 구현에서 이를 활용해 예시 값을 직접 반환할 수 있다.

---

## SchemaAlgebra\<T> 인터페이스

```typescript
type SchemaAlgebra<T> = {
  // 리프
  string(schema: OasSchema): T
  integer(schema: OasSchema): T
  number(schema: OasSchema): T
  boolean(schema: OasSchema): T
  null(schema: OasSchema): T

  // 복합 (자식이 미리 fold됨)
  object(schema: OasSchema, properties: Record<string, T>): T
  array(schema: OasSchema, items: T | null): T

  // 조합 (모든 브랜치가 fold됨)
  allOf(schema: OasSchema, branches: T[]): T
  oneOf(schema: OasSchema, branches: T[]): T
  anyOf(schema: OasSchema, branches: T[]): T

  // 특수
  ref(ref: string): T
  example(value: unknown): T
  default_(value: unknown): T
  fallback(node: unknown): T
}
```

---

## 사용 예시: 값 생성 (GenerateFolder)

```typescript
const generateAlgebra: SchemaAlgebra<unknown> = {
  string:  (s) => s.enum?.[0] ?? formatDefault(s.format) ?? '',
  integer: (s) => s.minimum ?? 0,
  number:  (s) => s.minimum ?? 0,
  boolean: () => false,
  null:    () => null,
  object:  (s, props) => {
    // required 필드만 포함
    const result: Record<string, unknown> = {}
    for (const key of s.required ?? []) {
      if (key in props) result[key] = props[key]
    }
    return result
  },
  array:   () => [],
  allOf:   (_, branches) => branches[0],
  oneOf:   (_, branches) => branches[0],
  anyOf:   (_, branches) => branches[0],
  ref:     () => null,
  example: (v) => v,
  default_:(v) => v,
  fallback:() => null,
}

foldSchema({ type: 'string', format: 'email' }, generateAlgebra)
// → 'example@example.com'
```

---

## 사용 예시: TypeScript 타입 문자열 생성

```typescript
const tsAlgebra: SchemaAlgebra<string> = {
  string:  () => 'string',
  integer: () => 'number',
  number:  () => 'number',
  boolean: () => 'boolean',
  null:    () => 'null',
  object:  (s, props) => {
    const fields = Object.entries(props)
      .map(([k, t]) => `${k}: ${t}`)
      .join('; ')
    return `{ ${fields} }`
  },
  array:   (_, items) => `${items ?? 'unknown'}[]`,
  allOf:   (_, b) => b.join(' & '),
  oneOf:   (_, b) => b.join(' | '),
  anyOf:   (_, b) => b.join(' | '),
  ref:     (r) => r.split('/').pop() ?? 'unknown',
  example: () => 'unknown',
  default_:() => 'unknown',
  fallback:() => 'unknown',
}

foldSchema({ type: 'object', properties: { id: { type: 'string' }, age: { type: 'integer' } } }, tsAlgebra)
// → '{ id: string; age: number }'
```

---

## GenerateFolder 확장 (클래스 기반)

```typescript
class CustomFolder extends GenerateFolder {
  protected override generateString(schema: OasSchema): string {
    return schema.format === 'uuid'
      ? crypto.randomUUID()  // Faker 대신 실제 UUID
      : super.generateString(schema)
  }
}

const value = new CustomFolder().fold({ type: 'string', format: 'uuid' })
// → '550e8400-e29b-41d4-a716-446655440000'
```

---

## 핵심 원칙

1. **foldSchema는 순회만** — 타입 분기와 재귀만 담당. 의미 해석 없음.
2. **algebra는 의미만** — 각 노드에서 T를 만드는 순수 함수.
3. **example/default가 type보다 우선** — mock 데이터 생성 시 스펙 작성자 의도 존중.
4. **조합은 모든 브랜치 fold** — `allOf`/`oneOf`/`anyOf` 모두 전체 브랜치의 결과를 배열로 전달. algebra가 어떤 브랜치를 선택할지 결정.
