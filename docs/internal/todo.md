# Todo — 이행 대기 태스크

최종 정리: 2026-11-16

현재 기능 결함의 상태와 종료 조건은 [검증 원장 현황](./verification/status.md)의 결함 표를 따른다.
날짜별 리뷰의 발견 설명을 읽고, 진행 상태를 바꿀 때는 [registry.json](./verification/registry.json)을 갱신한다. 이 TODO에 같은 결함 상태를 중복 관리하지 않는다.

> 완료된 구현은 [spec.md](./spec.md), API 상세는 [api-index.md](./api-index.md)를 참조.
> 현재 Core Platform 우선순위는 [plan.md](./plan.md), artifact release 판단은
> [release-readiness.md](./release-readiness.md)를 따른다.
> 완료 항목과 종료된 backlog 기록은 [todo-archive.md](./todo-archive.md)에 있다. 이 문서에는
> 열린 작업과 결정 대기 backlog만 둔다.

---

## 열린 작업

승인되어 진행할 수 있는 작업이다. 완료하면 항목을 [todo-archive.md](./todo-archive.md)로 옮긴다.

### [ ] 외부 문서 상호운용 및 자동완성 메타데이터 정합성

계획: [external-document-interop-autocomplete.plan.md](./external-document-interop-autocomplete.plan.md)

현재 `tools-table-file-io`는 로컬·자체 생성 fixture와 CSV·XLSX 회귀만 검증하며, 실제
Office, LibreOffice, Google Sheets, Notion 산출물의 상호운용은 검증 원장의
`external-document-interop` 항목에서 미검증이다.

작업:
1. 실제 제품이 생성한 XLSX·CSV를 read → patch → write → reopen하고 OOXML 관계, 병합,
   검증, 스타일, 수식, 인코딩, 줄바꿈 보존을 확인한다.
2. 지원 형식·필드·메타데이터와 공개 export 및 자동완성/API 정보를
   `api-index`, `library-entrypoints`, `feature-test-matrix`, package declaration/README에
   함께 갱신한다.
3. 제품별 fixture와 외부 실행 evidence를 검증 원장에 등록한다.

완료 기준: 실제 제품 조합별 external-e2e 검증 통과, 자동완성/API index gate 통과,
`external-document-interop` claim의 verified 승격.

---

## 리포트 피드백 backlog (결정 대기)

[`docs/reports/`](../reports/)의 리포트에 남은 피드백을 모은 표다. **승인된 작업이 아니다.**
착수하려면 먼저 채택 여부를 결정하고, 채택한 항목만 위 "열린 작업"으로 옮긴다.
"현재 상태"는 2026-11-16에 코드와 문서를 대조한 결과다.

| 출처 리포트 | 항목 | 현재 상태 | 착수 조건 |
| --- | --- | --- | --- |
| [기능 리뷰 2026-10-26](../reports/feature-review-2026-10-26.md) | domain 쓰기 뒤 snapshot I/O가 실패할 때의 rollback | 검증 원장에서 보장 제외 범위(`commit-snapshot-serialization`의 domain rollback) | rollback을 보장 범위에 넣을지 결정하고, 넣으면 원장에 claim을 추가 |
| [기능 리뷰 2026-10-26](../reports/feature-review-2026-10-26.md) | 프로세스 중단 뒤 lock 복구 | 검증 원장에서 보장 제외 범위 | 복구 정책(stale lock 판정 기준)을 결정 |
| [기능 리뷰 2026-10-26](../reports/feature-review-2026-10-26.md) | 검증 원장의 미평가 기능 | 기능 71개 중 65개가 미평가. 미평가는 미구현이나 테스트 부재를 뜻하지 않는다 | 다음에 보장 항목을 검토할 기능과 순서를 결정 |
| [TypeSpec 빌더 사용성 리포트](../reports/typespec-builder-usability-report.md) §5.1-1 | Vite 플러그인 세분화 HMR | 미착수. `packages/codegen/src/plugin/vite.ts`는 `full-reload`를 보낸다 | 채택 결정과 대상 프레임워크 범위 |
| [TypeSpec 빌더 사용성 리포트](../reports/typespec-builder-usability-report.md) §5.1-2 | TanStack mutation optimistic update 스캐폴딩 | 미착수. `packages/*/src`에 구현 없음 | 채택 결정과 생성 템플릿의 rollback 계약 |
| [TypeSpec 빌더 사용성 리포트](../reports/typespec-builder-usability-report.md) §5.2-1 | builder `pluginStream` | 미착수. `@oa-sdk/client`의 SSE/NDJSON 생성은 별개 경로로 이미 있다 | 기존 client 스트리밍 생성과의 역할 구분 결정 |
| [TypeSpec 빌더 사용성 리포트](../reports/typespec-builder-usability-report.md) §5.2-2 | Wasm 기반 컴파일 가속 | 연구 제안, 착수 흔적 없음 | 콜드 컴파일 시간이 실제 병목이라는 측정 |
| [TypeSpec 빌더 사용성 리포트](../reports/typespec-builder-usability-report.md) §5.2-3 | webhook builder 플러그인 | 미착수. router/client/mock-server의 webhook 스텁은 이미 있다 | 기존 webhook 스텁과의 역할 구분 결정 |
| [`generate --incremental` 실측](../reports/generate-incremental-20261030.md) | TypeSpec 입력의 target 재사용 | 전체 재생성 fallback | compiler/module-graph observation을 target record에 연결하는 설계 |
| [`generate --incremental` 실측](../reports/generate-incremental-20261030.md) | guards가 켜진 target, companion output 실패·누락 run의 재사용 | 재사용 bundle을 기록하지 않음 | 부분 산출물을 재사용해도 안전한 조건의 정의 |
| [Pydantic codegen 검토](../reports/typespec-pydantic-codegen-review.md) §8 | scalar alias의 description/title/examples를 필드 사용처에 복원 | Open. parity 비교가 이 차이를 정규화한다 | generator 출력 변경(golden 갱신)을 받아들일지 결정 |
| [Pydantic codegen 검토](../reports/typespec-pydantic-codegen-review.md) | FastAPI router stub(P2c), `ContractRegistry` adapter(P2d), manifest/provenance 산출물 | 2026-11-09에 범위 제외로 확정([Phase 2 문서](./architecture/pydantic-codegen-phase2.md)) | 범위 재개 결정 |

