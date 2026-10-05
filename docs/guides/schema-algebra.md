# SchemaAlgebra — fold 기반 스키마 해석 패턴

> `@oa-sdk/parser`의 `foldSchema()` + `SchemaAlgebra<T>` 패턴 사용법.
> 타입 생성(`@oa-sdk/codegen`)과 mock 값 생성(`@oa-sdk/mock-server`)이 이 패턴을 씁니다.
> 동작 기준: `@oa-sdk/parser` 0.4.0. parser를 직접 다루는 기여자와 라이브러리 사용자용 문서입니다.

---

## 개념

```
foldSchema(schema, algebra) → T
```

- **foldSchema**: 스키마 트리를 재귀 순회 (타입 분기, 자식 처리)
- **SchemaAlgebra\<T>**: 각 노드에서 `T`를 만드는 방법 (의미 해석)

순회와 의미가 분리되어 있으므로, 같은 스키마에 다른 algebra를 적용하면 다른 결과를 얻는다.

---

## 이론적 배경

`SchemaAlgebra<T>`는 함수형 프로그래밍의 **F-Algebra / Catamorphism** 패턴이다.

- **Catamorphism**: 재귀 데이터 구조를 bottom-up으로 접어서(fold) 하나의 값으로 축약하는 연산
- **F-Algebra**: 펑터 `F`와 캐리어 타입 `T`에 대해 `F<T> → T` 매핑을 정의하는 구조

이 프로젝트에서:
- **F** = OpenAPI 스키마 노드의 구조 (string, object, array, allOf, ...)
- **T** = algebra가 결정하는 결과 타입 (unknown, string, ...)
- **foldSchema** = 재귀를 담당하는 catamorphism 드라이버
- **SchemaAlgebra\<T>** = `F<T> → T` 매핑을 정의하는 algebra

TypeScript에는 Higher-Kinded Types가 없으므로, 인터페이스의 메서드 집합으로 algebra를 인코딩한다. 이는 Tagless Final 스타일의 실용적 변형이다.

현재 구현은 순수 catamorphism이 아닌 **paramorphism**에 가깝다. `object(schema, properties)` 처럼 fold된 자식(`properties`)과 원본 노드(`schema`)를 동시에 받아, algebra가 원본 메타데이터(required, description 등)를 참조할 수 있다.

### 대안 패턴과의 비교

| 패턴 | 설명 | 장점 | 이 프로젝트에 부적합한 이유 |
|---|---|---|---|
| **Visitor (GoF)** | 노드 타입별 visit 메서드 + accept 이중 디스패치 | OOP에서 익숙함 | 반환값 합성 어려움, 상태 mutation 의존 |
| **Recursion Schemes** | Fix point로 재귀 구조 자체를 추상화 (cata/ana/hylo) | 이론적으로 가장 강력 | TS에서 Fix 타입 표현에 boilerplate 과다 |
| **Pattern Matching + ADT** | discriminated union + switch 문 | TS 네이티브, 단순 | 각 소비자가 재귀를 직접 구현해야 함 (순회 중복) |
| **Tagless Final** | 타입 클래스 + HKT로 의미 해석 인코딩 | 완전한 합성 가능 | TS에 HKT 없음 → **현재 구현이 TS판 tagless final** |

**결론**: `SchemaAlgebra<T>` + `foldSchema`는 TypeScript 타입 시스템 한계 안에서 catamorphism의 가장 실용적인 인코딩이다.

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
- `DerefFolder` -- $ref 인라인 전개 (`SchemaFolder`를 확장하는 유일한 parser 클래스)

