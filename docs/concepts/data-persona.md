# Data Persona

> 페르소나 기반 API endpoint 탐색을 위한 메타 프레임워크. v0.1.
> 구현 패키지: [`@oa-sdk/personas`](../../packages/personas/README.md)

## One Sentence

페르소나는 *사람*이 아니라 **(주체-데이터 관계)** 다. 같은 데이터라도 누가/언제/왜
만지는지에 따라 다른 페르소나가 되고, 그게 곧 별도 API operation의 정당성이다.

## 3 buckets — 차원 압축

10개의 trait 차원을 의미 단위 3 bucket으로 묶어 식별/탐색/계약 검증을 분리한다.

| Bucket | 역할 | 차원 |
|--------|------|------|
| **identity** | 페르소나 좌표 (PK) — 추론 입력 | actor · data · intent · trigger · skill? |
| **reference** | 외부 카탈로그 lookup — enrichment | regulation · channel |
| **outcome** | API 계약이 만족해야 할 형태 — 검증 결과 | shape · access · `maps_to` |

각 bucket은 독립적으로 운영된다:

- **identity**는 enum 추론용. 같은 5축 값은 한 페르소나(다르면 분리).
- **reference**는 외부 vocab 변경이 도메인 매트릭스에 자동 전파되는 lookup.
- **outcome**은 spec validate 입력. shape는 응답 schema 모양, access는 보안/감사
  의무, maps_to는 operationId 실재성 검사.

## identity — 5축

| 차원 | 의미 | 어휘 |
|------|------|------|
| `actor` | 데이터에 대한 권한 계층 | guest · user · owner-self · target-of-action · moderator · admin · third-party-app · system |
| `data` | 어떤 데이터 노드를 만지는가 | 도메인-로컬 (예: `User(self)`, `Post`, `Session`) |
| `intent` | 무엇을 이루려는가 | create · read-detail · list · search · update · soft-delete · hard-delete · moderate · report · appeal · export · authenticate · monitor · subscribe |
| `trigger` | 언제 발동되는가 | 도메인-로컬 (예: `signup`, `report-queue`, `token-expiring`) |
| `skill` | 숙련도 (선택) | onboarding · novice · intermediate · expert |

`skill`은 선택적 식별 차원이다. spec에 별도 surface가 필요한 경우만 명시한다.
예: `onboarding`은 `/me/onboarding-checklist` 같은 안내형 endpoint를 요구하므로
spec 영향이 있어 식별 차원에 들어가지만, `expert`는 보통 `?fields=...` 같은 쿼리
파라미터 차이로 흡수돼 별 surface를 만들지 않는다.

## reference — 외부 카탈로그

| 차원 | 의미 |
|------|------|
| `regulation` | 법적/정책 제약. 다중 적용 가능. (pii-kr-pipa, pii-gdpr, content-violence, content-gambling, child-protection-coppa, financial-kyc, …) |
| `channel` | 소비 매체. 다중 적용 가능. (browser, mobile-app, public-api, partner-sdk, webhook, csv-export, llm-tool-call, cli) |

reference는 페르소나 식별에 영향을 주지 않는다. 다만 reference 값이 다르면서 **shape나
access도 다르다면** 별 페르소나로 분리한다. 채널 폭발을 막기 위한 휴리스틱.

## outcome — 계약 obligation

| 차원 | 의미 |
|------|------|
| `shape` | 응답/요청 형태. detail · list-paginated · list-faceted · stream-sse · stream-ndjson · bulk-batch · command · token |
| `access` | 권한·감사·프라이버시 의무. 다중. public · private-self · scoped:read · scoped:write · scoped:admin · audited · pseudonymized · rate-limited · idempotent |
| `maps_to` | 이 페르소나를 실현하는 operationId 목록 (다대다 가능) |
| `expects` | 받게 되는 HTTP status code 목록. operation의 `responses` 키와 교차검증. negative-path는 별 페르소나로 분리 |

## persona row 상태

매트릭스가 wishlist로 오염되지 않도록 status 필수.

