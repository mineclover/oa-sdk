import { createServer } from 'node:http'
import { defineConfig } from 'vitest/config'
import { configDefaults } from 'vitest/config'

const NODE_HTTP_TESTS = [
  'src/__tests__/integration/cli-multi-file.test.ts',
  'src/__tests__/integration/edge-cases.test.ts',
  'src/__tests__/integration/framework.test.ts',
  'src/__tests__/integration/node-http.test.ts',
  'src/__tests__/integration/override.test.ts',
  'src/__tests__/integration/route-filter.test.ts',
  'src/__tests__/integration/streaming-e2e.test.ts',
  'src/__tests__/integration/stress.test.ts',
  'src/__tests__/oas32/spec-mediatype.test.ts',
]

export default defineConfig(async () => {
  const canRunNodeHttpTests = await canBindLocalhost()

  return {
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: canRunNodeHttpTests
        ? configDefaults.exclude
        : [...configDefaults.exclude, ...NODE_HTTP_TESTS],
      // MSW setupServer는 globalThis.fetch를 패치함.
      // worker_threads pool에서는 각 worker가 독립적인 globalThis를 가져
      // MSW 인터셉터가 동작하지 않음 → forks pool 사용
      pool: 'forks',
      setupFiles: ['./src/__tests__/node-runtime-setup.ts'],
    },
  }
})

async function canBindLocalhost(): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })
}
