# [oa-sdk (TypeSpec · OpenAPI 3.2 Contract SSOT & Functional Intent Alignment)] 파이프라인 증명 구현 및 산출물 요청서 (PROOF-REQUEST)

> **문서 목적**: 이 문서는 포트폴리오 통합 증명 허브(`/Users/junwoobang/workflow/zeta`)에서 각 축의 패키지가 **최상위 추구하는 바(North Star)**를 어떻게 실증하는지 시각적 캡처와 동작하는 레퍼런스로 수집하기 위한 표준 구현·산출물 요청서입니다.

---

## 1. 최상위 추구하는 바 (North Star) & 이 패키지의 위치

- **최상위 추구하는 바 (North Star)**:
  > **"파편화된 도메인 문제를 구조화·정량화하고, '데이터 흐름 은닉 + 최종 의도 시각화 + 중간 관리 포인트'를 통해 사람과 AI가 신뢰도를 유지하며 문제를 끝까지 해결하는 엔드투엔드 파이프라인 구축"**
- **소속 축 및 역할 계층**: **[3단계 · 보편 하네스 축 2-① 스펙 관리: 계약 스펙] 기능 의도 단위의 프론트엔드(FE API)–백엔드(BE API) 정렬**
- **대상 로컬 경로**: `/Users/junwoobang/workflow/oa-sdk`

### 이 패키지가 증명해야 할 3대 핵심 구조 (`데이터 흐름 은닉 + 최종 의도 시각화 + 중간 관리 포인트`)

| 구분 | 이 패키지(`oa-sdk`)에서의 정의 |
|---|---|
| **① 은닉하는 내부 데이터 흐름 (Hidden Data Flow)** | TypeSpec(`.tsp`) 인메모리 컴파일, `@oa-sdk/parser` 단일 AST 해석, 클라이언트·TanStack Query 옵션·백엔드 핸들러 계약(`*.contract.ts`)·라우터(`@oa-sdk/router`)·Mock 서버 코드 자동 생성 |
| **② 사람이 개입·편집하는 중간 관리 포인트 (Intermediate Control Point)** | **사람이 직접 읽고 편집하는 단일 정본인 TypeSpec(`.tsp`) / OpenAPI 3.2 기능 의도 계약 파일 (`evaluateFractionSceneSubmission` 입력·출력·오류 경계 정의)** |
| **③ 시각화하는 최종 의사결정 의도 (Visualized Decision Intent)** | **프론트엔드 기능 컴포넌트(FE API)와 백엔드 엔드포인트(BE API)의 기능 의도 1:1 정렬 매트릭스 및 `oa-gen diff` / `tsp diff --fail-on-breaking` 드리프트·파괴적 변경 0건 검증 리포트** |

---

## 2. 공통 시드 시나리오 (`SEED-SCENARIO-01`) 연동 규격

모든 13개 패키지는 개별 특화 기능 증명과 함께, 전체 파이프라인이 처음부터 끝까지 하나로 맞물려 돌아간다는 것을 보여주기 위해 아래 **공통 시드 시나리오 식별자**를 입출력 샘플(`input-sample.json` / `output-artifact.json`) 및 캡처 데이터에 포함해야 합니다.

- **시나리오 제목**: 인터랙티브 교육 씬(scene_fraction_quiz_01)의 기획 · 인물 연출 · PSD 변환 · 인터랙션 · 검수 · AI 스펙/운영 거버넌스 · Google Drive 공급
- **공통 식별자 (Shared Identifiers)**:
  - `sceneId`: `"scene_fraction_quiz_01"`
  - `storyboardPageId`: `"page_math_grade4_unit2_01"`
  - `elements`:
    - `"el_character_tutor_01"`: 튜터 캐릭터 (Pose Lab 정면 `BODY_25` 포즈 & Stage 배치 대상)
    - `"el_fraction_board_01"`: 피자 조각 분수 조작 칠판 (PSD `Graphic IR` & `2T-SSG HTML` `/* @editable */` 대상)
    - `"el_submit_cta_01"`: 정답 제출 및 XState/FSM 분기 트리거 (검수 사이트 자동 의도 스캔 대상)
  - `contractOperationId`: `"evaluateFractionSceneSubmission"`
  - `glossaryConceptUri`: `"urn:semantic:concept:InteractiveSceneSubmission"`
  - `oslcResourceUri`: `"urn:oslc:resource:scene_fraction_quiz_01@rev-3"`
  - `promptTemplateId`: `"crpt_scene_inspection_feedback_v1"`
  - `skillPresetId`: `"preset_scene_domain_authoring_v1"`
  - `driveArtifactId`: `"NES-000142"`

---

## 3. 필수 제출 산출물 규격 (`proof-output/` 디렉터리)

