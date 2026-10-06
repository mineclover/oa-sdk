# 4-Tier E2E 테스트 및 검증 인프라

이 문서는 `@oa-sdk` 모노레포의 엔드투엔드(E2E) 테스트 인프라와 4-Tier 검증 모델, 그리고 Tier 5 적대적 스트레스 및 하드닝(Adversarial Hardening) 체계를 규정한다.

---

## 1. 테스트 아키텍처 및 철학

`@oa-sdk`의 E2E 테스트 인프라는 내부 구현 세부사항에 결합되지 않고 명세 요구사항만을 검증하는 **오파크 박스(Opaque-Box), 요구사항 주도 4-Tier 검증 모델**을 기반으로 구축되었다.

이 검증 체계는 모노레포 전반에 걸쳐 다음 4대 영역을 보증한다:
1. **계층적 상향 프로젝트 루트 탐색**: `findProjectRoot()`, `--root`, `--project-root` CLI 플래그
2. **선언적 사양 및 가드 거버넌스**: `defineConfig()`, `loadOaConfig()`, `oa.config.ts`
3. **결정론적 버전 해싱 및 스펙 드리프트 거버넌스**: `x-schema-engine-version-hash`, `oa-gen drift:check`, `oa-gen diff --fail-on-breaking`
4. **다운스트림 컨슈머 통합 및 하위 디렉토리 실행 복원력**: `browser-studio`, 5개 도메인 프로파일, 29개 독립형 가드, 중첩 서브모듈 경계 횡단

---

## 2. 핵심 테스트 불변식 (Core Testing Invariants)

모든 E2E 및 하드닝 테스트 스위트는 아래 4대 불변식을 엄격히 준수한다.

### 2.1 오파크 박스 평가 (Opaque-Box Evaluation)
- CLI 엔진(`oa-gen`)과 공개 API(`@oa-sdk/core`, `@oa-sdk/codegen`)를 완전한 외부 블랙박스로 취급한다.
- CLI 명령은 모듈 내부 함수를 직접 호출하지 않고, 실제 운영 환경과 동일하게 표준 자식 프로세스(`runOaCli(args, options)` via `child_process.spawnSync`)로 실행된다.
- 테스트 오라클은 프로세스 종료 상태 코드(`status: number | null`), 표준 출력(`stdout`), 표준 에러(`stderr`), 그리고 디스크에 기록된 산출물 파일 구조만을 검증하며, 내부 비공개 메모리 상태에 접근하거나 조작하지 않는다.

### 2.2 서브모듈 횡단 불변식 (Submodule Traversal Invariant)
- Git 서브모듈이나 중첩 워크스페이스 패키지(예: `browser-studio` 내의 `packages/browser-mapper`) 내부에서 CLI를 실행할 경우, 상위 조상 디렉토리에 존재하는 `oa.config.ts`(우선순위 규칙 3)가 서브모듈 경계 마커(`.git`, `pnpm-workspace.yaml`, 우선순위 규칙 4~5)보다 우선한다.
- 이를 통해 서브모듈의 깊은 하위 디렉토리에서 작업하는 개발자가 루트 저장소의 거버넌스 설정에 자동으로 바인딩되어 일관된 스펙 검증을 수행할 수 있다.

### 2.3 결정론적 격리 픽스처 (Deterministic & Isolated Fixtures)
- 모든 테스트는 독립된 임시 파일시스템 픽스처(`createWorkspaceFixture` via `fs.mkdtemp(path.join(os.tmpdir(), 'oa-test-'))`) 내부에서 수행된다.
- 각 픽스처는 격리된 모노레포 구조, 가상 서브모듈, `.git` HEAD 마커, 다양한 설정 포맷(`.ts`, `.mjs`, `.json`, `.oarc.json`)을 자체적으로 구성한다.
- 프로세스 환경 변수(`OA_PROJECT_ROOT`, `NODE_ENV` 등)는 테스트 실행 후 `afterEach` 훅을 통해 원래 상태로 안전하게 복원되어 테스트 간 오염을 원천 차단한다.

### 2.4 권위 있는 사양 유도 (Authoritative Derivation)
- 모든 테스트 기대값(상태 코드, 터미널 진단 메시지, SHA-256 해시값, 생성 파일 경로, 에러 메시지)은 제품 코드의 동작을 역으로 모방하지 않고, 상위 명세서(`ORIGINAL_REQUEST.md`, `PROJECT.md`)에 명시된 요구사항으로부터 연역적으로 도출된다.

---

## 3. 4-Tier (+ Tier 5) 테스트 매트릭스 및 커버리지 임계값

테스트 인프라는 16개 핵심 기능(F01~F16)을 대상으로 기초 단위 기능부터 실환경 워크로드 및 적대적 공격 시나리오까지 단계별로 검증 범위를 확장한다.

