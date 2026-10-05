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

`generate:client`, `pack:client`, `generate:tanstack`, `mock`, 그리고 `oa-gen generate`의 핸들러
계약·클라이언트 산출물은 `@oa-sdk/codegen`에 포함되지 않은 동반 패키지(`@oa-sdk/router`,
`@oa-sdk/client`, `@oa-sdk/mock-server`)가 생성한다. 명령별 필요 패키지, 설치 방법, 패키지가
없을 때의 동작은 [동반 패키지 안내](./cli-setup.md#동반-패키지-companion-packages)를 따른다.

## 먼저 목적을 고르기

| 목적 | 시작 명령 | 다음 문서 |
| --- | --- | --- |
| production TypeSpec 계약을 수정·승인 | `pnpm schema:approve-typespec-reference`, `pnpm schema:validate` | [기여자 온보딩](./onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩), [TypeSpec 규칙](./typespec-authoring-conventions.md) |
| 모노레포 선언적 스펙 및 거버넌스 설정 | `oa-gen validate`, `oa-gen generate` | [선언적 스펙 설정](./declarative-spec-configuration.md), [스키마 아키텍처 규칙](./schema-architecture-and-conventions.md) |
| 기존 OpenAPI에서 공개 TypeScript 타입을 생성 | `oa-gen typegen` | [Quick Start](./quick-start.md) |
| OpenAPI 3.1/3.2 스펙에서 타입 안전 fetch 클라이언트 SDK 생성 | `oa-gen generate:client` | [Quick Start](./quick-start.md) |
| OpenAPI 3.2 스펙에서 Zod 4 스키마 및 타입 생성 | `oa-gen generate:zod` | [Quick Start](./quick-start.md) |
| OpenAPI 3.1/3.2 스펙에서 TanStack Query v5 3계층 옵션/키 생성 | `oa-gen generate:tanstack` | [온보딩 플레이북](./onboarding-playbook.md) |
| OpenAPI artifact를 Forge SDK/CLI surface로 투영 | `oa-gen surface --target forge` | [Cloudflare Forge 지원](./forge-support.md) |
| TypeSpec 또는 OpenAPI 기반 제로 빌드 Mock HTTP 서버 구동 | `oa-gen mock` | [Quick Start](./quick-start.md) |
| TypeSpec AST 시맨틱 차이점 및 Breaking Change 검출 | `oa-gen tsp diff` | [TypeSpec 규칙](./typespec-authoring-conventions.md) |
| 외부 NestJS/FastAPI OpenAPI를 관리 | `oa-gen scaffold-governance`, `collect`, `review-bundle` | [OpenAPI Governance Workflow](./use-cases/openapi-governance-workflow.md) |
| Definition Builder rollback/reference artifact를 검사 | `oa-gen build-spec`, `duplicate-review`, `target-check` | [기본 스펙 사용 기준](./basic-spec-usage.md) |
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
| `oa-gen init` | 타겟 분리형 온보딩 엔진으로 `oa.config.ts` 및 런타임 스크립트를 구성할 때 | 없음 (자동 감지) 또는 `--target <framework>` | 대화형/헤드리스 온보딩, `oa.config.ts` 생성 및 `package.json` 비파괴적 패치; `--target` (`-t`), `--archetype <mvp|microservice|enterprise>` (`-a`), `--routing <default|fsd|monorepo|by-kind>` (`-r`), `--cwd`, `--spec` (`-s`), `--yes` (`-y`), `--force` (`-f`), `--dry-run` 지원 |
| `oa-gen generate:client` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp) 스펙에서 타입 안전 fetch 클라이언트 SDK를 생성할 때 | `--spec <openapi\|typespec>` | fetch 클라이언트 SDK 산출물; `--spec` (`-s`), `--output <path>` (`-o`), `--types-import <path>`, `--banner` 지원 (`oa-gen client` alias 지원) |
| `oa-gen generate:zod` | OpenAPI 3.2 또는 TypeSpec(.tsp) 스펙에서 Zod 4 스키마 및 TypeScript 타입을 생성할 때 | `--spec <openapi\|typespec>` | Zod 4 스키마 정의 및 TypeScript 타입 생성; `--spec`, `--output <path>`로 파일/디렉터리 지정, `--runtime-adapter`로 런타임 검증기 연동, `--style <schema\|both>` 지원 |
| `oa-gen generate:tanstack` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp) 스펙에서 TanStack Query v5 3계층(Query Key Factory, Options Factory, Hooks) 코드를 생성할 때 | `--spec <openapi\|typespec>` | TanStack Query v5 산출물 (keys, options, hooks); `--spec` (`-s`), `--output <dir>` (`-o`), `--config <path>` (`-c`), `--tier <all\|keys\|options\|hooks>`, `--framework <react\|vue\|svelte>`, `--client-import <path>`, `--types-import <path>`, `--split` 지원 |
| `oa-gen surface` | OpenAPI 또는 TypeSpec artifact를 target-neutral Surface IR과 Forge projection/Overlay로 변환할 때 | `--spec <openapi\|typespec>` | `surface-ir.json`, `forge-projection.json`, command별 Overlay, `surface-manifest.json`; `--target forge`, `--out-dir`, `--mapping`, `--fail-on-warning` 지원 |
| `oa-gen generate:guards` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp)으로부터 독립형 무런타임 타입 가드를 생성할 때 | `--input <file>` | 독립형 무런타임 타입 가드(Standalone Type Guards) 산출물; `--input` (`-i`), `--out-dir` (`-o`), `--type-import`, `--module-format`, `--split`, `--schemas` 지원 |
| `oa-gen generate:drizzle` | Drizzle ORM 스키마 파일로부터 OpenAPI 3.2 스키마 컴포넌트를 생성할 때 | `--drizzle-schema <path>` | Drizzle ORM 스키마 기반 OpenAPI 3.2 컴포넌트 산출물; `--drizzle-schema` (`-d`), `--output` (`-o`), `--merge-into`, `--schemas` 지원 |
| `oa-gen mock` | TypeSpec, OpenAPI 또는 TypeScript 소스에서 제로 빌드 즉각 목 서버를 구동할 때 | `--tsp <file>` 또는 `--spec <path>` | 인메모리 OpenAPI 3.2 Mock HTTP 서버 구동 (기본 포트 4010); `--tsp` (`-t`), `--spec` (`-s`), `--port <port>` (`-p`), `--host <host>`, `--watch` (`-w`)로 100ms 디바운스, 에러 쉴딩, 원자적 인메모리 라우트 핫스왑 지원 |
| `oa-gen tsp diff` | TypeSpec AST 간 시맨틱 차이점 및 파괴적 변경(breaking change)을 분석할 때 | `--base <ref> --head <ref>` | TypeSpec AST 시맨틱 비교 리포트; `--base`, `--head`, `--fail-on-breaking`으로 파괴적 변경 감지 시 exit code 1, `--format <markdown\|json>` 지원 |
| `oa-gen generate` | TypeSpec, OpenAPI, config, Drizzle에서 스키마, 계약, 클라이언트, 가드를 일괄 생성할 때 | 없음 (선언적 `oa.config.ts` 자동 로드) 또는 `--spec <openapi\|typespec>`, `--config <file>`, `--drizzle-schema <path>`, `--target standalone-guards --input <file>` | 스펙 아티팩트, 순수 핸들러 계약(`*.contract.ts`), 클라이언트 SDK, TanStack Query, 가드 일괄 산출물; `--spec` (`-s`), `--output` (`-o`), `--out-dir`, `--config` (`-c`), `--split` 지원 |
| `oa-gen typegen` | OpenAPI 또는 TypeSpec(.tsp)에서 TypeScript 선언을 만들 때 | `--spec <openapi\|typespec>` | type declarations; `--incremental`은 같은 spec·출력 대상의 입력 파일(외부 `$ref`는 `node_modules` 안이어도 파일 내용으로, TypeSpec import 포함, TypeSpec이 불러온 설치 라이브러리는 그 `package.json`으로), `--style`, generator 버전, 기존 출력이 모두 그대로면 재생성을 건너뛰고(stdout 출력은 기록된 결과를 재출력) stderr에 `incremental:` 상태 한 줄을 남김. cache 위치는 `--cache-dir <dir>` (기본 `./.oa-cache`) |
| `oa-gen lint` | OpenAPI 또는 TypeSpec(.tsp)의 OA SDK lint만 빠르게 확인할 때 | `--spec <openapi\|typespec>` | diagnostic; `--categories <list>`로 surface, structure 등 특정 카테고리만 지정 실행 |
| `oa-gen validate` | OpenAPI 또는 TypeSpec(.tsp) 파싱·구조·3.1 호환 및 프로파일 요구사항을 확인할 때 | 없음 (선언적 `oa.config.ts`의 모든 프로파일 일괄 검증) 또는 `--spec <openapi\|typespec>` | human diagnostic; `--profile`로 component-bundle/operation-contract 강제, managed contract는 `--require-32` |
| `oa-gen audit:csp` | Manifest V3 브라우저 익스텐션 번들의 CSP 위반(eval, new Function, 런타임 ajv/zod/oa-sdk)을 정적 검사할 때 | `--bundle <dir>` | 0 eval, 0 runtime dependency 검증 리포트 및 non-zero exit code gate |
| `oa-gen audit:shape` | TypeScript AST 소스 또는 번들의 타입 구문 및 TypeSpec/OpenAPI 투영 적합성을 감사할 때 | `--bundle <dir>` 또는 `--source <file>` | 24개 syntax feature 분류 및 tripartite projection (direct/policy-required/unsupported) 진단 리포트; `--fail-on-unsupported`, `--json` 지원 |
| `oa-gen build-spec` | fragments와 target으로 reference OpenAPI를 만들 때 | `--target <target.yaml>` | OpenAPI와 diagnostics/provenance/metadata sidecars |
| `oa-gen normalize` | 외부 OpenAPI를 stable governance artifact로 정규화할 때 | `--spec <openapi>` | normalized artifact |
| `oa-gen upgrade` | 외부 OpenAPI 3.0/3.1을 3.2 analysis artifact로 볼 때 | `--spec <openapi>` | upgraded artifact와 optional report |
| `oa-gen collect` | raw 보존·normalize·upgrade를 한 번에 수행할 때 | `--spec`, `--normalized`, `--upgraded` | external intake artifact set; `--raw`는 원본 복사본이 필요할 때만 추가 |
| `oa-gen tsp-export` | OpenAPI를 TypeSpec spike/bundle로 변환해 볼 때 | `--spec <openapi>` | `.tsp`, report, optional sidecar/manifest; bundle manifest는 `--output`과 `--sidecar`가 함께 필요 |
| `oa-gen tsp-restore` | emitted OpenAPI에 compatibility sidecar를 다시 적용할 때 | `--spec <emitted> --sidecar <sidecar>` | restored OpenAPI와 stability report |
| `oa-gen tsp-bundle-check` | authored/generated TypeSpec bundle의 compile/restore/diff를 검사할 때 | 없음 (기본 authored fixture 사용 가능) | bundle report; 필요하면 `--project`, `--manifest`, `--sidecar`, `--expected`로 입력을 지정하고 `--fail-on-breaking`으로 expected diff gate를 켠다 |
| `oa-gen tsp-scaffold` | TypeSpec operation 및 DTO 모델 스캐폴딩을 생성·주입할 때 | `--route <path>` | TypeSpec code generation; `--method`, `--operation-id`, `--domain`, `--file`, `--output`, `--crud`, `--envelope`, `--resource` 지원 |
| `oa-gen reference-check` | Apitomy와 OA SDK 진단을 비권위적 비교로 확인할 때 | `--spec <openapi>` | markdown/JSON comparison; 계약 권위는 바꾸지 않음 |
| `oa-gen scaffold-governance` | 외부 서비스에 독립 CLI·CI baseline governance scaffold를 만들 때 | `--root <dir> --service <name>` | config/script/docs/GitHub workflow; `--profile`, `--oa-gen-command`, `--oa-gen-setup-command`, `--typegen-policy` 선택 |
| `oa-gen inventory` | OpenAPI path, operation, component, security surface를 요약할 때 | `--spec <openapi>` | markdown/JSON inventory |
| `oa-gen behavior-query` | behavior SQLite projection을 검색·집계할 때 | `--behavior-db <sqlite> --mode <mode>` | query report; mode에 따라 `--behavior-type`, identity/target/decision/recommendation selector가 필요하며 `recent` 계열은 `--status`, `--limit`을 지원한다 |
| `oa-gen duplicate-review` | Definition fragment의 duplicate identity/collision을 검토할 때 | `--fragments <dir>` | report/review/ci policy report |
| `oa-gen target-check` | target 또는 artifact가 필요한/금지 path를 만족하는지 확인할 때 | `--target <target>` 또는 `--artifact <openapi>` | assertion report; 두 source는 one-of |
| `oa-gen diff` | base/head OpenAPI의 consumer-visible 변경을 분류할 때 | `--base <openapi> --head <openapi>` | change report; 엔드포인트 및 컴포넌트 스키마 변경 분류, `--fail-on-breaking`으로 파괴적 변경 시 exit code 1 |
| `oa-gen check-artifact` | 소스 Zod AST와 저장된 OpenAPI 아티팩트 간 신선도/드리프트를 검사할 때 | 없음 (`oa.config.ts` 타겟 일괄 대조) 또는 `--head <openapi> --artifact <openapi>` | 결정론적 SHA-256 (`x-schema-engine-version-hash`) 기반 freshness decision 리포트 |
| `oa-gen drift:check` | `oa-gen check-artifact`의 전용 별칭(alias)으로 CI/CD 스펙 드리프트 게이트를 실행할 때 | 없음 (`oa.config.ts` 타겟 일괄 대조) 또는 `--head <openapi> --artifact <openapi>` | 드리프트 발생 시 non-zero (code 1) 종료하는 CI 차단 게이트 리포트 |
| `oa-gen drift:live` | 라이브 런타임 HTTP 엔드포인트 OpenAPI와 관리 스펙 간 드리프트를 검사할 때 | `--managed-openapi <spec> --runtime-openapi-url <url>` | 라이브 런타임 HTTP 엔드포인트 드리프트 리포트; `--managed-openapi`, `--runtime-openapi-url`, `--runtime-header` 지원 |
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

