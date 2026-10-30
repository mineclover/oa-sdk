# 개별 기능 리뷰 — 2026-10-26

> 이 문서는 날짜별 관측·수정 기록이다. 현재 보장과 결함 상태의 정본은 [검증 원장](../internal/verification/registry.json), 읽기용 현황은 [자동 생성 상태](../internal/verification/status.md)다.


기준은 HEAD `020ec128`와 현재 작업트리다. [기능 선택 지도](../guides/feature-map.md)의 세부 기능18개를 대상으로 진입점·대표 코드·회귀 테스트를 대조했다. 미커밋 확장은 별도로 분류했다. 모든 함수·입력·플랫폼을 전수 검증한 결과가 아니며 npm 배포 상태는 조회하지 않았다. 1차 리뷰에서는 구현/기존 테스트를 변경하지 않았다. 이후 수정은 아래 「수정 결과」에 기록한다. FR-01~04와 TEST-01의 재현 및 행 번호는 수정 전 관측이다.

현재 상태: 1차 발견 FR-01~04 및 TEST-01은 수정 완료. 2차 검토에서 FR-05~09를 추가 재현했으며 아래에 미수정 상태로 기록했다.

## 주요 판단

기존 생성·소비·검증·런타임의 선별 회귀는 대체로 통과했다. 미커밋 도구 실행 확장에서 **P1 세 건과 P2 한 건**을 재현했고, 후속 수정에서 모두 보완했다. 이 네 건을 기존 배포 package 전체의 결함으로 일반화하지 않는다.

### FR-01

**[P1] MCP 확인 기능이 없으면 파괴적 commit이 그대로 실행된다.** [openapi-hydrator.ts](../../packages/tools/src/openapi-hydrator.ts) 540–545행은 executionModel이 `two-phase-elicit-commit`이어도 `ctx.elicit`이 함수일 때만 확인한다. MCP host가 이 기능을 제공하지 않고 `confirm`도 없으면 commit으로 진행한다. 직접 execute와 실제 `registerToolsOnMcpUse` binding 양쪽에서 synthetic mutation1회, `isError=false`를 확인했다. 도구 metadata와 TypeSpec `pipelineDestructive`가 선언하는 plan→elicit→commit을 필수 확인 보장으로 사용할 수 없다. MCP의 이 executionModel에서는 확인을 얻지 못한 경우 거부/지연하고, 별도 non-interactive 허용 정책이 필요하면 명시적으로 구분해야 한다.

### FR-02

**[P1] undo snapshot을 켜면 변경 commit의 exclusive lock이 생략된다.** [openapi-hydrator.ts](../../packages/tools/src/openapi-hydrator.ts) 597–600행의 조건은 `exclusive-file && !undoSnapshot`이다. snapshot 저장 자체는 나중에 잠기지만 실제 mutation은 lock 밖에서 실행된다. 같은 project의 두 commit이 동시에 진입했고 최대 중첩2, counter 기대2/실제1로 갱신 유실을 재현했다. commit과 snapshot을 동일 project의 한 잠금 범위로 묶되, `recordMutation()`의 내부 잠금을 그대로 중첩해 deadlock을 만들지 않도록 단일 획득 경로를 설계해야 한다.

### FR-03

**[P1] Standard Schema wrapper가 원본 Zod 검증 의미를 잃는다.** [standard-schema.ts](../../packages/tools/src/standard-schema.ts) 76–80행은 원본 schema 대신 JSON Schema로 정규화한 객체를 검증한다. `z.string().refine(v => v === 'allowed')`가 `denied`를 거부하고 기존 `validateToolInput`도 거부하지만 새 wrapper는 성공으로 반환했다. `z.string().trim()`은 원본에서 공백을 제거하는데 wrapper는 공백이 남은 값을 반환한다. JSON Schema는 설명/노출용으로 유지하고 실제 parse/validate에서는 원본 validator의 refinement·변환·출력을 보존해야 한다. customGuard의 false 이후 JSON Schema fallback도 관측됐으며, 그 매개변수가 fast path인지 추가 제약인지 별도 계약 명시가 필요하다.

### FR-04

