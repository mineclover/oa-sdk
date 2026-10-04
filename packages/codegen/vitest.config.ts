import { defineConfig } from 'vitest/config'
import { SUBPROCESS_TEST_BUDGET_MS } from './src/__tests__/helpers/subprocess-budget'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./src/__tests__/node-runtime-setup.ts'],
    testTimeout: SUBPROCESS_TEST_BUDGET_MS,
    // 픽스처 생성처럼 훅에서도 CLI 하위 프로세스를 실행하므로 테스트와 같은 예산을 준다(기본값 10초).
    hookTimeout: SUBPROCESS_TEST_BUDGET_MS,
  },
})