## oa-gen generate 옵션 및 일괄 생성 명세

`oa-gen generate`는 프로젝트의 선언적 설정(`oa.config.ts`)을 기반으로 스키마 프로젝션(OpenAPI 3.2, JSON Schema 2020-12), 순수 핸들러 계약(`*.contract.ts`), 경량 fetch 클라이언트 SDK, TanStack Query v5 훅, 독립형 무런타임 타입 가드를 일괄 생성합니다. 또한 `--spec <path.tsp>`를 통해 설정 파일 없이도 TypeSpec 스펙으로부터 전체 파이프라인을 원라인으로 즉시 생성할 수 있습니다.

핸들러 계약은 동반 패키지 `@oa-sdk/router`, 클라이언트 SDK와 TanStack Query 옵션은 `@oa-sdk/client`가 생성합니다. 설정 파일이 `core.contracts.pureHandlers: true` 또는 `core.client.enabled: true`로 명시적으로 켠 산출물의 패키지가 없으면 파일을 쓰기 전에 설치 명령을 출력하고 종료 코드 1로 실패합니다. 기본값으로만 암시된 산출물은 경고와 함께 건너뜁니다.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--config <path>` | `-c` | `string` | 자동 탐색 | 선언적 설정 파일 경로 (`oa.config.ts` 또는 `oa.config.json`) |
| `--spec <path>` | `-s` | `string` | `undefined` | TypeSpec(`.tsp`) 또는 OpenAPI 스펙 파일 경로 (지정 시 `oa.config.ts` 없이 즉시 전체 생성) |
| `--output <dir>`, `--out-dir <dir>` | `-o` | `string` | `undefined` | 산출물이 저장될 출력 디렉터리 경로 |
| `--target <target>` | | `string` | `undefined` | 특정 타겟만 단독 생성 (`standalone-guards`, `drizzle-schema`) |
| `--input <file>` | `-i` | `string` | `undefined` | 타겟 입력 스펙 파일 경로 (`--target standalone-guards` 시 입력 파일) |
| `--split` | | `boolean` | `false` | 컴포넌트/도메인별 개별 파일 분할 출력 여부 |
| `--schemas <names>` | | `string` | `undefined` | 쉼표로 구분된 특정 스키마 이름 필터 |
| `--type-import <path>` | | `string` | `undefined` | 생성된 타입 가드가 참조할 TypeScript 타입 정의 import 경로 |
| `--drizzle-schema <path>` | `-d` | `string` | `undefined` | Drizzle ORM 스키마 파일 경로 |
| `--merge-into <path>` | | `string` | `undefined` | 기존 OpenAPI 스펙 파일에 컴포넌트를 병합할 경로 |

실행 예시:

```bash
# 1. 선언적 일괄 생성 (권장: oa.config.ts의 schemaEntry에 TypeSpec .tsp 지정)
oa-gen generate

