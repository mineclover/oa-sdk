# @oa-sdk/personas

Data Persona meta-framework — v0.1.

페르소나는 *사람*이 아니라 **(주체-데이터 관계)** 입니다. 같은 데이터라도 누가/언제/왜
만지는지에 따라 다른 페르소나가 되고, 그게 곧 별도 API operation의 정당성입니다.
이 패키지는 OpenAPI surface 설계를 페르소나 매트릭스로부터 역으로 도출하기 위한
trait registry + per-domain matrix + validator를 제공합니다.

## 3 buckets

| Bucket | 역할 | 차원 |
|--------|------|------|
| **identity** | 페르소나 식별 (PK) | actor / data / intent / trigger / skill? |
| **reference** | 외부 카탈로그 lookup (enrichment) | regulation / channel |
| **outcome** | API 계약이 만족해야 할 형태 | shape / access / `maps_to` / `expects` |

차원 자체는 닫혀 있고, 각 차원의 어휘는 `src/traits/*.yaml`에서 자유 추가.
새 trait 값은 `status: proposed`로 시작 권장.

## 파일 구조

```
src/
  registry.yaml                   # 3 bucket × 차원 정의 + 상태 + 제약 (v0.1은 정의만)
  traits/
    actor.yaml intent.yaml skill.yaml
    regulation.yaml channel.yaml
    shape.yaml access.yaml
  domains/
    auth.personas.yaml
    me.personas.yaml
    users.personas.yaml
    health.personas.yaml
scripts/
  validate.ts                     # CLI 진입점
```

## 페르소나 row 골격

```yaml
- id: admin-monitor                # 도메인 안에서 유일
  status: implemented              # implemented | proposed | deprecated
  identity:
    actor: admin                   # traits/actor.yaml 어휘
    data: User(any)                # 도메인-로컬 enum
    intent: list                   # traits/intent.yaml 어휘
    trigger: ops-monitoring        # 도메인-로컬 자유 enum
    skill: expert                  # 선택 (traits/skill.yaml)
  reference:
    regulation: [pii-kr-pipa]      # multi
    channel: [browser, public-api] # multi
  outcome:
    shape: list-paginated          # single (traits/shape.yaml)
    access: [scoped:admin, audited]# multi (traits/access.yaml)
    maps_to: [listUsers]           # OpenAPI operationId — implemented면 .merged.yaml에 실재해야 함
    expects: [200]                 # 받게 되는 HTTP status — operation.responses 키에 존재해야 함
  notes: "PII 적용 — 마스킹 또는 운영자 본인 확인 강화."
```

## v0.7 — trigger taxonomy + acknowledged orphans

trigger 차원에 vocabulary 추가 (38 trigger × 4 카테고리: operational/lifecycle/failure-mode/semantic).
coverage report에 trigger category cross-section 섹션 추가:

```
| category     | personas | distinct triggers          |
| operational  | 10       | ops-monitoring, …          |
| lifecycle    | 12       | signup, token-expiring, …  |
| failure-mode | 53       | missing-auth, malformed-…  |
| semantic     | 3        | mention, abuse-detected, …  |
```

**Acknowledged orphans**: 의도적으로 페르소나로 모델링하지 않는 응답 코드(예: 500
infrastructure error)를 도메인 매트릭스에 명시:

```yaml
# users.personas.yaml
acknowledged_orphans:
  - operationId: createUser
    statusCode: "500"
    reason: "infrastructure error — no actor causes this; contract obligation only."
```

`pnpm propose`가 이 마커를 보고 stub 생성에서 제외 → propose CLI가 idempotent해짐.

## v0.6 — propose-personas (orphan → stub 자동)

`pnpm coverage`가 발견한 orphan response를 페르소나 stub으로 변환:

```bash
pnpm --filter @oa-sdk/personas propose                    # stdout
pnpm --filter @oa-sdk/personas propose --out=stubs.yaml   # file
```

Status code별 휴리스틱:

| code | actor | trigger | id prefix |
|------|-------|---------|-----------|
| 400 | (op 상속) | malformed-request | malformed |
| 401 | guest | missing-auth | guest-unauthorized |
| 403 | user | insufficient-scope | insufficient-scope |
| 404 | (op 상속) | phantom-id | not-found |
| 409 | (op 상속) | duplicate-identity | conflict |
| 422 | (op 상속) | malformed-payload | malformed-payload |
| 429 | (op 상속) | rate-limit-hit | rate-limited |
| 503 | system | dependency-down | dependency-down |

