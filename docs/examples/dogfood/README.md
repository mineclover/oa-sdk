# Dogfood — oa-sdk 자체 페르소나 빌딩

> **Status (v0.13):** 이 dogfood 실험이 v0.13 surface kind dimension의 동기가 됐고, 정식 매트릭스로 promote됨. 캐노니컬 정의는 [`packages/personas/src/domains/personas-cli.personas.yaml`](../../../packages/personas/src/domains/personas-cli.personas.yaml) — `metadata.kind: cli-tool`. 이 README는 *journey 기록*으로 남겨둠.

> "프레임워크를 자기 자신에 적용한 example." 페르소나 모델이 OpenAPI 컨슈머가 아닌 *CLI/library 컨슈머*에도 적용 가능한지 검증.

## 의도

`@oa-sdk/personas`는 OpenAPI 위에서 동작하지만, 페르소나 컨셉 자체는 **(주체-데이터 관계)** — HTTP 같은 매체에 의존하지 않음. 이 dogfood example은 oa-sdk의 *CLI 자체*를 페르소나로 모델링해서:

1. 모델이 non-API 컨텍스트에서도 의미가 있는지 검증
2. 어떤 어휘 확장 (L1) 이 필요한지 학습
3. 향후 multi-project 지원 (C-level extension)에 필요한 패턴 발견

## 적용 대상 — `@oa-sdk/personas` 11 CLI

대상을 `@oa-sdk/personas` 자체로 한정 (가장 friction 작은 시작점).

| CLI | 의미 |
|-----|------|
| `pnpm wizard` | baseline 1회 부트스트랩 (interactive) |
| `pnpm validate` | 22 룰 검증 |
| `pnpm coverage` | 12-section markdown 리포트 |
| `pnpm bind` | spec에 x-persona 주입 |
| `pnpm propose` | orphan stub 자동 |
| `pnpm propose --from-spec` | 전체 spec scan (3 signal) |
| `pnpm gen:tests` | vitest 매트릭스 자동 |
| `pnpm flow` | 의존성 그래프 (mermaid) |
| `pnpm profiles list/show` | saved query 조회 |
| `pnpm check` | merge → bind → validate 한 방 |
| `pnpm test` | 130 unit tests |

## 어휘 확장 (L1) 발견

dogfood 적용 중 새로 필요한 어휘:

| 차원 | 신규 값 | 이유 |
|------|---------|------|
| `actor` | `framework-developer` | oa-sdk 자체를 개발하는 사람 |
| `actor` | `ci-bot` | GitHub Actions / 자동화 agent |
| `actor` | `auditor` | 컴플라이언스 / 리뷰 진행자 |
| `consumer` | `developer-tool` | 개발자 도구로 호출 (vs 운영 시스템) |
| `consumer` | `automation` | CI/CD / scheduled task |
| `trigger` | `pre-commit` | git pre-commit hook |
| `trigger` | `ci-gate` | PR 머지 게이트 |
| `trigger` | `audit-review` | 정기 컴플라이언스 검토 |
| `trigger` | `release-prep` | 릴리스 준비 |
| `trigger` | `design-review` | 설계 회의 |
| `intent` | `inspect` | 변경 없이 조회만 (vs read-detail은 데이터 조회) |
| `intent` | `transform` | 한 형식 → 다른 형식 (bind/gen-tests) |

이 어휘들이 *non-API CLI 컨텍스트에서 자연스럽게 등장* — 미래에 framework가 multi-context를 지원할 때 baseline에 넣을 후보.

## Example 매트릭스

v0.13 promote 후 매트릭스는 [`packages/personas/src/domains/personas-cli.personas.yaml`](../../../packages/personas/src/domains/personas-cli.personas.yaml)로 이동 — `metadata.kind: cli-tool`로 선언, `pnpm validate`에 정식 포함.

핵심 페르소나 5개 미리보기 (실제 promote 후 일부 필드 — `consumer: developer-tool` → `internal-tool`, `shape: cli-output` → `command` — 기존 어휘로 normalize):

