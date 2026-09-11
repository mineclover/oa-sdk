import { defineConfig } from 'vitest/config'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'test/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@oa-sdk/mock-server': path.resolve(__dirname, 'packages/mock-server/src/index.ts'),
      '@oa-sdk/codegen': path.resolve(__dirname, 'packages/codegen/src/index.ts'),
      '@oa-sdk/typespec-decorators': path.resolve(__dirname, 'packages/typespec-decorators/src/index.ts'),
      '@oa-sdk/personas': path.resolve(__dirname, 'packages/personas/src/index.ts'),
      '@oa-sdk/dpm': path.resolve(__dirname, 'packages/dpm/src/index.ts'),
      '@oa-sdk/core/browser': path.resolve(__dirname, 'packages/core/src/browser.ts'),
      '@oa-sdk/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@oa-sdk/parser/browser': path.resolve(__dirname, 'packages/parser/src/browser.ts'),
      '@oa-sdk/parser': path.resolve(__dirname, 'packages/parser/src/index.ts'),
      '@oa-sdk/openapi-projection-contract': path.resolve(__dirname, 'packages/openapi-projection-contract/src/index.ts'),
    },
  },
})
