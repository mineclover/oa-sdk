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

## 3-bucket × 9-dimension 모델

```
┌─ identity (PK) ─ 같은 6축이면 같은 페르소나 ──────────────────────┐
│ actor      enum  guest/user/owner-self/admin/moderator/system/…  │
│ data       enum  도메인-로컬 (User(self), Credential, Session, …) │
│ intent     enum  create/read-detail/list/update/revoke/export/…   │
│ trigger    enum  signup/missing-auth/phantom-id/ops-monitoring/…  │
│ skill?     enum  onboarding/novice/intermediate/expert            │
│ consumer?  enum  end-user/backend/b2b-customer/internal-tool/…    │
├─ reference ─ 외부 카탈로그 lookup (enrichment) ────────────────────┤
│ regulation multi pii-kr-pipa, pii-gdpr, content-violence, …       │
│ channel    multi browser, mobile-app, public-api, csv-export, …   │
├─ outcome ─ API 계약이 만족해야 할 형태 ────────────────────────────┤
│ shape      enum  detail/list-paginated/stream-sse/bulk-batch/…    │
│ access     multi public/scoped:admin/audited/rate-limited/…       │
│ maps_to    multi 이 페르소나가 실현하는 operationId               │
│ expects    multi 받게 되는 HTTP status code                       │
└─ links ─ 페르소나 간 관계 (v0.9) ──────────────────────────────────┤
│ depends_on   A→B  A는 B 이후에 발동 (login → use)                 │
│ refines      A→B  A는 B의 perspective 변종 (b2b → admin-monitor)  │
│ supersedes   A→B  A가 B를 대체 (마이그레이션)                      │
└────────────────────────────────────────────────────────────────────┘
```

각 bucket은 독립적으로 운영:
- **identity** = enum 추론 / PK 유일성. `consumer`/`skill`은 선택 dimension.
- **reference** = 외부 vocab 변경이 도메인 매트릭스에 자동 전파.
- **outcome** = spec validate 입력. shape는 응답 schema 모양, access는 보안/감사 의무, maps_to/expects는 OpenAPI 교차검증.
- **links** = 시퀀스 / 변종 / lifecycle 추적 (qa-sdk/definition-catalog `LinkType` 어휘 차용).

## 파일 구조

```
src/
  registry.yaml                   # 3 bucket × 9 차원 정의 + statuses + constraints
  traits/                         # 닫힌 vocabulary (9 파일)
    actor.yaml intent.yaml skill.yaml consumer.yaml
    trigger.yaml link-type.yaml
    regulation.yaml channel.yaml
    shape.yaml access.yaml
  domains/                        # API consumer 페르소나 (4 파일)
    auth.personas.yaml me.personas.yaml
    users.personas.yaml health.personas.yaml
  data-models/                    # 데이터 모델링 페르소나 (6 파일)
    User.persona.yaml Credential.persona.yaml
    Account.persona.yaml Session.persona.yaml
    Report.persona.yaml HealthStatus.persona.yaml
scripts/                          # CLI 진입점 (6 파일)
  validate.ts coverage.ts bind.ts
  propose-personas.ts generate-tests.ts flow.ts
```

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
    skill: expert                  # traits/skill.yaml (선택)
  reference:
    regulation: [pii-kr-pipa]      # multi
    channel: [browser, public-api] # multi
  outcome:
    shape: list-paginated          # traits/shape.yaml
    access: [scoped:admin, audited]
    maps_to: [listUsers]           # implemented면 .merged.yaml에 실재해야 함
    expects: [200]                 # operation.responses 키와 교차검증
  links:                           # 다른 페르소나와의 관계 (선택)
    - linkType: depends_on
      target: guest-login
      reason: "login → use 시퀀스"
  notes: "운영 대시보드용. PIPA 적용 — 마스킹 필수."
```

## 두 가지 페르소나 — domains/ vs data-models/

| | `domains/*.personas.yaml` | `data-models/*.persona.yaml` |
|---|---|---|
| **관점** | "누가 / 왜 / 어떻게 호출하나" | "데이터 자체의 invariants" |
| **단위** | persona row (84개) | data entity (6개) |
| **predicate** | identity tuple = PK | entity 이름 = PK |
| **examples** | `admin-monitor`, `b2b-customer-list-users` | `User`, `Credential`, `Session` |
| **invariants** | shape, access, regulation, expects | PII flag, retention, audit, masking |

두 perspective가 매트릭스 한 곳에 섞이지 않게 분리. coverage report의 "Data model coverage" 섹션이 양쪽 cross-reference.

## 9 검증 룰

`pnpm validate`가 다음을 강제:

| # | 룰 | error/warn |
|---|---|---|
| 1 | identity PK 유일성 — 같은 (actor, data, intent, trigger, skill, consumer) tuple은 도메인 내 1회 | error |
| 2 | vocabulary 매칭 — actor/intent/skill/consumer/trigger/regulation/channel/shape/access/link-type 값이 trait yaml에 존재 | error |
| 3 | maps_to 실재성 — `implemented` row의 모든 operationId가 `.merged.yaml`에 존재 | error |
| 4 | 필수 identity — actor/data/intent/trigger 미설정 시 거부 | error |
| 5 | status enum — implemented/proposed/deprecated 외 값 거부 | error |
| 6 | constraints — `registry.constraints`의 forbid/require 룰. 미지원 predicate는 1회 skip-warn | error/warn |
| 7 | drift — `.merged.persona.yaml` 존재 시 operation별 `x-persona`가 매트릭스와 일치 | error |
| 8 | expects ⊆ responses — `expects`의 모든 status가 operation.responses에 선언. range(`2XX`)/`default` 매칭 | error |
| 9 | links 무결성 — link target은 known persona id, self-link 거부, depends_on 사이클 검출, supersedes target은 deprecated이어야 함 | error/warn |

## CLI 6종

```bash
pnpm validate           # 9 룰 검증 (drift 포함)
pnpm coverage           # 7-section markdown 리포트 (operations / status / actors / regulations / channels / triggers / consumers / data-models)
pnpm coverage --out=…   # 파일로
pnpm bind               # .merged.yaml → .merged.persona.yaml (x-persona 주입)
pnpm propose            # orphan response → 페르소나 stub 자동 (idempotent — acknowledged_orphans 존중)
pnpm gen:tests          # 매트릭스 → vitest 매트릭스 자동 생성 (apps/playground/tests/persona-roleplay.generated.test.ts)
pnpm flow               # 의존성 그래프 (markdown + mermaid + topological layers)
pnpm check              # merge → bind → validate 한 방
```

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

상세는 [`docs/concepts/data-persona.md`](../../docs/concepts/data-persona.md) 참조.

## 참조

- [Vision](../../docs/vision.md) — 전체 도메인 철학
- [Behavior ECS](../../docs/concepts/behavior-ecs.md) — 행동 좌표 시스템
- [Data Persona Concept](../../docs/concepts/data-persona.md) — 메타 프레임워크 컨셉
