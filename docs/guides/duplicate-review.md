# Duplicate Review 가이드

`oa-gen duplicate-review`는 Definition Builder fragment의 중복 후보를 탐지하고,
실제 target에서 생성될 이름 충돌을 검토한다. 결과를 보고 자동으로 fragment를 병합하거나
수정하지는 않는다.

> 외부 OpenAPI artifact만 수집하는 서비스에는 fragment가 없으므로 이 명령을 적용하지 않는다.

동작 기준: `@oa-sdk/codegen` 0.9.0. 동반 패키지는 필요 없다.

## 서비스 저장소에서

Definition Builder fragment로 계약을 조립하는 서비스는 `@oa-sdk/codegen`을 devDependency로 설치하고 PR gate에
다음을 넣는다([OpenAPI Governance Service Template](./openapi-governance-service-template.md#duplicate-review)).

```bash
npx oa-gen duplicate-review \
  --fragments contracts/fragments \
  --policy ci \
  --target contracts/targets/public-api.yaml \
  --format json \
  > duplicate-review.json
```

## 이 저장소에서 (빠른 선택)

이 저장소의 fragment는 TypeSpec 원본의 rollback·참조 경로다. 저장소 루트에는 `oa-gen`이 PATH에 없으므로
`pnpm --filter @oa-sdk/codegen build` 후 `node packages/codegen/dist/cli/index.js`로 실행한다.

```bash
# 전체 후보 탐색: 결과는 남기되 CI를 실패시키지 않음
node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy report \
  --format markdown

# PR 검토: 모든 후보를 보여 주고 error만 차단
node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy review \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --format markdown

# CI: 실제 생성 target의 canonical ID와 output name 충돌만 gate (git이 무시하는 .oa-sdk/에 기록)
mkdir -p .oa-sdk
node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy ci \
  --target packages/schemas/src/targets/public-api.yaml \
  --format json \
  > .oa-sdk/duplicate-review.json
```

## 정책과 종료 코드

| 정책 | 기본 검사 | 기본 `--fail-on` | target 요구 | 결과 decision / 종료 코드 |
|---|---|---|---|---|
| `report` (기본) | 전체 | `none` | 아니오 | 항상 `APPROVE` / 0. target 없는 synthetic naming 결과도 탐색용이다. |
| `review` | 전체 | `error` | 아니오 | error는 `REQUEST_CHANGES` / 1, 그 외 후보는 `COMMENT` / 0. |
| `ci` | `canonical-id`, `output-name` | `error` | 예 | 실제 target 충돌만 안정적으로 gate한다. |

`--policy ci`에 `--target`이 없으면 JSON/Markdown report에
`definition-duplicate-review/target-required` diagnostic을 남기고 exit 1로 끝난다.

## 검사 범위 조정

`--check`은 반복할 수 있으며, 지정하면 정책의 기본 검사 목록을 **대체**한다.
`--fail-on`은 선택된 finding과 diagnostic의 실패 severity threshold를 바꾼다.

```bash
# 여러 실제 target을 한 번에 검토
node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy ci \
  --target packages/schemas/src/targets/public-api.yaml \
  --target packages/schemas/src/targets/admin-api.yaml

# 같은 local name의 서로 다른 shape도 CI 경고 이상으로 차단
node packages/codegen/dist/cli/index.js duplicate-review \
  --fragments packages/schemas/src/fragments \
  --policy ci \
  --target packages/schemas/src/targets/public-api.yaml \
  --check canonical-id \
  --check output-name \
  --check local-name \
  --fail-on warning
```

| `--check` 값 | 의미 | 기본 severity |
|---|---|---|
| `canonical-id` | 같은 canonical ID가 여러 fragment source에 선언됨 | error |
| `content-hash` | 다른 canonical ID가 같은 content hash를 공유 | info |
| `local-name` | 같은 kind/local name이 서로 다른 shape를 가짐 | warning |
| `output-name` | 선택된 target에서 생성 output name이 충돌 | error, target 없는 synthetic 범위에서는 warning |
| `semantic-alias` | `metadata.semanticAliasOf` 선언 | info |

`metadata.semanticAliasOf`는 해당 alias source/target pair의 same-content 후보만 억제한다.
다른 canonical ID가 같은 hash를 공유하면 계속 보고하므로, 광범위한 예외 처리 수단으로
사용하면 안 된다.

## JSON과 review-bundle

JSON report에는 `policy`, `decision`, `summary`, `findings`, `diagnostics`가 포함된다.
`review-bundle --duplicate-review <report.json>`은 finding 개수가 아니라 이 `decision`을
사용한다. 따라서 `report` 정책의 관찰 결과는 bundle을 불필요하게 `COMMENT`로 낮추지 않고,
`review` 정책의 경고 후보는 의도대로 `COMMENT`가 된다.

## 작성·관리 규칙 (저장소 기여자)

CLI 계약과 사용 문서는 다음 경계를 따른다.

| 변경 대상 | 소유 문서/코드 | 검증 |
|---|---|---|
| 옵션 이름·반복 가능 여부·설명 | `packages/codegen/src/cli/spec/oa-gen-governance.ts` | `pnpm check:cli-spec` |
| language-neutral CLI mirror | `docs/cli-spec/oa-gen.governance.json` | `pnpm check:cli-spec` |
| 런타임 정책·결과 schema | `packages/codegen/src/cli/lib/duplicate-review.ts` 및 테스트 | `@oa-sdk/codegen` typecheck + duplicate-review tests |
| 운영 방법과 선택 기준 | 이 문서 | 명령/정책 변경 때 함께 갱신 |
| 전체 governance 흐름 | [OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md) | workflow 예시와 함께 확인 |

옵션이나 정책을 바꿀 때는 manifest와 JSON mirror를 먼저 맞추고, 이 가이드의 정책 표와
예시를 갱신한다. 마지막으로 아래를 실행한다.

```bash
corepack pnpm --filter @oa-sdk/codegen typecheck
corepack pnpm --filter @oa-sdk/codegen exec vitest run \
  src/__tests__/duplicate-review.test.ts \
  src/__tests__/cli-duplicate-review.test.ts \
  src/__tests__/review-bundle.test.ts \
  src/__tests__/cli-review-bundle.test.ts
corepack pnpm check:cli-spec
corepack pnpm test:docs-gates
corepack pnpm check:docs
corepack pnpm check:feature-tests
```
