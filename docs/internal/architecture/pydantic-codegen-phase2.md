# OAS 3.2 → Pydantic v2 코드 생성 Phase 2 제안

상태: P2a 일부 구현 완료
작성일: 2026-11-08

이 문서는 [사용자 가이드](../../guides/pydantic-codegen.md)와 [Phase 1 파이프라인 설계](./pydantic-codegen-pipeline.md)를 기준으로 다음 단계를 제안한다. P2a 품질 부채 항목은 구현 상태를 함께 기록하고, operations 이후 항목은 `제안`으로 표시한다.

## Phase 1 기준선

1. 입력 경로는 `.tsp → @typespec/openapi3 → OAS 3.2 → @oa-sdk/codegen`이다(`docs/guides/pydantic-codegen.md:7`).
2. Phase 1은 `components.schemas`만 읽고 `models.py` 한 모듈을 만든다(`docs/guides/pydantic-codegen.md:15`).
3. object, named enum, union/조합, scalar alias가 현재 선언 종류다(`docs/guides/pydantic-codegen.md:15`).
4. operation parameter, request/response operation model, FastAPI router stub, `ContractRegistry`는 범위 밖이다(`docs/guides/pydantic-codegen.md:15`).
5. S0은 `resolvePydanticBuildOptions`, S1은 문서 준비, S2는 `analyzeSchemaGraph`다(`docs/internal/architecture/pydantic-codegen-pipeline.md:20`).
6. S3는 사실 전용 IR, S4는 결정 pass, S5는 Python 렌더, S6는 파일·report 방출이다(`docs/internal/architecture/pydantic-codegen-pipeline.md:23`).
7. S4 pass는 선언한 `reads` 옵션만 받고 입력 IR을 변경하지 않는다(`docs/internal/architecture/pydantic-codegen-pipeline.md:32`).
8. `extra`, `optionalStyle`, `naming`, `regex`, `enumStyle`, `datetime`, `uri`, `intBounds`, `encodingPolicy`, `extensions`, `docstrings`, `frozen`이 공개 semantic 옵션이다(`packages/codegen/src/pydantic/options.ts:10`).
9. 기본 출력은 `models.py`, 선택적으로 `<output>.ir.json`을 낸다(`packages/codegen/src/pydantic/options.ts:32`).
10. 고정 설정은 `unionMode: smart`, `layout: single` 등이다(`packages/codegen/src/pydantic/options.ts:73`).
11. 검증은 TypeScript contract/golden과 선택적 Python lane으로 나뉘며 Python lane은 `ruff --select E,F,I001,UP037`와 pyright까지 확인한다(`docs/guides/pydantic-codegen.md:367`).
12. Phase 1의 정본 동작과 설계의 차이는 review report §8에 정리되어 있다(`docs/reports/typespec-pydantic-codegen-review.md:157`).

## 미구현 항목 인벤토리

아래 표는 파이프라인의 범위 밖 선언, review report의 구현 대조, 사용자 가이드의 제한, 고정 설정, 내부 TODO를 합쳐 중복을 한 번만 기록한 것이다.

