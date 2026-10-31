# 시맨틱 추상화 계약과 스키마 선언·Codegen 책임 경계

상태: active (소유·책임 경계) · proposed (의미 참조·불완전 상태 표현 후보)
최종 검토: 2026-11-01
정본: `docs/internal/contract-boundaries.md`, `docs/internal/architecture/semantic-abstraction-contract-boundary.md`

> [!IMPORTANT]
> **비채택·비배포 경계 선언 (Non-Adoption & Non-Distribution Notice)**
> 이 문서는 Semantic Platform, `oa-sdk`, 그리고 다운스트림 도메인·어댑터 사이의 **책임 경계와 참조 규칙을 정리하는 아키텍처 문서**입니다.
> - 이 문서 변경은 **신규 공통 TypeSpec 모델, OpenAPI/JSON Schema, 런타임 패키지 API의 채택을 의미하지 않으며**, 새로운 codegen 산출물이나 npm 아티팩트 배포를 수반하지 않습니다.
> - `Term`·`Expression`·`SemanticFrame`·`ReusablePattern`·`DomainConcept`·`Assertion`·`Projection`의 의미 정의·판본·채택 권위는 **Semantic Platform**에 있으며, `oa-sdk`에서 이를 재정의하거나 재관측하지 않습니다.

---

## 1. 배경과 핵심 원칙

`oa-sdk`는 여러 플랫폼과 소비자가 공유하는 스키마 선언(TypeSpec `.tsp`, OpenAPI 3.2/3.1, JSON Schema Draft 2020-12)과 검증 DTO·타입·클라이언트·라우터 codegen의 기반 계층입니다. 범용 언어 추출과 재사용 가능한 의미 추상화가 여러 저장소로 투영될 때, **의미 권위(Semantic Authority)** 와 **스키마 선언·코드 생성 책임(Contract Declaration & Codegen)** 이 섞이면 generated DTO나 저장 포맷이 의미 정본처럼 오인되는 문제가 발생합니다.

이를 방지하기 위해 다음 4가지 불변 원칙을 고정합니다.

1. **의미 권위와 와이어 스키마의 분리**: Semantic Platform이 개념의 의미·관계·판본(`revision`)·카탈로그 핀(`catalog pin`)·채택 여부를 소유하고, `oa-sdk`는 승인된 교환 계약의 구조 선언·정규화·검증·codegen·호환성 게이트만 소유합니다.
2. **비재해석 원칙**: `oa-sdk`는 의미 정의를 재해석·발명하지 않으며, Snowflake Semantic View, RDF/OWL, Neo4j/Cypher, Prompt, Test/QA, UI 투영의 소비 정본(canonical consumer model)이 되지 않습니다.
3. **비추론 식별 원칙**: 필드명(`name`), 표시 라벨(`label`), 다국어 표면형, 임베딩 유사도(embedding score)만으로 의미 동치(semantic equivalence)나 동일성(identity)을 추론하지 않습니다. 연결은 반드시 판본이 고정된 명시적 참조와 provenance 매핑으로만 성립합니다.
4. **파생 산출물 역승격 금지**: `oa-gen`이 방출한 OpenAPI snapshot, JSON Schema, TypeScript 타입·가드, Zod 스키마, client/router 코드는 원본 계약에서 재생성 가능한 파생 산출물(generated artifact)이며, 의미 정본이나 계약 원본으로 역승격하지 않습니다.

---

## 2. Owner · Source of Truth · Generated Artifact 책임 분리 표

