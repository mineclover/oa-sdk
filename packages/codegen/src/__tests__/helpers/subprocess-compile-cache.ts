import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
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
 * 캐시는 실행마다 os.tmpdir() 아래 새 디렉터리(`<COMPILE_CACHE_DIR_PREFIX><vitest 프로세스 pid>-<임의 접미사>`)에
 * 만든다. 고정 위치에 두면 픽스처가 os.tmpdir() 아래 무작위 경로에 쓰는 모듈마다 항목이 쌓여 실행할수록 커지고
 * (challenger-m3 한 파일만 다시 돌려도 30개 늘었다), 같은 패키지에서 동시에 도는 두 실행이 서로의 캐시를 건드린다.
 *
 * 실행이 끝나는 방식마다 지우는 곳이 다르다.
 * - 정상 종료: globalSetup teardown이 지운다. teardown은 워커 종료보다 먼저 돌 수 있지만, 이미 떠 있는 Node
 *   프로세스는 지워진 캐시 디렉터리를 다시 만들지 않고 종료 시 쓰기만 건너뛴다(Node 24.19에서 확인).
 * - SIGINT·SIGTERM: vitest는 teardown 없이 신호 처리기에서 process.exit()를 부른다(vitest 4.1
 *   Logger.addCleanupListeners, 종료 코드 130·143). 그래서 같은 정리를 process의 'exit' 이벤트에도 건다.
 *   터미널 Ctrl-C처럼 프로세스 그룹 전체가 신호를 받으면 이것으로 끝난다. 오케스트레이터처럼 메인 프로세스에만
 *   신호를 보내면 워커는 메인에 메시지를 보내다 실패할 때까지 잠시 더 돌며 하위 프로세스를 새로 띄우고, 새로
 *   뜨는 Node는 없는 캐시 디렉터리를 다시 만든다(challenger-m3를 6초 뒤 중단: 'exit'에서 지운 디렉터리가 1초 안에
 *   다시 생겼다).
 * - SIGKILL·SIGHUP·비정상 종료처럼 'exit' 이벤트가 오지 않으면 디렉터리가 그대로 남는다.
 * 이렇게 남은 디렉터리는 이후 실행이 회수한다. setup과 teardown은 둘 다 이름에 적힌 pid의 프로세스가 더는 없는
 * 캐시 디렉터리를 지운다. setup은 앞선 실행이 남긴 것을, teardown은 이 실행이 도는 동안 중단된 실행의 남은
 * 프로세스가 다시 만든 것을 거둔다. 그래서 중단된 실행의 캐시는, 그 실행의 남은 프로세스가 다음 실행보다 먼저
 * 끝나면 다음 실행이 끝날 때까지만 남는다. pid가 다른 프로세스에 재사용됐으면 그 프로세스가 끝난 뒤의 실행에서
 * 회수된다. 컨테이너처럼 pid 공간이 다른 실행이 같은 tmpdir를 공유해 살아 있는 실행의 캐시를 지우더라도, 이후
 * 하위 프로세스가 디렉터리를 다시 만들 뿐 테스트 결과는 바뀌지 않는다.
 *
 * 이미 NODE_COMPILE_CACHE가 있으면 그 위치(소유자가 관리)를 그대로 쓰고, NODE_DISABLE_COMPILE_CACHE가
 * 설정돼 있으면 캐시를 만들지 않는다. 두 경우 모두 이 setup은 아무것도 만들거나 지우지 않는다.
 * CLI 자체는 이 값을 설정하지 않으므로 사용자 실행에는 영향이 없다.
 */
export default function setupSubprocessCompileCache(): (() => void) | undefined {
  if (process.env.NODE_COMPILE_CACHE || process.env.NODE_DISABLE_COMPILE_CACHE) return undefined

  const parentDir = tmpdir()
  reclaimAbandonedCompileCaches(parentDir)
  const cache = createRunCompileCache(parentDir)
  process.env.NODE_COMPILE_CACHE = cache.dir

  return () => {
    delete process.env.NODE_COMPILE_CACHE
    cache.remove()
    reclaimAbandonedCompileCaches(parentDir)
  }
}

/** 실행별 캐시 디렉터리 이름의 접두사. 그 뒤에 디렉터리를 만든 프로세스의 pid와 `-`, mkdtemp 접미사가 붙는다. */
export const COMPILE_CACHE_DIR_PREFIX = 'oa-sdk-codegen-test-compile-cache-'

// pid 0은 process.kill에서 프로세스 그룹을 뜻하므로 소유자 pid로 받지 않는다.
const COMPILE_CACHE_DIR_NAME = new RegExp(`^${COMPILE_CACHE_DIR_PREFIX}([1-9]\\d*)-[A-Za-z0-9]+$`)

export interface RunCompileCache {
  dir: string
  /** 캐시 디렉터리를 지우고 'exit' 정리를 해제한다. 여러 번 불러도 된다. */
  remove: () => void
}

/**
 * 현재 프로세스가 소유하는 캐시 디렉터리를 parentDir 아래에 만들고, 프로세스가 teardown 없이 끝나도
 * 'exit' 이벤트에서 지워지게 한다.
 */
export function createRunCompileCache(parentDir: string): RunCompileCache {
  const dir = mkdtempSync(join(parentDir, `${COMPILE_CACHE_DIR_PREFIX}${process.pid}-`))
  const remove = (): void => {
    process.off('exit', remove)
    removeCacheDir(dir)
  }
  process.on('exit', remove)
  return { dir, remove }
}

/**
 * parentDir 아래에서 이름에 적힌 소유 프로세스가 더는 없는 캐시 디렉터리를 지우고, 지운 경로를 돌려준다.
 * 이름 규칙에 맞지 않는 항목과 살아 있는 프로세스가 소유한 디렉터리는 건드리지 않는다.
 */
export function reclaimAbandonedCompileCaches(parentDir: string): string[] {
  let entries
  try {
    entries = readdirSync(parentDir, { withFileTypes: true })
  } catch {
    return []
  }

  const reclaimed: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const ownerPid = compileCacheOwnerPid(entry.name)
    if (ownerPid === undefined || isProcessAlive(ownerPid)) continue
    const dir = join(parentDir, entry.name)
    if (removeCacheDir(dir)) reclaimed.push(dir)
  }
  return reclaimed
}

/** 캐시 디렉터리 이름에서 소유 프로세스의 pid를 읽는다. 이름 규칙에 맞지 않으면 undefined. */
export function compileCacheOwnerPid(name: string): number | undefined {
  const match = COMPILE_CACHE_DIR_NAME.exec(name)
  return match ? Number(match[1]) : undefined
}

/** pid의 프로세스가 있는지 확인한다. 신호를 보낼 권한이 없는(다른 사용자의) 프로세스도 있는 것으로 본다. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 캐시는 성능용일 뿐이므로 지우기 실패가 테스트 실행을 실패시키지 않게 한다('exit' 처리기에서 던지면 프로세스가
 * 오류로 끝난다). 남은 디렉터리는 소유 프로세스가 끝난 뒤의 실행이 회수한다.
 */
function removeCacheDir(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    return true
  } catch {
    return false
  }
}