# 2. CLI 단일 라인 직접 생성 (TypeSpec 파일로부터 전체 아티팩트 즉각 일괄 빌드)
oa-gen generate --spec packages/schemas/typespec/main.tsp --output dist

# 3. 독립형 무런타임 타입 가드 생성
oa-gen generate --target standalone-guards --input packages/schemas/typespec/main.tsp --output dist/guards

# 4. 도메인별 분할 모드로 클라이언트 및 쿼리 생성
oa-gen generate --spec packages/schemas/typespec/main.tsp --output src/api --split
```

## generate:client 옵션 및 인수 명세

`oa-gen generate:client` (alias: `oa-gen client`)는 OpenAPI 3.1/3.2 명세 또는 TypeSpec(.tsp)으로부터 경량 fetch 기반의 타입 안전 클라이언트 SDK를 생성합니다. 생성기는 동반 패키지 `@oa-sdk/client`에서 불러오며, 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다(`--pack`과 `pack:client` 포함).

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--spec <path>` | `-s` | `string` | **(필수)** | OpenAPI 3.1/3.2 스펙 파일 경로 또는 TypeSpec(.tsp) 파일 경로 |
| `--output <path>` | `-o` | `string` | stdout | 산출물이 저장될 출력 파일 경로 (생략 시 표준 출력, `--pack` 시 패키지 출력 디렉터리) |
| `--types-import <path>` | | `string` | `undefined` | 생성된 TypeScript 타입 import 지정자 (예: `./types.js`) |
| `--banner` | | `boolean` | `true` | 생성 헤더 배너 주석 포함 여부 |
| `--pack` | | `boolean` | `false` | 배포 가능한 단독 0-런타임 의존성 클라이언트 SDK 패키지(`dist/`, `package.json`, `README.md`) 빌드 |
| `--name <pkgName>` | | `string` | 디렉터리명 | 패키지 명칭 (`package.json`의 `name`) |
| `--package-version <ver>` | | `string` | `0.1.0` | 패키지 버전 (`package.json`의 `version`) |
| `--description <desc>` | | `string` | `Auto-generated...` | 패키지 설명 (`package.json`의 `description`) |

