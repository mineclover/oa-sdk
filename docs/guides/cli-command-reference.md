# oa-gen CLI 명령 레퍼런스

`oa-gen`은 OpenAPI artifact 생성, TypeSpec roundtrip, 타입 생성, 외부 서비스
governance, 변경 검토를 한 CLI에 모은다. 이 문서는 현재 구현된 기능 명령의 단일 색인이다.
옵션의 정확한 형식은 항상 `oa-gen <command> --help`가 정본이다.

저장소에서 직접 실행할 때는 먼저 CLI를 빌드한다.

```bash
pnpm --filter @oa-sdk/codegen build
node packages/codegen/dist/cli/index.js --help
```

공개 package consumer는 `npx oa-gen <command>`를 사용한다. 설치된 package binary를 shell PATH에
명시적으로 제공한 환경에서만 위의 `node .../index.js`를 `oa-gen`으로 바꾼다. 아래의 `입력`은
최소 시작점이며, `--help`는 모든 선택 옵션과 조건부 옵션을 보여 준다.

## 먼저 목적을 고르기

| 목적 | 시작 명령 | 다음 문서 |
| --- | --- | --- |
| production TypeSpec 계약을 수정·승인 | `pnpm schema:approve-typespec-reference`, `pnpm schema:validate` | [시스템 온보딩](./system-onboarding.md), [TypeSpec 규칙](./typespec-authoring-conventions.md) |
| 모노레포 선언적 스펙 및 거버넌스 설정 | `oa-gen validate`, `oa-gen generate` | [선언적 스펙 설정](./declarative-spec-configuration.md), [스키마 아키텍처 규칙](./schema-architecture-and-conventions.md) |
| 기존 OpenAPI에서 공개 TypeScript 타입을 생성 | `oa-gen typegen` | [Quick Start](./quick-start.md) |
| OpenAPI 3.2 스펙에서 Zod 4 스키마 및 타입 생성 | `oa-gen generate:zod` | [Quick Start](./quick-start.md) |
| OpenAPI 3.1/3.2 스펙에서 TanStack Query v5 3계층 옵션/키 생성 | `oa-gen generate:tanstack` | [온보딩 플레이북](./onboarding-playbook.md) |
| TypeSpec 또는 OpenAPI 기반 제로 빌드 Mock HTTP 서버 구동 | `oa-gen mock` | [Quick Start](./quick-start.md) |
| TypeSpec AST 시맨틱 차이점 및 Breaking Change 검출 | `oa-gen tsp diff` | [TypeSpec 규칙](./typespec-authoring-conventions.md) |
| 외부 NestJS/FastAPI OpenAPI를 관리 | `oa-gen scaffold-governance`, `collect`, `review-bundle` | [OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md) |
| Definition Builder rollback/reference artifact를 검사 | `oa-gen build-spec`, `duplicate-review`, `target-check` | [CLI setup](./cli-setup.md) |
| 4계층 E2E 테스트 및 드리프트 거버넌스 확인 | `oa-gen drift:check`, `oa-gen audit:csp` | [테스트 인프라](../concepts/test-infrastructure.md), [CLI 거버넌스 모델](../concepts/cli-governance.md) |
| contract ↔ implementation evidence를 검토 | `oa-gen parallel-evidence`, `review-bundle` | [parallel evidence 계약](../internal/typespec-roundtrip/parallel-evidence-contract.md) |

## 전역 공통 옵션 (Global Options)

모든 `oa-gen` 하위 명령은 아래의 프로젝트 루트 지정 옵션을 지원한다.

| 옵션 | 설명 |
| --- | --- |
| `--root <dir>`, `--project-root <dir>` | 프로젝트 루트 디렉터리를 명시적으로 지정. 미지정 시 `findProjectRoot()`의 6단계 우선순위에 따라 `oa.config.ts`, `pnpm-workspace.yaml`, `.git` 등을 상향 탐색하여 자동 감지. |

