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
옵션과 조건부 옵션을 보여 준다. 이 문서의 동작은 `@oa-sdk/codegen` 0.10.0 기준이다.

`generate:client`, `pack:client`, `generate:tanstack`, `mock`, 그리고 `oa-gen generate`의 핸들러
계약·라우터·클라이언트 산출물은 `@oa-sdk/codegen`에 포함되지 않은 동반 패키지(`@oa-sdk/router`,
`@oa-sdk/client`, `@oa-sdk/mock-server`)가 생성한다. 명령별 필요 패키지, 설치 방법, 패키지가
없을 때의 동작은 [동반 패키지 안내](./cli-setup.md#동반-패키지-companion-packages)를 따른다.
`oa-gen generate`는 대상 프레임워크가 Fastify·Express·Hono·Elysia 중 하나로 정해지면 핸들러 계약
옆에 그 프레임워크용 라우터 파일(`<id>.router.ts`)도 만든다([generate 옵션](#oa-gen-generate-옵션-및-일괄-생성-명세)).
요청·응답 타입이 있는 계약과 라우터가 필요하면 빌드 스크립트에서 `@oa-sdk/router`의
`generateHandlerContract()`·`generateRouter()`를 호출한다([Backend Handler Contracts](./backend-handler-contracts.md#31-빌드-스크립트로-생성-권장)).

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
| `oa-gen generate:pydantic` | OpenAPI 3.2 또는 TypeSpec(.tsp) 스펙에서 Pydantic v2 모델을 생성할 때 | `--spec <openapi\|typespec>` | Pydantic 모델 모듈; `--out <dir\|file.py>`, `--preset <default\|strict\|passthrough>`, semantic options, `--layout <split\|single>`, `--no-operations`, `--encoding-policy`, `--extensions`, `--no-docstrings`, `--frozen`, `--emit-ir`, `--report`, `--force`, `--no-validate`, `--no-normalize`, `--categories` 지원 |
| `oa-gen generate:tanstack` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp) 스펙에서 TanStack Query v5 3계층(Query Key Factory, Options Factory, Hooks) 코드를 생성할 때 | `--spec <openapi\|typespec>` | TanStack Query v5 산출물 (keys, options, hooks); `--spec` (`-s`), `--output <dir>` (`-o`), `--config <path>` (`-c`), `--tier <all\|keys\|options\|hooks>`(`--split`에서는 하위 계층을 의존성으로 함께 생성), `--framework <react\|vue\|svelte>`(vue/svelte는 keys+options, hooks는 React 전용), `--client-import <path>`, `--types-import <path>`, `--split` 지원 |
| `oa-gen surface` | OpenAPI 또는 TypeSpec artifact를 target-neutral Surface IR과 Forge projection/Overlay로 변환할 때 | `--spec <openapi\|typespec>` | `surface-ir.json`, `forge-projection.json`, command별 Overlay, `surface-manifest.json`; `--target forge`, `--out-dir`, `--mapping`, `--fail-on-warning` 지원 |
| `oa-gen generate:guards` | OpenAPI 3.1/3.2 또는 TypeSpec(.tsp)으로부터 독립형 무런타임 타입 가드를 생성할 때 | `--input <file>` | 독립형 무런타임 타입 가드(Standalone Type Guards) 산출물; `--input` (`-i`), `--out-dir` (`-o`), `--type-import`, `--module-format`, `--split`, `--schemas` 지원 |
| `oa-gen generate:drizzle` | Drizzle ORM 스키마 파일로부터 OpenAPI 3.2 스키마 컴포넌트를 생성할 때 | `--drizzle-schema <path>` | Drizzle ORM 스키마 기반 OpenAPI 3.2 컴포넌트 산출물; `--drizzle-schema` (`-d`), `--output` (`-o`), `--merge-into`, `--schemas` 지원 |
| `oa-gen mock` | TypeSpec, OpenAPI 또는 TypeScript 소스에서 제로 빌드 즉각 목 서버를 구동할 때 | `--tsp <file>` 또는 `--spec <path>`, 둘 다 없으면 `oa.config.ts`의 spec target(하나일 때) | 인메모리 OpenAPI 3.2 Mock HTTP 서버 구동 (기본 포트 4010); `--tsp` (`-t`), `--spec` (`-s`), `--port <port>` (`-p`), `--host <host>`, `--watch` (`-w`)로 100ms 디바운스, 에러 쉴딩, 원자적 인메모리 라우트 핫스왑, `--stateful`로 인메모리 CRUD 저장소 지원 |
| `oa-gen tsp diff` | TypeSpec AST 간 시맨틱 차이점 및 파괴적 변경(breaking change)을 분석할 때 | `--base <source> --head <source>`. 양쪽 모두 `.tsp` 파일, 디렉터리, git ref, `<ref>:<path>` | TypeSpec AST 시맨틱 비교 리포트. 선택 속성 추가는 non-breaking, 필수 속성 추가는 breaking으로 구분; `--fail-on-breaking`으로 파괴적 변경 감지 시 exit code 1, `--format <markdown\|json>` 지원. git ref는 `git archive`로 그 커밋을 꺼내므로 작업 트리를 보지 않는다. 커밋 전 변경(작업 트리, CI checkout)은 `--base <ref>:<path> --head <path>`, 두 커밋은 `--base <ref>:<path> --head <ref>:<path>` 또는 `--base origin/main --head HEAD`로 비교. 경로 없는 git ref는 상대편 진입점과 같은 저장소 루트 기준 경로를 자기 커밋에서 읽는다(양쪽 다 경로가 없으면 base가 관례 위치나 하나뿐인 `main.tsp`로 찾은 진입점). 진입점을 하나로 정할 수 없으면(그 경로가 커밋에 없거나 `main.tsp` 후보가 여럿) 추측하지 않고 `<ref>:<path>`를 달라는 오류로 끝난다([옵션 상세](./typespec/04-scaffolding-and-diff.md#21-옵션)). 두 쪽이 같은 커밋의 같은 진입점이면(`--base HEAD --head HEAD`) stderr에 자기 자신과 비교한다는 안내를 출력한다 |
| `oa-gen generate` | TypeSpec, OpenAPI, config, Drizzle에서 스키마, 계약, 라우터, 클라이언트, 가드를 일괄 생성할 때 | 없음 (선언적 `oa.config.ts` 자동 로드) 또는 `--spec <openapi\|typespec>`, `--config <file>`, `--drizzle-schema <path>`, `--target standalone-guards --input <file>` | OpenAPI 문서, 핸들러 계약(`*.contract.ts`), 대상 프레임워크가 `hono`·`express`·`fastify`·`elysia`일 때의 라우터(`*.router.ts`), 클라이언트 SDK, TanStack Query 키·옵션, 가드 일괄 산출물; `--spec` (`-s`), `--output` (`-o`), `--out-dir`, `--config` (`-c`), `--target standalone-guards`, `--input` (`-i`), `--drizzle-schema` (`-d`), `--merge-into`, `--split`(가드 모듈 분할), `--incremental`, `--cache-dir` 지원. `--incremental`은 guards가 없는 OpenAPI target의 schema·companion 산출물 bundle을 입력/ref/options/output fingerprint로 재사용하고, stale index·TypeSpec compiler observation·실패 output은 전체 target 재생성으로 fallback한다. 자세한 옵션은 아래 generate 절 |
| `oa-gen typegen` | OpenAPI 또는 TypeSpec(.tsp)에서 TypeScript 선언을 만들 때 | `--spec <openapi\|typespec>` | type declarations; `--incremental`은 같은 spec·출력 대상의 입력(spec과 외부 `$ref` 파일 내용, TypeSpec 컴파일러가 읽은 모든 파일과 import 해석 중 확인한 경로·symlink 대상, TypeSpec이 불러온 JS decorator의 모듈 그래프: 직접 작성한 모듈은 내용·import 해석으로, 설치 패키지는 그 `package.json`과 그 패키지가 다른 패키지를 찾은 경로로, 실패한 import(선택적 `import()`·`require()`)는 Node가 확인한 후보 경로로), `--style`, generator 버전, 기존 출력이 모두 그대로면 재생성을 건너뛰고(stdout 출력은 기록된 결과를 재출력) stderr에 `incremental:` 상태 한 줄을 남김. 생성 중 바뀌었을 수 있거나 다시 확인할 수 없는 입력은 다음 실행에서 다시 생성(`input not verified: <path> (<reason>)`; Node.js 22.15 미만에서는 직접 작성한 JS decorator가 있으면 매번 다시 생성). decorator 코드가 스스로 읽는 파일은 추적하지 않음. cache 위치는 `--cache-dir <dir>` (기본 `./.oa-cache`). `--typespec-provenance <json> --graph-semantic-index <json> --graph-file <project-relative>`(셋 다, `--output` 필요)는 생성 선언마다 TypeSpec `.tsp` 파일·줄을 evidence로 붙인 `oa-sdk.typespec-ts-graph-semantic.v1` sidecar를 함께 쓰고, provenance가 다른 문서를 기술하거나 소유자 없는 선언이 있으면 아무 출력도 쓰지 않고 실패함. `--incremental`에서는 sidecar가 별도 대상(`typegen:graph-semantic-index`)으로 기록되어 provenance 내용·경로, `--graph-file`, sidecar 출력이 바뀌면 타입과 함께 다시 생성됨 |
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
| `oa-gen sketch` | TypeSpec(`.tsp`) 모듈 인터페이스 스케치를 IR로 검증하거나, 후보 스케치를 비교하거나, 스케치에서 산출물·구현 스텁을 만들고 구현이 계약을 지키는지 확인할 때 | `--spec <tsp\|dir>` | `--action <verify\|compare\|emit\|check-contract>` (`-a`, 기본 `verify`)에 따라 Interface Sketch IR(`oa-sdk.interface-sketch-ir.v2`), 후보 비교 결과, 5종 산출물, 구현 계약 카나리 리포트; `--out-dir` (`-o`), `--domain`, `--impl`, `--format <json\|human>` 지원. [sketch 명세](#sketch) |
| `oa-gen reference-check` | Apitomy와 OA SDK 진단을 비권위적 비교로 확인할 때 | `--spec <openapi>` | markdown/JSON comparison; 계약 권위는 바꾸지 않음 |
| `oa-gen scaffold-governance` | 외부 서비스에 독립 CLI·CI baseline governance scaffold를 만들 때 | `--root <dir> --service <name>` | config/script/docs/GitHub workflow; `--profile`, `--oa-gen-command`, `--oa-gen-setup-command`, `--typegen-policy` 선택 |
| `oa-gen inventory` | OpenAPI path, operation, component, security surface를 요약할 때 | `--spec <openapi>` | markdown/JSON inventory |
| `oa-gen ref-projection` | 계약 모델을 `$ref` 구조를 전개하지 않은 그래프로 검토하거나 외부 도구(시각화·편집 studio)로 넘길 때 | `--spec <openapi>` | `oa-sdk.ref-projection.v1` JSON artifact; `--provenance <build-spec provenance>`로 노드별 `canonicalId`를 붙이고 `--output`으로 파일에 쓴다. [ref-projection 명세](#ref-projection-옵션-및-artifact-명세) |
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
| `oa-gen trace` | OpenAPI 3.2 스펙 정의의 엔드투엔드 추적성 그래프(`.oa-trace.json`) 생성, 심볼/요구사항/페르소나 다중 조건 질의 및 역방향 영향도(Blast Radius)를 분석할 때 | `--spec <openapi>` | `oa-sdk.spec-traceability.v1` 추적성 그래프 및 영향도 리포트; `--spec` (`-s`), `--typespec-root <dir>`, `--provenance <path>`, `--manifest <path>`, `--symbol <name>`, `--pointer <ptr>`, `--tracking-id <id>`, `--source <file>`, `--requirement <req>`, `--persona <id>`, `--impact <targets>`, `--output <path>` (`-o`), `--format <human\|json>`, `--verify` 지원 |

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

`oa-gen generate`는 프로젝트의 선언적 설정(`oa.config.ts`)을 기반으로 OpenAPI 문서와 JSON Schema 2020-12(`<id>.openapi.json`, `<id>.schema.json`), 핸들러 계약(`*.contract.ts`), 대상 프레임워크의 라우터(`*.router.ts`), fetch 클라이언트 SDK, TanStack Query 키·옵션, 설정의 `guards`에 선언한 독립형 타입 가드를 일괄 생성합니다. `--spec <path>`를 주면 설정 파일 없이 그 스펙 하나로 같은 파이프라인을 실행하고 결과를 `--out-dir`/`--output`(기본 `./dist`)에 씁니다.

핸들러 계약과 라우터는 동반 패키지 `@oa-sdk/router`, 클라이언트 SDK와 TanStack Query 옵션은 `@oa-sdk/client`가 생성합니다. 설정 파일이 `core.contracts.pureHandlers: true`(계약과 라우터) 또는 `core.client.enabled: true`로 명시적으로 켠 산출물의 패키지가 없으면 파일을 쓰기 전에 설치 명령을 출력하고 종료 코드 1로 실패합니다. 패키지가 있어도 명시적으로 켠 산출물을 만드는 중 오류가 나면 그 오류를 출력하고, 어떤 파일도 쓰지 않은 채(`.oa-manifest.json` 포함) 종료 코드 1로 실패합니다. 기본값으로만 암시된 산출물은 패키지가 없거나 생성 중 오류가 나면 경고와 함께 그 산출물만 건너뛰고, 이전 실행이 만든 해당 파일은 유지합니다([판정 기준](./declarative-spec-configuration.md#명시적-요청과-암시적-기본값-동반-패키지)).

스펙이 여러 파일로 나뉘어 `$ref`가 다른 파일(`./schemas.yaml#/Health`, `./paths/user.yaml` 등)을 가리키면, 계약·클라이언트·TanStack·CRDT 생성기에 넘기기 전에 그 `$ref`를 스펙 파일(`schemaEntry`)의 위치에서 풉니다. CRDT 모듈은 푼 스키마에서 `x-oa-sdk-crdt-entity`를 찾아 만들므로, `components.schemas`의 항목이 다른 파일의 스키마를 가리키는 `$ref`여도 그 엔티티의 CRDT 모듈을 만듭니다. 없는 파일을 가리키거나 서로만 가리키는 `$ref`처럼 풀 수 없는 `$ref`는 위의 생성 오류가 되며, 오류는 그 `$ref`와 진단 코드를 출력합니다(예: `external-ref-read-failed (./missing.yaml#/Health)`, `ref-cycle (./a.yaml#/A)`). `<id>.openapi.json`과 `<id>.schema.json`에는 `$ref`가 스펙에 쓴 그대로(스펙 파일 기준 상대 경로) 남습니다.

`oa-gen generate`는 서버 쪽에 핸들러 계약을 만들고, 대상 프레임워크(`core.router.target`, 없으면 `specs[].target`, 그다음 `product.framework`)가 `hono`, `express`, `fastify`, `elysia` 중 하나이면 그 프레임워크용 라우터(`<id>.router.ts`)도 만듭니다. 대상이 `generic`·`nestjs`이거나 없으면(`--spec` 실행 포함) 라우터를 만들지 않으며, 라우터 생성을 끄려면 `core.router.target: 'generic'`을 지정합니다([서버 쪽 생성물의 범위](./declarative-spec-configuration.md#22-서버-쪽-생성물의-범위)). 라우터는 같은 실행이 만든 계약을 import합니다. `core.contracts.pureHandlers: false`이면 계약을 만들지 않고, `core.router.target`을 직접 지정했을 때만 계약 없는 스텁 모드 라우터를 만듭니다. 생성된 계약과 클라이언트의 요청·응답 타입은 `unknown`입니다. 실행이 끝나면 `.oa-manifest.json`에 기록된 생성 파일 가운데 이번 실행이 소유한 파일(같은 설정 파일로 실행한 `oa-gen generate`가 기록한 파일, `--spec` 실행이면 이전 `--spec` 실행이 같은 스펙 파일로 기록한 파일) 중 이번 실행이 만들지 않고 내용도 바뀌지 않은 파일을 지웁니다. `oa-gen generate:tanstack` 등 다른 명령이 기록한 파일과 다른 설정 파일이나 다른 스펙 파일(파일 이름이 같아도 경로가 다르면 다른 파일)의 실행이 기록한 파일은 지우지 않으며, `outputRouting.pruneOrphans: false`면 아무 파일도 지우지 않습니다([판정 규칙](./declarative-spec-configuration.md#45-생성-파일-정리)). 요약 출력의 `N ops`는 spec target의 operation 수(`query`와 `additionalOperations` 포함, webhook 제외)로, 생성기에 넘기는 스펙처럼 다른 파일을 가리키는 `$ref`를 푼 스펙에서 세므로 다른 파일에 있는 path item의 operation도 포함합니다(`tags`에 `null` 항목이 있는 문서처럼 파서가 읽을 수 없는 문서는 쓴 그대로의 문서에서 세며, 이때 다른 파일에 있는 path item의 operation은 빠집니다). `<id>.openapi.json` 줄은 파일의 `openapi` 필드 버전(예: `OpenAPI 3.2.0`), `Routers Generated`는 라우터를 만든 spec target 수(0이면 줄을 출력하지 않음), `Artifacts Pruned`는 지운 파일입니다.

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

스펙이 여러 파일로 나뉘어 `$ref`가 다른 파일(`./schemas.yaml#/Health`, `./paths/user.yaml` 등)을 가리키면, `oa-gen generate:client`처럼 그 `$ref`를 스펙 파일의 위치에서 풀어 Surface IR을 만듭니다. 풀 수 없는 `$ref`가 있으면 `surface-ir.json`과 `forge-projection.json`의 진단에 `surface-ir/incomplete-document` 오류를 남기고 종료 코드 1로 실패합니다. Overlay는 `paths` 아래의 operation을 `operationId`로 찾으므로, 다른 파일에 있는 path item의 operation에는 path item을 한 문서로 모은 스펙(예: `oa-gen normalize` 출력)에 적용해야 반영됩니다.

생성되는 `surface-manifest.json`은 입력 artifact hash, IR version hash, operation/command
수, diagnostic 수, Overlay 경로를 기록합니다. Forge 전체 TypeScript SDK 생성은 생성된
Overlay를 Forge/Fern transformer에 전달하는 별도 downstream 단계입니다.

## ref-projection 옵션 및 artifact 명세

`oa-gen ref-projection`은 OpenAPI 문서를 `$ref`를 인라인 전개하지 않은 그래프
(`@oa-sdk/parser`의 `projectRefGraph`)로 투영해 버전이 붙은 JSON artifact
`oa-sdk.ref-projection.v1`로 내보냅니다. 입력 문서와 parser 출력은 수정하지 않습니다.

| 옵션 | 단축 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- | --- |
| `--spec <path>` | `-s` | `string` | **(필수)** | OpenAPI YAML/JSON 문서. TypeSpec은 먼저 OpenAPI로 compile한 결과를 넘긴다 |
| `--provenance <path>` | | `string` | `undefined` | `oa-gen build-spec --provenance`가 쓴 output pointer → `canonicalId` provenance map JSON |
| `--output <path>` | `-o` | `string` | stdout | artifact JSON 파일. 지정하면 stdout에는 노드·엣지·`canonicalId` 매핑 수 요약 한 줄만 쓴다 |

```bash
oa-gen build-spec \
  --target packages/schemas/src/targets/local-parity-api.yaml \
  --output .artifacts/local-api.openapi.yaml \
  --provenance .artifacts/local-api.provenance.json

oa-gen ref-projection \
  --spec .artifacts/local-api.openapi.yaml \
  --provenance .artifacts/local-api.provenance.json \
  --output .artifacts/local-api.ref-projection.json
```

artifact 계약의 정본은 codegen이 공개하는 JSON Schema
`REF_PROJECTION_ARTIFACT_SCHEMA_V1`이고, 언어 중립 사본은
[`docs/cli-spec/oa-sdk.ref-projection.v1.schema.json`](../cli-spec/oa-sdk.ref-projection.v1.schema.json)입니다
(`pnpm check:cli-spec`이 두 사본의 일치를 검사). 명령은 쓰기 전에 출력이 schema를
만족하는지 확인합니다.

| 필드 | 내용 |
| --- | --- |
| `schemaVersion` | `oa-sdk.ref-projection.v1`. 호환되지 않는 형식 변경은 새 version으로 낸다 ([artifact 호환성 정책](../cli-spec/oa-sdk-artifact-compatibility-policy.v1.json), 현재 `experimental`) |
| `generator` | 생성한 package 이름과 version (`@oa-sdk/codegen`) |
| `source` | 입력 파일의 project root 기준 경로와 `sha256:` content hash. `spec`은 필수, `provenance`는 넘겼을 때만 |
| `nodes[]` | 진입 문서의 `components.*`·`paths`·`webhooks` 선언과 외부 파일의 참조 대상. `id`는 진입 문서 선언이면 JSON Pointer fragment(`#/components/schemas/Pet`), 외부 대상이면 파일 + pointer(`./shared.yaml#/components/schemas/Owner`) |
| `nodes[].identity` | `status: mapped`이면 `canonicalId`와 일치한 provenance pointer, fragment `sourcePath`(project root 기준)/`sourcePointer`/`contentHash`. `status: unmapped`이면 `reason`이 `external-document`(다른 파일의 노드), `provenance-not-supplied`(`--provenance` 없음), `no-enclosing-provenance-entry`(노드 pointer와 그 상위 어디에도 provenance entry 없음) 중 하나 |
| `edges[]` | occurrence와 참조 대상이 모두 노드 안에 있는 해결된 `$ref` occurrence 하나당 하나. `source`/`target`은 occurrence와 참조 대상을 포함하는 노드 id, `id`는 occurrence 위치. `recursion`은 순환이 instance로 내려가면 `guarded`, 내려가지 않으면 `unguarded`(`ref-cycle` 진단과 같은 occurrence), 순환이 아니면 `none` |
| `diagnostics[]` | resolver 진단 `ref-cycle`, `ref-not-found`, `external-ref-*`, `unsupported-ref`와 projection 진단 `ref-source-outside-nodes`, `ref-target-outside-nodes`. 엣지가 없는 occurrence는 모두 여기 나온다. 해결되지 않은 occurrence는 resolver 진단으로, occurrence나 참조 대상이 어떤 노드에도 속하지 않는 occurrence(`info`·`x-` 확장·비표준 `components` 섹션 아래 등)는 노드 밖에 있는 끝마다 `ref-*-outside-nodes` 진단으로 나온다 |

출력은 입력의 순수 함수입니다. timestamp를 넣지 않고 노드·엣지·진단을 code unit 순서로
정렬합니다. 입력 파일이 어디 있는지는 다음 세 곳에만 드러납니다.

- 그래프의 파일 경로는 진입 문서 디렉터리 기준 `$ref` 형식(`./shared.yaml`)으로 씁니다. 노드·엣지
  id, `filePath`, 진단의 파일 경로는 그래프가 닿는 파일들이 진입 문서 주위에 놓인 배치에만 의존하고,
  project가 어디 있는지와는 무관합니다.
- mapped 노드의 fragment `sourcePath`는 project root 기준 상대 경로입니다. build-spec이 기록한 절대
  경로는 변환하고, 이미 상대 경로면 그대로 둡니다.
- `source`는 입력 파일마다 project root(`--root` 또는 자동 감지한 루트) 기준 경로와 파일 byte의
  `sha256:` hash를 씁니다.

따라서 같은 codegen version이면, spec과 그 `$ref`가 닿는 파일, provenance 파일이 같은 project
root 기준 경로에 같은 byte로 있을 때 어느 checkout에서든 byte 단위로 같은 출력이 나옵니다.
같은 파일이라도 다른 project root에서 실행하면 `source`의 경로와 변환한 `sourcePath`가 달라지고
나머지는 같습니다. build-spec provenance 파일은 checkout의 절대 경로를 담으므로 checkout마다
byte가 달라 `source.provenance.contentHash`도 달라집니다.

`canonicalId` 매핑은 노드 pointer 자신 또는 가장 가까운 상위 pointer의 provenance entry를
쓰며, spec-lens graph와 같은 `findNearestJsonPointerEntry()`(`@oa-sdk/parser`)를 공유합니다.

종료 코드는 artifact를 쓰면 `0`이고, `--spec` 누락, 읽을 수 없거나 파싱할 수 없는 spec·provenance,
형식이 틀린 provenance entry(문자열 필드 누락, 빈 `canonicalId`)이면 `1`입니다(출력 파일을 쓰지
않음). `ref-cycle` 같은 진단은 artifact 내용이며 종료 코드를 바꾸지 않습니다.

## generate:tanstack 옵션 및 인수 명세

`oa-gen generate:tanstack`은 OpenAPI 3.1/3.2 명세로부터 TanStack Query v5 기반의 3계층 아티팩트(Tier 1 Query Key Factory, Tier 2 Pure Options Factory, Tier 3 Composition Hooks)를 자동 생성합니다. 생성기는 동반 패키지 `@oa-sdk/client`에서 불러오며, 패키지가 없으면 설치 명령을 출력하고 종료 코드 1로 실패합니다. `oa-gen generate:client`처럼 다른 파일을 가리키는 `$ref`는 스펙 파일의 위치에서 풀고, 풀 수 없는 `$ref`가 있으면 그 `$ref`를 출력하고 종료 코드 1로 실패합니다.

> ⚠️ **주의**: 과거 문서에 기재되었던 `--package`, `--client-name`, `--hooks`, `--banner` 플래그는 유효하지 않습니다. 대상 프레임워크 패키지는 `--framework <react|vue|svelte>`로 지정합니다. `vue`·`svelte`는 keys+options만 생성하며(옵션은 프레임워크 중립 타입), Tier 3 훅은 React 전용입니다.

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

`--output` 디렉터리에는 기본으로 키·옵션·훅을 모두 담은 `tanstack-query.ts` 한 파일을 씁니다. 이 파일이 import하는 생성 파일은 같은 디렉터리의 `./client.js`(`oa-gen generate:client`로 생성)뿐이고, 훅을 담으므로 첫머리에 `'use client'` 지시문이 있습니다. `--split`은 `keys.ts`, `queries.ts`(옵션, `'use client'` 없음), `hooks.ts`(`'use client'`)를 쓰고, `queries.ts`와 `hooks.ts`는 `./client.js`와 앞 계층 파일(`./keys.js`, `./queries.js`)을 import합니다. Next.js Server Component처럼 `'use client'` 모듈을 import할 수 없는 곳에서는 `--split`의 `queries.ts`나 `--split` 없이 `--tier options`로 만든 파일(키와 옵션, 아래 알려진 제한 첫 항목)을 쓰고, `oa-gen generate`를 쓰는 프로젝트는 `generate`가 만드는 `<id>.queries.ts`를 씁니다. `--framework vue|svelte`는 훅 없이 키와 옵션만 쓰고, 옵션 계층은 `@tanstack/query-core`가 모든 어댑터에 재노출하는 `QueryObserverOptions`·`MutationObserverOptions`를 쓰므로 컴파일됩니다. 이름 규칙은 키 `<tag>Keys`(예: `usersKeys`), 옵션 `<operationId>QueryOptions`·`<operationId>MutationOptions`, 훅 `use<OperationId>Query`·`use<OperationId>Mutation`, 그리고 `createApiHooks`입니다. 옵션 팩토리와 훅은 첫 인자로 `createClient()`가 만든 클라이언트를 받습니다.

알려진 제한:

- `--split`의 `--tier`는 누적입니다. `options`는 `keys.ts`와 `queries.ts`를, `hooks`는 `keys.ts`·`queries.ts`·`hooks.ts`를 씁니다. `--split` 없이 주면 한 파일이 앞 계층을 함께 담습니다. `--tier options`는 키와 옵션(`'use client'` 없음), `--tier hooks`는 키·옵션·훅(`'use client'`)을 쓰며, 이 파일은 앞 계층 파일(`./keys.js`, `./queries.js`)을 import하지 않습니다. `--tier keys` 출력은 두 방식 모두 이 명령의 다른 출력을 import하지 않습니다.
- `--framework vue|svelte`에서 Tier 3 훅은 생성하지 않습니다. `--tier hooks`와 함께 쓰면 오류로 끝납니다. 옵션 계층은 모든 어댑터가 재노출하는 `@tanstack/query-core` observer 타입만 쓰므로 `tsc`를 통과합니다. React 훅과 같은 API가 필요한 Vue·Svelte 프로젝트는 keys/options를 쓰고 훅은 각 프레임워크 어댑터로 작성합니다.
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
- `--types-import`에는 `oa-gen typegen` 출력을 넘깁니다. 클라이언트와 TanStack에 **같은 모듈**을 넘기면 `tsc`를 통과합니다. 오류 응답이 있는 operation의 `<Operation>ClientError`는 클라이언트가 스스로 선언하므로 typegen 출력에 그 이름이 없어도 됩니다. TanStack에만 `--types-import`를 생략하면 키·파라미터가 `Record<string, …>`로 생성되어 typed 클라이언트의 시그니처와 맞지 않고(`TS2345`), 클라이언트에만 생략하면 응답 타입이 `unknown`이 됩니다.
- `oa.config.ts`에 `outputRouting`이 있는 프로젝트(`oa-gen init`의 기본 설정)에서 `--split`은 keys/queries를 라우팅된 경로에 쓰고 hooks를 queries 옆에 쓰며, 상대 import는 실제 경로 차이에서 계산합니다. `--output`을 함께 주면 명시한 디렉터리가 우선합니다.
- `oa-gen generate`를 쓰는 프로젝트에서는 다음 `oa-gen generate` 실행이 이 명령의 출력을 지웁니다. 그런 프로젝트는 `generate`가 만드는 `<id>.queries.ts`를 씁니다([generate 옵션](#oa-gen-generate-옵션-및-일괄-생성-명세)).

실행 예시:

```bash
# 기본 3계층 통합 생성 (keys + queryOptions + mutationOptions + React hooks)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api

# keys.ts, queries.ts('use client' 없음), hooks.ts로 나눠 생성 (outputRouting이 없는 프로젝트)
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api --split

# 응답 타입 연결: 클라이언트와 TanStack에 같은 typegen 출력을 넘긴다
oa-gen typegen --spec ./openapi.yaml -o ./src/api/types.ts
oa-gen generate:client --spec ./openapi.yaml -o ./src/api/client.ts --types-import ./types.js
oa-gen generate:tanstack --spec ./openapi.yaml --output ./src/api --types-import ./types.js
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

`init`은 아키타입과 관계없이 스캐폴드가 쓰는 동반 패키지를 추가하며, 아래 표의 의존성은 아키타입이 그 위에 더하는 것입니다. 스크립트도 모든 대상이 추가하는 `generate`·`mock`([CLI 설정 가이드](./cli-setup.md#packagejson-스크립트))에 아키타입의 것을 더합니다. 클라이언트 SDK와 핸들러 계약, 그리고 fastify·express·hono·elysia 대상의 라우터는 `generate`가 만듭니다.

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

`--routing`은 `product.outputRouting`을 기록합니다. 경로 템플릿의 `{tag}`는 OpenAPI tag가 아니라 spec target id(예: `generic-api`)이며, `oa-gen generate`는 spec target마다 종류(`{kind}`)별로 한 파일을 씁니다. outputRouting이 적용되는 종류는 `contract`, `router`, `client`, `keys`, `queries`와 CRDT 모듈이며, `<id>.openapi.json`·`<id>.schema.json`은 spec target의 `outDir`에 씁니다. 파일이 서로 다른 디렉터리에 놓여도 생성 파일 사이의 상대 import는 다시 계산됩니다.

- **`default`**: `src/api/{tag}/{tag}.{kind}.ts`. 예: `src/api/generic-api/generic-api.contract.ts`.
- **`fsd`**: `src/features/{tag}/api/{tag}.{kind}.ts`, 클라이언트는 `src/shared/api/client.ts`. 예: `src/features/generic-api/api/generic-api.queries.ts`.
- **`monorepo`**: `packages/contracts/src/api.contract.ts`, `packages/client-sdk/src/index.ts`, `apps/web/src/api/queries.ts`, `apps/web/src/api/keys.ts`.
- **`by-kind`**: `src/contracts/{tag}.contract.ts`, `src/client/{tag}.client.ts`, `src/queries/{tag}.queries.ts`, `src/keys/{tag}.keys.ts`.

`monorepo`·`by-kind`의 `byKind`에는 `router` 항목이 없으므로, 라우터(fastify·express·hono·elysia 대상)는 기본 규칙 `src/api/{tag}/{tag}.router.ts`에 씁니다. 프리셋이 기록하는 `guards`·`schemas` 항목은 현재 `oa-gen generate`의 출력 위치를 바꾸지 않습니다. `fsd`의 `rules`에 있는 `tag`(`common`, `shared`, `auth`, `system`)도 OpenAPI tag가 아니라 spec target id와 비교되므로, OpenAPI tag별로 파일이 나뉘지 않습니다.

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

## sketch

`oa-gen sketch`는 TypeSpec(`.tsp`)으로 쓴 모듈 인터페이스 스케치를 `@oa-sdk/surface-ir`의 Interface Sketch IR로 읽어 네 가지 액션을 수행한다. 모든 액션은 `--format json`(기본)이면 결과를 JSON으로, `--format human`이면 한 줄 요약을 stdout에 출력한다. 그 밖의 `--action` 값이면 지원하는 액션 목록을 stderr에 쓰고 종료 코드 1로 끝난다.

| 액션 (`--action`, `-a`) | `--spec` (`-s`) | 하는 일 | 종료 코드 |
| --- | --- | --- | --- |
| `verify` (기본) | `.tsp` 파일 또는 디렉터리 | `parseTypeSpecSketch`로 IR을 만들어 출력한다. `json`은 IR 전체, `human`은 namespace, profile, 인터페이스 깊이(`depthMetrics`), 설계 red flag 수, 진단 수 | 파일이 없거나 IR에 `error` 진단이 있으면 1(IR은 먼저 출력) |
| `compare` | 쉼표로 구분한 2개 이상의 `.tsp` 경로, 또는 디렉터리(그 안의 `candidates/` 하위 디렉터리가 있으면 그곳) | 후보마다 IR을 만들어 진단을 확인한 뒤 `compareSketchCandidates`로 후보(파일명이 후보 이름)를 점수화해 `recommendedWinner`를 고른다 | 후보가 2개 미만이거나 한 후보라도 IR에 `error` 진단이 있으면 1(비교 결과를 출력하지 않음) |
| `emit` | `.tsp` 파일 또는 디렉터리 | `--out-dir`(기본: 스펙과 같은 디렉터리)에 `<domain>.schema.json`, `<domain>.openapi.json`, `<domain>.mmd`, `sketch_stub.ts`, `sketch_stub.py`(Python 3.10 이상, `@dataclass(kw_only=True)`)를 쓴다 | 파일이 없거나 IR에 `error` 진단이 있으면 1(파일을 쓰지 않음) |
| `check-contract` | `.tsp` 파일 또는 디렉터리 | `--impl <file>`(`.py`면 Python, 그 외 TypeScript)을 스펙의 operation·model 이름과 대조하는 구현 계약 카나리(`checkImplementationContract`)를 실행한다. 무엇을 구현으로 세는지는 아래 목록 | 스펙 파일이 없거나, `--impl`을 주지 않았거나 그 파일이 없으면 1. IR에 `error` 진단이 있으면 카나리를 실행하지 않고 1. 카나리 리포트가 `passed: false`(friction signal이 하나라도 있거나 `not implemented` 스텁이 남음)이거나 `scrapRequired: true`(friction signal 2개 이상)이면 1 |

- `--spec`이 디렉터리이면 `<디렉터리명>.tsp`를, 없으면 이름순 첫 `.tsp` 파일을 쓴다.
- IR의 `error` 진단(끝나지 않은 문자열·주석, 짝이 맞지 않는 괄호, 읽을 수 없는 선언·멤버, 순환하는 spread·interface `extends`)은 IR에서 선언이 빠졌을 수 있다는 뜻이므로, 네 액션 모두 그런 IR을 계약으로 쓰지 않는다. 진단마다 `<스펙 경로>:<줄>:<열> <code> <message>`(줄·열은 1부터) 한 줄과 오류 개수 안내를 stderr에 쓰고 종료 코드 1로 끝난다. `warning` 진단(interface 밖의 operation, 같은 소스에 선언되지 않은 심볼을 가리키는 spread·interface `extends`, `op x is y` 시그니처)은 IR의 `diagnostics`에만 남고 종료 코드를 바꾸지 않는다.
- `--domain`은 `emit` 산출물 파일명(`<domain>.*`)이자 `verify`·`emit`·`check-contract`가 만드는 IR의 `specName`이며, 기본값은 `.tsp` 파일명에서 `.tsp`를 뺀 이름이다. IR 이름에 스펙 경로를 쓰지 않으므로 같은 소스와 같은 `--domain`이면 어느 머신에서든 `specName`과 `versionHash`가 같다. `compare`는 `--domain`을 쓰지 않고 후보 파일명(`.tsp` 제외)을 후보 이름으로 쓴다.
- 계약의 기준은 항상 `--spec`의 `.tsp`다. `emit`으로 만든 `sketch_stub.*`는 구현의 출발점일 뿐이며 `check-contract`의 입력이 아니다.
- `check-contract`는 IR의 모든 interface operation 이름과 model 이름을 계약으로 삼고, 구현 파일이 그 이름을 바인딩할 때만 구현된 것으로 센다. 주석과 문자열 안의 이름은 세지 않는다. 빠진 이름은 `signatureDeviations`에 friction signal로 남는다.
  - operation: 계약 이름 그대로 또는 그 snake_case 형태(`placeOrder` → `place_order`)를 찾는다. TypeScript에서는 함수, 메서드, 접근자, 클래스 필드(생성자 parameter property 포함), interface·타입 리터럴 멤버, 객체 리터럴 키(`router({ placeOrder: ... })`처럼 호출 인자 안의 키 포함), 변수(구조 분해 포함), 값 re-export(`export { placeOrder } from`)를 센다. Python에서는 `def`/`async def`와 문장이 대입하거나 annotate하는 이름(`place_order = ...`, `place_order: Handler`, 튜플·starred·연쇄 대입의 대상)을 센다.
  - model: 선언(TypeScript class·interface·type alias·enum, Python `class`·`type X = ...`·대입한 이름)과 import를 센다. 모든 import 바인딩(`import type { Order }`, `from .models import Order`)과 re-export(`export type { Order } from`), namespace를 거친 이름(`import * as Stub` + `Stub.Order`, `import models` + `models.Order`)이 포함되므로, model을 공유 모듈이나 `emit`이 쓴 `sketch_stub.*`에서 가져와도 된다.
  - 세지 않는 것: 호출 지점(`api.placeOrder()`), 속성 읽기, operation을 import만 한 것, TypeScript 매개변수(이름, 그 타입의 멤버, 기본값. 매개변수 타입이 가리키는 model은 센다), Python의 키워드 인자와 속성·첨자 대입 대상(`self.x = ...`, `d[k] = ...`). Python은 논리 문장 단위(괄호 안 줄바꿈과 끝의 `\`는 문장을 이어 가고, 괄호 밖 `;`는 문장을 나눔)로 읽어 문장의 시작만 바인딩으로 보므로, 여러 줄 호출이나 `def`에서 한 줄에 따로 쓴 키워드 인자·매개변수도 바인딩이 아니다.
  - 그 밖의 friction signal은 타입 탈출구(`escapeHatches`: TypeScript `: any`·`as any`·`as unknown as`·`@ts-ignore`/`@ts-expect-error`, Python `: Any`·`cast()`·`# type: ignore`), 잠금 반사(`lockReflexes`: `threading.Lock()`, `asyncio.Lock()`, `new Mutex()` 등), 우회 표시 주석(`workaroundMarkers`: `// HACK`, `# FIXME` 등)이다. 탈출구와 잠금 검사도 주석과 문자열 안의 코드는 보지 않는다(억제 지시문과 우회 표시는 주석에서 찾는다). `passed`는 friction signal이 없고 `throw new Error('not implemented')`·`raise NotImplementedError('not implemented')` 스텁(`unimplementedStubCount`)도 없을 때만 `true`다.

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
