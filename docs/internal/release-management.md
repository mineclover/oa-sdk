# Release Management

이 문서는 package-level versioning과 patch note 운영의 기준이다. 구현 현황의 SSOT는
[`spec.md`](./spec.md), API surface의 SSOT는 [`api-index.md`](./api-index.md), 큰 surface 변경
기록은 [`../changelog.md`](../changelog.md)에 둔다.

Machine-readable policy는 [`release-policy.json`](./release-policy.json)이다. `pnpm
check:release-policy`가 이 파일과 workspace package manifests, `.changeset/config.json`, 이 문서의
정합성을 검증한다.

## Current State

- Root package는 private monorepo이며 Changesets가 설치되어 있다.
- 모든 workspace package/app은 현재 `private: true`다. 따라서 현재 `pnpm release`는 npm publish
  파이프라인으로 보기보다, package version intent와 patch note 초안을 관리하기 위한 장치다.
- 실제 publish를 열기 전에는 package별 `files`, `publishConfig`, repository/license metadata, public
  dependency contract를 별도 readiness로 확인한다.
- Internal dependencies는 모두 `workspace:` protocol을 사용한다. Changesets config는 내부 의존성
  bump를 `patch`로 전파한다.

## Release-Tracked Packages

아래 패키지는 package-level versioning 후보로 유지한다.

| Package | Current version | Role |
| --- | ---: | --- |
| `@oa-sdk/openapi-projection-contract` | `0.1.0` | OpenAPI projection contract types and validation |
| `@oa-sdk/core` | `0.1.0` | Shared utilities and browser-safe core helpers |
| `@oa-sdk/parser` | `0.1.0` | OpenAPI 3.2 parser, IR, query, browser entrypoint |
| `@oa-sdk/schemas` | `0.1.0` | TypeSpec production source and OpenAPI artifacts |
| `@oa-sdk/mock-server` | `0.1.0` | Mock engine with MSW and Node HTTP adapters |
| `@oa-sdk/codegen` | `0.3.0` | CLI, typegen, governance, and schema/code generation |
| `@oa-sdk/dpm` | `0.1.0` | Relationship-first Data Pseudonymization Manifest toolkit |
| `@oa-sdk/router` | `0.1.0` | Server router generation |
| `@oa-sdk/client` | `0.1.0` | Fetch client generation |
| `@oa-sdk/typia-mock` | `0.1.0` | typia-compatible mock validation surface |
| `@oa-sdk/personas` | `0.1.0` | Data Persona registry and validator |
| `@oa-sdk/markdown-editor` | `0.1.0` | Reusable Markdown/GLFM editor helpers |
| `@oa-sdk/spec-lens` | `0.1.0` | Spec history and observation package |

## Ignored Workspaces

아래 workspace는 Changesets release 대상에서 제외한다. 앱, reference implementation, local infra,
incubating GitLab orchestration surface라 package-level npm release note와 분리한다.

| Workspace | Reason |
| --- | --- |
| `@oa-sdk/infra-gitlab` | Local/Pulumi infrastructure preset, currently `0.0.0` incubating |
| `@oa-sdk/orchestrator-gitlab` | GitLab orchestration MVP, currently `0.0.0` incubating |
| `@oa-sdk/nestjs-ref` | Reference implementation app |
| `@oa-sdk/orchestrator-gitlab-ui` | Vite app, not a library package |
| `@oa-sdk/playground` | Integration playground |
| `@oa-sdk/preview` | Preview app |
| `@oa-sdk/spec-lens-ui` | UI app paired with `@oa-sdk/spec-lens` |

If one of these becomes a public package, remove it from `.changeset/config.json` and give it an
explicit versioning policy first.

## Versioning Policy

- Use independent package versions by default. Do not add `fixed` or `linked` groups until a real
  release contract requires lockstep versions.
- `@oa-sdk/codegen` may stay ahead of the runtime packages because it owns CLI and schema production
  workflow milestones.
- `0.0.0` means incubating/internal with no release semantics.
- A package version bump should correspond to a package-level contract change, not every internal
  implementation commit.
- Browser subpath exports are part of the public contract for packages that expose them.

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

Run `pnpm release` only after publish readiness is explicitly confirmed. With the current all-private
package state, publish is intentionally closed.

Policy gate:

```bash
pnpm check:release-policy
```

## Publish Readiness Checklist

Before changing any package from `private: true` to public:

- Confirm the package belongs in the release-tracked list.
- Add or verify `files` so the package publishes only intended artifacts.
- Confirm all `exports`, `bin`, and browser subpath exports point to built files.
- Decide `publishConfig.access` and registry policy.
- Add repository/license metadata if the package will leave the private monorepo context.
- Run package build, typecheck, tests, and `pnpm changeset status --verbose`.
