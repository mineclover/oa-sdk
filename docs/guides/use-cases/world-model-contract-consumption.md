---
docType: how-to
sourceLocale: ko
canonical: true
audience:
  competence: competent
goal: "World Model 계약을 검증하고 생성 코드 또는 HTTP 연동 작업으로 넘긴다."
appliesWhen:
  - "TypeSpec production contract를 소비하는 client 또는 runtime integration을 준비할 때"
  - "World Model operation과 revision-pinned projection contract를 검토할 때"
productVersions:
  - "OA SDK API contract 0.5.0"
  - "@oa-sdk/codegen 0.9.0"
  - "@oa-sdk/client 0.2.2"
riskLevel: low
owner: "packages/schemas/typespec/"
reviewDue: "2026-11-10"
status: active
lastReviewed: "2026-10-06"
sourceOfTruth:
  - packages/schemas/typespec/world-model.tsp
  - packages/schemas/typespec/metadata/service.tsp
  - packages/schemas/typespec/version.tsp
  - packages/schemas/typespec/approved.openapi.yaml
---

# World Model 계약을 검증하고 소비 준비하기

> 이 문서는 oa-sdk 저장소 기여자용입니다. 다른 프로젝트는 [Quick Start](../quick-start.md)를 따릅니다.

World Model 연동을 시작할 때는 `packages/schemas/src/.merged.yaml`을 직접 수정하지 않고,
TypeSpec source에서 생성한 OpenAPI 3.2 artifact를 검증한 뒤 client 또는 HTTP integration의
입력으로 넘긴다. 이 가이드를 마치면 다음 두 가지를 확인할 수 있다.

- canonical artifact가 OpenAPI 3.2 strict gate를 통과한다.
- `listExecutionProfiles`, `createWorld`, `getWorldHead`, `submitWorldAction`,
  `submitWorldTimeAdvance`, `getWorldProjection`, `getWorldProjectionBundle` operation을
  소비할 입력과 검토 기준이 준비된다.

이 저장소에는 World Model contract source가 있지만, 이 문서만으로 실제 runtime endpoint가
배포되어 있다고 가정하지 않는다. endpoint의 호스트, bearer token 발급, provider 실행,
storage, transaction 완료 시점은 연동 대상 runtime의 정본에서 확인해야 한다.

## 시작 전 조건

- 이 저장소를 빌드·테스트하려면 Node.js 24 이상과 pnpm 10.30.3(루트 `packageManager`)이 필요하다.
- 저장소 의존성을 설치하고 `pnpm build:core`를 한 번 실행한 상태여야 한다. 이는 TypeSpec
  validation과 CLI가 요구하는 workspace dependency closure를 materialize한다.
- contract를 변경하는 경우에는 [TypeSpec Authoring Conventions](../typespec-authoring-conventions.md)의 승인 흐름을 따라야 한다.
- runtime 연동을 하는 경우 bearer 인증과 operation별 오류 응답을 제공하는 서버가 별도로 준비되어 있어야 한다.

consumer가 이미 생성된 artifact만 받는다면 source를 수정하지 않고 해당 artifact 경로를
`--spec`에 전달한다. 이 경우에도 artifact의 출처와 contract version을 기록한다.

## 1. canonical artifact를 생성하고 검증한다

Production TypeSpec source를 기준으로 검증하려면 저장소 루트에서 실행한다.

```bash
pnpm schema:validate
```

이 명령은 TypeSpec source를 `packages/schemas/src/.merged.yaml`로 materialize하고,
OpenAPI 3.2 strict validation과 3.1 compatibility 검사를 수행한다. `schema:validate`가
실패하면 생성된 client나 runtime integration을 기준선으로 삼지 않는다.

계약을 소비하는 별도 artifact라면 다음처럼 같은 strict gate를 직접 실행한다.

```bash
pnpm --filter @oa-sdk/codegen build
node packages/codegen/dist/cli/index.js validate \
  --spec ./path/to/openapi.yaml \
  --require-32
```