| 항목 | 출처 | 현재 상태와 후속 의미 |
|---|---|---|
| operation Path/Query/Header/Cookie parameter 모델 | `docs/internal/architecture/pydantic-codegen-pipeline.md:146` | `paths`를 읽는 선언과 `operations.py` 출력이 없다. |
| request/response body alias와 에러 union | `docs/reports/typespec-pydantic-codegen-review.md:121` | operation별 body·status 모델이 없다. |
| FastAPI router stub | `docs/internal/architecture/pydantic-codegen-pipeline.md:146` | 라우트 등록 코드가 없다. |
| `ContractRegistry` 등록 | `docs/reports/typespec-pydantic-codegen-review.md:122` | Phase 3 후보로만 남아 있다. |
| custom decorator 의미 해석 | `docs/internal/architecture/pydantic-codegen-pipeline.md:146` | `@pseudonymize` 등의 의미 매핑을 하지 않는다. |
| 모델 수준 `x-*` 렌더링 | `docs/guides/pydantic-codegen.md:232` | IR에는 보존하지만 `model_config`로 출력하지 않는다. |
| `@encode` wire 값 디코딩 | `docs/guides/pydantic-codegen.md:394` | `int`/`str` wire 타입과 진단만 내며 validator/serializer가 없다. |
| 인코딩을 잃는 duration 진단 | `docs/guides/pydantic-codegen.md:397` | `@encode("seconds", int32) duration`은 OAS에 `format: int32`만 남아 감지되지 않는다. |
| discriminator 없는 `oneOf` 정확성 | `docs/guides/pydantic-codegen.md:399` | Pydantic smart union으로 “정확히 하나”를 보장하지 않는다. |
| pyright override 진단 | `docs/guides/pydantic-codegen.md:389` | P2a에서 해당 생성 줄에 targeted ignore를 내고 lane에서 검사한다. |
| 넓은 ruff 규칙 | `docs/guides/pydantic-codegen.md:392` | P2a lane이 `E,F,I001,UP037`를 검사한다. |
| `title`·pattern 원문 보존·왕복 parity | `docs/reports/typespec-pydantic-codegen-review.md:167` | `Field(title=...)`, 원본 pattern, `model_json_schema` 비교가 구현되지 않았다. |
| `@discriminated` envelope | `docs/reports/typespec-pydantic-codegen-review.md:168` | `{kind, value}` 전용 wrapper가 없다. |
| manifest·TypeSpec provenance 결속 | `docs/reports/typespec-pydantic-codegen-review.md:163` | build report의 `contentSha256`만 있다. |
| duration 연·월 단위 진단 | `docs/reports/typespec-pydantic-codegen-review.md:164` | `timedelta`로 생성하고 진단하지 않는다. |
| URI format metadata 보존 | `docs/reports/typespec-pydantic-codegen-review.md:165` | `str`만 출력하고 `json_schema_extra`에 format을 넣지 않는다. |
| URI 값 정규화 정책 | `docs/guides/pydantic-codegen.md:401` | `any-url`은 끝 `/` 추가 등 값 변경이 가능하므로 round-trip 정책을 별도 결정해야 한다. |
| fixed settings 옵션화 | `packages/codegen/src/pydantic/options.ts:73` | P2a에서 `frozen`, `docstrings`, `extensions`를 사용자 옵션으로 열었고 `layout`, `unionMode`만 남겼다. |
| `@traceId` 공유 parameters/익명 type 정책 | `docs/internal/todo.md:108` | provenance로 해소된 현재 정책과 operation 모델 이름 정책을 함께 검토해야 한다. |
| Python `ContractSpec`/registry diff 연결 | `docs/concepts/system-capabilities.md:24` | Pydantic DTO가 `ContractSpec.schemas`가 될 수 있으나 생성기와 자동 연결되지 않는다. |
| runtime FastAPI drift의 생성 모델 입력 | `docs/concepts/system-capabilities.md:36` | runtime OpenAPI 비교는 존재하지만 Pydantic 생성 산출물과 직접 묶이지 않는다. |
| FastAPI governance scaffold | `docs/internal/todo.md:158` | scaffold와 `apps/fastapi-ref`는 완료된 기반 자산이며 Phase 2 미구현 항목으로 중복 집계하지 않는다. |

`@pseudonymize`를 `SecretStr`로 바꾸자는 제안은 구조 의미가 아니므로 별도 결정 대상이다(`docs/reports/typespec-pydantic-codegen-review.md:112`). 내부 TODO의 operation 묶음 타입은 이미 TypeScript에서 완료되었으므로 중복 항목으로 세지 않는다(`docs/internal/todo.md:491`).

## 후보 범위 분석

### 공통 분석 원칙

operation 확장은 `components.schemas` 경로를 깨지 않고 `paths`, `components.parameters`, `components.requestBodies`, `components.responses`, `components.headers`를 추가 입력으로 읽는다. TypeSpec operation은 `@operationId`·`@route`·HTTP verb와 함께 `@path`·`@body` parameter 및 union return을 선언한다(`packages/schemas/typespec/users.tsp:563`, `packages/schemas/typespec/users.tsp:564`, `packages/schemas/typespec/users.tsp:565`, `packages/schemas/typespec/users.tsp:566`). 다른 생성기는 이미 operation을 분해한다. `@oa-sdk/client`는 path/query/querystring/header와 request body를 별도로 고른다(`packages/client/src/request-contract.ts:18`), TanStack 타입 import는 `PathParams`, `QueryParams`, `HeaderParams`, `Body`, `Response`, `Error` 이름을 사용한다(`packages/client/src/tanstack/generate-tanstack.ts:157`). `surface-ir`는 `operationId` 필수·충돌 진단과 path/method를 보존한다(`packages/surface-ir/src/index.ts:193`). 이 규칙은 재사용하되 Pydantic의 alias, `Field`, `Annotated`, Python 예약어 처리는 Pydantic pass가 소유한다.

공통 제안 IR은 다음과 같다.

```ts
// 제안: PyOperationDecl
interface PyOperationDecl {
  kind: 'operation'
  operationId: string
  method: string
  path: string
  parameters: PyOperationParameterDecl[]
  requestBody: PyBodyDecl | null
  responses: PyResponseDecl[]
}
```

`PyOperationDecl`는 `PyDecl` union에 추가하는 제안이며 현재 API가 아니다. S1은 prepared 문서에 operation 목록을 추가하고, S2는 schema graph 분석을 기존 모델과 operation inline schema에 재사용한다. S3는 operation 사실을 낮추고, S4는 `operationNaming`, `operationBodies`, `operationResponses` pass를 추가하며, S5는 layout에 따라 한 파일 또는 분리 파일을 렌더하고, S6는 파일 metadata와 report 선언 수를 확장한다. 새 옵션은 해당 pass의 `reads`에 반드시 나타나야 한다.

