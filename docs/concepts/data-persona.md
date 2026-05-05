# Data Persona

> 페르소나 기반 API endpoint 탐색을 위한 메타 프레임워크.
> 구현 패키지: [`@oa-sdk/personas`](../../packages/personas/README.md)

## One Sentence

페르소나는 *사람*이 아니라 **(주체-데이터 관계)** 다. 같은 데이터라도 누가/언제/왜 만지는지에 따라 다른 페르소나가 되고, 그게 곧 별도 API operation의 정당성이다.

## 두 가지 페르소나

매트릭스 안에 두 관점이 섞이지 않게 분리:

| | API consumer 페르소나 | data-modeling 페르소나 |
|---|---|---|
| **관점** | "누가 / 어떤 시점에 / 어떤 stakeholder 시점에서 호출하나" | "데이터 자체의 invariants" |
| **단위** | persona row (84개) | data entity (6개) |
| **위치** | `domains/*.personas.yaml` | `data-models/*.persona.yaml` |
| **PK** | identity tuple | entity 이름 |
| **예** | `admin-monitor`, `b2b-customer-list-users` | `User`, `Credential`, `Session` |
| **표현 의무** | shape, access, regulation, expects | PII flag, retention, audit, masking |

두 perspective가 cross-reference (`pnpm coverage`의 "Data model coverage" 섹션).

## 3-bucket × 9-dimension 모델

```
identity (PK)         actor + data + intent + trigger + skill? + consumer?
reference (lookup)    regulation + channel
outcome (obligation)  shape + access + maps_to + expects
links (relation)      depends_on / refines / supersedes
```

각 bucket의 역할:

- **identity**는 enum 추론용 — 같은 6축 값은 한 페르소나 (다르면 분리)
- **reference**는 외부 vocab 변경이 매트릭스에 자동 전파되는 lookup
- **outcome**은 spec validate 입력 — shape는 응답 schema 모양, access는 보안/감사 의무, maps_to/expects는 OpenAPI 교차검증
- **links**는 시퀀스/변종/lifecycle 추적 (qa-sdk LinkType 어휘 차용 subset)

### identity — 6축 (4 필수 + 2 선택)

| 차원 | 의미 | 어휘 |
|------|------|------|
| `actor` | 권한 계층 | guest · user · owner-self · target-of-action · moderator · admin · third-party-app · system |
| `data` | 어떤 데이터 노드 | 도메인-로컬 (`User(self)`, `Credential`, `Session`…) — 정식 정의는 `data-models/` |
| `intent` | 무엇을 이루려는가 | create · read-detail · list · search · update · soft-delete · hard-delete · revoke · moderate · report · appeal · export · authenticate · monitor · subscribe |
| `trigger` | 언제 발동되는가 | 38값 × 4 category (operational/lifecycle/failure-mode/semantic) |
| `skill?` | 숙련도 | onboarding · novice · intermediate · expert |
| `consumer?` | stakeholder 시점 | end-user · backend · b2b-customer · internal-tool · site-admin · infra-ops · data-eng |

`skill`/`consumer`는 선택. spec/access 의무가 갈릴 때만 명시. 같은 actor·data·intent·trigger도 consumer 다르면 다른 페르소나(`listUsers` → admin-monitor / backend-svc / b2b-customer / cs-agent 4 변종).

### reference — 외부 카탈로그

| 차원 | 의미 | 어휘 |
|------|------|------|
| `regulation` | 법적/정책 제약 (다중) | pii-kr-pipa, pii-gdpr, content-violence, content-gambling, child-protection-coppa, financial-kyc |
| `channel` | 소비 매체 (다중) | browser, mobile-app, public-api, partner-sdk, webhook, csv-export, llm-tool-call, cli |

reference는 페르소나 식별에 영향 X. 다만 reference 값이 다르면서 **shape나 access도 다르면** 별 페르소나로 분리(채널 폭발 방지 휴리스틱).

### outcome — 계약 obligation

