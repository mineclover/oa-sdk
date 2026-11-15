# Effect TSGO × OA SDK 레퍼런스의 공식 근거 / 참조 카탈로그

확인 날짜: 2026-10-27. 이 문서는 설계 선택 및 검증 근거를 찾기 위한 색인이다. 해당 문서를 읽은 것과 실제 호환성 PASS는 별개다. 소스/출처/판본은 레퍼런스 패키지의 잠금 파일과 실제 실행 결과를 기준으로 재확인한다.

| 근거 | 원문 | 이 레퍼런스에서 확인할 사항 |
| --- | --- | --- |
| Node.js Docker 공식 이미지 | https://hub.docker.com/_/node | `node:26-bookworm` 태그/아키텍처 및 최초 사용 시 실제 digest |
| Node Docker 운영 가이드 | https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md | 비root `node` 사용자, 런타임 signal, 캐시/설치 |
| Docker bind mount | https://docs.docker.com/engine/storage/bind-mounts/ | 레퍼런스 폴더만 바인드, 상위 저장소 파일 접근 차단 |
| Docker volumes | https://docs.docker.com/engine/storage/volumes/ | `node_modules` 및 npm cache 독립 볼륨 |
| Docker Compose run | https://docs.docker.com/reference/cli/docker/compose/run/ | 컨테이너의 일회성 검증 실행과 종료 코드 |
| npm ci | https://docs.npmjs.com/cli/v11/commands/npm-ci/ | lockfile과 manifest 불일치 시 실패, 설치 시 잠금 파일 불변 |
| npm install | https://github.com/npm/cli/blob/latest/docs/lib/content/commands/npm-install.md | 최초 lockfile 생성 시 명시적 의존성 해결 |
| Effect TSGO | https://github.com/Effect-TS/tsgo/blob/main/README.md | Effect TSGO를 단일 TypeScript-Go 언어 서버·검사기로 사용, Effect 진단 |
| Effect TSGO 패키지 | https://github.com/Effect-TS/tsgo/tree/main/_packages/tsgo | `@effect/tsgo` CLI, `tsc@7.0.2` patchless 경로, 설치 판본 |
| Effect v4 시작 | https://effect.website/docs/v4/onboarding | Effect 프로그램을 값으로 정의해 명시적으로 실행하는 의미 |
| Effect v4 Devtools | https://effect.website/docs/v4/getting-started/devtools | LSP 진단/Quick Fix와 런타임 Fiber 디버거의 역할 분리 |
| OA SDK Quick Start | https://github.com/mineclover/oa-sdk/blob/main/docs/guides/quick-start.md | `oa-gen validate/typegen/generate:zod` 실행 계약 |
| OA SDK typed client 소비 | https://github.com/mineclover/oa-sdk/blob/main/docs/guides/client-and-query-consumption.md | `generate:client --types-import ./types.js`, 동반 `@oa-sdk/client` |
| OA SDK TypeSpec authority | https://github.com/mineclover/oa-sdk/blob/main/docs/internal/architecture/009-typespec-first-authoring.md | OA SDK production TypeSpec SSOT와 독립 소비자 OpenAPI의 역할 구분 |
| OA SDK TypeScript 호환 검증 | https://github.com/mineclover/oa-sdk/blob/main/packages/codegen/src/__tests__/typegen/compile-check.test.ts | 생성물 TS7 소비 검증의 기존 선례 (TTSC fixture는 이번 실험에서 사용 안 함) |
| 연계된 옛 Checker 실험 | https://github.com/mineclover/ttsc-ex/issues/11 | 이식 대신 독립 소비자 시나리오를 선택한 배경/비교 조건 |

## 결과의 소유권

- `contract/openapi.yaml`: 실험 계약 원본
- `src/api/types.ts`, `src/api/client.ts`, `src/api/schemas.ts`: OA SDK 도구가 생성하며 사람이 수정하지 않음
- `src/service.ts`: Effect로 작성한 소비자 로직과 오류 정책
- `tsconfig.json`: Effect TSGO의 TypeScript + Effect 플러그인 선택
- `package-lock.json`: 첫 Docker bootstrap 이후 실제 npm 해석 결과로 생성·검토·커밋해야 하는 누락 중인 증거
- `.reports/latest.json`: 실행별 입력·출력 해시 및 단계별 판정, 기본적으로 Git 제외

모호한 호환성 단정 대신 [검증 프로토콜](./verification-protocol.md)에서 정의한 검사 상태를 적용한다.