실행 예시:

```bash
# 기본 클라이언트 SDK 생성 (Model A: devDependencies 로컬 소스 생성)
oa-gen generate:client --spec ./openapi.yaml --output ./src/api/client.ts

# typegen 타입 import와 연동하여 생성
oa-gen generate:client --spec ./openapi.yaml --types-import ./types.js --output ./src/api/client.ts

# 단독 패키지 빌드 (Model B: 0-런타임 의존성 dist/ 패키지)
oa-gen generate:client --spec ./openapi.yaml --pack --output ./packages/api-client --name @my-org/api-client
```

## surface 옵션 및 인수 명세

`oa-gen surface`는 OpenAPI 또는 TypeSpec artifact를 ParsedDocument IR과 Surface IR로
변환한 뒤, 현재 지원하는 Forge target의 operation projection, command catalog, command별
OpenAPI Overlay, machine-readable manifest를 생성합니다.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--spec <path>` | `-s` | `string` | **(필수)** | OpenAPI YAML/JSON 또는 TypeSpec `.tsp` 입력 경로 |
| `--target <target>` | | `string` | `forge` | 현재 지원 target: `forge` |
| `--out-dir <dir>` | `-o` | `string` | `artifacts/surface/forge` | IR, projection, Overlay, manifest 출력 디렉터리 |
| `--mapping <path>` | | `string` | `undefined` | operation group/method/lifecycle/CLI override JSON/YAML |
| `--fail-on-warning` | | `boolean` | `false` | warning diagnostic도 실패로 처리 |

```bash
oa-gen surface \
  --spec packages/schemas/dist/openapi.json \
  --target forge \
  --out-dir artifacts/surface/forge
