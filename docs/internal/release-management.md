# Release Management

이 문서는 package-level versioning과 patch note 운영의 기준이다. 제품 범위의 SSOT는
[`platform-scope.md`](./platform-scope.md), 구현 현황의 SSOT는 [`spec.md`](./spec.md), API
surface의 SSOT는 [`api-index.md`](./api-index.md), 큰 surface 변경 기록은
[`../changelog.md`](../changelog.md)에 둔다.

Machine-readable policy는 version 5의 [`release-policy.json`](./release-policy.json)이다. 이 파일의
`publish.mode`는 `artifact-only`, `publish.enabled`는 `false`, `publish.repository`는
`https://github.com/mineclover/oa-sdk-releases.git`이다. `pnpm check:release-policy`가 이 파일과
workspace package manifests, `.changeset/config.json`, root/workspace scripts, 이 문서의 정합성을
검증한다.

release candidate의 현재 판단 입력과 source/external 책임 경계는
[`release-readiness.md`](./release-readiness.md)가 소유한다. maintainer 실행 절차는
[Artifact Release Preparation](../guides/release-preparation.md)을 따른다.

## Current State

현재 정책 스냅샷: v5 · 4 tracks · Core Platform 11 · Downstream 15 · release-tracked 26 · ignored 11 · distribution candidates 22.

- Root package는 private monorepo이며 Changesets가 설치되어 있다.
- Root monorepo와 app/reference workspace는 private이다. `pnpm release`는 `pnpm release:export`에
  위임해 검토 가능한 artifact만 생성하며, private source repository에서는 Changesets, npm, pnpm
  등의 direct registry publish command를 실행하거나 script로 등록하지 않는다. Version intent와
  patch note 초안은 `pnpm changeset`과 `pnpm version-packages`로 관리한다.
- `@oa-sdk/core`, `@oa-sdk/openapi-projection-contract`, `@oa-sdk/typespec-decorators`,
  `@oa-sdk/parser`, `@oa-sdk/codegen`, `@oa-sdk/ast-sync`, `@oa-sdk/tools`, `@oa-sdk/surface-ir`,
  `@oa-sdk/chunk-stream`, `@oa-sdk/chunk-stream-crdt`, `@oa-sdk/chunk-stream-ui`,
  `@oa-sdk/chunk-stream-timeseries`, `@oa-sdk/chunk-stream-react`, `@oa-sdk/peer-transport`,
  `@oa-sdk/peer-server`, `@oa-sdk/webmcp-peer`, `@oa-sdk/collab-workspace`, `@oa-sdk/mcp-mesh`,
  `@oa-sdk/router`, `@oa-sdk/client`, `@oa-sdk/mock-server`, `@oa-sdk/telemetry`는 public npm **distribution candidate**다. 이 패키지는 allowlisted
  `dist`/`lib` artifact만 pack하고 provenance를 요구하며, exporter의 archive/consumer smoke가 실제
  tarball에서 export/bin target, workspace protocol 제거, 설치 후 소비 가능성을 검증한다.
  source manifest는 `private: false`, public Node floor인 `engines.node: ">=22.0.0"`, 그리고
  `files`에 포함된 entry point를 선언해야 한다. Node 22/24/26 public runtime smoke가 packed artifact에서
  검증하는 이 규칙을 `pnpm check:release-policy`도 source manifest에서 먼저 검사한다.
  두 smoke의 consumer는 optional peer 없이 설치하므로, root entry point를 포함한 public entry point는
  dependency와 required peer만으로 import되어야 한다. optional peer가 필요한 export subpath는
  `release-policy.json`의 `optionalPeerEntryPoints`에 선언한다(`@oa-sdk/mock-server`의 `./adapters/msw`,
  `./browser`).
- 다른 release-tracked package는 아직 private이다. `publish.enabled: false`와
  `publish.mode: artifact-only`는 source repository의 registry publish 경로를 닫는다. Distribution
  candidate의 실제 registry 배포는 별도 artifact repository의 승인된 workflow만 수행한다.
- Internal dependencies는 모두 `workspace:` protocol을 사용한다. Changesets config는 내부 의존성
  bump를 `patch`로 전파한다.
- Release policy v5는 Core Platform 11개와 Downstream Integration 15개, 총 26개 release-tracked package와
  11개 ignored workspace를 관리한다. Release
  tracking은 제품 scope와 일치시키되, Core Platform과 Downstream Integration을 서로 다른
  architecture tier로 유지한다.

