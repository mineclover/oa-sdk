# OAS 3.2 → Pydantic v2 Codegen 데이터 파이프라인 설계

상태: accepted · Phase 1 구현 완료 (`feat/pydantic-codegen`, P1a–P1c)
최종 검토: 2026-11-06
선행 검토: [TypeSpec → Pydantic 변환 지원 영역 검토](../../reports/typespec-pydantic-codegen-review.md) (매핑 표·결정 4개)

## 1. 원칙

1. **단계 = 순수 함수, 단계 사이 = 직렬화 가능한 데이터.** 각 단계는 앞 단계의 산출물(JSON으로 덤프 가능한 plain object)만 입력으로 받고, 파일 시스템·전역 상태·시각에 의존하지 않는다. 같은 입력과 옵션이면 바이트 단위로 같은 출력이 나온다.
2. **옵션은 해석된 하나의 객체로 흐르고, 읽는 곳이 정해져 있다.** 입력은 S0에서 한 번 `ResolvedPydanticBuildOptions`로 해석된다. S3(lower)과 S5(render)는 옵션을 받지 않는다. S4의 각 pass는 자신이 선언한 옵션 키(`reads`)만 받는다(실행기가 그 키만 골라 넘긴다).
3. **사실은 S3, 결정은 S4, 문법은 S5.** S3는 스키마가 말하는 사실만 IR에 담고 결정 슬롯은 `null`로 둔다. S4 pass가 슬롯을 채우고, S5는 `assertResolvedPyIr`로 모든 슬롯이 찼는지 확인한 뒤 IR을 문법으로 옮기기만 한다. 그래서 `--emit-ir` 덤프만으로 생성 결과의 의미를 리뷰할 수 있다.
4. **진단은 데이터.** 모든 단계는 `{ code, severity, pointer, message }` 진단을 IR에 누적한다. `throw`는 입력 계약 위반(잘못된 옵션 값, 문서가 객체가 아님, preflight 치명 오류)에만 쓴다.
5. **언어 중립 분석은 공유한다.** preflight와 참조 그래프·순환·선언 순서·discriminator family 분석은 Zod 생성기와 같은 `schema-graph/` 모듈을 쓴다.

## 2. 단계와 계약 위치

계약(타입·시그니처·불변식)은 코드가 정본이다. 이 문서는 구조와 이유를 설명한다.

| 단계 | 함수 | 입력 → 출력 | 옵션 | 계약 위치 |
|---|---|---|---|---|
| S0 | `resolvePydanticBuildOptions` | 사용자 입력 → `ResolvedPydanticBuildOptions` | — | `packages/codegen/src/pydantic/options.ts` (구현 완료) |
| S1 | `preparePydanticDocument` → `prepareCodegenDocument` | 문서 → `PreparedPydanticDocument` | `preflight` | `pydantic/prepare.ts`, `schema-graph/index.ts` |
| S2 | `analyzeSchemaGraph` | schemas → `SchemaGraphAnalysis` | 없음 | `schema-graph/index.ts` |
| S3 | `lowerToPyIr` (+ `createPydanticAlgebra`) | prepared + analysis → `PyModuleIR`(결정 슬롯 `null`) | 없음 | `pydantic/lower.ts`, `pydantic/ir.ts` |
| S4 | `runPyPasses` | IR → IR | pass별 `reads` | `pydantic/passes/*.ts` (실행기 구현 완료) |
| S5 | `renderPyModule` | 해석 완료 IR → Python source | 없음 | `pydantic/render.ts` (렌더 규칙은 파일 머리 주석) |
| S6 | `emitPydanticFiles` | source + IR → VFS 파일 + report | `output`, `emitIr` | `pydantic/emit.ts` (구현 완료) |
| 합성 | `buildPydanticModels` | 문서 → 전체 결과 | 전부 | `pydantic/build.ts` (구현 완료) |
| S7 | Python 검증 lane | 생성 모듈 | — | 별도 프로세스, `uv` |

### 2.1 S4 pass 순서와 읽는 옵션