## 전체 명령 색인

| 명령 | 언제 쓰는가 | 최소 입력 | 결과 / 다음 단계 |
| --- | --- | --- | --- |
| `oa-gen init` | 타겟 분리형 온보딩 엔진으로 `oa.config.ts` 및 런타임 스크립트를 구성할 때 | 없음 (자동 감지) 또는 `--target <framework>` | 대화형/헤드리스 온보딩, `oa.config.ts` 생성 및 `package.json` 비파괴적 패치; `--target`, `--archetype <mvp|microservice|enterprise>` (`-a`), `--routing <default|fsd|monorepo|by-kind>` (`-r`), `--cwd`, `--spec`, `--yes`, `--force`, `--dry-run` 지원 |
| `oa-gen generate:zod` | OpenAPI 3.2 스펙에서 Zod 4 스키마 및 TypeScript 타입을 생성할 때 | `--spec <openapi>` | Zod 4 스키마 정의 및 TypeScript 타입 생성; `--spec`, `--output <path>`로 파일/디렉터리 지정, `--runtime-adapter`로 런타임 검증기 연동, `--style <schema\|both>` 지원 |
| `oa-gen generate:tanstack` | OpenAPI 3.1/3.2 스펙에서 TanStack Query v5 3계층(Query Key Factory, Options Factory, Hooks) 코드를 생성할 때 | `--spec <openapi>` | TanStack Query v5 산출물 (keys, options, hooks); `--spec` (`-s`), `--output <dir>` (`-o`), `--config <path>` (`-c`), `--tier <all\|keys\|options\|hooks>`, `--framework <react\|vue\|svelte>`, `--client-import <path>`, `--types-import <path>`, `--split` 지원 |
| `oa-gen mock` | TypeSpec, OpenAPI 또는 TypeScript 소스에서 제로 빌드 즉각 목 서버를 구동할 때 | `--tsp <file>` 또는 `--spec <path>` | 인메모리 OpenAPI 3.2 Mock HTTP 서버 구동 (기본 포트 4010); `--tsp`, `--spec` (.yaml, .json, .ts), `--port <port>`, `--host <host>`, `--watch`로 실시간 무중단 핫 리로드 지원 |
| `oa-gen tsp diff` | TypeSpec AST 간 시맨틱 차이점 및 파괴적 변경(breaking change)을 분석할 때 | `--base <ref> --head <ref>` | TypeSpec AST 시맨틱 비교 리포트; `--base`, `--head`, `--fail-on-breaking`으로 파괴적 변경 감지 시 exit code 1, `--format <markdown\|json>` 지원 |
| `oa-gen generate` | config, Drizzle schema, 독립형 타입 가드(standalone-guards) 또는 TanStack Query 클라이언트 옵션을 생성할 때 | 없음 (선언적 `oa.config.ts` 자동 로드) 또는 `--config`, `--drizzle-schema`, `--target standalone-guards --input <file>`, `--tanstack --spec <file>` | schema artifact, standalone-guards 또는 TanStack Query v5 산출물; `--split`으로 모듈 분할, `--schemas <list>`로 필터링, `--tanstack` 플래그로 TanStack 3계층 옵션/키 생성 |
| `oa-gen typegen` | OpenAPI에서 TypeScript 선언을 만들 때 | `--spec <openapi>` | type declarations; `--incremental`은 cache를 사용하고 `--cache-dir <dir>`로 위치를 바꿀 수 있음 |
| `oa-gen lint` | OpenAPI의 OA SDK lint만 빠르게 확인할 때 | `--spec <openapi>` | diagnostic; `--categories <list>`로 surface, structure 등 특정 카테고리만 지정 실행 |
| `oa-gen validate` | OpenAPI 파싱·구조·3.1 호환 및 프로파일 요구사항을 확인할 때 | 없음 (선언적 `oa.config.ts`의 모든 프로파일 일괄 검증) 또는 `--spec <openapi>` | human diagnostic; `--profile`로 component-bundle/operation-contract 강제, managed contract는 `--require-32` |
| `oa-gen audit:csp` | Manifest V3 브라우저 익스텐션 번들의 CSP 위반(eval, new Function, 런타임 ajv/zod/oa-sdk)을 정적 검사할 때 | `--bundle <dir>` | 0 eval, 0 runtime dependency 검증 리포트 및 non-zero exit code gate |
| `oa-gen audit:shape` | TypeScript AST 소스 또는 번들의 타입 구문 및 TypeSpec/OpenAPI 투영 적합성을 감사할 때 | `--bundle <dir>` 또는 `--source <file>` | 24개 syntax feature 분류 및 tripartite projection (direct/policy-required/unsupported) 진단 리포트; `--fail-on-unsupported`, `--json` 지원 |
| `oa-gen build-spec` | fragments와 target으로 reference OpenAPI를 만들 때 | `--target <target.yaml>` | OpenAPI와 diagnostics/provenance/metadata sidecars |
| `oa-gen normalize` | 외부 OpenAPI를 stable governance artifact로 정규화할 때 | `--spec <openapi>` | normalized artifact |
| `oa-gen upgrade` | 외부 OpenAPI 3.0/3.1을 3.2 analysis artifact로 볼 때 | `--spec <openapi>` | upgraded artifact와 optional report |
| `oa-gen collect` | raw 보존·normalize·upgrade를 한 번에 수행할 때 | `--spec`, `--normalized`, `--upgraded` | external intake artifact set; `--raw`는 원본 복사본이 필요할 때만 추가 |
| `oa-gen tsp-export` | OpenAPI를 TypeSpec spike/bundle로 변환해 볼 때 | `--spec <openapi>` | `.tsp`, report, optional sidecar/manifest; bundle manifest는 `--output`과 `--sidecar`가 함께 필요 |
| `oa-gen tsp-restore` | emitted OpenAPI에 compatibility sidecar를 다시 적용할 때 | `--spec <emitted> --sidecar <sidecar>` | restored OpenAPI와 stability report |
| `oa-gen tsp-bundle-check` | authored/generated TypeSpec bundle의 compile/restore/diff를 검사할 때 | 없음 (기본 authored fixture 사용 가능) | bundle report; 필요하면 `--project`, `--manifest`, `--sidecar`, `--expected`로 입력을 지정하고 `--fail-on-breaking`으로 expected diff gate를 켠다 |
| `oa-gen tsp-scaffold` | TypeSpec operation 및 DTO 모델 스캐폴딩을 생성·주입할 때 | `--route <path>` | TypeSpec code generation; `--method`, `--operation-id`, `--domain`, `--file`, `--output` 지원 |
| `oa-gen reference-check` | Apitomy와 OA SDK 진단을 비권위적 비교로 확인할 때 | `--spec <openapi>` | markdown/JSON comparison; 계약 권위는 바꾸지 않음 |
| `oa-gen scaffold-governance` | 외부 서비스에 독립 CLI·CI baseline governance scaffold를 만들 때 | `--root <dir> --service <name>` | config/script/docs/GitHub workflow; `--profile`, `--oa-gen-command`, `--oa-gen-setup-command`, `--typegen-policy` 선택 |
| `oa-gen inventory` | OpenAPI path, operation, component, security surface를 요약할 때 | `--spec <openapi>` | markdown/JSON inventory |
| `oa-gen behavior-query` | behavior SQLite projection을 검색·집계할 때 | `--behavior-db <sqlite> --mode <mode>` | query report; mode에 따라 `--behavior-type`, identity/target/decision/recommendation selector가 필요하며 `recent` 계열은 `--status`, `--limit`을 지원한다 |
| `oa-gen duplicate-review` | Definition fragment의 duplicate identity/collision을 검토할 때 | `--fragments <dir>` | report/review/ci policy report |
| `oa-gen target-check` | target 또는 artifact가 필요한/금지 path를 만족하는지 확인할 때 | `--target <target>` 또는 `--artifact <openapi>` | assertion report; 두 source는 one-of |
| `oa-gen diff` | base/head OpenAPI의 consumer-visible 변경을 분류할 때 | `--base <openapi> --head <openapi>` | change report; 엔드포인트 및 컴포넌트 스키마 변경 분류, `--fail-on-breaking`으로 파괴적 변경 시 exit code 1 |
| `oa-gen check-artifact` | 소스 Zod AST와 저장된 OpenAPI 아티팩트 간 신선도/드리프트를 검사할 때 | 없음 (`oa.config.ts` 타겟 일괄 대조) 또는 `--head <openapi> --artifact <openapi>` | 결정론적 SHA-256 (`x-schema-engine-version-hash`) 기반 freshness decision 리포트 |
| `oa-gen drift:check` | `oa-gen check-artifact`의 전용 별칭(alias)으로 CI/CD 스펙 드리프트 게이트를 실행할 때 | 없음 (`oa.config.ts` 타겟 일괄 대조) 또는 `--head <openapi> --artifact <openapi>` | 드리프트 발생 시 non-zero (code 1) 종료하는 CI 차단 게이트 리포트 |
| `oa-gen drift` | runtime OpenAPI와 managed OpenAPI를 비교할 때 | `--managed-openapi` + `--runtime-openapi` 또는 URL | drift report; runtime source는 one-of이며 URL 인증 header는 반복 가능한 `--runtime-header "Name: value"`로 전달 |
| `oa-gen review` | diff·validation·freshness를 묶어 검토할 때 | `--base <openapi> --head <openapi>` | review report; optional sidecar/behavior input |
| `oa-gen review-bundle` | PR용 aggregate review report를 만들 때 | `--base --head --artifact` | recommendation + optional inventory/drift/provenance/parallel evidence |
| `oa-gen parallel-evidence` | TypeSpec contract provenance와 ttsc observation을 pointer로 조인할 때 | `--typespec-provenance --ttsc-provenance` | 기본 ttsc adapter; 라이브러리에서는 다른 implementation adapter도 조합 가능 |