**[P2] 서로 다른 프로젝트가 세션·undo 이력을 공유할 수 있다.** [reserved-interfaces.ts](../../packages/tools/src/reserved-interfaces.ts) 221–223행은 모든 허용되지 않은 문자를 `_`로 치환한다. `team/a`와 `team_a`가 같은 파일을 가리켜, 후자를 읽어도 전자의 projectId와 currentState가 반환됐다. `..`도 허용되어 `sessions`의 상위 `.cli-anything/session.json`에 기록됐다. 프로젝트 key를 충돌 없이 인코딩/hash하고 dot segment를 거부하며, 저장된 projectId와 요청 ID도 확인해야 한다.

## CLI 회귀 fixture 문제

### TEST-01

**[P2, 테스트 환경] freshness CLI fixture에 Zod 의존성이 없다.** [drift-check-cli.test.ts](../../packages/codegen/src/__tests__/drift-check-cli.test.ts) 10–12행은 빈 임시 workspace를 만들고 schema 파일에서 `zod`를 import한다. 원래 환경에서는 테스트11개 중9개가 `generate` 단계의 `Cannot find module 'zod'`로 실패해 freshness 검증에 도달하지 못했다. 같은 생성 입력에 해당 의존성을 연결하면 exit0이며, 소스·기존 assertion을 바꾸지 않고 `NODE_PATH`로 fixture 의존성을 보충해 기존 테스트11/11이 통과했다. 제품이 의존성 없는 프로젝트에서 실패하는 동작과 회귀 fixture의 준비 누락을 구분해야 한다. fixture가 필요한 의존성을 직접 준비하도록 수정하고 전체 테스트가 실제 검사 단계에 도달하게 해야 한다.

## 세부 기능별 결과

표의 테스트 ID는 아래 실행 묶음을 뜻한다. 한 묶음이 여러 기능을 확인할 수 있으며 반복 합산하지 않는다. `집중 확인`은 선택한 경로에서 실패를 발견하지 않았다는 뜻이다.

| 단계·기능 | 실행/검토 근거 | 판단·남은 범위 |
| --- | --- | --- |
| 1. 프로젝트 도입·init | CG2 init fixture | 집중 확인. 모든 scaffold/실제 배포 조합을 실행한 것은 아님 |
| 1. TypeSpec·계약 작성/수집/정규화 | CG1 collection·TypeSpec builder, DEC | 집중 확인. 저장소 production 승인/write workflow는 실행하지 않음 |
| 1. Zod/Drizzle·TypeScript 연결 | CG1 Zod, GOV Drizzle converter/extractor | 변환 대표 경로 확인. 실제 DB migration/모든 ORM 타입 보장 없음 |
| 2. 타입·Zod·guard 생성 | CG1 purpose/builder, GUARD | 집중 확인. 원본 자료형 전체 및 CSP 전체 산출물 감사는 미실행 |
| 2. 백엔드 핸들러·라우터 | ROUTER, CG2 generate/companion | 생성 경로 확인. 네 프레임워크를 새로 띄운 서비스 E2E는 미실행 |
| 2. 클라이언트·Query | CLIENT | 생성·signal·SSE·Query 대표 경로 확인. 실제 React 앱/원격 API는 미실행 |
| 2. Forge·RPC 계약 투영 | CG1 surface/plugin-rpc, RPC | 집중 확인. 사용자별 Forge 실계정 호출은 미검증 |
| 2. TypeSpec builder·출처 | CG1, CG2 traceability | 구성·생성·출처 대표 경로 확인. Vite HMR 실앱은 미실행 |
| 3. RPC 호출·제공 | RPC | unary/REST/JSON-RPC 대표 경로 확인. streaming은 문서상 지원 범위 밖 |
| 3. tools MCP·CLI·HTTP | TOOLS와 개별 오류 재현 | 기존 boundary/JSON tool 경로 확인. 추가 확장 FR-01~04 수정 및 경계 회귀 추가 완료 |
| 3. WebMCP peer·routing | PEER protocol conformance | 프로토콜 대표 경로 확인. 실제 브라우저/WebRTC·relay 운영은 미검증 |
| 4. OpenAPI parse·ref·lint·validate | PARSER | 집중 확인. OAS 모든 입력/외부 참조 조합을 전수 검증하지 않음 |
| 4. mock·watch | MOCK | HTTP/validation 등 unit/integration 확인. 사용자 원본 watch 실환경 재현은 미실행 |
| 4. diff·drift·freshness·review | GOV, CG2, TEST-01 분리 재실행 | 선택 경로 확인. TEST-01 수정 후 기본 환경에서 기존 11개 회귀 통과 |
| 4. Spec-Lens 이력·검토 | LENS cache/timeline/snapshot diff | 로컬 저장/변경 대표 경로 확인. 외부 GitLab·UI 전체는 미검증 |
| 5. chunk·시계열·재생 | CHUNK, CRDT | bounded chunk/CRDT 확인. timeseries·UI·React package 테스트는 이번에 미실행 |
| 5. 협업 상태·lattice | COLLAB | 메모리 state/lock 대표 경로 확인. 다중 호스트 협업 서비스 검증은 아님 |
| 5. telemetry | TELEMETRY | registry/dispatcher/HMAC/XState 대표 경로 확인. 외부 provider 실계정 전송은 미실행; traceparent 전파는 문서상 미구현 |

