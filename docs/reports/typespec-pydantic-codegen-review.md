# TypeSpec(.tsp) → Pydantic v2 스키마 변환 지원 영역 검토

검토일: 2026-11-06 (Asia/Seoul)
상태: 설계 결정 완료, Phase 1 구현 완료 (설계: `docs/internal/architecture/pydantic-codegen-pipeline.md`, 사용자 가이드: [`docs/guides/pydantic-codegen.md`](../guides/pydantic-codegen.md)). 이 문서는 새 codegen 산출물·패키지 API를 채택하거나 배포하지 않는다. 이 검토는 구현 전 분석이며, 실제 구현과 다른 항목은 해당 행에 **Phase 1 구현:** 으로 표시하고 [§8](#8-구현-대조-2026-11-07)에 모았다.

## 1. 결론 요약

- **변환 위치**: TypeSpec Program을 직접 읽는 별도 emitter가 아니라, 기존 경로 `.tsp → @typespec/openapi3 → OAS 3.2(approved/restored) → codegen` 위에 **`SchemaAlgebra<PyExpr>` 구현체 하나를 추가**한다. Zod(`createZod4Algebra`)·TS(`createTypescriptAlgebra`)와 같은 `foldSchema` 순회, 정규화, preflight lint, cycle 탐지를 그대로 재사용한다. TypeSpec 출처는 기존 `oa-sdk.typespec-ref-provenance.v1` sidecar로 연결한다(TS의 `typespec-graph-semantic.ts`와 같은 방식).
- **방향성**: 저장소에는 이미 `Pydantic → OpenAPI` 수집 경로(`apps/fastapi-ref`, `templates/python-interface-monorepo`, `python-contract-spec-snapshot` source adapter)가 있다. 이번 검토 대상은 그 역방향인 **계약 → Pydantic DTO 생성**이며, 두 경로를 합치면 `tsp → OAS → Pydantic → model_json_schema() → oa-gen diff` 왕복 검증 루프가 닫힌다.
- **1차 범위(Phase 1)**: `components.schemas`의 모델·enum·union·alias만. operation 파라미터 모델, FastAPI 라우터 스텁, client는 Phase 2 이후.
- **쟁점 4개 결정 완료**(§6, 2026-11-06): `extra` 기본 `ignore`(Zod와 같은 의미), optional은 `None` 기본값 + 명시적 `null` 거부 validator, 필드명은 snake_case + 필드별 alias, 정규식은 ECMA 의미 보존 치환 + Rust 엔진.

## 2. 현재 구조에서 재사용 가능한 자산

| 자산 | 위치 | Pydantic 생성기에서의 용도 |
|---|---|---|
| `SchemaAlgebra<T>` / `foldSchema` | `packages/parser/src/fold.ts` | 노드별 Python 타입 식 생성. 순회 로직 신규 작성 불필요 |
| Zod 파일 오케스트레이션 | `packages/codegen/src/zodgen/generate-zod.ts` (`findCircularSchemas`, `extractRefsFromNode`, normalize, preflight) | 선언 순서(위상 정렬)·재귀 스키마 판별·preflight 진단을 그대로 공유. 공통 부분을 언어 중립 모듈로 추출하는 리팩터가 선행 작업 |
| Discriminator 처리 | `zodgen/schema-to-zod.ts` (`collectDiscriminatorProperties`, `buildMappingBranches`) | 다형성 ref를 tagged union으로 치환할 때 동일 매핑 로직 사용 |
| Python 식별자/예약어 처리 | `codegen/src/sketch-emitter/index.ts` (`PYTHON_KEYWORDS`, `pythonIdentifier`) | 공용 유틸로 승격. 단, sketch emitter의 `@dataclass` stub는 sketch IR(TypeSpec 텍스트) 기반이라 스키마 충실도가 낮아 생성기 자체는 재사용하지 않는다 |
| Plugin VFS | `codegen/src/plugin/types.ts` (`TspGeneratedFile`) | `models.py`를 plugin 산출물로 추가. 기본 banner가 `//` 주석 문법 파일에만 붙으므로 `.py`는 `# @generated ...` banner를 명시해야 한다 |
| 산출물 추적 | `.oa-manifest.json`, typegen graph semantic sidecar | `models.py`의 SHA-256·입력 spec·TypeSpec 출처 결속. **Phase 1 구현:** manifest·출처 sidecar 결속은 없다. build report(`oa-sdk.pydantic-build-report.v1`)의 `contentSha256`만 제공 |

## 3. 실제 사용 중인 TypeSpec/OAS 기능 프로파일

`packages/schemas/typespec/approved.openapi.yaml`(2,598줄)과 `.tsp` 원본 기준 집계.

| 기능 | 사용량 | 비고 |
|---|---|---|
| `format: uuid` / `date-time` / `int64` / `email` / `uri` | 27 / 9 / 9 / 5 / 1 | `format: json`(2)은 example 값 내부이며 스키마 format이 아님 |
| `enum` | 32 | 이름 있는 TypeSpec `enum`·리터럴 union 혼재 |
| `minLength` / `maximum` | 27 / 4 | `pattern`, `multipleOf`, `uniqueItems`, `exclusive*`는 현재 0 |
| `unevaluatedProperties` | 10 | `{not: {}}`(닫힌 모델, `...Record<never>` 계열)과 `$ref`(타입 있는 map) 두 형태 |
| `anyOf` / `oneOf` / `const` | 2 / 1 / 1 | `oneOf`·`const`는 SSE 이벤트 응답(`contentSchema`) 안에서만 등장 |
| nullable (`type: [..., "null"]`) | 1 | |
| `allOf` / `discriminator` | 0 (approved) | 그러나 `chunk-stream.tsp`에 `@discriminator` 3개 + `extends` 13개. `main.tsp`가 import하지 않아 approved에 안 나올 뿐, 별도 spec으로 쓰이므로 **지원 필수** |
| 재귀 모델 | e2e `cycles` fixture | `TreeNode.children`, `Comment.replies` |
| `utcDateTime` / `duration` / `bytes` / `unknown` | 14 / 5 / 1 / 6 | `.tsp` 원본 기준 |

## 4. 매핑 표 (OAS 3.2 → Pydantic v2)

등급: **A** 무손실 · **B** 생성 가능하나 의미 차이 있음(진단 또는 옵션 필요) · **C** 미지원, 진단 후 `Any`/원시 타입으로 강등.

### 4.1 스칼라·format

| OAS | Pydantic | 등급 | 주의점 |
|---|---|---|---|
| `string` | `str` | A | |
| `integer` | `int` | A | Python int는 무한 정밀도. `int32`/`int64` 등 폭은 `Field(ge=, le=)`로 경계를 생성해야 TypeSpec 의미가 보존됨 |
| `integer` + `format: int64` | `int` + 경계 | A | JSON 직렬화 시 JS 쪽 정밀도 문제는 Python과 무관 |
| `number` (`float32/64`) | `float` | A | `decimal`/`decimal128` → `Decimal` (B: 직렬화가 문자열/숫자 중 무엇인지 확인 필요) |
| `boolean` / `null` | `bool` / `None` | A | |
| `format: uuid` | `uuid.UUID` | A | 직렬화 시 소문자 하이픈 형식으로 정규화됨 |
| `format: date-time` | `datetime` 또는 `AwareDatetime` | B | TypeSpec `utcDateTime`은 오프셋 필수 의미 → `AwareDatetime` 권장. `datetime`은 naive 값을 허용함 |
| `format: date` / `time` | `date` / `time` | A | `plainDate` / `plainTime` |
| `format: duration` | `timedelta` | B | ISO 8601 파싱은 되지만 연·월 단위(`P1Y`)는 timedelta로 표현 불가 → 진단. **Phase 1 구현:** `timedelta`로 생성하고 진단은 없다 |
| `format: email` | `EmailStr` | B | `pydantic[email]` 추가 의존성. 두 Python 패키지 모두 이미 사용 중 |
| `format: uri` / `url` | `AnyUrl` 또는 `str` | B | `AnyUrl`은 정규화(끝 `/` 추가 등)로 **왕복 시 값이 바뀜**. 기본값은 `str` + `Field(json_schema_extra={"format": "uri"})` 권장. **Phase 1 구현:** 기본 `uri: str`은 `str`만 생성하고 `format`을 `json_schema_extra`로 보존하지 않는다 |
| `format: byte` / `contentEncoding: base64` | `Base64Bytes` | B | `bytes` 스칼라 |
| `@encode(unixTimestamp)` 등 인코딩 | `int` / `datetime` + serializer | C→B | Phase 1은 원시 wire 타입(`int`)으로 생성하고 진단. **Phase 1 구현:** wire 타입으로 생성하고 `pydantic/encoding-degraded` info를 낸다. `@typespec/openapi3`는 `unixTimestamp`를 `format: unixtime`, `rfc7231`을 `format: http-date`, `@encode("base64url") bytes`를 `contentEncoding: base64url`로 쓰므로 감지된다. `@encode("seconds", int32) duration`은 `format: int32`만 남아 감지할 수 없고 진단 없이 `int`가 된다 |
| `unknown` / `{}` | `Any` (또는 `JsonValue`) | A | `JsonValue`가 JSON 가능 값만 허용하므로 더 정확 |

### 4.2 제약

| OAS | Pydantic | 등급 | 주의점 |
|---|---|---|---|
| `minLength`/`maxLength` | `Field(min_length=, max_length=)` | A | |
| `minimum`/`maximum`/`exclusive*` | `Field(ge=, le=, gt=, lt=)` | A | |
| `multipleOf` | `Field(multiple_of=)` | A | float 오차는 Pydantic도 동일 |
| `minItems`/`maxItems` | `Field(min_length=, max_length=)` (list) | A | |
| `pattern` | `Field(pattern=)` | B | JSON Schema는 ECMA-262 정규식, Pydantic v2 기본은 Rust `regex`(lookaround·backreference 미지원). Rust·Python `re` 모두 `\d`·`\w`가 Unicode를 매치하므로 ASCII 클래스로 치환 → §6 결정 4 |
| `uniqueItems` | `list[T]` + `AfterValidator` | B | `set[T]`는 순서 소실·hashable 요구로 부적합 |
| `const` | `Literal[value]` | A | |
| `enum` (문자열, 이름 있는 component) | `class X(StrEnum)` | A | |
| `enum` (인라인·혼합 타입) | `Literal[...]` | A | |
| `default` | `Field(default=...)` | A | `foldSchema`가 `default`를 만나면 타입 해석 전에 `default_`로 단락되므로, Zod와 같이 default를 떼어 두는 처리(`defaultValues` WeakMap 패턴)를 그대로 따라야 함 |
| `description` / `title` / `examples` / `deprecated` | `Field(description=, title=, examples=, deprecated=)` | A | `deprecated`는 Pydantic 2.7+. **Phase 1 구현:** `title`은 생성하지 않는다 |

### 4.3 객체·조합

| OAS / TypeSpec | Pydantic | 등급 | 주의점 |
|---|---|---|---|
| `model` (properties + required) | `class X(BaseModel)` | A | |
| 필수 + nullable | `x: T \| None` (default 없음) | A | |
| 선택(필수 아님) | `x: T \| None = None` + 비-nullable이면 `null` 거부 validator | **B** | `x?: T \| null`의 "키 없음"과 "`null`"은 `model_fields_set`으로만 구분됨 → §6 결정 2 |
| `additionalProperties` 미선언 (TypeSpec 기본, 열린 모델) | `extra="ignore"` (기본) | **B** | 미선언 필드를 버림. Zod `z.object()` 기본(strip)과 같은 의미 → §6 결정 1 |
| `unevaluatedProperties: {not: {}}` (닫힌 모델) | `ConfigDict(extra="forbid")` | A | approved 10건 중 다수 |
| `additionalProperties: T` / `unevaluatedProperties: T` + properties | `extra="allow"` + `__pydantic_extra__: dict[str, T]` | A | 타입 있는 extra 주석은 Pydantic 2.x 지원 |
| properties 없는 `Record<T>` | `dict[str, T]` | A | `world-model` `roles` |
| `prefixItems` (TypeSpec 튜플) | `tuple[A, B]` | A | |
| `anyOf` / `oneOf` (판별자 없음) | `A \| B` | B | Pydantic smart union은 "가장 잘 맞는 하나"를 고르고, `oneOf`의 "정확히 하나" 의미를 검증하지 않음. 닫힌 모델(`forbid`)끼리면 실질적으로 구분됨 |
| `@discriminator` + `extends` (base에 discriminator mapping, 자식은 `allOf: [$ref Base]`) | 자식 `class Child(Base)` + `state: Literal["available"]`, 참조 지점은 `Annotated[A \| B \| ..., Field(discriminator="state")]` | **B (필수 처리)** | `$ref: NextPointer`는 OAS에서 "모든 하위 타입"을 뜻하지만, 그대로 `NextPointer`로 생성하면 base로만 검증되어 하위 필드가 버려짐. **다형성 ref를 tagged union alias로 치환**해야 함 |
| `@discriminated` envelope union | wrapper 모델 + tagged union | B | `envelope: "none"`은 위 방식, `"object"`는 `{kind, value}` wrapper 모델. **Phase 1 구현:** envelope 전용 처리는 없다. 출력된 OAS의 `oneOf`/`anyOf`를 일반 union 규칙으로 생성 |
| `allOf` (상속 아닌 합성) | 다중 상속 또는 평탄화 | B | 충돌 필드는 평탄화 후 진단 |
| `model is` / spread `...` | 평탄화되어 OAS에 반영 | A | OAS 단계에서 이미 해소 |
| `if/then/else`, `not`(빈 `{}` 외), `dependentSchemas`, `patternProperties`, `propertyNames` | — | C | `model_validator` 수작업 영역. 진단 후 구조만 생성 |
| 재귀 `$ref` | 문자열 forward ref + `model_rebuild()` | A | `from __future__ import annotations` 사용 시 선언 순서 무관. 상호 재귀는 모듈 끝 일괄 `model_rebuild()` |
| visibility(`@visibility`, Create/Update 변형) | 별도 component로 이미 분리됨 | A | `readOnly`/`writeOnly` 사용량 0 |

### 4.4 식별자

| 상황 | 처리 |
|---|---|
| camelCase 프로퍼티(`targetLogicalTime`) | `target_logical_time: ... = Field(alias="targetLogicalTime")` + `ConfigDict(validate_by_name=True, serialize_by_alias=True)` (§6 쟁점 3) |
| Python 예약어(`from`, `class`, `in`) | `from_` + alias |
| `BaseModel` 속성과 충돌(`json`, `copy`, `dict`, `schema`, `model_*`) | 접미사 `_` + alias. Pydantic 경고/오류 방지 |
| 식별자 불가 키(`x-count`, `2fa`) | 정규화 + alias |
| component 이름 충돌(정규화 후 중복) | TS `type-names.ts`의 dedup 규칙과 동일하게 숫자 접미사 |

### 4.5 oa-sdk 커스텀 decorator

`@oa-sdk/typespec-decorators`의 `@crdt`, `@protobuf`, `@storageRef`, `@pseudonymize`, `@personaCapability`, `@traceId` 등은 Pydantic 모델의 구조 의미가 아니다. Phase 1은 출력된 `x-oa-sdk-*` 확장을 `Field(json_schema_extra=...)`/`model_config["json_schema_extra"]`로 보존만 하고 해석하지 않는다(`semantic-abstraction-contract-boundary.md`의 비재해석 원칙과 일치). `@pseudonymize` → `SecretStr` 같은 의미 매핑은 별도 결정 대상이며 이번 범위에서 제외한다. **Phase 1 구현:** 필드의 `x-*`만 `Field(json_schema_extra=...)`로 렌더링한다. 모델 수준 확장은 IR에는 보존되지만 `model_config`로 출력하지 않는다.

## 5. 범위 제안

| 단계 | 범위 | 산출물 |
|---|---|---|
| Phase 0 | zodgen의 언어 중립 부분(순서·cycle·preflight·discriminator 수집)을 공용 모듈로 추출. 동작 변경 없음 | 기존 Zod 테스트 그대로 통과 |
| Phase 1 | `components.schemas` → `models.py` (A·B 등급 전부, C는 진단). `oa-gen generate:pydantic` CLI 명령 + plugin | `models.py`, 진단 JSON, manifest 항목. **Phase 1 구현:** `models.py`, build report JSON(`--report`), 선택적 `models.py.ir.json`. manifest 항목은 없다 |
| Phase 1 검증 | (1) 생성 코드 golden test (TS 단위 테스트), (2) `uv run python -c "import models"` + `model_rebuild()` 성공, (3) **왕복 parity**: `model_json_schema(by_alias=True)`와 원본 OAS 스키마를 정규화 비교, (4) approved spec의 example 값을 `model_validate`로 통과 확인 | Python 검증은 `fastapi-ref`처럼 uv가 있는 lane에서만 실행 (TS 패키지 테스트는 Python 실행에 의존하지 않음). **Phase 1 구현:** (1)(2)(4)는 구현됨(lane은 `OA_SDK_PYDANTIC_PY_LANE=1`). (3) 왕복 parity 비교는 구현되지 않았다 |
| Phase 2 | operation별 Path/Query/Header 파라미터 모델, request/response body alias, 에러 union | `operations.py` |
| Phase 3 | FastAPI 라우터 스텁 또는 `python-interface-monorepo`의 `ContractRegistry` 등록 코드 | 템플릿 연동 |

비채택: TypeSpec emitter-framework 기반 직접 emitter. 다른 모든 codegen 타깃이 OAS를 입력으로 하므로 의미 차이가 타깃마다 갈라지고, approved snapshot·drift 게이트를 우회하게 된다.

외부 도구 대안: `datamodel-code-generator`를 approved OAS에 실행하는 방법도 있으나, (1) 다형성 ref 치환·닫힌 모델·TypeSpec 출처 sidecar·manifest 결속을 oa-sdk 규칙대로 맞출 수 없고, (2) 생성 시점에 Python 런타임이 필요해져 TS codegen 경로의 결정성 게이트와 분리된다. 왕복 parity 테스트의 **비교 기준(oracle)** 으로 쓰는 것은 유용하다.

## 6. 결정 사항 (2026-11-06)

1. **열린 모델의 `extra` 정책 → 기본 `ignore`, `--extra allow|forbid` 옵션**
   - 근거: 기존 Zod 생성기는 열린 모델을 `z.object()`로 내어 미선언 필드를 버린다(`schema-to-zod.ts`의 `isStrict` 분기). 두 타깃의 런타임 의미를 맞춘다.
   - `forbid`를 기본값으로 하지 않은 이유: 응답 프로퍼티 추가는 drift 규칙상 비파괴 변경인데, `forbid`이면 Python 클라이언트가 깨진다.
   - 닫힌 모델(`unevaluatedProperties: {not: {}}` 또는 `additionalProperties: false`)은 옵션과 무관하게 항상 `forbid`, 타입 있는 map은 항상 `allow` + `__pydantic_extra__: dict[str, T]`.
2. **optional과 nullable 구분 → `None` 기본값 + 명시적 `null` 거부 validator**
   - `x?: T` → `x: T | None = None` + `x`가 키로 들어왔는데 값이 `None`이면 거부하는 `field_validator`. 직렬화는 `exclude_unset=True` 기준.
   - `x?: T | null` → `x: T | None = None`, validator 없음. 키 없음과 `null`의 구분은 `model_fields_set`.
   - Pydantic 2.12 experimental `MISSING` sentinel은 생성 코드가 실험 API에 묶이므로 채택하지 않는다(향후 `--optional-style missing` 후보).
3. **필드명 규칙 → snake_case + 필드별 명시 alias**
   - `Field(alias="<wire 이름>")` + `ConfigDict(validate_by_name=True, validate_by_alias=True, serialize_by_alias=True)`. `alias_generator`는 쓰지 않는다(wire 이름이 규칙적인 camelCase라는 보장이 없음).
   - 예약어·`BaseModel` 속성 충돌·식별자 불가 키는 §4.4 규칙.
   - **Pydantic 하한 2.11**. `apps/fastapi-ref`(현재 ≥2.9)는 생성 모델을 쓰게 되면 하한을 올린다. 템플릿은 이미 ≥2.12.
4. **정규식 → ECMA 의미 보존 치환 + Rust 엔진**
   - 문자 클래스 바깥의 `\d` → `[0-9]`, `\D` → `[^0-9]`, `\w` → `[A-Za-z0-9_]`, `\W` → `[^A-Za-z0-9_]`; 문자 클래스 안에서는 `0-9` / `A-Za-z0-9_`로 전개(부정 클래스 내부 `\D`·`\W`는 치환 불가로 진단). 치환은 이스케이프·문자 클래스를 인식하는 토크나이저로 수행한다.
   - 기본 Rust 엔진. lookaround(`(?=`, `(?!`, `(?<=`, `(?<!`)나 backreference가 있으면 해당 모델만 `regex_engine="python-re"`로 전환하고 `pydantic/regex-engine-fallback` 진단.
   - 치환 결과가 원본과 다르면 원본 pattern을 `json_schema_extra`에 보존해 왕복 parity 비교에 사용한다. **Phase 1 구현:** 원본 pattern은 보존하지 않는다(왕복 parity 비교도 미구현).

## 7. 근거 위치

- 순회·algebra: `packages/parser/src/fold.ts`
- 기존 algebra: `packages/codegen/src/zodgen/schema-to-zod.ts`, `packages/codegen/src/typegen/schema-to-ts.ts`
- Python stub(참고용): `packages/codegen/src/sketch-emitter/index.ts`
- Python 수집 방향: `packages/codegen/src/cli/lib/source-adapters.ts`, `apps/fastapi-ref/`, `templates/python-interface-monorepo/`
- 다형성 사례: `packages/schemas/typespec/chunk-stream.tsp` (`NextPointer`, `UiCue`, `ChunkStreamItem`)
- 재귀 사례: `test/e2e/typespec-plugin/fixtures/cycles/main.tsp`
- 경계 원칙: `docs/internal/architecture/semantic-abstraction-contract-boundary.md`, `docs/internal/architecture/codegen-boundaries.md`

## 8. 구현 대조 (2026-11-07)

Phase 1 구현(mineclover/oa-sdk#25·#26)을 이 검토와 대조한 결과다. 구현된 동작의 정본은 코드와 [사용자 가이드](../guides/pydantic-codegen.md)이며, 아래 항목은 이 검토가 제안했지만 Phase 1에 들어가지 않은 것이다.

| 검토 위치 | 제안 | Phase 1 구현 |
|---|---|---|
| §2 산출물 추적, §5 Phase 1 | `.oa-manifest.json`·TypeSpec 출처 sidecar 결속 | 없음. build report의 `contentSha256`만 |
| §4 `format: duration` | 연·월 단위 진단 | `timedelta`만, 진단 없음 |
| §4 `format: uri` | `str` + `json_schema_extra={"format": "uri"}` | `str`만 |
| §4 `@encode` 인코딩 | wire 타입 + 진단 | wire 타입 + `pydantic/encoding-degraded`. 단 `@encode("seconds", …) duration`은 OAS 출력에 인코딩이 남지 않아 진단 없음 |
| §4 `title` | `Field(title=...)` | 생성하지 않음 |
| §4 `@discriminated` envelope | `{kind, value}` wrapper 모델 | 전용 처리 없음, 일반 union 규칙 |
| §4.5 모델 수준 `x-*` | `model_config["json_schema_extra"]` | IR에만 보존, 렌더링하지 않음 |
| §5 Phase 1 검증 (3) | `model_json_schema(by_alias=True)` 왕복 parity | 미구현 |
| §6 결정 4 | 치환 전 원본 pattern 보존 | 미구현 |

설계 문서 쪽 정정(옵션 수, `pydantic/encoding-degraded` 발생 조건 — 이후 인코딩된 스칼라에서만 나도록 수정)은 `docs/internal/architecture/pydantic-codegen-pipeline.md` §3·§5에 반영했다.
