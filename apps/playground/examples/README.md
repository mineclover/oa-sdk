# Playground 실행 가능한 실전 데모 모음 (Executable Demos)

`@oa-sdk/playground`는 OA SDK의 전체 파이프라인(TypeSpec, OpenAPI 3.2, 순수 핸들러 계약, 무경량 독립형 가드, 목 서버)을 브라우저/Node.js 환경에서 직접 실행하고 검증할 수 있는 공식 데모 모음집입니다.

---

## 📌 데모 목록 및 실행 방법

| 데모 스크립트 | 대상 패턴 및 증명 내용 | 실행 명령 |
|---|---|---|
| **1. 풀 파이프라인 E2E 데모**<br>`full-pipeline.ts` | OpenAPI 3.2 정본 스펙 파싱 $\rightarrow$ 인메모리 Mock HTTP 서버 가동 $\rightarrow$ 대표 CRUD 호출 $\rightarrow$ 34개 오퍼레이션 커버리지 리포트 방출 | `pnpm --filter @oa-sdk/playground run demo` |
| **2. 실전 코드 패턴 & 비디오 트랜지션**<br>`demo-typespec-patterns.ts` | 다형성 비디오 트랜지션 6종(`Fade`, `Wipe`, `Slide`, `Gl` 등), `@visibility` 단일 모델 CRUD 수명주기 분기 투영, RFC 9457 구조적 에러, 초당 250만 op/s 벤치마크 | `pnpm --filter @oa-sdk/playground run demo:patterns` |
| **3. 무경량 독립형 가드 & MV3**<br>`demo-standalone-guards.ts` | 순수 데이터 모델 선언 $\rightarrow$ 제로-런타임 의존성 독립형 가드 컴파일 $\rightarrow$ Chrome MV3 엄격 CSP 샌드박스(eval 차단) 통과 $\rightarrow$ 430만 msg/sec IPC 검증 | `pnpm --filter @oa-sdk/playground run demo:guards` |
| **4. 프레임워크 무의존 핸들러 계약**<br>`demo-router-contracts.ts` | 프레임워크 무의존 `*.contract.ts` 핸들러 $\rightarrow$ `HandlerResponse<Status, Body>` 다중 상태 유니온 $\rightarrow$ Hono 라우터 어댑터 바인딩 $\rightarrow$ 인메모리 HTTP E2E 테스트 | `pnpm --filter @oa-sdk/playground run demo:router` |
| **5. 전체 데모 일괄 실행** | 위 4가지 실전 데모를 한 번에 연속 실행하여 전체 무결성 검증 | `pnpm --filter @oa-sdk/playground run demo:all` |

---

## 🚀 데모별 상세 설명

### 1. `demo-typespec-patterns.ts` (TypeSpec 8대 작성 패턴 & 비디오 트랜지션)
- **비디오 트랜지션 파라미터 다양화**: Cubic Bézier 제어점, GLSL 셰이더 코드, 방향/페더링 제약이 포함된 6대 트랜지션을 선언하고, 런타임 가드로 정상/비정상 페이로드를 100% 구분합니다.
- **`@visibility` 수명주기 격리**: 단일 `User` 모델에서 `Create`(비밀번호 필수, id 주입 차단), `Read`(비밀번호 해시 누출 차단), `Update`(불변 필드 수정 방지)로 자동 분기 투영되는 원리를 시연합니다.
- **초고속 성능 입증**: 외부 라이브러리 없이 순수 JavaScript 직렬 IF 분기로 컴파일되어 초당 2,500,000건 이상의 검증 처리량(< 0.4ns)을 입증합니다.

```bash
pnpm --filter @oa-sdk/playground run demo:patterns
```

### 2. `demo-standalone-guards.ts` (Non-HTTP / Chrome MV3 / IPC)
- **Zero-Runtime Dependency**: 런타임 `dependencies: {}`로 번들 오버헤드가 0입니다.
- **CSP 샌드박스 방어**: `globalThis.eval`과 `new Function` 호출을 엄격히 차단한 상태에서도 단 1건의 CSP 위반 없이 완벽하게 작동합니다.
- **Worker IPC 처리량**: 마이크로초 미만 지연시간으로 초당 4,000,000건 이상의 직렬화 메시지 패킷을 검증합니다.

```bash
pnpm --filter @oa-sdk/playground run demo:guards
```

### 3. `demo-router-contracts.ts` (순수 핸들러 계약 & 라우터)
- **프레임워크 무의존**: Express나 Hono 객체에 종속되지 않는 순수 비즈니스 함수로 핸들러를 작성합니다.
- **타입 안전 다중 상태코드 반환**: `HandlerResponse<200, UserDto> | HandlerResponse<404, ProblemDetails> | HandlerResponse<422, ProblemDetails>` 형태로 성공과 에러 상태코드를 정밀하게 강제합니다.
- **Hono/Node.js 연동**: 라우터 계층에 어댑터를 통해 단 몇 줄로 마운트하고 실제 HTTP 요청/응답을 처리합니다.

```bash
pnpm --filter @oa-sdk/playground run demo:router
```
