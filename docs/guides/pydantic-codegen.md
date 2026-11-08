# OAS 3.2 → Pydantic v2 코드 생성 가이드

이 가이드는 저장소의 `@oa-sdk/codegen` 구현을 기준으로 한다. 설명과 예시는 현재 소스와
[golden 출력](../../packages/codegen/src/pydantic/__tests__/golden/)에서 확인할 수 있는 동작만 다룬다.

## 개요와 범위

생성 경로는 다음과 같다.

```text
.tsp → @typespec/openapi3 → OAS 3.2 → @oa-sdk/codegen Pydantic generator
```

Phase 1 입력은 OAS 문서의 `components.schemas`뿐이다. 여기서 object 모델, named enum,
union/조합, scalar alias를 `models.py` 한 모듈로 만든다. operation의 path/query/header
parameter 모델, request/response operation 모델, FastAPI router stub, `ContractRegistry`
연동은 범위 밖이다.

생성 코드는 `pydantic>=2.11`, `Python>=3.11`을 요구한다. TypeSpec의 HTTP operation이
있는 문서는 `api`, 모델만 있는 문서는 `data` 또는 `interface` 목적의 plugin pipeline에서
사용할 수 있다.

## 사용법

### CLI

저장소에서 직접 실행할 때는 먼저 빌드한다.

```bash
corepack pnpm --filter @oa-sdk/codegen build
node packages/codegen/dist/cli/index.js generate:pydantic --spec specs/openapi.yaml --out generated
```

외부 프로젝트에서는 위 명령의 `node packages/codegen/dist/cli/index.js` 부분을 `oa-gen`으로
읽는다. 즉 명령 이름은 `oa-gen generate:pydantic`이다. `--spec`, `--out`, `--report`가 상대
경로이면 CLI가 찾은 project root를 기준으로 해석한다. `--out`이 `.py`로 끝나면 그 파일에
쓰고, 그 밖에는 디렉터리로 보고 그 안의 `models.py`에 쓴다.

```bash
oa-gen generate:pydantic \
  --spec specs/openapi.yaml \
  --out src/generated \
  --preset strict \
  --emit-ir \
  --report reports/pydantic.json
```

파일 경로를 직접 지정하는 형태도 가능하다.

```bash
oa-gen generate:pydantic --spec openapi.yaml --out src/models.py --extra allow
```

사용 가능한 CLI 플래그는 `--preset`, `--extra`, `--optional-style`, `--naming`, `--regex`,
`--enum-style`, `--datetime`, `--uri`, `--int-bounds`, `--encoding-policy`, `--extensions`,
`--no-docstrings`, `--frozen`, `--emit-ir`, `--report`, `--force`,
`--no-validate`, `--no-normalize`, `--categories`이다. 저장소 안에서는 위의 모든 `oa-gen`
예시를 `node packages/codegen/dist/cli/index.js` 뒤에 같은 인자로 붙여 실행한다. 이 경로와
명령 해석 규칙은 [CLI 레퍼런스 상단 주의](./cli-command-reference.md)에 있다.

### 프로그래밍 API

```ts
import { buildPydanticModels } from '@oa-sdk/codegen'

const result = buildPydanticModels(document, {
  preset: 'default',
  output: 'models.py',
})
```

`buildPydanticModels(doc, options)`의 반환 객체는 다음 필드를 모두 가진다.

| 필드 | 내용 |
|---|---|
| `options` | `resolvePydanticBuildOptions`가 확정한 semantic/output/preflight 옵션 |
| `analysis` | `analyzeSchemaGraph`의 edges, recursive, order, discriminatorFamilies |
| `ir` | 모든 pass가 끝난 `PyModuleIR` |
| `source` | banner를 제외한 Python 모듈 본문 |
| `files` | plugin VFS에 넣을 `TspGeneratedFile[]` |
| `report` | `oa-sdk.pydantic-build-report.v1` 빌드 리포트 |
| `diagnostics` | IR에 누적된 `{ code, severity, pointer, message }[]` |