## 미커밋 확장과 별도 범위

- TypeSpec tool pipeline metadata: DEC의5개 회귀는 통과했다. metadata 방출 성공과 runtime의 확인·잠금 보장은 별개이며 FR-01/02는 후자에서 발견됐다.
- Standard Schema/OpenAPI hydrator/CLI-Anything/mcp-use/session: 1차 TOOLS 회귀가 놓친 오류·경계 입력에서 FR-01~04를 재현했고, 후속 수정에서 회귀 테스트로 고정했다.
- Table IR·로컬 file I/O: 기존 pipeline test 안의 여섯 자체 생성 fixture 형식은 확인했다. 임의 OOXML 문서·Office/Google/Notion 실제품 상호운용을 검증한 결과는 아니다.
- DPM 외부 owner mirror, personas, logical ERD prototype, TypeSpec IDE tooling, ttsc fixture는 이번 심층 실행 범위에 포함하지 않았다. 공개/저장소 전용/maintenance 경계는 기능 지도와 release policy를 따른다. 같은 이름의 외부 DPM npm package 상태를 이 리뷰로 단정하지 않는다.

## 선별 테스트 실행 기록

Node24.22.1 / Vitest4.1.12에서 소스를 대상으로 실행했다. 아래는 package 전체 검사나 publish/운영 인증이 아니며, 실제 프로젝트가 사용하는 설치·runtime 조합과 별도다.

| ID | 선택 범위 | 파일 | 결과 |
| --- | --- | --- | --- |
| CG1 | codegen collection/Zod/purpose/builder/surface/RPC/companion | 7 | 169/169 |
| CG2 | codegen init/generate/pruning/traceability | 16 | 302/302 |
| GOV | codegen diff/TSP diff/drift/review/Drizzle | 7 | 원래 환경118통과·9실패(TEST-01), 총127 |
| PARSER | parse/validate/ref/lint | 4 | 78/78 |
| GUARD | AST guard rendering/tier/split/dotted names | 4 | 10/10 |
| ROUTER | handler/router/accept negotiation | 3 | 58/58 |
| CLIENT | generation/signal/SSE/Query | 4 | 117/117 |
| RPC | unary/REST/JSON-RPC/wire hardening | 2 | 56/56 |
| TOOLS | hydrator pipeline/boundary/security | 3 | 33/33 |
| DEC | TypeSpec tool pipeline | 1 | 5/5 |
| MOCK | unit/integration HTTP·validation·streaming | 41 | 738/738 |
| LENS | SQLite cache/timeline/snapshot diff | 3 | 48/48 |
| PEER | protocol conformance | 1 | 11/11 |
| CHUNK | bounded stream | 1 | 15/15 |
| CRDT | chunk metadata merge | 1 | 7/7 |
| COLLAB | state/intent lock | 1 | 9/9 |
| TELEMETRY | dispatcher/registry/HMAC/envelope/XState | 7 | 99/99 |

원래 실행 17묶음·106파일·1,882테스트에서 **1,873통과/9실패**다. 의존성 보완 환경에서 TEST-01의 동일11개를 재실행해11/11을 확인했으며 이 중복 실행을 합계에 다시 넣지 않았다. 이 수치는 1차 리뷰 기록이며, 후속 TEST-01 수정으로 기본 실행 환경의 누락도 보완했다. 기능 결함4건은 별도 synthetic 오류 재현이며 위 회귀 통과 수에 포함하지 않았다.