| 계층 / 주체 | 소유 대상 (Owner Responsibility) | 정본 (Source of Truth) | 파생 산출물 (Generated / Projected Artifact) | 소유하지 않는 것 (Explicit Non-Goals) |
|---|---|---|---|---|
| **Semantic Platform** | `Term`, `Expression`, `SemanticFrame`, `ReusablePattern`, `DomainConcept`, `Assertion`, `Projection`의 의미 정의·관계·채택 정책·`revision`·`catalog`·`pin` | Semantic Platform 정본 카탈로그 및 승인된 의미 판본 레지스트리 | 판본 고정 의미 스냅샷 및 소비자용 참조 식별자 | HTTP/RPC 전송 스키마 codegen, 타깃 DB DDL, 프레임워크 라우터/클라이언트 코드 |
| **`oa-sdk`** | 승인된 공유 계약의 TypeSpec(`.tsp`) 선언, OpenAPI 3.2/3.1·JSON Schema 2020-12 방출, 공유 TS 타입·독립형 가드·검증 DTO·client/router/mock codegen, 브레이킹 체인지·드리프트 호환성 규칙 | 저장소 소유 계약의 `packages/schemas/typespec/**/*.tsp`, 패키지별 불변 계약 선언(`schema/*.schema.json`), [계약 경계](../contract-boundaries.md), [ADR-009](./009-typespec-first-authoring.md) | `approved.openapi.yaml`, `.merged*.yaml`, `dist/openapi.*`, 생성된 TS 선언/가드/Zod/client/router, `.oa-trace.json`, `.oa-manifest.json` | 의미 정의의 채택·재해석, 도메인 어휘 동치 판정, Snowflake/RDF/Neo4j/Prompt/QA 소비 정본 소유 |
| **도메인 플랫폼 & 타깃 어댑터** | 원천 표현 수집(span/source capture), 도메인 바인딩(`DomainConcept` 채택), 목적별 타깃 프로젝션, 런타임 실행·관측·독립 평가 verdict | 각 도메인 저장소의 바인딩 매니페스트, 원천 문서/저장소 revision, 어댑터별 매핑 규약 | RDF/OWL 온톨로지 뷰, Snowflake Semantic View, Neo4j/Cypher 그래프 투영, Prompt 패킷, QA 테스트/판정 증적, UI 뷰 모델 | Semantic Platform의 의미 판본 임의 변경, `oa-sdk` 생성 산출물 수동 편집을 통한 계약 발명 |

---

## 3. Semantic Reference와 Schema Declaration / Codegen의 차이 (예시)

동일한 도메인 문장 `"A를 B에 등록한다"`를 다루더라도 **의미 참조(Semantic Reference)** 와 **`oa-sdk` 스키마 선언·Codegen** 은 역할과 검증 대상이 다릅니다. 아래 예시는 개념 구분을 위한 **설명용 예시**이며 신규 공통 스키마 채택이 아닙니다.

### 3.1 계층별 표현 비교

| 구분 | 다루는 질문 | 예시 표현 | 소유 주체 및 불변식 |
|---|---|---|---|
| **1) 원천 표현 & 의미 추상화** | 원문 어느 구간(`span`)에서 어떤 의미 구조(`SemanticFrame`)와 도메인 개념(`DomainConcept`)이 도출되었는가? | `Expression("A를 B에 등록한다", locale="ko-KR", span=[120,133])` → `SemanticFrame("Register", roles={subject:"A", target:"B"}, rev="sem-rev-2026-10")` → `DomainConcept("catalog.membership-registration", catalogPin="cat-v4")` | **Semantic Platform** (원천 문서 locator는 원천 제공자 고정). 서술문 자체는 API 변경 권한이나 실행 명령이 아님 |
| **2) 공유 계약의 Semantic Reference (참조 엔벨로프)** | 교환 페이로드가 어느 의미 판본·역할·로케일·원천을 가리키는가? | `{ "conceptRef": "urn:semantic:concept:catalog.membership-registration", "conceptRevision": "sem-rev-2026-10", "catalogPin": "cat-v4", "roleBindings": [{"slot": "subject", "pointer": "/memberId"}, {"slot": "target", "pointer": "/groupId"}] }` | 의미 정의 본문을 복제하지 않고 **불변 식별자·판본·포인터 매핑만 전달** |
| **3) `oa-sdk` Schema Declaration (`.tsp` / JSON Schema)** | 승인된 교환 계약의 와이어 필드 타입·필수 여부·상태 코드·제약 조건이 무엇인가? | TypeSpec `model SemanticRefEnvelope { conceptRef: string; conceptRevision: string; catalogPin: string; }` 또는 불변 JSON Schema Draft 2020-12 (`$id`, `additionalProperties: false`) | **`oa-sdk`**. 문자열·구조·수치 범위·필수 키의 **구문·구조 유효성(structural validity)** 만 검증하며 `conceptRef`의 의미 진위를 자체 추론하지 않음 |
| **4) `oa-sdk` Codegen 산출물** | 소비자가 런타임/컴파일 타임에 안전하게 읽고 검증할 파생 코드는 무엇인가? | `types.ts` (`export interface SemanticRefEnvelope`), 독립형 타입 가드(`isSemanticRefEnvelope`), Zod 스키마, typed fetch client, `.oa-trace.json` / `.oa-manifest.json` | **`oa-sdk` 파생 산출물**. 원본 `.tsp`/스키마와 SHA-256 해시로 결속되며 수동 수정 금지 |

