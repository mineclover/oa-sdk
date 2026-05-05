# @oa-sdk/personas

> OpenAPI 계약 위에 페르소나 매트릭스를 올려, "누가 / 어떤 데이터를 / 어떤 시점에 / 어떤 stakeholder 시점에서" 호출하는지 ECS 스타일 trait 합성으로 표현하고, 매트릭스와 spec의 양방향 일관성을 강제하면서 e2e 시나리오를 자동 도출하는 **메타 프레임워크**.

페르소나는 *사람*이 아니라 **(주체-데이터 관계)**. 같은 데이터라도 누가/언제/왜 만지는지에 따라 다른 페르소나가 되고, 그게 곧 별도 API operation의 정당성.

## Quick start

```bash
# 한 방에 — schemas merge → bind → validate
pnpm --filter @oa-sdk/personas check

# 또는 단계별
pnpm --filter @oa-sdk/personas validate     # 9 룰 검증
pnpm --filter @oa-sdk/personas coverage     # cross-cut 리포트 (markdown)
pnpm --filter @oa-sdk/personas bind         # spec에 x-persona 주입
pnpm --filter @oa-sdk/personas propose      # orphan → stub 자동 생성
pnpm --filter @oa-sdk/personas gen:tests    # vitest 매트릭스 자동
pnpm --filter @oa-sdk/personas flow         # 의존성 그래프 (markdown + mermaid)
```

루트에서 `pnpm personas:check / coverage / test`로도 실행 가능.

## 모델 — 3 bucket × 11 dimension + skills + links

```
┌─ identity (PK) ─ 같은 6축이면 같은 페르소나 ──────────────────────────┐
│ actor         enum  guest/user/owner-self/admin/moderator/system/…   │
│ data          enum  도메인-로컬 (User(self), Credential, Session, …)  │
│ intent        enum  create/read-detail/list/update/revoke/export/…    │
│ trigger       enum  signup/missing-auth/phantom-id/ops-monitoring/…   │
│ proficiency?  enum  사용자 숙련도 — onboarding/novice/intermediate/expert │
│ consumer?     enum  end-user/backend/b2b-customer/internal-tool/…     │
├─ reference ─ 외부 카탈로그 lookup (enrichment, 다중) ──────────────────┤
│ regulation             pii-kr-pipa / pii-gdpr / content-violence / …  │
│ channel                browser / mobile-app / public-api / …          │
│ region                 KR / EU / US / JP / SG / APAC / GLOBAL          │
│ compliance_framework   SOC2 / ISO27001 / HIPAA / PCI-DSS / ISMS-P     │
├─ outcome ─ API 계약이 만족해야 할 형태 ─────────────────────────────────┤
│ shape         enum   detail/list-paginated/stream-sse/bulk-batch/…    │
│ access        multi  public/scoped:admin/audited/rate-limited/…       │
│ maps_to       multi  이 페르소나가 실현하는 operationId               │
│ expects       multi  받게 되는 HTTP status code                       │
├─ skills (top-level, v0.11) ─ 페르소나 고유 보유 능력 (multi) ───────────┤
│ request-shape    pagination / filter-by-role / batch / …              │
│ response-shape   sse-stream / etag-supported / partial-response       │
│ lifecycle        idempotent / retryable / cacheable                    │
│ observability    audit-emission / metrics-emission / trace-context     │
│ security         pii-visible-admin / pii-masked-default / pseudonymized│
│ integration      oauth-scope-aware / rate-limit-honored / webhook-…   │
├─ links ─ 페르소나 간 관계 (v0.9) ──────────────────────────────────────┤
│ depends_on   A→B  A는 B 이후에 발동 (login → use)                     │
│ refines      A→B  A는 B의 perspective 변종 (b2b → admin-monitor)      │
│ supersedes   A→B  A가 B를 대체 (마이그레이션)                          │
└────────────────────────────────────────────────────────────────────────┘
```