재현 스크립트·원시 결과·테스트 로그는 `/tmp/oa-feature-review-20261026/`에 보관했다. `probes.mts`/`probe-results.json`이 FR-01~04, `mcp-surface-probe.mts`가 실제 binder의 FR-01, `drift-fixture-probe.mts`와 의존성 보완 테스트 로그가 TEST-01 근거다. 새 오류 재현의 변경 효과는 임시 폴더/메모리로 제한하고 정리했다. 회귀 검사는 각 테스트의 로컬 fixture/server를 사용했으며 실제 사용자 session이나 운영 서비스를 변경하지 않았다.


## 수정 결과 — 2026-10-26

사용자 요청에 따라 기능 결함 4건과 fixture 문제 1건을 수정했다.

| 항목 | 수정 | 회귀 근거 |
| --- | --- | --- |
| FR-01 | 확인 필수 execution model은 모든 실행 표면에서 `confirm === true` 또는 `action=accept`와 `data.confirm === true`를 요구한다. 확인 host가 없거나 응답이 불완전하면 commit 전에 실패한다. 단일 단계 handler에도 적용하며 CLI에 `--confirm`을 노출한다. dry-run은 확인 없이 계획만 수행한다 | MCP 실제 binding의 확인 기능 부재, 거절·취소·불완전 응답, 명시적 승인, CLI 확인, dry-run |
| FR-02 | `FileSessionStore.commitMutation()`이 상태 capture·domain commit·snapshot 저장을 같은 프로젝트의 단일 파일 잠금에서 실행한다. 단일 단계 실행도 동일 경계를 사용하며 내부 잠금을 중첩하지 않는다 | 독립 store 인스턴스의 같은 프로젝트 동시 commit, 정확한 snapshot 순서, undo/redo, commit 예외 후 잠금 해제, snapshot 비활성화 |
| FR-03 | runtime 검증은 원본 parser에 위임한다. JSON Schema는 노출용으로 유지하고, 선택 `customGuard`는 parse된 출력에 추가 제약으로 적용한다 | Zod refinement 거부·trim 반환값, 모든 validation API, custom parser와 출력 guard, JSON component reference |
| FR-04 | 프로젝트 ID의 정확한 UTF-16 code unit을 SHA-256 key로 변환하고 빈 ID·dot segment를 거부한다. 저장된 projectId가 요청과 다르면 거부한다. 일치하는 legacy session은 읽고 다음 쓰기에서 새 경로에 저장한다 | 구분자·Unicode·lone surrogate ID 분리, 프로젝트별 undo/redo, invalid ID에서 파일 생성 없음, legacy 이력 보존, identity 불일치 시 domain commit 차단 |
| TEST-01 | 임시 CLI workspace에 테스트가 import하는 Zod 패키지 링크를 준비한다 | `NODE_PATH` 없이 기존 freshness CLI 테스트 11/11 통과 |

새 회귀는 [tool-pipeline-regressions.test.ts](../../packages/tools/src/tool-pipeline-regressions.test.ts)에 24개를 추가했다. 수정 전 최초 21개 중 14개가 실패했고, 보완한 24개를 포함한 tools 전체 11파일·102테스트가 통과했다. API 인덱스에서 도구/TypeSpec 미커밋 확장의 누락 export도 문서화했다. 아래 검증은 Node 24.22.1에서 수행했으며 로그는 `/tmp/oa-feature-fixes-20261026/`에 보관한다.

잠금은 commit과 session 이력을 직렬화한다. 미리 계산한 plan의 도메인별 최신성 검증, domain 쓰기 후 snapshot I/O가 실패했을 때의 rollback, 프로세스 중단 후 lock 복구까지 보장하지 않는다. 새 session 경로가 우선하며 legacy 원본은 삭제하지 않는다. legacy 파일의 프로젝트 ID가 다르면 자동 덮어쓰기 없이 오류로 중단한다.