검증 대상이 production contract인지 외부 runtime 산출물인지 경로와 함께 기록한다. 외부
runtime 산출물의 수집·정규화가 필요하면 [OpenAPI Governance Workflow](./openapi-governance-workflow.md)를
사용한다.

## 2. World Model surface를 확인한다

canonical artifact에서 operation과 tag가 예상대로 생성됐는지 inventory로 확인한다.

```bash
node packages/codegen/dist/cli/index.js inventory \
  --spec packages/schemas/src/.merged.yaml \
  --format markdown
```

`world-model` tag에서 다음 operation이 모두 보여야 한다.

| operationId | method | path | revision query |
|---|---|---|---|
| `listExecutionProfiles` | `GET` | `/world-model/execution-profiles` | — |
| `createWorld` | `POST` | `/worlds` | — |
| `getWorldHead` | `GET` | `/worlds/{worldId}` | — |
| `submitWorldAction` | `POST` | `/worlds/{worldId}/actions` | — |
| `submitWorldTimeAdvance` | `POST` | `/worlds/{worldId}/time-advances` | — |
| `getWorldProjection` | `GET` | `/worlds/{worldId}/projections/{projectionId}` | `revision?` |
| `getWorldProjectionBundle` | `GET` | `/worlds/{worldId}/projection-bundles/{bundleId}` | `revision?` |

일부 operation이 빠졌다면 `packages/schemas/typespec/main.tsp`가
`world-model.tsp`를 import하는지와 generated artifact가 최신인지 확인한다. generated
artifact를 직접 편집해 누락을 보정하지 않는다.

## 3. 필요한 consumer code를 생성한다

TypeScript 선언은 `typegen`, fetch client는 `generate:client`로 생성한다. `generate:client`는 동반
패키지(companion package) `@oa-sdk/client`에서 생성기를 불러오며, 저장소에서는 이 패키지를 먼저
빌드한다(`pnpm build:downstream` 또는 `pnpm --filter @oa-sdk/client build`). `@oa-sdk/client`는
`@oa-sdk/codegen` 0.9.0 릴리스에서 처음 npm에 배포되는 공개 패키지다.

```bash
pnpm --filter @oa-sdk/codegen build
pnpm --filter @oa-sdk/client build

mkdir -p .oa-sdk/world-model
node packages/codegen/dist/cli/index.js typegen \
  --spec packages/schemas/src/.merged.yaml \
  --output .oa-sdk/world-model/types.ts
node packages/codegen/dist/cli/index.js generate:client \
  --spec packages/schemas/src/.merged.yaml \
  --types-import ./types.js \
  -o .oa-sdk/world-model/client.ts
```

생성된 client는 `--types-import`로 지정한 `./types.js` 외에는 아무것도 import하지 않는다. 설정과
호출 규칙은 [생성 클라이언트와 TanStack Query 사용 가이드](../client-and-query-consumption.md)를 따른다.
script에서 생성해야 하면 같은 생성기를 `@oa-sdk/client`의 `generateClient(spec, { typesImport: './types.js' })`로
직접 호출할 수 있다.

생성된 파일은 작업 산출물 디렉터리에 두고 source artifact로 커밋하지 않는다. 프로젝트가
생성물을 커밋하는 정책을 사용한다면 그 정책의 output 경로와 freshness gate를 먼저
확인한다. `generate:client`가 `@oa-sdk/client`를 찾지 못해 설치 명령을 출력하고 실패하면
package build와 workspace 의존성 설치 상태를 확인한다.

## 4. runtime 요청 경계를 연결한다

실제 서버를 연결할 때는 다음 순서로 operation을 매핑한다. 이 순서는 HTTP 요청을 보내는
명령이 아니라, contract의 목적을 runtime adapter에 연결하는 작업 순서다.

1. `GET /world-model/execution-profiles`에서 선택 가능한 `ExecutionProfileSummary`를 읽고,
   사용할 `ExecutionProfileRef`의 `profileId`, `version`, `semanticFingerprint`를 기록한다.