각 영역의 의도:
- **identity** = enum 추론 / PK 유일성. `proficiency`/`consumer`는 선택 dimension.
- **reference** = 외부 vocab 변경이 매트릭스에 자동 전파. PK 영향 X.
- **outcome** = OpenAPI spec validate 입력. shape는 응답 schema 모양, access는 의무, maps_to/expects는 spec 교차검증.
- **skills** (v0.11) = 페르소나 고유 보유 능력 (RPG 캐릭터의 perks 같음). access(의무)와 짝 — `audited` access면 `audit-emission` skill 필수 (정합성 룰 #6).
- **links** = 시퀀스 / 변종 / lifecycle 추적 (qa-sdk/definition-catalog `LinkType` 어휘 차용).

## 파일 구조

```
src/
  registry.yaml                   # bucket 정의 + top_level_vocabularies + statuses + constraints
  traits/                         # 닫힌 vocabulary (12 파일)
    actor.yaml intent.yaml proficiency.yaml consumer.yaml
    trigger.yaml link-type.yaml skill.yaml             # ← skill = capability tags (v0.11)
    regulation.yaml channel.yaml region.yaml compliance-framework.yaml
    shape.yaml access.yaml
  domains/                        # API consumer 페르소나 매트릭스 (4 파일)
    auth.personas.yaml me.personas.yaml
    users.personas.yaml health.personas.yaml
  data-models/                    # 데이터 모델링 페르소나 — entity invariants (6 파일)
    User.persona.yaml Credential.persona.yaml
    Account.persona.yaml Session.persona.yaml
    Report.persona.yaml HealthStatus.persona.yaml
  profiles/                       # saved query bundles (5 파일, v0.11.5)
    mobile-app.profile.yaml b2b-customer-suite.profile.yaml
    pipa-compliance.profile.yaml audit-required.profile.yaml
    infra-ops-monitoring.profile.yaml
scripts/                          # CLI 진입점 (8 파일)
  validate.ts coverage.ts bind.ts
  propose-personas.ts generate-tests.ts flow.ts profile.ts
```

**파일 명명 컨벤션**:
- `traits/<name>.yaml` — 단일 vocabulary (actor, channel, …)
- `domains/<domain>.personas.yaml` — 한 도메인의 *복수* persona row 매트릭스
- `data-models/<Entity>.persona.yaml` — 한 데이터 entity의 *단일* invariant 정의
- `profiles/<name>.profile.yaml` — *단일* persona 번들 query

## 도메인 ownership (v0.12) + surface kind (v0.13)

각 도메인 .personas.yaml은 자기 책임을 명시:

```yaml
# domains/users.personas.yaml
domain: users
description: "사용자 관리 — admin operations"
metadata:
  kind: openapi-http              # v0.13 — surface 종류
  responsibility: "사용자 데이터 admin operations — list/조회/관리/모더레이션"
  owns_entities:
    - "User(any)"            # admin 컨텍스트
    - "User(other)"           # 일반 user의 다른 사용자 컨텍스트
    - "Role"
    - "Report"
  allowed_actors:
    - admin
    - user
    - moderator
    - target-of-action
    - third-party-app
    - system
    - guest
personas: [...]
```

룰 #20-21이 강제 — `data` / `actor` 가 metadata 외 값을 가지면 error. 도메인 boundary가 *코드로* 보장됨. `me` 도메인의 페르소나가 `User(any)`를 잘못 쓰면 즉시 검증 실패.

### v0.13 — surface kind

`metadata.kind` 으로 도메인의 surface 종류를 선언. 미설정 시 `openapi-http` (backward-compat).

| kind | 의미 | 비활성 룰 |
|------|------|----------|
| `openapi-http` | HTTP REST/RPC API (default) | (모든 룰 적용) |
| `cli-tool`     | CLI 명령 surface — synthetic operationId 허용 | #3 maps_to 존재성, #7 drift, #8 expects |
| `library-api`  | 함수/모듈 surface — operationId 무관 | #3 maps_to 존재성, #7 drift, #8 expects |
| `event-stream` | pub/sub 이벤트 — channel/payload 위주 | #3 maps_to 존재성, #7 drift, #8 expects |

비-`openapi-http` 도메인은 OpenAPI 검증 룰을 skip하지만, 어휘 매칭 / domain ownership / 카디널리티 등 모든 *intrinsic* 룰은 그대로 적용. `personas-cli` 도메인이 dogfood 사례 — `@oa-sdk/personas` 자체 11 CLI를 페르소나로 모델링.

## 페르소나 row 골격

```yaml
- id: admin-monitor                # 도메인 안에서 유일
  status: implemented              # implemented | proposed | deprecated
  identity:
    actor: admin                   # traits/actor.yaml
    data: User(any)                # 도메인-로컬 enum (data-models/User에 invariants)
    intent: list                   # traits/intent.yaml
    trigger: ops-monitoring        # traits/trigger.yaml
    consumer: internal-tool        # traits/consumer.yaml (선택)
    proficiency: expert             # traits/proficiency.yaml (선택)
  reference:
    regulation: [pii-kr-pipa]      # multi
    channel: [browser, public-api] # multi
    region: [KR]                    # multi (v0.10)
    compliance_framework: [SOC2]    # multi (v0.10)
  outcome:
    shape: list-paginated          # traits/shape.yaml
    access: [scoped:admin, audited]
    maps_to: [listUsers]           # implemented면 .merged.yaml에 실재해야 함
    expects: [200]                 # operation.responses 키와 교차검증
  skills:                          # 페르소나 고유 능력 (v0.11, top-level)
    - pagination                   # traits/skill.yaml
    - filter-by-role
    - audit-emission                # `audited` access와 짝 (정합성 룰)
    - pii-visible-admin
  links:                           # 다른 페르소나와의 관계 (선택)
    - linkType: depends_on
      target: guest-login
      reason: "login → use 시퀀스"
  notes: "운영 대시보드용. PIPA 적용 — 마스킹 필수."
```

## 페르소나의 3 종류 — domains / data-models / profiles

| 종류 | 파일 | 단위 | 의미 |
|------|------|------|------|
| **API consumer** | `domains/<dom>.personas.yaml` | row × N | 누가/언제/어떻게 호출하나 (kind: openapi-http / cli-tool / library-api / event-stream) |
| **data-modeling** | `data-models/<Entity>.persona.yaml` | 단일 entity | 데이터 자체 invariants (PII/audit/retention) |
| **profile** (v0.11.5) | `profiles/<name>.profile.yaml` | 단일 query | saved query — selector + 명시 + extends + exclude |

### domains/ (API consumer matrices) vs data-models/ (entity invariants)

| | `domains/*.personas.yaml` | `data-models/*.persona.yaml` |
|---|---|---|
| **관점** | "누가 / 왜 / 어떻게 호출하나" | "데이터 자체의 invariants" |
| **단위** | persona row (95개 — HTTP 84 + CLI 11 dogfood) | data entity (6개) |
| **predicate** | identity tuple = PK | entity 이름 = PK |
| **examples** | `admin-monitor`, `b2b-customer-list-users` | `User`, `Credential`, `Session` |
| **invariants** | shape, access, regulation, expects | PII flag, retention, audit, masking |

두 perspective가 매트릭스 한 곳에 섞이지 않게 분리. coverage report의 "Data model coverage" 섹션이 양쪽 cross-reference.

### profiles/ (saved query bundles)

자주 쓰는 페르소나 query를 yaml로 저장:
```yaml
# profiles/audit-required.profile.yaml
id: audit-required
description: "audit-emission skill 보유 페르소나 — SOC2 audit scope"
selector:
  status: [implemented]
  skills: [audit-emission]
```

4가지 정의 방식 조합:
- `selector` — 동적 매칭 (status, identity·reference·outcome·skills 어떤 차원이든)
- `personas` — 명시적 id 추가 (selector 결과에 union)
- `extends` — 다른 profile 흡수 (재귀, cycle detection)
- `exclude` — 결과에서 빠질 id

`pnpm profiles list` / `pnpm profiles show <id>`로 조회.

## 18 검증 룰

`pnpm validate`가 다음을 강제:

| # | 룰 | severity | 도입 |
|---|---|---|---|
| 1 | identity PK 유일성 — `(actor, data, intent, trigger, proficiency, consumer)` tuple 도메인 내 1회 | error | v0.1 |
| 2 | vocabulary 매칭 — 모든 trait dimension 값이 trait yaml에 존재 | error | v0.1 |
| 3 | maps_to 실재성 — `implemented` row의 operationId가 `.merged.yaml`에 존재 | error | v0.1 |
| 4 | 필수 identity — actor/data/intent/trigger 미설정 시 거부 | error | v0.1 |
| 5 | status enum — implemented/proposed/deprecated 외 거부 | error | v0.1 |
| 6 | `registry.constraints` 강제 — forbid/require 룰. 미지원 predicate는 1회 skip-warn | error/warn | v0.3 |
| 7 | drift — `.merged.persona.yaml` 존재 시 `x-persona`가 매트릭스와 일치 | error | v0.3 |
| 8 | expects ⊆ responses — `expects` 모든 status가 operation.responses에. range/`default` 매칭 | error | v0.4-prep |
| 9 | links 무결성 — target 실재 / self-link 거부 / depends_on cycle / supersedes deprecated | error/warn | v0.9 |
| 10 | regulation ↔ region 정합 — `pii-kr-pipa` 면 `region: [KR]`, `pii-gdpr` 면 `[EU]` | error | v0.10.5 |
| 11 | guest-cannot-hard-delete — 미인증 actor는 영구삭제 성공 불가 (success 코드 expects 시) | error | v0.3 |
| 15 | skills vocabulary — `Persona.skills` 값이 `traits/skill.yaml`에 존재 | error | v0.11 |
| 16 | profile id 유일성 | error | v0.11.5 |
| 17 | profile.personas / profile.exclude 의 persona id 실재성 | error/warn | v0.11.5 |
| 18 | profile.extends 사이클 검출 + unknown profile reference | error | v0.11.5 |
| 19 | empty profile (selector/personas/extends 모두 빈 경우) | warn | v0.11.5 |
| 20 | domain ownership — `data` ∈ `metadata.owns_entities` | error | v0.12 |
| 21 | domain ownership — `actor` ∈ `metadata.allowed_actors` | error | v0.12 |
| (kind-aware) | 룰 #3, #7, #8은 `metadata.kind === 'openapi-http'` 도메인에만 적용 (v0.13) | — | v0.13 |
| (consistency) | audited↔audit-emission, rate-limited↔rate-limit-honored, pseudonymized↔pseudonymized | warn | v0.11 P4 |

## CLI 10종

```bash
pnpm wizard                   # baseline 부트스트랩 (1회용) — region/regulation/compliance/stakeholders + spec path 입력 → .persona-project.yaml
pnpm validate                 # 22 룰 검증 (drift 포함, kind-aware: #3/#7/#8은 openapi-http 도메인만)
pnpm coverage                 # 12-section markdown — operation / response status / actor / regulation / channel / region / compliance / trigger / skill / consumer / data-model / acknowledged-orphans
pnpm coverage --out=…         # 파일로
pnpm bind                     # .merged.yaml → .merged.persona.yaml (x-persona 주입)
pnpm propose                  # orphan response → 페르소나 stub 자동 (idempotent — acknowledged_orphans 존중)
pnpm propose --from-spec      # 전체 spec scan: orphan + new-op + new-schema 3 signal (v0.12)
pnpm gen:tests                # 매트릭스 → vitest 매트릭스 자동 생성
pnpm flow                     # 의존성 그래프 (markdown + mermaid + topological layers)
pnpm profiles list            # saved profile 일람 + 각 페르소나 수
pnpm profiles show <id>       # 단일 profile expand 결과 (markdown)
pnpm check                    # merge → bind → validate 한 방
```

### 운영 패러다임 — baseline-once + signal-driven

```
1. baseline (1회)            wizard로 system context 결정 → .persona-project.yaml
                             traits/* / domain ownership / 프로젝트 메타 고정.

2. signal-driven (반복)       spec/data 변동 → propose가 signal 감지 → auto-stub
                             3 signal: new-op / orphan / new-schema
                             출력: status: proposed → 사람 review → implemented 승격.

3. domain ownership           각 도메인 .personas.yaml의 metadata로 boundary 강화
                             (entity 소유, actor 허용, channel 허용)

4. surface kind (v0.13)       metadata.kind로 도메인 surface 종류 선언
                             openapi-http(default) / cli-tool / library-api / event-stream
                             non-HTTP 도메인은 OpenAPI 룰(maps_to/drift/expects) skip
```

**주요 원칙**:
- 사람이 매트릭스를 *직접* 늘리지 않음. spec 변경 / orphan 발견이 signal을 발생.
- baseline은 신중히 한 번 → 변경 X (큰 refactor 시 `pnpm wizard --reset`).
- review 게이트가 항상 있음 — auto-stub은 `proposed` 상태로만 도입, `implemented`로 promote는 사람이.

## 운영 사이클

```
spec 변경 또는 페르소나 추가
  ↓
pnpm check                   ─── 검증 실패면 여기서 멈춤
  ↓
pnpm coverage                ─── orphan / unjustified / cross-section 확인
  ↓
(orphan 있으면) pnpm propose ─── proposed stub 생성 → 검토 → 도메인 yaml에 복사 → status 승격
  ↓
pnpm gen:tests               ─── e2e 테스트 자동 갱신
  ↓
e2e 실행                     ─── 같은 op가 페르소나에 따라 다른 status로 분기
```

## API (programmatic)

```typescript
import {
  loadRegistry, loadAllTraits, loadAllDomains, loadAllDataModels,
  loadOperationsFromMergedSpec,
  validate, analyzeCoverage, applyBindings,
  proposeStubsFromOrphans, generateVitestSuite,
  collectEdges, topologicalLayers, renderFlowMarkdown,
  resolvePersonaResponse, createPersonaMockClient,
} from '@oa-sdk/personas'

// 매트릭스 검증
const report = validate({
  registry: loadRegistry(),
  traits: loadAllTraits(loadRegistry()),
  domains: loadAllDomains(),
  knownOperations: loadOperationsFromMergedSpec('.merged.yaml'),
})

// e2e 페르소나 시뮬레이터
const client = createPersonaMockClient({ spec, domains: loadAllDomains() })
client.applyTo(mockServer, 'admin-monitor')        // 200 OK overrides
const res = await fetch('/users', ...)              // → 200
client.switchTo(mockServer, 'guest-unauthorized-list')  // → 401
```

## ⚠️ 한계 — 계약 시뮬레이션 vs 실제 검증

페르소나 매트릭스 기반 e2e는 **계약 형태(contract shape)** 만 확인합니다. mock-server의 `override`는 요청을 무시하고 페르소나가 claim한 status code/body를 반환:

- ✅ 검증되는 것 — 응답 status, body 모양, persona ↔ operation 매핑, drift, vocab, dependency cycles
- ❌ *검증되지 않는 것* — 실제 request body validation (AJV), 실제 인증 처리, 실제 비즈니스 로직

예: `malformed-payload-register` 페르소나가 422를 받지만 — 테스트는 *유효한* body를 보내도 mock이 422를 반환합니다. 진짜 422를 트리거하려면 real backend 또는 mock-server의 override 우회 모드가 필요.

이 한계는 *의도된 것* — 페르소나는 "이 actor가 이 operation을 호출했을 때 *계약상* 무엇이 오기로 약속됐나"를 다룹니다. 실제 validation의 *동작* 검증은 mock-server가 자체적으로 schema 기반으로 수행하는 별 트랙입니다 (override 없이 호출하면 동작).

## CI 통합

운영 환경에서 권장되는 게이트:

```yaml
# .github/workflows/personas.yml (예시)
- run: pnpm install
- run: pnpm --filter @oa-sdk/personas check         # merge → bind → validate
- run: pnpm --filter @oa-sdk/personas coverage --out=coverage.md
- run: pnpm --filter @oa-sdk/personas test
- run: pnpm --filter @oa-sdk/personas gen:tests
- run: pnpm --filter playground test                # 211 e2e
```

`check`는 `merge` 누락 시 drift error로 차단 → 매트릭스 변경 후 bind 잊는 사고 방지.

## 안정성 — 누적 지표

| 지표 | v0.13 |
|------|---------|
| personas | 95 (84 implemented · 11 proposed) |
| domains | 5 (auth/health/me/users + personas-cli dogfood) |
| surface kinds | 4 (openapi-http: 4 / cli-tool: 1) |
| operations | 27/27 covered (HTTP) |
| validation rules | 22 + kind-aware 분기 |
| trait files | 13 |
| sample profiles | 5 |
| unit tests | 142 |
| e2e tests | 211 |
| 검증 게이트 errors | 0 |
| 검증 게이트 warnings | 0 |

## 외부 어휘 차용

- `traits/link-type.yaml`은 `~/workflow/qa-sdk/packages/definition-catalog`의 `LinkType` 10종 중 페르소나 컨텍스트 의미 있는 3종(`depends_on`/`refines`/`supersedes`)만 차용. 식별자 동일 → 향후 공통 패키지 분리 시 자연스럽게 흡수 가능.

## 버전 이력 (요약)

| 버전 | 핵심 추가 |
|------|---------|
| v0.1 | 3-bucket framework + 5 검증 룰 + 7 trait + 4 domain matrices |
| v0.2 | `coverage` CLI — operation/actor/regulation/channel cross-cut + unjustified 검출 |
| v0.3 | `bind` CLI + `x-persona` extension 주입 + drift 검출 + constraints 강제 |
| v0.4-prep | `outcome.expects` (HTTP status) + range/`default` 매칭 + response status orphan 검출 |
| v0.4 | persona resolver + `createPersonaMockClient` (`act`/`applyTo`/`switchTo`) — e2e roleplay |
| v0.5 | `gen:tests` — 매트릭스 → vitest 자동 |
| v0.5.5 | 11 proposed → spec 구현 + 11개 신규 endpoint |
| v0.6 | `propose` CLI — orphan response → 페르소나 stub 자동 |
| v0.7 | `traits/trigger.yaml` 카탈로그 (38값 × 4카테고리) + `acknowledged_orphans` (idempotent) |
| v0.8 | `consumer` perspective 차원 (7값 × 4카테고리) + `data-models/` 분리 (6 entities) |
| v0.9 | persona dependency graph (`links`) + `flow` CLI + 검증 룰 #9 (cycle detection) |
| v0.10 | reference 확장 — `region` + `compliance_framework` (L3+L4). coverage cross-section 2개 추가. 확장 5단계 taxonomy 정의 |
| v0.11 | `identity.skill` → `identity.proficiency` rename + `Persona.skills` (capability tags) + `traits/skill.yaml` (6 cat × 25 값) + 검증 룰 #15 + access↔skills 일관성 constraint 3개 |
| v0.11.5 | `PersonaProfile` (saved query bundle) + 5 sample profiles (mobile-app / b2b-customer / pipa-compliance / audit-required / infra-ops) + `pnpm profiles` CLI + 검증 룰 #16-18 |
| v0.12 | baseline-once + signal-driven (`pnpm wizard` + `pnpm propose --from-spec` 3 signal) + domain ownership boundary (`metadata.{owns_entities,allowed_actors,responsibility}`) + 검증 룰 #20-21 |
| v0.13 | surface kind dimension (`metadata.kind: openapi-http \| cli-tool \| library-api \| event-stream`) + 룰 #3/#7/#8 kind-conditional + 신규 어휘 (`actor`: framework-developer/ci-bot/auditor, `intent`: inspect/transform/validate, `trigger`: pre-commit/ci-gate/audit-review/design-review/release-prep) + dogfood `personas-cli` 도메인 11 페르소나 promote + `src/kind.ts` 모듈 추출 |

상세는 [`docs/concepts/data-persona.md`](../../docs/concepts/data-persona.md) 참조.

## 참조

- [Vision](../../docs/vision.md) — 전체 도메인 철학
- [Behavior ECS](../../docs/concepts/behavior-ecs.md) — 행동 좌표 시스템
- [Data Persona Concept](../../docs/concepts/data-persona.md) — 메타 프레임워크 컨셉