### 3.2 금지되는 혼동 사례 (Anti-Patterns)

- **표면형·임베딩 기반 동치 추론 금지**: 두 서비스의 DTO 필드명이 모두 `registerTarget`이거나 `"등록"`과 `"register"`의 임베딩 유사도가 높다는 이유만으로 동일한 `DomainConcept`로 병합하거나 호환 타입으로 간주하지 않습니다.
- **서술 표현의 실행 계약 승격 금지**: 원문 문서의 서술적 `Expression`이 존재한다는 이유만으로 `POST /registrations` 변이(mutation) API 계약이나 도구 실행 권한이 승인된 것으로 취급하지 않습니다.
- **스키마 통과를 의미 채택으로 오인 금지**: `oa-gen validate`나 JSON Schema/AJV 검증 통과는 **와이어 형식 적합성**만 증명하며, Semantic Platform의 의미 채택이나 QA 판정(verdict) 통과를 대체하지 않습니다.

---

## 4. 계약 수준의 의미 참조·계보(Lineage)·산출물 추적 규칙

### 4.1 공유 계약에서 참조 가능한 8대 의미·계보 차원

도메인 계약이 의미 계보를 운반해야 할 때는 의미 본문을 인라인 복제하는 대신 아래 참조 차원을 명시적 필드로 보존해 역추적 가능하게 설계합니다.

| 참조 차원 | 계약 수준에서 추적하는 내용 | 누락·불일치 시 원칙 |
|---|---|---|
| **`semantic reference`** | Semantic Platform이 발급한 `Term` / `SemanticFrame` / `ReusablePattern` / `DomainConcept`의 불변 URI/ID | 이름·라벨로 대체 추론 금지; 미해결 상태로 격리 |
| **`expression realization`** | 추상화가 실현된 원문 표현 식별자, 표면형 구분, 문맥 범위(`span`/구간) | 원문 없이 요약문·생성문만 남기면 원천 역추적 불가(`partial`) |
| **`provenance / source locator`** | 원천 아티팩트 ID, 저장소/문서 locator(URI, blob/fileId, JSON Pointer), 추출·검수 주체와 방식 | 출처 없는 주장은 권위 입력으로 채택 불가(`unknown`) |
| **`revision`** | 의미 정의 `revision`, `catalogPin`, 원천 문서 `sourceRevision`, 스키마 선언 `revision`의 분리 기록 | 어느 한 판본이라도 갱신·불일치 시 `stale` 표시, 암묵적 `latest` 해석 금지 |
| **`locale`** | 원문 표현 및 표면 실현의 BCP 47 언어/지역 태그(예: `ko-KR`, `en-US`)와 번역 관계 손실 여부 | 로케일 생략 상태에서 다국어 라벨을 정체성(identity) 키로 사용 금지 |
| **`slot / role`** | `SemanticFrame` 또는 `ReusablePattern`의 의미 역할(`subject`, `target`, `condition` 등)과 페이로드 필드(JSON Pointer 등) 간 1:1 바인딩 | 조사 생략·모호성으로 역할 확정 불가 시 임의 단일화 금지 |
| **`projection target`** | 투영 목적지 식별자(예: `openapi-3.2`, `json-schema-2020-12`, `snowflake-semantic-view`, `rdf-owl`, `neo4j-cypher`, `prompt`, `qa-contract`, `ui`) | 타깃 어댑터 포맷을 상위 의미 정본으로 역전시키지 않음 |
| **`lossiness / status`** | 투영 시 발생한 정보 손실(`lossless`, `lossy`, 탈락 제약 목록) 및 해석 상태 | 손실이 있는 투영에서 역방향 무손실 복원을 주장하지 않음 |

