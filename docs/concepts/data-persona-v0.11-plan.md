# v0.11 — Persona Skills + Profiles 도입 계획

> 페르소나가 "RPG 캐릭터처럼" 보유한 *능력 (skills)* 을 명시적 첫-등급 차원으로 도입하고, 자주 쓰는 페르소나 query를 *프로필*로 저장한다.

상위 컨셉: [data-persona.md](./data-persona.md)

## 동기

현 모델에서 페르소나의 *행동 옵션*은 흩어져 있음:
- `intent`는 한 행위 (PK 단일)
- `outcome.access`는 보안 의무 (audited / rate-limited / scoped)
- `outcome.shape`는 응답 형태 (list-paginated / stream-sse)

빠진 것: **페르소나가 *고유하게 보유하는* 기능 능력**. 예를 들어:
- "admin-monitor는 pagination + filter-by-role + pii-visible-admin 능력 보유"
- "b2b-customer-list-users는 pagination + oauth-scope-aware + pii-masked-default + rate-limit-honored 능력 보유"

같은 endpoint를 호출해도 페르소나마다 *능력 set이 다름*. 이걸 명시할 차원이 필요.

## 4 단계 (Phase)

### Phase 1 — 계획 문서 (이 문서)

- 컨셉 합의 + 마이그레이션 계획 명시
- commit: `docs(personas): v0.11 plan — skills + profiles design`

### Phase 2 — `identity.skill` → `identity.proficiency` rename

이유: 새 `skills`(capability)와 의미 충돌. 기존 `skill`은 *사용자 숙련도*(onboarding/novice/intermediate/expert)니까 `proficiency`가 더 정확.

영향:
- `traits/skill.yaml` → `traits/proficiency.yaml` (이름만)
- `registry.yaml` — identity.skill → identity.proficiency
- `types.ts` — `PersonaIdentity.skill` → `PersonaIdentity.proficiency`
- 기존 페르소나 1건 (`onboarding-checklist`) field 갱신
- `validate.ts` identityKey 함수 갱신
- tests / docs 갱신

검증: 전체 e2e + unit 그린 유지.
commit: `refactor(personas): rename identity.skill → identity.proficiency`

### Phase 3 — `Persona.skills` 도입 (capability tags)

새 top-level 필드 `Persona.skills: string[]` — 페르소나가 보유한 *능력 태그*.

신규 파일: `traits/skill.yaml` — 6 카테고리 × ~25 값:

| 카테고리 | 의미 | 값 |
|---------|------|-----|
| `request-shape` | 요청 측 능력 | pagination / filter-by-role / filter-by-status / full-text-search / batch |
| `response-shape` | 응답 측 능력 | sse-stream / etag-supported / partial-response |
| `lifecycle` | 호출 lifecycle | idempotent / retryable / cacheable |
| `observability` | 관측 | audit-emission / metrics-emission / trace-context |
| `security` | 보안 | pii-visible-admin / pii-masked-default / pseudonymized / signed-response / mtls |
| `integration` | 통합 | webhook-source / webhook-target / oauth-scope-aware / rate-limit-honored |

스키마:
```yaml
- id: admin-monitor
  identity: ...
  skills:                                  # NEW (top-level, optional)
    - pagination
    - filter-by-role
    - audit-emission
    - pii-visible-admin
```

검증 룰 추가 (#15):
- skills 값이 `traits/skill.yaml`에 존재해야 함

매트릭스 분류 (~30 페르소나):
- admin/internal-tool 페르소나: pagination + audit-emission + pii-visible-admin
- b2b-customer 페르소나: pagination + oauth-scope-aware + rate-limit-honored + pii-masked-default
- data-eng 페르소나: batch + idempotent + pseudonymized + audit-emission
- 인증/auth 페르소나: retryable + audit-emission
- negative-path / system 페르소나: 대부분 skills 비어있음 (의미 없음)

coverage 신규 cross-section:
```
## Skill cross-section
| skill              | personas | category       |
| pagination         | 8        | request-shape  |
| audit-emission     | 17       | observability  |
| pii-masked-default | 4        | security       |
…
```

commit: `feat(personas): persona skills (capability tags) — v0.11 P3`

### Phase 4 — access ↔ skills 일관성 룰

페르소나 의무(access)와 능력(skills)이 짝이 맞는지 검증. 

신규 constraints (registry.yaml):
- `audited-access-requires-audit-emission` — `access: [audited]`이면 `skills: [audit-emission]` 필수
- `rate-limited-access-requires-rate-limit-honored` — `access: [rate-limited]`이면 `skills: [rate-limit-honored]` 필수
- `pseudonymized-access-requires-skill` — `access: [pseudonymized]`이면 `skills: [pseudonymized]` 필수

severity: warn (의무는 있는데 능력 명시 안 함 = lying이지만 즉각 차단보단 경고).

이건 v0.4에서 도입한 constraint engine 재활용 — 이미 인프라 있음.

commit: `feat(personas): access ↔ skills consistency rules — v0.11 P4`

### Phase 5 (= v0.11.5) — Profiles

페르소나의 query 결과를 yaml로 저장. v0.11 결과를 보고 fine-tune.

**Profile 스키마**:
```yaml
# profiles/mobile-app.profile.yaml
id: mobile-app
description: "모바일 앱 직접 호출 surface"
selector:
  status: [implemented]
  channel: [mobile-app]
  skills: [pagination]               # skill 기반 필터 가능
exclude:
  - guest-unauthorized-getMe         # UX 영향 없음
```

**5 sample profiles**:
1. `mobile-app` — channel: mobile-app
2. `b2b-customer-suite` — consumer: b2b-customer
3. `pipa-compliance` — regulation: pii-kr-pipa
4. `audit-required` — skill: audit-emission
5. `infra-ops-monitoring` — consumer: infra-ops

**구현**:
- `src/profile.ts` — 모듈 (load / expand / validate)
- `src/profiles/{name}.profile.yaml` — 5개 파일
- `scripts/profile.ts` — CLI: `pnpm profile list / show <id>`
- 기존 CLI flag 추가:
  - `pnpm coverage --profile=<id>` — profile-scoped 분석
  - `pnpm gen:tests --profile=<id>` — profile-scoped 생성

**검증 룰 추가** (#16-18):
- profile id 유일
- selector 어휘 매칭
- `personas` array의 id 실재성

commit: `feat(personas): persona profiles — v0.11.5`

## 마이그레이션 안전성

| 단계 | breaking? | rollback |
|------|----------|---------|
| P2 (rename) | breaking — `identity.skill`을 사용한 코드 업데이트 필요 | 1 페르소나만 영향. revert 단순 |
| P3 (skills 추가) | additive — 미설정 페르소나는 영향 없음 | 단순 |
| P4 (consistency) | warning만 — 강제 안 함 | 단순 |
| P5 (profiles) | additive | 단순 |

## 마무리 후 상태

| 지표 | v0.10.5 → v0.11.5 |
|------|---------------|
| trait files | 11 → 12 (skill 별 의미로 신설) |
| identity dimensions | 6 → 6 (rename만) |
| top-level Persona fields | 5 → 6 (skills 추가) |
| validation rules | 11 → 14+ |
| coverage cross-sections | 7 → 8 (skill 추가) |
| CLI commands | 6 → 7 (profile 추가) |
| sample profiles | 0 → 5 |

## 후속 (v0.12+)

- registry.d/ — 외부 프로젝트 어휘 overlay
- scenarios/ — Given/When/Then narrative 자동 생성
- compliance-maps/ — regulation → profile 자동