### A. Operation 모델

**입력.** 각 `paths` operation의 path/query/header/cookie parameter, JSON request body, 성공·오류 response body와 response headers를 읽는다. TypeSpec의 `@path` parameter, `@body` parameter와 union response는 `purgeUser` 시그니처에 실제로 있다(`packages/schemas/typespec/users.tsp:563`, `packages/schemas/typespec/users.tsp:564`, `packages/schemas/typespec/users.tsp:565`, `packages/schemas/typespec/users.tsp:566`). `$ref` parameter와 response는 preflight 후 해소한다.

**제안 출력.** 기본은 `operations.py`이며 모델 이름은 `<OperationName>PathParams`, `<OperationName>QueryParams`, `<OperationName>HeaderParams`, `<OperationName>CookieParams`, `<OperationName>Body`, `<OperationName>Response`, `<OperationName>Error`다. 이 이름은 다른 generator의 import 규칙과 맞는다(`packages/client/src/tanstack/generate-tanstack.ts:157`).

```py
# 예시/제안
class GetUserPathParams(BaseModel):
    user_id: UUID = Field(alias="userId")

class CreateUserBody(BaseModel):
    email: EmailStr

class GetUserResponse(BaseModel):
    status: Literal[200]
    body: User
```

**파이프라인 적합성.** `PyOperationParameterDecl`에 `location`, `style`, `explode`, `required`, `schema`를 둔다(모두 제안). `PyResponseDecl`에는 status, media type, schema, headers를 둔다. S1은 `document.operations`를 보존하고 operation pointer를 만든다. S2의 `analyzeSchemaGraph`와 `foldSchema`는 component·inline schema 양쪽에 재사용한다. S3는 parameter/body/response 사실만 기록한다. S4에는 (1) `operationNaming`(`reads: ['naming']` 제안), (2) `operationOptionalPolicy`(`reads: ['optionalStyle']` 제안), (3) `operationStatusUnion`(`reads: ['unionMode']` 제안), (4) `operationSerialization`(`reads: ['parameterStyle']` 제안) pass를 둔다. S5는 `operations.py`를 위한 module renderer를 호출하고, S6는 `kind: 'operations'` 파일을 추가한다. `analyzeSchemaGraph`는 재사용하지만 path ordering·operation name collision 분석은 새 shared helper가 필요하다.

**테스트.** `path/query/header/cookie`, path required, nullable optional, JSON·text·binary body, 2xx/4xx union, response header fixture를 OAS로 고정한다. TypeScript golden은 import와 alias를 비교한다. contract test는 operation 순서 무관성, duplicate operationId 진단, 모든 operation schema의 ref closure를 확인한다. Python lane은 `model_validate`, `model_dump(by_alias=True)`, `Literal` status, `model_rebuild()`를 확인한다. FastAPI lane에서는 `TestClient` 요청/응답 schema와 generated model JSON Schema를 비교한다.

**위험.** parameter serialization(style/explode), 다중 media type, `default` response, streaming, cookie 보안, inline schema 이름 충돌이 크다. client의 `application/json` 선택 규칙을 그대로 복사하면 Pydantic semantics가 어긋날 수 있다. 우선 JSON 단일 media type과 명시 operationId만 지원하고 나머지는 `pydantic/operation-unsupported` warning으로 강등한다(진단 코드는 제안).

**공수.** L — OAS operation 전체와 새 파일 layout, status/error semantics, Python 검증을 함께 다뤄야 한다.

### B. FastAPI router stubs

**입력.** A의 operation 선언과 생성된 Pydantic 모델 import 경로를 사용한다. `apps/fastapi-ref`는 현재 `FastAPI()`에 decorator와 실제 메모리 business logic을 한 파일에 둔다(`apps/fastapi-ref/src/main.py:18`, `apps/fastapi-ref/src/main.py:39`). 이것은 참조 앱이지 생성 stub의 business layer가 아니다.

**제안 출력.** `routers.py` 또는 `routers/<tag>.py`에 `APIRouter`와 handler signature만 만든다.

```py
# 예시/제안: business logic은 소유하지 않는다
router = APIRouter(prefix="/users", tags=["users"])

@router.get("/{user_id}", response_model=User)
def get_user(user_id: UUID) -> User:
    raise NotImplementedError("implement get_user")
```

`@oa-sdk/router`가 handler contract와 router를 분리하고 `stub`/`contract` 모드를 제공한다는 구조(`packages/router/src/generate-router-renderer.ts:11`, `packages/router/src/generate-router-renderer.ts:18`)를 따른다. 생성된 Python stub은 handler를 주입받는 `create_router(handlers)` 제안을 우선하고, 함수 본문은 예외 또는 명시적 TODO만 둔다. 실제 `apps/fastapi-ref`의 `create_user`처럼 저장소를 갱신하는 코드는 생성하지 않는다(`apps/fastapi-ref/src/main.py:50`).

