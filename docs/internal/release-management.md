# Release Management

이 문서는 package-level versioning과 patch note 운영의 기준이다. 제품 범위의 SSOT는
[`platform-scope.md`](./platform-scope.md), 구현 현황의 SSOT는 [`spec.md`](./spec.md), API
surface의 SSOT는 [`api-index.md`](./api-index.md), 큰 surface 변경 기록은
[`../changelog.md`](../changelog.md)에 둔다.

Machine-readable policy는 version 3의 [`release-policy.json`](./release-policy.json)이다. `pnpm
check:release-policy`가 이 파일과 workspace package manifests, `.changeset/config.json`, 이 문서의
정합성을 검증한다.

## Current State

- Root package는 private monorepo이며 Changesets가 설치되어 있다.
- Root monorepo와 app/reference workspace는 private이다. `pnpm release`는 Core와 Downstream만
  build한 뒤 `changeset publish`를 호출하지만, registry publish는 여전히 승인·credential-gated다.
  Version intent와 patch note 초안은 `pnpm changeset`과 `pnpm version-packages`로 관리한다.
- `@oa-sdk/core`, `@oa-sdk/openapi-projection-contract`, `@oa-sdk/typespec-decorators`,
  `@oa-sdk/parser`, `@oa-sdk/codegen`은
  public npm **distribution candidate**다. 이 네 패키지는 `dist`만 pack하고 provenance를
  요구하며, codegen pack smoke가 실제 tarball에서 export/bin과 workspace protocol 제거를 검증한다.
- 다른 release-tracked package는 아직 private이다. `publish.enabled: false`는 자동/일괄 publish를
  닫는 정책이며, distribution candidate의 실제 배포에는 npm 권한과 별도 release 승인이 필요하다.
- Internal dependencies는 모두 `workspace:` protocol을 사용한다. Changesets config는 내부 의존성
  bump를 `patch`로 전파한다.
- Release policy v3는 10개 release-tracked package와 10개 ignored workspace를 관리한다. Release
  tracking은 제품 scope와 일치시키되, Core Platform과 Downstream Integration을 서로 다른
  architecture tier로 유지한다.

## Release-Tracked Packages

아래 11개 패키지는 package-level versioning 후보로 유지한다. Core Platform 여덟 패키지가
schema/spec 관리 제품을 소유하고, Downstream Integration 세 패키지는 그 계약의 소비 가능성을
증명한다.

| Tier | Package | Current version | Role |
| --- | --- | ---: | --- |
| Core Platform | `@oa-sdk/core` | `0.1.0` | Shared utilities and browser-safe core helpers |
| Core Platform | `@oa-sdk/openapi-projection-contract` | `0.1.0` | OpenAPI projection contract types and validation |
| Core Platform | `@oa-sdk/typespec-decorators` | `0.1.0` | Versioned OA SDK TypeSpec decorators used by production schema source |
| Core Platform | `@oa-sdk/schemas` | `0.1.0` | TypeSpec production source and OpenAPI artifacts |
| Core Platform | `@oa-sdk/parser` | `0.1.0` | OpenAPI 3.2 parser, IR, query, browser entrypoint |
| Core Platform | `@oa-sdk/codegen` | `0.3.0` | CLI, typegen, governance, and schema/code generation |
| Core Platform | `@oa-sdk/spec-lens` | `0.1.0` | Spec history and observation package |
| Core Platform | `@oa-sdk/spec-lens-contract` | `0.1.0` | Browser-safe spec-lens HTTP wire contract |
| Downstream Integration | `@oa-sdk/router` | `0.1.0` | Server router generation |
| Downstream Integration | `@oa-sdk/client` | `0.1.0` | Fetch client generation |
| Downstream Integration | `@oa-sdk/mock-server` | `0.1.0` | Mock engine with MSW and Node HTTP adapters |

## Ignored Workspaces