## behavior-query 조건부 옵션

모든 mode에 `--behavior-db`와 `--mode`가 필요하다. 아래 mode에서는 추가 selector가
없으면 명시적 오류로 종료한다.

| mode | 추가 필수 옵션 |
| --- | --- |
| `latest-failure-by-type`, `latest-by-type`, `metrics-summary` | `--behavior-type <type>` |
| `latest-by-identity` | `--identity-key <key>` |
| `latest-by-target` | `--target-type <type> --target-key <key>` |
| `latest-by-decision-signal` | `--decision-signal <signal>` |
| `latest-by-recommendation` | `--recommendation <value>` (예: `APPROVE`, `COMMENT`, `REQUEST_CHANGES`) |

예를 들어 review bundle metric만 집계하려면 다음처럼 실행한다.

```bash
oa-gen behavior-query \
  --behavior-db .oa-sdk/review-metrics.sqlite \
  --mode metrics-summary \
  --behavior-type publish_review_bundle \
  --format json
```

## generate:tanstack 옵션 및 인수 명세

`oa-gen generate:tanstack`은 OpenAPI 3.1/3.2 명세로부터 TanStack Query (React Query) v5 기반의 3계층 타입 안전 아티팩트(Query Key Factory, Options Factory, React Hooks)를 자동 생성합니다.