**파이프라인 적합성.** A가 낸 `PyOperationDecl`을 S5 router renderer가 소비한다. S1/S2/S3는 재사용하고, S4에는 `routerTarget`(`reads: ['routerTarget']` 제안)과 `asyncHandlers`(`reads: ['asyncHandlers']` 제안)를 읽는 `routerSignature` pass를 추가한다. S6는 router 파일 metadata와 source plugin 이름을 낸다. FastAPI import는 router 모듈만 책임지고, models/operations 모듈은 framework-free로 유지한다.

**테스트.** fixture마다 `APIRouter` 등록, path/response model, handler parameter annotation을 golden으로 비교한다. Python lane에서 import/type introspection을 하고 `FastAPI.include_router()` 후 `app.openapi()`가 원본 path와 같음을 검사한다. handler 호출은 business logic이 없으므로 `NotImplementedError` invariant만 확인한다. `@oa-sdk/router`의 router renderer 테스트처럼 타입 계약과 runtime renderer를 분리한다(`packages/router/src/__tests__/generate-router.test.ts:11`).

**위험.** sync/async 선택, dependency injection, streaming response, security dependency, tag별 파일 분할이 framework 정책을 끌어들인다. 따라서 Phase 2에서는 FastAPI만, sync 기본·`asyncHandlers` 명시 옵션만 지원하고 dependency 구현은 생성하지 않는다.

**공수.** M — A의 operation IR을 재사용하지만 Python decorator와 import graph 검증이 필요하다.

### C. `ContractRegistry` 통합

**입력과 현재 자산.** Python template의 `ContractRegistry`는 `BaseModel`을 이름으로 등록하고(`templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/registry.py:56`, `templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/registry.py:102`), `ContractSpec`를 만든다(`templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/registry.py:523`). `ContractSpec`는 endpoints, schemas, responses, examples, targets를 보유한다(`templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/spec.py:72`).

**제안 출력.** 별도 `contracts.py`에 registry를 만들고 generated model과 operation을 명시적으로 등록한다.

```py
# 예시/제안: route는 keyword-only decorator이며 handler를 등록한다
from oa_interface_contracts import ContractRegistry
from .models import User

registry = ContractRegistry(name="Users API", version="1.0.0")
registry.model("User", User, audience="public")
@registry.route(
    method="get", path="/users/{userId}", operation_id="getUser",
    response_model="User", path_params=["userId"],
)
def get_user(user_id: str) -> User:
    raise NotImplementedError
```

실제 template도 DTO, `contracts.py`, `main.py`를 분리하고 handler를 app layer에 두라고 한다(`templates/python-interface-monorepo/README.md:63`, `templates/python-interface-monorepo/README.md:80`). 생성기는 `ContractRegistry` 내부를 직접 수정하지 않고 제안된 `register_generated_models(registry)` 함수 또는 deterministic 선언 블록을 출력한다.

**비교와 drift.** registry의 `to_spec()`은 정렬된 `ContractSpec`를 만들고 validation한다(`templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/registry.py:523`). `emit_openapi`는 endpoint request/response를 component ref로 만든다(`templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/openapi.py:304`). Phase 2·3의 diff는 (1) generated Pydantic `model_json_schema()` 대 `ContractSpec.schemas`, (2) operation path/method/id/parameter/body 대 `ContractEndpoint`, (3) emitted OpenAPI 대 runtime FastAPI `app.openapi()`를 비교한다. `contract_version_hash`를 snapshot key로 사용한다(`templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/openapi.py:271`). breaking diff와 stale artifact는 governance gate로 승격한다(`docs/concepts/contract-governance.md:59`).

**파이프라인 적합성.** C는 A/B와 결합하지만 처음에는 emitter가 아니라 adapter다. S6에 `contractSpec` 파일을 직접 쓰는 대신 `contracts.py`와 optional JSON snapshot을 별도 산출한다. 제안 옵션 `contractRegistryImport`는 `reads: ['registry']`를 읽는 `registryEmit` pass에만 전달한다. `ContractRegistry` package가 FastAPI를 import하지 않아야 한다는 경계(`templates/python-interface-monorepo/README.md:46`)를 유지한다.

**테스트.** Python template의 registry unit test, `ContractSpec.model_validate`, deterministic `to_spec`, `emit-openapi`, `oa-contract diff/review`, FastAPI runtime drift fixture를 연결한다. generated model 하나를 의도적으로 변경해 schema diff와 stale snapshot이 실패하는 contract-test invariant를 둔다.