아래 10개 workspace는 Changesets release 대상에서 제외한다. Maintenance-only package는
보안·호환·migration만 수행하고, app/reference workspace는 Core release와 분리한다. Ignored는
삭제나 검증 중단을 뜻하지 않으며 active feature investment가 아님을 뜻한다.

| Tier | Workspace | Reason |
| --- | --- | --- |
| Maintenance-only | `@oa-sdk/dpm` | Data-governance separation candidate; security, compatibility, migration only |
| Maintenance-only | `@oa-sdk/personas` | Data-governance separation candidate; security, compatibility, migration only |
| Maintenance-only | `@oa-sdk/typia-mock` | Experiment/archive candidate; security, compatibility, migration only |
| Maintenance-only | `@oa-sdk/logical-erd-contract` | Private TypeSpec ERD prototype's neutral artifact contract; no DPM or physical DB dependency |
| Maintenance-only | `@oa-sdk/typespec-erd` | Private TypeSpec ERD prototype and `oa-erd` CLI; no OpenAPI/codegen runtime dependency |
| Maintenance-only | `@oa-sdk/ttsc-compile-fixture` | Isolated TS 7 compiler fixture; policy-tracked but excluded from bulk build/test/typecheck tasks because it has no package task surface |
| App/reference | `@oa-sdk/nestjs-ref` | Reference implementation app |
| App/reference | `@oa-sdk/playground` | Integration playground |
| App/reference | `@oa-sdk/preview` | Preview app |
| App/reference | `@oa-sdk/spec-lens-ui` | UI app paired with `@oa-sdk/spec-lens` |

`@oa-sdk/markdown-editor`, `@oa-sdk/infra-gitlab`, `@oa-sdk/orchestrator-gitlab`,
`@oa-sdk/orchestrator-gitlab-ui`는 각각 `markdown-editor`와 `gitlab-agent-ops` 저장소로 추출되어
이 manifest와 Changesets lifecycle의 대상이 아니다.

새 non-core feature나 public package 승격은 구현 전에
[`platform-scope.md`](./platform-scope.md)의 scope-reactivation decision을 먼저 기록하고,
승인된 경우에만 `.changeset/config.json`과 release policy를 함께 변경한다.

## Versioning Policy

- Use independent package versions by default. Do not add `fixed` or `linked` groups until a real
  release contract requires lockstep versions.
- `@oa-sdk/codegen` may stay ahead of the runtime packages because it owns CLI and schema production
  workflow milestones.
- Release-tracked workspace는 `0.0.0`을 사용할 수 없다. Ignored workspace의 version은 release
  readiness를 뜻하지 않는다.
- A package version bump should correspond to a package-level contract change, not every internal
  implementation commit.
- Browser subpath exports are part of the public contract for packages that expose them.
- Maintenance-only와 app/reference workspace에는 새 feature Changeset을 만들지 않는다.

## Patch Note Policy

- Use Changesets for package-level patch notes and version bump intent.
- Use `docs/changelog.md` for larger repo surface milestones that span multiple packages or workflows.
- Do not duplicate implementation details from `spec.md`, `api-index.md`, or `feature-test-matrix.md`
  inside release notes. Link to the SSOT when details matter.
- Mention affected package names explicitly in Changeset summaries.

Suggested flow:

```bash
pnpm changeset
pnpm changeset status --verbose
pnpm version-packages
```

Run `pnpm release` only after registry authorization and the package-specific release approval are
explicitly confirmed. The distribution candidates are pack-ready, not automatically published.

Policy gate:

```bash
pnpm check:release-policy
```

## Publish Readiness Checklist

Before adding a distribution candidate or publishing one:

- Confirm the package belongs in the release-tracked list.
- Add or verify `files` so the package publishes only intended artifacts.
- Confirm all `exports`, `bin`, and browser subpath exports point to built files.
- Decide `publishConfig.access` and registry policy.
- Add repository/license metadata if the package will leave the private monorepo context.
- Run package build, typecheck, tests, and `pnpm changeset status --verbose`.