| 차원 | 의미 |
|------|------|
| `shape` | 응답 형태. detail · list-paginated · list-faceted · stream-sse · stream-ndjson · bulk-batch · command · token |
| `access` | 권한·감사·프라이버시 의무 (다중). public · private-self · scoped:read · scoped:write · scoped:admin · audited · pseudonymized · rate-limited · idempotent |
| `maps_to` | 이 페르소나를 실현하는 operationId 목록 |
| `expects` | 받게 되는 HTTP status code 목록. operation의 `responses` 키와 교차검증 |

### links — 페르소나 간 관계 (v0.9)

qa-sdk/definition-catalog의 `LinkType` 10종 중 페르소나 컨텍스트 의미 있는 3종 차용.

| linkType | 의미 | 예 |
|---|---|---|
| `depends_on` | 시간 선후 — A가 B 이후에 발동 | `user-self-read` depends_on `guest-login` |
| `refines` | perspective 변종 — A가 B의 stakeholder 변형 | `b2b-customer-list-users` refines `admin-monitor` |
| `supersedes` | 이전 페르소나 대체 (마이그레이션) | (정의 변경 시) |

식별자가 qa-sdk와 동일 → 향후 공통 패키지 분리 시 자연스럽게 흡수 가능.

## persona row 상태

매트릭스가 wishlist로 오염되지 않도록 status 필수.

| status | 의미 | maps_to 검증 |
|--------|------|-------------|
| `implemented` | spec에 실재하는 surface | 모든 operationId가 `.merged.yaml`에 존재 |
| `proposed` | 미래 surface — 다음 spec 작업 backlog | 비어있어도 OK |
| `deprecated` | 제거 예정 | 정리 작업 등록 |

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

## 9 검증 룰

| # | 룰 | 도입 |
|---|---|---|
| 1 | identity PK 유일성 | v0.1 |
| 2 | vocabulary 매칭 | v0.1 |
| 3 | maps_to 실재성 | v0.1 |
| 4 | 필수 identity | v0.1 |
| 5 | status enum | v0.1 |
| 6 | constraints (forbid/require) | v0.3 |
| 7 | drift (양방향 일관성) | v0.3 |
| 8 | expects ⊆ responses (range/default 매칭) | v0.4-prep |
| 9 | links 무결성 (target/self-link/cycle/supersedes) | v0.9 |

## 8 CLI

| CLI | 역할 |
|-----|------|
| `validate` | 9 룰 검증 (drift 포함) |
| `coverage` | 7-section markdown — operations / status / actors / regulations / channels / triggers / consumers / data-models |
| `bind` | `.merged.yaml` → `.merged.persona.yaml` (operation에 `x-persona` 주입) |
| `propose` | orphan response → 페르소나 stub 자동 (idempotent) |
| `gen:tests` | 매트릭스 → vitest 매트릭스 자동 (apps/playground) |
| `flow` | 의존성 그래프 markdown + mermaid + topological layers |
| `check` | `merge → bind → validate` 한 방 |
| `test` | 89 unit tests |

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
| **v0.9 (현재)** | persona dependency graph + `flow` CLI + 검증 룰 #9 (qa-sdk LinkType 차용) |

## 향후 후보

- `data_kind: pii` 같은 데이터 dictionary trait 도입 → 보류 constraint(`pii-bulk-requires-regulation`) 활성화
- qa-sdk 쪽에 `link-taxonomy` 공통 패키지 분리 협업
- mock-server에 `x-persona-test` 헤더 자동 라우팅
- `gen:tests`가 `links.depends_on`을 시퀀스 setup으로 활용

## 참조

- [Vision](../vision.md) — 전체 도메인 철학
- [Behavior ECS](./behavior-ecs.md) — 행동 좌표 (페르소나는 행동의 *주체* 차원에 해당)
- [`@oa-sdk/personas` README](../../packages/personas/README.md) — 패키지 사용법
- [`qa-sdk/packages/definition-catalog`](https://github.com/) — LinkType 어휘 출처 (참조)
