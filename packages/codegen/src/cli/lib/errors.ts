/** CLI command가 이미 사용자용 진단을 출력한 뒤 종료 상태만 전달할 때 사용합니다. */
export class CliExitError extends Error {
  constructor(readonly exitCode = 1) {
    super(`CLI exited with code ${exitCode}`)
  }
}
