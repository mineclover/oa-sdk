# 에이전트 커스터마이제이션 및 스킬 거버넌스 표준 규격

상태: active  
최초 제안: 2026-09-06  
표준 승인: 2026-09-06  
적용 대상: `oa-sdk` 및 관련 monorepo 프로젝트

---

## 1. 배경 및 문제 정의

Antigravity 에이전트 커스터마이제이션 플랫폼은 기본적으로 머신 전역(`~/.gemini/config/skills/`)의 스킬들을 모든 작업 공간에 자동으로 광역 탐색(Eager Discovery)하여 주입합니다. 

단일 프로젝트 환경에서는 편리하지만, 복수의 상이한 도메인(예: OpenAPI SDK, Photoshop 도구 체인, SVG 그래픽 엔진, OpenWiki 지식그래프 등)을 넘나드는 엔지니어링 환경에서는 다음과 같은 중대한 아키텍처적 부작용이 발생합니다:

1. **컨텍스트 교차 오염 (Cross-Domain Context Pollution)**
   * `oa-sdk`(OpenAPI 3.1 SDK / AST 코드젠)를 다루는 세션에 Photoshop TCP 통신, SVG 삼각함수, OpenWiki 그래프 스킬 메타데이터가 무차별 주입됩니다.
   * 이는 시스템 프롬프트 토큰을 낭비할 뿐만 아니라, 모델의 주의(Attention) 분산과 무관한 도구의 오작동(False Positive Triggering) 위험을 높입니다.
2. **환경 비재현성 (Non-Hermeticity & Non-Determinism)**
   * 개발자 A의 로컬 머신 스킬 목록과 개발자 B의 스킬 목록이 다르면, **동일한 브랜치·동일한 프롬프트에서도 에이전트의 동작과 산출물이 달라집니다.**
   * 글로벌 설정에 의존하는 에이전트는 CI/CD 환경이나 신규 온보딩 환경에서 동일한 결과를 보장할 수 없습니다.
3. **최소 권한 및 보안 위배 (Violation of Least Privilege)**
   * 스킬 패키지는 내부 실행 스크립트(`scripts/`)나 훅을 가질 수 있습니다. 프로젝트와 무관한 외부 스킬이 열려 있는 것은 잠재적인 사이드이펙트의 통로가 됩니다.

---

## 2. 핵심 아키텍처 원칙

본 표준은 **"글로벌 기본 닫힘(Closed-by-Default) + Git Worktree 물리 격리 + 프로젝트별 명시적 화이트리스트"** 체계를 기본 규격으로 확립합니다.

```mermaid
graph TD
    subgraph Global [글로벌 환경 ~/.gemini/config/]
        G_Skills[Global Skills Repository]
        G_Block[Closed-by-Default: 전역 광역 탐색 기본 차단]
    end

    subgraph Worktree [Git Worktree 격리 작업 공간]
        P_Skills[Local Project Skills: .agents/skills/]
        P_Config[.agents/skills.json & plugins.json]
        P_White[Explicit Whitelist: include_only]
        P_Session[에이전트 세션 라이프사이클: 시작 시 1회 고정 로드]
    end

    G_Skills -.차단.-> G_Block
    G_Skills -->|선별적 인가| P_White
    P_Skills --> P_Config
    P_White --> P_Config
    P_Config --> P_Session
    P_Session --> Agent[100% 밀폐된 순수 도메인 에이전트 컨텍스트]
```

### 3대 불변성 원칙

1. **밀폐성 (Hermeticity)**: 프로젝트 작업 시 에이전트가 사용하는 모든 스킬과 플러그인은 해당 저장소의 `.agents/` 설정에 의해 완전히 결정되어야 한다. 로컬 머신의 전역 상태에 의해 에이전트 동작이 왜곡되어서는 안 된다.
2. **화이트리스트 우선 (Whitelist-First)**: 외부/글로벌 스킬을 참조할 때는 블랙리스트(`exclude`) 방식보다 **명시적 화이트리스트(`include_only`)** 방식을 원칙으로 한다.
3. **정적 인프라로서의 취급 (Static Infrastructure Invariant)**: 스킬 및 플러그인 설정은 런타임 중간에 빈번히 수정하는 상태값이 아니라, `tsconfig.json`이나 `package.json`과 같은 **Git 버전 관리 대상 정적 인프라 메타데이터**로 다룬다.

---

## 3. Git Worktree 격리 및 세션 수명주기(Lifecycle) 표준