2. `POST /worlds`에 `worldId`, `ModelRef`, `ExecutionProfileRef`, `bootstrapSpecRef`를
   전달한다. World 생성 뒤 이 두 참조를 normal Stimulus로 교체하는 흐름을 설계하지 않는다.
3. `GET /worlds/{worldId}`에서 `WorldHead`의 `revision`, `logicalTime`, `lifecycle`을
   읽는다. 이 응답은 Domain Property나 raw `StateObject` graph 전체를 뜻하지 않는다.
4. Action은 `POST /worlds/{worldId}/actions`, logical time advance는
   `POST /worlds/{worldId}/time-advances`로 구분한다. 두 요청의 role·parameter 상세
   contract는 해당 World의 PublishedModel과 함께 검증한다.
5. projection은 `GET /worlds/{worldId}/projections/{projectionId}`, 함께 읽어야 하는
   projection은 `GET /worlds/{worldId}/projection-bundles/{bundleId}`로 조회한다. `revision`
   query를 전달한 경우 응답의 `sourceRevision`이 요청 기준점과 맞는지 확인한다.

모든 World Model operation은 bearer authentication을 선언한다. token 발급·검증 방식과
실제 권한 정책은 이 TypeSpec contract가 소유하지 않으므로 runtime의 인증 문서를 함께
검토한다.

## 5. 비동기 수용과 projection 일관성을 검증한다

Action과 time advance의 성공 응답 타입은 `StimulusAccepted`다. 이 응답은 Agenda가
stimulus를 받아들였다는 뜻이며 transaction commit 완료를 뜻하지 않는다. 따라서 runtime
adapter는 다음을 분리해야 한다.

- 수용 응답의 `status`가 `accepted`인지 `duplicate`인지
- 응답에 담긴 `acceptedAtRevision`, `acceptedLogicalTime`
- 이후 `WorldHead` 또는 projection을 읽었을 때 관찰되는 revision

projection 응답에서는 `sourceRevision`을 확인한다. 여러 projection을 하나의 읽기 단위로
사용하는 경우 `ProjectionBundleEnvelope.status`의 `complete`, `incomplete`, `stale`를
처리하고, 각 상태의 실제 판정 규칙은 runtime 정본에서 연결한다. `StimulusAccepted`를
받았다는 이유만으로 projection이 즉시 최신이라고 가정하지 않는다.

## 계약 변경으로 다시 시작해야 하는 경우

다음 중 하나를 바꾸면 생성물만 갱신하지 말고 TypeSpec source와 승인 snapshot diff를 다시
검토한다.

- `ModelRef`, `ExecutionProfileRef`, `WorldHead` 필드
- Action role/parameter envelope 또는 time advance union
- projection의 `sourceRevision`, `projectionId`, `bundleId`, `status`
- World Model operation path, method, auth, response status

변경은 [TypeSpec Authoring Conventions](../typespec-authoring-conventions.md)의
`pnpm schema:approve-typespec-reference` → diff review → `--write` → `pnpm schema:validate`
순서를 따른다. runtime consumer에 영향을 주면 `pnpm schema:downstream-check`도 실행한다.

## 완료 확인

- [ ] canonical 또는 외부 `--spec` artifact의 출처와 contract version을 기록했다.
- [ ] `validate --require-32`가 통과했다.
- [ ] 7개 World Model operation이 inventory에 나타난다.
- [ ] 생성 코드가 검증된 artifact에서 만들어졌다.
- [ ] runtime이 bearer auth와 operation별 오류 응답을 처리한다.
- [ ] `StimulusAccepted`를 commit 완료로 해석하지 않는다.
- [ ] projection 소비자가 `sourceRevision`과 bundle status를 확인한다.

개념적 경계와 각 모델의 관계는 [World Model Kernel 계약의 경계와 흐름](../../concepts/world-model.md)을
참조한다. 전체 TypeSpec source와 OpenAPI artifact 소유권은 [기본 스펙 사용 기준](../basic-spec-usage.md)에
둔다.
