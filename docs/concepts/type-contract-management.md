---
docType: explanation
sourceLocale: ko
canonical: true
question: "OA SDK는 TypeScript 선언과 OpenAPI·TypeSpec 계약의 변경을 어떻게 관찰하고 안전하게 진화시키는가?"
scope:
  includes:
    - "Type Registry, schema fidelity, TypeSpec promotion gate의 역할과 관계"
    - "public export·런타임 조건·생성 산출물의 변경 검토 경계"
  excludes:
    - "개별 registry CLI 옵션과 policy 필드의 완전한 참조"
    - "각 OpenAPI operation의 계약 내용"
decisionStatus: accepted
owner: "OA SDK maintainers"
lastVerified: "2026-08-11"
reviewDue: "2026-11-11"
---

# 타입 계약을 관리하는 방식

OA SDK에서 타입 관리는 TypeScript 선언을 한 번 더 작성하는 일이 아니라, 이미 권위가 있는 source·schema·생성 산출물 사이의 변화를 증거로 만드는 일이다. 저장소 production API의 저작 정본은 TypeSpec이며, OpenAPI는 promotion·intake·downstream 소비를 위한 artifact다. 외부 TS-first project는 TypeScript/Zod를 source로 구성할 수 있지만 repository production path와 같은 ownership으로 자동 승격되지 않는다. 손으로 작성한 production TypeScript declaration은 public type surface의 정본이고, TypeSpec/OpenAPI source와는 별도의 관찰·소비 경계를 가진다. Type Registry와 계약 검증은 이 정본을 대체하지 않고 변경의 영향과 경계 위반을 드러낸다.

이 구조는 세 가지 다른 실패를 구분하기 위해 필요하다. 선언의 구조가 바뀌었는데 public export가 뒤따르지 않을 수 있고, schema를 재구성한 결과가 TypeScript 표현력을 잃을 수 있으며, TypeSpec에서 OpenAPI를 생성하는 과정이 snapshot이나 provenance와 달라질 수 있다. 하나의 lint 규칙으로는 이 실패를 모두 판단할 수 없다.

## Type Registry는 선언 그래프의 관찰 계층이다

`pnpm type-registry:check`는 workspace export map을 읽어 production TypeScript source, generated source, source declaration을 분류한다. 각 파일에서 artifact, declaration, relation, unsafe boundary, runtime exposure를 추출하고 SQLite WorkspaceIndex에 파일 단위로 교체한다. 결과 snapshot은 declaration의 syntax·shape·semantic hash를 분리해 기록한다.

이 분리는 문법상 작은 편집과 소비자에게 보이는 타입 의미 변경을 같은 위험으로 취급하지 않게 한다. export map이나 browser/node/bun conditional entrypoint가 바뀌어도, declaration body hash가 같다는 이유만으로 통과하지 않는다. public reexport가 실제 target을 가리키는지와 runtime별 type/value surface가 맞는지를 같은 검토 흐름에서 확인한다.

Type Registry가 찾는 `any`, double assertion, 검증되지 않은 deserialization은 전부 즉시 오류라고 단정하지 않는다. 실제 adapter 경계에는 의도된 동적 값이 있을 수 있기 때문이다. 대신 policy의 budget은 품질 목표가 아니라 non-regression ceiling이며, 예외는 책임자·근거·만료일을 가진 allowlist로만 남길 수 있다. 이 방식은 미해결 type debt를 숨기기보다 새 debt가 늘어나는 순간을 명확히 만든다.

## 스키마 fidelity는 생성 가능성과 의미 보존을 분리한다

OpenAPI/JSON Schema를 TypeScript로 투영할 때 "코드가 생성된다"는 사실만으로 계약이 보존됐다고 말할 수 없다. nested array, `allOf`, composition sibling, index widening, `const`처럼 TypeScript 표현의 우선순위와 nullable·literal 의미가 결과 타입을 바꿀 수 있다. schema fidelity API는 이런 변환을 명시적으로 분석하고, deterministic corpus와 public API compile check로 회귀를 확인한다.

parser의 algebra는 optional `const_` hook을 example/default/type보다 우선해 fold한다. 따라서 mock response generator도 JSON Schema `const`를 빈 문자열 같은 임의의 기본값으로 바꾸지 않는다. 이는 mock-server response validation을 엄격하게 만들면서도 계약에 맞는 생성값을 유지하기 위한 연결이다.

## TypeSpec promotion은 생성 결과와 출처를 함께 잠근다

TypeSpec bundle check는 emitted, restored, expected OpenAPI 각각을 validation하고, TypeSpec AST provenance가 적용되는 경우 raw provenance도 확인한다. approval은 이 gate가 모두 유효할 때만 snapshot을 원자적으로 바꾼다. sidecar-authored bundle처럼 AST provenance가 적용되지 않는 입력은 별도 stability gate를 유지하되, snapshot promotion의 검증을 느슨하게 만들지는 않는다.

root schema scripts는 codegen의 curated `schema-governance` facade만 사용한다. schemas package가 codegen internals를 deep import하면 경계가 흐려지고, package dependency를 추가하면 반대 방향 edge와 cycle이 생길 수 있다. 그래서 package dependency 대신 `packages/schemas/turbo.json`의 build task가 `@oa-sdk/codegen#build`에 Turbo task 의존성을 둔다. facade가 실제로 끌어오는 codegen source는 `cli/lib` 밖(`config.ts`, `schema-pipeline/` 등)에도 있고, codegen이 import하는 core·ast-sync·openapi-projection-contract dist도 읽는다. task 의존성은 이 전체가 바뀌면 schemas build cache key를 바꾸고, 그 build가 끝나기 전에 schemas build를 시작하지 않는다. 명시적 Turbo input에는 codegen 밖의 root script(`scripts/schema-typespec-check.ts`, `scripts/lib/typespec-snapshot-promotion.ts`)와 root `package.json`만 남는다. CI가 Turbo cache를 run 사이에 보존하므로, 이 key가 빠뜨린 파일은 생성 파일 freshness check를 오래된 cache 결과로 통과시킬 수 있다.

## 변경 검토가 따라야 할 경계

타입 source나 public export를 변경한 경우에는 먼저 `pnpm type-registry:check`로 baseline drift와 boundary budget을 확인한다. 검토한 변경이 의도된 경우에만 `pnpm type-registry:write`로 baseline을 갱신한다. 이 명령은 policy gate가 실패하면 baseline을 바꾸지 않는다. TypeSpec source·snapshot을 변경한 경우에는 bundle, downstream, rollback gate를 거쳐야 하며, Type Registry baseline 갱신으로 schema approval을 대체할 수 없다.

이 경계는 변경을 느리게 만들기 위한 것이 아니다. source 수정, 생성 결과, public package artifact, consumer compile failure를 서로 다른 시점에 발견하는 대신 같은 변경 안에서 확인하게 만들기 위한 것이다. 구체적인 명령·옵션·budget은 [Type Registry governance](../internal/type-registry-governance.md), TypeSpec 작성·승격 절차는 [TypeSpec Authoring Conventions](../guides/typespec-authoring-conventions.md)를 기준으로 한다.