**위험.** registry API는 template 경로에 있고 workspace package가 아닐 수 있으며, generated code가 source of truth인지 adapter인지 혼동될 수 있다. `ContractRegistry`를 생성 산출물의 source of truth로 선언하지 않고 TypeSpec/OAS를 계속 정본으로 둔다.

**공수.** L — Python package 경계, snapshot·diff·runtime drift gate를 함께 정해야 한다.

### D. Phase 1 품질 부채

| 부채 | Phase 2 처리안 | 파이프라인·테스트·공수 |
|---|---|---|
| `@encode` decoding | 우선 standalone fix. `encodingPolicy` 제안 옵션을 `scalarPolicy`가 읽고 `Annotated` validator/serializer 또는 `EncodedBytes` 계열 타입을 선택한다. wire 타입과 Python 의미 타입을 IR에 분리한다. `@encode` fixture에서 validate/dump round-trip과 `pydantic/encoding-degraded` 감소를 검증한다. M. |
| 모델 수준 `x-*` | standalone fix. `model_config = ConfigDict(json_schema_extra=...)`를 렌더하고 JSON 불가 값은 기존 진단을 유지한다. S4 `extensions` pass와 S5 model renderer만 바꾸며 model golden·`model_json_schema()`를 비교한다. S. |
| pyright `reportIncompatibleVariableOverride` | standalone fix. `__pydantic_extra__` 타입을 `ClassVar`/정식 Pydantic 패턴 중 하나로 고정하고 discriminator tag 상속을 피하는 alias를 검토한다. pyright lane을 추가하고 generated imports를 type-check한다. M. |
| ruff `I001`/`UP037` | standalone fix. import collector 정렬과 quoted annotation 규칙을 renderer에 반영한다. `ruff check --select E,F,I001,UP037` golden gate를 추가한다. S. |
| discriminator-less `oneOf` exactness | Phase 2 operation error union과 함께 정책 결정. 기본 smart union은 유지하되 `oneOfMode: smart|exact` 제안 옵션을 둔다. exact는 `model_validator`로 branch 성공 수를 세고, ambiguous fixture와 JSON Schema parity를 검증한다. L. |
| fixed settings `frozen` | P2a에서 `frozen` pass(`reads: ['frozen']`)가 model config를 결정하고 Python lane이 assignment를 검사한다. |
| fixed settings `layout` | A 직전에 처리. `layout: single|split`은 S6가 읽고 `models.py`/`operations.py` 파일 집합을 결정한다. import cycle·manifest golden이 필요하다. M. |
| fixed settings `docstrings` | P2a에서 `docstrings` pass가 모델 docstring을 켜고 끈다. |
| fixed settings `extensions` | P2a에서 `preserve|drop`을 `extensions` pass가 읽고 model-level `json_schema_extra`를 출력한다. |
| fixed settings `unionMode` | A의 status/error union과 함께 처리. Pydantic `ConfigDict(union_mode=...)`가 실제 지원되는 범위를 확인한 뒤 `smart|left-to-right`만 공개한다. M. |

`@encode`, model-level `x-*`, pyright, ruff는 operation과 독립적이므로 P2a의 선행 standalone fix로 분리할 수 있다. `oneOf`, `unionMode`, `layout`은 operation 모델 의미와 결합하므로 P2b 이후가 적절하다.

## 권장 단계 계획

### P2a — 품질 부채와 operation 입력 골격

구현 완료 (2026-11-08): `encodingPolicy`, 모델 `x-*` 보존/삭제, `docstrings`, `frozen`, ruff/pyright 품질 게이트를 추가했다. operations는 다음 milestone로 남긴다.

**범위와 의존성.** Phase 1 S0–S6 계약을 유지하면서 S1 prepared 문서에 `operations`를 추가하고, `PyOperationDecl`·parameter/body/response 사실 IR을 도입한다. `@encode`, model-level `x-*`, ruff import를 먼저 고친다. `analyzeSchemaGraph`와 `foldSchema`는 공유한다(`docs/internal/architecture/pydantic-codegen-pipeline.md:14`).

**파일 제안.** `packages/codegen/src/pydantic/operation-ir.ts`, `operation-lower.ts`, `passes/operation-naming.ts`, `passes/operation-serialization.ts`, `render-operations.ts`, `__tests__/fixtures/operations.ts`, `golden/operations/`를 추가하고 `prepare.ts`, `ir.ts`, `passes/index.ts`, `options.ts`, `render.ts`, `emit.ts`를 변경한다.

**옵션·진단 제안.** `layout`, `docstrings`, `extensions`, `encodingPolicy`, `parameterStyle`, `emitOperations`; 진단 `pydantic/operation-unsupported`, `pydantic/operation-name-collision`을 추가한다. 인코딩 손실은 새 코드를 만들지 않고 기존 `pydantic/encoding-degraded`를 재사용한다. 각 옵션은 하나의 pass 또는 S6가 `reads`에 선언한다.

**완료 조건.**