| 옵션 | 단축 | 설명 |
| --- | --- | --- |
| `--spec <path>` | `-s` | OpenAPI 3.1/3.2 스펙 파일 경로 또는 URL (필수) |
| `--output <dir>` | `-o` | 산출물이 저장될 출력 디렉터리 경로 (기본값: `src/api/generated`, `oa.config.ts`의 `outputRouting` 설정 시 자동 라우팅) |
| `--config <path>` | `-c` | 명시적 `oa.config.ts` 설정 파일 경로 |
| `--tier <tier>` | | 생성할 아티팩트 계층 필터: `all` (전체), `keys` (Tier 1 Query Key Factory), `options` (Tier 2 Pure Options Factory), `hooks` (Tier 3 Composition Hooks) |
| `--framework <fw>` | | 대상 프레임워크 지정: `react` (기본값), `vue` (`@tanstack/vue-query`), `svelte` (`@tanstack/svelte-query`) |
| `--package <pkg>` | | 쿼리 패키지 모듈 식별자 (기본값: `@tanstack/react-query`) |
| `--client-name <name>` | | 클라이언트 클래스/타입 식별자 이름 (기본값: `ApiClient`) |
| `--client-import <path>` | | 클라이언트 SDK 모듈 import 지정자 (예: `@oa-sdk/client` 또는 상대 경로) |
| `--types-import <path>` | | 유선 요청/응답 타입 정의 모듈 import 지정자 |
| `--hooks` | | React composition hooks 래퍼 생성 활성화 여부 (기본값: true) |
| `--banner` | | 자동 생성 파일 식별 배너 주석 및 타임스탬프 삽입 여부 (기본값: true) |
| `--split` | | 산출물을 `keys.ts`, `queries.ts`, `hooks.ts`로 개별 분할 생성 |