### Plugin

`@oa-sdk/codegen/plugin`의 `pydantic(options)`는 `runTspPluginPipeline`에서 사용할 수 있다.
플러그인은 생성한 모든 파일을 `context.addFile`로 추가하고 진단을 pipeline에 보고한다.

```ts
import { pydantic, runTspPluginPipeline } from '@oa-sdk/codegen/plugin'

await runTspPluginPipeline({
  input: 'main.tsp',
  purpose: 'data',
  outputDir: 'src/generated',
  plugins: [pydantic({ preset: 'strict', output: 'models.py' })],
})
```

지원되는 `purpose` 값은 `api`, `data`, `interface`다. `data` pipeline에는 HTTP operation이
없어야 하고, `api`에는 하나 이상의 operation이 있어야 한다.

## 파이프라인 단계

| 단계 | exported 함수 | 입력 → 출력 | 옵션과 역할 |
|---|---|---|---|
| S0 | `resolvePydanticBuildOptions` | 사용자 입력 → `ResolvedPydanticBuildOptions` | 기본값, preset, 명시 옵션을 한 번 해석 |
| S1 | `preparePydanticDocument` | 문서 → `PreparedPydanticDocument` | `prepareCodegenDocument`를 통해 preflight, normalize, `schemas` 추출 |
| S2 | `analyzeSchemaGraph` | `schemas` → `SchemaGraphAnalysis` | 참조 edges, 순환, dependency-first order, discriminator family 계산 |
| S3 | `lowerToPyIr` | prepared + analysis → 결정 슬롯이 `null`인 `PyModuleIR` | `createPydanticAlgebra`와 `foldSchema`로 사실만 기록 |
| S4 | `runPyPasses` | IR → IR | pass별 선언된 옵션만 선택해 결정 슬롯 채움 |
| S5 | `renderPyModule` | resolved IR → Python source | import, 모델, alias, validator, rebuild 렌더링 |
| S6 | `emitPydanticFiles` | source + IR → files + report | `output`, `emitIr`에 따라 VFS 파일과 리포트 생성 |

`analyzeSchemaGraph`는 `@oa-sdk/codegen` package root에서 재export된다. 각 단계는 plain
JSON IR을 주고받으며 S4 실행기는 pass 입력을 복제하고 deep-freeze한다.

### S4 `PY_PASSES` 순서

| 순서 | pass | 읽는 옵션 | 하는 일 |
|---:|---|---|---|
| 1 | `polymorphicRefs` | 없음 | discriminator union alias 추가, base ref 치환, variant tag `Literal` |
| 2 | `extraPolicy` | `extra` | open/closed/typed-map의 `extra` 결정 |
| 3 | `optionalPolicy` | `optionalStyle` | 기본값과 explicit-null validator 결정 |
| 4 | `naming` | `naming` | `pyName`, field attribute, 명시 alias 결정 |
| 5 | `regex` | `regex` | pattern 번역 및 모델별 regex engine 결정 |
| 6 | `scalarPolicy` | `enumStyle`, `datetime`, `uri`, `intBounds`, `encodingPolicy` | scalar 사실을 wire/semantic Python 타입으로 바꾸고 enum 표현 결정 |
| 7 | `extensions` | `extensions` | JSON 직렬화 가능한 `x-*`만 보존·정렬하거나 제거 |
| 8 | `docstrings` | `docstrings` | 모델 설명 docstring 유지/삭제 |
| 9 | `frozen` | `frozen` | 모델 불변성 결정 |
| 10 | `collectImports` | 없음 | renderer가 실제 쓰는 import 수집 |

각 pass는 자기 `reads`에 선언한 옵션만 받는다. 예를 들어 `scalarPolicy`는 `enumStyle`,
`datetime`, `uri`, `intBounds`만 읽고 `extra`는 읽지 않는다.

### 단계를 직접 조합하기