- schemas 전용 golden은 model extension, pyright ignore, import/line formatting 변경만 반영하고 의미 있는 기존 wire 출력은 유지한다.
- operation fixture에서 path/query/header/cookie와 request/response/error IR이 JSON round-trip된다.
- `PY_PASSES` trace에 새 pass와 `reads`가 나타나며 미해결 slot이 없다.
- `ruff E,F,I001,UP037`와 pyright의 새 lane이 통과한다.
- `@encode`와 model-level `x-*`의 Python validation 및 `model_json_schema()` 검사가 통과한다.

### P2b — `operations.py` 모델과 정확한 union 정책

**범위와 의존성.** P2a의 operation IR을 `operations.py`로 렌더한다. JSON 단일 media type, 명시 operationId, 표준 2xx/4xx를 먼저 지원하고 `oneOfMode`와 `unionMode`를 명시한다.

**파일 제안.** `passes/operation-bodies.ts`, `passes/operation-responses.ts`, `render-operations.ts`, `options.ts`, operation golden·Python lane을 변경한다.

**옵션·진단 제안.** `oneOfMode: smart|exact`, `unionMode: smart|left-to-right`, `parameterStyle`; `pydantic/oneof-ambiguous`, `pydantic/media-type-unsupported`를 추가한다.

**완료 조건.**

- 다른 generator가 사용하는 `<Op>PathParams` 등 이름과 import가 일치한다.
- response status/error union의 example validation과 alias dump가 통과한다.
- exact `oneOf`가 0개 또는 2개 branch 성공을 거부한다.
- 다중 media type·streaming은 명시 진단과 deterministic fallback을 낸다.

### P2c — FastAPI router stub

**범위와 의존성.** P2b의 operation model과 `layout`을 사용해 FastAPI-only stub을 만든다. `create_router(handlers)` 제안을 기본으로 하고 business logic은 생성하지 않는다.

**파일 제안.** `render-fastapi.ts`, `passes/router-signature.ts`, FastAPI fixture/golden을 추가하고 `plugin/plugins/pydantic.ts`, CLI `generate-pydantic.ts`의 target option을 변경한다.

**옵션·진단 제안.** `framework: none|fastapi`, `asyncHandlers: false|true`, `routerLayout: single|tagged`; `pydantic/fastapi-unsupported`, `pydantic/router-name-collision`을 추가한다.

**완료 조건.**

- 생성 router를 `FastAPI.include_router()`로 import할 수 있다.
- `app.openapi()`의 path/method/request/response schema가 원본과 정규화 후 같다.
- 모든 handler 본문이 `NotImplementedError` 또는 주입된 handler 호출이고 저장소 변경이 없다.
- sync/async fixture와 tag 분할 golden이 통과한다.

### P2d — `ContractRegistry` adapter와 drift

**범위와 의존성.** P2b 모델과 P2c operation metadata를 Python template adapter로 연결한다. registry 등록 코드와 deterministic `ContractSpec` snapshot을 산출하되 OAS/TypeSpec source of truth는 유지한다(`docs/concepts/contract-governance.md:19`).

**파일 제안.** `render-contract-registry.ts`, `contract-snapshot.ts`, template integration fixture, governance script fixture를 추가한다.

**옵션·진단 제안.** `registryImport`, `registryName`, `registryVersion`, `registryAudience`; `pydantic/registry-unavailable`, `pydantic/contract-drift`, `pydantic/contract-invalid`를 추가한다.

**완료 조건.**

- generated `ContractRegistry.to_spec()`가 schema/endpoint를 deterministic하게 만든다.
- `emit_openapi` 결과가 원본 OAS와 정규화 후 동등하다.
- model 변경·operation 변경·runtime FastAPI 변경 각각에 diff가 검출된다.
- stale snapshot과 breaking diff가 governance gate를 실패시킨다.

### P2e — 확장과 안정화

**범위.** multipart/text/streaming, `@discriminated` envelope, manifest provenance, duration/URI metadata, title·pattern 보존을 별도 milestone로 처리한다. P2a–d가 안정화된 뒤에만 범위를 넓힌다.

**완료 조건.** 각 추가 OAS construct에 fixture/golden, contract invariant, Python/FastAPI lane, 명시 diagnostic과 docs row가 있다. 옵션은 모두 읽는 pass가 있고 report에 기록된다.

### 공통 완료 게이트와 회귀 방지

새 operation 경로도 Phase 1의 순수 단계 계약을 유지해야 한다.

