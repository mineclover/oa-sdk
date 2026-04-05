import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // MSW setupServer는 globalThis.fetch를 패치함.
    // worker_threads pool에서는 각 worker가 독립적인 globalThis를 가져
    // MSW 인터셉터가 동작하지 않음 → forks pool 사용
    pool: 'forks',
  },
})
