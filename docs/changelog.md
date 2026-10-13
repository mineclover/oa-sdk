# Changelog

릴리스 단위가 아닌, 굵직한 surface 변경이 떨어졌을 때 한 항목으로 기록한다. 자세한 구현 상태는 [spec.md](./internal/spec.md), API 단일 소스는 [api-index.md](./internal/api-index.md), 기능↔테스트는 [feature-test-matrix.md](./internal/feature-test-matrix.md) 참조.

## 2026-10-13 — TypeSpec 계약 기반 RPC와 wire 호환 Protobuf codec (`@oa-sdk/surface-ir`, `@oa-sdk/codegen`, 새 private `@oa-sdk/rpc`)

TypeSpec으로 선언한 operation을 REST route 단위가 아니라 typed procedure 호출로 쓸 수 있게 했다. 사용법은
[TypeSpec 계약을 RPC로 쓰기](./guides/typespec-rpc.md)에 있다.

- **RPC contract (`@oa-sdk/surface-ir`)**: `buildRpcContract()`가 operation마다 dotted-name procedure(`@rpc` 이름 → 첫 tag camelCase + operationId), 파라미터와 body를 합친 object 입력, 성공 출력, status별 오류, REST request를 다시 만들 HTTP binding을 담은 JSON 계약 `oa-sdk.rpc-contract.v1`을 만든다. streaming operation과 이름·필드 충돌은 진단과 함께 제외한다.
- **타입 생성 (`@oa-sdk/codegen`)**: `pluginRpc()` / `generateRpcModule()`이 `<Name>Procedures` 타입 맵과 `<name>Contract` 데이터를 방출한다.
- **런타임 (`@oa-sdk/rpc`, private)**: `createRpcServer`의 한 handler 집합이 JSON-RPC 2.0(`createJsonRpcFetchHandler`, 메시지 채널용 `handleJsonRpc`)과 원래 REST route(`createRestFetchHandler`)를 함께 제공하고, `createRpcClient`는 `createHttpTransport`·`createJsonRpcTransport`·`createLocalTransport`로 호출한다. OpenAPI style/explode 직렬화, `RpcError` 오류 모델, Ajv 검증기(`./ajv`), 내부 예외 은닉, body 키·`__proto__`·`..` path 방어를 포함한다.
- **Wire RPC client (`@oa-sdk/codegen`)**: `pluginWire`의 `rpc-contract`가 만드는 `<Service>RpcClient`가 path·query·header·cookie 파라미터로 route를 채우고, 선언된 media type대로 JSON 또는 `BinaryCodecAdapter`로 body를 인코딩·디코딩하며, 실패를 `WireRpcError`로 알린다. 이전에는 파라미터가 빠지고 body를 직렬화하지 않았다.
- **Protobuf codec (`@oa-sdk/codegen`)**: 생성 codec이 생성 `.proto`와 같은 wire format을 쓴다. 중첩·반복 message, enum 번호, `map<>`, 64-bit·zigzag·fixed 타입, packed repeated, union 등의 JSON fallback을 지원하고 protobufjs와 양방향으로 검증한다. 이전에는 중첩 object가 있는 model(production 계약 예시 16개 중 7개)에서 인코딩이 throw했고 object field가 `"[object Object]"`가 됐다. production 계약 예시 기준 크기는 JSON의 45–75%다.
- **문서·게이트**: [Spec](./internal/spec.md#typespec-계약-rpc와-바이너리-wire-), API index, feature-test-matrix(`typespec-rpc-contract-runtime`, `wire-binary-codecs`), release policy(Downstream 14개), [scope decision](./internal/platform-scope.md#typespec-contract-rpc-runtime--2026-10-12)을 갱신했다.

## 2026-10-05 — Installable onboarding: companion packages and registry specifiers (`@oa-sdk/codegen` 0.9.0, `@oa-sdk/parser` 0.4.0, `@oa-sdk/typespec-decorators` 0.3.0, `@oa-sdk/core` 0.3.1; first npm release candidates `@oa-sdk/router` 0.2.2, `@oa-sdk/client` 0.2.2, `@oa-sdk/mock-server` 0.1.4, `@oa-sdk/surface-ir` 0.1.1)

`npx @oa-sdk/codegen init --yes` → 설치 → `oa-gen generate`로 이어지는 공개 온보딩 흐름이 oa-sdk 워크스페이스 밖에서도 끝까지 동작하도록 정리했다.

- **`oa-gen init`의 `@oa-sdk` 지정자 (`@oa-sdk/codegen`)**: 프로젝트와 해당 패키지가 같은 pnpm 워크스페이스의 멤버일 때만 `workspace:*`를, 그 밖에는 codegen이 빌드된 릴리스와 호환되는 범위(`^<version>`)를 쓴다. 이전에는 항상 `workspace:*`를 써서 npm이 `EUNSUPPORTEDPROTOCOL`로 설치를 거부했다. 비공개 `@oa-sdk/personas`는 그 패키지를 가진 워크스페이스 안에서만 추가하고, 밖에서는 추가하지 않은 이유를 출력한다. 그 뒤 `package.json`에서 프로젝트가 있는 위치에서 설치할 수 없는 `@oa-sdk` 항목을 모두 해야 할 조치와 함께 출력한다. 해당 패키지를 가진 워크스페이스 밖의 `workspace:` 항목(이전 `init`이 쓴 항목 등)은 출력한 범위로 바꾸고(`init`이 쓰는 패키지는 `--force`가 바꾼다), 그 밖의 `@oa-sdk/personas` 항목은 지정자와 관계없이 삭제하라고 안내한다(`--force`도 그대로 둔다). 이전에는 `init --force`가 personas에 "not added"만 출력해 설치를 깨는 항목이 남아 있음을 드러내지 않았다.
- **Companion package (`@oa-sdk/codegen`)**: router·client·mock-server가 만드는 산출물을 조용히 건너뛰지 않는다. 그 산출물만을 위한 명령과 명시적으로 켠 산출물의 `oa-gen generate`는 빌드 기준 버전으로 고정한 설치 명령을 출력하고 실패한다. `init`은 스캐폴드가 쓰는 companion을 `devDependencies`에 기록한다. `oa-gen mock`은 mock-server의 선택적 peer인 `msw` 없이 동작한다.
- **mock-server entry point (`@oa-sdk/mock-server`)**: MSW adapter(`createMswHandlers`, `createMswMockServer`, `MswHandlerOptions`, `MswMockServer`)는 `@oa-sdk/mock-server/adapters/msw`(Node, Vitest)와 `@oa-sdk/mock-server/browser`(browser bundle)에만 있고, 패키지 루트는 더 이상 이를 다시 export하지 않는다. 선택적 peer인 `msw`는 이 두 entry point에만 필요하므로 루트·`/adapters/node-http`·`oa-mock` CLI와, 루트를 불러오는 `oa-gen mock`은 `msw` 없이 로드된다. 루트가 MSW adapter를 다시 export하던 candidate에서는 깨끗한 설치의 `oa-gen mock`과 `init`이 추가한 `mock` 스크립트가 `Cannot find package 'msw'`로 실패했다.
- **스캐폴드 스크립트 (`@oa-sdk/codegen`)**: `init`이 추가하는 스크립트가 그대로 실행된다. `oa-gen mock`은 `--tsp`/`--spec` 없이 실행하면 설정의 spec target(하나일 때)을 서빙하고, `oa-gen validate`는 `profile` 없는 target을 `oa-gen generate`처럼 `full-api-document`로 검증한다. npm 11의 `npm init`이 쓰는 `"type": "commonjs"` 프로젝트에서도 ES module로 작성된 `oa.config.ts`를 ES module로 변환해 불러오므로, 이전처럼 설정을 읽는 명령이 "Cannot use import statement outside a module"로 실패하지 않는다.
- **Release gate**: codegen export는 embed된 빌드 기준 버전(companion과 `init`이 범위를 쓰는 `@oa-sdk/core` 등)이 같은 export에 있거나 이미 npm에 있어야 통과한다. exporter와 public runtime smoke는 선택적 peer 없이 설치한 consumer에서 모든 public entry point를 import하고(public runtime smoke는 `oa-gen mock`도 실행한다), 선택적 peer가 필요한 entry point는 `release-policy.json`의 `optionalPeerEntryPoints`에 선언한다. codegen pack smoke는 pack된 `oa-gen init`이 모든 archetype에서 워크스페이스 밖에 registry 범위만 쓰는지 확인하고, `"type": "commonjs"` 프로젝트에서 그 스캐폴드의 `validate`·`mock` 스크립트를 실행한다. codegen 테스트는 `oa-gen`이 불러오는 companion entry point가 선택적 peer 없이 로드되는지 확인한다.
- **공유 route index (`@oa-sdk/parser`, `@oa-sdk/codegen`, `@oa-sdk/mock-server`)**: `loadSchema()`가 `parseDocument()`와 같은 route indexer로 `RouteIndex`를 만들어 두 진입점이 같은 route를 돌려준다. operation 위치의 Reference Object 처리와 typegen 출력 변화는 각 패키지 CHANGELOG에 정리했다.
- **증분 typegen (`@oa-sdk/codegen`)**: `oa-gen typegen --incremental`이 이전 출력을 재사용한다. 이전에는 증분 실행도 매번 전부 다시 파싱·생성·기록했다. generator package version, `--style`, 이전 실행이 소비한 모든 입력(entry spec과 외부 `$ref` 문서의 내용, `.tsp`이면 TypeSpec 컴파일러가 읽은 파일·import 해석 중 확인한 경로·link 대상·JS decorator 모듈 그래프), 출력 hash가 그대로면 재생성을 건너뛰고, 증분 실행마다 stderr에 `incremental: typegen up to date, regeneration skipped (...)` 또는 `incremental: typegen regenerating (<reason>)` 한 줄을 남긴다. 기록은 SQLite workspace index의 새 테이블 `generation_targets`, `generation_target_observations`에 저장한다(추가 테이블이라 index schema version은 그대로). `--incremental` 없는 `typegen`·`validate`는 더 이상 쓰지 않는 index를 위해 entry spec을 스캔하지 않는다.
- **`oa-gen surface` (`@oa-sdk/codegen`, `@oa-sdk/surface-ir`)**: OpenAPI 또는 TypeSpec artifact에서 target-neutral surface IR, Forge projection, command별 OpenAPI Overlay, manifest를 만든다. surface IR은 새 `@oa-sdk/surface-ir` 패키지가 소유한다.
- **공유 노드 처리 (`@oa-sdk/codegen`)**: YAML alias처럼 입력의 여러 위치가 공유하는 노드를 정규화(`oa-gen normalize`/`collect`)와 3.2 upgrade 보고가 모든 위치에서 처리한다. `zodToSchema()`는 변환 root만 펼치고 그 아래의 등록된 schema는 모두 `$ref`로 내보내므로, `generateComponents()`의 결과가 component 순서에 따라 달라지거나 self-reference(`Id: { $ref: '#/components/schemas/Id' }`)를 만들지 않는다.
- **표준 TypeSpec 계약 (`@oa-sdk/typespec-decorators`)**: `lib/contracts.tsp`의 `Ok<T>`, `Created<T>`, `NoContent`, `PageResult<T>`, `ErrorResponse<Status>`, `StandardError`, `StandardValidationError`, `StandardHttpErrors`를 `import "@oa-sdk/typespec-decorators"`가 함께 불러온다. 데코레이터와 같은 `OaSdkTypeSpec` namespace에 있으므로 `using OaSdkTypeSpec;`으로 쓴다(README와 가이드가 안내하던 `OaSdkContracts` namespace는 없다).
- **`oa-gen tsp diff`의 git ref 비교 (`@oa-sdk/codegen`)**: `--base origin/main --head HEAD`처럼 경로 없는 git ref가 자기 커밋에서 상대편의 entry point를 읽는다. 이전에는 base를 자기 자신과 비교해 `--fail-on-breaking`이 항상 통과했다. entry point를 정할 수 없으면 `<ref>:<path>`를 요구하며 실패한다.
- **상대 경로 (`@oa-sdk/codegen`)**: `oa-gen drift`, `drift:live`, `review`가 상대 경로를 받는다. 이전에는 차이가 없어도 `Invalid behavior record`로 종료 코드 1이 났다.
- **`oa-gen generate`의 정리와 실패 처리 (`@oa-sdk/codegen`)**: `outputRouting.pruneOrphans: false`를 지키고, 정리할 때는 같은 설정 파일(또는 같은 `--spec` 파일)로 자기가 기록한 파일만 지운다. `generate:tanstack` 산출물이나 다른 설정의 파일은 지우지 않는다. 명시적으로 켠 산출물이 생성 중 오류를 내면 파일을 쓰지 않고 종료 코드 1로 끝난다. 요약은 operation 수와 문서가 선언한 OpenAPI 버전을 표시한다.
- **여러 파일로 나눈 스펙 (`@oa-sdk/codegen`)**: `oa-gen generate`, `generate:tanstack`, `mock`이 다른 파일을 가리키는 `$ref`(`./schemas.yaml#/Health`, `./paths/user.yaml` 등)를 `generate:client`처럼 스펙 파일의 위치에서 풀어 router·client·mock-server에 넘기고, `generate`는 CRDT 엔티티도 푼 스키마에서 찾는다. 이전에는 풀지 않은 채 넘겨 동반 패키지가 스펙을 거부했으므로(`requires complete $ref resolution; received a partial ParsedDocument: unsupported-ref ...`), 여러 파일로 나눈 스펙에서는 핸들러 계약·클라이언트·TanStack 옵션·mock 서버가 만들어지지 않았고, `components.schemas`의 항목이 다른 파일의 스키마를 가리키는 CRDT 엔티티는 CRDT 모듈 4개가 경고 없이 빠졌다. 없는 파일이나 서로만 가리키는 `$ref`처럼 풀 수 없는 `$ref`는 같은 방식으로 실패하며 오류가 그 `$ref`와 진단 코드(`external-ref-read-failed`, `ref-cycle`)를 출력하고, `generate`는 명시적으로 켠 산출물이면 종료 코드 1로 끝난다. 새 `oa-gen surface`도 같은 방식으로 풀어 Surface IR을 만들므로 다른 파일에 있는 path item의 operation도 투영하고, 풀 수 없는 `$ref`가 있으면 `surface-ir/incomplete-document` 오류와 함께 종료 코드 1로 끝난다. `generate`가 쓰는 `<id>.openapi.json`·`<id>.schema.json`에는 `$ref`가 스펙에 쓴 그대로 남는다.
- **여러 파일로 나눈 스펙의 `oa-mock`과 operation 수 (`@oa-sdk/mock-server`, `@oa-sdk/codegen`)**: `oa-mock` CLI가 다른 파일을 가리키는 `$ref`를 검증할 때처럼 스펙 파일의 위치에서 풀어 서버에 넘기므로, 다른 파일에 있는 path item의 operation도 서빙한다. 이전에는 `$ref`를 풀어 검증하고도 서버에는 풀지 않은 문서를 넘겨, 여러 파일로 나눈 스펙에서는 항상 `서버 시작 실패: ... unsupported-ref ...`로 종료 코드 1이 났다. `oa-gen generate` 요약의 `N ops`도 생성기가 읽는, `$ref`를 푼 스펙에서 세므로 다른 파일에 있는 path item의 operation을 포함한다. `tags`에 `null` 항목이 있는 문서처럼 파서가 읽을 수 없는 문서는 쓴 그대로의 문서에서 세므로, operation 수 때문에 실행이 실패하지는 않는다.
- **`oa-gen init` 스크립트 (`@oa-sdk/codegen`)**: 그대로 실행되는 스크립트만 쓴다. `generate:router`·`generate:client`·`generate:contract` 별칭과 동작하지 않던 `test:contract`, `audit:wire`, `audit:csp`, `audit:shape`, `personas:check`를 뺐고, enterprise는 커밋된 `openapi.baseline.yaml`과 비교하는 `lint:spec`·`diff`·`baseline:update`·`ci:gate`를 쓴다. 이전 init이 남긴 스크립트는 이유와 조치를 함께 알린다.
- **성능 (`@oa-sdk/codegen`)**: TypeSpec 컴파일러와 TypeScript는 그것을 쓰는 명령에서만 불러오고, `oa-gen generate`는 projection된 spec을 한 번만 파싱하며, `audit:csp`는 규칙을 위반할 수 없는 파일의 AST 파싱을 건너뛴다.
- **버전**: npm의 codegen 0.8.1, parser 0.3.0, core 0.3.0, typespec-decorators 0.2.0은 현재 소스와 내용이 달라 함께 올렸다. 새 codegen은 parser 0.3.0에 없는 `appendJsonPointer`를 import한다. router·client·mock-server·surface-ir는 이 릴리스에서 처음 npm에 배포된다. 각 패키지가 배포하는 surface는 패키지 CHANGELOG의 첫 배포 항목에 정리했다.

## 2026-09-13 — Platform deficiency remediation: router response envelope defense, typed handler error unions, AbortSignal pass-through, infinite queries, monorepo import resolver, unified codegen pipeline, and Linux file watching (`@oa-sdk/codegen` 0.8.1, `@oa-sdk/client` 0.2.1, `@oa-sdk/router` 0.2.1, `@oa-sdk/spec-lens` 0.1.5)

전수 코드 리뷰를 통해 식별된 9대 플랫폼 결함(R1–R9)을 전면 해결하고 실증 회귀 검증을 완료했다.

- **Router 응답 엔벨로프 충돌 방어 (`@oa-sdk/router`)**:
  - `'status' in result` 조건으로 인해 비즈니스 엔티티(`{ id: 'order_1', status: 'PENDING' }` 등)의 데이터가 유실되던 결함을 3중 엄격 검증(`'body' in result && typeof result.status === 'number'`)으로 수정하여 200 OK JSON 본문으로 온전하게 직렬화.
- **핸들러 컨트랙트 Multi-Status 및 Typed Error 응답 유니언 (`@oa-sdk/router`)**:
  - `HandlerResponse`를 문서화된 모든 상태 코드(2xx, 4xx, 5xx)를 포괄하는 식별된 유니언(Discriminated Union)으로 확장하여 `as any` 없이 타입 안전한 에러 응답(`{ status: 404, body: NotFoundError }`) 반환 지원.
- **`AbortSignal` 및 `RequestInit` 관통 파이프라인 (`@oa-sdk/client`)**:
  - 모든 생성 클라이언트 메서드에 `options?: { signal?: AbortSignal, headers?: Record<string, string> }`를 확장하고 네이티브 `fetch`로 전달. TanStack Query `queryFn`에서 전달된 취소 시그널을 실제 HTTP 요청 중단으로 관통.
- **TanStack Query Infinite Query 자동 생성기 (`@oa-sdk/client`)**:
  - 커서/오프셋/페이지네이션 파라미터 감지 휴리스틱(`detectPagination`)을 탑재하여 `*InfiniteQueryOptions()` 및 `initialPageParam`, `getNextPageParam` 팩토리 자동 합성.
- **모노레포 패키지 경계 인식 임포트 해석기 (`@oa-sdk/codegen`)**:
  - 워크스페이스 간 산출물 분산 배포 시 깊은 상대 경로 대신 대상 패키지의 정규 이름(`@oa-sdk/client` 등)으로 자동 임포트(`findNearestPackageJson`, `resolvePackageSpecifier`).
- **`RouterRenderOptions` 컨텍스트 주입 타이핑 보강 (`@oa-sdk/router`)**:
  - `contextInjection`, `contextImport`, `contextTypeName` 필드를 정규 선언하여 무타입 단언 제거.
- **단일 선언적 종합 파이프라인 통합 (`oa-gen generate`)**:
  - `oa-gen generate` 단일 커맨드로 스펙 프로젝션 $\rightarrow$ 타입 가드 $\rightarrow$ 핸들러 컨트랙트 $\rightarrow$ 클라이언트 SDK $\rightarrow$ TanStack Query 옵션 일괄 생성 및 `outputRouting` 디스패치 파이프라인 완결.
- **`oa-gen init` 내 `outputRouting` 프리셋 지원 (`@oa-sdk/codegen`)**:
  - `--routing <default|fsd|monorepo|by-kind>` 플래그 및 대화형 설정을 지원하여 아키텍처별 경로 자동 구성.
- **Linux 환경 파일 와칭 재귀 폴백 엔진 (`@oa-sdk/codegen`)**:
  - Linux `fs.watch({ recursive: true })` 제약을 극복하는 재귀 디렉터리 와커 및 동적 생성 폴더 추적 엔진 탑재.

## 2026-09-12 — Output routing, TanStack Query v5 3-tier generator, multi-framework routers, target onboarding, and live mock watch (`@oa-sdk/codegen` 0.8.0, `@oa-sdk/client` 0.2.0, `@oa-sdk/router` 0.2.0)

모노레포의 5대 핵심 플랫폼 역량이 완비되어, 프론트엔드/백엔드 풀스택 코드 생성 및 개발자 경험(DX) 워크플로우를 포괄적으로 확장했다.

- **산출물 경로 라우팅 커스터마이징 엔진 (`outputRouting`)**:
  - `oa.config.ts`에 `outputRouting` 설정을 도입하여 템플릿 패턴(`{tag}`, `{kind}`, `{operationId}`, `{group}`, `{method}`, `{target}`) 및 케이싱 변환(`kebab`, `camel`, `pascal`)을 지원.
  - 태그/메서드/오퍼레이션/종류별 세부 규칙 매처(`rules`) 및 산출물 분류별 디스패칭(`byKind`) 지원.
  - 서로 다른 디렉토리로 분산 방출되는 산출물 간의 상대 import 경로(`path.relative`) 및 `tsconfig.json` path alias 자동 계산.
  - `.oa-manifest.json` 기반의 3단계 안전 고아 파일 정리(`pruneOrphans: true`)로 수동 작성 코드 손상 없이 이전 생성 산출물만 안전하게 정리.
- **TanStack Query (React Query) v5 3계층 코드 생성기 (`oa-gen generate:tanstack`)**:
  - **Tier 1 (Key Factory)**: `*Keys` 계층형 쿼리 키 트리(`all`, `lists()`, `list(filters)`, `details()`, `detail(id)`) 자동 생성.
  - **Tier 2 (Options Factory)**: `@tanstack/react-query`의 `queryOptions()` 및 `mutationOptions()`를 순수 팩토리 함수로 생성. 프론트엔드 런타임 의존성 없이 SSR prefetching(`queryClient.prefetchQuery`) 및 클라이언트 훅에서 공용 사용 가능.
  - **Tier 3 (Hook Factory)**: React 19 호환 `use<Op>Query`, `use<Op>Mutation`, `useSuspense<Op>Query` 클라이언트 훅 생성.
  - `oa-gen generate:tanstack --spec <path> --output <dir> [--tier 1|2|3|all]` CLI 지원 및 `outputRouting` 완벽 연동.
  - 라우터 핸들러 계약 및 `@oa-sdk/client`와 100% 일치하는 와이어 파라미터/응답 타입 보장.
- **다중 프레임워크 라우터 스텁 및 순수 핸들러 계약 분리 (`@oa-sdk/router`)**:
  - **핸들러 계약 분리 패턴 (`*.contract.ts`)**: `generateHandlerContract`를 통해 비즈니스 로직 시그니처와 프레임워크 라우팅 코드를 물리적으로 분리하여 스펙 재컴파일 시 구현 코드 덮어쓰기 방지.
  - **다중 프레임워크 라우터 바인더 (`generateRouter`)**:
    - `fastify`: JIT 인라인 스키마 컴파일 및 `fast-json-stringify` 최적화 지원.
    - `elysia`: Bun 네이티브 Zero-copy 컨텍스트 구조분해(`{ params, query, body, set }`) 및 메서드 체이닝 지원.
    - `hono`: Cloudflare Workers, Node, Bun을 위한 Web 표준 Fetch 기반 라우터 생성.
    - `express`: 레거시 및 기존 Express 미들웨어 호환 라우터 생성.
- **타깃 분리형 대화형/비대화형 온보딩 엔진 (`oa-gen init`)**:
  - `oa-gen init [--target <framework>] [--archetype <mvp|microservice|enterprise>] [--yes] [--dry-run] [--force]` 지원.
  - 6대 타깃 프로필(`fastify`, `elysia`, `hono`, `express`, `nestjs`, `generic`) 및 3대 수명주기 아키타입 사전 설정.
  - **엄격한 런타임 격리 (Strict Runtime Isolation)**: Bun 환경에는 순수 Bun 스크립트(`bun --watch`, `bun x oa-gen`)와 `@types/bun`만 주입하고 Node 도구 오염을 원천 차단; Node 환경에는 Node ESM 스크립트(`tsx watch`) 주입.
  - `common/schema-detector.ts`를 통한 `.tsp`, `openapi.yaml`, `openapi.json`, `@oaOperation` JSDoc 소스 신뢰도 점수 기반 자동 식별.
  - `common/package-patcher.ts`를 통한 들여쓰기/개행 보존 및 비파괴적 `package.json` 병합.
- **실시간 소스 관측 Mock Server (`oa-gen mock --watch`)**:
  - `.tsp`, `.yaml`, `.json`, `@oaOperation` 소스를 100ms 디바운스로 실시간 관측하여 인메모리 컴파일.
  - `@oa-sdk/mock-server`의 원자적 `server.updateSpec(newDoc)` 라우트 스왑을 호출하여 소켓 단절이나 서버 재시작 없이 즉시 핫 리로드.
  - 구문/컴파일 오류 시 기존 정상 라우트를 유지하는 에러 쉴딩(Error Shielding) 적용.

## 2026-08-30 — World stimulus and projection integrity (`0.5.0`)

Breaking pre-1.0 World Model contract hardening: action role bindings now require
UUID values, time-advance alternatives are sealed, and projection bundle items
inherit their World/model/revision context from the outer envelope.

- A time-advance request can no longer carry both `targetLogicalTime` and
  `duration`; unknown variant fields are rejected.
- `ProjectionBundleItem` contains only `projectionId` and `value`, preventing a
  bundle from representing a child projection from a different World or revision.
- Schema-driven mock SSE responses end by closing the response rather than
  emitting an undocumented `[DONE]` frame outside the declared item schema.

## 2026-08-30 — Validation summary and self-update hardening (`0.4.0`)

Breaking pre-1.0 contract hardening: validation details can now contain only the
content-free summary shapes emitted by the mock server, and `PATCH /me` requires
a non-empty `name` update while rejecting `role` and other unknown fields.

- `ValidationError.received` now references a sealed string/array/object/scalar
  summary union, so raw submitted passwords, tokens, objects, and arrays are
  invalid contract values rather than merely discouraged documentation.
- `UpdateMeRequest` is sealed and requires `name`; callers can no longer send
  an empty update or a self-role change through the documented request schema.

## 2026-08-30 — Contract safety and native SSE (`0.3.0`)

production TypeSpec contract를 `0.3.0`으로 올리고, consumer-visible 안전성·streaming·user
creation contract gaps를 정리했다.

- `POST /users`는 duplicate email에 대한 `409 Conflict`를 명시하고, persona matrix에도
  negative-path를 연결했다. hard-delete `deleteUser`와 audited `purgeUser`의 lifecycle 설명도
  서로 모순되지 않도록 정렬했다.
- `/health/stream`은 native TypeSpec SSE contract로 승격했다. generated OpenAPI는
  `text/event-stream`과 OAS 3.2 `itemSchema`를 제공하며, mock server와 generated client는 named
  SSE frame을 생성·소비한다.
- mock validation error는 password, token, secret, XML, multipart와 전체 request object의 원문을
  더 이상 반사하지 않는다. `received`/legacy `value`는 type/length/count 요약만 반환한다.
- TypeSpec provenance와 Spec Lens toolchain은 native event union/SSE dependencies를 인식하며,
  OAS 3.2-aware unused-component lint가 native pure-ref event alias를 올바르게 처리한다.

## 2026-08-30 — Artifact release readiness and guide alignment

artifact-only public package release를 준비하는 source-repository 절차를 한 곳으로 정리하고,
사용자 가이드의 obsolete CLI 경로를 실제 public surface와 맞췄다.

- `pnpm release:preflight`는 clean-worktree 확인과 문서·release policy·TypeSpec·downstream·Core
  build/typecheck/test·codegen package pack smoke를 순차 실행한다. 이는 npm publish를 실행하지 않으며, 실제 registry promotion은
  별도 artifact repository의 승인 workflow로 남는다.
- `release-readiness.md`와 release preparation guide는 package artifact export, external promotion,
  API runtime launch를 별도 판단으로 분리한다. 현재 roadmap도 active Core Platform work와
  historical/maintenance context를 구분한다.
- Quick Start와 World Model guide는 존재하지 않는 `oa-gen router`/`oa-gen client` command 대신
  private `generateRouter()`/`generateClient()` package API를 안내한다. docs gate는 built CLI form도
  live command registry로 검증해 같은 문서 drift를 차단한다.
- public distribution candidate인 core와 parser에 package README를 추가했다. exporter는 public npm
  registry와 `@oa-sdk` scope registry를 명시하고, non-404 registry failure를 unpublished version처럼
  취급하지 않으며, official `--version`이 committed source package version과 일치할 때만 export한다.

## 2026-08-10 — TypeSpec extension vocabulary v5 consolidation

Sidecar-less authored bundle의 extension vocabulary를 v5 하나로 통합하고, 완료된
roundtrip 이관 계획을 현재 운영 자료로 정리했다.

- `oa-sdk.typespec-extensions.v1`부터 v4까지의 parser support, fixture manifest, extension 문서를
  제거했다. bundle check는 v5 이외의 extension schema version을 거부한다.
- current source-of-truth는 v5 schema, authoring ownership guide, production operations로 구성한다.
  완료된 평가·migration·versioned roadmap 문서는 제거했고 ADR과 이 changelog는 결정 이력으로 보존한다.
- production TypeSpec source와 canonical fixture는 v5 manifest를 사용한다. 이 변경은 contract
  version이나 npm package version을 올리지 않는다.

## 2026-08-10 — Release policy v4 and documentation alignment

현재 release policy를 v4로 승격하고, policy manifest를 기준으로 문서의 workspace 분류와
버전 표기를 정렬했다.

- Core Platform은 `@oa-sdk/typespec-decorators`를 포함한 8개 package이며, Downstream 3개를
  더한 11개 package가 release-tracked다. 10개 maintenance/app workspace는 ignored 상태를 유지한다.
- npm distribution candidate는 core, openapi-projection-contract, typespec-decorators, parser,
  codegen의 5개다. 이 변경은 publish 승인이나 package version bump를 수행하지 않는다.
- `pnpm check:release-policy`는 release-management의 정책 스냅샷을 manifest에서 재계산해
  검증하므로, 이후 수동 count 표기 drift를 gate에서 차단한다.
- OAS 3.2 reference 분할본의 source·appendix 링크를 복구하고 이를 docs gate에 포함했다.
  ADR-004는 canonical 3.2 authoring과 generated 3.1 compatibility output의 경계를 분명히 한다.
- `@oa-sdk/schemas`의 기본 build와 prepack은 canonical TypeSpec contract에서 3.1 bundle을
  생성한다. CI는 bundle을 canonical 3.1 artifact와 비교해 stale package export를 차단한다.
- 사용자 가이드의 contract version 예시와 persona 도구의 merged-spec 복구 안내를
  TypeSpec-first 생산 경로로 정렬했다.
- persona check와 bundle artifact 비교 예제도 rollback source가 아닌 canonical TypeSpec
  artifact를 사용하도록 정리했다.

## 2026-07-25 — TypeSpec external observation evidence

spec-lens의 외부 경로 관측을 typed `observationInputs`로 승격했다.

- `candidate-only`는 revision 후보만 확장하고, `evidence-only`는 revision별 SHA-256 또는
  `missing`/`unreadable` 상태를 TypeSpec snapshot provenance에 보존한다.
- Local Git, GitHub, GitLab, file-diff adapter는 evidence를 data로만 bounded read한다. 이 입력은
  compiler entry, revision `tspconfig`, arbitrary emitter config로 절대 승격되지 않는다.
- 입력은 최대 16개이며, evidence는 파일 최대 4개(각 2 MiB, 총 8 MiB)를 adapter당 동시 2개씩
  읽는다. directory evidence는 `unreadable`로, 없는 경로는 `missing`으로 남긴다.
- 기존 `watchPaths`는 `candidate-only` 호환 별칭으로 유지한다. 실제 TypeSpec emitter fixture와
  adapter/cache/contract 회귀 테스트로 이 경계를 검증한다.

## 2026-07-24 — TypeSpec ownership, trusted helpers, and deployment projections

Production TypeSpec source의 composition/metadata/runtime 관측 경계를 명시적으로
분리했다.

- `main.tsp`는 composition root로 축소하고, service/info/server/tag,
  security scheme, reusable component metadata를 각각 `typespec/metadata/`의 owner
  module로 이동했다.
- `@oa-sdk/typespec-decorators`는 arbitrary JSON extension helper 대신 v5 response
  component reference를 검증하는 좁은 `@oaUseResponseComponent` helper를 제공한다.
  spec-lens는 이 trusted package의 source/lib/dist digest를 toolchain evidence에 포함한다.
- `oa-sdk.typespec-projections.json`과 `schema:project-typespec:{local,staging,production}`은
  restored TypeSpec contract에서 `servers`만 바꾼 gitignored deployment artifact를 만든다.
  이 projection은 승인 snapshot 또는 두 번째 contract source가 아니다.
- spec-lens TypeSpec project는 `observationInputs`로 lockfile, root package, trusted decorator
  package 변경을 관측한다. `evidence-only` lockfile은 hash/status provenance만 남기며, 모든
  observed path와 revision `tspconfig`는 compiler workspace에 실행/주입하지 않는다.

현재 기본 자동 감지 TypeSpec project의 `observationInputs`는 `package.json`, `pnpm-lock.yaml`,
`packages/typespec-decorators`다. 운영 절차는 [TypeSpec authoring conventions](./guides/typespec-authoring-conventions.md),
[basic spec usage](./guides/basic-spec-usage.md), [spec-lens](./spec-lens/README.md)에 정리했다.

## 2026-07-11 — Markdown과 GitLab agent operations 저장소 분리

Core schema/spec management가 아닌 제품 surface를 두 독립 Git 저장소로 물리 추출했다.

- `markdown-editor`: `@oa-sdk/markdown-editor`, GLFM reference, editor PRD와 자체 CI/lockfile을 소유한다.
- `gitlab-agent-ops`: `@oa-sdk/infra-gitlab`, `@oa-sdk/orchestrator-gitlab`, `@oa-sdk/orchestrator-gitlab-ui`, GitLab context 설계와 운영 백로그를 소유한다. Markdown source는 복제하지 않고 `markdown-editor` submodule을 소비한다.

추출 이력은 각 저장소에 보존했다. `oa-sdk`에서는 네 workspace와 관련 product 문서를 제거하고,
release policy를 version 3의 네 track으로 축소했다: Core Platform 6, Downstream 3,
Maintenance 3, Applications 4. Changesets는 기존 9개 release-tracked package와 남은 7개 ignored
workspace만 관리한다. `spec-lens`의 GitLab source adapter는 spec observation 책임이므로 Core에 유지한다.

## 2026-06-22 — TypeSpec-first schema source switch (`@oa-sdk/codegen` 0.3.0)

ADR-009의 TypeSpec-first authoring 결정을 production schema build path에 반영했다. `packages/schemas/typespec/`가 production TypeSpec source bundle이고, 기본 `pnpm schema:validate`, `pnpm schema:bundle`, `pnpm schema:preview`, package-level `build`가 TypeSpec compile + OA SDK extension restore + expected/reference drift gate로 `packages/schemas/src/.merged.yaml`을 생성한다.

OpenAPI/Definition Builder path는 제거하지 않고 explicit rollback/reference command로 유지한다:

- `pnpm schema:validate:openapi`
- `pnpm schema:bundle:openapi`
- `pnpm schema:preview:openapi`
- `pnpm --filter @oa-sdk/schemas run build:openapi`

주요 게이트:

- `pnpm schema:validate` — TypeSpec source path + downgrade + Spectral/Redocly + strict OA SDK OpenAPI 3.2 validate.
- `pnpm schema:rollback-check` — TypeSpec gate와 OpenAPI/Definition Builder rollback gate 동시 검증.
- `pnpm schema:downstream-check` — TypeSpec-restored artifact를 parser/codegen/router/client/mock-server와 synthetic webhook/header compile smoke에 통과.
- `pnpm schema:bundle` — TypeSpec-derived 3.1 artifact를 `dist/openapi.{yaml,json}`으로 bundle.

현재 accepted restored-vs-reference drift는 0 entries다. reusable component identity는 `oa-sdk.typespec-extensions.v5`로 복원했고, response wrapper projection schemas, component schema metadata drift, operation/path metadata drift를 TypeSpec authoring 및 restore normalization으로 제거했다.

운영 정책은 `docs/internal/typespec-roundtrip/production-operations.md`로 분리했다. 당시 `@oa-sdk/codegen` `0.3.0`은 npm publish 대상이 아닌 내부 milestone이었고, rollback command 제거는 별도 deprecation/removal ADR 전까지 보류한다. 이후 제한된 레지스트리 배포 준비 상태는 release management 문서에서 별도로 관리한다.

## 2026-04-28 — SQLite driver priority inverted: prefer node:sqlite

`loadSqliteDriver()`가 `better-sqlite3` → `node:sqlite` 순서로 시도하던 정책을 뒤집어, 사용 가능한 런타임에서는 `node:sqlite`(Node 22.5+ 추가, Node 22.13+에서는 플래그 없이 사용 가능)를 우선 시도하고 `better-sqlite3`는 fallback으로만 사용한다.

근거 — 두 신호로 정책 변경 정당화 (자세한 내역은 `docs/internal/todo.md` "운영 관찰: SQLite optional native dependency 설치성"):

1. **Forced fallback functional**: `packages/codegen/src/__tests__/workspace-index-fallback.test.ts`가 `Module._load`를 monkey-patch해 두 driver 각각 / 양쪽 모두 require 실패시키며 `loadSqliteDriver` + `createSQLiteWorkspaceIndex` lifecycle을 검증. 5 cases pass — fallback 경로에 hardening 필요한 결함 없음.
2. **Driver benchmark**: `packages/codegen/scripts/bench-sqlite-driver.ts`가 75 file × 5 components × 5 refs 워크로드를 cold/warm 단계로 측정 (Node 24.15 / darwin arm64 / median of 3):
   - cold: better-sqlite3 22.2ms vs node:sqlite 26.6ms — 15-17% 차이 (≥30% 임계 미달)
   - warm: better-sqlite3 11.5ms vs **node:sqlite 7.9ms** — node:sqlite가 40-46% 더 빠름

Incremental 도구의 일반 동작은 warm path이므로 두 번째 결과가 더 결정적. 추가 효과: `better-sqlite3`는 native optional dep이라 환경별 install 실패 가능성이 있는데, node:sqlite를 우선하면 그 경로를 거의 타지 않는다.

호환성 영향:
- 기존 SQLite cache는 driver name이 meta에 저장되어 있어 첫 실행 시 `cache invalidation + full rebuild` 1회 발생. 이후 정상 동작.
- Node <22 환경에서는 자동으로 `better-sqlite3` fallback으로 감 (설치되어 있다면).

## 2026-04-27 — External OpenAPI Artifact Governance Scaffold

NestJS Swagger / FastAPI처럼 외부 프레임워크가 생성한 OpenAPI 산출물을 oa-sdk 계약 관리 파이프라인에 표준 방식으로 연결하는 일련의 도구가 추가되었다.

### CLI surface

`@oa-sdk/codegen`에 4개 명령 추가 (oa-gen CLI 명령 17 → 21):

- `oa-gen scaffold-governance --root <서비스> --service <이름> --profile <generic|nestjs-swagger|fastapi> [--source-command "..."] [--runtime-openapi-url "..."]` — `openapi-governance.config.json`(`oa-gen.openapi-governance.v1` schema), `scripts/openapi-governance.sh`, `openapi-governance.md`를 생성하고 contracts/scripts/src 디렉토리를 만든다.
- `oa-gen collect --spec <raw> --normalized <out> --upgraded <out> [--report <out>] [--raw <copy>] [--profile <profile>]` — raw 보존 + normalized governance artifact + OpenAPI 3.2 분석 artifact + collect report를 한 번에 생성.
- `oa-gen normalize --spec <raw> [--output <out>] [--profile <profile>]` — 의미 보존 normalize만(stable diff용).
- `oa-gen upgrade --spec <normalized> [--output <out>] [--report <out>]` — 3.0/3.1 → 3.2 변환만.

### Reference implementation

두 개의 작동하는 레퍼런스가 같은 scaffold 출력을 사용한다 — profile만 다름:

- `apps/nestjs-ref/` — NestJS 10 + Swagger 7 (TypeScript / pnpm), `--profile nestjs-swagger`.
- `apps/fastapi-ref/` — FastAPI 0.115 + Pydantic 2 (Python / uv), `--profile fastapi`.

두 곳 모두 `bash scripts/openapi-governance.sh all`이 collect → check-artifact → review → typegen → validate-upgraded까지 통과한다. `review-bundle`/`inventory`/`drift`/`update-baseline`도 별도 타깃으로 노출. FastAPI/NestJS profile은 빈 `info.contact` / 루트 `servers` / 루트 `tags` noise 제거 동작을 공유한다 (generic profile은 보존).

### Hardening

여러 라운드에 걸친 안정화:

- **Upgrade 재귀 보강**: `nullable: true`가 `paths`/`webhooks`/`components.{schemas,responses,parameters,requestBodies,headers,callbacks,pathItems}` 어디에 있어도 3.2 null union으로 변환. 이전엔 `#/components/schemas`만 처리해 inline schema가 누락되었음.
- **Clone 안전성**: `cloneJson`이 `structuredClone` 사용 — `JSON.parse(JSON.stringify())`로 인한 undefined/NaN 손실 제거.
- **Repo root 자동 감지**: 스크립트가 `git rev-parse --show-toplevel` 우선, 기존 `apps/<service>` 2-deep 가정은 fallback. 다른 깊이에서도 동작.
- **Friendly missing-baseline**: 첫 실행 시 baseline 없으면 `update-baseline` 힌트와 함께 exit 1.
- **Shell hardening**: `OA_GEN` env가 `read -ra OA_GEN_CMD <<<`로 split되어 glob 확장 없음. `--source-command`는 trusted 셸 입력임을 rendered 스크립트 주석으로 명시.
- **Runtime URL 검증**: `--runtime-openapi-url`을 scaffold time에 `URL` 파서로 검증, http(s) 외 protocol 거절.
- **Drift 인자 forwarding**: `bash scripts/openapi-governance.sh drift --runtime-header "Authorization: Bearer $TOKEN"`처럼 추가 인자 그대로 전달.
- **Consumers field가 source of truth**: rendered 스크립트가 `consumers.{governance,review,typegen,inventory,validate,driftManaged}` 매핑을 셸 변수명으로 해소해 baked. 알 수 없는 mapping은 scaffold time 거절.
- **Config fingerprint**: 렌더링된 스크립트 헤더 `# config fingerprint: <16자 sha256>` 라인이 profile/source/artifacts/consumers 정렬 직렬화 해시. JSON hand-edit 후 re-scaffold 누락 시 visible 신호. `fingerprintGovernanceConfig()` public helper로 외부 도구가 재계산 가능.

### Public API

`@oa-sdk/codegen` root entry에 추가 export:

- 함수: `parseOpenApiCollectProfile`, `normalizeOpenApiDocument`, `upgradeOpenApiDocumentTo32`, `stringifyOpenApiYaml`, `createOpenApiCollectReport`, `createOpenApiGovernanceInterface`, `scaffoldOpenApiGovernance`, `formatScaffoldResult`, `fingerprintGovernanceConfig`
- 타입: `OpenApiCollectProfile`, `OpenApiCollectReport`, `OpenApiTransformWarning`, `OpenApiUpgradeReport`, `OpenApiGovernanceInterface`, `OpenApiGovernanceScaffoldOptions`, `OpenApiGovernanceScaffoldResult`

### Docs

- 신규: [`docs/guides/use-cases/nestjs-swagger-governance.md`](./guides/use-cases/nestjs-swagger-governance.md), [`apps/nestjs-ref/README.md`](../apps/nestjs-ref/README.md).
- 갱신: [`docs/guides/openapi-governance-service-template.md`](./guides/openapi-governance-service-template.md)(Adoption Checklist를 external-artifact / Definition Builder 두 경로로 분리), [`docs/guides/cli-setup.md`](./guides/cli-setup.md), [`README.md`](../README.md), [`docs/internal/api-index.md`](./internal/api-index.md), [`docs/internal/feature-test-matrix.{md,json}`](./internal/feature-test-matrix.md), [`docs/internal/spec.md`](./internal/spec.md).

### Gates

- 47 test files / 648 tests passing.
- `pnpm check:cli-spec` — 22 command entities (oa-gen 15 + oa-contract 7 manifest entries; the runtime CLI itself exports 21 commands, of which 15 are governance-tracked).
- `pnpm check:api-index` — exports와 문서 정합.
- `pnpm check:feature-tests` — 23 features / 86 test paths (신규 `external-openapi-governance-scaffold` 항목 등록).