| 게이트 | 확인할 불변식 | 실패 시 진단/조치 |
|---|---|---|
| 입력 정규화 | 동일 operation이 path item 순서와 component 선언 순서에 영향을 받지 않는다. | `pydantic/operation-order` error 제안 |
| IR 직렬화 | `JSON.parse(JSON.stringify(ir))`가 원본 IR과 같다. | contract test 실패, 구현 중단 |
| pass 격리 | pass는 `reads`에 없는 옵션을 읽지 않고 입력 IR을 mutate하지 않는다. | `runPyPasses` deep-freeze 예외 |
| 이름 결정성 | 같은 `operationId`와 충돌 입력이 같은 suffix를 만든다. | `pydantic/operation-name-collision` |
| ref 폐쇄성 | operation inline schema와 component schema의 모든 `$ref`가 해소된다. | `pydantic/unresolved-ref` 재사용 |
| 출력 freshness | source hash와 generated file metadata가 같은 본문을 가리킨다. | stale artifact gate 실패 |
| Python import | `models.py`, `operations.py`, router가 순환 없이 import된다. | Python lane 실패 |
| OpenAPI parity | Pydantic `model_json_schema(by_alias=True)`와 emitted OAS의 schema가 정규화 후 일치한다. | parity report에 pointer 기록 |
| runtime drift | FastAPI `app.openapi()`와 managed contract의 path·method·schema 차이를 분류한다. | `oa-contract drift` 실패 |

P2a부터 각 fixture에는 다음 네 결과물을 함께 둔다.

1. source OAS 또는 TypeSpec fixture와 source pointer,
2. unresolved-slot IR golden,
3. resolved IR와 Python source golden,
4. 정규화 schema parity와 진단 JSON.

이 네 결과물을 분리하면 렌더 문자열만 바뀐 경우와 의미가 바뀐 경우를 구분할 수 있다. `emitIr`가 최종 IR을 파일로 내보내는 현재 계약(`packages/codegen/src/pydantic/emit.ts:74`)을 그대로 사용한다.

### 옵션·report 호환성 규칙

새 옵션은 다음 순서를 따른다.

| 순서 | 규칙 | 근거 |
|---:|---|---|
| 1 | `options.ts`의 partial 입력과 resolved 타입에 추가한다. | S0가 옵션을 한 번 해석한다(`docs/internal/architecture/pydantic-codegen-pipeline.md:11`). |
| 2 | 허용 값과 기본값을 명시하고 preset override 여부를 결정한다. | `resolvePydanticBuildOptions`가 허용 값을 검사한다(`packages/codegen/src/pydantic/options.ts:106`). |
| 3 | 적어도 하나의 pass/S6가 `reads`에 선언한다. | pass runner가 선언 키만 전달한다(`packages/codegen/src/pydantic/passes/index.ts:48`). |
| 4 | report의 `options` 또는 별도 output section에 기록한다. | report가 semantic options와 fixed settings를 함께 낸다(`packages/codegen/src/pydantic/emit.ts:50`). |
| 5 | option-isolation contract test와 golden을 추가한다. | 기존 contract test가 pass 관찰성과 옵션 영향을 검사한다(`docs/guides/pydantic-codegen.md:370`). |

`layout`처럼 파일 집합을 바꾸는 옵션은 semantic option과 output option을 섞지 않도록 별도 `PydanticOutputOptions`에 둘지 결정한다. 이 문서는 `layout`을 output option으로 두되, 그 값을 읽는 S6 pass를 명시하는 안을 권장한다.

### 후보별 범위 제외선

Phase 2에서 다음 입력은 진단 후 fallback으로 남긴다.

| 입력 | fallback | 이유 |
|---|---|---|
| 여러 JSON media type의 request body | 첫 `application/json` 또는 `Any` | client도 JSON body를 우선 선택하는 기존 helper를 가진다(`packages/client/src/request-contract.ts:4`). |
| `multipart/form-data` 파일 | `Any`와 warning | FastAPI `UploadFile` 의미를 공통 OAS schema만으로 결정하기 어렵다. |
| streaming response | body `Any`와 warning | `@oa-sdk/router`는 streaming envelope을 별도 타입으로 취급한다(`packages/router/src/contracts/handler-contract.ts:57`). |
| callback/webhook operation | 별도 diagnostic | 일반 request router와 lifecycle이 다르다. |
| operationId 누락 | deterministic method+path 이름과 warning | router generator는 operationId 누락을 별도 진단한다(`packages/surface-ir/src/index.ts:195`). |
| 외부 `$ref` | preflight error | Phase 1과 동일한 `components.schemas` 경계와 오류 정책을 유지한다. |

이 제외선은 구현 착수를 위한 초기 계약이며, P2e에서 각 항목을 승격할 때만 옵션과 fixture를 추가한다.

## 결정이 필요한 질문