`$ref` 그래프 분석(`resolveRefGraph`, `projectRefGraph`)은 클래스가 아니라 일반 함수다. 아래 [RefGraph 패턴](#refgraph-패턴)을 본다.

---

### 구현체 종합표

| T | algebra/class | 패키지 | 용도 |
|---|--------------|--------|------|
| `unknown` | `generateAlgebra` | mock-server | 최소 유효 값 생성 |
| `string` | `typescriptAlgebra` | codegen | TypeScript 타입 문자열 |
| `OasSchema` | `DerefFolder` (class) | parser | $ref 인라인 전개 |
| `RefGraph` | `resolveRefGraph` (함수) | parser | `$ref` occurrence 목록, 누락/순환/source diagnostic |
| `RefProjection` | `projectRefGraph` (함수) | parser | 인라인 전개 없이 선언 간 `$ref`를 노드·엣지 그래프로 투영 |
| -- | `StreamFolder` (class) | mock-server | 스키마 기반 SSE/NDJSON 스트림 |

---

## foldSchema 순회 규칙

```
입력 노드
  │
  ├─ null / 비객체 / 배열 → fallback(node)
  ├─ { const: ... }      → const_(value)      ← algebra가 const_를 구현한 경우만. $ref보다 먼저
  ├─ { $ref: "..." }     → ref(refString)
  ├─ { example: ... }    → example(value)     ← 타입보다 우선
  ├─ { default: ... }    → default_(value)    ← example 없을 때
  ├─ { allOf: [...] }    → allOf(schema, branches.map(fold))
  ├─ { oneOf: [...] }    → oneOf(schema, branches.map(fold))
  ├─ { anyOf: [...] }    → anyOf(schema, branches.map(fold))
  ├─ { then / else }     → anyOf(schema, [fold(then), fold(else)])   ← if/then/else를 anyOf로 매핑
  ├─ { type: [...] }     → typeUnion(schema, 타입별 fold)  ← algebra가 typeUnion을 구현한 경우만
  └─ type 분기 (type 배열이면 첫 타입):
       string  → string(schema)
       integer → integer(schema)
       number  → number(schema)
       boolean → boolean(schema)
       null    → null(schema)
       object  → object(schema, foldedProperties)
       array   → array(schema, foldedItems)
       기타    → properties 존재 시 object(schema, foldedProperties)
                  없으면 fallback(node)
```

**중요**:
- `example`/`default`가 있으면 `type` 분기를 타지 않음. algebra 구현에서 이를 활용해 예시 값을 직접 반환할 수 있다.
- `const_`와 `typeUnion`은 선택 메서드다. 구현하지 않은 algebra는 `const`를 무시하고, `type` 배열에서는 첫 타입만 쓴다.
- `type` 미지정이더라도 `properties`가 있으면 `object`로 분기한다. typia 등 type 없이 properties만 있는 스키마를 처리하기 위함.

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

- **순환 참조 감지**: 전개 중인 대상을 stack으로 추적하여 무한 재귀를 방지 (아래 [순환 참조 방지](#순환-참조-방지))
- **외부 ref 해소**: `basePath` 옵션이 있으면 상대 YAML/JSON `$ref`를 현재 파일 기준으로 해소
- **sibling 보존**: `$ref` 옆의 `description`, `readOnly`, `annotations`, `properties`, `required` 등 구조 정보를 병합. 해소하지 못한 `$ref`는 그대로 두되 옆 필드는 전개한다
- **cycleStrategy**: 기본은 `empty-schema`, 필요 시 `preserve-ref`로 순환 지점 `$ref` 보존
- **전개 결과 공유**: 같은 대상의 전개 결과를 사용처끼리 공유한다(`RefExpansionMemo`). 결과 트리는 같은 하위 객체를 여러 곳에서 가리킬 수 있는 비순환 DAG이므로, 결과를 고칠 때는 복사한 뒤 고친다
- **RFC 6901 JSON Pointer 해석**: `#/components/schemas/User` 형식의 JSON Pointer를 해석하여 대상 스키마를 찾음

`derefSpec(spec, options)`가 이 클래스를 감싼 진입점이고, `derefSpecWithDiagnostics(spec, options)`는 결과 문서와 함께
`diagnostics`, `recursiveRefs`(유효한 재귀로 끊은 지점)를 돌려준다.

### JSON Pointer helper

`@oa-sdk/parser`(와 `@oa-sdk/parser/browser`)는 RFC 6901 helper를 export한다. `~`·`/` escape를 직접 구현하지 말고 이 함수를 쓴다.

| 함수 | 하는 일 |
|---|---|
| `formatJsonPointer(tokens)` | 토큰 배열 → JSON Pointer (`['paths', '/users/{id}', 'get']` → `/paths/~1users~1{id}/get`) |
| `appendJsonPointer(pointer, token)` | 포인터나 `#` fragment 뒤에 토큰 하나를 escape해 붙임 (`appendJsonPointer('#', 'a/b')` → `#/a~1b`) |
| `parseJsonPointer(pointer)` | JSON Pointer → 토큰 배열. 형식이 잘못되면 `undefined` |
| `escapeJsonPointerToken(token)`, `unescapeJsonPointerToken(token)` | 토큰 하나 escape·unescape (`~` → `~0`, `/` → `~1`) |

```typescript
import { formatJsonPointer, parseJsonPointer } from '@oa-sdk/parser'

const pointer = '#' + formatJsonPointer(['paths', '/books/{bookId}/notes', 'get'])
// → '#/paths/~1books~1{bookId}~1notes/get'
parseJsonPointer(pointer.slice(1))
// → ['paths', '/books/{bookId}/notes', 'get']
```

`formatJsonPointer`는 percent-encoding을 하지 않는다. `#`를 앞에 붙인 결과는 [Path Fragment Conventions](./path-fragment-conventions.md)의 좌표 표기와 같다.

---

## RefGraph 패턴

`resolveRefGraph(spec, { basePath })`는 스펙 전체의 `$ref` occurrence를 하나씩 노드로 수집한다(같은 occurrence는 한 번만).

- internal / external / unsupported ref 구분
- 외부 YAML/JSON 파일 재귀 탐색
- 외부 파일 내부의 상대 `$ref`는 해당 외부 파일 기준으로 해소
- 누락 파일, 누락 pointer, unsupported ref, 순환 ref를 diagnostic으로 보고. 순환은 instance 하위로 내려가지 않는 순환만 `ref-cycle`이다(아래 [순환 참조 방지](#순환-참조-방지))
- diagnostic은 `filePath#pointer` source를 포함할 수 있어 CLI에서 위치를 표시한다

`lintDocument()`와 `validateDocument()`는 ref graph diagnostic을 `refs/valid-ref` 또는 `refs/cycle`로 변환한다.
`typegen`은 ref graph를 사용해 외부 schema alias를 만들고 이름 충돌을 경고한다.

`projectRefGraph(spec, { basePath })`는 인라인 전개 없이 문서의 재사용 선언(`components.*` 항목, `paths`·`webhooks` 항목, 외부 파일의 참조 대상)을
노드로, `$ref` occurrence를 엣지로 투영한다. 순환 위의 엣지에는 `recursion: 'guarded' | 'unguarded'`가 붙는다. 출력 크기가
occurrence 수에 비례하므로 순환이 많은 문서도 그대로 시각화·편집 도구에 넘길 수 있다.

---

## SpecPass 파이프라인

스펙 문서를 단계별로 변환하는 파이프라인 패턴. 각 pass는 이름과 변환 함수를 가진다.

```typescript
type SpecPass = { name: string; resolvesRefs?: boolean; run(spec): OasDocument }
runPipeline(spec, [derefPass, ...customPasses])
```

pass를 조합하여 deref -> lint -> custom 순으로 스펙을 정규화할 수 있다.

`resolvesRefs`는 그 pass가 `$ref`를 해소한다는 선언이다. `createDerefPass()`가 설정하고, `derefSpec()`을 감싼 custom pass도 설정해야 한다. pipeline에 이런 pass가 있으면 `parseDocument()`와 `loadSchema()`의 route index는 남은 `$ref`를 해소하지 못한 ref로 보고 생략한다. 없으면 operation 위치의 로컬 `$ref`를 직접 해소한다.

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

mock-server는 `include` 옵션(`RouteFilter`)으로 스펙 일부만 서빙할 수 있다. `paths`(경로 prefix), `operations`(operationId),
`tags`, `filter`(predicate) 중 하나라도 맞으면 포함된다.

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server'

const server = createNodeMockServer(spec, { include: { paths: ['/users'], tags: ['admin'] } })
```

MSW 어댑터도 같은 옵션을 받는다. MSW 어댑터는 패키지 루트가 아니라 `@oa-sdk/mock-server/adapters/msw`에서 가져오며,
`msw`(2 이상)를 따로 설치해야 한다. 패키지 루트와 Node HTTP 어댑터는 `msw` 없이 동작한다.

```typescript
import { createMswHandlers } from '@oa-sdk/mock-server/adapters/msw'

export const handlers = createMswHandlers(spec, { include: { operations: ['listUsers'] } })
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
  // 선택: JSON Schema `type` 배열을 멤버별 fold 결과로 해석 (미구현이면 첫 타입만 사용)
  typeUnion?(schema: OasSchema, branches: T[]): T

  // 특수
  // 선택: `const` 값 (구현하면 $ref·example보다 먼저 호출)
  const_?(value: unknown): T
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

## 순환 참조 방지

재귀 구조에서 `$ref`가 자기 자신을 참조하면 무한 루프에 빠진다. 프로젝트 내 두 가지 방지 전략이 있다.

### Stack 기반 (DerefFolder)

`DerefFolder`는 전개 중인 대상을 stack으로 추적한다. stack 키는 (문서, JSON pointer) 쌍이다. 외부 문서 안의 `#/...`는 그 문서의
대상이고, 외부 ref를 거쳐 진입 파일로 돌아오면 진입 문서와 같은 문서로 본다. 이미 stack에 있는 대상을 다시 만나면 순환이다.

순환은 두 가지로 나뉜다.

- **유효한 재귀**: 순환 경로가 instance 하위로 내려가는 키워드(`properties`, `items` 등)를 지난다. 진단 없이 `cycleStrategy`대로 끊고
  `onRecursiveRef(ref)` 콜백으로 알린다. `empty-schema`(기본)는 빈 객체 `{}`를, `preserve-ref`는 진입 문서 기준으로 다시 표기한 `$ref`를 남긴다.
- **진단 대상 순환**: 하위로 내려가지 않고 제자리에서 돈다(`A: { $ref: B }`, `B: { $ref: A }`). 같은 방식으로 끊되 `ref-cycle` diagnostic을 낸다.

```
fold(#/components/schemas/Node)
  → stack: [(entry, #/components/schemas/Node)]
  → properties.children.items → $ref: "#/components/schemas/Node"
  → stack에 이미 있음, properties·items를 지남 → 유효한 재귀
  → empty-schema: {} 반환 / preserve-ref: { $ref: "#/components/schemas/Node" } 반환 (진단 없음)
```

`oa-gen lint`는 진단 대상 순환을 `refs/cycle` 오류로 보고한다. `oa-gen validate`는 현재 `refs/cycle`을 출력하지 않는다(알려진 결함,
[스키마 작성 가이드](./schema-authoring.md#순환-ref와-재귀-스키마) 참고).

### 등록 스키마 참조 기반 (zod-to-schema)

`zod-to-schema.ts`의 `zodToSchema()`는 변환의 루트만 전개하고, 루트 아래에서 `context.refs`에 등록된 Zod 스키마를 만나면 재귀 여부와 관계없이 `{ $ref }`를 반환한다. 재귀(`z.lazy`)는 등록된 스키마에서 끊긴다.

```typescript
function convertChild(schema, context) {
  const refName = context?.refs?.get(schema)
  return refName
    ? { $ref: `#/components/schemas/${refName}` }  // 등록 스키마 → 참조
    : expandType(schema, context)                  // 미등록 스키마 → 전개
}
```

컨텍스트에 변환 상태를 남기지 않으므로 결과는 변환 순서와 무관하고, 한 스키마 인스턴스를 여러 위치에서 쓰는 DAG에서도 출력 크기가 스키마 크기에 선형이다. 등록된 스키마는 모두 component로 내보내야 참조가 해소된다.

---

## 확장 방향

현재 패턴에서 자연스럽게 확장할 수 있는 세 가지 방향이 있다.

### Product Algebra — 한 번 순회로 두 결과

두 algebra를 합성하여 단일 순회에서 두 가지 결과를 동시에 생성한다.

```typescript
function product<A, B>(
  a: SchemaAlgebra<A>,
  b: SchemaAlgebra<B>,
): SchemaAlgebra<[A, B]> {
  return {
    string:  (s) => [a.string(s), b.string(s)],
    object:  (s, props) => {
      const aProps: Record<string, A> = {}
      const bProps: Record<string, B> = {}
      for (const [k, [av, bv]] of Object.entries(props)) {
        aProps[k] = av; bProps[k] = bv
      }
      return [a.object(s, aProps), b.object(s, bProps)]
    },
    // ... 나머지 메서드도 동일 패턴
  }
}

// 사용: 타입 생성 + validation 생성을 한 패스로
const [tsType, zodSchema] = foldSchema(schema, product(tsAlgebra, zodAlgebra))
```

### Monadic Fold — 비동기/부수효과 순회

외부 파일 로드 등 async 연산이 필요한 경우 algebra 반환 타입을 `Promise<T>`로 확장한다.

```typescript
type SchemaAlgebraM<T> = {
  string(schema: OasSchema): Promise<T>
  object(schema: OasSchema, properties: Record<string, T>): Promise<T>
  // ...
}
```

### Algebra Composition — algebra 합성

기존 algebra를 감싸서 전처리/후처리를 추가한다.

```typescript
function withLogging<T>(inner: SchemaAlgebra<T>): SchemaAlgebra<T> {
  return {
    string: (s) => { console.log('string:', s); return inner.string(s) },
    // ... 나머지 위임
  }
}
```

---

## 핵심 원칙

1. **foldSchema는 순회만** — 타입 분기와 재귀만 담당. 의미 해석 없음.
2. **algebra는 의미만** — 각 노드에서 T를 만드는 순수 함수.
3. **example/default가 type보다 우선** — mock 데이터 생성 시 스펙 작성자 의도 존중.
4. **조합은 모든 브랜치 fold** — `allOf`/`oneOf`/`anyOf` 모두 전체 브랜치의 결과를 배열로 전달. algebra가 어떤 브랜치를 선택할지 결정.