```yaml
- id: dev-validates-pre-commit
  identity:
    actor: framework-developer
    data: PersonaMatrix
    intent: validate
    trigger: pre-commit
    consumer: developer-tool
  outcome:
    shape: cli-output         # 신규 shape — exit code + stderr 메시지
    access: [private-self]
  notes: "git pre-commit hook이 pnpm validate 실행. 22 룰 통과 못하면 commit 차단."

- id: ci-bot-checks-pr
  identity:
    actor: ci-bot
    data: PersonaMatrix
    intent: validate
    trigger: ci-gate
    consumer: automation
  outcome:
    shape: cli-output
    access: [audited]
  notes: "PR check가 pnpm check 실행. drift / orphan 등 차단."

- id: auditor-reviews-compliance
  identity:
    actor: auditor
    data: PersonaMatrix
    intent: inspect
    trigger: audit-review
    consumer: developer-tool
  outcome:
    shape: cli-output
    access: [audited]
  notes: "분기 컴플라이언스 검토 — pnpm coverage --profile=pipa-compliance로 PIPA footprint 추출."

- id: dev-bootstraps-baseline
  identity:
    actor: framework-developer
    data: ProjectMeta
    intent: create
    trigger: first-arrival
    consumer: developer-tool
  outcome:
    shape: cli-output
    access: [private-self]
  notes: "신규 프로젝트 도입 시 pnpm wizard 1회 실행. baseline 결정."

- id: dev-iterates-on-spec
  identity:
    actor: framework-developer
    data: PersonaMatrix
    intent: transform
    trigger: design-review
    consumer: developer-tool
  outcome:
    shape: cli-output
    access: [private-self]
  notes: "spec 변경 후 pnpm propose --from-spec 으로 signal-driven stub 검토."
```

## 발견 / 학습

### 무엇이 잘 맞나

- `actor` / `intent` / `trigger` 차원이 CLI 컨텍스트에서도 의미 명확 — 누가 / 왜 / 언제 호출하나
- `consumer` perspective가 effective: developer-tool vs automation 분리가 매우 자연스러움
- `data` 차원이 *artifact*로 mapping됨 — PersonaMatrix / GeneratedTestSuite / BoundSpec / ProjectMeta 등

### 무엇이 어색하나

- `outcome.shape`가 HTTP 중심 어휘 — `cli-output`(exit code + stdout/stderr) 같은 신규 shape 필요
- `outcome.expects`가 HTTP status code — CLI는 exit code (0/1/2) — 의미 비슷하지만 어휘 다름
- `maps_to` operationId — CLI 호출은 `pnpm <command>` 형식; mapping needs synthetic id (`cli:validate`)
- regulation/region/compliance가 거의 무관 (CLI가 PII 다루지 않음)

### 향후 framework 확장 제안

1. **Surface kind 차원** — `kind: openapi-http | cli-tool | library-api | event-stream`. 도메인이 자기 surface 종류 선언. ✅ **v0.13 ship 완료**
2. **kind 별 어휘 자동 활성화** — cli-tool kind면 `shape: cli-output / exit-code` 활성화, regulation/region 비활성화. (TODO — 현재는 어휘 매칭 강제, kind에 따른 활성/비활성 분기 없음)
3. **synthetic operationId 지원** — non-OpenAPI 페르소나의 maps_to를 `cli:<command>` 같은 prefix로 표현, 별 검증 경로. ✅ v0.13 — bind/drift/maps_to-existence 룰이 cli-tool 도메인을 skip
4. **multi-project 패턴** — oa-sdk의 별 패키지마다 자체 페르소나 매트릭스 보유, baseline 공유.

## 참조

- [Data Persona 컨셉](../../concepts/data-persona.md)
- [@oa-sdk/personas README](../../../packages/personas/README.md)
- 캐노니컬 매트릭스: [`personas-cli.personas.yaml`](../../../packages/personas/src/domains/personas-cli.personas.yaml)