```ts
import * as root from '@oa-sdk/codegen'

const options = root.resolvePydanticBuildOptions({ emitIr: true })
const prepared = root.preparePydanticDocument(doc, options.preflight)
const analysis = root.analyzeSchemaGraph(prepared.schemas)
const lowered = root.lowerToPyIr(prepared, analysis, root.pydanticModuleName(options.output))
const { ir } = root.runPyPasses(lowered, options, analysis)
const { files, report } = root.emitPydanticFiles(root.renderPyModule(ir), ir, options)
```

이 조합은 `buildPydanticModels(doc, { emitIr: true })`와 같은 `files`와 `report`를 만든다.

## 빌드 옵션과 preset

### 공개 build 옵션

| 옵션 | 허용 값 (기본값 **굵게**) |
|---|---|
| `extra` | **`ignore`**, `allow`, `forbid` |
| `optionalStyle` | **`reject-null`**, `plain` |
| `naming` | **`snake-alias`**, `preserve` |
| `regex` | **`ecma`**, `raw`, `python-re` |
| `enumStyle` | **`str-enum`**, `literal` |
| `datetime` | **`aware`**, `naive` |
| `uri` | **`str`**, `any-url` |
| `intBounds` | **`format`**, `none` |
| `encodingPolicy` | **`wire`**, `decode` |
| `extensions` | **`preserve`**, `drop` |
| `docstrings` | **`true`**, `false` |
| `frozen` | **`false`**, `true` |
| `oneOfMode` | **`smart`**, `exact` |
| `emitIr` (출력 제어) | **`false`**, `true` |
| `layout` (출력 제어) | **`split`**, `single` |
| `emitOperations` (출력 제어) | **`true`**, `false` |

`output`은 semantic 옵션이 아닌 출력 파일 상대 경로이며 기본값은 `models.py`다. 반드시
`.py`로 끝나야 한다. `preflight`는 `validate`, `normalize`, `lintCategories`,
`failOnSeverity`, `rules`, `basePath`와 `force`를 받는다.

`layout`은 `split`(기본값) 또는 `single`이며 S6 report에 기록된다. `emitOperations`는 기본값이
`true`이고 operation IR을 수집한다. CLI의 `--no-operations`와 plugin의 `purpose`가 `api`가
아닌 경우에는 operation 산출을 끈다. `split`은 schema를 `models.py`, operation 모델과 `OPERATIONS` metadata를 `operations.py`에 쓴다. 두 파일과
`__init__.py`를 함께 내보내므로 출력 디렉터리를 Python package로 import할 수 있다. `single`은 한 모듈에
모두 쓴다. `multipart/form-data`와 `application/x-www-form-urlencoded`는 스키마 기반 모델로, 바이너리 필드는 `bytes`로 생성한다. `text/*`는 `str`, `application/octet-stream`은 `bytes`로 매핑한다. `text/event-stream`과 JSON Lines media type은 `*ResponseItem` 타입과 `OPERATIONS`의 stream metadata를 생성한다. 여러 media type은 JSON을 기본 alias로 유지하고 각 추가 media type에 결정적인 alias를 만든다. `oneOfMode: exact`는 discriminator 없는 `oneOf`에서만 정확히 한 branch가 검증되는지 검사한다.
추가 media alias는 `BodyForm`, `BodyMultipart`, `BodyText`, `BodyBytes`와 같은 media suffix를 사용한다. stream이 하나면 `BodyItem`/`ResponseItem`, 여러 개면 `BodyJsonlItem`, `ResponseEventStreamItem`, `ResponseXNdjsonItem`, `ResponseJsonSeqItem`처럼 media suffix를 포함한다. `OPERATIONS.streams` 키는 request에서 `body:<media-type>`, response에서 `<status>:<media-type>` 형식이다.
`anyOf`, nullable/type-array union, operation status response/error union에는 적용하지 않는다. 정밀화할 수
없는 `oneOf` 구조에는 `pydantic/oneof-ambiguous` info를 낸다. `unionMode`는 Pydantic 2.11의
`Field(union_mode=...)` 출력 호환성이 확정될 때까지 고정값 `smart`로 둔다.

