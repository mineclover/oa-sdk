import { defineConfig } from 'vitest/config'

// Real-browser E2E: needs the Chromium revision of the installed `playwright-core`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
