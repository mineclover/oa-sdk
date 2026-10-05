---
docType: guide
sourceLocale: ko
canonical: true
audience:
  competence: competent
productVersions:
  - "@oa-sdk/codegen 0.9.0"
  - "OA SDK API contract 0.5.0"
owner: "OA SDK maintainers"
status: active
lastReviewed: "2026-10-06"
sourceOfTruth:
  - package.json
  - packages/schemas/package.json
  - packages/schemas/typespec/oa-sdk.typespec-bundle.json
---

# 기본 스펙 사용 기준 (저장소 계약의 원본과 생성물)

> 이 문서는 oa-sdk 저장소 기여자용입니다. 다른 프로젝트는 [Quick Start](./quick-start.md)를 따릅니다.

이 저장소의 production API 계약(`packages/schemas`)에서 사람이 고치는 원본과 도구가 만드는 생성물을
나누고, 계약을 바꿀 때의 작업 순서와 검증 명령을 정합니다. 이 저장소의 스키마 가이드는 계약 변경
순서를 다시 쓰지 않고 3절을 링크합니다.

- oa-sdk가 해결하는 문제와 가치: [가이드 색인](./README.md#oa-sdk가-해결하는-문제와-핵심-가치)
- 패키지 안의 파일 배치와 스크립트: [`@oa-sdk/schemas` README](../../packages/schemas/README.md)
- TypeSpec·OpenAPI 작성 규칙: [스키마 작성 가이드](./schema-authoring.md)
- 모듈 소유권, `ContractVersion` 규칙, 리뷰 증거: [TypeSpec Authoring Conventions](./typespec-authoring-conventions.md)
- 원본에서 생성물까지 `oa-gen`이 하는 일: [스키마 파이프라인](./schema-architecture-and-conventions.md)

## 1. 원본과 생성물

| 구분 | 위치 | 직접 수정 |
|---|---|---|
| 원본 | `packages/schemas/typespec/main.tsp`(import만 하는 진입점), `metadata/`, `version.tsp`, `{common,auth,health,me,users,world-model}.tsp` | 수정 |
| 번들 manifest | `packages/schemas/typespec/oa-sdk.typespec-bundle.json` | 의미가 바뀔 때만 |
| 승인 snapshot | `packages/schemas/typespec/approved.openapi.yaml` | 금지. 검토 후 승인 명령으로만 갱신 |
| 정본 생성물 | `packages/schemas/src/.merged.yaml`(OpenAPI 3.2, git 무시) | 금지 |
| 3.1 호환 생성물 | `packages/schemas/src/.merged.3.1.yaml`, `.merged.3.1.meta.json`(git 추적, CI가 최신 여부 확인) | 금지 |
| 패키지 번들 | `packages/schemas/dist/openapi.{yaml,json}`(3.1 호환, git 무시) | 금지 |
| 배포 환경 projection | `packages/schemas/typespec/oa-sdk.typespec-projections.json` | server URL만 |
| rollback·참조 원본 | `packages/schemas/src/fragments`, `src/targets` | rollback 경로를 고칠 때만 |
| 외부 서비스 계약 | 서비스별 `raw → normalized → upgraded` 문서 | 서비스 원본에서 생성 |
| projection 교환 형식 | `@oa-sdk/openapi-projection-contract` envelope | 원본이 아니라 교환 경계 |

규칙은 다음과 같습니다.

- `.tsp`와 manifest를 먼저 고칩니다. `.merged*`, `dist/openapi*`, sidecar 리포트는 직접 고치지 않습니다.
- `approved.openapi.yaml`은 사람이 쓰지 않습니다. TypeSpec에서 만든 후보를 검토한 뒤 `pnpm schema:approve-typespec-reference -- --write`로만 갱신합니다.
- 배포 환경의 server URL은 복원한 계약에서 server 값만 바꾼 projection으로 다룹니다. projection 결과는 승인 snapshot도, 새 원본도 아닙니다.
- 저장소 안의 parser, codegen, mock 서버, downstream gate는 `.merged.yaml`을 입력으로 씁니다. Swagger UI 같은 3.1 전용 도구에는 `.merged.3.1.yaml`이나 `dist/openapi.*`를 넘깁니다.
- `src/fragments`, `src/targets`와 `build-spec`은 Definition Builder rollback·참조 경로입니다. 새 API는 TypeSpec에 씁니다.
- NestJS·FastAPI처럼 외부 런타임이 내보낸 문서는 TypeSpec 원본과 섞지 않고 [OpenAPI Governance Service Template](./openapi-governance-service-template.md)의 수집 경로로 다룹니다.

새로 clone한 저장소에는 `.merged.yaml`이 없습니다(git 무시). `corepack pnpm build:core`나 `pnpm schema:validate`를
한 번 실행해야 이 파일을 읽는 명령이 동작합니다.

## 2. 사용처별 명령

저장소 루트에서는 `oa-gen`이 PATH에 없습니다. `pnpm --filter @oa-sdk/codegen build` 후
`node packages/codegen/dist/cli/index.js <명령>`으로 실행합니다. `mock`처럼 동반 패키지가 필요한 명령은
`corepack pnpm build:downstream`으로 해당 패키지도 빌드해 둡니다.

| 사용처 | 입력 | 출력·검증 | 명령 |
|---|---|---|---|
| 계약 작성·검증 | TypeSpec 모듈 | 번들 검사, 승인 snapshot diff, OpenAPI 3.2 검증, Spectral, Redocly | `pnpm schema:validate` |
| 승인 snapshot 갱신 | TypeSpec에서 복원한 OpenAPI | 검토한 normalized diff | `pnpm schema:approve-typespec-reference -- --write` |
| breaking change 분류 | 커밋된 TypeSpec과 작업 트리 | 의미 단위 diff | `node packages/codegen/dist/cli/index.js tsp diff --base HEAD:packages/schemas/typespec/main.tsp --head packages/schemas/typespec/main.tsp --fail-on-breaking` |
| 생성 코드 확인 | `.merged.yaml` | typegen, 핸들러 계약, 클라이언트, mock 핸들러 생성과 컴파일 | `pnpm schema:downstream-check` |
| 타입만 생성 | `.merged.yaml` | TypeScript 타입 | `node packages/codegen/dist/cli/index.js typegen --spec packages/schemas/src/.merged.yaml -o <파일>` |
| mock 서버 | `.merged.yaml` | 요청 검증 mock 서버 | `node packages/codegen/dist/cli/index.js mock --spec packages/schemas/src/.merged.yaml --watch` |
| rollback 경로 검증 | fragments + target | target OpenAPI 3.2 | `pnpm schema:rollback-check` |
| Swagger·3.1 호환 | TypeSpec 번들 | `dist/openapi.{yaml,json}` | `pnpm schema:bundle` |
| 배포 환경 projection | 복원한 계약 + profile | `src/.projected/` | `pnpm schema:project-typespec:local`, `:staging`, `:production` |
| 변경 이력 관측 | TypeSpec 번들 | snapshot, diff, provenance | `pnpm --dir packages/spec-lens exec tsx src/cli.ts` ([spec-lens README](../../packages/spec-lens/README.md)) |

`tsp diff`에 git ref만 주면(`--head HEAD`) 커밋된 내용끼리 비교하므로 작업 트리의 수정은 보이지 않습니다.
위처럼 head에는 파일 경로를 줍니다. 명령별 옵션은 [CLI 명령 레퍼런스](./cli-command-reference.md)에 있습니다.

### 저장소 패키지가 쓰는 생성물

| 패키지 | 공개 상태 | 읽는 생성물 | 하는 일 |
|---|---|---|---|
| `@oa-sdk/parser` | 공개 | `.merged.yaml` | 파싱, `$ref` 해석, 린트, 검증(`validateDocument`) |
| `@oa-sdk/codegen` (`oa-gen`) | 공개 | `.merged.yaml` 또는 `oa.config.ts` | `typegen`, `generate:zod`, `generate:guards`, `generate`, `validate`, `diff`, `check-artifact` 등 |
| `@oa-sdk/router` | 동반 패키지 | parser 결과 | `oa-gen generate`가 부르는 `generateHandlerContract()`로 핸들러 계약(`<id>.contract.ts`) 생성. 프레임워크 라우터 코드는 `generateRouter()` API를 직접 호출해야 하며, `oa-gen` 명령은 라우터 파일을 만들지 않는다 |
| `@oa-sdk/client` | 동반 패키지 | parser 결과 | `generateClient()`(fetch 클라이언트), `generateTanstackQuery()`(TanStack Query 키·옵션·훅) |
| `@oa-sdk/mock-server` | 동반 패키지 | `.merged.yaml` 또는 `.tsp` | `oa-gen mock`, `createNodeMockServer()`. `msw`는 MSW 어댑터를 쓸 때만 필요 |
| `@oa-sdk/spec-lens` | 비공개(저장소 전용) | TypeSpec 번들 또는 `.merged.yaml` | revision별 snapshot, diff, provenance, 심볼 색인 |
| 외부 도구, Swagger UI | - | `dist/openapi.*`, `.merged.3.1.yaml` | OpenAPI 3.1만 읽는 도구용 |

`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`는 `oa-gen`이 실행 중 불러오는
동반 패키지(companion package)입니다. 어떤 명령에 무엇이 필요한지는 [CLI 설치 가이드](./cli-setup.md#동반-패키지-companion-packages)에 있습니다.
`@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, `@oa-sdk/surface-ir`는 `@oa-sdk/codegen` 0.9.0
릴리스에서 처음 npm에 배포됩니다. 이 릴리스 전에는 npm에서 설치할 수 없습니다. 설치할 수 있는 버전은
[변경 이력](../changelog.md)에서 확인합니다.

## 3. 계약 변경 작업 순서

```text
TypeSpec 모듈 수정
  → 승인 후보 diff 검토 → approved.openapi.yaml 갱신(--write)
  → pnpm schema:validate (.merged.yaml 생성, 3.2 검증)
  → pnpm schema:downstream-check (생성 코드에 영향이 있을 때)
  → pnpm schema:typespec-check (커밋 전)
```

1. 변경 대상에 맞는 모듈을 고칩니다: 도메인은 `packages/schemas/typespec/{common,auth,health,me,users,world-model}.tsp`, service·security·재사용 component는 `metadata/{service,security,common-components}.tsp`. 새 모듈을 만들면 `main.tsp`에 import를 추가합니다.
2. OpenAPI의 의미를 TypeSpec 문법으로 표현할 수 없으면 [authoring ownership guide](../internal/typespec-roundtrip/authoring-ownership-guide.md)에 따라 TypeSpec 문법, OA SDK extension, compatibility sidecar 중 하나를 고릅니다.
3. `pnpm schema:approve-typespec-reference`를 실행해 `.oa-sdk/typespec-candidates/`에 생긴 후보와 normalized diff를 검토합니다. 검토가 끝났을 때만 `pnpm schema:approve-typespec-reference -- --write`로 `approved.openapi.yaml`을 갱신합니다. enum 값 추가·삭제처럼 선언이 짧은 변경도 같은 절차를 거칩니다.
4. `pnpm schema:validate`를 실행합니다.
5. parser, codegen, router, client, mock 서버에 영향이 있으면 `pnpm schema:downstream-check`를 실행합니다.
6. 커밋 전에 `pnpm schema:typespec-check`로 승인 snapshot과 원본이 일치하는지 확인합니다.

API `ContractVersion`, 워크스페이스 패키지 버전, 번들·extension `schemaVersion`은 서로 다른 버전입니다.
언제 무엇을 올리는지는 [TypeSpec Authoring Conventions](./typespec-authoring-conventions.md#versioning)를 따릅니다.
PR CI는 `pnpm schema:check-contract-version -- --base-ref <ref>`로 breaking diff에 맞는 버전 증가가 있는지 확인합니다.
PR에 남길 리뷰 증거는 [Required Review Evidence](./typespec-authoring-conventions.md#required-review-evidence)에,
문서·스펙 변경의 완료 조건은 [문서 유형과 품질 기준](../spec-governance/document-policy.md)에 있습니다.

## 4. 오류 응답과 업무 판정

권한 거부처럼 HTTP 오류이면서 호출자가 읽어야 할 업무 결과가 있으면 상태 코드를 200으로 바꾸지 않고
오류 응답 body를 계약에 선언합니다. 예를 들어 `403` 응답 body가 `AuthorizationDecision`이면 TypeSpec에
그 body를 명시합니다. typegen은 4xx·5xx·default의 JSON body와 status map을 만들고, 생성 클라이언트는
operation별 `is<Operation>ClientError(error, status)` guard를 제공하므로 호출자는 `status`와 `body`를 함께
좁힐 수 있습니다. 같은 status에 업무 오류 body가 여러 개면 body의 discriminant도 확인합니다.

다음 예시는 production API가 아니라 [OpenFGA resource-registry fixture](../internal/typespec-roundtrip/fixtures/openfga-resource-registry-consumer/README.md)의
synthetic 계약을 기준으로 합니다. fixture의 `checkAuthorization` 403에는 거부 판정과 정책 오류가 함께 올 수 있습니다.

```ts
import { isCheckAuthorizationClientError } from './generated/client'

try {
  await client.checkAuthorization(request)
} catch (error) {
  if (isCheckAuthorizationClientError(error, 403)) {
    if ('allowed' in error.body) {
      // AuthorizationDeniedDecision: 권한 판정 결과를 업무 흐름에서 처리
      console.log(error.body.reasonCode, error.body.trace)
    } else if ('error' in error.body) {
      // actor mismatch, tenant scope 등 접근 정책 오류
      console.log(error.body.error, error.body.message)
    }
    return
  }
  throw error
}
```

`ClientError`는 `status`, 파싱한 `body`, 원본 `response`를 보존합니다. 네트워크 오류나 계약에 없는 오류는
operation별 guard를 통과하지 않으므로 공통 오류 처리기로 넘깁니다.

생성 클라이언트의 `config.validate: true`는 required 필드와 JSON Schema 기본 제약을 fetch 전에 검사합니다.
재시도는 GET·HEAD·OPTIONS·DELETE에만 기본으로 적용되고, POST·PUT·PATCH는 operation에
`x-oa-sdk-retryable: true`를 선언한 경우에만 재시도합니다. 관계 쓰기처럼 중복 실행이 위험한 operation에는 선언하지 않습니다.

## 5. 현재 경계와 남은 제한

1. **metadata와 도메인의 책임을 나눕니다.** `main.tsp`는 import만, `metadata/`는 문서 수준 service·security·component만, 도메인 모듈은 model·response·operation만 소유합니다.
2. **배포 환경 projection은 server 값만 바꿉니다.** path, schema, security, response를 환경별로 바꾸려면 별도 계약·검증 설계가 필요합니다.
3. **typed helper는 `@oa-sdk/typespec-decorators`가 제공하는 것만 씁니다.** 이 패키지는 decorator 5개(`@oaUseResponseComponent`, `@personaCapability`, `@pseudonymize`, `@crdt`, `@crdtEntity`)와 표준 계약(`Ok`, `Created`, `NoContent`, `PageResult`, `ErrorResponse`, `StandardError`, `StandardHttpErrors`)을 제공합니다([패키지 README](../../packages/typespec-decorators/README.md)). 임의 JSON을 받는 일반 extension helper는 만들지 않으며, 새 extension family는 ownership guide와 restore 테스트를 갖춘 뒤에 추가합니다. production 모듈의 `@oaUseResponseComponent`와 `x-oa-sdk-operation-*` extension은 번들 restore(`pnpm schema:typespec-check`) 경로에서만 실제 응답·예제로 바뀝니다.
4. **spec-lens 외부 입력은 `observation`으로 분류합니다.** 기본값은 루트 패키지와 lockfile을 `evidence`, 신뢰하는 decorator 패키지를 `candidates`로 둡니다. evidence는 revision별 hash와 존재 여부를 snapshot provenance에 기록하고, candidates는 재검증 후보만 만듭니다. 어느 쪽도 과거 workspace에서 외부 설정을 실행하거나 외부 파일 내용을 compiler 입력으로 넣지 않습니다. evidence는 파일만 허용하며 최대 4개, 파일당 2 MiB입니다. `observationInputs`는 고급 typed 설정이고, 기존 `watchPaths`는 `candidate-only` 호환 별칭입니다.
5. **OAuth metadata는 아직 operation 인증 계약이 아닙니다.** 현재 production operation은 `bearerAuth`만 씁니다. issuer, scope, role 정책이 승인되기 전에는 placeholder OAuth component를 실제 호출 요구사항으로 해석하거나 새 operation에 연결하지 않습니다.

새 사용처는 2절 표에 먼저 추가하고, 입력 생성물과 성공 gate가 정해진 뒤에 패키지나 adapter를 확장합니다.
문서·스펙 기준의 소유권과 변경 기록은 [문서·스펙 거버넌스](../spec-governance/README.md)와
[`decision-log.md`](../spec-governance/decision-log.md)에 둡니다.
