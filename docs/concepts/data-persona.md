# Data Persona

> 페르소나 기반 API endpoint 탐색을 위한 메타 프레임워크.
> 구현 패키지: [`@oa-sdk/personas`](../../packages/personas/README.md)

## One Sentence

페르소나는 *사람*이 아니라 **(주체-데이터 관계)** 다. 같은 데이터라도 누가/언제/왜 만지는지에 따라 다른 페르소나가 되고, 그게 곧 별도 API operation의 정당성이다.

## 페르소나의 3 종류

매트릭스 안에 세 perspective가 섞이지 않게 분리:

| | API consumer | data-modeling | profile (v0.11.5) |
|---|---|---|---|
| **관점** | "누가 / 어떻게 호출하나" | "데이터 자체의 invariants" | "이 stakeholder 보유 페르소나 set" |
| **단위** | persona row (84개) | data entity (6개) | saved query (5개) |
| **위치** | `domains/*.personas.yaml` | `data-models/*.persona.yaml` | `profiles/*.profile.yaml` |
| **PK** | identity tuple | entity 이름 | profile id |
| **예** | `admin-monitor`, `b2b-customer-list-users` | `User`, `Credential` | `audit-required`, `mobile-app` |
| **표현 의무** | shape, access, regulation, expects, **skills**, links | PII flag, retention, audit, masking | selector / extends / exclude |

세 perspective가 모두 cross-reference (`pnpm coverage` markdown).

## 3-bucket × 11-dimension + skills + links 모델

```
identity (PK)         actor + data + intent + trigger + proficiency? + consumer?
reference (lookup)    regulation + channel + region + compliance_framework
outcome (obligation)  shape + access + maps_to + expects
skills (capability)   pagination / audit-emission / oauth-scope-aware / …    (v0.11)
links (relation)      depends_on / refines / supersedes
```

각 영역의 역할:

- **identity**는 enum 추론용 — 같은 6축 값은 한 페르소나 (다르면 분리). PK 영향.
- **reference**는 외부 vocab 변경이 매트릭스에 자동 전파되는 lookup. PK 영향 X.
- **outcome**은 spec validate 입력 — shape는 응답 schema 모양, access는 의무, maps_to/expects는 OpenAPI 교차검증
- **skills** (v0.11)은 페르소나 *고유 보유 능력* — RPG 캐릭터의 perks. access(의무)와 짝 맞춤 (audited 의무 → audit-emission 능력).
- **links**는 시퀀스/변종/lifecycle 추적 (qa-sdk LinkType 어휘 차용 subset)

### identity — 6축 (4 필수 + 2 선택)

| 차원 | 의미 | 어휘 |
|------|------|------|
| `actor` | 권한 계층 | guest · user · owner-self · target-of-action · moderator · admin · third-party-app · system |
| `data` | 어떤 데이터 노드 | 도메인-로컬 (`User(self)`, `Credential`, `Session`…) — 정식 정의는 `data-models/` |
| `intent` | 무엇을 이루려는가 | create · read-detail · list · search · update · soft-delete · hard-delete · revoke · moderate · report · appeal · export · authenticate · monitor · subscribe |
| `trigger` | 언제 발동되는가 | 38값 × 4 category (operational/lifecycle/failure-mode/semantic) |
| `proficiency?` | 사용자 숙련도 (v0.11에서 `skill`로부터 rename) | onboarding · novice · intermediate · expert |
| `consumer?` | stakeholder 시점 | end-user · backend · b2b-customer · internal-tool · site-admin · infra-ops · data-eng |

`skill`/`consumer`는 선택. spec/access 의무가 갈릴 때만 명시. 같은 actor·data·intent·trigger도 consumer 다르면 다른 페르소나(`listUsers` → admin-monitor / backend-svc / b2b-customer / cs-agent 4 변종).

### reference — 외부 카탈로그

