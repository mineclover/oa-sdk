# oa-gen CLI 명령 레퍼런스

`oa-gen`은 OpenAPI artifact 생성, TypeSpec roundtrip, 타입 생성, 외부 서비스
governance, 변경 검토를 한 CLI에 모은다. 이 문서는 현재 구현된 기능 명령의 단일 색인이다.
옵션의 정확한 형식은 항상 `oa-gen <command> --help`가 정본이다.

저장소에서 직접 실행할 때는 먼저 CLI를 빌드한다.

```bash
pnpm --filter @oa-sdk/codegen build
node packages/codegen/dist/cli/index.js --help
```

저장소 루트에서는 `oa-gen`이 PATH에 없다(`pnpm exec oa-gen`도 찾지 못한다). 공개 package consumer는
`npx oa-gen <command>`를 사용한다. 아래 예시의 `oa-gen`은 외부 프로젝트에서는 `npx oa-gen`, 저장소에서는
`node packages/codegen/dist/cli/index.js`로 읽는다. 아래의 `입력`은 최소 시작점이며, `--help`는 모든 선택
옵션과 조건부 옵션을 보여 준다. 이 문서의 동작은 `@oa-sdk/codegen` 0.9.0 기준이다.

`generate:client`, `pack:client`, `generate:tanstack`, `mock`, 그리고 `oa-gen generate`의 핸들러
계약·클라이언트 산출물은 `@oa-sdk/codegen`에 포함되지 않은 동반 패키지(`@oa-sdk/router`,
`@oa-sdk/client`, `@oa-sdk/mock-server`)가 생성한다. 명령별 필요 패키지, 설치 방법, 패키지가
없을 때의 동작은 [동반 패키지 안내](./cli-setup.md#동반-패키지-companion-packages)를 따른다. 어떤
`oa-gen` 명령도 Fastify·Express·Hono·Elysia 라우터 파일을 만들지 않는다. 라우터 코드가 필요하면
빌드 스크립트에서 `@oa-sdk/router`의 `generateRouter()`를 호출한다.

## 먼저 목적을 고르기

| 목적 | 시작 명령 | 다음 문서 |
| --- | --- | --- |
| production TypeSpec 계약을 수정·승인 | `pnpm schema:approve-typespec-reference`, `pnpm schema:validate` | [기여자 온보딩](./onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩), [TypeSpec 규칙](./typespec-authoring-conventions.md) |
| 모노레포 선언적 스펙 및 거버넌스 설정 | `oa-gen validate`, `oa-gen generate` | [선언적 스펙 설정](./declarative-spec-configuration.md), [스키마 아키텍처 규칙](./schema-architecture-and-conventions.md) |
| 기존 OpenAPI에서 공개 TypeScript 타입을 생성 | `oa-gen typegen` | [Quick Start](./quick-start.md) |
| OpenAPI 3.1/3.2 스펙에서 타입 안전 fetch 클라이언트 SDK 생성 | `oa-gen generate:client` | [Quick Start](./quick-start.md) |
| OpenAPI 3.2 스펙에서 Zod 4 스키마 및 타입 생성 | `oa-gen generate:zod` | [Quick Start](./quick-start.md) |
| OpenAPI 3.1/3.2 스펙에서 TanStack Query v5 3계층 옵션/키 생성 | `oa-gen generate:tanstack` | [Quick Start](./quick-start.md), [프론트엔드 SDK 및 쿼리 소비](./client-and-query-consumption.md) |
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
| `oa-gen init` | 타겟 분리형 온보딩 엔진으로 `oa.config.ts` 및 런타임 스크립트를 구성할 때 | 없음 (자동 감지) 또는 `--target <framework>` | 대화형/헤드리스 온보딩, `oa.config.ts` 생성 및 `package.json` 비파괴적 패치(추가하는 `oa-gen` 스크립트는 모두 그대로 실행됨. 프레임워크 대상의 개발 서버·빌드 스크립트는 직접 작성한 서버 코드가 있어야 실행됨), `enterprise`는 계약 기준선 `openapi.baseline.yaml`도 생성; `--target` (`-t`), `--archetype <mvp|microservice|enterprise>` (`-a`), `--routing <default|fsd|monorepo|by-kind>` (`-r`), `--cwd`, `--spec` (`-s`), `--yes` (`-y`), `--force` (`-f`), `--dry-run` 지원 |
| `oa-gen generate:client` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp) 스펙에서 타입 안전 fetch 클라이언트 SDK를 생성할 때 | `--spec <openapi\|typespec>` | fetch 클라이언트 SDK 산출물; `--spec` (`-s`), `--output <path>` (`-o`), `--types-import <path>`, `--banner`, 배포용 패키지 빌드 `--pack` (`--name`, `--package-version`, `--description`) 지원. `oa-gen client`는 별칭이고, `oa-gen pack:client`는 `generate:client --pack`과 같다(`oa-gen --help` 목록에는 표시되지 않음) |
| `oa-gen generate:zod` | OpenAPI 3.2 또는 TypeSpec(.tsp) 스펙에서 Zod 4 스키마 및 TypeScript 타입을 생성할 때 | `--spec <openapi\|typespec>` | Zod 4 스키마 정의 및 TypeScript 타입 생성; `--output <path>`로 파일/디렉터리 지정, `--style <schema\|both>`, 사전 검증 `--validate`/`--no-validate`(기본 켬), `--lint`, `--categories <list>`, 정규화 `--normalize`/`--no-normalize`(기본 켬), 검증 오류를 무시하는 `--force` 지원. 런타임 검증기는 CLI가 아니라 `@oa-sdk/codegen/zodgen`의 `createRuntimeZodValidators()` API로 만든다 |
| `oa-gen generate:tanstack` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp) 스펙에서 TanStack Query v5 3계층(Query Key Factory, Options Factory, Hooks) 코드를 생성할 때 | `--spec <openapi\|typespec>` | TanStack Query v5 산출물 (keys, options, hooks); `--spec` (`-s`), `--output <dir>` (`-o`), `--config <path>` (`-c`), `--tier <all\|keys\|options\|hooks>`, `--framework <react\|vue\|svelte>`, `--client-import <path>`, `--types-import <path>`, `--split` 지원 |
| `oa-gen surface` | OpenAPI 또는 TypeSpec artifact를 target-neutral Surface IR과 Forge projection/Overlay로 변환할 때 | `--spec <openapi\|typespec>` | `surface-ir.json`, `forge-projection.json`, command별 Overlay, `surface-manifest.json`; `--target forge`, `--out-dir`, `--mapping`, `--fail-on-warning` 지원 |
| `oa-gen generate:guards` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp)으로부터 독립형 무런타임 타입 가드를 생성할 때 | `--input <file>` | 독립형 무런타임 타입 가드(Standalone Type Guards) 산출물; `--input` (`-i`), `--out-dir` (`-o`), `--type-import`, `--module-format`, `--split`, `--schemas` 지원 |
| `oa-gen generate:drizzle` | Drizzle ORM 스키마 파일로부터 OpenAPI 3.2 스키마 컴포넌트를 생성할 때 | `--drizzle-schema <path>` | Drizzle ORM 스키마 기반 OpenAPI 3.2 컴포넌트 산출물; `--drizzle-schema` (`-d`), `--output` (`-o`), `--merge-into`, `--schemas` 지원 |
| `oa-gen mock` | TypeSpec, OpenAPI 또는 TypeScript 소스에서 제로 빌드 즉각 목 서버를 구동할 때 | `--tsp <file>` 또는 `--spec <path>`, 둘 다 없으면 `oa.config.ts`의 spec target(하나일 때) | 인메모리 OpenAPI 3.2 Mock HTTP 서버 구동 (기본 포트 4010); `--tsp` (`-t`), `--spec` (`-s`), `--port <port>` (`-p`), `--host <host>`, `--watch` (`-w`)로 100ms 디바운스, 에러 쉴딩, 원자적 인메모리 라우트 핫스왑, `--stateful`로 인메모리 CRUD 저장소 지원 |
| `oa-gen tsp diff` | TypeSpec AST 간 시맨틱 차이점 및 파괴적 변경(breaking change)을 분석할 때 | `--base <source> --head <source>`. 양쪽 모두 `.tsp` 파일, 디렉터리, git ref, `<ref>:<path>` | TypeSpec AST 시맨틱 비교 리포트. 선택 속성 추가는 non-breaking, 필수 속성 추가는 breaking으로 구분; `--fail-on-breaking`으로 파괴적 변경 감지 시 exit code 1, `--format <markdown\|json>` 지원. git ref는 `git archive`로 그 커밋을 꺼내므로 작업 트리를 보지 않는다. 커밋 전 변경(작업 트리, CI checkout)은 `--base <ref>:<path> --head <path>`, 두 커밋은 `--base <ref>:<path> --head <ref>:<path>` 또는 `--base origin/main --head HEAD`로 비교. 경로 없는 git ref는 상대편 진입점과 같은 저장소 루트 기준 경로를 자기 커밋에서 읽는다(양쪽 다 경로가 없으면 base가 관례 위치나 하나뿐인 `main.tsp`로 찾은 진입점). 진입점을 하나로 정할 수 없으면(그 경로가 커밋에 없거나 `main.tsp` 후보가 여럿) 추측하지 않고 `<ref>:<path>`를 달라는 오류로 끝난다([옵션 상세](./typespec/04-scaffolding-and-diff.md#21-옵션)). 두 쪽이 같은 커밋의 같은 진입점이면(`--base HEAD --head HEAD`) stderr에 자기 자신과 비교한다는 안내를 출력한다 |
| `oa-gen generate` | TypeSpec, OpenAPI, config, Drizzle에서 스키마, 계약, 클라이언트, 가드를 일괄 생성할 때 | 없음 (선언적 `oa.config.ts` 자동 로드) 또는 `--spec <openapi\|typespec>`, `--config <file>`, `--drizzle-schema <path>`, `--target standalone-guards --input <file>` | OpenAPI 문서, 핸들러 계약(`*.contract.ts`), 클라이언트 SDK, TanStack Query 키·옵션, 가드 일괄 산출물(라우터 파일은 만들지 않음); `--spec` (`-s`), `--output` (`-o`), `--out-dir`, `--config` (`-c`), `--target standalone-guards`, `--input` (`-i`), `--drizzle-schema` (`-d`), `--merge-into`, `--split`(가드 모듈 분할) 지원. 자세한 옵션은 아래 generate 절 |
| `oa-gen typegen` | OpenAPI 또는 TypeSpec(.tsp)에서 TypeScript 선언을 만들 때 | `--spec <openapi\|typespec>` | type declarations; `--incremental`은 같은 spec·출력 대상의 입력(spec과 외부 `$ref` 파일 내용, TypeSpec 컴파일러가 읽은 모든 파일과 import 해석 중 확인한 경로·symlink 대상, TypeSpec이 불러온 JS decorator의 모듈 그래프: 직접 작성한 모듈은 내용·import 해석으로, 설치 패키지는 그 `package.json`과 그 패키지가 다른 패키지를 찾은 경로로, 실패한 import(선택적 `import()`·`require()`)는 Node가 확인한 후보 경로로), `--style`, generator 버전, 기존 출력이 모두 그대로면 재생성을 건너뛰고(stdout 출력은 기록된 결과를 재출력) stderr에 `incremental:` 상태 한 줄을 남김. 생성 중 바뀌었을 수 있거나 다시 확인할 수 없는 입력은 다음 실행에서 다시 생성(`input not verified: <path> (<reason>)`; Node.js 22.15 미만에서는 직접 작성한 JS decorator가 있으면 매번 다시 생성). decorator 코드가 스스로 읽는 파일은 추적하지 않음. cache 위치는 `--cache-dir <dir>` (기본 `./.oa-cache`) |
| `oa-gen lint` | OpenAPI 또는 TypeSpec(.tsp)의 OA SDK lint만 빠르게 확인할 때 | `--spec <openapi\|typespec>` | diagnostic; `--categories <list>`로 surface, structure 등 특정 카테고리만 지정 실행 |
| `oa-gen validate` | OpenAPI 또는 TypeSpec(.tsp) 파싱·구조·3.1 호환 및 프로파일 요구사항을 확인할 때 | 없음 (선언적 `oa.config.ts`의 모든 프로파일 일괄 검증) 또는 `--spec <openapi\|typespec>` | human diagnostic; `--profile <component-bundle\|operation-contract\|full-api-document>`로 프로파일 강제, managed contract는 `--require-32`, `--config` (`-c`)로 설정 파일 지정. `--incremental`(`--cache-dir`, 기본 `./.oa-cache`)은 진단을 SQLite workspace index에 기록할 뿐 검증을 건너뛰지 않음 |
| `oa-gen audit:csp` | Manifest V3 브라우저 익스텐션 번들의 CSP 위반(eval, new Function, 런타임 ajv/zod/oa-sdk)을 정적 검사할 때 | `--bundle <dir>` | 0 eval, 0 runtime dependency 검증 리포트 및 non-zero exit code gate |
| `oa-gen audit:shape` | TypeScript AST 소스 또는 번들의 타입 구문 및 TypeSpec/OpenAPI 투영 적합성을 감사할 때 | `--bundle <dir>` 또는 `--source <file>` | 24개 syntax feature 분류 및 tripartite projection (direct/policy-required/unsupported) 진단 리포트; `--fail-on-unsupported`, `--json` 지원 |
| `oa-gen build-spec` | fragments와 target으로 reference OpenAPI를 만들 때 | `--target <target.yaml>` | OpenAPI와 diagnostics/provenance/metadata sidecars |
| `oa-gen normalize` | 외부 OpenAPI나 TypeSpec 스펙을 stable governance artifact로 정규화할 때 | `--spec <openapi\|tsp>` | normalized artifact(OpenAPI YAML, 키 정렬). 다른 파일을 가리키는 `$ref`는 그 내용을 복사해 넣어 어디에 써도 홀로 뜻이 같은 한 문서로 만든다(URL `$ref`는 그대로 둠). `$ref` 옆에 쓴 필드는 그 위치의 객체에서 갖는 뜻대로 남는다: Path Item `$ref` 옆 필드(`parameters` 등)는 경로 항목의 필드이므로 복사본에 합치고(`oa-gen generate`가 읽는 문서와 같음), 스키마의 `$ref` 옆 키워드는 `allOf`로 함께 적용하며, 그 밖의 Reference Object(파라미터, 응답 등)는 대상 객체에 있는 `summary`·`description`만 반영하고 나머지 필드는 OpenAPI 명세대로 무시한다. OpenAPI 3.0·Swagger 2.0에서는 Path Item 밖의 `$ref` 옆 필드를 모두 무시한다. TypeSpec(`.tsp`)은 메모리에서 OpenAPI 3.2로 컴파일한 문서 |
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
| `oa-gen diff` | base/head OpenAPI의 consumer-visible 변경을 분류할 때 | `--base <openapi> --head <openapi>` | change report; 엔드포인트 및 컴포넌트 스키마 변경 분류, `--fail-on-breaking`으로 파괴적 변경 시 exit code 1. 입력은 OpenAPI YAML/JSON 또는 TypeSpec(`.tsp`, 메모리에서 OpenAPI 3.2로 컴파일) 파일 경로이며 git ref는 받지 않는다. 여러 파일로 나뉜 스펙은 `$ref`가 가리키는 파일의 내용까지 `oa-gen normalize`와 같은 방식으로 복사해 비교하므로 그 파일의 변경도 판정한다(읽을 수 없는 `$ref` 파일이 있으면 실패). `paths` 항목이 `$ref`로 `#/components/pathItems/...`를 가리키면 그 경로 항목의 operation을 비교한다. 요청·응답·파라미터 스키마가 바뀌면 선택 필드 추가도 breaking으로 판정하는 보수적 규칙이므로 `--fail-on-breaking`을 CI에 걸면 호환 변경에서도 실패할 수 있다 |
| `oa-gen check-artifact` | 원본에서 다시 만든 OpenAPI 문서와 저장된 생성물이 같은지 확인할 때 | 없음 (`oa.config.ts` 타겟의 `<id>.openapi.json` 일괄 대조) 또는 `--head <openapi> --artifact <openapi>` | 결정론적 SHA-256 (`x-schema-engine-version-hash`) 기반 freshness decision 리포트, 어긋나면 exit code 1. 생성된 TypeScript 파일은 비교하지 않는다 |
| `oa-gen drift:check` | `oa-gen check-artifact`의 전용 별칭(alias)으로 CI/CD 스펙 드리프트 게이트를 실행할 때 | 없음 (`oa.config.ts` 타겟 일괄 대조) 또는 `--head <openapi> --artifact <openapi>` | 드리프트 발생 시 non-zero (code 1) 종료하는 CI 차단 게이트 리포트 |
| `oa-gen drift:live` | 라이브 런타임 HTTP 엔드포인트 OpenAPI와 관리 스펙 간 드리프트를 검사할 때 | `--managed-openapi <spec> --runtime-openapi-url <url>` | 라이브 런타임 HTTP 엔드포인트 드리프트 리포트; `--managed-openapi`, `--runtime-openapi-url`, `--runtime-header` 지원. `oa-gen drift`와 같은 명령이다 |
| `oa-gen drift` | runtime OpenAPI와 managed OpenAPI를 비교할 때 | `--managed-openapi` + `--runtime-openapi` 또는 URL | drift report; drift가 있으면 exit code 1. runtime source는 one-of이며 URL 인증 header는 반복 가능한 `--runtime-header "Name: value"`로 전달. `--managed-openapi`와 `--runtime-openapi`는 상대 경로와 절대 경로를 모두 받는다. 상대 경로는 프로젝트 루트(`--root`, 미지정 시 자동 감지) 기준으로 해석하고, JSON 리포트와 behavior 기록(`--behavior-log`, `--behavior-db`)에는 절대 경로로 남긴다 |
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

`oa-gen generate`는 프로젝트의 선언적 설정(`oa.config.ts`)을 기반으로 OpenAPI 문서와 JSON Schema 2020-12(`<id>.openapi.json`, `<id>.schema.json`), 핸들러 계약(`*.contract.ts`), fetch 클라이언트 SDK, TanStack Query 키·옵션, 설정의 `guards`에 선언한 독립형 타입 가드를 일괄 생성합니다. `--spec <path>`를 주면 설정 파일 없이 그 스펙 하나로 같은 파이프라인을 실행하고 결과를 `--out-dir`/`--output`(기본 `./dist`)에 씁니다.

핸들러 계약은 동반 패키지 `@oa-sdk/router`, 클라이언트 SDK와 TanStack Query 옵션은 `@oa-sdk/client`가 생성합니다. 설정 파일이 `core.contracts.pureHandlers: true` 또는 `core.client.enabled: true`로 명시적으로 켠 산출물의 패키지가 없으면 파일을 쓰기 전에 설치 명령을 출력하고 종료 코드 1로 실패합니다. 패키지가 있어도 명시적으로 켠 산출물을 만드는 중 오류가 나면 그 오류를 출력하고, 어떤 파일도 쓰지 않은 채(`.oa-manifest.json` 포함) 종료 코드 1로 실패합니다. 기본값으로만 암시된 산출물은 패키지가 없거나 생성 중 오류가 나면 경고와 함께 그 산출물만 건너뛰고, 이전 실행이 만든 해당 파일은 유지합니다([판정 기준](./declarative-spec-configuration.md#명시적-요청과-암시적-기본값-동반-패키지)).

스펙이 여러 파일로 나뉘어 `$ref`가 다른 파일(`./schemas.yaml#/Health`, `./paths/user.yaml` 등)을 가리키면, 계약·클라이언트·TanStack 생성기에 넘기기 전에 그 `$ref`를 스펙 파일(`schemaEntry`)의 위치에서 풉니다. 없는 파일을 가리키거나 서로만 가리키는 `$ref`처럼 풀 수 없는 `$ref`는 위의 생성 오류가 되며, 오류는 그 `$ref`와 진단 코드를 출력합니다(예: `external-ref-read-failed (./missing.yaml#/Health)`, `ref-cycle (./a.yaml#/A)`). `<id>.openapi.json`과 `<id>.schema.json`에는 `$ref`가 스펙에 쓴 그대로(스펙 파일 기준 상대 경로) 남습니다.

`oa-gen generate`가 서버 쪽에 만드는 것은 핸들러 계약뿐이며 프레임워크 라우터 파일은 만들지 않습니다. 생성된 계약과 클라이언트의 요청·응답 타입은 `unknown`입니다. 실행이 끝나면 `.oa-manifest.json`에 기록된 생성 파일 가운데 이번 실행이 소유한 파일(같은 설정 파일로 실행한 `oa-gen generate`가 기록한 파일, `--spec` 실행이면 이전 `--spec` 실행이 같은 스펙 파일로 기록한 파일) 중 이번 실행이 만들지 않고 내용도 바뀌지 않은 파일을 지웁니다. `oa-gen generate:tanstack` 등 다른 명령이 기록한 파일과 다른 설정 파일이나 다른 스펙 파일(파일 이름이 같아도 경로가 다르면 다른 파일)의 실행이 기록한 파일은 지우지 않으며, `outputRouting.pruneOrphans: false`면 아무 파일도 지우지 않습니다([판정 규칙](./declarative-spec-configuration.md#45-생성-파일-정리)). 요약 출력의 `N ops`는 spec target의 operation 수(`query`와 `additionalOperations` 포함, webhook 제외), `<id>.openapi.json` 줄은 파일의 `openapi` 필드 버전(예: `OpenAPI 3.2.0`), `Artifacts Pruned`는 지운 파일입니다.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--config <path>` | `-c` | `string` | 자동 탐색 | 선언적 설정 파일 경로. 자동 탐색은 `oa.config.ts`, `oa.config.mjs`, `oa.config.json`, `.oarc.json` 순서 |
| `--spec <path>` | `-s` | `string` | `undefined` | TypeSpec(`.tsp`) 또는 OpenAPI 스펙 파일 경로 (지정 시 설정 파일 없이 그 스펙으로 생성) |
| `--out-dir <dir>` | | `string` | `./dist`(`--spec` 실행), `.`(standalone guard) | `--spec` 실행과 standalone guard 생성의 출력 디렉터리 |
| `--output <dir>` | `-o` | `string` | `--out-dir`과 같음 | `--out-dir`이 없을 때 쓰는 출력 디렉터리. Drizzle 생성에서는 출력 경로 |
| `--target <target>` | | `string` | `undefined` | `standalone-guards`만 인식합니다. 그 밖의 값은 무시되고 전체 `generate`와 같이 실행됩니다 |
| `--input <file>` | `-i` | `string` | `undefined` | `--target standalone-guards`의 입력 스펙 파일 경로 |
| `--split` | | `boolean` | `false` | standalone guard를 타입별 모듈(`guards/<TypeName>.js`)로 분할 |
| `--schemas <names>` | | `string` | `undefined` | 생성 대상 필터 (Drizzle: `select,insert,update` / 가드: 컴포넌트·가드 이름 목록) |
| `--type-import <path>` | | `string` | `undefined` | 생성된 타입 가드가 참조할 TypeScript 타입 import 지정자 |
| `--module-format <format>` | | `string` | `esm` | standalone guard 모듈 포맷 |
| `--drizzle-schema <path>` | `-d` | `string` | `undefined` | Drizzle ORM 스키마 파일 경로 |
| `--merge-into <path>` | | `string` | `undefined` | 기존 OpenAPI 스펙 파일에 Drizzle 컴포넌트를 병합할 경로 |
| `--tanstack` | | `boolean` | `false` | 사용 중단된 별칭. `oa-gen generate:tanstack`을 실행하며 `--tier`, `--framework`, `--types-import`, `--client-import`는 이 경로에서만 쓰입니다 |

실행 예시:

```bash
# 1. 선언적 일괄 생성 (oa.config.ts의 spec target 사용)
oa-gen generate

# 2. 설정 파일 없이 스펙 하나로 생성 (OpenAPI 또는 .tsp)
oa-gen generate --spec ./openapi.yaml --out-dir dist

# 3. 독립형 무런타임 타입 가드 생성
oa-gen generate --target standalone-guards --input ./openapi.yaml --out-dir src/guards
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
  --spec ./openapi.yaml \
  --target forge \
  --out-dir artifacts/surface/forge
```

이 저장소에서는 production artifact(`packages/schemas/dist/openapi.json`)를 `--spec`에 넘긴다.

생성되는 `surface-manifest.json`은 입력 artifact hash, IR version hash, operation/command
수, diagnostic 수, Overlay 경로를 기록합니다. Forge 전체 TypeScript SDK 생성은 생성된
Overlay를 Forge/Fern transformer에 전달하는 별도 downstream 단계입니다.

## generate:tanstack 옵션 및 인수 명세

`oa-gen generate:tanstack`은 OpenAPI 3.1/3.2 명세로부터 TanStack Query v5 기반의 3계층 아티팩트(Tier 1 Query Key Factory, Tier 2 Pure Options Factory, Tier 3 Composition Hooks)를 자동 생성합니다. 생성기는 동반 패키지 `@oa-sdk/client`에서 불러오며, 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다. `oa-gen generate:client`처럼 다른 파일을 가리키는 `$ref`는 스펙 파일의 위치에서 풀고, 풀 수 없는 `$ref`가 있으면 그 `$ref`를 출력하고 종료 코드 1로 실패합니다.

> ⚠️ **주의**: 과거 문서에 기재되었던 `--package`, `--client-name`, `--hooks`, `--banner` 플래그는 유효하지 않습니다. 대상 프레임워크 패키지는 `--framework <react|vue|svelte>`로 지정합니다. `vue`·`svelte` 출력은 현재 컴파일되지 않습니다(아래 알려진 제한).

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--spec <path>` | `-s` | `string` | **(필수)** | OpenAPI 3.1/3.2 스펙 파일 경로 또는 TypeSpec 산출물 |
| `--output <dir>` | `-o` | `string` | `oa.config.ts`의 `outputRouting` 또는 `src/api/generated` | 산출물이 저장될 출력 디렉터리 경로. `--split` 없이 `.ts`로 끝나는 경로를 주면 그 파일에 씁니다 |
| `--config <path>` | `-c` | `string` | 자동 탐색 | 명시적 `oa.config.ts` 설정 파일 경로 |
| `--tier <tier>` | | `string` | `all` | 생성할 아티팩트 계층 필터: `all` (전체), `keys` (Tier 1), `options` (Tier 2), `hooks` (Tier 3) |
| `--framework <fw>` | | `string` | `react` | 대상 UI 프레임워크: `react` (`@tanstack/react-query`), `vue` (`@tanstack/vue-query`), `svelte` (`@tanstack/svelte-query`) |
| `--types-import <path>` | | `string` | `undefined` | 유선 요청/응답 타입 정의 모듈 import 지정자 |
| `--client-import <path>` | | `string` | `undefined` | 클라이언트 SDK 모듈 import 지정자 (예: `@oa-sdk/client` 또는 상대 경로) |
| `--split` | | `boolean` | `false` | 산출물을 `keys.ts`, `queries.ts`, `hooks.ts`로 개별 분할 방출 |

`--output` 디렉터리에는 기본으로 키·옵션·훅을 모두 담은 `tanstack-query.ts` 한 파일을 씁니다. 이 파일이 import하는 생성 파일은 같은 디렉터리의 `./client.js`(`oa-gen generate:client`로 생성)뿐이고, 훅을 담으므로 첫머리에 `'use client'` 지시문이 있습니다. `--split`은 `keys.ts`, `queries.ts`(옵션, `'use client'` 없음), `hooks.ts`(`'use client'`)를 쓰고, `queries.ts`와 `hooks.ts`는 `./client.js`와 앞 계층 파일(`./keys.js`, `./queries.js`)을 import합니다. Next.js Server Component처럼 `'use client'` 모듈을 import할 수 없는 곳에서는 `--split`의 `queries.ts`를 쓰고, `oa-gen generate`를 쓰는 프로젝트는 `generate`가 만드는 `<id>.queries.ts`를 씁니다. `--framework vue|svelte`는 훅 없이 키와 옵션만 쓰지만, 이 출력은 현재 컴파일되지 않습니다(아래 알려진 제한). 이름 규칙은 키 `<tag>Keys`(예: `usersKeys`), 옵션 `<operationId>QueryOptions`·`<operationId>MutationOptions`, 훅 `use<OperationId>Query`·`use<OperationId>Mutation`, 그리고 `createApiHooks`입니다. 옵션 팩토리와 훅은 첫 인자로 `createClient()`가 만든 클라이언트를 받습니다.

알려진 제한:

- `--tier options`와 `--tier hooks`는 그 계층의 코드만 쓰고, 그 코드가 import하는 다른 계층 파일은 쓰지 않습니다. `--tier options` 출력은 `./keys.js`를, `--tier hooks` 출력은 `./keys.js`와 `./queries.js`를 import하므로 단독으로 생성하면 `tsc`가 `Cannot find module './keys.js'`(TS2307)로 실패합니다. `--split`과 함께 줘도 해당 파일 하나만 쓰므로 같습니다. 옵션만 담은 파일이 필요하면 `--tier` 없이 `--split`을 씁니다(outputRouting이 없는 프로젝트). `--tier keys` 출력은 이 명령의 다른 출력을 import하지 않습니다.
- `--framework vue|svelte` 출력은 대상 패키지에 없는 export를 import하므로 `tsc`가 실패합니다(TS2724, 알려진 결함). `vue`는 `@tanstack/vue-query`에 없는 `UndefinedInitialDataOptions`(vue-query의 이름은 `UndefinedInitialQueryOptions`)를, `svelte`는 `@tanstack/svelte-query`에 없는 `UseMutationOptions`(5.x에서는 `mutationOptions`도)를 import합니다. Vue·Svelte에서는 import가 없는 키 팩토리(`--tier keys` 출력 또는 `oa-gen generate`의 `<id>.keys.ts`)와 `oa-gen generate:client` 클라이언트를 쓰고, 옵션은 각 패키지의 `queryOptions()`로 작성합니다.
  ```ts
  // oa-gen generate:tanstack --spec ./openapi.yaml -o ./src/api/keys.ts --tier keys
  // oa-gen generate:client --spec ./openapi.yaml -o ./src/api/client.ts
  import { queryOptions } from '@tanstack/vue-query' // Svelte: '@tanstack/svelte-query'
  import { createClient } from './client.js'
  import { usersKeys } from './keys.js'

  const client = createClient({ baseUrl: '/api' })

  export const getUserQuery = (userId: string) =>
    queryOptions({
      queryKey: usersKeys.getUser({ userId }),
      queryFn: ({ signal }) => client.getUser({ userId }, { signal }),
    })
  ```
- `--types-import`에 `oa-gen typegen` 출력만 넘기면 `<Operation>ClientError` 타입이 없어 `tsc`가 실패합니다(TS2305, 알려진 결함). 타입 없이 쓰려면 클라이언트와 TanStack 모두 `--types-import` 없이 생성합니다. 타입이 필요하면 typegen 출력을 다시 export하고 `<Operation>ClientError` 별칭을 더한 모듈을 `--types-import`로 지정합니다. 클라이언트에만 `--types-import`를 주고 TanStack에는 주지 않아도 `tsc`가 실패하므로(TS2345), 클라이언트에는 typegen 출력을, TanStack에는 다음 모듈을 함께 넘깁니다(아래 실행 예시, `--split`과도 동작). `oa-gen generate`의 `<id>.queries.ts`는 `ApiClient` 타입을 `<id>.client.ts`에서 가져오므로, 타입이 있는 클라이언트를 넘겨도 응답 타입은 `JsonPrimitive<unknown>`입니다.
  ```ts
  // src/api/wire-types.ts (operation마다 별칭 한 줄)
  export * from './types.js'
  import type { ClientError } from './client.js'
  export type ListUsersClientError = ClientError
  export type CreateUserClientError = ClientError
  export type GetUserClientError = ClientError
  ```
- `oa.config.ts`에 `outputRouting`이 있는 프로젝트(`oa-gen init`의 기본 설정)에서 `--split`은 출력 경로가 바뀌고 상대 import가 깨집니다(TS2307). 이 조합은 쓰지 않습니다.
- `oa-gen generate`를 쓰는 프로젝트에서는 다음 `oa-gen generate` 실행이 이 명령의 출력을 지웁니다. 그런 프로젝트는 `generate`가 만드는 `<id>.queries.ts`를 씁니다([generate 옵션](#oa-gen-generate-옵션-및-일괄-생성-명세)).

실행 예시:

```bash
# 기본 3계층 통합 생성 (keys + queryOptions + mutationOptions + React hooks)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api

# keys.ts, queries.ts('use client' 없음), hooks.ts로 나눠 생성 (outputRouting이 없는 프로젝트)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api --split

# 응답 타입 연결: 클라이언트에는 typegen 출력, TanStack에는 위 wire-types.ts
oa-gen typegen --spec ./openapi.yaml -o ./src/api/types.ts
oa-gen generate:client --spec ./openapi.yaml -o ./src/api/client.ts --types-import ./types.js
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api --types-import ./wire-types.js
```

`oa-gen generate --tanstack`은 이 명령을 실행하는 사용 중단된 별칭이며 실행 시 안내 메시지를 출력합니다.

## oa-gen mock 옵션 및 실시간 핫 리로드(--watch) 명세

`oa-gen mock`은 TypeSpec(`.tsp`) 원본 또는 OpenAPI JSON/YAML 명세서로부터 중간 빌드 산출물 디스크 작성 없이 인메모리에서 즉각 구동되는 초고속 Mock HTTP 서버를 제공합니다. 서버는 동반 패키지 `@oa-sdk/mock-server`의 Node HTTP adapter가 구동하며, 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다. mock-server의 선택적 peer인 `msw`는 필요하지 않습니다.

`--tsp`와 `--spec`을 모두 생략하면 `oa-gen validate`·`oa-gen generate`처럼 프로젝트 설정 파일(`oa.config.ts` 등)을 읽어 spec target의 `schemaEntry`를 서빙합니다. `.tsp` 진입점은 `--tsp`처럼 컴파일하고, 그 밖의 파일은 `--spec`처럼 읽습니다. 그래서 `oa-gen init`이 추가하는 `mock` 스크립트(`oa-gen mock --watch`)는 경로 없이 동작합니다. spec target이 없거나 여러 개면 어느 스펙을 서빙할지 정할 수 없으므로 target id를 출력하고 종료 코드 1로 실패하며, 이때는 `--tsp` 또는 `--spec`으로 지정합니다.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--tsp <file>` | `-t` | `string` | `undefined` | TypeSpec 진입점 파일 경로 (`.tsp`). in-memory 컴파일을 거쳐 즉각 서빙 (`--spec`과 one-of, 둘 다 주면 `--tsp`) |
| `--spec <file>` | `-s` | `string` | `undefined` | OpenAPI JSON/YAML 파일 또는 `@oaOperation` JSDoc이 작성된 TypeScript 소스 파일 |
| `--port <port>` | `-p` | `number` | `4010` | Mock HTTP 서버가 바인딩될 리스닝 포트 |
| `--host <host>` | | `string` | `127.0.0.1` | Mock HTTP 서버 바인딩 호스트 |
| `--watch` | `-w` | `boolean` | `false` | 스펙 파일 변경 감지 및 프로세스 재시작 없는 무중단 실시간 핫 리로드 활성화 |
| `--stateful` | | `boolean` | `false` | 인메모리 CRUD 저장소 활성화. POST가 만든 항목을 GET이 돌려주고 PUT/PATCH/DELETE가 갱신·삭제합니다. 이 모드의 목록 응답은 저장된 항목 배열이므로 문서의 응답 스키마(예: `{ items, total }` 형태)와 다를 수 있습니다 |

요청은 파라미터·본문·보안 요구사항으로 검증해 잘못되면 422, 인증 정보가 없으면 401, 정의되지 않은 경로는 404로 답하고, 응답은 문서의 예제나 스키마로 만듭니다.

OpenAPI 스펙이 여러 파일로 나뉘어 있으면 다른 파일을 가리키는 `$ref`를 스펙 파일의 위치에서 풀어 서빙하고, 풀 수 없는 `$ref`가 있으면 그 `$ref`를 출력하고 종료 코드 1로 실패합니다. `--watch`는 스펙 파일만 지켜보므로, `$ref`가 가리키는 다른 파일만 고쳤을 때는 스펙 파일을 다시 저장하거나 서버를 다시 시작해야 반영됩니다.

### 실시간 무중단 핫 리로드 3대 메커니즘
`--watch` (`-w`) 플래그가 활성화되면 다음과 같은 안정성 메커니즘이 가동됩니다:
1. **100ms 디바운싱**: IDE 멀티 파일 일괄 저장 시 발생하는 이벤트 폭주를 100ms 지연 후 1회의 원자적 컴파일로 통합 처리합니다.
2. **구문 오류 보호 (Parse Error Shielding)**: 개발자가 스펙 작성 중 일시적으로 YAML 들여쓰기 오류나 TypeSpec 문법 에러를 발생시켜도, watcher는 콘솔에 진단 에러만 출력하고 **기존 유효했던 Mock 라우트를 그대로 유지**합니다. 서버 프로세스가 죽거나 소켓이 끊어지지 않습니다.
3. **인메모리 원자적 라우트 스왑 (`server.updateSpec`)**: 스펙 수정이 성공하면 활성 TCP keep-alive 소켓을 닫지 않고 인메모리 라우트 디스패치 테이블만 즉각 교체합니다.

실행 예시:
```bash
# TypeSpec 스펙 기반 실시간 핫 리로드 Mock 구동 (이 저장소에서는 packages/schemas/typespec/main.tsp)
oa-gen mock --tsp ./main.tsp --watch --port 4010

# OpenAPI YAML 스펙 기반 Mock 구동
oa-gen mock --spec ./openapi.yaml --watch

# oa.config.ts의 spec target 서빙 (oa-gen init이 추가하는 mock 스크립트)
oa-gen mock --watch
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

`package.json`의 `devDependencies`에 기록하는 `@oa-sdk` 패키지의 버전은 프로젝트 위치에 따릅니다. 프로젝트와 해당 패키지가 같은 pnpm 워크스페이스의 멤버이면 `workspace:*`, 그 밖에는 이 codegen이 빌드된 릴리스와 호환되는 범위(`^<버전>`)입니다. 비공개 패키지 `@oa-sdk/personas`(`enterprise`)는 워크스페이스 밖에서는 추가하지 않고 그 사실을 출력합니다. `init`은 `package.json`에 이미 있는 항목을 `--force` 없이는 바꾸지 않고, 그 뒤 프로젝트 위치에서 설치할 수 없는 `@oa-sdk` 항목(이전 `init`이 쓴 `workspace:*` 등)을 해야 할 조치와 함께 출력합니다. 자세한 규칙은 [동반 패키지 안내](./cli-setup.md#동반-패키지-companion-packages)를 참고하세요. `init`이 추가하는 스크립트 목록은 [CLI 설정 가이드](./cli-setup.md#packagejson-스크립트)에 있습니다.

### 아키타입 (`--archetype`)

아키타입은 `oa.config.ts`에 기록하는 설정값, 출력 위치, `package.json` 스크립트와 의존성의 묶음입니다. 기록된 gate·persona 설정을 읽어 동작을 바꾸는 명령은 아직 없습니다. `core.gates.*`(`driftCheck`, `failOnBreaking`, `baseRef`, `preflightLint`), `core.client.wireFormatSafety`, `product.jitSchema`, `product.zeroCopy`, `product.personas.enforceCoverage`는 CI나 다른 도구가 읽도록 남기는 값입니다. breaking change gate는 `enterprise`가 추가하는 스크립트(아래)나 CI에 직접 등록한 명령으로 겁니다.

`init`은 아키타입과 관계없이 스캐폴드가 쓰는 동반 패키지를 추가하며, 아래 표의 의존성은 아키타입이 그 위에 더하는 것입니다. 스크립트도 모든 대상이 추가하는 `generate`·`mock`([CLI 설정 가이드](./cli-setup.md#packagejson-스크립트))에 아키타입의 것을 더합니다. 클라이언트 SDK와 핸들러 계약은 `generate`가 만듭니다.

| 아키타입 | 기록하는 설정 | 추가 스크립트 | 추가 의존성 |
| --- | --- | --- | --- |
| `mvp` (기본) | `client.outDir: './src/client'`(outputRouting이 있으면 쓰이지 않음), gate 값 `false`/`'warn'` | `mock`, `validate` | `@oa-sdk/client`, `@oa-sdk/mock-server` |
| `microservice` | `contracts.outDir: './src/contracts'`(outputRouting이 있으면 쓰이지 않음), `driftCheck: true`, `preflightLint: 'error'`, `wireFormatSafety`·`jitSchema`·`zeroCopy: true` | `mock` | `@oa-sdk/core`, `@oa-sdk/router` |
| `enterprise` | `failOnBreaking: true`, `baseRef: 'origin/main'`(읽는 명령 없음), `personas.enforceCoverage: true` 등 | `lint:spec`, `diff`, `baseline:update`, `ci:gate` | `@oa-sdk/core`(`@oa-sdk/personas`는 그 패키지를 가진 워크스페이스 안에서만) |

`init`이 추가하는 `oa-gen` 스크립트는 모두 쓰인 그대로 스캐폴드에서 실행됩니다. codegen의 패키지 검증(`smoke:pack`)이 배포 tarball로 아키타입마다 `init`을 실행하고(프레임워크를 감지하지 않는 `generic` 대상), 추가된 스크립트를 하나씩 실행해 확인합니다. 프레임워크 대상이 더하는 개발 서버·빌드 스크립트(`dev`, fastify의 `build`, nestjs의 `start:dev`)는 `init`이 만들지 않는 서버 진입 파일과 `tsconfig.json`이 있어야 실행됩니다([CLI 설정 가이드](./cli-setup.md#packagejson-스크립트)).

#### `enterprise`의 breaking change gate

`enterprise`는 스펙 진입점(`schemaEntry`)을 검사하는 스크립트를 추가하고, 비교 기준인 **계약 기준선**(contract baseline) `openapi.baseline.yaml`을 프로젝트 루트에 만듭니다. 기준선은 스펙을 `oa-gen normalize`로 정규화한 OpenAPI 문서(키 정렬, TypeSpec은 OpenAPI 3.2로 컴파일)이며, 커밋해 두고 릴리스할 때 옮깁니다. 스펙이 `$ref`로 다른 파일(`./schemas.yaml#/User`, 경로 항목 `./paths/users.yaml` 등)을 가리키면 기준선은 그 내용을 `$ref` 옆 필드의 뜻대로 복사해 담고, `diff`도 스펙이 가리키는 파일까지 읽어 비교하므로 그 파일에서 생긴 breaking change에서도 실패합니다. 저장소 기록이나 원격 브랜치를 읽지 않으므로 로컬과 CI에서 같은 결과가 나옵니다.

스크립트가 검사하는 스펙은 프로젝트에 남는 `oa.config.ts`의 `schemaEntry`, 즉 `oa-gen generate`가 읽는 스펙입니다. `oa.config.ts`가 없거나 `--force`로 다시 쓰면 `--spec`으로 준 스펙, 없으면 감지한 스펙(`oa-gen generate`가 쓴 `src/generated/`와 기존 spec target의 `<id>.openapi.json`·`<id>.schema.json`은 감지하지 않음), 그것도 없으면 `openapi.yaml`을 새 `oa.config.ts`에 기록하고 그 스펙을 검사합니다. `--force` 없이 다시 실행해 `oa.config.ts`를 그대로 두면 그 파일을 불러와 spec target의 `schemaEntry`를 씁니다. spec target마다 `schemaEntry`가 다르면 `--spec`으로 그중 하나를 고릅니다. 그 밖에 어느 스펙인지 정할 수 없으면(`oa.config.ts`를 불러오지 못함, spec target이 없음, spec target이 여럿인데 `--spec`이 없음, `--spec`이 어느 spec target의 `schemaEntry`도 아님) 기준선과 아래 스크립트를 추가하지 않고 이유를 출력합니다. `oa.config.ts`는 `@oa-sdk/codegen`을 import하므로 프로젝트 의존성을 설치한 뒤 실행합니다.

| 스크립트 | 명령(스펙이 `openapi.yaml`일 때) | 동작 |
| --- | --- | --- |
| `lint:spec` | `oa-gen lint --spec openapi.yaml` | 모든 규칙 카테고리로 린트하고 error가 있으면 실패 |
| `diff` | `oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking` | 기준선 대비 breaking change가 있으면 실패 |
| `baseline:update` | `oa-gen normalize --spec openapi.yaml --output openapi.baseline.yaml` | 현재 스펙을 새 기준선으로 씀(릴리스 뒤, 또는 승인한 breaking change를 받아들일 때) |
| `ci:gate` | `oa-gen validate --spec openapi.yaml --require-32 && oa-gen lint --spec openapi.yaml && oa-gen diff --base openapi.baseline.yaml --head openapi.yaml --fail-on-breaking` | OpenAPI 3.2 검증, 린트, breaking diff를 차례로 실행 |

- 기준선 파일이 이미 있으면 `init`은 `--force`를 주어도 바꾸지 않습니다. 기준선은 릴리스한 계약이므로 `baseline:update`로만 옮깁니다.
- 스펙 파일이 아직 없거나 불러오지 못하면 `init`은 기준선을 만들지 않고 이유를 출력합니다. 그동안 `diff`·`ci:gate`는 기준선이 없어 실패하므로, 스펙을 만든 뒤 `baseline:update`를 한 번 실행합니다.
- `oa-gen diff`는 요청·응답·파라미터 스키마가 바뀌면 선택 필드 추가도 breaking으로 판정하는 보수적 규칙입니다. TypeSpec 원본을 의미 단위로 판정하려면 CI에 `oa-gen tsp diff --base origin/main:<path> --head <path> --fail-on-breaking`을 따로 등록합니다.
- `ci:gate`의 `--require-32`는 스펙이 OpenAPI 3.2.x여야 통과합니다. TypeSpec 스펙은 3.2로 컴파일되므로 통과합니다.
- 스펙 진입점이 OpenAPI YAML/JSON(`.yaml`·`.yml`·`.json`, 대소문자 무관)이나 TypeSpec(`.tsp`)이 아니면(TypeScript 스키마 모듈 등) 이 스크립트와 기준선을 추가하지 않고 이유를 출력합니다.
- 기준선은 스펙이 가리키는 파일의 내용을 담으므로 그 파일을 고친 변경도 `baseline:update`로만 기준선에 들어갑니다. URL(`https://...`)을 가리키는 `$ref`는 읽지 않고 그대로 비교합니다.

이전 버전의 `init`이 추가한 다음 스크립트는 동작하지 않거나 `oa-gen generate`와 같은 일만 하므로 지금의 `init`은 추가하지 않습니다: `generate:router`(프레임워크 대상), `generate:client`(`mvp`), `generate:contract`(`microservice`, nestjs 대상), `test:contract`·`audit:wire`(`microservice`), `audit:csp`·`audit:shape`·`personas:check`(`enterprise`). `init --force`는 같은 이름의 스크립트(`diff`, `ci:gate`, `lint:spec`)만 새 명령으로 바꾸므로, 나머지는 `package.json`에서 직접 지우고 `generate` 스크립트를 씁니다. `init`은 이전 `init`이 쓴 명령 그대로 `package.json`에 남은 이 스크립트를 이유와 할 일(지우기, 또는 같은 이름으로 지금 쓰는 명령으로 바꾸기)과 함께 출력합니다. `--force` 없이 `enterprise`로 다시 실행해 이전 `diff`·`ci:gate`가 남으면, 계약 기준선 안내도 이 스크립트를 바꿔야 기준선과 비교한다고 알립니다.

### 산출물 라우팅 프리셋 (`--routing`)

`--routing`은 `product.outputRouting`을 기록합니다. 경로 템플릿의 `{tag}`는 OpenAPI tag가 아니라 spec target id(예: `generic-api`)이며, `oa-gen generate`는 spec target마다 종류(`{kind}`)별로 한 파일을 씁니다. outputRouting이 적용되는 종류는 `contract`, `client`, `keys`, `queries`와 CRDT 모듈이며, `<id>.openapi.json`·`<id>.schema.json`은 spec target의 `outDir`에 씁니다. 파일이 서로 다른 디렉터리에 놓여도 생성 파일 사이의 상대 import는 다시 계산됩니다.

- **`default`**: `src/api/{tag}/{tag}.{kind}.ts`. 예: `src/api/generic-api/generic-api.contract.ts`.
- **`fsd`**: `src/features/{tag}/api/{tag}.{kind}.ts`, 클라이언트는 `src/shared/api/client.ts`. 예: `src/features/generic-api/api/generic-api.queries.ts`.
- **`monorepo`**: `packages/contracts/src/api.contract.ts`, `packages/client-sdk/src/index.ts`, `apps/web/src/api/queries.ts`, `apps/web/src/api/keys.ts`.
- **`by-kind`**: `src/contracts/{tag}.contract.ts`, `src/client/{tag}.client.ts`, `src/queries/{tag}.queries.ts`, `src/keys/{tag}.keys.ts`.

프리셋이 기록하는 `guards`·`schemas` 항목은 현재 `oa-gen generate`의 출력 위치를 바꾸지 않습니다. `fsd`의 `rules`에 있는 `tag`(`common`, `shared`, `auth`, `system`)도 OpenAPI tag가 아니라 spec target id와 비교되므로, OpenAPI tag별로 파일이 나뉘지 않습니다.

실행 예시:
```bash
# Fastify 대상 + microservice 아키타입 + FSD 라우팅으로 비대화형 초기화
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
| `--file <path>` | `-f` | `string` | N | - | 생성된 코드를 이미 있는 `.tsp` 파일 끝에 추가 (import·`using` 줄은 붙이지 않음) |
| `--output <path>` | `-o` | `string` | N | - | 출력 파일 경로 (`-` 지정 시 stdout 출력). 이미 있는 파일은 scaffold 코드로 덮어씀 |

`--file`과 `--output`을 모두 생략하면 stdout으로 출력합니다. `--file`은 이미 있는 `.tsp` 파일에만 추가하고 import나 `using` 줄은 붙이지 않습니다. scaffold 코드는 `--envelope` 여부와 관계없이 `@operationId`(`@typespec/openapi`)와 `@oaUseResponseComponent`(`@oa-sdk/typespec-decorators`)를 쓰고, `--envelope`의 `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`도 `@oa-sdk/typespec-decorators`의 표준 계약입니다. 따라서 대상 파일은 다음 머리말을 갖춰야 컴파일됩니다.

```typespec
import "@typespec/http";
import "@typespec/openapi";
import "@oa-sdk/typespec-decorators";

using Http;
using OpenAPI;
using OaSdkTypeSpec;

@service(#{ title: "Orders" })
namespace OrdersApi;
```

- `@typespec/openapi` import와 `using OpenAPI;`가 없으면 `oa-gen validate`가 `Unknown decorator @operationId`로, `@oa-sdk/typespec-decorators` import와 `using OaSdkTypeSpec;`이 없으면 `Unknown decorator @oaUseResponseComponent`로 실패합니다(`invalid-ref`, 종료 코드 1). 세 라이브러리의 설치는 [CLI 설정의 TypeSpec 작성 의존성](./cli-setup.md#typespec-작성-의존성)을 따릅니다.
- 기본 `--auth bearerAuth`가 만드는 `@useAuth(bearerAuth)`는 `bearerAuth` 식별자가 있어야 컴파일됩니다. 이 저장소는 `packages/schemas/typespec/common.tsp`에 `model bearerAuth is BearerAuth;`를 두며, 다른 프로젝트는 같은 선언을 머리말 아래에 추가하거나 `--auth none`을 씁니다.
- `--output`으로 새 파일을 만들면 `@typespec/http`·`@typespec/openapi` import만 붙이고 `@oa-sdk/typespec-decorators` import는 붙이지 않아 그대로는 컴파일되지 않습니다. `--envelope`와 함께 주면 `Ok<T>` 등을 파일 안에 따로 선언하므로 `using OaSdkTypeSpec;`을 더해도 `ambiguous-symbol`로 실패합니다. 위 머리말을 갖춘 파일을 먼저 만들고 `--file`로 추가합니다.
- scaffold가 붙이는 `@oaUseResponseComponent("400", "BadRequest")` 등은 `oa-gen`이 `.tsp`를 메모리에서 컴파일할 때(`validate`, `typegen`, `generate`, `mock --tsp`) 실제 응답이 되지 않고 `x-oa-sdk-operation-component-refs` 확장으로만 남습니다. 응답으로 바뀌는 곳은 이 저장소의 bundle restore 경로(`pnpm schema:typespec-check`)뿐입니다. 다른 프로젝트에서 4xx 응답이 필요하면 생성된 operation의 반환 타입에 `ErrorResponse<Status>`나 `StandardHttpErrors`를 더합니다.

실행 예시:
```bash
# CRUD 5종 + 제네릭 엔벨롭 표준 스펙 생성 후 위 머리말을 갖춘 기존 파일에 추가
# (bearerAuth 선언이 없으면 --auth none. 이 저장소에서는 packages/schemas/typespec/*.tsp)
oa-gen tsp-scaffold --route /orders --crud --envelope --auth none --file ./main.tsp

# 단일 POST 엔드포인트 코드를 stdout으로 출력
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
