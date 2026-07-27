# oa-sdk 시스템 온보딩

이 문서는 신규 작업자가 저장소의 목적, 정본, 변경 경로와 검증 게이트를 빠르게 파악하기
위한 안내서다. 세부 규칙은 [문서·스펙 거버넌스](../spec-governance/README.md)가 소유하며,
이 문서는 그 규칙을 반복하지 않는다.

## 1. 시작 전 확인

```bash
corepack enable
pnpm install
pnpm check:spec-governance
```

작업 시작 시 루트의 [`.ai/spec-loader.yaml`](../../.ai/spec-loader.yaml)을 읽는다. 이어서
[거버넌스 진입점](../spec-governance/README.md)과 [프로젝트 프로필](../spec-governance/project-profile.md)을
읽어 작업 범위·위험도·조건부 자료를 선택한다.

## 2. 무엇을 어디서 바꾸는가

| 바꾸려는 것 | 먼저 읽을 정본 | 일반 변경 위치 |
|---|---|---|
| 제품 범위/패키지 경계 | [`platform-scope.md`](../internal/platform-scope.md) | scope 문서와 결정 기록 |
| 구현된 기능 | [`spec.md`](../internal/spec.md) | package source/test, 완료 후 SSOT |
| API 타입·함수 export | [`api-index.md`](../internal/api-index.md) | owning package source |
| TypeSpec API 계약 | [authoring conventions](./typespec-authoring-conventions.md) | `packages/schemas/typespec/**/*.tsp` |
| 사용자 명령/운영 흐름 | 이 문서와 [CLI setup](./cli-setup.md) | 가이드 또는 운영 runbook |
| 아직 결정되지 않은 일 | [`plan.md`](../internal/plan.md) | `*.plan.md`, `goals/`, ADR |

TypeSpec 계약은 `.tsp`를 수정한다. `approved.openapi.yaml`, `.merged*.yaml`, `dist/`는
생성·검토 artifact이므로 직접 수정하지 않는다.

## 3. TypeSpec 선언은 어디까지 유효한가

TypeSpec은 “API 계약을 표현할 수 있다”는 이유만으로 정본이 되지 않는다. 이 저장소에서
유효한 TypeSpec 선언은 **복원된 OpenAPI가 승인 기준선과 일치하고, 실제 consumer가 그
artifact를 처리할 수 있음이 게이트로 증명된 선언**이다.

다음 순서로 새 계약 사실의 소유자를 판단한다.

1. TypeSpec native 문법으로 안정적으로 emit되는가? 모델, 제약, HTTP method/path,
   parameter, request/response shape, 기본 bearer requirement는 `.tsp`가 소유한다.
2. OpenAPI에는 필요하지만 emitter가 보존하지 못하는가? 이미 버전된 OA SDK extension이
   있는지 [authoring ownership guide](../internal/typespec-roundtrip/authoring-ownership-guide.md)를
   확인한다. 예시는 reusable parameter/response identity, media example, explicit public
   security override, OAuth metadata다.
3. generated bundle 또는 아직 표준화되지 않은 OpenAPI 고유 사실인가? compatibility sidecar를
   사용하거나, 새 extension schema와 focused restore test를 먼저 설계한다.
4. mock 우선순위, persona, adapter 동작, role-specific runtime 정책처럼 OpenAPI 자체의
   계약 target이 아닌가? `.tsp`에 주석이나 generic extension으로 숨기지 말고 owning runtime
   package 또는 별도 정책 설계가 소유한다.

| 판단 | TypeSpec-first 경로가 유효한 조건 | 추가 설계가 필요한 신호 |
|---|---|---|
| 모델·HTTP 계약 | native emit 결과가 snapshot/validation gate를 통과 | emitter 결과가 schema/required/ref 의미를 바꿈 |
| 재사용 component·예시·보안 metadata | 기존 extension version이 해당 복원 target을 명시 | 새 `x-oa-sdk-*` payload나 version 없는 arbitrary JSON이 필요 |
| 환경 차이 | server URL만 projection으로 변경 | environment마다 path, schema, security, response가 달라짐 |
| 인증·가시성 | native bearer requirement와 문서화된 public override | unsupported auth requirement, role/read-write visibility policy가 필요 |
| 콜백·링크·webhook | focused fixture에서 native projection이 검증됨 | projection/consumer 의미가 아직 증명되지 않음 |
| runtime 정책 | OpenAPI 예시까지의 contract 사실 | mock/persona/retry/adapter 우선순위 또는 실행 정책 |

