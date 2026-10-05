import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * vitest globalSetup: 테스트 실행 한 번 동안만 쓰는 Node 컴파일 캐시(NODE_COMPILE_CACHE)를 마련한다.
 *
 * 테스트는 oa-gen(tsx/dist)·tsc 하위 프로세스를 수백 번 띄우고, 매번 같은 모듈 그래프를 다시 컴파일한다.
 * 캐시 디렉터리를 공유하면 첫 실행 뒤의 하위 프로세스는 V8 코드 캐시(내용 해시로 검증)를 재사용한다.
 * 같은 커맨드를 한 번 실행해 채운 캐시와 캐시 없음을 9회 번갈아 잰 중앙값(1분 부하 평균 약 6.5):
 * dist `--help` 211 → 145 ms, tsx `--help` 546 → 496 ms, tsx `drift:check` 620 → 548 ms, tsx `generate` 637 → 556 ms.
 * vitest는 globalSetup이 끝난 뒤 워커를 process.env로 띄우므로 워커와 그 하위 프로세스가 이 값을 물려받는다.
 *
 * 캐시는 실행마다 새 임시 디렉터리에 만들고 teardown에서 지운다. 고정 위치에 두면 픽스처가 os.tmpdir() 아래
 * 무작위 경로에 쓰는 모듈마다 항목이 쌓여 실행할수록 커지고(challenger-m3 한 파일만 다시 돌려도 30개 늘었다),
 * 같은 패키지에서 동시에 도는 두 실행이 서로의 캐시를 건드린다. teardown은 워커 종료보다 먼저 돌 수 있지만,
 * Node는 지워진 캐시 디렉터리를 다시 만들지 않고 종료 시 쓰기만 건너뛴다(Node 24.19, NODE_DEBUG_NATIVE=COMPILE_CACHE로 확인).
 *
 * 이미 NODE_COMPILE_CACHE가 있으면 그 위치(소유자가 관리)를 그대로 쓰고, NODE_DISABLE_COMPILE_CACHE가
 * 설정돼 있으면 캐시를 만들지 않는다. CLI 자체는 이 값을 설정하지 않으므로 사용자 실행에는 영향이 없다.
 */
export default function setupSubprocessCompileCache(): (() => void) | undefined {
  if (process.env.NODE_COMPILE_CACHE || process.env.NODE_DISABLE_COMPILE_CACHE) return undefined

  const cacheDir = mkdtempSync(join(tmpdir(), 'oa-sdk-codegen-test-compile-cache-'))
  process.env.NODE_COMPILE_CACHE = cacheDir

  return () => {
    delete process.env.NODE_COMPILE_CACHE
    rmSync(cacheDir, { recursive: true, force: true })
  }
}