| 순서 | pass | `reads` | 채우는 슬롯 |
|---|---|---|---|
| 1 | `polymorphicRefs` | — | `<Base>Union` tagged-union alias 추가, base 참조 치환, variant 태그 `Literal` |
| 2 | `extraPolicy` | `extra` | `PyModelDecl.extra` |
| 3 | `optionalPolicy` | `optionalStyle` | `PyField.default`, `PyField.rejectExplicitNull` |
| 4 | `naming` | `naming` | 모든 `pyName`, `PyField.attribute`, `PyField.alias` |
| 5 | `regex` | `regex` | `PyConstraints.pattern.python`, `PyModelDecl.regexEngine` |
| 6 | `scalarPolicy` | `enumStyle`, `datetime`, `uri`, `intBounds` | 모든 `scalar` 사실 → 구체 타입, `PyEnumDecl.repr`·`members` |
| 7 | `extensions` | — | `x-*` 보존·정렬 |
| 8 | `collectImports` | — | `PyModuleIR.imports` |

각 pass의 세부 규칙은 해당 파일 머리 주석에 있다. 실행기는 pass마다 입력 IR을 복제해 deep-freeze하므로 pass가 입력을 변경하면 즉시 예외가 난다.

### 2.2 TypeSpec 출력 형태에서 확인된 사실

`chunk-stream.tsp`를 실제로 컴파일한 결과(`pydantic/__tests__/fixtures/chunk-stream/`):

- 하위 타입은 `allOf: [{ $ref: Base }]`를 **`properties`와 같은 층의 형제 키**로 가진다(`allOf` 안에 inline object가 들어가는 형태가 아님).
- 판별 태그는 `const`가 아니라 **값 하나짜리 `enum`**(`state: { type: string, enum: [available] }`)이다.
- base는 `discriminator.mapping`을 가진다.

S3는 이 형태를 `bases: [Base]` + 일반 필드로 낮추고, S4 `polymorphicRefs`가 태그를 `Literal`로 좁힌다.

## 3. 빌드 옵션 (Phase 1: 9개)

| 옵션 | 값 (기본값 굵게) | 읽는 곳 | 근거 |
|---|---|---|---|
| `extra` | **`ignore`** · `allow` · `forbid` | extraPolicy | 결정 1 |
| `optionalStyle` | **`reject-null`** · `plain` | optionalPolicy | 결정 2 |
| `naming` | **`snake-alias`** · `preserve` | naming | 결정 3 |
| `regex` | **`ecma`** · `raw` · `python-re` | regex | 결정 4 |
| `enumStyle` | **`str-enum`** · `literal` | scalarPolicy | 이름 있는 문자열 enum 표현 |
| `datetime` | **`aware`** · `naive` | scalarPolicy | `AwareDatetime` vs `datetime` |
| `uri` | **`str`** · `any-url` | scalarPolicy | `AnyUrl`은 값을 정규화해 왕복 불일치 |
| `intBounds` | **`format`** · `none` | scalarPolicy | 정수 폭 format → `ge`/`le` |
| `emitIr` | `true` · **`false`** | emit | 최종 IR을 `<output>.ir.json`으로 함께 출력 |

옵션이 아닌 설정: `output`(기본 `models.py`, 생성 위치), `preflight`(`generate-zod`와 같은 의미의 validate/normalize/force 등).

### 3.1 고정 설정 (Phase 1 보류)

`PYDANTIC_FIXED_SETTINGS` — 사용자 입력에서 읽지 않으며, 나중에 옵션으로 연다.

| 설정 | 고정값 |
|---|---|
| Pydantic 하한 / Python 하한 | 2.11 / 3.11 |
| `unionMode` | `smart` |
| `frozen` | `false` |
| `layout` | `single` (모듈 하나) |
| `docstrings` | 켬 |
| `extensions` | 보존 |

### 3.2 Preset

개별 옵션이 preset 값을 덮어쓴다(`기본값 < preset < 명시 옵션`).

| preset | 값 | 용도 |
|---|---|---|
| `default` | 기본값 | FastAPI 서비스 DTO, Zod 생성기와 같은 의미 |
| `strict` | `extra=forbid`, `datetime=aware` | 요청 검증 전용 |
| `passthrough` | `extra=allow`, `naming=preserve`, `uri=str` | 미선언 필드와 wire 이름을 보존해야 하는 게이트웨이·프록시 |

## 4. 진입점