| 최종 검증 | 결과 |
| --- | --- |
| tools 전체 | 11파일·102테스트 통과. 새 회귀 24개 포함 |
| freshness CLI 기본 환경 | 1파일·11테스트 통과. `NODE_PATH` 제거 후 실행 |
| 핵심 계층 전체 | 5,669테스트 통과. codegen 212파일·4,041테스트 포함. Spec-Lens 4테스트 skip |
| downstream 전체 | 2,519테스트 통과 |
| workspace 타입 검사 | 37개 workspace 범위, 의존 빌드 포함 56개 task 통과. tools는 최종 수정 후 별도 재검사 통과 |
| 핵심 빌드 및 tools 최종 빌드 | 통과. tools ESM·DTS 생성과 빌드 entrypoint의 parser/session smoke 확인 |
| 문서·CLI·release policy·API index | 4개 정적 gate 통과. release policy/preflight의 자체 회귀 스크립트도 통과 |
| 기존 merged OpenAPI 3.2 구조 검사 | 읽기 전용 CLI 검증 통과. 스키마 원본 재생성·production 승인 실행은 하지 않음 |
| 변경 형식 | `git diff --check` 통과 |

핵심/downstream의 전체 task에는 Turbo cache 재사용이 포함된다. tools 전체 및 freshness fixture는 소스에서 별도로 실행했다. 중복 실행을 제외한 두 계층 합계는 **8,188개 통과**이며, 운영 서비스 연결이나 배포 검증을 의미하지 않는다.


## 8,188개 통과의 구성과 의미

이 수치는 앞선 수정 검증의 Vitest **test case** 합계다. 기능 개수·assertion 개수·전체 제품 시나리오 수가 아니다. `it.each`로 펼쳐진 입력은 각각 1개로 세고, 한 `it` 안의 여러 assertion이나 반복문은 합쳐 1개다. 예를 들어 tools의 여섯 파일 형식 읽기/쓰기 검사는 한 `it` 내부 반복이어서 1개로 집계된다.

| 계층 | 그 실행에서 직접 실행한 통과 case | Turbo cache의 이전 통과 결과 | 통과 합계 |
| --- | ---: | ---: | ---: |
| 핵심 | 4,579 | 1,090 | 5,669 |
| downstream | 1,423 | 1,096 | 2,519 |
| 합계 | **6,002** | **2,186** | **8,188** |

통과 파일은 476개다. Spec-Lens의 skip 1파일·4case는 통과 합계에서 제외했다. Turbo task 수에는 의존 빌드가 섞이므로 위 테스트 case 합계와 다르다. 별도로 실행한 tools 102개와 freshness CLI 11개를 합계에 중복 가산하지 않았다. 타입 검사·빌드·거버넌스 검사도 8,188개에 포함하지 않았다.

아래 「직접」/「cache」는 당시 core/downstream 실행의 로그 기준이다. 목적 설명은 실제 테스트 파일의 범위를 요약한 것이며 해당 기능의 모든 입력·환경을 보증하지 않는다.