### 4.2 의미 정본과 Generated Artifact의 `source revision` · `digest` 추적

`oa-sdk`는 의미 정본과 생성 산출물을 혼동하지 않도록 다음 4중 추적 메커니즘으로 생성물의 출처 판본과 다이제스트를 검증합니다.

1. **TypeSpec → OpenAPI 승격 스냅샷 및 확장 추적**:
   - [`packages/schemas/typespec/`](../../../packages/schemas/typespec/) 원본에서 컴파일된 [`approved.openapi.yaml`](../../../packages/schemas/typespec/approved.openapi.yaml)과 `schema:typespec-check` 게이트가 원본-산출물 일치성을 강제합니다.
   - `@oa-sdk/typespec-decorators/governance`의 `@traceId`, `@replaces`, `@requirement`(`x-oa-sdk-trace`) 및 `@evidence`(`x-samchon-evidence`)는 `.oa-trace.json`에 요구사항·원본 위치를 기록하되, 순수 문서/출처 메타데이터 변경이 허위 스키마 드리프트를 유발하지 않도록 정규화된 `contentHash`와 분리해 관리합니다([TypeSpec Authoring Conventions](../../guides/typespec-authoring-conventions.md)).
2. **Codegen 파일 매니페스트 (`.oa-manifest.json`)**:
   - `oa-gen generate`는 생성 파일마다 생산자(`producer`), 입력 스펙 경로, 생성 시점 SHA-256 해시, `@generated` 배너를 기록해 수동 오염(`content-modified`)을 감지합니다.
3. **불변 계약 참조 (`ExactRef` + `schemaSha256`)**:
   - 교환 계약 패키지(예: [`@oa-sdk/ftp-contract`](../../../packages/ftp-contract/README.md))는 `(schemaId, revision, schemaSha256)` 3원 튜플로 선언 아티팩트의 바이트 단위 무결성을 고정하며, 별칭(`AliasRef`)은 검증 경계에 진입하기 전에 반드시 `ExactRef`로 해석되어야 합니다.
4. **릴리스 아티팩트 출처 고정 (`sourceRevision` + `sha512`)**:
   - 공개 배포 매니페스트(`manifest.json`)는 정확한 40자 Git `sourceRevision`과 패키지 tarball `sha512` integrity를 기록합니다.

### 4.3 미해결·충돌·Stale·Partial 상태 모델 (`proposed` 검토 후보)

> [!NOTE]
> 아래 상태 어휘는 공유 계약이나 어댑터 엔벨로프가 의미 참조의 불완전성을 숨기지 않고(fail-closed) 표현할 수 있도록 정리한 **검토 대상 후보(`proposed`)** 입니다. 현 시점에 `oa-sdk` 전역 런타임 스키마로 일괄 강제 채택된 상태가 아니며, 도메인별 계약 승인 절차를 거쳐 필요한 범위만 선택합니다.