각 stub은 `status: proposed`로 시작 — 검토 후 `implemented`로 승격하면서 `notes` 보강. 출력은 `# domain: X` / `# ── opId ──` 헤더로 그룹핑되어 도메인 .personas.yaml에 직접 복사 가능.

운영 사이클:
```
pnpm coverage          # orphan 발견
pnpm propose           # stub 자동 생성
(수동) 검토 + 도메인 yaml에 복사 + status: implemented 승격
pnpm gen:tests         # e2e 자동 확장
```

## v0.5 — auto-generated e2e roleplay suite

매트릭스에서 vitest 테스트 스위트 자동 생성:

```bash
pnpm --filter @oa-sdk/personas gen:tests
# → apps/playground/tests/persona-roleplay.generated.test.ts (26 tests)
```

각 implemented 페르소나가 1개 `it()` 블록이 됨 — 새 페르소나 1행 = 새 테스트 1줄. 페르소나 추가 후 `pnpm gen:tests`로 재생성하고 커밋.

생성기 동작:
- path 템플릿 자동 substitution (parameter examples → format 추론 → fallback)
- request body는 spec의 `examples.default.dataValue` / `value` / `example` 우선 추출
- 출력 파일은 portable (`new URL(relPath, import.meta.url)` 사용 — 절대경로 X)
- 안정 정렬 (domain → persona id) → diff 깔끔

## ⚠️ 한계 — 계약 시뮬레이션 vs 실제 검증

페르소나 매트릭스 기반 e2e는 **계약 형태(contract shape)** 만 확인합니다. mock-server의
`override`는 요청을 무시하고 페르소나가 claim한 status code/body를 반환하므로:

- ✅ 검증되는 것 — 응답 status, 응답 body 모양, persona ↔ operation 매핑, drift, vocab
- ❌ *검증되지 않는* 것 — 실제 request body validation (AJV), 실제 인증 처리, 실제 비즈니스 로직

예: `malformed-payload-register` 페르소나가 422를 받지만 — 테스트는 *유효한* body를
보내도 mock이 422를 반환합니다. 진짜 422를 트리거하려면 real backend 또는 mock-server의
override 우회 모드가 필요합니다.

이 한계는 *의도된 것* — 페르소나는 "이 actor가 이 operation을 호출했을 때 *계약상* 무엇이
오기로 약속됐나"를 다룹니다. 실제 validation의 *동작* 검증은 mock-server가 자체적으로
schema 기반으로 수행하는 별 트랙입니다 (override 없이 호출하면 동작).

## v0.4 — persona roleplay (mock branching)

페르소나 매트릭스를 그대로 mock-server 응답 분기로 사용:

```typescript
import { createNodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient } from '@oa-sdk/mock-server'
import { createPersonaMockClient, loadAllDomains } from '@oa-sdk/personas'

const server = createNodeMockServer(spec, { port: 0 })
await server.start()
const client = createTestClient(server)
const personas = createPersonaMockClient({ spec, domains: loadAllDomains() })

// 같은 endpoint, 다른 페르소나 → 다른 응답
personas.switchTo(server, 'admin-monitor')
expect((await client.get('/users')).status).toBe(200)

personas.switchTo(server, 'guest-unauthorized-list')
expect((await client.get('/users')).status).toBe(401)
```

API:
- `act(personaId, operationId)` — 순수 시뮬레이션 (HTTP 없이 응답 모양 반환)
- `personasFor(operationId)` — 이 operation을 claim하는 모든 페르소나 id 열거
- `applyTo(server, personaId)` — mock-server에 페르소나 expects를 override로 푸시
- `switchTo(server, personaId)` — clearOverrides + applyTo

## CLI

```bash
# 한 방에 — schemas merge → bind → validate
pnpm --filter @oa-sdk/personas check

# 단계별:
pnpm --filter @oa-sdk/personas validate     # PK/vocab/maps_to/expects/constraints/drift
pnpm --filter @oa-sdk/personas coverage     # operation/actor/regulation/channel/status cross-cut
pnpm --filter @oa-sdk/personas coverage --out=coverage.md
pnpm --filter @oa-sdk/personas bind         # .merged.yaml → .merged.persona.yaml (x-persona 주입)
```

## v0.3 spec binding

`pnpm bind`은 `.merged.yaml`을 읽고 각 operation에 `x-persona` extension을 주입한
`.merged.persona.yaml`을 만든다. 페르소나 매트릭스가 SoT, OpenAPI는 derived projection.