실행 예시:

```bash
# 기본 단일 파일 생성 (keys + queryOptions + mutationOptions + React hooks)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api/generated

# 계층별 개별 파일 분할 생성 (keys.ts, queries.ts, hooks.ts)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api/generated --split

# Pure Options 계층만 생성 (서버 사이드 prefetchQuery 및 Vue/Svelte 호환)
oa-gen generate:tanstack --spec ./openapi.yaml --tier options --framework vue

# oa-gen generate 명령의 --tanstack 플래그를 통한 동일 생성
oa-gen generate --tanstack --spec ./openapi.yaml --output ./src/api/generated
```

## TypeSpec ↔ TypeScript evidence 예시

두 provenance artifact가 **같은 OpenAPI artifact 계열**에서 나와야 coverage가 의미를
갖는다. 서로 다른 서비스/버전을 조인해 낮은 ratio가 나오더라도 CLI failure가 아니라
review evidence다.

```bash
oa-gen parallel-evidence \
  --typespec-provenance .oa-sdk/typespec-candidates/declaration-ref-provenance.json \
  --ttsc-provenance .artifacts/ttsc-contract-provenance.json \
  --format json

oa-gen review-bundle \
  --base contracts/baseline.openapi.yaml \
  --head contracts/current.openapi.yaml \
  --artifact contracts/current.generated.openapi.yaml \
  --typespec-provenance .oa-sdk/typespec-candidates/declaration-ref-provenance.json \
  --ttsc-provenance .artifacts/ttsc-contract-provenance.json \
  --format markdown
```

`parallel-evidence`는 TypeSpec의 계약 권위를 변경하거나 coverage threshold를 강제하지
않는다. CI에서의 기준선 비교와 승인 정책은 consumer workflow가 결정한다.

## 검증 명령과의 관계

- production TypeSpec 변경: `pnpm schema:approve-typespec-reference` → 검토 →
  `pnpm schema:validate` → 필요 시 `pnpm schema:downstream-check`.
- 문서/CLI 수정: `pnpm check:docs`, `pnpm check:cli-spec`.
- 전체 명령 옵션: `oa-gen <command> --help`.
- 거버넌스 및 테스트 모델: [CLI 거버넌스 및 스펙 검증 모델](../concepts/cli-governance.md), [4-Tier 테스트 인프라](../concepts/test-infrastructure.md).
