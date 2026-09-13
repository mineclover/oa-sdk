# CLI 설치 및 환경 설정 가이드 (CLI Setup)

> **Canonical Authority**: `@oa-sdk/codegen` CLI (`oa-gen`)
> **Target Audience**: `oa-sdk`를 프로젝트에 도입하는 애플리케이션 개발자, 플랫폼 엔지니어, CI/CD 관리자
> **Supported Environments**: Node.js 20+ / 22+ LTS, Bun 1.0+ / 1.1+ (macOS, Linux, Windows)

`@oa-sdk/codegen` 패키지가 제공하는 `oa-gen` CLI는 OpenAPI 3.1/3.2 사양 검증, Zod 4 및 TypeScript 타입 생성, TanStack Query v5 클라이언트 생성, 다중 프레임워크 라우터 및 순수 핸들러 계약 방출, 실시간 무중단 목(Mock) 서버 구동을 단일 도구로 통합 제공합니다.

이 문서는 다운스트림 사용자를 위한 공식 설치 및 환경 설정 단일 진실 공급원(SSOT)입니다.

---

## 1. 런타임 요구사항 (Runtime Prerequisites)

`oa-gen` CLI는 모던 JavaScript/TypeScript 런타임 표준을 준수합니다.

| 런타임 | 지원 버전 | 권장 환경 및 주요 특징 |
|---|---|---|
| **Node.js** | $\ge$ 20.0.0 (LTS) | **Node.js 22 LTS 이상 권장**. 네이티브 ESM 지원 및 타입 스트리핑 최적화. |
| **Bun** | $\ge$ 1.0.0 | **Bun 1.1 이상 권장**. Bun Elysia 대상 Zero-copy 컨텍스트 구조분해 및 초고속 네이티브 파일 와처 지원. |
| **운영체제** | macOS, Linux, Windows | Linux 컨테이너/CI 환경을 위한 재귀 파일 와칭 자동 폴백 내장. |

---

## 2. 패키지 매니저별 설치 (Package Manager Matrix)

프로젝트에서 사용하는 패키지 매니저에 맞춰 `@oa-sdk/codegen`을 **개발 의존성(`devDependencies`)**으로 설치합니다.

### npm
```bash
npm install --save-dev @oa-sdk/codegen
```

### pnpm
```bash
pnpm add -D @oa-sdk/codegen
```

### yarn
```bash
yarn add -D @oa-sdk/codegen
```

### bun
```bash
bun add -d @oa-sdk/codegen
```

---

## 3. 로컬 설치 권장 vs 전역 설치 안티패턴

`@oa-sdk` 팀은 CLI를 전역(`npm install -g @oa-sdk/codegen`)으로 설치하지 않고, 각 프로젝트의 **로컬 `devDependencies`로 설치하여 관리하는 방식을 강력히 권장**합니다.

### 로컬 devDependencies 설치의 이점
1. **버전 드리프트(Version Drift) 원천 차단**: 프로젝트의 락파일(`package-lock.json`, `pnpm-lock.yaml`, `bun.lockb`)에 CLI 버전이 정확히 고정되어, 모든 팀원과 CI/CD 파이프라인이 100% 동일한 코드젠 엔진과 검증 규칙을 사용합니다.
2. **다중 프로젝트 격리**: 서로 다른 OpenAPI 사양 버전이나 설정 체계를 사용하는 복수의 저장소 간 충돌을 방지합니다.
3. **CI/CD 재현성 보장**: 추가적인 전역 설치 단계 없이 `pnpm install` 또는 `npm ci` 직후 즉시 스크립트 실행이 가능합니다.

### 로컬 CLI 실행 방법
로컬에 설치된 `oa-gen`은 다음 명령을 통해 즉시 실행할 수 있습니다:

```bash
# npx를 통한 실행
npx oa-gen --help

# pnpm 환경
pnpm exec oa-gen --help

# bun 환경
bunx oa-gen --help

# yarn 환경
yarn oa-gen --help
```

### 권장 `package.json` 스크립트 구성
반복적인 워크플로를 위해 `package.json`의 `scripts`에 등록하여 사용하는 것을 권장합니다:

```json
{
  "scripts": {
    "oa:init": "oa-gen init",
    "oa:generate": "oa-gen generate",
    "oa:validate": "oa-gen validate",
    "oa:mock": "oa-gen mock --watch",
    "oa:drift": "oa-gen drift:check"
  }
}
```

---

## 4. 제로 설치 즉시 실행 (npx / bunx Ephemeral Execution)