## Release-Tracked Packages

아래 26개 패키지는 package-level versioning 후보로 유지한다. Core Platform 열한 패키지가
schema/spec 관리 제품을 소유하고, Downstream Integration 열다섯 패키지는 그 계약의 소비 가능성을
증명한다.

| Tier | Package | Current version | Role |
| --- | --- | ---: | --- |
| Core Platform | `@oa-sdk/core` | `0.3.1` | Shared utilities and browser-safe core helpers |
| Core Platform | `@oa-sdk/openapi-projection-contract` | `0.2.0` | OpenAPI projection contract types and validation |
| Core Platform | `@oa-sdk/typespec-decorators` | `0.4.0` | Versioned OA SDK TypeSpec decorators used by production schema source |
| Core Platform | `@oa-sdk/schemas` | `0.1.0` | TypeSpec production source and OpenAPI artifacts |
| Core Platform | `@oa-sdk/parser` | `0.5.0` | OpenAPI 3.2 parser, IR, query, browser entrypoint |
| Core Platform | `@oa-sdk/codegen` | `0.10.0` | CLI, typegen, governance, and schema/code generation |
| Core Platform | `@oa-sdk/spec-lens` | `0.1.7` | Spec history and observation package |
| Core Platform | `@oa-sdk/spec-lens-contract` | `0.1.1` | Browser-safe spec-lens HTTP wire contract |
| Core Platform | `@oa-sdk/ast-sync` | `0.2.1` | V3 TypeScript AST bidirectional sync and standalone type guards |
| Core Platform | `@oa-sdk/tools` | `0.2.0` | Universal Tool Engine for MCP, CLI, and Schema Bridge |
| Core Platform | `@oa-sdk/surface-ir` | `0.2.0` | Target-neutral API surface IR and Forge projection adapter |
| Downstream Integration | `@oa-sdk/router` | `0.2.4` | Server router generation |
| Downstream Integration | `@oa-sdk/client` | `0.3.0` | Fetch client generation |
| Downstream Integration | `@oa-sdk/mock-server` | `0.1.5` | Mock engine with MSW and Node HTTP adapters |
| Downstream Integration | `@oa-sdk/chunk-stream` | `0.3.0` | Universal Chunk Stream core runtime, envelope, residency leases, virtualizer |
| Downstream Integration | `@oa-sdk/chunk-stream-crdt` | `0.1.2` | CRDT Delta Semi-Lattice, vector clocks, compaction horizon |
| Downstream Integration | `@oa-sdk/chunk-stream-ui` | `0.2.1` | UI Action cues, ContentPort batch bridge, PlaybackBridge, Storyboard adapter |
| Downstream Integration | `@oa-sdk/chunk-stream-timeseries` | `0.1.2` | Multi-channel time-series telemetry adapter, LTTB downsampling, decimation |
| Downstream Integration | `@oa-sdk/chunk-stream-react` | `0.2.1` | React 18/19 hooks, playback timeline synchronization, peer awareness |
| Downstream Integration | `@oa-sdk/peer-transport` | `0.2.0` | Shared bridge client, packet validation, bounded reconnect queue |
| Downstream Integration | `@oa-sdk/peer-server` | `0.2.0` | Local peer registry, authenticated HTTP dispatch and provider RPC correlation |
| Downstream Integration | `@oa-sdk/webmcp-peer` | `0.2.1` | Unified 3-tier WebMCP peer server routing, browser provider, and external agent client SDK |
| Downstream Integration | `@oa-sdk/collab-workspace` | `0.1.1` | In-memory workspace lattice, scoped AI edits and intent locks |
| Downstream Integration | `@oa-sdk/mcp-mesh` | `0.1.1` | Domain/session library, validated tool routing and CLI |
| Downstream Integration | `@oa-sdk/telemetry` | `0.2.0` | Design-driven telemetry, tracking symbol registry, XState v5 inspector, and DPM pseudonymization bridge |
| Downstream Integration | `@oa-sdk/rpc` | `0.2.0` | Private RPC runtime over the Surface IR RPC contract: typed client/server, JSON-RPC 2.0 and REST binding |

## Ignored Workspaces