| 차원 | 의미 | 어휘 |
|------|------|------|
| `regulation` | 법적/정책 제약 (다중) | pii-kr-pipa, pii-gdpr, content-violence, content-gambling, child-protection-coppa, financial-kyc |
| `channel` | 소비 매체 (다중) | browser, mobile-app, public-api, partner-sdk, webhook, csv-export, llm-tool-call, cli |
| `region` | 데이터 residency / 법적 관할 (다중) — v0.10 | KR · EU · US · JP · SG · APAC · GLOBAL |
| `compliance_framework` | 조직 단위 인증 (다중) — v0.10. regulation(법)과 직교 | SOC2 · ISO27001 · NIST-CSF · HIPAA · PCI-DSS · ISMS-P |

reference는 페르소나 식별에 영향 X. 다만 reference 값이 다르면서 **shape나 access도 다르면** 별 페르소나로 분리(채널 폭발 방지 휴리스틱).

### outcome — 계약 obligation

| 차원 | 의미 |
|------|------|
| `shape` | 응답 형태. detail · list-paginated · list-faceted · stream-sse · stream-ndjson · bulk-batch · command · token |
| `access` | 권한·감사·프라이버시 의무 (다중). public · private-self · scoped:read · scoped:write · scoped:admin · audited · pseudonymized · rate-limited · idempotent |
| `maps_to` | 이 페르소나를 실현하는 operationId 목록 |
| `expects` | 받게 되는 HTTP status code 목록. operation의 `responses` 키와 교차검증 |

### skills — 페르소나 고유 보유 능력 (v0.11)

`Persona.skills: string[]` — top-level 필드. RPG 캐릭터의 perks/skills처럼 페르소나가 무엇을 *할 수 있는지* 명시. 6 카테고리:

| 카테고리 | 예 |
|---|---|
| request-shape | pagination / filter-by-role / batch / full-text-search |
| response-shape | sse-stream / etag-supported / partial-response |
| lifecycle | idempotent / retryable / cacheable |
| observability | audit-emission / metrics-emission / trace-context |
| security | pii-visible-admin / pii-masked-default / pseudonymized |
| integration | oauth-scope-aware / rate-limit-honored / webhook-source |

**access ↔ skills 정합성** (constraint engine 적용):
- `access: [audited]` ⇔ `skills: [audit-emission]`
- `access: [rate-limited]` ⇔ `skills: [rate-limit-honored]`
- `access: [pseudonymized]` ⇔ `skills: [pseudonymized]`

위반 시 warn — 의무 명시했지만 능력 명시 안 함 = lying.

### DPM과의 관계

`pseudonymized` persona skill은 API audience가 가명 데이터만 보거나 다룬다는 계약상 의무다.
[Data Pseudonymization Manifest](./data-pseudonymization-manifest.md)는 그 의무를 실제 DB
catalog, approved relationship snapshot, namespace binding, column transform, vault, validation,
publishing 정책으로 실행하는 별도 source of truth다.

즉 persona row는 "누가 어떤 pseudonymized surface를 호출하는가"를 설명하고, DPM은 "그
surface 뒤의 데이터셋이 어떤 logical relationship을 보존하며 가명처리되었고 어떤 validation
report로 증명되는가"를 설명한다.

### links — 페르소나 간 관계 (v0.9)

qa-sdk/definition-catalog의 `LinkType` 10종 중 페르소나 컨텍스트 의미 있는 3종 차용.

| linkType | 의미 | 예 |
|---|---|---|
| `depends_on` | 시간 선후 — A가 B 이후에 발동 | `user-self-read` depends_on `guest-login` |
| `refines` | perspective 변종 — A가 B의 stakeholder 변형 | `b2b-customer-list-users` refines `admin-monitor` |
| `supersedes` | 이전 페르소나 대체 (마이그레이션) | (정의 변경 시) |

