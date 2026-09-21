# OA SDK 공식 실행 데모 및 실전 예제 모음 (Official Examples & Demos)

이 디렉터리와 [`apps/playground/examples`](../../apps/playground/examples)는 OA SDK의 다양한 실무 코드 패턴, TypeSpec 스키마 파이프라인, 제로-런타임 의존성 독립형 가드, 프레임워크 무의존 핸들러 계약, 인메모리 Mock 서버를 **직접 실행하며 검증할 수 있는 공식 실행 데모**를 제공합니다.

---

## 📌 주요 실행 데모 목록 (Playground Demos)

모든 데모는 저장소 루트에서 즉시 한 줄로 실행 가능합니다:

| 데모 이름 | 핵심 코드 패턴 및 기술 증명 | 실행 명령 |
|---|---|---|
| **[1. 실전 코드 패턴 & 비디오 트랜지션](../../apps/playground/examples/demo-typespec-patterns.ts)** | • 다형성 비디오 트랜지션 6종(`Fade`, `Wipe`, `Slide`, `Gl` 셰이더 등)<br>• `@visibility` 기반 단일 모델 CRUD 수명주기 분기 투영<br>• RFC 9457 ProblemDetails 구조적 에러 유니온<br>• 초당 250만 op/s 제로-eval Standalone Guard 벤치마크 | `pnpm --filter @oa-sdk/playground run demo:patterns` |
| **[2. 무경량 독립형 가드 & MV3](../../apps/playground/examples/demo-standalone-guards.ts)** | • Non-HTTP 순수 데이터 모델(에디터 이벤트, 텍스트 범위) 선언<br>• Chrome Extension Manifest V3 CSP 샌드박스(eval 차단) 100% 준수<br>• Node.js Worker IPC 메시지 초당 430만 건 검증 | `pnpm --filter @oa-sdk/playground run demo:guards` |
| **[3. 프레임워크 무의존 핸들러 계약](../../apps/playground/examples/demo-router-contracts.ts)** | • `*.contract.ts` 순수 핸들러 계약 인터페이스<br>• `HandlerResponse<Status, Body>` 다중 상태코드 반환 강제<br>• Hono / Node HTTP 라우터 어댑터 바인딩 및 E2E 테스트 | `pnpm --filter @oa-sdk/playground run demo:router` |
| **[4. 풀 파이프라인 E2E & Mock](../../apps/playground/examples/full-pipeline.ts)** | • OpenAPI 3.2 정본 스펙 파싱 및 API 요약 리포트<br>• 인메모리 Mock HTTP 서버 가동 및 CRUD 호출<br>• 34개 오퍼레이션 커버리지 추적 | `pnpm --filter @oa-sdk/playground run demo` |
| **[5. 전체 데모 일괄 실행](../../apps/playground/examples)** | 위 4가지 핵심 데모를 일괄 순차 실행하여 모노레포 무결성 검증 | `pnpm --filter @oa-sdk/playground run demo:all` |

---

## 📖 도메인 심층 예제 및 독푸딩 (Deep Dive Cases)

- **[Dogfood: oa-sdk 자체 페르소나 빌딩](./dogfood/README.md)**:
  `@oa-sdk/personas` 모델을 CLI 자체에 적용하여 주체-데이터 관계와 역량 매트릭스를 증명한 실전 독푸딩 기록.
- **[비디오 트랜지션 파라미터 다양화 표준 가이드](../guides/schema-architecture-and-conventions.md#61-비디오-트랜지션-파라미터-다양화-및-다형성-스키마-모델링-video-transition-parameter-diversification-standard)**:
  Bézier 타이밍 곡선, GLSL 프래그먼트 셰이더, 회전각/페더링 제약을 포함하는 6대 트랜지션 TypeSpec SSOT 모델링 상세.
- **[TypeSpec 종합 데코레이터 및 8대 실전 작성 패턴](../guides/typespec/03-decorators-reference.md)**:
  인터페이스 그룹화, 파라미터 전개, 다형성 상속, `@visibility` 수명주기 등 8대 작성 패턴 총정리.

---

## 🛠️ 직접 실행해보기 (Quick Run)

```bash
# 1. 비디오 트랜지션 및 TypeSpec 실전 패턴 실행
pnpm --filter @oa-sdk/playground run demo:patterns

# 2. Chrome MV3 및 Worker IPC 독립형 가드 실행
pnpm --filter @oa-sdk/playground run demo:guards

# 3. Hono / 핸들러 계약 실행
pnpm --filter @oa-sdk/playground run demo:router

# 4. 전체 일괄 실행
pnpm --filter @oa-sdk/playground run demo:all
```
