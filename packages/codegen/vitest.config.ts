import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { SUBPROCESS_TEST_BUDGET_MS } from './src/__tests__/helpers/subprocess-budget'
import { BROWSER_STUDIO_PREBUILT_MODULES } from './src/__tests__/helpers/browser-studio'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./src/__tests__/node-runtime-setup.ts'],
    testTimeout: SUBPROCESS_TEST_BUDGET_MS,
    // 픽스처 생성처럼 훅에서도 CLI 하위 프로세스를 실행하므로 테스트와 같은 예산을 준다(기본값 10초).
    hookTimeout: SUBPROCESS_TEST_BUDGET_MS,
    env: {
      // 테스트가 반복해서 띄우는 oa-gen(tsx/dist)·tsc 하위 프로세스가 같은 모듈 그래프를 매번 다시 컴파일하지 않도록
      // Node 컴파일 캐시(V8 코드 캐시, 내용 해시로 검증)를 공유한다. 1분 부하 평균 약 4~6에서 측정한 중앙값:
      // tsx `generate` 639 → 588 ms, `drift:check` 645 → 559 ms, dist `--help` 212 → 147 ms.
      // NODE_DISABLE_COMPILE_CACHE=1이면 Node가 캐시를 쓰지 않는다.
      NODE_COMPILE_CACHE:
        process.env.NODE_COMPILE_CACHE ??
        fileURLToPath(new URL('./node_modules/.cache/node-compile-cache', import.meta.url)),
    },
    server: {
      deps: {
        // 외부 저장소가 빌드한 순수 ESM 번들은 변환하지 않고 Node가 직접 불러온다(근거는 helpers/browser-studio.ts).
        external: [BROWSER_STUDIO_PREBUILT_MODULES],
      },
    },
  },
})