"컴파일된다"는 첫 단계일 뿐이다. 아래 다섯 증거가 모두 있을 때 production TypeSpec
authoring boundary 안에 있다고 본다.

1. **표현성** — native 또는 명시적으로 versioned extension/sidecar가 target 사실을 소유한다.
2. **보존성** — restored OpenAPI와 approved snapshot의 normalized diff가 의도적이다.
3. **호환성** — base/head breaking diff와 `ContractVersion`의 SemVer 정책이 맞는다.
4. **소비 가능성** — parser, typegen, router, client, mock-server가 restored artifact를 처리한다.
5. **참조 무결성** — emit·restore 뒤의 모든 OpenAPI `$ref`가 해소되고, 누락·순환·지원하지
   않는 참조가 diagnostic으로 드러난다.

하나라도 만족하지 않으면 TypeSpec 선언을 억지로 확장하지 않는다. ownership guide에
추가하거나, sidecar/runtime policy/별도 ADR 중 어느 경계가 사실을 소유할지 먼저 결정한다.

### 참조 추적의 세 층

`$ref` 추적은 한 종류의 그래프가 아니다. 온보딩과 리뷰에서는 아래 세 층을 구분한다.

| 층 | 현재 관리하는 사실 | 현재 보장하지 않는 사실 |
|---|---|---|
| TypeSpec 선언 그래프 | compiler가 import와 symbol/type 관계를 해석하고, Spec Lens가 entry에서 도달 가능한 `.tsp` 파일을 수집한다 | 특정 declaration/span이 어느 OpenAPI JSON Pointer를 만들었는지 |
| OpenAPI `$ref` 그래프 | emitted/restored 문서의 internal·external `$ref`, 누락 pointer/file, 순환을 `resolveRefGraph`로 수집·진단한다 | `$ref`의 source가 된 정확한 TypeSpec 선언 위치 |
| declaration-to-output provenance | production gate는 TypeSpec AST declaration/extension과 restored OpenAPI pointer·`$ref` source를 연결한 local artifact를 생성·검증한다 | emitter가 직접 제공하는 compiler-native source map 또는 모든 nested synthetic property의 소유권 |

따라서 production gate는 **artifact 수준의 참조 무결성**과, public
operation/component 및 `$ref` source의 **TypeSpec AST declaration 소유권**을 함께
증명한다. `pnpm schema:typespec-provenance-check`는 source hash와 restored OpenAPI hash에
결속된 local artifact를 만들고, owner가 없거나 `$ref`가 해소되지 않으면 실패한다. 다만
TypeSpec OpenAPI emitter의 public output source-map API는 아직 없으므로 artifact의
`provenanceKind`는 명시적으로 `typespec-source-ast`다. 유효하고 hash-bound된 artifact를
만든 Spec Lens historical snapshot은 이 AST provenance와 pointer diff/graph를 보존한다.
artifact가 없던 이전 revision은 `typespec-source-files` file-level fallback으로 남으며,
emitter-native provenance로 과장하지 않는다.

emitter-native traceability가 필요한 계약이라면 다음 artifact를 별도로 설계해야 한다.

```text
TypeSpec file + symbol/span
  --emits/restores--> OpenAPI JSON Pointer
  --references-----> OpenAPI $ref target
```

이 artifact에는 native emitter edge뿐 아니라 extension restore edge도 포함하고, 최종
OpenAPI `$ref` graph와 대조해 dangling reference와 provenance 없는 public component를
검출해야 한다. 그 전까지 PR 리뷰의 신뢰 단위는 `.tsp` 변경, restored OpenAPI diff,
AST provenance gate, `resolveRefGraph` diagnostic, downstream 검증의 조합이다.