영구 설치 없이 30초 만에 대화형 온보딩을 실행하거나 일회성 검증을 수행할 때는 `npx` 또는 `bunx`의 일회성 실행을 활용할 수 있습니다.

```bash
# 30초 마찰 제로 온보딩 실행 (대화형 프레임워크 감지 및 oa.config.ts 생성)
npx @oa-sdk/codegen init

# 비대화형(Headless) 자동 온보딩 (기본값 자동 수락)
npx @oa-sdk/codegen init --yes

# Bun 환경에서 일회성 온보딩 실행
bunx @oa-sdk/codegen init --yes

# 기존 OpenAPI 사양 즉시 검증
npx @oa-sdk/codegen validate --spec ./openapi.yaml --require-32

# 제로 빌드 실시간 목(Mock) 서버 즉시 구동 (포트 4010)
npx @oa-sdk/codegen mock --spec ./openapi.yaml --watch --port 4010
```

---

## 5. 설치 검증 (Installation Verification)

설치가 완료되면 CLI 전체 명령 및 사용 가능한 서브커맨드 목록을 확인합니다.

```bash
# 전체 명령 및 옵션 도움말 출력
npx oa-gen --help
```

---

## 6. 계층적 상향 프로젝트 루트 탐색 (6-Tier Project Root Resolution)

`oa-gen` CLI는 모노레포의 깊은 하위 디렉터리나 Git 서브모듈 내부에서 호출되더라도, 상향 디렉터리 순회(Upward Traversal)를 통해 최상위 프로젝트 루트를 자동으로 식별합니다.

```
┌───────────────────────────────────────────────────────────────────────────┐
│                    프로젝트 루트 식별 6단계 우선순위 (6 Tiers)               │
├───────────────────────────────────────────────────────────────────────────┤
│ Tier 1. CLI 명시 옵션: --project-root <dir> 또는 --root <dir>              │
│    ⬇ (미지정 시)                                                          │
│ Tier 2. 환경 변수: process.env.OA_PROJECT_ROOT                            │
│    ⬇ (미설정 또는 공백 시)                                                 │
│ Tier 3. 스펙 설정 파일: oa.config.ts, oa.config.mjs, oa.config.json,      │
│         .oarc.json                                                        │
│    ⬇ (조상 디렉터리 탐색 후 미발견 시)                                      │
│ Tier 4. 모노레포 워크스페이스 마커: pnpm-workspace.yaml, turbo.json,       │
│         lerna.json, package.json (workspaces 필드 선언)                   │
│    ⬇ (미발견 시)                                                          │
│ Tier 5. 형상 관리(VCS) 마커: .git 디렉터리 또는 .git 서브모듈 포인터 파일   │
│    ⬇ (미발견 시)                                                          │
│ Tier 6. 최종 Fallback: process.cwd()                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 전역 `--root` 플래그 활용
특정 하위 패키지나 외부 경로를 기준으로 CLI 파이프라인을 실행해야 하는 경우 전역 플래그를 전달할 수 있습니다:

```bash
npx oa-gen generate --root ./apps/web-service
```

---

## 7. oa-sdk 모노레포 자체 기여자 안내

이 가이드는 `oa-sdk`를 라이브러리로 활용하는 **다운스트림 사용자**를 위한 것입니다.

`oa-sdk` 오픈소스 모노레포 자체에 기여하거나, TypeSpec 프로덕션 계약을 직접 수정·승인하고, 내부 통합 빌드(`pnpm build:core`, `pnpm build:downstream`)를 실행하려는 기여자는 다음 문서를 참고하세요:

👉 [oa-sdk 모노레포 기여자 온보딩 가이드](./onboarding-playbook.md#9-oa-sdk-모노레포-기여자-온보딩)

---

## 8. 다음 단계 (Next Steps)

- **5분 빠른 시작**: [Quick Start](./quick-start.md) — 5분 안에 전 파이프라인 체험하기
- **점진적 도입 전략**: [프로젝트 온보딩 플레이북](./onboarding-playbook.md) — 3계층 온보딩 사다리 (Fastify, Elysia, Express, NestJS)
- **선언적 설정 SSOT**: [선언적 사양 설정 가이드 (oa.config.ts)](./declarative-spec-configuration.md) — 이중 계층 아키텍처, 3대 아키타입, `outputRouting` 상세
- **CLI 전체 명령어 색인**: [CLI 명령 레퍼런스](./cli-command-reference.md) — 전체 서브커맨드 및 조건부 옵션 규격
