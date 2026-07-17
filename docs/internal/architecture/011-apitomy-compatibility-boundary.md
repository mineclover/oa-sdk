# ADR-011 — Apitomy Data Models 비권위적 Reference 경계

## 상태

Accepted — Apitomy는 보조 기준으로만 연결한다. oa-sdk가 parser, validation, governance의
source of truth이며 Apitomy를 신뢰 경로 또는 필수 runtime dependency로 채택하지 않는다.

## Context

Apicurio Data Models는 현재 Apitomy로 이전된 범용 OpenAPI/AsyncAPI 문서 모델이다. 문서를
typed tree로 읽고 쓰며, visitor/traverser, validation, document transformation을 제공한다.
반면 oa-sdk는 OpenAPI 3.2 문서를 source fragment/TypeSpec에서 수집하고, parser IR, codegen,
mock/runtime, diff/review, provenance로 연결한다.

두 모델을 직접 섞으면 다음 문제가 생긴다.

- Apitomy node와 oa-sdk plain OpenAPI object가 서로 다른 mutation/identity semantics를 가짐
- 외부 모델을 parser core에 import하면 optional dependency와 browser bundle 경계가 깨질 수 있음
- Apitomy의 multi-spec 범위를 도입하는 순간 oa-sdk의 OAS 3.2-first scope가 암묵적으로 확대됨
- Apitomy validation 결과와 oa-sdk review diagnostic의 path/severity/code 체계가 달라짐

따라서 Apitomy는 document boundary의 reference probe로만 수행한다. 비교 결과는 규칙
차이를 발견하기 위한 관찰값이지, oa-sdk 계약의 유효성을 결정하는 판정값이 아니다.

## Decision

`@oa-sdk/codegen/apitomy` subpath에 structural reference adapter를 둔다.

```text
@apitomy/data-models Library
        ↓ optional reference adapter
plain OpenAPI object ──────────────┐
        ↓                          │
@oa-sdk/parser                     │ reference comparison
        ↓                          │
oa-sdk primary result ◀──────── Apitomy signal
        ↓
oa-gen validation / diff / review / typegen / router / client / mock
```

reference adapter의 규칙:

1. `@apitomy/data-models`는 optional peer이며 static import하지 않는다.
2. Apitomy `Library`를 주입하거나 동적 loader로 얻는다.
3. Apitomy 문서는 `writeNode()` 또는 serialization API로 plain object로 변환해 비교한다.
4. 현재 probe는 OpenAPI 3.x만 허용하며, 관리 계약에서는 `requireOpenApi32`를 사용한다.
5. `compareValidation()`은 oa-sdk primary result와 Apitomy reference signal을 함께 반환한다.
   `primary.valid`만 validation gate로 사용할 수 있고, `referenceOnly`/`primaryOnly`는
   차이 관찰값이다.
6. 비교 차이는 `semantic-match`, `oa-sdk-only`, `apitomy-only`,
   `unsupported-by-reference`, `path-mapping-failed`, `serialization-loss`로 분류한다.
   분류는 Apitomy 결과를 채택하기 위한 것이 아니라, 외부 reference의 한계와 adapter 손실을
   구분해 review할 수 있게 하기 위한 것이다.
7. 비교 결과에는 adapter contract version, Apitomy package/version, 입력 content hash,
   OpenAPI version, 사용 capability, serialization 확인 여부를 남긴다.
8. Apitomy native validation 결과를 `LintResult`로 매핑할 수 있지만, rule을 oa-sdk rule로
   승격하거나 Apitomy 결과를 gate에 직접 연결하지 않는다.
9. Apitomy transform 결과를 oa-sdk 원본, IR, upgrade report로 채택하지 않는다.
10. Apitomy의 visitor/command/undo-redo는 adapter 안에서 재구현하지 않는다.
11. source of truth, provenance, target selection, review policy는 계속 oa-sdk가 소유한다.

## Adoption points

| 우선순위 | 지점 | 판단 | 이유 |
|---|---|---|---|
| P0 | JSON/YAML read/write probe | 즉시 도입 가능 | round-trip과 외부 모델 차이 탐지에 유용 |
| P0 | `compareValidation()` | pilot 권장 | oa-sdk 규칙과 reference 규칙의 차이를 수집하되 gate는 oa-sdk로 유지 |
| P1 | Apitomy document → `ParsedDocument` probe | 제한적 권장 | 기존 downstream을 재사용하면서 parser 차이를 측정 가능 |
| P1 | OAS 3.1/3.2 transform reference | 제한적 도입 | migration 비교용으로 유용하나 oa-sdk의 3.2 upgrade report를 대체하지 않음 |
| P2 | visitor/traverser | editor 요구가 있을 때 | 일반 tree query에는 유용하지만 현재 `SchemaAlgebra`/query API와 중복 가능 |
| P2 | command/undo-redo | 보류 | spec editor가 실제 제품 요구가 될 때만 별도 mutation model로 검토 |
| P2 | Apicurio Registry publish/fetch | 별도 adapter로 검토 | 중앙 artifact/version/rule 저장은 유용하지만 source-of-truth 변경이므로 별도 ADR 필요 |

## Usage

Apitomy를 사용하는 애플리케이션에서만 optional peer를 설치한다.

```bash
pnpm add @apitomy/data-models
```

```ts
import { Library } from '@apitomy/data-models'
import { createApitomyReferenceAdapterFromModule } from '@oa-sdk/codegen/apitomy'

const reference = createApitomyReferenceAdapterFromModule({ Library }, {
  requireOpenApi32: true,
})

const document = reference.read(openApiYaml)
const comparison = reference.compareValidation(document, {
  inputHash: 'sha256:...'
})

// 유효성 판정은 oa-sdk만 사용한다.
if (!comparison.primary.valid) throw new Error(comparison.primary.summary)
// comparison.status는 Apitomy와의 차이 관찰값이다.
console.log(comparison.status, comparison.referenceOnly, comparison.primaryOnly)
console.log(comparison.differences, comparison.metadata)
```

`Library`를 직접 import하기 어려운 host는 `loadApitomyDataModels()`를 사용하고, 테스트나
plugin host는 importer를 주입할 수 있다.

CLI에서는 명시적인 `oa-gen reference-check --spec <file>`만 사용한다. 기본적으로 reference
차이는 출력하지만 exit code를 실패로 만들지 않으며, oa-sdk primary validation이 실패할 때만
validation gate가 실패한다.

## Non-goals

- `@oa-sdk/parser`가 Apitomy model class를 반환하도록 변경하지 않는다.
- OAS 2.0/AsyncAPI/OpenRPC 지원을 이 변경만으로 선언하지 않는다.
- Apitomy validation rule을 oa-sdk lint rule로 복제하거나 source of truth로 승격하지 않는다.
- Apicurio Registry의 persistence, REST, UI, authentication을 codegen package에 넣지 않는다.
- Apitomy의 mutation history를 `spec-lens` revision history와 합치지 않는다.

## Follow-up gates

다음 작업은 실제 사용 사례가 확인된 뒤 진행한다.

- 실제 Apitomy 추가 버전별 OAS 3.2 fixture와 `oa-gen reference-check`의 diagnostic parity 측정
- 현재 versioned OAS 3.1/3.2 fixture corpus를 늘려 serialization·path mapping 회귀 측정
- Apitomy validation과 oa-sdk validation의 중복/충돌 rule taxonomy를 실제 fixture별로 보정
- registry artifact metadata와 oa-sdk provenance/target metadata의 mapping 실험
- 두 개 이상의 비테스트 consumer가 같은 Registry adapter primitive를 요구할 때 별도
  `registry` integration boundary 추출