split의 `__init__.py`는 star import로 생성 심볼을 재수출하지 않는 빈 package marker(docstring만 포함)다.
호출자는 `models`와 `operations` 모듈을 명시적으로 import해야 하며, 이 방식은 `F401/F403`을 피하고
Pydantic 구현 import가 package namespace로 새어 나오는 것을 막는다.

실제 `PydanticSemanticOptions`와 report의 `options`에는 semantic 키가 들어가고, `emitIr`는 별도의 출력 옵션이다.

### preset과 고정 설정

| preset | 덮어쓰는 값 |
|---|---|
| `default` | 없음. 기본 semantic 값 그대로 |
| `strict` | `extra: 'forbid'`, `datetime: 'aware'` |
| `passthrough` | `extra: 'allow'`, `naming: 'preserve'`, `uri: 'str'` |

해석 순서는 `defaults < preset < explicit`이다. `PYDANTIC_FIXED_SETTINGS`는 사용자 입력으로
바꿀 수 없다.

| 고정 키 | 값 |
|---|---|
| `pydanticFloor` / `pythonFloor` | `2.11` / `3.11` |
| `unionMode` | `smart` |

## OAS → Python 매핑

아래 표는 [`lower.ts`](../../packages/codegen/src/pydantic/lower.ts)의 OAS 사실 수집,
[`passes/`](../../packages/codegen/src/pydantic/passes/)의 결정, [`render.ts`](../../packages/codegen/src/pydantic/render.ts)의
문법 출력, 그리고 [네 fixture golden](../../packages/codegen/src/pydantic/__tests__/golden/)을
대조한 결과다.

