/**
 * codegen 테스트가 하위 프로세스 작업 한 단위(oa-gen CLI 실행, tsc, TypeSpec 컴파일)에 허용하는 벽시계 예산.
 *
 * 이 값을 쓰는 곳:
 * - vitest의 testTimeout과 hookTimeout(vitest.config.ts).
 * - 테스트 안에서 하위 프로세스에 거는 정지 감시(hang guard) 타임아웃 전부. spawnSync/execSync/execFileSync의
 *   `timeout` 옵션과, 스스로 끝나야 하는 자식에 주는 runBoundedProcess의 `timeoutMs`가 여기에 해당한다.
 *   동기 spawn은 이벤트 루프를 막아 vitest 타이머가 끼어들 수 없으므로 정지 감시가 따로 필요하다.
 *   그 값이 이 예산보다 작으면 부하 상태에서 느리지만 정상인 실행을 먼저 죽인다(SIGTERM, 종료 코드 143).
 *   한 테스트가 하위 프로세스를 여러 번 띄우면 정지 감시는 각 실행을, testTimeout은 그 합을 제한한다.
 *
 * 예산보다 작은 값을 일부러 쓰는 곳은 코드 옆에 이유를 적는다:
 * - mock.test.ts: 비동기 자식의 수명 감시를 예산에서 5초 뺀 값으로 둬, SIGKILL 정리가 testTimeout 안에서 끝나게 한다.
 * - typespec-bounded-process.test.ts: 25 ms·3초는 정지 감시가 아니라 검증 대상인 시간 초과 자체다.
 * `timeout` 없이 띄우는 동기 spawn(예: browser-studio 기반 테스트의 execSync)에는 정지 감시가 없다.
 *
 * 근거(공유 12코어 호스트, 1분 부하 평균 40~80, 스왑 거의 소진): tsx로 띄운 `oa-gen tsp diff --base HEAD~1`
 * 30.4~31.4초(30초 정지 감시에 걸림, 부하 10에서는 4.4초), `tsc` + @types/node 28~46초,
 * 훅에서 실행한 `oa-gen generate` 10초 초과.
 */
export const SUBPROCESS_TEST_BUDGET_MS = 60_000
