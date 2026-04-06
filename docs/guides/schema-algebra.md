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

순회와 의미가 분리되어 있으므로, 같은 스키마에 다른 algebra를 적용하면 다른 결과를 얻는다.

---

## 두 가지 패턴

스키마/스펙 트리를 해석하는 두 가지 상호보완적 패턴이 있다.

### 함수형 패턴: `foldSchema` + `SchemaAlgebra<T>`

순회(foldSchema)와 의미 해석(algebra)이 완전히 분리된다. `T`를 교체하면 동일한 스키마에서 다른 결과물을 얻는다.

- **순회**: `foldSchema`가 스키마 트리를 재귀 탐색하며 타입 분기, 자식 처리를 담당
- **의미**: `SchemaAlgebra<T>`가 각 노드에서 `T`를 만드는 순수 함수 집합

현재 구현체:
- `generateAlgebra` (T=unknown) -- mock 값 생성
- `typescriptAlgebra` (T=string) -- TypeScript 타입 문자열 생성

### 클래스 패턴: `SchemaFolder` + 서브클래스

SWC의 Fold trait에서 영감을 받은 패턴. 전체 스펙 트리를 재귀 순회하며 새 노드를 반환한다. `foldRef` / `foldObject` 등을 오버라이드하여 특정 노드의 처리를 커스터마이징한다.

현재 구현체:
- `DerefFolder` -- $ref 인라인 전개

---

### 구현체 종합표

| T | algebra/class | 패키지 | 용도 |
|---|--------------|--------|------|
| `unknown` | `generateAlgebra` | mock-server | 최소 유효 값 생성 |
| `string` | `typescriptAlgebra` | codegen | TypeScript 타입 문자열 |
| `OasSchema` | `DerefFolder` | parser | $ref 인라인 전개 |
| -- | `StreamFolder` | mock-server | 스키마 기반 SSE/NDJSON 스트림 |

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

## SchemaFolder 패턴

`SchemaFolder`는 스펙 트리 전체를 재귀 순회하며 새 노드를 반환하는 클래스 기반 패턴이다.

```typescript
abstract class SchemaFolder {
  fold(node): unknown           // 진입점, 타입 분류
  protected foldRef(ref, node)  // $ref 처리 (기본: no-op)
  protected foldObject(obj)     // 객체 처리 (기본: foldChildren)
  protected foldChildren(obj)   // 모든 값 재귀 fold
}
```

### DerefFolder -- 구체 구현체

`DerefFolder`는 `SchemaFolder`를 확장하여 `$ref`를 인라인 전개한다.

- **순환 참조 감지**: stack 기반으로 현재 순회 경로를 추적하여 무한 재귀를 방지
- **외부 ref 유지**: 같은 문서 내 `$ref`만 전개하고, 외부 ref는 원본 그대로 유지
- **RFC 6901 JSON Pointer 해석**: `#/components/schemas/User` 형식의 JSON Pointer를 해석하여 대상 스키마를 찾음

---

## SpecPass 파이프라인

스펙 문서를 단계별로 변환하는 파이프라인 패턴. 각 pass는 이름과 변환 함수를 가진다.

```typescript
type SpecPass = { name: string; run(spec): OasDocument }
runPipeline(spec, [derefPass, ...customPasses])
```

pass를 조합하여 deref -> lint -> custom 순으로 스펙을 정규화할 수 있다.

---

## example/default 단축 평가 우회

`foldSchema`는 `example`/`default`가 있으면 `type` 분기보다 먼저 단축 평가(short-circuit)한다. mock 데이터 생성 시에는 이 동작이 유용하지만, 타입 생성 시에는 `example` 값이 아닌 실제 타입 구조가 필요하다.

이를 위해 `schemaToTs`는 fold 전에 `stripExamples()`로 example/default를 제거한다:

```typescript
// 타입 생성 시 -- example/default 제거 후 fold
const clean = stripExamples(schema)
foldSchema(clean, typescriptAlgebra)
```

이 패턴은 algebra의 `example()` / `default_()` 콜백에 도달하지 않도록 보장하므로, 타입 정보만으로 결과를 생성할 수 있다.

---

## RouteFilter

mock-server는 `include` 옵션을 통해 부분적 핸들러 생성을 지원한다. 전체 스펙 중 필요한 경로/태그만 선택하여 핸들러를 생성할 수 있다:

```typescript
createMswHandlers(spec, { include: { paths: ['/users'], tags: ['admin'] } })
```

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

### 합성 패턴: StreamFolder

상속 외에 합성(has-a)으로도 확장할 수 있다. `StreamFolder`는 `GenerateFolder`를 내부에 보유하여 스키마 기반 SSE/NDJSON 스트림을 생성한다.

```typescript
// 상속: GenerateFolder 확장
class CustomFolder extends GenerateFolder { ... }

// 합성: StreamFolder는 GenerateFolder를 has-a로 보유
const streamer = new StreamFolder(new CustomFolder())
```

---

## 핵심 원칙

1. **foldSchema는 순회만** — 타입 분기와 재귀만 담당. 의미 해석 없음.
2. **algebra는 의미만** — 각 노드에서 T를 만드는 순수 함수.
3. **example/default가 type보다 우선** — mock 데이터 생성 시 스펙 작성자 의도 존중.
4. **조합은 모든 브랜치 fold** — `allOf`/`oneOf`/`anyOf` 모두 전체 브랜치의 결과를 배열로 전달. algebra가 어떤 브랜치를 선택할지 결정.