| OAS 3.2 구성 | 실제 생성 |
|---|---|
| object + `properties`/`required` | `class X(BaseModel)`과 필드. `description`은 클래스 docstring |
| 닫힌 object: `unevaluatedProperties: {not: {}}` 또는 `additionalProperties: false` | 옵션과 무관하게 `model_config = ConfigDict(extra="forbid")` |
| 열린 object(추가 속성 선언 없음) | `extra` 옵션. 기본 출력 예: `model_config = ConfigDict(extra="ignore")` |
| `additionalProperties: T` 또는 `unevaluatedProperties: T` | `extra="allow"`와 `__pydantic_extra__: dict[str, T] = Field(init=False)` |
| properties 없는 typed map | `dict[str, T]` alias 또는 필드 타입 |
| required, non-nullable | `x: T` 또는 `Field(...)` |
| required, nullable | `x: T | None` (기본값 없음) |
| optional, nullable | `x: T | None = None` |
| optional, non-nullable | 기본 `optionalStyle`에서 `T | None = None` + explicit-null 거부 validator |
| schema `default` | optional 필드의 Python 기본값/`Field(None, ...)`. required 필드의 default는 무시하고 info 진단 |
| `minLength`, `maxLength`, `minimum`, `maximum`, `exclusive*`, `multipleOf` | `Field(min_length=, max_length=, ge=, le=, gt=, lt=, multiple_of=)` |
| `minItems`, `maxItems` | list에 `Field(min_length=, max_length=)` |
| `uniqueItems: true` | 순서를 유지하는 `_unique_items` `AfterValidator` |
| `string` | `str` |
| `format: uuid` | `UUID` |
| `format: date-time` | `datetime: aware`이면 `AwareDatetime`, `naive`이면 `datetime` |
| `format: date`, `time`, `duration` | `date`, `time`, `timedelta` |
| `format: email` | `EmailStr` |
| `format: uri`, `url` | `uri: str`이면 `str`, `any-url`이면 `AnyUrl` |
| `format: byte` 또는 `contentEncoding: base64` | `Base64Bytes` |
| `format: binary` 또는 `contentMediaType`이 `text/*`가 아닌 문자열 스키마 | `bytes` (multipart/form, JSON schema 내부 필드에도 동일) |
| `contentMediaType: text/*` 문자열 스키마 | `str` |
| model/field `x-*` | `extensions: preserve`이면 정렬된 JSON 값을 `model_config.json_schema_extra`/`Field(json_schema_extra=...)`로 보존하고, `drop`이면 제거 |
| `encodingPolicy: decode` + `format: unixtime` | `Annotated` datetime validator/serializer로 epoch seconds 왕복 |
| `encodingPolicy: decode` + `format: http-date` | RFC 7231 HTTP-date validator/serializer로 왕복 |
| `encodingPolicy: decode` + `contentEncoding: base64url` | `Base64UrlBytes` |
| 그 밖의 encoded scalar 또는 `encodingPolicy: wire` | wire 타입 그대로 + `pydantic/encoding-degraded` info |
| `number`, `decimal`/`decimal128` | 각각 `float`, `Decimal` |
| integer 폭 format | `intBounds: format`일 때 `ge`/`le`; `none`이면 `int`만 |
| `pattern` | `regex: ecma`는 ECMA 일부를 ASCII class로 번역, `raw`는 원문, `python-re`는 원문 + Python engine |
| named string enum | `enumStyle: str-enum`이면 `StrEnum`, 아니면 `TypeAlias = Literal[...]` |
| inline/mixed enum, `const` | `Literal[...]` |
| `oneOf` | 기본은 smart `A | B`; discriminator 없는 `oneOfMode: exact`만 정확히 한 branch validator를 추가 |
| 명시 discriminator envelope (`@discriminated`) | variant 모델의 `Literal` tag + `Annotated[..., Field(discriminator=...)]`; 빈 base 모델은 생성하지 않음 |
| `multipart/form-data`, `application/x-www-form-urlencoded` | schema 기반 `<Op>Body` 및 media별 alias |
| `text/*`, `application/octet-stream` | 각각 `str`, `bytes`; schema-less primary도 같은 타입 |
| SSE/JSON Lines (`text/event-stream`, `application/jsonl`, `application/x-ndjson`, `application/json-seq`) | `*ResponseItem`/`*BodyItem` alias; `streams` 키는 request `body:<media>` 또는 response `<status>:<media>` |
| `anyOf`, nullable/type-array union | 항상 smart `A | B`; overlap을 허용하며 exact 대상이 아님 |
| object형 `allOf`의 `$ref` branch | `class Child(Base)` 상속. inline properties branch는 child에 필드를 합치고 `pydantic/allof-flattened` warning |
| object가 아닌 `allOf` | 첫 branch로 평탄화하고 `pydantic/allof-flattened` warning |
| TypeSpec polymorphism | base `discriminator.mapping` + subtype `allOf: [$ref Base]` + 단일값 `enum` tag를 찾아 subclass, tag `Literal`, union alias로 변환 |
| 재귀 `$ref` | `from __future__ import annotations`와 모듈 끝의 `X.model_rebuild()` |
| `x-*` extension | field의 `x-*`는 `Field(json_schema_extra=...)`로 렌더링. model-level extension은 extensions pass가 IR에 보존하지만 `render.ts`가 Python 설정으로 출력하지 않는다. JSON 불가 값은 제거 |
| `description`, `examples`, `deprecated` | `Field(description=..., examples=..., deprecated=...)`; 모델 description은 docstring |
| `paths` operation | path/query/header/cookie parameter, JSON body, response와 header를 `PyOperationDecl` facts로 IR에 기록. path item parameter는 operation parameter가 덮어쓴다 |
| operation model naming | `<Op>PathParams`, `<Op>QueryParams`, `<Op>HeaderParams`, `<Op>CookieParams`, `<Op>Body`, selected JSON success의 `<Op>Response`, `<Op>Error`; inline parameter는 `<Op><Location>Param<Name>`, response 오류는 `<Op>Error<Status>` |
| operation parameter models | parameter group fields use the same `naming`, alias, `optionalStyle`, and `extra="forbid"` decisions as component models |