| 검증 단계 (Tier) | 집중 영역 | 요구사항 범위 및 불변식 | 테스트 수 | 구현 파일 경로 |
|---|---|---|:---:|---|
| **Tier 1** | **기능 커버리지 (Feature Coverage)** | 16개 핵심 기능(F01~F16)의 격리된 정상 경로(Happy Path) 검증 (기능당 5개 테스트) | **80개** | `packages/codegen/src/__tests__/e2e/tier1-feature-coverage.test.ts` |
| **Tier 2** | **경계 및 코너 케이스 (Boundary Cases)** | 극단적 입력, 설정 충돌, 경로 역참조, 유니코드, 0바이트 파일, 순환 참조 (기능당 5개 테스트) | **80개** | `packages/codegen/src/__tests__/e2e/tier2-boundary-cases.test.ts` |
| **Tier 3** | **기능 간 상호작용 (Interactions)** | 다단계 파이프라인 (루트 탐색 -> 설정 로드 -> 다중 프로파일 생성 -> 스펙 드리프트 검사 -> CSP 감사) | **16개** | `packages/codegen/src/__tests__/e2e/tier3-interactions.test.ts` |
| **Tier 4** | **실환경 워크로드 (Real-World)** | `browser-studio` 5개 도메인 프로파일, 29개 가드, 중첩 서브모듈, 무캐시 클린 빌드 | **8개** | `packages/codegen/src/__tests__/e2e/tier4-real-world.test.ts` |
| **Subdirectory** | **하위 경로 실행 적합성 (Conformance)** | 6단계 디렉토리 중첩 깊이에서 CLI 루트 탐색 및 상대 경로 정규화 검증 | **18개** | `packages/codegen/src/__tests__/e2e/subdirectory-conformance.test.ts` |
| **Tier 5** | **적대적 하드닝 (Adversarial Hardening)** | 심링크 루프, 환경변수 오염, 프로토타입 변조, 순환 스키마, 난독화된 CSP 우회 패턴 방어 | **38개** | `packages/codegen/src/__tests__/challenger-m5-adversarial-stress.test.ts`<br>`packages/codegen/src/__tests__/challenger-m5-adversarial-hardening.test.ts` |
| **합계** | **전체 E2E 검증 스위트** | **16개 기능 전체 커버리지 + 하위 호환성 + 챌린저 보안 스트레스 테스트** | **총 240개** | **100% 통과 (Pass)** |

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: FEATURE COVERAGE (80 tests: 16 features × 5 tests)                             │
│   • 상향식 루트 탐색 (CLI 플래그, 환경변수, 설정파일, 워크스페이스 마커, VCS 마커, CWD) │
│   • 전역 --root / --project-root CLI 플래그 파싱 및 경로 바인딩                       │
│   • 선언적 설정 로딩 (.ts, .mjs, .json, .oarc.json) 및 defineConfig 유효성 검증        │
│   • 인자 없는 generate / validate 디스패치, 결정론적 SHA-256 해싱, 드리프트 검출       │
│   • 의미론적 브레이킹 diff 차단, browser-studio 5개 프로파일 및 29개 가드 컴파일       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 2: BOUNDARY & CORNER CASES (80 tests: 16 features × 5 tests)                      │
│   • 존재하지 않는 경로, 공백/유니코드 경로, Windows 역슬래시 정규화                    │
│   • 우선순위 충돌 해소 (CLI 플래그 > 환경변수 > oa.config.ts > pnpm-workspace > .git)   │
│   • 문법 에러 설정 파일, 0바이트 아티팩트, 손상된 JSON 파싱 예외 처리                   │
│   • 스키마 공백/주석 변경 시 무변경 보존, 순환 참조 $ref 무한 루프 차단                │
│   • 8단계 이상 깊은 중첩 디렉토리 실행, 서브모듈 경계 횡단, CSP 위반 코드 검출        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 3: CROSS-FEATURE INTERACTIONS (16 pairwise/multi-stage pipelines)                 │
│   • 전역 루트 오버라이드 -> 커스텀 설정 로드 -> 다중 프로파일 생성 -> CSP 감사         │
│   • 깊은 하위 디렉토리 실행 -> 상향 탐색 -> 설정 로드 -> 전체 프로파일 검증          │
│   • Zod 스키마 수정 -> 인메모리 프로젝션 -> SHA-256 불일치 -> 드리프트 실패 (Exit 1)   │
│   • 모노레포 패키지 간 브랜치 전환 및 커밋 간 비교 diff 파이프라인                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 4: REAL-WORLD APPLICATION SCENARIOS (8 end-to-end workflows)                      │
│   • Browser Studio 프로덕션 전체 빌드 (5개 도메인 프로파일 + 29개 가드 산출)           │
│   • 중첩 서브모듈 packages/browser-mapper 내부 실행 및 루트 경계 횡단                 │
│   • CI/CD PR 파이프라인 스펙 최신성 게이트 (불일치 시 PR 병합 차단)                   │
│   • Manifest V3 샌드박스 런타임 불변식 (eval 및 new Function 0건 보장)                 │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ TIER 5: ADVERSARIAL HARDENING & STRESS (38 challenger tests)                           │
│   • 깨진 심링크(Dangling Symlink) 및 파일시스템 순환 심링크 탐색 내성                 │
│   • 빈 문자열/공백 플래그 및 악의적으로 변조된 환경 변수 방어                          │
│   • Object.freeze 동결 객체, 프로토타입 오염(Prototype Pollution) 게터 트랩 방어      │
│   • 쉼표 연산자 (0, eval) 및 괄호 생성자 new (Function)() CSP 난독화 우회 차단        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 16개 핵심 기능 매핑 (Feature Inventory F01 ~ F16)

| 기능 # | 기능 ID | 기능 명칭 | 명세 출처 | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|:---:|:---:|---|---|:---:|:---:|:---:|:---:|
| **1** | `F01` | `findProjectRoot` 유틸리티 | `ORIGINAL_REQUEST §R1` | 5 | 5 | 1 | 1 |
| **2** | `F02` | 전역 `--root` / `--project-root` CLI 플래그 | `ORIGINAL_REQUEST §R1` | 5 | 5 | 1 | 1 |
| **3** | `F03` | 코어 루트 재익스포트 및 전파 | `PROJECT §M1` | 5 | 5 | 1 | 0 |
| **4** | `F04` | CLI 스펙 체크 일치 (`check-cli-spec`) | `PROJECT §M1` | 5 | 5 | 1 | 0 |
| **5** | `F05` | 선언적 `defineConfig` 스키마 | `ORIGINAL_REQUEST §R2` | 5 | 5 | 1 | 0 |
| **6** | `F06` | 비동기 설정 로더 (`loadOaConfig`) | `ORIGINAL_REQUEST §R2` | 5 | 5 | 1 | 1 |
| **7** | `F07` | 설정 주도형 `oa-gen generate` | `ORIGINAL_REQUEST §R2` | 5 | 5 | 1 | 1 |
| **8** | `F08` | 설정 주도형 `oa-gen validate` | `ORIGINAL_REQUEST §R2` | 5 | 5 | 1 | 1 |
| **9** | `F09` | 결정론적 스키마 해싱 (`computeVersionHash`) | `ORIGINAL_REQUEST §R3` | 5 | 5 | 1 | 0 |
| **10** | `F10` | 스펙 최신성 및 드리프트 검출 (`drift:check`) | `ORIGINAL_REQUEST §R3` | 5 | 5 | 1 | 1 |
| **11** | `F11` | 의미론적 브레이킹 diff (`--fail-on-breaking`) | `ORIGINAL_REQUEST §R3` | 5 | 5 | 1 | 0 |
| **12** | `F12` | Browser Studio `oa.config.ts` 연동 | `ORIGINAL_REQUEST §R4` | 5 | 5 | 1 | 1 |
| **13** | `F13` | 심층 하위 디렉토리 실행 적합성 | `ORIGINAL_REQUEST §R4` | 5 | 5 | 1 | 1 |
| **14** | `F14` | 5개 도메인 프로파일 생성 및 검증 | `ORIGINAL_REQUEST §R4` | 5 | 5 | 1 | 1 |
| **15** | `F15` | 29개 독립형 가드 컴파일 및 CSP 감사 | `ORIGINAL_REQUEST §R4` | 5 | 5 | 1 | 1 |
| **16** | `F16` | 모노레포 E2E 적합성 및 하드닝 | `PROJECT §M5` | 5 | 5 | 1 | 1 |
| **합계** | | | | **80** | **80** | **16** | **8** |