이 레포지토리 루트의 `proof-output/` 폴더 아래에 다음 **3종 산출물 + 매니페스트**를 생성해 주세요.

```text
/Users/junwoobang/workflow/oa-sdk/proof-output/
├── proof-manifest.json              # zeta 자동 수집기가 읽어가는 메타데이터 (status를 "completed"로 갱신)
├── captures/
│   ├── 01-control-point.png         # [필수 캡처 1] 사람이 편집·개입하는 '중간 관리 포인트' 화면 (1600x1000 권장)
│   └── 02-decision-intent.png       # [필수 캡처 2] 내부 흐름을 숨긴 '최종 의사결정 의도 시각화' 화면 (1600x1000 권장)
└── reference/
    ├── reference-demo.html          # [필수 동작 레퍼런스] 외부 서버 없이 단독 실행·조작 가능한 인터랙티브 HTML
    ├── input-sample.json            # SEED-SCENARIO-01 입력 계약 데이터 샘플
    ├── output-artifact.json         # SEED-SCENARIO-01 처리 완료 산출물 샘플
    └── verification-log.txt         # 실제 테스트·검증 명령어(pnpm -r test) 통과 로그 스냅샷
```

### 3.1 화면 캡처 2종 상세 요구사항 (`proof-output/captures/`)

1. **`captures/01-control-point.png` — [중간 관리 포인트] TypeSpec (.tsp) 단일 계약 정본 & FE 기능 컴포넌트–BE 핸들러 계약 매핑 뷰**
   - **촬영 대상 및 내용**: `scene_fraction_quiz_01`의 제출 평가 기능(`evaluateFractionSceneSubmission`)을 정의한 `.tsp` 계약 원본과, 이로부터 생성된 프론트엔드 컴포넌트 Props/Query 계약 및 백엔드 `*.contract.ts` 시그니처가 나란히 정렬된 화면
   - **시각적 포인트**: 사람이 어느 지점(중간 관리 포인트)에서 데이터를 확인하고 편집·통제할 수 있는지 명확히 드러나야 합니다.
2. **`captures/02-decision-intent.png` — [최종 의사결정 의도 시각화] FE–BE 기능 의도 정렬 상태 & Breaking Change / Runtime Drift 0건 검증 대시보드**
   - **촬영 대상 및 내용**: 내부 파서·코드 생성 파이프라인은 숨기고, 기능 의도 단위로 묶인 FE 컴포넌트–BE API의 계약 일치율(100%), Breaking Change 유무, 33개 패키지 검증 통과 상태만 시각화한 의사결정 화면
   - **시각적 포인트**: 복잡한 내부 파이프라인(파서·DB·동기화 큐)은 숨기고, 의사결정자나 실무자가 즉시 판단할 수 있는 **최종 의도와 검증 상태**만 깔끔하게 시각화되어야 합니다.

### 3.2 동작하는 레퍼런스 번들 상세 요구사항 (`proof-output/reference/`)

- **`reference/reference-demo.html`**:
  - `reference-demo.html`에서 `.tsp` 계약 필드(예: `submittedNumerator`, `inspectionScanId`)를 수정·토글해 보면 FE 컴포넌트 API와 BE 라우터 계약의 정렬 상태 및 Breaking Change 경고가 즉시 시각화되는 인터랙티브 레퍼런스 구현
  - 외부 CDN이나 로컬 백엔드 서버가 꺼져 있어도 브라우저에서 바로 열려 동작하도록 **단일 Self-contained HTML(인라인 CSS/JS 및 실제 시드 데이터 내장)**로 구성합니다.
- **`reference/input-sample.json` & `reference/output-artifact.json`**:
  - **입력(`input-sample.json`)**: `evaluateFractionSceneSubmission` 기능을 정의한 TypeSpec(`.tsp`) 모델 및 OpenAPI 3.2 스펙(`input-sample.json`)
  - **출력(`output-artifact.json`)**: 생성된 FE Query 계약 + BE Handler Contract(`*.contract.ts`) + `oa-gen diff` 무결성 리포트(`output-artifact.json`)
- **`reference/verification-log.txt`**:
  - `pnpm -r test` 등 실제 테스트·검증 실행 결과 요약 로그를 기록합니다.

---

## 4. 완료 후 통합 쇼케이스 반영 방법

산출물 생성이 끝나면 `proof-output/proof-manifest.json`의 `"status"` 필드를 `"completed"`로 변경한 뒤, `/Users/junwoobang/workflow/zeta`에서 아래 명령어를 실행하면 공개 쇼케이스(`packages/public-showcase`)와 `PIPELINE-PROOF.md`에 자동 수집·렌더링됩니다.

```bash
cd /Users/junwoobang/workflow/zeta && npm run build:showcase
```
