# 독립 레퍼런스 검증 프로토콜

## 목표

**Effect TSGO + OA SDK**의 검수/디버깅 역량을 평가한다. TTSC·TypeScript-Go Go Checker를 포팅하지 않고, OA SDK가 생성한 계약형 타입/클라이언트를 Effect TSGO로 컴파일하고 실제 Effect 4 소비자 로직을 실행한다.

| 단계 | 입력 | 성공의 최소 증거 | 검수에서 금지할 해석 |
| --- | --- | --- | --- |
| 환경 E0 | Node 26 Docker 이미지, 잠금 파일, pinned deps | 실제 이미지 digest, Node/TS7·Effect 설치 판본, lock hash | moving Docker 태그를 고정 digest라고 주장 |
| 계약 E1 | OpenAPI 3.2 원본 | OA validate 종료코드 0 | TypeSpec production 계약 승인으로 간주 |
| 생성 E2 | E1 + OA SDK codegen/client/Zod | 타입, typed fetch client, Zod 생성 + 파일 해시 | 생성된 산출물 직접 보정 |
| 정적 E3 | E2 + `src/service.ts` | Effect TSGO TS7 컴파일 성공 및 full diagnostics coverage | 일반 TypeScript 통과를 Effect 규칙 실행으로 간주 |
| 음성 E4 | 분리된 `floating-effect.ts` | error-level `floatingEffect` 진단, 해당 진단 파일·위치, 예상 nonzero exit | 의도된 오류를 앱 정상 컴파일 판정으로 합침 |
| 실행 E5 | E2 + JS emit | HTTP 200 시 1회 호출, 404·200 bad schema 각 typed Effect Fail | runtime 성공이 LSP CodeAction 검증까지 증명 |
| 회귀 E6 | E0~E5, 동일 source/config revision | 재실행 시 재현성, 변경 없는 소스 입력, 저장 위치, 관측된 실패·미실행 분리 | `candidate-passed`를 제품 채택·배포 가능 판정으로 확대 |

## 검수 레시트

`scripts/review.mjs`가 `.reports/latest.json`을 출력한다. 프로세스 실패·중단·환경 미구성·의도된 음성 오류는 원인과 진단 소스가 서로 달라야 한다.

레시트에는 정확한 소스와 `package-lock.json` SHA-256, generated artifacts SHA-256, 플러그인/컴파일러 판본, 종료 코드, 진단의 rule/file/position, Node 플랫폼/아키텍처와 이미지 참조를 적는다. 이 중 이미지의 고정 digest는 로컬 Docker inspection 또는 후속 실행자의 증거로만 확정한다.

## 작성·디버깅 범위의 구분

- `effect-tsgo diagnostics --format json`은 **정적 진단**이다. `floatingEffect` 규칙 미검출/disabled 상태를 빈 결과로 취급하지 않는다.
- `effect-tsgo tsc@7.0.2`는 **타입 검사·JS 출력**을 담당한다. 규칙 진단과 실행 의미가 일치하는지 독립적으로 비교한다.
- Effect의 `Effect.runPromise`와 `Exit.cause.reasons`는 **실제 런타임 검증**이다.
- VS Code/Cursor Quick Fix, Refactor, 런타임 Fiber·Span inspect는 **별도의 UI/디버거 검증**이다. 이 레퍼런스의 CLI·Node 검수만으로 해당 기능의 통과를 선언하지 않는다.

## 완료조건

- [ ] `package-lock.json` 생성/커밋 및 반복 `npm ci` 성공
- [ ] Node 26/Docker 이미지 digest와 native TSGo 컴파일러 판본 확인
- [ ] `npm run review`의 모든 필수 단계와 8개 Node 계약 테스트 통과
- [ ] 실제 Effect 서비스의 200/404/잘못된 200 응답 기대 Fail와 부작용 횟수 확인
- [ ] negative diagnostic의 정확한 source/version/rule/파일 범위 확인
- [ ] 비용/관측/디버깅 보조 적합성 리뷰 후 '유효한 독립 레퍼런스' 승격 결정

## 위치

- Docker 재현: [Docker 테스트 환경](./docker-test-environment.md)
- 출처/버전: [참고 문서 카탈로그](./reference-sources.md)
- 레퍼런스 코드 설계: [../REVIEW.md](../REVIEW.md)
- 이전 정적 검증 이력: [../VERIFICATION.md](../VERIFICATION.md)