### 3.1 런타임 핫 리로드(HMR) 지양 및 Worktree 분리 원칙
* 대화 세션 진행 도중에 스킬을 동적으로 껐다 켜는 런타임 핫 리로드(HMR)는 프롬프트 캐시(KV Cache) 무효화, 레이턴시 스파이크, 부모-자식 에이전트 간 인지 분열(Split-Brain)을 유발합니다.
* 도메인 전환(예: Photoshop 도구 체인 작업 ↔ `oa-sdk` 코드젠 작업)이나 기능 분기 시에는 **Git Worktree(`git worktree add`)를 활용하여 작업 공간 디렉터리를 물리적으로 분리**하는 것을 표준 워크플로우로 삼습니다.

### 3.2 세션 수명주기 일치 (1 Worktree = 1 Dedicated Session)
* 새 Worktree를 열면 해당 작업 디렉터리를 루트로 하는 **새로운 에이전트 대화 세션**을 시작합니다.
* 새 세션은 시작 시점에 해당 Worktree의 `.agents/skills.json`을 단 1회 결정론적으로 로드하므로, 세션 진행 중 프롬프트 캐시 낭비 없이 **100% 예측 가능하고 안정적인 밀폐형 컨텍스트**가 유지됩니다.

---

## 4. 표준 디렉터리 및 설정 구조 규격

### 4.1 프로젝트 저장소 구조 (`.agents/`)

```text
<project-root>/
└── .agents/
    ├── skills.json        # [필수] 프로젝트 스킬 활성화 선언 및 화이트리스트
    ├── plugins.json       # [선택] 프로젝트 플러그인 활성화 선언
    └── skills/            # [선택] 프로젝트 전용 로컬 스킬 디렉터리
        └── <project-skill>/
            └── SKILL.md
```

### 4.2 프로젝트 스킬 설정 파일 규격 (`.agents/skills.json`)

```json
{
  "$schema": "https://antigravity.google/schemas/skills.json",
  "entries": [
    {
      "path": ".agents/skills"
    },
    {
      "path": "~/.gemini/config/skills",
      "include_only": [
        // 이 프로젝트 도메인에 명시적으로 필요한 스킬만 정규식 화이트리스트 선언
        "oa-.*",
        "openapi-.*"
      ]
    }
  ]
}
```

* **`.agents/skills` 우선 등록**: 해당 프로젝트에만 귀속되는 로컬 스킬을 1순위로 마운트합니다.
* **`include_only` 화이트리스트 강제**: 머신에 새로운 글로벌 스킬이 추가되더라도 프로젝트의 에이전트 환경에는 절대 오염되지 않도록 보장합니다.

### 4.3 프로젝트 플러그인 설정 파일 규격 (`.agents/plugins.json`)

```json
{
  "$schema": "https://antigravity.google/schemas/plugins.json",
  "entries": [
    {
      "path": ".agents/plugins"
    },
    {
      "path": "~/.gemini/config/plugins",
      "include_only": [
        "modern-web-guidance-plugin"
      ]
    }
  ]
}
```

---

## 5. `oa-sdk` 레퍼런스 구현 및 검증 현황

`oa-sdk` 저장소는 OpenAPI 3.1 코드 생성기 및 스펙 거버넌스 툴체인으로서 본 표준 규격을 준수합니다:

1. **포토샵 / 위키 / SVG 스킬 원천 차단**:
   * `.agents/skills.json`을 통해 도메인 외 스킬(`photoshop-toolchain-workflow`, `openwiki-*`, `svg-authoring`) 주입 차단.
2. **필수 웹 표준 플러그인만 선별 허용**:
   * `.agents/plugins.json`을 통해 `modern-web-guidance-plugin`(`chrome-extensions`, `modern-web-guidance`)만 인가하여 Manifest V3 CSP 감사(`oa-gen audit:csp`) 및 표준 Web API 검증 능력 보존.
3. **문서 정합성 게이트 무결점 검증**:
   * `pnpm check:docs`를 통해 229개 마크다운 문서 및 OAS 참조 문서 전체에서 링크 깨짐 0건 달성.

---

## 6. 적용 및 운영 로드맵

| 단계 | 목표 | 세부 실행 내용 |
| :--- | :--- | :--- |
| **Phase 1: 레퍼런스 안착** | `oa-sdk` 표준화 | `.agents/skills.json`, `plugins.json`, 표준 문서 커밋 및 검증 완료 |
| **Phase 2: 연계 저장소 확장** | `spec-management-platform` 적용 | 공통 스펙 플랫폼 `.agents/`에 동일 규격 적용 확인 및 동기화 |
| **Phase 3: Worktree 워크플로우 안착** | 개발 프로세스 표준화 | 도메인 전환 시 `git worktree` 기반 세션 분리 가이드 수립 |
| **Phase 4: CI 거버넌스 게이트** | 설정 무결성 자동화 | PR 검사 시 `.agents/skills.json`의 JSON 스키마 및 화이트리스트 규칙 자동 검증 |
