/**
 * codegen 테스트가 하위 프로세스 작업 한 단위(oa-gen CLI 실행, tsc, TypeSpec 컴파일)에 허용하는 벽시계 예산.
 *
 * vitest의 testTimeout/hookTimeout과, 테스트 안의 동기 spawn에 거는 정지 감시(hang guard) 타임아웃이
 * 모두 이 값을 쓴다. spawnSync/execSync는 이벤트 루프를 막아 vitest 타이머가 끼어들 수 없으므로,
 * 정지 감시가 따로 필요하다. 다만 그 값이 테스트 예산보다 작으면 부하 상태에서 정상 실행을 먼저 죽인다
 * (SIGTERM, 종료 코드 143).
 *
 * 근거(공유 12코어 호스트, 1분 부하 평균 40~80, 스왑 거의 소진): tsx로 띄운 `oa-gen tsp diff --base HEAD~1`
 * 30.4~31.4초(30초 정지 감시에 걸림, 부하 10에서는 4.4초), `tsc` + @types/node 28~46초,
 * 훅에서 실행한 `oa-gen generate` 10초 초과.
 */
export const SUBPROCESS_TEST_BUDGET_MS = 60_000