Pydantic 생성기의 그 밖의 제한(OAS `in: querystring` parameter 미지원, discriminator 없는
`oneOf`의 exact 판정 등)은 [Pydantic codegen 가이드](../guides/pydantic-codegen.md)의 알려진
제한이 정본이므로 여기에 복제하지 않는다.

---

## Owner-gated backlog

외부 owner 또는 별도 결정이 있어야 움직이는 항목이다. 근거와 2026-10-23 검토 기록은
[todo-archive.md 부록 A](./todo-archive.md#부록-a-backlog-handoff--cross-repo-projection--dpm-runtime-2026-10-23)에 있다.

- **cross-repo projection 회귀는 CI가 잡지 않는다.** `.github/workflows/ci.yml`은
  `submodules: false`로 checkout한다. `references/bun-graph-db`의 projection 검증은
  `pnpm check:cross-repo-projection` 수동 gate다. 자동화하려면 CI에서 submodule을 받을지 먼저 결정한다.
- **contract release 경계.** bun-graph-db는 `@oa-sdk/openapi-projection-contract`를 workspace
  file dependency로 쓴다. contract type/validator를 바꾸면 같은 트리에서는 즉시 영향을 받고,
  배포 소비자는 새 contract release가 필요하다. 이 release는 일반 patch release와 별도로 조정한다.
- **DPM Phase 10 production data-plane은 no-op이다.** 신규 DPM 기능·배포는 외부
  [data-governance](https://github.com/mineclover/data-governance)가 소유한다. runtime owner
  decision 전까지 `packages/dpm`에 persisted schema, gateway workflow, search/edit workflow를
  추가하지 않는다. 새 feature 착수에는 [Platform Scope](./platform-scope.md)의
  scope-reactivation decision이 필요하다. 상시·공유 검색은
  [TODO-SHARED-SEARCH](https://github.com/mineclover/data-governance/blob/main/docs/internal/goals/shared-search-todo.md)로 보류했다.
- **public artifact release.** 후보를 실제로 내보낼 때 package version, Changeset, release note와
  external artifact repository review를 함께 확정한다([release-readiness.md](./release-readiness.md)).

---

## 참고

- 증분 설계: [ADR-006 — SQLite 기반 증분 Workspace Index](./architecture/006-incremental-workspace-index.md)
- DPM runtime/storage의 기존 설계: [Data Pseudonymization Manifest](../../tasks/prd-data-pseudonymization-manifest.md),
  [Goal 5](./goals/goal-5-dpm-runtime-storage-integration.md). 다음 구현 착수를 지시하지 않는다.
- 외부 연동 PRD(완료): [MCP OpenAPI Projection Tools](../../tasks/prd-mcp-openapi-projection-tools.md)