```yaml
# .merged.persona.yaml — 자동 생성, 직접 편집 금지
info:
  ...
  x-persona-meta:
    version: "0.1"
    matrices: 4
    personas: 25
    implemented: 14
    proposed: 11
    generatedAt: 2026-05-04T...
paths:
  /users:
    get:
      operationId: listUsers
      x-persona: [admin-monitor]      # ← 매트릭스에서 자동 도출
```

이후 `pnpm validate`은 `.merged.persona.yaml`이 존재하면 양방향 일관성 검증을 수행:
- operation의 `x-persona`가 매트릭스의 `maps_to`와 정확히 같은 페어를 표현해야 함
- 한쪽만 수정하고 bind를 잊으면 drift error → CI 차단

권장 워크플로우:
```bash
pnpm --filter @oa-sdk/schemas merge      # .merged.yaml
pnpm --filter @oa-sdk/personas bind      # .merged.persona.yaml
pnpm --filter @oa-sdk/personas validate  # PK + vocab + drift
```

## v0.1 검증 룰

`pnpm --filter @oa-sdk/personas validate`

1. **identity PK 유일성** — 같은 (actor, data, intent, trigger, skill) tuple이 도메인 내 1회만.
2. **vocabulary 매칭** — actor / intent / skill / regulation / channel / shape / access 값이 trait yaml에 존재.
3. **maps_to 실재성** — `status: implemented`인 row의 모든 operationId가 `.merged.yaml`에 존재.
4. **필수 identity** — actor / data / intent / trigger 미설정 시 error.
5. **status enum** — implemented / proposed / deprecated 외 값 거부.
6. **constraints** (v0.3) — `registry.constraints`의 `forbid`/`require` 룰을 강제. 지원되지 않는 predicate(예: `data_kind`)가 포함된 룰은 1회 skip-warn 후 통과.
7. **drift** (v0.3, optional) — `.merged.persona.yaml` 존재 시 operation별 `x-persona`가 매트릭스와 일치하는지 검사.
8. **expects** (v0.4-prep) — `outcome.expects`의 모든 status code가 매핑된 operation의 `responses`에 선언돼야 함. OpenAPI range(`2XX`/`5XX`)와 `default`도 매칭. implemented이지만 expects 비어있으면 warn.

## v0.4-prep response status coverage

`pnpm coverage` 출력에 새 섹션 "Response status coverage"가 추가됨. 각 operation의:
- **declared** — OpenAPI에 선언된 모든 응답 코드 (`200`, `401`, ...)
- **persona-expected** — implemented 페르소나가 `outcome.expects`로 claim한 코드
- **orphans** — declared이지만 어떤 페르소나도 expects하지 않는 코드 → negative-path 페르소나 backlog

예: `updateUser`의 orphans `[400, 401, 403, 404, 422]` → 각각 "non-admin이 role 변경 시도 → 403", "잘못된 role enum → 422" 등 negative-path 페르소나 후보를 자동 발굴.

## v0.2 커버리지 리포트

`pnpm --filter @oa-sdk/personas coverage` 가 출력하는 markdown:

- **Operation coverage** — operationId × 페르소나/actor/regulation/channel 테이블
- **Unjustified operations** — `implemented` 페르소나 없는 operation (정당화되지 않은 surface)
- **Actor cross-section** — actor가 닿는 operation 집합 (admin이 어디까지 닿나?)
- **Regulation cross-section** — 규제가 적용되는 operation 집합 (PIPA 적용 endpoint 일람)
- **Channel cross-section** — 채널별 operation 집합
- **Gap backlog** — `proposed` 페르소나 (다음 spec 작업 후보)

unjustified operation이 1개 이상이면 exit 1 → CI gate 가능.

## 운영 사이클

```
1. 페르소나 추가 (도메인 .personas.yaml 새 row)
   └ 새 trait 값 필요 시 traits/*.yaml 어휘 등록 (status: proposed)
2. validate
3. gap = status: proposed && maps_to: []  → 다음 spec 작업 backlog
4. spec 보강 후 → status: implemented 로 승격
5. (v0.2) operation에 x-persona: [persona-id, ...] 박아 OpenAPI에 직접 결합
```

## API (programmatic)

```typescript
import {
  loadRegistry,
  loadAllTraits,
  loadAllDomains,
  loadOperationIdsFromMergedSpec,
  validate,
} from '@oa-sdk/personas'

const registry = loadRegistry()
const traits = loadAllTraits(registry)
const domains = loadAllDomains()
const knownOperationIds = loadOperationIdsFromMergedSpec('path/to/.merged.yaml')

const report = validate({ registry, traits, domains, knownOperationIds })
```