1. operation 모델을 `models.py`에 합칠까, `operations.py`를 기본으로 할까? **권장: `operations.py`** — 현재 Phase 1 `layout: single`과 충돌을 피하고 operation 변경을 별도 diff로 보기 쉽다.
2. operation 이름을 `<Op>PathParams`로 고정할까, tag/경로 prefix를 넣을까? **권장: 기존 client 규칙 고정** — `packages/client/src/tanstack/generate-tanstack.ts:157`와의 import parity가 가장 작다.
3. request/response body 모델을 inline class로 만들까, component `$ref`만 허용할까? **권장: inline을 deterministic 이름으로 허용** — TypeSpec operation 시그니처가 `@body` parameter와 union return을 직접 선언한다(`packages/schemas/typespec/auth.tsp:285`, `packages/schemas/typespec/auth.tsp:286`, `packages/schemas/typespec/auth.tsp:287`).
4. FastAPI stub을 sync와 async 중 무엇으로 만들까? **권장: sync 기본, `asyncHandlers` opt-in** — 기존 reference app이 sync handler다(`apps/fastapi-ref/src/main.py:35`).
5. router stub이 business logic을 포함할까? **권장: 포함하지 않음** — `@oa-sdk/router`의 handler contract 분리와 같은 책임 경계를 유지한다(`packages/router/src/contracts/handler-contract.ts:2`).
6. `ContractRegistry` 등록을 Phase 2에 포함할까 Phase 3로 미룰까? **권장: P2d로 분리** — registry package·snapshot·drift gate 의존성이 operation 모델보다 크다.
7. `oneOf` 정확성 기본값을 `smart`로 유지할까 `exact`로 바꿀까? **권장: `smart` 유지 + `exact` opt-in** — 기존 출력 호환성을 보존하면서 ambiguous 입력을 선택적으로 강화한다.
8. `layout`을 `single|split`로 공개할까 파일 경로만 둘까? **권장: `layout` 공개** — P2a에서 `operations.py`와 manifest를 결정해야 한다.
9. TypeSpec plugin `purpose: api`에서만 operation을 생성할까 `data`/`interface`도 허용할까? **권장: `api`만** — 현재 `data`는 operation이 없어야 한다(`docs/guides/pydantic-codegen.md:99`).
10. `ContractRegistry`를 generated module이 직접 import할까 adapter module이 import할까? **권장: adapter module** — framework-neutral models/operations 파일을 유지하고 registry 의존성을 격리한다.

## 근거와 미확인

확인한 근거는 다음과 같다.

- Phase 1 단계·pass·고정 설정: `docs/internal/architecture/pydantic-codegen-pipeline.md:20`, `docs/internal/architecture/pydantic-codegen-pipeline.md:34`, `packages/codegen/src/pydantic/options.ts:73`.
- operation 분해 선례: `packages/client/src/request-contract.ts:18`, `packages/client/src/tanstack/generate-tanstack.ts:157`, `packages/surface-ir/src/index.ts:193`.
- FastAPI 구조: `apps/fastapi-ref/src/main.py:18`, `apps/fastapi-ref/src/main.py:39`, `apps/fastapi-ref/README.md:11`.
- registry 구조와 snapshot: `templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/registry.py:523`, `templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/spec.py:72`, `templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/openapi.py:271`.
- governance 의미: `docs/concepts/contract-governance.md:59`, `docs/concepts/contract-governance.md:68`, `docs/concepts/system-capabilities.md:54`.

다음은 **미확인**이다.

- `apps/fastapi-ref`에는 현재 `ContractRegistry` 사용 코드가 없고, registry 예시는 `templates/python-interface-monorepo`에만 있다. 실제 서비스 adapter import 경로와 배포 버전은 확인하지 못했다.
- Pydantic 2.11의 `ConfigDict(union_mode=...)` 지원 범위와 `@encode`별 최적 Python 타입/serializer 조합은 Python lane을 실행하지 않아 검증하지 못했다.
- FastAPI에서 generated status-discriminated response union을 `response_model`로 사용할 때의 OpenAPI 표현은 Python lane 없이 확인하지 못했다.
- `ContractRegistry.route`가 keyword-only `method`·`path`·`operation_id`를 받고 decorator로 handler를 감싸는 것은 확인했지만(`templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/registry.py:471`, `templates/python-interface-monorepo/packages/interface-contracts/src/oa_interface_contracts/registry.py:473`), generated adapter에서의 실제 import 경로와 runtime 연결은 미확인이다.

review §8에 이미 기록된 미구현은 manifest/provenance 결속, duration 진단, URI metadata, `@encode` 완전 해석, `title`, envelope union, 모델 수준 `x-*`, 왕복 parity, 원본 pattern 보존이다(`docs/reports/typespec-pydantic-codegen-review.md:163`, `docs/reports/typespec-pydantic-codegen-review.md:164`, `docs/reports/typespec-pydantic-codegen-review.md:165`, `docs/reports/typespec-pydantic-codegen-review.md:166`, `docs/reports/typespec-pydantic-codegen-review.md:167`, `docs/reports/typespec-pydantic-codegen-review.md:168`, `docs/reports/typespec-pydantic-codegen-review.md:169`, `docs/reports/typespec-pydantic-codegen-review.md:170`, `docs/reports/typespec-pydantic-codegen-review.md:171`).

문서와 코드의 불일치: 없음.
