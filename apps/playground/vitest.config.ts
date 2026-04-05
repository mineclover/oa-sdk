import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 서버 라이프사이클 테스트는 forks pool에서 globalThis 격리 필요
    pool: 'forks',
    testTimeout: 10_000,
  },
})
