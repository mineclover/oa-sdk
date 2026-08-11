import { createServer } from 'node:http'
import { defineConfig } from 'vitest/config'
import { configDefaults } from 'vitest/config'

const NODE_HTTP_TESTS = [
  'tests/codegen.test.ts',
  'tests/e2e-client-execution.test.ts',
  'tests/e2e-pipeline.test.ts',
  'tests/mock-server.test.ts',
  'tests/test-helpers.test.ts',
]

export default defineConfig(async () => {
  const canRunNodeHttpTests = await canBindLocalhost()

  return {
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      exclude: canRunNodeHttpTests
        ? configDefaults.exclude
        : [...configDefaults.exclude, ...NODE_HTTP_TESTS],
      // 서버 라이프사이클 테스트는 forks pool에서 globalThis 격리 필요
      pool: 'forks',
      setupFiles: ['./tests/node-runtime-setup.ts'],
      testTimeout: 60_000,
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