```

생성되는 `surface-manifest.json`은 입력 artifact hash, IR version hash, operation/command
수, diagnostic 수, Overlay 경로를 기록합니다. Forge 전체 TypeScript SDK 생성은 생성된
Overlay를 Forge/Fern transformer에 전달하는 별도 downstream 단계입니다.

## generate:tanstack 옵션 및 인수 명세

`oa-gen generate:tanstack`은 OpenAPI 3.1/3.2 명세로부터 TanStack Query v5 기반의 3계층 아티팩트(Tier 1 Query Key Factory, Tier 2 Pure Options Factory, Tier 3 Composition Hooks)를 자동 생성합니다. 생성기는 동반 패키지 `@oa-sdk/client`에서 불러오며, 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다.

> ⚠️ **주의**: 과거 문서에 기재되었던 `--package`, `--client-name`, `--hooks`, `--banner` 플래그는 유효하지 않습니다. 대상 프레임워크 패키지는 `--framework <react|vue|svelte>`를 통해 지정하십시오.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--spec <path>` | `-s` | `string` | **(필수)** | OpenAPI 3.1/3.2 스펙 파일 경로 또는 TypeSpec 산출물 |
| `--output <dir>` | `-o` | `string` | `oa.config.ts`의 `outputRouting` 또는 `src/api/generated` | 산출물이 저장될 출력 디렉터리 경로 |
| `--config <path>` | `-c` | `string` | 자동 탐색 | 명시적 `oa.config.ts` 설정 파일 경로 |
| `--tier <tier>` | | `string` | `all` | 생성할 아티팩트 계층 필터: `all` (전체), `keys` (Tier 1), `options` (Tier 2), `hooks` (Tier 3) |
| `--framework <fw>` | | `string` | `react` | 대상 UI 프레임워크: `react` (`@tanstack/react-query`), `vue` (`@tanstack/vue-query`), `svelte` (`@tanstack/svelte-query`) |
| `--types-import <path>` | | `string` | `undefined` | 유선 요청/응답 타입 정의 모듈 import 지정자 |
| `--client-import <path>` | | `string` | `undefined` | 클라이언트 SDK 모듈 import 지정자 (예: `@oa-sdk/client` 또는 상대 경로) |
| `--split` | | `boolean` | `false` | 산출물을 `keys.ts`, `queries.ts`, `hooks.ts`로 개별 분할 방출 |