식별자가 qa-sdk와 동일 → 향후 공통 패키지 분리 시 자연스럽게 흡수 가능.

## profiles — saved query bundles (v0.11.5)

페르소나 query 결과를 yaml로 저장한 재사용 단위. RPG 캐릭터의 "skill loadout"처럼 stakeholder가 보유한 페르소나 set을 표현.

```yaml
# profiles/audit-required.profile.yaml
id: audit-required
description: "audit-emission skill 보유 — SOC2 audit scope"
selector:
  status: [implemented]
  skills: [audit-emission]
```

4가지 정의 방식 조합:
- `selector` — 동적 매칭 (모든 차원 + skills + status + domain + **kind** *(v0.13)*)
- `personas` — 명시적 id 추가 (selector 결과에 union)
- `extends` — 다른 profile 흡수 (재귀, cycle detection)
- `exclude` — 결과에서 빠질 id

`selector.kind` (v0.13) — surface kind 필터. 예: `kind: [cli-tool]` 로 dogfood 페르소나만 조회.

```yaml
# profiles/dogfood-cli.profile.yaml
id: dogfood-cli
description: "@oa-sdk/personas dogfood (cli-tool kind) 페르소나만"
selector:
  kind: [cli-tool]                # 11 페르소나 (personas-cli 도메인)
```

6 sample profile (현재): mobile-app / b2b-customer-suite / pipa-compliance / audit-required / infra-ops-monitoring / **dogfood-cli**.

`pnpm profiles list` / `pnpm profiles show <id>`로 expand 결과 조회.

## persona row 상태

매트릭스가 wishlist로 오염되지 않도록 status 필수.

| status | 의미 | maps_to 검증 |
|--------|------|-------------|
| `implemented` | spec에 실재하는 surface | 모든 operationId가 `.merged.yaml`에 존재 |
| `proposed` | 미래 surface — 다음 spec 작업 backlog | 비어있어도 OK |
| `deprecated` | 제거 예정 | 정리 작업 등록 |

## 운영 패러다임 — baseline-once + signal-driven (v0.12) + surface kind (v0.13)

페르소나 매트릭스는 *사람이 매번 손으로 짜는* 것이 아님. **signal이 발생하면 도구가 자동 stub 생성, 사람이 review**.

```
┌─ baseline (1회) ──────────────────────────────────────────┐
│ pnpm wizard 실행 → .persona-project.yaml 생성             │
│ system context (region/regulation/compliance/stakeholder) │
│ 큰 refactor 아니면 변경 X.                                 │
├─ signal-driven (반복) ─────────────────────────────────────┤
│ propose가 다음 signal 감지:                                │
│  new-op       — spec 신규 op, 페르소나 없음               │
│  orphan       — declared response, 페르소나 없음           │
│  new-schema   — spec 신규 schema, data-model 없음          │
│ 자동 stub 생성 → status: proposed → 사람 review → 승격     │
├─ domain ownership ─────────────────────────────────────────┤
│ 페르소나는 데이터에 속하고, 데이터는 도메인에 속함.         │
│ 도메인이 자기 entity / 허용 actor / 허용 channel 보유.     │
├─ surface kind (v0.13) ─────────────────────────────────────┤
│ 도메인이 자기 surface 종류 선언:                            │
│  openapi-http (default) — REST/RPC, 모든 룰 적용            │
│  cli-tool                — synthetic op, drift/expects skip │
│  library-api             — 함수/모듈, drift skip            │
│  event-stream            — pub/sub, channel/payload 위주    │
│ 같은 페르소나 모델로 non-HTTP surface까지 표현 가능.        │
└────────────────────────────────────────────────────────────┘
```