### 현재 검증된 production 경계

현재 production source가 유효하다고 주장할 수 있는 범위는
`packages/schemas/typespec/oa-sdk.typespec-bundle.json`이 선언한 OpenAPI 3.2 / OA SDK
extension v5 bundle과 그 도메인 모듈이다. 이 범위에서는 `schema:typespec-check`가
approved snapshot과 restored artifact의 drift를, `schema:downstream-check`가 parser,
codegen, router, client, mock-server를 검증한다. 이는 “모든 TypeSpec 또는 모든 OpenAPI
기능을 지원한다”는 뜻이 아니다. 지원하지 않거나 아직 fixture로 증명되지 않은 OpenAPI
사실은 위 표의 추가 설계 경로로 취급한다.

## 4. TypeSpec 계약 변경의 기본 경로

```bash
pnpm schema:approve-typespec-reference
# candidate diff를 검토한 뒤
pnpm schema:approve-typespec-reference -- --write
pnpm schema:typespec-check
pnpm schema:typespec-provenance-check
pnpm schema:validate
```

parser, codegen, router, client, mock 동작에 영향이 있으면 추가로 다음을 실행한다.

```bash
pnpm schema:downstream-check
```

PR에서는 base branch와의 계약 비교도 확인한다.

```bash
git fetch origin --prune
pnpm spec:diff -- --git origin/main
pnpm schema:check-contract-version -- --base-ref origin/main
```

breaking 변경은 `ContractVersion`이 SemVer 규칙에 맞게 상승해야 한다. 1.0 전에는 minor,
1.0 이후에는 major bump가 필요하다. 이 두 명령은 “새 OpenAPI가 만들어졌는가”가 아니라
“기존 consumer와의 계약이 어떤 방식으로 달라졌는가”를 확인하는 용도다.

`--manifest`를 사용할 때 snapshot은 선택한 manifest가 선언한 파일에만 귀속된다. 후보
파일은 `.oa-sdk/typespec-candidates/`에 남는 작업 중 artifact이고, committed snapshot은
검토 기준이다. accepted drift를 함께 폐기하는 경우에는 도구가 요구하는 명시적 옵션과
변경 기록을 사용한다.

## 5. 문서와 코드 변경을 함께 완료하기

변경 유형에 따라 다음을 갱신한다.

- 기능 추가/삭제: `docs/internal/spec.md`, 관련 API index와 feature-test matrix
- 계약 변경: owning `.tsp`, approved snapshot, 버전 변경 여부와 diff 요약
- 계획 완료: 계획 문서의 상태를 갱신하고 검증된 내용을 `spec.md`로 승격
- 공식 기준 변경: `docs/spec-governance/decision-log.md`에 내용·이유·영향·저장 위치 기록
- 사용자 흐름 변경: 관련 가이드의 명령과 링크 확인

## 6. 최소 완료 확인

```bash
pnpm check:spec-governance
pnpm check:docs
git diff --check
```

계약 변경이면 [문서 유형과 품질 기준](../spec-governance/document-policy.md)의 계약
게이트를, release/version 변경이면 release policy 게이트를 추가한다. 검증을 생략할 때는
이유와 대체 증거를 변경 기록에 남긴다.

## 다음 읽을 자료

- [Quick Start](./quick-start.md) — 전체 파이프라인을 직접 실행
- [기본 스펙 사용 기준](./basic-spec-usage.md) — source와 artifact 소유권
- [TypeSpec Authoring Conventions](./typespec-authoring-conventions.md) — 계약 세부 규칙
- [Authoring ownership guide](../internal/typespec-roundtrip/authoring-ownership-guide.md) — native, extension, sidecar, runtime policy의 정확한 경계
- [Production operations](../internal/typespec-roundtrip/production-operations.md) — snapshot/drift 복구
- [Change control](../spec-governance/change-control.md) — 예외와 충돌 처리