실행 예시:

```bash
# 기본 3계층 통합 생성 (keys + queryOptions + mutationOptions + React hooks)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api/generated

# 계층별 개별 파일 분할 생성 (keys.ts, queries.ts, hooks.ts)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api/generated --split

# Pure Options 계층만 생성 (Next.js Server Components prefetchQuery 및 Vue 호환)
oa-gen generate:tanstack --spec ./openapi.yaml --tier options --framework vue

# oa-gen generate 명령의 --tanstack 플래그를 통한 선언적 생성
oa-gen generate --tanstack --spec ./openapi.yaml --output ./src/api/generated
```

## oa-gen mock 옵션 및 실시간 핫 리로드(--watch) 명세

`oa-gen mock`은 TypeSpec(`.tsp`) 원본 또는 OpenAPI JSON/YAML 명세서로부터 중간 빌드 산출물 디스크 작성 없이 인메모리에서 즉각 구동되는 초고속 Mock HTTP 서버를 제공합니다. 서버는 동반 패키지 `@oa-sdk/mock-server`가 구동하며, 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--tsp <file>` | `-t` | `string` | `undefined` | TypeSpec 진입점 파일 경로 (`.tsp`). in-memory 컴파일을 거쳐 즉각 서빙 (`--spec`과 one-of) |
| `--spec <file>` | `-s` | `string` | `undefined` | OpenAPI JSON/YAML 파일 또는 `@oaOperation` JSDoc이 작성된 TypeScript 소스 파일 |
| `--port <port>` | `-p` | `number` | `4010` | Mock HTTP 서버가 바인딩될 리스닝 포트 |
| `--host <host>` | | `string` | `127.0.0.1` | Mock HTTP 서버 바인딩 호스트 |
| `--watch` | `-w` | `boolean` | `false` | 스펙 파일 변경 감지 및 프로세스 재시작 없는 무중단 실시간 핫 리로드 활성화 |

### 실시간 무중단 핫 리로드 3대 메커니즘
`--watch` (`-w`) 플래그가 활성화되면 다음과 같은 안정성 메커니즘이 가동됩니다:
1. **100ms 디바운싱**: IDE 멀티 파일 일괄 저장 시 발생하는 이벤트 폭주를 100ms 지연 후 1회의 원자적 컴파일로 통합 처리합니다.
2. **구문 오류 보호 (Parse Error Shielding)**: 개발자가 스펙 작성 중 일시적으로 YAML 들여쓰기 오류나 TypeSpec 문법 에러를 발생시켜도, watcher는 콘솔에 진단 에러만 출력하고 **기존 유효했던 Mock 라우트를 그대로 유지**합니다. 서버 프로세스가 죽거나 소켓이 끊어지지 않습니다.
3. **인메모리 원자적 라우트 스왑 (`server.updateSpec`)**: 스펙 수정이 성공하면 활성 TCP keep-alive 소켓을 닫지 않고 인메모리 라우트 디스패치 테이블만 즉각 교체합니다.

실행 예시:
```bash
# TypeSpec 스펙 기반 실시간 핫 리로드 Mock 구동
oa-gen mock --tsp packages/schemas/typespec/main.tsp --watch --port 4010