대표적인 generated line은 다음과 같다.

```py
__pydantic_extra__: dict[str, Annotated[int, Field(ge=-2147483648, le=2147483647)]] = Field(init=False)
UiCueUnion: TypeAlias = Annotated[CallCue | ClickCue | FocusCue | InputCue, Field(discriminator="action")]
```

`int64`는 정확한 십진 문자열 경계를 유지한다. 예를 들어 golden에는
`ge=-9223372036854775808, le=9223372036854775807`가 있고 `uint64` 상한은
`le=18446744073709551615`다. `safeint`는 `±9007199254740991`이다.

## 동작 보장

### 1. extra와 optional

열린 모델의 기본 `extra`는 `ignore`이고 닫힌 모델은 항상 `forbid`다. typed map은 항상
`allow`와 typed `__pydantic_extra__`를 쓴다.

```py
class Locked(BaseModel):
    model_config = ConfigDict(extra="forbid")

class OpenModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
```

`x?: T` 같은 optional non-nullable 필드는 기본 `optionalStyle: reject-null`에서 다음처럼
생성된다. `optionalStyle: plain`이면 validator를 만들지 않는다.

```py
name: str | None = None

@field_validator("name", mode="before")
@classmethod
def _reject_explicit_null(cls, value: object) -> object:
    if value is None:
        raise ValueError("explicit null is not allowed")
    return value
```

nullable인 optional 필드는 `T | None = None`이며 `null`을 허용한다. required 필드는
기본값 없이 `Field(...)` 또는 annotation만 가진다.

### 2. 이름과 alias

기본 `naming: snake-alias`는 snake_case attribute와 원래 wire name인 명시적 `alias`를
함께 만든다. alias가 있는 모델은 다음 설정을 모두 가진다.

```py
model_config = ConfigDict(
    extra="ignore", validate_by_name=True, validate_by_alias=True, serialize_by_alias=True
)
```

`naming: preserve`는 wire 이름을 attribute 후보로 유지하지만 Python 식별자 규칙 때문에
다음은 여전히 바뀐다.

- 선행 `_`는 제거하고, 빈 결과는 `field`로 대체한다.
- `from`, `class` 같은 keyword는 `from_`처럼 바꾼다.
- `json`, `copy`, `dict`, `schema`, `fields`, `model_*` 등 `BaseModel` attribute와 충돌하면
  `_`를 붙이고, 같은 모델 안에서 다시 충돌하면 숫자 접미사를 붙인다.

예: golden의 preserve preset에는 `updatedAt: int = Field(..., ge=0, le=9223372036854775807)`가
있고, 기본 preset에는 `updated_at`과 `alias="updatedAt"`가 있다.

### 3. 정규식

`regex: ecma`는 class 밖의 `\d`, `\D`, `\w`, `\W`를 각각 `[0-9]`, `[^0-9]`,
`[A-Za-z0-9_]`, `[^A-Za-z0-9_]`로 번역하고 class 안에서는 범위로 전개한다. lookaround나
backreference가 있으면 해당 모델만 `regex_engine="python-re"`로 바꾸고
`pydantic/regex-engine-fallback` warning을 낸다. class 안의 `\D`/`\W`처럼 안전하게
전개할 수 없는 경우에는 `pydantic/regex-class-untranslatable`도 낸다.

`regex: raw`는 원문을 Rust `regex`에 전달하고, `regex: python-re`는 모든 모델을 Python
`re` engine으로 렌더링한다. golden의 일반 pattern은 예를 들어 다음처럼 ASCII 범위를
명시한다.

```py
Identifier: TypeAlias = Annotated[str, Field(pattern="^[A-Za-z_][A-Za-z0-9_.-]*$")]
```