---

## 5. 상세 테스트 명세 (Detailed Test Specifications)

### 5.1 Tier 1: 기능 커버리지 (80 Tests)

#### Feature 1: `findProjectRoot` 유틸리티 (F01)
- `T1-F01-1`: 조상 디렉토리 계층에서 `oa.config.ts`를 탐색하여 루트를 해결한다.
- `T1-F01-2`: 조상 디렉토리 계층에서 `pnpm-workspace.yaml` 모노레포 마커를 탐색하여 루트를 해결한다.
- `T1-F01-3`: 조상 디렉토리 계층에서 `.git` 버전 관리 마커를 탐색하여 루트를 해결한다.
- `T1-F01-4`: 환경 변수 `OA_PROJECT_ROOT`가 설정된 경우 파일시스템 마커보다 우선하여 루트를 해결한다.
- `T1-F01-5`: 탐색 마커와 환경 변수가 모두 부재할 경우 `process.cwd()`로 폴백한다.

#### Feature 2: 전역 `--root` / `--project-root` CLI 플래그 (F02)
- `T1-F02-1`: 명시적 `--root <path>` 플래그가 자동 루트 탐색 결과를 무조건 재정의한다.
- `T1-F02-2`: 명시적 `--project-root <path>` 플래그가 `--root`와 완전히 동일하게 동작한다.
- `T1-F02-3`: 전체 `oa-gen` 명령어가 `--root` 플래그를 인식하며 미인식 옵션 오류를 발생시키지 않는다.
- `T1-F02-4`: 전역 `--root` 플래그가 입력 파일(schemaEntry 등)의 상대 경로 해결 기준점을 올바르게 재설정한다.
- `T1-F02-5`: 전역 `--root` 플래그가 산출물 파일(outDir 등)의 생성 기준점을 올바르게 재설정한다.

#### Feature 3: 코어 루트 재익스포트 및 전파 (F03)
- `T1-F03-1`: `@oa-sdk/codegen` 패키지가 `@oa-sdk/core`로부터 `findProjectRoot`를 온전하게 재익스포트한다.
- `T1-F03-2`: `@oa-sdk/core/browser` 엔트리가 브라우저 번들 환경에서 `findProjectRoot` 호출 시 크래시 없이 안전하게 에러를 보고한다.
- `T1-F03-3`: CLI 러너가 탐색된 루트 컨텍스트를 하위 커맨드 실행 핸들러(`execute`)로 전파한다.
- `T1-F03-4`: `FindProjectRootOptions` 인터페이스가 명세서의 계약 구조와 정확히 일치한다.
- `T1-F03-5`: 코어 라이브러리 빌드 시 루트 탐색 타입 선언(`.d.ts`)이 정상 방출된다.

#### Feature 4: CLI 스펙 체크 일치 (F04)
- `T1-F04-1`: `scripts/check-cli-spec.ts`가 `--root`를 유효한 전역 옵션으로 인식한다.
- `T1-F04-2`: `scripts/check-cli-spec.ts`가 `--project-root`를 유효한 전역 옵션으로 인식한다.
- `T1-F04-3`: `oa-gen <command> --help` 도움말 출력에 전역 루트 옵션이 균일하게 포함된다.
- `T1-F04-4`: CLI 스펙 검증 스크립트 실행 시 종료 코드 0으로 성공한다.
- `T1-F04-5`: 필수 옵션 검증 로직이 전역 옵션 추출 후에 안전하게 수행된다.

#### Feature 5: 선언적 `defineConfig` 스키마 (F05)
- `T1-F05-1`: `defineConfig`가 `rootDir`를 포함한 유효한 `OaConfig` 객체를 검증 및 반환한다.
- `T1-F05-2`: `defineConfig`가 `specs` 배열(`id`, `profile`, `schemaEntry`, `outDir`)을 지원한다.
- `T1-F05-3`: `defineConfig`가 `guards` 설정(`outDir`, `split`, `moduleFormat`, `auditCsp`)을 지원한다.
- `T1-F05-4`: 하위 호환성을 위해 레거시 `schemas` 레코드 설정을 정상 수용한다.
- `T1-F05-5`: TypeScript 환경에서 `defineConfig` 반환값의 타입 추론 및 자동완성이 동작한다.

#### Feature 6: 비동기 설정 로더 (`loadOaConfig`) (F06)
- `T1-F06-1`: 동적 ESM import 또는 tsx/jiti를 통해 TypeScript `oa.config.ts` 파일을 로드한다.
- `T1-F06-2`: 순수 ESM 환경에서 `oa.config.mjs` 설정 파일을 정상 로드한다.
- `T1-F06-3`: 정적 JSON 포맷인 `oa.config.json` 설정 파일을 정상 로드한다.
- `T1-F06-4`: 표준 파일명이 없을 때 `.oarc.json` 포맷을 자동으로 탐색하여 로드한다.
- `T1-F06-5`: 디렉토리에 설정 파일이 부재할 경우 예외 없이 `null` 또는 기본 설정을 반환한다.

#### Feature 7: 설정 주도형 `oa-gen generate` (F07)
- `T1-F07-1`: 인자 없이 `oa-gen generate` 실행 시 디렉토리의 `oa.config.ts`를 자동 로드한다.
- `T1-F07-2`: `specs` 배열에 정의된 모든 프로파일 타겟 스펙을 일괄 생성한다.
- `T1-F07-3`: 설정에 `guards` 항목이 선언되어 있을 경우 독립형 타입 가드를 자동 컴파일한다.
- `T1-F07-4`: 해결된 `rootDir`를 기준으로 각 타겟의 `outDir`에 산출물을 방출한다.
- `T1-F07-5`: 생성 완료 후 모든 타겟 및 가드 번들의 요약 정보를 터미널에 표시한다.

#### Feature 8: 설정 주도형 `oa-gen validate` (F08)
- `T1-F08-1`: 인자 없이 `oa-gen validate` 실행 시 `oa.config.ts`를 자동 로드한다.
- `T1-F08-2`: `specs`에 선언된 각 타겟을 해당 타겟의 `profile` 규칙에 맞추어 유효성 검증한다.
- `T1-F08-3`: `component-bundle` 프로파일 타겟을 검증한다 (paths 생략 허용, schemas 필수).
- `T1-F08-4`: `operation-contract` 프로파일 타겟을 검증한다 (HTTP 작업 paths 필수).
- `T1-F08-5`: 모든 타겟이 유효할 경우 종료 코드 0으로 성공한다.