| status | 의미 | maps_to 검증 |
|--------|------|-------------|
| `implemented` | spec에 실재하는 surface | 모든 operationId가 .merged.yaml에 존재해야 함 |
| `proposed` | 미래 surface — 다음 spec 작업 backlog | 비어있어도 OK |
| `deprecated` | 제거 예정 | 정리 작업 등록 |

## 사용 사이클

```
1. 페르소나 추가 (도메인 .personas.yaml에 row)
   └ 새 trait 값이 필요하면 traits/*.yaml에 어휘 등록 (status: proposed로 시작)
2. pnpm --filter @oa-sdk/personas validate
   ├ identity PK 유일성
   ├ vocabulary 매칭
   └ implemented row의 maps_to operationId 실재성
3. gap = (status: proposed && maps_to: [])  →  spec 작업 backlog
4. spec 보강 후 status: implemented 승격
5. (v0.2) operation에 x-persona: [persona-id, ...] 박아 OpenAPI 결합
```

## v0.1 / 향후

| 버전 | 범위 |
|------|------|
| v0.1 | registry + 7 traits + 4 domain matrices (auth/me/users/health) + validator CLI |
| v0.2 | coverage CLI — operation/actor/regulation/channel cross-cut + unjustified surface 검출 + gap backlog |
| v0.3 | `pnpm bind` → `.merged.persona.yaml` 생성 (operation에 `x-persona` 주입). 양방향 drift 검출. `registry.constraints` 강제 (지원 predicate 한정). intent에 `revoke` 추가 |
| v0.4-prep | `outcome.expects` (HTTP status code) 추가 + range/`default` 매칭. coverage에 "Response status coverage" + orphan 검출. negative-path 페르소나 패턴 데이터로 입증 (guest 401, non-admin 403). `pnpm check` 한 방 워크플로 + load.ts I/O 테스트 |
| v0.4 | `resolver` (persona+op → status/body/schema) + `createPersonaMockClient` (`act`/`personasFor`/`applyTo`/`switchTo`). `apps/playground/tests/persona-roleplay.test.ts`에서 같은 endpoint가 페르소나에 따라 200/401/403으로 분기되는 e2e 입증 |
| v0.5 | `pnpm gen:tests` → vitest 매트릭스 자동 생성. 10 negative-path 페르소나 추가. 새 페르소나 1행 = 새 테스트 1줄 |
| v0.5.5 | 11 proposed 페르소나 spec 구현 + 11개 신규 endpoint(forgot-password / reset-password / onboarding / DELETE /me / role-changes / export / public-profile / reports / moderation / readiness / version). implemented 26 → 37, ops 14 → 25 |
| v0.6 | `pnpm propose` — orphan response → 페르소나 stub 자동. status code 휴리스틱 (401→guest, 503→system, 404→phantom-id 등) |
| v0.6.5 | propose 결과 → 41 stub 검토·승격. PK 충돌 4건 자동 검출 후 trigger/data 차원 차별화. 78 implemented (16 → 78) |
| v0.7 | trigger 어휘 카탈로그 (`traits/trigger.yaml`, 38 값 × 4 카테고리). `acknowledged_orphans` 마커 — propose idempotent. README에 contract-simulation 한계 명시 |
| v0.8 | API consumer perspective 차원 (`identity.consumer`, 4 cat × 7 값). 같은 op가 stakeholder 별 다른 페르소나로 분기. `data-models/` 분리 — 엔티티 invariants(PII/audit/retention) 데이터-모델링 페르소나로 별도 표현. 7 신규 페르소나 (84 personas). |
| **v0.9 (현재)** | persona dependency graph — qa-sdk/definition-catalog `LinkType` 어휘 차용 (depends_on / refines / supersedes). 검증 룰 #9 (link integrity + cycle detection). `pnpm flow` markdown + mermaid 출력. 8 페르소나에 link 주석 (5 depends_on + 3 refines). |
| v0.6+ | 도메인 data dictionary (예: `data_kind: pii`) → `pii-bulk-requires-regulation` 등 보류 constraint 활성화 |

## 참조

- [Vision](../vision.md) — 전체 도메인 철학
- [Behavior ECS](./behavior-ecs.md) — 행동 좌표 (페르소나는 행동의 *주체* 차원에 해당)
- 패키지: [`@oa-sdk/personas`](../../packages/personas/README.md)
