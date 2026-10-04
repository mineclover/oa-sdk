/**
 * @oa-sdk/playground
 *
 * OA SDK 전체 아키텍처 및 런타임 통합 검증 플레이그라운드.
 * TypeSpec SSOT, OAS 3.2 파서, 순수 핸들러 계약, Typed Client, Mock 실시간 핫스왑 실전 레퍼런스를 제공합니다.
 */

console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║                      OA SDK Interactive Playground                    ║
║         Zero-Loss Architecture, Fail-Closed & 3-Tier Execution        ║
╚═══════════════════════════════════════════════════════════════════════╝

📌 실행 가능한 실전 데모 명령어 안내:

  1. E2E 풀 파이프라인 (OAS 3.2 + Mock Server)
     $ pnpm --filter @oa-sdk/playground run demo

  2. 실전 코드 패턴 & 비디오 트랜지션 (TypeSpec 8대 패턴)
     $ pnpm --filter @oa-sdk/playground run demo:patterns

  3. 무경량 독립형 가드 & MV3 CSP 샌드박스 (Zero-eval)
     $ pnpm --filter @oa-sdk/playground run demo:guards

  4. 프레임워크 무의존 순수 핸들러 계약 (Multi-status Union)
     $ pnpm --filter @oa-sdk/playground run demo:router

  5. 책임 분리(SoC) & 재귀 스키마 Fail-Closed 안전성
     $ pnpm --filter @oa-sdk/playground run demo:soc

  6. Typed Fetch Client & TanStack Query v5 3-Tier 아키텍처
     $ pnpm --filter @oa-sdk/playground run demo:client

  7. 실시간 원자적 라우트 테이블 핫스왑 & Stateful Mock
     $ pnpm --filter @oa-sdk/playground run demo:mock

  ★ 7대 실전 데모 일괄 실행:
     $ pnpm --filter @oa-sdk/playground run demo:all

자세한 아키텍처 배경과 코드 스니펫은 apps/playground/examples/README.md 를 참조하세요.
`);