#### Feature 9: 결정론적 스키마 해싱 (F09)
- `T1-F09-1`: 핵심 OpenAPI 문서의 RFC 8785 표준 직렬화(`stableStringify`)를 기반으로 SHA-256 해시를 산출한다.
- `T1-F09-2`: 해시 계산 전 비결정론적 메타데이터(`x-schema-engine-*` 확장 필드)를 완벽히 제거한다.
- `T1-F09-3`: 반복 실행 및 다른 플랫폼(macOS, Linux, Windows)에서도 비트 단위로 동일한 해시를 생성한다.
- `T1-F09-4`: 표준 `sha256:<64자리 16진수>` 형식의 문자열을 반환한다.
- `T1-F09-5`: 산출된 해시값을 문서의 `x-schema-engine-version-hash` 확장에 주입한다.

#### Feature 10: 스펙 최신성 및 드리프트 검출 (F10)
- `T1-F10-1`: 저장된 아티팩트와 소스 스키마의 해시가 일치할 때 `oa-gen drift:check`가 종료 코드 0으로 통과한다.
- `T1-F10-2`: 소스 스키마 수정 후 아티팩트 미재생성 시 `oa-gen drift:check`가 종료 코드 1로 실패한다.
- `T1-F10-3`: `oa-gen check-artifact`가 커밋된 스펙 파일과 라이브 프로젝션 간의 일치성을 검증한다.
- `T1-F10-4`: 드리프트 발생 시 변경된 스키마 컴포넌트의 차이점을 가독성 높은 diff로 출력한다.
- `T1-F10-5`: `oa.config.ts`에 선언된 다중 타겟 전체에 대해 일괄 드리프트 검사를 수행한다.

#### Feature 11: 의미론적 브레이킹 diff (`--fail-on-breaking`) (F11)
- `T1-F11-1`: 필수 프로퍼티 제거 시 `oa-gen diff --fail-on-breaking`이 종료 코드 1로 실행을 중단한다.
- `T1-F11-2`: 프로퍼티 타입 비호환 변경 시 종료 코드 1로 실패한다.
- `T1-F11-3`: 비파괴적 추가(예: 새 선택적 필드) 발생 시 종료 코드 0으로 정상 통과한다.
- `T1-F11-4`: `--base` 및 `--head` 파일 경로를 프로젝트 루트 기준으로 안전하게 해결한다.
- `T1-F11-5`: 명세서에 규정된 11개 엔드포인트 및 7개 스키마 브레이킹 룰을 정확히 평가한다.

#### Feature 12: Browser Studio `oa.config.ts` 연동 (F12)
- `T1-F12-1`: Browser Studio 루트 디렉토리에 유효한 `oa.config.ts`가 구성되어 있다.
- `T1-F12-2`: 5개 도메인 프로파일 타겟(`devlink-contracts`, `devlink-mcp`, `surface-engine`, `visual-ir`, `inspector-controls`)을 선언한다.
- `T1-F12-3`: `dist/guards`를 대상 경로로 하는 독립형 타입 가드 타겟을 선언한다.
- `T1-F12-4`: 가드 타겟 설정에 `auditCsp: true` 검증 옵션이 활성화되어 있다.
- `T1-F12-5`: 설정 내 모든 스키마 엔트리 경로가 실제 유효한 소스 파일을 참조한다.

#### Feature 13: 심층 하위 디렉토리 실행 적합성 (F13)
- `T1-F13-1`: `packages/surface-engine` 디렉토리 내부에서 `oa-gen validate` 실행이 성공한다.
- `T1-F13-2`: `packages/surface-engine` 디렉토리 내부에서 `oa-gen generate` 실행이 성공한다.
- `T1-F13-3`: 중첩 서브모듈 내부 디렉토리에서 `oa-gen audit:csp` 실행이 성공한다.
- `T1-F13-4`: 생성 산출물이 현재 명령 실행 위치가 아닌 프로젝트 루트 기준 경로에 생성된다.
- `T1-F13-5`: CLI 인자로 전달된 상대 경로가 프로젝트 루트를 기준으로 올바르게 보정된다.

#### Feature 14: 5개 도메인 프로파일 생성 및 검증 (F14)
- `T1-F14-1`: `devlink-contracts` 프로파일 아티팩트를 생성하고 유효성을 검증한다.
- `T1-F14-2`: `devlink-mcp` 프로파일 아티팩트를 생성하고 유효성을 검증한다.
- `T1-F14-3`: `surface-engine` 프로파일 아티팩트를 생성하고 유효성을 검증한다.
- `T1-F14-4`: `visual-ir` 프로파일 아티팩트를 생성하고 유효성을 검증한다.
- `T1-F14-5`: `inspector-controls` 프로파일 아티팩트를 생성하고 유효성을 검증한다.

#### Feature 15: 29개 독립형 가드 컴파일 및 CSP 감사 (F15)
- `T1-F15-1`: 29개 독립형 타입 가드 파일을 지정된 출력 디렉토리에 모두 방출한다.
- `T1-F15-2`: 방출된 가드 파일 전체에 대해 `oa-gen audit:csp` 수행 시 0건의 위반을 보고한다.
- `T1-F15-3`: 생성된 가드 코드에 `eval()` 및 `new Function()` 호출이 0건임을 보증한다.
- `T1-F15-4`: 생성된 가드 코드에 `ajv`, `zod`, `@oa-sdk` 런타임 의존성 import가 0건임을 보증한다.
- `T1-F15-5`: 생성된 가드 모듈에 인덱스 배럴 및 TypeScript 선언(`.d.ts`) 파일이 포함된다.

#### Feature 16: 모노레포 E2E 적합성 및 하드닝 (F16)
- `T1-F16-1`: 모노레포 루트 기준 `pnpm -r typecheck` 실행 시 오류 0건으로 통과한다.
- `T1-F16-2`: 코어 라이브러리 전체 단위 테스트(`pnpm test:core`)가 100% 통과한다.
- `T1-F16-3`: Browser Studio 다운스트림 E2E 테스트(`pnpm test:e2e`) 609개 이상이 모두 통과한다.
- `T1-F16-4`: 스펙 거버넌스 검사 스크립트(`pnpm check:spec-governance`)가 성공한다.
- `T1-F16-5`: 릴리스 사전 점검 스크립트가 오류 없이 완료된다.

---

### 5.2 Tier 2: 경계 및 코너 케이스 (80 Tests)