## 진단 코드

| 코드 | severity | 발생 조건 |
|---|---|---|
| `pydantic/preflight` | preflight lint severity | S1의 validation/lint 진단을 Pydantic 진단으로 전달. fatal은 `force`일 때만 누적 |
| `pydantic/unsupported-keyword` | warning | `if`, `then`, `else`, `patternProperties`, `dependentSchemas`, `propertyNames`, 비어 있지 않은 `not` |
| `pydantic/unresolved-ref` | error | components 밖 또는 존재하지 않는 `$ref`; 결과 타입은 `Any` |
| `pydantic/allof-flattened` | warning | 상속으로 표현할 수 없는 `allOf` branch를 flatten |
| `pydantic/encoding-degraded` | info | `encodingPolicy: wire`이거나 아직 디코드하지 않는 encoded scalar를 wire 타입으로 생성함 |
| `pydantic/discriminator-without-variants` | warning | discriminator base에서 해석 가능한 variant를 찾지 못함 |
| `pydantic/default-on-required` | info | required field의 schema `default`를 무시함 |
| `pydantic/name-collision` | info | declaration/field Python 이름에 숫자 suffix 또는 충돌 회피 suffix를 붙임 |
| `pydantic/regex-engine-fallback` | warning | lookaround/backreference로 모델을 Python `re`로 전환 |
| `pydantic/regex-class-untranslatable` | warning | ECMA character class 안의 `\D` 또는 `\W` |
| `pydantic/extension-dropped` | warning | `x-*` 값이 JSON 직렬화 불가능하여 제거됨 |
| `pydantic/operation-id-missing` | warning | operationId가 없어 method와 path로 이름을 결정함 |
| `pydantic/operation-name-collision` | warning | operation model stem 충돌에 숫자 suffix를 붙임 |
| `pydantic/operation-unsupported` | warning | callback 또는 webhook처럼 후속 milestone construct를 만남 |
| `pydantic/media-type-unsupported` | warning | 스키마가 없고 내장 매핑도 제공하지 않는 media type |
| `pydantic/oneof-ambiguous` | info | exact oneOf branch를 정밀하게 판정할 수 없어 smart union으로 유지 |

CLI는 preflight fatal 또는 severity가 `error`인 진단이 있으면 non-zero로 끝난다. `--force`는
두 경우 모두 생성과 파일 쓰기를 계속한다. `--no-validate`는 preflight validation/lint를
끄고, `--no-normalize`는 OpenAPI normalization을 끈다. `--categories`는 preflight lint
카테고리를 쉼표로 제한한다.

## 산출물

`emitPydanticFiles`가 `PYDANTIC_GENERATED_BANNER`를 Python module 파일에 붙이므로 CLI,
`buildPydanticModels`의 `files`, plugin 등 모든 진입점의 module 파일에 다음 banner가 있다.
`result.source`와 `contentSha256`는 banner를 제외한 본문을 기준으로 한다.
생성 모듈 본문 첫 줄에는 `# ruff: noqa: E501`가 있어 line length는 생성 계약에서 강제하지 않는다.

```text
# @generated by @oa-sdk/codegen. DO NOT EDIT.
# Requires pydantic>=2.11, Python>=3.11.
```

`emitPydanticFiles`가 만드는 report의 schema는 `oa-sdk.pydantic-build-report.v1`이다.

| 필드 | 내용 |
|---|---|
| `schema` | 고정 schema identifier |
| `preset` | 사용한 `default`/`strict`/`passthrough` |
| `options` | 모든 semantic 옵션 값 (`emitIr`는 별도 output 옵션) |
| `fixed` | `PYDANTIC_FIXED_SETTINGS` 전체 |
| `output` | resolved output 경로 |
| `contentSha256` | banner 전 `source`의 SHA-256 |
| `declarations` | `models`, `enums`, `aliases`, `operations` 개수 |
| `files` | 생성한 상대 경로 목록(`models.py`, split 시 `operations.py`와 `__init__.py`, 선택적 IR) |
| `layout`, `emitOperations` | 출력 layout과 operation 수집 설정 |
| `diagnostics` | `info`, `warning`, `error`별 개수 |

