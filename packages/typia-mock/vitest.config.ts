import { createServer } from 'node:http'
import { defineConfig } from 'vitest/config'
import { configDefaults } from 'vitest/config'

const NODE_HTTP_TESTS = [
  'src/__tests__/integration/server.test.ts',
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