#### Feature 1 Boundaries (F01)
- `T2-F01-1`: 실행 디렉토리가 10단계 이상 깊게 중첩되어 있어도 상향 탐색을 완수한다.
- `T2-F01-2`: CLI `--root` 플래그와 `OA_PROJECT_ROOT` 환경변수가 동시 존재 시 CLI 플래그가 우선한다.
- `T2-F01-3`: `OA_PROJECT_ROOT` 환경변수와 `oa.config.ts` 파일이 동시 존재 시 환경변수가 우선한다.
- `T2-F01-4`: `oa.config.ts` 파일과 `pnpm-workspace.yaml` 파일이 동시 존재 시 `oa.config.ts`가 우선한다.
- `T2-F01-5`: 서브모듈 경계 횡단 시 상위 조상의 `oa.config.ts`가 서브모듈 내부의 `.git` 파일보다 우선한다.

#### Feature 2 Boundaries (F02)
- `T2-F02-1`: 존재하지 않는 경로를 `--root`로 전달 시 친절한 진단 메시지와 함께 종료 코드 1을 반환한다.
- `T2-F02-2`: 공백, 유니코드, 상대 세그먼트(`./foo/../bar`)가 포함된 경로를 올바르게 정규화한다.
- `T2-F02-3`: Windows 스타일 역슬래시(`\`)가 포함된 경로를 POSIX 환경에서 안전하게 정규화한다.
- `T2-F02-4`: 전역 `--root` 플래그와 서브커맨드 전용 옵션이 결합될 때 파싱 충돌 없이 분리 처리한다.
- `T2-F02-5`: 빈 문자열 `--root ""` 또는 공백 문자열이 전달될 경우 명확한 유효성 에러를 출력한다.

#### Feature 3 Boundaries (F03)
- `T2-F03-1`: 루트 파일시스템 `/` 도달 시 무한 루프 없이 안전하게 중단한다.
- `T2-F03-2`: 읽기 권한이 제한된 디렉토리를 통과할 때 처리되지 않은 예외 없이 우아하게 처리한다.
- `T2-F03-3`: 커스텀 탐색 마커 목록이 담긴 옵션 객체를 안전하게 수용한다.
- `T2-F03-4`: 서로 다른 파일시스템 마운트 포인트를 가리키는 심볼릭 링크를 올바르게 추적한다.
- `T2-F03-5`: 실행 중 `process.cwd()` 디렉토리가 외부에서 삭제되어도 크래시 없이 제어한다.

#### Feature 4 Boundaries (F04)
- `T2-F04-1`: 옵션 단축 별칭(`-r` vs `--root`)이 정의된 커맨드와의 바인딩을 검증한다.
- `T2-F04-2`: 어떤 하위 커맨드도 전역 `--root`의 의미론을 로컬 옵션으로 섀도잉(덮어쓰기)하지 않음을 검증한다.
- `T2-F04-3`: 필수 인자가 누락된 경우 스택 트레이스 덤프 대신 구조화된 사용자 에러 메시지를 출력한다.
- `T2-F04-4`: 정의되지 않은 임의의 미인식 플래그(`--unknown-flag`) 전달 시 종료 코드 1을 반환한다.
- `T2-F04-5`: 전역 플래그와 결합된 `--help` 요청 시 종료 코드 0으로 도움말을 표시한다.

#### Feature 5 Boundaries (F05)
- `T2-F05-1`: 스펙 타겟에 필수 필드(`id`, `schemaEntry`)가 누락되었을 경우 스키마 검증 에러를 발생시킨다.
- `T2-F05-2`: 허용되지 않은 알 수 없는 프로파일 명칭이 전달되었을 경우 거부한다.
- `T2-F05-3`: `specs` 배열 내에 중복된 `id`가 존재할 경우 에러를 반환한다.
- `T2-F05-4`: 빈 `specs` 배열이 전달되었을 경우 런타임 예외 없이 빈 결과를 수용한다.
- `T2-F05-5`: 상대 경로 `rootDir`를 전달받을 경우 현재 작업 디렉토리 기준 절대 경로로 안전하게 정규화한다.

#### Feature 6 Boundaries (F06)
- `T2-F06-1`: `oa.config.ts` 파일에 구문 오류가 있을 경우 행/열 위치 정보를 포함한 진단을 출력한다.
- `T2-F06-2`: `oa.config.json` 파일에 손상된 JSON 구문이 있을 경우 명확한 파싱 에러를 표시한다.
- `T2-F06-3`: `.ts` -> `.mjs` -> `.json` 순서로 파일 가용성을 검사하여 순차 폴백한다.
- `T2-F06-4`: 설정 파일이 객체가 아닌 값을 반환하거나 프로미스가 거부될 경우 방어적으로 처리한다.
- `T2-F06-5`: `default` 익스포트와 `config` 네임드 익스포트 양쪽 형식을 모두 지원한다.

#### Feature 7 Boundaries (F07)
- `T2-F07-1`: 설정된 `schemaEntry` 소스 파일이 존재하지 않을 경우 친절하게 경고하고 스킵한다.
- `T2-F07-2`: 깊게 중첩된 출력 경로의 부모 디렉토리가 없을 경우 자동으로 생성한다.
- `T2-F07-3`: 생성 대상이 아닌 출력 디렉토리 내 기존 다른 파일들을 손상 없이 보존한다.
- `T2-F07-4`: 이전에 생성된 구 아티팩트 파일을 파일 락 충돌 없이 깔끔하게 덮어쓴다.
- `T2-F07-5`: 가드만 선언되었거나 스펙만 선언된 부분 설정 구조를 안전하게 처리한다.

#### Feature 8 Boundaries (F08)
- `T2-F08-1`: 다중 타겟 검증 시 첫 번째 에러에서 즉각 중단되지 않고 전체 오류 목록을 취합하여 보고한다.
- `T2-F08-2`: `operation-contract` 스펙에서 유효하지 않은 HTTP 응답 상태 코드가 포함된 경우 실패를 보고한다.
- `T2-F08-3`: `component-bundle` 스펙에서 해결되지 않는 고아(Orphan) $ref 스키마가 존재할 경우 실패한다.
- `T2-F08-4`: OpenAPI 3.0 및 3.1 스펙 방언(Dialect)의 차이점을 식별하여 적절히 처리한다.
- `T2-F08-5`: 하나 이상의 타겟이 실패한 경우 전체 실패 개수를 터미널에 요약하고 종료 코드 1을 반환한다.

#### Feature 9 Boundaries (F09)
- `T2-F09-1`: 객체 키의 순서가 무작위로 변경되어도 RFC 8785 정렬을 통해 비트 단위 동일한 해시를 생성한다.
- `T2-F09-2`: JSON 문자열 내의 단순 들여쓰기 공백이나 줄바꿈 변경이 버전 해시를 변경하지 않는다.
- `T2-F09-3`: 프로젝션 규칙에 의해 제거되는 스키마 주석이나 설명 변경이 버전 해시에 영향을 주지 않는다.
- `T2-F09-4`: enum 배열에 새 값이 추가되는 의미론적 변경은 버전 해시를 정확히 갱신한다.
- `T2-F09-5`: 필드의 필수 여부(`required`)가 변경되는 구조적 변경은 버전 해시를 정확히 갱신한다.

#### Feature 10 Boundaries (F10)
- `T2-F10-1`: 디스크에 저장되어 있어야 할 스펙 아티팩트가 결손된 경우 `missing` 상태로 드리프트를 감지한다.
- `T2-F10-2`: 아티팩트 파일이 0바이트 크기인 경우 `corrupt` 상태로 식별하고 종료 코드 1을 반환한다.
- `T2-F10-3`: 저장된 해시 헤더와 실시간 재계산 해시가 다를 때 정확한 드리프트 차이점을 포착한다.
- `T2-F10-4`: 타임스탬프 주석이나 CRLF(`\r\n`) 줄바꿈 차이 등 비의미론적 변경으로 인한 오탐(False Positive)을 방지한다.
- `T2-F10-5`: 비대화형 CI 환경이나 파이프 스트림 환경에서도 종료 코드 1을 엄격히 유지한다.

#### Feature 11 Boundaries (F11)
- `T2-F11-1`: 기존 경로에서 특정 HTTP 메서드가 삭제된 경우 브레이킹 변경으로 감지한다.
- `T2-F11-2`: 요청 본문(request body)에 필수 필드가 추가된 경우 브레이킹 변경으로 차단한다.
- `T2-F11-3`: 숫자 제약 조건(`maximum` 값 축소, `minimum` 값 증가)이 좁혀진 경우 브레이킹 변경으로 차단한다.
- `T2-F11-4`: 응답 스키마에서 enum 값이 줄어든 경우 클라이언트 수신 관점에서 비파괴적 변경으로 분류한다.
- `T2-F11-5`: 저장소 내 서로 다른 서브트리에 위치한 두 스펙 간의 diff 비교를 오류 없이 완료한다.

#### Feature 12 Boundaries (F12)
- `T2-F12-1`: Browser Studio 내부에서 정의된 커스텀 모듈 별칭(tsconfig paths)을 해석한다.
- `T2-F12-2`: 중첩 패키지(`packages/surface-engine`) 내부의 깊은 스키마 엔트리를 정상 해석한다.
- `T2-F12-3`: 패키지 루트 외부에 위치한 가드 출력 경로(`dist/guards`)를 정상 생성한다.
- `T2-F12-4`: 생성된 가드 배럴 인덱스에서 올바른 ESM import 지정자(`.js` 확장자)를 보증한다.
- `T2-F12-5`: Browser Studio의 모노레포 프로젝트 레퍼런스 및 tsconfig 제약 조건을 온전히 충족한다.

#### Feature 13 Boundaries (F13)
- `T2-F13-1`: 중첩 서브모듈 디렉토리에서 상대 경로 인자를 전달하여 `oa-gen validate`를 호출해도 정상 동작한다.
- `T2-F13-2`: `tool-module-lab/` 디렉토리 등 비표준 하위 폴더에서 실행 시 출력 경로를 루트 기준으로 맞춘다.
- `T2-F13-3`: 환경 변수 `OA_PROJECT_ROOT`가 서브셸 및 자식 프로세스 전반에 온전히 적용됨을 검증한다.
- `T2-F13-4`: 중간 계층의 불완전한 `package.json` 파일에 멈추지 않고 최상위 루트 마커까지 상향 탐색한다.
- `T2-F13-5`: 하위 폴더에 동일한 이름의 더미 설정 파일이 있을 때 상위 설정 우선순위를 명확히 유지한다.

#### Feature 14 Boundaries (F14)
- `T2-F14-1`: `surface-engine`: 비-AST 문자 범위 패치 작업 스키마의 정밀한 검증을 통과한다.
- `T2-F14-2`: `devlink-contracts`: HTTP RPC 작업과 MCP 도구 정의가 혼합된 스키마를 검증한다.
- `T2-F14-3`: `visual-ir`: 수 메가바이트 규모의 대형 복합 IR 노드 트리 스키마를 성능 저하 없이 검증한다.
- `T2-F14-4`: `inspector-controls`: UI 프로퍼티 인스펙터 바인딩 스키마를 검증한다.
- `T2-F14-5`: `devlink-mcp`: JSON-RPC 메시지 페이로드 스키마를 검증한다.

#### Feature 15 Boundaries (F15)
- `T2-F15-1`: 단일 스키마 분할 모드(`split: true`) 시 모듈 간 상호 오염 없는 독립 파일을 생성한다.
- `T2-F15-2`: 재귀 스키마 참조 구조가 포함된 경우 스택 오버플로우 없이 인라인 타입 가드를 생성한다.
- `T2-F15-3`: JavaScript 예약어(delete, default 등)와 충돌하는 식별자를 안전하게 새니타이즈한다.
- `T2-F15-4`: CSP 감사기가 문자열 결합을 이용한 교묘한 호출 패턴을 탐지한다.
- `T2-F15-5`: CSP 감사기가 괄호로 감싼 함수 생성자 `new (Function)('...')` 호출을 정확히 감지한다.

#### Feature 16 Boundaries (F16)
- `T2-F16-1`: `.turbo` 또는 빌드 캐시가 전혀 없는 클린 상태에서도 동일한 결정론적 결과를 산출한다.
- `T2-F16-2`: 동시 다발적인 병렬 테스트 실행 시 임시 디렉토리 및 파일 충돌이 발생하지 않는다.
- `T2-F16-3`: 공개 API 표면에서 암시적 `any` 타입이 일절 존재하지 않음을 타입체크로 보증한다.
- `T2-F16-4`: 심링크로 연결된 워크스페이스 패키지 간의 순환 참조 해결 루프를 방지한다.
- `T2-F16-5`: 테스트 종료 후 모든 자식 프로세스와 임시 디렉토리가 100% 수거 및 정리된다.

---

### 5.3 Tier 3: 교차 기능 상호작용 (16 Tests)

1. `T3-01`: 명시적 `--root` + 비동기 `oa.config.ts` 로드 + 다중 타겟 `oa-gen generate` 실행.
2. `T3-02`: 깊은 하위 디렉토리에서의 상향 루트 탐색 + 설정 로드 + `oa-gen validate` 실행.
3. `T3-03`: 설정 주도형 5개 프로파일 생성 -> 결정론적 해시 계산 -> 저장본과 비트 단위 일치 검증.
4. `T3-04`: 설정 주도형 생성 -> 독립형 가드 방출 -> 자동 `oa-gen audit:csp` 스캔 -> 위반 0건 확인.
5. `T3-05`: Zod 스키마 수정 -> 설정 기반 라이브 프로젝션 -> `oa-gen drift:check`가 차이를 감지하고 종료 코드 1 반환.
6. `T3-06`: 스펙 아티팩트 갱신 -> `oa-gen drift:check` 통과 -> `oa-gen diff --fail-on-breaking`으로 호환성 검증.
7. `T3-07`: `OA_PROJECT_ROOT` 환경변수 지정 -> `.oarc.json` 설정 로드 -> 커스텀 디렉토리에 가드 생성.
8. `T3-08`: 서브모듈 내부 깊은 경로 실행 -> 루트 경계 상향 횡단 -> `browser-studio/oa.config.ts` 로드.
9. `T3-09`: 파괴적 스키마 변경 주입 -> `diff --fail-on-breaking` 파이프라인 차단 -> 드리프트 진단 리포트 출력.
10. `T3-10`: 단일 실행 내에서 `component-bundle`과 `operation-contract` 프로파일 동시 검증.
11. `T3-11`: 가드 분할 설정 및 필터링 적용 -> 필터링된 출력 디렉토리에 대한 선택적 CSP 감사.
12. `T3-12`: Git 브랜치 전환 시뮬레이션 환경에서 인덱스와 커밋본 간 스펙 최신성 검증.
13. `T3-13`: `defineConfig` 내 커스텀 `rootDir` 선언 -> 로더 해석 -> 경로 리매핑을 통한 다중 타겟 생성.
14. `T3-14`: CLI `--project-root` 옵션을 `oa-gen audit:csp`에 전달하여 원격 번들 디렉토리 검사.
15. `T3-15`: 레거시 `schemas` 설정 -> 신규 `specs` 배열 마이그레이션 호환성 및 산출물 동일성 검증.
16. `T3-16`: 완전한 CI 거버넌스 드라이런: 루트 탐색 + 설정 검증 + 스펙 최신성 + CSP 감사 통합 파이프라인.

---

### 5.4 Tier 4: 실환경 애플리케이션 워크로드 (8 Tests)

1. `T4-01: Browser Studio 스펙 및 가드 거버넌스 전체 파이프라인`:
   `/Users/junwoobang/workflow/browser-studio`의 `oa.config.ts`를 실행하여 5개 도메인 프로파일 및 29개 가드를 생성하고, 0건의 CSP 위반과 0건의 드리프트를 확인.
2. `T4-02: 중첩 서브모듈 하위 디렉토리 실행 적합성`:
   개발자가 `packages/browser-mapper/packages/selector-evaluator` 내부에서 수동 플래그 없이 `oa-gen validate`를 실행할 때 상위 `browser-studio` 루트를 자동 인식함을 검증.
3. `T4-03: CI 풀 리퀘스트 스펙 최신성 게이트`:
   `artifacts/specs/`의 커밋된 OpenAPI 아티팩트가 라이브 Zod 스키마와 일치하는지 CI 환경에서 검사하여, 추적되지 않은 스키마 변경 시 PR 병합을 차단.
4. `T4-04: 릴리스 워크플로우 내 브레이킹 체인지 의미론 게이트`:
   `v1.0.0` 태그의 스펙을 파일로 꺼내(`git show v1.0.0:<스펙 경로> > <base 파일>`) `oa-gen diff --base <base 파일> --head <현재 스펙 파일> --fail-on-breaking`을 실행하여 하위 비호환 변경이 있을 경우 배포를 방지(`oa-gen diff`는 git ref를 받지 않음).
5. `T4-05: Manifest V3 콘텐츠 스크립트 라이브 편집 샌드박스 불변식`:
   컴파일된 29개 독립형 가드를 엄격한 VM 샌드박스(`eval` 및 `Function` 완전 비활성화 환경)에 로드하여 정상 실행을 확인.
6. `T4-06: 클린 Git Clone 환경 빌드 검증`:
   사전 빌드 캐시가 전혀 없는 임시 디렉토리에 저장소를 클론하고 `pnpm build` 및 `oa-gen generate`가 무결하게 동작함을 검증.
7. `T4-07: 다운스트림 모노레포 패키지 심링크 연결 복원력`:
   `browser-studio`에서 `link:../oa-sdk/packages/codegen`으로 연결된 패키지가 중복 의존성 해결 오류 없이 원활히 바인딩됨을 확인.
8. `T4-08: 전체 릴리스 패키징 및 CSP 감사 게이트`:
   `pnpm release:preflight`를 실행하여 빌드, 타입체크, CSP 감사 통과 및 공개 아티팩트로의 스키마 엔진 런타임 누출 0건을 최종 보증.

---

### 5.5 하위 경로 실행 적합성 (Subdirectory Conformance, 18 Tests)

`packages/codegen/src/__tests__/e2e/subdirectory-conformance.test.ts`는 모노레포 내 다양한 디렉토리 깊이(6개 계층)에서 실행 회복력을 집중 검증한다:
1. 모노레포 최상위 루트 (`/`)
2. 1단계 패키지 루트 (`packages/codegen/`)
3. 2단계 하위 디렉토리 (`packages/codegen/src/cli/`)
4. 서브모듈 최상위 루트 (`packages/browser-mapper/`)
5. 서브모듈 내부 중첩 패키지 (`packages/browser-mapper/packages/selector-evaluator/`)
6. 딥 네스팅 테스트 디렉토리 (8단계 이상)

각 위치에서 `oa-gen validate`, `oa-gen generate`, `oa-gen drift:check`를 실행하여:
- 산출물이 호출 경로가 아닌 모노레포 프로젝트 루트에 정확히 매핑되는지,
- 상대 경로 파라미터가 왜곡 없이 정규화되는지를 18개 테스트 케이스로 입증한다.

---

### 5.6 Tier 5: 적대적 하드닝 및 스트레스 검증 (38 Challenger Tests)

Tier 5는 정상적인 범위를 벗어난 비정상적, 악의적 입력 및 환경 파괴 조건에서의 엔진 복원력을 검증하는 챌린저 테스트 스위트다 (`challenger-m5-adversarial-stress.test.ts` 19개 + `challenger-m5-adversarial-hardening.test.ts` 19개).

1. **파일시스템 및 심볼릭 링크 순환 공격 방어**:
   - 상위 디렉토리를 가리키는 순환 심링크(`symlink loop`) 존재 시 스택 오버플로우 없이 탐색을 안전하게 중단.
   - 대상이 삭제된 깨진 심링크(Dangling Symlink)를 통과할 때의 무중단 복원력.
   - 특수 문자, 이모지, 공백, 제어 문자가 포함된 기괴한 경로명(`weird (dir) [test] #1/`) 처리.
2. **환경 변수 및 CLI 플래그 변조 방어**:
   - 공백만으로 구성된 플래그(`--root "   "`) 입력 시 graceful 에러 리포팅.
   - 악의적으로 변조된 환경 변수(`OA_PROJECT_ROOT=/dev/null` 또는 권한 없는 디렉토리) 격리.
   - 플래그와 환경 변수 간의 동시 오염 상황에서 CLI 인자의 절대적 우선순위 유지.
3. **설정 객체 변조 및 프로토타입 방어 (Prototype Defense)**:
   - `Object.freeze`로 동결된 불변 설정 객체 또는 Object 프로토타입에 getter 트랩이 설치된 경우의 프로토타입 오염 방어.
   - 함수형 설정이 Error 객체가 아닌 문자열이나 null로 reject되는 프로미스를 반환할 때의 방어.
   - 바이트 순서 표식(BOM)이 포함된 UTF-8 JSON 설정 파일 처리.
4. **드리프트 엔진 극한 스트레스**:
   - 0바이트 크기의 빈 아티팩트 파일 인입 시 `corrupt` 상태로 정확히 진단하고 종료 코드 1 반환.
   - JSON 문법이 파괴된 아티팩트에 대한 안전한 파싱 실패 진단.
   - 수천 개의 키가 무작위 순서로 뒤섞인 대형 스키마에 대한 오탐(False Positive) 방지.
5. **Manifest V3 CSP 감사 엔진 우회 공격 차단**:
   - 쉼표 연산자 난독화: `(0, eval)('malicious()')` AST 표현식 언래핑을 통한 즉각적인 탐지.
   - 괄호 생성자 난독화: `new (Function)('return this')` 탐지.
   - 문자열 템플릿 리터럴 타이머: `setTimeout(\`alert(1)\`, 100)` AST 탐지.
   - 금지된 런타임 라이브러리(`ajv`, `zod`, `@oa-sdk`)의 동적 임포트(`import()`) 및 TypeScript `import = require()` 정적 패턴 탐지.

---

## 6. 디렉토리 구조 및 테스트 러너 설정

### 디렉토리 구조
```
packages/codegen/
├── src/
│   ├── cli/                      # oa-gen CLI 명령어 구현체
│   │   ├── commands/             # generate, validate, drift:check, diff, audit:csp 등
│   │   └── lib/                  # config-loader, openapi-breaking-diff 등
│   ├── spec-projector.ts         # computeVersionHash, stableStringify 구현
│   └── __tests__/
│       ├── challenger-m5-adversarial-stress.test.ts     # Tier 5 스트레스 (19 tests)
│       ├── challenger-m5-adversarial-hardening.test.ts  # Tier 5 하드닝 (19 tests)
│       └── e2e/                  # 4-Tier E2E 스위트 디렉토리
│           ├── fixtures/         # 모의 모노레포 픽스처 빌더
│           ├── helpers/          # runOaCli 프로세스 실행기 & 임시 격리 유틸
│           ├── tier1-feature-coverage.test.ts   # 80개 테스트
│           ├── tier2-boundary-cases.test.ts     # 80개 테스트
│           ├── tier3-interactions.test.ts       # 16개 테스트
│           ├── tier4-real-world.test.ts         # 8개 테스트
│           └── subdirectory-conformance.test.ts # 18개 테스트
packages/core/
├── src/
│   ├── root.ts                   # findProjectRoot 계층적 탐색 알고리즘
│   └── index.ts                  # 코어 API 익스포트
```

### 테스트 러너 설정
- **엔진**: Vitest (v4.1.4+) configured in `packages/codegen/vitest.config.ts`.
- **런타임**: Node.js `>=24.0.0` 네이티브 ESM 런타임.
- **워커 동시성 제어**:
  - 파일시스템 I/O 격리와 자식 프로세스 간섭 방지를 위해 E2E 스위트는 `--no-file-parallelism` 또는 `--maxWorkers 2`로 실행한다.
  - 대규모 파일 빌드 및 다단계 프로파일 생성을 고려하여 파일당 타임아웃을 60,000ms로 설정한다.

### 실행 명령어

```bash
# 전체 E2E 테스트 실행 (202개 테스트)
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e

# 각 티어별 개별 테스트 실행
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier1-feature-coverage.test.ts
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier2-boundary-cases.test.ts
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier3-interactions.test.ts
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/tier4-real-world.test.ts
pnpm --filter @oa-sdk/codegen test src/__tests__/e2e/subdirectory-conformance.test.ts

# Tier 5 적대적 하드닝 챌린저 테스트 실행 (38개 테스트)
pnpm --filter @oa-sdk/codegen test src/__tests__/challenger-m5-adversarial-stress.test.ts
pnpm --filter @oa-sdk/codegen test src/__tests__/challenger-m5-adversarial-hardening.test.ts

# 전체 모노레포 타입체크 게이트
pnpm -r typecheck

# 다운스트림 Browser Studio E2E 검증 (609+ 테스트)
pnpm --dir /Users/junwoobang/workflow/browser-studio test:e2e
```

---

## 7. 성공 및 실패 판정 기준 (Pass/Fail Criteria)

CI/CD 파이프라인 및 PR 릴리스 게이트에서 E2E 테스트 스위트는 아래 기준에 따라 엄격히 판정된다:

1. **테스트 성공 (PASS)**:
   - Tier 1~4 (184개) + Subdirectory (18개) + Tier 5 (38개) 총 240개 테스트 100% 성공.
   - 단 하나의 테스트 실패도 허용되지 않음 (Zero Tolerance).
2. **타입 안전성 게이트**:
   - `pnpm -r typecheck` 실행 결과 에러 0건.
3. **거버넌스 일치성**:
   - `scripts/check-cli-spec.ts` 검증 결과 불일치 0건.
4. **런타임 보안 보증**:
   - 방출된 모든 타입 가드에 대해 `oa-gen audit:csp` 결과 위반 0건.