원칙:
- **데이터가 도메인에 속함, 페르소나가 데이터에 속함** → 페르소나 위치가 도메인 boundary로 자연 결정
- **baseline은 신중히 한 번** — 큰 refactor 시 `pnpm wizard --reset`
- **시그널이 트리거** — 사람이 직접 늘리지 않음
- **review가 게이트** — auto-stub은 항상 `proposed` 상태
- **surface kind가 검증 정책을 분기** (v0.13) — non-HTTP 도메인은 OpenAPI 룰 skip, intrinsic 룰만 적용

## 사용 사이클

```
spec 변경 또는 페르소나 추가
  ↓
pnpm check                   ─── 9 룰 검증 (실패 시 멈춤)
  ↓
pnpm coverage                ─── orphan / unjustified / cross-section 확인
  ↓
(orphan 있으면) pnpm propose ─── proposed stub 생성 → 검토 → 승격
  ↓
pnpm gen:tests               ─── e2e 테스트 자동 갱신
  ↓
e2e 실행                     ─── 같은 op가 페르소나에 따라 다른 status로 분기
```

## 확장 작업 정의 — 5단계 분류

framework에 변경을 가하는 모든 작업은 **영향 범위 + 수정 표면**으로 등급이 갈린다:

| 레벨 | 이름 | 의미 | 수정 표면 | 검증/검사 영향 | 비용 |
|------|------|------|----------|--------------|------|
| L1 | Vocabulary | 기존 trait yaml에 값 추가 | `traits/X.yaml` 1줄 | rule #2 통과 즉시 사용 가능 | 매우낮 |
| L2 | Sub-trait field | trait value에 메타 필드 추가 (예: `category`, `jurisdiction`) | trait yaml + (선택) typed reader | cross-section 분류 가능해짐 | 낮 |
| L3 | Trait file | 기존 bucket에 새 vocabulary 파일 추가 | `traits/Y.yaml` 신설 + registry pointer | 어휘 검증 가능 | 중 |
| L4 | Dimension | 기존 bucket에 새 차원 추가 (PK / lookup / obligation 영향) | types.ts + registry + (대개) coverage section | rule #1 PK 변경 (identity일 때), rule #2 vocab 검증 추가 | 중-높 |
| L5 | Bucket | 새 bucket 추가 (현재 identity / reference / outcome 외) | 전체 아키텍처 | 모든 룰 영향 | 매우높 |

부속 분류:

| 종류 | 의미 | 예 |
|------|------|----|
| Persona row extension | 매트릭스에 row 추가 (data만) | 새 페르소나 1줄 |
| Constraint extension | `registry.constraints` 신규 룰 | `pii-bulk-requires-regulation` |
| CLI extension | 신규 pnpm 명령 | `pnpm flow` |
| Output extension | 기존 CLI에 섹션 추가 | coverage에 "Trigger category coverage" |

원칙:
- **identity 차원**(PK 영향) 추가는 L4 — 기존 페르소나 PK 변동 가능성 검토 필수
- **reference 차원**(enrichment) 추가는 L3+L4 — PK 영향 없음, lookup만 추가
- **outcome 차원**(obligation) 추가는 L4 — 검증 룰 추가 동반

v0.10의 `region` + `compliance_framework`는 L3+L4 (reference bucket 차원 추가).

## acknowledged orphans — 의도적 skip

OpenAPI에 선언됐지만 페르소나로 모델링하지 않을 응답 코드는 도메인 매트릭스에 명시:

```yaml
# users.personas.yaml
acknowledged_orphans:
  - operationId: createUser
    statusCode: "500"
    reason: "infrastructure error — no actor causes this; contract obligation only."
```

`pnpm propose`가 이 마커를 보고 stub 생성에서 제외 → CLI가 idempotent해짐.

## 19 검증 룰 (numbered)

#10/#11/#12-14는 registry.yaml constraints — 룰 #6 엔진이 enforce. 별도 # 부여 안 함.