| 계층 | package | case | 결과 출처 | 검사 내용 |
| --- | --- | ---: | --- | --- |
| 핵심 | codegen | 4,041 | 직접 | TypeSpec/Zod/Drizzle 수집·변환, 타입·guard·router/client/RPC 생성, purpose 격리, CLI init/generate/validate/diff/drift/review, 출력 경로·manifest pruning·출처·CSP·adversarial/E2E |
| 핵심 | parser | 692 | cache | OpenAPI parse/validate, $ref 해결·순환·정의 registry/target 선택, lint·충돌·진단 |
| 핵심 | openapi-projection-contract | 197 | cache | projection envelope·extension·profile 검증, discriminated union 및 손실 방어 |
| 핵심 | spec-lens | 180 | 직접 | SQLite cache, tsconfig 무효화, snapshot/diff/timeline, query·pagination, Git/API source budget |
| 핵심 | core | 119 | cache | 프로젝트 root 탐색, wire/HTTP response, 문자열·형식·codegen 공통 유틸리티 |
| 핵심 | typespec-decorators | 113 | 직접 | TypeSpec decorator metadata·diagnostic·provenance 및 tool pipeline preset |
| 핵심 | tools | 102 | 직접 | schema 검증, handler·middleware, MCP/HTTP/CLI·보안 경계, peer/chunk 연결, 미커밋 hydrator·파일 I/O 및 새 회귀 24개 |
| 핵심 | ast-sync | 81 | 직접 | AST 동기화·의미 추출·guard rendering 및 코드 보존 |
| 핵심 | schemas | 62 | 직접 | OpenAPI upgrade/downgrade·무손실 roundtrip·정의 fixture |
| 핵심 | surface-ir | 42 | cache | surface IR·hash·interface sketch·현재 spec·RPC contract |
| 핵심 | spec-lens-contract | 40 | cache | 계약 export·시나리오 흐름 모델·검증 |
| downstream | webmcp-peer | 864 | 직접 | WS frame·body/메시지 제한, session·tool routing, 승인 lease, provider 등록·재접속·catalog, backpressure·오류·로컬 E2E |
| downstream | mock-server | 815 | cache | HTTP·validation·data generation·CRUD·state, middleware·streaming·adapter, 보안·오류·network chaos |
| downstream | client | 277 | 직접 | 생성 client, TanStack Query·무한 목록, AbortSignal, SSE·chunk, MessagePack/binary·CRDT |
| downstream | router | 209 | 직접 | 생성 router·handler/context 계약, Fastify/Elysia/Hono, streaming, binary·Accept negotiation·edge/stress |
| downstream | telemetry | 99 | cache | registry·dispatcher·HMAC·envelope·XState |
| downstream | peer-server | 74 | cache | peer server 등록·signaling·연결 lifecycle·정책 경계 |
| downstream | rpc | 56 | 직접 | unary RPC·REST/JSON-RPC와 wire 오류·경계 처리 |
| downstream | peer-transport | 55 | cache | transport·protocol·연결/전송 계약 |
| downstream | mcp-mesh | 17 | 직접 | mesh·peer allowlist·CLI |
| downstream | chunk-stream | 15 | cache | bounded chunk 저장·읽기·범위 |
| downstream | chunk-stream-ui | 11 | cache | chunk UI 계층의 상태/도우미 |
| downstream | collab-workspace | 9 | cache | 협업 state·lock |
| downstream | chunk-stream-crdt | 7 | cache | chunk metadata의 CRDT merge |
| downstream | chunk-stream-react | 6 | cache | React chunk hook/연결 |
| downstream | chunk-stream-timeseries | 5 | cache | 시계열 chunk 처리 |

[파일별 case 수와 cache 출처 원장](test-evidence-2026-10-26.json)은 저장한 로그를 파싱한 통과 476파일과 skip 1파일의 목록이다. 자동 합산으로 통과 파일 수 476과 통과 case 수 8,188을 확인했다. 통과 수는 이미 작성된 기대 조건을 만족했다는 증거이며, 기대 조건이 없는 동작이나 자기 writer로 만든 fixture만으로 검증한 상호운용까지 보증하지 않는다. 2차 검토의 새 재현은 이 합계에 포함하지 않았다.

## 2차 검토 — 실제 변경 효과와 파일 보존

추가 검토는 미커밋 tools 확장의 표 변경·session undo·CSV·XLSX에 집중했다. 다음 5건은 임시 데이터에서 재현했고 아직 수정하지 않았다. 이전 수정 FR-01~04를 재개방한 것이 아니라 해당 수정과 별개의 남은 조건이다.

### FR-05 — [P1] 표 handler가 오래된 plan을 검증 없이 commit한다

[table-ir.ts](../../packages/tools/src/table-ir.ts)의 `createTableApplyTwoPhaseHandler` 378–384행은 plan 시 읽은 표의 `previewIr`을 commit에서 바로 `onCommit`에 넘긴다. commit 시 현재 표를 재조회하거나 `beforeFingerprint`를 대조하지 않는다. 같은 프로젝트의 서로 다른 셀을 바꾸는 두 호출이 모두 `[0,0]`에서 계획을 만들도록 동기화한 뒤 hydrated tool을 실행했다. 파일 잠금은 두 commit을 직렬화했지만 결과는 기대 `[1,1]` 대신 `[0,1]`이었다. 두 호출 모두 성공이며 snapshot도 2개 남는다. FR-02의 commit 잠금 수정은 유효하지만 plan의 최신성 보장은 별도다. built-in table handler가 잠금 안에서 현재 fingerprint를 확인하고 충돌을 거부하거나, 명시된 재계획 정책을 적용해야 한다.

### FR-06 — [P1] session undo가 실제 domain 상태를 복원하지 않는다