| 상태 후보 | 발생 조건 | 계약·소비자 측 권장 Fail-Closed 동작 |
|---|---|---|
| `unresolved` / `unknown` | 참조 대상 개념 ID, 원천 `revision`, `provenance`, 권한 중 필수 항목이 아직 확인되지 않음 | 임의 기본값·유사 이름 매칭 금지; 채택·실행 경로 차단 |
| `partial` | 원문 `span`, 슬롯 바인딩, 커버리지의 일부만 확보되었거나 투영 중 일부 제약이 손실(`lossy`)됨 | 확보된 범위와 누락된 슬롯/제약을 함께 명시하고 완전성 주장 금지 |
| `stale` | 계약이 고정한 `conceptRevision`·`catalogPin` 또는 `sourceRevision` 이후 상위 정본이 갱신됨 | 자동 최신화 금지; 재검수(`needs_review`) 및 호환성 diff 확인 전까지 이전 판본 고정 유지 |
| `conflict` | 동일 대상·슬롯에 대해 서로 모순되는 의미 주장(`Assertion`)이나 바인딩 후보가 공존함 | 양쪽 후보와 provenance를 모두 보존하고 해시·순서 등으로 임의 단건 선택 금지 |
| `blocked` | 상위 승인, 필수 입력 계약, 스키마 판본 해석 등 선행 게이트 미충족 | 해당 의존 경로만 차단하고 독립 경로와 실패 원인을 분리 기록 |
| `needs_review` | 사람 소유자 또는 독립 평가자의 의미·매핑 판정이 필요함 | 승인 전까지 정본 승격, 코드젠 배포, 외부 부작용 실행 금지 |

---

## 5. 저장소별 소비자 매핑 및 타깃 어댑터 경계

### 5.1 관련 5개 플랫폼 저장소의 공유 계약 소비 방향