| # | 룰 | 도입 |
|---|---|---|
| 1 | identity PK 유일성 | v0.1 |
| 2 | vocabulary 매칭 | v0.1 |
| 3 | maps_to 실재성 *(openapi-http only)* | v0.1 |
| 4 | 필수 identity | v0.1 |
| 5 | status enum | v0.1 |
| 6 | constraints (forbid/require) — registry.yaml의 7개 constraint enforce | v0.3 |
| 7 | drift (양방향 일관성) *(openapi-http only)* | v0.3 |
| 8 | expects ⊆ responses (range/default 매칭) *(openapi-http only)* | v0.4-prep |
| 9 | links 무결성 (target/self-link/cycle/supersedes) | v0.9 |
| 15 | skills vocabulary | v0.11 |
| 16 | profile id 유일성 | v0.11.5 |
| 17 | profile.personas / exclude id 실재성 | v0.11.5 |
| 18 | profile.extends cycle / unknown reference | v0.11.5 |
| 19 | empty profile warn | v0.11.5 |
| 20 | domain ownership: data ∈ owns_entities | v0.12 |
| 21 | domain ownership: actor ∈ allowed_actors | v0.12 |
| 22 | metadata.kind 어휘 가드 (openapi-http \| cli-tool \| library-api \| event-stream) | v0.13 |

추가:
- **kind-aware 분기** (v0.13) — 룰 #3/#7/#8은 `metadata.kind === 'openapi-http'` 도메인에만 적용
- **registry.yaml constraints** — guest-can't-hard-delete / pipa→KR / gdpr→EU / audited↔audit-emission / rate-limited↔rate-limit-honored / pseudonymized↔skill / pii-bulk-requires-regulation. 룰 #6 엔진이 일괄 enforce.

## 11 CLI

