import { defineConfig } from 'vitest/config'
import { SUBPROCESS_TEST_BUDGET_MS } from './src/__tests__/helpers/subprocess-budget'
import { BROWSER_STUDIO_PREBUILT_MODULES } from './src/__tests__/helpers/browser-studio'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./src/__tests__/node-runtime-setup.ts'],
    // 테스트가 반복해서 띄우는 oa-gen(tsx/dist)·tsc 하위 프로세스가 실행 하나 동안 Node 컴파일 캐시를 공유한다.
    // 캐시는 실행마다 임시 디렉터리에 만들고 끝나면 지운다(근거와 측정은 helpers/subprocess-compile-cache.ts).
    globalSetup: ['./src/__tests__/helpers/subprocess-compile-cache.ts'],
    testTimeout: SUBPROCESS_TEST_BUDGET_MS,
    // 픽스처 생성처럼 훅에서도 CLI 하위 프로세스를 실행하므로 테스트와 같은 예산을 준다(기본값 10초).
    hookTimeout: SUBPROCESS_TEST_BUDGET_MS,
    server: {
      deps: {
        // 외부 저장소가 빌드한 순수 ESM 번들은 변환하지 않고 Node가 직접 불러온다(근거는 helpers/browser-studio.ts).
        external: [BROWSER_STUDIO_PREBUILT_MODULES],
      },
    },
  },
})