`emitIr: true`이면 Python 파일 옆에 `<output>.ir.json`을 추가한다. 이 파일에는 pass가 끝난
`PyModuleIR`가 들며 banner는 없다. CLI의 `--report path.json`은 같은 report를 별도 JSON 파일로
쓴다.

## 검증과 테스트

- golden은 `packages/codegen/src/pydantic/__tests__/golden/`에 있으며 `approved`,
  `chunk-stream`, `cycles`, `scalars`, `operations` 다섯 fixture를 `default`, `strict`, `passthrough` 세 preset으로
  비교한다. `operations.ir.json`은 resolved operation IR golden이다.
- `packages/codegen/src/pydantic/__tests__/contract.test.ts`는 S0 옵션 우선순위, S3 JSON
  IR과 unresolved slot, 입력 schema 순서 독립성, S4 pass 관찰성, golden 일치, 결정성,
  `emitIr`, package root의 모든 stage export를 검사한다.
- 단계별 `lower`, pass, render 테스트는 매핑과 진단을 직접 확인한다.
- Python lane은 기본 skip이며 `uv`가 있을 때 다음 정확한 명령으로 opt-in한다.

```bash
OA_SDK_PYDANTIC_PY_LANE=1 corepack pnpm --filter @oa-sdk/codegen exec vitest run src/pydantic/__tests__/python-lane.test.ts
```

이 lane은 생성 모듈 import, example `model_validate`, alias/extra/optional/union/uniqueItems,
`model_rebuild()`, `ruff --select E,F,I001,UP037`, `pyright`를 확인한다. `encodingPolicy: decode`의 epoch/HTTP-date/base64url round-trip과 `frozen` assignment 거부도 검사하며, 기대 counter는 각각 `decodeUnix=1`, `decodeHttpDate=1`, `decodeBase64Url=1`, `dumpWire=1`, `modelExtension=1`, `frozenReject=1`이다.

## 알려진 제한

- operation parameter/body/response와 media/stream metadata를 렌더링한다. router, client, `ContractRegistry`, decorator 의미 해석은 이후 범위다.
- OAS `in: querystring` parameter는 `pydantic/operation-unsupported` warning과 함께 건너뛴다.
- `PYDANTIC_FIXED_SETTINGS`에는 `pydanticFloor`, `pythonFloor`, `unionMode`만 남아 있다.
- typed `__pydantic_extra__`와 discriminator subtype의 좁혀진 `Literal` tag에는 pyright가
  `reportIncompatibleVariableOverride`를 내므로 해당 선언 줄에만 targeted ignore 주석을 낸다.
  envelope variant는 상속하지 않으므로 ignore를 내지 않는다. Pydantic의 지원 패턴과 generated module의 pyright 검사를 함께 유지한다.
- `encodingPolicy: wire`는 기존 wire 타입과 `pydantic/encoding-degraded`를 유지하고, `decode`는
  `unixtime`, `http-date`, `base64url`을 semantic Python 값으로 변환한다. `@encode("seconds", int32)
  duration`처럼 OAS 출력에 인코딩이 남지 않는 경우는 감지할 수 없다.
- `encodingPolicy: decode`의 `base64url` 필드는 Python 값으로 모델을 만들 때도 encoded form(예: `"AQID"`)을 받는다. 검증 후 Python 값은 `bytes`다.
- `oneOf`/`anyOf`에 discriminator가 없으면 Pydantic의 smart union 의미를 사용하므로 JSON
  Schema의 “정확히 하나” 조건을 별도로 보장하지 않는다.
- `format: uri`의 `any-url`은 값을 정규화할 수 있다. 왕복 보존이 필요하면 기본 `uri: str`을
  사용한다.