# OpenAPI YAML 스펙 기반 Mock 구동
oa-gen mock --spec ./openapi.yaml --watch
```

## oa-gen init 옵션 및 아키타입/라우팅 프리셋 명세

`oa-gen init`은 프로젝트의 프레임워크와 성숙도에 맞는 선언적 설정(`oa.config.ts`)을 생성하고, `package.json`의 개발 스크립트를 비파괴적으로 보강하는 온보딩 엔진입니다.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--target <fw>` | `-t` | `string` | 자동 감지 | 대상 웹 프레임워크: `fastify`, `elysia`, `hono`, `express`, `nestjs`, `generic` |
| `--archetype <arch>` | `-a` | `string` | `mvp` | 제품 생애주기 거버넌스 아키타입: `mvp`, `microservice`, `enterprise` |
| `--routing <preset>` | `-r` | `string` | `default` | 산출물 경로 라우팅 프리셋: `default`, `fsd`, `monorepo`, `by-kind` |
| `--cwd <dir>` | | `string` | 현재 작업 디렉터리 | 대상 프로젝트 루트 디렉터리 경로 |
| `--spec <path>` | `-s` | `string` | 자동 탐색 | OpenAPI 또는 TypeSpec 스펙 파일 진입점 경로 |
| `--yes` | `-y` | `boolean` | `false` | 대화형 프롬프트를 건너뛰고 기본값으로 자동 승인 |
| `--force` | `-f` | `boolean` | `false` | 기존 `oa.config.ts` 및 충돌하는 스크립트 강제 덮어쓰기 |
| `--dry-run` | | `boolean` | `false` | 디스크에 파일을 쓰지 않고 계획된 변경 사항만 미리보기 |