| 표면 | 형태 | 단계 |
|---|---|---|
| 프로그래밍 API | `buildPydanticModels(doc, options)` + 단계 함수 개별 export (`pydantic/index.ts`) | 계약 완료 |
| CLI | `oa-gen generate-pydantic --spec <file> [--out <path>] [--preset ...] [--extra ...] ... [--emit-ir] [--force] [--no-validate] [--no-normalize]` | P1c |
| Plugin | `pydantic(options)` `TspPlugin`, `generate` 훅에서 `emitPydanticFiles`의 파일을 `addFile` | P1c |

## 5. 진단 코드

| 코드 | 심각도 | 발생 |
|---|---|---|
| `pydantic/preflight` | lint 그대로 | S1 preflight 결과(치명 오류는 `force`일 때만 진단으로 남음) |
| `pydantic/unsupported-keyword` | warning | `if/then/else`, `not`(빈 스키마 제외), `patternProperties`, `dependentSchemas`, `propertyNames` |
| `pydantic/unresolved-ref` | error | `#/components/schemas/` 밖이거나 없는 대상을 가리키는 `$ref` → `Any` |
| `pydantic/allof-flattened` | warning | 상속으로 표현할 수 없는 `allOf`를 평탄화 |
| `pydantic/encoding-degraded` | info | 인코딩된 스칼라를 wire 타입으로 생성 |
| `pydantic/discriminator-without-variants` | warning | 하위 타입을 찾을 수 없는 discriminator base |
| `pydantic/default-on-required` | info | 필수 필드의 `default` 무시 |
| `pydantic/name-collision` | info | 식별자 충돌로 숫자 접미사 부여 |
| `pydantic/regex-engine-fallback` | warning | lookaround/backreference로 모델이 `python-re` 엔진 사용 |
| `pydantic/regex-class-untranslatable` | warning | 문자 클래스 안 `\D`/`\W` |
| `pydantic/extension-dropped` | warning | JSON 직렬화 불가 `x-*` 값 제거 |

새 코드를 추가할 때는 이 표에 함께 기록한다.

## 6. 검증

| 층 | 위치 | 내용 |
|---|---|---|
| 계약 테스트 | `pydantic/__tests__/contract.test.ts` | S0 옵션 해석, S3 IR이 JSON 데이터이고 결정 슬롯이 모두 `null`, 입력 순서 무관, pass 후 미해결 슬롯 없음, 선언한 옵션이 실제로 출력에 영향, golden, 결정성, `emitIr` |
| 단계 단위 | `pydantic/__tests__/*.test.ts` | 매핑 표 행마다 입력 스키마 → IR 비교 |
| Zod 동일성 | `schema-graph/__tests__/zod-parity.test.ts` | 추출 전 코드로 만든 golden과 Zod 출력 바이트 비교 |
| fixture | approved spec, `chunk-stream`·`cycles` TypeSpec 컴파일 결과 | 재생성 명령은 각 `main.tsp` 머리 주석 |
| Python lane | `uv`가 있을 때만 실행 | 생성 모듈 import, `model_rebuild()`, spec example `model_validate`, 비-nullable optional의 `null` 거부 |

## 7. 구현 단계

계약 파일(`options.ts`, `ir.ts`, `passes/index.ts`, `prepare.ts`, `emit.ts`, `build.ts`, `not-implemented.ts`, 각 파일의 export 시그니처, `__tests__/contract.test.ts`, `__tests__/fixtures.ts`, `schema-graph/__tests__/`)는 구현 단계에서 바꾸지 않는다. 본문이 `notImplemented(..., 'P1x')`인 함수를 해당 단계가 채운다.

| 단계 | 범위 | 초록이어야 할 계약 테스트 |
|---|---|---|
| P1a | `schema-graph/` 이동·추출(zodgen이 사용), `analyzeSchemaGraph`, S3 lower | `[S0]`, `[P1a]`, Zod 동일성 |
| P1b | S4 pass 8개, `python-identifier.ts` 승격 | + `[P1b]` |
| P1c | S5 render, CLI·plugin·거버넌스 등록, Python lane 테스트 | + `[P1c]` |

## 8. 범위 밖

operation 파라미터 모델, FastAPI 라우터 스텁, `ContractRegistry` 연동(Phase 2·3), `@pseudonymize` 등 커스텀 decorator의 의미 해석, §3.1 고정 설정의 옵션화.