[mcp-use.ts](../../packages/tools/src/mcp-use.ts) 185–197행과 [cli-anything.ts](../../packages/tools/src/cli-anything.ts) 216–225행은 session JSON의 이력 이동만 호출한다. `TwoPhaseMutationHandler.restoreState`는 선언되어 있지만 소비하는 호출이 없다. 실제 MCP binding에 capture/restore handler를 등록한 재현에서 적용 후 `session_undo`가 `undone:true`와 session 값 0을 반환했지만 domain 값은 1이고 restore 호출은 0회였다. 앞선 undo/redo 회귀는 session 이력의 정합성을 검사했으며 실제 domain 복원을 보장한 검사가 아니다. 실제 작업 undo로 제공하려면 snapshot의 operationId에 대응하는 restore와 이력 이동을 같은 잠금 안에 연결하고 실패 시 성공 응답·이력 이동을 방지해야 한다. history 전용 계약이라면 도구 이름/설명/응답을 그 범위로 명확히 제한해야 한다.

### FR-07 — [P2] CSV의 따옴표 안 줄바꿈을 행 경계로 오독한다

[table-file-io.ts](../../packages/tools/src/table-file-io.ts) 778–782행은 quote 상태를 해석하기 전에 전체 문자열을 줄별로 나눈다. `id,note\r\n1,"hello\r\nworld"\r\n`은 한 데이터 행이어야 하지만 실제로는 2행, 셀 `[1,"hello","world",null]`로 읽힌다. 같은 파일을 쓰면 잘못 나뉜 행이 확정된다. 따옴표 상태를 레코드 경계까지 유지하는 parser와 multiline·escaped quote·빈 레코드 회귀가 필요하다. 기존 파일 I/O 회귀의 CSV fixture는 줄바꿈 없는 단순 셀이라 이 조건을 확인하지 않는다.

### FR-08 — [P1] XLSX를 변경 없이 다시 저장해도 병합·검증 정보가 사라진다

[table-file-io.ts](../../packages/tools/src/table-file-io.ts) 224–269행은 선택 worksheet XML을 새 `<sheetData>`만 포함하는 문서로 교체한다. ZIP의 다른 entry를 보존해도 대상 worksheet 내부의 `mergeCells`·`dataValidations`를 보존하지 않는다. 두 요소를 포함하는 임시 XLSX를 읽고 변경 없이 같은 경로에 쓴 결과 두 요소가 모두 사라졌으며 IR fingerprint는 같았다. 따라서 현재 fingerprint 비교나 자체 생성 fixture roundtrip으로는 이 손실을 탐지하지 못한다. 원본 XML의 변경 대상만 수정하거나, 보존 불가능한 문서를 명시적으로 거부하는 정책이 필요하다.

### FR-09 — [P1] XLSX 시트 이름과 실제 읽기/쓰기 대상이 달라질 수 있다

[table-file-io.ts](../../packages/tools/src/table-file-io.ts) 327–339행은 workbook 순서에서 이름을 고르지만 내용은 `sheet{index+1}.xml`에서 읽는다. workbook의 relationship에 따른 target을 사용하지 않는다. 첫 시트 Budget이 `rId2 → sheet2.xml`을 가리키고 두 번째 Notes가 `rId1 → sheet1.xml`을 가리키는 임시 파일에서 `tableIndex:0`은 이름 Budget과 Notes의 값 1을 반환했다(기대 Budget 값 999). `sheetEntryPath`도 sheet1로 저장되어 이후 write는 Notes를 수정할 수 있다. 선택한 workbook sheet의 relationship ID에서 실제 worksheet part 경로를 해결해야 한다.

재현은 `/tmp/oa-feature-review-round2-20261026/probes.mts`이며 결과는 같은 폴더의 `results.json`이다. 모든 assertion이 재현된 결함을 확인하며 사용자 문서나 외부 서비스는 변경하지 않았다. 기존 통과 테스트 수를 늘리기 위한 재실행은 하지 않았다.


## 관리 구조로 이관

과거 8,188개 집계는 source hash가 없는 이력으로 보존했다. 보장 검증에 쓸 tools 102개와 freshness 11개는 native Vitest JSON으로 새로 직접 실행하고 별도 artifact로 등록했다. 둘은 과거 수에 더하지 않는다. FR-01~04/TEST-01의 종료 근거, FR-05~09의 재현과 종료 조건, 명시적 미검증 범위를 registry로 옮겼다. 재현 script와 관측 JSON도 저장소에 보존했으며 경로와 source hash를 관리 gate에서 검사한다.