아래 11개 workspace는 Changesets release 대상에서 제외한다. Maintenance-only package는
보안·호환·migration만 수행하고, app/reference workspace는 Core release와 분리한다. Ignored는
삭제나 검증 중단을 뜻하지 않으며 active feature investment가 아님을 뜻한다.

| Tier | Workspace | Reason |
| --- | --- | --- |
| Maintenance-only | `@oa-sdk/dpm` | Data-governance separation candidate; security, compatibility, migration only |
| Maintenance-only | `@oa-sdk/personas` | Data-governance separation candidate; security, compatibility, migration only |
| Maintenance-only | `@oa-sdk/typia-mock` | Experiment/archive candidate; security, compatibility, migration only |
| Maintenance-only | `@oa-sdk/logical-erd-contract` | Private TypeSpec ERD prototype's neutral artifact contract; no DPM or physical DB dependency |
| Maintenance-only | `@oa-sdk/typespec-erd` | Private TypeSpec ERD prototype and `oa-erd` CLI; no OpenAPI/codegen runtime dependency |
| Maintenance-only | `@oa-sdk/typespec-tooling` | Private TypeSpec IDE tooling and linting utilities |
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
# Review and commit the version changes before this clean-worktree gate.
pnpm release:preflight
```

After the version changes are reviewed and committed, run `pnpm release -- <export arguments>` (or
`pnpm release:export -- <export arguments>`) to create artifacts. This command never publishes to a
registry; registry credentials belong only to the separate artifact repository workflow.

## Public Artifact Promotion

The private `oa-sdk` repository is the authoring and validation boundary. Public npm artifacts are
promoted through the separate [`mineclover/oa-sdk-releases`](https://github.com/mineclover/oa-sdk-releases)
repository, which stores only sanitized package tarballs and their immutable SHA-512 manifest. It does
not receive the private source tree, tests, lockfile, or development history.

The exporter obtains both the candidate list and the exact artifact repository
`https://github.com/mineclover/oa-sdk-releases.git` from `release-policy.json`; neither value is
maintained as a second hard-coded list in the exporter.

After a clean private-source commit has passed the release gates, create a reviewed artifact export:

```bash
pnpm release:export -- \
  --output ../oa-sdk-releases \
  --release-id <immutable-release-id> \
  --version @oa-sdk/core=<next-version> \
  --version @oa-sdk/openapi-projection-contract=<next-version> \
  --version @oa-sdk/typespec-decorators=<next-version> \
  --version @oa-sdk/parser=<next-version> \
  --version @oa-sdk/codegen=<next-version>
```

The exporter rebuilds every selected package from a clean output directory, removes source maps and
test files, rewrites every `workspace:` runtime/optional/peer dependency to a resolvable public
version, adds public repository and Apache-2.0 metadata, and refuses an npm version that already
exists. A dependency resolves to the version the same export releases or, when the export does not
include it, to its committed source version, which must already be on npm; npm's latest release is
never substituted. An unresolved internal dependency—including an optional peer—is a hard failure and
is never silently removed. When codegen is included, every `@oa-sdk` version the packed codegen
embeds for `oa-gen init` ranges and companion install hints must likewise be in the export or on npm.
Before emitting the release manifest it installs the sanitized tarballs into an
isolated temporary consumer, dynamically imports every concrete public export, runs `oa-gen --help`,
`validate`, and `typegen` when codegen is included, and compiles the consumer with the repository's
TypeScript 5 toolchain. Review and merge the generated
`releases/<release-id>/manifest.json` and `.tgz` files in `oa-sdk-releases`; its manual **Publish npm
release** workflow validates the same artifact boundary before using that repository's `NPM_TOKEN`.

Do not create an official export from a dirty worktree. A tarball makes its compiled code public, so the
artifact-only repository protects private history and unshipped materials, not the executable code itself.

Policy gate:

```bash
pnpm check:release-policy
```

## Publish Readiness Checklist

Before adding a distribution candidate or promoting one from the artifact repository:

- Confirm the package belongs in the release-tracked list.
- Add or verify `files` so the package publishes only intended artifacts.
- Confirm all `exports`, `bin`, and browser subpath exports point to built files.
- Decide `publishConfig.access` and registry policy.
- Add repository/license metadata if the package will leave the private monorepo context.
- Run package build, typecheck, tests, and `pnpm changeset status --verbose`.