### 3대 라이프사이클 아키타입 (`--archetype`)
- **`mvp`**: 빠른 프로토타이핑. `driftCheck: false`, `failOnBreaking: false`, `preflightLint: "warn"`, 와이어 안전성 완화.
- **`microservice`**: 프로덕션 마이크로서비스 안정성. `driftCheck: true`, `failOnBreaking: false`, `preflightLint: "error"`, `wireFormatSafety: true`, `jitSchema: true`, `zeroCopy: true`.
- **`enterprise`**: 다수 팀 협업 및 무관용 거버넌스. `driftCheck: true`, `failOnBreaking: true` (`baseRef: "origin/main"`), `preflightLint: "error"`, `personas.enforceCoverage: true`.

### 4대 산출물 라우팅 프리셋 (`--routing`)
- **`default`**: `src/api/{tag}/{tag}.{kind}.ts` 단일 API 폴더 표준 구성.
- **`fsd`**: Feature-Sliced Design. `src/features/{tag}/api/{tag}.{kind}.ts` 및 공통 모듈 `src/shared/api/` 분산 라우팅.
- **`monorepo`**: 다중 패키지 분산. `packages/contracts/`, `packages/client-sdk/`, `apps/web/src/api/` 다중 투영.
- **`by-kind`**: 아티팩트 종류별 폴더 격리. `src/contracts/`, `src/client/`, `src/queries/`, `src/keys/`.

실행 예시:
```bash
# Fastify 마이크로서비스 + FSD 라우팅으로 논스톱 초기화
oa-gen init --target fastify --archetype microservice --routing fsd --yes

# 변경 사항 미리보기 (Dry-run)
oa-gen init --dry-run
```

## oa-gen tsp-scaffold 옵션 및 CRUD/엔벨롭 명세

`oa-gen tsp-scaffold`는 OpenAPI 3.2 및 TypeSpec 컨벤션에 맞는 HTTP Operation과 DTO 모델 코드를 자동 생성하여 파일에 주입하거나 stdout으로 출력합니다. 공백 구분(`oa-gen tsp scaffold`)과 케밥케이스(`oa-gen tsp-scaffold`)를 모두 지원합니다.

| 옵션 | 단축 | 타입 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- | --- | --- |
| `--route <path>` | `-r` | `string` | **Y** | - | 엔드포인트 HTTP 라우트 경로 (예: `/users/{id}/audit`) |
| `--method <method>` | `-m` | `string` | N | `get` | HTTP 메서드 (`get`, `post`, `put`, `patch`, `delete`) |
| `--operation-id <id>` | | `string` | N | 자동 생성 | 고유 operationId (기본: route와 method로부터 자동 유추) |
| `--domain <domain>` | `-d` | `string` | N | 자동 유추 | 도메인/태그 이름 (기본: route 첫 번째 세그먼트) |
| `--summary <text>` | | `string` | N | - | Operation summary 설명 |
| `--auth <scheme>` | | `string` | N | `bearerAuth` | 인증 데코레이터 (`bearerAuth`, 비활성화 시 `none`) |
| `--crud` | | `boolean` | N | `false` | 리소스 전체 CRUD 엔드포인트 5종 및 요청/응답 DTO 일괄 생성 |
| `--envelope` | | `boolean` | N | `false` | 표준 제네릭 래퍼(`Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`) 적용 |
| `--resource <name>` | | `string` | N | 자동 유추 | CRUD 대상 리소스 이름 (기본: 라우트 경로로부터 유추) |
| `--file <path>` | `-f` | `string` | N | - | 생성된 코드를 기존 `.tsp` 파일 끝에 자동으로 추가 주입 |
| `--output <path>` | `-o` | `string` | N | - | 출력 파일 경로 (`-` 지정 시 stdout 출력) |

실행 예시:
```bash
# CRUD 5종 + 제네릭 엔벨롭 표준 스펙 생성 후 파일 주입
oa-gen tsp-scaffold --route /orders --crud --envelope --file packages/schemas/typespec/orders.tsp

# 단일 POST 엔드포인트 생성
oa-gen tsp-scaffold --route /articles --method post --operation-id createArticle
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