| CLI | 역할 |
|-----|------|
| `wizard` | baseline 부트스트랩 (1회용) — region/regulation/compliance/spec path 입력 → `.persona-project.yaml` |
| `validate` | 22 룰 검증 (drift + profiles 포함, kind-aware: #3/#7/#8은 openapi-http 도메인만) |
| `coverage` | 12-section markdown — operation / response-status / actor / regulation / channel / region / compliance / trigger / **skill** / consumer / data-model / acknowledged-orphans |
| `bind` | `.merged.yaml` → `.merged.persona.yaml` (operation에 `x-persona` 주입) |
| `propose` | orphan response → 페르소나 stub 자동 (idempotent) |
| `propose --from-spec` | 전체 spec scan (3 signal: orphan + new-op + new-schema) |
| `gen:tests` | 매트릭스 → vitest 매트릭스 자동 (apps/playground), HTTP 도메인만 |
| `flow` | 의존성 그래프 markdown + mermaid + topological layers |
| `profiles` | `list` / `show <id>` — saved query 일람 + expand 결과 |
| `check` | `merge → bind → validate` 한 방 |
| `test` | 142 unit tests |

## ⚠️ 한계 — 계약 시뮬레이션

페르소나 e2e는 **계약 형태**만 확인. mock-server `override`가 요청을 무시하고 페르소나가 claim한 응답을 반환하므로:

- ✅ 검증: 응답 status, body 모양, persona ↔ operation 매핑, drift, vocab, dependency cycles
- ❌ 검증 X: 실제 request validation (AJV), 인증 처리, 비즈니스 로직

이건 *의도된 한계* — 페르소나는 "이 actor가 호출했을 때 *계약상* 무엇이 오기로 약속됐나"를 다룬다. 실제 validation은 mock-server가 schema 기반으로 별 트랙에서 수행 (override 없이 호출하면 동작).

## 버전 이력

| 버전 | 핵심 추가 |
|------|---------|
| v0.1 | 3-bucket framework + 5 검증 룰 + 7 trait + 4 domain matrices + validator CLI |
| v0.2 | `coverage` CLI — cross-cut + unjustified 검출 + gap backlog |
| v0.3 | `bind` CLI + `x-persona` extension + drift 검출 + constraints 강제 |
| v0.4-prep | `outcome.expects` + range/`default` 매칭 + response status orphan 검출 |
| v0.4 | persona resolver + `createPersonaMockClient` — e2e roleplay 입증 |
| v0.5 | `gen:tests` — 매트릭스 → vitest 자동 |
| v0.5.5 | 11 proposed → spec 구현 + 11개 신규 endpoint |
| v0.6 | `propose` CLI — orphan → 페르소나 stub 자동 |
| v0.7 | `traits/trigger.yaml` (38값 × 4카테고리) + `acknowledged_orphans` (idempotent) |
| v0.8 | `consumer` perspective (7값 × 4카테고리) + `data-models/` 분리 |
| v0.9 | persona dependency graph + `flow` CLI + 검증 룰 #9 (qa-sdk LinkType 차용) |
| v0.10 | reference bucket 확장 — `region`(데이터 residency) + `compliance_framework`(SOC2/ISO27001/HIPAA 등). 8 페르소나 분류. 확장 5단계 taxonomy 정의 |
| v0.10.5 | regulation ↔ region 정합성 강제 — 22 페르소나 일괄 region 부착 + 2 cross-reference constraint |
| v0.11 | `identity.skill` → `identity.proficiency` rename. `Persona.skills` capability tags 도입 — `traits/skill.yaml` (6 cat × 25 값). 57 페르소나 자동 분류. 룰 #15 + access↔skills 일관성 constraint 3개 |
| v0.11.5 | persona profiles — saved query bundle. 5 sample profile. `pnpm profiles` CLI. 룰 #16-18 |
| v0.12 A.1+B | baseline-once + signal-driven. `pnpm wizard` (1회용) + `pnpm propose --from-spec` (3 signal) |
| v0.12 A.2 | domain ownership boundary — 각 도메인 metadata block (`owns_entities` / `allowed_actors` / `responsibility`). 룰 #20-21로 boundary 강제. 84 페르소나 모두 통과 — 도메인 책임이 *코드로* 보장됨 |
| **v0.13 (현재)** | surface kind dimension — `metadata.kind: openapi-http \| cli-tool \| library-api \| event-stream`. 룰 #3, #7, #8이 kind에 conditional. 룰 #22 (kind 어휘 가드) 신설. dogfood `personas-cli` 도메인 11 페르소나 promote (cli-tool) — 프레임워크가 자기 자신에 적용됨. 신규 어휘: `actor` (framework-developer/ci-bot/auditor), `intent` (inspect/transform/validate), `trigger` (pre-commit/ci-gate/audit-review/design-review/release-prep). 모듈화: `src/kind.ts` 헬퍼 (domainKind/isHttpDomain/httpDomainsOnly/isValidKind) — public API export. coverage report에 `byKind` 분기. mock-server applyTo가 cli-tool persona 자동 skip. `ProfileSelector.kind` 차원 추가 + `dogfood-cli` sample profile. |

## 향후 후보

- `data_kind: pii` 같은 데이터 dictionary trait 도입 → 보류 constraint(`pii-bulk-requires-regulation`) 활성화
- qa-sdk 쪽에 `link-taxonomy` 공통 패키지 분리 협업
- mock-server에 `x-persona-test` 헤더 자동 라우팅
- `gen:tests`가 `links.depends_on`을 시퀀스 setup으로 활용

## 참조

- [Vision](../vision.md) — 전체 도메인 철학
- [Behavior ECS](./behavior-ecs.md) — 행동 좌표 (페르소나는 행동의 *주체* 차원에 해당)
- [`@oa-sdk/personas` README](../../packages/personas/README.md) — 패키지 사용법
- [`docs/examples/dogfood/`](../examples/dogfood/README.md) — oa-sdk 자체 페르소나 빌딩 (CLI 컨텍스트 example)
- [`qa-sdk/packages/definition-catalog`](https://github.com/) — LinkType 어휘 출처 (참조)