| 저장소 | 관련 이슈 | 핵심 소유 역할 | 공유 계약 소비·연계 방향 | 경계 불변식 |
|---|---|---|---|---|
| **`semantic-platform`** | [mineclover/semantic-platform#51](https://github.com/mineclover/semantic-platform/issues/51) | 범용 언어 추출·재사용 추상화(`Term`, `Expression`, `SemanticFrame`, `ReusablePattern`, `DomainConcept`, `Assertion`, `Projection`) 및 `revision`/`catalog`/`pin`의 **의미 정본 소유자** | 승인된 의미 판본과 참조 식별자 규약을 상위 입력으로 제공하며, 교환 API/아티팩트 스키마가 필요한 경우에만 `oa-sdk` 선언·검증 파이프라인을 사용 | `oa-sdk`의 생성 타입이나 타깃 뷰가 Semantic Platform 정본을 역규정하지 않음 |
| **`knowledge-system-core`** | [mineclover/knowledge-system-core#4](https://github.com/mineclover/knowledge-system-core/issues/4) | 원천 표현 수집, 도메인 주장(`Assertion`) 색인, 검색·회수(retrieval) 및 근거 trace 연결 | 원천 locator·`span`·`revision`·`provenance` 참조 구조를 공유 계약 DTO/검증 가드로 소비해 trace/retrieval 경계를 유지 | 검색 인덱스 점수·임베딩 유사도를 의미 정본 동치나 계약 identity로 승격하지 않음 |
| **`oslc-platform`** | [mineclover/oslc-platform#6](https://github.com/mineclover/oslc-platform/issues/6) | 엔지니어링 아티팩트 간 OSLC 링크, 라이프사이클 추적(digital thread), 시스템 간 참조 중개 | 외부 리소스 참조·판본 핀·trace 엔벨로프의 와이어 스키마와 OpenAPI/JSON Schema 검증 계약을 소비 | OSLC 링크 등록이 Semantic Platform의 의미 채택이나 원본 아티팩트 소유권 이전을 뜻하지 않음 |
| **`qa-sdk`** | [mineclover/qa-sdk#16](https://github.com/mineclover/qa-sdk/issues/16) | 테스트 정의·잠금 계획·독립 오라클 평가·실행 증적(verdict/evidence) 검증 | 판본 고정 스키마 참조(`ExactRef` / `AliasRef`), JSON Pointer 필드 매핑, 불변 JSON Schema 검증 포트(예: `@oa-sdk/ftp-contract`)를 소비 | 테스트 `PASS`/판정 증적은 계약 준수 관측 결과일 뿐 의미 정의 자체를 창설·변경하지 않음 |
| **`purpose-output-platform`** | [mineclover/purpose-output-platform#7](https://github.com/mineclover/purpose-output-platform/issues/7) | 목적별 프롬프트·출력 패킷 조립 시 원천 표현·패턴·슬롯 계보(lineage) 보존 | 입력 컨텍스트·슬롯 바인딩·손실(`lossiness`)·상태(`partial`/`stale` 등) 전달용 구조화 스키마와 검증 DTO를 소비 | 서술적 의미 참조를 승인 없는 실행 명령(imperative authority)으로 자동 변환하지 않음 |

### 5.2 타깃 프로젝션 어댑터 분리 원칙

아래 타깃 표현은 각각 고유한 형식 제약과 손실 특성을 가지는 **별도 어댑터 계약(Adapter-Owned Projection Contract)** 이며, `oa-sdk` 코어 스키마 정본이 아닙니다.

| 타깃 프로젝션 | 어댑터 계약의 책임 | `oa-sdk`와의 경계 |
|---|---|---|
| **RDF / OWL** | 형식 논리·온톨로지 트리플/공리 매핑 및 추론 가능 범위·제약 손실 기록 | `oa-sdk`는 교환용 JSON Schema/OpenAPI 검증만 보조할 수 있으며 OWL 의미론이나 추론기를 소유하지 않음 |
| **Snowflake Semantic View** | 분석용 차원·메트릭·조인 바인딩 및 카탈로그 핀 매핑 | 물리 DW 테이블/뷰 DDL과 분석용 시맨틱 뷰는 어댑터·데이터 거버넌스 소유이며([ADR-012](./012-multi-tier-schema-separation-and-ttsc-boundary.md)), `oa-sdk` API 정본이 아님 |
| **Neo4j / Cypher** | 속성 그래프 노드·엣지 탐색 투영 및 assertion lineage 역추적 | 그래프 저장 구조나 탐색 점수를 `oa-sdk` 계약 정본으로 삼지 않음 |
| **Prompt / Test / UI Projection** | 프롬프트 지시 패킷(`purpose-output-platform`), 독립 테스트 오라클·증적(`qa-sdk`), 다국어 화면 표시 모델(UI) | 각 소비 목적별 투영은 원천 `revision`·`locale`·`lossiness`를 보존하는 하위 어댑터가 소유하며, 표시명이나 프롬프트 템플릿이 스키마 정본이 되지 않음 |

---

## 6. 상호 참조 링크

- 본 저장소 이슈: [mineclover/oa-sdk#22](https://github.com/mineclover/oa-sdk/issues/22)
- 연계 저장소 이슈:
  - Semantic Platform: [mineclover/semantic-platform#51](https://github.com/mineclover/semantic-platform/issues/51)
  - Knowledge System Core: [mineclover/knowledge-system-core#4](https://github.com/mineclover/knowledge-system-core/issues/4)
  - OSLC Platform: [mineclover/oslc-platform#6](https://github.com/mineclover/oslc-platform/issues/6)
  - QA SDK: [mineclover/qa-sdk#16](https://github.com/mineclover/qa-sdk/issues/16)
  - Purpose Output Platform: [mineclover/purpose-output-platform#7](https://github.com/mineclover/purpose-output-platform/issues/7)
- 저장소 내 관련 정본:
  - [Contract Ownership Boundaries](../contract-boundaries.md)
  - [Platform Scope](../platform-scope.md)
  - [ADR-009: TypeSpec-First Authoring](./009-typespec-first-authoring.md)
  - [ADR-012: Multi-Tier Schema Separation and ttsc Boundary](./012-multi-tier-schema-separation-and-ttsc-boundary.md)
  - [문서·스펙 거버넌스](../../spec-governance/README.md)
